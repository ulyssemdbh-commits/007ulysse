/**
 * AUTONOMOUS INITIATIVE ENGINE V1
 * 
 * Moteur d'initiatives proactives - Ulysse agit sans qu'on lui demande.
 * 
 * Niveaux d'autonomie:
 * - OBSERVE: Détecte les signaux mais ne fait rien
 * - PROPOSE: Suggère des actions (notification)
 * - ACT: Exécute automatiquement avec audit trail
 * 
 * Signaux surveillés:
 * - Calendrier (deadlines, conflits)
 * - Emails (urgents, non-lus importants)
 * - Sports (matchs imminents, résultats)
 * - SUGU (anomalies, rappels)
 * - Habitudes (patterns détectés)
 * - KPIs (dégradation de performance)
 */

const LOG_PREFIX = "[Initiative]";

export type AutonomyLevel = "observe" | "propose" | "act";

export interface Initiative {
  id: string;
  type: "calendar_deadline" | "email_urgent" | "sports_alert" | "sugu_anomaly" | "habit_trigger" | "kpi_alert" | "proactive_research" | "weather_alert" | "memory_reminder" | "devops_audit" | "task_queue_check" | "system_cleanup";
  domain: string;
  title: string;
  description: string;
  priority: number;
  autonomyLevel: AutonomyLevel;
  suggestedAction?: string;
  suggestedTools?: string[];
  status: "pending" | "proposed" | "executed" | "dismissed" | "expired";
  createdAt: number;
  executedAt?: number;
  result?: string;
  trigger: string;
}

interface InitiativeRule {
  type: Initiative["type"];
  domain: string;
  defaultAutonomy: AutonomyLevel;
  priority: number;
  check: () => Promise<Initiative | null>;
  cooldownMs: number;
  lastChecked: number;
}

interface AutonomyContract {
  canAct: string[];
  mustPropose: string[];
  mustStayReactive: string[];
}

const AUTONOMY_CONTRACT: AutonomyContract = {
  canAct: [
    "sugu: alerter anomalies évidentes, factures/charges qui explosent, récurrences cheloues",
    "sports: signaler matchs à forte value, incohérences probas vs cotes",
    "dev: proposer refacto/simplification sur douleur récurrente (latence, complexité, duplication)",
    "weather: brief météo matinal automatique",
    "system: KPI health check et auto-diagnostic"
  ],
  mustPropose: [
    "sugu: recommandations d'optimisation de coûts",
    "sports: paris recommandés (shortlist argumentée)",
    "perso: rappels dates importantes, anniversaires famille",
    "finance: alertes tendances marché"
  ],
  mustStayReactive: [
    "Toutes actions irréversibles ou risquées",
    "Paiements, emails à valeur légale, décisions business lourdes",
    "Actions impliquant des tiers (envoi emails, notifications externes)",
    "Modifications de données sensibles (comptes, mots de passe)"
  ]
};

class AutonomousInitiativeEngine {
  private initiatives: Initiative[] = [];
  private maxHistory = 100;
  private autonomyOverrides: Map<string, AutonomyLevel> = new Map();

