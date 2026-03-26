import { describe, it, expect, vi, beforeEach } from "vitest";

interface Waypoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  order: number;
  visited: boolean;
}

interface Itinerary {
  id: number;
  name: string;
  waypoints: Waypoint[];
  createdAt: Date;
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(deltaPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateTotalDistance(waypoints: Waypoint[]): number {
  if (waypoints.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    total += haversineDistance(
      waypoints[i].latitude, waypoints[i].longitude,
      waypoints[i + 1].latitude, waypoints[i + 1].longitude
    );
  }
  return total;
}

function optimizeRoute(waypoints: Waypoint[]): Waypoint[] {
  if (waypoints.length <= 2) return waypoints;
  
  const start = waypoints[0];
  const remaining = waypoints.slice(1);
  const optimized: Waypoint[] = [start];
  
  while (remaining.length > 0) {
    const last = optimized[optimized.length - 1];
    let nearestIdx = 0;
    let nearestDist = Infinity;
    
    for (let i = 0; i < remaining.length; i++) {
      const dist = haversineDistance(
        last.latitude, last.longitude,
        remaining[i].latitude, remaining[i].longitude
      );
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }
    
    optimized.push(remaining.splice(nearestIdx, 1)[0]);
  }
  
  return optimized.map((wp, idx) => ({ ...wp, order: idx }));
}

function getNextWaypoint(waypoints: Waypoint[]): Waypoint | null {
  const unvisited = waypoints.filter(wp => !wp.visited);
  if (unvisited.length === 0) return null;
  return unvisited.reduce((min, wp) => wp.order < min.order ? wp : min);
}

function getProgress(waypoints: Waypoint[]): { visited: number; total: number; percent: number } {
  const visited = waypoints.filter(wp => wp.visited).length;
  const total = waypoints.length;
  return { visited, total, percent: total > 0 ? (visited / total) * 100 : 0 };
}

describe("Itinerary Service", () => {
  const sampleWaypoints: Waypoint[] = [
    { id: "1", name: "Start", latitude: 48.8566, longitude: 2.3522, order: 0, visited: false },
    { id: "2", name: "Stop 1", latitude: 48.8606, longitude: 2.3376, order: 1, visited: false },
    { id: "3", name: "Stop 2", latitude: 48.8530, longitude: 2.3499, order: 2, visited: false },
    { id: "4", name: "End", latitude: 48.8584, longitude: 2.2945, order: 3, visited: false },
  ];

  describe("Total Distance Calculation", () => {
    it("calculates total distance for multiple waypoints", () => {
      const distance = calculateTotalDistance(sampleWaypoints);
      expect(distance).toBeGreaterThan(0);
    });

    it("returns 0 for single waypoint", () => {
      expect(calculateTotalDistance([sampleWaypoints[0]])).toBe(0);
    });

    it("returns 0 for empty array", () => {
      expect(calculateTotalDistance([])).toBe(0);
    });
  });

  describe("Route Optimization", () => {
    it("optimizes route using nearest neighbor", () => {
      const shuffled = [...sampleWaypoints].sort(() => Math.random() - 0.5);
      const optimized = optimizeRoute(shuffled);
      
      expect(optimized.length).toBe(sampleWaypoints.length);
      expect(optimized[0].id).toBe(shuffled[0].id);
    });

    it("maintains order for 2 or fewer waypoints", () => {
      const twoPoints = sampleWaypoints.slice(0, 2);
      const optimized = optimizeRoute(twoPoints);
      expect(optimized.length).toBe(2);
    });

    it("updates order property after optimization", () => {
      const optimized = optimizeRoute(sampleWaypoints);
      optimized.forEach((wp, idx) => {
        expect(wp.order).toBe(idx);
      });
    });
  });

  describe("Next Waypoint", () => {
    it("returns first unvisited waypoint", () => {
      const next = getNextWaypoint(sampleWaypoints);
      expect(next?.id).toBe("1");
    });

    it("skips visited waypoints", () => {
      const withVisited = sampleWaypoints.map((wp, idx) => 
        idx === 0 ? { ...wp, visited: true } : wp
      );
      const next = getNextWaypoint(withVisited);
      expect(next?.id).toBe("2");
    });

    it("returns null when all visited", () => {
      const allVisited = sampleWaypoints.map(wp => ({ ...wp, visited: true }));
      expect(getNextWaypoint(allVisited)).toBeNull();
    });
  });

  describe("Progress Tracking", () => {
    it("calculates progress correctly", () => {
      const progress = getProgress(sampleWaypoints);
      expect(progress.visited).toBe(0);
      expect(progress.total).toBe(4);
      expect(progress.percent).toBe(0);
    });

    it("updates progress with visited waypoints", () => {
      const withVisited = sampleWaypoints.map((wp, idx) => 
        idx < 2 ? { ...wp, visited: true } : wp
      );
      const progress = getProgress(withVisited);
      expect(progress.visited).toBe(2);
      expect(progress.percent).toBe(50);
    });

    it("shows 100% when all visited", () => {
      const allVisited = sampleWaypoints.map(wp => ({ ...wp, visited: true }));
      const progress = getProgress(allVisited);
      expect(progress.percent).toBe(100);
    });
  });
});
