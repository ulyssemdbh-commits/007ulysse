import { Router, Request, Response, NextFunction } from "express";
import conversationsRouter from "./conversations";
import devicesRouter, { verifyAccessToken } from "./devices";
import summaryRouter from "./summary";
import emailsRouter from "./emails";
import locationRouter from "./location";
import itineraryRouter from "./itinerary";
import faceRecognitionRouter from "./faceRecognition";
import camerasRouter from "./cameras";
import smartHomeRouter from "./smartHome";
import siriWebhookRouter from "./siriWebhook";
import behaviorRouter from "./behavior";
import spotifyRouter from "./spotify";
import tuyaRouter from "./tuya";
import iftttRouter from "./ifttt";
import websiteMonitoringRouter from "../../routes/monitoring";
import screenMonitorRouter from "../../routes/screenMonitor";
import marsRouter from "./mars";
import marsAuditRouter from "./marsAudit";
import brainRouter from "./brain";
import stocksRouter from "./stocks";
import marketsRouter from "./markets";
import coreRouter from "./core";
import ownerDashboardRouter from "./ownerDashboard";
import betsTrackerRouter from "./betsTracker";
import suguAnalyticsRouter from "./suguAnalytics";
import suguManagementRouter from "./suguManagement";
import suguMaillaneManagementRouter from "./suguMaillaneManagement";
import sensoryRouter from "./sensory";
import diagnosticsRouter from "./diagnostics";
import desktopAgentRouter from "./desktopAgent";
import mapsRouter from "./maps";
import automationFeaturesRouter from "./automationFeatures";
import unifiedAnalyticsRouter from "./unifiedAnalytics";
import pushRouter from "../../routes/pushRoutes";
import { db } from "../../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { capabilityService } from "../../services/capabilityService";
import { actionVerificationService } from "../../services/actionVerificationService";
import { diagnosticsService } from "../../services/diagnostics";
import { getSessionToken } from "../../middleware/auth";
import { authService } from "../../services/auth";
import { getMonitoringDashboard, monitoring } from "../../services/monitoring";
import { metricsService } from "../../services/metricsService";
import { smartCrawl, testAllStrategies } from "../../core/strategyEngine";
import { getDomainProfile, getAllProfiles, clearDomainProfile } from "../../core/domainProfileService";
import { getEnabledStrategies } from "../../core/strategyTypes";
import { z } from "zod";

const router = Router();

async function v2AuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const publicPaths = [
    "/devices/register", 
    "/devices/refresh", 
    "/health", 
    "/capabilities", 
    "/self-diagnosis",
    "/spotify/status",
    "/spotify/playback",
    "/spotify/devices",
    "/tuya/status",
    "/ifttt/status",
    "/scrape/smart",
    "/extract",
    "/sensory/health",
    "/diagnostics/quick",
    "/sugu-management/cash/batch-import",
    "/sugu-management/cash/batch-import-init",
    "/push/vapid-key",
  ];
  if (publicPaths.some(p => req.path.startsWith(p))) {
    return next();
  }

  const authHeader = req.headers.authorization;
  let userId: number | null = null;
  
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const decoded = verifyAccessToken(token);
    
    if (decoded) {
      userId = decoded.userId;
      (req as any).userId = decoded.userId;
      (req as any).deviceId = decoded.deviceId;
      (req as any).authMethod = "jwt";
    }
  }
  
  if (!userId) {
    const sessionToken = getSessionToken(req);
    if (sessionToken) {
      const result = await authService.validateSession(sessionToken);
      if (result.success && result.user) {
        userId = result.user.id;
        (req as any).userId = userId;
        (req as any).user = result.user;
        (req as any).session = result.session;
        (req as any).authMethod = "session";
      }
    }
  }

  if (!userId) {
    const devmaxToken = req.headers["x-devmax-token"] as string;
    if (devmaxToken && req.body?.sessionContext === "devops") {
      try {
        const { devmaxSessions } = await import("@shared/schema");
        const { eq: eqOp, gt: gtOp, and: andOp } = await import("drizzle-orm");
        const [session] = await db.select().from(devmaxSessions)
          .where(andOp(eqOp(devmaxSessions.id, devmaxToken), gtOp(devmaxSessions.expiresAt, new Date())))
          .limit(1);
        if (session) {
          userId = 1;
          (req as any).userId = 1;
          (req as any).authMethod = "devmax";
          (req as any).isOwner = true;
        }
      } catch {}
    }
  }

  if (!userId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const user = await db.select({ isOwner: users.isOwner })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    (req as any).isOwner = user[0]?.isOwner ?? false;
  } catch {
    (req as any).isOwner = false;
  }

  return next();
}

