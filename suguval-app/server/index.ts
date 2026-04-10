/**
 * SUGUVal Standalone — Server Entry Point
 */
import express from "express";
import compression from "compression";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import session from "express-session";
import { createServer } from "http";
import path from "path";
import fs from "fs";

console.log(`[SUGUVal] Starting — PID=${process.pid}, NODE_ENV=${process.env.NODE_ENV || "development"}`);

if (!process.env.DATABASE_URL) {
  console.error("[SUGUVal] WARNING: DATABASE_URL is not set");
}

process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err.message, err.stack);
});
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled rejection:", reason);
});

const app = express();
app.set("trust proxy", 1);

// Security
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// Compression
app.use(compression({ level: 6, threshold: 1024 }));

// Parsers
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || "suguval-standalone-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === "production", maxAge: 24 * 60 * 60 * 1000 },
}));

// ── API Routes ──
async function registerRoutes() {
  const { registerSuguvalRoutes } = await import("./routes/suguval");
  registerSuguvalRoutes(app);

  const { registerSugumaillaneRoutes } = await import("./routes/sugumaillane");
  registerSugumaillaneRoutes(app);

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: "suguval", uptime: process.uptime() });
  });
}

// ── Static Files (production) ──
function serveStatic() {
  const distPath = path.resolve(import.meta.dirname, "..", "dist", "public");
  const indexHtml = path.resolve(distPath, "index.html");

  if (!fs.existsSync(distPath)) {
    console.warn(`[SUGUVal] Build directory not found: ${distPath}`);
    return;
  }

  app.use("/assets", express.static(path.join(distPath, "assets"), {
    maxAge: "1y",
    immutable: true,
  }));

  app.use(express.static(distPath, { maxAge: "1h", index: false }));

  app.use("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.sendFile(indexHtml);
  });
}

// ── Start ──
const PORT = parseInt(process.env.PORT || "3000", 10);

registerRoutes()
  .then(() => {
    if (process.env.NODE_ENV === "production") {
      serveStatic();
    }

    const server = createServer(app);
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`[SUGUVal] Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("[SUGUVal] Failed to start:", err);
    process.exit(1);
  });
