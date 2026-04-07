type CircuitState = "closed" | "open" | "half-open";

interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
  name: string;
}

interface CircuitStats {
  failures: number;
  successes: number;
  lastFailure: number | null;
  state: CircuitState;
}

export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private stats: CircuitStats;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      failureThreshold: config.failureThreshold ?? 5,
      successThreshold: config.successThreshold ?? 2,
      timeout: config.timeout ?? 30000,
      name: config.name ?? "default",
    };
    this.stats = {
      failures: 0,
      successes: 0,
      lastFailure: null,
      state: "closed",
    };
  }

  async execute<T>(operation: () => Promise<T>, fallback?: () => T): Promise<T> {
    if (this.stats.state === "open") {
      if (this.stats.lastFailure && Date.now() - this.stats.lastFailure >= this.config.timeout) {
        console.log(`[CircuitBreaker:${this.config.name}] Transitioning to half-open`);
        this.stats.state = "half-open";
        this.stats.successes = 0;
      } else {
        console.log(`[CircuitBreaker:${this.config.name}] Circuit is open, using fallback`);
        if (fallback) return fallback();
        throw new Error(`Circuit breaker ${this.config.name} is open`);
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      if (fallback && this.isOpen()) {
        console.log(`[CircuitBreaker:${this.config.name}] Operation failed, using fallback`);
        return fallback();
      }
      throw error;
    }
  }

  isOpen(): boolean {
    return this.stats.state === "open";
  }

  isClosed(): boolean {
    return this.stats.state === "closed";
  }

  private onSuccess(): void {
    this.stats.failures = 0;
    
    if (this.stats.state === "half-open") {
      this.stats.successes++;
      if (this.stats.successes >= this.config.successThreshold) {
        console.log(`[CircuitBreaker:${this.config.name}] Circuit closed after ${this.stats.successes} successes`);
        this.stats.state = "closed";
        this.stats.successes = 0;
      }
    }
  }

  private onFailure(): void {
    this.stats.failures++;
    this.stats.lastFailure = Date.now();
    this.stats.successes = 0;

    if (this.stats.state === "half-open") {
      console.log(`[CircuitBreaker:${this.config.name}] Failure in half-open, reopening circuit`);
      this.stats.state = "open";
    } else if (this.stats.failures >= this.config.failureThreshold) {
      console.log(`[CircuitBreaker:${this.config.name}] Opening circuit after ${this.stats.failures} failures`);
      this.stats.state = "open";
    }
  }

  getState(): CircuitState {
    return this.stats.state;
  }

  getStats(): CircuitStats {
    return { ...this.stats };
  }

  reset(): void {
    this.stats = {
      failures: 0,
      successes: 0,
      lastFailure: null,
      state: "closed",
    };
    console.log(`[CircuitBreaker:${this.config.name}] Circuit reset`);
  }
}

export const dependencyCircuitBreakers: Record<string, CircuitBreaker> = {
  database: new CircuitBreaker({ name: "database", failureThreshold: 3, timeout: 30000 }),
  openai: new CircuitBreaker({ name: "openai", failureThreshold: 5, timeout: 60000 }),
  agentmail: new CircuitBreaker({ name: "agentmail", failureThreshold: 3, timeout: 45000 }),
  objectStorage: new CircuitBreaker({ name: "objectStorage", failureThreshold: 3, timeout: 30000 }),
  googleCalendar: new CircuitBreaker({ name: "googleCalendar", failureThreshold: 3, timeout: 45000 }),
};

export function getDependencyCircuitBreakerStatus(): Record<string, { state: CircuitState; failures: number }> {
  const status: Record<string, { state: CircuitState; failures: number }> = {};
  for (const [name, breaker] of Object.entries(dependencyCircuitBreakers)) {
    status[name] = { state: breaker.getState(), failures: breaker.getStats().failures };
  }
  return status;
}
