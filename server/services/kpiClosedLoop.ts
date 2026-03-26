/**
 * KPI CLOSED-LOOP SERVICE V1
 * 
 * Les KPIs changent réellement le comportement d'Ulysse:
 * - Outil qui échoue souvent → priorité baissée automatiquement
 * - Domaine lent → stratégie ajustée
 * - Satisfaction en baisse → diagnostic déclenché
 * - Corrections fréquentes → règles permanentes créées
 * - Apprentissage ralenti → cycle d'apprentissage accéléré
 */

const LOG_PREFIX = "[KPILoop]";

interface BehaviorAdjustment {
  type: "tool_priority" | "strategy_change" | "diagnostic_trigger" | "learning_boost" | "response_style";
  target: string;
  adjustment: number;
  reason: string;
  appliedAt: number;
  expiresAt: number;
}

interface CorrectionRule {
  id: string;
  pattern: string;
  correction: string;
  domain: string;
  appliedCount: number;
  createdAt: number;
  source: "user_feedback" | "kpi_analysis" | "auto_detection";
}

class KPIClosedLoopService {
  private adjustments: BehaviorAdjustment[] = [];
  private correctionRules: CorrectionRule[] = [];
  private toolPriorityOverrides: Map<string, number> = new Map();
  private lastAnalysis = 0;
  private analysisInterval = 15 * 60 * 1000;

  async analyzeAndAdjust(): Promise<BehaviorAdjustment[]> {
    const now = Date.now();
    if (now - this.lastAnalysis < this.analysisInterval) return [];
    this.lastAnalysis = now;

    const newAdjustments: BehaviorAdjustment[] = [];

    try {
      const { ulysseKPIService } = await import("./ulysseKPIService");
      const snapshot = ulysseKPIService.getSnapshot();

      for (const tool of snapshot.kpi2_toolSuccess.topTools) {
        if (tool.successRate < 0.5 && tool.totalCalls >= 5) {
          const adj: BehaviorAdjustment = {
            type: "tool_priority",
            target: tool.toolName,
            adjustment: -20,
            reason: `Taux de succès bas: ${(tool.successRate * 100).toFixed(0)}% sur ${tool.totalCalls} appels`,
            appliedAt: now,
            expiresAt: now + 3600 * 1000
          };
          newAdjustments.push(adj);
          this.toolPriorityOverrides.set(tool.toolName, -20);
          console.log(`${LOG_PREFIX} Tool priority lowered: ${tool.toolName} (${(tool.successRate * 100).toFixed(0)}% success)`);
        }
        
        if (tool.successRate > 0.95 && tool.totalCalls >= 10) {
          this.toolPriorityOverrides.set(tool.toolName, 10);
        }
      }

      for (const domain of snapshot.kpi1_latency.byDomain) {
        if (domain.trend === "degrading" && domain.avgMs > 3000) {
          const adj: BehaviorAdjustment = {
            type: "strategy_change",
            target: domain.domain,
            adjustment: -1,
            reason: `Latence dégradée: ${domain.avgMs}ms en moyenne (tendance: ${domain.trend})`,
            appliedAt: now,
            expiresAt: now + 7200 * 1000
          };
          newAdjustments.push(adj);
          console.log(`${LOG_PREFIX} Strategy adjustment for ${domain.domain}: latency ${domain.avgMs}ms`);
        }
      }

      if (snapshot.kpi5_satisfaction.trend === "declining" && snapshot.kpi5_satisfaction.negativeSignals > 3) {
        const adj: BehaviorAdjustment = {
          type: "diagnostic_trigger",
          target: "satisfaction",
          adjustment: -1,
          reason: `Satisfaction en baisse: ${snapshot.kpi5_satisfaction.negativeSignals} signaux négatifs, score ${snapshot.kpi5_satisfaction.score}`,
          appliedAt: now,
          expiresAt: now + 3600 * 1000
        };
        newAdjustments.push(adj);
        console.log(`${LOG_PREFIX} Satisfaction declining - diagnostic triggered`);
      }

      if (snapshot.kpi4_learningVelocity.trend === "slowing") {
        const adj: BehaviorAdjustment = {
          type: "learning_boost",
          target: "learning_engine",
          adjustment: 2,
          reason: `Apprentissage ralenti: vitesse ${snapshot.kpi4_learningVelocity.velocityScore}, tendance ${snapshot.kpi4_learningVelocity.trend}`,
          appliedAt: now,
          expiresAt: now + 7200 * 1000
        };
        newAdjustments.push(adj);
        console.log(`${LOG_PREFIX} Learning boost triggered`);
      }

      if (snapshot.kpi3_factualErrors.last24h > 3) {
        const adj: BehaviorAdjustment = {
          type: "response_style",
          target: "verification",
          adjustment: 1,
          reason: `${snapshot.kpi3_factualErrors.last24h} erreurs factuelles en 24h → vérification renforcée`,
          appliedAt: now,
          expiresAt: now + 3600 * 1000
        };
        newAdjustments.push(adj);
        console.log(`${LOG_PREFIX} Verification mode enhanced due to factual errors`);
      }

      this.cleanExpiredAdjustments();
      this.adjustments.push(...newAdjustments);

    } catch (err) {
      console.error(`${LOG_PREFIX} Analysis error:`, err);
    }

    return newAdjustments;
  }

  addCorrectionRule(pattern: string, correction: string, domain: string, source: CorrectionRule["source"] = "auto_detection"): void {
    const existing = this.correctionRules.find(r => r.pattern === pattern && r.domain === domain);
    if (existing) {
      existing.appliedCount++;
      return;
    }

    this.correctionRules.push({
      id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      pattern, correction, domain, source,
      appliedCount: 1,
      createdAt: Date.now()
    });
    console.log(`${LOG_PREFIX} New correction rule: "${pattern}" → "${correction}" (${domain})`);
  }

  getToolPriorityAdjustment(toolName: string): number {
    return this.toolPriorityOverrides.get(toolName) || 0;
  }

  getActiveAdjustments(): BehaviorAdjustment[] {
    const now = Date.now();
    return this.adjustments.filter(a => a.expiresAt > now);
  }

  getCorrectionRules(domain?: string): CorrectionRule[] {
    if (domain) return this.correctionRules.filter(r => r.domain === domain);
    return this.correctionRules;
  }

  generateClosedLoopPrompt(): string {
    const active = this.getActiveAdjustments();
    const rules = this.correctionRules.filter(r => r.appliedCount >= 2);

    if (active.length === 0 && rules.length === 0) return "";

    const parts: string[] = ["\n[AUTO-AJUSTEMENTS COMPORTEMENTAUX]"];

    if (active.length > 0) {
      parts.push("Ajustements actifs:");
      for (const a of active) {
        parts.push(`- ${a.type}: ${a.target} → ${a.reason}`);
      }
    }

    if (rules.length > 0) {
      parts.push("Règles apprises:");
      for (const r of rules.slice(0, 5)) {
        parts.push(`- [${r.domain}] ${r.pattern} → ${r.correction} (appliqué ${r.appliedCount}x)`);
      }
    }

    return parts.join("\n");
  }

  private cleanExpiredAdjustments(): void {
    const now = Date.now();
    this.adjustments = this.adjustments.filter(a => a.expiresAt > now);
  }

  getStats(): { activeAdjustments: number; correctionRules: number; toolOverrides: number } {
    return {
      activeAdjustments: this.getActiveAdjustments().length,
      correctionRules: this.correctionRules.length,
      toolOverrides: this.toolPriorityOverrides.size
    };
  }
}

export const kpiClosedLoopService = new KPIClosedLoopService();
