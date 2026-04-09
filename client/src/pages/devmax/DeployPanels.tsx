import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { LivePreviewPanel, ProjectDatabasePanel } from "./InfraPanels";
import { motion } from "framer-motion";
import {
  RefreshCw,
  ExternalLink,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Play,
  RotateCcw,
  StopCircle,
  ChevronRight,
  Activity,
  Rocket,
  Zap,
  Shield,
  GitFork,
  HardDrive,
  Lock,
  Upload,
  Globe,
  ArrowRight,
  ArrowUpCircle,
  Key,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  API,
  devmaxQueryClient,
  devmaxFetch,
  devmaxApiRequest,
  useDevmaxAuth,
  WorkflowRun,
  timeAgo,
} from "./types";

export function DeployPanel() {
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
            ? `${data.stagingUrl}\nSource: Fichiers Tests (DB)`
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
            {lastDeployResult.method === "db-files" && (
              <span className="text-xs text-cyan-400 flex items-center gap-1">
                <HardDrive className="w-3 h-3" /> Source: Fichiers Tests (DB)
              </span>
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

      <ProjectDatabasePanel projectId={pid} />

      <LivePreviewPanel stagingUrl={status?.stagingUrl || null} productionUrl={status?.productionUrl || null} projectId={pid} />
    </div>
  );
}

export function DeployRollbackSection({ pid }: { pid: string }) {
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

export function CICDPanel() {
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

  const cicdActive = activeProject?.cicd_enabled !== false;
  const hasWebhook = !!activeProject?.webhook_id;

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

