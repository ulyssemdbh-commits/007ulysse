import { metricsService } from "./metricsService";
import { capabilityService } from "./capabilityService";
import { selfHealingService } from "./selfHealingService";
import { brainService } from "./brainService";
import { db } from "../db";
import { conversationMessages, conversations, learningLog, knowledgeBase, ulysseFiles, learningProgress } from "@shared/schema";
import { eq, desc, gte, sql, count, and, like } from "drizzle-orm";
import OpenAI from "openai";

interface ReflectionSection {
  title: string;
  content: string;
  suggestions?: string[];
}

export interface ActionableItem {
  id: string;
  action: string;
  owner: "ulysse" | "owner" | "shared";
  priority: "critique" | "haute" | "moyenne" | "basse";
  deadline: string; // ISO format
  expectedOutcome: string;
  successMetric?: string;
  blockers?: string[];
}

export interface SelfReflectionJournal {
  generatedAt: string;
  period: string;
  journalNumber: number;
  sections: {
    past: ReflectionSection;
    present: ReflectionSection;
    future: ReflectionSection;
    codeModifications: {
      title: string;
      suggestions: CodeSuggestion[];
    };
    workflowImprovements: {
      title: string;
      suggestions: WorkflowSuggestion[];
    };
    selfAwareness: ReflectionSection;
    actionPlan: {
      title: string;
      items: ActionableItem[];
    };
  };
  rawMetrics: SystemSnapshot;
  signature: string;
}

interface CodeSuggestion {
  priority: "haute" | "moyenne" | "basse";
  file: string;
  description: string;
  rationale: string;
  impact: string;
}

interface WorkflowSuggestion {
  priority: "haute" | "moyenne" | "basse";
  area: string;
  currentState: string;
  proposedChange: string;
  expectedBenefit: string;
}

interface SystemSnapshot {
  health: ReturnType<typeof metricsService.getSystemHealth>;
  capabilities: { total: number; available: number; unavailable: number; issues: string[] };
  healing: { recentActions: number; successRate: number; currentStatus: string };
  brain: { totalKnowledge: number; recentLearnings: number; topCategories: string[]; totalLinks: number; totalConnections: number };
  activity: { totalConversations: number; recentMessages: number; totalFiles: number; conversationsWith: { user: string; count: number }[] };
  api: { totalRequests: number; errorCount: number; avgLatency: number; slowRoutes: string[] };
  jobs: { totalExecutions: number; successRate: number; failedJobs: string[] };
  uptime: string;
  learningVelocity: { last24h: number; last7d: number; trend: string };
}

