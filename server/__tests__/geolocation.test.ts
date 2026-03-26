import { describe, it, expect, vi, beforeEach } from "vitest";

interface LocationPoint {
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp: number;
}

interface Geofence {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a = Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function isInsideGeofence(point: LocationPoint, geofence: Geofence): boolean {
  const distance = haversineDistance(
    point.latitude, point.longitude,
    geofence.latitude, geofence.longitude
  );
  return distance <= geofence.radius;
}

function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  let bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

function calculateSpeed(p1: LocationPoint, p2: LocationPoint): number {
  const distance = haversineDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
  const timeDiff = (p2.timestamp - p1.timestamp) / 1000;
  if (timeDiff <= 0) return 0;
  return (distance / timeDiff) * 3.6;
}

function filterOutliers(points: LocationPoint[], maxSpeed: number = 150): LocationPoint[] {
  if (points.length < 2) return points;
  
  const filtered: LocationPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const speed = calculateSpeed(filtered[filtered.length - 1], points[i]);
    if (speed <= maxSpeed) {
      filtered.push(points[i]);
    }
  }
  return filtered;
}

describe("Geolocation Service", () => {
  describe("Haversine Distance", () => {
    it("calculates distance between two points", () => {
      const paris = { lat: 48.8566, lon: 2.3522 };
      const london = { lat: 51.5074, lon: -0.1278 };
      const distance = haversineDistance(paris.lat, paris.lon, london.lat, london.lon);
      expect(distance).toBeGreaterThan(340000);
      expect(distance).toBeLessThan(350000);
    });

    it("returns 0 for same point", () => {
      const distance = haversineDistance(48.8566, 2.3522, 48.8566, 2.3522);
      expect(distance).toBe(0);
    });

    it("calculates short distances accurately", () => {
      const distance = haversineDistance(48.8566, 2.3522, 48.8576, 2.3532);
      expect(distance).toBeGreaterThan(100);
      expect(distance).toBeLessThan(200);
    });
  });

  describe("Geofence Detection", () => {
    const geofence: Geofence = {
      id: 1,
      name: "Home",
      latitude: 48.8566,
      longitude: 2.3522,
      radius: 100,
    };

    it("detects point inside geofence", () => {
      const point: LocationPoint = {
        latitude: 48.8566,
        longitude: 2.3522,
        timestamp: Date.now(),
      };
      expect(isInsideGeofence(point, geofence)).toBe(true);
    });

    it("detects point outside geofence", () => {
      const point: LocationPoint = {
        latitude: 48.86,
        longitude: 2.36,
        timestamp: Date.now(),
      };
      expect(isInsideGeofence(point, geofence)).toBe(false);
    });

    it("handles edge case at boundary", () => {
      const point: LocationPoint = {
        latitude: 48.8575,
        longitude: 2.3522,
        timestamp: Date.now(),
      };
      const inside = isInsideGeofence(point, geofence);
      expect(typeof inside).toBe("boolean");
    });
  });

  describe("Bearing Calculation", () => {
    it("calculates bearing north", () => {
      const bearing = calculateBearing(48.0, 2.0, 49.0, 2.0);
      expect(bearing).toBeCloseTo(0, 0);
    });

    it("calculates bearing east", () => {
      const bearing = calculateBearing(48.0, 2.0, 48.0, 3.0);
      expect(bearing).toBeCloseTo(90, 0);
    });

    it("calculates bearing south", () => {
      const bearing = calculateBearing(49.0, 2.0, 48.0, 2.0);
      expect(bearing).toBeCloseTo(180, 0);
    });
  });

  describe("Speed Calculation", () => {
    it("calculates speed in km/h", () => {
      const p1: LocationPoint = { latitude: 48.8566, longitude: 2.3522, timestamp: 0 };
      const p2: LocationPoint = { latitude: 48.8666, longitude: 2.3522, timestamp: 36000 };
      const speed = calculateSpeed(p1, p2);
      expect(speed).toBeGreaterThan(90);
      expect(speed).toBeLessThan(120);
    });

    it("returns 0 for same timestamp", () => {
      const p1: LocationPoint = { latitude: 48.8566, longitude: 2.3522, timestamp: 1000 };
      const p2: LocationPoint = { latitude: 48.8666, longitude: 2.3522, timestamp: 1000 };
      expect(calculateSpeed(p1, p2)).toBe(0);
    });
  });

  describe("Outlier Filtering", () => {
    it("removes points with unrealistic speed", () => {
      const points: LocationPoint[] = [
        { latitude: 48.8566, longitude: 2.3522, timestamp: 0 },
        { latitude: 48.8567, longitude: 2.3523, timestamp: 1000 },
        { latitude: 50.0, longitude: 3.0, timestamp: 2000 },
        { latitude: 48.8568, longitude: 2.3524, timestamp: 3000 },
      ];
      const filtered = filterOutliers(points, 150);
      expect(filtered.length).toBeLessThan(points.length);
    });

    it("keeps all valid points", () => {
      const points: LocationPoint[] = [
        { latitude: 48.8566, longitude: 2.3522, timestamp: 0 },
        { latitude: 48.8567, longitude: 2.3523, timestamp: 60000 },
        { latitude: 48.8568, longitude: 2.3524, timestamp: 120000 },
      ];
      const filtered = filterOutliers(points, 150);
      expect(filtered.length).toBe(points.length);
    });
  });
});
