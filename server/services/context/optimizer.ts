/**
 * Context Optimizer Service
 * 
 * Optimizations for 2x efficiency:
 * 1. Parallel context loading (Trading/Sports/General simultaneously)
 * 2. Smart caching with domain-specific TTL
 * 3. Proactive insights generation
 * 4. Learning feedback loop for score adjustment
 */

import { db } from "../../db";
import { actionLogs } from "@shared/schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { brainContextService } from "../brainContextService";

const LOG_PREFIX = "[ContextOptimizer]";

interface DomainContext {
  domain: string;
  data: any;
  cachedAt: number;
  ttl: number;
}

interface ProactiveInsight {
  type: "warning" | "opportunity" | "reminder" | "suggestion";
  domain: string;
  message: string;
  priority: number;
  actionable: boolean;
  suggestedAction?: string;
}

interface FeedbackEntry {
  actionType: string;
  domain: string;
  success: boolean;
  timestamp: Date;
  adjustmentApplied: number;
}

class ContextOptimizerService {
  private contextCache: Map<string, DomainContext> = new Map();
  private feedbackBuffer: FeedbackEntry[] = [];
  private domainScoreAdjustments: Map<string, number> = new Map();
  private feedbackTimer: NodeJS.Timeout | null = null;
  private cacheHits = 0;
  private cacheMisses = 0;
  
  private readonly DOMAIN_TTL: Record<string, number> = {
    trading: 60 * 1000,      // 1 minute (volatile)
    sports: 5 * 60 * 1000,   // 5 minutes
    general: 10 * 60 * 1000, // 10 minutes
    sugu: 5 * 60 * 1000,     // 5 minutes
    default: 3 * 60 * 1000   // 3 minutes
  };
  
  private readonly FEEDBACK_INTERVAL = 5 * 60 * 1000; // 5 minutes
  
  constructor() {
    this.startFeedbackTimer();
  }
  
  private startFeedbackTimer(): void {
    if (this.feedbackTimer) return;
    this.feedbackTimer = setInterval(() => {
      if (this.feedbackBuffer.length > 0) {
        console.log(`${LOG_PREFIX} Timer processing ${this.feedbackBuffer.length} feedback entries`);
        this.processFeedbackBufferInternal();
      }
    }, this.FEEDBACK_INTERVAL);
    console.log(`${LOG_PREFIX} Feedback timer started (${this.FEEDBACK_INTERVAL / 1000}s interval)`);
  }

  async getFullContext(userId: number): Promise<{
    trading: any;
    sports: any;
    general: any;
    insights: ProactiveInsight[];
    loadTime: number;
  }> {
    const start = Date.now();
    
    const [trading, sports, general] = await Promise.all([
      this.getCachedOrFresh(userId, "trading", () => brainContextService.getTradingContext(userId)),
      this.getCachedOrFresh(userId, "sports", () => brainContextService.getSportsContext(userId)),
      this.getCachedOrFresh(userId, "general", () => brainContextService.getGeneralContext(userId))
    ]);
    
    const insights = await this.generateProactiveInsights(userId, { trading, sports, general });
    
    const loadTime = Date.now() - start;
    console.log(`${LOG_PREFIX} Full context loaded in ${loadTime}ms (parallel)`);
    
    return { trading, sports, general, insights, loadTime };
  }

  private async getCachedOrFresh<T>(
    userId: number, 
    domain: string, 
    fetcher: () => Promise<T>
  ): Promise<T> {
    const cacheKey = `${userId}:${domain}`;
    const cached = this.contextCache.get(cacheKey);
    
    if (cached && Date.now() - cached.cachedAt < cached.ttl) {
      this.cacheHits++;
      console.log(`${LOG_PREFIX} Cache HIT for ${domain}`);
      return cached.data as T;
    }
    
    this.cacheMisses++;
    console.log(`${LOG_PREFIX} Cache MISS for ${domain}, fetching...`);
    const data = await fetcher();
    
    this.contextCache.set(cacheKey, {
      domain,
      data,
      cachedAt: Date.now(),
      ttl: this.DOMAIN_TTL[domain] || this.DOMAIN_TTL.default
    });
    
    return data;
  }

  invalidateCache(userId: number, domain?: string): void {
    if (domain) {
      this.contextCache.delete(`${userId}:${domain}`);
    } else {
      for (const key of this.contextCache.keys()) {
        if (key.startsWith(`${userId}:`)) {
          this.contextCache.delete(key);
        }
      }
    }
    console.log(`${LOG_PREFIX} Cache invalidated for user ${userId}${domain ? `, domain ${domain}` : ""}`);
  }

