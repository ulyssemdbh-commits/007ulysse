import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { ensureApprovedUsers, ensureContextualProjects } from "./services/userBootstrap";
import { jobScheduler } from "./services/scheduledJobs";
import { setupRealtimeVoice, handleVoiceUpgrade } from "./services/voice/realtime";
import { setupGeminiLiveVoice, handleGeminiLiveUpgrade } from "./services/voice/realtimeGeminiLive";
import { setupRealtimeSync, handleSyncUpgrade } from "./services/realtimeSync";
import { setupScreenMonitorWs, handleScreenUpgrade } from "./services/screenMonitorWs";
import { setupSecurityMiddleware } from "./middleware/security";
import { setupScalabilityLayer } from "./middleware/scalability";
import { perfProfiler } from "./services/perfProfiler";
import { startPiperTTSService, startSpeakerService, shutdownAllProcesses } from "./services/processSupervisor";
import path from "path";
import fs from "fs";

console.log(`[Boot] Process starting — PID=${process.pid}, NODE_ENV=${process.env.NODE_ENV || 'undefined'}, memory=${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`);

if (!process.env.DATABASE_URL) {
  console.error("[Boot] WARNING: DATABASE_URL is not set — server may fail to connect to database");
}

// =============================================================================
// Global error handlers — catch crashes in production before they go silent
process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err.message, err.stack);
});
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled promise rejection:", reason);
});

// =============================================================================
// CORE ULYSSE MAX - Server principal robuste et sécurisé
// =============================================================================

const app = express();
app.set("trust proxy", 1);
const httpServer = createServer(app);
httpServer.on("error", (err: NodeJS.ErrnoException) => {
  console.error("[Server] HTTP server error:", err.code, err.message);
});

// ---------- SECURITY ----------
setupSecurityMiddleware(app);

// ---------- SCALABILITY ----------
setupScalabilityLayer(app);

// ---------- PERFORMANCE: HTTP COMPRESSION ----------
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    if (req.path.includes('/voice/') || req.path.includes('/audio')) return false;
    return compression.filter(req, res);
  }
}));

// ---------- MIDDLEWARES ----------
app.use(cookieParser());

// Dynamic manifest.json based on Referer for iOS PWA support
app.get("/manifest.json", (req, res, next) => {
  const referer = req.get("referer") || "";

  let manifestFile = "manifest.json";
  if (referer.includes("/courses/suguval")) {
    manifestFile = "manifest-suguval.json";
  } else if (referer.includes("/talking")) {
    manifestFile = "manifest-talking.json";
  } else if (referer.includes("/max")) {
    manifestFile = "manifest-alfred.json";
  }

  const manifestPath = path.join(process.cwd(), "client", "public", manifestFile);
  if (fs.existsSync(manifestPath)) {
    res.setHeader("Content-Type", "application/manifest+json");
    return res.sendFile(manifestPath);
  }
  next();
});

app.use((req, res, next) => {
  const host = req.get("host") || "";
  const pathName = req.path;

  if (pathName.startsWith("/talking") || pathName.startsWith("/ws/voice")) {
    return next();
  }

  if (pathName === "/_health" || pathName === "/health" || pathName === "/api/healthz" || pathName.startsWith("/api/v2/health")) {
    return next();
  }

  const customDomain = process.env.CANONICAL_DOMAIN;
  if (customDomain && process.env.NODE_ENV === "production" && host !== customDomain && !host.includes(customDomain)) {
    if (host.startsWith("127.0.0.1") || host.startsWith("localhost") || pathName.startsWith("/api/")) {
      return next();
    }
    return res.redirect(301, `https://${customDomain}${req.originalUrl}`);
  }
  next();
});

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// ---------- LOGGING ----------
export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

// API logging middleware — ultra-perf: no JSON.stringify on success, error-only capture
const LOG_MAX_LENGTH = 400;
const SKIP_LOG_PATHS = new Set(['/api/health', '/api/perf', '/api/voice/status']);

