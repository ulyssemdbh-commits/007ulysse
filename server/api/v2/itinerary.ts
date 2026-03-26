import { Router } from "express";
import { itineraryService } from "../../services/itineraryService";
import { z } from "zod";

const router = Router();

const getUserId = (req: any): number => {
  return req.userId || req.session?.userId || req.user?.id;
};

const waypointSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  label: z.string(),
  address: z.string().optional(),
  name: z.string().optional(),
  notes: z.string().optional(),
  isCurrentLocation: z.boolean().optional(),
});

router.get("/routes", async (req, res) => {
  try {
    const userId = getUserId(req);
    const favoritesOnly = req.query.favorites === "true";
    const templatesOnly = req.query.templates === "true";
    const routes = await itineraryService.getRoutes(userId, { favoritesOnly, templatesOnly });
    res.json(routes);
  } catch (error: any) {
    console.error("[Itinerary API] Get routes error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/routes", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { name, description, profile, waypoints, tags, isFavorite, isTemplate } = req.body;
    
    const route = await itineraryService.createRoute({
      userId,
      name: name || "Nouvel itinéraire",
      description,
      profile: profile || "driving",
      tags,
      isFavorite,
      isTemplate,
    });

    if (waypoints && Array.isArray(waypoints)) {
      await itineraryService.setWaypoints(route.id, userId, waypoints);
    }

    res.json(route);
  } catch (error: any) {
    console.error("[Itinerary API] Create route error:", error);
    res.status(400).json({ error: error.message });
  }
});

router.get("/routes/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    const route = await itineraryService.getRoute(parseInt(req.params.id), userId);
    
    if (!route) {
      return res.status(404).json({ error: "Itinéraire non trouvé" });
    }
    
    const waypoints = await itineraryService.getWaypoints(route.id, userId);
    res.json({ ...route, waypoints });
  } catch (error: any) {
    console.error("[Itinerary API] Get route error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.patch("/routes/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    const route = await itineraryService.updateRoute(
      parseInt(req.params.id),
      userId,
      req.body
    );
    
    if (!route) {
      return res.status(404).json({ error: "Itinéraire non trouvé" });
    }
    
    res.json(route);
  } catch (error: any) {
    console.error("[Itinerary API] Update route error:", error);
    res.status(400).json({ error: error.message });
  }
});

