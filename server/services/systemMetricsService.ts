/**
 * System Metrics Service V2
 * 
 * Centralized metrics aggregation:
 * - Global health score
 * - Ulysse Intelligence Score (Brain + ActionQuality + Capabilities)
 * - Real-time system status
 */

import { db } from "../db";
import { actionLogs, knowledgeBase, capabilityRegistry, brainStatistics, ulysseMemory, conversations } from "@shared/schema";
import { eq, desc, gte, and, sql, or } from "drizzle-orm";
import { capabilityService } from "./capabilityService";

const LOG_PREFIX = "[SystemMetrics]";

export interface SystemMetrics {
  healthScore: number;
  intelligenceScore: number;
  status: "healthy" | "degraded" | "critical";
  components: ComponentHealth[];
  timestamp: Date;
  
  details: {
    capabilities: CapabilityMetrics;
    actions: ActionMetrics;
    brain: BrainMetrics;
    trading?: TradingMetrics;
    sports?: SportsMetrics;
    general?: GeneralMetrics;
  };
}

export interface ComponentHealth {
  name: string;
  status: "ok" | "degraded" | "down";
  score: number;
  lastCheck: Date;
  message?: string;
}

export interface CapabilityMetrics {
  total: number;
  available: number;
  degraded: number;
  unavailable: number;
  averageSuccessRate: number;
}

export interface ActionMetrics {
  last24h: {
    total: number;
    successful: number;
    failed: number;
    successRate: number;
  };
  last7d: {
    total: number;
    successful: number;
    failed: number;
    successRate: number;
    averageScore: number;
  };
}

export interface BrainMetrics {
  totalKnowledge: number;
  recentAdditions: number;
  averageImportance: number;
  averageConfidence: number;
  topCategories: { category: string; count: number }[];
  graphConnections: number;
}

export interface TradingMetrics {
  recentAnalyses: number;
  activeAlerts: number;
  watchlistSize: number;
  rulesCount: number;
  lastAnalysisDate: Date | null;
  coherenceScore: number;
}

export interface SportsMetrics {
  recentPredictions: number;
  wins: number;
  losses: number;
  pending: number;
  winRate: number;
  bankrollRulesCount: number;
  lastPredictionDate: Date | null;
}

export interface GeneralMetrics {
  totalConversations: number;
  recentSearches: number;
  filesGenerated: number;
  emailsSent: number;
  calendarEvents: number;
  memoryEntries: number;
  lastInteractionDate: Date | null;
}

class SystemMetricsService {
  private metricsCache: Map<number, { metrics: SystemMetrics; timestamp: number }> = new Map();
  private cacheTTL = 60 * 1000; // 1 minute

  async getMetrics(userId: number): Promise<SystemMetrics> {
    const cached = this.metricsCache.get(userId);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.metrics;
    }
    
    console.log(`${LOG_PREFIX} Computing metrics for user ${userId}`);
    
    const [capabilities, actions, brain, trading, sports, general] = await Promise.all([
      this.getCapabilityMetrics(),
      this.getActionMetrics(userId),
      this.getBrainMetrics(userId),
      this.getTradingMetrics(userId),
      this.getSportsMetrics(userId),
      this.getGeneralMetrics(userId)
    ]);
    
    const components = await this.getComponentHealth();
    
    const healthScore = this.calculateHealthScore(capabilities, actions, components);
    const intelligenceScore = this.calculateIntelligenceScore(brain, actions, capabilities);
    
    const status = healthScore >= 80 ? "healthy" : healthScore >= 50 ? "degraded" : "critical";
    
    const metrics: SystemMetrics = {
      healthScore,
      intelligenceScore,
      status,
      components,
      timestamp: new Date(),
      details: {
        capabilities,
        actions,
        brain,
        trading,
        sports,
        general
      }
    };
    
    this.metricsCache.set(userId, { metrics, timestamp: Date.now() });
    