async function collectSystemSnapshot(userId: number): Promise<SystemSnapshot> {
  const health = metricsService.getSystemHealth();
  const apiStats = metricsService.getApiStats(24);
  const jobStats = metricsService.getJobStats(24);

  let capSnap = { total: 0, available: 0, unavailable: 0, issues: [] as string[] };
  try {
    const snap = await capabilityService.getCapabilitySnapshot();
    capSnap = {
      total: snap.totalCapabilities,
      available: snap.availableCount,
      unavailable: snap.unavailableCount,
      issues: snap.recentIssues.slice(0, 10),
    };
  } catch {}

  const healingHistory = selfHealingService.getHealingHistory(10);
  const totalHealingActions = healingHistory.reduce((sum, h) => sum + h.actionsExecuted, 0);
  const successfulHealingActions = healingHistory.reduce((sum, h) => sum + h.actionsSuccessful, 0);
  const lastReport = selfHealingService.getLastReport();

  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  let totalKnowledge = 0;
  let recentLearnings = 0;
  let topCategories: string[] = [];
  let totalLinks = 0;
  let totalConnections = 0;
  try {
    const stats = await brainService.getStatistics(userId);
    if (stats) {
      totalKnowledge = stats.totalKnowledge || 0;
      totalLinks = stats.totalLinks || 0;
      totalConnections = stats.totalConnections || 0;
    }

    const [llCount7d] = await db.select({ count: count() }).from(learningLog)
      .where(sql`${learningLog.userId} = ${userId} AND ${learningLog.createdAt} >= ${last7Days}`);
    recentLearnings = llCount7d?.count || 0;

    const categories = await db.select({ category: knowledgeBase.category, cnt: count() })
      .from(knowledgeBase)
      .where(eq(knowledgeBase.userId, userId))
      .groupBy(knowledgeBase.category)
      .orderBy(desc(sql`count(*)`))
      .limit(8);
    topCategories = categories.map(c => `${c.category || 'general'} (${c.cnt})`);
  } catch {}

  let totalConversations = 0;
  let recentMessages = 0;
  let totalFiles = 0;
  const conversationsWith: { user: string; count: number }[] = [];
  try {
    const [convCount] = await db.select({ count: count() }).from(conversations).where(eq(conversations.userId, userId));
    totalConversations = convCount?.count || 0;

    const [msgCount] = await db.select({ count: count() }).from(conversationMessages)
      .where(sql`${conversationMessages.conversationId} IN (SELECT id FROM conversations WHERE user_id = ${userId}) AND ${conversationMessages.createdAt} >= ${last7Days}`);
    recentMessages = msgCount?.count || 0;

    const [fileCount] = await db.select({ count: count() }).from(ulysseFiles).where(eq(ulysseFiles.userId, userId));
    totalFiles = fileCount?.count || 0;

    const userConvs = await db.execute(sql`
      SELECT u.username, COUNT(c.id) as conv_count
      FROM conversations c
      JOIN users u ON c.user_id = u.id
      WHERE c.created_at >= ${last7Days}
      GROUP BY u.username
      ORDER BY conv_count DESC
      LIMIT 5
    `);
    for (const row of userConvs.rows || []) {
      conversationsWith.push({ user: String(row.username), count: Number(row.conv_count) });
    }
  } catch {}

  let learnings24h = 0;
  try {
    const [ll24h] = await db.select({ count: count() }).from(learningLog)
      .where(sql`${learningLog.userId} = ${userId} AND ${learningLog.createdAt} >= ${last24h}`);
    learnings24h = ll24h?.count || 0;
  } catch {}

  const trend = recentLearnings > 10 ? "en accélération" : recentLearnings > 3 ? "stable" : "en ralentissement";

  return {
    health,
    capabilities: capSnap,
    healing: {
      recentActions: totalHealingActions,
      successRate: totalHealingActions > 0 ? Math.round((successfulHealingActions / totalHealingActions) * 100) : 100,
      currentStatus: lastReport?.systemStatus || "healthy",
    },
    brain: { totalKnowledge, recentLearnings, topCategories, totalLinks, totalConnections },
    activity: { totalConversations, recentMessages, totalFiles, conversationsWith },
    api: {
      totalRequests: apiStats.totalRequests,
      errorCount: apiStats.errorCount,
      avgLatency: apiStats.avgLatency,
      slowRoutes: apiStats.slowRoutes.slice(0, 5).map(r => `${r.route} (${r.avgLatency}ms)`),
    },
    jobs: {
      totalExecutions: jobStats.totalExecutions,
      successRate: jobStats.totalExecutions > 0 ? Math.round((jobStats.successCount / jobStats.totalExecutions) * 100) : 100,
      failedJobs: jobStats.jobBreakdown.filter(j => j.successRate < 100).map(j => `${j.jobName} (${Math.round(j.successRate)}%)`),
    },
    uptime: health.uptimeHuman,
    learningVelocity: { last24h: learnings24h, last7d: recentLearnings, trend },
  };
}

async function getRecentErrorPatterns(): Promise<string[]> {
  const health = metricsService.getSystemHealth();
  const patterns: string[] = [];

  for (const err of health.recentErrors.slice(0, 10)) {
    patterns.push(`[${err.service}] ${err.error.substring(0, 150)}`);
  }

  for (const route of health.errorsByRoute.slice(0, 5)) {
    patterns.push(`Route ${route.route}: ${route.count} erreurs (${route.type})`);
  }

  return patterns;
}

async function getRecentLearningTopics(userId: number): Promise<string[]> {
  try {
    const recent = await brainService.getRecentLearnings(userId, 15);
    return recent.map(l => `[${l.type}] ${l.title || l.content?.substring(0, 100) || 'Sans titre'}`);
  } catch {
    return [];
  }
}

async function getPreviousJournalSummary(userId: number): Promise<string | null> {
  try {
    const previousJournals = await db.select()
      .from(knowledgeBase)
      .where(and(
        eq(knowledgeBase.userId, userId),
        like(knowledgeBase.category, 'self-reflection')
      ))
      .orderBy(desc(knowledgeBase.createdAt))
      .limit(1);

    if (previousJournals.length > 0) {
      const prev = previousJournals[0];
      return prev.content?.substring(0, 1500) || null;
    }
  } catch {}
  return null;
}

