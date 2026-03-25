/**
 * Decision Engine Service V2
 * 
 * Central decision-making engine that combines:
 * - Capability availability checks
 * - Failure pattern analysis
 * - Brain context awareness
 * - Risk assessment and fallback suggestions
 */

import { capabilityService } from "./capabilityService";
import { failurePatternService } from "./failurePatternService";
import { brainService } from "./brainService";
import { systemMetricsService } from "./systemMetricsService";
import { PersonaType, getPersonaProfile, canPersonaUseCapability } from "../config/personaMapping";
import { contextOptimizerService } from "./context/optimizer";

const LOG_PREFIX = "[DecisionEngine]";

export interface ActionContext {
  userId: number;
  actionType: string;
  actionCategory: string;
  query?: string;
  persona?: string;
  requiredCapabilities?: string[];
}

export interface DecisionResult {
  shouldProceed: boolean;
  confidence: number;
  chosenAction: string;
  justification: string;
  risks: string[];
  alternatives: ActionAlternative[];
  brainContext?: BrainContextSummary;
  capabilityStatus: CapabilityCheck;
  failureAnalysis: FailureCheck;
}

export interface ActionAlternative {
  action: string;
  reason: string;
  confidence: number;
}

export interface BrainContextSummary {
  relevantKnowledge: number;
  directAnswer?: string;
  relatedTopics: string[];
}

export interface CapabilityCheck {
  allAvailable: boolean;
  unavailable: string[];
  degraded: string[];
  successRates: Record<string, number>;
}

export interface FailureCheck {
  riskLevel: "low" | "medium" | "high" | "critical";
  successProbability: number;
  recentFailures: number;
  recommendations: string[];
}

class DecisionEngineService {
  
  async evaluateAction(context: ActionContext): Promise<DecisionResult> {
    console.log(`${LOG_PREFIX} Evaluating action: ${context.actionCategory}/${context.actionType}`);
    
    const personaCheck = this.checkPersonaRestrictions(context);
    
    const [capabilityCheck, failureCheck, brainContext] = await Promise.all([
      this.checkCapabilities(context),
      this.checkFailurePatterns(context),
      context.query ? this.checkBrainContext(context) : Promise.resolve(undefined)
    ]);
    
    const alternatives = this.generateAlternatives(context, capabilityCheck, failureCheck);
    const { shouldProceed, confidence, justification, risks } = this.synthesizeDecision(
      context,
      capabilityCheck,
      failureCheck,
      brainContext,
      personaCheck
    );
    
    const result: DecisionResult = {
      shouldProceed,
      confidence,
      chosenAction: shouldProceed ? context.actionType : (alternatives[0]?.action || "none"),
      justification,
      risks,
      alternatives,
      brainContext,
      capabilityStatus: capabilityCheck,
      failureAnalysis: failureCheck
    };
    
    console.log(`${LOG_PREFIX} Decision: ${shouldProceed ? "PROCEED" : "BLOCKED"} (${confidence}% confidence)`);
    
    return result;
  }

  private checkPersonaRestrictions(context: ActionContext): {
    allowed: boolean;
    blockedCapabilities: string[];
    riskExceeded: boolean;
    reason?: string;
  } {
    if (!context.persona) {
      return { allowed: true, blockedCapabilities: [], riskExceeded: false };
    }
    
    const persona = context.persona as PersonaType;
    const profile = getPersonaProfile(persona);
    
    if (!profile) {
      return { allowed: true, blockedCapabilities: [], riskExceeded: false };
    }
    
    const blockedCapabilities: string[] = [];
    
    if (context.requiredCapabilities) {
      for (const cap of context.requiredCapabilities) {
        if (!canPersonaUseCapability(persona, cap)) {
          blockedCapabilities.push(cap);
        }
      }
    }
    
    if (!canPersonaUseCapability(persona, context.actionType)) {
      blockedCapabilities.push(context.actionType);
    }
    
    const riskLevelMap: Record<string, number> = { low: 1, medium: 2, high: 3 };
    const actionRiskLevel = this.inferActionRiskLevel(context.actionType);
    const maxAllowedRisk = riskLevelMap[profile.behaviorTraits.maxRiskLevel];
    const riskExceeded = riskLevelMap[actionRiskLevel] > maxAllowedRisk;
    
    const allowed = blockedCapabilities.length === 0 && !riskExceeded;
    
    let reason: string | undefined;
    if (!allowed) {
      if (blockedCapabilities.length > 0) {
        reason = `Persona ${persona} n'a pas acces a: ${blockedCapabilities.join(", ")}`;
      } else if (riskExceeded) {
        reason = `Niveau de risque ${actionRiskLevel} depasse le maximum ${profile.behaviorTraits.maxRiskLevel} pour ${persona}`;
      }
    }
    
    return { allowed, blockedCapabilities, riskExceeded, reason };
  }

