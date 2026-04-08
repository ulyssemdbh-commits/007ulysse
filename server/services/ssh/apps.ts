import type { SSHService } from "./core";
import { sslCertForDomain } from "./helpers";

export function createAppMethods(service: SSHService) {
  return {
    async getDeployedApps(): Promise<Array<{
      name: string;
      domain: string | null;
      port: number | null;
      ssl: boolean;
      status: string;
      cpu: number;
      memory: string;
      uptime: string | null;
      restarts: number;
      appDir: string;
      type: "node" | "static";
    }>> {
      const [appsResult, nginxResult, dirsResult] = await Promise.all([
        service.executeCommand(`pm2 jlist 2>/dev/null || echo "[]"`, 10000),
        service.executeCommand(
          `for f in /etc/nginx/sites-enabled/*; do [ -f "$f" ] && name=$(basename "$f" .conf) && domain=$(grep -m1 server_name "$f" 2>/dev/null | awk '{print $2}' | tr -d ';') && port=$(grep proxy_pass "$f" 2>/dev/null | head -1 | sed -n 's/.*:\\([0-9][0-9]*\\).*/\\1/p') && hasRoot=$(grep -c 'root ' "$f" 2>/dev/null) && ssl=$(grep -c ssl_certificate "$f" 2>/dev/null) && echo "$name|$domain|$port|$ssl|$hasRoot"; done 2>/dev/null || echo ""`,
          10000
        ),
        service.executeCommand(
          `ls -d /var/www/apps/*/ 2>/dev/null | while read d; do name=$(basename "$d"); echo "$name"; done`,
          5000
        )
      ]);

      let pm2Apps: any[] = [];
      try {
        pm2Apps = JSON.parse(appsResult.success ? appsResult.output : "[]");
      } catch { pm2Apps = []; }

      console.log("[DeployedApps] Nginx scan:", nginxResult.output?.substring(0, 500));
      console.log("[DeployedApps] Dirs:", dirsResult.output?.substring(0, 300));
      console.log("[DeployedApps] PM2 apps:", pm2Apps.map((a: any) => a.name).join(", "));

      const nginxMap = new Map<string, { domain: string; port: number; ssl: boolean; isStatic: boolean }>();
      if (nginxResult.success && nginxResult.output) {
        for (const line of nginxResult.output.split("\n")) {
          const parts = line.trim().split("|");
          if (parts.length >= 4 && parts[0] && parts[0] !== "default") {
            const name = parts[0].replace(/\.conf$/, "");
            nginxMap.set(name, {
              domain: parts[1] || "",
              port: parseInt(parts[2]) || 0,
              ssl: parseInt(parts[3]) > 0,
              isStatic: parseInt(parts[4] || "0") > 0 && !parseInt(parts[2])
            });
          }
        }
      }

      const appDirs = new Set<string>();
      if (dirsResult.success && dirsResult.output) {
        for (const name of dirsResult.output.split("\n")) {
          const n = name.trim();
          if (n) appDirs.add(n);
        }
      }

      const pm2Names = new Set(pm2Apps.map((a: any) => a.name));
      const seenNames = new Set<string>();

      const results: Array<{
        name: string; domain: string | null; port: number | null; ssl: boolean;
        status: string; cpu: number; memory: string; uptime: string | null;
        restarts: number; appDir: string; type: "node" | "static";
      }> = [];

      for (const app of pm2Apps) {
        const nginx = nginxMap.get(app.name);
        const domain = nginx?.domain || (appDirs.has(app.name) ? `${app.name}.ulyssepro.org` : null);
        results.push({
          name: app.name,
          domain,
          port: nginx?.port || (app.pm2_env?.env?.PORT ? parseInt(app.pm2_env.env.PORT) : null),
          ssl: nginx?.ssl || false,
          status: app.pm2_env?.status || "unknown",
          cpu: app.monit?.cpu || 0,
          memory: app.monit?.memory ? Math.round(app.monit.memory / 1024 / 1024) + "MB" : "0MB",
          uptime: app.pm2_env?.pm_uptime ? new Date(app.pm2_env.pm_uptime).toISOString() : null,
          restarts: app.pm2_env?.restart_time || 0,
          appDir: `/var/www/apps/${app.name}`,
          type: "node"
        });
        seenNames.add(app.name);
      }

      for (const [name, nginx] of Array.from(nginxMap.entries())) {
        if (seenNames.has(name)) continue;
        if (nginx.domain?.includes("ulyssepro.org") || appDirs.has(name)) {
          results.push({
            name,
            domain: nginx.domain || `${name}.ulyssepro.org`,
            port: nginx.port || null,
            ssl: nginx.ssl,
            status: nginx.isStatic ? "static" : "stopped",
            cpu: 0,
            memory: "N/A",
            uptime: null,
            restarts: 0,
            appDir: `/var/www/apps/${name}`,
            type: nginx.isStatic ? "static" : "node"
          });
          seenNames.add(name);
        }
      }

      for (const dirName of Array.from(appDirs)) {
        if (seenNames.has(dirName) || dirName === "ulysse") continue;
        const nginx = nginxMap.get(dirName);
        results.push({
          name: dirName,
          domain: nginx?.domain || `${dirName}.ulyssepro.org`,
          port: nginx?.port || null,
          ssl: nginx?.ssl || false,
          status: nginx ? (nginx.isStatic ? "static" : "stopped") : "deployed",
          cpu: 0,
          memory: "N/A",
          uptime: null,
          restarts: 0,
          appDir: `/var/www/apps/${dirName}`,
          type: nginx?.isStatic ? "static" : "node"
        });
        seenNames.add(dirName);
      }

      return results;
    },

    async appLogs(appName: string, lines = 50): Promise<string> {
      const result = await service.executeCommand(
        `pm2 logs ${appName} --nostream --lines ${lines} 2>&1`,
        10000
      );
      return result.success ? result.output : `Error: ${result.error}`;
    },

    async restartApp(appName: string): Promise<string> {
      const result = await service.executeCommand(`pm2 restart ${appName} && pm2 show ${appName} | head -20`, 15000);
      return result.success ? result.output : `Error: ${result.error}`;
    },

    async stopApp(appName: string): Promise<string> {
      const result = await service.executeCommand(`pm2 stop ${appName}`, 10000);
      return result.success ? result.output : `Error: ${result.error}`;
    },

    async deleteApp(appName: string): Promise<string> {
      const PROTECTED_DELETE = ["ulysse", "mdbhdev", "deploy-webhook"];
      if (PROTECTED_DELETE.includes(appName?.toLowerCase()?.trim())) {
        return `BLOCKED: "${appName}" is a protected app and cannot be deleted.`;
      }
      const result = await service.executeCommand(
        `pm2 delete ${appName} 2>/dev/null; rm -f /etc/nginx/sites-enabled/${appName} /etc/nginx/sites-available/${appName}; nginx -t 2>&1 && systemctl reload nginx; rm -rf /var/www/apps/${appName}; echo "App ${appName} deleted"`,
        15000
      );
      return result.success ? result.output : `Error: ${result.error}`;
    },

    async cleanupOrphanedApps(dryRun: boolean = true): Promise<{ orphaned: string[]; deleted: string[]; kept: string[]; errors: string[] }> {
      const PROTECTED_APPS = new Set(["ulysse", "mdbhdev", "deploy-webhook", "devmax", "devops", "000-catchall", "default"]);
      const orphaned: string[] = [];
      const deleted: string[] = [];
      const kept: string[] = [];
      const errors: string[] = [];

      const dirsResult = await service.executeCommand(
        `for d in /var/www/apps/*/; do name=$(basename "$d"); remote=$(cd "$d" && git remote get-url origin 2>/dev/null || echo "NO_GIT"); echo "$name|$remote"; done 2>/dev/null`,
        15000
      );
      if (!dirsResult.success) {
        errors.push(`Failed to list app dirs: ${dirsResult.error}`);
        return { orphaned, deleted, kept, errors };
      }

      const nginxResult = await service.executeCommand(
        `ls /etc/nginx/sites-enabled/ 2>/dev/null | grep -v default`,
        5000
      );
      const nginxConfigs = new Set((nginxResult.output || "").split("\n").filter(Boolean));

      const token = await service.resolveGitHubToken();

      for (const line of (dirsResult.output || "").split("\n").filter(Boolean)) {
        const [appName, remote] = line.split("|");
        if (!appName || PROTECTED_APPS.has(appName)) {
          kept.push(appName);
          continue;
        }

        let isOrphaned = false;

        if (!remote || remote === "NO_GIT") {
          const hasContent = await service.executeCommand(
            `ls /var/www/apps/${appName}/index.html /var/www/apps/${appName}/dist/index.html /var/www/apps/${appName}/package.json 2>/dev/null | head -1`,
            5000
          );
          if (!hasContent.output?.trim()) {
            isOrphaned = true;
          }
        } else if (remote.includes("github.com") && token) {
          const repoMatch = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
          if (repoMatch) {
            try {
              const checkResult = await service.executeCommand(
                `curl -s -o /dev/null -w "%{http_code}" -H "Authorization: token ${token}" "https://api.github.com/repos/${repoMatch[1]}/${repoMatch[2]}" 2>/dev/null`,
                10000
              );
              const httpCode = checkResult.output?.trim();
              if (httpCode === "404") {
                isOrphaned = true;
              }
            } catch {}
          }
        }

        if (appName.endsWith("-placeholder")) {
          isOrphaned = true;
        }

        if (isOrphaned) {
          orphaned.push(appName);
          if (!dryRun) {
            try {
              await service.executeCommand(
                `pm2 delete ${appName} 2>/dev/null; rm -f /etc/nginx/sites-enabled/${appName} /etc/nginx/sites-available/${appName}; rm -rf /var/www/apps/${appName}; echo "Deleted ${appName}"`,
                15000
              );
              for (const suffix of ["", ".conf", `-dev`, `-staging`, `-dev.conf`, `-staging.conf`]) {
                const confName = `${appName}${suffix}`;
                if (nginxConfigs.has(confName)) {
                  await service.executeCommand(`rm -f /etc/nginx/sites-enabled/${confName} /etc/nginx/sites-available/${confName}`, 5000).catch(() => {});
                }
              }
              deleted.push(appName);
            } catch (e: any) {
              errors.push(`${appName}: ${e.message}`);
            }
          }
        } else {
          kept.push(appName);
        }
      }

      if (!dryRun && deleted.length > 0) {
        await service.executeCommand("nginx -t 2>&1 && systemctl reload nginx", 10000).catch(() => {});
        console.log(`[Cleanup] Deleted ${deleted.length} orphaned apps: ${deleted.join(", ")}`);
      }

      return { orphaned, deleted, kept, errors };
    },

    async scaleApp(appName: string, instances: number): Promise<string> {
      const result = await service.executeCommand(`pm2 scale ${appName} ${instances} 2>&1 && pm2 save`, 15000);
      return result.success ? `Scaled ${appName} to ${instances} instances\n${result.output}` : `Error: ${result.error}`;
    },

    async getAppInfo(appName: string): Promise<string> {
      const appDir = appName === "ulysse" ? "/var/www/ulysse" : `/var/www/apps/${appName}`;
      const result = await service.executeCommand(
        `echo "=== APP: ${appName} ===" && echo "DIR: ${appDir}" && ls -la ${appDir} 2>/dev/null | head -10 && echo "=== GIT ===" && cd ${appDir} && git log --oneline -5 2>/dev/null && echo "BRANCH: $(git branch --show-current 2>/dev/null)" && echo "REMOTE: $(git remote get-url origin 2>/dev/null)" && echo "=== PACKAGE ===" && cat ${appDir}/package.json 2>/dev/null | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');try{const p=JSON.parse(d);console.log('Name:',p.name);console.log('Version:',p.version);console.log('Scripts:',Object.keys(p.scripts||{}).join(', '))}catch{}" && echo "=== ENV ===" && wc -l ${appDir}/.env 2>/dev/null | awk '{print $1" vars"}' && echo "=== PM2 ===" && pm2 show ${appName} 2>/dev/null | grep -E "status|restart|uptime|memory|cpu|script" | head -10 && echo "=== NGINX ===" && cat /etc/nginx/sites-enabled/${appName}* 2>/dev/null | grep -E "server_name|proxy_pass|root|listen" | head -5`,
        15000
      );
      return result.success ? result.output : `Error: ${result.error}`;
    },

    async manageEnv(appName: string, action: "get" | "set" | "delete", vars?: Record<string, string>): Promise<string> {
      const appDir = appName === "ulysse" ? "/var/www/ulysse" : `/var/www/apps/${appName}`;

      if (action === "get") {
        const result = await service.executeCommand(`cat ${appDir}/.env 2>/dev/null || echo "NO_ENV_FILE"`, 5000);
        if (!result.success || result.output.trim() === "NO_ENV_FILE") {
          return JSON.stringify({ appName, env: {}, message: "No .env file found" });
        }
        const env: Record<string, string> = {};
        for (const line of result.output.split("\n")) {
          const match = line.match(/^([^#=]+)=(.*)$/);
          if (match) {
            const val = match[2].trim();
            env[match[1].trim()] = val.includes("password") || val.includes("secret") || match[1].includes("PASSWORD") || match[1].includes("SECRET") || match[1].includes("KEY")
              ? "***REDACTED***" : val;
          }
        }
        return JSON.stringify({ appName, env });
      }

      if (action === "set" && vars) {
        const existingResult = await service.executeCommand(`cat ${appDir}/.env 2>/dev/null || echo ""`, 5000);
        const existingLines = existingResult.success ? existingResult.output.split("\n").filter(l => l.trim()) : [];
        const existingEnv: Record<string, string> = {};
        for (const line of existingLines) {
          const match = line.match(/^([^#=]+)=(.*)$/);
          if (match) existingEnv[match[1].trim()] = match[2].trim();
        }
        Object.assign(existingEnv, vars);
        const newContent = Object.entries(existingEnv).map(([k, v]) => `${k}=${v}`).join("\n");
        const writeResult = await service.executeCommand(`echo '${newContent.replace(/'/g, "'\\''")}' > ${appDir}/.env`, 5000);
        if (!writeResult.success) return JSON.stringify({ error: writeResult.error });
        return JSON.stringify({ success: true, appName, message: `${Object.keys(vars).length} variable(s) updated`, updatedKeys: Object.keys(vars) });
      }

      if (action === "delete" && vars) {
        const keysToDelete = Object.keys(vars);
        const existingResult = await service.executeCommand(`cat ${appDir}/.env 2>/dev/null || echo ""`, 5000);
        const lines = existingResult.success ? existingResult.output.split("\n").filter(l => {
          const match = l.match(/^([^#=]+)=/);
          return match ? !keysToDelete.includes(match[1].trim()) : true;
        }) : [];
        const newContent = lines.join("\n");
        await service.executeCommand(`echo '${newContent.replace(/'/g, "'\\''")}' > ${appDir}/.env`, 5000);
        return JSON.stringify({ success: true, appName, message: `${keysToDelete.length} variable(s) deleted`, deletedKeys: keysToDelete });
      }

      return JSON.stringify({ error: "Invalid env action" });
    },

    async getNginxConfigs(): Promise<string> {
      const result = await service.executeCommand(
        `for f in /etc/nginx/sites-enabled/*; do [ -f "$f" ] && echo "---FILE: $(basename "$f")---" && cat "$f" && echo ""; done 2>/dev/null`,
        10000
      );
      if (!result.success) return JSON.stringify({ error: result.error });
      const configs: Record<string, string> = {};
      const parts = result.output.split(/---FILE: (.+?)---/).filter(Boolean);
      for (let i = 0; i < parts.length; i += 2) {
        if (parts[i] && parts[i + 1]) configs[parts[i].trim()] = parts[i + 1].trim();
      }
      return JSON.stringify({ configs });
    },
  };
}
