import type { Request, Response, NextFunction } from "express";
import { redisIncr, redisGet, redisSet, getRedisStats } from "../services/redisService";
import { workerManager } from "./workerManager";
import { domainIsolation } from "./domainIsolation";

interface ConcurrencySlot {
  id: string;
  startedAt: number;
  domain: string;
  description: string;
}

class ConcurrencyLimiter {
  private slots: Map<string, ConcurrencySlot[]> = new Map();
  private waiting: Map<string, Array<{ resolve: () => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>> = new Map();
  private limits: Map<string, number> = new Map([
    ["ai-chat", 5],
    ["ai-analysis", 3],
    ["ssh-deploy", 2],
    ["file-import", 3],
    ["github-api", 4],
    ["sports-sync", 2],
    ["email-send", 3],
  ]);

  async acquire(domain: string, description: string, timeoutMs: number = 30000): Promise<string> {
    const limit = this.limits.get(domain) || 5;
    const active = this.slots.get(domain) || [];

    if (active.length < limit) {
      const id = `${domain}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const slot: ConcurrencySlot = { id, startedAt: Date.now(), domain, description };
      this.slots.set(domain, [...active, slot]);
      return id;
    }

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        const queue = this.waiting.get(domain) || [];
        this.waiting.set(domain, queue.filter(w => w.timer !== timer));
        reject(new Error(`Concurrency timeout for ${domain} after ${timeoutMs}ms`));
      }, timeoutMs);

      const queue = this.waiting.get(domain) || [];
      queue.push({
        resolve: () => {
          clearTimeout(timer);
          const id = `${domain}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const slot: ConcurrencySlot = { id, startedAt: Date.now(), domain, description };
          const current = this.slots.get(domain) || [];
          this.slots.set(domain, [...current, slot]);
          resolve(id);
        },
        reject,
        timer,
      });
      this.waiting.set(domain, queue);
    });
  }

  release(slotId: string): void {
    for (const [domain, slots] of this.slots) {
      const idx = slots.findIndex(s => s.id === slotId);
      if (idx !== -1) {
        slots.splice(idx, 1);
        this.slots.set(domain, slots);

        const queue = this.waiting.get(domain) || [];
        if (queue.length > 0) {
          const next = queue.shift()!;
          this.waiting.set(domain, queue);
          next.resolve();
        }
        return;
      }
    }
  }

  getStats(): Record<string, { active: number; waiting: number; limit: number }> {
    const stats: Record<string, { active: number; waiting: number; limit: number }> = {};
    for (const [domain, limit] of this.limits) {
      stats[domain] = {
        active: (this.slots.get(domain) || []).length,
        waiting: (this.waiting.get(domain) || []).length,
        limit,
      };
    }
    return stats;
  }

  getActiveSlots(): ConcurrencySlot[] {
    const all: ConcurrencySlot[] = [];
    for (const slots of this.slots.values()) {
      all.push(...slots);
    }
    return all;
  }
}

export const concurrencyLimiter = new ConcurrencyLimiter();

interface CircuitState {
  failures: number;
  lastFailure: number;
  state: "closed" | "open" | "half-open";
  openedAt: number;
  successesSinceHalfOpen: number;
}

class CircuitBreakerRegistry {
  private circuits: Map<string, CircuitState> = new Map();
  private readonly failureThreshold = 5;
  private readonly resetTimeoutMs = 60_000;
  private readonly halfOpenSuccesses = 3;

  private getCircuit(name: string): CircuitState {
    if (!this.circuits.has(name)) {
      this.circuits.set(name, {
        failures: 0,
        lastFailure: 0,
        state: "closed",
        openedAt: 0,
        successesSinceHalfOpen: 0,
      });
    }
    return this.circuits.get(name)!;
  }

  canExecute(name: string): boolean {
    const circuit = this.getCircuit(name);

    if (circuit.state === "closed") return true;

    if (circuit.state === "open") {
      if (Date.now() - circuit.openedAt > this.resetTimeoutMs) {
        circuit.state = "half-open";
        circuit.successesSinceHalfOpen = 0;
        return true;
      }
      return false;
    }

    return true;
  }

  recordSuccess(name: string): void {
    const circuit = this.getCircuit(name);
    if (circuit.state === "half-open") {
      circuit.successesSinceHalfOpen++;
      if (circuit.successesSinceHalfOpen >= this.halfOpenSuccesses) {
        circuit.state = "closed";
        circuit.failures = 0;
      }
    } else if (circuit.state === "closed") {
      circuit.failures = Math.max(0, circuit.failures - 1);
    }
  }

