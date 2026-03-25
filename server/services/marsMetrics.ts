/**
 * MARS Metrics - Prometheus-ready structured logging and metrics
 * 
 * Features:
 * - Counter, Gauge, Histogram metrics
 * - Structured JSON logging
 * - Performance tracking
 * - Error categorization
 */

export interface MetricLabels {
  [key: string]: string | number;
}

interface Counter {
  name: string;
  help: string;
  labels: MetricLabels;
  value: number;
}

interface Gauge {
  name: string;
  help: string;
  labels: MetricLabels;
  value: number;
}

interface HistogramBucket {
  le: number; // less than or equal
  count: number;
}

interface Histogram {
  name: string;
  help: string;
  labels: MetricLabels;
  buckets: HistogramBucket[];
  sum: number;
  count: number;
}

interface StructuredLog {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  component: string;
  message: string;
  duration_ms?: number;
  metadata?: Record<string, any>;
}

class MARSMetrics {
  private counters = new Map<string, Counter>();
  private gauges = new Map<string, Gauge>();
  private histograms = new Map<string, Histogram>();
  private logs: StructuredLog[] = [];
  private readonly maxLogs = 1000;

  // Buckets par défaut pour les latences (en ms)
  private readonly defaultLatencyBuckets = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

  /**
   * Génère une clé unique pour une métrique avec ses labels
   */
  private metricKey(name: string, labels: MetricLabels = {}): string {
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return labelStr ? `${name}{${labelStr}}` : name;
  }

  /**
   * Incrémente un compteur
   */
  incCounter(name: string, labels: MetricLabels = {}, value: number = 1): void {
    const key = this.metricKey(name, labels);
    const existing = this.counters.get(key);
    
    if (existing) {
      existing.value += value;
    } else {
      this.counters.set(key, {
        name,
        help: `Counter for ${name}`,
        labels,
        value
      });
    }
  }

  /**
   * Définit la valeur d'une gauge
   */
  setGauge(name: string, value: number, labels: MetricLabels = {}): void {
    const key = this.metricKey(name, labels);
    this.gauges.set(key, {
      name,
      help: `Gauge for ${name}`,
      labels,
      value
    });
  }

  /**
   * Observe une valeur dans un histogramme
   */
  observeHistogram(name: string, value: number, labels: MetricLabels = {}): void {
    const key = this.metricKey(name, labels);
    let histogram = this.histograms.get(key);

    if (!histogram) {
      histogram = {
        name,
        help: `Histogram for ${name}`,
        labels,
        buckets: this.defaultLatencyBuckets.map(le => ({ le, count: 0 })),
        sum: 0,
        count: 0
      };
      this.histograms.set(key, histogram);
    }

    histogram.count++;
    histogram.sum += value;

    for (const bucket of histogram.buckets) {
      if (value <= bucket.le) {
        bucket.count++;
      }
    }
  }

  /**
   * Log structuré
   */
  log(level: StructuredLog['level'], component: string, message: string, metadata?: Record<string, any>): void {
    const entry: StructuredLog = {
      timestamp: new Date().toISOString(),
      level,
      component,
      message,
      metadata
    };

    this.logs.push(entry);

    // Éviction si trop de logs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs / 2);
    }

