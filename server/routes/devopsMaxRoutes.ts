import { Router, Request, Response } from "express";
import { githubService, withGitHubToken } from "../services/githubService";
import { requireDevmaxAuth, logDevmaxActivity, getProjectGitHubToken, checkPlanLimits, sendDevmaxNotification } from "./devmaxAuth";
import { db } from "../db";
import { devmaxSessions, dgmSessions, dgmTasks, dgmPipelineRuns } from "@shared/schema";
import { eq, and, gt, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";

const router = Router();

router.use(requireDevmaxAuth);

const tokenValidityCache: Record<string, { valid: boolean; checkedAt: number }> = {};

async function isTokenValid(token: string): Promise<boolean> {
  const cached = tokenValidityCache[token];
  if (cached && Date.now() - cached.checkedAt < 5 * 60 * 1000) return cached.valid;
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    const valid = res.ok;
    tokenValidityCache[token] = { valid, checkedAt: Date.now() };
    return valid;
  } catch {
    tokenValidityCache[token] = { valid: false, checkedAt: Date.now() };
    return false;
  }
}

async function resolveProjectGitHubToken(projectId: string): Promise<string | null> {
  try {
    const [project] = await db.execute(sql`
      SELECT github_token, github_provider, tenant_id, repo_owner FROM devmax_projects WHERE id = ${projectId}
    `).then((r: any) => r.rows || r);
    if (project?.github_token) {
      if (await isTokenValid(project.github_token)) return project.github_token;
      console.warn(`[DevMaxOps] Project token expired for ${projectId}, trying fallbacks`);
    }
    if (project?.tenant_id) {
      const [tenant] = await db.execute(sql`
        SELECT github_token FROM devmax_tenants WHERE id = ${project.tenant_id} AND github_token IS NOT NULL
      `).then((r: any) => r.rows || r);
      if (tenant?.github_token) return tenant.github_token;
    }
    if (project?.repo_owner) {
      const tenantRows = await db.execute(sql`
        SELECT github_token FROM devmax_tenants WHERE github_org = ${project.repo_owner} AND github_token IS NOT NULL LIMIT 1
      `).then((r: any) => r.rows || r);
      if (tenantRows?.[0]?.github_token) return tenantRows[0].github_token;
    }
  } catch (e: any) {
    console.warn(`[DevMaxOps] Token resolution failed for project ${projectId}:`, e.message);
  }
  if (process.env.MAURICE_GITHUB_PAT) return process.env.MAURICE_GITHUB_PAT;
  return null;
}

interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

interface TestSuiteResult {
  phase: "pre-deploy" | "post-deploy" | "on-demand";
  passed: number;
  failed: number;
  total: number;
  tests: TestResult[];
  duration: number;
  blocking: boolean;
}

async function runSourceCodePreflight(
  repoOwner: string,
  repoName: string,
  githubToken: string | null,
  logs: string[]
): Promise<{ pass: boolean; issues: string[]; fixes: string[]; blocking: boolean }> {
  const issues: string[] = [];
  const fixes: string[] = [];

  try {
    const { default: githubServiceMod } = await import("../services/github/githubService");
    const gs = githubServiceMod;

    const fetchFile = async (path: string): Promise<string | null> => {
      try {
        const result = await gs.getFileContent(repoOwner, repoName, path, githubToken || undefined);
        if (result && typeof result === "object" && "content" in result) {
          return Buffer.from((result as any).content, "base64").toString("utf8");
        }
        return typeof result === "string" ? result : null;
      } catch { return null; }
    };

    const pkgContent = await fetchFile("package.json");
    if (!pkgContent) {
      issues.push("package.json introuvable dans le repo");
      return { pass: false, issues, fixes, blocking: true };
    }

    let pkg: any;
    try { pkg = JSON.parse(pkgContent); } catch {
      issues.push("package.json invalide (JSON mal formé)");
      return { pass: false, issues, fixes, blocking: true };
    }

    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const scripts = pkg.scripts || {};
    const buildScript: string = scripts.build || "";
    const startScript: string = scripts.start || "";

    if (!buildScript && !startScript) {
      issues.push("Ni script 'build' ni script 'start' dans package.json");
    }

    if (buildScript) {
      let scanContent = buildScript;

      const buildFileMatch = buildScript.match(/(?:tsx|ts-node|node)\s+([^\s&|;]+\.\w+)/);
      if (buildFileMatch) {
        const buildFileContent = await fetchFile(buildFileMatch[1]);
        if (buildFileContent) {
          scanContent += " " + buildFileContent;
          logs.push(`[PREFLIGHT] Scanning build file: ${buildFileMatch[1]}`);
        }
      }

      const buildToolChecks: { tool: string; pkg: string; match: RegExp }[] = [
        { tool: "tsx", pkg: "tsx", match: /\btsx\b/ },
        { tool: "tsc", pkg: "typescript", match: /\btsc\b/ },
        { tool: "vite", pkg: "vite", match: /\bvite\b/ },
        { tool: "esbuild", pkg: "esbuild", match: /\besbuild\b/ },
        { tool: "next", pkg: "next", match: /\bnext\b/ },
        { tool: "nuxt", pkg: "nuxt", match: /\bnuxt\b/ },
        { tool: "webpack", pkg: "webpack", match: /\bwebpack\b/ },
      ];

      for (const { tool, pkg: pkgName, match } of buildToolChecks) {
        if (!match.test(scanContent)) continue;
        const inDeps = allDeps[pkgName];
        if (!inDeps) {
          issues.push(`Build utilise "${tool}" mais "${pkgName}" n'est pas dans les dépendances`);
          fixes.push(`Ajouter "${pkgName}" aux devDependencies`);
        }
      }

      if (scanContent !== buildScript) {
        const buildImportPattern = /from\s+['"]([^'"./][^'"]*)['"]/g;
        const requirePattern = /require\s*\(\s*['"]([^'"./][^'"]*)['"]\s*\)/g;
        for (const pat of [buildImportPattern, requirePattern]) {
          let m;
          while ((m = pat.exec(scanContent)) !== null) {
            const pkgImport = m[1].startsWith("@") ? m[1].split("/").slice(0, 2).join("/") : m[1].split("/")[0];
            if (pkgImport === "node" || pkgImport.startsWith("node:")) continue;
            if (!allDeps[pkgImport]) {
              issues.push(`Build file importe "${pkgImport}" mais absent du package.json`);
              fixes.push(`Ajouter "${pkgImport}" aux devDependencies`);
            }
          }
        }
      }
    }

    const importPattern = /from\s+['"]([^'"./][^'"]*)['"]/g;
    const coreFiles = ["server/index.ts", "src/index.ts", "src/app.ts", "server/app.ts", "index.ts"];
    const detectedImports = new Set<string>();

    for (const file of coreFiles) {
      const content = await fetchFile(file);
      if (!content) continue;
      let m;
      while ((m = importPattern.exec(content)) !== null) {
        const pkgImport = m[1].startsWith("@") ? m[1].split("/").slice(0, 2).join("/") : m[1].split("/")[0];
        if (!["node", "fs", "path", "http", "https", "crypto", "util", "os", "url", "stream", "events", "child_process", "buffer", "net", "dns", "tls", "zlib", "querystring", "assert", "readline"].includes(pkgImport)) {
          detectedImports.add(pkgImport);
        }
      }
    }

    for (const imp of detectedImports) {
      if (!allDeps[imp]) {
        issues.push(`"${imp}" importé dans le code mais absent du package.json`);
        fixes.push(`Ajouter "${imp}" aux dependencies`);
      }
    }

    if (startScript.includes("dist/") || startScript.includes("build/")) {
      if (!buildScript) {
        issues.push(`Le script start attend un dossier dist/build mais aucun script build n'est défini`);
        fixes.push(`Ajouter un script "build" dans package.json`);
      }
    }

    const hasLockFile = await fetchFile("package-lock.json");
    if (!hasLockFile) {
      logs.push(`[PREFLIGHT] ⚠️ Pas de package-lock.json — l'install utilisera npm install au lieu de npm ci`);
    }

    if (issues.length > 0) {
      logs.push(`[PREFLIGHT] ⚠️ ${issues.length} problème(s) détecté(s):`);
      issues.forEach(i => logs.push(`  ❌ ${i}`));
      if (fixes.length > 0) {
        logs.push(`[PREFLIGHT] 🔧 Corrections suggérées:`);
        fixes.forEach(f => logs.push(`  → ${f}`));
      }
    } else {
      logs.push(`[PREFLIGHT] ✅ Code source validé — aucun problème détecté`);
    }

    const blocking = issues.some(i =>
      i.includes("introuvable") || i.includes("invalide") || i.includes("ni script")
    );

    return { pass: issues.length === 0, issues, fixes, blocking };
  } catch (err: any) {
    logs.push(`[PREFLIGHT] Erreur: ${err.message?.slice(0, 200)}`);
    return { pass: true, issues: [], fixes: [], blocking: false };
  }
}

async function runPreDeployTests(appName: string, sshService: any): Promise<TestSuiteResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  const appDir = `/var/www/apps/${appName}`;
  const devAppDir = `/var/www/apps/${appName}-dev`;

  const targetDir = await sshService.executeCommand(`test -d ${devAppDir} && echo "dev" || (test -d ${appDir} && echo "prod" || echo "none")`, 5000);
  const resolvedDir = targetDir.output?.trim() === "dev" ? devAppDir : targetDir.output?.trim() === "prod" ? appDir : null;

  if (!resolvedDir) {
    tests.push({ name: "App directory exists", pass: false, detail: `Neither ${appDir} nor ${devAppDir} found` });
    return { phase: "pre-deploy", passed: 0, failed: 1, total: 1, tests, duration: Date.now() - start, blocking: true };
  }
  tests.push({ name: "App directory exists", pass: true, detail: resolvedDir });

  const pkgCheck = await sshService.executeCommand(`test -f ${resolvedDir}/package.json && echo "yes" || echo "no"`, 5000);
  tests.push({ name: "package.json exists", pass: pkgCheck.output?.trim() === "yes", detail: pkgCheck.output?.trim() === "yes" ? "OK" : "Missing" });

  const scriptCheck = await sshService.executeCommand(
    `cd ${resolvedDir} && node -e "const p=require('./package.json'); const s=p.scripts||{}; console.log(JSON.stringify({test:!!s.test,vitest:!!s.vitest,lint:!!s.lint,typecheck:!!s.typecheck||!!s['type-check'],build:!!s.build}))" 2>/dev/null || echo '{}'`,
    5000
  );
  let scripts: any = {};
  try { scripts = JSON.parse(scriptCheck.output || "{}"); } catch {}

  if (scripts.lint) {
    const lintResult = await sshService.executeCommand(`cd ${resolvedDir} && npm run lint 2>&1 | tail -20`, 60000);
    tests.push({ name: "Lint check", pass: lintResult.success, detail: lintResult.success ? "No errors" : (lintResult.output || lintResult.error || "").slice(-200) });
  }

  if (scripts.typecheck || scripts["type-check"]) {
    const cmd = scripts.typecheck ? "typecheck" : "type-check";
    const tcResult = await sshService.executeCommand(`cd ${resolvedDir} && npm run ${cmd} 2>&1 | tail -20`, 60000);
    tests.push({ name: "TypeScript check", pass: tcResult.success, detail: tcResult.success ? "No errors" : (tcResult.output || tcResult.error || "").slice(-200) });
  }

  if (scripts.test || scripts.vitest) {
    const testCmd = scripts.vitest ? "vitest" : "test";
    const testResult = await sshService.executeCommand(`cd ${resolvedDir} && npm run ${testCmd} -- --run 2>&1 | tail -30`, 120000);
    const output = testResult.output || "";
    const passMatch = output.match(/(\d+)\s+passed/);
    const failMatch = output.match(/(\d+)\s+failed/);
    const unitPassed = passMatch ? parseInt(passMatch[1]) : 0;
    const unitFailed = failMatch ? parseInt(failMatch[1]) : 0;
    tests.push({
      name: "Unit/integration tests",
      pass: unitFailed === 0 && testResult.success,
      detail: `${unitPassed} passed, ${unitFailed} failed${unitFailed > 0 ? ": " + output.split("\n").filter((l: string) => l.includes("FAIL") || l.includes("×")).slice(0, 5).join("; ") : ""}`,
    });
  }

  if (scripts.build) {
    const buildCheck = await sshService.executeCommand(`cd ${resolvedDir} && npm run build --dry-run 2>&1 | tail -5 || echo "build-check-skip"`, 10000);
    tests.push({ name: "Build script available", pass: true, detail: "build script present" });
  }

  const envCheck = await sshService.executeCommand(`test -f ${resolvedDir}/.env && echo "yes" || echo "no"`, 5000);
  tests.push({ name: "Environment file (.env)", pass: envCheck.output?.trim() === "yes", detail: envCheck.output?.trim() === "yes" ? "Present" : "Missing (may use PM2 config)" });

  const passed = tests.filter(t => t.pass).length;
  const failed = tests.filter(t => !t.pass).length;
  return { phase: "pre-deploy", passed, failed, total: tests.length, tests, duration: Date.now() - start, blocking: failed > 0 && tests.some(t => !t.pass && (t.name.includes("Unit") || t.name.includes("Lint"))) };
}

