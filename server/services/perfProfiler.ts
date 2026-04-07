import { db } from '../db';
import { perfMetrics, InsertPerfMetric, PerfMetric } from '@shared/schema';
import { eq, desc, and, gte, sql, avg } from 'drizzle-orm';
import { Request, Response, NextFunction } from 'express';

interface PerfSummary {
  avgDurationMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  totalRequests: number;
}

interface EndpointPerf {
  endpoint: string;
  method: string;
  avgDurationMs: number;
  count: number;
  errorRate: number;
}

interface DbQueryPerf {
  query: string;
  avgDurationMs: number;
  count: number;
  avgRows: number;
}

const PERF_BATCH_SIZE = 25;
const PERF_FLUSH_INTERVAL = 10000;
const PERF_SKIP_PATHS = new Set(['/api/health', '/api/perf', '/api/voice/status', '/api/monitoring']);
const PERF_MAP_MAX_SIZE = 500;

class PerfProfiler {
  private requestStartTimes = new Map<string, number>();
  private metricBuffer: InsertPerfMetric[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.flushTimer = setInterval(() => this.flushMetrics(), PERF_FLUSH_INTERVAL);
  }

  private async flushMetrics() {
    if (this.metricBuffer.length === 0) return;
    const batch = this.metricBuffer.splice(0, PERF_BATCH_SIZE * 2);
    try {
      await db.insert(perfMetrics).values(batch);
    } catch (err: any) {
      console.error('[PerfProfiler] Batch flush error:', err.message);
    }
  }

  private enqueueMetric(metric: InsertPerfMetric) {
    this.metricBuffer.push(metric);
    if (this.metricBuffer.length >= PERF_BATCH_SIZE) {
      this.flushMetrics().catch(() => {});
    }
  }

  async logApiMetric(
    endpoint: string,
    method: string,
    durationMs: number,
    statusCode: number,
    userId?: number
  ): Promise<PerfMetric> {
    const [metric] = await db.insert(perfMetrics).values({
      userId,
      type: 'api',
      endpoint,
      method,
      durationMs,
      statusCode
    }).returning();

    return metric;
  }

  async logDbQuery(
    query: string,
    durationMs: number,
    rows?: number,
    params?: any[],
    userId?: number
  ): Promise<PerfMetric> {
    const [metric] = await db.insert(perfMetrics).values({
      userId,
      type: 'db_query',
      durationMs,
      dbQuery: {
        query: query.slice(0, 500),
        params: params?.slice(0, 10),
        rows
      }
    }).returning();

    return metric;
  }

  async logExternalApi(
    endpoint: string,
    durationMs: number,
    statusCode?: number,
    userId?: number,
    metadata?: Record<string, any>
  ): Promise<PerfMetric> {
    const [metric] = await db.insert(perfMetrics).values({
      userId,
      type: 'external_api',
      endpoint,
      durationMs,
      statusCode,
      metadata
    }).returning();

    return metric;
  }

  expressMiddleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      if (PERF_SKIP_PATHS.has(req.path)) return next();

      const startTime = Date.now();
      const requestId = `${startTime}-${Math.random().toString(36).slice(2, 8)}`;
      
      this.requestStartTimes.set(requestId, startTime);
      if (this.requestStartTimes.size > PERF_MAP_MAX_SIZE) {
        const cutoff = Date.now() - 120000;
        for (const [k, v] of this.requestStartTimes) {
          if (v < cutoff) this.requestStartTimes.delete(k);
        }
      }

      res.on('finish', () => {
        const duration = Date.now() - startTime;
        const userId = (req as any).user?.id;

        this.enqueueMetric({
          userId,
          type: 'api',
          endpoint: req.path,
          method: req.method,
          durationMs: duration,
          statusCode: res.statusCode
        });

        this.requestStartTimes.delete(requestId);
      });

