import { Router, Request, Response } from "express";
import { sensorySystem, hearingHub, voiceOutputHub, visionHub, actionHub, brainHub, getAllBridgeStats } from "../../services/sensory";
import { brainPulseBus, type BrainPulseEvent } from "../../services/sensory/BrainPulse";

const router = Router();

// ============================================================
// SSE: real-time brain pulse stream (no polling).
// Any tab/window subscribes once and receives every pulse pushed by the server.
// ============================================================
router.get("/stream", (req: Request, res: Response) => {
  if (!(req as any).isOwner) {
    return res.status(403).json({ error: "Owner access required" });
  }

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Initial snapshot so the brain renders immediately.
  try {
    send("snapshot", {
      counters: brainPulseBus.getCounters(),
      recent: brainPulseBus.getRecent(50),
      stats: sensorySystem.getStats(),
    });
  } catch { /* best-effort */ }

  const onPulse = (evt: BrainPulseEvent) => {
    try { send("pulse", evt); } catch { /* client likely gone */ }
  };
  brainPulseBus.on("pulse", onPulse);

  // Heartbeat every 25s to keep proxies from closing the connection.
  const heartbeat = setInterval(() => {
    try { res.write(`: ping\n\n`); } catch { /* gone */ }
  }, 25_000);

  const cleanup = () => {
    clearInterval(heartbeat);
    brainPulseBus.off("pulse", onPulse);
    try { res.end(); } catch { /* already closed */ }
  };
  req.on("close", cleanup);
  req.on("aborted", cleanup);
});

function requireOwner(req: Request, res: Response, next: Function) {
  if (!(req as any).isOwner) {
    return res.status(403).json({ error: "Owner access required" });
  }
  next();
}

router.get("/stats", requireOwner, async (_req: Request, res: Response) => {
  try {
    const stats = sensorySystem.getStats();
    const consciousness = brainHub.getConsciousness();
    const brainStats = brainHub.getStats();

    res.json({
      consciousness: {
        currentFocus: consciousness.currentFocus,
        cognitiveLoad: consciousness.cognitiveLoad,
        activeInterface: consciousness.activeInterface,
        activePersona: consciousness.activePersona,
        isProcessing: consciousness.isProcessing,
        workingMemoryItems: consciousness.workingMemory.length,
        lastActivity: consciousness.lastActivity,
        navigationContext: consciousness.navigationContext,
      },
      brain: brainStats,
      hubs: {
        hearing: stats.hearing,
        vision: stats.vision,
        action: stats.action,
        output: stats.output
      },
      totals: {
        totalEvents: stats.totalEvents,
        lastActivity: stats.lastActivity
      }
    });
  } catch (error) {
    console.error("[Sensory API] Stats error:", error);
    res.status(500).json({ error: "Failed to get sensory stats" });
  }
});

router.get("/state", requireOwner, async (_req: Request, res: Response) => {
  try {
    const consciousness = brainHub.getConsciousness();

    res.json({
      focus: consciousness.currentFocus,
      cognitiveLoad: consciousness.cognitiveLoad,
      activeUser: consciousness.activeUserId,
      activePersona: consciousness.activePersona,
      activeInterface: consciousness.activeInterface,
      navigationContext: consciousness.navigationContext,
      isProcessing: consciousness.isProcessing,
      workingMemory: consciousness.workingMemory.slice(-5).map(m => ({
        type: m.type,
        content: m.content.substring(0, 100),
        source: m.source,
        importance: m.importance
      })),
      lastActivity: consciousness.lastActivity
    });
  } catch (error) {
    console.error("[Sensory API] State error:", error);
    res.status(500).json({ error: "Failed to get consciousness state" });
  }
});

