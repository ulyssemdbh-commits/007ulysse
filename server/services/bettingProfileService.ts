import { db } from "../db";
import { bettingProfiles, bettingHistory, bettingStats, BettingProfile, BettingHistoryEntry } from "@shared/schema";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";

// Profil par défaut de Maurice
const MAURICE_DEFAULT_PROFILE: Partial<BettingProfile> = {
  favoriteLeagues: ["Ligue 1", "Premier League", "Champions League", "La Liga"],
  preferredBetTypes: ["1X2", "over_under", "btts", "combo"],
  riskProfile: "balanced",
  favoriteTeams: ["PSG", "Marseille", "Lyon", "Real Madrid", "Barcelona", "Liverpool", "Arsenal"],
  blacklistedTeams: [],
  minOdds: 1.3,
  maxOdds: 4.0,
  preferredTimeSlots: ["afternoon", "evening", "prime_time"],
  preferredTags: ["combo_safe", "high_scoring", "btts_likely", "value_bet", "both_in_form"],
  avoidedTags: ["avoid", "low_scoring"],
};

class BettingProfileService {
  
  async getOrCreateProfile(userId: number): Promise<BettingProfile> {
    const existing = await db.select()
      .from(bettingProfiles)
      .where(eq(bettingProfiles.userId, userId))
      .limit(1);
    
    if (existing.length > 0) {
      return existing[0];
    }
    
    // Créer profil par défaut (style Maurice pour userId 1)
    const defaultProfile = userId === 1 ? MAURICE_DEFAULT_PROFILE : {};
    
    const [profile] = await db.insert(bettingProfiles)
      .values({
        userId,
        ...defaultProfile,
      })
      .returning();
    
    console.log(`[BETTING-PROFILE] Created profile for user ${userId}`);
    return profile;
  }
  
  async updateProfile(userId: number, updates: Partial<BettingProfile>): Promise<BettingProfile> {
    const [profile] = await db.update(bettingProfiles)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(bettingProfiles.userId, userId))
      .returning();
    
