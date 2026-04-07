export type RoutingProfile = "driving" | "walking" | "cycling";

export interface OSRMRoute {
  distance: number;
  duration: number;
  geometry?: string;
}

type CacheValue =
  | { kind: "distance"; distance: number; duration: number }
  | { kind: "matrix"; distances: number[][] };

interface CacheEntry {
  value: CacheValue;
  timestamp: number;
}

const routingCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

const OSRM_BASE_URL = process.env.OSRM_BASE_URL || "https://router.project-osrm.org";

function makeRouteKey(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  profile: RoutingProfile
) {
  return `route:${profile}:${fromLat.toFixed(5)},${fromLng.toFixed(5)}->${toLat.toFixed(5)},${toLng.toFixed(5)}`;
}

function makeMatrixKey(
  waypoints: { lat: number; lng: number }[],
  profile: RoutingProfile
) {
  const coords = waypoints
    .map(wp => `${wp.lng.toFixed(5)},${wp.lat.toFixed(5)}`)
    .join(";");
  return `matrix:${profile}:${coords}`;
}

function getCache(key: string, kind: CacheValue["kind"]): CacheValue | null {
  const entry = routingCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    routingCache.delete(key);
    return null;
  }
  if (entry.value.kind !== kind) return null;
  return entry.value;
}

function setCache(key: string, value: CacheValue) {
  if (routingCache.size >= MAX_CACHE_ENTRIES) {
    const entries = Array.from(routingCache.entries()).sort(
      (a, b) => a[1].timestamp - b[1].timestamp
    );
    const toDelete = Math.min(50, entries.length);
    for (let i = 0; i < toDelete; i++) {
      routingCache.delete(entries[i][0]);
    }
    console.log(`[RoutingProvider] Cache GC: purged ${toDelete} oldest entries`);
  }
  routingCache.set(key, { value, timestamp: Date.now() });
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

export class RoutingProvider {
  constructor(private baseUrl: string = OSRM_BASE_URL) {}

  async getRoute(
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number,
    profile: RoutingProfile = "driving",
    retries = 3
  ): Promise<OSRMRoute | null> {
    const key = makeRouteKey(fromLat, fromLng, toLat, toLng, profile);
    const cached = getCache(key, "distance");
    if (cached) {
      const c = cached as { kind: "distance"; distance: number; duration: number };
      console.log(`[RoutingProvider] Cache HIT for route ${profile}`);
      return { distance: c.distance, duration: c.duration };
    }

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const url = `${this.baseUrl}/route/v1/${profile}/${fromLng},${fromLat};${toLng},${toLat}?overview=false`;
        const startTime = Date.now();
        const response = await fetchWithTimeout(url, 5000);
        const elapsed = Date.now() - startTime;

        if (!response.ok) throw new Error(`OSRM route returned ${response.status}`);
        const data = await response.json();

        if (data.code === "Ok" && data.routes && data.routes.length > 0) {
          const route = data.routes[0];
          setCache(key, {
            kind: "distance",
            distance: route.distance,
            duration: route.duration,
          });
          console.log(`[RoutingProvider] Route ${profile}: ${(route.distance/1000).toFixed(1)}km in ${elapsed}ms`);
          return { distance: route.distance, duration: route.duration };
        }

        console.log("[RoutingProvider] route: OSRM responded Ok but no routes[]");
        return null;
      } catch (err: any) {
        console.log(
          `[RoutingProvider] route attempt ${attempt + 1}/${retries} failed: ${err?.message}`
        );
        if (attempt < retries - 1) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        }
      }
    }

    return null;
  }

  async getMatrix(
    waypoints: { lat: number; lng: number }[],
    profile: RoutingProfile = "driving"
  ): Promise<number[][] | null> {
    const n = waypoints.length;
    if (n === 0) return [];

    const key = makeMatrixKey(waypoints, profile);
    const cached = getCache(key, "matrix");
    if (cached) {
      console.log(`[RoutingProvider] Cache HIT for ${n}x${n} matrix`);
      return (cached as { kind: "matrix"; distances: number[][] }).distances;
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const coords = waypoints.map(wp => `${wp.lng},${wp.lat}`).join(";");
        const url = `${this.baseUrl}/table/v1/${profile}/${coords}?annotations=distance`;
        const startTime = Date.now();
        const response = await fetchWithTimeout(url, 10000);
        const elapsed = Date.now() - startTime;

        if (!response.ok) throw new Error(`OSRM table returned ${response.status}`);
        const data = await response.json();

        if (data.code === "Ok" && data.distances) {
          setCache(key, { kind: "matrix", distances: data.distances });
          console.log(`[RoutingProvider] Table API: ${n}x${n} matrix in ${elapsed}ms`);
          return data.distances;
        }

        console.log("[RoutingProvider] table: OSRM responded Ok but no distances");
      } catch (err: any) {
        console.log(
          `[RoutingProvider] table attempt ${attempt + 1}/3 failed: ${err?.message}`
        );
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        }
      }
    }

    return null;
  }

  getCacheStats(): { size: number; maxSize: number; ttlMs: number } {
    return {
      size: routingCache.size,
      maxSize: MAX_CACHE_ENTRIES,
      ttlMs: CACHE_TTL_MS
    };
  }
}

export const routingProvider = new RoutingProvider();
