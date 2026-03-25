import express, { Request, Response } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { racService } from "../services/racService";
import { emitHomeworkUpdated, emitHomeworkDeleted } from "../services/realtimeSync";

const router = express.Router();

function getUserId(req: Request): number {
  const userId = (req.session as any)?.userId;
  if (!userId) {
    throw new Error("User not authenticated");
  }
  return userId;
}

// =====================================================
// Ulysse Homework API (Owner background tasks)
// =====================================================

router.get("/homework", async (req, res) => {
  try {
    const userId = getUserId(req);
    const homework = await storage.getHomework(userId);
    
    const { homeworkExecution } = await import("@shared/schema");
    const enrichedHomework = await Promise.all(homework.map(async (hw) => {
      const executions = await db.select()
        .from(homeworkExecution)
        .where(and(
          eq(homeworkExecution.homeworkId, hw.id),
          eq(homeworkExecution.userId, userId)
        ));
      
      const completedRuns = executions.filter(e => e.status === "completed").length;
      const failedRuns = executions.filter(e => e.status === "failed").length;
      const lastCompletedExecution = executions.filter(e => e.status === "completed").sort((a, b) => 
        (b.completedAt?.getTime() || 0) - (a.completedAt?.getTime() || 0)
      )[0];
      const hasResults = !!lastCompletedExecution?.resultSummary && lastCompletedExecution.resultSummary.length > 50;
      
      return {
        ...hw,
        executionStats: {
          totalRuns: executions.length,
          completedRuns,
          failedRuns,
          hasResults,
          lastRunAt: executions.length > 0 ? executions[executions.length - 1].completedAt : null,
          lastResultSummary: lastCompletedExecution?.resultSummary || null,
          lastResultArtifacts: lastCompletedExecution?.artifacts || null,
        }
      };
    }));
    
    res.json(enrichedHomework);
  } catch (err) {
    console.error("Failed to get homework:", err);
    res.status(500).json({ message: "Failed to get homework" });
  }
});

router.post("/homework", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { title, description, priority, recurrence, dueDate } = req.body;
    
    if (!title?.trim()) {
      return res.status(400).json({ message: "Title is required" });
    }
    
    const homework = await storage.createHomework({
      userId,
      title: title.trim(),
      description: description?.trim() || null,
      priority: priority || "medium",
      recurrence: recurrence || "none",
      dueDate: dueDate ? new Date(dueDate) : null,
      status: "pending",
      notes: null
    });
    
    if (recurrence && recurrence !== "none") {
      const { homeworkExecutionService } = await import("../services/homeworkExecution");
      homeworkExecutionService.executeHomework(userId, homework, "auto").catch(err => {
        console.error("Failed to execute homework immediately:", err);
      });
    }
    
    emitHomeworkUpdated(userId);
    res.status(201).json(homework);
  } catch (err) {
    console.error("Failed to create homework:", err);
    res.status(500).json({ message: "Failed to create homework" });
  }
});

router.patch("/homework/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    const id = parseInt(req.params.id);
    const { title, description, priority, recurrence, status, notes, dueDate } = req.body;
    
    const existingHomework = await storage.getHomeworkItem(id, userId);
    const wasNotCompleted = existingHomework && existingHomework.status !== "completed";
    
    const update: any = {};
    if (title !== undefined) update.title = title.trim();
    if (description !== undefined) update.description = description?.trim() || null;
    if (priority !== undefined) update.priority = priority;
    if (recurrence !== undefined) update.recurrence = recurrence;
    if (status !== undefined) update.status = status;
    if (notes !== undefined) update.notes = notes?.trim() || null;
    if (dueDate !== undefined) update.dueDate = dueDate ? new Date(dueDate) : null;
    
    const homework = await storage.updateHomework(id, userId, update);
    if (!homework) {
      return res.status(404).json({ message: "Homework not found" });
    }
    
    if (wasNotCompleted && homework.status === "completed") {
      const { homeworkLearningService } = await import("../services/homeworkLearning");
      homeworkLearningService.learnFromCompletion(userId, homework).catch(err => {
        console.error("Failed to learn from homework completion:", err);
      });
    }
    
    emitHomeworkUpdated(userId);
    res.json(homework);
  } catch (err) {
    console.error("Failed to update homework:", err);
    res.status(500).json({ message: "Failed to update homework" });
  }
});

router.delete("/homework/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    const id = parseInt(req.params.id);
    await storage.deleteHomework(id, userId);
    emitHomeworkDeleted(userId);
    res.status(204).send();
  } catch (err) {
    console.error("Failed to delete homework:", err);
    res.status(500).json({ message: "Failed to delete homework" });
  }
});

router.post("/homework/:id/execute", async (req, res) => {
  try {
    const userId = getUserId(req);
    const id = parseInt(req.params.id);
    const homework = await storage.getHomeworkItem(id, userId);
    
    if (!homework) {
      return res.status(404).json({ message: "Homework not found" });
    }
    
    const { homeworkExecutionService } = await import("../services/homeworkExecution");
    const execution = await homeworkExecutionService.executeHomework(userId, homework, "manual");
    
    emitHomeworkUpdated(userId);
    res.json({ success: true, execution });
  } catch (err) {
    console.error("Failed to execute homework:", err);
    res.status(500).json({ message: "Failed to execute homework" });
  }
});

