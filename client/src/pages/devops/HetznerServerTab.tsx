import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Repo } from "./types";
import { langColor } from "./helpers";
import {
  RefreshCw,
  Loader2,
  RotateCcw,
  Activity,
  Trash2,
  Terminal,
  X,
  Wifi,
  WifiOff,
  Cpu,
  HardDrive,
  Server,
  ArrowUpDown,
} from "lucide-react";

export function HetznerServerTab() {
  const { toast } = useToast();
  const [serverLogs, setServerLogs] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [restartingApp, setRestartingApp] = useState<string | null>(null);
  const [deletingApp, setDeletingApp] = useState<string | null>(null);
  const [cleanupResult, setCleanupResult] = useState<any>(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);

  const {
    data: serverStatus,
    isLoading: statusLoading,
    refetch: refetchStatus,
  } = useQuery<any>({
    queryKey: ["/api/devops/server/status"],
    staleTime: 20000,
    refetchInterval: 30000,
  });

  const {
    data: serverApps,
    isLoading: appsLoading,
    refetch: refetchApps,
  } = useQuery<any[]>({
    queryKey: ["/api/devops/server/apps"],
    staleTime: 10000,
    refetchInterval: 15000,
  });

  const runCleanup = useCallback(async (dryRun: boolean) => {
    setCleanupLoading(true);
    try {
      const res = await fetch("/api/devops/server/cleanup-orphans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ dryRun }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Erreur serveur", description: data.error || "Echec du scan", variant: "destructive" });
        setCleanupLoading(false);
        return;
      }
      setCleanupResult(data);
      if (!dryRun && data.deleted?.length > 0) {
        toast({ title: "Nettoyage termine", description: `${data.deleted.length} app(s) orpheline(s) supprimee(s)` });
        setTimeout(() => refetchApps(), 2000);
      } else if (dryRun) {
        toast({ title: "Scan termine", description: `${data.orphaned?.length || 0} app(s) orpheline(s) detectee(s)` });
      }
    } catch {
      toast({ title: "Erreur", description: "Echec du scan de nettoyage", variant: "destructive" });
    }
    setCleanupLoading(false);
  }, [toast, refetchApps]);

  const loadAppLogs = useCallback(async (appName: string) => {
    setLogsLoading(true);
    try {
      const res = await fetch(
        `/api/devops/server/app/${appName}/logs?lines=50`,
        { credentials: "include" },
      );
      const data = await res.json();
      setServerLogs(data.logs || "Pas de logs disponibles");
    } catch {
      setServerLogs("Erreur de chargement des logs");
    }
    setLogsLoading(false);
  }, []);

  const restartApp = useCallback(
    async (appName: string) => {
      setRestartingApp(appName);
      try {
        const res = await fetch(`/api/devops/server/app/${appName}/restart`, {
          method: "POST",
          credentials: "include",
        });
        const data = await res.json();
        if (data.success) {
          toast({
            title: "App redemarree",
            description: `${appName} a ete redemarree`,
          });
          setTimeout(() => refetchApps(), 3000);
        } else {
          toast({
            title: "Erreur",
            description: data.error || "Echec du redemarrage",
            variant: "destructive",
          });
        }
      } catch {
        toast({
          title: "Erreur",
          description: "Impossible de redemarrer l'app",
          variant: "destructive",
        });
      }
      setRestartingApp(null);
    },
    [toast, refetchApps],
  );

  const deleteApp = useCallback(async (appName: string) => {
    if (!confirm(`Supprimer "${appName}" ?\n\nCela va:\n- Supprimer le process PM2\n- Supprimer la config Nginx\n- Supprimer le dossier /var/www/apps/${appName}\n- Liberer les URLs Cloudflare (staging + prod)\n- Liberer les ports dedies`)) return;
    setDeletingApp(appName);
    try {
      const res = await fetch(`/api/devops/server/app/${appName}`, { method: "DELETE", credentials: "include" });
      const data = await res.json();
      if (data.success) {
        const d = data.details || {};
        const parts = [`${appName} supprimee`];
        if (d.cloudflareRemoved?.length) parts.push(`DNS: ${d.cloudflareRemoved.join(", ")}`);
        if (d.portsFreed) parts.push("Ports liberes");
        if (d.peerExists) parts.push(`⚠ "${d.peerName}" encore present`);
        toast({ title: "Supprimee", description: parts.join(" | ") });
        setTimeout(() => refetchApps(), 2000);
      } else {
        toast({ title: "Erreur", description: data.error || "Echec", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Impossible de supprimer", variant: "destructive" });
    }
    setDeletingApp(null);
  }, [toast, refetchApps]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Hetzner (ulyssepro.org)</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() => runCleanup(true)}
            disabled={cleanupLoading}
            data-testid="button-scan-orphans"
          >
            {cleanupLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            <span className="ml-1 text-xs">Orphelins</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() => {
              refetchStatus();
              refetchApps();
            }}
            data-testid="button-refresh-server"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {cleanupResult && (
        <Card className="p-3 border-orange-500/30 bg-orange-500/5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Scan orphelins: {cleanupResult.orphaned?.length || 0} detectee(s)</span>
            {cleanupResult.orphaned?.length > 0 && !cleanupResult.deleted?.length && (
              <Button size="sm" variant="destructive" className="h-6 text-xs" onClick={() => runCleanup(false)} disabled={cleanupLoading} data-testid="button-delete-orphans">
                Supprimer {cleanupResult.orphaned.length} orphelin(s)
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setCleanupResult(null)} data-testid="button-close-cleanup">X</Button>
          </div>
          {cleanupResult.orphaned?.length > 0 && (
            <div className="text-xs text-muted-foreground space-y-0.5">
              {cleanupResult.orphaned.map((name: string) => (
                <div key={name} className={cleanupResult.deleted?.includes(name) ? "line-through text-red-400" : ""}>{name}</div>
              ))}
            </div>
          )}
          {cleanupResult.errors?.length > 0 && (
            <div className="text-xs text-destructive mt-1">{cleanupResult.errors.join(", ")}</div>
          )}
          {cleanupResult.deleted?.length > 0 && (
            <div className="text-xs text-green-500 mt-1">{cleanupResult.deleted.length} app(s) supprimee(s) avec succes</div>
          )}
        </Card>
      )}

      {statusLoading ? (
        <div className="flex items-center gap-2 py-3 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Connexion...
        </div>
      ) : serverStatus?.error ? (
        <Card className="p-3 border-destructive/30 bg-destructive/5">
          <div className="flex items-center gap-2 text-destructive text-sm">
            <WifiOff className="w-4 h-4" /> Serveur inaccessible
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {serverStatus.error}
          </p>
        </Card>
      ) : serverStatus ? (
        <div className="grid grid-cols-4 gap-2">
          {[
            {
              icon: Wifi,
              color: "text-green-500",
              label: "Statut",
              value: "En ligne",
              valueColor: "text-green-600",
            },
            {
              icon: Cpu,
              color: "text-blue-500",
              label: "CPU",
              value: serverStatus.cpu || "N/A",
            },
            {
              icon: HardDrive,
              color: "text-purple-500",
              label: "RAM",
              value: serverStatus.memory || "N/A",
            },
            {
              icon: HardDrive,
              color: "text-orange-500",
              label: "Disque",
              value: serverStatus.disk || "N/A",
            },
          ].map((s, i) => (
            <Card key={i} className="p-2.5">
              <div className="flex items-center gap-1.5 mb-0.5">
                <s.icon className={cn("w-3 h-3", s.color)} />
                <span className="text-[9px] text-muted-foreground uppercase">
                  {s.label}
                </span>
              </div>
              <p className={cn("text-sm font-semibold", s.valueColor)}>
                {s.value}
              </p>
            </Card>
          ))}
        </div>
      ) : null}

      <div>
        <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-muted-foreground" />
          Applications PM2
        </h3>
        {appsLoading ? (
          <div className="flex items-center gap-2 py-3 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Chargement...
          </div>
        ) : (
          <div className="space-y-1.5">
            {(serverApps || []).map((app: any) => (
              <Card
                key={app.name}
                className="p-2.5"
                data-testid={`card-server-app-${app.name}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <div
                      className={cn(
                        "w-2 h-2 rounded-full shrink-0",
                        app.status === "online"
                          ? "bg-green-500"
                          : app.status === "stopping"
                            ? "bg-yellow-500"
                            : "bg-red-500",
                      )}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{app.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        CPU: {app.cpu || 0}% · RAM: {app.memory || "?"} ·
                        Restarts: {app.restarts || 0}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={() => loadAppLogs(app.name)}
                      disabled={logsLoading}
                      data-testid={`button-logs-${app.name}`}
                    >
                      <Terminal className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={() => restartApp(app.name)}
                      disabled={restartingApp === app.name}
                      data-testid={`button-restart-${app.name}`}
                    >
                      {restartingApp === app.name ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="w-3.5 h-3.5" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => deleteApp(app.name)}
                      disabled={deletingApp === app.name}
                      data-testid={`button-delete-${app.name}`}
                    >
                      {deletingApp === app.name ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </Button>
                    <Badge
                      variant={
                        app.status === "online" ? "default" : "destructive"
                      }
                      className="text-[10px] h-5"
                    >
                      {app.status}
                    </Badge>
                  </div>
                </div>
              </Card>
            ))}
            {!(serverApps || []).length && (
              <p className="text-muted-foreground text-sm">
                Aucune application PM2
              </p>
            )}
          </div>
        )}
      </div>

      {serverLogs !== null && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium">Logs</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={() => setServerLogs(null)}
              data-testid="button-close-server-logs"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
          <pre
            className="bg-zinc-950 text-zinc-300 rounded-lg p-3 text-[11px] font-mono max-h-[350px] overflow-auto whitespace-pre-wrap"
            data-testid="server-logs-content"
          >
            {serverLogs}
          </pre>
        </div>
      )}
    </div>
  );
}

export function QuickRepoSwitcher({
  repos,
  currentRepo,
  onSwitch,
}: {
  repos: Repo[];
  currentRepo: Repo;
  onSwitch: (repo: Repo) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    if (!search)
      return repos.filter((r) => r.id !== currentRepo.id).slice(0, 8);
    const q = search.toLowerCase();
    return repos
      .filter(
        (r) =>
          r.id !== currentRepo.id &&
          (r.name.toLowerCase().includes(q) ||
            r.full_name.toLowerCase().includes(q)),
      )
      .slice(0, 8);
  }, [repos, currentRepo, search]);

  return (
    <div className="relative">
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 gap-1 text-xs text-muted-foreground"
        onClick={() => setOpen(!open)}
        data-testid="button-switch-repo"
      >
        <ArrowUpDown className="w-3 h-3" /> Changer
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute top-full left-0 mt-1 z-50 w-72 rounded-lg border border-border bg-background shadow-xl p-2"
            data-testid="repo-switcher-dropdown"
          >
            <Input
              placeholder="Rechercher un repo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 text-xs mb-1.5"
              autoFocus
              data-testid="input-switch-repo-search"
            />
            <div className="max-h-48 overflow-y-auto space-y-0.5">
              {filtered.map((r) => (
                <button
                  key={r.id}
                  className="w-full text-left px-2 py-1.5 rounded-md hover:bg-muted flex items-center gap-2 transition-colors"
                  onClick={() => {
                    onSwitch(r);
                    setOpen(false);
                    setSearch("");
                  }}
                  data-testid={`switch-to-${r.name}`}
                >
                  <span
                    className={cn(
                      "w-2 h-2 rounded-full shrink-0",
                      langColor(r.language),
                    )}
                  />
                  <span className="text-xs font-medium truncate flex-1">
                    {r.name}
                  </span>
                  <Badge
                    variant={r.private ? "secondary" : "outline"}
                    className="text-[9px] h-4 shrink-0"
                  >
                    {r.private ? "P" : "O"}
                  </Badge>
                </button>
              ))}
              {!filtered.length && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Aucun autre repo
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
