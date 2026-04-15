import { Router, Request, Response } from "express";
  import { db } from "../../db";
  import { sql } from "drizzle-orm";
  import { getProjectRepo, withRepoToken } from "./opsHelpers";
  import { logDevmaxActivity, sendDevmaxNotification, checkPlanLimits } from "./devmaxMiddleware";
  import { githubService, withGitHubToken } from "../../services/githubService";
  
  const router = Router();

  router.get("/ssl-status", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;

    const { sshService } = await import("../../services/sshService");
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
    const { sshService } = await import("../../services/sshService");
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
    const { cloudflareService } = await import("../../services/cloudflareService");
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
    const { cloudflareService } = await import("../../services/cloudflareService");
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
    const { cloudflareService } = await import("../../services/cloudflareService");
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
    const { cloudflareService } = await import("../../services/cloudflareService");
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
      const { sshService } = await import("../../services/sshService");
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
      const { sshService } = await import("../../services/sshService");
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
    const { sshService } = await import("../../services/sshService");
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


  export default router;
  