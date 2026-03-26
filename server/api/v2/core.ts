import { Router, Request, Response } from "express";
import { ulysseCoreEngine, CoreContext, CoreRequest } from "../../services/core";

const router = Router();

router.get("/stats", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const isOwner = (req as any).isOwner;
    
    if (!isOwner) {
      return res.status(403).json({ error: "Owner access required" });
    }

    const stats = ulysseCoreEngine.getStats();
    const evolutionReport = await ulysseCoreEngine.getEvolutionReport();

    res.json({
      engine: {
        totalRequests: stats.totalRequests,
        cacheHits: stats.cacheHits,
        patternMatches: stats.patternMatches,
        learnedResponses: stats.learnedResponses,
        providerCalls: stats.providerCalls,
        errorCount: stats.errorCount,
        avgLatencyMs: Math.round(stats.avgLatencyMs),
        cacheHitRate: Math.round(stats.cacheHitRate * 100),
        localProcessingRate: Math.round(stats.localProcessingRate * 100),
        providerDependency: Math.round(stats.providerDependency * 100)
      },
      evolution: {
        learningProgress: evolutionReport.learningProgress,
        patternsDiscovered: evolutionReport.patternsDiscovered,
        autonomyLevel: evolutionReport.autonomyLevel,
        recommendations: evolutionReport.recommendations
      },
      providers: {
        primary: 'openai',
        fallback: 'gemini',
        localEnabled: false
      }
    });
  } catch (error: any) {
    console.error("[CoreAPI] Stats error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/test", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const isOwner = (req as any).isOwner;
    
    if (!isOwner) {
      return res.status(403).json({ error: "Owner access required" });
    }

    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Message required" });
    }

    const context: CoreContext = {
      userId,
      persona: 'ulysse',
      hasFamilyAccess: true
    };

    const request: CoreRequest = {
      message,
      context
    };

    const startTime = Date.now();
    const response = await ulysseCoreEngine.process(request);
    const latency = Date.now() - startTime;

    res.json({
      response: response.content,
      source: response.source,
      provider: response.provider,
      confidence: response.confidence,
      latencyMs: latency,
      metadata: response.metadata
    });
  } catch (error: any) {
    console.error("[CoreAPI] Test error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/config/provider", async (req: Request, res: Response) => {
  try {
    const isOwner = (req as any).isOwner;
    
    if (!isOwner) {
      return res.status(403).json({ error: "Owner access required" });
    }

    const { provider, priority, enabled } = req.body;
    
    if (priority !== undefined) {
      ulysseCoreEngine.setProviderPriority(provider, priority);
    }
    
    if (enabled !== undefined) {
      ulysseCoreEngine.enableProvider(provider, enabled);
    }

    res.json({ success: true, message: `Provider ${provider} updated` });
  } catch (error: any) {
    console.error("[CoreAPI] Config error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/evolution", async (req: Request, res: Response) => {
  try {
    const isOwner = (req as any).isOwner;
    
    if (!isOwner) {
      return res.status(403).json({ error: "Owner access required" });
    }

    const report = await ulysseCoreEngine.getEvolutionReport();
    
    res.json({
      ...report,
      timestamp: new Date().toISOString(),
      goal: "100% autonomie - zéro dépendance provider"
    });
  } catch (error: any) {
    console.error("[CoreAPI] Evolution error:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
