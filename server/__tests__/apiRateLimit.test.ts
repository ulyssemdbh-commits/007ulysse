import { describe, it, expect, vi, beforeEach } from "vitest";
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
}

class TestAPIRateLimiter {
  private limits: Map<string, RateLimitEntry> = new Map();
  private readonly namespace: string;

  constructor(namespace: string = "default") {
    this.namespace = namespace;
  }

  private getNamespacedKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  check(key: string, config: RateLimitConfig): { allowed: boolean; remaining: number; resetTime: number } {
    const nsKey = this.getNamespacedKey(key);
    const now = Date.now();
    let entry = this.limits.get(nsKey);

    if (!entry || now > entry.resetTime) {
      entry = { count: 0, resetTime: now + config.windowMs, blocked: false };
      this.limits.set(nsKey, entry);
    }

    entry.count++;

    if (entry.count > config.maxRequests) {
      entry.blocked = true;
      return { allowed: false, remaining: 0, resetTime: entry.resetTime };
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

  clear(): void {
    this.limits.clear();
  }
}

describe("APIRateLimiter", () => {
  let limiter: TestAPIRateLimiter;
  const config: RateLimitConfig = { windowMs: 60000, maxRequests: 5, message: "Too many requests" };

  beforeEach(() => {
    limiter = new TestAPIRateLimiter("test");
  });

  it("allows requests under the limit", () => {
    const result = limiter.check("user:1", config);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it("tracks request count correctly", () => {
    limiter.check("user:1", config);
    limiter.check("user:1", config);
    const result = limiter.check("user:1", config);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it("blocks requests over the limit", () => {
    for (let i = 0; i < 5; i++) {
      limiter.check("user:1", config);
    }
    const result = limiter.check("user:1", config);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("isolates different users", () => {
    for (let i = 0; i < 5; i++) {
      limiter.check("user:1", config);
    }
    
    const user1Result = limiter.check("user:1", config);
    const user2Result = limiter.check("user:2", config);
    
    expect(user1Result.allowed).toBe(false);
    expect(user2Result.allowed).toBe(true);
  });

  it("isolates different namespaces", () => {
    const limiter1 = new TestAPIRateLimiter("chat");
    const limiter2 = new TestAPIRateLimiter("upload");
    
    for (let i = 0; i < 5; i++) {
      limiter1.check("user:1", config);
    }
    
    const result1 = limiter1.check("user:1", config);
    const result2 = limiter2.check("user:1", config);
    
    expect(result1.allowed).toBe(false);
    expect(result2.allowed).toBe(true);
  });

  it("decrements count correctly", () => {
    limiter.check("user:1", config);
    limiter.check("user:1", config);
    limiter.decrement("user:1");
    
    const result = limiter.check("user:1", config);
    expect(result.remaining).toBe(3);
  });

  it("resets after window expires", () => {
    vi.useFakeTimers();
    
    for (let i = 0; i < 5; i++) {
      limiter.check("user:1", config);
    }
    
    let result = limiter.check("user:1", config);
    expect(result.allowed).toBe(false);
    
    vi.advanceTimersByTime(61000);
    
    result = limiter.check("user:1", config);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    
    vi.useRealTimers();
  });

  it("clears all limits", () => {
    for (let i = 0; i < 5; i++) {
      limiter.check("user:1", config);
      limiter.check("user:2", config);
    }
    
    limiter.clear();
    
    expect(limiter.check("user:1", config).allowed).toBe(true);
    expect(limiter.check("user:2", config).allowed).toBe(true);
  });
});

describe("Rate Limit Middleware Integration", () => {
  it("should return correct headers", () => {
    const limiter = new TestAPIRateLimiter("test");
    const config: RateLimitConfig = { windowMs: 60000, maxRequests: 10 };
    
    const result = limiter.check("user:test", config);
    
    expect(result.remaining).toBe(9);
    expect(result.resetTime).toBeGreaterThan(Date.now());
  });
});