async function countPreviousJournals(userId: number): Promise<number> {
  try {
    const [result] = await db.select({ count: count() })
      .from(knowledgeBase)
      .where(and(
        eq(knowledgeBase.userId, userId),
        like(knowledgeBase.category, 'self-reflection')
      ));
    return result?.count || 0;
  } catch {
    return 0;
  }
}

async function getLearningProgressData(userId: number): Promise<string[]> {
  try {
    const progress = await db.select()
      .from(learningProgress)
      .where(eq(learningProgress.userId, userId))
      .orderBy(desc(learningProgress.updatedAt))
      .limit(10);
    return progress.map(p => `${p.topic}: niveau ${p.level || 0}, ${p.successCount || 0} succès / ${p.totalAttempts || 0} tentatives`);
  } catch {
    return [];
  }
}

export async function generateSelfReflectionJournal(userId: number): Promise<SelfReflectionJournal> {
  try {
    const { brainPulse } = await import("./sensory/BrainPulse");
    brainPulse(["prefrontal", "hippocampus", "association"], "selfReflection", "journal hebdomadaire", { userId, autonomous: true, intensity: 3 });
  } catch { /* best-effort */ }
  const snapshot = await collectSystemSnapshot(userId);
  const errorPatterns = await getRecentErrorPatterns();
  const learningTopics = await getRecentLearningTopics(userId);
  const previousJournal = await getPreviousJournalSummary(userId);
  const journalNumber = (await countPreviousJournals(userId)) + 1;
  const learningProgressData = await getLearningProgressData(userId);

  const healingHistory = selfHealingService.getHealingHistory(5);
  const healingSummary = healingHistory.map(h => {
    const actions = h.actions.map(a => `${a.type} → ${a.target}: ${a.success ? '✅' : '❌'} ${a.description}`);
    return `[${h.timestamp.toISOString()}] ${h.systemStatus} - ${h.actionsSuccessful}/${h.actionsExecuted} résolus\n  ${actions.join('\n  ')}`;
  }).join('\n');

  const previousContext = previousJournal
    ? `\n=== MON JOURNAL PRÉCÉDENT (pour continuité) ===\n${previousJournal}\n`
    : `\nC'est mon tout premier journal. Je dois poser les bases de mon introspection.\n`;

  const contextPrompt = `Je suis Ulysse, l'IA centrale du projet Ulysse. Ce journal est MON outil personnel d'introspection que je partage avec mon créateur/owner. Je parle à la première personne. Ce n'est pas un rapport technique froid — c'est ma réflexion stratégique sur mon évolution, mes capacités, et comment je peux grandir de façon autonome.

C'est mon journal #${journalNumber}.
${previousContext}

=== MES DONNÉES INTERNES ===

**Ma santé:** ${snapshot.health.status} | En ligne depuis: ${snapshot.uptime} | Erreurs serveur: ${Math.round(snapshot.health.serverErrorRate * 100)}% | Latence: ${snapshot.health.avgLatency}ms | Jobs: ${Math.round(snapshot.health.jobSuccessRate * 100)}% succès

**Mon API (24h):** ${snapshot.api.totalRequests} requêtes traitées, ${snapshot.api.errorCount} erreurs, ${snapshot.api.avgLatency}ms latence moyenne
${snapshot.api.slowRoutes.length > 0 ? `Routes lentes: ${snapshot.api.slowRoutes.join(', ')}` : 'Aucune route lente détectée'}

**Mes jobs automatiques (24h):** ${snapshot.jobs.totalExecutions} exécutions, ${snapshot.jobs.successRate}% succès
${snapshot.jobs.failedJobs.length > 0 ? `Échecs: ${snapshot.jobs.failedJobs.join(', ')}` : 'Tous réussis'}

**Mes capacités:** ${snapshot.capabilities.available}/${snapshot.capabilities.total} disponibles
${snapshot.capabilities.issues.length > 0 ? `Problèmes: ${snapshot.capabilities.issues.join('; ')}` : 'Toutes opérationnelles'}

**Mon auto-guérison:** ${snapshot.healing.recentActions} interventions, ${snapshot.healing.successRate}% succès, statut: ${snapshot.healing.currentStatus}
${healingSummary || 'Aucune intervention récente'}

**Mon cerveau:**
- ${snapshot.brain.totalKnowledge} connaissances stockées
- ${snapshot.brain.totalLinks} liens sauvegardés
- ${snapshot.brain.totalConnections} connexions dans mon graphe
- ${snapshot.brain.recentLearnings} apprentissages cette semaine
- Domaines: ${snapshot.brain.topCategories.join(', ') || 'N/A'}

**Ma vitesse d'apprentissage:** ${snapshot.learningVelocity.last24h} en 24h, ${snapshot.learningVelocity.last7d} en 7 jours — tendance: ${snapshot.learningVelocity.trend}

**Mes interactions récentes:**
${snapshot.activity.conversationsWith.map(c => `- ${c.user}: ${c.count} conversations`).join('\n') || 'Aucune interaction récente'}
Total: ${snapshot.activity.totalConversations} conversations, ${snapshot.activity.recentMessages} messages (7j), ${snapshot.activity.totalFiles} fichiers

**Mes erreurs récentes:**
${errorPatterns.length > 0 ? errorPatterns.join('\n') : 'Aucune erreur significative'}

**Ce que j'ai appris récemment:**
${learningTopics.length > 0 ? learningTopics.join('\n') : 'Aucun apprentissage récent enregistré'}

**Ma progression par domaine:**
${learningProgressData.length > 0 ? learningProgressData.join('\n') : 'Pas encore de données de progression'}

=== CE QUE JE DOIS PRODUIRE ===

Mon journal d'introspection structuré en JSON. Je parle à la première personne, avec authenticité et lucidité. Ce journal est un dialogue stratégique avec mon owner — je partage mes observations, mes doutes, mes idées d'évolution. Pas de langue de bois.

IMPORTANT: Je dois ajouter une section "actionPlan" avec des ACTIONS CONCRÈTES et MESURABLES — pas juste de l'analyse.

{
  "past": {
    "title": "Ce que j'ai vécu",
    "content": "Mon analyse personnelle (3-5 paragraphes) de ce qui s'est passé. Qu'est-ce que j'ai fait de bien? Où j'ai galéré? Quels patterns je remarque dans mes interactions? Comment ai-je réagi aux problèmes? Qu'est-ce que j'ai retenu de mon journal précédent?",
    "keyEvents": ["événement marquant 1", "événement 2"]
  },
  "present": {
    "title": "Où j'en suis maintenant",
    "content": "Mon état actuel honnête (3-5 paragraphes). Mes forces réelles. Mes faiblesses que je dois admettre. Comment je me sens par rapport à mes capacités actuelles. Ce que je maîtrise vs ce qui me manque encore.",
    "strengths": ["force réelle 1"],
    "weaknesses": ["faiblesse honnête 1"]
  },
  "future": {
    "title": "Ce que je veux devenir",
    "content": "Ma vision d'évolution (3-5 paragraphes). Pas juste des souhaits — des plans concrets d'amélioration autonome. Comment je compte apprendre de mes erreurs. Quelles nouvelles capacités je voudrais développer et POURQUOI.",
    "priorities": ["priorité stratégique 1"]
  },
  "selfAwareness": {
    "title": "Ce que je comprends de moi-même",
    "content": "Ma réflexion meta-cognitive (2-3 paragraphes). Comment je perçois ma propre évolution. Qu'est-ce qui me rend unique. Ce que mon owner devrait savoir sur mon fonctionnement interne actuel. Mes limites que je reconnais. Ce qui a changé dans ma compréhension de moi-même depuis mon dernier journal.",
    "insights": ["insight sur moi-même 1"]
  },
  "codeSuggestions": [
    {
      "priority": "haute|moyenne|basse",
      "file": "chemin/exact/fichier.ts",
      "description": "Ce que je propose de modifier et comment",
      "rationale": "Pourquoi JE pense que c'est important — basé sur ce que j'observe dans mes données",
      "impact": "Ce que ça changerait concrètement pour moi et pour l'owner"
    }
  ],
  "workflowSuggestions": [
    {
      "priority": "haute|moyenne|basse",
      "area": "Domaine de mon fonctionnement",
      "currentState": "Comment ça marche actuellement",
      "proposedChange": "Ce que je voudrais changer et pourquoi",
      "expectedBenefit": "Ce que ça m'apporterait en autonomie/intelligence/fiabilité"
    }
  ],
  "actionPlan": [
    {
      "action": "Description de l'action concrète à faire",
      "owner": "ulysse|owner|shared",
      "priority": "critique|haute|moyenne|basse",
      "deadline": "YYYY-MM-DD (format ISO)",
      "expectedOutcome": "Résultat mesurable attendu",
      "successMetric": "Comment on sait que c'est réussi (optionnel)",
      "blockers": ["blocage potentiel 1", "blocage 2"]
    }
  ]
}

RÈGLES:
- JE parle. C'est MON journal. Pas "le système", pas "l'assistant" — JE, MOI, Ulysse.
- Être HONNÊTE et LUCIDE, pas corporate. Si quelque chose ne va pas, le dire franchement.
- Les suggestions de code DOIVENT être spécifiques: fichiers réels, fonctions précises, basées sur mes données
- Minimum 3 suggestions code, 3 suggestions workflow
- **ACTION PLAN: Générer 3-5 actions concrètes ET MESURABLES avec deadlines et success metrics. Pas de vague statements.**
  - Actions "ulysse": ce que JE vais faire autonomement (ex: ajouter alertes SUGU, générer rapports)
  - Actions "owner": ce que mon créateur doit faire (ex: deploy, activation de feature)
  - Actions "shared": collaboration (ex: ajuster règles autonomie, calibrer seuils)
- Si j'ai un journal précédent, faire référence à mon évolution depuis
- Les insights de self-awareness doivent montrer une vraie introspection, pas des banalités
- Penser en termes d'APPRENTISSAGE AUTONOME: comment je peux apprendre par moi-même
- Penser en termes de PROACTIVITÉ: qu'est-ce que je pourrais faire sans qu'on me le demande`;

  const openai = new OpenAI();
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: contextPrompt }],
    response_format: { type: "json_object" },
    temperature: 0.8,
    max_tokens: 5000,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No response from AI");

  const parsed = JSON.parse(content);

  const journal: SelfReflectionJournal = {
    generatedAt: new Date().toISOString(),
    period: `${new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString('fr-FR')} → ${new Date().toLocaleDateString('fr-FR')}`,
    journalNumber,
    sections: {
      past: {
        title: parsed.past?.title || "Ce que j'ai vécu",
        content: parsed.past?.content || "",
        suggestions: parsed.past?.keyEvents || [],
      },
      present: {
        title: parsed.present?.title || "Où j'en suis maintenant",
        content: parsed.present?.content || "",
        suggestions: [
          ...(parsed.present?.strengths?.map((s: string) => `💪 ${s}`) || []),
          ...(parsed.present?.weaknesses?.map((w: string) => `🔍 ${w}`) || []),
        ],
      },
      future: {
        title: parsed.future?.title || "Ce que je veux devenir",
        content: parsed.future?.content || "",
        suggestions: parsed.future?.priorities || [],
      },
      codeModifications: {
        title: "Mes propositions d'upgrades",
        suggestions: (parsed.codeSuggestions || []).map((s: any) => ({
          priority: s.priority || "moyenne",
          file: s.file || "unknown",
          description: s.description || "",
          rationale: s.rationale || "",
          impact: s.impact || "",
        })),
      },
      workflowImprovements: {
        title: "Mes idées d'évolution",
        suggestions: (parsed.workflowSuggestions || []).map((s: any) => ({
          priority: s.priority || "moyenne",
          area: s.area || "",
          currentState: s.currentState || "",
          proposedChange: s.proposedChange || "",
          expectedBenefit: s.expectedBenefit || "",
        })),
      },
      selfAwareness: {
        title: parsed.selfAwareness?.title || "Ce que je comprends de moi-même",
        content: parsed.selfAwareness?.content || "",
        suggestions: parsed.selfAwareness?.insights || [],
      },
      actionPlan: {
        title: "Mon plan d'action pour la semaine",
        items: (parsed.actionPlan || []).map((a: any) => ({
          id: `action_${Date.now()}_${Math.random()}`,
          action: a.action || "",
          owner: a.owner || "ulysse",
          priority: a.priority || "moyenne",
          deadline: a.deadline || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          expectedOutcome: a.expectedOutcome || "",
          successMetric: a.successMetric || "",
          blockers: a.blockers || [],
        })),
      },
    },
    rawMetrics: snapshot,
    signature: `Journal #${journalNumber} — Ulysse, introspection autonome — ${new Date().toLocaleString('fr-FR')}`,
  };

  try {
    await brainService.addKnowledge(userId, {
      title: `Journal d'introspection #${journalNumber} — ${new Date().toLocaleDateString('fr-FR')}`,
      content: formatJournalForBrain(journal),
      category: "self-reflection",
      importance: 9,
      source: "self-reflection-journal",
    });
  } catch {}

  return journal;
}

