import { fetchMarseilleData } from "./marseilleWeather";
import { calendarService } from "./googleCalendarService";
import { getTasksDueToday, getTaskSummary } from "./todoistService";
import { tradingAlertsService } from "./tradingAlertsService";
import { agentMailService } from "./agentMailService";
import { getOwnerUserId } from "./knowledgeSync";
import { calendarAnticipationService } from "./calendarAnticipationService";
import { db } from "../db";
import { sql } from "drizzle-orm";

interface BriefingSection {
  title: string;
  content: string;
  icon: string;
}

interface MorningBriefing {
  date: string;
  greeting: string;
  sections: BriefingSection[];
  generatedAt: string;
}

let lastBriefing: MorningBriefing | null = null;
let lastBriefingDate: string = "";
let briefingConfig = {
  enabled: true,
  sendTime: "07:00",
  recipientEmail: "",
  includeSections: {
    weather: true,
    calendar: true,
    tasks: true,
    stocks: true,
    restaurantKpis: true,
    sports: true,
    calendarAnticipations: true
  }
};

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Bonjour Boss";
  if (hour < 18) return "Bon après-midi Boss";
  return "Bonsoir Boss";
}

async function getWeatherSection(): Promise<BriefingSection | null> {
  try {
    const data = await fetchMarseilleData();
    return {
      title: "Météo Marseille",
      icon: "☀️",
      content: `${data.weather.condition} — ${data.weather.temperature}, Humidité: ${data.weather.humidity}, Vent: ${data.weather.wind}`
    };
  } catch (e) {
    return null;
  }
}

async function getCalendarSection(userId: number): Promise<BriefingSection | null> {
  try {
    const events = await calendarService.getTodayEvents(userId);
    if (!events || events.length === 0) {
      return { title: "Agenda", icon: "📅", content: "Aucun événement prévu aujourd'hui." };
    }
    const lines = events.slice(0, 8).map((e: any) => {
      const startVal = e.start?.dateTime || e.start;
      const time = startVal && typeof startVal === "string" && startVal.includes("T")
        ? new Date(startVal).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
        : "Journée";
      return `• ${time} — ${e.summary || e.title || "Sans titre"}`;
    });
    return { title: "Agenda", icon: "📅", content: lines.join("\n") };
  } catch (e) {
    return null;
  }
}

async function getTasksSection(): Promise<BriefingSection | null> {
  try {
    const [dueTasks, summary] = await Promise.all([
      getTasksDueToday(),
      getTaskSummary()
    ]);
    const lines: string[] = [];
    lines.push(`📊 ${summary.total} tâches total, ${summary.dueToday} aujourd'hui, ${summary.overdue} en retard`);
    if (dueTasks.length > 0) {
      lines.push("");
      dueTasks.slice(0, 6).forEach(t => {
        lines.push(`• ${t.content}`);
      });
    }
    return { title: "Tâches Todoist", icon: "✅", content: lines.join("\n") };
  } catch (e) {
    return null;
  }
}

async function getStocksSection(): Promise<BriefingSection | null> {
  try {
    const watchlist = tradingAlertsService.getWatchlist();
    if (!watchlist || watchlist.length === 0) {
      return { title: "Marchés", icon: "📈", content: "Aucun titre suivi." };
    }
    return {
      title: "Marchés",
      icon: "📈",
      content: `Watchlist: ${watchlist.join(", ")} — Ouvre l'app pour les cours en temps réel.`
    };
  } catch (e) {
    return null;
  }
}

