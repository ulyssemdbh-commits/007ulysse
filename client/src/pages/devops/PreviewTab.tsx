import { RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  ArrowLeft,
  ArrowRight,
  RefreshCcw,
  Loader2,
  Lock,
  Shield,
  Globe,
  Code,
  Monitor,
  TabletSmartphone,
  Smartphone,
  Search,
  Palette,
  Zap,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Repo } from "./types";

export interface PreviewTabProps {
  selectedRepo: Repo;
  deployUrls: Record<string, string[]> | undefined;
  previewHtml: string;
  previewLoading: boolean;
  buildPreview: () => void;
  browserUrl: string;
  browserInputUrl: string;
  browserHistory: string[];
  browserHistoryIndex: number;
  browserLoading: boolean;
  browserViewport: "desktop" | "tablet" | "mobile";
  browserPageInfo: { title?: string; status?: number; favicon?: string; meta?: any; performance?: any } | null;
  browserSiteStatus: { reachable?: boolean; status?: number; statusText?: string; server?: string; ssl?: boolean } | null;
  browserIframeRef: RefObject<HTMLIFrameElement | null>;
  previewIframeRef: RefObject<HTMLIFrameElement | null>;
  setBrowserUrl: (v: string) => void;
  setBrowserInputUrl: (v: string) => void;
  setBrowserHistory: (v: string[]) => void;
  setBrowserHistoryIndex: (v: number) => void;
  setBrowserLoading: (v: boolean) => void;
  setBrowserViewport: (v: "desktop" | "tablet" | "mobile") => void;
  setChatExternalMessage: (v: string | null) => void;
  setPreviewHtml: (v: string) => void;
}

