import { db } from "../db";
import { actionLogs } from "@shared/schema";
import { eq, desc, and, gte } from "drizzle-orm";
import { capabilityService } from "./capabilityService";
import { failurePatternService, PreActionRecommendation } from "./failurePatternService";

export interface ActionContext {
  userId: number;
  persona: "ulysse" | "iris";
  actionType: string;
  actionCategory: string;
  inputPayload: any;
  expectedOutcome?: string;
  // ANTI-HALLUCINATION: Flag pour données temps réel (scores, prix, résultats)
  requiresVerifiedFacts?: boolean;
}

// Types de données nécessitant une vérification stricte
export const VERIFIED_FACTS_REQUIRED_TYPES = [
  "live_score",      // Scores en direct
  "match_result",    // Résultats de matchs
  "sports_ranking",  // Classements sportifs
  "live_price",      // Prix temps réel
  "betting_odds",    // Cotes de paris
  "stock_price",     // Cours boursiers
  "flight_status",   // Statuts de vols
  "weather_current"  // Météo actuelle
];

// Seuil minimum de confiance MARS pour les données vérifiées
export const MIN_VERIFIED_CONFIDENCE = 70;
export const MIN_SOURCE_COUNT = 2;

export interface ActionResult {
  success: boolean;
  outputPayload: any;
  errorMessage?: string;
}

export interface ValidationResult {
  effectivenessScore: number;
  coherenceScore: number;
  precisionScore: number;
  overallScore: number;
  validationNotes: string;
  passed: boolean;
}

// ANTI-HALLUCINATION: Résultat de validation des faits
export interface FactVerificationResult {
  verified: boolean;
  confidenceLevel: "high" | "medium" | "low" | "insufficient";
  sourceCount: number;
  trustScore: number;
  verifiedFacts: string[];
  dataGaps: string[];
  mustRefuse: boolean;
  refusalReason?: string;
}

interface ActionLogEntry {
  id: number;
  actionType: string;
  status: string;
  overallScore: number | null;
  startedAt: Date | null;
}

const ACTION_CATEGORIES = {
  email: ["send_email", "reply_email", "send_with_pdf", "send_with_word", "send_with_excel"],
  memory: ["store_memory", "update_memory", "recall_memory"],
  file: ["generate_pdf", "generate_word", "generate_excel", "generate_zip", "read_file"],
  calendar: ["read_events", "create_event"],
  search: ["web_search", "read_website"],
  homework: ["execute_homework", "create_homework"],
  media: ["capture_photo", "capture_video", "save_media"]
};

// AMÉLIORATION: Poids adaptatifs par catégorie (proposition Ulysse)
const CATEGORY_WEIGHTS: Record<string, { eff: number; coh: number; prec: number }> = {
  email: { eff: 0.5, coh: 0.2, prec: 0.3 },      // Efficacité cruciale (envoi irréversible)
  file: { eff: 0.3, coh: 0.3, prec: 0.4 },       // Précision cruciale pour fichiers
  memory: { eff: 0.4, coh: 0.4, prec: 0.2 },     // Cohérence cruciale pour mémoire
  calendar: { eff: 0.35, coh: 0.35, prec: 0.3 }, // Équilibré
  search: { eff: 0.45, coh: 0.25, prec: 0.3 },   // Efficacité importante
  homework: { eff: 0.4, coh: 0.35, prec: 0.25 }, // Cohérence importante
  media: { eff: 0.35, coh: 0.3, prec: 0.35 },    // Équilibré
  default: { eff: 0.4, coh: 0.3, prec: 0.3 }     // Fallback (anciens poids)
};

// AMÉLIORATION: Seuils dynamiques par criticité (proposition Ulysse)
let VALIDATION_THRESHOLDS: Record<string, number> = {
  email: 75,      // Plus strict (envoi irréversible)
  file: 70,       // Strict (génération de documents)
  memory: 60,     // Standard
  calendar: 65,   // Modéré
  search: 55,     // Plus permissif
  homework: 60,   // Standard
  media: 60,      // Standard
  default: 60     // Fallback
};

class ActionVerificationService {
  
  /**
   * AMÉLIORATION Point 6: Obtenir les recommandations pré-action
   * basées sur l'analyse des patterns d'échec historiques
   */
  async getPreActionRecommendation(
    userId: number,
    actionType: string,
    actionCategory: string
  ): Promise<PreActionRecommendation> {
    return failurePatternService.getPreActionRecommendation(userId, actionType, actionCategory);
  }

