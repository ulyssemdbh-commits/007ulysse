import { Router, Request, Response } from "express";
import { db } from "../../db";
import { devices, apiTokens, users } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcrypt";
import crypto from "crypto";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("[V2 Auth] CRITICAL: JWT_SECRET environment variable is not set!");
  console.error("[V2 Auth] V2 API authentication will be disabled until JWT_SECRET is configured.");
}
const ACCESS_TOKEN_EXPIRY = 15 * 60 * 1000; // 15 minutes
const REFRESH_TOKEN_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30 days

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function createAccessToken(userId: number, deviceId: number): string {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET not configured - cannot create access tokens");
  }
  const payload = {
    userId,
    deviceId,
    exp: Date.now() + ACCESS_TOKEN_EXPIRY,
    iat: Date.now(),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", JWT_SECRET).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

export function verifyAccessToken(token: string): { userId: number; deviceId: number } | null {
  if (!JWT_SECRET) {
    return null; // Cannot verify tokens without secret
  }
  try {
    const [encodedPayload, signature] = token.split(".");
    if (!encodedPayload || !signature) return null;
    
    const expectedSignature = crypto.createHmac("sha256", JWT_SECRET).update(encodedPayload).digest("base64url");
    
    if (signature !== expectedSignature) return null;
    
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString());
    if (payload.exp < Date.now()) return null;
    
    return { userId: payload.userId, deviceId: payload.deviceId };
  } catch {
    return null;
  }
}

const registerDeviceSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  deviceName: z.string().min(1),
  deviceType: z.enum(["iphone", "android", "desktop", "tablet", "web"]).default("web"),
  deviceIdentifier: z.string().min(1),
});

router.post("/register", async (req: Request, res: Response) => {
  try {
    const body = registerDeviceSchema.parse(req.body);
    
    const [user] = await db.select().from(users).where(eq(users.username, body.username));
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const validPassword = await bcrypt.compare(body.password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    let [device] = await db.select().from(devices).where(eq(devices.deviceIdentifier, body.deviceIdentifier));
    
    if (!device) {
      [device] = await db.insert(devices).values({
        userId: user.id,
        deviceName: body.deviceName,
        deviceType: body.deviceType,
        deviceIdentifier: body.deviceIdentifier,
        lastIp: req.ip,
        userAgent: req.headers["user-agent"] || null,
      }).returning();
    } else {
      await db.update(devices)
        .set({
          lastSeen: new Date(),
          lastIp: req.ip,
          userAgent: req.headers["user-agent"] || null,
        })
        .where(eq(devices.id, device.id));
    }

    const refreshToken = generateToken();
    const tokenHash = await bcrypt.hash(refreshToken, 10);

    await db.insert(apiTokens).values({
      userId: user.id,
      deviceId: device.id,
      tokenHash,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY),
    });

    const accessToken = createAccessToken(user.id, device.id);

    res.json({
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_EXPIRY / 1000,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        isOwner: user.isOwner,
      },
      device: {
        id: device.id,
        name: device.deviceName,
        type: device.deviceType,
      },
    });
  } catch (error: any) {
    console.error("[V2 Devices] Register error:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
  deviceIdentifier: z.string().min(1),
});

router.post("/refresh", async (req: Request, res: Response) => {
  try {
    const body = refreshSchema.parse(req.body);

    const [device] = await db.select().from(devices).where(eq(devices.deviceIdentifier, body.deviceIdentifier));
    if (!device) {
      return res.status(401).json({ error: "Device not found" });
    }

    const tokens = await db.select().from(apiTokens)
      .where(and(
        eq(apiTokens.deviceId, device.id),
        eq(apiTokens.isRevoked, false)
      ));

    let validToken = null;
    for (const token of tokens) {
      const isValid = await bcrypt.compare(body.refreshToken, token.tokenHash);
      if (isValid && new Date(token.expiresAt) > new Date()) {
        validToken = token;
        break;
      }
    }

    if (!validToken) {
      return res.status(401).json({ error: "Invalid or expired refresh token" });
    }

    await db.update(apiTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiTokens.id, validToken.id));

    await db.update(devices)
      .set({ lastSeen: new Date() })
      .where(eq(devices.id, device.id));

    const accessToken = createAccessToken(device.userId, device.id);

    res.json({
      accessToken,
      expiresIn: ACCESS_TOKEN_EXPIRY / 1000,
    });
  } catch (error: any) {
    console.error("[V2 Devices] Refresh error:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const userDevices = await db.select().from(devices).where(eq(devices.userId, userId));

    res.json({
      devices: userDevices.map(d => ({
        id: d.id,
        name: d.deviceName,
        type: d.deviceType,
        lastSeen: d.lastSeen,
        isActive: d.isActive,
      })),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/:deviceId", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const deviceId = parseInt(req.params.deviceId);

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const [device] = await db.select().from(devices)
      .where(and(eq(devices.id, deviceId), eq(devices.userId, userId)));

    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    await db.update(apiTokens)
      .set({ isRevoked: true })
      .where(eq(apiTokens.deviceId, deviceId));

    await db.update(devices)
      .set({ isActive: false })
      .where(eq(devices.id, deviceId));

    res.json({ success: true, message: "Device disconnected" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
