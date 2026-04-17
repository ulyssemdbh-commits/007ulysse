import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Activity, ArrowLeft, Clock, Cpu, MessageSquare, ThumbsUp, ThumbsDown, Zap, BarChart3, TrendingUp, Wrench, ChevronRight, ChevronDown, X, CheckCircle2, XCircle, Loader2, Globe, Bot, Cog, BookOpen, MapPin, AlertTriangle, Hash } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTabListener } from "@/hooks/useAppNavigation";
import { cn } from "@/lib/utils";

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
  pageId: string | null;
  tabId: string | null;
  startedAt: string;
  completedAt: string | null;
}

interface TraceStep {
  id: number;
  stepType: string;
  name: string;
  input: any;
  output: any;
  latencyMs: number | null;
  tokensUsed: number | null;
  status: string;
  errorMessage: string | null;
}

interface TraceDetail extends Trace {
  steps: TraceStep[];
}

interface Stats {
  totalTraces: number;
  agentStats: Array<{ agent: string; count: number; avgLatency: number; avgTokens: number; successRate: number; avgFeedback: number | null }>;
  modelStats: Array<{ model: string; count: number; avgLatency: number; avgTokens: number }>;
  topTools: Array<{ tool: string; count: number }>;
  dailyVolume: Array<{ date: string; count: number; avgLatency: number }>;
  sourceStats: Array<{ source: string | null; count: number; avgLatency: number; successRate: number }>;
  hourlyDistribution: Array<{ hour: number; count: number }>;
  errorRate: Array<{ date: string; total: number; errors: number; rate: number }>;
  pageStats: Array<{ pageId: string | null; count: number }>;
  tokenCostEstimate: Array<{ agent: string; totalPromptTokens: number; totalCompletionTokens: number; totalTokensAll: number }>;
  feedbackSummary: { positive: number; negative: number; total: number };
}

const AGENT_CONFIG: Record<string, { color: string; bg: string; border: string; emoji: string; icon: typeof Bot }> = {
  ulysse: { color: "text-blue-300", bg: "bg-blue-500/15", border: "border-blue-500/30", emoji: "🧠", icon: Bot },
  iris: { color: "text-pink-300", bg: "bg-pink-500/15", border: "border-pink-500/30", emoji: "🌸", icon: Bot },
  alfred: { color: "text-amber-300", bg: "bg-amber-500/15", border: "border-amber-500/30", emoji: "🎩", icon: Bot },
  maxai: { color: "text-cyan-300", bg: "bg-cyan-500/15", border: "border-cyan-500/30", emoji: "⚡", icon: Cog },
  system: { color: "text-slate-300", bg: "bg-slate-500/15", border: "border-slate-500/30", emoji: "⚙️", icon: Cog },
};

const SOURCE_ICONS: Record<string, { icon: typeof Globe; label: string; color: string }> = {
  superchat: { icon: MessageSquare, label: "SuperChat", color: "text-violet-400" },
  core_conversation: { icon: Bot, label: "Chat", color: "text-blue-400" },
  chat: { icon: Bot, label: "Chat", color: "text-blue-400" },
  homework_auto: { icon: BookOpen, label: "Devoir auto", color: "text-emerald-400" },
  homework_manual: { icon: BookOpen, label: "Devoir manuel", color: "text-teal-400" },
  homework_daily: { icon: BookOpen, label: "Devoir quotidien", color: "text-green-400" },
  skill: { icon: Zap, label: "Skill", color: "text-yellow-400" },
  skill_engine: { icon: Zap, label: "Skill", color: "text-yellow-400" },
};

function getAgentConfig(agent: string) {
  return AGENT_CONFIG[agent] || AGENT_CONFIG.system;
}

function getSourceInfo(source: string | null) {
  if (!source) return { icon: Globe, label: "Autre", color: "text-gray-400" };
  return SOURCE_ICONS[source] || { icon: Globe, label: source, color: "text-gray-400" };
}

