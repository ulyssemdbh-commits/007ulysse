import { useEffect, useRef, useCallback, useState } from "react";

export interface SyncMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface ConversationMessageEvent {
  type: "conversation.message";
  userId: number;
  data: {
    threadId?: string;
    message: SyncMessage;
    origin: string;
  };
  timestamp: number;
}

interface UseConversationSyncOptions {
  userId?: number;
  deviceId?: string;
  accessToken?: string | null;
  onMessage?: (message: SyncMessage, origin: string, threadId?: string) => void;
  enabled?: boolean;
}

const PING_INTERVAL = 25000; // 25 seconds
const PONG_TIMEOUT = 10000; // 10 seconds to receive pong
const RECONNECT_BASE_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;

export function useConversationSync({
  userId,
  deviceId,
  accessToken,
  onMessage,
  enabled = true
}: UseConversationSyncOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pongTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const lastPingTimeRef = useRef<number>(0);
  const maxReconnectAttempts = 15;
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  const clearKeepAlive = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (pongTimeoutRef.current) {
      clearTimeout(pongTimeoutRef.current);
      pongTimeoutRef.current = null;
    }
  }, []);

  const startKeepAlive = useCallback(() => {
    clearKeepAlive();
    
    pingIntervalRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        lastPingTimeRef.current = Date.now();
        wsRef.current.send(JSON.stringify({ type: "ping", timestamp: lastPingTimeRef.current }));
        
        pongTimeoutRef.current = setTimeout(() => {
          console.log("[ConversationSync] Pong timeout - connection stale, reconnecting...");
          wsRef.current?.close();
        }, PONG_TIMEOUT);
      }
    }, PING_INTERVAL);
  }, [clearKeepAlive]);

  const sendMessage = useCallback((message: SyncMessage, threadId?: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN && isAuthenticated) {
      wsRef.current.send(JSON.stringify({
        type: "conversation.message",
        data: {
          threadId,
          message,
          origin: deviceId || "web"
        }
      }));
    }
  }, [isAuthenticated, deviceId]);

  const connect = useCallback(() => {
    if (!enabled || !userId) return;
    
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
      console.log("[ConversationSync] Max reconnect attempts reached");
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/sync`;

    try {
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log("[ConversationSync] Connected");
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
        
        startKeepAlive();
        
        wsRef.current?.send(JSON.stringify({
          type: "auth",
          token: accessToken || undefined,
          userId: accessToken ? undefined : userId,
          deviceId: deviceId || "web"
        }));
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === "pong") {
            if (pongTimeoutRef.current) {
              clearTimeout(pongTimeoutRef.current);
              pongTimeoutRef.current = null;
            }
            const rtt = Date.now() - lastPingTimeRef.current;
            setLatency(rtt);
            return;
          }
          
          if (data.type === "auth.success") {
            console.log("[ConversationSync] Authenticated with userId:", data.userId);
            setIsAuthenticated(true);
            return;
          }
          
          if (data.type === "auth.failed") {
            console.error("[ConversationSync] Auth failed:", data.error);
            setIsAuthenticated(false);
            return;
          }
          
          if (data.type === "conversation.message") {
            const msgEvent = data as ConversationMessageEvent;
            if (msgEvent.data.origin !== deviceId) {
              console.log(`[ConversationSync] Received message from ${msgEvent.data.origin}`);
              onMessageRef.current?.(
                msgEvent.data.message,
                msgEvent.data.origin,
                msgEvent.data.threadId
              );
            }
          }
        } catch (error) {
          console.error("[ConversationSync] Error parsing message:", error);
        }
      };

      wsRef.current.onclose = () => {
        setIsConnected(false);
        setIsAuthenticated(false);
        clearKeepAlive();
        reconnectAttemptsRef.current++;
        
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(1.5, reconnectAttemptsRef.current - 1), MAX_RECONNECT_DELAY);
          console.log(`[ConversationSync] Reconnecting in ${Math.round(delay/1000)}s (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})...`);
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        }
      };

      wsRef.current.onerror = () => {};
    } catch (error) {
      console.error("[ConversationSync] Failed to connect:", error);
      reconnectAttemptsRef.current++;
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(1.5, reconnectAttemptsRef.current - 1), MAX_RECONNECT_DELAY);
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      }
    }
  }, [enabled, userId, deviceId]);

  const forceReconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    connect();
  }, [connect]);

  useEffect(() => {
    if (enabled && userId) {
      connect();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && enabled && userId) {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          forceReconnect();
        }
      }
    };

    const handleOnline = () => {
      if (enabled && userId) {
        forceReconnect();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      
      clearKeepAlive();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [enabled, userId, connect, forceReconnect, clearKeepAlive]);

  return {
    isConnected,
    isAuthenticated,
    sendMessage,
    forceReconnect,
    latency
  };
}
