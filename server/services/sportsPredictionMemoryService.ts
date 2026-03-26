import { db } from "../db";
import { sportsPredictionSnapshots, knowledgeBase, learningLog, type InsertSportsPredictionSnapshot } from "@shared/schema";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { brainService } from "./brainService";
import { learningOptimizerService } from "./learningOptimizer";

interface OddsData {
  homeOdds: number;
  drawOdds?: number;
  awayOdds: number;
  overOdds?: number;
  underOdds?: number;
  bttsYes?: number;
  spreadHome?: number;
  spreadAway?: number;
  bookmaker: string;
}

interface StatsData {
  homeForm?: string;
  awayForm?: string;
  homeGoalsAvg?: number;
  awayGoalsAvg?: number;
  homeOver25Rate?: number;
  awayOver25Rate?: number;
  homeBttsRate?: number;
  awayBttsRate?: number;
  h2hHistory?: any;
}

interface PredictionData {
  homeWinProb: number;
  drawProb?: number;
  awayWinProb: number;
  over25Prob?: number;
  under25Prob?: number;
  bttsProb?: number;
  spreadProb?: number;
}

interface RecommendationData {
  bestBet: string;
  confidence: number;
  valueScore: number;
  reasoning: string;
  altBets?: Array<{bet: string; confidence: number; value: number}>;
}

interface MatchInfo {
  matchId?: number;
  externalMatchId?: string;
  sport: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  matchDate: Date;
}

class SportsPredictionMemoryService {
  
  async savePrediction(
    match: MatchInfo,
    odds: OddsData,
    stats: StatsData | null,
    predictions: PredictionData,
    recommendations: RecommendationData
  ): Promise<number | null> {
    try {
      const existingPrediction = await this.findExistingPrediction(match);
      
      if (existingPrediction) {
        const updated = await db.update(sportsPredictionSnapshots)
          .set({
            oddsSnapshot: {
              ...odds,
              fetchedAt: new Date().toISOString()
            },
            statsSnapshot: stats,
            predictions: predictions,
            recommendations: recommendations,
            version: (existingPrediction.version || 1) + 1,
            updatedAt: new Date()
          })
          .where(eq(sportsPredictionSnapshots.id, existingPrediction.id))
          .returning({ id: sportsPredictionSnapshots.id });
        
        console.log(`[PREDICTION-MEMORY] Updated prediction #${existingPrediction.id} for ${match.homeTeam} vs ${match.awayTeam} (v${(existingPrediction.version || 1) + 1})`);
        return updated[0]?.id || null;
      }
      
      const inserted = await db.insert(sportsPredictionSnapshots)
        .values({
          matchId: match.matchId,
          externalMatchId: match.externalMatchId,
          sport: match.sport,
          league: match.league,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          matchDate: match.matchDate,
          oddsSnapshot: {
            ...odds,
            fetchedAt: new Date().toISOString()
          },
          statsSnapshot: stats,
          predictions: predictions,
          recommendations: recommendations,
          version: 1
        })
        .returning({ id: sportsPredictionSnapshots.id });
      
      console.log(`[PREDICTION-MEMORY] Saved new prediction #${inserted[0]?.id} for ${match.homeTeam} vs ${match.awayTeam}`);
      return inserted[0]?.id || null;
    } catch (error) {
      console.error("[PREDICTION-MEMORY] Error saving prediction:", error);
      return null;
    }
  }

