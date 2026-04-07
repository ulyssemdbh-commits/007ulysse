/**
 * MARS Search Cache - Intelligent caching with adaptive TTL
 * 
 * Features:
 * - Query hash-based caching
 * - Type-specific TTL (news: 5min, factual: 30min, stable: 1h)
 * - LRU eviction with max 1000 entries
 * - Hit rate metrics
 */

import crypto from "crypto";

export interface CachedSearchResult {
  queryHash: string;
  query: string;
  queryType: string;
  response: any;
  cachedAt: number;
  ttlMs: number;
  hitCount: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  entries: number;
  hitRate: number;
  avgHitCount: number;
  oldestEntry: number | null;
  newestEntry: number | null;
}

class MARSSearchCache {
  private cache = new Map<string, CachedSearchResult>();
  private readonly maxEntries = 1000;
  private hits = 0;
  private misses = 0;

  // TTL par type de requête (en ms)
  private readonly ttlByType: Record<string, number> = {
    news: 5 * 60 * 1000,           // 5 minutes - actualités
    temporal: 5 * 60 * 1000,       // 5 minutes - temps réel
    sports_football: 2 * 60 * 1000, // 2 minutes - scores en direct
    sports_basketball: 2 * 60 * 1000,
    sports_motorsport: 2 * 60 * 1000,
    stock_market: 1 * 60 * 1000,   // 1 minute - bourse
    factual: 30 * 60 * 1000,       // 30 minutes - faits vérifiables
    encyclopedic: 60 * 60 * 1000,  // 1 heure - connaissances stables
    technical: 60 * 60 * 1000,     // 1 heure - documentation
    conversational: 0,              // Pas de cache
    ambiguous: 0,
    default: 15 * 60 * 1000        // 15 minutes par défaut
  };

  /**
   * Génère un hash unique pour la requête
   */
  private hashQuery(query: string): string {
    const normalized = query.toLowerCase().trim().replace(/\s+/g, ' ');
    return crypto.createHash('md5').update(normalized).digest('hex');
  }

  /**
   * Obtient le TTL approprié pour le type de requête
   */
  getTTL(queryType: string): number {
    return this.ttlByType[queryType] ?? this.ttlByType.default;
  }

  /**
   * Récupère un résultat du cache s'il existe et n'est pas expiré
   */
  get(query: string, queryType: string): CachedSearchResult | null {
    const hash = this.hashQuery(query);
    const cached = this.cache.get(hash);

    if (!cached) {
      this.misses++;
      return null;
    }

    const age = Date.now() - cached.cachedAt;
    if (age > cached.ttlMs) {
      // Expiré, supprimer
      this.cache.delete(hash);
      this.misses++;
      console.log(`[MARS:Cache] EXPIRED: "${query.substring(0, 40)}..." (age: ${Math.round(age / 1000)}s > TTL: ${Math.round(cached.ttlMs / 1000)}s)`);
      return null;
    }

    // Cache hit
    this.hits++;
    cached.hitCount++;
    console.log(`[MARS:Cache] HIT: "${query.substring(0, 40)}..." (age: ${Math.round(age / 1000)}s, hits: ${cached.hitCount})`);
    return cached;
  }

  /**
   * Stocke un résultat dans le cache
   */
  set(query: string, queryType: string, response: any): void {
    const ttl = this.getTTL(queryType);
    
    // Ne pas cacher les types sans TTL
    if (ttl === 0) {
      console.log(`[MARS:Cache] SKIP: "${query.substring(0, 40)}..." (type: ${queryType}, no cache)`);
      return;
    }

    const hash = this.hashQuery(query);

    // Éviction LRU si nécessaire
    if (this.cache.size >= this.maxEntries) {
      this.evictOldest();
    }

    this.cache.set(hash, {
      queryHash: hash,
      query,
      queryType,
      response,
      cachedAt: Date.now(),
      ttlMs: ttl,
      hitCount: 0
    });

    console.log(`[MARS:Cache] SET: "${query.substring(0, 40)}..." (type: ${queryType}, TTL: ${Math.round(ttl / 1000)}s)`);
  }

  /**
   * Éviction LRU - supprime les entrées les plus anciennes
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, value] of this.cache.entries()) {
      if (value.cachedAt < oldestTime) {
        oldestTime = value.cachedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      console.log(`[MARS:Cache] EVICT: oldest entry (age: ${Math.round((Date.now() - oldestTime) / 1000)}s)`);
    }
  }

  /**
   * Invalide une entrée spécifique
   */
  invalidate(query: string): boolean {
    const hash = this.hashQuery(query);
    return this.cache.delete(hash);
  }

  /**
   * Invalide toutes les entrées d'un type
   */
  invalidateByType(queryType: string): number {
    let count = 0;
    for (const [key, value] of this.cache.entries()) {
      if (value.queryType === queryType) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Nettoie les entrées expirées
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, value] of this.cache.entries()) {
      if (now - value.cachedAt > value.ttlMs) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[MARS:Cache] CLEANUP: removed ${cleaned} expired entries`);
    }
    return cleaned;
  }

  /**
   * Statistiques du cache
   */
  getStats(): CacheStats {
    const entries = Array.from(this.cache.values());
    const total = this.hits + this.misses;

    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.cache.size,
      hitRate: total > 0 ? this.hits / total : 0,
      avgHitCount: entries.length > 0 
        ? entries.reduce((sum, e) => sum + e.hitCount, 0) / entries.length 
        : 0,
      oldestEntry: entries.length > 0 
        ? Math.min(...entries.map(e => e.cachedAt)) 
        : null,
      newestEntry: entries.length > 0 
        ? Math.max(...entries.map(e => e.cachedAt)) 
        : null
    };
  }

  /**
   * Réinitialise le cache
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    console.log(`[MARS:Cache] CLEARED`);
  }
}

// Singleton export
export const marsSearchCache = new MARSSearchCache();
