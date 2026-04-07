import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import {
  footdatasApiStandings, footdatasApiSquads, footdatasApiTeamStats, footdatasApiTeamMap,
} from "@shared/schema";
import { apiFootballService, APIFootballService } from "./apiFootballService";

const STANDINGS_TTL_HOURS = 6;
const SQUAD_TTL_HOURS = 24;
const STATS_TTL_HOURS = 12;
const HISTORICAL_SEASON_TTL_HOURS = 168; // 7 days for past seasons

function isStale(fetchedAt: Date | null, ttlHours: number): boolean {
  if (!fetchedAt) return true;
  const age = Date.now() - fetchedAt.getTime();
  return age > ttlHours * 60 * 60 * 1000;
}

function getTTL(season: number, baseTTL: number): number {
  const current = APIFootballService.getCurrentFootballSeason();
  return season < current ? HISTORICAL_SEASON_TTL_HOURS : baseTTL;
}

class FootballCacheService {
  private static instance: FootballCacheService;

  private constructor() {
    console.log('[FOOTBALL-CACHE] Service initialized - DB-first, API-fallback strategy');
  }

  static getInstance(): FootballCacheService {
    if (!FootballCacheService.instance) {
      FootballCacheService.instance = new FootballCacheService();
    }
    return FootballCacheService.instance;
  }

  async getStandings(leagueId: number, season: number): Promise<any[]> {
    const cached = await db.select().from(footdatasApiStandings)
      .where(and(
        eq(footdatasApiStandings.apiLeagueId, leagueId),
        eq(footdatasApiStandings.season, season)
      ))
      .orderBy(footdatasApiStandings.rank);

    if (cached.length > 0 && !isStale(cached[0].fetchedAt, getTTL(season, STANDINGS_TTL_HOURS))) {
      console.log(`[FOOTBALL-CACHE] DB HIT standings league=${leagueId} season=${season} (${cached.length} teams)`);
      return cached.map(s => ({
        rank: s.rank,
        team: { id: s.apiTeamId, name: s.teamName, logo: s.teamLogo },
        points: s.points,
        goalsDiff: s.goalsDiff,
        all: {
          played: s.played,
          win: s.win,
          draw: s.draw,
          lose: s.lose,
          goals: { for: s.goalsFor, against: s.goalsAgainst },
        },
      }));
    }

    console.log(`[FOOTBALL-CACHE] DB MISS standings league=${leagueId} season=${season}, fetching from API...`);
    try {
      const apiStandings = await apiFootballService.getLeagueStandings(leagueId, season);
      if (apiStandings.length > 0) {
        await this.saveStandings(leagueId, season, apiStandings);
        console.log(`[FOOTBALL-CACHE] Saved ${apiStandings.length} standings to DB`);
      }
      return apiStandings;
    } catch (error: any) {
      if (cached.length > 0) {
        console.log(`[FOOTBALL-CACHE] API failed, returning stale DB data for league=${leagueId}`);
        return cached.map(s => ({
          rank: s.rank,
          team: { id: s.apiTeamId, name: s.teamName, logo: s.teamLogo },
          points: s.points,
          goalsDiff: s.goalsDiff,
          all: {
            played: s.played,
            win: s.win,
            draw: s.draw,
            lose: s.lose,
            goals: { for: s.goalsFor, against: s.goalsAgainst },
          },
        }));
      }
      throw error;
    }
  }

  private async saveStandings(leagueId: number, season: number, standings: any[]): Promise<void> {
    const now = new Date();
    await db.delete(footdatasApiStandings)
      .where(and(
        eq(footdatasApiStandings.apiLeagueId, leagueId),
        eq(footdatasApiStandings.season, season)
      ));

    const rows = standings.map(s => ({
      apiLeagueId: leagueId,
      season,
      apiTeamId: s.team.id,
      teamName: s.team.name,
      teamLogo: s.team.logo || null,
      rank: s.rank,
      points: s.points,
      goalsDiff: s.goalsDiff,
      played: s.all.played,
      win: s.all.win,
      draw: s.all.draw,
      lose: s.all.lose,
      goalsFor: s.all.goals.for,
      goalsAgainst: s.all.goals.against,
      fetchedAt: now,
    }));

    if (rows.length > 0) {
      await db.insert(footdatasApiStandings).values(rows);
    }

    for (const s of standings) {
      await this.ensureTeamMapped(s.team.id, s.team.name, s.team.logo, leagueId);
    }
  }

