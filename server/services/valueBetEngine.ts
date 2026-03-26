/**
 * Value Bet Detection Engine — Plan 200%
 * Systematically scans all available matches, compares implied probability
 * from odds vs. model probability, and flags value bets with edge > threshold.
 * Includes Kelly Criterion bankroll management.
 */

import { db } from '../db';
import { eq, desc, gte, and, sql } from 'drizzle-orm';
import * as schema from '@shared/schema';
import { discordService } from './discordService';

// ============================================================================
// Types
// ============================================================================

export interface ValueBet {
    matchId: string;
    competition: string;
    homeTeam: string;
    awayTeam: string;
    matchDate: string;
    // Odds
    market: 'home' | 'draw' | 'away' | 'over25' | 'under25' | 'btts_yes' | 'btts_no';
    bookmakerOdds: number;
    impliedProbability: number;     // From odds: 1/odds
    modelProbability: number;       // Our model's estimate
    // Value
    edge: number;                   // modelProb - impliedProb
    edgePercent: number;            // edge as percentage
    confidence: number;             // 0-100
    // Kelly
    kellyStake: number;             // Full Kelly fraction
    halfKellyStake: number;         // Conservative half-Kelly
    recommendedStake: number;       // Based on bankroll
    // Meta
    reasoning: string;
    riskLevel: 'low' | 'medium' | 'high';
    source: string;                 // Which odds provider
}

export interface ValueBetScanResult {
    scannedMatches: number;
    valueBetsFound: number;
    topValueBets: ValueBet[];
    scanDuration: number;
    timestamp: string;
}

// ============================================================================
// Configuration
// ============================================================================

const MIN_EDGE_PERCENT = 5;        // Minimum 5% edge to flag
const MAX_ODDS = 10;               // Ignore extreme odds
const MIN_CONFIDENCE = 40;         // Minimum confidence to recommend
const DEFAULT_BANKROLL = 500;      // Default bankroll for stake calculations
const KELLY_FRACTION = 0.25;       // Quarter Kelly (conservative)

// ============================================================================
// Core Functions  
// ============================================================================

/**
 * Convert decimal odds to implied probability
 */
function oddsToImpliedProb(odds: number): number {
    return 1 / odds;
}

/**
 * Calculate Kelly Criterion optimal stake
 * f* = (bp - q) / b
 * where b = odds-1, p = model probability, q = 1-p
 */
function kellyCriterion(odds: number, modelProb: number): number {
    const b = odds - 1;
    const q = 1 - modelProb;
    const kelly = (b * modelProb - q) / b;
    return Math.max(0, kelly);
}

/**
 * Determine risk level based on odds and confidence
 */
function assessRisk(odds: number, confidence: number, edge: number): 'low' | 'medium' | 'high' {
    if (odds < 1.5 && confidence > 70 && edge > 10) return 'low';
    if (odds < 3.0 && confidence > 50 && edge > 5) return 'medium';
    return 'high';
}

/**
 * Estimate model probability using historical data + Poisson model
 * This is a simplified version — the real prediction uses AI + stats
 */
function estimateMatchProbabilities(match: any): {
    homeWin: number;
    draw: number;
    awayWin: number;
    over25: number;
    btts: number;
} {
    // Use cached team stats if available
    const homeForm = match.homeForm || 0.5;
    const awayForm = match.awayForm || 0.5;
    const homeAdvantage = 0.1;

    // Simple form-based probability estimation
    let homeStrength = homeForm + homeAdvantage;
    let awayStrength = awayForm;
    const total = homeStrength + awayStrength;
    homeStrength /= total;
    awayStrength /= total;

    // Expected goals (simplified Poisson)
    const homeXG = homeStrength * 2.5 + 0.3;
    const awayXG = awayStrength * 2.5 - 0.3;

    // Poisson match outcome probabilities
    const homeWin = Math.min(0.85, Math.max(0.05, homeStrength * 0.7 + 0.15));
    const awayWin = Math.min(0.85, Math.max(0.05, awayStrength * 0.7 + 0.1));
    const draw = Math.max(0.1, 1 - homeWin - awayWin);

    // Over 2.5 probability (based on expected goals)
    const totalXG = homeXG + awayXG;
    const over25 = Math.min(0.85, Math.max(0.15, (totalXG - 2.0) * 0.5 + 0.5));

    // BTTS probability
    const btts = Math.min(0.75, Math.max(0.2, (homeXG * awayXG) / 2));

    return { homeWin, draw, awayWin, over25, btts };
}

/**
 * Scan all available matches for value bets
 */
