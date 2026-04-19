import type { Request, Response, NextFunction } from "express";
import { brainPulse, type BrainPulseZone } from "../services/sensory/BrainPulse";

/**
 * Universal HTTP → BrainPulse middleware.
 *
 * Promise: every server action produces a visible reaction on the 3D Brain.
 * This middleware fires a brainPulse() on EVERY API request once the response
 * has been sent, so the visualizer reacts to literally any server activity.
 *
 * Skipped paths (would create infinite loops or pure noise):
 *  - /api/v2/sensory/*  (the visualizer's own polls + SSE feed)
 *  - /api/health*       (liveness probes)
 *  - /api/perf*         (perf profiler self-reads)
 *  - /api/voice/status  (poll)
 *  - /api/auth/*        (handled separately, very high frequency)
 */

const SKIP_PREFIXES: string[] = [
  "/api/v2/sensory",
  "/api/v2/health",
  "/api/health",
  "/api/healthz",
  "/api/perf",
  "/api/auth",
  "/api/voice/status",
  "/api/traces/stats",
  "/api/conversations/", // GET reads spam too much; their writes already pulse via service
];

function shouldSkip(path: string): boolean {
  for (const p of SKIP_PREFIXES) if (path.startsWith(p)) return true;
  return false;
}

function classifyZone(method: string, path: string): BrainPulseZone[] {
  // Most specific first.
  if (/\/voice|\/tts|\/speak/.test(path))            return ["language"];
  if (/\/ai|\/chat|\/completion|\/llm/.test(path))   return ["prefrontal"];
  if (/\/memory|\/recall|\/context/.test(path))      return ["hippocampus"];
  if (/\/embedding|\/vector|\/search/.test(path))    return ["feature"];
  if (/\/bridge|\/intuition|\/insight/.test(path))   return ["association"];
  if (/\/learn|\/concept|\/knowledge/.test(path))    return ["concept"];
  if (/\/vision|\/ocr|\/screen|\/image/.test(path))  return ["sensory"];
  if (/\/hear|\/listen|\/transcript/.test(path))     return ["sensory"];
  if (/\/tool|\/exec|\/action|\/job|\/mcp/.test(path)) return ["motor"];

  // Generic fallback: read = sensory, write = motor.
  if (method === "GET" || method === "HEAD") return ["sensory"];
  return ["motor"];
}

export function brainPulseHttpMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const path = req.path || req.url || "";
    if (!path.startsWith("/api/") || shouldSkip(path)) return next();

    const start = Date.now();
    res.on("finish", () => {
      try {
        const zones = classifyZone(req.method, path);
        const duration = Date.now() - start;
        const status = res.statusCode;
        const summary = `${req.method} ${path} → ${status} (${duration}ms)`;
        // Throttle longer per route so a hot endpoint doesn't drown the bus,
        // but fast enough that the user sees activity on every burst.
        brainPulse(zones, "http", summary, {
          throttleMs: 120,
          intensity: status >= 400 ? 3 : 1,
        });
      } catch {
        /* never block on monitoring */
      }
    });
    next();
  };
}
