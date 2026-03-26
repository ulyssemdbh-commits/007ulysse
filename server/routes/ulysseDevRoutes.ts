import { Router, Request, Response, NextFunction } from "express";
import { codebaseGraphService } from "../services/codebaseGraphService";
import { testBuildCollector } from "../services/testBuildCollector";
import { runtimeErrorCollector } from "../services/runtimeErrorCollector";
import { usageAnalyticsService } from "../services/usageAnalyticsService";
import { perfProfiler } from "../services/perfProfiler";
import { assistantModeService, type DevMode } from "../services/assistantModeService";
import { patchProposalService } from "../services/patchProposalService";
import { styleGuideExtractor } from "../services/styleGuideExtractor";
import { db } from "../db";
import { users, dgmSessions, dgmTasks } from "@shared/schema";
import { eq, sql, asc } from "drizzle-orm";
import path from "path";
import { dgmPipelineOrchestrator } from "../services/dgmPipelineOrchestrator";

const router = Router();

const PROJECT_ROOT = process.cwd();

function getUserId(req: Request): number {
  const userId = (req as any).user?.id || (req.session as any)?.userId;
  if (!userId) {
    throw new Error("User not authenticated");
  }
  return userId;
}

function validateRootDir(rootDir: string): string {
  const resolved = path.resolve(PROJECT_ROOT, rootDir || ".");
  if (!resolved.startsWith(PROJECT_ROOT)) {
    throw new Error("Invalid rootDir: path traversal detected");
  }
  const blocked = ["/etc", "/var", "/usr", "/root", "/home", "/tmp"];
  for (const dir of blocked) {
    if (resolved.startsWith(dir) && !resolved.startsWith(PROJECT_ROOT)) {
      throw new Error("Invalid rootDir: blocked path");
    }
  }
  return resolved;
}

async function requireOwner(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getUserId(req);
    const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user[0]?.isOwner) {
      return res.status(403).json({ error: "Owner access required for Ulysse Dev++ features" });
    }
    next();
  } catch (error: any) {
    return res.status(401).json({ error: error.message || "Unauthorized" });
  }
}

