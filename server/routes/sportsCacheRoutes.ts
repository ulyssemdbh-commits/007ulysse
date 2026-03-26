import { Router, Request, Response } from "express";
import { sportsCacheService } from "../services/sportsCacheService";
import { probabilityModelService } from "../services/probabilityModelService";
import { basketballPredictionService } from "../services/basketballPredictionService";
import { hockeyPredictionService } from "../services/hockeyPredictionService";
import { nflPredictionService } from "../services/nflPredictionService";
import { sportsPredictionMemoryService } from "../services/sportsPredictionMemoryService";

const router = Router();

async function savePredictionsToMemory(predictions: any[], sport: string) {
  try {
    const toSave = predictions.map(pred => ({
      match: {
        matchId: pred.matchId,
        externalMatchId: pred.externalId || String(pred.matchId),
        sport,
        league: pred.league || "Unknown",
        homeTeam: pred.homeTeam,
        awayTeam: pred.awayTeam,
        matchDate: new Date(pred.matchDate || Date.now())
      },
      odds: {
        homeOdds: pred.odds?.homeOdds || pred.odds?.home || 0,
        drawOdds: pred.odds?.drawOdds || pred.odds?.draw,
        awayOdds: pred.odds?.awayOdds || pred.odds?.away || 0,
        overOdds: pred.odds?.overOdds || pred.odds?.over,
        underOdds: pred.odds?.underOdds || pred.odds?.under,
        bttsYes: pred.odds?.bttsYes,
        spreadHome: pred.odds?.spreadHome || pred.odds?.homeSpread,
        spreadAway: pred.odds?.spreadAway || pred.odds?.awaySpread,
        bookmaker: pred.odds?.bookmaker || "Unknown"
      },
      stats: pred.stats || null,
      predictions: {
        homeWinProb: pred.probabilities?.homeWin || pred.probabilities?.home || 0,
        drawProb: pred.probabilities?.draw,
        awayWinProb: pred.probabilities?.awayWin || pred.probabilities?.away || 0,
        over25Prob: pred.probabilities?.over25 || pred.probabilities?.over,
        under25Prob: pred.probabilities?.under25 || pred.probabilities?.under,
        bttsProb: pred.probabilities?.btts,
        spreadProb: pred.probabilities?.spread
      },
      recommendations: {
        bestBet: pred.recommendation?.bet || pred.bestBet || "N/A",
        confidence: pred.recommendation?.confidence || pred.confidence || 0,
        valueScore: pred.recommendation?.value || pred.valueScore || 0,
        reasoning: pred.recommendation?.reasoning || pred.reasoning || "",
        altBets: pred.recommendation?.alternatives || []
      }
    }));

    const result = await sportsPredictionMemoryService.saveBatchPredictions(toSave);
    console.log(`[PREDICTION-MEMORY] ${sport}: ${result.saved} saved, ${result.updated} updated`);
  } catch (error) {
    console.error(`[PREDICTION-MEMORY] Error saving ${sport} predictions:`, error);
  }
}

