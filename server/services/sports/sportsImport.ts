/**
 * Import external fixtures into the sports cache (homework extraction).
 */
import { db } from "../../db";
import { cachedMatches } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export interface FixtureInput {
    homeTeam: string;
    awayTeam: string;
    homeScore?: number;
    awayScore?: number;
    matchday?: number;
}

export async function importFixturesFromHomework(
    fixtures: FixtureInput[],
    league: string,
    leagueId?: number
): Promise<{ imported: number; updated: number }> {
    let imported = 0;
    let updated = 0;

    for (const fixture of fixtures) {
        const existing = await db.select()
            .from(cachedMatches)
            .where(
                and(
                    eq(cachedMatches.homeTeam, fixture.homeTeam),
                    eq(cachedMatches.awayTeam, fixture.awayTeam),
                    eq(cachedMatches.league, league)
                )
            )
            .limit(1);

        if (existing.length > 0) {
            if (fixture.homeScore !== undefined && fixture.awayScore !== undefined) {
                await db.update(cachedMatches)
                    .set({
                        homeScore: fixture.homeScore,
                        awayScore: fixture.awayScore,
                        status: 'finished',
                        lastSync: new Date()
                    })
                    .where(eq(cachedMatches.id, existing[0].id));
                updated++;
            }
        } else {
            const estimatedDate = new Date();
            if (fixture.matchday) {
                const seasonStart = new Date(new Date().getFullYear(), 7, 15);
                estimatedDate.setTime(seasonStart.getTime() + (fixture.matchday - 1) * 7 * 24 * 60 * 60 * 1000);
            }

            await db.insert(cachedMatches).values({
                homeTeam: fixture.homeTeam,
                awayTeam: fixture.awayTeam,
                homeScore: fixture.homeScore ?? null,
                awayScore: fixture.awayScore ?? null,
                league,
                leagueId: leagueId ?? null,
                matchDate: estimatedDate,
                status: fixture.homeScore !== undefined ? 'finished' : 'scheduled',
                lastSync: new Date()
            });
            imported++;
        }
    }

    console.log(`[SPORTS-CACHE] Imported ${imported} new fixtures, updated ${updated} existing matches for ${league}`);
    return { imported, updated };
}