import path from "path";
import fs from "fs";
router.get("/screen-monitor/download-agent", (_req: Request, res: Response) => {
  const agentPath = path.join(process.cwd(), "server", "assets", "ulysse_screen_agent.py");
  if (!fs.existsSync(agentPath)) {
    return res.status(404).json({ error: "Agent script not found" });
  }
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", "attachment; filename=ulysse_screen_agent.py");
  fs.createReadStream(agentPath).pipe(res);
});

router.use(v2AuthMiddleware);

router.use("/conversations", conversationsRouter);
router.use("/devices", devicesRouter);
router.use("/summary", summaryRouter);
router.use("/emails", emailsRouter);
router.use("/location", locationRouter);
router.use("/itinerary", itineraryRouter);
router.use("/faces", faceRecognitionRouter);
router.use("/cameras", camerasRouter);
router.use("/smart-home", smartHomeRouter);
router.use("/siri", siriWebhookRouter);
router.use("/behavior", behaviorRouter);
router.use("/spotify", spotifyRouter);
router.use("/tuya", tuyaRouter);
router.use("/ifttt", iftttRouter);
router.use("/website-monitoring", websiteMonitoringRouter);
router.use("/screen-monitor", screenMonitorRouter);
router.use("/mars", marsRouter);
router.use("/mars", marsAuditRouter);
router.use("/brain", brainRouter);
router.use("/stocks", stocksRouter);
router.use("/markets", marketsRouter);
router.use("/core", coreRouter);
router.use("/owner", ownerDashboardRouter);
router.use("/bets", betsTrackerRouter);
router.use("/sugu-analytics", suguAnalyticsRouter);
router.use("/sugu-management", suguManagementRouter);
router.use("/sugumaillane-management", suguMaillaneManagementRouter);
router.use("/sensory", sensoryRouter);
router.use("/diagnostics", diagnosticsRouter);
router.use("/desktop-agent", desktopAgentRouter);
router.use("/maps", mapsRouter);
router.use("/automation", automationFeaturesRouter);
router.use("/analytics", unifiedAnalyticsRouter);
router.use("/push", pushRouter);

router.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    version: "2.0.0",
    timestamp: new Date().toISOString(),
    features: [
      "multi-device-auth",
      "unified-conversations",
      "daily-summaries",
      "email-cache",
      "geolocation",
      "itinerary",
    ],
  });
});

