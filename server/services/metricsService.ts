/**
 * Metrics Service - Production Observability
 * Track latency, cache hit rates, and errors for preloading and AI pipeline
 */

interface LatencyMetric {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  recentSamples: number[];
}

interface CacheMetric {
  hits: number;
  misses: number;
  expired: number;
}

interface ErrorMetric {
  count: number;
  lastError: string | null;
  lastErrorAt: number | null;
  errorTypes: Record<string, number>;
}

interface PreloadMetrics {
  latency: Record<string, LatencyMetric>;
  cache: CacheMetric;
  errors: ErrorMetric;
  totalPreloads: number;
  successfulPreloads: number;
}

interface AIMetrics {
  latency: LatencyMetric;
  tokenUsage: { input: number; output: number };
  providerUsage: Record<string, number>;
  errors: ErrorMetric;
}

interface AICostEntry {
  timestamp: number;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  context: string;
}

const OPENAI_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5 / 1_000_000, output: 10 / 1_000_000 },
  "gpt-4o-mini": { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
  "gpt-4-turbo": { input: 10 / 1_000_000, output: 30 / 1_000_000 },
  "gpt-4": { input: 30 / 1_000_000, output: 60 / 1_000_000 },
  "gpt-3.5-turbo": { input: 0.5 / 1_000_000, output: 1.5 / 1_000_000 },
  "o1": { input: 15 / 1_000_000, output: 60 / 1_000_000 },
  "o1-mini": { input: 3 / 1_000_000, output: 12 / 1_000_000 },
  "o3-mini": { input: 1.1 / 1_000_000, output: 4.4 / 1_000_000 },
  default: { input: 2.5 / 1_000_000, output: 10 / 1_000_000 },
};

const costHistory: AICostEntry[] = [];
const MAX_COST_HISTORY = 10000;

let costPersistTimer: ReturnType<typeof setInterval> | null = null;

interface MetricsSnapshot {
  preload: PreloadMetrics;
  ai: AIMetrics;
  uptime: number;
  collectedAt: string;
}

const MAX_RECENT_SAMPLES = 100;
const startTime = Date.now();

// Extended metrics storage
interface JobExecutionEntry {
  jobId: string;
  jobName: string;
  success: boolean;
  duration: number;
  timestamp: number;
  error?: string;
}

interface ApiLatencyEntry {
  route: string;
  method: string;
  duration: number;
  statusCode: number;
  timestamp: number;
}

const jobExecutionMetrics: JobExecutionEntry[] = [];
const apiLatencyMetrics: ApiLatencyEntry[] = [];

const preloadMetrics: PreloadMetrics = {
  latency: {
    time: { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0, recentSamples: [] },
    calendar: { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0, recentSamples: [] },
    memory: { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0, recentSamples: [] },
    spotify: { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0, recentSamples: [] },
    geolocation: { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0, recentSamples: [] },
    total: { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0, recentSamples: [] },
  },
  cache: { hits: 0, misses: 0, expired: 0 },
  errors: { count: 0, lastError: null, lastErrorAt: null, errorTypes: {} },
  totalPreloads: 0,
  successfulPreloads: 0,
};

const aiMetrics: AIMetrics = {
  latency: { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0, recentSamples: [] },
  tokenUsage: { input: 0, output: 0 },
  providerUsage: {},
  errors: { count: 0, lastError: null, lastErrorAt: null, errorTypes: {} },
};

function updateLatencyMetric(metric: LatencyMetric, durationMs: number): void {
  metric.count++;
  metric.totalMs += durationMs;
  metric.minMs = Math.min(metric.minMs, durationMs);
  metric.maxMs = Math.max(metric.maxMs, durationMs);
  metric.recentSamples.push(durationMs);
  if (metric.recentSamples.length > MAX_RECENT_SAMPLES) {
    metric.recentSamples.shift();
  }
}

function recordError(errorMetric: ErrorMetric, error: string, errorType: string = "unknown"): void {
  errorMetric.count++;
  errorMetric.lastError = error;
  errorMetric.lastErrorAt = Date.now();
  errorMetric.errorTypes[errorType] = (errorMetric.errorTypes[errorType] || 0) + 1;
}

