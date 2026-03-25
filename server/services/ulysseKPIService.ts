/**
 * ULYSSE KPI SERVICE V1
 * 
 * 5 KPIs de performance et d'amélioration continue:
 * 1. Latence Moyenne par domaine
 * 2. Taux de Succès des Outils (quels combos marchent le mieux)
 * 3. Erreurs Factuelles détectées (hallucinations, données inventées)
 * 4. Vitesse d'Apprentissage (patterns acquis par période)
 * 5. Satisfaction Implicite (corrections/reproches vs validations)
 */

import { autoLearningEngine } from "./autoLearningEngine";

interface DomainLatency {
  domain: string;
  avgMs: number;
  minMs: number;
  maxMs: number;
  count: number;
  p95Ms: number;
  trend: "improving" | "stable" | "degrading";
}

interface ToolSuccessRate {
  toolName: string;
  successRate: number;
  totalCalls: number;
  avgLatencyMs: number;
  bestCombos: string[];
  worstCombos: string[];
}

interface FactualError {
  id: string;
  domain: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  detectedAt: number;
  corrected: boolean;
  correctionSource: string;
}

interface SatisfactionSignal {
  type: "positive" | "negative" | "correction" | "praise";
  query: string;
  domain: string;
  timestamp: number;
  detail: string;
}

export interface UlysseKPISnapshot {
  timestamp: number;
  kpi1_latency: {
    globalAvgMs: number;
    byDomain: DomainLatency[];
    trend: "improving" | "stable" | "degrading";
  };
  kpi2_toolSuccess: {
    globalSuccessRate: number;
    topTools: ToolSuccessRate[];
    bestCombinations: { combo: string; successRate: number; count: number }[];
  };
  kpi3_factualErrors: {
    totalDetected: number;
    last24h: number;
    last7d: number;
    correctionRate: number;
    byDomain: Record<string, number>;
    recentErrors: FactualError[];
  };
  kpi4_learningVelocity: {
    patternsTotal: number;
    patternsLast24h: number;
    patternsLast7d: number;
    velocityScore: number;
    byDomain: Record<string, number>;
    trend: "accelerating" | "steady" | "slowing";
  };
  kpi5_satisfaction: {
    score: number;
    positiveSignals: number;
    negativeSignals: number;
    correctionCount: number;
    praiseCount: number;
    trend: "improving" | "stable" | "declining";
    recentSignals: SatisfactionSignal[];
  };
  overallHealth: {
    score: number;
    grade: "A+" | "A" | "B" | "C" | "D" | "F";
    summary: string;
    recommendations: string[];
  };
}

class UlysseKPIService {
  private domainLatencies: Map<string, number[]> = new Map();
  private toolCalls: Map<string, { success: boolean; latencyMs: number; combo: string[] }[]> = new Map();
  private factualErrors: FactualError[] = [];
  private satisfactionSignals: SatisfactionSignal[] = [];
  private interactionTimestamps: number[] = [];
  private learningTimestamps: number[] = [];
  private comboResults: Map<string, { success: number; total: number }> = new Map();

  private readonly MAX_HISTORY = 1000;

  constructor() {
    console.log("[UlysseKPI] Service de KPIs initialisé - 5 indicateurs actifs");
  }

  recordLatency(domain: string, latencyMs: number): void {
    if (!this.domainLatencies.has(domain)) {
      this.domainLatencies.set(domain, []);
    }
    const arr = this.domainLatencies.get(domain)!;
    arr.push(latencyMs);
    if (arr.length > this.MAX_HISTORY) arr.shift();
    this.interactionTimestamps.push(Date.now());
    if (this.interactionTimestamps.length > this.MAX_HISTORY) this.interactionTimestamps.shift();
  }

  recordToolCall(toolName: string, success: boolean, latencyMs: number, combo: string[] = []): void {
    if (!this.toolCalls.has(toolName)) {
      this.toolCalls.set(toolName, []);
    }
    const arr = this.toolCalls.get(toolName)!;
    arr.push({ success, latencyMs, combo });
    if (arr.length > this.MAX_HISTORY) arr.shift();

    if (combo.length > 1) {
      const comboKey = combo.sort().join(" + ");
      if (!this.comboResults.has(comboKey)) {
        this.comboResults.set(comboKey, { success: 0, total: 0 });
      }
      const cr = this.comboResults.get(comboKey)!;
      cr.total++;
      if (success) cr.success++;
    }
  }

