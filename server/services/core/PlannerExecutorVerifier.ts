/**
 * PLANNER-EXECUTOR-VERIFIER LOOP V1
 * 
 * Décomposition intelligente des tâches complexes:
 * 1. PLAN: Analyse la demande → crée un plan d'étapes
 * 2. EXECUTE: Exécute chaque étape avec les bons outils
 * 3. VERIFY: Vérifie le résultat avant de passer au suivant
 * 4. ADAPT: S'auto-corrige si une étape échoue
 */

const LOG_PREFIX = "[Planner]";

export interface PlanStep {
  id: number;
  action: string;
  tools: string[];
  description: string;
  dependsOn: number[];
  status: "pending" | "running" | "success" | "failed" | "skipped";
  result?: string;
  error?: string;
  retryCount: number;
  maxRetries: number;
  verificationCriteria: string;
}

export interface ExecutionPlan {
  id: string;
  query: string;
  domain: string;
  steps: PlanStep[];
  status: "planning" | "executing" | "verifying" | "completed" | "failed";
  startedAt: number;
  completedAt?: number;
  totalSteps: number;
  completedSteps: number;
  overallConfidence: number;
}

interface PlanTemplate {
  pattern: RegExp;
  domain: string;
  generateSteps: (query: string) => Omit<PlanStep, "status" | "result" | "error" | "retryCount">[];
}