  recordFailure(name: string): void {
    const circuit = this.getCircuit(name);
    circuit.failures++;
    circuit.lastFailure = Date.now();

    if (circuit.state === "half-open") {
      circuit.state = "open";
      circuit.openedAt = Date.now();
    } else if (circuit.failures >= this.failureThreshold) {
      circuit.state = "open";
      circuit.openedAt = Date.now();
    }
  }

  getStats(): Record<string, { state: string; failures: number }> {
    const stats: Record<string, { state: string; failures: number }> = {};
    for (const [name, circuit] of this.circuits) {
      stats[name] = { state: circuit.state, failures: circuit.failures };
    }
    return stats;
  }

  async withCircuitBreaker<T>(name: string, fn: () => Promise<T>, fallback?: () => T): Promise<T> {
    if (!this.canExecute(name)) {
      if (fallback) return fallback();
      throw new Error(`Circuit breaker open for ${name}. Service temporarily unavailable.`);
    }

    try {
      const result = await fn();
      this.recordSuccess(name);
      return result;
    } catch (error) {
      this.recordFailure(name);
      throw error;
    }
  }
}

export const circuitBreaker = new CircuitBreakerRegistry();

const PLAN_RATE_LIMITS: Record<string, { requestsPerMinute: number; aiCallsPerHour: number; deploysPerHour: number }> = {
  free:       { requestsPerMinute: 30,  aiCallsPerHour: 10,  deploysPerHour: 2 },
  starter:    { requestsPerMinute: 60,  aiCallsPerHour: 50,  deploysPerHour: 10 },
  pro:        { requestsPerMinute: 120, aiCallsPerHour: 200, deploysPerHour: 30 },
  enterprise: { requestsPerMinute: 300, aiCallsPerHour: 1000, deploysPerHour: 100 },
  owner:      { requestsPerMinute: 999, aiCallsPerHour: 9999, deploysPerHour: 999 },
};

export async function checkTenantRateLimit(
  tenantId: number,
  plan: string,
  category: "request" | "ai" | "deploy"
): Promise<{ allowed: boolean; remaining: number; limit: number }> {
  const limits = PLAN_RATE_LIMITS[plan] || PLAN_RATE_LIMITS.free;

  let maxReq: number;
  let windowSec: number;
  let key: string;

  switch (category) {
    case "request":
      maxReq = limits.requestsPerMinute;
      windowSec = 60;
      key = `tenant:${tenantId}:req`;
      break;
    case "ai":
      maxReq = limits.aiCallsPerHour;
      windowSec = 3600;
      key = `tenant:${tenantId}:ai`;
      break;
    case "deploy":
      maxReq = limits.deploysPerHour;
      windowSec = 3600;
      key = `tenant:${tenantId}:deploy`;
      break;
  }

  const count = await redisIncr(key, windowSec);
  return {
    allowed: count <= maxReq,
    remaining: Math.max(0, maxReq - count),
    limit: maxReq,
  };
}

interface RequestPriority {
  level: number;
  label: string;
}

const PRIORITY_MAP: Record<string, number> = {
  owner: 0,
  enterprise: 1,
  pro: 2,
  starter: 3,
  free: 4,
};

export function getRequestPriority(plan: string): RequestPriority {
  const level = PRIORITY_MAP[plan] ?? 4;
  return { level, label: plan };
}

class HealthMonitor {
  private startTime = Date.now();
  private requestCount = 0;
  private errorCount = 0;
  private avgResponseTime = 0;
  private responseTimeSamples: number[] = [];
  private readonly maxSamples = 1000;

  recordRequest(durationMs: number, isError: boolean): void {
    this.requestCount++;
    if (isError) this.errorCount++;

    this.responseTimeSamples.push(durationMs);
    if (this.responseTimeSamples.length > this.maxSamples) {
      this.responseTimeSamples.shift();
    }
    this.avgResponseTime =
      this.responseTimeSamples.reduce((a, b) => a + b, 0) / this.responseTimeSamples.length;
  }