router.post("/internal/vps-exec", async (req: Request, res: Response) => {
  try {
    const internalKey = req.headers["x-internal-key"];
    if (internalKey !== process.env.REPL_ID) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: "command required" });
    const { sshService } = await import("../services/sshService");
    const result = await sshService.executeCommand(command, 120000);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/dgm/internal-trigger", async (req: Request, res: Response) => {
  try {
    const internalKey = req.headers["x-internal-key"];
    if (internalKey !== process.env.REPL_ID) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { objective, repoContext } = req.body;
    const userId = 1;
    if (!repoContext || !objective) {
      return res.status(400).json({ error: "repoContext and objective required" });
    }

    const [session] = await db.insert(dgmSessions).values({
      userId,
      active: true,
      objective,
      repoContext,
      activatedAt: new Date(),
    }).returning();
    console.log(`[DGM] INTERNAL ACTIVATED for user ${userId} on repo ${repoContext}`);
    res.json({ active: true, session });

    (async () => {
      try {
        console.log(`[DGM] Starting objective decomposition for session ${session.id}...`);
        const decomposition = await dgmPipelineOrchestrator.decomposeObjective(objective, repoContext);
        console.log(`[DGM] Decomposed into ${decomposition.tasks.length} tasks (complexity: ${decomposition.estimatedComplexity}, ~${decomposition.estimatedDurationMinutes}min)`);

        const createdTasks = await dgmPipelineOrchestrator.createPipelineTasks(session.id, decomposition);
        console.log(`[DGM] ${createdTasks.length} tasks created in DB for session ${session.id}`);

        const [owner, repo] = repoContext.split("/");
        const config = dgmPipelineOrchestrator.getDefaultConfig({ owner, repo });

        let task = await dgmPipelineOrchestrator.getNextPendingTask(session.id);
        while (task) {
          const [currentSession] = await db.select().from(dgmSessions).where(eq(dgmSessions.id, session.id));
          if (!currentSession?.active) {
            console.log(`[DGM] Session ${session.id} deactivated — stopping pipeline`);
            break;
          }

          console.log(`[DGM] Running pipeline for task ${task.id}: ${task.title}`);
          await db.update(dgmTasks).set({ status: "running" }).where(eq(dgmTasks.id, task.id));
          await db.update(dgmSessions).set({ currentTaskId: task.id }).where(eq(dgmSessions.id, session.id));

          try {
            const result = await dgmPipelineOrchestrator.runFullPipeline(
              session.id, task.id, config, [], `[DGM] ${task.title}`
            );
            const finalStatus = result.finalStatus === "pipeline_complete" || result.finalStatus === "pr_created_awaiting_merge" ? "completed" : "failed";
            await db.update(dgmTasks).set({
              status: finalStatus as any,
              result: result as any,
            }).where(eq(dgmTasks.id, task.id));
            const completedCount = await db.select({ count: sql`count(*)` }).from(dgmTasks)
              .where(sql`${dgmTasks.sessionId} = ${session.id} AND ${dgmTasks.status} = 'completed'`);
            await db.update(dgmSessions).set({
              completedTasks: Number(completedCount[0]?.count || 0),
            }).where(eq(dgmSessions.id, session.id));
            console.log(`[DGM] Task ${task.id} → ${finalStatus} (${result.finalStatus})`);
          } catch (err: any) {
            console.error(`[DGM] Task ${task.id} pipeline error:`, err.message);
            await db.update(dgmTasks).set({ status: "failed" as any }).where(eq(dgmTasks.id, task.id));
          }

          task = await dgmPipelineOrchestrator.getNextPendingTask(session.id);
        }

        console.log(`[DGM] All tasks processed for session ${session.id} — marking complete`);
        await db.update(dgmSessions).set({ active: false, deactivatedAt: new Date() }).where(eq(dgmSessions.id, session.id));
      } catch (err: any) {
        console.error(`[DGM] Pipeline orchestration error:`, err.message);
        await db.update(dgmSessions).set({ active: false, deactivatedAt: new Date() }).where(eq(dgmSessions.id, session.id));
      }
    })();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.use(requireOwner);

// ================================
// CODEBASE GRAPH ROUTES
// ================================

router.post("/codebase/scan", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { rootDir } = req.body;
    const validatedDir = validateRootDir(rootDir);
    const graph = await codebaseGraphService.scanCodebase(userId, validatedDir);
    res.json(graph);
  } catch (error: any) {
    res.status(error.message.includes("path traversal") ? 400 : 500).json({ error: error.message });
  }
});

