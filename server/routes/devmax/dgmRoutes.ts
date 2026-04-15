import { Router, Request, Response } from "express";
  import { db } from "../../db";
  import { dgmSessions, dgmTasks, dgmPipelineRuns } from "@shared/schema";
  import { eq, desc } from "drizzle-orm";
  import { sql } from "drizzle-orm";
  
  const router = Router();

  router.get("/dgm/sessions", async (req: Request, res: Response) => {
  try {
    const projectId = req.headers["x-devmax-project"] as string;
    const project = projectId ? await db.execute(sql`SELECT repo_owner, repo_name FROM devmax_projects WHERE id = ${projectId}`) : null;
    const repoContext = project?.rows?.[0] ? `${project.rows[0].repo_owner}/${project.rows[0].repo_name}` : null;

    let sessions;
    if (repoContext) {
      sessions = await db.select().from(dgmSessions).where(eq(dgmSessions.repoContext, repoContext)).orderBy(desc(dgmSessions.createdAt)).limit(20);
    } else {
      sessions = await db.select().from(dgmSessions).orderBy(desc(dgmSessions.createdAt)).limit(20);
    }
    res.json(sessions);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

async function verifyDgmSessionAccess(req: Request, res: Response): Promise<{ sessionId: number; session: any } | null> {
  const sessionId = parseInt(req.params.sessionId);
  if (isNaN(sessionId)) { res.status(400).json({ error: "Session ID invalide" }); return null; }
  const [session] = await db.select().from(dgmSessions).where(eq(dgmSessions.id, sessionId));
  if (!session) { res.status(404).json({ error: "Session introuvable" }); return null; }
  const projectId = req.headers["x-devmax-project"] as string;
  if (projectId && session.repoContext) {
    const project = await db.execute(sql`SELECT repo_owner, repo_name FROM devmax_projects WHERE id = ${projectId}`);
    const row = project?.rows?.[0] as any;
    if (row) {
      const repoContext = `${row.repo_owner}/${row.repo_name}`;
      if (session.repoContext !== repoContext) { res.status(403).json({ error: "Accès refusé à cette session DGM" }); return null; }
    }
  }
  return { sessionId, session };
}

router.get("/dgm/sessions/:sessionId/tasks", async (req: Request, res: Response) => {
  try {
    const access = await verifyDgmSessionAccess(req, res);
    if (!access) return;
    const tasks = await db.select().from(dgmTasks).where(eq(dgmTasks.sessionId, access.sessionId)).orderBy(dgmTasks.sortOrder);
    res.json(tasks);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/dgm/sessions/:sessionId/pipeline", async (req: Request, res: Response) => {
  try {
    const access = await verifyDgmSessionAccess(req, res);
    if (!access) return;
    const runs = await db.select().from(dgmPipelineRuns).where(eq(dgmPipelineRuns.sessionId, access.sessionId)).orderBy(desc(dgmPipelineRuns.createdAt)).limit(50);
    res.json(runs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/dgm/sessions/:sessionId/toggle", async (req: Request, res: Response) => {
  try {
    const access = await verifyDgmSessionAccess(req, res);
    if (!access) return;
    const newActive = !access.session.active;
    await db.update(dgmSessions).set({
      active: newActive,
      ...(newActive ? { activatedAt: new Date() } : { deactivatedAt: new Date() }),
    }).where(eq(dgmSessions.id, access.sessionId));
    res.json({ success: true, active: newActive });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});


  export default router;
  