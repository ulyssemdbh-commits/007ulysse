/**
 * META-LEARNING SERVICE
 *
 * Closes the loop between observability (CoreEvolutionService, EnhancedSelfCritique,
 * MemoryGraphService stats) and tunable system parameters.
 *
 * Periodically reads system metrics and adjusts:
 *  - memoryGraphService.embeddingThreshold      (semantic link sensitivity)
 *  - memoryGraphService.hebbianLearningRate     (reinforcement strength)
 *  - enhancedSelfCritiqueService.minConfidence  (per domain, paranoia level)
 *  - DGM_GOVERNANCE.riskGatingThreshold         (auto-deploy risk tolerance)
 *
 * All adjustments are bounded, gradual, and persisted (ulysse_memory category=meta_param).
 */

import { db } from "../db";
import { ulysseMemory } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { memoryGraphService } from "./memoryGraphService";
import { enhancedSelfCritiqueService } from "./enhancedSelfCritique";

const LOG = "[MetaLearning]";
const META_USER_ID = 0; // System-owned params
const TICK_INTERVAL_MS = 60 * 60 * 1000; // 1h
const FIRST_TICK_DELAY_MS = 5 * 60 * 1000; // 5 min after boot

interface ParamSpec {
  key: string;
  min: number;
  max: number;
  step: number;       // max delta per tick
  defaultValue: number;
  description: string;
}

const PARAM_REGISTRY: Record<string, ParamSpec> = {
  embeddingThreshold: {
    key: "embeddingThreshold", min: 0.55, max: 0.9, step: 0.02,
    defaultValue: 0.72, description: "Min cosine sim to create semantic memory link"
  },
  hebbianLearningRate: {
    key: "hebbianLearningRate", min: 0.02, max: 0.2, step: 0.01,
    defaultValue: 0.08, description: "Reinforcement step size"
  },
  dgmRiskGatingThreshold: {
    key: "dgmRiskGatingThreshold", min: 60, max: 95, step: 2,
    defaultValue: 85, description: "DGM auto-deploy risk gate"
  },
  // Critique thresholds (per domain) handled separately
};

interface AdjustmentLog {
  ts: number;
  param: string;
  from: number;
  to: number;
  reason: string;
}

class MetaLearningService {
  private params: Record<string, number> = {};
  private adjustments: AdjustmentLog[] = [];
  private timer: NodeJS.Timeout | null = null;
  private lastTickAt = 0;
  private tickInProgress = false;
  private stopped = false;

  async init(): Promise<void> {
    await this.loadPersistedParams();
    this.applyAllParams();
    this.stopped = false;
    this.scheduleNextTick(FIRST_TICK_DELAY_MS);
    console.log(`${LOG} Initialized. Params:`, this.params);
  }

