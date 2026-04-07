/**
 * Base Prediction Engine
 * Shared math and patterns for basketball, hockey, and NFL prediction services.
 * Eliminates ~700 lines of copy-pasted code across 3 sport-specific services.
 */

import { db } from "../db";
import { cachedMatches, cachedTeamStats } from "@shared/schema";
import { eq, and, gte, lte, like, notInArray } from "drizzle-orm";

// ── Shared Math Utilities ───────────────────────────────────

/**
 * Weighted form score — more recent results count more.
 * Supports W (win), L (loss), D (draw), O (overtime loss).
 */
export function formToScore(form: string, options?: { drawValue?: number; overtimeValue?: number }): number {
    if (!form) return 0.5;
    const { drawValue = 0.4, overtimeValue = 0.3 } = options ?? {};
    let score = 0;
    let count = 0;
    const weights = [1.0, 0.9, 0.8, 0.7, 0.6];

    for (let i = 0; i < Math.min(form.length, 5); i++) {
        const char = form[i].toUpperCase();
        const weight = weights[i];
        if (char === 'W') score += 1.0 * weight;
        else if (char === 'D') score += drawValue * weight;
        else if (char === 'O') score += overtimeValue * weight;
        // 'L' = 0
        count += weight;
    }
    return count > 0 ? score / count : 0.5;
}

