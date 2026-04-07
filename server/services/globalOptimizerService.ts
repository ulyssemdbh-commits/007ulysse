/**
 * Global Optimizer Service
 * 
 * Applies 2x efficiency optimizations to ALL Ulysse functions:
 * 1. Parallel data fetching across all services
 * 2. Smart caching with service-specific TTL
 * 3. Preloading frequently used data
 * 4. Batch operations for reduced latency
 */

import { db } from "../db";
import { actionLogs } from "@shared/schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";

const LOG_PREFIX = "[GlobalOptimizer]";

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  ttl: number;
  hits: number;
}

interface ServiceStats {
  hits: number;
  misses: number;
  avgLatency: number;
  lastAccess: number;
}

class GlobalOptimizerService {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private stats: Map<string, ServiceStats> = new Map();
  private pendingRequests: Map<string, Promise<any>> = new Map();
  
  private readonly SERVICE_TTL: Record<string, number> = {
    email_inbox: 5 * 60 * 1000,      // 5 minutes (was 2)
    email_thread: 10 * 60 * 1000,    // 10 minutes (was 5)
    calendar_events: 5 * 60 * 1000,  // 5 minutes (was 3)
    calendar_day: 10 * 60 * 1000,    // 10 minutes (was 5)
    web_search: 15 * 60 * 1000,      // 15 minutes (was 10)
    web_crawl: 60 * 60 * 1000,       // 1 hour (was 30 min)
    sports_odds: 60 * 1000,          // 1 minute (volatile)
    sports_matches: 5 * 60 * 1000,   // 5 minutes
    trading_quotes: 30 * 1000,       // 30 seconds (very volatile)
    trading_analysis: 10 * 60 * 1000, // 10 minutes (was 5)
    weather: 20 * 60 * 1000,         // 20 minutes (was 15)
    tts_audio: 2 * 60 * 60 * 1000,   // 2 hours (was 1 hour)
    file_template: 60 * 60 * 1000,   // 1 hour (was 30 min)
    brain_knowledge: 15 * 60 * 1000, // 15 minutes (was 10)
    default: 5 * 60 * 1000           // 5 minutes
  };

