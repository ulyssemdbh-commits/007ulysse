/**
 * Hub Routes - Brief quotidien agrégé + modules Sports, Payroll, Gmail, AppToOrder, PUGI
 * v2 - Mars 2026
 */

import { Router, Request, Response } from "express";
import { hubService } from "../services/hubService";
import { hubActionService } from "../services/hubActionService";
import { featureFlagsService } from "../services/featureFlagsService";
import { metricsService } from "../services/metricsService";
import { ragService } from "../services/ragService";
import { ocrService } from "../services/ocrService";
import { analyzeDocumentViaVisionHub } from "../services/sensory";
import multer from "multer";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Owner-only middleware
function requireOwner(req: Request, res: Response, next: Function) {
  const user = (req as any).user;
  if (!user?.isOwner) {
    return res.status(403).json({ error: "Owner access required" });
  }
  next();
}

// GET /api/hub/today - Brief quotidien
router.get("/today", requireOwner, async (req: Request, res: Response) => {
  try {
    if (!featureFlagsService.isEnabled("ulysse.hub_brief.enabled")) {
      return res.status(503).json({ error: "Hub brief is disabled" });
    }

    const user = (req as any).user;
    const brief = await hubService.getTodayBrief(user.id);
    
    res.json({
      success: true,
      brief,
      formatted: hubService.formatBriefForChat(brief)
    });
  } catch (error) {
    console.error("[Hub] Today brief error:", error);
    res.status(500).json({ error: "Failed to generate brief" });
  }
});

// GET /api/hub/health - Santé système
router.get("/health", requireOwner, async (req: Request, res: Response) => {
  try {
    const health = metricsService.getSystemHealth();
    const jobStats = metricsService.getJobStats(24);
    const apiStats = metricsService.getApiStats(24);
    
    res.json({
      success: true,
      health,
      jobs: jobStats,
      api: apiStats
    });
  } catch (error) {
    console.error("[Hub] Health check error:", error);
    res.status(500).json({ error: "Health check failed" });
  }
});

// GET /api/hub/metrics - Métriques détaillées
router.get("/metrics", requireOwner, async (req: Request, res: Response) => {
  try {
    const summary = metricsService.getSummary();
    const report = metricsService.generateDailyReport();
    
    res.json({
      success: true,
      summary,
      report
    });
  } catch (error) {
    console.error("[Hub] Metrics error:", error);
    res.status(500).json({ error: "Metrics retrieval failed" });
  }
});

// GET /api/hub/flags - Feature flags
router.get("/flags", requireOwner, async (req: Request, res: Response) => {
  try {
    const flags = featureFlagsService.getAllFlags();
    const summary = featureFlagsService.getSummary();
    
    res.json({
      success: true,
      flags,
      summary
    });
  } catch (error) {
    console.error("[Hub] Flags error:", error);
    res.status(500).json({ error: "Flags retrieval failed" });
  }
});

// PUT /api/hub/flags/:id - Toggle feature flag
router.put("/flags/:id", requireOwner, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { enabled, config } = req.body;
    
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be boolean" });
    }

    const success = featureFlagsService.setFlag(id, enabled, config);
    if (!success) {
      return res.status(404).json({ error: "Flag not found" });
    }
    
    res.json({
      success: true,
      flag: featureFlagsService.getFlag(id)
    });
  } catch (error) {
    console.error("[Hub] Flag update error:", error);
    res.status(500).json({ error: "Flag update failed" });
  }
});

// POST /api/hub/ocr - OCR analysis
router.post("/ocr", requireOwner, upload.single("image"), async (req: Request, res: Response) => {
  try {
    if (!featureFlagsService.isEnabled("ulysse.ocr.enabled")) {
      return res.status(503).json({ error: "OCR is disabled" });
    }

    let imageInput: string | Buffer;
    
    if (req.file) {
      imageInput = req.file.buffer;
    } else if (req.body.image) {
      // Base64 image in body
      imageInput = req.body.image;
    } else if (req.body.url) {
      // URL to fetch
      const response = await fetch(req.body.url);
      const arrayBuffer = await response.arrayBuffer();
      imageInput = Buffer.from(arrayBuffer);
    } else {
      return res.status(400).json({ error: "No image provided" });
    }

    const analyze = req.body.analyze !== false;
    const user = (req as any).user;
    
    if (analyze) {
      // Route through VisionHub for unified tracking
      const visionResult = await analyzeDocumentViaVisionHub(
        imageInput,
        (req.file?.originalname || 'document.pdf'),
        (req.file?.mimetype || 'application/pdf'),
        user?.id || 1
      );
      res.json({ 
        success: true, 
        analysis: {
          text: visionResult.text,
          structured: visionResult.structured,
          insights: visionResult.insights
        }
      });
    } else {
      const result = await ocrService.extractText(imageInput);
      res.json({ success: true, result });
    }
  } catch (error) {
    console.error("[Hub] OCR error:", error);
    res.status(500).json({ error: "OCR processing failed" });
  }
});

