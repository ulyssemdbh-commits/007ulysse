import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  RefreshCw,
  ExternalLink,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Play,
  StopCircle,
  Activity,
  Code,
  Rocket,
  Zap,
  Eye,
  FolderPlus,
  Settings,
  Globe,
  BookOpen,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  API,
  AUTH_API,
  DEVMAX_TOKEN_KEY,
  devmaxFetch,
  devmaxApiRequest,
  useDevmaxAuth,
  timeAgo,
} from "./types";

export interface DgmSession {
  id: number;
  userId: number;
  active: boolean;
  objective: string | null;
  repoContext: string | null;
  currentTaskId: number | null;
  totalTasks: number;
  completedTasks: number;
  activatedAt: string | null;
  deactivatedAt: string | null;
  createdAt: string | null;
}

export interface DgmTask {
  id: number;
  sessionId: number;
  sortOrder: number;
  title: string;
  description: string | null;
  status: string;
  pipelineStage: string;
  riskLevel: string | null;
  riskScore: number | null;
  prNumber: number | null;
  prUrl: string | null;
  impactedFiles: string[] | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export interface DgmPipelineRun {
  id: number;
  sessionId: number;
  taskId: number;
  stage: string;
  status: string;
  durationMs: number | null;
  error: string | null;
  createdAt: string | null;
}

export function DGMPanel() {
  const { activeProject } = useDevmaxAuth();
  const pid = activeProject?.id || "";
  const [selectedSession, setSelectedSession] = useState<number | null>(null);
  const { toast } = useToast();

  const { data: sessions, isLoading: sessionsLoading, refetch: refetchSessions } = useQuery<DgmSession[]>({
    queryKey: [API, "dgm", "sessions", pid],
    queryFn: () => devmaxFetch(`${API}/dgm/sessions`, undefined, pid).then(r => r.json()),
    enabled: !!pid,
    refetchInterval: 10000,
  });

  const { data: tasks } = useQuery<DgmTask[]>({
    queryKey: [API, "dgm", "tasks", selectedSession],
    queryFn: () => devmaxFetch(`${API}/dgm/sessions/${selectedSession}/tasks`, undefined, pid).then(r => r.json()),
    enabled: !!selectedSession,
    refetchInterval: 5000,
  });

  const { data: pipelineRuns } = useQuery<DgmPipelineRun[]>({
    queryKey: [API, "dgm", "pipeline", selectedSession],
    queryFn: () => devmaxFetch(`${API}/dgm/sessions/${selectedSession}/pipeline`, undefined, pid).then(r => r.json()),
    enabled: !!selectedSession,
    refetchInterval: 5000,
  });

  const toggleSession = useMutation({
    mutationFn: (sessionId: number) => devmaxApiRequest("POST", `${API}/dgm/sessions/${sessionId}/toggle`, {}, pid),
    onSuccess: (data: any) => {
      toast({ title: data.active ? "DGM active" : "DGM desactive" });
      refetchSessions();
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const statusIcon = (status: string) => {
    switch (status) {
      case "completed": case "success": return <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />;
      case "running": return <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />;
      case "failed": case "error": return <XCircle className="w-3.5 h-3.5 text-red-400" />;
      default: return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
    }
  };

  const stageColor = (stage: string) => {
    switch (stage) {
      case "preflight": return "bg-blue-500/10 text-blue-400 border-blue-500/30";
      case "backup": return "bg-violet-500/10 text-violet-400 border-violet-500/30";
      case "build": return "bg-amber-500/10 text-amber-400 border-amber-500/30";
      case "test": return "bg-cyan-500/10 text-cyan-400 border-cyan-500/30";
      case "security": return "bg-red-500/10 text-red-400 border-red-500/30";
      case "deploy": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
      case "health": return "bg-green-500/10 text-green-400 border-green-500/30";
      default: return "bg-muted text-muted-foreground";
    }
  };

  if (sessionsLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Zap className="w-4 h-4 text-violet-400" /> DGM — Dev Goal Manager
        </h3>
        <Button size="icon" variant="ghost" className="rounded-xl" onClick={() => refetchSessions()} data-testid="button-refresh-dgm">
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>

      {(!sessions || sessions.length === 0) ? (
        <Card className="border-dashed border-2">
          <CardContent className="p-8 text-center">
            <Zap className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">Aucune session DGM</p>
            <p className="text-xs text-zinc-600 mt-1">Demandez a MaxAI dans le chat de lancer un objectif DGM</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {sessions.map(s => (
            <Card
              key={s.id}
              className={cn(
                "cursor-pointer transition-all hover:shadow-md",
                selectedSession === s.id ? "border-violet-500/40 bg-violet-500/5" : "hover:border-muted-foreground/20",
                s.active && "ring-1 ring-violet-500/30"
              )}
              onClick={() => setSelectedSession(selectedSession === s.id ? null : s.id)}
              data-testid={`dgm-session-${s.id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={s.active ? "default" : "secondary"} className={cn("text-[10px]", s.active && "bg-violet-600")}>
                        {s.active ? "Actif" : "Inactif"}
                      </Badge>
                      <span className="text-xs text-muted-foreground font-mono">#{s.id}</span>
                      {s.repoContext && <Badge variant="outline" className="text-[10px] font-mono">{s.repoContext}</Badge>}
                    </div>
                    <p className="text-sm font-medium truncate">{s.objective || "Pas d'objectif"}</p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                      <span>{s.completedTasks}/{s.totalTasks} taches</span>
                      {s.totalTasks > 0 && (
                        <div className="flex-1 max-w-[120px] h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-violet-500 to-emerald-500 rounded-full transition-all" style={{ width: `${(s.completedTasks / s.totalTasks) * 100}%` }} />
                        </div>
                      )}
                      {s.createdAt && <span>{timeAgo(s.createdAt)}</span>}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={s.active ? "destructive" : "outline"}
                    className="rounded-xl text-xs shrink-0"
                    onClick={(e) => { e.stopPropagation(); toggleSession.mutate(s.id); }}
                    disabled={toggleSession.isPending}
                    data-testid={`dgm-toggle-${s.id}`}
                  >
                    {s.active ? <StopCircle className="w-3 h-3 mr-1" /> : <Play className="w-3 h-3 mr-1" />}
                    {s.active ? "Stop" : "Start"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedSession && tasks && tasks.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Taches — Session #{selectedSession}</h4>
          <div className="space-y-1.5">
            {tasks.map(t => (
              <div key={t.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors" data-testid={`dgm-task-${t.id}`}>
                {statusIcon(t.status)}
                <span className="text-sm flex-1 truncate">{t.title}</span>
                <Badge variant="outline" className={cn("text-[10px] border", stageColor(t.pipelineStage))}>
                  {t.pipelineStage}
                </Badge>
                {t.riskLevel && (
                  <Badge variant="outline" className={cn("text-[10px]",
                    t.riskLevel === "high" ? "text-red-400 border-red-500/30" :
                    t.riskLevel === "medium" ? "text-amber-400 border-amber-500/30" :
                    "text-emerald-400 border-emerald-500/30"
                  )}>
                    {t.riskLevel}
                  </Badge>
                )}
                {t.prUrl && (
                  <a href={t.prUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                    <Badge variant="outline" className="text-[10px] text-purple-400 border-purple-500/30">
                      PR #{t.prNumber}
                    </Badge>
                  </a>
                )}
                {t.completedAt && <span className="text-[10px] text-muted-foreground">{timeAgo(t.completedAt)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedSession && pipelineRuns && pipelineRuns.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pipeline Runs</h4>
          <div className="space-y-1">
            {pipelineRuns.slice(0, 15).map(r => (
              <div key={r.id} className="flex items-center gap-2 p-2 rounded-lg text-xs" data-testid={`dgm-run-${r.id}`}>
                {statusIcon(r.status)}
                <Badge variant="outline" className={cn("text-[10px] border", stageColor(r.stage))}>{r.stage}</Badge>
                <span className="text-muted-foreground">Task #{r.taskId}</span>
                {r.durationMs && <span className="text-muted-foreground">{(r.durationMs / 1000).toFixed(1)}s</span>}
                {r.error && <span className="text-red-400 truncate max-w-[200px]">{r.error}</span>}
                {r.createdAt && <span className="text-muted-foreground ml-auto">{timeAgo(r.createdAt)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewPanel() {
  const { activeProject } = useDevmaxAuth();
  const pid = activeProject?.id || "";
  const slug = activeProject?.deploy_slug || activeProject?.name?.toLowerCase().replace(/[^a-z0-9]/g, "-") || "";
  const [activeEnv, setActiveEnv] = useState<"staging" | "production">("staging");
  const [iframeKey, setIframeKey] = useState(0);

  const { data: status } = useQuery<{
    stagingUrl: string | null;
    productionUrl: string | null;
    environment: string;
  }>({
    queryKey: [API, "deployment-status", "preview", pid],
    queryFn: () => devmaxFetch(`${API}/deployment-status`, undefined, pid).then(r => r.json()),
    enabled: !!pid,
  });

  const stagingUrl = status?.stagingUrl || (slug ? `https://${slug}-dev.ulyssepro.org` : null);
  const productionUrl = status?.productionUrl || (slug ? `https://${slug}.ulyssepro.org` : null);
  const currentUrl = activeEnv === "staging" ? stagingUrl : productionUrl;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Eye className="w-4 h-4 text-cyan-400" /> Preview
        </h3>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl bg-muted/50 p-0.5">
            <button
              className={cn("px-3 py-1 text-xs rounded-lg transition-all", activeEnv === "staging" ? "bg-background shadow text-amber-400 font-medium" : "text-muted-foreground hover:text-foreground")}
              onClick={() => setActiveEnv("staging")}
              data-testid="preview-staging-toggle"
            >
              Staging
            </button>
            <button
              className={cn("px-3 py-1 text-xs rounded-lg transition-all", activeEnv === "production" ? "bg-background shadow text-emerald-400 font-medium" : "text-muted-foreground hover:text-foreground")}
              onClick={() => setActiveEnv("production")}
              data-testid="preview-production-toggle"
            >
              Production
            </button>
          </div>
          <Button size="icon" variant="ghost" className="rounded-xl" onClick={() => setIframeKey(k => k + 1)} data-testid="button-refresh-preview">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          {currentUrl && (
            <a href={currentUrl} target="_blank" rel="noopener noreferrer">
              <Button size="icon" variant="ghost" className="rounded-xl" data-testid="button-open-preview-external">
                <ExternalLink className="w-3.5 h-3.5" />
              </Button>
            </a>
          )}
        </div>
      </div>

      {currentUrl ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/30 rounded-xl">
            <Globe className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-mono text-muted-foreground flex-1 truncate">{currentUrl}</span>
            <Badge variant={activeEnv === "staging" ? "secondary" : "default"} className={cn("text-[10px]", activeEnv === "production" && "bg-emerald-600")}>
              {activeEnv === "staging" ? "TEST" : "LIVE"}
            </Badge>
          </div>
          <div className="rounded-xl border overflow-hidden bg-white" style={{ height: "500px" }}>
            <iframe
              key={iframeKey}
              src={currentUrl}
              className="w-full h-full border-0"
              title={`Preview ${activeEnv}`}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              data-testid={`preview-iframe-${activeEnv}`}
            />
          </div>
        </div>
      ) : (
        <Card className="border-dashed border-2">
          <CardContent className="p-8 text-center">
            <Eye className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">
              {activeEnv === "staging" ? "Pas de deploiement staging" : "Pas de deploiement production"}
            </p>
            <p className="text-xs text-zinc-600 mt-1">
              {activeEnv === "staging"
                ? "Deployez votre projet en staging via l'onglet Deploy ou demandez a MaxAI"
                : "Promouvez le staging en production via l'onglet Deploy"
              }
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function JournalPanel() {
  const { activeProject } = useDevmaxAuth();
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  const loadJournal = useCallback(async () => {
    if (!activeProject?.id) return;
    setLoading(true);
    try {
      const url = filter === "all"
        ? `${AUTH_API}/journal/${activeProject.id}`
        : `${AUTH_API}/journal/${activeProject.id}?type=${filter}`;
      const res = await fetch(url, { headers: { "x-devmax-token": localStorage.getItem(DEVMAX_TOKEN_KEY) || "" } });
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
      }
    } catch {} finally { setLoading(false); }
  }, [activeProject?.id, filter]);

  useEffect(() => { loadJournal(); }, [loadJournal]);

  const entryTypeIcon = (t: string) => {
    switch (t) {
      case "code_edit": case "fix": case "refactor": return <Code className="w-3.5 h-3.5 text-blue-400" />;
      case "deploy": return <Rocket className="w-3.5 h-3.5 text-green-400" />;
      case "config": return <Settings className="w-3.5 h-3.5 text-yellow-400" />;
      case "review": return <Eye className="w-3.5 h-3.5 text-purple-400" />;
      case "plan": return <BookOpen className="w-3.5 h-3.5 text-cyan-400" />;
      case "roadmap": return <Target className="w-3.5 h-3.5 text-emerald-400" />;
      case "task_status": return <CheckCircle className="w-3.5 h-3.5 text-amber-400" />;
      case "scaffold": return <FolderPlus className="w-3.5 h-3.5 text-orange-400" />;
      default: return <Activity className="w-3.5 h-3.5 text-gray-400" />;
    }
  };

  const entryTypes = ["all", "roadmap", "task_status", "plan", "code_edit", "deploy", "config", "review", "note", "scaffold", "fix", "refactor"];

  if (!activeProject) return <div className="text-center text-gray-400 py-8">Sélectionne un projet</div>;

  return (
    <div className="space-y-4" data-testid="journal-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <BookOpen className="w-4 h-4" /> Journal du projet
        </h3>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="text-xs bg-gray-800 border border-gray-700 text-white rounded px-2 py-1"
            data-testid="journal-filter"
          >
            {entryTypes.map(t => (
              <option key={t} value={t}>{t === "all" ? "Tout" : t}</option>
            ))}
          </select>
          <Button size="sm" variant="ghost" onClick={loadJournal} data-testid="journal-refresh">
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
      ) : entries.length === 0 ? (
        <div className="text-center text-gray-500 py-8 text-sm">
          Aucune entrée dans le journal. MaxAI ajoutera automatiquement des entrées lors de ses actions.
        </div>
      ) : (
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {entries.map((entry: any, i: number) => (
            <div key={entry.id || i} className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50" data-testid={`journal-entry-${i}`}>
              <div className="flex items-start gap-2">
                {entryTypeIcon(entry.entry_type)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white truncate">{entry.title}</span>
                    <span className="text-[10px] text-gray-500 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(entry.created_at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  {entry.description && <p className="text-xs text-gray-400 mt-1">{entry.description}</p>}
                  {entry.files_changed && entry.files_changed.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {entry.files_changed.slice(0, 5).map((f: string, fi: number) => (
                        <span key={fi} className="text-[10px] bg-gray-700/50 text-gray-300 px-1.5 py-0.5 rounded">{f}</span>
                      ))}
                      {entry.files_changed.length > 5 && <span className="text-[10px] text-gray-500">+{entry.files_changed.length - 5}</span>}
                    </div>
                  )}
                  <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-400">{entry.entry_type}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const QUICK_COMMANDS: { icon: string; label: string; cmd: string; tab?: string; color: string }[] = [
  { icon: "🔍", label: "Status repo", cmd: "Donne-moi le status complet du repo: branches actives, derniers commits, PRs ouvertes, workflows CI/CD, et santé générale.", color: "emerald" },
  { icon: "🚀", label: "Deploy staging", cmd: "Déploie la branche main en staging. Lance le pipeline complet: preflight → backup → build → test → security → deploy → health check. Vérifie que l'URL staging est opérationnelle après.", color: "blue" },
  { icon: "⬆️", label: "Promote prod", cmd: "Promote le staging vers la production. Fais un backup avant, puis vérifie que l'URL production est opérationnelle après avec url_diagnose_all.", color: "purple" },
  { icon: "🔄", label: "Rollback", cmd: "Liste les snapshots de déploiement disponibles et propose un rollback si nécessaire.", color: "amber" },
  { icon: "🛡️", label: "Security scan", cmd: "Lance un scan de sécurité complet: secrets exposés, vulnérabilités des dépendances, headers HTTP, certificat SSL, patterns dangereux dans le code.", color: "red" },
  { icon: "📊", label: "Perf audit", cmd: "Analyse les performances de l'app: profile_app (CPU/mem/heap/TTFB), bundle_analyze (tailles, gzip, deps inutiles), et architecture_analyze (complexité, couplage, circular deps).", color: "cyan" },
  { icon: "🔧", label: "Fix URLs", cmd: "Lance url_diagnose_all pour diagnostiquer et corriger automatiquement TOUTES les URLs du projet (staging + production). Corrige les 502, 404, Nginx, PM2, SSL.", color: "orange" },
  { icon: "📝", label: "Full audit", cmd: "Audit profond complet du projet: browse_files, analyse architecture, security_scan, db_inspect, performance profile, CI/CD status, et synthèse avec recommandations.", color: "violet" },
];

const TAB_SUGGESTIONS: Record<string, { label: string; cmd: string }[]> = {
  overview: [
    { label: "Résumé santé projet", cmd: "Donne un résumé de santé du projet: dernière activité, derniers commits, PRs, état CI/CD, et métriques clés." },
    { label: "Recommandations", cmd: "Analyse le projet et propose les 5 améliorations prioritaires à faire maintenant." },
  ],
  branches: [
    { label: "Créer feature branch", cmd: "Crée une nouvelle branche feature/ à partir de main. Propose un nom basé sur les issues ouvertes ou le travail en cours." },
    { label: "Nettoyer branches", cmd: "Liste toutes les branches mergées ou stale (>30 jours sans commit) et propose un nettoyage." },
  ],
  commits: [
    { label: "Changelog récent", cmd: "Génère un changelog structuré à partir des 20 derniers commits (groupé par type: feat, fix, refactor, docs)." },
    { label: "Hotspots code", cmd: "Analyse les fichiers les plus modifiés récemment (hotspots) et identifie les zones à risque." },
  ],
  prs: [
    { label: "Review PR ouverte", cmd: "Prends la PR ouverte la plus récente, lis les changements, et fais une code review détaillée: qualité, bugs potentiels, suggestions." },
    { label: "Créer PR", cmd: "Crée une PR depuis la branche feature la plus récente vers main avec un titre et description auto-générés basés sur les commits." },
  ],
  cicd: [
    { label: "Relancer dernier run", cmd: "Relance le dernier workflow GitHub Actions qui a échoué. Analyse les logs d'erreur avant de relancer." },
    { label: "Diagnostic CI/CD", cmd: "Analyse tous les workflows: taux de succès, durées moyennes, échecs récurrents, et propose des optimisations." },
  ],
  files: [
    { label: "Architecture overview", cmd: "Fais un architecture_analyze complet: structure des dossiers, métriques, deps circulaires, complexité, et design patterns détectés." },
    { label: "Docs auto", cmd: "Génère la documentation automatique du projet avec docs_generate: README, structure, API endpoints, et commit DOCS.md." },
  ],
  deploy: [
    { label: "Pipeline complet", cmd: "Lance le full_pipeline: preflight → backup → build → test → security → deploy → health check. Rapport complet à chaque étape." },
    { label: "Status déploiement", cmd: "Vérifie le status de déploiement actuel: état staging, état production, derniers snapshots, et URLs opérationnelles." },
  ],
  rollback: [
    { label: "Lister snapshots", cmd: "Liste tous les snapshots de déploiement disponibles avec dates, branches, et tailles." },
    { label: "Rollback sécurisé", cmd: "Propose un rollback vers le dernier snapshot stable. Vérifie la santé avant et après." },
  ],
};

