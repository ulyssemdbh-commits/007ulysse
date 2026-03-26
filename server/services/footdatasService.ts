import { db } from "../db";
import { eq, and, desc, like, sql, inArray } from "drizzle-orm";
import {
  footdatasLeagues, footdatasClubs, footdatasOrganigramme, footdatasStaff,
  footdatasPlayers, footdatasPlayerStats, footdatasClubStats, footdatasTransfers,
  footdatasNews, footdatasRankings, footdatasHistory, footdatasTrophies, footdatasMatches,
  InsertFootdatasLeague, InsertFootdatasClub, InsertFootdatasOrganigramme,
  InsertFootdatasStaff, InsertFootdatasPlayer, InsertFootdatasPlayerStats,
  InsertFootdatasClubStats, InsertFootdatasTransfer, InsertFootdatasNews,
  InsertFootdatasRanking, InsertFootdatasHistory, InsertFootdatasTrophy, InsertFootdatasMatch,
  FootdatasLeague, FootdatasClub, FootdatasPlayer, FootdatasMatch
} from "@shared/schema";

type FootdatasOrganigramme = typeof footdatasOrganigramme.$inferSelect;
type FootdatasStaff = typeof footdatasStaff.$inferSelect;
type FootdatasPlayerStats = typeof footdatasPlayerStats.$inferSelect;
type FootdatasClubStats = typeof footdatasClubStats.$inferSelect;
type FootdatasTransfer = typeof footdatasTransfers.$inferSelect;
type FootdatasNews = typeof footdatasNews.$inferSelect;
type FootdatasRanking = typeof footdatasRankings.$inferSelect;
type FootdatasHistory = typeof footdatasHistory.$inferSelect;
type FootdatasTrophy = typeof footdatasTrophies.$inferSelect;

export interface ClubDataFile {
  club: FootdatasClub;
  league: FootdatasLeague | null;
  organigramme: FootdatasOrganigramme[];
  staff: FootdatasStaff[];
  players: FootdatasPlayer[];
  playerStats: FootdatasPlayerStats[];
  clubStats: FootdatasClubStats[];
  transfers: FootdatasTransfer[];
  news: FootdatasNews[];
  rankings: FootdatasRanking[];
  history: FootdatasHistory[];
  trophies: FootdatasTrophy[];
}

export interface InjectionResult {
  success: number;
  failed: number;
  skipped: number;
  errors: string[];
}

class FootdatasService {
  private static instance: FootdatasService;
  
  private constructor() {
    console.log('[FOOTDATAS] Service initialized');
  }
  
  static getInstance(): FootdatasService {
    if (!FootdatasService.instance) {
      FootdatasService.instance = new FootdatasService();
    }
    return FootdatasService.instance;
  }

  // ========================================
  // LEAGUES OPERATIONS
  // ========================================
  
  async createLeague(data: InsertFootdatasLeague): Promise<FootdatasLeague> {
    const [league] = await db.insert(footdatasLeagues).values(data).returning();
    console.log(`[FOOTDATAS] Created league: ${data.name}`);
    return league;
  }
  
  async getLeagues(): Promise<FootdatasLeague[]> {
    return db.select().from(footdatasLeagues).orderBy(footdatasLeagues.name);
  }
  
  async getLeagueByCode(code: string): Promise<FootdatasLeague | null> {
    const [league] = await db.select().from(footdatasLeagues)
      .where(eq(footdatasLeagues.code, code));
    return league || null;
  }
  
  async getLeagueByName(name: string): Promise<FootdatasLeague | null> {
    const [league] = await db.select().from(footdatasLeagues)
      .where(eq(footdatasLeagues.name, name));
    return league || null;
  }

  // ========================================
  // CLUBS OPERATIONS
  // ========================================
  
  async createClub(data: InsertFootdatasClub): Promise<FootdatasClub> {
    const [club] = await db.insert(footdatasClubs).values(data).returning();
    console.log(`[FOOTDATAS] Created club: ${data.name} (${data.dataFileName})`);
    return club;
  }
  
  async getClubById(id: number): Promise<FootdatasClub | null> {
    const [club] = await db.select().from(footdatasClubs)
      .where(eq(footdatasClubs.id, id));
    return club || null;
  }
  
  async getClubByName(name: string): Promise<FootdatasClub | null> {
    const [club] = await db.select().from(footdatasClubs)
      .where(eq(footdatasClubs.name, name));
    return club || null;
  }
  
  async getClubByShortName(shortName: string): Promise<FootdatasClub | null> {
    const [club] = await db.select().from(footdatasClubs)
      .where(eq(footdatasClubs.shortName, shortName.toUpperCase()));
    return club || null;
  }
  
  async getClubByDataFileName(dataFileName: string): Promise<FootdatasClub | null> {
    const [club] = await db.select().from(footdatasClubs)
      .where(eq(footdatasClubs.dataFileName, dataFileName));
    return club || null;
  }
  
  async getClubsByLeague(leagueId: number): Promise<FootdatasClub[]> {
    return db.select().from(footdatasClubs)
      .where(eq(footdatasClubs.leagueId, leagueId))
      .orderBy(footdatasClubs.name);
  }
  
  async getAllClubs(): Promise<FootdatasClub[]> {
    return db.select().from(footdatasClubs).orderBy(footdatasClubs.name);
  }
  
