/**
 * MARS Audit Context Service
 * Records context snapshots for MARS audit and analysis
 */

import { metricsService } from "./metricsService";
import type { RequestAnalysis, RequestDomain } from "./requestAnalysisService";

interface UnifiedContextSnapshot {
  userId: number;
  analysis: RequestAnalysis;
  hasCore: boolean;
  hasLiveTime: boolean;
  hasLiveCalendar: boolean;
  hasLiveSpotify: boolean;
  hasLiveGeo: boolean;
  hasLiveMemory: boolean;
  hasCodeContext: boolean;
  hasSportsContext: boolean;
  builtAt: number;
}

interface ContextAuditEntry {
  timestamp: number;
  userId: number;
  domain: RequestDomain;
  contextsPresent: string[];
  requiresHighReliability: boolean;
  confidence: number;
  latencyMs?: number;
}

const auditLog: ContextAuditEntry[] = [];
const MAX_AUDIT_LOG = 500;

const domainStats = new Map<RequestDomain, {
  total: number;
  withSportsContext: number;
  withCodeContext: number;
  withLiveContext: number;
  highReliabilityCount: number;
}>();

export const marsAuditContextService = {
  recordContextSnapshot(snapshot: UnifiedContextSnapshot): void {
    try {
      const contextsPresent: string[] = [];
      if (snapshot.hasCore) contextsPresent.push("core");
      if (snapshot.hasLiveTime) contextsPresent.push("live_time");
      if (snapshot.hasLiveCalendar) contextsPresent.push("live_calendar");
      if (snapshot.hasLiveSpotify) contextsPresent.push("live_spotify");
      if (snapshot.hasLiveGeo) contextsPresent.push("live_geo");
      if (snapshot.hasLiveMemory) contextsPresent.push("live_memory");
      if (snapshot.hasCodeContext) contextsPresent.push("code");
      if (snapshot.hasSportsContext) contextsPresent.push("sports");

      const entry: ContextAuditEntry = {
        timestamp: Date.now(),
        userId: snapshot.userId,
        domain: snapshot.analysis.domain,
        contextsPresent,
        requiresHighReliability: snapshot.analysis.requiresHighReliability,
        confidence: snapshot.analysis.confidence
      };

      auditLog.unshift(entry);
      if (auditLog.length > MAX_AUDIT_LOG) {
        auditLog.pop();
      }

      this.updateDomainStats(snapshot);

      metricsService.recordContextSnapshot({
        userId: snapshot.userId,
        domain: snapshot.analysis.domain,
        hasCore: snapshot.hasCore,
        hasLiveTime: snapshot.hasLiveTime,
        hasLiveCalendar: snapshot.hasLiveCalendar,
        hasLiveGeo: snapshot.hasLiveGeo,
        hasCodeContext: snapshot.hasCodeContext,
        hasSportsContext: snapshot.hasSportsContext,
        requiresHighReliability: snapshot.analysis.requiresHighReliability
      });

      console.log(`[MARS_AUDIT] Context recorded: domain=${snapshot.analysis.domain}, contexts=[${contextsPresent.join(",")}]`);
    } catch (err) {
      console.error("[MARS_AUDIT] Failed to record context snapshot:", err);
    }
  },

  updateDomainStats(snapshot: UnifiedContextSnapshot): void {
    const domain = snapshot.analysis.domain;
    const existing = domainStats.get(domain) || {
      total: 0,
      withSportsContext: 0,
      withCodeContext: 0,
      withLiveContext: 0,
      highReliabilityCount: 0
    };

    existing.total++;
    if (snapshot.hasSportsContext) existing.withSportsContext++;
    if (snapshot.hasCodeContext) existing.withCodeContext++;
    if (snapshot.hasLiveTime || snapshot.hasLiveCalendar || snapshot.hasLiveGeo) {
      existing.withLiveContext++;
    }
    if (snapshot.analysis.requiresHighReliability) {
      existing.highReliabilityCount++;
    }

    domainStats.set(domain, existing);
  },

  getAuditStats(): {
    totalRequests: number;
    domainBreakdown: Record<string, number>;
    contextCoverage: {
      core: number;
      live: number;
      code: number;
      sports: number;
    };
    highReliabilityRate: number;
  } {
    const totalRequests = auditLog.length;
    if (totalRequests === 0) {
      return {
        totalRequests: 0,
        domainBreakdown: {},
        contextCoverage: { core: 0, live: 0, code: 0, sports: 0 },
        highReliabilityRate: 0
      };
    }

    const domainBreakdown: Record<string, number> = {};
    let coreCount = 0;
    let liveCount = 0;
    let codeCount = 0;
    let sportsCount = 0;
    let highReliabilityCount = 0;

    for (const entry of auditLog) {
      domainBreakdown[entry.domain] = (domainBreakdown[entry.domain] || 0) + 1;
      
      if (entry.contextsPresent.includes("core")) coreCount++;
      if (entry.contextsPresent.some(c => c.startsWith("live_"))) liveCount++;
      if (entry.contextsPresent.includes("code")) codeCount++;
      if (entry.contextsPresent.includes("sports")) sportsCount++;
      if (entry.requiresHighReliability) highReliabilityCount++;
    }

    return {
      totalRequests,
      domainBreakdown,
      contextCoverage: {
        core: Math.round((coreCount / totalRequests) * 100),
        live: Math.round((liveCount / totalRequests) * 100),
        code: Math.round((codeCount / totalRequests) * 100),
        sports: Math.round((sportsCount / totalRequests) * 100)
      },
      highReliabilityRate: Math.round((highReliabilityCount / totalRequests) * 100)
    };
  },

  getRecentAuditEntries(limit = 20): ContextAuditEntry[] {
    return auditLog.slice(0, limit);
  },

  getDomainStats(): Map<RequestDomain, {
    total: number;
    withSportsContext: number;
    withCodeContext: number;
    withLiveContext: number;
    highReliabilityCount: number;
  }> {
    return new Map(domainStats);
  },

  getSportsContextRate(): number {
    const sportsRequests = auditLog.filter(e => 
      e.domain === "sports" || e.domain === "betting"
    );
    if (sportsRequests.length === 0) return 0;

    const withContext = sportsRequests.filter(e => 
      e.contextsPresent.includes("sports")
    ).length;

    return Math.round((withContext / sportsRequests.length) * 100);
  },

  clearAuditLog(): void {
    auditLog.length = 0;
    domainStats.clear();
    console.log("[MARS_AUDIT] Audit log cleared");
  }
};
