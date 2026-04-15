import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Zap, Play, Clock, CheckCircle, XCircle, ChevronRight, Loader2,
  Activity, Bot, Cog, MessageSquare, BookOpen, Globe, ThumbsUp,
  ThumbsDown, Wrench, BarChart3, Cpu, TrendingUp, Search, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Trace {
  id: number;
  traceId: string;
  agent: string;
  model: string;
  query: string;
  response: string | null;
  status: string;
  totalLatencyMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  toolsUsed: string[];
  toolCallCount: number;
  userFeedback: string | null;
  feedbackScore: number | null;
  domain: string | null;
  source: string | null;
  startedAt: string;
  completedAt: string | null;
}

interface TraceDetail extends Trace {
  steps: Array<{
    id: number;
    stepType: string;
    name: string;
    input: any;
    output: any;
    latencyMs: number | null;
    tokensUsed: number | null;
    status: string;
    errorMessage: string | null;
  }>;
}

interface Stats {
  totalTraces: number;
  agentStats: Array<{ agent: string; count: number; avgLatency: number; avgTokens: number; successRate: number; avgFeedback: number | null }>;
  modelStats: Array<{ model: string; count: number; avgLatency: number; avgTokens: number }>;
  topTools: Array<{ tool: string; count: number }>;
  dailyVolume: Array<{ date: string; count: number; avgLatency: number }>;
}

const AGENT_COLORS: Record<string, string> = {
  ulysse: "text-blue-400",
  iris: "text-pink-400",
  alfred: "text-amber-400",
  maxai: "text-cyan-400",
  system: "text-slate-400",
};

const SOURCE_LABELS: Record<string, string> = {
  superchat: "SuperChat",
  core_conversation: "Chat",
  homework_auto: "Devoir auto",
  homework_manual: "Devoir manuel",
  homework_daily: "Devoir daily",
  skill_engine: "Skill",
};

