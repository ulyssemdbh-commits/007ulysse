/**
 * Betting interest scoring — pure algorithm, no I/O.
 * Produces a 0-100 score + factors + strategic tags for a match.
 */
import { LEAGUES, isBigTeam } from "@shared/sportsConstants";

// ── Types ───────────────────────────────────────────────────

export interface MatchInput {
    homeTeam: string;
    awayTeam: string;
    league: string;
    matchDate: Date | string;
}

export interface OddsInput {
    homeOdds: number | null;
    drawOdds?: number | null;
    awayOdds: number | null;
    overOdds?: number | null;
    underOdds?: number | null;
}

export interface TeamStatsInput {
    goalsForAvg?: number;
    goalsAgainstAvg?: number;
    over25Rate?: number;
    bttsRate?: number;
    last10Wins: number;
    last10Draws: number;
    last10Losses?: number;
    cleanSheetRate?: number;
    failedToScoreRate?: number;
    homeGoalsForAvg?: number;
    homeGoalsAgainstAvg?: number;
    homeOver25Rate?: number;
    homeBttsRate?: number;
    awayGoalsForAvg?: number;
    awayGoalsAgainstAvg?: number;
    awayOver25Rate?: number;
    awayBttsRate?: number;
}

export interface InterestResult {
    score: number;
    factors: string[];
    tags: string[];
}

// League interest weights derived from shared constants (scale 1-10 → ~14-25)
const LEAGUE_INTEREST_SCORES: Record<string, number> = Object.fromEntries(
    LEAGUES.filter(l => l.sport === 'football').map(l => [l.name, Math.round(l.interestScore * 2.5)])
);

// ── Main Scoring Function ───────────────────────────────────

