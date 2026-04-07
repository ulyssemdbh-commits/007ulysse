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
import { spawn, ChildProcess } from "child_process";
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
// PIPER TTS SERVICE SUPERVISOR
// =============================================================================

let piperTTSProcess: ChildProcess | null = null;
let piperRestartAttempts = 0;
const PIPER_MAX_RESTARTS = 5;
const PIPER_RESTART_WINDOW_MS = 10 * 60 * 1000;
let piperFirstCrashTime: number | null = null;

function startPiperTTSService() {
  if (piperTTSProcess) {
    console.log("[PiperTTS] Service already running");
    return;
  }

  if (piperRestartAttempts >= PIPER_MAX_RESTARTS) {
    const now = Date.now();
    if (piperFirstCrashTime && now - piperFirstCrashTime < PIPER_RESTART_WINDOW_MS) {
      console.error(`[PiperTTS] Too many restart attempts (${piperRestartAttempts}/${PIPER_MAX_RESTARTS}) — paused`);
      return;
    } else {
      piperRestartAttempts = 0;
      piperFirstCrashTime = null;
    }
  }

  try {
    const pythonPath = process.env.PYTHON_PATH || "python3";
    piperTTSProcess = spawn(pythonPath, ["piper_tts/tts_service.py"], {
      env: { ...process.env, PIPER_PORT: "5002", PYTHONUNBUFFERED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    piperTTSProcess.stdout?.on("data", (data) => {
      console.log(`[PiperTTS] ${data.toString().trim()}`);
    });

    piperTTSProcess.stderr?.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes("WARNING")) {
        console.log(`[PiperTTS] ${msg}`);
      }
    });

    piperTTSProcess.on("close", (code) => {
      console.log(`[PiperTTS] Service exited with code ${code}`);
      piperTTSProcess = null;
      const now = Date.now();
      if (piperFirstCrashTime === null) piperFirstCrashTime = now;
      piperRestartAttempts++;
      if (code !== 0 && piperRestartAttempts <= PIPER_MAX_RESTARTS) {
        console.log(`[PiperTTS] Restarting in 8s (attempt ${piperRestartAttempts}/${PIPER_MAX_RESTARTS})...`);
        setTimeout(startPiperTTSService, 8000);
      }
    });

    piperTTSProcess.on("error", (err) => {
      console.error("[PiperTTS] Failed to start:", err.message);
      piperTTSProcess = null;
    });

    console.log("[PiperTTS] Service starting on port 5002...");
  } catch (error: any) {
    console.error("[PiperTTS] Failed to start:", error.message);
    piperTTSProcess = null;
  }
}

// =============================================================================
// SPEAKER RECOGNITION SERVICE SUPERVISOR (avec backoff protection)
// =============================================================================

let speakerServiceProcess: ChildProcess | null = null;
let speakerRestartAttempts = 0;
const SPEAKER_MAX_RESTARTS = 5;
const SPEAKER_RESTART_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
let speakerFirstCrashTime: number | null = null;

function resetSpeakerRestartWindow() {
  speakerRestartAttempts = 0;
  speakerFirstCrashTime = null;
}

