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

const contextAuditLog: ContextAuditEntry[] = [];
const MAX_CONTEXT_AUDIT_LOG = 500;

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

      contextAuditLog.unshift(entry);
      if (contextAuditLog.length > MAX_CONTEXT_AUDIT_LOG) {
        contextAuditLog.pop();
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
    const totalRequests = contextAuditLog.length;
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

    for (const entry of contextAuditLog) {
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
    return contextAuditLog.slice(0, limit);
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
    const sportsRequests = contextAuditLog.filter(e => 
      e.domain === "sports" || e.domain === "betting"
    );
    if (sportsRequests.length === 0) return 0;

    const withContext = sportsRequests.filter(e => 
      e.contextsPresent.includes("sports")
    ).length;

    return Math.round((withContext / sportsRequests.length) * 100);
  },

  clearAuditLog(): void {
    contextAuditLog.length = 0;
    domainStats.clear();
    console.log("[MARS_AUDIT] Audit log cleared");
  }
};

export interface MarsAuditEntry {
  id: string;
  timestamp: string;
  queryOriginal: string;
  queryNormalized: string;
  queryType: 'sport' | 'actu' | 'code' | 'tuto' | 'definition' | 'price' | 'betting' | 'general';
  totalTimeMs: number;
  serperTimeMs: number;
  perplexityTimeMs: number;
  smartCrawlTimeMs: number;
  timeBudgetMs: number;
  timeBudgetUsedPercent: number;
  wasBudgetHit: boolean;
  wasEarlyExit: boolean;
  earlyExitReason?: 'high_confidence_answer' | 'time_budget_exhausted' | 'no_better_sources' | 'cache_hit';
  sources: {
    domain: string;
    marsScore: number;
    usedInAnswer: boolean;
    fetchTimeMs?: number;
    fetchMethod?: 'http' | 'playwright' | 'jina' | 'perplexity' | 'cache';
  }[];
  confidenceLevel: 'high' | 'medium' | 'low' | 'insufficient';
  canRespond: boolean;
  usedPerplexity: boolean;
  perplexityTimeout: boolean;
  perplexitySkippedByCircuitBreaker: boolean;
  perplexityAnswer?: string;
  usedSerper: boolean;
  serperTimeout: boolean;
  serperResultCount: number;
  sportsContextInjected: boolean;
  matchesFromCache: number;
  matchesWithOdds: number;
  valueBetsDetected: number;
  leagueCoverage: string[];
  answerLength: number;
  answerType: 'factual' | 'synthesis' | 'refusal' | 'partial';
  policyTriggered: boolean;
  policyReason?: string;
}

export interface MarsAuditStats {
  totalQueries: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  budgetHitRate: number;
  earlyExitRate: number;
  earlyExitReasons: Record<string, number>;
  perplexityUsageRate: number;
  perplexityTimeoutRate: number;
  perplexityCircuitBreakerRate: number;
  serperUsageRate: number;
  serperTimeoutRate: number;
  confidenceDistribution: {
    high: number;
    medium: number;
    low: number;
    insufficient: number;
  };
  canRespondRate: number;
  sportsQueryRate: number;
  sportsCacheHitRate: number;
  avgMatchesFromCache: number;
  avgValueBetsDetected: number;
  queryTypeDistribution: Record<string, number>;
  avgLatencyByType: Record<string, number>;
  periodStart: string;
  periodEnd: string;
}

const MAX_ENTRIES = 1000;
const queryAuditLog: MarsAuditEntry[] = [];

export function logMarsQuery(entry: MarsAuditEntry): void {
  queryAuditLog.push(entry);
  if (queryAuditLog.length > MAX_ENTRIES) {
    queryAuditLog.shift();
  }
  console.log(`[MARS:Audit] ${entry.queryType} query "${entry.queryOriginal.substring(0, 50)}..." - ${entry.totalTimeMs}ms, confidence=${entry.confidenceLevel}, canRespond=${entry.canRespond}`);
}

