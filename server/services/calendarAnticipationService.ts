import { calendarService, CalendarEvent } from "./googleCalendarService";
import { db } from "../db";
import { ulysseHomework } from "@shared/schema";
import { eq, and, gte, lte } from "drizzle-orm";

export interface CalendarAnticipation {
  eventId: string;
  eventSummary: string;
  eventStart: string;
  anticipationType: string;
  suggestion: string;
  priority: "low" | "medium" | "high";
  daysUntil: number;
}

const ANTICIPATION_RULES: Array<{
  keywords: string[];
  type: string;
  suggestion: string;
  priority: "low" | "medium" | "high";
  minDaysAhead: number;
}> = [
  {
    keywords: ["comptable", "expert-comptable", "cabinet comptable", "bilan", "commissaire"],
    type: "financial_report",
    suggestion: "Préparer le rapport financier SUGU (achats, CA, trésorerie) pour le RDV comptable",
    priority: "high",
    minDaysAhead: 1,
  },
  {
    keywords: ["banque", "banquier", "crédit", "prêt", "emprunt"],
    type: "bank_meeting",
    suggestion: "Préparer le dossier financier (relevés, emprunts en cours, prévisions) pour le RDV bancaire",
    priority: "high",
    minDaysAhead: 1,
  },
  {
    keywords: ["réunion", "meeting", "point", "sync", "stand-up", "standup"],
    type: "meeting_prep",
    suggestion: "Préparer un résumé des sujets en cours et points à aborder",
    priority: "medium",
    minDaysAhead: 0,
  },
  {
    keywords: ["livraison", "fournisseur", "commande", "metro", "pomona", "transgourmet"],
    type: "delivery_prep",
    suggestion: "Vérifier la liste de courses et préparer l'espace de stockage pour la livraison",
    priority: "medium",
    minDaysAhead: 0,
  },
  {
    keywords: ["médecin", "docteur", "rdv médical", "dentiste", "kiné", "ophtalmo"],
    type: "medical_reminder",
    suggestion: "Préparer les documents médicaux nécessaires (carte vitale, mutuelle, ordonnances)",
    priority: "medium",
    minDaysAhead: 0,
  },
  {
    keywords: ["formation", "cours", "stage", "certification"],
    type: "training_prep",
    suggestion: "Réviser les prérequis et préparer le matériel pour la formation",
    priority: "medium",
    minDaysAhead: 1,
  },
  {
    keywords: ["inspection", "contrôle", "hygiène", "haccp", "sanitaire"],
    type: "inspection_prep",
    suggestion: "Vérifier la conformité HACCP, températures, et documents obligatoires avant l'inspection",
    priority: "high",
    minDaysAhead: 1,
  },
  {
    keywords: ["anniversaire", "fête", "célébration"],
    type: "celebration_reminder",
    suggestion: "Penser à préparer un cadeau ou un message pour l'occasion",
    priority: "low",
    minDaysAhead: 1,
  },
];

function matchesRule(event: CalendarEvent, rule: typeof ANTICIPATION_RULES[0]): boolean {
  const text = `${event.summary} ${event.description || ""}`.toLowerCase();
  return rule.keywords.some(kw => text.includes(kw.toLowerCase()));
}

