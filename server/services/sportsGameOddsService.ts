/**
 * SportsGameOdds Service
 * Third odds source with cost-effective per-event pricing
 * Documentation: https://sportsgameodds.com/docs/
 * 
 * Supports: NFL, NBA, NHL, Soccer (multiple leagues)
 * Pricing: Pay per event, not per market/bookmaker
 */

interface SportsGameOddsEvent {
  eventID: string;
  leagueID: string;
  sportID: string;
  homeTeam: {
    teamID: string;
    names: { short?: string; medium?: string; long?: string };
  };
  awayTeam: {
    teamID: string;
    names: { short?: string; medium?: string; long?: string };
  };
  startTime: string;
  status: string;
  odds?: Record<string, SportsGameOddsMarket>;
  scores?: {
    home: number;
    away: number;
  };
}

interface SportsGameOddsMarket {
  oddID: string;
  marketName: string;
  bookmakers: Record<string, {
    odds: number;
    line?: number;
    updatedAt: string;
  }>;
}

interface SportsGameOddsResponse {
  data: SportsGameOddsEvent[];
  cursor?: string;
}

export interface SportsGameParsedOdds {
  eventId: string;
  leagueId: string;
  homeTeam: string;
  awayTeam: string;
  startTime: Date;
  homeOdds: number | null;
  drawOdds: number | null;
  awayOdds: number | null;
  over25Odds: number | null;
  under25Odds: number | null;
  spread?: number;
  spreadHome?: number;
  spreadAway?: number;
  totalLine?: number;
  overOdds?: number;
  underOdds?: number;
  bookmaker: string;
  updatedAt: Date;
}

class SportsGameOddsService {
  private apiKey: string;
  private baseUrl = 'https://api.sportsgameodds.com/v2';
  private creditsUsed = 0;
  
  // League mappings for SportsGameOdds (correct IDs from API documentation)
  private leagueMappings: Record<string, string> = {
    // Football/Soccer - correct SportsGameOdds IDs
    'ligue1': 'LIGUE_1_FR',
    'premierleague': 'EPL',
    'laliga': 'LA_LIGA',
    'bundesliga': 'BUNDESLIGA',
    'seriea': 'SERIE_A_IT',
    'championsleague': 'UEFA_CHAMPIONS_LEAGUE',
    // American Sports
    'nba': 'NBA',
    'nhl': 'NHL',
    'nfl': 'NFL',
    'mlb': 'MLB'
  };
  
  constructor() {
    this.apiKey = process.env.SPORTSGAMEODDS_API_KEY || '';
  }
  
  isConfigured(): boolean {
    return !!this.apiKey;
  }
  
  getUsageStats(): { creditsUsed: number } {
    return { creditsUsed: this.creditsUsed };
  }
  
  private async fetch<T>(endpoint: string, params: Record<string, string> = {}): Promise<T | null> {
    if (!this.apiKey) {
      console.log('[SportsGameOdds] API key not configured');
      return null;
    }
    
    const url = new URL(`${this.baseUrl}${endpoint}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    
    try {
      console.log(`[SportsGameOdds] Fetching: ${endpoint}`);
      const response = await fetch(url.toString(), {
        headers: {
          'X-Api-Key': this.apiKey,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[SportsGameOdds] Error: ${response.status} - ${errorText}`);
        return null;
      }
      
