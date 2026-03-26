/**
 * MARS Audit Service
 * Complete logging and metrics for all MARS/smartCrawl queries
 * Supports export, analysis, and performance monitoring
 */

export interface MarsAuditEntry {
  id: string;
  timestamp: string;
  
  // Meta-query
  queryOriginal: string;
  queryNormalized: string;
  queryType: 'sport' | 'actu' | 'code' | 'tuto' | 'definition' | 'price' | 'betting' | 'general';
  
  // Timing
  totalTimeMs: number;
  serperTimeMs: number;
  perplexityTimeMs: number;
  smartCrawlTimeMs: number;
  timeBudgetMs: number;
  timeBudgetUsedPercent: number;
  wasBudgetHit: boolean;
  wasEarlyExit: boolean;
  earlyExitReason?: 'high_confidence_answer' | 'time_budget_exhausted' | 'no_better_sources' | 'cache_hit';
  
  // Sources & scoring
  sources: {
    domain: string;
    marsScore: number;
    usedInAnswer: boolean;
    fetchTimeMs?: number;
    fetchMethod?: 'http' | 'playwright' | 'jina' | 'perplexity' | 'cache';
  }[];
  confidenceLevel: 'high' | 'medium' | 'low' | 'insufficient';
  canRespond: boolean;
  
  // Perplexity / Serper usage
  usedPerplexity: boolean;
  perplexityTimeout: boolean;
  perplexitySkippedByCircuitBreaker: boolean;
  perplexityAnswer?: string;
  usedSerper: boolean;
  serperTimeout: boolean;
  serperResultCount: number;
  
  // Sports / cache
  sportsContextInjected: boolean;
  matchesFromCache: number;
  matchesWithOdds: number;
  valueBetsDetected: number;
  leagueCoverage: string[];
  
  // Result
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
  
  // Budget stats
  budgetHitRate: number;
  earlyExitRate: number;
  earlyExitReasons: Record<string, number>;
  
  // Engine stats
  perplexityUsageRate: number;
  perplexityTimeoutRate: number;
  perplexityCircuitBreakerRate: number;
  serperUsageRate: number;
  serperTimeoutRate: number;
  
  // Confidence stats
  confidenceDistribution: {
    high: number;
    medium: number;
    low: number;
    insufficient: number;
  };
  canRespondRate: number;
  
  // Sports stats
  sportsQueryRate: number;
  sportsCacheHitRate: number;
  avgMatchesFromCache: number;
  avgValueBetsDetected: number;
  
  // Query type distribution
  queryTypeDistribution: Record<string, number>;
  
  // Performance by query type
  avgLatencyByType: Record<string, number>;
  
  // Time period
  periodStart: string;
  periodEnd: string;
}

// In-memory storage with circular buffer
const MAX_ENTRIES = 1000;
const auditLog: MarsAuditEntry[] = [];

/**
 * Log a MARS query for audit
 */
export function logMarsQuery(entry: MarsAuditEntry): void {
  // Add to circular buffer
  auditLog.push(entry);
  if (auditLog.length > MAX_ENTRIES) {
    auditLog.shift();
  }
  
  // Console log for real-time monitoring
  console.log(`[MARS:Audit] ${entry.queryType} query "${entry.queryOriginal.substring(0, 50)}..." - ${entry.totalTimeMs}ms, confidence=${entry.confidenceLevel}, canRespond=${entry.canRespond}`);
}

/**
 * Create a new audit entry with defaults
 */
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

/**
 * Safe URL hostname extraction
 */
export function safeGetHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.split('/')[2] || 'unknown';
  }
}

/**
 * Normalize query for analysis
 */
function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Detect query type for classification
 */
