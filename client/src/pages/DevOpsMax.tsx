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
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ThemeToggle";
import { DevMaxRightPanel } from "@/components/DevMaxRightPanel";
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

const DEVMAX_TABS = [
  { id: "overview", label: "Apercu", icon: Activity, color: "text-emerald-400" },
  { id: "branches", label: "Branches", icon: GitBranch, needsRepo: true, color: "text-cyan-400" },
  { id: "commits", label: "Commits", icon: GitCommit, needsRepo: true, color: "text-blue-400" },
  { id: "prs", label: "PRs", icon: GitPullRequest, needsRepo: true, color: "text-purple-400" },
  { id: "cicd", label: "CI/CD", icon: Play, needsRepo: true, color: "text-green-400" },
  { id: "files", label: "Fichiers", icon: FileCode, needsRepo: true, color: "text-yellow-400" },
  { id: "files-test", label: "Tests", icon: FlaskConical, needsRepo: true, color: "text-amber-400" },
  { id: "rollback", label: "Rollback", icon: RotateCcw, needsRepo: true, color: "text-orange-400" },
  { id: "deploy", label: "Deploy", icon: Rocket, needsRepo: true, color: "text-red-400" },
  { id: "preview", label: "Preview", icon: Eye, needsRepo: true, color: "text-teal-400" },
  { id: "dgm", label: "DGM", icon: Zap, needsRepo: true, color: "text-yellow-300" },
  { id: "github", label: "GitHub", icon: Shield, needsRepo: true, color: "text-slate-300" },
  { id: "journal", label: "Journal", icon: BookOpen, needsRepo: true, color: "text-indigo-400" },
  { id: "envvars", label: "Env Vars", icon: Key, needsRepo: true, color: "text-pink-400" },
  { id: "logs", label: "Logs", icon: ScrollText, needsRepo: true, color: "text-violet-400" },
  { id: "metrics", label: "Metriques", icon: BarChart3, needsRepo: true, color: "text-cyan-300" },
  { id: "domains", label: "Domaines", icon: Globe, needsRepo: true, color: "text-sky-400" },
  { id: "costs", label: "Couts", icon: DollarSign, needsRepo: true, color: "text-lime-400" },
  { id: "events", label: "Events", icon: Activity, needsRepo: true, color: "text-orange-300" },
  { id: "health", label: "Health", icon: HeartPulse, needsRepo: true, color: "text-rose-400" },
  { id: "secrets", label: "Secrets", icon: KeyRound, needsRepo: true, color: "text-fuchsia-400" },
  { id: "deploy-history", label: "Historique", icon: History, needsRepo: true, color: "text-emerald-300" },
  { id: "notifications", label: "Notifs", icon: Bell, color: "text-amber-300" },
  { id: "plan", label: "Plan", icon: CreditCard, color: "text-green-300" },
  { id: "chat", label: "MaxAI", icon: Bot, color: "text-blue-300" },
  { id: "account", label: "Compte", icon: Settings, color: "text-slate-400" },
];

