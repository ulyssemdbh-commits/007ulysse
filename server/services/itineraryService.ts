import { db } from "../db";
import { 
  savedRoutes, 
  routeWaypoints, 
  routeHistory, 
  routePreferences,
  activeNavigation,
  InsertSavedRoute,
  InsertRouteWaypoint,
  InsertRouteHistory,
  InsertRoutePreferences,
  InsertActiveNavigation,
  SavedRoute,
  RouteWaypoint,
  RoutePreferences,
  ActiveNavigation
} from "@shared/schema";
import { eq, and, desc, asc } from "drizzle-orm";
import { routingProvider, RoutingProfile, OSRMRoute } from "./routingProvider";

interface WaypointInput {
  lat: number;
  lng: number;
  label: string;
  address?: string;
  name?: string;
  notes?: string;
  isCurrentLocation?: boolean;
}

interface OptimizedRoute {
  waypoints: WaypointInput[];
  totalDistance: number;
  totalDuration: number;
  savings?: { distance: number; duration: number };
}

// OSRMRoute and cache now handled by routingProvider

class ItineraryService {
  async createRoute(data: InsertSavedRoute): Promise<SavedRoute> {
    const [route] = await db.insert(savedRoutes).values(data).returning();
    return route;
  }

  async getRoutes(userId: number, options?: { favoritesOnly?: boolean; templatesOnly?: boolean }): Promise<SavedRoute[]> {
    let query = db.select().from(savedRoutes).where(eq(savedRoutes.userId, userId));
    
    if (options?.favoritesOnly) {
      query = db.select().from(savedRoutes).where(
        and(eq(savedRoutes.userId, userId), eq(savedRoutes.isFavorite, true))
      );
    }
    
    if (options?.templatesOnly) {
      query = db.select().from(savedRoutes).where(
        and(eq(savedRoutes.userId, userId), eq(savedRoutes.isTemplate, true))
      );
    }
    
    return query.orderBy(desc(savedRoutes.updatedAt));
  }

  async getRoute(id: number, userId: number): Promise<SavedRoute | null> {
    const [route] = await db.select().from(savedRoutes)
      .where(and(eq(savedRoutes.id, id), eq(savedRoutes.userId, userId)));
    return route || null;
  }

