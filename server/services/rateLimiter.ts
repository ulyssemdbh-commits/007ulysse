interface RateLimitEntry {
  count: number;
  resetTime: number;
}

interface QueuedRequest<T> {
  service: "openai" | "serper" | "combined";
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  priority: number;
  retries: number;
}

class RateLimiter {
  private limits: Map<string, RateLimitEntry> = new Map();
  private queue: QueuedRequest<unknown>[] = [];
  private isProcessing = false;
  
  private readonly maxCallsPerMinute = 10;
  private readonly minIntervalMs = 2000;
  private readonly maxRetries = 3;
  private lastCallTime: Map<string, number> = new Map();

  private checkLimit(service: string): { allowed: boolean; waitTime: number } {
    const now = Date.now();
    const entry = this.limits.get(service);
    
    if (!entry || now >= entry.resetTime) {
      this.limits.set(service, { count: 1, resetTime: now + 60000 });
      return { allowed: true, waitTime: 0 };
    }
    
    if (entry.count >= this.maxCallsPerMinute) {
      const waitTime = entry.resetTime - now;
      return { allowed: false, waitTime };
    }
    
    entry.count++;
    return { allowed: true, waitTime: 0 };
  }

  private getIntervalWaitTime(service: string): number {
    const lastCall = this.lastCallTime.get(service) || 0;
    const timeSinceLastCall = Date.now() - lastCall;
    
    if (timeSinceLastCall < this.minIntervalMs) {
      return this.minIntervalMs - timeSinceLastCall;
    }
    return 0;
  }

  async executeWithLimit<T>(
    service: "openai" | "serper" | "combined",
    operation: () => Promise<T>,
    priority: number = 0
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        service,
        execute: operation,
        resolve: resolve as (value: unknown) => void,
        reject,
        priority,
        retries: 0
      });
      
      this.queue.sort((a, b) => b.priority - a.priority);
      
      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;
    
    this.isProcessing = true;
    
    while (this.queue.length > 0) {
      const request = this.queue[0];
      
      const intervalWait = this.getIntervalWaitTime(request.service);
      if (intervalWait > 0) {
        await this.sleep(intervalWait);
      }
      
      const { allowed, waitTime } = this.checkLimit(request.service);
      
      if (!allowed) {
        if (request.retries < this.maxRetries) {
          request.retries++;
          console.log(`Rate limit for ${request.service}, waiting ${waitTime}ms (retry ${request.retries}/${this.maxRetries})`);
          await this.sleep(Math.min(waitTime, 10000));
          continue;
        } else {
          this.queue.shift();
          request.reject(new Error(`RATE_LIMIT_EXCEEDED: ${request.service} - max retries reached`));
          continue;
        }
      }
      
      this.queue.shift();
      this.lastCallTime.set(request.service, Date.now());
      
      try {
        const result = await request.execute();
        request.resolve(result);
      } catch (error) {
        if (error instanceof Error && error.message.includes("429") && request.retries < this.maxRetries) {
          request.retries++;
          console.log(`429 error for ${request.service}, requeuing (retry ${request.retries}/${this.maxRetries})`);
          this.queue.unshift(request);
          await this.sleep(5000);
        } else {
          request.reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    }
    
    this.isProcessing = false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getRemainingCalls(service: string): number {
    const entry = this.limits.get(service);
    if (!entry || Date.now() >= entry.resetTime) {
      return this.maxCallsPerMinute;
    }
    return Math.max(0, this.maxCallsPerMinute - entry.count);
  }

  isRateLimited(service: string): boolean {
    const entry = this.limits.get(service);
    if (!entry || Date.now() >= entry.resetTime) {
      return false;
    }
    return entry.count >= this.maxCallsPerMinute;
  }
}

export const rateLimiter = new RateLimiter();

export async function withRateLimit<T>(
  service: "openai" | "serper" | "combined",
  operation: () => Promise<T>,
  priority: number = 0
): Promise<T> {
  return rateLimiter.executeWithLimit(service, operation, priority);
}

export function canMakeCall(service: "openai" | "serper" | "combined"): boolean {
  return !rateLimiter.isRateLimited(service);
}

export function getRemainingQuota(service: "openai" | "serper" | "combined"): number {
  return rateLimiter.getRemainingCalls(service);
}
