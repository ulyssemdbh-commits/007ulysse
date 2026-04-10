import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(import.meta.dirname, "..", "dist", "public");
  const indexHtml = path.resolve(distPath, "index.html");

  if (!fs.existsSync(distPath)) {
    throw new Error(`Build directory not found: ${distPath}. Run 'npm run build' first.`);
  }

  app.use("/assets", express.static(path.join(distPath, "assets"), {
    maxAge: "1y",
    immutable: true,
    etag: true,
  }));

  app.use(express.static(distPath, {
    maxAge: "1h",
    etag: true,
    index: false,
  }));

  app.use("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.sendFile(indexHtml);
  });
}
