import express, { Request, Response } from "express";
import { storage } from "../storage";
import { codeSnapshotService } from "../services/codeSnapshot";
import { timingSafeEqual } from "crypto";

const router = express.Router();

const BACKOFF_SCHEDULE_MS = [
  1 * 60 * 1000,
  2 * 60 * 1000,
  4 * 60 * 1000,
  8 * 60 * 1000,
  15 * 60 * 1000
];
const COOLING_PERIOD_MS = 60 * 60 * 1000;
const pinAttempts = new Map<number, { count: number; lastAttempt: number; lockedUntil: number }>();

function checkPinRateLimit(userId: number): { allowed: boolean; lockoutMinutes?: number } {
  const attempt = pinAttempts.get(userId);
  if (!attempt) return { allowed: true };
  
  const now = Date.now();
  const elapsed = now - attempt.lastAttempt;
  
  if (elapsed > COOLING_PERIOD_MS) {
    pinAttempts.delete(userId);
    return { allowed: true };
  }
  
  if (attempt.lockedUntil > now) {
    const remainingMs = attempt.lockedUntil - now;
    return { allowed: false, lockoutMinutes: Math.ceil(remainingMs / 60000) };
  }
  
  return { allowed: true };
}

function recordPinAttempt(userId: number, success: boolean): void {
  if (success) {
    pinAttempts.delete(userId);
    return;
  }
  
  const now = Date.now();
  const attempt = pinAttempts.get(userId) || { count: 0, lastAttempt: 0, lockedUntil: 0 };
  const newCount = attempt.count + 1;
  
  const backoffIndex = Math.min(newCount - 1, BACKOFF_SCHEDULE_MS.length - 1);
  const lockoutDuration = BACKOFF_SCHEDULE_MS[backoffIndex];
  
  pinAttempts.set(userId, {
    count: newCount,
    lastAttempt: now,
    lockedUntil: now + lockoutDuration
  });
}

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

function getUserId(req: Request): number {
  const userId = (req.session as any)?.userId;
  if (!userId) {
    throw new Error("User not authenticated");
  }
  return userId;
}

const verifyOwnerWithPin = async (req: Request, res: Response): Promise<number | null> => {
  try {
    const userId = getUserId(req);
    const user = await storage.getUser(userId);
    
    if (!user?.isOwner) {
      res.status(403).json({ message: "Access denied: Owner only" });
      return null;
    }
    
    const rateLimit = checkPinRateLimit(userId);
    if (!rateLimit.allowed) {
      console.warn(`[SECURITY] User ${userId} locked out for ${rateLimit.lockoutMinutes} minutes`);
      res.status(429).json({ 
        message: `Too many failed attempts. Try again in ${rateLimit.lockoutMinutes} minutes.` 
      });
      return null;
    }
    
    const ownerPin = process.env.OWNER_CODE_PIN;
    if (!ownerPin) {
      console.error("[SECURITY] OWNER_CODE_PIN not configured");
      res.status(503).json({ message: "Feature not configured" });
      return null;
    }
    
    const providedPin = String(req.headers["x-owner-pin"] || req.body?.pin || "");
    if (!providedPin || !constantTimeCompare(providedPin, ownerPin)) {
      recordPinAttempt(userId, false);
      const attemptData = pinAttempts.get(userId);
      const attempts = attemptData?.count || 1;
      const lockoutMins = attemptData?.lockedUntil ? Math.ceil((attemptData.lockedUntil - Date.now()) / 60000) : 1;
      console.warn(`[SECURITY] Invalid PIN attempt from user ${userId} (attempt ${attempts}, locked for ${lockoutMins}min)`);
      res.status(401).json({ 
        message: "Invalid verification PIN",
        lockoutMinutes: lockoutMins
      });
      return null;
    }
    
    recordPinAttempt(userId, true);
    return userId;
  } catch (err) {
    res.status(500).json({ message: "Authentication error" });
    return null;
  }
};

router.post("/owner/code-snapshot", async (req, res) => {
  const ownerId = await verifyOwnerWithPin(req, res);
  if (!ownerId) return;

  try {
    const ipAddress = req.ip || req.headers["x-forwarded-for"]?.toString();
    const userAgent = req.headers["user-agent"];
    
    const snapshot = await codeSnapshotService.captureCodeSnapshot(
      ownerId,
      ipAddress,
      userAgent
    );

    console.log(`[AUDIT] Code snapshot created by owner ${ownerId} - version ${snapshot.version}`);

    res.status(201).json({
      success: true,
      snapshot: {
        id: snapshot.id,
        version: snapshot.version,
        summary: snapshot.summary,
        filesCount: snapshot.filesCount,
        totalSize: snapshot.totalSize,
        keyComponents: snapshot.keyComponents,
        createdAt: snapshot.createdAt,
      },
    });
  } catch (err: any) {
    console.error("Failed to create code snapshot:", err);
    const errorMessage = err.message || String(err);
    if (errorMessage.includes("Rate limited")) {
      return res.status(429).json({ message: errorMessage });
    }
    res.status(500).json({ message: `Failed to create code snapshot: ${errorMessage}` });
  }
});

router.get("/owner/code-snapshot/summary", async (req, res) => {
  const ownerId = await verifyOwnerWithPin(req, res);
  if (!ownerId) return;

  try {
    const summary = await codeSnapshotService.getSnapshotSummary(ownerId);
    res.json(summary);
  } catch (err) {
    console.error("Failed to get snapshot summary:", err);
    res.status(500).json({ message: "Failed to get snapshot summary" });
  }
});

router.get("/owner/code-snapshots", async (req, res) => {
  const ownerId = await verifyOwnerWithPin(req, res);
  if (!ownerId) return;

  try {
    const snapshots = await codeSnapshotService.getAllSnapshots(ownerId);
    res.json(snapshots);
  } catch (err) {
    console.error("Failed to get snapshots:", err);
    res.status(500).json({ message: "Failed to get snapshots" });
  }
});

router.get("/owner/code-snapshot/rate-limit", async (req, res) => {
  const ownerId = await verifyOwnerWithPin(req, res);
  if (!ownerId) return;

  try {
    const rateCheck = await codeSnapshotService.checkRateLimit(ownerId);
    res.json({
      canCreate: rateCheck.allowed,
      waitMinutes: rateCheck.waitMs ? Math.ceil(rateCheck.waitMs / 60000) : 0,
    });
  } catch (err) {
    console.error("Failed to check rate limit:", err);
    res.status(500).json({ message: "Failed to check rate limit" });
  }
});

export default router;
