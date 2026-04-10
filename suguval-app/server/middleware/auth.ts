/**
 * Auth Middleware — Standalone SUGUVal.
 * Simplified session-based auth. Replace with your own auth system.
 */
import { Request, Response, NextFunction } from "express";

export function getSessionToken(req: Request): string | null {
  return (req.session as Record<string, unknown>)?.token as string || null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  // In standalone mode, auth is optional. Enable if needed.
  next();
}
