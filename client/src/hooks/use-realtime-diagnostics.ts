import { useCallback, useRef, useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";

export type DiagnosticEventType = 
  | "voice_stt_error"
  | "voice_tts_error"
  | "voice_websocket_disconnect"
  | "voice_websocket_reconnect"
  | "voice_permission_denied"
  | "voice_no_speech"
  | "ui_button_unresponsive"
  | "ui_render_slow"
  | "api_error"
  | "api_timeout"
  | "network_offline"
  | "network_online"
  | "memory_high"
  | "audio_quality_poor"
  | "session_timeout"
  | "auto_fix_applied"
  | "wake_word_missed";

export type DiagnosticSeverity = "info" | "warning" | "error" | "critical";

export interface DiagnosticEvent {
  id: string;
  type: DiagnosticEventType;
  severity: DiagnosticSeverity;
  component: string;
  message: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
  autoFixAttempted?: boolean;
  autoFixSuccess?: boolean;
}

interface RealtimeDiagnosticsState {
  events: DiagnosticEvent[];
  activeIssues: DiagnosticEvent[];
  isOnline: boolean;
  lastHeartbeat: number;
  performanceScore: number;
}

const MAX_EVENTS = 100;
const HEARTBEAT_INTERVAL = 30000;

export function useRealtimeDiagnostics() {
  const { user } = useAuth();
  const [state, setState] = useState<RealtimeDiagnosticsState>({
    events: [],
    activeIssues: [],
    isOnline: navigator.onLine,
    lastHeartbeat: Date.now(),
    performanceScore: 100,
  });
  
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<number | null>(null);
  const pendingEventsRef = useRef<DiagnosticEvent[]>([]);
  const autoFixAttemptsRef = useRef<Map<string, number>>(new Map());

  const generateEventId = useCallback(() => {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  const calculateSeverity = useCallback((type: DiagnosticEventType): DiagnosticSeverity => {
    const severityMap: Record<DiagnosticEventType, DiagnosticSeverity> = {
      voice_stt_error: "error",
      voice_tts_error: "error",
      voice_websocket_disconnect: "warning",
      voice_websocket_reconnect: "info",
      voice_permission_denied: "critical",
      voice_no_speech: "info",
      ui_button_unresponsive: "warning",
      ui_render_slow: "warning",
      api_error: "error",
      api_timeout: "error",
      network_offline: "critical",
      network_online: "info",
      memory_high: "warning",
      audio_quality_poor: "warning",
      session_timeout: "error",
      auto_fix_applied: "info",
      wake_word_missed: "info",
    };
    return severityMap[type] || "info";
  }, []);

  const flushEventsRef = useRef<() => void>(() => {});
  
  const flushEvents = useCallback(() => {
    if (pendingEventsRef.current.length === 0) return;
    if (!user?.id) return;

    const events = [...pendingEventsRef.current];
    pendingEventsRef.current = [];

    fetch("/api/diagnostics/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
    }).then(res => {
      if (!res.ok && res.status !== 429) {
        pendingEventsRef.current.unshift(...events);
      }
    }).catch(() => {
      pendingEventsRef.current.unshift(...events);
    });
  }, [user?.id]);

  flushEventsRef.current = flushEvents;

  const logEvent = useCallback((
    type: DiagnosticEventType,
    component: string,
    message: string,
    metadata?: Record<string, unknown>
  ) => {
    const event: DiagnosticEvent = {
      id: generateEventId(),
      type,
      severity: calculateSeverity(type),
      component,
      message,
      timestamp: Date.now(),
      metadata,
    };

    setState(prev => {
      const newEvents = [event, ...prev.events].slice(0, MAX_EVENTS);
      const activeIssues = newEvents.filter(e => 
        e.severity === "error" || e.severity === "critical"
      ).slice(0, 10);
      
      const recentErrors = newEvents.filter(e => 
        (e.severity === "error" || e.severity === "critical") &&
        Date.now() - e.timestamp < 60000
      ).length;
      
      const performanceScore = Math.max(0, 100 - (recentErrors * 10));

      return {
        ...prev,
        events: newEvents,
        activeIssues,
        performanceScore,
      };
    });

    pendingEventsRef.current.push(event);
    flushEventsRef.current();

    return event;
  }, [generateEventId, calculateSeverity]);

  const attemptAutoFix = useCallback(async (
    type: DiagnosticEventType,
    fixFn: () => Promise<boolean>
  ): Promise<boolean> => {
    const key = type;
    const attempts = autoFixAttemptsRef.current.get(key) || 0;
    
    if (attempts >= 3) {
      logEvent(type, "auto-fix", `Auto-fix limit reached for ${type}`, { attempts });
      return false;
    }

    autoFixAttemptsRef.current.set(key, attempts + 1);

    try {
      const success = await fixFn();
      
      logEvent("auto_fix_applied", "auto-fix", 
        success ? `Successfully fixed ${type}` : `Failed to fix ${type}`,
        { originalIssue: type, success }
      );

      if (success) {
        autoFixAttemptsRef.current.delete(key);
      }

      return success;
    } catch (err) {
      logEvent("auto_fix_applied", "auto-fix", `Auto-fix error for ${type}: ${err}`, {
        originalIssue: type,
        error: String(err),
      });
      return false;
    }
  }, [logEvent]);

  const trackButtonClick = useCallback((buttonId: string, startTime: number) => {
    const duration = Date.now() - startTime;
    if (duration > 500) {
      logEvent("ui_button_unresponsive", "ui", 
        `Button "${buttonId}" took ${duration}ms to respond`,
        { buttonId, duration }
      );
    }
  }, [logEvent]);

  const trackApiCall = useCallback((
    endpoint: string,
    startTime: number,
    success: boolean,
    error?: string
  ) => {
    const duration = Date.now() - startTime;
    
    if (!success) {
      logEvent("api_error", "api", `API error: ${endpoint} - ${error}`, {
        endpoint,
        duration,
        error,
      });
    } else if (duration > 5000) {
      logEvent("api_timeout", "api", `Slow API response: ${endpoint} (${duration}ms)`, {
        endpoint,
        duration,
      });
    }
  }, [logEvent]);

  const autoFixInProgressRef = useRef<Set<string>>(new Set());

  const trackVoiceError = useCallback((
    errorType: "stt" | "tts" | "websocket" | "permission" | "no_speech",
    message: string,
    metadata?: Record<string, unknown>,
    fixFn?: () => Promise<boolean>
  ) => {
    const typeMap: Record<string, DiagnosticEventType> = {
      stt: "voice_stt_error",
      tts: "voice_tts_error",
      websocket: "voice_websocket_disconnect",
      permission: "voice_permission_denied",
      no_speech: "voice_no_speech",
    };
    
    const eventType = typeMap[errorType] as DiagnosticEventType;
    logEvent(eventType, "voice", message, metadata);

    if (fixFn && !autoFixInProgressRef.current.has(errorType)) {
      autoFixInProgressRef.current.add(errorType);
      attemptAutoFix(eventType, fixFn).finally(() => {
        autoFixInProgressRef.current.delete(errorType);
      });
    }
  }, [logEvent, attemptAutoFix]);

  const clearActiveIssue = useCallback((eventId: string) => {
    setState(prev => ({
      ...prev,
      activeIssues: prev.activeIssues.filter(e => e.id !== eventId),
    }));
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setState(prev => ({ ...prev, isOnline: true }));
      logEvent("network_online", "network", "Connection restored");
    };

    const handleOffline = () => {
      setState(prev => ({ ...prev, isOnline: false }));
      logEvent("network_offline", "network", "Connection lost");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [logEvent]);

  useEffect(() => {
    heartbeatRef.current = window.setInterval(() => {
      setState(prev => ({ ...prev, lastHeartbeat: Date.now() }));
      flushEvents();
    }, HEARTBEAT_INTERVAL);

    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
      }
    };
  }, [flushEvents]);

  useEffect(() => {
    if (typeof window !== "undefined" && "performance" in window) {
      const checkMemory = () => {
        const memory = (performance as any).memory;
        if (memory) {
          const usedMB = memory.usedJSHeapSize / (1024 * 1024);
          const limitMB = memory.jsHeapSizeLimit / (1024 * 1024);
          const usage = (usedMB / limitMB) * 100;
          
          if (usage > 80) {
            logEvent("memory_high", "performance", 
              `High memory usage: ${usage.toFixed(1)}%`,
              { usedMB, limitMB, usage }
            );
          }
        }
      };

      const memoryInterval = setInterval(checkMemory, 60000);
      return () => clearInterval(memoryInterval);
    }
  }, [logEvent]);

  return {
    events: state.events,
    activeIssues: state.activeIssues,
    isOnline: state.isOnline,
    performanceScore: state.performanceScore,
    logEvent,
    trackButtonClick,
    trackApiCall,
    trackVoiceError,
    attemptAutoFix,
    clearActiveIssue,
    flushEvents,
  };
}
