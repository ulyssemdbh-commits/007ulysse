import type { SSHService } from "./core";
import { staticNginxBlock, proxyNginxBlock, pm2EcosystemConfig, sslCertForDomain, normalizeNginxName, nginxCleanupCmd, resolveAppDomain } from "./helpers";

export function createDeployMethods(service: SSHService) {
  return {
    async deployApp(params: {
      repoUrl: string;
      appName: string;
      branch?: string;
      port?: number;
      buildCmd?: string;
      startCmd?: string;
      envVars?: Record<string, string>;
      domain?: string;
      createDb?: boolean;
      dbName?: string;
      dbUser?: string;
      dbPassword?: string;
      ssl?: boolean;
      forceStatic?: boolean;
      caller?: "max" | "ulysse" | "iris";
      copyEnvFrom?: string;
      devmaxProjectId?: string;
    }): Promise<{ success: boolean; message: string; url?: string; port?: number; httpCode?: string; logs?: string[] }> {
      const { repoUrl, appName: rawAppName, branch = "main", buildCmd, startCmd, envVars = {}, domain, createDb, dbName, dbUser, dbPassword, ssl, caller = "ulysse", copyEnvFrom, devmaxProjectId } = params;
      const appName = rawAppName?.toLowerCase()?.trim();
      if (!appName || appName === "undefined" || appName === "null") {
        return { success: false, message: `Invalid app name: "${rawAppName}". A valid app name is required.` };
      }
      const appDir = `/var/www/apps/${appName}`;
      const logs: string[] = [];

      if (devmaxProjectId) {
        try {
          const { db } = await import("../../db");
          const { sql } = await import("drizzle-orm");
          const SECRETS_KEY = process.env.SECRETS_ENCRYPTION_KEY || process.env.SESSION_SECRET || "ulysse-devmax-secrets-key-2026";
          const crypto = await import("crypto");

          const environment = appName.endsWith("-dev") ? "staging" : "production";

          const envVarsRows = await db.execute(sql`
            SELECT key, value FROM devmax_env_vars 
            WHERE project_id = ${devmaxProjectId} AND (environment = ${environment} OR environment = 'all')
          `).then((r: any) => r.rows || r);

          let envVarCount = 0;
          for (const row of envVarsRows) {
            if (row.key && row.value !== undefined && row.key !== "PORT") {
              if (!envVars[row.key]) {
                envVars[row.key] = row.value;
                envVarCount++;
              }
            }
          }

          const secretsRows = await db.execute(sql`
            SELECT key, encrypted_value FROM devmax_secrets 
            WHERE project_id = ${devmaxProjectId} AND (environment = ${environment} OR environment = 'all')
          `).then((r: any) => r.rows || r);

          let secretCount = 0;
          for (const row of secretsRows) {
            if (row.key && row.encrypted_value && row.key !== "PORT") {
              try {
                const [ivHex, encHex] = row.encrypted_value.split(":");
                if (ivHex && encHex) {
                  const iv = Buffer.from(ivHex, "hex");
                  const key = crypto.scryptSync(SECRETS_KEY, "salt", 32);
                  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
                  let decrypted = decipher.update(encHex, "hex", "utf8");
                  decrypted += decipher.final("utf8");
                  if (!envVars[row.key]) {
                    envVars[row.key] = decrypted;
                    secretCount++;
                  }
                }
              } catch (decErr) {
                console.error(`[Deploy] Failed to decrypt secret ${row.key}:`, decErr);
              }
            }
          }

          if (envVarCount > 0 || secretCount > 0) {
            logs.push(`[0/8] DevMax DB: loaded ${envVarCount} env var(s) + ${secretCount} secret(s) for ${environment}`);
            console.log(`[Deploy] DevMax project ${devmaxProjectId}: ${envVarCount} env vars + ${secretCount} secrets → ${appName}`);
          } else {
            logs.push(`[0/8] DevMax DB: no env vars or secrets found for project ${devmaxProjectId}`);
          }
        } catch (dbErr: any) {
          console.error(`[Deploy] DevMax secrets lookup failed:`, dbErr.message);
          logs.push(`[0/8] DevMax DB: ⚠️ failed to load secrets — ${dbErr.message}`);
        }
      }

      let resolvedEnvSource = copyEnvFrom;
      if (!resolvedEnvSource && Object.keys(envVars).filter(k => k !== "NODE_ENV" && k !== "PORT").length === 0) {
        const pm2ListResult = await service.executeCommand(`pm2 jlist 2>/dev/null || echo "[]"`, 10000);
        try {
          const pm2Apps: any[] = JSON.parse(pm2ListResult.output || "[]");
          const runningNames = pm2Apps.filter(a => a.pm2_env?.status === "online").map(a => a.name);
          const normalizedAppName = appName.replace(/^[0-9]+/, "").replace(/-dev$/, "").replace(/-staging$/, "").toLowerCase();
          const matchedSource = runningNames.find(name => {
            const normalized = name.replace(/-dev$/, "").replace(/-staging$/, "").toLowerCase();
            return normalized === normalizedAppName && name !== appName;
          });
          if (matchedSource) {
            resolvedEnvSource = matchedSource;
            console.log(`[Deploy] Auto-detected env source: "${matchedSource}" matches "${appName}"`);
          }
        } catch {}
      }

      if (resolvedEnvSource) {
        const sourceDir = resolvedEnvSource === "ulysse" ? "/var/www/ulysse" : `/var/www/apps/${resolvedEnvSource}`;
        const sourceEnvResult = await service.executeCommand(`cat ${sourceDir}/.env 2>/dev/null || echo "NO_ENV_FILE"`, 5000);
        if (sourceEnvResult.success && sourceEnvResult.output.trim() !== "NO_ENV_FILE") {
          const copiedVars: Record<string, string> = {};
          for (const line of sourceEnvResult.output.split("\n")) {
            const match = line.match(/^([^#=]+)=(.*)$/);
            if (match) {
              const key = match[1].trim();
              if (key === "PORT") continue;
              copiedVars[key] = match[2];
            }
          }
          const copiedCount = Object.keys(copiedVars).length;
          for (const [k, v] of Object.entries(copiedVars)) {
            if (!envVars[k]) envVars[k] = v;
          }
          logs.push(`[0/8] Env: copied ${copiedCount} variable(s) from "${resolvedEnvSource}" (PORT excluded)`);
          console.log(`[Deploy] Copied ${copiedCount} env vars from ${resolvedEnvSource} → ${appName}`);
        } else {
          logs.push(`[0/8] Env: ⚠️ no .env file found in "${resolvedEnvSource}"`);
        }
      }

      const baseSlug = appName.replace(/-dev$/, "").replace(/-staging$/, "");
      await service.executeCommand(
        `rm -f /etc/nginx/sites-enabled/${baseSlug}-placeholder /etc/nginx/sites-enabled/${baseSlug}-staging-placeholder /etc/nginx/sites-enabled/${baseSlug}-dev-placeholder && ` +
        `rm -f /etc/nginx/sites-available/${baseSlug}-placeholder /etc/nginx/sites-available/${baseSlug}-staging-placeholder /etc/nginx/sites-available/${baseSlug}-dev-placeholder && ` +
        `grep -q 'connection_upgrade' /etc/nginx/nginx.conf || sed -i '/http {/a\\    map \\$http_upgrade \\$connection_upgrade {\\n        default upgrade;\\n        "" close;\\n    }' /etc/nginx/nginx.conf && ` +
        `nginx -t 2>&1 && systemctl reload nginx`,
        10000
      ).catch(() => {});

      let projectGitToken: string | null = null;
      if (devmaxProjectId) {
        try {
          const { getProjectGitHubToken } = await import("../../routes/devmaxAuth");
          projectGitToken = await getProjectGitHubToken(devmaxProjectId);
          if (projectGitToken) {
            console.log(`[Deploy] Using project-specific GitHub token for ${appName}`);
          }
        } catch {}
      }

      const cloneResult = await service.authenticatedGitClone({ repoUrl, branch, appDir, tokenOverride: projectGitToken });
      if (!cloneResult.success) {
        return { success: false, message: `Clone failed: ${cloneResult.error}`, logs: [`Clone: FAILED — ${cloneResult.method || "no auth"}`] };
      }
      logs.push(`[1/8] Clone: OK (branch: ${branch}, auth: ${cloneResult.method})`);

      const projectType = params.forceStatic ? "static" : await service.detectProjectType(appDir);
      logs.push(`[2/8] Type: ${projectType}`);

      if (projectType === "static") {
        logs.push(`[3/8] Static site — skipping npm/PM2`);

        const nginxDomain = resolveAppDomain(appName, domain);
        const nginxFileName = normalizeNginxName(appName);
        const staticDistCheck = await service.executeCommand(`[ -d "${appDir}/dist" ] && echo "dist" || ([ -d "${appDir}/build" ] && echo "build" || echo "root")`, 5000);
        const staticBuildDir = staticDistCheck.output?.trim();
        let staticRootDir = appDir;
        if (staticBuildDir === "dist") staticRootDir = `${appDir}/dist`;
        else if (staticBuildDir === "build") staticRootDir = `${appDir}/build`;
        const staticNginxConf = staticNginxBlock(nginxDomain, staticRootDir, nginxFileName);

        await service.executeCommand(nginxCleanupCmd(appName), 5000).catch(() => {});
        await service.writeRemoteFile(`/etc/nginx/sites-available/${nginxFileName}`, staticNginxConf);
        const nginxResult = await service.executeCommand(
          `ln -sf /etc/nginx/sites-available/${nginxFileName} /etc/nginx/sites-enabled/${nginxFileName} && nginx -t 2>&1 && systemctl reload nginx && echo "NGINX OK"`,
          15000
        );
        if (!nginxResult.output?.includes("NGINX OK")) {
          await service.executeCommand(`rm -f /etc/nginx/sites-enabled/${nginxFileName}`, 5000);
          logs.push(`[4/8] Nginx: FAILED — config invalide, symlink supprimé. ${nginxResult.error || nginxResult.output || ""}`);
          return { success: false, message: `Deploy static failed: Nginx config invalid\n${logs.join("\n")}`, logs };
        }
        logs.push(`[4/8] Nginx: configured for ${nginxDomain} (config: ${nginxFileName})`);

        if (ssl && domain) {
          const sslResult = await service.executeCommand(
            `certbot --nginx -d ${domain} --non-interactive --agree-tos -m admin@${domain.split(".").slice(-2).join(".")} 2>&1 | tail -5`,
            60000
          );
          logs.push(`[5/8] SSL: ${sslResult.success ? "certificate installed" : sslResult.error || "failed"}`);
        }

        const healthCheck = await service.executeCommand(
          `curl -s -o /dev/null -w "%{http_code}" -H "Host: ${nginxDomain}" http://127.0.0.1/ 2>/dev/null || echo "000"`,
          10000
        );
        logs.push(`[6/8] Health: HTTP ${healthCheck.output?.trim() || "000"}`);

        const url = `https://${nginxDomain}`;
        return { success: true, message: `Static site "${appName}" deployed!\n${logs.join("\n")}\nURL: ${url}`, url, logs };
      }

      if (projectType === "spa-build") {
        logs.push(`[3/8] SPA build detected — will build then serve static`);
        const nginxDomain = resolveAppDomain(appName, domain);
        const distDir = `${appDir}/dist`;

        const spaPreCheck = await service.executeCommand(
          `[ -f "${appDir}/index.html" ] && echo "HAS_INDEX" || echo "NO_INDEX"; [ -f "${appDir}/tsconfig.node.json" ] && echo "HAS_TSNODE" || echo "NO_TSNODE"; grep -l "references" "${appDir}/tsconfig.json" 2>/dev/null && echo "HAS_REFS" || echo "NO_REFS"`,
          5000
        );
        const spaOut = spaPreCheck.output || "";
        if (spaOut.includes("NO_INDEX")) {
          const mainEntry = await service.executeCommand(`ls ${appDir}/src/main.tsx ${appDir}/src/main.ts ${appDir}/src/index.tsx ${appDir}/src/index.ts 2>/dev/null | head -1`, 5000);
          const entryFile = mainEntry.output?.trim()?.replace(appDir, "") || "/src/main.tsx";
          const fallbackHtml = `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>${appName}</title>\n</head>\n<body>\n  <div id="root"></div>\n  <script type="module" src="${entryFile}"></script>\n</body>\n</html>`;
          await service.writeRemoteFile(`${appDir}/index.html`, fallbackHtml);
          logs.push(`[3b/8] Created missing index.html (entry: ${entryFile})`);
        }
        if (spaOut.includes("NO_TSNODE") && spaOut.includes("HAS_REFS")) {
          const tsconfigNode = `{\n  "compilerOptions": {\n    "composite": true,\n    "module": "ESNext",\n    "moduleResolution": "Node",\n    "allowSyntheticDefaultImports": true\n  },\n  "include": ["vite.config.ts"]\n}`;
          await service.writeRemoteFile(`${appDir}/tsconfig.node.json`, tsconfigNode);
          logs.push(`[3c/8] Created missing tsconfig.node.json`);
        }

        const pkgCheck = await service.executeCommand(
          `cd ${appDir} && cat package.json 2>/dev/null`,
          5000
        );
        let pkgJson: any = {};
        try { pkgJson = JSON.parse(pkgCheck.output || "{}"); } catch {}
        const pkgScripts = pkgJson.scripts || {};
        const pkgDeps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };

        const missingCoreDeps: string[] = [];
        if (pkgDeps["react"] && !pkgDeps["react-dom"]) missingCoreDeps.push("react-dom");
        if (!pkgDeps["@vitejs/plugin-react"] && (await service.executeCommand(`grep -l "plugin-react" ${appDir}/vite.config.* 2>/dev/null`, 3000)).success) {
          missingCoreDeps.push("@vitejs/plugin-react");
        }
        if (!pkgDeps["typescript"] && (await service.executeCommand(`[ -f "${appDir}/tsconfig.json" ]`, 3000)).success) {
          missingCoreDeps.push("typescript");
        }

        const hasLock = await service.executeCommand(`[ -f "${appDir}/package-lock.json" ] && echo "HAS_LOCK" || echo "NO_LOCK"`, 5000);
        const installCmd = hasLock.output?.includes("HAS_LOCK") ? "npm ci --production=false" : "npm install --production=false --no-audit --no-fund";
        const installResult = await service.executeCommand(`cd ${appDir} && ${installCmd} 2>&1 | tail -10`, 120000);
        logs.push(`[4/8] Install: ${installResult.success ? "OK" : installResult.error || "failed"}`);
        if (!installResult.success) return { success: false, message: `Install failed: ${installResult.error}`, logs };

        if (missingCoreDeps.length > 0) {
          await service.executeCommand(`cd ${appDir} && npm install --save ${missingCoreDeps.join(" ")} 2>&1 | tail -5`, 60000);
          logs.push(`[4b/8] Auto-installed missing deps: ${missingCoreDeps.join(", ")}`);
        }

        const hasBuildScript = !!pkgScripts.build;
        let buildResult: any;
        if (hasBuildScript) {
          buildResult = await service.executeCommand(`cd ${appDir} && npm run build 2>&1 | tail -15`, 120000);
        } else {
          logs.push(`[5/8] No build script in package.json — using npx vite build`);
          await service.executeCommand(`cd ${appDir} && npm install --save-dev vite @vitejs/plugin-react typescript 2>&1 | tail -3`, 60000);
          buildResult = await service.executeCommand(`cd ${appDir} && npx vite build 2>&1 | tail -15`, 120000);
        }

        const buildOutput = buildResult.output || "";
        const buildFailed = !buildResult.success || buildOutput.includes("Missing script") || buildOutput.includes("not found") || buildOutput.includes("Cannot find module") || buildOutput.includes("Could not resolve entry") || buildOutput.includes("ERR!");

        if (buildFailed && hasBuildScript) {
          logs.push(`[5/8] Build script failed, retrying with npx vite build...`);
          await service.executeCommand(`cd ${appDir} && npm install --save-dev vite @vitejs/plugin-react typescript 2>&1 | tail -3`, 60000);
          buildResult = await service.executeCommand(`cd ${appDir} && npx vite build 2>&1 | tail -15`, 120000);
        }

        const finalBuildOutput = buildResult.output || "";
        const finalBuildFailed = !buildResult.success || finalBuildOutput.includes("ERR!") || finalBuildOutput.includes("error TS");
        logs.push(`[5/8] Build: ${!finalBuildFailed ? "OK" : buildResult.error || finalBuildOutput.slice(-200) || "failed"}`);
        if (finalBuildFailed) return { success: false, message: `Build failed:\n${finalBuildOutput.slice(-500)}`, logs };

        const buildOutputCheck = await service.executeCommand(
          `[ -d "${distDir}" ] && echo "DIST_OK" || ([ -d "${appDir}/build" ] && echo "BUILD_OK" || echo "NO_OUTPUT")`, 5000
        );
        const buildOut = buildOutputCheck.output?.trim() || "";
        let serveDirFinal = distDir;
        if (buildOut === "BUILD_OK") {
          serveDirFinal = `${appDir}/build`;
        } else if (buildOut !== "DIST_OK") {
          serveDirFinal = appDir;
          logs.push(`[5b/8] No dist/ or build/ found — serving project root`);
        }

        const spaConfigName = normalizeNginxName(appName);
        const spaNginxConf = staticNginxBlock(nginxDomain, serveDirFinal, spaConfigName);
        await service.executeCommand(nginxCleanupCmd(appName), 5000).catch(() => {});
        await service.writeRemoteFile(`/etc/nginx/sites-available/${spaConfigName}`, spaNginxConf);
        const nginxResult = await service.executeCommand(
          `ln -sf /etc/nginx/sites-available/${spaConfigName} /etc/nginx/sites-enabled/${spaConfigName} && nginx -t 2>&1 && systemctl reload nginx && echo "NGINX OK"`,
          15000
        );
        logs.push(`[6/8] Nginx: ${nginxResult.output?.includes("NGINX OK") ? "SPA dist served at " + nginxDomain + " (config: " + spaConfigName + ")" : nginxResult.error || "failed"}`);

        await service.executeCommand(`pm2 delete ${appName} 2>/dev/null; true`, 5000);
        logs.push(`[7/8] PM2: cleaned up (not needed for SPA)`);

        const healthCheck = await service.executeCommand(
          `curl -s -o /dev/null -w "%{http_code}" -H "Host: ${nginxDomain}" http://127.0.0.1/ 2>/dev/null || echo "000"`,
          10000
        );
        logs.push(`[8/8] Health: HTTP ${healthCheck.output?.trim() || "000"}`);

        const url = `https://${nginxDomain}`;
        return { success: true, message: `SPA "${appName}" built & deployed!\n${logs.join("\n")}\nURL: ${url}`, url, logs };
      }

      let actualPort = params.port || 0;
      if (!actualPort) {
        const existingPortResult = await service.executeCommand(
          `grep -oP '"PORT":\\s*"\\K[0-9]+' ${appDir}/ecosystem.config.cjs 2>/dev/null || grep -oP 'PORT="?\\K[0-9]+' ${appDir}/.env 2>/dev/null || echo "0"`,
          5000
        );
        const existingPort = parseInt(existingPortResult.output?.trim() || "0", 10);
        if (existingPort > 0) {
          actualPort = existingPort;
          logs.push(`[3/8] Port: ${actualPort} (reused from existing deployment)`);
        } else {
          actualPort = await service.findFreePort(undefined, caller);
          logs.push(`[3/8] Port: ${actualPort} (new, ${caller} range)`);
        }
      } else {
        logs.push(`[3/8] Port: ${actualPort} (explicit)`);
      }

      if (createDb && dbName) {
        const dbResult = await service.createDatabase(
          dbName,
          dbUser || appName,
          dbPassword || `${appName}_pwd_2026`
        );
        logs.push(`[4/8] DB: ${dbResult.message}`);
        if (dbResult.success) {
          envVars["DATABASE_URL"] = dbResult.connectionUrl;
        } else {
          return { success: false, message: dbResult.message, logs };
        }
      } else {
        logs.push(`[4/8] DB: skipped`);
      }

      const autoDetectResult = await service.executeCommand(
        `grep -oP 'process\\.env\\.[A-Z_]+' ${appDir}/dist/*.cjs ${appDir}/dist/*.js ${appDir}/server/*.js ${appDir}/src/*.ts ${appDir}/server/*.ts 2>/dev/null | grep -oP '[A-Z_]+$' | sort -u 2>/dev/null || true`,
        10000
      );
      const detectedVars = (autoDetectResult.output || "").split("\n").filter(Boolean);
      const crypto = await import("crypto");

      const envExampleResult = await service.executeCommand(
        `[ -f "${appDir}/.env.example" ] && cat "${appDir}/.env.example" || ([ -f "${appDir}/.env.sample" ] && cat "${appDir}/.env.sample" || echo "")`,
        5000
      );
      const envExampleContent = envExampleResult.output || "";
      if (envExampleContent.trim()) {
        logs.push(`[4b/8] Found .env.example — auto-configuring missing variables`);
        const envExampleLines = envExampleContent.split("\n").filter(l => l.includes("=") && !l.startsWith("#"));
        for (const line of envExampleLines) {
          const eqIdx = line.indexOf("=");
          if (eqIdx === -1) continue;
          const key = line.substring(0, eqIdx).trim();
          const exampleVal = line.substring(eqIdx + 1).trim();
          if (envVars[key]) continue;
          if (key === "DATABASE_URL" || key === "DB_URL" || key === "POSTGRES_URL") {
            continue;
          }
          if (key === "PORT" || key === "NODE_ENV") continue;
          if (key.includes("SECRET") || key.includes("JWT")) {
            envVars[key] = crypto.randomBytes(32).toString("hex");
            logs.push(`  → ${key}: auto-generated (secret)`);
          } else if (exampleVal && exampleVal !== "your-key-here" && exampleVal !== "xxx" && !exampleVal.includes("your_")) {
            envVars[key] = exampleVal;
            logs.push(`  → ${key}: set from .env.example`);
          } else {
            logs.push(`  → ${key}: ⚠️ needs manual config (placeholder in .env.example)`);
          }
        }
      }

      if (!envVars["SESSION_SECRET"] && detectedVars.includes("SESSION_SECRET")) {
        envVars["SESSION_SECRET"] = crypto.randomBytes(32).toString("hex");
      }
      if (!envVars["JWT_SECRET"] && detectedVars.includes("JWT_SECRET")) {
        envVars["JWT_SECRET"] = crypto.randomBytes(32).toString("hex");
      }
      if (!envVars["COOKIE_SECRET"] && detectedVars.includes("COOKIE_SECRET")) {
        envVars["COOKIE_SECRET"] = crypto.randomBytes(32).toString("hex");
      }

      if (!createDb && !envVars["DATABASE_URL"] && (detectedVars.includes("DATABASE_URL") || envExampleContent.includes("DATABASE_URL"))) {
        const autoDbResult = await service.createDatabase(
          `${appName}_db`,
          `${appName}_user`,
          `${appName}_pwd_2026`
        );
        if (autoDbResult.success) {
          envVars["DATABASE_URL"] = autoDbResult.connectionUrl;
          logs.push(`[4c/8] DB: auto-created ${appName}_db`);
        }
      }

      const allEnvVars: Record<string, string> = {
        NODE_ENV: "production",
        PORT: String(actualPort),
        ...envVars
      };

      const envExportLine = Object.entries(allEnvVars)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join("\n");

      const actualBuildCmd = buildCmd || "npm run build";
      const actualStartCmd = startCmd || "npm start";

      const ecosystemContent = pm2EcosystemConfig(appName, appDir, allEnvVars);

      logs.push(`[5/10] Writing .env and ecosystem.config.cjs...`);
      await service.writeRemoteFile(`${appDir}/.env`, envExportLine);
      await service.writeRemoteFile(`${appDir}/ecosystem.config.cjs`, ecosystemContent);

      const hasLockFile = await service.executeCommand(`[ -f "${appDir}/package-lock.json" ] && echo "HAS_LOCK" || echo "NO_LOCK"`, 5000);
      const npmInstallCmd = hasLockFile.output?.includes("HAS_LOCK") ? "npm ci --include=dev" : "npm install --include=dev --no-audit --no-fund";

      logs.push(`[6/10] Installing dependencies...`);
      const installResult = await service.executeCommand(
        `cd ${appDir} && ${npmInstallCmd} 2>&1 | tail -10`,
        180000
      );
      if (!installResult.success) {
        return { success: false, message: `Install failed:\n${installResult.error || installResult.output}`, logs };
      }
      logs.push(`[6/10] Install: OK`);

      logs.push(`[7/10] Building...`);
      await service.executeCommand(`cd ${appDir} && touch .env`, 5000);
      const buildResult = await service.executeCommand(
        `cd ${appDir} && set -a && . .env && set +a && ${actualBuildCmd} 2>&1 | tail -15`,
        180000
      );
      logs.push(...(buildResult.output || "").split("\n").filter(l => l.startsWith(">>>")));

      if (!buildResult.success) {
        return { success: false, message: `Deployment failed at build phase:\n${buildResult.error}\n${buildResult.output}`, logs };
      }

      const buildOutputCheck = await service.executeCommand(
        `[ -d "${appDir}/dist" ] && ls ${appDir}/dist/ | head -3 || echo "NO_DIST"`,
        5000
      );
      const pkgStartScript = JSON.parse(
        (await service.executeCommand(`cd ${appDir} && node -e "console.log(JSON.stringify(require('./package.json').scripts?.start || ''))"`, 5000)).output || '""'
      );
      if (buildOutputCheck.output?.includes("NO_DIST") && pkgStartScript.includes("dist/")) {
        return { success: false, message: `Build completed but produced no dist/ output. The start script expects dist/ files. Check build configuration.\n${buildResult.output || ""}`, logs };
      }
      logs.push(`[7/10] Build: OK${buildOutputCheck.output?.includes("NO_DIST") ? " (no dist/ — may be direct start)" : ""}`);

      const hasTestScript = await service.executeCommand(
        `cd ${appDir} && node -e "const p=require('./package.json'); process.exit(p.scripts?.test && p.scripts.test !== 'echo \\"Error: no test specified\\" && exit 1' ? 0 : 1)" 2>/dev/null`,
        5000
      );
      if (hasTestScript.success) {
        logs.push(`[8/10] Running tests...`);
        const testResult = await service.executeCommand(
          `cd ${appDir} && set -a && . .env && set +a && npm test 2>&1 | tail -30`,
          120000
        );
        if (!testResult.success) {
          logs.push(`[8/10] Tests FAILED`);
          return {
            success: false,
            message: `Deployment aborted: tests failed\n${testResult.output?.slice(-500)}\n${testResult.error || ""}`,
            logs,
          };
        }
        logs.push(`[8/10] Tests: PASSED`);
      } else {
        logs.push(`[8/10] Tests: skipped (no test script)`);
      }

      if (envVars["DATABASE_URL"] || allEnvVars["DATABASE_URL"]) {
        const hasPrisma = await service.executeCommand(`[ -f "${appDir}/prisma/schema.prisma" ] && echo "YES" || echo "NO"`, 5000);
        const hasDrizzle = await service.executeCommand(`[ -f "${appDir}/drizzle.config.ts" ] || [ -f "${appDir}/drizzle.config.js" ] && echo "YES" || echo "NO"`, 5000);
        if (hasPrisma.output?.includes("YES")) {
          logs.push(`[9/10] Running Prisma migrations...`);
          const migrateResult = await service.executeCommand(
            `cd ${appDir} && set -a && . .env && set +a && npx prisma migrate deploy 2>&1 | tail -10`,
            60000
          );
          logs.push(`[9/10] Prisma migrate: ${migrateResult.success ? "OK" : migrateResult.error || migrateResult.output?.slice(-200) || "failed"}`);
        } else if (hasDrizzle.output?.includes("YES")) {
          logs.push(`[9/10] Running Drizzle migrations...`);
          const migrateResult = await service.executeCommand(
            `cd ${appDir} && set -a && . .env && set +a && npx drizzle-kit push 2>&1 | tail -10`,
            60000
          );
          logs.push(`[9/10] Drizzle push: ${migrateResult.success ? "OK" : migrateResult.error || migrateResult.output?.slice(-200) || "failed"}`);
        } else {
          logs.push(`[9/10] DB migrations: skipped (no Prisma/Drizzle config found)`);
        }
      }

      logs.push(`[10/10] Starting with PM2...`);
      const pm2StartScript = [
        `pm2 delete ${appName} 2>/dev/null || true`,
        `cd ${appDir} && pm2 start ecosystem.config.cjs 2>&1`,
        `pm2 save`,
      ].join(" && ");
      const startResult = await service.executeCommand(pm2StartScript, 30000);

      if (!startResult.success) {
        return { success: false, message: `Deployment failed at start phase:\n${startResult.error}\n${startResult.output}`, logs };
      }

      const nginxDomain = resolveAppDomain(appName, domain);
      const proxyConfigName = normalizeNginxName(appName);
      const nginxConf = proxyNginxBlock(nginxDomain, appName, actualPort);

      await service.executeCommand(nginxCleanupCmd(appName), 5000).catch(() => {});
      await service.writeRemoteFile(`/etc/nginx/sites-available/${proxyConfigName}`, nginxConf);
      const nginxResult = await service.executeCommand(
        `ln -sf /etc/nginx/sites-available/${proxyConfigName} /etc/nginx/sites-enabled/${proxyConfigName} && nginx -t 2>&1 && systemctl reload nginx && echo "NGINX OK"`,
        15000
      );
      logs.push(`Nginx: ${nginxResult.output?.includes("NGINX OK") ? "configured for " + nginxDomain + " (config: " + proxyConfigName + ")" : nginxResult.error || "failed"}`);

      if (ssl && domain) {
        const sslResult = await service.executeCommand(
          `certbot --nginx -d ${domain} --non-interactive --agree-tos -m admin@${domain.split(".").slice(-2).join(".")} 2>&1 | tail -5`,
          60000
        );
        logs.push(`SSL: ${sslResult.success ? "certificate installed" : sslResult.error || "failed"}`);
      }

      let httpCode = "000";
      for (let attempt = 1; attempt <= 5; attempt++) {
        const healthCheck = await service.executeCommand(
          `sleep 3 && curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:${actualPort}/ 2>/dev/null || echo "000"`,
          15000
        );
        httpCode = healthCheck.output?.trim() || "000";
        if (httpCode !== "000") break;
        logs.push(`Health check attempt ${attempt}/5: HTTP ${httpCode} — waiting...`);
      }
      logs.push(`Health check: HTTP ${httpCode}`);

      if (httpCode === "000") {
        const pm2Status = await service.executeCommand(`pm2 show ${appName} 2>/dev/null | grep status || echo "unknown"`, 5000);
        logs.push(`PM2 status: ${pm2Status.output?.trim()}`);
        const pm2Logs = await service.executeCommand(`pm2 logs ${appName} --lines 10 --nostream 2>/dev/null || echo "no logs"`, 5000);
        logs.push(`PM2 last logs:\n${pm2Logs.output?.trim()}`);
      }

      const url = `https://${nginxDomain}`;

      const verify = await service.verifyDeployedUrl(nginxDomain);
      logs.push(`Post-deploy verify: ${verify.message}`);

      const isHealthy = httpCode !== "000" && httpCode !== "502" && httpCode !== "503" && httpCode !== "504";
      const isWarning = httpCode === "404" || httpCode === "500" || httpCode === "301" || httpCode === "302";
      return {
        success: httpCode !== "000",
        message: isHealthy && !isWarning
          ? `App "${appName}" deployed on port ${actualPort}!\n${logs.join("\n")}\nURL: ${url}`
          : isWarning
          ? `App "${appName}" deployed on port ${actualPort} but returned HTTP ${httpCode}. Vérifiez la config.\n${logs.join("\n")}\nURL: ${url}`
          : `App "${appName}" deployed but NOT responding (HTTP ${httpCode}) on port ${actualPort}. Check PM2 logs.\n${logs.join("\n")}\nURL: ${url}`,
        url,
        port: actualPort,
        httpCode,
        logs
      };
    },

    async deployStagingApp(params: {
      repoUrl: string;
      appName: string;
      branch?: string;
      port?: number;
      buildCmd?: string;
      startCmd?: string;
      envVars?: Record<string, string>;
      createDb?: boolean;
      dbName?: string;
      dbUser?: string;
      dbPassword?: string;
      caller?: "max" | "ulysse" | "iris";
      devmaxProjectId?: string;
      copyEnvFrom?: string;
    }): Promise<{ success: boolean; message: string; stagingUrl?: string; productionUrl?: string; port?: number; logs?: string[] }> {
      const stagingAppName = `${params.appName}-dev`;
      const stagingDomain = `${stagingAppName}.ulyssepro.org`;
      const productionDomain = `${params.appName}.ulyssepro.org`;

      console.log(`[SSH] Deploying staging: ${stagingAppName} → ${stagingDomain}`);

      const result = await service.deployApp({
        ...params,
        appName: stagingAppName,
        domain: stagingDomain,
        branch: params.branch || "main",
        devmaxProjectId: params.devmaxProjectId,
      });

      return {
        success: result.success,
        message: result.success
          ? `Staging deployed: ${stagingDomain}\nProduction URL (after promotion): ${productionDomain}\n${result.message}`
          : result.message,
        stagingUrl: `https://${stagingDomain}`,
        productionUrl: `https://${productionDomain}`,
        port: result.port,
        logs: result.logs,
      };
    },

    async promoteToProduction(params: {
      appName: string;
      port?: number;
      caller?: "max" | "ulysse" | "iris";
    }): Promise<{ success: boolean; message: string; productionUrl?: string; logs?: string[] }> {
      const { appName, caller = "ulysse" } = params;
      const stagingAppName = `${appName}-dev`;
      const legacyStagingName = `${appName}-staging`;
      let stagingDir = `/var/www/apps/${stagingAppName}`;
      const prodDir = `/var/www/apps/${appName}`;
      const prodDomain = `${appName}.ulyssepro.org`;
      const logs: string[] = [];

      const checkNewDir = await service.executeCommand(`[ -d "${stagingDir}" ] && echo "EXISTS" || echo "NONE"`, 5000);
      if (checkNewDir.output?.trim() !== "EXISTS") {
        const checkLegacy = await service.executeCommand(`[ -d "/var/www/apps/${legacyStagingName}" ] && echo "EXISTS" || echo "NONE"`, 5000);
        if (checkLegacy.output?.trim() === "EXISTS") {
          stagingDir = `/var/www/apps/${legacyStagingName}`;
          logs.push(`[0/5] Using legacy staging dir: ${legacyStagingName}`);
        }
      }

      console.log(`[SSH] Promoting ${stagingDir} → ${appName} (${prodDomain})`);

      const existingProd = await service.executeCommand(`[ -d "${prodDir}" ] && echo "EXISTS" || echo "NONE"`, 5000);
      if (existingProd.output?.trim() === "EXISTS") {
        console.log(`[SSH] Snapshotting current production before promote`);
        const snap = await service.snapshotProduction(appName);
        logs.push(`[0/5] Snapshot: ${snap.success ? snap.snapshotDir.split("/").pop() : "failed — " + snap.message}`);
      }

      const checkStagingDir = await service.executeCommand(`[ -d "${stagingDir}" ] && echo "EXISTS" || echo "NONE"`, 5000);
      if (checkStagingDir.output?.trim() !== "EXISTS") {
        return { success: false, message: `Staging directory "${stagingDir}" not found. Deploy to staging first.`, logs };
      }

      const pm2Name = stagingDir.includes(legacyStagingName) ? legacyStagingName : stagingAppName;
      const detectedType = await service.detectProjectType(stagingDir);
      const checkStaging = await service.executeCommand(`pm2 show ${pm2Name} 2>/dev/null | grep status || echo "not_found"`, 5000);
      const isStaticSite = detectedType === "static" || detectedType === "spa-build" || checkStaging.output?.includes("not_found");
      logs.push(`[0/5] Detected type: ${detectedType} → ${isStaticSite ? "static/SPA deploy" : "Node.js deploy"}`);

      let prodPort: number | undefined;

      if (isStaticSite) {
        logs.push(`[1/5] Static site detected — no PM2 process`);
        const copyResult = await service.executeCommand([
          `rm -rf ${prodDir}`,
          `cp -a ${stagingDir} ${prodDir}`,
        ].join(" && "), 30000);
        if (!copyResult.success) {
          logs.push(`Copy failed: ${copyResult.error}`);
          return { success: false, message: `Promotion failed: ${copyResult.error}`, logs };
        }
        logs.push(`[2/5] Static files copied to production`);
      } else {
        const portResult = await service.executeCommand(
          `grep -oP '"PORT":\\s*"\\K[0-9]+' ${stagingDir}/ecosystem.config.cjs 2>/dev/null || grep -oP 'PORT=\\K[0-9]+' ${stagingDir}/.env 2>/dev/null || echo "0"`,
          5000
        );
        const stagingPort = parseInt(portResult.output?.trim() || "0", 10);
        logs.push(`[1/5] Staging port: ${stagingPort}`);

        if (stagingPort === 0) {
          return { success: false, message: "Cannot determine staging port", logs };
        }

        prodPort = params.port || await service.findFreePort(undefined, caller);
        logs.push(`[2/5] Production port: ${prodPort}`);

        const tempDir = `${prodDir}_new_${Date.now()}`;
        const prepResult = await service.executeCommand([
          `cp -a ${stagingDir} ${tempDir}`,
          `cd ${tempDir} && sed -i "s/PORT=.*/PORT=${prodPort}/" .env`,
          `cd ${tempDir} && sed -i "s/'${pm2Name}'/'${appName}'/g" ecosystem.config.cjs`,
          `cd ${tempDir} && sed -i "s/'${legacyStagingName}'/'${appName}'/g" ecosystem.config.cjs`,
          `cd ${tempDir} && sed -i "s/'${stagingAppName}'/'${appName}'/g" ecosystem.config.cjs`,
          `cd ${tempDir} && sed -i 's/"PORT": "[0-9]*"/"PORT": "${prodPort}"/g' ecosystem.config.cjs`,
        ].join(" && "), 60000);

        if (!prepResult.success) {
          await service.executeCommand(`rm -rf ${tempDir}`, 5000);
          logs.push(`Prep failed: ${prepResult.error}`);
          return { success: false, message: `Promotion failed during prep: ${prepResult.error}`, logs };
        }

        const swapResult = await service.executeCommand([
          `pm2 delete ${appName} 2>/dev/null || true`,
          `[ -d "${prodDir}" ] && mv ${prodDir} ${prodDir}_backup_${Date.now()} || true`,
          `mv ${tempDir} ${prodDir}`,
          `cd ${prodDir} && pm2 start ecosystem.config.cjs`,
          `pm2 save`,
        ].join(" && "), 60000);

        if (!swapResult.success) {
          logs.push(`Swap/start failed: ${swapResult.error}`);
          const rollbackCheck = await service.executeCommand(`ls -d ${prodDir}_backup_* 2>/dev/null | tail -1`, 5000);
          if (rollbackCheck.output?.trim()) {
            await service.executeCommand(`rm -rf ${prodDir}; mv ${rollbackCheck.output.trim()} ${prodDir}; cd ${prodDir} && pm2 start ecosystem.config.cjs 2>/dev/null || true`, 15000);
            logs.push(`Rollback vers backup effectué`);
          }
          return { success: false, message: `Promotion failed: ${swapResult.error}`, logs };
        }
        logs.push(`[3/5] App copied and started on port ${prodPort}`);
        await service.executeCommand(`find /var/www/apps/ -maxdepth 1 -name "${appName}_backup_*" -mmin +60 -exec rm -rf {} + 2>/dev/null || true`, 5000);
      }

      let nginxConf: string;

      let staticRoot = prodDir;
      const distCheck = await service.executeCommand(`[ -d "${prodDir}/dist" ] && echo "dist" || ([ -d "${prodDir}/build" ] && echo "build" || echo "root")`, 5000);
      const buildDir = distCheck.output?.trim();
      if (buildDir === "dist") staticRoot = `${prodDir}/dist`;
      else if (buildDir === "build") staticRoot = `${prodDir}/build`;

      if (isStaticSite) {
        nginxConf = staticNginxBlock(prodDomain, staticRoot);
      } else {
        nginxConf = proxyNginxBlock(prodDomain, appName, prodPort!);
      }

      await service.writeRemoteFile(`/etc/nginx/sites-available/${appName}`, nginxConf);
      const nginxResult = await service.executeCommand(
        `ln -sf /etc/nginx/sites-available/${appName} /etc/nginx/sites-enabled/${appName} && nginx -t 2>&1 && systemctl reload nginx && echo "NGINX OK"`,
        15000
      );
      logs.push(`[4/5] Nginx: ${nginxResult.success ? "configured for " + prodDomain : nginxResult.error || "failed"}`);

      let httpCode = "000";
      if (isStaticSite) {
        const healthCheck = await service.executeCommand(
          `sleep 1 && curl -s -o /dev/null -w "%{http_code}" --max-time 5 -H "Host: ${prodDomain}" http://127.0.0.1/ 2>/dev/null || echo "000"`,
          15000
        );
        httpCode = healthCheck.output?.trim() || "000";
        if (httpCode === "000" || httpCode === "301" || httpCode === "302") {
          const fallback = await service.executeCommand(`[ -f "${prodDir}/index.html" ] && echo "200" || echo "404"`, 5000);
          httpCode = fallback.output?.trim() || "000";
        }
      } else {
        for (let attempt = 1; attempt <= 3; attempt++) {
          const healthCheck = await service.executeCommand(
            `sleep 2 && curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:${prodPort}/ 2>/dev/null || echo "000"`,
            15000
          );
          httpCode = healthCheck.output?.trim() || "000";
          if (httpCode !== "000") break;
        }
      }
      logs.push(`[5/5] Health check: HTTP ${httpCode}`);

      const verify = await service.verifyDeployedUrl(prodDomain);
      logs.push(`Post-promote verify: ${verify.message}`);

      const productionUrl = `https://${prodDomain}`;
      return {
        success: httpCode !== "000" && httpCode !== "404",
        message: httpCode !== "000" && httpCode !== "404"
          ? `Production deployed: ${productionUrl}\n${logs.join("\n")}`
          : `Promotion done but health check returned ${httpCode}\n${logs.join("\n")}`,
        productionUrl,
        logs,
      };
    },

    async snapshotProduction(appName: string): Promise<{ success: boolean; snapshotDir: string; message: string }> {
      const prodDir = `/var/www/apps/${appName}`;
      const snapshotBase = `/var/www/snapshots/${appName}`;
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const snapshotDir = `${snapshotBase}/${timestamp}`;

      const checkProd = await service.executeCommand(`[ -d "${prodDir}" ] && echo "EXISTS" || echo "NONE"`, 5000);
      if (checkProd.output?.trim() !== "EXISTS") {
        return { success: false, snapshotDir: "", message: `No production app at ${prodDir}` };
      }

      const result = await service.executeCommand([
        `mkdir -p ${snapshotBase}`,
        `cp -a ${prodDir} ${snapshotDir}`,
        `pm2 show ${appName} 2>/dev/null | grep -E 'status|restarts|uptime' > ${snapshotDir}/.pm2_status 2>/dev/null || true`,
        `cp /etc/nginx/sites-available/${appName} ${snapshotDir}/.nginx_conf 2>/dev/null || true`,
        `echo "${timestamp}" > ${snapshotDir}/.snapshot_ts`,
        `ls ${snapshotBase} | sort -r | tail -n +4 | xargs -I{} rm -rf ${snapshotBase}/{} 2>/dev/null || true`,
      ].join(" && "), 60000);

      if (!result.success) {
        return { success: false, snapshotDir: "", message: `Snapshot failed: ${result.error}` };
      }

      return { success: true, snapshotDir, message: `Snapshot saved: ${snapshotDir}` };
    },

    async listProductionSnapshots(appName: string): Promise<{ snapshots: Array<{ dir: string; timestamp: string; size: string }> }> {
      const snapshotBase = `/var/www/snapshots/${appName}`;
      const result = await service.executeCommand(
        `ls -1d ${snapshotBase}/*/ 2>/dev/null | while read d; do ts=$(basename "$d"); size=$(du -sh "$d" 2>/dev/null | awk '{print $1}'); echo "$d|$ts|$size"; done || echo ""`,
        10000
      );
      if (!result.success || !result.output?.trim()) {
        return { snapshots: [] };
      }
      const snapshots = result.output.split("\n").filter(l => l.includes("|")).map(line => {
        const [dir, timestamp, size] = line.split("|");
        return { dir: dir.replace(/\/$/, ""), timestamp, size: size || "?" };
      }).reverse();
      return { snapshots };
    },

    async rollbackProduction(params: {
      appName: string;
      snapshotDir?: string;
      caller?: "max" | "ulysse" | "iris";
    }): Promise<{ success: boolean; message: string; productionUrl?: string; restoredFrom?: string; logs?: string[] }> {
      const { appName, caller = "max" } = params;
      const prodDir = `/var/www/apps/${appName}`;
      const prodDomain = `${appName}.ulyssepro.org`;
      const snapshotBase = `/var/www/snapshots/${appName}`;
      const logs: string[] = [];

      let snapshotDir = params.snapshotDir;
      if (!snapshotDir) {
        const latest = await service.executeCommand(`ls -1d ${snapshotBase}/*/ 2>/dev/null | sort -r | head -1`, 5000);
        snapshotDir = latest.output?.trim().replace(/\/$/, "");
        if (!snapshotDir) {
          return { success: false, message: "Aucun snapshot disponible pour le rollback", logs };
        }
      }

      const checkSnap = await service.executeCommand(`[ -d "${snapshotDir}" ] && echo "EXISTS" || echo "NONE"`, 5000);
      if (checkSnap.output?.trim() !== "EXISTS") {
        return { success: false, message: `Snapshot introuvable: ${snapshotDir}`, logs };
      }

      const snapTs = await service.executeCommand(`cat ${snapshotDir}/.snapshot_ts 2>/dev/null || basename ${snapshotDir}`, 5000);
      logs.push(`[1/6] Restoring from snapshot: ${snapTs.output?.trim()}`);

      await service.executeCommand(`pm2 delete ${appName} 2>/dev/null || true`, 10000);
      logs.push(`[2/6] Stopped current production process`);

      const rollbackType = await service.detectProjectType(snapshotDir);
      const isStaticRollback = rollbackType === "static" || rollbackType === "spa-build";

      let restorePort = 0;

      if (isStaticRollback) {
        logs.push(`[3/6] Detected ${rollbackType} — restoring as static/SPA`);
        const restoreResult = await service.executeCommand([
          `rm -rf ${prodDir}`,
          `cp -a ${snapshotDir} ${prodDir}`,
        ].join(" && "), 30000);
        if (!restoreResult.success) {
          return { success: false, message: `Rollback restore failed: ${restoreResult.error}`, logs };
        }
        logs.push(`[4/6] Static files restored`);
      } else {
        const portResult = await service.executeCommand(
          `grep -oP '"PORT":\\s*"\\K[0-9]+' ${snapshotDir}/ecosystem.config.cjs 2>/dev/null || grep -oP 'PORT=\\K[0-9]+' ${snapshotDir}/.env 2>/dev/null || echo "0"`,
          5000
        );
        const oldPort = parseInt(portResult.output?.trim() || "0", 10);
        restorePort = oldPort > 0 ? oldPort : await service.findFreePort(undefined, caller);
        logs.push(`[3/6] Restore port: ${restorePort}${oldPort > 0 ? " (original)" : " (new)"}`);

        const restoreResult = await service.executeCommand([
          `rm -rf ${prodDir}`,
          `cp -a ${snapshotDir} ${prodDir}`,
          `cd ${prodDir} && sed -i "s/PORT=.*/PORT=${restorePort}/" .env 2>/dev/null || true`,
          `cd ${prodDir} && sed -i 's/"PORT": "[0-9]*"/"PORT": "${restorePort}"/g' ecosystem.config.cjs 2>/dev/null || true`,
          `cd ${prodDir} && pm2 start ecosystem.config.cjs 2>&1`,
          `pm2 save`,
        ].join(" && "), 60000);

        if (!restoreResult.success) {
          logs.push(`Restore failed: ${restoreResult.error}`);
          return { success: false, message: `Rollback restore failed: ${restoreResult.error}`, logs };
        }
        logs.push(`[4/6] App restored and started on port ${restorePort}`);
      }

      if (isStaticRollback) {
        let staticRoot = prodDir;
        const distCheck = await service.executeCommand(`[ -d "${prodDir}/dist" ] && echo "dist" || ([ -d "${prodDir}/build" ] && echo "build" || echo "root")`, 5000);
        const bd = distCheck.output?.trim();
        if (bd === "dist") staticRoot = `${prodDir}/dist`;
        else if (bd === "build") staticRoot = `${prodDir}/build`;
        const nginxConf = staticNginxBlock(prodDomain, staticRoot);
        await service.writeRemoteFile(`/etc/nginx/sites-available/${appName}`, nginxConf);
      } else {
        const nginxConf = proxyNginxBlock(prodDomain, appName, restorePort);
        await service.writeRemoteFile(`/etc/nginx/sites-available/${appName}`, nginxConf);
      }
      const nginxReload = await service.executeCommand(
        `ln -sf /etc/nginx/sites-available/${appName} /etc/nginx/sites-enabled/${appName} && nginx -t 2>&1 && systemctl reload nginx && echo "NGINX OK"`,
        15000
      );
      logs.push(`[5/6] Nginx: ${nginxReload.success ? "regenerated for " + prodDomain : nginxReload.error || "failed"}`);

      let httpCode = "000";
      if (isStaticRollback) {
        const healthCheck = await service.executeCommand(
          `sleep 1 && curl -s -o /dev/null -w "%{http_code}" --max-time 5 -H "Host: ${prodDomain}" http://127.0.0.1/ 2>/dev/null || echo "000"`,
          15000
        );
        httpCode = healthCheck.output?.trim() || "000";
        if (httpCode === "000" || httpCode === "301" || httpCode === "302") {
          const fallback = await service.executeCommand(`[ -f "${prodDir}/index.html" ] && echo "200" || echo "404"`, 5000);
          httpCode = fallback.output?.trim() || "000";
        }
      } else {
        for (let attempt = 1; attempt <= 3; attempt++) {
          const healthCheck = await service.executeCommand(
            `sleep 2 && curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:${restorePort}/ 2>/dev/null || echo "000"`,
            15000
          );
          httpCode = healthCheck.output?.trim() || "000";
          if (httpCode !== "000") break;
        }
      }
      logs.push(`[6/6] Health check: HTTP ${httpCode}`);

      const productionUrl = `https://${prodDomain}`;
      return {
        success: httpCode !== "000",
        message: httpCode !== "000"
          ? `Rollback reussi vers ${snapTs.output?.trim()}\nURL: ${productionUrl}\n${logs.join("\n")}`
          : `Rollback applique mais app ne repond pas sur port ${restorePort}\n${logs.join("\n")}`,
        productionUrl,
        restoredFrom: snapshotDir,
        logs,
      };
    },

    async updateApp(appName: string, branch = "main"): Promise<{ success: boolean; message: string; logs: string[] }> {
      const logs: string[] = [];
      const appDir = appName === "ulysse" ? "/var/www/ulysse" : `/var/www/apps/${appName}`;

      const checkDir = await service.executeCommand(`[ -d "${appDir}/.git" ] && echo "GIT_OK" || echo "NO_GIT"`, 5000);
      if (!checkDir.success || checkDir.output.trim() !== "GIT_OK") {
        return { success: false, message: `${appDir} is not a git repo. Use deploy instead.`, logs };
      }

      const pullResult = await service.executeCommand(
        `cd ${appDir} && git fetch origin && git reset --hard origin/${branch} 2>&1`,
        30000
      );
      logs.push(`Pull: ${pullResult.success ? "OK" : pullResult.error || "failed"}`);
      if (!pullResult.success) return { success: false, message: `Git pull failed: ${pullResult.error}`, logs };

      const typeResult = await service.detectProjectType(appDir);
      logs.push(`Type: ${typeResult}`);

      if (typeResult === "static") {
        const reloadNginx = await service.executeCommand(`nginx -t 2>&1 && systemctl reload nginx && echo "OK"`, 10000);
        logs.push(`Nginx reload: ${reloadNginx.success ? "OK" : reloadNginx.error || "failed"}`);
        return { success: true, message: `Static site "${appName}" updated from ${branch}`, logs };
      }

      if (typeResult === "spa-build") {
        const hasLock = await service.executeCommand(`[ -f "${appDir}/package-lock.json" ] && echo "HAS_LOCK" || echo "NO_LOCK"`, 5000);
        const installCmd = hasLock.output?.includes("HAS_LOCK") ? "npm ci --production=false" : "npm install --production=false --no-audit --no-fund";
        const installResult = await service.executeCommand(`cd ${appDir} && ${installCmd} 2>&1 | tail -10`, 120000);
        logs.push(`Install: ${installResult.success ? "OK" : installResult.error || "failed"}`);
        if (!installResult.success) return { success: false, message: `Install failed: ${installResult.error}`, logs };

        const buildResult = await service.executeCommand(`cd ${appDir} && npm run build 2>&1 | tail -15`, 120000);
        logs.push(`Build: ${buildResult.success ? "OK" : buildResult.error || "failed"}`);
        if (!buildResult.success) return { success: false, message: `Build failed: ${buildResult.error}`, logs };

        const distDir = `${appDir}/dist`;
        const buildOutputCheck = await service.executeCommand(
          `[ -d "${distDir}" ] && echo "DIST_OK" || ([ -d "${appDir}/build" ] && echo "BUILD_OK" || echo "NO_OUTPUT")`, 5000
        );
        const buildOut = buildOutputCheck.output?.trim() || "";
        let serveDir = distDir;
        if (buildOut === "BUILD_OK") serveDir = `${appDir}/build`;
        else if (buildOut !== "DIST_OK") serveDir = appDir;

        {
          const nginxDomain = resolveAppDomain(appName);
          const spaNginxConf = staticNginxBlock(nginxDomain, serveDir);
          await service.writeRemoteFile(`/etc/nginx/sites-available/${appName}`, spaNginxConf);
          const nginxReload = await service.executeCommand(
            `ln -sf /etc/nginx/sites-available/${appName} /etc/nginx/sites-enabled/${appName} && nginx -t 2>&1 && systemctl reload nginx && echo "OK"`,
            10000
          );
          logs.push(`Nginx (SPA): ${nginxReload.success ? "configured for " + nginxDomain : nginxReload.error || "failed"}`);
        }

        return { success: true, message: `SPA "${appName}" built and deployed from ${branch}`, logs };
      }

      const installResult = await service.executeCommand(`cd ${appDir} && npm ci --production=false 2>&1 | tail -3`, 120000);
      logs.push(`npm ci: ${installResult.success ? "OK" : installResult.error || "failed"}`);

      const hasBuild = await service.executeCommand(`cd ${appDir} && node -e "const p=require('./package.json'); process.exit(p.scripts?.build ? 0 : 1)"`, 5000);
      if (hasBuild.success) {
        const buildResult = await service.executeCommand(`cd ${appDir} && npm run build 2>&1 | tail -5`, 120000);
        logs.push(`Build: ${buildResult.success ? "OK" : buildResult.error || "failed"}`);
        if (!buildResult.success) return { success: false, message: `Build failed: ${buildResult.error}`, logs };
      }

      const portResult = await service.executeCommand(
        `grep -oP '"PORT":\\s*"\\K[0-9]+' ${appDir}/ecosystem.config.cjs 2>/dev/null || grep -oP 'PORT="?\\K[0-9]+' ${appDir}/.env 2>/dev/null || echo "0"`,
        5000
      );
      const appPort = parseInt(portResult.output?.trim() || "0", 10);

      if (appPort > 0) {
        const nginxPortResult = await service.executeCommand(
          `grep -oP 'server 127.0.0.1:\\K[0-9]+' /etc/nginx/sites-enabled/${normalizeNginxName(appName)} 2>/dev/null || echo "0"`,
          5000
        );
        const nginxPort = parseInt(nginxPortResult.output?.trim() || "0", 10);
        if (nginxPort > 0 && nginxPort !== appPort) {
          logs.push(`Port fix: nginx had ${nginxPort}, app uses ${appPort} — regenerating nginx config`);
          const nginxDomain = resolveAppDomain(appName);
          const proxyConfigName = normalizeNginxName(appName);
          const nginxConf = proxyNginxBlock(nginxDomain, appName, appPort);
          await service.writeRemoteFile(`/etc/nginx/sites-available/${proxyConfigName}`, nginxConf);
          await service.executeCommand(
            `ln -sf /etc/nginx/sites-available/${proxyConfigName} /etc/nginx/sites-enabled/${proxyConfigName} && nginx -t 2>&1 && systemctl reload nginx`,
            10000
          );
        }
      }

      const restartResult = await service.executeCommand(`pm2 restart ${appName} 2>&1 | tail -5`, 15000);
      logs.push(`Restart: ${restartResult.success ? "OK" : restartResult.error || "failed"}`);

      if (appPort > 0) {
        for (let attempt = 1; attempt <= 3; attempt++) {
          const healthCheck = await service.executeCommand(
            `sleep 3 && curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:${appPort}/ 2>/dev/null || echo "000"`,
            15000
          );
          const httpCode = healthCheck.output?.trim() || "000";
          if (httpCode !== "000") {
            logs.push(`Health: HTTP ${httpCode} on port ${appPort}`);
            break;
          }
          if (attempt === 3) logs.push(`Health: app not responding on port ${appPort} after ${attempt} attempts`);
        }
      } else {
        const healthCheck = await service.executeCommand(
          `sleep 3 && pm2 show ${appName} 2>/dev/null | grep status | head -1`,
          10000
        );
        logs.push(`Health: ${healthCheck.output?.trim() || "unknown"}`);
      }

      return { success: true, message: `App "${appName}" updated from ${branch}\n${logs.join("\n")}`, logs };
    },

    async deployPlaceholderPages(slug: string, projectName: string): Promise<{ success: boolean; message: string; urls: { staging: string; production: string } }> {
      const prodDomain = `${slug}.ulyssepro.org`;
      const stagingDomain = `${slug}-dev.ulyssepro.org`;
      const prodDir = `/var/www/placeholder/${slug}`;
      const stagingDir = `/var/www/placeholder/${slug}-dev`;
      const logs: string[] = [];

      const placeholderHtml = (env: string) => `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${projectName} — ${env === "production" ? "Production" : "Staging"}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
      font-family: system-ui, -apple-system, sans-serif;
      color: #fff;
      overflow: hidden;
    }
    .container {
      text-align: center;
      max-width: 600px;
      padding: 3rem 2rem;
      animation: fadeIn 1s ease-out;
    }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    .logo {
      width: 80px; height: 80px;
      margin: 0 auto 2rem;
      background: linear-gradient(135deg, #7c3aed, #a78bfa);
      border-radius: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2.5rem;
      box-shadow: 0 8px 32px rgba(124, 58, 237, 0.3);
    }
    h1 {
      font-size: 1.8rem;
      margin-bottom: 1rem;
      background: linear-gradient(to right, #a78bfa, #c4b5fd);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .subtitle {
      font-size: 1.1rem;
      color: #c4b5fd;
      margin-bottom: 2rem;
      line-height: 1.6;
    }
    .badge {
      display: inline-block;
      padding: 0.4rem 1rem;
      border-radius: 999px;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      background: ${env === "production" ? "rgba(34, 197, 94, 0.15)" : "rgba(234, 179, 8, 0.15)"};
      color: ${env === "production" ? "#4ade80" : "#facc15"};
      border: 1px solid ${env === "production" ? "rgba(34, 197, 94, 0.3)" : "rgba(234, 179, 8, 0.3)"};
      margin-bottom: 2rem;
    }
    .message {
      font-size: 1rem;
      color: #94a3b8;
      line-height: 1.8;
    }
    .dots { display: inline-flex; gap: 4px; margin-left: 4px; }
    .dots span {
      width: 4px; height: 4px;
      background: #a78bfa;
      border-radius: 50%;
      animation: pulse 1.5s infinite;
    }
    .dots span:nth-child(2) { animation-delay: 0.3s; }
    .dots span:nth-child(3) { animation-delay: 0.6s; }
    @keyframes pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
    .footer {
      margin-top: 3rem;
      font-size: 0.75rem;
      color: #475569;
    }
    .footer a { color: #7c3aed; text-decoration: underline; cursor: pointer; }
    .footer a:hover { color: #a78bfa; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">🚀</div>
    <div class="badge">${env === "production" ? "Production" : "Staging / Test"}</div>
    <h1>${projectName}</h1>
    <p class="subtitle">En attendant votre premier deploiement</p>
    <p class="message">
      Pas de panique, Ulysse s'occupe de tout
      <span class="dots"><span></span><span></span><span></span></span>
    </p>
    <div class="footer">
      Propulse par Ulysse DevOps
    </div>
  </div>
</body>
</html>`;

      try {
        const { cloudflareService } = await import("../cloudflareService");
        const dnsResult = await cloudflareService.ensureDnsRecords(slug);
        if (dnsResult.success) {
          const actions = dnsResult.results.map(r => `${r.domain}: ${r.action}`).join(", ");
          logs.push(`DNS Cloudflare: ${actions}`);
        } else {
          const errors = dnsResult.results.filter(r => r.error).map(r => `${r.domain}: ${r.error}`).join(", ");
          logs.push(`DNS Cloudflare: partial — ${errors}`);
        }

        await service.executeCommand(`mkdir -p ${prodDir} ${stagingDir}`, 5000);
        logs.push("Directories created");

        await service.writeRemoteFile(`${prodDir}/index.html`, placeholderHtml("production"));
        await service.writeRemoteFile(`${stagingDir}/index.html`, placeholderHtml("staging"));
        logs.push("Placeholder pages written");

        const prodConf = staticNginxBlock(prodDomain, prodDir);
        const stagingConf = staticNginxBlock(stagingDomain, stagingDir);

        await service.writeRemoteFile(`/etc/nginx/sites-available/${slug}-placeholder`, prodConf);
        await service.writeRemoteFile(`/etc/nginx/sites-available/${slug}-dev-placeholder`, stagingConf);

        const linkResult = await service.executeCommand(
          `rm -f /etc/nginx/sites-enabled/${slug}-staging-placeholder /etc/nginx/sites-available/${slug}-staging-placeholder 2>/dev/null; ` +
          `ln -sf /etc/nginx/sites-available/${slug}-placeholder /etc/nginx/sites-enabled/${slug}-placeholder && ` +
          `ln -sf /etc/nginx/sites-available/${slug}-dev-placeholder /etc/nginx/sites-enabled/${slug}-dev-placeholder && ` +
          `nginx -t 2>&1 && systemctl reload nginx && echo "NGINX_OK"`,
          15000
        );

        if (linkResult.output?.includes("NGINX_OK")) {
          logs.push("Nginx configured and reloaded");
        } else {
          logs.push(`Nginx warning: ${linkResult.error || linkResult.output}`);
        }

        const prodCheck = await service.executeCommand(
          `curl -sk -o /dev/null -w "%{http_code}" -H "Host: ${prodDomain}" https://127.0.0.1/ 2>/dev/null || echo "000"`,
          10000
        );
        const stagingCheck = await service.executeCommand(
          `curl -sk -o /dev/null -w "%{http_code}" -H "Host: ${stagingDomain}" https://127.0.0.1/ 2>/dev/null || echo "000"`,
          10000
        );
        logs.push(`Health: prod=${prodCheck.output?.trim()} staging=${stagingCheck.output?.trim()}`);

        console.log(`[SSH] Placeholder pages deployed for ${slug}: ${logs.join(" | ")}`);
        return {
          success: true,
          message: `Placeholder pages deployed!\n${logs.join("\n")}`,
          urls: { staging: `https://${stagingDomain}`, production: `https://${prodDomain}` }
        };
      } catch (err: any) {
        console.error(`[SSH] Placeholder deploy failed for ${slug}:`, err.message);
        return {
          success: false,
          message: `Placeholder deploy failed: ${err.message}\n${logs.join("\n")}`,
          urls: { staging: `https://${stagingDomain}`, production: `https://${prodDomain}` }
        };
      }
    },

    async removePlaceholderPages(slug: string): Promise<void> {
      await service.executeCommand(
        `rm -f /etc/nginx/sites-enabled/${slug}-placeholder /etc/nginx/sites-enabled/${slug}-staging-placeholder /etc/nginx/sites-enabled/${slug}-dev-placeholder && ` +
        `rm -f /etc/nginx/sites-available/${slug}-placeholder /etc/nginx/sites-available/${slug}-staging-placeholder /etc/nginx/sites-available/${slug}-dev-placeholder && ` +
        `nginx -t 2>&1 && systemctl reload nginx`,
        10000
      ).catch(() => {});
    },

    async verifyDeployedUrl(domain: string): Promise<{
      success: boolean;
      httpCode: number;
      responseTime: number;
      message: string;
    }> {
      const start = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const resp = await fetch(`https://${domain}`, {
          signal: controller.signal,
          redirect: "follow",
          headers: { "User-Agent": "DevMax-Deploy-Verify/1.0" },
        });
        clearTimeout(timeout);
        const responseTime = Date.now() - start;
        return {
          success: resp.status >= 200 && resp.status < 500,
          httpCode: resp.status,
          responseTime,
          message: `HTTPS ${resp.status} in ${responseTime}ms`,
        };
      } catch (err: any) {
        return {
          success: false,
          httpCode: 0,
          responseTime: Date.now() - start,
          message: `Verify failed: ${err.message}`,
        };
      }
    },

    async checkAllDeployedUrls(): Promise<Array<{ project: string; url: string; status: number | null; healthy: boolean; responseTime: number }>> {
      try {
        const { db } = await import("../../db");
        const { sql } = await import("drizzle-orm");
        const projects = await db.execute(sql`
          SELECT name, deploy_slug, staging_url, production_url, environment 
          FROM devmax_projects 
          WHERE deploy_slug IS NOT NULL AND (staging_url IS NOT NULL OR production_url IS NOT NULL)
        `).then((r: any) => r.rows || r);

        const results: Array<{ project: string; url: string; status: number | null; healthy: boolean; responseTime: number }> = [];

        for (const p of projects) {
          const urls = [p.staging_url, p.production_url].filter(Boolean);
          for (const url of urls) {
            const start = Date.now();
            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 10000);
              const resp = await fetch(url, { signal: controller.signal, redirect: "follow" });
              clearTimeout(timeout);
              results.push({
                project: p.name,
                url,
                status: resp.status,
                healthy: resp.status >= 200 && resp.status < 500,
                responseTime: Date.now() - start,
              });
            } catch {
              results.push({
                project: p.name,
                url,
                status: null,
                healthy: false,
                responseTime: Date.now() - start,
              });
            }
          }
        }
        return results;
      } catch (e: any) {
        console.error("[SSH] checkAllDeployedUrls error:", e.message);
        return [];
      }
    },
  };
}
