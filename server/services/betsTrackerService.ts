import { db } from "../db";
import { actualBets, type InsertActualBet, type ActualBet } from "@shared/schema";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { learningOptimizerService } from "./learningOptimizer";
import { brainService } from "./brainService";

interface BetStats {
  totalBets: number;
  wonBets: number;
  lostBets: number;
  pendingBets: number;
  totalStaked: number;
  totalProfit: number;
  roi: number;
  winRate: number;
  averageOdds: number;
  averageStake: number;
}

interface BetStatsByType {
  betType: string;
  totalBets: number;
  wonBets: number;
  winRate: number;
  roi: number;
  profit: number;
}

interface BetStatsByLeague {
  league: string;
  sport: string;
  totalBets: number;
  wonBets: number;
  winRate: number;
  roi: number;
  profit: number;
}

interface BetStatsByBookmaker {
  bookmaker: string;
  totalBets: number;
  wonBets: number;
  winRate: number;
  roi: number;
  profit: number;
}

interface BetStatsByOddsRange {
  range: string;
  minOdds: number;
  maxOdds: number;
  totalBets: number;
  wonBets: number;
  winRate: number;
  roi: number;
  profit: number;
}

class BetsTrackerService {
  
  async recordBet(bet: InsertActualBet): Promise<ActualBet | null> {
    try {
      const potentialWin = bet.stake * bet.odds;
      
      const inserted = await db.insert(actualBets)
        .values({
          ...bet,
          potentialWin,
          status: "pending"
        })
        .returning();
      
      console.log(`[BETS-TRACKER] Recorded bet: ${bet.homeTeam} vs ${bet.awayTeam} - ${bet.betType} @${bet.odds} (${bet.stake}€)`);
      if (inserted[0]) {
        const { emitBetEvent } = await import("./interconnectEmitter");
        emitBetEvent("placed", { ...inserted[0], ...bet });
      }
      return inserted[0] || null;
    } catch (error) {
      console.error("[BETS-TRACKER] Error recording bet:", error);
      return null;
    }
  }

  async settleBet(
    betId: number,
    homeScore: number,
    awayScore: number,
    status: "won" | "lost" | "void" | "cashout",
    cashoutAmount?: number
  ): Promise<boolean> {
    try {
      const bet = await db.select().from(actualBets).where(eq(actualBets.id, betId)).limit(1);
      if (!bet[0]) return false;

      const currentBet = bet[0];
      let profit = 0;

      if (status === "won") {
        profit = (currentBet.stake * currentBet.odds) - currentBet.stake;
      } else if (status === "lost") {
        profit = -currentBet.stake;
      } else if (status === "cashout" && cashoutAmount !== undefined) {
        profit = cashoutAmount - currentBet.stake;
      }

      await db.update(actualBets)
        .set({
          status,
          profit,
          actualResult: { homeScore, awayScore, settledAt: new Date().toISOString() },
          settledAt: new Date()
        })
        .where(eq(actualBets.id, betId));

      // Feed into learning system
      await this.feedbackToLearning(currentBet, status === "won", profit);

      const { emitBetEvent } = await import("./interconnectEmitter");
      emitBetEvent("settled", { ...currentBet, status, profit });

      console.log(`[BETS-TRACKER] Settled bet #${betId}: ${status} (profit: ${profit.toFixed(2)}€)`);
      return true;
    } catch (error) {
      console.error("[BETS-TRACKER] Error settling bet:", error);
      return false;
    }
  }

  async autoSettleFromResult(
    matchId: number | string,
    homeScore: number,
    awayScore: number
  ): Promise<number> {
    try {
      const query = typeof matchId === "number"
        ? eq(actualBets.matchId, matchId)
        : eq(actualBets.externalMatchId, String(matchId));

      const pendingBets = await db.select()
        .from(actualBets)
        .where(and(query, eq(actualBets.status, "pending")));

      let settledCount = 0;

      for (const bet of pendingBets) {
        const won = this.evaluateBetResult(bet.betType, homeScore, awayScore);
        const status = won ? "won" : "lost";
        const profit = won ? (bet.stake * bet.odds) - bet.stake : -bet.stake;

        await db.update(actualBets)
          .set({
            status,
            profit,
            actualResult: { homeScore, awayScore, settledAt: new Date().toISOString() },
            settledAt: new Date()
          })
          .where(eq(actualBets.id, bet.id));

        await this.feedbackToLearning(bet, won, profit);
        settledCount++;
      }

      if (settledCount > 0) {
        console.log(`[BETS-TRACKER] Auto-settled ${settledCount} bets for match ${matchId} (${homeScore}-${awayScore})`);
      }

      return settledCount;
    } catch (error) {
      console.error("[BETS-TRACKER] Error auto-settling bets:", error);
      return 0;
    }
  }

