/**
 * Unified Search Router
 * 
 * Central entry point for ALL search operations in Ulysse.
 * Routes queries to the appropriate search backend based on query type:
 * 
 * - MARS (Multi-source Accurate Research System) → General knowledge queries
 * - Sports Data Services → Sports-specific queries
 * - WebSearch (Serper) → Simple web lookups
 * - Brave → Fallback/privacy-focused searches
 * 
 * This eliminates the dual-path problem where some services call MARS
 * and others call searchWeb directly, causing inconsistent results.
 */

import { searchWeb, WebSearchResponse, formatSearchResultsForAI } from "./websearch";

// Types
export type SearchDomain = 'general' | 'sports' | 'trading' | 'weather' | 'restaurant' | 'code' | 'news';

export interface UnifiedSearchOptions {
    query: string;
    domain?: SearchDomain;
    maxResults?: number;
    userId?: number;
    useCache?: boolean;
    forceMars?: boolean;
}

export interface UnifiedSearchResult {
    query: string;
    domain: SearchDomain;
    engine: string;
    results: Array<{
        title: string;
        url: string;
        snippet: string;
        score?: number;
    }>;
    directAnswer?: string;
    fromCache: boolean;
    durationMs: number;
}

// Domain detection patterns
const DOMAIN_PATTERNS: Record<SearchDomain, RegExp> = {
    sports: /\b(football|match|ligue|classement|score|goal|pronos|cote|bookmaker|pari|nfl|nba|basket|hockey|premier league|la liga|serie a|bundesliga|champions league|résultat)/i,
    trading: /\b(trading|bourse|crypto|bitcoin|action|marché|cours|cac40|nasdaq|sp500|investir|dividende)/i,
    weather: /\b(météo|weather|température|pluie|vent|soleil|prévision|forecast)/i,
    restaurant: /\b(sugu|restaurant|cuisine|recette|ingrédient|menu|plat|commande)/i,
    code: /\b(code|développ|api|react|typescript|python|fonction|bug|error|npm|package)/i,
    news: /\b(actualité|news|dernières nouvelles|breaking|info|journal)/i,
    general: /.*/, // Catch-all
};

/**
 * Detect the domain of a search query
 */
export function detectSearchDomain(query: string): SearchDomain {
    for (const [domain, pattern] of Object.entries(DOMAIN_PATTERNS)) {
        if (domain === 'general') continue; // Skip catch-all
        if (pattern.test(query)) {
            return domain as SearchDomain;
        }
    }
    return 'general';
}

/**
 * Main unified search function.
 * Routes to the appropriate backend based on query domain.
 */
export async function unifiedSearch(options: UnifiedSearchOptions): Promise<UnifiedSearchResult> {
    const start = Date.now();
    const domain = options.domain || detectSearchDomain(options.query);
    const maxResults = options.maxResults || 5;

    try {
        // Route based on domain
        switch (domain) {
            case 'sports':
                return await searchSportsDomain(options.query, maxResults, start);

            case 'trading':
                // Trading queries benefit from MARS's multi-source validation
                return await searchViaMars(options.query, maxResults, start, 'trading');

            case 'weather':
                // Weather has its own dedicated service
                return await searchWeatherDomain(options.query, start);

            case 'general':
            case 'news':
            case 'code':
            case 'restaurant':
            default:
                // Use MARS for general queries if available, fallback to direct search
                if (options.forceMars !== false) {
                    return await searchViaMars(options.query, maxResults, start, domain);
                }
                return await searchDirect(options.query, maxResults, start, domain);
        }
    } catch (error) {
        // Fallback: always try direct search if MARS/specialized fails
        console.warn(`[UnifiedSearch] ${domain} search failed, falling back to direct:`,
            error instanceof Error ? error.message : error
        );
        return await searchDirect(options.query, maxResults, start, domain);
    }
}

/**
 * Search via MARS (dynamic import to avoid circular deps)
 */