router.get("/codebase/graph", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const graph = await codebaseGraphService.getLatestGraph(userId);
    if (!graph) {
      return res.status(404).json({ error: "No codebase graph found. Run a scan first." });
    }
    res.json(graph);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/codebase/file/:filePath(*)", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const filePath = req.params.filePath;
    const usage = await codebaseGraphService.getFileUsage(userId, filePath);
    res.json(usage);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/codebase/deps/:filePath(*)", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const filePath = req.params.filePath;
    const depth = parseInt(req.query.depth as string) || 3;
    const tree = await codebaseGraphService.getDependencyTree(userId, filePath, depth);
    res.json(tree);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ================================
// TEST & BUILD ROUTES
// ================================

router.post("/tests/run", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { type } = req.body;
    const run = await testBuildCollector.runTests(userId, type || "vitest");
    res.json(run);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/tests/recent", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const limit = parseInt(req.query.limit as string) || 10;
    const runs = await testBuildCollector.getRecentTestRuns(userId, limit);
    res.json(runs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/builds/run", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { type } = req.body;
    const run = await testBuildCollector.runBuild(userId, type || "typescript");
    res.json(run);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/builds/recent", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const limit = parseInt(req.query.limit as string) || 10;
    const runs = await testBuildCollector.getRecentBuildRuns(userId, limit);
    res.json(runs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ================================
// RUNTIME ERRORS ROUTES
// ================================

router.post("/errors/log", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { source, level, message, stack, url, userAgent, deviceId, persona } = req.body;
    const error = await runtimeErrorCollector.logError(
      source || "backend",
      level || "error",
      message,
      stack,
      userId,
      { url, userAgent, deviceId, persona }
    );
    res.json(error);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/errors/frontend", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const error = await runtimeErrorCollector.logFrontendError({
      ...req.body,
      userId
    });
    res.json(error);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/errors/recent", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { source, limit } = req.query;
    const errors = await runtimeErrorCollector.getRecentErrors(
      userId,
      source as string,
      parseInt(limit as string) || 50
    );
    res.json(errors);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/errors/stats", async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const stats = await runtimeErrorCollector.getErrorStats(days);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/errors/aggregations", async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const aggregations = await runtimeErrorCollector.getErrorAggregations(days);
    res.json(aggregations);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ================================
// USAGE ANALYTICS ROUTES
// ================================

router.post("/usage/track", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { module, feature, persona, durationMs, success, errorMessage, metadata } = req.body;
    const event = await usageAnalyticsService.trackEvent(userId, module, feature, {
      persona,
      durationMs,
      success,
      errorMessage,
      metadata
    });
    res.json(event);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/usage/stats", async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId ? parseInt(req.query.userId as string) : undefined;
    const days = parseInt(req.query.days as string) || 7;
    const stats = await usageAnalyticsService.getUsageStats(userId, days);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/usage/modules", async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const stats = await usageAnalyticsService.getModuleStats(days);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/usage/personas", async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const stats = await usageAnalyticsService.getPersonaStats(days);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/usage/top-features", async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId ? parseInt(req.query.userId as string) : undefined;
    const limit = parseInt(req.query.limit as string) || 10;
    const features = await usageAnalyticsService.getTopFeatures(userId, limit);
    res.json(features);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/usage/failures", async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const failures = await usageAnalyticsService.getFailurePatterns(days);
    res.json(failures);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ================================
// PERFORMANCE PROFILER ROUTES
// ================================

router.get("/perf/api", async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const perf = await perfProfiler.getApiPerf(days);
    res.json(perf);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/perf/db", async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const perf = await perfProfiler.getDbQueryPerf(days);
    res.json(perf);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/perf/slowest-endpoints", async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const endpoints = await perfProfiler.getSlowestEndpoints(limit);
    res.json(endpoints);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/perf/slowest-queries", async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const queries = await perfProfiler.getSlowestQueries(limit);
    res.json(queries);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/perf/stats", async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const stats = await perfProfiler.getOverallStats(days);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ================================
// ASSISTANT MODE ROUTES
// ================================

router.get("/mode", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const mode = await assistantModeService.getMode(userId);
    res.json(mode);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/mode", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { mode, preferences } = req.body;
    
    if (!["ship", "craft", "audit"].includes(mode)) {
      return res.status(400).json({ error: "Invalid mode. Use: ship, craft, or audit" });
    }
    
    const result = await assistantModeService.setMode(userId, mode as DevMode, preferences);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.patch("/mode/preferences", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { preferences } = req.body;
    const result = await assistantModeService.updatePreferences(userId, preferences);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/mode/description/:mode", async (req: Request, res: Response) => {
  try {
    const mode = req.params.mode as DevMode;
    if (!["ship", "craft", "audit"].includes(mode)) {
      return res.status(400).json({ error: "Invalid mode" });
    }
    const description = assistantModeService.getModeDescription(mode);
    res.json({ mode, description });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ================================
// DEV GOD MODE (DGM) ROUTES
// ================================

router.get("/dgm/status", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const repo = req.query.repo as string | undefined;

    if (repo) {
      const [session] = await db.select().from(dgmSessions)
        .where(sql`${dgmSessions.userId} = ${userId} AND ${dgmSessions.repoContext} = ${repo}`)
        .orderBy(sql`${dgmSessions.id} DESC`).limit(1);
      if (!session) {
        return res.json({ active: false, session: null, tasks: [], repo });
      }
      const tasks = session.active
        ? await db.select().from(dgmTasks).where(eq(dgmTasks.sessionId, session.id)).orderBy(sql`${dgmTasks.sortOrder} ASC`)
        : [];
      return res.json({ active: session.active, session, tasks, repo });
    }

    const sessions = await db.select().from(dgmSessions)
      .where(sql`${dgmSessions.userId} = ${userId} AND ${dgmSessions.active} = true`)
      .orderBy(sql`${dgmSessions.id} DESC`);
    res.json({
      active: sessions.length > 0,
      sessions: sessions.map(s => ({ id: s.id, repo: s.repoContext, objective: s.objective, totalTasks: s.totalTasks, completedTasks: s.completedTasks })),
      count: sessions.length,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/dgm/toggle", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { active, objective, repoContext } = req.body;

    if (!repoContext) {
      return res.status(400).json({ error: "repoContext requis — DGM est independant par repo" });
    }

    const [existing] = await db.select().from(dgmSessions)
      .where(sql`${dgmSessions.userId} = ${userId} AND ${dgmSessions.repoContext} = ${repoContext}`)
      .orderBy(sql`${dgmSessions.id} DESC`).limit(1);

    if (active) {
      if (existing?.active) {
        return res.json({ active: true, session: existing, message: "DGM deja actif pour ce repo" });
      }
      const [session] = await db.insert(dgmSessions).values({
        userId,
        active: true,
        objective: objective || null,
        repoContext,
        activatedAt: new Date(),
      }).returning();
      console.log(`[DGM] ACTIVATED for user ${userId} on repo ${repoContext} — objective: ${objective || "none"}`);
      res.json({ active: true, session });

      if (objective && objective.trim()) {
        (async () => {
          try {
            console.log(`[DGM] Starting objective decomposition for session ${session.id}...`);
            const decomposition = await dgmPipelineOrchestrator.decomposeObjective(objective, repoContext);
            console.log(`[DGM] Decomposed into ${decomposition.tasks.length} tasks (complexity: ${decomposition.estimatedComplexity}, ~${decomposition.estimatedDurationMinutes}min)`);

            const createdTasks = await dgmPipelineOrchestrator.createPipelineTasks(session.id, decomposition);
            console.log(`[DGM] ${createdTasks.length} tasks created in DB for session ${session.id}`);

            const [owner, repo] = repoContext.split("/");
            const config = dgmPipelineOrchestrator.getDefaultConfig({ owner, repo });

            let task = await dgmPipelineOrchestrator.getNextPendingTask(session.id);
            while (task) {
              const [currentSession] = await db.select().from(dgmSessions).where(eq(dgmSessions.id, session.id));
              if (!currentSession?.active) {
                console.log(`[DGM] Session ${session.id} deactivated — stopping pipeline`);
                break;
              }

              console.log(`[DGM] Running pipeline for task ${task.id}: ${task.title}`);
              await db.update(dgmTasks).set({ status: "running" }).where(eq(dgmTasks.id, task.id));
              await db.update(dgmSessions).set({ currentTaskId: task.id }).where(eq(dgmSessions.id, session.id));

              try {
                const result = await dgmPipelineOrchestrator.runFullPipeline(
                  session.id, task.id, config, [], `[DGM] ${task.title}`
                );
                const finalStatus = result.finalStatus === "pipeline_complete" || result.finalStatus === "pr_created_awaiting_merge" ? "completed" : "failed";
                await db.update(dgmTasks).set({ status: finalStatus, pipelineStage: result.finalStatus }).where(eq(dgmTasks.id, task.id));

                if (finalStatus === "completed") {
                  await db.update(dgmSessions).set({
                    completedTasks: sql`${dgmSessions.completedTasks} + 1`,
                  }).where(eq(dgmSessions.id, session.id));
                }
                console.log(`[DGM] Task ${task.id} → ${finalStatus} (${result.finalStatus})`);
              } catch (taskErr: any) {
                console.error(`[DGM] Task ${task.id} crashed:`, taskErr.message);
                await db.update(dgmTasks).set({ status: "failed", pipelineStage: "failed" }).where(eq(dgmTasks.id, task.id));
              }

              task = await dgmPipelineOrchestrator.getNextPendingTask(session.id);
            }

            const remaining = await dgmPipelineOrchestrator.getNextPendingTask(session.id);
            if (!remaining) {
              console.log(`[DGM] All tasks processed for session ${session.id} — marking complete`);
              await db.update(dgmSessions).set({ active: false, deactivatedAt: new Date() }).where(eq(dgmSessions.id, session.id));
            }
          } catch (err: any) {
            console.error(`[DGM] Pipeline orchestration failed for session ${session.id}:`, err.message);
          }
        })();
      }
    } else {
      if (existing?.active) {
        const [updated] = await db.update(dgmSessions)
          .set({ active: false, deactivatedAt: new Date() })
          .where(eq(dgmSessions.id, existing.id))
          .returning();
        console.log(`[DGM] DEACTIVATED for user ${userId} on repo ${repoContext}`);
        res.json({ active: false, session: updated });
      } else {
        res.json({ active: false, session: existing || null });
      }
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/dgm/tasks/:sessionId", async (req: Request, res: Response) => {
  try {
    const sessionId = parseInt(req.params.sessionId);
    const tasks = await db.select().from(dgmTasks).where(eq(dgmTasks.sessionId, sessionId)).orderBy(sql`${dgmTasks.sortOrder} ASC`);
    res.json(tasks);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/dgm/tasks", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { sessionId, tasks } = req.body;
    if (!sessionId || !tasks?.length) {
      return res.status(400).json({ error: "sessionId and tasks[] required" });
    }
    const created = [];
    for (let i = 0; i < tasks.length; i++) {
      const [task] = await db.insert(dgmTasks).values({
        sessionId,
        sortOrder: i,
        title: tasks[i].title,
        description: tasks[i].description || null,
        testCriteria: tasks[i].testCriteria || null,
      }).returning();
      created.push(task);
    }
    await db.update(dgmSessions).set({ totalTasks: tasks.length }).where(eq(dgmSessions.id, sessionId));
    res.json({ created, count: created.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.patch("/dgm/tasks/:taskId", async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.taskId);
    const updates: any = {};
    if (req.body.status) updates.status = req.body.status;
    if (req.body.testResult !== undefined) updates.testResult = req.body.testResult;
    if (req.body.codeChanges !== undefined) updates.codeChanges = req.body.codeChanges;
    if (req.body.error !== undefined) updates.error = req.body.error;

    if (req.body.status === "running") updates.startedAt = new Date();
    if (req.body.status === "completed") updates.completedAt = new Date();
    if (req.body.status === "tested") {
      updates.testedAt = new Date();
      updates.status = "tested";
    }

    const [updated] = await db.update(dgmTasks).set(updates).where(eq(dgmTasks.id, taskId)).returning();

    if (updated && (updated.status === "tested" || updated.status === "completed")) {
      const [session] = await db.select().from(dgmSessions).where(eq(dgmSessions.id, updated.sessionId)).limit(1);
      if (session) {
        const completedCount = await db.select({ count: sql<number>`count(*)` }).from(dgmTasks)
          .where(sql`${dgmTasks.sessionId} = ${session.id} AND ${dgmTasks.status} IN ('tested', 'completed')`);
        const count = Number(completedCount[0]?.count || 0);
        await db.update(dgmSessions).set({ completedTasks: count, currentTaskId: taskId }).where(eq(dgmSessions.id, session.id));
      }
    }

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ================================
// PATCH PROPOSAL ROUTES
// ================================

router.post("/patches", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { title, description, changes } = req.body;
    
    if (!title || !changes || !Array.isArray(changes)) {
      return res.status(400).json({ error: "title and changes[] required" });
    }
    
    const patch = await patchProposalService.createPatch(userId, title, description || "", changes);
    res.json(patch);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/patches", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const limit = parseInt(req.query.limit as string) || 20;
    const patches = await patchProposalService.getRecentPatches(userId, limit);
    res.json(patches);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/patches/pending", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const patches = await patchProposalService.getPendingPatches(userId);
    res.json(patches);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/patches/:id/apply", async (req: Request, res: Response) => {
  try {
    const patchId = parseInt(req.params.id);
    const result = await patchProposalService.applyPatch(patchId);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/patches/:id/reject", async (req: Request, res: Response) => {
  try {
    const patchId = parseInt(req.params.id);
    const { reason } = req.body;
    const result = await patchProposalService.rejectPatch(patchId, reason);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/patches/preview", async (req: Request, res: Response) => {
  try {
    const { changes } = req.body;
    
    if (!changes || !Array.isArray(changes)) {
      return res.status(400).json({ error: "changes[] required" });
    }
    
    const diff = await patchProposalService.previewPatch(changes);
    res.json({ diff });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ================================
// STYLE GUIDE ROUTES
// ================================

router.post("/style-guide/extract", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { rootDir } = req.body;
    const validatedDir = validateRootDir(rootDir);
    const guide = await styleGuideExtractor.extractStyleGuide(userId, validatedDir);
    res.json(guide);
  } catch (error: any) {
    res.status(error.message.includes("path traversal") ? 400 : 500).json({ error: error.message });
  }
});

router.get("/style-guide", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const guide = await styleGuideExtractor.getLatestStyleGuide(userId);
    if (!guide) {
      return res.status(404).json({ error: "No style guide found. Run extraction first." });
    }
    res.json(guide);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ================================
// UNIFIED INSIGHTS ENDPOINT
// ================================

router.get("/insights", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const days = parseInt(req.query.days as string) || 7;
    
    const [
      testRuns,
      buildRuns,
      errorStats,
      usageStats,
      personaStats,
      perfStats,
      slowEndpoints,
      slowQueries,
      mode,
      patches,
      styleGuide
    ] = await Promise.all([
      testBuildCollector.getRecentTestRuns(userId, 5),
      testBuildCollector.getRecentBuildRuns(userId, 5),
      runtimeErrorCollector.getErrorStats(days),
      usageAnalyticsService.getUsageStats(userId, days),
      usageAnalyticsService.getPersonaStats(days),
      perfProfiler.getOverallStats(days),
      perfProfiler.getSlowestEndpoints(5),
      perfProfiler.getSlowestQueries(5),
      assistantModeService.getMode(userId),
      patchProposalService.getPendingPatches(userId),
      styleGuideExtractor.getLatestStyleGuide(userId)
    ]);
    
    res.json({
      mode,
      tests: {
        recent: testRuns,
        summary: testBuildCollector.getTestSummaryForPrompt(testRuns)
      },
      builds: {
        recent: buildRuns,
        summary: testBuildCollector.getBuildSummaryForPrompt(buildRuns)
      },
      errors: {
        stats: errorStats,
        summary: runtimeErrorCollector.getErrorSummaryForPrompt(errorStats)
      },
      usage: {
        stats: usageStats,
        personas: personaStats,
        summary: usageAnalyticsService.getUsageSummaryForPrompt(usageStats, personaStats)
      },
      performance: {
        stats: perfStats,
        slowEndpoints,
        slowQueries,
        summary: perfProfiler.getPerfSummaryForPrompt(slowEndpoints, slowQueries, perfStats)
      },
      patches: {
        pending: patches,
        summary: patchProposalService.getPatchSummaryForPrompt(patches)
      },
      styleGuide: {
        guide: styleGuide,
        summary: styleGuideExtractor.getStyleGuideForPrompt(styleGuide)
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ================================
// PROMPT BUILDER ENDPOINT
// ================================

router.get("/prompt-context", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    
    const [
      testRuns,
      buildRuns,
      errorStats,
      usageStats,
      personaStats,
      perfStats,
      slowEndpoints,
      slowQueries,
      modeInfo,
      patches,
      styleGuide
    ] = await Promise.all([
      testBuildCollector.getRecentTestRuns(userId, 5),
      testBuildCollector.getRecentBuildRuns(userId, 5),
      runtimeErrorCollector.getErrorStats(7),
      usageAnalyticsService.getUsageStats(userId, 7),
      usageAnalyticsService.getPersonaStats(7),
      perfProfiler.getOverallStats(7),
      perfProfiler.getSlowestEndpoints(5),
      perfProfiler.getSlowestQueries(5),
      assistantModeService.getMode(userId),
      patchProposalService.getPendingPatches(userId),
      styleGuideExtractor.getLatestStyleGuide(userId)
    ]);

    const modePrompt = assistantModeService.getPromptModifier(modeInfo.mode, modeInfo.preferences);
    
    let context = `\n=== ULYSSE DEV++ CONTEXT ===\n`;
    context += modePrompt;
    context += `\n\n--- TESTS & BUILD ---\n`;
    context += testBuildCollector.getTestSummaryForPrompt(testRuns);
    context += '\n';
    context += testBuildCollector.getBuildSummaryForPrompt(buildRuns);
    context += `\n\n--- ERREURS ---\n`;
    context += runtimeErrorCollector.getErrorSummaryForPrompt(errorStats);
    context += `\n\n--- USAGE ---\n`;
    context += usageAnalyticsService.getUsageSummaryForPrompt(usageStats, personaStats);
    context += `\n\n--- PERFORMANCE ---\n`;
    context += perfProfiler.getPerfSummaryForPrompt(slowEndpoints, slowQueries, perfStats);
    context += `\n\n--- PATCHES EN ATTENTE ---\n`;
    context += patchProposalService.getPatchSummaryForPrompt(patches);
    context += `\n\n--- STYLE GUIDE ---\n`;
    context += styleGuideExtractor.getStyleGuideForPrompt(styleGuide);
    context += `\n=== FIN ULYSSE DEV++ CONTEXT ===\n`;
    
    res.json({ context });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