  /**
   * Démarre une action avec vérification préalable des patterns d'échec
   * Retourne aussi les recommandations pour ajuster l'approche si nécessaire
   */
  async startActionWithCheck(context: ActionContext): Promise<{
    actionId: number;
    recommendation: PreActionRecommendation;
    shouldWarn: boolean;
  }> {
    // Obtenir les recommandations basées sur les patterns d'échec
    const recommendation = await this.getPreActionRecommendation(
      context.userId,
      context.actionType,
      context.actionCategory
    );

    // Démarrer l'action
    const actionId = await this.startAction(context);

    return {
      actionId,
      recommendation,
      shouldWarn: recommendation.riskLevel === "high" || recommendation.riskLevel === "critical"
    };
  }

  async startAction(context: ActionContext): Promise<number> {
    const [log] = await db.insert(actionLogs)
      .values({
        userId: context.userId,
        persona: context.persona,
        actionType: context.actionType,
        actionCategory: context.actionCategory,
        inputPayload: context.inputPayload,
        status: "executing"
      })
      .returning({ id: actionLogs.id });

    return log.id;
  }

  async completeAction(
    actionId: number, 
    result: ActionResult,
    validation?: ValidationResult
  ): Promise<void> {
    const [action] = await db.select()
      .from(actionLogs)
      .where(eq(actionLogs.id, actionId))
      .limit(1);

    if (!action) return;

    const executionTimeMs = action.startedAt 
      ? Date.now() - new Date(action.startedAt).getTime() 
      : 0;

    await db.update(actionLogs)
      .set({
        status: result.success ? "completed" : "failed",
        outputPayload: result.outputPayload,
        errorMessage: result.errorMessage,
        executionTimeMs,
        effectivenessScore: validation?.effectivenessScore,
        coherenceScore: validation?.coherenceScore,
        precisionScore: validation?.precisionScore,
        overallScore: validation?.overallScore,
        validationNotes: validation?.validationNotes,
        completedAt: new Date()
      })
      .where(eq(actionLogs.id, actionId));

    await capabilityService.recordCapabilityUsage(
      this.mapActionToCapability(action.actionType),
      result.success
    );
  }

  async validateAction(
    context: ActionContext,
    result: ActionResult,
    previousActions: ActionLogEntry[]
  ): Promise<ValidationResult> {
    const effectivenessScore = this.calculateEffectiveness(context, result);
    const coherenceScore = this.calculateCoherence(context, previousActions);
    const precisionScore = this.calculatePrecision(context, result);
    
    // AMÉLIORATION: Utiliser les poids adaptatifs par catégorie
    const weights = CATEGORY_WEIGHTS[context.actionCategory] || CATEGORY_WEIGHTS.default;
    const overallScore = Math.round(
      (effectivenessScore * weights.eff) + 
      (coherenceScore * weights.coh) + 
      (precisionScore * weights.prec)
    );

    // AMÉLIORATION: Utiliser le seuil dynamique par catégorie
    const threshold = VALIDATION_THRESHOLDS[context.actionCategory] || VALIDATION_THRESHOLDS.default;

    const notes: string[] = [];
    
    if (effectivenessScore < 70) {
      notes.push(`Efficacité faible (${effectivenessScore}%): L'action n'a peut-être pas atteint son objectif`);
    }
    if (coherenceScore < 70) {
      notes.push(`Cohérence faible (${coherenceScore}%): L'action semble incohérente avec le contexte`);
    }
    if (precisionScore < 70) {
      notes.push(`Précision faible (${precisionScore}%): L'action a été exécutée de manière imprécise`);
    }
    
    // Log pour traçabilité
    console.log(`[ActionVerification] Category: ${context.actionCategory}, Weights: ${JSON.stringify(weights)}, Threshold: ${threshold}, Score: ${overallScore}`);

    return {
      effectivenessScore,
      coherenceScore,
      precisionScore,
      overallScore,
      validationNotes: notes.join("; ") || "Action validée avec succès",
      passed: overallScore >= threshold
    };
  }

  // AMÉLIORATION: Auto-tuning des seuils basé sur l'historique (proposition Ulysse)
  async autoTuneThresholds(userId: number): Promise<void> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    const actions = await db.select()
      .from(actionLogs)
      .where(and(
        eq(actionLogs.userId, userId),
        gte(actionLogs.startedAt, thirtyDaysAgo)
      ));

