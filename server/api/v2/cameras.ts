/**
 * Camera API Routes
 * CRUD operations for surveillance cameras
 * Owner-only access for all camera operations
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { cameraService } from "../../services/cameraService";

const router = Router();

// Validation schemas
const cameraCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  location: z.string().max(200).optional(),
  cameraType: z.enum(["ip", "rtsp", "onvif", "homekit"]).default("ip"),
  ipAddress: z.string().optional(),
  port: z.number().int().min(1).max(65535).default(554),
  protocol: z.enum(["rtsp", "http", "https", "onvif"]).default("rtsp"),
  streamUrl: z.string().url().optional().nullable(),
  snapshotUrl: z.string().url().optional().nullable(),
  username: z.string().max(100).optional(),
  password: z.string().max(200).optional(),
  hasMotionDetection: z.boolean().default(false),
  motionSensitivity: z.number().int().min(0).max(100).default(50),
  hasFaceRecognition: z.boolean().default(false),
  notifyOnMotion: z.boolean().default(true),
  notifyOnPerson: z.boolean().default(true),
  recordingEnabled: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

const cameraUpdateSchema = cameraCreateSchema.partial();

function getUserId(req: Request): number {
  const userId = (req as any).userId;
  if (!userId) throw new Error("User not authenticated");
  return userId;
}

function isOwner(req: Request): boolean {
  return (req as any).isOwner === true;
}

// Middleware: All camera routes require owner access
function requireOwner(req: Request, res: Response, next: () => void) {
  if (!isOwner(req)) {
    return res.status(403).json({ error: "Only owner can access camera settings" });
  }
  next();
}

// Apply owner check to all routes
router.use(requireOwner);

// Get all cameras for user
router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const cameras = await cameraService.getCameras(userId);
    
    // Don't send encrypted passwords to client
    const safeCameras = cameras.map(c => ({
      ...c,
      passwordEncrypted: undefined,
    }));
    
    res.json(safeCameras);
  } catch (error) {
    console.error("[CameraAPI] Get cameras error:", error);
    res.status(500).json({ error: "Failed to get cameras" });
  }
});

// Get specific camera
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const cameraId = parseInt(req.params.id);
    
    const camera = await cameraService.getCamera(userId, cameraId);
    if (!camera) {
      return res.status(404).json({ error: "Camera not found" });
    }
    
    res.json({
      ...camera,
      passwordEncrypted: undefined,
    });
  } catch (error) {
    console.error("[CameraAPI] Get camera error:", error);
    res.status(500).json({ error: "Failed to get camera" });
  }
});

// Add new camera
router.post("/", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    
    // Validate request body
    const parseResult = cameraCreateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ 
        error: "Invalid camera data", 
        details: parseResult.error.issues 
      });
    }
    
    const camera = await cameraService.addCamera(userId, parseResult.data);
    
    res.status(201).json({
      ...camera,
      passwordEncrypted: undefined,
    });
  } catch (error) {
    console.error("[CameraAPI] Add camera error:", error);
    res.status(500).json({ error: "Failed to add camera" });
  }
});

// Update camera
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const cameraId = parseInt(req.params.id);
    
    // Validate request body
    const parseResult = cameraUpdateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ 
        error: "Invalid camera data", 
        details: parseResult.error.issues 
      });
    }
    
    const camera = await cameraService.updateCamera(userId, cameraId, parseResult.data);
    if (!camera) {
      return res.status(404).json({ error: "Camera not found" });
    }
    
    res.json({
      ...camera,
      passwordEncrypted: undefined,
    });
  } catch (error) {
    console.error("[CameraAPI] Update camera error:", error);
    res.status(500).json({ error: "Failed to update camera" });
  }
});

// Delete camera
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const cameraId = parseInt(req.params.id);
    
    const deleted = await cameraService.deleteCamera(userId, cameraId);
    if (!deleted) {
      return res.status(404).json({ error: "Camera not found" });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error("[CameraAPI] Delete camera error:", error);
    res.status(500).json({ error: "Failed to delete camera" });
  }
});

// Check camera status
router.post("/:id/check", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const cameraId = parseInt(req.params.id);
    
    const camera = await cameraService.getCamera(userId, cameraId);
    if (!camera) {
      return res.status(404).json({ error: "Camera not found" });
    }
    
    const isOnline = await cameraService.checkCameraStatus(camera);
    
    res.json({ isOnline });
  } catch (error) {
    console.error("[CameraAPI] Check status error:", error);
    res.status(500).json({ error: "Failed to check camera status" });
  }
});

// Get camera events
router.get("/:id/events", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const cameraId = parseInt(req.params.id);
    const limit = parseInt(req.query.limit as string) || 20;
    
    const events = await cameraService.getEvents(userId, cameraId, limit);
    res.json(events);
  } catch (error) {
    console.error("[CameraAPI] Get events error:", error);
    res.status(500).json({ error: "Failed to get events" });
  }
});

// Get all events for user
router.get("/events/all", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const limit = parseInt(req.query.limit as string) || 50;
    
    const events = await cameraService.getEvents(userId, undefined, limit);
    res.json(events);
  } catch (error) {
    console.error("[CameraAPI] Get all events error:", error);
    res.status(500).json({ error: "Failed to get events" });
  }
});

export default router;