async function getRestaurantKpisSection(): Promise<BriefingSection | null> {
  try {
    const { executeQueryAppData } = await import("./tools/utilityTools");
    const [valAudit, valCash, valLoans, mailOverview] = await Promise.all([
      executeQueryAppData({ section: "suguval_audit" }).then(r => JSON.parse(r)).catch(() => null),
      executeQueryAppData({ section: "suguval_cash", limit: 7 }).then(r => JSON.parse(r)).catch(() => null),
      executeQueryAppData({ section: "suguval_loans" }).then(r => JSON.parse(r)).catch(() => null),
      executeQueryAppData({ section: "sugumaillane_overview" }).then(r => JSON.parse(r)).catch(() => null),
    ]);

    const lines: string[] = [];

    lines.push("🏪 SUGU Valentine:");
    if (valAudit) {
      lines.push(`   CA: ${valAudit.revenue?.toFixed(0)}€ | Achats: ${valAudit.purchases?.toFixed(0)}€ | Frais: ${valAudit.expenses?.toFixed(0)}€`);
      lines.push(`   Masse salariale: ${valAudit.payroll?.toFixed(0)}€ | Écritures banque: ${valAudit.bankEntries} | Jours caisse: ${valAudit.cashDays}`);
    }
    if (valCash && valCash.entries?.length > 0) {
      const lastDay = valCash.entries[0];
      lines.push(`   Dernier jour caisse: ${lastDay.total?.toFixed(0)}€ (espèces: ${lastDay.cash?.toFixed(0)}€, CB: ${lastDay.cb?.toFixed(0)}€, ${lastDay.covers || 0} couverts)`);
    }
    if (valLoans && valLoans.count > 0) {
      lines.push(`   Emprunts: ${valLoans.count} en cours, restant dû: ${valLoans.totalRemaining?.toFixed(0)}€`);
    }

    lines.push("");
    lines.push("🏪 SUGU Maillane:");
    if (mailOverview) {
      lines.push(`   CA caisse: ${mailOverview.caisse?.total?.toFixed(0)}€ | Achats: ${mailOverview.achats?.total?.toFixed(0)}€ | Frais: ${mailOverview.frais?.total?.toFixed(0)}€`);
      lines.push(`   Employés actifs: ${mailOverview.employes?.actifs}/${mailOverview.employes?.total} | Fiches paie: ${mailOverview.paie?.count} | Absences: ${mailOverview.absences?.count}`);
    } else {
      lines.push("   Données non disponibles");
    }

    return { title: "Restaurants KPI", icon: "🍽️", content: lines.join("\n") };
  } catch (e) {
    try {
      const today = new Date();
      const startOfMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
      const endOfMonth = today.toISOString().split("T")[0];
      const [valPurchases, mailPurchases] = await Promise.all([
        db.execute(sql`SELECT COALESCE(SUM(amount), 0) as total FROM sugu_purchases WHERE invoice_date >= ${startOfMonth} AND invoice_date <= ${endOfMonth}`).catch(() => ({ rows: [{ total: 0 }] })),
        db.execute(sql`SELECT COALESCE(SUM(amount), 0) as total FROM sugum_purchases WHERE invoice_date >= ${startOfMonth} AND invoice_date <= ${endOfMonth}`).catch(() => ({ rows: [{ total: 0 }] })),
      ]);
      return { title: "Restaurants KPI", icon: "🍽️", content: `Valentine achats: ${Number(valPurchases.rows[0]?.total || 0).toFixed(0)}€ | Maillane achats: ${Number(mailPurchases.rows[0]?.total || 0).toFixed(0)}€` };
    } catch {
      return null;
    }
  }
}

async function getCalendarAnticipationsSection(userId: number): Promise<BriefingSection | null> {
  try {
    const anticipations = await calendarAnticipationService.getUpcomingActions(userId, 3);
    if (anticipations.length === 0) {
      return null;
    }
    const content = calendarAnticipationService.formatForBriefing(anticipations);
    return { title: "Anticipations", icon: "🔮", content };
  } catch (e) {
    return null;
  }
}

async function getSuguProactiveSection(): Promise<BriefingSection | null> {
  try {
    const { suguProactiveService } = await import("./suguProactiveService");
    const report = await suguProactiveService.getFullReport("valentine", 30);
    const summary = suguProactiveService.getBriefingSummary(report);
    if (summary === "Aucune alerte proactive.") return null;
    return {
      title: "Alertes SUGU Proactives",
      icon: "🔔",
      content: summary,
    };
  } catch (e) {
    return null;
  }
}

async function getPugiSection(): Promise<BriefingSection | null> {
  try {
    const { pugi } = await import("./proactiveGeneralIntelligence");
    const content = pugi.formatForBriefing();
    if (!content || content.length < 20) return null;
    return { title: "Intelligence Proactive", icon: "🧠", content };
  } catch {
    return null;
  }
}

async function getSportsSection(): Promise<BriefingSection | null> {
  try {
    const results = await db.execute(
      sql`SELECT home_team, away_team, home_score, away_score, league, match_date 
          FROM sports_matches 
          WHERE match_date >= NOW() - INTERVAL '24 hours' AND status = 'finished'
          ORDER BY match_date DESC LIMIT 5`
    ).catch(() => ({ rows: [] }));

    if (results.rows.length === 0) {
      return { title: "Sports", icon: "⚽", content: "Aucun résultat récent." };
    }
    const lines = results.rows.map((r: any) =>
      `• ${r.home_team} ${r.home_score}-${r.away_score} ${r.away_team} (${r.league})`
    );
    return { title: "Sports", icon: "⚽", content: lines.join("\n") };
  } catch (e) {
    return null;
  }
}

