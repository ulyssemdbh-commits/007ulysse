/**
 * Integration tests for the sports module split.
 * Tests the interestScoring pure functions and the barrel facade wiring.
 */
import { calculateBettingInterestScore, getInterestEmoji } from "../services/sports/interestScoring";
import { formatMatchesForAI } from "../services/sports/sportsFormatting";

// ── interestScoring: pure function tests (no mocks needed) ──

describe("calculateBettingInterestScore", () => {
    const makeMatch = (overrides: Record<string, unknown> = {}) => ({
        league: "Ligue 1",
        homeTeam: "Paris Saint-Germain",
        awayTeam: "Olympique de Marseille",
        matchDate: new Date("2026-02-09T20:00:00Z"),
        ...overrides,
    });

    const makeOdds = (home = 1.5, draw = 4.0, away = 6.0) => [
        { homeOdds: home, drawOdds: draw, awayOdds: away },
    ];

    it("returns a score between 0 and 100", () => {
        const { score } = calculateBettingInterestScore(makeMatch(), makeOdds());
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
    });

    it("gives higher score for big-team derbies", () => {
        const derby = calculateBettingInterestScore(
            makeMatch({ homeTeam: "Paris Saint-Germain", awayTeam: "Olympique de Marseille" }),
            makeOdds(2.2, 3.3, 3.0)
        );
        const unknown = calculateBettingInterestScore(
            makeMatch({ homeTeam: "Team A", awayTeam: "Team B", league: "Unknown League" }),
            makeOdds(2.2, 3.3, 3.0)
        );
        expect(derby.score).toBeGreaterThan(unknown.score);
    });

    it("adds 'balanced' tag when odds are close", () => {
        const { tags } = calculateBettingInterestScore(makeMatch(), makeOdds(2.0, 3.2, 3.5));
        expect(tags).toContain("balanced");
    });

    it("adds 'top_league' tag for Ligue 1", () => {
        const { tags } = calculateBettingInterestScore(makeMatch(), makeOdds());
        expect(tags).toContain("top_league");
    });

    it("adds 'derby' tag when two big teams play", () => {
        const { tags } = calculateBettingInterestScore(
            makeMatch({ homeTeam: "Paris Saint-Germain", awayTeam: "Olympique de Marseille" }),
            makeOdds()
        );
        expect(tags).toContain("derby");
    });

    it("includes factors array explaining the score", () => {
        const { factors } = calculateBettingInterestScore(makeMatch(), makeOdds());
        expect(Array.isArray(factors)).toBe(true);
        expect(factors.length).toBeGreaterThan(0);
    });

    it("handles empty odds gracefully", () => {
        const { score } = calculateBettingInterestScore(makeMatch(), []);
        expect(score).toBeGreaterThanOrEqual(0);
    });

    it("incorporates team stats when provided", () => {
        const withStats = calculateBettingInterestScore(
            makeMatch(),
            makeOdds(2.0, 3.2, 3.5),
            { last10Wins: 7, last10Draws: 2, over25Rate: 0.7 },
            { last10Wins: 3, last10Draws: 2, over25Rate: 0.6 }
        );
        const withoutStats = calculateBettingInterestScore(
            makeMatch(),
            makeOdds(2.0, 3.2, 3.5)
        );
        // Stats should add some points
        expect(withStats.score).toBeGreaterThanOrEqual(withoutStats.score);
    });
});

describe("getInterestEmoji", () => {
    it("returns double fire for score >= 80", () => {
        expect(getInterestEmoji(80)).toBe("\u{1F525}\u{1F525}");
        expect(getInterestEmoji(100)).toBe("\u{1F525}\u{1F525}");
    });

    it("returns fire for score 65-79", () => {
        expect(getInterestEmoji(65)).toBe("\u{1F525}");
        expect(getInterestEmoji(79)).toBe("\u{1F525}");
    });

    it("returns star for score 50-64", () => {
        expect(getInterestEmoji(50)).toBe("\u{2B50}");
        expect(getInterestEmoji(64)).toBe("\u{2B50}");
    });

    it("returns eyes for score 35-49", () => {
        expect(getInterestEmoji(35)).toBe("\u{1F440}");
        expect(getInterestEmoji(49)).toBe("\u{1F440}");
    });

    it("returns chart for score < 35", () => {
        expect(getInterestEmoji(34)).toBe("\u{1F4CA}");
        expect(getInterestEmoji(0)).toBe("\u{1F4CA}");
    });
});

