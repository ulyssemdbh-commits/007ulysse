import { Router, Request, Response } from "express";
import {
  sendCobaChatMessage,
  getCobaChatHistory,
  clearCobaChatSession,
  getCobaChatStats,
} from "../services/cobaChatService";

const router = Router();

const COBA_API_KEY = process.env.COBA_API_KEY || "coba-apptoorder-2025";
const ALLOWED_ORIGINS = [
  "https://macommande.shop",
  "https://www.macommande.shop",
  "https://ulysseproject.org",
  "https://www.ulysseproject.org",
  "https://ulyssepro.org",
  "https://www.ulyssepro.org",
  "http://localhost:3000",
  "http://localhost:5000",
];

function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.some(o => origin.startsWith(o))) return true;
  if (/\.replit\.dev$/.test(origin) || /\.replit\.app$/.test(origin)) return true;
  return false;
}

router.use((req: Request, res: Response, next) => {
  const origin = req.headers.origin as string;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "https://macommande.shop");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-coba-key");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function authMiddleware(req: Request, res: Response, next: Function) {
  const key = req.headers["x-coba-key"] as string;
  if (!key || key !== COBA_API_KEY) {
    return res.status(401).json({ error: "Invalid COBA API key" });
  }
  next();
}

function validateProUser(req: Request, res: Response, next: Function) {
  const tenantId = req.body?.tenantId || req.query?.tenantId;
  const proUserId = req.body?.proUserId || req.query?.proUserId;
  if (!tenantId || !proUserId) {
    return res.status(400).json({ error: "tenantId and proUserId are required" });
  }
  next();
}

router.use(authMiddleware);

router.post("/message", validateProUser, async (req: Request, res: Response) => {
  try {
    const { tenantId, proUserId, message, proUserName, restaurantName } = req.body;
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({ error: "message is required" });
    }
    if (message.length > 2000) {
      return res.status(400).json({ error: "Message trop long (max 2000 caractères)" });
    }

    console.log(`[ChatCOBA] Message from ${proUserId}@${tenantId}: ${message.substring(0, 80)}...`);

    const result = await sendCobaChatMessage(tenantId, proUserId, message.trim(), proUserName, restaurantName);
    res.json({ ok: true, reply: result.reply, sessionId: result.sessionId });
  } catch (err: any) {
    console.error("[ChatCOBA] Message error:", err.message);
    res.status(500).json({ error: "Erreur lors du traitement du message" });
  }
});

router.get("/history", async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenantId as string;
    const proUserId = req.query.proUserId as string;
    if (!tenantId || !proUserId) {
      return res.status(400).json({ error: "tenantId and proUserId required" });
    }
    const limit = parseInt(req.query.limit as string) || 50;
    const history = await getCobaChatHistory(tenantId, proUserId, limit);
    res.json({ ok: true, ...history });
  } catch (err: any) {
    console.error("[ChatCOBA] History error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/clear", validateProUser, async (req: Request, res: Response) => {
  try {
    const { tenantId, proUserId } = req.body;
    const result = await clearCobaChatSession(tenantId, proUserId);
    res.json(result);
  } catch (err: any) {
    console.error("[ChatCOBA] Clear error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const stats = await getCobaChatStats();
    res.json({ ok: true, stats });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
