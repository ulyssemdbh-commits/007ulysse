import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Rocket, GitCommit, Play, HeartPulse, Terminal,
  CheckCircle, XCircle, Loader2, Zap, Activity,
  Shield, Server, GitBranch, Search, Wrench,
  Clock, ChevronDown, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDevmaxAuth, API, devmaxFetch } from "@/pages/devmax/types";

interface LiveActivity {
  id: string;
  persona: string;
  toolName: string;
  label: string;
  status: "running" | "done" | "error";
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  error?: string;
}

interface DgmTask {
  id: number;
  title: string;
  status: string;
  pipeline_stage: string;
  risk_level?: string;
}

interface LiveData {
  running: LiveActivity[];
  recent: LiveActivity[];
  dgmSession: { id: number; objective: string; total_tasks: number; completed_tasks: number } | null;
  dgmTasks: DgmTask[];
}

const TOOL_ICONS: Record<string, typeof Zap> = {
  devops_github: GitBranch,
  devops_server: Server,
  dgm_manage: Activity,
  security_scan: Shield,
  devmax_db: Server,
  url_diagnose: Search,
  url_diagnose_all: Search,
  deploy: Rocket,
};

function toolIcon(toolName: string) {
  const Icon = TOOL_ICONS[toolName] || Wrench;
  return <Icon className="w-3 h-3 shrink-0" />;
}

function personaColor(p: string) {
  switch (p) {
    case "max": case "maxai": return "text-violet-400";
    case "iris": return "text-cyan-400";
    case "alfred": return "text-amber-400";
    default: return "text-cyan-400";
  }
}

function personaLabel(p: string) {
  switch (p) {
    case "max": case "maxai": return "MaxAI";
    case "iris": return "Iris";
    case "alfred": return "Alfred";
    default: return "Ulysse";
  }
}

function elapsedStr(startedAt: number) {
  const s = Math.floor((Date.now() - startedAt) / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}

function durationStr(ms?: number) {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function dgmStageIcon(stage: string) {
  switch (stage) {
    case "preflight": return <Search className="w-2.5 h-2.5 text-blue-400" />;
    case "build": return <Wrench className="w-2.5 h-2.5 text-amber-400" />;
    case "test": return <Activity className="w-2.5 h-2.5 text-cyan-400" />;
    case "security": return <Shield className="w-2.5 h-2.5 text-red-400" />;
    case "deploy": return <Rocket className="w-2.5 h-2.5 text-green-400" />;
    case "health": return <HeartPulse className="w-2.5 h-2.5 text-green-400" />;
    default: return <Clock className="w-2.5 h-2.5 text-zinc-500" />;
  }
}

function dgmStatusDot(status: string) {
  if (status === "completed" || status === "success") return "bg-cyan-400 shadow-[0_0_4px_rgba(0,212,255,0.6)]";
  if (status === "running") return "bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.6)] animate-pulse";
  if (status === "failed" || status === "error") return "bg-red-400 shadow-[0_0_4px_rgba(248,113,113,0.6)]";
  return "bg-zinc-600";
}

function CollapsibleCard({ title, icon: Icon, children, defaultOpen = true, badge, accentBorder }: {
  title: string;
  icon: typeof Rocket;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
  accentBorder?: string;
}) {
  const storageKey = `devmax-card-${title.replace(/\s/g, "-").toLowerCase()}`;
  const [open, setOpen] = useState(() => {
    const saved = localStorage.getItem(storageKey);
    return saved !== null ? saved === "true" : defaultOpen;
  });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    localStorage.setItem(storageKey, String(next));
  };

  return (
    <div className={cn("border bg-black/40 backdrop-blur-md rounded-xl transition-all", accentBorder || "border-cyan-500/20")}>
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between p-3 cursor-pointer group"
        data-testid={`card-toggle-${title.replace(/\s/g, "-").toLowerCase()}`}
      >
        <span className="text-[10px] font-mono text-cyan-500/70 tracking-widest uppercase flex items-center gap-2">
          <Icon className="w-3 h-3" /> {title}
        </span>
        <span className="flex items-center gap-2">
          {badge}
          {open
            ? <ChevronDown className="w-3 h-3 text-cyan-600 group-hover:text-cyan-400 transition-colors" />
            : <ChevronRight className="w-3 h-3 text-cyan-600 group-hover:text-cyan-400 transition-colors" />
          }
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 border-t border-cyan-900/40">
          {children}
        </div>
      )}
    </div>
  );
}

