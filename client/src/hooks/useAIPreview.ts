import { useState, useEffect, useRef, useCallback } from "react";
import type { PreviewRequest } from "@/components/PreviewConfirmationCard";

interface UseAIPreviewOptions {
  userId?: number;
  onPreviewResponse?: (requestId: string, confirmed: boolean) => void;
}

export function useAIPreview(options?: UseAIPreviewOptions) {
  const [pendingPreview, setPendingPreview] = useState<PreviewRequest | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isConnectedRef = useRef(false);
  const userIdRef = useRef(options?.userId);

  useEffect(() => {
    userIdRef.current = options?.userId;
    
    if (options?.userId && wsRef.current?.readyState === WebSocket.OPEN && isConnectedRef.current) {
      wsRef.current.send(JSON.stringify({
        type: "auth",
        userId: options.userId,
        deviceId: "web-preview"
      }));
    }
  }, [options?.userId]);

  const connect = useCallback(() => {
    // Don't connect if already open or still connecting
    if (wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/sync`;

    try {
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        isConnectedRef.current = true;
        
        if (userIdRef.current) {
          // Verify WebSocket is actually open before sending
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: "auth",
              userId: userIdRef.current,
              deviceId: "web-preview"
            }));
          }
        }
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === "preview.request") {
            const preview = data.data as PreviewRequest;
            setPendingPreview(preview);
            setIsOpen(true);
          }
          
          // Handle lightbox.show events from URL crawl
          if (data.type === "lightbox.show") {
            const lightboxData = data.data as {
              type: "image" | "video" | "document" | "code" | "html";
              url?: string;
              content?: string;
              title?: string;
            };
            
            // Convert lightbox content to PreviewRequest format
            const previewType = lightboxData.type === "html" ? "markdown" : 
                               lightboxData.type === "code" ? "text" :
                               lightboxData.type === "image" ? "image" : "text";
            
            const preview: PreviewRequest = {
              id: `lightbox-${Date.now()}`,
              type: previewType,
              title: lightboxData.title || "Contenu extrait",
              content: lightboxData.content || lightboxData.url || "",
              description: "Aperçu du contenu web crawlé",
              confirmLabel: "Fermer",
              cancelLabel: "Annuler"
            };
            
            console.log("[AIPreview] Received lightbox.show:", lightboxData.title);
            setPendingPreview(preview);
            setIsOpen(true);
          }
          
          // Handle email.preview events from Action-First Orchestrator
          if (data.type === "email.preview") {
            const emailData = data.data as {
              previewType: string;
              title: string;
              preview: string;
            };
            
            const preview: PreviewRequest = {
              id: `email-preview-${Date.now()}`,
              type: "markdown",
              title: emailData.title || "Apercu Email",
              content: emailData.preview || "",
              description: `Apercu ${emailData.previewType === 'previewPdf' ? 'PDF' : 'Word'}`,
              confirmLabel: "Fermer",
              cancelLabel: "Annuler"
            };
            
            console.log("[AIPreview] Received email.preview:", emailData.title);
            setPendingPreview(preview);
            setIsOpen(true);
          }
        } catch (error) {
          console.error("[AIPreview] Error parsing message:", error);
        }
      };

      wsRef.current.onclose = () => {
        isConnectedRef.current = false;
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      };
    } catch (error) {
      console.error("[AIPreview] Failed to connect:", error);
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

  const sendResponse = useCallback(async (requestId: string, confirmed: boolean) => {
    try {
      const response = await fetch("/api/v2/ai/preview/response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ requestId, confirmed })
      });
      
      if (!response.ok) {
        console.error("[AIPreview] Failed to send response:", response.statusText);
      }
      
      options?.onPreviewResponse?.(requestId, confirmed);
    } catch (error) {
      console.error("[AIPreview] Error sending response:", error);
    }
  }, [options]);

  const handleConfirm = useCallback((requestId: string) => {
    sendResponse(requestId, true);
    setIsOpen(false);
    setTimeout(() => setPendingPreview(null), 300);
  }, [sendResponse]);

  const handleCancel = useCallback((requestId: string) => {
    sendResponse(requestId, false);
    setIsOpen(false);
    setTimeout(() => setPendingPreview(null), 300);
  }, [sendResponse]);

  const close = useCallback(() => {
    if (pendingPreview) {
      sendResponse(pendingPreview.id, false);
    }
    setIsOpen(false);
    setTimeout(() => setPendingPreview(null), 300);
  }, [pendingPreview, sendResponse]);

  return {
    pendingPreview,
    isOpen,
    handleConfirm,
    handleCancel,
    close
  };
}
