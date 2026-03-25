interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  lastAccess: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  memoryUsage: number;
}

class InMemoryCache {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private stats = { hits: 0, misses: 0 };
  private readonly maxSize: number;
  private readonly defaultTTL: number;

  constructor(options: { maxSize?: number; defaultTTL?: number } = {}) {
    this.maxSize = options.maxSize || 1000;
    this.defaultTTL = options.defaultTTL || 5 * 60 * 1000;

    setInterval(() => this.cleanup(), 60 * 1000);
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    
    if (!entry) {
      this.stats.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    entry.lastAccess = Date.now();
    this.stats.hits++;
    return entry.value;
  }

  set<T>(key: string, value: T, ttl?: number): void {
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    const now = Date.now();
    this.cache.set(key, {
      value,
      expiresAt: now + (ttl || this.defaultTTL),
      lastAccess: now
    });
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  invalidatePattern(pattern: string): number {
    const regex = new RegExp(pattern.replace(/\*/g, ".*"));
    let count = 0;
    
    const keys = Array.from(this.cache.keys());
    for (const key of keys) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }
    
    return count;
  }

  invalidateForUser(userId: number): number {
    return this.invalidatePattern(`user:${userId}:*`);
  }

  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestAccess = Infinity;

    const entries = Array.from(this.cache.entries());
    for (const [key, entry] of entries) {
      if (entry.lastAccess < oldestAccess) {
        oldestAccess = entry.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  private cleanup(): void {
    const now = Date.now();
    const entries = Array.from(this.cache.entries());
    for (const [key, entry] of entries) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  getStats(): CacheStats {
    const memoryUsage = JSON.stringify(Array.from(this.cache.entries())).length;
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      size: this.cache.size,
      memoryUsage
    };
  }

  clear(): void {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0 };
  }
}

export const cache = new InMemoryCache({
  maxSize: 500,
  defaultTTL: 5 * 60 * 1000
});

export const summaryCache = new InMemoryCache({
  maxSize: 100,
  defaultTTL: 30 * 60 * 1000
});

export const emailCache = new InMemoryCache({
  maxSize: 50,
  defaultTTL: 10 * 60 * 1000
});

export function cacheKey(prefix: string, ...parts: (string | number)[]): string {
  return `${prefix}:${parts.join(":")}`;
}

export function withCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl?: number
): Promise<T> {
  const cached = cache.get<T>(key);
  if (cached !== null) {
    return Promise.resolve(cached);
  }

  return fetcher().then(result => {
    cache.set(key, result, ttl);
    return result;
  });
}
