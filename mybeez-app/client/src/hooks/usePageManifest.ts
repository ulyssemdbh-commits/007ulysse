/**
 * Page Manifest Hook — Standalone myBeez.
 * Manages PWA manifest and page title.
 */
import { useEffect } from "react";

export function usePageManifest(opts?: { title?: string }) {
  useEffect(() => {
    if (opts?.title) {
      document.title = `${opts.title} — myBeez`;
    }
  }, [opts?.title]);
}