  async saveBatchPredictions(
    predictions: Array<{
      match: MatchInfo;
      odds: OddsData;
      stats: StatsData | null;
      predictions: PredictionData;
      recommendations: RecommendationData;
    }>
  ): Promise<{ saved: number; updated: number; errors: number }> {
    let saved = 0;
    let updated = 0;
    let errors = 0;

    for (const pred of predictions) {
      try {
        const existing = await this.findExistingPrediction(pred.match);
        
        if (existing) {
          await db.update(sportsPredictionSnapshots)
            .set({
              oddsSnapshot: { ...pred.odds, fetchedAt: new Date().toISOString() },
              statsSnapshot: pred.stats,
              predictions: pred.predictions,
              recommendations: pred.recommendations,
              version: (existing.version || 1) + 1,
              updatedAt: new Date()
            })
            .where(eq(sportsPredictionSnapshots.id, existing.id));
          updated++;
        } else {
          await db.insert(sportsPredictionSnapshots).values({
            matchId: pred.match.matchId,
            externalMatchId: pred.match.externalMatchId,
            sport: pred.match.sport,
            league: pred.match.league,
            homeTeam: pred.match.homeTeam,
            awayTeam: pred.match.awayTeam,
            matchDate: pred.match.matchDate,
            oddsSnapshot: { ...pred.odds, fetchedAt: new Date().toISOString() },
            statsSnapshot: pred.stats,
            predictions: pred.predictions,
            recommendations: pred.recommendations,
            version: 1
          });
          saved++;
        }
      } catch (error) {
        console.error(`[PREDICTION-MEMORY] Error saving prediction for ${pred.match.homeTeam} vs ${pred.match.awayTeam}:`, error);
        errors++;
      }
    }

    console.log(`[PREDICTION-MEMORY] Batch complete: ${saved} saved, ${updated} updated, ${errors} errors`);
    return { saved, updated, errors };
  }

  async updateWithResult(
    matchId: number | string,
    homeScore: number,
    awayScore: number,
    status: string = "finished"
  ): Promise<boolean> {
    try {
      const query = typeof matchId === "number"
        ? eq(sportsPredictionSnapshots.matchId, matchId)
        : eq(sportsPredictionSnapshots.externalMatchId, String(matchId));
      
      const predictions = await db.select()
        .from(sportsPredictionSnapshots)
        .where(query);
      
      if (predictions.length === 0) return false;

      for (const prediction of predictions) {
        const performance = this.calculatePerformance(prediction, homeScore, awayScore);
        
        await db.update(sportsPredictionSnapshots)
          .set({
            actualResult: {
              homeScore,
              awayScore,
              status,
              settledAt: new Date().toISOString()
            },
            predictionPerformance: performance,
            updatedAt: new Date()
          })
          .where(eq(sportsPredictionSnapshots.id, prediction.id));

        // Feedback loop: Update brain knowledge based on prediction result
        const recommendations = prediction.recommendations as RecommendationData;
        if (recommendations) {
          try {
            await learningOptimizerService.onPredictionResult(1, {
              won: performance.mainBetWon,
              betType: recommendations.bestBet || "unknown",
              sport: prediction.sport,
              league: prediction.league,
              confidence: recommendations.confidence || 50,
              valueScore: recommendations.valueScore || 0,
              homeTeam: prediction.homeTeam,
              awayTeam: prediction.awayTeam
            });
          } catch (feedbackError) {
            console.error("[PREDICTION-MEMORY] Feedback loop error:", feedbackError);
          }
        }
      }

      console.log(`[PREDICTION-MEMORY] Updated ${predictions.length} predictions with result ${homeScore}-${awayScore} (feedback loop active)`);
      return true;
    } catch (error) {
      console.error("[PREDICTION-MEMORY] Error updating with result:", error);
      return false;
    }
  }