/** Gaussian (normal) CDF — P(X ≤ value) for X ~ N(mean, stdDev²) */
export function gaussianCDF(mean: number, stdDev: number, value: number): number {
    const z = (value - mean) / stdDev;
    return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Error function approximation (Abramowitz & Stegun) */
export function erf(x: number): number {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
}

/** Poisson P(X = k) for X ~ Poisson(λ) */
export function poissonProbability(lambda: number, k: number): number {
    let factorial = 1;
    for (let i = 2; i <= k; i++) factorial *= i;
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial;
}

// ── Generic Prediction Types ────────────────────────────────

export interface SportConfig {
    sport: string;
    leaguePattern: string;           // DB LIKE pattern, e.g. '%NBA%'
    homeAdvantage: number;           // Points advantage for home team
    leagueAvg: number;               // Average score per team per game
    stdDevMargin: number;            // Margin standard deviation
    stdDevTotal: number;             // Total points standard deviation
    formWeight: number;              // Weight of form adjustment (points)
    model: 'gaussian' | 'poisson';   // Which probability model to use
    defaultStats: GenericTeamStats;
    betTypes: BetTypeConfig[];
}

export interface GenericTeamStats {
    form: string;
    scoringAvg: number;
    concedingAvg: number;
    pace?: number;
    specialStat1?: number;  // e.g., overtimeRate, rushingYards
    specialStat2?: number;  // e.g., powerPlayPct, passingYards
}

export interface GenericProbabilities {
    homeWin: number;
    awayWin: number;
    draw?: number;
    overTotal: number;
    underTotal: number;
    homeSpread: number;
    awaySpread: number;
    predictedHomeScore: number;
    predictedAwayScore: number;
    predictedTotal: number;
    confidence: number;
    method: string;
}

export interface GenericRecommendation {
    betType: string;
    prediction: string;
    probability: number;
    confidence: 'high' | 'medium' | 'low';
    reasoning: string;
}

export interface GenericAnalysis {
    homeForm: string;
    awayForm: string;
    scoringTrend: string;
    keyFactors: string[];
    riskLevel: 'low' | 'medium' | 'high';
}

export interface GenericPrediction {
    matchId: number;
    homeTeam: string;
    awayTeam: string;
    league: string;
    matchDate: Date;
    probabilities: GenericProbabilities;
    recommendations: GenericRecommendation[];
    analysis: GenericAnalysis;
}

interface BetTypeConfig {
    type: string;
    getHomeLabel: () => string;
    getAwayLabel: () => string;
}

// ── Base Prediction Engine ──────────────────────────────────

export class BasePredictionEngine {
    constructor(protected config: SportConfig) { }

    /** Get team stats from DB, mapping to generic format */
    async getTeamStats(teamName: string): Promise<GenericTeamStats | null> {
        const [stats] = await db.select()
            .from(cachedTeamStats)
            .where(eq(cachedTeamStats.teamName, teamName))
            .limit(1);

        if (!stats) return null;

        return {
            form: stats.formString || '',
            scoringAvg: (stats.goalsForAvg || 0) * (this.config.leagueAvg / 1.35),
            concedingAvg: (stats.goalsAgainstAvg || 0) * (this.config.leagueAvg / 1.35),
        };
    }

    /** Calculate probabilities for a matchup */
    async calculateProbabilities(
        homeTeam: string,
        awayTeam: string,
        totalLine?: number,
        spreadLine: number = 0
    ): Promise<GenericProbabilities> {
        const homeStats = await this.getTeamStats(homeTeam);
        const awayStats = await this.getTeamStats(awayTeam);

        const home = homeStats || this.config.defaultStats;
        const away = awayStats || this.config.defaultStats;

        const homeFormScore = formToScore(home.form, this.config.model === 'poisson' ? { overtimeValue: 0.3 } : undefined);
        const awayFormScore = formToScore(away.form, this.config.model === 'poisson' ? { overtimeValue: 0.3 } : undefined);

        const avg = this.config.leagueAvg;
        const homeOffense = (home.scoringAvg / avg) * avg;
        const awayDefense = (away.concedingAvg / avg) * avg;
        const awayOffense = (away.scoringAvg / avg) * avg;
        const homeDefense = (home.concedingAvg / avg) * avg;

        let predictedHomeScore = (homeOffense + awayDefense) / 2 + this.config.homeAdvantage;
        let predictedAwayScore = (awayOffense + homeDefense) / 2;

        const formAdj = (homeFormScore - awayFormScore) * this.config.formWeight;
        predictedHomeScore += formAdj;
        predictedAwayScore -= formAdj;

        const predictedTotal = predictedHomeScore + predictedAwayScore;
        const effectiveTotalLine = totalLine ?? predictedTotal;
        const predictedSpread = predictedAwayScore - predictedHomeScore;

        let homeWinProb: number, awayWinProb: number, drawProb: number | undefined;

        if (this.config.model === 'poisson') {
            // Poisson model (better for low-scoring sports)
            const homeLambda = Math.max(0.5, predictedHomeScore);
            const awayLambda = Math.max(0.5, predictedAwayScore);
            homeWinProb = 0; drawProb = 0; awayWinProb = 0;
            for (let h = 0; h <= 10; h++) {
                for (let a = 0; a <= 10; a++) {
                    const prob = poissonProbability(homeLambda, h) * poissonProbability(awayLambda, a);
                    if (h > a) homeWinProb += prob;
                    else if (h === a) drawProb += prob;
                    else awayWinProb += prob;
                }
            }
        } else {
            // Gaussian model (better for high-scoring sports)
            homeWinProb = gaussianCDF(predictedSpread, this.config.stdDevMargin, 0);
            awayWinProb = 1 - homeWinProb;
        }

        const overProb = 1 - gaussianCDF(predictedTotal, this.config.stdDevTotal, effectiveTotalLine);
        const underProb = 1 - overProb;
        const homeSpreadProb = gaussianCDF(predictedSpread, this.config.stdDevMargin, spreadLine);
        const awaySpreadProb = 1 - homeSpreadProb;

        let confidence = 0.6;
        if (homeStats && awayStats) confidence += 0.15;
        if (Math.abs(homeFormScore - awayFormScore) > 0.3) confidence += 0.1;

        return {
            homeWin: Math.round(homeWinProb * 1000) / 10,
            awayWin: Math.round(awayWinProb * 1000) / 10,
            draw: drawProb !== undefined ? Math.round(drawProb * 1000) / 10 : undefined,
            overTotal: Math.round(overProb * 1000) / 10,
            underTotal: Math.round(underProb * 1000) / 10,
            homeSpread: Math.round(homeSpreadProb * 1000) / 10,
            awaySpread: Math.round(awaySpreadProb * 1000) / 10,
            predictedHomeScore: Math.round(predictedHomeScore),
            predictedAwayScore: Math.round(predictedAwayScore),
            predictedTotal: Math.round(predictedTotal),
            confidence: Math.min(0.85, confidence),
            method: `${this.config.model}_spread_total`,
        };
    }

    /** Generate bet recommendations from probabilities */
    generateRecommendations(probs: GenericProbabilities, totalLine?: number): GenericRecommendation[] {
        const line = totalLine ?? probs.predictedTotal;
        const bets = [
            { type: 'moneyline', prediction: 'Domicile', prob: probs.homeWin / 100 },
            { type: 'moneyline', prediction: 'Extérieur', prob: probs.awayWin / 100 },
            { type: 'total', prediction: `Over ${line}`, prob: probs.overTotal / 100 },
            { type: 'total', prediction: `Under ${line}`, prob: probs.underTotal / 100 },
        ];

        return bets.map(bet => {
            let confidence: 'high' | 'medium' | 'low' = 'low';
            if (bet.prob >= 0.60) confidence = 'high';
            else if (bet.prob >= 0.50) confidence = 'medium';

            return {
                betType: bet.type,
                prediction: bet.prediction,
                probability: bet.prob * 100,
                confidence,
                reasoning: `Probabilité: ${(bet.prob * 100).toFixed(1)}%. Score prédit: ${probs.predictedHomeScore}-${probs.predictedAwayScore} (Total: ${probs.predictedTotal})`,
            };
        }).sort((a, b) => b.probability - a.probability);
    }

    /** Generate match analysis from stats and probabilities */
    generateAnalysis(
        homeStats: GenericTeamStats | null,
        awayStats: GenericTeamStats | null,
        probs: GenericProbabilities,
        highScoringThreshold?: number,
        lowScoringThreshold?: number
    ): GenericAnalysis {
        const keyFactors: string[] = [];
        const formOpts = this.config.model === 'poisson' ? { overtimeValue: 0.3 } : undefined;

        let homeForm = 'Forme inconnue';
        let awayForm = 'Forme inconnue';

        if (homeStats?.form) {
            const score = formToScore(homeStats.form, formOpts);
            homeForm = score >= 0.7 ? 'Excellente forme' : score >= 0.5 ? 'Forme correcte' : 'Forme difficile';
            if (score >= 0.7) keyFactors.push('Domicile en série positive');
        }

        if (awayStats?.form) {
            const score = formToScore(awayStats.form, formOpts);
            awayForm = score >= 0.7 ? 'Excellente forme' : score >= 0.5 ? 'Forme correcte' : 'Forme difficile';
            if (score >= 0.7) keyFactors.push('Extérieur en série positive');
        }

        const high = highScoringThreshold ?? this.config.leagueAvg * 2 * 1.05;
        const low = lowScoringThreshold ?? this.config.leagueAvg * 2 * 0.95;
        let scoringTrend = 'Scoring moyen';
        if (probs.predictedTotal >= high) {
            scoringTrend = 'Match à haut scoring attendu';
            keyFactors.push('Potentiel Over élevé');
        } else if (probs.predictedTotal <= low) {
            scoringTrend = 'Match défensif attendu';
            keyFactors.push('Potentiel Under élevé');
        }

        const maxProb = Math.max(probs.homeWin, probs.awayWin);
        let riskLevel: 'low' | 'medium' | 'high' = 'medium';
        if (maxProb >= 60) riskLevel = 'low';
        else if (maxProb <= 52) riskLevel = 'high';

        if (keyFactors.length === 0) keyFactors.push('Match équilibré');

        return { homeForm, awayForm, scoringTrend, keyFactors, riskLevel };
    }

    /** Full match analysis pipeline */
    async analyzeMatch(
        homeTeam: string, awayTeam: string, league: string, matchDate: Date, totalLine?: number
    ): Promise<GenericPrediction> {
        const probs = await this.calculateProbabilities(homeTeam, awayTeam, totalLine);
        const recommendations = this.generateRecommendations(probs, totalLine);
        const homeStats = await this.getTeamStats(homeTeam);
        const awayStats = await this.getTeamStats(awayTeam);
        const analysis = this.generateAnalysis(homeStats, awayStats, probs);

        return { matchId: 0, homeTeam, awayTeam, league, matchDate, probabilities: probs, recommendations, analysis };
    }

    /** Fetch today's matches from DB and predict all */
    async analyzeTodayMatches(): Promise<GenericPrediction[]> {
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setHours(23, 59, 59, 999);
        const finishedStatuses = ['finished', 'FT', 'AET', 'PEN', 'PST', 'CANC', 'ABD', 'AWD', 'WO', 'postponed', 'cancelled'];

        const matches = await db.select()
            .from(cachedMatches)
            .where(and(
                gte(cachedMatches.matchDate, now),
                lte(cachedMatches.matchDate, tomorrow),
                like(cachedMatches.league, this.config.leaguePattern),
                notInArray(cachedMatches.status, finishedStatuses)
            ))
            .orderBy(cachedMatches.matchDate);

        const results: GenericPrediction[] = [];
        for (const match of matches) {
            const pred = await this.analyzeMatch(match.homeTeam, match.awayTeam, match.league, match.matchDate);
            pred.matchId = match.id;
            results.push(pred);
        }
        return results;
    }

    /** Format predictions for AI context */
    formatPredictionsForAI(predictions: GenericPrediction[]): string {
        if (predictions.length === 0) {
            return `Aucun match ${this.config.sport} disponible pour aujourd'hui.`;
        }

        const lines: string[] = [
            `=== PRÉDICTIONS ${this.config.sport.toUpperCase()} ===`,
            `Analyse du ${new Date().toLocaleDateString('fr-FR')}`,
            `Méthode: Modèle ${this.config.model} (spread + totaux)`,
            '',
        ];

        for (const pred of predictions.sort((a, b) => b.probabilities.confidence - a.probabilities.confidence)) {
            const p = pred.probabilities;
            const time = pred.matchDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            const topRec = pred.recommendations[0];
            lines.push(
                `[${time}] ${pred.homeTeam} vs ${pred.awayTeam}`,
                `  Score prédit: ${p.predictedHomeScore}-${p.predictedAwayScore} (Total: ${p.predictedTotal})`,
                `  Moneyline: Dom=${p.homeWin}% Ext=${p.awayWin}%${p.draw != null ? ` Nul=${p.draw}%` : ''}`,
                `  Recommandation: ${topRec.prediction} (${topRec.probability.toFixed(1)}%)`,
                `  Analyse: ${pred.analysis.keyFactors.join(', ')}`,
                `  Risque: ${pred.analysis.riskLevel} | Confiance: ${(p.confidence * 100).toFixed(0)}%`,
            );
        }

        lines.push('', 'Note: Probabilités calculées sur base statistique.');
        return lines.join('\n');
    }
}
