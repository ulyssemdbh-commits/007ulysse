import { Router } from "express";
import { z } from "zod";
import { bettingProfileService } from "../services/bettingProfileService";
import { insertBettingProfileSchema, insertBettingHistorySchema } from "@shared/schema";

const router = Router();

// Auth helper - requires valid session
function requireAuth(req: any, res: any): number | null {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  return userId;
}

// Validation schemas
const predictSchema = z.object({
  homeTeam: z.string().min(1),
  awayTeam: z.string().min(1),
  league: z.string().min(1),
  matchDate: z.string().or(z.date()),
  predictedBetType: z.string().min(1),
  predictedOdds: z.number().optional(),
  confidence: z.number().min(0).max(100).optional(),
  reasoning: z.string().optional(),
  tags: z.array(z.string()).optional(),
  matchId: z.number().optional(),
});

const settleSchema = z.object({
  homeScore: z.number().min(0),
  awayScore: z.number().min(0),
});

const profileUpdateSchema = z.object({
  favoriteLeagues: z.array(z.string()).optional(),
  preferredBetTypes: z.array(z.string()).optional(),
  riskProfile: z.enum(["safe", "balanced", "aggressive"]).optional(),
  favoriteTeams: z.array(z.string()).optional(),
  blacklistedTeams: z.array(z.string()).optional(),
  minOdds: z.number().min(1).max(100).optional(),
  maxOdds: z.number().min(1).max(100).optional(),
  typicalStake: z.number().min(0).optional(),
  weeklyBudget: z.number().min(0).optional(),
  preferredTimeSlots: z.array(z.string()).optional(),
  preferredTags: z.array(z.string()).optional(),
  avoidedTags: z.array(z.string()).optional(),
});

// Get user betting profile
router.get("/profile", async (req, res) => {
  try {
    const userId = requireAuth(req, res);
    if (!userId) return;
    
    const profile = await bettingProfileService.getOrCreateProfile(userId);
    res.json(profile);
  } catch (error: any) {
    console.error("[BETTING] Error getting profile:", error);
    res.status(500).json({ error: error.message });
  }
});

// Update betting profile
router.patch("/profile", async (req, res) => {
  try {
    const userId = requireAuth(req, res);
    if (!userId) return;
    
    const parseResult = profileUpdateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid profile data", details: parseResult.error.errors });
    }
    
    await bettingProfileService.getOrCreateProfile(userId);
    const profile = await bettingProfileService.updateProfile(userId, parseResult.data);
    res.json(profile);
  } catch (error: any) {
    console.error("[BETTING] Error updating profile:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get betting history
router.get("/history", async (req, res) => {
  try {
    const userId = requireAuth(req, res);
    if (!userId) return;
    
    const { limit, offset, result, league, startDate, endDate } = req.query;
    
    const history = await bettingProfileService.getHistory(userId, {
      limit: limit ? parseInt(limit as string) : 50,
      offset: offset ? parseInt(offset as string) : 0,
      result: result as string,
      league: league as string,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
    });
    
    res.json(history);
  } catch (error: any) {
    console.error("[BETTING] Error getting history:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get pending predictions
router.get("/pending", async (req, res) => {
  try {
    const userId = requireAuth(req, res);
    if (!userId) return;
    
    const pending = await bettingProfileService.getPendingPredictions(userId);
    res.json(pending);
  } catch (error: any) {
    console.error("[BETTING] Error getting pending:", error);
    res.status(500).json({ error: error.message });
  }
});

// Add prediction
router.post("/predict", async (req, res) => {
  try {
    const userId = requireAuth(req, res);
    if (!userId) return;
    
    const parseResult = predictSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid prediction data", details: parseResult.error.errors });
    }
    
    const data = parseResult.data;
    const prediction = await bettingProfileService.addPrediction({
      userId,
      homeTeam: data.homeTeam,
      awayTeam: data.awayTeam,
      league: data.league,
      matchDate: new Date(data.matchDate),
      predictedBetType: data.predictedBetType,
      predictedOdds: data.predictedOdds,
      confidence: data.confidence,
      reasoning: data.reasoning,
      tags: data.tags,
      matchId: data.matchId,
    });
    
    res.json(prediction);
  } catch (error: any) {
    console.error("[BETTING] Error adding prediction:", error);
    res.status(500).json({ error: error.message });
  }
});

// Settle prediction with actual result
router.post("/settle/:id", async (req, res) => {
  try {
    const userId = requireAuth(req, res);
    if (!userId) return;
    
    const predictionId = parseInt(req.params.id);
    if (isNaN(predictionId)) {
      return res.status(400).json({ error: "Invalid prediction ID" });
    }
    
    const parseResult = settleSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid score data", details: parseResult.error.errors });
    }
    
    const { homeScore, awayScore } = parseResult.data;
    const result = await bettingProfileService.settlePrediction(predictionId, homeScore, awayScore, userId);
    res.json(result);
  } catch (error: any) {
    console.error("[BETTING] Error settling prediction:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get statistics
router.get("/stats", async (req, res) => {
  try {
    const userId = requireAuth(req, res);
    if (!userId) return;
    
    const { period } = req.query;
    const stats = await bettingProfileService.getStats(userId, period as string || "all_time");
    res.json(stats);
  } catch (error: any) {
    console.error("[BETTING] Error getting stats:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get AI-formatted summary (for Ulysse context)
router.get("/ai-summary", async (req, res) => {
  try {
    const userId = requireAuth(req, res);
    if (!userId) return;
    
    const [profile, stats] = await Promise.all([
      bettingProfileService.getOrCreateProfile(userId),
      bettingProfileService.getStats(userId),
    ]);
    
    const profileText = bettingProfileService.formatProfileForAI(profile);
    const statsText = bettingProfileService.formatStatsForAI(stats);
    
    res.json({
      profile,
      stats,
      aiContext: `${profileText}\n${statsText}`,
    });
  } catch (error: any) {
    console.error("[BETTING] Error getting AI summary:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
