import { Router, Request, Response } from "express";
import { db } from "../db";
import { guestSessions } from "@shared/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

const router = Router();

// Alfred access control - set to false to suspend Alfred connections
const ALFRED_ENABLED = false;

router.post("/init", async (req: Request, res: Response) => {
  try {
    // Check if Alfred is suspended
    if (!ALFRED_ENABLED) {
      return res.status(503).json({ 
        error: "Service temporarily unavailable",
        message: "Max est temporairement indisponible. Veuillez réessayer plus tard."
      });
    }
    const existingSessionId = req.cookies?.alfredGuestSession;
    
    if (existingSessionId) {
      const [existing] = await db.select()
        .from(guestSessions)
        .where(eq(guestSessions.id, existingSessionId))
        .limit(1);
      
      if (existing) {
        await db.update(guestSessions)
          .set({ lastActiveAt: new Date() })
          .where(eq(guestSessions.id, existingSessionId));
        
        return res.json({
          sessionId: existing.id,
          displayName: existing.displayName,
          messageCount: existing.messageCount,
          isNew: false,
        });
      }
    }
    
    const sessionId = randomUUID();
    const userAgent = req.headers["user-agent"] || "unknown";
    const ipAddress = req.ip || req.socket.remoteAddress || "unknown";
    
    const [newSession] = await db.insert(guestSessions).values({
      id: sessionId,
      userAgent,
      ipAddress,
    }).returning();
    
    res.cookie("alfredGuestSession", sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    
    res.json({
      sessionId: newSession.id,
      displayName: null,
      messageCount: 0,
      isNew: true,
    });
  } catch (error) {
    console.error("[GuestSession] Init error:", error);
    res.status(500).json({ error: "Failed to initialize session" });
  }
});

router.post("/name", async (req: Request, res: Response) => {
  try {
    const sessionId = req.cookies?.alfredGuestSession;
    if (!sessionId) {
      return res.status(401).json({ error: "No guest session" });
    }
    
    const { displayName } = req.body;
    if (!displayName || typeof displayName !== "string") {
      return res.status(400).json({ error: "Display name required" });
    }
    
    await db.update(guestSessions)
      .set({ displayName: displayName.trim().slice(0, 50) })
      .where(eq(guestSessions.id, sessionId));
    
    res.json({ success: true, displayName: displayName.trim().slice(0, 50) });
  } catch (error) {
    console.error("[GuestSession] Name error:", error);
    res.status(500).json({ error: "Failed to update name" });
  }
});

router.get("/status", async (req: Request, res: Response) => {
  try {
    const sessionId = req.cookies?.alfredGuestSession;
    if (!sessionId) {
      return res.json({ hasSession: false });
    }
    
    const [session] = await db.select()
      .from(guestSessions)
      .where(eq(guestSessions.id, sessionId))
      .limit(1);
    
    if (!session) {
      return res.json({ hasSession: false });
    }
    
    res.json({
      hasSession: true,
      sessionId: session.id,
      displayName: session.displayName,
      messageCount: session.messageCount,
    });
  } catch (error) {
    console.error("[GuestSession] Status error:", error);
    res.status(500).json({ error: "Failed to get status" });
  }
});

export default router;
