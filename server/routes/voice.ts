import { Router, Request, Response } from "express";
import multer from "multer";
import { 
  coreTextToSpeech, 
  coreSpeechToText, 
  isVoiceSupported,
  isTTSSupported,
  isSTTSupported,
  getVoiceCoreStatus,
  getVoiceCapabilities,
  splitTextForStreaming,
  voiceActivityService,
  authorizeVoiceAction, 
  getEnrollmentStatus, 
  addEnrollmentSample,
  deleteVoiceProfile,
  type VoiceAction 
} from "../services/voice";
import { startPreloading, getPreloadedContext, getPreloaderStats } from "../services/context/preloader";
import { getCachedResponse, canAnswerFromCache, getCacheStats, prewarmCache } from "../services/responseCache";
import { voiceSessionManager, type VoiceSessionEvent } from "../services/voice/voiceSessionManager";

const router = Router();
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

router.post("/tts", async (req: Request, res: Response) => {
  try {
    const { text, voice = "onyx", speed = 1.0 } = req.body;
    
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Text is required" });
    }

    if (!isTTSSupported()) {
      return res.status(503).json({ error: "TTS not available" });
    }

    const audioBuffer = await coreTextToSpeech(text, { voice, speed });
    
    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Length": audioBuffer.length.toString(),
      "Cache-Control": "no-cache",
    });
    
    res.send(audioBuffer);
  } catch (error) {
    console.error("TTS route error:", error);
    res.status(500).json({ error: "Failed to generate speech" });
  }
});

router.post("/tts/stream", async (req: Request, res: Response) => {
  try {
    const { text, voice = "onyx", speed = 1.0 } = req.body;
    
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Text is required" });
    }

    if (!isTTSSupported()) {
      return res.status(503).json({ error: "TTS not available" });
    }

    // Track client disconnect
    let clientDisconnected = false;
    req.on("close", () => {
      clientDisconnected = true;
      console.log("TTS stream client disconnected");
    });

    const chunks = splitTextForStreaming(text);
    
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    // Send heartbeat to establish connection
    res.write(`: heartbeat\n\n`);

    // For short text (1-2 sentences), don't chunk - send as single audio
    if (chunks.length <= 2) {
      if (clientDisconnected) return res.end();
      try {
        const audioBuffer = await coreTextToSpeech(text, { voice, speed });
        if (!clientDisconnected) {
          const base64Audio = audioBuffer.toString("base64");
          res.write(`data: ${JSON.stringify({ audio: base64Audio, text })}\n\n`);
        }
      } catch (err) {
        console.error("TTS error:", err);
      }
    } else {
      // For longer text, process chunks
      for (const chunk of chunks) {
        if (clientDisconnected) break;
        
        try {
          const audioBuffer = await coreTextToSpeech(chunk, { voice, speed });
          if (!clientDisconnected) {
            const base64Audio = audioBuffer.toString("base64");
            res.write(`data: ${JSON.stringify({ audio: base64Audio, text: chunk })}\n\n`);
          }
        } catch (err) {
          console.error("Chunk TTS error:", err);
        }
      }
    }
    
    if (!clientDisconnected) {
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    }
    res.end();
  } catch (error) {
    console.error("TTS stream route error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to stream speech" });
    }
  }
});

// Whisper hallucination patterns - these are common garbage outputs when audio is unclear
const WHISPER_HALLUCINATIONS = [
  "sous-titres réalisés",
  "amara.org",
  "merci d'avoir regardé",
  "sous-titrage st",
  "sous-titrage",
  "merci de vous abonner",
  "n'oubliez pas de vous abonner",
  "likez et abonnez",
  "à bientôt",
  "thank you for watching",
  "please subscribe",
  "music",
  "[musique]",
  "[applaudissements]",
  "♪",
  "transcrit par",
  "transcript by",
  "sous titres",
];

function isWhisperHallucination(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  if (normalized.length < 3) return true; // Too short to be meaningful
  return WHISPER_HALLUCINATIONS.some(pattern => normalized.includes(pattern));
}

