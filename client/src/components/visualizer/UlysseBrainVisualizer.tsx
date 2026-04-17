import { Suspense, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, OrbitControls, Sphere, Line, Stars } from "@react-three/drei";
import * as THREE from "three";
import { useBrainActivity, type BrainZone, type BrainZoneId } from "@/hooks/useBrainActivity";
import { AnimatedOrb } from "@/components/visualizer/UlysseOrb";

// Anatomically-inspired zone positions inside an ellipsoidal brain (X=L/R, Y=up, Z=front/back).
// Brain front = +Z, top = +Y. Two hemispheres around X axis.
const ZONE_POSITIONS: Record<BrainZoneId, [number, number, number]> = {
  prefrontal:  [ 0.0,  0.9,  1.7],   // frontal lobe (front-top), midline
  motor:       [-0.9,  1.1,  0.4],   // motor cortex strip (top), left hemisphere bias
  sensory:     [ 0.9,  0.7, -0.2],   // somatosensory (just behind motor), right hemisphere
  association: [ 0.0,  0.5, -0.3],   // parietal association cortex (top-back midline)
  language:    [-1.5, -0.2,  0.3],   // Broca/Wernicke area (left temporal)
  feature:     [ 1.5, -0.2,  0.3],   // right temporal, semantic features
  hippocampus: [ 0.0, -0.5,  0.0],   // deep central — hippocampus is deep medial
  concept:     [ 0.0, -0.4, -1.6],   // occipital/posterior — concept consolidation
};

// Inter-zone "axons" — match real cross-hub bridges in the architecture.
const CONNECTIONS: Array<[BrainZoneId, BrainZoneId]> = [
  ["sensory", "prefrontal"],
  ["prefrontal", "motor"],
  ["prefrontal", "association"],
  ["association", "concept"],
  ["association", "hippocampus"],
  ["concept", "feature"],
  ["feature", "language"],
  ["motor", "language"],
  ["hippocampus", "concept"],
  ["sensory", "feature"],
];

// Direction of signal flow vs central core (BrainHub) — Ulysse's real architecture.
// 'in'  = zone sends signals INTO the core (perception, recall, knowledge)
// 'out' = core sends signals OUT to the zone (decision → action)
// 'both' = bidirectional dialogue with the core
const ZONE_FLOW: Record<BrainZoneId, "in" | "out" | "both"> = {
  sensory:     "in",   // HearingHub/VisionHub → BrainHub
  hippocampus: "in",   // memoryGraph recall → BrainHub
  concept:     "in",   // learned knowledge → BrainHub
  prefrontal:  "both", // BrainHub itself ↔ core
  association: "both", // bridges, cross-hub intuitions
  feature:     "both", // semantic embeddings ↔ core
  motor:       "out",  // BrainHub → ActionHub
  language:    "out",  // BrainHub → VoiceOutputHub (TTS)
};

