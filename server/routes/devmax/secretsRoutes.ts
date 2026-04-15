import { Router, Request, Response } from "express";
  import { db } from "../../db";
  import { sql } from "drizzle-orm";
  import { getProjectRepo, withRepoToken } from "./opsHelpers";
  import { logDevmaxActivity } from "./devmaxMiddleware";
  import { githubService, withGitHubToken } from "../../services/githubService";
  import { runSourceCodePreflight, runPreDeployTests, runPostDeployTests, checkDeployHealth } from "../../services/devmax/testService";
  
  const router = Router();

  router.get("/github-events/:projectId", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    const events = await db.execute(sql`
      SELECT * FROM devmax_github_events WHERE project_id = ${projectId} ORDER BY created_at DESC LIMIT ${limit}
    `).then((r: any) => r.rows || r);
    res.json({ events });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ══════════════════════════════════════════════════════════════
// FEATURE 3: Health Check Dashboard
// ══════════════════════════════════════════════════════════════

router.get("/health-checks/:appName", async (req: Request, res: Response) => {
  try {
    const { appName } = req.params;
    const hours = parseInt(req.query.hours as string) || 24;
    const since = new Date(Date.now() - hours * 3600000).toISOString();
    const checks = await db.execute(sql`
      SELECT * FROM devmax_health_checks WHERE app_name = ${appName} AND created_at >= ${since}
      ORDER BY created_at DESC LIMIT 200
    `).then((r: any) => r.rows || r);

    const total = checks.length;
    const healthy = checks.filter((c: any) => c.http_code >= 200 && c.http_code < 400).length;
    const alerts = checks.filter((c: any) => c.alert_sent).length;
    const avgResponseTime = total > 0 ? Math.round(checks.reduce((s: number, c: any) => s + (c.response_time_ms || 0), 0) / total) : 0;

    res.json({
      appName, hours,
      uptime: total > 0 ? Math.round((healthy / total) * 10000) / 100 : 100,
      totalChecks: total, healthyChecks: healthy, alerts,
      avgResponseTime,
      checks: checks.slice(0, 50),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ══════════════════════════════════════════════════════════════
// FEATURE 4: Secrets Management
// ══════════════════════════════════════════════════════════════

import { encryptSecret, decryptSecret } from "../../services/devmax/cryptoService";

router.get("/secrets/:projectId", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const secrets = await db.execute(sql`
      SELECT id, key, environment, last_rotated_at, accessed_count, last_accessed_at, created_by, created_at
      FROM devmax_secrets WHERE project_id = ${projectId} ORDER BY key
    `).then((r: any) => r.rows || r);
    res.json({ secrets });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/secrets/:projectId", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { key, value, environment } = req.body;
    if (!key || !value) return res.status(400).json({ error: "key et value requis" });
    const sanitizedKey = key.replace(/[^A-Z0-9_]/gi, "_").toUpperCase();
    const encrypted = encryptSecret(value);
    const session = (req as any).devmaxSession;

    await db.execute(sql`
      INSERT INTO devmax_secrets (project_id, key, encrypted_value, environment, created_by, last_rotated_at)
      VALUES (${projectId}, ${sanitizedKey}, ${encrypted}, ${environment || "all"}, ${session?.display_name || "system"}, NOW())
      ON CONFLICT (project_id, key, environment) DO UPDATE SET encrypted_value = ${encrypted}, last_rotated_at = NOW(), updated_at = NOW()
    `);

    await logDevmaxActivity(req, "secret_set", sanitizedKey, { environment: environment || "all" });
    res.json({ success: true, key: sanitizedKey });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/secrets/:projectId/reveal", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { secretId } = req.body;
    if (!secretId) return res.status(400).json({ error: "secretId requis" });

    const [secret] = await db.execute(sql`
      SELECT encrypted_value, key FROM devmax_secrets WHERE id = ${secretId} AND project_id = ${projectId}
    `).then((r: any) => r.rows || r);
    if (!secret) return res.status(404).json({ error: "Secret non trouvé" });

    await db.execute(sql`
      UPDATE devmax_secrets SET accessed_count = accessed_count + 1, last_accessed_at = NOW() WHERE id = ${secretId}
    `);

    await logDevmaxActivity(req, "secret_reveal", secret.key, { projectId });

    const decrypted = decryptSecret(secret.encrypted_value);
    res.json({ value: decrypted });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/secrets/:projectId/:secretId", async (req: Request, res: Response) => {
  try {
    const { projectId, secretId } = req.params;
    const [secret] = await db.execute(sql`
      SELECT key FROM devmax_secrets WHERE id = ${secretId} AND project_id = ${projectId}
    `).then((r: any) => r.rows || r);
    if (!secret) return res.status(404).json({ error: "Secret non trouvé" });

    await db.execute(sql`DELETE FROM devmax_secrets WHERE id = ${secretId} AND project_id = ${projectId}`);
    await logDevmaxActivity(req, "secret_delete", secret.key, { projectId });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/secrets/:projectId/sync", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { environment } = req.body;

    const [project] = await db.execute(sql`
      SELECT deploy_slug FROM devmax_projects WHERE id = ${projectId}
    `).then((r: any) => r.rows || r);
    if (!project?.deploy_slug) return res.status(400).json({ error: "Projet sans deploy_slug" });

    const secrets = await db.execute(sql`
      SELECT key, encrypted_value FROM devmax_secrets
      WHERE project_id = ${projectId} AND (environment = ${environment || "all"} OR environment = 'all')
    `).then((r: any) => r.rows || r);

    const { sshService } = await import("../../services/sshService");
    const appDir = `/var/www/apps/${project.deploy_slug}`;

    for (const secret of secrets) {
      const value = decryptSecret(secret.encrypted_value);
      await sshService.executeCommand(
        `cd ${appDir} && grep -q "^${secret.key}=" .env 2>/dev/null && sed -i "s|^${secret.key}=.*|${secret.key}=${value}|" .env || echo "${secret.key}=${value}" >> .env`,
        5000
      );
    }

    await logDevmaxActivity(req, "secrets_sync", project.deploy_slug, { count: secrets.length, environment });
    res.json({ success: true, synced: secrets.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ══════════════════════════════════════════════════════════════
// FEATURE 5: Deploy History with Diff
// ══════════════════════════════════════════════════════════════

router.get("/deploy-history/:projectId", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const limit = parseInt(req.query.limit as string) || 20;
    const deployments = await db.execute(sql`
      SELECT id, environment, trigger, commit_sha, prev_commit_sha, commit_message, branch, status, url,
        duration_ms, git_diff, files_changed, created_at
      FROM devmax_deployments WHERE project_id = ${projectId}
      ORDER BY created_at DESC LIMIT ${limit}
    `).then((r: any) => r.rows || r);
    res.json({ deployments });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/deploy-diff/:deployId", async (req: Request, res: Response) => {
  try {
    const { deployId } = req.params;
    const [deployment] = await db.execute(sql`
      SELECT d.*, p.repo_owner, p.repo_name, p.deploy_slug
      FROM devmax_deployments d JOIN devmax_projects p ON d.project_id = p.id
      WHERE d.id = ${parseInt(deployId)}
    `).then((r: any) => r.rows || r);
    if (!deployment) return res.status(404).json({ error: "Deploy non trouvé" });

    if (deployment.git_diff) {
      return res.json({ diff: deployment.git_diff, files: deployment.files_changed, fromCache: true });
    }

    if (deployment.commit_sha && deployment.prev_commit_sha && deployment.repo_owner && deployment.repo_name) {
      try {
        const token = await resolveProjectGitHubToken(deployment.project_id);
        const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
        if (token) headers.Authorization = `Bearer ${token}`;
        const compareRes = await fetch(
          `https://api.github.com/repos/${deployment.repo_owner}/${deployment.repo_name}/compare/${deployment.prev_commit_sha.slice(0, 7)}...${deployment.commit_sha.slice(0, 7)}`,
          { headers }
        );
        if (compareRes.ok) {
          const data = await compareRes.json() as any;
          const files = (data.files || []).map((f: any) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions }));
          const diff = `${data.ahead_by || 0} commits, ${files.length} files changed`;
          await db.execute(sql`
            UPDATE devmax_deployments SET git_diff = ${diff}, files_changed = ${JSON.stringify(files)} WHERE id = ${parseInt(deployId)}
          `).catch(() => {});
          return res.json({ diff, files, commits: data.ahead_by, totalAdditions: data.files?.reduce((s: number, f: any) => s + f.additions, 0), totalDeletions: data.files?.reduce((s: number, f: any) => s + f.deletions, 0) });
        }
      } catch {}
    }

    res.json({ diff: null, message: "Diff non disponible (commits manquants)" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/run-tests-protocol", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const projectId = req.headers["x-devmax-project"] as string;

    const { sshService } = await import("../../services/sshService");
    const appName = repo.deploySlug;
    const { environment = "staging", phase = "both" } = req.body || {};

    const results: { preDeployTests?: TestSuiteResult; postDeployTests?: TestSuiteResult } = {};

    if (phase === "pre" || phase === "both") {
      results.preDeployTests = await runPreDeployTests(appName, sshService);
    }

    if (phase === "post" || phase === "both") {
      const env = environment === "production" ? "production" : "staging";
      results.postDeployTests = await runPostDeployTests(appName, env as "staging" | "production", sshService);
    }

    const allTests = [...(results.preDeployTests?.tests || []), ...(results.postDeployTests?.tests || [])];
    const totalPassed = allTests.filter(t => t.pass).length;
    const totalFailed = allTests.filter(t => !t.pass).length;

    const lines: string[] = [];
    if (results.preDeployTests) {
      lines.push(`\n📋 PRE-DEPLOY (${results.preDeployTests.passed}/${results.preDeployTests.total}):`);
      results.preDeployTests.tests.forEach(t => lines.push(`  ${t.pass ? "✅" : "❌"} ${t.name}: ${t.detail}`));
    }
    if (results.postDeployTests) {
      lines.push(`\n🔍 POST-DEPLOY ${environment.toUpperCase()} (${results.postDeployTests.passed}/${results.postDeployTests.total}):`);
      results.postDeployTests.tests.forEach(t => lines.push(`  ${t.pass ? "✅" : "❌"} ${t.name}: ${t.detail}`));
    }

    if (projectId) {
      const { logDeployment } = await import("../devmaxWebhook");
      await logDeployment(projectId, {
        environment: environment as string,
        trigger: "test-protocol",
        branch: "main",
        status: totalFailed === 0 ? "success" : "warning",
        logs: lines,
        duration: (results.preDeployTests?.duration || 0) + (results.postDeployTests?.duration || 0),
      }).catch(() => {});
    }

    await logDevmaxActivity(req, "run-tests-protocol", environment, {
      phase,
      totalPassed,
      totalFailed,
      appName,
    });

    res.json({
      success: totalFailed === 0,
      appName,
      environment,
      phase,
      totalPassed,
      totalFailed,
      totalTests: allTests.length,
      ...results,
      summary: `${totalPassed}/${allTests.length} tests passed${totalFailed > 0 ? ` — ${totalFailed} failed` : ""}`,
      details: lines.join("\n"),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/db-files", async (req: Request, res: Response) => {
  try {
    const projectId = req.headers["x-devmax-project"] as string;
    if (!projectId) return res.status(400).json({ error: "Project ID required" });
    const branch = (req.query.branch as string) || "main";
    const dir = req.query.dir as string | undefined;
    const { devmaxFileStorage } = await import("../../services/devmaxFileStorage");
    const files = await devmaxFileStorage.listFiles(projectId, branch, dir);
    res.json({ files, branch });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/db-files/content", async (req: Request, res: Response) => {
  try {
    const projectId = req.headers["x-devmax-project"] as string;
    if (!projectId) return res.status(400).json({ error: "Project ID required" });
    const branch = (req.query.branch as string) || "main";
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: "path required" });
    const { devmaxFileStorage } = await import("../../services/devmaxFileStorage");
    const file = await devmaxFileStorage.getFile(projectId, branch, filePath);
    if (!file) return res.status(404).json({ error: "File not found" });
    res.json({ path: file.file_path, content: file.content, sha: file.sha, size: file.size });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/db-files", async (req: Request, res: Response) => {
  try {
    const projectId = req.headers["x-devmax-project"] as string;
    if (!projectId) return res.status(400).json({ error: "Project ID required" });
    const { branch, files } = req.body;
    if (!files || !Array.isArray(files)) return res.status(400).json({ error: "files array required" });
    const { devmaxFileStorage } = await import("../../services/devmaxFileStorage");
    const count = await devmaxFileStorage.saveBatch(projectId, branch || "main", files);
    res.json({ success: true, savedCount: count });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/db-files", async (req: Request, res: Response) => {
  try {
    const projectId = req.headers["x-devmax-project"] as string;
    if (!projectId) return res.status(400).json({ error: "Project ID required" });
    const { branch, path: filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: "path required" });
    const { devmaxFileStorage } = await import("../../services/devmaxFileStorage");
    await devmaxFileStorage.deleteFile(projectId, branch || "main", filePath);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/db-files/branches", async (req: Request, res: Response) => {
  try {
    const projectId = req.headers["x-devmax-project"] as string;
    if (!projectId) return res.status(400).json({ error: "Project ID required" });
    const { devmaxFileStorage } = await import("../../services/devmaxFileStorage");
    const branches = await devmaxFileStorage.listBranches(projectId);
    res.json({ branches: branches.length > 0 ? branches : ["main"] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/db-files/stats", async (req: Request, res: Response) => {
  try {
    const projectId = req.headers["x-devmax-project"] as string;
    if (!projectId) return res.status(400).json({ error: "Project ID required" });
    const branch = (req.query.branch as string) || "main";
    const { devmaxFileStorage } = await import("../../services/devmaxFileStorage");
    const stats = await devmaxFileStorage.getStats(projectId, branch);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/provision-db", async (req: Request, res: Response) => {
  try {
    const projectId = req.headers["x-devmax-project"] as string;
    if (!projectId) return res.status(400).json({ error: "Project ID requis" });

    const [proj] = await db.execute(sql`SELECT * FROM devmax_projects WHERE id = ${projectId}`).then((r: any) => r.rows || r).catch(() => [null]);
    if (!proj) return res.status(404).json({ error: "Projet non trouvé" });

    const planCheck = await checkPlanLimits(proj?.tenant_id, "deploy");
    if (!planCheck.allowed) return res.status(403).json({ error: planCheck.reason });

    if (proj.db_provisioned && proj.db_url) {
      return res.json({
        success: true,
        message: `Base de données déjà provisionnée: ${proj.db_name}`,
        dbName: proj.db_name,
        dbUser: proj.db_user,
        dbUrl: proj.db_url,
        alreadyProvisioned: true,
      });
    }

    const deploySlug = proj.deploy_slug || proj.name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    const safeSlug = deploySlug.replace(/-/g, "_");
    const dbName = req.body.dbName || `devmax_${safeSlug}_db`;
    const dbUser = req.body.dbUser || `devmax_${safeSlug}`;
    const crypto = await import("crypto");
    const dbPassword = req.body.dbPassword || crypto.randomBytes(16).toString("hex");

    const { sshService } = await import("../../services/sshService");
    const result = await sshService.createDatabase(dbName, dbUser, dbPassword);

    if (!result.success) {
      return res.status(500).json({ success: false, message: result.message });
    }

    await db.execute(sql`
      UPDATE devmax_projects 
      SET db_name = ${dbName}, db_user = ${dbUser}, db_password = ${dbPassword}, 
          db_url = ${result.connectionUrl}, db_provisioned = true, updated_at = NOW()
      WHERE id = ${projectId}
    `);

    await logDevmaxActivity(req, "provision-db", "main", { dbName, dbUser, success: true });

    res.json({
      success: true,
      message: result.message,
      dbName,
      dbUser,
      dbUrl: result.connectionUrl,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/provision-db/status", async (req: Request, res: Response) => {
  try {
    const projectId = req.headers["x-devmax-project"] as string;
    if (!projectId) return res.status(400).json({ error: "Project ID requis" });

    const [proj] = await db.execute(sql`
      SELECT db_name, db_user, db_url, db_provisioned FROM devmax_projects WHERE id = ${projectId}
    `).then((r: any) => r.rows || r).catch(() => [null]);
    if (!proj) return res.status(404).json({ error: "Projet non trouvé" });

    res.json({
      provisioned: !!proj.db_provisioned,
      dbName: proj.db_name || null,
      dbUser: proj.db_user || null,
      dbUrl: proj.db_url || null,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/check-url", async (req: Request, res: Response) => {
  try {
    const url = req.query.url as string;
    if (!url) return res.json({ accessible: false, error: "No URL" });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, { method: "HEAD", signal: controller.signal, redirect: "follow" });
      clearTimeout(timeout);
      const accessible = response.status >= 200 && response.status < 400;
      res.json({ accessible, status: response.status });
    } catch (e: any) {
      clearTimeout(timeout);
      res.json({ accessible: false, error: e.message?.slice(0, 100) });
    }
  } catch (error: any) {
    res.json({ accessible: false, error: error.message });
  }
});

router.get("/preview/:projectId/*", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const filePath = req.params[0] || "index.html";
    const branch = (req.query.branch as string) || "test";

    const { devmaxFileStorage } = await import("../../services/devmaxFileStorage");
    const file = await devmaxFileStorage.getFile(projectId, branch, filePath);

    if (!file) {
      if (filePath === "index.html" || filePath === "") {
        const files = await devmaxFileStorage.listFiles(projectId, branch);
        const htmlFiles = files.filter(f => f.path.endsWith(".html")).map(f => f.path);
        const indexFile = htmlFiles.find(f => f === "index.html") || htmlFiles[0];
        if (indexFile) {
          const fallback = await devmaxFileStorage.getFile(projectId, branch, indexFile);
          if (fallback) {
            res.set("Content-Type", "text/html; charset=utf-8");
            return res.send(fallback.content);
          }
        }
        const allFiles = files.filter(f => f.type === "file").map(f => f.path);
        const listing = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Preview — Fichiers Tests</title>
<style>body{font-family:system-ui;background:#0a0a0a;color:#e5e5e5;padding:2rem}
a{color:#22d3ee;text-decoration:none}a:hover{text-decoration:underline}
li{padding:4px 0}h2{color:#10b981}</style></head>
<body><h2>Fichiers Tests (${allFiles.length})</h2><ul>${allFiles.map(f => `<li><a href="/api/devmax/preview/${projectId}/${f}?branch=${branch}">${f}</a></li>`).join("")}</ul></body></html>`;
        res.set("Content-Type", "text/html; charset=utf-8");
        return res.send(listing);
      }
      return res.status(404).json({ error: `Fichier non trouvé: ${filePath}` });
    }

    const ext = filePath.split(".").pop()?.toLowerCase() || "";
    const mimeMap: Record<string, string> = {
      html: "text/html; charset=utf-8",
      htm: "text/html; charset=utf-8",
      css: "text/css; charset=utf-8",
      js: "application/javascript; charset=utf-8",
      mjs: "application/javascript; charset=utf-8",
      ts: "application/typescript; charset=utf-8",
      tsx: "application/typescript; charset=utf-8",
      jsx: "application/javascript; charset=utf-8",
      json: "application/json; charset=utf-8",
      svg: "image/svg+xml",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      ico: "image/x-icon",
      woff: "font/woff",
      woff2: "font/woff2",
      ttf: "font/ttf",
      txt: "text/plain; charset=utf-8",
      md: "text/markdown; charset=utf-8",
      xml: "application/xml; charset=utf-8",
    };
    const contentType = mimeMap[ext] || "application/octet-stream";
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.send(file.content);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});


  export default router;
  