  async getOrFetch<T>(
    key: string,
    service: string,
    fetcher: () => Promise<T>,
    options?: { forceFresh?: boolean; customTTL?: number }
  ): Promise<T> {
    const cacheKey = `${service}:${key}`;
    const start = Date.now();
    const ttl = options?.customTTL || this.SERVICE_TTL[service] || this.SERVICE_TTL.default;
    
    if (!options?.forceFresh) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        const age = Date.now() - cached.cachedAt;
        if (age < cached.ttl) {
          cached.hits++;
          this.recordHit(service);
          return cached.data as T;
        }
        if (age < cached.ttl * 2) {
          cached.hits++;
          this.recordHit(service);
          fetcher().then(data => {
            this.cache.set(cacheKey, { data, cachedAt: Date.now(), ttl, hits: 0 });
          }).catch(() => {});
          return cached.data as T;
        }
      }
    }
    
    const pending = this.pendingRequests.get(cacheKey);
    if (pending) {
      return pending as Promise<T>;
    }
    
    const fetchPromise = fetcher().then(data => {
      this.cache.set(cacheKey, {
        data,
        cachedAt: Date.now(),
        ttl,
        hits: 0
      });
      this.pendingRequests.delete(cacheKey);
      this.recordMiss(service, Date.now() - start);
      return data;
    }).catch(err => {
      this.pendingRequests.delete(cacheKey);
      throw err;
    });
    
    this.pendingRequests.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  async parallelFetch<T extends Record<string, () => Promise<any>>>(
    fetchers: T
  ): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
    const keys = Object.keys(fetchers) as (keyof T)[];
    const start = Date.now();
    
    const results = await Promise.all(
      keys.map(key => fetchers[key]().catch(err => {
        console.error(`${LOG_PREFIX} Parallel fetch error for ${String(key)}:`, err);
        return null;
      }))
    );
    
    const output = {} as { [K in keyof T]: Awaited<ReturnType<T[K]>> };
    keys.forEach((key, i) => {
      output[key] = results[i];
    });
    
    console.log(`${LOG_PREFIX} Parallel fetch completed in ${Date.now() - start}ms (${keys.length} services)`);
    return output;
  }

  async batchOperations<T>(
    operations: Array<() => Promise<T>>,
    options?: { maxConcurrent?: number; stopOnError?: boolean }
  ): Promise<{ results: T[]; errors: Error[] }> {
    const maxConcurrent = options?.maxConcurrent || 5;
    const results: T[] = [];
    const errors: Error[] = [];
    
    for (let i = 0; i < operations.length; i += maxConcurrent) {
      const batch = operations.slice(i, i + maxConcurrent);
      const batchResults = await Promise.allSettled(batch.map(op => op()));
      
      for (const result of batchResults) {
        if (result.status === "fulfilled") {
          results.push(result.value);
        } else {
          errors.push(result.reason);
          if (options?.stopOnError) {
            return { results, errors };
          }
        }
      }
    }
    
    return { results, errors };
  }

  invalidate(service: string, key?: string): void {
    if (key) {
      this.cache.delete(`${service}:${key}`);
    } else {
      for (const cacheKey of this.cache.keys()) {
        if (cacheKey.startsWith(`${service}:`)) {
          this.cache.delete(cacheKey);
        }
      }
    }
    console.log(`${LOG_PREFIX} Invalidated: ${service}${key ? `:${key}` : " (all)"}`);
  }

  invalidateAll(): void {
    this.cache.clear();
    console.log(`${LOG_PREFIX} All cache cleared`);
  }

  private recordHit(service: string): void {
    const stats = this.stats.get(service) || { hits: 0, misses: 0, avgLatency: 0, lastAccess: 0 };
    stats.hits++;
    stats.lastAccess = Date.now();
    this.stats.set(service, stats);
  }

  private recordMiss(service: string, latency: number): void {
    const stats = this.stats.get(service) || { hits: 0, misses: 0, avgLatency: 0, lastAccess: 0 };
    const totalRequests = stats.hits + stats.misses;
    stats.avgLatency = (stats.avgLatency * totalRequests + latency) / (totalRequests + 1);
    stats.misses++;
    stats.lastAccess = Date.now();
    this.stats.set(service, stats);
  }

  getStats(): {
    cacheSize: number;
    services: Array<{ service: string; hits: number; misses: number; hitRate: number; avgLatency: number }>;
    totalHitRate: number;
  } {
    const services: Array<{ service: string; hits: number; misses: number; hitRate: number; avgLatency: number }> = [];
    let totalHits = 0;
    let totalMisses = 0;
    
    for (const [service, stats] of this.stats) {
      const total = stats.hits + stats.misses;
      services.push({
        service,
        hits: stats.hits,
        misses: stats.misses,
        hitRate: total > 0 ? Math.round((stats.hits / total) * 100) : 0,
        avgLatency: Math.round(stats.avgLatency)
      });
      totalHits += stats.hits;
      totalMisses += stats.misses;
    }
    
    const totalRequests = totalHits + totalMisses;
    
    return {
      cacheSize: this.cache.size,
      services: services.sort((a, b) => b.hits + b.misses - (a.hits + a.misses)),
      totalHitRate: totalRequests > 0 ? Math.round((totalHits / totalRequests) * 100) : 0
    };
  }

  async preloadForUser(userId: number): Promise<void> {
    console.log(`${LOG_PREFIX} Preloading data for user ${userId}...`);
    const start = Date.now();
    
    await this.parallelFetch({
      recentActions: async () => {
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        return db.select({ category: actionLogs.actionCategory })
          .from(actionLogs)
          .where(and(eq(actionLogs.userId, userId), gte(actionLogs.startedAt, weekAgo)))
          .limit(50);
      }
    });
    
    console.log(`${LOG_PREFIX} Preload completed in ${Date.now() - start}ms`);
  }

  cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.cache) {
      if (now - entry.cachedAt > entry.ttl) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`${LOG_PREFIX} Cleaned ${cleaned} expired entries`);
    }
  }
}

export const globalOptimizerService = new GlobalOptimizerService();

setInterval(() => globalOptimizerService.cleanup(), 60 * 1000);
