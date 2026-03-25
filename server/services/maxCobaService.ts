import { db } from "../db";
import { cobaEvents, cobaReports } from "@shared/schema";
import { eq, and, gte, lte, desc, sql, count } from "drizzle-orm";
import { getAIForContext } from "./core/openaiClient";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

const REPORTS_DIR = path.join(process.cwd(), "public", "coba-reports");

function ensureReportsDir() {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

export interface CobaEventInput {
  tenantId: string;
  eventType: string;
  severity?: string;
  payload?: any;
  sessionId?: string;
  userId?: string;
  userAgent?: string;
  ipAddress?: string;
}

export interface CobaSummary {
  totalEvents: number;
  errorCount: number;
  warningCount: number;
  uniqueUsers: number;
  uniqueSessions: number;
  topErrors: Array<{ message: string; count: number }>;
  eventBreakdown: Record<string, number>;
  usageByDay: Array<{ date: string; count: number }>;
  bugPatterns: Array<{ pattern: string; occurrences: number; severity: string }>;
}

export async function ingestEvent(event: CobaEventInput): Promise<number> {
  const [inserted] = await db.insert(cobaEvents).values({
    tenantId: event.tenantId,
    eventType: event.eventType,
    severity: event.severity || "info",
    payload: event.payload || {},
    sessionId: event.sessionId,
    userId: event.userId,
    userAgent: event.userAgent,
    ipAddress: event.ipAddress,
  }).returning({ id: cobaEvents.id });
  return inserted.id;
}

export async function ingestBatch(events: CobaEventInput[]): Promise<number> {
  if (events.length === 0) return 0;
  const values = events.map(e => ({
    tenantId: e.tenantId,
    eventType: e.eventType,
    severity: e.severity || "info",
    payload: e.payload || {},
    sessionId: e.sessionId,
    userId: e.userId,
    userAgent: e.userAgent,
    ipAddress: e.ipAddress,
  }));
  await db.insert(cobaEvents).values(values);
  return values.length;
}

export async function buildSummary(tenantId: string, from: Date, to: Date): Promise<CobaSummary> {
  const events = await db.select()
    .from(cobaEvents)
    .where(and(
      eq(cobaEvents.tenantId, tenantId),
      gte(cobaEvents.createdAt, from),
      lte(cobaEvents.createdAt, to)
    ))
    .orderBy(desc(cobaEvents.createdAt));

  const errorCount = events.filter(e => e.severity === "error").length;
  const warningCount = events.filter(e => e.severity === "warning").length;
  const uniqueUsers = new Set(events.filter(e => e.userId).map(e => e.userId)).size;
  const uniqueSessions = new Set(events.filter(e => e.sessionId).map(e => e.sessionId)).size;

  const eventBreakdown: Record<string, number> = {};
  events.forEach(e => {
    eventBreakdown[e.eventType] = (eventBreakdown[e.eventType] || 0) + 1;
  });

  const errorMessages: Record<string, number> = {};
  events.filter(e => e.severity === "error").forEach(e => {
    const msg = (e.payload as any)?.message || (e.payload as any)?.error || e.eventType;
    errorMessages[msg] = (errorMessages[msg] || 0) + 1;
  });
  const topErrors = Object.entries(errorMessages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([message, count]) => ({ message, count }));

  const dayMap: Record<string, number> = {};
  events.forEach(e => {
    const day = e.createdAt ? new Date(e.createdAt).toISOString().slice(0, 10) : "unknown";
    dayMap[day] = (dayMap[day] || 0) + 1;
  });
  const usageByDay = Object.entries(dayMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));

  const bugPatterns = detectBugPatterns(events);

  return {
    totalEvents: events.length,
    errorCount,
    warningCount,
    uniqueUsers,
    uniqueSessions,
    topErrors,
    eventBreakdown,
    usageByDay,
    bugPatterns,
  };
}

function detectBugPatterns(events: any[]): Array<{ pattern: string; occurrences: number; severity: string }> {
  const patterns: Record<string, { count: number; severity: string }> = {};

  const errors = events.filter(e => e.severity === "error" || e.severity === "warning");
  errors.forEach(e => {
    const payload = e.payload as any;
    const key = payload?.errorCode || payload?.component || e.eventType;
    if (!patterns[key]) {
      patterns[key] = { count: 0, severity: e.severity || "warning" };
    }
    patterns[key].count++;
    if (e.severity === "error") patterns[key].severity = "error";
  });

  const repeatedPageCrashes: Record<string, number> = {};
  events.filter(e => e.eventType === "page_error" || e.eventType === "crash").forEach(e => {
    const page = (e.payload as any)?.page || (e.payload as any)?.url || "unknown";
    repeatedPageCrashes[page] = (repeatedPageCrashes[page] || 0) + 1;
  });
  Object.entries(repeatedPageCrashes).forEach(([page, cnt]) => {
    if (cnt >= 3) {
      patterns[`Crash récurrent: ${page}`] = { count: cnt, severity: "error" };
    }
  });

  const slowRequests = events.filter(e => {
    const duration = (e.payload as any)?.duration;
    return duration && duration > 3000;
  });
  if (slowRequests.length >= 5) {
    patterns["Requêtes lentes (>3s) détectées"] = { count: slowRequests.length, severity: "warning" };
  }

  return Object.entries(patterns)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([pattern, data]) => ({ pattern, occurrences: data.count, severity: data.severity }));
}