  private inferActionRiskLevel(actionType: string): "low" | "medium" | "high" {
    const highRiskActions = [
      "email_send", "domotics_control", "file_delete", "calendar_delete", 
      "trading_execute", "trading_order", "trading_buy", "trading_sell",
      "sports_bet_place", "pronos_publish"
    ];
    const mediumRiskActions = [
      "file_generate", "calendar_create", "email_draft", "web_search",
      "trading_analyze", "trading_scenario", "trading_alert",
      "sports_analyze", "sports_predict", "pronos_generate", "pronos_validate"
    ];
    
    if (highRiskActions.includes(actionType)) return "high";
    if (mediumRiskActions.includes(actionType)) return "medium";
    return "low";
  }

  private async checkCapabilities(context: ActionContext): Promise<CapabilityCheck> {
    const result: CapabilityCheck = {
      allAvailable: true,
      unavailable: [],
      degraded: [],
      successRates: {}
    };
    
    try {
      const snapshot = await capabilityService.getCapabilitySnapshot();
      
      for (const cap of snapshot.capabilities) {
        if (context.requiredCapabilities?.includes(cap.name) || 
            cap.category === context.actionCategory) {
          
          if (!cap.isAvailable) {
            result.allAvailable = false;
            result.unavailable.push(cap.name);
          } else if (cap.successRate < 70) {
            result.degraded.push(cap.name);
          }
          
          result.successRates[cap.name] = cap.successRate;
        }
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} Capability check error:`, error);
      result.allAvailable = false;
    }
    
    return result;
  }

  private async checkFailurePatterns(context: ActionContext): Promise<FailureCheck> {
    try {
      const recommendation = await failurePatternService.getPreActionRecommendation(
        context.userId,
        context.actionType,
        context.actionCategory
      );
      
      const patterns = await failurePatternService.analyzePatterns(context.userId, 7);
      const relevantPattern = patterns.patterns.find(
        p => p.actionType === context.actionType && p.actionCategory === context.actionCategory
      );
      
      return {
        riskLevel: recommendation.riskLevel,
        successProbability: recommendation.successProbability,
        recentFailures: relevantPattern?.recentFailures || 0,
        recommendations: recommendation.recommendations
      };
    } catch (error) {
      console.error(`${LOG_PREFIX} Failure pattern check error:`, error);
      return {
        riskLevel: "low",
        successProbability: 80,
        recentFailures: 0,
        recommendations: []
      };
    }
  }

  private async checkBrainContext(context: ActionContext): Promise<BrainContextSummary | undefined> {
    if (!context.query) return undefined;
    
    try {
      const knowledge = await brainService.searchKnowledge(context.userId, context.query, { limit: 5 });
      
      if (knowledge.length === 0) {
        return {
          relevantKnowledge: 0,
          relatedTopics: []
        };
      }
      
      const highConfidence = knowledge.filter(k => k.confidence >= 80);
      
      return {
        relevantKnowledge: knowledge.length,
        directAnswer: highConfidence.length > 0 ? highConfidence[0].summary || undefined : undefined,
        relatedTopics: [...new Set(knowledge.map(k => k.category))].slice(0, 3)
      };
    } catch (error) {
      console.error(`${LOG_PREFIX} Brain context check error:`, error);
      return undefined;
    }
  }

  private generateAlternatives(
    context: ActionContext,
    capabilityCheck: CapabilityCheck,
    failureCheck: FailureCheck
  ): ActionAlternative[] {
    const alternatives: ActionAlternative[] = [];
    
    const fallbackMap: Record<string, { action: string; reason: string }[]> = {
      "web_search": [
        { action: "brain_search", reason: "Chercher dans les connaissances existantes" },
        { action: "ask_clarification", reason: "Demander plus de détails" }
      ],
      "email_send": [
        { action: "email_draft", reason: "Créer un brouillon à valider" },
        { action: "notify_user", reason: "Notifier l'utilisateur pour action manuelle" }
      ],
      "calendar_create": [
        { action: "calendar_suggest", reason: "Suggérer un créneau" },
        { action: "reminder_create", reason: "Créer un rappel à la place" }
      ],
      "domotics_control": [
        { action: "domotics_status", reason: "Vérifier l'état actuel" },
        { action: "notify_user", reason: "Alerter pour action manuelle" }
      ],
      "file_generate": [
        { action: "file_draft", reason: "Generer un brouillon" },
        { action: "ask_clarification", reason: "Demander les details manquants" }
      ],
      "trading_execute": [
        { action: "trading_analyze", reason: "Analyser avant d'executer" },
        { action: "trading_scenario", reason: "Generer des scenarios" },
        { action: "confirm_first", reason: "Demander confirmation explicite" }
      ],
      "trading_analyze": [
        { action: "brain_search", reason: "Consulter les analyses precedentes" },
        { action: "trading_brief", reason: "Obtenir un apercu du marche" }
      ],
      "sports_bet_place": [
        { action: "sports_analyze", reason: "Analyser le match avant de parier" },
        { action: "pronos_validate", reason: "Valider le prono avec les regles" },
        { action: "confirm_first", reason: "Demander confirmation explicite" }
      ],
      "sports_analyze": [
        { action: "brain_search", reason: "Consulter les analyses precedentes" },
        { action: "sports_brief", reason: "Obtenir le contexte sportif" }
      ],
      "pronos_generate": [
        { action: "sports_analyze", reason: "Analyser d'abord" },
        { action: "check_odds", reason: "Verifier les cotes" }
      ]
    };
    
    if (!capabilityCheck.allAvailable || failureCheck.riskLevel === "critical") {
      const fallbacks = fallbackMap[context.actionType] || [];
      for (const fb of fallbacks) {
        alternatives.push({
          action: fb.action,
          reason: fb.reason,
          confidence: failureCheck.successProbability * 0.9
        });
      }
    }
    
    if (failureCheck.riskLevel === "high") {
      alternatives.push({
        action: "confirm_first",
        reason: "Demander confirmation avant d'exécuter (risque élevé)",
        confidence: 90
      });
    }
    
    return alternatives.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
  }

  private synthesizeDecision(
    context: ActionContext,
    capabilityCheck: CapabilityCheck,
    failureCheck: FailureCheck,
    brainContext?: BrainContextSummary,
    personaCheck?: { allowed: boolean; blockedCapabilities: string[]; riskExceeded: boolean; reason?: string }
  ): { shouldProceed: boolean; confidence: number; justification: string; risks: string[] } {
    const risks: string[] = [];
    let confidence = 100;
    let shouldProceed = true;
    const justifications: string[] = [];
    
    if (personaCheck && !personaCheck.allowed) {
      shouldProceed = false;
      confidence -= 60;
      if (personaCheck.reason) {
        risks.push(personaCheck.reason);
        justifications.push("Restrictions persona non satisfaites");
      }
    }
    
    if (!capabilityCheck.allAvailable) {
      shouldProceed = false;
      confidence -= 50;
      risks.push(`Capacites indisponibles: ${capabilityCheck.unavailable.join(", ")}`);
      justifications.push("Dependances non disponibles");
    }
    
    if (capabilityCheck.degraded.length > 0) {
      confidence -= 15 * capabilityCheck.degraded.length;
      risks.push(`Capacites degradees: ${capabilityCheck.degraded.join(", ")}`);
    }
    
    switch (failureCheck.riskLevel) {
      case "critical":
        shouldProceed = false;
        confidence -= 40;
        risks.push(`Taux d'echec critique (${100 - failureCheck.successProbability}%)`);
        justifications.push("Trop d'echecs recents pour cette action");
        break;
      case "high":
        confidence -= 25;
        risks.push(`Risque eleve d'echec (${100 - failureCheck.successProbability}%)`);
        break;
      case "medium":
        confidence -= 10;
        risks.push("Risque modere base sur l'historique");
        break;
    }
    
    if (failureCheck.recentFailures >= 3) {
      confidence -= 15;
      risks.push(`${failureCheck.recentFailures} echecs dans les dernieres 24h`);
    }
    
    if (brainContext?.directAnswer) {
      justifications.push("Reponse directe trouvee dans le Brain");
      confidence = Math.min(confidence + 10, 100);
    }
    
    const domain = this.inferDomain(context.actionCategory);
    const scoreAdjustment = contextOptimizerService.getScoreAdjustment(domain);
    if (scoreAdjustment !== 0) {
      confidence += scoreAdjustment;
      if (scoreAdjustment > 0) {
        justifications.push(`Bonus domaine ${domain} (+${scoreAdjustment}%)`);
      } else {
        risks.push(`Malus domaine ${domain} (${scoreAdjustment}%)`);
      }
    }
    
    confidence = Math.max(0, Math.min(100, confidence));
    
    if (shouldProceed && confidence < 40) {
      shouldProceed = false;
      justifications.push("Confiance trop basse pour proceder");
    }
    
    const justification = justifications.length > 0 
      ? justifications.join(". ") 
      : "Action autorisee avec confiance nominale";
    
    return { shouldProceed, confidence, justification, risks };
  }
  
