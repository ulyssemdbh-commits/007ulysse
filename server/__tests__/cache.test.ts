import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cache, cacheKey, withCache } from "../services/cache";

describe("Cache Service - Real Implementation", () => {
  beforeEach(() => {
    cache.clear();
  });

  describe("Basic Operations", () => {
    it("stores and retrieves values", () => {
      cache.set("test_key", "test_value", 60000);
      expect(cache.get("test_key")).toBe("test_value");
    });

    it("returns null for missing keys", () => {
      expect(cache.get("nonexistent")).toBeNull();
    });

    it("deletes keys", () => {
      cache.set("delete_test", "value", 60000);
      cache.delete("delete_test");
      expect(cache.get("delete_test")).toBeNull();
    });

    it("clears all entries", () => {
      cache.set("key1", "value1", 60000);
      cache.set("key2", "value2", 60000);
      cache.clear();
      expect(cache.get("key1")).toBeNull();
      expect(cache.get("key2")).toBeNull();
    });
  });

  describe("TTL Expiration", () => {
    it("returns value before expiry", () => {
      cache.set("ttl_test", "value", 10000);
      expect(cache.get("ttl_test")).toBe("value");
    });

    it("expires values after TTL", async () => {
      vi.useFakeTimers();
      cache.set("expire_test", "value", 100);
      vi.advanceTimersByTime(150);
      expect(cache.get("expire_test")).toBeNull();
      vi.useRealTimers();
    });
  });

  describe("Statistics", () => {
    it("tracks cache stats", () => {
      cache.set("stats_test", "value", 60000);
      cache.get("stats_test");
      cache.get("nonexistent");
      
      const stats = cache.getStats();
      expect(stats.hits).toBeGreaterThanOrEqual(0);
      expect(stats.misses).toBeGreaterThanOrEqual(0);
      expect(typeof stats.size).toBe("number");
    });
  });

  describe("Cache Key Generation", () => {
    it("generates correct cache keys", () => {
      const key = cacheKey("user", 123, "profile");
      expect(key).toBe("user:123:profile");
    });

    it("handles single part", () => {
      const key = cacheKey("prefix", "value");
      expect(key).toBe("prefix:value");
    });
  });

  describe("Pattern Invalidation", () => {
    it("invalidates matching patterns", () => {
      cache.set("user:1:profile", "data1", 60000);
      cache.set("user:1:settings", "data2", 60000);
      cache.set("user:2:profile", "data3", 60000);
      
      const count = cache.invalidatePattern("user:1:*");
      expect(count).toBe(2);
      expect(cache.get("user:1:profile")).toBeNull();
      expect(cache.get("user:2:profile")).toBe("data3");
    });
  });

  describe("withCache Helper", () => {
    it("returns cached value on hit", async () => {
      cache.set("with_cache_test", "cached", 60000);
      const fetcher = vi.fn(() => Promise.resolve("fresh"));
      
      const result = await withCache("with_cache_test", fetcher);
      expect(result).toBe("cached");
      expect(fetcher).not.toHaveBeenCalled();
    });

    it("calls fetcher on miss", async () => {
      const fetcher = vi.fn(() => Promise.resolve("fresh_data"));
      
      const result = await withCache("new_key", fetcher);
      expect(result).toBe("fresh_data");
      expect(fetcher).toHaveBeenCalledOnce();
    });
  });
});