function getDaysUntil(eventStart: string): number {
  const now = new Date();
  const start = new Date(eventStart);
  const diffMs = start.getTime() - now.getTime();
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

function isEndOfMonth(daysAhead: number): boolean {
  const target = new Date();
  target.setDate(target.getDate() + daysAhead);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return target.getDate() >= lastDay - 2;
}

class CalendarAnticipationService {
  async getUpcomingActions(userId: number, daysAhead: number = 3): Promise<CalendarAnticipation[]> {
    const anticipations: CalendarAnticipation[] = [];

    try {
      const events = await calendarService.getUpcomingEvents(userId, daysAhead);

      for (const event of events) {
        const daysUntil = getDaysUntil(event.start);

        for (const rule of ANTICIPATION_RULES) {
          if (matchesRule(event, rule) && daysUntil >= rule.minDaysAhead) {
            anticipations.push({
              eventId: event.id,
              eventSummary: event.summary,
              eventStart: event.start,
              anticipationType: rule.type,
              suggestion: rule.suggestion,
              priority: rule.priority,
              daysUntil,
            });
          }
        }
      }
    } catch (err) {
      console.warn("[CalendarAnticipation] Failed to fetch calendar events:", err);
    }

    for (let d = 0; d <= daysAhead; d++) {
      if (isEndOfMonth(d)) {
        anticipations.push({
          eventId: `end-of-month-${d}`,
          eventSummary: "Fin de mois",
          eventStart: new Date(Date.now() + d * 24 * 60 * 60 * 1000).toISOString(),
          anticipationType: "end_of_month_bilan",
          suggestion: "Générer le bilan SUGU de fin de mois (CA, achats, trésorerie, comparaison M-1)",
          priority: "high",
          daysUntil: d,
        });
        break;
      }
    }

    try {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + daysAhead);

      const dueHomework = await db
        .select()
        .from(ulysseHomework)
        .where(
          and(
            eq(ulysseHomework.userId, userId),
            eq(ulysseHomework.status, "pending"),
            lte(ulysseHomework.dueDate, futureDate),
            gte(ulysseHomework.dueDate, new Date())
          )
        )
        .limit(10);

      for (const hw of dueHomework) {
        if (hw.dueDate) {
          const daysUntil = getDaysUntil(hw.dueDate.toISOString());
          anticipations.push({
            eventId: `homework-${hw.id}`,
            eventSummary: hw.title,
            eventStart: hw.dueDate.toISOString(),
            anticipationType: "homework_deadline",
            suggestion: `Tâche "${hw.title}" arrive à échéance — vérifier l'avancement`,
            priority: daysUntil <= 1 ? "high" : "medium",
            daysUntil,
          });
        }
      }
    } catch (err) {
      console.warn("[CalendarAnticipation] Failed to check homework deadlines:", err);
    }

    anticipations.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      return a.daysUntil - b.daysUntil;
    });

    return anticipations;
  }

  async generateAnticipations(userId: number): Promise<CalendarAnticipation[]> {
    return this.getUpcomingActions(userId, 3);
  }

  formatForBriefing(anticipations: CalendarAnticipation[]): string {
    if (anticipations.length === 0) {
      return "Aucune anticipation calendrier.";
    }

    const lines: string[] = [];
    for (const a of anticipations.slice(0, 6)) {
      const timeLabel = a.daysUntil === 0 ? "Aujourd'hui" : a.daysUntil === 1 ? "Demain" : `Dans ${a.daysUntil}j`;
      const priorityIcon = a.priority === "high" ? "!!" : a.priority === "medium" ? "!" : "";
      lines.push(`${priorityIcon} [${timeLabel}] ${a.eventSummary}: ${a.suggestion}`);
    }
    return lines.join("\n");
  }

  formatForBrain(anticipations: CalendarAnticipation[]): string | null {
    if (anticipations.length === 0) return null;

    const highPriority = anticipations.filter(a => a.priority === "high");
    const parts: string[] = [];

    if (highPriority.length > 0) {
      parts.push(`Priorités: ${highPriority.map(a => a.suggestion).join("; ")}`);
    }

    const todayActions = anticipations.filter(a => a.daysUntil === 0);
    if (todayActions.length > 0) {
      parts.push(`Actions aujourd'hui: ${todayActions.map(a => a.eventSummary).join(", ")}`);
    }

    if (parts.length === 0) return null;
    return `[Anticipation Calendrier] ${parts.join(" | ")}`;
  }
}

export const calendarAnticipationService = new CalendarAnticipationService();
