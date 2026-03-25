import { db } from '../db';
import { usageEvents, InsertUsageEvent, UsageEvent } from '@shared/schema';
import { eq, desc, and, gte, sql } from 'drizzle-orm';

interface UsageStats {
  module: string;
  feature: string;
  count: number;
  successRate: number;
  avgDurationMs: number;
}

interface PersonaStats {
  persona: string;
  totalEvents: number;
  modules: Record<string, number>;
}

class UsageAnalyticsService {
  async trackEvent(
    userId: number,
    module: string,
    feature: string,
    options?: {
      persona?: string;
      durationMs?: number;
      success?: boolean;
      errorMessage?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<UsageEvent> {
    const [event] = await db.insert(usageEvents).values({
      userId,
      module,
      feature,
      persona: options?.persona,
      durationMs: options?.durationMs,
      success: options?.success ?? true,
      errorMessage: options?.errorMessage,
      metadata: options?.metadata
    }).returning();

    return event;
  }

  async trackVoiceEvent(userId: number, action: string, options?: {
    persona?: string;
    durationMs?: number;
    success?: boolean;
    metadata?: Record<string, any>;
  }) {
    return this.trackEvent(userId, 'voice', action, options);
  }

  async trackNavigationEvent(userId: number, action: string, options?: {
    persona?: string;
    durationMs?: number;
    metadata?: Record<string, any>;
  }) {
    return this.trackEvent(userId, 'navigation', action, options);
  }

  async trackHomeworkEvent(userId: number, action: string, options?: {
    persona?: string;
    success?: boolean;
    metadata?: Record<string, any>;
  }) {
    return this.trackEvent(userId, 'homework', action, options);
  }

  async trackEmailEvent(userId: number, action: string, options?: {
    persona?: string;
    success?: boolean;
    metadata?: Record<string, any>;
  }) {
    return this.trackEvent(userId, 'email', action, options);
  }

  async trackGeolocationEvent(userId: number, action: string, options?: {
    metadata?: Record<string, any>;
  }) {
    return this.trackEvent(userId, 'geolocation', action, options);
  }

  async getUsageStats(userId?: number, days: number = 7): Promise<UsageStats[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const conditions = [gte(usageEvents.createdAt, startDate)];
    if (userId) conditions.push(eq(usageEvents.userId, userId));

    const events = await db.select()
      .from(usageEvents)
      .where(and(...conditions));

    const statsMap = new Map<string, {
      count: number;
      successCount: number;
      totalDuration: number;
      durationCount: number;
    }>();

    for (const event of events) {
      const key = `${event.module}:${event.feature}`;
      
      if (!statsMap.has(key)) {
        statsMap.set(key, { count: 0, successCount: 0, totalDuration: 0, durationCount: 0 });
      }

      const stats = statsMap.get(key)!;
      stats.count++;
      if (event.success) stats.successCount++;
      if (event.durationMs) {
        stats.totalDuration += event.durationMs;
        stats.durationCount++;
      }
    }

    return Array.from(statsMap.entries())
      .map(([key, stats]) => {
        const [module, feature] = key.split(':');
        return {
          module,
          feature,
          count: stats.count,
          successRate: stats.count > 0 ? (stats.successCount / stats.count) * 100 : 0,
          avgDurationMs: stats.durationCount > 0 ? stats.totalDuration / stats.durationCount : 0
        };
      })
      .sort((a, b) => b.count - a.count);
  }

  async getModuleStats(days: number = 7): Promise<Record<string, number>> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const events = await db.select()
      .from(usageEvents)
      .where(gte(usageEvents.createdAt, startDate));

    const moduleCounts: Record<string, number> = {};
    for (const event of events) {
      moduleCounts[event.module] = (moduleCounts[event.module] || 0) + 1;
    }

    return moduleCounts;
  }

  async getPersonaStats(days: number = 7): Promise<PersonaStats[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const events = await db.select()
      .from(usageEvents)
      .where(gte(usageEvents.createdAt, startDate));

    const personaMap = new Map<string, PersonaStats>();

    for (const event of events) {
      const persona = event.persona || 'unknown';
      
      if (!personaMap.has(persona)) {
        personaMap.set(persona, { persona, totalEvents: 0, modules: {} });
      }

      const stats = personaMap.get(persona)!;
      stats.totalEvents++;
      stats.modules[event.module] = (stats.modules[event.module] || 0) + 1;
    }

    return Array.from(personaMap.values())
      .sort((a, b) => b.totalEvents - a.totalEvents);
  }

  async getTopFeatures(userId?: number, limit: number = 10): Promise<Array<{
    module: string;
    feature: string;
    count: number;
  }>> {
    const stats = await this.getUsageStats(userId);
    return stats.slice(0, limit).map(s => ({
      module: s.module,
      feature: s.feature,
      count: s.count
    }));
  }

  async getFailurePatterns(days: number = 7): Promise<Array<{
    module: string;
    feature: string;
    failureCount: number;
    errorMessages: string[];
  }>> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const events = await db.select()
      .from(usageEvents)
      .where(and(
        gte(usageEvents.createdAt, startDate),
        eq(usageEvents.success, false)
      ));

    const failureMap = new Map<string, { count: number; errors: Set<string> }>();

    for (const event of events) {
      const key = `${event.module}:${event.feature}`;
      
      if (!failureMap.has(key)) {
        failureMap.set(key, { count: 0, errors: new Set() });
      }

      const entry = failureMap.get(key)!;
      entry.count++;
      if (event.errorMessage) {
        entry.errors.add(event.errorMessage.slice(0, 100));
      }
    }

    return Array.from(failureMap.entries())
      .map(([key, data]) => {
        const [module, feature] = key.split(':');
        return {
          module,
          feature,
          failureCount: data.count,
          errorMessages: Array.from(data.errors)
        };
      })
      .sort((a, b) => b.failureCount - a.failureCount);
  }

  getUsageSummaryForPrompt(stats: UsageStats[], personaStats: PersonaStats[]): string {
    if (stats.length === 0) return 'Aucune donnée d\'usage récente.';

    let text = `Usage (7 derniers jours):\n`;
    
    const moduleUsage: Record<string, number> = {};
    for (const s of stats) {
      moduleUsage[s.module] = (moduleUsage[s.module] || 0) + s.count;
    }

    text += `Modules les plus utilisés:\n`;
    const sortedModules = Object.entries(moduleUsage)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    for (const [module, count] of sortedModules) {
      text += `  - ${module}: ${count} events\n`;
    }

    if (personaStats.length > 0) {
      text += `\nPar persona:\n`;
      for (const ps of personaStats.slice(0, 4)) {
        text += `  - ${ps.persona}: ${ps.totalEvents} events\n`;
      }
    }

    return text;
  }

  async cleanup(olderThanDays: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    await db.delete(usageEvents)
      .where(sql`${usageEvents.createdAt} < ${cutoffDate}`);

    console.log(`[UsageAnalytics] Cleaned up events older than ${olderThanDays} days`);
    return 0;
  }
}

export const usageAnalyticsService = new UsageAnalyticsService();
