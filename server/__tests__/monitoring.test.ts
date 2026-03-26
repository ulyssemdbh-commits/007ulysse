import { describe, it, expect, vi, beforeEach } from "vitest";

interface Metric {
  name: string;
  value: number;
  timestamp: number;
  labels?: Record<string, string>;
}

class TestMonitoringService {
  private metrics: Map<string, Metric[]> = new Map();

  recordMetric(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.getKey(name, labels);
    const existing = this.metrics.get(key) || [];
    existing.push({ name, value, timestamp: Date.now(), labels });
    this.metrics.set(key, existing);
  }

  private getKey(name: string, labels?: Record<string, string>): string {
    if (!labels) return name;
    return `${name}{${Object.entries(labels).map(([k, v]) => `${k}=${v}`).join(",")}}`;
  }

  getMetrics(name: string, labels?: Record<string, string>): Metric[] {
    return this.metrics.get(this.getKey(name, labels)) || [];
  }

  getAggregated(name: string, labels?: Record<string, string>): { count: number; avg: number; min: number; max: number } {
    const metrics = this.getMetrics(name, labels);
    if (metrics.length === 0) return { count: 0, avg: 0, min: 0, max: 0 };
    
    const values = metrics.map(m => m.value);
    const sum = values.reduce((a, b) => a + b, 0);
    
    return {
      count: values.length,
      avg: sum / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }

  incrementCounter(name: string, labels?: Record<string, string>): void {
    const key = `counter:${this.getKey(name, labels)}`;
    const existing = this.metrics.get(key) || [];
    const lastValue = existing.length > 0 ? existing[existing.length - 1].value : 0;
    existing.push({ name, value: lastValue + 1, timestamp: Date.now(), labels });
    this.metrics.set(key, existing);
  }

  getCounter(name: string, labels?: Record<string, string>): number {
    const key = `counter:${this.getKey(name, labels)}`;
    const metrics = this.metrics.get(key) || [];
    return metrics.length > 0 ? metrics[metrics.length - 1].value : 0;
  }

  clear(): void {
    this.metrics.clear();
  }
}

describe("Monitoring Service", () => {
  let monitoring: TestMonitoringService;

  beforeEach(() => {
    monitoring = new TestMonitoringService();
  });

  describe("Metrics Recording", () => {
    it("records metrics correctly", () => {
      monitoring.recordMetric("request_duration", 150);
      const metrics = monitoring.getMetrics("request_duration");
      expect(metrics).toHaveLength(1);
      expect(metrics[0].value).toBe(150);
    });

    it("records metrics with labels", () => {
      monitoring.recordMetric("request_duration", 100, { method: "GET", path: "/api" });
      monitoring.recordMetric("request_duration", 200, { method: "POST", path: "/api" });
      
      const getMetrics = monitoring.getMetrics("request_duration", { method: "GET", path: "/api" });
      const postMetrics = monitoring.getMetrics("request_duration", { method: "POST", path: "/api" });
      
      expect(getMetrics).toHaveLength(1);
      expect(postMetrics).toHaveLength(1);
      expect(getMetrics[0].value).toBe(100);
      expect(postMetrics[0].value).toBe(200);
    });
  });

  describe("Aggregations", () => {
    it("calculates aggregations correctly", () => {
      monitoring.recordMetric("duration", 100);
      monitoring.recordMetric("duration", 200);
      monitoring.recordMetric("duration", 150);
      
      const agg = monitoring.getAggregated("duration");
      expect(agg.count).toBe(3);
      expect(agg.avg).toBe(150);
      expect(agg.min).toBe(100);
      expect(agg.max).toBe(200);
    });

    it("returns zeros for empty metrics", () => {
      const agg = monitoring.getAggregated("nonexistent");
      expect(agg.count).toBe(0);
      expect(agg.avg).toBe(0);
    });
  });

  describe("Counters", () => {
    it("increments counter correctly", () => {
      monitoring.incrementCounter("requests");
      monitoring.incrementCounter("requests");
      monitoring.incrementCounter("requests");
      
      expect(monitoring.getCounter("requests")).toBe(3);
    });

    it("tracks counters with labels separately", () => {
      monitoring.incrementCounter("requests", { status: "200" });
      monitoring.incrementCounter("requests", { status: "200" });
      monitoring.incrementCounter("requests", { status: "500" });
      
      expect(monitoring.getCounter("requests", { status: "200" })).toBe(2);
      expect(monitoring.getCounter("requests", { status: "500" })).toBe(1);
    });

    it("returns 0 for non-existent counter", () => {
      expect(monitoring.getCounter("nonexistent")).toBe(0);
    });
  });

  describe("Clear", () => {
    it("clears all metrics", () => {
      monitoring.recordMetric("duration", 100);
      monitoring.incrementCounter("requests");
      monitoring.clear();
      
      expect(monitoring.getMetrics("duration")).toHaveLength(0);
      expect(monitoring.getCounter("requests")).toBe(0);
    });
  });
});