  private calculatePerformance(prediction: any, homeScore: number, awayScore: number): {
    mainBetWon: boolean;
    probabilityAccuracy: number;
    valueRealized: boolean;
    notes?: string;
  } {
    const recommendations = prediction.recommendations as RecommendationData;
    const bestBet = recommendations?.bestBet || "";
    
    let mainBetWon = false;
    const totalGoals = homeScore + awayScore;
    const btts = homeScore > 0 && awayScore > 0;
    
    switch (bestBet) {
      case "1":
        mainBetWon = homeScore > awayScore;
        break;
      case "X":
        mainBetWon = homeScore === awayScore;
        break;
      case "2":
        mainBetWon = homeScore < awayScore;
        break;
      case "O2.5":
        mainBetWon = totalGoals > 2.5;
        break;
      case "U2.5":
        mainBetWon = totalGoals < 2.5;
        break;
      case "BTTS":
        mainBetWon = btts;
        break;
      case "HOME":
        mainBetWon = homeScore > awayScore;
        break;
      case "AWAY":
        mainBetWon = homeScore < awayScore;
        break;
      default:
        break;
    }

    const predictions = prediction.predictions as PredictionData;
    let actualProb = 0;
    let predictedProb = 0;
    
    if (homeScore > awayScore) {
      actualProb = 100;
      predictedProb = predictions?.homeWinProb || 0;
    } else if (homeScore === awayScore) {
      actualProb = 100;
      predictedProb = predictions?.drawProb || 33;
    } else {
      actualProb = 100;
      predictedProb = predictions?.awayWinProb || 0;
    }
    
    const probabilityAccuracy = Math.max(0, 100 - Math.abs(actualProb - (mainBetWon ? predictedProb : 100 - predictedProb)));

    const valueRealized = mainBetWon && recommendations?.valueScore > 0;

    return {
      mainBetWon,
      probabilityAccuracy,
      valueRealized,
      notes: `${bestBet} prediction ${mainBetWon ? 'WON' : 'LOST'}. Score: ${homeScore}-${awayScore}`
    };
  }

  async findExistingPrediction(match: MatchInfo) {
    const startOfDay = new Date(match.matchDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(match.matchDate);
    endOfDay.setHours(23, 59, 59, 999);

    const results = await db.select()
      .from(sportsPredictionSnapshots)
      .where(and(
        eq(sportsPredictionSnapshots.homeTeam, match.homeTeam),
        eq(sportsPredictionSnapshots.awayTeam, match.awayTeam),
        eq(sportsPredictionSnapshots.sport, match.sport),
        gte(sportsPredictionSnapshots.matchDate, startOfDay),
        lte(sportsPredictionSnapshots.matchDate, endOfDay)
      ))
      .limit(1);

    return results[0] || null;
  }

  async getRecentPredictions(days: number = 7, sport?: string): Promise<any[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    let query = db.select()
      .from(sportsPredictionSnapshots)
      .where(gte(sportsPredictionSnapshots.createdAt, startDate))
      .orderBy(desc(sportsPredictionSnapshots.createdAt));

    if (sport) {
      query = query.where(eq(sportsPredictionSnapshots.sport, sport)) as any;
    }

    return await query.limit(100);
  }

  async getPredictionStats(): Promise<{
    total: number;
    pending: number;
    won: number;
    lost: number;
    successRate: number;
    bySport: Record<string, { total: number; won: number; rate: number }>;
  }> {
    const allPredictions = await db.select()
      .from(sportsPredictionSnapshots)
      .where(sql`${sportsPredictionSnapshots.actualResult} IS NOT NULL`);

    const pending = await db.select({ count: sql<number>`count(*)` })
      .from(sportsPredictionSnapshots)
      .where(sql`${sportsPredictionSnapshots.actualResult} IS NULL`);

    const bySport: Record<string, { total: number; won: number; rate: number }> = {};
    let won = 0;
    let lost = 0;

    for (const pred of allPredictions) {
      const performance = pred.predictionPerformance as any;
      const sport = pred.sport;

      if (!bySport[sport]) {
        bySport[sport] = { total: 0, won: 0, rate: 0 };
      }
      bySport[sport].total++;

      if (performance?.mainBetWon) {
        won++;
        bySport[sport].won++;
      } else {
        lost++;
      }
    }

    for (const sport of Object.keys(bySport)) {
      bySport[sport].rate = bySport[sport].total > 0 
        ? Math.round((bySport[sport].won / bySport[sport].total) * 100) 
        : 0;
    }

    const total = won + lost;
    const successRate = total > 0 ? Math.round((won / total) * 100) : 0;

    return {
      total,
      pending: Number(pending[0]?.count || 0),
      won,
      lost,
      successRate,
      bySport
    };
  }

  async getPredictionsForBrain(): Promise<any[]> {
    const learnings = await db.select()
      .from(sportsPredictionSnapshots)
      .where(and(
        eq(sportsPredictionSnapshots.learningExtracted, false),
        sql`${sportsPredictionSnapshots.predictionPerformance} IS NOT NULL`
      ))
      .orderBy(desc(sportsPredictionSnapshots.updatedAt))
      .limit(50);

    return learnings;
  }

  async markAsAddedToBrain(predictionId: number, brainKnowledgeId?: number): Promise<void> {
    await db.update(sportsPredictionSnapshots)
      .set({
        addedToBrain: true,
        brainKnowledgeId: brainKnowledgeId,
        learningExtracted: true,
        updatedAt: new Date()
      })
      .where(eq(sportsPredictionSnapshots.id, predictionId));
  }

  async getUnprocessedResults(hoursBack: number = 48): Promise<any[]> {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - hoursBack);

    return await db.select()
      .from(sportsPredictionSnapshots)
      .where(and(
        sql`${sportsPredictionSnapshots.actualResult} IS NULL`,
        lte(sportsPredictionSnapshots.matchDate, new Date()),
        gte(sportsPredictionSnapshots.matchDate, cutoff)
      ))
      .orderBy(sportsPredictionSnapshots.matchDate);
  }

