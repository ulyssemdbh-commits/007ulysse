import type { SSHService } from "./core";
import { sslCertForDomain, staticNginxBlock, proxyNginxBlock, normalizeNginxName, nginxCleanupCmd } from "./helpers";

export function createNginxMethods(service: SSHService) {
  return {
    async nginxCreate(params: {
      appName: string;
      domain?: string;
      type: "static" | "proxy";
      rootDir?: string;
      port?: number;
      isStaging?: boolean;
    }): Promise<{ success: boolean; config: string; message: string }> {
      const { appName, type, isStaging = false } = params;
      const normalized = normalizeNginxName(appName);
      const configName = isStaging ? `${normalized}-dev` : normalized;
      const domain = params.domain || (isStaging ? `${normalized}.dev.ulyssepro.org` : `${normalized}.ulyssepro.org`);

      let nginxConf: string;
      if (type === "static") {
        const rootDir = params.rootDir || `/var/www/apps/${isStaging ? `${appName}-dev` : appName}/dist`;
        nginxConf = staticNginxBlock(domain, rootDir, configName);
      } else {
        if (!params.port) return { success: false, config: "", message: "port requis pour un proxy Nginx" };
        nginxConf = proxyNginxBlock(domain, configName, params.port);
      }

      await service.executeCommand(nginxCleanupCmd(configName), 5000).catch(() => {});
      await service.writeRemoteFile(`/etc/nginx/sites-available/${configName}`, nginxConf);
      const result = await service.executeCommand(
        `ln -sf /etc/nginx/sites-available/${configName} /etc/nginx/sites-enabled/${configName} && nginx -t 2>&1 && systemctl reload nginx && echo "NGINX_CREATE_OK"`,
        15000
      );
      if (result.output?.includes("NGINX_CREATE_OK")) {
        return { success: true, config: configName, message: `Nginx config ${configName} created for ${domain} (${type}${type === "proxy" ? ` → port ${params.port}` : ` → ${params.rootDir || "dist/"}`})` };
      }
      await service.executeCommand(`rm -f /etc/nginx/sites-enabled/${configName}`, 5000);
      return { success: false, config: configName, message: `Nginx test failed: ${result.error || result.output}` };
    },

    async nginxDelete(configName: string): Promise<{ success: boolean; message: string }> {
      const normalized = normalizeNginxName(configName);
      await service.executeCommand(nginxCleanupCmd(configName), 5000);
      await service.executeCommand(`rm -f /etc/nginx/sites-enabled/${normalized} /etc/nginx/sites-available/${normalized}`, 5000);
      const result = await service.executeCommand(`nginx -t 2>&1 && systemctl reload nginx && echo "NGINX_DEL_OK"`, 10000);
      return {
        success: result.output?.includes("NGINX_DEL_OK") || false,
        message: result.output?.includes("NGINX_DEL_OK")
          ? `Nginx config ${normalized} deleted and reloaded`
          : `Deleted config but reload issue: ${result.error || result.output}`
      };
    },

    async nginxShow(configName: string): Promise<{ success: boolean; config: string; domain: string }> {
      const normalized = normalizeNginxName(configName);
      const result = await service.executeCommand(
        `cat /etc/nginx/sites-available/${normalized} 2>/dev/null || cat /etc/nginx/sites-available/${configName} 2>/dev/null || echo "NOT_FOUND"`,
        5000
      );
      const content = result.output?.trim() || "NOT_FOUND";
      const domainMatch = content.match(/server_name\s+([^;]+)/);
      return {
        success: content !== "NOT_FOUND",
        config: content,
        domain: domainMatch ? domainMatch[1].trim() : ""
      };
    },

    async nginxTest(): Promise<{ success: boolean; output: string }> {
      const result = await service.executeCommand(`nginx -t 2>&1`, 10000);
      return {
        success: result.output?.includes("successful") || false,
        output: result.output || result.error || ""
      };
    },

    async nginxReload(): Promise<{ success: boolean; output: string }> {
      const testResult = await service.executeCommand(`nginx -t 2>&1`, 10000);
      if (!testResult.output?.includes("successful")) {
        return { success: false, output: `Config test failed: ${testResult.output || testResult.error}` };
      }
      const result = await service.executeCommand(`systemctl reload nginx && echo "RELOAD_OK"`, 10000);
      return {
        success: result.output?.includes("RELOAD_OK") || false,
        output: result.output?.includes("RELOAD_OK") ? "Nginx reloaded successfully" : `Reload failed: ${result.error || result.output}`
      };
    },

    async nginxLogs(configName: string, lines: number = 50, logType: "access" | "error" | "both" = "both"): Promise<{ success: boolean; access?: string; error?: string }> {
      const normalized = normalizeNginxName(configName);
      const result: any = { success: true };
      if (logType === "access" || logType === "both") {
        const r = await service.executeCommand(`tail -n ${lines} /var/log/nginx/${normalized}.access.log 2>/dev/null || echo "No access log"`, 10000);
        result.access = r.output || "";
      }
      if (logType === "error" || logType === "both") {
        const r = await service.executeCommand(`tail -n ${lines} /var/log/nginx/${normalized}.error.log 2>/dev/null || echo "No error log"`, 10000);
        result.error = r.output || "";
      }
      return result;
    },

    async sslStatus(domain?: string): Promise<{ success: boolean; certs: any[] }> {
      const cmd = domain
        ? `echo | openssl s_client -connect 127.0.0.1:443 -servername ${domain} 2>/dev/null | openssl x509 -noout -subject -issuer -enddate -startdate 2>/dev/null || echo "SSL_ERROR"`
        : `ls -la /etc/ssl/certs/ulysse.crt /etc/ssl/private/ulysse.key 2>/dev/null; echo "---"; for d in $(grep -rhoP 'server_name \\K[^;]+' /etc/nginx/sites-enabled/ 2>/dev/null | tr ' ' '\\n' | grep -v '_' | sort -u | head -20); do echo -n "$d: "; echo | openssl s_client -connect 127.0.0.1:443 -servername $d 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null || echo "NO_SSL"; done`;
      const result = await service.executeCommand(cmd, 30000);
      return { success: true, certs: [{ output: result.output }] };
    },

    async sslRenew(domain?: string): Promise<{ success: boolean; output: string }> {
      const cmd = domain
        ? `certbot renew --cert-name ${domain} --force-renewal 2>&1 | tail -20`
        : `certbot renew 2>&1 | tail -20`;
      const result = await service.executeCommand(cmd, 60000);
      return {
        success: !result.error,
        output: result.output || result.error || ""
      };
    },

    async setupDefaultCatchall(): Promise<{ success: boolean; message: string }> {
      const catchallConf = `server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    return 301 https://\\$host\\$request_uri;
}

server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name _;

    ssl_certificate /etc/ssl/certs/ulysse.crt;
    ssl_certificate_key /etc/ssl/private/ulysse.key;

    location / {
        default_type text/html;
        return 404 '<!DOCTYPE html><html><head><title>404 - Not Found</title><style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#0a0a0a;color:#fff}div{text-align:center}h1{font-size:3rem;margin-bottom:0.5rem;color:#ef4444}p{color:#888;font-size:1.1rem}</style></head><body><div><h1>404</h1><p>No application configured for this domain.</p><p style="font-size:0.85rem;margin-top:2rem;color:#555">Ulysse DevOps — ulyssepro.org</p></div></body></html>';
    }
}`;
      await service.writeRemoteFile("/etc/nginx/sites-available/000-catchall", catchallConf);
      const result = await service.executeCommand(
        `ln -sf /etc/nginx/sites-available/000-catchall /etc/nginx/sites-enabled/000-catchall && rm -f /etc/nginx/sites-enabled/default && nginx -t 2>&1 && systemctl reload nginx && echo "CATCHALL_OK"`,
        15000
      );
      return {
        success: result.output?.includes("CATCHALL_OK") || false,
        message: result.output?.includes("CATCHALL_OK")
          ? "Default catchall installed — unmatched domains now show 404 instead of routing to wrong app"
          : `Catchall setup failed: ${result.error || result.output}`
      };
    },

    async auditNginxConfigs(): Promise<{
      success: boolean;
      total: number;
      missing: string[];
      fixed: string[];
      errors: string[];
      report: string;
    }> {
      const pm2Result = await service.executeCommand(
        `pm2 jlist 2>/dev/null || echo "[]"`,
        10000
      );
      let pm2Apps: any[] = [];
      try { pm2Apps = JSON.parse(pm2Result.output || "[]"); } catch { pm2Apps = []; }

      const nginxListResult = await service.executeCommand(
        `ls /etc/nginx/sites-enabled/ 2>/dev/null`,
        5000
      );
      const existingConfigs = new Set(
        (nginxListResult.output || "").split("\n").map(s => s.trim()).filter(Boolean)
      );

      const missing: string[] = [];
      const fixed: string[] = [];
      const errors: string[] = [];

      for (const app of pm2Apps) {
        const name = app.name;
        if (!name || name === "ulysse") continue;

        if (!existingConfigs.has(name)) {
          missing.push(name);

          const port = app.pm2_env?.env?.PORT || app.pm2_env?.PORT;
          if (!port) {
            errors.push(`${name}: no PORT found in PM2 env, cannot auto-fix`);
            continue;
          }

          const isStaging = name.endsWith("-dev") || name.endsWith("-staging");
          const baseName = isStaging ? name.replace(/-(dev|staging)$/, "") : name;
          const domain = isStaging
            ? `${baseName}.dev.ulyssepro.org`
            : `${baseName}.ulyssepro.org`;

          const nginxConf = proxyNginxBlock(domain, name, parseInt(port));

          await service.writeRemoteFile(`/etc/nginx/sites-available/${name}`, nginxConf);
          const linkResult = await service.executeCommand(
            `ln -sf /etc/nginx/sites-available/${name} /etc/nginx/sites-enabled/${name}`,
            5000
          );
          if (linkResult.success) {
            fixed.push(`${name} → ${domain} (port ${port})`);
          } else {
            errors.push(`${name}: failed to create symlink — ${linkResult.error}`);
          }
        }
      }

      const duplicates: string[] = [];
      const configNames = Array.from(existingConfigs);
      const lowerMap = new Map<string, string[]>();
      for (const c of configNames) {
        const lower = c.toLowerCase();
        if (!lowerMap.has(lower)) lowerMap.set(lower, []);
        lowerMap.get(lower)!.push(c);
      }
      for (const entry of Array.from(lowerMap.entries())) {
        const [lower, variants] = entry;
        if (variants.length > 1) {
          duplicates.push(`${lower}: [${variants.join(", ")}]`);
          const normalized = normalizeNginxName(lower);
          const toRemove = variants.filter(v => v !== normalized);
          for (const dup of toRemove) {
            await service.executeCommand(`rm -f /etc/nginx/sites-enabled/${dup} /etc/nginx/sites-available/${dup}`, 5000);
            fixed.push(`Removed duplicate config: ${dup} (kept: ${normalized})`);
          }
        }
      }

      const orphans: string[] = [];
      const pm2Names = new Set(pm2Apps.map((a: any) => a.name?.toLowerCase()).filter(Boolean));
      pm2Names.add("ulysse");
      const skipConfigs = new Set(["000-catchall", "default", "ulyssepro.org", "ulyssepro"]);
      for (const conf of configNames) {
        if (skipConfigs.has(conf) || conf.endsWith("-placeholder")) continue;
        const baseName = conf.replace(/-dev$/, "").replace(/-staging$/, "").toLowerCase();
        const appDirExists = await service.executeCommand(`[ -d "/var/www/apps/${conf}" ] || [ -d "/var/www/apps/${baseName}" ] && echo "Y" || echo "N"`, 5000);
        const hasPm2 = pm2Names.has(conf.toLowerCase()) || pm2Names.has(baseName);
        if (appDirExists.output?.trim() !== "Y" && !hasPm2) {
          orphans.push(conf);
        }
      }

      if (fixed.length > 0 || duplicates.length > 0) {
        const testResult = await service.executeCommand(`nginx -t 2>&1`, 10000);
        if (testResult.output?.includes("successful")) {
          const reloadResult = await service.executeCommand(`systemctl reload nginx 2>&1 && echo "RELOAD_OK" || echo "RELOAD_FAILED"`, 10000);
          if (!reloadResult.output?.includes("RELOAD_OK")) {
            errors.push(`Nginx reload failed: ${reloadResult.output || reloadResult.error}`);
          }
        } else {
          errors.push(`Nginx test failed after fixes: ${testResult.output}`);
        }
      }

      const report = [
        `=== Nginx Audit Report ===`,
        `PM2 apps: ${pm2Apps.length}`,
        `Existing Nginx configs: ${existingConfigs.size}`,
        `Missing configs: ${missing.length}`,
        `Duplicate configs: ${duplicates.length}`,
        `Orphan configs: ${orphans.length}`,
        `Auto-fixed: ${fixed.length}`,
        `Errors: ${errors.length}`,
        ...(fixed.length > 0 ? [`\nFixed:`, ...fixed.map(f => `  ✓ ${f}`)] : []),
        ...(duplicates.length > 0 ? [`\nDuplicates detected:`, ...duplicates.map(d => `  ⚠ ${d}`)] : []),
        ...(orphans.length > 0 ? [`\nOrphan configs (no app/PM2):`, ...orphans.map(o => `  ⚠ ${o}`)] : []),
        ...(errors.length > 0 ? [`\nErrors:`, ...errors.map(e => `  ✗ ${e}`)] : []),
        ...(missing.length === 0 && errors.length === 0 && duplicates.length === 0 ? ["\nAll apps have valid Nginx configs — clean state."] : []),
      ].join("\n");

      return { success: errors.length === 0, total: pm2Apps.length, missing, fixed, errors, report };
    },

    async diagnoseAndFixUrl(params: {
      domain: string;
      appName: string;
      autoFix?: boolean;
      repoUrl?: string;
      caller?: "max" | "ulysse" | "iris";
    }): Promise<{
      success: boolean;
      domain: string;
      httpCode: string;
      issues: string[];
      fixes: string[];
      finalStatus: string;
    }> {
      const { domain, appName, autoFix = true, caller = "max" } = params;
      const issues: string[] = [];
      const fixes: string[] = [];
      const appDir = `/var/www/apps/${appName}`;
      const stagingDir = `/var/www/apps/${appName}-dev`;
      const legacyStagingDir = `/var/www/apps/${appName}-staging`;
      const isStaging = domain.includes("-dev.") || domain.includes(".test.");
      let targetDir = isStaging ? stagingDir : appDir;
      if (isStaging) {
        const checkNew = await service.executeCommand(`[ -d "${stagingDir}" ] && echo "Y" || echo "N"`, 5000);
        if (checkNew.output?.trim() !== "Y") {
          const checkLegacy = await service.executeCommand(`[ -d "${legacyStagingDir}" ] && echo "Y" || echo "N"`, 5000);
          if (checkLegacy.output?.trim() === "Y") targetDir = legacyStagingDir;
        }
      }

      const placeholderCheck = await service.executeCommand(
        `grep -rl "${domain}" /etc/nginx/sites-enabled/ 2>/dev/null | xargs grep -l placeholder 2>/dev/null | head -1`, 5000
      );
      const hasPlaceholder = !!(placeholderCheck.output?.trim());

      const dirCheck = await service.executeCommand(`test -d ${targetDir} && test -f ${targetDir}/package.json && echo "HAS_CODE" || (test -d ${targetDir} && echo "DIR_ONLY" || echo "MISSING")`, 5000);
      const dirStatus = dirCheck.output?.trim();

      if (dirStatus === "MISSING" || dirStatus === "DIR_ONLY") {
        if (hasPlaceholder) {
          issues.push(`App not yet deployed — placeholder page is active for ${domain}`);
          const httpCode = (await service.executeCommand(`curl -s -o /dev/null -w "%{http_code}" --max-time 8 -H "Host: ${domain}" https://127.0.0.1/ -k 2>/dev/null || echo "000"`, 12000)).output?.trim() || "000";
          return { success: httpCode === "200", domain, httpCode, issues, fixes, finalStatus: httpCode === "200" ? "Placeholder active" : "Placeholder error" };
        }
        issues.push(`App directory ${targetDir} does not exist`);
        if (autoFix && params.repoUrl) {
          const cloneResult = await service.authenticatedGitClone({ repoUrl: params.repoUrl, branch: "main", appDir: targetDir });
          if (cloneResult.success) fixes.push(`Cloned repo to ${targetDir}`);
          else {
            fixes.push(`Deploying placeholder page for ${domain}`);
            await service.deployPlaceholderPages(appName, appName);
            const httpCode = (await service.executeCommand(`curl -s -o /dev/null -w "%{http_code}" --max-time 8 -H "Host: ${domain}" https://127.0.0.1/ -k 2>/dev/null || echo "000"`, 12000)).output?.trim() || "000";
            return { success: httpCode === "200", domain, httpCode, issues, fixes, finalStatus: "Placeholder deployed" };
          }
        } else if (autoFix) {
          fixes.push(`Deploying placeholder page for ${domain}`);
          await service.deployPlaceholderPages(appName, appName);
          const httpCode = (await service.executeCommand(`curl -s -o /dev/null -w "%{http_code}" --max-time 8 -H "Host: ${domain}" https://127.0.0.1/ -k 2>/dev/null || echo "000"`, 12000)).output?.trim() || "000";
          return { success: httpCode === "200", domain, httpCode, issues, fixes, finalStatus: "Placeholder deployed" };
        }
      }

      const nginxCheck = await service.executeCommand(
        `grep -rl "${domain}" /etc/nginx/sites-enabled/ 2>/dev/null | head -1`, 5000
      );
      const hasNginxConfig = !!(nginxCheck.output?.trim());
      if (!hasNginxConfig) {
        issues.push(`No Nginx config found for ${domain}`);
        if (autoFix) {
          const projectType = await service.detectProjectType(targetDir);
          if (projectType === "static" || projectType === "spa-build") {
            let serveRoot = targetDir;
            const distCheck = await service.executeCommand(`[ -d "${targetDir}/dist" ] && echo "dist" || ([ -d "${targetDir}/build" ] && echo "build" || echo "root")`, 5000);
            const bd = distCheck.output?.trim();
            if (bd === "dist") serveRoot = `${targetDir}/dist`;
            else if (bd === "build") serveRoot = `${targetDir}/build`;
            const nginxFileName = normalizeNginxName(`${appName}${isStaging ? "-dev" : ""}`);
            const nginxConf = staticNginxBlock(domain, serveRoot, nginxFileName);
            await service.executeCommand(nginxCleanupCmd(appName), 5000).catch(() => {});
            await service.writeRemoteFile(`/etc/nginx/sites-available/${nginxFileName}`, nginxConf);
            const linkResult = await service.executeCommand(
              `ln -sf /etc/nginx/sites-available/${nginxFileName} /etc/nginx/sites-enabled/${nginxFileName} && nginx -t 2>&1 && systemctl reload nginx && echo "OK"`, 15000
            );
            if (linkResult.output?.includes("OK")) {
              fixes.push(`Created static Nginx config for ${domain} (config: ${nginxFileName})`);
            } else {
              await service.executeCommand(`rm -f /etc/nginx/sites-enabled/${nginxFileName}`, 5000);
              issues.push(`Nginx config creation failed (symlink cleaned up): ${linkResult.error}`);
            }
          } else {
            const portCheck = await service.executeCommand(
              `grep -oP 'proxy_pass http://127\\.0\\.0\\.1:\\K[0-9]+' /etc/nginx/sites-available/${normalizeNginxName(appName)}* /etc/nginx/sites-available/${appName}* 2>/dev/null || ` +
              `grep -oP 'PORT=\\K[0-9]+' ${targetDir}/.env 2>/dev/null || echo ""`, 5000
            );
            let appPort = parseInt(portCheck.output?.trim() || "0", 10);
            if (!appPort || appPort < 3000) {
              try {
                const { db } = await import("../../db");
                const { sql } = await import("drizzle-orm");
                const dbPorts = await db.execute(sql`SELECT staging_port, production_port FROM devmax_projects WHERE deploy_slug = ${appName} LIMIT 1`).then((r: any) => r.rows?.[0] || null).catch(() => null);
                if (dbPorts) {
                  appPort = isStaging ? dbPorts.staging_port : dbPorts.production_port;
                }
              } catch {}
              if (!appPort || appPort < 3000) {
                issues.push(`Impossible de déterminer le port de ${appName}. Aucune source fiable (Nginx, .env, DB). Ne pas deviner un port aléatoire.`);
                return { success: false, domain, httpCode: "000", issues, fixes, finalStatus: "Cannot determine port" };
              }
            }
            const nginxDynName = normalizeNginxName(`${appName}${isStaging ? "-dev" : ""}`);
            const nginxConf = proxyNginxBlock(domain, appName, appPort);
            await service.executeCommand(nginxCleanupCmd(appName), 5000).catch(() => {});
            await service.writeRemoteFile(`/etc/nginx/sites-available/${nginxDynName}`, nginxConf);
            const linkResult = await service.executeCommand(
              `ln -sf /etc/nginx/sites-available/${nginxDynName} /etc/nginx/sites-enabled/${nginxDynName} && nginx -t 2>&1 && systemctl reload nginx && echo "OK"`, 15000
            );
            if (linkResult.output?.includes("OK")) {
              fixes.push(`Created dynamic Nginx config for ${domain} → port ${appPort} (config: ${nginxDynName})`);
            } else {
              await service.executeCommand(`rm -f /etc/nginx/sites-enabled/${nginxDynName}`, 5000);
              issues.push(`Nginx config creation failed (symlink cleaned up): ${linkResult.error}`);
            }
          }
        }
      }

      const httpCheck = await service.executeCommand(
        `curl -s -o /dev/null -w "%{http_code}" --max-time 8 -H "Host: ${domain}" https://127.0.0.1/ -k 2>/dev/null || echo "000"`, 12000
      );
      let httpCode = httpCheck.output?.trim() || "000";

      if (httpCode === "502" && autoFix) {
        issues.push("502 Bad Gateway — app process likely down");
        const pm2Check = await service.executeCommand(
          `pm2 list --no-color 2>/dev/null | grep -i "${appName}" || echo "NOT_FOUND"`, 10000
        );
        if (pm2Check.output?.includes("NOT_FOUND") || pm2Check.output?.includes("errored") || pm2Check.output?.includes("stopped")) {
          const restartResult = await service.executeCommand(
            `cd ${targetDir} && pm2 restart ${appName} 2>/dev/null || ` +
            `(pm2 start ecosystem.config.cjs --only ${appName} 2>/dev/null || ` +
            `pm2 start npm --name "${appName}" -- start 2>/dev/null) && echo "PM2_OK"`, 30000
          );
          if (restartResult.output?.includes("PM2_OK")) {
            fixes.push("Restarted app process via PM2");
            await new Promise(r => setTimeout(r, 3000));
            const recheck = await service.executeCommand(
              `curl -s -o /dev/null -w "%{http_code}" --max-time 8 -H "Host: ${domain}" https://127.0.0.1/ -k 2>/dev/null || echo "000"`, 12000
            );
            httpCode = recheck.output?.trim() || "000";
          } else {
            issues.push(`PM2 restart failed: ${restartResult.error || restartResult.output}`);
          }
        }

        if (httpCode === "502") {
          const portFromNginx = await service.executeCommand(
            `grep -oP 'proxy_pass http://127\\.0\\.0\\.1:\\K[0-9]+' /etc/nginx/sites-available/${appName}* 2>/dev/null | head -1`, 5000
          );
          const configuredPort = parseInt(portFromNginx.output?.trim() || "0", 10);
          if (configuredPort) {
            const portInUse = await service.executeCommand(`ss -tlnp | grep ":${configuredPort} " || echo "PORT_FREE"`, 5000);
            if (portInUse.output?.includes("PORT_FREE")) {
              issues.push(`Port ${configuredPort} is not listening — app may have crashed`);
              await service.executeCommand(`cd ${targetDir} && npm install --production 2>&1 | tail -3`, 60000);
              await service.executeCommand(`cd ${targetDir} && npm run build 2>&1 | tail -5`, 60000);
              const startResult = await service.executeCommand(
                `cd ${targetDir} && PORT=${configuredPort} pm2 start npm --name "${appName}" -- start 2>&1 && echo "STARTED"`, 30000
              );
              if (startResult.output?.includes("STARTED")) {
                fixes.push(`Rebuilt and restarted app on port ${configuredPort}`);
                await new Promise(r => setTimeout(r, 3000));
                const recheck2 = await service.executeCommand(
                  `curl -s -o /dev/null -w "%{http_code}" --max-time 8 -H "Host: ${domain}" https://127.0.0.1/ -k 2>/dev/null || echo "000"`, 12000
                );
                httpCode = recheck2.output?.trim() || "000";
              }
            }
          }
        }
      }

      if (httpCode === "404" && autoFix) {
        issues.push("404 Not Found — may be missing root or index file");
        const indexCheck = await service.executeCommand(
          `test -f ${targetDir}/dist/index.html && echo "HAS_DIST_INDEX" || (test -f ${targetDir}/index.html && echo "HAS_INDEX" || (test -d ${targetDir}/dist && echo "HAS_DIST" || (test -d ${targetDir}/public && echo "HAS_PUBLIC" || echo "NO_INDEX")))`, 5000
        );
        const output = indexCheck.output?.trim() || "";

        if (output === "NO_INDEX" || output === "HAS_INDEX") {
          const hasPkg = await service.executeCommand(`test -f ${targetDir}/package.json && echo "Y" || echo "N"`, 5000);
          if (hasPkg.output?.trim() === "Y") {
            const hasVite = await service.executeCommand(`test -f ${targetDir}/vite.config.ts -o -f ${targetDir}/vite.config.js && echo "Y" || echo "N"`, 5000);
            if (hasVite.output?.trim() === "Y") {
              issues.push("Source files present but no build output — attempting build");
              await service.executeCommand(`cd ${targetDir} && npm install --production=false --no-audit --no-fund 2>&1 | tail -3`, 120000);
              const buildResult = await service.executeCommand(`cd ${targetDir} && npm run build 2>&1 || npx vite build 2>&1`, 120000);
              if (buildResult.success) {
                fixes.push("Built app (npm run build / vite build)");
              }
            }
          }
        }

        const recheckDist = await service.executeCommand(
          `test -d ${targetDir}/dist && echo "HAS_DIST" || (test -d ${targetDir}/build && echo "HAS_BUILD" || (test -d ${targetDir}/public && echo "HAS_PUBLIC" || echo "NO_OUTPUT"))`, 5000
        );
        const distOut = recheckDist.output?.trim() || "";
        if (distOut === "HAS_DIST" || distOut === "HAS_BUILD" || distOut === "HAS_PUBLIC") {
          const actualRoot = distOut === "HAS_DIST" ? `${targetDir}/dist` : distOut === "HAS_BUILD" ? `${targetDir}/build` : `${targetDir}/public`;
          const nginxFixName = normalizeNginxName(`${appName}${isStaging ? "-dev" : ""}`);
          const currentConf = await service.executeCommand(`cat /etc/nginx/sites-available/${nginxFixName} 2>/dev/null || cat /etc/nginx/sites-available/${appName}${isStaging ? "-staging" : ""} 2>/dev/null || cat /etc/nginx/sites-available/${appName} 2>/dev/null`, 5000);
          if (currentConf.output && !currentConf.output.includes(`root ${actualRoot};`)) {
            const fixedConf = currentConf.output.replace(/root\s+\/var\/www\/apps\/[^;]*;/g, `root ${actualRoot};`);
            await service.executeCommand(nginxCleanupCmd(appName), 5000).catch(() => {});
            await service.writeRemoteFile(`/etc/nginx/sites-available/${nginxFixName}`, fixedConf);
            await service.executeCommand(`ln -sf /etc/nginx/sites-available/${nginxFixName} /etc/nginx/sites-enabled/${nginxFixName} && nginx -t 2>&1 && systemctl reload nginx`, 10000);
            fixes.push(`Updated Nginx root to ${actualRoot} (config: ${nginxFixName})`);
            const recheck3 = await service.executeCommand(
              `curl -s -o /dev/null -w "%{http_code}" --max-time 8 -H "Host: ${domain}" https://127.0.0.1/ -k 2>/dev/null || echo "000"`, 12000
            );
            httpCode = recheck3.output?.trim() || "000";
          }
        }
      }

      if ((httpCode === "000" || httpCode === "503") && autoFix) {
        issues.push(`HTTP ${httpCode} — Nginx may need reload`);
        const nginxReload = await service.executeCommand(`nginx -t 2>&1 && systemctl reload nginx && echo "RELOADED"`, 10000);
        if (nginxReload.output?.includes("RELOADED")) {
          fixes.push("Reloaded Nginx");
          await new Promise(r => setTimeout(r, 2000));
          const recheck4 = await service.executeCommand(
            `curl -s -o /dev/null -w "%{http_code}" --max-time 8 -H "Host: ${domain}" https://127.0.0.1/ -k 2>/dev/null || echo "000"`, 12000
          );
          httpCode = recheck4.output?.trim() || "000";
        }
      }

      const sslCheck = await service.executeCommand(
        `echo | openssl s_client -connect 127.0.0.1:443 -servername ${domain} 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null || echo "SSL_FAIL"`, 10000
      );
      if (sslCheck.output?.includes("SSL_FAIL")) {
        issues.push("SSL certificate issue");
      }

      const isOk = ["200", "301", "302", "304"].includes(httpCode);
      return {
        success: isOk,
        domain,
        httpCode,
        issues,
        fixes,
        finalStatus: isOk
          ? `OK (HTTP ${httpCode})`
          : `DEGRADED (HTTP ${httpCode}) — ${issues.length} issue(s)${fixes.length > 0 ? `, ${fixes.length} fix(es) applied` : ""}`,
      };
    },
  };
}
