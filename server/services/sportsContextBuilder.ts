import { sportsCacheService } from "./sportsCacheService";
import { db } from "../db";
import { knowledgeBase, sportsPredictionSnapshots } from "@shared/schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";

export interface SportsScreenState {
  page: "predictions" | "almanach" | null;
  tab?: string;
  selectedLeague?: string;
  selectedTeamId?: number;
  selectedTeamName?: string;
  selectedMatchId?: number;
  selectedMatchLabel?: string;
  visiblePredictions?: Array<{
    fixtureId: number;
    homeTeam: string;
    awayTeam: string;
    bestBet: string;
    confidence: number;
    odds?: number;
  }>;
  cumulativeOdds?: number;
  riskLevel?: string;
  standings?: { position: number; team: string; points: number }[];
  updatedAt: number;
}

const userScreenState = new Map<number, SportsScreenState>();
const SCREEN_STALE_AFTER_MS = 5 * 60 * 1000;

export function updateSportsScreen(userId: number, state: Partial<SportsScreenState>) {
  const existing = userScreenState.get(userId);
  userScreenState.set(userId, {
    ...existing,
    ...state,
    updatedAt: Date.now(),
  } as SportsScreenState);
}

export function getSportsScreen(userId: number): SportsScreenState | null {
  const state = userScreenState.get(userId);
  if (!state) return null;
  if (Date.now() - state.updatedAt > SCREEN_STALE_AFTER_MS) {
    userScreenState.delete(userId);
    return null;
  }
  return state;
}

export function clearSportsScreen(userId: number) {
  userScreenState.delete(userId);
}

export function formatSportsContextForAI(userId: number): string | null {
  const state = getSportsScreen(userId);
  if (!state || !state.page) return null;

  const lines: string[] = [];
  const ageSeconds = Math.round((Date.now() - state.updatedAt) / 1000);
  lines.push(`[CONTEXTE ÉCRAN LIVE - il y a ${ageSeconds}s]`);

  if (state.page === "predictions") {
    lines.push(`Page: Djedou Pronos (onglet: ${state.tab || "matchs"})`);
    if (state.riskLevel) lines.push(`Niveau de risque: ${state.riskLevel}`);
    if (state.visiblePredictions && state.visiblePredictions.length > 0) {
      lines.push(`Pronostics affichés (${state.visiblePredictions.length}):`);
      for (const p of state.visiblePredictions) {
        lines.push(`  - ${p.homeTeam} vs ${p.awayTeam}: ${p.bestBet} (confiance ${p.confidence}%${p.odds ? `, cote ${p.odds.toFixed(2)}` : ""})`);
      }
      if (state.cumulativeOdds) {
        lines.push(`Cote cumulée: x${state.cumulativeOdds.toFixed(2)}`);
      }
    }
    if (state.selectedMatchId && state.selectedMatchLabel) {
      lines.push(`Match sélectionné: ${state.selectedMatchLabel}`);
    }
  } else if (state.page === "almanach") {
    lines.push(`Page: Foot-Almanach`);
    if (state.selectedLeague) lines.push(`Ligue: ${state.selectedLeague}`);
    if (state.selectedTeamName) lines.push(`Équipe: ${state.selectedTeamName}`);
    if (state.tab) lines.push(`Vue: ${state.tab}`);
    if (state.standings && state.standings.length > 0) {
      lines.push(`Classement visible (top 5):`);
      for (const s of state.standings.slice(0, 5)) {
        lines.push(`  ${s.position}. ${s.team} - ${s.points} pts`);
      }
    }
  }

  return lines.join("\n");
}

interface SportsContext {
  matchesToday: string;
  standings?: string;
  recentPredictions?: string;
  cachedOdds?: string;
  brainInsights?: string;
  freshness: "live" | "cached" | "stale";
  builtAt: number;
}

const CONTEXT_CACHE = new Map<string, { context: SportsContext; expiresAt: number }>();
const CACHE_TTL_LIVE = 2 * 60 * 1000;
const CACHE_TTL_DEFAULT = 10 * 60 * 1000;

