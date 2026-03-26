import { describe, it, expect, vi, beforeEach } from "vitest";

interface WebSocketMessage {
  type: string;
  payload: any;
  timestamp: number;
}

interface WebSocketClient {
  id: string;
  userId: number;
  deviceId?: string;
  isAuthenticated: boolean;
  lastPing: number;
  subscriptions: Set<string>;
}

function parseMessage(data: string): WebSocketMessage | null {
  try {
    const parsed = JSON.parse(data);
    if (!parsed.type) return null;
    return {
      type: parsed.type,
      payload: parsed.payload || {},
      timestamp: parsed.timestamp || Date.now(),
    };
  } catch {
    return null;
  }
}

function serializeMessage(type: string, payload: any = {}): string {
  return JSON.stringify({
    type,
    payload,
    timestamp: Date.now(),
  });
}

function isClientAlive(client: WebSocketClient, timeout: number = 30000): boolean {
  return Date.now() - client.lastPing < timeout;
}

function filterClientsByUserId(clients: WebSocketClient[], userId: number): WebSocketClient[] {
  return clients.filter(c => c.userId === userId && c.isAuthenticated);
}

function filterClientsBySubscription(clients: WebSocketClient[], topic: string): WebSocketClient[] {
  return clients.filter(c => c.subscriptions.has(topic));
}

function broadcastToClients(clients: WebSocketClient[], type: string, payload: any): string {
  return serializeMessage(type, payload);
}

describe("WebSocket Utilities", () => {
  describe("Message Parsing", () => {
    it("parses valid JSON message", () => {
      const data = JSON.stringify({ type: "ping", payload: {} });
      const result = parseMessage(data);
      expect(result?.type).toBe("ping");
    });

    it("returns null for invalid JSON", () => {
      expect(parseMessage("not json")).toBeNull();
    });

    it("returns null for missing type", () => {
      expect(parseMessage(JSON.stringify({ payload: {} }))).toBeNull();
    });

    it("adds default timestamp", () => {
      const data = JSON.stringify({ type: "test" });
      const result = parseMessage(data);
      expect(result?.timestamp).toBeGreaterThan(0);
    });
  });

  describe("Message Serialization", () => {
    it("serializes message correctly", () => {
      const message = serializeMessage("test", { data: "value" });
      const parsed = JSON.parse(message);
      expect(parsed.type).toBe("test");
      expect(parsed.payload.data).toBe("value");
    });

    it("includes timestamp", () => {
      const message = serializeMessage("test");
      const parsed = JSON.parse(message);
      expect(parsed.timestamp).toBeGreaterThan(0);
    });
  });

  describe("Client Alive Check", () => {
    it("returns true for recent ping", () => {
      const client: WebSocketClient = {
        id: "1", userId: 1, isAuthenticated: true,
        lastPing: Date.now(), subscriptions: new Set()
      };
      expect(isClientAlive(client)).toBe(true);
    });

    it("returns false for stale client", () => {
      const client: WebSocketClient = {
        id: "1", userId: 1, isAuthenticated: true,
        lastPing: Date.now() - 60000, subscriptions: new Set()
      };
      expect(isClientAlive(client)).toBe(false);
    });

    it("respects custom timeout", () => {
      const client: WebSocketClient = {
        id: "1", userId: 1, isAuthenticated: true,
        lastPing: Date.now() - 50000, subscriptions: new Set()
      };
      expect(isClientAlive(client, 60000)).toBe(true);
    });
  });

  describe("Client Filtering", () => {
    const clients: WebSocketClient[] = [
      { id: "1", userId: 1, isAuthenticated: true, lastPing: Date.now(), subscriptions: new Set(["chat"]) },
      { id: "2", userId: 1, isAuthenticated: true, lastPing: Date.now(), subscriptions: new Set(["files"]) },
      { id: "3", userId: 2, isAuthenticated: true, lastPing: Date.now(), subscriptions: new Set(["chat"]) },
      { id: "4", userId: 1, isAuthenticated: false, lastPing: Date.now(), subscriptions: new Set() },
    ];

    it("filters by user ID", () => {
      const filtered = filterClientsByUserId(clients, 1);
      expect(filtered.length).toBe(2);
      expect(filtered.every(c => c.userId === 1 && c.isAuthenticated)).toBe(true);
    });

    it("filters by subscription", () => {
      const filtered = filterClientsBySubscription(clients, "chat");
      expect(filtered.length).toBe(2);
    });

    it("returns empty for non-existent user", () => {
      expect(filterClientsByUserId(clients, 999).length).toBe(0);
    });
  });

  describe("Broadcasting", () => {
    it("creates broadcast message", () => {
      const clients: WebSocketClient[] = [];
      const message = broadcastToClients(clients, "update", { id: 1 });
      const parsed = JSON.parse(message);
      expect(parsed.type).toBe("update");
    });
  });
});