  private async generateProactiveInsights(
    userId: number,
    contexts: { trading: any; sports: any; general: any }
  ): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];
    
    if (contexts.trading?.errors?.length > 0) {
      insights.push({
        type: "warning",
        domain: "trading",
        message: `${contexts.trading.errors.length} erreur(s) passee(s) a eviter`,
        priority: 1,
        actionable: true,
        suggestedAction: "review_trading_errors"
      });
    }
    
    if (contexts.trading?.rulesCount === 0) {
      insights.push({
        type: "suggestion",
        domain: "trading",
        message: "Aucune regle de trading definie. Definir des regles ameliore la discipline.",
        priority: 2,
        actionable: true,
        suggestedAction: "create_trading_rules"
      });
    }
    
    if (contexts.sports?.performance?.winRate < 40 && contexts.sports?.performance?.wins + contexts.sports?.performance?.losses >= 5) {
      insights.push({
        type: "warning",
        domain: "sports",
        message: `WinRate faible (${contexts.sports.performance.winRate}%). Revoir la strategie.`,
        priority: 1,
        actionable: true,
        suggestedAction: "analyze_betting_patterns"
      });
    }
    
    if (contexts.sports?.performance?.winRate >= 60) {
      insights.push({
        type: "opportunity",
        domain: "sports",
        message: `Excellente forme (${contexts.sports.performance.winRate}% winRate). Periode favorable.`,
        priority: 3,
        actionable: false
      });
    }
    
    if (contexts.sports?.bankrollRules?.length === 0) {
      insights.push({
        type: "suggestion",
        domain: "sports",
        message: "Definir des regles de bankroll pour mieux gerer le capital.",
        priority: 2,
        actionable: true,
        suggestedAction: "create_bankroll_rules"
      });
    }
    
    const recentActions = await this.getRecentActionStats(userId);
    if (recentActions.mostUsed && recentActions.count >= 5) {
      insights.push({
        type: "reminder",
        domain: "general",
        message: `Action frequente: ${recentActions.mostUsed} (${recentActions.count}x cette semaine)`,
        priority: 4,
        actionable: false
      });
    }
    
    return insights.sort((a, b) => a.priority - b.priority);
  }

  private async getRecentActionStats(userId: number): Promise<{ mostUsed: string | null; count: number }> {
    try {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      
      const [result] = await db.select({
        category: actionLogs.actionCategory,
        count: sql<number>`count(*)`
      })
      .from(actionLogs)
      .where(and(
        eq(actionLogs.userId, userId),
        gte(actionLogs.startedAt, weekAgo)
      ))
      .groupBy(actionLogs.actionCategory)
      .orderBy(desc(sql`count(*)`))
      .limit(1);
      
      return {
        mostUsed: result?.category || null,
        count: Number(result?.count) || 0
      };
    } catch {
      return { mostUsed: null, count: 0 };
    }
  }

  recordFeedback(
    userId: number,
    actionType: string,
    domain: string,
    success: boolean
  ): void {
    const entry: FeedbackEntry = {
      actionType,
      domain,
      success,
      timestamp: new Date(),
      adjustmentApplied: 0
    };
    
    this.feedbackBuffer.push(entry);
    
    if (this.feedbackBuffer.length >= 10) {
      this.processFeedbackBufferInternal();
    }
  }

  private processFeedbackBufferInternal(): void {
    const domainStats: Map<string, { successes: number; total: number }> = new Map();
    
    for (const entry of this.feedbackBuffer) {
      const stats = domainStats.get(entry.domain) || { successes: 0, total: 0 };
      stats.total++;
      if (entry.success) stats.successes++;
      domainStats.set(entry.domain, stats);
    }
    
    for (const [domain, stats] of domainStats) {
      const successRate = stats.total > 0 ? stats.successes / stats.total : 0.5;
      const currentAdjustment = this.domainScoreAdjustments.get(domain) || 0;
      
      let newAdjustment = currentAdjustment;
      if (successRate >= 0.8) {
        newAdjustment = Math.min(currentAdjustment + 5, 20);
      } else if (successRate <= 0.3) {
        newAdjustment = Math.max(currentAdjustment - 10, -30);
      }
      
      this.domainScoreAdjustments.set(domain, newAdjustment);
      console.log(`${LOG_PREFIX} Domain ${domain} adjustment: ${currentAdjustment} -> ${newAdjustment} (${Math.round(successRate * 100)}% success)`);
    }
    
    this.feedbackBuffer = [];
  }

  getScoreAdjustment(domain: string): number {
    return this.domainScoreAdjustments.get(domain) || 0;
  }

  async preloadContexts(userId: number): Promise<void> {
    console.log(`${LOG_PREFIX} Preloading contexts for user ${userId}...`);
    await this.getFullContext(userId);
    console.log(`${LOG_PREFIX} Preload complete`);
  }

  getCacheStats(): { size: number; domains: string[]; hitRate: number; adjustments: Record<string, number> } {
    const domains = new Set<string>();
    for (const ctx of this.contextCache.values()) {
      domains.add(ctx.domain);
    }
    
    const totalRequests = this.cacheHits + this.cacheMisses;
    const hitRate = totalRequests > 0 ? Math.round((this.cacheHits / totalRequests) * 100) : 0;
    
    const adjustments: Record<string, number> = {};
    for (const [domain, adj] of this.domainScoreAdjustments) {
      adjustments[domain] = adj;
    }
    
    return {
      size: this.contextCache.size,
      domains: Array.from(domains),
      hitRate,
      adjustments
    };
  }
  
  flushFeedback(): void {
    if (this.feedbackBuffer.length > 0) {
      console.log(`${LOG_PREFIX} Flushing ${this.feedbackBuffer.length} feedback entries`);
      this.processFeedbackBufferInternal();
    }
  }
}

export const contextOptimizerService = new ContextOptimizerService();
