/**
 * Sports sync service — data ingestion (writes to cache).
 * Contains: syncDailyMatches, refreshHourlyOdds, syncMultiSportOdds, syncTeamStats
 */
import { db } from "../../db";
import { cachedMatches, cachedOdds, sportsSyncJobs, cachedTeamStats } from "@shared/schema";
import { eq, gte, lte, and, sql, inArray } from "drizzle-orm";
import { apiFootballService } from "../apiFootballService";
import { oddsApiService } from "../oddsApiService";
import { apiSportsOddsService } from "../apiSportsOddsService";
import { sportsGameOddsService } from "../sportsGameOddsService";
import { LEAGUES, getFootballLeagues } from "@shared/sportsConstants";
import type { SportsCacheQueries } from "./cacheQueries";

type CachedMatch = typeof cachedMatches.$inferSelect;

// Derived constants from shared config
const FOOTBALL_LEAGUES = getFootballLeagues().map(l => ({
    id: l.apiFootballId,
    name: l.name,
    country: l.country,
    sport: l.sport,
}));

const ODDS_LEAGUE_MAP: Record<string, string> = Object.fromEntries(
    LEAGUES.filter(l => l.sport === 'football').map(l => [l.name, l.oddsApiKey])
);

const MULTI_SPORT_ODDS_KEYS: Record<string, { sport: string; oddsKey: string; leagueName: string }[]> = {
    basketball: LEAGUES.filter(l => l.sport === 'basketball').map(l => ({ sport: l.sport, oddsKey: l.oddsApiKey, leagueName: l.name })),
    hockey: LEAGUES.filter(l => l.sport === 'hockey').map(l => ({ sport: l.sport, oddsKey: l.oddsApiKey, leagueName: l.name })),
    nfl: LEAGUES.filter(l => l.sport === 'american_football').map(l => ({ sport: l.sport, oddsKey: l.oddsApiKey, leagueName: l.name })),
};

export class SportsSyncService {
    constructor(private queries: SportsCacheQueries) { }

    async syncDailyMatches(): Promise<{ matchesProcessed: number; apiCallsUsed: number }> {
        console.log("[SPORTS-CACHE] Starting daily matches sync...");

        const job = await db.insert(sportsSyncJobs).values({
            jobType: "daily_sync",
            sport: "football",
            status: "running",
            startedAt: new Date(),
        }).returning();

        let matchesProcessed = 0;
        let apiCallsUsed = 0;

        try {
            const allTodayMatches = await apiFootballService.getTodayFootballMatches();
            apiCallsUsed++;

            const targetLeagueIds = FOOTBALL_LEAGUES.map(l => l.id);
            const filteredMatches = allTodayMatches.filter((m: Record<string, any>) =>
                targetLeagueIds.includes(m.league?.id)
            );

            console.log(`[SPORTS-CACHE] Got ${allTodayMatches.length} total matches, ${filteredMatches.length} from target leagues`);

            for (const fixture of filteredMatches) {
                const league = FOOTBALL_LEAGUES.find(l => l.id === fixture.league?.id);
                if (!league) continue;

                const existingMatch = await db.select()
                    .from(cachedMatches)
                    .where(eq(cachedMatches.externalId, String(fixture.fixture.id)))
                    .limit(1);

                const matchData = {
                    externalId: String(fixture.fixture.id),
                    sport: league.sport,
                    league: league.name,
                    leagueId: league.id,
                    country: league.country,
                    homeTeam: fixture.teams.home.name,
                    awayTeam: fixture.teams.away.name,
                    homeTeamId: fixture.teams.home.id,
                    awayTeamId: fixture.teams.away.id,
                    homeTeamLogo: fixture.teams.home.logo,
                    awayTeamLogo: fixture.teams.away.logo,
                    matchDate: new Date(fixture.fixture.date),
                    venue: (fixture.fixture as Record<string, any>).venue?.name || null,
                    status: fixture.fixture.status.short === "NS" ? "scheduled" :
                        fixture.fixture.status.short === "LIVE" ? "live" :
                            fixture.fixture.status.short === "FT" ? "finished" : "scheduled",
                    homeScore: fixture.goals?.home ?? null,
                    awayScore: fixture.goals?.away ?? null,
                    stats: {
                        round: (fixture.league as Record<string, any>).round || null,
                        referee: (fixture.fixture as Record<string, any>).referee || null,
                    },
                    updatedAt: new Date(),
                };

                if (existingMatch.length > 0) {
                    await db.update(cachedMatches)
                        .set(matchData)
                        .where(eq(cachedMatches.id, existingMatch[0].id));
                } else {
                    await db.insert(cachedMatches).values(matchData);
                }

                matchesProcessed++;
            }

            await db.update(sportsSyncJobs)
                .set({
                    status: "completed",
                    completedAt: new Date(),
                    matchesProcessed,
                    apiCallsUsed,
                })
                .where(eq(sportsSyncJobs.id, job[0].id));

            console.log(`[SPORTS-CACHE] Daily sync completed: ${matchesProcessed} matches, ${apiCallsUsed} API calls`);

        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error("[SPORTS-CACHE] Daily sync failed:", msg);
            await db.update(sportsSyncJobs)
                .set({
                    status: "failed",
                    completedAt: new Date(),
                    error: msg,
                    matchesProcessed,
                    apiCallsUsed,
                })
                .where(eq(sportsSyncJobs.id, job[0].id));
        }

        return { matchesProcessed, apiCallsUsed };
    }

