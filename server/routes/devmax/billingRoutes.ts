import { Router, Request, Response } from "express";
  import { db } from "../../db";
  import { sql } from "drizzle-orm";
  import { getProjectRepo, withRepoToken } from "./opsHelpers";
  import { logDevmaxActivity, sendDevmaxNotification } from "./devmaxMiddleware";
  
  import { checkPlanLimits } from "./devmaxMiddleware";

  const router = Router();

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
    const { devmaxStripeService } = await import("../../services/devmaxStripeService");
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
    const { devmaxStripeService } = await import("../../services/devmaxStripeService");
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
    const { devmaxStripeService } = await import("../../services/devmaxStripeService");
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
    const { devmaxStripeService } = await import("../../services/devmaxStripeService");
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

    const { sshService } = await import("../../services/sshService");
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

    const { sshService } = await import("../../services/sshService");
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

    const { sshService } = await import("../../services/sshService");
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
    const { sshService } = await import("../../services/sshService");
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
    const { sshService } = await import("../../services/sshService");
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
    const { sshService } = await import("../../services/sshService");
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
      const { sshService } = await import("../../services/sshService");
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

    const { metricsService } = await import("../../services/metricsService");
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


  export default router;
  