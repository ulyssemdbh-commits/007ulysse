import rateLimit from "express-rate-limit";
let _helmet: typeof import("helmet").default | null = null;
async function getHelmet() {
  if (!_helmet) { try { _helmet = (await import("helmet")).default; } catch { console.warn("[Security] helmet not available"); } }
  return _helmet;
}
import { Request, Response, NextFunction, Express } from "express";
import { db } from "../db";
import { auditLogs } from "@shared/schema";

const SENSITIVE_ENDPOINTS = [
  "/api/auth/login",
  "/api/auth/setup",
  "/api/v2/conversations",
  "/api/agentmail/send",
  "/api/smarthome",
  "/api/geolocation",
];

const createLimiter = (maxRequests: number, windowMinutes: number, message: string) => {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max: maxRequests,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
  });
};

export const generalLimiter = createLimiter(
  100,
  1,
  "Trop de requêtes. Réessayez dans une minute."
);

export const authLimiter = createLimiter(
  5,
  15,
  "Trop de tentatives de connexion. Réessayez dans 15 minutes."
);

export const conversationLimiter = createLimiter(
  30,
  1,
  "Trop de messages. Réessayez dans une minute."
);

export const emailLimiter = createLimiter(
  10,
  1,
  "Trop d'emails envoyés. Réessayez dans une minute."
);

export const sensitiveEndpointLimiter = createLimiter(
  20,
  1,
  "Trop de requêtes sur cet endpoint. Réessayez dans une minute."
);

// AI/upload routes — expensive operations (10 req / 5 min)
export const aiUploadLimiter = createLimiter(
  10,
  5,
  "Trop de traitements IA en cours. Attendez quelques minutes avant de réessayer."
);

// SUGU financial routes — moderate limit (60 req / min)
export const suguFinancialLimiter = createLimiter(
  60,
  1,
  "Trop de requêtes sur les données financières. Réessayez dans une minute."
);

async function logAuditEvent(
  userId: number | null,
  action: string,
  resource: string,
  details: Record<string, unknown> = {},
  ip?: string
) {
  try {
    await db.insert(auditLogs).values({
      userId,
      action,
      resource,
      details,
      ipAddress: ip || null,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error("[AUDIT] Failed to log event:", error);
  }
}

export function auditMiddleware(req: Request, res: Response, next: NextFunction) {
  const originalSend = res.send;
  const startTime = Date.now();
  
  res.send = function (body) {
    const userId = (req as Request & { session?: { userId?: number } }).session?.userId || null;
    const isSensitive = SENSITIVE_ENDPOINTS.some(ep => req.path.startsWith(ep));
    
    if (isSensitive || req.method !== "GET") {
      const duration = Date.now() - startTime;
      logAuditEvent(
        userId,
        `${req.method}`,
        req.path,
        {
          statusCode: res.statusCode,
          duration,
          userAgent: req.get("user-agent")?.substring(0, 100),
        },
        req.ip
      );
    }
    
    return originalSend.call(this, body);
  };
  
  next();
}

export function setupSecurityMiddleware(app: Express) {
  let helmetMiddleware: ReturnType<typeof import("helmet").default> | null = null;
  const helmetReady = getHelmet().then((h) => {
    if (h) {
      helmetMiddleware = h({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
              "'self'",
              "'unsafe-inline'",
              "'unsafe-eval'",
              "blob:",
            ],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
            imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
            connectSrc: [
              "'self'",
              "wss:",
              "ws:",
              "https:",
              "http://localhost:*",
            ],
            mediaSrc: ["'self'", "blob:", "data:"],
            workerSrc: ["'self'", "blob:"],
            objectSrc: ["'none'"],
            frameSrc: ["'self'"],
            frameAncestors: [
              "'self'",
              "https://ulyssepro.org",
              "https://*.ulyssepro.org",
              "https://ulysseproject.org",
              "https://*.ulysseproject.org",
              ...(process.env.ALLOWED_FRAME_ORIGINS?.split(",") || []),
            ],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null,
          },
        },
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: "cross-origin" },
        xFrameOptions: false,
      });
      console.log("[Security] helmet loaded successfully");
    } else {
      console.warn("[Security] helmet not available, skipping CSP headers");
    }
  }).catch(() => {
    console.warn("[Security] helmet failed to load, skipping CSP headers");
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (helmetMiddleware) return helmetMiddleware(req, res, next);
    helmetReady.then(() => {
      if (helmetMiddleware) return helmetMiddleware(req, res, next);
      next();
    });
  });
  
  app.use("/api/auth/login", authLimiter);
  app.use("/api/auth/setup", authLimiter);
  app.use("/api/v2/conversations", conversationLimiter);
  app.use("/api/conversations", conversationLimiter);
  app.use("/api/agentmail/send", emailLimiter);
  app.use("/api/gmail/send", emailLimiter);
  app.use("/api/gmail/reply", emailLimiter);
  
  app.use("/api/smarthome", sensitiveEndpointLimiter);
  app.use("/api/geolocation", sensitiveEndpointLimiter);
  app.use("/api/face-recognition", sensitiveEndpointLimiter);
  app.use("/api/surveillance", sensitiveEndpointLimiter);

  // AI/upload expensive routes — 10 req / 5 min
  const aiRoutes = [
    "/api/v2/sugu-management/bank/import-pdf",
    "/api/v2/sugu-management/bank/import-csv",
    "/api/v2/sugu-management/bank/import-preview",
    "/api/v2/sugu-management/payroll/import-pdf",
    "/api/v2/sugu-management/loans/parse-document",
    "/api/v2/sugum-management/bank/import-pdf",
    "/api/v2/sugum-management/bank/import-csv",
    "/api/v2/sugum-management/payroll/import-pdf",
  ];
  aiRoutes.forEach(route => app.use(route, aiUploadLimiter));

  // SUGU financial data routes — 60 req / min
  app.use("/api/v2/sugu-management", suguFinancialLimiter);
  app.use("/api/v2/sugum-management", suguFinancialLimiter);
  
  // Sports public endpoints — prevent scraping (30 req / min)
  app.use("/api/sports/cache/predictions", createLimiter(30, 1, "Trop de requêtes sur les prédictions sportives. Réessayez dans une minute."));
  app.use("/api/sports/dashboard", createLimiter(30, 1, "Trop de requêtes sur le dashboard sportif. Réessayez dans une minute."));

  app.use("/api", generalLimiter);
  
  app.use(blockExternalUsersMiddleware);
  
  app.use(auditMiddleware);
  
  console.log("[Security] Middleware initialized: helmet, rate limiting, external user blocking, audit logging");
}

