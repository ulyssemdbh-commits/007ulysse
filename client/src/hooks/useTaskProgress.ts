import { useState, useEffect, useRef, useCallback } from "react";

export interface TaskProgress {
  taskId: string;
  stage: string;
  percentage: number;
  estimatedTimeRemaining?: number;
  currentStep?: string;
  totalSteps?: number;
  currentStepIndex?: number;
}

interface UseTaskProgressOptions {
  userId?: number;
}

export function useTaskProgress(options?: UseTaskProgressOptions) {
  const [activeTasks, setActiveTasks] = useState<Map<string, TaskProgress>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isConnectedRef = useRef(false);
  const userIdRef = useRef(options?.userId);

  useEffect(() => {
    userIdRef.current = options?.userId;
    
    // Send auth when userId becomes available after socket is already open
    if (options?.userId && wsRef.current?.readyState === WebSocket.OPEN && isConnectedRef.current) {
      wsRef.current.send(JSON.stringify({
        type: "auth",
        userId: options.userId,
        deviceId: "web-progress"
      }));
    }
  }, [options?.userId]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/sync`;

    try {
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        isConnectedRef.current = true;
        
        if (userIdRef.current) {
          wsRef.current?.send(JSON.stringify({
            type: "auth",
            userId: userIdRef.current,
            deviceId: "web-progress"
          }));
        }
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === "task.progress") {
            const progress = data.data as TaskProgress;
            
            setActiveTasks(prev => {
              const updated = new Map(prev);
              
              if (progress.stage === "complete" || progress.stage === "error") {
                setTimeout(() => {
                  setActiveTasks(p => {
                    const next = new Map(p);
                    next.delete(progress.taskId);
                    return next;
                  });
                }, 2000);
              }
              
              updated.set(progress.taskId, progress);
              return updated;
            });
          }
        } catch (error) {
          console.error("[TaskProgress] Error parsing message:", error);
        }
      };

      wsRef.current.onclose = () => {
        isConnectedRef.current = false;
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      };
    } catch (error) {
      console.error("[TaskProgress] Failed to connect:", error);
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
    }
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  const clearTask = useCallback((taskId: string) => {
    setActiveTasks(prev => {
      const updated = new Map(prev);
      updated.delete(taskId);
      return updated;
    });
  }, []);

  return {
    activeTasks: Array.from(activeTasks.values()),
    hasActiveTasks: activeTasks.size > 0,
    clearTask,
  };
}
