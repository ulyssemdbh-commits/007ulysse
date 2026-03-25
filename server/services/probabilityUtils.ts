/**
 * Pure math utilities for probability calculations.
 * No external dependencies — safe to import from tests.
 */

export function poissonProbability(lambda: number, k: number): number {
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

export function factorial(n: number): number {
    if (n <= 1) return 1;
    let result = 1;
    for (let i = 2; i <= n; i++) result *= i;
    return result;
}

export function formToScore(form: string): number {
    if (!form) return 0.5;
    let score = 0;
    let count = 0;
    const weights = [1.0, 0.9, 0.8, 0.7, 0.6];

    for (let i = 0; i < Math.min(form.length, 5); i++) {
        const char = form[i].toUpperCase();
        const weight = weights[i];
        if (char === 'W') score += 1.0 * weight;
        else if (char === 'D') score += 0.4 * weight;
        else if (char === 'L') score += 0.0 * weight;
        count += weight;
    }

    return count > 0 ? score / count : 0.5;
}

export function oddsToImpliedProb(odds: number): number {
    if (!odds || odds <= 1) return 0;
    return 1 / odds;
}

export function normalizeProbabilities(probs: number[]): number[] {
    const sum = probs.reduce((a, b) => a + b, 0);
    if (sum === 0) return probs.map(() => 1 / probs.length);
    return probs.map(p => p / sum);
}

export function calculateValue(probability: number, odds: number): number {
    if (!odds || odds <= 1) return 0;
    const impliedProb = 1 / odds;
    return ((probability - impliedProb) / impliedProb) * 100;
}

export function calculateExpectedGoals(
    attackStrength: number,
    defenseWeakness: number,
    leagueAvg: number = 1.35,
    homeAdvantage: number = 1.15
): number {
    return attackStrength * defenseWeakness * leagueAvg * homeAdvantage;
}

/** Bundle for backwards compat with existing imports */
export const probabilityUtils = {
    poissonProbability,
    formToScore,
    oddsToImpliedProb,
    calculateValue,
    normalizeProbabilities,
    calculateExpectedGoals,
};