      next();
    };
  }

  async getApiPerf(days: number = 7): Promise<EndpointPerf[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const metrics = await db.select()
      .from(perfMetrics)
      .where(and(
        gte(perfMetrics.createdAt, startDate),
        eq(perfMetrics.type, 'api')
      ));

    const perfMap = new Map<string, {
      durations: number[];
      errorCount: number;
      method: string;
    }>();

    for (const m of metrics) {
      const key = `${m.method}:${m.endpoint}`;
      
      if (!perfMap.has(key)) {
        perfMap.set(key, { durations: [], errorCount: 0, method: m.method || 'GET' });
      }

      const entry = perfMap.get(key)!;
      entry.durations.push(m.durationMs);
      if (m.statusCode && m.statusCode >= 400) {
        entry.errorCount++;
      }
    }

    return Array.from(perfMap.entries())
      .map(([key, data]) => {
        const [method, endpoint] = key.split(':');
        const avgDuration = data.durations.reduce((a, b) => a + b, 0) / data.durations.length;
        return {
          endpoint,
          method: data.method,
          avgDurationMs: Math.round(avgDuration),
          count: data.durations.length,
          errorRate: data.durations.length > 0 ? (data.errorCount / data.durations.length) * 100 : 0
        };
      })
      .sort((a, b) => b.avgDurationMs - a.avgDurationMs);
  }

  async getDbQueryPerf(days: number = 7): Promise<DbQueryPerf[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const metrics = await db.select()
      .from(perfMetrics)
      .where(and(
        gte(perfMetrics.createdAt, startDate),
        eq(perfMetrics.type, 'db_query')
      ));

    const queryMap = new Map<string, { durations: number[]; rows: number[] }>();

    for (const m of metrics) {
      const queryInfo = m.dbQuery as { query: string; rows?: number } | null;
      if (!queryInfo) continue;

      const normalizedQuery = this.normalizeQuery(queryInfo.query);
      
      if (!queryMap.has(normalizedQuery)) {
        queryMap.set(normalizedQuery, { durations: [], rows: [] });
      }

      const entry = queryMap.get(normalizedQuery)!;
      entry.durations.push(m.durationMs);
      if (queryInfo.rows !== undefined) {
        entry.rows.push(queryInfo.rows);
      }
    }

    return Array.from(queryMap.entries())
      .map(([query, data]) => ({
        query,
        avgDurationMs: Math.round(data.durations.reduce((a, b) => a + b, 0) / data.durations.length),
        count: data.durations.length,
        avgRows: data.rows.length > 0 
          ? Math.round(data.rows.reduce((a, b) => a + b, 0) / data.rows.length)
          : 0
      }))
      .sort((a, b) => b.avgDurationMs - a.avgDurationMs);
  }

  private normalizeQuery(query: string): string {
    return query
      .replace(/\$\d+/g, '?')
      .replace(/\d+/g, '?')
      .replace(/'[^']*'/g, "'?'")
      .trim()
      .slice(0, 200);
  }

  async getSlowestEndpoints(limit: number = 10): Promise<EndpointPerf[]> {
    const perf = await this.getApiPerf();
    return perf.slice(0, limit);
  }

  async getSlowestQueries(limit: number = 10): Promise<DbQueryPerf[]> {
    const perf = await this.getDbQueryPerf();
    return perf.slice(0, limit);
  }

  async getOverallStats(days: number = 7): Promise<{
    api: PerfSummary;
    db: PerfSummary;
    externalApi: PerfSummary;
  }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const metrics = await db.select()
      .from(perfMetrics)
      .where(gte(perfMetrics.createdAt, startDate));

    const apiDurations: number[] = [];
    const dbDurations: number[] = [];
    const externalDurations: number[] = [];

    for (const m of metrics) {
      switch (m.type) {
        case 'api':
          apiDurations.push(m.durationMs);
          break;
        case 'db_query':
          dbDurations.push(m.durationMs);
          break;
        case 'external_api':
          externalDurations.push(m.durationMs);
          break;
      }
    }

    return {
      api: this.calculatePercentiles(apiDurations),
      db: this.calculatePercentiles(dbDurations),
      externalApi: this.calculatePercentiles(externalDurations)
    };
  }

  private calculatePercentiles(durations: number[]): PerfSummary {
    if (durations.length === 0) {
      return { avgDurationMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, totalRequests: 0 };
    }

    const sorted = [...durations].sort((a, b) => a - b);
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;

    return {
      avgDurationMs: Math.round(avg),
      p50Ms: sorted[Math.floor(sorted.length * 0.5)] || 0,
      p95Ms: sorted[Math.floor(sorted.length * 0.95)] || 0,
      p99Ms: sorted[Math.floor(sorted.length * 0.99)] || 0,
      totalRequests: sorted.length
    };
  }

  getPerfSummaryForPrompt(
    slowEndpoints: EndpointPerf[],
    slowQueries: DbQueryPerf[],
    stats: Awaited<ReturnType<typeof this.getOverallStats>>
  ): string {
    let text = `Performance (7 derniers jours):\n`;
    
    text += `\nAPI: ${stats.api.totalRequests} requêtes, avg=${stats.api.avgDurationMs}ms, p95=${stats.api.p95Ms}ms\n`;
    text += `DB: ${stats.db.totalRequests} queries, avg=${stats.db.avgDurationMs}ms, p95=${stats.db.p95Ms}ms\n`;

    if (slowEndpoints.length > 0) {
      text += `\nEndpoints les plus lents:\n`;
      for (const e of slowEndpoints.slice(0, 5)) {
        text += `  - ${e.method} ${e.endpoint}: ${e.avgDurationMs}ms (${e.count}x)\n`;
      }
    }

    if (slowQueries.length > 0) {
      text += `\nQueries les plus lentes:\n`;
      for (const q of slowQueries.slice(0, 5)) {
        text += `  - ${q.query.slice(0, 50)}...: ${q.avgDurationMs}ms (${q.count}x)\n`;
      }
    }

    return text;
  }

  async cleanup(olderThanDays: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    await db.delete(perfMetrics)
      .where(sql`${perfMetrics.createdAt} < ${cutoffDate}`);

    console.log(`[PerfProfiler] Cleaned up metrics older than ${olderThanDays} days`);
    return 0;
  }
}

export const perfProfiler = new PerfProfiler();