    async refreshHourlyOdds(): Promise<{ oddsProcessed: number; apiCallsUsed: number }> {
        console.log("[SPORTS-CACHE] Starting hourly odds refresh...");

        const job = await db.insert(sportsSyncJobs).values({
            jobType: "hourly_odds",
            sport: "football",
            status: "running",
            startedAt: new Date(),
        }).returning();

        let oddsProcessed = 0;
        let apiCallsUsed = 0;

        try {
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date();
            endOfDay.setHours(23, 59, 59, 999);

            const todaysMatches = await db.select()
                .from(cachedMatches)
                .where(
                    and(
                        gte(cachedMatches.matchDate, startOfDay),
                        lte(cachedMatches.matchDate, endOfDay),
                        eq(cachedMatches.status, "scheduled")
                    )
                );

            console.log(`[SPORTS-CACHE] Found ${todaysMatches.length} matches to update odds for`);

            const leagueGroups: Record<string, typeof todaysMatches> = {};
            for (const match of todaysMatches) {
                if (!leagueGroups[match.league]) {
                    leagueGroups[match.league] = [];
                }
                leagueGroups[match.league].push(match);
            }

            let apiSportsSuccess = false;

            // STEP 1: API-Sports Odds
            if (apiSportsOddsService.isConfigured()) {
                console.log(`[SPORTS-CACHE] Trying API-Sports Odds first (primary source)...`);
                try {
                    const apiSportsOdds = await apiSportsOddsService.getOddsForMajorLeagues();
                    apiCallsUsed += 6;

                    if (apiSportsOdds.length > 0) {
                        console.log(`[SPORTS-CACHE] API-Sports returned ${apiSportsOdds.length} odds`);

                        for (const odds of apiSportsOdds) {
                            const matchingMatch = todaysMatches.find((m: CachedMatch) => m.externalId === String(odds.fixtureId));

                            if (matchingMatch) {
                                await db.delete(cachedOdds).where(eq(cachedOdds.matchId, matchingMatch.id));

                                await db.insert(cachedOdds).values({
                                    matchId: matchingMatch.id,
                                    externalMatchId: odds.fixtureId.toString(),
                                    bookmaker: odds.bookmaker,
                                    market: "h2h",
                                    homeOdds: odds.homeOdds,
                                    drawOdds: odds.drawOdds,
                                    awayOdds: odds.awayOdds,
                                    overOdds: odds.over25Odds,
                                    underOdds: odds.under25Odds,
                                    bttsYes: odds.bttsYes,
                                    bttsNo: odds.bttsNo,
                                    oddsData: { source: "api-sports" },
                                    fetchedAt: new Date(),
                                });

                                oddsProcessed++;
                            }
                        }

                        apiSportsSuccess = oddsProcessed > 0;
                        console.log(`[SPORTS-CACHE] API-Sports processed ${oddsProcessed} odds`);
                    }
                } catch (apiSportsError: unknown) {
                    const msg = apiSportsError instanceof Error ? apiSportsError.message : String(apiSportsError);
                    console.warn(`[SPORTS-CACHE] API-Sports Odds failed:`, msg);
                }
            }

            // STEP 2: SportsGameOdds fallback
            let sportsGameSuccess = false;
            if (!apiSportsSuccess && sportsGameOddsService.isConfigured()) {
                console.log(`[SPORTS-CACHE] Trying SportsGameOdds as fallback...`);
                try {
                    const sgoOdds = await sportsGameOddsService.getFootballOdds();
                    apiCallsUsed++;

                    if (sgoOdds.length > 0) {
                        console.log(`[SPORTS-CACHE] SportsGameOdds returned ${sgoOdds.length} football odds`);

                        for (const odds of sgoOdds) {
                            const matchingMatch = todaysMatches.find((m: CachedMatch) =>
                                m.homeTeam.toLowerCase().includes(odds.homeTeam.toLowerCase().split(" ")[0]) ||
                                odds.homeTeam.toLowerCase().includes(m.homeTeam.toLowerCase().split(" ")[0])
                            );

                            if (matchingMatch) {
                                await db.delete(cachedOdds).where(eq(cachedOdds.matchId, matchingMatch.id));

                                await db.insert(cachedOdds).values({
                                    matchId: matchingMatch.id,
                                    externalMatchId: odds.eventId,
                                    bookmaker: odds.bookmaker,
                                    market: "h2h",
                                    homeOdds: odds.homeOdds,
                                    drawOdds: odds.drawOdds,
                                    awayOdds: odds.awayOdds,
                                    overOdds: odds.over25Odds,
                                    underOdds: odds.under25Odds,
                                    bttsYes: null,
                                    bttsNo: null,
                                    oddsData: { source: "sportsgameodds", spread: odds.spread, totalLine: odds.totalLine },
                                    fetchedAt: new Date(),
                                });

                                oddsProcessed++;
                            }
                        }

                        sportsGameSuccess = oddsProcessed > 0;
                        console.log(`[SPORTS-CACHE] SportsGameOdds processed ${oddsProcessed} football odds`);
                    }
                } catch (sgoError: unknown) {
                    const msg = sgoError instanceof Error ? sgoError.message : String(sgoError);
                    console.warn(`[SPORTS-CACHE] SportsGameOdds failed:`, msg);
                }
            }

            // STEP 3: TheOddsAPI fallback
            if (!apiSportsSuccess && !sportsGameSuccess && oddsProcessed < todaysMatches.length / 2) {
                console.log(`[SPORTS-CACHE] Using TheOddsAPI as last fallback...`);

                for (const league of Object.keys(leagueGroups)) {
                    const matches = leagueGroups[league];
                    const oddsKey = ODDS_LEAGUE_MAP[league];
                    if (!oddsKey) continue;

                    const matchIds = matches.map((m: CachedMatch) => m.id);
                    const matchesWithOdds = await db.select({ count: sql<number>`count(*)` })
                        .from(cachedOdds)
                        .where(matchIds.length > 0 ? inArray(cachedOdds.matchId, matchIds) : sql`false`);

                    if (matchesWithOdds[0]?.count >= matches.length * 0.8) {
                        console.log(`[SPORTS-CACHE] Skipping ${league} - already have odds from API-Sports`);
                        continue;
                    }

                    if (apiCallsUsed > 0) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }

                    console.log(`[SPORTS-CACHE] Fetching odds for ${league} from TheOddsAPI...`);
                    let oddsResponse;
                    try {
                        oddsResponse = await oddsApiService.getOdds(oddsKey, { markets: "h2h,totals" });
                        apiCallsUsed++;
                    } catch (oddsError: unknown) {
                        const msg = oddsError instanceof Error ? oddsError.message : String(oddsError);
                        if (msg.includes("429") || msg.includes("rate") || msg.includes("OUT_OF_USAGE")) {
                            console.warn(`[SPORTS-CACHE] TheOddsAPI quota exceeded, continuing with API-Sports data`);
                            break;
                        }
                        console.error(`[SPORTS-CACHE] Error fetching ${league} odds:`, msg);
                        continue;
                    }

                    if (oddsResponse?.data) {
                        for (const oddsEvent of oddsResponse.data) {
                            const matchingMatch = matches.find((m: CachedMatch) =>
                                m.homeTeam.toLowerCase().includes(oddsEvent.home_team.toLowerCase().split(" ")[0]) ||
                                oddsEvent.home_team.toLowerCase().includes(m.homeTeam.toLowerCase().split(" ")[0])
                            );

                            if (matchingMatch && oddsEvent.bookmakers?.length > 0) {
                                const existingOdds = await db.select().from(cachedOdds)
                                    .where(eq(cachedOdds.matchId, matchingMatch.id)).limit(1);

                                if (existingOdds.length === 0) {
                                    for (const bookmaker of oddsEvent.bookmakers.slice(0, 3)) {
                                        const h2hMarket = bookmaker.markets?.find((m: Record<string, any>) => m.key === "h2h");
                                        const totalsMarket = bookmaker.markets?.find((m: Record<string, any>) => m.key === "totals");

                                        if (h2hMarket) {
                                            const outcomes = h2hMarket.outcomes || [];
                                            const homeOdds = outcomes.find((o: Record<string, any>) => o.name === oddsEvent.home_team)?.price;
                                            const drawOdds = outcomes.find((o: Record<string, any>) => o.name === "Draw")?.price;
                                            const awayOdds = outcomes.find((o: Record<string, any>) => o.name === oddsEvent.away_team)?.price;

                                            let overOdds, underOdds;
                                            if (totalsMarket) {
                                                const totalsOutcomes = totalsMarket.outcomes || [];
                                                overOdds = totalsOutcomes.find((o: Record<string, any>) => o.name === "Over")?.price;
                                                underOdds = totalsOutcomes.find((o: Record<string, any>) => o.name === "Under")?.price;
                                            }

                                            await db.insert(cachedOdds).values({
                                                matchId: matchingMatch.id,
                                                externalMatchId: oddsEvent.id,
                                                bookmaker: bookmaker.title,
                                                market: "h2h",
                                                homeOdds,
                                                drawOdds,
                                                awayOdds,
                                                overOdds,
                                                underOdds,
                                                oddsData: { source: "theoddsapi", raw: bookmaker.markets },
                                                fetchedAt: new Date(),
                                            });

                                            oddsProcessed++;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            console.log(`[SPORTS-CACHE] Dual-API odds refresh: API-Sports=${apiSportsSuccess ? 'OK' : 'FALLBACK'}, total=${oddsProcessed} odds`);

            await db.update(sportsSyncJobs)
                .set({
                    status: "completed",
                    completedAt: new Date(),
                    oddsProcessed,
                    apiCallsUsed,
                })
                .where(eq(sportsSyncJobs.id, job[0].id));

            console.log(`[SPORTS-CACHE] Hourly odds refresh completed: ${oddsProcessed} odds, ${apiCallsUsed} API calls`);

        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            const finalStatus = oddsProcessed > 0 ? "partial_success" : "failed";
            console.error(`[SPORTS-CACHE] Hourly odds refresh ${finalStatus}:`, msg);
            await db.update(sportsSyncJobs)
                .set({
                    status: finalStatus,
                    completedAt: new Date(),
                    error: msg,
                    oddsProcessed,
                    apiCallsUsed,
                })
                .where(eq(sportsSyncJobs.id, job[0].id));
        }

        return { oddsProcessed, apiCallsUsed };
    }

    async syncMultiSportOdds(): Promise<{ matchesCreated: number; oddsProcessed: number; apiCallsUsed: number }> {
        console.log("[SPORTS-CACHE] Starting multi-sport odds sync (NBA, NHL, NFL)...");

        let matchesCreated = 0;
        let oddsProcessed = 0;
        let apiCallsUsed = 0;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // STEP 1: SportsGameOdds first
        if (sportsGameOddsService.isConfigured()) {
            console.log("[SPORTS-CACHE] Trying SportsGameOdds for multi-sport...");
            try {
                const allOdds = await sportsGameOddsService.getAllSportsOdds();
                apiCallsUsed += 4;

                const sportDataMap: Record<string, { odds: typeof allOdds.nba; sport: string; league: string }> = {
                    nba: { odds: allOdds.nba, sport: "basketball", league: "NBA" },
                    nhl: { odds: allOdds.nhl, sport: "hockey", league: "NHL" },
                    nfl: { odds: allOdds.nfl, sport: "americanfootball", league: "NFL" },
                };

                for (const [key, config] of Object.entries(sportDataMap)) {
                    if (config.odds.length === 0) continue;

                    console.log(`[SPORTS-CACHE] SportsGameOdds: ${config.odds.length} ${config.league} events found`);

                    for (const event of config.odds) {
                        const eventDate = new Date(event.startTime);
                        if (eventDate < today || eventDate >= tomorrow) continue;

                        const existing = await db.select()
                            .from(cachedMatches)
                            .where(and(
                                eq(cachedMatches.externalId, event.eventId),
                                eq(cachedMatches.sport, config.sport)
                            ))
                            .limit(1);

                        let matchId: number;

                        if (existing.length === 0) {
                            const [newMatch] = await db.insert(cachedMatches).values({
                                externalId: event.eventId,
                                sport: config.sport,
                                league: config.league,
                                leagueId: null,
                                country: "USA",
                                homeTeam: event.homeTeam,
                                awayTeam: event.awayTeam,
                                matchDate: eventDate,
                                status: "scheduled",
                                venue: null,
                                round: null,
                                homeTeamId: null,
                                awayTeamId: null,
                                matchData: { source: "sportsgameodds" },
                            }).returning();

                            matchId = newMatch.id;
                            matchesCreated++;
                        } else {
                            matchId = existing[0].id;
                        }

                        await db.delete(cachedOdds).where(eq(cachedOdds.matchId, matchId));
                        await db.insert(cachedOdds).values({
                            matchId,
                            externalMatchId: event.eventId,
                            bookmaker: event.bookmaker,
                            market: "h2h",
                            homeOdds: event.homeOdds,
                            drawOdds: event.drawOdds,
                            awayOdds: event.awayOdds,
                            overOdds: event.overOdds || null,
                            underOdds: event.underOdds || null,
                            bttsYes: null,
                            bttsNo: null,
                            oddsData: {
                                source: "sportsgameodds",
                                spread: event.spread,
                                spreadHome: event.spreadHome,
                                spreadAway: event.spreadAway,
                                totalLine: event.totalLine
                            },
                            fetchedAt: new Date(),
                        });

                        oddsProcessed++;
                    }
                }

                if (oddsProcessed > 0) {
                    console.log(`[SPORTS-CACHE] SportsGameOdds processed ${oddsProcessed} multi-sport odds`);
                    return { matchesCreated, oddsProcessed, apiCallsUsed };
                }
            } catch (sgoError: unknown) {
                const msg = sgoError instanceof Error ? sgoError.message : String(sgoError);
                console.warn(`[SPORTS-CACHE] SportsGameOdds multi-sport failed:`, msg);
            }
        }

        // STEP 2: TheOddsAPI fallback
        console.log("[SPORTS-CACHE] Falling back to TheOddsAPI for multi-sport...");

        for (const [sportKey, leagues] of Object.entries(MULTI_SPORT_ODDS_KEYS)) {
            for (const leagueConfig of leagues) {
                try {
                    console.log(`[SPORTS-CACHE] Fetching ${leagueConfig.leagueName} events...`);

                    const oddsResponse = await oddsApiService.getOdds(leagueConfig.oddsKey, {
                        markets: "h2h,spreads,totals"
                    });
                    apiCallsUsed++;

                    if (!oddsResponse?.data?.length) {
                        console.log(`[SPORTS-CACHE] No ${leagueConfig.leagueName} events found`);
                        continue;
                    }

                    for (const event of oddsResponse.data) {
                        const eventDate = new Date(event.commence_time);
                        if (eventDate < today || eventDate >= tomorrow) continue;

                        const existing = await db.select()
                            .from(cachedMatches)
                            .where(
                                and(
                                    eq(cachedMatches.externalId, event.id),
                                    eq(cachedMatches.sport, leagueConfig.sport)
                                )
                            )
                            .limit(1);

                        let matchId: number;

                        if (existing.length === 0) {
                            const [newMatch] = await db.insert(cachedMatches).values({
                                externalId: event.id,
                                sport: leagueConfig.sport,
                                league: leagueConfig.leagueName,
                                leagueId: null,
                                country: "USA",
                                homeTeam: event.home_team,
                                awayTeam: event.away_team,
                                matchDate: eventDate,
                                status: "scheduled",
                                venue: null,
                                round: null,
                                homeTeamId: null,
                                awayTeamId: null,
                                matchData: { oddsApiEvent: event },
                            }).returning();

                            matchId = newMatch.id;
                            matchesCreated++;
                        } else {
                            matchId = existing[0].id;
                        }

                        if (event.bookmakers?.length > 0) {
                            await db.delete(cachedOdds).where(eq(cachedOdds.matchId, matchId));

                            for (const bookmaker of event.bookmakers.slice(0, 3)) {
                                const h2hMarket = bookmaker.markets?.find((m: Record<string, any>) => m.key === "h2h");
                                const spreadsMarket = bookmaker.markets?.find((m: Record<string, any>) => m.key === "spreads");
                                const totalsMarket = bookmaker.markets?.find((m: Record<string, any>) => m.key === "totals");

                                if (h2hMarket) {
                                    const outcomes = h2hMarket.outcomes || [];
                                    const homeOdds = outcomes.find((o: Record<string, any>) => o.name === event.home_team)?.price;
                                    const awayOdds = outcomes.find((o: Record<string, any>) => o.name === event.away_team)?.price;

                                    let overOdds, underOdds, spreadHome, spreadAway;

                                    if (totalsMarket) {
                                        const totalsOutcomes = totalsMarket.outcomes || [];
                                        overOdds = totalsOutcomes.find((o: Record<string, any>) => o.name === "Over")?.price;
                                        underOdds = totalsOutcomes.find((o: Record<string, any>) => o.name === "Under")?.price;
                                    }

                                    if (spreadsMarket) {
                                        const spreadsOutcomes = spreadsMarket.outcomes || [];
                                        spreadHome = spreadsOutcomes.find((o: Record<string, any>) => o.name === event.home_team)?.point;
                                        spreadAway = spreadsOutcomes.find((o: Record<string, any>) => o.name === event.away_team)?.point;
                                    }

                                    await db.insert(cachedOdds).values({
                                        matchId,
                                        externalMatchId: event.id,
                                        bookmaker: bookmaker.title,
                                        market: "h2h",
                                        homeOdds,
                                        awayOdds,
                                        drawOdds: null,
                                        overOdds,
                                        underOdds,
                                        oddsData: {
                                            raw: bookmaker.markets,
                                            spreadHome,
                                            spreadAway,
                                            sport: leagueConfig.sport,
                                        },
                                        fetchedAt: new Date(),
                                    });

                                    oddsProcessed++;
                                }
                            }
                        }
                    }

                    await new Promise(resolve => setTimeout(resolve, 1000));

                } catch (error: unknown) {
                    const msg = error instanceof Error ? error.message : String(error);
                    console.error(`[SPORTS-CACHE] Error syncing ${leagueConfig.leagueName}:`, msg);
                }
            }
        }

        console.log(`[SPORTS-CACHE] Multi-sport sync completed: ${matchesCreated} matches, ${oddsProcessed} odds, ${apiCallsUsed} API calls`);
        return { matchesCreated, oddsProcessed, apiCallsUsed };
    }

    async syncTeamStats(): Promise<{ teamsProcessed: number; apiCallsUsed: number }> {
        console.log("[SPORTS-CACHE] Starting team stats sync...");

        const job = await db.insert(sportsSyncJobs).values({
            jobType: "stats_sync",
            sport: "football",
            status: "running",
            startedAt: new Date(),
        }).returning();

        let teamsProcessed = 0;
        let apiCallsUsed = 0;

        try {
            const todaysMatches = await this.queries.getMatchesForDate(new Date());
            console.log(`[SPORTS-CACHE] Syncing stats for ${todaysMatches.length} matches`);

            const teamsToSync = new Map<number, { teamId: number; teamName: string; league: string; leagueId: number | null }>();

            for (const match of todaysMatches) {
                if (match.homeTeamId) {
                    teamsToSync.set(match.homeTeamId, {
                        teamId: match.homeTeamId,
                        teamName: match.homeTeam,
                        league: match.league,
                        leagueId: match.leagueId
                    });
                }
                if (match.awayTeamId) {
                    teamsToSync.set(match.awayTeamId, {
                        teamId: match.awayTeamId,
                        teamName: match.awayTeam,
                        league: match.league,
                        leagueId: match.leagueId
                    });
                }
            }

            console.log(`[SPORTS-CACHE] ${teamsToSync.size} unique teams to sync (using stored team IDs)`);

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            for (const [teamId, teamInfo] of Array.from(teamsToSync.entries())) {
                const existingStats = await db.select()
                    .from(cachedTeamStats)
                    .where(eq(cachedTeamStats.teamId, teamId))
                    .limit(1);

                if (existingStats.length > 0 && existingStats[0].lastUpdated && existingStats[0].lastUpdated >= today) {
                    console.log(`[SPORTS-CACHE] Skipping ${teamInfo.teamName} (already synced today)`);
                    continue;
                }

                if (apiCallsUsed >= 85) {
                    console.warn("[SPORTS-CACHE] Approaching API limit, stopping stats sync");
                    break;
                }

                await new Promise(resolve => setTimeout(resolve, 150));

                const stats = await apiFootballService.getTeamStats(teamId, 10);
                apiCallsUsed++;

                if (!stats) {
                    console.log(`[SPORTS-CACHE] No stats for ${teamInfo.teamName} (ID: ${teamId})`);
                    continue;
                }

                const statsData = {
                    teamId: teamId,
                    teamName: teamInfo.teamName,
                    league: teamInfo.league,
                    leagueId: teamInfo.leagueId,
                    formString: stats.formString,
                    last10Wins: stats.last10Wins,
                    last10Draws: stats.last10Draws,
                    last10Losses: stats.last10Losses,
                    goalsForAvg: stats.goalsForAvg,
                    goalsAgainstAvg: stats.goalsAgainstAvg,
                    over25Rate: stats.over25Rate,
                    bttsRate: stats.bttsRate,
                    cleanSheetRate: stats.cleanSheetRate,
                    failedToScoreRate: stats.failedToScoreRate,
                    homeGoalsForAvg: stats.homeGoalsForAvg,
                    homeGoalsAgainstAvg: stats.homeGoalsAgainstAvg,
                    homeOver25Rate: stats.homeOver25Rate,
                    homeBttsRate: stats.homeBttsRate,
                    awayGoalsForAvg: stats.awayGoalsForAvg,
                    awayGoalsAgainstAvg: stats.awayGoalsAgainstAvg,
                    awayOver25Rate: stats.awayOver25Rate,
                    awayBttsRate: stats.awayBttsRate,
                    matchesSampled: stats.matchesSampled,
                    lastUpdated: new Date(),
                };

                if (existingStats.length > 0) {
                    await db.update(cachedTeamStats)
                        .set(statsData)
                        .where(eq(cachedTeamStats.id, existingStats[0].id));
                } else {
                    await db.insert(cachedTeamStats).values(statsData);
                }

                teamsProcessed++;
                console.log(`[SPORTS-CACHE] Synced ${teamInfo.teamName}: ${stats.formString} (${stats.goalsForAvg} buts/match)`);
            }

            await db.update(sportsSyncJobs)
                .set({
                    status: "completed",
                    completedAt: new Date(),
                    matchesProcessed: teamsProcessed,
                    apiCallsUsed,
                })
                .where(eq(sportsSyncJobs.id, job[0].id));

            console.log(`[SPORTS-CACHE] Team stats sync completed: ${teamsProcessed} teams, ${apiCallsUsed} API calls`);

        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            const finalStatus = teamsProcessed > 0 ? "partial_success" : "failed";
            console.error(`[SPORTS-CACHE] Team stats sync ${finalStatus}:`, msg);
            await db.update(sportsSyncJobs)
                .set({
                    status: finalStatus,
                    completedAt: new Date(),
                    error: msg,
                    matchesProcessed: teamsProcessed,
                    apiCallsUsed,
                })
                .where(eq(sportsSyncJobs.id, job[0].id));
        }

        return { teamsProcessed, apiCallsUsed };
    }
}
