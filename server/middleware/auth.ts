import { Request, Response, NextFunction } from "express";
import { authService } from "../services/auth";
import type { User, Session } from "@shared/schema";

declare global {
  namespace Express {
    interface Request {
      user?: User;
      session?: Session;
    }
  }
}

const SESSION_COOKIE_NAME = "ulysse_session";

export function getSessionToken(req: Request): string | null {
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
  if (cookieToken) return cookieToken;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  return null;
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days with rolling refresh
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = getSessionToken(req);

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const result = await authService.validateSession(token);

  if (!result.success) {
    clearSessionCookie(res);
    return res.status(401).json({ error: result.error });
  }

  req.user = result.user;
  req.session = result.session;

  if (result.user?.isOwner && !result.session?.twoFactorVerified) {
    const path = req.path || req.originalUrl || "";
    const is2FARoute = path.includes("/2fa/");
    const isAuthRoute = path === "/me" || path === "/status" || path === "/logout";
    const isFileRoute = path === "/files/upload" || path.startsWith("/media/upload");
    const isOperationalRoute = path === "/ui-snapshots" || path === "/keep-alive";
    if (!is2FARoute && !isAuthRoute && !isFileRoute && !isOperationalRoute) {
      return res.status(403).json({ error: "2FA_REQUIRED", requires2FA: true });
    }
  }

  if (result.session) {
    setSessionCookie(res, token);
  }

  next();
}

export async function requireOwner(req: Request, res: Response, next: NextFunction) {
  const token = getSessionToken(req);

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const result = await authService.validateSession(token);

  if (!result.success) {
    clearSessionCookie(res);
    return res.status(401).json({ error: result.error });
  }

  if (!result.user?.isOwner) {
    return res.status(403).json({ error: "Owner access required" });
  }

  req.user = result.user;
  req.session = result.session;

  // Refresh cookie expiry to match renewed session (rolling session)
  if (result.session) {
    setSessionCookie(res, token);
  }

  next();
}

export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const token = getSessionToken(req);

  if (token) {
    const result = await authService.validateSession(token);
    if (result.success) {
      req.user = result.user;
      req.session = result.session;
      // Refresh cookie expiry to match renewed session (rolling session)
      if (result.session) {
        setSessionCookie(res, token);
      }
    }
  }

  next();
}

export async function checkOwnerExists(): Promise<boolean> {
  const owner = await authService.getOwner();
  return owner !== null;
}