    return metrics;
  }

  private async getCapabilityMetrics(): Promise<CapabilityMetrics> {
    try {
      const snapshot = await capabilityService.getCapabilitySnapshot();
      
      const available = snapshot.capabilities.filter(c => c.isAvailable).length;
      const degraded = snapshot.capabilities.filter(c => c.isAvailable && c.successRate < 70).length;
      const unavailable = snapshot.capabilities.filter(c => !c.isAvailable).length;
      
      const avgSuccessRate = snapshot.capabilities.length > 0
        ? snapshot.capabilities.reduce((sum, c) => sum + c.successRate, 0) / snapshot.capabilities.length
        : 0;
      
      return {
        total: snapshot.capabilities.length,
        available,
        degraded,
        unavailable,
        averageSuccessRate: Math.round(avgSuccessRate)
      };
    } catch (error) {
      console.error(`${LOG_PREFIX} Capability metrics error:`, error);
      return {
        total: 0,
        available: 0,
        degraded: 0,
        unavailable: 0,
        averageSuccessRate: 0
      };
    }
  }

  private async getActionMetrics(userId: number): Promise<ActionMetrics> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    try {
      const actions24h = await db.select({
        status: actionLogs.status,
        overallScore: actionLogs.overallScore
      })
      .from(actionLogs)
      .where(and(
        eq(actionLogs.userId, userId),
        gte(actionLogs.startedAt, oneDayAgo)
      ));
      
      const actions7d = await db.select({
        status: actionLogs.status,
        overallScore: actionLogs.overallScore
      })
      .from(actionLogs)
      .where(and(
        eq(actionLogs.userId, userId),
        gte(actionLogs.startedAt, sevenDaysAgo)
      ));
      
      const success24h = actions24h.filter(a => a.status === "completed").length;
      const failed24h = actions24h.filter(a => a.status === "failed").length;
      
      const success7d = actions7d.filter(a => a.status === "completed").length;
      const failed7d = actions7d.filter(a => a.status === "failed").length;
      
      const scores7d = actions7d
        .filter(a => a.overallScore !== null)
        .map(a => a.overallScore as number);
      const avgScore7d = scores7d.length > 0
        ? scores7d.reduce((sum, s) => sum + s, 0) / scores7d.length
        : 0;
      
      return {
        last24h: {
          total: actions24h.length,
          successful: success24h,
          failed: failed24h,
          successRate: actions24h.length > 0 ? Math.round((success24h / actions24h.length) * 100) : 100
        },
        last7d: {
          total: actions7d.length,
          successful: success7d,
          failed: failed7d,
          successRate: actions7d.length > 0 ? Math.round((success7d / actions7d.length) * 100) : 100,
          averageScore: Math.round(avgScore7d)
        }
      };
    } catch (error) {
      console.error(`${LOG_PREFIX} Action metrics error:`, error);
      return {
        last24h: { total: 0, successful: 0, failed: 0, successRate: 100 },
        last7d: { total: 0, successful: 0, failed: 0, successRate: 100, averageScore: 0 }
      };
    }
  }

  private async getBrainMetrics(userId: number): Promise<BrainMetrics> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    try {
      const [knowledgeStats] = await db.select({
        total: sql<number>`count(*)`,
        avgImportance: sql<number>`avg(${knowledgeBase.importance})`,
        avgConfidence: sql<number>`avg(${knowledgeBase.confidence})`
      })
      .from(knowledgeBase)
      .where(eq(knowledgeBase.userId, userId));
      
      const [recentStats] = await db.select({
        count: sql<number>`count(*)`
      })
      .from(knowledgeBase)
      .where(and(
        eq(knowledgeBase.userId, userId),
        gte(knowledgeBase.createdAt, sevenDaysAgo)
      ));
      
      const categoryStats = await db.select({
        category: knowledgeBase.category,
        count: sql<number>`count(*)`
      })
      .from(knowledgeBase)
      .where(eq(knowledgeBase.userId, userId))
      .groupBy(knowledgeBase.category)
      .orderBy(desc(sql`count(*)`))
      .limit(5);
      
      const [brainStats] = await db.select()
        .from(brainStatistics)
        .where(eq(brainStatistics.userId, userId))
        .limit(1);
      
      return {
        totalKnowledge: Number(knowledgeStats?.total) || 0,
        recentAdditions: Number(recentStats?.count) || 0,
        averageImportance: Math.round(Number(knowledgeStats?.avgImportance) || 0),
        averageConfidence: Math.round(Number(knowledgeStats?.avgConfidence) || 0),
        topCategories: categoryStats.map(c => ({ 
          category: c.category, 
          count: Number(c.count) 
        })),
        graphConnections: brainStats?.totalConnections || 0
      };
    } catch (error) {
      console.error(`${LOG_PREFIX} Brain metrics error:`, error);
      return {
        totalKnowledge: 0,
        recentAdditions: 0,
        averageImportance: 0,
        averageConfidence: 0,
        topCategories: [],
        graphConnections: 0
      };
    }
  }

  private async getTradingMetrics(userId: number): Promise<TradingMetrics> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    try {
      const [tradingKnowledge] = await db.select({
        total: sql<number>`count(*)`,
        lastDate: sql<Date>`max(${knowledgeBase.createdAt})`
      })
      .from(knowledgeBase)
      .where(and(
        eq(knowledgeBase.userId, userId),
        or(
          eq(knowledgeBase.category, "trading"),
          eq(knowledgeBase.category, "finance")
        ),
        gte(knowledgeBase.createdAt, sevenDaysAgo)
      ));
      
      const tradingRules = await db.select()
        .from(ulysseMemory)
        .where(and(
          eq(ulysseMemory.userId, userId),
          or(
            sql`LOWER(${ulysseMemory.key}) LIKE '%trading%'`,
            sql`LOWER(${ulysseMemory.key}) LIKE '%risk%'`,
            sql`LOWER(${ulysseMemory.key}) LIKE '%position%'`
          )
        ));
      
      const watchlistMemory = await db.select()
        .from(ulysseMemory)
        .where(and(
          eq(ulysseMemory.userId, userId),
          sql`LOWER(${ulysseMemory.key}) LIKE '%watchlist%'`
        ))
        .limit(1);
      
      let watchlistSize = 0;
      if (watchlistMemory.length > 0) {
        try {
          const parsed = JSON.parse(watchlistMemory[0].value);
          watchlistSize = Array.isArray(parsed) ? parsed.length : 0;
        } catch {
          watchlistSize = 0;
        }
      }
      
      const tradingActions = await db.select({
        status: actionLogs.status,
        overallScore: actionLogs.overallScore
      })
      .from(actionLogs)
      .where(and(
        eq(actionLogs.userId, userId),
        eq(actionLogs.actionCategory, "trading"),
        gte(actionLogs.startedAt, sevenDaysAgo)
      ));
      
      const scores = tradingActions
        .filter(a => a.overallScore !== null)
        .map(a => a.overallScore as number);
      const coherenceScore = scores.length > 0
        ? Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length)
        : 50;
      
      return {
        recentAnalyses: Number(tradingKnowledge?.total) || 0,
        activeAlerts: 0,
        watchlistSize,
        rulesCount: tradingRules.length,
        lastAnalysisDate: tradingKnowledge?.lastDate || null,
        coherenceScore
      };
    } catch (error) {
      console.error(`${LOG_PREFIX} Trading metrics error:`, error);
      return {
        recentAnalyses: 0,
        activeAlerts: 0,
        watchlistSize: 0,
        rulesCount: 0,
        lastAnalysisDate: null,
        coherenceScore: 50
      };
    }
  }

  private async getSportsMetrics(userId: number): Promise<SportsMetrics> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    try {
      const sportsKnowledge = await db.select()
        .from(knowledgeBase)
        .where(and(
          eq(knowledgeBase.userId, userId),
          eq(knowledgeBase.category, "sports"),
          gte(knowledgeBase.createdAt, thirtyDaysAgo)
        ))
        .orderBy(desc(knowledgeBase.createdAt));
      
      let wins = 0, losses = 0, pending = 0;
      let lastPredictionDate: Date | null = null;
      
      for (const k of sportsKnowledge) {
        if (k.type === "prediction" || k.title.toLowerCase().includes("prono")) {
          if (!lastPredictionDate) lastPredictionDate = k.createdAt;
          
          const status = (k.summary || "").toLowerCase();
          if (status.includes("gagne") || status.includes("win") || status.includes("won")) wins++;
          else if (status.includes("perdu") || status.includes("loss") || status.includes("lost")) losses++;
          else pending++;
        }
      }
      
      const bankrollRules = await db.select()
        .from(ulysseMemory)
        .where(and(
          eq(ulysseMemory.userId, userId),
          or(
            sql`LOWER(${ulysseMemory.key}) LIKE '%bankroll%'`,
            sql`LOWER(${ulysseMemory.key}) LIKE '%stake%'`,
            sql`LOWER(${ulysseMemory.key}) LIKE '%mise%'`
          )
        ));
      
      const total = wins + losses;
      const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
      
      return {
        recentPredictions: sportsKnowledge.length,
        wins,
        losses,
        pending,
        winRate,
        bankrollRulesCount: bankrollRules.length,
        lastPredictionDate
      };
    } catch (error) {
      console.error(`${LOG_PREFIX} Sports metrics error:`, error);
      return {
        recentPredictions: 0,
        wins: 0,
        losses: 0,
        pending: 0,
        winRate: 0,
        bankrollRulesCount: 0,
        lastPredictionDate: null
      };
    }
  }

  private async getGeneralMetrics(userId: number): Promise<GeneralMetrics> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    try {
      const [conversationCount] = await db.select({
        count: sql<number>`count(*)`
      })
      .from(conversations)
      .where(and(
        eq(conversations.userId, userId),
        gte(conversations.createdAt, thirtyDaysAgo)
      ));
      
      const actionCounts = await db.select({
        category: actionLogs.actionCategory,
        count: sql<number>`count(*)`
      })
      .from(actionLogs)
      .where(and(
        eq(actionLogs.userId, userId),
        gte(actionLogs.startedAt, thirtyDaysAgo)
      ))
      .groupBy(actionLogs.actionCategory);
      
      const categoryMap = new Map(actionCounts.map(a => [a.category, Number(a.count)]));
      
      const [memoryCount] = await db.select({
        count: sql<number>`count(*)`
      })
      .from(ulysseMemory)
      .where(eq(ulysseMemory.userId, userId));
      
      const [lastAction] = await db.select({
        date: actionLogs.startedAt
      })
      .from(actionLogs)
      .where(eq(actionLogs.userId, userId))
      .orderBy(desc(actionLogs.startedAt))
      .limit(1);
      
      return {
        totalConversations: Number(conversationCount?.count) || 0,
        recentSearches: categoryMap.get("recherche") || 0,
        filesGenerated: categoryMap.get("fichiers") || 0,
        emailsSent: categoryMap.get("email") || 0,
        calendarEvents: categoryMap.get("calendrier") || 0,
        memoryEntries: Number(memoryCount?.count) || 0,
        lastInteractionDate: lastAction?.date || null
      };
    } catch (error) {
      console.error(`${LOG_PREFIX} General metrics error:`, error);
      return {
        totalConversations: 0,
        recentSearches: 0,
        filesGenerated: 0,
        emailsSent: 0,
        calendarEvents: 0,
        memoryEntries: 0,
        lastInteractionDate: null
      };
    }
  }

  private async getComponentHealth(): Promise<ComponentHealth[]> {
    const components: ComponentHealth[] = [];
    const now = new Date();
    
    try {
      await db.execute(sql`SELECT 1`);
      components.push({
        name: "database",
        status: "ok",
        score: 100,
        lastCheck: now
      });
    } catch {
      components.push({
        name: "database",
        status: "down",
        score: 0,
        lastCheck: now,
        message: "Database connection failed"
      });
    }
    
    if (process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
      components.push({
        name: "openai",
        status: "ok",
        score: 100,
        lastCheck: now
      });
    } else {
      components.push({
        name: "openai",
        status: "down",
        score: 0,
        lastCheck: now,
        message: "API key not configured"
      });
    }
    
    components.push({
      name: "memory",
      status: "ok",
      score: 100,
      lastCheck: now
    });
    
    return components;
  }

  private calculateHealthScore(
    capabilities: CapabilityMetrics,
    actions: ActionMetrics,
    components: ComponentHealth[]
  ): number {
    const capScore = capabilities.total > 0
      ? (capabilities.available / capabilities.total) * 100
      : 100;
    
    const actionScore = actions.last24h.successRate;
    
    const componentScore = components.length > 0
      ? (components.filter(c => c.status === "ok").length / components.length) * 100
      : 100;
    
    const weights = {
      capabilities: 0.3,
      actions: 0.3,
      components: 0.4
    };
    
    return Math.round(
      capScore * weights.capabilities +
      actionScore * weights.actions +
      componentScore * weights.components
    );
  }

  private calculateIntelligenceScore(
    brain: BrainMetrics,
    actions: ActionMetrics,
    capabilities: CapabilityMetrics
  ): number {
    const knowledgeScore = Math.min(100, (brain.totalKnowledge / 100) * 50 + 
      (brain.averageConfidence * 0.3) + (brain.averageImportance * 0.2));
    
    const actionQualityScore = actions.last7d.averageScore || 50;
    
    const capabilityScore = capabilities.averageSuccessRate;
    
    const learningBonus = Math.min(20, brain.recentAdditions * 2);
    
    const connectionBonus = Math.min(10, brain.graphConnections / 100);
    
    const weights = {
      knowledge: 0.35,
      actionQuality: 0.30,
      capabilities: 0.25,
      learning: 0.10
    };
    
    const baseScore = 
      knowledgeScore * weights.knowledge +
      actionQualityScore * weights.actionQuality +
      capabilityScore * weights.capabilities +
      learningBonus;
    
    return Math.min(100, Math.round(baseScore + connectionBonus));
  }

  async getQuickStatus(userId: number): Promise<{
    health: "ok" | "degraded" | "critical";
    confidence: "high" | "medium" | "low";
    message: string;
  }> {
    try {
      const metrics = await this.getMetrics(userId);
      
      const health = metrics.healthScore >= 80 ? "ok" : metrics.healthScore >= 50 ? "degraded" : "critical";
      const confidence = metrics.intelligenceScore >= 70 ? "high" : metrics.intelligenceScore >= 40 ? "medium" : "low";
      
      let message = "";
      if (health === "critical") {
        message = "Système en mode critique - fonctionnalités limitées";
      } else if (health === "degraded") {
        message = "Certaines capacités sont dégradées";
      } else if (confidence === "low") {
        message = "Base de connaissances à enrichir";
      } else {
        message = "Tous les systèmes opérationnels";
      }
      
      return { health, confidence, message };
    } catch (error) {
      return {
        health: "degraded",
        confidence: "low",
        message: "Impossible de récupérer les métriques"
      };
    }
  }

  invalidateCache(userId?: number): void {
    if (userId) {
      this.metricsCache.delete(userId);
    } else {
      this.metricsCache.clear();
    }
  }
}

export const systemMetricsService = new SystemMetricsService();
