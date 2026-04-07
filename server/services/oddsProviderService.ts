/**
 * Unified Odds Provider Service
 * Consolidates 3 odds sources into a single facade with provider fallback chain:
 * 1. TheOddsAPI (free tier 500 req/month) — best for multi-sport coverage
 * 2. API-Sports/API-Football — best for football-specific odds
 * 3. SportsGameOdds — pay-per-event, good for US sports + spreads
 */

import { oddsApiService, type OddsEvent, type OddsScore } from './oddsApiService';
import { apiSportsOddsService, type ParsedOdds } from './apiSportsOddsService';
import { sportsGameOddsService, type SportsGameParsedOdds } from './sportsGameOddsService';

// ── Unified Types ────────────────────────────────────────────

export interface UnifiedOdds {
    id: string;
    source: 'the-odds-api' | 'api-sports' | 'sportsgameodds';
    homeTeam: string;
    awayTeam: string;
    league: string;
    startTime: Date;
    homeOdds: number | null;
    drawOdds: number | null;
    awayOdds: number | null;
    over25Odds: number | null;
    under25Odds: number | null;
    bttsYes: number | null;
    bttsNo: number | null;
    spread?: number;
    spreadHome?: number;
    spreadAway?: number;
    bookmaker: string;
    updatedAt: Date;
}

export interface OddsProviderStatus {
    name: string;
    configured: boolean;
    usage: Record<string, number>;
}

// ── League Mapping ───────────────────────────────────────────

const LEAGUE_MAP: Record<string, { oddsApi: string; apiSports: number; sgo: string }> = {
    ligue1: { oddsApi: 'soccer_france_ligue_one', apiSports: 61, sgo: 'LIGUE_1_FR' },
    premierleague: { oddsApi: 'soccer_epl', apiSports: 39, sgo: 'EPL' },
    laliga: { oddsApi: 'soccer_spain_la_liga', apiSports: 140, sgo: 'LA_LIGA' },
    bundesliga: { oddsApi: 'soccer_germany_bundesliga', apiSports: 78, sgo: 'BUNDESLIGA' },
    seriea: { oddsApi: 'soccer_italy_serie_a', apiSports: 135, sgo: 'SERIE_A_IT' },
    championsleague: { oddsApi: 'soccer_uefa_champs_league', apiSports: 2, sgo: 'UEFA_CHAMPIONS_LEAGUE' },
    europaleague: { oddsApi: 'soccer_uefa_europa_league', apiSports: 3, sgo: 'UEFA_EUROPA_LEAGUE' },
    nba: { oddsApi: 'basketball_nba', apiSports: 0, sgo: 'NBA' },
    nfl: { oddsApi: 'americanfootball_nfl', apiSports: 0, sgo: 'NFL' },
    nhl: { oddsApi: 'ice_hockey_nhl', apiSports: 0, sgo: 'NHL' },
    mlb: { oddsApi: 'baseball_mlb', apiSports: 0, sgo: 'MLB' },
};

// ── Normalizers ──────────────────────────────────────────────

function normalizeFromOddsApi(event: OddsEvent): UnifiedOdds {
    const bestBookmaker = event.bookmakers[0];
    const h2h = bestBookmaker?.markets.find(m => m.key === 'h2h');
    const totals = bestBookmaker?.markets.find(m => m.key === 'totals');

    const homeOutcome = h2h?.outcomes.find(o => o.name === event.home_team);
    const awayOutcome = h2h?.outcomes.find(o => o.name === event.away_team);
    const drawOutcome = h2h?.outcomes.find(o => o.name === 'Draw');

    const over25 = totals?.outcomes.find(o => o.name === 'Over' && o.point === 2.5);
    const under25 = totals?.outcomes.find(o => o.name === 'Under' && o.point === 2.5);

    return {
        id: event.id,
        source: 'the-odds-api',
        homeTeam: event.home_team,
        awayTeam: event.away_team,
        league: event.sport_title,
        startTime: new Date(event.commence_time),
        homeOdds: homeOutcome?.price ?? null,
        drawOdds: drawOutcome?.price ?? null,
        awayOdds: awayOutcome?.price ?? null,
        over25Odds: over25?.price ?? null,
        under25Odds: under25?.price ?? null,
        bttsYes: null,
        bttsNo: null,
        bookmaker: bestBookmaker?.title ?? 'Unknown',
        updatedAt: new Date(),
    };
}

