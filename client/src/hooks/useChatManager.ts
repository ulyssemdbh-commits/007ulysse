import { useState, useCallback, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useConversationSync, type SyncMessage } from "./useConversationSync";

export type ReactionType = "like" | "dislike" | "love" | "helpful" | null;

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  reaction?: ReactionType;
}

interface UseChatManagerOptions {
  userId: number | null;
  deviceId: string;
  sessionContext?: string;
  onStreamStart?: () => void;
  onStreamEnd?: (content: string, messageId: string) => void;
}

export function useChatManager(options: UseChatManagerOptions) {
  const { userId, deviceId, sessionContext = "assistant", onStreamStart, onStreamEnd } = options;
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const thinkingRef = useRef(false);

  const handleSyncedMessage = useCallback((message: SyncMessage, origin: string, threadId?: string) => {
    console.log(`[ChatManager] Received message from ${origin}:`, message.content.substring(0, 50));
    setMessages(prev => {
      if (prev.some(m => m.id === message.id)) {
        return prev;
      }
      return [...prev, {
        ...message,
        timestamp: new Date(message.timestamp)
      }];
    });
  }, []);

  const { sendMessage: syncMessage, isConnected: isSyncConnected } = useConversationSync({
    userId: userId || undefined,
    deviceId,
    onMessage: handleSyncedMessage,
    enabled: !!userId
  });

  useEffect(() => {
    thinkingRef.current = isThinking;
  }, [isThinking]);

  useEffect(() => {
    if (isThinking) {
      const timeout = setTimeout(() => {
        if (thinkingRef.current) {
          console.warn("[ChatManager] Thinking timeout - resetting state");
          setIsThinking(false);
          setStreamingMessageId(null);
        }
      }, 60000);
      return () => clearTimeout(timeout);
    }
  }, [isThinking]);

  const chatMutation = useMutation({
    mutationFn: async (message: string) => {
      const messageId = `assistant_${Date.now()}`;
      setIsThinking(true);
      onStreamStart?.();
      
      setMessages((prev) => [...prev, {
        id: messageId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
      }]);

      const response = await fetch("/api/v2/conversations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream",
        },
        credentials: "include",
        body: JSON.stringify({
          message,
          threadId: currentThreadId,
          originDevice: deviceId,
          sessionContext,
          contextHints: { includeMemory: true },
        }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Session expirée");
        }
        throw new Error("Erreur de communication");
      }

      setIsThinking(false);
      setStreamingMessageId(messageId);
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullResponse = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value, { stream: true });
          const lines = text.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === "start" && data.threadId) {
                  setCurrentThreadId(data.threadId);
                } else if (data.type === "chunk" && data.content) {
                  fullResponse += data.content;
                  setMessages((prev) => prev.map((msg) =>
                    msg.id === messageId ? { ...msg, content: fullResponse } : msg
                  ));
                }
              } catch {}
            }
          }
        }
      }

      setStreamingMessageId(null);
      
      if (fullResponse) {
        syncMessage({
          id: messageId,
          role: "assistant",
          content: fullResponse,
          timestamp: new Date()
        }, currentThreadId || undefined);
        
        onStreamEnd?.(fullResponse, messageId);
      }

      return { response: fullResponse, messageId };
    },
    onError: (error) => {
      console.error("[ChatManager] Chat error:", error);
      setIsThinking(false);
      setStreamingMessageId(null);
    },
  });

  const sendMessage = useCallback(async (content: string, files?: File[]) => {
    const messageContent = files && files.length > 0 
      ? `${content}\n\n[Fichiers joints: ${files.map(f => f.name).join(", ")}]`
      : content;

    const userMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      role: "user",
      content: messageContent,
      timestamp: new Date(),
    };
    
    setMessages((prev) => [...prev, userMessage]);
    
    syncMessage({
      id: userMessage.id,
      role: "user",
      content: messageContent,
      timestamp: userMessage.timestamp
    }, currentThreadId || undefined);

    await chatMutation.mutateAsync(content);
  }, [chatMutation, syncMessage, currentThreadId]);

  const handleReaction = useCallback((messageId: string, reactionType: ReactionType) => {
    setMessages(prev => prev.map(msg => 
      msg.id === messageId 
        ? { ...msg, reaction: msg.reaction === reactionType ? null : reactionType }
        : msg
    ));
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setCurrentThreadId(null);
  }, []);

  return {
    messages,
    setMessages,
    isThinking,
    streamingMessageId,
    currentThreadId,
    isSyncConnected,
    sendMessage,
    handleReaction,
    clearMessages,
    isPending: chatMutation.isPending,
  };
}
