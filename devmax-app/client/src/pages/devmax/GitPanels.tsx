import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import {
  GitBranch,
  GitCommit,
  GitPullRequest,
  RefreshCw,
  Plus,
  ExternalLink,
  Loader2,
  Trash2,
  Rocket,
  Shield,
  Merge,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  API,
  devmaxFetch,
  devmaxApiRequest,
  useDevmaxAuth,
  Branch,
  Commit,
  PullRequest,
  timeAgo,
} from "./types";

export function BranchesPanel() {
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

export function CommitsPanel() {
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

export function PullRequestsPanel() {
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
