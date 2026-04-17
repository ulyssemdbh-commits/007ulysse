import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

export type BrainZoneId =
  | "prefrontal"
  | "motor"
  | "sensory"
  | "concept"
  | "feature"
  | "language"
  | "hippocampus"
  | "association";

export interface BrainZone {
  id: BrainZoneId;
  label: string;
  color: string;
  neurons: number;
  totalEvents: number;
  firingHz: number;
  active: boolean;
  detail: string;
}

interface SensoryStats {
  consciousness?: {
    cognitiveLoad?: number;
    currentFocus?: string;
    activePersona?: string;
    isProcessing?: boolean;
    workingMemoryItems?: number;
  };
  brain?: {
    totalInputs?: number;
    totalOutputs?: number;
    totalActions?: number;
    uptime?: number;
  };
  hubs?: {
    hearing?: { totalEvents?: number };
    vision?: { totalEvents?: number };
    action?: { totalEvents?: number };
    output?: { totalEvents?: number };
  };
  totals?: { totalEvents?: number; lastActivity?: number };
}

interface RecentEvents {
  count: number;
  events: Array<{ type: string; timestamp: number; userId?: number; summary?: string; source?: string }>;
}

interface MemoryState {
  total: number;
  filtered: number;
  items: Array<{ type: string; importance?: number }>;
}

interface BridgeStats {
  bridges?: Record<string, { totalEvents?: number }>;
}

const ZONE_DEFS: Record<BrainZoneId, { label: string; color: string }> = {
  prefrontal:    { label: "DÉCISION",     color: "#ff8a3d" }, // BrainHub: focus, charge cognitive
  motor:         { label: "ACTIONS",      color: "#ffb347" }, // ActionHub: outils exécutés
  sensory:       { label: "ÉCOUTE",       color: "#3da9ff" }, // HearingHub + VisionHub
  concept:       { label: "APPRENTISSAGE", color: "#f3d437" }, // cumulativeLearning
  feature:       { label: "PENSÉE",       color: "#ff5c8a" }, // embeddings sémantiques
  language:      { label: "PAROLE",       color: "#ff3b6b" }, // VoiceOutputHub TTS
  hippocampus:   { label: "MÉMOIRE",      color: "#3dff8a" }, // memoryGraph
  association:   { label: "INTUITIONS",   color: "#ff6b3d" }, // bridges cross-hub
};

export interface BrainActivity {
  zones: BrainZone[];
  consciousness: {
    cognitiveLoad: number;
    focus: string;
    persona: string;
    processing: boolean;
    workingMemory: number;
  };
  /** Human-readable French mental state for HUD display. */
  mood: { label: string; color: string; emoji: string };
  totals: {
    inputs: number;
    outputs: number;
    actions: number;
    events: number;
    uptime: number;
  };
  /** Cumulative growth metrics — drives brain size, neuron density, connection count. */
  evolution: {
    /** Total accumulated knowledge: memories + concepts + bridges + outputs. */
    knowledge: number;
    /** Brain scale multiplier 1.0 → 1.6 based on log(knowledge). */
    scale: number;
    /** How many extra cross-zone synapses to render (0..20). */
    extraSynapses: number;
  };
  pulses: BrainZoneId[];
  recentEvents: Array<{ type: string; timestamp: number; summary?: string }>;
  ready: boolean;
}

const POLL_MS = 1000;

// Map BrainHub's current focus state → zones that should appear active.
// This catches sub-second processing windows that delta-detection misses.
const FOCUS_TO_ZONES: Record<string, BrainZoneId[]> = {
  listening: ["sensory"],
  observing: ["sensory"],
  thinking:  ["prefrontal", "feature", "association"],
  speaking:  ["language", "prefrontal"],
  acting:    ["motor", "prefrontal"],
};

