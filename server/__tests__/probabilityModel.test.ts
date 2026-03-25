import { describe, it, expect } from 'vitest';
import { probabilityUtils } from '../services/probabilityModelService';

const { poissonProbability, formToScore, oddsToImpliedProb, calculateValue, normalizeProbabilities, calculateExpectedGoals } = probabilityUtils;

describe('ProbabilityModelService - Core Functions', () => {
  
  describe('poissonProbability', () => {
    it('should return correct probability for k=0', () => {
      const lambda = 1.5;
      const result = poissonProbability(lambda, 0);
      expect(result).toBeCloseTo(Math.exp(-1.5), 5);
    });

    it('should return correct probability for k=1', () => {
      const lambda = 2.0;
      const result = poissonProbability(lambda, 1);
      expect(result).toBeCloseTo(2.0 * Math.exp(-2.0), 5);
    });

    it('should return correct probability for k=2', () => {
      const lambda = 1.0;
      const result = poissonProbability(lambda, 2);
      expect(result).toBeCloseTo(0.5 * Math.exp(-1.0), 5);
    });

    it('should return small probability for high k with low lambda', () => {
      const lambda = 1.0;
      const result = poissonProbability(lambda, 5);
      expect(result).toBeLessThan(0.01);
    });

    it('sum of probabilities k=0 to k=10 should be close to 1', () => {
      const lambda = 2.5;
      let sum = 0;
      for (let k = 0; k <= 10; k++) {
        sum += poissonProbability(lambda, k);
      }
      expect(sum).toBeCloseTo(1, 2);
    });
  });

  describe('formToScore', () => {
    it('should return 0.5 for empty form', () => {
      expect(formToScore('')).toBe(0.5);
    });

    it('should return 1.0 for all wins', () => {
      expect(formToScore('WWWWW')).toBeCloseTo(1.0, 2);
    });

    it('should return 0.0 for all losses', () => {
      expect(formToScore('LLLLL')).toBeCloseTo(0.0, 2);
    });

    it('should return ~0.4 for all draws', () => {
      expect(formToScore('DDDDD')).toBeCloseTo(0.4, 2);
    });

    it('should weight recent results more heavily', () => {
      const recentWin = formToScore('WLLLL');
      const lateWin = formToScore('LLLLW');
      expect(recentWin).toBeGreaterThan(lateWin);
    });

    it('should handle mixed form correctly', () => {
      const mixedForm = formToScore('WDLWD');
      expect(mixedForm).toBeGreaterThan(0.3);
      expect(mixedForm).toBeLessThan(0.7);
    });

    it('should handle lowercase input', () => {
      expect(formToScore('wwwww')).toBeCloseTo(1.0, 2);
    });
  });

  describe('oddsToImpliedProb', () => {
    it('should return 0.5 for odds of 2.0', () => {
      expect(oddsToImpliedProb(2.0)).toBe(0.5);
    });

    it('should return 0 for invalid odds <= 1', () => {
      expect(oddsToImpliedProb(1.0)).toBe(0);
      expect(oddsToImpliedProb(0.5)).toBe(0);
    });

    it('should return correct value for favorite odds', () => {
      expect(oddsToImpliedProb(1.5)).toBeCloseTo(0.667, 2);
    });

    it('should return correct value for underdog odds', () => {
      expect(oddsToImpliedProb(4.0)).toBe(0.25);
    });
  });

  describe('calculateValue', () => {
    it('should return positive value when probability > implied', () => {
      const value = calculateValue(0.6, 2.0);
      expect(value).toBeGreaterThan(0);
    });

    it('should return negative value when probability < implied', () => {
      const value = calculateValue(0.4, 2.0);
      expect(value).toBeLessThan(0);
    });

    it('should return 0 for invalid odds', () => {
      expect(calculateValue(0.5, 1.0)).toBe(0);
      expect(calculateValue(0.5, 0)).toBe(0);
    });

    it('should calculate correct value percentage', () => {
      const value = calculateValue(0.6, 2.0);
      expect(value).toBeCloseTo(20, 1);
    });
  });

  describe('normalizeProbabilities', () => {
    it('should normalize probabilities to sum to 1', () => {
      const probs = [0.5, 0.3, 0.4];
      const normalized = normalizeProbabilities(probs);
      const sum = normalized.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 5);
    });

    it('should handle zero sum array', () => {
      const probs = [0, 0, 0];
      const normalized = normalizeProbabilities(probs);
      expect(normalized).toEqual([1/3, 1/3, 1/3]);
    });

    it('should preserve relative proportions', () => {
      const probs = [0.4, 0.2];
      const normalized = normalizeProbabilities(probs);
      expect(normalized[0] / normalized[1]).toBeCloseTo(2, 5);
    });
  });

  describe('calculateExpectedGoals', () => {
    it('should apply home advantage correctly', () => {
      const withHome = calculateExpectedGoals(1.0, 1.0, 1.35, 1.15);
      const withoutHome = calculateExpectedGoals(1.0, 1.0, 1.35, 1.0);
      expect(withHome).toBeGreaterThan(withoutHome);
    });

    it('should increase with attack strength', () => {
      const weak = calculateExpectedGoals(0.8, 1.0);
      const strong = calculateExpectedGoals(1.2, 1.0);
      expect(strong).toBeGreaterThan(weak);
    });

    it('should increase with defense weakness', () => {
      const solid = calculateExpectedGoals(1.0, 0.8);
      const weak = calculateExpectedGoals(1.0, 1.2);
      expect(weak).toBeGreaterThan(solid);
    });
  });
});

describe('Value Bet Detection', () => {
  it('should identify strong value when probability exceeds implied by 20%+', () => {
    const probability = 0.65;
    const odds = 2.0;
    const value = calculateValue(probability, odds);
    const isStrongValue = value >= 20;
    expect(isStrongValue).toBe(true);
  });

  it('should identify moderate value when probability exceeds implied by 10-20%', () => {
    const probability = 0.55;
    const odds = 2.0;
    const value = calculateValue(probability, odds);
    const isModerateValue = value >= 10 && value < 20;
    expect(isModerateValue).toBe(true);
  });

  it('should identify no value when probability is close to or below implied', () => {
    const probability = 0.48;
    const odds = 2.0;
    const value = calculateValue(probability, odds);
    const isNoValue = value < 10;
    expect(isNoValue).toBe(true);
  });
});
