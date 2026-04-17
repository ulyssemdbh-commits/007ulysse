import { Request, Response } from "express";
import { db } from "../../db";
import { devmaxSessions, devmaxActivityLog } from "@shared/schema";
import { eq, and, gt } from "drizzle-orm";
import { sql } from "drizzle-orm";

export const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;
export const MAX_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 30 * 60 * 1000;

export async function hashPin(pin: string): Promise<string> {
  const bcrypt = await import("bcryptjs");
  return bcrypt.hash(pin, 10);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  const bcrypt = await import("bcryptjs");
  if (hash.startsWith("$2")) {
    return bcrypt.compare(pin, hash);
  }
  const crypto = await import("crypto");
  const sha256 = crypto.createHash("sha256").update(pin).digest("hex");
  return sha256 === hash;
}

export async function hashPassword(password: string): Promise<string> {
  const crypto = await import("crypto");
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const crypto = await import("crypto");
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return test === hash;
}

export async function getSessionUser(req: Request): Promise<{ session: any; user: any } | null> {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return null;
  const [session] = await db.select().from(devmaxSessions)
    .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
    .limit(1);
  if (!session) return null;
  if (!(session as any).userId) return { session, user: null };
  const [user] = await db.execute(sql`SELECT * FROM devmax_users WHERE id = ${(session as any).userId}`).then((r: any) => r.rows || r);
  return { session, user: user || null };
}

export async function verifyProjectAccess(session: any, projectId: string): Promise<boolean> {
  if (!session || !projectId) return false;
  const [project] = await db.execute(sql`SELECT id, fingerprint, tenant_id FROM devmax_projects WHERE id = ${projectId}`).then((r: any) => r.rows || r);
  if (!project) return false;
  if (project.fingerprint === session.fingerprint) return true;
  if (session.tenantId && project.tenant_id === session.tenantId) return true;
  return false;
}

const PLAN_LIMITS: Record<string, { max_projects: number; max_users: number; max_deploys_month: number; max_storage_gb: number; custom_domain: boolean; api_access: boolean }> = {
  free: { max_projects: 3, max_users: 2, max_deploys_month: 10, max_storage_gb: 1, custom_domain: false, api_access: false },
  starter: { max_projects: 10, max_users: 5, max_deploys_month: 50, max_storage_gb: 5, custom_domain: true, api_access: false },
  pro: { max_projects: 50, max_users: 20, max_deploys_month: 500, max_storage_gb: 50, custom_domain: true, api_access: true },
  enterprise: { max_projects: 999, max_users: 999, max_deploys_month: 9999, max_storage_gb: 500, custom_domain: true, api_access: true },
};

export function getPlanLimits(plan: string) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

export async function checkPlanLimits(tenantId: string | null, action: "deploy" | "create_project" | "add_user" | "custom_domain" | "api_access"): Promise<{ allowed: boolean; reason?: string; plan?: string; usage?: any; limit?: any }> {
  if (!tenantId) return { allowed: true, plan: "owner" };
  try {
    const [tenant] = await db.execute(sql`SELECT plan, plan_limits FROM devmax_tenants WHERE id = ${tenantId}`).then((r: any) => r.rows || r);
    if (!tenant) return { allowed: true };
    const plan = tenant.plan || "free";
    const limits = tenant.plan_limits || PLAN_LIMITS[plan] || PLAN_LIMITS.free;

    if (action === "deploy") {
      if (limits.max_deploys_month === -1) return { allowed: true, plan };
      const [{ count }] = await db.execute(sql`
        SELECT COUNT(*)::int as count FROM devmax_deployments d
        JOIN devmax_projects p ON d.project_id = p.id
        WHERE p.tenant_id = ${tenantId} AND d.created_at > NOW() - INTERVAL '30 days'
      `).then((r: any) => r.rows || r);
      if (count >= limits.max_deploys_month) return { allowed: false, reason: `Limite de ${limits.max_deploys_month} déploiements/mois atteinte (plan ${plan}). Passez au plan supérieur.`, plan, usage: count, limit: limits.max_deploys_month };
    } else if (action === "create_project") {
      if (limits.max_projects === -1) return { allowed: true, plan };
      const [{ count }] = await db.execute(sql`SELECT COUNT(*)::int as count FROM devmax_projects WHERE tenant_id = ${tenantId}`).then((r: any) => r.rows || r);
      if (count >= limits.max_projects) return { allowed: false, reason: `Limite de ${limits.max_projects} projets atteinte (plan ${plan}). Passez au plan supérieur.`, plan, usage: count, limit: limits.max_projects };
    } else if (action === "add_user") {
      if (limits.max_users === -1) return { allowed: true, plan };
      const [{ count }] = await db.execute(sql`SELECT COUNT(*)::int as count FROM devmax_users WHERE tenant_id = ${tenantId} AND active = true`).then((r: any) => r.rows || r);
      if (count >= limits.max_users) return { allowed: false, reason: `Limite de ${limits.max_users} utilisateurs atteinte (plan ${plan}).`, plan, usage: count, limit: limits.max_users };
    } else if (action === "custom_domain") {
      if (!limits.custom_domain) return { allowed: false, reason: `Les domaines personnalisés ne sont pas disponibles avec le plan ${plan}. Passez au plan Starter ou supérieur.`, plan };
    } else if (action === "api_access") {
      if (!limits.api_access) return { allowed: false, reason: `L'accès API n'est pas disponible avec le plan ${plan}. Passez au plan Pro ou supérieur.`, plan };
    }
    return { allowed: true, plan };
  } catch (e: any) {
    console.error("[DevMax] Plan limits check failed:", e.message);
    return { allowed: true };
  }
}

