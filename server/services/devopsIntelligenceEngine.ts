import { db } from "../db";
import { knowledgeBase, knowledgeGraph, learningLog } from "@shared/schema";
import { eq, and, desc, sql, ilike, or } from "drizzle-orm";

// ═══════════════════════════════════════════════════════════════════════════
// DEVOPS INTELLIGENCE ENGINE
// 4 algorithmes sur mesure pour Ulysse:
//   1. BRAIN_IMPACT_MAP   — graphe de dépendances enrichi (fichier → domaines)
//   2. ULYSSE_CI_ORACLE   — scoring de risque par changement
//   3. AUTO_PATCH_ADVISOR  — génération + ranking de patchs
//   4. HOMEWORK_BRAIN_PLANNER — auto-apprentissage depuis les échecs
// ═══════════════════════════════════════════════════════════════════════════

// Domain mapping: file patterns → business domains
const DOMAIN_PATTERNS: Record<string, { patterns: RegExp[]; criticality: number }> = {
  sugu_finance: {
    patterns: [/suguval/i, /sugumaillane/i, /sugu.*service/i, /sugu.*route/i, /suguManagement/i, /sugu_/i],
    criticality: 95,
  },
  brain_memory: {
    patterns: [/brain/i, /knowledge/i, /memory/i, /learning/i, /selfReflection/i, /autonomousLearning/i],
    criticality: 90,
  },
  auth_security: {
    patterns: [/auth/i, /session/i, /security/i, /permission/i, /middleware.*auth/i, /login/i],
    criticality: 100,
  },
  football_sports: {
    patterns: [/sport/i, /football/i, /footdatas/i, /prediction/i, /odds/i, /bets/i, /match/i],
    criticality: 60,
  },
  email_comms: {
    patterns: [/email/i, /gmail/i, /agentmail/i, /discord/i, /notification/i, /telegram/i],
    criticality: 70,
  },
  devops_infra: {
    patterns: [/devops/i, /github/i, /deploy/i, /ci.*cd/i, /workflow/i, /docker/i, /server.*deploy/i],
    criticality: 85,
  },
  voice_ai: {
    patterns: [/voice/i, /tts/i, /stt/i, /piper/i, /speaker/i, /geminiLive/i, /whisper/i],
    criticality: 50,
  },
  ui_frontend: {
    patterns: [/client\/src/i, /component/i, /\.tsx$/i, /hook/i, /page/i],
    criticality: 40,
  },
  database_schema: {
    patterns: [/schema\.ts/i, /drizzle/i, /migration/i, /db\.ts/i, /storage\.ts/i],
    criticality: 95,
  },
  monitoring_healing: {
    patterns: [/monitoring/i, /selfHealing/i, /diagnostic/i, /capability/i, /metric/i, /kpi/i],
    criticality: 75,
  },
  task_system: {
    patterns: [/taskQueue/i, /homework/i, /scheduledJob/i, /jobScheduler/i, /workJournal/i],
    criticality: 70,
  },
  integrations: {
    patterns: [/hubrise/i, /todoist/i, /notion/i, /spotify/i, /apptoorder/i, /connector/i],
    criticality: 65,
  },
  sensory_system: {
    patterns: [/sensory/i, /ActionHub/i, /HearingHub/i, /VisionHub/i, /BrainHub/i, /VoiceOutput/i],
    criticality: 80,
  },
  conversations: {
    patterns: [/conversation/i, /chat/i, /persona/i, /prompt/i, /systemPrompt/i],
    criticality: 85,
  },
};

// Historical fragility data — exact filename match first, regex fallback for variants
const FRAGILE_MODULES: Array<{ match: string | RegExp; fragility: number; reason: string }> = [
  { match: "conversations.ts", fragility: 90, reason: "3000+ lignes, prompt injection multi-couches, facile à casser" },
  { match: "ulysseToolsServiceV2.ts", fragility: 85, reason: "150KB, 79+ tools, switch géant, toute erreur = outil cassé" },
  { match: "DevOps.tsx", fragility: 80, reason: "5800+ lignes, UI complexe, proxy iframe, chat intégré" },
  { match: "scheduledJobs.ts", fragility: 75, reason: "2200+ lignes, 55 jobs, timing critique, dépendances croisées" },
  { match: /^sugu(?:val|maillane)Service\.ts$/, fragility: 70, reason: "Gestion financière réelle, erreur = impact business" },
  { match: "schema.ts", fragility: 95, reason: "Schéma DB central, tout le projet en dépend" },
  { match: "brainService.ts", fragility: 80, reason: "Mémoire centrale d'Ulysse, perte = amnésie" },
  { match: "taskQueueEngine.ts", fragility: 65, reason: "Exécution autonome, watchdog, timing" },
  { match: "actionIntentDetector.ts", fragility: 70, reason: "Routage des outils, mauvaise détection = mauvais outil" },
  { match: "devopsIntelligenceEngine.ts", fragility: 60, reason: "Intelligence DevOps, erreur = mauvaise analyse de risque" },
  { match: "githubService.ts", fragility: 65, reason: "Connexion GitHub, erreur = pas de push/PR/review" },
];