export async function generateBriefing(): Promise<MorningBriefing> {
  const userId = (await getOwnerUserId()) || 1;
  const sections: BriefingSection[] = [];
  const cfg = briefingConfig.includeSections;

  const tasks = [];
  if (cfg.weather) tasks.push(getWeatherSection());
  if (cfg.calendar) tasks.push(getCalendarSection(userId));
  if (cfg.tasks) tasks.push(getTasksSection());
  if (cfg.stocks) tasks.push(getStocksSection());
  if (cfg.restaurantKpis) tasks.push(getRestaurantKpisSection());
  if (cfg.restaurantKpis) tasks.push(getSuguProactiveSection());
  if (cfg.sports) tasks.push(getSportsSection());
  if (cfg.calendarAnticipations) tasks.push(getCalendarAnticipationsSection(userId));
  tasks.push(getPugiSection());

  const results = await Promise.allSettled(tasks);
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      sections.push(r.value);
    }
  }

  const now = new Date();
  const briefing: MorningBriefing = {
    date: now.toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
    greeting: getGreeting(),
    sections,
    generatedAt: now.toISOString()
  };

  lastBriefing = briefing;
  lastBriefingDate = now.toISOString().split("T")[0];
  return briefing;
}

function briefingToHtml(briefing: MorningBriefing): string {
  const sectionBlocks = briefing.sections.map(s => `
    <div style="background:#f8f9fa;border-radius:12px;padding:16px;margin-bottom:16px;">
      <h3 style="margin:0 0 8px;color:#1a1a2e;font-size:16px;">${s.icon} ${s.title}</h3>
      <pre style="margin:0;white-space:pre-wrap;font-family:inherit;color:#333;font-size:14px;line-height:1.6;">${s.content}</pre>
    </div>
  `).join("");

  return `
    <div style="max-width:600px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      <div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:24px;border-radius:16px 16px 0 0;text-align:center;">
        <h1 style="margin:0;font-size:24px;">${briefing.greeting} 👋</h1>
        <p style="margin:8px 0 0;opacity:0.9;font-size:14px;">${briefing.date}</p>
      </div>
      <div style="padding:20px;background:white;border-radius:0 0 16px 16px;">
        ${sectionBlocks}
        <p style="text-align:center;color:#999;font-size:12px;margin-top:20px;">
          Généré par Ulysse à ${new Date(briefing.generatedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
        </p>
      </div>
    </div>
  `;
}

function briefingToText(briefing: MorningBriefing): string {
  let text = `${briefing.greeting}\n${briefing.date}\n${"=".repeat(40)}\n\n`;
  for (const s of briefing.sections) {
    text += `${s.icon} ${s.title}\n${"-".repeat(30)}\n${s.content}\n\n`;
  }
  return text;
}

export async function sendBriefingEmail(recipientEmail?: string): Promise<{ success: boolean; error?: string }> {
  try {
    const briefing = await generateBriefing();
    const to = recipientEmail || briefingConfig.recipientEmail;
    if (!to) {
      return { success: false, error: "Aucun email destinataire configuré" };
    }

    await agentMailService.sendEmail({
      to,
      subject: `☀️ Briefing du ${briefing.date}`,
      body: briefingToHtml(briefing)
    }, "ulysse");

    try {
      const { pushNotificationService } = await import("./pushNotificationService");
      const userId = (await getOwnerUserId()) || 1;
      await pushNotificationService.sendToUser(userId, {
        title: `Briefing du ${briefing.date}`,
        body: briefing.sections.map(s => s.title).join(" | "),
        url: "/",
        alertType: "morning_briefing",
      });
    } catch (pushErr: any) {
      console.warn("[MorningBriefing] Push send failed:", pushErr.message);
    }

    console.log(`[MorningBriefing] Email sent to ${to}`);
    return { success: true };
  } catch (e: any) {
    console.error("[MorningBriefing] Send failed:", e.message);
    return { success: false, error: e.message };
  }
}

export function getLastBriefing(): MorningBriefing | null {
  return lastBriefing;
}

export function getBriefingConfig() {
  return briefingConfig;
}

export function updateBriefingConfig(updates: Partial<typeof briefingConfig>) {
  briefingConfig = { ...briefingConfig, ...updates };
  if (updates.includeSections) {
    briefingConfig.includeSections = { ...briefingConfig.includeSections, ...updates.includeSections };
  }
  return briefingConfig;
}

export async function checkAndSendMorningBriefing(): Promise<void> {
  if (!briefingConfig.enabled) return;
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  if (lastBriefingDate === today) return;

  const [targetH, targetM] = briefingConfig.sendTime.split(":").map(Number);
  const currentH = now.getHours();
  const currentM = now.getMinutes();

  if (currentH === targetH && currentM >= targetM && currentM < targetM + 5) {
    console.log("[MorningBriefing] Time to send morning briefing!");
    await sendBriefingEmail();
  }
}

export const morningBriefingService = {
  generateBriefing,
  sendBriefingEmail,
  getLastBriefing,
  getBriefingConfig,
  updateBriefingConfig,
  checkAndSendMorningBriefing
};