  async updateRoute(id: number, userId: number, data: Partial<InsertSavedRoute>): Promise<SavedRoute | null> {
    const [route] = await db.update(savedRoutes)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(savedRoutes.id, id), eq(savedRoutes.userId, userId)))
      .returning();
    return route || null;
  }

  async deleteRoute(id: number, userId: number): Promise<boolean> {
    await db.delete(routeWaypoints).where(eq(routeWaypoints.routeId, id));
    const result = await db.delete(savedRoutes)
      .where(and(eq(savedRoutes.id, id), eq(savedRoutes.userId, userId)));
    return true;
  }

  async addWaypoint(routeId: number, userId: number, data: WaypointInput): Promise<RouteWaypoint> {
    const existingWaypoints = await this.getWaypoints(routeId, userId);
    const orderIndex = existingWaypoints.length;
    
    const [waypoint] = await db.insert(routeWaypoints).values({
      routeId,
      userId,
      orderIndex,
      label: data.label,
      latitude: data.lat.toString(),
      longitude: data.lng.toString(),
      address: data.address,
      name: data.name,
      notes: data.notes,
      isCurrentLocation: data.isCurrentLocation || false,
    }).returning();
    
    return waypoint;
  }

  async getWaypoints(routeId: number, userId: number): Promise<RouteWaypoint[]> {
    return db.select().from(routeWaypoints)
      .where(and(eq(routeWaypoints.routeId, routeId), eq(routeWaypoints.userId, userId)))
      .orderBy(asc(routeWaypoints.orderIndex));
  }

  async updateWaypointOrder(routeId: number, userId: number, waypointIds: number[]): Promise<RouteWaypoint[]> {
    const updates = waypointIds.map((id, index) => 
      db.update(routeWaypoints)
        .set({ orderIndex: index, label: String.fromCharCode(65 + index) })
        .where(and(
          eq(routeWaypoints.id, id),
          eq(routeWaypoints.routeId, routeId),
          eq(routeWaypoints.userId, userId)
        ))
    );
    
    await Promise.all(updates);
    return this.getWaypoints(routeId, userId);
  }

  async deleteWaypoint(waypointId: number, routeId: number, userId: number): Promise<boolean> {
    await db.delete(routeWaypoints)
      .where(and(
        eq(routeWaypoints.id, waypointId),
        eq(routeWaypoints.routeId, routeId),
        eq(routeWaypoints.userId, userId)
      ));
    
    const remaining = await this.getWaypoints(routeId, userId);
    const reorderUpdates = remaining.map((wp, index) =>
      db.update(routeWaypoints)
        .set({ orderIndex: index, label: String.fromCharCode(65 + index) })
        .where(eq(routeWaypoints.id, wp.id))
    );
    await Promise.all(reorderUpdates);
    
    return true;
  }

  async setWaypoints(routeId: number, userId: number, waypoints: WaypointInput[]): Promise<RouteWaypoint[]> {
    await db.delete(routeWaypoints).where(eq(routeWaypoints.routeId, routeId));
    
    if (waypoints.length === 0) return [];
    
    const waypointData = waypoints.map((wp, index) => ({
      routeId,
      userId,
      orderIndex: index,
      label: wp.label || String.fromCharCode(65 + index),
      latitude: wp.lat.toString(),
      longitude: wp.lng.toString(),
      address: wp.address,
      name: wp.name,
      notes: wp.notes,
      isCurrentLocation: wp.isCurrentLocation || false,
    }));
    
    return db.insert(routeWaypoints).values(waypointData).returning();
  }

  // Fetch route distance from OSRM via RoutingProvider
  private async getOSRMDistance(
    fromLat: number, fromLng: number,
    toLat: number, toLng: number,
    profile: string = "driving"
  ): Promise<OSRMRoute | null> {
    const p: RoutingProfile = 
      profile === "walking" || profile === "cycling" ? profile : "driving";
    return routingProvider.getRoute(fromLat, fromLng, toLat, toLng, p);
  }

  // Get distance matrix using OSRM Table API via RoutingProvider
  private async getDistanceMatrix(
    waypoints: WaypointInput[],
    profile: string = "driving"
  ): Promise<number[][]> {
    const n = waypoints.length;
    if (n === 0) return [];

    const p: RoutingProfile = 
      profile === "walking" || profile === "cycling" ? profile : "driving";

    // Try OSRM Table via RoutingProvider
    const matrix = await routingProvider.getMatrix(waypoints, p);
    if (matrix) return matrix;

    // Fallback: Build matrix using Haversine distances (no network calls)
    console.log(`[Itinerary] Falling back to Haversine distance matrix`);
    const distMatrix: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i !== j) {
          distMatrix[i][j] = this.haversineDistance(
            waypoints[i].lat, waypoints[i].lng,
            waypoints[j].lat, waypoints[j].lng
          );
        }
      }
    }
    return distMatrix;
  }

  async optimizeWaypointOrder(waypoints: WaypointInput[], profile: string = "driving"): Promise<OptimizedRoute> {
    if (waypoints.length <= 2) {
      const totalDist = waypoints.length === 2 
        ? await this.calculateRealDistance(waypoints, profile)
        : 0;
      return { 
        waypoints, 
        totalDistance: totalDist, 
        totalDuration: Math.round(totalDist / (profile === "walking" ? 1.4 : profile === "cycling" ? 4.5 : 11)),
      };
    }

    const start = waypoints[0];
    const end = waypoints[waypoints.length - 1];
    const middle = waypoints.slice(1, -1);

    console.log(`[Itinerary] Optimizing ${waypoints.length} waypoints with profile: ${profile}`);
    
    // Step 1: Get distance matrix for middle points + start/end
    const allPoints = [start, ...middle, end];
    const distMatrix = await this.getDistanceMatrix(allPoints, profile);
    
    // Step 2: Nearest neighbor initialization
    let bestOrder = this.nearestNeighborWithMatrix(distMatrix, allPoints.length);
    let bestDistance = this.calculateTourDistance(bestOrder, distMatrix);
    
    // Step 3: 2-opt improvement (skip first and last positions)
    if (middle.length > 1) {
      let improved = true;
      let iterations = 0;
      const maxIterations = 100;
      
      while (improved && iterations < maxIterations) {
        improved = false;
        iterations++;
        
        // Only optimize middle segment (indices 1 to n-2)
        for (let i = 1; i < bestOrder.length - 2; i++) {
          for (let j = i + 1; j < bestOrder.length - 1; j++) {
            const newOrder = this.twoOptSwap(bestOrder, i, j);
            const newDistance = this.calculateTourDistance(newOrder, distMatrix);
            
            if (newDistance < bestDistance - 0.1) { // Small epsilon to avoid floating point issues
              bestOrder = newOrder;
              bestDistance = newDistance;
              improved = true;
            }
          }
        }
      }
      
      console.log(`[Itinerary] 2-opt completed after ${iterations} iterations`);
    }
    
    // Rebuild waypoints in optimized order
    const optimized = bestOrder.map((idx, i) => ({
      ...allPoints[idx],
      label: String.fromCharCode(65 + i),
    }));

    // Calculate original distance for savings comparison
    const originalDistance = await this.calculateRealDistance(waypoints, profile);
    const avgSpeed = profile === "walking" ? 1.4 : profile === "cycling" ? 4.5 : 11; // m/s
    
    return {
      waypoints: optimized,
      totalDistance: Math.round(bestDistance),
      totalDuration: Math.round(bestDistance / avgSpeed),
      savings: {
        distance: Math.round(originalDistance - bestDistance),
        duration: Math.round((originalDistance - bestDistance) / avgSpeed),
      },
    };
  }

  private nearestNeighborWithMatrix(distMatrix: number[][], n: number): number[] {
    if (n <= 2) return n === 2 ? [0, 1] : [0];
    
    const result: number[] = [0]; // Start is always first
    const remaining = new Set(Array.from({ length: n - 2 }, (_, i) => i + 1)); // Middle points
    let current = 0;

    while (remaining.size > 0) {
      let nearest = -1;
      let nearestDist = Infinity;

      for (const idx of Array.from(remaining)) {
        if (distMatrix[current][idx] < nearestDist) {
          nearestDist = distMatrix[current][idx];
          nearest = idx;
        }
      }

      if (nearest !== -1) {
        result.push(nearest);
        remaining.delete(nearest);
        current = nearest;
      } else {
        break;
      }
    }

    result.push(n - 1); // End is always last
    return result;
  }

  private twoOptSwap(order: number[], i: number, j: number): number[] {
    const newOrder = [...order];
    // Reverse the segment between i and j
    while (i < j) {
      [newOrder[i], newOrder[j]] = [newOrder[j], newOrder[i]];
      i++;
      j--;
    }
    return newOrder;
  }

  private calculateTourDistance(order: number[], distMatrix: number[][]): number {
    let total = 0;
    for (let i = 0; i < order.length - 1; i++) {
      total += distMatrix[order[i]][order[i + 1]];
    }
    return total;
  }

  private async calculateRealDistance(waypoints: WaypointInput[], profile: string = "driving"): Promise<number> {
    let total = 0;
    for (let i = 0; i < waypoints.length - 1; i++) {
      const osrm = await this.getOSRMDistance(
        waypoints[i].lat, waypoints[i].lng,
        waypoints[i + 1].lat, waypoints[i + 1].lng,
        profile
      );
      total += osrm?.distance ?? this.haversineDistance(
        waypoints[i].lat, waypoints[i].lng,
        waypoints[i + 1].lat, waypoints[i + 1].lng
      );
    }
    return total;
  }

  // Legacy method kept for compatibility
  private nearestNeighborOptimization(
    start: WaypointInput, 
    middle: WaypointInput[], 
    end: WaypointInput
  ): WaypointInput[] {
    if (middle.length === 0) return [start, end];
    if (middle.length === 1) return [start, middle[0], end];

    const result: WaypointInput[] = [start];
    const remaining = [...middle];
    let current = start;

    while (remaining.length > 0) {
      let nearestIndex = 0;
      let nearestDist = Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const dist = this.haversineDistance(
          current.lat, current.lng,
          remaining[i].lat, remaining[i].lng
        );
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIndex = i;
        }
      }

      current = remaining.splice(nearestIndex, 1)[0];
      result.push(current);
    }

    result.push(end);
    
    return result.map((wp, index) => ({
      ...wp,
      label: String.fromCharCode(65 + index),
    }));
  }

  private haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private async calculateTotalDistance(waypoints: WaypointInput[]): Promise<number> {
    let total = 0;
    for (let i = 0; i < waypoints.length - 1; i++) {
      total += this.haversineDistance(
        waypoints[i].lat, waypoints[i].lng,
        waypoints[i + 1].lat, waypoints[i + 1].lng
      );
    }
    return total;
  }

  async getPreferences(userId: number): Promise<RoutePreferences | null> {
    const [prefs] = await db.select().from(routePreferences)
      .where(eq(routePreferences.userId, userId));
    return prefs || null;
  }

  async setPreferences(userId: number, data: Partial<InsertRoutePreferences>): Promise<RoutePreferences> {
    const existing = await this.getPreferences(userId);
    
    if (existing) {
      const [updated] = await db.update(routePreferences)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(routePreferences.userId, userId))
        .returning();
      return updated;
    }
    
    const [created] = await db.insert(routePreferences)
      .values({ userId, ...data })
      .returning();
    return created;
  }

  async startNavigation(userId: number, routeId: number | null, waypoints: WaypointInput[], profile: string): Promise<ActiveNavigation> {
    await db.delete(activeNavigation).where(eq(activeNavigation.userId, userId));
    
    const [nav] = await db.insert(activeNavigation).values({
      userId,
      routeId,
      currentWaypointIndex: 0,
      currentInstructionIndex: 0,
      waypointsData: waypoints,
      instructionsData: [],
      profile,
    }).returning();
    
    return nav;
  }

  async getActiveNavigation(userId: number): Promise<ActiveNavigation | null> {
    const [nav] = await db.select().from(activeNavigation)
      .where(eq(activeNavigation.userId, userId));
    return nav || null;
  }

  async updateNavigation(userId: number, data: Partial<InsertActiveNavigation>): Promise<ActiveNavigation | null> {
    const [nav] = await db.update(activeNavigation)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(activeNavigation.userId, userId))
      .returning();
    return nav || null;
  }

  async stopNavigation(userId: number): Promise<void> {
    const nav = await this.getActiveNavigation(userId);
    
    if (nav) {
      await db.insert(routeHistory).values({
        userId,
        savedRouteId: nav.routeId,
        profile: nav.profile,
        waypointsData: nav.waypointsData,
        plannedDistance: nav.totalDistance,
        plannedDuration: nav.totalDuration,
        deviationCount: nav.offRouteCount,
        status: "completed",
        startedAt: nav.startedAt,
        completedAt: new Date(),
      });
    }
    
    await db.delete(activeNavigation).where(eq(activeNavigation.userId, userId));
  }

  async recalculateRoute(userId: number, currentLat: number, currentLng: number): Promise<{ success: boolean; message: string }> {
    const nav = await this.getActiveNavigation(userId);
    if (!nav) {
      return { success: false, message: "Aucune navigation active" };
    }
    
    const waypoints = nav.waypointsData as WaypointInput[];
    const currentIndex = nav.currentWaypointIndex;
    
    if (currentIndex >= waypoints.length - 1) {
      return { success: true, message: "Déjà arrivé à destination" };
    }
    
    const newWaypoints: WaypointInput[] = [
      { lat: currentLat, lng: currentLng, label: "CURRENT", address: "Position actuelle" },
      ...waypoints.slice(currentIndex + 1)
    ];
    
    await db.update(activeNavigation)
      .set({
        waypointsData: newWaypoints,
        currentWaypointIndex: 0,
        offRouteCount: (nav.offRouteCount || 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(activeNavigation.userId, userId));
    
    console.log(`[Itinerary] Recalculated route for user ${userId} from (${currentLat}, ${currentLng})`);
    return { success: true, message: "Itinéraire recalculé" };
  }

  async getHistory(userId: number, limit = 20): Promise<any[]> {
    return db.select().from(routeHistory)
      .where(eq(routeHistory.userId, userId))
      .orderBy(desc(routeHistory.createdAt))
      .limit(limit);
  }

  // Calculate perpendicular distance from point to line segment (for accurate route deviation)
  private pointToSegmentDistance(
    pointLat: number, pointLng: number,
    segStartLat: number, segStartLng: number,
    segEndLat: number, segEndLng: number
  ): number {
    // Convert to approximate meters for calculation
    const latScale = 111320; // meters per degree latitude
    const lngScale = 111320 * Math.cos(pointLat * Math.PI / 180); // meters per degree longitude
    
    const px = (pointLng - segStartLng) * lngScale;
    const py = (pointLat - segStartLat) * latScale;
    const sx = (segEndLng - segStartLng) * lngScale;
    const sy = (segEndLat - segStartLat) * latScale;
    
    const segLenSq = sx * sx + sy * sy;
    
    if (segLenSq === 0) {
      // Segment is a point
      return Math.sqrt(px * px + py * py);
    }
    
    // Project point onto segment, clamped to [0, 1]
    const t = Math.max(0, Math.min(1, (px * sx + py * sy) / segLenSq));
    
    // Closest point on segment
    const closestX = t * sx;
    const closestY = t * sy;
    
    // Distance from point to closest point on segment
    return Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2);
  }

  async checkDeviation(userId: number, currentLat: number, currentLng: number): Promise<{
    isOffRoute: boolean;
    distanceFromRoute: number;
    shouldRecalculate: boolean;
    currentSegment: number;
    progressPercent: number;
    estimatedArrival: string | null;
  }> {
    const nav = await this.getActiveNavigation(userId);
    if (!nav) {
      return { isOffRoute: false, distanceFromRoute: 0, shouldRecalculate: false, currentSegment: 0, progressPercent: 0, estimatedArrival: null };
    }

    const prefs = await this.getPreferences(userId);
    const threshold = prefs?.deviationThreshold || 50; // meters

    const waypoints = nav.waypointsData as WaypointInput[];
    const currentIndex = nav.currentWaypointIndex;
    
    if (currentIndex >= waypoints.length - 1) {
      return { isOffRoute: false, distanceFromRoute: 0, shouldRecalculate: false, currentSegment: waypoints.length - 1, progressPercent: 100, estimatedArrival: null };
    }

    // Check distance to all remaining route segments, find minimum
    let minDistance = Infinity;
    let closestSegment = currentIndex;
    
    for (let i = currentIndex; i < waypoints.length - 1; i++) {
      const segDist = this.pointToSegmentDistance(
        currentLat, currentLng,
        waypoints[i].lat, waypoints[i].lng,
        waypoints[i + 1].lat, waypoints[i + 1].lng
      );
      
      if (segDist < minDistance) {
        minDistance = segDist;
        closestSegment = i;
      }
    }
    
    // Also check direct distance to next waypoint for arrival detection
    const distToNext = this.haversineDistance(
      currentLat, currentLng,
      waypoints[currentIndex + 1].lat, waypoints[currentIndex + 1].lng
    );

    // Off-route if perpendicular distance exceeds threshold
    const isOffRoute = minDistance > threshold;
    const shouldRecalculate = isOffRoute && (prefs?.autoRecalculate !== false);

    // Calculate progress percentage
    let completedDistance = 0;
    let totalDistance = 0;
    for (let i = 0; i < waypoints.length - 1; i++) {
      const segDist = this.haversineDistance(
        waypoints[i].lat, waypoints[i].lng,
        waypoints[i + 1].lat, waypoints[i + 1].lng
      );
      totalDistance += segDist;
      if (i < closestSegment) {
        completedDistance += segDist;
      } else if (i === closestSegment) {
        // Partial progress on current segment
        const segProgress = 1 - (distToNext / segDist);
        completedDistance += segDist * Math.max(0, Math.min(1, segProgress));
      }
    }
    const progressPercent = totalDistance > 0 ? Math.round((completedDistance / totalDistance) * 100) : 0;

    // Estimate arrival time (rough calculation based on average speed)
    const remainingDistance = totalDistance - completedDistance;
    const avgSpeedMps = nav.profile === "walking" ? 1.4 : nav.profile === "cycling" ? 4.5 : 11; // m/s
    const remainingSeconds = remainingDistance / avgSpeedMps;
    const eta = new Date(Date.now() + remainingSeconds * 1000);
    const estimatedArrival = eta.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

    if (isOffRoute) {
      await this.updateNavigation(userId, {
        isOffRoute: true,
        offRouteCount: (nav.offRouteCount || 0) + 1,
        lastKnownLat: currentLat.toString(),
        lastKnownLng: currentLng.toString(),
      });
      console.log(`[Navigation] User ${userId} off route by ${Math.round(minDistance)}m (threshold: ${threshold}m)`);
    } else if (nav.isOffRoute) {
      // Back on route
      await this.updateNavigation(userId, { isOffRoute: false });
      console.log(`[Navigation] User ${userId} back on route`);
    }

    return {
      isOffRoute,
      distanceFromRoute: Math.round(minDistance),
      shouldRecalculate,
      currentSegment: closestSegment,
      progressPercent,
      estimatedArrival,
    };
  }

  async checkArrivalProximity(userId: number, currentLat: number, currentLng: number): Promise<{
    nearWaypoint: WaypointInput | null;
    waypointIndex: number;
    distanceToWaypoint: number;
    shouldAlert: boolean;
  }> {
    const nav = await this.getActiveNavigation(userId);
    if (!nav) {
      return { nearWaypoint: null, waypointIndex: -1, distanceToWaypoint: 0, shouldAlert: false };
    }

    const prefs = await this.getPreferences(userId);
    const alertDistance = prefs?.arrivalAlertDistance || 200;

    const waypoints = nav.waypointsData as WaypointInput[];
    const currentIndex = nav.currentWaypointIndex;

    if (currentIndex >= waypoints.length - 1) {
      const lastWp = waypoints[waypoints.length - 1];
      const dist = this.haversineDistance(currentLat, currentLng, lastWp.lat, lastWp.lng);
      return {
        nearWaypoint: lastWp,
        waypointIndex: waypoints.length - 1,
        distanceToWaypoint: dist,
        shouldAlert: dist <= alertDistance,
      };
    }

    const nextWp = waypoints[currentIndex + 1];
    const dist = this.haversineDistance(currentLat, currentLng, nextWp.lat, nextWp.lng);

    if (dist <= 30) {
      await this.updateNavigation(userId, {
        currentWaypointIndex: currentIndex + 1,
      });
    }

    return {
      nearWaypoint: nextWp,
      waypointIndex: currentIndex + 1,
      distanceToWaypoint: dist,
      shouldAlert: dist <= alertDistance,
    };
  }

  async createRouteFromWaypoints(userId: number, name: string, waypoints: WaypointInput[], profile: string): Promise<SavedRoute> {
    const route = await this.createRoute({
      userId,
      name,
      profile,
    });

    await this.setWaypoints(route.id, userId, waypoints);
    
    return route;
  }

  async duplicateRoute(routeId: number, userId: number, newName?: string): Promise<SavedRoute | null> {
    const original = await this.getRoute(routeId, userId);
    if (!original) return null;

    const waypoints = await this.getWaypoints(routeId, userId);
    
    const newRoute = await this.createRoute({
      userId,
      name: newName || `${original.name} (copie)`,
      description: original.description,
      profile: original.profile,
      tags: original.tags,
    });

    const waypointInputs: WaypointInput[] = waypoints.map(wp => ({
      lat: parseFloat(wp.latitude),
      lng: parseFloat(wp.longitude),
      label: wp.label,
      address: wp.address || undefined,
      name: wp.name || undefined,
      notes: wp.notes || undefined,
    }));

    await this.setWaypoints(newRoute.id, userId, waypointInputs);
    
    return newRoute;
  }

  async incrementUsage(routeId: number, userId: number): Promise<void> {
    const route = await this.getRoute(routeId, userId);
    if (route) {
      await db.update(savedRoutes)
        .set({ 
          usageCount: (route.usageCount || 0) + 1,
          lastUsedAt: new Date(),
        })
        .where(eq(savedRoutes.id, routeId));
    }
  }

  async getSpeedLimit(lat: number, lng: number): Promise<{ speedLimit: number | null; roadName: string | null; roadType: string | null }> {
    try {
      const radius = 30;
      const query = `
        [out:json][timeout:5];
        way(around:${radius},${lat},${lng})["highway"];
        out body;
      `;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        body: `data=${encodeURIComponent(query)}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      
      if (!response.ok) return { speedLimit: null, roadName: null, roadType: null };
      
      const data = await response.json();
      
      if (!data.elements || data.elements.length === 0) {
        return { speedLimit: null, roadName: null, roadType: null };
      }

      const road = data.elements[0];
      const tags = road.tags || {};
      
      let speedLimit: number | null = null;
      if (tags.maxspeed) {
        const match = tags.maxspeed.match(/^(\d+)/);
        if (match) {
          speedLimit = parseInt(match[1], 10);
          if (tags.maxspeed.includes("mph")) {
            speedLimit = Math.round(speedLimit * 1.60934);
          }
        }
      } else {
        const defaultSpeeds: Record<string, number> = {
          motorway: 130,
          trunk: 110,
          primary: 80,
          secondary: 70,
          tertiary: 50,
          residential: 30,
          living_street: 20,
          unclassified: 50,
        };
        speedLimit = defaultSpeeds[tags.highway] || null;
      }

      return {
        speedLimit,
        roadName: tags.name || tags.ref || null,
        roadType: tags.highway || null,
      };
    } catch (error) {
      console.log("[Navigation] Speed limit fetch failed:", error);
      return { speedLimit: null, roadName: null, roadType: null };
    }
  }

  async getEnhancedNavInfo(userId: number, lat: number, lng: number, currentSpeedKmh: number): Promise<{
    speedLimit: number | null;
    roadName: string | null;
    roadType: string | null;
    dynamicEta: string | null;
    remainingDistance: number;
    remainingTime: number;
    isOverSpeed: boolean;
  }> {
    const nav = await this.getActiveNavigation(userId);
    if (!nav) {
      return { speedLimit: null, roadName: null, roadType: null, dynamicEta: null, remainingDistance: 0, remainingTime: 0, isOverSpeed: false };
    }

    const { speedLimit, roadName, roadType } = await this.getSpeedLimit(lat, lng);
    
    const waypoints = nav.waypointsData as WaypointInput[];
    const currentIndex = nav.currentWaypointIndex;
    
    if (currentIndex >= waypoints.length - 1) {
      const lastWp = waypoints[waypoints.length - 1];
      const distToEnd = this.haversineDistance(lat, lng, lastWp.lat, lastWp.lng);
      const isOverSpeed = speedLimit !== null && currentSpeedKmh > speedLimit + 5;
      return {
        speedLimit,
        roadName,
        roadType,
        dynamicEta: distToEnd < 50 ? "Arrivée" : null,
        remainingDistance: Math.round(distToEnd),
        remainingTime: 0,
        isOverSpeed,
      };
    }
    
    let remainingDistance = 0;
    for (let i = currentIndex; i < waypoints.length - 1; i++) {
      if (i === currentIndex) {
        remainingDistance += this.haversineDistance(lat, lng, waypoints[i + 1].lat, waypoints[i + 1].lng);
      } else {
        remainingDistance += this.haversineDistance(waypoints[i].lat, waypoints[i].lng, waypoints[i + 1].lat, waypoints[i + 1].lng);
      }
    }

    let avgSpeedMps: number;
    if (currentSpeedKmh > 5) {
      avgSpeedMps = (currentSpeedKmh / 3.6) * 0.85;
    } else {
      avgSpeedMps = nav.profile === "walking" ? 1.4 : nav.profile === "cycling" ? 4.5 : 11;
    }
    
    const remainingSeconds = remainingDistance / avgSpeedMps;
    const eta = new Date(Date.now() + remainingSeconds * 1000);
    const dynamicEta = eta.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

    const isOverSpeed = speedLimit !== null && currentSpeedKmh > speedLimit + 5;

    return {
      speedLimit,
      roadName,
      roadType,
      dynamicEta,
      remainingDistance: Math.round(remainingDistance),
      remainingTime: Math.round(remainingSeconds),
      isOverSpeed,
    };
  }

  async getSpeedCameras(lat: number, lng: number, radius: number = 1000): Promise<Array<{
    lat: number;
    lng: number;
    type: string;
    distance: number;
  }>> {
    try {
      const query = `
        [out:json][timeout:5];
        (
          node["highway"="speed_camera"](around:${radius},${lat},${lng});
          node["enforcement"="maxspeed"](around:${radius},${lat},${lng});
          node["traffic_enforcement"](around:${radius},${lat},${lng});
        );
        out body;
      `;
      
      const response = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        body: query,
      });
      
      const data = await response.json();
      const cameras: Array<{ lat: number; lng: number; type: string; distance: number }> = [];
      
      if (data.elements) {
        for (const el of data.elements) {
          const distance = this.haversineDistance(lat, lng, el.lat, el.lon);
          cameras.push({
            lat: el.lat,
            lng: el.lon,
            type: el.tags?.enforcement || el.tags?.highway || "speed_camera",
            distance: Math.round(distance),
          });
        }
      }
      
      return cameras.sort((a, b) => a.distance - b.distance);
    } catch (error) {
      console.log("[Navigation] Speed camera fetch failed:", error);
      return [];
    }
  }

  async getSchoolZones(lat: number, lng: number, radius: number = 500): Promise<Array<{
    lat: number;
    lng: number;
    name: string;
    distance: number;
  }>> {
    try {
      const query = `
        [out:json][timeout:5];
        (
          way["amenity"="school"](around:${radius},${lat},${lng});
          node["amenity"="school"](around:${radius},${lat},${lng});
        );
        out center;
      `;
      
      const response = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        body: query,
      });
      
      const data = await response.json();
      const schools: Array<{ lat: number; lng: number; name: string; distance: number }> = [];
      
      if (data.elements) {
        for (const el of data.elements) {
          const elLat = el.center?.lat || el.lat;
          const elLng = el.center?.lon || el.lon;
          if (!elLat || !elLng) continue;
          
          const distance = this.haversineDistance(lat, lng, elLat, elLng);
          schools.push({
            lat: elLat,
            lng: elLng,
            name: el.tags?.name || "École",
            distance: Math.round(distance),
          });
        }
      }
      
      return schools.sort((a, b) => a.distance - b.distance).slice(0, 5);
    } catch (error) {
      console.log("[Navigation] School zone fetch failed:", error);
      return [];
    }
  }

  async getPOIsAlongRoute(lat: number, lng: number, heading: number, radius: number = 2000): Promise<Array<{
    lat: number;
    lng: number;
    name: string;
    type: string;
    distance: number;
  }>> {
    try {
      const query = `
        [out:json][timeout:8];
        (
          node["amenity"="fuel"](around:${radius},${lat},${lng});
          node["amenity"="charging_station"](around:${radius},${lat},${lng});
          node["highway"="rest_area"](around:${radius},${lat},${lng});
          node["highway"="services"](around:${radius},${lat},${lng});
          node["amenity"="parking"](around:${radius},${lat},${lng});
        );
        out body;
      `;
      
      const response = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        body: query,
      });
      
      const data = await response.json();
      const pois: Array<{ lat: number; lng: number; name: string; type: string; distance: number }> = [];
      
      if (data.elements) {
        for (const el of data.elements) {
          const distance = this.haversineDistance(lat, lng, el.lat, el.lon);
          const type = el.tags?.amenity || el.tags?.highway || "poi";
          const typeLabels: Record<string, string> = {
            fuel: "Station-service",
            charging_station: "Borne de recharge",
            rest_area: "Aire de repos",
            services: "Aire de service",
            parking: "Parking",
          };
          
          pois.push({
            lat: el.lat,
            lng: el.lon,
            name: el.tags?.name || el.tags?.brand || typeLabels[type] || type,
            type,
            distance: Math.round(distance),
          });
        }
      }
      
      return pois.sort((a, b) => a.distance - b.distance).slice(0, 10);
    } catch (error) {
      console.log("[Navigation] POI fetch failed:", error);
      return [];
    }
  }

  async getNavigationAlerts(userId: number, lat: number, lng: number, speedKmh: number, heading: number): Promise<{
    speedCameras: Array<{ distance: number; type: string }>;
    schoolZones: Array<{ distance: number; name: string }>;
    curveWarning: { ahead: boolean; recommendedSpeed: number } | null;
  }> {
    const [cameras, schools] = await Promise.all([
      this.getSpeedCameras(lat, lng, 800),
      this.getSchoolZones(lat, lng, 300),
    ]);
    
    const nearbyCameras = cameras
      .filter(c => c.distance < 500)
      .map(c => ({ distance: c.distance, type: c.type }));
    
    const nearbySchools = schools
      .filter(s => s.distance < 200)
      .map(s => ({ distance: s.distance, name: s.name }));
    
    let curveWarning = null;
    if (speedKmh > 60) {
      const nav = await this.getActiveNavigation(userId);
      if (nav) {
        const waypoints = nav.waypointsData as WaypointInput[];
        const currentIndex = nav.currentWaypointIndex;
        
        if (currentIndex < waypoints.length - 2) {
          const next = waypoints[currentIndex + 1];
          const afterNext = waypoints[currentIndex + 2];
          
          const bearing1 = this.calculateBearing(lat, lng, next.lat, next.lng);
          const bearing2 = this.calculateBearing(next.lat, next.lng, afterNext.lat, afterNext.lng);
          
          let angleDiff = Math.abs(bearing2 - bearing1);
          if (angleDiff > 180) angleDiff = 360 - angleDiff;
          
          if (angleDiff > 45) {
            const recommendedSpeed = angleDiff > 90 ? 30 : angleDiff > 60 ? 50 : 70;
            if (speedKmh > recommendedSpeed + 10) {
              curveWarning = { ahead: true, recommendedSpeed };
            }
          }
        }
      }
    }
    
    return { speedCameras: nearbyCameras, schoolZones: nearbySchools, curveWarning };
  }

  private calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const toRad = (d: number) => d * Math.PI / 180;
    const toDeg = (r: number) => r * 180 / Math.PI;
    
    const dLng = toRad(lng2 - lng1);
    const lat1Rad = toRad(lat1);
    const lat2Rad = toRad(lat2);
    
    const y = Math.sin(dLng) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
    
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  async getTripStatistics(userId: number): Promise<{
    totalTrips: number;
    totalDistance: number;
    totalDuration: number;
    averageSpeed: number;
    mostUsedProfile: string;
    recentTrips: Array<{ date: string; distance: number; duration: number }>;
  }> {
    const history = await this.getHistory(userId, 100);
    
    let totalDistance = 0;
    let totalDuration = 0;
    const profileCounts: Record<string, number> = {};
    
    for (const trip of history) {
      totalDistance += trip.actualDistance || trip.plannedDistance || 0;
      totalDuration += trip.actualDuration || trip.plannedDuration || 0;
      profileCounts[trip.profile] = (profileCounts[trip.profile] || 0) + 1;
    }
    
    const mostUsedProfile = Object.entries(profileCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || "driving";
    
    const averageSpeed = totalDuration > 0 ? (totalDistance / 1000) / (totalDuration / 3600) : 0;
    
    const recentTrips = history.slice(0, 10).map(t => ({
      date: new Date(t.completedAt || t.createdAt).toLocaleDateString("fr-FR"),
      distance: Math.round((t.actualDistance || t.plannedDistance || 0) / 1000),
      duration: Math.round((t.actualDuration || t.plannedDuration || 0) / 60),
    }));
    
    return {
      totalTrips: history.length,
      totalDistance: Math.round(totalDistance / 1000),
      totalDuration: Math.round(totalDuration / 60),
      averageSpeed: Math.round(averageSpeed),
      mostUsedProfile,
      recentTrips,
    };
  }
}

export const itineraryService = new ItineraryService();