function seedRand(i: number, j: number) {
  const x = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function ZoneCluster({
  zone,
  position,
  onSelect,
}: {
  zone: BrainZone;
  position: [number, number, number];
  onSelect: (id: BrainZoneId) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const pulseRef = useRef(0);
  const ambientPhase = useRef(Math.random() * Math.PI * 2);

  // Stable random offsets per neuron based on zone id. TIGHT cluster (radius ~0.55).
  const seed = zone.id.charCodeAt(0) + zone.id.length * 13;
  const neurons = useMemo(() => {
    return Array.from({ length: zone.neurons }, (_, i) => ({
      pos: [
        (seedRand(seed, i * 3) - 0.5) * 1.1,
        (seedRand(seed, i * 3 + 1) - 0.5) * 1.1,
        (seedRand(seed, i * 3 + 2) - 0.5) * 1.1,
      ] as [number, number, number],
      size: 0.012 + seedRand(seed, i * 7) * 0.018,
    }));
  }, [zone.neurons, seed]);

  // Intra-zone wires: connect each neuron to its 2 nearest peers.
  const intraLines = useMemo(() => {
    const pairs: Array<[[number, number, number], [number, number, number]]> = [];
    for (let i = 0; i < neurons.length; i++) {
      const distances = neurons
        .map((n, j) => ({ j, d: Math.hypot(n.pos[0] - neurons[i].pos[0], n.pos[1] - neurons[i].pos[1], n.pos[2] - neurons[i].pos[2]) }))
        .filter(x => x.j !== i)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2);
      for (const { j } of distances) {
        if (j > i) pairs.push([neurons[i].pos, neurons[j].pos]);
      }
    }
    return pairs;
  }, [neurons]);

  // Radial axon trails — long lines shooting outward, with synapse dots along them.
  const trails = useMemo(() => {
    const count = 8 + Math.floor(zone.neurons / 4);
    return Array.from({ length: count }, (_, i) => {
      const r = seedRand(seed, i * 11);
      const theta = seedRand(seed, i * 13) * Math.PI * 2;
      const phi = (seedRand(seed, i * 17) - 0.5) * Math.PI;
      const length = 4 + r * 8; // long radial trails 4..12 units
      // Slight curve via mid-point displacement.
      const dir: [number, number, number] = [
        Math.cos(theta) * Math.cos(phi),
        Math.sin(phi),
        Math.sin(theta) * Math.cos(phi),
      ];
      const end: [number, number, number] = [dir[0] * length, dir[1] * length, dir[2] * length];
      const mid: [number, number, number] = [
        end[0] * 0.5 + (seedRand(seed, i * 23) - 0.5) * 1.5,
        end[1] * 0.5 + (seedRand(seed, i * 29) - 0.5) * 1.5,
        end[2] * 0.5 + (seedRand(seed, i * 31) - 0.5) * 1.5,
      ];
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(...mid),
        new THREE.Vector3(...end),
      ]);
      const pts = curve.getPoints(20).map(v => [v.x, v.y, v.z] as [number, number, number]);
      // Synapse dots at 3 positions along the trail.
      const synapses = [0.35, 0.6, 0.85].map(t => {
        const v = curve.getPoint(t);
        return [v.x, v.y, v.z] as [number, number, number];
      });
      return { pts, synapses };
    });
  }, [zone.neurons, seed]);

  // Ambient activity intensity ∈ [0,1] — proportional to real total events.
  const ambientIntensity = Math.min(1, Math.log10(zone.totalEvents + 1) / 3);

  useFrame((state, delta) => {
    // Real event spike → 1, decays slower (2.5s) for visibility.
    if (zone.active) pulseRef.current = 1;
    else pulseRef.current = Math.max(0, pulseRef.current - delta * 0.4);

    // Ambient breathing — sinus modulated by real activity level.
    ambientPhase.current += delta * (0.6 + ambientIntensity * 1.2);
    const ambient = ambientIntensity * (0.5 + 0.5 * Math.sin(ambientPhase.current));

    if (groupRef.current) {
      const breath = 1 + pulseRef.current * 0.25 + ambient * 0.08;
      groupRef.current.scale.setScalar(breath);
    }
  });

  const color = new THREE.Color(zone.color);
  const intensityBase = 0.6 + Math.min(1.5, zone.firingHz * 0.4);

  const trailOpacity = 0.18 + ambientIntensity * 0.25 + pulseRef.current * 0.4;

  return (
    <group ref={groupRef} position={position}>
      {/* Radial axon trails — long lines shooting outward like comets */}
      {trails.map((t, i) => (
        <Line
          key={`trail-${i}`}
          points={t.pts}
          color={zone.color}
          lineWidth={0.6}
          transparent
          opacity={trailOpacity}
        />
      ))}
      {/* Bright white synapse dots along the trails */}
      {trails.map((t, i) =>
        t.synapses.map((s, k) => (
          <Sphere key={`syn-${i}-${k}`} args={[0.022 + (k === 1 ? 0.012 : 0), 6, 6]} position={s}>
            <meshBasicMaterial color="#cfe7ff" transparent opacity={0.6 + pulseRef.current * 0.4} />
          </Sphere>
        ))
      )}
      {/* Neurons — small dots at zone core */}
      {neurons.map((n, i) => (
        <Sphere key={i} args={[n.size, 8, 8]} position={n.pos}>
          <meshBasicMaterial color={color} transparent opacity={0.95} />
        </Sphere>
      ))}
      {/* Intra-zone wires */}
      {intraLines.map((pair, i) => (
        <Line
          key={`l-${i}`}
          points={[pair[0], pair[1]]}
          color={zone.color}
          lineWidth={0.8}
          transparent
          opacity={0.4 + pulseRef.current * 0.5}
        />
      ))}
      {/* Tiny clickable label — only zone name */}
      <Html
        center
        position={[0, 0.85, 0]}
        zIndexRange={[10, 0]}
        style={{ transform: "translate(-50%, -50%)" }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(zone.id);
          }}
          className="font-mono whitespace-nowrap select-none px-1 py-px rounded-[2px] border cursor-pointer transition-all hover:scale-110"
          style={{
            fontSize: "8px",
            lineHeight: "10px",
            color: zone.color,
            borderColor: zone.color,
            background: "rgba(2, 8, 23, 0.85)",
            boxShadow: zone.active ? `0 0 8px ${zone.color}` : "none",
            opacity: 0.85,
            letterSpacing: "0.1em",
            fontWeight: 700,
          }}
          data-testid={`brain-zone-${zone.id}`}
          title={`${zone.label} — clic pour détails`}
        >
          {zone.label}
        </button>
      </Html>
    </group>
  );
}