  private scheduleNextTick(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      if (this.stopped) return;
      if (this.tickInProgress) {
        // Prior tick still running; reschedule
        this.scheduleNextTick(TICK_INTERVAL_MS);
        return;
      }
      this.tickInProgress = true;
      try {
        await this.tick();
      } catch (err) {
        console.error(`${LOG} tick error:`, err);
      } finally {
        this.tickInProgress = false;
        if (!this.stopped) this.scheduleNextTick(TICK_INTERVAL_MS);
      }
    }, delayMs);
  }

  shutdown(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async loadPersistedParams(): Promise<void> {
    try {
      const rows = await db.select().from(ulysseMemory)
        .where(and(eq(ulysseMemory.userId, META_USER_ID), eq(ulysseMemory.category, "meta_param")));
      for (const r of rows) {
        const v = parseFloat(r.value);
        if (!Number.isNaN(v)) this.params[r.key] = v;
      }
    } catch (e) {
      console.warn(`${LOG} loadPersistedParams failed (table may not exist yet):`, (e as any)?.message);
    }
    // Defaults for missing
    for (const spec of Object.values(PARAM_REGISTRY)) {
      if (this.params[spec.key] === undefined) this.params[spec.key] = spec.defaultValue;
    }
  }

  private async persistParam(key: string, value: number, reason: string): Promise<void> {
    try {
      const existing = await db.select().from(ulysseMemory)
        .where(and(
          eq(ulysseMemory.userId, META_USER_ID),
          eq(ulysseMemory.category, "meta_param"),
          eq(ulysseMemory.key, key)
        ));
      if (existing.length > 0) {
        await db.update(ulysseMemory)
          .set({ value: String(value), source: reason, updatedAt: new Date() })
          .where(eq(ulysseMemory.id, existing[0].id));
      } else {
        await db.insert(ulysseMemory).values({
          userId: META_USER_ID,
          category: "meta_param",
          key,
          value: String(value),
          confidence: 80,
          source: reason,
        });
      }
    } catch (e) {
      console.warn(`${LOG} persistParam(${key}) failed:`, (e as any)?.message);
    }
  }

  private applyAllParams(): void {
    if (this.params.embeddingThreshold !== undefined) {
      memoryGraphService.setEmbeddingThreshold(this.params.embeddingThreshold);
    }
    if (this.params.hebbianLearningRate !== undefined) {
      memoryGraphService.setHebbianLearningRate(this.params.hebbianLearningRate);
    }
    if (this.params.dgmRiskGatingThreshold !== undefined) {
      this.applyDgmRiskGate(this.params.dgmRiskGatingThreshold);
    }
    // Apply persisted critique thresholds
    for (const k of Object.keys(this.params)) {
      const m = k.match(/^critique_minConfidence_(.+)$/);
      if (m) enhancedSelfCritiqueService.setMinConfidence(m[1], this.params[k]);
    }
  }

  private applyDgmRiskGate(value: number): void {
    try {
      // Lazy require to avoid circular deps
      const dgm = require("./dgmPipelineOrchestrator");
      if (dgm?.DGM_GOVERNANCE) {
        dgm.DGM_GOVERNANCE.riskGatingThreshold = Math.round(value);
      }
    } catch (e) {
      // module may not be loaded; skip silently
    }
  }

  private async setParam(key: string, newValue: number, reason: string): Promise<void> {
    const spec = PARAM_REGISTRY[key];
    let bounded: number;
    if (spec) {
      bounded = Math.max(spec.min, Math.min(spec.max, newValue));
    } else {
      bounded = newValue; // critique thresholds handled by setter clamping
    }
    const old = this.params[key];
    if (old !== undefined && Math.abs(bounded - old) < 1e-4) return;

    this.params[key] = bounded;
    this.adjustments.push({ ts: Date.now(), param: key, from: old ?? NaN, to: bounded, reason });
    if (this.adjustments.length > 200) this.adjustments = this.adjustments.slice(-200);

    console.log(`${LOG} ${key}: ${old?.toFixed?.(3) ?? "?"} → ${bounded.toFixed(3)} (${reason})`);
    await this.persistParam(key, bounded, reason);
    this.applyAllParams();
  }

  /**
   * One observation/decision cycle.
   */
  async tick(): Promise<void> {
    this.lastTickAt = Date.now();

    try {
      const { brainPulse } = await import("./sensory/BrainPulse");
      brainPulse(["concept", "association"], "metaLearning", "ajuste ses paramètres", { autonomous: true, intensity: 2 });
    } catch { /* best-effort */ }

    // ---- Critique: per-domain miniConfidence adjustment ----
    const critiqueStats = enhancedSelfCritiqueService.getStats();
    for (const [domain, dStats] of Object.entries(critiqueStats.byDomain)) {
      const total = dStats.pass + dStats.fail;
      if (total < 10) continue; // need signal
      const passRate = dStats.pass / total;
      const current = enhancedSelfCritiqueService.getMinConfidence(domain);
      if (current == null) continue;
      const paramKey = `critique_minConfidence_${domain}`;

      if (passRate < 0.4) {
        // Too many fails → tighten (raise threshold) so we add disclaimers more often
        const next = Math.min(95, current + 3);
        if (next !== current) await this.setParam(paramKey, next, `passRate ${(passRate*100).toFixed(0)}% < 40%`);
      } else if (passRate > 0.95 && total > 30) {
        // Almost always passes → relax slightly to reduce paranoia
        const next = Math.max(40, current - 2);
        if (next !== current) await this.setParam(paramKey, next, `passRate ${(passRate*100).toFixed(0)}% > 95%`);
      }
    }

    // ---- Memory graph reinforcement health ----
    const reinforce = memoryGraphService.getReinforcementStats();
    if (reinforce.totalSignals >= 20) {
      const negRate = reinforce.negativeSignals / reinforce.totalSignals;
      const lr = this.params.hebbianLearningRate ?? 0.08;
      if (negRate > 0.4) {
        // Too many bad contexts → learn faster (more aggressive correction)
        const next = lr + 0.01;
        if (next !== lr) await this.setParam("hebbianLearningRate", next, `negRate ${(negRate*100).toFixed(0)}% > 40%`);
      } else if (negRate < 0.1 && reinforce.totalSignals > 50) {
        // System is well-tuned → slow down learning to stabilize
        const next = lr - 0.005;
        if (next !== lr) await this.setParam("hebbianLearningRate", next, `negRate ${(negRate*100).toFixed(0)}% < 10%`);
      }

      // Embedding threshold: if positive signals dominate, sharpen threshold (more selective)
      const posRate = reinforce.positiveSignals / reinforce.totalSignals;
      const thr = this.params.embeddingThreshold ?? 0.72;
      if (posRate > 0.7) {
        const next = Math.min(PARAM_REGISTRY.embeddingThreshold.max, thr + 0.01);
        if (next !== thr) await this.setParam("embeddingThreshold", next, `posRate ${(posRate*100).toFixed(0)}% > 70% → sharpen`);
      } else if (posRate < 0.3) {
        // Often wrong → loosen threshold (cast wider net for relevant memories)
        const next = Math.max(PARAM_REGISTRY.embeddingThreshold.min, thr - 0.01);
        if (next !== thr) await this.setParam("embeddingThreshold", next, `posRate ${(posRate*100).toFixed(0)}% < 30% → loosen`);
      }
    }

    // ---- DGM risk gating: derive proxy trend from critique passRate stability ----
    // (coreEvolutionService is internal to UlysseCoreEngine; we use critique health as proxy)
    if (critiqueStats.totalEvaluations > 30) {
      const overallPass = critiqueStats.passRate;
      const gate = this.params.dgmRiskGatingThreshold ?? 85;
      if (overallPass > 0.85) {
        // Healthy → can take more deploy risk
        const next = Math.max(PARAM_REGISTRY.dgmRiskGatingThreshold.min, gate - 1);
        if (next !== gate) await this.setParam("dgmRiskGatingThreshold", next, `passRate ${(overallPass*100).toFixed(0)}% healthy`);
      } else if (overallPass < 0.6) {
        // System struggling → tighten deploy gate
        const next = Math.min(PARAM_REGISTRY.dgmRiskGatingThreshold.max, gate + 2);
        if (next !== gate) await this.setParam("dgmRiskGatingThreshold", next, `passRate ${(overallPass*100).toFixed(0)}% < 60% → tighten`);
      }
    }
  }

  getState(): {
    params: Record<string, number>;
    recentAdjustments: AdjustmentLog[];
    lastTickAt: number;
    critiqueThresholds: Record<string, number>;
  } {
    return {
      params: { ...this.params },
      recentAdjustments: this.adjustments.slice(-30),
      lastTickAt: this.lastTickAt,
      critiqueThresholds: enhancedSelfCritiqueService.getAllThresholds(),
    };
  }

  /** Manual trigger for ops/admin endpoint */
  async triggerNow(): Promise<void> {
    await this.tick();
  }
}

export const metaLearningService = new MetaLearningService();