export function PreviewTab(props: PreviewTabProps) {
  const {
    selectedRepo, deployUrls, previewHtml, previewLoading, buildPreview,
    browserUrl, browserInputUrl, browserHistory, browserHistoryIndex,
    browserLoading, browserViewport, browserPageInfo, browserSiteStatus,
    browserIframeRef, previewIframeRef,
    setBrowserUrl, setBrowserInputUrl, setBrowserHistory, setBrowserHistoryIndex,
    setBrowserLoading, setBrowserViewport, setChatExternalMessage, setPreviewHtml,
  } = props;

  const allDeployUrls = deployUrls?.[selectedRepo.full_name] || [];
  const repoHomepage = selectedRepo.homepage || null;
  const ghPagesUrl = selectedRepo.has_pages
    ? `https://${selectedRepo.owner?.login || selectedRepo.full_name.split("/")[0]}.github.io/${selectedRepo.name}/`
    : null;
  const rawUrls = [
    ...allDeployUrls.filter(u => !u.includes(".replit.app") && !u.includes(".replit.dev")),
    ...(repoHomepage && !repoHomepage.includes(".replit.app") && !repoHomepage.includes(".replit.dev") && !allDeployUrls.includes(repoHomepage) ? [repoHomepage] : []),
    ...(ghPagesUrl && !allDeployUrls.includes(ghPagesUrl) ? [ghPagesUrl] : []),
  ];
  const availableUrls = [
    ...rawUrls.filter(u => u.includes(".ulyssepro.org")),
    ...rawUrls.filter(u => !u.includes(".ulyssepro.org")),
  ];
  const defaultUrl = availableUrls[0] || "";

  const navigateTo = (targetUrl: string) => {
    if (!targetUrl) return;
    let normalizedUrl = targetUrl.trim();
    if (normalizedUrl && !normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
      normalizedUrl = "https://" + normalizedUrl;
    }
    setBrowserUrl(normalizedUrl);
    setBrowserInputUrl(normalizedUrl);
    setBrowserLoading(true);
    const newHistory = browserHistory.slice(0, browserHistoryIndex + 1);
    newHistory.push(normalizedUrl);
    setBrowserHistory(newHistory);
    setBrowserHistoryIndex(newHistory.length - 1);
  };

  const goBack = () => {
    if (browserHistoryIndex > 0) {
      const newIndex = browserHistoryIndex - 1;
      setBrowserHistoryIndex(newIndex);
      const prevUrl = browserHistory[newIndex];
      setBrowserUrl(prevUrl);
      setBrowserInputUrl(prevUrl);
      setBrowserLoading(true);
    }
  };

  const goForward = () => {
    if (browserHistoryIndex < browserHistory.length - 1) {
      const newIndex = browserHistoryIndex + 1;
      setBrowserHistoryIndex(newIndex);
      const nextUrl = browserHistory[newIndex];
      setBrowserUrl(nextUrl);
      setBrowserInputUrl(nextUrl);
      setBrowserLoading(true);
    }
  };

  const refreshBrowser = () => {
    if (browserUrl) {
      setBrowserLoading(true);
      const iframe = browserIframeRef.current;
      if (iframe) {
        iframe.src = `/api/devops/proxy?url=${encodeURIComponent(browserUrl)}&_cb=${Date.now()}`;
      }
    }
  };

  const isHttps = browserUrl.startsWith("https://");
  const displayHost = (() => {
    try { return new URL(browserUrl).hostname; } catch { return ""; }
  })();
  const isUlyssePro = displayHost.endsWith(".ulyssepro.org");
  const canBrowse = !!browserUrl;

  const vpWidths = { desktop: "100%", tablet: "768px", mobile: "375px" };
  const vpHeight = { desktop: "640px", tablet: "640px", mobile: "667px" };

  return (
    <div className="space-y-0">
      <Card className="overflow-hidden rounded-xl border shadow-sm">
        <div className="bg-muted/60 dark:bg-muted/30 border-b px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-0.5">
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={browserHistoryIndex <= 0} onClick={goBack} data-testid="button-browser-back">
                <ArrowLeft className="w-3.5 h-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={browserHistoryIndex >= browserHistory.length - 1} onClick={goForward} data-testid="button-browser-forward">
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={refreshBrowser} disabled={!browserUrl} data-testid="button-browser-refresh">
                {browserLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />}
              </Button>
            </div>

            <div className="flex-1 flex items-center gap-1.5 bg-background rounded-md border px-2 py-1 h-7">
              {browserUrl && (
                <div className="flex items-center shrink-0">
                  {isHttps ? <Lock className="w-3 h-3 text-green-600 dark:text-green-400" /> : <Shield className="w-3 h-3 text-muted-foreground" />}
                </div>
              )}
              {browserSiteStatus && browserUrl && (
                <div className="flex items-center shrink-0" title={`HTTP ${browserSiteStatus.status || "?"} ${browserSiteStatus.statusText || ""}`}>
                  {browserSiteStatus.reachable ? (
                    <div className={cn("w-2 h-2 rounded-full", browserSiteStatus.status && browserSiteStatus.status < 400 ? "bg-green-500" : "bg-amber-500")} />
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                  )}
                </div>
              )}
              <input
                type="text"
                value={browserInputUrl}
                onChange={(e) => setBrowserInputUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") navigateTo(browserInputUrl); }}
                onFocus={(e) => e.target.select()}
                placeholder="Entrer une URL (ex: horlogemax.ulyssepro.org)"
                className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60 min-w-0"
                data-testid="input-browser-url"
              />
              {browserLoading && (
                <div className="w-3 h-3 shrink-0">
                  <div className="w-full h-full border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                </div>
              )}
            </div>

            <div className="flex items-center gap-0.5 shrink-0">
              <div className="flex items-center border rounded-md overflow-hidden h-7">
                {([
                  { key: "desktop" as const, icon: Monitor, title: "Desktop" },
                  { key: "tablet" as const, icon: TabletSmartphone, title: "Tablet (768px)" },
                  { key: "mobile" as const, icon: Smartphone, title: "Mobile (375px)" },
                ]).map(({ key, icon: Icon, title }) => (
                  <button
                    key={key}
                    onClick={() => setBrowserViewport(key)}
                    title={title}
                    className={cn(
                      "h-full px-1.5 transition-colors",
                      browserViewport === key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                    )}
                    data-testid={`button-viewport-${key}`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </button>
                ))}
              </div>
              <Button size="sm" variant="ghost" className="h-7 text-xs px-2 gap-1" title="Crawl & SEO"
                onClick={() => {
                  const analyzeUrl = browserUrl || defaultUrl;
                  const repoName = selectedRepo?.full_name || "";
                  setChatExternalMessage(analyzeUrl
                    ? `Analyse et crawle en temps réel le site déployé ${analyzeUrl} du repo ${repoName}. Vérifie le statut HTTP, la structure HTML, le SEO, les erreurs éventuelles et donne-moi un rapport complet.`
                    : `Crawle l'aperçu du repo ${repoName} et donne-moi un rapport complet (statut, SEO, erreurs).`);
                }}
                disabled={!browserUrl && !defaultUrl} data-testid="button-crawl-preview"
              >
                <Search className="w-3 h-3" />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs px-2 gap-1" title="Analyser le design (Vision IA)"
                onClick={() => {
                  const analyzeUrl = browserUrl || defaultUrl;
                  const repoName = selectedRepo?.full_name || "";
                  setChatExternalMessage(analyzeUrl
                    ? `Utilise analyze_preview pour prendre un screenshot du site ${analyzeUrl} (repo ${repoName}) et analyser le design visuel complet : esthétique, UI/UX, couleurs, layout, typographie, accessibilité. Donne-moi un rapport design détaillé avec des suggestions d'amélioration.`
                    : `Analyse le design visuel du site déployé du repo ${repoName} avec analyze_preview. Rapport complet UI/UX.`);
                }}
                disabled={!browserUrl && !defaultUrl} data-testid="button-analyze-design"
              >
                <Palette className="w-3 h-3" />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs px-2 gap-1" title="Améliorer automatiquement"
                onClick={() => {
                  const analyzeUrl = browserUrl || defaultUrl;
                  const repoName = selectedRepo?.full_name || "";
                  setChatExternalMessage(`Analyse le site ${analyzeUrl || "déployé"} du repo ${repoName} avec analyze_preview, puis applique automatiquement les améliorations design (couleurs, espacements, typographie, responsive) directement via apply_patch sur le repo. Fais les changements toi-même.`);
                }}
                disabled={!browserUrl && !defaultUrl} data-testid="button-auto-improve"
              >
                <Zap className="w-3 h-3" />
              </Button>
              {browserUrl && (
                <a href={browserUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent" data-testid="link-preview-external">
                  <ExternalLink className="w-3 h-3 text-muted-foreground" />
                </a>
              )}
            </div>
          </div>

          {availableUrls.length > 1 && (
            <div className="flex items-center gap-1 mt-1 px-1 flex-wrap">
              {availableUrls.map((u, i) => {
                let hostname = "";
                try { hostname = new URL(u).hostname; } catch { hostname = u; }
                const isActive = browserUrl === u;
                const isUP = hostname.endsWith(".ulyssepro.org");
                return (
                  <button
                    key={i}
                    onClick={() => navigateTo(u)}
                    className={cn(
                      "text-[10px] px-2 py-0.5 rounded-full border transition-colors",
                      isActive
                        ? "bg-primary/10 border-primary/30 text-primary"
                        : "bg-transparent border-transparent text-muted-foreground hover:bg-muted hover:border-border",
                      isUP && !isActive && "border-green-500/20 text-green-600 dark:text-green-400"
                    )}
                    data-testid={`button-quick-url-${i}`}
                  >
                    {isUP && <span className="mr-0.5">●</span>}
                    {hostname}
                  </button>
                );
              })}
            </div>
          )}

          {browserPageInfo?.title && browserUrl && (
            <div className="flex items-center gap-1.5 mt-1 px-1">
              <span className="text-[10px] text-muted-foreground truncate">{browserPageInfo.title}</span>
              {browserPageInfo.performance && (
                <span className="text-[9px] text-muted-foreground/60 shrink-0">
                  {browserPageInfo.performance.domElements} el · {browserPageInfo.performance.images} img · {browserPageInfo.performance.scripts} js
                </span>
              )}
            </div>
          )}
        </div>

        {canBrowse && browserUrl ? (
          <div className={cn("w-full flex justify-center bg-[#1a1a2e]", browserViewport !== "desktop" && "py-3")}>
            <iframe
              ref={browserIframeRef}
              src={`/api/devops/proxy?url=${encodeURIComponent(browserUrl)}`}
              className={cn(
                "border-0 bg-white transition-all duration-300",
                browserViewport === "desktop" && "w-full",
                browserViewport !== "desktop" && "rounded-lg shadow-xl border border-white/10"
              )}
              style={{
                width: vpWidths[browserViewport],
                height: vpHeight[browserViewport],
                maxWidth: "100%",
              }}
              title="Apercu navigateur"
              onLoad={() => setBrowserLoading(false)}
              onError={() => setBrowserLoading(false)}
              data-testid="iframe-preview-live"
            />
          </div>
        ) : !browserUrl ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
            <Globe className="w-10 h-10 opacity-30" />
            <p className="text-sm">Aucune URL de deploiement configuree</p>
            <p className="text-[11px] text-muted-foreground/70 max-w-sm text-center">
              Tapez une URL dans la barre d'adresse ou configurez les URLs de deploiement du repo
            </p>
            <Button size="sm" variant="outline" className="h-7 text-xs mt-1"
              onClick={() => { setPreviewHtml(""); buildPreview(); }}
              disabled={previewLoading}
            >
              {previewLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Code className="w-3 h-3 mr-1" />}
              Charger depuis les sources
            </Button>
            {previewLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Construction...
              </div>
            )}
            {previewHtml && (
              <div className="w-full px-2 pb-2">
                <iframe ref={previewIframeRef} srcDoc={previewHtml} sandbox="allow-scripts" className="w-full border rounded-lg" style={{ height: "450px" }} title="Apercu source" data-testid="iframe-preview" />
              </div>
            )}
          </div>
        ) : null}

        {browserUrl && (
          <div className="flex items-center justify-between px-3 py-1.5 bg-muted/40 border-t text-[10px] text-muted-foreground">
            <div className="flex items-center gap-2">
              {isUlyssePro && (
                <Badge variant="outline" className="text-[9px] h-3.5 px-1.5 border-green-500/30 text-green-600">
                  ulyssepro.org
                </Badge>
              )}
              {browserSiteStatus && (
                <Badge
                  variant="outline"
                  className={cn("text-[9px] h-3.5 px-1.5",
                    browserSiteStatus.reachable && browserSiteStatus.status && browserSiteStatus.status < 400
                      ? "border-green-500/30 text-green-600"
                      : browserSiteStatus.reachable
                        ? "border-amber-500/30 text-amber-600"
                        : "border-red-500/30 text-red-600"
                  )}
                  data-testid="badge-http-status"
                >
                  {browserSiteStatus.reachable ? `HTTP ${browserSiteStatus.status}` : "Hors ligne"}
                </Badge>
              )}
              <span>{displayHost}</span>
              {browserSiteStatus?.server && (
                <span className="text-muted-foreground/50">{browserSiteStatus.server}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isHttps && (
                <span className="text-green-600 dark:text-green-400 flex items-center gap-0.5">
                  <Lock className="w-2.5 h-2.5" /> SSL
                </span>
              )}
              <span className="text-muted-foreground/50">
                {browserViewport === "desktop" ? "Desktop" : browserViewport === "tablet" ? "768px" : "375px"}
              </span>
              <span>{browserHistory.length} page{browserHistory.length > 1 ? "s" : ""}</span>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