export function configureSessionSecurity() {
  return {
    name: "devflow.sid",
    secret: process.env.SESSION_SECRET || "devflow-secure-session-key-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: "lax" as const,
    },
  };
}

// Default allowed origins for production domains
const DEFAULT_ALLOWED_ORIGINS = [
  "https://ulysseproject.org",
  "https://www.ulysseproject.org",
  "http://ulysseproject.org",
  "http://www.ulysseproject.org",
  "https://ulyssepro.org",
  "https://www.ulyssepro.org",
  "http://ulyssepro.org",
  "http://www.ulyssepro.org",
];

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  
  if (origin.includes("ulysseproject.org") || origin.includes("ulyssepro.org")) {
    return true;
  }
  
  const extraOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [];
  for (const allowed of extraOrigins) {
    if (allowed.trim() && origin.includes(allowed.trim())) return true;
  }
  
  // Default allowed origins
  if (DEFAULT_ALLOWED_ORIGINS.includes(origin)) {
    return true;
  }
  
  // Dev mode allows all
  if (process.env.NODE_ENV !== "production") {
    return true;
  }
  
  return false;
}

export function configureCORS() {
  return {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept", "X-Requested-With"],
  };
}

const ALFRED_ALLOWED_API_ENDPOINTS = [
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
  "/api/auth/status",
  "/api/auth/max-auto-login",
  "/api/v2/conversations",
  "/api/agentmail",
  "/api/gmail",
  "/api/v2/health",
  "/api/guest",
  "/api/devmax",
];

const ALFRED_ALLOWED_STATIC_PATHS = [
  "/max",
  "/devmax",
  "/devops-max",
  "/login",
  "/assets",
  "/@fs",
  "/@vite",
  "/node_modules",
  "/src",
  "/favicon",
  "/.well-known",
];

export function blockExternalUsersMiddleware(req: Request, res: Response, next: NextFunction) {
  const userRole = (req as Request & { session?: { role?: string } }).session?.role;
  
  if (userRole === "external") {
    // Check API endpoints - strict whitelist
    if (req.path.startsWith("/api")) {
      const isAllowed = ALFRED_ALLOWED_API_ENDPOINTS.some(ep => req.path.startsWith(ep));
      if (!isAllowed) {
        console.log(`[Security] External user blocked from API: ${req.path}`);
        logAuditEvent(
          (req as Request & { session?: { userId?: number } }).session?.userId || null,
          "BLOCKED_ACCESS",
          req.path,
          { reason: "external_user_api_restricted", method: req.method },
          req.ip
        );
        return res.status(403).json({ error: "Accès non autorisé pour les utilisateurs externes" });
      }
    }
    // Block ALL non-whitelisted routes (regardless of Accept header)
    else if (!ALFRED_ALLOWED_STATIC_PATHS.some(r => req.path.startsWith(r))) {
      console.log(`[Security] External user blocked from: ${req.path}`);
      logAuditEvent(
        (req as Request & { session?: { userId?: number } }).session?.userId || null,
        "BLOCKED_ACCESS",
        req.path,
        { reason: "external_user_route_restricted", method: req.method },
        req.ip
      );
      // Redirect for GET, 403 for other methods
      if (req.method === "GET") {
        return res.redirect("/max");
      }
      return res.status(403).json({ error: "Accès non autorisé pour les utilisateurs externes" });
    }
  }
  
  next();
}