router.delete("/routes/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    await itineraryService.deleteRoute(parseInt(req.params.id), userId);
    res.json({ success: true });
  } catch (error: any) {
    console.error("[Itinerary API] Delete route error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/routes/:id/duplicate", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { name } = req.body;
    const route = await itineraryService.duplicateRoute(
      parseInt(req.params.id),
      userId,
      name
    );
    
    if (!route) {
      return res.status(404).json({ error: "Itinéraire non trouvé" });
    }
    
    res.json(route);
  } catch (error: any) {
    console.error("[Itinerary API] Duplicate route error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/routes/:id/waypoints", async (req, res) => {
  try {
    const userId = getUserId(req);
    const routeId = parseInt(req.params.id);
    const waypointData = waypointSchema.parse(req.body);
    
    const waypoint = await itineraryService.addWaypoint(routeId, userId, waypointData);
    res.json(waypoint);
  } catch (error: any) {
    console.error("[Itinerary API] Add waypoint error:", error);
    res.status(400).json({ error: error.message });
  }
});

router.get("/routes/:id/waypoints", async (req, res) => {
  try {
    const userId = getUserId(req);
    const waypoints = await itineraryService.getWaypoints(parseInt(req.params.id), userId);
    res.json(waypoints);
  } catch (error: any) {
    console.error("[Itinerary API] Get waypoints error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.put("/routes/:id/waypoints", async (req, res) => {
  try {
    const userId = getUserId(req);
    const routeId = parseInt(req.params.id);
    const { waypoints } = req.body;
    
    if (!Array.isArray(waypoints)) {
      return res.status(400).json({ error: "waypoints doit être un tableau" });
    }
    
    const result = await itineraryService.setWaypoints(routeId, userId, waypoints);
    res.json(result);
  } catch (error: any) {
    console.error("[Itinerary API] Set waypoints error:", error);
    res.status(400).json({ error: error.message });
  }
});

router.patch("/routes/:id/waypoints/order", async (req, res) => {
  try {
    const userId = getUserId(req);
    const routeId = parseInt(req.params.id);
    const { waypointIds } = req.body;
    
    if (!Array.isArray(waypointIds)) {
      return res.status(400).json({ error: "waypointIds doit être un tableau" });
    }
    
    const waypoints = await itineraryService.updateWaypointOrder(routeId, userId, waypointIds);
    res.json(waypoints);
  } catch (error: any) {
    console.error("[Itinerary API] Reorder waypoints error:", error);
    res.status(400).json({ error: error.message });
  }
});

router.delete("/routes/:routeId/waypoints/:waypointId", async (req, res) => {
  try {
    const userId = getUserId(req);
    await itineraryService.deleteWaypoint(
      parseInt(req.params.waypointId),
      parseInt(req.params.routeId),
      userId
    );
    res.json({ success: true });
  } catch (error: any) {
    console.error("[Itinerary API] Delete waypoint error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/optimize", async (req, res) => {
  try {
    const { waypoints, profile } = req.body;
    
    if (!Array.isArray(waypoints) || waypoints.length < 2) {
      return res.status(400).json({ error: "Au moins 2 waypoints requis" });
    }
    
    // Validate profile
    const validProfiles = ["driving", "cycling", "walking"];
    const routeProfile = validProfiles.includes(profile) ? profile : "driving";
    
    const optimized = await itineraryService.optimizeWaypointOrder(waypoints, routeProfile);
    res.json(optimized);
  } catch (error: any) {
    console.error("[Itinerary API] Optimize error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/preferences", async (req, res) => {
  try {
    const userId = getUserId(req);
    const prefs = await itineraryService.getPreferences(userId);
    res.json(prefs || {
      defaultProfile: "driving",
      avoidTolls: false,
      avoidHighways: false,
      avoidFerries: false,
      optimizeOrder: true,
      showAlternatives: false,
      voiceGuidance: true,
      autoRecalculate: true,
      deviationThreshold: 50,
      arrivalAlertDistance: 200,
    });
  } catch (error: any) {
    console.error("[Itinerary API] Get preferences error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/preferences", async (req, res) => {
  try {
    const userId = getUserId(req);
    const prefs = await itineraryService.setPreferences(userId, req.body);
    res.json(prefs);
  } catch (error: any) {
    console.error("[Itinerary API] Set preferences error:", error);
    res.status(400).json({ error: error.message });
  }
});

router.post("/navigation/start", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { routeId, waypoints, profile } = req.body;
    
    if (!Array.isArray(waypoints) || waypoints.length < 2) {
      return res.status(400).json({ error: "Au moins 2 waypoints requis" });
    }
    
    if (routeId) {
      await itineraryService.incrementUsage(routeId, userId);
    }
    
    const nav = await itineraryService.startNavigation(userId, routeId, waypoints, profile || "driving");
    res.json(nav);
  } catch (error: any) {
    console.error("[Itinerary API] Start navigation error:", error);
    res.status(400).json({ error: error.message });
  }
});

router.get("/navigation", async (req, res) => {
  try {
    const userId = getUserId(req);
    const nav = await itineraryService.getActiveNavigation(userId);
    res.json(nav);
  } catch (error: any) {
    console.error("[Itinerary API] Get navigation error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.patch("/navigation", async (req, res) => {
  try {
    const userId = getUserId(req);
    const nav = await itineraryService.updateNavigation(userId, req.body);
    res.json(nav);
  } catch (error: any) {
    console.error("[Itinerary API] Update navigation error:", error);
    res.status(400).json({ error: error.message });
  }
});

router.post("/navigation/stop", async (req, res) => {
  try {
    const userId = getUserId(req);
    await itineraryService.stopNavigation(userId);
    res.json({ success: true });
  } catch (error: any) {
    console.error("[Itinerary API] Stop navigation error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/navigation/recalculate", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { latitude, longitude } = req.body;
    
    if (typeof latitude !== "number" || typeof longitude !== "number") {
      return res.status(400).json({ error: "latitude et longitude requis" });
    }
    
    const result = await itineraryService.recalculateRoute(userId, latitude, longitude);
    res.json(result);
  } catch (error: any) {
    console.error("[Itinerary API] Recalculate navigation error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/navigation/check-position", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { latitude, longitude, currentSpeed } = req.body;
    
    if (typeof latitude !== "number" || typeof longitude !== "number") {
      return res.status(400).json({ error: "latitude et longitude requis" });
    }
    
    const [deviation, proximity, enhanced] = await Promise.all([
      itineraryService.checkDeviation(userId, latitude, longitude),
      itineraryService.checkArrivalProximity(userId, latitude, longitude),
      itineraryService.getEnhancedNavInfo(userId, latitude, longitude, currentSpeed || 0),
    ]);
    
    res.json({
      ...deviation,
      ...proximity,
      ...enhanced,
    });
  } catch (error: any) {
    console.error("[Itinerary API] Check position error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/history", async (req, res) => {
  try {
    const userId = getUserId(req);
    const limit = parseInt(req.query.limit as string) || 20;
    const history = await itineraryService.getHistory(userId, limit);
    res.json(history);
  } catch (error: any) {
    console.error("[Itinerary API] Get history error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/navigation/alerts", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { latitude, longitude, speed, heading } = req.query;
    
    if (!latitude || !longitude) {
      return res.status(400).json({ error: "latitude et longitude requis" });
    }
    
    const alerts = await itineraryService.getNavigationAlerts(
      userId,
      parseFloat(latitude as string),
      parseFloat(longitude as string),
      parseFloat(speed as string) || 0,
      parseFloat(heading as string) || 0
    );
    
    res.json(alerts);
  } catch (error: any) {
    console.error("[Itinerary API] Get alerts error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/navigation/pois", async (req, res) => {
  try {
    const { latitude, longitude, heading } = req.query;
    
    if (!latitude || !longitude) {
      return res.status(400).json({ error: "latitude et longitude requis" });
    }
    
    const pois = await itineraryService.getPOIsAlongRoute(
      parseFloat(latitude as string),
      parseFloat(longitude as string),
      parseFloat(heading as string) || 0
    );
    
    res.json(pois);
  } catch (error: any) {
    console.error("[Itinerary API] Get POIs error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/statistics", async (req, res) => {
  try {
    const userId = getUserId(req);
    const stats = await itineraryService.getTripStatistics(userId);
    res.json(stats);
  } catch (error: any) {
    console.error("[Itinerary API] Get statistics error:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
