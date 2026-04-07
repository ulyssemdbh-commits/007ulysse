interface PrefetchEntry {
  data: Record<string, any>;
  intent: string;
  createdAt: number;
  userId: number;
}

const CACHE_TTL_MS = 45_000;

class PrefetchCache {
  private cache = new Map<string, PrefetchEntry>();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanup(), 30_000);
  }

  key(userId: number, message: string): string {
    const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");
    return `${userId}:${normalized}`;
  }

  set(userId: number, message: string, intent: string, data: Record<string, any>) {
    const k = this.key(userId, message);
    this.cache.set(k, { data, intent, createdAt: Date.now(), userId });
    console.log(`[Prefetch] Cached data for user ${userId}, intent=${intent}, keys=${Object.keys(data).join(",")}`);
  }

  get(userId: number, message: string): PrefetchEntry | null {
    const k = this.key(userId, message);
    const entry = this.cache.get(k);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
      this.cache.delete(k);
      return null;
    }
    return entry;
  }

  private cleanup() {
    const now = Date.now();
    for (const [k, entry] of this.cache.entries()) {
      if (now - entry.createdAt > CACHE_TTL_MS) {
        this.cache.delete(k);
      }
    }
  }

  destroy() {
    clearInterval(this.cleanupInterval);
  }
}

export const prefetchCache = new PrefetchCache();
