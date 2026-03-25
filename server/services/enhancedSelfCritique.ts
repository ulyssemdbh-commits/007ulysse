/**
 * ENHANCED SELF-CRITIQUE SERVICE V1
 * 
 * Vérification de confiance avant chaque réponse critique.
 * Ulysse se demande: "Est-ce que ce que je dis est assez solide pour que Maurice agisse dessus?"
 * 
 * Domaines critiques (vérification renforcée):
 * - Sports (données, pronostics, cotes)
 * - Finance (cours, recommandations)
 * - SUGU (chiffres, analyses business)
 * - Emails réels
 * - Conseils de vie / décisions
 * 
 * Si la confiance est < seuil → nuancer, vérifier, ou signaler
 */

const LOG_PREFIX = "[SelfCritique]";

export interface CritiqueResult {
  shouldProceed: boolean;
  confidenceLevel: number;
  warnings: string[];
  suggestedDisclaimer?: string;
  verificationsNeeded: string[];
  domain: string;
}

interface CritiqueCriteria {
  domain: string;
  minConfidence: number;
  criticalPatterns: RegExp[];
  verificationRequired: string[];
  disclaimerTemplate: string;
}

class EnhancedSelfCritiqueService {
  private criteria: CritiqueCriteria[] = [
    {
      domain: "sports",
      minConfidence: 70,
      criticalPatterns: [/cote|odds|résultat|score|gagnant|prono/i],
      verificationRequired: ["Source des données", "Fraîcheur des stats", "Historique H2H vérifié"],
      disclaimerTemplate: "⚠️ Pronostic basé sur les données disponibles - vérifier les cotes en temps réel avant de parier"
    },
    {
      domain: "finance",
      minConfidence: 80,
      criticalPatterns: [/cours|prix|action|investir|acheter|vendre|bitcoin/i],
      verificationRequired: ["Données en temps réel", "Source fiable", "Disclamer risque"],
      disclaimerTemplate: "⚠️ Information financière indicative - ce n'est pas un conseil d'investissement"
    },
    {
      domain: "sugu",
      minConfidence: 75,
      criticalPatterns: [/chiffre|montant|€|euro|bilan|marge|perte|gain/i],
      verificationRequired: ["Données SUGU vérifiées", "Période correcte", "Calculs cohérents"],
      disclaimerTemplate: "📊 Analyse basée sur les données SUGU disponibles"
    },
    {
      domain: "email",
      minConfidence: 85,
      criticalPatterns: [/envoyer|répondre|transférer|mail|destinataire/i],
      verificationRequired: ["Destinataire confirmé", "Contenu vérifié", "Pas d'info sensible"],
      disclaimerTemplate: "✉️ Vérifier le contenu et les destinataires avant envoi"
    },
    {
      domain: "decision",
      minConfidence: 65,
      criticalPatterns: [/recommande|conseil|tu devrais|il faut|choisis/i],
      verificationRequired: ["Options bien identifiées", "Données factuelles", "Biais vérifiés"],
      disclaimerTemplate: "💡 Recommandation basée sur les informations disponibles - la décision finale te revient"
    }
  ];

  private critiqueHistory: Array<{ domain: string; confidence: number; passed: boolean; timestamp: number }> = [];

