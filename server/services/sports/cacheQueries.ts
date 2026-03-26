/**
 * Sports cache read-only queries — no external API calls, DB reads only.
 */
import { db } from "../../db";
import { cachedMatches, cachedOdds, sportsSyncJobs, cachedTeamStats } from "@shared/schema";
import { eq, gte, lte, and, desc, sql } from "drizzle-orm";
import { getFootballLeagues } from "@shared/sportsConstants";
import { calculateBettingInterestScore, getInterestEmoji, type TeamStatsInput } from "./interestScoring";

// ── Types for return values (replacing `any`) ───────────────

type CachedMatch = typeof cachedMatches.$inferSelect;
type CachedTeamStat = typeof cachedTeamStats.$inferSelect;

export interface MatchWithOdds extends CachedMatch {
    odds: (typeof cachedOdds.$inferSelect)[];
    homeStats: CachedTeamStat | null;
    awayStats: CachedTeamStat | null;
    bettingInterest: number;
    interestFactors: string[];
    interestTags: string[];
    interestEmoji: string;
}

export interface TeamMatchResult {
    found: boolean;
    match?: CachedMatch;
    message: string;
}

const FOOTBALL_LEAGUE_IDS = getFootballLeagues().map(l => l.apiFootballId);

export class SportsCacheQueries {

    async getTeamStats(teamName: string): Promise<CachedTeamStat | null> {
        const stats = await db.select()
            .from(cachedTeamStats)
            .where(eq(cachedTeamStats.teamName, teamName))
            .limit(1);

        return stats[0] || null;
    }

    async getMatchesForDate(date: Date = new Date()): Promise<CachedMatch[]> {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        return db.select()
            .from(cachedMatches)
            .where(
                and(
                    gte(cachedMatches.matchDate, startOfDay),
                    lte(cachedMatches.matchDate, endOfDay)
                )
            )
            .orderBy(cachedMatches.matchDate);
    }

    async getUpcomingMatches(competition: string = 'Football', days: number = 7): Promise<{
        homeTeam: string;
        awayTeam: string;
        date: Date;
        league: string;
        odds: null;
    }[]> {
        const now = new Date();
        const endDate = new Date();
        endDate.setDate(now.getDate() + days);

        const leagueMap: Record<string, number[]> = {
            'Champions League': [2],
            'Europa League': [3],
            'Ligue 1': [61],
            'Premier League': [39],
            'La Liga': [140],
            'Serie A': [135],
            'Bundesliga': [78],
            'Football': FOOTBALL_LEAGUE_IDS
        };

        const leagueIds = leagueMap[competition] || leagueMap['Football'];

        // First try cache
        const cachedResult = await db.select()
            .from(cachedMatches)
            .where(
                and(
                    gte(cachedMatches.matchDate, now),
                    lte(cachedMatches.matchDate, endDate)
                )
            )
            .orderBy(cachedMatches.matchDate)
            .limit(30);

        const filtered = competition !== 'Football'
            ? cachedResult.filter((m: CachedMatch) => m.league?.toLowerCase().includes(competition.toLowerCase().split(' ')[0]))
            : cachedResult;

        if (filtered.length > 0) {
            console.log(`[SPORTS-CACHE] Found ${filtered.length} cached upcoming matches for ${competition}`);
            return filtered.map((m: CachedMatch) => ({
                homeTeam: m.homeTeam,
                awayTeam: m.awayTeam,
                date: m.matchDate,
                league: m.league,
                odds: null
            }));
        }

        // If cache empty, fetch from API-Football
        console.log(`[SPORTS-CACHE] Cache empty, fetching from API-Football for ${competition}`);
        try {
            const API_KEY = process.env.API_FOOTBALL_KEY;
            if (!API_KEY) {
                console.log(`[SPORTS-CACHE] No API-Football key available`);
                return [];
            }

            const fromDate = now.toISOString().split('T')[0];
            const toDate = endDate.toISOString().split('T')[0];

            const allMatches: { homeTeam: string; awayTeam: string; date: Date; league: string; odds: null }[] = [];
            for (const leagueId of leagueIds.slice(0, 2)) {
                const response = await fetch(
                    `https://v3.football.api-sports.io/fixtures?league=${leagueId}&season=2025&from=${fromDate}&to=${toDate}`,
                    {
                        headers: {
                            'x-rapidapi-key': API_KEY,
                            'x-rapidapi-host': 'v3.football.api-sports.io'
                        }
                    }
                );

                if (response.ok) {
                    const data = await response.json() as { response?: Array<{ teams?: { home?: { name?: string }; away?: { name?: string } }; fixture?: { date?: string }; league?: { name?: string } }> };
                    if (data.response) {
                        for (const match of data.response.slice(0, 15)) {
                            allMatches.push({
                                homeTeam: match.teams?.home?.name || 'Unknown',
                                awayTeam: match.teams?.away?.name || 'Unknown',
                                date: new Date(match.fixture?.date || Date.now()),
                                league: match.league?.name || competition,
                                odds: null
                            });
                        }
                    }
                }
            }

            console.log(`[SPORTS-CACHE] Fetched ${allMatches.length} matches from API-Football`);
            return allMatches;
        } catch (err) {
            console.error(`[SPORTS-CACHE] API-Football error:`, err);
            return [];
        }
    }

