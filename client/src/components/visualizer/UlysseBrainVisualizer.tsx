import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, OrbitControls, Line } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";
import { useBrainActivity, type BrainZone, type BrainZoneId } from "@/hooks/useBrainActivity";

/* =====================================================================
 * ULYSSE BRAIN — Real-only monitoring hybrid (Cockpit + Anatomical 3D)
 *
 * EVERY visible element is driven by REAL backend data:
 *  - Hot-spot size & glow = log(real totalEvents) of that hub
 *  - Hot-spot pulse       = real `pulses[]` delta from /api/v2/sensory/stream
 *  - Travelling sparks    = only on connections whose endpoint just fired
 *  - Sparklines           = client-side 30s timeseries built from polls
 *  - Cockpit metrics      = direct read of /api/v2/sensory/* endpoints
 *
 * NO fake decoration: no random stars, no fake neurons, no breathing
 * placeholder pulse, no decorative orb, no synthesized "ambient" activity.
 * The anatomical wireframe is the only inert element, and it serves as
 * a spatial reference (like the grid of an instrument), not as data.
 * ===================================================================== */

// =====================================================================
// 5-Hub mapping (real Ulysse architecture)
// =====================================================================
type HubId = "brain" | "hearing" | "vision" | "voice" | "action" | "memory";

interface HubDef {
  id: HubId;
  label: string;
  shortLabel: string;
  position: [number, number, number]; // anatomical surface position
  feeds: BrainZoneId[];
  /** Heuristic to attribute a recent event to this hub by its type/source. */
  matchEvent: (e: { type?: string; source?: string }) => boolean;
}

const HUBS: HubDef[] = [
  {
    id: "brain",
    label: "BRAIN-HUB",
    shortLabel: "BRAIN",
    position: [0, 0.1, 0], // inside the limbic core (deep center)
    feeds: ["prefrontal", "association", "concept", "feature"],
    matchEvent: (e) =>
      /focus|memory|thought|context|bridge|concept|persona|consciousness/i.test(
        `${e.type ?? ""} ${e.source ?? ""}`
      ),
  },
  {
    id: "hearing",
    label: "HEARING-HUB",
    shortLabel: "HEAR",
    position: [-1.5, 0, 0.3], // left side (lateral, auditory cortex)
    feeds: ["sensory"],
    matchEvent: (e) =>
      /input|hear|listen|message|user|stt|transcript|whisper/i.test(
        `${e.type ?? ""} ${e.source ?? ""}`
      ),
  },
  {
    id: "vision",
    label: "VISION-HUB",
    shortLabel: "SEE",
    position: [0, 0.8, 1.5], // top-front (visual association)
    feeds: ["feature"],
    matchEvent: (e) =>
      /vision|ocr|image|screen|see|visual/i.test(
        `${e.type ?? ""} ${e.source ?? ""}`
      ),
  },
  {
    id: "voice",
    label: "VOICE-OUTPUT",
    shortLabel: "VOICE",
    position: [0, -0.5, 1.5], // front, below SEE (speech output)
    feeds: ["language"],
    matchEvent: (e) =>
      /output|speech|voice|tts|speak|piper/i.test(
        `${e.type ?? ""} ${e.source ?? ""}`
      ),
  },
  {
    id: "action",
    label: "ACTION-HUB",
    shortLabel: "ACT",
    position: [0, 1.0, 0.2], // inside motor cortex strip (top, central sulcus)
    feeds: ["motor"],
    matchEvent: (e) =>
      /action|tool|exec|motor|command|mcp/i.test(
        `${e.type ?? ""} ${e.source ?? ""}`
      ),
  },
  {
    id: "memory",
    label: "MEMORY-DB",
    shortLabel: "MEM",
    position: [0, 0, -1.8], // rear back (deep memory storage)
    feeds: ["hippocampus"],
    matchEvent: (e) =>
      /db|query|insert|select|update|delete|memory|recall|storage|drizzle|postgres/i.test(
        `${e.type ?? ""} ${e.source ?? ""}`
      ),
  },
];

