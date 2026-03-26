import { 
  scrapeRankingVerified, 
  scrapeOddsVerified, 
  scrapeMatchResultsVerified,
  scrapeTopScorersVerified,
  type VerifiedScrapeResult,
  type RankingRow,
  type OddsData,
  type MatchResult,
  type TopScorerRow
} from './scraper/verified';
import { memoryService } from './memory';
import { db } from '../db';

interface LeagueConfig {
  name: string;
  code: string;
  urlRanking?: string;
  urlOdds?: string;
  urlTopScorers?: string;
  urlMatches?: string;
}

const LEAGUES: LeagueConfig[] = [
  {
    name: 'Ligue 1',
    code: 'ligue1',
    urlRanking: 'https://www.eurotopteam.com/football/ligue1.php',
  },
  {
    name: 'Serie A',
    code: 'seriea',
    urlRanking: 'https://www.eurotopteam.com/football/seriea.php',
  },
  {
    name: 'Premier League',
    code: 'premier',
    urlRanking: 'https://www.eurotopteam.com/football/premier.php',
  },
  {
    name: 'La Liga',
    code: 'liga',
    urlRanking: 'https://www.eurotopteam.com/football/liga.php',
  },
  {
    name: 'Bundesliga',
    code: 'bundesliga',
    urlRanking: 'https://www.eurotopteam.com/football/bundesliga.php',
  },
];

export interface SportsWatchResult {
  league: string;
  type: 'ranking' | 'odds' | 'matches' | 'topscorers';
  verified: boolean;
  itemCount: number;
  error?: string;
}

export class SportsWatchService {
  private lastRunResults: Map<string, SportsWatchResult> = new Map();
  
  async runDailyWatch(userId: number): Promise<SportsWatchResult[]> {
    console.log(`[SportsWatch] Starting daily verified watch for ${LEAGUES.length} leagues...`);
    const results: SportsWatchResult[] = [];
    
    for (const league of LEAGUES) {
      if (league.urlRanking) {
        const result = await this.updateLeagueRanking(userId, league);
        results.push(result);
        this.lastRunResults.set(`ranking_${league.code}`, result);
      }
      
      if (league.urlOdds) {
        const result = await this.updateLeagueOdds(userId, league);
        results.push(result);
        this.lastRunResults.set(`odds_${league.code}`, result);
      }
      
      if (league.urlTopScorers) {
        const result = await this.updateTopScorers(userId, league);
        results.push(result);
        this.lastRunResults.set(`topscorers_${league.code}`, result);
      }
    }
    
    const verified = results.filter(r => r.verified).length;
    const failed = results.filter(r => !r.verified).length;
    console.log(`[SportsWatch] Daily watch completed: ${verified} verified, ${failed} failed`);
    
    return results;
  }
  
  private async updateLeagueRanking(userId: number, league: LeagueConfig): Promise<SportsWatchResult> {
    const result: SportsWatchResult = {
      league: league.name,
      type: 'ranking',
      verified: false,
      itemCount: 0
    };
    
    if (!league.urlRanking) {
      result.error = 'No ranking URL configured';
      return result;
    }
    
    try {
      console.log(`[SportsWatch] Fetching VERIFIED ranking for ${league.name}...`);
      
      const res = await scrapeRankingVerified(league.urlRanking);
      
      if (!res.ok || !res.verified || !res.data || res.data.length === 0) {
        console.warn(`[SportsWatch] Ranking for ${league.name} NOT VERIFIED. diffs=${res.diffs?.slice(0, 2).join(', ')}`);
        result.error = res.diffs?.join('; ') || 'Verification failed';
        return result;
      }
      
      result.verified = true;
      result.itemCount = res.data.length;
      
      console.log(`[SportsWatch] ✅ VERIFIED ranking for ${league.name}: ${res.data.length} teams`);
      
      // Store in memory with VERIFIED flag
      const summary = res.data.slice(0, 10).map((r: RankingRow) => 
        `${r.position}. ${r.name}${r.points !== undefined ? ` (${r.points} pts)` : ''}`
      ).join('\n');
      
      await memoryService.updateOrCreateMemory(
        userId,
        'sports_ranking',
        `ranking_${league.code}`,
        `[DONNÉES VÉRIFIÉES - CLASSEMENT ${league.name.toUpperCase()}]\n${summary}`,
        `sports:ranking:${league.name}`,
        { verified: true, data: res.data }
      );
      
      return result;
      
    } catch (error) {
      console.error(`[SportsWatch] Error updating ranking for ${league.name}:`, error);
      result.error = error instanceof Error ? error.message : 'Unknown error';
      return result;
    }
  }
  