  private evaluateBetResult(betType: string, homeScore: number, awayScore: number): boolean {
    const totalGoals = homeScore + awayScore;
    const btts = homeScore > 0 && awayScore > 0;
    const normalizedBet = betType.toLowerCase().trim();

    if (normalizedBet === "1" || normalizedBet === "home") return homeScore > awayScore;
    if (normalizedBet === "x" || normalizedBet === "draw") return homeScore === awayScore;
    if (normalizedBet === "2" || normalizedBet === "away") return awayScore > homeScore;
    if (normalizedBet === "1x" || normalizedBet === "home or draw") return homeScore >= awayScore;
    if (normalizedBet === "x2" || normalizedBet === "draw or away") return awayScore >= homeScore;
    if (normalizedBet === "12" || normalizedBet === "home or away") return homeScore !== awayScore;
    if (normalizedBet === "over 2.5" || normalizedBet === "+2.5") return totalGoals > 2.5;
    if (normalizedBet === "under 2.5" || normalizedBet === "-2.5") return totalGoals < 2.5;
    if (normalizedBet === "over 1.5" || normalizedBet === "+1.5") return totalGoals > 1.5;
    if (normalizedBet === "under 1.5" || normalizedBet === "-1.5") return totalGoals < 1.5;
    if (normalizedBet === "over 3.5" || normalizedBet === "+3.5") return totalGoals > 3.5;
    if (normalizedBet === "under 3.5" || normalizedBet === "-3.5") return totalGoals < 3.5;
    if (normalizedBet === "btts yes" || normalizedBet === "btts") return btts;
    if (normalizedBet === "btts no") return !btts;

    console.warn(`[BETS-TRACKER] Unknown bet type: ${betType}`);
    return false;
  }

  private async feedbackToLearning(bet: ActualBet, won: boolean, profit: number): Promise<void> {
    try {
      await learningOptimizerService.onPredictionResult(bet.userId, {
        won,
        betType: bet.betType,
        sport: bet.sport,
        league: bet.league,
        confidence: bet.confidence || 50,
        valueScore: bet.isValueBet ? 80 : 50,
        homeTeam: bet.homeTeam,
        awayTeam: bet.awayTeam
      });

      // Log to brain for pattern learning
      const topic = `bet_result_${bet.sport}_${bet.league}`.toLowerCase().replace(/\s+/g, "_");
      await brainService.logLearning(bet.userId, {
        source: "bets_tracker",
        topic,
        content: `${bet.betType} @${bet.odds.toFixed(2)} on ${bet.homeTeam} vs ${bet.awayTeam}: ${won ? "WON" : "LOST"} (${profit >= 0 ? "+" : ""}${profit.toFixed(2)}€)`,
        confidenceChange: won ? 5 : -3
      });

    } catch (error) {
      console.error("[BETS-TRACKER] Feedback loop error:", error);
    }
  }

  async getStats(userId: number, days: number = 30): Promise<BetStats> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const bets = await db.select()
      .from(actualBets)
      .where(and(
        eq(actualBets.userId, userId),
        gte(actualBets.createdAt, startDate)
      ));

    const settled = bets.filter(b => b.status !== "pending");
    const won = bets.filter(b => b.status === "won");
    const lost = bets.filter(b => b.status === "lost");
    const pending = bets.filter(b => b.status === "pending");

    const totalStaked = settled.reduce((sum, b) => sum + b.stake, 0);
    const totalProfit = settled.reduce((sum, b) => sum + (b.profit || 0), 0);
    const avgOdds = bets.length > 0 ? bets.reduce((sum, b) => sum + b.odds, 0) / bets.length : 0;
    const avgStake = bets.length > 0 ? bets.reduce((sum, b) => sum + b.stake, 0) / bets.length : 0;

