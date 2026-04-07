/**
 * Flow Service V2
 * 
 * Master flows that orchestrate multiple services:
 * - Morning Brief: system health, tasks, calendar, brain insights
 * - Sugu Mode: restaurant-focused workflow
 * - Foot/Pronos Lab: sports analysis workflow
 * - Trading Brief: market overview, watchlist, positions, insights
 */

import { systemMetricsService } from "./systemMetricsService";
import { brainContextService } from "./brainContextService";
import { decisionEngineService } from "./decisionEngineService";
import { diagnosticsService } from "./diagnostics";
import { calendarService } from "./googleCalendarService";
import { brainService } from "./brainService";
import { contextOptimizerService } from "./context/optimizer";
import { globalOptimizerService } from "./globalOptimizerService";
import { db } from "../db";
import { tasks, knowledgeBase, ulysseMemory, projectMemory } from "@shared/schema";
import { eq, and, desc, gte, isNull, or, sql } from "drizzle-orm";
import { PersonaType, DomainType, getPersonaProfile } from "../config/personaMapping";

const LOG_PREFIX = "[FlowService]";

export interface FlowResult {
  flowName: string;
  success: boolean;
  sections: FlowSection[];
  suggestedActions: SuggestedAction[];
  audioPrompt?: string;
  timestamp: Date;
}

export interface FlowSection {
  title: string;
  type: "info" | "warning" | "action" | "insight";
  content: string;
  items?: string[];
  priority?: number;
}

export interface SuggestedAction {
  action: string;
  description: string;
  domain: DomainType;
  confidence: number;
  canExecuteAutonomously: boolean;
}

export interface FlowTrigger {
  type: "manual" | "geofence" | "schedule" | "voice";
  location?: string;
  command?: string;
}

class FlowService {

  async executeFlow(userId: number, flowName: string, persona: PersonaType = "ulysse"): Promise<FlowResult> {
    console.log(`${LOG_PREFIX} Dispatching flow: ${flowName}`);
    
    switch (flowName) {
      case "morning_brief":
        return this.executeMorningBrief(userId, persona);
      case "sugu_mode":
        return this.executeSuguMode(userId);
      case "foot_pronos_lab":
        return this.executeFootPronosLab(userId);
      case "trading_brief":
        return this.executeTradingBrief(userId);
      default:
        console.warn(`${LOG_PREFIX} Unknown flow: ${flowName}`);
        return {
          flowName,
          success: false,
          sections: [],
          suggestedActions: [],
          audioPrompt: `Flow ${flowName} non reconnu`,
          timestamp: new Date()
        };
    }
  }

