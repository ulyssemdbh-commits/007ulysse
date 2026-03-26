import { Router, Request, Response, NextFunction } from "express";
import { githubService } from "../services/githubService";
import { connectorBridge } from "../services/connectorBridge";
import { db } from "../db";
import { users, devopsDeployUrls } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const router = Router();

const isLocalServer = fs.existsSync("/etc/nginx/sites-available");

function getAuthenticatedGitUrl(repoOrUrl: string): string {
  const token = process.env.GITHUB_TOKEN;
  if (repoOrUrl.startsWith("https://github.com/") && token) {
    return repoOrUrl.replace("https://github.com/", `https://${token}@github.com/`);
  }
  if (token && !repoOrUrl.startsWith("http")) {
    return `https://${token}@github.com/${repoOrUrl}.git`;
  }
  return repoOrUrl;
}

async function runServerCommand(cmd: string, timeout = 10000): Promise<{ success: boolean; output: string; error?: string }> {
  if (isLocalServer) {
    try {
      const output = execSync(cmd, { encoding: "utf8", timeout, maxBuffer: 5 * 1024 * 1024 }).trim();
      return { success: true, output };
    } catch (e: any) {
      return { success: false, output: e.stdout?.trim() || "", error: e.stderr?.trim() || e.message };
    }
  }
  const { sshService } = await import("../services/sshService");
  return sshService.executeCommand(cmd, timeout);
}

async function writeServerFile(remotePath: string, content: string): Promise<void> {
  if (isLocalServer) {
    fs.writeFileSync(remotePath, content);
    return;
  }
  const { sshService } = await import("../services/sshService");
  await sshService.writeRemoteFile(remotePath, content);
}

function getUserId(req: Request): number {
  const userId = (req as any).user?.id || (req.session as any)?.userId;
  if (!userId) throw new Error("User not authenticated");
  return userId;
}

async function requireOwner(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getUserId(req);
    const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user[0]?.isOwner) {
      return res.status(403).json({ error: "Owner access required" });
    }
    next();
  } catch (error: any) {
    return res.status(401).json({ error: error.message || "Unauthorized" });
  }
}

router.use(requireOwner);

