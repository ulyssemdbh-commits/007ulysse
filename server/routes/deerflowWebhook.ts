import { Router, Request, Response } from "express";
import crypto from "crypto";
import { db } from "../db";
import { ulysseMemory } from "@shared/schema";
import { authService } from "../services/auth";
import { memoryGraphService } from "../services/memoryGraphService";
import { requireOwner } from "../middleware/auth";
import { brainPulse } from "../services/sensory/BrainPulse";
import { markDeerflowResearchCompleted } from "../services/tools/maxAdvancedTools";

const LOG_PREFIX = "[DeerFlow]";

interface DeerflowSource {
  url?: string;
  title?: string;
}

interface DeerflowResearchPayload {
  title?: string;
  summary?: string;
  query?: string;
  sources?: Array<DeerflowSource | string>;
  timestamp?: string | number;
  research_id?: string;
  metadata?: Record<string, unknown>;
}

function rawBodyToString(req: Request): string {
  const raw = req.rawBody;
  if (typeof raw === "string") return raw;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  return JSON.stringify(req.body ?? {});
}

function verifyHmac(rawBody: string, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader) return false;
  const sig = signatureHeader.startsWith("sha256=") ? signatureHeader.slice(7) : signatureHeader;
  if (!/^[0-9a-fA-F]+$/.test(sig)) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const processedDeliveries = new Map<string, number>();
setInterval(() => {
  const cutoff = Date.now() - 600_000;
  for (const [id, ts] of processedDeliveries) {
    if (ts < cutoff) processedDeliveries.delete(id);
  }
}, 120_000);

// ===== Auth router (mounted at /api/deerflow) =====
// Backs nginx auth_request on deerflow.ulyssepro.org.
export const deerflowAuthRouter = Router();

deerflowAuthRouter.get("/auth-check", requireOwner, (_req: Request, res: Response) => {
  res.status(200).json({ ok: true, owner: true });
});

deerflowAuthRouter.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "deerflow-bridge",
    webhook_secret_configured: !!process.env.DEERFLOW_WEBHOOK_SECRET,
    timestamp: new Date().toISOString(),
  });
});

// ===== Webhook handler (mounted as POST /api/webhooks/deerflow) =====
export async function handleDeerflowWebhook(req: Request, res: Response): Promise<void> {
  const secret = process.env.DEERFLOW_WEBHOOK_SECRET;
  if (!secret) {
    console.error(`${LOG_PREFIX} DEERFLOW_WEBHOOK_SECRET not configured — rejecting webhook`);
    res.status(503).json({ error: "Webhook secret not configured" });
    return;
  }

  const rawBody = rawBodyToString(req);
  const signature = (req.headers["x-deerflow-signature"] || req.headers["x-hub-signature-256"]) as string | undefined;
  if (!verifyHmac(rawBody, signature, secret)) {
    console.warn(`${LOG_PREFIX} Invalid signature from ${req.ip}`);
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const deliveryId = (req.headers["x-deerflow-delivery"] || req.headers["x-delivery-id"]) as string | undefined;
  if (deliveryId && processedDeliveries.has(deliveryId)) {
    res.json({ ok: true, deduplicated: true });
    return;
  }
  if (deliveryId) processedDeliveries.set(deliveryId, Date.now());

  const payload = (req.body ?? {}) as DeerflowResearchPayload;

  const title = (payload.title || payload.query || "DeerFlow research").toString().slice(0, 240);
  const summary = (payload.summary || "").toString();
  const sources: Array<DeerflowSource | string> = Array.isArray(payload.sources) ? payload.sources : [];
  const ts = payload.timestamp ? new Date(payload.timestamp).toISOString() : new Date().toISOString();

  try {
    const owner = await authService.getOwner();
    if (!owner) {
      console.error(`${LOG_PREFIX} No owner user found — cannot persist research`);
      res.status(500).json({ error: "Owner not found" });
      return;
    }

    const sourceUrls = sources
      .map(s => (typeof s === "string" ? s : s?.url))
      .filter((u): u is string => typeof u === "string" && u.length > 0)
      .slice(0, 20);

    const valueText = [
      summary || "(no summary)",
      sourceUrls.length > 0 ? `\nSources:\n- ${sourceUrls.join("\n- ")}` : "",
    ].join("");

    const [inserted] = await db.insert(ulysseMemory).values({
      userId: owner.id,
      category: "deerflow_research",
      key: title,
      value: valueText.slice(0, 4000),
      confidence: 70,
      source: "deerflow_webhook",
      verified: false,
      metadata: {
        research_id: payload.research_id ?? null,
        query: payload.query ?? null,
        sources,
        receivedAt: ts,
        ...(payload.metadata ?? {}),
      },
    }).returning();

    if (inserted?.id) {
      memoryGraphService.autoConnect(inserted.id).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${LOG_PREFIX} autoConnect failed for memory ${inserted.id}: ${msg}`);
      });
    }

    // Marque la recherche comme complétée dans le tracker des pending
    const wasPending = markDeerflowResearchCompleted(payload.research_id);

    // Pulse le cerveau Ulysse — visible en live sur le 3D brain du Dashboard
    brainPulse(
      ["sensory", "concept", "hippocampus", "association"],
      "deerflow_research",
      `📚 ${title} (${sourceUrls.length} sources)${wasPending ? " ✓" : ""}`,
      { userId: owner.id, intensity: 4 },
    );

    console.log(`${LOG_PREFIX} Stored research "${title}" (memId=${inserted?.id}, sources=${sourceUrls.length})`);
    res.json({ ok: true, memoryId: inserted?.id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_PREFIX} Failed to persist research: ${msg}`);
    res.status(500).json({ error: msg });
  }
}
