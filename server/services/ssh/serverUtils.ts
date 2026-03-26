import type { SSHService } from "./core";
import { sslCertForDomain } from "./helpers";

export function createServerMethods(service: SSHService) {
  return {
    async serverStatus(): Promise<any> {
      const result = await service.executeCommand(
        `echo "hostname=$(hostname)" && echo "uptime=$(uptime -p)" && echo "cpu=$(nproc) cores" && free -h | awk '/Mem:/{print "memory="$2" total, "$3" used, "$4" free"}' && df -h / | awk 'NR==2{print "disk="$2" total, "$3" used, "$4" free ("$5" used)"}' && echo "node=$(node --version 2>/dev/null || echo NOT_INSTALLED)" && echo "pm2_apps=$(pm2 jlist 2>/dev/null | node -e 'const d=require("fs").readFileSync("/dev/stdin","utf8");try{console.log(JSON.parse(d).length)}catch{console.log(0)}' 2>/dev/null || echo 0)" && echo "nginx=$(systemctl is-active nginx 2>/dev/null || echo inactive)"`,
        15000
      );
      if (!result.success) return { error: result.error };
      const data: Record<string, string> = {};
      result.output.split("\n").forEach(line => {
        const [key, ...val] = line.split("=");
        if (key && val.length) data[key.trim()] = val.join("=").trim();
      });
      return data;
    },

    async listApps(): Promise<any> {
      const result = await service.executeCommand(
        `pm2 jlist 2>/dev/null || echo "[]"`,
        10000
      );
      if (!result.success) return { error: result.error };
      try {
        const apps = JSON.parse(result.output);
        return apps.map((app: any) => ({
          name: app.name,
          status: app.pm2_env?.status,
          cpu: app.monit?.cpu,
          memory: app.monit?.memory ? Math.round(app.monit.memory / 1024 / 1024) + "MB" : "0MB",
          uptime: app.pm2_env?.pm_uptime ? new Date(app.pm2_env.pm_uptime).toISOString() : null,
          restarts: app.pm2_env?.restart_time
        }));
      } catch {
        return [];
      }
    },

    async findFreePort(startPort?: number, caller: "max" | "ulysse" | "iris" = "ulysse", excludePorts?: number[]): Promise<number> {
      const basePort = startPort ?? (caller === "max" ? 6000 : caller === "iris" ? 5200 : 5100);
      const maxPort = basePort + 100;
      const result = await service.executeCommand(
        `(ss -tlnp 2>/dev/null | grep -oP ':\\K[0-9]+' || true; grep -rhoP 'proxy_pass\\s+http://127\\.0\\.0\\.1:\\K[0-9]+' /etc/nginx/sites-available/ 2>/dev/null || true; grep -rhoP 'PORT.*?\\K[0-9]{4,5}' /var/www/apps/*/ecosystem.config.cjs /var/www/apps/*/.env 2>/dev/null || true) | sort -un`,
        10000
      );
      const usedPorts = new Set(
        (result.output || "").split("\n").map(s => parseInt(s.trim())).filter(n => !isNaN(n))
      );
      try {
        const { db } = await import("../../db");
        const { sql } = await import("drizzle-orm");
        const dbPorts = await db.execute(sql`SELECT staging_port, production_port FROM devmax_projects WHERE staging_port IS NOT NULL OR production_port IS NOT NULL`);
        for (const row of (dbPorts.rows || dbPorts) as any[]) {
          if (row.staging_port) usedPorts.add(Number(row.staging_port));
          if (row.production_port) usedPorts.add(Number(row.production_port));
        }
      } catch {}
      if (excludePorts) excludePorts.forEach(p => usedPorts.add(p));
      for (let p = basePort; p <= maxPort; p++) {
        if (!usedPorts.has(p)) {
          console.log(`[SSH] findFreePort(${caller}): assigned port ${p} (range ${basePort}-${maxPort})`);
          return p;
        }
      }
      console.warn(`[SSH] findFreePort(${caller}): no free port in range ${basePort}-${maxPort}, falling back to ${basePort}`);
      return basePort;
    },

    async reserveProjectPorts(projectId: string, caller: "max" | "ulysse" | "iris" = "max"): Promise<{ stagingPort: number; productionPort: number }> {
      const { db } = await import("../../db");
      const { sql } = await import("drizzle-orm");
      const [existing] = await db.execute(sql`SELECT staging_port, production_port FROM devmax_projects WHERE id = ${projectId}`).then((r: any) => r.rows || r);
      if (existing?.staging_port && existing?.production_port) {
        console.log(`[SSH] reserveProjectPorts(${projectId}): already reserved staging=${existing.staging_port} prod=${existing.production_port}`);
        return { stagingPort: Number(existing.staging_port), productionPort: Number(existing.production_port) };
      }
      const stagingPort = existing?.staging_port ? Number(existing.staging_port) : await service.findFreePort(undefined, caller);
      const productionPort = existing?.production_port ? Number(existing.production_port) : await service.findFreePort(undefined, caller, [stagingPort]);
      await db.execute(sql`
        UPDATE devmax_projects 
        SET staging_port = ${stagingPort}, production_port = ${productionPort}, updated_at = NOW()
        WHERE id = ${projectId}
      `);
      console.log(`[SSH] reserveProjectPorts(${projectId}): reserved staging=${stagingPort} prod=${productionPort} (${caller} range)`);
      return { stagingPort, productionPort };
    },

    async createDatabase(dbName: string, dbUser: string, dbPassword: string): Promise<{ success: boolean; connectionUrl: string; message: string }> {
      const createScript = [
        `sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${dbUser}'" | grep -q 1 || sudo -u postgres psql -c "CREATE USER ${dbUser} WITH PASSWORD '${dbPassword}'"`,
        `sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${dbName}'" | grep -q 1 && echo "DB_EXISTS" || sudo -u postgres psql -c "CREATE DATABASE ${dbName} OWNER ${dbUser}"`,
        `sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${dbName} TO ${dbUser}"`,
        `echo "DB_READY"`,
      ].join(" && ");

      const result = await service.executeCommand(createScript, 20000);
      const connectionUrl = `postgresql://${dbUser}:${dbPassword}@localhost:5432/${dbName}`;

      if (!result.success) {
        return { success: false, connectionUrl, message: `DB creation failed: ${result.error}` };
      }
      return {
        success: true,
        connectionUrl,
        message: result.output.includes("DB_EXISTS") ? `Database ${dbName} already exists` : `Database ${dbName} created`
      };
    },

    async detectProjectType(appDir: string): Promise<"static" | "node" | "spa-build" | "unknown"> {
      const probe = await service.executeCommand(
        `echo "---FILES---" && ` +
        `[ -f "${appDir}/package.json" ] && echo "HAS_PKG" || echo "NO_PKG"; ` +
        `[ -f "${appDir}/index.html" ] && echo "HAS_HTML" || echo "NO_HTML"; ` +
        `[ -f "${appDir}/vite.config.ts" ] || [ -f "${appDir}/vite.config.js" ] && echo "HAS_VITE_CONFIG" || echo "NO_VITE_CONFIG"; ` +
        `[ -f "${appDir}/next.config.js" ] || [ -f "${appDir}/next.config.mjs" ] || [ -f "${appDir}/next.config.ts" ] && echo "HAS_NEXT_CONFIG" || echo "NO_NEXT_CONFIG"; ` +
        `[ -d "${appDir}/dist" ] && echo "HAS_DIST" || echo "NO_DIST"; ` +
        `[ -d "${appDir}/build" ] && echo "HAS_BUILD_DIR" || echo "NO_BUILD_DIR"; ` +
        `[ -d "${appDir}/server" ] || [ -d "${appDir}/src/server" ] && echo "HAS_SERVER_DIR" || echo "NO_SERVER_DIR"; ` +
        `echo "---PKG---" && cat "${appDir}/package.json" 2>/dev/null || echo "{}"`,
        8000
      );
      const out = probe.output || "";
      const hasPkg = out.includes("HAS_PKG");
      const hasHtml = out.includes("HAS_HTML");
      const hasViteConfig = out.includes("HAS_VITE_CONFIG");
      const hasNextConfig = out.includes("HAS_NEXT_CONFIG");
      const hasDist = out.includes("HAS_DIST");
      const hasBuildDir = out.includes("HAS_BUILD_DIR");
      const hasServerDir = out.includes("HAS_SERVER_DIR");

      if (!hasPkg) {
        if (hasHtml || hasDist || hasBuildDir) return "static";
        return "unknown";
      }

      const pkgRaw = out.split("---PKG---")[1] || "{}";
      let pkg: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
      try { pkg = JSON.parse(pkgRaw.trim()); } catch { pkg = {}; }

      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const scripts = pkg.scripts || {};
      const allDepsStr = Object.keys(deps).join(" ");

      const serverFrameworks = ["express", "fastify", "koa", "hapi", "@hapi/hapi", "hono", "@nestjs/core", "restify", "polka", "socket.io"];
      const hasServerFramework = serverFrameworks.some(fw => allDepsStr.includes(fw));

      const hasNextDep = !!deps["next"];
      const hasSvelteKit = !!deps["@sveltejs/kit"];
      const hasNuxt = !!deps["nuxt"];
      const hasSSRFramework = hasNextDep || hasSvelteKit || hasNuxt || hasNextConfig;

      const frontendBuildTools = ["vite", "react-scripts", "@angular/cli", "parcel", "webpack-cli", "snowpack", "esbuild"];
      const hasFrontendBuild = frontendBuildTools.some(t => allDepsStr.includes(t)) || hasViteConfig;

      const frontendOnlyLibs = ["react", "react-dom", "vue", "svelte", "@angular/core", "preact", "solid-js", "lit"];
      const hasFrontendLib = frontendOnlyLibs.some(lib => !!deps[lib]);

      const serverScriptPatterns = ["node ", "tsx ", "ts-node ", "nodemon ", "express", "server."];
      const startScript = scripts.start || "";
      const devScript = scripts.dev || "";
      const startLooksLikeServer = serverScriptPatterns.some(p => startScript.includes(p) || devScript.includes(p));

      if (hasSSRFramework) return "node";
      if (hasServerFramework) return "node";
      if (hasFrontendBuild || hasViteConfig) {
        if (!startLooksLikeServer) return "spa-build";
        return "node";
      }
      if (hasFrontendLib && !startLooksLikeServer) return "spa-build";
      if (startLooksLikeServer || hasServerDir) return "node";
      if (hasHtml && !scripts.start) return "static";
      if (hasDist || hasBuildDir) return "static";
      return "node";
    },

    async serverHealth(): Promise<any> {
      const result = await service.executeCommand(
        `echo "=== SYSTEM ===" && uptime && echo "=== MEMORY ===" && free -h && echo "=== DISK ===" && df -h / /var/www && echo "=== PM2 ===" && pm2 jlist 2>/dev/null && echo "=== NGINX ===" && systemctl is-active nginx 2>/dev/null && echo "=== CONNECTIONS ===" && ss -s 2>/dev/null | head -5 && echo "=== PROCESSES ===" && ps aux --sort=-%mem | head -6 && echo "=== POSTGRES ===" && sudo -u postgres psql -c "SELECT count(*) as active_connections FROM pg_stat_activity WHERE state = 'active'" -t 2>/dev/null && echo "=== LOAD ===" && cat /proc/loadavg && echo "=== SSL CERTS ===" && for cert in /etc/ssl/certs/ulysse.crt /etc/letsencrypt/live/*/cert.pem; do [ -f "$cert" ] && echo "$cert: $(openssl x509 -enddate -noout -in "$cert" 2>/dev/null)"; done`,
        15000
      );
      return result.success ? result.output : `Error: ${result.error}`;
    },

    async manageCron(action: "list" | "add" | "delete", cronExpression?: string, cronCommand?: string): Promise<string> {
      if (action === "list") {
        const result = await service.executeCommand(`crontab -l 2>/dev/null || echo "NO_CRONTAB"`, 5000);
        return JSON.stringify({ crontab: result.output.trim() === "NO_CRONTAB" ? [] : result.output.split("\n").filter(l => l.trim() && !l.startsWith("#")) });
      }
      if (action === "add" && cronExpression && cronCommand) {
        const entry = `${cronExpression} ${cronCommand}`;
        const result = await service.executeCommand(
          `(crontab -l 2>/dev/null; echo '${entry.replace(/'/g, "'\\''")}') | sort -u | crontab - && echo "CRON_ADDED"`,
          5000
        );
        return JSON.stringify({ success: result.success, entry });
      }
      if (action === "delete" && cronCommand) {
        const result = await service.executeCommand(
          `crontab -l 2>/dev/null | grep -v '${cronCommand.replace(/'/g, "'\\''")}' | crontab - && echo "CRON_REMOVED"`,
          5000
        );
        return JSON.stringify({ success: result.success, removed: cronCommand });
      }
      return JSON.stringify({ error: "Invalid cron action" });
    },

    async listDatabases(): Promise<string> {
      const result = await service.executeCommand(
        `sudo -u postgres psql -t -A -c "SELECT d.datname, pg_size_pretty(pg_database_size(d.datname)), u.usename FROM pg_database d LEFT JOIN pg_user u ON d.datdba = u.usesysid WHERE d.datistemplate = false ORDER BY d.datname" 2>/dev/null`,
        10000
      );
      if (!result.success) return JSON.stringify({ error: result.error });
      const databases = result.output.split("\n").filter(l => l.trim()).map(line => {
        const [name, size, owner] = line.split("|");
        return { name: name?.trim(), size: size?.trim(), owner: owner?.trim() };
      });
      return JSON.stringify({ databases });
    },

    async backupDb(dbName: string): Promise<string> {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const backupDir = "/var/www/backups";
      const backupFile = `${backupDir}/${dbName}_${timestamp}.sql.gz`;
      const mkdirResult = await service.executeCommand(`mkdir -p ${backupDir}`, 5000);
      if (!mkdirResult.success) return JSON.stringify({ error: "Cannot create backup dir" });

      const dumpResult = await service.executeCommand(
        `sudo -u postgres pg_dump ${dbName} 2>/dev/null | gzip > ${backupFile} && ls -lh ${backupFile} | awk '{print $5}'`,
        60000
      );
      if (!dumpResult.success) return JSON.stringify({ error: `Backup failed: ${dumpResult.error}` });
      return JSON.stringify({ success: true, dbName, file: backupFile, size: dumpResult.output.trim() });
    },

    async restoreDb(dbName: string, backupFile: string): Promise<string> {
      const checkFile = await service.executeCommand(`[ -f "${backupFile}" ] && echo "OK" || echo "NOT_FOUND"`, 5000);
      if (checkFile.output.trim() !== "OK") return JSON.stringify({ error: `Backup file not found: ${backupFile}` });

      const result = await service.executeCommand(
        `gunzip -c ${backupFile} | sudo -u postgres psql ${dbName} 2>&1 | tail -3`,
        120000
      );
      return JSON.stringify({ success: result.success, dbName, backupFile, output: result.output });
    },

    async listBackups(): Promise<string> {
      const result = await service.executeCommand(
        `ls -lhS /var/www/backups/*.sql.gz 2>/dev/null | awk '{print $9"|"$5"|"$6" "$7" "$8}' || echo "NO_BACKUPS"`,
        5000
      );
      if (!result.success || result.output.trim() === "NO_BACKUPS") return JSON.stringify({ backups: [] });
      const backups = result.output.split("\n").filter(l => l.trim()).map(line => {
        const [file, size, date] = line.split("|");
        return { file: file?.trim(), size: size?.trim(), date: date?.trim() };
      });
      return JSON.stringify({ backups });
    },

    async setupSSL(domain: string): Promise<string> {
      const result = await service.executeCommand(
        `certbot --nginx -d ${domain} --non-interactive --agree-tos -m admin@${domain.split(".").slice(-2).join(".")} 2>&1`,
        60000
      );
      return result.success ? `SSL certificate installed for ${domain}` : `SSL error: ${result.error}`;
    },

    async checkSslStatus(domain: string): Promise<{ valid: boolean; expiresAt?: string; daysLeft?: number; issuer?: string; error?: string }> {
      const result = await service.executeCommand(
        `echo | openssl s_client -servername ${domain} -connect ${domain}:443 2>/dev/null | openssl x509 -noout -dates -issuer 2>/dev/null || echo "CERT_ERROR"`,
        10000
      );
      const output = result.output || "";
      if (output.includes("CERT_ERROR") || !output.includes("notAfter")) {
        return { valid: false, error: "No valid certificate found" };
      }
      const notAfterMatch = output.match(/notAfter=(.+)/);
      const issuerMatch = output.match(/issuer=(.+)/);
      if (!notAfterMatch) return { valid: false, error: "Cannot parse certificate" };

      const expiresAt = new Date(notAfterMatch[1]).toISOString();
      const daysLeft = Math.floor((new Date(notAfterMatch[1]).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      return {
        valid: daysLeft > 0,
        expiresAt,
        daysLeft,
        issuer: issuerMatch?.[1]?.trim(),
      };
    },

    async setupSslAutoRenew(): Promise<{ success: boolean; message: string }> {
      const checkExisting = await service.executeCommand(`crontab -l 2>/dev/null | grep -c "certbot renew" || echo "0"`, 5000);
      if (parseInt(checkExisting.output?.trim() || "0") > 0) {
        return { success: true, message: "SSL auto-renew already configured" };
      }

      const result = await service.executeCommand([
        `which certbot >/dev/null 2>&1 || apt-get install -y certbot python3-certbot-nginx >/dev/null 2>&1`,
        `(crontab -l 2>/dev/null; echo "0 3 */7 * * certbot renew --nginx --quiet --post-hook 'systemctl reload nginx' >> /var/log/certbot-renew.log 2>&1") | sort -u | crontab -`,
        `echo "SSL auto-renew configured"`,
      ].join(" && "), 30000);

      if (!result.success) {
        return { success: false, message: `Failed to setup auto-renew: ${result.error}` };
      }
      return { success: true, message: "SSL auto-renew configured (certbot renew every 7 days at 3 AM)" };
    },

    async resolveGitHubToken(): Promise<string | null> {
      try {
        const { connectorBridge } = await import("../connectorBridge");
        const conn = await connectorBridge.getGitHub();
        if (conn.accessToken) return conn.accessToken;
      } catch (e) {
        console.log("[SSH] connectorBridge GitHub fallback:", (e as Error).message);
      }
      return process.env.MAURICE_GITHUB_PAT
        || process.env.GITHUB_PERSONAL_ACCESS_TOKEN
        || process.env.GITHUB_TOKEN
        || process.env.GITHUB_PAT
        || null;
    },

    sanitizeLogs(text: string, token: string | null): string {
      if (!token || !text) return text;
      const masked = token.slice(0, 4) + "***" + token.slice(-4);
      return text.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), masked);
    },

    async authenticatedGitClone(params: {
      repoUrl: string;
      branch: string;
      appDir: string;
      depth?: number;
      retries?: number;
    }): Promise<{ success: boolean; method: string; error?: string }> {
      const { repoUrl, branch, appDir, depth = 1, retries = 2 } = params;
      const isGitHub = repoUrl.includes("github.com");
      const token = isGitHub ? await service.resolveGitHubToken() : null;
      const depthFlag = depth > 0 ? `--depth ${depth}` : "";

      const strategies: { name: string; getUrl: () => string }[] = [];

      if (token && isGitHub) {
        strategies.push({
          name: "github-token-https",
          getUrl: () => repoUrl.replace("https://github.com/", `https://x-access-token:${token}@github.com/`),
        });
        strategies.push({
          name: "github-pat-https",
          getUrl: () => repoUrl.replace("https://github.com/", `https://${token}@github.com/`),
        });
      }

      if (isGitHub) {
        strategies.push({
          name: "ssh-deploy-key",
          getUrl: () => {
            const match = repoUrl.match(/github\.com[/:](.+?)(?:\.git)?$/);
            return match ? `git@github.com:${match[1]}.git` : repoUrl;
          },
        });
      }

      strategies.push({
        name: "public-https",
        getUrl: () => repoUrl,
      });

      for (const strategy of strategies) {
        const url = strategy.getUrl();
        console.log(`[SSH] Clone attempt: ${strategy.name} → ${appDir} (branch: ${branch})`);

        for (let attempt = 1; attempt <= retries; attempt++) {
          const cloneScript = [
            `set -e`,
            `rm -rf ${appDir}`,
            `mkdir -p ${appDir}`,
            `GIT_TERMINAL_PROMPT=0 git clone ${depthFlag} -b ${branch} ${url} ${appDir} 2>&1`,
          ].join(" && ");

          const result = await service.executeCommand(cloneScript, 120000);

          if (result.success) {
            console.log(`[SSH] Clone success: ${strategy.name} (attempt ${attempt})`);
            const verifyResult = await service.executeCommand(`ls ${appDir}/.git/HEAD 2>/dev/null && echo "GIT_OK" || echo "NO_GIT"`, 5000);
            if (verifyResult.output?.includes("GIT_OK")) {
              return { success: true, method: strategy.name };
            }
            console.log(`[SSH] Clone dir invalid after ${strategy.name}, retrying...`);
          }

          const sanitizedError = service.sanitizeLogs(result.error || result.output || "unknown error", token);
          console.log(`[SSH] Clone failed (${strategy.name} attempt ${attempt}/${retries}): ${sanitizedError.slice(0, 200)}`);

          if (sanitizedError.includes("Repository not found") || sanitizedError.includes("not found")) {
            if (strategy.name === "public-https") {
              return { success: false, method: strategy.name, error: "Repository not found. Check repo URL and permissions." };
            }
            break;
          }

          if (sanitizedError.includes("could not read Username") || sanitizedError.includes("terminal prompts disabled")) {
            break;
          }

          if (attempt < retries) {
            await new Promise(r => setTimeout(r, 2000 * attempt));
          }
        }
      }

      return {
        success: false,
        method: "all-failed",
        error: `All clone strategies failed for ${repoUrl}. Strategies tried: ${strategies.map(s => s.name).join(", ")}. Ensure GitHub token has repo access or a deploy key is configured on the VPS.`,
      };
    },

    async verifyRepoAccess(owner: string, name: string): Promise<{ accessible: boolean; private: boolean; error?: string }> {
      const token = await service.resolveGitHubToken();
      if (!token) {
        const publicCheck = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
          headers: { "Accept": "application/vnd.github+json", "User-Agent": "DevMax-Deploy" },
        }).catch(() => null);
        if (publicCheck?.ok) {
          const data = await publicCheck.json();
          return { accessible: true, private: data.private || false };
        }
        return { accessible: false, private: true, error: "No GitHub token available and repo is not public" };
      }

      const res = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "DevMax-Deploy",
        },
      }).catch(() => null);

      if (!res) return { accessible: false, private: true, error: "GitHub API unreachable" };
      if (res.status === 404) return { accessible: false, private: true, error: "Repository not found or token lacks access" };
      if (res.status === 403) return { accessible: false, private: true, error: "Token lacks permissions for this repository" };
      if (!res.ok) return { accessible: false, private: true, error: `GitHub API error: ${res.status}` };

      const data = await res.json();
      return { accessible: true, private: data.private || false };
    },

    async setupVpsDeployKey(owner: string, repoName: string): Promise<{ success: boolean; message: string }> {
      const keyPath = `/root/.ssh/deploy_${owner}_${repoName}`;

      const checkKey = await service.executeCommand(`test -f ${keyPath} && echo "EXISTS" || echo "MISSING"`, 5000);
      if (checkKey.output?.includes("EXISTS")) {
        return { success: true, message: "Deploy key already exists" };
      }

      const genResult = await service.executeCommand([
        `ssh-keygen -t ed25519 -f ${keyPath} -N "" -C "devmax-deploy-${owner}/${repoName}"`,
        `chmod 600 ${keyPath}`,
        `cat ${keyPath}.pub`,
      ].join(" && "), 10000);

      if (!genResult.success) {
        return { success: false, message: `Key generation failed: ${genResult.error}` };
      }

      const sshConfigEntry = `\nHost github-${owner}-${repoName}\n  HostName github.com\n  User git\n  IdentityFile ${keyPath}\n  IdentitiesOnly yes\n  StrictHostKeyChecking no\n`;
      await service.executeCommand([
        `grep -q "github-${owner}-${repoName}" /root/.ssh/config 2>/dev/null || echo '${sshConfigEntry}' >> /root/.ssh/config`,
        `chmod 600 /root/.ssh/config`,
      ].join(" && "), 5000);

      const pubKey = genResult.output?.trim() || "";
      return {
        success: true,
        message: `Deploy key generated. Add this public key to GitHub repo Settings > Deploy Keys:\n\n${pubKey}`,
      };
    },
  };
}