const HUB_LINKS: Array<[HubId, HubId]> = [
  ["hearing", "brain"],
  ["vision", "brain"],
  ["brain", "voice"],
  ["brain", "action"],
  ["hearing", "voice"],
  ["vision", "action"],
  ["brain", "memory"],   // BRAIN ↔ MEMORY (read/write)
  ["memory", "voice"],   // recall → speech
  ["memory", "action"],  // recall → tool
];

// =====================================================================
// Aggregate raw zones into per-hub real metrics
// =====================================================================
interface HubMetric {
  hub: HubDef;
  totalEvents: number;
  firingHz: number;
  active: boolean;
}

function buildHubMetric(hub: HubDef, zones: BrainZone[]): HubMetric {
  const fed = zones.filter((z) => hub.feeds.includes(z.id));
  return {
    hub,
    totalEvents: fed.reduce((s, z) => s + z.totalEvents, 0),
    firingHz: fed.reduce((s, z) => s + z.firingHz, 0),
    active: fed.some((z) => z.active),
  };
}

// =====================================================================
// Procedural anatomical brain silhouette — visual reference (no data)
// =====================================================================
function BrainAnatomy() {
  const wireMat = (opacity = 0.22) => (
    <meshBasicMaterial
      color="#3da9ff"
      wireframe
      transparent
      opacity={opacity}
      depthWrite={false}
    />
  );
  const glowMat = (
    <meshBasicMaterial
      color="#1e40af"
      transparent
      opacity={0.05}
      blending={THREE.AdditiveBlending}
      depthWrite={false}
      side={THREE.BackSide}
    />
  );

  // Smooth hemisphere (no lobe bumps — hub homes are dedicated meshes below)
  const Hemisphere = ({ side }: { side: "L" | "R" }) => {
    const x = side === "L" ? -0.55 : 0.55;
    return (
      <group position={[x, 0.1, 0]}>
        <mesh scale={[1.6, 1.7, 2.4]}>
          <icosahedronGeometry args={[1, 4]} />
          {wireMat(0.22)}
        </mesh>
        <mesh scale={[1.55, 1.65, 2.35]}>
          <sphereGeometry args={[1, 24, 24]} />
          {glowMat}
        </mesh>
      </group>
    );
  };

  return (
    <group>
      <Hemisphere side="L" />
      <Hemisphere side="R" />

      {/* === HUB HOMES — one blue sphere per hub, exact positions === */}
      {/* BRAIN — limbic core (deep center) */}
      <mesh position={[0, 0.1, 0]} scale={[0.55, 0.5, 0.65]}>
        <icosahedronGeometry args={[1, 3]} />
        {wireMat(0.26)}
      </mesh>
      {/* ACT — motor cortex strip (top) */}
      <mesh position={[0, 1.0, 0.2]} scale={[1.3, 0.32, 0.55]}>
        <icosahedronGeometry args={[1, 3]} />
        {wireMat(0.22)}
      </mesh>
      {/* SEE — top-front (frontal-superior) */}
      <mesh position={[0, 0.8, 1.5]} scale={[0.7, 0.55, 0.55]}>
        <icosahedronGeometry args={[1, 3]} />
        {wireMat(0.22)}
      </mesh>
      {/* HEAR — left ear (lateral L) */}
      <mesh position={[-1.5, 0, 0.3]} scale={[0.45, 0.7, 0.85]}>
        <icosahedronGeometry args={[1, 3]} />
        {wireMat(0.22)}
      </mesh>
      {/* HEAR — right ear (lateral R, mirror — like real ears) */}
      <mesh position={[1.5, 0, 0.3]} scale={[0.45, 0.7, 0.85]}>
        <icosahedronGeometry args={[1, 3]} />
        {wireMat(0.22)}
      </mesh>
      {/* VOICE — front-bottom (below SEE) */}
      <mesh position={[0, -0.5, 1.5]} scale={[0.6, 0.5, 0.5]}>
        <icosahedronGeometry args={[1, 3]} />
        {wireMat(0.22)}
      </mesh>
      {/* MEM — rear back (occipital, deep memory representation) */}
      <mesh position={[0, 0, -1.8]} scale={[0.7, 0.65, 0.55]}>
        <icosahedronGeometry args={[1, 3]} />
        {wireMat(0.24)}
      </mesh>

    </group>
  );
}

