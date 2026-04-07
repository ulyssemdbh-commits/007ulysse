/**
 * Offline Cache Service
 * Provides local storage for conversations with deferred sync when back online
 */

const DB_NAME = "devflow_offline";
const DB_VERSION = 1;
const CONVERSATIONS_STORE = "conversations";
const PENDING_MESSAGES_STORE = "pending_messages";

interface CachedConversation {
  threadId: number;
  title: string;
  messages: CachedMessage[];
  lastUpdated: number;
}

interface CachedMessage {
  id?: number;
  threadId: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  synced: boolean;
}

interface PendingMessage {
  id: string;
  threadId: number;
  content: string;
  createdAt: string;
  retryCount: number;
}

let db: IDBDatabase | null = null;

async function openDatabase(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      if (!database.objectStoreNames.contains(CONVERSATIONS_STORE)) {
        const convStore = database.createObjectStore(CONVERSATIONS_STORE, { keyPath: "threadId" });
        convStore.createIndex("lastUpdated", "lastUpdated", { unique: false });
      }

      if (!database.objectStoreNames.contains(PENDING_MESSAGES_STORE)) {
        const pendingStore = database.createObjectStore(PENDING_MESSAGES_STORE, { keyPath: "id" });
        pendingStore.createIndex("threadId", "threadId", { unique: false });
        pendingStore.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
  });
}

export const offlineCache = {
  async isAvailable(): Promise<boolean> {
    try {
      await openDatabase();
      return true;
    } catch {
      return false;
    }
  },

  async cacheConversation(threadId: number, title: string, messages: CachedMessage[]): Promise<void> {
    const database = await openDatabase();
    
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(CONVERSATIONS_STORE, "readwrite");
      const store = transaction.objectStore(CONVERSATIONS_STORE);
      
      const data: CachedConversation = {
        threadId,
        title,
        messages: messages.map(m => ({ ...m, synced: true })),
        lastUpdated: Date.now(),
      };

      const request = store.put(data);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  async getCachedConversation(threadId: number): Promise<CachedConversation | null> {
    const database = await openDatabase();
    
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(CONVERSATIONS_STORE, "readonly");
      const store = transaction.objectStore(CONVERSATIONS_STORE);
      const request = store.get(threadId);
      
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  },

  async getCachedConversations(limit: number = 20): Promise<CachedConversation[]> {
    const database = await openDatabase();
    
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(CONVERSATIONS_STORE, "readonly");
      const store = transaction.objectStore(CONVERSATIONS_STORE);
      const index = store.index("lastUpdated");
      const request = index.openCursor(null, "prev");
      
      const results: CachedConversation[] = [];
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor && results.length < limit) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  },

  async addPendingMessage(threadId: number, content: string): Promise<string> {
    const database = await openDatabase();
    const id = `pending_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(PENDING_MESSAGES_STORE, "readwrite");
      const store = transaction.objectStore(PENDING_MESSAGES_STORE);
      
      const data: PendingMessage = {
        id,
        threadId,
        content,
        createdAt: new Date().toISOString(),
        retryCount: 0,
      };

      const request = store.add(data);
      request.onsuccess = () => resolve(id);
      request.onerror = () => reject(request.error);
    });
  },

  async getPendingMessages(): Promise<PendingMessage[]> {
    const database = await openDatabase();
    
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(PENDING_MESSAGES_STORE, "readonly");
      const store = transaction.objectStore(PENDING_MESSAGES_STORE);
      const request = store.getAll();
      
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  async removePendingMessage(id: string): Promise<void> {
    const database = await openDatabase();
    
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(PENDING_MESSAGES_STORE, "readwrite");
      const store = transaction.objectStore(PENDING_MESSAGES_STORE);
      const request = store.delete(id);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  async incrementRetryCount(id: string): Promise<void> {
    const database = await openDatabase();
    
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(PENDING_MESSAGES_STORE, "readwrite");
      const store = transaction.objectStore(PENDING_MESSAGES_STORE);
      const getRequest = store.get(id);
      
      getRequest.onsuccess = () => {
        const message = getRequest.result;
        if (message) {
          message.retryCount++;
          const putRequest = store.put(message);
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          resolve();
        }
      };
      
      getRequest.onerror = () => reject(getRequest.error);
    });
  },

  async clearOldCache(maxAgeDays: number = 7): Promise<number> {
    const database = await openDatabase();
    const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(CONVERSATIONS_STORE, "readwrite");
      const store = transaction.objectStore(CONVERSATIONS_STORE);
      const index = store.index("lastUpdated");
      const range = IDBKeyRange.upperBound(cutoff);
      const request = index.openCursor(range);
      
      let deleted = 0;
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          deleted++;
          cursor.continue();
        } else {
          resolve(deleted);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  },

  async getCacheStats(): Promise<{ conversations: number; pendingMessages: number; totalSize: number }> {
    const database = await openDatabase();
    
    const [convCount, pendingCount] = await Promise.all([
      new Promise<number>((resolve, reject) => {
        const transaction = database.transaction(CONVERSATIONS_STORE, "readonly");
        const store = transaction.objectStore(CONVERSATIONS_STORE);
        const request = store.count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
      new Promise<number>((resolve, reject) => {
        const transaction = database.transaction(PENDING_MESSAGES_STORE, "readonly");
        const store = transaction.objectStore(PENDING_MESSAGES_STORE);
        const request = store.count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
    ]);

    return {
      conversations: convCount,
      pendingMessages: pendingCount,
      totalSize: 0,
    };
  },
};

export class OfflineSyncManager {
  private isOnline: boolean = navigator.onLine;
  private syncInProgress: boolean = false;
  private listeners: Set<(online: boolean) => void> = new Set();

  constructor() {
    window.addEventListener("online", () => this.handleOnline());
    window.addEventListener("offline", () => this.handleOffline());
  }

  private handleOnline(): void {
    this.isOnline = true;
    this.notifyListeners();
    this.syncPendingMessages();
  }

  private handleOffline(): void {
    this.isOnline = false;
    this.notifyListeners();
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.isOnline));
  }

  onStatusChange(callback: (online: boolean) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  getStatus(): boolean {
    return this.isOnline;
  }

  async syncPendingMessages(): Promise<{ synced: number; failed: number }> {
    if (this.syncInProgress || !this.isOnline) {
      return { synced: 0, failed: 0 };
    }

    this.syncInProgress = true;
    let synced = 0;
    let failed = 0;

    try {
      const pending = await offlineCache.getPendingMessages();
      
      for (const message of pending) {
        if (message.retryCount >= 3) {
          await offlineCache.removePendingMessage(message.id);
          failed++;
          continue;
        }

        try {
          const response = await fetch("/api/v2/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              threadId: message.threadId > 0 ? message.threadId : undefined,
              message: message.content,
              originDevice: "web-offline-sync",
              sessionContext: "offline-sync",
            }),
          });

          if (response.ok) {
            await offlineCache.removePendingMessage(message.id);
            synced++;
          } else {
            await offlineCache.incrementRetryCount(message.id);
            failed++;
          }
        } catch {
          await offlineCache.incrementRetryCount(message.id);
          failed++;
        }
      }
    } finally {
      this.syncInProgress = false;
    }

    console.log(`[OfflineSync] Synced ${synced}, failed ${failed}`);
    return { synced, failed };
  }
}

export const offlineSyncManager = new OfflineSyncManager();