app.use((req, res, next) => {
  const pathName = req.path;
  if (!pathName.startsWith("/api") || SKIP_LOG_PATHS.has(pathName)) return next();

  const start = Date.now();
  let errorBody: string | undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    if (res.statusCode >= 400) {
      try { errorBody = JSON.stringify(bodyJson).slice(0, LOG_MAX_LENGTH); } catch {}
    }
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    let logLine = `${req.method} ${pathName} ${res.statusCode} in ${duration}ms`;
    if (errorBody) logLine += ` :: ${errorBody}`;
    if (duration > 2000) logLine += ` [SLOW]`;
    log(logLine);
  });

  next();
});

// ---------- PERFORMANCE PROFILING ----------
// Track API response times, DB queries, external API calls for Ulysse Dev++ insights
app.use(perfProfiler.expressMiddleware());


// =============================================================================
// CLEAN SHUTDOWN (SIGINT / SIGTERM / exit)
// =============================================================================

let isShuttingDown = false;

function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`[Shutdown] Received ${signal}, cleaning up...`);

  shutdownAllProcesses();

  // Stop job scheduler
  try {
    jobScheduler.stop();
    console.log("[Shutdown] Job scheduler stopped");
  } catch (e) {
    // Ignore if not started
  }

  // Close HTTP server gracefully
  httpServer.close(() => {
    console.log("[Shutdown] HTTP server closed");
    process.exit(0);
  });

  // Force exit after 10 seconds if graceful shutdown fails
  setTimeout(() => {
    console.error("[Shutdown] Forced exit after timeout");
    process.exit(1);
  }, 10000);
}

process.on("SIGINT", () => { process.stderr.write(`[Signal] SIGINT received at ${new Date().toISOString()}\n`); shutdown("SIGINT"); });
process.on("SIGTERM", () => { process.stderr.write(`[Signal] SIGTERM received at ${new Date().toISOString()}\n`); shutdown("SIGTERM"); });
process.on("SIGUSR1", () => { process.stderr.write(`[Signal] SIGUSR1 received at ${new Date().toISOString()}\n`); });
process.on("SIGUSR2", () => { process.stderr.write(`[Signal] SIGUSR2 received at ${new Date().toISOString()}\n`); });

process.on("uncaughtException", (err: Error) => {
  console.error("[Process] Uncaught exception (non-fatal):", err?.message, err?.stack);
});

// UI Snapshots cleanup - every 6 hours, delete expired snapshots (30 days retention)
setInterval(async () => {
  try {
    const { uiSnapshots } = await import("@shared/schema");
    const { lte } = await import("drizzle-orm");
    const result = await db.delete(uiSnapshots).where(lte(uiSnapshots.expiresAt, new Date())).returning({ id: uiSnapshots.id });
    if (result.length > 0) {
      console.log(`[UISnapshot] Cleanup: ${result.length} expired snapshots deleted`);
    }
  } catch (err: any) {
    console.error("[UISnapshot] Cleanup error:", err.message);
  }
}, 6 * 60 * 60 * 1000);

// Memory tracking - log every 60 seconds (was 5s — reduced CPU overhead)
const memTrackInterval = setInterval(() => {
  const m = process.memoryUsage();
  const rss = Math.round(m.rss / 1024 / 1024);
  const heap = Math.round(m.heapUsed / 1024 / 1024);
  const heapTotal = Math.round(m.heapTotal / 1024 / 1024);
  try {
    const cgroupMB = Math.round(parseInt(fs.readFileSync('/sys/fs/cgroup/memory.current', 'utf8')) / 1024 / 1024);
    if (rss > 500 || cgroupMB > 2048) {
      console.warn(`[MemTrack] HIGH RSS:${rss}MB heap:${heap}/${heapTotal}MB cgroup:${cgroupMB}MB`);
    } else {
      console.log(`[MemTrack] RSS:${rss}MB heap:${heap}/${heapTotal}MB cgroup:${cgroupMB}MB`);
    }
  } catch {
    console.log(`[MemTrack] RSS:${rss}MB heap:${heap}/${heapTotal}MB`);
  }
}, 60000);

process.on("unhandledRejection", (reason: unknown) => {
  console.error("[Process] Unhandled promise rejection (non-fatal):", reason);
});
process.on("exit", (code) => {
  process.stderr.write(`[Process] EXIT CODE: ${code} at ${new Date().toISOString()}\n`);
  if (speakerServiceProcess) {
    try {
      speakerServiceProcess.kill();
    } catch (e) {
      // Ignore
    }
  }
});

