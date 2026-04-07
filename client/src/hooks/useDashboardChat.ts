import { useRef, useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { emitChatSync } from "@/contexts/UlysseChatContext";
import { removeNavigationTagFromResponse, type NavigationDestination } from "@/hooks/useNavigationRequest";
import { processAssistantResponse, cleanResponseForTTS, type DisplayWindow, type PanelManager } from "@/utils/responseProcessor";

interface PendingFileAnalysis {
  content: string;
  fileName: string;
  imageDataUrl?: string;
  pdfPageImages?: string[];
  pdfBase64Full?: string;
}

interface ConversationData {
  messages?: Array<{ role: string; content: string; createdAt?: Date; confidence?: number; confidenceLevel?: string }>;
  [key: string]: unknown;
}

interface UseDashboardChatParams {
  input: string;
  setInput: (v: string) => void;
  activeConversationId: number | null;
  isStreaming: boolean;
  setIsStreaming: (v: boolean) => void;
  setStreamingContent: (v: string) => void;
  autoSpeak: boolean;
  ttsSupported: boolean;
  speak: (text: string) => void;
  pendingFileAnalysis: PendingFileAnalysis | null;
  setPendingFileAnalysis: (v: PendingFileAnalysis | null) => void;
  displayWindow: DisplayWindow;
  panels: PanelManager;
  setNavigationDestination: (v: NavigationDestination | null) => void;
  setPreThinkResult: (v: { intent: string | null; isReading: boolean } | null) => void;
}

export function useDashboardChat(params: UseDashboardChatParams) {
  const {
    input, setInput, activeConversationId,
    isStreaming, setIsStreaming, setStreamingContent,
    autoSpeak, ttsSupported, speak,
    pendingFileAnalysis, setPendingFileAnalysis,
    displayWindow, panels,
    setNavigationDestination, setPreThinkResult,
  } = params;

  const queryClient = useQueryClient();
  const lastConfidenceRef = useRef<{ confidence: number; confidenceLevel: string } | null>(null);
  const handleSendMessageRef = useRef<(text?: string) => void>(() => {});

  const handleSendMessage = useCallback(async (messageText?: string) => {
    let content = messageText || input;

    let imageDataUrl: string | undefined;
    let pdfPageImages: string[] | undefined;
    let pdfBase64Full: string | undefined;
    let pdfFileName: string | undefined;
    if (pendingFileAnalysis) {
      if (pendingFileAnalysis.imageDataUrl) {
        imageDataUrl = pendingFileAnalysis.imageDataUrl;
        const imageSizeKB = (imageDataUrl.length / 1024).toFixed(1);
        console.log(`[VISION] Sending image for analysis: ${pendingFileAnalysis.fileName} (${imageSizeKB}KB base64)`);
        content = content || "Analyse cette image en détail et décris ce que tu vois.";
      } else if (pendingFileAnalysis.pdfPageImages && pendingFileAnalysis.pdfPageImages.length > 0) {
        pdfPageImages = pendingFileAnalysis.pdfPageImages;
        const fileContext = `[FICHIER PDF JOINT: ${pendingFileAnalysis.fileName}]\n\nContenu textuel extrait:\n${pendingFileAnalysis.content.slice(0, 15000)}\n\n---\n\n${content || "Analyse ce PDF : son contenu ET son design/mise en page."}`;
        content = fileContext;
        console.log(`[VISION] Sending PDF with ${pdfPageImages.length} page images + text for: ${pendingFileAnalysis.fileName}`);
      } else {
        const fileContext = `[FICHIER JOINT: ${pendingFileAnalysis.fileName}]\n\nContenu du fichier:\n${pendingFileAnalysis.content.slice(0, 15000)}\n\n---\n\n${content || "Analyse ce fichier et donne-moi un résumé."}`;
        content = fileContext;
      }
      if (pendingFileAnalysis.pdfBase64Full) {
        pdfBase64Full = pendingFileAnalysis.pdfBase64Full;
        pdfFileName = pendingFileAnalysis.fileName;
        console.log(`[PDF-FALLBACK] Including PDF base64 for server-side save: ${pendingFileAnalysis.fileName}`);
      }
      setPendingFileAnalysis(null);
    }

    if (!content.trim() || !activeConversationId || isStreaming) return;

    setInput("");
    setPreThinkResult(null);
    setIsStreaming(true);
    setStreamingContent("");

    queryClient.setQueryData(["/api/conversations", activeConversationId], (old: ConversationData | undefined) => ({
      ...old,
      messages: [...(old?.messages || []), { role: "user", content, createdAt: new Date() }]
    }));

    let fullResponse = "";

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    try {
      const res = await fetch(`/api/conversations/${activeConversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, imageDataUrl, pdfPageImages, pdfBase64Full, pdfFileName }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        if (res.status === 401) {
          throw new Error("Session expirée - veuillez vous reconnecter");
        }
        throw new Error("Erreur de communication avec Ulysse");
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) return;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                fullResponse += data.content;
                setStreamingContent(fullResponse);
              }
              if (data.type === "done" && data.confidenceLevel) {
                lastConfidenceRef.current = { confidence: data.confidence, confidenceLevel: data.confidenceLevel };
              }
            } catch (_e) {}
          }
        }
      }

      if (fullResponse) {
        const msgConfidence = lastConfidenceRef.current;
        lastConfidenceRef.current = null;
        queryClient.setQueryData(["/api/conversations", activeConversationId], (old: ConversationData | undefined) => ({
          ...old,
          messages: [...(old?.messages || []), { role: "assistant", content: fullResponse, createdAt: new Date(), confidence: msgConfidence?.confidence, confidenceLevel: msgConfidence?.confidenceLevel }]
        }));

        await processAssistantResponse({
          fullResponse,
          displayWindow,
          panels,
          setNavigationDestination,
        });
      }
    } catch (err: unknown) {
      console.error("Streaming error", err);
      clearTimeout(timeoutId);

      const error = err instanceof Error ? err : new Error(String(err));
      const errorMessage = error.name === "AbortError"
        ? "Ulysse met trop de temps à répondre. Réessayez."
        : error.message || "Erreur de communication avec Ulysse";

      queryClient.setQueryData(["/api/conversations", activeConversationId], (old: ConversationData | undefined) => ({
        ...old,
        messages: [...(old?.messages || []), {
          role: "assistant",
          content: `⚠️ ${errorMessage}`,
          createdAt: new Date()
        }]
      }));
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
      emitChatSync(activeConversationId!, "dashboard");
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", activeConversationId] });

      if (autoSpeak && fullResponse && ttsSupported) {
        const cleanText = cleanResponseForTTS(removeNavigationTagFromResponse(fullResponse)).slice(0, 500);
        console.log("Ulysse speaking:", cleanText.slice(0, 100));
        speak(cleanText);
      }
    }
  }, [input, activeConversationId, isStreaming, queryClient, autoSpeak, ttsSupported, speak, pendingFileAnalysis]);

  useEffect(() => {
    handleSendMessageRef.current = handleSendMessage;
  }, [handleSendMessage]);

  const handleSend = useCallback(() => handleSendMessage(), [handleSendMessage]);

  return {
    handleSendMessage,
    handleSend,
    handleSendMessageRef,
    lastConfidenceRef,
  };
}