export function DevMaxRightPanel() {
  const { activeProject } = useDevmaxAuth();
  const pid = activeProject?.id || "";

  const { data: headerDeploys } = useQuery<{ deployments: any[] }>({
    queryKey: [API, "deployments", "right-panel", pid],
    queryFn: () => devmaxFetch(`${API}/deployments?limit=5`, undefined, pid).then(r => r.json()),
    enabled: !!pid,
    refetchInterval: 30000,
  });

  const { data: commits } = useQuery<any[]>({
    queryKey: [API, "commits", "right-panel", pid],
    queryFn: () => devmaxFetch(`${API}/commits?limit=5`, undefined, pid).then(r => r.json()).then(d => Array.isArray(d) ? d : []),
    enabled: !!pid && !!activeProject?.repo_owner,
    refetchInterval: 30000,
  });

  const { data: runs } = useQuery<{ workflow_runs: any[] }>({
    queryKey: [API, "actions", "runs", "right-panel", pid],
    queryFn: () => devmaxFetch(`${API}/actions/runs?limit=3`, undefined, pid).then(r => r.json()).then(d => d?.workflow_runs ? d : { workflow_runs: [] }),
    enabled: !!pid && !!activeProject?.repo_owner,
    refetchInterval: 30000,
  });

  const appName = activeProject?.name || "";
  const { data: healthData } = useQuery<any[]>({
    queryKey: [API, "health-checks", "right-panel", appName],
    queryFn: () => devmaxFetch(`${API}/health-checks/${encodeURIComponent(appName)}`).then(r => r.json()).then(d => Array.isArray(d) ? d : []).catch(() => []),
    enabled: !!appName,
    refetchInterval: 60000,
  });

  const { data: liveData } = useQuery<LiveData>({
    queryKey: [API, "activity", "live", pid],
    queryFn: () => devmaxFetch(`${API}/activity/live`, undefined, pid).then(r => r.json()),
    enabled: !!pid,
    refetchInterval: 3000,
  });

  const deploys = headerDeploys?.deployments || [];
  const recentCommits = (commits || []).slice(0, 5);
  const ciRuns = (runs?.workflow_runs || []).slice(0, 3);
  const healthChecks = healthData || [];
  const healthyCount = healthChecks.filter((h: any) => h.healthy || h.status === 200).length;

  const runningActions = liveData?.running || [];
  const recentActions = liveData?.recent || [];
  const dgmSession = liveData?.dgmSession;
  const dgmTasks = liveData?.dgmTasks || [];
  const hasLiveActivity = runningActions.length > 0 || recentActions.length > 0 || dgmTasks.length > 0;

  return (
    <aside className="w-72 shrink-0 flex flex-col gap-3 overflow-y-auto no-scrollbar" data-testid="devmax-right-panel">
      <CollapsibleCard title="Derniers Deploys" icon={Rocket}>
        <div className="flex flex-col gap-1.5 mt-2">
          {deploys.length === 0 && (
            <p className="text-[10px] text-cyan-700 font-mono">Aucun deploy</p>
          )}
          {deploys.slice(0, 4).map((d: any, i: number) => (
            <div key={i} className="flex items-center gap-2 p-1.5 rounded-lg bg-cyan-950/20 border border-cyan-900/20 hover:border-cyan-500/20 transition-all cursor-pointer group">
              <div className="shrink-0">
                {d.status === "success" && <CheckCircle className="w-3.5 h-3.5 text-cyan-400" />}
                {d.status === "failed" && <XCircle className="w-3.5 h-3.5 text-red-400" />}
                {(d.status === "pending" || d.status === "in_progress") && <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />}
                {!["success", "failed", "pending", "in_progress"].includes(d.status) && <CheckCircle className="w-3.5 h-3.5 text-cyan-600" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-cyan-200 truncate">{d.description || d.environment || "Deploy"}</div>
                <div className="flex items-center gap-2 text-[9px] font-mono text-cyan-600">
                  <span>{d.sha?.slice(0, 7) || "..."}</span>
                  <span>{d.ref || "main"}</span>
                  <span>{d.created_at ? new Date(d.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : ""}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CollapsibleCard>

      <CollapsibleCard title="Commits Recents" icon={GitCommit}>
        <div className="flex flex-col gap-1.5 mt-2">
          {recentCommits.length === 0 && (
            <p className="text-[10px] text-cyan-700 font-mono">Aucun commit</p>
          )}
          {recentCommits.map((c: any, i: number) => (
            <div key={i} className="flex items-center gap-2 p-1.5 rounded-lg bg-cyan-950/20 border border-cyan-900/20">
              <span className="text-[10px] font-mono text-cyan-500 shrink-0">{(c.sha || c.hash || "").slice(0, 7)}</span>
              <span className="text-[11px] text-cyan-200 truncate flex-1">{c.commit?.message?.split("\n")[0] || c.message || ""}</span>
              <span className="text-[9px] font-mono text-cyan-700 shrink-0">{c.commit?.author?.date ? new Date(c.commit.author.date).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : ""}</span>
            </div>
          ))}
        </div>
      </CollapsibleCard>

      <CollapsibleCard title="Pipeline CI/CD" icon={Play}>
        <div className="flex flex-col gap-1.5 mt-2">
          {ciRuns.length === 0 && (
            <p className="text-[10px] text-cyan-700 font-mono">Aucun run</p>
          )}
          {ciRuns.map((run: any, i: number) => (
            <div key={i} className="flex items-center justify-between p-1.5 rounded-lg bg-cyan-950/20 border border-cyan-900/20">
              <div className="flex items-center gap-2">
                {run.conclusion === "success" && <CheckCircle className="w-3 h-3 text-cyan-400" />}
                {run.conclusion === "failure" && <XCircle className="w-3 h-3 text-red-400" />}
                {run.status === "in_progress" && <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />}
                {!run.conclusion && run.status !== "in_progress" && <CheckCircle className="w-3 h-3 text-cyan-600" />}
                <span className="text-[11px] text-cyan-200 truncate max-w-[120px]">{run.name || "Workflow"}</span>
              </div>
              <span className="text-[9px] font-mono text-cyan-600">{run.created_at ? new Date(run.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : ""}</span>
            </div>
          ))}
        </div>
      </CollapsibleCard>

      {healthChecks.length > 0 && (
        <CollapsibleCard
          title="Health Checks"
          icon={HeartPulse}
          badge={
            <span className={cn("font-bold text-[10px]", healthyCount < healthChecks.length ? "text-red-400" : "text-cyan-400")}>
              {healthyCount}/{healthChecks.length} UP
            </span>
          }
        >
          <div className="flex flex-col gap-1 mt-2">
            {healthChecks.slice(0, 6).map((h: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-1 rounded bg-cyan-950/20">
                <div className="flex items-center gap-1.5">
                  <div className={cn(
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    (h.healthy || h.status === 200) ? "bg-cyan-400 shadow-[0_0_4px_rgba(0,212,255,0.5)]" : "bg-red-400 shadow-[0_0_4px_rgba(248,113,113,0.5)] animate-pulse"
                  )} />
                  <span className={cn("text-[9px] font-mono truncate max-w-[140px]", (h.healthy || h.status === 200) ? "text-cyan-500" : "text-red-400")}>{h.url || h.name || "check"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn("text-[9px] font-mono", (h.healthy || h.status === 200) ? "text-cyan-600" : "text-red-500")}>{h.latency || "-"}</span>
                  <span className={cn(
                    "text-[8px] font-mono px-1 py-0.5 rounded",
                    (h.healthy || h.status === 200) ? "bg-cyan-900/40 text-cyan-400" : "bg-red-900/40 text-red-400"
                  )}>{h.status || "?"}</span>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleCard>
      )}

      <CollapsibleCard
        title="Projet Actif"
        icon={Terminal}
        accentBorder={runningActions.length > 0 ? "border-violet-500/40 ring-1 ring-violet-500/20" : undefined}
        badge={runningActions.length > 0 ? (
          <span className="flex items-center gap-1 text-[9px] text-violet-400 font-mono">
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
            {runningActions.length} en cours
          </span>
        ) : undefined}
      >
        <div className="mt-2">
          <div className="flex items-center gap-2 p-2 rounded-lg bg-cyan-950/30 border border-cyan-500/20 mb-2" data-testid="projet-actif-card">
            <div className={cn(
              "w-2 h-2 rounded-full shrink-0",
              runningActions.length > 0
                ? "bg-violet-400 shadow-[0_0_6px_rgba(167,139,250,0.6)] animate-pulse"
                : "bg-cyan-400 shadow-[0_0_4px_rgba(0,212,255,0.5)]"
            )} />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-mono text-cyan-300">{activeProject?.name || "—"}</div>
              <div className="text-[9px] font-mono text-cyan-600 truncate">
                {activeProject?.repo_owner && activeProject?.repo_name
                  ? `${activeProject.repo_owner}/${activeProject.repo_name}`
                  : "Pas de repo"}
              </div>
            </div>
          </div>

          {dgmSession && dgmTasks.length > 0 && (
            <div className="mb-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[9px] font-mono text-violet-400 uppercase tracking-wider flex items-center gap-1">
                  <Zap className="w-2.5 h-2.5" /> Sprint DGM
                </span>
                <span className="text-[9px] font-mono text-cyan-500">
                  {dgmSession.completed_tasks}/{dgmSession.total_tasks}
                </span>
              </div>
              {dgmSession.total_tasks > 0 && (
                <div className="h-1 bg-zinc-800 rounded-full overflow-hidden mb-1.5">
                  <div
                    className="h-full bg-gradient-to-r from-violet-500 to-cyan-500 rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(2, (dgmSession.completed_tasks / dgmSession.total_tasks) * 100)}%` }}
                  />
                </div>
              )}
              <div className="space-y-0.5 max-h-[140px] overflow-y-auto no-scrollbar">
                {dgmTasks.map((t) => (
                  <div key={t.id} className="flex items-center gap-1.5 py-0.5 px-1 rounded" data-testid={`dgm-sidebar-task-${t.id}`}>
                    <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", dgmStatusDot(t.status))} />
                    {dgmStageIcon(t.pipeline_stage)}
                    <span className={cn(
                      "text-[9px] truncate flex-1",
                      t.status === "running" ? "text-amber-300 font-medium" :
                      t.status === "completed" || t.status === "success" ? "text-cyan-500" :
                      t.status === "failed" || t.status === "error" ? "text-red-400" :
                      "text-zinc-500"
                    )}>
                      {t.title}
                    </span>
                    {t.status === "running" && <Loader2 className="w-2.5 h-2.5 animate-spin text-amber-400 shrink-0" />}
                  </div>
                ))}
              </div>
            </div>
          )}

          {runningActions.length > 0 && (
            <div className="mb-2">
              <div className="text-[9px] font-mono text-violet-400/70 uppercase tracking-wider mb-1 flex items-center gap-1">
                <Activity className="w-2.5 h-2.5" /> En cours
              </div>
              <div className="space-y-1">
                {runningActions.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center gap-1.5 p-1.5 rounded-lg bg-violet-950/30 border border-violet-500/20 animate-in fade-in"
                    data-testid={`live-action-${a.id}`}
                  >
                    <Loader2 className="w-3 h-3 animate-spin text-violet-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span className={cn("text-[8px] font-mono font-bold", personaColor(a.persona))}>
                          {personaLabel(a.persona)}
                        </span>
                        {toolIcon(a.toolName)}
                      </div>
                      <div className="text-[9px] text-violet-200 truncate">{a.label}</div>
                    </div>
                    <span className="text-[8px] font-mono text-violet-500 shrink-0">{elapsedStr(a.startedAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {recentActions.length > 0 && (
            <div>
              <div className="text-[9px] font-mono text-cyan-700 uppercase tracking-wider mb-1 flex items-center gap-1">
                <Clock className="w-2.5 h-2.5" /> Recent
              </div>
              <div className="space-y-0.5 max-h-[120px] overflow-y-auto no-scrollbar">
                {recentActions.filter(a => a.status !== "running").slice(0, 8).map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center gap-1.5 py-0.5 px-1 rounded hover:bg-cyan-950/20 transition-colors"
                    data-testid={`recent-action-${a.id}`}
                  >
                    {a.status === "done"
                      ? <CheckCircle className="w-2.5 h-2.5 text-cyan-500 shrink-0" />
                      : <XCircle className="w-2.5 h-2.5 text-red-400 shrink-0" />
                    }
                    <span className={cn("text-[8px] font-mono", personaColor(a.persona))}>
                      {personaLabel(a.persona)}
                    </span>
                    <span className="text-[9px] text-zinc-400 truncate flex-1">{a.label}</span>
                    {a.durationMs && (
                      <span className="text-[8px] font-mono text-zinc-600 shrink-0">{durationStr(a.durationMs)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!hasLiveActivity && (
            <p className="text-[9px] text-cyan-800 font-mono text-center py-1">En attente d'actions...</p>
          )}
        </div>
      </CollapsibleCard>
    </aside>
  );
}