router.get("/recent", requireOwner, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const type = req.query.type as string | undefined;
    const validTypes = ["hearing", "vision", "action", "speech"];
    const filterType = type && validTypes.includes(type) ? type as any : undefined;

    const recentEvents = sensorySystem.getRecentEvents(limit, filterType);

    res.json({
      count: recentEvents.length,
      events: recentEvents.map(e => ({
        type: e.type,
        timestamp: e.timestamp,
        userId: e.userId,
        summary: typeof e.data === 'object' && 'originalContent' in e.data
          ? (e.data as any).originalContent?.substring(0, 100)
          : typeof e.data === 'object' && 'text' in e.data
          ? (e.data as any).text?.substring(0, 100)
          : 'action'
      }))
    });
  } catch (error) {
    console.error("[Sensory API] Recent events error:", error);
    res.status(500).json({ error: "Failed to get recent events" });
  }
});

router.get("/health", async (_req: Request, res: Response) => {
  try {
    const consciousness = brainHub.getConsciousness();
    const brainStats = brainHub.getStats();

    const isHealthy =
      consciousness.cognitiveLoad < 80 &&
      brainStats.totalInputs >= 0;

    res.json({
      status: isHealthy ? "healthy" : "degraded",
      uptime: brainStats.uptime,
      cognitiveLoad: consciousness.cognitiveLoad,
      focus: consciousness.currentFocus,
      totalInputs: brainStats.totalInputs,
      totalOutputs: brainStats.totalOutputs,
      totalActions: brainStats.totalActions,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("[Sensory API] Health error:", error);
    res.status(500).json({
      status: "error",
      error: "Failed to check sensory health"
    });
  }
});

router.get("/hearing", requireOwner, async (_req: Request, res: Response) => {
  try {
    const stats = hearingHub.getStats();
    res.json({
      hub: "hearing",
      stats,
      topSources: Object.entries(stats.bySource as Record<string, number>)
        .filter(([_, count]) => count > 0)
        .sort(([, a], [, b]) => (b as number) - (a as number)),
      performance: {
        avgProcessingMs: stats.avgProcessingMs,
        intentDetectionRate: (stats.intentDetectionRate * 100).toFixed(1) + "%",
        referenceResolutionRate: (stats.referenceResolutionRate * 100).toFixed(1) + "%",
      }
    });
  } catch (error) {
    console.error("[Sensory API] Hearing stats error:", error);
    res.status(500).json({ error: "Failed to get hearing stats" });
  }
});

router.get("/vision", requireOwner, async (_req: Request, res: Response) => {
  try {
    const stats = visionHub.getStats();
    res.json({
      hub: "vision",
      stats,
      topSources: Object.entries(stats.bySource as Record<string, number>)
        .filter(([_, count]) => count > 0)
        .sort(([, a], [, b]) => (b as number) - (a as number)),
      performance: {
        avgProcessingMs: stats.avgProcessingMs,
        totalTextExtracted: stats.totalTextExtracted,
        insightsGenerated: stats.insightsGenerated,
      }
    });
  } catch (error) {
    console.error("[Sensory API] Vision stats error:", error);
    res.status(500).json({ error: "Failed to get vision stats" });
  }
});

router.get("/action", requireOwner, async (_req: Request, res: Response) => {
  try {
    const stats = actionHub.getStats();
    const recentHistory = actionHub.getHistory(10);
    res.json({
      hub: "action",
      stats,
      topCategories: Object.entries(stats.byCategory as Record<string, number>)
        .filter(([_, count]) => count > 0)
        .sort(([, a], [, b]) => (b as number) - (a as number)),
      performance: {
        successRate: (stats.successRate * 100).toFixed(1) + "%",
        avgExecutionMs: stats.avgExecutionMs,
        rollbackCount: stats.rollbackCount,
        autonomousActions: stats.autonomousActions,
      },
      recentActions: recentHistory.map(log => ({
        id: log.id,
        name: log.action.name,
        category: log.action.metadata.category,
        success: log.result.success,
        executionMs: log.result.executionMs,
        timestamp: log.timestamp,
      }))
    });
  } catch (error) {
    console.error("[Sensory API] Action stats error:", error);
    res.status(500).json({ error: "Failed to get action stats" });
  }
});

router.get("/output", requireOwner, async (_req: Request, res: Response) => {
  try {
    const stats = voiceOutputHub.getStats();
    res.json({
      hub: "output",
      stats,
      topDestinations: Object.entries(stats.byDestination as Record<string, number>)
        .filter(([_, count]) => count > 0)
        .sort(([, a], [, b]) => (b as number) - (a as number)),
      performance: {
        ttsGenerations: stats.ttsGenerations,
        ttsErrorCount: stats.ttsErrorCount,
        avgTTSDurationMs: stats.avgTTSDurationMs,
        charactersSynthesized: stats.charactersSynthesized,
      }
    });
  } catch (error) {
    console.error("[Sensory API] Output stats error:", error);
    res.status(500).json({ error: "Failed to get output stats" });
  }
});

router.get("/bridges", requireOwner, async (_req: Request, res: Response) => {
  try {
    const bridgeStats = getAllBridgeStats();
    res.json({
      bridges: bridgeStats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("[Sensory API] Bridge stats error:", error);
    res.status(500).json({ error: "Failed to get bridge stats" });
  }
});

router.get("/consciousness", requireOwner, async (_req: Request, res: Response) => {
  try {
    const prompt = brainHub.getConsciousnessPrompt();
    const attention = brainHub.getAttentionStats();
    const navigation = brainHub.getNavigationContext();
    const canProcess = brainHub.canProcess();

    res.json({
      prompt,
      attention,
      navigation,
      canProcess,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("[Sensory API] Consciousness error:", error);
    res.status(500).json({ error: "Failed to get consciousness data" });
  }
});

router.get("/memory", requireOwner, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const type = req.query.type as string | undefined;
    const consciousness = brainHub.getConsciousness();

    let memory = consciousness.workingMemory;
    if (type && ['input', 'output', 'thought', 'context'].includes(type)) {
      memory = memory.filter(m => m.type === type);
    }

    let persistentTotal = 0;
    let projectTotal = 0;
    let connectionsTotal = 0;
    try {
      const { db } = await import("../../db");
      const { ulysseMemory, projectMemory, memoryConnections } = await import("@shared/schema");
      const { sql } = await import("drizzle-orm");
      const [u] = await db.select({ c: sql<number>`count(*)::int` }).from(ulysseMemory);
      const [p] = await db.select({ c: sql<number>`count(*)::int` }).from(projectMemory);
      const [m] = await db.select({ c: sql<number>`count(*)::int` }).from(memoryConnections);
      persistentTotal = u?.c ?? 0;
      projectTotal = p?.c ?? 0;
      connectionsTotal = m?.c ?? 0;
    } catch (e) {
      console.error("[Sensory API] persistent count error:", e);
    }

    try {
      const { sensorySystemService } = await import("../../services/sensory");
      sensorySystemService.recordPulse?.({
        zones: ["hippocampus"],
        intensity: 0.5,
        source: "sensory.memory.read",
        meta: { persistent: persistentTotal },
      });
    } catch {}

    const working = consciousness.workingMemory.length;
    res.json({
      total: persistentTotal + projectTotal + working,
      working,
      persistent: persistentTotal,
      projects: projectTotal,
      connections: connectionsTotal,
      filtered: memory.length,
      items: memory.slice(0, limit).map(m => ({
        type: m.type,
        content: m.content.substring(0, 300),
        source: m.source,
        importance: m.importance,
        timestamp: m.timestamp,
        ttlMs: m.ttlMs,
      }))
    });
  } catch (error) {
    console.error("[Sensory API] Memory error:", error);
    res.status(500).json({ error: "Failed to get working memory" });
  }
});

router.post("/navigation", requireOwner, async (req: Request, res: Response) => {
  try {
    const { pageId, tabId } = req.body;
    if (!pageId) {
      return res.status(400).json({ error: "pageId is required" });
    }

    brainHub.updateNavigationContext(pageId, tabId);
    const updated = brainHub.getNavigationContext();

    res.json({
      success: true,
      navigationContext: updated
    });
  } catch (error) {
    console.error("[Sensory API] Navigation update error:", error);
    res.status(500).json({ error: "Failed to update navigation context" });
  }
});

export default router;