router.post("/homework/daily-trigger", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { homeworkExecutionService } = await import("../services/homeworkExecution");
    const executedCount = await homeworkExecutionService.executeDailyTasks(userId);
    res.json({ success: true, executedCount });
  } catch (err) {
    console.error("Failed to trigger daily homework:", err);
    res.status(500).json({ message: "Failed to trigger daily homework" });
  }
});

router.get("/homework/history", async (req, res) => {
  try {
    const userId = getUserId(req);
    const homeworkId = req.query.homeworkId ? parseInt(req.query.homeworkId as string) : undefined;
    const { homeworkExecutionService } = await import("../services/homeworkExecution");
    const history = await homeworkExecutionService.getExecutionHistory(userId, homeworkId);
    res.json(history);
  } catch (err) {
    console.error("Failed to get homework history:", err);
    res.status(500).json({ message: "Failed to get homework history" });
  }
});

router.get("/homework/metrics", async (req, res) => {
  try {
    const userId = getUserId(req);
    const days = req.query.days ? parseInt(req.query.days as string) : 7;
    const { homeworkIntelligence } = await import("../services/homeworkIntelligence");
    
    const metrics = await homeworkIntelligence.getExecutionMetrics(userId, days);
    const cacheStats = homeworkIntelligence.getPromptCacheStats();
    
    res.json({
      ...metrics,
      promptCache: cacheStats
    });
  } catch (err) {
    console.error("Failed to get homework metrics:", err);
    res.status(500).json({ message: "Failed to get homework metrics" });
  }
});

router.get("/homework/weekly-insights", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { homeworkIntelligence } = await import("../services/homeworkIntelligence");
    const insights = await homeworkIntelligence.generateWeeklyInsights(userId);
    res.json({ insights });
  } catch (err) {
    console.error("Failed to get weekly insights:", err);
    res.status(500).json({ message: "Failed to get weekly insights" });
  }
});

// =====================================================
// AI Preview Confirmation API
// =====================================================

router.post("/v2/ai/preview/response", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { requestId, confirmed } = req.body;
    
    if (!requestId || typeof confirmed !== "boolean") {
      return res.status(400).json({ message: "Missing requestId or confirmed" });
    }
    
    const { handlePreviewResponse } = await import("../services/previewService");
    const success = handlePreviewResponse(requestId, confirmed);
    
    res.json({ success });
  } catch (err) {
    console.error("Failed to handle preview response:", err);
    res.status(500).json({ message: "Failed to handle preview response" });
  }
});

router.get("/v2/ai/preview/pending", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { getPendingPreviewsForUser } = await import("../services/previewService");
    const previews = getPendingPreviewsForUser(userId);
    res.json(previews);
  } catch (err) {
    console.error("Failed to get pending previews:", err);
    res.status(500).json({ message: "Failed to get pending previews" });
  }
});

// =====================================================
// Ulysse Charter API (Persistent behavior rules)
// =====================================================

router.get("/charter", async (req, res) => {
  try {
    const userId = getUserId(req);
    const charter = await storage.getCharter(userId);
    res.json(charter);
  } catch (err) {
    console.error("Failed to get charter:", err);
    res.status(500).json({ message: "Failed to get charter" });
  }
});

router.put("/charter", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { insertUlysseCharterSchema } = await import("@shared/schema");
    
    const { userId: _ignored, ...safeBody } = req.body;
    
    const validationResult = insertUlysseCharterSchema.partial().safeParse(safeBody);
    if (!validationResult.success) {
      return res.status(400).json({ 
        message: "Invalid charter data", 
        errors: validationResult.error.errors 
      });
    }
    
    const { userId: _alsoIgnored, ...safeData } = validationResult.data;
    
    const charter = await storage.updateCharter(userId, safeData);
    res.json(charter);
  } catch (err) {
    console.error("Failed to update charter:", err);
    res.status(500).json({ message: "Failed to update charter" });
  }
});

// =====================================================
// Voice Settings API
// =====================================================

router.get("/voice-settings", async (req, res) => {
  try {
    const userId = getUserId(req);
    let settings = await storage.getVoiceSettings(userId);
    
    const user = await storage.getUser(userId);
    const isOwner = user?.isOwner ?? false;
    const defaultVoice = isOwner ? "onyx" : "nova";
    
    if (!settings) {
      settings = {
        id: 0,
        userId,
        ttsVoice: defaultVoice,
        ttsSpeed: 100,
        ttsPitch: "normal",
        ttsAutoSpeak: true,
        ttsMaxLength: 500,
        sttMode: "auto",
        sttLanguage: "fr-FR",
        sttWakeWordEnabled: true,
        preferBrowserFallback: false,
        voiceFeedbackEnabled: true,
        createdAt: null,
        updatedAt: null
      };
    }
    
    res.json(settings);
  } catch (err) {
    console.error("Failed to get voice settings:", err);
    res.status(500).json({ message: "Failed to get voice settings" });
  }
});

