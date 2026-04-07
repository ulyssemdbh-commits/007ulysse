import { useState, useRef, useEffect, useCallback } from "react";
import type { Repo, TreeItem } from "./types";

interface PageInfo {
  title?: string;
  status?: number;
  favicon?: string;
  meta?: Record<string, string>;
  performance?: Record<string, number>;
}

interface SiteStatus {
  reachable?: boolean;
  status?: number;
  statusText?: string;
  server?: string;
  ssl?: boolean;
}

export function useBrowserPreview(
  selectedRepo: Repo | null,
  deployUrls: Record<string, string[]> | undefined,
  fileTree: { sha: string; tree: TreeItem[]; truncated: boolean } | undefined,
) {
  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  const browserIframeRef = useRef<HTMLIFrameElement>(null);
  const [browserUrl, setBrowserUrl] = useState<string>("");
  const [browserInputUrl, setBrowserInputUrl] = useState<string>("");
  const [browserHistory, setBrowserHistory] = useState<string[]>([]);
  const [browserHistoryIndex, setBrowserHistoryIndex] = useState(-1);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [browserViewport, setBrowserViewport] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [browserPageInfo, setBrowserPageInfo] = useState<PageInfo | null>(null);
  const [browserSiteStatus, setBrowserSiteStatus] = useState<SiteStatus | null>(null);
  const browserAutoLoaded = useRef<string>("");

  useEffect(() => {
    if (!selectedRepo || browserUrl) return;
    const allDeployUrls = deployUrls?.[selectedRepo.full_name] || [];
    const repoHomepage = selectedRepo.homepage || null;
    const ghPagesUrl = selectedRepo.has_pages
      ? `https://${selectedRepo.owner?.login || selectedRepo.full_name.split("/")[0]}.github.io/${selectedRepo.name}/`
      : null;
    const rawUrls = [
      ...allDeployUrls.filter((u: string) => !u.includes(".replit.app") && !u.includes(".replit.dev")),
      ...(repoHomepage && !repoHomepage.includes(".replit.app") && !repoHomepage.includes(".replit.dev") && !allDeployUrls.includes(repoHomepage) ? [repoHomepage] : []),
      ...(ghPagesUrl && !allDeployUrls.includes(ghPagesUrl) ? [ghPagesUrl] : []),
    ];
    const urls = [
      ...rawUrls.filter((u: string) => u.includes(".ulyssepro.org")),
      ...rawUrls.filter((u: string) => !u.includes(".ulyssepro.org")),
    ];
    const url = urls[0];
    if (!url) return;
    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
      normalizedUrl = "https://" + normalizedUrl;
    }
    setBrowserUrl(normalizedUrl);
    setBrowserInputUrl(normalizedUrl);
    setBrowserLoading(true);
    setBrowserHistory([normalizedUrl]);
    setBrowserHistoryIndex(0);
  }, [selectedRepo, deployUrls, browserUrl]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "devops-browser-navigate") {
        const newUrl = e.data.url;
        if (newUrl && newUrl !== browserUrl) {
          setBrowserUrl(newUrl);
          setBrowserInputUrl(newUrl);
          setBrowserLoading(true);
          const newHistory = browserHistory.slice(0, browserHistoryIndex + 1);
          newHistory.push(newUrl);
          setBrowserHistory(newHistory);
          setBrowserHistoryIndex(newHistory.length - 1);
        }
      }
      if (e.data?.type === "devops-browser-loaded") {
        setBrowserPageInfo({
          title: e.data.title,
          status: e.data.status,
          favicon: e.data.favicon,
          meta: e.data.meta,
          performance: e.data.performance,
        });
        setBrowserLoading(false);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [browserUrl, browserHistory, browserHistoryIndex]);

  useEffect(() => {
    if (!browserUrl) {
      setBrowserSiteStatus(null);
      setBrowserPageInfo(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`/api/devops/proxy/check?url=${encodeURIComponent(browserUrl)}`);
        const data = await resp.json();
        if (!cancelled) setBrowserSiteStatus(data);
      } catch {
        if (!cancelled) setBrowserSiteStatus({ reachable: false, status: 0, statusText: "Erreur reseau" });
      }
    })();
    return () => { cancelled = true; };
  }, [browserUrl]);

  const buildPreview = useCallback(async () => {
    if (!selectedRepo || !fileTree?.tree) return;
    setPreviewLoading(true);
    try {
      const tree = fileTree.tree;

      const hasPkgJson = tree.some(
        (f) => f.path === "package.json" && f.type === "blob",
      );
      const hasViteConfig = tree.some(
        (f) =>
          (f.path === "vite.config.ts" || f.path === "vite.config.js") &&
          f.type === "blob",
      );
      const hasNextConfig = tree.some(
        (f) =>
          (f.path === "next.config.js" ||
            f.path === "next.config.ts" ||
            f.path === "next.config.mjs") &&
          f.type === "blob",
      );
      const isBuildProject =
        hasPkgJson &&
        (hasViteConfig ||
          hasNextConfig ||
          tree.some((f) => f.path === "tsconfig.json"));

      const rootHtml = tree.find(
        (f) => f.path === "index.html" && f.type === "blob",
      );
      const anyHtml = tree.find(
        (f) => f.path.endsWith(".html") && f.type === "blob",
      );
      const htmlFile = rootHtml || (!isBuildProject ? anyHtml : null);

      if (!htmlFile) {
        const projectType = hasNextConfig
          ? "Next.js"
          : hasViteConfig
            ? "Vite"
            : hasPkgJson
              ? "Node.js"
              : null;
        const deployUrl =
          selectedRepo.homepage ||
          (selectedRepo.has_pages
            ? `https://${selectedRepo.owner?.login || selectedRepo.full_name.split("/")[0]}.github.io/${selectedRepo.name}/`
            : null);

        const msgHtml = projectType
          ? `<html><body style='font-family:system-ui;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;color:#666;margin:0;gap:16px;text-align:center;padding:40px'>
              <div style='font-size:40px'>🔧</div>
              <p style='font-size:16px;font-weight:600;color:#333'>Projet ${projectType}</p>
              <p style='font-size:13px;max-width:400px'>Ce projet necessite un serveur de developpement (<code>npm run dev</code>) pour fonctionner.</p>
              ${deployUrl ? `<a href="${deployUrl}" target="_blank" style='font-size:13px;color:#3b82f6;text-decoration:underline'>Voir le site deploye</a>` : '<p style="font-size:12px;color:#999">Aucun deploiement detecte</p>'}
            </body></html>`
          : "<html><body style='font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;color:#888;margin:0'><p>Aucun fichier HTML trouve dans ce repo</p></body></html>";
        setPreviewHtml(msgHtml);
        setPreviewLoading(false);
        return;
      }

      const decodeBase64Utf8 = (b64: string): string => {
        const binStr = atob(b64);
        const bytes = Uint8Array.from(binStr, (c) => c.charCodeAt(0));
        return new TextDecoder("utf-8").decode(bytes);
      };
      const fetchFile = async (path: string): Promise<string> => {
        const res = await fetch(
          `/api/devops/repos/${selectedRepo.full_name}/contents/${path}`,
          { credentials: "include" },
        );
        const data = await res.json();
        if (data.content)
          return decodeBase64Utf8(data.content.replace(/\n/g, ""));
        return "";
      };

      let html = await fetchFile(htmlFile.path);
      const cssFiles = tree.filter(
        (f) => f.type === "blob" && f.path.endsWith(".css"),
      );
      const jsFiles = tree.filter(
        (f) => f.type === "blob" && f.path.endsWith(".js"),
      );

      const [cssContents, jsContents] = await Promise.all([
        Promise.all(
          cssFiles.map((f) =>
            fetchFile(f.path).then((c) => ({ path: f.path, content: c })),
          ),
        ),
        Promise.all(
          jsFiles.map((f) =>
            fetchFile(f.path).then((c) => ({ path: f.path, content: c })),
          ),
        ),
      ]);

      for (const css of cssContents) {
        const linkPattern = new RegExp(
          `<link[^>]*href=["']${css.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*/?>`,
          "gi",
        );
        if (linkPattern.test(html)) {
          html = html.replace(linkPattern, `<style>${css.content}</style>`);
        } else {
          html = html.replace(
            "</head>",
            `<style>/* ${css.path} */\n${css.content}</style>\n</head>`,
          );
        }
      }

      for (const js of jsContents) {
        const scriptPattern = new RegExp(
          `<script[^>]*src=["']${js.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>\\s*</script>`,
          "gi",
        );
        if (scriptPattern.test(html)) {
          html = html.replace(scriptPattern, `<script>${js.content}</script>`);
        } else {
          html = html.replace(
            "</body>",
            `<script>/* ${js.path} */\n${js.content}</script>\n</body>`,
          );
        }
      }

      if (
        !html.includes("<meta charset") &&
        !html.includes('<meta http-equiv="Content-Type"')
      ) {
        html = html.replace(/<head>/i, '<head><meta charset="utf-8">');
        if (!html.includes("<head>") && !html.includes("<HEAD>")) {
          html = `<html><head><meta charset="utf-8"></head>${html}</html>`;
        }
      }
      setPreviewHtml(html);
    } catch {
      setPreviewHtml(
        "<html><head><meta charset='utf-8'></head><body style='font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;color:#c00;margin:0'><p>Erreur lors du chargement de l'apercu</p></body></html>",
      );
    }
    setPreviewLoading(false);
  }, [selectedRepo, fileTree]);

  const resetBrowserState = useCallback(() => {
    setBrowserUrl("");
    setBrowserInputUrl("");
    setBrowserHistory([]);
    setBrowserHistoryIndex(-1);
    setBrowserLoading(false);
    browserAutoLoaded.current = "";
    setPreviewHtml("");
  }, []);

  return {
    previewHtml, setPreviewHtml,
    previewLoading,
    previewIframeRef, browserIframeRef,
    browserUrl, setBrowserUrl,
    browserInputUrl, setBrowserInputUrl,
    browserHistory, setBrowserHistory,
    browserHistoryIndex, setBrowserHistoryIndex,
    browserLoading, setBrowserLoading,
    browserViewport, setBrowserViewport,
    browserPageInfo,
    browserSiteStatus,
    buildPreview,
    resetBrowserState,
  };
}
