import { db } from "../db";
import { brainHub } from "./sensory/BrainHub";
import { broadcastToUser } from "./realtimeSync";
import { cleanupRegistry } from "./core/cleanupRegistry.js";

const LOG = "[PUGI]";

export type PugiDomain = "sugu" | "sports" | "calendar" | "finance" | "personal" | "system" | "weather" | "email" | "learning";

export type SignalPriority = "critical" | "high" | "medium" | "low" | "info";

export interface ProactiveSignal {
  id: string;
  domain: PugiDomain;
  source: string;
  title: string;
  description: string;
  priority: SignalPriority;
  score: number;
  tags: string[];
  createdAt: number;
  expiresAt?: number;
  actionable: boolean;
  suggestedAction?: string;
  suggestedTools?: string[];
  relatedSignals?: string[];
  metadata?: Record<string, unknown>;
}

export interface CrossDomainInsight {
  id: string;
  title: string;
  description: string;
  domains: PugiDomain[];
  sourceSignals: string[];
  priority: SignalPriority;
  score: number;
  createdAt: number;
  actionable: boolean;
  suggestedAction?: string;
}

export interface PugiDigest {
  timestamp: number;
  signals: ProactiveSignal[];
  insights: CrossDomainInsight[];
  topActions: ProactiveSignal[];
  stats: {
    totalSignals: number;
    byDomain: Record<string, number>;
    byPriority: Record<string, number>;
    crossDomainInsights: number;
    feedbackAcceptRate: number;
  };
}

interface FeedbackRecord {
  signalId: string;
  action: "accepted" | "dismissed" | "snoozed" | "acted";
  domain: PugiDomain;
  timestamp: number;
}

interface TimingRule {
  domain: PugiDomain;
  allowedHours: number[];
  boostHours: number[];
  suppressHours: number[];
}

const TIMING_RULES: TimingRule[] = [
  { domain: "sugu", allowedHours: [7,8,9,10,11,12,13,14,15,16,17,18,19,20,21], boostHours: [8,9,10], suppressHours: [0,1,2,3,4,5,6,22,23] },
  { domain: "sports", allowedHours: [10,11,12,13,14,15,16,17,18,19,20,21,22,23], boostHours: [18,19,20,21], suppressHours: [0,1,2,3,4,5,6,7,8,9] },
  { domain: "calendar", allowedHours: [7,8,9,10,11,12,13,14,15,16,17,18,19,20], boostHours: [7,8,9], suppressHours: [0,1,2,3,4,5,6,22,23] },
  { domain: "finance", allowedHours: [8,9,10,11,12,13,14,15,16,17,18], boostHours: [9,10], suppressHours: [0,1,2,3,4,5,6,7,19,20,21,22,23] },
  { domain: "personal", allowedHours: [7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22], boostHours: [8,9,19,20], suppressHours: [0,1,2,3,4,5,6,23] },
  { domain: "system", allowedHours: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23], boostHours: [], suppressHours: [] },
  { domain: "weather", allowedHours: [6,7,8,9,10,11,12,13,14,15,16,17,18,19,20], boostHours: [7,8], suppressHours: [0,1,2,3,4,5,21,22,23] },
  { domain: "email", allowedHours: [7,8,9,10,11,12,13,14,15,16,17,18,19,20], boostHours: [8,9,10], suppressHours: [0,1,2,3,4,5,6,22,23] },
  { domain: "learning", allowedHours: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23], boostHours: [2,3,4], suppressHours: [] },
];