// POST /api/hub/rag/search - RAG search
router.post("/rag/search", requireOwner, async (req: Request, res: Response) => {
  try {
    if (!featureFlagsService.isEnabled("ulysse.rag.enabled")) {
      return res.status(503).json({ error: "RAG is disabled" });
    }

    const { query, type, limit } = req.body;
    
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "query is required" });
    }

    const results = await ragService.queryWithContext(query, { type, limit });
    res.json({ success: true, ...results });
  } catch (error) {
    console.error("[Hub] RAG search error:", error);
    res.status(500).json({ error: "RAG search failed" });
  }
});

// POST /api/hub/rag/index - Index documents
router.post("/rag/index", requireOwner, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { source } = req.body;
    
    let indexed = 0;
    
    if (source === "knowledge" || source === "all") {
      indexed += await ragService.indexKnowledgeBase(user.id);
    }
    if (source === "sugu" || source === "all") {
      indexed += await ragService.indexSuguData();
    }
    
    res.json({ success: true, indexed, stats: ragService.getStats() });
  } catch (error) {
    console.error("[Hub] RAG index error:", error);
    res.status(500).json({ error: "RAG indexing failed" });
  }
});

// GET /api/hub/rag/stats - RAG stats
router.get("/rag/stats", requireOwner, async (req: Request, res: Response) => {
  try {
    const stats = ragService.getStats();
    res.json({ success: true, stats });
  } catch (error) {
    console.error("[Hub] RAG stats error:", error);
    res.status(500).json({ error: "RAG stats failed" });
  }
});

// GET /api/hub/sports - Résumé sports
router.get("/sports", requireOwner, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const result = await hubActionService.handleSportsResume({ isOwner: true, userId: user.id });
    res.json(result);
  } catch (error) {
    console.error("[Hub] Sports error:", error);
    res.status(500).json({ error: "Sports summary failed" });
  }
});

// GET /api/hub/payroll - Résumé paie/RH
router.get("/payroll", requireOwner, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const result = await hubActionService.handlePayrollResume({ isOwner: true, userId: user.id });
    res.json(result);
  } catch (error) {
    console.error("[Hub] Payroll error:", error);
    res.status(500).json({ error: "Payroll summary failed" });
  }
});

// GET /api/hub/apptoorder - État AppToOrder
router.get("/apptoorder", requireOwner, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const result = await hubActionService.handleAppToOrderStatus({ isOwner: true, userId: user.id });
    res.json(result);
  } catch (error) {
    console.error("[Hub] AppToOrder error:", error);
    res.status(500).json({ error: "AppToOrder status failed" });
  }
});

// GET /api/hub/gmail - Résumé Gmail
router.get("/gmail", requireOwner, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const result = await hubActionService.handleGmailResume({ isOwner: true, userId: user.id });
    res.json(result);
  } catch (error) {
    console.error("[Hub] Gmail error:", error);
    res.status(500).json({ error: "Gmail summary failed" });
  }
});

// GET /api/hub/pugi - Intelligence proactive PUGI
router.get("/pugi", requireOwner, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const result = await hubActionService.handlePugiDigest({ isOwner: true, userId: user.id });
    res.json(result);
  } catch (error) {
    console.error("[Hub] PUGI error:", error);
    res.status(500).json({ error: "PUGI digest failed" });
  }
});

// GET /api/hub/selfhealing - État auto-guérison
router.get("/selfhealing", requireOwner, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const result = await hubActionService.handleSelfHealingStatus({ isOwner: true, userId: user.id });
    res.json(result);
  } catch (error) {
    console.error("[Hub] SelfHealing error:", error);
    res.status(500).json({ error: "Self-healing status failed" });
  }
});

// GET /api/hub/journal - Journal d'introspection
router.get("/journal", requireOwner, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const result = await hubActionService.handleJournalIntrospection({ isOwner: true, userId: user.id });
    res.json(result);
  } catch (error) {
    console.error("[Hub] Journal error:", error);
    res.status(500).json({ error: "Journal retrieval failed" });
  }
});

