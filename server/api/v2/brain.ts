import { Router, Request, Response } from "express";
import { requireAuth } from "../../middleware/auth";
import { brainService } from "../../services/brainService";
import { brainSyncService } from "../../services/brainSyncService";
import { z } from "zod";

const router = Router();

const addKnowledgeSchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string().min(1),
  type: z.enum(['text', 'image', 'video', 'link', 'document', 'code', 'fact', 'concept']),
  category: z.enum(['personal', 'work', 'reference', 'learning', 'creative', 'technical']),
  subcategory: z.string().optional(),
  parentId: z.number().optional(),
  tags: z.array(z.string()).optional(),
  source: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  sourceType: z.enum(['conversation', 'web_search', 'upload', 'manual', 'inference']).optional(),
  importance: z.number().min(0).max(100).optional(),
  isTemporary: z.boolean().optional(),
});

const saveLinkSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  savedFrom: z.enum(['conversation', 'manual', 'email', 'homework']).optional(),
});

const searchSchema = z.object({
  query: z.string().min(1).max(500),
  type: z.string().optional(),
  category: z.string().optional(),
  limit: z.number().min(1).max(100).optional(),
});

router.post("/knowledge", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Non authentifié" });

    const data = addKnowledgeSchema.parse(req.body);
    const knowledge = await brainService.addKnowledge(userId, data);
    res.json(knowledge);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides", details: error.errors });
    }
    console.error("Failed to add knowledge:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.get("/knowledge/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Non authentifié" });

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID invalide" });

    const knowledge = await brainService.getKnowledge(userId, id);
    if (!knowledge) return res.status(404).json({ error: "Connaissance non trouvée" });
    
    res.json(knowledge);
  } catch (error) {
    console.error("Failed to get knowledge:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/knowledge/search", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Non authentifié" });

    const data = searchSchema.parse(req.body);
    const results = await brainService.searchKnowledge(userId, data.query, {
      type: data.type,
      category: data.category,
      limit: data.limit,
    });
    res.json(results);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides", details: error.errors });
    }
    console.error("Failed to search knowledge:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.get("/knowledge/recent/:limit?", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Non authentifié" });

    const limit = parseInt(req.params.limit || "10");
    const results = await brainService.getRecentKnowledge(userId, limit);
    res.json(results);
  } catch (error) {
    console.error("Failed to get recent knowledge:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.get("/knowledge/important/:limit?", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Non authentifié" });

    const limit = parseInt(req.params.limit || "10");
    const results = await brainService.getMostImportantKnowledge(userId, limit);
    res.json(results);
  } catch (error) {
    console.error("Failed to get important knowledge:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/links", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Non authentifié" });

    const data = saveLinkSchema.parse(req.body);
    const link = await brainService.saveLink(userId, data);
    res.json(link);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides", details: error.errors });
    }
    console.error("Failed to save link:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.get("/links", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Non authentifié" });

    const { category, favorite, read, limit } = req.query;
    const results = await brainService.getLinks(userId, {
      category: category as string,
      isFavorite: favorite === 'true' ? true : favorite === 'false' ? false : undefined,
      isRead: read === 'true' ? true : read === 'false' ? false : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
    });
    res.json(results);
  } catch (error) {
    console.error("Failed to get links:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/links/:id/analyze", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Non authentifié" });

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID invalide" });

    await brainService.analyzeLinkContent(userId, id);
    res.json({ success: true });
  } catch (error) {
    console.error("Failed to analyze link:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/query", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Non authentifié" });

    const { query, includeKnowledge, includeLinks, includeMemories, includeProjects, limit } = req.body;
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: "Query requise" });
    }

    const results = await brainService.queryBrain(userId, query, {
      includeKnowledge,
      includeLinks,
      includeMemories,
      includeProjects,
      limit,
    });
    res.json(results);
  } catch (error) {
    console.error("Failed to query brain:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.get("/statistics", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Non authentifié" });

    const stats = await brainService.getStatistics(userId);
    res.json(stats || { totalKnowledge: 0, totalLinks: 0, totalConnections: 0, totalLearnings: 0 });
  } catch (error) {
    console.error("Failed to get brain statistics:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.get("/learnings/recent/:limit?", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Non authentifié" });

    const limit = parseInt(req.params.limit || "20");
    const results = await brainService.getRecentLearnings(userId, limit);
    res.json(results);
  } catch (error) {
    console.error("Failed to get recent learnings:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/maintenance/cleanup", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Non authentifié" });

    const expired = await brainService.cleanupExpiredKnowledge(userId);
    const decayed = await brainService.decayUnusedKnowledge(userId);
    
    res.json({ 
      success: true, 
      expiredRemoved: expired, 
      decayed: decayed 
    });
  } catch (error) {
    console.error("Failed to run brain maintenance:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/sync/full", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Non authentifié" });

    console.log(`[Brain API] Starting full brain sync for user ${userId}`);
    const result = await brainSyncService.fullBrainSync(userId);
    
    res.json({ 
      success: true, 
      migrated: result.migrated,
      connections: result.connections,
      errors: result.errors,
      details: result.details
    });
  } catch (error) {
    console.error("Failed to sync brain:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/sync/memories", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Non authentifié" });

    const result = await brainSyncService.migrateMemoriesToBrain(userId);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("Failed to sync memories:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/sync/searches", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Non authentifié" });

    const result = await brainSyncService.syncWebSearchesToBrain(userId);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("Failed to sync searches:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/sync/connections", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Non authentifié" });

    const result = await brainSyncService.buildKnowledgeConnections(userId);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("Failed to build connections:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