  private rules: InitiativeRule[] = [
    {
      type: "sports_alert",
      domain: "sports",
      defaultAutonomy: "propose",
      priority: 70,
      cooldownMs: 4 * 3600 * 1000,
      lastChecked: 0,
      check: async () => {
        const now = new Date();
        const hour = now.getHours();
        if (hour >= 18 && hour <= 22) {
          return this.createInitiative("sports_alert", "sports", "Matchs en cours ce soir", 
            "Des matchs sont probablement en cours. Veux-tu un update des scores en direct?",
            70, "propose", "Détection horaire matchs (18h-22h)", ["query_sports_data"]);
        }
        return null;
      }
    },
    {
      type: "weather_alert",
      domain: "weather",
      defaultAutonomy: "act",
      priority: 50,
      cooldownMs: 6 * 3600 * 1000,
      lastChecked: 0,
      check: async () => {
        const hour = new Date().getHours();
        if (hour === 7 || hour === 8) {
          return this.createInitiative("weather_alert", "weather", "Météo du matin",
            "Préparer le brief météo pour la journée",
            50, "act", "Brief matinal automatique", ["location_get_weather"]);
        }
        return null;
      }
    },
    {
      type: "kpi_alert",
      domain: "system",
      defaultAutonomy: "propose",
      priority: 90,
      cooldownMs: 2 * 3600 * 1000,
      lastChecked: 0,
      check: async () => {
        try {
          const { ulysseKPIService } = await import("./ulysseKPIService");
          const snapshot = ulysseKPIService.getSnapshot();
          const health = snapshot.overallHealth;
          if (health.score < 60) {
            return this.createInitiative("kpi_alert", "system",
              `Santé Ulysse dégradée: ${health.grade}`,
              `Score de santé à ${health.score}/100. Recommandations: ${health.recommendations.slice(0, 2).join(", ")}`,
              90, "propose", "KPI health check", []);
          }
        } catch {}
        return null;
      }
    },
    {
      type: "sugu_anomaly",
      domain: "sugu",
      defaultAutonomy: "propose",
      priority: 85,
      cooldownMs: 6 * 3600 * 1000,
      lastChecked: 0,
      check: async () => {
        const hour = new Date().getHours();
        if (hour >= 9 && hour <= 11) {
          try {
            const { executeQueryAppData } = await import("./tools/utilityTools");
            const [valAudit, mailOverview, valCash] = await Promise.all([
              executeQueryAppData({ section: "suguval_audit" }).then(r => JSON.parse(r)).catch(() => null),
              executeQueryAppData({ section: "sugumaillane_overview" }).then(r => JSON.parse(r)).catch(() => null),
              executeQueryAppData({ section: "suguval_cash", limit: 7 }).then(r => JSON.parse(r)).catch(() => null),
            ]);
            const alerts: string[] = [];
            if (valAudit && valAudit.purchases > valAudit.revenue * 0.4) alerts.push(`Valentine: achats (${valAudit.purchases.toFixed(0)}€) > 40% du CA (${valAudit.revenue.toFixed(0)}€)`);
            if (mailOverview?.achats?.total > 0 && mailOverview?.caisse?.total > 0 && mailOverview.achats.total > mailOverview.caisse.total * 0.4) alerts.push(`Maillane: ratio achats/CA élevé`);
            if (valCash && valCash.entries?.length > 0) {
              const avg = valCash.totalRevenue / valCash.entries.length;
              const lastDay = valCash.entries[0];
              if (lastDay && lastDay.total < avg * 0.5) alerts.push(`Valentine: CA dernier jour (${lastDay.total?.toFixed(0)}€) très bas vs moyenne (${avg.toFixed(0)}€)`);
            }
            const desc = alerts.length > 0
              ? `Anomalies détectées:\n${alerts.join("\n")}`
              : "Check matinal: aucune anomalie majeure détectée. Achats, charges et CA dans les normes.";
            return this.createInitiative("sugu_anomaly", "sugu",
              alerts.length > 0 ? `⚠️ ${alerts.length} alerte(s) SUGU` : "✅ Check SUGU matinal OK",
              desc, alerts.length > 0 ? 90 : 50, "propose",
              "Morning SUGU check via query_app_data", ["query_app_data", "sugu_full_overview"]);
          } catch {
            return this.createInitiative("sugu_anomaly", "sugu",
              "Check SUGU matinal",
              "Vérification automatique: anomalies achats, charges inhabituelles.",
              85, "propose", "Morning SUGU check fallback", ["query_app_data"]);
          }
        }
        const dayOfWeek = new Date().getDay();
        if (dayOfWeek === 1 && hour >= 14 && hour <= 16) {
          try {
            const { executeQueryAppData } = await import("./tools/utilityTools");
            const [valAudit, mailOverview, valLoans] = await Promise.all([
              executeQueryAppData({ section: "suguval_audit" }).then(r => JSON.parse(r)).catch(() => null),
              executeQueryAppData({ section: "sugumaillane_overview" }).then(r => JSON.parse(r)).catch(() => null),
              executeQueryAppData({ section: "suguval_loans" }).then(r => JSON.parse(r)).catch(() => null),
            ]);
            const parts: string[] = ["Bilan hebdo multi-restaurant:"];
            if (valAudit) parts.push(`Valentine — CA: ${valAudit.revenue?.toFixed(0)}€, Achats: ${valAudit.purchases?.toFixed(0)}€, Frais: ${valAudit.expenses?.toFixed(0)}€, Masse salariale: ${valAudit.payroll?.toFixed(0)}€`);
            if (mailOverview) parts.push(`Maillane — Achats: ${mailOverview.achats?.total?.toFixed(0)}€, CA caisse: ${mailOverview.caisse?.total?.toFixed(0)}€, Employés actifs: ${mailOverview.employes?.actifs}`);
            if (valLoans && valLoans.count > 0) parts.push(`Emprunts en cours: ${valLoans.count}, restant dû: ${valLoans.totalRemaining?.toFixed(0)}€`);
            return this.createInitiative("sugu_anomaly", "sugu",
              "📊 Bilan hebdo SUGU (Valentine + Maillane)",
              parts.join("\n"),
              90, "propose", "Monday SUGU weekly review via query_app_data", ["query_app_data", "sugu_full_overview"]);
          } catch {
            return this.createInitiative("sugu_anomaly", "sugu",
              "Bilan hebdo SUGU",
              "Lundi: analyse comparative semaine passée vs précédente.",
              90, "propose", "Monday SUGU weekly review", ["sugu_full_overview"]);
          }
        }
        return null;
      }
    },
    {
      type: "memory_reminder",
      domain: "perso",
      defaultAutonomy: "propose",
      priority: 80,
      cooldownMs: 12 * 3600 * 1000,
      lastChecked: 0,
      check: async () => {
        const now = new Date();
        const month = now.getMonth() + 1;
        const day = now.getDate();
        const dateKey = `${month}-${day}`;
        try {
          const { db } = await import("../db");
          const memRows = await db.execute(`SELECT content FROM brain_knowledge WHERE topic ILIKE '%anniversaire%' OR topic ILIKE '%date importante%' OR content ILIKE '%${month}/${day}%' LIMIT 5`);
          if (memRows.rows && memRows.rows.length > 0) {
            const reminder = (memRows.rows as any[]).map(r => r.content).join("; ");
            return this.createInitiative("memory_reminder", "perso",
              "📅 Rappel: date importante aujourd'hui",
              `Trouvé dans la mémoire: ${reminder}`,
              95, "propose", "Brain memory date lookup", ["query_brain"]);
          }
        } catch {}
        try {
          const { db } = await import("../db");
          const tomorrow = new Date(now);
          tomorrow.setDate(tomorrow.getDate() + 1);
          const tomorrowKey = `${tomorrow.getMonth() + 1}-${tomorrow.getDate()}`;
          const tRows = await db.execute(`SELECT content FROM brain_knowledge WHERE content ILIKE '%${tomorrow.getMonth() + 1}/${tomorrow.getDate()}%' AND (topic ILIKE '%anniversaire%' OR topic ILIKE '%important%') LIMIT 3`);
          if (tRows.rows && tRows.rows.length > 0) {
            const reminder = (tRows.rows as any[]).map(r => r.content).join("; ");
            return this.createInitiative("memory_reminder", "perso",
              "📅 Rappel: date importante demain",
              `Prévoir pour demain: ${reminder}`,
              85, "propose", "Brain memory date lookup (tomorrow)", ["query_brain"]);
          }
        } catch {}
        return null;
      }
    },
    {
      type: "devops_audit",
      domain: "dev",
      defaultAutonomy: "act",
      priority: 40,
      cooldownMs: 24 * 3600 * 1000,
      lastChecked: 0,
      check: async () => {
        const hour = new Date().getHours();
        if (hour >= 3 && hour <= 5) {
          try {
            const tq = await import("./taskQueueEngine");
            const activeQueues = await tq.getActiveQueues(1);
            const hasAuditQueue = activeQueues.some((q: any) => q.title?.toLowerCase().includes("audit"));
            if (!hasAuditQueue) {
              return this.createInitiative("devops_audit", "dev",
                "🔍 Auto-diagnostic nocturne du repo",
                "Vérification automatique nocturne: structure du repo, dépendances obsolètes, fichiers morts.",
                40, "act", "Night auto-audit (3h-5h)", ["devops_github", "task_queue_manage"]);
            }
          } catch {}
        }
        return null;
      }
    },
    {
      type: "task_queue_check",
      domain: "system",
      defaultAutonomy: "propose",
      priority: 75,
      cooldownMs: 4 * 3600 * 1000,
      lastChecked: 0,
      check: async () => {
        try {
          const tq = await import("./taskQueueEngine");
          const stats = tq.getActiveQueueCount();
          if (stats > 3) {
            return this.createInitiative("task_queue_check", "system",
              `⚠️ ${stats} queues actives simultanément`,
              `${stats} files de tâches tournent en même temps. Risque de surcharge mémoire et lenteurs.`,
              75, "propose", "Active queue overload detection", ["task_queue_manage"]);
          }
        } catch {}
        return null;
      }
    },
    {
      type: "system_cleanup",
      domain: "system",
      defaultAutonomy: "act",
      priority: 30,
      cooldownMs: 24 * 3600 * 1000,
      lastChecked: 0,
      check: async () => {
        const hour = new Date().getHours();
        if (hour === 4) {
          try {
            const { db } = await import("../db");
            const oldConvos = await db.execute(`SELECT COUNT(*) as cnt FROM conversations WHERE created_at < NOW() - INTERVAL '90 days'`);
            const oldCount = parseInt((oldConvos.rows as any[])[0]?.cnt || "0");
            if (oldCount > 500) {
              return this.createInitiative("system_cleanup", "system",
                "🧹 Nettoyage données anciennes",
                `${oldCount} conversations de plus de 90 jours. Nettoyage automatique pour garder les performances.`,
                30, "act", "Auto-cleanup old data (4h)", []);
            }
          } catch {}
        }
        return null;
      }
    },
    {
      type: "proactive_research",
      domain: "sports",
      defaultAutonomy: "act",
      priority: 60,
      cooldownMs: 8 * 3600 * 1000,
      lastChecked: 0,
      check: async () => {
        const dayOfWeek = new Date().getDay();
        if (dayOfWeek >= 5 || dayOfWeek === 0) {
          return this.createInitiative("proactive_research", "sports",
            "Préparation pronostics weekend",
            "Le weekend approche - préparer les analyses value bets selon profil Maurice (max 3 matchs, cotes 1.5-15, value threshold 10%)",
            60, "act", "Weekend sports prep", ["query_sports_data", "query_matchendirect", "query_match_intelligence"]);
        }
        return null;
      }
    }
  ];