export async function generateAiInsights(summary: CobaSummary, tenantId: string): Promise<string> {
  try {
    const _cobaAI = getAIForContext("coba");
    const response = await _cobaAI.client.chat.completions.create({
      model: _cobaAI.model,
      messages: [
        {
          role: "system",
          content: `Tu es MaxAI COBA, le Chef Operator Business Assistant pour AppToOrder (SaaS de commande en ligne pour restaurants). Tu analyses les données d'utilisation et les bugs de l'application pour le restaurateur. Rédige un rapport clair et actionnable en français. Sois concis, professionnel et propose des solutions concrètes.`
        },
        {
          role: "user",
          content: `Voici le résumé des données pour le restaurant (tenant: ${tenantId}) sur la période :

${JSON.stringify(summary, null, 2)}

Génère un rapport d'analyse avec :
1. **Résumé exécutif** (2-3 lignes)
2. **Santé de l'application** (score /10 + justification)
3. **Problèmes détectés** (bugs, erreurs récurrentes, pages lentes)
4. **Usage utilisateurs** (comportement, pages populaires, taux d'erreur)
5. **Recommandations** (actions prioritaires à prendre)

Si aucun événement, indique qu'il n'y a pas encore assez de données pour une analyse complète.`
        }
      ],
      max_tokens: 1500,
      temperature: 0.3,
    });
    return response.choices[0]?.message?.content || "Analyse non disponible.";
  } catch (err: any) {
    console.error("[COBA] AI insights error:", err.message);
    return `Analyse automatique indisponible. Résumé brut : ${summary.totalEvents} événements, ${summary.errorCount} erreurs, ${summary.uniqueUsers} utilisateurs uniques.`;
  }
}

export async function generatePdfReport(
  tenantId: string,
  summary: CobaSummary,
  insights: string,
  periodStart: Date,
  periodEnd: Date
): Promise<{ filePath: string; fileName: string }> {
  ensureReportsDir();

  const dateStr = periodStart.toISOString().slice(0, 10);
  const fileName = `coba-report-${tenantId}-${dateStr}.pdf`;
  const filePath = path.join(REPORTS_DIR, fileName);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    doc.fontSize(24).fillColor("#1a1a2e")
      .text("MaxAI COBA", { align: "center" });
    doc.fontSize(12).fillColor("#666")
      .text("Chef Operator Business Assistant", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#999")
      .text(`Rapport pour : ${tenantId}`, { align: "center" });
    doc.text(`Période : ${periodStart.toLocaleDateString("fr-FR")} - ${periodEnd.toLocaleDateString("fr-FR")}`, { align: "center" });
    doc.text(`Généré le : ${new Date().toLocaleDateString("fr-FR")} à ${new Date().toLocaleTimeString("fr-FR")}`, { align: "center" });

    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#ddd").stroke();
    doc.moveDown(1);

    doc.fontSize(16).fillColor("#1a1a2e").text("Vue d'ensemble");
    doc.moveDown(0.5);

    const stats = [
      ["Événements totaux", String(summary.totalEvents)],
      ["Erreurs", String(summary.errorCount)],
      ["Avertissements", String(summary.warningCount)],
      ["Utilisateurs uniques", String(summary.uniqueUsers)],
      ["Sessions uniques", String(summary.uniqueSessions)],
    ];

    stats.forEach(([label, value]) => {
      doc.fontSize(11).fillColor("#333").text(`${label}: `, { continued: true });
      doc.fillColor(label === "Erreurs" && parseInt(value) > 0 ? "#e74c3c" : "#2ecc71")
        .text(value);
    });

    doc.moveDown(1);

    if (summary.topErrors.length > 0) {
      doc.fontSize(16).fillColor("#e74c3c").text("Erreurs principales");
      doc.moveDown(0.3);
      summary.topErrors.slice(0, 5).forEach((err, i) => {
        doc.fontSize(10).fillColor("#333")
          .text(`${i + 1}. ${err.message} (${err.count}x)`);
      });
      doc.moveDown(1);
    }

    if (summary.bugPatterns.length > 0) {
      doc.fontSize(16).fillColor("#f39c12").text("Patterns de bugs détectés");
      doc.moveDown(0.3);
      summary.bugPatterns.slice(0, 5).forEach((bp, i) => {
        const color = bp.severity === "error" ? "#e74c3c" : "#f39c12";
        doc.fontSize(10).fillColor(color)
          .text(`${i + 1}. ${bp.pattern} — ${bp.occurrences} occurrence(s) [${bp.severity}]`);
      });
      doc.moveDown(1);
    }

    if (Object.keys(summary.eventBreakdown).length > 0) {
      doc.fontSize(16).fillColor("#1a1a2e").text("Répartition des événements");
      doc.moveDown(0.3);
      Object.entries(summary.eventBreakdown)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .forEach(([type, cnt]) => {
          doc.fontSize(10).fillColor("#333").text(`• ${type}: ${cnt}`);
        });
      doc.moveDown(1);
    }

    if (summary.usageByDay.length > 0) {
      doc.fontSize(16).fillColor("#1a1a2e").text("Activité par jour");
      doc.moveDown(0.3);
      summary.usageByDay.forEach(d => {
        doc.fontSize(10).fillColor("#333").text(`${d.date}: ${d.count} événement(s)`);
      });
      doc.moveDown(1);
    }

    if (doc.y > 650) doc.addPage();

    doc.fontSize(16).fillColor("#1a1a2e").text("Analyse MaxAI");
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#333").text(insights, { lineGap: 3 });

    doc.moveDown(2);
    doc.fontSize(8).fillColor("#aaa")
      .text("Ce rapport a été généré automatiquement par MaxAI COBA — AppToOrder Intelligence.", { align: "center" });

    doc.end();

    stream.on("finish", () => resolve({ filePath, fileName }));
    stream.on("error", reject);
  });
}