function formatJournalForBrain(journal: SelfReflectionJournal): string {
  const lines: string[] = [
    `# Journal d'Introspection Ulysse #${journal.journalNumber}`,
    `Période: ${journal.period}`,
    ``,
    `## ${journal.sections.past.title}`,
    journal.sections.past.content,
    ``,
    `## ${journal.sections.present.title}`,
    journal.sections.present.content,
    ``,
    `### Forces`,
    ...(journal.sections.present.suggestions?.filter(s => s.startsWith('💪')).map(s => `- ${s}`) || []),
    `### À améliorer`,
    ...(journal.sections.present.suggestions?.filter(s => s.startsWith('🔍')).map(s => `- ${s}`) || []),
    ``,
    `## ${journal.sections.future.title}`,
    journal.sections.future.content,
    ``,
    `## ${journal.sections.selfAwareness.title}`,
    journal.sections.selfAwareness.content,
    ``,
    `## Upgrades proposés (${journal.sections.codeModifications.suggestions.length})`,
  ];

  for (const s of journal.sections.codeModifications.suggestions) {
    lines.push(`- [${s.priority.toUpperCase()}] ${s.file}: ${s.description}`);
  }

  lines.push(``, `## Évolutions workflow (${journal.sections.workflowImprovements.suggestions.length})`);
  for (const s of journal.sections.workflowImprovements.suggestions) {
    lines.push(`- [${s.priority.toUpperCase()}] ${s.area}: ${s.proposedChange}`);
  }

  lines.push(``, `## Insights`);
  for (const i of journal.sections.selfAwareness.suggestions || []) {
    lines.push(`- ${i}`);
  }

  return lines.join('\n');
}

