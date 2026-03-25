import { Router, Request, Response } from "express";
import { suguAnalyticsService } from "../../services/suguAnalyticsService";

const router = Router();

// Get unified dashboard
router.get("/dashboard", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const dashboard = await suguAnalyticsService.getDashboard();
    res.json(dashboard);
  } catch (error) {
    console.error("[API] Error getting SUGU dashboard:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get insights
router.get("/insights", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const days = parseInt(req.query.days as string) || 30;
    const insights = await suguAnalyticsService.generateInsights(days);
    res.json(insights);
  } catch (error) {
    console.error("[API] Error getting SUGU insights:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get rotation analysis
router.get("/rotation/:store", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const store = req.params.store as "suguval" | "sugumaillane";
    if (!["suguval", "sugumaillane"].includes(store)) {
      return res.status(400).json({ error: "Invalid store" });
    }

    const days = parseInt(req.query.days as string) || 30;
    const rotation = await suguAnalyticsService.analyzeRotation(store, days);
    res.json(rotation);
  } catch (error) {
    console.error("[API] Error getting rotation analysis:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get stockout analysis
router.get("/stockouts/:store", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const store = req.params.store as "suguval" | "sugumaillane";
    if (!["suguval", "sugumaillane"].includes(store)) {
      return res.status(400).json({ error: "Invalid store" });
    }

    const days = parseInt(req.query.days as string) || 30;
    const stockouts = await suguAnalyticsService.analyzeStockouts(store, days);
    res.json(stockouts);
  } catch (error) {
    console.error("[API] Error getting stockout analysis:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get category performance
router.get("/categories/:store", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const store = req.params.store as "suguval" | "sugumaillane";
    if (!["suguval", "sugumaillane"].includes(store)) {
      return res.status(400).json({ error: "Invalid store" });
    }

    const days = parseInt(req.query.days as string) || 30;
    const categories = await suguAnalyticsService.analyzeCategoryPerformance(store, days);
    res.json(categories);
  } catch (error) {
    console.error("[API] Error getting category performance:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Trigger daily analysis manually
router.post("/analyze", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || req.user?.id;
    if (!userId || !req.user?.isOwner) {
      return res.status(403).json({ error: "Owner access required" });
    }

    await suguAnalyticsService.runDailyAnalysis();
    res.json({ success: true, message: "Daily analysis completed" });
  } catch (error) {
    console.error("[API] Error running daily analysis:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
