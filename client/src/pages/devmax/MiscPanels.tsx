import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  GitCommit,
  GitPullRequest,
  RefreshCw,
  Plus,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Play,
  RotateCcw,
  Activity,
  Trash2,
  Rocket,
  Eye,
  Lock,
  AlertTriangle,
  DollarSign,
  History,
  HeartPulse,
  KeyRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  API,
  devmaxQueryClient,
  devmaxFetch,
  devmaxApiRequest,
  useDevmaxAuth,
  Commit,
  timeAgo,
} from "./types";

export function CostsDashboardPanel() {
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

export function GitHubEventsPanel() {
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

export function HealthChecksPanel() {
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

export function SecretsManagerPanel() {
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

export function DeployHistoryPanel() {
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

export function RollbackPanel() {
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