      const data = await response.json();
      return data as T;
    } catch (error) {
      console.error('[SportsGameOdds] Fetch error:', error);
      return null;
    }
  }
  
  /**
   * Get events with odds for specified leagues
   */
  async getEventsWithOdds(leagueIds: string[]): Promise<SportsGameParsedOdds[]> {
    const mappedLeagues = leagueIds
      .map(id => this.leagueMappings[id.toLowerCase().replace(/[^a-z0-9]/g, '')] || id)
      .join(',');
    
    const response = await this.fetch<SportsGameOddsResponse>('/events', {
      leagueID: mappedLeagues,
      oddsAvailable: 'true',
      limit: '50'
    });
    
    if (!response?.data?.length) {
      console.log(`[SportsGameOdds] No events found for ${leagueIds.join(', ')}`);
      return [];
    }
    
    this.creditsUsed += response.data.length;
    console.log(`[SportsGameOdds] Found ${response.data.length} events with odds`);
    
    return response.data.map(event => this.parseEvent(event)).filter(Boolean) as SportsGameParsedOdds[];
  }
  
  /**
   * Get football/soccer odds for major leagues
   * Tries multiple soccer league IDs to find valid ones
   */
  async getFootballOdds(): Promise<SportsGameParsedOdds[]> {
    // Try common soccer league IDs that SportsGameOdds might support
    // These IDs vary by subscription tier
    const soccerLeagues = [
      'EPL',           // English Premier League
      'LA_LIGA',       // Spanish La Liga  
      'BUNDESLIGA',    // German Bundesliga
      'SERIE_A',       // Italian Serie A
      'LIGUE_1',       // French Ligue 1
      'MLS',           // US Major League Soccer
      'CHAMPIONS_LEAGUE', // UEFA Champions League
    ];
    
    const allOdds: SportsGameParsedOdds[] = [];
    
    for (const leagueId of soccerLeagues) {
      try {
        const response = await this.fetch<SportsGameOddsResponse>('/events', {
          leagueID: leagueId,
          oddsAvailable: 'true',
          limit: '20'
        });
        
        if (response?.data?.length) {
          this.creditsUsed += response.data.length;
          console.log(`[SportsGameOdds] Found ${response.data.length} ${leagueId} events`);
          const parsed = response.data.map(event => this.parseEvent(event)).filter(Boolean) as SportsGameParsedOdds[];
          allOdds.push(...parsed);
        }
      } catch (e) {
        // League might not be available on this subscription tier, skip silently
      }
    }
    
    if (allOdds.length === 0) {
      console.log(`[SportsGameOdds] No soccer events found across leagues`);
    } else {
      console.log(`[SportsGameOdds] Total: ${allOdds.length} soccer events with odds`);
    }
    
    return allOdds;
  }
  
  /**
   * Get NBA odds using leagueID=NBA
   */
  async getNBAOdds(): Promise<SportsGameParsedOdds[]> {
    const response = await this.fetch<SportsGameOddsResponse>('/events', {
      leagueID: 'NBA',
      oddsAvailable: 'true',
      limit: '50'
    });
    
    if (!response?.data?.length) {
      console.log(`[SportsGameOdds] No NBA events found`);
      return [];
    }
    
    this.creditsUsed += response.data.length;
    console.log(`[SportsGameOdds] Found ${response.data.length} NBA events with odds`);
    
    return response.data.map(event => this.parseEvent(event)).filter(Boolean) as SportsGameParsedOdds[];
  }
  
  /**
   * Get NHL odds using leagueID=NHL
   */
  async getNHLOdds(): Promise<SportsGameParsedOdds[]> {
    const response = await this.fetch<SportsGameOddsResponse>('/events', {
      leagueID: 'NHL',
      oddsAvailable: 'true',
      limit: '50'
    });
    
    if (!response?.data?.length) {
      console.log(`[SportsGameOdds] No NHL events found`);
      return [];
    }
    
    this.creditsUsed += response.data.length;
    console.log(`[SportsGameOdds] Found ${response.data.length} NHL events with odds`);
    
    return response.data.map(event => this.parseEvent(event)).filter(Boolean) as SportsGameParsedOdds[];
  }
  
  /**
   * Get NFL odds using leagueID=NFL
   */
  async getNFLOdds(): Promise<SportsGameParsedOdds[]> {
    const response = await this.fetch<SportsGameOddsResponse>('/events', {
      leagueID: 'NFL',
      oddsAvailable: 'true',
      limit: '50'
    });
    
    if (!response?.data?.length) {
      console.log(`[SportsGameOdds] No NFL events found`);
      return [];
    }
    
    this.creditsUsed += response.data.length;
    console.log(`[SportsGameOdds] Found ${response.data.length} NFL events with odds`);
    
    return response.data.map(event => this.parseEvent(event)).filter(Boolean) as SportsGameParsedOdds[];
  }
  
  /**
   * Get all sports odds
   */
  async getAllSportsOdds(): Promise<{
    football: SportsGameParsedOdds[];
    nba: SportsGameParsedOdds[];
    nhl: SportsGameParsedOdds[];
    nfl: SportsGameParsedOdds[];
  }> {
    const [football, nba, nhl, nfl] = await Promise.all([
      this.getFootballOdds(),
      this.getNBAOdds(),
      this.getNHLOdds(),
      this.getNFLOdds()
    ]);
    
    return { football, nba, nhl, nfl };
  }
  
  /**
   * Parse event data into our format
   */
  private parseEvent(event: SportsGameOddsEvent): SportsGameParsedOdds | null {
    if (!event.odds) {
      return null;
    }
    
    // Validate and parse start time
    let startTime: Date;
    try {
      startTime = event.startTime ? new Date(event.startTime) : new Date();
      if (isNaN(startTime.getTime())) {
        console.warn(`[SportsGameOdds] Invalid startTime for event ${event.eventID}: ${event.startTime}`);
        startTime = new Date(); // Fallback to now
      }
    } catch (e) {
      console.warn(`[SportsGameOdds] Error parsing startTime for event ${event.eventID}`);
      startTime = new Date();
    }
    
    const homeTeam = event.homeTeam?.names?.medium || event.homeTeam?.names?.short || 'Home';
    const awayTeam = event.awayTeam?.names?.medium || event.awayTeam?.names?.short || 'Away';
    
    // Find best odds from available bookmakers
    let homeOdds: number | null = null;
    let drawOdds: number | null = null;
    let awayOdds: number | null = null;
    let over25Odds: number | null = null;
    let under25Odds: number | null = null;
    let spread: number | undefined;
    let spreadHome: number | undefined;
    let spreadAway: number | undefined;
    let totalLine: number | undefined;
    let overOdds: number | undefined;
    let underOdds: number | undefined;
    let bookmaker = 'Unknown';
    
    // Preferred bookmakers
    const preferredBooks = ['draftkings', 'fanduel', 'betmgm', 'pinnacle', 'bet365'];
    
    // Parse moneyline odds
    for (const [oddId, market] of Object.entries(event.odds)) {
      if (oddId.includes('MONEYLINE') || oddId.includes('1X2')) {
        for (const preferred of preferredBooks) {
          if (market.bookmakers[preferred]) {
            bookmaker = preferred;
            break;
          }
        }
        
        const bookData = market.bookmakers[bookmaker] || Object.values(market.bookmakers)[0];
        if (bookData) {
          if (oddId.includes('HOME')) {
            homeOdds = this.americanToDecimal(bookData.odds);
          } else if (oddId.includes('AWAY')) {
            awayOdds = this.americanToDecimal(bookData.odds);
          } else if (oddId.includes('DRAW')) {
            drawOdds = this.americanToDecimal(bookData.odds);
          }
        }
      }
      
      // Parse spread/handicap
      if (oddId.includes('SPREAD') || oddId.includes('HANDICAP')) {
        const bookData = Object.values(market.bookmakers)[0];
        if (bookData?.line !== undefined) {
          spread = bookData.line;
          if (oddId.includes('HOME')) {
            spreadHome = this.americanToDecimal(bookData.odds);
          } else if (oddId.includes('AWAY')) {
            spreadAway = this.americanToDecimal(bookData.odds);
          }
        }
      }
      
      // Parse totals
      if (oddId.includes('TOTAL') || oddId.includes('OVER_UNDER')) {
        const bookData = Object.values(market.bookmakers)[0];
        if (bookData?.line !== undefined) {
          totalLine = bookData.line;
          if (oddId.includes('OVER')) {
            overOdds = this.americanToDecimal(bookData.odds);
            // For football, check if it's 2.5 goals
            if (totalLine === 2.5) {
              over25Odds = overOdds;
            }
          } else if (oddId.includes('UNDER')) {
            underOdds = this.americanToDecimal(bookData.odds);
            if (totalLine === 2.5) {
              under25Odds = underOdds;
            }
          }
        }
      }
    }
    
    return {
      eventId: event.eventID,
      leagueId: event.leagueID,
      homeTeam,
      awayTeam,
      startTime,
      homeOdds,
      drawOdds,
      awayOdds,
      over25Odds,
      under25Odds,
      spread,
      spreadHome,
      spreadAway,
      totalLine,
      overOdds,
      underOdds,
      bookmaker,
      updatedAt: new Date()
    };
  }
  
  /**
   * Convert American odds to decimal
   */
  private americanToDecimal(american: number): number {
    if (american >= 100) {
      return (american / 100) + 1;
    } else if (american <= -100) {
      return (100 / Math.abs(american)) + 1;
    }
    return american; // Already decimal
  }
}

export const sportsGameOddsService = new SportsGameOddsService();
