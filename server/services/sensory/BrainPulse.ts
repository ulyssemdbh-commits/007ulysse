/**
 * BRAIN PULSE - Bus universel d'activité du cerveau d'Ulysse
 *
 * Toute brique du système (jobs, AI router, autres IA, mémoire, learning,
 * Discord, voice, email, etc.) appelle `brainPulse()` pour signaler son activité.
 * Le 3D Brain Visualizer reflète alors l'activité en temps réel — même quand
 * le owner est offline ou qu'Ulysse travaille en autonomie.
 *
 * Zones (mappées au visualiseur 3D):
 *   - prefrontal  → DÉCISION    (LLM calls, planning, focus, scheduler)
 *   - motor       → ACTIONS     (tool exec, jobs running, side-effects)
 *   - sensory     → ÉCOUTE      (input received: chat/voice/discord/email/siri/screen)
 *   - language    → PAROLE      (TTS, replies, notifications sent)
 *   - hippocampus → MÉMOIRE     (memory writes, recall, consolidation)
 *   - concept     → APPRENTISSAGE (learning cycles, knowledge sync, topics extracted)
 *   - feature     → PENSÉE      (embeddings, vector search, semantic ops)
 *   - association → INTUITIONS  (cross-AI, cross-domain bridges, proactive insights)
 */

import { EventEmitter } from "events";
import { sensorySystem } from "./index";
import { brainHub } from "./BrainHub";

export type BrainPulseZone =
  | "prefrontal"
  | "motor"
  | "sensory"
  | "language"
  | "hippocampus"
  | "concept"
  | "feature"
  | "association";

export interface BrainPulseEvent {
  zone: BrainPulseZone;
  source: string;
  summary: string;
  userId?: number;
  timestamp: number;
  /** When true, this pulse is from autonomous/background work (no human prompt). */
  autonomous?: boolean;
  /** Optional intensity 1-5, scales the visual pulse strength. */
  intensity?: number;
}

class BrainPulseBus extends EventEmitter {
  private readonly counters: Record<BrainPulseZone, number> = {
    prefrontal: 0,
    motor: 0,
    sensory: 0,
    language: 0,
    hippocampus: 0,
    concept: 0,
    feature: 0,
    association: 0,
  };

  private readonly events: BrainPulseEvent[] = [];
  private readonly maxEvents = 200;
  private lastPulseAt = Date.now();

  /** Throttle map: source → last emit timestamp. Avoids log spam. */
  private throttle = new Map<string, number>();
  private readonly defaultThrottleMs = 250;

  pulse(
    zone: BrainPulseZone,
    source: string,
    summary: string,
    options: { userId?: number; autonomous?: boolean; intensity?: number; throttleMs?: number } = {}
  ): void {
    const now = Date.now();
    const throttleMs = options.throttleMs ?? this.defaultThrottleMs;
    const throttleKey = `${zone}:${source}`;
    const lastAt = this.throttle.get(throttleKey) ?? 0;
    if (now - lastAt < throttleMs) return;
    this.throttle.set(throttleKey, now);

    this.counters[zone] += 1;
    this.lastPulseAt = now;

    const evt: BrainPulseEvent = {
      zone,
      source,
      summary: summary.length > 140 ? summary.slice(0, 137) + "…" : summary,
      userId: options.userId,
      timestamp: now,
      autonomous: options.autonomous ?? false,
      intensity: options.intensity ?? 1,
    };
    this.events.push(evt);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }

    // Mirror into sensorySystem so /api/v2/sensory/recent picks it up natively.
    try {
      sensorySystem.recordPulse?.(evt);
    } catch {
      /* sensorySystem.recordPulse may not exist yet during startup */
    }

    // Real-time push: SSE subscribers.
    try { this.emit("pulse", evt); } catch { /* best-effort */ }
  }

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  getCounters(): Readonly<Record<BrainPulseZone, number>> {
    return this.counters;
  }

  getRecent(limit = 50): BrainPulseEvent[] {
    return this.events.slice(-limit);
  }

  getLastPulseAt(): number {
    return this.lastPulseAt;
  }
}

export const brainPulseBus = new BrainPulseBus();

/**
 * Public helper: any service can pulse one or more zones in a single call.
 *
 * @example
 *   brainPulse("prefrontal", "aiRouter", "openai gpt-4o-mini chat completion");
 *   brainPulse(["motor","prefrontal"], "scheduler", "Ulysse Knowledge Sync", { autonomous: true });
 */
export function brainPulse(
  zones: BrainPulseZone | BrainPulseZone[],
  source: string,
  summary: string,
  options: { userId?: number; autonomous?: boolean; intensity?: number; throttleMs?: number } = {}
): void {
  const list = Array.isArray(zones) ? zones : [zones];
  for (const z of list) brainPulseBus.pulse(z, source, summary, options);
}

/** Force a transient brainHub focus state (for the visualizer mood badge). */
export function brainFocus(focus: "thinking" | "acting" | "listening" | "speaking" | "observing"): void {
  try {
    const fn = (brainHub as any).setTransientFocus;
    if (typeof fn === "function") fn.call(brainHub, focus);
  } catch {
    /* best-effort */
  }
}
