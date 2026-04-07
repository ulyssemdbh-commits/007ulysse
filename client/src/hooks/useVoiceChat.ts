/**
 * Voice Chat Hook
 * Integrates voice recognition, streaming AI responses, and progressive TTS
 * for fluid, natural conversation experience
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useVoice } from "./use-voice";
import { apiRequest } from "@/lib/queryClient";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

interface VoiceChatOptions {
  threadId?: number | null;
  onMessageSent?: (message: string) => void;
  onResponseStart?: () => void;
  onResponseComplete?: (response: string) => void;
  onError?: (error: Error) => void;
  useProgressiveTTS?: boolean;
}

export function useVoiceChat(options: VoiceChatOptions = {}) {
  const {
    threadId: initialThreadId = null,
    onMessageSent,
    onResponseStart,
    onResponseComplete,
    onError,
    useProgressiveTTS = true,
  } = options;

  const voice = useVoice();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentResponse, setCurrentResponse] = useState("");
  const [threadId, setThreadId] = useState<number | null>(initialThreadId);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Add message to history
  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  // Close streaming connection
  const closeStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  // Start context preloading when user starts speaking
  const preloadContext = useCallback(async () => {
    try {
      await fetch("/api/voice/preload-context", {
        method: "POST",
        credentials: "include",
      });
      console.log("[VoiceChat] Context preload started");
    } catch (err) {
      console.log("[VoiceChat] Context preload failed (non-blocking):", err);
    }
  }, []);

  // Check for cached quick response
  const getQuickResponse = useCallback(async (message: string): Promise<string | null> => {
    try {
      const response = await fetch("/api/voice/quick-response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
        credentials: "include",
      });
      const data = await response.json();
      if (data.cached && data.response) {
        console.log("[VoiceChat] Quick response from cache");
        return data.response;
      }
    } catch (err) {
      console.log("[VoiceChat] Quick response check failed:", err);
    }
    return null;
  }, []);

  // Send message to AI with streaming response
  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return;

      const userMessage: ChatMessage = {
        role: "user",
        content: text,
        timestamp: Date.now(),
      };
      addMessage(userMessage);
      onMessageSent?.(text);

      // Stop any ongoing TTS
      voice.stopSpeaking();
      voice.resetProgressiveTTS();
      
      // Check for quick cached response first
      const quickResponse = await getQuickResponse(text);
      if (quickResponse) {
        addMessage({
          role: "assistant",
          content: quickResponse,
          timestamp: Date.now(),
        });
        
        if (useProgressiveTTS) {
          voice.speakProgressive(quickResponse, true);
        } else {
          voice.speak(quickResponse);
        }
        
        onResponseComplete?.(quickResponse);
        return;
      }

      setIsStreaming(true);
      setCurrentResponse("");
      onResponseStart?.();

      try {
        abortControllerRef.current = new AbortController();

        const response = await fetch("/api/v2/conversations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            threadId,
            message: text,
            originDevice: "voice-chat",
            sessionContext: "voice",
            contextHints: { includeMemory: true },
          }),
          credentials: "include",
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`Chat request failed: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let fullResponse = "";
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));

                if (data.type === "start" && data.threadId) {
                  setThreadId(data.threadId);
                }

                if (data.type === "chunk" && data.content) {
                  fullResponse += data.content;
                  setCurrentResponse(fullResponse);

                  // Progressive TTS - speak as sentences complete
                  if (useProgressiveTTS) {
                    voice.speakProgressive(data.content);
                  }
                }

                if (data.type === "done") {
                  // Flush remaining buffer to TTS
                  if (useProgressiveTTS) {
                    voice.speakProgressive("", true);
                  } else {
                    voice.speak(fullResponse);
                  }

                  addMessage({
                    role: "assistant",
                    content: fullResponse,
                    timestamp: Date.now(),
                  });

                  onResponseComplete?.(fullResponse);
                }
              } catch (e) {
                // Ignore parse errors for SSE comments
              }
            }
          }
        }
      } catch (error: any) {
        if (error.name !== "AbortError") {
          console.error("[VoiceChat] Error:", error);
          onError?.(error);
        }
      } finally {
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [
      isStreaming,
      threadId,
      addMessage,
      onMessageSent,
      onResponseStart,
      onResponseComplete,
      onError,
      useProgressiveTTS,
      voice,
      getQuickResponse,
    ]
  );

  // Handle auto-submit from voice (when user says "à toi")
  useEffect(() => {
    voice.setOnAutoSubmit((text) => {
      console.log("[VoiceChat] Auto-submit:", text);
      sendMessage(text);
    });

    return () => {
      voice.setOnAutoSubmit(null);
      closeStream();
    };
  }, [sendMessage, voice, closeStream]);

  // Start listening with context preloading
  const startConversation = useCallback(() => {
    voice.stopSpeaking();
    voice.resetProgressiveTTS();
    preloadContext(); // Start preloading context in background
    voice.startListening();
  }, [voice, preloadContext]);

  // Stop everything
  const stopConversation = useCallback(() => {
    voice.stopListening();
    voice.stopSpeaking();
    voice.resetProgressiveTTS();
    closeStream();
  }, [voice, closeStream]);

  // Interrupt AI response (barge-in)
  const interrupt = useCallback(() => {
    voice.interrupt();
    voice.resetProgressiveTTS();
    closeStream();
  }, [voice, closeStream]);

  // Clear conversation history
  const clearHistory = useCallback(() => {
    setMessages([]);
    setThreadId(null);
    setCurrentResponse("");
  }, []);

  return {
    // State
    messages,
    isStreaming,
    currentResponse,
    threadId,
    
    // Voice state passthrough
    isListening: voice.isListening,
    isSpeaking: voice.isSpeaking,
    isProcessing: voice.isProcessing,
    voiceState: voice.voiceState,
    transcript: voice.transcript,
    
    // Actions
    startConversation,
    stopConversation,
    sendMessage,
    interrupt,
    clearHistory,
    
    // Direct voice access
    voice,
    speak: voice.speak,
    speakProgressive: voice.speakProgressive,
    startListening: voice.startListening,
    stopListening: voice.stopListening,
    stopSpeaking: voice.stopSpeaking,
  };
}