function normalizeFromApiSports(odds: ParsedOdds, league: string): UnifiedOdds {
    return {
        id: `aps-${odds.fixtureId}`,
        source: 'api-sports',
        homeTeam: `Fixture ${odds.fixtureId}`, // API-Sports needs fixture ID lookup for names
        awayTeam: '',
        league,
        startTime: odds.updatedAt,
        homeOdds: odds.homeOdds,
        drawOdds: odds.drawOdds,
        awayOdds: odds.awayOdds,
        over25Odds: odds.over25Odds,
        under25Odds: odds.under25Odds,
        bttsYes: odds.bttsYes,
        bttsNo: odds.bttsNo,
        bookmaker: odds.bookmaker,
        updatedAt: odds.updatedAt,
    };
}

function normalizeFromSGO(odds: SportsGameParsedOdds): UnifiedOdds {
    return {
        id: odds.eventId,
        source: 'sportsgameodds',
        homeTeam: odds.homeTeam,
        awayTeam: odds.awayTeam,
        league: odds.leagueId,
        startTime: odds.startTime,
        homeOdds: odds.homeOdds,
        drawOdds: odds.drawOdds,
        awayOdds: odds.awayOdds,
        over25Odds: odds.over25Odds,
        under25Odds: odds.under25Odds,
        bttsYes: null,
        bttsNo: null,
        spread: odds.spread,
        spreadHome: odds.spreadHome,
        spreadAway: odds.spreadAway,
        bookmaker: odds.bookmaker,
        updatedAt: odds.updatedAt,
    };
}

// ── Unified Service ──────────────────────────────────────────

class OddsProviderService {
    /**
     * Get odds for a league with automatic provider fallback
     * Tries: TheOddsAPI → API-Sports → SportsGameOdds
     */
    async getOddsForLeague(leagueKey: string): Promise<UnifiedOdds[]> {
        const key = leagueKey.toLowerCase().replace(/[\s_-]/g, '');
        const mapping = LEAGUE_MAP[key];

        if (!mapping) {
            console.warn(`[OddsProvider] Unknown league: ${leagueKey}`);
            return [];
        }

        // Try provider 1: TheOddsAPI
        if (oddsApiService.isConfigured()) {
            try {
                const result = await oddsApiService.getOdds(mapping.oddsApi, {
                    markets: 'h2h,totals',
                    regions: 'eu,uk',
                });
                if (result.data.length > 0) {
                    console.log(`[OddsProvider] TheOddsAPI returned ${result.data.length} events for ${leagueKey}`);
                    return result.data.map(normalizeFromOddsApi);
                }
            } catch (e) {
                console.warn(`[OddsProvider] TheOddsAPI failed for ${leagueKey}:`, e instanceof Error ? e.message : e);
            }
        }

        // Try provider 2: API-Sports (football only)
        if (mapping.apiSports > 0 && apiSportsOddsService.isConfigured()) {
            try {
                const results = await apiSportsOddsService.getOddsForDate(new Date(), mapping.apiSports);
                if (results.length > 0) {
                    console.log(`[OddsProvider] API-Sports returned ${results.length} odds for ${leagueKey}`);
                    return results.map(o => normalizeFromApiSports(o, leagueKey));
                }
            } catch (e) {
                console.warn(`[OddsProvider] API-Sports failed for ${leagueKey}:`, e instanceof Error ? e.message : e);
            }
        }

        // Try provider 3: SportsGameOdds
        if (sportsGameOddsService.isConfigured()) {
            try {
                const results = await sportsGameOddsService.getEventsWithOdds([mapping.sgo]);
                if (results.length > 0) {
                    console.log(`[OddsProvider] SportsGameOdds returned ${results.length} events for ${leagueKey}`);
                    return results.map(normalizeFromSGO);
                }
            } catch (e) {
                console.warn(`[OddsProvider] SportsGameOdds failed for ${leagueKey}:`, e instanceof Error ? e.message : e);
            }
        }

        console.log(`[OddsProvider] No providers returned data for ${leagueKey}`);
        return [];
    }