// =====================================================================
// Hot-spot — a hub at the cortical surface. 100% data-driven.
// =====================================================================
function HubHotspot({
  metric,
  pulseTrigger,
  hovered,
  onSelect,
  onHover,
  positionOverride,
}: {
  metric: HubMetric;
  pulseTrigger: number; // increments on every real event for this hub
  hovered: boolean;
  onSelect: (id: HubId) => void;
  onHover: (id: HubId | null) => void;
  positionOverride?: [number, number, number];
}) {
  const lightRef = useRef<THREE.PointLight>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const pulseEnergyRef = useRef(0);
  const lastTriggerRef = useRef(pulseTrigger);

  // Real, non-fake size: log of total events (idle ones stay small).
  const baseRadius = 0.06 + Math.min(0.18, Math.log10(metric.totalEvents + 1) * 0.05);

  useEffect(() => {
    if (pulseTrigger !== lastTriggerRef.current) {
      lastTriggerRef.current = pulseTrigger;
      pulseEnergyRef.current = 1;
    }
  }, [pulseTrigger]);

  useFrame((_, delta) => {
    pulseEnergyRef.current = Math.max(0, pulseEnergyRef.current - delta * 0.9);
    const e = pulseEnergyRef.current;
    // Static intensity floor proportional to real cumulative events.
    const floor = Math.min(1.2, Math.log10(metric.totalEvents + 1) * 0.4);
    const intensity = floor + e * 2.2 + (hovered ? 0.4 : 0);
    if (lightRef.current) lightRef.current.intensity = intensity;
    if (coreRef.current) coreRef.current.scale.setScalar(1 + e * 0.7);
    if (haloRef.current) {
      haloRef.current.scale.setScalar(1 + e * 1.5);
      const m = haloRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = 0.10 + floor * 0.08 + e * 0.45;
    }
  });

  const color = metric.active || hovered ? "#ffd966" : "#ff5544";

  return (
    <group
      position={positionOverride ?? metric.hub.position}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(metric.hub.id);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        onHover(null);
        document.body.style.cursor = "default";
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(metric.hub.id);
      }}
    >
      <pointLight
        ref={lightRef}
        color={color}
        intensity={0.5}
        distance={3}
        decay={2}
      />
      <mesh ref={haloRef}>
        <sphereGeometry args={[baseRadius * 2.4, 16, 16]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.18}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <mesh ref={coreRef}>
        <sphereGeometry args={[baseRadius, 16, 16]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.95}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <Html
        center
        position={[0, baseRadius * 2.2 + 0.18, 0]}
        zIndexRange={[10, 0]}
        style={{ pointerEvents: "none" }}
      >
        <div
          className="font-mono whitespace-nowrap select-none px-1 py-px rounded-[2px] border"
          style={{
            fontSize: "8px",
            lineHeight: "10px",
            color: "#ffd966",
            borderColor: color,
            background: "rgba(2, 8, 23, 0.78)",
            opacity: hovered ? 1 : 0.85,
            letterSpacing: "0.1em",
            fontWeight: 700,
          }}
          data-testid={`brain-hub-${metric.hub.id}`}
        >
          {metric.hub.shortLabel}
        </div>
      </Html>
    </group>
  );
}