// =============================================================================
// ASYNC INIT FOR HEAVY SERVICES
// =============================================================================

async function initializeServices() {
  const svcStart = Date.now();
  try {
    await Promise.race([
      ensureApprovedUsers(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 15000))
    ]);
    log("Approved users initialized");
  } catch (error: any) {
    console.error("[Startup] User bootstrap error:", error.message);
  }

  try {
    await Promise.race([
      ensureContextualProjects(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 15000))
    ]);
    log("Contextual projects initialized");
  } catch (error: any) {
    console.error("[Startup] Contextual projects error:", error.message);
  }
  
  if (process.env.LIGHT_MODE !== "true") {
    import("./services/footdatasInitializer").then(async ({ initializeAllTeams }) => {
      try {
        const result = await initializeAllTeams();
        console.log(`[FOOTDATAS] Initialized: ${result.leagues} leagues, ${result.clubs} clubs`);
      } catch (error: any) {
        console.error("[FOOTDATAS] Initialization error:", error.message);
      }
    }).catch(err => console.error("[FOOTDATAS] Import error:", err.message));

    import("./services/agentMailService").then(async ({ agentMailService }) => {
      try {
        const connectivityResult = await agentMailService.testConnectivity();
        if (connectivityResult.success) {
          console.log(`[Startup] AgentMail connectivity OK: ${connectivityResult.inboxes.join(", ")}`);
        } else {
          console.warn(`[Startup] AgentMail connectivity FAILED: ${connectivityResult.error}`);
        }
      } catch (error: any) {
        console.error("[Startup] AgentMail test error:", error.message);
      }
    }).catch(err => console.error("[Startup] AgentMail import error:", err.message));
  } else {
    console.log("[Startup] LIGHT_MODE: Skipping FOOTDATAS and AgentMail initialization");
  }

  if (process.env.LIGHT_MODE === "true") {
    console.log("[Startup] LIGHT_MODE: Skipping Discord bot initialization");
  } else try {
    const { initializeDiscordBot } = await import("./services/discordInitializer");
    await initializeDiscordBot();
  } catch (error: any) {
    console.error("[Startup] Discord Bot initialization error:", error.message);
  }

  // Meta-learning auto-tuner: closes the loop between system metrics and tunable params
  try {
    const { metaLearningService } = await import("./services/metaLearningService");
    await metaLearningService.init();
  } catch (error: any) {
    console.error("[Startup] MetaLearning init error:", error.message);
  }
}

// =============================================================================
// MAIN STARTUP
// =============================================================================

