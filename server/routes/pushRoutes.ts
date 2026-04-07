import { Router, Request, Response } from "express";
import { pushNotificationService } from "../services/pushNotificationService";
import { z } from "zod";

const router = Router();

router.get("/vapid-key", (_req: Request, res: Response) => {
  const key = pushNotificationService.getVapidPublicKey();
  if (!key) {
    return res.status(503).json({ error: "Push not configured" });
  }
  res.json({ publicKey: key });
});

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
  deviceName: z.string().optional(),
  alertTypes: z.array(z.enum(["morning_briefing", "anomaly", "sports", "task_reminder"])).optional(),
});

router.post("/subscribe", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Authentication required" });

    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid subscription", details: parsed.error.issues });
    }

    const { endpoint, keys, deviceName, alertTypes } = parsed.data;
    const id = await pushNotificationService.subscribe(
      userId,
      endpoint,
      keys.p256dh,
      keys.auth,
      deviceName,
      alertTypes as any
    );

    res.json({ success: true, id });
  } catch (err: any) {
    console.error("[Push/subscribe]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/unsubscribe", async (req: Request, res: Response) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: "endpoint required" });

    await pushNotificationService.unsubscribe(endpoint);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/test", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Authentication required" });

    const sent = await pushNotificationService.sendToUser(userId, {
      title: "Ulysse - Test",
      body: "Les notifications push fonctionnent correctement !",
      url: "/",
    });

    res.json({ success: true, sent });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/subscriptions", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Authentication required" });

    const subs = await pushNotificationService.getUserSubscriptions(userId);
    res.json({
      success: true,
      count: subs.length,
      subscriptions: subs.map((s) => ({
        id: s.id,
        deviceName: s.deviceName,
        alertTypes: s.alertTypes,
        isActive: s.isActive,
        createdAt: s.createdAt,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/subscriptions/:id/alerts", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Authentication required" });

    const { alertTypes } = req.body;
    if (!Array.isArray(alertTypes)) {
      return res.status(400).json({ error: "alertTypes must be an array" });
    }

    const { db } = await import("../db");
    const { pushSubscriptions } = await import("@shared/schema");
    const { eq, and } = await import("drizzle-orm");

    await db
      .update(pushSubscriptions)
      .set({ alertTypes })
      .where(
        and(
          eq(pushSubscriptions.id, parseInt(req.params.id)),
          eq(pushSubscriptions.userId, userId)
        )
      );

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
