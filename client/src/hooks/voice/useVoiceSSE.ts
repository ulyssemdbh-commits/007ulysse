import { useEffect, useRef, useCallback, useState } from "react";

export type SSEVoiceState = "idle" | "listening" | "thinking" | "speaking";

export interface VoiceSSEEvent {
  type: string;
  data: Record<string, any>;
}

interface UseVoiceSSEOptions {
  sessionId: string | null;
  enabled?: boolean;
  onStateChange?: (state: SSEVoiceState) => void;
  onTranscriptPartial?: (text: string) => void;
  onTranscriptFinal?: (text: string) => void;
  onResponseChunk?: (text: string) => void;
  onResponseFull?: (text: string, domain?: string) => void;
  onProgress?: (message: string, detail?: string) => void;
  onUIAction?: (action: string, data: any) => void;
  onSystemCommand?: (command: string, data: any) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
}

export function useVoiceSSE(options: UseVoiceSSEOptions) {
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<SSEVoiceState>("idle");
  const eventSourceRef = useRef<EventSource | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setConnected(false);
  }, []);

  const connect = useCallback((sessionId: string) => {
    disconnect();

    const url = `/api/voice/events/${sessionId}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      setConnected(true);
      reconnectAttemptsRef.current = 0;
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
      eventSourceRef.current = null;

      const attempts = reconnectAttemptsRef.current;
      const delay = Math.min(1000 * Math.pow(2, attempts), 15000);
      reconnectAttemptsRef.current = attempts + 1;

      if (optionsRef.current.sessionId) {
        reconnectTimeoutRef.current = window.setTimeout(() => {
          if (optionsRef.current.sessionId) {
            connect(optionsRef.current.sessionId);
          }
        }, delay);
      }
    };

    const addHandler = (eventType: string, handler: (data: any) => void) => {
      es.addEventListener(eventType, ((e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          handler(data);
        } catch {}
      }) as EventListener);
    };

    addHandler("connected", (data) => {
      setState(data.state || "idle");
    });

    addHandler("state_change", (data) => {
      const newState = data.to as SSEVoiceState;
      setState(newState);
      optionsRef.current.onStateChange?.(newState);
    });

    addHandler("transcript_partial", (data) => {
      optionsRef.current.onTranscriptPartial?.(data.text);
    });

    addHandler("transcript_final", (data) => {
      optionsRef.current.onTranscriptFinal?.(data.text);
    });

    addHandler("response_chunk", (data) => {
      optionsRef.current.onResponseChunk?.(data.text);
    });

    addHandler("response_full", (data) => {
      optionsRef.current.onResponseFull?.(data.text, data.domain);
    });

    addHandler("progress", (data) => {
      optionsRef.current.onProgress?.(data.message, data.detail);
    });

    addHandler("ui_action", (data) => {
      optionsRef.current.onUIAction?.(data.action, data.data);
    });

    addHandler("system_command", (data) => {
      optionsRef.current.onSystemCommand?.(data.command, data.data);
    });

    addHandler("error", (data) => {
      optionsRef.current.onError?.(data.message);
    });

    addHandler("done", () => {
      optionsRef.current.onDone?.();
    });

    addHandler("session_closed", () => {
      disconnect();
    });
  }, [disconnect]);

  useEffect(() => {
    const sid = options.sessionId;
    const enabled = options.enabled !== false;

    if (sid && enabled) {
      connect(sid);
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [options.sessionId, options.enabled, connect, disconnect]);

  return { connected, state, disconnect };
}
