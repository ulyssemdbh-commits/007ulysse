import express, { Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import { globalOptimizerService } from "../services/globalOptimizerService";
import { ulysseKPIService } from "../services/ulysseKPIService";
import { autoLearningEngine } from "../services/autoLearningEngine";
import { contextOptimizerService } from "../services/context/optimizer";

const router = express.Router();

router.get("/optimizer/stats", requireAuth, async (req: Request, res: Response) => {
  try {
    const globalStats = globalOptimizerService.getStats();
    const contextStats = contextOptimizerService.getCacheStats();
    
    res.json({
      success: true,
      global: {
        cacheSize: globalStats.cacheSize,
        totalHitRate: globalStats.totalHitRate,
        services: globalStats.services
      },
      context: {
        cacheSize: contextStats.size,
        hitRate: contextStats.hitRate,
        domains: contextStats.domains,
        adjustments: contextStats.adjustments
      },
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/ulysse/kpis", requireAuth, async (req: Request, res: Response) => {
  try {
    const snapshot = ulysseKPIService.getSnapshot();
    const learningStats = autoLearningEngine.getStats();
    
    res.json({
      success: true,
      kpis: snapshot,
      learning: learningStats,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/ulysse/kpis/error", requireAuth, async (req: Request, res: Response) => {
  try {
    const { domain, description, severity } = req.body;
    ulysseKPIService.recordFactualError(domain || "general", description, severity || "medium");
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/ulysse/kpis/satisfaction", requireAuth, async (req: Request, res: Response) => {
  try {
    const { type, query, domain, detail } = req.body;
    ulysseKPIService.recordSatisfactionSignal(type, query, domain, detail);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
