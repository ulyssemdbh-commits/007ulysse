import { useState, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { motion, AnimatePresence } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Home,
  Plus,
  Rocket,
  Globe,
  Server,
  Loader2,
  Trash2,
  RefreshCw,
  FolderGit2,
  Settings,
  Play,
  ExternalLink,
  Sparkles,
  Layout,
  Palette,
  Gamepad2,
  BookOpen,
  Camera,
  Music,
  Code2,
  ShoppingBag,
  Zap,
  Heart,
  FlaskConical,
  ArrowLeft,
  Folder,
  File,
  ChevronRight,
  Save,
  Pencil,
  X,
} from "lucide-react";

interface IrisProject {
  id: number;
  ownerName: string;
  projectName: string;
  subdomain: string;
  description: string | null;
  githubRepo: string | null;
  port: number | null;
  techStack: string | null;
  status: string;
  lastDeployedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProjectTemplate {
  name: string;
  icon: any;
  description: string;
  techStack: string;
  defaultPort: number;
  color: string;
}

const TEMPLATES: ProjectTemplate[] = [
  { name: "Portfolio", icon: Layout, description: "Site perso avec projets et bio", techStack: "React, Tailwind", defaultPort: 0, color: "from-violet-500 to-purple-600" },
  { name: "Blog", icon: BookOpen, description: "Blog avec articles et catégories", techStack: "Next.js, MDX", defaultPort: 0, color: "from-emerald-500 to-teal-600" },
  { name: "Galerie Photo", icon: Camera, description: "Galerie d'images avec albums", techStack: "React, Lightbox", defaultPort: 0, color: "from-amber-500 to-orange-600" },
  { name: "Jeu Web", icon: Gamepad2, description: "Mini-jeu dans le navigateur", techStack: "Phaser, TypeScript", defaultPort: 0, color: "from-red-500 to-pink-600" },
  { name: "Playlist", icon: Music, description: "Partage de playlists et goûts musicaux", techStack: "React, Spotify API", defaultPort: 0, color: "from-green-500 to-emerald-600" },
  { name: "Boutique", icon: ShoppingBag, description: "Mini e-commerce / vitrine", techStack: "React, Stripe", defaultPort: 0, color: "from-blue-500 to-indigo-600" },
  { name: "Art & Design", icon: Palette, description: "Galerie de créations artistiques", techStack: "React, Canvas", defaultPort: 0, color: "from-pink-500 to-rose-600" },
  { name: "Projet Libre", icon: Code2, description: "Projet custom — tout est possible !", techStack: "À définir", defaultPort: 0, color: "from-slate-500 to-zinc-600" },
];

const OWNER_CONFIG: Record<string, { bg: string; text: string; accent: string; avatar: string; gradient: string; ring: string; glow: string; emoji2: string }> = {
  Kelly: { bg: "from-pink-500/20 to-rose-500/20", text: "text-pink-400", accent: "bg-pink-500", avatar: "🦋", gradient: "from-pink-500 via-rose-400 to-fuchsia-500", ring: "ring-pink-500/50", glow: "shadow-pink-500/20", emoji2: "✨" },
  Lenny: { bg: "from-blue-500/20 to-cyan-500/20", text: "text-blue-400", accent: "bg-blue-500", avatar: "🌊", gradient: "from-blue-500 via-cyan-400 to-sky-500", ring: "ring-blue-500/50", glow: "shadow-blue-500/20", emoji2: "⚡" },
  Micky: { bg: "from-purple-500/20 to-violet-500/20", text: "text-purple-400", accent: "bg-purple-500", avatar: "🦄", gradient: "from-purple-500 via-violet-400 to-indigo-500", ring: "ring-purple-500/50", glow: "shadow-purple-500/20", emoji2: "🌟" },
};

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; dot: string }> = {
  draft: { label: "Brouillon", variant: "outline", dot: "bg-gray-400" },
  configured: { label: "Configuré", variant: "secondary", dot: "bg-yellow-400" },
  initialized: { label: "Initialisé", variant: "secondary", dot: "bg-blue-400" },
  deployed: { label: "En ligne", variant: "default", dot: "bg-green-400 animate-pulse" },
  error: { label: "Erreur", variant: "destructive", dot: "bg-red-400" },
};