function startSpeakerService() {
  if (speakerServiceProcess) {
    console.log("[Speaker] Service already running");
    return;
  }

  // Backoff protection: max N restarts dans une fenêtre de temps
  if (speakerRestartAttempts >= SPEAKER_MAX_RESTARTS) {
    const now = Date.now();
    if (speakerFirstCrashTime && now - speakerFirstCrashTime < SPEAKER_RESTART_WINDOW_MS) {
      console.error(
        `[Speaker] Too many restart attempts (${speakerRestartAttempts}/${SPEAKER_MAX_RESTARTS}) in ${Math.round(SPEAKER_RESTART_WINDOW_MS / 60000)}min. Manual intervention required.`
      );
      return;
    } else {
      // Fenêtre expirée, on reset
      resetSpeakerRestartWindow();
    }
  }

  try {
    const pythonPath = process.env.PYTHON_PATH || "python3";
    speakerServiceProcess = spawn(pythonPath, ["speaker_recognition/speaker_service.py"], {
      env: { ...process.env, SPEAKER_PORT: "5001" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    speakerServiceProcess.stdout?.on("data", (data) => {
      console.log(`[Speaker] ${data.toString().trim()}`);
    });

    speakerServiceProcess.stderr?.on("data", (data) => {
      console.error(`[Speaker] ${data.toString().trim()}`);
    });

    speakerServiceProcess.on("close", (code) => {
      console.log(`[Speaker] Service exited with code ${code}`);
      speakerServiceProcess = null;

      // Track crash timing pour backoff
      const now = Date.now();
      if (speakerFirstCrashTime === null) {
        speakerFirstCrashTime = now;
      }
      speakerRestartAttempts++;

      // Restart after 5 seconds if it crashes with non-zero code
      if (code !== 0 && speakerRestartAttempts <= SPEAKER_MAX_RESTARTS) {
        console.log(`[Speaker] Restarting in 5s (attempt ${speakerRestartAttempts}/${SPEAKER_MAX_RESTARTS})...`);
        setTimeout(startSpeakerService, 5000);
      } else if (speakerRestartAttempts > SPEAKER_MAX_RESTARTS) {
        console.error("[Speaker] Max restart attempts reached. Service disabled until manual restart.");
      }
    });

    speakerServiceProcess.on("error", (err) => {
      console.error("[Speaker] Failed to start service:", err.message);
      speakerServiceProcess = null;
    });

    console.log("[Speaker] Recognition service starting on port 5001");
  } catch (error: any) {
    console.error("[Speaker] Failed to start service:", error.message);
    speakerServiceProcess = null;
  }
}

// =============================================================================
// CLEAN SHUTDOWN (SIGINT / SIGTERM / exit)
// =============================================================================

let isShuttingDown = false;

function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`[Shutdown] Received ${signal}, cleaning up...`);

  // Kill Piper TTS service
  if (piperTTSProcess) {
    try {
      piperTTSProcess.kill("SIGTERM");
      console.log("[Shutdown] Piper TTS service terminated");
    } catch (e) {
      console.error("[Shutdown] Error killing Piper TTS service:", (e as Error).message);
    }
  }

  // Kill speaker service
  if (speakerServiceProcess) {
    try {
      speakerServiceProcess.kill("SIGTERM");
      console.log("[Shutdown] Speaker service terminated");
    } catch (e) {
      console.error("[Shutdown] Error killing speaker service:", (e as Error).message);
    }
  }

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

  // Initialize Discord Bot with full Ulysse integration
  if (process.env.LIGHT_MODE === "true") {
    console.log("[Startup] LIGHT_MODE: Skipping Discord bot initialization");
  } else try {
    const { discordBotService } = await import("./services/discordBotService");
    const { ulysseCoreEngine } = await import("./services/core/UlysseCoreEngine");
    const { brainContextService } = await import("./services/brainContextService");
    const { getPersonaPromptContext, SPEAKER_PERSONA_MAP } = await import("./config/personaMapping");
    const { db: discordDb } = await import("./db");
    const { ulysseMemory, conversationThreads, conversationMessages } = await import("@shared/schema");
    
    const discordConversations = new Map<string, { conversationId: number; history: Array<{role: string; content: string}> }>();
    
    const ulysseHandler = async (messageText: string, discordUserId: string): Promise<string> => {
      try {
        console.log(`[DiscordBot] Processing: "${messageText}" from Discord user ${discordUserId}`);
        const userId = 1;
        
        let session = discordConversations.get(discordUserId);
        if (!session) {
          const { eq, desc, and, gte } = await import("drizzle-orm");
          // Look for an existing recent Discord conversation (within last 30 days)
          const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          const [existingThread] = await discordDb
            .select()
            .from(conversationThreads)
            .where(and(
              eq(conversationThreads.userId, userId),
              eq(conversationThreads.originDevice, 'discord'),
              gte(conversationThreads.lastMessageAt!, cutoff)
            ))
            .orderBy(desc(conversationThreads.lastMessageAt))
            .limit(1);

          let conversationId: number;
          let history: Array<{role: string; content: string}> = [];

          if (existingThread) {
            conversationId = existingThread.id;
            // Reload last 20 messages from this thread for context
            const { conversationMessages: convMsgTable } = await import("@shared/schema");
            const recentMsgs = await discordDb
              .select()
              .from(convMsgTable)
              .where(eq(convMsgTable.threadId, conversationId))
              .orderBy(desc(convMsgTable.createdAt))
              .limit(20);
            history = recentMsgs.reverse().map(m => ({ role: m.role, content: m.content }));
            console.log(`[DiscordBot] Resumed conversation ${conversationId} (${history.length} messages loaded) for Discord user ${discordUserId}`);
          } else {
            const [newConv] = await discordDb.insert(conversationThreads).values({
              userId,
              title: `Discord - ${new Date().toLocaleDateString('fr-FR')}`,
              originDevice: 'discord'
            }).returning();
            conversationId = newConv.id;
            console.log(`[DiscordBot] Created new conversation ${conversationId} for Discord user ${discordUserId}`);
          }

          session = { conversationId, history };
          discordConversations.set(discordUserId, session);
        }
        
        // Add user message to history (keep last 10 for context)
        session.history.push({ role: 'user', content: messageText });
        if (session.history.length > 20) {
          session.history = session.history.slice(-20);
        }
        
        await discordDb.insert(conversationMessages).values({
          threadId: session.conversationId,
          userId,
          role: 'user',
          content: messageText
        });

        // Update lastMessageAt on the thread so we can resume it after server restart
        { const { eq: eqUpd } = await import("drizzle-orm");
          await discordDb.update(conversationThreads)
            .set({ lastMessageAt: new Date() })
            .where(eqUpd(conversationThreads.id, session.conversationId)); }
        
        // Build rich brain context with persona and memory - Ulysse config for Maurice
        const personaConfig = SPEAKER_PERSONA_MAP['maurice'] || SPEAKER_PERSONA_MAP['owner'];
        const personaPrompt = getPersonaPromptContext(personaConfig);
        
        // Get brain context (memory, knowledge, patterns)
        const brainContext = await brainContextService.getContext({
          userId,
          query: messageText,
          persona: 'ulysse',
          maxTokens: 2000,
          includeGraph: true
        });
        
        // Build Discord history context from in-memory session (loaded from DB on startup)
        const discordHistoryBlock = session.history.length > 2
          ? `HISTORIQUE DISCORD (${session.history.length} messages depuis le début de notre session):\n` +
            session.history.slice(0, -1).map(m =>
              `${m.role === 'user' ? 'Maurice' : 'Ulysse'}: ${m.content.substring(0, 300)}`
            ).join('\n')
          : '';

        // Build full system prompt
        const systemPrompt = `${personaPrompt}

Tu es sur Discord, tu discutes avec Maurice. Tu as accès à l'historique complet de notre conversation Discord actuelle.
Date: ${new Date().toLocaleDateString('fr-FR')} ${new Date().toLocaleTimeString('fr-FR')}

${discordHistoryBlock ? `${discordHistoryBlock}\n` : ''}
${brainContext.contextBlock ? `CONTEXTE MÉMOIRE:\n${brainContext.contextBlock}` : ''}

RÈGLES DISCORD:
- Réponds de manière concise mais complète
- Tu peux utiliser des emojis si approprié
- Si on te demande ce qu'on a dit avant, cite l'historique ci-dessus avec précision
- Tu retiens cette conversation pour nos futurs échanges`;

        // Process with UlysseCoreEngine with full context
        const result = await ulysseCoreEngine.process({
          message: messageText,
          context: {
            userId,
            persona: 'ulysse',
            hasFamilyAccess: true,
            conversationId: session.conversationId,
            messageHistory: session.history.slice(-10),
            brainContext: systemPrompt
          }
        });
        
        const response = result.content || "Je n'ai pas compris, peux-tu reformuler ?";
        
        await discordDb.insert(conversationMessages).values({
          threadId: session.conversationId,
          userId,
          role: 'assistant',
          content: response
        });
        
        // Add to history
        session.history.push({ role: 'assistant', content: response });
        
        // Save to memory if significant interaction
        if (messageText.length > 20) {
          try {
            await discordDb.insert(ulysseMemory).values({
              userId,
              category: 'interaction',
              key: `discord_${Date.now()}`,
              value: `[Discord] User: ${messageText}\nUlysse: ${response.substring(0, 500)}`,
              source: 'discord',
              confidence: 50,
              verified: true
            });
          } catch (memError: any) {
            console.log('[DiscordBot] Memory save skipped:', memError.message);
          }
        }
        
        console.log(`[DiscordBot] Response (${response.length} chars) saved to conv ${session.conversationId}`);
        return response;
        
      } catch (error: any) {
        console.error('[DiscordBot] Ulysse processing error:', error.message, error.stack);
        return "Désolé, une erreur s'est produite. Réessaie dans un moment.";
      }
    };
    
    const connected = await discordBotService.initialize(ulysseHandler);
    if (connected) {
      console.log('[Startup] Discord Bot connected with full memory integration');
    } else {
      console.log('[Startup] Discord Bot not configured (no token)');
    }
  } catch (error: any) {
    console.error("[Startup] Discord Bot initialization error:", error.message);
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