    async getMatchesWithOdds(date: Date = new Date()): Promise<MatchWithOdds[]> {
        const matches = await this.getMatchesForDate(date);

        const matchesWithOdds = await Promise.all(
            matches.map(async (match) => {
                const odds = await db.select()
                    .from(cachedOdds)
                    .where(eq(cachedOdds.matchId, match.id))
                    .orderBy(desc(cachedOdds.fetchedAt))
                    .limit(3);

                const [homeStats, awayStats] = await Promise.all([
                    this.getTeamStats(match.homeTeam),
                    this.getTeamStats(match.awayTeam)
                ]);

                const { score: bettingInterest, factors: interestFactors, tags } =
                    calculateBettingInterestScore(match, odds, homeStats as TeamStatsInput | null, awayStats as TeamStatsInput | null);

                return {
                    ...match,
                    odds,
                    homeStats,
                    awayStats,
                    bettingInterest,
                    interestFactors,
                    interestTags: tags,
                    interestEmoji: getInterestEmoji(bettingInterest)
                };
            })
        );

        return matchesWithOdds.sort((a, b) => b.bettingInterest - a.bettingInterest);
    }

    async getWeekMatches(): Promise<CachedMatch[]> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const weekFromNow = new Date();
        weekFromNow.setDate(today.getDate() + 7);