async function searchViaMars(
    query: string,
    maxResults: number,
    start: number,
    domain: SearchDomain
): Promise<UnifiedSearchResult> {
    try {
        const { orchestrateSearch } = await import("./searchOrchestrator");
        const marsResult = await orchestrateSearch(query, maxResults);

        return {
            query,
            domain,
            engine: 'mars',
            results: marsResult.results.map(r => ({
                title: r.title,
                url: r.url,
                snippet: r.snippet,
                score: r.score,
            })),
            directAnswer: marsResult.directAnswers?.[0]?.answer,
            fromCache: marsResult.cacheHit,
            durationMs: Date.now() - start,
        };
    } catch (error) {
        // MARS not available, fall back
        return searchDirect(query, maxResults, start, domain);
    }
}

/**
 * Direct web search (Serper/Google)
 */
async function searchDirect(
    query: string,
    maxResults: number,
    start: number,
    domain: SearchDomain
): Promise<UnifiedSearchResult> {
    const webResult = await searchWeb(query, maxResults);

    return {
        query,
        domain,
        engine: 'serper',
        results: webResult.results.map(r => ({
            title: r.title,
            url: r.url,
            snippet: r.snippet,
        })),
        fromCache: false,
        durationMs: Date.now() - start,
    };
}

/**
 * Sports-specific search routing
 */
async function searchSportsDomain(
    query: string,
    maxResults: number,
    start: number
): Promise<UnifiedSearchResult> {
    try {
        // Try sports cache first
        const { sportsCacheService } = await import("./sportsCacheService");

        // Check if it's a match/score query
        if (/score|résultat|match.*aujourd/i.test(query)) {
            const todayMatches = await sportsCacheService.getMatchesForDate(new Date());
            if (todayMatches.length > 0) {
                return {
                    query,
                    domain: 'sports',
                    engine: 'sportsCache',
                    results: todayMatches.slice(0, maxResults).map((m: any) => ({
                        title: `${m.homeTeam} vs ${m.awayTeam}`,
                        url: '',
                        snippet: `${m.homeScore ?? '?'} - ${m.awayScore ?? '?'} | ${m.status || 'scheduled'}`,
                        score: 1.0,
                    })),
                    fromCache: true,
                    durationMs: Date.now() - start,
                };
            }
        }

        // Check if it's a rankings query
        if (/classement|ranking|standings/i.test(query)) {
            // Try sportsWatchService verified data
            const { sportsWatchService } = await import("./sportsWatchService");
            const lastResults = Array.from(sportsWatchService.getLastRunResults().values());
            if (lastResults.length > 0) {
                return {
                    query,
                    domain: 'sports',
                    engine: 'sportsWatch',
                    results: lastResults.filter((r: any) => r.verified).slice(0, maxResults).map((r: any) => ({
                        title: `${r.league} - ${r.type}`,
                        url: '',
                        snippet: `${r.itemCount} items (verified)`,
                        score: 1.0,
                    })),
                    fromCache: true,
                    durationMs: Date.now() - start,
                };
            }
        }
    } catch (e) {
        console.warn('[UnifiedSearchRouter] sports service unavailable:', e instanceof Error ? e.message : e);
    }

    // Fallback to MARS for sports queries
    return searchViaMars(query, maxResults, start, 'sports');
}

/**
 * Weather-specific routing
 */
async function searchWeatherDomain(
    query: string,
    start: number
): Promise<UnifiedSearchResult> {
    try {
        const { fetchMarseilleData } = await import("./marseilleWeather");
        const weather = await fetchMarseilleData();

        if (weather) {
            return {
                query,
                domain: 'weather',
                engine: 'marseilleWeather',
                results: [{
                    title: `Météo Marseille`,
                    url: '',
                    snippet: `${weather.weather?.temperature || 'N/A'}, ${weather.weather?.condition || 'N/A'}`,
                    score: 1.0,
                }],
                fromCache: false,
                durationMs: Date.now() - start,
            };
        }
    } catch (e) {
        console.warn('[UnifiedSearchRouter] weather service unavailable:', e instanceof Error ? e.message : e);
    }

    return searchDirect(query, 3, start, 'weather');
}

/**
 * Format unified search results for AI context injection
 */
export function formatUnifiedResultsForAI(result: UnifiedSearchResult): string {
    const lines = [`[Search: ${result.domain} via ${result.engine}]`];

    if (result.directAnswer) {
        lines.push(`Direct answer: ${result.directAnswer}`);
    }

    for (const r of result.results) {
        lines.push(`- ${r.title}: ${r.snippet}${r.url ? ` (${r.url})` : ''}`);
    }

    return lines.join('\n');
}