router.post("/stt", upload.single("audio"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Audio file is required", success: false });
    }

    // Validate minimum file size (too small = corrupted/empty)
    if (req.file.size < 1000) {
      console.log(`[STT Route] Audio too small (${req.file.size} bytes), likely corrupted or empty`);
      return res.status(400).json({ error: "Audio file too small or empty", success: false });
    }

    const language = (req.body.language as string) || "fr";
    // Get mimeType from request body or file, fallback to webm
    const mimeType = (req.body.mimeType as string) || req.file.mimetype || "audio/webm";
    
    // Validate mimeType is audio
    if (!mimeType.startsWith("audio/")) {
      console.log(`[STT Route] Invalid mimeType: ${mimeType}`);
      return res.status(400).json({ error: "Invalid audio format", success: false });
    }
    
    console.log(`[STT Route] Received audio: originalname=${req.file.originalname}, mimetype=${req.file.mimetype}, size=${req.file.size}, bodyMimeType=${req.body.mimeType}`);
    
    if (!isSTTSupported()) {
      return res.status(503).json({ error: "STT not available", success: false });
    }
    
    const transcript = await coreSpeechToText(req.file.buffer, { language, mimeType });
    
    // Filter out Whisper hallucinations (garbage output when audio is unclear)
    if (isWhisperHallucination(transcript)) {
      console.log(`[STT Route] Filtered Whisper hallucination: "${transcript.slice(0, 50)}..."`);
      return res.json({ transcript: "", success: true, filtered: true });
    }
    
    res.json({ transcript, success: true });
  } catch (error: any) {
    // Handle Whisper format errors gracefully
    if (error?.message?.includes("Invalid file format")) {
      console.log(`[STT Route] Whisper rejected format, returning empty transcript`);
      return res.json({ transcript: "", success: false, error: "Audio format not supported" });
    }
    console.error("STT route error:", error);
    res.status(500).json({ error: "Failed to transcribe audio", success: false });
  }
});

router.get("/voices", (_req: Request, res: Response) => {
  res.json({
    voices: [
      { id: "alloy", name: "Alloy", description: "Neutral and balanced" },
      { id: "echo", name: "Echo", description: "Warm and conversational" },
      { id: "fable", name: "Fable", description: "Expressive and dynamic" },
      { id: "onyx", name: "Onyx", description: "Deep and authoritative" },
      { id: "nova", name: "Nova", description: "Friendly and upbeat" },
      { id: "shimmer", name: "Shimmer", description: "Clear and optimistic" },
    ],
    default: "onyx"
  });
});

router.get("/status", (_req: Request, res: Response) => {
  const status = getVoiceCoreStatus();
  const caps = getVoiceCapabilities();
  
  res.json({
    ttsSupported: caps.tts,
    sttSupported: caps.stt,
    useBrowserFallback: !isVoiceSupported(),
    provider: caps.provider,
    engine: status.engineName,
    stats: status.stats,
    message: isVoiceSupported() 
      ? `Voice Core ready (${status.engineName})` 
      : "Using browser voice fallback (add OPENAI_API_KEY for OpenAI voices)"
  });
});

// Context preloading - call when STT starts to preload context in background
router.post("/preload-context", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }
    
    // Start preloading in background (don't await)
    startPreloading(userId);
    
    res.json({ status: "preloading", userId });
  } catch (error) {
    console.error("Preload context error:", error);
    res.status(500).json({ error: "Failed to start preloading" });
  }
});

// Get preloaded context - call before sending to AI
router.get("/preloaded-context", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }
    
    const context = getPreloadedContext(userId);
    
    if (context) {
      res.json({ 
        available: true, 
        context,
        age: Date.now() - context.preloadedAt 
      });
    } else {
      res.json({ available: false });
    }
  } catch (error) {
    console.error("Get preloaded context error:", error);
    res.status(500).json({ error: "Failed to get preloaded context" });
  }
});

// Quick response from cache - ultra-fast responses for common queries
router.post("/quick-response", async (req: Request, res: Response) => {
  try {
    const { message } = req.body;
    
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message is required" });
    }
    
    // Check if we can answer from cache
    if (canAnswerFromCache(message)) {
      const cachedResponse = await getCachedResponse(message);
      if (cachedResponse) {
        return res.json({ 
          cached: true, 
          response: cachedResponse 
        });
      }
    }
    
    res.json({ cached: false });
  } catch (error) {
    console.error("Quick response error:", error);
    res.status(500).json({ error: "Failed to get quick response" });
  }
});

// Cache stats endpoint
router.get("/cache-stats", (_req: Request, res: Response) => {
  res.json({
    responseCache: getCacheStats(),
    preloader: getPreloaderStats()
  });
});

// Prewarm cache on startup
prewarmCache().catch(err => console.error("Cache prewarm failed:", err));