class PlannerExecutorVerifier {
  private templates: PlanTemplate[] = [
    {
      pattern: /analyse.*match.*envoi|résumé.*matchs.*mail|brief.*sport.*email/i,
      domain: "sports+email",
      generateSteps: (query) => [
        { id: 1, action: "fetch_sports", tools: ["query_sports_data", "query_matchendirect"], description: "Récupérer les données matchs", dependsOn: [], maxRetries: 2, verificationCriteria: "Données matchs obtenues avec scores ou calendrier" },
        { id: 2, action: "analyze", tools: ["query_match_intelligence"], description: "Analyser les statistiques et tendances", dependsOn: [1], maxRetries: 1, verificationCriteria: "Analyse structurée avec insights" },
        { id: 3, action: "compose_email", tools: ["email_send"], description: "Composer et envoyer l'email résumé", dependsOn: [2], maxRetries: 1, verificationCriteria: "Email envoyé avec confirmation" }
      ]
    },
    {
      pattern: /vérifie.*agenda.*prépare|check.*calendar.*brief|planifie.*journée/i,
      domain: "calendar+tasks",
      generateSteps: (query) => [
        { id: 1, action: "fetch_calendar", tools: ["calendar_list_events"], description: "Récupérer les événements du jour", dependsOn: [], maxRetries: 2, verificationCriteria: "Liste d'événements obtenue" },
        { id: 2, action: "fetch_tasks", tools: ["todoist_list_tasks"], description: "Récupérer les tâches prioritaires", dependsOn: [], maxRetries: 2, verificationCriteria: "Tâches listées avec priorités" },
        { id: 3, action: "synthesize", tools: [], description: "Synthétiser planning optimal", dependsOn: [1, 2], maxRetries: 0, verificationCriteria: "Planning structuré avec horaires" }
      ]
    },
    {
      pattern: /compare.*option|hésite.*entre|choix.*entre|décision/i,
      domain: "decision",
      generateSteps: (query) => [
        { id: 1, action: "extract_options", tools: [], description: "Identifier les options à comparer", dependsOn: [], maxRetries: 0, verificationCriteria: "Au moins 2 options identifiées" },
        { id: 2, action: "research", tools: ["web_search", "query_brain"], description: "Rechercher infos sur chaque option", dependsOn: [1], maxRetries: 2, verificationCriteria: "Données factuelles par option" },
        { id: 3, action: "analyze_tradeoffs", tools: [], description: "Analyser coûts/bénéfices/risques", dependsOn: [2], maxRetries: 0, verificationCriteria: "Matrice de décision complète" },
        { id: 4, action: "recommend", tools: [], description: "Recommandation claire avec justification", dependsOn: [3], maxRetries: 0, verificationCriteria: "Recommandation argumentée" }
      ]
    },
    {
      pattern: /cherche.*résume|recherche.*synthèse|trouve.*explique/i,
      domain: "research",
      generateSteps: (query) => [
        { id: 1, action: "search", tools: ["web_search"], description: "Recherche web multi-sources", dependsOn: [], maxRetries: 2, verificationCriteria: "Résultats pertinents trouvés" },
        { id: 2, action: "verify", tools: ["web_search"], description: "Vérification croisée des infos", dependsOn: [1], maxRetries: 1, verificationCriteria: "Infos confirmées par 2+ sources" },
        { id: 3, action: "memorize", tools: ["memory_save"], description: "Mémoriser les faits vérifiés", dependsOn: [2], maxRetries: 1, verificationCriteria: "Faits sauvegardés en mémoire" }
      ]
    },
    {
      pattern: /analyse.*sugu|bilan.*restaurant|point.*courses|synthèse.*stock/i,
      domain: "sugu",
      generateSteps: (query) => [
        { id: 1, action: "fetch_data", tools: ["query_suguval_history", "get_suguval_checklist"], description: "Récupérer données SUGU (achats + checklist)", dependsOn: [], maxRetries: 2, verificationCriteria: "Données SUGU obtenues" },
        { id: 2, action: "analyze", tools: ["sugu_full_overview"], description: "Analyser tendances, anomalies, rotation", dependsOn: [1], maxRetries: 1, verificationCriteria: "Insights identifiés avec chiffres" },
        { id: 3, action: "recommend", tools: [], description: "Recommandations actionnables avec impact en €", dependsOn: [2], maxRetries: 0, verificationCriteria: "Actions concrètes avec montants" }
      ]
    },
    {
      pattern: /cash\s*flow|trésorerie|où\s+part\s+(mon|le)\s+cash|dépenses?\s+mois/i,
      domain: "sugu",
      generateSteps: (query) => [
        { id: 1, action: "fetch_expenses", tools: ["query_suguval_history"], description: "Récupérer historique dépenses et charges", dependsOn: [], maxRetries: 2, verificationCriteria: "Historique obtenu" },
        { id: 2, action: "categorize", tools: [], description: "Catégoriser par poste: fournisseurs, charges fixes, variables", dependsOn: [1], maxRetries: 0, verificationCriteria: "Catégories avec montants" },
        { id: 3, action: "compare", tools: [], description: "Comparer vs mois précédent et identifier écarts", dependsOn: [2], maxRetries: 0, verificationCriteria: "Écarts identifiés en € et %" },
        { id: 4, action: "recommend", tools: [], description: "Reco: postes à réduire, optimisations possibles", dependsOn: [3], maxRetries: 0, verificationCriteria: "Actions avec impact € estimé" }
      ]
    },
    {
      pattern: /fournisseur|facture|charge|coût|augment|diminue.*poste/i,
      domain: "sugu",
      generateSteps: (query) => [
        { id: 1, action: "fetch_supplier_data", tools: ["query_suguval_history"], description: "Données fournisseurs et factures", dependsOn: [], maxRetries: 2, verificationCriteria: "Données fournisseurs obtenues" },
        { id: 2, action: "trend_analysis", tools: [], description: "Analyser tendance prix et volumes par fournisseur", dependsOn: [1], maxRetries: 0, verificationCriteria: "Tendances identifiées" },
        { id: 3, action: "benchmark", tools: [], description: "Comparer charges vs périodes précédentes", dependsOn: [2], maxRetries: 0, verificationCriteria: "Benchmark avec écarts" },
        { id: 4, action: "decision", tools: [], description: "Recommandation: augmenter/diminuer/maintenir avec justification", dependsOn: [3], maxRetries: 0, verificationCriteria: "Décision claire et argumentée" }
      ]
    },
    {
      pattern: /prono.*(?:match|week|jour)|value\s*bet|paris?\s+(?:du\s+)?(?:jour|soir|week)/i,
      domain: "sports",
      generateSteps: (query) => [
        { id: 1, action: "fetch_matches", tools: ["query_sports_data", "query_matchendirect"], description: "Récupérer matchs et cotes du jour", dependsOn: [], maxRetries: 2, verificationCriteria: "Liste matchs avec cotes" },
        { id: 2, action: "deep_analysis", tools: ["query_match_intelligence"], description: "Analyse profonde: blessures, form, H2H, lineups", dependsOn: [1], maxRetries: 1, verificationCriteria: "Données enrichies par match" },
        { id: 3, action: "probability", tools: [], description: "Calcul probas Poisson + value detection (threshold 10%)", dependsOn: [2], maxRetries: 0, verificationCriteria: "Probas calculées vs cotes" },
        { id: 4, action: "filter_shortlist", tools: [], description: "Filtrer selon profil Maurice: max 3 matchs, cotes 1.5-15, ligues Big 5", dependsOn: [3], maxRetries: 0, verificationCriteria: "Shortlist filtrée ou 0 paris si rien ne matche" },
        { id: 5, action: "format_output", tools: [], description: "Format: Match | Prono | Cote | Confiance | Raison courte", dependsOn: [4], maxRetries: 0, verificationCriteria: "Tableau formaté avec argumentaire" }
      ]
    }
  ];