// ── sportsFormatting: pure function tests ──

describe("formatMatchesForAI", () => {
    it("returns empty message for empty array", () => {
        const result = formatMatchesForAI([]);
        expect(result).toBe("Aucun match en cache pour cette date.");
    });

    it("returns empty message for null/undefined", () => {
        const result = formatMatchesForAI(null as never);
        expect(result).toBe("Aucun match en cache pour cette date.");
    });

    it("formats matches grouped by league", () => {
        const matches = [
            {
                id: 1, homeTeam: "PSG", awayTeam: "OM", league: "Ligue 1",
                matchDate: new Date("2025-12-01T20:00:00Z"),
                odds: [{ homeOdds: 1.5, drawOdds: 4.0, awayOdds: 6.0 }],
                homeStats: null, awayStats: null,
                bettingInterest: 75, interestFactors: ["Top league"], interestTags: ["top_league"],
                interestEmoji: "⭐",
                homeScore: null, awayScore: null, externalId: "1", leagueId: 61,
                status: "scheduled", lastSync: new Date(),
            },
        ] as never;

        const output = formatMatchesForAI(matches);
        expect(output).toContain("Ligue 1");
        expect(output).toContain("PSG");
        expect(output).toContain("OM");
    });

    it("shows TOP PARIS section for high-interest matches", () => {
        const matches = [
            {
                id: 1, homeTeam: "PSG", awayTeam: "OM", league: "Ligue 1",
                matchDate: new Date("2025-12-01T20:00:00Z"),
                odds: [{ homeOdds: 2.1, drawOdds: 3.3, awayOdds: 3.0 }],
                homeStats: null, awayStats: null,
                bettingInterest: 85, interestFactors: ["Big derby"], interestTags: ["big_team_derby"],
                interestEmoji: "🔥",
                homeScore: null, awayScore: null, externalId: "1", leagueId: 61,
                status: "scheduled", lastSync: new Date(),
            },
        ] as never;

        const output = formatMatchesForAI(matches);
        expect(output).toContain("TOP PARIS DU JOUR");
        expect(output).toContain("🔥");
    });
});

// ── sportsImport: structural test ──

describe("sportsImport module", () => {
    it("exports importFixturesFromHomework as a function", async () => {
        const mod = await import("../services/sports/sportsImport");
        expect(typeof mod.importFixturesFromHomework).toBe("function");
    });
});

// ── Barrel facade wiring ──

describe("sportsCacheService barrel", () => {
    it("exposes all expected methods", async () => {
        const { sportsCacheService } = await import("../services/sportsCacheService");
        const methods = [
            "getTeamStats", "getMatchesForDate", "getUpcomingMatches",
            "getMatchesWithOdds", "getWeekMatches", "getLastSyncStatus",
            "getCacheStats", "getNextMatchForTeam", "getRecentMatchScore",
            "queryTeamInfo", "syncDailyMatches", "refreshHourlyOdds",
            "syncMultiSportOdds", "syncTeamStats", "formatMatchesForAI",
            "importFixturesFromHomework",
        ];
        for (const method of methods) {
            expect(typeof (sportsCacheService as Record<string, unknown>)[method]).toBe("function");
        }
    });

    it("re-exports MatchWithOdds and FixtureInput types", async () => {
        // Type-only check: import should not throw
        const mod = await import("../services/sportsCacheService");
        expect(mod).toBeDefined();
        expect(mod.sportsCacheService).toBeDefined();
    });
});