router.get("/user", async (_req: Request, res: Response) => {
  try {
    const user = await githubService.getAuthenticatedUser();
    res.json(user);
  } catch (error: any) {
    console.error("[DevOps] GitHub user error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get("/repos", async (req: Request, res: Response) => {
  try {
    const { sort, per_page, page, type } = req.query;
    const repos = await githubService.listRepos({
      sort: sort as string || "updated",
      per_page: parseInt(per_page as string) || 30,
      page: parseInt(page as string) || 1,
      type: type as string || "all"
    });
    res.json(repos);
  } catch (error: any) {
    console.error("[DevOps] List repos error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get("/templates", async (_req: Request, res: Response) => {
  try {
    const { PROJECT_TEMPLATES } = await import("../services/projectTemplates");
    res.json(PROJECT_TEMPLATES.map(t => ({ id: t.id, name: t.name, description: t.description, icon: t.icon, category: t.category })));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/repos", async (req: Request, res: Response) => {
  try {
    const { name, description, isPrivate, templateId } = req.body;
    if (!name) return res.status(400).json({ error: "Repository name required" });
    
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
      return res.status(400).json({ error: "Invalid repo name. Only letters, numbers, hyphens, dots and underscores allowed." });
    }
    
    console.log(`[DevOps] Creating repo: ${name}, template: ${templateId || 'none'}, private: ${isPrivate}`);
    
    const { getTemplate, renderTemplateFiles } = await import("../services/projectTemplates");
    const template = templateId ? getTemplate(templateId) : null;
    const useAutoInit = !template || template.files.length === 0;
    
    const repo = await githubService.createRepo(name, { description, isPrivate, autoInit: useAutoInit });
    
    if (!repo || !repo.full_name) {
      console.error(`[DevOps] createRepo returned invalid response:`, JSON.stringify(repo));
      return res.status(500).json({ error: "GitHub did not return a valid repository. Please try again." });
    }
    
    console.log(`[DevOps] Repo created: ${repo.full_name} (id: ${repo.id})`);
    
    if (template && template.files.length > 0) {
      const files = renderTemplateFiles(template, name, description || "");
      console.log(`[DevOps] Scaffolding ${template.name} (${files.length} files) — waiting for GitHub...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      try {
        await githubService.applyPatch(repo.owner.login, repo.name, repo.default_branch, files, `🚀 Scaffold ${template.name} project`);
        console.log(`[DevOps] Scaffolded ${template.name} for ${repo.full_name} (${files.length} files)`);
      } catch (patchErr: any) {
        console.error(`[DevOps] Scaffold error (will retry):`, patchErr.message);
        await new Promise(resolve => setTimeout(resolve, 3000));
        try {
          await githubService.applyPatch(repo.owner.login, repo.name, repo.default_branch, files, `🚀 Scaffold ${template.name} project`);
          console.log(`[DevOps] Scaffold retry succeeded for ${repo.full_name}`);
        } catch (retryErr: any) {
          console.error(`[DevOps] Scaffold retry also failed:`, retryErr.message);
          return res.json({ ...repo, templateApplied: null, scaffoldError: retryErr.message });
        }
      }
    }
    
    res.json({ ...repo, templateApplied: template?.id || null });
  } catch (error: any) {
    console.error("[DevOps] Create repo error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get("/repos/:owner/:repo", async (req: Request, res: Response) => {
  try {
    const { owner, repo } = req.params;
    const [repoData, languages] = await Promise.all([
      githubService.getRepo(owner, repo),
      githubService.getRepoLanguages(owner, repo).catch(() => ({}))
    ]);
    res.json({ ...repoData, languages });
  } catch (error: any) {
    console.error("[DevOps] Get repo error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get("/repos/:owner/:repo/branches", async (req: Request, res: Response) => {
  try {
    const { owner, repo } = req.params;
    const branches = await githubService.listBranches(owner, repo);
    res.json(branches);
  } catch (error: any) {
    console.error("[DevOps] List branches error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post("/repos/:owner/:repo/branches", async (req: Request, res: Response) => {
  try {
    const { owner, repo } = req.params;
    const { branchName, fromBranch } = req.body;
    
    const sourceBranch = await githubService.getBranch(owner, repo, fromBranch || "main");
    const result = await githubService.createBranch(owner, repo, branchName, sourceBranch.commit.sha);
    res.json(result);
  } catch (error: any) {
    console.error("[DevOps] Create branch error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get("/repos/:owner/:repo/commits", async (req: Request, res: Response) => {
  try {
    const { owner, repo } = req.params;
    const { branch, per_page } = req.query;
    const commits = await githubService.listCommits(
      owner, repo, branch as string, parseInt(per_page as string) || 20
    );
    res.json(commits);
  } catch (error: any) {
    console.error("[DevOps] List commits error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get("/repos/:owner/:repo/tree/:branch", async (req: Request, res: Response) => {
  try {
    const { owner, repo, branch } = req.params;
    const branchData = await githubService.getBranch(owner, repo, branch);
    const tree = await githubService.getTree(owner, repo, branchData.commit.sha);
    res.json(tree);
  } catch (error: any) {
    console.error("[DevOps] Get tree error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get("/repos/:owner/:repo/contents/*", async (req: Request, res: Response) => {
  try {
    const { owner, repo } = req.params;
    const filePath = req.params[0];
    const { ref } = req.query;
    const content = await githubService.getFileContent(owner, repo, filePath, ref as string);
    res.json(content);
  } catch (error: any) {
    console.error("[DevOps] Get file error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.put("/repos/:owner/:repo/contents/*", async (req: Request, res: Response) => {
  try {
    const { owner, repo } = req.params;
    const filePath = req.params[0];
    const { content, message, branch, sha, isBase64 } = req.body;
    if (isBase64) {
      const result = await githubService.createOrUpdateFileRaw(
        owner, repo, filePath, content, message, branch, sha
      );
      res.json(result);
    } else {
      const result = await githubService.createOrUpdateFile(
        owner, repo, filePath, content, message, branch, sha
      );
      res.json(result);
    }
  } catch (error: any) {
    console.error("[DevOps] Update file error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post("/repos/:owner/:repo/patch", async (req: Request, res: Response) => {
  try {
    const { owner, repo } = req.params;
    const { branch, files, commitMessage } = req.body;
    
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "files array required" });
    }
    if (!branch || !commitMessage) {
      return res.status(400).json({ error: "branch and commitMessage required" });
    }
    
    const result = await githubService.applyPatch(owner, repo, branch, files, commitMessage);
    res.json(result);
  } catch (error: any) {
    console.error("[DevOps] Apply patch error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get("/repos/:owner/:repo/pulls", async (req: Request, res: Response) => {
  try {
    const { owner, repo } = req.params;
    const { state } = req.query;
    const pulls = await githubService.listPullRequests(owner, repo, state as string || "open");
    res.json(pulls);
  } catch (error: any) {
    console.error("[DevOps] List PRs error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post("/repos/:owner/:repo/pulls", async (req: Request, res: Response) => {
  try {
    const { owner, repo } = req.params;
    const { title, body, head, base } = req.body;
    const pr = await githubService.createPullRequest(owner, repo, title, body || "", head, base || "main");
    res.json(pr);
  } catch (error: any) {
    console.error("[DevOps] Create PR error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.put("/repos/:owner/:repo/pulls/:pull_number/merge", async (req: Request, res: Response) => {
  try {
    const { owner, repo, pull_number } = req.params;
    const { merge_method } = req.body;
    const result = await githubService.mergePullRequest(
      owner, repo, parseInt(pull_number), merge_method || "squash"
    );
    res.json(result);
  } catch (error: any) {
    console.error("[DevOps] Merge PR error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get("/repos/:owner/:repo/actions/runs", async (req: Request, res: Response) => {
  try {
    const { owner, repo } = req.params;
    const runs = await githubService.listWorkflowRuns(owner, repo);
    res.json(runs);
  } catch (error: any) {
    console.error("[DevOps] List workflow runs error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get("/repos/:owner/:repo/actions/workflows", async (req: Request, res: Response) => {
  try {
    const { owner, repo } = req.params;
    const workflows = await githubService.listWorkflows(owner, repo);
    res.json(workflows);
  } catch (error: any) {
    console.error("[DevOps] List workflows error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post("/repos/:owner/:repo/actions/workflows/:workflow_id/dispatches", async (req: Request, res: Response) => {
  try {
    const { owner, repo, workflow_id } = req.params;
    const { ref, inputs } = req.body;
    await githubService.triggerWorkflow(owner, repo, workflow_id, ref || "main", inputs);
    res.json({ success: true });
  } catch (error: any) {
    console.error("[DevOps] Trigger workflow error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post("/repos/:owner/:repo/pages/builds", async (req: Request, res: Response) => {
  try {
    const { owner, repo } = req.params;
    const result = await githubService.requestPagesBuild(owner, repo);
    res.json(result);
  } catch (error: any) {
    console.error("[DevOps] Pages build error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get("/repos/:owner/:repo/pages/builds/latest", async (req: Request, res: Response) => {
  try {
    const { owner, repo } = req.params;
    const result = await githubService.getPagesBuild(owner, repo);
    res.json(result);
  } catch (error: any) {
    console.error("[DevOps] Pages build status error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post("/repos/:owner/:repo/actions/runs/:run_id/rerun", async (req: Request, res: Response) => {
  try {
    const { owner, repo, run_id } = req.params;
    await githubService.rerunWorkflow(owner, repo, parseInt(run_id));
    res.json({ success: true });
  } catch (error: any) {
    console.error("[DevOps] Rerun workflow error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post("/repos/:owner/:repo/actions/runs/:run_id/cancel", async (req: Request, res: Response) => {
  try {
    const { owner, repo, run_id } = req.params;
    await githubService.cancelWorkflowRun(owner, repo, parseInt(run_id));
    res.json({ success: true });
  } catch (error: any) {
    console.error("[DevOps] Cancel workflow error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.delete("/repos/:owner/:repo/contents/*", async (req: Request, res: Response) => {
  try {
    const { owner, repo } = req.params;
    const filePath = req.params[0];
    const { message, branch } = req.body;
    if (!filePath) return res.status(400).json({ error: "File path required" });
    const result = await githubService.deleteFile(owner, repo, filePath, message || `Delete ${filePath}`, branch || "main");
    res.json({ success: true, result });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.delete("/repos/:owner/:repo/branches/:branch", async (req: Request, res: Response) => {
  try {
    const { owner, repo, branch } = req.params;
    await githubService.deleteBranch(owner, repo, branch);
    res.json({ success: true });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.post("/repos/:owner/:repo/rollback", async (req: Request, res: Response) => {
  try {
    const { owner, repo } = req.params;
    const { branch, targetSha, createBackup } = req.body;
    if (!branch || !targetSha) {
      return res.status(400).json({ error: "branch and targetSha are required" });
    }

    let backupBranch: string | null = null;

    if (createBackup !== false) {
      const branchData = await githubService.getBranch(owner, repo, branch);
      const currentSha = branchData.commit.sha;
      backupBranch = `backup/${branch}/${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
      await githubService.createBranch(owner, repo, backupBranch, currentSha);
    }

    await githubService.forcePushBranch(owner, repo, branch, targetSha);

    const commit = await githubService.getCommit(owner, repo, targetSha);

    res.json({
      success: true,
      rolledBackTo: targetSha,
      branch,
      backupBranch,
      commit: {
        sha: commit.sha,
        message: commit.commit?.message,
        author: commit.commit?.author?.name,
        date: commit.commit?.author?.date,
      }
    });
  } catch (error: any) {
    console.error("[DevOps] Rollback error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.get("/repos/:owner/:repo/search", async (req: Request, res: Response) => {
  try {
    const { owner, repo } = req.params;
    const q = req.query.q as string;
    if (!q) return res.status(400).json({ error: "Query parameter 'q' required" });
    const result = await githubService.searchCode(owner, repo, q);
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

async function loadDeployUrls(): Promise<Record<string, string[]>> {
  try {
    const rows = await db.select().from(devopsDeployUrls);
    const result: Record<string, string[]> = {};
    for (const row of rows) {
      if (!result[row.repoFullName]) result[row.repoFullName] = [];
      result[row.repoFullName].push(row.url);
    }
    return result;
  } catch (e) {
    console.error("[DevOps] loadDeployUrls DB error:", e);
    return {};
  }
}

async function saveDeployUrls(repoFullName: string, urls: string[]) {
  await db.delete(devopsDeployUrls).where(eq(devopsDeployUrls.repoFullName, repoFullName));
  if (urls.length > 0) {
    await db.insert(devopsDeployUrls).values(
      urls.map(url => ({ repoFullName, url }))
    );
  }
}

router.get("/repos/:owner/:repo/commits/:sha", async (req: Request, res: Response) => {
  try {
    const { owner, repo, sha } = req.params;
    const data = await githubService.githubApi(`/repos/${owner}/${repo}/commits/${sha}`);
    res.json(data);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.get("/repos/:owner/:repo/commits/:sha/status", async (req: Request, res: Response) => {
  try {
    const { owner, repo, sha } = req.params;
    const data = await githubService.githubApi(`/repos/${owner}/${repo}/commits/${sha}/status`);
    res.json(data);
  } catch (error: any) {
    res.json({ state: "unknown", total_count: 0, statuses: [] });
  }
});

router.get("/repos/:owner/:repo/compare/:basehead", async (req: Request, res: Response) => {
  try {
    const { owner, repo, basehead } = req.params;
    const data = await githubService.githubApi(`/repos/${owner}/${repo}/compare/${basehead}`);
    res.json({ status: data.status, ahead_by: data.ahead_by, behind_by: data.behind_by, total_commits: data.total_commits });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.get("/repos/:owner/:repo/actions/runs/:runId/jobs", async (req: Request, res: Response) => {
  try {
    const { owner, repo, runId } = req.params;
    const data = await githubService.githubApi(`/repos/${owner}/${repo}/actions/runs/${runId}/jobs`);
    res.json(data);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.get("/repos/:owner/:repo/actions/jobs/:jobId/logs", async (req: Request, res: Response) => {
  try {
    const { owner, repo, jobId } = req.params;
    const conn = await connectorBridge.getGitHub();
    if (conn.source !== 'direct' || !conn.accessToken) {
      return res.status(500).json({ error: "GitHub not configured" });
    }
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`, {
      method: "GET",
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${conn.accessToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) {
      return res.status(response.status).json({ error: "Could not fetch logs" });
    }
    const text = await response.text();
    res.json({ logs: text });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.get("/deploy-urls", async (_req: Request, res: Response) => {
  try {
    const data = await loadDeployUrls();
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/deploy-urls/:owner/:repo", async (req: Request, res: Response) => {
  try {
    const { owner, repo } = req.params;
    const { urls } = req.body;
    if (!Array.isArray(urls)) return res.status(400).json({ error: "urls must be an array" });
    const key = `${owner}/${repo}`;
    const filtered = urls.filter((u: string) => typeof u === "string" && u.trim());
    await saveDeployUrls(key, filtered);
    res.json({ success: true, urls: filtered });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/server/status", async (_req: Request, res: Response) => {
  try {
    if (isLocalServer) {
      const cpu = await runServerCommand("top -bn1 | grep '%Cpu' | awk '{print $2}' 2>/dev/null");
      const mem = await runServerCommand("free -m | awk '/Mem:/{printf \"%.0f%%\", $3/$2*100}' 2>/dev/null");
      const disk = await runServerCommand("df -h / | awk 'NR==2{print $5}' 2>/dev/null");
      res.json({ cpu: (cpu.output || "0") + "%", memory: mem.output || "N/A", disk: disk.output || "N/A" });
    } else {
      const { sshService } = await import("../services/sshService");
      const status = await sshService.serverStatus();
      res.json(status);
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/server/apps", async (_req: Request, res: Response) => {
  try {
    const result = await runServerCommand('pm2 jlist 2>/dev/null || echo "[]"');
    if (!result.success) return res.json([]);
    try {
      const apps = JSON.parse(result.output);
      res.json(apps.map((app: any) => ({
        name: app.name,
        status: app.pm2_env?.status,
        cpu: app.monit?.cpu,
        memory: app.monit?.memory ? Math.round(app.monit.memory / 1024 / 1024) + "MB" : "0MB",
        uptime: app.pm2_env?.pm_uptime ? new Date(app.pm2_env.pm_uptime).toISOString() : null,
        restarts: app.pm2_env?.restart_time,
      })));
    } catch {
      res.json([]);
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/server/cleanup-orphans", async (req: Request, res: Response) => {
  try {
    const { sshService } = await import("../services/sshService");
    const dryRun = req.body?.dryRun !== false;
    const result = await sshService.cleanupOrphanedApps(dryRun);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/server/deployments", async (_req: Request, res: Response) => {
  try {
    const scanScript = `#!/bin/bash
DIR=""
if [ -d /etc/nginx/sites-available ]; then DIR=/etc/nginx/sites-available
elif [ -d /etc/nginx/sites-enabled ]; then DIR=/etc/nginx/sites-enabled
elif [ -d /etc/nginx/conf.d ]; then DIR=/etc/nginx/conf.d
fi
if [ -z "$DIR" ]; then exit 0; fi
for f in "$DIR"/*; do
  [ ! -f "$f" ] && continue
  name=$(basename "$f")
  [ "$name" = "default" ] && continue
  echo "$name" | grep -q 'dpkg' && continue
  sn=$(sed -n 's/^[[:space:]]*server_name[[:space:]][[:space:]]*\\([^;]*\\);/\\1/p' "$f" | head -1)
  rt=$(sed -n 's/^[[:space:]]*root[[:space:]][[:space:]]*\\([^;]*\\);/\\1/p' "$f" | head -1)
  px=$(sed -n 's/.*proxy_pass.*127.0.0.1:\\([0-9][0-9]*\\).*/\\1/p' "$f" | head -1)
  sl=$(grep -c 'listen.*443.*ssl' "$f")
  echo "$name|$sn|$rt|$px|$sl"
done
`;

    await writeServerFile("/tmp/_ulysse_nginx_scan.sh", scanScript);
    await runServerCommand("chmod +x /tmp/_ulysse_nginx_scan.sh", 3000);

    const [pm2Result, nginxResult] = await Promise.all([
      runServerCommand('pm2 jlist 2>/dev/null || echo "[]"', 15000),
      runServerCommand("bash /tmp/_ulysse_nginx_scan.sh", 15000),
    ]);


    const pm2Apps: Record<string, any> = {};
    try {
      const apps = JSON.parse(pm2Result.output || "[]");
      for (const app of apps) {
        pm2Apps[app.name] = {
          status: app.pm2_env?.status || "unknown",
          cpu: app.monit?.cpu || 0,
          memory: app.monit?.memory ? Math.round(app.monit.memory / 1024 / 1024) + "MB" : "0MB",
          uptime: app.pm2_env?.pm_uptime ? new Date(app.pm2_env.pm_uptime).toISOString() : null,
          restarts: app.pm2_env?.restart_time || 0,
        };
      }
    } catch {}

    const deployments: any[] = [];
    const nginxLines = (nginxResult.output || "").split("\n").filter(Boolean);

    for (const line of nginxLines) {
      const [name, serverName, root, proxy, hasSsl] = line.split("|");
      if (!name) continue;

      const isProxy = !!proxy;
      const port = isProxy ? parseInt(proxy) : null;
      const pm2 = pm2Apps[name];
      const appDir = root || `/var/www/apps/${name}`;

      let status: string;
      if (isProxy && pm2) {
        status = pm2.status;
      } else if (isProxy && !pm2) {
        status = "stopped";
      } else {
        status = "static";
      }

      const primaryDomain = serverName ? serverName.split(" ")[0] : null;

      deployments.push({
        name,
        domain: primaryDomain || `${name}.ulyssepro.org`,
        port,
        ssl: parseInt(hasSsl || "0") > 0,
        status,
        cpu: pm2?.cpu || 0,
        memory: pm2?.memory || "0MB",
        uptime: pm2?.uptime || null,
        restarts: pm2?.restarts || 0,
        appDir,
        type: isProxy ? "node" : "static",
      });
    }

    res.json(deployments);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/server/exec", async (req: Request, res: Response) => {
  try {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: "command required" });
    const result = await runServerCommand(command, 30000);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/server/deploy", async (req: Request, res: Response) => {
  try {
    const { sshService } = await import("../services/sshService");
    const result = await sshService.deployApp(req.body);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/server/deploy-repo", async (req: Request, res: Response) => {
  try {
    const { appName, branch = "main" } = req.body;
    if (!appName) return res.status(400).json({ error: "appName required" });

    const appDir = appName === "ulysse" ? "/var/www/ulysse" : `/var/www/apps/${appName}`;
    const logs: string[] = [];

    const existsResult = await runServerCommand(`test -d ${appDir} && echo "EXISTS" || echo "MISSING"`, 5000);
    if (existsResult.output?.trim() !== "EXISTS") {
      return res.status(404).json({ error: `App directory ${appDir} not found on server` });
    }
    logs.push(`[1/7] Directory: ${appDir}`);

    const pm2Check = await runServerCommand(`pm2 describe ${appName} 2>/dev/null | head -1`, 5000);
    const wasRunningInPm2 = pm2Check.success && pm2Check.output && !pm2Check.output.includes("doesn't exist");
    if (wasRunningInPm2) {
      await runServerCommand(`pm2 stop ${appName} 2>/dev/null`, 10000);
      logs.push(`[2/7] PM2 stopped`);
    } else {
      logs.push(`[2/7] PM2: not running`);
    }

    const repoUrlResult = await runServerCommand(`cd ${appDir} && git remote get-url origin 2>/dev/null`, 5000);
    const repoUrl = repoUrlResult.output?.trim() || "";
    if (!repoUrl) {
      return res.status(400).json({ error: `No git remote found in ${appDir}` });
    }
    logs.push(`[3/7] Repo: ${repoUrl}`);

    const envBackup = await runServerCommand(`test -f ${appDir}/.env && cat ${appDir}/.env || echo ""`, 5000);
    const ecosystemBackup = await runServerCommand(`test -f ${appDir}/ecosystem.config.cjs && cat ${appDir}/ecosystem.config.cjs || echo ""`, 5000);
    const hasEnv = envBackup.output?.trim() ? true : false;
    const hasEcosystem = ecosystemBackup.output?.trim() ? true : false;
    logs.push(`[4/7] Backed up: ${hasEnv ? ".env" : ""}${hasEnv && hasEcosystem ? " + " : ""}${hasEcosystem ? "ecosystem.config.cjs" : ""}${!hasEnv && !hasEcosystem ? "nothing" : ""}`);

    const cleanResult = await runServerCommand(
      `cd ${appDir} && find . -mindepth 1 -maxdepth 1 ! -name '.env' ! -name 'ecosystem.config.cjs' ! -name 'data' ! -name 'uploads' ! -name 'storage' -exec rm -rf {} + 2>&1`,
      30000
    );
    const freshClone = await runServerCommand(
      `cd /tmp && git clone --depth 1 --branch ${branch} ${repoUrl} _deploy_${appName} 2>&1 && cp -a /tmp/_deploy_${appName}/. ${appDir}/ 2>&1 && rm -rf /tmp/_deploy_${appName} 2>&1`,
      60000
    );
    logs.push(`[5/7] Fresh clone: ${freshClone.success ? "OK" : "FAILED"}`);
    if (!freshClone.success && freshClone.output) logs.push(freshClone.output.split("\n").slice(0, 5).join("\n"));

    if (hasEnv) {
      await runServerCommand(`cat > ${appDir}/.env << 'ENVEOF'\n${envBackup.output?.trim()}\nENVEOF`, 5000);
    }
    if (hasEcosystem) {
      await runServerCommand(`cat > ${appDir}/ecosystem.config.cjs << 'ECOEOF'\n${ecosystemBackup.output?.trim()}\nECOEOF`, 5000);
    }

    const hasPkgJson = await runServerCommand(`test -f ${appDir}/package.json && echo "YES" || echo "NO"`, 5000);
    if (hasPkgJson.output?.trim() === "YES") {
      const installResult = await runServerCommand(`cd ${appDir} && npm ci 2>&1 | tail -5`, 120000);
      logs.push(`[6/7] npm ci: ${installResult.success ? "OK" : "WARN"}`);
      if (!installResult.success) {
        const fallback = await runServerCommand(`cd ${appDir} && npm install 2>&1 | tail -5`, 120000);
        logs.push(`[6/7] npm install fallback: ${fallback.success ? "OK" : "FAILED"}`);
      }

      const hasBuild = await runServerCommand(`cd ${appDir} && node -e "const p=require('./package.json'); process.exit(p.scripts?.build ? 0 : 1)" 2>/dev/null && echo "YES" || echo "NO"`, 5000);
      if (hasBuild.output?.trim() === "YES") {
        const buildResult = await runServerCommand(`cd ${appDir} && npm run build 2>&1 | tail -10`, 120000);
        logs.push(`[6/7] Build: ${buildResult.success ? "OK" : "FAILED"}`);
        if (!buildResult.success && buildResult.output) logs.push(buildResult.output);
      } else {
        logs.push(`[6/7] Build: skipped (no build script)`);
      }
    } else {
      logs.push(`[6/7] npm: skipped (static site)`);
    }

    if (wasRunningInPm2) {
      const restartResult = await runServerCommand(`pm2 restart ${appName} --update-env 2>&1`, 15000);
      logs.push(`[7/7] PM2 restart: ${restartResult.success ? "OK" : "FAILED"}`);
    } else if (hasEcosystem) {
      const startResult = await runServerCommand(`cd ${appDir} && pm2 start ecosystem.config.cjs 2>&1`, 15000);
      logs.push(`[7/7] PM2 start: ${startResult.success ? "OK" : "FAILED"}`);
    } else {
      logs.push(`[7/7] PM2: skipped (static site)`);
      await runServerCommand(`nginx -t 2>&1 && systemctl reload nginx`, 10000);
      logs.push(`Nginx reloaded`);
    }

    await runServerCommand(`pm2 save 2>/dev/null`, 5000);

    res.json({ success: true, output: logs.join("\n"), logs });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/server/push-code", async (req: Request, res: Response) => {
  try {
    const { appName, message = "Update from Ulysse DevOps", branch = "main" } = req.body;
    if (!appName) return res.status(400).json({ error: "appName required" });

    const appDir = appName === "ulysse" ? "/var/www/ulysse" : `/var/www/apps/${appName}`;
    const logs: string[] = [];

    const existsResult = await runServerCommand(`test -d ${appDir}/.git && echo "EXISTS" || echo "MISSING"`, 5000);
    if (existsResult.output?.trim() !== "EXISTS") {
      return res.status(404).json({ error: `No git repo found at ${appDir}` });
    }

    const statusResult = await runServerCommand(`cd ${appDir} && git status --porcelain 2>&1`, 10000);
    const changedFiles = (statusResult.output || "").trim();
    if (!changedFiles) {
      return res.json({ success: true, output: "No changes to push", logs: ["Nothing to commit"] });
    }
    logs.push(`Changed files:\n${changedFiles}`);

    await runServerCommand(
      `cd ${appDir} && git config user.email "ulysse@ulysseproject.org" && git config user.name "Ulysse DevOps"`,
      5000
    );

    await runServerCommand(
      `cd ${appDir} && echo -e ".env\\n.env.*\\nnode_modules/" >> .gitignore 2>/dev/null; git rm --cached .env .env.* 2>/dev/null; true`,
      5000
    );

    const commitResult = await runServerCommand(
      `cd ${appDir} && git add -A && git commit -m "${message.replace(/"/g, '\\"')}" 2>&1`,
      15000
    );
    logs.push(`Commit: ${commitResult.success ? "OK" : "FAILED"}`);
    if (commitResult.output) logs.push(commitResult.output.split("\n").slice(0, 5).join("\n"));

    const pushResult = await runServerCommand(`cd ${appDir} && git push origin ${branch} 2>&1`, 30000);
    logs.push(`Push to ${branch}: ${pushResult.success ? "OK" : "FAILED"}`);
    if (pushResult.output) logs.push(pushResult.output.split("\n").slice(0, 5).join("\n"));

    res.json({ success: pushResult.success, output: logs.join("\n"), logs });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/server/app/:name/restart", async (req: Request, res: Response) => {
  try {
    const result = await runServerCommand(`pm2 restart ${req.params.name} 2>&1`);
    res.json({ output: result.output, success: result.success });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/server/app/:name/stop", async (req: Request, res: Response) => {
  try {
    const result = await runServerCommand(`pm2 stop ${req.params.name} 2>&1`);
    res.json({ output: result.output, success: result.success });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/server/app/:name", async (req: Request, res: Response) => {
  try {
    const result = await runServerCommand(`pm2 delete ${req.params.name} 2>&1`);
    res.json({ output: result.output, success: result.success });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/server/app/:name/logs", async (req: Request, res: Response) => {
  try {
    const lines = parseInt(req.query.lines as string) || 50;
    const result = await runServerCommand(`pm2 logs ${req.params.name} --nostream --lines ${lines} 2>&1`);
    res.json({ logs: result.output || "Pas de logs" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// === DYNAMIC FRAGILITY LEARNING ===

router.get("/fragility/leaderboard", async (req: Request, res: Response) => {
  try {
    const { devopsIntelligenceEngine } = await import("../services/devopsIntelligenceEngine");
    const limit = parseInt(req.query.limit as string) || 20;
    const scores = await devopsIntelligenceEngine.getFragilityLeaderboard(limit);
    res.json({ scores, count: scores.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/fragility/file", async (req: Request, res: Response) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: "path required" });
    const { devopsIntelligenceEngine } = await import("../services/devopsIntelligenceEngine");
    const scores = await devopsIntelligenceEngine.calculateDynamicFragility(filePath);
    if (scores.length === 0) {
      const basename = filePath.split("/").pop() || "";
      const staticEntry = devopsIntelligenceEngine.findFragileModule(basename);
      return res.json({ filePath, staticScore: staticEntry?.fragility || 0, dynamicScore: 0, combinedScore: staticEntry?.fragility || 0, totalEvents: 0, reason: staticEntry?.reason || "Aucun historique" });
    }
    res.json(scores[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/fragility/record", async (req: Request, res: Response) => {
  try {
    const { events } = req.body;
    if (!events || !Array.isArray(events) || !events.length) {
      return res.status(400).json({ error: "events array required" });
    }
    const userId = getUserId(req);
    const { devopsIntelligenceEngine } = await import("../services/devopsIntelligenceEngine");
    const enriched = events.map((e: any) => ({ ...e, userId }));
    const count = await devopsIntelligenceEngine.recordFileEvent(enriched);
    res.json({ recorded: count });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/fragility/report-bug", async (req: Request, res: Response) => {
  try {
    const { files, commitSha, description } = req.body;
    if (!files || !Array.isArray(files) || !files.length) {
      return res.status(400).json({ error: "files array required" });
    }
    const userId = getUserId(req);
    const { devopsIntelligenceEngine } = await import("../services/devopsIntelligenceEngine");
    const entries = files.map((f: string) => ({
      filePath: f,
      eventType: "bug_report",
      eventResult: "bug",
      commitSha: commitSha || null,
      description: description || "Bug reporté manuellement",
      userId,
    }));
    const count = await devopsIntelligenceEngine.recordFileEvent(entries);
    res.json({ recorded: count, message: `${count} fichier(s) enregistré(s) comme bug` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// === AXE 1+2: DEVOPS INTELLIGENCE SERVICE (Reports, PR Analysis) ===

router.post("/intel/run", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { devopsIntelligenceService } = await import("../services/devopsIntelligenceService");
    const report = await devopsIntelligenceService.runIntelligenceManual(userId, req.body);
    res.json(report);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/intel/report", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const sha = req.query.sha as string;
    const repo = (req.query.repo as string) || "ulysseproject";
    if (!sha) return res.status(400).json({ error: "sha required" });
    const { devopsIntelligenceService } = await import("../services/devopsIntelligenceService");
    const report = await devopsIntelligenceService.runIntelligenceForCommit(userId, repo, sha);
    res.json(report);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/intel/reports", async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const { devopsIntelligenceService } = await import("../services/devopsIntelligenceService");
    const reports = devopsIntelligenceService.getRecentReports(limit);
    res.json({ reports, count: reports.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/intel/report/:id", async (req: Request, res: Response) => {
  try {
    const { devopsIntelligenceService } = await import("../services/devopsIntelligenceService");
    const report = devopsIntelligenceService.getReportById(req.params.id);
    if (!report) return res.status(404).json({ error: "Report not found" });
    res.json(report);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/intel/pr-analyze", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { repo, prNumber, autoComment } = req.body;
    if (!repo || !prNumber) return res.status(400).json({ error: "repo and prNumber required" });
    const { devopsIntelligenceService } = await import("../services/devopsIntelligenceService");
    const report = await devopsIntelligenceService.runIntelligenceForPR(userId, repo, prNumber);
    let commented = false;
    if (autoComment !== false) {
      commented = await devopsIntelligenceService.postPRComment(repo, prNumber, report);
    }
    res.json({ report, commented });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/intel/domain-health", async (req: Request, res: Response) => {
  try {
    const { devopsIntelligenceService } = await import("../services/devopsIntelligenceService");
    const health = await devopsIntelligenceService.getDomainHealthSummary();
    res.json(health);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// === AXE 3: DEVOPS LEARNING SERVICE ===

router.post("/learning/process-bug", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { files, description, commitSha } = req.body;
    if (!files?.length || !description) return res.status(400).json({ error: "files and description required" });
    const { devopsLearningService } = await import("../services/devopsLearningService");
    const result = await devopsLearningService.processBugAndLearn(userId, files, description, commitSha);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/learning/process-revert", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { files, commitSha, reason } = req.body;
    if (!files?.length || !commitSha) return res.status(400).json({ error: "files and commitSha required" });
    const { devopsLearningService } = await import("../services/devopsLearningService");
    const actions = await devopsLearningService.processRevert(userId, files, commitSha, reason || "Revert");
    res.json({ actions });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/learning/process-hotfix", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { files, commitSha, description } = req.body;
    if (!files?.length) return res.status(400).json({ error: "files required" });
    const { devopsLearningService } = await import("../services/devopsLearningService");
    const actions = await devopsLearningService.processHotfix(userId, files, commitSha || "", description || "Hotfix");
    res.json({ actions });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/learning/recent-incidents", async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const { devopsLearningService } = await import("../services/devopsLearningService");
    const incidents = await devopsLearningService.getRecentIncidents(limit);
    res.json({ incidents, count: incidents.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// === AXE 4: INCIDENT CORRELATION ===

router.get("/incidents/diagnose", async (req: Request, res: Response) => {
  try {
    const { incidentCorrelationService } = await import("../services/incidentCorrelationService");
    const diagnosis = await incidentCorrelationService.diagnoseIncident({
      endpoint: req.query.endpoint as string,
      errorCode: req.query.errorCode ? parseInt(req.query.errorCode as string) : undefined,
      errorMessage: req.query.errorMessage as string,
      domain: req.query.domain as string,
      hoursBack: req.query.hoursBack ? parseInt(req.query.hoursBack as string) : 24,
    });
    res.json(diagnosis);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/incidents/smart-alerts", async (req: Request, res: Response) => {
  try {
    const { incidentCorrelationService } = await import("../services/incidentCorrelationService");
    const alerts = await incidentCorrelationService.checkSmartAlerts();
    res.json({ alerts, count: alerts.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/proxy", async (req: Request, res: Response) => {
  try {
    const url = req.query.url as string;
    if (!url) return res.status(400).json({ error: "url required" });

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).json({ error: "invalid URL" });
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return res.status(400).json({ error: "invalid protocol" });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.5",
        "Accept-Encoding": "identity",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const contentType = resp.headers.get("content-type") || "text/html";
    const statusCode = resp.status;

    const isBinary = contentType.match(/image|font|audio|video|octet-stream|woff|woff2|ttf|eot|ico|svg\+xml/);

    if (isBinary) {
      const buffer = Buffer.from(await resp.arrayBuffer());
      res.removeHeader("X-Frame-Options");
      res.removeHeader("Content-Security-Policy");
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.send(buffer);
    }

    let body = await resp.text();

    if (contentType.includes("text/css")) {
      body = body.replace(/url\(\s*['"]?(?!data:|https?:|\/\/)(\.?\/?[^'")]+)['"]?\s*\)/g, (_match, relPath) => {
        const basePath = parsed.href.substring(0, parsed.href.lastIndexOf("/") + 1);
        return `url(${basePath}${relPath})`;
      });
      res.removeHeader("X-Frame-Options");
      res.removeHeader("Content-Security-Policy");
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.send(body);
    }

    if (contentType.includes("javascript") || contentType.includes("application/json")) {
      res.removeHeader("X-Frame-Options");
      res.removeHeader("Content-Security-Policy");
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.send(body);
    }

    if (contentType.includes("text/html")) {
      const origin = parsed.origin;
      const basePath = parsed.pathname.endsWith("/") ? parsed.pathname : parsed.pathname.substring(0, parsed.pathname.lastIndexOf("/") + 1) || "/";
      const baseTag = `<base href="${origin}${basePath}" target="_self">`;

      const proxyScript = `
<script>
(function(){
  var PROXY_BASE = '/api/devops/proxy?url=';
  var ORIGIN = '${origin}';

  document.addEventListener('click', function(e) {
    var a = e.target.closest('a');
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    e.preventDefault();
    var fullUrl;
    if (href.startsWith('http://') || href.startsWith('https://')) {
      fullUrl = href;
    } else if (href.startsWith('//')) {
      fullUrl = '${parsed.protocol}' + href;
    } else if (href.startsWith('/')) {
      fullUrl = ORIGIN + href;
    } else {
      fullUrl = ORIGIN + '${basePath}' + href;
    }
    window.parent.postMessage({ type: 'devops-browser-navigate', url: fullUrl }, '*');
  }, true);

  document.addEventListener('submit', function(e) {
    var form = e.target;
    if (form.tagName !== 'FORM') return;
    var action = form.getAttribute('action');
    if (action && !action.startsWith('http')) {
      var fullUrl = action.startsWith('/') ? ORIGIN + action : ORIGIN + '${basePath}' + action;
      form.setAttribute('action', PROXY_BASE + encodeURIComponent(fullUrl));
    }
  }, true);

  window.addEventListener('load', function() {
    window.parent.postMessage({
      type: 'devops-browser-loaded',
      title: document.title || '',
      url: '${url}',
      status: ${statusCode},
      favicon: (document.querySelector('link[rel*="icon"]') || {}).href || '',
      meta: {
        description: (document.querySelector('meta[name="description"]') || {}).content || '',
        viewport: (document.querySelector('meta[name="viewport"]') || {}).content || '',
        ogTitle: (document.querySelector('meta[property="og:title"]') || {}).content || '',
        ogImage: (document.querySelector('meta[property="og:image"]') || {}).content || '',
        generator: (document.querySelector('meta[name="generator"]') || {}).content || '',
      },
      performance: {
        domElements: document.querySelectorAll('*').length,
        scripts: document.querySelectorAll('script').length,
        styles: document.querySelectorAll('link[rel="stylesheet"]').length + document.querySelectorAll('style').length,
        images: document.querySelectorAll('img').length,
        links: document.querySelectorAll('a').length,
      }
    }, '*');
  });

  var origFetch = window.fetch;
  window.fetch = function(input, init) {
    if (typeof input === 'string' && !input.startsWith('http') && !input.startsWith('data:') && !input.startsWith('blob:')) {
      input = input.startsWith('/') ? ORIGIN + input : ORIGIN + '${basePath}' + input;
    }
    return origFetch.call(this, input, init);
  };
})();
</script>`;

      body = body.replace(/<head([^>]*)>/i, `<head$1>${baseTag}${proxyScript}`);

      if (!body.includes('<head')) {
        body = `<html><head>${baseTag}${proxyScript}</head><body>${body}</body></html>`;
      }
    }

    res.removeHeader("X-Frame-Options");
    res.removeHeader("Content-Security-Policy");
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-cache, no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("X-Proxy-Status", String(statusCode));
    res.setHeader("X-Proxy-Url", url);
    res.send(body);
  } catch (error: any) {
    const isTimeout = error.name === "AbortError";
    const errorHtml = `<!DOCTYPE html><html><head><style>
      body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0a;color:#fff}
      .box{text-align:center;max-width:420px;padding:40px}
      h2{color:#ef4444;font-size:1.25rem;margin-bottom:8px}
      p{color:#888;font-size:0.85rem;line-height:1.5}
      code{background:#1a1a2e;padding:2px 8px;border-radius:4px;font-size:0.8rem;color:#60a5fa}
      .retry{margin-top:16px;padding:8px 20px;background:#3b82f6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.85rem}
      .retry:hover{background:#2563eb}
    </style></head><body><div class="box">
      <h2>${isTimeout ? "Timeout" : "Erreur de connexion"}</h2>
      <p>${isTimeout ? "Le site n'a pas repondu dans les 15 secondes." : error.message}</p>
      <p>URL: <code>${req.query.url || ""}</code></p>
      <button class="retry" onclick="location.reload()">Reessayer</button>
    </div></body></html>`;
    res.removeHeader("X-Frame-Options");
    res.removeHeader("Content-Security-Policy");
    res.setHeader("Content-Type", "text/html");
    res.status(isTimeout ? 504 : 502).send(errorHtml);
  }
});

router.get("/proxy/check", async (req: Request, res: Response) => {
  try {
    const url = req.query.url as string;
    if (!url) return res.status(400).json({ error: "url required" });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": "UlysseBot/1.0" },
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const headers: Record<string, string> = {};
    resp.headers.forEach((v, k) => { headers[k] = v; });
    res.json({
      status: resp.status,
      statusText: resp.statusText,
      url: resp.url,
      redirected: resp.redirected,
      headers: {
        server: headers["server"] || null,
        contentType: headers["content-type"] || null,
        xPoweredBy: headers["x-powered-by"] || null,
        lastModified: headers["last-modified"] || null,
        cacheControl: headers["cache-control"] || null,
      },
      ssl: url.startsWith("https://"),
      reachable: true,
    });
  } catch (error: any) {
    res.json({
      status: 0,
      statusText: error.name === "AbortError" ? "Timeout" : error.message,
      reachable: false,
      ssl: (req.query.url as string)?.startsWith("https://") || false,
    });
  }
});

export default router;
