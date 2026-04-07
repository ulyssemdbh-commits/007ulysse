import { redisGet, redisSet, redisIncr, getRedisStats } from "../services/redisService";

export type DomainName = "ulysse" | "sugu" | "devmax" | "apptoorder";

interface DomainConfig {
  name: DomainName;
  label: string;
  description: string;
  pathPrefixes: string[];
  dbPoolTarget: { min: number; max: number };
  rateLimits: { requestsPerMinute: number; burstSize: number };
  circuitBreakerThreshold: number;
  priority: number;
  color: string;
}

interface DomainMetrics {
  requests: number;
  errors: number;
  avgResponseMs: number;
  responseSamples: number[];
  lastActivity: number;
  circuitState: "closed" | "open" | "half-open";
  circuitFailures: number;
  circuitOpenedAt: number;
}

const DOMAIN_CONFIGS: DomainConfig[] = [
  {
    name: "ulysse",
    label: "Ulysse AI",
    description: "Assistant IA personnel, conversations, sports, bourse, email, calendrier",
    pathPrefixes: ["/api/conversations", "/api/v2/conversations", "/api/v2/voice", "/api/sports", "/api/stocks", "/api/calendar", "/api/email", "/api/v2/brain", "/api/v2/capabilities"],
    dbPoolTarget: { min: 3, max: 15 },
    rateLimits: { requestsPerMinute: 300, burstSize: 50 },
    circuitBreakerThreshold: 10,
    priority: 1,
    color: "#3b82f6",
  },
  {
    name: "sugu",
    label: "SUGU Restaurant",
    description: "Gestion restaurant Suguval & Sugumaillane — achats, banque, employes, paie",
    pathPrefixes: ["/api/v2/sugu-management", "/api/v2/sugum-management", "/api/suguval", "/api/sugumaillane"],
    dbPoolTarget: { min: 2, max: 10 },
    rateLimits: { requestsPerMinute: 120, burstSize: 20 },
    circuitBreakerThreshold: 8,
    priority: 2,
    color: "#10b981",
  },
  {
    name: "devmax",
    label: "DevMax SaaS",
    description: "Plateforme DevOps multi-tenant — projets, deployments, GitHub, SSH",
    pathPrefixes: ["/api/devmax", "/api/devmax/ops", "/api/devmax/admin"],
    dbPoolTarget: { min: 2, max: 10 },
    rateLimits: { requestsPerMinute: 200, burstSize: 30 },
    circuitBreakerThreshold: 8,
    priority: 1,
    color: "#f59e0b",
  },
  {
    name: "apptoorder",
    label: "AppToOrder",
    description: "Monitoring et gestion SaaS AppToOrder — COBA, performance, alertes",
    pathPrefixes: ["/api/v2/apptoorder", "/api/coba"],
    dbPoolTarget: { min: 1, max: 5 },
    rateLimits: { requestsPerMinute: 60, burstSize: 10 },
    circuitBreakerThreshold: 5,
    priority: 3,
    color: "#8b5cf6",
  },
];

class DomainIsolationLayer {
  private configs: Map<DomainName, DomainConfig> = new Map();
  private metrics: Map<DomainName, DomainMetrics> = new Map();

  constructor() {
    for (const cfg of DOMAIN_CONFIGS) {
      this.configs.set(cfg.name, cfg);
      this.metrics.set(cfg.name, {
        requests: 0,
        errors: 0,
        avgResponseMs: 0,
        responseSamples: [],
        lastActivity: 0,
        circuitState: "closed",
        circuitFailures: 0,
        circuitOpenedAt: 0,
      });
    }
  }

  resolveDomain(path: string): DomainName | null {
    for (const cfg of DOMAIN_CONFIGS) {
      for (const prefix of cfg.pathPrefixes) {
        if (path.startsWith(prefix)) return cfg.name;
      }
    }
    return null;
  }

  recordRequest(domain: DomainName, durationMs: number, isError: boolean): void {
    const m = this.metrics.get(domain);
    if (!m) return;

    m.requests++;
    if (isError) m.errors++;
    m.lastActivity = Date.now();

    m.responseSamples.push(durationMs);
    if (m.responseSamples.length > 200) m.responseSamples.shift();
    m.avgResponseMs = Math.round(m.responseSamples.reduce((a, b) => a + b, 0) / m.responseSamples.length);

    if (isError) {
      m.circuitFailures++;
      const cfg = this.configs.get(domain)!;
      if (m.circuitFailures >= cfg.circuitBreakerThreshold) {
        if (m.circuitState === "closed") {
          m.circuitState = "open";
          m.circuitOpenedAt = Date.now();
          console.warn(`[DomainIsolation] Circuit OPEN for ${domain} (${m.circuitFailures} failures)`);
        }
      }
    } else {
      if (m.circuitState === "half-open") {
        m.circuitState = "closed";
        m.circuitFailures = 0;
      } else if (m.circuitState === "closed") {
        m.circuitFailures = Math.max(0, m.circuitFailures - 1);
      }
    }

    if (m.circuitState === "open" && Date.now() - m.circuitOpenedAt > 60_000) {
      m.circuitState = "half-open";
    }

    redisIncr(`domain:${domain}:requests`, 3600).catch(() => {});
  }

