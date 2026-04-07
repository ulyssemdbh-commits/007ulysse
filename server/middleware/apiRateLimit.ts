import type { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
  count: number;
  resetTime: number;
  blocked: boolean;
}

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  message?: string;
  skipSuccessfulRequests?: boolean;
  keyGenerator?: (req: Request) => string;
}

class APIRateLimiter {
  private limits: Map<string, RateLimitEntry> = new Map();
  private readonly cleanupInterval: NodeJS.Timeout;
  private readonly namespace: string;

  constructor(namespace: string = "default") {
    this.namespace = namespace;
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000);
  }

  private cleanup(): void {
    const now = Date.now();
    const entries = Array.from(this.limits.entries());
    for (const [key, entry] of entries) {
      if (now > entry.resetTime) {
        this.limits.delete(key);
      }
    }
  }

  private getNamespacedKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  check(key: string, config: RateLimitConfig): { allowed: boolean; remaining: number; resetTime: number } {
    const nsKey = this.getNamespacedKey(key);
    const now = Date.now();
    let entry = this.limits.get(nsKey);

    if (!entry || now > entry.resetTime) {
      entry = {
        count: 0,
        resetTime: now + config.windowMs,
        blocked: false
      };
      this.limits.set(nsKey, entry);
    }

    entry.count++;

    if (entry.count > config.maxRequests) {
      entry.blocked = true;
      return {
        allowed: false,
        remaining: 0,
        resetTime: entry.resetTime
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, config.maxRequests - entry.count),
      resetTime: entry.resetTime
    };
  }

  decrement(key: string): void {
    const nsKey = this.getNamespacedKey(key);
    const entry = this.limits.get(nsKey);
    if (entry && entry.count > 0) {
      entry.count--;
    }
  }
}

let limiterCounter = 0;

export function createRateLimiter(config: Partial<RateLimitConfig> & { name?: string } = {}) {
  const limiterName = config.name || `limiter_${++limiterCounter}`;
  const limiter = new APIRateLimiter(limiterName);
  
  const defaultConfig: RateLimitConfig = {
    windowMs: config.windowMs ?? 60 * 1000,
    maxRequests: config.maxRequests ?? 60,
    message: config.message ?? "Trop de requêtes, veuillez réessayer plus tard",
    skipSuccessfulRequests: config.skipSuccessfulRequests ?? false,
    keyGenerator: config.keyGenerator ?? ((req) => {
      const userId = (req.session as any)?.userId;
      if (userId) return `user:${userId}`;
      return `ip:${req.ip || req.socket.remoteAddress || "unknown"}`;
    })
  };

  return (req: Request, res: Response, next: NextFunction) => {
    const key = defaultConfig.keyGenerator!(req);
    const result = limiter.check(key, defaultConfig);

    res.setHeader("X-RateLimit-Limit", defaultConfig.maxRequests);
    res.setHeader("X-RateLimit-Remaining", result.remaining);
    res.setHeader("X-RateLimit-Reset", Math.ceil(result.resetTime / 1000));

    if (!result.allowed) {
      res.status(429).json({
        error: defaultConfig.message,
        retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
      });
      return;
    }

    if (defaultConfig.skipSuccessfulRequests) {
      const originalEnd = res.end.bind(res);
      res.end = function(...args: any[]) {
        if (res.statusCode < 400) {
          limiter.decrement(key);
        }
        return originalEnd(...args);
      } as typeof res.end;
    }

    next();
  };
}

export const generalLimiter = createRateLimiter({
  name: "general",
  windowMs: 60 * 1000,
  maxRequests: 100,
  message: "Limite de requêtes atteinte, patientez une minute"
});

export const chatLimiter = createRateLimiter({
  name: "chat",
  windowMs: 60 * 1000,
  maxRequests: 20,
  message: "Trop de messages envoyés, veuillez patienter"
});

export const authLimiter = createRateLimiter({
  name: "auth",
  windowMs: 5 * 60 * 1000,
  maxRequests: 60,
  message: "Trop de tentatives de connexion, réessayez dans 5 minutes"
});

export const uploadLimiter = createRateLimiter({
  name: "upload",
  windowMs: 60 * 1000,
  maxRequests: 10,
  message: "Trop de fichiers uploadés, patientez"
});

export const v2Limiter = createRateLimiter({
  name: "v2",
  windowMs: 60 * 1000,
  maxRequests: 60,
  message: "API rate limit exceeded",
  keyGenerator: (req) => {
    const deviceId = (req as any).deviceId;
    if (deviceId) return `device:${deviceId}`;
    return `ip:${req.ip || "unknown"}`;
  }
});

export const navigationLimiter = createRateLimiter({
  name: "navigation",
  windowMs: 60 * 1000,
  maxRequests: 300,
  message: "Navigation API rate limit exceeded"
});

export const memoryLimiter = createRateLimiter({
  name: "memory",
  windowMs: 60 * 1000,
  maxRequests: 60,
  message: "Memory API rate limit exceeded"
});

export const searchLimiter = createRateLimiter({
  name: "search",
  windowMs: 60 * 1000,
  maxRequests: 15,
  message: "Search rate limit exceeded"
});

export const diagnosticsLimiter = createRateLimiter({
  name: "diagnostics",
  windowMs: 60 * 1000,
  maxRequests: 30,
  message: "Diagnostics rate limit exceeded"
});
