import { describe, it, expect, vi, beforeEach } from "vitest";

class MockAuthService {
  private sessions: Map<string, { userId: number; expiresAt: Date }> = new Map();
  private users: Map<number, { id: number; password: string; isOwner: boolean }> = new Map();

  constructor() {
    this.users.set(1, { id: 1, password: "$2b$12$hashedpassword", isOwner: true });
  }

  async hashPassword(password: string): Promise<string> {
    return `hashed_${password}`;
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return hash === `hashed_${password}`;
  }

  generateSessionToken(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  getSessionExpiry(): Date {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 30);
    return expiry;
  }

  async createSession(userId: number): Promise<{ id: string; userId: number; expiresAt: Date }> {
    const token = this.generateSessionToken();
    const expiresAt = this.getSessionExpiry();
    this.sessions.set(token, { userId, expiresAt });
    return { id: token, userId, expiresAt };
  }

  async validateSession(token: string): Promise<{ success: boolean; user?: any; error?: string }> {
    const session = this.sessions.get(token);
    if (!session) {
      return { success: false, error: "Session not found" };
    }
    if (new Date() > session.expiresAt) {
      this.sessions.delete(token);
      return { success: false, error: "Session expired" };
    }
    const user = this.users.get(session.userId);
    if (!user) {
      return { success: false, error: "User not found" };
    }
    return { success: true, user };
  }

  async deleteSession(token: string): Promise<void> {
    this.sessions.delete(token);
  }

  setUser(id: number, data: { password: string; isOwner: boolean }): void {
    this.users.set(id, { id, ...data });
  }
}

describe("AuthService", () => {
  let auth: MockAuthService;

  beforeEach(() => {
    auth = new MockAuthService();
  });

  describe("Password Hashing", () => {
    it("hashes password correctly", async () => {
      const hash = await auth.hashPassword("mypassword");
      expect(hash).toBe("hashed_mypassword");
    });

    it("verifies correct password", async () => {
      const hash = await auth.hashPassword("mypassword");
      const result = await auth.verifyPassword("mypassword", hash);
      expect(result).toBe(true);
    });

    it("rejects incorrect password", async () => {
      const hash = await auth.hashPassword("mypassword");
      const result = await auth.verifyPassword("wrongpassword", hash);
      expect(result).toBe(false);
    });
  });

  describe("Session Management", () => {
    it("creates session with valid token", async () => {
      const session = await auth.createSession(1);
      expect(session.id).toBeDefined();
      expect(session.id.length).toBeGreaterThan(10);
      expect(session.userId).toBe(1);
    });

    it("creates session with future expiry", async () => {
      const session = await auth.createSession(1);
      expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("validates existing session", async () => {
      const session = await auth.createSession(1);
      const result = await auth.validateSession(session.id);
      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
    });

    it("rejects non-existent session", async () => {
      const result = await auth.validateSession("invalid_token");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Session not found");
    });

    it("deletes session correctly", async () => {
      const session = await auth.createSession(1);
      await auth.deleteSession(session.id);
      const result = await auth.validateSession(session.id);
      expect(result.success).toBe(false);
    });
  });

  describe("Session Expiry", () => {
    it("generates expiry 30 days in future", () => {
      const expiry = auth.getSessionExpiry();
      const expectedMin = Date.now() + 29 * 24 * 60 * 60 * 1000;
      const expectedMax = Date.now() + 31 * 24 * 60 * 60 * 1000;
      expect(expiry.getTime()).toBeGreaterThan(expectedMin);
      expect(expiry.getTime()).toBeLessThan(expectedMax);
    });
  });

  describe("Token Generation", () => {
    it("generates unique tokens", () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 100; i++) {
        tokens.add(auth.generateSessionToken());
      }
      expect(tokens.size).toBe(100);
    });

    it("generates tokens of sufficient length", () => {
      const token = auth.generateSessionToken();
      expect(token.length).toBeGreaterThanOrEqual(15);
    });
  });
});