function detectQueryType(query: string): MarsAuditEntry['queryType'] {
  const q = query.toLowerCase();
  
  // Sports / betting
  if (/\b(match|score|cote|prono|foot|ligue|champion|nba|nhl|nfl|betting|paris|pari)\b/.test(q)) {
    if (/\b(cote|odds|betting|paris|pari|prono)\b/.test(q)) {
      return 'betting';
    }
    return 'sport';
  }
  
  // Price / commerce
  if (/\b(prix|price|cost|euro|dollar|achat|acheter|buy)\b/.test(q)) {
    return 'price';
  }
  
  // Code / tech
  if (/\b(code|function|api|javascript|python|typescript|react|node|error|bug|fix)\b/.test(q)) {
    return 'code';
  }
  
  // Tutorial
  if (/\b(comment|how to|tutorial|guide|tuto|apprendre|learn)\b/.test(q)) {
    return 'tuto';
  }
  
  // Definition
  if (/\b(qu'est-ce que|what is|define|définition|meaning|signifie)\b/.test(q)) {
    return 'definition';
  }
  
  // News / current events
  if (/\b(actualité|news|aujourd'hui|today|hier|yesterday|récent|recent)\b/.test(q)) {
    return 'actu';
  }
  
  return 'general';
}

/**
 * Get audit logs with optional filters
 */
export function getAuditLogs(options: {
  from?: Date;
  to?: Date;
  queryType?: string;
  limit?: number;
  confidenceLevel?: string;
  onlyFailures?: boolean;
} = {}): MarsAuditEntry[] {
  let filtered = [...auditLog];
  
  if (options.from) {
    filtered = filtered.filter(e => new Date(e.timestamp) >= options.from!);
  }
  
  if (options.to) {
    filtered = filtered.filter(e => new Date(e.timestamp) <= options.to!);
  }
  
  if (options.queryType) {
    filtered = filtered.filter(e => e.queryType === options.queryType);
  }
  
  if (options.confidenceLevel) {
    filtered = filtered.filter(e => e.confidenceLevel === options.confidenceLevel);
  }
  
  if (options.onlyFailures) {
    filtered = filtered.filter(e => !e.canRespond || e.policyTriggered);
  }
  
  if (options.limit) {
    filtered = filtered.slice(-options.limit);
  }
  
  return filtered;
}

/**
 * Calculate aggregate statistics
 */
export function calculateStats(entries?: MarsAuditEntry[]): MarsAuditStats {
  const data = entries || auditLog;
  
  if (data.length === 0) {
    return {
      totalQueries: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0,
      budgetHitRate: 0,
      earlyExitRate: 0,
      earlyExitReasons: {},
      perplexityUsageRate: 0,
      perplexityTimeoutRate: 0,
      perplexityCircuitBreakerRate: 0,
      serperUsageRate: 0,
      serperTimeoutRate: 0,
      confidenceDistribution: { high: 0, medium: 0, low: 0, insufficient: 0 },
      canRespondRate: 0,
      sportsQueryRate: 0,
      sportsCacheHitRate: 0,
      avgMatchesFromCache: 0,
      avgValueBetsDetected: 0,
      queryTypeDistribution: {},
      avgLatencyByType: {},
      periodStart: new Date().toISOString(),
      periodEnd: new Date().toISOString()
    };
  }
  
  // Latency calculations
  const latencies = data.map(e => e.totalTimeMs).sort((a, b) => a - b);
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p95Index = Math.floor(latencies.length * 0.95);
  const p99Index = Math.floor(latencies.length * 0.99);
  
  // Budget stats
  const budgetHits = data.filter(e => e.wasBudgetHit).length;
  const earlyExits = data.filter(e => e.wasEarlyExit);
  const earlyExitReasons: Record<string, number> = {};
  earlyExits.forEach(e => {
    const reason = e.earlyExitReason || 'unknown';
    earlyExitReasons[reason] = (earlyExitReasons[reason] || 0) + 1;
  });
  
  // Engine stats
  const perplexityUsed = data.filter(e => e.usedPerplexity).length;
  const perplexityTimeouts = data.filter(e => e.perplexityTimeout).length;
  const perplexityCB = data.filter(e => e.perplexitySkippedByCircuitBreaker).length;
  const serperUsed = data.filter(e => e.usedSerper).length;
  const serperTimeouts = data.filter(e => e.serperTimeout).length;
  
  // Confidence distribution
  const confidenceDistribution = {
    high: data.filter(e => e.confidenceLevel === 'high').length,
    medium: data.filter(e => e.confidenceLevel === 'medium').length,
    low: data.filter(e => e.confidenceLevel === 'low').length,
    insufficient: data.filter(e => e.confidenceLevel === 'insufficient').length
  };
  
  // Sports stats
  const sportsQueries = data.filter(e => e.queryType === 'sport' || e.queryType === 'betting');
  const sportsCacheHits = sportsQueries.filter(e => e.matchesFromCache > 0).length;
  const totalMatchesFromCache = sportsQueries.reduce((a, e) => a + e.matchesFromCache, 0);
  const totalValueBets = sportsQueries.reduce((a, e) => a + e.valueBetsDetected, 0);
  
  // Query type distribution
  const queryTypeDistribution: Record<string, number> = {};
  data.forEach(e => {
    queryTypeDistribution[e.queryType] = (queryTypeDistribution[e.queryType] || 0) + 1;
  });
  
  // Avg latency by type
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

/**
 * Clear audit logs (for testing or maintenance)
 */
export function clearAuditLogs(): void {
  auditLog.length = 0;
  console.log('[MARS:Audit] Logs cleared');
}

/**
 * Get current log count
 */
export function getLogCount(): number {
  return auditLog.length;
}

/**
 * Export logs as NDJSON for external analysis
 */
export function exportAsNDJSON(entries?: MarsAuditEntry[]): string {
  const data = entries || auditLog;
  return data.map(e => JSON.stringify(e)).join('\n');
}
