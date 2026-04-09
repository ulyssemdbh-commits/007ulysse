/**
 * Shared DevMax infrastructure: auth middleware, helpers, constants.
 * Extracted from the monolithic devmaxAuth.ts for reuse across sub-routers.
 */
import { Request, Response, NextFunction } from "express";
import { db } from "../../db";
import { devmaxSessions, devmaxActivityLog } from "@shared/schema";
import { eq, and, gt } from "drizzle-orm";
import { sql } from "drizzle-orm";

export const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;
export const MAX_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 30 * 60 * 1000;
export const ADMIN_PIN = process.env.DEVMAX_ADMIN_PIN || "123adminMDBH";

// ── Auth helpers ──

export async function hashPin(pin: string): Promise<string> {
  const bcrypt = await import("bcryptjs");
  return bcrypt.hash(pin, 10);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  const bcrypt = await import("bcryptjs");
  if (hash.startsWith("$2")) {
    return bcrypt.compare(pin, hash);
  }
  const crypto = await import("crypto");
  const sha256 = crypto.createHash("sha256").update(pin).digest("hex");
  return sha256 === hash;
}

export async function hashPassword(password: string): Promise<string> {
  const crypto = await import("crypto");
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const crypto = await import("crypto");
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return test === hash;
}

// ── Middleware ──

export function requireDevmaxAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return res.status(401).json({ error: "DevMax authentication required" });

  db.select().from(devmaxSessions)
    .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
    .limit(1)
    .then(([session]) => {
      if (!session) return res.status(401).json({ error: "Session expired" });
      (req as Request & { devmaxSession?: typeof session }).devmaxSession = session;
      db.update(devmaxSessions)
        .set({ lastActiveAt: new Date() })
        .where(eq(devmaxSessions.id, token))
        .catch(() => {});
      next();
    })
    .catch(() => res.status(500).json({ error: "Auth error" }));
}

export function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const adminToken = req.headers["x-devmax-admin"] as string;
  if (!adminToken) return res.status(401).json({ error: "Admin auth required" });
  db.execute(sql`SELECT id FROM devmax_sessions WHERE id = ${adminToken} AND expires_at > NOW()`)
    .then((r: { rows?: { id: string }[] }) => {
      const rows = (r.rows || r) as { id: string }[];
      if (!rows.length) return res.status(401).json({ error: "Admin session expired" });
      next();
    })
    .catch(() => res.status(500).json({ error: "Auth error" }));
}

// ── Activity logging ──

export async function logDevmaxActivity(req: Request, action: string, target?: string, details?: Record<string, unknown>) {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return;
  await db.insert(devmaxActivityLog).values({
    sessionId: token,
    action,
    target,
    details,
  }).catch(() => {});
}
