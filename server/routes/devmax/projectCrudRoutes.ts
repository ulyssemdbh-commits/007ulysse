import { Router, Request, Response } from "express";
  import { db } from "../../db";
  import { devmaxSessions, devmaxActivityLog } from "@shared/schema";
  import { eq, and, gt } from "drizzle-orm";
  import { sql } from "drizzle-orm";
  import { randomUUID } from "crypto";
  import { githubService, withGitHubToken } from "../../services/githubService";
  import { devmaxStorage } from "../../services/devmaxStorage";
  import {
    hashPin, verifyPin, hashPassword, verifyPassword,
    requireDevmaxAuth, logDevmaxActivity, getProjectGitHubToken,
    checkPlanLimits, sendDevmaxNotification, getSessionUser,
    verifyProjectAccess, SESSION_DURATION_MS, MAX_LOGIN_ATTEMPTS,
    LOCKOUT_DURATION_MS, requireAdminAuth, ADMIN_PIN, logAdminAudit,
    getPlanLimits
  } from "./devmaxMiddleware";
  
  const router = Router();

  router.get("/projects", async (req: Request, res: Response) => {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const [session] = await db.select().from(devmaxSessions)
      .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
      .limit(1);
    if (!session) return res.status(401).json({ error: "Session expired" });

    const showArchived = req.query.showArchived === "true";
    let projects;
    if (session.tenantId) {
      projects = await db.execute(sql`
        SELECT * FROM devmax_projects WHERE tenant_id = ${session.tenantId}
        ${showArchived ? sql`` : sql`AND (status IS NULL OR status != 'archived')`}
        ORDER BY updated_at DESC
      `);
    } else {
      projects = await db.execute(sql`
        SELECT * FROM devmax_projects WHERE fingerprint = ${session.fingerprint}
        ${showArchived ? sql`` : sql`AND (status IS NULL OR status != 'archived')`}
        ORDER BY updated_at DESC
      `);
    }
    res.json(projects.rows || []);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/projects", async (req: Request, res: Response) => {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const [session] = await db.select().from(devmaxSessions)
      .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
      .limit(1);
    if (!session) return res.status(401).json({ error: "Session expired" });

    const { name, description, repoOwner, repoName, deploySlug, template, stagingRepoOwner, stagingRepoName, storageMode } = req.body;
    if (!name) return res.status(400).json({ error: "Nom du projet requis" });

    if (session.tenantId) {
      try {
        const [tenant] = await db.execute(sql`SELECT plan_limits FROM devmax_tenants WHERE id = ${session.tenantId}`).then((r: any) => r.rows || r);
        if (tenant?.plan_limits) {
          const limits = typeof tenant.plan_limits === "string" ? JSON.parse(tenant.plan_limits) : tenant.plan_limits;
          const maxProjects = limits.max_projects ?? 3;
          if (maxProjects !== -1) {
            const [countResult] = await db.execute(sql`SELECT COUNT(*) as count FROM devmax_projects WHERE tenant_id = ${session.tenantId} AND (status IS NULL OR status != 'archived')`).then((r: any) => r.rows || r);
            const currentCount = parseInt(countResult?.count || "0");
            if (currentCount >= maxProjects) {
              return res.status(403).json({ error: `Limite de projets atteinte (${currentCount}/${maxProjects}). Passez à un plan supérieur pour créer plus de projets.` });
            }
          }
        }
      } catch {}
    }

    const id = randomUUID();
    const repoUrl = repoOwner && repoName ? `https://github.com/${repoOwner}/${repoName}` : null;
    const stagingRepoUrl = stagingRepoOwner && stagingRepoName ? `https://github.com/${stagingRepoOwner}/${stagingRepoName}` : null;
    const slug = (deploySlug || repoName || name).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    const resolvedStorageMode = storageMode || (repoOwner && repoName ? "github" : "db");

    const stagingUrl = slug ? `https://${slug}-dev.ulyssepro.org` : null;
    const productionUrl = slug ? `https://${slug}.ulyssepro.org` : null;

    await db.execute(sql`
      INSERT INTO devmax_projects (id, fingerprint, name, description, repo_owner, repo_name, repo_url, staging_repo_owner, staging_repo_name, staging_repo_url, storage_mode, deploy_slug, staging_url, production_url, deploy_url, tenant_id)
      VALUES (${id}, ${session.fingerprint}, ${name}, ${description || null}, ${repoOwner || null}, ${repoName || null}, ${repoUrl}, ${stagingRepoOwner || null}, ${stagingRepoName || null}, ${stagingRepoUrl}, ${resolvedStorageMode}, ${slug}, ${stagingUrl}, ${productionUrl}, ${productionUrl}, ${session.tenantId || null})
    `);

    let reservedPorts: { stagingPort: number; productionPort: number } | null = null;
    if (slug) {
      try {
        const { sshService } = await import("../../services/sshService");
        reservedPorts = await sshService.reserveProjectPorts(id, "max");
        console.log(`[DevMax] Ports reserved for ${name}: staging=${reservedPorts.stagingPort} prod=${reservedPorts.productionPort}`);
      } catch (e: any) {
        console.error(`[DevMax] Port reservation failed for ${name}:`, e.message);
      }
    }

    await logDevmaxActivity(req, "create_project", name, { id, repoOwner, repoName, deploySlug: slug, template: template || null, ports: reservedPorts });

    if (session.tenantId) {
      db.execute(sql`INSERT INTO devmax_usage_logs (tenant_id, action, details) VALUES (${session.tenantId}, 'create_project', ${JSON.stringify({ projectId: id, name, template: template || null })})`).catch(() => {});
    }

    res.json({ id, name, description, repoOwner, repoName, repoUrl, stagingRepoOwner, stagingRepoName, stagingRepoUrl, storageMode: resolvedStorageMode, deploySlug: slug, template: template || null, stagingUrl, productionUrl, ports: reservedPorts });

    if (slug) {
      import("../../services/sshService").then(({ sshService }) => {
        sshService.deployPlaceholderPages(slug, name).then(result => {
          console.log(`[DevMax] Placeholder pages for ${name}: ${result.success ? "OK" : "FAILED"} — ${result.message}`);
        }).catch(err => {
          console.error(`[DevMax] Placeholder pages failed for ${name}:`, err.message);
        });
      });
    }

    if (repoOwner && repoName && slug) {
      autoDeployProject(id, repoOwner, repoName, slug, name, template || null).catch(err => {
        console.error(`[DevMax] Auto-deploy failed for ${name}:`, err.message);
      });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

async function autoDeployProject(projectId: string, repoOwner: string, repoName: string, slug: string, projectName: string, template?: string | null) {
  const logs: string[] = [];
  console.log(`[DevMax] Auto-deploy starting for ${projectName} (${slug})${template ? ` [template: ${template}]` : ""}`);

  const projectGhToken = await getProjectGitHubToken(projectId);
  const runWithToken = <T>(fn: () => Promise<T>): Promise<T> => {
    if (projectGhToken) return withGitHubToken(projectGhToken, fn);
    return fn();
  };

  try {
    const existingRepo = await runWithToken(() => githubService.getRepo(repoOwner, repoName)).catch(() => null);
    if (!existingRepo) {
      console.log(`[DevMax] Creating GitHub repo: ${repoOwner}/${repoName}`);
      await runWithToken(() => githubService.createRepo(repoName, {
        description: `${projectName} — managed by MaxAI / DevMax`,
        isPrivate: false,
        autoInit: true,
      }));
      logs.push(`GitHub repo created: ${repoOwner}/${repoName}`);
    } else {
      logs.push(`GitHub repo exists: ${repoOwner}/${repoName}`);
    }

    if (template && ["express-api", "react-vite", "fullstack", "nextjs", "static-html"].includes(template)) {
      try {
        console.log(`[DevMax] Applying template "${template}" to ${repoOwner}/${repoName}`);
        const { applyPatch } = await import("../../services/githubService");
        const scaffoldTemplates: Record<string, { files: Array<{ path: string; content: string }>; deps: string; devDeps: string; buildCmd?: string; description: string }> = {
          "express-api": {
            description: "Express.js REST API with TypeScript",
            deps: "express cors helmet morgan dotenv",
            devDeps: "typescript @types/express @types/cors @types/morgan @types/node ts-node nodemon",
            files: [
              { path: "src/index.ts", content: `import express from "express";\nimport cors from "cors";\nimport helmet from "helmet";\nimport morgan from "morgan";\nimport dotenv from "dotenv";\n\ndotenv.config();\nconst app = express();\nconst PORT = parseInt(process.env.PORT || "3000", 10);\n\napp.use(cors());\napp.use(helmet());\napp.use(morgan("combined"));\napp.use(express.json());\napp.use(express.urlencoded({ extended: true }));\n\napp.get("/", (req, res) => res.json({ name: "${projectName}", status: "running", version: "1.0.0" }));\napp.get("/api/health", (req, res) => res.json({ status: "ok", timestamp: new Date().toISOString(), uptime: process.uptime() }));\n\napp.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {\n  console.error(err.stack);\n  res.status(500).json({ error: "Internal Server Error" });\n});\n\napp.listen(PORT, "0.0.0.0", () => console.log(\`Server running on port \${PORT}\`));\n` },
              { path: "tsconfig.json", content: `{"compilerOptions":{"target":"ES2020","module":"commonjs","lib":["ES2020"],"outDir":"./dist","rootDir":"./src","strict":true,"esModuleInterop":true,"skipLibCheck":true,"forceConsistentCasingInFileNames":true,"resolveJsonModule":true},"include":["src/**/*"]}` },
              { path: ".env.example", content: `PORT=3000\nNODE_ENV=development\nDATABASE_URL=postgresql://user:pass@localhost:5432/dbname` },
              { path: ".gitignore", content: `node_modules/\ndist/\n.env\n*.log` },
            ],
          },
          "react-vite": {
            description: "React + Vite + TypeScript SPA",
            deps: "react react-dom",
            devDeps: "typescript @types/react @types/react-dom vite @vitejs/plugin-react",
            files: [
              { path: "index.html", content: `<!DOCTYPE html>\n<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${projectName}</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>` },
              { path: "src/main.tsx", content: `import { StrictMode } from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./index.css";\n\ncreateRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);` },
              { path: "src/App.tsx", content: `export default function App() {\n  return <div className="app"><h1>${projectName}</h1><p>Ready to build.</p></div>;\n}` },
              { path: "src/index.css", content: `*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;min-height:100vh}.app{max-width:1200px;margin:0 auto;padding:2rem}` },
              { path: "vite.config.ts", content: `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\n\nexport default defineConfig({ plugins: [react()] });` },
              { path: "tsconfig.json", content: `{"compilerOptions":{"target":"ES2020","useDefineForClassFields":true,"lib":["ES2020","DOM","DOM.Iterable"],"module":"ESNext","skipLibCheck":true,"moduleResolution":"bundler","allowImportingTsExtensions":true,"resolveJsonModule":true,"isolatedModules":true,"noEmit":true,"jsx":"react-jsx","strict":true},"include":["src"]}` },
              { path: ".gitignore", content: `node_modules/\ndist/\n.env\n*.log` },
            ],
          },
          "fullstack": {
            description: "Express API + React frontend (monorepo)",
            deps: "express cors helmet dotenv react react-dom",
            devDeps: "typescript @types/express @types/cors @types/node @types/react @types/react-dom vite @vitejs/plugin-react concurrently ts-node nodemon",
            buildCmd: "tsc && cd client && npx vite build",
            files: [
              { path: "server/index.ts", content: `import express from "express";\nimport cors from "cors";\nimport helmet from "helmet";\nimport path from "path";\nimport dotenv from "dotenv";\n\ndotenv.config();\nconst app = express();\nconst PORT = parseInt(process.env.PORT || "3000", 10);\n\napp.use(cors());\napp.use(helmet());\napp.use(express.json());\napp.use(express.urlencoded({ extended: true }));\n\nconst clientDist = path.join(__dirname, "../client/dist");\napp.use(express.static(clientDist));\n\napp.get("/api/health", (req, res) => res.json({ status: "ok", timestamp: new Date().toISOString(), uptime: process.uptime() }));\n\napp.get("*", (req, res) => {\n  if (!req.path.startsWith("/api")) {\n    res.sendFile(path.join(clientDist, "index.html"));\n  }\n});\n\napp.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {\n  console.error(err.stack);\n  res.status(500).json({ error: "Internal Server Error" });\n});\n\napp.listen(PORT, "0.0.0.0", () => console.log(\`Server running on port \${PORT}\`));\n` },
              { path: "client/index.html", content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${projectName}</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>` },
              { path: "client/src/main.tsx", content: `import { StrictMode } from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App";\n\ncreateRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);` },
              { path: "client/src/App.tsx", content: `import { useState, useEffect } from "react";\n\nexport default function App() {\n  const [status, setStatus] = useState("");\n  useEffect(() => { fetch("/api/health").then(r=>r.json()).then(d=>setStatus(d.status)).catch(()=>setStatus("offline")); }, []);\n  return <div style={{maxWidth:"1200px",margin:"0 auto",padding:"2rem"}}><h1>${projectName}</h1><p>API Status: <strong>{status || "loading..."}</strong></p></div>;\n}` },
              { path: "client/vite.config.ts", content: `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\n\nexport default defineConfig({ plugins: [react()], server: { proxy: { "/api": "http://localhost:3000" } } });` },
              { path: "tsconfig.json", content: `{"compilerOptions":{"target":"ES2020","module":"commonjs","lib":["ES2020"],"outDir":"./dist","rootDir":"./server","strict":true,"esModuleInterop":true,"skipLibCheck":true},"include":["server/**/*"]}` },
              { path: ".env.example", content: `PORT=3000\nNODE_ENV=development` },
              { path: ".gitignore", content: `node_modules/\ndist/\nclient/dist/\n.env\n*.log` },
            ],
          },
          "nextjs": {
            description: "Next.js 14 with App Router",
            deps: "next react react-dom",
            devDeps: "typescript @types/react @types/react-dom @types/node",
            buildCmd: "npx next build",
            files: [
              { path: "app/layout.tsx", content: `export const metadata = { title: "${projectName}", description: "Built with Next.js" };\n\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return <html lang="en"><body>{children}</body></html>;\n}` },
              { path: "app/page.tsx", content: `export default function Home() {\n  return <main><h1>${projectName}</h1><p>Ready to build.</p></main>;\n}` },
              { path: "app/api/health/route.ts", content: `import { NextResponse } from "next/server";\n\nexport async function GET() {\n  return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() });\n}` },
              { path: "next.config.js", content: `/** @type {import('next').NextConfig} */\nmodule.exports = { reactStrictMode: true };` },
              { path: "tsconfig.json", content: `{"compilerOptions":{"target":"es5","lib":["dom","dom.iterable","esnext"],"allowJs":true,"skipLibCheck":true,"strict":true,"noEmit":true,"esModuleInterop":true,"module":"esnext","moduleResolution":"bundler","resolveJsonModule":true,"isolatedModules":true,"jsx":"preserve","incremental":true,"plugins":[{"name":"next"}],"paths":{"@/*":["./*"]}},"include":["next-env.d.ts","**/*.ts","**/*.tsx",".next/types/**/*.ts"],"exclude":["node_modules"]}` },
              { path: ".gitignore", content: `node_modules/\n.next/\n.env\n*.log` },
            ],
          },
          "static-html": {
            description: "Static HTML/CSS/JS website",
            deps: "",
            devDeps: "",
            files: [
              { path: "index.html", content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${projectName}</title><link rel="stylesheet" href="style.css"/></head><body><header><h1>${projectName}</h1></header><main><p>Ready to build.</p></main><script src="script.js"></script></body></html>` },
              { path: "style.css", content: `*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;min-height:100vh;background:#f8f9fa}header{background:#1a1a2e;color:white;padding:2rem;text-align:center}main{max-width:1200px;margin:2rem auto;padding:0 1rem}` },
              { path: "script.js", content: `document.addEventListener("DOMContentLoaded", () => {\n  console.log("${projectName} loaded");\n});` },
              { path: ".gitignore", content: `node_modules/\n.env\n*.log` },
            ],
          },
        };
        const tmpl = scaffoldTemplates[template];
        if (tmpl) {
          const blobs = [...tmpl.files];
          const pkgJson: any = { name: repoName, version: "1.0.0", description: tmpl.description, scripts: {} };
          if (template === "express-api") {
            pkgJson.scripts = { dev: "nodemon --exec ts-node src/index.ts", build: "tsc", start: "node dist/index.js", test: "jest --passWithNoTests", "test:watch": "jest --watch" };
            tmpl.devDeps += " jest ts-jest @types/jest supertest @types/supertest";
            blobs.push({ path: "src/__tests__/health.test.ts", content: `import { describe, it, expect } from "@jest/globals";\n\ndescribe("Health Check", () => {\n  it("should return status ok", async () => {\n    const res = await fetch("http://localhost:3000/api/health");\n    const data = await res.json();\n    expect(data.status).toBe("ok");\n    expect(data.timestamp).toBeDefined();\n  });\n});\n` });
            blobs.push({ path: "jest.config.js", content: `module.exports = {\n  preset: "ts-jest",\n  testEnvironment: "node",\n  roots: ["<rootDir>/src"],\n  testMatch: ["**/__tests__/**/*.test.ts"],\n};\n` });
          }
          else if (template === "react-vite") {
            pkgJson.scripts = { dev: "vite", build: "vite build", preview: "vite preview", test: "vitest run", "test:watch": "vitest" };
            tmpl.devDeps += " vitest @testing-library/react @testing-library/jest-dom jsdom";
            blobs.push({ path: "src/__tests__/App.test.tsx", content: `import { describe, it, expect } from "vitest";\nimport { render, screen } from "@testing-library/react";\nimport App from "../App";\n\ndescribe("App", () => {\n  it("renders without crashing", () => {\n    render(<App />);\n    expect(document.querySelector(".app")).toBeTruthy();\n  });\n});\n` });
            blobs.push({ path: "vitest.config.ts", content: `import { defineConfig } from "vitest/config";\nimport react from "@vitejs/plugin-react";\n\nexport default defineConfig({\n  plugins: [react()],\n  test: {\n    environment: "jsdom",\n    globals: true,\n  },\n});\n` });
          }
          else if (template === "fullstack") {
            pkgJson.scripts = { dev: "concurrently \"nodemon --exec ts-node server/index.ts\" \"cd client && vite\"", build: "tsc && cd client && vite build", start: "node dist/index.js", test: "jest --passWithNoTests", "test:watch": "jest --watch" };
            tmpl.devDeps += " jest ts-jest @types/jest supertest @types/supertest";
            blobs.push({ path: "server/__tests__/health.test.ts", content: `import { describe, it, expect } from "@jest/globals";\n\ndescribe("API Health", () => {\n  it("should return status ok", async () => {\n    const res = await fetch("http://localhost:3000/api/health");\n    const data = await res.json();\n    expect(data.status).toBe("ok");\n  });\n});\n` });
            blobs.push({ path: "jest.config.js", content: `module.exports = {\n  preset: "ts-jest",\n  testEnvironment: "node",\n  roots: ["<rootDir>/server"],\n  testMatch: ["**/__tests__/**/*.test.ts"],\n};\n` });
          }
          else if (template === "nextjs") {
            pkgJson.scripts = { dev: "next dev", build: "next build", start: "next start -p $PORT", test: "jest --passWithNoTests" };
            tmpl.devDeps += " jest @testing-library/react @testing-library/jest-dom jest-environment-jsdom";
            blobs.push({ path: "app/__tests__/page.test.tsx", content: `import { render } from "@testing-library/react";\nimport Home from "../page";\n\ndescribe("Home", () => {\n  it("renders without crashing", () => {\n    const { container } = render(<Home />);\n    expect(container.querySelector("main")).toBeTruthy();\n  });\n});\n` });
          }
          if (tmpl.deps) {
            pkgJson.dependencies = {};
            tmpl.deps.split(" ").filter(Boolean).forEach((d: string) => { pkgJson.dependencies[d] = "latest"; });
          }
          if (tmpl.devDeps) {
            pkgJson.devDependencies = {};
            tmpl.devDeps.split(" ").filter(Boolean).forEach((d: string) => { pkgJson.devDependencies[d] = "latest"; });
          }
          if (Object.keys(pkgJson.scripts).length > 0 || tmpl.deps || tmpl.devDeps) {
            blobs.push({ path: "package.json", content: JSON.stringify(pkgJson, null, 2) });
          }
          blobs.push({ path: "README.md", content: `# ${projectName}\n\n${tmpl.description}\n\nManaged by MaxAI / DevMax.\n\n## Setup\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n` });
          await new Promise(resolve => setTimeout(resolve, 2000));
          await runWithToken(() => applyPatch(repoOwner, repoName, "main", blobs, `scaffold: ${template} project structure`));
          logs.push(`Template "${template}" applied: ${blobs.length} files created`);
          console.log(`[DevMax] Template "${template}" applied to ${repoOwner}/${repoName}: ${blobs.map(b => b.path).join(", ")}`);
        }
      } catch (tmplErr: any) {
        console.error(`[DevMax] Template apply failed:`, tmplErr.message);
        logs.push(`Template apply warning: ${tmplErr.message?.substring(0, 200)}`);
      }
    }

    const stagingRepoName = `${repoName}-test`;
    const existingStaging = await runWithToken(() => githubService.getRepo(repoOwner, stagingRepoName)).catch(() => null);
    if (!existingStaging) {
      console.log(`[DevMax] Creating staging repo: ${repoOwner}/${stagingRepoName}`);
      await runWithToken(() => githubService.createRepo(stagingRepoName, {
        description: `Staging clone of ${repoName} — auto-managed by Ulysse AI`,
        isPrivate: true,
        autoInit: false,
      }));
      logs.push(`Staging repo created: ${repoOwner}/${stagingRepoName}`);
    } else {
      logs.push(`Staging repo exists: ${repoOwner}/${stagingRepoName}`);
    }

    const { sshService } = await import("../../services/sshService");

    const ghToken = projectGhToken || await sshService.resolveGitHubToken();
    if (ghToken) {
      const mirrorResult = await sshService.executeCommand(
        `cd /tmp && rm -rf _staging_mirror_${slug} && ` +
        `git clone --mirror https://x-access-token:${ghToken}@github.com/${repoOwner}/${repoName}.git _staging_mirror_${slug} 2>&1 && ` +
        `cd _staging_mirror_${slug} && ` +
        `git remote set-url --push origin https://x-access-token:${ghToken}@github.com/${repoOwner}/${stagingRepoName}.git && ` +
        `git push --mirror 2>&1 && ` +
        `cd /tmp && rm -rf _staging_mirror_${slug}`,
        120000
      );
      logs.push(mirrorResult.success ? `Code mirrored to staging repo` : `Mirror warning: ${mirrorResult.error?.substring(0, 200)}`);
    }

    const reserved = await sshService.reserveProjectPorts(projectId, "max");
    console.log(`[DevMax] Deploying staging: ${slug}-dev.ulyssepro.org (port ${reserved.stagingPort})`);
    const stagingResult = await sshService.deployStagingApp({
      repoUrl: `https://github.com/${repoOwner}/${stagingRepoName}.git`,
      appName: slug,
      branch: "main",
      port: reserved.stagingPort,
      caller: "max",
    });
    logs.push(stagingResult.success ? `Staging deployed: ${stagingResult.stagingUrl} (port ${reserved.stagingPort})` : `Staging deploy: ${stagingResult.message}`);

    if (stagingResult.success) {
      await db.execute(sql`
        UPDATE devmax_projects 
        SET staging_url = ${stagingResult.stagingUrl || null}, 
            staging_port = ${reserved.stagingPort},
            environment = 'staging',
            last_deployed_at = NOW(),
            updated_at = NOW()
        WHERE id = ${projectId}
      `);

      console.log(`[DevMax] Promoting to production: ${slug}.ulyssepro.org (port ${reserved.productionPort})`);
      const prodResult = await sshService.promoteToProduction({
        appName: slug,
        port: reserved.productionPort,
        caller: "max",
      });
      logs.push(prodResult.success ? `Production deployed: ${prodResult.productionUrl} (port ${reserved.productionPort})` : `Production: ${prodResult.message}`);

      if (prodResult.success) {
        sshService.removePlaceholderPages(slug).catch(() => {});
        await db.execute(sql`
          UPDATE devmax_projects 
          SET production_url = ${prodResult.productionUrl || null},
              deploy_url = ${prodResult.productionUrl || null},
              production_port = ${reserved.productionPort},
              environment = 'production',
              last_promoted_at = NOW(),
              updated_at = NOW()
          WHERE id = ${projectId}
        `);
      }
    }

    console.log(`[DevMax] Auto-deploy complete for ${projectName}. Running URL diagnostics...`);

    const stagingDomain = `${slug}-dev.ulyssepro.org`;
    const prodDomain = `${slug}.ulyssepro.org`;
    const repoUrl = `https://github.com/${repoOwner}/${repoName}.git`;

    try {
      const stagingDiag = await sshService.diagnoseAndFixUrl({
        domain: stagingDomain, appName: slug, autoFix: true, repoUrl, caller: "max",
      });
      logs.push(`Staging diagnosis: ${stagingDiag.finalStatus}`);
      if (stagingDiag.fixes.length > 0) logs.push(`Staging fixes: ${stagingDiag.fixes.join(", ")}`);
      console.log(`[DevMax] Staging URL diag: HTTP ${stagingDiag.httpCode}, issues=${stagingDiag.issues.length}, fixes=${stagingDiag.fixes.length}`);
    } catch (diagErr: any) {
      logs.push(`Staging diagnosis error: ${diagErr.message}`);
    }

    try {
      const prodDiag = await sshService.diagnoseAndFixUrl({
        domain: prodDomain, appName: slug, autoFix: true, repoUrl, caller: "max",
      });
      logs.push(`Production diagnosis: ${prodDiag.finalStatus}`);
      if (prodDiag.fixes.length > 0) logs.push(`Production fixes: ${prodDiag.fixes.join(", ")}`);
      console.log(`[DevMax] Production URL diag: HTTP ${prodDiag.httpCode}, issues=${prodDiag.issues.length}, fixes=${prodDiag.fixes.length}`);
    } catch (diagErr: any) {
      logs.push(`Production diagnosis error: ${diagErr.message}`);
    }

    console.log(`[DevMax] Auto-deploy + diagnostics complete for ${projectName}:`, logs.join(" | "));
    await db.execute(sql`
      INSERT INTO devmax_activity_log (session_id, action, target, details, created_at) 
      VALUES (${'system'}, ${'auto_deploy'}, ${projectName}, ${JSON.stringify({ logs, projectId, slug })}, NOW())
    `);
  } catch (err: any) {
    console.error(`[DevMax] Auto-deploy error for ${projectName}:`, err.message);
    logs.push(`Error: ${err.message}`);
  }
}

router.put("/projects/:projectId", async (req: Request, res: Response) => {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const [session] = await db.select().from(devmaxSessions)
      .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
      .limit(1);
    if (!session) return res.status(401).json({ error: "Session expired" });

    const { projectId } = req.params;
    const project = await db.execute(sql`
      SELECT * FROM devmax_projects WHERE id = ${projectId}
    `);
    if (!project.rows?.length) return res.status(404).json({ error: "Projet non trouve" });

    const proj = project.rows[0];
    if (session.tenantId && proj.tenant_id && proj.tenant_id !== session.tenantId) {
      return res.status(403).json({ error: "Accès refusé: ce projet appartient à un autre tenant" });
    }
    if (!session.tenantId && proj.fingerprint !== session.fingerprint) {
      return res.status(403).json({ error: "Accès refusé à ce projet" });
    }

    const { name, description, repoOwner, repoName, deploySlug, stagingRepoOwner, stagingRepoName, storageMode } = req.body;
    const repoUrl = repoOwner && repoName ? `https://github.com/${repoOwner}/${repoName}` : null;
    const stagingRepoUrl = stagingRepoOwner && stagingRepoName ? `https://github.com/${stagingRepoOwner}/${stagingRepoName}` : null;
    const slug = deploySlug ? deploySlug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") : null;

    await db.execute(sql`
      UPDATE devmax_projects SET
        name = COALESCE(${name || null}, name),
        description = ${description ?? null},
        repo_owner = ${repoOwner || null},
        repo_name = ${repoName || null},
        repo_url = ${repoUrl},
        staging_repo_owner = ${stagingRepoOwner || null},
        staging_repo_name = ${stagingRepoName || null},
        staging_repo_url = ${stagingRepoUrl},
        storage_mode = COALESCE(${storageMode || null}, storage_mode),
        deploy_slug = COALESCE(${slug}, deploy_slug),
        updated_at = NOW()
      WHERE id = ${projectId}
    `);

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/projects/:projectId", async (req: Request, res: Response) => {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const [session] = await db.select().from(devmaxSessions)
      .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
      .limit(1);
    if (!session) return res.status(401).json({ error: "Session expired" });

    const { projectId } = req.params;

    const [project] = await db.execute(sql`SELECT deploy_slug, tenant_id, fingerprint FROM devmax_projects WHERE id = ${projectId}`).then((r: any) => r.rows || r);
    if (!project) return res.status(404).json({ error: "Projet non trouvé" });

    if (session.tenantId && project.tenant_id && project.tenant_id !== session.tenantId) {
      return res.status(403).json({ error: "Accès refusé: ce projet appartient à un autre tenant" });
    }
    if (!session.tenantId && project.fingerprint !== session.fingerprint) {
      return res.status(403).json({ error: "Accès refusé à ce projet" });
    }

    const slug = project?.deploy_slug;

    const cleanupLogs: string[] = [];

    if (slug) {
      try {
        const { sshService } = await import("../../services/sshService");
        const prodResult = await sshService.apps.deleteApp(slug);
        cleanupLogs.push(`Prod app cleanup: ${prodResult}`);
      } catch (e: any) {
        cleanupLogs.push(`Prod app cleanup error: ${e.message}`);
      }

      try {
        const { sshService } = await import("../../services/sshService");
        const stagingResult = await sshService.apps.deleteApp(`${slug}-dev`);
        cleanupLogs.push(`Staging app cleanup: ${stagingResult}`);
      } catch (e: any) {
        cleanupLogs.push(`Staging app cleanup error: ${e.message}`);
      }

      try {
        const cloudflareService = await import("../../services/cloudflareService").then(m => m.default || m);
        const dnsResult = await cloudflareService.removeDnsRecords(slug);
        cleanupLogs.push(`DNS cleanup: removed ${dnsResult.removed.length} records (${dnsResult.removed.join(", ")})`);
      } catch (e: any) {
        cleanupLogs.push(`DNS cleanup error: ${e.message}`);
      }
    }

    await db.execute(sql`DELETE FROM devmax_deployments WHERE project_id = ${projectId}`).catch(() => {});
    await db.execute(sql`DELETE FROM devmax_env_vars WHERE project_id = ${projectId}`).catch(() => {});
    await db.execute(sql`DELETE FROM devmax_secrets WHERE project_id = ${projectId}`).catch(() => {});
    await db.execute(sql`DELETE FROM devmax_custom_domains WHERE project_id = ${projectId}`).catch(() => {});
    await db.execute(sql`DELETE FROM devmax_logs WHERE project_id = ${projectId}`).catch(() => {});
    await db.execute(sql`DELETE FROM devmax_metrics WHERE project_id = ${projectId}`).catch(() => {});
    await db.execute(sql`DELETE FROM devmax_github_events WHERE project_id = ${projectId}`).catch(() => {});

    await db.execute(sql`DELETE FROM devmax_projects WHERE id = ${projectId}`);

    console.log(`[DevMax] Project ${slug || projectId} deleted. Cleanup: ${cleanupLogs.join(" | ")}`);
    await logDevmaxActivity(req, "delete_project", projectId, { slug, cleanup: cleanupLogs });
    res.json({ success: true, cleanup: cleanupLogs });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/projects/:projectId", async (req: Request, res: Response) => {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const [session] = await db.select().from(devmaxSessions)
      .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
      .limit(1);
    if (!session) return res.status(401).json({ error: "Session expired" });

    const project = await db.execute(sql`SELECT * FROM devmax_projects WHERE id = ${req.params.projectId}`);
    if (!project.rows?.length) return res.status(404).json({ error: "Projet non trouvé" });
    const proj = project.rows[0] as any;
    if (session.tenantId && proj.tenant_id && proj.tenant_id !== session.tenantId) {
      return res.status(403).json({ error: "Accès refusé: ce projet appartient à un autre tenant" });
    }
    if (!session.tenantId && proj.fingerprint !== session.fingerprint) {
      return res.status(403).json({ error: "Accès refusé à ce projet" });
    }

    res.json(proj);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});


  export default router;
  