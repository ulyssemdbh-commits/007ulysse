import { Router, Request, Response } from "express";
import { sensorySystem, hearingHub, voiceOutputHub, visionHub, actionHub, brainHub } from "../../services/sensory";

const router = Router();

router.get("/stats", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const isOwner = (req as any).isOwner;
    
    if (!isOwner) {
      return res.status(403).json({ error: "Owner access required" });
    }
    
    const stats = sensorySystem.getStats();
    const consciousness = brainHub.getConsciousness();
    const brainStats = brainHub.getStats();
    
    res.json({
      consciousness: {
        currentFocus: consciousness.currentFocus,
        cognitiveLoad: consciousness.cognitiveLoad,
        activeInterface: consciousness.activeInterface,
        isProcessing: consciousness.isProcessing,
        workingMemoryItems: consciousness.workingMemory.length,
        lastActivity: consciousness.lastActivity
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

router.get("/state", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const isOwner = (req as any).isOwner;
    
    if (!isOwner) {
      return res.status(403).json({ error: "Owner access required" });
    }
    
    const consciousness = brainHub.getConsciousness();
    
    res.json({
      focus: consciousness.currentFocus,
      cognitiveLoad: consciousness.cognitiveLoad,
      activeUser: consciousness.activeUserId,
      activePersona: consciousness.activePersona,
      activeInterface: consciousness.activeInterface,
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

router.get("/recent", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const isOwner = (req as any).isOwner;
    
    if (!isOwner) {
      return res.status(403).json({ error: "Owner access required" });
    }
    
    const limit = parseInt(req.query.limit as string) || 20;
    const recentEvents = sensorySystem.getRecentEvents(limit);
    
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

router.get("/health", async (req: Request, res: Response) => {
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

export default router;
