import type { Express, Router, Request, Response } from "express";
import { createServer, type Server } from "http";
import express from "express";
import { registerChatRoutes } from "./replit_integrations/chat";
import { registerImageRoutes } from "./replit_integrations/image";
import voiceRoutes from "./routes/voice";
import authRoutes from "./routes/auth";
import speakerRecognitionRoutes from "./routes/speakerRecognition";
import { setupRealtimeVoice, handleVoiceUpgrade } from "./services/voice/realtime";
import dataRoutes from "./routes/dataRoutes";
import { requireAuth } from "./middleware/auth";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import v2Router from "./api/v2";
import agentMailRouter from "./api/agentMail";
import gmailRouter from "./api/gmail";
import guestSessionRouter from "./api/guestSession";
import guestConversationsRouter from "./api/guestConversations";
import ownerRoutes from "./routes/ownerRoutes";
import scrapingRoutes from "./routes/scrapingRoutes";
import kpiRoutes from "./routes/kpiRoutes";
import { registerSuguvalRoutes } from "./routes/suguval";
import { registerSugumaillaneRoutes } from "./routes/sugumaillane";
import hubRoutes from "./routes/hub";
import musicRoutes from "./routes/musicRoutes";
import oddsRoutes from "./routes/oddsRoutes";
import sportsRoutes from "./routes/sportsRoutes";
import sportsCacheRoutes from "./routes/sportsCacheRoutes";
import bettingRoutes from "./routes/bettingRoutes";
import crawlRoutes from "./routes/crawlRoutes";
import scraperRouter from "./routes/scraperRouter";
import browserStatsRouter from "./api/browserStats";
import ulysseDevRoutes from "./routes/ulysseDevRoutes";
import devopsRoutes from "./routes/devopsRoutes";
import devopsMaxRoutes from "./routes/devopsMaxRoutes";
import devmaxAuthRoutes from "./routes/devmaxAuth";
import irisDevopsRoutes from "./routes/irisDevopsRoutes";
import learningRoutes from "./routes/learningRoutes";
import systemStatusRouter from "./api/systemStatus";
import codeContextRouter from "./api/codeContext";
// behaviorRouter removed - v2/behavior.ts is the canonical version, mounted via v2Router
import footdatasRoutes from "./routes/footdatasRoutes";
import discordRoutes from "./routes/discordRoutes";
import maxCobaRoutes from "./routes/maxCobaRoutes";
import cobaBusinessRoutes from "./routes/cobaBusinessRoutes";
import cobaChatRoutes from "./routes/cobaChatRoutes";
import adminRoutes from "./routes/adminRoutes";
import fileRoutes from "./routes/fileRoutes";
import { db } from "./db";
import { suguCashRegister } from "@shared/schema";
import { eq } from "drizzle-orm";
import miscRoutes from "./routes/miscRoutes";
import superChatRoutes from "./routes/superChatRoutes";
import interconnectRoutes from "./routes/interconnectRoutes";
import uiSnapshotRoutes from "./routes/uiSnapshotRoutes";
import dashboardScreenshotRoutes from "./routes/dashboardScreenshot";
import path from "path";
import fs from "fs";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Serve download files with Content-Disposition header to force download
  app.get("/downloads/:filename", (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(process.cwd(), "client", "public", "downloads", filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }
    
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/octet-stream");
    res.sendFile(filePath);
  });

  // Register Auth Routes FIRST (no auth required for login/setup)
  app.use("/api/auth", authRoutes);

  // API latency tracking middleware for metrics
  app.use("/api", async (req, res, next) => {
    const startTime = Date.now();
    const endpoint = req.path;
    const method = req.method;
    
    res.on("finish", async () => {
      try {
        const duration = Date.now() - startTime;
        const statusCode = res.statusCode;
        const { metricsService } = await import("./services/metricsService");
        metricsService.recordApiLatency(endpoint, method, statusCode, duration);
      } catch (err) {
        // Silent fail - don't break API for metrics
      }
    });
    
    next();
  });

  // Apply requireAuth middleware to all /api routes EXCEPT /api/auth, V2 routes, and Gmail OAuth setup
  app.use("/api", (req, res, next) => {
    // Auth routes are already handled above, skip protection
    if (req.path === "/auth" || req.path.startsWith("/auth/")) {
      return next();
    }
    // V2 routes have their own JWT-based authentication middleware
    if (req.path.startsWith("/v2")) {
      return next();
    }
    // Public download routes don't require auth
    if (req.path.startsWith("/download/")) {
      return next();
    }
    // Suguval restaurant checklist is completely public (no auth)
    if (req.path.startsWith("/suguval")) {
      return next();
    }
    // SUGU Maillane restaurant checklist is completely public (no auth)
    if (req.path.startsWith("/sugumaillane")) {
      return next();
    }
    // Sports predictions endpoints are public for AI assistant access (Ulysse/Iris/Alfred)
    if (req.path.startsWith("/sports/cache/predictions")) {
      return next();
    }
    // Sports dashboard endpoints for frontend predictions page
    if (req.path.startsWith("/sports/dashboard")) {
      return next();
    }
    // System status endpoint is public for Ulysse self-awareness and monitoring
    if (req.path.startsWith("/system/status")) {
      return next();
    }
    // Code context endpoint uses its own secret key authentication
    if (req.path.startsWith("/code")) {
      return next();
    }
    // Pronosoft and ParionsSport scraping APIs are public for development/testing
    if (req.path.startsWith("/pronosoft") || req.path.startsWith("/parionssport")) {
      return next();
    }
    // Discord internal test endpoint
    if (req.path === "/discord/internal-test") {
      return next();
    }
    // DGM internal trigger uses its own key authentication
    if (req.path.includes("dgm/internal-trigger")) {
      return next();
    }
    // Internal VPS exec route with its own key authentication
    if (req.path.includes("internal/vps-exec")) {
      return next();
    }
    // Internal admin endpoints with their own secret key authentication
    if (req.path.startsWith("/internal/")) {
      return next();
    }
    // DevMax has its own PIN-based authentication via x-devmax-token header
    if (req.path.startsWith("/devmax")) {
      return next();
    }
    // COBA API uses its own x-coba-key authentication
    if (req.path.startsWith("/coba")) {
      return next();
    }
    // For all other API routes, require session-based authentication
    return requireAuth(req, res, next);
  });

  // Session keep-alive endpoint for long-duration usage
  // Uses cookie-based auth to extend session lifetime
  app.post("/api/session/keep-alive", requireAuth, async (req, res) => {
    try {
      // Session is already validated and extended by requireAuth middleware
      // The rolling session in authService.validateSession automatically extends the session
      res.json({ 
        status: "ok", 
        timestamp: Date.now(),
        userId: req.user?.id,
        expiresAt: req.session?.expiresAt
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to keep session alive" });
    }
  });

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      timestamp: Date.now(),
      authenticated: !!(req.session as any)?.userId 
    });
  });

  // AI Router status endpoint - get available providers
  app.get("/api/ai/providers", async (req, res) => {
    try {
      const { aiRouter } = await import("./services/aiRouter");
      const info = aiRouter.getProviderInfo();
      res.json({
        providers: aiRouter.getAvailableProviders(),
        ...info,
        models: {
          openai: "gpt-5.1",
          gemini: "gemini-2.5-pro",
          geminiFlash: "gemini-2.5-flash"
        }
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get AI providers info" });
    }
  });

  // Download Screen Monitor Agent for Windows (served from static file)
  app.get("/api/download/screen-agent", (req, res) => {
    const agentPath = path.join(process.cwd(), "server", "assets", "ulysse_screen_agent.py");
    res.setHeader("Content-Disposition", "attachment; filename=ulysse_screen_agent.py");
    res.setHeader("Content-Type", "text/x-python; charset=utf-8");
    res.sendFile(agentPath);
  });

  // Register AI Integration Routes
  registerChatRoutes(app);
  registerImageRoutes(app);
  
  // Register Object Storage Routes
  registerObjectStorageRoutes(app);
  
  // Register Voice Routes (TTS/STT)
  app.use("/api/voice", voiceRoutes);
  app.post("/api/tts", (req, res, next) => {
    req.url = "/tts";
    voiceRoutes(req, res, next);
  });
  
  // Register Speaker Recognition Routes
  app.use("/api/speaker", speakerRecognitionRoutes);
  
  // Telegram Bot Webhook (public, no auth - Telegram sends here)
  app.post("/api/telegram/webhook", async (req, res) => {
    try {
      const { telegramBotService } = await import("./services/telegramBotService");
      await telegramBotService.handleWebhookUpdate(req.body);
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[Telegram Webhook] Error:", e.message);
      res.json({ ok: true });
    }
  });

  // One-time secure cash data import (bypasses all SUGU router middleware)
  app.post("/api/internal/sugu-cash-import", async (req: Request, res: Response) => {
    const secret = req.headers["x-import-secret"];
    if (!secret || secret !== process.env.SYSTEM_STATUS_SECRET) {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      const entries: any[] = req.body;
      if (!Array.isArray(entries)) return res.status(400).json({ error: "Expected array" });
      let inserted = 0, skipped = 0;
      for (const entry of entries) {
        const existing = await db.select({ id: suguCashRegister.id }).from(suguCashRegister).where(eq(suguCashRegister.entryDate, entry.entryDate)).limit(1);
        if (existing.length > 0) { skipped++; continue; }
        await db.insert(suguCashRegister).values({
          entryDate: entry.entryDate, totalRevenue: entry.totalRevenue,
          cashAmount: entry.cashAmount || 0, cbAmount: entry.cbAmount || 0,
          cbzenAmount: entry.cbzenAmount || 0, trAmount: entry.trAmount || 0,
          ctrAmount: entry.ctrAmount || 0, chequeAmount: entry.chequeAmount || 0,
          virementAmount: entry.virementAmount || 0, ubereatsAmount: entry.ubereatsAmount || 0,
          deliverooAmount: entry.deliverooAmount || 0,
        });
        inserted++;
      }
      return res.json({ inserted, skipped, total: entries.length });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // Register V2 API Routes (Ulysse Server centralized architecture)
  app.use("/api/v2", v2Router);
  
  
  // Register AgentMail Routes (dedicated email inbox for Ulysse)
  app.use("/api/agentmail", agentMailRouter);
  app.use("/api/gmail", requireAuth, gmailRouter);
  
  // Register Guest Session Routes (anonymous Alfred sessions)
  app.use("/api/guest", guestSessionRouter);
  app.use("/api/guest/conversations", guestConversationsRouter);

  // Register Suguval Restaurant Checklist Routes (no auth required)
  registerSuguvalRoutes(app);

  // Register SUGU Maillane Restaurant Checklist Routes (no auth required)
  registerSugumaillaneRoutes(app);

  // Hub Routes (owner only) - Brief quotidien, OCR, RAG, Feature Flags
  app.use("/api/hub", requireAuth, hubRoutes);
  
  // Music API Routes - MusicBrainz metadata + Spotify playback
  app.use("/api/music", musicRoutes);
  
  // Odds API Routes - Betting odds from bookmakers
  app.use("/api/odds", oddsRoutes);
  
  // Sports API Routes - API-Football for scores, standings
  app.use("/api/sports", sportsRoutes);
  
  // Sports Cache Routes - Djedou Pronos API cache system
  app.use("/api/sports/cache", sportsCacheRoutes);
  
  // Betting Profile & History Routes
  app.use("/api/betting", bettingRoutes);
  app.use("/api/crawl", crawlRoutes);
  app.use("/api/scraper", scraperRouter);
  app.use("/api/browser", requireAuth, browserStatsRouter);
  
  // Ulysse Dev++ Routes - Enhanced AI assistant capabilities
  app.use("/api/ulysse-dev", ulysseDevRoutes);
  
  // DevOps Bridge - GitHub integration for repos, PRs, deployments
  app.use("/api/devops", devopsRoutes);
  
  // DevMax webhook (no auth - GitHub signature verification)
  const devmaxWebhookRoutes = (await import("./routes/devmaxWebhook")).default;
  app.use("/api/devmax/webhook", devmaxWebhookRoutes);
  
  // DevMax - independent platform with dedicated auth & DB
  app.use("/api/devmax", devmaxAuthRoutes);
  app.use("/api/devmax/ops", devopsMaxRoutes);
  
  // DevOps Iris - daughters' project management
  app.use("/api/iris", irisDevopsRoutes);
  
  // Autonomous Learning Routes - Brain management and monitoring
  app.use("/api/learning", learningRoutes);
  
  // System Status - Consolidated diagnostic endpoint for Ulysse and monitoring
  app.use("/api/system/status", systemStatusRouter);
  
  // Code Context - Code-aware AI integration
  app.use("/api/code", codeContextRouter);
  
  // Behavior Patterns - handled by v2Router via v2/behavior.ts (canonical version)
  // Old behavior.ts mount removed to eliminate duplicate routes at /api/v2/behavior
  
  // FOOTDATAS - Complete Football Database for Big 5 European Leagues
  app.use("/api/footdatas", footdatasRoutes);

  // Discord Bot routes
  app.use("/api/discord", discordRoutes);

  // MaxAI COBA - Chef Operator Business Assistant for AppToOrder
  app.use("/api/coba", maxCobaRoutes);
  app.use("/api/coba/business", cobaBusinessRoutes);
  app.use("/api/coba/chat", cobaChatRoutes);
  app.use("/coba-reports", express.static(path.join(process.cwd(), "public", "coba-reports")));
  app.use("/coba-export", express.static(path.join(process.cwd(), "public", "coba-export")));

  // Admin Dashboard Routes (owner/admin only - has own auth middleware)
  app.use("/api/admin", adminRoutes);

  // Data CRUD Routes (approved users, projects, tasks, notes, ambiance profiles)
  app.use(dataRoutes);

  // File/Media/Storage routes (extracted to fileRoutes.ts)
  app.use("/api", fileRoutes);

  // Misc Routes (homework, charter, voice settings, preview, RAC, face descriptors, marseille info)
  app.use("/api", miscRoutes);

  // SuperChat - multi-AI group chat
  app.use("/api/superchat", requireAuth, superChatRoutes);

  // Owner Routes (code snapshot API with PIN verification)
  app.use("/api", ownerRoutes);

  // FILE OPERATIONS, MEDIA LIBRARY, STORAGE routes moved to server/routes/fileRoutes.ts
  // (mounted above via app.use("/api", fileRoutes))

  // Gmail API endpoints - DISABLED in favor of AgentMail
  // All Gmail functionality is now handled through AgentMail service
  // See /api/agentmail/* routes for email operations

  // Scraping Routes (browser crawler, pronosoft, parionssport)
  app.use("/api", scrapingRoutes);


  // KPI Routes (optimizer stats, Ulysse KPIs)
  app.use("/api/v2", kpiRoutes);

  // Interconnect Routes (Activity Stream + Entity Links + Tags)
  app.use("/api/interconnect", requireAuth, interconnectRoutes);

  app.use(uiSnapshotRoutes);
  app.use(dashboardScreenshotRoutes);

  try {
    const { metricsService } = await import("./services/metricsService");
    metricsService.startCostPersistence();
    console.log("[MetricsService] Cost persistence started (5min intervals)");
  } catch (e: any) {
    console.warn("[MetricsService] Failed to start cost persistence:", e.message);
  }

  return httpServer;
}
