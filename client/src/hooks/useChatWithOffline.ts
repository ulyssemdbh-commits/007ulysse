/**
 * Chat hook with offline support
 * Wraps the existing chat functionality with offline caching and deferred sync
 */
import { useCallback, useEffect, useState } from "react";
import { useConversationThread, sendMessageV2 } from "./use-chat-v2";
import { offlineCache, offlineSyncManager } from "../lib/offlineCache";
import { useOfflineStatus } from "./useOfflineStatus";

interface Message {
  id?: number;
  threadId: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  pending?: boolean;
}

interface UseChatWithOfflineResult {
  messages: Message[];
  isLoading: boolean;
  isOnline: boolean;
  pendingCount: number;
  sendMessage: (content: string) => Promise<void>;
  retryPending: () => Promise<void>;
}

export function useChatWithOffline(threadId: number | null): UseChatWithOfflineResult {
  const { data, isLoading: isLoadingThread } = useConversationThread(threadId);
  const { isOnline, pendingMessages, syncNow } = useOfflineStatus();
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    async function loadMessages() {
      if (data?.messages) {
        const mapped = data.messages.map(m => ({
          id: m.id,
          threadId: m.threadId,
          role: m.role as "user" | "assistant",
          content: m.content,
          createdAt: new Date(m.createdAt).toISOString(),
          pending: false,
        }));
        setLocalMessages(mapped);
        
        if (threadId) {
          await offlineCache.cacheConversation(
            threadId, 
            data.thread?.title || "Conversation", 
            mapped.map(m => ({ ...m, synced: true }))
          );
        }
      } else if (threadId && !isOnline) {
        const cached = await offlineCache.getCachedConversation(threadId);
        if (cached) {
          setLocalMessages(cached.messages as Message[]);
        }
      }
    }
    
    loadMessages();
  }, [data, threadId, isOnline]);

  const sendMessage = useCallback(async (content: string) => {
    const tempMessage: Message = {
      threadId: threadId || 0,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
      pending: !isOnline,
    };

    setLocalMessages(prev => [...prev, tempMessage]);

    if (!isOnline) {
      await offlineCache.addPendingMessage(threadId || 0, content);
      return;
    }

    setIsLoading(true);
    let responseContent = "";

    try {
      await sendMessageV2(
        content,
        threadId,
        (chunk) => {
          responseContent += chunk;
          setLocalMessages(prev => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return [...prev.slice(0, -1), { ...last, content: responseContent }];
            }
            return [...prev, {
              threadId: threadId || 0,
              role: "assistant",
              content: responseContent,
              createdAt: new Date().toISOString(),
            }];
          });
        },
        () => {}
      );
    } catch (error) {
      console.error("[ChatWithOffline] Send failed:", error);
      await offlineCache.addPendingMessage(threadId || 0, content);
      setLocalMessages(prev => 
        prev.map(m => m === tempMessage ? { ...m, pending: true } : m)
      );
    } finally {
      setIsLoading(false);
    }
  }, [threadId, isOnline]);

  const retryPending = useCallback(async () => {
    await syncNow();
  }, [syncNow]);

  useEffect(() => {
    if (isOnline && pendingMessages > 0) {
      offlineSyncManager.syncPendingMessages();
    }
  }, [isOnline, pendingMessages]);

  return {
    messages: localMessages,
    isLoading: isLoading || isLoadingThread,
    isOnline,
    pendingCount: pendingMessages,
    sendMessage,
    retryPending,
  };
}
