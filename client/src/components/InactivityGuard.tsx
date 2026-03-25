import { useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";

const INACTIVITY_TIMEOUT_MS = 2 * 60 * 1000;

const EXEMPT_USERNAMES = new Set([
  "KellyIris001",
  "LennyIris002",
  "MickyIris003",
]);

const TRACKED_EVENTS: (keyof WindowEventMap)[] = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "click",
];

export function InactivityGuard() {
  const { user, isAuthenticated, logout } = useAuth();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoggingOut = useRef(false);

  const isExempt = !isAuthenticated || !user || user.isOwner || EXEMPT_USERNAMES.has(user.username);

  const handleLogout = useCallback(async () => {
    if (isLoggingOut.current) return;
    isLoggingOut.current = true;
    try {
      await logout();
      const path = window.location.pathname;
      const hasSuguInline = path === "/suguval" || path === "/sugumaillane";
      if (hasSuguInline) {
        window.location.reload();
      } else {
        window.location.href = "/login";
      }
    } catch {
      window.location.href = "/login";
    }
  }, [logout]);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(handleLogout, INACTIVITY_TIMEOUT_MS);
  }, [handleLogout]);

  useEffect(() => {
    if (isExempt) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    resetTimer();

    const handler = () => resetTimer();
    for (const event of TRACKED_EVENTS) {
      window.addEventListener(event, handler, { passive: true });
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const event of TRACKED_EVENTS) {
        window.removeEventListener(event, handler);
      }
    };
  }, [isExempt, resetTimer]);

  return null;
}
