import express, { type Express } from "express";
import fs from "fs";
import path from "path";

let cachedIndexHtml: Buffer | null = null;
let cachedIndexHtmlMtime: number = 0;

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  const htmlPath = path.resolve(__dirname, "html");
  const indexHtml = path.resolve(htmlPath, "index.html");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  if (!fs.existsSync(indexHtml)) {
    throw new Error(
      `Could not find index.html at: ${indexHtml}, make sure to build the client first`,
    );
  }

  const refreshIndexHtml = () => {
    try {
      const stat = fs.statSync(indexHtml);
      if (stat.mtimeMs !== cachedIndexHtmlMtime) {
        cachedIndexHtml = fs.readFileSync(indexHtml);
        cachedIndexHtmlMtime = stat.mtimeMs;
      }
    } catch {}
  };
  refreshIndexHtml();

  app.get("/sw.js", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.sendFile(path.resolve(distPath, "sw.js"));
  });

  app.get("/sw-v3.js", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.sendFile(path.resolve(distPath, "sw-v3.js"));
  });

  app.use("/assets", express.static(path.join(distPath, "assets"), {
    maxAge: "1y",
    immutable: true,
    etag: true,
    lastModified: false,
  }));

  app.use(express.static(distPath, {
    maxAge: "1h",
    etag: true,
    index: false,
  }));

  app.use("*", (_req, res) => {
    refreshIndexHtml();
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (cachedIndexHtml) {
      res.end(cachedIndexHtml);
    } else {
      res.sendFile(indexHtml);
    }
  });
}