    return {
      totalBets: bets.length,
      wonBets: won.length,
      lostBets: lost.length,
      pendingBets: pending.length,
      totalStaked: Math.round(totalStaked * 100) / 100,
      totalProfit: Math.round(totalProfit * 100) / 100,
      roi: totalStaked > 0 ? Math.round((totalProfit / totalStaked) * 10000) / 100 : 0,
      winRate: settled.length > 0 ? Math.round((won.length / settled.length) * 10000) / 100 : 0,
      averageOdds: Math.round(avgOdds * 100) / 100,
      averageStake: Math.round(avgStake * 100) / 100
    };
  }

  async getStatsByBetType(userId: number, days: number = 30): Promise<BetStatsByType[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const bets = await db.select()
      .from(actualBets)
      .where(and(
        eq(actualBets.userId, userId),
        gte(actualBets.createdAt, startDate)
      ));

    const grouped = new Map<string, ActualBet[]>();
    for (const bet of bets) {
      const key = bet.betType;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(bet);
    }

    return Array.from(grouped.entries()).map(([betType, typeBets]) => {
      const settled = typeBets.filter(b => b.status !== "pending");
      const won = typeBets.filter(b => b.status === "won");
      const staked = settled.reduce((sum, b) => sum + b.stake, 0);
      const profit = settled.reduce((sum, b) => sum + (b.profit || 0), 0);

      return {
        betType,
        totalBets: typeBets.length,
        wonBets: won.length,
        winRate: settled.length > 0 ? Math.round((won.length / settled.length) * 100) : 0,
        roi: staked > 0 ? Math.round((profit / staked) * 100) : 0,
        profit: Math.round(profit * 100) / 100
      };
    }).sort((a, b) => b.roi - a.roi);
  }

  async getStatsByLeague(userId: number, days: number = 30): Promise<BetStatsByLeague[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const bets = await db.select()
      .from(actualBets)
      .where(and(
        eq(actualBets.userId, userId),
        gte(actualBets.createdAt, startDate)
      ));

    const grouped = new Map<string, { sport: string; bets: ActualBet[] }>();
    for (const bet of bets) {
      const key = bet.league;
      if (!grouped.has(key)) grouped.set(key, { sport: bet.sport, bets: [] });
      grouped.get(key)!.bets.push(bet);
    }

    return Array.from(grouped.entries()).map(([league, { sport, bets: leagueBets }]) => {
      const settled = leagueBets.filter(b => b.status !== "pending");
      const won = leagueBets.filter(b => b.status === "won");
      const staked = settled.reduce((sum, b) => sum + b.stake, 0);
      const profit = settled.reduce((sum, b) => sum + (b.profit || 0), 0);

      return {
        league,
        sport,
        totalBets: leagueBets.length,
        wonBets: won.length,
        winRate: settled.length > 0 ? Math.round((won.length / settled.length) * 100) : 0,
        roi: staked > 0 ? Math.round((profit / staked) * 100) : 0,
        profit: Math.round(profit * 100) / 100
      };
    }).sort((a, b) => b.roi - a.roi);
  }

  async getStatsByBookmaker(userId: number, days: number = 30): Promise<BetStatsByBookmaker[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const bets = await db.select()
      .from(actualBets)
      .where(and(
        eq(actualBets.userId, userId),
        gte(actualBets.createdAt, startDate)
      ));

    const grouped = new Map<string, ActualBet[]>();
    for (const bet of bets) {
      const key = bet.bookmaker;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(bet);
    }

    return Array.from(grouped.entries()).map(([bookmaker, bookBets]) => {
      const settled = bookBets.filter(b => b.status !== "pending");
      const won = bookBets.filter(b => b.status === "won");
      const staked = settled.reduce((sum, b) => sum + b.stake, 0);
      const profit = settled.reduce((sum, b) => sum + (b.profit || 0), 0);

      return {
        bookmaker,
        totalBets: bookBets.length,
        wonBets: won.length,
        winRate: settled.length > 0 ? Math.round((won.length / settled.length) * 100) : 0,
        roi: staked > 0 ? Math.round((profit / staked) * 100) : 0,
        profit: Math.round(profit * 100) / 100
      };
    }).sort((a, b) => b.roi - a.roi);
  }

  async getStatsByOddsRange(userId: number, days: number = 30): Promise<BetStatsByOddsRange[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const bets = await db.select()
      .from(actualBets)
      .where(and(
        eq(actualBets.userId, userId),
        gte(actualBets.createdAt, startDate)
      ));

    const ranges = [
      { range: "1.01-1.50", min: 1.01, max: 1.50 },
      { range: "1.51-2.00", min: 1.51, max: 2.00 },
      { range: "2.01-2.50", min: 2.01, max: 2.50 },
      { range: "2.51-3.00", min: 2.51, max: 3.00 },
      { range: "3.01-5.00", min: 3.01, max: 5.00 },
      { range: "5.01+", min: 5.01, max: 100 }
    ];

    return ranges.map(({ range, min, max }) => {
      const rangeBets = bets.filter(b => b.odds >= min && b.odds <= max);
      const settled = rangeBets.filter(b => b.status !== "pending");
      const won = rangeBets.filter(b => b.status === "won");
      const staked = settled.reduce((sum, b) => sum + b.stake, 0);
      const profit = settled.reduce((sum, b) => sum + (b.profit || 0), 0);

      return {
        range,
        minOdds: min,
        maxOdds: max,
        totalBets: rangeBets.length,
        wonBets: won.length,
        winRate: settled.length > 0 ? Math.round((won.length / settled.length) * 100) : 0,
        roi: staked > 0 ? Math.round((profit / staked) * 100) : 0,
        profit: Math.round(profit * 100) / 100
      };
    }).filter(r => r.totalBets > 0);
  }

  async getPendingBets(userId: number): Promise<ActualBet[]> {
    return db.select()
      .from(actualBets)
      .where(and(
        eq(actualBets.userId, userId),
        eq(actualBets.status, "pending")
      ))
      .orderBy(desc(actualBets.matchDate));
  }

  async getRecentBets(userId: number, limit: number = 20): Promise<ActualBet[]> {
    return db.select()
      .from(actualBets)
      .where(eq(actualBets.userId, userId))
      .orderBy(desc(actualBets.createdAt))
      .limit(limit);
  }

  async getBestPerformingBetTypes(userId: number, minBets: number = 5): Promise<BetStatsByType[]> {
    const stats = await this.getStatsByBetType(userId, 90);
    return stats.filter(s => s.totalBets >= minBets && s.roi > 0);
  }

  async getWorstPerformingBetTypes(userId: number, minBets: number = 5): Promise<BetStatsByType[]> {
    const stats = await this.getStatsByBetType(userId, 90);
    return stats.filter(s => s.totalBets >= minBets && s.roi < 0).sort((a, b) => a.roi - b.roi);
  }

  async getFullDashboard(userId: number): Promise<{
    overall: BetStats;
    byType: BetStatsByType[];
    byLeague: BetStatsByLeague[];
    byBookmaker: BetStatsByBookmaker[];
    byOddsRange: BetStatsByOddsRange[];
    pendingBets: ActualBet[];
    recentBets: ActualBet[];
    bestTypes: BetStatsByType[];
    worstTypes: BetStatsByType[];
  }> {
    const [overall, byType, byLeague, byBookmaker, byOddsRange, pendingBets, recentBets] = await Promise.all([
      this.getStats(userId, 30),
      this.getStatsByBetType(userId, 30),
      this.getStatsByLeague(userId, 30),
      this.getStatsByBookmaker(userId, 30),
      this.getStatsByOddsRange(userId, 30),
      this.getPendingBets(userId),
      this.getRecentBets(userId, 10)
    ]);

    const bestTypes = byType.filter(s => s.totalBets >= 3 && s.roi > 0).slice(0, 5);
    const worstTypes = byType.filter(s => s.totalBets >= 3 && s.roi < 0).sort((a, b) => a.roi - b.roi).slice(0, 5);

    return {
      overall,
      byType,
      byLeague,
      byBookmaker,
      byOddsRange,
      pendingBets,
      recentBets,
      bestTypes,
      worstTypes
    };
  }
}

export const betsTrackerService = new BetsTrackerService();
