/**
 * CSRF Protection Middleware
 *
 * Uses the double-submit cookie pattern:
 * 1. Server sets a random CSRF token in a cookie (readable by JS)
 * 2. Client reads the cookie and sends the token in X-CSRF-Token header
 * 3. Server verifies cookie value matches header value
 *
 * Safe methods (GET, HEAD, OPTIONS) are exempt.
 * API routes that use Bearer token auth are exempt (no cookie = no CSRF risk).
 */

import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

const CSRF_COOKIE = "csrf_token";
const CSRF_HEADER = "x-csrf-token";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Routes exempt from CSRF (use their own auth: API keys, PIN codes, webhooks) */
const EXEMPT_PREFIXES = [
  "/api/auth/login",
  "/api/auth/setup",
  "/api/guest",
  "/api/coba",
  "/api/devmax",
  "/api/suguval",
  "/api/sugumaillane",
  "/api/sports",
  "/api/footdatas",
  "/api/discord/webhook",
  "/api/v2/siri-webhook",
  "/api/v2/devices",       // uses Bearer token
  "/api/agentmail",        // uses API key
  "/api/health",
  "/_health",
];

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Ensure a CSRF cookie exists on every response.
 */
export function csrfCookieSetter(req: Request, res: Response, next: NextFunction) {
  if (!req.cookies?.[CSRF_COOKIE]) {
    const token = generateToken();
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,       // JS must read this
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 24 * 60 * 60 * 1000, // 24h
    });
  }
  next();
}

/**
 * Validate CSRF token on state-changing requests.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  // Safe methods don't need CSRF
  if (SAFE_METHODS.has(req.method)) return next();

  // Exempt routes (webhook, external auth, etc.)
  if (EXEMPT_PREFIXES.some((p) => req.path.startsWith(p))) return next();

  // Bearer token auth is not vulnerable to CSRF
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) return next();

  // Double-submit check
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER] as string | undefined;

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({
      error: {
        code: "CSRF_VALIDATION_FAILED",
        message: "Invalid or missing CSRF token",
      },
    });
  }

  next();
}