  evaluate(response: string, domain: string, toolsUsed: string[], dataFreshness?: number): CritiqueResult {
    const criteria = this.criteria.find(c => c.domain === domain);
    if (!criteria) {
      return { shouldProceed: true, confidenceLevel: 80, warnings: [], verificationsNeeded: [], domain };
    }

    const warnings: string[] = [];
    const verificationsNeeded: string[] = [];
    let confidence = 80;

    const hasCriticalContent = criteria.criticalPatterns.some(p => p.test(response));
    if (!hasCriticalContent) {
      return { shouldProceed: true, confidenceLevel: 85, warnings: [], verificationsNeeded: [], domain };
    }

    if (toolsUsed.length === 0) {
      confidence -= 20;
      warnings.push("Aucun outil de données utilisé pour cette réponse critique");
      verificationsNeeded.push("Utiliser les outils de données appropriés");
    }

    if (dataFreshness && dataFreshness > 3600 * 1000) {
      confidence -= 15;
      warnings.push("Données potentiellement périmées (> 1h)");
      verificationsNeeded.push("Vérifier la fraîcheur des données");
    }

    const numberPattern = /\d+[.,]?\d*\s*(%|€|M|k|points?|buts?|matchs?)/g;
    const numbers = response.match(numberPattern);
    if (numbers && numbers.length > 5) {
      confidence -= 5;
      warnings.push("Beaucoup de données chiffrées - vérification recommandée");
    }

    const certaintyWords = /certainement|absolument|sans aucun doute|c'est sûr|100%|garanti/i;
    if (certaintyWords.test(response)) {
      confidence -= 10;
      warnings.push("Langage trop affirmatif pour un sujet incertain");
      verificationsNeeded.push("Nuancer les affirmations absolues");
    }

    const vagueWords = /peut-être|probablement|je pense|il me semble|environ/i;
    const vagueCount = (response.match(vagueWords) || []).length;
    if (vagueCount > 3) {
      confidence -= 10;
      warnings.push("Trop de termes vagues - manque de données concrètes");
    }

    const shouldProceed = confidence >= criteria.minConfidence;

    this.critiqueHistory.push({ domain, confidence, passed: shouldProceed, timestamp: Date.now() });
    if (this.critiqueHistory.length > 200) {
      this.critiqueHistory = this.critiqueHistory.slice(-200);
    }

    if (!shouldProceed) {
      console.log(`${LOG_PREFIX} Response blocked for ${domain}: confidence ${confidence}% < ${criteria.minConfidence}% threshold`);
    }

    return {
      shouldProceed,
      confidenceLevel: confidence,
      warnings,
      suggestedDisclaimer: hasCriticalContent ? criteria.disclaimerTemplate : undefined,
      verificationsNeeded: [...verificationsNeeded, ...criteria.verificationRequired.filter((_, i) => i < 2)],
      domain
    };
  }

  generateCritiquePrompt(): string {
    const recent = this.critiqueHistory.slice(-20);
    if (recent.length < 3) return "";

    const blocked = recent.filter(c => !c.passed).length;
    const avgConfidence = recent.reduce((sum, c) => sum + c.confidence, 0) / recent.length;

    if (blocked === 0 && avgConfidence > 75) return "";

    return `\n[AUTO-CRITIQUE ACTIVE]
${blocked > 0 ? `⚠️ ${blocked}/${recent.length} réponses récentes sous le seuil de confiance.` : ""}
Confiance moyenne: ${avgConfidence.toFixed(0)}%
RAPPEL: Sur les sujets critiques (argent, paris, décisions), demande-toi TOUJOURS:
"Est-ce assez solide pour que Maurice agisse dessus?"
Si la réponse est "bof" → nuance, propose de vérifier, ou signale le manque de données.`;
  }

  getStats(): { totalEvaluations: number; passRate: number; avgConfidence: number; byDomain: Record<string, { pass: number; fail: number }> } {
    const byDomain: Record<string, { pass: number; fail: number }> = {};
    let totalConfidence = 0;

    for (const c of this.critiqueHistory) {
      if (!byDomain[c.domain]) byDomain[c.domain] = { pass: 0, fail: 0 };
      if (c.passed) byDomain[c.domain].pass++;
      else byDomain[c.domain].fail++;
      totalConfidence += c.confidence;
    }

    const total = this.critiqueHistory.length;
    return {
      totalEvaluations: total,
      passRate: total > 0 ? this.critiqueHistory.filter(c => c.passed).length / total : 1,
      avgConfidence: total > 0 ? totalConfidence / total : 80,
      byDomain
    };
  }
}

export const enhancedSelfCritiqueService = new EnhancedSelfCritiqueService();