function DevmaxDashboard() {
  const { logout, activeProject, setActiveProject } = useDevmaxAuth();
  const shouldAutoAudit = !!activeProject?._triggerAudit;
  const [activeTab, setActiveTab] = useState(shouldAutoAudit ? "chat" : "overview");
  const [time, setTime] = useState(new Date().toLocaleTimeString("fr-FR", { hour12: false }));
  const pid = activeProject?.id || "";

  useEffect(() => {
    if (pid) setActiveTab(shouldAutoAudit ? "chat" : "overview");
  }, [pid]);

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date().toLocaleTimeString("fr-FR", { hour12: false }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

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

  const hasRepo = !!activeProject?.repo_owner && !!activeProject?.repo_name;
  const visibleTabs = DEVMAX_TABS.filter(t => !t.needsRepo || hasRepo);

  const renderTabContent = () => {
    switch (activeTab) {
      case "overview": return <OverviewPanel repo={repo} repoLoading={repoLoading} />;
      case "branches": return hasRepo ? <BranchesPanel /> : null;
      case "commits": return hasRepo ? <CommitsPanel /> : null;
      case "prs": return hasRepo ? <PullRequestsPanel /> : null;
      case "cicd": return hasRepo ? <CICDPanel /> : null;
      case "files": return hasRepo ? <FileBrowserPanel /> : null;
      case "files-test": return hasRepo ? <StagingFileBrowserPanel /> : null;
      case "rollback": return hasRepo ? <RollbackPanel /> : null;
      case "deploy": return hasRepo ? <DeployPanel /> : null;
      case "preview": return hasRepo ? <PreviewPanel /> : null;
      case "dgm": return hasRepo ? <DGMPanel /> : null;
      case "github": return hasRepo ? <GitHubConnectionPanel /> : null;
      case "journal": return hasRepo ? <JournalPanel /> : null;
      case "envvars": return hasRepo ? <EnvVarsPanel /> : null;
      case "logs": return hasRepo ? <LogsPanel /> : null;
      case "metrics": return hasRepo ? <MetricsPanel /> : null;
      case "domains": return hasRepo ? <CustomDomainsPanel /> : null;
      case "costs": return hasRepo ? <CostsDashboardPanel /> : null;
      case "events": return hasRepo ? <GitHubEventsPanel /> : null;
      case "health": return hasRepo ? <HealthChecksPanel /> : null;
      case "secrets": return hasRepo ? <SecretsManagerPanel /> : null;
      case "deploy-history": return hasRepo ? <DeployHistoryPanel /> : null;
      case "notifications": return <NotificationsPanel />;
      case "plan": return <PlanBillingPanel />;
      case "chat": return <DevOpsChatPanel currentTab={activeTab} />;
      case "account": return <MonComptePanel />;
      default: return <OverviewPanel repo={repo} repoLoading={repoLoading} />;
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-cyan-50 font-sans overflow-hidden relative selection:bg-cyan-500/30" data-testid="devops-max-page">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#00d4ff08_1px,transparent_1px),linear-gradient(to_bottom,#00d4ff08_1px,transparent_1px)] bg-[size:40px_40px] opacity-30" />
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/8 rounded-full blur-[128px]" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-500/8 rounded-full blur-[128px]" />
      </div>

      <div className="relative z-10 flex flex-col h-screen max-h-screen p-3 gap-3">
        <header className="flex items-center justify-between h-14 shrink-0 border border-cyan-500/20 bg-black/40 backdrop-blur-md rounded-xl px-5 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent opacity-50" />

          <div className="flex items-center gap-3">
            <button onClick={() => setActiveProject(null)} className="relative w-9 h-9 flex items-center justify-center group" data-testid="button-back-projects">
              <div className="absolute inset-0 rounded-full border-2 border-cyan-500/50 animate-[spin_4s_linear_infinite]" />
              <div className="absolute inset-1 rounded-full border border-blue-500/50 animate-[spin_3s_linear_infinite_reverse]" />
              <Terminal className="w-4 h-4 text-cyan-400" />
            </button>
            <div>
              <h1 className="text-lg font-bold tracking-widest text-cyan-400 uppercase drop-shadow-[0_0_8px_rgba(0,212,255,0.8)]" data-testid="text-page-title">DEVMAX</h1>
              <div className="text-[9px] font-mono text-cyan-500/70 tracking-widest">INFRASTRUCTURE & DEPLOY</div>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-4 font-mono text-xs">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/30">
                <GitBranch className="w-3 h-3 text-cyan-400" />
                <span className="text-cyan-300 font-bold">{branches?.length || 0}</span>
                <span className="text-cyan-400/60 text-[10px]">branches</span>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-purple-500/10 border border-purple-500/30">
                <GitPullRequest className="w-3 h-3 text-purple-400" />
                <span className="text-purple-300 font-bold">{pulls?.length || 0}</span>
                <span className="text-purple-400/60 text-[10px]">PR</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 font-mono">
            <div className="hidden sm:flex items-center gap-2 px-2 py-1 rounded-lg bg-cyan-950/30 border border-cyan-900/40">
              <div className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_4px_rgba(0,212,255,0.5)]" />
              <span className="text-[10px] text-cyan-400/80 uppercase tracking-wider">{activeProject?.name || "—"}</span>
              <span className="text-[9px] text-cyan-600 font-mono">{repo?.default_branch || "main"}</span>
            </div>
            <div className="hidden sm:block h-7 w-px bg-cyan-900/50" />
            <div className="flex items-center gap-2 text-lg tracking-wider text-cyan-100 drop-shadow-[0_0_5px_rgba(0,212,255,0.5)]">
              <Clock className="w-4 h-4 text-cyan-500" />
              {time}
            </div>
            <button onClick={logout} className="p-1.5 rounded-lg border border-cyan-900/40 text-cyan-600 hover:text-cyan-300 hover:border-cyan-500/40 transition-all" data-testid="button-logout-devmax">
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </header>

        <div className="flex flex-1 gap-3 overflow-hidden">
          <aside className="w-[140px] shrink-0 overflow-y-auto no-scrollbar pb-2">
            <div className="grid grid-cols-2 gap-1.5">
              {visibleTabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    data-testid={`tab-${tab.id}`}
                    className={cn(
                      "relative group flex flex-col items-center justify-center gap-1 p-2 rounded-xl border transition-all duration-200",
                      isActive
                        ? "border-cyan-500/50 bg-cyan-950/30 shadow-[0_0_15px_rgba(0,212,255,0.15)]"
                        : "border-cyan-900/20 bg-black/30 hover:border-cyan-700/50 hover:bg-cyan-950/20"
                    )}
                  >
                    <Icon className={cn("w-5 h-5", isActive ? "text-cyan-300" : tab.color)} />
                    <span className={cn(
                      "text-[8px] uppercase tracking-wider font-mono leading-tight text-center",
                      isActive ? "text-cyan-300" : "text-cyan-600 group-hover:text-cyan-400"
                    )}>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </aside>

          <main className="flex-1 flex flex-col relative border border-cyan-500/20 bg-black/40 backdrop-blur-md rounded-xl overflow-hidden shadow-[0_0_30px_rgba(0,212,255,0.05)]">
            <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-cyan-400 rounded-tl-xl" />
            <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-cyan-400 rounded-tr-xl" />
            <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-cyan-400 rounded-bl-xl" />
            <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-cyan-400 rounded-br-xl" />

            <div className="px-4 py-2 border-b border-cyan-500/20 bg-black/30 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                {(() => { const tab = visibleTabs.find(t => t.id === activeTab); const Icon = tab?.icon || Activity; return <Icon className="w-3.5 h-3.5 text-cyan-500" />; })()}
                <span className="text-xs font-mono text-cyan-400 tracking-wider uppercase">{visibleTabs.find(t => t.id === activeTab)?.label || "APERCU"}</span>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono text-cyan-600">
                <span>{repoFull || "—"}</span>
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_4px_rgba(0,212,255,0.5)]" />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {renderTabContent()}
            </div>
          </main>

          <div className="hidden lg:block">
            <DevMaxRightPanel />
          </div>
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
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    root.classList.add("dark");
    return () => {
      if (!hadDark) root.classList.remove("dark");
    };
  }, []);

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
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
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