// =====================================================================
// Connection line + traveling pulse (only travels on real activity)
// =====================================================================
function HubConnection({
  from,
  to,
  pulseTrigger,
}: {
  from: [number, number, number];
  to: [number, number, number];
  pulseTrigger: number; // increments when either endpoint fires
}) {
  const sparkRef = useRef<THREE.Mesh>(null);
  const tRef = useRef(0);
  const activeRef = useRef(false);
  const lastTriggerRef = useRef(pulseTrigger);

  const points = useMemo(() => {
    const mid: [number, number, number] = [
      (from[0] + to[0]) / 2 + (from[1] - to[1]) * 0.06,
      (from[1] + to[1]) / 2 + 0.2,
      (from[2] + to[2]) / 2 + (from[0] - to[0]) * 0.06,
    ];
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(...from),
      new THREE.Vector3(...mid),
      new THREE.Vector3(...to),
    ]);
    return curve.getPoints(28);
  }, [from, to]);

  const linePoints = useMemo(
    () => points.map((v) => [v.x, v.y, v.z] as [number, number, number]),
    [points]
  );

  useEffect(() => {
    if (pulseTrigger !== lastTriggerRef.current) {
      lastTriggerRef.current = pulseTrigger;
      activeRef.current = true;
      tRef.current = 0;
    }
  }, [pulseTrigger]);

  useFrame((_, delta) => {
    if (!activeRef.current || !sparkRef.current) {
      if (sparkRef.current) sparkRef.current.visible = false;
      return;
    }
    tRef.current += delta * 1.4;
    if (tRef.current >= 1) {
      activeRef.current = false;
      sparkRef.current.visible = false;
      return;
    }
    sparkRef.current.visible = true;
    const idx = Math.min(points.length - 1, Math.floor(tRef.current * points.length));
    const p = points[idx];
    sparkRef.current.position.set(p.x, p.y, p.z);
  });

  return (
    <>
      <Line
        points={linePoints}
        color="#3da9ff"
        lineWidth={1}
        transparent
        opacity={0.18}
      />
      <mesh ref={sparkRef} visible={false}>
        <sphereGeometry args={[0.06, 10, 10]} />
        <meshBasicMaterial
          color="#ffd966"
          transparent
          opacity={1}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </>
  );
}

// =====================================================================
// 3D scene
// =====================================================================
function BrainScene({
  hubMetrics,
  hubPulseTriggers,
  hovered,
  onSelect,
  onHover,
}: {
  hubMetrics: HubMetric[];
  hubPulseTriggers: Record<HubId, number>;
  hovered: HubId | null;
  onSelect: (id: HubId) => void;
  onHover: (id: HubId | null) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += delta * 0.04;
  });

  const hubPosById = useMemo(() => {
    const m: Record<HubId, [number, number, number]> = {} as any;
    HUBS.forEach((h) => {
      m[h.id] = h.position;
    });
    return m;
  }, []);

  return (
    <>
      <ambientLight intensity={0.25} />
      <hemisphereLight args={["#67e8f9", "#0a0e1f", 0.3]} />
      <group ref={groupRef}>
        <BrainAnatomy />
        {HUB_LINKS.map(([a, b], i) => (
          <HubConnection
            key={i}
            from={hubPosById[a]}
            to={hubPosById[b]}
            pulseTrigger={hubPulseTriggers[a] + hubPulseTriggers[b]}
          />
        ))}
        {hubMetrics.map((metric) => (
          <HubHotspot
            key={metric.hub.id}
            metric={metric}
            pulseTrigger={hubPulseTriggers[metric.hub.id]}
            hovered={hovered === metric.hub.id}
            onSelect={onSelect}
            onHover={onHover}
          />
        ))}
        {/* HEAR mirror on the right (real ears = left + right) */}
        {(() => {
          const m = hubMetrics.find((x) => x.hub.id === "hearing");
          if (!m) return null;
          return (
            <HubHotspot
              key="hearing-mirror"
              metric={m}
              pulseTrigger={hubPulseTriggers.hearing}
              hovered={hovered === "hearing"}
              onSelect={onSelect}
              onHover={onHover}
              positionOverride={[1.5, 0, 0.3]}
            />
          );
        })()}
      </group>
    </>
  );
}