function isLiveMatchTime(): boolean {
  const now = new Date();
  const hour = now.getHours();
  return hour >= 18 && hour <= 23;
}

export const sportsContextBuilder = {
  async buildContextForMessage(userId: number, userMessage: string): Promise<string | null> {
    try {
      const cacheKey = `sports_${userId}`;
      const cached = CONTEXT_CACHE.get(cacheKey);
      
      if (cached && Date.now() < cached.expiresAt) {
        console.log(`[SportsContext] Cache hit for user ${userId}`);
        return this.formatContext(cached.context);
      }

      const context = await this.buildFullContext(userId, userMessage);
      
      if (!context) return null;

      const ttl = isLiveMatchTime() ? CACHE_TTL_LIVE : CACHE_TTL_DEFAULT;
      CONTEXT_CACHE.set(cacheKey, { context, expiresAt: Date.now() + ttl });

      return this.formatContext(context);
    } catch (error) {
      console.error("[SportsContext] Build error:", error);
      return null;
    }
  },

  async buildFullContext(userId: number, userMessage: string): Promise<SportsContext | null> {
    const startTime = Date.now();
    const context: SportsContext = {
      matchesToday: "",
      freshness: "cached",
      builtAt: startTime
    };

    const [matchesResult, standingsResult, predictionsResult, brainResult] = await Promise.allSettled([
      this.getMatchesToday(),
      this.getStandings(userMessage),
      this.getRecentPredictions(userId),
      this.getBrainSportsInsights(userId)
    ]);

    if (matchesResult.status === "fulfilled" && matchesResult.value) {
      context.matchesToday = matchesResult.value;
    }

    if (standingsResult.status === "fulfilled" && standingsResult.value) {
      context.standings = standingsResult.value;
    }

    if (predictionsResult.status === "fulfilled" && predictionsResult.value) {
      context.recentPredictions = predictionsResult.value;
    }

    if (brainResult.status === "fulfilled" && brainResult.value) {
      context.brainInsights = brainResult.value;
    }

    if (isLiveMatchTime()) {
      context.freshness = "live";
    }

    const elapsed = Date.now() - startTime;
    console.log(`[SportsContext] Built in ${elapsed}ms`);

    return context;
  },

  async getMatchesToday(): Promise<string | null> {
    try {
      const matches = await sportsCacheService.getMatchesWithOdds(new Date());
      
      if (!matches || matches.length === 0) {
        return null;
      }

      const formatted = matches.slice(0, 15).map(m => {
        const time = m.matchTime ? new Date(m.matchTime).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "TBD";
        const odds = m.odds ? ` [1:${m.odds.home?.toFixed(2) || "?"} N:${m.odds.draw?.toFixed(2) || "?"} 2:${m.odds.away?.toFixed(2) || "?"}]` : "";
        return `• ${time} - ${m.homeTeam} vs ${m.awayTeam}${odds}`;
      });

      return `📅 MATCHS DU JOUR (${matches.length}):\n${formatted.join("\n")}`;
    } catch {
      return null;
    }
  },

  async getStandings(userMessage: string): Promise<string | null> {
    try {
      const lower = userMessage.toLowerCase();
      
      let leagueId: number | null = null;
      let leagueName = "";
      
      if (lower.includes("ligue 1") || /om|psg|ol|marseille|paris|lyon|monaco/.test(lower)) {
        leagueId = 61;
        leagueName = "Ligue 1";
      } else if (lower.includes("premier league") || /arsenal|chelsea|liverpool|manchester/.test(lower)) {
        leagueId = 39;
        leagueName = "Premier League";
      } else if (lower.includes("la liga") || /real madrid|barcelona|atletico/.test(lower)) {
        leagueId = 140;
        leagueName = "La Liga";
      } else if (lower.includes("serie a") || /juventus|inter|milan|napoli/.test(lower)) {
        leagueId = 135;
        leagueName = "Serie A";
      } else if (lower.includes("bundesliga") || /bayern|dortmund|leipzig/.test(lower)) {
        leagueId = 78;
        leagueName = "Bundesliga";
      }

      if (!leagueId) return null;

      const standings = await sportsCacheService.getStandings(leagueId);
      if (!standings || standings.length === 0) return null;

      const top10 = standings.slice(0, 10).map((team, i) => 
        `${i + 1}. ${team.teamName} - ${team.points}pts (${team.wins}V ${team.draws}N ${team.losses}D)`
      );

      return `📊 CLASSEMENT ${leagueName} (Top 10):\n${top10.join("\n")}`;
    } catch {
      return null;
    }
  },

  async getRecentPredictions(userId: number): Promise<string | null> {
    try {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      
      const predictions = await db.select()
        .from(sportsPredictionSnapshots)
        .where(gte(sportsPredictionSnapshots.createdAt, weekAgo))
        .orderBy(desc(sportsPredictionSnapshots.createdAt))
        .limit(5);

      if (!predictions || predictions.length === 0) return null;

      const formatted = predictions.map(p => {
        const perf = p.predictionPerformance;
        const result = perf?.mainBetWon === true ? "✅" : perf?.mainBetWon === false ? "❌" : "⏳";
        const rec = p.recommendations;
        const odds = p.oddsSnapshot?.homeOdds?.toFixed(2) || "?";
        return `${result} ${p.homeTeam} vs ${p.awayTeam}: ${rec?.bestBet || "?"} @${odds}`;
      });

      const wins = predictions.filter(p => p.predictionPerformance?.mainBetWon === true).length;
      const total = predictions.filter(p => p.predictionPerformance?.mainBetWon !== undefined).length;
      const rate = total > 0 ? ((wins / total) * 100).toFixed(0) : "?";

      return `📈 DERNIERS PRONOS (${rate}% win rate):\n${formatted.join("\n")}`;
    } catch {
      return null;
    }
  },

  async getBrainSportsInsights(userId: number): Promise<string | null> {
    try {
      const sportsEntries = await db.select()
        .from(knowledgeBase)
        .where(and(
          eq(knowledgeBase.userId, userId),
          sql`${knowledgeBase.category} ILIKE '%sport%' OR ${knowledgeBase.category} ILIKE '%foot%' OR ${knowledgeBase.category} ILIKE '%paris%'`
        ))
        .orderBy(desc(knowledgeBase.confidence))
        .limit(5);

      if (!sportsEntries || sportsEntries.length === 0) return null;

      const insights = sportsEntries
        .filter(e => e.confidence && e.confidence >= 60)
        .map(e => `• [${e.category}] ${e.title}: ${(e.content || "").substring(0, 100)}...`)
        .slice(0, 3);

      if (insights.length === 0) return null;

      return `🧠 INSIGHTS BRAIN:\n${insights.join("\n")}`;
    } catch {
      return null;
    }
  },

  formatContext(ctx: SportsContext): string {
    const parts: string[] = [];
    
    parts.push(`\n═══════════════════════════════════════`);
    parts.push(`⚽ CONTEXTE SPORTS (${ctx.freshness})`);
    parts.push(`═══════════════════════════════════════`);

    if (ctx.matchesToday) {
      parts.push(ctx.matchesToday);
    }

    if (ctx.standings) {
      parts.push("");
      parts.push(ctx.standings);
    }

    if (ctx.recentPredictions) {
      parts.push("");
      parts.push(ctx.recentPredictions);
    }

    if (ctx.brainInsights) {
      parts.push("");
      parts.push(ctx.brainInsights);
    }

    return parts.join("\n");
  },

  clearCache(userId?: number): void {
    if (userId) {
      CONTEXT_CACHE.delete(`sports_${userId}`);
    } else {
      CONTEXT_CACHE.clear();
    }
  },

  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: CONTEXT_CACHE.size,
      keys: Array.from(CONTEXT_CACHE.keys())
    };
  }
};
