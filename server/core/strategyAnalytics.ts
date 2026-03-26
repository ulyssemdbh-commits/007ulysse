/**
 * Strategy Analytics - Track and analyze scraping strategy performance
 * Provides insights for optimizing the strategy selection
 */

import { getAllProfiles } from './domainProfileService';
import { RenderStrategy, DomainProfile, ALL_STRATEGIES } from './strategyTypes';
import { getRateLimitStats } from './rateLimiter';

interface StrategyStats {
  strategy: RenderStrategy;
  totalAttempts: number;
  successCount: number;
  successRate: number;
  avgQualityScore: number;
  domainsUsing: number;
}

interface AnalyticsSnapshot {
  timestamp: string;
  totalDomains: number;
  totalAttempts: number;
  totalSuccesses: number;
  overallSuccessRate: number;
  strategyStats: StrategyStats[];
  topDomains: Array<{
    domain: string;
    successCount: number;
    avgQuality: number;
    preferredStrategy: RenderStrategy;
  }>;
  problematicDomains: Array<{
    domain: string;
    attemptCount: number;
    successCount: number;
    failedStrategies: RenderStrategy[];
  }>;
  jsRequiredDomains: number;
  rateLimit: {
    domains: number;
    blockedDomains: number;
  };
}

const strategyAttempts = new Map<RenderStrategy, number>();
const strategySuccesses = new Map<RenderStrategy, number>();
const strategyQualitySum = new Map<RenderStrategy, number>();

export function recordStrategyAttempt(strategy: RenderStrategy, success: boolean, qualityScore: number): void {
  strategyAttempts.set(strategy, (strategyAttempts.get(strategy) || 0) + 1);
  
  if (success) {
    strategySuccesses.set(strategy, (strategySuccesses.get(strategy) || 0) + 1);
    strategyQualitySum.set(strategy, (strategyQualitySum.get(strategy) || 0) + qualityScore);
  }
}

export async function getAnalyticsSnapshot(): Promise<AnalyticsSnapshot> {
  const profiles = await getAllProfiles();
  const rateLimitStats = getRateLimitStats();
  
  const totalDomains = profiles.length;
  const totalAttempts = profiles.reduce((sum, p) => sum + p.successCount + p.failureCount, 0);
  const totalSuccesses = profiles.reduce((sum, p) => sum + p.successCount, 0);
  const overallSuccessRate = totalAttempts > 0 ? totalSuccesses / totalAttempts : 0;
  
  const strategyUsageCount = new Map<RenderStrategy, number>();
  const strategyQualityFromProfiles = new Map<RenderStrategy, number[]>();
  
  for (const profile of profiles) {
    // Count domains using each strategy based on lastSuccessStrategy
    if (profile.lastSuccessStrategy) {
      const strategy = profile.lastSuccessStrategy;
      strategyUsageCount.set(strategy, (strategyUsageCount.get(strategy) || 0) + 1);
      if (!strategyQualityFromProfiles.has(strategy)) {
        strategyQualityFromProfiles.set(strategy, []);
      }
      strategyQualityFromProfiles.get(strategy)!.push(profile.avgQualityScore);
    }
  }
  
  const allStrategies = ALL_STRATEGIES;
  
  const strategyStats: StrategyStats[] = allStrategies.map(strategy => {
    const attempts = strategyAttempts.get(strategy) || 0;
    const successes = strategySuccesses.get(strategy) || 0;
    const qualitySum = strategyQualitySum.get(strategy) || 0;
    const domainsUsing = strategyUsageCount.get(strategy) || 0;
    
    return {
      strategy,
      totalAttempts: attempts,
      successCount: successes,
      successRate: attempts > 0 ? successes / attempts : 0,
      avgQualityScore: successes > 0 ? qualitySum / successes : 0,
      domainsUsing,
    };
  });
  
  const topDomains = [...profiles]
    .filter(p => p.successCount > 0)
    .sort((a, b) => b.avgQualityScore - a.avgQualityScore)
    .slice(0, 10)
    .map(p => ({
      domain: p.domain,
      successCount: p.successCount,
      avgQuality: p.avgQualityScore,
      preferredStrategy: p.lastSuccessStrategy || 'http' as RenderStrategy,
    }));
  
  const problematicDomains = [...profiles]
    .filter(p => {
      const totalAttempts = p.successCount + p.failureCount;
      return totalAttempts > 2 && p.successCount / totalAttempts < 0.5;
    })
    .sort((a, b) => {
      const rateA = a.successCount / (a.successCount + a.failureCount);
      const rateB = b.successCount / (b.successCount + b.failureCount);
      return rateA - rateB;
    })
    .slice(0, 10)
    .map(p => ({
      domain: p.domain,
      attemptCount: p.successCount + p.failureCount,
      successCount: p.successCount,
      failedStrategies: p.failedStrategies,
    }));
  
  const jsRequiredDomains = profiles.filter(p => p.jsRequired).length;
  
  return {
    timestamp: new Date().toISOString(),
    totalDomains,
    totalAttempts,
    totalSuccesses,
    overallSuccessRate,
    strategyStats,
    topDomains,
    problematicDomains,
    jsRequiredDomains,
    rateLimit: {
      domains: rateLimitStats.domains,
      blockedDomains: rateLimitStats.blockedDomains,
    },
  };
}