// ============================================================================
// Voice Auth Routes
// ============================================================================

router.get("/enrollment/status", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }
    
    const status = await getEnrollmentStatus(String(userId));
    res.json(status);
  } catch (error) {
    console.error("[VoiceAuth] Enrollment status error:", error);
    res.status(500).json({ error: "Failed to get enrollment status" });
  }
});

router.post("/enrollment/sample", upload.single("audio"), async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: "Audio file is required" });
    }
    
    const result = await addEnrollmentSample(String(userId), req.file.buffer);
    
    if (result.error) {
      return res.status(400).json(result);
    }
    
    res.json(result);
  } catch (error) {
    console.error("[VoiceAuth] Enrollment sample error:", error);
    res.status(500).json({ error: "Failed to add enrollment sample" });
  }
});

router.delete("/enrollment/profile", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }
    
    const success = await deleteVoiceProfile(String(userId));
    
    if (success) {
      res.json({ success: true, message: "Voice profile deleted" });
    } else {
      res.status(404).json({ error: "Profile not found or deletion failed" });
    }
  } catch (error) {
    console.error("[VoiceAuth] Delete profile error:", error);
    res.status(500).json({ error: "Failed to delete voice profile" });
  }
});

router.post("/authorize", upload.single("audio"), async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: "Audio file is required" });
    }
    
    const action = (req.body.action as VoiceAction) || "generic_chat";
    
    const authResult = await authorizeVoiceAction(
      String(userId),
      req.file.buffer,
      action
    );
    
    if (authResult.allowed) {
      voiceActivityService.logEvent(userId, {
        type: "speaker_verified",
        content: `Action ${action} authorized`,
        confidence: authResult.confidence,
        authLevel: authResult.level,
      });
    } else {
      voiceActivityService.logEvent(userId, {
        type: "speaker_rejected",
        content: authResult.reason || "Voice not recognized",
        confidence: authResult.confidence,
      });
    }
    
    res.json(authResult);
  } catch (error) {
    console.error("[VoiceAuth] Authorize error:", error);
    res.status(500).json({ error: "Failed to authorize voice action" });
  }
});

router.get("/activity", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }
    
    const recentEvents = voiceActivityService.getRecentActivity(userId, 30);
    const inCall = voiceActivityService.isUserInCall(userId);
    const authStatus = voiceActivityService.getLastAuthLevel(userId);
    
    res.json({
      inCall,
      lastAuthLevel: authStatus.level,
      lastAuthConfidence: authStatus.confidence,
      recentEvents: recentEvents.slice(-10),
    });
  } catch (error) {
    console.error("[VoiceActivity] Get activity error:", error);
    res.status(500).json({ error: "Failed to get voice activity" });
  }
});

router.post("/session/state", async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const { state } = req.body;
    const validStates = ['idle', 'listening', 'thinking', 'speaking'];
    if (!validStates.includes(state)) {
      return res.status(400).json({ error: "Invalid state", validStates });
    }

    const { setVoiceSessionState, getVoiceSessionState } = require("../services/sensory");
    setVoiceSessionState(user.id, state);
    const session = getVoiceSessionState(user.id);
    res.json({ success: true, session });
  } catch (error) {
    console.error("[Voice] Session state error:", error);
    res.status(500).json({ error: "Failed to update session state" });
  }
});

router.get("/session/state", async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const { getVoiceSessionState } = require("../services/sensory");
    const session = getVoiceSessionState(user.id);
    res.json({ success: true, session });
  } catch (error) {
    res.status(500).json({ error: "Failed to get session state" });
  }
});

router.get("/events/:sessionId", (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const session = voiceSessionManager.getSession(sessionId);

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const sendSSE = (event: VoiceSessionEvent) => {
    try {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    } catch {}
  };

  sendSSE({ sessionId, type: "connected", data: { state: session.state, persona: session.persona }, timestamp: Date.now() });

  const listener = (event: VoiceSessionEvent) => sendSSE(event);
  voiceSessionManager.on(`session:${sessionId}`, listener);

  const keepAlive = setInterval(() => {
    try { res.write(": keepalive\n\n"); } catch {}
  }, 15000);

  req.on("close", () => {
    clearInterval(keepAlive);
    voiceSessionManager.off(`session:${sessionId}`, listener);
  });
});

router.get("/sessions/stats", async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  res.json(voiceSessionManager.getStats());
});

export default router;
