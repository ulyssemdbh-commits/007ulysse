import { useState, useCallback, memo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Plus,
  CheckCircle,
  XCircle,
  Loader2,
  Trash2,
  Terminal,
  GitFork,
  Lock,
  CheckCircle2,
  LogOut,
  FolderPlus,
  Settings,
  Edit3,
  Globe,
  ArrowRight,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  API,
  AUTH_API,
  DEVMAX_TOKEN_KEY,
  devmaxFetch,
  devmaxApiRequest,
  generateFingerprint,
  useDevmaxAuth,
  DevmaxProject,
  DevmaxUser,
  timeAgo,
} from "./types";

export const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
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

export function DevmaxLoginScreen({ onSuccess }: { onSuccess: (sessionId: string, user?: DevmaxUser) => void }) {
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

export function ProjectSelector({ onSelect }: { onSelect: (project: DevmaxProject) => void }) {
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
          ? `Déploiement automatique en cours...\n${computedSlug}-dev.ulyssepro.org + ${computedSlug}.ulyssepro.org` 
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