  formatForAI(): string {
    return `[SPORTS PREDICTION MEMORY]
Ce système mémorise automatiquement toutes les prédictions sportives de Djedou Pronos.
- Chaque prédiction est sauvegardée avec: cotes, stats, probabilités, recommandations
- Les mises à jour sont automatiques quand de nouvelles données arrivent
- Les résultats sont trackés et la performance calculée
- Les apprentissages sont extraits vers le Brain System

Utilisez /api/sports/cache/predictions/stats pour les statistiques de performance.`;
  }

  async extractLearningsToBrain(userId: number = 1): Promise<{ processed: number; learnings: string[] }> {
    try {
      const predictionsToProcess = await this.getPredictionsForBrain();
      
      if (predictionsToProcess.length === 0) {
        console.log("[PREDICTION-MEMORY] No predictions to process for Brain System");
        return { processed: 0, learnings: [] };
      }

      const learnings: string[] = [];
      let processed = 0;

      const stats = await this.getPredictionStats();
      
      if (stats.total >= 10) {
        const statsLearning = `Performance Djedou Pronos: ${stats.successRate}% de réussite sur ${stats.total} prédictions. ` +
          Object.entries(stats.bySport)
            .map(([sport, data]) => `${sport}: ${data.rate}% (${data.won}/${data.total})`)
            .join(", ");
        
        try {
          await brainService.addKnowledge(userId, {
            title: "Performance prédictions sportives",
            content: statsLearning,
            summary: `Taux de réussite global: ${stats.successRate}%`,
            type: "insight",
            category: "sports_betting",
            importance: 75,
            sourceType: "automated",
            tags: ["predictions", "sports", "betting", "performance"],
          });
          learnings.push(statsLearning);
        } catch (err) {
          console.error("[PREDICTION-MEMORY] Error adding stats to brain:", err);
        }
      }

      const wonPredictions = predictionsToProcess.filter(
        p => (p.predictionPerformance as any)?.mainBetWon === true
      );
      const lostPredictions = predictionsToProcess.filter(
        p => (p.predictionPerformance as any)?.mainBetWon === false
      );

      if (wonPredictions.length > 0) {
        const patterns = this.extractPatterns(wonPredictions, true);
        if (patterns.length > 0) {
          const patternsText = `Patterns gagnants identifiés: ${patterns.join("; ")}`;
          try {
            await brainService.addKnowledge(userId, {
              title: "Patterns gagnants prédictions sportives",
              content: patternsText,
              summary: `${wonPredictions.length} prédictions réussies analysées`,
              type: "insight",
              category: "sports_betting",
              importance: 80,
              sourceType: "automated",
              tags: ["predictions", "winning_patterns", "sports"],
            });
            learnings.push(patternsText);
          } catch (err) {
            console.error("[PREDICTION-MEMORY] Error adding winning patterns:", err);
          }
        }
      }

      if (lostPredictions.length > 0) {
        const antiPatterns = this.extractPatterns(lostPredictions, false);
        if (antiPatterns.length > 0) {
          const antiPatternsText = `Anti-patterns à éviter: ${antiPatterns.join("; ")}`;
          try {
            await brainService.addKnowledge(userId, {
              title: "Anti-patterns prédictions sportives",
              content: antiPatternsText,
              summary: `${lostPredictions.length} prédictions perdues analysées`,
              type: "lesson",
              category: "sports_betting",
              importance: 70,
              sourceType: "automated",
              tags: ["predictions", "losing_patterns", "avoid", "sports"],
            });
            learnings.push(antiPatternsText);
          } catch (err) {
            console.error("[PREDICTION-MEMORY] Error adding anti-patterns:", err);
          }
        }
      }

      for (const pred of predictionsToProcess) {
        try {
          await this.markAsAddedToBrain(pred.id);
          processed++;
        } catch (err) {
          console.error(`[PREDICTION-MEMORY] Error marking prediction ${pred.id} as processed:`, err);
        }
      }

      console.log(`[PREDICTION-MEMORY] Extracted ${learnings.length} learnings from ${processed} predictions to Brain System`);
      return { processed, learnings };
    } catch (error) {
      console.error("[PREDICTION-MEMORY] Error extracting learnings to brain:", error);
      return { processed: 0, learnings: [] };
    }
  }

