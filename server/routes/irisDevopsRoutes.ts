import { Router, Request, Response, NextFunction } from "express";
import { db } from "../db";
import { irisProjects, users } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { insertIrisProjectSchema } from "@shared/schema";
import * as fs from "fs";
import { createRepo } from "../services/githubService";
import { sslCertForDomain } from "../services/ssh/helpers";

const router = Router();

const isLocalServer = fs.existsSync("/etc/nginx/sites-available");
const GITHUB_OWNER = "ulyssemdbh-commits";

const IRIS_OWNERS = ["Kelly", "Lenny", "Micky"];

function getAuthenticatedGitUrl(repo: string): string {
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    return `https://${token}@github.com/${repo}.git`;
  }
  return `https://github.com/${repo}.git`;
}

async function runServerCommand(cmd: string, timeout = 10000): Promise<{ success: boolean; output: string; error?: string }> {
  if (isLocalServer) {
    const { execSync } = await import("child_process");
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

function generateNginxConfig(subdomain: string, domain: string, port: number, sslCert: string, sslKey: string): string {
  const upstreamName = subdomain.replace(/[^a-zA-Z0-9]/g, "_");
  return `upstream ${upstreamName}_backend {
    server 127.0.0.1:${port} max_fails=3 fail_timeout=30s;
    keepalive 8;
}

server {
    listen 80;
    server_name ${domain};

    client_max_body_size 50M;

    proxy_intercept_errors on;
    error_page 502 503 504 /502.html;
    location = /502.html {
        default_type text/html;
        return 502 '<!DOCTYPE html><html><head><title>${subdomain} - Starting</title><meta http-equiv="refresh" content="5"><style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#0a0a0a;color:#fff}div{text-align:center}h1{font-size:2rem;margin-bottom:1rem}.spinner{width:40px;height:40px;border:3px solid #333;border-top:3px solid #10b981;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 1rem}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div><div class="spinner"></div><h1>${subdomain}</h1><p>Application is starting up... auto-refreshing in 5s</p></div></body></html>';
    }

    location / {
        proxy_pass http://${upstreamName}_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 10s;
        proxy_send_timeout 300s;
        proxy_next_upstream error timeout http_502 http_503;
        proxy_next_upstream_tries 2;
        proxy_next_upstream_timeout 30s;
    }
}

server {
    listen 443 ssl;
    server_name ${domain};

    ssl_certificate ${sslCert};
    ssl_certificate_key ${sslKey};

    client_max_body_size 50M;

    proxy_intercept_errors on;
    error_page 502 503 504 /502.html;
    location = /502.html {
        default_type text/html;
        return 502 '<!DOCTYPE html><html><head><title>${subdomain} - Starting</title><meta http-equiv="refresh" content="5"><style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#0a0a0a;color:#fff}div{text-align:center}h1{font-size:2rem;margin-bottom:1rem}.spinner{width:40px;height:40px;border:3px solid #333;border-top:3px solid #10b981;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 1rem}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div><div class="spinner"></div><h1>${subdomain}</h1><p>Application is starting up... auto-refreshing in 5s</p></div></body></html>';
    }

    location / {
        proxy_pass http://${upstreamName}_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 10s;
        proxy_send_timeout 300s;
        proxy_next_upstream error timeout http_502 http_503;
        proxy_next_upstream_tries 2;
        proxy_next_upstream_timeout 30s;
    }
}
`;
}

async function setupNginxForDomain(subdomain: string, domain: string, port: number, sslCert: string, sslKey: string): Promise<{ success: boolean; logs: string[] }> {
  const logs: string[] = [];
  const nginxConfig = generateNginxConfig(subdomain, domain, port, sslCert, sslKey);
  const configPath = `/etc/nginx/sites-available/${domain}`;
  const enabledPath = `/etc/nginx/sites-enabled/${domain}`;

  await writeServerFile(configPath, nginxConfig);
  logs.push(`Nginx config written: ${configPath}`);

  const linkResult = await runServerCommand(`ln -sf ${configPath} ${enabledPath} 2>&1`, 5000);
  logs.push(`Symlink: ${linkResult.success ? "OK" : "FAILED"}`);

  const testResult = await runServerCommand(`nginx -t 2>&1`, 5000);
  if (testResult.success || testResult.output?.includes("successful")) {
    const reloadResult = await runServerCommand(`systemctl reload nginx 2>&1`, 5000);
    logs.push(`Nginx reload: ${reloadResult.success ? "OK" : "FAILED"}`);
    return { success: true, logs };
  } else {
    logs.push(`Nginx test FAILED: ${testResult.error || testResult.output}`);
    return { success: false, logs };
  }
}

async function autoProvisionProject(projectId: number, subdomain: string, projectName: string, description: string | null, port: number, githubRepo: string | null): Promise<{ logs: string[]; githubRepo: string | null }> {
  const logs: string[] = [];

  const repoName = subdomain;
  if (!githubRepo) {
    try {
      const result = await createRepo(repoName, {
        description: description || `Iris project: ${projectName}`,
        isPrivate: false,
        autoInit: true,
      });
      githubRepo = `${GITHUB_OWNER}/${repoName}`;
      logs.push(`[GitHub] Repo created: ${githubRepo}`);
    } catch (err: any) {
      if (err.message?.includes("already exists") || err.message?.includes("422")) {
        githubRepo = `${GITHUB_OWNER}/${repoName}`;
        logs.push(`[GitHub] Repo already exists: ${githubRepo}`);
      } else {
        logs.push(`[GitHub] Repo creation failed: ${err.message}`);
      }
    }
  } else {
    logs.push(`[GitHub] Using provided repo: ${githubRepo}`);
  }

  const prodDomain = `${subdomain}.ulyssepro.org`;
  const prodSsl = sslCertForDomain(prodDomain);
  const prodResult = await setupNginxForDomain(subdomain, prodDomain, port, prodSsl.cert, prodSsl.key);
  logs.push(`[DNS Prod] ${prodDomain}: ${prodResult.success ? "OK" : "FAILED"}`);
  prodResult.logs.forEach(l => logs.push(`  ${l}`));

  const testPort = port + 1000;
  const testDomain = `${subdomain}.dev.ulyssepro.org`;
  const testUpstream = `${subdomain}_test`;
  const testSsl = sslCertForDomain(testDomain);
  const testResult = await setupNginxForDomain(testUpstream, testDomain, testPort, testSsl.cert, testSsl.key);
  logs.push(`[DNS Test] ${testDomain}: ${testResult.success ? "OK" : "FAILED"}`);
  testResult.logs.forEach(l => logs.push(`  ${l}`));

  if (githubRepo) {
    try {
      const { sshService } = await import("../services/sshService");
      const gitUrl = getAuthenticatedGitUrl(githubRepo);
      await runServerCommand(`cd /tmp && git clone ${gitUrl} __iris_test_${repoName} 2>&1 && cd __iris_test_${repoName} && git checkout -b test 2>&1 && git push -u origin test 2>&1; rm -rf /tmp/__iris_test_${repoName}`, 30000);
      logs.push(`[GitHub] Branch 'test' created`);
    } catch (err: any) {
      logs.push(`[GitHub] Branch 'test' creation: ${err.message}`);
    }
  }

  await db.update(irisProjects).set({
    githubRepo,
    status: "configured",
    updatedAt: new Date(),
  }).where(eq(irisProjects.id, projectId));

  return { logs, githubRepo };
}

const USERNAME_TO_IRIS_OWNER: Record<string, string> = {
  "KellyIris001": "Kelly",
  "LennyIris002": "Lenny",
  "MickyIris003": "Micky",
};

function getUserId(req: Request): number {
  const userId = (req as any).user?.id || (req.session as any)?.userId;
  if (!userId) throw new Error("User not authenticated");
  return userId;
}

async function getAuthUser(req: Request) {
  const userId = getUserId(req);
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error("User not found");
  return user;
}

async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await getAuthUser(req);
    const irisOwnerName = USERNAME_TO_IRIS_OWNER[user.username];
    if (!user.isOwner && !irisOwnerName) {
      return res.status(403).json({ error: "Access denied" });
    }
    (req as any).authUser = user;
    (req as any).irisOwnerName = irisOwnerName || null;
    (req as any).isAdmin = user.isOwner;
    next();
  } catch (error: any) {
    return res.status(401).json({ error: error.message || "Unauthorized" });
  }
}