function fmtMs(ms: number | null) {
  if (!ms) return "-";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function fmtTokens(t: number | null) {
  if (!t) return "-";
  return t > 1000 ? `${(t / 1000).toFixed(1)}k` : `${t}`;
}

function timeAgoShort(date: string) {
  const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function StatusDot({ status }: { status: string }) {
  const color = status === "completed" ? "bg-emerald-400" : status === "error" || status === "failed" ? "bg-red-400" : "bg-amber-400";
  return <div className={cn("w-2 h-2 rounded-full shrink-0", color, status === "running" && "animate-pulse")} />;
}

export function DevmaxTracesPanel() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState("all");

  const { data: tracesData, isLoading } = useQuery<{ traces: Trace[]; total: number }>({
    queryKey: ["/api/traces", agentFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "50" });
      if (agentFilter !== "all") params.set("agent", agentFilter);
      const res = await fetch(`/api/traces?${params}`, { credentials: "include" });
      if (!res.ok) return { traces: [], total: 0 };
      const d = await res.json();
      return { traces: Array.isArray(d?.traces) ? d.traces : [], total: d?.total || 0 };
    },
    refetchInterval: 30000,
  });

  const { data: stats } = useQuery<Stats>({
    queryKey: ["/api/traces/stats", 7],
    queryFn: async () => {
      const res = await fetch("/api/traces/stats?days=7", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const { data: detail } = useQuery<TraceDetail>({
    queryKey: ["/api/traces", selectedId],
    queryFn: async () => {
      const res = await fetch(`/api/traces/${selectedId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!selectedId,
  });

  const traces = Array.isArray(tracesData?.traces) ? tracesData.traces : [];
  const agents = ["all", "ulysse", "iris", "alfred", "maxai", "system"];

  if (selectedId && detail) {
    return (
      <div className="p-4 space-y-4 h-full overflow-y-auto" data-testid="devmax-trace-detail">
        <div className="flex items-center gap-3">
          <Button size="sm" variant="ghost" onClick={() => setSelectedId(null)} className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10" data-testid="button-back-traces">
            <ChevronRight className="w-4 h-4 rotate-180 mr-1" /> Retour
          </Button>
          <span className="font-mono text-xs text-cyan-600">{detail.traceId.slice(0, 12)}...</span>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Agent", value: detail.agent, color: AGENT_COLORS[detail.agent] || "text-cyan-400" },
            { label: "Latence", value: fmtMs(detail.totalLatencyMs), color: "text-emerald-400" },
            { label: "Tokens", value: fmtTokens(detail.totalTokens), color: "text-amber-400" },
            { label: "Status", value: detail.status, color: detail.status === "completed" ? "text-emerald-400" : "text-red-400" },
          ].map(s => (
            <div key={s.label} className="bg-black/40 border border-cyan-900/30 rounded-lg p-2 text-center">
              <div className="text-[9px] text-cyan-600 uppercase tracking-wider">{s.label}</div>
              <div className={cn("text-sm font-bold font-mono", s.color)}>{s.value}</div>
            </div>
          ))}
        </div>

        <div className="bg-black/40 border border-cyan-900/30 rounded-lg p-3">
          <div className="text-[10px] text-cyan-600 uppercase tracking-wider mb-1">Query</div>
          <div className="text-xs text-cyan-100 font-mono leading-relaxed">{detail.query}</div>
        </div>

        {detail.response && (
          <div className="bg-black/40 border border-cyan-900/30 rounded-lg p-3">
            <div className="text-[10px] text-cyan-600 uppercase tracking-wider mb-1">Response</div>
            <div className="text-xs text-cyan-200/80 leading-relaxed max-h-32 overflow-y-auto">{detail.response.slice(0, 500)}</div>
          </div>
        )}

        {Array.isArray(detail.steps) && detail.steps.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] text-cyan-600 uppercase tracking-wider">Steps ({detail.steps.length})</div>
            {detail.steps.map((step, i) => (
              <div key={step.id} className="bg-black/40 border border-cyan-900/30 rounded-lg p-2 flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-[9px] font-bold text-cyan-400 shrink-0">{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono text-cyan-300 truncate">{step.name}</div>
                  <div className="text-[10px] text-cyan-600">{step.stepType} · {fmtMs(step.latencyMs)}</div>
                </div>
                <StatusDot status={step.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 h-full flex flex-col" data-testid="devmax-traces-panel">
      {stats && (
        <div className="grid grid-cols-4 gap-2 shrink-0">
          {[
            { label: "Total (7j)", value: stats.totalTraces, icon: Activity, color: "text-cyan-400" },
            { label: "Agents", value: stats.agentStats?.length || 0, icon: Bot, color: "text-blue-400" },
            { label: "Top Tool", value: stats.topTools?.[0]?.tool?.split("_").pop() || "-", icon: Wrench, color: "text-amber-400" },
            { label: "Success", value: stats.agentStats?.length ? `${Math.round(stats.agentStats.reduce((a, s) => a + s.successRate, 0) / stats.agentStats.length)}%` : "-", icon: TrendingUp, color: "text-emerald-400" },
          ].map(s => (
            <div key={s.label} className="bg-black/40 border border-cyan-900/30 rounded-lg p-2 text-center">
              <s.icon className={cn("w-3.5 h-3.5 mx-auto mb-1", s.color)} />
              <div className={cn("text-sm font-bold font-mono", s.color)}>{s.value}</div>
              <div className="text-[8px] text-cyan-600 uppercase tracking-wider">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1 shrink-0 flex-wrap">
        {agents.map(a => (
          <button key={a} onClick={() => setAgentFilter(a)} data-testid={`filter-agent-${a}`}
            className={cn("px-2 py-0.5 rounded-md text-[10px] font-mono uppercase tracking-wider border transition-all",
              agentFilter === a ? "border-cyan-500/50 bg-cyan-500/20 text-cyan-300" : "border-cyan-900/30 text-cyan-600 hover:text-cyan-400 hover:border-cyan-700/40"
            )}>
            {a}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 text-cyan-500 animate-spin" /></div>
        ) : traces.length === 0 ? (
          <div className="text-center py-8 text-cyan-600 text-xs">Aucune trace</div>
        ) : (
          traces.map(t => (
            <button key={t.traceId} onClick={() => setSelectedId(t.traceId)} data-testid={`trace-row-${t.traceId}`}
              className="w-full text-left bg-black/30 border border-cyan-900/20 rounded-lg p-2.5 hover:border-cyan-500/40 hover:bg-cyan-950/20 transition-all group">
              <div className="flex items-center gap-2 mb-1">
                <StatusDot status={t.status} />
                <span className={cn("text-xs font-bold font-mono uppercase", AGENT_COLORS[t.agent] || "text-cyan-400")}>{t.agent}</span>
                <span className="text-[9px] text-cyan-700 font-mono">{t.source ? SOURCE_LABELS[t.source] || t.source : ""}</span>
                <span className="ml-auto text-[9px] text-cyan-700 font-mono">{timeAgoShort(t.startedAt)}</span>
              </div>
              <div className="text-[11px] text-cyan-200/80 truncate">{t.query}</div>
              <div className="flex items-center gap-3 mt-1 text-[9px] text-cyan-600 font-mono">
                <span>{fmtMs(t.totalLatencyMs)}</span>
                <span>{fmtTokens(t.totalTokens)} tok</span>
                <span>{t.toolCallCount} tools</span>
                {t.feedbackScore !== null && (
                  <span className={t.feedbackScore > 0 ? "text-emerald-400" : "text-red-400"}>
                    {t.feedbackScore > 0 ? "👍" : "👎"}
                  </span>
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

interface Skill {
  id: number;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  pipeline: any[];
  triggerPatterns: string[];
  authorizedAgents: string[];
}

interface SkillExecution {
  id: number;
  skillId: number;
  status: string;
  triggeredBy: string;
  startedAt: string;
  completedAt: string | null;
  result: any;
  stepsCompleted: number;
  totalSteps: number;
  errorMessage: string | null;
  skillName?: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  finance: "text-emerald-400",
  productivity: "text-blue-400",
  devops: "text-orange-400",
  communication: "text-violet-400",
  research: "text-cyan-400",
};

export function DevmaxSkillsPanel() {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tab, setTab] = useState<"catalog" | "executions">("catalog");

  const { data: skillsRaw, isLoading } = useQuery<Skill[]>({
    queryKey: ["/api/skills"],
    queryFn: async () => {
      const res = await fetch("/api/skills", { credentials: "include" });
      if (!res.ok) return [];
      const d = await res.json();
      return Array.isArray(d) ? d : [];
    },
    refetchInterval: 30000,
  });
  const skills = Array.isArray(skillsRaw) ? skillsRaw : [];

  const { data: executionsRaw } = useQuery<SkillExecution[]>({
    queryKey: ["/api/skills/executions/all"],
    queryFn: async () => {
      const res = await fetch("/api/skills/executions/all", { credentials: "include" });
      if (!res.ok) return [];
      const d = await res.json();
      return Array.isArray(d) ? d : [];
    },
    refetchInterval: 15000,
  });
  const executions = Array.isArray(executionsRaw) ? executionsRaw : [];

  const { data: detail } = useQuery<Skill>({
    queryKey: ["/api/skills", selectedId],
    queryFn: async () => {
      const res = await fetch(`/api/skills/${selectedId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!selectedId,
  });

  const executeMutation = useMutation({
    mutationFn: async (skillId: number) => {
      const res = await apiRequest("POST", `/api/skills/${skillId}/execute`, { agent: "system" });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Skill lancée" });
      queryClient.invalidateQueries({ queryKey: ["/api/skills"] });
    },
    onError: () => toast({ title: "Erreur d'exécution", variant: "destructive" }),
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/skills/seed");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: `${data?.seeded || 0} skills initialisées` });
      queryClient.invalidateQueries({ queryKey: ["/api/skills"] });
    },
    onError: (err: any) => {
      toast({ title: "Erreur initialisation skills", description: err?.message || "Erreur inconnue", variant: "destructive" });
    },
  });

  if (selectedId && detail) {
    return (
      <div className="p-4 space-y-4 h-full overflow-y-auto" data-testid="devmax-skill-detail">
        <div className="flex items-center gap-3">
          <Button size="sm" variant="ghost" onClick={() => setSelectedId(null)} className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10" data-testid="button-back-skills">
            <ChevronRight className="w-4 h-4 rotate-180 mr-1" /> Retour
          </Button>
          <Badge className="bg-cyan-500/20 text-cyan-300 border-cyan-500/30">{detail.category}</Badge>
          {detail.enabled && <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.5)]" />}
        </div>

        <div className="bg-black/40 border border-cyan-900/30 rounded-lg p-3">
          <div className="text-sm font-bold text-cyan-200 mb-1">{detail.name}</div>
          <div className="text-xs text-cyan-400/70">{detail.description}</div>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => executeMutation.mutate(detail.id)} disabled={executeMutation.isPending}
            className="bg-cyan-600 hover:bg-cyan-500 text-white text-xs" data-testid="button-run-skill">
            {executeMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Play className="w-3 h-3 mr-1" />}
            Exécuter
          </Button>
          <div className="text-[10px] text-cyan-600 font-mono">
            {detail.authorizedAgents?.join(", ") || "all agents"}
          </div>
        </div>

        {detail.pipeline && detail.pipeline.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] text-cyan-600 uppercase tracking-wider">Pipeline ({detail.pipeline.length} steps)</div>
            {detail.pipeline.map((step: any, i: number) => (
              <div key={i} className="bg-black/40 border border-cyan-900/30 rounded-lg p-2 flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-[9px] font-bold text-cyan-400 shrink-0">{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono text-cyan-300">{step.name || step.tool}</div>
                  <div className="text-[10px] text-cyan-600">{step.tool} → {step.outputKey || "result"}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {detail.triggerPatterns && detail.triggerPatterns.length > 0 && (
          <div className="bg-black/40 border border-cyan-900/30 rounded-lg p-3">
            <div className="text-[10px] text-cyan-600 uppercase tracking-wider mb-1">Triggers</div>
            <div className="flex flex-wrap gap-1">
              {detail.triggerPatterns.map((t, i) => (
                <span key={i} className="px-1.5 py-0.5 rounded bg-cyan-500/10 text-[10px] text-cyan-400 font-mono border border-cyan-900/30">{t}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 h-full flex flex-col" data-testid="devmax-skills-panel">
      <div className="flex items-center gap-2 shrink-0">
        {(["catalog", "executions"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} data-testid={`skills-tab-${t}`}
            className={cn("px-3 py-1 rounded-lg text-xs font-mono uppercase tracking-wider border transition-all",
              tab === t ? "border-cyan-500/50 bg-cyan-500/20 text-cyan-300" : "border-cyan-900/30 text-cyan-600 hover:text-cyan-400"
            )}>
            {t === "catalog" ? "Catalogue" : "Exécutions"}
          </button>
        ))}
        <div className="ml-auto flex gap-1">
          {(!skills || skills.length === 0) && (
            <Button size="sm" variant="ghost" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}
              className="text-cyan-500 hover:text-cyan-300 text-xs" data-testid="button-seed-skills">
              {seedMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            </Button>
          )}
        </div>
      </div>

      {tab === "catalog" ? (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
          {isLoading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 text-cyan-500 animate-spin" /></div>
          ) : !skills || skills.length === 0 ? (
            <div className="text-center py-8 space-y-2">
              <div className="text-cyan-600 text-xs">Aucune skill configurée</div>
              <Button size="sm" onClick={() => seedMutation.mutate()} className="bg-cyan-600 hover:bg-cyan-500 text-xs" data-testid="button-init-skills">
                Initialiser les skills
              </Button>
            </div>
          ) : (
            skills.map(skill => (
              <button key={skill.id} onClick={() => setSelectedId(skill.id)} data-testid={`skill-card-${skill.id}`}
                className="w-full text-left bg-black/30 border border-cyan-900/20 rounded-lg p-3 hover:border-cyan-500/40 hover:bg-cyan-950/20 transition-all group">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className={cn("w-3.5 h-3.5", CATEGORY_COLORS[skill.category] || "text-cyan-400")} />
                  <span className="text-xs font-bold text-cyan-200 truncate flex-1">{skill.name}</span>
                  {skill.enabled ? (
                    <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.5)]" />
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-red-400/50" />
                  )}
                </div>
                <div className="text-[10px] text-cyan-500/60 truncate">{skill.description}</div>
                <div className="flex items-center gap-2 mt-1.5">
                  <Badge className={cn("text-[8px] px-1 py-0 border", `bg-transparent ${CATEGORY_COLORS[skill.category] || "text-cyan-400"} border-cyan-900/30`)}>
                    {skill.category}
                  </Badge>
                  <span className="text-[9px] text-cyan-700 font-mono">{skill.pipeline?.length || 0} steps</span>
                </div>
              </button>
            ))
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
          {!executions || executions.length === 0 ? (
            <div className="text-center py-8 text-cyan-600 text-xs">Aucune exécution récente</div>
          ) : (
            executions.map(exec => (
              <div key={exec.id} className="bg-black/30 border border-cyan-900/20 rounded-lg p-2.5" data-testid={`exec-row-${exec.id}`}>
                <div className="flex items-center gap-2 mb-1">
                  <StatusDot status={exec.status} />
                  <span className="text-xs font-mono text-cyan-300 truncate flex-1">{exec.skillName || `Skill #${exec.skillId}`}</span>
                  <span className="text-[9px] text-cyan-700 font-mono">{timeAgoShort(exec.startedAt)}</span>
                </div>
                <div className="flex items-center gap-3 text-[9px] text-cyan-600 font-mono">
                  <span>par {exec.triggeredBy}</span>
                  <span>{exec.stepsCompleted}/{exec.totalSteps} steps</span>
                  {exec.errorMessage && <span className="text-red-400 truncate">{exec.errorMessage}</span>}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
