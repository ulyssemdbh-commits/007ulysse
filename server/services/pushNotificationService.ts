import webpush from "web-push";
import { db } from "../db";
import { pushSubscriptions } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:ulysse@ulysseproject.com";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log("[PushNotification] VAPID configured");
} else {
  console.warn("[PushNotification] VAPID keys not set — push disabled");
}

export type AlertType = "morning_briefing" | "anomaly" | "sports" | "task_reminder";

interface PushPayload {
  title: string;
  body: string;
  url?: string;
  alertType?: AlertType;
  actions?: Array<{ action: string; title: string }>;
}

async function subscribe(
  userId: number,
  endpoint: string,
  p256dh: string,
  auth: string,
  deviceName?: string,
  alertTypes?: AlertType[]
) {
  const existing = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(pushSubscriptions)
      .set({
        userId,
        p256dh,
        auth,
        deviceName: deviceName || existing[0].deviceName,
        alertTypes: alertTypes || existing[0].alertTypes,
        isActive: true,
      })
      .where(eq(pushSubscriptions.endpoint, endpoint));
    return existing[0].id;
  }

  const [inserted] = await db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint,
      p256dh,
      auth,
      deviceName,
      alertTypes: alertTypes || ["morning_briefing", "anomaly", "sports", "task_reminder"],
      isActive: true,
    })
    .returning({ id: pushSubscriptions.id });

  return inserted.id;
}

async function unsubscribe(endpoint: string) {
  await db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint));
}

async function sendPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload
): Promise<boolean> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      },
      JSON.stringify(payload),
      { TTL: 86400 }
    );
    return true;
  } catch (err: any) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      await db
        .delete(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, subscription.endpoint));
      console.log("[PushNotification] Removed stale subscription");
    } else {
      console.error("[PushNotification] Send error:", err.message);
    }
    return false;
  }
}

async function sendToUser(userId: number, payload: PushPayload): Promise<number> {
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.isActive, true)));

  let sent = 0;
  for (const sub of subs) {
    if (payload.alertType && sub.alertTypes && !sub.alertTypes.includes(payload.alertType)) {
      continue;
    }
    const ok = await sendPush(sub, payload);
    if (ok) sent++;
  }
  return sent;
}

async function sendToAll(payload: PushPayload): Promise<number> {
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.isActive, true));

  let sent = 0;
  for (const sub of subs) {
    if (payload.alertType && sub.alertTypes && !sub.alertTypes.includes(payload.alertType)) {
      continue;
    }
    const ok = await sendPush(sub, payload);
    if (ok) sent++;
  }
  return sent;
}

async function getUserSubscriptions(userId: number) {
  return db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
}

function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}

export const pushNotificationService = {
  subscribe,
  unsubscribe,
  sendPush,
  sendToUser,
  sendToAll,
  getUserSubscriptions,
  getVapidPublicKey,
};
