import { Router, Request, Response } from "express";
import {
  ingestEvent,
  ingestBatch,
  generateFullReport,
  getReports,
  getEventStats,
  generateWeeklyReports,
  buildSummary,
  generateAiInsights,
} from "../services/maxCobaService";

const router = Router();

const COBA_API_KEY = process.env.COBA_API_KEY || "coba-apptoorder-2025";

const ALLOWED_ORIGINS = [
  "https://macommande.shop",
  "https://www.macommande.shop",
  "https://ulysseproject.org",
  "https://www.ulysseproject.org",
  "https://ulyssepro.org",
  "https://www.ulyssepro.org",
  "http://localhost:3000",
  "http://localhost:5000",
];

function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.some(o => origin.startsWith(o))) return true;
  if (/\.replit\.dev$/.test(origin) || /\.replit\.app$/.test(origin)) return true;
  return false;
}

router.use((req: Request, res: Response, next) => {
  const origin = req.headers.origin as string;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "https://macommande.shop");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-coba-key");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function authMiddleware(req: Request, res: Response, next: Function) {
  const key = req.headers["x-coba-key"] as string;
  if (!key || key !== COBA_API_KEY) {
    return res.status(401).json({ error: "Invalid COBA API key" });
  }
  next();
}

router.use(authMiddleware);

router.get("/health", async (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "coba", timestamp: new Date().toISOString() });
});

router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const days = parseInt(_req.query.days as string) || 7;
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const tenants = await db.execute(sql`SELECT DISTINCT tenant_id FROM coba_events WHERE created_at >= ${since}`);
    const allStats: Record<string, any> = {};
    for (const row of tenants.rows) {
      const tid = row.tenant_id as string;
      const stats = await getEventStats(tid, days);
      allStats[tid] = stats;
    }
    res.json(allStats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/events", async (req: Request, res: Response) => {
  try {
    const { tenantId, eventType, severity, payload, sessionId, userId, userAgent, ipAddress } = req.body;
    if (!tenantId || !eventType) {
      return res.status(400).json({ error: "tenantId and eventType are required" });
    }
    const id = await ingestEvent({
      tenantId, eventType, severity, payload, sessionId, userId,
      userAgent: userAgent || req.headers["user-agent"],
      ipAddress: ipAddress || req.ip,
    });
    res.json({ ok: true, eventId: id });
  } catch (err: any) {
    console.error("[COBA] Ingest error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/events/batch", async (req: Request, res: Response) => {
  try {
    const { events } = req.body;
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: "events array is required" });
    }
    if (events.length > 500) {
      return res.status(400).json({ error: "Maximum 500 events per batch" });
    }
    const count = await ingestBatch(events);
    res.json({ ok: true, ingested: count });
  } catch (err: any) {
    console.error("[COBA] Batch ingest error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/stats/:tenantId", async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    const days = parseInt(req.query.days as string) || 7;
    const stats = await getEventStats(tenantId, days);
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/reports/generate", async (req: Request, res: Response) => {
  try {
    const { tenantId, periodDays } = req.body;
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const days = periodDays || 7;
    const periodEnd = new Date();
    const periodStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    console.log(`[COBA] Generating report for ${tenantId} (${days} days)`);
    const result = await generateFullReport(tenantId, periodStart, periodEnd);
    res.json(result);
  } catch (err: any) {
    console.error("[COBA] Report generation error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/reports/:tenantId", async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    const limit = parseInt(req.query.limit as string) || 10;
    const reports = await getReports(tenantId, limit);
    res.json(reports);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/reports/weekly-now", async (req: Request, res: Response) => {
  try {
    const count = await generateWeeklyReports();
    res.json({ ok: true, reportsGenerated: count });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/analyze", async (req: Request, res: Response) => {
  try {
    const { tenantId, periodDays } = req.body;
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const days = periodDays || 7;
    const periodEnd = new Date();
    const periodStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const summary = await buildSummary(tenantId, periodStart, periodEnd);
    const insights = await generateAiInsights(summary, tenantId);

    res.json({ summary, insights, period: { start: periodStart, end: periodEnd } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