    // Aussi logger en console avec format structuré
    const logLine = `[${component}] ${message}`;
    if (level === 'error') {
      console.error(logLine, metadata || '');
    } else if (level === 'warn') {
      console.warn(logLine, metadata || '');
    } else {
      console.log(logLine, metadata || '');
    }
  }

  /**
   * Mesure le temps d'exécution d'une fonction
   */
  async measureDuration<T>(
    name: string,
    fn: () => Promise<T>,
    labels: MetricLabels = {}
  ): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      const duration = Date.now() - start;
      
      this.observeHistogram(`${name}_duration_ms`, duration, labels);
      this.incCounter(`${name}_total`, { ...labels, status: 'success' });
      
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      
      this.observeHistogram(`${name}_duration_ms`, duration, labels);
      this.incCounter(`${name}_total`, { ...labels, status: 'error' });
      this.incCounter(`${name}_errors_total`, labels);
      
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // MARS-specific metrics
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Track search request
   */
  trackSearch(engine: string, success: boolean, durationMs: number, resultCount: number): void {
    this.incCounter('mars_search_requests_total', { engine, success: String(success) });
    this.observeHistogram('mars_search_duration_ms', durationMs, { engine });
    this.setGauge('mars_search_result_count', resultCount, { engine });
    
    if (!success) {
      this.incCounter('mars_search_errors_total', { engine });
    }
  }

  /**
   * Track cache usage
   */
  trackCacheHit(hit: boolean): void {
    this.incCounter('mars_cache_requests_total', { hit: String(hit) });
  }

  /**
   * Track content fetch
   */
  trackFetch(method: string, success: boolean, durationMs: number, contentLength: number): void {
    this.incCounter('mars_fetch_requests_total', { method, success: String(success) });
    this.observeHistogram('mars_fetch_duration_ms', durationMs, { method });
    this.observeHistogram('mars_fetch_content_bytes', contentLength, { method });
  }

  /**
   * Track query rewrite
   */
  trackRewrite(wasRewritten: boolean, transformationCount: number): void {
    this.incCounter('mars_rewrite_total', { rewritten: String(wasRewritten) });
    if (wasRewritten) {
      this.observeHistogram('mars_rewrite_transformations', transformationCount, {});
    }
  }

  /**
   * Track source filtering
   */
  trackSourceFilter(filtered: number, passed: number, blacklisted: number): void {
    this.setGauge('mars_source_filtered', filtered, {});
    this.setGauge('mars_source_passed', passed, {});
    this.incCounter('mars_source_blacklisted_total', {}, blacklisted);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Export methods
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Export all metrics in Prometheus format
   */
  exportPrometheus(): string {
    const lines: string[] = [];

    // Counters
    for (const [key, counter] of this.counters) {
      lines.push(`# HELP ${counter.name} ${counter.help}`);
      lines.push(`# TYPE ${counter.name} counter`);
      lines.push(`${key} ${counter.value}`);
    }

    // Gauges
    for (const [key, gauge] of this.gauges) {
      lines.push(`# HELP ${gauge.name} ${gauge.help}`);
      lines.push(`# TYPE ${gauge.name} gauge`);
      lines.push(`${key} ${gauge.value}`);
    }

    // Histograms
    for (const [key, histogram] of this.histograms) {
      lines.push(`# HELP ${histogram.name} ${histogram.help}`);
      lines.push(`# TYPE ${histogram.name} histogram`);
      
      for (const bucket of histogram.buckets) {
        const bucketKey = key.replace('}', `,le="${bucket.le}"}`);
        lines.push(`${histogram.name}_bucket${bucketKey.replace(histogram.name, '')} ${bucket.count}`);
      }
      
      lines.push(`${key.replace(histogram.name, `${histogram.name}_sum`)} ${histogram.sum}`);
      lines.push(`${key.replace(histogram.name, `${histogram.name}_count`)} ${histogram.count}`);
    }

    return lines.join('\n');
  }

  /**
   * Export metrics as JSON
   */
  exportJSON(): {
    counters: Record<string, number>;
    gauges: Record<string, number>;
    histograms: Record<string, { count: number; sum: number; avg: number }>;
    recentLogs: StructuredLog[];
  } {
    const counters: Record<string, number> = {};
    const gauges: Record<string, number> = {};
    const histograms: Record<string, { count: number; sum: number; avg: number }> = {};

    for (const [key, counter] of this.counters) {
      counters[key] = counter.value;
    }

    for (const [key, gauge] of this.gauges) {
      gauges[key] = gauge.value;
    }

    for (const [key, histogram] of this.histograms) {
      histograms[key] = {
        count: histogram.count,
        sum: histogram.sum,
        avg: histogram.count > 0 ? histogram.sum / histogram.count : 0
      };
    }

    return {
      counters,
      gauges,
      histograms,
      recentLogs: this.logs.slice(-50)
    };
  }

  /**
   * Get summary stats
   */
  getSummary(): {
    totalSearches: number;
    successRate: number;
    avgLatencyMs: number;
    cacheHitRate: number;
    errorsLast5min: number;
  } {
    const searchSuccessKey = 'mars_search_requests_total{engine="all",success="true"}';
    const searchFailKey = 'mars_search_requests_total{engine="all",success="false"}';
    const cacheHitKey = 'mars_cache_requests_total{hit="true"}';
    const cacheMissKey = 'mars_cache_requests_total{hit="false"}';

    const success = this.counters.get(searchSuccessKey)?.value || 0;
    const fail = this.counters.get(searchFailKey)?.value || 0;
    const total = success + fail;

    const hits = this.counters.get(cacheHitKey)?.value || 0;
    const misses = this.counters.get(cacheMissKey)?.value || 0;
    const cacheTotal = hits + misses;

    const histogram = this.histograms.get('mars_search_duration_ms{engine="all"}');
    const avgLatency = histogram && histogram.count > 0 ? histogram.sum / histogram.count : 0;

    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const recentErrors = this.logs.filter(l => l.level === 'error' && l.timestamp > fiveMinAgo).length;

    return {
      totalSearches: total,
      successRate: total > 0 ? success / total : 1,
      avgLatencyMs: avgLatency,
      cacheHitRate: cacheTotal > 0 ? hits / cacheTotal : 0,
      errorsLast5min: recentErrors
    };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.logs = [];
  }
}

// Singleton export
export const marsMetrics = new MARSMetrics();