    const statsByCategory: Record<string, { total: number; success: number }> = {};
    
    for (const action of actions) {
      const cat = action.actionCategory || "default";
      if (!statsByCategory[cat]) {
        statsByCategory[cat] = { total: 0, success: 0 };
      }
      statsByCategory[cat].total++;
      if (action.status === "completed") {
        statsByCategory[cat].success++;
      }
    }

    for (const [category, data] of Object.entries(statsByCategory)) {
      if (data.total < 10) continue; // Besoin de données suffisantes
      
      const failureRate = 1 - (data.success / data.total);
      const successRate = data.success / data.total;
      const currentThreshold = VALIDATION_THRESHOLDS[category] || VALIDATION_THRESHOLDS.default;
      
      // Si taux d'échec > 20%, assouplir le seuil (min 50)
      if (failureRate > 0.2) {
        VALIDATION_THRESHOLDS[category] = Math.max(50, currentThreshold - 5);
        console.log(`[AutoTune] ${category}: seuil abaissé à ${VALIDATION_THRESHOLDS[category]} (failureRate: ${(failureRate * 100).toFixed(1)}%)`);
      }
      // Si taux succès > 95%, renforcer le seuil (max 85)
      else if (successRate > 0.95) {
        VALIDATION_THRESHOLDS[category] = Math.min(85, currentThreshold + 5);
        console.log(`[AutoTune] ${category}: seuil renforcé à ${VALIDATION_THRESHOLDS[category]} (successRate: ${(successRate * 100).toFixed(1)}%)`);
      }
    }
  }

  getValidationThresholds(): Record<string, number> {
    return { ...VALIDATION_THRESHOLDS };
  }

  getCategoryWeights(): Record<string, { eff: number; coh: number; prec: number }> {
    return { ...CATEGORY_WEIGHTS };
  }

  private calculateEffectiveness(context: ActionContext, result: ActionResult): number {
    if (!result.success) return 0;
    
    let score = 70;

    if (result.outputPayload) {
      if (context.actionCategory === "email") {
        if (result.outputPayload.messageId) score += 15;
        if (result.outputPayload.attachmentPath) score += 15;
      }
      else if (context.actionCategory === "file") {
        if (result.outputPayload.filePath) score += 20;
        if (result.outputPayload.fileSize > 0) score += 10;
      }
      else if (context.actionCategory === "memory") {
        if (result.outputPayload.stored) score += 30;
      }
      else if (context.actionCategory === "search") {
        if (result.outputPayload.results?.length > 0) score += 30;
      }
      else {
        score += 20;
      }
    }

    return Math.min(100, score);
  }

  private calculateCoherence(context: ActionContext, previousActions: ActionLogEntry[]): number {
    if (previousActions.length === 0) return 100;

    let score = 100;

    const sameTypeActions = previousActions.filter(a => a.actionType === context.actionType);
    if (sameTypeActions.length > 3) {
      const recentSame = sameTypeActions.slice(0, 3);
      const failures = recentSame.filter(a => a.status === "failed").length;
      if (failures >= 2) {
        score -= 30;
      }
    }

    const lastAction = previousActions[0];
    if (lastAction) {
      const timeSinceLastMs = lastAction.startedAt 
        ? Date.now() - new Date(lastAction.startedAt).getTime()
        : 0;
      
      if (timeSinceLastMs < 1000) {
        score -= 10;
      }
    }

    return Math.max(0, score);
  }

  private calculatePrecision(context: ActionContext, result: ActionResult): number {
    if (!result.success) return 0;

    let score = 85;

    if (context.actionCategory === "email") {
      const input = context.inputPayload;
      const output = result.outputPayload;
      
      if (input?.to && output?.to === input.to) score += 5;
      if (input?.subject && output?.subject === input.subject) score += 5;
      if (input?.pdfTitle && output?.attachmentName?.includes(input.pdfTitle)) score += 5;
    }
    else if (context.actionCategory === "file") {
      const input = context.inputPayload;
      const output = result.outputPayload;
      
      if (input?.title && output?.filename?.includes(input.title.substring(0, 20))) score += 10;
      if (output?.fileSize > 100) score += 5;
    }

    return Math.min(100, score);
  }

  private mapActionToCapability(actionType: string): string {
    const mapping: Record<string, string> = {
      "send_email": "Envoyer un Email",
      "reply_email": "Répondre à un Email",
      "send_with_pdf": "Envoyer Email avec PDF",
      "send_with_word": "Envoyer Email avec Word",
      "web_search": "Recherche Web",
      "read_website": "Lecture de Sites Web",
      "generate_pdf": "Générer PDF",
      "generate_word": "Générer Word",
      "generate_excel": "Générer Excel",
      "read_events": "Lire les Événements",
      "create_event": "Créer un Événement"
    };
    return mapping[actionType] || actionType;
  }

  async getRecentActions(userId: number, limit: number = 10): Promise<ActionLogEntry[]> {
    return await db.select({
      id: actionLogs.id,
      actionType: actionLogs.actionType,
      status: actionLogs.status,
      overallScore: actionLogs.overallScore,
      startedAt: actionLogs.startedAt
    })
      .from(actionLogs)
      .where(eq(actionLogs.userId, userId))
      .orderBy(desc(actionLogs.startedAt))
      .limit(limit);
  }

  async getActionStats(userId: number): Promise<{
    totalActions: number;
    successRate: number;
    averageScore: number;
    recentFailures: number;
  }> {
    const actions = await db.select()
      .from(actionLogs)
      .where(eq(actionLogs.userId, userId));

    const total = actions.length;
    const successful = actions.filter(a => a.status === "completed").length;
    const scores = actions.filter(a => a.overallScore).map(a => a.overallScore!);
    const avgScore = scores.length > 0 
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0;

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentFailures = actions.filter(
      a => a.status === "failed" && a.startedAt && new Date(a.startedAt) > oneDayAgo
    ).length;

    return {
      totalActions: total,
      successRate: total > 0 ? Math.round((successful / total) * 100) : 100,
      averageScore: avgScore,
      recentFailures
    };
  }

  /**
   * ANTI-HALLUCINATION: Vérifie si les données temps réel sont fiables
   * Utilisé pour scores, résultats sportifs, prix, cotes de paris
   */
  verifyFactualData(
    marsResult: {
      confidenceLevel?: string;
      verifiedFactsCount?: number;
      sourceCount?: number;
      canRespond?: boolean;
      factAggregation?: { overallConfidence: number; verifiedFacts?: any[] };
    } | null,
    apiResult: {
      success: boolean;
      data?: any;
      source?: string;
    } | null,
    dataType: string
  ): FactVerificationResult {
    // Si on a des données API fiables, c'est OK
    if (apiResult?.success && apiResult.data) {
      const source = apiResult.source || "api";
      console.log(`[FactVerification] API ${source} returned data for ${dataType}`);
      return {
        verified: true,
        confidenceLevel: "high",
        sourceCount: 1,
        trustScore: 95,
        verifiedFacts: [`Data from ${source}`],
        dataGaps: [],
        mustRefuse: false
      };
    }

    // Si pas de résultat MARS, on refuse
    if (!marsResult) {
      console.log(`[FactVerification] No MARS result for ${dataType} - refusing`);
      return {
        verified: false,
        confidenceLevel: "insufficient",
        sourceCount: 0,
        trustScore: 0,
        verifiedFacts: [],
        dataGaps: ["Aucune source disponible"],
        mustRefuse: true,
        refusalReason: `Je n'ai pas de source fiable pour cette information (${dataType}).`
      };
    }

    const confidence = marsResult.confidenceLevel || "insufficient";
    const verifiedCount = marsResult.verifiedFactsCount || 0;
    const sourceCount = marsResult.sourceCount || 0;
    const overallConfidence = marsResult.factAggregation?.overallConfidence || 0;
    const canRespond = marsResult.canRespond ?? false;

    // Calcul du trustScore basé sur les critères MARS
    let trustScore = overallConfidence;
    if (confidence === "high") trustScore = Math.max(trustScore, 80);
    else if (confidence === "medium") trustScore = Math.max(trustScore, 50);
    else if (confidence === "low") trustScore = Math.max(trustScore, 30);

    // Déterminer si on doit refuser
    const mustRefuse = 
      !canRespond || 
      trustScore < MIN_VERIFIED_CONFIDENCE || 
      (sourceCount < MIN_SOURCE_COUNT && verifiedCount === 0);

    let refusalReason: string | undefined;
    if (mustRefuse) {
      if (!canRespond) {
        refusalReason = `Je ne peux pas te donner cette information de manière fiable. MARS indique confiance insuffisante.`;
      } else if (trustScore < MIN_VERIFIED_CONFIDENCE) {
        refusalReason = `Confiance trop faible (${trustScore}%) pour cette donnée temps réel. Je préfère ne pas inventer.`;
      } else if (sourceCount < MIN_SOURCE_COUNT) {
        refusalReason = `Pas assez de sources (${sourceCount}) pour confirmer cette information.`;
      }
    }

    console.log(`[FactVerification] ${dataType}: trust=${trustScore}%, sources=${sourceCount}, verified=${verifiedCount}, mustRefuse=${mustRefuse}`);

    return {
      verified: !mustRefuse,
      confidenceLevel: confidence as any,
      sourceCount,
      trustScore,
      verifiedFacts: marsResult.factAggregation?.verifiedFacts?.map((f: any) => f.content || f) || [],
      dataGaps: mustRefuse ? [`Données ${dataType} non vérifiables`] : [],
      mustRefuse,
      refusalReason
    };
  }

  /**
   * Génère un message de refus approprié pour les données non vérifiables
   */
  generateRefusalMessage(dataType: string, verification: FactVerificationResult): string {
    const typeLabels: Record<string, string> = {
      live_score: "ce score en direct",
      match_result: "ce résultat de match",
      sports_ranking: "ce classement",
      live_price: "ce prix",
      betting_odds: "ces cotes",
      stock_price: "ce cours de bourse",
      flight_status: "ce statut de vol",
      weather_current: "cette météo"
    };

    const label = typeLabels[dataType] || "cette information";
    
    if (verification.refusalReason) {
      return verification.refusalReason;
    }

    return `Je ne peux pas te donner ${label} de manière fiable. ` +
           `Je préfère te dire que je ne sais pas plutôt qu'inventer une donnée incorrecte. ` +
           `(Confiance: ${verification.trustScore}%, Sources: ${verification.sourceCount})`;
  }

  /**
   * Vérifie si un type de requête nécessite des faits vérifiés
   */
  requiresVerification(queryType: string, keywords: string[]): boolean {
    // Mots-clés indiquant des données temps réel
    const realtimeKeywords = [
      "score", "résultat", "match", "classement", "rang", "position",
      "prix", "coût", "tarif", "cote", "odd",
      "cours", "action", "bourse",
      "vol", "avion", "train",
      "météo", "température"
    ];

    const queryLower = queryType.toLowerCase();
    const keywordsLower = keywords.map(k => k.toLowerCase());

    // Check si le type de query est dans la liste des types nécessitant vérification
    if (VERIFIED_FACTS_REQUIRED_TYPES.includes(queryType)) {
      return true;
    }

    // Check les mots-clés
    return realtimeKeywords.some(kw => 
      keywordsLower.some(k => k.includes(kw)) || queryLower.includes(kw)
    );
  }

  generateActionVerificationPrompt(stats: {
    totalActions: number;
    successRate: number;
    averageScore: number;
    recentFailures: number;
  }): string {
    let prompt = `\n═══════════════════════════════════════════════════════════════
VÉRIFICATION DE MES ACTIONS - RÈGLES OBLIGATOIRES
═══════════════════════════════════════════════════════════════
Avant chaque action, je dois vérifier:
1. EFFICACITÉ: L'action atteindra-t-elle son objectif?
2. COHÉRENCE: L'action est-elle logique dans ce contexte?
3. PRÉCISION: L'action sera-t-elle exécutée exactement comme demandé?

Après chaque action, je dois:
- Confirmer le résultat obtenu
- Signaler tout écart avec l'objectif initial
- Proposer des corrections si nécessaire

📊 Mes statistiques actuelles:
- Actions totales: ${stats.totalActions}
- Taux de succès: ${stats.successRate}%
- Score moyen: ${stats.averageScore}/100
`;

    if (stats.recentFailures > 0) {
      prompt += `- ⚠️ ${stats.recentFailures} échec(s) récent(s) - redoubler de vigilance\n`;
    }

    prompt += `═══════════════════════════════════════════════════════════════\n`;
    return prompt;
  }
}

export const actionVerificationService = new ActionVerificationService();
