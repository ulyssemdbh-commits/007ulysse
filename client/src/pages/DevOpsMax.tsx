import { useState, useEffect, useCallback } from "react";
import { useQuery, QueryClientProvider } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { motion } from "framer-motion";
import {
  GitBranch,
  GitCommit,
  GitPullRequest,
  ExternalLink,
  CheckCircle,
  XCircle,
  Loader2,
  FileCode,
  Play,
  RotateCcw,
  Activity,
  ArrowLeft,
  Bot,
  Rocket,
  Terminal,
  Zap,
  Shield,
  Eye,
  LogOut,
  Settings,
  Globe,
  BookOpen,
  Bell,
  Key,
  BarChart3,
  ScrollText,
  CreditCard,
  DollarSign,
  History,
  HeartPulse,
  KeyRound,
  FlaskConical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ThemeToggle";
import DevMaxLanding from "./DevMaxLanding";
import {
  API,
  AUTH_API,
  DEVMAX_TOKEN_KEY,
  devmaxQueryClient,
  getDevmaxToken,
  devmaxFetch,
  useDevmaxAuth,
  DevmaxAuthContext,
  DevmaxProject,
  DevmaxUser,
  Branch,
  PullRequest,
  WorkflowRun,
} from "./devmax/types";
import { MarkdownContent, DevmaxLoginScreen, ProjectSelector } from "./devmax/AuthScreens";
import { BranchesPanel, CommitsPanel, PullRequestsPanel } from "./devmax/GitPanels";
import { LivePreviewPanel, GitHubConnectionPanel, ConnectedReposSection } from "./devmax/InfraPanels";
import { DeployPanel, DeployRollbackSection, CICDPanel } from "./devmax/DeployPanels";
import { FileBrowserPanel, StagingFileBrowserPanel } from "./devmax/FileBrowserPanels";
import { CostsDashboardPanel, GitHubEventsPanel, HealthChecksPanel, SecretsManagerPanel, DeployHistoryPanel, RollbackPanel } from "./devmax/MiscPanels";
import { DGMPanel, PreviewPanel, JournalPanel } from "./devmax/DGMPanel";
import { DevOpsChatPanel } from "./devmax/ChatPanel";
import { OverviewPanel, EnvVarsPanel, NotificationsPanel, CustomDomainsPanel, LogsPanel } from "./devmax/SettingsPanels";
import { MetricsPanel, PlanBillingPanel } from "./devmax/MonitoringPanels";
import { MonComptePanel } from "./devmax/ProfilePanels";

function DevmaxDashboard() {
  const { logout, activeProject, setActiveProject } = useDevmaxAuth();
  const shouldAutoAudit = !!activeProject?._triggerAudit;
  const [activeTab, setActiveTab] = useState(shouldAutoAudit ? "chat" : "overview");
  const pid = activeProject?.id || "";

  useEffect(() => {
    if (pid) setActiveTab(shouldAutoAudit ? "chat" : "overview");
  }, [pid]);
  const repoUrl = activeProject?.repo_url || "";
  const repoFull = activeProject?.repo_owner && activeProject?.repo_name
    ? `${activeProject.repo_owner}/${activeProject.repo_name}`
    : "";

  const { data: repo, isLoading: repoLoading } = useQuery({
    queryKey: [API, "repo", pid],
    queryFn: () => devmaxFetch(`${API}/repo`, undefined, pid).then(r => r.json()),
    enabled: !!pid && !!activeProject?.repo_owner,
  });

  const { data: branches } = useQuery<Branch[]>({
    queryKey: [API, "branches", "stats", pid],
    queryFn: () => devmaxFetch(`${API}/branches`, undefined, pid).then(r => r.json()).then(d => Array.isArray(d) ? d : []),
    enabled: !!pid && !!activeProject?.repo_owner,
  });

  const { data: pulls } = useQuery<PullRequest[]>({
    queryKey: [API, "pulls", "open", "stats", pid],
    queryFn: () => devmaxFetch(`${API}/pulls?state=open`, undefined, pid).then(r => r.json()).then(d => Array.isArray(d) ? d : []),
    enabled: !!pid && !!activeProject?.repo_owner,
  });

  const { data: runs } = useQuery<{ workflow_runs: WorkflowRun[] }>({
    queryKey: [API, "actions", "runs", "stats", pid],
    queryFn: () => devmaxFetch(`${API}/actions/runs`, undefined, pid).then(r => r.json()).then(d => d?.workflow_runs ? d : { workflow_runs: [] }),
    enabled: !!pid && !!activeProject?.repo_owner,
  });

  const { data: headerDeploys } = useQuery<{ deployments: any[] }>({
    queryKey: [API, "deployments", "stats", pid],
    queryFn: () => devmaxFetch(`${API}/deployments?limit=5`, undefined, pid).then(r => r.json()),
    enabled: !!pid,
  });

  const lastRun = runs?.workflow_runs?.[0];
  const lastDeploy = headerDeploys?.deployments?.[0];
  const ciStatus = lastRun?.conclusion === "success" ? "success" : lastRun?.conclusion === "failure" ? "failure" : lastRun?.status === "in_progress" ? "running" :
    lastDeploy?.status === "success" ? "success" : lastDeploy?.status === "failed" ? "failure" : lastDeploy?.status === "pending" ? "running" :
    activeProject?.last_deployed_at ? "success" : "idle";
  const hasRepo = !!activeProject?.repo_owner && !!activeProject?.repo_name;

  return (
    <div className="min-h-screen bg-background pt-safe" data-testid="devops-max-page">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-cyan-500/5 to-blue-500/5" />
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-500/8 rounded-full blur-3xl" />
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-cyan-500/8 rounded-full blur-3xl" />

        <div className="relative max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2 sm:gap-4 min-w-0">
              <Button size="sm" variant="ghost" className="rounded-xl text-muted-foreground shrink-0" onClick={() => setActiveProject(null)} data-testid="button-back-projects">
                <ArrowLeft className="w-4 h-4 sm:mr-1" /> <span className="hidden sm:inline">Projets</span>
              </Button>
              <div className="relative min-w-0">
                <div className="absolute -inset-2 bg-gradient-to-r from-emerald-500/20 via-cyan-500/20 to-blue-500/20 rounded-2xl blur-lg" />
                <div className="relative flex items-center gap-2 sm:gap-3 bg-background/80 backdrop-blur-sm rounded-xl px-3 sm:px-4 py-2 border border-white/10 min-w-0">
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center shrink-0">
                    <Terminal className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                  </div>
                  <div className="min-w-0">
                    <h1 className="text-lg sm:text-2xl font-black tracking-tight bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-400 bg-clip-text text-transparent truncate" data-testid="text-page-title">
                      {activeProject?.name || "DevMax"}
                    </h1>
                    <p className="text-[10px] sm:text-xs text-muted-foreground font-mono truncate">{repoFull || "Pas de repo"}</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
              {repo && (
                <div className="hidden sm:flex items-center gap-2">
                  {repo.language && <Badge variant="secondary" className="rounded-lg">{repo.language}</Badge>}
                  <Badge variant="outline" className="text-xs font-mono rounded-lg">{repo.default_branch || "main"}</Badge>
                </div>
              )}
              {repoUrl && (
                <a href={repoUrl} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="rounded-xl" data-testid="button-open-github">
                    <ExternalLink className="w-3.5 h-3.5 sm:mr-1" /> <span className="hidden sm:inline">GitHub</span>
                  </Button>
                </a>
              )}
              <ThemeToggle />
              <Button size="sm" variant="ghost" className="rounded-xl text-muted-foreground" onClick={logout} data-testid="button-logout-devmax">
                <LogOut className="w-3.5 h-3.5 sm:mr-1" /> <span className="hidden sm:inline">Verrouiller</span>
              </Button>
            </div>
          </motion.div>

          {hasRepo && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.05 }}>
                <Card className="bg-gradient-to-br from-emerald-500/10 to-green-500/10 border-emerald-500/20 cursor-pointer hover:border-emerald-400/40 transition-colors" onClick={() => setActiveTab("branches")}>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-black">{branches?.length || 0}</p>
                    <p className="text-xs text-muted-foreground flex items-center justify-center gap-1"><GitBranch className="w-3 h-3" /> Branches</p>
                  </CardContent>
                </Card>
              </motion.div>
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 }}>
                <Card className="bg-gradient-to-br from-purple-500/10 to-violet-500/10 border-purple-500/20 cursor-pointer hover:border-purple-400/40 transition-colors" onClick={() => setActiveTab("prs")}>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-black text-purple-400">{pulls?.length || 0}</p>
                    <p className="text-xs text-muted-foreground flex items-center justify-center gap-1"><GitPullRequest className="w-3 h-3" /> PRs Ouvertes</p>
                  </CardContent>
                </Card>
              </motion.div>
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.15 }}>
                <Card className={cn(
                  "border cursor-pointer hover:shadow-md transition-all",
                  ciStatus === "success" ? "bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border-emerald-500/20" :
                  ciStatus === "failure" ? "bg-gradient-to-br from-red-500/10 to-rose-500/10 border-red-500/20" :
                  ciStatus === "running" ? "bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/20" :
                  "bg-gradient-to-br from-gray-500/10 to-slate-500/10 border-gray-500/20"
                )} onClick={() => setActiveTab("cicd")}>
                  <CardContent className="p-4 text-center">
                    {ciStatus === "success" ? <CheckCircle className="w-6 h-6 mx-auto text-emerald-400 mb-1" /> :
                     ciStatus === "failure" ? <XCircle className="w-6 h-6 mx-auto text-red-400 mb-1" /> :
                     ciStatus === "running" ? <Loader2 className="w-6 h-6 mx-auto text-amber-400 animate-spin mb-1" /> :
                     <Activity className="w-6 h-6 mx-auto text-muted-foreground mb-1" />}
                    <p className="text-xs text-muted-foreground">CI/CD {ciStatus === "success" ? "OK" : ciStatus === "failure" ? "Echec" : ciStatus === "running" ? "En cours" : "Inactif"}</p>
                  </CardContent>
                </Card>
              </motion.div>
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }}>
                <Card className="bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border-cyan-500/20 cursor-pointer hover:border-cyan-400/40 transition-colors" onClick={() => setActiveTab("chat")}>
                  <CardContent className="p-4 text-center">
                    <Zap className="h-6 w-6 mx-auto text-cyan-400 mb-1" />
                    <p className="text-xs text-muted-foreground">MaxAI</p>
                  </CardContent>
                </Card>
              </motion.div>
            </div>
          )}

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0 scrollbar-hide">
                <TabsList className="inline-flex w-max sm:w-full sm:flex-wrap justify-start rounded-xl bg-muted/50 p-1">
                  <TabsTrigger value="overview" className="text-xs gap-1 sm:gap-1.5 rounded-lg whitespace-nowrap" data-testid="tab-overview">
                    <Activity className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Vue d'ensemble</span><span className="sm:hidden">Aperçu</span>
                  </TabsTrigger>
                  {hasRepo && (
                    <>
                      <TabsTrigger value="branches" className="text-xs gap-1 sm:gap-1.5 rounded-lg whitespace-nowrap" data-testid="tab-branches">
                        <GitBranch className="w-3.5 h-3.5" /> Branches
                      </TabsTrigger>
                      <TabsTrigger value="commits" className="text-xs gap-1 sm:gap-1.5 rounded-lg whitespace-nowrap" data-testid="tab-commits">
                        <GitCommit className="w-3.5 h-3.5" /> Commits
                      </TabsTrigger>
                      <TabsTrigger value="prs" className="text-xs gap-1 sm:gap-1.5 rounded-lg whitespace-nowrap" data-testid="tab-prs">
                        <GitPullRequest className="w-3.5 h-3.5" /> PRs
                      </TabsTrigger>
                      <TabsTrigger value="cicd" className="text-xs gap-1 sm:gap-1.5 rounded-lg whitespace-nowrap" data-testid="tab-cicd">
                        <Play className="w-3.5 h-3.5" /> CI/CD
                      </TabsTrigger>
                      <TabsTrigger value="files" className="text-xs gap-1 sm:gap-1.5 rounded-lg whitespace-nowrap" data-testid="tab-files">
                        <FileCode className="w-3.5 h-3.5" /> Fichiers
                      </TabsTrigger>
                      <TabsTrigger value="files-test" className="text-xs gap-1 sm:gap-1.5 rounded-lg whitespace-nowrap" data-testid="tab-files-test">
                        <FlaskConical className="w-3.5 h-3.5" /> Fichiers-Test
                      </TabsTrigger>
                      <TabsTrigger value="rollback" className="text-xs gap-1 sm:gap-1.5 rounded-lg whitespace-nowrap" data-testid="tab-rollback">
                        <RotateCcw className="w-3.5 h-3.5" /> Rollback
                      </TabsTrigger>
                      <TabsTrigger value="deploy" className="text-xs gap-1 sm:gap-1.5 rounded-lg whitespace-nowrap" data-testid="tab-deploy">
                        <Rocket className="w-3.5 h-3.5" /> Deploy
                      </TabsTrigger>
                      <TabsTrigger value="preview" className="text-xs gap-1 sm:gap-1.5 rounded-lg whitespace-nowrap" data-testid="tab-preview">
                        <Eye className="w-3.5 h-3.5" /> Preview
                      </TabsTrigger>
                      <TabsTrigger value="dgm" className="text-xs gap-1 sm:gap-1.5 rounded-lg whitespace-nowrap" data-testid="tab-dgm">
                        <Zap className="w-3.5 h-3.5" /> DGM
                      </TabsTrigger>
                      <TabsTrigger value="github" className="text-xs gap-1 sm:gap-1.5 rounded-lg whitespace-nowrap" data-testid="tab-github">
                        <Shield className="w-3.5 h-3.5" /> GitHub
                      </TabsTrigger>
                      <TabsTrigger value="journal" className="text-xs gap-1 sm:gap-1.5 rounded-lg whitespace-nowrap" data-testid="tab-journal">
                        <BookOpen className="w-3.5 h-3.5" /> Journal
                      </TabsTrigger>
                      <TabsTrigger value="envvars" className="text-xs gap-1 sm:gap-1.5 rounded-lg whitespace-nowrap" data-testid="tab-envvars">
                        <Key className="w-3.5 h-3.5" /> Env Vars
                      </TabsTrigger>
                      <TabsTrigger value="logs" className="text-xs gap-1 sm:gap-1.5 rounded-lg whitespace-nowrap" data-testid="tab-logs">
                        <ScrollText className="w-3.5 h-3.5" /> Logs
                      </TabsTrigger>
                      <TabsTrigger value="metrics" className="text-xs gap-1 sm:gap-1.5 rounded-lg whitespace-nowrap" data-testid="tab-metrics">
                        <BarChart3 className="w-3.5 h-3.5" /> Métriques
                      </TabsTrigger>
                      <TabsTrigger value="domains" className="text-xs gap-1 sm:gap-1.5 rounded-lg whitespace-nowrap" data-testid="tab-domains">
                        <Globe className="w-3.5 h-3.5" /> Domaines
                      </TabsTrigger>
                      <TabsTrigger value="costs" className="text-xs gap-1 sm:gap-1.5 rounded-lg whitespace-nowrap" data-testid="tab-costs">
                        <DollarSign className="w-3.5 h-3.5" /> Coûts
                      </TabsTrigger>
                      <TabsTrigger value="events" className="text-xs gap-1 sm:gap-1.5 rounded-lg whitespace-nowrap" data-testid="tab-events">
                        <Activity className="w-3.5 h-3.5" /> Events
                      </TabsTrigger>
                      <TabsTrigger value="health" className="text-xs gap-1 sm:gap-1.5 rounded-lg whitespace-nowrap" data-testid="tab-health">
                        <HeartPulse className="w-3.5 h-3.5" /> Health
                      </TabsTrigger>
                      <TabsTrigger value="secrets" className="text-xs gap-1 sm:gap-1.5 rounded-lg whitespace-nowrap" data-testid="tab-secrets">
                        <KeyRound className="w-3.5 h-3.5" /> Secrets
                      </TabsTrigger>
                      <TabsTrigger value="deploy-history" className="text-xs gap-1 sm:gap-1.5 rounded-lg whitespace-nowrap" data-testid="tab-deploy-history">
                        <History className="w-3.5 h-3.5" /> Historique
                      </TabsTrigger>
                    </>
                  )}
                  <TabsTrigger value="notifications" className="text-xs gap-1 sm:gap-1.5 rounded-lg whitespace-nowrap" data-testid="tab-notifications">
                    <Bell className="w-3.5 h-3.5" /> Notifs
                  </TabsTrigger>
                  <TabsTrigger value="plan" className="text-xs gap-1 sm:gap-1.5 rounded-lg whitespace-nowrap" data-testid="tab-plan">
                    <CreditCard className="w-3.5 h-3.5" /> Plan
                  </TabsTrigger>
                  <TabsTrigger value="chat" className="text-xs gap-1 sm:gap-1.5 rounded-lg whitespace-nowrap" data-testid="tab-devops-chat">
                    <Bot className="w-3.5 h-3.5" /> MaxAI
                  </TabsTrigger>
                  <TabsTrigger value="account" className="text-xs gap-1 sm:gap-1.5 rounded-lg whitespace-nowrap" data-testid="tab-account">
                    <Settings className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Mon Compte</span><span className="sm:hidden">Compte</span>
                  </TabsTrigger>
                </TabsList>
              </div>

              <div className="mt-4">
                <TabsContent value="overview"><OverviewPanel repo={repo} repoLoading={repoLoading} /></TabsContent>
                {hasRepo && (
                  <>
                    <TabsContent value="branches"><BranchesPanel /></TabsContent>
                    <TabsContent value="commits"><CommitsPanel /></TabsContent>
                    <TabsContent value="prs"><PullRequestsPanel /></TabsContent>
                    <TabsContent value="cicd"><CICDPanel /></TabsContent>
                    <TabsContent value="files"><FileBrowserPanel /></TabsContent>
                    <TabsContent value="files-test"><StagingFileBrowserPanel /></TabsContent>
                    <TabsContent value="rollback"><RollbackPanel /></TabsContent>
                    <TabsContent value="deploy"><DeployPanel /></TabsContent>
                    <TabsContent value="preview"><PreviewPanel /></TabsContent>
                    <TabsContent value="dgm"><DGMPanel /></TabsContent>
                    <TabsContent value="github"><GitHubConnectionPanel /></TabsContent>
                    <TabsContent value="journal"><JournalPanel /></TabsContent>
                    <TabsContent value="envvars"><EnvVarsPanel /></TabsContent>
                    <TabsContent value="logs"><LogsPanel /></TabsContent>
                    <TabsContent value="metrics"><MetricsPanel /></TabsContent>
                    <TabsContent value="domains"><CustomDomainsPanel /></TabsContent>
                    <TabsContent value="costs"><CostsDashboardPanel /></TabsContent>
                    <TabsContent value="events"><GitHubEventsPanel /></TabsContent>
                    <TabsContent value="health"><HealthChecksPanel /></TabsContent>
                    <TabsContent value="secrets"><SecretsManagerPanel /></TabsContent>
                    <TabsContent value="deploy-history"><DeployHistoryPanel /></TabsContent>
                  </>
                )}
                <TabsContent value="notifications"><NotificationsPanel /></TabsContent>
                <TabsContent value="plan"><PlanBillingPanel /></TabsContent>
                <TabsContent value="chat"><DevOpsChatPanel currentTab={activeTab} /></TabsContent>
                <TabsContent value="account"><MonComptePanel /></TabsContent>
              </div>
            </Tabs>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