    return profile;
  }
  
  async addPrediction(entry: {
    userId: number;
    homeTeam: string;
    awayTeam: string;
    league: string;
    matchDate: Date;
    predictedBetType: string;
    predictedOdds?: number;
    confidence?: number;
    reasoning?: string;
    tags?: string[];
    matchId?: number;
  }): Promise<BettingHistoryEntry> {
    const [prediction] = await db.insert(bettingHistory)
      .values({
        userId: entry.userId,
        homeTeam: entry.homeTeam,
        awayTeam: entry.awayTeam,
        league: entry.league,
        matchDate: entry.matchDate,
        predictedBetType: entry.predictedBetType,
        predictedOdds: entry.predictedOdds,
        confidence: entry.confidence,
        reasoning: entry.reasoning,
        tags: entry.tags || [],
        matchId: entry.matchId,
        source: "ulysse",
      })
      .returning();
    
    console.log(`[BETTING-HISTORY] Added prediction: ${entry.homeTeam} vs ${entry.awayTeam} - ${entry.predictedBetType}`);
    return prediction;
  }
  
  async settlePrediction(
    predictionId: number, 
    homeScore: number, 
    awayScore: number,
    userId?: number
  ): Promise<BettingHistoryEntry> {
    const [prediction] = await db.select()
      .from(bettingHistory)
      .where(eq(bettingHistory.id, predictionId))
      .limit(1);
    
    if (!prediction) {
      throw new Error(`Prediction ${predictionId} not found`);
    }
    
    // Verify ownership if userId provided
    if (userId && prediction.userId !== userId) {
      throw new Error(`Prediction ${predictionId} does not belong to user ${userId}`);
    }
    
    const result = this.evaluateBetResult(
      prediction.predictedBetType,
      homeScore,
      awayScore
    );
    
    const [updated] = await db.update(bettingHistory)
      .set({
        actualHomeScore: homeScore,
        actualAwayScore: awayScore,
        betResult: result,
        settledAt: new Date(),
        actualWin: result === "won" && prediction.stakeAmount && prediction.predictedOdds
          ? prediction.stakeAmount * prediction.predictedOdds
          : 0,
      })
      .where(eq(bettingHistory.id, predictionId))
      .returning();
    
    await this.updateStats(prediction.userId);
    
    return updated;
  }
  
  private evaluateBetResult(betType: string, homeScore: number, awayScore: number): string {
    const totalGoals = homeScore + awayScore;
    const btts = homeScore > 0 && awayScore > 0;
    
    switch (betType.toUpperCase()) {
      case "1":
        return homeScore > awayScore ? "won" : "lost";
      case "X":
        return homeScore === awayScore ? "won" : "lost";
      case "2":
        return awayScore > homeScore ? "won" : "lost";
      case "1X":
        return homeScore >= awayScore ? "won" : "lost";
      case "X2":
        return awayScore >= homeScore ? "won" : "lost";
      case "12":
        return homeScore !== awayScore ? "won" : "lost";
      case "O2.5":
      case "OVER2.5":
        return totalGoals > 2.5 ? "won" : "lost";
      case "U2.5":
      case "UNDER2.5":
        return totalGoals < 2.5 ? "won" : "lost";
      case "O1.5":
      case "OVER1.5":
        return totalGoals > 1.5 ? "won" : "lost";
      case "U1.5":
      case "UNDER1.5":
        return totalGoals < 1.5 ? "won" : "lost";
      case "BTTS":
      case "BTTS_YES":
        return btts ? "won" : "lost";
      case "BTTS_NO":
        return !btts ? "won" : "lost";
      default:
        return "void";
    }
  }
  
  async getHistory(userId: number, options?: {
    limit?: number;
    offset?: number;
    result?: string;
    league?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<BettingHistoryEntry[]> {
    // Build conditions array
    const conditions = [eq(bettingHistory.userId, userId)];
    
    if (options?.result) {
      conditions.push(eq(bettingHistory.betResult, options.result));
    }
    
    if (options?.league) {
      conditions.push(eq(bettingHistory.league, options.league));
    }
    
    if (options?.startDate) {
      conditions.push(gte(bettingHistory.matchDate, options.startDate));
    }
    
    if (options?.endDate) {
      conditions.push(lte(bettingHistory.matchDate, options.endDate));
    }
    
    const results = await db.select()
      .from(bettingHistory)
      .where(and(...conditions))
      .orderBy(desc(bettingHistory.matchDate))
      .limit(options?.limit || 50)
      .offset(options?.offset || 0);
    
    return results;
  }
  
  async getPendingPredictions(userId: number): Promise<BettingHistoryEntry[]> {
    return db.select()
      .from(bettingHistory)
      .where(and(
        eq(bettingHistory.userId, userId),
        eq(bettingHistory.betResult, "pending")
      ))
      .orderBy(desc(bettingHistory.matchDate));
  }
  
  async getStats(userId: number, period: string = "all_time"): Promise<{
    total: number;
    won: number;
    lost: number;
    pending: number;
    successRate: number;
    roi: number;
    byBetType: Record<string, {total: number, won: number, rate: number}>;
    byLeague: Record<string, {total: number, won: number, rate: number}>;
    currentStreak: number;
  }> {
    const history = await this.getHistory(userId, { limit: 500 });
    
    const settled = history.filter(h => h.betResult && h.betResult !== "pending");
    const won = settled.filter(h => h.betResult === "won").length;
    const lost = settled.filter(h => h.betResult === "lost").length;
    const pending = history.filter(h => h.betResult === "pending" || !h.betResult).length;
    
    // Stats par type de pari
    const byBetType: Record<string, {total: number, won: number, rate: number}> = {};
    for (const h of settled) {
      const type = h.predictedBetType;
      if (!byBetType[type]) {
        byBetType[type] = { total: 0, won: 0, rate: 0 };
      }
      byBetType[type].total++;
      if (h.betResult === "won") byBetType[type].won++;
    }
    for (const type in byBetType) {
      byBetType[type].rate = byBetType[type].total > 0 
        ? Math.round((byBetType[type].won / byBetType[type].total) * 100) 
        : 0;
    }
    
    // Stats par ligue
    const byLeague: Record<string, {total: number, won: number, rate: number}> = {};
    for (const h of settled) {
      const league = h.league;
      if (!byLeague[league]) {
        byLeague[league] = { total: 0, won: 0, rate: 0 };
      }
      byLeague[league].total++;
      if (h.betResult === "won") byLeague[league].won++;
    }
    for (const league in byLeague) {
      byLeague[league].rate = byLeague[league].total > 0 
        ? Math.round((byLeague[league].won / byLeague[league].total) * 100) 
        : 0;
    }
    
    // ROI
    const totalStaked = history.reduce((sum, h) => sum + (h.stakeAmount || 0), 0);
    const totalWon = history.reduce((sum, h) => sum + (h.actualWin || 0), 0);
    const roi = totalStaked > 0 ? Math.round(((totalWon - totalStaked) / totalStaked) * 100) : 0;
    
    // Current streak
    let currentStreak = 0;
    const sortedSettled = settled.sort((a, b) => 
      new Date(b.settledAt || b.matchDate).getTime() - new Date(a.settledAt || a.matchDate).getTime()
    );
    if (sortedSettled.length > 0) {
      const lastResult = sortedSettled[0].betResult;
      for (const h of sortedSettled) {
        if (h.betResult === lastResult) {
          currentStreak += lastResult === "won" ? 1 : -1;
        } else {
          break;
        }
      }
    }
    
    return {
      total: history.length,
      won,
      lost,
      pending,
      successRate: settled.length > 0 ? Math.round((won / settled.length) * 100) : 0,
      roi,
      byBetType,
      byLeague,
      currentStreak,
    };
  }
  
  async updateStats(userId: number): Promise<void> {
    const stats = await this.getStats(userId);
    
    // Upsert stats
    await db.insert(bettingStats)
      .values({
        userId,
        period: "all_time",
        totalPredictions: stats.total,
        correctPredictions: stats.won,
        successRate: stats.successRate,
        statsByBetType: stats.byBetType,
        statsByLeague: stats.byLeague,
        roi: stats.roi,
        currentStreak: stats.currentStreak,
        bestStreak: stats.currentStreak > 0 ? stats.currentStreak : 0,
        worstStreak: stats.currentStreak < 0 ? stats.currentStreak : 0,
      })
      .onConflictDoUpdate({
        target: [bettingStats.userId, bettingStats.period],
        set: {
          totalPredictions: stats.total,
          correctPredictions: stats.won,
          successRate: stats.successRate,
          statsByBetType: stats.byBetType,
          statsByLeague: stats.byLeague,
          roi: stats.roi,
          currentStreak: stats.currentStreak,
          lastUpdated: new Date(),
        },
      });
  }
  
  formatStatsForAI(stats: Awaited<ReturnType<typeof this.getStats>>): string {
    let output = `**STATS PARIS ULYSSE**\n`;
    output += `Total: ${stats.total} predictions | Gagnes: ${stats.won} | Perdus: ${stats.lost} | En attente: ${stats.pending}\n`;
    output += `Taux de reussite: ${stats.successRate}%\n`;
    
    if (stats.currentStreak !== 0) {
      const streakText = stats.currentStreak > 0 ? `${stats.currentStreak} victoires de suite` : `${Math.abs(stats.currentStreak)} defaites de suite`;
      output += `Serie actuelle: ${streakText}\n`;
    }
    
    if (Object.keys(stats.byBetType).length > 0) {
      output += `\n**Par type de pari:**\n`;
      const sorted = Object.entries(stats.byBetType)
        .sort(([,a], [,b]) => b.total - a.total)
        .slice(0, 5);
      for (const [type, data] of sorted) {
        output += `- ${type}: ${data.won}/${data.total} (${data.rate}%)\n`;
      }
    }
    
    if (Object.keys(stats.byLeague).length > 0) {
      output += `\n**Par ligue:**\n`;
      const sorted = Object.entries(stats.byLeague)
        .sort(([,a], [,b]) => b.total - a.total)
        .slice(0, 5);
      for (const [league, data] of sorted) {
        output += `- ${league}: ${data.won}/${data.total} (${data.rate}%)\n`;
      }
    }
    
    return output;
  }
  
  formatProfileForAI(profile: BettingProfile): string {
    let output = `**PROFIL PARIS**\n`;
    const riskLabel = profile.riskProfile === 'safe' ? 'Prudent' : profile.riskProfile === 'aggressive' ? 'Agressif' : 'Equilibre';
    output += `Style: ${riskLabel}\n`;
    
    if (profile.favoriteLeagues && (profile.favoriteLeagues as string[]).length > 0) {
      output += `Ligues favorites: ${(profile.favoriteLeagues as string[]).join(', ')}\n`;
    }
    
    if (profile.favoriteTeams && (profile.favoriteTeams as string[]).length > 0) {
      output += `Equipes favorites: ${(profile.favoriteTeams as string[]).join(', ')}\n`;
    }
    
    if (profile.preferredBetTypes && (profile.preferredBetTypes as string[]).length > 0) {
      output += `Paris preferes: ${(profile.preferredBetTypes as string[]).join(', ')}\n`;
    }
    
    output += `Cotes: ${profile.minOdds || 1.2} - ${profile.maxOdds || 5.0}\n`;
    
    return output;
  }
}

export const bettingProfileService = new BettingProfileService();