        return db.select()
            .from(cachedMatches)
            .where(
                and(
                    gte(cachedMatches.matchDate, today),
                    lte(cachedMatches.matchDate, weekFromNow)
                )
            )
            .orderBy(cachedMatches.matchDate);
    }

    async getLastSyncStatus() {
        return db.select()
            .from(sportsSyncJobs)
            .orderBy(desc(sportsSyncJobs.createdAt))
            .limit(5);
    }

    async getCacheStats(): Promise<{
        totalMatches: number;
        totalOdds: number;
        lastDailySync: Date | null;
        lastOddsRefresh: Date | null;
    }> {
        const matchCount = await db.select({ count: sql<number>`count(*)` })
            .from(cachedMatches);

        const oddsCount = await db.select({ count: sql<number>`count(*)` })
            .from(cachedOdds);

        const lastDaily = await db.select()
            .from(sportsSyncJobs)
            .where(eq(sportsSyncJobs.jobType, "daily_sync"))
            .orderBy(desc(sportsSyncJobs.completedAt))
            .limit(1);

        const lastHourly = await db.select()
            .from(sportsSyncJobs)
            .where(eq(sportsSyncJobs.jobType, "hourly_odds"))
            .orderBy(desc(sportsSyncJobs.completedAt))
            .limit(1);

        return {
            totalMatches: Number(matchCount[0]?.count || 0),
            totalOdds: Number(oddsCount[0]?.count || 0),
            lastDailySync: lastDaily[0]?.completedAt || null,
            lastOddsRefresh: lastHourly[0]?.completedAt || null,
        };
    }

    async getNextMatchForTeam(teamName: string): Promise<TeamMatchResult> {
        const normalizedTeam = teamName.toLowerCase().trim();
        const now = new Date();
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() + 7);

        const matches = await db.select()
            .from(cachedMatches)
            .where(
                and(
                    gte(cachedMatches.matchDate, now),
                    lte(cachedMatches.matchDate, endDate)
                )
            )
            .orderBy(cachedMatches.matchDate);

        const teamMatch = matches.find((m: CachedMatch) => {
            const home = (m.homeTeam || '').toLowerCase();
            const away = (m.awayTeam || '').toLowerCase();
            return home.includes(normalizedTeam) || away.includes(normalizedTeam) ||
                normalizedTeam.includes(home.split(' ')[0]) || normalizedTeam.includes(away.split(' ')[0]);
        });

        if (teamMatch) {
            const matchDate = new Date(teamMatch.matchDate);
            const dateStr = matchDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
            const timeStr = matchDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

            return {
                found: true,
                match: teamMatch,
                message: `Le prochain match de ${teamName} est ${teamMatch.homeTeam} vs ${teamMatch.awayTeam} le ${dateStr} à ${timeStr} (${teamMatch.league}).`
            };
        }

        return { found: false, message: `Aucun match trouvé pour ${teamName} dans les 7 prochains jours.` };
    }

    async getRecentMatchScore(teamName: string): Promise<TeamMatchResult> {
        const normalizedTeam = teamName.toLowerCase().trim();
        const now = new Date();
        const startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 3);

        const matches = await db.select()
            .from(cachedMatches)
            .where(
                and(
                    lte(cachedMatches.matchDate, now),
                    gte(cachedMatches.matchDate, startDate)
                )
            )
            .orderBy(desc(cachedMatches.matchDate));

        const teamMatch = matches.find((m: CachedMatch) => {
            const home = (m.homeTeam || '').toLowerCase();
            const away = (m.awayTeam || '').toLowerCase();
            const hasScore = m.homeScore !== null && m.awayScore !== null;
            const isTeam = home.includes(normalizedTeam) || away.includes(normalizedTeam) ||
                normalizedTeam.includes(home.split(' ')[0]) || normalizedTeam.includes(away.split(' ')[0]);
            return isTeam && hasScore;
        });

        if (teamMatch) {
            const matchDate = new Date(teamMatch.matchDate);
            const dateStr = matchDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

            return {
                found: true,
                match: teamMatch,
                message: `${teamMatch.homeTeam} ${teamMatch.homeScore} - ${teamMatch.awayScore} ${teamMatch.awayTeam} (${dateStr}, ${teamMatch.league}).`
            };
        }

        return { found: false, message: `Aucun score récent trouvé pour ${teamName}.` };
    }

    async queryTeamInfo(teamName: string, queryType: 'next' | 'score' | 'both' = 'both'): Promise<string> {
        let response = '';

        if (queryType === 'next' || queryType === 'both') {
            const nextMatch = await this.getNextMatchForTeam(teamName);
            if (nextMatch.found) {
                response += `📅 ${nextMatch.message}\n`;
            } else if (queryType === 'next') {
                response = nextMatch.message;
            }
        }

        if (queryType === 'score' || queryType === 'both') {
            const recentScore = await this.getRecentMatchScore(teamName);
            if (recentScore.found) {
                response += `⚽ Dernier résultat: ${recentScore.message}`;
            } else if (queryType === 'score') {
                response = recentScore.message;
            }
        }

        return response.trim() || `Aucune information trouvée pour ${teamName} dans le cache.`;
    }
}
