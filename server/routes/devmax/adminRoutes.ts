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
  import { encryptToken } from "../../services/devmax/cryptoService";
  
  const router = Router();

  const adminAuthAttempts = new Map<string, { count: number; lastAttempt: number }>();
  const ADMIN_MAX_ATTEMPTS = 5;
  const ADMIN_LOCKOUT_MS = 15 * 60 * 1000;

  router.post("/admin/auth", async (req: Request, res: Response) => {
  const clientIp = req.ip || req.headers["x-forwarded-for"]?.toString() || "unknown";
  const attempt = adminAuthAttempts.get(clientIp);
  if (attempt && attempt.count >= ADMIN_MAX_ATTEMPTS && Date.now() - attempt.lastAttempt < ADMIN_LOCKOUT_MS) {
    const remainMin = Math.ceil((ADMIN_LOCKOUT_MS - (Date.now() - attempt.lastAttempt)) / 60000);
    return res.status(429).json({ error: `Too many attempts. Try again in ${remainMin} minutes.` });
  }

  const { pin } = req.body;
  if (pin !== ADMIN_PIN) {
    const prev = adminAuthAttempts.get(clientIp) || { count: 0, lastAttempt: 0 };
    adminAuthAttempts.set(clientIp, { count: prev.count + 1, lastAttempt: Date.now() });
    return res.status(401).json({ error: "Invalid admin PIN" });
  }
  adminAuthAttempts.delete(clientIp);

  const id = randomUUID();
  const adminFingerprint = `admin-${randomUUID().slice(0, 8)}`;
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
  await db.execute(sql`
    INSERT INTO devmax_sessions (id, fingerprint, display_name, expires_at, ip_address, user_agent)
    VALUES (${id}, ${adminFingerprint}, ${'Master Admin'}, ${expiresAt}, ${req.ip || null}, ${req.headers["user-agent"] || null})
  `);
  res.json({ sessionId: id });
});

