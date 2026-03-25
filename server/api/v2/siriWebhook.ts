/**
 * Siri Shortcuts Webhook API - Phase 2 Domotique
 * 
 * Secure webhook endpoints for Siri Shortcuts to trigger Ulysse actions.
 * Uses HMAC signature verification for security.
 * 
 * Endpoints:
 * - POST /api/v2/siri/trigger/:token - Execute a webhook action (public, HMAC verified)
 * - GET /api/v2/siri/webhooks - List user's webhooks (owner only)
 * - POST /api/v2/siri/webhooks - Create a new webhook
 * - DELETE /api/v2/siri/webhooks/:id - Delete a webhook
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { db } from "../../db";
import { siriWebhooks } from "@shared/schema";
import type { SiriWebhook, InsertSiriWebhook } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { smartHomeService } from "../../services/smartHomeService";

const router = Router();

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const webhookCreateSchema = z.object({
  name: z.string().min(1, "Nom requis").max(100),
  phrase: z.string().min(1, "Phrase Siri requise").max(200),
  action: z.enum(["scene", "device", "capability"]),
  actionTarget: z.string().max(200).optional(),
  actionParams: z.record(z.any()).default({}),
  isActive: z.boolean().default(true),
});

const webhookUpdateSchema = webhookCreateSchema.partial();

const triggerSchema = z.object({
  signature: z.string().min(1, "Signature HMAC requise"),
  timestamp: z.number().positive("Timestamp requis"),
  params: z.record(z.any()).optional(),
});

// ============================================================================
// HELPERS
// ============================================================================

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function generateSecret(): string {
  return crypto.randomBytes(64).toString('hex');
}

function verifyHmacSignature(secret: string, timestamp: number, body: string, signature: string): boolean {
  const message = `${timestamp}.${body}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');
  
  // Ensure signatures are same length before comparing to prevent timing attacks
  if (signature.length !== expectedSignature.length) {
    return false;
  }
  
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}

function getUserId(req: Request): number {
  const userId = (req as any).userId;
  if (!userId) throw new Error("User not authenticated");
  return userId;
}

function isOwner(req: Request): boolean {
  return (req as any).isOwner === true;
}

function requireOwner(req: Request, res: Response, next: () => void) {
  if (!isOwner(req)) {
    return res.status(403).json({ error: "Accès réservé au propriétaire" });
  }
  next();
}

// Rate limiting for webhook triggers (simple in-memory)
const triggerAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 60000; // 1 minute

function checkRateLimit(token: string): boolean {
  const now = Date.now();
  const entry = triggerAttempts.get(token);
  
  if (!entry || now > entry.resetAt) {
    triggerAttempts.set(token, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  
  if (entry.count >= MAX_ATTEMPTS) {
    return false;
  }
  
  entry.count++;
  return true;
}

// ============================================================================
// PUBLIC TRIGGER ENDPOINT (No auth required, HMAC verified)
// ============================================================================

router.post("/trigger/:token", async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    
    // Rate limiting
    if (!checkRateLimit(token)) {
      console.warn(`[SiriWebhook] Rate limit exceeded for token: ${token.slice(0, 8)}...`);
      return res.status(429).json({ error: "Trop de requêtes. Réessayez dans une minute." });
    }
    
    // Find webhook by token
    const [webhook] = await db.select()
      .from(siriWebhooks)
      .where(eq(siriWebhooks.webhookToken, token));
    
    if (!webhook) {
      console.warn(`[SiriWebhook] Invalid token: ${token.slice(0, 8)}...`);
      return res.status(404).json({ error: "Webhook non trouvé" });
    }
    
    if (!webhook.isActive) {
      return res.status(403).json({ error: "Webhook désactivé" });
    }
    
    // Parse and validate body - HMAC is MANDATORY
    const parsed = triggerSchema.safeParse(req.body);
    if (!parsed.success) {
      console.warn(`[SiriWebhook] Invalid request body: ${JSON.stringify(parsed.error.flatten())}`);
      return res.status(400).json({ 
        error: "Requête invalide - signature HMAC et timestamp requis",
        details: parsed.error.flatten()
      });
    }
    const body = parsed.data;
    
    // Check timestamp freshness FIRST (5 minute window) - prevents replay attacks
    const now = Date.now();
    if (Math.abs(now - body.timestamp) > 300000) {
      console.warn(`[SiriWebhook] Expired request for webhook: ${webhook.name}`);
      return res.status(401).json({ error: "Requête expirée (> 5 minutes)" });
    }
    
    // MANDATORY HMAC signature verification
    const bodyStr = JSON.stringify(body.params || {});
    const isValid = verifyHmacSignature(
      webhook.webhookSecret,
      body.timestamp,
      bodyStr,
      body.signature
    );
    
    if (!isValid) {
      console.warn(`[SiriWebhook] Invalid HMAC signature for webhook: ${webhook.name}`);
      return res.status(401).json({ error: "Signature HMAC invalide" });
    }
    
    // Execute the action
    let result: any;
    const actionParams = { ...webhook.actionParams as Record<string, any>, ...body.params };
    
    switch (webhook.action) {
      case "scene":
        const sceneId = parseInt(webhook.actionTarget || "0");
        if (sceneId > 0) {
          result = await smartHomeService.activateScene(webhook.userId, sceneId, "siri");
        } else {
          result = { success: false, error: "ID de scène invalide" };
        }
        break;
        
      case "device":
        const deviceId = parseInt(webhook.actionTarget || "0");
        if (deviceId > 0 && actionParams.action) {
          result = await smartHomeService.executeAction(
            webhook.userId,
            deviceId,
            actionParams.action,
            "siri"
          );
        } else {
          result = { success: false, error: "Configuration d'appareil invalide" };
        }
        break;
        
      case "capability":
        try {
          const capabilityTarget = webhook.actionTarget || "";
          const { actionHub } = await import("../../services/sensory/ActionHub");
          const actionResult = await actionHub.execute({
            name: capabilityTarget,
            params: actionParams,
            metadata: {
              category: "tool_call",
              userId: webhook.userId,
              persona: "ulysse",
              source: "api"
            }
          });
          result = { success: actionResult.success, message: `Capability ${capabilityTarget} executed`, data: actionResult.result };
        } catch (capErr: any) {
          result = { success: false, error: `Capability execution failed: ${capErr.message}` };
        }
        break;
        
      default:
        result = { success: false, error: "Action non supportée" };
    }
    
    // Update webhook stats
    await db.update(siriWebhooks)
      .set({
        lastTriggeredAt: new Date(),
        triggerCount: (webhook.triggerCount || 0) + 1,
      })
      .where(eq(siriWebhooks.id, webhook.id));
    
    console.log(`[SiriWebhook] Triggered "${webhook.name}" (${webhook.action}): ${result.success ? "OK" : "FAILED"}`);
    
    res.json({
      success: result.success,
      webhook: webhook.name,
      action: webhook.action,
      result,
    });
    
  } catch (error: any) {
    console.error("[SiriWebhook] Trigger error:", error);
    res.status(500).json({ error: "Erreur d'exécution du webhook" });
  }
});

// ============================================================================
// AUTHENTICATED ROUTES (Owner only)
// ============================================================================

router.use(requireOwner);

// List all webhooks for user
router.get("/webhooks", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    
    const webhooks = await db.select()
      .from(siriWebhooks)
      .where(eq(siriWebhooks.userId, userId))
      .orderBy(siriWebhooks.name);
    
    // Don't expose secrets
    const safeWebhooks = webhooks.map(w => ({
      ...w,
      webhookSecret: undefined,
      triggerUrl: `/api/v2/siri/trigger/${w.webhookToken}`,
    }));
    
    res.json(safeWebhooks);
  } catch (error) {
    console.error("[SiriWebhook] Get webhooks error:", error);
    res.status(500).json({ error: "Échec de récupération des webhooks" });
  }
});

// Get single webhook with setup instructions
router.get("/webhooks/:id", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const webhookId = parseInt(req.params.id);
    
    const [webhook] = await db.select()
      .from(siriWebhooks)
      .where(and(
        eq(siriWebhooks.id, webhookId),
        eq(siriWebhooks.userId, userId)
      ));
    
    if (!webhook) {
      return res.status(404).json({ error: "Webhook non trouvé" });
    }
    
    // Include setup instructions for Siri Shortcuts
    const baseUrl = process.env.APP_URL || process.env.BASE_URL || "https://ulysseproject.org";
    
    const triggerUrl = `${baseUrl}/api/v2/siri/trigger/${webhook.webhookToken}`;
    
    res.json({
      ...webhook,
      webhookSecret: undefined, // Don't expose in normal view
      triggerUrl,
      siriShortcutConfig: {
        url: triggerUrl,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timestamp: "{{Current Date (Unix Timestamp)}}",
          signature: "hmac-sha256 of timestamp.body with secret",
          params: {},
        }),
      },
    });
  } catch (error) {
    console.error("[SiriWebhook] Get webhook error:", error);
    res.status(500).json({ error: "Échec de récupération du webhook" });
  }
});

// Get webhook secret (separate endpoint for security)
router.get("/webhooks/:id/secret", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const webhookId = parseInt(req.params.id);
    
    const [webhook] = await db.select()
      .from(siriWebhooks)
      .where(and(
        eq(siriWebhooks.id, webhookId),
        eq(siriWebhooks.userId, userId)
      ));
    
    if (!webhook) {
      return res.status(404).json({ error: "Webhook non trouvé" });
    }
    
    // Return secret for Siri Shortcuts setup
    res.json({
      id: webhook.id,
      name: webhook.name,
      webhookSecret: webhook.webhookSecret,
      note: "Utilisez ce secret dans Raccourcis iOS pour signer les requêtes. Ne le partagez pas.",
    });
  } catch (error) {
    console.error("[SiriWebhook] Get secret error:", error);
    res.status(500).json({ error: "Échec de récupération du secret" });
  }
});

// Create new webhook
router.post("/webhooks", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const parsed = webhookCreateSchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({
        error: "Données invalides",
        details: parsed.error.flatten(),
      });
    }
    
    const webhookData: InsertSiriWebhook = {
      userId,
      name: parsed.data.name,
      phrase: parsed.data.phrase,
      action: parsed.data.action,
      actionTarget: parsed.data.actionTarget,
      actionParams: parsed.data.actionParams,
      webhookToken: generateToken(),
      webhookSecret: generateSecret(),
      isActive: parsed.data.isActive,
    };
    
    const [webhook] = await db.insert(siriWebhooks)
      .values(webhookData)
      .returning();
    
    console.log(`[SiriWebhook] Created webhook: ${webhook.name} for user ${userId}`);
    
    const baseUrl = process.env.APP_URL || process.env.BASE_URL || "https://ulysseproject.org";
    
    // IMPORTANT: Secret is returned ONLY at creation time
    // User must save it to configure Siri Shortcuts
    res.status(201).json({
      ...webhook,
      triggerUrl: `${baseUrl}/api/v2/siri/trigger/${webhook.webhookToken}`,
      notice: "IMPORTANT: Sauvegardez le 'webhookSecret' maintenant. Il ne sera plus affiché automatiquement.",
    });
  } catch (error) {
    console.error("[SiriWebhook] Create error:", error);
    res.status(500).json({ error: "Échec de création du webhook" });
  }
});

// Update webhook
router.patch("/webhooks/:id", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const webhookId = parseInt(req.params.id);
    const parsed = webhookUpdateSchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({
        error: "Données invalides",
        details: parsed.error.flatten(),
      });
    }
    
    const [webhook] = await db.update(siriWebhooks)
      .set(parsed.data)
      .where(and(
        eq(siriWebhooks.id, webhookId),
        eq(siriWebhooks.userId, userId)
      ))
      .returning();
    
    if (!webhook) {
      return res.status(404).json({ error: "Webhook non trouvé" });
    }
    
    res.json({
      ...webhook,
      webhookSecret: undefined,
    });
  } catch (error) {
    console.error("[SiriWebhook] Update error:", error);
    res.status(500).json({ error: "Échec de mise à jour du webhook" });
  }
});

// Regenerate webhook token and secret
router.post("/webhooks/:id/regenerate", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const webhookId = parseInt(req.params.id);
    
    const newToken = generateToken();
    const newSecret = generateSecret();
    
    const [webhook] = await db.update(siriWebhooks)
      .set({
        webhookToken: newToken,
        webhookSecret: newSecret,
      })
      .where(and(
        eq(siriWebhooks.id, webhookId),
        eq(siriWebhooks.userId, userId)
      ))
      .returning();
    
    if (!webhook) {
      return res.status(404).json({ error: "Webhook non trouvé" });
    }
    
    console.log(`[SiriWebhook] Regenerated token for: ${webhook.name}`);
    
    const baseUrl = process.env.APP_URL || process.env.BASE_URL || "https://ulysseproject.org";
    
    res.json({
      success: true,
      message: "Token et secret régénérés. Mettez à jour votre raccourci Siri.",
      triggerUrl: `${baseUrl}/api/v2/siri/trigger/${newToken}`,
      note: "Récupérez le nouveau secret via GET /webhooks/:id/secret",
    });
  } catch (error) {
    console.error("[SiriWebhook] Regenerate error:", error);
    res.status(500).json({ error: "Échec de régénération" });
  }
});

// Delete webhook
router.delete("/webhooks/:id", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const webhookId = parseInt(req.params.id);
    
    const result = await db.delete(siriWebhooks)
      .where(and(
        eq(siriWebhooks.id, webhookId),
        eq(siriWebhooks.userId, userId)
      ))
      .returning();
    
    if (result.length === 0) {
      return res.status(404).json({ error: "Webhook non trouvé" });
    }
    
    console.log(`[SiriWebhook] Deleted webhook: ${result[0].name}`);
    res.json({ success: true, message: "Webhook supprimé" });
  } catch (error) {
    console.error("[SiriWebhook] Delete error:", error);
    res.status(500).json({ error: "Échec de suppression" });
  }
});

export default router;