async function requireOwner(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await getAuthUser(req);
    if (!user.isOwner) {
      return res.status(403).json({ error: "Owner access required" });
    }
    (req as any).authUser = user;
    (req as any).isAdmin = true;
    next();
  } catch (error: any) {
    return res.status(401).json({ error: error.message || "Unauthorized" });
  }
}

router.use(requireAuth);

router.get("/owners", (_req: Request, res: Response) => {
  res.json(IRIS_OWNERS);
});

router.get("/projects", async (req: Request, res: Response) => {
  try {
    const isAdmin = (req as any).isAdmin;
    const irisOwnerName = (req as any).irisOwnerName;
    const { owner } = req.query;
    let projects;
    if (isAdmin) {
      if (owner && typeof owner === "string") {
        projects = await db.select().from(irisProjects).where(eq(irisProjects.ownerName, owner));
      } else {
        projects = await db.select().from(irisProjects);
      }
    } else {
      projects = await db.select().from(irisProjects).where(eq(irisProjects.ownerName, irisOwnerName));
    }
    res.json(projects);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/projects/:id", async (req: Request, res: Response) => {
  try {
    const project = await db.select().from(irisProjects).where(eq(irisProjects.id, parseInt(req.params.id))).limit(1);
    if (!project[0]) return res.status(404).json({ error: "Project not found" });
    const irisOwnerName = (req as any).irisOwnerName;
    if (irisOwnerName && project[0].ownerName !== irisOwnerName) {
      return res.status(403).json({ error: "Access denied" });
    }
    res.json(project[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/projects", async (req: Request, res: Response) => {
  try {
    const parsed = insertIrisProjectSchema.parse(req.body);
    if (!IRIS_OWNERS.includes(parsed.ownerName)) {
      return res.status(400).json({ error: `Owner must be one of: ${IRIS_OWNERS.join(", ")}` });
    }
    const irisOwnerName = (req as any).irisOwnerName;
    if (irisOwnerName && parsed.ownerName !== irisOwnerName) {
      return res.status(403).json({ error: "You can only create projects for yourself" });
    }
    const subdomain = parsed.subdomain.toLowerCase().replace(/[^a-z0-9-]/g, "");
    const port = parsed.port || 5021;
    const [project] = await db.insert(irisProjects).values({ ...parsed, subdomain, port }).returning();

    const provisionResult = await autoProvisionProject(
      project.id,
      subdomain,
      parsed.projectName,
      parsed.description || null,
      port,
      parsed.githubRepo || null
    );

    const updatedProject = await db.select().from(irisProjects).where(eq(irisProjects.id, project.id)).limit(1);

    res.json({
      ...updatedProject[0] || project,
      provisionLogs: provisionResult.logs,
      urls: {
        production: `https://${subdomain}.ulyssepro.org`,
        test: `https://${subdomain}.dev.ulyssepro.org`,
        github: provisionResult.githubRepo ? `https://github.com/${provisionResult.githubRepo}` : null,
      }
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.patch("/projects/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const irisOwnerName = (req as any).irisOwnerName;
    if (irisOwnerName) {
      const [existing] = await db.select().from(irisProjects).where(eq(irisProjects.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: "Project not found" });
      if (existing.ownerName !== irisOwnerName) return res.status(403).json({ error: "Access denied" });
    }
    const updates: Record<string, any> = {};
    const allowed = ["projectName", "description", "githubRepo", "port", "techStack", "status", "subdomain"];
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (updates.subdomain) {
      updates.subdomain = updates.subdomain.toLowerCase().replace(/[^a-z0-9-]/g, "");
    }
    updates.updatedAt = new Date();
    const [project] = await db.update(irisProjects).set(updates).where(eq(irisProjects.id, id)).returning();
    if (!project) return res.status(404).json({ error: "Project not found" });
    res.json(project);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/projects/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const irisOwnerName = (req as any).irisOwnerName;
    if (irisOwnerName) {
      const [existing] = await db.select().from(irisProjects).where(eq(irisProjects.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: "Project not found" });
      if (existing.ownerName !== irisOwnerName) return res.status(403).json({ error: "Access denied" });
    }
    const [deleted] = await db.delete(irisProjects).where(eq(irisProjects.id, id)).returning();
    if (!deleted) return res.status(404).json({ error: "Project not found" });
    res.json({ success: true, deleted });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/projects/:id/setup-subdomain", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [project] = await db.select().from(irisProjects).where(eq(irisProjects.id, id)).limit(1);
    if (!project) return res.status(404).json({ error: "Project not found" });
    const irisOwnerName = (req as any).irisOwnerName;
    if (irisOwnerName && project.ownerName !== irisOwnerName) return res.status(403).json({ error: "Access denied" });
    let port = project.port;
    if (!port) {
      const { sshService } = await import("../services/sshService");
      port = await sshService.findFreePort(undefined, "iris");
      await db.update(irisProjects).set({ port, updatedAt: new Date() }).where(eq(irisProjects.id, id));
    }

    const domain = `${project.subdomain}.ulyssepro.org`;
    const upstreamName = project.subdomain.replace(/[^a-zA-Z0-9]/g, "_");
    const nginxConfig = `upstream ${upstreamName}_backend {
    server 127.0.0.1:${port} max_fails=3 fail_timeout=30s;
    keepalive 8;
}

server {
    listen 80;
    server_name ${domain};

    client_max_body_size 50M;

    proxy_intercept_errors on;
    error_page 502 503 504 /502.html;
    location = /502.html {
        default_type text/html;
        return 502 '<!DOCTYPE html><html><head><title>${project.subdomain} - Starting</title><meta http-equiv="refresh" content="5"><style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#0a0a0a;color:#fff}div{text-align:center}h1{font-size:2rem;margin-bottom:1rem}.spinner{width:40px;height:40px;border:3px solid #333;border-top:3px solid #10b981;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 1rem}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div><div class="spinner"></div><h1>${project.subdomain}</h1><p>Application is starting up... auto-refreshing in 5s</p></div></body></html>';
    }

    location / {
        proxy_pass http://${upstreamName}_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 10s;
        proxy_send_timeout 300s;
        proxy_next_upstream error timeout http_502 http_503;
        proxy_next_upstream_tries 2;
        proxy_next_upstream_timeout 30s;
    }
}

server {
    listen 443 ssl;
    server_name ${domain};

    ssl_certificate ${sslCertForDomain(domain).cert};
    ssl_certificate_key ${sslCertForDomain(domain).key};

    client_max_body_size 50M;

    proxy_intercept_errors on;
    error_page 502 503 504 /502.html;
    location = /502.html {
        default_type text/html;
        return 502 '<!DOCTYPE html><html><head><title>${project.subdomain} - Starting</title><meta http-equiv="refresh" content="5"><style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#0a0a0a;color:#fff}div{text-align:center}h1{font-size:2rem;margin-bottom:1rem}.spinner{width:40px;height:40px;border:3px solid #333;border-top:3px solid #10b981;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 1rem}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div><div class="spinner"></div><h1>${project.subdomain}</h1><p>Application is starting up... auto-refreshing in 5s</p></div></body></html>';
    }

    location / {
        proxy_pass http://${upstreamName}_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 10s;
        proxy_send_timeout 300s;
        proxy_next_upstream error timeout http_502 http_503;
        proxy_next_upstream_tries 2;
        proxy_next_upstream_timeout 30s;
    }
}
`;

    const configPath = `/etc/nginx/sites-available/${project.subdomain}.ulyssepro.org`;
    const enabledPath = `/etc/nginx/sites-enabled/${project.subdomain}.ulyssepro.org`;
    const logs: string[] = [];

    await writeServerFile(configPath, nginxConfig);
    logs.push(`[1/3] Nginx config written: ${configPath}`);

    const linkResult = await runServerCommand(`ln -sf ${configPath} ${enabledPath} 2>&1`, 5000);
    logs.push(`[2/3] Symlink: ${linkResult.success ? "OK" : "FAILED"}`);

    const testResult = await runServerCommand(`nginx -t 2>&1`, 5000);
    if (testResult.success || testResult.output?.includes("successful")) {
      const reloadResult = await runServerCommand(`systemctl reload nginx 2>&1`, 5000);
      logs.push(`[3/3] Nginx reload: ${reloadResult.success ? "OK" : "FAILED"}`);
    } else {
      logs.push(`[3/3] Nginx test FAILED: ${testResult.error || testResult.output}`);
      return res.json({ success: false, logs, domain });
    }

    await db.update(irisProjects).set({ status: "configured", updatedAt: new Date() }).where(eq(irisProjects.id, id));
    res.json({ success: true, logs, domain });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/projects/:id/init-server", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [project] = await db.select().from(irisProjects).where(eq(irisProjects.id, id)).limit(1);
    if (!project) return res.status(404).json({ error: "Project not found" });
    const irisOwnerName = (req as any).irisOwnerName;
    if (irisOwnerName && project.ownerName !== irisOwnerName) return res.status(403).json({ error: "Access denied" });

    const appDir = `/var/www/apps/iris/${project.ownerName.toLowerCase()}/${project.subdomain}`;
    const logs: string[] = [];

    const mkdirResult = await runServerCommand(`mkdir -p ${appDir} 2>&1`, 5000);
    logs.push(`[1/3] Directory created: ${appDir}`);

    if (project.githubRepo) {
      const gitUrl = getAuthenticatedGitUrl(project.githubRepo);
      const existsResult = await runServerCommand(`test -d ${appDir}/.git && echo "EXISTS" || echo "MISSING"`, 5000);
      if (existsResult.output?.trim() === "MISSING") {
        const cloneResult = await runServerCommand(`cd ${appDir} && git clone ${gitUrl} . 2>&1`, 60000);
        logs.push(`[2/3] Git clone: ${cloneResult.success ? "OK" : "FAILED"}`);
        if (cloneResult.output) logs.push(cloneResult.output.split("\n").slice(0, 5).join("\n"));
      } else {
        await runServerCommand(`cd ${appDir} && git remote set-url origin ${gitUrl} 2>&1`, 5000);
        const pullResult = await runServerCommand(`cd ${appDir} && git pull origin main 2>&1`, 30000);
        logs.push(`[2/3] Git pull: ${pullResult.success ? "OK" : "FAILED"}`);
      }
    } else {
      logs.push(`[2/3] No GitHub repo configured, skipping clone`);
    }

    const hasPkgJson = await runServerCommand(`test -f ${appDir}/package.json && echo "YES" || echo "NO"`, 5000);
    if (hasPkgJson.output?.trim() === "YES") {
      const installResult = await runServerCommand(`cd ${appDir} && npm install 2>&1 | tail -5`, 120000);
      logs.push(`[3/3] npm install: ${installResult.success ? "OK" : "WARN"}`);
    } else {
      logs.push(`[3/3] No package.json, skipping install`);
    }

    await db.update(irisProjects).set({ status: "initialized", updatedAt: new Date() }).where(eq(irisProjects.id, id));
    res.json({ success: true, logs });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/projects/:id/deploy", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [project] = await db.select().from(irisProjects).where(eq(irisProjects.id, id)).limit(1);
    if (!project) return res.status(404).json({ error: "Project not found" });
    const irisOwnerName = (req as any).irisOwnerName;
    if (irisOwnerName && project.ownerName !== irisOwnerName) return res.status(403).json({ error: "Access denied" });

    const appDir = `/var/www/apps/iris/${project.ownerName.toLowerCase()}/${project.subdomain}`;
    const logs: string[] = [];

    const existsResult = await runServerCommand(`test -d ${appDir} && echo "EXISTS" || echo "MISSING"`, 5000);
    if (existsResult.output?.trim() !== "EXISTS") {
      return res.status(404).json({ error: `App directory ${appDir} not found. Initialize first.` });
    }
    logs.push(`[1/5] Directory: ${appDir}`);

    if (project.githubRepo) {
      const gitUrl = getAuthenticatedGitUrl(project.githubRepo);
      await runServerCommand(`cd ${appDir} && git remote set-url origin ${gitUrl} 2>&1`, 5000);
      const pullResult = await runServerCommand(`cd ${appDir} && git pull origin main 2>&1`, 30000);
      logs.push(`[2/5] Git pull: ${pullResult.success ? "OK" : "FAILED"}`);
      if (pullResult.output) logs.push(pullResult.output.split("\n").slice(0, 3).join("\n"));
    } else {
      logs.push(`[2/5] Git pull: skipped (no repo)`);
    }

    const hasPkgJson = await runServerCommand(`test -f ${appDir}/package.json && echo "YES" || echo "NO"`, 5000);
    if (hasPkgJson.output?.trim() === "YES") {
      const installResult = await runServerCommand(`cd ${appDir} && npm install --production=false 2>&1 | tail -5`, 120000);
      logs.push(`[3/5] npm install: ${installResult.success ? "OK" : "WARN"}`);

      const hasBuild = await runServerCommand(`cd ${appDir} && node -e "const p=require('./package.json'); process.exit(p.scripts?.build ? 0 : 1)" 2>/dev/null && echo "YES" || echo "NO"`, 5000);
      if (hasBuild.output?.trim() === "YES") {
        const buildResult = await runServerCommand(`cd ${appDir} && npm run build 2>&1 | tail -10`, 120000);
        logs.push(`[4/5] Build: ${buildResult.success ? "OK" : "FAILED"}`);
      } else {
        logs.push(`[4/5] Build: skipped`);
      }
    } else {
      logs.push(`[3/5] npm install: skipped`);
      logs.push(`[4/5] Build: skipped`);
    }

    const pm2Name = `iris-${project.ownerName.toLowerCase()}-${project.subdomain}`;
    const pm2Check = await runServerCommand(`pm2 describe ${pm2Name} 2>/dev/null | head -1`, 5000);
    if (pm2Check.success && pm2Check.output && !pm2Check.output.includes("doesn't exist")) {
      const restartResult = await runServerCommand(`pm2 restart ${pm2Name} --update-env 2>&1`, 15000);
      logs.push(`[5/5] PM2 restart ${pm2Name}: ${restartResult.success ? "OK" : "FAILED"}`);
    } else {
      const hasEcosystem = await runServerCommand(`test -f ${appDir}/ecosystem.config.cjs && echo "YES" || echo "NO"`, 5000);
      if (hasEcosystem.output?.trim() === "YES") {
        const startResult = await runServerCommand(`cd ${appDir} && pm2 start ecosystem.config.cjs --name ${pm2Name} 2>&1`, 15000);
        logs.push(`[5/5] PM2 start: ${startResult.success ? "OK" : "FAILED"}`);
      } else {
        logs.push(`[5/5] PM2: skipped (static site)`);
        await runServerCommand(`nginx -t 2>&1 && systemctl reload nginx`, 10000);
        logs.push(`Nginx reloaded for static site`);
      }
    }

    await runServerCommand(`pm2 save 2>/dev/null`, 5000);
    await db.update(irisProjects).set({ status: "deployed", lastDeployedAt: new Date(), updatedAt: new Date() }).where(eq(irisProjects.id, id));

    res.json({ success: true, output: logs.join("\n"), logs });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/projects/:id/status", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [project] = await db.select().from(irisProjects).where(eq(irisProjects.id, id)).limit(1);
    if (!project) return res.status(404).json({ error: "Project not found" });
    const irisOwnerName = (req as any).irisOwnerName;
    if (irisOwnerName && project.ownerName !== irisOwnerName) {
      return res.status(403).json({ error: "Access denied" });
    }

    const appDir = `/var/www/apps/iris/${project.ownerName.toLowerCase()}/${project.subdomain}`;
    const pm2Name = `iris-${project.ownerName.toLowerCase()}-${project.subdomain}`;

    const dirCheck = await runServerCommand(`test -d ${appDir} && echo "EXISTS" || echo "MISSING"`, 5000);
    const pm2Check = await runServerCommand(`pm2 jlist 2>/dev/null | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const j=JSON.parse(d);const p=j.find(x=>x.name==='${pm2Name}');console.log(JSON.stringify(p?{status:p.pm2_env.status,uptime:p.pm2_env.pm_uptime,restarts:p.pm2_env.restart_time,memory:p.monit?.memory}:{status:'not_running'}))" 2>/dev/null`, 10000);
    const domain = `${project.subdomain}.ulyssepro.org`;
    const nginxCheck = await runServerCommand(`test -f /etc/nginx/sites-enabled/${domain} && echo "CONFIGURED" || echo "MISSING"`, 5000);

    let pm2Status = { status: "unknown" };
    try { pm2Status = JSON.parse(pm2Check.output || "{}"); } catch {}

    res.json({
      project,
      server: {
        directoryExists: dirCheck.output?.trim() === "EXISTS",
        pm2: pm2Status,
        nginxConfigured: nginxCheck.output?.trim() === "CONFIGURED",
        domain,
        url: `https://${domain}`
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
