import { db } from "../db";
import { sql } from "drizzle-orm";

const BASE_URL = process.env.APPTOORDER_BASE_URL || "https://macommande.shop";
const PUBLIC_DOMAIN = "https://macommande.shop";
const API_KEY = () => process.env.APPTOORDER_API_KEY || "";

const PUBLIC_URLS = [
  { url: `${PUBLIC_DOMAIN}/`, description: "Page d'accueil" },
  { url: `${PUBLIC_DOMAIN}/sugumaillane`, description: "Landing SUGU" },
  { url: `${PUBLIC_DOMAIN}/lagaudina`, description: "Landing La Gaudina" },
  { url: `${PUBLIC_DOMAIN}/sugumaillane/client`, description: "Portail client SUGU" },
  { url: `${PUBLIC_DOMAIN}/lagaudina/client`, description: "Portail client La Gaudina" },
  { url: `${PUBLIC_DOMAIN}/pro`, description: "Login pro" },
  { url: `${PUBLIC_DOMAIN}/login`, description: "Login général" },
];

const API_ENDPOINTS = [
  "/api/restaurants",
];

interface HealthCheckResult {
  overallStatus: string;
  totalChecks: number;
  checksOk: number;
  checksWarning: number;
  checksError: number;
  uptimeSeconds: number;
  totalResponseMs: number;
  dbLatencyMs: number;
  sslDaysRemaining: number | null;
  sslValid: boolean | null;
  dnsResolves: boolean | null;
  memoryHeapMb: number;
  memoryRssMb: number;
  wsConnected: number;
  stripeConfigured: boolean;
  smtpConfigured: boolean;
  restaurantsCount: number;
  totalOrders: number;
  todayOrders: number;
  totalRevenue: number;
  hoursSinceOrder: number | null;
  checkDetails: any;
}

interface UrlCheckResult {
  url: string;
  httpStatus: number | null;
  responseTimeMs: number;
  isAccessible: boolean;
  errorMessage: string | null;
}

class AppToOrderMonitorService {
  private initialized = false;
  private lastHealthResult: HealthCheckResult | null = null;
  private lastSchemaSnapshot: any = null;

