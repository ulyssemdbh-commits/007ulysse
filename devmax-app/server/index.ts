/**
 * DevMax Standalone — Server Entry Point
 */
import express from "express";
import compression from "compression";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { createServer } from "http";
import { serveStatic } from "./static";
import path from "path";
import fs from "fs";

console.log(`[DevMax] Starting — PID=${process.pid}, NODE_ENV=${process.env.NODE_ENV || "development"}`);

if (!process.env.DATABASE_URL) {
  console.error("[DevMax] WARNING: DATABASE_URL is not set");
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

// ── API Routes ──
async function registerRoutes() {
  const devmaxWebhookRoutes = (await import("./routes/devmaxWebhook")).default;
  app.use("/api/devmax/webhook", devmaxWebhookRoutes);

  const devmaxAuthRoutes = (await import("./routes/devmaxAuth")).default;
  app.use("/api/devmax", devmaxAuthRoutes);

  const devopsMaxRoutes = (await import("./routes/devopsMaxRoutes")).default;
  app.use("/api/devmax/ops", devopsMaxRoutes);

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: "devmax", uptime: process.uptime() });
  });
}

// ── Start ──
const PORT = parseInt(process.env.PORT || "3000", 10);

registerRoutes()
  .then(() => {
    // In production, serve the built client
    if (process.env.NODE_ENV === "production") {
      serveStatic(app);
    }

    const server = createServer(app);
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`[DevMax] Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("[DevMax] Failed to start:", err);
    process.exit(1);
  });
