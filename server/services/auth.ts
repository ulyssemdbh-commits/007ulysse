import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { db } from "../db";
import { users, sessions, approvedUsers, webauthnCredentials, auditLogs } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import type { User, Session, ApprovedUser } from "@shared/schema";

const SALT_ROUNDS = 12;
const SESSION_DURATION_DAYS = 365;
const SESSION_RENEWAL_THRESHOLD_DAYS = 30;

// ============================================================
// BRUTE FORCE PROTECTION — per-username lockout tracking
// ============================================================
const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const ATTEMPT_DECAY_MS = 10 * 60 * 1000; // attempts decay after 10 minutes of inactivity

interface LockoutEntry {
    attempts: number;
    lockedUntil?: Date;
    lastFailure?: Date;
}

const loginAttempts = new Map<string, LockoutEntry>();

function getLockoutEntry(username: string): LockoutEntry {
    const entry = loginAttempts.get(username.toLowerCase()) || { attempts: 0 };
    if (entry.lastFailure && (Date.now() - entry.lastFailure.getTime()) > ATTEMPT_DECAY_MS && !entry.lockedUntil) {
        entry.attempts = 0;
        entry.lastFailure = undefined;
        loginAttempts.delete(username.toLowerCase());
        return { attempts: 0 };
    }
    return entry;
}

function recordFailedAttempt(username: string): LockoutEntry {
    const entry = getLockoutEntry(username);
    entry.attempts += 1;
    entry.lastFailure = new Date();
    if (entry.attempts >= MAX_FAILED_ATTEMPTS) {
        entry.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
    }
    loginAttempts.set(username.toLowerCase(), entry);
    return entry;
}

function clearAttempts(username: string) {
    loginAttempts.delete(username.toLowerCase());
}

export function adminUnlockAccount(username: string): boolean {
    const key = username.toLowerCase();
    if (loginAttempts.has(key)) {
        loginAttempts.delete(key);
        return true;
    }
    return false;
}

function isLocked(username: string): { locked: boolean; minutesLeft?: number } {
    const entry = getLockoutEntry(username);
    if (entry.lockedUntil && entry.lockedUntil > new Date()) {
        const minutesLeft = Math.ceil((entry.lockedUntil.getTime() - Date.now()) / 60000);
        return { locked: true, minutesLeft };
    }
    if (entry.lockedUntil && entry.lockedUntil <= new Date()) {
        clearAttempts(username);
    }
    return { locked: false };
}

async function sendSecurityAlertDiscord(username: string, ip: string | undefined, reason: string) {
    try {
        const { discordService } = await import("./discordService");
        await discordService.sendNotification({
            title: "🔒 Alerte Sécurité — Connexion suspecte",
            message: `**Compte :** \`${username}\`\n**IP :** \`${ip || "inconnue"}\`\n**Raison :** ${reason}\n**Heure :** ${new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}`,
            type: "error",
        });
    } catch (err) {
        console.error("[Security] Discord alert failed:", err);
    }
}

export function getLoginAttemptStats(): { locked: string[]; suspicious: string[] } {
    const locked: string[] = [];
    const suspicious: string[] = [];
    loginAttempts.forEach((entry, username) => {
        if (entry.lockedUntil && entry.lockedUntil > new Date()) {
            locked.push(username);
        } else if (entry.attempts >= 3) {
            suspicious.push(username);
        }
    });
    return { locked, suspicious };
}

export interface AuthResult {
  success: boolean;
  user?: User;
  session?: Session;
  error?: string;
}

export class AuthService {
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  generateSessionToken(): string {
    return randomBytes(32).toString("hex");
  }