  async executeMorningBrief(userId: number, persona: PersonaType = "ulysse"): Promise<FlowResult> {
    console.log(`${LOG_PREFIX} Executing Morning Brief for user ${userId}`);
    
    const sections: FlowSection[] = [];
    const suggestedActions: SuggestedAction[] = [];
    const profile = getPersonaProfile(persona);
    
    // Use globalOptimizerService.parallelFetch for 2x efficiency
    const parallelData = await globalOptimizerService.parallelFetch({
      systemStatus: () => systemMetricsService.getMetrics(userId),
      diagnostics: () => this.getSystemDiagnostics(userId),
      todayTasks: () => this.getTodayTasks(userId),
      calendarEvents: () => this.getTodayCalendar(userId),
      brainInsight: () => this.getRecentBrainInsight(userId),
      optimizedContext: () => contextOptimizerService.getFullContext(userId)
    });
    
    const { systemStatus, diagnostics, todayTasks, calendarEvents, brainInsight, optimizedContext } = parallelData;
    
    if (optimizedContext.insights.length > 0) {
      const proactiveItems = optimizedContext.insights.slice(0, 3).map(i => `[${i.domain.toUpperCase()}] ${i.message}`);
      sections.push({
        title: "Alertes proactives",
        type: "warning",
        content: `${optimizedContext.insights.length} point(s) d'attention`,
        items: proactiveItems,
        priority: 1
      });
      
      for (const insight of optimizedContext.insights.filter(i => i.actionable && i.suggestedAction)) {
        suggestedActions.push({
          action: insight.suggestedAction!,
          description: insight.message,
          domain: insight.domain as DomainType,
          confidence: 100 - insight.priority * 10,
          canExecuteAutonomously: false
        });
      }
    }
    
    sections.push({
      title: "Etat du systeme",
      type: systemStatus.status === "healthy" ? "info" : "warning",
      content: `Sante: ${systemStatus.healthScore}% | Intelligence: ${systemStatus.intelligenceScore}%`,
      items: diagnostics.issues.length > 0 
        ? diagnostics.issues.slice(0, 3)
        : ["Tous les systemes operationnels"],
      priority: systemStatus.status === "critical" ? 1 : 3
    });
    
    if (todayTasks.length > 0) {
      const tasksByDomain = this.groupTasksByDomain(todayTasks);
      
      const priorityTasks: string[] = [];
      for (const domain of profile.primaryDomains.slice(0, 3)) {
        const domainTasks = tasksByDomain[domain] || [];
        if (domainTasks.length > 0) {
          priorityTasks.push(`[${domain.toUpperCase()}] ${domainTasks[0].title}`);
        }
      }
      
      sections.push({
        title: "Taches prioritaires",
        type: "action",
        content: `${todayTasks.length} taches pour aujourd'hui`,
        items: priorityTasks.slice(0, 3),
        priority: 2
      });
    }
    
    if (calendarEvents.length > 0) {
      sections.push({
        title: "Agenda du jour",
        type: "info",
        content: `${calendarEvents.length} evenement(s) prevu(s)`,
        items: calendarEvents.map(e => `${e.time} - ${e.title}`).slice(0, 5),
        priority: 2
      });
    }
    
    if (brainInsight) {
      sections.push({
        title: "Insight recent",
        type: "insight",
        content: brainInsight.title,
        items: [brainInsight.summary || brainInsight.content.slice(0, 150)],
        priority: 4
      });
    }
    
    if (profile.behaviorTraits.canSuggestActions) {
      if (diagnostics.improvements.length > 0) {
        suggestedActions.push({
          action: "apply_improvement",
          description: diagnostics.improvements[0],
          domain: "general",
          confidence: 80,
          canExecuteAutonomously: profile.behaviorTraits.canExecuteAutonomously
        });
      }
      
      if (todayTasks.length > 0) {
        suggestedActions.push({
          action: "start_priority_task",
          description: `Commencer: ${todayTasks[0].title}`,
          domain: "perso",
          confidence: 90,
          canExecuteAutonomously: false
        });
      }
    }
    
    const audioPrompt = this.generateMorningAudioPrompt(sections, profile.displayName);
    
    return {
      flowName: "morning_brief",
      success: true,
      sections: sections.sort((a, b) => (a.priority || 5) - (b.priority || 5)),
      suggestedActions,
      audioPrompt,
      timestamp: new Date()
    };
  }

  async executeSuguMode(userId: number, trigger: FlowTrigger): Promise<FlowResult> {
    console.log(`${LOG_PREFIX} Executing Sugu Mode for user ${userId}`);
    
    const sections: FlowSection[] = [];
    const suggestedActions: SuggestedAction[] = [];
    
    const [brainContext, suguTasks, suguKnowledge] = await Promise.all([
      brainContextService.getDomainBrief(userId, "sugu", "ulysse"),
      this.getDomainTasks(userId, "sugu"),
      this.getDomainKnowledge(userId, "sugu")
    ]);
    
    if (brainContext.warnings.length > 0) {
      sections.push({
        title: "Alertes SUGU",
        type: "warning",
        content: `${brainContext.warnings.length} alerte(s) detectee(s)`,
        items: brainContext.warnings,
        priority: 1
      });
    }
    
    if (brainContext.recentInsights.length > 0) {
      sections.push({
        title: "Dernieres observations",
        type: "insight",
        content: "Analyses recentes du restaurant",
        items: brainContext.recentInsights.slice(0, 3),
        priority: 2
      });
    }
    
    if (suguTasks.length > 0) {
      sections.push({
        title: "Taches SUGU",
        type: "action",
        content: `${suguTasks.length} tache(s) en attente`,
        items: suguTasks.map(t => t.title).slice(0, 5),
        priority: 2
      });
      
      suggestedActions.push({
        action: "complete_sugu_task",
        description: `Faire: ${suguTasks[0].title}`,
        domain: "sugu",
        confidence: 85,
        canExecuteAutonomously: false
      });
    }
    
    if (suguKnowledge.length > 0) {
      const anomalies = suguKnowledge.filter(k => 
        k.title.toLowerCase().includes("anomalie") || 
        k.title.toLowerCase().includes("probleme")
      );
      
      if (anomalies.length > 0) {
        sections.push({
          title: "Points d'attention",
          type: "warning",
          content: "Elements necessitant une action",
          items: anomalies.map(a => a.title).slice(0, 3),
          priority: 1
        });
      }
    }
    
    suggestedActions.push(
      {
        action: "check_inventory",
        description: "Vérifier les stocks critiques",
        domain: "sugu",
        confidence: 75,
        canExecuteAutonomously: false
      },
      {
        action: "review_orders",
        description: "Revoir les commandes en cours",
        domain: "sugu",
        confidence: 70,
        canExecuteAutonomously: false
      }
    );
    
    const audioPrompt = `Mode SUGU activé. ${sections.length} sections à consulter. ${suguTasks.length} tâches en attente.`;
    
    return {
      flowName: "sugu_mode",
      success: true,
      sections: sections.sort((a, b) => (a.priority || 5) - (b.priority || 5)),
      suggestedActions,
      audioPrompt,
      timestamp: new Date()
    };
  }

