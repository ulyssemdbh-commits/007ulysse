/**
 * Unified Context Service v2
 * Central orchestrator for all context layers: Core, Live, Domain
 * Single source of truth for AI context generation
 */

import { db } from "../db";
import { users, learningProgress } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { contextCacheService } from "./context/cache";
import { getPreloadedContext, startPreloading } from "./context/preloader";
import { codeContextOrchestrator } from "./codeContextOrchestrator";
import { requestAnalysisService, type RequestAnalysis, type RequestDomain } from "./requestAnalysisService";
import { marsAuditContextService } from "./marsAuditContextService";
import { sportsContextBuilder } from "./sportsContextBuilder";
import { buildNavigationContext } from "../config/appNavigation";

export interface CoreContext {
  systemPrompt: string;
  recentMemories: string[];
  importantKnowledge: string[];
  devContext?: string;
}

export interface LiveContext {
  timeContext?: string;
  calendarContext?: string;
  memoryContext?: string;
  spotifyContext?: string;
  geolocationContext?: string;
}

export interface DomainContexts {
  codeContext?: string;
  sportsContext?: string;
  learningContext?: string;
  navigationContext?: string;
}

export interface UnifiedContext {
  userId: number;
  analysis: RequestAnalysis;
  core: CoreContext;
  live: LiveContext;
  domain: DomainContexts;
  builtAt: number;
  latencyMs: number;
}

interface ContextMetrics {
  coreLatencyMs: number;
  liveLatencyMs: number;
  domainLatencyMs: number;
  totalLatencyMs: number;
}

const metricsHistory: ContextMetrics[] = [];
const MAX_METRICS_HISTORY = 100;

