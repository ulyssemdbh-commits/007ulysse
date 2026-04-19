import { useQuery } from "@tanstack/react-query";
import { Calendar, CreditCard, Trophy, Activity, ChevronRight, TrendingUp, Zap, Minimize2, Maximize2, Expand, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState, lazy, Suspense } from "react";
import { useLocation } from "wouter";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { UlysseTodoPanel } from "@/components/UlysseTodoPanel";

const UlysseBrainVisualizer = lazy(() =>
  import("@/components/visualizer/UlysseBrainVisualizer").then(m => ({ default: m.UlysseBrainVisualizer }))
);

const BrainUnavailableFallback = ({ height }: { height: number }) => (
  <div
    className="w-full rounded-xl border border-blue-900/40 bg-slate-950 flex items-center justify-center text-[10px] font-mono text-blue-400/60"
    style={{ height }}
    data-testid="brain-unavailable"
  >
    brain unavailable (no WebGL)
  </div>
);

type BrainSize = "s" | "m" | "l";
const BRAIN_HEIGHTS: Record<BrainSize, number> = { s: 160, m: 260, l: 380 };

function BrainPanel() {
  const [size, setSize] = useState<BrainSize>(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("ulysse-brain-size") : null;
    return (saved as BrainSize) || "m";
  });
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("ulysse-brain-size", size);
  }, [size]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const cycleSize = () => setSize(s => (s === "s" ? "m" : s === "m" ? "l" : "s"));
  const shrink = () => setSize(s => (s === "l" ? "m" : "s"));

  return (
    <>
      <div className="relative" data-testid="brain-panel-right">
        <ErrorBoundary fallback={<BrainUnavailableFallback height={BRAIN_HEIGHTS[size]} />}>
          <Suspense
            fallback={
              <div
                className="w-full rounded-xl border border-blue-900/40 bg-slate-950 flex items-center justify-center text-[10px] font-mono text-blue-400/60"
                style={{ height: BRAIN_HEIGHTS[size] }}
              >
                loading brain…
              </div>
            }
          >
            <UlysseBrainVisualizer height={BRAIN_HEIGHTS[size]} />
          </Suspense>
        </ErrorBoundary>
        <div className="absolute bottom-2 right-2 flex gap-1">
          <button
            onClick={shrink}
            disabled={size === "s"}
            data-testid="button-brain-shrink"
            className="p-1 rounded bg-slate-900/80 border border-blue-700/40 text-blue-300 hover:bg-slate-800 disabled:opacity-30"
            title="Réduire"
          >
            <Minimize2 className="w-3 h-3" />
          </button>
          <button
            onClick={cycleSize}
            data-testid="button-brain-cycle-size"
            className="px-1.5 rounded bg-slate-900/80 border border-blue-700/40 text-blue-300 hover:bg-slate-800 text-[9px] font-mono uppercase"
            title="Taille"
          >
            {size}
          </button>
          <button
            onClick={() => setSize(s => (s === "s" ? "m" : "l"))}
            disabled={size === "l"}
            data-testid="button-brain-grow"
            className="p-1 rounded bg-slate-900/80 border border-blue-700/40 text-blue-300 hover:bg-slate-800 disabled:opacity-30"
            title="Agrandir"
          >
            <Maximize2 className="w-3 h-3" />
          </button>
          <button
            onClick={() => setFullscreen(true)}
            data-testid="button-brain-fullscreen"
            className="p-1 rounded bg-slate-900/80 border border-blue-700/40 text-blue-300 hover:bg-slate-800"
            title="Plein écran"
          >
            <Expand className="w-3 h-3" />
          </button>
        </div>
      </div>
      {fullscreen && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex flex-col"
          data-testid="brain-fullscreen-overlay"
        >
          <div className="flex justify-between items-center p-3 text-blue-200 font-mono text-xs">
            <span className="tracking-widest">ULYSSE · BRAIN — FULLSCREEN</span>
            <button
              onClick={() => setFullscreen(false)}
              data-testid="button-brain-close-fullscreen"
              className="p-2 rounded bg-slate-900 border border-blue-700/50 hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 p-4">
            <ErrorBoundary
              fallback={
                <BrainUnavailableFallback
                  height={typeof window !== "undefined" ? window.innerHeight - 100 : 800}
                />
              }
            >
              <Suspense fallback={<div className="text-blue-400/60 font-mono text-sm">loading…</div>}>
                <UlysseBrainVisualizer height={typeof window !== "undefined" ? window.innerHeight - 100 : 800} />
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>
      )}
    </>
  );
}