  async executeFootPronosLab(userId: number): Promise<FlowResult> {
    console.log(`${LOG_PREFIX} Executing Foot/Pronos Lab for user ${userId}`);
    
    const sections: FlowSection[] = [];
    const suggestedActions: SuggestedAction[] = [];
    
    const [brainContext, footTasks, bettingRules, recentPerformance] = await Promise.all([
      brainContextService.getDomainBrief(userId, "foot", "ulysse"),
      this.getDomainTasks(userId, "foot"),
      this.getBettingRules(userId),
      this.getRecentBettingPerformance(userId)
    ]);
    
    if (bettingRules.length > 0) {
      sections.push({
        title: "Ton cadre de jeu",
        type: "info",
        content: "Regles definies pour les paris",
        items: bettingRules.slice(0, 4),
        priority: 1
      });
    }
    
    if (recentPerformance) {
      sections.push({
        title: "Performance recente",
        type: recentPerformance.profitLoss >= 0 ? "info" : "warning",
        content: `Bilan: ${recentPerformance.profitLoss >= 0 ? "+" : ""}${recentPerformance.profitLoss}EUR`,
        items: [
          `Taux de reussite: ${recentPerformance.winRate}%`,
          `Derniers paris: ${recentPerformance.recentBets} (${recentPerformance.wins}W/${recentPerformance.losses}L)`,
          ...recentPerformance.patterns.slice(0, 2)
        ],
        priority: 2
      });
    }
    
    if (brainContext.recentInsights.length > 0) {
      sections.push({
        title: "Ce que tu as appris",
        type: "insight",
        content: "Patterns et apprentissages recents",
        items: brainContext.recentInsights.slice(0, 3),
        priority: 3
      });
    }
    
    if (footTasks.length > 0) {
      sections.push({
        title: "Analyses en cours",
        type: "action",
        content: `${footTasks.length} analyse(s) a faire`,
        items: footTasks.map(t => t.title).slice(0, 3),
        priority: 3
      });
    }
    
    suggestedActions.push(
      {
        action: "analyze_matches",
        description: "Analyser les matchs du week-end",
        domain: "foot",
        confidence: 90,
        canExecuteAutonomously: false
      },
      {
        action: "check_odds",
        description: "Vérifier les cotes actuelles",
        domain: "pronos",
        confidence: 85,
        canExecuteAutonomously: false
      },
      {
        action: "review_predictions",
        description: "Revoir les prédictions passées",
        domain: "pronos",
        confidence: 70,
        canExecuteAutonomously: false
      }
    );
    
    const audioPrompt = `Mode Pronos Lab activé. ${bettingRules.length > 0 ? "Rappel de ton cadre de jeu inclus." : ""} Prêt pour l'analyse.`;
    
    return {
      flowName: "foot_pronos_lab",
      success: true,
      sections: sections.sort((a, b) => (a.priority || 5) - (b.priority || 5)),
      suggestedActions,
      audioPrompt,
      timestamp: new Date()
    };
  }

  private async getSystemDiagnostics(userId: number): Promise<{
    issues: string[];
    improvements: string[];
  }> {
    try {
      const diag = await diagnosticsService.runFullDiagnostic(userId);
      return {
        issues: diag.issues || [],
        improvements: diag.improvements || []
      };
    } catch (error) {
      return { issues: [], improvements: [] };
    }
  }

