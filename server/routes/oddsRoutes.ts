import { Router } from "express";
import { oddsApiService } from "../services/oddsApiService";

const router = Router();

// Get API status and usage
router.get("/status", async (req, res) => {
  try {
    const configured = oddsApiService.isConfigured();
    const usage = oddsApiService.getUsageStats();
    
    res.json({
      configured,
      usage: configured ? usage : null,
      message: configured ? "Odds API is configured" : "ODDS_API_KEY not set"
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to get status" });
  }
});

// Get available sports
router.get("/sports", async (req, res) => {
  try {
    const all = req.query.all === "true";
    const result = await oddsApiService.getSports(all);
    res.json(result);
  } catch (error) {
    console.error("[OddsRoutes] Error getting sports:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

// Get odds for a specific sport
router.get("/odds/:sportKey", async (req, res) => {
  try {
    const { sportKey } = req.params;
    const { regions, markets, oddsFormat } = req.query;
    
    const result = await oddsApiService.getOdds(sportKey, {
      regions: regions as string,
      markets: markets as string,
      oddsFormat: oddsFormat as 'decimal' | 'american'
    });
    
    res.json(result);
  } catch (error) {
    console.error("[OddsRoutes] Error getting odds:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

// Get scores for a sport
router.get("/scores/:sportKey", async (req, res) => {
  try {
    const { sportKey } = req.params;
    const daysFrom = parseInt(req.query.daysFrom as string) || 1;
    
    const result = await oddsApiService.getScores(sportKey, daysFrom);
    res.json(result);
  } catch (error) {
    console.error("[OddsRoutes] Error getting scores:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

// Get event odds
router.get("/event/:sportKey/:eventId", async (req, res) => {
  try {
    const { sportKey, eventId } = req.params;
    const { regions, markets, oddsFormat } = req.query;
    
    const result = await oddsApiService.getEventOdds(sportKey, eventId, {
      regions: regions as string,
      markets: markets as string,
      oddsFormat: oddsFormat as 'decimal' | 'american'
    });
    
    res.json(result);
  } catch (error) {
    console.error("[OddsRoutes] Error getting event odds:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

// Convenience endpoints for popular sports
router.get("/ligue1", async (req, res) => {
  try {
    const result = await oddsApiService.getLigue1Odds();
    res.json(result);
  } catch (error) {
    console.error("[OddsRoutes] Error getting Ligue 1 odds:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

router.get("/premier-league", async (req, res) => {
  try {
    const result = await oddsApiService.getPremierLeagueOdds();
    res.json(result);
  } catch (error) {
    console.error("[OddsRoutes] Error getting Premier League odds:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

router.get("/champions-league", async (req, res) => {
  try {
    const result = await oddsApiService.getChampionsLeagueOdds();
    res.json(result);
  } catch (error) {
    console.error("[OddsRoutes] Error getting Champions League odds:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

router.get("/nba", async (req, res) => {
  try {
    const result = await oddsApiService.getNBAOdds();
    res.json(result);
  } catch (error) {
    console.error("[OddsRoutes] Error getting NBA odds:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

router.get("/nfl", async (req, res) => {
  try {
    const result = await oddsApiService.getNFLOdds();
    res.json(result);
  } catch (error) {
    console.error("[OddsRoutes] Error getting NFL odds:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

router.get("/mlb", async (req, res) => {
  try {
    const result = await oddsApiService.getMLBOdds();
    res.json(result);
  } catch (error) {
    console.error("[OddsRoutes] Error getting MLB odds:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

router.get("/ufc", async (req, res) => {
  try {
    const result = await oddsApiService.getUFCOdds();
    res.json(result);
  } catch (error) {
    console.error("[OddsRoutes] Error getting UFC odds:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

// AI-friendly summary endpoint
router.get("/summary", async (req, res) => {
  try {
    const sportKey = req.query.sport as string | undefined;
    const summary = await oddsApiService.getOddsSummaryForAI(sportKey);
    res.json({ summary });
  } catch (error) {
    console.error("[OddsRoutes] Error getting summary:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

export default router;
