/**
 * API-Sports Odds Service
 * Uses the same API key as API-Football (API_FOOTBALL_KEY)
 * Endpoint: /odds?fixture=ID
 * Documentation: https://api-sports.io/documentation/football/v3
 */

interface ApiSportsOddsBookmaker {
  id: number;
  name: string;
  bets: ApiSportsBet[];
}

interface ApiSportsBet {
  id: number;
  name: string;
  values: ApiSportsBetValue[];
}

interface ApiSportsBetValue {
  value: string;
  odd: string;
}

interface ApiSportsOddsResponse {
  fixture: {
    id: number;
    date: string;
  };
  league: {
    id: number;
    name: string;
    country: string;
  };
  bookmakers: ApiSportsOddsBookmaker[];
}

export interface ParsedOdds {
  fixtureId: number;
  homeOdds: number | null;
  drawOdds: number | null;
  awayOdds: number | null;
  over25Odds: number | null;
  under25Odds: number | null;
  bttsYes: number | null;
  bttsNo: number | null;
  bookmaker: string;
  updatedAt: Date;
}

class ApiSportsOddsService {
  private apiKey: string;
  private baseUrl = 'https://v3.football.api-sports.io';
  private requestsRemaining: number = 100;
  
  constructor() {
    this.apiKey = process.env.API_FOOTBALL_KEY || '';
  }
  
  isConfigured(): boolean {
    return !!this.apiKey;
  }
  
  getUsageStats(): { remaining: number } {
    return { remaining: this.requestsRemaining };
  }
  
  private async fetch<T>(endpoint: string, params: Record<string, string> = {}): Promise<T | null> {
    if (!this.apiKey) {
      console.error('[API-Sports-Odds] API_FOOTBALL_KEY not configured');
      return null;
    }
    
    const url = new URL(`${this.baseUrl}${endpoint}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    
    try {
      console.log(`[API-Sports-Odds] Fetching: ${endpoint}`);
      const response = await fetch(url.toString(), {
        headers: {
          'x-apisports-key': this.apiKey,
        }
      });
      
      // Track remaining requests from headers
      const remaining = response.headers.get('x-ratelimit-requests-remaining');
      if (remaining) {
        this.requestsRemaining = parseInt(remaining, 10);
      }
      
      if (!response.ok) {
        console.error(`[API-Sports-Odds] Error: ${response.status} - ${response.statusText}`);
        return null;
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('[API-Sports-Odds] Fetch error:', error);
      return null;
    }
  }
  
  /**
   * Get odds for a specific fixture
   */
  async getOddsForFixture(fixtureId: number): Promise<ParsedOdds | null> {
    const response = await this.fetch<{ response: ApiSportsOddsResponse[] }>('/odds', {
      fixture: fixtureId.toString()
    });
    
    if (!response?.response?.length) {
      return null;
    }
    
    const oddsData = response.response[0];
    return this.parseOdds(oddsData);
  }
  
  /**
   * Get odds for fixtures on a specific date
   */
  async getOddsForDate(date: Date, leagueId?: number): Promise<ParsedOdds[]> {
    const dateStr = date.toISOString().split('T')[0];
    const params: Record<string, string> = { date: dateStr };
    
    if (leagueId) {
      params.league = leagueId.toString();
      params.season = new Date().getFullYear().toString();
    }
    
    const response = await this.fetch<{ response: ApiSportsOddsResponse[] }>('/odds', params);
    
    if (!response?.response?.length) {
      return [];
    }
    
    const results: ParsedOdds[] = [];
    for (const oddsData of response.response) {
      const parsed = this.parseOdds(oddsData);
      if (parsed) {
        results.push(parsed);
      }
    }
    
    return results;
  }
  
  /**
   * Get odds for multiple leagues (Ligue 1, Premier League, La Liga, etc.)
   */
  async getOddsForMajorLeagues(): Promise<ParsedOdds[]> {
    const majorLeagues = [
      { id: 61, name: 'Ligue 1' },
      { id: 39, name: 'Premier League' },
      { id: 140, name: 'La Liga' },
      { id: 78, name: 'Bundesliga' },
      { id: 135, name: 'Serie A' },
      { id: 2, name: 'Champions League' }
    ];
    
    const allOdds: ParsedOdds[] = [];
    const today = new Date();
    
    for (const league of majorLeagues) {
      try {
        const odds = await this.getOddsForDate(today, league.id);
        console.log(`[API-Sports-Odds] ${league.name}: ${odds.length} odds found`);
        allOdds.push(...odds);
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.error(`[API-Sports-Odds] Error fetching ${league.name}:`, error);
      }
    }
    
    return allOdds;
  }
  
  /**
   * Parse API-Sports odds response into our format
   */
  private parseOdds(oddsData: ApiSportsOddsResponse): ParsedOdds | null {
    if (!oddsData.bookmakers?.length) {
      return null;
    }
    
    // Prefer French bookmakers, then international ones
    const preferredBookmakers = ['Parions Sport', 'Unibet', 'Betclic', 'Winamax', 'Bet365', 'Pinnacle', '1xBet'];
    let selectedBookmaker = oddsData.bookmakers[0];
    
    for (const preferred of preferredBookmakers) {
      const found = oddsData.bookmakers.find(b => 
        b.name.toLowerCase().includes(preferred.toLowerCase())
      );
      if (found) {
        selectedBookmaker = found;
        break;
      }
    }
    
    const result: ParsedOdds = {
      fixtureId: oddsData.fixture.id,
      homeOdds: null,
      drawOdds: null,
      awayOdds: null,
      over25Odds: null,
      under25Odds: null,
      bttsYes: null,
      bttsNo: null,
      bookmaker: selectedBookmaker.name,
      updatedAt: new Date()
    };
    
    for (const bet of selectedBookmaker.bets) {
      const betName = bet.name.toLowerCase();
      
      // Match Winner (1X2)
      if (betName.includes('match winner') || betName === 'home/away' || betName === '1x2') {
        for (const val of bet.values) {
          const oddValue = parseFloat(val.odd);
          if (val.value.toLowerCase() === 'home' || val.value === '1') {
            result.homeOdds = oddValue;
          } else if (val.value.toLowerCase() === 'draw' || val.value === 'x' || val.value === 'X') {
            result.drawOdds = oddValue;
          } else if (val.value.toLowerCase() === 'away' || val.value === '2') {
            result.awayOdds = oddValue;
          }
        }
      }
      
      // Goals Over/Under 2.5
      if (betName.includes('goals over/under') || betName.includes('over/under')) {
        for (const val of bet.values) {
          const oddValue = parseFloat(val.odd);
          if (val.value.toLowerCase().includes('over 2.5')) {
            result.over25Odds = oddValue;
          } else if (val.value.toLowerCase().includes('under 2.5')) {
            result.under25Odds = oddValue;
          }
        }
      }
      
      // Both Teams To Score
      if (betName.includes('both teams') || betName.includes('btts')) {
        for (const val of bet.values) {
          const oddValue = parseFloat(val.odd);
          if (val.value.toLowerCase() === 'yes') {
            result.bttsYes = oddValue;
          } else if (val.value.toLowerCase() === 'no') {
            result.bttsNo = oddValue;
          }
        }
      }
    }
    
    return result;
  }
}

export const apiSportsOddsService = new ApiSportsOddsService();