async function runPostDeployTests(appName: string, environment: "staging" | "production", sshService: any): Promise<TestSuiteResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  const suffix = environment === "staging" ? "-dev" : "";
  const appDir = `/var/www/apps/${appName}${suffix}`;
  const domain = environment === "staging" ? `${appName}-dev.ulyssepro.org` : `${appName}.ulyssepro.org`;

  const pm2Check = await sshService.executeCommand(`pm2 jlist 2>/dev/null || echo '[]'`, 10000);
  try {
    const procs = JSON.parse(pm2Check.output || "[]");
    const proc = procs.find((p: any) => p.name === `${appName}${suffix}` || p.name === appName);
    const isOnline = proc?.pm2_env?.status === "online";
    tests.push({ name: "PM2 process online", pass: !!isOnline, detail: `status=${proc?.pm2_env?.status || "not found"}, name=${proc?.name || "N/A"}` });
  } catch {
    tests.push({ name: "PM2 process online", pass: false, detail: "Cannot parse PM2 status" });
  }

  const portCheck = await sshService.executeCommand(
    `grep -rhoP 'PORT.*?\\K[0-9]{4,5}' ${appDir}/.env ${appDir}/ecosystem.config.cjs 2>/dev/null | head -1 || echo "0"`,
    5000
  );
  const port = portCheck.output?.trim() || "0";
  if (port !== "0") {
    const localHealth = await sshService.executeCommand(`curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:${port}/ 2>/dev/null || echo '000'`, 15000);
    const httpCode = localHealth.output?.trim() || "000";
    tests.push({ name: "Local HTTP response", pass: parseInt(httpCode) >= 200 && parseInt(httpCode) < 500, detail: `HTTP ${httpCode} on port ${port}` });
  }

  const nginxCheck = await sshService.executeCommand(`test -f /etc/nginx/sites-enabled/${domain} && echo "yes" || (test -f /etc/nginx/sites-enabled/${appName}${suffix} && echo "yes" || echo "no")`, 5000);
  tests.push({ name: "Nginx config exists", pass: nginxCheck.output?.trim() === "yes", detail: nginxCheck.output?.trim() === "yes" ? `Config for ${domain}` : "Missing" });

  const externalUrl = `https://${domain}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const extCheck = await fetch(externalUrl, { signal: controller.signal, redirect: "follow" }).catch(() => null);
    clearTimeout(timeout);
    if (extCheck) {
      tests.push({ name: "External HTTPS accessible", pass: extCheck.status >= 200 && extCheck.status < 500, detail: `HTTP ${extCheck.status} — ${externalUrl}` });
    } else {
      tests.push({ name: "External HTTPS accessible", pass: false, detail: `Timeout/unreachable — ${externalUrl}` });
    }
  } catch {
    tests.push({ name: "External HTTPS accessible", pass: false, detail: `Error — ${externalUrl}` });
  }

  const sslCheck = await sshService.executeCommand(`echo | openssl s_client -servername ${domain} -connect ${domain}:443 2>/dev/null | openssl x509 -noout -dates 2>/dev/null | grep notAfter || echo "no-ssl"`, 10000);
  const sslOutput = sslCheck.output?.trim() || "no-ssl";
  tests.push({ name: "SSL certificate valid", pass: sslOutput !== "no-ssl", detail: sslOutput !== "no-ssl" ? sslOutput : "No valid SSL cert" });

  const logsCheck = await sshService.executeCommand(`pm2 logs ${appName}${suffix || ""} --nostream --lines 20 2>/dev/null | grep -ciE "error|exception|fatal|crash" || echo "0"`, 10000);
  const errorCount = parseInt(logsCheck.output?.trim() || "0");
  tests.push({ name: "Recent error logs", pass: errorCount < 5, detail: `${errorCount} error lines in last 20 log lines${errorCount >= 5 ? " ⚠️" : ""}` });

  const passed = tests.filter(t => t.pass).length;
  const failed = tests.filter(t => !t.pass).length;
  return { phase: "post-deploy", passed, failed, total: tests.length, tests, duration: Date.now() - start, blocking: false };
}

async function checkDeployHealth(url: string, sshService: any, maxRetries = 3): Promise<{ accessible: boolean; status: string }> {
  const urlObj = new URL(url);
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (attempt > 1) await new Promise(r => setTimeout(r, 3000));
    try {
      const vpsCheck = await sshService.executeCommand(
        `curl -skI --max-time 5 https://127.0.0.1 -H "Host: ${urlObj.hostname}" 2>&1 | head -1 || curl -sI --max-time 5 http://127.0.0.1 -H "Host: ${urlObj.hostname}" 2>&1 | head -1`,
        12000
      );
      const vpsLine = (vpsCheck.output || "").trim();
      if (vpsLine.match(/[23]\d{2}/)) {
        const statusCode = vpsLine.match(/(\d{3})/)?.[1] || "200";
        return { accessible: true, status: `HTTP ${statusCode} (VPS OK)` };
      }
    } catch {}
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const extCheck = await fetch(url, { signal: controller.signal, redirect: "follow" }).catch(() => null);
      clearTimeout(timeout);
      if (extCheck && extCheck.status >= 200 && extCheck.status < 500) {
        return { accessible: true, status: `HTTP ${extCheck.status}` };
      }
      if (extCheck) {
        return { accessible: false, status: `HTTP ${extCheck.status}` };
      }
    } catch {}
  }
  return { accessible: false, status: "timeout/unreachable after retries" };
}

async function getProjectRepo(req: Request, res: Response): Promise<{ owner: string; name: string; deploySlug: string; githubToken: string | null } | null> {
  const projectId = req.headers["x-devmax-project"] as string;
  if (!projectId) {
    res.status(400).json({ error: "Project ID requis (header x-devmax-project)" });
    return null;
  }

  const session = (req as any).devmaxSession;
  if (!session) {
    res.status(401).json({ error: "Session invalide" });
    return null;
  }

  const project = await db.execute(sql`
    SELECT * FROM devmax_projects 
    WHERE id = ${projectId}
  `);

  if (!project.rows?.length) {
    res.status(404).json({ error: "Projet non trouve ou acces interdit" });
    return null;
  }

  const p = project.rows[0] as any;
  if (!p.repo_owner || !p.repo_name) {
    res.status(400).json({ error: "Ce projet n'a pas de repo GitHub configure" });
    return null;
  }

  await db.execute(sql`UPDATE devmax_projects SET updated_at = NOW() WHERE id = ${projectId}`);

  const githubToken = await resolveProjectGitHubToken(projectId);

  const deploySlug = p.deploy_slug || p.repo_name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return { owner: p.repo_owner, name: p.repo_name, deploySlug, githubToken };
}

function withRepoToken<T>(token: string | null, fn: () => Promise<T>): Promise<T> {
  if (token) return withGitHubToken(token, fn);
  return fn();
}

