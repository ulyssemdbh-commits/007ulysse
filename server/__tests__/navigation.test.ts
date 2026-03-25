import { describe, it, expect, vi, beforeEach } from "vitest";

interface RoutePoint {
  lat: number;
  lng: number;
  instruction?: string;
  distance?: number;
}

interface NavigationState {
  isNavigating: boolean;
  currentPosition: { lat: number; lng: number } | null;
  destination: { lat: number; lng: number } | null;
  routePoints: RoutePoint[];
  currentInstructionIndex: number;
  distanceRemaining: number;
  eta: Date | null;
  isOffRoute: boolean;
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

function calculateDistanceToRoute(position: { lat: number; lng: number }, routePoints: RoutePoint[]): number {
  if (routePoints.length === 0) return Infinity;
  
  let minDistance = Infinity;
  for (const point of routePoints) {
    const dist = haversineDistance(position.lat, position.lng, point.lat, point.lng);
    if (dist < minDistance) minDistance = dist;
  }
  return minDistance;
}

function isOffRoute(position: { lat: number; lng: number }, routePoints: RoutePoint[], threshold: number = 50): boolean {
  return calculateDistanceToRoute(position, routePoints) > threshold;
}

function findNearestInstruction(position: { lat: number; lng: number }, routePoints: RoutePoint[]): number {
  let minIndex = 0;
  let minDistance = Infinity;
  
  for (let i = 0; i < routePoints.length; i++) {
    const dist = haversineDistance(position.lat, position.lng, routePoints[i].lat, routePoints[i].lng);
    if (dist < minDistance) {
      minDistance = dist;
      minIndex = i;
    }
  }
  return minIndex;
}

function calculateETA(distanceMeters: number, speedKmh: number): Date | null {
  if (speedKmh <= 0) return null;
  const speedMs = speedKmh / 3.6;
  const seconds = distanceMeters / speedMs;
  return new Date(Date.now() + seconds * 1000);
}

function formatETA(eta: Date | null): string {
  if (!eta) return "--:--";
  return eta.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function calculateProgress(currentIndex: number, totalPoints: number): number {
  if (totalPoints === 0) return 0;
  return Math.round((currentIndex / totalPoints) * 100);
}

describe("Navigation Service", () => {
  const routePoints: RoutePoint[] = [
    { lat: 48.8566, lng: 2.3522, instruction: "Départ", distance: 0 },
    { lat: 48.8576, lng: 2.3532, instruction: "Tournez à droite", distance: 100 },
    { lat: 48.8586, lng: 2.3542, instruction: "Continuez tout droit", distance: 200 },
    { lat: 48.8596, lng: 2.3552, instruction: "Arrivée", distance: 300 },
  ];

  describe("Distance to Route", () => {
    it("calculates distance to nearest route point", () => {
      const position = { lat: 48.8566, lng: 2.3522 };
      const distance = calculateDistanceToRoute(position, routePoints);
      expect(distance).toBeLessThan(10);
    });

    it("returns Infinity for empty route", () => {
      const position = { lat: 48.8566, lng: 2.3522 };
      expect(calculateDistanceToRoute(position, [])).toBe(Infinity);
    });
  });

  describe("Off-Route Detection", () => {
    it("detects when on route", () => {
      const position = { lat: 48.8566, lng: 2.3522 };
      expect(isOffRoute(position, routePoints)).toBe(false);
    });

    it("detects when off route", () => {
      const position = { lat: 48.87, lng: 2.37 };
      expect(isOffRoute(position, routePoints)).toBe(true);
    });

    it("respects custom threshold", () => {
      const position = { lat: 48.857, lng: 2.353 };
      expect(isOffRoute(position, routePoints, 500)).toBe(false);
    });
  });

  describe("Nearest Instruction", () => {
    it("finds nearest instruction point", () => {
      const position = { lat: 48.8576, lng: 2.3532 };
      const index = findNearestInstruction(position, routePoints);
      expect(index).toBe(1);
    });

    it("returns 0 for start position", () => {
      const position = { lat: 48.8566, lng: 2.3522 };
      const index = findNearestInstruction(position, routePoints);
      expect(index).toBe(0);
    });
  });

  describe("ETA Calculation", () => {
    it("calculates ETA based on speed", () => {
      const eta = calculateETA(10000, 50);
      expect(eta).not.toBeNull();
      expect(eta!.getTime()).toBeGreaterThan(Date.now());
    });

    it("returns null for zero speed", () => {
      expect(calculateETA(1000, 0)).toBeNull();
    });

    it("returns null for negative speed", () => {
      expect(calculateETA(1000, -10)).toBeNull();
    });
  });

  describe("ETA Formatting", () => {
    it("formats ETA correctly", () => {
      const eta = new Date("2026-01-15T14:30:00");
      const formatted = formatETA(eta);
      expect(formatted).toContain("14");
      expect(formatted).toContain("30");
    });

    it("returns placeholder for null", () => {
      expect(formatETA(null)).toBe("--:--");
    });
  });

  describe("Progress Calculation", () => {
    it("calculates progress percentage", () => {
      expect(calculateProgress(2, 4)).toBe(50);
      expect(calculateProgress(0, 4)).toBe(0);
      expect(calculateProgress(4, 4)).toBe(100);
    });

    it("handles empty route", () => {
      expect(calculateProgress(0, 0)).toBe(0);
    });
  });
});
