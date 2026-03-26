/**
 * The Odds API Service
 * Provides real-time betting odds from bookmakers worldwide
 * Free tier: 500 requests/month
 * Documentation: https://the-odds-api.com/liveapi/guides/v4/
 */

export interface OddsSport {
  key: string;
  group: string;
  title: string;
  description: string;
  active: boolean;
  has_outrights: boolean;
}

export interface OddsBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsMarket[];
}

export interface OddsMarket {
  key: string;
  last_update: string;
  outcomes: OddsOutcome[];
}

export interface OddsOutcome {
  name: string;
  price: number;
  point?: number;
}

export interface OddsEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsBookmaker[];
}

export interface OddsScore {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: Array<{
    name: string;
    score: string;
  }> | null;
  last_update: string | null;
}

interface OddsApiResponse<T> {
  data: T;
  remaining_requests: number;
  used_requests: number;
}

class OddsApiService {
  private apiKey: string;
  private baseUrl = 'https://api.the-odds-api.com/v4';
  private remainingRequests: number = 500;
  private usedRequests: number = 0;

  constructor() {
    this.apiKey = process.env.ODDS_API_KEY || '';
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  getUsageStats(): { remaining: number; used: number } {
    return {
      remaining: this.remainingRequests,
      used: this.usedRequests
    };
  }

  private async fetch<T>(endpoint: string, params: Record<string, string> = {}): Promise<OddsApiResponse<T>> {
    if (!this.apiKey) {
      throw new Error('ODDS_API_KEY not configured');
    }

    const url = new URL(`${this.baseUrl}${endpoint}`);
    url.searchParams.set('apiKey', this.apiKey);
    
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    if (this.remainingRequests <= 0 && this.usedRequests > 0) {
      throw new Error("TheOddsAPI quota exhausted - skipping request");
    }
    
    console.log(`[OddsAPI] Fetching: ${endpoint}`);
    
    const response = await fetch(url.toString());
    
    // Track usage from headers
    const remaining = response.headers.get('x-requests-remaining');
    const used = response.headers.get('x-requests-used');
    
    if (remaining) this.remainingRequests = parseInt(remaining);
    if (used) this.usedRequests = parseInt(used);
    
    console.log(`[OddsAPI] Usage: ${this.usedRequests} used, ${this.remainingRequests} remaining`);

    if (!response.ok) {
      const error = await response.text();
      if (response.status === 401 && error.includes("OUT_OF_USAGE_CREDITS")) {
        this.remainingRequests = 0;
      }
      throw new Error(`Odds API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as T;
    
    return {
      data,
      remaining_requests: this.remainingRequests,
      used_requests: this.usedRequests
    };
  }

  /**
   * Get list of available sports
   */
  async getSports(all: boolean = false): Promise<OddsApiResponse<OddsSport[]>> {
    return this.fetch<OddsSport[]>('/sports', { all: all ? 'true' : 'false' });
  }

  /**
   * Get odds for a specific sport
   * @param sportKey - e.g., 'soccer_france_ligue_one', 'basketball_nba', 'americanfootball_nfl'
   * @param regions - Comma-separated: 'us', 'uk', 'eu', 'au'
   * @param markets - Comma-separated: 'h2h' (moneyline), 'spreads', 'totals'
   */
  async getOdds(
    sportKey: string,
    options: {
      regions?: string;
      markets?: string;
      oddsFormat?: 'decimal' | 'american';
      dateFormat?: 'iso' | 'unix';
    } = {}
  ): Promise<OddsApiResponse<OddsEvent[]>> {
    const params: Record<string, string> = {
      regions: options.regions || 'eu,uk',
      markets: options.markets || 'h2h',
      oddsFormat: options.oddsFormat || 'decimal',
      dateFormat: options.dateFormat || 'iso'
    };

    return this.fetch<OddsEvent[]>(`/sports/${sportKey}/odds`, params);
  }

  /**
   * Get live & upcoming scores
   * @param sportKey - Sport key
   * @param daysFrom - Number of days in past to include completed games (max 3)
   */
  async getScores(
    sportKey: string,
    daysFrom: number = 1
  ): Promise<OddsApiResponse<OddsScore[]>> {
    return this.fetch<OddsScore[]>(`/sports/${sportKey}/scores`, {
      daysFrom: String(Math.min(daysFrom, 3))
    });
  }

  /**
   * Get odds for a specific event
   */
  async getEventOdds(
    sportKey: string,
    eventId: string,
    options: {
      regions?: string;
      markets?: string;
      oddsFormat?: 'decimal' | 'american';
    } = {}
  ): Promise<OddsApiResponse<OddsEvent>> {
    const params: Record<string, string> = {
      regions: options.regions || 'eu,uk',
      markets: options.markets || 'h2h,spreads,totals',
      oddsFormat: options.oddsFormat || 'decimal'
    };

    return this.fetch<OddsEvent>(`/sports/${sportKey}/events/${eventId}/odds`, params);
  }

  // Convenience methods for popular sports

  async getLigue1Odds(): Promise<OddsApiResponse<OddsEvent[]>> {
    return this.getOdds('soccer_france_ligue_one', { markets: 'h2h,spreads,totals' });
  }

  async getPremierLeagueOdds(): Promise<OddsApiResponse<OddsEvent[]>> {
    return this.getOdds('soccer_epl', { markets: 'h2h,spreads,totals' });
  }

  async getChampionsLeagueOdds(): Promise<OddsApiResponse<OddsEvent[]>> {
    return this.getOdds('soccer_uefa_champs_league', { markets: 'h2h,spreads,totals' });
  }

  async getNBAOdds(): Promise<OddsApiResponse<OddsEvent[]>> {
    return this.getOdds('basketball_nba', { markets: 'h2h,spreads,totals' });
  }

  async getNFLOdds(): Promise<OddsApiResponse<OddsEvent[]>> {
    return this.getOdds('americanfootball_nfl', { markets: 'h2h,spreads,totals' });
  }

  async getMLBOdds(): Promise<OddsApiResponse<OddsEvent[]>> {
    return this.getOdds('baseball_mlb', { markets: 'h2h,spreads,totals' });
  }

  async getTennisOdds(): Promise<OddsApiResponse<OddsEvent[]>> {
    return this.getOdds('tennis_atp_french_open', { markets: 'h2h' });
  }

  async getUFCOdds(): Promise<OddsApiResponse<OddsEvent[]>> {
    return this.getOdds('mma_mixed_martial_arts', { markets: 'h2h' });
  }

  // European football leagues
  async getBundesligaOdds(): Promise<OddsApiResponse<OddsEvent[]>> {
    return this.getOdds('soccer_germany_bundesliga', { markets: 'h2h,spreads,totals' });
  }

  async getLaLigaOdds(): Promise<OddsApiResponse<OddsEvent[]>> {
    return this.getOdds('soccer_spain_la_liga', { markets: 'h2h,spreads,totals' });
  }

  async getSerieAOdds(): Promise<OddsApiResponse<OddsEvent[]>> {
    return this.getOdds('soccer_italy_serie_a', { markets: 'h2h,spreads,totals' });
  }

  async getEuropaLeagueOdds(): Promise<OddsApiResponse<OddsEvent[]>> {
    return this.getOdds('soccer_uefa_europa_league', { markets: 'h2h,spreads,totals' });
  }

  // Get all European football odds in one call
  async getAllEuropeanFootballOdds(): Promise<{
    ligue1: OddsEvent[];
    premierLeague: OddsEvent[];
    bundesliga: OddsEvent[];
    laLiga: OddsEvent[];
    serieA: OddsEvent[];
    championsLeague: OddsEvent[];
  }> {
    const [ligue1, pl, bundesliga, laLiga, serieA, ucl] = await Promise.all([
      this.getLigue1Odds().catch(() => ({ data: [] })),
      this.getPremierLeagueOdds().catch(() => ({ data: [] })),
      this.getBundesligaOdds().catch(() => ({ data: [] })),
      this.getLaLigaOdds().catch(() => ({ data: [] })),
      this.getSerieAOdds().catch(() => ({ data: [] })),
      this.getChampionsLeagueOdds().catch(() => ({ data: [] })),
    ]);
    return {
      ligue1: ligue1?.data || [],
      premierLeague: pl?.data || [],
      bundesliga: bundesliga?.data || [],
      laLiga: laLiga?.data || [],
      serieA: serieA?.data || [],
      championsLeague: ucl?.data || [],
    };
  }

  /**
   * Format odds for display
   */
  formatOddsForDisplay(event: OddsEvent): {
    match: string;
    date: string;
    bestOdds: { home: number; draw?: number; away: number; bookmaker: string } | null;
  } {
    const date = new Date(event.commence_time);
    const match = `${event.home_team} vs ${event.away_team}`;
    
    // Find best odds across bookmakers
    let bestOdds: { home: number; draw?: number; away: number; bookmaker: string } | null = null;
    
    for (const bookmaker of event.bookmakers) {
      const h2hMarket = bookmaker.markets.find(m => m.key === 'h2h');
      if (!h2hMarket) continue;
      
      const homeOutcome = h2hMarket.outcomes.find(o => o.name === event.home_team);
      const awayOutcome = h2hMarket.outcomes.find(o => o.name === event.away_team);
      const drawOutcome = h2hMarket.outcomes.find(o => o.name === 'Draw');
      
      if (homeOutcome && awayOutcome) {
        if (!bestOdds || homeOutcome.price > bestOdds.home) {
          bestOdds = {
            home: homeOutcome.price,
            draw: drawOutcome?.price,
            away: awayOutcome.price,
            bookmaker: bookmaker.title
          };
        }
      }
    }
    
    return {
      match,
      date: date.toLocaleString('fr-FR', { 
        weekday: 'short', 
        day: 'numeric', 
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      }),
      bestOdds
    };
  }

  /**
   * Get summary for AI assistant
   */
  async getOddsSummaryForAI(sportKey?: string): Promise<string> {
    if (!this.isConfigured()) {
      return "L'API Odds n'est pas configurée. Clé ODDS_API_KEY manquante.";
    }

    try {
      let events: OddsEvent[];
      
      if (sportKey) {
        const result = await this.getOdds(sportKey);
        events = result.data;
      } else {
        // Get popular sports
        const [ligue1, nba] = await Promise.all([
          this.getLigue1Odds().catch(() => ({ data: [] })),
          this.getNBAOdds().catch(() => ({ data: [] }))
        ]);
        events = [...ligue1.data, ...nba.data];
      }

      if (events.length === 0) {
        return "Aucun match avec des cotes disponibles actuellement.";
      }

      const formatted = events.slice(0, 5).map(e => {
        const display = this.formatOddsForDisplay(e);
        if (display.bestOdds) {
          const drawStr = display.bestOdds.draw ? ` / Nul: ${display.bestOdds.draw.toFixed(2)}` : '';
          return `• ${display.match} (${display.date})\n  Cotes: ${e.home_team} ${display.bestOdds.home.toFixed(2)}${drawStr} / ${e.away_team} ${display.bestOdds.away.toFixed(2)} (${display.bestOdds.bookmaker})`;
        }
        return `• ${display.match} (${display.date})`;
      });

      return `Cotes disponibles:\n${formatted.join('\n')}`;
    } catch (error) {
      console.error('[OddsAPI] Error getting summary:', error);
      return `Erreur lors de la récupération des cotes: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }
}

export const oddsApiService = new OddsApiService();