  private async updateLeagueOdds(userId: number, league: LeagueConfig): Promise<SportsWatchResult> {
    const result: SportsWatchResult = {
      league: league.name,
      type: 'odds',
      verified: false,
      itemCount: 0
    };
    
    if (!league.urlOdds) {
      result.error = 'No odds URL configured';
      return result;
    }
    
    try {
      console.log(`[SportsWatch] Fetching VERIFIED odds for ${league.name}...`);
      
      const res = await scrapeOddsVerified(league.urlOdds);
      
      if (!res.ok || !res.verified || !res.data || res.data.length === 0) {
        console.warn(`[SportsWatch] Odds for ${league.name} NOT VERIFIED. diffs=${res.diffs?.slice(0, 2).join(', ')}`);
        result.error = res.diffs?.join('; ') || 'Verification failed';
        return result;
      }
      
      result.verified = true;
      result.itemCount = res.data.length;
      
      console.log(`[SportsWatch] ✅ VERIFIED odds for ${league.name}: ${res.data.length} matches`);
      
      // Store in memory with VERIFIED flag
      const summary = res.data.slice(0, 5).map((o: OddsData) => 
        `${o.homeTeam} vs ${o.awayTeam}: ${o.homeOdds || '?'}/${o.drawOdds || '?'}/${o.awayOdds || '?'}`
      ).join('\n');
      
      await memoryService.updateOrCreateMemory(
        userId,
        'sports_odds',
        `odds_${league.code}`,
        `[DONNÉES VÉRIFIÉES - COTES ${league.name.toUpperCase()}]\n${summary}`,
        `sports:odds:${league.name}`,
        { verified: true, data: res.data }
      );
      
      return result;
      
    } catch (error) {
      console.error(`[SportsWatch] Error updating odds for ${league.name}:`, error);
      result.error = error instanceof Error ? error.message : 'Unknown error';
      return result;
    }
  }
  
  private async updateTopScorers(userId: number, league: LeagueConfig): Promise<SportsWatchResult> {
    const result: SportsWatchResult = {
      league: league.name,
      type: 'topscorers',
      verified: false,
      itemCount: 0
    };
    
    if (!league.urlTopScorers) {
      result.error = 'No top scorers URL configured';
      return result;
    }
    
    try {
      console.log(`[SportsWatch] Fetching VERIFIED top scorers for ${league.name}...`);
      
      const res = await scrapeTopScorersVerified(league.urlTopScorers);
      
      if (!res.ok || !res.verified || !res.data || res.data.length === 0) {
        console.warn(`[SportsWatch] Top scorers for ${league.name} NOT VERIFIED. diffs=${res.diffs?.slice(0, 2).join(', ')}`);
        result.error = res.diffs?.join('; ') || 'Verification failed';
        return result;
      }
      
      result.verified = true;
      result.itemCount = res.data.length;
      
      console.log(`[SportsWatch] ✅ VERIFIED top scorers for ${league.name}: ${res.data.length} players`);
      
      // Store in memory with VERIFIED flag
      const summary = res.data.slice(0, 10).map((s: TopScorerRow) => 
        `${s.position}. ${s.name}${s.team ? ` (${s.team})` : ''} - ${s.goals} buts`
      ).join('\n');
      
      await memoryService.updateOrCreateMemory(
        userId,
        'sports_topscorers',
        `topscorers_${league.code}`,
        `[DONNÉES VÉRIFIÉES - BUTEURS ${league.name.toUpperCase()}]\n${summary}`,
        `sports:topscorers:${league.name}`,
        { verified: true, data: res.data }
      );
      
      return result;
      
    } catch (error) {
      console.error(`[SportsWatch] Error updating top scorers for ${league.name}:`, error);
      result.error = error instanceof Error ? error.message : 'Unknown error';
    }
    
    return result;
  }
  