export async function generateFullReport(tenantId: string, periodStart: Date, periodEnd: Date): Promise<{
  reportId: number;
  pdfUrl: string;
  summary: CobaSummary;
  insights: string;
}> {
  const summary = await buildSummary(tenantId, periodStart, periodEnd);
  const insights = await generateAiInsights(summary, tenantId);
  const { filePath, fileName } = await generatePdfReport(tenantId, summary, insights, periodStart, periodEnd);

  const pdfUrl = `/coba-reports/${fileName}`;

  const [report] = await db.insert(cobaReports).values({
    tenantId,
    reportType: "on-demand",
    periodStart,
    periodEnd,
    summary: summary as any,
    aiInsights: insights,
    pdfUrl,
    pdfPath: filePath,
    status: "completed",
  }).returning({ id: cobaReports.id });

  return { reportId: report.id, pdfUrl, summary, insights };
}

export async function generateWeeklyReports(): Promise<number> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const tenants = await db.selectDistinct({ tenantId: cobaEvents.tenantId })
    .from(cobaEvents)
    .where(gte(cobaEvents.createdAt, weekAgo));

  let generated = 0;
  for (const { tenantId } of tenants) {
    try {
      await generateFullReport(tenantId, weekAgo, now);
      generated++;
      console.log(`[COBA] Weekly report generated for tenant: ${tenantId}`);
    } catch (err: any) {
      console.error(`[COBA] Failed to generate weekly report for ${tenantId}:`, err.message);
    }
  }
  return generated;
}

export async function getReports(tenantId: string, limit = 10) {
  return db.select()
    .from(cobaReports)
    .where(eq(cobaReports.tenantId, tenantId))
    .orderBy(desc(cobaReports.createdAt))
    .limit(limit);
}

export async function getEventStats(tenantId: string, days = 7) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const events = await db.select()
    .from(cobaEvents)
    .where(and(
      eq(cobaEvents.tenantId, tenantId),
      gte(cobaEvents.createdAt, since)
    ));

  return {
    total: events.length,
    errors: events.filter(e => e.severity === "error").length,
    warnings: events.filter(e => e.severity === "warning").length,
    uniqueUsers: new Set(events.filter(e => e.userId).map(e => e.userId)).size,
    since: since.toISOString(),
  };
}

let weeklyTimer: NodeJS.Timeout | null = null;

export function startWeeklyScheduler() {
  if (weeklyTimer) return;

  const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

  const now = new Date();
  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() + ((1 + 7 - now.getDay()) % 7 || 7));
  nextMonday.setHours(7, 0, 0, 0);
  const msUntilNextMonday = nextMonday.getTime() - now.getTime();

  console.log(`[COBA] Weekly report scheduler started. Next run: ${nextMonday.toISOString()}`);

  setTimeout(() => {
    generateWeeklyReports().catch(err => console.error("[COBA] Weekly report error:", err));

    weeklyTimer = setInterval(() => {
      generateWeeklyReports().catch(err => console.error("[COBA] Weekly report error:", err));
    }, MS_PER_WEEK);
  }, msUntilNextMonday);
}