const CROSS_DOMAIN_RULES: Array<{
  name: string;
  domains: [PugiDomain, PugiDomain];
  tagMatch: [string[], string[]];
  insightTemplate: (s1: ProactiveSignal, s2: ProactiveSignal) => string;
  priority: SignalPriority;
  actionTemplate?: (s1: ProactiveSignal, s2: ProactiveSignal) => string;
}> = [
  {
    name: "comptable_meeting_unpaid",
    domains: ["calendar", "sugu"],
    tagMatch: [["comptable", "accountant", "expert"], ["unpaid", "overdue", "impayé"]],
    insightTemplate: (s1, s2) => `Rendez-vous comptable détecté ("${s1.title}") + ${s2.title} — Préparer la liste des factures impayées et le rapport financier avant le RDV.`,
    priority: "critical",
    actionTemplate: () => "Générer le rapport financier avec les factures impayées pour le RDV comptable",
  },
  {
    name: "bank_meeting_treasury",
    domains: ["calendar", "sugu"],
    tagMatch: [["banque", "bank", "crédit"], ["treasury", "trésorerie", "forecast"]],
    insightTemplate: (s1, s2) => `RDV bancaire à venir ("${s1.title}") + prévision trésorerie disponible — Préparer le dossier financier avec les projections.`,
    priority: "high",
    actionTemplate: () => "Préparer dossier bancaire avec prévision trésorerie et bilan",
  },
  {
    name: "end_month_sugu_reconcile",
    domains: ["calendar", "sugu"],
    tagMatch: [["fin-de-mois", "end-month", "bilan"], ["reconciliation", "rapprochement"]],
    insightTemplate: (_, s2) => `Fin de mois approche + suggestions de rapprochement bancaire en attente — Profiter pour valider les rapprochements avant clôture.`,
    priority: "high",
    actionTemplate: () => "Valider les rapprochements bancaires avant clôture mensuelle",
  },
  {
    name: "sports_weekend_research",
    domains: ["sports", "calendar"],
    tagMatch: [["value-bet", "pronostic", "weekend"], ["weekend", "samedi", "dimanche"]],
    insightTemplate: (s1, _) => `Weekend libre détecté + analyses sportives disponibles — ${s1.title}`,
    priority: "medium",
  },
  {
    name: "sugu_anomaly_kpi_health",
    domains: ["sugu", "system"],
    tagMatch: [["anomaly", "anomalie", "alert"], ["health", "kpi", "degraded"]],
    insightTemplate: (s1, s2) => `Anomalie SUGU ("${s1.title}") détectée en même temps qu'une dégradation système ("${s2.title}") — Vérifier que les données sont fiables avant d'agir.`,
    priority: "high",
  },
  {
    name: "mood_frustrated_sugu_issue",
    domains: ["personal", "sugu"],
    tagMatch: [["frustrated", "stressed", "mood"], ["alert", "anomaly", "unpaid"]],
    insightTemplate: (s1, s2) => `Humeur ${s1.metadata?.mood || "tendue"} détectée + alerte SUGU active — Présenter les infos de manière concise et rassurante.`,
    priority: "medium",
    actionTemplate: () => "Adapter le ton des alertes SUGU au contexte émotionnel",
  },
  {
    name: "finance_sugu_treasury",
    domains: ["finance", "sugu"],
    tagMatch: [["market", "stock", "trading"], ["treasury", "trésorerie", "cash"]],
    insightTemplate: (_, s2) => `Activité trading + situation trésorerie restaurant — Vérifier la cohérence des flux financiers perso/pro.`,
    priority: "medium",
  },
];

const PRIORITY_SCORES: Record<SignalPriority, number> = {
  critical: 100,
  high: 80,
  medium: 60,
  low: 40,
  info: 20,
};

class ProactiveGeneralIntelligence {
  private signals: ProactiveSignal[] = [];
  private insights: CrossDomainInsight[] = [];
  private feedback: FeedbackRecord[] = [];
  private maxSignals = 200;
  private maxInsights = 50;
  private maxFeedback = 500;
  private collectionInterval: NodeJS.Timeout | null = null;
  private digestInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor() {
    console.log(`${LOG} Proactive General Intelligence initialized`);
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    const startupDelay = 90 * 1000;
    const startupTimeout = setTimeout(() => {
      if (!this.isRunning) return;
      console.log(`${LOG} Starting intelligence loops`);

      this.runCollectionCycle().catch(e => console.warn(`${LOG} Initial collection failed:`, e));

      this.collectionInterval = setInterval(() => {
        this.runCollectionCycle().catch(e => console.warn(`${LOG} Collection cycle error:`, e));
      }, 10 * 60 * 1000);

      this.digestInterval = setInterval(() => {
        this.runDigestCycle().catch(e => console.warn(`${LOG} Digest cycle error:`, e));
      }, 30 * 60 * 1000);
    }, startupDelay);

    cleanupRegistry.registerCallback(() => {
      clearTimeout(startupTimeout);
      this.stop();
    }, 'PUGI');
  }

  stop(): void {
    if (this.collectionInterval) clearInterval(this.collectionInterval);
    if (this.digestInterval) clearInterval(this.digestInterval);
    this.isRunning = false;
    console.log(`${LOG} Stopped`);
  }

