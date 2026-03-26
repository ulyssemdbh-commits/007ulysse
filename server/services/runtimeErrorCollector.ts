import { db } from '../db';
import { runtimeErrors, InsertRuntimeError, RuntimeError } from '@shared/schema';
import { eq, desc, and, gte, sql } from 'drizzle-orm';

interface ErrorContext {
  url?: string;
  userAgent?: string;
  deviceId?: string;
  persona?: string;
  metadata?: Record<string, any>;
}

interface ErrorAggregation {
  message: string;
  count: number;
  source: string;
  firstSeen: Date;
  lastSeen: Date;
}

class RuntimeErrorCollector {
  async logError(
    source: 'frontend' | 'backend' | 'worker',
    level: 'error' | 'warn' | 'info',
    message: string,
    stack?: string,
    userId?: number,
    context?: ErrorContext
  ): Promise<RuntimeError> {
    const [error] = await db.insert(runtimeErrors).values({
      userId,
      source,
      level,
      message: message.slice(0, 5000),
      stack: stack?.slice(0, 10000),
      url: context?.url,
      userAgent: context?.userAgent,
      deviceId: context?.deviceId,
      persona: context?.persona,
      metadata: context?.metadata
    }).returning();

    if (level === 'error') {
      console.error(`[RuntimeError] ${source}: ${message.slice(0, 200)}`);
    }

    return error;
  }

  async logFrontendError(data: {
    message: string;
    stack?: string;
    url: string;
    userAgent: string;
    userId?: number;
    deviceId?: string;
    persona?: string;
    componentStack?: string;
  }): Promise<RuntimeError> {
    return this.logError(
      'frontend',
      'error',
      data.message,
      data.stack,
      data.userId,
      {
        url: data.url,
        userAgent: data.userAgent,
        deviceId: data.deviceId,
        persona: data.persona,
        metadata: { componentStack: data.componentStack }
      }
    );
  }

  async logBackendError(
    error: Error,
    userId?: number,
    context?: { endpoint?: string; method?: string; persona?: string }
  ): Promise<RuntimeError> {
    return this.logError(
      'backend',
      'error',
      error.message,
      error.stack,
      userId,
      {
        url: context?.endpoint,
        persona: context?.persona,
        metadata: { method: context?.method }
      }
    );
  }

  async getRecentErrors(
    userId?: number,
    source?: string,
    limit: number = 50
  ): Promise<RuntimeError[]> {
    const conditions = [];
    if (userId) conditions.push(eq(runtimeErrors.userId, userId));
    if (source) conditions.push(eq(runtimeErrors.source, source));

    return db.select()
      .from(runtimeErrors)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(runtimeErrors.createdAt))
      .limit(limit);
  }

  async getErrorsByTimeRange(
    startDate: Date,
    endDate?: Date,
    source?: string
  ): Promise<RuntimeError[]> {
    const conditions = [gte(runtimeErrors.createdAt, startDate)];
    if (source) conditions.push(eq(runtimeErrors.source, source));

    return db.select()
      .from(runtimeErrors)
      .where(and(...conditions))
      .orderBy(desc(runtimeErrors.createdAt));
  }

  async getErrorAggregations(days: number = 7): Promise<ErrorAggregation[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const errors = await this.getErrorsByTimeRange(startDate);
    
    const aggregations = new Map<string, ErrorAggregation>();

    for (const error of errors) {
      const key = `${error.source}:${error.message.slice(0, 100)}`;
      
      if (aggregations.has(key)) {
        const agg = aggregations.get(key)!;
        agg.count++;
        if (error.createdAt && error.createdAt > agg.lastSeen) {
          agg.lastSeen = error.createdAt;
        }
        if (error.createdAt && error.createdAt < agg.firstSeen) {
          agg.firstSeen = error.createdAt;
        }
      } else {
        aggregations.set(key, {
          message: error.message.slice(0, 200),
          count: 1,
          source: error.source,
          firstSeen: error.createdAt || new Date(),
          lastSeen: error.createdAt || new Date()
        });
      }
    }

    return Array.from(aggregations.values())
      .sort((a, b) => b.count - a.count);
  }

  async getErrorStats(days: number = 7): Promise<{
    total: number;
    bySource: Record<string, number>;
    byLevel: Record<string, number>;
    topErrors: Array<{ message: string; count: number }>;
  }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const errors = await this.getErrorsByTimeRange(startDate);

    const bySource: Record<string, number> = { frontend: 0, backend: 0, worker: 0 };
    const byLevel: Record<string, number> = { error: 0, warn: 0, info: 0 };
    const messageCounts = new Map<string, number>();

    for (const error of errors) {
      bySource[error.source] = (bySource[error.source] || 0) + 1;
      byLevel[error.level] = (byLevel[error.level] || 0) + 1;
      
      const shortMsg = error.message.slice(0, 100);
      messageCounts.set(shortMsg, (messageCounts.get(shortMsg) || 0) + 1);
    }

    const topErrors = Array.from(messageCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([message, count]) => ({ message, count }));

    return {
      total: errors.length,
      bySource,
      byLevel,
      topErrors
    };
  }

  getErrorSummaryForPrompt(stats: Awaited<ReturnType<typeof this.getErrorStats>>): string {
    if (stats.total === 0) return 'Aucune erreur récente.';

    let text = `Erreurs (7 derniers jours): ${stats.total} total\n`;
    text += `- Frontend: ${stats.bySource.frontend}, Backend: ${stats.bySource.backend}\n`;
    
    if (stats.topErrors.length > 0) {
      text += `Top erreurs:\n`;
      for (const e of stats.topErrors.slice(0, 5)) {
        text += `  [${e.count}x] ${e.message}\n`;
      }
    }

    return text;
  }

  async cleanup(olderThanDays: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await db.delete(runtimeErrors)
      .where(sql`${runtimeErrors.createdAt} < ${cutoffDate}`);

    console.log(`[RuntimeError] Cleaned up errors older than ${olderThanDays} days`);
    return 0;
  }
}

export const runtimeErrorCollector = new RuntimeErrorCollector();
