import { useCallback, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface UseSessionOptions {
  onSessionExpired?: () => void;
  checkIntervalMs?: number;
}

export function useSession(options: UseSessionOptions = {}) {
  const { 
    onSessionExpired,
    checkIntervalMs = 5 * 60 * 1000 
  } = options;
  
  const queryClient = useQueryClient();
  const lastActivityRef = useRef(Date.now());
  const isRefreshingRef = useRef(false);

  const updateActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  const checkSession = useCallback(async () => {
    if (isRefreshingRef.current) return;
    
    try {
      const response = await fetch("/api/auth/me", {
        credentials: "include",
        headers: { "Cache-Control": "no-cache" }
      });
      
      if (!response.ok) {
        console.log("[Session] Session expired");
        onSessionExpired?.();
        return false;
      }
      
      return true;
    } catch (error) {
      console.error("[Session] Check failed:", error);
      return false;
    }
  }, [onSessionExpired]);

  const refreshSession = useCallback(async () => {
    if (isRefreshingRef.current) return false;
    isRefreshingRef.current = true;
    
    try {
      const response = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "include"
      });
      
      if (response.ok) {
        console.log("[Session] Refreshed successfully");
        lastActivityRef.current = Date.now();
        return true;
      }
      
      return false;
    } catch (error) {
      console.error("[Session] Refresh failed:", error);
      return false;
    } finally {
      isRefreshingRef.current = false;
    }
  }, []);

  const invalidateSession = useCallback(async () => {
    queryClient.setQueryData(["/api/auth/me"], null);
    queryClient.removeQueries({ queryKey: ["/api/auth/me"] });
    
    await queryClient.invalidateQueries();
    
    console.log("[Session] Session invalidated via React Query");
  }, [queryClient]);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include"
      });
    } catch (error) {
      console.error("[Session] Logout request failed:", error);
    }
    
    await invalidateSession();
  }, [invalidateSession]);

  useEffect(() => {
    const events = ["mousedown", "keydown", "touchstart", "scroll"];
    
    const handler = () => updateActivity();
    events.forEach(event => window.addEventListener(event, handler, { passive: true }));
    
    return () => {
      events.forEach(event => window.removeEventListener(event, handler));
    };
  }, [updateActivity]);

  useEffect(() => {
    const interval = setInterval(async () => {
      const inactiveTime = Date.now() - lastActivityRef.current;
      
      if (inactiveTime > 10 * 60 * 1000) {
        const isValid = await checkSession();
        if (!isValid) {
          await invalidateSession();
        }
      }
    }, checkIntervalMs);
    
    return () => clearInterval(interval);
  }, [checkIntervalMs, checkSession, invalidateSession]);

  return {
    updateActivity,
    checkSession,
    refreshSession,
    invalidateSession,
    logout,
    lastActivityRef,
  };
}