    /**
     * Get odds for all major European football leagues
     */
    async getAllFootballOdds(): Promise<Record<string, UnifiedOdds[]>> {
        const footballLeagues = ['ligue1', 'premierleague', 'laliga', 'bundesliga', 'seriea', 'championsleague'];
        const results: Record<string, UnifiedOdds[]> = {};

        const promises = footballLeagues.map(async (league) => {
            results[league] = await this.getOddsForLeague(league);
        });

        await Promise.allSettled(promises);
        return results;
    }

    /**
     * Get odds for all sports with configured providers
     */
    async getAllSportsOdds(): Promise<Record<string, UnifiedOdds[]>> {
        const allLeagues = Object.keys(LEAGUE_MAP);
        const results: Record<string, UnifiedOdds[]> = {};

        // Sequential to avoid rate limiting
        for (const league of allLeagues) {
            results[league] = await this.getOddsForLeague(league);
        }

        return results;
    }

    /**
     * Get provider status and usage
     */
    getProviderStatus(): OddsProviderStatus[] {
        return [
            {
                name: 'TheOddsAPI',
                configured: oddsApiService.isConfigured(),
                usage: oddsApiService.getUsageStats(),
            },
            {
                name: 'API-Sports Odds',
                configured: apiSportsOddsService.isConfigured(),
                usage: apiSportsOddsService.getUsageStats(),
            },
            {
                name: 'SportsGameOdds',
                configured: sportsGameOddsService.isConfigured(),
                usage: sportsGameOddsService.getUsageStats(),
            },
        ];
    }

    /**
     * Summary for AI assistant
     */
    async getOddsSummaryForAI(sport?: string): Promise<string> {
        const leagues = sport
            ? [sport.toLowerCase().replace(/[\s_-]/g, '')]
            : ['ligue1', 'premierleague', 'nba'];

        const allOdds: UnifiedOdds[] = [];
        for (const league of leagues) {
            const odds = await this.getOddsForLeague(league);
            allOdds.push(...odds);
        }

        if (allOdds.length === 0) {
            return "Aucun match avec des cotes disponibles actuellement.";
        }

        const formatted = allOdds.slice(0, 8).map(o => {
            const drawStr = o.drawOdds ? ` / Nul: ${o.drawOdds.toFixed(2)}` : '';
            const date = o.startTime.toLocaleString('fr-FR', {
                weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
            });
            return `• ${o.homeTeam} vs ${o.awayTeam} (${date})\n  ${o.homeTeam} ${o.homeOdds?.toFixed(2) ?? '?'}${drawStr} / ${o.awayTeam} ${o.awayOdds?.toFixed(2) ?? '?'} [${o.bookmaker}, ${o.source}]`;
        });

        const status = this.getProviderStatus()
            .filter(p => p.configured)
            .map(p => p.name)
            .join(', ');

        return `Sources actives: ${status}\n\nCotes disponibles:\n${formatted.join('\n')}`;
    }
}

export const oddsProviderService = new OddsProviderService();

// Re-export individual services for backwards compatibility
export { oddsApiService } from './oddsApiService';
export { apiSportsOddsService } from './apiSportsOddsService';
export { sportsGameOddsService } from './sportsGameOddsService';
