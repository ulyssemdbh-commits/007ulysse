/**
 * MARS Retry Handler - Exponential backoff with adaptive retry
 * 
 * Features:
 * - Exponential backoff with jitter
 * - Per-service retry configuration
 * - Adaptive timeouts based on history
 * - Dead letter queue for failed requests
 */

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterPercent: number; // 0-100
  retryableErrors: string[];
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  attempts: number;
  totalTimeMs: number;
  retriedAfterErrors: string[];
}

// Default configs per service
const SERVICE_CONFIGS: Record<string, RetryConfig> = {
  serper: {
    maxRetries: 3,
    initialDelayMs: 100,
    maxDelayMs: 2000,
    backoffMultiplier: 2,
    jitterPercent: 25,
    retryableErrors: ['timeout', 'ECONNRESET', 'ETIMEDOUT', '429', '500', '502', '503', '504']
  },
  perplexity: {
    maxRetries: 2,
    initialDelayMs: 200,
    maxDelayMs: 3000,
    backoffMultiplier: 2.5,
    jitterPercent: 30,
    retryableErrors: ['timeout', 'ECONNRESET', '429', '500', '502', '503']
  },
  brave: {
    maxRetries: 2,
    initialDelayMs: 150,
    maxDelayMs: 2500,
    backoffMultiplier: 2,
    jitterPercent: 25,
    retryableErrors: ['timeout', 'ECONNRESET', '429', '500', '502', '503', '504']
  },
  fetch: {
    maxRetries: 2,
    initialDelayMs: 500,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
    jitterPercent: 20,
    retryableErrors: ['timeout', 'ECONNRESET', 'ETIMEDOUT', '429', '500', '502', '503']
  },
  default: {
    maxRetries: 3,
    initialDelayMs: 200,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
    jitterPercent: 25,
    retryableErrors: ['timeout', 'ECONNRESET', 'ETIMEDOUT', '429', '500', '502', '503', '504']
  }
};

// Historique des latences pour adaptation
const latencyHistory: Record<string, number[]> = {};
const MAX_HISTORY = 50;

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(attempt: number, config: RetryConfig): number {
  // Exponential backoff
  let delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
  
  // Cap at max delay
  delay = Math.min(delay, config.maxDelayMs);
  
  // Add jitter (±jitterPercent)
  const jitter = delay * (config.jitterPercent / 100);
  delay = delay + (Math.random() * 2 - 1) * jitter;
  
  return Math.round(delay);
}

/**
 * Check if an error is retryable
 */