  private inferDomain(category: string): string {
    const domainMap: Record<string, string> = {
      trading: "trading",
      finance: "trading",
      market: "trading",
      sports: "sports",
      foot: "sports",
      pronos: "sports",
      betting: "sports",
      email: "general",
      calendar: "general",
      file: "general",
      search: "general"
    };
    return domainMap[category.toLowerCase()] || "general";
  }
  
  recordActionResult(
    userId: number,
    actionType: string,
    category: string,
    success: boolean
  ): void {
    const domain = this.inferDomain(category);
    contextOptimizerService.recordFeedback(userId, actionType, domain, success);
    console.log(`${LOG_PREFIX} Recorded result: ${actionType} (${domain}) -> ${success ? "SUCCESS" : "FAILURE"}`);
  }

  async getActionRecommendation(
    userId: number,
    intentions: string[],
    currentContext: { persona?: string; location?: string; timeOfDay?: string }
  ): Promise<{
    recommendedActions: { action: string; score: number; reason: string }[];
    warnings: string[];
    systemHealth: number;
  }> {
    const warnings: string[] = [];
    const recommendedActions: { action: string; score: number; reason: string }[] = [];
    
    try {
      const metrics = await systemMetricsService.getMetrics(userId);
      
      if (metrics.healthScore < 50) {
        warnings.push("Système en mode dégradé - certaines actions peuvent échouer");
      }
      
      for (const intention of intentions) {
        const context: ActionContext = {
          userId,
          actionType: intention,
          actionCategory: this.inferCategory(intention),
          persona: currentContext.persona
        };
        
        const decision = await this.evaluateAction(context);
        
        if (decision.shouldProceed) {
          recommendedActions.push({
            action: intention,
            score: decision.confidence,
            reason: decision.justification
          });
        } else {
          for (const alt of decision.alternatives) {
            recommendedActions.push({
              action: alt.action,
              score: alt.confidence,
              reason: alt.reason
            });
          }
        }
      }
      
      return {
        recommendedActions: recommendedActions.sort((a, b) => b.score - a.score),
        warnings,
        systemHealth: metrics.healthScore
      };
    } catch (error) {
      console.error(`${LOG_PREFIX} Recommendation error:`, error);
      return {
        recommendedActions: [],
        warnings: ["Erreur lors de l'évaluation des actions"],
        systemHealth: 50
      };
    }
  }

  private inferCategory(actionType: string): string {
    const categoryMap: Record<string, string> = {
      "web_search": "recherche",
      "brain_search": "memoire",
      "email_send": "email",
      "email_read": "email",
      "calendar_create": "calendrier",
      "calendar_read": "calendrier",
      "file_generate": "fichiers",
      "file_read": "fichiers",
      "domotics_control": "domotique",
      "domotics_status": "domotique",
      "sports_pronos": "sports",
      "sports_analyze": "sports",
      "sports_predict": "sports",
      "sports_bet_place": "sports",
      "pronos_generate": "pronos",
      "pronos_validate": "pronos",
      "pronos_publish": "pronos",
      "trading_analyze": "trading",
      "trading_scenario": "trading",
      "trading_execute": "trading",
      "trading_brief": "trading",
      "trading_alert": "trading",
      "sugu_management": "sugu"
    };
    
    return categoryMap[actionType] || "general";
  }
}

export const decisionEngineService = new DecisionEngineService();