export const unifiedContextService = {
  async getUnifiedContext(
    userId: number,
    userMessage: string,
    pageContext?: { agent?: string; pageId?: string; tabId?: string }
  ): Promise<UnifiedContext> {
    const startTime = Date.now();

    const isOwner = await this.isOwner(userId);
    const analysis = requestAnalysisService.analyze(userMessage, isOwner);
    
    console.log(`[UnifiedContext] Domain detected: ${analysis.domain} (confidence: ${analysis.confidence})`);

    const coreStart = Date.now();
    const coreContext = await this.getCoreContext(userId);
    const coreLatency = Date.now() - coreStart;

    const liveStart = Date.now();
    const liveContext = await this.getLiveContext(userId);
    const liveLatency = Date.now() - liveStart;

    const domainStart = Date.now();
    const domainContext = await this.getDomainContexts(userId, userMessage, analysis);
    if (pageContext?.agent) {
      domainContext.navigationContext = buildNavigationContext(
        pageContext.agent,
        pageContext.pageId,
        pageContext.tabId
      );
    }
    const domainLatency = Date.now() - domainStart;

    const totalLatency = Date.now() - startTime;

    const unified: UnifiedContext = {
      userId,
      analysis,
      core: coreContext,
      live: liveContext,
      domain: domainContext,
      builtAt: Date.now(),
      latencyMs: totalLatency
    };

    marsAuditContextService.recordContextSnapshot({
      userId,
      analysis,
      hasCore: true,
      hasLiveTime: !!liveContext.timeContext,
      hasLiveCalendar: !!liveContext.calendarContext,
      hasLiveSpotify: !!liveContext.spotifyContext,
      hasLiveGeo: !!liveContext.geolocationContext,
      hasLiveMemory: !!liveContext.memoryContext,
      hasCodeContext: !!domainContext.codeContext,
      hasSportsContext: !!domainContext.sportsContext,
      builtAt: unified.builtAt
    });

    metricsHistory.unshift({
      coreLatencyMs: coreLatency,
      liveLatencyMs: liveLatency,
      domainLatencyMs: domainLatency,
      totalLatencyMs: totalLatency
    });
    if (metricsHistory.length > MAX_METRICS_HISTORY) {
      metricsHistory.pop();
    }

    console.log(`[UnifiedContext] Built in ${totalLatency}ms (core: ${coreLatency}ms, live: ${liveLatency}ms, domain: ${domainLatency}ms)`);

    return unified;
  },

  async isOwner(userId: number): Promise<boolean> {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      return !!user?.isOwner;
    } catch {
      return false;
    }
  },

  async getCoreContext(userId: number): Promise<CoreContext> {
    try {
      const cached = await contextCacheService.buildContext(userId, false);
      return {
        systemPrompt: cached.systemPrompt,
        recentMemories: cached.recentMemories,
        importantKnowledge: cached.importantKnowledge,
        devContext: cached.devContext
      };
    } catch (error) {
      console.error("[UnifiedContext] Core context error:", error);
      return {
        systemPrompt: "",
        recentMemories: [],
        importantKnowledge: []
      };
    }
  },

  async getLiveContext(userId: number): Promise<LiveContext> {
    const preloaded = getPreloadedContext(userId);

    if (!preloaded) {
      startPreloading(userId).catch(err =>
        console.error("[UnifiedContext] Preload failed:", err)
      );
      return {};
    }

    return {
      timeContext: preloaded.timeContext || undefined,
      calendarContext: preloaded.calendarContext || undefined,
      memoryContext: preloaded.memoryContext || undefined,
      spotifyContext: preloaded.spotifyContext || undefined,
      geolocationContext: preloaded.geolocationContext || undefined
    };
  },

  async getDomainContexts(
    userId: number,
    userMessage: string,
    analysis: RequestAnalysis
  ): Promise<DomainContexts> {
    const domain: DomainContexts = {};

    const tasks: Promise<void>[] = [];

    if (analysis.domain === "code" || analysis.domain === "dev_diagnostics") {
      tasks.push((async () => {
        try {
          const result = await codeContextOrchestrator.checkAndGetContextForMessage(
            userId,
            userMessage
          );
          if (result.context) {
            domain.codeContext = result.context;
          }
        } catch (error) {
          console.error("[UnifiedContext] Code context error:", error);
        }
      })());
    }

    tasks.push((async () => {
      try {
        const learningCtx = await this.getLearningContext(userId, analysis.domain);
        if (learningCtx) {
          domain.learningContext = learningCtx;
        }
      } catch (error) {
        console.error("[UnifiedContext] Learning context error:", error);
      }
    })());

    if (analysis.domain === "sports" || analysis.domain === "betting") {
      tasks.push((async () => {
        try {
          const sportsCtx = await sportsContextBuilder.buildContextForMessage(userId, userMessage);
          if (sportsCtx) {
            domain.sportsContext = sportsCtx;
          }
        } catch (error) {
          console.error("[UnifiedContext] Sports context error:", error);
        }
      })());
    }

    await Promise.all(tasks);

    return domain;
  },

  buildPromptFromContext(unified: UnifiedContext): string {
    const parts: string[] = [];
    const domain = unified.analysis.domain;

    if (unified.core.systemPrompt) {
      parts.push(unified.core.systemPrompt);
    }

    if (unified.core.recentMemories.length > 0) {
      parts.push("\n📝 MÉMOIRE RÉCENTE:");
      parts.push(unified.core.recentMemories.join("\n"));
    }

    if (unified.core.importantKnowledge.length > 0) {
      parts.push("\n📚 CONNAISSANCES:");
      parts.push(unified.core.importantKnowledge.join("\n"));
    }

    if (unified.core.devContext) {
      parts.push("\n🔧 CONTEXTE DEV:");
      parts.push(unified.core.devContext);
    }

    const CALENDAR_DOMAINS: RequestDomain[] = ["calendar", "general", "email"];
    const MUSIC_DOMAINS: RequestDomain[] = ["music", "general"];

    const liveItems: string[] = [];
    if (unified.live.timeContext) liveItems.push(unified.live.timeContext);
    if (unified.live.calendarContext && CALENDAR_DOMAINS.includes(domain)) {
      liveItems.push(unified.live.calendarContext);
    }
    if (unified.live.spotifyContext && MUSIC_DOMAINS.includes(domain)) {
      liveItems.push(unified.live.spotifyContext);
    }
    if (unified.live.geolocationContext) liveItems.push(unified.live.geolocationContext);
    
    if (liveItems.length > 0) {
      parts.push("\n⏱️ CONTEXTE TEMPS RÉEL:");
      parts.push(liveItems.join("\n"));
    }

    if (unified.domain.codeContext) {
      parts.push("\n💻 CONTEXTE CODE:");
      parts.push(unified.domain.codeContext);
    }

    if (unified.domain.sportsContext) {
      parts.push(unified.domain.sportsContext);
    }

    if (unified.domain.learningContext) {
      parts.push("\n" + unified.domain.learningContext);
    }

    if (unified.domain.navigationContext) {
      parts.push("\n🗺️ " + unified.domain.navigationContext);
    }

    return parts.join("\n");
  },

  getMetrics(): {
    avgLatency: number;
    p95Latency: number;
    breakdown: {
      core: number;
      live: number;
      domain: number;
    };
    sampleCount: number;
  } {
    if (metricsHistory.length === 0) {
      return {
        avgLatency: 0,
        p95Latency: 0,
        breakdown: { core: 0, live: 0, domain: 0 },
        sampleCount: 0
      };
    }

    const totals = metricsHistory.map(m => m.totalLatencyMs);
    const sorted = [...totals].sort((a, b) => a - b);
    
    const avg = Math.round(totals.reduce((a, b) => a + b, 0) / totals.length);
    const p95Index = Math.floor(sorted.length * 0.95);
    const p95 = sorted[p95Index] || sorted[sorted.length - 1];

    const avgCore = Math.round(
      metricsHistory.reduce((a, m) => a + m.coreLatencyMs, 0) / metricsHistory.length
    );
    const avgLive = Math.round(
      metricsHistory.reduce((a, m) => a + m.liveLatencyMs, 0) / metricsHistory.length
    );
    const avgDomain = Math.round(
      metricsHistory.reduce((a, m) => a + m.domainLatencyMs, 0) / metricsHistory.length
    );

    return {
      avgLatency: avg,
      p95Latency: p95,
      breakdown: {
        core: avgCore,
        live: avgLive,
        domain: avgDomain
      },
      sampleCount: metricsHistory.length
    };
  },

  getAuditStats() {
    return marsAuditContextService.getAuditStats();
  },

  clearCaches(userId?: number): void {
    if (userId) {
      sportsContextBuilder.clearCache(userId);
    } else {
      sportsContextBuilder.clearCache();
    }
    console.log("[UnifiedContext] Caches cleared");
  },

  async getLearningContext(userId: number, domain: RequestDomain): Promise<string | null> {
    try {
      const domainMapping: Record<string, string> = {
        "sports": "sports",
        "betting": "sports", 
        "code": "dev",
        "dev_diagnostics": "dev",
        "finance": "trading",
        "trading": "trading",
        "general": "autre"
      };

      const targetDomain = domainMapping[domain] || "autre";

      const topPatterns = await db.select().from(learningProgress)
        .where(and(
          eq(learningProgress.userId, userId),
          eq(learningProgress.domain, targetDomain)
        ))
        .orderBy(desc(learningProgress.usefulnessScore))
        .limit(5);

      if (topPatterns.length === 0) return null;

      const highConfidence = topPatterns.filter(p => ((p as any).confidenceScore || 50) >= 70);
      
      if (highConfidence.length === 0) return null;

      const lines = highConfidence.map(p => {
        const conf = (p as any).confidenceScore || 50;
        const type = (p as any).patternType || "general";
        return `• ${p.topic} (${type}, conf: ${conf}%)`;
      });

      return `[PATTERNS APPRIS - ${targetDomain.toUpperCase()}]\n${lines.join("\n")}`;
    } catch (error) {
      console.error("[UnifiedContext] Learning context error:", error);
      return null;
    }
  }
};

export { RequestDomain, RequestAnalysis };