export const metricsService = {
  recordPreloadLatency(context: string, durationMs: number): void {
    const metric = preloadMetrics.latency[context];
    if (metric) {
      updateLatencyMetric(metric, durationMs);
    }
    console.log(`[Metrics] Preload ${context}: ${durationMs}ms`);
  },

  recordPreloadTotal(durationMs: number, success: boolean): void {
    updateLatencyMetric(preloadMetrics.latency.total, durationMs);
    preloadMetrics.totalPreloads++;
    if (success) {
      preloadMetrics.successfulPreloads++;
    }
  },

  recordCacheHit(): void {
    preloadMetrics.cache.hits++;
  },

  recordCacheMiss(): void {
    preloadMetrics.cache.misses++;
  },

  recordCacheExpired(): void {
    preloadMetrics.cache.expired++;
  },

  recordPreloadError(context: string, error: string): void {
    recordError(preloadMetrics.errors, error, context);
  },

  recordAILatency(durationMs: number): void {
    updateLatencyMetric(aiMetrics.latency, durationMs);
  },

  recordAITokens(inputTokens: number, outputTokens: number): void {
    aiMetrics.tokenUsage.input += inputTokens;
    aiMetrics.tokenUsage.output += outputTokens;
  },

  recordAIProvider(provider: string): void {
    aiMetrics.providerUsage[provider] = (aiMetrics.providerUsage[provider] || 0) + 1;
  },

  recordAICost(provider: string, model: string, inputTokens: number, outputTokens: number, context: string = "chat"): void {
    const pricing = OPENAI_PRICING[model] || OPENAI_PRICING.default;
    const costUsd = (inputTokens * pricing.input) + (outputTokens * pricing.output);
    costHistory.push({ timestamp: Date.now(), provider, model, inputTokens, outputTokens, costUsd, context });
    if (costHistory.length > MAX_COST_HISTORY) costHistory.splice(0, costHistory.length - MAX_COST_HISTORY);
    aiMetrics.tokenUsage.input += inputTokens;
    aiMetrics.tokenUsage.output += outputTokens;
    aiMetrics.providerUsage[provider] = (aiMetrics.providerUsage[provider] || 0) + 1;
  },

  getCostSummary(periodMs?: number): { totalCost: number; totalInput: number; totalOutput: number; byModel: Record<string, { cost: number; calls: number }>; byContext: Record<string, { cost: number; calls: number }>; dailyCosts: Array<{ date: string; cost: number; calls: number }> } {
    const since = periodMs ? Date.now() - periodMs : 0;
    const filtered = costHistory.filter(e => e.timestamp >= since);
    const byModel: Record<string, { cost: number; calls: number }> = {};
    const byContext: Record<string, { cost: number; calls: number }> = {};
    const dailyMap: Record<string, { cost: number; calls: number }> = {};
    let totalCost = 0, totalInput = 0, totalOutput = 0;
    for (const e of filtered) {
      totalCost += e.costUsd;
      totalInput += e.inputTokens;
      totalOutput += e.outputTokens;
      if (!byModel[e.model]) byModel[e.model] = { cost: 0, calls: 0 };
      byModel[e.model].cost += e.costUsd;
      byModel[e.model].calls++;
      if (!byContext[e.context]) byContext[e.context] = { cost: 0, calls: 0 };
      byContext[e.context].cost += e.costUsd;
      byContext[e.context].calls++;
      const day = new Date(e.timestamp).toISOString().slice(0, 10);
      if (!dailyMap[day]) dailyMap[day] = { cost: 0, calls: 0 };
      dailyMap[day].cost += e.costUsd;
      dailyMap[day].calls++;
    }
    const dailyCosts = Object.entries(dailyMap).sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({ date, cost: Math.round(d.cost * 10000) / 10000, calls: d.calls }));
    return { totalCost: Math.round(totalCost * 10000) / 10000, totalInput, totalOutput, byModel, byContext, dailyCosts };
  },

  async persistCostsToDB(): Promise<void> {
    if (costHistory.length === 0) return;
    try {
      const { db } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const batch = costHistory.splice(0, 500);
      for (const entry of batch) {
        await db.execute(sql`
          INSERT INTO devmax_ai_costs (provider, model, input_tokens, output_tokens, cost_usd, context, created_at)
          VALUES (${entry.provider}, ${entry.model}, ${entry.inputTokens}, ${entry.outputTokens}, ${entry.costUsd}, ${entry.context}, ${new Date(entry.timestamp).toISOString()})
        `).catch(() => {});
      }
    } catch (e: any) {
      console.error("[Metrics] Cost persist failed:", e.message);
    }
  },

  startCostPersistence(): void {
    if (costPersistTimer) return;
    costPersistTimer = setInterval(() => { this.persistCostsToDB(); }, 5 * 60 * 1000);
  },

  recordAIError(error: string, errorType: string = "unknown"): void {
    recordError(aiMetrics.errors, error, errorType);
  },

  getSnapshot(): MetricsSnapshot {
    const calculateAvg = (m: LatencyMetric) => m.count > 0 ? Math.round(m.totalMs / m.count) : 0;
    const calculateP95 = (samples: number[]) => {
      if (samples.length === 0) return 0;
      const sorted = [...samples].sort((a, b) => a - b);
      const idx = Math.floor(sorted.length * 0.95);
      return sorted[idx] || sorted[sorted.length - 1];
    };

    return {
      preload: {
        ...preloadMetrics,
        latency: Object.fromEntries(
          Object.entries(preloadMetrics.latency).map(([key, metric]) => [
            key,
            {
              ...metric,
              avgMs: calculateAvg(metric),
              p95Ms: calculateP95(metric.recentSamples),
            },
          ])
        ) as any,
      },
      ai: {
        ...aiMetrics,
        latency: {
          ...aiMetrics.latency,
          avgMs: calculateAvg(aiMetrics.latency),
          p95Ms: calculateP95(aiMetrics.latency.recentSamples),
        } as any,
      },
      uptime: Date.now() - startTime,
      collectedAt: new Date().toISOString(),
    };
  },

  getSummary(): Record<string, any> {
    const snapshot = this.getSnapshot();
    const cacheTotal = preloadMetrics.cache.hits + preloadMetrics.cache.misses;
    const cacheHitRate = cacheTotal > 0 ? (preloadMetrics.cache.hits / cacheTotal * 100).toFixed(1) : "0";
    const successRate = preloadMetrics.totalPreloads > 0 
      ? (preloadMetrics.successfulPreloads / preloadMetrics.totalPreloads * 100).toFixed(1) 
      : "0";

    return {
      preload: {
        totalPreloads: preloadMetrics.totalPreloads,
        successRate: `${successRate}%`,
        cacheHitRate: `${cacheHitRate}%`,
        avgLatencyMs: (snapshot.preload.latency.total as any).avgMs || 0,
        p95LatencyMs: (snapshot.preload.latency.total as any).p95Ms || 0,
        errors: preloadMetrics.errors.count,
      },
      ai: {
        totalRequests: aiMetrics.latency.count,
        avgLatencyMs: (snapshot.ai.latency as any).avgMs || 0,
        p95LatencyMs: (snapshot.ai.latency as any).p95Ms || 0,
        tokensUsed: aiMetrics.tokenUsage.input + aiMetrics.tokenUsage.output,
        providerUsage: aiMetrics.providerUsage,
        errors: aiMetrics.errors.count,
      },
      uptimeHours: (snapshot.uptime / 3600000).toFixed(2),
    };
  },

  reset(): void {
    Object.values(preloadMetrics.latency).forEach(m => {
      m.count = 0;
      m.totalMs = 0;
      m.minMs = Infinity;
      m.maxMs = 0;
      m.recentSamples = [];
    });
    preloadMetrics.cache = { hits: 0, misses: 0, expired: 0 };
    preloadMetrics.errors = { count: 0, lastError: null, lastErrorAt: null, errorTypes: {} };
    preloadMetrics.totalPreloads = 0;
    preloadMetrics.successfulPreloads = 0;

    aiMetrics.latency = { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0, recentSamples: [] };
    aiMetrics.tokenUsage = { input: 0, output: 0 };
    aiMetrics.providerUsage = {};
    aiMetrics.errors = { count: 0, lastError: null, lastErrorAt: null, errorTypes: {} };
  },

  // Extended metrics for job scheduler
  recordJobExecution(jobId: string, jobName: string, success: boolean, durationMs: number, error?: string): void {
    jobExecutionMetrics.push({
      jobId,
      jobName,
      success,
      duration: durationMs,
      timestamp: Date.now(),
      error
    });
    // Keep only last 1000 job executions
    if (jobExecutionMetrics.length > 1000) {
      jobExecutionMetrics.splice(0, jobExecutionMetrics.length - 1000);
    }
    console.log(`[Metrics] Job ${jobName}: ${success ? 'SUCCESS' : 'FAILED'} in ${durationMs}ms`);
  },

  recordApiLatency(route: string, method: string, durationMs: number, statusCode: number): void {
    apiLatencyMetrics.push({
      route,
      method,
      duration: durationMs,
      statusCode,
      timestamp: Date.now()
    });
    // Keep only last 5000 API calls
    if (apiLatencyMetrics.length > 5000) {
      apiLatencyMetrics.splice(0, apiLatencyMetrics.length - 5000);
    }
  },

  getJobStats(hours: number = 24): {
    totalExecutions: number;
    successCount: number;
    failureCount: number;
    avgDuration: number;
    jobBreakdown: { jobName: string; executions: number; successRate: number; avgDuration: number }[];
  } {
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    const recentJobs = jobExecutionMetrics.filter(j => j.timestamp > cutoff);
    
    const jobStats = new Map<string, { total: number; successes: number; duration: number }>();
    
    for (const j of recentJobs) {
      const existing = jobStats.get(j.jobName) || { total: 0, successes: 0, duration: 0 };
      existing.total++;
      if (j.success) existing.successes++;
      existing.duration += j.duration;
      jobStats.set(j.jobName, existing);
    }
    
    return {
      totalExecutions: recentJobs.length,
      successCount: recentJobs.filter(j => j.success).length,
      failureCount: recentJobs.filter(j => !j.success).length,
      avgDuration: recentJobs.length > 0
        ? Math.round(recentJobs.reduce((sum, j) => sum + j.duration, 0) / recentJobs.length)
        : 0,
      jobBreakdown: Array.from(jobStats.entries()).map(([jobName, stats]) => ({
        jobName,
        executions: stats.total,
        successRate: Math.round((stats.successes / stats.total) * 100) / 100,
        avgDuration: Math.round(stats.duration / stats.total)
      }))
    };
  },

  getApiStats(hours: number = 24): {
    totalRequests: number;
    errorCount: number;
    avgLatency: number;
    slowRoutes: { route: string; avgLatency: number; count: number }[];
    errorsByRoute: { route: string; count: number }[];
  } {
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    const recentLatencies = apiLatencyMetrics.filter(l => l.timestamp > cutoff);
    
    const routeStats = new Map<string, { total: number; count: number; errors: number }>();
    
    for (const l of recentLatencies) {
      const key = `${l.method} ${l.route}`;
      const existing = routeStats.get(key) || { total: 0, count: 0, errors: 0 };
      existing.total += l.duration;
      existing.count++;
      if (l.statusCode >= 400) existing.errors++;
      routeStats.set(key, existing);
    }
    
    const slowRoutes = Array.from(routeStats.entries())
      .map(([route, stats]) => ({
        route,
        avgLatency: Math.round(stats.total / stats.count),
        count: stats.count
      }))
      .sort((a, b) => b.avgLatency - a.avgLatency)
      .slice(0, 10);
    
    const errorsByRoute = Array.from(routeStats.entries())
      .filter(([_, stats]) => stats.errors > 0)
      .map(([route, stats]) => ({ route, count: stats.errors }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    return {
      totalRequests: recentLatencies.length,
      errorCount: recentLatencies.filter(l => l.statusCode >= 400).length,
      avgLatency: recentLatencies.length > 0
        ? Math.round(recentLatencies.reduce((sum, l) => sum + l.duration, 0) / recentLatencies.length)
        : 0,
      slowRoutes,
      errorsByRoute
    };
  },

  getSystemHealth(): {
    status: "healthy" | "degraded" | "unhealthy";
    uptime: number;
    uptimeHuman: string;
    errorRate: number;
    clientErrorRate: number; // 4xx errors
    serverErrorRate: number; // 5xx errors
    avgLatency: number;
    jobSuccessRate: number;
    recentErrors: { service: string; error: string; timestamp: number }[];
    errorsByRoute: { route: string; count: number; type: "client" | "server" }[];
  } {
    const now = Date.now();
    const lastHour = now - (60 * 60 * 1000);
    
    const recentJobs = jobExecutionMetrics.filter(j => j.timestamp > lastHour);
    const recentLatencies = apiLatencyMetrics.filter(l => l.timestamp > lastHour);
    
    // Separate 4xx (client) and 5xx (server) errors
    const clientErrors = recentLatencies.filter(l => l.statusCode >= 400 && l.statusCode < 500);
    const serverErrors = recentLatencies.filter(l => l.statusCode >= 500);
    
    const clientErrorRate = recentLatencies.length > 0 
      ? clientErrors.length / recentLatencies.length 
      : 0;
    
    const serverErrorRate = recentLatencies.length > 0 
      ? serverErrors.length / recentLatencies.length 
      : 0;
    
    // Total error rate for status determination (mainly 5xx for health)
    const errorRate = serverErrorRate;
    
    const avgLatency = recentLatencies.length > 0
      ? recentLatencies.reduce((sum, l) => sum + l.duration, 0) / recentLatencies.length
      : 0;
    
    const jobSuccessRate = recentJobs.length > 0
      ? recentJobs.filter(j => j.success).length / recentJobs.length
      : 1;
    
    let status: "healthy" | "degraded" | "unhealthy" = "healthy";
    if (serverErrorRate > 0.1 || jobSuccessRate < 0.8 || avgLatency > 5000) {
      status = "unhealthy";
    } else if (serverErrorRate > 0.05 || jobSuccessRate < 0.95 || avgLatency > 2000) {
      status = "degraded";
    }
    
    const recentErrors = recentJobs
      .filter(j => !j.success && j.error)
      .map(j => ({ service: j.jobName, error: j.error!, timestamp: j.timestamp }))
      .slice(-10);
    
    // Group errors by route
    const errorRouteMap = new Map<string, { client: number; server: number }>();
    for (const l of [...clientErrors, ...serverErrors]) {
      const key = `${l.method} ${l.route}`;
      const existing = errorRouteMap.get(key) || { client: 0, server: 0 };
      if (l.statusCode >= 500) {
        existing.server++;
      } else {
        existing.client++;
      }
      errorRouteMap.set(key, existing);
    }
    
    const errorsByRoute = Array.from(errorRouteMap.entries())
      .map(([route, counts]) => ({
        route,
        count: counts.client + counts.server,
        type: (counts.server > counts.client ? "server" : "client") as "client" | "server"
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    // Human-readable uptime
    const uptimeSeconds = (now - startTime) / 1000;
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const uptimeHuman = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    
    return {
      status,
      uptime: uptimeSeconds,
      uptimeHuman,
      errorRate: Math.round(errorRate * 100) / 100,
      clientErrorRate: Math.round(clientErrorRate * 100) / 100,
      serverErrorRate: Math.round(serverErrorRate * 100) / 100,
      avgLatency: Math.round(avgLatency),
      jobSuccessRate: Math.round(jobSuccessRate * 100) / 100,
      recentErrors,
      errorsByRoute
    };
  },

  /**
   * Génère un prompt d'avertissement santé pour l'IA
   * À injecter dans le contexte quand le système est dégradé/unhealthy
   */
  generateHealthWarningPrompt(): string | null {
    const health = this.getSystemHealth();
    
    if (health.status === "healthy") {
      return null; // Pas d'avertissement si tout va bien
    }
    
    const warnings: string[] = [];
    
    if (health.status === "unhealthy") {
      warnings.push(`⚠️ SYSTÈME CRITIQUE: ${health.status.toUpperCase()}`);
    } else {
      warnings.push(`⚠️ SYSTÈME DÉGRADÉ: ${health.status.toUpperCase()}`);
    }
    
    if (health.serverErrorRate > 0.05) {
      warnings.push(`- Taux d'erreur serveur: ${Math.round(health.serverErrorRate * 100)}%`);
    }
    if (health.avgLatency > 2000) {
      warnings.push(`- Latence élevée: ${health.avgLatency}ms`);
    }
    if (health.jobSuccessRate < 0.95) {
      warnings.push(`- Jobs en difficulté: ${Math.round(health.jobSuccessRate * 100)}% succès`);
    }
    
    if (health.errorsByRoute.length > 0) {
      const topErrors = health.errorsByRoute.slice(0, 3)
        .map(e => `${e.route} (${e.count}x)`)
        .join(", ");
      warnings.push(`- Routes problématiques: ${topErrors}`);
    }
    
    warnings.push(`\n**COMPORTEMENT ADAPTÉ:**`);
    warnings.push(`- Éviter les actions non critiques`);
    warnings.push(`- Prévenir l'utilisateur si action risquée demandée`);
    warnings.push(`- Proposer de réessayer plus tard si échec`);
    
    return warnings.join("\n");
  },

  /**
   * Vérifie si une action est risquée vu l'état du système
   */
  isActionRisky(actionType: string): { risky: boolean; reason?: string } {
    const health = this.getSystemHealth();
    
    if (health.status === "healthy") {
      return { risky: false };
    }
    
    // Actions considérées risquées si système dégradé
    const riskyInDegradedState = [
      "send_email", "create_event", "homework", "file_generation"
    ];
    
    if (health.status === "unhealthy" || 
        (health.status === "degraded" && riskyInDegradedState.some(a => actionType.includes(a)))) {
      return {
        risky: true,
        reason: `Système ${health.status}: ${health.serverErrorRate > 0.05 ? 
          `${Math.round(health.serverErrorRate * 100)}% d'erreurs` : 
          `latence ${health.avgLatency}ms`}`
      };
    }
    
    return { risky: false };
  },

  generateDailyReport(): string {
    const health = this.getSystemHealth();
    const apiStats = this.getApiStats(24);
    const jobStats = this.getJobStats(24);
    
    const lines: string[] = [
      `📊 **Rapport Système - ${new Date().toLocaleDateString('fr-FR')}**`,
      ``,
      `**Santé globale:** ${health.status === 'healthy' ? '✅ Sain' : health.status === 'degraded' ? '⚠️ Dégradé' : '❌ Critique'}`,
      `- Uptime: ${Math.round(health.uptime / 3600)}h`,
      `- Taux d'erreur: ${Math.round(health.errorRate * 100)}%`,
      `- Latence moyenne: ${health.avgLatency}ms`,
      ``,
      `**API (24h):**`,
      `- ${apiStats.totalRequests} requêtes`,
      `- ${apiStats.errorCount} erreurs`,
      `- Latence moyenne: ${apiStats.avgLatency}ms`,
    ];
    
    if (apiStats.slowRoutes.length > 0) {
      lines.push(`- Routes lentes: ${apiStats.slowRoutes.slice(0, 3).map(r => `${r.route} (${r.avgLatency}ms)`).join(', ')}`);
    }
    
    lines.push(
      ``,
      `**Jobs (24h):**`,
      `- ${jobStats.totalExecutions} exécutions`,
      `- ${jobStats.successCount} succès, ${jobStats.failureCount} échecs`,
      `- Durée moyenne: ${jobStats.avgDuration}ms`
    );
    
    if (health.recentErrors.length > 0) {
      lines.push(
        ``,
        `**Erreurs récentes:**`
      );
      for (const err of health.recentErrors.slice(0, 5)) {
        lines.push(`- [${err.service}] ${err.error.substring(0, 100)}`);
      }
    }
    
    return lines.join('\n');
  },

  // ═══════════════════════════════════════════════════════════════
  // UNIFIED CONTEXT ENGINE v2 - Context snapshot metrics
  // ═══════════════════════════════════════════════════════════════
  
  contextSnapshots: [] as Array<{
    timestamp: number;
    userId: number;
    domain: string;
    hasCore: boolean;
    hasLiveTime: boolean;
    hasLiveCalendar: boolean;
    hasLiveGeo: boolean;
    hasCodeContext: boolean;
    hasSportsContext: boolean;
    requiresHighReliability: boolean;
  }>,

  recordContextSnapshot(snapshot: {
    userId: number;
    domain: string;
    hasCore: boolean;
    hasLiveTime: boolean;
    hasLiveCalendar: boolean;
    hasLiveGeo: boolean;
    hasCodeContext: boolean;
    hasSportsContext: boolean;
    requiresHighReliability: boolean;
  }): void {
    this.contextSnapshots.unshift({
      ...snapshot,
      timestamp: Date.now()
    });
    
    if (this.contextSnapshots.length > 500) {
      this.contextSnapshots.pop();
    }
  },

  toPrometheus(): string {
    const lines: string[] = [];
    const uptime = (Date.now() - startTime) / 1000;
    const mem = process.memoryUsage();
    const health = this.getSystemHealth();

    lines.push(`# HELP ulysse_uptime_seconds Server uptime in seconds`);
    lines.push(`# TYPE ulysse_uptime_seconds gauge`);
    lines.push(`ulysse_uptime_seconds ${Math.round(uptime)}`);

    lines.push(`# HELP ulysse_health_status System health (0=unhealthy, 1=degraded, 2=healthy)`);
    lines.push(`# TYPE ulysse_health_status gauge`);
    lines.push(`ulysse_health_status ${health.status === "healthy" ? 2 : health.status === "degraded" ? 1 : 0}`);

    lines.push(`# HELP process_resident_memory_bytes Resident memory size in bytes`);
    lines.push(`# TYPE process_resident_memory_bytes gauge`);
    lines.push(`process_resident_memory_bytes ${mem.rss}`);

    lines.push(`# HELP process_heap_used_bytes V8 heap used in bytes`);
    lines.push(`# TYPE process_heap_used_bytes gauge`);
    lines.push(`process_heap_used_bytes ${mem.heapUsed}`);

    lines.push(`# HELP process_heap_total_bytes V8 heap total in bytes`);
    lines.push(`# TYPE process_heap_total_bytes gauge`);
    lines.push(`process_heap_total_bytes ${mem.heapTotal}`);

    lines.push(`# HELP process_external_memory_bytes V8 external memory in bytes`);
    lines.push(`# TYPE process_external_memory_bytes gauge`);
    lines.push(`process_external_memory_bytes ${mem.external}`);

    lines.push(`# HELP ulysse_ai_requests_total Total AI requests`);
    lines.push(`# TYPE ulysse_ai_requests_total counter`);
    lines.push(`ulysse_ai_requests_total ${aiMetrics.latency.count}`);

    lines.push(`# HELP ulysse_ai_latency_avg_ms Average AI latency in milliseconds`);
    lines.push(`# TYPE ulysse_ai_latency_avg_ms gauge`);
    const aiAvg = aiMetrics.latency.count > 0 ? Math.round(aiMetrics.latency.totalMs / aiMetrics.latency.count) : 0;
    lines.push(`ulysse_ai_latency_avg_ms ${aiAvg}`);

    lines.push(`# HELP ulysse_ai_tokens_total Total AI tokens used`);
    lines.push(`# TYPE ulysse_ai_tokens_total counter`);
    lines.push(`ulysse_ai_tokens_total{direction="input"} ${aiMetrics.tokenUsage.input}`);
    lines.push(`ulysse_ai_tokens_total{direction="output"} ${aiMetrics.tokenUsage.output}`);

    lines.push(`# HELP ulysse_ai_errors_total Total AI errors`);
    lines.push(`# TYPE ulysse_ai_errors_total counter`);
    lines.push(`ulysse_ai_errors_total ${aiMetrics.errors.count}`);

    for (const [provider, count] of Object.entries(aiMetrics.providerUsage)) {
      lines.push(`# HELP ulysse_ai_provider_requests_total Requests per AI provider`);
      lines.push(`# TYPE ulysse_ai_provider_requests_total counter`);
      lines.push(`ulysse_ai_provider_requests_total{provider="${provider}"} ${count}`);
    }

    lines.push(`# HELP ulysse_preload_total Total preload operations`);
    lines.push(`# TYPE ulysse_preload_total counter`);
    lines.push(`ulysse_preload_total ${preloadMetrics.totalPreloads}`);

    lines.push(`# HELP ulysse_preload_success_total Successful preloads`);
    lines.push(`# TYPE ulysse_preload_success_total counter`);
    lines.push(`ulysse_preload_success_total ${preloadMetrics.successfulPreloads}`);

    lines.push(`# HELP ulysse_cache_operations_total Cache hit/miss counts`);
    lines.push(`# TYPE ulysse_cache_operations_total counter`);
    lines.push(`ulysse_cache_operations_total{result="hit"} ${preloadMetrics.cache.hits}`);
    lines.push(`ulysse_cache_operations_total{result="miss"} ${preloadMetrics.cache.misses}`);
    lines.push(`ulysse_cache_operations_total{result="expired"} ${preloadMetrics.cache.expired}`);

    lines.push(`# HELP ulysse_api_requests_total Total API requests tracked`);
    lines.push(`# TYPE ulysse_api_requests_total counter`);
    lines.push(`ulysse_api_requests_total ${apiLatencyMetrics.length}`);

    lines.push(`# HELP ulysse_api_error_rate Server error rate (5xx) last hour`);
    lines.push(`# TYPE ulysse_api_error_rate gauge`);
    lines.push(`ulysse_api_error_rate ${health.serverErrorRate}`);

    lines.push(`# HELP ulysse_api_latency_avg_ms Average API latency last hour`);
    lines.push(`# TYPE ulysse_api_latency_avg_ms gauge`);
    lines.push(`ulysse_api_latency_avg_ms ${health.avgLatency}`);

    lines.push(`# HELP ulysse_job_success_rate Job success rate last hour`);
    lines.push(`# TYPE ulysse_job_success_rate gauge`);
    lines.push(`ulysse_job_success_rate ${health.jobSuccessRate}`);

    const costSummary = this.getCostSummary(24 * 60 * 60 * 1000);
    lines.push(`# HELP ulysse_ai_cost_usd_24h AI cost in USD last 24 hours`);
    lines.push(`# TYPE ulysse_ai_cost_usd_24h gauge`);
    lines.push(`ulysse_ai_cost_usd_24h ${costSummary.totalCost}`);

    lines.push(``);
    return lines.join("\n");
  },

  getContextStats(): {
    totalSnapshots: number;
    domainBreakdown: Record<string, number>;
    contextCoverage: {
      core: number;
      liveTime: number;
      liveCalendar: number;
      liveGeo: number;
      code: number;
      sports: number;
    };
    highReliabilityRate: number;
  } {
    const total = this.contextSnapshots.length;
    if (total === 0) {
      return {
        totalSnapshots: 0,
        domainBreakdown: {},
        contextCoverage: { core: 0, liveTime: 0, liveCalendar: 0, liveGeo: 0, code: 0, sports: 0 },
        highReliabilityRate: 0
      };
    }

    const domainBreakdown: Record<string, number> = {};
    let coreCount = 0, timeCount = 0, calendarCount = 0, geoCount = 0, codeCount = 0, sportsCount = 0, hrCount = 0;

    for (const s of this.contextSnapshots) {
      domainBreakdown[s.domain] = (domainBreakdown[s.domain] || 0) + 1;
      if (s.hasCore) coreCount++;
      if (s.hasLiveTime) timeCount++;
      if (s.hasLiveCalendar) calendarCount++;
      if (s.hasLiveGeo) geoCount++;
      if (s.hasCodeContext) codeCount++;
      if (s.hasSportsContext) sportsCount++;
      if (s.requiresHighReliability) hrCount++;
    }

    return {
      totalSnapshots: total,
      domainBreakdown,
      contextCoverage: {
        core: Math.round((coreCount / total) * 100),
        liveTime: Math.round((timeCount / total) * 100),
        liveCalendar: Math.round((calendarCount / total) * 100),
        liveGeo: Math.round((geoCount / total) * 100),
        code: Math.round((codeCount / total) * 100),
        sports: Math.round((sportsCount / total) * 100)
      },
      highReliabilityRate: Math.round((hrCount / total) * 100)
    };
  }
};
