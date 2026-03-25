import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";
import {
  GitBranch,
  GitCommit,
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
  GitPullRequest,
  Trash2,
  Code,
  Search,
  ArrowLeft,
  Bot,
  Rocket,
  Terminal,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

const API = "/api/devmax/ops";
const REPO_URL = "https://github.com/ulyssemdbh-commits/devmax";

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

function BranchesTab() {
  const { toast } = useToast();
  const [newBranch, setNewBranch] = useState("");
  const [fromBranch, setFromBranch] = useState("main");

  const { data: branches, isLoading, refetch } = useQuery<Branch[]>({
    queryKey: [API, "branches"],
    queryFn: () => fetch(`${API}/branches`, { credentials: "include" }).then(r => r.json()),
  });

  const createBranch = useMutation({
    mutationFn: () => apiRequest("POST", `${API}/branches`, { branchName: newBranch, fromBranch }),
    onSuccess: () => {
      toast({ title: "Branche créée" });
      setNewBranch("");
      refetch();
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const deleteBranch = useMutation({
    mutationFn: (name: string) => apiRequest("DELETE", `${API}/branches/${name}`),
    onSuccess: () => { toast({ title: "Branche supprimée" }); refetch(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Nouvelle branche..."
          value={newBranch}
          onChange={e => setNewBranch(e.target.value)}
          className="flex-1"
          data-testid="input-new-branch"
        />
        <Input
          placeholder="depuis"
          value={fromBranch}
          onChange={e => setFromBranch(e.target.value)}
          className="w-32"
        />
        <Button
          size="sm"
          onClick={() => createBranch.mutate()}
          disabled={!newBranch || createBranch.isPending}
          data-testid="button-create-branch"
        >
          {createBranch.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
        </Button>
        <Button size="icon" variant="ghost" onClick={() => refetch()} data-testid="button-refresh-branches">
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <div className="space-y-2">
          {branches?.map(b => (
            <Card key={b.name} className="p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-green-500" />
                  <span className="font-mono text-sm">{b.name}</span>
                  {b.protected && <Badge variant="secondary" className="text-xs">protégée</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  <code className="text-xs text-muted-foreground">{b.commit.sha.slice(0, 7)}</code>
                  {!b.protected && b.name !== "main" && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => deleteBranch.mutate(b.name)}
                      data-testid={`button-delete-branch-${b.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CommitsTab() {
  const [branch, setBranch] = useState("main");
  const { data: commits, isLoading, refetch } = useQuery<Commit[]>({
    queryKey: [API, "commits", branch],
    queryFn: () => fetch(`${API}/commits?branch=${branch}&per_page=30`, { credentials: "include" }).then(r => r.json()),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Branche"
          value={branch}
          onChange={e => setBranch(e.target.value)}
          className="w-40"
        />
        <Button size="icon" variant="ghost" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <div className="space-y-2">
          {commits?.map(c => (
            <Card key={c.sha} className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <GitCommit className="w-4 h-4 text-blue-500 shrink-0" />
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
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function PullRequestsTab() {
  const { toast } = useToast();
  const [prState, setPrState] = useState("open");

  const { data: pulls, isLoading, refetch } = useQuery<PullRequest[]>({
    queryKey: [API, "pulls", prState],
    queryFn: () => fetch(`${API}/pulls?state=${prState}`, { credentials: "include" }).then(r => r.json()),
  });

  const mergePR = useMutation({
    mutationFn: (number: number) => apiRequest("PUT", `${API}/pulls/${number}/merge`, { merge_method: "squash" }),
    onSuccess: () => { toast({ title: "PR fusionnée" }); refetch(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button size="sm" variant={prState === "open" ? "default" : "outline"} onClick={() => setPrState("open")} data-testid="button-pr-open">
          Ouvertes
        </Button>
        <Button size="sm" variant={prState === "closed" ? "default" : "outline"} onClick={() => setPrState("closed")} data-testid="button-pr-closed">
          Fermées
        </Button>
        <Button size="icon" variant="ghost" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : pulls?.length === 0 ? (
        <p className="text-center text-muted-foreground py-8 text-sm">Aucune pull request {prState === "open" ? "ouverte" : "fermée"}</p>
      ) : (
        <div className="space-y-2">
          {pulls?.map(pr => (
            <Card key={pr.number} className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <GitPullRequest className={cn("w-4 h-4 shrink-0", pr.merged_at ? "text-purple-500" : pr.state === "open" ? "text-green-500" : "text-red-500")} />
                    <span className="text-sm font-medium">#{pr.number} {pr.title}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{pr.head.ref} → {pr.base.ref}</span>
                    <span>{timeAgo(pr.created_at)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {pr.state === "open" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => mergePR.mutate(pr.number)}
                      disabled={mergePR.isPending}
                      data-testid={`button-merge-pr-${pr.number}`}
                    >
                      {mergePR.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Rocket className="w-3 h-3" />}
                      <span className="ml-1">Merge</span>
                    </Button>
                  )}
                  <a href={pr.html_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                  </a>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CICDTab() {
  const { toast } = useToast();

  const { data: runs, isLoading, refetch } = useQuery<{ workflow_runs: WorkflowRun[] }>({
    queryKey: [API, "actions", "runs"],
    queryFn: () => fetch(`${API}/actions/runs`, { credentials: "include" }).then(r => r.json()),
  });

  const rerun = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `${API}/actions/runs/${id}/rerun`),
    onSuccess: () => { toast({ title: "Relancé" }); refetch(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const cancel = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `${API}/actions/runs/${id}/cancel`),
    onSuccess: () => { toast({ title: "Annulé" }); refetch(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const workflowRuns = runs?.workflow_runs || [];

  function statusIcon(run: WorkflowRun) {
    if (run.status === "in_progress" || run.status === "queued") return <Loader2 className="w-4 h-4 animate-spin text-yellow-500" />;
    if (run.conclusion === "success") return <CheckCircle className="w-4 h-4 text-green-500" />;
    if (run.conclusion === "failure") return <XCircle className="w-4 h-4 text-red-500" />;
    return <Clock className="w-4 h-4 text-muted-foreground" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Activity className="w-4 h-4" /> GitHub Actions
        </h3>
        <Button size="icon" variant="ghost" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : workflowRuns.length === 0 ? (
        <p className="text-center text-muted-foreground py-8 text-sm">Aucun workflow exécuté</p>
      ) : (
        <div className="space-y-2">
          {workflowRuns.slice(0, 20).map(run => (
            <Card key={run.id} className="p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {statusIcon(run)}
                  <div className="min-w-0">
                    <span className="text-sm font-medium truncate block">{run.name}</span>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>#{run.run_number}</span>
                      <span>{run.head_branch}</span>
                      <span>{timeAgo(run.created_at)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {(run.status === "completed" && run.conclusion === "failure") && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => rerun.mutate(run.id)} data-testid={`button-rerun-${run.id}`}>
                      <RotateCcw className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {(run.status === "in_progress" || run.status === "queued") && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => cancel.mutate(run.id)} data-testid={`button-cancel-${run.id}`}>
                      <StopCircle className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  )}
                  <a href={run.html_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                  </a>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function FileBrowserTab() {
  const [branch, setBranch] = useState("main");
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [fileContent, setFileContent] = useState<{ path: string; content: string; sha: string } | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [commitMsg, setCommitMsg] = useState("");
  const { toast } = useToast();

  const { data: tree, isLoading } = useQuery<{ tree: TreeItem[] }>({
    queryKey: [API, "tree", branch],
    queryFn: () => fetch(`${API}/tree/${branch}`, { credentials: "include" }).then(r => r.json()),
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
      const res = await fetch(`${API}/contents/${path}?ref=${branch}`, { credentials: "include" });
      const data = await res.json();
      const decoded = atob(data.content?.replace(/\n/g, "") || "");
      setFileContent({ path, content: decoded, sha: data.sha });
      setEditContent(decoded);
      setEditMode(false);
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    }
  }, [branch, toast]);

  const saveFile = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", `${API}/contents/${fileContent!.path}`, {
        content: editContent,
        message: commitMsg || `Update ${fileContent!.path}`,
        branch,
        sha: fileContent!.sha,
      });
    },
    onSuccess: () => {
      toast({ title: "Fichier sauvegardé" });
      setEditMode(false);
      setCommitMsg("");
      queryClient.invalidateQueries({ queryKey: [API, "tree", branch] });
      queryClient.invalidateQueries({ queryKey: [API, "commits"] });
      if (fileContent) openFile(fileContent.path);
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  if (fileContent) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setFileContent(null)} data-testid="button-back-files">
            <ArrowLeft className="w-4 h-4 mr-1" /> Retour
          </Button>
          <code className="text-xs text-muted-foreground">{fileContent.path}</code>
          <div className="flex-1" />
          {!editMode ? (
            <Button size="sm" onClick={() => setEditMode(true)} data-testid="button-edit-file">
              <Code className="w-3.5 h-3.5 mr-1" /> Éditer
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                placeholder="Message du commit"
                value={commitMsg}
                onChange={e => setCommitMsg(e.target.value)}
                className="w-48 h-8 text-xs"
              />
              <Button size="sm" onClick={() => saveFile.mutate()} disabled={saveFile.isPending} data-testid="button-save-file">
                {saveFile.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                <span className="ml-1">Sauver</span>
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setEditMode(false); setEditContent(fileContent.content); }}>
                Annuler
              </Button>
            </div>
          )}
        </div>
        {editMode ? (
          <Textarea
            value={editContent}
            onChange={e => setEditContent(e.target.value)}
            className="font-mono text-xs min-h-[400px]"
            data-testid="textarea-edit-file"
          />
        ) : (
          <ScrollArea className="h-[400px] rounded-md border">
            <pre className="p-4 text-xs font-mono whitespace-pre-wrap">{fileContent.content}</pre>
          </ScrollArea>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input value={branch} onChange={e => setBranch(e.target.value)} className="w-32" />
        {currentPath.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setCurrentPath(p => p.slice(0, -1))} data-testid="button-nav-up">
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
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <div className="space-y-1">
          {items.map(item => {
            const name = item.path.split("/").pop()!;
            const isDir = item.type === "tree";
            return (
              <div
                key={item.path}
                className="flex items-center gap-2 p-2 rounded-md hover:bg-muted cursor-pointer text-sm"
                onClick={() => isDir ? setCurrentPath(item.path.split("/")) : openFile(item.path)}
                data-testid={`file-item-${name}`}
              >
                {isDir ? <Folder className="w-4 h-4 text-blue-400" /> : <File className="w-4 h-4 text-muted-foreground" />}
                <span className="flex-1">{name}</span>
                {item.size && <span className="text-xs text-muted-foreground">{(item.size / 1024).toFixed(1)}KB</span>}
              </div>
            );
          })}
          {items.length === 0 && (
            <p className="text-center text-muted-foreground py-8 text-sm">Dossier vide</p>
          )}
        </div>
      )}
    </div>
  );
}

function DevOpsChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [threadId, setThreadId] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const handleSend = useCallback(async () => {
    const msg = input.trim();
    if (!msg || isLoading) return;
    setInput("");
    setIsLoading(true);

    const userMsg: ChatMessage = { role: "user", content: msg };
    setMessages(prev => [...prev, userMsg]);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000);

      const response = await fetch("/api/v2/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({
          message: `[DEVOPS-MAX CONTEXT] Repo: ulyssemdbh-commits/devmax (${REPO_URL})\n\n${msg}`,
          threadId,
          sessionContext: "alfred",
        }),
      });

      clearTimeout(timeout);

      if (!response.ok) throw new Error(`Erreur serveur: ${response.status}`);

      const contentType = response.headers.get("content-type") || "";

      if (contentType.includes("text/event-stream")) {
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let fullContent = "";
        const assistantMsg: ChatMessage = { role: "assistant", content: "" };
        setMessages(prev => [...prev, assistantMsg]);

        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split("\n")) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === "start") setThreadId(data.threadId);
                else if (data.type === "chunk") {
                  fullContent += data.content;
                  setMessages(prev => prev.map((m, i) => i === prev.length - 1 ? { ...m, content: fullContent } : m));
                }
              } catch {}
            }
          }
        }
      } else {
        const data = await response.json();
        if (data.threadId) setThreadId(data.threadId);
        const reply = data.response || data.message || data.text || "Pas de réponse.";
        setMessages(prev => [...prev, { role: "assistant", content: reply }]);
      }
    } catch (e: any) {
      const errorMsg = e.name === "AbortError" ? "La requête a pris trop de temps. Réessayez avec une question plus simple." : `Erreur de communication: ${e.message || "vérifiez votre connexion."}`;
      setMessages(prev => [...prev, { role: "assistant", content: errorMsg }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, threadId, isLoading]);

  return (
    <div className="flex flex-col h-[500px]">
      <div className="flex items-center gap-2 mb-3">
        <Bot className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">Max DevOps Assistant</span>
        <Badge variant="secondary" className="text-xs">devmax</Badge>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => { setMessages([]); setThreadId(null); }} data-testid="button-clear-devops-chat">
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>
      <ScrollArea className="flex-1 rounded-md border p-3" ref={scrollRef}>
        <div className="space-y-3">
          {messages.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm space-y-2">
              <Terminal className="w-8 h-8 mx-auto opacity-50" />
              <p>Demandez-moi n'importe quoi sur le repo devmax</p>
              <div className="flex flex-wrap justify-center gap-2 mt-3">
                {["Status du repo", "Derniers commits", "Créer une branche feature", "Analyser le code"].map(s => (
                  <Button key={s} variant="outline" size="sm" className="text-xs" onClick={() => setInput(s)} data-testid={`button-suggestion-${s.replace(/\s/g, '-')}`}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={cn("text-sm p-3 rounded-lg", msg.role === "user" ? "bg-primary/10 ml-8" : "bg-muted mr-8")}>
              <p className="text-xs text-muted-foreground mb-1">{msg.role === "user" ? "Vous" : "Max"}</p>
              <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
            </div>
          ))}
          {isLoading && messages[messages.length - 1]?.role === "user" && (
            <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Max réfléchit...
            </div>
          )}
        </div>
      </ScrollArea>
      <form onSubmit={e => { e.preventDefault(); handleSend(); }} className="flex items-center gap-2 mt-3">
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Commande DevOps..."
          disabled={isLoading}
          className="flex-1"
          data-testid="input-devops-chat"
        />
        <Button type="submit" size="icon" disabled={!input.trim() || isLoading} data-testid="button-send-devops">
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </div>
  );
}

function RollbackTab() {
  const { toast } = useToast();
  const [branch, setBranch] = useState("main");
  const [selectedSha, setSelectedSha] = useState<string | null>(null);

  const { data: commits, isLoading } = useQuery<Commit[]>({
    queryKey: [API, "commits", branch, "rollback"],
    queryFn: () => fetch(`${API}/commits?branch=${branch}&per_page=15`, { credentials: "include" }).then(r => r.json()),
  });

  const rollback = useMutation({
    mutationFn: () => apiRequest("POST", `${API}/rollback`, { branch, targetSha: selectedSha, createBackup: true }),
    onSuccess: (data: any) => {
      toast({ title: "Rollback effectué", description: `Backup: ${data.backupBranch || "N/A"}` });
      setSelectedSha(null);
      queryClient.invalidateQueries({ queryKey: [API] });
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input value={branch} onChange={e => setBranch(e.target.value)} className="w-40" placeholder="Branche" />
        {selectedSha && (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => rollback.mutate()}
            disabled={rollback.isPending}
            data-testid="button-confirm-rollback"
          >
            {rollback.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <RotateCcw className="w-3.5 h-3.5 mr-1" />}
            Rollback vers {selectedSha.slice(0, 7)}
          </Button>
        )}
      </div>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <div className="space-y-1">
          {commits?.map((c, i) => (
            <div
              key={c.sha}
              className={cn(
                "flex items-center gap-3 p-2 rounded-md text-sm cursor-pointer transition-colors",
                selectedSha === c.sha ? "bg-destructive/10 border border-destructive/30" : "hover:bg-muted",
                i === 0 && "opacity-50 cursor-not-allowed"
              )}
              onClick={() => i > 0 && setSelectedSha(selectedSha === c.sha ? null : c.sha)}
              data-testid={`rollback-commit-${c.sha.slice(0, 7)}`}
            >
              <GitCommit className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="flex-1 truncate">{c.commit.message.split("\n")[0]}</span>
              <code className="text-xs text-muted-foreground font-mono">{c.sha.slice(0, 7)}</code>
              <span className="text-xs text-muted-foreground">{timeAgo(c.commit.author.date)}</span>
              {i === 0 && <Badge variant="secondary" className="text-xs">HEAD</Badge>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DevOpsMax() {
  const [activeTab, setActiveTab] = useState("overview");

  const { data: repo, isLoading: repoLoading } = useQuery<any>({
    queryKey: [API, "repo"],
    queryFn: () => fetch(`${API}/repo`, { credentials: "include" }).then(r => r.json()),
  });

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center">
              <Terminal className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-semibold flex items-center gap-2">
                DevOpsMax
                {repo && <Badge variant="outline" className="text-xs font-mono">{repo.default_branch || "main"}</Badge>}
              </h2>
              <p className="text-xs text-muted-foreground">ulyssemdbh-commits/devmax</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {repo && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {repo.language && <Badge variant="secondary">{repo.language}</Badge>}
              </div>
            )}
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="outline" data-testid="button-open-github">
                <ExternalLink className="w-3.5 h-3.5 mr-1" /> GitHub
              </Button>
            </a>
          </div>
        </div>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full justify-start flex-wrap">
          <TabsTrigger value="overview" className="text-xs gap-1" data-testid="tab-overview">
            <Activity className="w-3.5 h-3.5" /> Vue d'ensemble
          </TabsTrigger>
          <TabsTrigger value="branches" className="text-xs gap-1" data-testid="tab-branches">
            <GitBranch className="w-3.5 h-3.5" /> Branches
          </TabsTrigger>
          <TabsTrigger value="commits" className="text-xs gap-1" data-testid="tab-commits">
            <GitCommit className="w-3.5 h-3.5" /> Commits
          </TabsTrigger>
          <TabsTrigger value="prs" className="text-xs gap-1" data-testid="tab-prs">
            <GitPullRequest className="w-3.5 h-3.5" /> PRs
          </TabsTrigger>
          <TabsTrigger value="cicd" className="text-xs gap-1" data-testid="tab-cicd">
            <Play className="w-3.5 h-3.5" /> CI/CD
          </TabsTrigger>
          <TabsTrigger value="files" className="text-xs gap-1" data-testid="tab-files">
            <FileCode className="w-3.5 h-3.5" /> Fichiers
          </TabsTrigger>
          <TabsTrigger value="chat" className="text-xs gap-1" data-testid="tab-devops-chat">
            <Bot className="w-3.5 h-3.5" /> Chat IA
          </TabsTrigger>
          <TabsTrigger value="rollback" className="text-xs gap-1" data-testid="tab-rollback">
            <RotateCcw className="w-3.5 h-3.5" /> Rollback
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab repo={repo} repoLoading={repoLoading} />
        </TabsContent>
        <TabsContent value="branches" className="mt-4">
          <BranchesTab />
        </TabsContent>
        <TabsContent value="commits" className="mt-4">
          <CommitsTab />
        </TabsContent>
        <TabsContent value="prs" className="mt-4">
          <PullRequestsTab />
        </TabsContent>
        <TabsContent value="cicd" className="mt-4">
          <CICDTab />
        </TabsContent>
        <TabsContent value="files" className="mt-4">
          <FileBrowserTab />
        </TabsContent>
        <TabsContent value="chat" className="mt-4">
          <DevOpsChat />
        </TabsContent>
        <TabsContent value="rollback" className="mt-4">
          <RollbackTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OverviewTab({ repo, repoLoading }: { repo: any; repoLoading: boolean }) {
  const { data: branches } = useQuery<Branch[]>({
    queryKey: [API, "branches"],
    queryFn: () => fetch(`${API}/branches`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: commits } = useQuery<Commit[]>({
    queryKey: [API, "commits", "main", "overview"],
    queryFn: () => fetch(`${API}/commits?branch=main&per_page=5`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: pulls } = useQuery<PullRequest[]>({
    queryKey: [API, "pulls", "open", "overview"],
    queryFn: () => fetch(`${API}/pulls?state=open`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: runs } = useQuery<{ workflow_runs: WorkflowRun[] }>({
    queryKey: [API, "actions", "runs", "overview"],
    queryFn: () => fetch(`${API}/actions/runs`, { credentials: "include" }).then(r => r.json()),
  });

  if (repoLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  const lastRun = runs?.workflow_runs?.[0];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><GitBranch className="w-4 h-4" /> Branches</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{branches?.length || 0}</p>
          <div className="mt-2 space-y-1">
            {branches?.slice(0, 3).map(b => (
              <div key={b.name} className="flex items-center gap-2 text-xs">
                <GitBranch className="w-3 h-3 text-green-500" />
                <span className="font-mono">{b.name}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><GitPullRequest className="w-4 h-4" /> Pull Requests</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{pulls?.length || 0} <span className="text-sm font-normal text-muted-foreground">ouvertes</span></p>
          <div className="mt-2 space-y-1">
            {pulls?.slice(0, 3).map(pr => (
              <div key={pr.number} className="text-xs truncate">
                <span className="text-muted-foreground">#{pr.number}</span> {pr.title}
              </div>
            ))}
            {(!pulls || pulls.length === 0) && <p className="text-xs text-muted-foreground">Aucune PR ouverte</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Activity className="w-4 h-4" /> CI/CD</CardTitle>
        </CardHeader>
        <CardContent>
          {lastRun ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                {lastRun.conclusion === "success" ? <CheckCircle className="w-5 h-5 text-green-500" /> :
                 lastRun.conclusion === "failure" ? <XCircle className="w-5 h-5 text-red-500" /> :
                 <Loader2 className="w-5 h-5 animate-spin text-yellow-500" />}
                <span className="text-sm font-medium">{lastRun.name}</span>
              </div>
              <p className="text-xs text-muted-foreground">#{lastRun.run_number} · {lastRun.head_branch} · {timeAgo(lastRun.created_at)}</p>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">Aucun workflow</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><GitCommit className="w-4 h-4" /> Derniers commits</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {commits?.slice(0, 4).map(c => (
              <div key={c.sha} className="text-xs">
                <div className="flex items-center gap-2">
                  <code className="text-muted-foreground font-mono">{c.sha.slice(0, 7)}</code>
                  <span className="truncate flex-1">{c.commit.message.split("\n")[0]}</span>
                </div>
                <span className="text-muted-foreground">{timeAgo(c.commit.author.date)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {repo?.description && (
        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{repo.description}</p>
            {repo.languages && Object.keys(repo.languages).length > 0 && (
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                {Object.entries(repo.languages).map(([lang, bytes]: [string, any]) => (
                  <Badge key={lang} variant="outline" className="text-xs">{lang}</Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