router.patch("/voice-settings", async (req, res) => {
  try {
    const userId = getUserId(req);
    const update = req.body;
    
    const allowedFields = [
      "ttsVoice", "ttsSpeed", "ttsPitch", "ttsAutoSpeak", "ttsMaxLength",
      "sttMode", "sttLanguage", "sttWakeWordEnabled",
      "preferBrowserFallback", "voiceFeedbackEnabled"
    ];
    
    const sanitizedUpdate: Record<string, any> = {};
    for (const key of allowedFields) {
      if (key in update) {
        sanitizedUpdate[key] = update[key];
      }
    }
    
    const settings = await storage.createOrUpdateVoiceSettings(userId, sanitizedUpdate);
    res.json(settings);
  } catch (err) {
    console.error("Failed to update voice settings:", err);
    res.status(500).json({ message: "Failed to update voice settings" });
  }
});

router.get("/voice-diagnostic", async (req, res) => {
  try {
    const userId = getUserId(req);
    const user = await storage.getUser(userId);
    const settings = await storage.getVoiceSettings(userId);
    
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const isModelfarm = baseUrl?.includes("modelfarm");
    
    const defaultVoice = user?.isOwner ? "onyx" : "nova";
    
    const diagnostic = {
      platform: "server",
      tts: {
        openaiAvailable: !isModelfarm && !!apiKey,
        browserFallbackAvailable: true,
        preferredVoice: settings?.ttsVoice || defaultVoice,
        speed: settings?.ttsSpeed || 100
      },
      stt: {
        whisperAvailable: !isModelfarm && !!apiKey,
        browserFallbackAvailable: true,
        preferredMode: settings?.sttMode || "auto",
        language: settings?.sttLanguage || "fr-FR"
      },
      user: {
        isOwner: user?.isOwner || false,
        persona: user?.isOwner ? "Ulysse" : "Iris"
      },
      recommendations: [] as string[]
    };
    
    if (isModelfarm) {
      diagnostic.recommendations.push("TTS/STT via navigateur recommandé (modelfarm actif)");
    }
    
    res.json(diagnostic);
  } catch (err) {
    console.error("Voice diagnostic error:", err);
    res.status(500).json({ message: "Diagnostic failed" });
  }
});

// =====================================================
// RAC (Recherche Augmentée par Contexte) Metrics API
// =====================================================

router.get("/rac/metrics", requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const daysBack = parseInt(req.query.days as string) || 30;
    
    const metrics = await racService.getRACMetrics(userId, daysBack);
    res.json(metrics);
  } catch (err) {
    console.error("Failed to get RAC metrics:", err);
    res.status(500).json({ message: "Failed to get RAC metrics" });
  }
});

router.post("/rac/test-search", requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { query, numResults = 8 } = req.body;
    
    if (!query || typeof query !== "string") {
      return res.status(400).json({ message: "Query is required" });
    }
    
    const results = await racService.searchWithRAC(userId, query, numResults);
    res.json(results);
  } catch (err) {
    console.error("RAC test search failed:", err);
    res.status(500).json({ message: "RAC search failed" });
  }
});

// =====================================================
// Misc Routes
// =====================================================

router.get("/marseille-info", requireAuth, async (req, res) => {
  try {
    const { fetchMarseilleData } = await import("../services/marseilleWeather");
    const data = await fetchMarseilleData();
    res.json(data);
  } catch (err: any) {
    console.error("Marseille info error:", err);
    res.status(500).json({ message: err.message || "Erreur lors de la recuperation des donnees" });
  }
});

router.get("/face-descriptors/:userId", requireAuth, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) {
      return res.status(400).json({ message: "ID utilisateur invalide" });
    }
    
    const descriptors = await storage.getFaceDescriptors(userId);
    res.json(descriptors);
  } catch (err: any) {
    console.error("Get face descriptors error:", err);
    res.status(500).json({ message: err.message || "Erreur lors de la lecture des descripteurs" });
  }
});

router.post("/face-descriptors", requireAuth, async (req, res) => {
  try {
    const { userId, descriptor } = req.body;
    
    if (!userId || !descriptor || !Array.isArray(descriptor)) {
      return res.status(400).json({ message: "userId et descriptor (array) requis" });
    }
    
    const result = await storage.createFaceDescriptor({ userId, descriptor });
    res.status(201).json(result);
  } catch (err: any) {
    console.error("Create face descriptor error:", err);
    res.status(500).json({ message: err.message || "Erreur lors de la creation du descripteur" });
  }
});

router.delete("/face-descriptors/:userId", requireAuth, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) {
      return res.status(400).json({ message: "ID utilisateur invalide" });
    }
    
    await storage.deleteFaceDescriptors(userId);
    res.json({ success: true, message: "Descripteurs supprimes" });
  } catch (err: any) {
    console.error("Delete face descriptors error:", err);
    res.status(500).json({ message: err.message || "Erreur lors de la suppression" });
  }
});

export default router;