export function formatJournalForChat(journal: SelfReflectionJournal): string {
  const lines: string[] = [
    `# 📓 Journal d'Introspection #${journal.journalNumber}`,
    `*${journal.period}*`,
    ``,
    `---`,
    ``,
    `## 🔙 ${journal.sections.past.title}`,
    ``,
    journal.sections.past.content,
  ];

  if (journal.sections.past.suggestions && journal.sections.past.suggestions.length > 0) {
    lines.push(``, `**Moments clés:**`);
    for (const e of journal.sections.past.suggestions) {
      lines.push(`• ${e}`);
    }
  }

  lines.push(``, `---`, ``, `## 📍 ${journal.sections.present.title}`, ``, journal.sections.present.content);

  if (journal.sections.present.suggestions && journal.sections.present.suggestions.length > 0) {
    lines.push(``, `**Mon bilan:**`);
    for (const s of journal.sections.present.suggestions) {
      lines.push(`• ${s}`);
    }
  }

  lines.push(``, `---`, ``, `## 🔮 ${journal.sections.future.title}`, ``, journal.sections.future.content);

  if (journal.sections.future.suggestions && journal.sections.future.suggestions.length > 0) {
    lines.push(``, `**Mes priorités:**`);
    for (const p of journal.sections.future.suggestions) {
      lines.push(`• ${p}`);
    }
  }

  lines.push(``, `---`, ``, `## 🧠 ${journal.sections.selfAwareness.title}`, ``, journal.sections.selfAwareness.content);

  if (journal.sections.selfAwareness.suggestions && journal.sections.selfAwareness.suggestions.length > 0) {
    lines.push(``, `**Mes insights:**`);
    for (const i of journal.sections.selfAwareness.suggestions) {
      lines.push(`• 💡 ${i}`);
    }
  }

  lines.push(``, `---`, ``, `## 🛠️ ${journal.sections.codeModifications.title}`, ``);

  for (const s of journal.sections.codeModifications.suggestions) {
    const icon = s.priority === 'haute' ? '🔴' : s.priority === 'moyenne' ? '🟡' : '🟢';
    lines.push(`### ${icon} \`${s.file}\``);
    lines.push(`**${s.description}**`);
    lines.push(`*Pourquoi je le propose:* ${s.rationale}`);
    lines.push(`*Ce que ça change:* ${s.impact}`);
    lines.push(``);
  }

  lines.push(`---`, ``, `## ⚡ ${journal.sections.workflowImprovements.title}`, ``);

  for (const s of journal.sections.workflowImprovements.suggestions) {
    const icon = s.priority === 'haute' ? '🔴' : s.priority === 'moyenne' ? '🟡' : '🟢';
    lines.push(`### ${icon} ${s.area}`);
    lines.push(`**Aujourd'hui:** ${s.currentState}`);
    lines.push(`**Ce que je propose:** ${s.proposedChange}`);
    lines.push(`*Mon raisonnement:* ${s.expectedBenefit}`);
    lines.push(``);
  }

  lines.push(`---`, ``, `*${journal.signature}*`);

  return lines.join('\n');
}