  ingestSignal(signal: Omit<ProactiveSignal, "id" | "createdAt" | "score">): ProactiveSignal | null {
    const hour = new Date().getHours();
    const timing = TIMING_RULES.find(r => r.domain === signal.domain);

    if (timing && timing.suppressHours.includes(hour)) {
      return null;
    }

    let score = PRIORITY_SCORES[signal.priority] || 50;

    if (timing) {
      if (timing.boostHours.includes(hour)) score += 15;
      if (!timing.allowedHours.includes(hour)) score -= 20;
    }

    const domainFeedback = this.feedback.filter(f => f.domain === signal.domain);
    if (domainFeedback.length >= 5) {
      const accepted = domainFeedback.filter(f => f.action === "accepted" || f.action === "acted").length;
      const rate = accepted / domainFeedback.length;
      score = Math.round(score * (0.5 + rate * 0.5));
    }

    const recent = this.signals.filter(s => s.domain === signal.domain && Date.now() - s.createdAt < 30 * 60 * 1000);
    if (recent.length >= 3) {
      score -= 10 * (recent.length - 2);
    }

    if (signal.expiresAt && signal.expiresAt < Date.now()) return null;

    const full: ProactiveSignal = {
      ...signal,
      id: `pugi_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      createdAt: Date.now(),
      score: Math.max(0, Math.min(100, score)),
    };

    this.signals.push(full);
    if (this.signals.length > this.maxSignals) {
      this.signals = this.signals.slice(-this.maxSignals);
    }

    return full;
  }

  private async runCollectionCycle(): Promise<void> {
    const startTime = Date.now();
    let collected = 0;

    try {
      const { suguProactiveService } = await import("./suguProactiveService");
      const report = await suguProactiveService.getFullReport("valentine", 30);

      if (report.unpaidInvoices.length > 0) {
        const critical = report.unpaidInvoices.filter((i: any) => i.severity === "critical");
        this.ingestSignal({
          domain: "sugu",
          source: "suguProactiveService",
          title: `${report.unpaidInvoices.length} facture(s) impayée(s)${critical.length > 0 ? ` dont ${critical.length} critique(s)` : ""}`,
          description: report.unpaidInvoices.slice(0, 3).map((i: any) => `${i.supplier}: ${i.amount}€ (${i.daysOverdue}j)`).join(", "),
          priority: critical.length > 0 ? "critical" : "high",
          tags: ["unpaid", "impayé", "overdue", "facture"],
          actionable: true,
          suggestedAction: "Vérifier et régler les factures en retard",
          suggestedTools: ["manage_sugu_purchases"],
          metadata: { count: report.unpaidInvoices.length, criticalCount: critical.length },
        });
        collected++;
      }

      if (report.treasuryForecast) {
        const tf = report.treasuryForecast;
        if (tf.riskLevel === "danger" || tf.riskLevel === "caution") {
          this.ingestSignal({
            domain: "sugu",
            source: "suguProactiveService",
            title: `Trésorerie ${tf.riskLevel === "danger" ? "en danger" : "sous surveillance"}: ${tf.projectedBalance?.toFixed(0)}€ dans 30j`,
            description: `Solde actuel: ${tf.currentBalance?.toFixed(0)}€ → Projection: ${tf.projectedBalance?.toFixed(0)}€. Revenue estimé: ${tf.estimatedRevenue?.toFixed(0)}€, Dépenses: ${tf.estimatedExpenses?.toFixed(0)}€`,
            priority: tf.riskLevel === "danger" ? "critical" : "high",
            tags: ["treasury", "trésorerie", "forecast", "cash"],
            actionable: true,
            suggestedAction: "Analyser les flux et identifier les économies possibles",
            suggestedTools: ["compute_business_health", "query_sugu_analytics"],
            metadata: { riskLevel: tf.riskLevel, projected: tf.projectedBalance },
          });
          collected++;
        }
      }

      if (report.reconciliationSuggestions && report.reconciliationSuggestions.length > 0) {
        this.ingestSignal({
          domain: "sugu",
          source: "suguProactiveService",
          title: `${report.reconciliationSuggestions.length} rapprochement(s) bancaire(s) suggéré(s)`,
          description: `Correspondances trouvées entre relevés bancaires et achats/frais`,
          priority: "medium",
          tags: ["reconciliation", "rapprochement", "bank"],
          actionable: true,
          suggestedAction: "Valider les rapprochements suggérés",
          suggestedTools: ["manage_sugu_bank"],
        });
        collected++;
      }

      if (report.seasonalPatterns && report.seasonalPatterns.length > 0) {
        const significant = report.seasonalPatterns.filter((p: any) => Math.abs(p.variationPercent || 0) > 25);
        if (significant.length > 0) {
          this.ingestSignal({
            domain: "sugu",
            source: "suguProactiveService",
            title: `${significant.length} variation(s) saisonnière(s) significative(s)`,
            description: significant.slice(0, 3).map((p: any) => `${p.category}: ${p.variationPercent > 0 ? "+" : ""}${p.variationPercent?.toFixed(0)}% vs année dernière`).join(", "),
            priority: "medium",
            tags: ["seasonal", "pattern", "trend"],
            actionable: false,
            metadata: { patterns: significant.length },
          });
          collected++;
        }
      }
    } catch (e) {
      console.warn(`${LOG} SUGU collection failed:`, e);
    }

    try {
      const { calendarAnticipationService } = await import("./calendarAnticipationService");
      const anticipations = await calendarAnticipationService.generateAnticipations(1);
      for (const ant of anticipations.slice(0, 5)) {
        const tags = ["calendar"];
        if (ant.title?.toLowerCase().includes("comptable")) tags.push("comptable", "accountant", "expert");
        if (ant.title?.toLowerCase().includes("banque")) tags.push("banque", "bank", "crédit");
        if (ant.description?.includes("fin de mois") || ant.description?.includes("bilan")) tags.push("fin-de-mois", "end-month", "bilan");
        if (ant.description?.includes("weekend") || ant.description?.includes("samedi")) tags.push("weekend", "samedi");

        this.ingestSignal({
          domain: "calendar",
          source: "calendarAnticipationService",
          title: ant.title || "Anticipation calendrier",
          description: ant.description || ant.action || "",
          priority: ant.urgency === "high" ? "high" : ant.urgency === "medium" ? "medium" : "low",
          tags,
          actionable: !!ant.action,
          suggestedAction: ant.action,
          expiresAt: ant.eventDate ? new Date(ant.eventDate).getTime() : undefined,
        });
        collected++;
      }
    } catch (e) {
      console.warn(`${LOG} Calendar collection failed:`, e);
    }

    try {
      const { autonomousInitiativeEngine } = await import("./autonomousInitiativeEngine");
      const pending = autonomousInitiativeEngine.getPendingInitiatives();
      for (const init of pending.slice(0, 5)) {
        const domainMap: Record<string, PugiDomain> = {
          sports: "sports", sugu: "sugu", weather: "weather",
          system: "system", perso: "personal", finance: "finance",
        };
        this.ingestSignal({
          domain: domainMap[init.domain] || "system",
          source: "autonomousInitiativeEngine",
          title: init.title,
          description: init.description,
          priority: init.priority >= 85 ? "high" : init.priority >= 60 ? "medium" : "low",
          tags: [init.type, init.domain, ...(init.suggestedTools || [])],
          actionable: init.autonomyLevel !== "observe",
          suggestedAction: init.suggestedAction,
          suggestedTools: init.suggestedTools,
        });
        collected++;
      }
    } catch (e) {
      console.warn(`${LOG} Initiative collection failed:`, e);
    }

    try {
      const { sentimentService } = await import("./sentimentService");
      const mood = sentimentService.getCurrentMood(1);
      if (mood && mood.mood !== "neutral") {
        this.ingestSignal({
          domain: "personal",
          source: "sentimentService",
          title: `Humeur détectée: ${mood.mood}`,
          description: `Confiance: ${(mood.confidence * 100).toFixed(0)}%`,
          priority: mood.mood === "frustrated" || mood.mood === "stressed" ? "medium" : "info",
          tags: ["mood", "sentiment", mood.mood],
          actionable: false,
          metadata: { mood: mood.mood, confidence: mood.confidence },
        });
        collected++;
      }
    } catch (e) {
      // Sentiment service might not have data yet
    }

    try {
      const { predictiveIntelligenceService } = await import("./predictiveIntelligenceService");
      const predictions = await predictiveIntelligenceService.generateAlerts("valentine");
      for (const alert of (predictions || []).slice(0, 3)) {
        this.ingestSignal({
          domain: "finance",
          source: "predictiveIntelligenceService",
          title: alert.title || "Alerte prédictive",
          description: alert.message || alert.description || "",
          priority: alert.severity === "critical" ? "critical" : alert.severity === "warning" ? "high" : "medium",
          tags: ["prediction", "forecast", "trend", alert.type || "generic"],
          actionable: !!alert.action,
          suggestedAction: alert.action,
        });
        collected++;
      }
    } catch (e) {
      // Predictive service might not have data
    }

    this.crossCorrelate();

    const elapsed = Date.now() - startTime;
    if (collected > 0) {
      console.log(`${LOG} Collection complete: ${collected} signals, ${this.insights.length} insights (${elapsed}ms)`);
    }
  }

  private crossCorrelate(): void {
    const recentSignals = this.signals.filter(s => Date.now() - s.createdAt < 60 * 60 * 1000);
    if (recentSignals.length < 2) return;

    const newInsights: CrossDomainInsight[] = [];

    for (const rule of CROSS_DOMAIN_RULES) {
      const [domain1, domain2] = rule.domains;
      const [tags1, tags2] = rule.tagMatch;

      const matches1 = recentSignals.filter(s => s.domain === domain1 && tags1.some(t => s.tags.includes(t) || s.title.toLowerCase().includes(t) || s.description.toLowerCase().includes(t)));
      const matches2 = recentSignals.filter(s => s.domain === domain2 && tags2.some(t => s.tags.includes(t) || s.title.toLowerCase().includes(t) || s.description.toLowerCase().includes(t)));

      if (matches1.length > 0 && matches2.length > 0) {
        const s1 = matches1[0];
        const s2 = matches2[0];

        const existingInsight = this.insights.find(i =>
          i.sourceSignals.includes(s1.id) && i.sourceSignals.includes(s2.id)
        );
        if (existingInsight) continue;

        const insight: CrossDomainInsight = {
          id: `insight_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          title: `${rule.name.replace(/_/g, " ")}`,
          description: rule.insightTemplate(s1, s2),
          domains: [domain1, domain2],
          sourceSignals: [s1.id, s2.id],
          priority: rule.priority,
          score: Math.max(s1.score, s2.score) + 10,
          createdAt: Date.now(),
          actionable: !!rule.actionTemplate,
          suggestedAction: rule.actionTemplate ? rule.actionTemplate(s1, s2) : undefined,
        };

        newInsights.push(insight);

        s1.relatedSignals = [...(s1.relatedSignals || []), s2.id];
        s2.relatedSignals = [...(s2.relatedSignals || []), s1.id];
      }
    }

    if (newInsights.length > 0) {
      this.insights.push(...newInsights);
      if (this.insights.length > this.maxInsights) {
        this.insights = this.insights.slice(-this.maxInsights);
      }
      console.log(`${LOG} Cross-correlation: ${newInsights.length} new insights`);
    }
  }

  private async runDigestCycle(): Promise<void> {
    const consciousness = brainHub.getConsciousness();
    if (!consciousness.activeUserId) return;

    const userId = consciousness.activeUserId;
    const digest = this.getDigest(5);

    if (digest.signals.length === 0 && digest.insights.length === 0) return;

    const brainBlock = this.formatForBrain(digest);
    if (brainBlock) {
      brainHub.addThought(brainBlock, 55);
    }

    if (digest.topActions.length > 0 || digest.insights.length > 0) {
      broadcastToUser(userId, {
        type: "pugi.digest",
        userId,
        data: {
          topActions: digest.topActions.slice(0, 3),
          insights: digest.insights.slice(0, 2),
          stats: digest.stats,
        },
        timestamp: Date.now(),
      });
    }
  }

  getDigest(maxPerDomain: number = 3): PugiDigest {
    const now = Date.now();
    const active = this.signals.filter(s => {
      if (s.expiresAt && s.expiresAt < now) return false;
      if (now - s.createdAt > 4 * 60 * 60 * 1000) return false;
      return true;
    });

    const byDomain: Record<string, ProactiveSignal[]> = {};
    for (const s of active) {
      if (!byDomain[s.domain]) byDomain[s.domain] = [];
      byDomain[s.domain].push(s);
    }

    const topSignals: ProactiveSignal[] = [];
    for (const domain of Object.keys(byDomain)) {
      const sorted = byDomain[domain].sort((a, b) => b.score - a.score);
      topSignals.push(...sorted.slice(0, maxPerDomain));
    }
    topSignals.sort((a, b) => b.score - a.score);

    const topActions = topSignals.filter(s => s.actionable).slice(0, 5);

    const recentInsights = this.insights.filter(i => now - i.createdAt < 4 * 60 * 60 * 1000);

    const domainCounts: Record<string, number> = {};
    const priorityCounts: Record<string, number> = {};
    for (const s of active) {
      domainCounts[s.domain] = (domainCounts[s.domain] || 0) + 1;
      priorityCounts[s.priority] = (priorityCounts[s.priority] || 0) + 1;
    }

    const totalFeedback = this.feedback.length;
    const acceptedFeedback = this.feedback.filter(f => f.action === "accepted" || f.action === "acted").length;
    const feedbackRate = totalFeedback > 0 ? acceptedFeedback / totalFeedback : 0.5;

    return {
      timestamp: now,
      signals: topSignals,
      insights: recentInsights,
      topActions,
      stats: {
        totalSignals: active.length,
        byDomain: domainCounts,
        byPriority: priorityCounts,
        crossDomainInsights: recentInsights.length,
        feedbackAcceptRate: feedbackRate,
      },
    };
  }

  formatForBrain(digest: PugiDigest): string | null {
    const parts: string[] = [];

    if (digest.insights.length > 0) {
      parts.push("🔗 Insights croisés:");
      for (const insight of digest.insights.slice(0, 3)) {
        parts.push(`  - [${insight.priority.toUpperCase()}] ${insight.description}`);
      }
    }

    if (digest.topActions.length > 0) {
      parts.push("⚡ Actions suggérées:");
      for (const action of digest.topActions.slice(0, 3)) {
        parts.push(`  - [${action.domain}/${action.priority}] ${action.title}${action.suggestedAction ? ` → ${action.suggestedAction}` : ""}`);
      }
    }

    const critical = digest.signals.filter(s => s.priority === "critical");
    if (critical.length > 0) {
      parts.push(`🚨 ${critical.length} alerte(s) critique(s): ${critical.map(c => c.title).join(", ")}`);
    }

    if (parts.length === 0) return null;
    return `[PUGI — Intelligence Proactive Générale]\n${parts.join("\n")}`;
  }

  formatForBriefing(): string {
    const digest = this.getDigest(2);
    const sections: string[] = [];

    if (digest.insights.length > 0) {
      sections.push("📊 Insights Intelligence Proactive:");
      for (const insight of digest.insights.slice(0, 3)) {
        sections.push(`• ${insight.description}`);
      }
    }

    if (digest.topActions.length > 0) {
      sections.push("\n⚡ Actions prioritaires:");
      for (const action of digest.topActions.slice(0, 5)) {
        sections.push(`• [${action.domain.toUpperCase()}] ${action.title}`);
      }
    }

    const stats = digest.stats;
    sections.push(`\n📈 Stats: ${stats.totalSignals} signaux actifs, ${stats.crossDomainInsights} insights croisés`);
    if (stats.byPriority["critical"]) sections.push(`   🚨 ${stats.byPriority["critical"]} critique(s)`);

    return sections.join("\n");
  }

  recordFeedback(signalId: string, action: FeedbackRecord["action"]): void {
    const signal = this.signals.find(s => s.id === signalId);
    const domain = signal?.domain || "system";

    this.feedback.push({
      signalId,
      action,
      domain: domain as PugiDomain,
      timestamp: Date.now(),
    });

    if (this.feedback.length > this.maxFeedback) {
      this.feedback = this.feedback.slice(-this.maxFeedback);
    }

    console.log(`${LOG} Feedback: ${signalId} → ${action} (domain: ${domain})`);
  }

  getDomainAcceptRate(domain: PugiDomain): number {
    const domainFb = this.feedback.filter(f => f.domain === domain);
    if (domainFb.length < 3) return 0.5;
    const accepted = domainFb.filter(f => f.action === "accepted" || f.action === "acted").length;
    return accepted / domainFb.length;
  }

  getStats(): {
    totalSignals: number;
    activeSignals: number;
    totalInsights: number;
    feedbackCount: number;
    domainRates: Record<string, number>;
    isRunning: boolean;
  } {
    const now = Date.now();
    const active = this.signals.filter(s => {
      if (s.expiresAt && s.expiresAt < now) return false;
      if (now - s.createdAt > 4 * 60 * 60 * 1000) return false;
      return true;
    });

    const domains: PugiDomain[] = ["sugu", "sports", "calendar", "finance", "personal", "system"];
    const domainRates: Record<string, number> = {};
    for (const d of domains) {
      domainRates[d] = this.getDomainAcceptRate(d);
    }

    return {
      totalSignals: this.signals.length,
      activeSignals: active.length,
      totalInsights: this.insights.length,
      feedbackCount: this.feedback.length,
      domainRates,
      isRunning: this.isRunning,
    };
  }

  generatePromptBlock(): string {
    const digest = this.getDigest(2);
    if (digest.signals.length === 0 && digest.insights.length === 0) {
      return "";
    }
    return this.formatForBrain(digest) || "";
  }
}

export const pugi = new ProactiveGeneralIntelligence();
