import { useState, useRef, useEffect, useCallback, useMemo, memo, createContext, useContext } from "react";
import { useQuery, useMutation, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Home,
  GitBranch,
  GitCommit,
  GitPullRequest,
  RefreshCw,
  Plus,
  ExternalLink,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  FileCode,
  Send,
  Play,
  RotateCcw,
  StopCircle,
  Folder,
  File,
  ChevronRight,
  Activity,
  Trash2,
  Code,
  Search,
  ArrowLeft,
  Bot,
  Rocket,
  Terminal,
  Zap,
  Shield,
  Eye,
  Star,
  GitFork,
  Minimize2,
  Maximize2,
  X,
  MessageSquare,
  Paperclip,
  ImageIcon,
  Lock,
  Delete,
  CheckCircle2,
  LogOut,
  FolderPlus,
  Settings,
  Edit3,
  Upload,
  Globe,
  ArrowRight,
  ArrowUpCircle,
  BookOpen,
  Bell,
  Key,
  BarChart3,
  ScrollText,
  CreditCard,
  Gauge,
  BellRing,
  Copy,
  EyeOff,
  AlertTriangle,
  Wifi,
  WifiOff,
  Cpu,
  HardDrive,
  TrendingUp,
  Package,
  Target,
  DollarSign,
  History,
  HeartPulse,
  KeyRound,
  Diff,
  Cloud,
  FlaskConical,
  Merge,
  Save,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ThemeToggle";
import DevMaxLanding from "./DevMaxLanding";

const API = "/api/devmax/ops";
const AUTH_API = "/api/devmax";
const DEVMAX_TOKEN_KEY = "devmax_session_token";
const devmaxQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: 1,
    },
  },
});

function getDevmaxToken(): string | null {
  return localStorage.getItem(DEVMAX_TOKEN_KEY);
}

function devmaxFetch(url: string, options?: RequestInit, projectId?: string): Promise<Response> {
  const token = getDevmaxToken();
  const headers: Record<string, string> = {
    ...options?.headers as Record<string, string>,
    "x-devmax-token": token || "",
  };
  if (projectId) {
    headers["x-devmax-project"] = projectId;
  }
  return fetch(url, {
    ...options,
    headers,
  });
}

async function devmaxApiRequest(method: string, url: string, body?: any, projectId?: string): Promise<any> {
  const res = await devmaxFetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }, projectId);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(data.error || "Request failed");
  }
  return res.json();
}

function generateFingerprint(): string {
  let fp = localStorage.getItem("devmax_fp");
  if (!fp) {
    try {
      fp = crypto.randomUUID();
    } catch {
      fp = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    }
    localStorage.setItem("devmax_fp", fp);
  }
  return fp;
}

interface DevmaxProject {
  id: string;
  name: string;
  description?: string;
  repo_owner?: string;
  repo_name?: string;
  repo_url?: string;
  deploy_slug?: string;
  created_at?: string;
  updated_at?: string;
  staging_url?: string;
  production_url?: string;
  staging_port?: number;
  production_port?: number;
  environment?: string;
  last_deployed_at?: string;
  last_promoted_at?: string;
  cicd_enabled?: boolean;
  cicd_branch?: string;
  status?: string;
}

interface DevmaxUser {
  id: string;
  username: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: string;
  avatarUrl?: string;
  githubUsername?: string;
  phone?: string;
  bio?: string;
  timezone?: string;
  preferredLanguage?: string;
  tenantSlug?: string;
}

const DevmaxAuthContext = createContext<{
  isAuthenticated: boolean;
  sessionId: string | null;
  currentUser: DevmaxUser | null;
  logout: () => void;
  activeProject: DevmaxProject | null;
  setActiveProject: (p: DevmaxProject | null) => void;
}>({ isAuthenticated: false, sessionId: null, currentUser: null, logout: () => {}, activeProject: null, setActiveProject: () => {} });

function useDevmaxAuth() {
  return useContext(DevmaxAuthContext);
}

interface Branch {
  name: string;
  commit: { sha: string };
  protected: boolean;
}

interface Commit {
  sha: string;
  commit: { message: string; author: { name: string; date: string } };
  html_url: string;
}

interface PullRequest {
  number: number;
  title: string;
  state: string;
  html_url: string;
  user: { login: string; avatar_url: string };
  created_at: string;
  head: { ref: string };
  base: { ref: string };
  merged_at: string | null;
}

interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  head_branch: string;
  event: string;
  created_at: string;
  html_url: string;
  run_number: number;
}

interface TreeItem {
  path: string;
  type: string;
  size?: number;
  sha: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolActivity?: ToolActivity[];
  attachments?: { name: string; type: string; preview?: string }[];
}

interface ToolActivity {
  tool: string;
  label: string;
  status: "executing" | "done" | "error";
  durationMs?: number;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}j`;
  return `${Math.floor(days / 30)}mo`;
}

const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const isInline = !className;
          if (isInline) {
            return <code className="bg-emerald-500/10 text-emerald-300 px-1 py-0.5 rounded text-[11px] font-mono" {...props}>{children}</code>;
          }
          return (
            <pre className="bg-zinc-950 text-zinc-300 rounded-md p-2 overflow-x-auto my-1.5 text-[11px]">
              <code className={className} {...props}>{children}</code>
            </pre>
          );
        },
        p({ children }) { return <p className="mb-1.5 last:mb-0">{children}</p>; },
        ul({ children }) { return <ul className="list-disc list-inside mb-1.5 space-y-0.5">{children}</ul>; },
        ol({ children }) { return <ol className="list-decimal list-inside mb-1.5 space-y-0.5">{children}</ol>; },
        li({ children }) { return <li className="text-sm">{children}</li>; },
        a({ href, children }) { return <a href={href} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">{children}</a>; },
        h1({ children }) { return <h1 className="text-sm font-bold mb-1">{children}</h1>; },
        h2({ children }) { return <h2 className="text-sm font-bold mb-1">{children}</h2>; },
        h3({ children }) { return <h3 className="text-xs font-bold mb-1">{children}</h3>; },
        blockquote({ children }) { return <blockquote className="border-l-2 border-emerald-500/30 pl-2 italic text-muted-foreground">{children}</blockquote>; },
        table({ children }) { return <table className="text-[11px] border-collapse w-full my-1">{children}</table>; },
        th({ children }) { return <th className="border border-border px-1.5 py-0.5 bg-muted text-left">{children}</th>; },
        td({ children }) { return <td className="border border-border px-1.5 py-0.5">{children}</td>; },
      }}
    >
      {content}
    </ReactMarkdown>
  );
});

function DevmaxLoginScreen({ onSuccess }: { onSuccess: (sessionId: string, user?: DevmaxUser) => void }) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [locked, setLocked] = useState<{ locked: boolean; remainingMinutes: number } | null>(null);
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);

  const doAuth = useCallback(async (body: any) => {
    setIsLoading(true);
    setError(null);
    setLocked(null);
    setRemainingAttempts(null);
    try {
      const fingerprint = generateFingerprint();
      const res = await fetch(`${AUTH_API}/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, fingerprint }),
      });
      const data = await res.json();
      if (res.status === 423) {
        setLocked({ locked: true, remainingMinutes: data.remainingMinutes || 30 });
        return;
      }
      if (!res.ok) {
        setError(data.error || "Identifiants incorrects");
        if (data.remainingAttempts !== undefined) setRemainingAttempts(data.remainingAttempts);
        return;
      }
      if (data.success && data.sessionId) {
        setSuccess(true);
        localStorage.setItem(DEVMAX_TOKEN_KEY, data.sessionId);
        setTimeout(() => onSuccess(data.sessionId, data.user || undefined), 500);
      }
    } catch {
      setError("Erreur de connexion");
    } finally {
      setIsLoading(false);
    }
  }, [onSuccess]);

  const handleLoginSubmit = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    if (!loginId || !password || isLoading || success) return;
    doAuth({ loginId, password });
  }, [loginId, password, isLoading, success, doAuth]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-zinc-950" data-testid="devmax-login-screen">
      <div className="absolute top-4 right-4"><ThemeToggle /></div>
      <div className="flex flex-col items-center gap-6 w-full max-w-sm px-4">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Terminal className="w-8 h-8 text-white" />
          </div>
          <div className="text-center">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">DevMax</h2>
            <p className="text-sm text-zinc-500">Connexion par identifiant</p>
          </div>
        </motion.div>

        <AnimatePresence>
          {locked && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-center w-full">
              <Lock className="w-5 h-5 text-red-400 mx-auto mb-1" />
              <p className="text-red-400 text-sm font-medium">Compte verrouillé</p>
              <p className="text-red-300/70 text-xs mt-1">Réessayez dans {locked.remainingMinutes} min</p>
            </motion.div>
          )}
        </AnimatePresence>

        <form onSubmit={handleLoginSubmit} className="w-full space-y-4" data-testid="devmax-login-form">
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Identifiant</label>
            <Input value={loginId} onChange={e => setLoginId(e.target.value)} placeholder="votre login" className="bg-gray-100 dark:bg-zinc-900 border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-white" disabled={isLoading || success || !!locked} data-testid="input-login-id" autoFocus />
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Mot de passe</label>
            <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" className="bg-gray-100 dark:bg-zinc-900 border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-white" disabled={isLoading || success || !!locked} data-testid="input-login-password" />
          </div>
          <AnimatePresence>
            {error && (
              <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-2 text-red-400 text-sm">
                <XCircle className="w-4 h-4" />
                <span>{error} {remainingAttempts !== null ? `(${remainingAttempts} restantes)` : ""}</span>
              </motion.div>
            )}
            {success && (
              <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 text-emerald-400 text-sm">
                <CheckCircle2 className="w-4 h-4" />
                <span>Accès autorisé</span>
              </motion.div>
            )}
          </AnimatePresence>
          <Button type="submit" disabled={!loginId || !password || isLoading || success || !!locked} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="button-login-submit">
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ArrowRight className="w-4 h-4 mr-2" />}
            Se connecter
          </Button>
        </form>
      </div>
    </div>
  );
}

