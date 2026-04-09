/**
 * Activity Ingestion Middleware - Phase 2
 * 
 * Express middleware that automatically records user API interactions
 * as behavior events. Captures:
 * - Which endpoints the user calls (conversations, files, devices, etc.)
 * - Time patterns (when do they use each feature)
 * - Action types (GET=browse, POST=create, PUT/PATCH=modify, DELETE=remove)
 * 
 * This feeds BehaviorService with passive data — the user doesn't need
 * to do anything special, their normal API usage generates patterns.
 */

import { Request, Response, NextFunction } from "express";
import { behaviorService } from "../services/behaviorService";

// Routes worth tracking for pattern detection
// (skip health checks, static assets, auth, etc.)
const TRACKED_PREFIXES = [
    "/api/conversations",
    "/api/v2/conversations",
    "/api/v2/devices",
    "/api/v2/smart-home",
    "/api/v2/emails",
    "/api/v2/location",
    "/api/v2/maps",
    "/api/v2/itinerary",
    "/api/v2/spotify",
    "/api/v2/stocks",
    "/api/v2/markets",
    "/api/v2/brain",
    "/api/v2/summary",
    "/api/v2/bets",
    "/api/voice",
    "/api/hub",
    "/api/music",
    "/api/sports",
    "/api/betting",
    "/api/files",
    "/api/memory",
    "/api/homework",
    "/api/generated-files",
    "/api/learning",
];

// Skip these specific paths even within tracked prefixes
const SKIP_PATHS = [
    "/api/v2/health",
    "/api/v2/monitoring",
    "/api/v2/capabilities",
    "/api/v2/me",
];

// Map HTTP methods to human-readable action types
const METHOD_TO_ACTION: Record<string, string> = {
    GET: "browse",
    POST: "create",
    PUT: "update",
    PATCH: "modify",
    DELETE: "remove",
};

// Map route prefixes to feature categories
const ROUTE_TO_FEATURE: Record<string, string> = {
    "/api/conversations": "chat",
    "/api/v2/conversations": "chat",
    "/api/v2/devices": "smart_home",
    "/api/v2/smart-home": "smart_home",
    "/api/v2/emails": "email",
    "/api/v2/location": "location",
    "/api/v2/maps": "maps",
    "/api/v2/itinerary": "navigation",
    "/api/v2/spotify": "music",
    "/api/v2/stocks": "finance",
    "/api/v2/markets": "finance",
    "/api/v2/brain": "knowledge",
    "/api/v2/summary": "summary",
    "/api/v2/bets": "betting",
    "/api/voice": "voice",
    "/api/hub": "hub",
    "/api/music": "music",
    "/api/sports": "sports",
    "/api/betting": "betting",
    "/api/files": "files",
    "/api/memory": "memory",
    "/api/homework": "homework",
    "/api/generated-files": "files",
    "/api/learning": "learning",
};

// Throttle: max 1 event per feature per user per 5 seconds
const throttleMap = new Map<string, number>();
const THROTTLE_MS = 5_000;

function isThrottled(userId: number, feature: string): boolean {
    const key = `${userId}:${feature}`;
    const now = Date.now();
    const last = throttleMap.get(key);
    if (last && now - last < THROTTLE_MS) return true;
    throttleMap.set(key, now);
    return false;
}

// Clean throttle map every 60s to prevent memory leak
setInterval(() => {
    const now = Date.now();
    const entries = Array.from(throttleMap.entries());
    for (const [key, ts] of entries) {
        if (now - ts > THROTTLE_MS * 2) throttleMap.delete(key);
    }
}, 60_000);

/**
 * Middleware that records successful API interactions as behavior events.
 * Runs AFTER the response is sent (non-blocking), so it adds zero latency.
 */
export function activityIngestionMiddleware(req: Request, res: Response, next: NextFunction) {
    // Only track after response is sent (non-blocking)
    res.on("finish", () => {
        try {
            // Only track successful responses (2xx/3xx)
            if (res.statusCode >= 400) return;

            // Get userId from session or JWT auth
            const userId = (req as Request & { userId?: number; session?: { userId?: number } }).userId || req.user?.id || (req as Request & { session?: { userId?: number } }).session?.userId;
            if (!userId || typeof userId !== "number") return;

            const path = req.path;
            const method = req.method;

            // Skip non-tracked paths
            if (SKIP_PATHS.some(s => path.startsWith(s))) return;
            if (!TRACKED_PREFIXES.some(p => path.startsWith(p))) return;

            // Determine feature category
            let feature = "unknown";
            for (const [prefix, feat] of Object.entries(ROUTE_TO_FEATURE)) {
                if (path.startsWith(prefix)) {
                    feature = feat;
                    break;
                }
            }

            // Throttle to avoid flooding DB on rapid polling
            if (isThrottled(userId, feature)) return;

            const action = METHOD_TO_ACTION[method] || "interact";
            const now = Date.now();

            // Record asynchronously — fire and forget
            behaviorService.recordActivityEvent(userId, {
                type: "activity.feature",
                data: {
                    feature,
                    action,
                    metadata: {
                        path,
                        method,
                        statusCode: res.statusCode,
                    },
                },
                timestamp: now,
            }).catch(() => { }); // Never let this crash anything

        } catch {
            // Silently ignore any errors in the middleware
        }
    });

    next();
}
