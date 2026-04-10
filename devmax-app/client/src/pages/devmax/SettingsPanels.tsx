import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import {
  GitBranch,
  GitCommit,
  GitPullRequest,
  RefreshCw,
  Plus,
  CheckCircle,
  XCircle,
  Loader2,
  Activity,
  Trash2,
  Terminal,
  Zap,
  Shield,
  Eye,
  Star,
  GitFork,
  Lock,
  CheckCircle2,
  Settings,
  Globe,
  Bell,
  Key,
  ScrollText,
  BellRing,
  EyeOff,
  AlertTriangle,
  WifiOff,
  Cloud,
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
  WorkflowRun,
  timeAgo,
} from "./types";

export function OverviewPanel({ repo, repoLoading }: { repo: any; repoLoading: boolean }) {
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

export function EnvVarsPanel() {
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

export function NotificationsPanel() {
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

export function CustomDomainsPanel() {
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
          Format: <code className="text-cyan-400">slug-dev.ulyssepro.org</code> (staging) / <code className="text-emerald-400">slug.ulyssepro.org</code> (production)
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

export function LogsPanel() {
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
