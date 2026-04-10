import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  GitBranch,
  RefreshCw,
  ExternalLink,
  CheckCircle,
  XCircle,
  Loader2,
  Activity,
  Shield,
  Eye,
  GitFork,
  Minimize2,
  Maximize2,
  Lock,
  Globe,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  API,
  AUTH_API,
  DEVMAX_TOKEN_KEY,
  devmaxFetch,
  devmaxApiRequest,
  useDevmaxAuth,
} from "./types";

export function LivePreviewPanel({ stagingUrl, productionUrl }: { stagingUrl: string | null; productionUrl: string | null }) {
  const [previewMode, setPreviewMode] = useState<"staging" | "production" | "split">(stagingUrl ? "staging" : "production");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [iframeError, setIframeError] = useState<Record<string, boolean>>({});
  const [iframeLoading, setIframeLoading] = useState<Record<string, boolean>>({});
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const iframeRef2 = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => setRefreshKey(k => k + 1), 15000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  useEffect(() => {
    setIframeError({});
    setIframeLoading({});
  }, [refreshKey]);

  const handleIframeLoad = (key: string, ref: React.RefObject<HTMLIFrameElement | null>) => {
    setIframeLoading(prev => ({ ...prev, [key]: false }));
    try {
      const doc = ref.current?.contentDocument;
      if (doc && (doc.title === "" || doc.body?.innerText === "")) {
        setIframeError(prev => ({ ...prev, [key]: true }));
      }
    } catch {
      // cross-origin — iframe loaded but we can't inspect it, which is fine
    }
  };

  const handleIframeError = (key: string) => {
    setIframeLoading(prev => ({ ...prev, [key]: false }));
    setIframeError(prev => ({ ...prev, [key]: true }));
  };

  const startIframeLoad = (key: string) => {
    setIframeLoading(prev => ({ ...prev, [key]: true }));
    setTimeout(() => {
      setIframeLoading(prev => {
        if (prev[key]) return { ...prev, [key]: false };
        return prev;
      });
    }, 15000);
  };

  const activeUrl = previewMode === "production" ? productionUrl : stagingUrl;

  return (
    <Card className={cn("transition-all", isFullscreen && "fixed inset-0 z-50 rounded-none border-0 m-0")}>
      <CardContent className={cn("space-y-2", isFullscreen ? "p-3 h-full flex flex-col" : "p-4")}>
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <Eye className="w-4 h-4 text-cyan-400" /> Live Preview
            {autoRefresh && (
              <Badge variant="outline" className="text-[9px] border-emerald-500/50 text-emerald-400 animate-pulse">
                AUTO-REFRESH
              </Badge>
            )}
          </h4>
          <div className="flex items-center gap-1">
            {stagingUrl && productionUrl && (
              <div className="flex bg-muted/50 rounded-lg p-0.5 mr-2">
                <button
                  onClick={() => setPreviewMode("staging")}
                  className={cn("px-2 py-0.5 rounded-md text-[10px] font-medium transition-all", previewMode === "staging" ? "bg-amber-500/20 text-amber-400" : "text-muted-foreground hover:text-foreground")}
                  data-testid="button-preview-staging"
                >
                  Staging
                </button>
                <button
                  onClick={() => setPreviewMode("split")}
                  className={cn("px-2 py-0.5 rounded-md text-[10px] font-medium transition-all", previewMode === "split" ? "bg-cyan-500/20 text-cyan-400" : "text-muted-foreground hover:text-foreground")}
                  data-testid="button-preview-split"
                >
                  Split
                </button>
                <button
                  onClick={() => setPreviewMode("production")}
                  className={cn("px-2 py-0.5 rounded-md text-[10px] font-medium transition-all", previewMode === "production" ? "bg-emerald-500/20 text-emerald-400" : "text-muted-foreground hover:text-foreground")}
                  data-testid="button-preview-production"
                >
                  Production
                </button>
              </div>
            )}
            <Button
              size="icon"
              variant="ghost"
              className={cn("h-7 w-7 rounded-lg", autoRefresh && "text-emerald-400")}
              onClick={() => setAutoRefresh(!autoRefresh)}
              title={autoRefresh ? "Desactiver auto-refresh" : "Activer auto-refresh (15s)"}
              data-testid="button-toggle-auto-refresh"
            >
              <Activity className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 rounded-lg"
              onClick={() => setRefreshKey(k => k + 1)}
              title="Rafraichir la preview"
              data-testid="button-refresh-preview"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
            {activeUrl && previewMode !== "split" && (
              <a href={activeUrl} target="_blank" rel="noopener noreferrer">
                <Button size="icon" variant="ghost" className="h-7 w-7 rounded-lg" title="Ouvrir dans un nouvel onglet" data-testid="button-open-preview-tab">
                  <ExternalLink className="w-3.5 h-3.5" />
                </Button>
              </a>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 rounded-lg"
              onClick={() => setIsFullscreen(!isFullscreen)}
              title={isFullscreen ? "Quitter plein ecran" : "Plein ecran"}
              data-testid="button-toggle-fullscreen-preview"
            >
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>

        {previewMode === "split" ? (
          <div className={cn("grid grid-cols-1 sm:grid-cols-2 gap-2", isFullscreen ? "flex-1" : "")}>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-400">Staging</Badge>
                {stagingUrl && (
                  <a href={stagingUrl} target="_blank" rel="noopener noreferrer" className="text-[9px] text-muted-foreground hover:text-cyan-400 flex items-center gap-0.5">
                    <ExternalLink className="w-2.5 h-2.5" /> Ouvrir
                  </a>
                )}
              </div>
              <div className="rounded-lg overflow-hidden border border-amber-500/30 bg-black/50 relative">
                {iframeLoading["staging"] && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/70 z-10">
                    <div className="flex flex-col items-center gap-2">
                      <RefreshCw className="w-5 h-5 text-amber-400 animate-spin" />
                      <span className="text-[10px] text-muted-foreground">Chargement...</span>
                    </div>
                  </div>
                )}
                {iframeError["staging"] && stagingUrl && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
                    <div className="flex flex-col items-center gap-3 text-center p-4">
                      <AlertTriangle className="w-8 h-8 text-amber-400" />
                      <p className="text-xs text-muted-foreground max-w-[200px]">Le site ne peut pas etre affiche dans la preview (erreur serveur ou headers de securite)</p>
                      <a href={stagingUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 underline">
                        <ExternalLink className="w-3 h-3" /> Ouvrir dans un nouvel onglet
                      </a>
                    </div>
                  </div>
                )}
                <iframe
                  ref={iframeRef}
                  key={`staging-${refreshKey}`}
                  src={stagingUrl || "about:blank"}
                  className={cn("w-full border-0", isFullscreen ? "h-full" : "h-[350px]")}
                  title="Staging Preview"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  onLoad={() => { handleIframeLoad("staging", iframeRef); }}
                  onError={() => handleIframeError("staging")}
                  data-testid="iframe-staging-preview"
                />
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-[9px] border-emerald-500/50 text-emerald-400">Production</Badge>
                {productionUrl && (
                  <a href={productionUrl} target="_blank" rel="noopener noreferrer" className="text-[9px] text-muted-foreground hover:text-emerald-400 flex items-center gap-0.5">
                    <ExternalLink className="w-2.5 h-2.5" /> Ouvrir
                  </a>
                )}
              </div>
              <div className="rounded-lg overflow-hidden border border-emerald-500/30 bg-black/50 relative">
                {iframeLoading["production"] && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/70 z-10">
                    <div className="flex flex-col items-center gap-2">
                      <RefreshCw className="w-5 h-5 text-emerald-400 animate-spin" />
                      <span className="text-[10px] text-muted-foreground">Chargement...</span>
                    </div>
                  </div>
                )}
                {iframeError["production"] && productionUrl && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
                    <div className="flex flex-col items-center gap-3 text-center p-4">
                      <AlertTriangle className="w-8 h-8 text-emerald-400" />
                      <p className="text-xs text-muted-foreground max-w-[200px]">Le site ne peut pas etre affiche dans la preview (erreur serveur ou headers de securite)</p>
                      <a href={productionUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 underline">
                        <ExternalLink className="w-3 h-3" /> Ouvrir dans un nouvel onglet
                      </a>
                    </div>
                  </div>
                )}
                <iframe
                  ref={iframeRef2}
                  key={`production-${refreshKey}`}
                  src={productionUrl || "about:blank"}
                  className={cn("w-full border-0", isFullscreen ? "h-full" : "h-[350px]")}
                  title="Production Preview"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  onLoad={() => { handleIframeLoad("production", iframeRef2); }}
                  onError={() => handleIframeError("production")}
                  data-testid="iframe-production-preview"
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {activeUrl && (
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Globe className="w-3 h-3" />
                {activeUrl.replace("https://", "")}
              </p>
            )}
            <div className={cn(
              "rounded-lg overflow-hidden border bg-black/50 relative",
              previewMode === "staging" ? "border-amber-500/30" : "border-emerald-500/30"
            )}>
              {iframeLoading["single"] && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/70 z-10">
                  <div className="flex flex-col items-center gap-2">
                    <RefreshCw className="w-6 h-6 text-cyan-400 animate-spin" />
                    <span className="text-xs text-muted-foreground">Chargement de la preview...</span>
                  </div>
                </div>
              )}
              {iframeError["single"] && activeUrl && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
                  <div className="flex flex-col items-center gap-3 text-center p-6">
                    <AlertTriangle className="w-10 h-10 text-amber-400" />
                    <p className="text-sm text-muted-foreground max-w-[280px]">Le site ne peut pas etre affiche dans la preview. Il peut etre en erreur (502) ou bloquer l'affichage en iframe.</p>
                    <div className="flex items-center gap-3 mt-1">
                      <a href={activeUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 text-xs font-medium transition-colors">
                        <ExternalLink className="w-3.5 h-3.5" /> Ouvrir dans un nouvel onglet
                      </a>
                      <button onClick={() => { setIframeError(prev => ({ ...prev, single: false })); setRefreshKey(k => k + 1); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/50 text-muted-foreground hover:text-foreground text-xs font-medium transition-colors" data-testid="button-retry-preview">
                        <RefreshCw className="w-3.5 h-3.5" /> Reessayer
                      </button>
                    </div>
                  </div>
                </div>
              )}
              <iframe
                ref={iframeRef}
                key={`single-${previewMode}-${refreshKey}`}
                src={activeUrl || "about:blank"}
                className={cn("w-full border-0", isFullscreen ? "flex-1 h-full" : "h-[500px]")}
                title={`${previewMode} Preview`}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                onLoad={() => { handleIframeLoad("single", iframeRef); }}
                onError={() => handleIframeError("single")}
                data-testid={`iframe-${previewMode}-preview`}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function GitHubConnectionPanel() {
  const { toast } = useToast();
  const { activeProject } = useDevmaxAuth();
  const pid = activeProject?.id || "";
  const [patInput, setPatInput] = useState("");
  const [showPatInput, setShowPatInput] = useState(false);

  const { data: ghStatus, isLoading, refetch } = useQuery<{
    provider: string; user: string | null; scopes: string | null;
    connectedAt: string | null; hasToken: boolean; tokenValid: boolean; oauthAvailable: boolean;
  }>({
    queryKey: [AUTH_API, "github-status", pid],
    queryFn: () => devmaxFetch(`${AUTH_API}/github/status/${pid}`).then(r => r.json()),
    enabled: !!pid,
    refetchInterval: 60000,
  });

  const connectPat = useMutation({
    mutationFn: async () => {
      const res = await devmaxApiRequest("POST", `${AUTH_API}/github/pat`, { projectId: pid, pat: patInput });
      return res;
    },
    onSuccess: (data: any) => {
      toast({ title: "GitHub connecte", description: `Compte: ${data.githubUser}` });
      setPatInput("");
      setShowPatInput(false);
      refetch();
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const disconnect = useMutation({
    mutationFn: () => devmaxApiRequest("DELETE", `${AUTH_API}/github/disconnect/${pid}`, {}),
    onSuccess: () => {
      toast({ title: "GitHub deconnecte" });
      refetch();
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const startOAuth = async () => {
    try {
      const token = localStorage.getItem(DEVMAX_TOKEN_KEY);
      const res = await fetch(`${AUTH_API}/github/oauth/start?projectId=${pid}&token=${token}`);
      const data = await res.json();
      if (data.authUrl) {
        const popup = window.open(data.authUrl, "github-oauth", "width=600,height=700,left=200,top=100");
        const interval = setInterval(() => {
          if (popup?.closed) {
            clearInterval(interval);
            refetch();
          }
        }, 1000);
      } else {
        toast({ title: "Erreur OAuth", description: data.error || "Impossible de demarrer OAuth", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    }
  };

  const isConnected = ghStatus?.hasToken && ghStatus?.provider !== "owner" && ghStatus?.tokenValid;
  const isOwnerMode = !ghStatus?.hasToken || ghStatus?.provider === "owner";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Shield className="w-4 h-4 text-cyan-400" /> Connexion GitHub
        </h3>
        <Button size="icon" variant="ghost" className="rounded-xl" onClick={() => refetch()} data-testid="button-refresh-github">
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>
      ) : (
        <div className="space-y-3">
          <Card className={isConnected ? "border-emerald-500/30" : isOwnerMode ? "border-cyan-500/20" : "border-amber-500/30"}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {isConnected ? (
                    <CheckCircle className="w-5 h-5 text-emerald-400" />
                  ) : isOwnerMode ? (
                    <Shield className="w-5 h-5 text-cyan-400" />
                  ) : (
                    <XCircle className="w-5 h-5 text-amber-400" />
                  )}
                  <div>
                    <p className="text-sm font-medium">
                      {isConnected ? `Connecte: ${ghStatus?.user}` : isOwnerMode ? "Mode Owner (token global)" : "Token invalide"}
                    </p>
                    <p className="text-[10px] text-zinc-500">
                      {isConnected ? `via ${ghStatus?.provider === "oauth" ? "OAuth" : "Token personnel"} — ${ghStatus?.scopes || ""}` :
                       isOwnerMode ? "Utilise le token GitHub principal du serveur" : "Le token stocke n'est plus valide"}
                    </p>
                  </div>
                </div>
                {isConnected && (
                  <Button size="sm" variant="ghost" className="text-xs text-red-400 hover:text-red-300 rounded-xl"
                    onClick={() => disconnect.mutate()} disabled={disconnect.isPending}
                    data-testid="button-disconnect-github">
                    Deconnecter
                  </Button>
                )}
              </div>
              {ghStatus?.connectedAt && (
                <p className="text-[10px] text-zinc-500">Connecte le {new Date(ghStatus.connectedAt).toLocaleDateString("fr-FR")} a {new Date(ghStatus.connectedAt).toLocaleTimeString("fr-FR")}</p>
              )}
            </CardContent>
          </Card>

          <ConnectedReposSection pid={pid} />

          {!isConnected && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-400">
                Connectez un compte GitHub client pour que MaxAI puisse acceder a ses repos. Deux options :
              </p>

              {ghStatus?.oauthAvailable && (
                <Card className="border-gray-300 dark:border-zinc-700 hover:border-emerald-500/40 transition-all cursor-pointer" onClick={startOAuth}>
                  <CardContent className="p-4 flex items-center gap-3" data-testid="button-github-oauth">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center">
                      <ExternalLink className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Connexion OAuth GitHub</p>
                      <p className="text-[10px] text-zinc-500">Le client autorise MaxAI en un clic — recommande</p>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card className="border-gray-300 dark:border-zinc-700">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3 mb-3 cursor-pointer" onClick={() => setShowPatInput(!showPatInput)}>
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center">
                      <Lock className="w-5 h-5 text-amber-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Token Personnel (PAT)</p>
                      <p className="text-[10px] text-zinc-500">Le client fournit manuellement son token GitHub</p>
                    </div>
                  </div>
                  {showPatInput && (
                    <div className="space-y-2">
                      <Input
                        type="password"
                        value={patInput}
                        onChange={e => setPatInput(e.target.value)}
                        placeholder="ghp_xxxxxxxxxxxxx ou github_pat_xxxxx"
                        className="rounded-xl bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 font-mono text-sm"
                        data-testid="input-github-pat"
                      />
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] text-zinc-500">
                          Creer un PAT sur github.com/settings/tokens avec les scopes "repo" et "read:user"
                        </p>
                        <Button size="sm" className="rounded-xl bg-amber-600 hover:bg-amber-500 text-white"
                          onClick={() => connectPat.mutate()}
                          disabled={!patInput.trim() || connectPat.isPending}
                          data-testid="button-connect-pat">
                          {connectPat.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Connecter"}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ConnectedReposSection({ pid }: { pid: string }) {
  const { activeProject } = useDevmaxAuth();
  const { data: repos, isLoading } = useQuery<{
    production: { fullName: string; exists: boolean; accessible: boolean; private: boolean | null; defaultBranch?: string; language?: string; pushedAt?: string; url?: string; error?: string; role: string; deployUrl: string };
    staging: { fullName: string; exists: boolean; accessible: boolean; private: boolean | null; defaultBranch?: string; language?: string; pushedAt?: string; url?: string; error?: string; role: string; deployUrl: string; port?: number };
  }>({
    queryKey: [API, "connected-repos", pid],
    queryFn: () => devmaxFetch(`${API}/connected-repos`, undefined, pid).then(r => r.json()),
    enabled: !!pid && !!activeProject?.repo_owner,
    staleTime: 60000,
  });

  if (!activeProject?.repo_owner || isLoading) return null;
  if (!repos) return null;

  const RepoRow = ({ repo, color, icon }: { repo: typeof repos.production; color: string; icon: string }) => {
    const borderClass = color === "emerald" ? "border-emerald-500/20" : "border-amber-500/20";
    const bgClass = color === "emerald" ? "bg-emerald-500/5" : "bg-amber-500/5";
    const textClass = color === "emerald" ? "text-emerald-400" : "text-amber-400";
    const badgeClass = color === "emerald" ? "border-emerald-500/50 text-emerald-400" : "border-amber-500/50 text-amber-400";

    return (
      <div className={cn("rounded-lg border p-3 transition-all", borderClass, bgClass)} data-testid={`connected-repo-${repo.role}`}>
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <span className="text-sm">{icon}</span>
            <span className={cn("text-xs font-semibold uppercase tracking-wider", textClass)}>{repo.role === "production" ? "Production" : "Staging"}</span>
            {repo.accessible ? (
              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
            ) : repo.exists ? (
              <XCircle className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-zinc-500" />
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {repo.private !== null && (
              <Badge variant="outline" className={cn("text-[9px] h-4", repo.private ? "border-amber-500/50 text-amber-400" : "border-emerald-500/50 text-emerald-400")}>
                {repo.private ? "Privé" : "Public"}
              </Badge>
            )}
            <Badge variant="outline" className={cn("text-[9px] h-4", badgeClass)}>
              {repo.accessible ? "Connecté" : repo.exists ? "Inaccessible" : "Inexistant"}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a href={repo.url || `https://github.com/${repo.fullName}`} target="_blank" rel="noopener noreferrer" className="text-xs font-mono text-cyan-400 hover:text-cyan-300 hover:underline flex items-center gap-1" data-testid={`link-repo-${repo.role}`}>
            <GitBranch className="w-3 h-3" />
            {repo.fullName}
          </a>
          {repo.language && <Badge variant="secondary" className="text-[9px] h-4">{repo.language}</Badge>}
          {repo.defaultBranch && <span className="text-[10px] text-zinc-500">({repo.defaultBranch})</span>}
        </div>
        {repo.deployUrl && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <Globe className="w-3 h-3 text-zinc-500" />
            <a href={repo.deployUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-zinc-400 hover:text-cyan-400 font-mono truncate">{repo.deployUrl.replace("https://", "")}</a>
          </div>
        )}
        {repo.pushedAt && <p className="text-[10px] text-zinc-500 mt-1">Dernier push: {new Date(repo.pushedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>}
        {repo.error && <p className="text-[10px] text-red-400 mt-1">{repo.error}</p>}
      </div>
    );
  };

  return (
    <Card className="border-zinc-700/50">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <GitFork className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold">Repos connectés</span>
          <span className="text-[10px] text-zinc-500">({[repos.production, repos.staging].filter(r => r.accessible).length}/2 accessibles)</span>
        </div>
        <div className="space-y-2">
          <RepoRow repo={repos.production} color="emerald" icon="🟢" />
          <RepoRow repo={repos.staging} color="amber" icon="🟡" />
        </div>
      </CardContent>
    </Card>
  );
}