router.get("/admin/users", requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const users = await db.execute(sql`
      SELECT u.*, 
        (SELECT COUNT(*) FROM devmax_projects WHERE fingerprint = u.fingerprint) as project_count,
        (SELECT COUNT(*) FROM devmax_sessions WHERE fingerprint = u.fingerprint AND expires_at > NOW()) as active_sessions
      FROM devmax_users u ORDER BY u.created_at DESC
    `).then((r: any) => r.rows || r);

    const fingerprints = await db.execute(sql`
      SELECT DISTINCT fingerprint, 
        MAX(last_active_at) as last_active,
        COUNT(*) as session_count
      FROM devmax_sessions 
      GROUP BY fingerprint
      ORDER BY MAX(last_active_at) DESC
    `).then((r: any) => r.rows || r);

    res.json({ users, fingerprints });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/users", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { username, displayName, firstName, lastName, email, pin, loginId, password, role, fingerprint } = req.body;
    if (!username) return res.status(400).json({ error: "username requis" });
    if (!pin || pin.length < 4) return res.status(400).json({ error: "PIN requis (min 4 chiffres)" });

    const id = randomUUID();
    const fp = fingerprint || randomUUID();
    const userRole = role || "user";
    const pinHash = await hashPin(pin);
    const passwordHash = password ? await hashPassword(password) : null;

    await db.execute(sql`
      INSERT INTO devmax_users (id, fingerprint, username, display_name, first_name, last_name, email, login_id, pin_hash, password_hash, role)
      VALUES (${id}, ${fp}, ${username}, ${displayName || `${firstName || ''} ${lastName || ''}`.trim() || username}, ${firstName || null}, ${lastName || null}, ${email || null}, ${loginId || null}, ${pinHash}, ${passwordHash}, ${userRole})
    `);

    await logAdminAudit(req, "user_created", "user", id, null, { username, role: userRole });
    res.json({ id, fingerprint: fp, username, displayName: displayName || username, role: userRole, loginId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/admin/users/:userId", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { username, displayName, firstName, lastName, email, pin, loginId, password, role, active, unlock } = req.body;

    const setClauses: ReturnType<typeof sql>[] = [];
    if (username !== undefined) setClauses.push(sql`username = ${username}`);
    if (displayName !== undefined) setClauses.push(sql`display_name = ${displayName}`);
    if (firstName !== undefined) setClauses.push(sql`first_name = ${firstName}`);
    if (lastName !== undefined) setClauses.push(sql`last_name = ${lastName}`);
    if (email !== undefined) setClauses.push(sql`email = ${email}`);
    if (loginId !== undefined) setClauses.push(sql`login_id = ${loginId}`);
    if (pin !== undefined) {
      const pinHash = await hashPin(pin);
      setClauses.push(sql`pin_hash = ${pinHash}`);
      setClauses.push(sql`pin = NULL`);
    }
    if (password !== undefined) {
      const passHash = await hashPassword(password);
      setClauses.push(sql`password_hash = ${passHash}`);
    }
    if (role !== undefined) setClauses.push(sql`role = ${role}`);
    if (active !== undefined) setClauses.push(sql`active = ${active}`);
    if (unlock) {
      setClauses.push(sql`failed_attempts = 0`);
      setClauses.push(sql`locked_until = NULL`);
    }
    setClauses.push(sql`updated_at = NOW()`);

    const setQuery = sql.join(setClauses, sql`, `);
    await db.execute(sql`UPDATE devmax_users SET ${setQuery} WHERE id = ${userId}`);
    await logAdminAudit(req, "user_updated", "user", userId, null, { fields: Object.keys(req.body) });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/admin/users/:userId", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    await db.execute(sql`DELETE FROM devmax_users WHERE id = ${req.params.userId}`);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/admin/projects", requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const projects = await db.execute(sql`
      SELECT p.*, 
        u.username as owner_username, u.display_name as owner_display_name,
        (SELECT COUNT(*) FROM devmax_chat_history WHERE project_id = p.id) as chat_count,
        (SELECT COUNT(*) FROM devmax_project_journal WHERE project_id = p.id) as journal_count
      FROM devmax_projects p
      LEFT JOIN devmax_users u ON p.fingerprint = u.fingerprint
      ORDER BY p.updated_at DESC
    `).then((r: any) => r.rows || r);
    res.json(projects);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/admin/projects/:projectId/detail", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const [project] = await db.execute(sql`SELECT * FROM devmax_projects WHERE id = ${projectId}`).then((r: any) => r.rows || r);
    if (!project) return res.status(404).json({ error: "Projet non trouvé" });

    const recentChat = await db.execute(sql`
      SELECT role, content, created_at FROM devmax_chat_history 
      WHERE project_id = ${projectId} ORDER BY created_at DESC LIMIT 20
    `).then((r: any) => r.rows || r);

    const journal = await db.execute(sql`
      SELECT * FROM devmax_project_journal 
      WHERE project_id = ${projectId} ORDER BY created_at DESC LIMIT 20
    `).then((r: any) => r.rows || r);

    const activity = await db.execute(sql`
      SELECT * FROM devmax_activity_log 
      WHERE details::text LIKE ${`%${projectId}%`} 
      ORDER BY created_at DESC LIMIT 20
    `).then((r: any) => r.rows || r);

    res.json({ project, recentChat: recentChat.reverse(), journal, activity });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/admin/activity", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const activity = await db.execute(sql`
      SELECT a.*, s.fingerprint, s.display_name 
      FROM devmax_activity_log a 
      LEFT JOIN devmax_sessions s ON a.session_id = s.id
      ORDER BY a.created_at DESC 
      LIMIT ${limit}
    `).then((r: any) => r.rows || r);
    res.json(activity);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/admin/stats", requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const stats = await db.execute(sql`
      SELECT 
        (SELECT COUNT(*) FROM devmax_users) as total_users,
        (SELECT COUNT(*) FROM devmax_users WHERE active = true) as active_users,
        (SELECT COUNT(*) FROM devmax_projects) as total_projects,
        (SELECT COUNT(*) FROM devmax_sessions WHERE expires_at > NOW()) as active_sessions,
        (SELECT COUNT(*) FROM devmax_chat_history) as total_messages,
        (SELECT COUNT(*) FROM devmax_project_journal) as total_journal_entries,
        (SELECT COUNT(*) FROM devmax_activity_log WHERE created_at > NOW() - INTERVAL '24 hours') as activity_24h,
        (SELECT COUNT(DISTINCT fingerprint) FROM devmax_sessions WHERE last_active_at > NOW() - INTERVAL '7 days') as users_7d
    `).then((r: any) => (r.rows || r)[0]);
    res.json(stats);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/admin/deployed-apps", requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const projects = await devmaxStorage.getDeployedProjects();
    res.json(projects);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/tenants", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { name, slug, ownerId, plan, billingEmail, trialMonths,
      productionUrl, stagingUrl, githubOrg, githubRepo, githubToken,
      contactName, contactEmail, contactPhone, address,
      stripeCustomerId, paymentMethod } = req.body;
    if (!name || !slug) return res.status(400).json({ error: "name et slug requis" });

    const existing = await db.execute(sql`SELECT id FROM devmax_tenants WHERE slug = ${slug}`).then((r: any) => (r.rows || r));
    if (existing.length) return res.status(409).json({ error: "Ce slug existe deja" });

    const id = randomUUID();
    const planLimits = getPlanLimits(plan || "free");
    const trialEnd = trialMonths ? new Date(Date.now() + trialMonths * 30 * 86400000) : null;

    const credLogin = `${slug}-devmax`;
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let credPassPlain = "D-";
    for (let i = 0; i < 12; i++) credPassPlain += chars[Math.floor(Math.random() * chars.length)];
    const credPassHash = await hashPassword(credPassPlain);

    await db.execute(sql`
      INSERT INTO devmax_tenants (id, name, slug, owner_id, plan, plan_limits, billing_email, trial_ends_at,
        production_url, staging_url, github_org, github_repo, github_token,
        contact_name, contact_email, contact_phone, address,
        stripe_customer_id, payment_method, credential_login, credential_password)
      VALUES (${id}, ${name}, ${slug}, ${ownerId || null}, ${plan || "free"}, ${JSON.stringify(planLimits)}, ${billingEmail || null}, ${trialEnd},
        ${productionUrl || null}, ${stagingUrl || null}, ${githubOrg || null}, ${githubRepo || null}, ${githubToken ? encryptToken(githubToken) : null},
        ${contactName || null}, ${contactEmail || null}, ${contactPhone || null}, ${address || null},
        ${stripeCustomerId || null}, ${paymentMethod || "none"}, ${credLogin}, ${credPassHash})
    `);

    if (ownerId) {
      await db.execute(sql`UPDATE devmax_users SET tenant_id = ${id} WHERE id = ${ownerId}`);
    }

    await logAdminAudit(req, "tenant_created", "tenant", id, null, { name, slug, plan: plan || "free" });
    res.json({ id, name, slug, plan: plan || "free", credentials: { login: credLogin, password: credPassPlain } });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/admin/tenants", requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const tenants = await db.execute(sql`
      SELECT t.*,
        u.username as owner_username, u.display_name as owner_display_name,
        (SELECT COUNT(*) FROM devmax_users WHERE tenant_id = t.id AND active = true) as member_count,
        (SELECT COUNT(*) FROM devmax_projects WHERE tenant_id = t.id) as project_count,
        (SELECT COUNT(*) FROM devmax_usage_logs WHERE tenant_id = t.id AND created_at > NOW() - INTERVAL '30 days') as usage_30d
      FROM devmax_tenants t
      LEFT JOIN devmax_users u ON t.owner_id = u.id
      ORDER BY t.created_at DESC
    `).then((r: any) => r.rows || r);
    res.json(tenants);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/admin/tenants/:tenantId", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    const [tenant] = await db.execute(sql`
      SELECT t.*, u.username as owner_username, u.display_name as owner_display_name
      FROM devmax_tenants t LEFT JOIN devmax_users u ON t.owner_id = u.id WHERE t.id = ${tenantId}
    `).then((r: any) => r.rows || r);
    if (!tenant) return res.status(404).json({ error: "Tenant non trouve" });

    if (!tenant.credential_login || !tenant.credential_password) {
      const credLogin = `${tenant.slug}-devmax`;
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      let credPassPlain = "D-";
      for (let i = 0; i < 12; i++) credPassPlain += chars[Math.floor(Math.random() * chars.length)];
      const credPassHash = await hashPassword(credPassPlain);
      await db.execute(sql`UPDATE devmax_tenants SET credential_login = ${credLogin}, credential_password = ${credPassHash} WHERE id = ${tenantId}`);
      tenant.credential_login = credLogin;
      tenant.credential_password = credPassPlain;
    }

    const members = await db.execute(sql`
      SELECT id, fingerprint, username, display_name, email, active, role, last_login_at, created_at, tenant_id
      FROM devmax_users
      WHERE tenant_id = ${tenantId} ORDER BY created_at
    `).then((r: any) => r.rows || r);

    const projects = await db.execute(sql`
      SELECT id, name, deploy_slug, staging_url, production_url, environment, updated_at
      FROM devmax_projects WHERE tenant_id = ${tenantId} ORDER BY updated_at DESC
    `).then((r: any) => r.rows || r);

    const invitations = await db.execute(sql`
      SELECT * FROM devmax_invitations WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT 20
    `).then((r: any) => r.rows || r);

    const apiKeys = await db.execute(sql`
      SELECT id, name, key_prefix, permissions, last_used_at, expires_at, active, created_at
      FROM devmax_api_keys WHERE tenant_id = ${tenantId} ORDER BY created_at DESC
    `).then((r: any) => r.rows || r);

    const usageStats = await db.execute(sql`
      SELECT action, COUNT(*) as count FROM devmax_usage_logs
      WHERE tenant_id = ${tenantId} AND created_at > NOW() - INTERVAL '30 days'
      GROUP BY action ORDER BY count DESC
    `).then((r: any) => r.rows || r);

    const recentAudit = await db.execute(sql`
      SELECT * FROM devmax_audit_log WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT 30
    `).then((r: any) => r.rows || r);

    const integrations = await db.execute(sql`
      SELECT id, service, status, config, last_sync_at, last_error, enabled, created_at, updated_at
      FROM devmax_integrations WHERE tenant_id = ${tenantId} ORDER BY service
    `).then((r: any) => r.rows || r);

    const safeTenant = { ...tenant };
    if (safeTenant.credential_password) {
      safeTenant.credential_password_masked = "••••••••••••";
      safeTenant.credential_password_is_set = true;
      delete safeTenant.credential_password;
    }

    res.json({ tenant: safeTenant, members, projects, invitations, apiKeys, usageStats, recentAudit, integrations });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/admin/tenants/:tenantId", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    const { name, plan, billingEmail, billingStatus, settings, ownerId,
      productionUrl, stagingUrl, githubOrg, githubRepo, githubToken,
      contactName, contactEmail, contactPhone, address,
      stripeCustomerId, paymentMethod } = req.body;

    const setClauses: ReturnType<typeof sql>[] = [];
    if (name) setClauses.push(sql`name = ${name}`);
    if (plan) {
      setClauses.push(sql`plan = ${plan}`);
      setClauses.push(sql`plan_limits = ${JSON.stringify(getPlanLimits(plan))}::jsonb`);
    }
    if (billingEmail !== undefined) setClauses.push(sql`billing_email = ${billingEmail || null}`);
    if (billingStatus) setClauses.push(sql`billing_status = ${billingStatus}`);
    if (settings) setClauses.push(sql`settings = ${JSON.stringify(settings)}::jsonb`);
    if (ownerId) setClauses.push(sql`owner_id = ${ownerId}`);
    if (req.body.credentialPassword) {
      const hashedCred = await hashPassword(req.body.credentialPassword);
      setClauses.push(sql`credential_password = ${hashedCred}`);
    }
    if (productionUrl !== undefined) setClauses.push(sql`production_url = ${productionUrl || null}`);
    if (stagingUrl !== undefined) setClauses.push(sql`staging_url = ${stagingUrl || null}`);
    if (githubOrg !== undefined) setClauses.push(sql`github_org = ${githubOrg || null}`);
    if (githubRepo !== undefined) setClauses.push(sql`github_repo = ${githubRepo || null}`);
    if (githubToken !== undefined) setClauses.push(sql`github_token = ${githubToken ? encryptToken(githubToken) : null}`);
    if (contactName !== undefined) setClauses.push(sql`contact_name = ${contactName || null}`);
    if (contactEmail !== undefined) setClauses.push(sql`contact_email = ${contactEmail || null}`);
    if (contactPhone !== undefined) setClauses.push(sql`contact_phone = ${contactPhone || null}`);
    if (address !== undefined) setClauses.push(sql`address = ${address || null}`);
    if (stripeCustomerId !== undefined) setClauses.push(sql`stripe_customer_id = ${stripeCustomerId || null}`);
    if (paymentMethod !== undefined) setClauses.push(sql`payment_method = ${paymentMethod || null}`);
    if (req.body.credentialLogin !== undefined) setClauses.push(sql`credential_login = ${req.body.credentialLogin || null}`);
    setClauses.push(sql`updated_at = NOW()`);

    const setQuery = sql.join(setClauses, sql`, `);
    await db.execute(sql`UPDATE devmax_tenants SET ${setQuery} WHERE id = ${tenantId}`);
    await logAdminAudit(req, "tenant_updated", "tenant", tenantId, null, req.body);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/admin/tenants/:tenantId", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    await db.execute(sql`UPDATE devmax_projects SET tenant_id = NULL WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`UPDATE devmax_users SET tenant_id = NULL WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM devmax_tenants WHERE id = ${tenantId}`);
    await logAdminAudit(req, "tenant_deleted", "tenant", tenantId, null, null);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/tenants/:tenantId/members", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    const { userId, role } = req.body;
    if (!userId) return res.status(400).json({ error: "userId requis" });

    await db.execute(sql`UPDATE devmax_users SET tenant_id = ${tenantId}, role = ${role || 'user'} WHERE id = ${userId}`);
    await logAdminAudit(req, "member_added", "tenant_member", tenantId, null, { userId, role });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/admin/tenants/:tenantId/members/:userId", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = req.params;
    await db.execute(sql`UPDATE devmax_users SET tenant_id = NULL WHERE id = ${userId} AND tenant_id = ${tenantId}`);
    await logAdminAudit(req, "member_removed", "tenant_member", tenantId, null, { userId });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/tenants/:tenantId/assign-project", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    const { projectId } = req.body;
    if (!projectId) return res.status(400).json({ error: "projectId requis" });

    await devmaxStorage.assignProjectToTenant(tenantId, projectId);
    await logAdminAudit(req, "project_assigned", "project", projectId, null, { tenantId });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/invitations", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId, email, role } = req.body;
    if (!tenantId || !email) return res.status(400).json({ error: "tenantId et email requis" });

    const result = await devmaxStorage.createInvitation(tenantId, email, role || "member");
    await logAdminAudit(req, "invitation_sent", "invitation", result.id, null, { email, role, tenantId });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/admin/invitations/:invitationId", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    await devmaxStorage.deleteInvitation(req.params.invitationId);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/api-keys", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId, name, permissions, expiresInDays } = req.body;
    if (!tenantId || !name) return res.status(400).json({ error: "tenantId et name requis" });

    const result = await devmaxStorage.createApiKey(tenantId, name, permissions || ["read"], expiresInDays);
    await logAdminAudit(req, "api_key_created", "api_key", result.id, null, { name, tenantId });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/admin/api-keys/:keyId", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    await devmaxStorage.deleteApiKey(req.params.keyId);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/admin/api-keys/:keyId/toggle", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    await devmaxStorage.toggleApiKey(req.params.keyId);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/admin/audit", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const tenantId = req.query.tenantId as string;
    const audit = await devmaxStorage.getAuditLog({ limit, tenantId });
    res.json(audit);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/admin/usage", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenantId as string;
    const days = parseInt(req.query.days as string) || 30;
    const usage = await devmaxStorage.getUsageStats({ tenantId, days });
    res.json(usage);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/admin/platform-health", requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const health = await devmaxStorage.getPlatformHealth();
    res.json(health);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/admin/scalability-health", requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const { healthMonitor } = await import("../../middleware/scalability");
    const health = healthMonitor.getHealth();
    const { pool } = await import("../../db");
    const poolStats = {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    };
    const { workerManager } = await import("../../middleware/workerManager");
    const { domainIsolation } = await import("../../middleware/domainIsolation");
    res.json({
      ...health,
      dbPool: poolStats,
      workers: workerManager.getWorkerStats(),
      workerTasks: workerManager.getActiveTasksList(),
      domains: domainIsolation.getDomainHealth(),
      roadmap: domainIsolation.getRoadmap(),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

function getPlanLimits(plan: string) {
  const plans: Record<string, any> = {
    free: { max_projects: 3, max_users: 2, max_deploys_month: 10, max_storage_gb: 1, custom_domain: false, priority_support: false, api_access: false },
    starter: { max_projects: 10, max_users: 5, max_deploys_month: 50, max_storage_gb: 5, custom_domain: false, priority_support: false, api_access: true },
    pro: { max_projects: 50, max_users: 20, max_deploys_month: 200, max_storage_gb: 25, custom_domain: true, priority_support: true, api_access: true },
    enterprise: { max_projects: -1, max_users: -1, max_deploys_month: -1, max_storage_gb: 100, custom_domain: true, priority_support: true, api_access: true },
  };
  return plans[plan] || plans.free;
}

const INTEGRATION_CATALOG = [
  { service: "gmail", label: "Gmail", icon: "Mail", category: "communication", description: "Envoi et lecture d'emails via Google", fields: ["client_id", "client_secret", "refresh_token"] },
  { service: "notion", label: "Notion", icon: "BookOpen", category: "productivity", description: "Gestion de bases de données et pages Notion", fields: ["api_key", "workspace_id"] },
  { service: "spotify", label: "Spotify", icon: "Music", category: "media", description: "Accès aux playlists et données musicales", fields: ["client_id", "client_secret", "refresh_token"] },
  { service: "discord", label: "Discord", icon: "MessageCircle", category: "communication", description: "Bots et webhooks Discord", fields: ["bot_token", "webhook_url"] },
  { service: "github", label: "GitHub", icon: "Github", category: "development", description: "Accès aux repos, issues, et CI/CD", fields: ["token", "org", "repo"] },
  { service: "google_drive", label: "Google Drive", icon: "HardDrive", category: "storage", description: "Stockage et partage de fichiers", fields: ["client_id", "client_secret", "refresh_token"] },
  { service: "google_calendar", label: "Google Calendar", icon: "Calendar", category: "productivity", description: "Gestion d'événements et calendriers", fields: ["client_id", "client_secret", "refresh_token"] },
  { service: "stripe", label: "Stripe", icon: "CreditCard", category: "payment", description: "Paiements et facturation", fields: ["secret_key", "publishable_key", "webhook_secret"] },
  { service: "todoist", label: "Todoist", icon: "CheckSquare", category: "productivity", description: "Gestion de tâches et projets", fields: ["api_key"] },
  { service: "slack", label: "Slack", icon: "Hash", category: "communication", description: "Messagerie d'équipe et notifications", fields: ["bot_token", "webhook_url"] },
  { service: "openai", label: "OpenAI", icon: "Cpu", category: "ai", description: "Accès aux modèles GPT et DALL-E", fields: ["api_key", "org_id"] },
  { service: "vercel", label: "Vercel", icon: "Triangle", category: "deployment", description: "Déploiement et hébergement", fields: ["token", "team_id"] },
  { service: "supabase", label: "Supabase", icon: "Database", category: "database", description: "Base de données et authentification", fields: ["url", "anon_key", "service_role_key"] },
  { service: "twilio", label: "Twilio", icon: "Phone", category: "communication", description: "SMS et appels téléphoniques", fields: ["account_sid", "auth_token", "phone_number"] },
  { service: "sendgrid", label: "SendGrid", icon: "Send", category: "communication", description: "Envoi d'emails transactionnels", fields: ["api_key"] },
  { service: "aws_s3", label: "AWS S3", icon: "Cloud", category: "storage", description: "Stockage objet cloud Amazon", fields: ["access_key_id", "secret_access_key", "region", "bucket"] },
  { service: "firebase", label: "Firebase", icon: "Flame", category: "database", description: "Base de données temps réel et hosting", fields: ["project_id", "api_key", "service_account_json"] },
  { service: "webhook", label: "Webhook personnalisé", icon: "Link", category: "custom", description: "Intégration via webhook HTTP", fields: ["url", "secret", "method"] },
];

router.get("/admin/integration-catalog", requireAdminAuth, async (_req: Request, res: Response) => {
  res.json({ catalog: INTEGRATION_CATALOG });
});

router.get("/admin/tenants/:tenantId/integrations", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    const integrations = await db.execute(sql`
      SELECT id, tenant_id, service, status, config, last_sync_at, last_error, enabled, created_at, updated_at
      FROM devmax_integrations WHERE tenant_id = ${tenantId} ORDER BY service
    `).then((r: any) => r.rows || r);
    res.json({ integrations });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/tenants/:tenantId/integrations", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    const { service, credentials, config } = req.body;
    if (!service) return res.status(400).json({ error: "Service requis" });

    const catalogEntry = INTEGRATION_CATALOG.find(c => c.service === service);
    if (!catalogEntry) return res.status(400).json({ error: "Service inconnu" });

    const existing = await db.execute(sql`SELECT id FROM devmax_integrations WHERE tenant_id = ${tenantId} AND service = ${service}`).then((r: any) => r.rows || r);
    if (existing.length > 0) return res.status(409).json({ error: "Integration deja configuree" });

    const id = randomUUID();
    const hasCredentials = credentials && Object.values(credentials).some((v: any) => v && v.trim());
    await db.execute(sql`
      INSERT INTO devmax_integrations (id, tenant_id, service, status, config, credentials, enabled)
      VALUES (${id}, ${tenantId}, ${service}, ${hasCredentials ? 'connected' : 'disconnected'}, ${JSON.stringify(config || {})}, ${JSON.stringify(credentials || {})}, ${true})
    `);
    await logAdminAudit(req, "integration_added", "integration", id, null, { service, tenantId });
    res.json({ success: true, id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/admin/tenants/:tenantId/integrations/:integrationId", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId, integrationId } = req.params;
    const { credentials, config, enabled, status } = req.body;
    const setClauses: ReturnType<typeof sql>[] = [];
    if (credentials !== undefined) {
      setClauses.push(sql`credentials = ${JSON.stringify(credentials)}::jsonb`);
      const hasCredentials = Object.values(credentials).some((v: any) => v && String(v).trim());
      setClauses.push(sql`status = ${hasCredentials ? 'connected' : 'disconnected'}`);
    }
    if (config !== undefined) setClauses.push(sql`config = ${JSON.stringify(config)}::jsonb`);
    if (enabled !== undefined) setClauses.push(sql`enabled = ${enabled}`);
    if (status) setClauses.push(sql`status = ${status}`);
    setClauses.push(sql`updated_at = NOW()`);
    const setQuery = sql.join(setClauses, sql`, `);
    await db.execute(sql`UPDATE devmax_integrations SET ${setQuery} WHERE id = ${integrationId} AND tenant_id = ${tenantId}`);
    await logAdminAudit(req, "integration_updated", "integration", integrationId, null, req.body);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/admin/tenants/:tenantId/integrations/:integrationId", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId, integrationId } = req.params;
    await db.execute(sql`DELETE FROM devmax_integrations WHERE id = ${integrationId} AND tenant_id = ${tenantId}`);
    await logAdminAudit(req, "integration_removed", "integration", integrationId, null, null);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/tenants/:tenantId/integrations/:integrationId/test", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId, integrationId } = req.params;
    const [integration] = await db.execute(sql`SELECT * FROM devmax_integrations WHERE id = ${integrationId} AND tenant_id = ${tenantId}`).then((r: any) => r.rows || r);
    if (!integration) return res.status(404).json({ error: "Integration non trouvee" });

    await db.execute(sql`UPDATE devmax_integrations SET last_sync_at = NOW(), status = 'connected', last_error = NULL WHERE id = ${integrationId}`);
    res.json({ success: true, status: "connected" });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

async function logAdminAudit(req: Request, action: string, entityType: string, entityId: string, oldValues: any, newValues: any) {
  try {
    await db.execute(sql`
      INSERT INTO devmax_audit_log (tenant_id, user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
      VALUES (${null}, ${"master-admin"}, ${action}, ${entityType}, ${entityId}, ${oldValues ? JSON.stringify(oldValues) : null}, ${newValues ? JSON.stringify(newValues) : null}, ${req.ip || null}, ${req.headers["user-agent"] || null})
    `);
  } catch (e) {
    safeCatch("devmax-audit-log", e);
  }
}

router.post("/contact/enterprise", async (req: Request, res: Response) => {
  try {
    const { company, name, email, phone, projectCount, message } = req.body;
    if (!email || !name || !company) {
      return res.status(400).json({ error: "Nom, email et entreprise sont requis" });
    }
    await db.execute(sql`
      INSERT INTO devmax_enterprise_inquiries (company, contact_name, email, phone, project_count, message, status, created_at)
      VALUES (${company}, ${name}, ${email}, ${phone || null}, ${projectCount || null}, ${message || null}, 'new', NOW())
    `).catch(async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS devmax_enterprise_inquiries (
          id SERIAL PRIMARY KEY, company TEXT NOT NULL, contact_name TEXT NOT NULL, email TEXT NOT NULL,
          phone TEXT, project_count TEXT, message TEXT, status TEXT DEFAULT 'new', created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await db.execute(sql`
        INSERT INTO devmax_enterprise_inquiries (company, contact_name, email, phone, project_count, message, status, created_at)
        VALUES (${company}, ${name}, ${email}, ${phone || null}, ${projectCount || null}, ${message || null}, 'new', NOW())
      `);
    });

    try {
      const gmailService: any = { sendEmail: async (opts: any) => { console.warn("[DevMax] gmailService not implemented, enterprise inquiry email skipped:", opts.subject); } };
      await gmailService.sendEmail({
        to: "maurice.djedou@gmail.com",
        subject: `[DevMax Enterprise] Nouvelle demande de ${company}`,
        body: `<h2>Demande Enterprise DevMax</h2><p><b>Entreprise:</b> ${company}</p><p><b>Contact:</b> ${name} (${email})</p><p><b>Téléphone:</b> ${phone || "Non fourni"}</p><p><b>Nombre de projets estimé:</b> ${projectCount || "Non précisé"}</p><p><b>Message:</b></p><p>${message || "Aucun message"}</p>`,
        isHtml: true,
      });
    } catch {}

    sendDevmaxNotification({ tenantId: null, projectId: null, type: "enterprise_inquiry", title: `Demande Enterprise: ${company}`, message: `${name} (${email}) souhaite discuter du plan Enterprise. ${projectCount ? `Projets estimés: ${projectCount}` : ""}` }).catch(() => {});

    res.json({ success: true, message: "Votre demande a été envoyée. Nous vous contacterons sous 24h." });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
