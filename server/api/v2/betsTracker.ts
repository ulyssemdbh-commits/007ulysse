import { Router, Request, Response } from "express";
import { betsTrackerService } from "../../services/betsTrackerService";
import { insertActualBetSchema } from "@shared/schema";
import { emitBetsUpdated } from "../../services/realtimeSync";

const router = Router();

// Record a new bet
router.post("/", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const parsed = insertActualBetSchema.safeParse({ ...req.body, userId });
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid bet data", details: parsed.error.errors });
    }

    const bet = await betsTrackerService.recordBet(parsed.data);
    if (!bet) {
      return res.status(500).json({ error: "Failed to record bet" });
    }

    res.json(bet);
    emitBetsUpdated();
  } catch (error) {
    console.error("[API] Error recording bet:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get overall stats
router.get("/stats", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const days = parseInt(req.query.days as string) || 30;
    const stats = await betsTrackerService.getStats(userId, days);
    res.json(stats);
  } catch (error) {
    console.error("[API] Error getting bet stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get stats by bet type
router.get("/stats/by-type", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const days = parseInt(req.query.days as string) || 30;
    const stats = await betsTrackerService.getStatsByBetType(userId, days);
    res.json(stats);
  } catch (error) {
    console.error("[API] Error getting stats by type:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get stats by league
router.get("/stats/by-league", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const days = parseInt(req.query.days as string) || 30;
    const stats = await betsTrackerService.getStatsByLeague(userId, days);
    res.json(stats);
  } catch (error) {
    console.error("[API] Error getting stats by league:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get stats by bookmaker
router.get("/stats/by-bookmaker", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const days = parseInt(req.query.days as string) || 30;
    const stats = await betsTrackerService.getStatsByBookmaker(userId, days);
    res.json(stats);
  } catch (error) {
    console.error("[API] Error getting stats by bookmaker:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get stats by odds range
router.get("/stats/by-odds", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const days = parseInt(req.query.days as string) || 30;
    const stats = await betsTrackerService.getStatsByOddsRange(userId, days);
    res.json(stats);
  } catch (error) {
    console.error("[API] Error getting stats by odds:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get full dashboard
router.get("/dashboard", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const dashboard = await betsTrackerService.getFullDashboard(userId);
    res.json(dashboard);
  } catch (error) {
    console.error("[API] Error getting bets dashboard:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get pending bets
router.get("/pending", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const bets = await betsTrackerService.getPendingBets(userId);
    res.json(bets);
  } catch (error) {
    console.error("[API] Error getting pending bets:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get recent bets
router.get("/recent", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const limit = parseInt(req.query.limit as string) || 20;
    const bets = await betsTrackerService.getRecentBets(userId, limit);
    res.json(bets);
  } catch (error) {
    console.error("[API] Error getting recent bets:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Settle a bet manually
router.post("/:id/settle", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const betId = parseInt(req.params.id);
    const { homeScore, awayScore, status, cashoutAmount } = req.body;

    if (typeof homeScore !== "number" || typeof awayScore !== "number") {
      return res.status(400).json({ error: "homeScore and awayScore are required" });
    }

    if (!["won", "lost", "void", "cashout"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const success = await betsTrackerService.settleBet(betId, homeScore, awayScore, status, cashoutAmount);
    if (!success) {
      return res.status(404).json({ error: "Bet not found or already settled" });
    }

    res.json({ success: true });
    emitBetsUpdated();
  } catch (error) {
    console.error("[API] Error settling bet:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Auto-settle bets from match result
router.post("/auto-settle", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || req.user?.id;
    if (!userId || !req.user?.isOwner) {
      return res.status(403).json({ error: "Owner access required" });
    }

    const { matchId, homeScore, awayScore } = req.body;
    if (!matchId || typeof homeScore !== "number" || typeof awayScore !== "number") {
      return res.status(400).json({ error: "matchId, homeScore, and awayScore are required" });
    }

    const settledCount = await betsTrackerService.autoSettleFromResult(matchId, homeScore, awayScore);
    res.json({ settledCount });
    emitBetsUpdated();
  } catch (error) {
    console.error("[API] Error auto-settling bets:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get best performing bet types
router.get("/insights/best-types", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const minBets = parseInt(req.query.minBets as string) || 5;
    const bestTypes = await betsTrackerService.getBestPerformingBetTypes(userId, minBets);
    res.json(bestTypes);
  } catch (error) {
    console.error("[API] Error getting best bet types:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get worst performing bet types
router.get("/insights/worst-types", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const minBets = parseInt(req.query.minBets as string) || 5;
    const worstTypes = await betsTrackerService.getWorstPerformingBetTypes(userId, minBets);
    res.json(worstTypes);
  } catch (error) {
    console.error("[API] Error getting worst bet types:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