function AxonConnection({
  from,
  to,
  active,
}: {
  from: [number, number, number];
  to: [number, number, number];
  active: boolean;
}) {
  const ref = useRef<any>(null);
  const pulseRef = useRef(0);

  // Curved path (slight arc through midpoint offset).
  const points = useMemo(() => {
    const mid: [number, number, number] = [
      (from[0] + to[0]) / 2 + (from[1] - to[1]) * 0.1,
      (from[1] + to[1]) / 2 + 0.3,
      (from[2] + to[2]) / 2 + (from[0] - to[0]) * 0.1,
    ];
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(...from),
      new THREE.Vector3(...mid),
      new THREE.Vector3(...to),
    ]);
    return curve.getPoints(24).map(v => [v.x, v.y, v.z] as [number, number, number]);
  }, [from, to]);

  useFrame((_, delta) => {
    if (active) pulseRef.current = 1;
    else pulseRef.current = Math.max(0, pulseRef.current - delta * 0.8);
    if (ref.current?.material) {
      ref.current.material.opacity = 0.12 + pulseRef.current * 0.7;
    }
  });

  return (
    <Line
      ref={ref}
      points={points}
      color={active ? "#7dd3fc" : "#3b82f6"}
      lineWidth={active ? 1.4 : 0.6}
      transparent
      opacity={0.15}
    />
  );
}

/**
 * Animated signal flow between a zone and the central core (BrainHub).
 * Renders a faint connection line + N traveling glowing pulses.
 * Direction (in/out/both) reflects the real Ulysse data flow.
 * Pulse density and speed proportional to the zone's real firing rate.
 */