function formatMs(ms: number | null) {
  if (!ms) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(t: number | null) {
  if (!t) return "-";
  if (t > 1000000) return `${(t / 1000000).toFixed(1)}M`;
  if (t > 1000) return `${(t / 1000).toFixed(1)}k`;
  return `${t}`;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
  if (status === "error" || status === "failed") return <XCircle className="w-3.5 h-3.5 text-red-400" />;
  return <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />;
}

function TimeAgo({ date }: { date: string }) {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return <span>à l'instant</span>;
  if (mins < 60) return <span>il y a {mins}min</span>;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return <span>il y a {hours}h</span>;
  return <span>{new Date(date).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>;
}

function CollapsibleStep({ step, index }: { step: TraceStep; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const isSuccess = step.status === "success";

  return (
    <div className="bg-[#080c16] rounded-lg border border-cyan-900/15 overflow-hidden">
      <div
        className="flex items-center gap-2 p-2 cursor-pointer hover:bg-cyan-950/20 transition-colors"
        onClick={() => setExpanded(!expanded)}
        data-testid={`step-toggle-${index}`}
      >
        <div className={cn(
          "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
          isSuccess ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
        )}>
          {index + 1}
        </div>
        <span className="text-[10px] font-mono text-purple-400/70 bg-purple-500/10 px-1.5 py-0.5 rounded shrink-0">{step.stepType}</span>
        <span className="text-xs text-gray-300 flex-1 truncate">{step.name}</span>
        <div className="flex items-center gap-2 shrink-0">
          {step.tokensUsed && <span className="text-[10px] font-mono text-purple-500">{formatTokens(step.tokensUsed)}</span>}
          <span className="text-[10px] font-mono text-gray-600">{formatMs(step.latencyMs)}</span>
          <ChevronDown className={cn("w-3 h-3 text-gray-600 transition-transform", expanded && "rotate-180")} />
        </div>
      </div>
      {expanded && (
        <div className="border-t border-cyan-900/15 p-2.5 space-y-2">
          {step.errorMessage && (
            <div className="bg-red-900/20 border border-red-500/30 rounded p-2 text-[11px] text-red-300">
              {step.errorMessage}
            </div>
          )}
          {step.input && (
            <div>
              <p className="text-[9px] font-mono text-cyan-700 uppercase tracking-wider mb-1">Input</p>
              <ScrollArea className="max-h-[150px]">
                <pre className="text-[10px] bg-[#060a14] p-2 rounded border border-cyan-900/10 text-gray-400 whitespace-pre-wrap break-words">
                  {typeof step.input === "string" ? step.input : JSON.stringify(step.input, null, 2)}
                </pre>
              </ScrollArea>
            </div>
          )}
          {step.output && (
            <div>
              <p className="text-[9px] font-mono text-cyan-700 uppercase tracking-wider mb-1">Output</p>
              <ScrollArea className="max-h-[200px]">
                <pre className="text-[10px] bg-[#060a14] p-2 rounded border border-cyan-900/10 text-gray-400 whitespace-pre-wrap break-words">
                  {typeof step.output === "string" ? step.output.slice(0, 2000) : JSON.stringify(step.output, null, 2)?.slice(0, 2000)}
                </pre>
              </ScrollArea>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StepTimeline({ steps, totalMs }: { steps: TraceStep[]; totalMs: number }) {
  if (!steps.length || !totalMs) return null;
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-mono text-cyan-700 uppercase tracking-wider mb-1.5">Timeline</p>
      <div className="relative h-6 bg-[#080c16] rounded-lg border border-cyan-900/15 overflow-hidden flex">
        {steps.map((step, i) => {
          const width = Math.max(((step.latencyMs || 0) / totalMs) * 100, 2);
          const isSuccess = step.status === "success";
          return (
            <div
              key={i}
              className={cn(
                "h-full border-r border-[#0a0e1a] relative group",
                isSuccess ? "bg-emerald-500/30" : "bg-red-500/30"
              )}
              style={{ width: `${width}%` }}
              title={`${step.name}: ${formatMs(step.latencyMs)}`}
            >
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-[8px] font-mono text-white truncate px-0.5">{i + 1}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function TracesPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("list");
  useTabListener(setActiveTab, ["list", "stats"], {
    "liste": "list", "traces": "list",
    "statistiques": "stats", "stat": "stats",
  });
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [modelFilter, setModelFilter] = useState<string>("all");
  const [days, setDays] = useState(30);

  const { data: tracesData, isLoading: tracesLoading } = useQuery<{ traces: Trace[]; total: number }>({
    queryKey: ["/api/traces", agentFilter, statusFilter, sourceFilter, modelFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (agentFilter !== "all") params.set("agent", agentFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (sourceFilter !== "all") params.set("source", sourceFilter);
      if (modelFilter !== "all") params.set("model", modelFilter);
      params.set("limit", "100");
      const res = await fetch(`/api/traces?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  const { data: stats, isLoading: statsLoading } = useQuery<Stats>({
    queryKey: ["/api/traces/stats", days],
    queryFn: async () => {
      const res = await fetch(`/api/traces/stats?days=${days}`, { credentials: "include" });
      return res.json();
    },
  });

  const { data: traceDetail } = useQuery<TraceDetail>({
    queryKey: ["/api/traces", selectedTraceId],
    queryFn: async () => {
      const res = await fetch(`/api/traces/${selectedTraceId}`, { credentials: "include" });
      return res.json();
    },
    enabled: !!selectedTraceId,
  });

  const feedbackMutation = useMutation({
    mutationFn: async ({ traceId, feedback, score }: { traceId: string; feedback: string; score: number }) => {
      return apiRequest("POST", `/api/traces/${traceId}/feedback`, { feedback, score });
    },
    onSuccess: () => {
      toast({ title: "Feedback enregistré" });
      queryClient.invalidateQueries({ queryKey: ["/api/traces"] });
    },
  });

  const traces = tracesData?.traces || [];
  const uniqueSources = [...new Set(traces.map(t => t.source).filter(Boolean))];
  const uniqueModels = [...new Set(traces.map(t => t.model).filter(Boolean))];

  return (
    <div className="min-h-screen bg-[#060a14] text-white">
      <div className="border-b border-cyan-900/30 bg-[#0a0e1a]/80 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-[1500px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")} className="text-cyan-600 hover:text-cyan-400 hover:bg-cyan-950/30" data-testid="button-back">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                <Activity className="w-5 h-5 text-cyan-400" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-cyan-50 leading-tight">Traces</h1>
                <p className="text-[10px] font-mono text-cyan-600 tracking-wider uppercase">Agent Activity Log</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="bg-cyan-500/10 text-cyan-300 border-cyan-500/20 font-mono" data-testid="badge-total">
              {tracesData?.total || 0}
            </Badge>
          </div>
        </div>
      </div>

      <div className="max-w-[1500px] mx-auto px-4 sm:px-6 py-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="bg-[#0a0e1a] border border-cyan-900/30 p-1">
            <TabsTrigger value="list" className="data-[state=active]:bg-cyan-500/10 data-[state=active]:text-cyan-300 text-cyan-700" data-testid="tab-list">
              <Activity className="w-3.5 h-3.5 mr-1.5" /> Liste
            </TabsTrigger>
            <TabsTrigger value="stats" className="data-[state=active]:bg-cyan-500/10 data-[state=active]:text-cyan-300 text-cyan-700" data-testid="tab-stats">
              <BarChart3 className="w-3.5 h-3.5 mr-1.5" /> Statistiques
            </TabsTrigger>
          </TabsList>

          <TabsContent value="list" className="space-y-3">
            <div className="flex flex-wrap gap-2 items-center">
              <Select value={agentFilter} onValueChange={setAgentFilter}>
                <SelectTrigger className="w-[150px] bg-[#0a0e1a] border-cyan-900/30 text-cyan-300 text-sm h-9" data-testid="select-agent-filter">
                  <SelectValue placeholder="Agent" />
                </SelectTrigger>
                <SelectContent className="bg-[#0d1220] border-cyan-900/30">
                  <SelectItem value="all">Tous agents</SelectItem>
                  <SelectItem value="ulysse">🧠 Ulysse</SelectItem>
                  <SelectItem value="iris">🌸 Iris</SelectItem>
                  <SelectItem value="alfred">🎩 Alfred</SelectItem>
                  <SelectItem value="maxai">⚡ MaxAI</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger className="w-[160px] bg-[#0a0e1a] border-cyan-900/30 text-cyan-300 text-sm h-9" data-testid="select-source-filter">
                  <SelectValue placeholder="Source" />
                </SelectTrigger>
                <SelectContent className="bg-[#0d1220] border-cyan-900/30">
                  <SelectItem value="all">Toutes sources</SelectItem>
                  {uniqueSources.map(s => {
                    const info = getSourceInfo(s);
                    return <SelectItem key={s!} value={s!}>{info.label}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px] bg-[#0a0e1a] border-cyan-900/30 text-cyan-300 text-sm h-9" data-testid="select-status-filter">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent className="bg-[#0d1220] border-cyan-900/30">
                  <SelectItem value="all">Tous</SelectItem>
                  <SelectItem value="completed">Complété</SelectItem>
                  <SelectItem value="error">Erreur</SelectItem>
                  <SelectItem value="running">En cours</SelectItem>
                </SelectContent>
              </Select>
              <Select value={modelFilter} onValueChange={setModelFilter}>
                <SelectTrigger className="w-[180px] bg-[#0a0e1a] border-cyan-900/30 text-cyan-300 text-sm h-9" data-testid="select-model-filter">
                  <SelectValue placeholder="Modèle" />
                </SelectTrigger>
                <SelectContent className="bg-[#0d1220] border-cyan-900/30">
                  <SelectItem value="all">Tous modèles</SelectItem>
                  {uniqueModels.map(m => (
                    <SelectItem key={m!} value={m!}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr,420px] gap-4">
              <ScrollArea className="h-[calc(100vh-220px)]">
                <div className="space-y-1.5 pr-2">
                  {tracesLoading && (
                    <div className="flex items-center justify-center gap-2 py-12 text-cyan-700">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span className="text-sm font-mono">Chargement...</span>
                    </div>
                  )}
                  {traces.map((trace) => {
                    const agentCfg = getAgentConfig(trace.agent);
                    const srcInfo = getSourceInfo(trace.source);
                    const SrcIcon = srcInfo.icon;
                    const isSelected = selectedTraceId === trace.traceId;

                    return (
                      <div
                        key={trace.traceId}
                        onClick={() => setSelectedTraceId(trace.traceId)}
                        data-testid={`card-trace-${trace.traceId}`}
                        className={cn(
                          "group relative rounded-lg border px-3 py-2.5 cursor-pointer transition-all duration-200",
                          isSelected
                            ? "border-cyan-500/50 bg-cyan-950/30 shadow-[0_0_20px_rgba(0,212,255,0.08)]"
                            : "border-cyan-900/20 bg-[#0a0e1a]/60 hover:border-cyan-800/40 hover:bg-[#0d1220]/80"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <div className={cn("mt-0.5 p-1.5 rounded-md shrink-0", agentCfg.bg, agentCfg.border, "border")}>
                            <span className="text-sm">{agentCfg.emoji}</span>
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className={cn("text-xs font-semibold capitalize", agentCfg.color)}>{trace.agent}</span>
                              <StatusIcon status={trace.status} />
                              <div className={cn("flex items-center gap-1 ml-1", srcInfo.color)}>
                                <SrcIcon className="w-3 h-3" />
                                <span className="text-[10px] font-mono">{srcInfo.label}</span>
                              </div>
                              {trace.domain && trace.domain !== "general" && (
                                <span className="text-[10px] font-mono text-purple-400/70 bg-purple-500/10 px-1.5 py-0.5 rounded">{trace.domain}</span>
                              )}
                              {trace.pageId && (
                                <span className="text-[10px] font-mono text-teal-400/70 bg-teal-500/10 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                  <MapPin className="w-2.5 h-2.5" />{trace.pageId}{trace.tabId ? `/${trace.tabId}` : ""}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-300 truncate leading-snug">{trace.query}</p>
                            <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-600">
                              <span className="flex items-center gap-1 font-mono">
                                <Clock className="w-3 h-3" />
                                <span className={cn(
                                  trace.totalLatencyMs && trace.totalLatencyMs < 3000 ? "text-emerald-500" :
                                  trace.totalLatencyMs && trace.totalLatencyMs < 10000 ? "text-amber-500" : "text-gray-500"
                                )}>
                                  {formatMs(trace.totalLatencyMs)}
                                </span>
                              </span>
                              {trace.totalTokens && <span className="flex items-center gap-1 font-mono"><Cpu className="w-3 h-3" />{formatTokens(trace.totalTokens)}</span>}
                              {trace.toolCallCount > 0 && (
                                <span className="flex items-center gap-1 font-mono text-purple-500">
                                  <Wrench className="w-3 h-3" />{trace.toolCallCount}
                                </span>
                              )}
                              <span className="text-[10px] font-mono text-gray-700 truncate max-w-[120px]">{trace.model}</span>
                              <span className="ml-auto"><TimeAgo date={trace.startedAt} /></span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {trace.userFeedback && (
                              <span className={cn("text-sm", trace.feedbackScore && trace.feedbackScore >= 0.5 ? "text-emerald-400" : "text-red-400")}>
                                {trace.feedbackScore && trace.feedbackScore >= 0.5 ? "👍" : "👎"}
                              </span>
                            )}
                            <ChevronRight className={cn("w-4 h-4 transition-colors", isSelected ? "text-cyan-400" : "text-gray-700 group-hover:text-gray-500")} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {!tracesLoading && traces.length === 0 && (
                    <div className="text-center py-16">
                      <div className="p-4 rounded-full bg-cyan-500/5 inline-block mb-4">
                        <Activity className="w-10 h-10 text-cyan-800" />
                      </div>
                      <p className="text-cyan-600 font-medium">Aucune trace enregistrée</p>
                      <p className="text-sm text-cyan-800 mt-1">Les traces apparaîtront quand les agents traiteront des requêtes</p>
                    </div>
                  )}
                </div>
              </ScrollArea>

              <div className="hidden lg:block">
                {selectedTraceId && traceDetail ? (
                  <div className="sticky top-20 border border-cyan-900/30 bg-[#0a0e1a]/80 backdrop-blur-md rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-cyan-900/30 flex items-center justify-between bg-cyan-950/20">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{getAgentConfig(traceDetail.agent).emoji}</span>
                        <span className={cn("text-sm font-bold capitalize", getAgentConfig(traceDetail.agent).color)}>{traceDetail.agent}</span>
                        <StatusIcon status={traceDetail.status} />
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => setSelectedTraceId(null)} className="h-7 w-7 text-cyan-700 hover:text-cyan-400" data-testid="button-close-detail">
                        <X className="w-4 h-4" />
                      </Button>
                    </div>

                    <ScrollArea className="h-[calc(100vh-300px)]">
                      <div className="p-4 space-y-4">
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { label: "Modèle", value: traceDetail.model, color: "text-cyan-300" },
                            { label: "Latence", value: formatMs(traceDetail.totalLatencyMs), color: traceDetail.totalLatencyMs && traceDetail.totalLatencyMs < 3000 ? "text-emerald-400" : "text-amber-400" },
                            { label: "Tokens", value: `${formatTokens(traceDetail.promptTokens)} → ${formatTokens(traceDetail.completionTokens)} (${formatTokens(traceDetail.totalTokens)})`, color: "text-purple-300" },
                            { label: "Source", value: getSourceInfo(traceDetail.source).label, color: getSourceInfo(traceDetail.source).color },
                          ].map((item) => (
                            <div key={item.label} className="bg-[#080c16] rounded-lg p-2.5 border border-cyan-900/20">
                              <p className="text-[10px] font-mono text-cyan-700 uppercase tracking-wider">{item.label}</p>
                              <p className={cn("text-sm font-semibold mt-0.5 truncate", item.color)}>{item.value}</p>
                            </div>
                          ))}
                        </div>

                        {(traceDetail.pageId || traceDetail.tabId) && (
                          <div className="bg-teal-500/5 border border-teal-500/20 rounded-lg p-2.5 flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-teal-400 shrink-0" />
                            <div>
                              <p className="text-[10px] font-mono text-teal-600 uppercase tracking-wider">Contexte Navigation</p>
                              <p className="text-xs text-teal-300 mt-0.5">
                                Page: <span className="font-semibold">{traceDetail.pageId}</span>
                                {traceDetail.tabId && <> / Onglet: <span className="font-semibold">{traceDetail.tabId}</span></>}
                              </p>
                            </div>
                          </div>
                        )}

                        <div>
                          <p className="text-[10px] font-mono text-cyan-700 uppercase tracking-wider mb-1.5">Query</p>
                          <div className="bg-[#080c16] rounded-lg p-3 border border-cyan-900/20">
                            <p className="text-sm text-gray-200 leading-relaxed">{traceDetail.query}</p>
                          </div>
                        </div>

                        {traceDetail.response && (
                          <div>
                            <p className="text-[10px] font-mono text-cyan-700 uppercase tracking-wider mb-1.5">Réponse</p>
                            <div className="bg-[#080c16] rounded-lg p-3 border border-cyan-900/20 max-h-[200px] overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
                              <p className="text-sm text-gray-400 leading-relaxed whitespace-pre-wrap">{traceDetail.response.slice(0, 1500)}</p>
                            </div>
                          </div>
                        )}

                        {traceDetail.toolsUsed && traceDetail.toolsUsed.length > 0 && (
                          <div>
                            <p className="text-[10px] font-mono text-cyan-700 uppercase tracking-wider mb-1.5">Outils ({traceDetail.toolsUsed.length})</p>
                            <div className="flex flex-wrap gap-1.5">
                              {traceDetail.toolsUsed.map((t, i) => (
                                <span key={i} className="text-[11px] font-mono px-2 py-1 rounded-md bg-purple-500/10 text-purple-300 border border-purple-500/20">{t}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        {traceDetail.steps && traceDetail.steps.length > 0 && (
                          <>
                            <StepTimeline steps={traceDetail.steps} totalMs={traceDetail.totalLatencyMs || 0} />
                            <div>
                              <p className="text-[10px] font-mono text-cyan-700 uppercase tracking-wider mb-1.5">Étapes ({traceDetail.steps.length})</p>
                              <div className="space-y-1">
                                {traceDetail.steps.map((step, i) => (
                                  <CollapsibleStep key={i} step={step} index={i} />
                                ))}
                              </div>
                            </div>
                          </>
                        )}

                        {traceDetail.errorMessage && (
                          <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3">
                            <div className="flex items-center gap-2 mb-1">
                              <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                              <span className="text-[10px] font-mono text-red-400 uppercase">Erreur</span>
                            </div>
                            <p className="text-xs text-red-300">{traceDetail.errorMessage}</p>
                          </div>
                        )}

                        <div className="flex gap-2 pt-3 border-t border-cyan-900/30">
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 h-8"
                            onClick={() => feedbackMutation.mutate({ traceId: traceDetail.traceId, feedback: "positive", score: 1 })}
                            data-testid="button-feedback-positive"
                          >
                            <ThumbsUp className="w-3 h-3 mr-1" /> Bon
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 border-red-500/30 text-red-300 hover:bg-red-500/10 h-8"
                            onClick={() => feedbackMutation.mutate({ traceId: traceDetail.traceId, feedback: "negative", score: 0 })}
                            data-testid="button-feedback-negative"
                          >
                            <ThumbsDown className="w-3 h-3 mr-1" /> Mauvais
                          </Button>
                        </div>
                      </div>
                    </ScrollArea>
                  </div>
                ) : (
                  <div className="sticky top-20 border border-cyan-900/20 bg-[#0a0e1a]/40 rounded-xl p-8 text-center">
                    <div className="p-3 rounded-full bg-cyan-500/5 inline-block mb-3">
                      <MessageSquare className="w-6 h-6 text-cyan-800" />
                    </div>
                    <p className="text-sm text-cyan-700">Sélectionne une trace</p>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="stats" className="space-y-4">
            <div className="flex gap-1.5 mb-4">
              {[7, 14, 30, 90].map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant="ghost"
                  onClick={() => setDays(d)}
                  className={cn(
                    "h-8 font-mono text-xs",
                    days === d ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30" : "text-cyan-700 hover:text-cyan-400"
                  )}
                  data-testid={`button-days-${d}`}
                >
                  {d}j
                </Button>
              ))}
            </div>

            {statsLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-cyan-700">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm font-mono">Chargement...</span>
              </div>
            ) : stats ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {[
                    { icon: Activity, label: "Total traces", value: stats.totalTraces, color: "text-cyan-300", iconColor: "text-cyan-400", bg: "bg-cyan-500/10" },
                    { icon: Bot, label: "Agents actifs", value: stats.agentStats.length, color: "text-blue-300", iconColor: "text-blue-400", bg: "bg-blue-500/10" },
                    { icon: Cpu, label: "Modèles", value: stats.modelStats.length, color: "text-purple-300", iconColor: "text-purple-400", bg: "bg-purple-500/10" },
                    { icon: ThumbsUp, label: "Feedback", value: `${stats.feedbackSummary?.positive || 0}👍 / ${stats.feedbackSummary?.negative || 0}👎`, color: "text-emerald-300", iconColor: "text-emerald-400", bg: "bg-emerald-500/10" },
                    { icon: Wrench, label: "Outils uniques", value: stats.topTools.length, color: "text-amber-300", iconColor: "text-amber-400", bg: "bg-amber-500/10" },
                  ].map((card) => {
                    const Icon = card.icon;
                    return (
                      <div key={card.label} className="border border-cyan-900/30 bg-[#0a0e1a]/60 rounded-xl p-4">
                        <div className={cn("p-2 rounded-lg inline-block mb-2", card.bg)}>
                          <Icon className={cn("w-4 h-4", card.iconColor)} />
                        </div>
                        <p className={cn("text-2xl font-bold font-mono", card.color)} data-testid={`text-stat-${card.label}`}>{card.value}</p>
                        <p className="text-[10px] font-mono text-cyan-700 uppercase tracking-wider mt-0.5">{card.label}</p>
                      </div>
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="border border-cyan-900/30 bg-[#0a0e1a]/60 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-cyan-900/20 flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-cyan-400" />
                      <span className="text-sm font-semibold text-cyan-200">Performance par Agent</span>
                    </div>
                    <div className="p-4 space-y-3">
                      {stats.agentStats.map((a) => {
                        const cfg = getAgentConfig(a.agent);
                        return (
                          <div key={a.agent} className={cn("rounded-lg p-3 border", cfg.bg, cfg.border)}>
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-base">{cfg.emoji}</span>
                              <span className={cn("text-sm font-bold capitalize", cfg.color)}>{a.agent}</span>
                              <span className="ml-auto text-xs font-mono text-gray-500">{a.count} appels</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <p className="text-[9px] font-mono text-gray-600 uppercase">Latence</p>
                                <p className="text-sm font-mono text-cyan-300">{formatMs(a.avgLatency)}</p>
                              </div>
                              <div>
                                <p className="text-[9px] font-mono text-gray-600 uppercase">Tokens</p>
                                <p className="text-sm font-mono text-purple-300">{formatTokens(a.avgTokens)}</p>
                              </div>
                              <div>
                                <p className="text-[9px] font-mono text-gray-600 uppercase">Succès</p>
                                <p className={cn("text-sm font-mono font-bold", a.successRate >= 90 ? "text-emerald-400" : a.successRate >= 70 ? "text-amber-400" : "text-red-400")}>
                                  {a.successRate}%
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {stats.agentStats.length === 0 && <p className="text-cyan-800 text-sm text-center py-4">Aucune donnée</p>}
                    </div>
                  </div>

                  <div className="border border-cyan-900/30 bg-[#0a0e1a]/60 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-cyan-900/20 flex items-center gap-2">
                      <Wrench className="w-4 h-4 text-emerald-400" />
                      <span className="text-sm font-semibold text-cyan-200">Top Outils</span>
                    </div>
                    <div className="p-4 space-y-1.5">
                      {stats.topTools.slice(0, 10).map((t, i) => {
                        const maxCount = Math.max(...stats.topTools.slice(0, 10).map(x => x.count), 1);
                        return (
                          <div key={t.tool} className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-gray-600 w-4 text-right">{i + 1}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-300 truncate">{t.tool}</span>
                                <span className="text-[10px] font-mono text-cyan-600 ml-auto shrink-0">{t.count}x</span>
                              </div>
                              <div className="h-1 bg-cyan-900/30 rounded-full mt-1 overflow-hidden">
                                <div className="h-full bg-emerald-500/50 rounded-full" style={{ width: `${(t.count / maxCount) * 100}%` }} />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {stats.topTools.length === 0 && <p className="text-cyan-800 text-sm text-center py-4">Aucune donnée</p>}
                    </div>
                  </div>

                  <div className="border border-cyan-900/30 bg-[#0a0e1a]/60 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-cyan-900/20 flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-purple-400" />
                      <span className="text-sm font-semibold text-cyan-200">Modèles & Tokens</span>
                    </div>
                    <div className="p-4 space-y-2">
                      {stats.modelStats.map((m) => (
                        <div key={m.model} className="flex items-center justify-between bg-[#080c16] p-2.5 rounded-lg border border-cyan-900/15">
                          <span className="text-xs text-gray-300 truncate max-w-[180px] font-mono">{m.model}</span>
                          <div className="flex gap-3 text-[11px] font-mono shrink-0">
                            <span className="text-gray-500">{m.count}x</span>
                            <span className="text-cyan-400">{formatMs(m.avgLatency)}</span>
                            <span className="text-purple-400">{formatTokens(m.avgTokens)}</span>
                          </div>
                        </div>
                      ))}
                      {stats.modelStats.length === 0 && <p className="text-cyan-800 text-sm text-center py-4">Aucune donnée</p>}
                    </div>
                  </div>

                  <div className="border border-cyan-900/30 bg-[#0a0e1a]/60 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-cyan-900/20 flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-amber-400" />
                      <span className="text-sm font-semibold text-cyan-200">Volume Quotidien</span>
                    </div>
                    <div className="p-4">
                      <div className="flex items-end gap-1 h-32">
                        {stats.dailyVolume.slice(-14).map((d, i) => {
                          const max = Math.max(...stats.dailyVolume.slice(-14).map(v => v.count), 1);
                          const h = Math.max((d.count / max) * 100, 4);
                          return (
                            <div key={i} className="flex-1 flex flex-col items-center gap-1">
                              <span className="text-[8px] font-mono text-cyan-700">{d.count}</span>
                              <div className="w-full relative" style={{ height: `${h}%` }}>
                                <div className="absolute inset-0 bg-gradient-to-t from-cyan-500/60 to-cyan-400/30 rounded-t hover:from-cyan-500/80 hover:to-cyan-400/50 transition-colors" />
                              </div>
                              <span className="text-[7px] font-mono text-gray-700 rotate-[-45deg] origin-center whitespace-nowrap">
                                {new Date(d.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      {stats.dailyVolume.length === 0 && <p className="text-cyan-800 text-sm text-center py-4">Aucune donnée</p>}
                    </div>
                  </div>

                  {stats.sourceStats && stats.sourceStats.length > 0 && (
                    <div className="border border-cyan-900/30 bg-[#0a0e1a]/60 rounded-xl overflow-hidden">
                      <div className="px-4 py-3 border-b border-cyan-900/20 flex items-center gap-2">
                        <Globe className="w-4 h-4 text-violet-400" />
                        <span className="text-sm font-semibold text-cyan-200">Par Source</span>
                      </div>
                      <div className="p-4 space-y-2">
                        {stats.sourceStats.map((s) => {
                          const info = getSourceInfo(s.source);
                          const SrcIcon = info.icon;
                          return (
                            <div key={s.source || "null"} className="flex items-center gap-3 bg-[#080c16] p-2.5 rounded-lg border border-cyan-900/15">
                              <SrcIcon className={cn("w-4 h-4 shrink-0", info.color)} />
                              <span className="text-xs text-gray-300 flex-1">{info.label}</span>
                              <div className="flex gap-3 text-[11px] font-mono shrink-0">
                                <span className="text-gray-500">{s.count}x</span>
                                <span className="text-cyan-400">{formatMs(s.avgLatency)}</span>
                                <span className={s.successRate >= 90 ? "text-emerald-400" : "text-amber-400"}>{s.successRate}%</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {stats.hourlyDistribution && stats.hourlyDistribution.length > 0 && (
                    <div className="border border-cyan-900/30 bg-[#0a0e1a]/60 rounded-xl overflow-hidden">
                      <div className="px-4 py-3 border-b border-cyan-900/20 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-teal-400" />
                        <span className="text-sm font-semibold text-cyan-200">Distribution Horaire</span>
                      </div>
                      <div className="p-4">
                        <div className="flex items-end gap-0.5 h-24">
                          {Array.from({ length: 24 }, (_, h) => {
                            const entry = stats.hourlyDistribution.find(e => e.hour === h);
                            const val = entry?.count || 0;
                            const maxH = Math.max(...stats.hourlyDistribution.map(e => e.count), 1);
                            const barH = val > 0 ? Math.max((val / maxH) * 100, 6) : 2;
                            return (
                              <div key={h} className="flex-1 flex flex-col items-center gap-0.5" title={`${h}h: ${val} traces`}>
                                <div className="w-full relative" style={{ height: `${barH}%` }}>
                                  <div className={cn(
                                    "absolute inset-0 rounded-t transition-colors",
                                    val > 0 ? "bg-gradient-to-t from-teal-500/60 to-teal-400/20 hover:from-teal-500/80" : "bg-gray-800/30"
                                  )} />
                                </div>
                                {h % 4 === 0 && <span className="text-[7px] font-mono text-gray-700">{h}h</span>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {stats.errorRate && stats.errorRate.length > 0 && (
                    <div className="border border-cyan-900/30 bg-[#0a0e1a]/60 rounded-xl overflow-hidden">
                      <div className="px-4 py-3 border-b border-cyan-900/20 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-400" />
                        <span className="text-sm font-semibold text-cyan-200">Taux d'Erreur</span>
                      </div>
                      <div className="p-4 space-y-1">
                        {stats.errorRate.slice(-10).map((e) => (
                          <div key={e.date} className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-gray-600 w-12">{new Date(e.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}</span>
                            <div className="flex-1 h-2 bg-cyan-900/20 rounded-full overflow-hidden">
                              <div
                                className={cn("h-full rounded-full", e.rate > 10 ? "bg-red-500/70" : e.rate > 5 ? "bg-amber-500/70" : "bg-emerald-500/50")}
                                style={{ width: `${Math.max(e.rate, 1)}%` }}
                              />
                            </div>
                            <span className={cn("text-[10px] font-mono w-10 text-right", e.rate > 10 ? "text-red-400" : e.rate > 5 ? "text-amber-400" : "text-emerald-400")}>
                              {e.rate}%
                            </span>
                            <span className="text-[9px] font-mono text-gray-700 w-16 text-right">{e.errors}/{e.total}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {stats.tokenCostEstimate && stats.tokenCostEstimate.length > 0 && (
                    <div className="border border-cyan-900/30 bg-[#0a0e1a]/60 rounded-xl overflow-hidden">
                      <div className="px-4 py-3 border-b border-cyan-900/20 flex items-center gap-2">
                        <Hash className="w-4 h-4 text-indigo-400" />
                        <span className="text-sm font-semibold text-cyan-200">Consommation Tokens</span>
                      </div>
                      <div className="p-4 space-y-2">
                        {stats.tokenCostEstimate.map((t) => {
                          const cfg = getAgentConfig(t.agent);
                          return (
                            <div key={t.agent} className={cn("rounded-lg p-3 border", cfg.bg, cfg.border)}>
                              <div className="flex items-center gap-2 mb-1.5">
                                <span className="text-sm">{cfg.emoji}</span>
                                <span className={cn("text-xs font-bold capitalize", cfg.color)}>{t.agent}</span>
                                <span className="ml-auto text-xs font-mono text-gray-500">{formatTokens(t.totalTokensAll)} total</span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                                <div>
                                  <span className="text-gray-600">Prompt:</span>
                                  <span className="text-cyan-400 ml-1">{formatTokens(t.totalPromptTokens)}</span>
                                </div>
                                <div>
                                  <span className="text-gray-600">Completion:</span>
                                  <span className="text-purple-400 ml-1">{formatTokens(t.totalCompletionTokens)}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {stats.pageStats && stats.pageStats.length > 0 && (
                    <div className="border border-cyan-900/30 bg-[#0a0e1a]/60 rounded-xl overflow-hidden">
                      <div className="px-4 py-3 border-b border-cyan-900/20 flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-teal-400" />
                        <span className="text-sm font-semibold text-cyan-200">Pages les plus actives</span>
                      </div>
                      <div className="p-4 space-y-1.5">
                        {stats.pageStats.map((p, i) => {
                          const maxCount = Math.max(...stats.pageStats.map(x => x.count), 1);
                          return (
                            <div key={p.pageId || i} className="flex items-center gap-2">
                              <span className="text-[10px] font-mono text-gray-600 w-4 text-right">{i + 1}</span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-teal-300 truncate">{p.pageId || "inconnu"}</span>
                                  <span className="text-[10px] font-mono text-gray-600 ml-auto shrink-0">{p.count}x</span>
                                </div>
                                <div className="h-1 bg-cyan-900/30 rounded-full mt-1 overflow-hidden">
                                  <div className="h-full bg-teal-500/50 rounded-full" style={{ width: `${(p.count / maxCount) * 100}%` }} />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
