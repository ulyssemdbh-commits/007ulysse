import { describe, it, expect, beforeEach } from "vitest";

type CircuitState = "closed" | "open" | "half-open";

class TestCircuitBreaker {
  private config: { failureThreshold: number; successThreshold: number; timeout: number; name: string };
  private stats: { failures: number; successes: number; lastFailure: number | null; state: CircuitState };

  constructor(config: { failureThreshold?: number; successThreshold?: number; timeout?: number; name?: string } = {}) {
    this.config = {
      failureThreshold: config.failureThreshold ?? 3,
      successThreshold: config.successThreshold ?? 2,
      timeout: config.timeout ?? 1000,
      name: config.name ?? "test",
    };
    this.stats = { failures: 0, successes: 0, lastFailure: null, state: "closed" };
  }

  async execute<T>(operation: () => Promise<T>, fallback?: () => T): Promise<T> {
    if (this.stats.state === "open") {
      if (this.stats.lastFailure && Date.now() - this.stats.lastFailure >= this.config.timeout) {
        this.stats.state = "half-open";
        this.stats.successes = 0;
      } else {
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
        return fallback();
      }
      throw error;
    }
  }

  isOpen(): boolean {
    return this.stats.state === "open";
  }

  private onSuccess(): void {
    this.stats.failures = 0;
    if (this.stats.state === "half-open") {
      this.stats.successes++;
      if (this.stats.successes >= this.config.successThreshold) {
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
      this.stats.state = "open";
    } else if (this.stats.failures >= this.config.failureThreshold) {
      this.stats.state = "open";
    }
  }

  getState(): CircuitState { return this.stats.state; }
  getStats() { return { ...this.stats }; }
  reset(): void { this.stats = { failures: 0, successes: 0, lastFailure: null, state: "closed" }; }
}

describe("CircuitBreaker", () => {
  let breaker: TestCircuitBreaker;

  beforeEach(() => {
    breaker = new TestCircuitBreaker({ failureThreshold: 3, successThreshold: 2, timeout: 100 });
  });

  it("starts in closed state", () => {
    expect(breaker.getState()).toBe("closed");
  });

  it("stays closed on successful operations", async () => {
    await breaker.execute(async () => "success");
    await breaker.execute(async () => "success");
    expect(breaker.getState()).toBe("closed");
    expect(breaker.getStats().failures).toBe(0);
  });

  it("opens circuit after threshold failures", async () => {
    const failingOp = async () => { throw new Error("fail"); };
    
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(failingOp);
      } catch {}
    }
    
    expect(breaker.getState()).toBe("open");
  });

  it("uses fallback when circuit is open", async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => { throw new Error("fail"); });
      } catch {}
    }
    
    expect(breaker.getState()).toBe("open");
    
    const result = await breaker.execute(
      async () => "primary",
      () => "fallback"
    );
    
    expect(result).toBe("fallback");
  });

  it("throws when circuit is open without fallback", async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => { throw new Error("fail"); });
      } catch {}
    }
    
    await expect(breaker.execute(async () => "test")).rejects.toThrow("Circuit breaker");
  });

  it("transitions to half-open after timeout", async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => { throw new Error("fail"); });
      } catch {}
    }
    
    expect(breaker.getState()).toBe("open");
    
    await new Promise(resolve => setTimeout(resolve, 150));
    
    await breaker.execute(async () => "success");
    expect(breaker.getState()).toBe("half-open");
  });

  it("closes circuit after success threshold in half-open", async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => { throw new Error("fail"); });
      } catch {}
    }
    
    await new Promise(resolve => setTimeout(resolve, 150));
    
    await breaker.execute(async () => "success");
    await breaker.execute(async () => "success");
    
    expect(breaker.getState()).toBe("closed");
  });

  it("reopens circuit on failure in half-open", async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => { throw new Error("fail"); });
      } catch {}
    }
    
    await new Promise(resolve => setTimeout(resolve, 150));
    
    try {
      await breaker.execute(async () => { throw new Error("fail again"); });
    } catch {}
    
    expect(breaker.getState()).toBe("open");
  });

  it("resets correctly", async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => { throw new Error("fail"); });
      } catch {}
    }
    
    expect(breaker.getState()).toBe("open");
    
    breaker.reset();
    
    expect(breaker.getState()).toBe("closed");
    expect(breaker.getStats().failures).toBe(0);
  });
});