// GET /api/hub/panorama - Vue panoramique de tous les modules
router.get("/panorama", requireOwner, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const persona = { isOwner: true, userId: user.id };

    const [brief, sports, payroll, apptoorder, gmail, pugi, selfhealing] = await Promise.all([
      hubService.getTodayBrief(user.id).catch(() => null),
      hubActionService.handleSportsResume(persona).catch(() => ({ success: false, message: "N/A" })),
      hubActionService.handlePayrollResume(persona).catch(() => ({ success: false, message: "N/A" })),
      hubActionService.handleAppToOrderStatus(persona).catch(() => ({ success: false, message: "N/A" })),
      hubActionService.handleGmailResume(persona).catch(() => ({ success: false, message: "N/A" })),
      hubActionService.handlePugiDigest(persona).catch(() => ({ success: false, message: "N/A" })),
      hubActionService.handleSelfHealingStatus(persona).catch(() => ({ success: false, message: "N/A" })),
    ]);

    res.json({
      success: true,
      brief: brief ? hubService.formatBriefForChat(brief) : null,
      modules: { sports, payroll, apptoorder, gmail, pugi, selfhealing },
    });
  } catch (error) {
    console.error("[Hub] Panorama error:", error);
    res.status(500).json({ error: "Panorama failed" });
  }
});

router.get("/attention", requireOwner, async (_req: Request, res: Response) => {
  try {
    const { brainHub } = require("../services/sensory");
    const stats = brainHub.getAttentionStats();
    const consciousness = brainHub.getConsciousnessPrompt();
    res.json({ success: true, attention: stats, consciousness });
  } catch (error) {
    console.error("[Hub] Attention stats error:", error);
    res.status(500).json({ error: "Attention stats failed" });
  }
});

router.post("/vision/live", requireOwner, upload.single("frame"), async (req: Request, res: Response) => {
  try {
    const prompt = (req.body?.prompt as string) || "Décris précisément ce que tu vois sur cette image. Si tu vois des personnes, des objets ou du texte, décris-les.";
    const context = (req.body?.context as string) || "";

    let imageBase64: string;
    if (req.file) {
      imageBase64 = req.file.buffer.toString("base64");
    } else if (req.body?.imageBase64) {
      imageBase64 = req.body.imageBase64
        .replace(/^data:image\/[a-zA-Z+]+;base64,/, "")
        .replace(/\s/g, "");
    } else {
      return res.status(400).json({ error: "No image provided (use 'frame' file or 'imageBase64' field)" });
    }

    if (!imageBase64 || imageBase64.length < 100) {
      return res.status(400).json({ error: "Image data too small or empty — camera may not be ready" });
    }

    const sampleCheck = imageBase64.substring(0, 200) + imageBase64.substring(imageBase64.length - 50);
    const validBase64 = /^[A-Za-z0-9+/]+=*$/.test(sampleCheck);
    if (!validBase64) {
      console.error("[Hub] Invalid base64 chars detected, length:", imageBase64.length, "first50:", imageBase64.substring(0, 50));
      return res.status(400).json({ error: "Invalid base64 encoding in image data" });
    }
    console.log("[Hub] Live vision: base64 valid, length:", imageBase64.length);

    const apiKey = process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    const baseURL = process.env.OPENAI_API_KEY
      ? "https://api.openai.com/v1"
      : process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;

    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({ apiKey, baseURL });

    const systemPrompt = `Tu es Ulysse, un assistant IA avec vision en temps réel. Tu analyses ce que la caméra de Maurice te montre.
Sois concis mais précis. Décris l'essentiel en 2-3 phrases maximum.
${context ? `Contexte supplémentaire: ${context}` : ""}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 500,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
                detail: "low",
              },
            },
          ],
        },
      ],
    });

    const analysis = response.choices[0]?.message?.content || "";
    const tokensUsed = response.usage?.total_tokens || 0;

    try {
      const { visionHub } = require("../services/sensory");
      await visionHub.see({
        rawData: imageBase64,
        metadata: {
          source: "camera",
          contentType: "image",
          timestamp: Date.now(),
          userId: (req as any).user?.id || 1,
        },
        extractedText: analysis,
      });
    } catch {}

    res.json({
      success: true,
      analysis,
      tokensUsed,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    console.error("[Hub] Live vision error:", error.message);
    res.status(500).json({ error: error.message || "Vision analysis failed" });
  }
});

router.get("/vision/health", requireOwner, async (_req: Request, res: Response) => {
  try {
    const { ulysseCoreEngine } = require("../services/core/UlysseCoreEngine");
    const stats = ulysseCoreEngine.getStats();
    res.json({
      success: true,
      providerHealth: stats.providerHealth,
      stats: {
        totalRequests: stats.totalRequests,
        errorCount: stats.errorCount,
        fallbacksTriggered: stats.fallbacksTriggered,
        circuitBreaks: stats.circuitBreaks,
        cacheHitRate: (stats.cacheHitRate * 100).toFixed(1) + '%',
        avgLatencyMs: Math.round(stats.avgLatencyMs),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