export function getStrategyRecommendation(jsRequired: boolean, failedStrategies: RenderStrategy[]): RenderStrategy[] {
  const recommendations: RenderStrategy[] = [];
  
  if (jsRequired) {
    if (!failedStrategies.includes('playwright')) recommendations.push('playwright');
    if (!failedStrategies.includes('jina')) recommendations.push('jina');
    if (!failedStrategies.includes('firecrawl') && process.env.FIRECRAWL_API_KEY) {
      recommendations.push('firecrawl');
    }
  } else {
    if (!failedStrategies.includes('http')) recommendations.push('http');
    if (!failedStrategies.includes('jina')) recommendations.push('jina');
  }
  
  if (!failedStrategies.includes('perplexity') && process.env.PERPLEXITY_API_KEY) {
    recommendations.push('perplexity');
  }
  
  if (recommendations.length === 0) {
    return ['perplexity'];
  }
  
  return recommendations;
}

export function resetAnalytics(): void {
  strategyAttempts.clear();
  strategySuccesses.clear();
  strategyQualitySum.clear();
}

// Alias functions for API compatibility
export function getStrategyStats(): Record<RenderStrategy, { total: number; success: number; avgQuality: number }> {
  const allStrategies = ALL_STRATEGIES;
  const result: Record<string, { total: number; success: number; avgQuality: number }> = {};
  
  for (const strategy of allStrategies) {
    const total = strategyAttempts.get(strategy) || 0;
    const success = strategySuccesses.get(strategy) || 0;
    const qualitySum = strategyQualitySum.get(strategy) || 0;
    
    result[strategy] = {
      total,
      success,
      avgQuality: success > 0 ? qualitySum / success : 0,
    };
  }
  
  return result as Record<RenderStrategy, { total: number; success: number; avgQuality: number }>;
}

export function getStrategyInsights(): string[] {
  const stats = getStrategyStats();
  const insights: string[] = [];
  
  // Find best performing strategy
  let bestStrategy: RenderStrategy | null = null;
  let bestRate = 0;
  
  for (const [strategy, data] of Object.entries(stats)) {
    if (data.total >= 5) {
      const rate = data.success / data.total;
      if (rate > bestRate) {
        bestRate = rate;
        bestStrategy = strategy as RenderStrategy;
      }
    }
  }
  
  if (bestStrategy) {
    insights.push(`${bestStrategy} is the best performing strategy with ${(bestRate * 100).toFixed(1)}% success rate`);
  }
  
  // Find underperforming strategies
  for (const [strategy, data] of Object.entries(stats)) {
    if (data.total >= 5 && data.success / data.total < 0.3) {
      insights.push(`${strategy} has low success rate (${((data.success / data.total) * 100).toFixed(1)}%) - consider disabling`);
    }
  }
  
  // Quality insights
  const qualityStrategies = Object.entries(stats)
    .filter(([_, data]) => data.success >= 3)
    .sort((a, b) => b[1].avgQuality - a[1].avgQuality);
  
  if (qualityStrategies.length > 0) {
    const [topQuality, data] = qualityStrategies[0];
    insights.push(`${topQuality} produces highest quality content (avg: ${data.avgQuality.toFixed(2)})`);
  }
  
  return insights;
}

export function resetStrategyStats(): void {
  resetAnalytics();
}