// =====================================================================
// Sparkline — client-side 30s rolling timeseries from real polls
// =====================================================================
function Sparkline({
  series,
  color = "#ff5544",
  height = 28,
  width = 88,
}: {
  series: number[];
  color?: string;
  height?: number;
  width?: number;
}) {
  if (series.length < 2) {
    return (
      <div
        style={{ width, height }}
        className="border border-slate-800 bg-slate-950/40"
      />
    );
  }
  const max = Math.max(1, ...series);
  const path = series
    .map((v, i) => {
      const x = (i / (series.length - 1)) * width;
      const y = height - (v / max) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const lastX = width;
  const lastY = height - (series[series.length - 1] / max) * height;
  return (
    <svg
      width={width}
      height={height}
      className="border border-slate-800 bg-slate-950/40"
    >
      <path d={path} stroke={color} strokeWidth={1} fill="none" />
      <circle cx={lastX - 1} cy={lastY} r={1.5} fill={color} />
    </svg>
  );
}

// =====================================================================
// Cockpit — per-hub real metric card
// =====================================================================
function HubCard({
  metric,
  series,
  recentEvents,
  hovered,
  onHover,
}: {
  metric: HubMetric;
  series: number[]; // events/sec last 30s
  recentEvents: Array<{ type?: string; timestamp: number; summary?: string }>;
  hovered: boolean;
  onHover: (id: HubId | null) => void;
}) {
  const color = metric.active ? "#ffd966" : "#ff5544";
  const lastEvent = recentEvents[0];
  const ago = lastEvent
    ? Math.max(0, Math.floor((Date.now() - lastEvent.timestamp) / 1000))
    : null;

  return (
    <div
      onMouseEnter={() => onHover(metric.hub.id)}
      onMouseLeave={() => onHover(null)}
      className="rounded border bg-slate-950/60 p-2 transition-colors"
      style={{
        borderColor: hovered ? color : "rgba(30,58,138,0.5)",
        boxShadow: metric.active ? `0 0 12px ${color}33` : "none",
      }}
      data-testid={`hub-card-${metric.hub.id}`}
    >
      <div className="flex items-center justify-between mb-1">
        <div
          className="font-mono text-[9px] tracking-wider font-bold"
          style={{ color }}
        >
          {metric.hub.label}
        </div>
        <div
          className="w-1.5 h-1.5 rounded-full"
          style={{
            background: metric.active ? "#22c55e" : "#475569",
            boxShadow: metric.active ? "0 0 6px #22c55e" : "none",
          }}
          title={metric.active ? "actif" : "repos"}
        />
      </div>
      <div className="flex items-baseline justify-between mb-1">
        <div
          className="font-mono text-lg font-bold leading-none"
          style={{ color: "#e2e8f0" }}
          data-testid={`hub-total-${metric.hub.id}`}
        >
          {metric.totalEvents.toLocaleString("fr-FR")}
        </div>
        <div className="font-mono text-[9px] text-slate-400">
          {metric.firingHz.toFixed(1)} Hz
        </div>
      </div>
      <Sparkline series={series} color={color} />
      <div className="mt-1 font-mono text-[8px] text-slate-500">
        {lastEvent
          ? `dernier: ${ago}s · ${(lastEvent.type ?? "event").substring(0, 14)}`
          : "aucun event récent"}
      </div>
      {recentEvents.slice(0, 2).map((e, i) => (
        <div
          key={i}
          className="mt-0.5 truncate font-mono text-[8px] text-slate-400"
          title={e.summary ?? e.type}
        >
          · {(e.summary ?? e.type ?? "").substring(0, 28)}
        </div>
      ))}
    </div>
  );
}

// =====================================================================
// Per-hub timeseries tracker (events/sec over last 30s)
// =====================================================================
const SERIES_LEN = 30;

function useHubSeries(hubMetrics: HubMetric[]): Record<HubId, number[]> {
  const [series, setSeries] = useState<Record<HubId, number[]>>(() => {
    const s: Record<HubId, number[]> = {} as any;
    HUBS.forEach((h) => (s[h.id] = []));
    return s;
  });
  const lastTotalsRef = useRef<Record<HubId, number>>({} as any);
  const lastTickRef = useRef<number>(Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const dt = Math.max(0.5, (now - lastTickRef.current) / 1000);
      lastTickRef.current = now;
      setSeries((prev) => {
        const next: Record<HubId, number[]> = { ...prev } as any;
        hubMetrics.forEach((m) => {
          const last = lastTotalsRef.current[m.hub.id] ?? m.totalEvents;
          const delta = Math.max(0, m.totalEvents - last) / dt;
          lastTotalsRef.current[m.hub.id] = m.totalEvents;
          const arr = (prev[m.hub.id] ?? []).concat(delta);
          next[m.hub.id] = arr.slice(-SERIES_LEN);
        });
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [hubMetrics]);

  return series;
}

// =====================================================================
// Per-hub pulse trigger counter (increments on every real delta event)
// =====================================================================
function useHubPulseTriggers(hubMetrics: HubMetric[]): Record<HubId, number> {
  const [triggers, setTriggers] = useState<Record<HubId, number>>(() => {
    const t: Record<HubId, number> = {} as any;
    HUBS.forEach((h) => (t[h.id] = 0));
    return t;
  });
  const prevActiveRef = useRef<Record<HubId, boolean>>({} as any);

  useEffect(() => {
    setTriggers((prev) => {
      const next = { ...prev };
      let changed = false;
      hubMetrics.forEach((m) => {
        const wasActive = prevActiveRef.current[m.hub.id] ?? false;
        if (m.active && !wasActive) {
          next[m.hub.id] = (prev[m.hub.id] ?? 0) + 1;
          changed = true;
        }
        prevActiveRef.current[m.hub.id] = m.active;
      });
      return changed ? next : prev;
    });
  }, [hubMetrics]);

  return triggers;
}

// =====================================================================
// Public component
// =====================================================================
interface UlysseBrainVisualizerProps {
  className?: string;
  height?: number;
}

export function UlysseBrainVisualizer({
  className = "",
  height = 380,
}: UlysseBrainVisualizerProps) {
  const activity = useBrainActivity(true);
  const [hovered, setHovered] = useState<HubId | null>(null);
  const [selected, setSelected] = useState<HubId | null>(null);
  const [layout, setLayout] = useState<"hybrid" | "brain" | "cockpit">("hybrid");

  const hubMetrics = useMemo(
    () => HUBS.map((h) => buildHubMetric(h, activity.zones)),
    [activity.zones]
  );

  const hubSeries = useHubSeries(hubMetrics);
  const hubTriggers = useHubPulseTriggers(hubMetrics);

  // Group recent events per hub (heuristic).
  const eventsByHub = useMemo(() => {
    const map: Record<HubId, typeof activity.recentEvents> = {} as any;
    HUBS.forEach((h) => (map[h.id] = []));
    activity.recentEvents.forEach((e) => {
      const hub = HUBS.find((h) => h.matchEvent(e));
      if (hub) map[hub.id].push(e);
    });
    return map;
  }, [activity.recentEvents]);

  const uptimeMin = Math.floor((activity.totals.uptime ?? 0) / 60_000);

  return (
    <div
      className={`relative w-full overflow-hidden rounded-lg border border-blue-900/40 bg-slate-950 ${className}`}
      style={{ height }}
      data-testid="ulysse-brain-visualizer"
    >
      <div className="grid h-full" style={{
        gridTemplateColumns:
          layout === "brain"   ? "1fr 0fr" :
          layout === "cockpit" ? "0fr 1fr" :
                                 "7fr 5fr",
      }}>
        {/* === LEFT: 3D anatomical brain === */}
        <div
          className="relative border-r border-slate-900 overflow-hidden"
          style={{ display: layout === "cockpit" ? "none" : "block" }}
        >
          {/* Layout toggle (top-center) */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex gap-0.5 rounded border border-slate-700 bg-slate-950/80 backdrop-blur-sm overflow-hidden">
            {([
              { id: "brain",   label: "BRAIN",   title: "Cerveau seul" },
              { id: "hybrid",  label: "HYBRID",  title: "Cerveau + cockpit" },
              { id: "cockpit", label: "COCKPIT", title: "Cockpit seul" },
            ] as const).map((opt) => (
              <button
                key={opt.id}
                onClick={() => setLayout(opt.id)}
                title={opt.title}
                className="font-mono text-[8px] px-1.5 py-0.5 tracking-wider transition-colors"
                style={{
                  color: layout === opt.id ? "#ffd966" : "#94a3b8",
                  background: layout === opt.id ? "rgba(255,217,102,0.12)" : "transparent",
                  fontWeight: 700,
                }}
                data-testid={`button-layout-${opt.id}`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* HUD top-left: global state */}
          <div className="absolute top-2 left-2 z-10 font-mono text-[9px] text-cyan-300/90 leading-tight">
            <div className="text-cyan-200 font-bold tracking-wider">
              ULYSSE · BRAIN
            </div>
            <div className="text-slate-400">
              <span style={{ color: activity.mood.color }}>
                {activity.mood.emoji} {activity.mood.label}
              </span>
              {" · "}charge: {activity.consciousness.cognitiveLoad}%
            </div>
            <div className="text-slate-500">
              uptime: {uptimeMin}m · WM: {activity.consciousness.workingMemory}
            </div>
          </div>

          {/* HUD top-right: totals */}
          <div className="absolute top-2 right-2 z-10 font-mono text-[9px] text-right text-slate-400 leading-tight">
            <div>in {activity.totals.inputs}</div>
            <div>out {activity.totals.outputs}</div>
            <div>act {activity.totals.actions}</div>
            <div className="text-slate-600">
              total: {activity.totals.events}
            </div>
          </div>

          <Canvas
            camera={{ position: [4.5, 1.2, 5.8], fov: 50 }}
            dpr={[1, 1.5]}
            gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
            onCreated={({ gl }) => {
              gl.toneMapping = THREE.ACESFilmicToneMapping;
              gl.toneMappingExposure = 1.05;
            }}
          >
            <Suspense fallback={null}>
              <BrainScene
                hubMetrics={hubMetrics}
                hubPulseTriggers={hubTriggers}
                hovered={hovered}
                onSelect={setSelected}
                onHover={setHovered}
              />
              <EffectComposer multisampling={0} disableNormalPass>
                <Bloom intensity={0.9} luminanceThreshold={0.18} luminanceSmoothing={0.4} mipmapBlur radius={0.7} />
                <Vignette eskil={false} offset={0.18} darkness={0.55} />
              </EffectComposer>
              <OrbitControls
                enablePan={false}
                minDistance={4}
                maxDistance={11}
                enableDamping
                dampingFactor={0.08}
              />
            </Suspense>
          </Canvas>
        </div>

        {/* === RIGHT: Cockpit (real metrics only) === */}
        <div
          className="relative flex flex-col p-2 gap-2 overflow-y-auto"
          style={{ display: layout === "brain" ? "none" : "flex" }}
        >
          {/* Layout toggle visible aussi quand seul le cockpit est affiché */}
          {layout === "cockpit" && (
            <div className="absolute top-2 right-2 z-20 flex gap-0.5 rounded border border-slate-700 bg-slate-950/80 overflow-hidden">
              {([
                { id: "brain",   label: "BRAIN" },
                { id: "hybrid",  label: "HYBRID" },
                { id: "cockpit", label: "COCKPIT" },
              ] as const).map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setLayout(opt.id)}
                  className="font-mono text-[8px] px-1.5 py-0.5 tracking-wider transition-colors"
                  style={{
                    color: layout === opt.id ? "#ffd966" : "#94a3b8",
                    background: layout === opt.id ? "rgba(255,217,102,0.12)" : "transparent",
                    fontWeight: 700,
                  }}
                  data-testid={`button-layout-${opt.id}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="font-mono text-[10px] text-cyan-300 font-bold tracking-wider">
              MISSION CONTROL
            </div>
            <div className="font-mono text-[8px] text-slate-500">
              live · {activity.ready ? "online" : "boot…"}
            </div>
          </div>

          {/* 6 Hub cards in 2 columns (BRAIN, HEAR, SEE, VOICE, ACT, MEM) */}
          <div className="grid grid-cols-2 gap-1.5">
            {hubMetrics.map((m) => (
              <HubCard
                key={m.hub.id}
                metric={m}
                series={hubSeries[m.hub.id] ?? []}
                recentEvents={eventsByHub[m.hub.id]}
                hovered={hovered === m.hub.id}
                onHover={setHovered}
              />
            ))}
            {/* extra tile: cumulative knowledge graph (concepts/bridges/persona) */}
            <div className="rounded border border-blue-900/40 bg-slate-950/60 p-2 col-span-2">
              <div className="font-mono text-[9px] tracking-wider font-bold text-cyan-300">
                KNOWLEDGE GRAPH
              </div>
              <div
                className="font-mono text-lg font-bold leading-none mt-1 text-slate-100"
                data-testid="text-knowledge-total"
              >
                {activity.evolution.knowledge.toLocaleString("fr-FR")}
              </div>
              <div className="font-mono text-[8px] text-slate-500 mt-0.5">
                bridges · concepts · souvenirs
              </div>
              <div className="font-mono text-[8px] text-slate-400 mt-1">
                persona: {activity.consciousness.persona}
              </div>
            </div>
          </div>

          {/* Selected hub detail */}
          {selected && (() => {
            const m = hubMetrics.find((x) => x.hub.id === selected);
            if (!m) return null;
            return (
              <div className="rounded border border-amber-900/40 bg-slate-950/80 p-2 mt-1">
                <div className="flex items-center justify-between mb-1">
                  <div className="font-mono text-[10px] text-amber-300 font-bold tracking-wider">
                    {m.hub.label}
                  </div>
                  <button
                    onClick={() => setSelected(null)}
                    className="text-slate-500 hover:text-slate-200 text-[10px]"
                    data-testid="button-close-hub-detail"
                  >
                    ×
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-y-0.5 text-[9px] font-mono">
                  <div className="text-slate-500">events totaux</div>
                  <div className="text-right text-slate-200">{m.totalEvents}</div>
                  <div className="text-slate-500">firing rate</div>
                  <div className="text-right text-slate-200">{m.firingHz.toFixed(2)} Hz</div>
                  <div className="text-slate-500">statut</div>
                  <div className="text-right" style={{ color: m.active ? "#22c55e" : "#94a3b8" }}>
                    {m.active ? "ACTIF" : "REPOS"}
                  </div>
                </div>
                {eventsByHub[m.hub.id].length > 0 && (
                  <div className="mt-1 pt-1 border-t border-slate-800">
                    <div className="font-mono text-[8px] text-slate-500 mb-0.5">events récents:</div>
                    {eventsByHub[m.hub.id].slice(0, 4).map((e, i) => (
                      <div key={i} className="font-mono text-[8px] text-slate-400 truncate">
                        · {Math.floor((Date.now() - e.timestamp) / 1000)}s · {e.type}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