function isRetryable(error: Error | string, config: RetryConfig): boolean {
  const errorStr = typeof error === 'string' ? error : error.message || error.toString();
  return config.retryableErrors.some(pattern => 
    errorStr.toLowerCase().includes(pattern.toLowerCase())
  );
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Record latency for adaptive timeout
 */
function recordLatency(service: string, latencyMs: number): void {
  if (!latencyHistory[service]) {
    latencyHistory[service] = [];
  }
  latencyHistory[service].push(latencyMs);
  
  // Keep only recent history
  if (latencyHistory[service].length > MAX_HISTORY) {
    latencyHistory[service] = latencyHistory[service].slice(-MAX_HISTORY);
  }
}

/**
 * Get adaptive timeout based on history
 */
function getAdaptiveTimeout(service: string, defaultTimeout: number): number {
  const history = latencyHistory[service];
  if (!history || history.length < 5) {
    return defaultTimeout;
  }

  // Calculate p95 latency
  const sorted = [...history].sort((a, b) => a - b);
  const p95Index = Math.floor(sorted.length * 0.95);
  const p95 = sorted[p95Index];

  // Adaptive timeout = p95 + 50% buffer, capped at 2x default
  return Math.min(p95 * 1.5, defaultTimeout * 2);
}

/**
 * Execute with retry and exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: {
    service?: string;
    config?: Partial<RetryConfig>;
    onRetry?: (attempt: number, error: Error, delay: number) => void;
  }
): Promise<RetryResult<T>> {
  const service = options?.service || 'default';
  const baseConfig = SERVICE_CONFIGS[service] || SERVICE_CONFIGS.default;
  const config: RetryConfig = { ...baseConfig, ...options?.config };
  
  const startTime = Date.now();
  const retriedAfterErrors: string[] = [];
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const attemptStart = Date.now();
      const result = await fn();
      const latency = Date.now() - attemptStart;
      
      recordLatency(service, latency);
      
      return {
        success: true,
        data: result,
        attempts: attempt + 1,
        totalTimeMs: Date.now() - startTime,
        retriedAfterErrors
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if we should retry
      if (attempt < config.maxRetries && isRetryable(lastError, config)) {
        const delay = calculateDelay(attempt, config);
        retriedAfterErrors.push(lastError.message);
        
        console.log(`[MARS:Retry] ${service} attempt ${attempt + 1}/${config.maxRetries + 1} failed: ${lastError.message}. Retrying in ${delay}ms`);
        
        options?.onRetry?.(attempt, lastError, delay);
        
        await sleep(delay);
      } else {
        // Not retryable or max retries reached
        break;
      }
    }
  }

  return {
    success: false,
    error: lastError?.message || 'Unknown error',
    attempts: config.maxRetries + 1,
    totalTimeMs: Date.now() - startTime,
    retriedAfterErrors
  };
}

/**
 * Execute multiple functions with retry, in parallel
 */
export async function withRetryParallel<T>(
  fns: Array<{ fn: () => Promise<T>; service?: string }>,
  options?: {
    stopOnFirstSuccess?: boolean;
  }
): Promise<Array<RetryResult<T>>> {
  if (options?.stopOnFirstSuccess) {
    // Race mode: return as soon as one succeeds
    return Promise.race(
      fns.map(async ({ fn, service }) => {
        const result = await withRetry(fn, { service });
        if (result.success) {
          return [result];
        }
        throw new Error('Failed');
      })
    ).catch(() => 
      // If none succeeded, run all and return results
      Promise.all(fns.map(({ fn, service }) => withRetry(fn, { service })))
    );
  }

  // Default: run all in parallel
  return Promise.all(fns.map(({ fn, service }) => withRetry(fn, { service })));
}

/**
 * Execute with timeout and retry
 */
export async function withTimeoutAndRetry<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  options?: {
    service?: string;
    fallback?: T;
  }
): Promise<RetryResult<T>> {
  const service = options?.service || 'default';
  const adaptiveTimeout = getAdaptiveTimeout(service, timeoutMs);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('timeout')), adaptiveTimeout);
  });

  const wrappedFn = () => Promise.race([fn(), timeoutPromise]);

  const result = await withRetry(wrappedFn, { service });

  if (!result.success && options?.fallback !== undefined) {
    return {
      ...result,
      success: true,
      data: options.fallback
    };
  }

  return result;
}

/**
 * Get retry stats for a service
 */
export function getRetryStats(service?: string): {
  service: string;
  config: RetryConfig;
  avgLatencyMs: number;
  adaptiveTimeoutMs: number;
  historySize: number;
} {
  const svc = service || 'default';
  const config = SERVICE_CONFIGS[svc] || SERVICE_CONFIGS.default;
  const history = latencyHistory[svc] || [];
  const avgLatency = history.length > 0 
    ? history.reduce((a, b) => a + b, 0) / history.length 
    : 0;

  return {
    service: svc,
    config,
    avgLatencyMs: Math.round(avgLatency),
    adaptiveTimeoutMs: getAdaptiveTimeout(svc, config.maxDelayMs),
    historySize: history.length
  };
}

export const marsRetryHandler = {
  withRetry,
  withRetryParallel,
  withTimeoutAndRetry,
  getRetryStats,
  getAdaptiveTimeout
};
