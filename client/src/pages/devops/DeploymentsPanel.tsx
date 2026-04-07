import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DeployedApp } from "./types";
import { timeAgo } from "./helpers";
import {
  RefreshCw,
  ExternalLink,
  Clock,
  Loader2,
  RotateCcw,
  Trash2,
  Rocket,
  Terminal,
  X,
  Globe,
  Cpu,
  HardDrive,
  Server,
} from "lucide-react";

export function DeploymentsPanel() {
  const { toast } = useToast();
  const [logsApp, setLogsApp] = useState<string | null>(null);
  const [logsContent, setLogsContent] = useState<string>("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [restartingApp, setRestartingApp] = useState<string | null>(null);
  const [deletingApp, setDeletingApp] = useState<string | null>(null);

  const { data: deployments, isLoading, refetch } = useQuery<DeployedApp[]>({
    queryKey: ["/api/devops/server/deployments"],
    staleTime: 15000,
    refetchInterval: 30000,
  });

  const loadLogs = useCallback(async (appName: string) => {
    setLogsApp(appName);
    setLogsLoading(true);
    try {
      const res = await fetch(`/api/devops/server/app/${appName}/logs?lines=40`, { credentials: "include" });
      const data = await res.json();
      setLogsContent(data.logs || "Pas de logs");
    } catch {
      setLogsContent("Erreur de chargement");
    }
    setLogsLoading(false);
  }, []);

  const restartApp = useCallback(async (appName: string) => {
    setRestartingApp(appName);
    try {
      const res = await fetch(`/api/devops/server/app/${appName}/restart`, { method: "POST", credentials: "include" });
      const data = await res.json();
      if (data.output) {
        toast({ title: "Redemarree", description: appName });
        setTimeout(() => refetch(), 3000);
      }
    } catch {
      toast({ title: "Erreur", description: "Echec du redemarrage", variant: "destructive" });
    }
    setRestartingApp(null);
  }, [toast, refetch]);

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
        setTimeout(() => refetch(), 2000);
      } else {
        toast({ title: "Erreur", description: data.error || "Echec de la suppression", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Impossible de supprimer l'app", variant: "destructive" });
    }
    setDeletingApp(null);
  }, [toast, refetch]);

  const activeStatuses = ["online", "static", "deployed"];
  const activeApps = deployments?.filter(a => activeStatuses.includes(a.status)) || [];
  const offlineApps = deployments?.filter(a => !activeStatuses.includes(a.status)) || [];

  return (
    <div className="space-y-4" data-testid="deployments-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Rocket className="w-5 h-5 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">Deployments *.ulyssepro.org</h2>
            <p className="text-[11px] text-muted-foreground">Hetzner AX42 — 65.21.209.102</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] h-5">
            {activeApps.length} en ligne
          </Badge>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => refetch()} data-testid="button-refresh-deployments">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Connexion au serveur...
        </div>
      ) : !deployments?.length ? (
        <Card className="p-6 text-center">
          <Server className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">Aucune app deployee</p>
          <p className="text-[11px] text-muted-foreground mt-1">Demande a Ulysse de deployer un projet</p>
        </Card>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {[...activeApps, ...offlineApps].map((app) => {
            const isUlysse = app.name === "ulysse";
            const appDomain = app.domain || (isUlysse ? "ulyssepro.org" : `${app.name}.ulyssepro.org`);
            const fullUrl = `https://${appDomain}`;
            const uptimeStr = app.uptime ? timeAgo(app.uptime) : null;
            const isActive = activeStatuses.includes(app.status);

            return (
              <Card
                key={app.name}
                className={cn(
                  "overflow-hidden transition-colors",
                  isActive ? "hover:border-green-500/30" : "hover:border-red-500/30 opacity-80"
                )}
                data-testid={`card-deployment-${app.name}`}
              >
                <div className={cn(
                  "h-1",
                  isActive ? "bg-green-500" : app.status === "stopping" ? "bg-yellow-500" : "bg-red-500"
                )} />
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className={cn(
                        "w-2 h-2 rounded-full shrink-0",
                        isActive ? "bg-green-500 animate-pulse" : "bg-red-500"
                      )} />
                      <h3 className="font-semibold text-sm truncate" data-testid={`text-deploy-name-${app.name}`}>
                        {app.name}
                      </h3>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge variant="outline" className="text-[8px] h-4">
                        {app.type === "static" ? "HTML" : "Node"}
                      </Badge>
                      <Badge
                        variant={isActive ? "default" : "destructive"}
                        className="text-[9px] h-4"
                      >
                        {app.status}
                      </Badge>
                    </div>
                  </div>

                  <a
                    href={fullUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-[11px] text-primary hover:underline mb-2 truncate"
                    onClick={(e) => e.stopPropagation()}
                    data-testid={`link-deployment-${app.name}`}
                  >
                    <Globe className="w-3 h-3 shrink-0" />
                    <span className="truncate">{appDomain}</span>
                    <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-50" />
                  </a>

                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-2">
                    {app.type === "node" && (
                      <>
                        <span className="flex items-center gap-1">
                          <Cpu className="w-2.5 h-2.5" /> {app.cpu}%
                        </span>
                        <span className="flex items-center gap-1">
                          <HardDrive className="w-2.5 h-2.5" /> {app.memory}
                        </span>
                      </>
                    )}
                    {app.type === "static" && (
                      <span className="flex items-center gap-1">
                        <Globe className="w-2.5 h-2.5" /> Nginx
                      </span>
                    )}
                    {app.port && (
                      <span className="flex items-center gap-1">
                        :{app.port}
                      </span>
                    )}
                    {app.restarts > 0 && (
                      <span className="flex items-center gap-1 text-yellow-600">
                        <RotateCw className="w-2.5 h-2.5" /> {app.restarts}
                      </span>
                    )}
                  </div>

                  {uptimeStr && (
                    <p className="text-[10px] text-muted-foreground mb-2">
                      <Clock className="w-2.5 h-2.5 inline mr-0.5" /> Depuis {uptimeStr}
                    </p>
                  )}

                  <div className="flex items-center gap-1 border-t border-border pt-2 mt-1">
                    {app.type === "node" && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[10px] px-2 gap-1"
                          onClick={() => loadLogs(app.name)}
                          disabled={logsLoading && logsApp === app.name}
                          data-testid={`button-deploy-logs-${app.name}`}
                        >
                          <Terminal className="w-3 h-3" /> Logs
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[10px] px-2 gap-1"
                          onClick={() => restartApp(app.name)}
                          disabled={restartingApp === app.name}
                          data-testid={`button-deploy-restart-${app.name}`}
                        >
                          {restartingApp === app.name ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RotateCcw className="w-3 h-3" />
                          )}
                          Restart
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[10px] px-2 gap-1 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={(e) => { e.stopPropagation(); deleteApp(app.name); }}
                      disabled={deletingApp === app.name}
                      data-testid={`button-deploy-delete-${app.name}`}
                    >
                      {deletingApp === app.name ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Trash2 className="w-3 h-3" />
                      )}
                    </Button>
                    <a
                      href={fullUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto"
                      data-testid={`button-deploy-open-${app.name}`}
                    >
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 gap-1">
                        <ExternalLink className="w-3 h-3" /> Ouvrir
                      </Button>
                    </a>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {logsApp && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-zinc-950">
            <span className="text-xs font-mono text-zinc-300">
              <Terminal className="w-3 h-3 inline mr-1" />
              {logsApp} — logs
            </span>
            <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-zinc-400 hover:text-zinc-200" onClick={() => { setLogsApp(null); setLogsContent(""); }} data-testid="button-close-deploy-logs">
              <X className="w-3 h-3" />
            </Button>
          </div>
          {logsLoading ? (
            <div className="flex items-center gap-2 p-4 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Chargement...
            </div>
          ) : (
            <pre className="bg-zinc-950 text-zinc-300 p-3 text-[11px] font-mono max-h-[300px] overflow-auto whitespace-pre-wrap" data-testid="deploy-logs-content">
              {logsContent}
            </pre>
          )}
        </Card>
      )}
    </div>
  );
}