  recordFactualError(domain: string, description: string, severity: FactualError["severity"] = "medium"): void {
    const error: FactualError = {
      id: `ferr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      domain,
      description,
      severity,
      detectedAt: Date.now(),
      corrected: false,
      correctionSource: ""
    };
    this.factualErrors.push(error);
    if (this.factualErrors.length > this.MAX_HISTORY) this.factualErrors.shift();

    this.recordSatisfactionSignal("negative", description, domain, `Erreur factuelle: ${description.substring(0, 80)}`);
  }

  markErrorCorrected(errorId: string, source: string = "auto"): void {
    const err = this.factualErrors.find(e => e.id === errorId);
    if (err) {
      err.corrected = true;
      err.correctionSource = source;
    }
  }

  recordSatisfactionSignal(
    type: SatisfactionSignal["type"],
    query: string,
    domain: string,
    detail: string
  ): void {
    this.satisfactionSignals.push({
      type,
      query: query.substring(0, 120),
      domain,
      timestamp: Date.now(),
      detail: detail.substring(0, 200)
    });
    if (this.satisfactionSignals.length > this.MAX_HISTORY) this.satisfactionSignals.shift();
  }

  recordLearningEvent(): void {
    this.learningTimestamps.push(Date.now());
    if (this.learningTimestamps.length > this.MAX_HISTORY) this.learningTimestamps.shift();
  }

  detectSatisfactionFromMessage(message: string, domain: string): void {
    const msgLower = message.toLowerCase();

    const negativePatterns = [
      /(?:non|pas|faux|erreur|incorrect|n'importe quoi|invente|hallucin|mauvais|nul|stop|arrête)/i,
      /(?:c'est pas ça|t'as tort|c'est faux|encore une erreur|tu délires)/i,
      /(?:je t'ai dit|je t'ai déjà dit|combien de fois)/i
    ];

    const positivePatterns = [
      /(?:merci|parfait|excellent|génial|super|bravo|top|nickel|bien joué)/i,
      /(?:c'est ça|exactement|correct|bonne réponse|t'assures)/i,
      /(?:continue|j'aime|bien vu|pas mal)/i
    ];

    for (const pattern of negativePatterns) {
      if (pattern.test(msgLower)) {
        this.recordSatisfactionSignal("correction", message, domain, "Correction/reproche détecté");
        return;
      }
    }

    for (const pattern of positivePatterns) {
      if (pattern.test(msgLower)) {
        this.recordSatisfactionSignal("praise", message, domain, "Validation/compliment détecté");
        return;
      }
    }
  }

  getSnapshot(): UlysseKPISnapshot {
    const now = Date.now();
    const h24 = now - 24 * 60 * 60 * 1000;
    const d7 = now - 7 * 24 * 60 * 60 * 1000;

    const kpi1 = this.computeLatencyKPI();
    const kpi2 = this.computeToolSuccessKPI();
    const kpi3 = this.computeFactualErrorKPI(h24, d7);
    const kpi4 = this.computeLearningVelocityKPI(h24, d7);
    const kpi5 = this.computeSatisfactionKPI();

    const healthScore = this.computeHealthScore(kpi1, kpi2, kpi3, kpi5);

    return {
      timestamp: now,
      kpi1_latency: kpi1,
      kpi2_toolSuccess: kpi2,
      kpi3_factualErrors: kpi3,
      kpi4_learningVelocity: kpi4,
      kpi5_satisfaction: kpi5,
      overallHealth: healthScore
    };
  }

  private computeLatencyKPI(): UlysseKPISnapshot["kpi1_latency"] {
    const byDomain: DomainLatency[] = [];
    let allLatencies: number[] = [];

    const domainEntries = Array.from(this.domainLatencies.entries());
    for (const [domain, latencies] of domainEntries) {
      if (latencies.length === 0) continue;
      allLatencies = allLatencies.concat(latencies);

      const sorted = [...latencies].sort((a: number, b: number) => a - b);
      const avg = latencies.reduce((s: number, v: number) => s + v, 0) / latencies.length;
      const p95Index = Math.floor(latencies.length * 0.95);

      const halfLen = Math.floor(latencies.length / 2);
      const firstHalf = latencies.slice(0, halfLen);
      const secondHalf = latencies.slice(halfLen);
      const firstAvg = firstHalf.length > 0 ? firstHalf.reduce((s: number, v: number) => s + v, 0) / firstHalf.length : avg;
      const secondAvg = secondHalf.length > 0 ? secondHalf.reduce((s: number, v: number) => s + v, 0) / secondHalf.length : avg;
      const trendPct = firstAvg > 0 ? ((secondAvg - firstAvg) / firstAvg) * 100 : 0;

      byDomain.push({
        domain,
        avgMs: Math.round(avg),
        minMs: sorted[0],
        maxMs: sorted[sorted.length - 1],
        count: latencies.length,
        p95Ms: sorted[p95Index] || sorted[sorted.length - 1],
        trend: trendPct < -10 ? "improving" : trendPct > 10 ? "degrading" : "stable"
      });
    }

    const globalAvg = allLatencies.length > 0 ? Math.round(allLatencies.reduce((s: number, v: number) => s + v, 0) / allLatencies.length) : 0;
    const improvingCount = byDomain.filter(d => d.trend === "improving").length;
    const degradingCount = byDomain.filter(d => d.trend === "degrading").length;

    return {
      globalAvgMs: globalAvg,
      byDomain: byDomain.sort((a, b) => a.avgMs - b.avgMs),
      trend: improvingCount > degradingCount ? "improving" : degradingCount > improvingCount ? "degrading" : "stable"
    };
  }

  private computeToolSuccessKPI(): UlysseKPISnapshot["kpi2_toolSuccess"] {
    const topTools: ToolSuccessRate[] = [];
    let globalSuccess = 0;
    let globalTotal = 0;

    const toolEntries = Array.from(this.toolCalls.entries());
    for (const [toolName, calls] of toolEntries) {
      if (calls.length === 0) continue;
      const successes = calls.filter((c: { success: boolean }) => c.success).length;
      const avgLatency = calls.reduce((s: number, c: { latencyMs: number }) => s + c.latencyMs, 0) / calls.length;
      globalSuccess += successes;
      globalTotal += calls.length;

      const comboSuccessMap = new Map<string, { success: number; total: number }>();
      for (const call of calls) {
        if (call.combo.length > 1) {
          const key = call.combo.sort().join(" + ");
          if (!comboSuccessMap.has(key)) comboSuccessMap.set(key, { success: 0, total: 0 });
          const cs = comboSuccessMap.get(key)!;
          cs.total++;
          if (call.success) cs.success++;
        }
      }
      const sortedCombos = Array.from(comboSuccessMap.entries())
        .sort((a, b) => (b[1].success / b[1].total) - (a[1].success / a[1].total));

      topTools.push({
        toolName,
        successRate: Math.round((successes / calls.length) * 100),
        totalCalls: calls.length,
        avgLatencyMs: Math.round(avgLatency),
        bestCombos: sortedCombos.slice(0, 3).map(([k]) => k),
        worstCombos: sortedCombos.slice(-2).map(([k]) => k)
      });
    }

    const bestCombinations = Array.from(this.comboResults.entries())
      .filter(([, v]) => v.total >= 2)
      .map(([combo, v]) => ({
        combo,
        successRate: Math.round((v.success / v.total) * 100),
        count: v.total
      }))
      .sort((a, b) => b.successRate - a.successRate)
      .slice(0, 5);

    return {
      globalSuccessRate: globalTotal > 0 ? Math.round((globalSuccess / globalTotal) * 100) : 100,
      topTools: topTools.sort((a, b) => b.totalCalls - a.totalCalls),
      bestCombinations
    };
  }

  private computeFactualErrorKPI(h24: number, d7: number): UlysseKPISnapshot["kpi3_factualErrors"] {
    const byDomain: Record<string, number> = {};
    let corrected = 0;

    for (const err of this.factualErrors) {
      byDomain[err.domain] = (byDomain[err.domain] || 0) + 1;
      if (err.corrected) corrected++;
    }

    return {
      totalDetected: this.factualErrors.length,
      last24h: this.factualErrors.filter(e => e.detectedAt >= h24).length,
      last7d: this.factualErrors.filter(e => e.detectedAt >= d7).length,
      correctionRate: this.factualErrors.length > 0 ? Math.round((corrected / this.factualErrors.length) * 100) : 100,
      byDomain,
      recentErrors: this.factualErrors.slice(-5).reverse()
    };
  }

  private computeLearningVelocityKPI(h24: number, d7: number): UlysseKPISnapshot["kpi4_learningVelocity"] {
    const stats = autoLearningEngine.getStats();

    const patternsLast24h = this.learningTimestamps.filter(t => t >= h24).length;
    const patternsLast7d = this.learningTimestamps.filter(t => t >= d7).length;

    const velocityScore = stats.learningVelocity * 100;

    const recentRate = patternsLast24h;
    const weeklyAvgDaily = patternsLast7d / 7;
    const trend: "accelerating" | "steady" | "slowing" = 
      recentRate > weeklyAvgDaily * 1.3 ? "accelerating" :
      recentRate < weeklyAvgDaily * 0.7 ? "slowing" : "steady";

    return {
      patternsTotal: stats.totalEntries,
      patternsLast24h,
      patternsLast7d,
      velocityScore: Math.round(velocityScore * 100) / 100,
      byDomain: stats.byDomain,
      trend
    };
  }

  private computeSatisfactionKPI(): UlysseKPISnapshot["kpi5_satisfaction"] {
    const positiveCount = this.satisfactionSignals.filter(s => s.type === "positive" || s.type === "praise").length;
    const negativeCount = this.satisfactionSignals.filter(s => s.type === "negative").length;
    const correctionCount = this.satisfactionSignals.filter(s => s.type === "correction").length;
    const praiseCount = this.satisfactionSignals.filter(s => s.type === "praise").length;

    const total = this.satisfactionSignals.length;
    const score = total > 0 ? Math.round(((positiveCount + praiseCount) / total) * 100) : 50;

    const halfLen = Math.floor(this.satisfactionSignals.length / 2);
    const firstHalf = this.satisfactionSignals.slice(0, halfLen);
    const secondHalf = this.satisfactionSignals.slice(halfLen);
    const firstPositiveRate = firstHalf.length > 0 ? 
      firstHalf.filter(s => s.type === "positive" || s.type === "praise").length / firstHalf.length : 0.5;
    const secondPositiveRate = secondHalf.length > 0 ?
      secondHalf.filter(s => s.type === "positive" || s.type === "praise").length / secondHalf.length : 0.5;
    const satisfactionTrend: "improving" | "stable" | "declining" =
      secondPositiveRate > firstPositiveRate + 0.1 ? "improving" :
      secondPositiveRate < firstPositiveRate - 0.1 ? "declining" : "stable";

    return {
      score,
      positiveSignals: positiveCount,
      negativeSignals: negativeCount,
      correctionCount,
      praiseCount,
      trend: satisfactionTrend,
      recentSignals: this.satisfactionSignals.slice(-5).reverse()
    };
  }

  private computeHealthScore(
    kpi1: UlysseKPISnapshot["kpi1_latency"],
    kpi2: UlysseKPISnapshot["kpi2_toolSuccess"],
    kpi3: UlysseKPISnapshot["kpi3_factualErrors"],
    kpi5: UlysseKPISnapshot["kpi5_satisfaction"]
  ): UlysseKPISnapshot["overallHealth"] {
    let score = 50;

    if (kpi1.globalAvgMs < 2000) score += 10;
    else if (kpi1.globalAvgMs < 5000) score += 5;
    else score -= 5;
    if (kpi1.trend === "improving") score += 5;
    else if (kpi1.trend === "degrading") score -= 5;

    score += Math.round(kpi2.globalSuccessRate * 0.15);

    if (kpi3.last24h === 0) score += 10;
    else if (kpi3.last24h <= 2) score += 5;
    else score -= kpi3.last24h * 2;
    if (kpi3.correctionRate >= 80) score += 5;

    score += Math.round(kpi5.score * 0.1);
    if (kpi5.trend === "improving") score += 5;
    else if (kpi5.trend === "declining") score -= 5;

    score = Math.max(0, Math.min(100, score));

    const grade: UlysseKPISnapshot["overallHealth"]["grade"] =
      score >= 90 ? "A+" : score >= 80 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F";

    const recommendations: string[] = [];
    if (kpi1.trend === "degrading") recommendations.push("Latence en hausse - optimiser les appels parallèles et le cache");
    if (kpi2.globalSuccessRate < 85) recommendations.push("Taux de succès outils < 85% - investiguer les outils défaillants");
    if (kpi3.last24h > 3) recommendations.push("Trop d'erreurs factuelles - renforcer la vérification avant réponse");
    if (kpi5.score < 60) recommendations.push("Satisfaction basse - analyser les corrections récentes pour ajuster le comportement");
    if (kpi5.trend === "declining") recommendations.push("Satisfaction en baisse - focus sur la qualité et la précision");
    if (recommendations.length === 0) recommendations.push("Toutes les métriques sont dans les normes - continuer à apprendre");

    const summary = `Score global: ${score}/100 (${grade}). ` +
      `Latence: ${kpi1.globalAvgMs}ms (${kpi1.trend}). ` +
      `Succès outils: ${kpi2.globalSuccessRate}%. ` +
      `Erreurs 24h: ${kpi3.last24h}. ` +
      `Satisfaction: ${kpi5.score}% (${kpi5.trend}).`;

    return { score, grade, summary, recommendations };
  }

  generateKPIPrompt(): string {
    const snap = this.getSnapshot();
    const h = snap.overallHealth;

    const latencyDomains = snap.kpi1_latency.byDomain
      .slice(0, 5)
      .map(d => `  ${d.domain}: ${d.avgMs}ms (${d.trend}, ${d.count} requêtes)`)
      .join("\n");

    const topTools = snap.kpi2_toolSuccess.topTools
      .slice(0, 5)
      .map(t => `  ${t.toolName}: ${t.successRate}% succès (${t.totalCalls} appels, ~${t.avgLatencyMs}ms)`)
      .join("\n");

    const bestCombos = snap.kpi2_toolSuccess.bestCombinations
      .slice(0, 3)
      .map(c => `  ${c.combo}: ${c.successRate}% (${c.count}x)`)
      .join("\n");

    const recentErrors = snap.kpi3_factualErrors.recentErrors
      .slice(0, 3)
      .map(e => `  ⚠️ [${e.domain}] ${e.description.substring(0, 80)}${e.corrected ? " ✅ corrigé" : ""}`)
      .join("\n");

    const recentSignals = snap.kpi5_satisfaction.recentSignals
      .slice(0, 3)
      .map(s => `  ${s.type === "praise" ? "👍" : s.type === "correction" ? "👎" : "📝"} [${s.domain}] ${s.detail.substring(0, 60)}`)
      .join("\n");

    return `
## 📊 KPIs ULYSSE - Tableau de Bord (${h.grade} - ${h.score}/100)

${h.summary}

### KPI 1 - Latence par Domaine (moy: ${snap.kpi1_latency.globalAvgMs}ms, tendance: ${snap.kpi1_latency.trend})
${latencyDomains || "  Pas encore de données"}

### KPI 2 - Succès des Outils (${snap.kpi2_toolSuccess.globalSuccessRate}%)
${topTools || "  En cours de collecte"}
${bestCombos ? `\n  Meilleures combinaisons:\n${bestCombos}` : ""}

### KPI 3 - Erreurs Factuelles (${snap.kpi3_factualErrors.totalDetected} total, ${snap.kpi3_factualErrors.last24h} en 24h)
  Taux de correction: ${snap.kpi3_factualErrors.correctionRate}%
${recentErrors || "  Aucune erreur détectée ✅"}

### KPI 4 - Vitesse d'Apprentissage (vélocité: ${snap.kpi4_learningVelocity.velocityScore}, ${snap.kpi4_learningVelocity.trend})
  Total patterns: ${snap.kpi4_learningVelocity.patternsTotal} | 24h: ${snap.kpi4_learningVelocity.patternsLast24h} | 7j: ${snap.kpi4_learningVelocity.patternsLast7d}

### KPI 5 - Satisfaction Implicite (${snap.kpi5_satisfaction.score}%, ${snap.kpi5_satisfaction.trend})
  👍 ${snap.kpi5_satisfaction.positiveSignals + snap.kpi5_satisfaction.praiseCount} positifs | 👎 ${snap.kpi5_satisfaction.negativeSignals + snap.kpi5_satisfaction.correctionCount} négatifs
${recentSignals || "  Aucun signal récent"}

### 🎯 Recommandations:
${h.recommendations.map(r => `  → ${r}`).join("\n")}
`;
  }
}

export const ulysseKPIService = new UlysseKPIService();