  getSessionExpiry(): Date {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + SESSION_DURATION_DAYS);
    return expiry;
  }

  async createSession(userId: number, userAgent?: string, ipAddress?: string): Promise<Session> {
    const token = this.generateSessionToken();
    const expiresAt = this.getSessionExpiry();

    const [session] = await db
      .insert(sessions)
      .values({
        id: token,
        userId,
        expiresAt,
        userAgent,
        ipAddress,
      })
      .returning();

    return session;
  }

  async validateSession(token: string): Promise<AuthResult> {
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, token))
      .limit(1);

    if (!session) {
      return { success: false, error: "Session not found" };
    }

    if (new Date() > session.expiresAt) {
      await this.deleteSession(token);
      return { success: false, error: "Session expired" };
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    if (!user) {
      return { success: false, error: "User not found" };
    }

    // Rolling session: extend expiry if less than threshold days remaining
    const now = new Date();
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() + SESSION_RENEWAL_THRESHOLD_DAYS);
    
    if (session.expiresAt < thresholdDate) {
      const newExpiry = this.getSessionExpiry();
      await db
        .update(sessions)
        .set({ expiresAt: newExpiry })
        .where(eq(sessions.id, token));
      
      // Update session object with new expiry for return
      session.expiresAt = newExpiry;
      console.log(`[Auth] Session renewed for user ${user.id}, new expiry: ${newExpiry.toISOString()}`);
    }

    return { success: true, user, session };
  }

  async deleteSession(token: string): Promise<void> {
    await db.delete(sessions).where(eq(sessions.id, token));
  }

  async deleteAllUserSessions(userId: number): Promise<void> {
    await db.delete(sessions).where(eq(sessions.userId, userId));
  }

  async findUserByUsername(username: string): Promise<User | null> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    return user || null;
  }

  async updateUser(userId: number, updates: Record<string, string>): Promise<void> {
    const mapped: any = {};
    if (updates.username) mapped.username = updates.username;
    if (updates.password) mapped.password = updates.password;
    if (updates.plainPassword) mapped.plainPassword = updates.plainPassword;
    if (updates.displayName) mapped.displayName = updates.displayName;
    await db.update(users).set(mapped).where(eq(users.id, userId));
  }

  async deleteUser(userId: number): Promise<void> {
    await db.delete(users).where(eq(users.id, userId));
  }

  async createSessionForUser(userId: number, userAgent?: string, ipAddress?: string): Promise<Session> {
    return this.createSession(userId, userAgent, ipAddress);
  }

  async registerOwner(username: string, password: string, displayName: string): Promise<AuthResult> {
    const existingOwner = await db
      .select()
      .from(users)
      .where(eq(users.isOwner, true))
      .limit(1);

    if (existingOwner.length > 0) {
      return { success: false, error: "Owner already exists" };
    }

    const hashedPassword = await this.hashPassword(password);

    const [user] = await db
      .insert(users)
      .values({
        username,
        password: hashedPassword,
        displayName,
        role: "owner",
        isOwner: true,
      })
      .returning();

    const session = await this.createSession(user.id);

    return { success: true, user, session };
  }

  async login(username: string, password: string, userAgent?: string, ipAddress?: string): Promise<AuthResult> {
    // ── Brute force check ──────────────────────────────────────
    const lockStatus = isLocked(username);
    if (lockStatus.locked) {
        const msg = `Compte verrouillé pour ${lockStatus.minutesLeft} minute(s) suite à trop de tentatives.`;
        try {
            await db.insert(auditLogs).values({
                userId: null,
                action: "LOGIN_BLOCKED",
                resource: "/api/auth/login",
                details: { username, reason: "account_locked", minutesLeft: lockStatus.minutesLeft },
                ipAddress: ipAddress || null,
                timestamp: new Date(),
            });
        } catch {}
        return { success: false, error: msg };
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    if (!user) {
      const entry = recordFailedAttempt(username);
      try {
          await db.insert(auditLogs).values({
              userId: null, action: "LOGIN_FAILED", resource: "/api/auth/login",
              details: { username, reason: "user_not_found", attempts: entry.attempts },
              ipAddress: ipAddress || null, timestamp: new Date(),
          });
      } catch {}
      if (entry.attempts >= MAX_FAILED_ATTEMPTS) {
          sendSecurityAlertDiscord(username, ipAddress, `Compte inconnu verrouillé après ${entry.attempts} tentatives`).catch(() => {});
      }
      return { success: false, error: "Identifiants invalides" };
    }

    const validPassword = await this.verifyPassword(password, user.password);
    if (!validPassword) {
      const entry = recordFailedAttempt(username);
      try {
          await db.insert(auditLogs).values({
              userId: user.id, action: "LOGIN_FAILED", resource: "/api/auth/login",
              details: { username, reason: "wrong_password", attempts: entry.attempts },
              ipAddress: ipAddress || null, timestamp: new Date(),
          });
      } catch {}
      if (entry.attempts >= MAX_FAILED_ATTEMPTS) {
          sendSecurityAlertDiscord(username, ipAddress, `Compte \`${username}\` verrouillé après ${entry.attempts} tentatives de connexion échouées`).catch(() => {});
      } else if (entry.attempts === 3) {
          sendSecurityAlertDiscord(username, ipAddress, `3 tentatives de connexion échouées sur le compte \`${username}\` — encore ${MAX_FAILED_ATTEMPTS - entry.attempts} avant verrouillage`).catch(() => {});
      }
      return { success: false, error: "Identifiants invalides" };
    }

    if (!user.isOwner) {
      const [approval] = await db
        .select()
        .from(approvedUsers)
        .where(eq(approvedUsers.userId, user.id))
        .limit(1);

      if (!approval) {
        return { success: false, error: "Utilisateur non autorisé" };
      }
    }

    // ── Success: clear attempt counter ─────────────────────────
    clearAttempts(username);
    try {
        await db.insert(auditLogs).values({
            userId: user.id, action: "LOGIN_SUCCESS", resource: "/api/auth/login",
            details: { username, userAgent: userAgent?.substring(0, 80) },
            ipAddress: ipAddress || null, timestamp: new Date(),
        });
    } catch {}

    const session = await this.createSession(user.id, userAgent, ipAddress);
    return { success: true, user, session };
  }

  async getOwner(): Promise<User | null> {
    const [owner] = await db
      .select()
      .from(users)
      .where(eq(users.isOwner, true))
      .limit(1);

    return owner || null;
  }

  async isUserApproved(userId: number): Promise<boolean> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return false;
    if (user.isOwner) return true;

    const [approval] = await db
      .select()
      .from(approvedUsers)
      .where(eq(approvedUsers.userId, userId))
      .limit(1);

    return !!approval;
  }

  async getApprovedUsers(): Promise<(ApprovedUser & { user: User })[]> {
    const approvals = await db.select().from(approvedUsers);
    const result: (ApprovedUser & { user: User })[] = [];

    for (const approval of approvals) {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, approval.userId))
        .limit(1);

      if (user) {
        result.push({ ...approval, user });
      }
    }

    return result;
  }

  async approveUser(userId: number, ownerId: number, accessLevel: string = "basic", note?: string): Promise<ApprovedUser> {
    const [approval] = await db
      .insert(approvedUsers)
      .values({
        userId,
        approvedBy: ownerId,
        accessLevel,
        note,
      })
      .returning();

    await db
      .update(users)
      .set({ role: "approved" })
      .where(eq(users.id, userId));

    return approval;
  }

  async revokeApproval(userId: number): Promise<void> {
    await db.delete(approvedUsers).where(eq(approvedUsers.userId, userId));
    await db
      .update(users)
      .set({ role: "guest" })
      .where(eq(users.id, userId));
    await this.deleteAllUserSessions(userId);
  }

  async registerUser(username: string, password: string, displayName?: string): Promise<User> {
    const hashedPassword = await this.hashPassword(password);

    const [user] = await db
      .insert(users)
      .values({
        username,
        password: hashedPassword,
        displayName,
        role: "guest",
        isOwner: false,
      })
      .returning();

    return user;
  }

  async storeWebAuthnCredential(
    userId: number,
    credentialId: string,
    publicKey: string,
    counter: number,
    deviceType?: string,
    transports?: string[]
  ): Promise<void> {
    await db.insert(webauthnCredentials).values({
      id: credentialId,
      userId,
      publicKey,
      counter,
      deviceType,
      transports,
    });
  }

  async getWebAuthnCredentials(userId: number) {
    return db
      .select()
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.userId, userId));
  }

  async updateWebAuthnCounter(credentialId: string, counter: number): Promise<void> {
    await db
      .update(webauthnCredentials)
      .set({ counter })
      .where(eq(webauthnCredentials.id, credentialId));
  }

  async getWebAuthnCredentialById(credentialId: string) {
    const [credential] = await db
      .select()
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.id, credentialId))
      .limit(1);

    return credential;
  }
}

export const authService = new AuthService();