export default function DevOpsMaxPage() {
  const [sessionId, setSessionId] = useState<string | null>(getDevmaxToken());
  const [isValidating, setIsValidating] = useState(true);
  const [activeProject, setActiveProject] = useState<DevmaxProject | null>(null);
  const [currentUser, setCurrentUser] = useState<DevmaxUser | null>(null);
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    const token = getDevmaxToken();
    if (!token) {
      setIsValidating(false);
      return;
    }
    fetch(`${AUTH_API}/session`, {
      headers: { "x-devmax-token": token },
    })
      .then(async (res) => {
        if (!res.ok) {
          localStorage.removeItem(DEVMAX_TOKEN_KEY);
          setSessionId(null);
        } else {
          const data = await res.json();
          if (data.user) setCurrentUser(data.user);
        }
      })
      .catch(() => {
        localStorage.removeItem(DEVMAX_TOKEN_KEY);
        setSessionId(null);
      })
      .finally(() => setIsValidating(false));
  }, []);

  const handleLogout = useCallback(() => {
    const token = getDevmaxToken();
    if (token) {
      fetch(`${AUTH_API}/logout`, {
        method: "POST",
        headers: { "x-devmax-token": token },
      }).catch(() => {});
    }
    localStorage.removeItem(DEVMAX_TOKEN_KEY);
    setSessionId(null);
    setActiveProject(null);
    setCurrentUser(null);
    setShowLogin(false);
  }, []);

  const handleLoginSuccess = useCallback((sid: string, user?: DevmaxUser) => {
    setSessionId(sid);
    if (user) setCurrentUser(user);
    setShowLogin(false);
    window.history.replaceState(null, "", "/devmax/devopsmax");
  }, []);

  const handleSelectProject = useCallback((project: DevmaxProject) => {
    setActiveProject(project);
  }, []);

  if (isValidating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-zinc-950">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center animate-pulse">
            <Terminal className="w-8 h-8 text-white" />
          </div>
          <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
        </div>
      </div>
    );
  }

  if (!sessionId) {
    if (showLogin) {
      return (
        <div className="relative">
          <button
            onClick={() => setShowLogin(false)}
            className="absolute top-4 left-4 z-50 flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
            data-testid="back-to-landing"
          >
            <ArrowLeft className="w-4 h-4" />
            Retour
          </button>
          <DevmaxLoginScreen onSuccess={handleLoginSuccess} />
        </div>
      );
    }
    return <DevMaxLanding onGoToLogin={() => setShowLogin(true)} />;
  }

  return (
    <DevmaxAuthContext.Provider value={{ isAuthenticated: true, sessionId, currentUser, logout: handleLogout, activeProject, setActiveProject }}>
      <QueryClientProvider client={devmaxQueryClient}>
        {activeProject ? (
          <DevmaxDashboard />
        ) : (
          <ProjectSelector onSelect={handleSelectProject} />
        )}
      </QueryClientProvider>
    </DevmaxAuthContext.Provider>
  );
}