  async getTeamSquad(teamId: number, season?: number): Promise<any | null> {
    const s = season || APIFootballService.getCurrentFootballSeason();

    const [cached] = await db.select().from(footdatasApiSquads)
      .where(and(
        eq(footdatasApiSquads.apiTeamId, teamId),
        eq(footdatasApiSquads.season, s)
      ))
      .orderBy(desc(footdatasApiSquads.fetchedAt))
      .limit(1);

    if (cached && !isStale(cached.fetchedAt, getTTL(s, SQUAD_TTL_HOURS))) {
      console.log(`[FOOTBALL-CACHE] DB HIT squad team=${teamId} season=${s}`);
      return cached.squadData;
    }

    console.log(`[FOOTBALL-CACHE] DB MISS squad team=${teamId} season=${s}, fetching from API...`);
    try {
      const squad = await apiFootballService.getTeamSquad(teamId);
      if (squad) {
        await this.saveSquad(teamId, s, squad);
        console.log(`[FOOTBALL-CACHE] Saved squad for team=${teamId} to DB`);
      }
      return squad;
    } catch (error: any) {
      if (cached) {
        console.log(`[FOOTBALL-CACHE] API failed, returning stale squad for team=${teamId}`);
        return cached.squadData;
      }
      throw error;
    }
  }

  private async saveSquad(teamId: number, season: number, squad: any): Promise<void> {
    const existing = await db.select().from(footdatasApiSquads)
      .where(and(
        eq(footdatasApiSquads.apiTeamId, teamId),
        eq(footdatasApiSquads.season, season)
      ))
      .limit(1);

    if (existing.length > 0) {
      await db.update(footdatasApiSquads)
        .set({ squadData: squad, fetchedAt: new Date(), updatedAt: new Date() })
        .where(eq(footdatasApiSquads.id, existing[0].id));
    } else {
      await db.insert(footdatasApiSquads).values({
        apiTeamId: teamId,
        season,
        squadData: squad,
        fetchedAt: new Date(),
      });
    }
  }

  async getTeamStats(teamId: number, lastN: number = 10, season?: number): Promise<any | null> {
    const s = season || APIFootballService.getCurrentFootballSeason();

    const [cached] = await db.select().from(footdatasApiTeamStats)
      .where(and(
        eq(footdatasApiTeamStats.apiTeamId, teamId),
        eq(footdatasApiTeamStats.season, s)
      ))
      .orderBy(desc(footdatasApiTeamStats.fetchedAt))
      .limit(1);

    if (cached && !isStale(cached.fetchedAt, getTTL(s, STATS_TTL_HOURS))) {
      console.log(`[FOOTBALL-CACHE] DB HIT stats team=${teamId} season=${s}`);
      return cached.statsData;
    }

    console.log(`[FOOTBALL-CACHE] DB MISS stats team=${teamId} season=${s}, fetching from API...`);
    try {
      const stats = await apiFootballService.getTeamStats(teamId, lastN);
      if (stats) {
        await this.saveTeamStats(teamId, s, stats);
        console.log(`[FOOTBALL-CACHE] Saved stats for team=${teamId} to DB`);
      }
      return stats;
    } catch (error: any) {
      if (cached) {
        console.log(`[FOOTBALL-CACHE] API failed, returning stale stats for team=${teamId}`);
        return cached.statsData;
      }
      throw error;
    }
  }

  private async saveTeamStats(teamId: number, season: number, stats: any): Promise<void> {
    const existing = await db.select().from(footdatasApiTeamStats)
      .where(and(
        eq(footdatasApiTeamStats.apiTeamId, teamId),
        eq(footdatasApiTeamStats.season, season)
      ))
      .limit(1);

    if (existing.length > 0) {
      await db.update(footdatasApiTeamStats)
        .set({ statsData: stats, fetchedAt: new Date(), updatedAt: new Date() })
        .where(eq(footdatasApiTeamStats.id, existing[0].id));
    } else {
      await db.insert(footdatasApiTeamStats).values({
        apiTeamId: teamId,
        season,
        statsData: stats,
        fetchedAt: new Date(),
      });
    }
  }

  private async ensureTeamMapped(apiTeamId: number, teamName: string, teamLogo: string | null, leagueId?: number): Promise<void> {
    const [existing] = await db.select().from(footdatasApiTeamMap)
      .where(eq(footdatasApiTeamMap.apiTeamId, apiTeamId))
      .limit(1);

    if (existing) {
      if (existing.teamName !== teamName || existing.teamLogo !== teamLogo) {
        await db.update(footdatasApiTeamMap)
          .set({ teamName, teamLogo, updatedAt: new Date() })
          .where(eq(footdatasApiTeamMap.id, existing.id));
      }
      return;
    }

    await db.insert(footdatasApiTeamMap).values({
      apiTeamId,
      teamName,
      teamLogo: teamLogo || null,
      apiLeagueId: leagueId || null,
    });
  }

  // ========================================
  // ULYSSE CONSULTATION METHODS
  // ========================================