  getHealth(): {
    status: "healthy" | "degraded" | "critical";
    uptime: number;
    requests: { total: number; errors: number; errorRate: number };
    performance: { avgResponseMs: number; p95ResponseMs: number };
    memory: { heapUsedMB: number; heapTotalMB: number; rssMB: number; heapPercent: number };
    concurrency: Record<string, { active: number; waiting: number; limit: number }>;
    circuits: Record<string, { state: string; failures: number }>;
    redis: ReturnType<typeof getRedisStats>;
  } {
    const mem = process.memoryUsage();
    const heapPercent = (mem.heapUsed / mem.heapTotal) * 100;

    const sorted = [...this.responseTimeSamples].sort((a, b) => a - b);
    const p95 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] : 0;

    const errorRate = this.requestCount > 0 ? this.errorCount / this.requestCount : 0;

    let status: "healthy" | "degraded" | "critical" = "healthy";
    if (heapPercent > 90 || errorRate > 0.1) status = "critical";
    else if (heapPercent > 75 || errorRate > 0.05 || this.avgResponseTime > 5000) status = "degraded";

    return {
      status,
      uptime: Date.now() - this.startTime,
      requests: { total: this.requestCount, errors: this.errorCount, errorRate: Math.round(errorRate * 10000) / 100 },
      performance: { avgResponseMs: Math.round(this.avgResponseTime), p95ResponseMs: Math.round(p95) },
      memory: {
        heapUsedMB: Math.round(mem.heapUsed / 1048576),
        heapTotalMB: Math.round(mem.heapTotal / 1048576),
        rssMB: Math.round(mem.rss / 1048576),
        heapPercent: Math.round(heapPercent),
      },
      concurrency: concurrencyLimiter.getStats(),
      circuits: circuitBreaker.getStats(),
      redis: getRedisStats(),
    };
  }
}

export const healthMonitor = new HealthMonitor();

export function healthTrackingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const originalEnd = res.end.bind(res);

  res.end = function (...args: any[]) {
    const duration = Date.now() - start;
    healthMonitor.recordRequest(duration, res.statusCode >= 500);
    return originalEnd(...args);
  } as typeof res.end;

  next();
}

// Endpoints that hold a connection open for a long time (SSE, WebSocket-style polls).
// These must NOT count against the concurrent-requests budget, otherwise a single
// open dashboard tab can monopolise slots and shed legitimate traffic forever.
const BACKPRESSURE_BYPASS_PREFIXES = [
  "/api/v2/sensory/stream",
  "/api/v2/sensory/sse",
  "/api/v2/health",
  "/api/health",
  "/api/healthz",
];

function isBackpressureBypass(path: string): boolean {
  for (const p of BACKPRESSURE_BYPASS_PREFIXES) if (path.startsWith(p)) return true;
  return false;
}

class BackpressureGuard {
  private activeRequests = 0;
  private readonly maxConcurrentRequests: number;
  private readonly shedThreshold: number;

  constructor(maxConcurrent: number = 1000, shedPercent: number = 0.9) {
    this.maxConcurrentRequests = maxConcurrent;
    this.shedThreshold = Math.floor(maxConcurrent * shedPercent);
  }

  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const path = req.path || req.url || "";

      // Long-lived connections + health probes: never counted, never shed.
      if (isBackpressureBypass(path)) {
        return next();
      }

      if (this.activeRequests >= this.maxConcurrentRequests) {
        res.status(503).json({
          error: "Server at capacity, please retry shortly",
          retryAfter: 5,
        });
        return;
      }

      if (this.activeRequests >= this.shedThreshold) {
        // Only shed truly anonymous "free" traffic — authenticated users
        // (session cookie present OR tenantPlan explicitly set) are always allowed.
        const tenantPlan = (req as Request & { tenantPlan?: string }).tenantPlan;
        const hasSession = !!(req as Request & { session?: { userId?: number } }).session?.userId
          || !!req.headers.authorization
          || !!req.headers.cookie;
        const priority = tenantPlan || (hasSession ? "owner" : "free");
        if (!hasSession && PRIORITY_MAP[priority] >= 4) {
          res.status(503).json({
            error: "Server under heavy load, premium users prioritized",
            retryAfter: 10,
          });
          return;
        }
      }

      this.activeRequests++;
      const onFinish = () => {
        this.activeRequests--;
        res.removeListener("finish", onFinish);
        res.removeListener("close", onFinish);
      };
      res.on("finish", onFinish);
      res.on("close", onFinish);

      next();
    };
  }

  getActive(): number {
    return this.activeRequests;
  }
}

export const backpressureGuard = new BackpressureGuard(1000);