function findFragileModule(basename: string): { fragility: number; reason: string } | null {
  for (const mod of FRAGILE_MODULES) {
    if (typeof mod.match === "string") {
      if (basename === mod.match) return { fragility: mod.fragility, reason: mod.reason };
    } else {
      if (mod.match.test(basename)) return { fragility: mod.fragility, reason: mod.reason };
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. BRAIN_IMPACT_MAP — Graphe de dépendances enrichi
// ═══════════════════════════════════════════════════════════════════════════

export interface ImpactNode {
  file: string;
  domains: string[];
  criticality: number;
  imports: string[];
  exports: string[];
  type: "service" | "route" | "component" | "schema" | "tool" | "config" | "test" | "other";
}

export interface ImpactEdge {
  from: string;
  to: string;
  type: "imports" | "calls" | "uses_schema" | "triggers" | "depends_on";
  strength: number;
}

export interface ImpactMap {
  nodes: ImpactNode[];
  edges: ImpactEdge[];
  domainSummary: Record<string, { files: number; avgCriticality: number; keyFiles: string[] }>;
  generatedAt: string;
}

export function buildImpactMap(files: Array<{ path: string; content?: string }>): ImpactMap {
  const nodes: ImpactNode[] = [];
  const edges: ImpactEdge[] = [];

  for (const file of files) {
    const domains = detectDomains(file.path);
    const criticality = calculateFileCriticality(file.path, domains);
    const fileType = classifyFileType(file.path);

    const node: ImpactNode = {
      file: file.path,
      domains,
      criticality,
      imports: [],
      exports: [],
      type: fileType,
    };

    if (file.content) {
      node.imports = extractImports(file.content);
      node.exports = extractExports(file.content);

      for (const imp of node.imports) {
        edges.push({
          from: file.path,
          to: imp,
          type: "imports",
          strength: 70,
        });
      }

      const schemaRefs = extractSchemaReferences(file.content);
      for (const ref of schemaRefs) {
        edges.push({
          from: file.path,
          to: "shared/schema/index.ts",
          type: "uses_schema",
          strength: 80,
        });
      }
    }

    nodes.push(node);
  }

  const domainSummary: ImpactMap["domainSummary"] = {};
  for (const [domain] of Object.entries(DOMAIN_PATTERNS)) {
    const domainNodes = nodes.filter(n => n.domains.includes(domain));
    if (domainNodes.length > 0) {
      domainSummary[domain] = {
        files: domainNodes.length,
        avgCriticality: Math.round(domainNodes.reduce((s, n) => s + n.criticality, 0) / domainNodes.length),
        keyFiles: domainNodes
          .sort((a, b) => b.criticality - a.criticality)
          .slice(0, 5)
          .map(n => n.file),
      };
    }
  }

  return {
    nodes,
    edges,
    domainSummary,
    generatedAt: new Date().toISOString(),
  };
}

export function analyzeImpact(filePaths: string[], impactMap: ImpactMap): {
  directlyAffected: string[];
  domainsImpacted: Record<string, number>;
  riskLevel: "low" | "medium" | "high" | "critical";
  cascadeDepth: number;
  explanation: string;
} {
  const affected = new Set<string>();
  const domainsImpacted: Record<string, number> = {};

  for (const fp of filePaths) {
    affected.add(fp);
    const domains = detectDomains(fp);
    domains.forEach(d => { domainsImpacted[d] = (domainsImpacted[d] || 0) + 1; });

    const outgoing = impactMap.edges.filter(e => e.from === fp || e.to === fp);
    for (const edge of outgoing) {
      const other = edge.from === fp ? edge.to : edge.from;
      affected.add(other);
      detectDomains(other).forEach(d => { domainsImpacted[d] = (domainsImpacted[d] || 0) + 1; });
    }
  }

  // Cascade: level 2
  const level2 = new Set<string>();
  for (const af of affected) {
    const edges2 = impactMap.edges.filter(e => e.from === af || e.to === af);
    edges2.forEach(e => {
      level2.add(e.from === af ? e.to : e.from);
    });
  }

  const maxCrit = filePaths.reduce((max, fp) => {
    const node = impactMap.nodes.find(n => n.file === fp);
    return Math.max(max, node?.criticality || 0);
  }, 0);

  const domainCount = Object.keys(domainsImpacted).length;
  const riskLevel = maxCrit >= 90 || domainCount >= 4 ? "critical"
    : maxCrit >= 70 || domainCount >= 3 ? "high"
    : maxCrit >= 50 || domainCount >= 2 ? "medium" : "low";

  const explanation = `${filePaths.length} fichier(s) modifié(s) → ${affected.size} fichiers directement affectés, ${level2.size} en cascade L2. ${domainCount} domaine(s) impacté(s): ${Object.keys(domainsImpacted).join(", ")}. Criticité max: ${maxCrit}/100.`;

  return {
    directlyAffected: [...affected],
    domainsImpacted,
    riskLevel,
    cascadeDepth: level2.size > affected.size ? 2 : 1,
    explanation,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. ULYSSE_CI_ORACLE — Prédiction de risque par changement
// ═══════════════════════════════════════════════════════════════════════════

export interface CIRiskScore {
  overall: number; // 0-100
  breakdown: {
    fileSensitivity: number;
    changeVolume: number;
    domainCriticality: number;
    historicalFragility: number;
    crossDomainRisk: number;
  };
  riskLevel: "safe" | "caution" | "risky" | "dangerous";
  warnings: string[];
  recommendations: string[];
}

export function calculateCIRisk(changes: Array<{
  file: string;
  linesAdded: number;
  linesRemoved: number;
  changeType: "create" | "modify" | "delete";
}>): CIRiskScore {
  const warnings: string[] = [];
  const recommendations: string[] = [];

  // Factor 1: File sensitivity (which files are touched)
  let fileSensitivity = 0;
  for (const change of changes) {
    const basename = change.file.split("/").pop() || "";
    const fragile = findFragileModule(basename);
    if (fragile) {
      fileSensitivity = Math.max(fileSensitivity, fragile.fragility);
      warnings.push(`⚠️ ${basename}: ${fragile.reason}`);
    }
    if (change.changeType === "delete") {
      fileSensitivity = Math.max(fileSensitivity, 70);
      warnings.push(`🗑️ Suppression de ${basename} — vérifier les imports`);
    }
  }
  if (fileSensitivity === 0) {
    fileSensitivity = changes.some(c => c.file.includes("server/")) ? 40 : 20;
  }

  // Factor 2: Change volume
  const totalLines = changes.reduce((s, c) => s + c.linesAdded + c.linesRemoved, 0);
  const changeVolume = Math.min(100, Math.round(
    totalLines < 10 ? 10 :
    totalLines < 50 ? 30 :
    totalLines < 200 ? 50 :
    totalLines < 500 ? 70 :
    totalLines < 1000 ? 85 : 95
  ));
  if (totalLines > 500) {
    warnings.push(`📏 ${totalLines} lignes changées — changement massif, risque élevé de régressions`);
    recommendations.push("Diviser en commits plus petits et ciblés");
  }

  // Factor 3: Domain criticality
  const allDomains = new Set<string>();
  for (const change of changes) {
    detectDomains(change.file).forEach(d => allDomains.add(d));
  }
  const domainCrits = [...allDomains].map(d => DOMAIN_PATTERNS[d]?.criticality || 30);
  const domainCriticality = domainCrits.length > 0 ? Math.round(domainCrits.reduce((a, b) => a + b, 0) / domainCrits.length) : 20;

  // Factor 4: Historical fragility
  let historicalFragility = 0;
  for (const change of changes) {
    const basename = change.file.split("/").pop() || "";
    const fragile = findFragileModule(basename);
    if (fragile) {
      historicalFragility = Math.max(historicalFragility, fragile.fragility);
    }
  }

  // Factor 5: Cross-domain risk (touching multiple critical domains = more risk)
  const criticalDomains = [...allDomains].filter(d => (DOMAIN_PATTERNS[d]?.criticality || 0) >= 80);
  const crossDomainRisk = Math.min(100, criticalDomains.length * 25);
  if (criticalDomains.length >= 2) {
    warnings.push(`🔀 ${criticalDomains.length} domaines critiques touchés: ${criticalDomains.join(", ")} — risque de cascade`);
    recommendations.push("Tester chaque domaine séparément après le merge");
  }

  // Weighted overall score
  const overall = Math.round(
    fileSensitivity * 0.30 +
    changeVolume * 0.15 +
    domainCriticality * 0.25 +
    historicalFragility * 0.15 +
    crossDomainRisk * 0.15
  );

  const riskLevel = overall >= 75 ? "dangerous" : overall >= 55 ? "risky" : overall >= 35 ? "caution" : "safe";

  if (riskLevel === "safe") {
    recommendations.push("Changement safe — peut être mergé avec confiance");
  } else if (riskLevel === "caution") {
    recommendations.push("Vérifier les cas limites et tester les endpoints concernés");
  } else if (riskLevel === "risky") {
    recommendations.push("Test approfondi recommandé avant merge");
    recommendations.push("Préparer un plan de rollback");
  } else {
    recommendations.push("⚠️ REVIEW OBLIGATOIRE avant merge");
    recommendations.push("Préparer un rollback rapide");
    recommendations.push("Tester en staging si possible");
  }

  return {
    overall,
    breakdown: {
      fileSensitivity,
      changeVolume,
      domainCriticality,
      historicalFragility,
      crossDomainRisk,
    },
    riskLevel,
    warnings,
    recommendations,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. AUTO_PATCH_ADVISOR — Génération + ranking de patchs
// ═══════════════════════════════════════════════════════════════════════════

export interface PatchCandidate {
  level: "minimal" | "moderate" | "structural";
  description: string;
  changes: Array<{ file: string; action: string; detail: string }>;
  riskScore: number;
  benefit: string;
  effort: "low" | "medium" | "high";
  recommendation: string;
}

export interface PatchAdvice {
  problem: string;
  affectedDomains: string[];
  patches: PatchCandidate[];
  bestChoice: string;
  reasoning: string;
}

export function generatePatchAdvice(
  problem: string,
  affectedFiles: string[],
  bugType: "performance" | "bug" | "security" | "refactor" | "feature"
): PatchAdvice {
  const affectedDomains = [...new Set(affectedFiles.flatMap(f => detectDomains(f)))];
  const maxCriticality = affectedFiles.length > 0
    ? Math.max(...affectedFiles.map(f => calculateFileCriticality(f, detectDomains(f))))
    : 0;

  const patches: PatchCandidate[] = [];

  // Patch A: Minimal fix
  patches.push({
    level: "minimal",
    description: `Fix ciblé: corriger le problème directement dans ${affectedFiles.length <= 2 ? affectedFiles.join(", ") : affectedFiles.length + " fichiers"}`,
    changes: affectedFiles.map(f => ({
      file: f,
      action: bugType === "bug" ? "fix" : bugType === "performance" ? "optimize" : "patch",
      detail: `Correction directe dans ${f.split("/").pop()}`,
    })),
    riskScore: Math.min(30, maxCriticality * 0.3),
    benefit: "Résolution rapide avec surface de changement minimale",
    effort: "low",
    recommendation: maxCriticality > 80 ? "RECOMMANDÉ — zone critique, moins on touche mieux c'est" : "Bon pour les urgences",
  });

  // Patch B: Moderate refactor
  patches.push({
    level: "moderate",
    description: `Refactor léger: améliorer la logique + ajouter des guards/validation`,
    changes: [
      ...affectedFiles.map(f => ({
        file: f,
        action: "refactor",
        detail: `Restructurer la logique dans ${f.split("/").pop()}`,
      })),
      ...(bugType === "bug" || bugType === "security" ? [{
        file: "tests/",
        action: "add",
        detail: "Ajouter des tests pour les cas limites détectés",
      }] : []),
    ],
    riskScore: Math.min(60, maxCriticality * 0.5),
    benefit: "Meilleure maintenabilité + résout le problème de fond",
    effort: "medium",
    recommendation: "Bon compromis risque/bénéfice pour du long terme",
  });

  // Patch C: Structural refactor
  if (bugType !== "security" || maxCriticality < 90) {
    const shouldSplit = affectedFiles.some(f => {
      const basename = f.split("/").pop() || "";
      return FRAGILE_MODULES[basename]?.fragility >= 70;
    });

    patches.push({
      level: "structural",
      description: shouldSplit
        ? `Refactor structurant: découper les fichiers volumineux + créer des services dédiés`
        : `Refactor structurant: revoir l'architecture du module`,
      changes: [
        ...affectedFiles.map(f => ({
          file: f,
          action: "restructure",
          detail: shouldSplit ? `Extraire les responsabilités de ${f.split("/").pop()} en sous-modules` : `Refondre ${f.split("/").pop()}`,
        })),
        {
          file: "server/services/",
          action: "create",
          detail: "Créer un service dédié pour isoler la logique",
        },
      ],
      riskScore: Math.min(85, maxCriticality * 0.8),
      benefit: "Maintenabilité long terme, dette technique réduite, testabilité améliorée",
      effort: "high",
      recommendation: "À planifier sur un sprint dédié, pas en urgence",
    });
  }

  // Best choice reasoning
  let bestChoice: string;
  let reasoning: string;
  if (bugType === "security" || maxCriticality >= 90) {
    bestChoice = "Patch A (minimal)";
    reasoning = "Zone critique / sécurité — fix chirurgical, minimum de risque. Refactor à planifier séparément.";
  } else if (bugType === "performance") {
    bestChoice = "Patch B (moderate)";
    reasoning = "Les problèmes de perf se résolvent rarement avec un one-liner. Le refactor léger cible la cause racine.";
  } else if (affectedDomains.length >= 3) {
    bestChoice = "Patch A (minimal) puis Patch C (structural) planifié";
    reasoning = `${affectedDomains.length} domaines touchés — fix immédiat pour stabiliser, puis refactor structurant pour dé-coupler.`;
  } else {
    bestChoice = "Patch B (moderate)";
    reasoning = "Bon ratio risque/bénéfice. Résout le problème + améliore la base.";
  }

  return {
    problem,
    affectedDomains,
    patches,
    bestChoice,
    reasoning,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. HOMEWORK_BRAIN_PLANNER — Auto-apprentissage depuis les échecs
// ═══════════════════════════════════════════════════════════════════════════

export interface LearningGap {
  domain: string;
  topic: string;
  severity: "critical" | "important" | "minor";
  evidence: string;
  suggestedAction: "create_homework" | "add_knowledge" | "create_veille" | "consolidate_docs";
  homeworkSuggestion?: {
    title: string;
    type: "hourly" | "daily" | "weekly";
    toolName: string;
    toolArgs: Record<string, any>;
  };
}

export async function analyzeLearningGaps(userId: number): Promise<LearningGap[]> {
  const gaps: LearningGap[] = [];

  try {
    // 1. Check for failed tool executions (from action_logs or usage_events)
    const recentFailures = await db.execute(sql`
      SELECT feature as tool_name, error_message, COUNT(*) as fail_count
      FROM ai_usage_events 
      WHERE user_id = ${userId} 
        AND success = false 
        AND timestamp > NOW() - INTERVAL '7 days'
      GROUP BY feature, error_message
      HAVING COUNT(*) >= 2
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `).catch(() => ({ rows: [] }));

    for (const row of (recentFailures as any).rows || []) {
      const toolDomains = detectDomains(row.tool_name || "");
      gaps.push({
        domain: toolDomains[0] || "general",
        topic: `Échecs répétés de ${row.tool_name} (${row.fail_count}x)`,
        severity: (row.fail_count as number) >= 5 ? "critical" : "important",
        evidence: `${row.fail_count} échecs en 7 jours. Erreur: ${(row.error_message || "").substring(0, 100)}`,
        suggestedAction: "create_homework",
        homeworkSuggestion: {
          title: `Monitorer et diagnostiquer ${row.tool_name}`,
          type: "daily",
          toolName: row.tool_name as string,
          toolArgs: { action: "status" },
        },
      });
    }

    // 2. Check for knowledge gaps (domains with low knowledge count)
    const knowledgeCounts = await db.execute(sql`
      SELECT category, COUNT(*) as count, AVG(confidence) as avg_confidence
      FROM knowledge_base
      WHERE user_id = ${userId}
      GROUP BY category
    `).catch(() => ({ rows: [] }));

    const knowledgeByCategory = new Map<string, { count: number; avgConf: number }>();
    for (const row of (knowledgeCounts as any).rows || []) {
      knowledgeByCategory.set(row.category as string, {
        count: Number(row.count),
        avgConf: Number(row.avg_confidence || 50),
      });
    }

    // Identify weak domains
    const criticalDomains = ["technical", "business", "personal"];
    for (const domain of criticalDomains) {
      const data = knowledgeByCategory.get(domain);
      if (!data || data.count < 10) {
        gaps.push({
          domain,
          topic: `Connaissances insuffisantes dans le domaine "${domain}"`,
          severity: "important",
          evidence: `Seulement ${data?.count || 0} entrées (confiance moy: ${data?.avgConf?.toFixed(0) || "N/A"}%)`,
          suggestedAction: "create_veille",
          homeworkSuggestion: {
            title: `Veille ${domain}: enrichir les connaissances`,
            type: "weekly",
            toolName: "web_search",
            toolArgs: { query: `best practices ${domain} AI assistant 2026` },
          },
        });
      } else if (data.avgConf < 60) {
        gaps.push({
          domain,
          topic: `Confiance faible dans le domaine "${domain}"`,
          severity: "minor",
          evidence: `${data.count} entrées mais confiance moyenne de ${data.avgConf.toFixed(0)}%`,
          suggestedAction: "consolidate_docs",
        });
      }
    }

    // 3. Check for stale learning (no recent learning in important areas)
    const recentLearning = await db.execute(sql`
      SELECT topic, learning_type, created_at
      FROM learning_log
      WHERE user_id = ${userId}
        AND created_at > NOW() - INTERVAL '14 days'
      ORDER BY created_at DESC
      LIMIT 50
    `).catch(() => ({ rows: [] }));

    const recentTopics = new Set(((recentLearning as any).rows || []).map((r: any) => r.topic?.toLowerCase()));

    const importantTopics = ["devops", "sugu", "football", "finance", "security", "performance"];
    for (const topic of importantTopics) {
      const hasRecent = [...recentTopics].some(t => t?.includes(topic));
      if (!hasRecent) {
        gaps.push({
          domain: topic,
          topic: `Aucun apprentissage récent sur "${topic}" (14 jours)`,
          severity: "minor",
          evidence: `Pas de learning_log contenant "${topic}" dans les 2 dernières semaines`,
          suggestedAction: "create_homework",
          homeworkSuggestion: {
            title: `Auto-learning: explorer les nouveautés ${topic}`,
            type: "weekly",
            toolName: "web_search",
            toolArgs: { query: `${topic} latest trends best practices 2026` },
          },
        });
      }
    }

    // 4. Detect conversation patterns where Ulysse struggled
    const lowConfidenceResponses = await db.execute(sql`
      SELECT content, created_at
      FROM conversation_messages
      WHERE user_id = ${userId}
        AND role = 'assistant'
        AND created_at > NOW() - INTERVAL '7 days'
        AND (
          content ILIKE '%je ne sais pas%' OR
          content ILIKE '%je ne peux pas%' OR
          content ILIKE '%pas encore disponible%' OR
          content ILIKE '%erreur%' OR
          content ILIKE '%impossible%'
        )
      ORDER BY created_at DESC
      LIMIT 10
    `).catch(() => ({ rows: [] }));

    if (((lowConfidenceResponses as any).rows || []).length >= 3) {
      gaps.push({
        domain: "general",
        topic: "Réponses incertaines fréquentes",
        severity: "important",
        evidence: `${((lowConfidenceResponses as any).rows || []).length} réponses avec "je ne sais pas/je ne peux pas/erreur" en 7 jours`,
        suggestedAction: "add_knowledge",
      });
    }

  } catch (err: any) {
    console.error("[HomeworkPlanner] Error analyzing gaps:", err.message);
  }

  return gaps.sort((a, b) => {
    const sevOrder = { critical: 0, important: 1, minor: 2 };
    return sevOrder[a.severity] - sevOrder[b.severity];
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// UNIFIED DEVOPS INTELLIGENCE — Combine all 4 engines
// ═══════════════════════════════════════════════════════════════════════════

export interface DevOpsIntelligenceReport {
  impactMap?: ImpactMap;
  ciRisk?: CIRiskScore;
  patchAdvice?: PatchAdvice;
  learningGaps?: LearningGap[];
  timestamp: string;
}

export async function runFullDevOpsIntelligence(
  userId: number,
  options: {
    files?: Array<{ path: string; content?: string }>;
    changes?: Array<{ file: string; linesAdded: number; linesRemoved: number; changeType: "create" | "modify" | "delete" }>;
    problem?: string;
    bugType?: "performance" | "bug" | "security" | "refactor" | "feature";
  }
): Promise<DevOpsIntelligenceReport> {
  const report: DevOpsIntelligenceReport = { timestamp: new Date().toISOString() };

  if (options.files?.length) {
    report.impactMap = buildImpactMap(options.files);
    console.log(`[DevOpsIntel] ImpactMap: ${report.impactMap.nodes.length} nodes, ${report.impactMap.edges.length} edges, ${Object.keys(report.impactMap.domainSummary).length} domains`);
  }

  if (options.changes?.length) {
    report.ciRisk = calculateCIRisk(options.changes);
    console.log(`[DevOpsIntel] CI Oracle: risk=${report.ciRisk.overall}/100 (${report.ciRisk.riskLevel}), ${report.ciRisk.warnings.length} warnings`);
  }

  if (options.problem && options.changes?.length) {
    const affectedFiles = options.changes.map(c => c.file);
    report.patchAdvice = generatePatchAdvice(options.problem, affectedFiles, options.bugType || "bug");
    console.log(`[DevOpsIntel] PatchAdvisor: ${report.patchAdvice.patches.length} patches, best=${report.patchAdvice.bestChoice}`);
  }

  report.learningGaps = await analyzeLearningGaps(userId);
  console.log(`[DevOpsIntel] BrainPlanner: ${report.learningGaps.length} gaps found`);

  // Store report in Brain + Work Journal for future reference
  try {
    const { brainService } = await import("./brainService");
    const reportSummary = {
      ciRisk: report.ciRisk ? { overall: report.ciRisk.overall, riskLevel: report.ciRisk.riskLevel } : null,
      domainsAnalyzed: report.impactMap ? Object.keys(report.impactMap.domainSummary) : [],
      learningGapsCount: report.learningGaps.length,
      patchAdvice: report.patchAdvice ? { bestChoice: report.patchAdvice.bestChoice } : null,
    };
    await brainService.addKnowledge(userId, {
      title: `DevOps Intelligence Report ${new Date().toLocaleDateString("fr-FR")}`,
      content: JSON.stringify(reportSummary),
      type: "fact",
      category: "technical",
      importance: 70,
      confidence: 90,
    });

    const { workJournalService } = await import("./workJournalService");
    const riskLabel = report.ciRisk ? `Risk: ${report.ciRisk.overall}/100 (${report.ciRisk.riskLevel})` : "";
    const patchLabel = report.patchAdvice ? `Best patch: ${report.patchAdvice.bestChoice}` : "";
    const gapsLabel = report.learningGaps?.length ? `${report.learningGaps.length} lacune(s)` : "";
    await workJournalService.addEntry(userId, {
      title: `Analyse DevOps Intelligence`,
      content: [riskLabel, patchLabel, gapsLabel].filter(Boolean).join(" | "),
      entryType: "note",
      context: "devops",
      tags: ["devops-intel", "auto"],
      status: "done",
      outcome: report.ciRisk ? `Score risque: ${report.ciRisk.overall}/100` : "Analyse complète",
    });
  } catch {}

  return report;
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function detectDomains(filePath: string): string[] {
  const domains: string[] = [];
  for (const [domain, config] of Object.entries(DOMAIN_PATTERNS)) {
    if (config.patterns.some(p => p.test(filePath))) {
      domains.push(domain);
    }
  }
  return domains.length > 0 ? domains : ["general"];
}

function calculateFileCriticality(filePath: string, domains: string[]): number {
  const basename = filePath.split("/").pop() || "";
  const fragile = findFragileModule(basename);
  const domainCrit = domains.length > 0 ? Math.max(...domains.map(d => DOMAIN_PATTERNS[d]?.criticality || 30), 30) : 30;
  const fragilityCrit = fragile?.fragility || 30;
  return Math.round(Math.max(domainCrit, fragilityCrit));
}

function classifyFileType(filePath: string): ImpactNode["type"] {
  if (/service/i.test(filePath)) return "service";
  if (/route/i.test(filePath) || /api\//i.test(filePath)) return "route";
  if (/\.tsx$/i.test(filePath) || /component/i.test(filePath)) return "component";
  if (/schema/i.test(filePath)) return "schema";
  if (/tool/i.test(filePath)) return "tool";
  if (/config/i.test(filePath) || /\.json$/i.test(filePath)) return "config";
  if (/test/i.test(filePath) || /spec/i.test(filePath)) return "test";
  return "other";
}

// Best-effort import extraction — couvre import/from/require/dynamic import
// Pour un graphe 100% fiable, un parser TS (ts-morph) serait nécessaire
function extractImports(content: string): string[] {
  const imports: string[] = [];
  const patterns = [
    /import\s+(?:type\s+)?(?:\{[^}]*\}|[^{}\s]+)\s+from\s+["']([^"']+)["']/g,
    /import\s+["']([^"']+)["']/g,
    /from\s+["']([^"']+)["']/g,
    /require\s*\(\s*["']([^"']+)["']\s*\)/g,
    /await\s+import\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      if (match[1] && !match[1].startsWith("http")) {
        imports.push(match[1]);
      }
    }
  }
  return [...new Set(imports)];
}

function extractExports(content: string): string[] {
  const exports: string[] = [];
  const exportRegex = /export\s+(?:async\s+)?(?:function|class|const|let|interface|type|enum)\s+(\w+)/g;
  let match;
  while ((match = exportRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }
  return [...new Set(exports)];
}

function extractSchemaReferences(content: string): string[] {
  const refs: string[] = [];
  const schemaRegex = /(?:from\s+["']@shared\/schema["']|knowledgeBase|conversationMessages|taskQueues|workJournal|users|sessions)/g;
  let match;
  while ((match = schemaRegex.exec(content)) !== null) {
    refs.push(match[0]);
  }
  return [...new Set(refs)];
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. CODE REVIEW AI — Analyse structurée d'un diff
// ═══════════════════════════════════════════════════════════════════════════

export interface CodeReviewIssue {
  severity: "critical" | "warning" | "info" | "style";
  file: string;
  description: string;
  category: "bug" | "security" | "performance" | "logic" | "convention" | "maintainability" | "error_handling";
}

export function analyzeDiffForReview(files: Array<{
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}>): {
  issues: CodeReviewIssue[];
  summary: string;
  verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  score: number;
} {
  const issues: CodeReviewIssue[] = [];

  for (const file of files) {
    const patch = file.patch || "";
    const basename = file.filename.split("/").pop() || "";

    if (patch.includes("console.log") && !basename.includes("test") && !basename.includes("spec")) {
      issues.push({ severity: "style", file: file.filename, description: "console.log trouvé — à retirer avant merge", category: "convention" });
    }

    if (/password|secret|token|apikey|api_key/i.test(patch) && /[=:].*['"][^'"]{8,}['"]/i.test(patch)) {
      issues.push({ severity: "critical", file: file.filename, description: "Potentiel secret/mot de passe hardcodé détecté", category: "security" });
    }

    if (/catch\s*\(\s*\w*\s*\)\s*\{\s*\}/m.test(patch)) {
      issues.push({ severity: "warning", file: file.filename, description: "Catch vide — les erreurs sont silencieusement ignorées", category: "error_handling" });
    }

    if (/any(?:\s|,|\)|\]|;)/g.test(patch) && /\.ts$/i.test(file.filename)) {
      const anyCount = (patch.match(/:\s*any/g) || []).length;
      if (anyCount >= 3) {
        issues.push({ severity: "warning", file: file.filename, description: `${anyCount} types 'any' utilisés — typage faible`, category: "maintainability" });
      }
    }

    if (/TODO|FIXME|HACK|XXX/i.test(patch)) {
      issues.push({ severity: "info", file: file.filename, description: "TODO/FIXME trouvé — dette technique à tracker", category: "maintainability" });
    }

    if (/eval\s*\(|new\s+Function\s*\(/i.test(patch)) {
      issues.push({ severity: "critical", file: file.filename, description: "eval() ou new Function() détecté — risque de sécurité majeur", category: "security" });
    }

    if (/\.innerHTML\s*=|dangerouslySetInnerHTML/i.test(patch)) {
      issues.push({ severity: "warning", file: file.filename, description: "innerHTML/dangerouslySetInnerHTML — risque XSS potentiel", category: "security" });
    }

    if (/await\s+\w+.*\n.*await\s+\w+.*\n.*await\s+\w+/m.test(patch)) {
      issues.push({ severity: "info", file: file.filename, description: "Plusieurs awaits séquentiels — possibilité de paralléliser avec Promise.all", category: "performance" });
    }

    if (file.additions > 200 && file.deletions < 10) {
      issues.push({ severity: "info", file: file.filename, description: `+${file.additions} lignes ajoutées — fichier qui grossit, envisager un split`, category: "maintainability" });
    }

    if (/sql`[^`]*\$\{/i.test(patch) && !/sql`[^`]*\$\{.*\}/i.test(patch)) {
      issues.push({ severity: "warning", file: file.filename, description: "Injection SQL potentielle — vérifier la sanitization des paramètres", category: "security" });
    }

    const fragile = findFragileModule(basename);
    if (fragile && file.additions + file.deletions > 50) {
      issues.push({ severity: "warning", file: file.filename, description: `Module fragile (${fragile.fragility}/100): ${fragile.reason}. ${file.additions + file.deletions} lignes modifiées.`, category: "maintainability" });
    }
  }

  const criticalCount = issues.filter(i => i.severity === "critical").length;
  const warningCount = issues.filter(i => i.severity === "warning").length;

  const score = Math.max(0, 100 - criticalCount * 30 - warningCount * 10 - issues.filter(i => i.severity === "info").length * 3);

  const verdict = criticalCount > 0 ? "REQUEST_CHANGES" : warningCount >= 3 ? "REQUEST_CHANGES" : warningCount > 0 ? "COMMENT" : "APPROVE";

  const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);
  const summary = `${files.length} fichiers, +${totalAdditions}/-${totalDeletions} lignes. ${issues.length} problèmes détectés (${criticalCount} critiques, ${warningCount} warnings). Score: ${score}/100. Verdict: ${verdict}`;

  return { issues, summary, verdict, score };
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. AUTO RISK CHECK — Hook pour apply_patch automatique
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// 7. DYNAMIC FRAGILITY LEARNING — Apprentissage depuis l'historique réel
// ═══════════════════════════════════════════════════════════════════════════

export interface DynamicFragilityScore {
  filePath: string;
  staticScore: number;
  dynamicScore: number;
  combinedScore: number;
  totalEvents: number;
  bugRate: number;
  revertRate: number;
  recentTrend: "improving" | "stable" | "degrading";
  lastIncident: string | null;
  reason: string;
}

export async function recordFileEvent(entries: Array<{
  filePath: string;
  eventType: string;
  eventResult: string;
  riskScore?: number;
  linesChanged?: number;
  commitSha?: string;
  description?: string;
  userId?: number;
}>): Promise<number> {
  try {
    const { db } = await import("../db");
    const { devopsFileHistory } = await import("@shared/schema");
    let inserted = 0;
    for (const entry of entries) {
      const domains = detectDomains(entry.filePath);
      await db.insert(devopsFileHistory).values({
        filePath: entry.filePath,
        eventType: entry.eventType,
        eventResult: entry.eventResult,
        riskScore: entry.riskScore || null,
        linesChanged: entry.linesChanged || 0,
        commitSha: entry.commitSha || null,
        domains,
        description: entry.description || null,
        userId: entry.userId || null,
      });
      inserted++;
    }
    console.log(`[DynamicFragility] Recorded ${inserted} file events`);
    return inserted;
  } catch (err: any) {
    console.error(`[DynamicFragility] Record error: ${err.message}`);
    return 0;
  }
}

export async function calculateDynamicFragility(filePath?: string): Promise<DynamicFragilityScore[]> {
  try {
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");

    const query = filePath
      ? sql`
        SELECT 
          file_path,
          COUNT(*) as total_events,
          COUNT(*) FILTER (WHERE event_result IN ('bug', 'failure')) as bug_count,
          COUNT(*) FILTER (WHERE event_result = 'revert') as revert_count,
          COUNT(*) FILTER (WHERE event_result = 'hotfix') as hotfix_count,
          COUNT(*) FILTER (WHERE event_result = 'success') as success_count,
          AVG(risk_score) FILTER (WHERE risk_score IS NOT NULL) as avg_risk,
          MAX(created_at) FILTER (WHERE event_result IN ('bug', 'revert', 'failure')) as last_incident,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as recent_events,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days' AND event_result IN ('bug', 'failure', 'revert')) as recent_bad_events,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days' AND created_at <= NOW() - INTERVAL '7 days') as older_events,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days' AND created_at <= NOW() - INTERVAL '7 days' AND event_result IN ('bug', 'failure', 'revert')) as older_bad_events
        FROM devops_file_history
        WHERE file_path = ${filePath}
        GROUP BY file_path
        ORDER BY COUNT(*) FILTER (WHERE event_result IN ('bug', 'failure', 'revert')) DESC
        LIMIT 100`
      : sql`
        SELECT 
          file_path,
          COUNT(*) as total_events,
          COUNT(*) FILTER (WHERE event_result IN ('bug', 'failure')) as bug_count,
          COUNT(*) FILTER (WHERE event_result = 'revert') as revert_count,
          COUNT(*) FILTER (WHERE event_result = 'hotfix') as hotfix_count,
          COUNT(*) FILTER (WHERE event_result = 'success') as success_count,
          AVG(risk_score) FILTER (WHERE risk_score IS NOT NULL) as avg_risk,
          MAX(created_at) FILTER (WHERE event_result IN ('bug', 'revert', 'failure')) as last_incident,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as recent_events,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days' AND event_result IN ('bug', 'failure', 'revert')) as recent_bad_events,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days' AND created_at <= NOW() - INTERVAL '7 days') as older_events,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days' AND created_at <= NOW() - INTERVAL '7 days' AND event_result IN ('bug', 'failure', 'revert')) as older_bad_events
        FROM devops_file_history
        GROUP BY file_path
        ORDER BY COUNT(*) FILTER (WHERE event_result IN ('bug', 'failure', 'revert')) DESC
        LIMIT 100`;

    const result: any = await db.execute(query);
    const rows: any[] = result.rows || result || [];

    const results: DynamicFragilityScore[] = [];
    for (const row of rows) {
      const total = Number(row.total_events) || 1;
      const bugs = Number(row.bug_count) || 0;
      const reverts = Number(row.revert_count) || 0;
      const hotfixes = Number(row.hotfix_count) || 0;
      const avgRisk = Number(row.avg_risk) || 0;
      const recentEvents = Number(row.recent_events) || 0;
      const recentBad = Number(row.recent_bad_events) || 0;
      const olderEvents = Number(row.older_events) || 0;
      const olderBad = Number(row.older_bad_events) || 0;

      const bugRate = (bugs + reverts + hotfixes) / total;
      const revertRate = reverts / total;

      // Dynamic score: weighted formula
      // Base: bug rate * 100, boosted by volume and recency
      const baseScore = Math.round(bugRate * 80);
      const volumeBonus = Math.min(20, Math.round(total / 5));
      const recencyBonus = recentBad > 0 ? Math.min(15, recentBad * 5) : 0;
      const avgRiskBonus = Math.round(avgRisk * 0.1);
      const dynamicScore = Math.min(100, baseScore + volumeBonus + recencyBonus + avgRiskBonus);

      // Static score from hardcoded list
      const basename = row.file_path.split("/").pop() || "";
      const staticEntry = findFragileModule(basename);
      const staticScore = staticEntry?.fragility || 0;

      // Combined: max of static and dynamic, with dynamic getting more weight as data grows
      const dataConfidence = Math.min(1, total / 10); // 0..1, full confidence after 10 events
      const combinedScore = Math.round(
        staticScore * (1 - dataConfidence * 0.6) + dynamicScore * dataConfidence * 0.6 +
        Math.max(staticScore, dynamicScore) * 0.4 * dataConfidence
      );

      // Trend: compare recent week vs older period
      const recentBadRate = recentEvents > 0 ? recentBad / recentEvents : 0;
      const olderBadRate = olderEvents > 0 ? olderBad / olderEvents : 0;
      let trend: "improving" | "stable" | "degrading" = "stable";
      if (recentEvents >= 2 && olderEvents >= 2) {
        if (recentBadRate > olderBadRate + 0.15) trend = "degrading";
        else if (recentBadRate < olderBadRate - 0.15) trend = "improving";
      }

      const reasons: string[] = [];
      if (staticEntry) reasons.push(`Static: ${staticEntry.reason}`);
      if (bugRate > 0.3) reasons.push(`Taux de bugs élevé: ${Math.round(bugRate * 100)}%`);
      if (revertRate > 0.1) reasons.push(`Reverts fréquents: ${Math.round(revertRate * 100)}%`);
      if (recentBad > 0) reasons.push(`${recentBad} incident(s) cette semaine`);
      if (total >= 20) reasons.push(`Très modifié: ${total} events`);

      results.push({
        filePath: row.file_path,
        staticScore,
        dynamicScore,
        combinedScore: Math.max(combinedScore, staticScore, dynamicScore),
        totalEvents: total,
        bugRate: Math.round(bugRate * 100) / 100,
        revertRate: Math.round(revertRate * 100) / 100,
        recentTrend: trend,
        lastIncident: row.last_incident ? new Date(row.last_incident).toISOString() : null,
        reason: reasons.join(" | ") || "Pas assez de données",
      });
    }
    return results;
  } catch (err: any) {
    console.error(`[DynamicFragility] Calc error: ${err.message}`);
    return [];
  }
}

export async function getDynamicFragilityForFile(filePath: string): Promise<number> {
  const scores = await calculateDynamicFragility(filePath);
  if (scores.length > 0) return scores[0].combinedScore;
  const basename = filePath.split("/").pop() || "";
  const staticEntry = findFragileModule(basename);
  return staticEntry?.fragility || 0;
}

export async function getFragilityLeaderboard(limit = 20): Promise<DynamicFragilityScore[]> {
  const scores = await calculateDynamicFragility();
  return scores.sort((a, b) => b.combinedScore - a.combinedScore).slice(0, limit);
}

export function autoRiskCheckForPatch(files: Array<{ path: string; content: string }>, userId?: number, commitSha?: string): {
  shouldWarn: boolean;
  riskScore: number;
  riskLevel: string;
  warnings: string[];
  recommendations: string[];
} {
  const changes = files.map(f => ({
    file: f.path,
    linesAdded: f.content.split("\n").length,
    linesRemoved: 0,
    changeType: "modify" as const,
  }));

  const risk = calculateCIRisk(changes);

  recordFileEvent(files.map(f => ({
    filePath: f.path,
    eventType: "patch",
    eventResult: "success",
    riskScore: risk.overall,
    linesChanged: f.content.split("\n").length,
    commitSha,
    description: `Auto-patch, risk ${risk.overall}/100 (${risk.riskLevel})`,
    userId,
  }))).catch(() => {});

  return {
    shouldWarn: risk.overall >= 55,
    riskScore: risk.overall,
    riskLevel: risk.riskLevel,
    warnings: risk.warnings,
    recommendations: risk.recommendations,
  };
}

export interface DeepCodeAnalysis {
  blocked: boolean;
  riskScore: number;
  riskLevel: string;
  destructiveScore: number;
  warnings: string[];
  recommendations: string[];
  structuralIssues: string[];
  forceBranch: boolean;
  requiresPR: boolean;
  summary: string;
}

function extractCodeStructure(content: string): {
  exports: string[];
  imports: string[];
  functions: string[];
  classes: string[];
  lineCount: number;
} {
  const lines = content.split("\n");
  const exports: string[] = [];
  const imports: string[] = [];
  const functions: string[] = [];
  const classes: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^export\s+(default\s+)?(function|const|class|interface|type|enum|async\s+function)\s+(\w+)/.test(trimmed)) {
      const m = trimmed.match(/^export\s+(?:default\s+)?(?:function|const|class|interface|type|enum|async\s+function)\s+(\w+)/);
      if (m) exports.push(m[1]);
    } else if (/^export\s*\{/.test(trimmed)) {
      const m = trimmed.match(/export\s*\{([^}]+)\}/);
      if (m) m[1].split(",").forEach(e => exports.push(e.trim().split(/\s+as\s+/)[0].trim()));
    }
    if (/^import\s/.test(trimmed)) {
      imports.push(trimmed);
    }
    if (/^(export\s+)?(async\s+)?function\s+(\w+)/.test(trimmed)) {
      const m = trimmed.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
      if (m) functions.push(m[1]);
    }
    if (/^(export\s+)?class\s+(\w+)/.test(trimmed)) {
      const m = trimmed.match(/(?:export\s+)?class\s+(\w+)/);
      if (m) classes.push(m[1]);
    }
  }
  return { exports, imports, functions, classes, lineCount: lines.length };
}

export function deepCodeAnalysis(
  files: Array<{ path: string; content: string; originalContent?: string }>,
  targetBranch: string
): DeepCodeAnalysis {
  const warnings: string[] = [];
  const recommendations: string[] = [];
  const structuralIssues: string[] = [];
  let destructiveScore = 0;
  let blocked = false;

  const isDefaultBranch = ["main", "master", "production", "prod"].includes(targetBranch);

  for (const file of files) {
    const basename = file.path.split("/").pop() || "";
    const newLines = file.content.split("\n").length;

    if (file.originalContent) {
      const oldLines = file.originalContent.split("\n").length;
      const oldStruct = extractCodeStructure(file.originalContent);
      const newStruct = extractCodeStructure(file.content);

      const lineRatio = oldLines > 0 ? newLines / oldLines : 1;
      if (lineRatio < 0.15 && oldLines > 30) {
        destructiveScore += 100;
        blocked = true;
        warnings.push(`🚫 DESTRUCTIF: ${basename} réduit de ${oldLines} → ${newLines} lignes (${Math.round((1 - lineRatio) * 100)}% supprimé) — BLOQUÉ`);
        structuralIssues.push(`${basename}: suppression quasi-totale du contenu (${oldLines} → ${newLines} lignes)`);
      } else if (lineRatio < 0.5 && oldLines > 20) {
        destructiveScore += 70;
        warnings.push(`⚠️ MASSIF: ${basename} réduit de ${oldLines} → ${newLines} lignes (${Math.round((1 - lineRatio) * 100)}% supprimé)`);
        structuralIssues.push(`${basename}: perte massive de contenu`);
        if (isDefaultBranch) {
          blocked = true;
          warnings.push(`🚫 Modification massive sur '${targetBranch}' BLOQUÉE — utiliser une branche`);
        }
      } else if (lineRatio < 0.7 && oldLines > 50) {
        destructiveScore += 40;
        warnings.push(`⚠️ RÉDUCTION: ${basename} réduit de ${oldLines} → ${newLines} lignes (${Math.round((1 - lineRatio) * 100)}% supprimé)`);
      }

      const lostExports = oldStruct.exports.filter(e => !newStruct.exports.includes(e));
      if (lostExports.length > 0) {
        destructiveScore += lostExports.length * 15;
        structuralIssues.push(`${basename}: exports supprimés: ${lostExports.join(", ")}`);
        warnings.push(`🔗 ${basename}: ${lostExports.length} export(s) supprimé(s): ${lostExports.slice(0, 5).join(", ")} — risque de casser les imports`);
        if (lostExports.length >= 3 && isDefaultBranch) {
          blocked = true;
        }
      }

      const lostFunctions = oldStruct.functions.filter(f => !newStruct.functions.includes(f));
      if (lostFunctions.length > 3) {
        destructiveScore += lostFunctions.length * 10;
        structuralIssues.push(`${basename}: ${lostFunctions.length} fonctions supprimées: ${lostFunctions.slice(0, 8).join(", ")}`);
        warnings.push(`🔧 ${basename}: ${lostFunctions.length} fonction(s) supprimée(s)`);
      }

      const lostClasses = oldStruct.classes.filter(c => !newStruct.classes.includes(c));
      if (lostClasses.length > 0) {
        destructiveScore += lostClasses.length * 20;
        structuralIssues.push(`${basename}: classes supprimées: ${lostClasses.join(", ")}`);
        warnings.push(`📦 ${basename}: ${lostClasses.length} classe(s) supprimée(s)`);
      }

      const lostImports = oldStruct.imports.length - newStruct.imports.length;
      if (lostImports > 5) {
        destructiveScore += lostImports * 3;
        warnings.push(`📥 ${basename}: ${lostImports} imports supprimés — dépendances potentiellement cassées`);
      }
    } else {
      if (newLines < 30) {
        const fragile = findFragileModule(basename);
        if (fragile && fragile.fragility >= 60) {
          destructiveScore += 50;
          warnings.push(`⚠️ ${basename} est un module fragile (${fragile.fragility}/100) et le nouveau contenu est très court (${newLines} lignes) — possible écrasement destructif`);
          if (isDefaultBranch) {
            blocked = true;
            warnings.push(`🚫 Modification suspecte d'un module critique sur '${targetBranch}' — BLOQUÉE`);
          }
        }
      }
    }

    const contentLower = file.content.toLowerCase();
    if (contentLower.includes("todo") && contentLower.includes("implement") && newLines < 50) {
      destructiveScore += 30;
      warnings.push(`🏗️ ${basename}: contenu semble être un squelette/stub (TODO + implement) — pas du code de production`);
    }

    if (/^\s*(\/\/|#|\/\*|\*)\s/.test(file.content.trim()) && newLines < 20) {
      destructiveScore += 40;
      warnings.push(`📝 ${basename}: le fichier ne contient presque que des commentaires — probablement un placeholder`);
    }
  }

  const baseRisk = autoRiskCheckForPatch(files);
  const adjustedRiskScore = Math.min(100, Math.round(baseRisk.riskScore * 0.5 + destructiveScore * 0.5));
  const finalRiskLevel = adjustedRiskScore >= 75 ? "dangerous" : adjustedRiskScore >= 55 ? "risky" : adjustedRiskScore >= 35 ? "caution" : "safe";

  const forceBranch = isDefaultBranch && (destructiveScore >= 40 || adjustedRiskScore >= 55);
  const requiresPR = forceBranch || adjustedRiskScore >= 70;

  if (forceBranch) {
    recommendations.push(`Créer une branche (ex: 'fix/${Date.now()}') puis ouvrir une PR pour review`);
  }
  if (destructiveScore >= 50) {
    recommendations.push("Faire des modifications incrémentales au lieu de réécrire des fichiers entiers");
    recommendations.push("Utiliser apply_patch avec des modifications ciblées");
  }
  if (structuralIssues.length > 0) {
    recommendations.push("Vérifier que tous les exports existants sont préservés");
    recommendations.push("S'assurer que les modules dépendants ne sont pas cassés");
  }

  let summary = "";
  if (blocked) {
    summary = `🚫 BLOQUÉ — Modifications destructives détectées (destructiveScore: ${destructiveScore}). ${structuralIssues.length} problème(s) structurel(s). Utiliser une branche séparée.`;
  } else if (requiresPR) {
    summary = `⚠️ PR requise — Risque ${adjustedRiskScore}/100. ${warnings.length} avertissement(s). Branche obligatoire.`;
  } else {
    summary = `✅ Risque ${adjustedRiskScore}/100 (${finalRiskLevel}). ${warnings.length} avertissement(s).`;
  }

  return {
    blocked,
    riskScore: adjustedRiskScore,
    riskLevel: finalRiskLevel,
    destructiveScore,
    warnings: [...baseRisk.warnings, ...warnings],
    recommendations: [...baseRisk.recommendations, ...recommendations],
    structuralIssues,
    forceBranch,
    requiresPR,
    summary,
  };
}

export const devopsIntelligenceEngine = {
  buildImpactMap,
  analyzeImpact,
  calculateCIRisk,
  generatePatchAdvice,
  analyzeLearningGaps,
  runFullDevOpsIntelligence,
  analyzeDiffForReview,
  autoRiskCheckForPatch,
  deepCodeAnalysis,
  extractCodeStructure,
  findFragileModule,
  recordFileEvent,
  calculateDynamicFragility,
  getDynamicFragilityForFile,
  getFragilityLeaderboard,
  DOMAIN_PATTERNS,
  FRAGILE_MODULES,
};