  async updateClub(id: number, data: Partial<InsertFootdatasClub>): Promise<FootdatasClub | null> {
    const [club] = await db.update(footdatasClubs)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(footdatasClubs.id, id))
      .returning();
    return club || null;
  }
  
  async searchClubs(query: string): Promise<FootdatasClub[]> {
    const searchTerm = `%${query.toLowerCase()}%`;
    return db.select().from(footdatasClubs)
      .where(sql`LOWER(${footdatasClubs.name}) LIKE ${searchTerm} OR LOWER(${footdatasClubs.shortName}) LIKE ${searchTerm}`)
      .orderBy(footdatasClubs.name)
      .limit(20);
  }

  // ========================================
  // COMPLETE CLUB DATA FILE (OMDatas, RealMadridDatas, etc.)
  // ========================================
  
  async getClubDataFile(clubId: number): Promise<ClubDataFile | null> {
    const club = await this.getClubById(clubId);
    if (!club) return null;
    
    const [league] = await db.select().from(footdatasLeagues)
      .where(eq(footdatasLeagues.id, club.leagueId));
    
    const [organigramme, staff, players, clubStats, transfers, news, rankings, history, trophies] = await Promise.all([
      db.select().from(footdatasOrganigramme).where(eq(footdatasOrganigramme.clubId, clubId)),
      db.select().from(footdatasStaff).where(eq(footdatasStaff.clubId, clubId)),
      db.select().from(footdatasPlayers).where(eq(footdatasPlayers.clubId, clubId)),
      db.select().from(footdatasClubStats).where(eq(footdatasClubStats.clubId, clubId)).orderBy(desc(footdatasClubStats.season)),
      db.select().from(footdatasTransfers).where(eq(footdatasTransfers.clubId, clubId)).orderBy(desc(footdatasTransfers.transferDate)),
      db.select().from(footdatasNews).where(eq(footdatasNews.clubId, clubId)).orderBy(desc(footdatasNews.publishedAt)).limit(50),
      db.select().from(footdatasRankings).where(eq(footdatasRankings.clubId, clubId)).orderBy(desc(footdatasRankings.recordedAt)),
      db.select().from(footdatasHistory).where(eq(footdatasHistory.clubId, clubId)).orderBy(desc(footdatasHistory.eventDate)),
      db.select().from(footdatasTrophies).where(eq(footdatasTrophies.clubId, clubId)).orderBy(desc(footdatasTrophies.season)),
    ]);
    
    const playerIds = players.map(p => p.id);
    const playerStats = playerIds.length > 0 
      ? await db.select().from(footdatasPlayerStats).where(inArray(footdatasPlayerStats.playerId, playerIds))
      : [];
    
    return {
      club,
      league: league || null,
      organigramme,
      staff,
      players,
      playerStats,
      clubStats,
      transfers,
      news,
      rankings,
      history,
      trophies,
    };
  }
  
  async getClubDataFileByName(dataFileName: string): Promise<ClubDataFile | null> {
    const club = await this.getClubByDataFileName(dataFileName);
    if (!club) return null;
    return this.getClubDataFile(club.id);
  }

  // ========================================
  // ORGANIGRAMME OPERATIONS
  // ========================================
  
  async addOrganigrammeEntry(data: InsertFootdatasOrganigramme): Promise<FootdatasOrganigramme> {
    const [entry] = await db.insert(footdatasOrganigramme).values(data).returning();
    console.log(`[FOOTDATAS] Added organigramme entry: ${data.personName} (${data.role})`);
    return entry;
  }
  
  async getOrganigramme(clubId: number): Promise<FootdatasOrganigramme[]> {
    return db.select().from(footdatasOrganigramme)
      .where(eq(footdatasOrganigramme.clubId, clubId))
      .orderBy(footdatasOrganigramme.category);
  }

  // ========================================
  // STAFF OPERATIONS
  // ========================================
  
  async addStaff(data: InsertFootdatasStaff): Promise<FootdatasStaff> {
    const [staff] = await db.insert(footdatasStaff).values(data).returning();
    console.log(`[FOOTDATAS] Added staff: ${data.name} (${data.role})`);
    return staff;
  }
  
  async getStaff(clubId: number): Promise<FootdatasStaff[]> {
    return db.select().from(footdatasStaff)
      .where(eq(footdatasStaff.clubId, clubId))
      .orderBy(footdatasStaff.role);
  }
  
  async getCurrentCoach(clubId: number): Promise<FootdatasStaff | null> {
    const [coach] = await db.select().from(footdatasStaff)
      .where(and(
        eq(footdatasStaff.clubId, clubId),
        eq(footdatasStaff.role, 'head_coach'),
        sql`${footdatasStaff.endDate} IS NULL`
      ));
    return coach || null;
  }

  // ========================================
  // PLAYERS OPERATIONS
  // ========================================
  
  async addPlayer(data: InsertFootdatasPlayer): Promise<FootdatasPlayer> {
    const [player] = await db.insert(footdatasPlayers).values(data).returning();
    console.log(`[FOOTDATAS] Added player: ${data.name} (#${data.shirtNumber})`);
    return player;
  }
  
  async getPlayers(clubId: number): Promise<FootdatasPlayer[]> {
    return db.select().from(footdatasPlayers)
      .where(eq(footdatasPlayers.clubId, clubId))
      .orderBy(footdatasPlayers.shirtNumber);
  }
  
  async getPlayerById(playerId: number): Promise<FootdatasPlayer | null> {
    const [player] = await db.select().from(footdatasPlayers)
      .where(eq(footdatasPlayers.id, playerId));
    return player || null;
  }
  
  async getPlayerByName(clubId: number, name: string): Promise<FootdatasPlayer | null> {
    const searchTerm = `%${name.toLowerCase()}%`;
    const [player] = await db.select().from(footdatasPlayers)
      .where(and(
        eq(footdatasPlayers.clubId, clubId),
        sql`LOWER(${footdatasPlayers.name}) LIKE ${searchTerm}`
      ));
    return player || null;
  }
  
  async updatePlayer(playerId: number, data: Partial<InsertFootdatasPlayer>): Promise<FootdatasPlayer | null> {
    const [player] = await db.update(footdatasPlayers)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(footdatasPlayers.id, playerId))
      .returning();
    return player || null;
  }
  
  async getPlayersByPosition(clubId: number, position: string): Promise<FootdatasPlayer[]> {
    return db.select().from(footdatasPlayers)
      .where(and(
        eq(footdatasPlayers.clubId, clubId),
        eq(footdatasPlayers.position, position)
      ))
      .orderBy(footdatasPlayers.shirtNumber);
  }

  // ========================================
  // PLAYER STATS OPERATIONS
  // ========================================
  
  async addPlayerStats(data: InsertFootdatasPlayerStats): Promise<FootdatasPlayerStats> {
    const [stats] = await db.insert(footdatasPlayerStats).values(data).returning();
    console.log(`[FOOTDATAS] Added player stats for player ${data.playerId} (${data.season})`);
    return stats;
  }
  
  async getPlayerStats(playerId: number, season?: string): Promise<FootdatasPlayerStats[]> {
    if (season) {
      return db.select().from(footdatasPlayerStats)
        .where(and(
          eq(footdatasPlayerStats.playerId, playerId),
          eq(footdatasPlayerStats.season, season)
        ));
    }
    return db.select().from(footdatasPlayerStats)
      .where(eq(footdatasPlayerStats.playerId, playerId))
      .orderBy(desc(footdatasPlayerStats.season));
  }
  
  async upsertPlayerStats(data: InsertFootdatasPlayerStats): Promise<FootdatasPlayerStats> {
    const [existing] = await db.select().from(footdatasPlayerStats)
      .where(and(
        eq(footdatasPlayerStats.playerId, data.playerId),
        eq(footdatasPlayerStats.season, data.season),
        eq(footdatasPlayerStats.competition, data.competition)
      ));
    
    if (existing) {
      const [updated] = await db.update(footdatasPlayerStats)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(footdatasPlayerStats.id, existing.id))
        .returning();
      return updated;
    }
    
    return this.addPlayerStats(data);
  }
  
  async updatePlayerStats(statsId: number, data: Partial<InsertFootdatasPlayerStats>): Promise<FootdatasPlayerStats> {
    const [stats] = await db.update(footdatasPlayerStats)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(footdatasPlayerStats.id, statsId))
      .returning();
    return stats;
  }

  // ========================================
  // CLUB STATS OPERATIONS
  // ========================================
  
  async addClubStats(data: InsertFootdatasClubStats): Promise<FootdatasClubStats> {
    const [stats] = await db.insert(footdatasClubStats).values(data).returning();
    console.log(`[FOOTDATAS] Added club stats for club ${data.clubId} (${data.season})`);
    return stats;
  }
  
  async getClubStats(clubId: number, season?: string): Promise<FootdatasClubStats[]> {
    if (season) {
      return db.select().from(footdatasClubStats)
        .where(and(
          eq(footdatasClubStats.clubId, clubId),
          eq(footdatasClubStats.season, season)
        ));
    }
    return db.select().from(footdatasClubStats)
      .where(eq(footdatasClubStats.clubId, clubId))
      .orderBy(desc(footdatasClubStats.season));
  }
  
  async upsertClubStats(data: InsertFootdatasClubStats): Promise<FootdatasClubStats> {
    const [existing] = await db.select().from(footdatasClubStats)
      .where(and(
        eq(footdatasClubStats.clubId, data.clubId),
        eq(footdatasClubStats.season, data.season),
        eq(footdatasClubStats.competition, data.competition)
      ));
    
    if (existing) {
      const [updated] = await db.update(footdatasClubStats)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(footdatasClubStats.id, existing.id))
        .returning();
      return updated;
    }
    
    return this.addClubStats(data);
  }
  
  async updateClubStats(statsId: number, data: Partial<InsertFootdatasClubStats>): Promise<FootdatasClubStats> {
    const [stats] = await db.update(footdatasClubStats)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(footdatasClubStats.id, statsId))
      .returning();
    return stats;
  }

  // ========================================
  // TRANSFERS OPERATIONS (with upsert/anti-doublon)
  // ========================================
  
  async addTransfer(data: InsertFootdatasTransfer): Promise<FootdatasTransfer> {
    const [transfer] = await db.insert(footdatasTransfers).values(data).returning();
    console.log(`[FOOTDATAS] Added transfer: ${data.playerName} (${data.transferType})`);
    return transfer;
  }
  
  async upsertTransfer(data: InsertFootdatasTransfer): Promise<{ transfer: FootdatasTransfer; isNew: boolean }> {
    const dateStr = data.transferDate ? new Date(data.transferDate).toISOString().split('T')[0] : null;
    
    const [existing] = await db.select().from(footdatasTransfers)
      .where(and(
        eq(footdatasTransfers.clubId, data.clubId),
        sql`LOWER(${footdatasTransfers.playerName}) = LOWER(${data.playerName})`,
        eq(footdatasTransfers.transferType, data.transferType),
        dateStr ? sql`DATE(${footdatasTransfers.transferDate}) = ${dateStr}` : sql`${footdatasTransfers.transferDate} IS NULL`
      ));
    
    if (existing) {
      return { transfer: existing, isNew: false };
    }
    
    const transfer = await this.addTransfer(data);
    return { transfer, isNew: true };
  }
  
  async getTransfers(clubId: number, window?: string): Promise<FootdatasTransfer[]> {
    if (window) {
      return db.select().from(footdatasTransfers)
        .where(and(
          eq(footdatasTransfers.clubId, clubId),
          eq(footdatasTransfers.transferWindow, window)
        ))
        .orderBy(desc(footdatasTransfers.transferDate));
    }
    return db.select().from(footdatasTransfers)
      .where(eq(footdatasTransfers.clubId, clubId))
      .orderBy(desc(footdatasTransfers.transferDate));
  }
  
  async getRecentTransfers(clubId: number, limit: number = 10): Promise<FootdatasTransfer[]> {
    return db.select().from(footdatasTransfers)
      .where(eq(footdatasTransfers.clubId, clubId))
      .orderBy(desc(footdatasTransfers.transferDate))
      .limit(limit);
  }

  // ========================================
  // NEWS OPERATIONS (with upsert/anti-doublon)
  // ========================================
  
  async addNews(data: InsertFootdatasNews): Promise<FootdatasNews> {
    const [news] = await db.insert(footdatasNews).values(data).returning();
    console.log(`[FOOTDATAS] Added news: ${data.title.substring(0, 50)}...`);
    return news;
  }
  
  async upsertNews(data: InsertFootdatasNews): Promise<{ news: FootdatasNews; isNew: boolean }> {
    const [existing] = await db.select().from(footdatasNews)
      .where(and(
        eq(footdatasNews.clubId, data.clubId),
        sql`LOWER(${footdatasNews.title}) = LOWER(${data.title})`,
        data.sourceUrl 
          ? eq(footdatasNews.sourceUrl, data.sourceUrl) 
          : sql`${footdatasNews.sourceUrl} IS NULL`
      ));
    
    if (existing) {
      return { news: existing, isNew: false };
    }
    
    const news = await this.addNews(data);
    return { news, isNew: true };
  }
  
  async getNews(clubId: number, limit: number = 20): Promise<FootdatasNews[]> {
    return db.select().from(footdatasNews)
      .where(eq(footdatasNews.clubId, clubId))
      .orderBy(desc(footdatasNews.publishedAt))
      .limit(limit);
  }
  
  async getNewsByCategory(clubId: number, category: string, limit: number = 10): Promise<FootdatasNews[]> {
    return db.select().from(footdatasNews)
      .where(and(
        eq(footdatasNews.clubId, clubId),
        eq(footdatasNews.category, category)
      ))
      .orderBy(desc(footdatasNews.publishedAt))
      .limit(limit);
  }

  // ========================================
  // RANKINGS OPERATIONS (with upsert/anti-doublon)
  // ========================================
  
  async addRanking(data: InsertFootdatasRanking): Promise<FootdatasRanking> {
    const [ranking] = await db.insert(footdatasRankings).values(data).returning();
    console.log(`[FOOTDATAS] Added ranking: Club ${data.clubId} at position ${data.position} (${data.season})`);
    return ranking;
  }
  
  async upsertRanking(data: InsertFootdatasRanking): Promise<{ ranking: FootdatasRanking; isNew: boolean }> {
    const dateStr = data.recordedAt ? new Date(data.recordedAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    
    const [existing] = await db.select().from(footdatasRankings)
      .where(and(
        eq(footdatasRankings.clubId, data.clubId),
        eq(footdatasRankings.season, data.season),
        eq(footdatasRankings.competition, data.competition),
        sql`DATE(${footdatasRankings.recordedAt}) = ${dateStr}`
      ));
    
    if (existing) {
      if (existing.position !== data.position || existing.points !== data.points) {
        const [updated] = await db.update(footdatasRankings)
          .set({ position: data.position, points: data.points, goalsFor: data.goalsFor, goalsAgainst: data.goalsAgainst })
          .where(eq(footdatasRankings.id, existing.id))
          .returning();
        return { ranking: updated, isNew: false };
      }
      return { ranking: existing, isNew: false };
    }
    
    const ranking = await this.addRanking(data);
    return { ranking, isNew: true };
  }
  
  async getRankings(clubId: number, season?: string): Promise<FootdatasRanking[]> {
    if (season) {
      return db.select().from(footdatasRankings)
        .where(and(
          eq(footdatasRankings.clubId, clubId),
          eq(footdatasRankings.season, season)
        ))
        .orderBy(desc(footdatasRankings.recordedAt));
    }
    return db.select().from(footdatasRankings)
      .where(eq(footdatasRankings.clubId, clubId))
      .orderBy(desc(footdatasRankings.recordedAt));
  }
  
  async getLatestRanking(clubId: number, competition: string): Promise<FootdatasRanking | null> {
    const [ranking] = await db.select().from(footdatasRankings)
      .where(and(
        eq(footdatasRankings.clubId, clubId),
        eq(footdatasRankings.competition, competition)
      ))
      .orderBy(desc(footdatasRankings.recordedAt))
      .limit(1);
    return ranking || null;
  }

  // ========================================
  // HISTORY OPERATIONS
  // ========================================
  
  async addHistoryEvent(data: InsertFootdatasHistory): Promise<FootdatasHistory> {
    const [event] = await db.insert(footdatasHistory).values(data).returning();
    console.log(`[FOOTDATAS] Added history event: ${data.title}`);
    return event;
  }
  
  async getHistory(clubId: number): Promise<FootdatasHistory[]> {
    return db.select().from(footdatasHistory)
      .where(eq(footdatasHistory.clubId, clubId))
      .orderBy(desc(footdatasHistory.eventDate));
  }
  
  async getHistoryByType(clubId: number, eventType: string): Promise<FootdatasHistory[]> {
    return db.select().from(footdatasHistory)
      .where(and(
        eq(footdatasHistory.clubId, clubId),
        eq(footdatasHistory.eventType, eventType)
      ))
      .orderBy(desc(footdatasHistory.eventDate));
  }

  // ========================================
  // TROPHIES OPERATIONS
  // ========================================
  
  async addTrophy(data: InsertFootdatasTrophy): Promise<FootdatasTrophy> {
    const [trophy] = await db.insert(footdatasTrophies).values(data).returning();
    console.log(`[FOOTDATAS] Added trophy: ${data.competition} (${data.season})`);
    return trophy;
  }
  
  async getTrophies(clubId: number): Promise<FootdatasTrophy[]> {
    return db.select().from(footdatasTrophies)
      .where(eq(footdatasTrophies.clubId, clubId))
      .orderBy(desc(footdatasTrophies.season));
  }
  
  async getTrophyCount(clubId: number): Promise<{ competition: string; count: number }[]> {
    const trophies = await db.select().from(footdatasTrophies)
      .where(and(
        eq(footdatasTrophies.clubId, clubId),
        eq(footdatasTrophies.result, 'winner')
      ));
    
    const counts: Record<string, number> = {};
    for (const t of trophies) {
      counts[t.competition] = (counts[t.competition] || 0) + 1;
    }
    
    return Object.entries(counts).map(([competition, count]) => ({ competition, count }));
  }

  // ========================================
  // INITIALIZATION - Big 5 European Leagues
  // ========================================
  
  async initializeBig5Leagues(): Promise<void> {
    const leagues = [
      { name: 'Ligue 1', country: 'France', code: 'L1' },
      { name: 'LaLiga', country: 'Spain', code: 'LL' },
      { name: 'Premier League', country: 'England', code: 'PL' },
      { name: 'Bundesliga', country: 'Germany', code: 'BL' },
      { name: 'Serie A', country: 'Italy', code: 'SA' },
    ];
    
    for (const league of leagues) {
      const existing = await this.getLeagueByCode(league.code);
      if (!existing) {
        await this.createLeague(league);
      }
    }
    
    console.log('[FOOTDATAS] Big 5 European leagues initialized');
  }

  // ========================================
  // BULK OPERATIONS FOR ULYSSE AUTOMATION
  // ========================================
  
  async upsertClub(data: InsertFootdatasClub): Promise<FootdatasClub> {
    const existing = await this.getClubByDataFileName(data.dataFileName);
    if (existing) {
      const updated = await this.updateClub(existing.id, data);
      return updated || existing;
    }
    return this.createClub(data);
  }
  
  async upsertPlayer(clubId: number, data: InsertFootdatasPlayer): Promise<FootdatasPlayer> {
    const existing = await this.getPlayerByName(clubId, data.name);
    if (existing) {
      const updated = await this.updatePlayer(existing.id, data);
      return updated || existing;
    }
    return this.addPlayer({ ...data, clubId });
  }
  
  async injectDataFromScrape(clubId: number, dataType: string, data: unknown[]): Promise<InjectionResult> {
    const result: InjectionResult = { success: 0, failed: 0, skipped: 0, errors: [] };
    
    for (const item of data) {
      try {
        switch (dataType) {
          case 'players':
            await this.upsertPlayer(clubId, { ...(item as InsertFootdatasPlayer), clubId });
            result.success++;
            break;
            
          case 'transfers': {
            const { isNew } = await this.upsertTransfer({ ...(item as InsertFootdatasTransfer), clubId });
            if (isNew) result.success++;
            else result.skipped++;
            break;
          }
          
          case 'news': {
            const { isNew } = await this.upsertNews({ ...(item as InsertFootdatasNews), clubId });
            if (isNew) result.success++;
            else result.skipped++;
            break;
          }
          
          case 'rankings': {
            const { isNew } = await this.upsertRanking({ ...(item as InsertFootdatasRanking), clubId });
            if (isNew) result.success++;
            else result.skipped++;
            break;
          }
          
          case 'staff':
            await this.addStaff({ ...(item as InsertFootdatasStaff), clubId });
            result.success++;
            break;
            
          case 'stats':
            await this.upsertClubStats({ ...(item as InsertFootdatasClubStats), clubId });
            result.success++;
            break;
            
          default:
            result.failed++;
            result.errors.push(`Unknown data type: ${dataType}`);
        }
      } catch (error: any) {
        result.failed++;
        result.errors.push(`Error processing ${dataType} item: ${error.message}`);
      }
    }
    
    console.log(`[FOOTDATAS] Injection complete for club ${clubId}: ${result.success} ${dataType} added, ${result.skipped} skipped, ${result.failed} failed`);
    return result;
  }

  // ========================================
  // AI-READY METHODS FOR ULYSSE CONTEXT
  // ========================================
  
  async getClubFormForAI(clubId: number, nbMatches: number = 5): Promise<string> {
    const club = await this.getClubById(clubId);
    if (!club) return 'Club not found';
    
    const [latestStats] = await db.select().from(footdatasClubStats)
      .where(eq(footdatasClubStats.clubId, clubId))
      .orderBy(desc(footdatasClubStats.season))
      .limit(1);
    
    const latestRanking = await this.getLatestRanking(clubId, club.currentLeague || 'league');
    
    const lines: string[] = [
      `## ${club.name} - Forme récente`,
    ];
    
    if (latestRanking) {
      lines.push(`**Classement:** ${latestRanking.position}e (${latestRanking.points} pts)`);
      if (latestRanking.goalsFor && latestRanking.goalsAgainst) {
        lines.push(`**Buts:** ${latestRanking.goalsFor} marqués / ${latestRanking.goalsAgainst} encaissés (diff: ${latestRanking.goalsFor - latestRanking.goalsAgainst})`);
      }
    }
    
    if (latestStats) {
      lines.push(`**Saison ${latestStats.season}:**`);
      if (latestStats.matchesPlayed) lines.push(`- ${latestStats.matchesPlayed} matchs joués`);
      if (latestStats.wins !== null) lines.push(`- ${latestStats.wins}V / ${latestStats.draws}N / ${latestStats.losses}D`);
      if (latestStats.goalsScored !== null) lines.push(`- ${latestStats.goalsScored} buts marqués, ${latestStats.goalsConceded} encaissés`);
      if (latestStats.cleanSheets) lines.push(`- ${latestStats.cleanSheets} clean sheets`);
    }
    
    const recentTransfers = await this.getRecentTransfers(clubId, 3);
    if (recentTransfers.length > 0) {
      lines.push('', '**Mouvements récents:**');
      for (const t of recentTransfers) {
        const dir = t.transferType.includes('in') ? '←' : '→';
        lines.push(`- ${dir} ${t.playerName} (${t.fee || 'libre'})`);
      }
    }
    
    return lines.join('\n');
  }
  
  async getKeyPlayersForAI(clubId: number, limit: number = 5): Promise<string> {
    const club = await this.getClubById(clubId);
    if (!club) return 'Club not found';
    
    const players = await this.getPlayers(clubId);
    if (players.length === 0) return `Aucun joueur enregistré pour ${club.name}`;
    
    const playerIds = players.map(p => p.id);
    const allStats = playerIds.length > 0 
      ? await db.select().from(footdatasPlayerStats).where(inArray(footdatasPlayerStats.playerId, playerIds))
      : [];
    
    const playerWithStats = players.map(p => {
      const stats = allStats.filter(s => s.playerId === p.id);
      const totalGoals = stats.reduce((sum, s) => sum + (s.goals || 0), 0);
      const totalAssists = stats.reduce((sum, s) => sum + (s.assists || 0), 0);
      const totalMinutes = stats.reduce((sum, s) => sum + (s.minutesPlayed || 0), 0);
      return { ...p, totalGoals, totalAssists, totalMinutes };
    });
    
    const topContributors = playerWithStats
      .sort((a, b) => (b.totalGoals + b.totalAssists) - (a.totalGoals + a.totalAssists))
      .slice(0, limit);
    
    const lines: string[] = [
      `## ${club.name} - Joueurs clés`,
    ];
    
    for (const p of topContributors) {
      const age = p.dateOfBirth ? Math.floor((Date.now() - new Date(p.dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null;
      const posLabel = { GK: 'Gardien', DF: 'Défenseur', MF: 'Milieu', FW: 'Attaquant' }[p.position || ''] || p.position;
      lines.push(`- **${p.name}** (#${p.shirtNumber}) - ${posLabel}${age ? `, ${age} ans` : ''}`);
      if (p.totalGoals > 0 || p.totalAssists > 0) {
        lines.push(`  ${p.totalGoals} buts, ${p.totalAssists} passes déc.`);
      }
      if (p.marketValue) lines.push(`  Valeur: ${p.marketValue}`);
    }
    
    return lines.join('\n');
  }
  
  async getClubSummaryForAI(clubIdOrName: string | number): Promise<string> {
    let club: FootdatasClub | null = null;
    
    if (typeof clubIdOrName === 'number') {
      club = await this.getClubById(clubIdOrName);
    } else {
      club = await this.getClubByName(clubIdOrName) || 
             await this.getClubByShortName(clubIdOrName) ||
             await this.getClubByDataFileName(clubIdOrName);
    }
    
    if (!club) return `Club "${clubIdOrName}" not found in FOOTDATAS`;
    
    const dataFile = await this.getClubDataFile(club.id);
    if (!dataFile) return `Unable to load data for club ${club.name}`;
    
    const summary: string[] = [
      `# ${club.name} (${club.shortName})`,
      `**Ligue:** ${dataFile.league?.name || 'Unknown'}`,
      `**Stade:** ${club.stadium || 'N/A'} (${club.stadiumCapacity || 'N/A'} places)`,
      `**Fondé en:** ${club.foundedYear || 'N/A'}`,
      `**Président:** ${club.president || 'N/A'}`,
      '',
      `## Effectif (${dataFile.players.length} joueurs)`,
    ];
    
    const positions: Record<string, FootdatasPlayer[]> = { GK: [], DF: [], MF: [], FW: [] };
    for (const p of dataFile.players) {
      if (p.position && positions[p.position]) {
        positions[p.position].push(p);
      }
    }
    
    for (const [pos, players] of Object.entries(positions)) {
      if (players.length > 0) {
        summary.push(`**${pos}:** ${players.map(p => `${p.name} (#${p.shirtNumber})`).join(', ')}`);
      }
    }
    
    if (dataFile.trophies.length > 0) {
      summary.push('', '## Palmarès');
      const trophyCount = await this.getTrophyCount(club.id);
      for (const { competition, count } of trophyCount) {
        summary.push(`- ${competition}: ${count}x`);
      }
    }
    
    if (dataFile.rankings.length > 0) {
      const latestRanking = dataFile.rankings[0];
      summary.push('', `## Classement actuel: ${latestRanking.position}e (${latestRanking.points} pts)`);
    }
    
    if (dataFile.transfers.length > 0) {
      summary.push('', `## Derniers transferts (${Math.min(5, dataFile.transfers.length)})`);
      for (const t of dataFile.transfers.slice(0, 5)) {
        const direction = t.transferType.includes('in') ? '←' : '→';
        summary.push(`- ${direction} ${t.playerName} (${t.fee || 'N/A'})`);
      }
    }
    
    return summary.join('\n');
  }

  // ========================================
  // MATCHES OPERATIONS (from matchendirect.fr)
  // ========================================

  private leagueCodeMap: Record<string, string> = {
    'ligue1': 'L1',
    'laliga': 'LL',
    'premierLeague': 'PL',
    'bundesliga': 'BL',
    'serieA': 'SA',
  };

  async upsertMatch(data: InsertFootdatasMatch): Promise<FootdatasMatch> {
    const existing = await db.select().from(footdatasMatches)
      .where(and(
        eq(footdatasMatches.homeTeamName, data.homeTeamName),
        eq(footdatasMatches.awayTeamName, data.awayTeamName),
        eq(footdatasMatches.matchDate, data.matchDate)
      ))
      .limit(1);

    if (existing.length > 0) {
      const [updated] = await db.update(footdatasMatches)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(footdatasMatches.id, existing[0].id))
        .returning();
      return updated;
    }

    const [match] = await db.insert(footdatasMatches).values(data).returning();
    console.log(`[FOOTDATAS] Match stored: ${data.homeTeamName} vs ${data.awayTeamName} (${data.matchDate})`);
    return match;
  }

  async storeMatchEndirectData(matchEndirectResult: {
    date: string;
    big5Matches: Array<{
      competition: string;
      homeTeam: string;
      awayTeam: string;
      homeScore: number | null;
      awayScore: number | null;
      status: string;
      time: string;
      matchUrl: string;
    }>;
    byLeague: Record<string, Array<any>>;
  }): Promise<{ stored: number; updated: number; errors: string[] }> {
    const result = { stored: 0, updated: 0, errors: [] as string[] };
    
    console.log(`[FOOTDATAS] Storing ${matchEndirectResult.big5Matches.length} matches from matchendirect.fr`);

    for (const [leagueKey, matches] of Object.entries(matchEndirectResult.byLeague)) {
      const leagueCode = this.leagueCodeMap[leagueKey] || leagueKey.toUpperCase();
      
      for (const match of matches) {
        try {
          const homeClub = await this.getClubByName(match.homeTeam) || await this.searchClubs(match.homeTeam).then(r => r[0]);
          const awayClub = await this.getClubByName(match.awayTeam) || await this.searchClubs(match.awayTeam).then(r => r[0]);
          
          const matchData: InsertFootdatasMatch = {
            homeTeamName: match.homeTeam,
            awayTeamName: match.awayTeam,
            homeScore: match.homeScore,
            awayScore: match.awayScore,
            status: match.status,
            matchDate: matchEndirectResult.date,
            matchTime: match.time,
            competition: match.competition,
            leagueCode,
            matchUrl: match.matchUrl,
            source: 'matchendirect',
            homeClubId: homeClub?.id || null,
            awayClubId: awayClub?.id || null,
            leagueId: homeClub?.leagueId || awayClub?.leagueId || null,
          };

          const existing = await db.select().from(footdatasMatches)
            .where(and(
              eq(footdatasMatches.homeTeamName, match.homeTeam),
              eq(footdatasMatches.awayTeamName, match.awayTeam),
              eq(footdatasMatches.matchDate, matchEndirectResult.date)
            ))
            .limit(1);

          if (existing.length > 0) {
            await db.update(footdatasMatches)
              .set({ ...matchData, updatedAt: new Date() })
              .where(eq(footdatasMatches.id, existing[0].id));
            result.updated++;
          } else {
            await db.insert(footdatasMatches).values(matchData);
            result.stored++;
          }
        } catch (err: any) {
          result.errors.push(`${match.homeTeam} vs ${match.awayTeam}: ${err.message}`);
        }
      }
    }

    console.log(`[FOOTDATAS] MatchEnDirect sync complete: ${result.stored} stored, ${result.updated} updated, ${result.errors.length} errors`);
    return result;
  }

  async getMatchesByDate(date: string): Promise<FootdatasMatch[]> {
    return db.select().from(footdatasMatches)
      .where(eq(footdatasMatches.matchDate, date))
      .orderBy(footdatasMatches.competition, footdatasMatches.matchTime);
  }

  async getMatchesByLeague(leagueCode: string, limit = 50): Promise<FootdatasMatch[]> {
    return db.select().from(footdatasMatches)
      .where(eq(footdatasMatches.leagueCode, leagueCode.toUpperCase()))
      .orderBy(desc(footdatasMatches.matchDate))
      .limit(limit);
  }

  async getMatchesByClub(clubId: number, limit = 20): Promise<FootdatasMatch[]> {
    return db.select().from(footdatasMatches)
      .where(sql`${footdatasMatches.homeClubId} = ${clubId} OR ${footdatasMatches.awayClubId} = ${clubId}`)
      .orderBy(desc(footdatasMatches.matchDate))
      .limit(limit);
  }

  async getUpcomingMatches(leagueCode?: string, limit = 30): Promise<FootdatasMatch[]> {
    const baseQuery = db.select().from(footdatasMatches)
      .where(eq(footdatasMatches.status, 'scheduled'));
    
    if (leagueCode) {
      return baseQuery
        .where(and(eq(footdatasMatches.status, 'scheduled'), eq(footdatasMatches.leagueCode, leagueCode.toUpperCase())))
        .orderBy(footdatasMatches.matchDate)
        .limit(limit);
    }
    
    return baseQuery.orderBy(footdatasMatches.matchDate).limit(limit);
  }

  async getRecentMatches(limit = 50): Promise<FootdatasMatch[]> {
    return db.select().from(footdatasMatches)
      .orderBy(desc(footdatasMatches.matchDate))
      .limit(limit);
  }

  // ========================================
  // PREDICTION INTEGRATION
  // ========================================

  async getTeamDataForPrediction(homeTeamName: string, awayTeamName: string): Promise<{
    homeTeam: { club: FootdatasClub | null; recentForm: string; avgGoals: number; stats: any };
    awayTeam: { club: FootdatasClub | null; recentForm: string; avgGoals: number; stats: any };
    h2h: { homeWins: number; draws: number; awayWins: number; lastMeetings: FootdatasMatch[] };
  }> {
    const homeClub = await this.getClubByName(homeTeamName) || await this.searchClubs(homeTeamName).then(c => c[0] || null);
    const awayClub = await this.getClubByName(awayTeamName) || await this.searchClubs(awayTeamName).then(c => c[0] || null);

    const homeStats = homeClub ? await this.getClubStats(homeClub.id) : null;
    const awayStats = awayClub ? await this.getClubStats(awayClub.id) : null;

    const homeMatches = homeClub ? await this.getMatchesByClub(homeClub.id, 10) : [];
    const awayMatches = awayClub ? await this.getMatchesByClub(awayClub.id, 10) : [];

    const homeForm = this.calculateForm(homeMatches, homeClub?.id || 0);
    const awayForm = this.calculateForm(awayMatches, awayClub?.id || 0);

    const homeAvgGoals = this.calculateAvgGoals(homeMatches, homeClub?.id || 0);
    const awayAvgGoals = this.calculateAvgGoals(awayMatches, awayClub?.id || 0);

    let h2hMatches: FootdatasMatch[] = [];
    if (homeClub && awayClub) {
      h2hMatches = await db.select().from(footdatasMatches)
        .where(sql`(${footdatasMatches.homeClubId} = ${homeClub.id} AND ${footdatasMatches.awayClubId} = ${awayClub.id}) 
                   OR (${footdatasMatches.homeClubId} = ${awayClub.id} AND ${footdatasMatches.awayClubId} = ${homeClub.id})`)
        .orderBy(desc(footdatasMatches.matchDate))
        .limit(10);
    }

    const h2hStats = this.calculateH2H(h2hMatches, homeClub?.id || 0, awayClub?.id || 0);

    console.log(`[FOOTDATAS] Team data for prediction: ${homeTeamName} vs ${awayTeamName}`);

    return {
      homeTeam: { club: homeClub, recentForm: homeForm, avgGoals: homeAvgGoals, stats: homeStats },
      awayTeam: { club: awayClub, recentForm: awayForm, avgGoals: awayAvgGoals, stats: awayStats },
      h2h: { ...h2hStats, lastMeetings: h2hMatches }
    };
  }

  private calculateForm(matches: FootdatasMatch[], clubId: number): string {
    if (matches.length === 0) return "?????";
    
    return matches.slice(0, 5).map(m => {
      const isHome = m.homeClubId === clubId;
      const homeScore = m.homeScore ?? 0;
      const awayScore = m.awayScore ?? 0;
      
      if (m.status !== 'finished') return "?";
      if (isHome) {
        if (homeScore > awayScore) return "W";
        if (homeScore < awayScore) return "L";
        return "D";
      } else {
        if (awayScore > homeScore) return "W";
        if (awayScore < homeScore) return "L";
        return "D";
      }
    }).join("");
  }

  private calculateAvgGoals(matches: FootdatasMatch[], clubId: number): number {
    if (clubId === 0) return 0;
    
    const finishedMatches = matches.filter(m => m.status === 'finished');
    if (finishedMatches.length === 0) return 0;
    
    const totalGoals = finishedMatches.reduce((sum, m) => {
      const isHome = m.homeClubId === clubId;
      return sum + (isHome ? (m.homeScore ?? 0) : (m.awayScore ?? 0));
    }, 0);
    
    return Math.round((totalGoals / finishedMatches.length) * 100) / 100;
  }

  private calculateH2H(matches: FootdatasMatch[], homeClubId: number, awayClubId: number): { homeWins: number; draws: number; awayWins: number } {
    let homeWins = 0, draws = 0, awayWins = 0;
    
    for (const m of matches) {
      if (m.status !== 'finished') continue;
      const homeScore = m.homeScore ?? 0;
      const awayScore = m.awayScore ?? 0;
      
      if (m.homeClubId === homeClubId) {
        if (homeScore > awayScore) homeWins++;
        else if (homeScore < awayScore) awayWins++;
        else draws++;
      } else {
        if (awayScore > homeScore) homeWins++;
        else if (awayScore < homeScore) awayWins++;
        else draws++;
      }
    }
    
    return { homeWins, draws, awayWins };
  }

  async updateMatchWithPredictionResult(matchId: number, result: {
    homeScore: number;
    awayScore: number;
    predictionWon: boolean;
    betType: string;
    confidence: number;
  }): Promise<boolean> {
    try {
      const [match] = await db.select().from(footdatasMatches)
        .where(eq(footdatasMatches.id, matchId));
      
      if (!match) return false;

      await db.update(footdatasMatches)
        .set({
          homeScore: result.homeScore,
          awayScore: result.awayScore,
          status: 'finished',
          predictionData: {
            ...((match.predictionData as any) || {}),
            lastPrediction: {
              won: result.predictionWon,
              betType: result.betType,
              confidence: result.confidence,
              settledAt: new Date().toISOString()
            }
          },
          updatedAt: new Date()
        })
        .where(eq(footdatasMatches.id, matchId));

      console.log(`[FOOTDATAS] Updated match #${matchId} with prediction result: ${result.predictionWon ? 'WON' : 'LOST'}`);
      return true;
    } catch (error) {
      console.error(`[FOOTDATAS] Error updating match with prediction result:`, error);
      return false;
    }
  }
  async syncClubFromAPI(clubId: number, apiTeamId: number): Promise<{ players: number; staff: number; transfers: number; trophies: number; stats: number }> {
    const result = { players: 0, staff: 0, transfers: 0, trophies: 0, stats: 0 };
    try {
      const { apiFootballService } = await import("./apiFootballService");
      const season = new Date().getFullYear();

      const squad = await apiFootballService.getTeamSquad(apiTeamId);
      if (squad?.players?.length) {
        for (const p of squad.players) {
          const existing = await db.select().from(footdatasPlayers)
            .where(and(eq(footdatasPlayers.clubId, clubId), eq(footdatasPlayers.name, p.name)));
          if (existing.length === 0) {
            await db.insert(footdatasPlayers).values({
              clubId,
              name: p.name,
              shirtNumber: p.number || undefined,
              position: p.position === "Goalkeeper" ? "GK" : p.position === "Defender" ? "DF" : p.position === "Midfielder" ? "MF" : p.position === "Attacker" ? "FW" : p.position,
              age: p.age || undefined,
              nationality: undefined,
              photoUrl: p.photo || undefined,
            });
            result.players++;
          }
        }
        console.log(`[FOOTDATAS-SYNC] Club ${clubId}: ${result.players} players synced`);
      }

      const coaches = await apiFootballService.getCoach(apiTeamId);
      if (coaches?.length) {
        for (const c of coaches) {
          const existing = await db.select().from(footdatasStaff)
            .where(and(eq(footdatasStaff.clubId, clubId), eq(footdatasStaff.name, c.name)));
          if (existing.length === 0) {
            await db.insert(footdatasStaff).values({
              clubId,
              name: c.name,
              role: "head_coach",
              nationality: c.nationality || undefined,
              birthDate: c.birth?.date ? new Date(c.birth.date) : undefined,
              photoUrl: c.photo || undefined,
            });
            result.staff++;
          }
        }
      }

      try {
        const transfers = await apiFootballService.getTransfers(undefined, apiTeamId);
        if (transfers?.length) {
          const t = transfers[0];
          if (t?.transfers?.length) {
            for (const tr of t.transfers.slice(0, 30)) {
              const existing = await db.select().from(footdatasTransfers)
                .where(and(eq(footdatasTransfers.clubId, clubId), eq(footdatasTransfers.playerName, t.player?.name || "Unknown"), eq(footdatasTransfers.fromClub, tr.teams?.in?.name || "")));
              if (existing.length === 0) {
                await db.insert(footdatasTransfers).values({
                  clubId,
                  playerName: t.player?.name || "Unknown",
                  transferType: tr.type === "Free" ? "free" : tr.type === "Loan" ? "loan_in" : "in",
                  transferWindow: tr.date ? (new Date(tr.date).getMonth() < 6 ? "winter_" : "summer_") + new Date(tr.date).getFullYear() : "unknown",
                  transferDate: tr.date ? new Date(tr.date) : undefined,
                  fromClub: tr.teams?.out?.name || undefined,
                  toClub: tr.teams?.in?.name || undefined,
                  confirmed: true,
                });
                result.transfers++;
              }
            }
          }
        }
      } catch (e) {}

      try {
        const trophies = await apiFootballService.getTrophies(undefined, apiTeamId);
        if (trophies?.length) {
          for (const tr of trophies.slice(0, 20)) {
            if (!tr.league || !tr.season) continue;
            const existing = await db.select().from(footdatasTrophies)
              .where(and(eq(footdatasTrophies.clubId, clubId), eq(footdatasTrophies.competition, tr.league), eq(footdatasTrophies.season, tr.season)));
            if (existing.length === 0) {
              await db.insert(footdatasTrophies).values({
                clubId,
                competition: tr.league,
                season: tr.season,
                result: tr.place === "Winner" ? "winner" : tr.place === "2nd" ? "runner_up" : tr.place || "participant",
              });
              result.trophies++;
            }
          }
        }
      } catch (e) {}

      console.log(`[FOOTDATAS-SYNC] Club ${clubId} complete: ${JSON.stringify(result)}`);
      return result;
    } catch (error: any) {
      console.error(`[FOOTDATAS-SYNC] Error syncing club ${clubId}:`, error.message);
      return result;
    }
  }

  async syncAllClubsFromAPI(maxClubs: number = 5): Promise<{ synced: number; total: { players: number; staff: number; transfers: number; trophies: number } }> {
    const apiTeamMap = await db.select().from(
      (await import("@shared/schema")).footdatasApiTeamMap
    );
    
    const clubs = await this.getAllClubs();
    const totals = { players: 0, staff: 0, transfers: 0, trophies: 0 };
    let synced = 0;

    for (const club of clubs.slice(0, maxClubs)) {
      const mapping = apiTeamMap.find(m => {
        const clubName = club.name.toLowerCase().replace(/fc |cf |ac |sc |rc |ogc |as |olympique /gi, "").trim();
        const mapName = (m.teamName || "").toLowerCase().trim();
        const shortName = (club.shortName || "").toLowerCase();
        const clubWords = clubName.split(/\s+/);
        const mapWords = mapName.split(/\s+/);
        if (clubName === mapName) return true;
        if (clubName.includes(mapName) || mapName.includes(clubName)) return true;
        if (shortName && mapName.includes(shortName)) return true;
        if (clubWords.some(w => w.length > 3 && mapWords.some(mw => mw.length > 3 && (w.includes(mw) || mw.includes(w))))) return true;
        const clubCity = (club.city || "").toLowerCase();
        if (clubCity && clubCity.length > 3 && mapWords.some(mw => mw.includes(clubCity) || clubCity.includes(mw))) return true;
        return false;
      });

      if (mapping?.apiTeamId) {
        const r = await this.syncClubFromAPI(club.id, mapping.apiTeamId);
        totals.players += r.players;
        totals.staff += r.staff;
        totals.transfers += r.transfers;
        totals.trophies += r.trophies;
        synced++;
      }
    }

    console.log(`[FOOTDATAS-SYNC] Batch complete: ${synced} clubs, ${JSON.stringify(totals)}`);
    return { synced, total: totals };
  }

  async generateClubStats(clubId: number, season?: string): Promise<void> {
    const currentSeason = season || `${new Date().getFullYear() - 1}-${new Date().getFullYear()}`;
    
    const matches = await db.select().from(footdatasMatches)
      .where(and(
        sql`(${footdatasMatches.homeClubId} = ${clubId} OR ${footdatasMatches.awayClubId} = ${clubId})`,
        eq(footdatasMatches.status, 'finished')
      ));

    if (!matches.length) return;

    let wins = 0, draws = 0, losses = 0, goalsFor = 0, goalsAgainst = 0;
    for (const m of matches) {
      const isHome = m.homeClubId === clubId;
      const gf = isHome ? (m.homeScore || 0) : (m.awayScore || 0);
      const ga = isHome ? (m.awayScore || 0) : (m.homeScore || 0);
      goalsFor += gf;
      goalsAgainst += ga;
      if (gf > ga) wins++;
      else if (gf < ga) losses++;
      else draws++;
    }

    const existing = await db.select().from(footdatasClubStats)
      .where(and(eq(footdatasClubStats.clubId, clubId), eq(footdatasClubStats.season, currentSeason)));
    
    const statsData = {
      clubId,
      season: currentSeason,
      competition: "Ligue 1",
      matchesPlayed: matches.length,
      wins, draws, losses, goalsFor, goalsAgainst,
      goalDifference: goalsFor - goalsAgainst,
      points: wins * 3 + draws,
      formLast5: matches.slice(-5).map(m => {
        const isHome = m.homeClubId === clubId;
        const gf = isHome ? (m.homeScore || 0) : (m.awayScore || 0);
        const ga = isHome ? (m.awayScore || 0) : (m.homeScore || 0);
        return gf > ga ? 'W' : gf < ga ? 'L' : 'D';
      }).join(''),
    };

    if (existing.length > 0) {
      await db.update(footdatasClubStats).set({ ...statsData, updatedAt: new Date() }).where(eq(footdatasClubStats.id, existing[0].id));
    } else {
      await db.insert(footdatasClubStats).values(statsData);
    }
    console.log(`[FOOTDATAS-SYNC] Generated stats for club ${clubId}: ${wins}W ${draws}D ${losses}L`);
  }
}

export const footdatasService = FootdatasService.getInstance();
