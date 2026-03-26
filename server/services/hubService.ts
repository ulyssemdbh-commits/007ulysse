/**
 * Hub Service - Agrégation des données pour brief quotidien
 * Unifie Todoist, Calendar, SUGU, Gmail, Sports, AppToOrder, PUGI, Payroll
 * 
 * v2 - Mars 2026: Intégration complète de tous les modules
 */

import { db } from "../db";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { ulysseHomework, suguPayroll, suguEmployees } from "@shared/schema";

interface TodoistTask {
  id: string;
  content: string;
  priority: number;
  due?: { date: string; datetime?: string };
  projectName?: string;
}

interface CalendarEvent {
  id: string;
  summary: string;
  start: Date;
  end: Date;
  location?: string;
  isAllDay: boolean;
}

interface SuguSummary {
  restaurant: "suguval" | "sugumaillane";
  pendingItems: number;
  categories: string[];
  lastEmailSent?: Date;
}

interface HomeworkTask {
  id: number;
  name: string;
  nextRun: Date;
  recurrence: string;
  priority: number;
}

interface GmailSummary {
  unreadCount: number;
  importantUnread: number;
  recentSenders: string[];
}

interface SportsSummary {
  upcomingMatches: number;
  activePredictions: number;
  recentResults: { match: string; result: string; correct: boolean }[];
}

interface AppToOrderSummary {
  status: "healthy" | "degraded" | "critical";
  urlsAccessible: number;
  urlsTotal: number;
  todayOrders: number;
  todayRevenue: number;
}

interface PayrollSummary {
  totalEmployees: number;
  activeEmployees: number;
  pendingPayrolls: number;
  recentPayrolls: { employee: string; period: string; net: number }[];
  totalMonthlyCost: number;
}

interface PugiSummary {
  totalSignals: number;
  criticalActions: number;
  topInsights: string[];
}

interface SystemHealthSummary {
  status: "healthy" | "degraded" | "critical";
  healthScore: number;
  degradedServices: string[];
}

interface DailyBrief {
  date: string;
  greeting: string;
  weather?: { temp: number; condition: string };
  priorities: {
    urgent: string[];
    important: string[];
    normal: string[];
  };
  calendar: CalendarEvent[];
  todoist: {
    overdue: TodoistTask[];
    today: TodoistTask[];
  };
  sugu: SuguSummary[];
  homework: HomeworkTask[];
  gmail?: GmailSummary;
  sports?: SportsSummary;
  appToOrder?: AppToOrderSummary;
  payroll?: PayrollSummary;
  pugi?: PugiSummary;
  systemHealth?: SystemHealthSummary;
  summary: string;
}

class HubService {
  async getTodayBrief(userId: number): Promise<DailyBrief> {
    const now = new Date();
    const todayStr = now.toLocaleDateString('fr-FR', { 
      weekday: 'long', 
      day: 'numeric', 
      month: 'long',
      year: 'numeric'
    });

    const hour = now.getHours();
    let greeting = "Bonjour";
    if (hour < 6) greeting = "Bonne nuit";
    else if (hour < 12) greeting = "Bonjour";
    else if (hour < 18) greeting = "Bon après-midi";
    else greeting = "Bonsoir";

    const [calendar, todoist, sugu, homework, gmail, sports, appToOrder, payroll, pugi, systemHealth] = await Promise.all([
      this.getCalendarEvents(userId),
      this.getTodoistTasks(userId),
      this.getSuguStatus(),
      this.getHomeworkTasks(userId),
      this.getGmailSummary(),
      this.getSportsSummary(),
      this.getAppToOrderSummary(),
      this.getPayrollSummary(),
      this.getPugiSummary(),
      this.getSystemHealthSummary(),
    ]);

    const priorities = this.categorizePriorities(todoist, calendar, sugu, gmail, sports, appToOrder, payroll, pugi, systemHealth);
    const summary = this.generateSummary(priorities, calendar, todoist, sugu, gmail, sports, appToOrder, payroll);

    return {
      date: todayStr,
      greeting,
      priorities,
      calendar,
      todoist,
      sugu,
      homework,
      gmail,
      sports,
      appToOrder,
      payroll,
      pugi,
      systemHealth,
      summary
    };
  }