  private activePlans: Map<string, ExecutionPlan> = new Map();

  isComplexQuery(query: string): boolean {
    if (query.length > 100) return true;
    const complexIndicators = [
      /et\s+(aussi|ensuite|après|puis)/i,
      /d'abord.*puis|commence.*ensuite/i,
      /analyse.*envoi|cherche.*résume/i,
      /compare.*entre|hésite.*choix/i,
      /vérifie.*prépare|check.*brief/i,
      /planifie.*organise/i,
    ];
    return complexIndicators.some(r => r.test(query));
  }

  createPlan(query: string): ExecutionPlan | null {
    for (const template of this.templates) {
      if (template.pattern.test(query)) {
        const rawSteps = template.generateSteps(query);
        const plan: ExecutionPlan = {
          id: `plan_${Date.now()}`,
          query,
          domain: template.domain,
          steps: rawSteps.map(s => ({
            ...s,
            status: "pending" as const,
            retryCount: 0
          })),
          status: "planning",
          startedAt: Date.now(),
          totalSteps: rawSteps.length,
          completedSteps: 0,
          overallConfidence: 0
        };
        this.activePlans.set(plan.id, plan);
        console.log(`${LOG_PREFIX} Plan created: ${plan.id} with ${plan.totalSteps} steps for domain ${plan.domain}`);
        return plan;
      }
    }
    return null;
  }

  generatePlanPrompt(plan: ExecutionPlan): string {
    const stepsDesc = plan.steps.map(s => 
      `  Étape ${s.id}: ${s.description} [Outils: ${s.tools.join(", ") || "raisonnement"}] ${s.dependsOn.length > 0 ? `(après étape ${s.dependsOn.join(", ")})` : ""}`
    ).join("\n");

    return `[PLAN D'EXÉCUTION MULTI-ÉTAPES]
Demande: "${plan.query}"
Domaine: ${plan.domain}
${plan.totalSteps} étapes identifiées:
${stepsDesc}

INSTRUCTIONS: Exécute ce plan étape par étape. Pour chaque étape:
1. Utilise les outils indiqués
2. Vérifie le résultat (critère: ${plan.steps.map(s => s.verificationCriteria).join(" / ")})
3. Si une étape échoue, tente un fallback ou signale l'erreur
4. Synthétise le résultat final en intégrant toutes les étapes`;
  }

  markStepComplete(planId: string, stepId: number, result: string): void {
    const plan = this.activePlans.get(planId);
    if (!plan) return;
    const step = plan.steps.find(s => s.id === stepId);
    if (step) {
      step.status = "success";
      step.result = result;
      plan.completedSteps++;
      if (plan.completedSteps === plan.totalSteps) {
        plan.status = "completed";
        plan.completedAt = Date.now();
        plan.overallConfidence = 0.9;
      }
    }
  }

  markStepFailed(planId: string, stepId: number, error: string): boolean {
    const plan = this.activePlans.get(planId);
    if (!plan) return false;
    const step = plan.steps.find(s => s.id === stepId);
    if (!step) return false;

    step.retryCount++;
    if (step.retryCount <= step.maxRetries) {
      step.status = "pending";
      console.log(`${LOG_PREFIX} Step ${stepId} retry ${step.retryCount}/${step.maxRetries}`);
      return true;
    }

    step.status = "failed";
    step.error = error;

    const dependents = plan.steps.filter(s => s.dependsOn.includes(stepId));
    for (const dep of dependents) {
      dep.status = "skipped";
    }

    plan.status = "failed";
    return false;
  }

  getActivePlan(planId: string): ExecutionPlan | undefined {
    return this.activePlans.get(planId);
  }

  getStats(): { activePlans: number; completedPlans: number; templates: number } {
    let completed = 0;
    const plans = Array.from(this.activePlans.values());
    for (const plan of plans) {
      if (plan.status === "completed") completed++;
    }
    return { activePlans: this.activePlans.size, completedPlans: completed, templates: this.templates.length };
  }
}

export const plannerService = new PlannerExecutorVerifier();