  private async getTodayTasks(userId: number): Promise<{ id: number; title: string; context?: string }[]> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const result = await db.select({
        id: tasks.id,
        title: tasks.title,
        context: tasks.context
      })
      .from(tasks)
      .where(and(
        eq(tasks.userId, userId),
        eq(tasks.completed, false),
        or(
          isNull(tasks.dueDate),
          sql`${tasks.dueDate} < ${tomorrow}`
        )
      ))
      .orderBy(desc(tasks.priority))
      .limit(10);
      
      return result.map(t => ({
        id: t.id,
        title: t.title,
        context: t.context || undefined
      }));
    } catch (error) {
      console.error(`${LOG_PREFIX} getTodayTasks error:`, error);
      return [];
    }
  }

  private async getTodayCalendar(userId: number): Promise<{ time: string; title: string }[]> {
    try {
      const events = await calendarService.getTodayEvents(userId);
      return events.map((e: any) => ({
        time: new Date(e.start).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
        title: e.summary || e.title || "Sans titre"
      })).slice(0, 5);
    } catch (error) {
      console.error(`${LOG_PREFIX} getTodayCalendar error:`, error);
      return [];
    }
  }

  private async getRecentBrainInsight(userId: number): Promise<{
    title: string;
    summary?: string;
    content: string;
  } | null> {
    try {
      const [insight] = await db.select()
        .from(knowledgeBase)
        .where(and(
          eq(knowledgeBase.userId, userId),
          eq(knowledgeBase.type, "insight")
        ))
        .orderBy(desc(knowledgeBase.createdAt))
        .limit(1);
      
      return insight || null;
    } catch (error) {
      return null;
    }
  }

  private async getDomainTasks(userId: number, domain: string): Promise<{ id: number; title: string }[]> {
    try {
      const result = await db.select({
        id: tasks.id,
        title: tasks.title
      })
      .from(tasks)
      .where(and(
        eq(tasks.userId, userId),
        eq(tasks.completed, false),
        sql`LOWER(${tasks.context}) LIKE ${`%${domain.toLowerCase()}%`}`
      ))
      .orderBy(desc(tasks.priority))
      .limit(5);
      
      return result;
    } catch (error) {
      return [];
    }
  }

  private async getDomainKnowledge(userId: number, domain: string): Promise<typeof knowledgeBase.$inferSelect[]> {
    try {
      return db.select()
        .from(knowledgeBase)
        .where(and(
          eq(knowledgeBase.userId, userId),
          or(
            eq(knowledgeBase.category, "work"),
            sql`LOWER(${knowledgeBase.title}) LIKE ${`%${domain.toLowerCase()}%`}`
          )
        ))
        .orderBy(desc(knowledgeBase.importance))
        .limit(10);
    } catch (error) {
      return [];
    }
  }

  private async getBettingRules(userId: number): Promise<string[]> {
    try {
      const memories = await db.select()
        .from(ulysseMemory)
        .where(and(
          eq(ulysseMemory.userId, userId),
          or(
            sql`LOWER(${ulysseMemory.key}) LIKE '%bankroll%'`,
            sql`LOWER(${ulysseMemory.key}) LIKE '%pari%'`,
            sql`LOWER(${ulysseMemory.key}) LIKE '%bet%'`,
            sql`LOWER(${ulysseMemory.key}) LIKE '%règle%'`
          )
        ))
        .limit(5);
      
      return memories.map(m => `${m.key}: ${m.value}`);
    } catch (error) {
      return [];
    }
  }

  private async getRecentBettingPerformance(userId: number): Promise<{
    profitLoss: number;
    winRate: number;
    recentBets: number;
    wins: number;
    losses: number;
    patterns: string[];
  } | null> {
    try {
      const knowledge = await db.select()
        .from(knowledgeBase)
        .where(and(
          eq(knowledgeBase.userId, userId),
          eq(knowledgeBase.category, "sports"),
          or(
            sql`LOWER(${knowledgeBase.title}) LIKE '%performance%'`,
            sql`LOWER(${knowledgeBase.title}) LIKE '%bilan%'`
          )
        ))
        .orderBy(desc(knowledgeBase.createdAt))
        .limit(1);
      
      if (knowledge.length === 0) {
        return {
          profitLoss: 0,
          winRate: 50,
          recentBets: 0,
          wins: 0,
          losses: 0,
          patterns: []
        };
      }
      
      return {
        profitLoss: 0,
        winRate: 50,
        recentBets: 0,
        wins: 0,
        losses: 0,
        patterns: ["Données en cours d'analyse"]
      };
    } catch (error) {
      return null;
    }
  }

  private groupTasksByDomain(tasks: { id: number; title: string; context?: string }[]): Record<string, typeof tasks> {
    const groups: Record<string, typeof tasks> = {};
    
    for (const task of tasks) {
      const context = task.context?.toLowerCase() || "";
      let domain = "perso";
      
      if (context.includes("sugu")) domain = "sugu";
      else if (context.includes("foot") || context.includes("sport")) domain = "foot";
      else if (context.includes("trading") || context.includes("bourse")) domain = "trading";
      else if (context.includes("famille")) domain = "famille";
      
      if (!groups[domain]) groups[domain] = [];
      groups[domain].push(task);
    }
    
    return groups;
  }

  private generateMorningAudioPrompt(sections: FlowSection[], userName: string): string {
    const lines: string[] = [`Bonjour ${userName} !`];
    
    const systemSection = sections.find(s => s.title.includes("système"));
    if (systemSection && systemSection.type === "warning") {
      lines.push("Attention, le système a quelques alertes à te montrer.");
    } else {
      lines.push("Tous les systèmes sont opérationnels.");
    }
    
    const taskSection = sections.find(s => s.title.includes("Tâches"));
    if (taskSection && taskSection.items && taskSection.items.length > 0) {
      lines.push(`Tu as ${taskSection.items.length} tâches prioritaires aujourd'hui.`);
    }
    
    const calendarSection = sections.find(s => s.title.includes("Agenda"));
    if (calendarSection && calendarSection.items && calendarSection.items.length > 0) {
      lines.push(`${calendarSection.items.length} événements à ton agenda.`);
    }
    
    lines.push("Consulte le brief complet pour les détails.");
    
    return lines.join(" ");
  }

  async detectFlowFromContext(
    userId: number,
    context: { location?: string; command?: string; timeOfDay?: string }
  ): Promise<{ suggestedFlow: string | null; confidence: number; reason: string }> {
    
    if (context.command) {
      const cmd = context.command.toLowerCase();
      
      if (cmd.includes("matin") || cmd.includes("brief") || cmd.includes("journée")) {
        return { suggestedFlow: "morning_brief", confidence: 95, reason: "Commande vocale détectée" };
      }
      
      if (cmd.includes("sugu") || cmd.includes("resto") || cmd.includes("restaurant")) {
        return { suggestedFlow: "sugu_mode", confidence: 95, reason: "Commande vocale détectée" };
      }
      
      if (cmd.includes("foot") || cmd.includes("match") || cmd.includes("pronos") || cmd.includes("paris")) {
        return { suggestedFlow: "foot_pronos_lab", confidence: 95, reason: "Commande vocale detectee" };
      }
      
      if (cmd.includes("trading") || cmd.includes("marche") || cmd.includes("bourse") || cmd.includes("actions")) {
        return { suggestedFlow: "trading_brief", confidence: 95, reason: "Commande vocale detectee" };
      }
    }
    
    if (context.location) {
      const loc = context.location.toLowerCase();
      
      if (loc.includes("sugu") || loc.includes("maillane") || loc.includes("restaurant")) {
        return { suggestedFlow: "sugu_mode", confidence: 85, reason: "Géofence SUGU détecté" };
      }
    }
    
    if (context.timeOfDay) {
      const hour = parseInt(context.timeOfDay.split(":")[0]);
      
      if (hour >= 6 && hour <= 9) {
        return { suggestedFlow: "morning_brief", confidence: 70, reason: "Heure matinale détectée" };
      }
    }
    
    return { suggestedFlow: null, confidence: 0, reason: "Aucun flow suggere" };
  }

  async executeTradingBrief(userId: number): Promise<FlowResult> {
    console.log(`${LOG_PREFIX} Executing Trading Brief for user ${userId}`);
    
    const sections: FlowSection[] = [];
    const suggestedActions: SuggestedAction[] = [];
    
    const [brainContext, tradingTasks, tradingRules, watchlist] = await Promise.all([
      brainContextService.getDomainBrief(userId, "trading", "ulysse"),
      this.getDomainTasks(userId, "trading"),
      this.getTradingRules(userId),
      this.getWatchlist(userId)
    ]);
    
    sections.push({
      title: "Vue marche globale",
      type: "info",
      content: "Indices et actifs principaux",
      items: [
        "S&P 500, NASDAQ, DAX, CAC 40",
        "Or (XAU), Petrole (WTI)",
        "BTC/USD, ETH/USD"
      ],
      priority: 1
    });
    
    if (tradingRules.length > 0) {
      sections.push({
        title: "Tes regles de trading",
        type: "info",
        content: "Discipline et risk management",
        items: tradingRules.slice(0, 4),
        priority: 2
      });
    }
    
    if (watchlist.length > 0) {
      sections.push({
        title: "Instruments suivis",
        type: "action",
        content: `${watchlist.length} actif(s) dans ta watchlist`,
        items: watchlist.map(w => `${w.symbol}: ${w.signal || "a analyser"}`).slice(0, 5),
        priority: 2
      });
    }
    
    if (brainContext.recentInsights.length > 0) {
      sections.push({
        title: "Insights et discipline",
        type: "insight",
        content: "Apprentissages recents",
        items: brainContext.recentInsights.slice(0, 3),
        priority: 3
      });
    }
    
    if (tradingTasks.length > 0) {
      sections.push({
        title: "Analyses en cours",
        type: "action",
        content: `${tradingTasks.length} tache(s) trading`,
        items: tradingTasks.map(t => t.title).slice(0, 3),
        priority: 3
      });
    }
    
    if (brainContext.warnings.length > 0) {
      sections.push({
        title: "Points d'attention",
        type: "warning",
        content: "Alertes et rappels",
        items: brainContext.warnings.slice(0, 3),
        priority: 1
      });
    }
    
    suggestedActions.push(
      {
        action: "analyze_instrument",
        description: "Analyser un instrument specifique",
        domain: "trading" as DomainType,
        confidence: 90,
        canExecuteAutonomously: false
      },
      {
        action: "review_scenarios",
        description: "Revoir les scenarios actifs",
        domain: "trading" as DomainType,
        confidence: 85,
        canExecuteAutonomously: false
      },
      {
        action: "update_rules",
        description: "Mettre a jour les regles de trading",
        domain: "trading" as DomainType,
        confidence: 70,
        canExecuteAutonomously: false
      }
    );
    
    const audioPrompt = `Mode Trading active. ${watchlist.length > 0 ? `Tu as ${watchlist.length} instruments a suivre.` : ""} ${tradingRules.length > 0 ? "Rappel de tes regles inclus." : ""} Pret pour l'analyse.`;
    
    return {
      flowName: "trading_brief",
      success: true,
      sections: sections.sort((a, b) => (a.priority || 5) - (b.priority || 5)),
      suggestedActions,
      audioPrompt,
      timestamp: new Date()
    };
  }

  private async getTradingRules(userId: number): Promise<string[]> {
    try {
      const memories = await db.select()
        .from(ulysseMemory)
        .where(and(
          eq(ulysseMemory.userId, userId),
          or(
            sql`LOWER(${ulysseMemory.key}) LIKE '%trading%'`,
            sql`LOWER(${ulysseMemory.key}) LIKE '%risk%'`,
            sql`LOWER(${ulysseMemory.key}) LIKE '%position%'`,
            sql`LOWER(${ulysseMemory.key}) LIKE '%stop%'`,
            sql`LOWER(${ulysseMemory.key}) LIKE '%take%profit%'`
          )
        ))
        .limit(5);
      
      return memories.map(m => `${m.key}: ${m.value}`);
    } catch (error) {
      return [];
    }
  }

  private async getWatchlist(userId: number): Promise<{ symbol: string; signal?: string }[]> {
    try {
      const watchlistMemory = await db.select()
        .from(ulysseMemory)
        .where(and(
          eq(ulysseMemory.userId, userId),
          sql`LOWER(${ulysseMemory.key}) LIKE '%watchlist%'`
        ))
        .limit(1);
      
      if (watchlistMemory.length > 0) {
        try {
          return JSON.parse(watchlistMemory[0].value);
        } catch {
          return [];
        }
      }
      
      const tradingKnowledge = await db.select()
        .from(knowledgeBase)
        .where(and(
          eq(knowledgeBase.userId, userId),
          eq(knowledgeBase.category, "trading"),
          sql`LOWER(${knowledgeBase.title}) LIKE '%suivi%' OR LOWER(${knowledgeBase.title}) LIKE '%watch%'`
        ))
        .limit(5);
      
      return tradingKnowledge.map(k => ({ symbol: k.title, signal: undefined }));
    } catch (error) {
      return [];
    }
  }
}

export const flowService = new FlowService();
