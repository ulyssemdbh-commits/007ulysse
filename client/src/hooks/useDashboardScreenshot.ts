import { useCallback, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

function detectBrowserUrl(): string | null {
  if (window.location.pathname !== "/devops") return null;
  const iframe = document.querySelector('[data-testid="iframe-preview-live"]') as HTMLIFrameElement | null;
  if (!iframe) return null;
  const src = iframe.getAttribute("src") || "";
  const match = src.match(/[?&]url=([^&]+)/);
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch { return null; }
  }
  return null;
}

async function captureScreenshot(): Promise<string | null> {
  try {
    const html2canvas = (await import("html2canvas")).default;
    const canvas = await html2canvas(document.body, {
      scale: 0.5,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: null,
      width: window.innerWidth,
      height: window.innerHeight,
      x: window.scrollX,
      y: window.scrollY,
    });
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch (err) {
    console.error("[Screenshot] Capture failed:", err);
    return null;
  }
}

export function useDashboardScreenshot() {
  const { toast } = useToast();

  const takeAndSendScreenshot = useCallback(async (requestId?: string) => {
    const browserUrl = detectBrowserUrl();

    if (browserUrl) {
      toast({ title: "📸 Capture du site en cours...", description: `Ulysse analyse ${new URL(browserUrl).hostname}` });
    } else {
      toast({ title: "📸 Capture en cours...", description: "Ulysse prend un screenshot du dashboard" });
    }

    const dataUrl = browserUrl ? null : await captureScreenshot();
    if (!browserUrl && !dataUrl) {
      toast({ title: "Erreur", description: "Impossible de capturer le screenshot", variant: "destructive" });
      return;
    }

    try {
      const resp = await fetch("/api/dashboard-screenshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: dataUrl,
          browserUrl: browserUrl || undefined,
          requestId: requestId || `manual-${Date.now()}`,
          currentPage: window.location.pathname,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }),
      });
      const result = await resp.json();
      if (result.ok) {
        toast({ title: "Screenshot analyse", description: result.summary?.slice(0, 120) || "Analyse terminee" });
      }
    } catch (err) {
      console.error("[Screenshot] Send failed:", err);
    }
  }, [toast]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      console.log("[Screenshot] Command received from Ulysse");
      takeAndSendScreenshot(detail?.requestId);
    };
    window.addEventListener("ulysse:take-screenshot", handler);
    return () => window.removeEventListener("ulysse:take-screenshot", handler);
  }, [takeAndSendScreenshot]);

  return { takeAndSendScreenshot };
}