  async getDbStats(): Promise<{ standings: number; squads: number; stats: number; teams: number; seasons: number[] }> {
    const [standingsCount] = await db.select({ count: db.$count(footdatasApiStandings) }).from(footdatasApiStandings);
    const [squadsCount] = await db.select({ count: db.$count(footdatasApiSquads) }).from(footdatasApiSquads);
    const [statsCount] = await db.select({ count: db.$count(footdatasApiTeamStats) }).from(footdatasApiTeamStats);
    const [teamsCount] = await db.select({ count: db.$count(footdatasApiTeamMap) }).from(footdatasApiTeamMap);

    const seasonRows = await db.selectDistinct({ season: footdatasApiStandings.season }).from(footdatasApiStandings);
    const seasons = seasonRows.map(r => r.season).sort((a, b) => b - a);

    return {
      standings: Number(standingsCount.count),
      squads: Number(squadsCount.count),
      stats: Number(statsCount.count),
      teams: Number(teamsCount.count),
      seasons,
    };
  }

  async searchTeamInDb(query: string): Promise<any[]> {
    const results = await db.select().from(footdatasApiTeamMap)
      .where(eq(footdatasApiTeamMap.teamName, query))
      .limit(10);

    if (results.length > 0) return results;

    const allTeams = await db.select().from(footdatasApiTeamMap);
    const q = query.toLowerCase();
    return allTeams.filter(t => t.teamName.toLowerCase().includes(q)).slice(0, 10);
  }

  async getTeamHistoryFromDb(apiTeamId: number): Promise<{
    team: any;
    standingsByseason: any[];
    stats: any[];
  }> {
    const [team] = await db.select().from(footdatasApiTeamMap)
      .where(eq(footdatasApiTeamMap.apiTeamId, apiTeamId));

    const standings = await db.select().from(footdatasApiStandings)
      .where(eq(footdatasApiStandings.apiTeamId, apiTeamId))
      .orderBy(desc(footdatasApiStandings.season));

    const stats = await db.select().from(footdatasApiTeamStats)
      .where(eq(footdatasApiTeamStats.apiTeamId, apiTeamId))
      .orderBy(desc(footdatasApiTeamStats.season));

    return {
      team: team || null,
      standingsByseason: standings.map(s => ({
        season: `${s.season}/${s.season + 1}`,
        rank: s.rank,
        points: s.points,
        played: s.played,
        win: s.win,
        draw: s.draw,
        lose: s.lose,
        goalsFor: s.goalsFor,
        goalsAgainst: s.goalsAgainst,
        goalsDiff: s.goalsDiff,
      })),
      stats: stats.map(s => ({
        season: `${s.season}/${s.season + 1}`,
        data: s.statsData,
      })),
    };
  }

  async getLeagueHistoryFromDb(leagueId: number): Promise<any[]> {
    const standings = await db.select().from(footdatasApiStandings)
      .where(eq(footdatasApiStandings.apiLeagueId, leagueId))
      .orderBy(desc(footdatasApiStandings.season), footdatasApiStandings.rank);

    const bySeason: Record<number, any[]> = {};
    for (const s of standings) {
      if (!bySeason[s.season]) bySeason[s.season] = [];
      bySeason[s.season].push({
        rank: s.rank,
        team: s.teamName,
        points: s.points,
        played: s.played,
        win: s.win,
        draw: s.draw,
        lose: s.lose,
        goalsFor: s.goalsFor,
        goalsAgainst: s.goalsAgainst,
      });
    }

    return Object.entries(bySeason)
      .sort((a, b) => Number(b[0]) - Number(a[0]))
      .map(([season, teams]) => ({
        season: `${season}/${Number(season) + 1}`,
        standings: teams,
      }));
  }

  async getAllCachedLeagues(): Promise<{ apiLeagueId: number; seasons: number[]; teamCount: number }[]> {
    const data = await db.select({
      apiLeagueId: footdatasApiStandings.apiLeagueId,
      season: footdatasApiStandings.season,
    }).from(footdatasApiStandings);

    const map: Record<number, Set<number>> = {};
    const teamCounts: Record<number, Set<number>> = {};

    for (const row of data) {
      if (!map[row.apiLeagueId]) map[row.apiLeagueId] = new Set();
      map[row.apiLeagueId].add(row.season);
    }

    const standingsAll = await db.select({
      apiLeagueId: footdatasApiStandings.apiLeagueId,
      apiTeamId: footdatasApiStandings.apiTeamId,
    }).from(footdatasApiStandings);

    for (const row of standingsAll) {
      if (!teamCounts[row.apiLeagueId]) teamCounts[row.apiLeagueId] = new Set();
      teamCounts[row.apiLeagueId].add(row.apiTeamId);
    }

    return Object.entries(map).map(([id, seasons]) => ({
      apiLeagueId: Number(id),
      seasons: Array.from(seasons).sort((a, b) => b - a),
      teamCount: teamCounts[Number(id)]?.size || 0,
    }));
  }
}

export const footballCacheService = FootballCacheService.getInstance();
