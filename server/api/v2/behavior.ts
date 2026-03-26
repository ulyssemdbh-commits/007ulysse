/**
 * Behavior API Routes - Phase 3 Proactive Prediction
 * 
 * Endpoints:
 * - GET /api/v2/behavior/suggestions - Get pending suggestions
 * - POST /api/v2/behavior/suggestions/:id/respond - Respond to suggestion
 * - GET /api/v2/behavior/patterns - Get learned patterns
 * - PATCH /api/v2/behavior/patterns/:id - Update pattern automation
 * - GET /api/v2/behavior/stats - Get behavior stats
 * - POST /api/v2/behavior/analyze - Trigger pattern analysis
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { behaviorService } from "../../services/behaviorService";

const router = Router();

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const respondSchema = z.object({
  response: z.enum(["accept", "reject", "automate"]),
});

const updatePatternSchema = z.object({
  isAutomated: z.boolean(),
});

// ============================================================================
// HELPERS
// ============================================================================

function getUserId(req: Request): number {
  const userId = (req as any).userId;
  if (!userId) throw new Error("User not authenticated");
  return userId;
}

function isOwner(req: Request): boolean {
  return (req as any).isOwner === true;
}

function requireOwner(req: Request, res: Response, next: () => void) {
  if (!isOwner(req)) {
    return res.status(403).json({ error: "Accès réservé au propriétaire" });
  }
  next();
}

router.use(requireOwner);

// ============================================================================
// SUGGESTIONS ROUTES
// ============================================================================

router.get("/suggestions", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const suggestions = await behaviorService.getPendingSuggestions(userId);
    res.json(suggestions);
  } catch (error) {
    console.error("[BehaviorAPI] Get suggestions error:", error);
    res.status(500).json({ error: "Échec de récupération des suggestions" });
  }
});

router.post("/suggestions/:id/respond", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const suggestionId = parseInt(req.params.id);
    const parsed = respondSchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({ 
        error: "Données invalides", 
        details: parsed.error.flatten() 
      });
    }
    
    const success = await behaviorService.respondToSuggestion(
      userId, 
      suggestionId, 
      parsed.data.response
    );
    
    if (!success) {
      return res.status(404).json({ error: "Suggestion non trouvée" });
    }
    
    res.json({ 
      success: true, 
      message: `Suggestion ${parsed.data.response === "accept" ? "acceptée" : 
                parsed.data.response === "reject" ? "rejetée" : "automatisée"}` 
    });
  } catch (error) {
    console.error("[BehaviorAPI] Respond error:", error);
    res.status(500).json({ error: "Échec de réponse à la suggestion" });
  }
});

// ============================================================================
// PATTERNS ROUTES
// ============================================================================

router.get("/patterns", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const patterns = await behaviorService.getLearnedPatterns(userId);
    res.json(patterns);
  } catch (error) {
    console.error("[BehaviorAPI] Get patterns error:", error);
    res.status(500).json({ error: "Échec de récupération des patterns" });
  }
});

router.get("/patterns/automated", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const patterns = await behaviorService.getAutomatedPatterns(userId);
    res.json(patterns);
  } catch (error) {
    console.error("[BehaviorAPI] Get automated patterns error:", error);
    res.status(500).json({ error: "Échec de récupération des patterns automatisés" });
  }
});

router.patch("/patterns/:id", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const patternId = parseInt(req.params.id);
    const parsed = updatePatternSchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({ 
        error: "Données invalides", 
        details: parsed.error.flatten() 
      });
    }
    
    const success = await behaviorService.updatePatternAutomation(
      userId, 
      patternId, 
      parsed.data.isAutomated
    );
    
    if (!success) {
      return res.status(404).json({ error: "Pattern non trouvé" });
    }
    
    res.json({ 
      success: true, 
      message: parsed.data.isAutomated ? "Pattern automatisé" : "Automatisation désactivée" 
    });
  } catch (error) {
    console.error("[BehaviorAPI] Update pattern error:", error);
    res.status(500).json({ error: "Échec de mise à jour du pattern" });
  }
});

// ============================================================================
// STATS & ANALYSIS
// ============================================================================

router.get("/stats", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const stats = await behaviorService.getStats(userId);
    res.json(stats);
  } catch (error) {
    console.error("[BehaviorAPI] Get stats error:", error);
    res.status(500).json({ error: "Échec de récupération des statistiques" });
  }
});

router.post("/analyze", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    
    // Trigger pattern analysis and suggestion generation
    const suggestionsCreated = await behaviorService.generateSuggestions(userId);
    
    res.json({ 
      success: true, 
      message: `Analyse terminée. ${suggestionsCreated} nouvelle(s) suggestion(s) créée(s).`,
      suggestionsCreated,
    });
  } catch (error) {
    console.error("[BehaviorAPI] Analyze error:", error);
    res.status(500).json({ error: "Échec de l'analyse" });
  }
});

export default router;
