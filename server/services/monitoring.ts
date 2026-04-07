interface Metric {
  name: string;
  value: number;
  timestamp: number;
  labels?: Record<string, string>;
}

interface HealthCheck {
  name: string;
  status: "healthy" | "degraded" | "unhealthy";
  lastCheck: number;
  message?: string;
  responseTime?: number;
}

class MonitoringService {
  private metrics: Map<string, Metric[]> = new Map();
  private healthChecks: Map<string, HealthCheck> = new Map();
  private readonly maxMetricsPerKey = 1000;
  private readonly metricsRetentionMs = 60 * 60 * 1000;

  recordMetric(name: string, value: number, labels?: Record<string, string>): void {
    const metric: Metric = {
      name,
      value,
      timestamp: Date.now(),
      labels,
    };

    const key = this.getMetricKey(name, labels);
    const existing = this.metrics.get(key) || [];
    existing.push(metric);

    if (existing.length > this.maxMetricsPerKey) {
      existing.splice(0, existing.length - this.maxMetricsPerKey);
    }

    this.metrics.set(key, existing);
  }

  private getMetricKey(name: string, labels?: Record<string, string>): string {
    if (!labels) return name;
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    return `${name}{${labelStr}}`;
  }

  getMetrics(name: string, labels?: Record<string, string>, since?: number): Metric[] {
    const key = this.getMetricKey(name, labels);
    const metrics = this.metrics.get(key) || [];
    
    if (since) {
      return metrics.filter(m => m.timestamp >= since);
    }
    return [...metrics];
  }

  getAggregatedMetrics(name: string, labels?: Record<string, string>, windowMs: number = 60000): {
    count: number;
    sum: number;
    avg: number;
    min: number;
    max: number;
    p50: number;
    p95: number;
    p99: number;
  } {
    const since = Date.now() - windowMs;
    const metrics = this.getMetrics(name, labels, since);
    
    if (metrics.length === 0) {
      return { count: 0, sum: 0, avg: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0 };
    }

    const values = metrics.map(m => m.value).sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    
    return {
      count: values.length,
      sum,
      avg: sum / values.length,
      min: values[0],
      max: values[values.length - 1],
      p50: this.percentile(values, 50),
      p95: this.percentile(values, 95),
      p99: this.percentile(values, 99),
    };
  }

  private percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) return 0;
    const index = Math.ceil((p / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, index)];
  }

  recordHealthCheck(name: string, status: HealthCheck["status"], message?: string, responseTime?: number): void {
    this.healthChecks.set(name, {
      name,
      status,
      lastCheck: Date.now(),
      message,
      responseTime,
    });
  }

  getHealthStatus(): {
    overall: HealthCheck["status"];
    checks: HealthCheck[];
  } {
    const checks = Array.from(this.healthChecks.values());
    
    let overall: HealthCheck["status"] = "healthy";
    for (const check of checks) {
      if (check.status === "unhealthy") {
        overall = "unhealthy";
        break;
      }
      if (check.status === "degraded") {
        overall = "degraded";
      }
    }

    return { overall, checks };
  }

  incrementCounter(name: string, labels?: Record<string, string>): void {
    const key = `counter:${this.getMetricKey(name, labels)}`;
    const existing = this.metrics.get(key) || [];
    const lastValue = existing.length > 0 ? existing[existing.length - 1].value : 0;
    
    this.recordMetric(`counter:${name}`, lastValue + 1, labels);
  }

  getCounter(name: string, labels?: Record<string, string>): number {
    const key = `counter:${this.getMetricKey(name, labels)}`;
    const metrics = this.metrics.get(key) || [];
    return metrics.length > 0 ? metrics[metrics.length - 1].value : 0;
  }

  cleanup(): number {
    const cutoff = Date.now() - this.metricsRetentionMs;
    let cleaned = 0;

    for (const [key, metrics] of this.metrics.entries()) {
      const remaining = metrics.filter(m => m.timestamp >= cutoff);
      if (remaining.length !== metrics.length) {
        cleaned += metrics.length - remaining.length;
        if (remaining.length === 0) {
          this.metrics.delete(key);
        } else {
          this.metrics.set(key, remaining);
        }
      }
    }

    return cleaned;
  }

  getSystemMetrics(): Record<string, unknown> {
    const memUsage = process.memoryUsage();
    return {
      uptime: process.uptime(),
      memory: {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        rss: Math.round(memUsage.rss / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024),
      },
      cpu: process.cpuUsage(),
    };
  }
}

export const monitoring = new MonitoringService();

export function recordRequestMetric(
  method: string,
  path: string,
  statusCode: number,
  durationMs: number
): void {
  monitoring.recordMetric("http_request_duration_ms", durationMs, { method, path, status: String(statusCode) });
  monitoring.incrementCounter("http_requests_total", { method, path, status: String(statusCode) });
}

export function recordApiError(endpoint: string, errorType: string): void {
  monitoring.incrementCounter("api_errors_total", { endpoint, errorType });
}

export function recordExternalApiCall(service: string, success: boolean, durationMs: number): void {
  monitoring.recordMetric("external_api_duration_ms", durationMs, { service, success: String(success) });
  monitoring.incrementCounter("external_api_calls_total", { service, success: String(success) });
}

export function recordWebSocketConnection(action: "connect" | "disconnect" | "auth"): void {
  monitoring.incrementCounter("websocket_events_total", { action });
}

export function recordCacheOperation(operation: "hit" | "miss" | "set" | "delete"): void {
  monitoring.incrementCounter("cache_operations_total", { operation });
}

export function getMonitoringDashboard(): Record<string, unknown> {
  const health = monitoring.getHealthStatus();
  const system = monitoring.getSystemMetrics();
  
  return {
    health,
    system,
    requests: monitoring.getAggregatedMetrics("http_request_duration_ms", undefined, 300000),
    errors: monitoring.getCounter("api_errors_total"),
    websockets: {
      connects: monitoring.getCounter("websocket_events_total", { action: "connect" }),
      disconnects: monitoring.getCounter("websocket_events_total", { action: "disconnect" }),
    },
    cache: {
      hits: monitoring.getCounter("cache_operations_total", { operation: "hit" }),
      misses: monitoring.getCounter("cache_operations_total", { operation: "miss" }),
    },
  };
}