  private async getCalendarEvents(userId: number): Promise<CalendarEvent[]> {
    try {
      const { connectorBridge } = await import("./connectorBridge");
      const conn = await connectorBridge.getGoogleCalendar();
      if (conn.source !== 'direct' || !conn.accessToken) {
        console.log("[Hub] Google Calendar not configured");
        return [];
      }

      const now = new Date();
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);

      const params = new URLSearchParams({
        maxResults: "10",
        timeMin: now.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: "true",
        orderBy: "startTime"
      });

      const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
        headers: { 'Authorization': `Bearer ${conn.accessToken}` }
      });

      if (!response.ok) {
        console.error("[Hub] Calendar API error:", response.status);
        return [];
      }

      const data = await response.json() as any;
      return (data.items || []).map((e: any) => ({
        id: e.id,
        summary: e.summary || "Sans titre",
        start: new Date(e.start?.dateTime || e.start?.date),
        end: new Date(e.end?.dateTime || e.end?.date),
        location: e.location,
        isAllDay: !e.start?.dateTime
      }));
    } catch (error) {
      console.error("[Hub] Calendar fetch error:", error);
      return [];
    }
  }

  private async getTodoistTasks(userId: number): Promise<{ overdue: TodoistTask[]; today: TodoistTask[] }> {
    try {
      const { connectorBridge } = await import("./connectorBridge");
      const conn = await connectorBridge.getTodoist();
      if (conn.source !== 'direct' || !conn.apiKey) {
        console.log("[Hub] Todoist not configured");
        return { overdue: [], today: [] };
      }

      const headers = { 'Authorization': `Bearer ${conn.apiKey}` };

      const [tasksRes, projectsRes] = await Promise.all([
        fetch("https://api.todoist.com/rest/v2/tasks?filter=today%20%7C%20overdue", { headers }),
        fetch("https://api.todoist.com/rest/v2/projects", { headers })
      ]);

      if (!tasksRes.ok || !projectsRes.ok) {
        console.error("[Hub] Todoist API error:", tasksRes.status, projectsRes.status);
        return { overdue: [], today: [] };
      }

      const todayTasks = await tasksRes.json() as any[];
      const projects = await projectsRes.json() as any[];

      const projectMap = new Map(projects.map((p: any) => [p.id, p.name]));
      const now = new Date();
      now.setHours(0, 0, 0, 0);

      const overdue: TodoistTask[] = [];
      const today: TodoistTask[] = [];

      for (const task of todayTasks) {
        const formatted: TodoistTask = {
          id: task.id,
          content: task.content,
          priority: task.priority,
          due: task.due,
          projectName: projectMap.get(task.project_id) as string
        };

        if (task.due?.date) {
          const dueDate = new Date(task.due.date);
          dueDate.setHours(0, 0, 0, 0);
          if (dueDate < now) {
            overdue.push(formatted);
          } else {
            today.push(formatted);
          }
        } else {
          today.push(formatted);
        }
      }

      return {
        overdue: overdue.sort((a, b) => b.priority - a.priority),
        today: today.sort((a, b) => b.priority - a.priority)
      };
    } catch (error) {
      console.error("[Hub] Todoist fetch error:", error);
      return { overdue: [], today: [] };
    }
  }

  private async getSuguStatus(): Promise<SuguSummary[]> {
    try {
      const { suguvalService } = await import("./suguvalService");
      const { sugumaillaneService } = await import("./sugumaillaneService");

      const [suguvalChecks, sugumaillaneChecks] = await Promise.all([
        suguvalService.getTodayChecks().catch(() => []),
        sugumaillaneService.getTodayChecks().catch(() => [])
      ]);

      const [suguvalCats, sugumaillaneCats] = await Promise.all([
        suguvalService.getAllCategories().catch(() => []),
        sugumaillaneService.getAllCategories().catch(() => [])
      ]);

      const results: SuguSummary[] = [];

      const suguvalPending = suguvalChecks.filter((c: any) => c.checked).length;
      if (suguvalPending > 0 || suguvalCats.length > 0) {
        results.push({
          restaurant: "suguval",
          pendingItems: suguvalPending,
          categories: suguvalCats.map((c: any) => c.name).slice(0, 5)
        });
      }

      const sugumaillanePending = sugumaillaneChecks.filter((c: any) => c.checked).length;
      if (sugumaillanePending > 0 || sugumaillaneCats.length > 0) {
        results.push({
          restaurant: "sugumaillane",
          pendingItems: sugumaillanePending,
          categories: sugumaillaneCats.map((c: any) => c.name).slice(0, 5)
        });
      }

      return results;
    } catch (error) {
      console.error("[Hub] SUGU fetch error:", error);
      return [];
    }
  }

  private async getHomeworkTasks(userId: number): Promise<HomeworkTask[]> {
    try {
      const now = new Date();
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);

      const tasks = await db.select()
        .from(ulysseHomework)
        .where(
          and(
            eq(ulysseHomework.userId, userId),
            eq(ulysseHomework.enabled, true),
            lte(ulysseHomework.nextRun, endOfDay)
          )
        )
        .orderBy(ulysseHomework.nextRun)
        .limit(10);

      return tasks.map(t => ({
        id: t.id,
        name: t.name,
        nextRun: t.nextRun!,
        recurrence: t.recurrence,
        priority: t.priority || 3
      }));
    } catch (error) {
      console.error("[Hub] Homework fetch error:", error);
      return [];
    }
  }

  private async getGmailSummary(): Promise<GmailSummary | undefined> {
    try {
      const gmailService = await import("./googleMailService");
      const gmail = gmailService.default || gmailService;
      if (!gmail.listMessages) return undefined;
      const messages = await gmail.listMessages({ maxResults: 20, query: "is:unread" });
      const importantMessages = await gmail.listMessages({ maxResults: 10, query: "is:unread is:important" }).catch(() => ({ messages: [] }));
      const senders = new Set<string>();
      for (const msg of (messages.messages || []).slice(0, 5)) {
        try {
          const detail = await gmail.getMessage(msg.id);
          const from = detail?.payload?.headers?.find((h: any) => h.name === "From")?.value;
          if (from) senders.add(from.replace(/<.*>/, '').trim());
        } catch {}
      }
      return {
        unreadCount: messages.resultSizeEstimate || (messages.messages || []).length,
        importantUnread: importantMessages.resultSizeEstimate || (importantMessages.messages || []).length,
        recentSenders: Array.from(senders).slice(0, 5),
      };
    } catch (error) {
      console.log("[Hub] Gmail fetch skipped:", (error as Error).message?.substring(0, 60));
      return undefined;
    }
  }

  private async getSportsSummary(): Promise<SportsSummary | undefined> {
    try {
      const { sportsCacheService } = await import("./sportsCacheService");
      const cache = sportsCacheService;
      const upcomingMatches = cache.getUpcomingMatches?.() || [];
      const recentResults = cache.getRecentResults?.() || [];
      return {
        upcomingMatches: upcomingMatches.length,
        activePredictions: cache.getActivePredictions?.() || 0,
        recentResults: recentResults.slice(0, 3).map((r: any) => ({
          match: `${r.homeTeam} vs ${r.awayTeam}`,
          result: r.score || "N/A",
          correct: r.predictionCorrect || false,
        })),
      };
    } catch {
      return undefined;
    }
  }

  private async getAppToOrderSummary(): Promise<AppToOrderSummary | undefined> {
    try {
      const { appToOrderMonitor } = await import("./appToOrderMonitorService");
      const status = await appToOrderMonitor.getStatus();
      return {
        status: status.overallHealth || "healthy",
        urlsAccessible: status.urlsUp || 0,
        urlsTotal: status.urlsTotal || 11,
        todayOrders: status.todayOrders || 0,
        todayRevenue: status.todayRevenue || 0,
      };
    } catch {
      return undefined;
    }
  }

  private async getPayrollSummary(): Promise<PayrollSummary | undefined> {
    try {
      const employees = await db.select().from(suguEmployees);
      const activeEmployees = employees.filter((e: any) => e.isActive !== false);
      const currentMonth = new Date().toISOString().slice(0, 7);
      const recentPayrolls = await db.select()
        .from(suguPayroll)
        .orderBy(desc(suguPayroll.id))
        .limit(10);
      
      const totalMonthlyCost = recentPayrolls
        .filter((p: any) => p.period === currentMonth)
        .reduce((sum: number, p: any) => sum + (Number(p.grossSalary) || 0), 0);

      return {
        totalEmployees: employees.length,
        activeEmployees: activeEmployees.length,
        pendingPayrolls: 0,
        recentPayrolls: recentPayrolls.slice(0, 5).map((p: any) => {
          const emp = employees.find((e: any) => e.id === p.employeeId);
          return {
            employee: emp ? `${emp.firstName} ${emp.lastName}` : `Emp #${p.employeeId}`,
            period: p.period || "N/A",
            net: Number(p.netSalary) || 0,
          };
        }),
        totalMonthlyCost,
      };
    } catch (error) {
      console.log("[Hub] Payroll fetch skipped:", (error as Error).message?.substring(0, 60));
      return undefined;
    }
  }

  private async getPugiSummary(): Promise<PugiSummary | undefined> {
    try {
      const { pugi } = await import("./proactiveGeneralIntelligence");
      const digest = pugi.getDigest(5);
      return {
        totalSignals: digest.stats.totalSignals || 0,
        criticalActions: digest.topActions.filter((a: any) => a.priority === "critical").length,
        topInsights: digest.insights.slice(0, 3).map((i: any) => i.description || i.title),
      };
    } catch {
      return undefined;
    }
  }

  private async getSystemHealthSummary(): Promise<SystemHealthSummary | undefined> {
    try {
      const { selfHealingService } = await import("./selfHealingService");
      const health = selfHealingService.getHealthReport();
      const degradedServices = (health.services || [])
        .filter((s: any) => s.status !== "healthy")
        .map((s: any) => s.name);
      return {
        status: degradedServices.length === 0 ? "healthy" : degradedServices.length < 3 ? "degraded" : "critical",
        healthScore: health.score || 100,
        degradedServices,
      };
    } catch {
      return undefined;
    }
  }

  private categorizePriorities(
    todoist: { overdue: TodoistTask[]; today: TodoistTask[] },
    calendar: CalendarEvent[],
    sugu: SuguSummary[],
    gmail?: GmailSummary,
    sports?: SportsSummary,
    appToOrder?: AppToOrderSummary,
    payroll?: PayrollSummary,
    pugi?: PugiSummary,
    systemHealth?: SystemHealthSummary
  ): DailyBrief["priorities"] {
    const urgent: string[] = [];
    const important: string[] = [];
    const normal: string[] = [];

    if (systemHealth?.status === "critical") {
      urgent.push(`🔴 Système en état critique: ${systemHealth.degradedServices.join(', ')}`);
    } else if (systemHealth?.status === "degraded") {
      important.push(`🟡 Services dégradés: ${systemHealth.degradedServices.join(', ')}`);
    }

    if (appToOrder?.status === "critical") {
      urgent.push(`🔴 AppToOrder en panne (${appToOrder.urlsAccessible}/${appToOrder.urlsTotal} URLs)`);
    } else if (appToOrder?.status === "degraded") {
      important.push(`🟡 AppToOrder dégradé (${appToOrder.urlsAccessible}/${appToOrder.urlsTotal} URLs)`);
    }

    if (pugi && pugi.criticalActions > 0) {
      urgent.push(`🧠 PUGI: ${pugi.criticalActions} action${pugi.criticalActions > 1 ? 's' : ''} critique${pugi.criticalActions > 1 ? 's' : ''}`);
    }

    for (const task of todoist.overdue.slice(0, 3)) {
      urgent.push(`📋 ${task.content} (en retard)`);
    }
    for (const task of todoist.today.filter(t => t.priority === 4).slice(0, 3)) {
      urgent.push(`📋 ${task.content}`);
    }

    const now = new Date();
    const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    for (const event of calendar.filter(e => e.start <= twoHoursLater && e.start > now)) {
      important.push(`📅 ${event.summary} à ${event.start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`);
    }

    for (const s of sugu) {
      if (s.pendingItems > 0) {
        important.push(`🛒 ${s.restaurant}: ${s.pendingItems} articles cochés`);
      }
    }

    if (gmail && gmail.unreadCount > 10) {
      important.push(`📧 ${gmail.unreadCount} emails non lus (${gmail.importantUnread} importants)`);
    } else if (gmail && gmail.unreadCount > 0) {
      normal.push(`📧 ${gmail.unreadCount} email${gmail.unreadCount > 1 ? 's' : ''} non lu${gmail.unreadCount > 1 ? 's' : ''}`);
    }

    if (sports && sports.upcomingMatches > 0) {
      normal.push(`⚽ ${sports.upcomingMatches} match${sports.upcomingMatches > 1 ? 's' : ''} à venir`);
    }

    if (appToOrder?.todayOrders > 0) {
      normal.push(`🛍️ ${appToOrder.todayOrders} commandes (${appToOrder.todayRevenue.toFixed(0)}€)`);
    }

    for (const task of todoist.today.filter(t => t.priority < 4).slice(0, 5)) {
      normal.push(`📋 ${task.content}`);
    }
    for (const event of calendar.filter(e => e.start > twoHoursLater).slice(0, 3)) {
      normal.push(`📅 ${event.summary} à ${event.start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`);
    }

    return { urgent, important, normal };
  }

  private generateSummary(
    priorities: DailyBrief["priorities"],
    calendar: CalendarEvent[],
    todoist: { overdue: TodoistTask[]; today: TodoistTask[] },
    sugu: SuguSummary[],
    gmail?: GmailSummary,
    sports?: SportsSummary,
    appToOrder?: AppToOrderSummary,
    payroll?: PayrollSummary
  ): string {
    const parts: string[] = [];

    const totalTasks = todoist.overdue.length + todoist.today.length;
    if (totalTasks > 0) {
      parts.push(`${totalTasks} tâche${totalTasks > 1 ? 's' : ''}`);
      if (todoist.overdue.length > 0) {
        parts.push(`dont ${todoist.overdue.length} en retard`);
      }
    }

    if (calendar.length > 0) {
      parts.push(`${calendar.length} événement${calendar.length > 1 ? 's' : ''} au calendrier`);
    }

    const totalSugu = sugu.reduce((sum, s) => sum + s.pendingItems, 0);
    if (totalSugu > 0) {
      parts.push(`${totalSugu} article${totalSugu > 1 ? 's' : ''} SUGU`);
    }

    if (gmail && gmail.unreadCount > 0) {
      parts.push(`${gmail.unreadCount} email${gmail.unreadCount > 1 ? 's' : ''}`);
    }

    if (sports && sports.upcomingMatches > 0) {
      parts.push(`${sports.upcomingMatches} match${sports.upcomingMatches > 1 ? 's' : ''}`);
    }

    if (appToOrder && appToOrder.todayOrders > 0) {
      parts.push(`${appToOrder.todayOrders} commandes AppToOrder`);
    }

    if (payroll && payroll.totalMonthlyCost > 0) {
      parts.push(`masse salariale: ${payroll.totalMonthlyCost.toFixed(0)}€`);
    }

    if (priorities.urgent.length > 0) {
      return `⚡ ${priorities.urgent.length} priorité${priorities.urgent.length > 1 ? 's' : ''} urgente${priorities.urgent.length > 1 ? 's' : ''}: ${parts.join(', ')}`;
    }

    return parts.length > 0 ? `Aujourd'hui: ${parts.join(', ')}` : "Journée calme, aucune urgence.";
  }

  formatBriefForChat(brief: DailyBrief): string {
    const lines: string[] = [
      `**${brief.greeting} Maurice !** 📊`,
      `*${brief.date}*`,
      ``
    ];

    if (brief.priorities.urgent.length > 0) {
      lines.push(`### ⚡ Urgent`);
      for (const item of brief.priorities.urgent) {
        lines.push(`- ${item}`);
      }
      lines.push(``);
    }

    if (brief.priorities.important.length > 0) {
      lines.push(`### 🔔 Important`);
      for (const item of brief.priorities.important) {
        lines.push(`- ${item}`);
      }
      lines.push(``);
    }

    if (brief.priorities.normal.length > 0) {
      lines.push(`### 📝 À faire`);
      for (const item of brief.priorities.normal) {
        lines.push(`- ${item}`);
      }
      lines.push(``);
    }

    if (brief.homework.length > 0) {
      lines.push(`### ⏰ Tâches automatisées`);
      for (const task of brief.homework.slice(0, 5)) {
        const time = task.nextRun.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        lines.push(`- ${task.name} à ${time}`);
      }
      lines.push(``);
    }

    if (brief.gmail && brief.gmail.unreadCount > 0) {
      lines.push(`### 📧 Gmail`);
      lines.push(`- ${brief.gmail.unreadCount} non lus (${brief.gmail.importantUnread} importants)`);
      if (brief.gmail.recentSenders.length > 0) {
        lines.push(`- Récents: ${brief.gmail.recentSenders.slice(0, 3).join(', ')}`);
      }
      lines.push(``);
    }

    if (brief.sports && brief.sports.upcomingMatches > 0) {
      lines.push(`### ⚽ Sports`);
      lines.push(`- ${brief.sports.upcomingMatches} matchs à venir, ${brief.sports.activePredictions} prédictions actives`);
      for (const r of brief.sports.recentResults) {
        lines.push(`- ${r.match}: ${r.result} ${r.correct ? '✅' : '❌'}`);
      }
      lines.push(``);
    }

    if (brief.appToOrder) {
      lines.push(`### 🛍️ AppToOrder`);
      const statusIcon = brief.appToOrder.status === "healthy" ? "🟢" : brief.appToOrder.status === "degraded" ? "🟡" : "🔴";
      lines.push(`- ${statusIcon} ${brief.appToOrder.urlsAccessible}/${brief.appToOrder.urlsTotal} URLs actives`);
      if (brief.appToOrder.todayOrders > 0) {
        lines.push(`- ${brief.appToOrder.todayOrders} commandes (${brief.appToOrder.todayRevenue.toFixed(2)}€)`);
      }
      lines.push(``);
    }

    if (brief.payroll) {
      lines.push(`### 💰 Paie & RH`);
      lines.push(`- ${brief.payroll.activeEmployees}/${brief.payroll.totalEmployees} employés actifs`);
      if (brief.payroll.totalMonthlyCost > 0) {
        lines.push(`- Masse salariale mois: ${brief.payroll.totalMonthlyCost.toFixed(0)}€ brut`);
      }
      lines.push(``);
    }

    if (brief.pugi && brief.pugi.totalSignals > 0) {
      lines.push(`### 🧠 Intelligence PUGI`);
      lines.push(`- ${brief.pugi.totalSignals} signaux actifs`);
      for (const insight of brief.pugi.topInsights) {
        lines.push(`- 💡 ${insight}`);
      }
      lines.push(``);
    }

    if (brief.systemHealth) {
      const statusIcon = brief.systemHealth.status === "healthy" ? "🟢" : brief.systemHealth.status === "degraded" ? "🟡" : "🔴";
      lines.push(`### 🏥 Santé Système`);
      lines.push(`- ${statusIcon} Score: ${brief.systemHealth.healthScore}%`);
      if (brief.systemHealth.degradedServices.length > 0) {
        lines.push(`- Dégradés: ${brief.systemHealth.degradedServices.join(', ')}`);
      }
      lines.push(``);
    }

    lines.push(`---`);
    lines.push(`*${brief.summary}*`);

    return lines.join('\n');
  }
}

export const hubService = new HubService();