export async function scanForValueBets(bankroll: number = DEFAULT_BANKROLL): Promise<ValueBetScanResult> {
    const startTime = Date.now();
    const valueBets: ValueBet[] = [];

    try {
        // Get upcoming matches with cached odds
        const matches = await db.select()
            .from(schema.cachedMatches)
            .where(gte(schema.cachedMatches.matchDate, new Date()))
            .limit(200);

        const odds = await db.select()
            .from(schema.cachedOdds)
            .limit(500);

        // Index odds by match_id
        const oddsMap = new Map<number, any>();
        for (const o of odds) {
            oddsMap.set(o.matchId, o);
        }

        for (const match of matches) {
            const matchOdds = oddsMap.get(match.id);
            if (!matchOdds) continue;

            const probs = estimateMatchProbabilities(match);

            // Check each market
            const markets: Array<{
                market: ValueBet['market'];
                odds: number | null;
                modelProb: number;
            }> = [
                    { market: 'home', odds: matchOdds.odd1, modelProb: probs.homeWin },
                    { market: 'draw', odds: matchOdds.oddN, modelProb: probs.draw },
                    { market: 'away', odds: matchOdds.odd2, modelProb: probs.awayWin },
                    { market: 'over25', odds: matchOdds.oddOver25, modelProb: probs.over25 },
                    { market: 'btts_yes', odds: matchOdds.oddBttsYes, modelProb: probs.btts },
                ];

            for (const { market, odds: mktOdds, modelProb } of markets) {
                if (!mktOdds || mktOdds <= 1 || mktOdds > MAX_ODDS) continue;

                const impliedProb = oddsToImpliedProb(mktOdds);
                const edge = modelProb - impliedProb;
                const edgePercent = edge * 100;

                if (edgePercent >= MIN_EDGE_PERCENT && modelProb > 0.2) {
                    const kelly = kellyCriterion(mktOdds, modelProb);
                    const halfKelly = kelly * 0.5;
                    const recommendedStake = Math.round(bankroll * kelly * KELLY_FRACTION * 100) / 100;
                    const confidence = Math.min(95, Math.round(modelProb * 100 + edgePercent));
                    const risk = assessRisk(mktOdds, confidence, edgePercent);

                    if (confidence >= MIN_CONFIDENCE) {
                        valueBets.push({
                            matchId: String(match.id),
                            competition: (match as any).competition || 'Unknown',
                            homeTeam: (match as any).homeTeam || 'Home',
                            awayTeam: (match as any).awayTeam || 'Away',
                            matchDate: (match as any).matchDate || '',
                            market,
                            bookmakerOdds: mktOdds,
                            impliedProbability: Math.round(impliedProb * 100) / 100,
                            modelProbability: Math.round(modelProb * 100) / 100,
                            edge: Math.round(edge * 1000) / 1000,
                            edgePercent: Math.round(edgePercent * 10) / 10,
                            confidence,
                            kellyStake: Math.round(kelly * 1000) / 1000,
                            halfKellyStake: Math.round(halfKelly * 1000) / 1000,
                            recommendedStake,
                            reasoning: `Edge ${edgePercent.toFixed(1)}% | Model ${(modelProb * 100).toFixed(0)}% vs Implied ${(impliedProb * 100).toFixed(0)}% | Kelly ${(kelly * 100).toFixed(1)}%`,
                            riskLevel: risk,
                            source: 'unified-odds',
                        });
                    }
                }
            }
        }

        // Sort by edge (best first)
        valueBets.sort((a, b) => b.edgePercent - a.edgePercent);

        return {
            scannedMatches: matches.length,
            valueBetsFound: valueBets.length,
            topValueBets: valueBets.slice(0, 20),
            scanDuration: Date.now() - startTime,
            timestamp: new Date().toISOString(),
        };
    } catch (error) {
        console.error('[ValueBets] Scan error:', error);
        return {
            scannedMatches: 0,
            valueBetsFound: 0,
            topValueBets: [],
            scanDuration: Date.now() - startTime,
            timestamp: new Date().toISOString(),
        };
    }
}

/**
 * Send value bet alerts to Discord
 */
export async function sendValueBetAlerts(): Promise<number> {
    const result = await scanForValueBets();

    if (result.valueBetsFound === 0) {
        console.log('[ValueBets] No value bets found in current scan');
        return 0;
    }

    const topBets = result.topValueBets.slice(0, 5);

    const fields = topBets.map(bet => ({
        name: `${bet.homeTeam} vs ${bet.awayTeam}`,
        value: [
            `**${bet.market.toUpperCase()}** @ ${bet.bookmakerOdds}`,
            `Edge: ${bet.edgePercent.toFixed(1)}% | Conf: ${bet.confidence}%`,
            `Mise suggérée: ${bet.recommendedStake}€`,
            `Risk: ${bet.riskLevel}`,
        ].join('\n'),
        inline: true,
    }));

    await discordService.sendWebhook({
        embeds: [{
            title: `🎯 ${result.valueBetsFound} Value Bets Détectés`,
            description: `Scan de ${result.scannedMatches} matchs en ${result.scanDuration}ms`,
            color: 65280, // Green
            fields,
            footer: { text: `Ulysse Value Bet Engine | ${new Date().toLocaleDateString('fr-FR')}` },
            timestamp: new Date().toISOString(),
        }],
    });

    return result.valueBetsFound;
}