router.get("/matches/today", async (_req: Request, res: Response) => {
  try {
    const matches = await sportsCacheService.getMatchesWithOdds(new Date());
    res.json({
      success: true,
      count: matches.length,
      matches,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/matches/week", async (_req: Request, res: Response) => {
  try {
    const matches = await sportsCacheService.getWeekMatches();
    res.json({
      success: true,
      count: matches.length,
      matches,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/matches/:date", async (req: Request, res: Response) => {
  try {
    const date = new Date(req.params.date);
    if (isNaN(date.getTime())) {
      return res.status(400).json({ success: false, error: "Invalid date format" });
    }
    const matches = await sportsCacheService.getMatchesWithOdds(date);
    res.json({
      success: true,
      count: matches.length,
      matches,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/odds/today", async (_req: Request, res: Response) => {
  try {
    const matches = await sportsCacheService.getMatchesWithOdds(new Date());
    const matchesWithOdds = matches.filter((m: any) => m.odds && m.odds.length > 0);
    res.json({
      success: true,
      count: matchesWithOdds.length,
      matches: matchesWithOdds,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const stats = await sportsCacheService.getCacheStats();
    res.json({
      success: true,
      stats,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/sync/status", async (_req: Request, res: Response) => {
  try {
    const jobs = await sportsCacheService.getLastSyncStatus();
    res.json({
      success: true,
      jobs,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/sync/daily", async (_req: Request, res: Response) => {
  try {
    console.log("[SPORTS-CACHE] Manual daily sync triggered");
    const result = await sportsCacheService.syncDailyMatches();
    res.json({
      success: true,
      message: "Daily sync completed",
      ...result,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/sync/odds", async (_req: Request, res: Response) => {
  try {
    console.log("[SPORTS-CACHE] Manual odds refresh triggered");
    const result = await sportsCacheService.refreshHourlyOdds();
    res.json({
      success: true,
      message: "Odds refresh completed",
      ...result,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/sync/stats", async (_req: Request, res: Response) => {
  try {
    console.log("[SPORTS-CACHE] Manual team stats sync triggered");
    const result = await sportsCacheService.syncTeamStats();
    res.json({
      success: true,
      message: "Team stats sync completed",
      ...result,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/sync/multisport", async (_req: Request, res: Response) => {
  try {
    console.log("[SPORTS-CACHE] Manual multi-sport sync triggered (NBA, NHL, NFL)");
    const result = await sportsCacheService.syncMultiSportOdds();
    res.json({
      success: true,
      message: "Multi-sport sync completed (NBA, NHL, NFL)",
      ...result,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/team/:teamName", async (req: Request, res: Response) => {
  try {
    const stats = await sportsCacheService.getTeamStats(req.params.teamName);
    if (!stats) {
      return res.status(404).json({ success: false, error: "Team not found" });
    }
    res.json({
      success: true,
      stats,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/ai/summary", async (_req: Request, res: Response) => {
  try {
    const matches = await sportsCacheService.getMatchesWithOdds(new Date());
    const summary = sportsCacheService.formatMatchesForAI(matches);
    res.json({
      success: true,
      summary,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoints modèle de probabilités
router.get("/predictions/today", async (_req: Request, res: Response) => {
  try {
    const predictions = await probabilityModelService.analyzeTodayMatches();
    savePredictionsToMemory(predictions, "football");
    res.json({
      success: true,
      count: predictions.length,
      predictions,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/predictions/today", async (req: Request, res: Response) => {
  try {
    const { criteria } = req.body;
    const mode = criteria?.riskLevel === "safe" ? "safe" : "aggressive";
    const predictions = await probabilityModelService.analyzeTodayMatches(criteria ? {
      mode,
      betType: criteria.betType || "all",
      minConfidence: criteria.minConfidence || 50,
      valueOnly: criteria.valueOnly || false,
      sortBy: criteria.sortBy || "confidence",
    } : undefined);
    savePredictionsToMemory(predictions, "football");
    res.json({
      success: true,
      count: predictions.length,
      predictions,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/predictions/ai", async (_req: Request, res: Response) => {
  try {
    const predictions = await probabilityModelService.analyzeTodayMatches();
    savePredictionsToMemory(predictions, "football");
    const summary = probabilityModelService.formatPredictionsForAI(predictions);
    res.json({
      success: true,
      summary,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/predictions/match", async (req: Request, res: Response) => {
  try {
    const { homeTeam, awayTeam, league, odds, fixtureId, criteria: matchCriteria } = req.body;
    if (!homeTeam || !awayTeam) {
      return res.status(400).json({ success: false, error: "homeTeam and awayTeam required" });
    }
    const analysisMode = matchCriteria?.riskLevel === "safe" ? "safe" : "aggressive";

    let intelligence: any = undefined;
    if (fixtureId) {
      try {
        const { apiFootballService } = await import("../services/apiFootballService");
        if (apiFootballService.isConfigured()) {
          const fId = typeof fixtureId === 'number' ? fixtureId : parseInt(fixtureId);
          if (!isNaN(fId)) {
            const [injuriesResult, predictionResult] = await Promise.allSettled([
              apiFootballService.getInjuries(undefined, undefined, fId),
              apiFootballService.getFixturePrediction(fId),
            ]);

            intelligence = {};

            let homeTeamId: number | null = null;
            let awayTeamId: number | null = null;

            if (predictionResult.status === 'fulfilled' && predictionResult.value) {
              const p = predictionResult.value;
              homeTeamId = p.teams?.home?.id || null;
              awayTeamId = p.teams?.away?.id || null;
              intelligence.apiPrediction = {
                advice: p.predictions?.advice,
                percentHome: p.predictions?.percent?.home,
                percentDraw: p.predictions?.percent?.draw,
                percentAway: p.predictions?.percent?.away,
                underOver: p.predictions?.under_over,
                goals: p.predictions?.goals,
                winner: p.predictions?.winner
              };
              if (p.h2h?.length) {
                intelligence.h2h = p.h2h.slice(0, 5).map((h: any) => ({
                  scoreHome: h.goals?.home || 0,
                  scoreAway: h.goals?.away || 0
                }));
              }
            }

            if (injuriesResult.status === 'fulfilled' && injuriesResult.value.length > 0) {
              const injuries = injuriesResult.value;
              if (homeTeamId && awayTeamId) {
                intelligence.homeInjuries = injuries
                  .filter((i: any) => i.team.id === homeTeamId)
                  .map((i: any) => ({ player: i.player.name, type: i.player.type, reason: i.player.reason }));
                intelligence.awayInjuries = injuries
                  .filter((i: any) => i.team.id === awayTeamId)
                  .map((i: any) => ({ player: i.player.name, type: i.player.type, reason: i.player.reason }));
              } else {
                const homeLower = homeTeam.toLowerCase();
                const awayLower = awayTeam.toLowerCase();
                intelligence.homeInjuries = injuries
                  .filter((i: any) => i.team.name?.toLowerCase().includes(homeLower) || homeLower.includes(i.team.name?.toLowerCase()?.split(' ')[0]))
                  .map((i: any) => ({ player: i.player.name, type: i.player.type, reason: i.player.reason }));
                intelligence.awayInjuries = injuries
                  .filter((i: any) => i.team.name?.toLowerCase().includes(awayLower) || awayLower.includes(i.team.name?.toLowerCase()?.split(' ')[0]))
                  .map((i: any) => ({ player: i.player.name, type: i.player.type, reason: i.player.reason }));
              }
            }

            if (!intelligence.apiPrediction && !intelligence.homeInjuries?.length && !intelligence.awayInjuries?.length && !intelligence.h2h?.length) {
              console.log(`[Prediction] No intelligence data available for fixture ${fId}`);
              intelligence = undefined;
            }
          }
        }
      } catch (e) {
        console.log(`[Prediction] Intelligence fetch failed for ${homeTeam} vs ${awayTeam}:`, (e as Error).message);
      }
    }

    const prediction = await probabilityModelService.analyzeMatch(
      homeTeam,
      awayTeam,
      league || "Unknown",
      new Date(),
      odds,
      analysisMode as "safe" | "aggressive",
      intelligence,
      matchCriteria ? {
        mode: analysisMode as "safe" | "aggressive",
        betType: matchCriteria.betType || "all",
        minConfidence: matchCriteria.minConfidence || 50,
        valueOnly: matchCriteria.valueOnly || false,
        sortBy: matchCriteria.sortBy || "confidence",
      } : undefined
    );
    res.json({
      success: true,
      prediction,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Basketball (NBA) predictions
router.get("/predictions/basketball/today", async (_req: Request, res: Response) => {
  try {
    const predictions = await basketballPredictionService.analyzeTodayMatches();
    savePredictionsToMemory(predictions, "basketball");
    res.json({
      success: true,
      count: predictions.length,
      predictions,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/predictions/basketball/ai", async (_req: Request, res: Response) => {
  try {
    const predictions = await basketballPredictionService.analyzeTodayMatches();
    savePredictionsToMemory(predictions, "basketball");
    const summary = basketballPredictionService.formatPredictionsForAI(predictions);
    res.json({
      success: true,
      summary,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Hockey (NHL) predictions
router.get("/predictions/hockey/today", async (_req: Request, res: Response) => {
  try {
    const predictions = await hockeyPredictionService.analyzeTodayMatches();
    savePredictionsToMemory(predictions, "hockey");
    res.json({
      success: true,
      count: predictions.length,
      predictions,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/predictions/hockey/ai", async (_req: Request, res: Response) => {
  try {
    const predictions = await hockeyPredictionService.analyzeTodayMatches();
    savePredictionsToMemory(predictions, "hockey");
    const summary = hockeyPredictionService.formatPredictionsForAI(predictions);
    res.json({
      success: true,
      summary,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// NFL predictions
router.get("/predictions/nfl/today", async (_req: Request, res: Response) => {
  try {
    const predictions = await nflPredictionService.analyzeTodayMatches();
    savePredictionsToMemory(predictions, "nfl");
    res.json({
      success: true,
      count: predictions.length,
      predictions,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/predictions/nfl/ai", async (_req: Request, res: Response) => {
  try {
    const predictions = await nflPredictionService.analyzeTodayMatches();
    savePredictionsToMemory(predictions, "nfl");
    const summary = nflPredictionService.formatPredictionsForAI(predictions);
    res.json({
      success: true,
      summary,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// All sports combined predictions for AI
router.get("/predictions/all/ai", async (_req: Request, res: Response) => {
  try {
    const [football, basketball, hockey, nfl] = await Promise.all([
      probabilityModelService.analyzeTodayMatches(),
      basketballPredictionService.analyzeTodayMatches(),
      hockeyPredictionService.analyzeTodayMatches(),
      nflPredictionService.analyzeTodayMatches(),
    ]);
    
    // Save all predictions to memory (in background)
    Promise.all([
      savePredictionsToMemory(football, "football"),
      savePredictionsToMemory(basketball, "basketball"),
      savePredictionsToMemory(hockey, "hockey"),
      savePredictionsToMemory(nfl, "nfl"),
    ]).catch(err => console.error("[PREDICTION-MEMORY] Background save error:", err));
    
    const summaries: string[] = [];
    
    if (football.length > 0) {
      summaries.push(probabilityModelService.formatPredictionsForAI(football));
    }
    if (basketball.length > 0) {
      summaries.push(basketballPredictionService.formatPredictionsForAI(basketball));
    }
    if (hockey.length > 0) {
      summaries.push(hockeyPredictionService.formatPredictionsForAI(hockey));
    }
    if (nfl.length > 0) {
      summaries.push(nflPredictionService.formatPredictionsForAI(nfl));
    }
    
    const combined = summaries.length > 0 
      ? summaries.join("\n\n---\n\n")
      : "Aucune prediction disponible pour aujourd'hui.";
    
    res.json({
      success: true,
      sports: {
        football: football.length,
        basketball: basketball.length,
        hockey: hockey.length,
        nfl: nfl.length,
      },
      summary: combined,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Prediction memory stats endpoint
router.get("/predictions/stats", async (_req: Request, res: Response) => {
  try {
    const stats = await sportsPredictionMemoryService.getPredictionStats();
    res.json({
      success: true,
      stats,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Recent predictions history
router.get("/predictions/history", async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const sport = req.query.sport as string | undefined;
    const predictions = await sportsPredictionMemoryService.getRecentPredictions(days, sport);
    res.json({
      success: true,
      count: predictions.length,
      predictions,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
