/**
 * SMART MODEL ROUTER V1
 * 
 * Routage dynamique entre modèles IA basé sur:
 * - Complexité de la requête
 * - Domaine détecté
 * - Performance historique (KPIs)
 * - Budget tokens disponible
 * - Latence cible
 */

const LOG_PREFIX = "[ModelRouter]";

export interface ModelRoute {
  provider: "gemini" | "openai" | "grok";
  model: string;
  reason: string;
  maxTokens: number;
  temperature: number;
  estimatedLatencyMs: number;
}

interface ModelProfile {
  provider: "gemini" | "openai" | "grok";
  model: string;
  strengths: string[];
  maxTokens: number;
  defaultTemp: number;
  costTier: "low" | "medium" | "high";
  avgLatencyMs: number;
  bestForDomains: string[];
}

const MODEL_PROFILES: ModelProfile[] = [
  {
    provider: "gemini",
    model: "gemini-2.5-flash-preview-05-20",
    strengths: ["speed", "general", "multilingual", "long_context"],
    maxTokens: 8192,
    defaultTemp: 0.7,
    costTier: "low",
    avgLatencyMs: 800,
    bestForDomains: ["general", "weather", "calendar", "music", "domotique", "greeting"]
  },
  {
    provider: "openai",
    model: "gpt-4o",
    strengths: ["reasoning", "code", "analysis", "nuance", "creativity"],
    maxTokens: 4096,
    defaultTemp: 0.7,
    costTier: "medium",
    avgLatencyMs: 1500,
    bestForDomains: ["dev", "finance", "sugu", "decision", "research"]
  },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    strengths: ["speed", "simple_tasks", "extraction"],
    maxTokens: 4096,
    defaultTemp: 0.5,
    costTier: "low",
    avgLatencyMs: 600,
    bestForDomains: ["email", "memory", "simple"]
  },
  {
    provider: "grok",
    model: "grok-2-1212",
    strengths: ["reasoning", "general", "uncensored", "realtime_knowledge"],
    maxTokens: 8192,
    defaultTemp: 0.7,
    costTier: "medium",
    avgLatencyMs: 1200,
    bestForDomains: ["sports", "research", "general", "decision"]
  }
];

interface ComplexityAnalysis {
  score: number;
  factors: string[];
  requiresReasoning: boolean;
  requiresCreativity: boolean;
  isMultiStep: boolean;
  domain: string;
}

class SmartModelRouter {
  private routingHistory: Array<{ domain: string; provider: string; model: string; latencyMs: number; success: boolean }> = [];
  private domainPerformance: Map<string, Map<string, { avgLatency: number; successRate: number; count: number }>> = new Map();
  private maxHistory = 500;

  route(query: string, domain?: string, providerConstraint?: "openai" | "gemini" | "grok"): ModelRoute {
    const analysis = this.analyzeComplexity(query, domain);
    const bestModel = this.selectModel(analysis, providerConstraint || "openai");
    
    return {
      provider: bestModel.provider,
      model: bestModel.model,
      reason: `Complexité ${analysis.score}/100 (${analysis.factors.join(", ")}) → ${bestModel.model}`,
      maxTokens: bestModel.maxTokens,
      temperature: this.adjustTemperature(bestModel.defaultTemp, analysis),
      estimatedLatencyMs: bestModel.avgLatencyMs
    };
  }

  private analyzeComplexity(query: string, domain?: string): ComplexityAnalysis {
    let score = 30;
    const factors: string[] = [];
    const detectedDomain = domain || this.detectDomain(query);

    if (query.length > 200) { score += 15; factors.push("long_query"); }
    if (query.length > 500) { score += 10; factors.push("very_long"); }

    const reasoningWords = /analyse|compare|explique|pourquoi|comment|stratégie|optimise|évalue|décision/i;
    if (reasoningWords.test(query)) { score += 20; factors.push("reasoning"); }

    const multiStepWords = /d'abord.*puis|et ensuite|étape|plan|organise.*et/i;
    if (multiStepWords.test(query)) { score += 15; factors.push("multi_step"); }

    const creativeWords = /imagine|invente|crée|rédige|écris|propose.*idée/i;
    if (creativeWords.test(query)) { score += 10; factors.push("creative"); }

    const codeWords = /code|bug|erreur|fonction|api|endpoint|refactor|architecture/i;
    if (codeWords.test(query)) { score += 15; factors.push("code"); }

    const dataWords = /données|statistiques|tendance|bilan|synthèse|rapport/i;
    if (dataWords.test(query)) { score += 10; factors.push("data_analysis"); }

    if (query.split(/[?]/).length > 2) { score += 10; factors.push("multi_question"); }

    return {
      score: Math.min(score, 100),
      factors,
      requiresReasoning: factors.includes("reasoning") || factors.includes("code"),
      requiresCreativity: factors.includes("creative"),
      isMultiStep: factors.includes("multi_step"),
      domain: detectedDomain
    };
  }

