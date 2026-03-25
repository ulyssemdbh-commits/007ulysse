import { useEffect, useRef, useCallback } from "react";
import { queryClient } from "@/lib/queryClient";

interface AutoReconnectOptions {
  onReconnect?: () => void;
  onDisconnect?: () => void;
  healthCheckInterval?: number;
  healthCheckUrl?: string;
}

export function useAutoReconnect(options: AutoReconnectOptions = {}) {
  const {
    onReconnect,
    onDisconnect,
    healthCheckInterval = 60000,
    healthCheckUrl = "/api/v2/health"
  } = options;

  const isConnectedRef = useRef(true);
  const lastActivityRef = useRef(Date.now());
  const healthCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectingRef = useRef(false);

  const checkConnection = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(healthCheckUrl, {
        method: "GET",
        credentials: "include",
        cache: "no-store"
      });
      return response.ok;
    } catch {
      return false;
    }
  }, [healthCheckUrl]);

  const handleReconnect = useCallback(async () => {
    if (reconnectingRef.current) return;
    reconnectingRef.current = true;

    console.log("[AutoReconnect] Checking server connection...");
    
    const isOnline = await checkConnection();
    
    if (isOnline) {
      if (!isConnectedRef.current) {
        console.log("[AutoReconnect] Reconnected to server");
        isConnectedRef.current = true;
        
        queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
        queryClient.invalidateQueries({ queryKey: ["/api/v2/conversations"] });
        window.dispatchEvent(new Event("force-reconnect"));
        
        onReconnect?.();
      }
    } else {
      if (isConnectedRef.current) {
        console.log("[AutoReconnect] Lost connection to server");
        isConnectedRef.current = false;
        onDisconnect?.();
      }
    }
    
    reconnectingRef.current = false;
  }, [checkConnection, onReconnect, onDisconnect]);

  const handleVisibilityChange = useCallback(() => {
    if (document.visibilityState === "visible") {
      const inactiveTime = Date.now() - lastActivityRef.current;
      console.log(`[AutoReconnect] Page visible after ${Math.round(inactiveTime / 1000)}s`);
      
      if (inactiveTime > 5000) {
        handleReconnect();
      }
    } else {
      lastActivityRef.current = Date.now();
    }
  }, [handleReconnect]);

  const handleOnline = useCallback(() => {
    console.log("[AutoReconnect] Network online, reconnecting...");
    handleReconnect();
  }, [handleReconnect]);

  const handleFocus = useCallback(() => {
    const inactiveTime = Date.now() - lastActivityRef.current;
    if (inactiveTime > 10000) {
      handleReconnect();
    }
    lastActivityRef.current = Date.now();
  }, [handleReconnect]);

  useEffect(() => {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    window.addEventListener("focus", handleFocus);

    healthCheckIntervalRef.current = setInterval(() => {
      if (document.visibilityState === "visible") {
        checkConnection().then(isOnline => {
          if (!isOnline && isConnectedRef.current) {
            isConnectedRef.current = false;
            onDisconnect?.();
          } else if (isOnline && !isConnectedRef.current) {
            isConnectedRef.current = true;
            queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
            queryClient.invalidateQueries({ queryKey: ["/api/v2/conversations"] });
            window.dispatchEvent(new Event("force-reconnect"));
            onReconnect?.();
          }
        });
      }
    }, healthCheckInterval);

    handleReconnect();

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("focus", handleFocus);
      if (healthCheckIntervalRef.current) {
        clearInterval(healthCheckIntervalRef.current);
      }
    };
  }, [handleVisibilityChange, handleOnline, handleFocus, handleReconnect, checkConnection, healthCheckInterval, onReconnect, onDisconnect]);

  return {
    isConnected: isConnectedRef.current,
    checkConnection: handleReconnect
  };
}