  async ensureTables() {
    if (this.initialized) return;
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS apptoorder_health_checks (
          id SERIAL PRIMARY KEY,
          timestamp TIMESTAMP DEFAULT NOW(),
          overall_status TEXT NOT NULL,
          total_checks INTEGER DEFAULT 0,
          checks_ok INTEGER DEFAULT 0,
          checks_warning INTEGER DEFAULT 0,
          checks_error INTEGER DEFAULT 0,
          uptime_seconds INTEGER DEFAULT 0,
          total_response_ms INTEGER DEFAULT 0,
          db_latency_ms INTEGER DEFAULT 0,
          ssl_days_remaining INTEGER,
          ssl_valid BOOLEAN,
          dns_resolves BOOLEAN,
          memory_heap_mb INTEGER DEFAULT 0,
          memory_rss_mb INTEGER DEFAULT 0,
          ws_connected INTEGER DEFAULT 0,
          stripe_configured BOOLEAN DEFAULT FALSE,
          smtp_configured BOOLEAN DEFAULT FALSE,
          restaurants_count INTEGER DEFAULT 0,
          total_orders INTEGER DEFAULT 0,
          today_orders INTEGER DEFAULT 0,
          total_revenue NUMERIC(12,2) DEFAULT 0,
          hours_since_order NUMERIC(8,2),
          check_details JSONB
        )
      `);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS apptoorder_url_checks (
          id SERIAL PRIMARY KEY,
          timestamp TIMESTAMP DEFAULT NOW(),
          url TEXT NOT NULL,
          http_status INTEGER,
          response_time_ms INTEGER DEFAULT 0,
          is_accessible BOOLEAN DEFAULT FALSE,
          error_message TEXT
        )
      `);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS apptoorder_schema_snapshots (
          id SERIAL PRIMARY KEY,
          timestamp TIMESTAMP DEFAULT NOW(),
          table_count INTEGER DEFAULT 0,
          schema_data JSONB,
          changes_detected JSONB
        )
      `);

      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ato_health_ts ON apptoorder_health_checks(timestamp)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ato_url_ts ON apptoorder_url_checks(timestamp)`);

      this.initialized = true;
      console.log("[AppToOrderMonitor] Tables ensured");
    } catch (e: any) {
      console.error("[AppToOrderMonitor] Table creation error:", e.message);
    }
  }

  private async apiCall(endpoint: string, method = "GET", body?: any): Promise<any> {
    const key = API_KEY();
    if (!key) throw new Error("APPTOORDER_API_KEY not configured");

    const url = `${BASE_URL}${endpoint}`;
    const headers: Record<string, string> = {
      "x-api-key": key,
      "Content-Type": "application/json",
    };

    const opts: RequestInit = { method, headers, signal: AbortSignal.timeout(20000) };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text.substring(0, 200)}`);
    }
    return res.json();
  }

  async runHealthCheck(): Promise<HealthCheckResult> {
    await this.ensureTables();
    console.log("[AppToOrderMonitor] Running health check...");

    try {
      const data = await this.apiCall("/api/health");
      const checks = data.checks || [];

      const findCheck = (name: string) => checks.find((c: any) => c.name === name);

      const dbCheck = findCheck("database:connection");
      const sslCheck = findCheck("ssl:macommande.shop");
      const dnsCheck = findCheck("dns:macommande.shop");
      const systemCheck = findCheck("system:resources");
      const wsCheck = findCheck("websocket");
      const stripeCheck = findCheck("payment:stripe");
      const smtpCheck = findCheck("email:smtp");
      const ordersCheck = findCheck("orders:global");
      const activityCheck = findCheck("activity:last_order");
      const restCheck = findCheck("restaurants:list");

      const result: HealthCheckResult = {
        overallStatus: data.status || "unknown",
        totalChecks: data.summary?.total || checks.length,
        checksOk: data.summary?.ok || 0,
        checksWarning: data.summary?.warnings || 0,
        checksError: data.summary?.errors || 0,
        uptimeSeconds: data.uptime || 0,
        totalResponseMs: data.totalResponseTime || 0,
        dbLatencyMs: dbCheck?.responseTime || 0,
        sslDaysRemaining: sslCheck?.details?.daysRemaining ?? null,
        sslValid: sslCheck?.details?.valid ?? null,
        dnsResolves: dnsCheck?.status === "ok" ? true : dnsCheck ? false : null,
        memoryHeapMb: systemCheck?.details?.memory?.heapUsedMB || 0,
        memoryRssMb: systemCheck?.details?.memory?.rssMB || 0,
        wsConnected: wsCheck?.details?.connectedClients || 0,
        stripeConfigured: stripeCheck?.details?.configured || false,
        smtpConfigured: smtpCheck?.details?.configured || false,
        restaurantsCount: restCheck?.details?.count || 0,
        totalOrders: ordersCheck?.details?.totalOrders || 0,
        todayOrders: ordersCheck?.details?.todayOrders || 0,
        totalRevenue: ordersCheck?.details?.totalRevenue || 0,
        hoursSinceOrder: activityCheck?.details?.hoursSinceLastOrder ?? null,
        checkDetails: data,
      };

      await db.execute(sql`
        INSERT INTO apptoorder_health_checks
          (overall_status, total_checks, checks_ok, checks_warning, checks_error,
           uptime_seconds, total_response_ms, db_latency_ms, ssl_days_remaining, ssl_valid,
           dns_resolves, memory_heap_mb, memory_rss_mb, ws_connected, stripe_configured,
           smtp_configured, restaurants_count, total_orders, today_orders, total_revenue,
           hours_since_order, check_details)
        VALUES
          (${result.overallStatus}, ${result.totalChecks}, ${result.checksOk}, ${result.checksWarning}, ${result.checksError},
           ${result.uptimeSeconds}, ${result.totalResponseMs}, ${result.dbLatencyMs}, ${result.sslDaysRemaining}, ${result.sslValid},
           ${result.dnsResolves}, ${result.memoryHeapMb}, ${result.memoryRssMb}, ${result.wsConnected}, ${result.stripeConfigured},
           ${result.smtpConfigured}, ${result.restaurantsCount}, ${result.totalOrders}, ${result.todayOrders}, ${result.totalRevenue},
           ${result.hoursSinceOrder}, ${JSON.stringify(result.checkDetails)})
      `);

      const previousStatus = this.lastHealthResult?.overallStatus;
      this.lastHealthResult = result;

      console.log(`[AppToOrderMonitor] Health: ${result.overallStatus} (${result.checksOk}/${result.totalChecks} OK, ${result.checksWarning} warn, ${result.checksError} err)`);

      await this.evaluateAlerts(result, previousStatus || null);

      return result;
    } catch (e: any) {
      console.error("[AppToOrderMonitor] Health check failed:", e.message);
      await db.execute(sql`
        INSERT INTO apptoorder_health_checks (overall_status, check_details)
        VALUES ('unreachable', ${JSON.stringify({ error: e.message })})
      `);
      await this.sendAlert("critical", "AppToOrder Injoignable", `L'API AppToOrder ne répond pas: ${e.message}`);
      throw e;
    }
  }

  async runUrlChecks(): Promise<UrlCheckResult[]> {
    await this.ensureTables();
    console.log("[AppToOrderMonitor] Running URL checks...");

    let dynamicApiUrls: { url: string; description: string }[] = [];
    try {
      const restaurants = await this.apiCall("/api/restaurants");
      if (Array.isArray(restaurants)) {
        for (const r of restaurants) {
          if (r.slug) {
            dynamicApiUrls.push({ url: `${BASE_URL}/api/restaurants/slug/${r.slug}`, description: `API: ${r.name || r.slug}` });
          }
        }
      }
    } catch (e: any) {
      console.warn("[AppToOrderMonitor] Could not fetch restaurant slugs:", e.message);
    }

    const allUrls = [
      ...PUBLIC_URLS,
      ...API_ENDPOINTS.map(ep => ({ url: `${BASE_URL}${ep}`, description: `API: ${ep}` })),
      ...dynamicApiUrls,
    ];

    const results: UrlCheckResult[] = [];

    for (const { url, description } of allUrls) {
      const start = Date.now();
      let result: UrlCheckResult;

      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(15000),
          headers: url.includes("/api/") ? { "x-api-key": API_KEY() } : {},
        });
        const responseTimeMs = Date.now() - start;

        result = {
          url,
          httpStatus: res.status,
          responseTimeMs,
          isAccessible: res.status >= 200 && res.status < 400,
          errorMessage: res.status >= 400 ? `HTTP ${res.status}` : null,
        };
      } catch (e: any) {
        result = {
          url,
          httpStatus: null,
          responseTimeMs: Date.now() - start,
          isAccessible: false,
          errorMessage: e.message,
        };
      }

      results.push(result);

      await db.execute(sql`
        INSERT INTO apptoorder_url_checks (url, http_status, response_time_ms, is_accessible, error_message)
        VALUES (${result.url}, ${result.httpStatus}, ${result.responseTimeMs}, ${result.isAccessible}, ${result.errorMessage})
      `);

      if (!result.isAccessible) {
        await this.sendAlert("critical", `URL Inaccessible: ${description}`, `${url} → ${result.errorMessage || `HTTP ${result.httpStatus}`}`);
      } else if (result.responseTimeMs > 8000) {
        await this.sendAlert("warning", `URL Lente: ${description}`, `${url} → ${result.responseTimeMs}ms`);
      }
    }

    const accessible = results.filter(r => r.isAccessible).length;
    console.log(`[AppToOrderMonitor] URLs: ${accessible}/${results.length} accessible`);

    return results;
  }

  async runSchemaCheck(): Promise<{ changed: boolean; changes: string[] }> {
    await this.ensureTables();
    console.log("[AppToOrderMonitor] Running schema check...");

    try {
      const data = await this.apiCall("/api/health/schema");
      const currentSchema = data.schema || data;
      const tableCount = data.tableCount || Object.keys(currentSchema).length;
      const changes: string[] = [];

      if (this.lastSchemaSnapshot) {
        const oldTables = Object.keys(this.lastSchemaSnapshot);
        const newTables = Object.keys(currentSchema);

        const added = newTables.filter(t => !oldTables.includes(t));
        const removed = oldTables.filter(t => !newTables.includes(t));

        for (const t of added) changes.push(`+ Table ajoutée: ${t}`);
        for (const t of removed) changes.push(`- Table supprimée: ${t}`);

        for (const table of newTables) {
          if (!this.lastSchemaSnapshot[table]) continue;
          const oldCols = (this.lastSchemaSnapshot[table].columns || []).map((c: any) => c.name);
          const newCols = (currentSchema[table].columns || []).map((c: any) => c.name);

          for (const col of newCols) {
            if (!oldCols.includes(col)) changes.push(`+ ${table}.${col} (nouvelle colonne)`);
          }
          for (const col of oldCols) {
            if (!newCols.includes(col)) changes.push(`- ${table}.${col} (colonne supprimée)`);
          }
        }
      }

      this.lastSchemaSnapshot = currentSchema;

      await db.execute(sql`
        INSERT INTO apptoorder_schema_snapshots (table_count, schema_data, changes_detected)
        VALUES (${tableCount}, ${JSON.stringify(currentSchema)}, ${JSON.stringify(changes)})
      `);

      if (changes.length > 0) {
        console.log(`[AppToOrderMonitor] Schema changes detected: ${changes.length}`);
        await this.sendAlert("info", "Changement de schéma AppToOrder", changes.join("\n"));
      } else {
        console.log(`[AppToOrderMonitor] Schema: ${tableCount} tables, no changes`);
      }

      return { changed: changes.length > 0, changes };
    } catch (e: any) {
      console.error("[AppToOrderMonitor] Schema check failed:", e.message);
      return { changed: false, changes: [] };
    }
  }

  private async evaluateAlerts(result: HealthCheckResult, previousStatus: string | null) {
    if (result.overallStatus === "critical") {
      await this.sendAlert("critical", "AppToOrder CRITIQUE", `Statut critique — ${result.checksError} erreur(s) détectée(s)`);
    }

    if (previousStatus && previousStatus !== "critical" && result.overallStatus === "critical") {
      await this.sendAlert("critical", "AppToOrder: Dégradation Critique", `Passage de ${previousStatus} → critical`);
    }

    if (result.sslValid === false) {
      await this.sendAlert("critical", "SSL Invalide", "Le certificat SSL de macommande.shop n'est pas valide");
    } else if (result.sslDaysRemaining !== null && result.sslDaysRemaining < 7) {
      await this.sendAlert("critical", "SSL Expire Bientôt", `Certificat SSL expire dans ${result.sslDaysRemaining} jours`);
    } else if (result.sslDaysRemaining !== null && result.sslDaysRemaining < 30) {
      await this.sendAlert("warning", "SSL Renouvellement", `Certificat SSL expire dans ${result.sslDaysRemaining} jours`);
    }

    if (result.dnsResolves === false) {
      await this.sendAlert("critical", "DNS macommande.shop KO", "La résolution DNS de macommande.shop a échoué");
    }

    if (result.hoursSinceOrder !== null && result.hoursSinceOrder > 72) {
      await this.sendAlert("warning", "Inactivité Commandes", `Aucune commande depuis ${Math.round(result.hoursSinceOrder)}h`);
    }

    if (result.memoryHeapMb > 0) {
      const heapPct = (result.memoryHeapMb / (result.memoryRssMb || 512)) * 100;
      if (heapPct > 90) {
        await this.sendAlert("warning", "Mémoire Élevée", `Heap: ${result.memoryHeapMb}MB (${Math.round(heapPct)}%)`);
      }
    }

    if (result.totalResponseMs > 10000) {
      await this.sendAlert("warning", "API Lente", `Health check total: ${result.totalResponseMs}ms`);
    }

    const checks = result.checkDetails?.checks || [];
    for (const check of checks) {
      if (check.responseTime > 500 && check.status !== "error") {
        console.log(`[AppToOrderMonitor] Slow check: ${check.name} (${check.responseTime}ms)`);
      }
    }
  }

  private alertCooldowns = new Map<string, number>();

  private async sendAlert(level: "critical" | "warning" | "info", title: string, message: string) {
    const cooldownKey = `${level}:${title}`;
    const now = Date.now();
    const lastSent = this.alertCooldowns.get(cooldownKey) || 0;

    const cooldownMs = level === "critical" ? 5 * 60 * 1000 : level === "warning" ? 30 * 60 * 1000 : 60 * 60 * 1000;
    if (now - lastSent < cooldownMs) return;

    this.alertCooldowns.set(cooldownKey, now);

    const emoji = level === "critical" ? "🔴" : level === "warning" ? "🟡" : "ℹ️";
    const logLine = `[AppToOrderMonitor] ${emoji} ${level.toUpperCase()}: ${title} — ${message}`;
    if (level === "critical") console.error(logLine);
    else if (level === "warning") console.warn(logLine);
    else console.log(logLine);

    try {
      const { discordService } = await import("./discordService");
      const typeMap = { critical: "error" as const, warning: "warning" as const, info: "info" as const };
      await discordService.sendNotification({
        title: `${emoji} AppToOrder: ${title}`,
        message: message.substring(0, 2000),
        type: typeMap[level],
        fields: [
          { name: "Niveau", value: level.toUpperCase(), inline: true },
          { name: "Heure", value: new Date().toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris" }), inline: true },
        ],
      });
    } catch (e: any) {
      console.warn("[AppToOrderMonitor] Discord alert failed:", e.message);
    }
  }

  async getLatestStatus(): Promise<any> {
    await this.ensureTables();
    const result = await db.execute(sql`
      SELECT * FROM apptoorder_health_checks ORDER BY timestamp DESC LIMIT 1
    `);
    return (result as any).rows?.[0] || null;
  }

  async getHistory(hours = 24): Promise<any[]> {
    await this.ensureTables();
    const result = await db.execute(sql`
      SELECT id, timestamp, overall_status, total_checks, checks_ok, checks_warning, checks_error,
             uptime_seconds, total_response_ms, db_latency_ms, ssl_days_remaining, memory_heap_mb,
             memory_rss_mb, restaurants_count, total_orders, today_orders, total_revenue, hours_since_order
      FROM apptoorder_health_checks
      WHERE timestamp > NOW() - INTERVAL '1 hour' * ${hours}
      ORDER BY timestamp DESC
    `);
    return (result as any).rows || [];
  }

  async getUrlCheckHistory(hours = 24): Promise<any[]> {
    await this.ensureTables();
    const result = await db.execute(sql`
      SELECT * FROM apptoorder_url_checks
      WHERE timestamp > NOW() - INTERVAL '1 hour' * ${hours}
      ORDER BY timestamp DESC
    `);
    return (result as any).rows || [];
  }

  async cleanup(retentionDays = 30) {
    try {
      await db.execute(sql`DELETE FROM apptoorder_health_checks WHERE timestamp < NOW() - INTERVAL '1 day' * ${retentionDays}`);
      await db.execute(sql`DELETE FROM apptoorder_url_checks WHERE timestamp < NOW() - INTERVAL '1 day' * ${retentionDays}`);
      await db.execute(sql`DELETE FROM apptoorder_schema_snapshots WHERE timestamp < NOW() - INTERVAL '1 day' * ${retentionDays * 2}`);
      console.log(`[AppToOrderMonitor] Cleanup: removed records older than ${retentionDays} days`);
    } catch (e: any) {
      console.error("[AppToOrderMonitor] Cleanup error:", e.message);
    }
  }

  async runFullCycle(): Promise<{ health: HealthCheckResult | null; urls: UrlCheckResult[]; schema: { changed: boolean; changes: string[] } | null }> {
    let health: HealthCheckResult | null = null;
    let urls: UrlCheckResult[] = [];
    let schema: { changed: boolean; changes: string[] } | null = null;

    try {
      health = await this.runHealthCheck();
    } catch (e: any) {
      console.error("[AppToOrderMonitor] Health cycle failed:", e.message);
    }

    try {
      urls = await this.runUrlChecks();
    } catch (e: any) {
      console.error("[AppToOrderMonitor] URL cycle failed:", e.message);
    }

    const hour = new Date().getHours();
    if (hour === 3 || !this.lastSchemaSnapshot) {
      try {
        schema = await this.runSchemaCheck();
      } catch (e: any) {
        console.error("[AppToOrderMonitor] Schema cycle failed:", e.message);
      }
    }

    return { health, urls, schema };
  }
}

export const appToOrderMonitor = new AppToOrderMonitorService();
