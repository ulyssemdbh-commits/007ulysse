import type { Express, Router, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import express from "express";
import { registerChatRoutes } from "./replit_integrations/chat";
import { registerImageRoutes } from "./replit_integrations/image";
import voiceRoutes from "./routes/voice";
import authRoutes from "./routes/auth";
import { requireAuth } from "./middleware/auth";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import v2Router from "./api/v2";
import dataRoutes from "./routes/dataRoutes";
import { db } from "./db";
import { suguCashRegister } from "@shared/schema";
import { eq } from "drizzle-orm";
import path from "path";
import fs from "fs";
import yaml from "js-yaml";

function lazyRouter(importFn: () => Promise<{ default: Router } | Record<string, unknown>>): Router {
  let cached: Router | null = null;
  const handler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!cached) {
        const mod = await importFn();
        cached = mod.default || mod;
      }
      cached(req, res, next);
    } catch (err) {
      console.error("[LazyRouter] Failed to load route module:", err);
      next(err);
    }
  };
  return handler as unknown as Router;
}

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

  // Declarative auth bypass registry — routes that use their own authentication
  // Each entry: prefix to match against req.path (relative to /api)
  const PUBLIC_ROUTE_PREFIXES: ReadonlyArray<string> = [
    "/auth",              // Auth routes handled above
    "/v2",               // JWT-based authentication
    "/download/",        // Public download routes
    "/suguval",          // Restaurant checklist (public)
    "/sugumaillane",     // Restaurant checklist (public)
    "/sports/cache/predictions", // AI assistant access
    "/sports/dashboard", // Frontend predictions page
    "/system/status",    // Monitoring & self-awareness
    "/code",             // Own secret key authentication
    "/pronosoft",        // Scraping APIs
    "/parionssport",     // Scraping APIs
    "/internal/",        // Own secret key authentication
    "/devmax",           // PIN-based authentication (x-devmax-token)
    "/coba",             // Key-based authentication (x-coba-key)
    "/guest",            // Guest session routes
    "/health",           // Health check
  ];
  const PUBLIC_ROUTE_EXACT: ReadonlyArray<string> = [
    "/discord/internal-test",
  ];
  const PUBLIC_ROUTE_INCLUDES: ReadonlyArray<string> = [
    "dgm/internal-trigger",
    "internal/vps-exec",
  ];

  app.use("/api", (req, res, next) => {
    const p = req.path;
    if (
      PUBLIC_ROUTE_PREFIXES.some(prefix => p === prefix || p.startsWith(prefix + "/") || p.startsWith(prefix)) ||
      PUBLIC_ROUTE_EXACT.includes(p) ||
      PUBLIC_ROUTE_INCLUDES.some(s => p.includes(s))
    ) {
      return next();
    }
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

  // Swagger UI - API Documentation
  try {
    const swaggerUi = await import("swagger-ui-express");
    const apiDocPath = path.join(process.cwd(), "server", "docs", "api.yaml");
    if (fs.existsSync(apiDocPath)) {
      const apiDoc = yaml.load(fs.readFileSync(apiDocPath, "utf8")) as any;
      app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(apiDoc, {
        customCss: '.swagger-ui .topbar { display: none }',
        customSiteTitle: 'Ulysse AI - API Documentation',
      }));
      console.log("[Swagger] API docs available at /api/docs");
    }
  } catch (e: any) {
    console.warn("[Swagger] Could not load API docs:", e.message);
  }

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      timestamp: Date.now(),
      authenticated: !!(req as Request & { session?: { userId?: number } }).session?.userId
    });
  });

  app.get("/metrics", async (req, res) => {
    try {
      const { metricsService } = await import("./services/metricsService");
      res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
      res.send(metricsService.toPrometheus());
    } catch (error: any) {
      res.status(500).send(`# Error generating metrics\n# ${error.message}\n`);
    }
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
  
  app.use("/api/voice", voiceRoutes);
  app.post("/api/tts", (req, res, next) => {
    req.url = "/tts";
    voiceRoutes(req, res, next);
  });
  
  app.use("/api/speaker", lazyRouter(() => import("./routes/speakerRecognition")));
  
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

  app.use("/api/v2", v2Router);
  
  app.use("/api/agentmail", lazyRouter(() => import("./api/agentMail")));
  app.use("/api/gmail", requireAuth, lazyRouter(() => import("./api/gmail")));
  
  app.use("/api/guest", lazyRouter(() => import("./api/guestSession")));
  app.use("/api/guest/conversations", lazyRouter(() => import("./api/guestConversations")));

  const { registerSuguvalRoutes } = await import("./routes/suguval");
  registerSuguvalRoutes(app);
  const { registerSugumaillaneRoutes } = await import("./routes/sugumaillane");
  registerSugumaillaneRoutes(app);

  app.use("/api/hub", requireAuth, lazyRouter(() => import("./routes/hub")));
  app.use("/api/music", lazyRouter(() => import("./routes/musicRoutes")));
  app.use("/api/odds", lazyRouter(() => import("./routes/oddsRoutes")));
  app.use("/api/sports", lazyRouter(() => import("./routes/sportsRoutes")));
  app.use("/api/sports/cache", lazyRouter(() => import("./routes/sportsCacheRoutes")));
  app.use("/api/betting", lazyRouter(() => import("./routes/bettingRoutes")));
  app.use("/api/crawl", lazyRouter(() => import("./routes/crawlRoutes")));
  app.use("/api/scraper", lazyRouter(() => import("./routes/scraperRouter")));
  app.use("/api/browser", requireAuth, lazyRouter(() => import("./api/browserStats")));
  app.use("/api/ulysse-dev", lazyRouter(() => import("./routes/ulysseDevRoutes")));
  app.use("/api/devops", lazyRouter(() => import("./routes/devopsRoutes")));
  
  const devmaxWebhookRoutes = (await import("./routes/devmaxWebhook")).default;
  app.use("/api/devmax/webhook", devmaxWebhookRoutes);
  
  app.use("/api/devmax", lazyRouter(() => import("./routes/devmaxAuth")));
  app.use("/api/devmax/ops", lazyRouter(() => import("./routes/devopsMaxRoutes")));
  app.use("/api/iris", lazyRouter(() => import("./routes/irisDevopsRoutes")));
  app.use("/api/learning", lazyRouter(() => import("./routes/learningRoutes")));
  app.use("/api/system/status", lazyRouter(() => import("./api/systemStatus")));
  app.use("/api/code", lazyRouter(() => import("./api/codeContext")));
  app.use("/api/footdatas", lazyRouter(() => import("./routes/footdatasRoutes")));
  app.use("/api/discord", lazyRouter(() => import("./routes/discordRoutes")));
  app.use("/api/coba", lazyRouter(() => import("./routes/maxCobaRoutes")));
  app.use("/api/coba/business", lazyRouter(() => import("./routes/cobaBusinessRoutes")));
  app.use("/api/coba/chat", lazyRouter(() => import("./routes/cobaChatRoutes")));
  app.use("/coba-reports", express.static(path.join(process.cwd(), "public", "coba-reports")));
  app.use("/coba-export", express.static(path.join(process.cwd(), "public", "coba-export")));
  app.use("/api/admin", lazyRouter(() => import("./routes/adminRoutes")));

  app.use(dataRoutes);
  app.use("/api", lazyRouter(() => import("./routes/fileRoutes")));
  app.use("/api", lazyRouter(() => import("./routes/miscRoutes")));
  app.use("/api/superchat", requireAuth, lazyRouter(() => import("./routes/superChatRoutes")));
  app.use("/api/commax", lazyRouter(() => import("./routes/commaxRoutes")));
  app.use("/api", lazyRouter(() => import("./routes/ownerRoutes")));
  app.use("/api", lazyRouter(() => import("./routes/scrapingRoutes")));
  app.use("/api/v2", lazyRouter(() => import("./routes/kpiRoutes")));
  app.use("/api/interconnect", requireAuth, lazyRouter(() => import("./routes/interconnectRoutes")));
  app.use(lazyRouter(() => import("./routes/uiSnapshotRoutes")));
  app.use(lazyRouter(() => import("./routes/dashboardScreenshot")));

  try {
    const { metricsService } = await import("./services/metricsService");
    metricsService.startCostPersistence();
    console.log("[MetricsService] Cost persistence started (5min intervals)");
  } catch (e: any) {
    console.warn("[MetricsService] Failed to start cost persistence:", e.message);
  }

  return httpServer;
}