  private extractPatterns(predictions: any[], isWinning: boolean): string[] {
    const patterns: string[] = [];
    
    const sportCounts: Record<string, number> = {};
    const leagueCounts: Record<string, number> = {};
    const betTypeCounts: Record<string, number> = {};
    const confidenceRanges: Record<string, number> = { "high": 0, "medium": 0, "low": 0 };

    for (const pred of predictions) {
      sportCounts[pred.sport] = (sportCounts[pred.sport] || 0) + 1;
      leagueCounts[pred.league] = (leagueCounts[pred.league] || 0) + 1;
      
      const rec = pred.recommendations as any;
      if (rec?.bestBet) {
        betTypeCounts[rec.bestBet] = (betTypeCounts[rec.bestBet] || 0) + 1;
      }
      if (rec?.confidence) {
        if (rec.confidence >= 70) confidenceRanges["high"]++;
        else if (rec.confidence >= 50) confidenceRanges["medium"]++;
        else confidenceRanges["low"]++;
      }
    }

    const topSport = Object.entries(sportCounts).sort((a, b) => b[1] - a[1])[0];
    if (topSport && topSport[1] >= 3) {
      patterns.push(`${isWinning ? "Meilleur" : "Pire"} sport: ${topSport[0]} (${topSport[1]} prédictions)`);
    }

    const topLeague = Object.entries(leagueCounts).sort((a, b) => b[1] - a[1])[0];
    if (topLeague && topLeague[1] >= 2) {
      patterns.push(`${isWinning ? "Ligue performante" : "Ligue à éviter"}: ${topLeague[0]}`);
    }

    const topBetType = Object.entries(betTypeCounts).sort((a, b) => b[1] - a[1])[0];
    if (topBetType && topBetType[1] >= 2) {
      patterns.push(`${isWinning ? "Pari fiable" : "Pari risqué"}: ${topBetType[0]}`);
    }

    if (isWinning && confidenceRanges["high"] > confidenceRanges["low"]) {
      patterns.push("Les prédictions haute confiance (>70%) sont plus fiables");
    }
    if (!isWinning && confidenceRanges["low"] > confidenceRanges["high"]) {
      patterns.push("Éviter les prédictions basse confiance (<50%)");
    }

    return patterns;
  }