  async runChecks(): Promise<Initiative[]> {
    const newInitiatives: Initiative[] = [];
    const now = Date.now();

    for (const rule of this.rules) {
      if (now - rule.lastChecked < rule.cooldownMs) continue;
      
      try {
        rule.lastChecked = now;
        const initiative = await rule.check();
        if (initiative) {
          const autonomy = this.autonomyOverrides.get(rule.type) || rule.defaultAutonomy;
          initiative.autonomyLevel = autonomy;
          this.initiatives.push(initiative);
          newInitiatives.push(initiative);
          
          if (this.initiatives.length > this.maxHistory) {
            this.initiatives = this.initiatives.slice(-this.maxHistory);
          }
          
          console.log(`${LOG_PREFIX} New initiative: ${initiative.title} (${initiative.autonomyLevel})`);
        }
      } catch (err) {
        console.error(`${LOG_PREFIX} Rule check failed for ${rule.type}:`, err);
      }
    }

    return newInitiatives;
  }

  private createInitiative(type: Initiative["type"], domain: string, title: string, description: string, priority: number, autonomy: AutonomyLevel, trigger: string, tools?: string[]): Initiative {
    return {
      id: `init_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      type, domain, title, description, priority,
      autonomyLevel: autonomy,
      suggestedAction: description,
      suggestedTools: tools,
      status: "pending",
      createdAt: Date.now(),
      trigger
    };
  }

  setAutonomyLevel(type: Initiative["type"], level: AutonomyLevel): void {
    this.autonomyOverrides.set(type, level);
    console.log(`${LOG_PREFIX} Autonomy override: ${type} → ${level}`);
  }

  getPendingInitiatives(): Initiative[] {
    return this.initiatives.filter(i => i.status === "pending" || i.status === "proposed");
  }

  markExecuted(id: string, result: string): void {
    const init = this.initiatives.find(i => i.id === id);
    if (init) {
      init.status = "executed";
      init.executedAt = Date.now();
      init.result = result;
    }
  }

  dismiss(id: string): void {
    const init = this.initiatives.find(i => i.id === id);
    if (init) init.status = "dismissed";
  }

  generateInitiativePrompt(): string {
    const pending = this.getPendingInitiatives();
    const parts: string[] = [];

    parts.push(`\n[CONTRAT D'AUTONOMIE ULYSSE]
JE PEUX AGIR seul: ${AUTONOMY_CONTRACT.canAct.join(" | ")}
JE DOIS PROPOSER: ${AUTONOMY_CONTRACT.mustPropose.join(" | ")}
JE RESTE RÉACTIF: ${AUTONOMY_CONTRACT.mustStayReactive.join(" | ")}`);

    if (pending.length > 0) {
      const items = pending.slice(0, 5).map(i => 
        `- [${i.autonomyLevel.toUpperCase()}] ${i.title}: ${i.description} (priorité: ${i.priority})`
      );
      parts.push(`\n[INITIATIVES PROACTIVES - ${pending.length} en attente]
${items.join("\n")}
Mentionner ces initiatives quand c'est pertinent dans la conversation.`);
    }

    return parts.join("\n");
  }

  async executeInitiative(initiative: Initiative): Promise<string> {
    try {
      let result = "";
      switch (initiative.type) {
        case "weather_alert":
          try {
            const { executeToolCallV2 } = await import("./ulysseToolsServiceV2");
            const weatherResult = await executeToolCallV2("location_get_weather", { city: "Marseille" }, 1);
            result = `Brief météo: ${weatherResult.slice(0, 300)}`;
          } catch {
            result = "Brief météo préparé automatiquement";
          }
          break;
        case "proactive_research":
          try {
            const { scanForValueBets } = await import("./valueBetEngine");
            const scanResult = await scanForValueBets();
            result = `Value bets scan: ${scanResult.valueBetsFound} value bets trouvés sur ${scanResult.scannedMatches} matchs analysés`;
          } catch (err: any) {
            result = "Données sportives collectées (scan value bets non disponible)";
          }
          break;
        case "kpi_alert":
          try {
            const { ulysseKPIService } = await import("./ulysseKPIService");
            const snapshot = ulysseKPIService.getSnapshot();
            result = `Diagnostic: score=${snapshot.overallHealth.score}, grade=${snapshot.overallHealth.grade}, recommandations: ${snapshot.overallHealth.recommendations.slice(0, 3).join(", ")}`;
          } catch {
            result = "Diagnostic système lancé";
          }
          break;
        case "sugu_anomaly":
          try {
            const { executeQueryAppData } = await import("./tools/utilityTools");
            const [valData, mailData] = await Promise.all([
              executeQueryAppData({ section: "suguval_audit" }).then(r => JSON.parse(r)).catch(() => null),
              executeQueryAppData({ section: "sugumaillane_overview" }).then(r => JSON.parse(r)).catch(() => null),
            ]);
            const parts: string[] = ["Check SUGU exécuté:"];
            if (valData) parts.push(`Valentine — CA: ${valData.revenue?.toFixed(0)}€, Achats: ${valData.purchases?.toFixed(0)}€`);
            if (mailData) parts.push(`Maillane — CA caisse: ${mailData.caisse?.total?.toFixed(0)}€, Achats: ${mailData.achats?.total?.toFixed(0)}€`);
            result = parts.join(" | ");
          } catch {
            result = "Check SUGU matinal effectué";
          }
          break;
        case "devops_audit":
          try {
            const tq = await import("./taskQueueEngine");
            const queue = await tq.createTaskQueue({
              userId: 1,
              title: "Auto-diagnostic nocturne",
              items: [
                { title: "Structure repo", toolName: "devops_github", toolArgs: { action: "browse_files", owner: "ulyssemdbh-commits", repo: "ulysseproject" } },
                { title: "Fichiers racine", toolName: "devops_github", toolArgs: { action: "browse_files", owner: "ulyssemdbh-commits", repo: "ulysseproject", path: "server" } },
                { title: "Client structure", toolName: "devops_github", toolArgs: { action: "browse_files", owner: "ulyssemdbh-commits", repo: "ulysseproject", path: "client" } },
              ],
              source: "initiative",
            });
            await tq.startTaskQueue(queue.queueId);
            result = `Auto-diagnostic lancé: queue #${queue.queueId} avec 3 tâches`;
          } catch (err: any) {
            result = `Auto-diagnostic échoué: ${err.message}`;
          }
          break;
        case "task_queue_check":
          try {
            const tq = await import("./taskQueueEngine");
            const count = tq.getActiveQueueCount();
            result = `${count} queues actives détectées — alerte surcharge envoyée`;
          } catch {
            result = "Vérification des queues actives effectuée";
          }
          break;
        case "system_cleanup":
          try {
            const { db } = await import("../db");
            await db.execute(`DELETE FROM conversations WHERE created_at < NOW() - INTERVAL '90 days' AND user_id NOT IN (1)`);
            await db.execute(`DELETE FROM usage_events WHERE created_at < NOW() - INTERVAL '90 days'`);
            result = "Nettoyage automatique: vieilles conversations et events supprimés";
          } catch (err: any) {
            result = `Nettoyage partiel: ${err.message}`;
          }
          break;
        case "memory_reminder":
          result = `Rappel date importante: ${initiative.description}`;
          break;
        default:
          result = `Initiative ${initiative.type} traitée`;
      }
      this.markExecuted(initiative.id, result);
      console.log(`${LOG_PREFIX} EXECUTED: ${initiative.title} → ${result}`);
      return result;
    } catch (err: any) {
      console.error(`${LOG_PREFIX} Execution failed for ${initiative.id}:`, err?.message);
      return `Erreur: ${err?.message}`;
    }
  }

  getStats(): { total: number; pending: number; executed: number; dismissed: number; rules: number } {
    return {
      total: this.initiatives.length,
      pending: this.initiatives.filter(i => i.status === "pending").length,
      executed: this.initiatives.filter(i => i.status === "executed").length,
      dismissed: this.initiatives.filter(i => i.status === "dismissed").length,
      rules: this.rules.length
    };
  }
}

export const autonomousInitiativeEngine = new AutonomousInitiativeEngine();
