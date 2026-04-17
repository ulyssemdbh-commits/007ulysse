import { useEffect, useCallback } from "react";
import { useLocation } from "wouter";

export interface AppNavigationCommand {
  action: "navigate" | "switch_tab" | "click_button" | "scroll_to" | "open_modal";
  page?: string;
  tab?: string;
  buttonId?: string;
  elementId?: string;
  modalId?: string;
}

const PAGE_ROUTES: Record<string, string> = {
  "accueil": "/",
  "home": "/",
  "dashboard": "/",
  "assistant": "/assistant",
  "devops": "/devops",
  "sports": "/sports/predictions",
  "predictions": "/sports/predictions",
  "paris": "/sports/predictions",
  "finances": "/finances",
  "bourse": "/finances",
  "emails": "/emails",
  "mail": "/emails",
  "projets": "/projects",
  "projects": "/projects",
  "taches": "/tasks",
  "tasks": "/tasks",
  "notes": "/notes",
  "brain": "/brain",
  "cerveau": "/brain",
  "diagnostics": "/diagnostics",
  "reglages": "/settings",
  "settings": "/settings",
  "securite": "/security",
  "security": "/security",
  "analytics": "/analytics",
  "insights": "/ulysse-insights",
  "ulysse-insights": "/ulysse-insights",
  "skills": "/skills",
  "skill": "/skills",
  "capacites": "/skills",
  "capacités": "/skills",
  "capabilities": "/skills",
  "traces": "/traces",
  "trace": "/traces",
  "logs": "/traces",
  "commax": "/commax",
  "cm": "/commax",
  "community-manager": "/commax",
  "screen-monitor": "/screen-monitor",
  "screenmonitor": "/screen-monitor",
  "monitoring": "/screen-monitor",
  "ecran": "/screen-monitor",
  "écran": "/screen-monitor",
  "suguval": "/suguval",
  "valentine": "/suguval",
  "val": "/suguval",
  "courses-suguval": "/courses/suguval",
  "sugumaillane": "/sugumaillane",
  "maillane": "/sugumaillane",
  "courses-sugumaillane": "/courses/sugumaillane",
  "iris": "/iris",
  "alfred": "/max",
  "max": "/max",
  "devmax": "/devmax",
  "devopsmax": "/devmax",
  "devops-max": "/devmax",
  "devops-iris": "/devops-iris",
  "talking": "/talking",
  "vocal": "/talking",
  "voix": "/talking",
  "parler": "/talking",
  "footalmanach": "/sports/predictions/footalmanach",
  "almanach": "/sports/predictions/footalmanach",
  "superchat": "/superchat",
  "super chat": "/superchat",
  "groupe": "/superchat",
  "iris-homework": "/iris-homework",
  "devoirs": "/iris-homework",
  "iris-files": "/iris-files",
  "iris-talking": "/iris-talking",
};

export function resolvePageRoute(page: string): string | null {
  const key = page.toLowerCase().trim().replace(/[\/\s]/g, "");
  if (PAGE_ROUTES[key]) return PAGE_ROUTES[key];
  if (page.startsWith("/")) return page;
  for (const [k, v] of Object.entries(PAGE_ROUTES)) {
    if (k.includes(key) || key.includes(k)) return v;
  }
  return null;
}

export function executeNavigationCommand(cmd: AppNavigationCommand, setLocation: (path: string) => void): string {
  switch (cmd.action) {
    case "navigate": {
      if (!cmd.page) return "Page non spécifiée";
      const route = resolvePageRoute(cmd.page);
      if (!route) return `Page "${cmd.page}" non trouvée`;
      setLocation(route);
      window.dispatchEvent(new CustomEvent("ulysse:navigate", { detail: { route } }));
      return `Navigation vers ${route}`;
    }
    case "switch_tab": {
      if (!cmd.tab) return "Onglet non spécifié";
      if (cmd.page) {
        const route = resolvePageRoute(cmd.page);
        if (route) setLocation(route);
      }
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("ulysse:switch-tab", { detail: { tab: cmd.tab } }));
      }, cmd.page ? 300 : 0);
      return `Basculement vers l'onglet "${cmd.tab}"`;
    }
    case "click_button": {
      if (!cmd.buttonId && !cmd.elementId) return "Aucun bouton spécifié";
      const targetId = cmd.buttonId || cmd.elementId;
      setTimeout(() => {
        const el = document.querySelector(`[data-testid="${targetId}"]`) as HTMLElement
          || document.querySelector(`#${targetId}`) as HTMLElement
          || document.querySelector(`[data-action="${targetId}"]`) as HTMLElement;
        if (el) {
          el.click();
          return;
        }
        const byText = Array.from(document.querySelectorAll("button, a, [role='button']")).find(
          (btn) => btn.textContent?.toLowerCase().includes((targetId || "").toLowerCase())
        ) as HTMLElement;
        if (byText) byText.click();
      }, 100);
      return `Clic sur "${targetId}"`;
    }
    case "scroll_to": {
      const id = cmd.elementId || cmd.buttonId;
      if (!id) return "Élément non spécifié";
      setTimeout(() => {
        const el = document.querySelector(`[data-testid="${id}"]`) || document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
      return `Scroll vers "${id}"`;
    }
    case "open_modal": {
      const modalId = cmd.modalId || cmd.buttonId;
      if (!modalId) return "Modal non spécifié";
      setTimeout(() => {
        const trigger = document.querySelector(`[data-testid="${modalId}"]`) as HTMLElement;
        if (trigger) trigger.click();
      }, 100);
      return `Ouverture de "${modalId}"`;
    }
    default:
      return `Action "${cmd.action}" non reconnue`;
  }
}

export function useAppNavigation() {
  const [, setLocation] = useLocation();

  const handleNavCommand = useCallback((event: Event) => {
    const customEvent = event as CustomEvent<AppNavigationCommand>;
    if (customEvent.detail) {
      executeNavigationCommand(customEvent.detail, setLocation);
    }
  }, [setLocation]);

  useEffect(() => {
    window.addEventListener("ulysse:app-navigate", handleNavCommand);
    return () => window.removeEventListener("ulysse:app-navigate", handleNavCommand);
  }, [handleNavCommand]);
}

export function useTabListener(
  setActiveTab: (tab: string) => void,
  validTabs?: string[],
  aliases?: Record<string, string>
) {
  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent).detail?.tab;
      if (!tab) return;
      const normalized = String(tab).toLowerCase().trim()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "");

      if (aliases && aliases[normalized]) {
        setActiveTab(aliases[normalized]);
        return;
      }
      if (!validTabs) {
        setActiveTab(normalized);
        return;
      }
      const exact = validTabs.find(t => t.toLowerCase() === normalized);
      if (exact) { setActiveTab(exact); return; }
      const fuzzy = validTabs.find(t => {
        const tn = t.toLowerCase();
        return tn.includes(normalized) || normalized.includes(tn);
      });
      if (fuzzy) setActiveTab(fuzzy);
    };
    window.addEventListener("ulysse:switch-tab", handler);
    return () => window.removeEventListener("ulysse:switch-tab", handler);
  }, [setActiveTab, validTabs, aliases]);
}
