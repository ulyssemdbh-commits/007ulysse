import { Router } from "express";
import { geolocationService } from "../../services/geolocationService";
import { z } from "zod";
import { 
  insertLocationSessionSchema, 
  insertLocationPointSchema, 
  insertLocationPreferenceSchema,
  insertGeofenceSchema 
} from "@shared/schema";

const router = Router();

const getUserId = (req: any): number => {
  return req.userId || req.session?.userId || req.user?.id;
};

router.post("/sessions", async (req, res) => {
  try {
    const userId = getUserId(req);
    // Convert and validate ISO string to Date for consentTimestamp
    const body = { ...req.body };
    if (typeof body.consentTimestamp === "string") {
      const timestamp = Date.parse(body.consentTimestamp);
      if (isNaN(timestamp)) {
        return res.status(400).json({ error: "Invalid consentTimestamp format" });
      }
      body.consentTimestamp = new Date(timestamp);
    }
    const data = insertLocationSessionSchema.parse({ ...body, userId });
    
    const existingSession = await geolocationService.getActiveSession(userId, data.deviceId);
    if (existingSession) {
      return res.json(existingSession);
    }
    
    const session = await geolocationService.createSession(data);
    res.json(session);
  } catch (error: any) {
    console.error("[Location API] Session error:", error);
    res.status(400).json({ error: error.message });
  }
});

router.delete("/sessions/:deviceId", async (req, res) => {
  try {
    const userId = getUserId(req);
    const session = await geolocationService.getActiveSession(userId, req.params.deviceId);
    
    if (session) {
      await geolocationService.endSession(session.id);
    }
    
    res.json({ success: true });
  } catch (error: any) {
    console.error("[Location API] End session error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/points", async (req, res) => {
  try {
    const userId = getUserId(req);
    // Convert and validate ISO string to Date for recordedAt
    const body = { ...req.body };
    if (typeof body.recordedAt === "string") {
      const timestamp = Date.parse(body.recordedAt);
      if (isNaN(timestamp)) {
        return res.status(400).json({ error: "Invalid recordedAt format" });
      }
      body.recordedAt = new Date(timestamp);
    }
    const data = insertLocationPointSchema.parse({ ...body, userId });
    const point = await geolocationService.recordLocation(data);
    res.json(point);
  } catch (error: any) {
    console.error("[Location API] Record point error:", error);
    res.status(400).json({ error: error.message });
  }
});

router.post("/points/batch", async (req, res) => {
  try {
    const userId = getUserId(req);
    const rawPoints = req.body.points || [];
    const points = [];
    
    for (const p of rawPoints) {
      // Convert and validate ISO string to Date for recordedAt
      const point = { ...p };
      if (typeof point.recordedAt === "string") {
        const timestamp = Date.parse(point.recordedAt);
        if (isNaN(timestamp)) {
          return res.status(400).json({ error: "Invalid recordedAt format in batch" });
        }
        point.recordedAt = new Date(timestamp);
      }
      points.push(insertLocationPointSchema.parse({ ...point, userId }));
    }
    
    const recorded = await geolocationService.recordLocationBatch(points);
    res.json({ recorded: recorded.length });
  } catch (error: any) {
    console.error("[Location API] Batch points error:", error);
    res.status(400).json({ error: error.message });
  }
});

router.get("/history", async (req, res) => {
  try {
    const userId = getUserId(req);
    const limit = parseInt(req.query.limit as string) || 100;
    const history = await geolocationService.getLocationHistory(userId, { limit });
    res.json(history);
  } catch (error: any) {
    console.error("[Location API] History error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/current", async (req, res) => {
  try {
    const userId = getUserId(req);
    const location = await geolocationService.getLastKnownLocation(userId);
    res.json(location || { message: "No location data available" });
  } catch (error: any) {
    console.error("[Location API] Current location error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/preferences", async (req, res) => {
  try {
    const userId = getUserId(req);
    const preferences = await geolocationService.getPreferences(userId);
    res.json(preferences);
  } catch (error: any) {
    console.error("[Location API] Get preferences error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/preferences", async (req, res) => {
  try {
    const userId = getUserId(req);
    const data = insertLocationPreferenceSchema.parse({ ...req.body, userId });
    const preference = await geolocationService.setPreference(data);
    res.json(preference);
  } catch (error: any) {
    console.error("[Location API] Set preference error:", error);
    res.status(400).json({ error: error.message });
  }
});

router.get("/geofences", async (req, res) => {
  try {
    const userId = getUserId(req);
    const activeOnly = req.query.activeOnly !== 'false';
    const geofences = await geolocationService.getGeofences(userId, activeOnly);
    res.json(geofences);
  } catch (error: any) {
    console.error("[Location API] Get geofences error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/geofences", async (req, res) => {
  try {
    const userId = getUserId(req);
    const data = insertGeofenceSchema.parse({ ...req.body, userId });
    const geofence = await geolocationService.createGeofence(data);
    res.json(geofence);
  } catch (error: any) {
    console.error("[Location API] Create geofence error:", error);
    res.status(400).json({ error: error.message });
  }
});

router.get("/geofences/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    const geofence = await geolocationService.getGeofence(parseInt(req.params.id), userId);
    
    if (!geofence) {
      return res.status(404).json({ error: "Geofence not found" });
    }
    
    res.json(geofence);
  } catch (error: any) {
    console.error("[Location API] Get geofence error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.patch("/geofences/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    const geofence = await geolocationService.updateGeofence(
      parseInt(req.params.id), 
      userId, 
      req.body
    );
    
    if (!geofence) {
      return res.status(404).json({ error: "Geofence not found" });
    }
    
    res.json(geofence);
  } catch (error: any) {
    console.error("[Location API] Update geofence error:", error);
    res.status(400).json({ error: error.message });
  }
});

router.delete("/geofences/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    await geolocationService.deleteGeofence(parseInt(req.params.id), userId);
    res.json({ success: true });
  } catch (error: any) {
    console.error("[Location API] Delete geofence error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/geofences/:id/events", async (req, res) => {
  try {
    const userId = getUserId(req);
    const limit = parseInt(req.query.limit as string) || 50;
    const events = await geolocationService.getGeofenceEvents(userId, parseInt(req.params.id), limit);
    res.json(events);
  } catch (error: any) {
    console.error("[Location API] Get geofence events error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/stats", async (req, res) => {
  try {
    const userId = getUserId(req);
    const stats = await geolocationService.getLocationStats(userId);
    res.json(stats);
  } catch (error: any) {
    console.error("[Location API] Stats error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/cleanup", async (req, res) => {
  try {
    const userId = getUserId(req);
    const retentionDays = parseInt(req.body.retentionDays) || 30;
    const deleted = await geolocationService.cleanupOldData(userId, retentionDays);
    res.json({ deleted, message: `Cleaned up data older than ${retentionDays} days` });
  } catch (error: any) {
    console.error("[Location API] Cleanup error:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