router.get("/monitoring", async (req: Request, res: Response) => {
  try {
    const isOwner = (req as any).isOwner;
    if (!isOwner) {
      return res.status(403).json({ error: "Owner access required" });
    }
    
    const dashboard = getMonitoringDashboard();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...dashboard,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/monitoring/health-check", async (req: Request, res: Response) => {
  try {
    const isOwner = (req as any).isOwner;
    if (!isOwner) {
      return res.status(403).json({ error: "Owner access required" });
    }
    
    const { name, status, message, responseTime } = req.body;
    if (!name || !status) {
      return res.status(400).json({ error: "name and status required" });
    }
    
    monitoring.recordHealthCheck(name, status, message, responseTime);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/me", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const deviceId = (req as any).deviceId;
    const authMethod = (req as any).authMethod;

    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    res.json({
      userId,
      deviceId,
      authMethod,
      features: {
        conversations: true,
        summary: true,
        emails: true,
        voice: true,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/capabilities", async (req: Request, res: Response) => {
  try {
    const snapshot = await capabilityService.getCapabilitySnapshot();
    res.json({
      success: true,
      ...snapshot,
      byCategory: snapshot.capabilities.reduce((acc, cap) => {
        if (!acc[cap.category]) acc[cap.category] = [];
        acc[cap.category].push(cap);
        return acc;
      }, {} as Record<string, typeof snapshot.capabilities>)
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/capabilities/:name", async (req: Request, res: Response) => {
  try {
    const cap = await capabilityService.getCapabilityByName(req.params.name);
    if (!cap) {
      return res.status(404).json({ error: "Capability not found" });
    }
    res.json({ success: true, capability: cap });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/self-diagnosis", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    
    interface CapStatus {
      id: number;
      name: string;
      category: string;
      isAvailable: boolean;
      successRate: number;
      lastUsed: Date | null;
      failureReason: string | null;
    }
    
    interface DiagCheck {
      name: string;
      status: string;
      details?: string;
    }
    
    const [capabilitySnapshot, actionStats, diagnosticReport] = await Promise.all([
      capabilityService.getCapabilitySnapshot(),
      actionVerificationService.getActionStats(userId),
      diagnosticsService.runDiagnostics(userId)
    ]);
    
    const unavailableCapabilities = capabilitySnapshot.capabilities.filter((c: CapStatus) => !c.isAvailable);
    const lowSuccessCapabilities = capabilitySnapshot.capabilities.filter((c: CapStatus) => c.successRate < 80 && c.isAvailable);
    
    const systemHealth = {
      overall: diagnosticReport.checks.every((c: DiagCheck) => c.status === 'pass') ? 'healthy' : 'degraded',
      database: diagnosticReport.checks.find((c: DiagCheck) => c.name.toLowerCase().includes('database'))?.status || 'unknown',
      voice: diagnosticReport.checks.find((c: DiagCheck) => c.name.toLowerCase().includes('voice'))?.status || 'unknown',
      chat: diagnosticReport.checks.find((c: DiagCheck) => c.name.toLowerCase().includes('chat'))?.status || 'unknown',
      memory: diagnosticReport.checks.find((c: DiagCheck) => c.name.toLowerCase().includes('memory'))?.status || 'unknown'
    };
    
    const recommendations: string[] = [...diagnosticReport.recommendations];
    
    if (unavailableCapabilities.length > 0) {
      recommendations.push(`${unavailableCapabilities.length} capacité(s) indisponible(s): ${unavailableCapabilities.map((c: CapStatus) => c.name).join(', ')}`);
    }
    if (lowSuccessCapabilities.length > 0) {
      recommendations.push(`${lowSuccessCapabilities.length} capacité(s) avec taux de succès faible (<80%): ${lowSuccessCapabilities.map((c: CapStatus) => `${c.name} (${c.successRate}%)`).join(', ')}`);
    }
    if (actionStats.averageScore < 80) {
      recommendations.push(`Améliorer la qualité des actions (score moyen: ${actionStats.averageScore}%)`);
    }
    if (actionStats.successRate < 80) {
      recommendations.push(`Améliorer le taux de réussite des actions (actuel: ${actionStats.successRate}%)`);
    }
    if (actionStats.recentFailures > 0) {
      recommendations.push(`${actionStats.recentFailures} échec(s) récent(s) à analyser`);
    }
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      systemHealth,
      capabilities: {
        version: capabilitySnapshot.version,
        total: capabilitySnapshot.totalCapabilities,
        available: capabilitySnapshot.availableCount,
        unavailable: capabilitySnapshot.unavailableCount,
        unavailableList: unavailableCapabilities,
        lowSuccessList: lowSuccessCapabilities
      },
      actionQuality: {
        totalActions: actionStats.totalActions,
        successRate: actionStats.successRate,
        averageScore: actionStats.averageScore,
        recentFailures: actionStats.recentFailures
      },
      diagnostics: {
        checks: diagnosticReport.checks,
        irisIssuesCount: diagnosticReport.irisIssuesCount
      },
      recommendations,
      selfAwarenessActive: true
    });
  } catch (error: any) {
    console.error("[V2] Self-diagnosis error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/capabilities/:name/usage", async (req: Request, res: Response) => {
  try {
    const { success } = req.body;
    await capabilityService.recordCapabilityUsage(req.params.name, success === true);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/metrics", async (req: Request, res: Response) => {
  try {
    const format = req.query.format as string;
    
    if (format === "full") {
      res.json({
        success: true,
        metrics: metricsService.getSnapshot(),
      });
    } else {
      res.json({
        success: true,
        metrics: metricsService.getSummary(),
      });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/metrics/reset", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    
    if (!user?.isOwner) {
      return res.status(403).json({ error: "Owner only" });
    }
    
    metricsService.reset();
    res.json({ success: true, message: "Metrics reset" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ================================
// Smart Scraping API v2 - Strategy Engine with Learning
// ================================

const SmartScrapeSchema = z.object({
  url: z.string().url(),
  forceStrategy: z.enum(['http', 'jina', 'playwright', 'firecrawl', 'apify', 'perplexity']).optional(),
  timeoutMs: z.number().min(5000).max(120000).optional(),
  qualityThreshold: z.number().min(0).max(1).optional(),
  minContentLength: z.number().min(0).optional(),
});

router.post("/scrape/smart", async (req: Request, res: Response) => {
  try {
    const parsed = SmartScrapeSchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "Invalid request",
        details: parsed.error.issues,
      });
    }

    console.log(`[V2/SmartScrape] Request for ${parsed.data.url}`);
    const result = await smartCrawl(parsed.data as any);
    
    res.json(result);
  } catch (err: any) {
    console.error("[V2/SmartScrape] Error:", err);
    res.status(500).json({
      success: false,
      error: "Smart scrape failed",
      details: err.message,
    });
  }
});

router.get("/scrape/smart/test", async (req: Request, res: Response) => {
  try {
    const url = req.query.url as string;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: "Missing url parameter",
      });
    }

    console.log(`[V2/SmartScrape] Testing all strategies for ${url}`);
    const result = await testAllStrategies(url);
    
    res.json({
      success: true,
      ...result,
    });
  } catch (err: any) {
    console.error("[V2/SmartScrape] Test error:", err);
    res.status(500).json({
      success: false,
      error: "Strategy test failed",
      details: err.message,
    });
  }
});

router.get("/scrape/smart/profile", async (req: Request, res: Response) => {
  try {
    const url = req.query.url as string;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: "Missing url parameter",
      });
    }

    const profile = await getDomainProfile(url);
    
    res.json({
      success: true,
      profile,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: "Failed to get profile",
      details: err.message,
    });
  }
});

router.get("/scrape/smart/profiles", async (_req: Request, res: Response) => {
  try {
    const profiles = await getAllProfiles();
    
    res.json({
      success: true,
      count: profiles.length,
      profiles,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: "Failed to get profiles",
      details: err.message,
    });
  }
});

router.delete("/scrape/smart/profile", async (req: Request, res: Response) => {
  try {
    const url = req.query.url as string;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: "Missing url parameter",
      });
    }

    await clearDomainProfile(url);
    
    res.json({
      success: true,
      message: `Profile cleared for ${url}`,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: "Failed to clear profile",
      details: err.message,
    });
  }
});

router.get("/scrape/smart/strategies", (_req: Request, res: Response) => {
  const strategies = getEnabledStrategies().sort(
    (a, b) => (a.priority ?? 999) - (b.priority ?? 999),
  );
  
  res.json({
    success: true,
    strategies: strategies.map(s => ({
      strategy: s.strategy,
      priority: s.priority,
      enabled: s.enabled,
      timeoutMs: s.timeoutMs,
      minQualityScore: s.minQualityScore,
      hasApiKey: s.requiresApiKey ? !!process.env[s.requiresApiKey] : true,
    })),
  });
});

// Strategy analytics endpoint
router.get("/scrape/smart/analytics", async (_req: Request, res: Response) => {
  try {
    const { getStrategyStats, getStrategyInsights, resetStrategyStats } = await import("../../core/strategyAnalytics");
    const stats = getStrategyStats();
    const insights = getStrategyInsights();
    
    res.json({
      success: true,
      analytics: {
        stats,
        insights,
      },
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: "Failed to get analytics",
      details: err.message,
    });
  }
});

// Reset analytics
router.delete("/scrape/smart/analytics", async (_req: Request, res: Response) => {
  try {
    const { resetStrategyStats } = await import("../../core/strategyAnalytics");
    resetStrategyStats();
    
    res.json({
      success: true,
      message: "Analytics reset successfully",
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: "Failed to reset analytics",
      details: err.message,
    });
  }
});

// Rate limiter status
router.get("/scrape/smart/ratelimit", async (req: Request, res: Response) => {
  try {
    const { getRateLimitState, canMakeRequest } = await import("../../core/rateLimiter");
    const url = req.query.url as string;
    
    if (url) {
      const state = getRateLimitState(url);
      const canRequest = canMakeRequest(url);
      
      res.json({
        success: true,
        url,
        domain: new URL(url).hostname,
        state,
        canMakeRequest: canRequest,
      });
    } else {
      res.json({
        success: true,
        message: "Provide ?url= parameter to check specific domain rate limit",
      });
    }
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: "Failed to get rate limit status",
      details: err.message,
    });
  }
});

// Strategy health check
router.get("/scrape/smart/health", async (_req: Request, res: Response) => {
  try {
    const strategies = getEnabledStrategies().sort(
      (a, b) => (a.priority ?? 999) - (b.priority ?? 999),
    );
    const { getStrategyStats } = await import("../../core/strategyAnalytics");
    const stats = getStrategyStats();
    
    const healthReport = strategies.map(s => {
      const stratStats = stats[s.strategy];
      const successRate = stratStats && stratStats.total > 0 
        ? stratStats.success / stratStats.total 
        : null;
      
      return {
        strategy: s.strategy,
        enabled: s.enabled,
        hasApiKey: s.requiresApiKey ? !!process.env[s.requiresApiKey] : true,
        totalAttempts: stratStats?.total || 0,
        successRate: successRate !== null ? `${(successRate * 100).toFixed(1)}%` : 'N/A',
        avgQuality: stratStats?.avgQuality.toFixed(2) || 'N/A',
        status: !s.enabled ? 'disabled' 
          : (s.requiresApiKey && !process.env[s.requiresApiKey]) ? 'missing_key'
          : successRate === null ? 'untested'
          : successRate >= 0.7 ? 'healthy'
          : successRate >= 0.4 ? 'degraded'
          : 'unhealthy',
      };
    });
    
    const overallHealth = healthReport.every(h => h.status === 'healthy' || h.status === 'untested' || h.status === 'disabled')
      ? 'healthy'
      : healthReport.some(h => h.status === 'unhealthy') 
        ? 'degraded' 
        : 'ok';
    
    res.json({
      success: true,
      overallHealth,
      strategies: healthReport,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: "Failed to check health",
      details: err.message,
    });
  }
});

router.post("/extract", async (req: Request, res: Response) => {
  try {
    const { smartExtract } = await import("../../services/structuredExtractor");
    const { url, contentType } = req.body;
    
    if (!url) {
      return res.status(400).json({ success: false, error: "URL required" });
    }
    
    console.log(`[V2/Extract] Extracting structured data from ${url}`);
    const result = await smartExtract(url, contentType);
    
    res.json(result);
  } catch (error: any) {
    console.error("[V2/Extract] Error:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      contentType: "unknown",
      data: null,
    });
  }
});

router.get("/extract/types", (_req: Request, res: Response) => {
  res.json({
    success: true,
    types: [
      { id: "sports_ranking", description: "Classements sportifs" },
      { id: "sports_scores", description: "Scores et résultats" },
      { id: "betting_odds", description: "Cotes de paris" },
      { id: "news_article", description: "Articles de presse" },
      { id: "product_listing", description: "Listings de produits" },
      { id: "price_list", description: "Listes de prix" },
      { id: "table_data", description: "Données tabulaires" },
    ]
  });
});

const LEAGUE_URLS: Record<string, string> = {
  "ligue1": "https://www.eurotopteam.com/football/ligue1.php",
  "premierleague": "https://www.eurotopteam.com/football/premierleague.php",
  "liga": "https://www.eurotopteam.com/football/liga.php",
  "bundesliga": "https://www.eurotopteam.com/football/bundesliga.php",
  "seriea": "https://www.eurotopteam.com/football/seriea.php",
};

router.get("/extract/football/:league", async (req: Request, res: Response) => {
  try {
    const { 
      extractRankingTable, 
      extractTopScorers, 
      extractFixtures,
      fetchHtmlForScraper
    } = await import("../../services/verifiedScraperService");
    
    const { league } = req.params;
    const includeAll = req.query.full === "true" || req.query.all === "true";
    
    const url = LEAGUE_URLS[league.toLowerCase()];
    if (!url) {
      return res.status(404).json({ 
        success: false, 
        error: `League not found. Available: ${Object.keys(LEAGUE_URLS).join(", ")}` 
      });
    }
    
    console.log(`[V2/Extract] Fetching ${league} data from ${url}`);
    const html = await fetchHtmlForScraper(url);
    if (!html) {
      return res.status(500).json({ success: false, error: "Failed to fetch page" });
    }
    
    const ranking = extractRankingTable(html);
    const topScorers = extractTopScorers(html);
    const fixturesData = extractFixtures(html);
    
    const formattedRanking = ranking.map(r => ({
      position: r.position,
      name: r.name,
      score: r.points,
      stats: {
        J: r.played,
        V: r.wins,
        N: r.draws,
        D: r.losses,
        BP: r.goalsFor,
        BC: r.goalsAgainst,
        Diff: r.goalDiff,
      }
    }));
    
    if (includeAll) {
      res.json({
        success: true,
        contentType: "football_page",
        source: url,
        extractedAt: new Date().toISOString(),
        data: {
          ranking: { type: "ranking", title: `Classement ${league}`, items: formattedRanking },
          topScorers: { type: "topScorers", title: `Meilleurs buteurs ${league}`, items: topScorers },
          fixtures: { type: "fixtures", title: `Prochaine journée ${league}`, matchday: fixturesData.matchday, items: fixturesData.fixtures },
        },
      });
    } else {
      res.json({
        success: true,
        contentType: "sports_ranking",
        source: url,
        extractedAt: new Date().toISOString(),
        data: { type: "ranking", title: `Classement ${league}`, items: formattedRanking },
        confidence: 0.95,
      });
    }
  } catch (error: any) {
    console.error("[V2/Extract] Football error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/extract/football/:league/scorers", async (req: Request, res: Response) => {
  try {
    const { extractTopScorers, fetchHtmlForScraper } = await import("../../services/verifiedScraperService");
    const { league } = req.params;
    
    const url = LEAGUE_URLS[league.toLowerCase()];
    if (!url) {
      return res.status(404).json({ success: false, error: `League not found` });
    }
    
    const html = await fetchHtmlForScraper(url);
    if (!html) {
      return res.status(500).json({ success: false, error: "Failed to fetch page" });
    }
    
    const topScorers = extractTopScorers(html);
    
    res.json({
      success: true,
      contentType: "top_scorers",
      source: url,
      extractedAt: new Date().toISOString(),
      data: { type: "topScorers", title: `Meilleurs buteurs ${league}`, items: topScorers },
    });
  } catch (error: any) {
    console.error("[V2/Extract] Scorers error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/extract/football/:league/fixtures", async (req: Request, res: Response) => {
  try {
    const { extractFixtures, fetchHtmlForScraper } = await import("../../services/verifiedScraperService");
    const { league } = req.params;
    
    const url = LEAGUE_URLS[league.toLowerCase()];
    if (!url) {
      return res.status(404).json({ success: false, error: `League not found` });
    }
    
    const html = await fetchHtmlForScraper(url);
    if (!html) {
      return res.status(500).json({ success: false, error: "Failed to fetch page" });
    }
    
    const fixturesData = extractFixtures(html);
    
    res.json({
      success: true,
      contentType: "fixtures",
      source: url,
      extractedAt: new Date().toISOString(),
      data: { type: "fixtures", title: `Prochaine journée ${league}`, matchday: fixturesData.matchday, items: fixturesData.fixtures },
    });
  } catch (error: any) {
    console.error("[V2/Extract] Fixtures error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