  async trackCompletedMatches(): Promise<{ tracked: number; errors: number }> {
    try {
      const unprocessed = await this.getUnprocessedResults(72);
      console.log(`[PREDICTION-MEMORY] Found ${unprocessed.length} predictions to track results`);

      let tracked = 0;
      let errors = 0;

      const groupedBySport: Record<string, typeof unprocessed> = {};
      for (const pred of unprocessed) {
        const sport = pred.sport || "football";
        if (!groupedBySport[sport]) groupedBySport[sport] = [];
        groupedBySport[sport].push(pred);
      }

      for (const [sport, predictions] of Object.entries(groupedBySport)) {
        for (const pred of predictions) {
          try {
            const externalId = pred.externalMatchId;
            if (!externalId) continue;

            let resultData: { homeScore: number; awayScore: number; finished: boolean } | null = null;

            switch (sport) {
              case "football":
                resultData = await this.getFootballResult(externalId);
                break;
              case "basketball":
              case "hockey":
              case "nfl":
                resultData = await this.getMultiSportResult(pred.matchId || 0, sport);
                break;
              default:
                console.log(`[PREDICTION-MEMORY] Unknown sport: ${sport}, skipping`);
                continue;
            }

            if (resultData && resultData.finished) {
              await this.updateWithResult(
                externalId,
                resultData.homeScore,
                resultData.awayScore,
                "finished"
              );
              tracked++;
            }
          } catch (err) {
            console.error(`[PREDICTION-MEMORY] Error tracking result for prediction ${pred.id}:`, err);
            errors++;
          }
        }
      }

      console.log(`[PREDICTION-MEMORY] Tracked ${tracked} results, ${errors} errors`);
      return { tracked, errors };
    } catch (error) {
      console.error("[PREDICTION-MEMORY] Error in trackCompletedMatches:", error);
      return { tracked: 0, errors: 1 };
    }
  }

  private async getFootballResult(externalId: string): Promise<{ homeScore: number; awayScore: number; finished: boolean } | null> {
    try {
      const { cachedMatches } = await import("@shared/schema");
      const cached = await db.select().from(cachedMatches)
        .where(eq(cachedMatches.externalId, externalId))
        .limit(1);
      
      if (cached.length > 0 && (cached[0].status === "finished" || cached[0].status === "FT")) {
        if (cached[0].homeScore != null && cached[0].awayScore != null) {
          return {
            homeScore: cached[0].homeScore,
            awayScore: cached[0].awayScore,
            finished: true
          };
        }
      }

      const { apiFootballService } = await import("./apiFootballService");
      const fixtureData = await apiFootballService.getFixtureById(Number(externalId));
      
      if (fixtureData && fixtureData.status === "Match Finished") {
        return {
          homeScore: fixtureData.homeScore ?? 0,
          awayScore: fixtureData.awayScore ?? 0,
          finished: true
        };
      }
      return null;
    } catch (error) {
      console.error(`[PREDICTION-MEMORY] Error fetching football result for ${externalId}:`, error);
      return null;
    }
  }

  private async getMultiSportResult(matchId: number, sport: string): Promise<{ homeScore: number; awayScore: number; finished: boolean } | null> {
    try {
      const { cachedMatches } = await import("@shared/schema");
      const match = await db.select().from(cachedMatches)
        .where(eq(cachedMatches.id, matchId))
        .limit(1);
      
      if (match.length > 0 && match[0].status === "finished") {
        return {
          homeScore: match[0].homeScore ?? 0,
          awayScore: match[0].awayScore ?? 0,
          finished: true
        };
      }
      
      if (match.length > 0 && match[0].matchDate < new Date()) {
        const hoursSinceMatch = (Date.now() - new Date(match[0].matchDate).getTime()) / (1000 * 60 * 60);
        
        if (hoursSinceMatch > 4) {
          const { sportsGameOddsService } = await import("./sportsGameOddsService");
          const updatedOdds = await sportsGameOddsService.getOddsBySport(sport === "nfl" ? "americanfootball" : sport);
          
          if (updatedOdds && Array.isArray(updatedOdds)) {
            for (const game of updatedOdds) {
              if (game.home_team === match[0].homeTeam && game.away_team === match[0].awayTeam) {
                if (game.scores) {
                  const homeScore = game.scores.find((s: any) => s.name === match[0].homeTeam)?.score ?? 0;
                  const awayScore = game.scores.find((s: any) => s.name === match[0].awayTeam)?.score ?? 0;
                  
                  await db.update(cachedMatches)
                    .set({ 
                      status: "finished",
                      homeScore,
                      awayScore,
                      updatedAt: new Date()
                    })
                    .where(eq(cachedMatches.id, matchId));
                  
                  return { homeScore, awayScore, finished: true };
                }
              }
            }
          }
        }
      }
      
      return null;
    } catch (error) {
      console.error(`[PREDICTION-MEMORY] Error fetching ${sport} result for match ${matchId}:`, error);
      return null;
    }
  }