interface MarseilleData {
  time: string;
  date: string;
  weather: {
    temperature: string;
    condition: string;
  };
}

interface TraceStats {
  totalTraces: number;
  agentStats: Array<{ agent: string; count: number; avgLatency: number; successRate: number }>;
  dailyVolume: Array<{ date: string; count: number }>;
}

interface CalendarEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
}

export function DashboardRightPanel() {
  const [, navigate] = useLocation();

  const { data: marseilleInfo } = useQuery<MarseilleData>({
    queryKey: ["/api/marseille-info"],
    refetchInterval: 60000,
  });

  const { data: traceStats } = useQuery<TraceStats>({
    queryKey: ["/api/traces/stats", { days: 7 }],
    refetchInterval: 120000,
  });

  const { data: calendarEvents } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/calendar/today"],
    refetchInterval: 300000,
  });

  const [time, setTime] = useState(() =>
    new Date().toLocaleTimeString("fr-FR", { hour12: false })
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date().toLocaleTimeString("fr-FR", { hour12: false }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const EVENT_COLORS = ["bg-blue-500", "bg-pink-500", "bg-amber-500", "bg-emerald-500", "bg-cyan-500", "bg-violet-500", "bg-rose-500", "bg-teal-500"];

  const agendaItems = calendarEvents && calendarEvents.length > 0
    ? calendarEvents.map((ev, i) => {
        const startStr = ev.start?.dateTime || ev.start?.date || "";
        const eventTime = startStr ? new Date(startStr).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "Journée";
        return { time: eventTime, label: ev.summary || "Événement", color: EVENT_COLORS[i % EVENT_COLORS.length] };
      })
    : [
        { time: "--:--", label: "Chargement agenda...", color: "bg-cyan-800" },
      ];

  const systems = [
    { name: "Ulysse", status: "ok" },
    { name: "DevMax", status: "ok" },
    { name: "AppToOrder", status: "warn" },
    { name: "Suguval", status: "ok" },
    { name: "Maillane", status: "ok" },
    { name: "Discord", status: "ok" },
  ];

  return (
    <aside className="w-72 shrink-0 flex flex-col gap-3 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
      <BrainPanel />
      <UlysseTodoPanel />
      <div className="border border-blue-200 dark:border-cyan-500/30 backdrop-blur-md rounded-xl p-3 flex flex-col bg-white dark:bg-[#00000000] shadow-sm dark:shadow-none">
        <h3 className="text-[10px] font-mono text-blue-500 dark:text-cyan-500/70 tracking-widest uppercase mb-2 flex items-center gap-2 pb-2 border-b border-blue-100 dark:border-cyan-900/40">
          <Calendar className="w-3 h-3" /> Agenda du jour
        </h3>
        <div className="flex flex-col gap-1.5">
          {agendaItems.slice(0, 6).map((item, i) => (
            <div
              key={i}
              onClick={() => navigate("/")}
              data-testid={`agenda-item-${i}`}
              className="flex items-center gap-2 p-1.5 rounded-lg bg-blue-50 dark:bg-cyan-950/20 border border-blue-100 dark:border-cyan-900/20 group hover:border-blue-300 dark:hover:border-cyan-500/30 transition-all cursor-pointer active:scale-[0.98]"
            >
              <div className={cn("w-1 h-8 rounded-full shrink-0", item.color)} />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-gray-700 dark:text-cyan-200 truncate">{item.label}</div>
                <div className="text-[9px] font-mono text-gray-400 dark:text-cyan-600">{item.time}</div>
              </div>
              <ChevronRight className="w-3 h-3 text-gray-300 dark:text-cyan-800 group-hover:text-blue-400 dark:group-hover:text-cyan-400 transition-colors shrink-0" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-3">
        <div
          onClick={() => navigate("/finances")}
          data-testid="widget-solde"
          className="flex-1 border border-blue-200 dark:border-cyan-500/30 backdrop-blur-md rounded-xl p-3 cursor-pointer hover:border-blue-300 dark:hover:border-cyan-400/50 transition-all active:scale-[0.98] bg-white dark:bg-[#00000000] shadow-sm dark:shadow-none"
        >
          <h3 className="text-[10px] font-mono text-blue-500 dark:text-cyan-500/70 tracking-widest uppercase mb-2 flex items-center gap-1">
            <CreditCard className="w-3 h-3" /> Solde
          </h3>
          <div className="text-lg font-bold text-gray-800 dark:text-cyan-200 tracking-wide">--,-- EUR</div>
          <div className="flex items-center gap-1 mt-1">
            <TrendingUp className="w-3 h-3 text-emerald-500 dark:text-emerald-400" />
            <span className="text-[10px] font-mono text-emerald-500 dark:text-emerald-400">ce mois</span>
          </div>
        </div>
        <div
          onClick={() => navigate("/sports/predictions")}
          data-testid="widget-pronos"
          className="flex-1 border border-blue-200 dark:border-cyan-500/30 bg-white dark:bg-black/40 backdrop-blur-md rounded-xl p-3 cursor-pointer hover:border-blue-300 dark:hover:border-cyan-400/50 transition-all active:scale-[0.98] shadow-sm dark:shadow-none"
        >
          <h3 className="text-[10px] font-mono text-blue-500 dark:text-cyan-500/70 tracking-widest uppercase mb-2 flex items-center gap-1">
            <Trophy className="w-3 h-3" /> Pronos
          </h3>
          <div className="text-[11px] text-gray-700 dark:text-cyan-200 font-medium">Match du jour</div>
          <div className="text-[10px] text-gray-400 dark:text-cyan-500 font-mono">--</div>
          <div className="flex items-center gap-1 mt-1">
            <div className="flex-1 h-1 bg-blue-100 dark:bg-cyan-900/50 rounded-full overflow-hidden">
              <div className="h-full bg-blue-400 dark:bg-cyan-400 rounded-full" style={{ width: "0%" }} />
            </div>
            <span className="text-[9px] font-mono text-gray-400 dark:text-cyan-500">--%</span>
          </div>
        </div>
      </div>
      <div
        onClick={() => navigate("/diagnostics")}
        data-testid="widget-systemes"
        className="border border-blue-200 dark:border-cyan-500/30 bg-white dark:bg-black/40 backdrop-blur-md rounded-xl p-3 flex flex-col cursor-pointer hover:border-blue-300 dark:hover:border-cyan-400/50 transition-all active:scale-[0.98] shadow-sm dark:shadow-none"
      >
        <h3 className="text-[10px] font-mono text-blue-500 dark:text-cyan-500/70 tracking-widest uppercase mb-2 flex items-center justify-between pb-2 border-b border-blue-100 dark:border-cyan-900/40">
          <span className="flex items-center gap-2"><Activity className="w-3 h-3" /> Systemes</span>
          <span className="text-emerald-500 dark:text-emerald-400 text-[9px]">{systems.filter(s => s.status === "ok").length}/{systems.length} OK</span>
        </h3>
        <div className="grid grid-cols-3 gap-1.5">
          {systems.map((sys, i) => (
            <div key={i} className="flex items-center gap-1 p-1 rounded bg-blue-50 dark:bg-cyan-950/20">
              <div className={cn(
                "w-1.5 h-1.5 rounded-full shrink-0",
                sys.status === "ok" && "bg-emerald-500 dark:bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.5)]",
                sys.status === "warn" && "bg-amber-500 dark:bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.5)] animate-pulse",
                sys.status === "down" && "bg-red-500 dark:bg-red-400 shadow-[0_0_4px_rgba(248,113,113,0.5)] animate-pulse",
              )} />
              <span className={cn(
                "text-[9px] font-mono truncate",
                sys.status === "ok" && "text-gray-600 dark:text-cyan-500",
                sys.status === "warn" && "text-amber-600 dark:text-amber-400",
                sys.status === "down" && "text-red-600 dark:text-red-400",
              )}>{sys.name}</span>
            </div>
          ))}
        </div>
      </div>
      {traceStats && (traceStats.totalTraces > 0 || (traceStats.agentStats && traceStats.agentStats.length > 0)) && (
        <div
          onClick={() => navigate("/traces")}
          data-testid="widget-traces"
          className="border border-blue-200 dark:border-cyan-500/30 bg-white dark:bg-black/40 backdrop-blur-md rounded-xl p-3 flex flex-col cursor-pointer hover:border-blue-300 dark:hover:border-cyan-400/50 transition-all active:scale-[0.98] shadow-sm dark:shadow-none"
        >
          <h3 className="text-[10px] font-mono text-blue-500 dark:text-cyan-500/70 tracking-widest uppercase mb-2 flex items-center justify-between pb-2 border-b border-blue-100 dark:border-cyan-900/40">
            <span className="flex items-center gap-2"><Zap className="w-3 h-3" /> Traces (7j)</span>
            <span className="text-blue-600 dark:text-cyan-400 text-[9px] font-bold">{traceStats.totalTraces}</span>
          </h3>
          <div className="flex flex-col gap-1.5">
            {(traceStats.agentStats || []).slice(0, 5).map((ag, i) => (
              <div key={i} className="flex items-center gap-2 p-1 rounded bg-blue-50 dark:bg-cyan-950/20">
                <div className={cn(
                  "w-1.5 h-1.5 rounded-full shrink-0",
                  ag.successRate >= 90 ? "bg-emerald-500 dark:bg-emerald-400" : ag.successRate >= 70 ? "bg-amber-500 dark:bg-amber-400" : "bg-red-500 dark:bg-red-400"
                )} />
                <span className="text-[9px] font-mono text-gray-600 dark:text-cyan-300 flex-1 truncate capitalize">{ag.agent}</span>
                <span className="text-[8px] font-mono text-gray-400 dark:text-cyan-600">{ag.count}x</span>
                <span className="text-[8px] font-mono text-gray-500 dark:text-cyan-500">{ag.avgLatency ? `${Math.round(ag.avgLatency / 1000)}s` : "--"}</span>
                <span className={cn(
                  "text-[8px] font-mono font-bold",
                  ag.successRate >= 90 ? "text-emerald-500 dark:text-emerald-400" : ag.successRate >= 70 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"
                )}>{ag.successRate}%</span>
              </div>
            ))}
          </div>
          {traceStats.dailyVolume && traceStats.dailyVolume.length > 1 && (
            <div className="mt-2 flex items-end gap-[2px] h-6">
              {traceStats.dailyVolume.slice(-7).map((d, i) => {
                const max = Math.max(...traceStats.dailyVolume!.slice(-7).map(v => v.count), 1);
                const h = Math.max((d.count / max) * 100, 8);
                return (
                  <div
                    key={i}
                    className="flex-1 bg-blue-200 dark:bg-cyan-500/40 rounded-t-sm hover:bg-blue-300 dark:hover:bg-cyan-400/60 transition-colors"
                    style={{ height: `${h}%` }}
                    title={`${d.date}: ${d.count} traces`}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
