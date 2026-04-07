/**
 * Smart Home API Routes - Phase 1 Domotique
 * 
 * Endpoints:
 * - /api/v2/smart-home/devices - Device CRUD
 * - /api/v2/smart-home/scenes - Scene management
 * - /api/v2/smart-home/actions - Execute device actions
 * 
 * Owner-only access for all operations
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { smartHomeService } from "../../services/smartHomeService";

const router = Router();

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const deviceCreateSchema = z.object({
  name: z.string().min(1, "Nom requis").max(100),
  type: z.enum(["light", "switch", "thermostat", "blind", "plug", "sensor", "lock"]).default("light"),
  room: z.string().max(100).optional(),
  vendor: z.enum(["philips_hue", "homekit", "netatmo", "tuya", "custom"]).optional(),
  externalId: z.string().max(200).optional(),
  capabilities: z.array(z.string()).default(["toggle"]),
  state: z.record(z.any()).default({ on: false }),
  ipAddress: z.string().max(50).optional(),
  macAddress: z.string().max(20).optional(),
  accessToken: z.string().max(500).optional(),
  isActive: z.boolean().default(true),
});

const deviceUpdateSchema = deviceCreateSchema.partial();

const sceneCreateSchema = z.object({
  name: z.string().min(1, "Nom requis").max(100),
  description: z.string().max(500).optional(),
  icon: z.string().max(50).default("home"),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#3B82F6"),
  actions: z.array(z.object({
    deviceId: z.number().int().positive(),
    action: z.enum(["toggle", "brightness", "color", "temperature"]),
    params: z.record(z.any()),
  })).default([]),
  trigger: z.enum(["manual", "schedule", "geofence", "siri"]).default("manual"),
  triggerConfig: z.record(z.any()).default({}),
  isActive: z.boolean().default(true),
});

const sceneUpdateSchema = sceneCreateSchema.partial();

const actionSchema = z.object({
  deviceId: z.number().int().positive(),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("toggle"), on: z.boolean() }),
    z.object({ type: z.literal("brightness"), value: z.number().min(0).max(100) }),
    z.object({ type: z.literal("color"), value: z.string().regex(/^#[0-9A-Fa-f]{6}$/) }),
    z.object({ type: z.literal("temperature"), value: z.number() }),
  ]),
  source: z.string().default("manual"),
});

const activateSceneSchema = z.object({
  sceneId: z.number().int().positive(),
  source: z.string().default("manual"),
});

// ============================================================================
// HELPERS
// ============================================================================

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

router.use(requireOwner);

// ============================================================================
// DEVICE ROUTES
// ============================================================================

router.get("/devices", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const devices = await smartHomeService.getDevices(userId);
    
    const safeDevices = devices.map(d => ({
      ...d,
      accessToken: undefined,
    }));
    
    res.json(safeDevices);
  } catch (error) {
    console.error("[SmartHomeAPI] Get devices error:", error);
    res.status(500).json({ error: "Échec de récupération des appareils" });
  }
});

router.get("/devices/:id", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const deviceId = parseInt(req.params.id);
    
    const device = await smartHomeService.getDevice(userId, deviceId);
    if (!device) {
      return res.status(404).json({ error: "Appareil non trouvé" });
    }
    
    res.json({ ...device, accessToken: undefined });
  } catch (error) {
    console.error("[SmartHomeAPI] Get device error:", error);
    res.status(500).json({ error: "Échec de récupération de l'appareil" });
  }
});

router.post("/devices", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const parsed = deviceCreateSchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({ 
        error: "Données invalides", 
        details: parsed.error.flatten() 
      });
    }
    
    const device = await smartHomeService.addDevice(userId, parsed.data);
    res.status(201).json({ ...device, accessToken: undefined });
  } catch (error) {
    console.error("[SmartHomeAPI] Create device error:", error);
    res.status(500).json({ error: "Échec de création de l'appareil" });
  }
});

router.patch("/devices/:id", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const deviceId = parseInt(req.params.id);
    const parsed = deviceUpdateSchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({ 
        error: "Données invalides", 
        details: parsed.error.flatten() 
      });
    }
    
    const device = await smartHomeService.updateDevice(userId, deviceId, parsed.data);
    if (!device) {
      return res.status(404).json({ error: "Appareil non trouvé" });
    }
    
    res.json({ ...device, accessToken: undefined });
  } catch (error) {
    console.error("[SmartHomeAPI] Update device error:", error);
    res.status(500).json({ error: "Échec de mise à jour de l'appareil" });
  }
});

router.delete("/devices/:id", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const deviceId = parseInt(req.params.id);
    
    const deleted = await smartHomeService.deleteDevice(userId, deviceId);
    if (!deleted) {
      return res.status(404).json({ error: "Appareil non trouvé" });
    }
    
    res.json({ success: true, message: "Appareil supprimé" });
  } catch (error) {
    console.error("[SmartHomeAPI] Delete device error:", error);
    res.status(500).json({ error: "Échec de suppression de l'appareil" });
  }
});

// ============================================================================
// SCENE ROUTES
// ============================================================================

router.get("/scenes", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const scenes = await smartHomeService.getScenes(userId);
    res.json(scenes);
  } catch (error) {
    console.error("[SmartHomeAPI] Get scenes error:", error);
    res.status(500).json({ error: "Échec de récupération des scènes" });
  }
});

router.get("/scenes/:id", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const sceneId = parseInt(req.params.id);
    
    const scene = await smartHomeService.getScene(userId, sceneId);
    if (!scene) {
      return res.status(404).json({ error: "Scène non trouvée" });
    }
    
    res.json(scene);
  } catch (error) {
    console.error("[SmartHomeAPI] Get scene error:", error);
    res.status(500).json({ error: "Échec de récupération de la scène" });
  }
});

router.post("/scenes", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const parsed = sceneCreateSchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({ 
        error: "Données invalides", 
        details: parsed.error.flatten() 
      });
    }
    
    const scene = await smartHomeService.addScene(userId, parsed.data);
    res.status(201).json(scene);
  } catch (error) {
    console.error("[SmartHomeAPI] Create scene error:", error);
    res.status(500).json({ error: "Échec de création de la scène" });
  }
});

router.patch("/scenes/:id", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const sceneId = parseInt(req.params.id);
    const parsed = sceneUpdateSchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({ 
        error: "Données invalides", 
        details: parsed.error.flatten() 
      });
    }
    
    const scene = await smartHomeService.updateScene(userId, sceneId, parsed.data);
    if (!scene) {
      return res.status(404).json({ error: "Scène non trouvée" });
    }
    
    res.json(scene);
  } catch (error) {
    console.error("[SmartHomeAPI] Update scene error:", error);
    res.status(500).json({ error: "Échec de mise à jour de la scène" });
  }
});

router.delete("/scenes/:id", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const sceneId = parseInt(req.params.id);
    
    const deleted = await smartHomeService.deleteScene(userId, sceneId);
    if (!deleted) {
      return res.status(404).json({ error: "Scène non trouvée" });
    }
    
    res.json({ success: true, message: "Scène supprimée" });
  } catch (error) {
    console.error("[SmartHomeAPI] Delete scene error:", error);
    res.status(500).json({ error: "Échec de suppression de la scène" });
  }
});

// ============================================================================
// ACTION ROUTES
// ============================================================================

router.post("/actions/device", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const parsed = actionSchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({ 
        error: "Données invalides", 
        details: parsed.error.flatten() 
      });
    }
    
    const { deviceId, action, source } = parsed.data;
    const result = await smartHomeService.executeAction(userId, deviceId, action, source);
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json({ success: true, newState: result.newState });
  } catch (error) {
    console.error("[SmartHomeAPI] Execute action error:", error);
    res.status(500).json({ error: "Échec d'exécution de l'action" });
  }
});

router.post("/actions/scene", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const parsed = activateSceneSchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({ 
        error: "Données invalides", 
        details: parsed.error.flatten() 
      });
    }
    
    const { sceneId, source } = parsed.data;
    const result = await smartHomeService.activateScene(userId, sceneId, source);
    
    res.json(result);
  } catch (error) {
    console.error("[SmartHomeAPI] Activate scene error:", error);
    res.status(500).json({ error: "Échec d'activation de la scène" });
  }
});

// ============================================================================
// ROOM ROUTES
// ============================================================================

router.get("/rooms", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const devices = await smartHomeService.getDevices(userId);
    
    const rooms = Array.from(new Set(devices.map(d => d.room).filter(Boolean))) as string[];
    const roomStats = rooms.map(room => ({
      name: room,
      deviceCount: devices.filter(d => d.room === room).length,
      onlineCount: devices.filter(d => d.room === room && d.isOnline).length,
    }));
    
    res.json(roomStats);
  } catch (error) {
    console.error("[SmartHomeAPI] Get rooms error:", error);
    res.status(500).json({ error: "Échec de récupération des pièces" });
  }
});

router.get("/rooms/:room/devices", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const room = decodeURIComponent(req.params.room);
    
    const devices = await smartHomeService.getDevicesByRoom(userId, room);
    const safeDevices = devices.map(d => ({ ...d, accessToken: undefined }));
    
    res.json(safeDevices);
  } catch (error) {
    console.error("[SmartHomeAPI] Get room devices error:", error);
    res.status(500).json({ error: "Échec de récupération des appareils" });
  }
});

export default router;