export function concurrencyMiddleware(domain: string, timeoutMs: number = 30000) {
  return async (req: Request, res: Response, next: NextFunction) => {
    let slotId: string | null = null;
    try {
      slotId = await concurrencyLimiter.acquire(domain, `${req.method} ${req.path}`, timeoutMs);
      (req as Request & { _concurrencySlotId?: string })._concurrencySlotId = slotId;

      const onFinish = () => {
        if (slotId) concurrencyLimiter.release(slotId);
        res.removeListener("finish", onFinish);
        res.removeListener("close", onFinish);
      };
      res.on("finish", onFinish);
      res.on("close", onFinish);

      next();
    } catch (error: any) {
      res.status(429).json({
        error: "Too many concurrent operations",
        domain,
        message: error.message,
        retryAfter: 5,
      });
    }
  };
}

class MemoryPressureMonitor {
  private checkInterval: NodeJS.Timeout | null = null;
  private onPressure: (() => void)[] = [];
  private pressureState: "normal" | "warning" | "critical" = "normal";

  start(intervalMs: number = 30_000): void {
    if (this.checkInterval) return;
    this.checkInterval = setInterval(() => this.check(), intervalMs);
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  onHighPressure(cb: () => void): void {
    this.onPressure.push(cb);
  }

  getState(): string {
    return this.pressureState;
  }

  private check(): void {
    const mem = process.memoryUsage();
    const heapPercent = (mem.heapUsed / mem.heapTotal) * 100;

    if (heapPercent > 90) {
      if (this.pressureState !== "critical") {
        console.warn(`[MemoryPressure] CRITICAL: heap at ${heapPercent.toFixed(1)}%`);
        this.pressureState = "critical";
        this.onPressure.forEach(cb => cb());
      }
    } else if (heapPercent > 75) {
      if (this.pressureState !== "warning") {
        console.warn(`[MemoryPressure] WARNING: heap at ${heapPercent.toFixed(1)}%`);
        this.pressureState = "warning";
      }
    } else {
      this.pressureState = "normal";
    }
  }
}

export const memoryPressure = new MemoryPressureMonitor();

export function setupScalabilityLayer(app: import("express").Express): void {
  app.use(healthTrackingMiddleware);
  app.use(backpressureGuard.middleware());

  app.use("/api/v2/conversations", concurrencyMiddleware("ai-chat", 60000));
  app.use("/api/conversations", concurrencyMiddleware("ai-chat", 60000));

  app.use("/api/devmax/deploy", concurrencyMiddleware("ssh-deploy", 120000));
  app.use("/api/devmax/projects/*/deploy", concurrencyMiddleware("ssh-deploy", 120000));

  app.use("/api/v2/sugu-management/bank/import-pdf", concurrencyMiddleware("file-import", 60000));
  app.use("/api/v2/sugu-management/bank/import-csv", concurrencyMiddleware("file-import", 60000));
  app.use("/api/v2/sugum-management/bank/import-pdf", concurrencyMiddleware("file-import", 60000));
  app.use("/api/v2/sugum-management/bank/import-csv", concurrencyMiddleware("file-import", 60000));

  app.use((req: Request, res: Response, next: NextFunction) => {
    const domain = domainIsolation.resolveDomain(req.path);
    if (domain) {
      (req as any)._domain = domain;
      const start = Date.now();
      const origEnd = res.end.bind(res);
      res.end = function (...args: any[]) {
        domainIsolation.recordRequest(domain, Date.now() - start, res.statusCode >= 500);
        return origEnd(...args);
      } as typeof res.end;
    }
    next();
  });

  app.get("/api/health/scalability", (_req, res) => {
    const health = healthMonitor.getHealth();
    const statusCode = health.status === "critical" ? 503 : health.status === "degraded" ? 200 : 200;
    res.status(statusCode).json({
      ...health,
      workers: workerManager.getWorkerStats(),
      domains: domainIsolation.getDomainHealth(),
      roadmap: domainIsolation.getRoadmap(),
    });
  });

  memoryPressure.start(30_000);
  memoryPressure.onHighPressure(() => {
    if (global.gc) {
      console.log("[MemoryPressure] Forcing garbage collection");
      global.gc();
    }
  });

  console.log("[Scalability] Layer initialized: backpressure, concurrency limits, circuit breakers, health monitoring, workers, domain isolation");
}

export { workerManager } from "./workerManager";
export { domainIsolation } from "./domainIsolation";