  private selectModel(analysis: ComplexityAnalysis, providerConstraint?: string): ModelProfile {
    const eligible = providerConstraint 
      ? MODEL_PROFILES.filter(m => m.provider === providerConstraint)
      : MODEL_PROFILES;

    if (analysis.score >= 70 || analysis.requiresReasoning) {
      return eligible.find(m => m.model === "gpt-4o") || eligible[0];
    }

    if (analysis.score <= 45) {
      return eligible.find(m => m.model === "gpt-4o-mini") || eligible[0];
    }

    const domainModel = eligible.find(m => m.bestForDomains.includes(analysis.domain));
    if (domainModel) return domainModel;

    const perf = this.domainPerformance.get(analysis.domain);
    if (perf) {
      let bestModel = eligible[0];
      let bestScore = 0;
      for (const profile of eligible) {
        const modelPerf = perf.get(profile.model);
        if (modelPerf && modelPerf.count >= 3) {
          const perfScore = modelPerf.successRate * 50 + (1 - modelPerf.avgLatency / 5000) * 50;
          if (perfScore > bestScore) {
            bestScore = perfScore;
            bestModel = profile;
          }
        }
      }
      if (bestScore > 0) return bestModel;
    }

    return eligible[0];
  }

  private adjustTemperature(baseTemp: number, analysis: ComplexityAnalysis): number {
    if (analysis.requiresReasoning) return Math.max(baseTemp - 0.2, 0.3);
    if (analysis.requiresCreativity) return Math.min(baseTemp + 0.1, 0.9);
    if (analysis.domain === "sports" || analysis.domain === "finance") return Math.max(baseTemp - 0.1, 0.3);
    return baseTemp;
  }

  recordOutcome(domain: string, provider: string, model: string, latencyMs: number, success: boolean): void {
    this.routingHistory.push({ domain, provider, model, latencyMs, success });
    if (this.routingHistory.length > this.maxHistory) {
      this.routingHistory = this.routingHistory.slice(-this.maxHistory);
    }

    if (!this.domainPerformance.has(domain)) {
      this.domainPerformance.set(domain, new Map());
    }
    const domainMap = this.domainPerformance.get(domain)!;
    const existing = domainMap.get(model) || { avgLatency: 0, successRate: 1, count: 0 };
    
    existing.count++;
    existing.avgLatency = (existing.avgLatency * (existing.count - 1) + latencyMs) / existing.count;
    existing.successRate = (existing.successRate * (existing.count - 1) + (success ? 1 : 0)) / existing.count;
    domainMap.set(model, existing);
  }

  private detectDomain(query: string): string {
    const q = query.toLowerCase();
    if (/foot|match|prono|sport|ligue|cote/i.test(q)) return "sports";
    if (/code|bug|api|deploy|feature/i.test(q)) return "dev";
    if (/sugu|restaurant|courses|stock/i.test(q)) return "sugu";
    if (/bourse|action|bitcoin|trading/i.test(q)) return "finance";
    if (/email|mail|inbox/i.test(q)) return "email";
    if (/agenda|calendrier|rdv/i.test(q)) return "calendar";
    if (/musique|spotify/i.test(q)) return "music";
    if (/lumière|lampe|maison/i.test(q)) return "domotique";
    if (/météo|temps|température/i.test(q)) return "weather";
    if (/analyse|compare|décision/i.test(q)) return "decision";
    return "general";
  }

  generateRouterPrompt(): string {
    const total = this.routingHistory.length;
    if (total === 0) return "";

    const modelCounts: Record<string, number> = {};
    for (const r of this.routingHistory) {
      modelCounts[r.model] = (modelCounts[r.model] || 0) + 1;
    }

    const items = Object.entries(modelCounts).map(([m, c]) => `${m}: ${c} appels`).join(", ");
    return `\n[MODEL ROUTING] ${total} requêtes routées: ${items}`;
  }

  getStats(): { totalRouted: number; modelDistribution: Record<string, number>; domainPerformance: Record<string, any> } {
    const modelDistribution: Record<string, number> = {};
    for (const r of this.routingHistory) {
      modelDistribution[r.model] = (modelDistribution[r.model] || 0) + 1;
    }

    const perfSummary: Record<string, any> = {};
    this.domainPerformance.forEach((models, domain) => {
      perfSummary[domain] = {};
      models.forEach((data, model) => {
        perfSummary[domain][model] = data;
      });
    });

    return { totalRouted: this.routingHistory.length, modelDistribution, domainPerformance: perfSummary };
  }
}

export const smartModelRouter = new SmartModelRouter();
