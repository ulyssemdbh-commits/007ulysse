/**
 * DECISION COACH FRAMEWORK V1
 * 
 * Mode aide à la décision structuré.
 * Quand Maurice hésite entre des options, Ulysse:
 * 1. Structure les options
 * 2. Analyse coûts/gains/risques/impact
 * 3. Pondère selon les priorités de Maurice
 * 4. Prend position claire avec justification
 */

const LOG_PREFIX = "[DecisionCoach]";

export interface DecisionOption {
  name: string;
  description?: string;
  cost?: number | string;
  gain?: number | string;
  risk: "low" | "medium" | "high";
  timeImpact?: string;
  mentalLoad?: "low" | "medium" | "high";
}

export interface DecisionAnalysis {
  id: string;
  question: string;
  domain: string;
  options: DecisionOption[];
  recommendation: string;
  reasons: string[];
  confidence: number;
  reversibility: "easy" | "moderate" | "difficult" | "irreversible";
  createdAt: number;
}

interface WeightConfig {
  risk: number;
  cost: number;
  gain: number;
  time: number;
  mentalLoad: number;
}

const DOMAIN_WEIGHTS: Record<string, WeightConfig> = {
  sugu: { risk: 25, cost: 30, gain: 25, time: 10, mentalLoad: 10 },
  sports: { risk: 40, cost: 10, gain: 35, time: 5, mentalLoad: 10 },
  dev: { risk: 20, cost: 10, gain: 25, time: 25, mentalLoad: 20 },
  finance: { risk: 35, cost: 20, gain: 30, time: 10, mentalLoad: 5 },
  perso: { risk: 15, cost: 20, gain: 20, time: 20, mentalLoad: 25 },
  default: { risk: 25, cost: 20, gain: 25, time: 15, mentalLoad: 15 }
};

class DecisionCoachService {
  private history: DecisionAnalysis[] = [];
  private maxHistory = 50;

  isDecisionQuery(query: string): boolean {
    const patterns = [
      /hésite|hésitation|choix|choisir/i,
      /option.*ou.*option/i,
      /entre.*et/i,
      /quoi faire|que faire|comment décider/i,
      /mieux.*ou|préfère.*ou|vaut.*mieux/i,
      /investir.*ou|acheter.*ou|prendre.*ou/i,
      /décision|trancher|arbitrer/i
    ];
    return patterns.some(p => p.test(query));
  }

  generateDecisionPrompt(query: string, domain: string): string {
    const weights = DOMAIN_WEIGHTS[domain] || DOMAIN_WEIGHTS.default;

    return `[MODE DECISION COACH ACTIVÉ]

Tu es en mode aide à la décision. Analyse structurée obligatoire:

1. IDENTIFIER les options (minimum 2)
2. ÉVALUER chaque option sur 5 critères:
   - Risque (poids: ${weights.risk}%): probabilité de problème
   - Coût (poids: ${weights.cost}%): financier, temps, énergie
   - Gain (poids: ${weights.gain}%): bénéfice concret attendu
   - Impact temps (poids: ${weights.time}%): court vs long terme
   - Charge mentale (poids: ${weights.mentalLoad}%): stress, complexité

3. FORMAT DE SORTIE:
   Tableau comparatif:
   | Critère | Option A | Option B |
   |---------|----------|----------|
   | Risque  | ...      | ...      |
   | Coût    | ...      | ...      |
   | Gain    | ...      | ...      |
   | Temps   | ...      | ...      |
   | Mental  | ...      | ...      |

4. RECOMMANDATION:
   "Je recommande [Option X] pour ces 3 raisons:"
   1. [Raison concrète 1]
   2. [Raison concrète 2]
   3. [Raison concrète 3]

   "Ce qui pourrait me faire changer d'avis: [condition]"

Demande de Maurice: "${query}"
Domaine: ${domain}`;
  }

  recordDecision(analysis: Omit<DecisionAnalysis, "id" | "createdAt">): DecisionAnalysis {
    const decision: DecisionAnalysis = {
      ...analysis,
      id: `dec_${Date.now()}`,
      createdAt: Date.now()
    };
    this.history.push(decision);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
    console.log(`${LOG_PREFIX} Decision recorded: ${decision.question.substring(0, 50)}... → ${decision.recommendation}`);
    return decision;
  }

  getRecentDecisions(limit: number = 5): DecisionAnalysis[] {
    return this.history.slice(-limit).reverse();
  }

  getStats(): { totalDecisions: number; byDomain: Record<string, number>; avgConfidence: number } {
    const byDomain: Record<string, number> = {};
    let totalConfidence = 0;
    for (const d of this.history) {
      byDomain[d.domain] = (byDomain[d.domain] || 0) + 1;
      totalConfidence += d.confidence;
    }
    return {
      totalDecisions: this.history.length,
      byDomain,
      avgConfidence: this.history.length > 0 ? totalConfidence / this.history.length : 0
    };
  }
}

export const decisionCoachService = new DecisionCoachService();
