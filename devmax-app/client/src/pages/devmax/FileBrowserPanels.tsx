import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle,
  Loader2,
  Folder,
  File,
  ChevronRight,
  Code,
  ArrowLeft,
  Rocket,
  FlaskConical,
  Merge,
  Save,
  Pencil,
} from "lucide-react";
import {
  API,
  devmaxQueryClient,
  devmaxFetch,
  devmaxApiRequest,
  useDevmaxAuth,
  Branch,
  Commit,
  TreeItem,
} from "./types";

export function FileBrowserPanel() {
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

export function StagingFileBrowserPanel() {
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

  const { data: stagingInfo, isLoading: stagingInfoLoading } = useQuery<{
    hasStagingBranch: boolean;
    useTestRepo: boolean;
    stagingRepo: string | null;
    stagingBranch: string | null;
  }>({
    queryKey: [API, "staging-info", pid],
    queryFn: () => devmaxFetch(`${API}/staging-info`, undefined, pid).then(r => r.json()),
    enabled: !!pid,
  });

  const hasStagingAccess = stagingInfo?.hasStagingBranch || stagingInfo?.useTestRepo || false;

  const { data: tree, isLoading } = useQuery<{ tree: TreeItem[] }>({
    queryKey: [API, "tree", "staging", pid],
    queryFn: () => devmaxFetch(`${API}/tree/staging`, undefined, pid).then(r => r.json()).then(d => d?.tree ? d : { tree: [] }),
    enabled: !!pid && hasStagingAccess,
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
    setDeployStatus("Promotion staging → prod...");
    try {
      const result = await devmaxApiRequest("POST", `${API}/promote-staging`, {}, pid);

      if (result?.method === "already_up_to_date") {
        toast({ title: "Info", description: result.message || "Staging est déjà à jour avec la prod." });
      } else if (result?.method === "branch_merge") {
        toast({ title: "Déploiement réussi !", description: `PR #${result.prNumber} mergée` });
      } else if (result?.method === "test_repo_sync") {
        toast({ title: "Déploiement réussi !", description: `${result.filesSynced}/${result.totalFiles} fichiers synchronisés depuis ${result.testRepo}` });
      } else {
        toast({ title: "Déploiement terminé" });
      }

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

  if (stagingInfoLoading) {
    return (
      <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-amber-400" /></div>
    );
  }

  if (!hasStagingAccess) {
    return (
      <Card className="border-dashed border-2">
        <CardContent className="p-8 text-center">
          <FlaskConical className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground mb-1">Pas de branche <code className="bg-muted px-1 rounded">staging</code> ni de repo <code className="bg-muted px-1 rounded">-test</code></p>
          <p className="text-xs text-muted-foreground">Créez une branche staging ou déployez en staging pour créer le repo test.</p>
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
          <FlaskConical className="w-3 h-3 mr-1" /> {stagingInfo?.useTestRepo ? `staging (${stagingInfo.stagingRepo})` : "staging"}
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