function SignalFlow({ zone, zonePos }: { zone: BrainZone; zonePos: [number, number, number] }) {
  const flow = ZONE_FLOW[zone.id];
  const ambientIntensity = Math.min(1, Math.log10(zone.totalEvents + 1) / 3);
  // Number of traveling pulses: 1 baseline, more when zone is hot.
  const pulseCount = 1 + Math.floor(ambientIntensity * 4) + (zone.active ? 3 : 0);
  // Speed: 0.25 → 1.5 cycles/sec depending on real firingHz.
  const speed = 0.25 + Math.min(1.25, zone.firingHz * 0.5 + ambientIntensity * 0.4);

  const pulses = useMemo(
    () =>
      Array.from({ length: pulseCount }, (_, i) => ({
        id: i,
        offset: i / pulseCount,
        // For 'both' zones: half go in, half go out.
        direction:
          flow === "in"  ? 1 :
          flow === "out" ? -1 :
          i % 2 === 0    ? 1 : -1,
      })),
    [pulseCount, flow]
  );

  const pulseRefs = useRef<Array<THREE.Mesh | null>>([]);
  const lineRef = useRef<any>(null);
  const linePulse = useRef(0);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    // Move each pulse along the line zone↔core based on its direction.
    pulses.forEach((p, i) => {
      const mesh = pulseRefs.current[i];
      if (!mesh) return;
      // Phase ∈ [0,1] cycles forward; direction flips travel sense.
      const rawPhase = (t * speed + p.offset) % 1;
      // direction=1 means zone→core (start at zone, go to 0,0,0)
      // direction=-1 means core→zone (start at core, go to zone)
      const phase = p.direction === 1 ? rawPhase : 1 - rawPhase;
      mesh.position.set(
        zonePos[0] * (1 - phase),
        zonePos[1] * (1 - phase),
        zonePos[2] * (1 - phase)
      );
      // Brighten in the middle of the journey for a comet feel.
      const bright = 0.5 + Math.sin(rawPhase * Math.PI) * 0.5;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.4 + bright * 0.6;
      mesh.scale.setScalar(0.7 + bright * 0.6);
    });
    // Brighten the trunk line on real activity.
    if (zone.active) linePulse.current = 1;
    else linePulse.current = Math.max(0, linePulse.current - delta * 0.6);
    if (lineRef.current?.material) {
      lineRef.current.material.opacity = 0.1 + ambientIntensity * 0.15 + linePulse.current * 0.5;
    }
  });

  return (
    <group>
      {/* Trunk line zone ↔ core */}
      <Line
        ref={lineRef}
        points={[zonePos, [0, 0, 0]]}
        color={zone.color}
        lineWidth={0.7}
        transparent
        opacity={0.15}
      />
      {/* Traveling signal pulses */}
      {pulses.map((p, i) => (
        <Sphere
          key={p.id}
          ref={(el) => (pulseRefs.current[i] = el)}
          args={[0.07, 8, 8]}
          position={zonePos}
        >
          <meshBasicMaterial
            color={p.direction === 1 ? zone.color : "#ffffff"}
            transparent
            opacity={0.8}
          />
        </Sphere>
      ))}
    </group>
  );
}

function BrainScene({ onSelectZone }: { onSelectZone: (id: BrainZoneId) => void }) {
  const activity = useBrainActivity(true);
  const groupRef = useRef<THREE.Group>(null);

  // Smoothly interpolate brain scale toward evolution scale (so it visibly grows when new memories arrive).
  const targetScale = activity.evolution.scale;
  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.06;
      const cur = groupRef.current.scale.x;
      const next = cur + (targetScale - cur) * Math.min(1, delta * 0.8);
      groupRef.current.scale.setScalar(next);
    }
  });

  // Build a deterministic list of extra synapses from cross-zone pairs not in CONNECTIONS.
  const extraConnections = useMemo(() => {
    const ids = Object.keys(ZONE_POSITIONS) as BrainZoneId[];
    const existing = new Set(CONNECTIONS.map(([a, b]) => `${a}|${b}`).concat(CONNECTIONS.map(([a, b]) => `${b}|${a}`)));
    const candidates: Array<[BrainZoneId, BrainZoneId]> = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (!existing.has(`${ids[i]}|${ids[j]}`)) candidates.push([ids[i], ids[j]]);
      }
    }
    return candidates.slice(0, activity.evolution.extraSynapses);
  }, [activity.evolution.extraSynapses]);

  return (
    <>
      <ambientLight intensity={0.4} />
      <pointLight position={[5, 5, 5]} intensity={0.5} />
      <Stars radius={40} depth={30} count={1200} factor={2} fade speed={0.3} />
      <group ref={groupRef}>
        {/* Central core = OrbUlysse — Ulysse's living signature orb at the heart of the brain. */}
        {(() => {
          const processing = activity.consciousness.processing;
          const load = activity.consciousness.cognitiveLoad;
          const coreColor = processing ? "#fde047" : "#7dd3fc";
          return (
            <>
              <pointLight position={[0, 0, 0]} color={coreColor} intensity={3 + load / 30} distance={10} decay={2} />
              <group scale={0.96}>
                <AnimatedOrb
                  isActive={processing}
                  isAnalyzing={load > 50}
                  orbColor={processing ? "#fef9c3" : "#e0f2fe"}
                  orbIntensity={100}
                />
              </group>
            </>
          );
        })()}

        {/* Live signal flow zone ↔ central core (Ulysse data flow) */}
        {activity.zones.map(zone => (
          <SignalFlow key={`flow-${zone.id}`} zone={zone} zonePos={ZONE_POSITIONS[zone.id]} />
        ))}

        {/* Inter-zone axons (base architecture) */}
        {CONNECTIONS.map(([a, b], i) => {
          const zoneA = activity.zones.find(z => z.id === a);
          const zoneB = activity.zones.find(z => z.id === b);
          const active = !!(zoneA?.active || zoneB?.active);
          return (
            <AxonConnection
              key={i}
              from={ZONE_POSITIONS[a]}
              to={ZONE_POSITIONS[b]}
              active={active}
            />
          );
        })}

        {/* Acquired synapses — grow with bridges/cross-hub intuitions */}
        {extraConnections.map(([a, b], i) => {
          const zoneA = activity.zones.find(z => z.id === a);
          const zoneB = activity.zones.find(z => z.id === b);
          const active = !!(zoneA?.active || zoneB?.active);
          return (
            <AxonConnection
              key={`extra-${i}`}
              from={ZONE_POSITIONS[a]}
              to={ZONE_POSITIONS[b]}
              active={active}
            />
          );
        })}

        {/* Zones */}
        {activity.zones.map(zone => (
          <ZoneCluster
            key={zone.id}
            zone={zone}
            position={ZONE_POSITIONS[zone.id]}
            onSelect={onSelectZone}
          />
        ))}
      </group>
    </>
  );
}