export async function sendDevmaxNotification(params: {
  tenantId?: string | null;
  projectId?: string;
  type: string;
  title: string;
  message: string;
  metadata?: any;
}) {
  try {
    const { tenantId, projectId, type, title, message, metadata } = params;
    await db.execute(sql`
      INSERT INTO devmax_notifications (tenant_id, project_id, type, title, message, channel, metadata, status)
      VALUES (${tenantId || null}, ${projectId || null}, ${type}, ${title}, ${message}, 'in_app', ${JSON.stringify(metadata || {})}, 'sent')
    `).catch(() => {});

    if (tenantId) {
      const [tenant] = await db.execute(sql`SELECT notification_email, notification_webhook, name FROM devmax_tenants WHERE id = ${tenantId}`).then((r: any) => r.rows || r);
      if (tenant?.notification_email) {
        try {
          const gmailService: any = { sendEmail: async (opts: any) => { console.warn("[DevMax] gmailService not implemented, skipping email to", opts.to); } };
          await gmailService.sendEmail({
            to: tenant.notification_email,
            subject: `[DevMax] ${title}`,
            body: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
              <h2 style="color:#10b981">DevMax</h2>
              <h3>${title}</h3>
              <p>${message}</p>
              <hr style="border:1px solid #e5e7eb;margin:20px 0"/>
              <p style="color:#9ca3af;font-size:12px">Tenant: ${tenant.name} | ${new Date().toLocaleString("fr-FR")}</p>
            </div>`,
            isHtml: true,
          });
          await db.execute(sql`
            INSERT INTO devmax_notifications (tenant_id, project_id, type, title, message, channel, status)
            VALUES (${tenantId}, ${projectId || null}, ${type}, ${title}, ${message}, 'email', 'sent')
          `).catch(() => {});
        } catch (e: any) {
          console.warn("[DevMax] Email notification failed:", e.message);
        }
      }
      if (tenant?.notification_webhook) {
        try {
          await fetch(tenant.notification_webhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type, title, message, projectId, tenantId, metadata, timestamp: new Date().toISOString() }),
          });
          await db.execute(sql`
            INSERT INTO devmax_notifications (tenant_id, project_id, type, title, message, channel, status)
            VALUES (${tenantId}, ${projectId || null}, ${type}, ${title}, ${message}, 'webhook', 'sent')
          `).catch(() => {});
        } catch (e: any) {
          console.warn("[DevMax] Webhook notification failed:", e.message);
        }
      }
    }
  } catch (e: any) {
    console.error("[DevMax] Notification error:", e.message);
  }
}

export async function getProjectGitHubToken(projectId: string): Promise<string | null> {
  const { resolveProjectGitHubToken } = await import("../../services/devmax/tokenService");
  return resolveProjectGitHubToken(projectId);
}

export function requireDevmaxAuth(req: Request, res: Response, next: any) {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return res.status(401).json({ error: "DevMax authentication required" });

  db.select().from(devmaxSessions)
    .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
    .limit(1)
    .then(([session]) => {
      if (!session) return res.status(401).json({ error: "Session expired" });
      (req as any).devmaxSession = session;
      db.update(devmaxSessions)
        .set({ lastActiveAt: new Date() })
        .where(eq(devmaxSessions.id, token))
        .catch(() => {});
      next();
    })
    .catch(() => res.status(500).json({ error: "Auth error" }));
}

export async function logDevmaxActivity(req: Request, action: string, target?: string, details?: any) {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return;
  await db.insert(devmaxActivityLog).values({
    sessionId: token,
    action,
    target,
    details,
  }).catch(() => {});
}

export const ADMIN_PIN = process.env.DEVMAX_ADMIN_PIN || (() => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("[DevMax] DEVMAX_ADMIN_PIN must be set in production. Refusing to start with default admin PIN.");
  }
  console.warn("[DevMax] WARNING: Using default ADMIN_PIN — set DEVMAX_ADMIN_PIN in production");
  return "123adminMDBH";
})();

export function requireAdminAuth(req: Request, res: Response, next: any) {
  const adminToken = req.headers["x-devmax-admin"] as string;
  if (!adminToken) return res.status(401).json({ error: "Admin auth required" });
  db.execute(sql`SELECT id FROM devmax_sessions WHERE id = ${adminToken} AND expires_at > NOW()`)
    .then((r: any) => {
      const rows = r.rows || r;
      if (!rows.length) return res.status(401).json({ error: "Admin session expired" });
      next();
    })
    .catch(() => res.status(500).json({ error: "Auth error" }));
}

export async function logAdminAudit(req: Request, action: string, entityType: string, entityId: string, oldValues?: any, newValues?: any) {
  const session = (req as any).devmaxSession;
  await db.execute(sql`
    INSERT INTO devmax_audit_log (tenant_id, user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
    VALUES (${session?.tenantId || null}, ${session?.userId || null}, ${action}, ${entityType}, ${entityId}, ${JSON.stringify(oldValues || null)}, ${JSON.stringify(newValues || null)}, ${req.ip || null}, ${req.headers["user-agent"] || null})
  `).catch(() => {});
}