const NEXT_PORT_BASE = 5020;

const USERNAME_TO_OWNER: Record<string, string> = {
  KellyIris001: "Kelly",
  LennyIris002: "Lenny",
  MickyIris003: "Micky",
};

interface TreeItem {
  path: string;
  type: string;
  size?: number;
}

function IrisStagingBrowser({ repo, onClose }: { repo: string; onClose: () => void }) {
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [fileContent, setFileContent] = useState<{ path: string; content: string; sha: string } | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [commitMsg, setCommitMsg] = useState("");
  const [deploying, setDeploying] = useState(false);
  const [deployStatus, setDeployStatus] = useState<string | null>(null);
  const { toast } = useToast();
  const [owner, repoName] = repo.includes("/") ? repo.split("/") : ["", ""];
  const base = `/api/devops/repos/${owner}/${repoName}`;

  const { data: branches } = useQuery<any[]>({
    queryKey: [base, "branches"],
    queryFn: () => fetch(`${base}/branches`, { credentials: "include" }).then(r => r.json()).then(d => Array.isArray(d) ? d : []),
    enabled: !!owner && !!repoName,
  });

  const hasStagingBranch = useMemo(() => branches?.some((b: any) => b.name === "staging") || false, [branches]);

  const { data: tree, isLoading } = useQuery<{ tree: TreeItem[] }>({
    queryKey: [base, "tree", "staging"],
    queryFn: () => fetch(`${base}/tree/staging`, { credentials: "include" }).then(r => r.json()).then(d => d?.tree ? d : { tree: [] }),
    enabled: !!owner && !!repoName && hasStagingBranch,
  });

  const items = useMemo(() => {
    if (!tree?.tree) return [];
    const prefix = currentPath.join("/");
    return tree.tree
      .filter(item => {
        if (prefix) {
          if (!item.path.startsWith(prefix + "/")) return false;
          const remaining = item.path.slice(prefix.length + 1);
          return !remaining.includes("/");
        }
        return !item.path.includes("/");
      })
      .sort((a, b) => {
        if (a.type === "tree" && b.type !== "tree") return -1;
        if (a.type !== "tree" && b.type === "tree") return 1;
        return a.path.localeCompare(b.path);
      });
  }, [tree, currentPath]);

  const openFile = useCallback(async (path: string) => {
    try {
      const res = await fetch(`${base}/contents/${path}?ref=staging`, { credentials: "include" });
      const data = await res.json();
      const decoded = atob(data.content?.replace(/\n/g, "") || "");
      setFileContent({ path, content: decoded, sha: data.sha });
      setEditContent(decoded);
      setEditMode(false);
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    }
  }, [base, toast]);

  const saveFile = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${base}/contents/${fileContent!.path}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          content: editContent,
          message: commitMsg || `[staging] Update ${fileContent!.path}`,
          branch: "staging",
          sha: fileContent!.sha,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => {
      toast({ title: "Sauvegardé sur staging" });
      setEditMode(false);
      setCommitMsg("");
      queryClient.invalidateQueries({ queryKey: [base, "tree", "staging"] });
      if (fileContent) openFile(fileContent.path);
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const deployToProd = useCallback(async () => {
    setDeploying(true);
    setDeployStatus("Création PR staging → main...");
    try {
      let prNumber: number | null = null;
      try {
        const prRes = await fetch(`${base}/pulls`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            title: `[Deploy] Staging → Prod (${new Date().toLocaleDateString("fr-FR")})`,
            body: "Déploiement depuis staging",
            head: "staging",
            base: "main",
          }),
        });
        if (!prRes.ok) {
          const errText = await prRes.text();
          if (prRes.status === 422 || errText.toLowerCase().includes("no commits") || errText.toLowerCase().includes("already")) {
            toast({ title: "Info", description: "Staging est déjà à jour avec la prod." });
            setDeploying(false);
            setDeployStatus(null);
            return;
          }
          throw new Error(errText);
        }
        const prData = await prRes.json();
        prNumber = prData?.number;
      } catch (prErr: any) {
        if (prErr.message?.includes("422")) {
          toast({ title: "Info", description: "Staging déjà synchronisé." });
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
      const mergeRes = await fetch(`${base}/pulls/${prNumber}/merge`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ merge_method: "merge" }),
      });
      if (!mergeRes.ok) throw new Error(await mergeRes.text());

      toast({ title: "Déploiement réussi !", description: `PR #${prNumber} mergée` });
      setDeployStatus("Terminé !");
      queryClient.invalidateQueries({ queryKey: [base, "tree"] });
      setTimeout(() => setDeployStatus(null), 3000);
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message || "Échec du déploiement", variant: "destructive" });
      setDeployStatus(null);
    }
    setDeploying(false);
  }, [base, toast]);

  if (!branches) {
    return (
      <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-amber-400" /></div>
    );
  }

  if (!hasStagingBranch) {
    return (
      <div className="p-8 text-center">
        <FlaskConical className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
        <p className="text-sm text-muted-foreground mb-1">Pas de branche <code className="bg-muted px-1 rounded">staging</code></p>
        <p className="text-xs text-muted-foreground">Créez-la sur GitHub pour activer les Fichiers-Test.</p>
      </div>
    );
  }

  if (fileContent) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="ghost" className="rounded-xl" onClick={() => { if (editMode && !confirm("Quitter sans sauvegarder ?")) return; setFileContent(null); setEditMode(false); }} data-testid="button-iris-staging-back">
            <ArrowLeft className="w-4 h-4 mr-1" /> Retour
          </Button>
          <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-600">staging</Badge>
          <code className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">{fileContent.path}</code>
          <div className="flex-1" />
          {!editMode ? (
            <Button size="sm" className="rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:opacity-90 text-white border-0" onClick={() => setEditMode(true)} data-testid="button-iris-staging-edit">
              <Pencil className="w-3.5 h-3.5 mr-1" /> Éditer
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Input placeholder="Message du commit" value={commitMsg} onChange={e => setCommitMsg(e.target.value)} className="w-40 h-8 text-xs rounded-xl" data-testid="input-iris-staging-commit" />
              <Button size="sm" className="rounded-xl" onClick={() => saveFile.mutate()} disabled={saveFile.isPending} data-testid="button-iris-staging-save">
                {saveFile.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span className="ml-1">Commit</span>
              </Button>
              <Button size="sm" variant="outline" className="rounded-xl" onClick={() => { setEditMode(false); setEditContent(fileContent.content); }} data-testid="button-iris-staging-cancel">Annuler</Button>
            </div>
          )}
        </div>
        {editMode ? (
          <Textarea value={editContent} onChange={e => setEditContent(e.target.value)} className="font-mono text-xs min-h-[300px] rounded-xl" data-testid="textarea-iris-staging-edit" />
        ) : (
          <div className="border rounded-xl overflow-auto max-h-[350px]">
            <pre className="p-4 text-xs font-mono whitespace-pre-wrap">{fileContent.content}</pre>
          </div>
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
          <Button size="sm" variant="ghost" className="rounded-xl" onClick={() => setCurrentPath(p => p.slice(0, -1))} data-testid="button-iris-staging-up">
            <ArrowLeft className="w-4 h-4 mr-1" /> ..
          </Button>
        )}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="cursor-pointer hover:text-foreground" onClick={() => setCurrentPath([])} data-testid="breadcrumb-iris-staging-root">root</span>
          {currentPath.map((p, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="w-3 h-3" />
              <span className="cursor-pointer hover:text-foreground" onClick={() => setCurrentPath(prev => prev.slice(0, i + 1))} data-testid={`breadcrumb-iris-staging-${p}`}>{p}</span>
            </span>
          ))}
        </div>
        <div className="flex-1" />
        <Button
          size="sm"
          className="rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 hover:opacity-90 text-white border-0"
          disabled={deploying}
          onClick={() => { if (confirm("Déployer staging vers production ?")) deployToProd(); }}
          data-testid="button-iris-deploy-staging"
        >
          {deploying ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Rocket className="w-3.5 h-3.5 mr-1" />}
          Déployer en Prod
        </Button>
      </div>

      {deployStatus && (
        <div className="flex items-center gap-2 text-xs p-2 rounded-xl bg-muted/50 border">
          {deploying ? <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" /> : <Rocket className="w-3.5 h-3.5 text-green-500" />}
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
                data-testid={`iris-staging-item-${name}`}
              >
                {isDir ? <Folder className="w-4 h-4 text-amber-400" /> : <File className="w-4 h-4 text-muted-foreground" />}
                <span className="flex-1 font-mono text-sm">{name}</span>
                {item.size && <span className="text-xs text-muted-foreground">{(item.size / 1024).toFixed(1)}KB</span>}
              </div>
            );
          })}
          {items.length === 0 && !isLoading && (
            <div className="p-8 text-center">
              <Folder className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">Aucun fichier sur staging</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DevOpsIris() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const myOwnerName = user?.username ? USERNAME_TO_OWNER[user.username] || null : null;
  const isAdmin = user?.isOwner === true;
  const [selectedOwner, setSelectedOwner] = useState<string | null>(null);
  const effectiveOwner = myOwnerName || selectedOwner;
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<ProjectTemplate | null>(null);
  const [newProject, setNewProject] = useState({
    ownerName: "",
    projectName: "",
    subdomain: "",
    description: "",
    githubRepo: "",
    port: "",
    techStack: "",
  });
  const [actionLoading, setActionLoading] = useState<Record<number, string>>({});
  const [stagingProject, setStagingProject] = useState<IrisProject | null>(null);

  const { data: owners = [] } = useQuery<string[]>({
    queryKey: ["/api/iris/owners"],
  });

  const { data: projects = [], refetch: refetchProjects } = useQuery<IrisProject[]>({
    queryKey: ["/api/iris/projects", effectiveOwner],
    queryFn: async () => {
      const url = effectiveOwner ? `/api/iris/projects?owner=${effectiveOwner}` : "/api/iris/projects";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch projects");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/iris/projects", data);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/iris/projects"] });
      setCreateOpen(false);
      setSelectedTemplate(null);
      resetForm();
      const urls = data.urls;
      const desc = urls
        ? `GitHub: ${urls.github || "N/A"}\nProd: ${urls.production}\nTest: ${urls.test}`
        : "Le projet est prêt";
      toast({ title: "Projet créé et provisionné !", description: desc });
    },
    onError: (err: any) => {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/iris/projects/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/iris/projects"] });
      toast({ title: "Projet supprimé" });
    },
  });

  function resetForm() {
    setNewProject({ ownerName: "", projectName: "", subdomain: "", description: "", githubRepo: "", port: "", techStack: "" });
  }


  async function runAction(projectId: number, action: string, label: string) {
    setActionLoading((prev) => ({ ...prev, [projectId]: action }));
    try {
      const res = await apiRequest("POST", `/api/iris/projects/${projectId}/${action}`);
      const data = await res.json();
      if (data.success) {
        toast({ title: `${label} réussi`, description: data.logs?.slice(-1)[0] || "OK" });
      } else {
        toast({ title: `${label} échoué`, description: data.logs?.join("\n") || "Erreur", variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/iris/projects"] });
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    } finally {
      setActionLoading((prev) => ({ ...prev, [projectId]: "" }));
    }
  }

  function submitProject() {
    const ownerName = myOwnerName || newProject.ownerName || selectedOwner;
    if (!ownerName) {
      toast({ title: "Erreur", description: "Choisis un propriétaire", variant: "destructive" });
      return;
    }
    const isPrivate = newProject.githubRepo === "private";
    createMutation.mutate({
      ownerName,
      projectName: newProject.projectName,
      subdomain: newProject.subdomain,
      description: newProject.description || null,
      githubRepo: isPrivate ? null : (newProject.githubRepo || null),
      port: newProject.port ? parseInt(newProject.port) : null,
      techStack: newProject.techStack || selectedTemplate?.techStack || null,
      status: "draft",
      isPrivate,
    });
  }

  const ownerProjects = effectiveOwner ? projects.filter((p) => p.ownerName === effectiveOwner) : projects;
  const projectCounts = owners.reduce((acc, owner) => {
    acc[owner] = projects.filter((p) => p.ownerName === owner).length;
    return acc;
  }, {} as Record<string, number>);
  const deployedCount = projects.filter((p) => p.status === "deployed").length;

  return (
    <div className="min-h-screen bg-background" data-testid="devops-iris-page">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-pink-500/5 via-purple-500/5 to-blue-500/5" />
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-pink-500/10 rounded-full blur-3xl" />
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />

        <div className="relative max-w-7xl mx-auto px-6 py-6 space-y-6">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between"
          >
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl" onClick={() => navigate(myOwnerName ? "/iris" : "/")} data-testid="button-back-dashboard">
                <Home className="w-4 h-4" />
              </Button>
              <div className="relative">
                <div className="absolute -inset-2 bg-gradient-to-r from-pink-500/20 via-purple-500/20 to-blue-500/20 rounded-2xl blur-lg" />
                <div className="relative flex items-center gap-3 bg-background/80 backdrop-blur-sm rounded-xl px-4 py-2 border border-white/10">
                  <Sparkles className="h-7 w-7 text-amber-400" />
                  <div>
                    <h1 className="text-2xl font-black tracking-tight bg-gradient-to-r from-pink-400 via-purple-400 to-blue-400 bg-clip-text text-transparent" data-testid="text-page-title">
                      DevOps Iris
                    </h1>
                    <p className="text-xs text-muted-foreground">Projets des filles • *.ulyssepro.org</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="rounded-xl" onClick={() => refetchProjects()} data-testid="button-refresh">
                <RefreshCw className="h-4 w-4 mr-2" />
                Actualiser
              </Button>
            </div>
          </motion.div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.05 }}>
              <Card className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/20">
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-black">{projects.length}</p>
                  <p className="text-xs text-muted-foreground">Projets Total</p>
                </CardContent>
              </Card>
            </motion.div>
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 }}>
              <Card className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border-green-500/20">
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-black text-green-400">{deployedCount}</p>
                  <p className="text-xs text-muted-foreground">En Ligne</p>
                </CardContent>
              </Card>
            </motion.div>
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.15 }}>
              <Card className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border-blue-500/20">
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-black">{owners.length}</p>
                  <p className="text-xs text-muted-foreground">Créatrices</p>
                </CardContent>
              </Card>
            </motion.div>
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }}>
              <Card className="bg-gradient-to-br from-purple-500/10 to-violet-500/10 border-purple-500/20 cursor-pointer hover:border-purple-400/40 transition-colors" onClick={() => setCreateOpen(true)}>
                <CardContent className="p-4 text-center">
                  <Zap className="h-6 w-6 mx-auto text-purple-400 mb-1" />
                  <p className="text-xs text-muted-foreground">Quick Start</p>
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {isAdmin && <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {owners.map((owner, idx) => {
              const cfg = OWNER_CONFIG[owner] || { bg: "from-gray-500/20 to-gray-400/20", text: "text-gray-400", accent: "bg-gray-500", avatar: "👤", gradient: "from-gray-500 to-gray-600", ring: "ring-gray-500/50", glow: "shadow-gray-500/20", emoji2: "⭐" };
              const isSelected = selectedOwner === owner;
              const count = projectCounts[owner] || 0;
              const ownerDeployed = projects.filter((p) => p.ownerName === owner && p.status === "deployed").length;
              return (
                <motion.div
                  key={owner}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + idx * 0.1 }}
                >
                  <Card
                    className={`cursor-pointer transition-all duration-300 overflow-hidden ${isSelected ? `ring-2 ${cfg.ring} shadow-lg ${cfg.glow}` : "hover:shadow-md hover:scale-[1.02]"}`}
                    onClick={() => setSelectedOwner(isSelected ? null : owner)}
                    data-testid={`card-owner-${owner.toLowerCase()}`}
                  >
                    <div className={`h-1.5 bg-gradient-to-r ${cfg.gradient}`} />
                    <CardContent className="p-5">
                      <div className={`bg-gradient-to-br ${cfg.bg} rounded-2xl p-5 relative overflow-hidden`}>
                        <div className="absolute top-2 right-2 text-4xl opacity-20">{cfg.emoji2}</div>
                        <div className="flex items-center gap-4">
                          <div className="text-5xl filter drop-shadow-lg">{cfg.avatar}</div>
                          <div>
                            <h3 className={`text-xl font-black ${cfg.text}`}>{owner}</h3>
                            <div className="flex items-center gap-3 mt-1">
                              <span className="text-sm text-muted-foreground">
                                {count} projet{count !== 1 ? "s" : ""}
                              </span>
                              {ownerDeployed > 0 && (
                                <span className="flex items-center gap-1 text-xs text-green-400">
                                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                                  {ownerDeployed} en ligne
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="mt-4 flex gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            className="rounded-xl text-xs h-8"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedOwner(owner);
                              setNewProject((p) => ({ ...p, ownerName: owner }));
                              setCreateOpen(true);
                            }}
                            data-testid={`button-new-project-${owner.toLowerCase()}`}
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            Nouveau
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>}

          <AnimatePresence mode="wait">
            {effectiveOwner && (
              <motion.div
                key={effectiveOwner}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className={`h-8 w-1 rounded-full bg-gradient-to-b ${OWNER_CONFIG[effectiveOwner]?.gradient || "from-gray-500 to-gray-600"}`} />
                  <span className="text-2xl">{OWNER_CONFIG[effectiveOwner]?.avatar}</span>
                  <h2 className={`text-lg font-bold ${OWNER_CONFIG[effectiveOwner]?.text || "text-gray-400"}`}>
                    {myOwnerName ? "Mes projets" : `Projets de ${effectiveOwner}`}
                  </h2>
                  <Badge variant="outline" className="ml-2">{ownerProjects.length}</Badge>
                </div>

                {ownerProjects.length === 0 ? (
                  <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                    <Card className="border-dashed border-2">
                      <CardContent className="p-12 text-center">
                        <div className="text-6xl mb-4">{OWNER_CONFIG[effectiveOwner]?.avatar}</div>
                        <h3 className="text-lg font-bold mb-2">
                          {myOwnerName ? "Tu n'as pas encore de projet" : `Aucun projet pour ${effectiveOwner}`}
                        </h3>
                        <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                          Choisis un template pour démarrer rapidement, ou crée un projet libre !
                        </p>
                        <div className="flex gap-3 justify-center">
                          <Button onClick={() => { setNewProject((p) => ({ ...p, ownerName: effectiveOwner || "" })); setCreateOpen(true); }} className="rounded-xl" data-testid="button-template-empty">
                            <Zap className="h-4 w-4 mr-2" />
                            Choisir un Template
                          </Button>
                          <Button variant="outline" onClick={() => { setNewProject((p) => ({ ...p, ownerName: effectiveOwner || "" })); setCreateOpen(true); }} className="rounded-xl" data-testid="button-create-empty">
                            <Plus className="h-4 w-4 mr-2" />
                            Projet Libre
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {ownerProjects.map((project, idx) => {
                      const cfg = OWNER_CONFIG[project.ownerName] || { bg: "from-gray-500/20 to-gray-400/20", text: "text-gray-400", accent: "bg-gray-500", avatar: "👤", gradient: "from-gray-500 to-gray-600", ring: "", glow: "", emoji2: "" };
                      const statusCfg = STATUS_CONFIG[project.status] || { label: project.status, variant: "outline" as const, dot: "bg-gray-400" };
                      const isLoading = !!actionLoading[project.id];
                      const currentAction = actionLoading[project.id];

                      return (
                        <motion.div
                          key={project.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.05 }}
                        >
                          <Card className="overflow-hidden hover:shadow-lg transition-shadow duration-300 group" data-testid={`card-project-${project.id}`}>
                            <div className={`h-1.5 bg-gradient-to-r ${cfg.gradient}`} />
                            <CardHeader className="pb-2">
                              <div className="flex items-start justify-between">
                                <div className="flex items-center gap-3">
                                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${cfg.bg} flex items-center justify-center text-lg`}>
                                    {cfg.avatar}
                                  </div>
                                  <div>
                                    <CardTitle className="text-base font-bold">{project.projectName}</CardTitle>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                      <Globe className="h-3 w-3 text-muted-foreground" />
                                      <a href={`https://${project.subdomain}.ulyssepro.org`} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground font-mono hover:text-primary transition-colors">{project.subdomain}.ulyssepro.org</a>
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                      <Globe className="h-3 w-3 text-yellow-500/60" />
                                      <a href={`https://${project.subdomain}-dev.ulyssepro.org`} target="_blank" rel="noopener noreferrer" className="text-xs text-yellow-500/60 font-mono hover:text-yellow-400 transition-colors">{project.subdomain}-dev.ulyssepro.org</a>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className={`w-2 h-2 rounded-full ${statusCfg.dot}`} />
                                  <Badge variant={statusCfg.variant} className="text-[10px]" data-testid={`badge-status-${project.id}`}>
                                    {statusCfg.label}
                                  </Badge>
                                </div>
                              </div>
                            </CardHeader>
                            <CardContent className="space-y-3 pt-0">
                              {project.description && (
                                <p className="text-sm text-muted-foreground line-clamp-2">{project.description}</p>
                              )}
                              <div className="flex flex-wrap gap-2">
                                {project.techStack && (
                                  <Badge variant="outline" className="text-[10px] bg-background/50">
                                    <Code2 className="h-2.5 w-2.5 mr-1" /> {project.techStack}
                                  </Badge>
                                )}
                                {project.port && (
                                  <Badge variant="outline" className="text-[10px] bg-background/50">
                                    <Server className="h-2.5 w-2.5 mr-1" /> :{project.port}
                                  </Badge>
                                )}
                                {project.githubRepo && (
                                  <a href={`https://github.com/${project.githubRepo}`} target="_blank" rel="noopener noreferrer">
                                    <Badge variant="outline" className="text-[10px] bg-background/50 hover:bg-primary/20 cursor-pointer">
                                      <FolderGit2 className="h-2.5 w-2.5 mr-1" /> {project.githubRepo}
                                    </Badge>
                                  </a>
                                )}
                              </div>
                              {project.lastDeployedAt && (
                                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                                  <Rocket className="h-3 w-3" />
                                  Déployé le {new Date(project.lastDeployedAt).toLocaleString("fr-FR")}
                                </p>
                              )}
                              <div className="flex flex-wrap gap-1.5 pt-2 border-t border-border/30">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="rounded-lg text-xs h-7"
                                  disabled={isLoading}
                                  onClick={() => runAction(project.id, "setup-subdomain", "Config DNS")}
                                  data-testid={`button-setup-${project.id}`}
                                >
                                  {currentAction === "setup-subdomain" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Globe className="h-3 w-3 mr-1" />}
                                  DNS
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="rounded-lg text-xs h-7"
                                  disabled={isLoading}
                                  onClick={() => runAction(project.id, "init-server", "Initialisation")}
                                  data-testid={`button-init-${project.id}`}
                                >
                                  {currentAction === "init-server" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Play className="h-3 w-3 mr-1" />}
                                  Init
                                </Button>
                                <Button
                                  size="sm"
                                  className={`rounded-lg text-xs h-7 bg-gradient-to-r ${cfg.gradient} hover:opacity-90 text-white border-0`}
                                  disabled={isLoading}
                                  onClick={() => runAction(project.id, "deploy", "Déploiement")}
                                  data-testid={`button-deploy-${project.id}`}
                                >
                                  {currentAction === "deploy" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Rocket className="h-3 w-3 mr-1" />}
                                  Déployer
                                </Button>
                                {project.githubRepo && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="rounded-lg text-xs h-7 border-amber-400/50 text-amber-600 hover:bg-amber-500/10"
                                    onClick={() => setStagingProject(project)}
                                    data-testid={`button-staging-${project.id}`}
                                  >
                                    <FlaskConical className="h-3 w-3 mr-1" />
                                    Fichiers-Test
                                  </Button>
                                )}
                                {project.status === "deployed" && (
                                  <Button variant="ghost" size="sm" className="rounded-lg text-xs h-7" asChild data-testid={`button-visit-${project.id}`}>
                                    <a href={`https://${project.subdomain}.ulyssepro.org`} target="_blank" rel="noopener noreferrer">
                                      <ExternalLink className="h-3 w-3 mr-1" />
                                      Visiter
                                    </a>
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="rounded-lg text-xs h-7 text-destructive hover:text-destructive ml-auto opacity-0 group-hover:opacity-100 transition-opacity"
                                  disabled={isLoading}
                                  onClick={() => { if (confirm(`Supprimer "${project.projectName}" ?`)) deleteMutation.mutate(project.id); }}
                                  data-testid={`button-delete-${project.id}`}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {!effectiveOwner && projects.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
            >
              <Card className="border-dashed border-2 border-muted-foreground/20">
                <CardContent className="p-16 text-center">
                  <div className="flex justify-center gap-4 mb-6">
                    <span className="text-5xl animate-bounce" style={{ animationDelay: "0ms" }}>🦋</span>
                    <span className="text-5xl animate-bounce" style={{ animationDelay: "150ms" }}>🌊</span>
                    <span className="text-5xl animate-bounce" style={{ animationDelay: "300ms" }}>🦄</span>
                  </div>
                  <h3 className="text-xl font-bold mb-2">Bienvenue sur DevOps Iris !</h3>
                  <p className="text-muted-foreground mb-6 max-w-lg mx-auto">
                    L'espace de création de Kelly, Lenny et Micky. Choisis une fille ci-dessus pour voir ses projets, ou lance un nouveau projet avec un template.
                  </p>
                  <Button onClick={() => setCreateOpen(true)} className="rounded-xl" size="lg" data-testid="button-get-started">
                    <Sparkles className="h-5 w-5 mr-2" />
                    Commencer un projet
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nouveau projet</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-medium mb-2 block">Template</label>
              <div className="grid grid-cols-3 gap-2">
                {TEMPLATES.map((tmpl) => {
                  const Icon = tmpl.icon;
                  return (
                    <div
                      key={tmpl.name}
                      className={`border rounded-lg p-2 cursor-pointer transition-all text-center ${
                        selectedTemplate?.name === tmpl.name
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "hover:border-primary/40"
                      }`}
                      onClick={() => {
                        setSelectedTemplate(tmpl);
                        const nextPort = NEXT_PORT_BASE + projects.length;
                        setNewProject((p) => ({
                          ...p,
                          description: tmpl.description,
                          techStack: tmpl.techStack,
                          port: tmpl.defaultPort ? String(tmpl.defaultPort) : String(nextPort),
                        }));
                      }}
                      data-testid={`template-${tmpl.name.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${tmpl.color} flex items-center justify-center mx-auto`}>
                        <Icon className="h-4 w-4 text-white" />
                      </div>
                      <p className="text-xs font-medium mt-1">{tmpl.name}</p>
                    </div>
                  );
                })}
              </div>
            </div>
            {isAdmin && (
              <div>
                <label className="text-sm font-medium mb-1 block">Propriétaire</label>
                <Select
                  value={newProject.ownerName}
                  onValueChange={(val) => setNewProject((p) => ({ ...p, ownerName: val }))}
                >
                  <SelectTrigger data-testid="select-owner">
                    <SelectValue placeholder="Choisir..." />
                  </SelectTrigger>
                  <SelectContent>
                    {owners.map((o) => (
                      <SelectItem key={o} value={o}>{OWNER_CONFIG[o]?.avatar} {o}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <label className="text-sm font-medium mb-1 block">Nom</label>
              <Input
                placeholder="mon-projet"
                value={newProject.projectName}
                onChange={(e) => {
                  const name = e.target.value;
                  const sub = name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
                  setNewProject((p) => ({ ...p, projectName: name, subdomain: sub }));
                }}
                data-testid="input-project-name"
              />
              {newProject.subdomain && (
                <p className="text-[10px] text-muted-foreground mt-1 font-mono">{newProject.subdomain}.ulyssepro.org</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Description</label>
              <Input
                placeholder="Optionnel"
                value={newProject.description}
                onChange={(e) => setNewProject((p) => ({ ...p, description: e.target.value }))}
                data-testid="input-description"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="project-private"
                checked={newProject.githubRepo === "private"}
                onChange={(e) => setNewProject((p) => ({ ...p, githubRepo: e.target.checked ? "private" : "" }))}
                className="rounded border-border"
              />
              <label htmlFor="project-private" className="text-sm">Privé</label>
            </div>
            <Button
              onClick={submitProject}
              disabled={createMutation.isPending || !newProject.projectName.trim()}
              className="w-full"
              data-testid="button-submit-project"
            >
              {createMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Plus className="w-4 h-4 mr-2" />
              )}
              Créer
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!stagingProject} onOpenChange={(open) => { if (!open) setStagingProject(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FlaskConical className="w-5 h-5 text-amber-500" />
              Fichiers-Test — {stagingProject?.projectName}
            </DialogTitle>
          </DialogHeader>
          {stagingProject?.githubRepo && (
            <IrisStagingBrowser repo={stagingProject.githubRepo} onClose={() => setStagingProject(null)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