  async checkDomainRateLimit(domain: DomainName): Promise<{ allowed: boolean; remaining: number }> {
    const cfg = this.configs.get(domain);
    if (!cfg) return { allowed: true, remaining: 999 };

    const key = `domain:ratelimit:${domain}`;
    const count = await redisIncr(key, 60);
    return {
      allowed: count <= cfg.rateLimits.requestsPerMinute,
      remaining: Math.max(0, cfg.rateLimits.requestsPerMinute - count),
    };
  }

  isDomainAvailable(domain: DomainName): boolean {
    const m = this.metrics.get(domain);
    if (!m) return true;
    return m.circuitState !== "open";
  }

  getDomainHealth(): Array<{
    name: DomainName;
    label: string;
    description: string;
    color: string;
    priority: number;
    requests: number;
    errors: number;
    errorRate: number;
    avgResponseMs: number;
    circuitState: string;
    circuitFailures: number;
    lastActivity: number;
    rateLimit: { requestsPerMinute: number; burstSize: number };
    dbPool: { min: number; max: number };
    status: "healthy" | "degraded" | "isolated" | "offline";
  }> {
    const result: any[] = [];

    for (const [name, cfg] of this.configs) {
      const m = this.metrics.get(name)!;
      const errorRate = m.requests > 0 ? Math.round((m.errors / m.requests) * 10000) / 100 : 0;

      let status: "healthy" | "degraded" | "isolated" | "offline" = "healthy";
      if (m.circuitState === "open") status = "isolated";
      else if (errorRate > 10) status = "degraded";
      else if (m.circuitState === "half-open") status = "degraded";

      result.push({
        name,
        label: cfg.label,
        description: cfg.description,
        color: cfg.color,
        priority: cfg.priority,
        requests: m.requests,
        errors: m.errors,
        errorRate,
        avgResponseMs: m.avgResponseMs,
        circuitState: m.circuitState,
        circuitFailures: m.circuitFailures,
        lastActivity: m.lastActivity,
        rateLimit: cfg.rateLimits,
        dbPool: cfg.dbPoolTarget,
        status,
      });
    }

    return result;
  }

  getConfigs(): DomainConfig[] {
    return DOMAIN_CONFIGS;
  }

  getRoadmap(): Array<{ palier: number; title: string; status: "done" | "active" | "planned"; items: string[] }> {
    return [
      {
        palier: 1,
        title: "Foundation — Concurrency & Protection",
        status: "done",
        items: [
          "ConcurrencyLimiter par domaine (AI:5, SSH:2, Import:3, GitHub:4, Sports:2, Email:3)",
          "CircuitBreakerRegistry (5 failures / 60s reset / 3 half-open successes)",
          "BackpressureGuard (200 max concurrent, priority shedding a 90%)",
          "HealthMonitor (avg/p95 response, error rate, heap %)",
          "MemoryPressureMonitor (30s check, warn 75%, critical 90%, auto-GC)",
          "Rate limiting par plan tenant (Free/Starter/Pro/Enterprise/Owner)",
          "Job Scheduler concurrency (max 4 simultanes, priority boost, deferrals)",
        ],
      },
      {
        palier: 2,
        title: "Redis Distribue + Dashboard",
        status: "done",
        items: [
          "Redis 7 sur Hetzner (65.21.209.102:6379, 256MB, allkeys-lru)",
          "Sessions partagees via Redis (24h TTL)",
          "Rate limiting distribue (survit aux restarts)",
          "Cache distribue avec fallback memoire",
          "Dashboard Scalabilite temps reel (auto-refresh 5s)",
          "Endpoint /api/health/scalability (public) + /admin (DB pool stats)",
          "DB Pool optimise: min=5, max=40, idle=30s",
        ],
      },
      {
        palier: 3,
        title: "Multi-instances + Workers Dedies",
        status: "active",
        items: [
          "Worker Manager avec 6 types de workers dedies",
          "Sports Sync: max 2 concurrent, isolee du process principal",
          "Bank Import: max 2 concurrent, 256MB memoire max",
          "Doc Analysis: max 3 concurrent, 512MB memoire max",
          "AI Heavy: max 4 concurrent, pipeline prioritaire",
          "Email Batch: max 3 concurrent, traitement asynchrone",
          "Deployment: max 2 concurrent, isole pour SSH/GitHub",
          "File d'attente Redis par worker type",
          "Metriques par worker (processed, failed, avg duration, queue depth)",
          "Preparation architecture PM2 cluster (2-4 instances Node)",
        ],
      },
      {
        palier: 4,
        title: "Separation par Domaine",
        status: "active",
        items: [
          "4 domaines isoles: Ulysse AI, SUGU Restaurant, DevMax SaaS, AppToOrder",
          "Rate limiting independant par domaine",
          "Circuit breakers par domaine (isolation des pannes)",
          "Metriques separees (requests, errors, latence, status)",
          "Pool DB cible par domaine (Ulysse:15, SUGU:10, DevMax:10, ATO:5)",
          "Resolution automatique domaine par path API",
          "Priorite domaine configurable (Ulysse/DevMax:P1, SUGU:P2, ATO:P3)",
          "Preparation separation physique DB/apps futures",
        ],
      },
    ];
  }
}

export const domainIsolation = new DomainIsolationLayer();
