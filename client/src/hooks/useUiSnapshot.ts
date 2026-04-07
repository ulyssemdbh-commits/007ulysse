import { useCallback, useEffect, useRef } from "react";
import { useLocation } from "wouter";

const DEBOUNCE_MS = 500;
const BATCH_INTERVAL_MS = 3000;

interface SnapshotData {
  actionType: string;
  currentPage: string;
  currentTab?: string;
  elementClicked?: string;
  visibleComponents?: string[];
  formState?: Record<string, unknown>;
  dialogOpen?: string;
  sidebarState?: string;
  scrollPosition?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  metadata?: Record<string, unknown>;
}

let pendingSnapshots: SnapshotData[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flushSnapshots() {
  if (pendingSnapshots.length === 0) return;
  const batch = [...pendingSnapshots];
  pendingSnapshots = [];

  for (const snap of batch) {
    try {
      await fetch("/api/ui-snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snap),
      });
    } catch {
    }
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushSnapshots();
  }, BATCH_INTERVAL_MS);
}

function queueSnapshot(data: SnapshotData) {
  pendingSnapshots.push(data);
  scheduleFlush();
}

function getElementIdentifier(el: HTMLElement): string {
  const testId = el.getAttribute("data-testid");
  if (testId) return testId;

  const tag = el.tagName.toLowerCase();
  const text = el.textContent?.trim().slice(0, 40) || "";
  const cls = el.className?.toString().split(" ").slice(0, 2).join(".") || "";
  return `${tag}${cls ? "." + cls : ""}${text ? `[${text}]` : ""}`;
}

function getVisibleComponents(): string[] {
  const components: string[] = [];
  const selectors = [
    "[data-testid]",
    "dialog[open]",
    "[role='dialog']",
    "[role='tabpanel']",
    "nav",
    "aside",
    "main",
    "form",
  ];
  for (const sel of selectors) {
    document.querySelectorAll(sel).forEach((el) => {
      const id = (el as HTMLElement).getAttribute("data-testid") ||
                 (el as HTMLElement).getAttribute("role") ||
                 el.tagName.toLowerCase();
      if (!components.includes(id)) components.push(id);
    });
    if (components.length > 30) break;
  }
  return components.slice(0, 30);
}

function getOpenDialog(): string | undefined {
  const dialog = document.querySelector("[role='dialog']") as HTMLElement;
  if (dialog) {
    return dialog.getAttribute("data-testid") ||
           dialog.querySelector("h2,h3")?.textContent?.trim().slice(0, 50) ||
           "dialog-open";
  }
  return undefined;
}

function getActiveTab(): string | undefined {
  const activeTab = document.querySelector("[role='tab'][aria-selected='true']") as HTMLElement;
  if (activeTab) {
    return activeTab.getAttribute("data-testid") ||
           activeTab.textContent?.trim().slice(0, 40);
  }
  return undefined;
}

export function useUiSnapshot() {
  const [location] = useLocation();
  const lastClickTime = useRef(0);

  const captureSnapshot = useCallback((actionType: string, elementClicked?: string) => {
    const snap: SnapshotData = {
      actionType,
      currentPage: location,
      currentTab: getActiveTab(),
      elementClicked,
      visibleComponents: getVisibleComponents(),
      dialogOpen: getOpenDialog(),
      scrollPosition: Math.round(window.scrollY),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
    queueSnapshot(snap);
  }, [location]);

  useEffect(() => {
    captureSnapshot("navigation");
  }, [location]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const now = Date.now();
      if (now - lastClickTime.current < DEBOUNCE_MS) return;
      lastClickTime.current = now;

      const target = e.target as HTMLElement;
      if (!target) return;

      const interactive = target.closest("button, a, [role='tab'], [role='menuitem'], input, select, [data-testid]") as HTMLElement;
      if (interactive) {
        captureSnapshot("click", getElementIdentifier(interactive));
      }
    };

    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === "Escape") {
        const now = Date.now();
        if (now - lastClickTime.current < DEBOUNCE_MS) return;
        lastClickTime.current = now;
        captureSnapshot("keypress", `key:${e.key}`);
      }
    };

    document.addEventListener("click", handleClick, { capture: true, passive: true });
    document.addEventListener("keydown", handleKeydown, { capture: true, passive: true });

    return () => {
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("keydown", handleKeydown, true);
    };
  }, [captureSnapshot]);

  return { captureSnapshot };
}
