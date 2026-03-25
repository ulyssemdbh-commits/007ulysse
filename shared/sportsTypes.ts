/**
 * Shared sports types used across odds, prediction, and cache services.
 * Single source of truth — import from here instead of redefining per file.
 */

// ── Odds Types ──────────────────────────────────────────────

export interface BaseOdds {
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

export interface SpreadOdds extends BaseOdds {
    spread?: number;
    spreadHome?: number;
    spreadAway?: number;
    totalLine?: number;
    overOdds?: number;
    underOdds?: number;
}

// ── Prediction Types ────────────────────────────────────────

export interface BaseProbabilities {
    homeWin: number;
    draw: number;
    awayWin: number;
    over15: number;
    over25: number;
    over35: number;
    under25: number;
    btts: number;
    bttsNo: number;
    confidence: number;
    confidenceLevel: 'high' | 'medium' | 'low';
    method: string;
}

export interface BetRecommendation {
    betType: string;
    prediction: string;
    probability: number;
    impliedOdds: number;
    bookmakerOdds?: number;
    valueRating: number;
    valueTier: 'none' | 'moderate' | 'strong';
    confidence: 'high' | 'medium' | 'low';
    reasoning: string;
}

export interface MatchAnalysis {
    homeForm: string;
    awayForm: string;
    scoringTrend: string;
    defensiveTrend: string;
    keyFactors: string[];
    riskLevel: 'low' | 'medium' | 'high';
}

export interface BasePrediction {
    matchId?: number;
    homeTeam: string;
    awayTeam: string;
    league: string;
    matchDate: Date;
    probabilities: BaseProbabilities;
    recommendations: BetRecommendation[];
    analysis: MatchAnalysis;
    bestBet?: string;
    confidence?: number;
    valueScore?: number;
    reasoning?: string;
}

// ── Team Stats ──────────────────────────────────────────────

export interface BaseTeamStats {
    form: string;
    overallWinRate: number;
    overallLossRate: number;
}

export interface FootballTeamStats extends BaseTeamStats {
    goalsScored: number;
    goalsConceded: number;
    over25Rate: number;
    bttsRate: number;
    cleanSheetRate: number;
    failedToScoreRate: number;
    homeWinRate?: number;
    awayWinRate?: number;
    drawRate?: number;
}

export interface BasketballTeamStats extends BaseTeamStats {
    pointsPerGame: number;
    pointsAllowed: number;
    homeRecord: string;
    awayRecord: string;
    recentMargin: number;
}

export interface HockeyTeamStats extends BaseTeamStats {
    goalsPerGame: number;
    goalsAllowed: number;
    overtimeRate: number;
    powerPlayPct: number;
    penaltyKillPct: number;
}

export interface NFLTeamStats extends BaseTeamStats {
    pointsPerGame: number;
    pointsAllowed: number;
    rushingYards: number;
    passingYards: number;
    turnovers: number;
}

// ── Prediction Criteria ─────────────────────────────────────

export interface PredictionCriteria {
    mode?: 'safe' | 'aggressive';
    betType?: 'all' | '1X2' | 'over_under' | 'btts';
    minConfidence?: number;
    valueOnly?: boolean;
    sortBy?: 'confidence' | 'value' | 'odds';
}