export function useBrainActivity(enabled = true): BrainActivity {
  const { data: stats } = useQuery<SensoryStats>({
    queryKey: ["/api/v2/sensory/stats"],
    enabled,
    refetchInterval: enabled ? POLL_MS : false,
    refetchIntervalInBackground: false,
  });

  const { data: recent } = useQuery<RecentEvents>({
    queryKey: ["/api/v2/sensory/recent", 20],
    enabled,
    refetchInterval: enabled ? POLL_MS : false,
    refetchIntervalInBackground: false,
  });

  const { data: memory } = useQuery<MemoryState>({
    queryKey: ["/api/v2/sensory/memory", 50],
    enabled,
    refetchInterval: enabled ? POLL_MS * 2 : false,
  });

  const { data: bridges } = useQuery<BridgeStats>({
    queryKey: ["/api/v2/sensory/bridges"],
    enabled,
    refetchInterval: enabled ? POLL_MS * 2 : false,
  });

  // Track previous totals per zone to compute Hz and detect firing.
  const prevRef = useRef<Record<BrainZoneId, { total: number; ts: number }>>({
    prefrontal:  { total: 0, ts: Date.now() },
    motor:       { total: 0, ts: Date.now() },
    sensory:     { total: 0, ts: Date.now() },
    concept:     { total: 0, ts: Date.now() },
    feature:     { total: 0, ts: Date.now() },
    language:    { total: 0, ts: Date.now() },
    hippocampus: { total: 0, ts: Date.now() },
    association: { total: 0, ts: Date.now() },
  });

  const [pulses, setPulses] = useState<BrainZoneId[]>([]);

  // Derive raw totals from real APIs.
  const rawTotals = useMemo(() => {
    const hearing = stats?.hubs?.hearing?.totalEvents ?? 0;
    const vision = stats?.hubs?.vision?.totalEvents ?? 0;
    const action = stats?.hubs?.action?.totalEvents ?? stats?.brain?.totalActions ?? 0;
    const output = stats?.hubs?.output?.totalEvents ?? stats?.brain?.totalOutputs ?? 0;
    const inputs = stats?.brain?.totalInputs ?? hearing + vision;
    const wm = stats?.consciousness?.workingMemoryItems ?? 0;
    const memTotal = memory?.total ?? wm;
    const bridgeTotal = Object.values(bridges?.bridges ?? {}).reduce(
      (acc, b) => acc + (b?.totalEvents ?? 0),
      0
    );
    // Concept/feature counts proxied by working memory + inputs (real signal that the brain is learning).
    const concept = wm + Math.floor(inputs / 3);
    const feature = Math.floor(memTotal * 1.2);

    return {
      prefrontal:  inputs + (stats?.consciousness?.isProcessing ? 1 : 0),
      motor:       action,
      sensory:     hearing + vision,
      concept,
      feature,
      language:    output,
      hippocampus: memTotal,
      association: bridgeTotal,
    } as Record<BrainZoneId, number>;
  }, [stats, memory, bridges]);

  // Detect deltas → trigger pulses; compute Hz.
  useEffect(() => {
    const now = Date.now();
    const newPulses: BrainZoneId[] = [];
    (Object.keys(rawTotals) as BrainZoneId[]).forEach((id) => {
      const prev = prevRef.current[id];
      const curr = rawTotals[id];
      if (curr > prev.total) {
        newPulses.push(id);
        prevRef.current[id] = { total: curr, ts: now };
      } else if (prev.total === 0) {
        prevRef.current[id] = { total: curr, ts: now };
      }
    });
    if (newPulses.length > 0) {
      setPulses(newPulses);
      const t = setTimeout(() => setPulses([]), 900);
      return () => clearTimeout(t);
    }
  }, [rawTotals]);

  // Detect proactive/autonomous activity from recent events (last 10s).
  const isProactive = useMemo(() => {
    const cutoff = Date.now() - 10_000;
    return (recent?.events ?? []).some(
      (e) => e.timestamp > cutoff && (e.source === "autonomous" || /initiative|proactive/i.test(e.type ?? ""))
    );
  }, [recent]);

  const focus = stats?.consciousness?.currentFocus ?? "idle";
  const isProcessing = !!stats?.consciousness?.isProcessing;
  const cognitiveLoad = stats?.consciousness?.cognitiveLoad ?? 0;

  // Zones forced active by current focus (catches sub-second states).
  const focusActiveZones = new Set<BrainZoneId>(FOCUS_TO_ZONES[focus] ?? []);
  if (isProactive) {
    focusActiveZones.add("prefrontal");
    focusActiveZones.add("association");
    focusActiveZones.add("motor");
  }
  if (isProcessing && focus === "idle") {
    // Edge: processing flag set but focus reverted to idle — still show prefrontal active.
    focusActiveZones.add("prefrontal");
  }

  // Compute French mental state.
  const mood = useMemo(() => {
    if (isProactive)              return { label: "PROACTIF", color: "#f59e0b", emoji: "✨" };
    if (focus === "speaking")     return { label: "PARLE",     color: "#ff3b6b", emoji: "🗣" };
    if (focus === "listening")    return { label: "ÉCOUTE",    color: "#3da9ff", emoji: "👂" };
    if (focus === "observing")    return { label: "OBSERVE",   color: "#7dd3fc", emoji: "👁" };
    if (focus === "acting")       return { label: "EXÉCUTE",   color: "#ffb347", emoji: "⚙" };
    if (focus === "thinking")     return { label: "RÉFLÉCHIT", color: "#a78bfa", emoji: "💭" };
    if (isProcessing)             return { label: "TRAITE",    color: "#a78bfa", emoji: "💭" };
    if (cognitiveLoad > 60)       return { label: "ANALYSE",   color: "#f3d437", emoji: "🔍" };
    if (cognitiveLoad > 20)       return { label: "ACTIF",     color: "#3dff8a", emoji: "●" };
    return { label: "REPOS", color: "#64748b", emoji: "○" };
  }, [focus, isProactive, isProcessing, cognitiveLoad]);

  const zones: BrainZone[] = useMemo(() => {
    const now = Date.now();
    return (Object.keys(ZONE_DEFS) as BrainZoneId[]).map((id) => {
      const def = ZONE_DEFS[id];
      const total = rawTotals[id];
      const prev = prevRef.current[id];
      const dtSec = Math.max(0.5, (now - prev.ts) / 1000);
      // Real Hz: events since last delta / time elapsed. Decays naturally between events.
      const firingHz = prev.total > 0 ? Math.max(0, (total - prev.total) / dtSec) : 0;
      // Neuron count grows with real usage. Min 8, asymptote ~200 — brain DOIT grandir.
      const neurons = Math.min(200, 8 + Math.floor(Math.sqrt(total) * 5));
      const detail =
        id === "prefrontal" ? `focus: ${focus === "idle" ? "repos" : focus}` :
        id === "motor"      ? `${total} actions exécutées` :
        id === "sensory"    ? `${total} messages entendus` :
        id === "concept"    ? `${total} notions apprises` :
        id === "feature"    ? `${total} pensées vectorielles` :
        id === "language"   ? `${total} réponses vocales` :
        id === "hippocampus" ? `${total} souvenirs` :
                              `${total} connexions`;
      return {
        id,
        label: def.label,
        color: def.color,
        neurons,
        totalEvents: total,
        firingHz: Math.round(firingHz * 100) / 100,
        // Active = real delta pulse OR current focus state mandates it.
        active: pulses.includes(id) || focusActiveZones.has(id),
        detail,
      };
    });
  }, [rawTotals, pulses, focus, focusActiveZones]);

  // Evolution: brain grows with cumulative knowledge.
  const knowledge =
    rawTotals.hippocampus +     // souvenirs
    rawTotals.concept +          // notions apprises
    rawTotals.feature +          // pensées vectorielles
    rawTotals.association * 2 +  // bridges/intuitions count double
    rawTotals.language +
    rawTotals.motor;
  // Scale 1.0 → 1.6 logarithmically (no overflow even at 100k events).
  const evolutionScale = Math.min(1.6, 1 + Math.log10(Math.max(1, knowledge + 1)) / 12);
  // Extra synapses: 0 at 0 bridges → 20 at 100+ bridges.
  const extraSynapses = Math.min(20, Math.floor(Math.sqrt(rawTotals.association) * 2));

  return {
    zones,
    evolution: {
      knowledge,
      scale: evolutionScale,
      extraSynapses,
    },
    consciousness: {
      cognitiveLoad,
      focus,
      persona: stats?.consciousness?.activePersona ?? "Ulysse",
      processing: isProcessing,
      workingMemory: stats?.consciousness?.workingMemoryItems ?? 0,
    },
    mood,
    totals: {
      inputs: stats?.brain?.totalInputs ?? 0,
      outputs: stats?.brain?.totalOutputs ?? 0,
      actions: stats?.brain?.totalActions ?? 0,
      events: stats?.totals?.totalEvents ?? 0,
      uptime: stats?.brain?.uptime ?? 0,
    },
    pulses,
    recentEvents: recent?.events?.slice(0, 5) ?? [],
    ready: !!stats,
  };
}
