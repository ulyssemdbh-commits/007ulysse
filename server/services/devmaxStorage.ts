import { db } from "../db";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";

export const devmaxStorage = {
  async getPlatformHealth() {
    const result = await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM devmax_tenants) as total_tenants,
        (SELECT COUNT(*) FROM devmax_tenants WHERE billing_status = 'active') as active_tenants,
        (SELECT COUNT(*) FROM devmax_tenants WHERE plan = 'free') as free_tenants,
        (SELECT COUNT(*) FROM devmax_tenants WHERE plan = 'pro') as pro_tenants,
        (SELECT COUNT(*) FROM devmax_tenants WHERE plan = 'enterprise') as enterprise_tenants,
        (SELECT COUNT(*) FROM devmax_users) as total_users,
        (SELECT COUNT(*) FROM devmax_users WHERE active = true) as active_users,
        (SELECT COUNT(*) FROM devmax_projects) as total_projects,
        (SELECT COUNT(*) FROM devmax_projects WHERE staging_url IS NOT NULL OR production_url IS NOT NULL) as deployed_projects,
        (SELECT COUNT(*) FROM devmax_sessions WHERE expires_at > NOW()) as active_sessions,
        (SELECT COUNT(*) FROM devmax_api_keys WHERE active = true) as active_api_keys,
        (SELECT COUNT(*) FROM devmax_invitations WHERE status = 'pending') as pending_invitations,
        (SELECT COUNT(*) FROM devmax_chat_history) as total_messages,
        (SELECT COUNT(*) FROM devmax_usage_logs WHERE created_at > NOW() - INTERVAL '24 hours') as usage_24h,
        (SELECT COUNT(*) FROM devmax_usage_logs WHERE created_at > NOW() - INTERVAL '7 days') as usage_7d,
        (SELECT COUNT(DISTINCT tenant_id) FROM devmax_usage_logs WHERE created_at > NOW() - INTERVAL '7 days') as active_tenants_7d
    `).then((r: any) => (r.rows || r)[0]);
    return result;
  },

  async getTenants() {
    const result = await db.execute(sql`
      SELECT t.*, 
        (SELECT COUNT(*) FROM devmax_users WHERE tenant_id = t.id AND active = true) as member_count,
        (SELECT COUNT(*) FROM devmax_projects WHERE tenant_id = t.id) as project_count,
        u.display_name as owner_name
      FROM devmax_tenants t
      LEFT JOIN devmax_users u ON t.owner_id = u.id
      ORDER BY t.created_at DESC
    `);
    return (result as any).rows || result;
  },

  async getTenantDetail(tenantId: string) {
    const tenant = await db.execute(sql`SELECT * FROM devmax_tenants WHERE id = ${tenantId}`).then((r: any) => (r.rows || r)[0]);
    if (!tenant) return null;

    const members = await db.execute(sql`
      SELECT id, fingerprint, username, display_name, email, active as user_active, role, last_login_at, created_at, tenant_id
      FROM devmax_users
      WHERE tenant_id = ${tenantId}
    `).then((r: any) => r.rows || r);

    const projects = await db.execute(sql`SELECT * FROM devmax_projects WHERE tenant_id = ${tenantId}`).then((r: any) => r.rows || r);
    const invitations = await db.execute(sql`SELECT * FROM devmax_invitations WHERE tenant_id = ${tenantId} ORDER BY created_at DESC`).then((r: any) => r.rows || r);
    const apiKeys = await db.execute(sql`SELECT id, tenant_id, name, key_prefix, permissions, last_used_at, expires_at, active, created_at FROM devmax_api_keys WHERE tenant_id = ${tenantId}`).then((r: any) => r.rows || r);

    return { tenant, members, projects, invitations, apiKeys };
  },

  async createTenant(data: { name: string; slug: string; plan: string; billingEmail?: string; ownerId?: string; maxProjects?: number }) {
    const id = randomUUID();
    const planLimits = getPlanLimits(data.plan || "free");
    if (data.maxProjects) planLimits.max_projects = data.maxProjects;

    await db.execute(sql`
      INSERT INTO devmax_tenants (id, name, slug, plan, plan_limits, billing_email, owner_id)
      VALUES (${id}, ${data.name}, ${data.slug}, ${data.plan || "free"}, ${JSON.stringify(planLimits)}, ${data.billingEmail || null}, ${data.ownerId || null})
    `);
    return { id, name: data.name, slug: data.slug, plan: data.plan };
  },

  async updateTenant(tenantId: string, data: { name?: string; plan?: string; billingEmail?: string; billingStatus?: string; ownerId?: string }) {
    const updates: string[] = [];
    if (data.name) updates.push(`name = '${data.name.replace(/'/g, "''")}'`);
    if (data.plan) {
      updates.push(`plan = '${data.plan}'`);
      updates.push(`plan_limits = '${JSON.stringify(getPlanLimits(data.plan))}'`);
    }
    if (data.billingEmail !== undefined) updates.push(`billing_email = '${(data.billingEmail || "").replace(/'/g, "''")}'`);
    if (data.billingStatus) updates.push(`billing_status = '${data.billingStatus}'`);
    if (data.ownerId) updates.push(`owner_id = '${data.ownerId}'`);
    updates.push("updated_at = NOW()");

    if (updates.length > 0) {
      await db.execute(sql.raw(`UPDATE devmax_tenants SET ${updates.join(", ")} WHERE id = '${tenantId}'`));
    }
  },

  async deleteTenant(tenantId: string) {
    await db.execute(sql`DELETE FROM devmax_tenants WHERE id = ${tenantId}`);
  },

  async addTenantMember(tenantId: string, userId: string, role: string = "member") {
    await db.execute(sql`UPDATE devmax_users SET tenant_id = ${tenantId}, role = ${role} WHERE id = ${userId}`);
  },

  async removeTenantMember(tenantId: string, userId: string) {
    await db.execute(sql`UPDATE devmax_users SET tenant_id = NULL WHERE id = ${userId} AND tenant_id = ${tenantId}`);
  },

  async assignProjectToTenant(tenantId: string, projectId: string) {
    await db.execute(sql`UPDATE devmax_projects SET tenant_id = ${tenantId} WHERE id = ${projectId}`);
  },

  async getUsers() {
    const result = await db.execute(sql`SELECT id, fingerprint, username, display_name, email, role, active, tenant_id, last_login_at, created_at FROM devmax_users ORDER BY created_at DESC`);
    return (result as any).rows || result;
  },

  async createUser(data: { username: string; displayName?: string; email?: string; pin?: string; role?: string; tenantId?: string }) {
    const id = randomUUID();
    const fingerprint = `admin_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await db.execute(sql`
      INSERT INTO devmax_users (id, fingerprint, username, display_name, email, pin, role, tenant_id)
      VALUES (${id}, ${fingerprint}, ${data.username}, ${data.displayName || data.username}, ${data.email || null}, ${data.pin || "102040"}, ${data.role || "user"}, ${data.tenantId || null})
    `);
    return { id, username: data.username };
  },

  async getProjects() {
    const result = await db.execute(sql`
      SELECT p.*, t.name as tenant_name
      FROM devmax_projects p LEFT JOIN devmax_tenants t ON p.tenant_id = t.id
      ORDER BY p.updated_at DESC
    `);
    return (result as any).rows || result;
  },

  async getDeployedProjects() {
    const result = await db.execute(sql`
      SELECT p.*, t.name as tenant_name
      FROM devmax_projects p LEFT JOIN devmax_tenants t ON p.tenant_id = t.id
      WHERE p.staging_url IS NOT NULL OR p.production_url IS NOT NULL
      ORDER BY p.updated_at DESC
    `);
    return (result as any).rows || result;
  },

  async createInvitation(tenantId: string, email: string, role: string = "member") {
    const id = randomUUID();
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 86400000);
    await db.execute(sql`
      INSERT INTO devmax_invitations (id, tenant_id, email, role, token, invited_by, expires_at)
      VALUES (${id}, ${tenantId}, ${email}, ${role}, ${token}, ${"admin"}, ${expiresAt})
    `);
    return { id, token, email, expiresAt };
  },

  async deleteInvitation(invitationId: string) {
    await db.execute(sql`DELETE FROM devmax_invitations WHERE id = ${invitationId}`);
  },

  async createApiKey(tenantId: string, name: string, permissions: string[] = ["read"], expiresInDays?: number) {
    const id = randomUUID();
    const rawKey = `dmx_${randomUUID().replace(/-/g, "")}`;
    const keyPrefix = rawKey.substring(0, 12);
    const crypto = await import("crypto");
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
    const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86400000) : null;

    await db.execute(sql`
      INSERT INTO devmax_api_keys (id, tenant_id, name, key_hash, key_prefix, permissions, expires_at, created_by)
      VALUES (${id}, ${tenantId}, ${name}, ${keyHash}, ${keyPrefix}, ${JSON.stringify(permissions)}, ${expiresAt}, ${"admin"})
    `);
    return { id, key: rawKey, keyPrefix, name };
  },

  async deleteApiKey(keyId: string) {
    await db.execute(sql`DELETE FROM devmax_api_keys WHERE id = ${keyId}`);
  },

  async toggleApiKey(keyId: string) {
    await db.execute(sql`UPDATE devmax_api_keys SET active = NOT active WHERE id = ${keyId}`);
  },

  async getAuditLog(options: { limit?: number; tenantId?: string } = {}) {
    const limit = Math.min(Math.max(1, parseInt(String(options.limit || 100), 10) || 100), 500);
    let query = `
      SELECT a.*, u.username, u.display_name
      FROM devmax_audit_log a LEFT JOIN devmax_users u ON a.user_id = u.id
    `;
    if (options.tenantId) query += ` WHERE a.tenant_id = '${options.tenantId.replace(/'/g, "''")}'`;
    query += ` ORDER BY a.created_at DESC LIMIT ${limit}`;
    return await db.execute(sql.raw(query)).then((r: any) => r.rows || r);
  },

  async getUsageStats(options: { tenantId?: string; days?: number } = {}) {
    const days = Math.min(Math.max(1, parseInt(String(options.days || 30), 10) || 30), 365);
    let cond = `created_at > NOW() - INTERVAL '${days} days'`;
    if (options.tenantId) cond += ` AND tenant_id = '${options.tenantId.replace(/'/g, "''")}'`;

    const byAction = await db.execute(sql.raw(`
      SELECT action, COUNT(*) as count FROM devmax_usage_logs WHERE ${cond} GROUP BY action ORDER BY count DESC
    `)).then((r: any) => r.rows || r);

    const byDay = await db.execute(sql.raw(`
      SELECT DATE(created_at) as day, COUNT(*) as count FROM devmax_usage_logs WHERE ${cond} GROUP BY DATE(created_at) ORDER BY day DESC LIMIT ${days}
    `)).then((r: any) => r.rows || r);

    const byTenant = await db.execute(sql.raw(`
      SELECT tenant_id, COUNT(*) as count FROM devmax_usage_logs WHERE ${cond} GROUP BY tenant_id ORDER BY count DESC LIMIT 20
    `)).then((r: any) => r.rows || r);

    return { byAction, byDay: byDay.reverse(), byTenant };
  },
};

function getPlanLimits(plan: string) {
  const plans: Record<string, any> = {
    free: { max_projects: 3, max_users: 2, max_deploys_month: 10, max_storage_gb: 1, custom_domain: false, priority_support: false, api_access: false },
    starter: { max_projects: 10, max_users: 5, max_deploys_month: 50, max_storage_gb: 5, custom_domain: false, priority_support: false, api_access: true },
    pro: { max_projects: 50, max_users: 20, max_deploys_month: 200, max_storage_gb: 25, custom_domain: true, priority_support: true, api_access: true },
    enterprise: { max_projects: -1, max_users: -1, max_deploys_month: -1, max_storage_gb: 100, custom_domain: true, priority_support: true, api_access: true },
  };
  return { ...(plans[plan] || plans.free) };
}