router.get("/repo", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const result = await withRepoToken(repo.githubToken, async () => {
      const [repoData, languages] = await Promise.all([
        githubService.getRepo(repo.owner, repo.name),
        githubService.getRepoLanguages(repo.owner, repo.name).catch(() => ({}))
      ]);
      return { ...repoData, languages, deploySlug: repo.deploySlug };
    });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/branches", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const branches = await withRepoToken(repo.githubToken, () => githubService.listBranches(repo.owner, repo.name));
    res.json(branches);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/branches", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const { branchName, fromBranch } = req.body;
    const result = await withRepoToken(repo.githubToken, async () => {
      const sourceBranch = await githubService.getBranch(repo.owner, repo.name, fromBranch || "main");
      return githubService.createBranch(repo.owner, repo.name, branchName, sourceBranch.commit.sha);
    });
    await logDevmaxActivity(req, "create_branch", branchName, { fromBranch });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/branches/:branch(*)", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const branchName = req.params.branch;
    await withRepoToken(repo.githubToken, () => githubService.deleteBranch(repo.owner, repo.name, branchName));
    await logDevmaxActivity(req, "delete_branch", branchName);
    res.json({ success: true });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.get("/commits", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const { branch, per_page } = req.query;
    const commits = await withRepoToken(repo.githubToken, () =>
      githubService.listCommits(repo.owner, repo.name, branch as string, parseInt(per_page as string) || 20)
    );
    res.json(commits);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/commits/:sha", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const data = await withRepoToken(repo.githubToken, () =>
      githubService.githubApi(`/repos/${repo.owner}/${repo.name}/commits/${req.params.sha}`)
    );
    res.json(data);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.get("/tree/:branch", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const tree = await withRepoToken(repo.githubToken, async () => {
      const branchData = await githubService.getBranch(repo.owner, repo.name, req.params.branch);
      return githubService.getTree(repo.owner, repo.name, branchData.commit.sha);
    });
    res.json(tree);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/contents/*", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const filePath = req.params[0];
    const { ref } = req.query;
    const content = await withRepoToken(repo.githubToken, () =>
      githubService.getFileContent(repo.owner, repo.name, filePath, ref as string)
    );
    res.json(content);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/contents/*", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const filePath = req.params[0];
    const { content, message, branch, sha, isBase64 } = req.body;

    const targetBranch = branch || "main";
    if (content) {
      const { devopsIntelligenceEngine } = await import("../services/devopsIntelligenceEngine");
      const decodedContent = isBase64 ? Buffer.from(content, "base64").toString("utf-8") : content;
      let originalContent: string | undefined;
      try {
        const existing = await withRepoToken(repo.githubToken, () =>
          githubService.getFileContent(repo.owner, repo.name, filePath, targetBranch)
        );
        if ((existing as any)?.content) {
          originalContent = Buffer.from((existing as any).content, "base64").toString("utf-8");
        }
      } catch {}

      const analysis = devopsIntelligenceEngine.deepCodeAnalysis(
        [{ path: filePath, content: decodedContent, originalContent }],
        targetBranch
      );

      if (analysis.blocked) {
        await logDevmaxActivity(req, "update_file_BLOCKED", filePath, { branch: targetBranch, riskScore: analysis.riskScore, destructiveScore: analysis.destructiveScore });
        return res.status(403).json({
          blocked: true,
          error: "Modification BLOQUÉE par l'analyse de code profonde",
          analysis: {
            summary: analysis.summary,
            riskScore: analysis.riskScore,
            destructiveScore: analysis.destructiveScore,
            warnings: analysis.warnings.slice(0, 10),
            structuralIssues: analysis.structuralIssues,
            recommendations: analysis.recommendations,
          }
        });
      }

      if (analysis.forceBranch && ["main", "master", "production", "prod"].includes(targetBranch)) {
        const safeBranch = `maxai/update-${Date.now()}`;
        await withRepoToken(repo.githubToken, () =>
          githubService.createBranch(repo.owner, repo.name, safeBranch, targetBranch)
        );
        const result = await withRepoToken(repo.githubToken, () =>
          githubService.createOrUpdateFile(repo.owner, repo.name, filePath, content, message || `Update ${filePath}`, safeBranch, sha)
        );
        let pr: any = null;
        try {
          pr = await withRepoToken(repo.githubToken, () =>
            githubService.createPullRequest(repo.owner, repo.name,
              `[MaxAI] ${message || `Update ${filePath}`}`,
              `## Analyse de code\nRisque: ${analysis.riskScore}/100\nDestructif: ${analysis.destructiveScore}\n\n${analysis.warnings.map((w: string) => `- ${w}`).join("\n")}`,
              safeBranch, targetBranch
            )
          );
        } catch {}
        await logDevmaxActivity(req, "update_file_redirected", filePath, { branch: safeBranch, riskScore: analysis.riskScore });
        return res.json({ success: true, redirected: true, branch: safeBranch, pr: pr ? { number: (pr as any).number } : null, analysis: { score: analysis.riskScore, level: analysis.riskLevel } });
      }
    }

    const result = await withRepoToken(repo.githubToken, async () => {
      if (isBase64) {
        return githubService.createOrUpdateFileRaw(repo.owner, repo.name, filePath, content, message, branch, sha);
      }
      return githubService.createOrUpdateFile(repo.owner, repo.name, filePath, content, message, branch, sha);
    });
    await logDevmaxActivity(req, "update_file", filePath, { branch });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/contents/*", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const filePath = req.params[0];
    const { message, branch } = req.body;
    const targetBranch = branch || "main";

    let defaultBranch = "main";
    try {
      const repoInfo = await withRepoToken(repo.githubToken, () => githubService.getRepo(repo.owner, repo.name));
      defaultBranch = (repoInfo as any).default_branch || "main";
    } catch {}

    const isOnDefault = targetBranch === defaultBranch || ["main", "master", "production", "prod"].includes(targetBranch);
    if (isOnDefault) {
      const basename = filePath.split("/").pop() || "";
      const { devopsIntelligenceEngine } = await import("../services/devopsIntelligenceEngine");
      const fragile = devopsIntelligenceEngine.findFragileModule(basename);
      if (fragile && fragile.fragility >= 50) {
        await logDevmaxActivity(req, "delete_file_BLOCKED", filePath, { branch: targetBranch, fragility: fragile.fragility });
        return res.status(403).json({
          blocked: true,
          error: `Suppression BLOQUÉE: ${basename} est un module critique (fragilité ${fragile.fragility}/100)`,
          reason: fragile.reason
        });
      }

      const safeBranch = `maxai/delete-${Date.now()}`;
      await withRepoToken(repo.githubToken, () => githubService.createBranch(repo.owner, repo.name, safeBranch, targetBranch));
      const result = await withRepoToken(repo.githubToken, () =>
        githubService.deleteFile(repo.owner, repo.name, filePath, message || `Delete ${filePath}`, safeBranch)
      );
      let pr: any = null;
      try {
        pr = await withRepoToken(repo.githubToken, () =>
          githubService.createPullRequest(repo.owner, repo.name,
            `[MaxAI] Delete ${filePath}`,
            `Suppression de \`${filePath}\` redirigée vers branche de sécurité.`,
            safeBranch, targetBranch
          )
        );
      } catch {}
      await logDevmaxActivity(req, "delete_file_redirected", filePath, { branch: safeBranch });
      return res.json({ success: true, redirected: true, branch: safeBranch, pr: pr ? { number: (pr as any).number } : null, result });
    }

    const result = await withRepoToken(repo.githubToken, () =>
      githubService.deleteFile(repo.owner, repo.name, filePath, message || `Delete ${filePath}`, targetBranch)
    );
    await logDevmaxActivity(req, "delete_file", filePath, { branch: targetBranch });
    res.json({ success: true, result });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.post("/patch", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const { branch, files, commitMessage } = req.body;
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "files array required" });
    }
    if (!branch || !commitMessage) {
      return res.status(400).json({ error: "branch and commitMessage required" });
    }

    const { devopsIntelligenceEngine } = await import("../services/devopsIntelligenceEngine");
    const filesWithOriginals = await Promise.all(files.map(async (f: any) => {
      let originalContent: string | undefined;
      try {
        const existing = await withRepoToken(repo.githubToken, () =>
          githubService.getFileContent(repo.owner, repo.name, f.path, branch)
        );
        if ((existing as any)?.content) {
          originalContent = Buffer.from((existing as any).content, "base64").toString("utf-8");
        }
      } catch {}
      return { path: f.path, content: f.content, originalContent };
    }));

    const analysis = devopsIntelligenceEngine.deepCodeAnalysis(filesWithOriginals, branch);

    if (analysis.blocked) {
      await logDevmaxActivity(req, "apply_patch_BLOCKED", branch, { filesCount: files.length, riskScore: analysis.riskScore, destructiveScore: analysis.destructiveScore });
      return res.status(403).json({
        blocked: true,
        error: "Patch BLOQUÉ par l'analyse de code profonde",
        analysis: {
          summary: analysis.summary,
          riskScore: analysis.riskScore,
          destructiveScore: analysis.destructiveScore,
          warnings: analysis.warnings.slice(0, 10),
          structuralIssues: analysis.structuralIssues,
          recommendations: analysis.recommendations,
        }
      });
    }

    if (analysis.forceBranch && ["main", "master", "production", "prod"].includes(branch)) {
      const safeBranch = `maxai/patch-${Date.now()}`;
      await withRepoToken(repo.githubToken, () =>
        githubService.createBranch(repo.owner, repo.name, safeBranch, branch)
      );
      const result = await withRepoToken(repo.githubToken, () =>
        githubService.applyPatch(repo.owner, repo.name, safeBranch, files, commitMessage)
      );
      let pr: any = null;
      try {
        pr = await withRepoToken(repo.githubToken, () =>
          githubService.createPullRequest(repo.owner, repo.name,
            `[MaxAI] ${commitMessage}`,
            `## Analyse de code profonde\nRisque: ${analysis.riskScore}/100 (${analysis.riskLevel})\nDestructif: ${analysis.destructiveScore}\nFichiers: ${files.length}\n\n${analysis.warnings.map((w: string) => `- ${w}`).join("\n")}`,
            safeBranch, branch
          )
        );
      } catch {}
      await logDevmaxActivity(req, "apply_patch_redirected", safeBranch, { filesCount: files.length, riskScore: analysis.riskScore });
      return res.json({
        success: true,
        redirected: true,
        branch: safeBranch,
        pr: pr ? { number: (pr as any).number, url: (pr as any).html_url } : null,
        result,
        analysis: { score: analysis.riskScore, level: analysis.riskLevel, destructiveScore: analysis.destructiveScore }
      });
    }

    const result = await withRepoToken(repo.githubToken, () =>
      githubService.applyPatch(repo.owner, repo.name, branch, files, commitMessage)
    );
    await logDevmaxActivity(req, "apply_patch", branch, { filesCount: files.length, commitMessage, riskScore: analysis.riskScore });
    res.json({ ...result, analysis: { score: analysis.riskScore, level: analysis.riskLevel, destructiveScore: analysis.destructiveScore } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/pulls", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const { state } = req.query;
    const pulls = await withRepoToken(repo.githubToken, () =>
      githubService.listPullRequests(repo.owner, repo.name, state as string || "open")
    );
    res.json(pulls);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/pulls", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const { title, body, head, base } = req.body;
    const pr = await withRepoToken(repo.githubToken, () =>
      githubService.createPullRequest(repo.owner, repo.name, title, body || "", head, base || "main")
    );
    await logDevmaxActivity(req, "create_pr", title, { head, base });
    res.json(pr);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/pulls/:pull_number/merge", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const { merge_method } = req.body;
    const result = await withRepoToken(repo.githubToken, () =>
      githubService.mergePullRequest(repo.owner, repo.name, parseInt(req.params.pull_number), merge_method || "squash")
    );
    await logDevmaxActivity(req, "merge_pr", `#${req.params.pull_number}`);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/actions/runs", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const runs = await withRepoToken(repo.githubToken, () =>
      githubService.listWorkflowRuns(repo.owner, repo.name)
    );
    res.json(runs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/actions/workflows", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const workflows = await withRepoToken(repo.githubToken, () =>
      githubService.listWorkflows(repo.owner, repo.name)
    );
    res.json(workflows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/actions/workflows/:workflow_id/dispatches", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const { ref, inputs } = req.body;
    await withRepoToken(repo.githubToken, () =>
      githubService.triggerWorkflow(repo.owner, repo.name, req.params.workflow_id, ref || "main", inputs)
    );
    await logDevmaxActivity(req, "trigger_workflow", req.params.workflow_id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/actions/runs/:run_id/rerun", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    await withRepoToken(repo.githubToken, () =>
      githubService.rerunWorkflow(repo.owner, repo.name, parseInt(req.params.run_id))
    );
    await logDevmaxActivity(req, "rerun_workflow", req.params.run_id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/actions/runs/:run_id/cancel", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    await withRepoToken(repo.githubToken, () =>
      githubService.cancelWorkflowRun(repo.owner, repo.name, parseInt(req.params.run_id))
    );
    await logDevmaxActivity(req, "cancel_workflow", req.params.run_id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/rollback", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const { branch, targetSha, createBackup } = req.body;
    if (!branch || !targetSha) {
      return res.status(400).json({ error: "branch and targetSha are required" });
    }
    const result = await withRepoToken(repo.githubToken, async () => {
      let backupBranch: string | null = null;
      if (createBackup !== false) {
        const branchData = await githubService.getBranch(repo.owner, repo.name, branch);
        const currentSha = branchData.commit.sha;
        backupBranch = `backup/${branch}/${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
        await githubService.createBranch(repo.owner, repo.name, backupBranch, currentSha);
      }
      await githubService.forcePushBranch(repo.owner, repo.name, branch, targetSha);
      const commit = await githubService.getCommit(repo.owner, repo.name, targetSha);
      return { backupBranch, commit };
    });
    await logDevmaxActivity(req, "rollback", branch, { targetSha, backupBranch: result.backupBranch });
    res.json({
      success: true,
      rolledBackTo: targetSha,
      branch,
      backupBranch: result.backupBranch,
      commit: {
        sha: result.commit.sha,
        message: result.commit.commit?.message,
        author: result.commit.commit?.author?.name,
        date: result.commit.commit?.author?.date,
      }
    });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.get("/search", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const q = req.query.q as string;
    if (!q) return res.status(400).json({ error: "Query parameter 'q' required" });
    const result = await withRepoToken(repo.githubToken, () =>
      githubService.searchCode(repo.owner, repo.name, q)
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.post("/preflight-check", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const logs: string[] = [];
    const preflight = await runSourceCodePreflight(repo.owner, repo.name, repo.githubToken, logs);
    res.json({ ...preflight, logs });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/deploy-staging", async (req: Request, res: Response) => {
  try {
    const startTime = Date.now();
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const projectId = req.headers["x-devmax-project"] as string;

    const [proj] = await db.execute(sql`SELECT tenant_id FROM devmax_projects WHERE id = ${projectId}`).then((r: any) => r.rows || r).catch(() => [{}]);
    const planCheck = await checkPlanLimits(proj?.tenant_id, "deploy");
    if (!planCheck.allowed) return res.status(403).json({ error: planCheck.reason, plan: planCheck.plan, usage: planCheck.usage, limit: planCheck.limit });

    const { branch, buildCmd, startCmd, envVars, createDb } = req.body;

    const { sshService } = await import("../services/sshService");
    const repoUrl = `https://github.com/${repo.owner}/${repo.name}.git`;
    const appName = repo.deploySlug;
    const stagingRepoName = `${repo.name}-test`;
    const stagingLogs: string[] = [];

    const preflight = await runSourceCodePreflight(repo.owner, repo.name, repo.githubToken, stagingLogs);
    if (preflight.blocking) {
      return res.status(422).json({
        success: false,
        message: `Déploiement bloqué par le preflight:\n${preflight.issues.join("\n")}`,
        preflight,
        logs: stagingLogs,
      });
    }

    let stagingRepoUrl = repoUrl;
    try {
      await withRepoToken(repo.githubToken, async () => {
        const existingRepo = await githubService.getRepo(repo.owner, stagingRepoName).catch(() => null);
        if (!existingRepo) {
          stagingLogs.push(`Creating staging repo: ${repo.owner}/${stagingRepoName}`);
          await githubService.createRepo(stagingRepoName, {
            description: `Staging clone of ${repo.name} — auto-managed by Ulysse AI`,
            isPrivate: true,
            autoInit: false,
          });
          stagingLogs.push(`Staging repo created: ${repo.owner}/${stagingRepoName}`);
        } else {
          stagingLogs.push(`Staging repo exists: ${repo.owner}/${stagingRepoName}`);
        }
      });
      stagingRepoUrl = `https://github.com/${repo.owner}/${stagingRepoName}.git`;

      const token = repo.githubToken || await sshService.resolveGitHubToken();
      if (token) {
        const mirrorResult = await sshService.executeCommand(
          `cd /tmp && rm -rf _staging_mirror_${appName} && ` +
          `git clone --mirror https://x-access-token:${token}@github.com/${repo.owner}/${repo.name}.git _staging_mirror_${appName} 2>&1 && ` +
          `cd _staging_mirror_${appName} && ` +
          `git remote set-url --push origin https://x-access-token:${token}@github.com/${repo.owner}/${stagingRepoName}.git && ` +
          `git push --mirror 2>&1 && ` +
          `cd /tmp && rm -rf _staging_mirror_${appName}`,
          120000
        );
        if (mirrorResult.success) {
          stagingLogs.push(`Code mirrored to staging repo`);
        } else {
          stagingLogs.push(`Mirror push warning: ${mirrorResult.error?.substring(0, 200)}`);
        }
      }
    } catch (repoErr: any) {
      stagingLogs.push(`Staging repo setup: ${repoErr.message?.substring(0, 200) || "skipped"}`);
    }

    const skipTests = req.body.skipTests === true;
    let preTestResult: TestSuiteResult | null = null;
    if (!skipTests) {
      try {
        preTestResult = await runPreDeployTests(appName, sshService);
        stagingLogs.push(`PRE-DEPLOY TESTS: ${preTestResult.passed}/${preTestResult.total} passed (${preTestResult.duration}ms)`);
        preTestResult.tests.forEach(t => stagingLogs.push(`  ${t.pass ? "✅" : "❌"} ${t.name}: ${t.detail}`));
        if (preTestResult.blocking) {
          stagingLogs.push("⛔ Tests bloquants échoués — déploiement annulé");
          return res.status(422).json({
            success: false,
            message: `Déploiement annulé: ${preTestResult.failed} test(s) échoué(s)`,
            preDeployTests: preTestResult,
            logs: stagingLogs,
          });
        }
      } catch (testErr: any) {
        stagingLogs.push(`PRE-DEPLOY TESTS: erreur — ${testErr.message?.slice(0, 100)}`);
      }
    }

    const result = await sshService.deployStagingApp({
      repoUrl: stagingRepoUrl,
      appName,
      branch: branch || "main",
      buildCmd,
      startCmd,
      envVars,
      createDb,
      caller: "max",
      devmaxProjectId: projectId,
    });

    let browserAccessible = false;
    let browserStatus = "unknown";
    if (result.success && result.stagingUrl) {
      const health = await checkDeployHealth(result.stagingUrl, sshService);
      browserAccessible = health.accessible;
      browserStatus = health.status;
    }

    let postTestResult: TestSuiteResult | null = null;
    if (result.success && !skipTests) {
      try {
        postTestResult = await runPostDeployTests(appName, "staging", sshService);
        stagingLogs.push(`POST-DEPLOY TESTS: ${postTestResult.passed}/${postTestResult.total} passed (${postTestResult.duration}ms)`);
        postTestResult.tests.forEach(t => stagingLogs.push(`  ${t.pass ? "✅" : "❌"} ${t.name}: ${t.detail}`));
      } catch (testErr: any) {
        stagingLogs.push(`POST-DEPLOY TESTS: erreur — ${testErr.message?.slice(0, 100)}`);
      }
    }

    const fullLogs = [...stagingLogs, ...(result.logs || [])];
    if (result.success) {
      fullLogs.push(`Browser check: ${browserStatus} (${browserAccessible ? "accessible" : "NOT accessible"})`);
    }

    if (result.success && projectId) {
      const stagingRepoFullName = `${repo.owner}/${stagingRepoName}`;
      const sPort = result.port || null;
      await db.execute(sql`
        UPDATE devmax_projects 
        SET staging_url = ${result.stagingUrl || null}, 
            staging_port = ${sPort},
            production_url = ${result.productionUrl || null},
            environment = 'staging',
            last_deployed_at = NOW(),
            updated_at = NOW()
        WHERE id = ${projectId}
      `);
    }

    if (projectId) {
      const { logDeployment } = await import("./devmaxWebhook");
      await logDeployment(projectId, {
        environment: "staging",
        trigger: "manual",
        commitSha: undefined,
        branch: branch || "main",
        status: result.success ? "success" : "failed",
        url: result.stagingUrl,
        logs: fullLogs,
        duration: Date.now() - startTime,
      }).catch((e: any) => console.warn("[DevMax] logDeployment staging error:", e.message));
    }

    await logDevmaxActivity(req, "deploy-staging", branch || "main", {
      stagingUrl: result.stagingUrl,
      stagingRepo: `${repo.owner}/${stagingRepoName}`,
      browserAccessible,
      browserStatus,
      success: result.success,
    });

    sendDevmaxNotification({
      tenantId: proj?.tenant_id,
      projectId,
      type: result.success ? "deploy_success" : "deploy_failed",
      title: result.success ? `Staging déployé: ${repo.deploySlug}` : `Échec déploiement: ${repo.deploySlug}`,
      message: result.success
        ? `Branche ${branch || "main"} déployée sur ${result.stagingUrl}. Status: ${browserStatus}`
        : `Le déploiement a échoué. ${result.message?.substring(0, 200)}`,
      metadata: { stagingUrl: result.stagingUrl, branch: branch || "main", browserStatus },
    }).catch(() => {});

    const testSummary = [];
    if (preTestResult) testSummary.push(`PRE: ${preTestResult.passed}/${preTestResult.total}`);
    if (postTestResult) testSummary.push(`POST: ${postTestResult.passed}/${postTestResult.total}`);
    const testLine = testSummary.length ? `\nTests: ${testSummary.join(" | ")}` : "";

    res.json({
      ...result,
      stagingRepo: `${repo.owner}/${stagingRepoName}`,
      stagingRepoUrl: `https://github.com/${repo.owner}/${stagingRepoName}`,
      browserAccessible,
      browserStatus,
      preDeployTests: preTestResult,
      postDeployTests: postTestResult,
      logs: fullLogs,
      message: result.success
        ? `${result.message}\n\nStaging repo: ${repo.owner}/${stagingRepoName}\nBrowser: ${browserStatus}${testLine}${!browserAccessible ? "\n⚠️ L'URL staging n'est pas encore accessible depuis le navigateur. Verifiez DNS/SSL." : ""}`
        : result.message,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/promote-production", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const projectId = req.headers["x-devmax-project"] as string;
    const startTime = Date.now();

    const { sshService } = await import("../services/sshService");
    const appName = repo.deploySlug;
    const skipTests = req.body?.skipTests === true;
    const promoteLogs: string[] = [];

    let preTestResult: TestSuiteResult | null = null;
    if (!skipTests) {
      try {
        preTestResult = await runPreDeployTests(appName, sshService);
        promoteLogs.push(`PRE-PROMOTE TESTS: ${preTestResult.passed}/${preTestResult.total} passed (${preTestResult.duration}ms)`);
        preTestResult.tests.forEach(t => promoteLogs.push(`  ${t.pass ? "✅" : "❌"} ${t.name}: ${t.detail}`));
        if (preTestResult.blocking) {
          promoteLogs.push("⛔ Tests bloquants échoués — promotion annulée");
          return res.status(422).json({
            success: false,
            message: `Promotion annulée: ${preTestResult.failed} test(s) échoué(s)`,
            preDeployTests: preTestResult,
            logs: promoteLogs,
          });
        }
      } catch (testErr: any) {
        promoteLogs.push(`PRE-PROMOTE TESTS: erreur — ${testErr.message?.slice(0, 100)}`);
      }
    }

    const latestCommit = await sshService.executeCommand(
      `cd /var/www/apps/${appName}-dev && git log -1 --format="%H|%s" 2>/dev/null || cd /var/www/apps/${appName}-staging && git log -1 --format="%H|%s" 2>/dev/null || echo "unknown|unknown"`,
      5000
    );
    const [commitSha, commitMessage] = (latestCommit.output?.trim() || "unknown|unknown").split("|");

    const result = await sshService.promoteToProduction({
      appName,
      caller: "max",
    });

    let browserAccessible = false;
    let browserStatus = "unknown";
    if (result.success && result.productionUrl) {
      const health = await checkDeployHealth(result.productionUrl, sshService);
      browserAccessible = health.accessible;
      browserStatus = health.status;
    }

    let postTestResult: TestSuiteResult | null = null;
    if (result.success && !skipTests) {
      try {
        postTestResult = await runPostDeployTests(appName, "production", sshService);
        promoteLogs.push(`POST-PROMOTE TESTS: ${postTestResult.passed}/${postTestResult.total} passed (${postTestResult.duration}ms)`);
        postTestResult.tests.forEach(t => promoteLogs.push(`  ${t.pass ? "✅" : "❌"} ${t.name}: ${t.detail}`));
      } catch (testErr: any) {
        promoteLogs.push(`POST-PROMOTE TESTS: erreur — ${testErr.message?.slice(0, 100)}`);
      }
    }

    if (result.success && projectId) {
      await db.execute(sql`
        UPDATE devmax_projects 
        SET production_url = ${result.productionUrl || null},
            deploy_url = ${result.productionUrl || null},
            environment = 'production',
            last_promoted_at = NOW(),
            updated_at = NOW()
        WHERE id = ${projectId}
      `);
    }

    const allLogs = [...promoteLogs, ...(result.logs || [])];

    if (projectId) {
      const { logDeployment } = await import("./devmaxWebhook");
      await logDeployment(projectId, {
        environment: "production",
        trigger: "manual",
        commitSha: commitSha !== "unknown" ? commitSha : undefined,
        commitMessage: commitMessage !== "unknown" ? commitMessage : undefined,
        branch: "main",
        status: result.success ? "success" : "failed",
        url: result.productionUrl,
        logs: allLogs,
        duration: Date.now() - startTime,
      });
    }

    await logDevmaxActivity(req, "promote-production", "main", {
      productionUrl: result.productionUrl,
      browserAccessible,
      browserStatus,
      success: result.success,
      preDeployTests: preTestResult ? `${preTestResult.passed}/${preTestResult.total}` : null,
      postDeployTests: postTestResult ? `${postTestResult.passed}/${postTestResult.total}` : null,
    });

    const testSummary = [];
    if (preTestResult) testSummary.push(`PRE: ${preTestResult.passed}/${preTestResult.total}`);
    if (postTestResult) testSummary.push(`POST: ${postTestResult.passed}/${postTestResult.total}`);
    const testLine = testSummary.length ? `\nTests: ${testSummary.join(" | ")}` : "";

    res.json({
      ...result,
      browserAccessible,
      browserStatus,
      preDeployTests: preTestResult,
      postDeployTests: postTestResult,
      logs: allLogs,
      message: result.success
        ? `${result.message}\nBrowser: ${browserStatus}${testLine}${!browserAccessible ? "\n⚠️ L'URL production n'est pas encore accessible depuis le navigateur. Verifiez DNS/SSL." : ""}`
        : result.message,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/deployment-snapshots", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;

    const { sshService } = await import("../services/sshService");
    const result = await sshService.listProductionSnapshots(repo.deploySlug);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/rollback-production", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const projectId = req.headers["x-devmax-project"] as string;
    const { snapshotDir } = req.body;
    const startTime = Date.now();

    const { sshService } = await import("../services/sshService");
    const appName = repo.deploySlug;

    const result = await sshService.rollbackProduction({
      appName,
      snapshotDir,
      caller: "max",
    });

    let browserAccessible = false;
    let browserStatus = "unknown";
    if (result.success && result.productionUrl) {
      const health = await checkDeployHealth(result.productionUrl, sshService);
      browserAccessible = health.accessible;
      browserStatus = health.status;
    }

    if (result.success && projectId) {
      await db.execute(sql`
        UPDATE devmax_projects 
        SET production_url = ${result.productionUrl},
            environment = 'production',
            updated_at = NOW()
        WHERE id = ${projectId}
      `);
    }

    if (projectId) {
      const { logDeployment } = await import("./devmaxWebhook");
      await logDeployment(projectId, {
        environment: "production",
        trigger: "rollback",
        branch: "main",
        status: result.success ? "success" : "failed",
        url: result.productionUrl,
        logs: result.logs,
        duration: Date.now() - startTime,
      });
    }

    await logDevmaxActivity(req, "rollback-production", "main", {
      productionUrl: result.productionUrl,
      restoredFrom: result.restoredFrom,
      browserAccessible,
      browserStatus,
      success: result.success,
    });

    res.json({
      ...result,
      browserAccessible,
      browserStatus,
      message: result.success
        ? `${result.message}\nBrowser: ${browserStatus}${!browserAccessible ? "\n⚠️ L'URL production n'est pas encore accessible depuis le navigateur." : ""}`
        : result.message,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/deployment-status", async (req: Request, res: Response) => {
  try {
    const projectId = req.headers["x-devmax-project"] as string;
    if (!projectId) return res.status(400).json({ error: "Project ID required" });

    const session = (req as any).devmaxSession;
    const project = await db.execute(sql`
      SELECT staging_url, staging_port, production_url, production_port, 
             environment, last_deployed_at, last_promoted_at, deploy_url
      FROM devmax_projects 
      WHERE id = ${projectId}
    `);

    if (!project.rows?.length) return res.status(404).json({ error: "Project not found" });
    const p = project.rows[0] as any;

    res.json({
      stagingUrl: p.staging_url,
      stagingPort: p.staging_port,
      productionUrl: p.production_url || p.deploy_url,
      productionPort: p.production_port,
      environment: p.environment || "none",
      lastDeployedAt: p.last_deployed_at,
      lastPromotedAt: p.last_promoted_at,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/verify-repo-access", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;

    const { sshService } = await import("../services/sshService");
    const accessCheck = await sshService.verifyRepoAccess(repo.owner, repo.name);

    res.json({
      owner: repo.owner,
      name: repo.name,
      accessible: accessCheck.accessible,
      private: accessCheck.private,
      error: accessCheck.error,
      tokenAvailable: !!(await sshService.resolveGitHubToken()),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/connected-repos", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;

    const token = repo.githubToken || process.env.MAURICE_GITHUB_PAT || "";
    const headers: Record<string, string> = {
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "MaxAI-DevOps",
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const prodName = repo.name;
    const testName = `${repo.name}-test`;

    const checkRepo = async (owner: string, name: string) => {
      try {
        const r = await fetch(`https://api.github.com/repos/${owner}/${name}`, { headers });
        if (r.ok) {
          const data = await r.json();
          const isEmpty = data.size === 0;
          let commitCount = 0;
          if (!isEmpty) {
            try {
              const cRes = await fetch(`https://api.github.com/repos/${owner}/${name}/commits?per_page=1`, { headers });
              if (cRes.ok) commitCount = 1;
              else if (cRes.status === 409) commitCount = 0;
            } catch {}
          }
          return {
            owner, name, fullName: `${owner}/${name}`,
            exists: true, accessible: true, private: data.private,
            defaultBranch: data.default_branch, language: data.language,
            updatedAt: data.updated_at,
            pushedAt: (isEmpty || commitCount === 0) ? null : data.pushed_at,
            url: data.html_url,
            empty: isEmpty || commitCount === 0,
            size: data.size,
          };
        }
        return { owner, name, fullName: `${owner}/${name}`, exists: r.status !== 404, accessible: false, private: null, error: r.status === 404 ? "Repo inexistant" : `HTTP ${r.status}` };
      } catch (e: any) {
        return { owner, name, fullName: `${owner}/${name}`, exists: false, accessible: false, private: null, error: e.message };
      }
    };

    const [prod, test] = await Promise.all([
      checkRepo(repo.owner, prodName),
      checkRepo(repo.owner, testName),
    ]);

    const projectId = req.headers["x-devmax-project"] as string;
    const projRow = await db.execute(sql`SELECT staging_url, production_url, deploy_slug, staging_port FROM devmax_projects WHERE id = ${projectId}`);
    const proj = projRow.rows?.[0] as any;
    const slug = proj?.deploy_slug || prodName.toLowerCase().replace(/[^a-z0-9-]/g, "-");

    res.json({
      production: { ...prod, role: "production", deployUrl: proj?.production_url || `https://${slug}.ulyssepro.org` },
      staging: { ...test, role: "staging", deployUrl: proj?.staging_url || `https://${slug}-dev.ulyssepro.org`, port: proj?.staging_port },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/setup-deploy-key", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;

    const { sshService } = await import("../services/sshService");
    const result = await sshService.setupVpsDeployKey(repo.owner, repo.name);

    await logDevmaxActivity(req, "setup-deploy-key", "n/a", {
      owner: repo.owner,
      repo: repo.name,
      success: result.success,
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/dgm/sessions", async (req: Request, res: Response) => {
  try {
    const projectId = req.headers["x-devmax-project"] as string;
    const project = projectId ? await db.execute(sql`SELECT repo_owner, repo_name FROM devmax_projects WHERE id = ${projectId}`) : null;
    const repoContext = project?.rows?.[0] ? `${project.rows[0].repo_owner}/${project.rows[0].repo_name}` : null;

    let sessions;
    if (repoContext) {
      sessions = await db.select().from(dgmSessions).where(eq(dgmSessions.repoContext, repoContext)).orderBy(desc(dgmSessions.createdAt)).limit(20);
    } else {
      sessions = await db.select().from(dgmSessions).orderBy(desc(dgmSessions.createdAt)).limit(20);
    }
    res.json(sessions);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

async function verifyDgmSessionAccess(req: Request, res: Response): Promise<{ sessionId: number; session: any } | null> {
  const sessionId = parseInt(req.params.sessionId);
  if (isNaN(sessionId)) { res.status(400).json({ error: "Session ID invalide" }); return null; }
  const [session] = await db.select().from(dgmSessions).where(eq(dgmSessions.id, sessionId));
  if (!session) { res.status(404).json({ error: "Session introuvable" }); return null; }
  const projectId = req.headers["x-devmax-project"] as string;
  if (projectId && session.repoContext) {
    const project = await db.execute(sql`SELECT repo_owner, repo_name FROM devmax_projects WHERE id = ${projectId}`);
    const row = project?.rows?.[0] as any;
    if (row) {
      const repoContext = `${row.repo_owner}/${row.repo_name}`;
      if (session.repoContext !== repoContext) { res.status(403).json({ error: "Accès refusé à cette session DGM" }); return null; }
    }
  }
  return { sessionId, session };
}

router.get("/dgm/sessions/:sessionId/tasks", async (req: Request, res: Response) => {
  try {
    const access = await verifyDgmSessionAccess(req, res);
    if (!access) return;
    const tasks = await db.select().from(dgmTasks).where(eq(dgmTasks.sessionId, access.sessionId)).orderBy(dgmTasks.sortOrder);
    res.json(tasks);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/dgm/sessions/:sessionId/pipeline", async (req: Request, res: Response) => {
  try {
    const access = await verifyDgmSessionAccess(req, res);
    if (!access) return;
    const runs = await db.select().from(dgmPipelineRuns).where(eq(dgmPipelineRuns.sessionId, access.sessionId)).orderBy(desc(dgmPipelineRuns.createdAt)).limit(50);
    res.json(runs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/dgm/sessions/:sessionId/toggle", async (req: Request, res: Response) => {
  try {
    const access = await verifyDgmSessionAccess(req, res);
    if (!access) return;
    const newActive = !access.session.active;
    await db.update(dgmSessions).set({
      active: newActive,
      ...(newActive ? { activatedAt: new Date() } : { deactivatedAt: new Date() }),
    }).where(eq(dgmSessions.id, access.sessionId));
    res.json({ success: true, active: newActive });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/setup-webhook", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const projectId = req.headers["x-devmax-project"] as string;
    const { branch } = req.body;

    const crypto = await import("crypto");
    const secret = crypto.randomBytes(32).toString("hex");

    const callbackUrl = `${req.protocol}://${req.get("host")}/api/devmax/webhook/github`;
    const externalUrl = process.env.REPLIT_DOMAINS
      ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}/api/devmax/webhook/github`
      : callbackUrl;

    const stagingRepoName = `${repo.name}-test`;
    let webhookId: string | null = null;
    const webhookErrors: string[] = [];

    for (const targetRepo of [stagingRepoName, repo.name]) {
      try {
        const result = await withRepoToken(repo.githubToken, () =>
          githubService.createWebhook(repo.owner, targetRepo, {
            url: externalUrl,
            secret,
            events: ["push"],
            active: true,
          })
        );
        if (!webhookId) webhookId = String(result.id);
        console.log(`[DevMax] Webhook created on ${repo.owner}/${targetRepo}`);
      } catch (ghErr: any) {
        if (ghErr.message?.includes("already exists") || ghErr.status === 422) {
          if (!webhookId) webhookId = "existing";
          console.log(`[DevMax] Webhook already exists on ${repo.owner}/${targetRepo}`);
        } else {
          webhookErrors.push(`${targetRepo}: ${ghErr.message}`);
        }
      }
    }
    if (!webhookId && webhookErrors.length) {
      throw new Error(`Webhook setup failed: ${webhookErrors.join("; ")}`);
    }

    await db.execute(sql`
      UPDATE devmax_projects 
      SET webhook_secret = ${secret}, 
          webhook_id = ${webhookId},
          cicd_enabled = true,
          cicd_branch = ${branch || "main"},
          updated_at = NOW()
      WHERE id = ${projectId}
    `);

    await logDevmaxActivity(req, "setup-webhook", "main", { webhookId, branch: branch || "main" });

    res.json({
      success: true,
      webhookId,
      webhookUrl: externalUrl,
      branch: branch || "main",
      message: `CI/CD webhook configuré — push sur ${branch || "main"} → auto-deploy staging`,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/toggle-cicd", async (req: Request, res: Response) => {
  try {
    const projectId = req.headers["x-devmax-project"] as string;
    if (!projectId) return res.status(400).json({ error: "Project ID requis" });
    const { enabled, branch } = req.body;

    const setClauses: ReturnType<typeof sql>[] = [];
    if (typeof enabled === "boolean") setClauses.push(sql`cicd_enabled = ${enabled}`);
    if (branch) setClauses.push(sql`cicd_branch = ${branch}`);
    setClauses.push(sql`updated_at = NOW()`);

    const setQuery = sql.join(setClauses, sql`, `);
    await db.execute(sql`UPDATE devmax_projects SET ${setQuery} WHERE id = ${projectId}`);
    res.json({ success: true, enabled, branch });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/deployments", async (req: Request, res: Response) => {
  try {
    const projectId = req.headers["x-devmax-project"] as string;
    if (!projectId) return res.status(400).json({ error: "Project ID requis" });
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const environment = req.query.environment as string;

    const deployments = environment
      ? await db.execute(sql`SELECT id, environment, trigger, commit_sha, commit_message, branch, status, url, duration_ms, created_at FROM devmax_deployments WHERE project_id = ${projectId} AND environment = ${environment} ORDER BY created_at DESC LIMIT ${limit}`).then((r: any) => r.rows || r)
      : await db.execute(sql`SELECT id, environment, trigger, commit_sha, commit_message, branch, status, url, duration_ms, created_at FROM devmax_deployments WHERE project_id = ${projectId} ORDER BY created_at DESC LIMIT ${limit}`).then((r: any) => r.rows || r);
    res.json({ deployments });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/ssl-status", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;

    const { sshService } = await import("../services/sshService");
    const domain = `${repo.deploySlug}.ulyssepro.org`;
    const stagingDomain = `${repo.deploySlug}-dev.ulyssepro.org`;

    const [prodSsl, stagingSsl, autoRenew] = await Promise.all([
      sshService.checkSslStatus(domain),
      sshService.checkSslStatus(stagingDomain),
      sshService.executeCommand(`crontab -l 2>/dev/null | grep -c certbot || echo "0"`, 5000),
    ]);

    res.json({
      production: { domain, ...prodSsl },
      staging: { domain: stagingDomain, ...stagingSsl },
      autoRenewConfigured: parseInt(autoRenew.output?.trim() || "0") > 0,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/ssl-auto-renew", async (req: Request, res: Response) => {
  try {
    const { sshService } = await import("../services/sshService");
    const result = await sshService.setupSslAutoRenew();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/dns-status", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const { cloudflareService } = await import("../services/cloudflareService");
    const status = await cloudflareService.getProjectDnsStatus(repo.deploySlug);
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/dns-setup", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const { stagingProxied, productionProxied } = req.body;
    const { cloudflareService } = await import("../services/cloudflareService");
    const result = await cloudflareService.setupProjectDns(repo.deploySlug, { stagingProxied, productionProxied });
    await logDevmaxActivity(req, "dns-setup", repo.deploySlug, {
      staging: result.staging,
      production: result.production,
    });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/dns-toggle-proxy", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const { environment, proxied } = req.body;
    if (!environment || proxied === undefined) return res.status(400).json({ error: "environment et proxied requis" });
    const { cloudflareService } = await import("../services/cloudflareService");
    const result = await cloudflareService.toggleProxy(repo.deploySlug, environment, proxied);
    await logDevmaxActivity(req, "dns-toggle-proxy", `${repo.deploySlug} ${environment}`, { proxied });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/dns-records", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const { cloudflareService } = await import("../services/cloudflareService");
    const result = await cloudflareService.removeDnsRecords(repo.deploySlug);
    await logDevmaxActivity(req, "dns-remove", repo.deploySlug, { removed: result.removed });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/env-vars", async (req: Request, res: Response) => {
  try {
    const projectId = req.headers["x-devmax-project"] as string;
    if (!projectId) return res.status(400).json({ error: "Project ID requis" });
    const environment = (req.query.environment as string) || "all";
    const vars = await db.execute(sql`
      SELECT id, key, value, environment, is_secret, updated_at 
      FROM devmax_env_vars WHERE project_id = ${projectId} AND (environment = ${environment} OR environment = 'all')
      ORDER BY key
    `).then((r: any) => r.rows || r);
    const masked = vars.map((v: any) => ({ ...v, value: v.is_secret ? "••••••" : v.value }));
    res.json({ envVars: masked });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/env-vars", async (req: Request, res: Response) => {
  try {
    const projectId = req.headers["x-devmax-project"] as string;
    if (!projectId) return res.status(400).json({ error: "Project ID requis" });
    const { key, value, environment = "all", isSecret = false } = req.body;
    if (!key || value === undefined) return res.status(400).json({ error: "key et value requis" });
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) return res.status(400).json({ error: "Nom de variable invalide" });
    await db.execute(sql`
      INSERT INTO devmax_env_vars (project_id, key, value, environment, is_secret, updated_at)
      VALUES (${projectId}, ${key}, ${value}, ${environment}, ${isSecret}, NOW())
      ON CONFLICT (project_id, key, environment) DO UPDATE SET value = ${value}, is_secret = ${isSecret}, updated_at = NOW()
    `);
    const repo = await getProjectRepo(req, res);
    if (repo) {
      const { sshService } = await import("../services/sshService");
      const slug = repo.deploySlug;
      const envDir = environment === "production" ? slug : `${slug}-dev`;
      await sshService.executeCommand(
        `cd /var/www/apps/${envDir} 2>/dev/null && (grep -q "^${key}=" .env 2>/dev/null && sed -i "s|^${key}=.*|${key}=${value}|" .env || echo "${key}=${value}" >> .env)`,
        10000
      ).catch(() => {});
    }
    await logDevmaxActivity(req, "env-var-set", key, { environment, isSecret });
    res.json({ success: true, message: `Variable ${key} mise à jour` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/env-vars/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const projectId = req.headers["x-devmax-project"] as string;
    const [envVar] = await db.execute(sql`SELECT key, environment FROM devmax_env_vars WHERE id = ${parseInt(id)} AND project_id = ${projectId}`).then((r: any) => r.rows || r);
    if (!envVar) return res.status(404).json({ error: "Variable non trouvée" });
    await db.execute(sql`DELETE FROM devmax_env_vars WHERE id = ${parseInt(id)} AND project_id = ${projectId}`);
    const repo = await getProjectRepo(req, res);
    if (repo) {
      const { sshService } = await import("../services/sshService");
      const slug = repo.deploySlug;
      for (const env of [slug, `${slug}-dev`]) {
        await sshService.executeCommand(`cd /var/www/apps/${env} 2>/dev/null && sed -i "/^${envVar.key}=/d" .env 2>/dev/null`, 5000).catch(() => {});
      }
    }
    await logDevmaxActivity(req, "env-var-delete", envVar.key);
    res.json({ success: true, message: `Variable ${envVar.key} supprimée` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/env-vars/sync", async (req: Request, res: Response) => {
  try {
    const projectId = req.headers["x-devmax-project"] as string;
    if (!projectId) return res.status(400).json({ error: "Project ID requis" });
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const { environment = "staging" } = req.body;
    const vars = await db.execute(sql`
      SELECT key, value FROM devmax_env_vars WHERE project_id = ${projectId} AND (environment = ${environment} OR environment = 'all')
    `).then((r: any) => r.rows || r);
    if (!vars.length) return res.json({ success: true, message: "Aucune variable à synchroniser", synced: 0 });
    const { sshService } = await import("../services/sshService");
    const slug = repo.deploySlug;
    const envDir = environment === "production" ? slug : `${slug}-dev`;
    const envContent = vars.map((v: any) => `${v.key}=${v.value}`).join("\n");
    await sshService.writeRemoteFile(`/var/www/apps/${envDir}/.env`, envContent);
    const pm2Name = environment === "production" ? slug : `${slug}-dev`;
    await sshService.executeCommand(`pm2 restart ${pm2Name} 2>/dev/null || true`, 10000).catch(() => {});
    res.json({ success: true, message: `${vars.length} variables synchronisées sur ${environment}`, synced: vars.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/notifications", async (req: Request, res: Response) => {
  try {
    const session = (req as any).devmaxSession;
    const tenantId = session?.tenant_id;
    const projectId = req.headers["x-devmax-project"] as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const conditions: ReturnType<typeof sql>[] = [sql`1=1`];
    if (tenantId) conditions.push(sql`tenant_id = ${tenantId}`);
    if (projectId) conditions.push(sql`project_id = ${projectId}`);
    const whereClause = sql.join(conditions, sql` AND `);
    const notifications = await db.execute(sql`SELECT id, type, title, message, channel, status, read_at, created_at, project_id, metadata FROM devmax_notifications WHERE ${whereClause} ORDER BY created_at DESC LIMIT ${limit}`).then((r: any) => r.rows || r);
    const unread = notifications.filter((n: any) => !n.read_at).length;
    res.json({ notifications, unread });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/notifications/:id/read", async (req: Request, res: Response) => {
  try {
    await db.execute(sql`UPDATE devmax_notifications SET read_at = NOW() WHERE id = ${parseInt(req.params.id)}`);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/notifications/read-all", async (req: Request, res: Response) => {
  try {
    const session = (req as any).devmaxSession;
    const tenantId = session?.tenant_id;
    if (tenantId) {
      await db.execute(sql`UPDATE devmax_notifications SET read_at = NOW() WHERE tenant_id = ${tenantId} AND read_at IS NULL`);
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/plan", async (req: Request, res: Response) => {
  try {
    const session = (req as any).devmaxSession;
    const tenantId = session?.tenant_id;
    if (!tenantId) return res.json({ plan: "owner", limits: {}, usage: {}, isOwner: true });
    const [tenant] = await db.execute(sql`SELECT plan, plan_limits, billing_status, trial_ends_at, stripe_customer_id FROM devmax_tenants WHERE id = ${tenantId}`).then((r: any) => r.rows || r);
    if (!tenant) return res.json({ plan: "free", limits: {}, usage: {} });
    const [projectCount] = await db.execute(sql`SELECT COUNT(*)::int as count FROM devmax_projects WHERE tenant_id = ${tenantId}`).then((r: any) => r.rows || r);
    const [deployCount] = await db.execute(sql`SELECT COUNT(*)::int as count FROM devmax_deployments d JOIN devmax_projects p ON d.project_id = p.id WHERE p.tenant_id = ${tenantId} AND d.created_at > NOW() - INTERVAL '30 days'`).then((r: any) => r.rows || r);
    const [userCount] = await db.execute(sql`SELECT COUNT(*)::int as count FROM devmax_users WHERE tenant_id = ${tenantId} AND active = true`).then((r: any) => r.rows || r);
    res.json({
      plan: tenant.plan,
      limits: tenant.plan_limits,
      billingStatus: tenant.billing_status,
      trialEndsAt: tenant.trial_ends_at,
      hasStripe: !!tenant.stripe_customer_id,
      usage: { projects: projectCount?.count || 0, deploysThisMonth: deployCount?.count || 0, users: userCount?.count || 0 },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/billing/checkout", async (req: Request, res: Response) => {
  try {
    const session = (req as any).devmaxSession;
    const tenantId = session?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: "Tenant requis" });
    const { plan, billingPeriod } = req.body;
    if (!plan || !["starter", "pro", "enterprise"].includes(plan)) {
      return res.status(400).json({ error: "Plan invalide" });
    }
    const { devmaxStripeService } = await import("../services/devmaxStripeService");
    if (!devmaxStripeService.isConfigured()) {
      return res.status(503).json({ error: "Stripe non configure. Contactez l'administrateur." });
    }
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const result = await devmaxStripeService.createCheckoutSession({
      tenantId,
      plan,
      billingPeriod: billingPeriod || "monthly",
      successUrl: `${baseUrl}/devmax?billing=success&plan=${plan}`,
      cancelUrl: `${baseUrl}/devmax?billing=cancelled`,
    });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/billing/portal", async (req: Request, res: Response) => {
  try {
    const session = (req as any).devmaxSession;
    const tenantId = session?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: "Tenant requis" });
    const { devmaxStripeService } = await import("../services/devmaxStripeService");
    if (!devmaxStripeService.isConfigured()) {
      return res.status(503).json({ error: "Stripe non configure" });
    }
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const result = await devmaxStripeService.createPortalSession({
      tenantId,
      returnUrl: `${baseUrl}/devmax?tab=plan`,
    });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/billing/invoices", async (req: Request, res: Response) => {
  try {
    const session = (req as any).devmaxSession;
    const tenantId = session?.tenant_id;
    if (!tenantId) return res.json({ invoices: [] });
    const { devmaxStripeService } = await import("../services/devmaxStripeService");
    const invoices = await devmaxStripeService.listInvoices(tenantId);
    res.json({ invoices });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/billing/status", async (req: Request, res: Response) => {
  try {
    const session = (req as any).devmaxSession;
    const tenantId = session?.tenant_id;
    if (!tenantId) return res.json({ plan: "owner", isOwner: true });
    const { devmaxStripeService } = await import("../services/devmaxStripeService");
    const status = await devmaxStripeService.getSubscriptionStatus(tenantId);
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/custom-domain", async (req: Request, res: Response) => {
  try {
    const projectId = req.headers["x-devmax-project"] as string;
    if (!projectId) return res.status(400).json({ error: "Project ID requis" });
    const { domain, environment = "production" } = req.body;
    if (!domain || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
      return res.status(400).json({ error: "Domaine invalide" });
    }
    const [proj] = await db.execute(sql`SELECT tenant_id, deploy_slug, staging_port, production_port FROM devmax_projects WHERE id = ${projectId}`).then((r: any) => r.rows || r);
    const planCheck = await checkPlanLimits(proj?.tenant_id, "custom_domain");
    if (!planCheck.allowed) return res.status(403).json({ error: planCheck.reason });
    const existing = await db.execute(sql`SELECT id FROM devmax_custom_domains WHERE domain = ${domain}`).then((r: any) => r.rows || r);
    if (existing.length > 0) return res.status(409).json({ error: "Ce domaine est déjà utilisé" });

    const { sshService } = await import("../services/sshService");
    const VPS_IP = "65.21.209.102";
    const dnsCheck = await sshService.executeCommand(`dig +short ${domain} A 2>/dev/null | head -1`, 10000);
    const resolvedIp = dnsCheck.output?.trim();
    const dnsValid = resolvedIp === VPS_IP;
    const dnsStatus = dnsValid ? "verified" : "pending";

    await db.execute(sql`
      INSERT INTO devmax_custom_domains (project_id, tenant_id, domain, environment, dns_status, ssl_status)
      VALUES (${projectId}, ${proj?.tenant_id || null}, ${domain}, ${environment}, ${dnsStatus}, 'pending')
    `);

    if (!dnsValid) {
      await logDevmaxActivity(req, "custom-domain-add", domain, { environment, dnsStatus: "pending", resolvedIp, expectedIp: VPS_IP });
      return res.json({
        success: true, domain, dnsStatus: "pending", sslStatus: "pending",
        instructions: `Ajoutez un enregistrement DNS A pour "${domain}" pointant vers ${VPS_IP}. Actuellement résolu vers: ${resolvedIp || "aucune IP"}. Une fois le DNS propagé, cliquez "Vérifier DNS" pour continuer.`
      });
    }

    const slug = proj?.deploy_slug || "";
    const targetDir = environment === "production" ? `/var/www/apps/${slug}` : `/var/www/apps/${slug}-dev`;
    const port = environment === "production" ? proj?.production_port : proj?.staging_port;
    const isProxy = await sshService.executeCommand(`[ -f "${targetDir}/package.json" ] && echo "proxy" || echo "static"`, 5000);
    const isProxyApp = isProxy.output?.trim() === "proxy";

    let nginxConf: string;
    if (isProxyApp && port) {
      nginxConf = `server {\n    listen 80;\n    server_name ${domain};\n    location / {\n        proxy_pass http://127.0.0.1:${port};\n        proxy_http_version 1.1;\n        proxy_set_header Upgrade $http_upgrade;\n        proxy_set_header Connection "upgrade";\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n        proxy_cache_bypass $http_upgrade;\n    }\n    add_header X-Frame-Options "SAMEORIGIN" always;\n    add_header X-Content-Type-Options "nosniff" always;\n    add_header X-XSS-Protection "1; mode=block" always;\n}\n`;
    } else {
      const distCheck = await sshService.executeCommand(`[ -d "${targetDir}/dist" ] && echo "dist" || echo "root"`, 5000);
      const serveRoot = distCheck.output?.trim() === "dist" ? `${targetDir}/dist` : targetDir;
      nginxConf = `server {\n    listen 80;\n    server_name ${domain};\n    root ${serveRoot};\n    index index.html;\n    gzip on;\n    gzip_types text/plain text/css application/json application/javascript text/xml;\n    location / { try_files $uri $uri/ /index.html =404; }\n    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {\n        expires 30d;\n        add_header Cache-Control "public, immutable";\n    }\n    add_header X-Frame-Options "SAMEORIGIN" always;\n    add_header X-Content-Type-Options "nosniff" always;\n    error_page 502 /502.html;\n    location = /502.html { root /var/www/html; internal; }\n}\n`;
    }

    const confName = `custom-${domain.replace(/\./g, "-")}`;
    await sshService.writeRemoteFile(`/etc/nginx/sites-available/${confName}`, nginxConf);
    const nginxResult = await sshService.executeCommand(
      `ln -sf /etc/nginx/sites-available/${confName} /etc/nginx/sites-enabled/${confName} && nginx -t 2>&1`,
      15000
    );
    if (!nginxResult.success) {
      await sshService.executeCommand(`rm -f /etc/nginx/sites-enabled/${confName}`, 5000);
      return res.status(500).json({ error: `Configuration Nginx invalide: ${nginxResult.output?.substring(0, 200)}` });
    }
    await sshService.executeCommand("systemctl reload nginx", 10000);
    await db.execute(sql`UPDATE devmax_custom_domains SET dns_status = 'verified' WHERE domain = ${domain}`);

    const sslResult = await sshService.executeCommand(
      `certbot --nginx -d ${domain} --non-interactive --agree-tos -m admin@ulyssepro.org --redirect 2>&1 | tail -10`,
      90000
    ).catch(() => ({ success: false, output: "" }));

    let sslStatus = "pending";
    if ((sslResult as any).success && !(sslResult as any).output?.includes("error")) {
      sslStatus = "active";
      await db.execute(sql`UPDATE devmax_custom_domains SET ssl_status = 'active', verified_at = NOW() WHERE domain = ${domain}`);
    }

    await logDevmaxActivity(req, "custom-domain-add", domain, { environment, sslStatus });
    sendDevmaxNotification({ tenantId: proj?.tenant_id, projectId, type: "custom_domain", title: `Domaine ajouté: ${domain}`, message: `Le domaine ${domain} a été configuré pour ${slug} (${environment}). SSL: ${sslStatus}.` }).catch(() => {});
    res.json({ success: true, domain, dnsStatus: "verified", sslStatus });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/custom-domain/verify-dns", async (req: Request, res: Response) => {
  try {
    const projectId = req.headers["x-devmax-project"] as string;
    if (!projectId) return res.status(400).json({ error: "Project ID requis" });
    const { domain } = req.body;
    if (!domain) return res.status(400).json({ error: "Domaine requis" });

    const [domainRecord] = await db.execute(sql`SELECT * FROM devmax_custom_domains WHERE domain = ${domain} AND project_id = ${projectId}`).then((r: any) => r.rows || r);
    if (!domainRecord) return res.status(404).json({ error: "Domaine non trouvé" });
    if (domainRecord.dns_status === "verified" && domainRecord.ssl_status === "active") {
      return res.json({ success: true, dnsStatus: "verified", sslStatus: "active", message: "Domaine déjà vérifié et SSL actif." });
    }

    const { sshService } = await import("../services/sshService");
    const VPS_IP = "65.21.209.102";
    const dnsCheck = await sshService.executeCommand(`dig +short ${domain} A 2>/dev/null | head -1`, 10000);
    const resolvedIp = dnsCheck.output?.trim();
    if (resolvedIp !== VPS_IP) {
      return res.json({ success: false, dnsStatus: "pending", resolvedIp, expectedIp: VPS_IP, message: `Le DNS pointe vers ${resolvedIp || "aucune IP"} au lieu de ${VPS_IP}. Attendez la propagation DNS (jusqu'à 48h).` });
    }

    await db.execute(sql`UPDATE devmax_custom_domains SET dns_status = 'verified' WHERE domain = ${domain}`);

    const [proj] = await db.execute(sql`SELECT deploy_slug, staging_port, production_port FROM devmax_projects WHERE id = ${projectId}`).then((r: any) => r.rows || r);
    const slug = proj?.deploy_slug || "";
    const environment = domainRecord.environment || "production";
    const targetDir = environment === "production" ? `/var/www/apps/${slug}` : `/var/www/apps/${slug}-dev`;
    const port = environment === "production" ? proj?.production_port : proj?.staging_port;
    const isProxy = await sshService.executeCommand(`[ -f "${targetDir}/package.json" ] && echo "proxy" || echo "static"`, 5000);
    const isProxyApp = isProxy.output?.trim() === "proxy";

    let nginxConf: string;
    if (isProxyApp && port) {
      nginxConf = `server {\n    listen 80;\n    server_name ${domain};\n    location / {\n        proxy_pass http://127.0.0.1:${port};\n        proxy_http_version 1.1;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n    }\n}\n`;
    } else {
      const distCheck = await sshService.executeCommand(`[ -d "${targetDir}/dist" ] && echo "dist" || echo "root"`, 5000);
      const serveRoot = distCheck.output?.trim() === "dist" ? `${targetDir}/dist` : targetDir;
      nginxConf = `server {\n    listen 80;\n    server_name ${domain};\n    root ${serveRoot};\n    index index.html;\n    location / { try_files $uri $uri/ /index.html =404; }\n}\n`;
    }

    const confName = `custom-${domain.replace(/\./g, "-")}`;
    await sshService.writeRemoteFile(`/etc/nginx/sites-available/${confName}`, nginxConf);
    await sshService.executeCommand(`ln -sf /etc/nginx/sites-available/${confName} /etc/nginx/sites-enabled/${confName} && nginx -t 2>&1 && systemctl reload nginx`, 15000);

    const sslResult = await sshService.executeCommand(
      `certbot --nginx -d ${domain} --non-interactive --agree-tos -m admin@ulyssepro.org --redirect 2>&1 | tail -10`,
      90000
    ).catch(() => ({ success: false }));

    let sslStatus = "pending";
    if ((sslResult as any).success) {
      sslStatus = "active";
      await db.execute(sql`UPDATE devmax_custom_domains SET ssl_status = 'active', verified_at = NOW() WHERE domain = ${domain}`);
    }

    res.json({ success: true, dnsStatus: "verified", sslStatus, message: sslStatus === "active" ? "DNS vérifié et SSL activé !" : "DNS vérifié. SSL en cours de provisionnement." });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/custom-domain", async (req: Request, res: Response) => {
  try {
    const projectId = req.headers["x-devmax-project"] as string;
    if (!projectId) return res.status(400).json({ error: "Project ID requis" });
    const { domain } = req.body;
    if (!domain) return res.status(400).json({ error: "Domaine requis" });

    const [domainRecord] = await db.execute(sql`SELECT * FROM devmax_custom_domains WHERE domain = ${domain} AND project_id = ${projectId}`).then((r: any) => r.rows || r);
    if (!domainRecord) return res.status(404).json({ error: "Domaine non trouvé" });

    const { sshService } = await import("../services/sshService");
    const confName = `custom-${domain.replace(/\./g, "-")}`;
    await sshService.executeCommand(`rm -f /etc/nginx/sites-enabled/${confName} /etc/nginx/sites-available/${confName} && systemctl reload nginx`, 15000).catch(() => {});
    if (domainRecord.ssl_status === "active") {
      await sshService.executeCommand(`certbot delete --cert-name ${domain} --non-interactive 2>/dev/null`, 30000).catch(() => {});
    }
    await db.execute(sql`DELETE FROM devmax_custom_domains WHERE domain = ${domain} AND project_id = ${projectId}`);
    await logDevmaxActivity(req, "custom-domain-remove", domain, {});
    res.json({ success: true, message: `Domaine ${domain} supprimé.` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/custom-domains", async (req: Request, res: Response) => {
  try {
    const projectId = req.headers["x-devmax-project"] as string;
    if (!projectId) return res.status(400).json({ error: "Project ID requis" });
    const domains = await db.execute(sql`SELECT * FROM devmax_custom_domains WHERE project_id = ${projectId} ORDER BY created_at DESC`).then((r: any) => r.rows || r);
    res.json({ domains });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/custom-domain/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const [domain] = await db.execute(sql`SELECT domain FROM devmax_custom_domains WHERE id = ${parseInt(id)}`).then((r: any) => r.rows || r);
    if (!domain) return res.status(404).json({ error: "Domaine non trouvé" });
    const { sshService } = await import("../services/sshService");
    const confName = `custom-${domain.domain.replace(/\./g, "-")}`;
    await sshService.executeCommand(`rm -f /etc/nginx/sites-enabled/${confName} /etc/nginx/sites-available/${confName} && nginx -t 2>&1 && systemctl reload nginx`, 15000).catch(() => {});
    await db.execute(sql`DELETE FROM devmax_custom_domains WHERE id = ${parseInt(id)}`);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/logs", async (req: Request, res: Response) => {
  try {
    const projectId = req.headers["x-devmax-project"] as string;
    if (!projectId) return res.status(400).json({ error: "Project ID requis" });
    const environment = (req.query.environment as string) || "staging";
    const search = req.query.search as string;
    const level = req.query.level as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const { sshService } = await import("../services/sshService");
    const slug = repo.deploySlug;
    const pm2Name = environment === "production" ? slug : `${slug}-dev`;
    const pm2Logs = await sshService.executeCommand(
      `pm2 logs ${pm2Name} --nostream --lines ${limit} 2>/dev/null | tail -${limit}`,
      15000
    );
    let lines = (pm2Logs.output || "").split("\n").filter((l: string) => l.trim());
    if (search) {
      const re = new RegExp(search, "i");
      lines = lines.filter((l: string) => re.test(l));
    }
    if (level === "error") lines = lines.filter((l: string) => /error|ERR|Error|FATAL|fatal/i.test(l));
    else if (level === "warn") lines = lines.filter((l: string) => /warn|WARN|warning/i.test(l));
    const storedLogs = await db.execute(sql`
      SELECT level, message, source, created_at FROM devmax_logs 
      WHERE project_id = ${projectId} AND environment = ${environment}
      ORDER BY created_at DESC LIMIT ${limit}
    `).then((r: any) => r.rows || r);
    res.json({ liveLogs: lines.slice(-limit), storedLogs, pm2Name });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/logs/collect", async (req: Request, res: Response) => {
  try {
    const projectId = req.headers["x-devmax-project"] as string;
    if (!projectId) return res.status(400).json({ error: "Project ID requis" });
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const { sshService } = await import("../services/sshService");
    const slug = repo.deploySlug;
    let totalCollected = 0;
    for (const env of ["staging", "production"]) {
      const pm2Name = env === "production" ? slug : `${slug}-dev`;
      const logs = await sshService.executeCommand(`pm2 logs ${pm2Name} --nostream --lines 200 2>/dev/null | tail -200`, 15000);
      const lines = (logs.output || "").split("\n").filter((l: string) => l.trim());
      for (const line of lines.slice(-100)) {
        const level = /error|ERR|FATAL/i.test(line) ? "error" : /warn|WARN/i.test(line) ? "warn" : "info";
        await db.execute(sql`INSERT INTO devmax_logs (project_id, environment, level, message, source) VALUES (${projectId}, ${env}, ${level}, ${line.substring(0, 2000)}, 'pm2')`).catch(() => {});
        totalCollected++;
      }
    }
    await db.execute(sql`DELETE FROM devmax_logs WHERE project_id = ${projectId} AND created_at < NOW() - INTERVAL '7 days'`).catch(() => {});
    res.json({ success: true, collected: totalCollected });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/metrics", async (req: Request, res: Response) => {
  try {
    const projectId = req.headers["x-devmax-project"] as string;
    if (!projectId) return res.status(400).json({ error: "Project ID requis" });
    const hours = Math.min(parseInt(req.query.hours as string) || 24, 168);
    const metrics = await db.execute(sql`
      SELECT environment, cpu_percent, memory_mb, memory_percent, uptime_seconds, restarts, status, response_time_ms, collected_at
      FROM devmax_metrics WHERE project_id = ${projectId} AND collected_at > NOW() - INTERVAL '1 hour' * ${hours}
      ORDER BY collected_at DESC LIMIT 500
    `).then((r: any) => r.rows || r);
    const repo = await getProjectRepo(req, res);
    let live: any = null;
    if (repo) {
      const { sshService } = await import("../services/sshService");
      const slug = repo.deploySlug;
      const pm2Info = await sshService.executeCommand(
        `pm2 jlist 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const r=d.filter(p=>p.name==='${slug}'||p.name==='${slug}-dev');console.log(JSON.stringify(r.map(p=>({name:p.name,status:p.pm2_env?.status,cpu:p.monit?.cpu,memory:Math.round((p.monit?.memory||0)/1024/1024),restarts:p.pm2_env?.restart_time,uptime:Math.round((Date.now()-(p.pm2_env?.pm_uptime||0))/1000)}))))" 2>/dev/null`,
        10000
      ).catch(() => ({ output: "[]" }));
      try { live = JSON.parse(pm2Info.output || "[]"); } catch { live = []; }
    }
    res.json({ metrics, live });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/onboarding", async (req: Request, res: Response) => {
  try {
    const session = (req as any).devmaxSession;
    const tenantId = session?.tenant_id;
    if (!tenantId) return res.json({ completed: true, step: "done", isOwner: true });
    const [tenant] = await db.execute(sql`SELECT onboarding_completed, onboarding_step, plan, github_org, github_token FROM devmax_tenants WHERE id = ${tenantId}`).then((r: any) => r.rows || r);
    if (!tenant) return res.json({ completed: false, step: "welcome" });
    const [projectCount] = await db.execute(sql`SELECT COUNT(*)::int as count FROM devmax_projects WHERE tenant_id = ${tenantId}`).then((r: any) => r.rows || r);
    const steps = [
      { id: "welcome", label: "Bienvenue", completed: true },
      { id: "plan", label: "Choisir un plan", completed: tenant.plan !== "free" || tenant.onboarding_step !== "welcome" },
      { id: "github", label: "Connecter GitHub", completed: !!tenant.github_token || !!tenant.github_org },
      { id: "project", label: "Créer un projet", completed: (projectCount?.count || 0) > 0 },
      { id: "deploy", label: "Premier déploiement", completed: tenant.onboarding_completed || false },
    ];
    res.json({ completed: tenant.onboarding_completed || false, step: tenant.onboarding_step || "welcome", steps });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/onboarding/step", async (req: Request, res: Response) => {
  try {
    const session = (req as any).devmaxSession;
    const tenantId = session?.tenant_id;
    if (!tenantId) return res.json({ success: true });
    const { step, completed } = req.body;
    if (completed) {
      await db.execute(sql`UPDATE devmax_tenants SET onboarding_completed = true, onboarding_step = 'done', updated_at = NOW() WHERE id = ${tenantId}`);
    } else if (step) {
      await db.execute(sql`UPDATE devmax_tenants SET onboarding_step = ${step}, updated_at = NOW() WHERE id = ${tenantId}`);
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/tenant/notifications-config", async (req: Request, res: Response) => {
  try {
    const session = (req as any).devmaxSession;
    const tenantId = session?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: "Tenant requis" });
    const { email, webhookUrl } = req.body;
    await db.execute(sql`
      UPDATE devmax_tenants SET notification_email = ${email || null}, notification_webhook = ${webhookUrl || null}, updated_at = NOW()
      WHERE id = ${tenantId}
    `);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ══════════════════════════════════════════════════════════════
// FEATURE 1: Cost Dashboard API
// ══════════════════════════════════════════════════════════════

router.get("/costs/summary", async (req: Request, res: Response) => {
  try {
    const period = req.query.period as string || "30d";
    const periodMap: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 };
    const days = periodMap[period] || 30;
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const [costRows, dailyRows] = await Promise.all([
      db.execute(sql`
        SELECT model, context, SUM(input_tokens) as total_input, SUM(output_tokens) as total_output,
          SUM(cost_usd) as total_cost, COUNT(*) as calls
        FROM devmax_ai_costs WHERE created_at >= ${since}
        GROUP BY model, context ORDER BY total_cost DESC
      `).then((r: any) => r.rows || r).catch(() => []),
      db.execute(sql`
        SELECT DATE(created_at) as day, SUM(cost_usd) as cost, SUM(input_tokens + output_tokens) as tokens, COUNT(*) as calls
        FROM devmax_ai_costs WHERE created_at >= ${since}
        GROUP BY DATE(created_at) ORDER BY day
      `).then((r: any) => r.rows || r).catch(() => []),
    ]);

    const byModel: Record<string, { cost: number; calls: number }> = {};
    const byContext: Record<string, { cost: number; calls: number }> = {};
    let totalCost = 0, totalInput = 0, totalOutput = 0, totalCalls = 0;

    for (const r of costRows) {
      const cost = parseFloat(r.total_cost) || 0;
      const calls = parseInt(r.calls) || 0;
      totalCost += cost;
      totalInput += parseInt(r.total_input) || 0;
      totalOutput += parseInt(r.total_output) || 0;
      totalCalls += calls;
      if (!byModel[r.model]) byModel[r.model] = { cost: 0, calls: 0 };
      byModel[r.model].cost += cost;
      byModel[r.model].calls += calls;
      if (!byContext[r.context]) byContext[r.context] = { cost: 0, calls: 0 };
      byContext[r.context].cost += cost;
      byContext[r.context].calls += calls;
    }

    const { metricsService } = await import("../services/metricsService");
    const liveCosts = metricsService.getCostSummary();

    res.json({
      period, days,
      totalCost: Math.round((totalCost + liveCosts.totalCost) * 10000) / 10000,
      totalInput: totalInput + liveCosts.totalInput,
      totalOutput: totalOutput + liveCosts.totalOutput,
      totalCalls: totalCalls + (liveCosts.dailyCosts?.reduce((s, d) => s + d.calls, 0) || 0),
      byModel, byContext,
      dailyCosts: dailyRows.map((r: any) => ({ date: r.day, cost: parseFloat(r.cost) || 0, tokens: parseInt(r.tokens) || 0, calls: parseInt(r.calls) || 0 })),
      liveSession: liveCosts,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ══════════════════════════════════════════════════════════════
// FEATURE 2: GitHub Events (Webhook History)
// ══════════════════════════════════════════════════════════════

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

const SECRETS_ENCRYPTION_KEY = process.env.SECRETS_ENCRYPTION_KEY || process.env.SESSION_SECRET || "ulysse-devmax-secrets-key-2026";

function encryptSecret(value: string): string {
  const crypto = require("crypto");
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(SECRETS_ENCRYPTION_KEY, "salt", 32);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(value, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decryptSecret(encrypted: string): string {
  const crypto = require("crypto");
  const [ivHex, encHex] = encrypted.split(":");
  if (!ivHex || !encHex) return "***";
  const iv = Buffer.from(ivHex, "hex");
  const key = crypto.scryptSync(SECRETS_ENCRYPTION_KEY, "salt", 32);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(encHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

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

    const { sshService } = await import("../services/sshService");
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

    const { sshService } = await import("../services/sshService");
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
      const { logDeployment } = await import("./devmaxWebhook");
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

export { runSourceCodePreflight };
export default router;