export function createAuditEntry(query: string): Partial<MarsAuditEntry> {
  return {
    id: `mars_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    queryOriginal: query,
    queryNormalized: normalizeQuery(query),
    queryType: detectQueryType(query),
    sources: [],
    usedPerplexity: false,
    perplexityTimeout: false,
    perplexitySkippedByCircuitBreaker: false,
    usedSerper: false,
    serperTimeout: false,
    serperResultCount: 0,
    sportsContextInjected: false,
    matchesFromCache: 0,
    matchesWithOdds: 0,
    valueBetsDetected: 0,
    leagueCoverage: [],
    policyTriggered: false,
    wasEarlyExit: false,
    wasBudgetHit: false,
    canRespond: true
  };
}

export function safeGetHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.split('/')[2] || 'unknown';
  }
}

function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ');
}

function detectQueryType(query: string): MarsAuditEntry['queryType'] {
  const q = query.toLowerCase();
  if (/\b(match|score|cote|prono|foot|ligue|champion|nba|nhl|nfl|betting|paris|pari)\b/.test(q)) {
    if (/\b(cote|odds|betting|paris|pari|prono)\b/.test(q)) return 'betting';
    return 'sport';
  }
  if (/\b(prix|price|cost|euro|dollar|achat|acheter|buy)\b/.test(q)) return 'price';
  if (/\b(code|function|api|javascript|python|typescript|react|node|error|bug|fix)\b/.test(q)) return 'code';
  if (/\b(comment|how to|tutorial|guide|tuto|apprendre|learn)\b/.test(q)) return 'tuto';
  if (/\b(qu'est-ce que|what is|define|définition|meaning|signifie)\b/.test(q)) return 'definition';
  if (/\b(actualité|news|aujourd'hui|today|hier|yesterday|récent|recent)\b/.test(q)) return 'actu';
  return 'general';
}

export function getAuditLogs(options: {
  from?: Date;
  to?: Date;
  queryType?: string;
  limit?: number;
  confidenceLevel?: string;
  onlyFailures?: boolean;
} = {}): MarsAuditEntry[] {
  let filtered = [...queryAuditLog];
  if (options.from) filtered = filtered.filter(e => new Date(e.timestamp) >= options.from!);
  if (options.to) filtered = filtered.filter(e => new Date(e.timestamp) <= options.to!);
  if (options.queryType) filtered = filtered.filter(e => e.queryType === options.queryType);
  if (options.confidenceLevel) filtered = filtered.filter(e => e.confidenceLevel === options.confidenceLevel);
  if (options.onlyFailures) filtered = filtered.filter(e => !e.canRespond || e.policyTriggered);
  if (options.limit) filtered = filtered.slice(-options.limit);
  return filtered;
}

export function calculateStats(entries?: MarsAuditEntry[]): MarsAuditStats {
  const data = entries || queryAuditLog;
  if (data.length === 0) {
    return {
      totalQueries: 0, avgLatencyMs: 0, p95LatencyMs: 0, p99LatencyMs: 0,
      budgetHitRate: 0, earlyExitRate: 0, earlyExitReasons: {},
      perplexityUsageRate: 0, perplexityTimeoutRate: 0, perplexityCircuitBreakerRate: 0,
      serperUsageRate: 0, serperTimeoutRate: 0,
      confidenceDistribution: { high: 0, medium: 0, low: 0, insufficient: 0 },
      canRespondRate: 0, sportsQueryRate: 0, sportsCacheHitRate: 0,
      avgMatchesFromCache: 0, avgValueBetsDetected: 0,
      queryTypeDistribution: {}, avgLatencyByType: {},
      periodStart: new Date().toISOString(), periodEnd: new Date().toISOString()
    };
  }
  const latencies = data.map(e => e.totalTimeMs).sort((a, b) => a - b);
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p95Index = Math.floor(latencies.length * 0.95);
  const p99Index = Math.floor(latencies.length * 0.99);
  const budgetHits = data.filter(e => e.wasBudgetHit).length;
  const earlyExits = data.filter(e => e.wasEarlyExit);
  const earlyExitReasons: Record<string, number> = {};
  earlyExits.forEach(e => {
    const reason = e.earlyExitReason || 'unknown';
    earlyExitReasons[reason] = (earlyExitReasons[reason] || 0) + 1;
  });
  const perplexityUsed = data.filter(e => e.usedPerplexity).length;
  const perplexityTimeouts = data.filter(e => e.perplexityTimeout).length;
  const perplexityCB = data.filter(e => e.perplexitySkippedByCircuitBreaker).length;
  const serperUsed = data.filter(e => e.usedSerper).length;
  const serperTimeouts = data.filter(e => e.serperTimeout).length;
  const confidenceDistribution = {
    high: data.filter(e => e.confidenceLevel === 'high').length,
    medium: data.filter(e => e.confidenceLevel === 'medium').length,
    low: data.filter(e => e.confidenceLevel === 'low').length,
    insufficient: data.filter(e => e.confidenceLevel === 'insufficient').length
  };
  const sportsQueries = data.filter(e => e.queryType === 'sport' || e.queryType === 'betting');
  const sportsCacheHits = sportsQueries.filter(e => e.matchesFromCache > 0).length;
  const totalMatchesFromCache = sportsQueries.reduce((a, e) => a + e.matchesFromCache, 0);
  const totalValueBets = sportsQueries.reduce((a, e) => a + e.valueBetsDetected, 0);
  const queryTypeDistribution: Record<string, number> = {};
  data.forEach(e => { queryTypeDistribution[e.queryType] = (queryTypeDistribution[e.queryType] || 0) + 1; });
  const avgLatencyByType: Record<string, number> = {};
  Object.keys(queryTypeDistribution).forEach(type => {
    const typeEntries = data.filter(e => e.queryType === type);
    avgLatencyByType[type] = typeEntries.reduce((a, e) => a + e.totalTimeMs, 0) / typeEntries.length;
  });
  return {
    totalQueries: data.length,
    avgLatencyMs: Math.round(avgLatency),
    p95LatencyMs: latencies[p95Index] || 0,
    p99LatencyMs: latencies[p99Index] || 0,
    budgetHitRate: budgetHits / data.length,
    earlyExitRate: earlyExits.length / data.length,
    earlyExitReasons,
    perplexityUsageRate: perplexityUsed / data.length,
    perplexityTimeoutRate: perplexityTimeouts / Math.max(1, perplexityUsed),
    perplexityCircuitBreakerRate: perplexityCB / data.length,
    serperUsageRate: serperUsed / data.length,
    serperTimeoutRate: serperTimeouts / Math.max(1, serperUsed),
    confidenceDistribution,
    canRespondRate: data.filter(e => e.canRespond).length / data.length,
    sportsQueryRate: sportsQueries.length / data.length,
    sportsCacheHitRate: sportsQueries.length > 0 ? sportsCacheHits / sportsQueries.length : 0,
    avgMatchesFromCache: sportsQueries.length > 0 ? totalMatchesFromCache / sportsQueries.length : 0,
    avgValueBetsDetected: sportsQueries.length > 0 ? totalValueBets / sportsQueries.length : 0,
    queryTypeDistribution,
    avgLatencyByType,
    periodStart: data[0]?.timestamp || new Date().toISOString(),
    periodEnd: data[data.length - 1]?.timestamp || new Date().toISOString()
  };
}

export function clearAuditLogs(): void {
  queryAuditLog.length = 0;
  console.log('[MARS:Audit] Logs cleared');
}

export function getLogCount(): number {
  return queryAuditLog.length;
}

export function exportAsNDJSON(entries?: MarsAuditEntry[]): string {
  const data = entries || queryAuditLog;
  return data.map(e => JSON.stringify(e)).join('\n');
}