(async () => {
  let serverReady = false;

  // CRITICAL: Register health check FIRST — before any heavy initialization
  // Multiple paths to ensure deployment health checks pass regardless of which path is probed
  const healthResponse = (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok", ready: serverReady, timestamp: new Date().toISOString() });
  };
  app.get("/_health", healthResponse);
  app.get("/health", healthResponse);
  app.get("/api/healthz", healthResponse);

  // Loading page while server initializes (prevents "Cannot GET /" on first load)
  app.use((req, res, next) => {
    if (serverReady) return next();
    if (req.path.startsWith("/api/") || req.path === "/_health" || req.path === "/health") return next();
    res.status(200).set({ "Content-Type": "text/html" }).end(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ulysse — Chargement</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a0a;color:#fff;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;overflow:hidden}.c{text-align:center}.s{width:40px;height:40px;border:3px solid #333;border-top-color:#6366f1;border-radius:50%;animation:r .8s linear infinite;margin:0 auto 20px}@keyframes r{to{transform:rotate(360deg)}}p{color:#888;font-size:14px}</style>
<script>setTimeout(()=>location.reload(),3000)</script>
</head><body><div class="c"><div class="s"></div><p>Ulysse démarre…</p></div></body></html>`);
  });

  // CRITICAL: Start listening IMMEDIATELY for fast deployment health check
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    async () => {
      log(`serving on port ${port} — health check available immediately`);

      try {
        // Initialize WebSocket servers (lightweight, no I/O)
        try {
          setupRealtimeVoice();
          setupGeminiLiveVoice();
          setupRealtimeSync();
          setupScreenMonitorWs();
          log("WebSocket servers initialized");
        } catch (wsErr: any) {
          console.error("[Startup] WebSocket init error (non-fatal):", wsErr.message);
        }

        // Register routes — wrapped with timeout protection
        const routeStart = Date.now();
        await Promise.race([
          registerRoutes(httpServer, app),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Route registration timeout (120s)")), 120000))
        ]);
        log(`Routes registered in ${Date.now() - routeStart}ms`);

        // Start MaxAI COBA weekly report scheduler
        try {
          const { startWeeklyScheduler } = await import("./services/maxCobaService");
          startWeeklyScheduler();
          log("COBA weekly scheduler started");
        } catch (e: any) {
          console.error("[COBA] Scheduler init error:", e.message);
        }

        // Global error handler - SAFE: no throw after response
        app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
          const status = err.status || err.statusCode || 500;
          const message = err.message || "Internal Server Error";
          console.error(`[ExpressError] ${status} ${message}`, err.stack || err);
          if (!res.headersSent) {
            res.status(status).json({ message });
          }
        });

        // Setup static files or Vite
        if (process.env.NODE_ENV === "production") {
          serveStatic(app);
          log("Static files served");
        } else {
          const { setupVite } = await import("./vite");
          await setupVite(httpServer, app);
        }

        // Capture existing upgrade listeners (including Vite HMR) and replace with unified router
        const existingUpgradeListeners = httpServer.listeners("upgrade").slice();
        httpServer.removeAllListeners("upgrade");

        // Install unified WebSocket upgrade router
        httpServer.on("upgrade", (request, socket, head) => {
          const pathname = request.url?.split("?")[0];

          if (pathname === "/ws/voice") {
            handleVoiceUpgrade(request, socket, head);
            return;
          }

          if (pathname === "/ws/voice/gemini") {
            handleGeminiLiveUpgrade(request, socket, head);
            return;
          }

          if (pathname === "/ws/sync") {
            handleSyncUpgrade(request, socket, head);
            return;
          }

          if (pathname === "/ws/screen") {
            handleScreenUpgrade(request, socket, head);
            return;
          }

          // Forward to other listeners (Vite HMR, etc.)
          for (const listener of existingUpgradeListeners) {
            listener.call(httpServer, request, socket, head);
          }
        });

        serverReady = true;
        log(`Server FULLY READY in ${Date.now() - routeStart}ms — all routes and static files registered`);

        // Initialize heavy services AFTER server is fully ready (non-blocking)
        // These run in background and do not block health checks or request handling
        setTimeout(() => {
          const lightMode = process.env.LIGHT_MODE === "true";
          if (lightMode) {
            log("LIGHT_MODE enabled — skipping heavy background services (anticipation, PUGI, autoLearning)");
          }

          initializeServices().catch((err) => {
            console.error("[Startup] Service initialization error:", err);
          });

          jobScheduler.start();
          log("Job scheduler started");

          if (!lightMode) {
            import("./services/anticipationEngine").then(({ anticipationEngine }) => {
              anticipationEngine.start();
              log("AnticipationEngine started");
            }).catch(err => console.error("[Startup] AnticipationEngine error:", err));

            import("./services/proactiveGeneralIntelligence").then(({ pugi }) => {
              pugi.start();
              log("PUGI started");
            }).catch(err => console.error("[Startup] PUGI error:", err));
          }

          import("./services/taskQueueEngine").then(async ({ resumeInterruptedQueues, startWatchdog }) => {
            const resumed = await resumeInterruptedQueues();
            startWatchdog();
            log(`TaskQueue autonomous worker started (${resumed} queue(s) resumed)`);
          }).catch(err => console.error("[Startup] TaskQueue worker error:", err));

          import("./services/workJournalService").then(async ({ workJournalService }) => {
            await workJournalService.ensureTable();
          }).catch(err => console.error("[Startup] WorkJournal error:", err));

          if (process.env.NODE_ENV !== "production") {
            startPiperTTSService();
            startSpeakerService();
          } else {
            console.log("[PiperTTS] Skipped in production (Python not available in VM)");
            console.log("[Speaker] Skipped in production (Python not available in VM)");
          }
        }, 100);
      } catch (err: any) {
        console.error("[Startup] CRITICAL initialization error:", err.message, err.stack);
        // Even on critical error, keep the server running so health checks can report status
        serverReady = true;
        log("Server marked ready despite initialization errors — health checks will respond");
      }
    },
  );
})();
