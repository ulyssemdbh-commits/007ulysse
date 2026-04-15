import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

const CSRF_COOKIE = "csrf_token";
const CSRF_HEADER = "x-csrf-token";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

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
  "/api/v2/devices",
  "/api/agentmail",
  "/api/health",
  "/_health",
];

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function csrfCookieSetter(req: Request, res: Response, next: NextFunction) {
  if (!req.cookies?.[CSRF_COOKIE]) {
    const token = generateToken();
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 24 * 60 * 60 * 1000,
    });
  }
  next();
}

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();

  if (EXEMPT_PREFIXES.some((p) => req.path.startsWith(p))) return next();

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) return next();

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
