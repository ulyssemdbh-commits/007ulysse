/**
 * Hub Action Service - Actions IA pour Hub, OCR, RAG, Metrics
 * Intégration avec le système de markers Ulysse
 */

import { hubService } from "./hubService";
import { ocrService } from "./ocrService";
import { ragService } from "./ragService";
import { featureFlagsService } from "./featureFlagsService";
import { metricsService } from "./metricsService";

interface ActionResult {
  success: boolean;
  message: string;
  data?: unknown;
}

interface PersonaContext {
  isOwner: boolean;
  userId: number;
}

export const hubActionService = {
  /**
   * [BRIEF_QUOTIDIEN] - Brief matinal agrégé
   */
  async handleBriefQuotidien(persona: PersonaContext): Promise<ActionResult> {
    if (!persona.isOwner) {
      return { success: false, message: "Accès réservé au patron." };
    }

    if (!featureFlagsService.isEnabled("ulysse.hub_brief.enabled")) {
      return { success: false, message: "Le brief quotidien est désactivé." };
    }

    try {
      const brief = await hubService.getTodayBrief(persona.userId);
      const formatted = hubService.formatBriefForChat(brief);
      
      return {
        success: true,
        message: formatted,
        data: brief
      };
    } catch (error) {
      console.error("[HubAction] Brief error:", error);
      return { success: false, message: "Erreur lors de la génération du brief." };
    }
  },

  /**
   * [SANTE_SYSTEME] - État de santé du système
   */
  async handleSanteSysteme(persona: PersonaContext): Promise<ActionResult> {
    if (!persona.isOwner) {
      return { success: false, message: "Accès réservé au patron." };
    }

    try {
      const health = metricsService.getSystemHealth();
      const jobStats = metricsService.getJobStats(24);
      const apiStats = metricsService.getApiStats(24);
      
      const statusEmoji = health.status === 'healthy' ? '✅' : health.status === 'degraded' ? '⚠️' : '❌';
      
      const lines = [
        `**${statusEmoji} Santé système: ${health.status.toUpperCase()}**`,
        ``,
        `**Métriques générales:**`,
        `- Uptime: ${Math.round(health.uptime / 3600)}h`,
        `- Taux d'erreur: ${Math.round(health.errorRate * 100)}%`,
        `- Latence moyenne: ${health.avgLatency}ms`,
        `- Taux succès jobs: ${Math.round(health.jobSuccessRate * 100)}%`,
        ``,
        `**API (24h):**`,
        `- ${apiStats.totalRequests} requêtes`,
        `- ${apiStats.errorCount} erreurs`,
        ``,
        `**Jobs (24h):**`,
        `- ${jobStats.totalExecutions} exécutions`,
        `- ${jobStats.successCount} succès, ${jobStats.failureCount} échecs`
      ];

      if (health.recentErrors.length > 0) {
        lines.push(``, `**Erreurs récentes:**`);
        for (const err of health.recentErrors.slice(0, 3)) {
          lines.push(`- [${err.service}] ${err.error.substring(0, 80)}`);
        }
      }

      return {
        success: true,
        message: lines.join('\n'),
        data: { health, jobStats, apiStats }
      };
    } catch (error) {
      console.error("[HubAction] Health error:", error);
      return { success: false, message: "Erreur lors de la vérification de santé." };
    }
  },

  /**
   * [RAPPORT_SYSTEME] - Rapport quotidien détaillé
   */
  async handleRapportSysteme(persona: PersonaContext): Promise<ActionResult> {
    if (!persona.isOwner) {
      return { success: false, message: "Accès réservé au patron." };
    }

    try {
      const report = metricsService.generateDailyReport();
      return {
        success: true,
        message: report
      };
    } catch (error) {
      console.error("[HubAction] Report error:", error);
      return { success: false, message: "Erreur lors de la génération du rapport." };
    }
  },

  /**
   * [OCR_DOCUMENT] - Analyse OCR d'un document
   */
  async handleOcrDocument(persona: PersonaContext, imageUrl: string): Promise<ActionResult> {
    if (!persona.isOwner) {
      return { success: false, message: "Accès réservé au patron." };
    }

    if (!featureFlagsService.isEnabled("ulysse.ocr.enabled")) {
      return { success: false, message: "L'OCR est désactivé." };
    }

    try {
      // Fetch image from URL
      const response = await fetch(imageUrl);
      const arrayBuffer = await response.arrayBuffer();
      const imageBuffer = Buffer.from(arrayBuffer);

      const analysis = await ocrService.analyzeDocument(imageBuffer);

      const lines = [
        `**📄 Analyse OCR**`,
        ``,
        `**Type détecté:** ${analysis.type}`,
        `**Confiance:** ${Math.round(analysis.confidence * 100)}%`,
        ``,
        `**Résumé:** ${analysis.summary}`,
      ];

      if (analysis.type === 'invoice' || analysis.type === 'receipt') {
        const data = analysis.extractedData as any;
        if (data.vendor) lines.push(`**Fournisseur:** ${data.vendor}`);
        if (data.date) lines.push(`**Date:** ${data.date}`);
        if (data.total) lines.push(`**Total:** ${data.total.toFixed(2)}€`);
        if (data.items?.length > 0) {
          lines.push(``, `**Articles (${data.items.length}):**`);
          for (const item of data.items.slice(0, 10)) {
            const price = item.price ? ` - ${item.price.toFixed(2)}€` : '';
            lines.push(`- ${item.name}${price}`);
          }
        }
      }

      return {
        success: true,
        message: lines.join('\n'),
        data: analysis
      };
    } catch (error) {
      console.error("[HubAction] OCR error:", error);
      return { success: false, message: "Erreur lors de l'analyse OCR." };
    }
  },

  /**
   * [RAG_RECHERCHE] - Recherche dans la base documentaire
   */
  async handleRagRecherche(persona: PersonaContext, query: string): Promise<ActionResult> {
    if (!persona.isOwner) {
      return { success: false, message: "Accès réservé au patron." };
    }

    if (!featureFlagsService.isEnabled("ulysse.rag.enabled")) {
      return { success: false, message: "La recherche documentaire est désactivée." };
    }

    try {
      const results = await ragService.queryWithContext(query, { limit: 5 });

      if (results.sources.length === 0) {
        return {
          success: true,
          message: "Aucun document pertinent trouvé pour cette recherche."
        };
      }

      const lines = [
        `**🔍 Recherche: "${query}"**`,
        ``,
        `Trouvé ${results.sources.length} document(s) pertinent(s):`,
        ``
      ];

      for (const source of results.sources) {
        const score = Math.round(source.score * 100);
        const title = source.document.metadata.title || source.document.metadata.source;
        lines.push(`**[${score}%] ${title}**`);
        lines.push(`> ${source.snippet}`);
        lines.push(``);
      }

      return {
        success: true,
        message: lines.join('\n'),
        data: results
      };
    } catch (error) {
      console.error("[HubAction] RAG error:", error);
      return { success: false, message: "Erreur lors de la recherche documentaire." };
    }
  },

  /**
   * [RAG_INDEXER] - Indexer les documents
   */
  async handleRagIndexer(persona: PersonaContext, source: "knowledge" | "sugu" | "all"): Promise<ActionResult> {
    if (!persona.isOwner) {
      return { success: false, message: "Accès réservé au patron." };
    }

    try {
      let indexed = 0;

      if (source === "knowledge" || source === "all") {
        indexed += await ragService.indexKnowledgeBase(persona.userId);
      }
      if (source === "sugu" || source === "all") {
        indexed += await ragService.indexSuguData();
      }

      const stats = ragService.getStats();

      return {
        success: true,
        message: `✅ Indexation terminée: ${indexed} document(s) ajouté(s)\n\n**Stats RAG:**\n- Total: ${stats.totalDocuments} documents\n- Avec embeddings: ${stats.withEmbeddings}\n- Volume: ${Math.round(stats.totalChars / 1000)}k caractères`,
        data: stats
      };
    } catch (error) {
      console.error("[HubAction] Index error:", error);
      return { success: false, message: "Erreur lors de l'indexation." };
    }
  },

  /**
   * [FLAGS_LISTE] - Liste des feature flags
   */
  async handleFlagsListe(persona: PersonaContext): Promise<ActionResult> {
    if (!persona.isOwner) {
      return { success: false, message: "Accès réservé au patron." };
    }

    try {
      const flags = featureFlagsService.getAllFlags();
      const summary = featureFlagsService.getSummary();

      const lines = [
        `**🎛️ Feature Flags**`,
        ``,
        `Total: ${summary.total} flags (${summary.enabled} actifs, ${summary.disabled} désactivés)`,
        ``
      ];

      const byCategory = new Map<string, typeof flags>();
      for (const flag of flags) {
        const cat = byCategory.get(flag.category) || [];
        cat.push(flag);
        byCategory.set(flag.category, cat);
      }

      for (const [category, catFlags] of byCategory) {
        lines.push(`**${category.toUpperCase()}:**`);
        for (const flag of catFlags) {
          const icon = flag.enabled ? '✅' : '❌';
          lines.push(`${icon} ${flag.name}`);
        }
        lines.push(``);
      }

      return {
        success: true,
        message: lines.join('\n'),
        data: { flags, summary }
      };
    } catch (error) {
      console.error("[HubAction] Flags error:", error);
      return { success: false, message: "Erreur lors de la récupération des flags." };
    }
  },

  /**
   * [FLAG_TOGGLE] - Activer/désactiver un flag
   */
  async handleFlagToggle(persona: PersonaContext, flagId: string, enabled: boolean): Promise<ActionResult> {
    if (!persona.isOwner) {
      return { success: false, message: "Accès réservé au patron." };
    }

    try {
      const success = featureFlagsService.setFlag(flagId, enabled);
      
      if (!success) {
        return { success: false, message: `Flag inconnu: ${flagId}` };
      }

      const flag = featureFlagsService.getFlag(flagId);
      const icon = enabled ? '✅' : '❌';

      return {
        success: true,
        message: `${icon} **${flag?.name}** est maintenant ${enabled ? 'activé' : 'désactivé'}.`
      };
    } catch (error) {
      console.error("[HubAction] Flag toggle error:", error);
      return { success: false, message: "Erreur lors du changement de flag." };
    }
  },

  /**
   * [SPORTS_RESUME] - Résumé sports/prédictions
   */
  async handleSportsResume(persona: PersonaContext): Promise<ActionResult> {
    if (!persona.isOwner) {
      return { success: false, message: "Accès réservé au patron." };
    }

    try {
      const { sportsCacheService } = await import("./sportsCacheService");
      const upcoming = sportsCacheService.getUpcomingMatches?.() || [];
      const recent = sportsCacheService.getRecentResults?.() || [];
      const activePredictions = sportsCacheService.getActivePredictions?.() || 0;

      const lines = [
        `**⚽ Résumé Sports**`,
        ``,
        `- ${upcoming.length} matchs à venir`,
        `- ${activePredictions} prédictions actives`,
      ];

      if (upcoming.length > 0) {
        lines.push(``, `**Prochains matchs:**`);
        for (const m of upcoming.slice(0, 5)) {
          lines.push(`- ${m.homeTeam || m.home} vs ${m.awayTeam || m.away} (${m.competition || 'N/A'})`);
        }
      }

      if (recent.length > 0) {
        lines.push(``, `**Résultats récents:**`);
        for (const r of recent.slice(0, 5)) {
          const icon = r.predictionCorrect ? '✅' : '❌';
          lines.push(`- ${icon} ${r.homeTeam || r.home} ${r.score || 'N/A'} ${r.awayTeam || r.away}`);
        }
      }

      return { success: true, message: lines.join('\n'), data: { upcoming, recent } };
    } catch (error) {
      console.error("[HubAction] Sports error:", error);
      return { success: false, message: "Erreur lors de la récupération des données sports." };
    }
  },

  /**
   * [PAIE_RESUME] - Résumé paie et RH
   */
  async handlePayrollResume(persona: PersonaContext): Promise<ActionResult> {
    if (!persona.isOwner) {
      return { success: false, message: "Accès réservé au patron." };
    }

    try {
      const { db } = await import("../db");
      const { suguEmployees, suguPayroll } = await import("@shared/schema");
      const { desc } = await import("drizzle-orm");

      const employees = await db.select().from(suguEmployees);
      const active = employees.filter((e: any) => e.isActive !== false);
      const payrolls = await db.select().from(suguPayroll).orderBy(desc(suguPayroll.id)).limit(20);

      const lines = [
        `**💰 Résumé Paie & RH**`,
        ``,
        `**Effectifs:** ${active.length}/${employees.length} employés actifs`,
        ``,
      ];

      if (payrolls.length > 0) {
        const periods = new Set(payrolls.map((p: any) => p.period));
        lines.push(`**Fiches de paie:** ${payrolls.length} (${periods.size} période${periods.size > 1 ? 's' : ''})`);
        lines.push(``);

        const latestPeriod = payrolls[0]?.period;
        const latestPayrolls = payrolls.filter((p: any) => p.period === latestPeriod);
        const totalNet = latestPayrolls.reduce((s: number, p: any) => s + (Number(p.netSalary) || 0), 0);
        const totalGross = latestPayrolls.reduce((s: number, p: any) => s + (Number(p.grossSalary) || 0), 0);

        lines.push(`**Période ${latestPeriod}:**`);
        lines.push(`- ${latestPayrolls.length} bulletins`);
        lines.push(`- Brut total: ${totalGross.toFixed(2)}€`);
        lines.push(`- Net total: ${totalNet.toFixed(2)}€`);
        lines.push(``);

        for (const p of latestPayrolls) {
          const emp = employees.find((e: any) => e.id === p.employeeId);
          const name = emp ? `${emp.firstName} ${emp.lastName}` : `Emp #${p.employeeId}`;
          lines.push(`- ${name}: ${Number(p.netSalary || 0).toFixed(2)}€ net`);
        }
      }

      return { success: true, message: lines.join('\n'), data: { employees: active.length, payrolls: payrolls.length } };
    } catch (error) {
      console.error("[HubAction] Payroll error:", error);
      return { success: false, message: "Erreur lors de la récupération des données paie." };
    }
  },

  /**
   * [APPTOORDER_STATUS] - État AppToOrder
   */
  async handleAppToOrderStatus(persona: PersonaContext): Promise<ActionResult> {
    if (!persona.isOwner) {
      return { success: false, message: "Accès réservé au patron." };
    }

    try {
      const { appToOrderMonitor } = await import("./appToOrderMonitorService");
      const status = await appToOrderMonitor.getStatus();

      const statusIcon = status.overallHealth === "healthy" ? "🟢" : status.overallHealth === "degraded" ? "🟡" : "🔴";
      const lines = [
        `**🛍️ AppToOrder Status**`,
        ``,
        `${statusIcon} État: **${(status.overallHealth || 'unknown').toUpperCase()}**`,
        `- URLs: ${status.urlsUp || 0}/${status.urlsTotal || 11} accessibles`,
      ];

      if (status.todayOrders !== undefined) {
        lines.push(`- Commandes aujourd'hui: ${status.todayOrders}`);
        lines.push(`- CA du jour: ${(status.todayRevenue || 0).toFixed(2)}€`);
      }

      if (status.lastCheck) {
        lines.push(`- Dernier check: ${new Date(status.lastCheck).toLocaleTimeString('fr-FR')}`);
      }

      if (status.degradedUrls?.length > 0) {
        lines.push(``, `**URLs en erreur:**`);
        for (const url of status.degradedUrls) {
          lines.push(`- 🔴 ${url}`);
        }
      }

      return { success: true, message: lines.join('\n'), data: status };
    } catch (error) {
      console.error("[HubAction] AppToOrder error:", error);
      return { success: false, message: "Erreur lors de la vérification AppToOrder." };
    }
  },

  /**
   * [GMAIL_RESUME] - Résumé Gmail
   */
  async handleGmailResume(persona: PersonaContext): Promise<ActionResult> {
    if (!persona.isOwner) {
      return { success: false, message: "Accès réservé au patron." };
    }

    try {
      const gmailService = await import("./googleMailService");
      const gmail = gmailService.default || gmailService;
      if (!gmail.listMessages) {
        return { success: false, message: "Service Gmail non disponible." };
      }

      const messages = await gmail.listMessages({ maxResults: 10, query: "is:unread" });
      const unreadCount = messages.resultSizeEstimate || (messages.messages || []).length;

      const lines = [
        `**📧 Résumé Gmail**`,
        ``,
        `- ${unreadCount} email${unreadCount !== 1 ? 's' : ''} non lu${unreadCount !== 1 ? 's' : ''}`,
      ];

      for (const msg of (messages.messages || []).slice(0, 5)) {
        try {
          const detail = await gmail.getMessage(msg.id);
          const from = detail?.payload?.headers?.find((h: any) => h.name === "From")?.value || "Inconnu";
          const subject = detail?.payload?.headers?.find((h: any) => h.name === "Subject")?.value || "Sans objet";
          lines.push(`- 📩 ${from.replace(/<.*>/, '').trim()}: ${subject.substring(0, 60)}`);
        } catch {}
      }

      return { success: true, message: lines.join('\n'), data: { unreadCount } };
    } catch (error) {
      console.error("[HubAction] Gmail error:", error);
      return { success: false, message: "Erreur lors de la récupération des emails." };
    }
  },

  /**
   * [PUGI_DIGEST] - Intelligence proactive PUGI
   */
  async handlePugiDigest(persona: PersonaContext): Promise<ActionResult> {
    if (!persona.isOwner) {
      return { success: false, message: "Accès réservé au patron." };
    }

    try {
      const { pugi } = await import("./proactiveGeneralIntelligence");
      const digest = pugi.getDigest(5);

      const lines = [
        `**🧠 PUGI - Intelligence Proactive**`,
        ``,
        `- ${digest.stats.totalSignals} signaux actifs`,
        `- ${digest.stats.domainsActive || 0} domaines surveillés`,
      ];

      if (digest.insights.length > 0) {
        lines.push(``, `**Insights cross-domaines:**`);
        for (const insight of digest.insights.slice(0, 5)) {
          lines.push(`- 💡 ${insight.description || insight.title}`);
        }
      }

      if (digest.topActions.length > 0) {
        lines.push(``, `**Actions recommandées:**`);
        for (const action of digest.topActions.slice(0, 5)) {
          const icon = action.priority === "critical" ? "🔴" : action.priority === "high" ? "🟠" : "🟢";
          lines.push(`- ${icon} [${action.domain}] ${action.title}`);
        }
      }

      return { success: true, message: lines.join('\n'), data: digest };
    } catch (error) {
      console.error("[HubAction] PUGI error:", error);
      return { success: false, message: "Erreur lors de la récupération PUGI." };
    }
  },

  /**
   * [SELF_HEALING_STATUS] - État auto-guérison
   */
  async handleSelfHealingStatus(persona: PersonaContext): Promise<ActionResult> {
    if (!persona.isOwner) {
      return { success: false, message: "Accès réservé au patron." };
    }

    try {
      const { selfHealingService } = await import("./selfHealingService");
      const health = selfHealingService.getHealthReport();

      const statusIcon = health.status === "healthy" ? "🟢" : health.status === "degraded" ? "🟡" : "🔴";
      const lines = [
        `**🏥 Auto-guérison & Self-Healing**`,
        ``,
        `${statusIcon} État global: **${(health.status || 'unknown').toUpperCase()}**`,
        `- Score santé: ${health.score || 100}%`,
        `- Réparations effectuées: ${health.repairCount || 0}`,
      ];

      if (health.services?.length > 0) {
        lines.push(``, `**Services surveillés:**`);
        for (const svc of health.services) {
          const icon = svc.status === "healthy" ? "🟢" : svc.status === "degraded" ? "🟡" : "🔴";
          lines.push(`- ${icon} ${svc.name}: ${svc.status}`);
        }
      }

      if (health.recentRepairs?.length > 0) {
        lines.push(``, `**Réparations récentes:**`);
        for (const repair of health.recentRepairs.slice(0, 3)) {
          lines.push(`- 🔧 ${repair.service}: ${repair.action} (${repair.success ? '✅' : '❌'})`);
        }
      }

      return { success: true, message: lines.join('\n'), data: health };
    } catch (error) {
      console.error("[HubAction] SelfHealing error:", error);
      return { success: false, message: "Erreur lors de la vérification self-healing." };
    }
  },

  /**
   * [JOURNAL_INTROSPECTION] - Dernier journal de réflexion
   */
  async handleJournalIntrospection(persona: PersonaContext): Promise<ActionResult> {
    if (!persona.isOwner) {
      return { success: false, message: "Accès réservé au patron." };
    }

    try {
      const { generateSelfReflectionJournal } = await import("./selfReflectionJournal");
      const latest = await generateSelfReflectionJournal(1);

      if (!latest) {
        return { success: true, message: "Aucune entrée de journal trouvée. Le journal de réflexion sera généré lors du prochain cycle hebdomadaire." };
      }

      const lines = [
        `**📓 Journal d'introspection**`,
        `*${new Date(latest.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}*`,
        ``,
        latest.content?.substring(0, 1500) || "Contenu non disponible",
      ];

      return { success: true, message: lines.join('\n'), data: latest };
    } catch (error) {
      console.error("[HubAction] Journal error:", error);
      return { success: false, message: "Erreur lors de la récupération du journal." };
    }
  }
};
