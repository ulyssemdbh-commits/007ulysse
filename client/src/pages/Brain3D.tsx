import { useEffect, useState, lazy, Suspense } from "react";
import { Link } from "wouter";
import { useBrainActivity } from "@/hooks/useBrainActivity";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, BarChart3, Maximize2, Minimize2 } from "lucide-react";

const UlysseBrainVisualizer = lazy(() =>
  import("@/components/visualizer/UlysseBrainVisualizer").then((m) => ({
    default: m.UlysseBrainVisualizer,
  })),
);

function formatUptime(sec: number): string {
  if (!sec || sec < 1) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function Brain3D() {
  const activity = useBrainActivity(true);
  const [size, setSize] = useState<number>(0);
  const [hudOpen, setHudOpen] = useState(true);

  useEffect(() => {
    const update = () =>
      setSize(typeof window !== "undefined" ? window.innerHeight - 8 : 800);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    document.title = `Cerveau Ulysse — ${activity.mood.label}`;
  }, [activity.mood.label]);

  return (
    <div
      className="relative h-screen w-screen overflow-hidden bg-black text-white"
      data-testid="page-brain3d"
    >
      <Suspense
        fallback={
          <div className="flex h-full w-full items-center justify-center text-slate-400">
            Chargement du cerveau…
          </div>
        }
      >
        {size > 0 && <UlysseBrainVisualizer height={size} />}
      </Suspense>

      {/* Top-left header */}
      <div className="pointer-events-auto absolute left-3 top-3 z-20 flex items-center gap-2">
        <Link href="/">
          <Button
            variant="outline"
            size="sm"
            className="border-white/20 bg-black/60 text-white hover:bg-black/80"
            data-testid="link-back-dashboard"
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Dashboard
          </Button>
        </Link>
        <Link href="/brain/learning">
          <Button
            variant="outline"
            size="sm"
            className="border-white/20 bg-black/60 text-white hover:bg-black/80"
            data-testid="link-brain-learning"
          >
            <BarChart3 className="mr-1.5 h-4 w-4" /> Stats apprentissage
          </Button>
        </Link>
      </div>

      {/* Top-right HUD toggle */}
      <div className="pointer-events-auto absolute right-3 top-3 z-20">
        <Button
          variant="outline"
          size="sm"
          className="border-white/20 bg-black/60 text-white hover:bg-black/80"
          onClick={() => setHudOpen((v) => !v)}
          data-testid="button-toggle-hud"
        >
          {hudOpen ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Bottom-left HUD: live brain telemetry */}
      {hudOpen && (
        <div
          className="pointer-events-none absolute bottom-3 left-3 z-20 max-w-md rounded-lg border border-white/15 bg-black/70 p-3 backdrop-blur-md"
          data-testid="hud-brain-stats"
        >
          <div className="mb-2 flex items-center gap-2">
            <span
              className="text-2xl"
              style={{ color: activity.mood.color }}
              data-testid="text-brain-mood-emoji"
            >
              {activity.mood.emoji}
            </span>
            <span
              className="text-sm font-bold tracking-wider"
              style={{ color: activity.mood.color }}
              data-testid="text-brain-mood"
            >
              {activity.mood.label}
            </span>
            <Badge
              variant="outline"
              className="ml-auto border-white/20 text-xs text-white/80"
              data-testid="badge-brain-focus"
            >
              focus: {activity.consciousness.focus}
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-white/80">
            <div data-testid="stat-inputs">
              <span className="text-white/50">Entrées</span>{" "}
              <span className="font-mono text-white">
                {activity.totals.inputs}
              </span>
            </div>
            <div data-testid="stat-actions">
              <span className="text-white/50">Actions</span>{" "}
              <span className="font-mono text-white">
                {activity.totals.actions}
              </span>
            </div>
            <div data-testid="stat-outputs">
              <span className="text-white/50">Sorties</span>{" "}
              <span className="font-mono text-white">
                {activity.totals.outputs}
              </span>
            </div>
            <div data-testid="stat-events">
              <span className="text-white/50">Événements</span>{" "}
              <span className="font-mono text-white">
                {activity.totals.events}
              </span>
            </div>
            <div data-testid="stat-memory">
              <span className="text-white/50">Mémoire</span>{" "}
              <span className="font-mono text-white">
                {activity.zones.find((z) => z.id === "hippocampus")
                  ?.totalEvents ?? 0}
              </span>
            </div>
            <div data-testid="stat-bridges">
              <span className="text-white/50">Intuitions</span>{" "}
              <span className="font-mono text-white">
                {activity.zones.find((z) => z.id === "association")
                  ?.totalEvents ?? 0}
              </span>
            </div>
            <div data-testid="stat-load">
              <span className="text-white/50">Charge</span>{" "}
              <span className="font-mono text-white">
                {Math.round(activity.consciousness.cognitiveLoad)}%
              </span>
            </div>
            <div data-testid="stat-uptime">
              <span className="text-white/50">Uptime</span>{" "}
              <span className="font-mono text-white">
                {formatUptime(activity.totals.uptime)}
              </span>
            </div>
          </div>

          {activity.recentEvents.length > 0 && (
            <div className="mt-3 border-t border-white/10 pt-2">
              <div className="mb-1 text-[10px] uppercase tracking-widest text-white/40">
                Dernières activités
              </div>
              <ul className="space-y-0.5 text-[11px] text-white/70">
                {activity.recentEvents.slice(0, 4).map((e, i) => (
                  <li
                    key={i}
                    className="truncate"
                    data-testid={`text-recent-event-${i}`}
                  >
                    <span className="text-white/40">
                      {new Date(e.timestamp).toLocaleTimeString("fr-FR", {
                        hour12: false,
                      })}
                    </span>{" "}
                    {e.summary || e.type}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Bottom-right: connection status */}
      <div
        className="pointer-events-none absolute bottom-3 right-3 z-20 rounded-md border border-white/15 bg-black/60 px-2 py-1 text-[10px] uppercase tracking-widest text-white/70 backdrop-blur"
        data-testid="text-connection-status"
      >
        {activity.ready ? (
          <>
            <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
            connecté
          </>
        ) : (
          <>
            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-yellow-400" />
            connexion…
          </>
        )}
      </div>
    </div>
  );
}