  // ========================================
  // FOOTDATAS INTEGRATION
  // ========================================

  async getFootdatasEnrichedPrediction(homeTeam: string, awayTeam: string): Promise<{
    teamData: any;
    enhancedStats: StatsData | null;
  }> {
    try {
      const { footdatasService } = await import("./footdatasService");
      const teamData = await footdatasService.getTeamDataForPrediction(homeTeam, awayTeam);

      const enhancedStats: StatsData = {
        homeForm: teamData.homeTeam.recentForm,
        awayForm: teamData.awayTeam.recentForm,
        homeGoalsAvg: teamData.homeTeam.avgGoals,
        awayGoalsAvg: teamData.awayTeam.avgGoals,
        h2hHistory: {
          homeWins: teamData.h2h.homeWins,
          draws: teamData.h2h.draws,
          awayWins: teamData.h2h.awayWins,
          lastMeetings: teamData.h2h.lastMeetings.slice(0, 5).map(m => ({
            date: m.matchDate,
            homeScore: m.homeScore,
            awayScore: m.awayScore
          }))
        }
      };

      console.log(`[PREDICTION-MEMORY] Enriched with Footdatas: ${homeTeam} (${teamData.homeTeam.recentForm}) vs ${awayTeam} (${teamData.awayTeam.recentForm})`);

      return { teamData, enhancedStats };
    } catch (error) {
      console.error("[PREDICTION-MEMORY] Error getting Footdatas enrichment:", error);
      return { teamData: null, enhancedStats: null };
    }
  }

  async enrichFootdatasWithResults(): Promise<{ synced: number; errors: number }> {
    try {
      const settledPredictions = await db.select()
        .from(sportsPredictionSnapshots)
        .where(and(
          sql`${sportsPredictionSnapshots.actualResult} IS NOT NULL`,
          eq(sportsPredictionSnapshots.sport, 'football'),
          sql`${sportsPredictionSnapshots.footdatasSynced} IS NOT TRUE`
        ))
        .limit(100);

      if (settledPredictions.length === 0) {
        console.log("[PREDICTION-MEMORY] No predictions to sync to Footdatas");
        return { synced: 0, errors: 0 };
      }

      const { footdatasService } = await import("./footdatasService");
      let synced = 0;
      let errors = 0;

      for (const pred of settledPredictions) {
        try {
          const actualResult = pred.actualResult as any;
          const performance = pred.predictionPerformance as any;
          const recommendations = pred.recommendations as any;

          if (pred.matchId) {
            await footdatasService.updateMatchWithPredictionResult(pred.matchId, {
              homeScore: actualResult.homeScore,
              awayScore: actualResult.awayScore,
              predictionWon: performance?.mainBetWon || false,
              betType: recommendations?.bestBet || "unknown",
              confidence: recommendations?.confidence || 50
            });
          }

          await db.update(sportsPredictionSnapshots)
            .set({ footdatasSynced: true, updatedAt: new Date() })
            .where(eq(sportsPredictionSnapshots.id, pred.id));

          synced++;
        } catch (err) {
          console.error(`[PREDICTION-MEMORY] Error syncing prediction ${pred.id} to Footdatas:`, err);
          errors++;
        }
      }

      console.log(`[PREDICTION-MEMORY] Footdatas sync complete: ${synced} synced, ${errors} errors`);
      return { synced, errors };
    } catch (error) {
      console.error("[PREDICTION-MEMORY] Error in enrichFootdatasWithResults:", error);
      return { synced: 0, errors: 1 };
    }
  }

  async savePredictionWithFootdatas(
    match: MatchInfo,
    odds: OddsData,
    predictions: PredictionData,
    recommendations: RecommendationData
  ): Promise<number | null> {
    const { enhancedStats } = await this.getFootdatasEnrichedPrediction(match.homeTeam, match.awayTeam);
    return this.savePrediction(match, odds, enhancedStats, predictions, recommendations);
  }
}

export const sportsPredictionMemoryService = new SportsPredictionMemoryService();
