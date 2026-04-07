import { Router, Request, Response } from "express";
import { suguAnalyticsService } from "../../services/suguAnalyticsService";
import { betsTrackerService } from "../../services/betsTrackerService";
import { ulysseKPIService } from "../../services/ulysseKPIService";
import { predictiveIntelligenceService } from "../../services/predictiveIntelligenceService";
import { suguProactiveService } from "../../services/suguProactiveService";
import { db } from "../../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

const router = Router();

function getUserRole(req: Request): { userId: number; isOwner: boolean; role: string } {
  const userId = (req as any).userId;
  const isOwner = (req as any).isOwner || false;
  const user = (req as any).user;
  const role = user?.role || (isOwner ? "owner" : "approved");
  return { userId, isOwner, role };
}

router.get("/overview", async (req: Request, res: Response) => {
  try {
    const { userId, isOwner, role } = getUserRole(req);
    if (!userId) return res.status(401).json({ error: "Authentication required" });

    const [suguDashboard, systemKPIs] = await Promise.all([
      (isOwner || role === "suguval_only" || role === "sugumaillane_only")
        ? suguAnalyticsService.getDashboard() : null,
      isOwner ? ulysseKPIService.getSnapshot() : null,
    ]);

    let sportsStats = null;
    if (isOwner) {
      try {
        sportsStats = await betsTrackerService.getStats(userId, 30);
      } catch {}
    }

    let hubriseData = null;
    if (isOwner || role === "suguval_only") {
      try {
        const { hubriseService } = await import("../../services/hubriseService");
        hubriseData = await hubriseService.getOrdersSummary();
      } catch {}
    }

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      restaurants: suguDashboard,
      sports: sportsStats,
      hubrise: hubriseData ? {
        totalOrders: hubriseData.totalOrders,
        totalRevenue: hubriseData.totalRevenue,
        avgTicket: hubriseData.avgTicket,
      } : null,
      system: systemKPIs ? {
        healthScore: systemKPIs.overallHealth.score,
        healthGrade: systemKPIs.overallHealth.grade,
        avgLatency: systemKPIs.kpi1_latency.globalAvg,
        toolSuccessRate: systemKPIs.kpi2_toolSuccess.globalSuccessRate,
        satisfactionScore: systemKPIs.kpi5_satisfaction.overallScore,
      } : null,
      role,
    });
  } catch (error: any) {
    console.error("[UnifiedAnalytics] Overview error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/restaurants", async (req: Request, res: Response) => {
  try {
    const { userId, isOwner, role } = getUserRole(req);
    if (!userId) return res.status(401).json({ error: "Authentication required" });
    if (!isOwner && role !== "suguval_only" && role !== "sugumaillane_only") {
      return res.status(403).json({ error: "Access denied" });
    }

    const days = parseInt(req.query.days as string) || 30;

    const [dashboard, insights, rotationVal, rotationMail, categoriesVal, categoriesMail] = await Promise.all([
      suguAnalyticsService.getDashboard(),
      suguAnalyticsService.generateInsights(days),
      (isOwner || role === "suguval_only") ? suguAnalyticsService.analyzeRotation("suguval", days) : [],
      (isOwner || role === "sugumaillane_only") ? suguAnalyticsService.analyzeRotation("sugumaillane", days) : [],
      (isOwner || role === "suguval_only") ? suguAnalyticsService.analyzeCategoryPerformance("suguval", days) : [],
      (isOwner || role === "sugumaillane_only") ? suguAnalyticsService.analyzeCategoryPerformance("sugumaillane", days) : [],
    ]);

    res.json({
      success: true,
      dashboard,
      insights,
      rotation: {
        valentine: rotationVal,
        maillane: rotationMail,
      },
      categories: {
        valentine: categoriesVal,
        maillane: categoriesMail,
      },
      period: `${days} days`,
    });
  } catch (error: any) {
    console.error("[UnifiedAnalytics] Restaurants error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/sports", async (req: Request, res: Response) => {
  try {
    const { userId, isOwner } = getUserRole(req);
    if (!userId) return res.status(401).json({ error: "Authentication required" });
    if (!isOwner) return res.status(403).json({ error: "Owner access required" });

    const days = parseInt(req.query.days as string) || 30;

    const [stats, byType, byLeague, byBookmaker, byOdds] = await Promise.all([
      betsTrackerService.getStats(userId, days),
      betsTrackerService.getStatsByBetType(userId, days),
      betsTrackerService.getStatsByLeague(userId, days),
      betsTrackerService.getStatsByBookmaker(userId, days),
      betsTrackerService.getStatsByOddsRange(userId, days),
    ]);

    res.json({
      success: true,
      overall: stats,
      byType,
      byLeague,
      byBookmaker,
      byOddsRange: byOdds,
      period: `${days} days`,
    });
  } catch (error: any) {
    console.error("[UnifiedAnalytics] Sports error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/system", async (req: Request, res: Response) => {
  try {
    const { userId, isOwner } = getUserRole(req);
    if (!userId) return res.status(401).json({ error: "Authentication required" });
    if (!isOwner) return res.status(403).json({ error: "Owner access required" });

    const kpis = ulysseKPIService.getSnapshot();

    let memoryUsage = null;
    try {
      const mem = process.memoryUsage();
      memoryUsage = {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        external: Math.round(mem.external / 1024 / 1024),
      };
    } catch {}

    res.json({
      success: true,
      kpis,
      memory: memoryUsage,
      uptime: Math.round(process.uptime()),
      nodeVersion: process.version,
    });
  } catch (error: any) {
    console.error("[UnifiedAnalytics] System error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/hubrise", async (req: Request, res: Response) => {
  try {
    const { userId, isOwner, role } = getUserRole(req);
    if (!userId) return res.status(401).json({ error: "Authentication required" });
    if (!isOwner && role !== "suguval_only") {
      return res.status(403).json({ error: "Access denied" });
    }

    const from = req.query.from as string;
    const to = req.query.to as string;

    const { hubriseService } = await import("../../services/hubriseService");
    const summary = await hubriseService.getOrdersSummary(from, to);

    const dailyData = Object.entries(summary.byDay)
      .map(([date, data]) => ({
        date,
        orders: data.orders,
        revenue: data.revenue,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      success: true,
      summary: {
        totalOrders: summary.totalOrders,
        totalRevenue: summary.totalRevenue,
        avgTicket: summary.avgTicket,
      },
      daily: dailyData,
      byServiceType: summary.byServiceType,
      byPaymentType: summary.byPaymentType,
    });
  } catch (error: any) {
    console.error("[UnifiedAnalytics] HubRise error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/timeline", async (req: Request, res: Response) => {
  try {
    const { userId, isOwner } = getUserRole(req);
    if (!userId) return res.status(401).json({ error: "Authentication required" });
    if (!isOwner) return res.status(403).json({ error: "Owner access required" });

    const days = parseInt(req.query.days as string) || 30;

    let hubriseDaily: { date: string; orders: number; revenue: number }[] = [];
    try {
      const { hubriseService } = await import("../../services/hubriseService");
      const from = new Date();
      from.setDate(from.getDate() - days);
      const summary = await hubriseService.getOrdersSummary(
        from.toISOString().split("T")[0],
        new Date().toISOString().split("T")[0]
      );
      hubriseDaily = Object.entries(summary.byDay)
        .map(([date, data]) => ({ date, orders: data.orders, revenue: data.revenue }))
        .sort((a, b) => a.date.localeCompare(b.date));
    } catch {}

    const systemKpis = ulysseKPIService.getSnapshot();

    res.json({
      success: true,
      period: `${days} days`,
      hubrise: hubriseDaily,
      system: {
        healthScore: systemKpis.overallHealth.score,
        latencyTrend: systemKpis.kpi1_latency.trend,
        learningVelocity: systemKpis.kpi4_learningVelocity,
      },
    });
  } catch (error: any) {
    console.error("[UnifiedAnalytics] Timeline error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/predictions", async (req: Request, res: Response) => {
  try {
    const { userId, isOwner } = getUserRole(req);
    if (!userId) return res.status(401).json({ error: "Authentication required" });
    if (!isOwner) return res.status(403).json({ error: "Owner access required" });

    const predictions = await predictiveIntelligenceService.getFullPredictions();
    res.json({ success: true, ...predictions });
  } catch (error: any) {
    console.error("[UnifiedAnalytics] Predictions error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/alerts", async (req: Request, res: Response) => {
  try {
    const { userId, isOwner } = getUserRole(req);
    if (!userId) return res.status(401).json({ error: "Authentication required" });
    if (!isOwner) return res.status(403).json({ error: "Owner access required" });

    const alerts = await predictiveIntelligenceService.generateAlerts();
    res.json({
      success: true,
      count: alerts.length,
      alerts,
    });
  } catch (error: any) {
    console.error("[UnifiedAnalytics] Alerts error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/sugu-proactive", async (req: Request, res: Response) => {
  try {
    const { userId, isOwner, role } = getUserRole(req);
    if (!userId) return res.status(401).json({ error: "Authentication required" });
    if (!isOwner && role !== "suguval_only" && role !== "sugumaillane_only") {
      return res.status(403).json({ error: "Access denied" });
    }

    const store = (req.query.store as string) === "maillane" ? "maillane" : "valentine";
    const daysAhead = parseInt(req.query.daysAhead as string) || 30;

    const report = await suguProactiveService.getFullReport(store as "valentine" | "maillane", daysAhead);
    res.json({ success: true, ...report });
  } catch (error: any) {
    console.error("[UnifiedAnalytics] Sugu proactive error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/pugi", async (req: Request, res: Response) => {
  try {
    const { userId, isOwner } = getUserRole(req);
    if (!userId) return res.status(401).json({ error: "Authentication required" });
    if (!isOwner) return res.status(403).json({ error: "Owner only" });

    const { pugi } = await import("../../services/proactiveGeneralIntelligence");
    const digest = pugi.getDigest(5);
    const stats = pugi.getStats();
    res.json({ success: true, digest, stats });
  } catch (error: any) {
    console.error("[UnifiedAnalytics] PUGI error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/pugi/feedback", async (req: Request, res: Response) => {
  try {
    const { userId, isOwner } = getUserRole(req);
    if (!userId) return res.status(401).json({ error: "Authentication required" });
    if (!isOwner) return res.status(403).json({ error: "Owner only" });

    const { signalId, action } = req.body;
    if (!signalId || !action) return res.status(400).json({ error: "signalId and action required" });

    const { pugi } = await import("../../services/proactiveGeneralIntelligence");
    pugi.recordFeedback(signalId, action);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/role-dashboard", async (req: Request, res: Response) => {
  try {
    const { userId, isOwner, role } = getUserRole(req);
    if (!userId) return res.status(401).json({ error: "Authentication required" });

    const targetRole = (req.query.role as string) || role;
    
    if (targetRole !== role && !isOwner) {
      return res.status(403).json({ error: "Cannot view other role dashboards" });
    }

    const dashboardData: any = {
      success: true,
      role: targetRole,
      timestamp: new Date().toISOString(),
    };

    switch (targetRole) {
      case "owner":
      case "admin": {
        const [suguDashboard, systemKPIs, predictions, sportsStats] = await Promise.all([
          suguAnalyticsService.getDashboard(),
          ulysseKPIService.getSnapshot(),
          predictiveIntelligenceService.generateAlerts(),
          betsTrackerService.getStats(userId, 30).catch(() => null),
        ]);

        let hubriseData = null;
        try {
          const { hubriseService } = await import("../../services/hubriseService");
          hubriseData = await hubriseService.getOrdersSummary();
        } catch {}

        dashboardData.restaurants = suguDashboard;
        dashboardData.system = {
          healthScore: systemKPIs.overallHealth.score,
          healthGrade: systemKPIs.overallHealth.grade,
          toolSuccessRate: systemKPIs.kpi2_toolSuccess.globalSuccessRate,
        };
        dashboardData.alerts = predictions;
        dashboardData.sports = sportsStats;
        dashboardData.hubrise = hubriseData ? {
          totalOrders: hubriseData.totalOrders,
          totalRevenue: hubriseData.totalRevenue,
          avgTicket: hubriseData.avgTicket,
        } : null;
        break;
      }

      case "family":
      case "approved": {
        dashboardData.sections = ["calendar", "tasks", "homework", "weather"];
        dashboardData.message = "Family dashboard — calendar, tasks, homework";
        break;
      }

      case "suguval_only": {
        const suguDashboard = await suguAnalyticsService.getDashboard();
        dashboardData.restaurant = {
          name: "Valentine",
          ...suguDashboard.suguval,
        };
        dashboardData.insights = suguDashboard.crossStoreInsights?.filter(
          (i: any) => i.store === "suguval" || i.store === "both"
        );
        let hubriseData = null;
        try {
          const { hubriseService } = await import("../../services/hubriseService");
          hubriseData = await hubriseService.getOrdersSummary();
        } catch {}
        dashboardData.hubrise = hubriseData ? {
          totalOrders: hubriseData.totalOrders,
          totalRevenue: hubriseData.totalRevenue,
          avgTicket: hubriseData.avgTicket,
        } : null;
        break;
      }

      case "sugumaillane_only": {
        const suguDashboard = await suguAnalyticsService.getDashboard();
        dashboardData.restaurant = {
          name: "Maillane",
          ...suguDashboard.sugumaillane,
        };
        dashboardData.insights = suguDashboard.crossStoreInsights?.filter(
          (i: any) => i.store === "sugumaillane" || i.store === "both"
        );
        break;
      }

      default: {
        dashboardData.message = "Limited access dashboard";
        break;
      }
    }

    res.json(dashboardData);
  } catch (error: any) {
    console.error("[UnifiedAnalytics] Role dashboard error:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
