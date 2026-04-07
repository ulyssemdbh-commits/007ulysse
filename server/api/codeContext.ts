/**
 * Code Context API - Endpoints for code-aware AI
 */

import { Router, Request, Response } from "express";
import { codeContextService } from "../services/codeContextService";

const router = Router();

// Require authentication for code access
const requireAuth = (req: Request, res: Response, next: Function) => {
  const userId = (req as any).userId || (req as any).user?.id;
  const secretKey = req.headers["x-system-status-key"] || req.query.key;
  const SYSTEM_STATUS_SECRET = process.env.SYSTEM_STATUS_SECRET;
  
  if (userId || (SYSTEM_STATUS_SECRET && secretKey === SYSTEM_STATUS_SECRET)) {
    return next();
  }
  
  res.status(401).json({ error: "Unauthorized" });
};

router.use(requireAuth);

/**
 * GET /api/code/status - Get indexing status
 */
router.get("/status", (req: Request, res: Response) => {
  const status = codeContextService.getStatus();
  res.json(status);
});

/**
 * POST /api/code/index - Re-index the project
 */
router.post("/index", async (req: Request, res: Response) => {
  try {
    const result = await codeContextService.indexProject();
    res.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to index project" });
  }
});

/**
 * GET /api/code/search - Search files by name
 * Query params: q, type, extension, limit
 */
router.get("/search", (req: Request, res: Response) => {
  const query = String(req.query.q || "");
  const type = req.query.type as any;
  const extension = req.query.extension as string;
  const limit = parseInt(String(req.query.limit || "20"));

  if (!query) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }

  const results = codeContextService.searchFiles(query, { type, extension, limit });
  
  res.json({
    query,
    results: results.map(f => ({
      path: f.relativePath,
      type: f.type,
      size: f.size,
      extension: f.extension
    })),
    count: results.length
  });
});

/**
 * GET /api/code/grep - Search content within files
 * Query params: pattern, path, type, limit, context
 */
router.get("/grep", async (req: Request, res: Response) => {
  const pattern = String(req.query.pattern || "");
  const pathFilter = req.query.path as string;
  const type = req.query.type as any;
  const limit = parseInt(String(req.query.limit || "50"));
  const contextLines = parseInt(String(req.query.context || "2"));

  if (!pattern) {
    return res.status(400).json({ error: "Query parameter 'pattern' is required" });
  }

  try {
    const results = await codeContextService.searchContent(pattern, {
      path: pathFilter,
      type,
      limit,
      contextLines
    });

    res.json({
      pattern,
      results,
      count: results.length
    });
  } catch (error) {
    res.status(500).json({ error: "Search failed" });
  }
});

/**
 * GET /api/code/file - Get file content
 * Query params: path
 */
router.get("/file", async (req: Request, res: Response) => {
  const filePath = String(req.query.path || "");

  if (!filePath) {
    return res.status(400).json({ error: "Query parameter 'path' is required" });
  }

  const content = await codeContextService.getFile(filePath);

  if (!content) {
    return res.status(404).json({ error: "File not found" });
  }

  res.json(content);
});

/**
 * GET /api/code/related - Find related files
 * Query params: path, limit
 */
router.get("/related", (req: Request, res: Response) => {
  const filePath = String(req.query.path || "");
  const limit = parseInt(String(req.query.limit || "5"));

  if (!filePath) {
    return res.status(400).json({ error: "Query parameter 'path' is required" });
  }

  const related = codeContextService.findRelatedFiles(filePath, limit);

  res.json({
    file: filePath,
    related: related.map(f => ({
      path: f.relativePath,
      type: f.type,
      size: f.size
    }))
  });
});

/**
 * GET /api/code/symbols - Search for symbols
 * Query params: q, type, limit
 */
router.get("/symbols", (req: Request, res: Response) => {
  const query = String(req.query.q || "");
  const type = req.query.type as any;
  const limit = parseInt(String(req.query.limit || "20"));

  if (!query) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }

  const symbols = codeContextService.searchSymbols(query, { type, limit });

  res.json({
    query,
    symbols,
    count: symbols.length
  });
});

/**
 * GET /api/code/structure - Get project structure overview
 */
router.get("/structure", (req: Request, res: Response) => {
  const structure = codeContextService.getProjectStructure();
  
  res.json({
    ...structure,
    summary: {
      frontend: structure.frontend.length,
      backend: structure.backend.length,
      shared: structure.shared.length,
      config: structure.config.length
    }
  });
});

/**
 * POST /api/code/context - Generate code context for AI
 * Body: { query, maxTokens? }
 */
router.post("/context", async (req: Request, res: Response) => {
  const { query, maxTokens = 4000 } = req.body;

  if (!query) {
    return res.status(400).json({ error: "Query is required in body" });
  }

  try {
    const context = await codeContextService.generateCodeContext(query, maxTokens);
    
    res.json({
      query,
      context,
      estimatedTokens: Math.ceil(context.length / 4)
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to generate context" });
  }
});

export default router;
