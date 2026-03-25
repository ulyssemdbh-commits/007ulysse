import { Router } from "express";
import { z } from "zod";
import { crawl, isContentReliable, type CrawlRequest, type CrawlResponse } from "../services/scraper/crawl";

const router = Router();

const crawlRequestSchema = z.object({
  url: z.string().url("URL invalide"),
  mode: z.enum(["auto", "http", "browser", "vision", "perplexity"]).default("auto"),
  waitForSelector: z.string().nullable().optional(),
  timeoutMs: z.number().min(1000).max(60000).default(15000),
  maxBytes: z.number().min(1024).max(10 * 1024 * 1024).default(2 * 1024 * 1024),
  visionPrompt: z.string().optional()
});

router.post("/", async (req, res) => {
  try {
    const parsed = crawlRequestSchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: {
          type: "validation",
          message: parsed.error.errors.map(e => e.message).join(", ")
        }
      });
    }
    
    const request: CrawlRequest = {
      url: parsed.data.url,
      mode: parsed.data.mode,
      waitForSelector: parsed.data.waitForSelector,
      timeoutMs: parsed.data.timeoutMs,
      maxBytes: parsed.data.maxBytes,
      visionPrompt: parsed.data.visionPrompt
    };
    
    const result = await crawl(request);
    
    res.json(result);
  } catch (error) {
    console.error("[CrawlAPI] Error:", error);
    res.status(500).json({
      success: false,
      crawlStatus: "failed",
      error: {
        type: "unknown",
        message: error instanceof Error ? error.message : "Internal server error"
      }
    });
  }
});

router.get("/check", async (req, res) => {
  const url = req.query.url as string;
  
  if (!url) {
    return res.status(400).json({ error: "Missing url parameter" });
  }
  
  try {
    const result = await crawl({ url, mode: "auto", timeoutMs: 10000 });
    res.json({
      url,
      reachable: result.success,
      modeUsed: result.modeUsed,
      suspectedSPA: result.suspectedSPA,
      contentReliable: isContentReliable(result),
      textLength: result.content.textLength,
      crawlStatus: result.crawlStatus,
      timings: result.timings
    });
  } catch (error) {
    res.status(500).json({ error: "Check failed" });
  }
});

export default router;
