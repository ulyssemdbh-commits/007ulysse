import { CoreResponse } from "./UlysseCoreEngine";

interface CacheEntry {
  response: CoreResponse;
  createdAt: number;
  accessCount: number;
  lastAccessedAt: number;
  ttl: number;
}

interface CacheConfig {
  defaultTTL: number;
  maxEntries: number;
  cleanupInterval: number;
}

export class DecisionCacheService {
  private cache: Map<string, CacheEntry> = new Map();
  private config: CacheConfig;
  private cleanupTimer: NodeJS.Timeout | null = null;

  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    sets: 0
  };

  private ttlByCategory: Record<string, number> = {
    'greeting': 86400000,
    'farewell': 86400000,
    'acknowledgment': 86400000,
    'time': 60000,
    'weather': 600000,
    'finance': 300000,
    'sports': 120000,
    'suguval': 600000,
    'general': 3600000
  };

  constructor(config?: Partial<CacheConfig>) {
    this.config = {
      defaultTTL: 1800000,
      maxEntries: 5000,
      cleanupInterval: 60000,
      ...config
    };

    this.startCleanup();
    console.log('[DecisionCache] Service initialized with config:', this.config);
  }

  async get(key: string): Promise<CoreResponse | null> {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return null;
    }

    if (Date.now() > entry.createdAt + entry.ttl) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    entry.accessCount++;
    entry.lastAccessedAt = Date.now();
    this.stats.hits++;
    
    return entry.response;
  }

  async set(key: string, response: CoreResponse, options?: { ttl?: number; category?: string }): Promise<void> {
    if (this.cache.size >= this.config.maxEntries) {
      this.evictLRU();
    }

    let ttl = options?.ttl || this.config.defaultTTL;
    if (options?.category && this.ttlByCategory[options.category]) {
      ttl = this.ttlByCategory[options.category];
    }

    if (!ttl && response.metadata?.patternId) {
      const category = response.metadata.patternId.split('_')[0];
      if (this.ttlByCategory[category]) {
        ttl = this.ttlByCategory[category];
      }
    }

    this.cache.set(key, {
      response,
      createdAt: Date.now(),
      accessCount: 0,
      lastAccessedAt: Date.now(),
      ttl
    });

    this.stats.sets++;
  }

  async invalidate(pattern: string): Promise<number> {
    let count = 0;
    const regex = new RegExp(pattern);
    
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }
    
    console.log(`[DecisionCache] Invalidated ${count} entries matching: ${pattern}`);
    return count;
  }

  async invalidateByUser(userId: number): Promise<number> {
    return this.invalidate(`^core:${userId}:`);
  }

  async invalidateByCategory(category: string): Promise<number> {
    let count = 0;
    
    for (const [key, entry] of this.cache) {
      if (entry.response.metadata?.patternId?.includes(category)) {
        this.cache.delete(key);
        count++;
      }
    }
    
    return count;
  }

  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    
    for (const [key, entry] of this.cache) {
      const score = entry.lastAccessedAt - (entry.accessCount * 60000);
      if (score < oldestTime) {
        oldestTime = score;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
    }
  }

  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.cache) {
      if (now > entry.createdAt + entry.ttl) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`[DecisionCache] Cleaned ${cleaned} expired entries`);
    }
  }

  private startCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupInterval);
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  getStats(): typeof this.stats & {
    size: number;
    hitRate: number;
    memoryUsageKB: number;
  } {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? this.stats.hits / totalRequests : 0;

    let memoryEstimate = 0;
    for (const [key, entry] of this.cache) {
      memoryEstimate += key.length * 2;
      memoryEstimate += JSON.stringify(entry.response).length * 2;
      memoryEstimate += 64;
    }
    
    return {
      ...this.stats,
      size: this.cache.size,
      hitRate,
      memoryUsageKB: Math.round(memoryEstimate / 1024)
    };
  }

  async warmup(entries: Array<{ key: string; response: CoreResponse; category?: string }>): Promise<void> {
    console.log(`[DecisionCache] Warming up with ${entries.length} entries`);
    
    for (const entry of entries) {
      await this.set(entry.key, entry.response, { category: entry.category });
    }
  }

  clear(): void {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0, evictions: 0, sets: 0 };
    console.log('[DecisionCache] Cache cleared');
  }
}