  // Manual trigger for a specific league
  async watchLeague(userId: number, leagueCode: string): Promise<SportsWatchResult[]> {
    const league = LEAGUES.find(l => l.code.toLowerCase() === leagueCode.toLowerCase());
    if (!league) {
      return [{ 
        league: leagueCode, 
        type: 'ranking', 
        verified: false, 
        itemCount: 0, 
        error: `Unknown league: ${leagueCode}` 
      }];
    }
    
    const results: SportsWatchResult[] = [];
    
    if (league.urlRanking) {
      results.push(await this.updateLeagueRanking(userId, league));
    }
    if (league.urlOdds) {
      results.push(await this.updateLeagueOdds(userId, league));
    }
    if (league.urlTopScorers) {
      results.push(await this.updateTopScorers(userId, league));
    }
    
    return results;
  }
  
  // Add a custom URL to watch (one-time)
  async watchCustomUrl(
    userId: number, 
    url: string, 
    type: 'ranking' | 'odds' | 'matches' | 'topscorers',
    label: string
  ): Promise<SportsWatchResult> {
    const result: SportsWatchResult = {
      league: label,
      type,
      verified: false,
      itemCount: 0
    };
    
    try {
      console.log(`[SportsWatch] Fetching VERIFIED ${type} from custom URL: ${url}`);
      
      let res: VerifiedScrapeResult<any>;
      
      switch (type) {
        case 'ranking':
          res = await scrapeRankingVerified(url);
          break;
        case 'odds':
          res = await scrapeOddsVerified(url);
          break;
        case 'matches':
          res = await scrapeMatchResultsVerified(url);
          break;
        case 'topscorers':
          res = await scrapeTopScorersVerified(url);
          break;
        default:
          res = { ok: false, verified: false, data: null, attempts: 0 };
      }
      
      if (!res.ok || !res.verified || !res.data) {
        console.warn(`[SportsWatch] Custom ${type} NOT VERIFIED: ${res.diffs?.slice(0, 2).join(', ')}`);
        result.error = res.diffs?.join('; ') || 'Verification failed';
        return result;
      }
      
      result.verified = true;
      result.itemCount = Array.isArray(res.data) ? res.data.length : 1;
      
      console.log(`[SportsWatch] ✅ VERIFIED custom ${type}: ${result.itemCount} items`);
      
      const key = `custom_${type}_${label.replace(/\s+/g, '_').toLowerCase()}`;
      await memoryService.updateOrCreateMemory(
        userId,
        `sports_${type}`,
        key,
        `[DONNÉES VÉRIFIÉES - ${type.toUpperCase()} ${label}]\n${JSON.stringify(res.data).substring(0, 500)}...`,
        url,
        { verified: true, data: res.data }
      );
      
      return result;
      
    } catch (error) {
      console.error(`[SportsWatch] Error with custom URL:`, error);
      result.error = error instanceof Error ? error.message : 'Unknown error';
      return result;
    }
  }
  
  // Get last run status
  getLastRunResults(): Map<string, SportsWatchResult> {
    return this.lastRunResults;
  }
  
  // Get configured leagues
  getConfiguredLeagues(): LeagueConfig[] {
    return LEAGUES;
  }
}

export const sportsWatchService = new SportsWatchService();
console.log('[SportsWatchService] Verified sports watch service loaded');
