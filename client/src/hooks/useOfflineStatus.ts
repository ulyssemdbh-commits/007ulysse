import { useState, useEffect, useCallback } from "react";
import { offlineCache, offlineSyncManager } from "../lib/offlineCache";

interface OfflineStatus {
  isOnline: boolean;
  pendingMessages: number;
  cachedConversations: number;
  isSyncing: boolean;
  lastSyncResult: { synced: number; failed: number } | null;
}

export function useOfflineStatus() {
  const [status, setStatus] = useState<OfflineStatus>({
    isOnline: navigator.onLine,
    pendingMessages: 0,
    cachedConversations: 0,
    isSyncing: false,
    lastSyncResult: null,
  });

  const refreshStats = useCallback(async () => {
    try {
      const stats = await offlineCache.getCacheStats();
      setStatus(prev => ({
        ...prev,
        pendingMessages: stats.pendingMessages,
        cachedConversations: stats.conversations,
      }));
    } catch (err) {
      console.log("[OfflineStatus] Failed to get stats:", err);
    }
  }, []);

  const syncNow = useCallback(async () => {
    setStatus(prev => ({ ...prev, isSyncing: true }));
    try {
      const result = await offlineSyncManager.syncPendingMessages();
      setStatus(prev => ({
        ...prev,
        isSyncing: false,
        lastSyncResult: result,
      }));
      await refreshStats();
      return result;
    } catch (err) {
      setStatus(prev => ({ ...prev, isSyncing: false }));
      throw err;
    }
  }, [refreshStats]);

  useEffect(() => {
    const unsubscribe = offlineSyncManager.onStatusChange((online) => {
      setStatus(prev => ({ ...prev, isOnline: online }));
      if (online) {
        refreshStats();
      }
    });

    refreshStats();

    return unsubscribe;
  }, [refreshStats]);

  return {
    ...status,
    syncNow,
    refreshStats,
  };
}

export function useConversationCache(threadId: number | null) {
  const [cachedMessages, setCachedMessages] = useState<any[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  const loadFromCache = useCallback(async () => {
    if (!threadId) return;
    
    try {
      const cached = await offlineCache.getCachedConversation(threadId);
      if (cached) {
        setCachedMessages(cached.messages);
      }
      setIsLoaded(true);
    } catch (err) {
      console.log("[ConversationCache] Failed to load:", err);
      setIsLoaded(true);
    }
  }, [threadId]);

  const saveToCache = useCallback(async (title: string, messages: any[]) => {
    if (!threadId) return;
    
    try {
      await offlineCache.cacheConversation(threadId, title, messages);
    } catch (err) {
      console.log("[ConversationCache] Failed to save:", err);
    }
  }, [threadId]);

  const addPendingMessage = useCallback(async (content: string) => {
    const tid = threadId || 0;
    try {
      const id = await offlineCache.addPendingMessage(tid, content);
      return id;
    } catch (err) {
      console.log("[ConversationCache] Failed to add pending:", err);
      return null;
    }
  }, [threadId]);

  useEffect(() => {
    loadFromCache();
  }, [loadFromCache]);

  return {
    cachedMessages,
    isLoaded,
    saveToCache,
    addPendingMessage,
    loadFromCache,
  };
}