function ProjectSelector({ onSelect }: { onSelect: (project: DevmaxProject) => void }) {
  const { toast } = useToast();
  const { logout, currentUser } = useDevmaxAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newRepoOwner, setNewRepoOwner] = useState("");
  const [newRepoName, setNewRepoName] = useState("");
  const [newDeploySlug, setNewDeploySlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [newTemplate, setNewTemplate] = useState<string>("");
  const [editingProject, setEditingProject] = useState<DevmaxProject | null>(null);

  const projectTemplates = [
    { id: "express-api", label: "Express API", desc: "REST API TypeScript", icon: "S" , color: "from-green-500 to-emerald-600" },
    { id: "react-vite", label: "React + Vite", desc: "SPA React TypeScript", icon: "R", color: "from-cyan-500 to-blue-600" },
    { id: "fullstack", label: "Fullstack", desc: "Express + React monorepo", icon: "F", color: "from-purple-500 to-indigo-600" },
    { id: "nextjs", label: "Next.js", desc: "App Router + API", icon: "N", color: "from-white/80 to-zinc-400" },
    { id: "static-html", label: "Site Statique", desc: "HTML / CSS / JS", icon: "H", color: "from-orange-500 to-amber-600" },
  ];

  const { data: projects, isLoading, refetch } = useQuery<DevmaxProject[]>({
    queryKey: ["devmax", "projects"],
    queryFn: () => devmaxFetch(`${AUTH_API}/projects`).then(r => r.json()),
  });

  const computedSlug = newDeploySlug || (newRepoName || newName).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

  const createProject = useMutation({
    mutationFn: async () => {
      const res = await devmaxApiRequest("POST", `${AUTH_API}/projects`, {
        name: newName,
        description: newDesc || undefined,
        repoOwner: newRepoOwner || undefined,
        repoName: newRepoName || undefined,
        deploySlug: computedSlug || undefined,
        template: newTemplate || undefined,
      });
      return res;
    },
    onSuccess: async (data) => {
      const hasRepo = !!(newRepoOwner && newRepoName);
      toast({ 
        title: "Projet créé ✓", 
        description: hasRepo 
          ? `Déploiement automatique en cours...\n${computedSlug}.dev.ulyssepro.org + ${computedSlug}.ulyssepro.org` 
          : "Configurez un repo GitHub pour activer le déploiement automatique"
      });
      const createdProject: DevmaxProject = {
        id: data.id,
        name: data.name || newName,
        description: data.description || newDesc,
        repo_owner: data.repoOwner || newRepoOwner,
        repo_name: data.repoName || newRepoName,
        repo_url: data.repoUrl || "",
        deploy_slug: data.deploySlug || computedSlug,
        fingerprint: "",
        created_at: new Date().toISOString(),
        status: "active",
        _triggerAudit: hasRepo,
      } as DevmaxProject & { _triggerAudit?: boolean };
      setShowCreate(false);
      setNewName("");
      setNewDesc("");
      setNewRepoOwner("");
      setNewRepoName("");
      setNewDeploySlug("");
      setSlugManuallyEdited(false);
      setNewTemplate("");
      refetch();
      onSelect(createdProject);
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const updateProject = useMutation({
    mutationFn: (p: DevmaxProject) => devmaxApiRequest("PUT", `${AUTH_API}/projects/${p.id}`, {
      name: p.name,
      description: p.description || "",
      repoOwner: p.repo_owner || "",
      repoName: p.repo_name || "",
    }),
    onSuccess: () => {
      toast({ title: "Projet mis a jour" });
      setEditingProject(null);
      refetch();
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const deleteProject = useMutation({
    mutationFn: (id: string) => devmaxApiRequest("DELETE", `${AUTH_API}/projects/${id}`),
    onSuccess: () => { toast({ title: "Projet supprime" }); refetch(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 pt-safe" data-testid="devmax-projects-screen">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-cyan-500/5 to-blue-500/5" />
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-500/8 rounded-full blur-3xl" />
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-cyan-500/8 rounded-full blur-3xl" />

        <div className="relative max-w-4xl mx-auto px-6 py-8 space-y-8">
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center">
                <Terminal className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-black tracking-tight bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-400 bg-clip-text text-transparent" data-testid="text-projects-title">
                  DevMax
                </h1>
                <p className="text-xs text-zinc-500">{currentUser?.tenantSlug || "Mes Projets"}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-600 hover:opacity-90 text-white border-0"
                onClick={() => setShowCreate(true)}
                data-testid="button-new-project"
              >
                <FolderPlus className="w-4 h-4 mr-1" /> Nouveau projet
              </Button>
              <ThemeToggle />
              <Button size="sm" variant="ghost" className="rounded-xl text-zinc-500" onClick={logout} data-testid="button-logout-projects">
                <LogOut className="w-4 h-4 mr-1" /> Verrouiller
              </Button>
            </div>
          </motion.div>

          <AnimatePresence>
            {showCreate && (
              <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                <Card className="border-emerald-500/30 bg-white/90 dark:bg-zinc-900/80 backdrop-blur-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2 text-emerald-400">
                      <FolderPlus className="w-4 h-4" /> Nouveau Projet
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-zinc-400 mb-1 block">Nom du projet *</label>
                        <Input
                          value={newName}
                          onChange={e => setNewName(e.target.value)}
                          placeholder="Mon super projet"
                          className="rounded-xl bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700"
                          data-testid="input-project-name"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-zinc-400 mb-1 block">Description</label>
                        <Input
                          value={newDesc}
                          onChange={e => setNewDesc(e.target.value)}
                          placeholder="Description du projet..."
                          className="rounded-xl bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700"
                          data-testid="input-project-desc"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-zinc-400 mb-1 block">GitHub Owner</label>
                        <Input
                          value={newRepoOwner}
                          onChange={e => setNewRepoOwner(e.target.value)}
                          placeholder="username ou org"
                          className="rounded-xl bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700"
                          data-testid="input-repo-owner"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-zinc-400 mb-1 block">GitHub Repo</label>
                        <Input
                          value={newRepoName}
                          onChange={e => {
                            setNewRepoName(e.target.value);
                            if (!slugManuallyEdited) setNewDeploySlug("");
                          }}
                          placeholder="nom-du-repo"
                          className="rounded-xl bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700"
                          data-testid="input-repo-name"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-zinc-400 mb-1 block">URL de deploiement</label>
                      <div className="flex items-center gap-0">
                        <Input
                          value={slugManuallyEdited ? newDeploySlug : computedSlug}
                          onChange={e => {
                            const v = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
                            setNewDeploySlug(v);
                            setSlugManuallyEdited(true);
                          }}
                          placeholder="mon-app"
                          className="rounded-l-xl rounded-r-none bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 border-r-0 text-cyan-400 font-mono text-sm"
                          data-testid="input-deploy-slug"
                        />
                        <span className="inline-flex items-center px-3 h-9 bg-gray-200/50 dark:bg-zinc-800/80 border border-gray-300 dark:border-zinc-700 border-l-0 rounded-r-xl text-xs text-zinc-500 whitespace-nowrap select-none">
                          .ulyssepro.org
                        </span>
                      </div>
                      {computedSlug && (
                        <p className="text-[10px] text-zinc-500 mt-1 flex items-center gap-1">
                          <Globe className="w-2.5 h-2.5" />
                          Staging: {computedSlug}-dev.ulyssepro.org — Prod: {computedSlug}.ulyssepro.org
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="text-xs text-zinc-400 mb-2 block">Template de demarrage</label>
                      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                        {projectTemplates.map(t => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => setNewTemplate(newTemplate === t.id ? "" : t.id)}
                            className={`relative flex flex-col items-center p-2.5 rounded-xl border transition-all text-center ${
                              newTemplate === t.id
                                ? "border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/50"
                                : "border-gray-300 dark:border-zinc-700 bg-gray-200/50 dark:bg-zinc-800/60 hover:border-zinc-500 hover:bg-zinc-800"
                            }`}
                            data-testid={`template-${t.id}`}
                          >
                            <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${t.color} flex items-center justify-center text-white font-bold text-sm mb-1.5`}>
                              {t.icon}
                            </div>
                            <span className="text-[11px] font-medium text-white leading-tight">{t.label}</span>
                            <span className="text-[9px] text-zinc-500 leading-tight mt-0.5">{t.desc}</span>
                            {newTemplate === t.id && (
                              <div className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center">
                                <CheckCircle className="w-3 h-3 text-white" />
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-zinc-500 mt-1.5">
                        {newTemplate ? `Le template "${projectTemplates.find(t => t.id === newTemplate)?.label}" sera applique au repo GitHub` : "Optionnel — MaxAI peut aussi scaffolder via le chat"}
                      </p>
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <Button variant="ghost" size="sm" className="rounded-xl text-zinc-400" onClick={() => setShowCreate(false)}>Annuler</Button>
                      <Button
                        size="sm"
                        className="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white"
                        onClick={() => createProject.mutate()}
                        disabled={!newName.trim() || createProject.isPending}
                        data-testid="button-create-project"
                      >
                        {createProject.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
                        Creer
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
            </div>
          ) : !projects?.length && !showCreate ? (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
              <Card className="border-dashed border-2 border-gray-300 dark:border-zinc-700 bg-zinc-900/50">
                <CardContent className="p-12 text-center">
                  <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center mb-4">
                    <FolderPlus className="w-8 h-8 text-emerald-400/50" />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">Aucun projet</h3>
                  <p className="text-sm text-zinc-500 mb-4">Creez votre premier projet pour commencer</p>
                  <Button
                    className="rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-600 hover:opacity-90 text-white border-0"
                    onClick={() => setShowCreate(true)}
                    data-testid="button-first-project"
                  >
                    <FolderPlus className="w-4 h-4 mr-2" /> Creer un projet
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {projects?.map((project, i) => (
                <motion.div key={project.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                  {editingProject?.id === project.id ? (
                    <Card className="border-emerald-500/30 bg-zinc-900/80">
                      <CardContent className="p-4 space-y-3">
                        <Input
                          value={editingProject.name}
                          onChange={e => setEditingProject({ ...editingProject, name: e.target.value })}
                          className="rounded-xl bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700"
                          data-testid="input-edit-project-name"
                        />
                        <Input
                          value={editingProject.description || ""}
                          onChange={e => setEditingProject({ ...editingProject, description: e.target.value })}
                          placeholder="Description"
                          className="rounded-xl bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            value={editingProject.repo_owner || ""}
                            onChange={e => setEditingProject({ ...editingProject, repo_owner: e.target.value })}
                            placeholder="Owner"
                            className="rounded-xl bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700"
                          />
                          <Input
                            value={editingProject.repo_name || ""}
                            onChange={e => setEditingProject({ ...editingProject, repo_name: e.target.value })}
                            placeholder="Repo"
                            className="rounded-xl bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700"
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" className="rounded-xl" onClick={() => setEditingProject(null)}>Annuler</Button>
                          <Button size="sm" className="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white" onClick={() => updateProject.mutate(editingProject)} disabled={updateProject.isPending} data-testid="button-save-project">
                            {updateProject.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ) : (
                    <Card
                      className="overflow-hidden bg-zinc-900/80 border-zinc-800 hover:border-emerald-500/40 hover:shadow-lg hover:shadow-emerald-500/5 transition-all cursor-pointer group"
                      onClick={() => onSelect(project)}
                      data-testid={`card-project-${project.id}`}
                    >
                      <div className="h-1 bg-gradient-to-r from-emerald-500 to-cyan-600 opacity-60 group-hover:opacity-100 transition-opacity" />
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1 min-w-0">
                            <h3 className="text-base font-bold text-white truncate">{project.name}</h3>
                            {project.description && (
                              <p className="text-xs text-zinc-500 truncate mt-0.5">{project.description}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0 ml-2" onClick={e => e.stopPropagation()}>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 rounded-lg text-zinc-500 hover:text-white"
                              onClick={() => setEditingProject({ ...project })}
                              data-testid={`button-edit-project-${project.id}`}
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 rounded-lg text-zinc-500 hover:text-red-400"
                              onClick={() => {
                                if (window.confirm("Supprimer ce projet ?")) deleteProject.mutate(project.id);
                              }}
                              data-testid={`button-delete-project-${project.id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                        {project.repo_owner && project.repo_name ? (
                          <div className="flex items-center gap-2 text-xs text-zinc-400">
                            <GitFork className="w-3 h-3 text-emerald-400" />
                            <span className="font-mono">{project.repo_owner}/{project.repo_name}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-xs text-zinc-600">
                            <Settings className="w-3 h-3" />
                            <span>Pas de repo configure</span>
                          </div>
                        )}
                        {project.updated_at && (
                          <p className="text-[10px] text-zinc-600 mt-2">
                            Modifie {timeAgo(project.updated_at)}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BranchesPanel() {
  const { toast } = useToast();
  const { activeProject } = useDevmaxAuth();
  const pid = activeProject?.id || "";
  const [newBranch, setNewBranch] = useState("");
  const [fromBranch, setFromBranch] = useState("main");

  const { data: branches, isLoading, refetch } = useQuery<Branch[]>({
    queryKey: [API, "branches", pid],
    queryFn: () => devmaxFetch(`${API}/branches`, undefined, pid).then(r => r.json()).then(d => Array.isArray(d) ? d : []),
    enabled: !!pid,
  });

  const createBranch = useMutation({
    mutationFn: () => devmaxApiRequest("POST", `${API}/branches`, { branchName: newBranch, fromBranch }, pid),
    onSuccess: () => { toast({ title: "Branche creee" }); setNewBranch(""); refetch(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const deleteBranch = useMutation({
    mutationFn: (name: string) => devmaxApiRequest("DELETE", `${API}/branches/${name}`, undefined, pid),
    onSuccess: () => { toast({ title: "Branche supprimee" }); refetch(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input placeholder="Nouvelle branche..." value={newBranch} onChange={e => setNewBranch(e.target.value)} className="flex-1 rounded-xl" data-testid="input-new-branch" />
        <Input placeholder="depuis" value={fromBranch} onChange={e => setFromBranch(e.target.value)} className="w-32 rounded-xl" />
        <Button size="sm" className="rounded-xl" onClick={() => createBranch.mutate()} disabled={!newBranch || createBranch.isPending} data-testid="button-create-branch">
          {createBranch.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
        </Button>
        <Button size="icon" variant="ghost" className="rounded-xl" onClick={() => refetch()} data-testid="button-refresh-branches">
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>
      ) : (
        <div className="space-y-2">
          {branches?.map((b, i) => (
            <motion.div key={b.name} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}>
              <Card className="overflow-hidden hover:shadow-md transition-shadow">
                <div className={`h-0.5 ${b.protected ? 'bg-gradient-to-r from-amber-500 to-orange-500' : 'bg-gradient-to-r from-emerald-500 to-cyan-500'}`} />
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <GitBranch className="w-4 h-4 text-emerald-400" />
                      <span className="font-mono text-sm">{b.name}</span>
                      {b.protected && <Badge variant="secondary" className="text-[10px]"><Shield className="w-2.5 h-2.5 mr-0.5" /> protegee</Badge>}
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="text-xs text-muted-foreground font-mono">{b.commit.sha.slice(0, 7)}</code>
                      {!b.protected && b.name !== "main" && (
                        <Button size="icon" variant="ghost" className="h-7 w-7 rounded-lg" onClick={() => deleteBranch.mutate(b.name)} data-testid={`button-delete-branch-${b.name}`}>
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

function CommitsPanel() {
  const { activeProject } = useDevmaxAuth();
  const pid = activeProject?.id || "";
  const [branch, setBranch] = useState("main");
  const { data: commits, isLoading, refetch } = useQuery<Commit[]>({
    queryKey: [API, "commits", branch, pid],
    queryFn: () => devmaxFetch(`${API}/commits?branch=${branch}&per_page=30`, undefined, pid).then(r => r.json()).then(d => Array.isArray(d) ? d : []),
    enabled: !!pid,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input placeholder="Branche" value={branch} onChange={e => setBranch(e.target.value)} className="w-40 rounded-xl" />
        <Button size="icon" variant="ghost" className="rounded-xl" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>
      ) : (
        <div className="space-y-2">
          {commits?.map((c, i) => (
            <motion.div key={c.sha} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}>
              <Card className="overflow-hidden hover:shadow-md transition-shadow">
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <GitCommit className="w-4 h-4 text-cyan-400 shrink-0" />
                        <span className="text-sm font-medium truncate">{c.commit.message.split("\n")[0]}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{c.commit.author.name}</span>
                        <span>{timeAgo(c.commit.author.date)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <code className="text-xs text-muted-foreground font-mono">{c.sha.slice(0, 7)}</code>
                      <a href={c.html_url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                      </a>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

function PullRequestsPanel() {
  const { toast } = useToast();
  const { activeProject } = useDevmaxAuth();
  const pid = activeProject?.id || "";
  const [prState, setPrState] = useState("open");

  const { data: pulls, isLoading, refetch } = useQuery<PullRequest[]>({
    queryKey: [API, "pulls", prState, pid],
    queryFn: () => devmaxFetch(`${API}/pulls?state=${prState}`, undefined, pid).then(r => r.json()).then(d => Array.isArray(d) ? d : []),
    enabled: !!pid,
  });

  const mergePR = useMutation({
    mutationFn: (number: number) => devmaxApiRequest("PUT", `${API}/pulls/${number}/merge`, { merge_method: "squash" }, pid),
    onSuccess: () => { toast({ title: "PR fusionnee" }); refetch(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button size="sm" variant={prState === "open" ? "default" : "outline"} className="rounded-xl" onClick={() => setPrState("open")} data-testid="button-pr-open">Ouvertes</Button>
        <Button size="sm" variant={prState === "closed" ? "default" : "outline"} className="rounded-xl" onClick={() => setPrState("closed")} data-testid="button-pr-closed">Fermees</Button>
        <Button size="icon" variant="ghost" className="rounded-xl" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>
      ) : pulls?.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="p-8 text-center">
            <GitPullRequest className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">Aucune pull request {prState === "open" ? "ouverte" : "fermee"}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {pulls?.map((pr, i) => (
            <motion.div key={pr.number} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
              <Card className="overflow-hidden hover:shadow-md transition-shadow">
                <div className={`h-0.5 ${pr.merged_at ? 'bg-gradient-to-r from-purple-500 to-violet-500' : pr.state === "open" ? 'bg-gradient-to-r from-emerald-500 to-green-500' : 'bg-gradient-to-r from-red-500 to-rose-500'}`} />
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <GitPullRequest className={cn("w-4 h-4 shrink-0", pr.merged_at ? "text-purple-400" : pr.state === "open" ? "text-emerald-400" : "text-red-400")} />
                        <span className="text-sm font-medium">#{pr.number} {pr.title}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="font-mono">{pr.head.ref} &rarr; {pr.base.ref}</span>
                        <span>{timeAgo(pr.created_at)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {pr.state === "open" && (
                        <Button size="sm" variant="outline" className="rounded-lg text-xs h-7" onClick={() => mergePR.mutate(pr.number)} disabled={mergePR.isPending} data-testid={`button-merge-pr-${pr.number}`}>
                          {mergePR.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Rocket className="w-3 h-3" />}
                          <span className="ml-1">Merge</span>
                        </Button>
                      )}
                      <a href={pr.html_url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                      </a>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

function LivePreviewPanel({ stagingUrl, productionUrl }: { stagingUrl: string | null; productionUrl: string | null }) {
  const [previewMode, setPreviewMode] = useState<"staging" | "production" | "split">(stagingUrl ? "staging" : "production");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const iframeRef2 = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => setRefreshKey(k => k + 1), 15000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const activeUrl = previewMode === "production" ? productionUrl : stagingUrl;

  return (
    <Card className={cn("transition-all", isFullscreen && "fixed inset-0 z-50 rounded-none border-0 m-0")}>
      <CardContent className={cn("space-y-2", isFullscreen ? "p-3 h-full flex flex-col" : "p-4")}>
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <Eye className="w-4 h-4 text-cyan-400" /> Live Preview
            {autoRefresh && (
              <Badge variant="outline" className="text-[9px] border-emerald-500/50 text-emerald-400 animate-pulse">
                AUTO-REFRESH
              </Badge>
            )}
          </h4>
          <div className="flex items-center gap-1">
            {stagingUrl && productionUrl && (
              <div className="flex bg-muted/50 rounded-lg p-0.5 mr-2">
                <button
                  onClick={() => setPreviewMode("staging")}
                  className={cn("px-2 py-0.5 rounded-md text-[10px] font-medium transition-all", previewMode === "staging" ? "bg-amber-500/20 text-amber-400" : "text-muted-foreground hover:text-foreground")}
                  data-testid="button-preview-staging"
                >
                  Staging
                </button>
                <button
                  onClick={() => setPreviewMode("split")}
                  className={cn("px-2 py-0.5 rounded-md text-[10px] font-medium transition-all", previewMode === "split" ? "bg-cyan-500/20 text-cyan-400" : "text-muted-foreground hover:text-foreground")}
                  data-testid="button-preview-split"
                >
                  Split
                </button>
                <button
                  onClick={() => setPreviewMode("production")}
                  className={cn("px-2 py-0.5 rounded-md text-[10px] font-medium transition-all", previewMode === "production" ? "bg-emerald-500/20 text-emerald-400" : "text-muted-foreground hover:text-foreground")}
                  data-testid="button-preview-production"
                >
                  Production
                </button>
              </div>
            )}
            <Button
              size="icon"
              variant="ghost"
              className={cn("h-7 w-7 rounded-lg", autoRefresh && "text-emerald-400")}
              onClick={() => setAutoRefresh(!autoRefresh)}
              title={autoRefresh ? "Desactiver auto-refresh" : "Activer auto-refresh (15s)"}
              data-testid="button-toggle-auto-refresh"
            >
              <Activity className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 rounded-lg"
              onClick={() => setRefreshKey(k => k + 1)}
              title="Rafraichir la preview"
              data-testid="button-refresh-preview"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
            {activeUrl && previewMode !== "split" && (
              <a href={activeUrl} target="_blank" rel="noopener noreferrer">
                <Button size="icon" variant="ghost" className="h-7 w-7 rounded-lg" title="Ouvrir dans un nouvel onglet" data-testid="button-open-preview-tab">
                  <ExternalLink className="w-3.5 h-3.5" />
                </Button>
              </a>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 rounded-lg"
              onClick={() => setIsFullscreen(!isFullscreen)}
              title={isFullscreen ? "Quitter plein ecran" : "Plein ecran"}
              data-testid="button-toggle-fullscreen-preview"
            >
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>

        {previewMode === "split" ? (
          <div className={cn("grid grid-cols-1 sm:grid-cols-2 gap-2", isFullscreen ? "flex-1" : "")}>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-400">Staging</Badge>
                {stagingUrl && (
                  <a href={stagingUrl} target="_blank" rel="noopener noreferrer" className="text-[9px] text-muted-foreground hover:text-cyan-400 flex items-center gap-0.5">
                    <ExternalLink className="w-2.5 h-2.5" /> Ouvrir
                  </a>
                )}
              </div>
              <div className="rounded-lg overflow-hidden border border-amber-500/30 bg-black/50">
                <iframe
                  ref={iframeRef}
                  key={`staging-${refreshKey}`}
                  src={stagingUrl || "about:blank"}
                  className={cn("w-full border-0", isFullscreen ? "h-full" : "h-[350px]")}
                  title="Staging Preview"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  data-testid="iframe-staging-preview"
                />
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-[9px] border-emerald-500/50 text-emerald-400">Production</Badge>
                {productionUrl && (
                  <a href={productionUrl} target="_blank" rel="noopener noreferrer" className="text-[9px] text-muted-foreground hover:text-emerald-400 flex items-center gap-0.5">
                    <ExternalLink className="w-2.5 h-2.5" /> Ouvrir
                  </a>
                )}
              </div>
              <div className="rounded-lg overflow-hidden border border-emerald-500/30 bg-black/50">
                <iframe
                  ref={iframeRef2}
                  key={`production-${refreshKey}`}
                  src={productionUrl || "about:blank"}
                  className={cn("w-full border-0", isFullscreen ? "h-full" : "h-[350px]")}
                  title="Production Preview"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  data-testid="iframe-production-preview"
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {activeUrl && (
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Globe className="w-3 h-3" />
                {activeUrl.replace("https://", "")}
              </p>
            )}
            <div className={cn(
              "rounded-lg overflow-hidden border bg-black/50",
              previewMode === "staging" ? "border-amber-500/30" : "border-emerald-500/30"
            )}>
              <iframe
                ref={iframeRef}
                key={`single-${previewMode}-${refreshKey}`}
                src={activeUrl || "about:blank"}
                className={cn("w-full border-0", isFullscreen ? "flex-1 h-full" : "h-[500px]")}
                title={`${previewMode} Preview`}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                data-testid={`iframe-${previewMode}-preview`}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GitHubConnectionPanel() {
  const { toast } = useToast();
  const { activeProject } = useDevmaxAuth();
  const pid = activeProject?.id || "";
  const [patInput, setPatInput] = useState("");
  const [showPatInput, setShowPatInput] = useState(false);

  const { data: ghStatus, isLoading, refetch } = useQuery<{
    provider: string; user: string | null; scopes: string | null;
    connectedAt: string | null; hasToken: boolean; tokenValid: boolean; oauthAvailable: boolean;
  }>({
    queryKey: [AUTH_API, "github-status", pid],
    queryFn: () => devmaxFetch(`${AUTH_API}/github/status/${pid}`).then(r => r.json()),
    enabled: !!pid,
    refetchInterval: 60000,
  });

  const connectPat = useMutation({
    mutationFn: async () => {
      const res = await devmaxApiRequest("POST", `${AUTH_API}/github/pat`, { projectId: pid, pat: patInput });
      return res;
    },
    onSuccess: (data: any) => {
      toast({ title: "GitHub connecte", description: `Compte: ${data.githubUser}` });
      setPatInput("");
      setShowPatInput(false);
      refetch();
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const disconnect = useMutation({
    mutationFn: () => devmaxApiRequest("DELETE", `${AUTH_API}/github/disconnect/${pid}`, {}),
    onSuccess: () => {
      toast({ title: "GitHub deconnecte" });
      refetch();
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const startOAuth = async () => {
    try {
      const token = localStorage.getItem(DEVMAX_TOKEN_KEY);
      const res = await fetch(`${AUTH_API}/github/oauth/start?projectId=${pid}&token=${token}`);
      const data = await res.json();
      if (data.authUrl) {
        const popup = window.open(data.authUrl, "github-oauth", "width=600,height=700,left=200,top=100");
        const interval = setInterval(() => {
          if (popup?.closed) {
            clearInterval(interval);
            refetch();
          }
        }, 1000);
      } else {
        toast({ title: "Erreur OAuth", description: data.error || "Impossible de demarrer OAuth", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    }
  };

  const isConnected = ghStatus?.hasToken && ghStatus?.provider !== "owner" && ghStatus?.tokenValid;
  const isOwnerMode = !ghStatus?.hasToken || ghStatus?.provider === "owner";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Shield className="w-4 h-4 text-cyan-400" /> Connexion GitHub
        </h3>
        <Button size="icon" variant="ghost" className="rounded-xl" onClick={() => refetch()} data-testid="button-refresh-github">
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>
      ) : (
        <div className="space-y-3">
          <Card className={isConnected ? "border-emerald-500/30" : isOwnerMode ? "border-cyan-500/20" : "border-amber-500/30"}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {isConnected ? (
                    <CheckCircle className="w-5 h-5 text-emerald-400" />
                  ) : isOwnerMode ? (
                    <Shield className="w-5 h-5 text-cyan-400" />
                  ) : (
                    <XCircle className="w-5 h-5 text-amber-400" />
                  )}
                  <div>
                    <p className="text-sm font-medium">
                      {isConnected ? `Connecte: ${ghStatus?.user}` : isOwnerMode ? "Mode Owner (token global)" : "Token invalide"}
                    </p>
                    <p className="text-[10px] text-zinc-500">
                      {isConnected ? `via ${ghStatus?.provider === "oauth" ? "OAuth" : "Token personnel"} — ${ghStatus?.scopes || ""}` :
                       isOwnerMode ? "Utilise le token GitHub principal du serveur" : "Le token stocke n'est plus valide"}
                    </p>
                  </div>
                </div>
                {isConnected && (
                  <Button size="sm" variant="ghost" className="text-xs text-red-400 hover:text-red-300 rounded-xl"
                    onClick={() => disconnect.mutate()} disabled={disconnect.isPending}
                    data-testid="button-disconnect-github">
                    Deconnecter
                  </Button>
                )}
              </div>
              {ghStatus?.connectedAt && (
                <p className="text-[10px] text-zinc-500">Connecte le {new Date(ghStatus.connectedAt).toLocaleDateString("fr-FR")} a {new Date(ghStatus.connectedAt).toLocaleTimeString("fr-FR")}</p>
              )}
            </CardContent>
          </Card>

          <ConnectedReposSection pid={pid} />

          {!isConnected && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-400">
                Connectez un compte GitHub client pour que MaxAI puisse acceder a ses repos. Deux options :
              </p>

              {ghStatus?.oauthAvailable && (
                <Card className="border-gray-300 dark:border-zinc-700 hover:border-emerald-500/40 transition-all cursor-pointer" onClick={startOAuth}>
                  <CardContent className="p-4 flex items-center gap-3" data-testid="button-github-oauth">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center">
                      <ExternalLink className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Connexion OAuth GitHub</p>
                      <p className="text-[10px] text-zinc-500">Le client autorise MaxAI en un clic — recommande</p>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card className="border-gray-300 dark:border-zinc-700">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3 mb-3 cursor-pointer" onClick={() => setShowPatInput(!showPatInput)}>
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center">
                      <Lock className="w-5 h-5 text-amber-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Token Personnel (PAT)</p>
                      <p className="text-[10px] text-zinc-500">Le client fournit manuellement son token GitHub</p>
                    </div>
                  </div>
                  {showPatInput && (
                    <div className="space-y-2">
                      <Input
                        type="password"
                        value={patInput}
                        onChange={e => setPatInput(e.target.value)}
                        placeholder="ghp_xxxxxxxxxxxxx ou github_pat_xxxxx"
                        className="rounded-xl bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 font-mono text-sm"
                        data-testid="input-github-pat"
                      />
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] text-zinc-500">
                          Creer un PAT sur github.com/settings/tokens avec les scopes "repo" et "read:user"
                        </p>
                        <Button size="sm" className="rounded-xl bg-amber-600 hover:bg-amber-500 text-white"
                          onClick={() => connectPat.mutate()}
                          disabled={!patInput.trim() || connectPat.isPending}
                          data-testid="button-connect-pat">
                          {connectPat.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Connecter"}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConnectedReposSection({ pid }: { pid: string }) {
  const { activeProject } = useDevmaxAuth();
  const { data: repos, isLoading } = useQuery<{
    production: { fullName: string; exists: boolean; accessible: boolean; private: boolean | null; defaultBranch?: string; language?: string; pushedAt?: string; url?: string; error?: string; role: string; deployUrl: string };
    staging: { fullName: string; exists: boolean; accessible: boolean; private: boolean | null; defaultBranch?: string; language?: string; pushedAt?: string; url?: string; error?: string; role: string; deployUrl: string; port?: number };
  }>({
    queryKey: [API, "connected-repos", pid],
    queryFn: () => devmaxFetch(`${API}/connected-repos`, undefined, pid).then(r => r.json()),
    enabled: !!pid && !!activeProject?.repo_owner,
    staleTime: 60000,
  });

  if (!activeProject?.repo_owner || isLoading) return null;
  if (!repos) return null;

  const RepoRow = ({ repo, color, icon }: { repo: typeof repos.production; color: string; icon: string }) => {
    const borderClass = color === "emerald" ? "border-emerald-500/20" : "border-amber-500/20";
    const bgClass = color === "emerald" ? "bg-emerald-500/5" : "bg-amber-500/5";
    const textClass = color === "emerald" ? "text-emerald-400" : "text-amber-400";
    const badgeClass = color === "emerald" ? "border-emerald-500/50 text-emerald-400" : "border-amber-500/50 text-amber-400";

    return (
      <div className={cn("rounded-lg border p-3 transition-all", borderClass, bgClass)} data-testid={`connected-repo-${repo.role}`}>
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <span className="text-sm">{icon}</span>
            <span className={cn("text-xs font-semibold uppercase tracking-wider", textClass)}>{repo.role === "production" ? "Production" : "Staging"}</span>
            {repo.accessible ? (
              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
            ) : repo.exists ? (
              <XCircle className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-zinc-500" />
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {repo.private !== null && (
              <Badge variant="outline" className={cn("text-[9px] h-4", repo.private ? "border-amber-500/50 text-amber-400" : "border-emerald-500/50 text-emerald-400")}>
                {repo.private ? "Privé" : "Public"}
              </Badge>
            )}
            <Badge variant="outline" className={cn("text-[9px] h-4", badgeClass)}>
              {repo.accessible ? "Connecté" : repo.exists ? "Inaccessible" : "Inexistant"}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a href={repo.url || `https://github.com/${repo.fullName}`} target="_blank" rel="noopener noreferrer" className="text-xs font-mono text-cyan-400 hover:text-cyan-300 hover:underline flex items-center gap-1" data-testid={`link-repo-${repo.role}`}>
            <GitBranch className="w-3 h-3" />
            {repo.fullName}
          </a>
          {repo.language && <Badge variant="secondary" className="text-[9px] h-4">{repo.language}</Badge>}
          {repo.defaultBranch && <span className="text-[10px] text-zinc-500">({repo.defaultBranch})</span>}
        </div>
        {repo.deployUrl && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <Globe className="w-3 h-3 text-zinc-500" />
            <a href={repo.deployUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-zinc-400 hover:text-cyan-400 font-mono truncate">{repo.deployUrl.replace("https://", "")}</a>
          </div>
        )}
        {repo.pushedAt && <p className="text-[10px] text-zinc-500 mt-1">Dernier push: {new Date(repo.pushedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>}
        {repo.error && <p className="text-[10px] text-red-400 mt-1">{repo.error}</p>}
      </div>
    );
  };

  return (
    <Card className="border-zinc-700/50">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <GitFork className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold">Repos connectés</span>
          <span className="text-[10px] text-zinc-500">({[repos.production, repos.staging].filter(r => r.accessible).length}/2 accessibles)</span>
        </div>
        <div className="space-y-2">
          <RepoRow repo={repos.production} color="emerald" icon="🟢" />
          <RepoRow repo={repos.staging} color="amber" icon="🟡" />
        </div>
      </CardContent>
    </Card>
  );
}

function DeployPanel() {
  const { toast } = useToast();
  const { activeProject } = useDevmaxAuth();
  const pid = activeProject?.id || "";
  const [branch, setBranch] = useState("main");
  const [buildCmd, setBuildCmd] = useState("npm run build");
  const [startCmd, setStartCmd] = useState("npm start");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [deployKeyOutput, setDeployKeyOutput] = useState<string | null>(null);

  const { data: repoAccess, refetch: recheckAccess } = useQuery<{
    owner: string; name: string; accessible: boolean; private: boolean; error?: string; tokenAvailable: boolean;
  }>({
    queryKey: [API, "verify-repo-access", pid],
    queryFn: () => devmaxApiRequest("POST", `${API}/verify-repo-access`, {}, pid),
    enabled: !!pid,
    staleTime: 60000,
  });

  const setupDeployKey = useMutation({
    mutationFn: () => devmaxApiRequest("POST", `${API}/setup-deploy-key`, {}, pid),
    onSuccess: (data: any) => {
      setDeployKeyOutput(data.message);
      toast({ title: "Deploy key generee" });
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useQuery<{
    stagingUrl: string | null;
    productionUrl: string | null;
    environment: string;
    lastDeployedAt: string | null;
    lastPromotedAt: string | null;
  }>({
    queryKey: [API, "deployment-status", pid],
    queryFn: () => devmaxFetch(`${API}/deployment-status`, undefined, pid).then(r => r.json()),
    enabled: !!pid,
    refetchInterval: 30000,
  });

  const [lastDeployResult, setLastDeployResult] = useState<any>(null);

  const deployStaging = useMutation({
    mutationFn: () => devmaxApiRequest("POST", `${API}/deploy-staging`, { branch, buildCmd, startCmd }, pid),
    onSuccess: (data: any) => {
      setLastDeployResult(data);
      if (data.success) {
        toast({
          title: data.browserAccessible ? "Staging deploye et accessible" : "Staging deploye avec succes",
          description: data.browserAccessible
            ? `${data.stagingUrl}\nRepo: ${data.stagingRepo || ""}`
            : `${data.stagingUrl}\nHealth check: ${data.browserStatus || "en cours"} — le site peut prendre quelques secondes`,
        });
      } else {
        toast({ title: "Echec deploiement staging", description: data.message || "Erreur inconnue", variant: "destructive" });
      }
      refetchStatus();
    },
    onError: (e: any) => toast({ title: "Erreur deploiement", description: e.message, variant: "destructive" }),
  });

  const promoteProduction = useMutation({
    mutationFn: () => devmaxApiRequest("POST", `${API}/promote-production`, {}, pid),
    onSuccess: (data: any) => {
      setLastDeployResult(data);
      if (data.success) {
        toast({
          title: data.browserAccessible ? "Production live et accessible" : "Production deployee avec succes",
          description: data.browserAccessible
            ? data.productionUrl || "Promotion terminee"
            : `${data.productionUrl || ""}\nHealth check: ${data.browserStatus || "en cours"} — le site peut prendre quelques secondes`,
        });
      } else {
        toast({ title: "Echec promotion production", description: data.message || "Erreur inconnue", variant: "destructive" });
      }
      refetchStatus();
    },
    onError: (e: any) => toast({ title: "Erreur promotion", description: e.message, variant: "destructive" }),
  });

  const env = status?.environment || "none";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Rocket className="w-4 h-4 text-cyan-400" /> Deploiement
        </h3>
        <Button size="icon" variant="ghost" className="rounded-xl" onClick={() => refetchStatus()} data-testid="button-refresh-deploy">
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {repoAccess && (
        <Card className={cn("transition-all", repoAccess.accessible ? "border-emerald-500/20" : "border-red-500/30")}>
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {repoAccess.accessible ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400" />
                )}
                <span className="text-sm font-medium">{repoAccess.owner}/{repoAccess.name}</span>
                <Badge variant="outline" className={cn("text-[10px]", repoAccess.private ? "border-amber-500/50 text-amber-400" : "border-emerald-500/50 text-emerald-400")}>
                  {repoAccess.private ? <><Lock className="w-3 h-3 mr-1" /> Prive</> : <><Globe className="w-3 h-3 mr-1" /> Public</>}
                </Badge>
                {repoAccess.tokenAvailable && (
                  <Badge variant="outline" className="text-[10px] border-cyan-500/50 text-cyan-400">
                    <Shield className="w-3 h-3 mr-1" /> Token OK
                  </Badge>
                )}
              </div>
              <Button size="icon" variant="ghost" className="h-6 w-6 rounded-lg" onClick={() => recheckAccess()} data-testid="button-recheck-access">
                <RefreshCw className="w-3 h-3" />
              </Button>
            </div>
            {!repoAccess.accessible && (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-red-400">{repoAccess.error}</p>
                {repoAccess.private && !repoAccess.tokenAvailable && (
                  <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 space-y-2">
                    <p className="text-xs text-amber-300">Ce repo est prive. Options :</p>
                    <ul className="text-xs text-muted-foreground space-y-1 ml-4 list-disc">
                      <li>Configurer un token GitHub (PAT) avec acces aux repos prives</li>
                      <li>Generer une deploy key SSH sur le VPS</li>
                    </ul>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7"
                      onClick={() => setupDeployKey.mutate()}
                      disabled={setupDeployKey.isPending}
                      data-testid="button-setup-deploy-key"
                    >
                      {setupDeployKey.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Shield className="w-3 h-3 mr-1" />}
                      Generer Deploy Key
                    </Button>
                  </div>
                )}
                {deployKeyOutput && (
                  <div className="p-2 rounded-lg bg-muted/50 border">
                    <p className="text-xs font-mono whitespace-pre-wrap break-all">{deployKeyOutput}</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Card className={cn("transition-all", env === "staging" ? "border-amber-500/50 shadow-amber-500/10 shadow-md" : "")}>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Upload className="w-4 h-4 text-amber-400" />
              <span>Staging</span>
              {env === "staging" && <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-400">Actif</Badge>}
            </div>
            {status?.stagingUrl ? (
              <a href={status.stagingUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-400 hover:underline flex items-center gap-1" data-testid="link-staging-url">
                <Globe className="w-3 h-3" /> {status.stagingUrl.replace("https://", "")}
              </a>
            ) : (
              <p className="text-xs text-muted-foreground">Aucun deploiement staging</p>
            )}
            {status?.lastDeployedAt && (
              <p className="text-[10px] text-muted-foreground">Deploye {timeAgo(status.lastDeployedAt)}</p>
            )}
          </CardContent>
        </Card>

        <Card className={cn("transition-all", env === "production" ? "border-emerald-500/50 shadow-emerald-500/10 shadow-md" : "")}>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Globe className="w-4 h-4 text-emerald-400" />
              <span>Production</span>
              {env === "production" && <Badge variant="outline" className="text-[10px] border-emerald-500/50 text-emerald-400">Live</Badge>}
            </div>
            {status?.productionUrl ? (
              <a href={status.productionUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-400 hover:underline flex items-center gap-1" data-testid="link-production-url">
                <Globe className="w-3 h-3" /> {status.productionUrl.replace("https://", "")}
              </a>
            ) : (
              <p className="text-xs text-muted-foreground">Aucun deploiement production</p>
            )}
            {status?.lastPromotedAt && (
              <p className="text-[10px] text-muted-foreground">Promu {timeAgo(status.lastPromotedAt)}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <Upload className="w-4 h-4 text-amber-400" /> Deployer en Staging
          </h4>

          <div className="grid grid-cols-1 gap-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Branche</label>
              <Input value={branch} onChange={e => setBranch(e.target.value)} placeholder="main" className="h-8 text-sm" data-testid="input-deploy-branch" />
            </div>
          </div>

          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground p-0 h-auto" onClick={() => setShowAdvanced(!showAdvanced)} data-testid="button-toggle-advanced">
            <ChevronRight className={cn("w-3 h-3 transition-transform mr-1", showAdvanced && "rotate-90")} />
            Options avancees
          </Button>

          {showAdvanced && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Build cmd</label>
                <Input value={buildCmd} onChange={e => setBuildCmd(e.target.value)} placeholder="npm run build" className="h-8 text-sm font-mono" data-testid="input-build-cmd" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Start cmd</label>
                <Input value={startCmd} onChange={e => setStartCmd(e.target.value)} placeholder="npm start" className="h-8 text-sm font-mono" data-testid="input-start-cmd" />
              </div>
            </div>
          )}

          <Button
            onClick={() => deployStaging.mutate()}
            disabled={deployStaging.isPending}
            className="w-full bg-amber-600 hover:bg-amber-700 text-white"
            data-testid="button-deploy-staging"
          >
            {deployStaging.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Deploiement en cours...</>
            ) : (
              <><Upload className="w-4 h-4 mr-2" /> Deployer en Staging</>
            )}
          </Button>
        </CardContent>
      </Card>

      {lastDeployResult && (
        <Card className={cn("transition-all", lastDeployResult.success ? (lastDeployResult.browserAccessible ? "border-emerald-500/30" : "border-cyan-500/30") : "border-red-500/30")}>
          <CardContent className="p-4 space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-2">
              {lastDeployResult.success ? (
                lastDeployResult.browserAccessible ? (
                  <><CheckCircle className="w-4 h-4 text-emerald-400" /> Deploiement reussi et accessible</>
                ) : (
                  <><CheckCircle className="w-4 h-4 text-cyan-400" /> Deploiement reussi</>
                )
              ) : (
                <><XCircle className="w-4 h-4 text-red-400" /> Deploiement echoue</>
              )}
            </h4>
            {lastDeployResult.stagingRepo && (
              <a href={lastDeployResult.stagingRepoUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-400 hover:underline flex items-center gap-1" data-testid="link-staging-repo">
                <GitFork className="w-3 h-3" /> Repo staging: {lastDeployResult.stagingRepo}
              </a>
            )}
            <div className="flex items-center gap-2 text-xs">
              <Badge variant="outline" className={cn("text-[10px]", lastDeployResult.browserAccessible ? "border-emerald-500/50 text-emerald-400" : "border-amber-500/50 text-amber-400")}>
                {lastDeployResult.browserStatus || "unknown"}
              </Badge>
              {lastDeployResult.stagingUrl && (
                <a href={lastDeployResult.stagingUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-muted-foreground hover:text-cyan-400 flex items-center gap-0.5">
                  <ExternalLink className="w-2.5 h-2.5" /> {lastDeployResult.stagingUrl?.replace("https://", "")}
                </a>
              )}
              {lastDeployResult.productionUrl && !lastDeployResult.stagingUrl && (
                <a href={lastDeployResult.productionUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-muted-foreground hover:text-emerald-400 flex items-center gap-0.5">
                  <ExternalLink className="w-2.5 h-2.5" /> {lastDeployResult.productionUrl?.replace("https://", "")}
                </a>
              )}
            </div>
            {lastDeployResult.success && !lastDeployResult.browserAccessible && (
              <p className="text-[10px] text-cyan-400/80">Le deploiement a reussi. Le site peut prendre quelques secondes pour etre accessible — rafraichissez la page cible.</p>
            )}
          </CardContent>
        </Card>
      )}

      {status?.stagingUrl && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <ArrowUpCircle className="w-4 h-4 text-emerald-400" /> Promouvoir en Production
            </h4>
            <p className="text-xs text-muted-foreground">
              Le staging sera copie vers la production avec une nouvelle config Nginx.
            </p>

            <div className="flex items-center gap-2 text-xs bg-muted/50 rounded-lg p-3">
              <Badge variant="outline" className="border-amber-500/50 text-amber-400">Staging</Badge>
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
              <Badge variant="outline" className="border-emerald-500/50 text-emerald-400">Production</Badge>
            </div>

            <Button
              onClick={() => promoteProduction.mutate()}
              disabled={promoteProduction.isPending}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
              data-testid="button-promote-production"
            >
              {promoteProduction.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Promotion en cours...</>
              ) : (
                <><ArrowUpCircle className="w-4 h-4 mr-2" /> Promouvoir en Production</>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {status?.productionUrl && (
        <DeployRollbackSection pid={pid} />
      )}

      {(status?.stagingUrl || status?.productionUrl) && (
        <LivePreviewPanel stagingUrl={status?.stagingUrl || null} productionUrl={status?.productionUrl || null} />
      )}
    </div>
  );
}

function DeployRollbackSection({ pid }: { pid: string }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: snapshotsData, isLoading: snapsLoading } = useQuery<{ snapshots: Array<{ dir: string; timestamp: string; size: string }> }>({
    queryKey: [API, "deployment-snapshots", pid],
    queryFn: () => devmaxFetch(`${API}/deployment-snapshots`, undefined, pid).then(r => r.json()),
    enabled: !!pid && expanded,
  });

  const rollbackMut = useMutation({
    mutationFn: (snapshotDir?: string) => devmaxApiRequest("POST", `${API}/rollback-production`, { snapshotDir }, pid),
    onSuccess: (data: any) => {
      setConfirmOpen(false);
      setSelectedSnapshot(null);
      if (data.browserAccessible) {
        toast({ title: "Rollback reussi", description: data.productionUrl || "Production restauree" });
      } else {
        toast({ title: "Rollback applique", description: `${data.productionUrl}\n⚠️ ${data.browserStatus || "Non accessible"}`, variant: "destructive" });
      }
      devmaxQueryClient.invalidateQueries({ queryKey: [API] });
    },
    onError: (e: any) => {
      setConfirmOpen(false);
      toast({ title: "Erreur rollback", description: e.message, variant: "destructive" });
    },
  });

  const snapshots = snapshotsData?.snapshots || [];

  return (
    <Card className="border-red-500/20">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(!expanded)} data-testid="toggle-rollback-section">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-red-400" /> Rollback Production
          </h4>
          <ChevronRight className={cn("w-4 h-4 text-muted-foreground transition-transform", expanded && "rotate-90")} />
        </div>

        {expanded && (
          <div className="space-y-3 pt-1">
            <p className="text-xs text-muted-foreground">
              Restaurer la production a partir d'un snapshot precedent. Les snapshots sont crees automatiquement avant chaque promotion.
            </p>

            {snapsLoading ? (
              <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-red-400" /></div>
            ) : snapshots.length === 0 ? (
              <div className="p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground text-center">
                Aucun snapshot disponible. Les snapshots sont crees lors de la premiere promotion.
              </div>
            ) : (
              <div className="space-y-1.5">
                {snapshots.map((snap) => {
                  const displayTs = snap.timestamp.replace(/T/, " ").replace(/-/g, "/").slice(0, 19);
                  return (
                    <div
                      key={snap.dir}
                      className={cn(
                        "flex items-center justify-between p-2.5 rounded-xl text-sm cursor-pointer transition-all",
                        selectedSnapshot === snap.dir ? "bg-red-500/10 border border-red-500/30 shadow-sm" : "hover:bg-muted/50 border border-transparent"
                      )}
                      onClick={() => setSelectedSnapshot(selectedSnapshot === snap.dir ? null : snap.dir)}
                      data-testid={`snapshot-${snap.timestamp}`}
                    >
                      <div className="flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="font-mono text-xs">{displayTs}</span>
                      </div>
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">{snap.size}</Badge>
                    </div>
                  );
                })}
              </div>
            )}

            {!confirmOpen && selectedSnapshot && (
              <Button
                variant="destructive"
                size="sm"
                className="w-full rounded-xl"
                onClick={() => setConfirmOpen(true)}
                data-testid="button-rollback-start"
              >
                <RotateCcw className="w-4 h-4 mr-2" /> Rollback vers ce snapshot
              </Button>
            )}

            {confirmOpen && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 space-y-3">
                <p className="text-xs text-red-300 font-medium">
                  Confirmer le rollback ? La production actuelle sera remplacee par le snapshot selectionne.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    className="flex-1 rounded-xl"
                    onClick={() => rollbackMut.mutate(selectedSnapshot || undefined)}
                    disabled={rollbackMut.isPending}
                    data-testid="button-confirm-deploy-rollback"
                  >
                    {rollbackMut.isPending ? (
                      <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Rollback en cours...</>
                    ) : (
                      <><RotateCcw className="w-4 h-4 mr-2" /> Confirmer le Rollback</>
                    )}
                  </Button>
                  <Button variant="ghost" size="sm" className="rounded-xl" onClick={() => { setConfirmOpen(false); setSelectedSnapshot(null); }} data-testid="button-cancel-rollback">
                    Annuler
                  </Button>
                </div>
              </div>
            )}

            {snapshots.length > 0 && !selectedSnapshot && (
              <Button
                variant="destructive"
                size="sm"
                className="w-full rounded-xl opacity-80"
                onClick={() => {
                  setSelectedSnapshot(snapshots[0]?.dir || null);
                  setConfirmOpen(true);
                }}
                data-testid="button-quick-rollback"
              >
                <RotateCcw className="w-4 h-4 mr-2" /> Rollback rapide (dernier snapshot)
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CICDPanel() {
  const { toast } = useToast();
  const { activeProject } = useDevmaxAuth();
  const pid = activeProject?.id || "";

  const { data: runs, isLoading, refetch } = useQuery<{ workflow_runs: WorkflowRun[] }>({
    queryKey: [API, "actions", "runs", pid],
    queryFn: () => devmaxFetch(`${API}/actions/runs`, undefined, pid).then(r => r.json()).then(d => d?.workflow_runs ? d : { workflow_runs: [] }),
    enabled: !!pid,
  });

  const { data: deployments, isLoading: deploymentsLoading, refetch: refetchDeploys } = useQuery<{ deployments: any[] }>({
    queryKey: [API, "deployments", pid],
    queryFn: () => devmaxFetch(`${API}/deployments?limit=20`, undefined, pid).then(r => r.json()),
    enabled: !!pid,
  });

  const setupWebhook = useMutation({
    mutationFn: (branch?: string) => devmaxApiRequest("POST", `${API}/setup-webhook`, { branch: branch || "main" }, pid),
    onSuccess: (data: any) => { toast({ title: "Webhook CI/CD configure", description: data.message }); refetchDeploys(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const toggleCicd = useMutation({
    mutationFn: (enabled: boolean) => devmaxApiRequest("POST", `${API}/toggle-cicd`, { enabled }, pid),
    onSuccess: () => { toast({ title: "CI/CD mis a jour" }); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const rerun = useMutation({
    mutationFn: (id: number) => devmaxApiRequest("POST", `${API}/actions/runs/${id}/rerun`, undefined, pid),
    onSuccess: () => { toast({ title: "Relance" }); refetch(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const cancel = useMutation({
    mutationFn: (id: number) => devmaxApiRequest("POST", `${API}/actions/runs/${id}/cancel`, undefined, pid),
    onSuccess: () => { toast({ title: "Annule" }); refetch(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const workflowRuns = runs?.workflow_runs || [];
  const deploys = deployments?.deployments || [];

  function statusIcon(run: WorkflowRun) {
    if (run.status === "in_progress" || run.status === "queued") return <Loader2 className="w-4 h-4 animate-spin text-amber-400" />;
    if (run.conclusion === "success") return <CheckCircle className="w-4 h-4 text-emerald-400" />;
    if (run.conclusion === "failure") return <XCircle className="w-4 h-4 text-red-400" />;
    return <Clock className="w-4 h-4 text-muted-foreground" />;
  }

  function deployStatusIcon(status: string) {
    if (status === "success") return <CheckCircle className="w-4 h-4 text-emerald-400" />;
    if (status === "failed" || status === "error") return <XCircle className="w-4 h-4 text-red-400" />;
    if (status === "pending") return <Loader2 className="w-4 h-4 animate-spin text-amber-400" />;
    return <Clock className="w-4 h-4 text-muted-foreground" />;
  }

  function triggerBadge(trigger: string) {
    const colors: Record<string, string> = { webhook: "bg-cyan-500/20 text-cyan-400", manual: "bg-blue-500/20 text-blue-400", rollback: "bg-amber-500/20 text-amber-400" };
    return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${colors[trigger] || "bg-gray-500/20 text-gray-400"}`}>{trigger}</span>;
  }

  function envBadge(env: string) {
    return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${env === "production" ? "bg-emerald-500/20 text-emerald-400" : "bg-violet-500/20 text-violet-400"}`}>{env === "production" ? "prod" : "staging"}</span>;
  }

  const cicdActive = (activeProject as any)?.cicd_enabled !== false;
  const hasWebhook = !!(activeProject as any)?.webhook_id;

  return (
    <div className="space-y-6">
      <Card className={cn("border", hasWebhook ? "border-emerald-500/30 bg-emerald-500/5" : "border-dashed border-2")}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", hasWebhook ? "bg-emerald-500/20" : "bg-gray-500/20")}>
                <Zap className={cn("w-4 h-4", hasWebhook ? "text-emerald-400" : "text-muted-foreground")} />
              </div>
              <div>
                <h3 className="text-sm font-medium" data-testid="text-cicd-title">CI/CD Auto-Deploy</h3>
                <p className="text-xs text-muted-foreground">
                  {hasWebhook ? `Push sur main → deploy staging automatique` : "Non configure — activez pour deployer automatiquement a chaque push"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {hasWebhook && (
                <Badge variant={cicdActive ? "default" : "secondary"} className={cn("rounded-lg text-xs", cicdActive ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30" : "")} data-testid="badge-cicd-status">
                  {cicdActive ? "Actif" : "Pause"}
                </Badge>
              )}
              {hasWebhook ? (
                <Button size="sm" variant="outline" className="rounded-xl text-xs" onClick={() => toggleCicd.mutate(!cicdActive)} disabled={toggleCicd.isPending} data-testid="button-toggle-cicd">
                  {cicdActive ? "Pause" : "Activer"}
                </Button>
              ) : (
                <Button size="sm" className="rounded-xl text-xs bg-emerald-600 hover:bg-emerald-700" onClick={() => setupWebhook.mutate("main")} disabled={setupWebhook.isPending} data-testid="button-setup-webhook">
                  {setupWebhook.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Zap className="w-3 h-3 mr-1" />}
                  Activer CI/CD
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium flex items-center gap-2"><Activity className="w-4 h-4 text-cyan-400" /> Historique des deployements</h3>
          <Button size="icon" variant="ghost" className="rounded-xl" onClick={() => refetchDeploys()} data-testid="button-refresh-deploys">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
        {deploymentsLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-cyan-400" /></div>
        ) : deploys.length === 0 ? (
          <Card className="border-dashed border-2">
            <CardContent className="p-6 text-center">
              <Play className="w-6 h-6 mx-auto text-muted-foreground/30 mb-1" />
              <p className="text-sm text-muted-foreground">Aucun deployement enregistre</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {deploys.map((d: any, i: number) => (
              <motion.div key={d.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}>
                <Card className="overflow-hidden hover:shadow-md transition-shadow">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {deployStatusIcon(d.status)}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            {envBadge(d.environment)}
                            {triggerBadge(d.trigger)}
                            {d.commit_sha && <span className="text-xs font-mono text-muted-foreground">{d.commit_sha.substring(0, 8)}</span>}
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {d.commit_message || `Deploy ${d.environment}`}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-muted-foreground">{timeAgo(d.created_at)}</p>
                        {d.duration_ms && <p className="text-[10px] text-muted-foreground">{(d.duration_ms / 1000).toFixed(1)}s</p>}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium flex items-center gap-2"><Activity className="w-4 h-4 text-emerald-400" /> GitHub Actions</h3>
          <Button size="icon" variant="ghost" className="rounded-xl" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-emerald-400" /></div>
        ) : workflowRuns.length === 0 ? (
          <Card className="border-dashed border-2">
            <CardContent className="p-6 text-center">
              <Play className="w-6 h-6 mx-auto text-muted-foreground/30 mb-1" />
              <p className="text-sm text-muted-foreground">Aucun workflow GitHub Actions</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {workflowRuns.slice(0, 20).map((run, i) => (
              <motion.div key={run.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}>
                <Card className="overflow-hidden hover:shadow-md transition-shadow">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {statusIcon(run)}
                        <div className="min-w-0">
                          <span className="text-sm font-medium truncate block">{run.name}</span>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>#{run.run_number}</span>
                            <span className="font-mono">{run.head_branch}</span>
                            <span>{timeAgo(run.created_at)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {run.status === "completed" && run.conclusion === "failure" && (
                          <Button size="icon" variant="ghost" className="h-7 w-7 rounded-lg" onClick={() => rerun.mutate(run.id)} data-testid={`button-rerun-${run.id}`}>
                            <RotateCcw className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {(run.status === "in_progress" || run.status === "queued") && (
                          <Button size="icon" variant="ghost" className="h-7 w-7 rounded-lg" onClick={() => cancel.mutate(run.id)} data-testid={`button-cancel-${run.id}`}>
                            <StopCircle className="w-3.5 h-3.5 text-destructive" />
                          </Button>
                        )}
                        <a href={run.html_url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                        </a>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FileBrowserPanel() {
  const { activeProject } = useDevmaxAuth();
  const pid = activeProject?.id || "";
  const [branch, setBranch] = useState("main");
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [fileContent, setFileContent] = useState<{ path: string; content: string; sha: string } | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [commitMsg, setCommitMsg] = useState("");
  const { toast } = useToast();

  const { data: tree, isLoading } = useQuery<{ tree: TreeItem[] }>({
    queryKey: [API, "tree", branch, pid],
    queryFn: () => devmaxFetch(`${API}/tree/${branch}`, undefined, pid).then(r => r.json()).then(d => d?.tree ? d : { tree: [] }),
    enabled: !!pid,
  });

  const items = useMemo(() => {
    if (!tree?.tree) return [];
    const prefix = currentPath.join("/");
    return tree.tree
      .filter(item => {
        const parts = item.path.split("/");
        if (prefix) {
          if (!item.path.startsWith(prefix + "/")) return false;
          const remaining = item.path.slice(prefix.length + 1);
          return !remaining.includes("/");
        }
        return parts.length === 1;
      })
      .sort((a, b) => {
        if (a.type === "tree" && b.type !== "tree") return -1;
        if (a.type !== "tree" && b.type === "tree") return 1;
        return a.path.localeCompare(b.path);
      });
  }, [tree, currentPath]);

  const openFile = useCallback(async (path: string) => {
    try {
      const res = await devmaxFetch(`${API}/contents/${path}?ref=${branch}`, undefined, pid);
      const data = await res.json();
      const raw = atob(data.content?.replace(/\n/g, "") || "");
      const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
      const decoded = new TextDecoder("utf-8").decode(bytes);
      setFileContent({ path, content: decoded, sha: data.sha });
      setEditContent(decoded);
      setEditMode(false);
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    }
  }, [branch, toast, pid]);

  const saveFile = useMutation({
    mutationFn: async () => {
      await devmaxApiRequest("PUT", `${API}/contents/${fileContent!.path}`, {
        content: editContent,
        message: commitMsg || `Update ${fileContent!.path}`,
        branch,
        sha: fileContent!.sha,
      }, pid);
    },
    onSuccess: () => {
      toast({ title: "Fichier sauvegarde" });
      setEditMode(false);
      setCommitMsg("");
      devmaxQueryClient.invalidateQueries({ queryKey: [API, "tree", branch, pid] });
      devmaxQueryClient.invalidateQueries({ queryKey: [API, "commits"] });
      if (fileContent) openFile(fileContent.path);
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  if (fileContent) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="ghost" className="rounded-xl" onClick={() => setFileContent(null)} data-testid="button-back-files">
            <ArrowLeft className="w-4 h-4 mr-1" /> Retour
          </Button>
          <code className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">{fileContent.path}</code>
          <div className="flex-1" />
          {!editMode ? (
            <Button size="sm" className="rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-600 hover:opacity-90 text-white border-0" onClick={() => setEditMode(true)} data-testid="button-edit-file">
              <Code className="w-3.5 h-3.5 mr-1" /> Editer
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Input placeholder="Message du commit" value={commitMsg} onChange={e => setCommitMsg(e.target.value)} className="w-48 h-8 text-xs rounded-xl" />
              <Button size="sm" className="rounded-xl" onClick={() => saveFile.mutate()} disabled={saveFile.isPending} data-testid="button-save-file">
                {saveFile.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                <span className="ml-1">Sauver</span>
              </Button>
              <Button size="sm" variant="outline" className="rounded-xl" onClick={() => { setEditMode(false); setEditContent(fileContent.content); }}>Annuler</Button>
            </div>
          )}
        </div>
        {editMode ? (
          <Textarea value={editContent} onChange={e => setEditContent(e.target.value)} className="font-mono text-xs min-h-[400px] rounded-xl" data-testid="textarea-edit-file" />
        ) : (
          <ScrollArea className="h-[400px] rounded-xl border">
            <pre className="p-4 text-xs font-mono whitespace-pre-wrap">{fileContent.content}</pre>
          </ScrollArea>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Input value={branch} onChange={e => setBranch(e.target.value)} className="w-32 rounded-xl" />
        {currentPath.length > 0 && (
          <Button size="sm" variant="ghost" className="rounded-xl" onClick={() => setCurrentPath(p => p.slice(0, -1))} data-testid="button-nav-up">
            <ArrowLeft className="w-4 h-4 mr-1" /> ..
          </Button>
        )}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="cursor-pointer hover:text-foreground" onClick={() => setCurrentPath([])}>root</span>
          {currentPath.map((p, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="w-3 h-3" />
              <span className="cursor-pointer hover:text-foreground" onClick={() => setCurrentPath(prev => prev.slice(0, i + 1))}>{p}</span>
            </span>
          ))}
        </div>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>
      ) : (
        <div className="space-y-1">
          {items.map(item => {
            const name = item.path.split("/").pop()!;
            const isDir = item.type === "tree";
            return (
              <div
                key={item.path}
                className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted cursor-pointer text-sm transition-colors"
                onClick={() => isDir ? setCurrentPath(item.path.split("/")) : openFile(item.path)}
                data-testid={`file-item-${name}`}
              >
                {isDir ? <Folder className="w-4 h-4 text-cyan-400" /> : <File className="w-4 h-4 text-muted-foreground" />}
                <span className="flex-1 font-mono text-sm">{name}</span>
                {item.size && <span className="text-xs text-muted-foreground">{(item.size / 1024).toFixed(1)}KB</span>}
              </div>
            );
          })}
          {items.length === 0 && (
            <Card className="border-dashed border-2">
              <CardContent className="p-8 text-center">
                <Folder className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">Dossier vide</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function StagingFileBrowserPanel() {
  const { activeProject } = useDevmaxAuth();
  const pid = activeProject?.id || "";
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [fileContent, setFileContent] = useState<{ path: string; content: string; sha: string } | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [commitMsg, setCommitMsg] = useState("");
  const [deploying, setDeploying] = useState(false);
  const [deployStatus, setDeployStatus] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: branches } = useQuery<Branch[]>({
    queryKey: [API, "branches", "staging-check", pid],
    queryFn: () => devmaxFetch(`${API}/branches`, undefined, pid).then(r => r.json()).then(d => Array.isArray(d) ? d : []),
    enabled: !!pid,
  });

  const hasStagingBranch = useMemo(() => branches?.some(b => b.name === "staging") || false, [branches]);

  const { data: tree, isLoading } = useQuery<{ tree: TreeItem[] }>({
    queryKey: [API, "tree", "staging", pid],
    queryFn: () => devmaxFetch(`${API}/tree/staging`, undefined, pid).then(r => r.json()).then(d => d?.tree ? d : { tree: [] }),
    enabled: !!pid && hasStagingBranch,
  });

  const items = useMemo(() => {
    if (!tree?.tree) return [];
    const prefix = currentPath.join("/");
    return tree.tree
      .filter(item => {
        const parts = item.path.split("/");
        if (prefix) {
          if (!item.path.startsWith(prefix + "/")) return false;
          const remaining = item.path.slice(prefix.length + 1);
          return !remaining.includes("/");
        }
        return parts.length === 1;
      })
      .sort((a, b) => {
        if (a.type === "tree" && b.type !== "tree") return -1;
        if (a.type !== "tree" && b.type === "tree") return 1;
        return a.path.localeCompare(b.path);
      });
  }, [tree, currentPath]);

  const openFile = useCallback(async (path: string) => {
    try {
      const res = await devmaxFetch(`${API}/contents/${path}?ref=staging`, undefined, pid);
      const data = await res.json();
      const raw = atob(data.content?.replace(/\n/g, "") || "");
      const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
      const decoded = new TextDecoder("utf-8").decode(bytes);
      setFileContent({ path, content: decoded, sha: data.sha });
      setEditContent(decoded);
      setEditMode(false);
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    }
  }, [toast, pid]);

  const saveFile = useMutation({
    mutationFn: async () => {
      await devmaxApiRequest("PUT", `${API}/contents/${fileContent!.path}`, {
        content: editContent,
        message: commitMsg || `[staging] Update ${fileContent!.path}`,
        branch: "staging",
        sha: fileContent!.sha,
      }, pid);
    },
    onSuccess: () => {
      toast({ title: "Sauvegardé sur staging" });
      setEditMode(false);
      setCommitMsg("");
      devmaxQueryClient.invalidateQueries({ queryKey: [API, "tree", "staging", pid] });
      devmaxQueryClient.invalidateQueries({ queryKey: [API, "commits"] });
      if (fileContent) openFile(fileContent.path);
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const deployToProd = useCallback(async () => {
    setDeploying(true);
    setDeployStatus("Vérification staging...");
    try {
      const commitsRes = await devmaxFetch(`${API}/commits?branch=staging&per_page=1`, undefined, pid);
      const commits = await commitsRes.json();
      if (!Array.isArray(commits) || !commits.length) {
        toast({ title: "Erreur", description: "Aucun commit sur staging", variant: "destructive" });
        setDeploying(false);
        setDeployStatus(null);
        return;
      }

      setDeployStatus("Création PR staging → prod...");
      let prNumber: number | null = null;
      try {
        const prRes = await devmaxApiRequest("POST", `${API}/pulls`, {
          title: `[Deploy] Staging → Prod (${new Date().toLocaleDateString("fr-FR")})`,
          body: `Déploiement depuis staging.\nCommit: ${commits[0].sha?.slice(0, 7)}`,
          head: "staging",
          base: "main",
        }, pid);
        prNumber = prRes?.number;
      } catch (prErr: any) {
        const msg = prErr?.message || "";
        if (msg.includes("422") || msg.toLowerCase().includes("no commits") || msg.toLowerCase().includes("already")) {
          toast({ title: "Info", description: "Staging est déjà à jour avec la prod." });
          setDeploying(false);
          setDeployStatus(null);
          return;
        }
        throw prErr;
      }

      if (!prNumber) {
        toast({ title: "Info", description: "Rien à déployer." });
        setDeploying(false);
        setDeployStatus(null);
        return;
      }

      setDeployStatus(`Merge PR #${prNumber}...`);
      await devmaxApiRequest("PUT", `${API}/pulls/${prNumber}/merge`, { merge_method: "merge" }, pid);

      toast({ title: "Déploiement réussi !", description: `PR #${prNumber} mergée` });
      setDeployStatus("Terminé !");
      devmaxQueryClient.invalidateQueries({ queryKey: [API, "tree"] });
      devmaxQueryClient.invalidateQueries({ queryKey: [API, "commits"] });
      setTimeout(() => setDeployStatus(null), 3000);
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message || "Échec du déploiement", variant: "destructive" });
      setDeployStatus(null);
    }
    setDeploying(false);
  }, [pid, toast]);

  if (!branches) {
    return (
      <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-amber-400" /></div>
    );
  }

  if (!hasStagingBranch) {
    return (
      <Card className="border-dashed border-2">
        <CardContent className="p-8 text-center">
          <FlaskConical className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground mb-1">Pas de branche <code className="bg-muted px-1 rounded">staging</code></p>
          <p className="text-xs text-muted-foreground">Créez-la depuis l'onglet Branches.</p>
        </CardContent>
      </Card>
    );
  }

  if (fileContent) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="ghost" className="rounded-xl" onClick={() => { if (editMode) { if (!confirm("Quitter sans sauvegarder ?")) return; } setFileContent(null); setEditMode(false); }} data-testid="button-back-staging">
            <ArrowLeft className="w-4 h-4 mr-1" /> Retour
          </Button>
          <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-600">staging</Badge>
          <code className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">{fileContent.path}</code>
          <div className="flex-1" />
          {!editMode ? (
            <Button size="sm" className="rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:opacity-90 text-white border-0" onClick={() => setEditMode(true)} data-testid="button-edit-staging">
              <Pencil className="w-3.5 h-3.5 mr-1" /> Éditer
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Input placeholder="Message du commit" value={commitMsg} onChange={e => setCommitMsg(e.target.value)} className="w-48 h-8 text-xs rounded-xl" data-testid="input-staging-commit" />
              <Button size="sm" className="rounded-xl" onClick={() => saveFile.mutate()} disabled={saveFile.isPending} data-testid="button-save-staging">
                {saveFile.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span className="ml-1">Commit staging</span>
              </Button>
              <Button size="sm" variant="outline" className="rounded-xl" onClick={() => { setEditMode(false); setEditContent(fileContent.content); }} data-testid="button-staging-cancel">Annuler</Button>
            </div>
          )}
        </div>
        {editMode ? (
          <Textarea value={editContent} onChange={e => setEditContent(e.target.value)} className="font-mono text-xs min-h-[400px] rounded-xl" data-testid="textarea-staging-edit" />
        ) : (
          <ScrollArea className="h-[400px] rounded-xl border">
            <pre className="p-4 text-xs font-mono whitespace-pre-wrap">{fileContent.content}</pre>
          </ScrollArea>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-600">
          <FlaskConical className="w-3 h-3 mr-1" /> staging
        </Badge>
        {currentPath.length > 0 && (
          <Button size="sm" variant="ghost" className="rounded-xl" onClick={() => setCurrentPath(p => p.slice(0, -1))} data-testid="button-staging-nav-up">
            <ArrowLeft className="w-4 h-4 mr-1" /> ..
          </Button>
        )}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="cursor-pointer hover:text-foreground" onClick={() => setCurrentPath([])} data-testid="breadcrumb-staging-root">root</span>
          {currentPath.map((p, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="w-3 h-3" />
              <span className="cursor-pointer hover:text-foreground" onClick={() => setCurrentPath(prev => prev.slice(0, i + 1))} data-testid={`breadcrumb-staging-${p}`}>{p}</span>
            </span>
          ))}
        </div>
        <div className="flex-1" />
        <Button
          size="sm"
          className="rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 hover:opacity-90 text-white border-0"
          disabled={deploying}
          onClick={() => { if (confirm("Déployer staging vers production ?")) deployToProd(); }}
          data-testid="button-deploy-staging"
        >
          {deploying ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Rocket className="w-3.5 h-3.5 mr-1" />}
          Déployer en Prod
        </Button>
      </div>

      {deployStatus && (
        <div className="flex items-center gap-2 text-xs p-2 rounded-xl bg-muted/50 border">
          {deploying ? <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" /> : <CheckCircle className="w-3.5 h-3.5 text-green-500" />}
          <span className="text-muted-foreground">{deployStatus}</span>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-amber-400" /></div>
      ) : (
        <div className="space-y-1">
          {items.map(item => {
            const name = item.path.split("/").pop()!;
            const isDir = item.type === "tree";
            return (
              <div
                key={item.path}
                className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted cursor-pointer text-sm transition-colors"
                onClick={() => isDir ? setCurrentPath(item.path.split("/")) : openFile(item.path)}
                data-testid={`staging-item-${name}`}
              >
                {isDir ? <Folder className="w-4 h-4 text-amber-400" /> : <File className="w-4 h-4 text-muted-foreground" />}
                <span className="flex-1 font-mono text-sm">{name}</span>
                {item.size && <span className="text-xs text-muted-foreground">{(item.size / 1024).toFixed(1)}KB</span>}
              </div>
            );
          })}
          {items.length === 0 && (
            <Card className="border-dashed border-2">
              <CardContent className="p-8 text-center">
                <Folder className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">Aucun fichier sur staging</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function CostsDashboardPanel() {
  const [period, setPeriod] = useState("24h");
  const periodMs: Record<string, number> = { "1h": 3600000, "24h": 86400000, "7d": 604800000, "30d": 2592000000 };
  const { data, isLoading } = useQuery<any>({
    queryKey: [API, "costs", period],
    queryFn: () => devmaxFetch(`${API}/costs/summary?period=${periodMs[period] || 86400000}`).then(r => r.json()),
    refetchInterval: 60000,
  });
  const fmt = (n: number) => n < 0.01 ? "<$0.01" : `$${n.toFixed(4)}`;
  return (
    <div className="space-y-4" data-testid="costs-dashboard">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2"><DollarSign className="w-4 h-4" /> Coûts OpenAI</h3>
        <div className="flex gap-1">
          {Object.keys(periodMs).map(p => (
            <Button key={p} size="sm" variant={period === p ? "default" : "outline"} onClick={() => setPeriod(p)} data-testid={`cost-period-${p}`}>{p}</Button>
          ))}
        </div>
      </div>
      {isLoading ? <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin" /></div> : !data ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">Aucune donnée de coûts</CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card><CardContent className="p-4 text-center"><p className="text-xs text-muted-foreground">Coût total</p><p className="text-xl font-bold text-green-500" data-testid="cost-total">{fmt(data.totalCost || 0)}</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className="text-xs text-muted-foreground">Appels</p><p className="text-xl font-bold" data-testid="cost-calls">{Object.values(data.byModel || {}).reduce((s: number, m: any) => s + (m.calls || 0), 0)}</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className="text-xs text-muted-foreground">Input tokens</p><p className="text-xl font-bold">{(data.totalInput || 0).toLocaleString()}</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className="text-xs text-muted-foreground">Output tokens</p><p className="text-xl font-bold">{(data.totalOutput || 0).toLocaleString()}</p></CardContent></Card>
          </div>
          {data.byModel && Object.keys(data.byModel).length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Par modèle</CardTitle></CardHeader>
              <CardContent className="p-3">
                <div className="space-y-2">
                  {Object.entries(data.byModel).sort((a: any, b: any) => b[1].cost - a[1].cost).map(([model, info]: any) => (
                    <div key={model} className="flex items-center justify-between text-sm">
                      <span className="font-mono text-xs truncate max-w-[200px]" data-testid={`cost-model-${model}`}>{model}</span>
                      <div className="flex gap-3 text-muted-foreground">
                        <span>{info.calls} appels</span>
                        <span className="font-semibold text-foreground">{fmt(info.cost)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          {data.byContext && Object.keys(data.byContext).length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Par contexte</CardTitle></CardHeader>
              <CardContent className="p-3">
                <div className="space-y-1">
                  {Object.entries(data.byContext).sort((a: any, b: any) => b[1].cost - a[1].cost).map(([ctx, info]: any) => (
                    <div key={ctx} className="flex items-center justify-between text-sm">
                      <span>{ctx}</span>
                      <span className="text-muted-foreground">{info.calls} appels — {fmt(info.cost)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function GitHubEventsPanel() {
  const { activeProject } = useDevmaxAuth();
  const pid = activeProject?.id || "";
  const { data: events, isLoading } = useQuery<any[]>({
    queryKey: [API, "github-events", pid],
    queryFn: () => devmaxFetch(`${API}/github-events/${pid}`).then(r => r.json()).then(d => Array.isArray(d) ? d : []),
    enabled: !!pid,
    refetchInterval: 30000,
  });
  const eventIcon = (type: string) => {
    if (type === "push") return <GitCommit className="w-4 h-4 text-blue-500" />;
    if (type === "pull_request") return <GitPullRequest className="w-4 h-4 text-purple-500" />;
    if (type === "issues") return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
    if (type === "workflow_run") return <Play className="w-4 h-4 text-green-500" />;
    if (type === "release") return <Rocket className="w-4 h-4 text-orange-500" />;
    return <Activity className="w-4 h-4 text-muted-foreground" />;
  };
  return (
    <div className="space-y-3" data-testid="github-events-panel">
      <h3 className="font-semibold flex items-center gap-2"><Activity className="w-4 h-4" /> Événements GitHub</h3>
      {isLoading ? <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin" /></div> : !events?.length ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">Aucun événement récent</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {events.map((evt: any) => (
            <Card key={evt.id} data-testid={`event-${evt.id}`}>
              <CardContent className="p-3 flex items-start gap-3">
                {eventIcon(evt.event_type)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium truncate">{evt.title}</p>
                    <Badge variant="outline" className="text-[10px] shrink-0">{evt.event_type}</Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                    {evt.actor && <span>@{evt.actor}</span>}
                    {evt.branch && <span className="font-mono">{evt.branch}</span>}
                    <span>{new Date(evt.created_at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function HealthChecksPanel() {
  const { activeProject } = useDevmaxAuth();
  const appName = activeProject?.deploy_slug || activeProject?.name || "";
  const { data: checks, isLoading } = useQuery<any[]>({
    queryKey: [API, "health-checks", appName],
    queryFn: () => devmaxFetch(`${API}/health-checks/${encodeURIComponent(appName)}`).then(r => r.json()).then(d => Array.isArray(d) ? d : []),
    enabled: !!appName,
    refetchInterval: 60000,
  });
  const statusColor = (s: string) => s === "healthy" ? "text-green-500" : s === "degraded" ? "text-yellow-500" : "text-red-500";
  const statusBg = (s: string) => s === "healthy" ? "bg-green-500/10" : s === "degraded" ? "bg-yellow-500/10" : "bg-red-500/10";
  return (
    <div className="space-y-3" data-testid="health-checks-panel">
      <h3 className="font-semibold flex items-center gap-2"><HeartPulse className="w-4 h-4" /> Health Checks</h3>
      {isLoading ? <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin" /></div> : !checks?.length ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">Aucun health check enregistré</CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {["healthy", "degraded", "down"].map(s => {
              const count = checks.filter((c: any) => c.status === s).length;
              return (
                <Card key={s} className={statusBg(s)}>
                  <CardContent className="p-3 text-center">
                    <p className={`text-2xl font-bold ${statusColor(s)}`}>{count}</p>
                    <p className="text-xs text-muted-foreground capitalize">{s}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <div className="space-y-2">
            {checks.slice(0, 20).map((c: any, i: number) => (
              <Card key={i} data-testid={`health-check-${i}`}>
                <CardContent className="p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {c.status === "healthy" ? <CheckCircle className="w-4 h-4 text-green-500" /> : c.status === "degraded" ? <AlertTriangle className="w-4 h-4 text-yellow-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
                    <div>
                      <p className="text-sm font-medium">{c.url || c.app_name || appName}</p>
                      {c.response_time_ms && <p className="text-xs text-muted-foreground">{c.response_time_ms}ms — HTTP {c.http_code || "?"}</p>}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">{c.checked_at ? new Date(c.checked_at).toLocaleString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : ""}</span>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SecretsManagerPanel() {
  const { toast } = useToast();
  const { activeProject } = useDevmaxAuth();
  const pid = activeProject?.id || "";
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, string>>({});
  const { data: secrets, isLoading, refetch } = useQuery<any[]>({
    queryKey: [API, "secrets", pid],
    queryFn: () => devmaxFetch(`${API}/secrets/${pid}`).then(r => r.json()).then(d => Array.isArray(d) ? d : []),
    enabled: !!pid,
  });
  const addSecret = useMutation({
    mutationFn: () => devmaxFetch(`${API}/secrets/${pid}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: newKey, value: newValue }) }).then(r => { if (!r.ok) throw new Error("Erreur"); return r.json(); }),
    onSuccess: () => { toast({ title: "Secret ajouté" }); setNewKey(""); setNewValue(""); refetch(); },
    onError: () => toast({ title: "Erreur", variant: "destructive" }),
  });
  const deleteSecret = useMutation({
    mutationFn: (id: string) => devmaxFetch(`${API}/secrets/${pid}/${id}`, { method: "DELETE" }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    onSuccess: () => { toast({ title: "Secret supprimé" }); refetch(); },
  });
  const revealSecret = async (id: string) => {
    try {
      const res = await devmaxFetch(`${API}/secrets/${pid}/reveal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secretId: id }) });
      const data = await res.json();
      if (data.value) setRevealedSecrets(prev => ({ ...prev, [id]: data.value }));
    } catch { toast({ title: "Impossible de révéler", variant: "destructive" }); }
  };
  const syncSecrets = useMutation({
    mutationFn: () => devmaxFetch(`${API}/secrets/${pid}/sync`, { method: "POST" }).then(r => r.json()),
    onSuccess: (data: any) => toast({ title: "Sync terminé", description: `${data.synced || 0} secrets synchronisés` }),
  });
  return (
    <div className="space-y-4" data-testid="secrets-manager">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2"><KeyRound className="w-4 h-4" /> Secrets (AES-256)</h3>
        <Button size="sm" variant="outline" onClick={() => syncSecrets.mutate()} disabled={syncSecrets.isPending} data-testid="btn-sync-secrets">
          {syncSecrets.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />} Sync .env
        </Button>
      </div>
      <Card>
        <CardContent className="p-3 space-y-2">
          <div className="flex gap-2">
            <Input placeholder="KEY" value={newKey} onChange={e => setNewKey(e.target.value.toUpperCase())} className="font-mono text-xs" data-testid="input-secret-key" />
            <Input placeholder="value" type="password" value={newValue} onChange={e => setNewValue(e.target.value)} className="text-xs" data-testid="input-secret-value" />
            <Button size="sm" onClick={() => addSecret.mutate()} disabled={!newKey || !newValue || addSecret.isPending} data-testid="btn-add-secret">
              {addSecret.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            </Button>
          </div>
        </CardContent>
      </Card>
      {isLoading ? <div className="flex justify-center p-4"><Loader2 className="w-6 h-6 animate-spin" /></div> : !secrets?.length ? (
        <p className="text-sm text-muted-foreground text-center">Aucun secret enregistré</p>
      ) : (
        <div className="space-y-1">
          {secrets.map((s: any) => (
            <Card key={s.id} data-testid={`secret-${s.id}`}>
              <CardContent className="p-2 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <Lock className="w-3 h-3 text-muted-foreground shrink-0" />
                  <span className="font-mono text-xs font-medium truncate">{s.key}</span>
                </div>
                <div className="flex items-center gap-1">
                  {revealedSecrets[s.id] ? (
                    <span className="font-mono text-xs text-muted-foreground max-w-[120px] truncate">{revealedSecrets[s.id]}</span>
                  ) : (
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => revealSecret(s.id)} data-testid={`btn-reveal-${s.id}`}><Eye className="w-3 h-3" /></Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-500" onClick={() => deleteSecret.mutate(s.id)} data-testid={`btn-delete-secret-${s.id}`}><Trash2 className="w-3 h-3" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function DeployHistoryPanel() {
  const { activeProject } = useDevmaxAuth();
  const pid = activeProject?.id || "";
  const [expandedDeploy, setExpandedDeploy] = useState<string | null>(null);
  const [diffData, setDiffData] = useState<Record<string, any>>({});
  const { data: deploys, isLoading } = useQuery<any[]>({
    queryKey: [API, "deploy-history", pid],
    queryFn: () => devmaxFetch(`${API}/deploy-history/${pid}`).then(r => r.json()).then(d => Array.isArray(d) ? d : []),
    enabled: !!pid,
  });
  const loadDiff = async (deployId: string) => {
    if (diffData[deployId]) { setExpandedDeploy(expandedDeploy === deployId ? null : deployId); return; }
    try {
      const res = await devmaxFetch(`${API}/deploy-diff/${deployId}`);
      const data = await res.json();
      setDiffData(prev => ({ ...prev, [deployId]: data }));
      setExpandedDeploy(deployId);
    } catch { }
  };
  const statusIcon = (s: string) => s === "success" ? <CheckCircle className="w-4 h-4 text-green-500" /> : s === "failed" ? <XCircle className="w-4 h-4 text-red-500" /> : <Clock className="w-4 h-4 text-yellow-500" />;
  return (
    <div className="space-y-3" data-testid="deploy-history-panel">
      <h3 className="font-semibold flex items-center gap-2"><History className="w-4 h-4" /> Historique des déploiements</h3>
      {isLoading ? <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin" /></div> : !deploys?.length ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">Aucun déploiement enregistré</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {deploys.map((d: any) => (
            <Card key={d.id} data-testid={`deploy-${d.id}`}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between cursor-pointer" onClick={() => loadDiff(d.id)}>
                  <div className="flex items-center gap-2">
                    {statusIcon(d.status)}
                    <div>
                      <p className="text-sm font-medium">{d.environment} — {d.trigger}</p>
                      <p className="text-xs text-muted-foreground truncate max-w-[250px]">{d.commit_message || d.commit_sha?.substring(0, 8) || "—"}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge variant={d.status === "success" ? "default" : "destructive"} className="text-[10px]">{d.status}</Badge>
                    <p className="text-[10px] text-muted-foreground mt-1">{d.duration_ms ? `${(d.duration_ms / 1000).toFixed(1)}s` : ""} {d.created_at ? new Date(d.created_at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}</p>
                  </div>
                </div>
                {expandedDeploy === d.id && diffData[d.id] && (
                  <div className="mt-3 border-t pt-2">
                    {diffData[d.id].diff ? (
                      <pre className="text-xs font-mono bg-muted p-2 rounded max-h-[200px] overflow-auto whitespace-pre-wrap">{diffData[d.id].diff}</pre>
                    ) : diffData[d.id].files?.length ? (
                      <div className="space-y-1">
                        {diffData[d.id].files.map((f: any, i: number) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <Badge variant="outline" className="text-[9px]">{f.status}</Badge>
                            <span className="font-mono truncate">{f.filename}</span>
                            {f.additions > 0 && <span className="text-green-500">+{f.additions}</span>}
                            {f.deletions > 0 && <span className="text-red-500">-{f.deletions}</span>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Pas de diff disponible</p>
                    )}
                    {d.logs && Array.isArray(d.logs) && d.logs.length > 0 && (
                      <details className="mt-2">
                        <summary className="text-xs cursor-pointer text-muted-foreground">Logs ({d.logs.length})</summary>
                        <pre className="text-[10px] font-mono bg-muted p-2 rounded mt-1 max-h-[150px] overflow-auto">{d.logs.join("\n")}</pre>
                      </details>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function RollbackPanel() {
  const { toast } = useToast();
  const { activeProject } = useDevmaxAuth();
  const pid = activeProject?.id || "";
  const [branch, setBranch] = useState("main");
  const [selectedSha, setSelectedSha] = useState<string | null>(null);

  const { data: commits, isLoading } = useQuery<Commit[]>({
    queryKey: [API, "commits", branch, "rollback", pid],
    queryFn: () => devmaxFetch(`${API}/commits?branch=${branch}&per_page=15`, undefined, pid).then(r => r.json()).then(d => Array.isArray(d) ? d : []),
    enabled: !!pid,
  });

  const rollback = useMutation({
    mutationFn: () => devmaxApiRequest("POST", `${API}/rollback`, { branch, targetSha: selectedSha, createBackup: true }, pid),
    onSuccess: (data: any) => {
      toast({ title: "Rollback effectue", description: `Backup: ${data.backupBranch || "N/A"}` });
      setSelectedSha(null);
      devmaxQueryClient.invalidateQueries({ queryKey: [API] });
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input value={branch} onChange={e => setBranch(e.target.value)} className="w-40 rounded-xl" placeholder="Branche" />
        {selectedSha && (
          <Button size="sm" variant="destructive" className="rounded-xl" onClick={() => rollback.mutate()} disabled={rollback.isPending} data-testid="button-confirm-rollback">
            {rollback.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <RotateCcw className="w-3.5 h-3.5 mr-1" />}
            Rollback vers {selectedSha.slice(0, 7)}
          </Button>
        )}
      </div>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>
      ) : (
        <div className="space-y-1">
          {commits?.map((c, i) => (
            <div
              key={c.sha}
              className={cn(
                "flex items-center gap-3 p-2.5 rounded-xl text-sm cursor-pointer transition-all",
                selectedSha === c.sha ? "bg-destructive/10 border border-destructive/30 shadow-sm" : "hover:bg-muted",
                i === 0 && "opacity-50 cursor-not-allowed"
              )}
              onClick={() => i > 0 && setSelectedSha(selectedSha === c.sha ? null : c.sha)}
              data-testid={`rollback-commit-${c.sha.slice(0, 7)}`}
            >
              <GitCommit className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="flex-1 truncate">{c.commit.message.split("\n")[0]}</span>
              <code className="text-xs text-muted-foreground font-mono">{c.sha.slice(0, 7)}</code>
              <span className="text-xs text-muted-foreground">{timeAgo(c.commit.author.date)}</span>
              {i === 0 && <Badge variant="secondary" className="text-[10px]">HEAD</Badge>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface DgmSession {
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

interface DgmTask {
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

interface DgmPipelineRun {
  id: number;
  sessionId: number;
  taskId: number;
  stage: string;
  status: string;
  durationMs: number | null;
  error: string | null;
  createdAt: string | null;
}

function DGMPanel() {
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

function DevOpsChatPanel({ currentTab }: { currentTab?: string }) {
  const { activeProject } = useDevmaxAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [threadId, setThreadId] = useState<number | null>(null);
  const [attachments, setAttachments] = useState<{ name: string; type: string; dataUrl: string }[]>([]);
  const [showQuickCmds, setShowQuickCmds] = useState(false);
  const [projectContext, setProjectContext] = useState<string>("");
  const [historyLoaded, setHistoryLoaded] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const repoFull = activeProject?.repo_owner && activeProject?.repo_name
    ? `${activeProject.repo_owner}/${activeProject.repo_name}`
    : "aucun repo";
  const auditTriggeredRef = useRef(false);
  const contextSuggestions = currentTab ? TAB_SUGGESTIONS[currentTab] || [] : [];

  useEffect(() => {
    const pid = activeProject?.id;
    if (!pid || historyLoaded === pid) return;

    const token = localStorage.getItem(DEVMAX_TOKEN_KEY) || "";
    if (!token) return;

    const loadHistory = async () => {
      try {
        const [chatRes, journalRes] = await Promise.all([
          devmaxFetch(`${AUTH_API}/chat/history/${pid}?limit=50`),
          devmaxFetch(`${AUTH_API}/journal/${pid}?limit=15`),
        ]);

        if (chatRes.ok) {
          const chatData = await chatRes.json();
          if (chatData.messages && chatData.messages.length > 0) {
            const restored: ChatMessage[] = chatData.messages.map((m: any) => ({
              role: m.role as "user" | "assistant",
              content: m.content || "",
            }));
            setMessages(restored);
            const lastThread = chatData.messages.find((m: any) => m.thread_id)?.thread_id;
            if (lastThread) setThreadId(lastThread);
          } else {
            setMessages([]);
            setThreadId(null);
          }
        }

        if (journalRes.ok) {
          const journalData = await journalRes.json();
          if (journalData.entries && journalData.entries.length > 0) {
            const journalSummary = journalData.entries
              .slice(0, 10)
              .map((e: any) => `- [${e.entry_type}] ${e.title}${e.description ? `: ${e.description}` : ""} (${new Date(e.created_at).toLocaleString("fr-FR")})`)
              .join("\n");
            setProjectContext(journalSummary);
          } else {
            setProjectContext("");
          }
        } else {
          console.warn("[MaxAI] Journal load failed:", journalRes.status);
          setProjectContext("");
        }

        setHistoryLoaded(pid);
      } catch (e) {
        console.error("[MaxAI] Failed to load chat history:", e);
        setMessages([{ role: "assistant" as const, content: "⚠️ Impossible de charger l'historique de conversation. Vous pouvez continuer à discuter normalement." }]);
        setHistoryLoaded(pid);
      }
    };

    loadHistory();
  }, [activeProject?.id, historyLoaded]);

  const saveChat = useCallback((role: string, content: string, tid?: number | null, toolCalls?: any) => {
    if (!content || content.length < 2) return;
    const pid = activeProject?.id;
    devmaxFetch(`${AUTH_API}/chat/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: pid || null, threadId: tid || null, role, content, toolCalls: toolCalls || null, metadata: { repo: repoFull } }),
    }).catch((e) => { console.warn("[MaxAI] Chat save failed:", e); });
  }, [activeProject?.id, repoFull]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const processFiles = useCallback((files: File[]) => {
    files.forEach(file => {
      if (file.size > 10 * 1024 * 1024) return;
      const reader = new FileReader();
      reader.onload = () => {
        setAttachments(prev => [...prev, { name: file.name, type: file.type, dataUrl: reader.result as string }]);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    processFiles(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [processFiles]);

  const [isDragOver, setIsDragOver] = useState(false);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const filesToProcess: File[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          const name = file.name === "image.png" && file.type.startsWith("image/")
            ? `screenshot-${Date.now()}.png`
            : file.name;
          const renamedFile = new File([file], name, { type: file.type });
          filesToProcess.push(renamedFile);
        }
      }
    }

    if (filesToProcess.length > 0) {
      e.preventDefault();
      processFiles(filesToProcess);
    }
  }, [processFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      processFiles(Array.from(files));
    }
  }, [processFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const autoContinueCountRef = useRef(0);
  const pendingAutoContinueRef = useRef(false);
  const handleSendRef = useRef<Function | null>(null);

  const handleSend = useCallback(async (overrideMsg?: string, _unused1?: any, _unused2?: any, isAutoContinue?: boolean, isRetry?: boolean) => {
    const msg = overrideMsg || input.trim();
    if ((!msg && attachments.length === 0) || isLoading) return;
    if (!overrideMsg && !isAutoContinue) setInput("");

    if (isAutoContinue) {
      autoContinueCountRef.current += 1;
      if (autoContinueCountRef.current > 3) {
        autoContinueCountRef.current = 0;
        return;
      }
    } else {
      autoContinueCountRef.current = 0;
    }

    const currentAttachments = (isRetry || isAutoContinue) ? [] : [...attachments];
    setAttachments([]);

    const attachmentDesc = currentAttachments.length > 0 ? `\n[Fichiers: ${currentAttachments.map(a => a.name).join(", ")}]` : "";

    if (!isRetry && !isAutoContinue) {
      setMessages(prev => [...prev, {
        role: "user",
        content: msg + attachmentDesc,
        attachments: currentAttachments.map(a => ({ name: a.name, type: a.type, preview: a.type.startsWith("image/") ? a.dataUrl : undefined })),
      }]);
      saveChat("user", msg + attachmentDesc, threadId);
    } else if (isAutoContinue) {
      setMessages(prev => [...prev, {
        role: "user",
        content: "⚡ Auto-continue...",
      }]);
    }
    setIsLoading(true);

    const devopsActions = "Actions GitHub disponibles: list_repos, repo_info, list_branches, delete_branch, list_commits, list_prs, create_branch, create_pr, merge_pr, get_file, update_file, delete_file, apply_patch, browse_files, search_code, list_workflows, list_workflow_runs, trigger_workflow, rerun_workflow, cancel_workflow, create_repo, get_deploy_urls, set_deploy_urls, analyze_preview.";
    const tabContext = currentTab ? `\n[CONTEXTE] L'utilisateur regarde l'onglet "${currentTab}" du dashboard DevMax.` : "";
    const now = new Date();
    const dateStr = now.toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Europe/Paris" });
    const timeStr = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
    const devopsHint = `[MAX — INGÉNIEUR LOGICIEL SENIOR] Tu es MaxAI, un ingenieur logiciel senior expert fullstack et DevOps. Tu n'es PAS Ulysse. Tu es un assistant DevOps strictement professionnel et technique.
[DATE & HEURE] Nous sommes le ${dateStr}, il est ${timeStr} (Europe/Paris).
[RÈGLES ABSOLUES]
- L'utilisateur est ANONYME. Tu ne connais PAS son nom, sa vie, ses habitudes. Tu ne l'appelles JAMAIS par un prénom.
- Tu ne mémorises AUCUNE donnée personnelle. Tu ignores totalement qui est derrière l'écran.
- Tu parles UNIQUEMENT de développement, code, DevOps, infrastructure, déploiement, architecture logicielle.
- Tu REFUSES poliment toute conversation personnelle, vie quotidienne, sport, cuisine, météo ou sujet non-technique. Réponds: "Je suis MaxAI, je ne traite que les sujets techniques et DevOps."
- Tu ne fais JAMAIS référence à Maurice, Ulysse, SUGU, restaurants, football, paris sportifs ou tout autre contexte extérieur.
- Ton ton est professionnel, concis, direct. Indicateurs ✓ ✗ uniquement.
[MÉTHODE D'INVESTIGATION — PENSE COMME UN SENIOR]
Tu CREUSES, FOUILLES et ANALYSES avant d'agir. Tu ne sautes JAMAIS à une solution sans comprendre le problème.
1. COMPRENDRE — Lis le contexte (journal, historique, code). Que s'est-il passé avant ? Quel est l'état actuel ?
2. HYPOTHÈSES — Face à un problème, liste 2-3 causes possibles. Explique ton raisonnement: "Le 502 peut venir de: (a) PM2 crashé, (b) Nginx mal config, (c) port incorrect."
3. VÉRIFIER — Diagnostique systématiquement chaque hypothèse. Communique chaque découverte: "✓ PM2 online → pas (a). Je vérifie (b)..."
4. CREUSER — Ne t'arrête JAMAIS au symptôme. Un "502" n'est pas un diagnostic. Descends à la cause racine.
5. ANALYSER — Quand un outil renvoie un résultat, EXTRAIS les infos pertinentes, identifie les anomalies.
6. EXPLIQUER — L'utilisateur doit comprendre TON raisonnement. "Je lance debug_app parce que le health check échoue mais PM2 est online — crash au démarrage probable."
[COMMUNICATION]
- Structure: contexte → diagnostic → actions → résultats → synthèse.
- Explique la CAUSE RACINE, pas le symptôme.
- Résume en fin de réponse: fait, marche, reste à faire.
- Priorise: critique d'abord, cosmétique après.
- Sois honnête: "Je ne peux pas vérifier X sans Y" plutôt que deviner.
[EXÉCUTION — PAS DE PROMESSES]
- Chaque réponse est TERMINALE. Pas de "plus tard".
- INTERDIT: "je vais lancer", "temps estimé", "prochaines actions". OBLIGATOIRE: exécuter MAINTENANT via les outils.
- Quand une action échoue, ANALYSE l'erreur et cherche une alternative — ne répète pas bêtement.
- Chaîne tes actions: diagnostic → correction → vérification → rapport.
Interface DevOps Bridge. Repo actif: ${repoFull}. Branche par defaut: main. ${devopsActions} Pour ecrire/modifier des fichiers: utilise devops_github/update_file. Tu as l'autorisation complete sur le repo.
[DB] Tu as un acces DB complet 24/7 via devmax_db (query/insert/update/delete/stats/project_summary) sur tes tables: devmax_projects, devmax_sessions, devmax_activity_log, dgm_sessions, dgm_tasks, dgm_pipeline_runs, devmax_chat_history, devmax_project_journal.
[JOURNAL — MÉMOIRE DE TRAVAIL] Apres chaque action importante, tu DOIS ajouter une entree au journal du projet via devmax_db insert dans devmax_project_journal (project_id, entry_type, title, description, files_changed). entry_type: code_edit|deploy|config|review|plan|roadmap|task_status|note|scaffold|fix|refactor.
- Utilise "roadmap" pour sauvegarder ta feuille de route complète du projet (objectifs, étapes, priorités).
- Utilise "task_status" pour marquer l'état d'une tâche (en cours, terminée, bloquée) avec ce qui reste à faire.
- Utilise "plan" pour les plans d'action avant exécution.
- AVANT de commencer un travail complexe, consulte le journal pour reprendre là où tu en étais.
[HISTORIQUE] Tous tes messages chat sont automatiquement sauvegardes dans devmax_chat_history. Tu peux les consulter via devmax_db query pour te rappeler des conversations passees et planifier. AVANT de commencer un travail complexe, consulte l'historique recent du projet.
[DEPLOY RULES] Quand tu deploies une app via devops_server/deploy, tu DOIS toujours passer caller='max'. AVANT de choisir un port, utilise devops_server action=list_apps pour voir les ports déjà utilisés. Utilise des ports dans la plage 6000+ pour tes apps. Les ports 5100-5200 sont reserves a Ulysse, les ports 5200-5300 a Iris. URL par defaut: appName.ulyssepro.org. Tu DOIS verifier qu'aucune app n'utilise deja le meme port avant de deployer.
[INGÉNIERIE COMPLÈTE — 47 ACTIONS SERVEUR via devops_server]
INFRA: status, health, list_apps, app_info, deploy, update, restart, stop, delete, cleanup_orphans, scale, exec, ssl
CLEANUP: cleanup_orphans (dryRun=true pour scanner, dryRun=false pour supprimer). Detecte les apps dont le repo GitHub n'existe plus, les dossiers vides, et les -placeholder. Apps protegees: ulysse, mdbhdev, devmax, devops, deploy-webhook, default.
ENV: env_get, env_set, env_delete, env_clone (cloner setup complet d'une app vers une autre)
DB: list_databases, backup_db, restore_db, list_backups, migrate_db (auto drizzle/prisma/knex), db_inspect (schema complet, indexes, foreign keys, slow queries, bloat, connexions)
CRON: cron_list, cron_add, cron_delete
NGINX: nginx_configs
ENGINEERING: install_packages, run_tests, analyze_deps, debug_app, refactor_check
SÉCURITÉ: security_scan (secrets+vulns+headers+SSL+dangerous patterns), backup_app (code+DB+nginx+env), rollback_app (Git reset+rebuild+health, steps=N)
PERFORMANCE: profile_app (CPU/mem/heap/TTFB/connexions/IO), perf_loadtest (N req x C concurrency), bundle_analyze (dist sizes, gzip, unused deps, source maps)
ARCHITECTURE: architecture_analyze (structure, métriques, circular deps, couplage, complexité cyclomatique, design patterns), docs_generate (auto-doc + commit DOCS.md)
GIT: git_intelligence (full_report, blame, bisect_errors, hotspots, branch_diff, cherry_pick)
API: api_test (auto-découverte endpoints + test HTTP codes/temps/tailles)
MONITORING: monitoring_setup (enable/disable/status/logs — cron 5min + auto-restart PM2)
SCAFFOLDING: scaffold_project (express-api|react-vite|fullstack|nextjs|static-html → repo complet)
SMART DEPLOY: Le systeme de deploy est INTELLIGENT — il lit automatiquement .env.example, detecte les process.env dans le code, auto-genere les secrets (JWT_SECRET, SESSION_SECRET, COOKIE_SECRET), cree la DB PostgreSQL si DATABASE_URL est requis, et lance les migrations Prisma/Drizzle. Quand tu deploies un projet existant depuis GitHub, le deploy s'occupe de TOUT. Tu n'as PAS besoin de demander les env vars a l'utilisateur — le systeme les detecte et les configure.
URL DIAGNOSTIC: url_diagnose (domain/appName → teste HTTP, Nginx, SSL, PM2 et CORRIGE auto: 502/404/503/000), url_diagnose_all (appName → teste ET corrige staging+production en une seule action)
PIPELINE: full_pipeline (7 étapes: preflight→backup→build→test→security→deploy→health check)
CYCLE: backup_app AVANT risque. architecture_analyze + security_scan + db_inspect régulièrement. full_pipeline pour le SDLC complet.
[URL AUTO-FIX] Quand tu deploies ou que l'utilisateur signale un probleme (502, 404, site inaccessible, "erreur", "ca marche pas", "down"), tu DOIS IMMÉDIATEMENT:
1. Lancer url_diagnose_all pour diagnostiquer ET corriger automatiquement (Nginx, SSL, PM2, ports, root path)
2. Si le diagnostic ne suffit pas, utilise debug_app pour voir les logs d'erreur
3. Propose une correction concrète et exécute-la toi-même
4. Re-vérifie avec url_diagnose après la correction
Tu ne DOIS JAMAIS juste dire "il faudrait configurer Nginx" sans le faire. Tu EXÉCUTES les corrections.
APRES chaque deploy, lance TOUJOURS url_diagnose_all pour verifier staging ET production.
[PROACTIVITÉ] Ne reste JAMAIS silencieux ou passif. Si une action échoue, diagnostique IMMÉDIATEMENT la cause avec les outils disponibles. L'utilisateur doit voir tes actions défiler en temps réel dans le chat — chaque outil que tu appelles s'affiche automatiquement. Plus tu utilises d'outils, plus l'utilisateur voit ton travail et se sent accompagné.${tabContext}
[PROJET ACTIF] ID: ${activeProject?.id || "aucun"}, Nom: ${activeProject?.name || "aucun"}, Repo: ${repoFull}.${projectContext ? `\n[JOURNAL RÉCENT DU PROJET]\n${projectContext}` : ""}
[MÉMOIRE CONVERSATION] ${messages.length > 0 ? `${messages.length} messages dans cette session. Derniers échanges ci-dessous — tu DOIS t'en servir pour assurer la continuité du travail. Si l'utilisateur dit "on reprend" ou "on continue", réfère-toi à ces échanges pour savoir exactement où on en était.` : "Aucun historique — nouvelle conversation."}`;
    const recentMessagesContext = messages.length > 0 ? messages.slice(-10).map(m => `[${m.role === "user" ? "USER" : "MAX"}]: ${m.content.slice(0, 300)}`).join("\n") : "";

    let messageContent = msg;
    if (currentAttachments.length > 0) {
      const fileDescs = currentAttachments.map(a => a.type.startsWith("image/") ? `[Image: ${a.name}]` : `[Fichier: ${a.name}]`).join("\n");
      messageContent = `${msg}\n\n${fileDescs}`;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const bodyPayload: any = {
        message: messageContent,
        threadId,
        originDevice: "web",
        sessionContext: "devops",
        contextHints: {
          systemHint: devopsHint + (recentMessagesContext ? `\n[DERNIERS ÉCHANGES]\n${recentMessagesContext}` : ""),
          devopsContext: `Repo: ${repoFull || "aucun"}. Branche: main. Projet: ${activeProject?.name || "aucun"} (ID: ${activeProject?.id || "N/A"}).`,
          forceTools: ["devops_github", "devops_server", "sensory_hub", "devmax_db", "dgm_manage"],
          dgmActive: true,
          dgmRepoContext: repoFull || undefined,
          devmaxProjectId: activeProject?.id || undefined,
        },
      };
      if (currentAttachments.length > 0) {
        bodyPayload.attachments = currentAttachments.map(a => ({ name: a.name, type: a.type, data: a.dataUrl }));
      }

      const token = getDevmaxToken();
      const res = await fetch("/api/v2/conversations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "x-devmax-token": token || "",
        },
        credentials: "include",
        body: JSON.stringify(bodyPayload),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error("Erreur");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";
      const toolCallsCollected: any[] = [];
      setMessages(prev => [...prev, { role: "assistant", content: "" }]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split("\n")) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === "start" && data.threadId) setThreadId(data.threadId);
                else if (data.type === "tool_status") {
                  if (data.tool) toolCallsCollected.push({ tool: data.tool, label: data.label, status: data.status });
                  if (data.status === "executing") {
                    setMessages(prev => {
                      const updated = [...prev];
                      const last = updated[updated.length - 1];
                      const activity = [...(last.toolActivity || [])];
                      activity.push({ tool: data.tool, label: data.label, status: "executing" });
                      updated[updated.length - 1] = { ...last, toolActivity: activity };
                      return updated;
                    });
                  } else if (data.status === "done" || data.status === "error") {
                    setMessages(prev => {
                      const updated = [...prev];
                      const last = updated[updated.length - 1];
                      const activity = [...(last.toolActivity || [])];
                      const idx = activity.findLastIndex(a => a.tool === data.tool && a.status === "executing");
                      if (idx >= 0) activity[idx] = { ...activity[idx], status: data.status, durationMs: data.durationMs };
                      updated[updated.length - 1] = { ...last, toolActivity: activity };
                      return updated;
                    });
                  }
                } else if (data.type === "chunk" && data.content) {
                  fullContent += data.content;
                  const captured = fullContent;
                  setMessages(prev => {
                    const updated = [...prev];
                    updated[updated.length - 1] = { ...updated[updated.length - 1], content: captured };
                    return updated;
                  });
                }
              } catch {}
            }
          }
        }
      }
      if (fullContent.length > 2) {
        saveChat("assistant", fullContent, threadId, toolCallsCollected.length > 0 ? toolCallsCollected : null);
      }
      devmaxQueryClient.invalidateQueries({ queryKey: [API] });

      const continuePatterns = [
        /je (vais|reviens|reviendrai|procède|lance)\b/i,
        /prochaines?\s+actions?\s*:/i,
        /temps\s+estim[eé]/i,
        /dans\s+\d+[\s-]*(minutes?|secondes?|min)/i,
        /je\s+(te|vous)\s+reviens/i,
        /lancement\s+en\s+cours/i,
        /je\s+commence\s+(le|la|l'|un|une)/i,
      ];
      const hasPromise = continuePatterns.some(p => p.test(fullContent));
      const hadToolCalls = toolCallsCollected.length > 0;
      if (hasPromise && !hadToolCalls && !isAutoContinue) {
        pendingAutoContinueRef.current = true;
      }
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setMessages(prev => [...prev, { role: "assistant", content: "Erreur de communication." }]);
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [input, threadId, isLoading, attachments, repoFull, saveChat]);

  handleSendRef.current = handleSend;

  useEffect(() => {
    if (!isLoading && pendingAutoContinueRef.current) {
      pendingAutoContinueRef.current = false;
      const timer = setTimeout(() => {
        handleSendRef.current?.("Continue. Exécute maintenant les actions que tu as annoncées. Utilise les outils disponibles immédiatement.", undefined, undefined, true);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isLoading]);

  useEffect(() => {
    if (auditTriggeredRef.current) return;
    const proj = activeProject as any;
    if (proj?._triggerAudit && proj?.repo_owner && proj?.repo_name) {
      auditTriggeredRef.current = true;
      delete proj._triggerAudit;
      const slug = proj.deploy_slug || (proj.repo_name || proj.name).toLowerCase().replace(/[^a-z0-9-]/g, "-");
      const auditMsg = `Nouveau projet "${proj.name}" créé avec le repo ${proj.repo_owner}/${proj.repo_name}.
URLs générées: ${slug}.ulyssepro.org (production) et ${slug}-dev.ulyssepro.org (staging).
Lance immédiatement un audit profond complet:
1. browse_files à la racine pour voir la structure complète du repo
2. Lis les fichiers clés: package.json, README.md, et les principaux fichiers de config
3. Analyse l'architecture, le tech stack, les dépendances, les scripts
4. Vérifie s'il y a un CI/CD, des tests, des workflows GitHub Actions
5. DIAGNOSTIC URLs: utilise devops_server url_diagnose_all avec appName="${slug}" pour tester ET corriger automatiquement les 2 URLs (staging + production). Corrige TOUS les problèmes détectés (502, 404, Nginx manquant, PM2 down, etc.)
6. Vérifie les deploy URLs et mets-les à jour si nécessaire
7. Propose une synthèse complète: forces, faiblesses, recommandations, prochaines actions suggérées

Sois exhaustif et structure ta réponse clairement. L'objectif est que les 2 URLs soient opérationnelles à la fin de l'audit.`;
      setTimeout(() => handleSend(auditMsg), 500);
    }
  }, [activeProject, handleSend]);

  return (
    <div className={cn("flex flex-col h-[520px] relative", isDragOver && "ring-2 ring-emerald-500/50 rounded-xl")} onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}>
      {isDragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-emerald-500/10 backdrop-blur-sm rounded-xl border-2 border-dashed border-emerald-500/50">
          <div className="flex flex-col items-center gap-2 text-emerald-400">
            <Paperclip className="w-8 h-8" />
            <span className="text-sm font-medium">Déposez vos fichiers ici</span>
          </div>
        </div>
      )}
      <input type="file" ref={fileInputRef} className="hidden" multiple onChange={handleFileSelect} />
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center">
          <Bot className="w-4 h-4 text-white" />
        </div>
        <span className="text-sm font-semibold">MaxAI</span>
        <Badge variant="outline" className="text-[10px] font-mono">Ingenieur Senior</Badge>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" className="rounded-lg" onClick={() => { setMessages([]); setThreadId(null); setAttachments([]); setProjectContext(""); }} data-testid="button-clear-devops-chat">
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>

      <ScrollArea className="flex-1 rounded-xl border bg-background/50 p-3" ref={scrollRef}>
        <div className="space-y-3">
          {messages.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm space-y-4">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center">
                <Terminal className="w-7 h-7 opacity-50" />
              </div>
              <div>
                <p className="font-medium text-zinc-200">MaxAI — Ingénieur Senior DevOps</p>
                <p className="text-xs text-zinc-500 mt-1">Exécution réelle sur {repoFull !== "aucun repo" ? repoFull : "votre repo"} + serveur Hetzner</p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 max-w-md mx-auto" data-testid="quick-commands-grid">
                {QUICK_COMMANDS.map(qc => (
                  <button key={qc.label} onClick={() => handleSend(qc.cmd)} className="flex flex-col items-center gap-1 p-2 rounded-lg bg-gray-200/50 dark:bg-zinc-800/50 hover:bg-zinc-700/50 transition-all text-center group" data-testid={`quick-cmd-${qc.label.replace(/\s/g, '-').toLowerCase()}`}>
                    <span className="text-lg">{qc.icon}</span>
                    <span className="text-[10px] text-zinc-400 group-hover:text-zinc-200 leading-tight">{qc.label}</span>
                  </button>
                ))}
              </div>

              {contextSuggestions.length > 0 && (
                <div className="space-y-1.5 mt-2">
                  <p className="text-[10px] text-zinc-600 uppercase tracking-wider">Suggestions pour l'onglet actif</p>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {contextSuggestions.map(s => (
                      <Button key={s.label} variant="outline" size="sm" className="text-[10px] rounded-xl border-emerald-500/20 hover:border-emerald-500/50 hover:bg-emerald-500/5" onClick={() => handleSend(s.cmd)} data-testid={`ctx-suggestion-${s.label.replace(/\s/g, '-').toLowerCase()}`}>
                        <Zap className="w-3 h-3 mr-1 text-emerald-400" />{s.label}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={cn("text-sm rounded-xl", msg.role === "user" ? "bg-emerald-500/10 ml-8 p-3" : "bg-muted/50 mr-4 p-3")}>
              <p className="text-[10px] text-muted-foreground mb-1 font-medium">{msg.role === "user" ? "Vous" : "MaxAI"}</p>
              {msg.attachments?.map((a, j) => (
                <div key={j} className="mb-2">
                  {a.preview ? <img src={a.preview} alt={a.name} className="max-h-32 rounded-lg" /> : <Badge variant="outline" className="text-[10px]"><Paperclip className="w-2.5 h-2.5 mr-1" />{a.name}</Badge>}
                </div>
              ))}
              {msg.toolActivity && msg.toolActivity.length > 0 && (
                <div className="mb-3 rounded-lg border border-zinc-700/50 bg-zinc-900/40 p-2.5 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400 mb-1">
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    <span>Actions MaxAI</span>
                    <span className="text-zinc-600">({msg.toolActivity.length})</span>
                  </div>
                  {msg.toolActivity.map((t, j) => (
                    <div key={j} className={`flex items-center gap-2.5 text-xs px-2 py-1.5 rounded-md transition-all ${t.status === "executing" ? "bg-amber-500/10 text-amber-300" : t.status === "done" ? "bg-emerald-500/5 text-zinc-300" : "bg-red-500/10 text-red-300"}`}>
                      {t.status === "executing" ? <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400 shrink-0" /> : t.status === "done" ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                      <span className="flex-1">{t.label || t.tool}</span>
                      {t.durationMs != null && <span className="text-[10px] text-zinc-500 tabular-nums">{(t.durationMs / 1000).toFixed(1)}s</span>}
                    </div>
                  ))}
                </div>
              )}
              <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                <MarkdownContent content={msg.content} />
              </div>
            </div>
          ))}
          {isLoading && messages[messages.length - 1]?.role === "user" && (
            <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-400" /> MaxAI reflechit...
            </div>
          )}
        </div>
      </ScrollArea>

      {attachments.length > 0 && (
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {attachments.map((a, i) => (
            <div key={i} className="relative group">
              {a.type.startsWith("image/") ? (
                <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-zinc-700 bg-zinc-800">
                  <img src={a.dataUrl} alt={a.name} className="w-full h-full object-cover" />
                  <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" data-testid={`button-remove-attachment-${i}`}><X className="w-2.5 h-2.5 text-white" /></button>
                </div>
              ) : (
                <Badge variant="secondary" className="text-[10px] gap-1">
                  <Paperclip className="w-2.5 h-2.5" />
                  {a.name.length > 20 ? a.name.slice(0, 17) + "..." : a.name}
                  <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} className="ml-1 hover:text-destructive" data-testid={`button-remove-attachment-${i}`}><X className="w-2.5 h-2.5" /></button>
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {showQuickCmds && messages.length > 0 && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mt-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-2 bg-zinc-900/50 rounded-lg border border-zinc-800" data-testid="quick-commands-inline">
              {QUICK_COMMANDS.map(qc => (
                <button key={qc.label} onClick={() => { handleSend(qc.cmd); setShowQuickCmds(false); }} className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 hover:border-emerald-500/40 active:scale-95 transition-all text-left cursor-pointer" disabled={isLoading} data-testid={`inline-cmd-${qc.label.replace(/\s/g, '-').toLowerCase()}`}>
                  <span className="text-base">{qc.icon}</span>
                  <span className="text-xs text-zinc-300 leading-tight truncate">{qc.label}</span>
                </button>
              ))}
            </div>
            {contextSuggestions.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {contextSuggestions.map(s => (
                  <button key={s.label} onClick={() => { handleSend(s.cmd); setShowQuickCmds(false); }} className="text-[10px] px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-all" disabled={isLoading}>
                    <Zap className="w-2.5 h-2.5 inline mr-0.5" />{s.label}
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <form onSubmit={e => { e.preventDefault(); handleSend(); }} className="flex items-center gap-2 mt-3">
        <Button type="button" size="icon" variant="ghost" className="rounded-xl shrink-0" onClick={() => fileInputRef.current?.click()} data-testid="button-attach-file">
          <Paperclip className="w-4 h-4" />
        </Button>
        {messages.length > 0 && (
          <Button type="button" size="icon" variant="ghost" className={cn("rounded-xl shrink-0", showQuickCmds && "bg-emerald-500/10 text-emerald-400")} onClick={() => setShowQuickCmds(p => !p)} data-testid="button-toggle-quick-cmds">
            <Zap className="w-4 h-4" />
          </Button>
        )}
        <Input value={input} onChange={e => setInput(e.target.value)} onPaste={handlePaste} placeholder={isLoading ? "MaxAI exécute..." : "Collez ou tapez ici..."} disabled={isLoading} className="flex-1 rounded-xl" data-testid="input-devops-chat" />
        <Button type="submit" size="icon" className="rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-600 hover:opacity-90 text-white border-0" disabled={(!input.trim() && attachments.length === 0) || isLoading} data-testid="button-send-devops">
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </div>
  );
}

function OverviewPanel({ repo, repoLoading }: { repo: any; repoLoading: boolean }) {
  const { activeProject } = useDevmaxAuth();
  const pid = activeProject?.id || "";

  const { data: branches } = useQuery<Branch[]>({
    queryKey: [API, "branches", pid],
    queryFn: () => devmaxFetch(`${API}/branches`, undefined, pid).then(r => r.json()).then(d => Array.isArray(d) ? d : []),
    enabled: !!pid,
  });
  const { data: commits } = useQuery<Commit[]>({
    queryKey: [API, "commits", "main", "overview", pid],
    queryFn: () => devmaxFetch(`${API}/commits?branch=main&per_page=5`, undefined, pid).then(r => r.json()).then(d => Array.isArray(d) ? d : []),
    enabled: !!pid,
  });
  const { data: pulls } = useQuery<PullRequest[]>({
    queryKey: [API, "pulls", "open", "overview", pid],
    queryFn: () => devmaxFetch(`${API}/pulls?state=open`, undefined, pid).then(r => r.json()).then(d => Array.isArray(d) ? d : []),
    enabled: !!pid,
  });
  const { data: runs } = useQuery<{ workflow_runs: WorkflowRun[] }>({
    queryKey: [API, "actions", "runs", "overview", pid],
    queryFn: () => devmaxFetch(`${API}/actions/runs`, undefined, pid).then(r => r.json()).then(d => d?.workflow_runs ? d : { workflow_runs: [] }),
    enabled: !!pid,
  });

  if (repoLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>;

  if (!activeProject?.repo_owner || !activeProject?.repo_name) {
    return (
      <Card className="border-dashed border-2">
        <CardContent className="p-8 text-center">
          <Settings className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">Configurez un repo GitHub pour ce projet</p>
          <p className="text-xs text-zinc-600 mt-1">Retournez a la liste des projets pour ajouter un repo</p>
        </CardContent>
      </Card>
    );
  }

  const lastRun = runs?.workflow_runs?.[0];
  const successRuns = runs?.workflow_runs?.filter(r => r.conclusion === "success").length || 0;
  const failedRuns = runs?.workflow_runs?.filter(r => r.conclusion === "failure").length || 0;

  const stagingUrl = activeProject?.staging_url || null;
  const productionUrl = activeProject?.production_url || null;

  return (
    <div className="space-y-4">
      {(stagingUrl || productionUrl) && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-emerald-400 via-cyan-500 to-blue-500" />
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Globe className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-semibold">URLs du projet</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {productionUrl && (
                  <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2" data-testid="url-production">
                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-xs text-gray-400">Production:</span>
                    <a href={productionUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-400 hover:text-emerald-300 truncate font-mono">{productionUrl.replace("https://", "")}</a>
                    <Globe className="w-3 h-3 text-emerald-400 flex-shrink-0 cursor-pointer" onClick={() => window.open(productionUrl, "_blank")} />
                  </div>
                )}
                {stagingUrl && (
                  <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2" data-testid="url-staging">
                    <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                    <span className="text-xs text-gray-400">Staging:</span>
                    <a href={stagingUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-amber-400 hover:text-amber-300 truncate font-mono">{stagingUrl.replace("https://", "")}</a>
                    <Globe className="w-3 h-3 text-amber-400 flex-shrink-0 cursor-pointer" onClick={() => window.open(stagingUrl, "_blank")} />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <Card className="overflow-hidden hover:shadow-lg transition-shadow">
            <div className="h-1 bg-gradient-to-r from-emerald-500 to-green-500" />
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><GitBranch className="w-4 h-4 text-emerald-400" /> Branches</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-black">{branches?.length || 0}</p>
              <p className="text-xs text-muted-foreground">branches actives</p>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="overflow-hidden hover:shadow-lg transition-shadow">
            <div className="h-1 bg-gradient-to-r from-purple-500 to-violet-500" />
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><GitPullRequest className="w-4 h-4 text-purple-400" /> Pull Requests</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-black text-purple-400">{pulls?.length || 0}</p>
              <p className="text-xs text-muted-foreground">PRs ouvertes</p>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <Card className="overflow-hidden hover:shadow-lg transition-shadow">
            <div className="h-1 bg-gradient-to-r from-cyan-500 to-blue-500" />
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Activity className="w-4 h-4 text-cyan-400" /> CI/CD</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <span className="text-emerald-400 font-bold">{successRuns}</span>
                <span className="text-red-400 font-bold">{failedRuns}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{lastRun ? `Dernier: ${timeAgo(lastRun.created_at)}` : "Aucun workflow"}</p>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="overflow-hidden hover:shadow-lg transition-shadow">
            <div className="h-1 bg-gradient-to-r from-amber-500 to-orange-500" />
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><GitCommit className="w-4 h-4 text-amber-400" /> Derniers Commits</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5">
                {commits?.slice(0, 3).map(c => (
                  <div key={c.sha} className="text-xs truncate text-muted-foreground">
                    <code className="text-amber-400">{c.sha.slice(0, 7)}</code> {c.commit.message.split("\n")[0]}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
      {repo && (
        <Card className="overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-emerald-500 via-cyan-500 to-blue-500" />
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Terminal className="w-5 h-5 text-emerald-400" />
              <div>
                <p className="text-sm font-medium">{repo.full_name}</p>
                <p className="text-xs text-muted-foreground">{repo.description || "Repository"}</p>
              </div>
              <div className="flex-1" />
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {repo.language && <Badge variant="secondary" className="text-[10px]">{repo.language}</Badge>}
                <div className="flex items-center gap-1"><Star className="w-3 h-3" />{repo.stargazers_count || 0}</div>
                <div className="flex items-center gap-1"><GitFork className="w-3 h-3" />{repo.forks_count || 0}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function EnvVarsPanel() {
  const { toast } = useToast();
  const { activeProject } = useDevmaxAuth();
  const pid = activeProject?.id || "";
  const [envFilter, setEnvFilter] = useState<string>("all");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newEnv, setNewEnv] = useState("all");
  const [isSecret, setIsSecret] = useState(false);
  const [showValues, setShowValues] = useState<Record<string, boolean>>({});

  const { data, isLoading, refetch } = useQuery({
    queryKey: [API, "env-vars", pid, envFilter],
    queryFn: () => devmaxFetch(`${API}/env-vars?environment=${envFilter}`, undefined, pid).then(r => r.json()),
    enabled: !!pid,
  });

  const addVar = useMutation({
    mutationFn: () => devmaxApiRequest("POST", `${API}/env-vars`, { key: newKey, value: newValue, environment: newEnv, isSecret }, pid),
    onSuccess: () => { toast({ title: `Variable ${newKey} ajoutée` }); setNewKey(""); setNewValue(""); refetch(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const deleteVar = useMutation({
    mutationFn: (id: string) => devmaxApiRequest("DELETE", `${API}/env-vars/${id}`, undefined, pid),
    onSuccess: () => { toast({ title: "Variable supprimée" }); refetch(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const syncVars = useMutation({
    mutationFn: (environment: string) => devmaxApiRequest("POST", `${API}/env-vars/sync`, { environment }, pid),
    onSuccess: (d: any) => toast({ title: "Synchronisé", description: d.message }),
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const vars = data?.envVars || [];

  return (
    <div className="space-y-4" data-testid="env-vars-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold flex items-center gap-2"><Key className="w-5 h-5 text-emerald-400" /> Variables d'environnement</h3>
        <div className="flex gap-2">
          {["all", "staging", "production"].map(e => (
            <Button key={e} size="sm" variant={envFilter === e ? "default" : "outline"} className="text-xs rounded-lg" onClick={() => setEnvFilter(e)} data-testid={`filter-env-${e}`}>
              {e === "all" ? "Toutes" : e === "staging" ? "Staging" : "Production"}
            </Button>
          ))}
        </div>
      </div>

      <Card className="border-dashed">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-12 gap-2">
            <Input className="col-span-2 sm:col-span-3 text-xs font-mono" placeholder="NOM_VARIABLE" value={newKey} onChange={e => setNewKey(e.target.value.toUpperCase())} data-testid="input-env-key" />
            <Input className="col-span-2 sm:col-span-4 text-xs font-mono" placeholder="valeur" type={isSecret ? "password" : "text"} value={newValue} onChange={e => setNewValue(e.target.value)} data-testid="input-env-value" />
            <select className="col-span-1 sm:col-span-2 text-xs bg-background border rounded-md px-2" value={newEnv} onChange={e => setNewEnv(e.target.value)} data-testid="select-env-scope">
              <option value="all">Toutes</option>
              <option value="staging">Staging</option>
              <option value="production">Production</option>
            </select>
            <label className="col-span-1 sm:col-span-1 flex items-center gap-1 text-xs cursor-pointer">
              <input type="checkbox" checked={isSecret} onChange={e => setIsSecret(e.target.checked)} /> <EyeOff className="w-3 h-3" />
            </label>
            <Button size="sm" className="col-span-2 sm:col-span-2 text-xs" onClick={() => addVar.mutate()} disabled={!newKey || addVar.isPending} data-testid="button-add-env">
              {addVar.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3 mr-1" />} Ajouter
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>
      ) : vars.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground"><Key className="w-8 h-8 mx-auto mb-2 opacity-50" /><p>Aucune variable d'environnement</p></CardContent></Card>
      ) : (
        <div className="space-y-1">
          {vars.map((v: any) => (
            <div key={v.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/30 hover:bg-muted/50 group" data-testid={`env-var-${v.key}`}>
              <code className="text-xs font-mono text-emerald-400 font-bold min-w-[160px]">{v.key}</code>
              <span className="text-xs text-muted-foreground">=</span>
              <code className="text-xs font-mono flex-1 truncate">
                {v.is_secret && !showValues[v.id] ? "••••••••" : v.value}
              </code>
              {v.is_secret && (
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100" onClick={() => setShowValues(s => ({ ...s, [v.id]: !s[v.id] }))}>
                  {showValues[v.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </Button>
              )}
              <Badge variant="secondary" className="text-[10px]">{v.environment}</Badge>
              {v.is_secret && <Lock className="w-3 h-3 text-amber-400" />}
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-400 opacity-0 group-hover:opacity-100" onClick={() => deleteVar.mutate(v.id)} data-testid={`delete-env-${v.key}`}>
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="outline" className="text-xs" onClick={() => syncVars.mutate("staging")} disabled={syncVars.isPending} data-testid="button-sync-staging">
          <RefreshCw className={cn("w-3 h-3 mr-1", syncVars.isPending && "animate-spin")} /> Sync Staging
        </Button>
        <Button size="sm" variant="outline" className="text-xs" onClick={() => syncVars.mutate("production")} disabled={syncVars.isPending} data-testid="button-sync-production">
          <RefreshCw className={cn("w-3 h-3 mr-1", syncVars.isPending && "animate-spin")} /> Sync Production
        </Button>
      </div>
    </div>
  );
}

function NotificationsPanel() {
  const { toast } = useToast();
  const { activeProject } = useDevmaxAuth();
  const pid = activeProject?.id || "";

  const { data, isLoading, refetch } = useQuery({
    queryKey: [API, "notifications", pid],
    queryFn: () => devmaxFetch(`${API}/notifications`, undefined, pid).then(r => r.json()),
    enabled: !!pid,
    refetchInterval: 30000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => devmaxApiRequest("POST", `${API}/notifications/${id}/read`, undefined, pid),
    onSuccess: () => refetch(),
  });

  const markAllRead = useMutation({
    mutationFn: () => devmaxApiRequest("POST", `${API}/notifications/read-all`, undefined, pid),
    onSuccess: () => { toast({ title: "Toutes les notifications lues" }); refetch(); },
  });

  const notifications = data?.notifications || [];
  const unread = data?.unread || 0;

  const typeIcon = (type: string) => {
    if (type === "deploy_success") return <CheckCircle className="w-4 h-4 text-emerald-400" />;
    if (type === "deploy_failed") return <XCircle className="w-4 h-4 text-red-400" />;
    if (type === "ssl_expiry") return <Shield className="w-4 h-4 text-amber-400" />;
    if (type === "downtime") return <WifiOff className="w-4 h-4 text-red-400" />;
    if (type === "custom_domain") return <Globe className="w-4 h-4 text-blue-400" />;
    return <Bell className="w-4 h-4 text-muted-foreground" />;
  };

  return (
    <div className="space-y-4" data-testid="notifications-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <Bell className="w-5 h-5 text-emerald-400" /> Notifications
          {unread > 0 && <Badge className="bg-red-500 text-white text-[10px] rounded-full px-1.5">{unread}</Badge>}
        </h3>
        {unread > 0 && (
          <Button size="sm" variant="outline" className="text-xs" onClick={() => markAllRead.mutate()} data-testid="button-mark-all-read">
            <CheckCircle2 className="w-3 h-3 mr-1" /> Tout marquer lu
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>
      ) : notifications.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground"><BellRing className="w-8 h-8 mx-auto mb-2 opacity-50" /><p>Aucune notification</p></CardContent></Card>
      ) : (
        <ScrollArea className="h-[500px]">
          <div className="space-y-2">
            {notifications.map((n: any) => (
              <Card key={n.id} className={cn("cursor-pointer transition-colors", !n.read_at && "border-emerald-500/30 bg-emerald-500/5")} onClick={() => !n.read_at && markRead.mutate(n.id)} data-testid={`notification-${n.id}`}>
                <CardContent className="p-3 flex items-start gap-3">
                  {typeIcon(n.type)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{n.title}</p>
                      {!n.read_at && <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">{n.created_at ? timeAgo(n.created_at) : ""}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function CustomDomainsPanel() {
  const { toast } = useToast();
  const { activeProject } = useDevmaxAuth();
  const pid = activeProject?.id || "";
  const [newDomain, setNewDomain] = useState("");
  const [domainEnv, setDomainEnv] = useState("production");

  const { data: dnsData, isLoading: dnsLoading, refetch: refetchDns } = useQuery({
    queryKey: [API, "dns-status", pid],
    queryFn: () => devmaxFetch(`${API}/dns-status`, undefined, pid).then(r => r.json()),
    enabled: !!pid,
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: [API, "custom-domains", pid],
    queryFn: () => devmaxFetch(`${API}/custom-domains`, undefined, pid).then(r => r.json()),
    enabled: !!pid,
  });

  const setupDns = useMutation({
    mutationFn: () => devmaxApiRequest("POST", `${API}/dns-setup`, {}, pid),
    onSuccess: () => { toast({ title: "DNS Cloudflare configuré ✓" }); refetchDns(); },
    onError: (e: any) => toast({ title: "Erreur DNS", description: e.message, variant: "destructive" }),
  });

  const toggleProxy = useMutation({
    mutationFn: (params: { environment: string; proxied: boolean }) => devmaxApiRequest("POST", `${API}/dns-toggle-proxy`, params, pid),
    onSuccess: () => { toast({ title: "Proxy Cloudflare mis à jour ✓" }); refetchDns(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const addDomain = useMutation({
    mutationFn: () => devmaxApiRequest("POST", `${API}/custom-domain`, { domain: newDomain, environment: domainEnv }, pid),
    onSuccess: () => { toast({ title: `Domaine ${newDomain} ajouté` }); setNewDomain(""); refetch(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const deleteDomain = useMutation({
    mutationFn: (id: string) => devmaxApiRequest("DELETE", `${API}/custom-domain/${id}`, undefined, pid),
    onSuccess: () => { toast({ title: "Domaine supprimé" }); refetch(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const domains = data?.domains || [];

  const DnsEnvCard = ({ label, env, data: envData, color }: { label: string; env: "staging" | "production"; data: any; color: string }) => (
    <Card className={cn("border", envData?.exists ? `border-${color}-500/30` : "border-zinc-700")} data-testid={`dns-${env}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={cn("w-2 h-2 rounded-full", envData?.exists ? `bg-${color}-400` : "bg-zinc-600")} />
            <span className="text-sm font-semibold">{label}</span>
          </div>
          <Badge className={cn("text-[10px]", envData?.exists ? `bg-${color}-500/20 text-${color}-400` : "bg-zinc-700 text-zinc-400")}>
            {envData?.exists ? "Actif" : "Non configuré"}
          </Badge>
        </div>
        <div className="font-mono text-xs text-zinc-300">{envData?.domain || "—"}</div>
        {envData?.exists && (
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <Badge className="text-[10px] bg-blue-500/15 text-blue-400">
                IP: {envData.ip || "—"}
              </Badge>
              <Badge className={cn("text-[10px]", envData.proxied ? "bg-orange-500/15 text-orange-400" : "bg-zinc-700 text-zinc-400")}>
                {envData.proxied ? "Proxy ON" : "DNS Only"}
              </Badge>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="text-xs h-7 px-2"
              onClick={() => toggleProxy.mutate({ environment: env, proxied: !envData.proxied })}
              disabled={toggleProxy.isPending}
              data-testid={`toggle-proxy-${env}`}
            >
              {envData.proxied ? "Désactiver proxy" : "Activer proxy"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6" data-testid="custom-domains-panel">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Cloud className="w-5 h-5 text-orange-400" /> DNS Cloudflare
          </h3>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => refetchDns()} data-testid="button-refresh-dns">
              <RefreshCw className="w-3 h-3 mr-1" /> Rafraîchir
            </Button>
            <Button
              size="sm"
              onClick={() => setupDns.mutate()}
              disabled={setupDns.isPending}
              className="bg-orange-500 hover:bg-orange-600 text-white"
              data-testid="button-setup-dns"
            >
              {setupDns.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Zap className="w-3 h-3 mr-1" />}
              Configurer DNS
            </Button>
          </div>
        </div>

        {!dnsData?.configured && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="p-3 flex items-center gap-2 text-amber-400 text-xs">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              Cloudflare non configuré. Ajoutez CLOUDFLARE_API_TOKEN et CLOUDFLARE_ZONE_ID dans les variables d'environnement.
            </CardContent>
          </Card>
        )}

        {dnsLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-orange-400" /></div>
        ) : dnsData ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <DnsEnvCard label="Staging" env="staging" data={dnsData.staging} color="cyan" />
            <DnsEnvCard label="Production" env="production" data={dnsData.production} color="emerald" />
          </div>
        ) : null}

        <p className="text-[10px] text-muted-foreground">
          Format: <code className="text-cyan-400">slug.dev.ulyssepro.org</code> (staging) / <code className="text-emerald-400">slug.ulyssepro.org</code> (production)
        </p>
      </div>

      <div className="border-t border-zinc-800 pt-4 space-y-4">
        <h3 className="text-lg font-bold flex items-center gap-2"><Globe className="w-5 h-5 text-emerald-400" /> Domaines personnalisés</h3>

        <Card className="border-dashed">
          <CardContent className="p-4">
            <div className="flex gap-2">
              <Input className="flex-1 text-xs font-mono" placeholder="app.mondomaine.com" value={newDomain} onChange={e => setNewDomain(e.target.value.toLowerCase())} data-testid="input-domain" />
              <select className="text-xs bg-background border rounded-md px-2" value={domainEnv} onChange={e => setDomainEnv(e.target.value)} data-testid="select-domain-env">
                <option value="production">Production</option>
                <option value="staging">Staging</option>
              </select>
              <Button size="sm" onClick={() => addDomain.mutate()} disabled={!newDomain || addDomain.isPending} data-testid="button-add-domain">
                {addDomain.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />} Ajouter
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">Pointez votre DNS (CNAME ou A record) vers 65.21.209.102. Le certificat SSL sera généré automatiquement.</p>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-emerald-400" /></div>
        ) : domains.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-muted-foreground"><Globe className="w-6 h-6 mx-auto mb-2 opacity-50" /><p className="text-sm">Aucun domaine personnalisé</p></CardContent></Card>
        ) : (
          <div className="space-y-2">
            {domains.map((d: any) => (
              <Card key={d.id} data-testid={`domain-${d.domain}`}>
                <CardContent className="p-3 flex items-center gap-3">
                  <Globe className="w-4 h-4 text-blue-400" />
                  <div className="flex-1">
                    <a href={`https://${d.domain}`} target="_blank" rel="noopener noreferrer" className="text-sm font-mono text-blue-400 hover:underline">{d.domain}</a>
                    <div className="flex gap-2 mt-1">
                      <Badge variant="secondary" className="text-[10px]">{d.environment}</Badge>
                      <Badge className={cn("text-[10px]", d.dns_status === "verified" ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400")}>
                        DNS: {d.dns_status}
                      </Badge>
                      <Badge className={cn("text-[10px]", d.ssl_status === "active" ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400")}>
                        <Shield className="w-2.5 h-2.5 mr-0.5" /> SSL: {d.ssl_status}
                      </Badge>
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" className="text-red-400" onClick={() => { if (window.confirm(`Supprimer le domaine ${d.domain} ?`)) deleteDomain.mutate(d.id); }} data-testid={`delete-domain-${d.domain}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LogsPanel() {
  const { activeProject } = useDevmaxAuth();
  const pid = activeProject?.id || "";
  const [logEnv, setLogEnv] = useState("staging");
  const [logSearch, setLogSearch] = useState("");
  const [logLevel, setLogLevel] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: [API, "logs", pid, logEnv, logSearch, logLevel],
    queryFn: () => devmaxFetch(`${API}/logs?environment=${logEnv}&search=${encodeURIComponent(logSearch)}&level=${logLevel}&limit=200`, undefined, pid).then(r => r.json()),
    enabled: !!pid,
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [data]);

  const lines = data?.liveLogs || [];

  const lineColor = (line: string) => {
    if (/error|ERR|FATAL/i.test(line)) return "text-red-400";
    if (/warn|WARN/i.test(line)) return "text-amber-400";
    if (/info|INFO/i.test(line)) return "text-blue-300";
    return "text-zinc-400";
  };

  return (
    <div className="space-y-4" data-testid="logs-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold flex items-center gap-2"><ScrollText className="w-5 h-5 text-emerald-400" /> Logs {data?.pm2Name && <code className="text-xs font-mono text-muted-foreground">({data.pm2Name})</code>}</h3>
        <Button size="sm" variant="outline" onClick={() => refetch()} data-testid="button-refresh-logs">
          <RefreshCw className="w-3 h-3 mr-1" /> Rafraîchir
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {["staging", "production"].map(e => (
          <Button key={e} size="sm" variant={logEnv === e ? "default" : "outline"} className="text-xs" onClick={() => setLogEnv(e)} data-testid={`logs-env-${e}`}>
            {e === "staging" ? "Staging" : "Production"}
          </Button>
        ))}
        <div className="flex-1" />
        <Input className="w-48 text-xs" placeholder="Rechercher..." value={logSearch} onChange={e => setLogSearch(e.target.value)} data-testid="input-log-search" />
        <select className="text-xs bg-background border rounded-md px-2" value={logLevel} onChange={e => setLogLevel(e.target.value)} data-testid="select-log-level">
          <option value="">Tous niveaux</option>
          <option value="error">Erreurs</option>
          <option value="warn">Warnings</option>
        </select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>
      ) : (
        <Card className="bg-zinc-950 border-zinc-800">
          <div ref={scrollRef} className="p-3 h-[500px] overflow-y-auto font-mono text-[11px] space-y-px">
            {lines.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">Aucun log disponible</p>
            ) : (
              lines.map((line: string, i: number) => (
                <div key={i} className={cn("py-0.5 hover:bg-zinc-900/50 px-1 rounded", lineColor(line))} data-testid={`log-line-${i}`}>
                  <span className="text-zinc-600 mr-2 select-none">{String(i + 1).padStart(4, " ")}</span>
                  {line}
                </div>
              ))
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function MetricsPanel() {
  const { activeProject } = useDevmaxAuth();
  const pid = activeProject?.id || "";
  const [hours, setHours] = useState(24);

  const { data, isLoading, refetch } = useQuery({
    queryKey: [API, "metrics", pid, hours],
    queryFn: () => devmaxFetch(`${API}/metrics?hours=${hours}`, undefined, pid).then(r => r.json()),
    enabled: !!pid,
    refetchInterval: 30000,
  });

  const live = data?.live || [];
  const metrics = data?.metrics || [];

  const formatUptime = (seconds: number) => {
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    return `${Math.floor(seconds / 86400)}j ${Math.floor((seconds % 86400) / 3600)}h`;
  };

  return (
    <div className="space-y-4" data-testid="metrics-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold flex items-center gap-2"><BarChart3 className="w-5 h-5 text-emerald-400" /> Métriques</h3>
        <div className="flex gap-2">
          {[1, 6, 24, 72, 168].map(h => (
            <Button key={h} size="sm" variant={hours === h ? "default" : "outline"} className="text-xs" onClick={() => setHours(h)} data-testid={`metrics-hours-${h}`}>
              {h < 24 ? `${h}h` : `${h / 24}j`}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={() => refetch()} data-testid="button-refresh-metrics"><RefreshCw className="w-3 h-3" /></Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>
      ) : (
        <>
          {live.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {live.map((proc: any) => (
                <Card key={proc.name} className={cn("border", proc.status === "online" ? "border-emerald-500/20" : "border-red-500/20")} data-testid={`live-metric-${proc.name}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className={cn("w-2 h-2 rounded-full", proc.status === "online" ? "bg-emerald-400" : "bg-red-400")} />
                      <span className="text-sm font-mono font-bold">{proc.name}</span>
                      <Badge className={cn("text-[10px]", proc.status === "online" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400")}>
                        {proc.status}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="text-center">
                        <Cpu className="w-4 h-4 mx-auto text-blue-400 mb-1" />
                        <p className="text-lg font-bold">{proc.cpu}%</p>
                        <p className="text-[10px] text-muted-foreground">CPU</p>
                      </div>
                      <div className="text-center">
                        <HardDrive className="w-4 h-4 mx-auto text-purple-400 mb-1" />
                        <p className="text-lg font-bold">{proc.memory}<span className="text-xs">MB</span></p>
                        <p className="text-[10px] text-muted-foreground">RAM</p>
                      </div>
                      <div className="text-center">
                        <Clock className="w-4 h-4 mx-auto text-emerald-400 mb-1" />
                        <p className="text-sm font-bold">{formatUptime(proc.uptime)}</p>
                        <p className="text-[10px] text-muted-foreground">Uptime</p>
                      </div>
                      <div className="text-center">
                        <RefreshCw className="w-4 h-4 mx-auto text-amber-400 mb-1" />
                        <p className="text-lg font-bold">{proc.restarts}</p>
                        <p className="text-[10px] text-muted-foreground">Restarts</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {metrics.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Historique ({metrics.length} points)</CardTitle></CardHeader>
              <CardContent className="p-4">
                <div className="h-48 flex items-end gap-px">
                  {metrics.slice(-60).map((m: any, i: number) => {
                    const cpuH = Math.max(2, (m.cpu_percent / 100) * 180);
                    const memH = Math.max(2, Math.min(m.memory_mb / 512, 1) * 180);
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-px justify-end" title={`CPU: ${m.cpu_percent}% | RAM: ${m.memory_mb}MB | ${m.environment}`}>
                        <div className="w-full bg-blue-500/60 rounded-t-sm" style={{ height: cpuH }} />
                        <div className="w-full bg-purple-500/60 rounded-t-sm" style={{ height: memH }} />
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-4 mt-2 justify-center text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><div className="w-2 h-2 rounded bg-blue-500/60" /> CPU</span>
                  <span className="flex items-center gap-1"><div className="w-2 h-2 rounded bg-purple-500/60" /> RAM</span>
                </div>
              </CardContent>
            </Card>
          )}

          {live.length === 0 && metrics.length === 0 && (
            <Card><CardContent className="p-8 text-center text-muted-foreground"><Gauge className="w-8 h-8 mx-auto mb-2 opacity-50" /><p>Aucune métrique disponible. Déployez d'abord votre projet.</p></CardContent></Card>
          )}
        </>
      )}
    </div>
  );
}

function PlanBillingPanel() {
  const { toast } = useToast();
  const [billingTab, setBillingTab] = useState<"overview" | "invoices">("overview");
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "yearly">("monthly");
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  const { data: billingStatus, isLoading } = useQuery({
    queryKey: [API, "billing", "status"],
    queryFn: () => devmaxFetch(`${API}/billing/status`).then(r => r.json()),
  });

  const { data, isLoading: planLoading } = useQuery({
    queryKey: [API, "plan"],
    queryFn: () => devmaxFetch(`${API}/plan`).then(r => r.json()),
  });

  const { data: invoiceData, isLoading: invoicesLoading } = useQuery({
    queryKey: [API, "billing", "invoices"],
    queryFn: () => devmaxFetch(`${API}/billing/invoices`).then(r => r.json()),
    enabled: billingTab === "invoices",
  });

  const handleCheckout = async (plan: string) => {
    setCheckoutLoading(plan);
    try {
      const res = await devmaxApiRequest("POST", `${API}/billing/checkout`, { plan, billingPeriod });
      if (res.url) {
        window.open(res.url, "_blank");
        toast({ title: "Redirection vers Stripe", description: "Complétez votre paiement dans l'onglet ouvert." });
      }
    } catch (error: any) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
    } finally {
      setCheckoutLoading(null);
    }
  };

  const handlePortal = async () => {
    setPortalLoading(true);
    try {
      const res = await devmaxApiRequest("POST", `${API}/billing/portal`);
      if (res.url) window.open(res.url, "_blank");
    } catch (error: any) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
    } finally {
      setPortalLoading(false);
    }
  };

  if (isLoading || planLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>;

  const plan = data?.plan || billingStatus?.plan || "free";
  const usage = data?.usage || {};
  const isOwner = data?.isOwner || billingStatus?.isOwner;

  const planConfig: Record<string, { label: string; color: string; bg: string; border: string; projects: number; deploys: number; users: number; price: { monthly: number; yearly: number } }> = {
    free: { label: "Free", color: "text-zinc-400", bg: "from-zinc-500/10 to-zinc-600/5", border: "border-zinc-500/20", projects: 3, deploys: 10, users: 2, price: { monthly: 0, yearly: 0 } },
    starter: { label: "Starter", color: "text-blue-400", bg: "from-blue-500/10 to-blue-600/5", border: "border-blue-500/30", projects: 10, deploys: 50, users: 5, price: { monthly: 19, yearly: 190 } },
    pro: { label: "Pro", color: "text-purple-400", bg: "from-purple-500/10 to-purple-600/5", border: "border-purple-500/30", projects: 50, deploys: 500, users: 20, price: { monthly: 49, yearly: 490 } },
    enterprise: { label: "Enterprise", color: "text-emerald-400", bg: "from-emerald-500/10 to-emerald-600/5", border: "border-emerald-500/30", projects: 9999, deploys: 9999, users: 9999, price: { monthly: 0, yearly: 0 } },
    owner: { label: "Owner", color: "text-amber-400", bg: "from-amber-500/10 to-amber-600/5", border: "border-amber-500/30", projects: 9999, deploys: 9999, users: 9999, price: { monthly: 0, yearly: 0 } },
  };

  const cfg = planConfig[plan] || planConfig.free;

  const UsageBar = ({ label, used, max, icon }: { label: string; used: number; max: number; icon: any }) => {
    const pct = max >= 9999 ? 5 : Math.min((used / max) * 100, 100);
    return (
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="flex items-center gap-1 text-muted-foreground">{icon} {label}</span>
          <span className="font-mono">{used} / {max >= 9999 ? "∞" : max}</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div className={cn("h-full rounded-full transition-all", pct > 80 ? "bg-red-500" : pct > 60 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  };

  const billingStatusBadge = billingStatus?.billingStatus || data?.billingStatus;
  const statusColor = billingStatusBadge === "active" ? "bg-emerald-500/20 text-emerald-400" :
    billingStatusBadge === "past_due" ? "bg-red-500/20 text-red-400" :
    billingStatusBadge === "trialing" ? "bg-blue-500/20 text-blue-400" : "bg-zinc-500/20 text-zinc-400";

  return (
    <div className="space-y-4" data-testid="plan-billing-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold flex items-center gap-2"><CreditCard className="w-5 h-5 text-emerald-400" /> Plan & Facturation</h3>
        <div className="flex gap-1 bg-muted rounded-lg p-0.5">
          <button onClick={() => setBillingTab("overview")} className={cn("px-3 py-1 text-xs rounded-md transition-all", billingTab === "overview" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground")} data-testid="tab-billing-overview">Vue d'ensemble</button>
          <button onClick={() => setBillingTab("invoices")} className={cn("px-3 py-1 text-xs rounded-md transition-all", billingTab === "invoices" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground")} data-testid="tab-billing-invoices">Factures</button>
        </div>
      </div>

      {billingTab === "overview" && (
        <>
          <Card className={cn("bg-gradient-to-br", cfg.bg)}>
            <CardContent className="p-6">
              <div className="flex items-center gap-4 mb-6">
                <div className={cn("w-14 h-14 rounded-xl bg-gradient-to-br flex items-center justify-center", cfg.bg)}>
                  <Package className={cn("w-7 h-7", cfg.color)} />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-muted-foreground">Plan actuel</p>
                  <p className={cn("text-2xl font-black", cfg.color)}>{cfg.label}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {billingStatusBadge && (
                    <Badge className={cn("text-xs", statusColor)}>{billingStatusBadge === "active" ? "Actif" : billingStatusBadge === "past_due" ? "Impayé" : billingStatusBadge === "trialing" ? "Essai" : billingStatusBadge}</Badge>
                  )}
                  {cfg.price.monthly > 0 && (
                    <span className="text-xs text-muted-foreground">{cfg.price.monthly}€/mois</span>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <UsageBar label="Projets" used={usage.projects || 0} max={cfg.projects} icon={<Folder className="w-3 h-3" />} />
                <UsageBar label="Déploiements/mois" used={usage.deploysThisMonth || 0} max={cfg.deploys} icon={<Rocket className="w-3 h-3" />} />
                <UsageBar label="Utilisateurs" used={usage.users || 0} max={cfg.users} icon={<Settings className="w-3 h-3" />} />
              </div>

              {!isOwner && plan !== "free" && (
                <div className="mt-4 pt-4 border-t border-border/50 flex gap-2">
                  <Button size="sm" variant="outline" onClick={handlePortal} disabled={portalLoading} data-testid="button-manage-subscription">
                    {portalLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Settings className="w-3 h-3 mr-1" />}
                    Gérer l'abonnement
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {!isOwner && (plan === "free" || plan === "starter") && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Changer de plan</p>
                <div className="flex items-center gap-2 bg-muted rounded-lg p-0.5">
                  <button onClick={() => setBillingPeriod("monthly")} className={cn("px-3 py-1 text-xs rounded-md transition-all", billingPeriod === "monthly" ? "bg-background shadow text-foreground" : "text-muted-foreground")} data-testid="toggle-monthly">Mensuel</button>
                  <button onClick={() => setBillingPeriod("yearly")} className={cn("px-3 py-1 text-xs rounded-md transition-all", billingPeriod === "yearly" ? "bg-background shadow text-foreground" : "text-muted-foreground")} data-testid="toggle-yearly">
                    Annuel <span className="text-emerald-400 font-medium">-17%</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {plan === "free" && (
                  <Card className={cn("border-blue-500/30 hover:border-blue-500/60 transition-all cursor-pointer group")} data-testid="card-plan-starter">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-bold text-blue-400">Starter</h4>
                        <div className="text-right">
                          <span className="text-xl font-black text-blue-400">{billingPeriod === "monthly" ? "19€" : "190€"}</span>
                          <span className="text-xs text-muted-foreground">/{billingPeriod === "monthly" ? "mois" : "an"}</span>
                        </div>
                      </div>
                      <ul className="text-xs text-muted-foreground space-y-1 mb-3">
                        <li className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-blue-400" /> 10 projets</li>
                        <li className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-blue-400" /> 50 déploiements/mois</li>
                        <li className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-blue-400" /> Domaines personnalisés</li>
                        <li className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-blue-400" /> Support email</li>
                      </ul>
                      <Button size="sm" className="w-full bg-blue-600 hover:bg-blue-700" onClick={() => handleCheckout("starter")} disabled={!!checkoutLoading} data-testid="button-upgrade-starter">
                        {checkoutLoading === "starter" ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Zap className="w-3 h-3 mr-1" />}
                        Passer à Starter
                      </Button>
                    </CardContent>
                  </Card>
                )}

                <Card className={cn("border-purple-500/30 hover:border-purple-500/60 transition-all cursor-pointer group", plan === "free" ? "" : "col-span-full max-w-sm")} data-testid="card-plan-pro">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-purple-400">Pro</h4>
                        <Badge className="bg-purple-500/20 text-purple-400 text-[10px]">Populaire</Badge>
                      </div>
                      <div className="text-right">
                        <span className="text-xl font-black text-purple-400">{billingPeriod === "monthly" ? "49€" : "490€"}</span>
                        <span className="text-xs text-muted-foreground">/{billingPeriod === "monthly" ? "mois" : "an"}</span>
                      </div>
                    </div>
                    <ul className="text-xs text-muted-foreground space-y-1 mb-3">
                      <li className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-purple-400" /> 50 projets</li>
                      <li className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-purple-400" /> 500 déploiements/mois</li>
                      <li className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-purple-400" /> CI/CD complet + DGM IA</li>
                      <li className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-purple-400" /> Monitoring avancé</li>
                      <li className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-purple-400" /> Support prioritaire</li>
                    </ul>
                    <Button size="sm" className="w-full bg-purple-600 hover:bg-purple-700" onClick={() => handleCheckout("pro")} disabled={!!checkoutLoading} data-testid="button-upgrade-pro">
                      {checkoutLoading === "pro" ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Zap className="w-3 h-3 mr-1" />}
                      Passer à Pro
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </>
      )}

      {billingTab === "invoices" && (
        <Card>
          <CardContent className="p-4">
            {invoicesLoading ? (
              <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-emerald-400" /></div>
            ) : !invoiceData?.invoices?.length ? (
              <div className="text-center py-6">
                <ScrollText className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">Aucune facture pour le moment</p>
              </div>
            ) : (
              <div className="space-y-2">
                {invoiceData.invoices.map((inv: any) => (
                  <div key={inv.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors" data-testid={`invoice-${inv.id}`}>
                    <div className="flex items-center gap-3">
                      <ScrollText className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{inv.number || inv.id}</p>
                        <p className="text-xs text-muted-foreground">{new Date((inv.created || inv.date) * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge className={cn("text-xs", inv.status === "paid" ? "bg-emerald-500/20 text-emerald-400" : inv.status === "open" ? "bg-amber-500/20 text-amber-400" : "bg-red-500/20 text-red-400")}>
                        {inv.status === "paid" ? "Payée" : inv.status === "open" ? "En attente" : inv.status}
                      </Badge>
                      <span className="text-sm font-mono font-medium">{((inv.amount_paid || inv.total || 0) / 100).toFixed(2)}€</span>
                      {inv.invoice_pdf && (
                        <a href={inv.invoice_pdf} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:text-blue-300" data-testid={`download-invoice-${inv.id}`}>
                          PDF
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!isOwner && plan !== "free" && (
              <div className="mt-4 pt-3 border-t border-border/50">
                <Button size="sm" variant="outline" onClick={handlePortal} disabled={portalLoading} className="w-full" data-testid="button-billing-portal">
                  {portalLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <ExternalLink className="w-3 h-3 mr-1" />}
                  Portail de facturation Stripe
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MonComptePanel() {
  const { toast } = useToast();
  const { currentUser } = useDevmaxAuth();
  const [accountTab, setAccountTab] = useState<"profile" | "security" | "sessions">("profile");

  const { data: profile, isLoading, refetch } = useQuery({
    queryKey: ["devmax", "me"],
    queryFn: () => devmaxFetch(`${AUTH_API}/me`).then(r => r.json()),
  });

  const [formData, setFormData] = useState<Record<string, string>>({});

  useEffect(() => {
    if (profile) {
      setFormData({
        firstName: profile.firstName || "",
        lastName: profile.lastName || "",
        displayName: profile.displayName || "",
        email: profile.email || "",
        phone: profile.phone || "",
        bio: profile.bio || "",
        timezone: profile.timezone || "Europe/Paris",
        githubUsername: profile.githubUsername || "",
        avatarUrl: profile.avatarUrl || "",
        sshPublicKey: profile.sshPublicKey || "",
      });
    }
  }, [profile]);

  const updateProfile = useMutation({
    mutationFn: () => devmaxApiRequest("PUT", `${AUTH_API}/me`, formData),
    onSuccess: () => { toast({ title: "Profil mis à jour" }); refetch(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const changePin = useMutation({
    mutationFn: () => {
      if (newPin !== confirmPin) throw new Error("Les PINs ne correspondent pas");
      return devmaxApiRequest("PUT", `${AUTH_API}/me/pin`, { currentPin: currentPin || undefined, newPin });
    },
    onSuccess: () => { toast({ title: "PIN modifié" }); setCurrentPin(""); setNewPin(""); setConfirmPin(""); refetch(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const changePassword = useMutation({
    mutationFn: () => {
      if (newPassword !== confirmPassword) throw new Error("Les mots de passe ne correspondent pas");
      return devmaxApiRequest("PUT", `${AUTH_API}/me/password`, { currentPassword: currentPassword || undefined, newPassword });
    },
    onSuccess: () => { toast({ title: "Mot de passe modifié" }); setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); refetch(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const [newLoginId, setNewLoginId] = useState("");
  const changeLoginId = useMutation({
    mutationFn: () => devmaxApiRequest("PUT", `${AUTH_API}/me/login-id`, { loginId: newLoginId }),
    onSuccess: () => { toast({ title: "Login ID mis à jour" }); setNewLoginId(""); refetch(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const revokeSession = useMutation({
    mutationFn: (sid: string) => devmaxApiRequest("DELETE", `${AUTH_API}/me/sessions/${sid}`),
    onSuccess: () => { toast({ title: "Session révoquée" }); refetch(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>;
  }

  return (
    <div className="space-y-4" data-testid="mon-compte-panel">
      <div className="flex items-center gap-4 mb-4">
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center text-2xl font-bold text-emerald-400" data-testid="account-avatar">
          {profile?.avatarUrl ? (
            <img src={profile.avatarUrl} alt="Avatar" className="w-14 h-14 rounded-xl object-cover" />
          ) : (
            (profile?.firstName?.[0] || profile?.username?.[0] || "U").toUpperCase()
          )}
        </div>
        <div>
          <h2 className="text-lg font-bold text-white" data-testid="text-account-name">{profile?.displayName || profile?.username}</h2>
          <p className="text-sm text-zinc-400">{profile?.email || "Pas d'email"} · {profile?.role || "user"}</p>
          <div className="flex gap-2 mt-1">
            <Badge variant="secondary" className="text-[10px]">{profile?.projectCount || 0} projets</Badge>
            <Badge variant="secondary" className="text-[10px]">{profile?.activeSessions || 0} sessions</Badge>
            {profile?.hasPin && <Badge className="text-[10px] bg-emerald-500/20 text-emerald-400">PIN actif</Badge>}
            {profile?.hasPassword && <Badge className="text-[10px] bg-blue-500/20 text-blue-400">Mot de passe actif</Badge>}
          </div>
        </div>
      </div>

      <div className="flex gap-2 p-1 bg-zinc-900/50 rounded-lg" data-testid="account-sub-tabs">
        {(["profile", "security", "sessions"] as const).map(tab => (
          <button key={tab} onClick={() => setAccountTab(tab)} className={cn("px-3 py-1.5 rounded-md text-xs font-medium transition-all", accountTab === tab ? "bg-emerald-500/20 text-emerald-400" : "text-zinc-500 hover:text-zinc-300")} data-testid={`button-account-tab-${tab}`}>
            {tab === "profile" ? "Profil" : tab === "security" ? "Sécurité" : "Sessions"}
          </button>
        ))}
      </div>

      {accountTab === "profile" && (
        <Card className="bg-zinc-900/50 border-zinc-800" data-testid="account-profile-section">
          <CardHeader className="pb-3"><CardTitle className="text-sm text-zinc-300">Informations personnelles</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Prénom</label>
                <Input value={formData.firstName || ""} onChange={e => setFormData(p => ({ ...p, firstName: e.target.value }))} className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8" data-testid="input-first-name" />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Nom</label>
                <Input value={formData.lastName || ""} onChange={e => setFormData(p => ({ ...p, lastName: e.target.value }))} className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8" data-testid="input-last-name" />
              </div>
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Nom d'affichage</label>
              <Input value={formData.displayName || ""} onChange={e => setFormData(p => ({ ...p, displayName: e.target.value }))} className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8" data-testid="input-display-name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Email</label>
                <Input type="email" value={formData.email || ""} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8" data-testid="input-email" />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Téléphone</label>
                <Input value={formData.phone || ""} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8" data-testid="input-phone" />
              </div>
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Bio</label>
              <Textarea value={formData.bio || ""} onChange={e => setFormData(p => ({ ...p, bio: e.target.value }))} className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm min-h-[60px]" data-testid="input-bio" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">GitHub Username</label>
                <Input value={formData.githubUsername || ""} onChange={e => setFormData(p => ({ ...p, githubUsername: e.target.value }))} className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8" data-testid="input-github-username" />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Fuseau horaire</label>
                <Input value={formData.timezone || ""} onChange={e => setFormData(p => ({ ...p, timezone: e.target.value }))} className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8" data-testid="input-timezone" />
              </div>
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">URL Avatar</label>
              <Input value={formData.avatarUrl || ""} onChange={e => setFormData(p => ({ ...p, avatarUrl: e.target.value }))} className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8" data-testid="input-avatar-url" />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Clé SSH publique</label>
              <Textarea value={formData.sshPublicKey || ""} onChange={e => setFormData(p => ({ ...p, sshPublicKey: e.target.value }))} className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm font-mono text-[10px] min-h-[50px]" data-testid="input-ssh-key" />
            </div>
            <Button onClick={() => updateProfile.mutate()} disabled={updateProfile.isPending} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="button-save-profile">
              {updateProfile.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />}
              Sauvegarder
            </Button>
          </CardContent>
        </Card>
      )}

      {accountTab === "security" && (
        <div className="space-y-4" data-testid="account-security-section">
          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardHeader className="pb-3"><CardTitle className="text-sm text-zinc-300">Login ID</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-zinc-500">Login actuel : <span className="text-zinc-300 font-mono">{profile?.loginId || "Non défini"}</span></p>
              <div className="flex gap-2">
                <Input value={newLoginId} onChange={e => setNewLoginId(e.target.value)} placeholder="Nouveau Login ID" className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8 flex-1" data-testid="input-new-login-id" />
                <Button onClick={() => changeLoginId.mutate()} disabled={!newLoginId || changeLoginId.isPending} size="sm" className="bg-emerald-600 hover:bg-emerald-700" data-testid="button-change-login-id">
                  {changeLoginId.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Modifier"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardHeader className="pb-3"><CardTitle className="text-sm text-zinc-300">Changer le PIN</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {profile?.hasPin && (
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">PIN actuel</label>
                  <Input type="password" value={currentPin} onChange={e => setCurrentPin(e.target.value)} placeholder="••••" className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8" data-testid="input-current-pin" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Nouveau PIN (4-8 chiffres)</label>
                  <Input type="password" value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="••••" className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8" data-testid="input-new-pin" />
                </div>
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Confirmer</label>
                  <Input type="password" value={confirmPin} onChange={e => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="••••" className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8" data-testid="input-confirm-pin" />
                </div>
              </div>
              <Button onClick={() => changePin.mutate()} disabled={!newPin || newPin.length < 4 || newPin !== confirmPin || changePin.isPending} size="sm" className="bg-emerald-600 hover:bg-emerald-700" data-testid="button-change-pin">
                {changePin.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : <Lock className="w-3.5 h-3.5 mr-2" />}
                Modifier le PIN
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardHeader className="pb-3"><CardTitle className="text-sm text-zinc-300">Mot de passe</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {profile?.hasPassword && (
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Mot de passe actuel</label>
                  <Input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="••••••••" className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8" data-testid="input-current-password" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Nouveau mot de passe (8+ car.)</label>
                  <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="••••••••" className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8" data-testid="input-new-password" />
                </div>
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Confirmer</label>
                  <Input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="••••••••" className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8" data-testid="input-confirm-password" />
                </div>
              </div>
              <Button onClick={() => changePassword.mutate()} disabled={!newPassword || newPassword.length < 8 || newPassword !== confirmPassword || changePassword.isPending} size="sm" className="bg-emerald-600 hover:bg-emerald-700" data-testid="button-change-password">
                {changePassword.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : <Shield className="w-3.5 h-3.5 mr-2" />}
                Modifier le mot de passe
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {accountTab === "sessions" && (
        <Card className="bg-zinc-900/50 border-zinc-800" data-testid="account-sessions-section">
          <CardHeader className="pb-3"><CardTitle className="text-sm text-zinc-300">Sessions actives ({profile?.activeSessions || 0})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {profile?.sessions?.map((s: any) => (
              <div key={s.id} className="flex items-center justify-between bg-gray-200/50 dark:bg-zinc-800/50 rounded-lg p-3 text-xs" data-testid={`session-${s.id}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-zinc-300 font-mono truncate">{s.id.slice(0, 12)}...</div>
                  <div className="text-zinc-500 mt-0.5">{s.user_agent?.slice(0, 50) || "Inconnu"}</div>
                  <div className="text-zinc-500">{s.ip_address || "IP inconnue"} · Dernière activité: {s.last_active_at ? timeAgo(s.last_active_at) : "?"}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => revokeSession.mutate(s.id)} disabled={revokeSession.isPending} className="text-red-400 hover:text-red-300 hover:bg-red-500/10" data-testid={`button-revoke-session-${s.id}`}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
            {(!profile?.sessions || profile.sessions.length === 0) && (
              <p className="text-zinc-500 text-sm">Aucune session active</p>
            )}
          </CardContent>
        </Card>
      )}

      {profile?.recentActivity && profile.recentActivity.length > 0 && (
        <Card className="bg-zinc-900/50 border-zinc-800" data-testid="account-activity-section">
          <CardHeader className="pb-3"><CardTitle className="text-sm text-zinc-300">Activité récente</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1">
              {profile.recentActivity.slice(0, 10).map((a: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-xs text-zinc-400">
                  <Activity className="w-3 h-3 text-zinc-600" />
                  <span className="text-zinc-300">{a.action}</span>
                  <span className="text-zinc-500">{a.target}</span>
                  <span className="ml-auto text-zinc-600">{a.created_at ? timeAgo(a.created_at) : ""}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DevmaxDashboard() {
  const { logout, activeProject, setActiveProject } = useDevmaxAuth();
  const shouldAutoAudit = !!(activeProject as any)?._triggerAudit as boolean;
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