export function calculateBettingInterestScore(
    match: MatchInput,
    odds: OddsInput[],
    homeStats?: TeamStatsInput | null,
    awayStats?: TeamStatsInput | null
): InterestResult {
    let score = 0;
    const factors: string[] = [];
    const tags: string[] = [];

    // 1. League attractiveness (0-25 points)
    const leagueScore = LEAGUE_INTEREST_SCORES[match.league] || 10;
    score += leagueScore;
    if (leagueScore >= 20) {
        factors.push("Ligue majeure");
        tags.push("top_league");
    }

    // 2. Odds balance / level gap analysis (0-25 points)
    if (odds && odds.length > 0) {
        const bestOdds = odds[0];
        const home = bestOdds.homeOdds || 0;
        const away = bestOdds.awayOdds || 0;

        if (home && away) {
            const minOdds = Math.min(home, away);
            const maxOdds = Math.max(home, away);
            const oddsRatio = maxOdds / minOdds;

            if (oddsRatio < 1.5) {
                score += 25;
                factors.push("Match très serré");
                tags.push("balanced");
            } else if (oddsRatio < 2.5) {
                score += 18;
                factors.push("Match équilibré");
                tags.push("balanced");
            } else if (oddsRatio < 4) {
                score += 12;
                if (home < away) tags.push("favorite_home");
                else tags.push("favorite_away");
            } else {
                score += 5;
                factors.push("Favori écrasant");
                if (home < away) tags.push("dominant_home");
                else tags.push("dominant_away");
            }

            if (minOdds >= 1.8 && minOdds <= 2.2) {
                score += 10;
                factors.push("Cote value");
                tags.push("value_bet");
            }

            if (minOdds >= 1.15 && minOdds <= 1.5) {
                tags.push("good_for_safe_tickets");
            }
        }

        if (bestOdds.overOdds && bestOdds.underOdds) {
            const overUnderBalance = Math.abs(bestOdds.overOdds - bestOdds.underOdds);
            if (overUnderBalance < 0.3) {
                score += 8;
                factors.push("O/U équilibré");
            }
        }
    } else {
        score += 5;
    }

    // 3. Match importance based on teams (0-20 points)
    const homeIsBig = isBigTeam(match.homeTeam || '');
    const awayIsBig = isBigTeam(match.awayTeam || '');

    if (homeIsBig && awayIsBig) {
        score += 20;
        factors.push("Gros match");
    } else if (homeIsBig || awayIsBig) {
        score += 12;
        factors.push("Équipe majeure");
    } else {
        score += 5;
    }

    // 4. Time slot attractiveness (0-15 points)
    const matchHour = new Date(match.matchDate).getHours();
    if (matchHour >= 20) {
        score += 15;
        factors.push("Prime time");
    } else if (matchHour >= 17) {
        score += 12;
    } else if (matchHour >= 14) {
        score += 8;
    } else {
        score += 4;
    }

    // 5. Proximity bonus (0-15 points)
    const now = new Date();
    const matchTime = new Date(match.matchDate);
    const hoursUntilMatch = (matchTime.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursUntilMatch > 0 && hoursUntilMatch <= 3) {
        score += 15;
        factors.push("Imminent");
    } else if (hoursUntilMatch > 0 && hoursUntilMatch <= 6) {
        score += 10;
    } else if (hoursUntilMatch > 0 && hoursUntilMatch <= 12) {
        score += 5;
    }

    // 6. Team stats analysis (bonus 0-15 points)
    if (homeStats && awayStats) {
        const totalGoals = (homeStats.goalsForAvg || 0) + (awayStats.goalsForAvg || 0);
        const avgGoals = totalGoals / 2;
        const avgOver25 = ((homeStats.over25Rate || 0) + (awayStats.over25Rate || 0)) / 2;
        const avgBtts = ((homeStats.bttsRate || 0) + (awayStats.bttsRate || 0)) / 2;

        if (avgOver25 >= 0.6 || avgGoals >= 1.5) {
            score += 8;
            factors.push("Match à buts");
            tags.push("high_scoring");
        }

        if (avgBtts >= 0.55) tags.push("btts_likely");

        const homeWinRate = homeStats.last10Wins / 10;
        const awayWinRate = awayStats.last10Wins / 10;
        const homeDrawRate = homeStats.last10Draws / 10;
        const awayDrawRate = awayStats.last10Draws / 10;

        if (homeWinRate >= 0.6 && awayWinRate >= 0.5) {
            score += 5;
            factors.push("Bonnes formes");
            tags.push("both_in_form");
        }

        if (awayWinRate > homeWinRate + 0.2) tags.push("underdog_value");
        if (homeWinRate < 0.3 && awayWinRate < 0.3) tags.push("avoid");

        // === Strategic tags ===
        const minOdds = odds?.[0] ? Math.min(odds[0].homeOdds || 99, odds[0].awayOdds || 99) : 99;
        const favoriteIsHome = odds?.[0] && (odds[0].homeOdds || 99) < (odds[0].awayOdds || 99);
        const favoriteStats = favoriteIsHome ? homeStats : awayStats;
        const favoriteWinRate = favoriteIsHome ? homeWinRate : awayWinRate;
        const underdogWinRate = favoriteIsHome ? awayWinRate : homeWinRate;

        if (minOdds >= 1.2 && minOdds <= 1.55 && favoriteWinRate >= 0.5 && (favoriteStats?.cleanSheetRate || 0) >= 0.25) {
            tags.push("combo_safe");
            factors.push("Combo safe");
        }

        if (totalGoals >= 3.5 || (avgOver25 >= 0.7 && avgBtts >= 0.6)) {
            tags.push("goal_fest");
            factors.push("Goal fest probable");
        }

        if (totalGoals < 2.2 && avgOver25 < 0.45) {
            tags.push("low_scoring");
            tags.push("under_likely");
            factors.push("Match fermé");
        }

        if (minOdds <= 1.6 && underdogWinRate > favoriteWinRate) {
            tags.push("upset_alert");
            factors.push("Alerte upset");
        }

        if (homeDrawRate >= 0.3 && awayDrawRate >= 0.3) tags.push("draw_likely");

        const homeCleanSheet = homeStats.cleanSheetRate || 0;
        const awayCleanSheet = awayStats.cleanSheetRate || 0;
        const homeFailedToScore = homeStats.failedToScoreRate || 0;
        const awayFailedToScore = awayStats.failedToScoreRate || 0;

        if ((homeCleanSheet >= 0.35 && awayFailedToScore >= 0.25) ||
            (awayCleanSheet >= 0.35 && homeFailedToScore >= 0.25)) {
            tags.push("clean_sheet_bet");
        }

        if (homeStats.homeGoalsForAvg && homeStats.homeGoalsForAvg >= 2 && (homeStats.homeGoalsAgainstAvg || 99) <= 0.8) {
            tags.push("home_fortress");
        }

        if (awayStats.awayGoalsForAvg && awayStats.awayGoalsForAvg >= 1.5) {
            tags.push("away_danger");
        }

        if (totalGoals >= 3 && avgBtts >= 0.5) tags.push("first_half_goals");
        if (homeWinRate >= 0.4 && awayWinRate >= 0.4 && minOdds >= 1.8) tags.push("late_drama");
    }

    if (homeIsBig && awayIsBig) {
        tags.push("derby");
        tags.push("high_profile");
    }

    score = Math.min(100, Math.max(0, score));
    return { score: Math.round(score), factors, tags };
}

export function getInterestEmoji(score: number): string {
    if (score >= 80) return "🔥🔥";
    if (score >= 65) return "🔥";
    if (score >= 50) return "⭐";
    if (score >= 35) return "👀";
    return "📊";
}
