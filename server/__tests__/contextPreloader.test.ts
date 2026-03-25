import { describe, it, expect, vi, beforeEach } from "vitest";
import { metricsService } from "../services/metricsService";

describe("Context Preloader & Metrics Service", () => {
  beforeEach(() => {
    metricsService.reset();
  });

  describe("Metrics Service - Preload Latency", () => {
    it("records preload latency for different contexts", () => {
      metricsService.recordPreloadLatency("time", 50);
      metricsService.recordPreloadLatency("calendar", 120);
      metricsService.recordPreloadLatency("memory", 80);
      metricsService.recordPreloadLatency("spotify", 30);
      metricsService.recordPreloadLatency("geolocation", 25);

      const snapshot = metricsService.getSnapshot();
      expect(snapshot.preload.latency.time.count).toBe(1);
      expect(snapshot.preload.latency.calendar.count).toBe(1);
      expect(snapshot.preload.latency.memory.count).toBe(1);
      expect(snapshot.preload.latency.spotify.count).toBe(1);
      expect(snapshot.preload.latency.geolocation.count).toBe(1);
    });

    it("calculates average and max latency", () => {
      metricsService.recordPreloadLatency("time", 100);
      metricsService.recordPreloadLatency("time", 200);
      metricsService.recordPreloadLatency("time", 150);

      const snapshot = metricsService.getSnapshot();
      const timeMetric = snapshot.preload.latency.time as any;
      expect(timeMetric.avgMs).toBe(150);
      expect(timeMetric.maxMs).toBe(200);
      expect(timeMetric.minMs).toBe(100);
    });

    it("records total preload with success/failure", () => {
      metricsService.recordPreloadTotal(250, true);
      metricsService.recordPreloadTotal(300, true);
      metricsService.recordPreloadTotal(180, false);

      const snapshot = metricsService.getSnapshot();
      expect(snapshot.preload.totalPreloads).toBe(3);
      expect(snapshot.preload.successfulPreloads).toBe(2);
    });
  });

  describe("Metrics Service - Cache Tracking", () => {
    it("tracks cache hits", () => {
      metricsService.recordCacheHit();
      metricsService.recordCacheHit();
      metricsService.recordCacheHit();

      const snapshot = metricsService.getSnapshot();
      expect(snapshot.preload.cache.hits).toBe(3);
    });

    it("tracks cache misses", () => {
      metricsService.recordCacheMiss();
      metricsService.recordCacheMiss();

      const snapshot = metricsService.getSnapshot();
      expect(snapshot.preload.cache.misses).toBe(2);
    });

    it("tracks cache expirations", () => {
      metricsService.recordCacheExpired();

      const snapshot = metricsService.getSnapshot();
      expect(snapshot.preload.cache.expired).toBe(1);
    });

    it("calculates cache hit rate in summary", () => {
      metricsService.recordCacheHit();
      metricsService.recordCacheHit();
      metricsService.recordCacheHit();
      metricsService.recordCacheMiss();

      const summary = metricsService.getSummary();
      expect(summary.preload.cacheHitRate).toBe("75.0%");
    });
  });

  describe("Metrics Service - Error Tracking", () => {
    it("records preload errors", () => {
      metricsService.recordPreloadError("calendar", "Calendar API timeout");
      metricsService.recordPreloadError("spotify", "Spotify not connected");

      const snapshot = metricsService.getSnapshot();
      expect(snapshot.preload.errors.count).toBe(2);
      expect(snapshot.preload.errors.lastError).toBe("Spotify not connected");
      expect(snapshot.preload.errors.errorTypes.calendar).toBe(1);
      expect(snapshot.preload.errors.errorTypes.spotify).toBe(1);
    });
  });

  describe("Metrics Service - AI Metrics", () => {
    it("records AI latency", () => {
      metricsService.recordAILatency(1500);
      metricsService.recordAILatency(2000);

      const snapshot = metricsService.getSnapshot();
      expect(snapshot.ai.latency.count).toBe(2);
      expect((snapshot.ai.latency as any).avgMs).toBe(1750);
    });

    it("records AI token usage", () => {
      metricsService.recordAITokens(500, 200);
      metricsService.recordAITokens(300, 150);

      const snapshot = metricsService.getSnapshot();
      expect(snapshot.ai.tokenUsage.input).toBe(800);
      expect(snapshot.ai.tokenUsage.output).toBe(350);
    });

    it("records AI provider usage", () => {
      metricsService.recordAIProvider("openai");
      metricsService.recordAIProvider("openai");
      metricsService.recordAIProvider("gemini");

      const snapshot = metricsService.getSnapshot();
      expect(snapshot.ai.providerUsage.openai).toBe(2);
      expect(snapshot.ai.providerUsage.gemini).toBe(1);
    });

    it("records AI errors", () => {
      metricsService.recordAIError("Rate limit exceeded", "rate_limit");

      const snapshot = metricsService.getSnapshot();
      expect(snapshot.ai.errors.count).toBe(1);
      expect(snapshot.ai.errors.errorTypes.rate_limit).toBe(1);
    });
  });

  describe("Metrics Service - Summary", () => {
    it("provides a complete summary", () => {
      metricsService.recordPreloadTotal(200, true);
      metricsService.recordCacheHit();
      metricsService.recordAILatency(1000);
      metricsService.recordAIProvider("openai");
      metricsService.recordAITokens(100, 50);

      const summary = metricsService.getSummary();
      
      expect(summary.preload).toBeDefined();
      expect(summary.preload.totalPreloads).toBe(1);
      expect(summary.preload.successRate).toBe("100.0%");
      
      expect(summary.ai).toBeDefined();
      expect(summary.ai.totalRequests).toBe(1);
      expect(summary.ai.tokensUsed).toBe(150);
      expect(summary.ai.providerUsage.openai).toBe(1);
      
      expect(summary.uptimeHours).toBeDefined();
    });
  });

  describe("Metrics Service - Reset", () => {
    it("resets all metrics", () => {
      metricsService.recordPreloadTotal(200, true);
      metricsService.recordCacheHit();
      metricsService.recordAILatency(1000);
      
      metricsService.reset();
      
      const snapshot = metricsService.getSnapshot();
      expect(snapshot.preload.totalPreloads).toBe(0);
      expect(snapshot.preload.cache.hits).toBe(0);
      expect(snapshot.ai.latency.count).toBe(0);
    });
  });
});