interface UlysseBrainVisualizerProps {
  className?: string;
  height?: number;
}

const ZONE_DESCRIPTIONS: Record<BrainZoneId, string> = {
  prefrontal:  "Prend les décisions. Ce sur quoi Ulysse se concentre, sa charge cognitive du moment.",
  motor:       "Exécute les actions concrètes : appels d'outils, commandes système, recherches.",
  sensory:     "Perçoit le monde : messages que tu envoies, ce qu'il voit (vision), ce qu'il entend.",
  concept:     "Apprend les notions nouvelles : règles métier, préférences, faits durables.",
  feature:     "Pense en représentations vectorielles internes (embeddings sémantiques).",
  language:    "Formule et prononce les réponses vocales (TTS, voix Ulysse).",
  hippocampus: "Stocke et rappelle les souvenirs : graphe mémoire long terme.",
  association: "Crée des connexions entre les zones — les intuitions et raccourcis cross-hub.",
};

export function UlysseBrainVisualizer({ className = "", height = 280 }: UlysseBrainVisualizerProps) {
  const activity = useBrainActivity(true);
  const [selectedId, setSelectedId] = useState<BrainZoneId | null>(null);
  const selectedZone = selectedId ? activity.zones.find(z => z.id === selectedId) : null;

  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl border border-blue-900/40 ${className}`}
      style={{
        height,
        background:
          "radial-gradient(ellipse at center, rgba(15,23,42,0.95) 0%, rgba(2,6,23,1) 100%)",
      }}
      data-testid="ulysse-brain-visualizer"
    >
      <Canvas
        camera={{ position: [0, 0.3, 7.5], fov: 55 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: "low-power", preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: false }}
        onCreated={({ gl }) => {
          // Recover gracefully from WebGL context loss (HMR, tab switch, GPU reset).
          const canvas = gl.domElement;
          canvas.addEventListener("webglcontextlost", (e) => {
            e.preventDefault();
            console.warn("[BrainVisualizer] WebGL context lost — preventing default to allow restore");
          });
          canvas.addEventListener("webglcontextrestored", () => {
            console.log("[BrainVisualizer] WebGL context restored");
          });
        }}
      >
        <Suspense fallback={null}>
          <BrainScene onSelectZone={setSelectedId} />
        </Suspense>
        <OrbitControls
          enablePan={false}
          enableZoom={false}
          enableRotate
          autoRotate={false}
        />
      </Canvas>

      {/* HUD overlay */}
      <div className="pointer-events-none absolute top-2 left-3 font-mono text-[10px] text-blue-300/80 leading-tight">
        <div className="font-bold tracking-widest text-blue-200" data-testid="text-brain-title">
          ULYSSE · BRAIN v1
        </div>
        <div
          className="font-bold tracking-[0.18em] mt-0.5 text-[11px] flex items-center gap-1"
          style={{
            color: activity.mood.color,
            textShadow: `0 0 6px ${activity.mood.color}88`,
          }}
          data-testid="text-brain-mood"
        >
          <span>{activity.mood.emoji}</span>
          <span>{activity.mood.label}</span>
        </div>
        <div data-testid="text-brain-load" className="mt-0.5">
          charge: {activity.consciousness.cognitiveLoad.toFixed(0)}%
        </div>
      </div>
      <div className="pointer-events-none absolute top-2 right-3 font-mono text-[10px] text-blue-300/80 text-right leading-tight">
        <div data-testid="text-brain-totals">
          in {activity.totals.inputs} · out {activity.totals.outputs} · act {activity.totals.actions}
        </div>
        <div data-testid="text-brain-wm">working memory: {activity.consciousness.workingMemory}</div>
        <div className="opacity-70">persona: {activity.consciousness.persona}</div>
      </div>
      {/* Live event ticker — proof of real activity */}
      {activity.recentEvents.length > 0 && (
        <div
          className="pointer-events-none absolute bottom-2 left-3 right-20 font-mono text-[9px] text-blue-200/80 leading-tight overflow-hidden"
          data-testid="brain-event-ticker"
        >
          {activity.recentEvents.slice(0, 2).map((ev, i) => (
            <div
              key={`${ev.timestamp}-${i}`}
              className="truncate"
              style={{
                opacity: 1 - i * 0.4,
                color:
                  ev.type === "hearing" ? "#3da9ff" :
                  ev.type === "vision"  ? "#7dd3fc" :
                  ev.type === "action"  ? "#ffb347" :
                  ev.type === "speech"  ? "#ff5c8a" : "#94a3b8",
              }}
            >
              ▸ {ev.type}{ev.summary ? ` · ${ev.summary}` : ""}
            </div>
          ))}
        </div>
      )}
      {!activity.ready && (
        <div className="absolute inset-0 flex items-center justify-center font-mono text-xs text-blue-400/60">
          connecting to sensory system…
        </div>
      )}

      {/* Detail panel for clicked zone */}
      {selectedZone && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm z-20 p-4"
          onClick={() => setSelectedId(null)}
          data-testid="brain-zone-detail-overlay"
        >
          <div
            className="relative max-w-sm w-full rounded-lg border-2 p-4 font-mono text-xs"
            style={{
              borderColor: selectedZone.color,
              background: "rgba(2, 8, 23, 0.95)",
              boxShadow: `0 0 24px ${selectedZone.color}55`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="absolute top-2 right-2 text-slate-400 hover:text-white text-base leading-none"
              data-testid="button-close-zone-detail"
              aria-label="Fermer"
            >
              ×
            </button>
            <div
              className="text-base font-bold tracking-[0.2em] mb-2"
              style={{ color: selectedZone.color }}
              data-testid="text-zone-detail-name"
            >
              {selectedZone.label}
            </div>
            <div className="text-slate-300 leading-relaxed mb-3 font-sans text-[11px]">
              {ZONE_DESCRIPTIONS[selectedZone.id]}
            </div>
            <div className="grid grid-cols-2 gap-y-1.5 gap-x-3 text-slate-200">
              <div className="text-slate-500">Activité totale</div>
              <div className="text-right font-bold" data-testid="text-zone-total-events">
                {selectedZone.totalEvents.toLocaleString("fr-FR")}
              </div>
              <div className="text-slate-500">Fréquence (Hz)</div>
              <div className="text-right font-bold" data-testid="text-zone-firing-hz">
                {selectedZone.firingHz.toFixed(2)}
              </div>
              <div className="text-slate-500">Neurones</div>
              <div className="text-right font-bold">{selectedZone.neurons}</div>
              <div className="text-slate-500">État</div>
              <div className="text-right font-bold" style={{ color: selectedZone.active ? "#4ade80" : "#64748b" }}>
                {selectedZone.active ? "● actif" : "○ repos"}
              </div>
            </div>
            <div
              className="mt-3 pt-3 border-t border-slate-700/60 text-[11px]"
              style={{ color: selectedZone.color }}
              data-testid="text-zone-detail-info"
            >
              {selectedZone.detail}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default UlysseBrainVisualizer;
