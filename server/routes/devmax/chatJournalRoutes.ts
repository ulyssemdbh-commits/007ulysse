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

  async function verifyProjectAccess(session: any, projectId: string): Promise<boolean> {
  if (!session.tenantId) return true;
  if (!projectId) return true;
  const result = await db.execute(sql`SELECT tenant_id FROM devmax_projects WHERE id = ${projectId}`).then((r: any) => r.rows || r);
  if (!result.length) return false;
  return !result[0].tenant_id || result[0].tenant_id === session.tenantId;
}

router.post("/chat/save", async (req: Request, res: Response) => {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const [session] = await db.select().from(devmaxSessions)
      .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
      .limit(1);
    if (!session) return res.status(401).json({ error: "Session expired" });

    const { projectId, threadId, role, content, toolCalls, metadata } = req.body;
    if (!role || !content) return res.status(400).json({ error: "role et content requis" });
    if (projectId && !(await verifyProjectAccess(session, projectId))) return res.status(403).json({ error: "Accès refusé à ce projet" });

    const truncContent = content.length > 50000 ? content.substring(0, 50000) : content;

    await db.execute(sql`
      INSERT INTO devmax_chat_history (project_id, session_id, thread_id, role, content, tool_calls, metadata)
      VALUES (${projectId || null}, ${token}, ${threadId || null}, ${role}, ${truncContent}, 
        ${toolCalls ? JSON.stringify(toolCalls) : null}::jsonb, 
        ${metadata ? JSON.stringify(metadata) : null}::jsonb)
    `);

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/chat/history/:projectId", async (req: Request, res: Response) => {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const [session] = await db.select().from(devmaxSessions)
      .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
      .limit(1);
    if (!session) return res.status(401).json({ error: "Session expired" });

    const { projectId } = req.params;
    if (!(await verifyProjectAccess(session, projectId))) return res.status(403).json({ error: "Accès refusé à ce projet" });
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = parseInt(req.query.offset as string) || 0;

    const rows = await db.execute(sql`
      SELECT id, project_id, thread_id, role, content, tool_calls, metadata, created_at
      FROM devmax_chat_history 
      WHERE project_id = ${projectId}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `).then((r: any) => r.rows || r);

    const total = await db.execute(sql`
      SELECT COUNT(*) as count FROM devmax_chat_history WHERE project_id = ${projectId}
    `).then((r: any) => {
      const rows = r.rows || r;
      return parseInt(rows[0]?.count || "0", 10);
    });

    res.json({ messages: rows.reverse(), total, limit, offset });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/chat/threads/:projectId", async (req: Request, res: Response) => {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const [session] = await db.select().from(devmaxSessions)
      .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
      .limit(1);
    if (!session) return res.status(401).json({ error: "Session expired" });

    const { projectId } = req.params;
    if (!(await verifyProjectAccess(session, projectId))) return res.status(403).json({ error: "Accès refusé à ce projet" });
    const rows = await db.execute(sql`
      SELECT thread_id, 
             MIN(created_at) as started_at, 
             MAX(created_at) as last_message_at,
             COUNT(*) as message_count,
             (SELECT content FROM devmax_chat_history c2 WHERE c2.thread_id = c.thread_id AND c2.project_id = ${projectId} AND c2.role = 'user' ORDER BY c2.created_at ASC LIMIT 1) as first_message
      FROM devmax_chat_history c
      WHERE project_id = ${projectId} AND thread_id IS NOT NULL
      GROUP BY thread_id
      ORDER BY last_message_at DESC
      LIMIT 50
    `).then((r: any) => r.rows || r);

    res.json({ threads: rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/journal/add", async (req: Request, res: Response) => {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const [session] = await db.select().from(devmaxSessions)
      .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
      .limit(1);
    if (!session) return res.status(401).json({ error: "Session expired" });

    const { projectId, entryType, title, description, filesChanged, metadata } = req.body;
    if (!projectId || !entryType || !title) return res.status(400).json({ error: "projectId, entryType et title requis" });
    if (!(await verifyProjectAccess(session, projectId))) return res.status(403).json({ error: "Accès refusé à ce projet" });

    const filesArr = Array.isArray(filesChanged) ? filesChanged : null;

    await db.execute(sql`
      INSERT INTO devmax_project_journal (project_id, session_id, entry_type, title, description, files_changed, metadata)
      VALUES (${projectId}, ${token}, ${entryType}, ${title}, ${description || null}, 
        ${filesArr}::text[],
        ${metadata ? JSON.stringify(metadata) : null}::jsonb)
    `);

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/journal/:projectId", async (req: Request, res: Response) => {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const [session] = await db.select().from(devmaxSessions)
      .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
      .limit(1);
    if (!session) return res.status(401).json({ error: "Session expired" });

    const { projectId } = req.params;
    if (!(await verifyProjectAccess(session, projectId))) return res.status(403).json({ error: "Accès refusé à ce projet" });
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const entryType = req.query.type as string;

    const conditions: ReturnType<typeof sql>[] = [sql`project_id = ${projectId}`];
    if (entryType) conditions.push(sql`entry_type = ${entryType}`);
    const whereClause = sql.join(conditions, sql` AND `);
    const rows = await db.execute(sql`SELECT * FROM devmax_project_journal WHERE ${whereClause} ORDER BY created_at DESC LIMIT ${limit}`).then((r: any) => r.rows || r);

    res.json({ entries: rows, total: rows.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

const PLAN_LIMITS: Record<string, { max_projects: number; max_users: number; max_deploys_month: number; max_storage_gb: number; custom_domain: boolean; api_access: boolean }> = {
  free: { max_projects: 3, max_users: 2, max_deploys_month: 10, max_storage_gb: 1, custom_domain: false, api_access: false },
  starter: { max_projects: 10, max_users: 5, max_deploys_month: 50, max_storage_gb: 5, custom_domain: true, api_access: false },
  pro: { max_projects: 50, max_users: 20, max_deploys_month: 500, max_storage_gb: 50, custom_domain: true, api_access: true },
  enterprise: { max_projects: 999, max_users: 999, max_deploys_month: 9999, max_storage_gb: 500, custom_domain: true, api_access: true },
};


  export default router;
  