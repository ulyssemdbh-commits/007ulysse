/**
 * Behavior API - User behavior patterns and suggestions
 */

import { Router, Request, Response } from "express";
import { behaviorService } from "../services/behaviorService";

const router = Router();

// Require authentication
const requireAuth = (req: Request, res: Response, next: Function) => {
  const userId = (req as any).userId || (req as any).user?.id;
  const secretKey = req.headers["x-system-status-key"] || req.query.key;
  const SYSTEM_STATUS_SECRET = process.env.SYSTEM_STATUS_SECRET;
  
  if (userId || (SYSTEM_STATUS_SECRET && secretKey === SYSTEM_STATUS_SECRET)) {
    (req as any).resolvedUserId = userId || 1;
    return next();
  }
  
  res.status(401).json({ error: "Unauthorized" });
};

router.use(requireAuth);

/**
 * GET /api/v2/behavior/patterns - Get detected patterns
 */
router.get("/patterns", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).resolvedUserId;
    const minConfidence = parseInt(String(req.query.minConfidence || "0"));
    const type = req.query.type as string;
    const confirmedOnly = req.query.confirmed === "true";

    const patterns = await behaviorService.getPatterns(userId, {
      minConfidence,
      patternType: type,
      confirmed: confirmedOnly ? true : undefined
    });

    res.json({
      userId,
      patterns,
      count: patterns.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error getting patterns:", error);
    res.status(500).json({ error: "Failed to get patterns" });
  }
});

/**
 * GET /api/v2/behavior/suggestions - Get proactive suggestions
 */
router.get("/suggestions", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).resolvedUserId;
    const activeOnly = req.query.active !== "false";

    const suggestions = await behaviorService.getSuggestions(userId, activeOnly);

    res.json({
      userId,
      suggestions,
      count: suggestions.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error getting suggestions:", error);
    res.status(500).json({ error: "Failed to get suggestions" });
  }
});

/**
 * POST /api/v2/behavior/suggestions/:id/feedback - Provide feedback on suggestion
 */
router.post("/suggestions/:id/feedback", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).resolvedUserId;
    const suggestionId = parseInt(req.params.id);
    const { accepted, dismissed } = req.body;

    if (accepted) {
      await behaviorService.acceptSuggestion(suggestionId, userId);
    } else if (dismissed) {
      await behaviorService.dismissSuggestion(suggestionId, userId);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error processing feedback:", error);
    res.status(500).json({ error: "Failed to process feedback" });
  }
});

/**
 * POST /api/v2/behavior/analyze - Trigger behavior analysis
 */
router.post("/analyze", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).resolvedUserId;
    const { days = 7 } = req.body;

    await behaviorService.analyzeUserBehavior(userId, days);

    const patterns = await behaviorService.getPatterns(userId, { minConfidence: 50 });
    const suggestions = await behaviorService.getSuggestions(userId, true);

    res.json({
      success: true,
      patternsFound: patterns.length,
      suggestionsGenerated: suggestions.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error analyzing behavior:", error);
    res.status(500).json({ error: "Failed to analyze behavior" });
  }
});

/**
 * GET /api/v2/behavior/stats - Get behavior statistics
 */
router.get("/stats", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).resolvedUserId;
    const days = parseInt(String(req.query.days || "7"));

    const stats = await behaviorService.getStats(userId, days);

    res.json({
      userId,
      ...stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error getting stats:", error);
    res.status(500).json({ error: "Failed to get stats" });
  }
});

export default router;
