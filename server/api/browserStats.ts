import { Router, Request, Response } from "express";
import { browserService } from "../services/browserService";
import { getDynamicPageStats, clearDynamicPageCache } from "../services/dynamicPageService";
import { rateLimiterService } from "../services/rateLimiterService";
import { getMARSStats, smartFetchContent } from "../services/searchOrchestrator";
import { storage } from "../storage";

const router = Router();

async function requireOwnerOrAdmin(req: Request, res: Response): Promise<boolean> {
  const userId = (req as any).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return false;
  }
  
  const user = await storage.getUser(userId);
  if (!user || (!user.isOwner && user.role !== "admin")) {
    res.status(403).json({ error: "Admin access required" });
    return false;
  }
  
  return true;
}

function auditLog(action: string, userId: number, details?: Record<string, unknown>): void {
  console.log(`[BrowserService:Audit] ${action} by userId=${userId}`, details || "");
}

router.get("/status", async (_req: Request, res: Response) => {
  try {
    const browserStats = browserService.getStats();
    const dynamicPageStats = getDynamicPageStats();
    const marsStats = getMARSStats();
    
    res.json({
      browser: {
        initialized: browserStats.isInitialized,
        profiles: browserStats.profiles,
        domainMappings: browserStats.domainMappings,
        savedSessions: browserStats.savedSessions.length
      },
      dynamicPage: {
        cacheSize: dynamicPageStats.cacheSize,
        configuredDomains: dynamicPageStats.domainConfigs.length,
        dynamicDomains: dynamicPageStats.dynamicDomains.length
      },
      rateLimiter: {
        blockedDomains: marsStats.rateLimiter.blockedDomains,
        totalRequests: marsStats.rateLimiter.totalRequests,
        successRate: marsStats.rateLimiter.successRate.toFixed(1) + "%"
      }
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const browserStats = browserService.getStats();
    const dynamicPageStats = getDynamicPageStats();
    const marsStats = getMARSStats();
    
    res.json({
      browser: browserStats,
      dynamicPage: dynamicPageStats,
      rateLimiter: marsStats.rateLimiter
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/clear-cache", async (req: Request, res: Response) => {
  try {
    if (!await requireOwnerOrAdmin(req, res)) return;
    
    const userId = (req as any).userId;
    auditLog("CLEAR_CACHE", userId);
    
    clearDynamicPageCache();
    res.json({ success: true, message: "Dynamic page cache cleared" });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/unblock-domain", async (req: Request, res: Response) => {
  try {
    if (!await requireOwnerOrAdmin(req, res)) return;
    
    const { domain } = req.body;
    if (!domain) {
      return res.status(400).json({ error: "Domain required" });
    }
    
    const userId = (req as any).userId;
    auditLog("UNBLOCK_DOMAIN", userId, { domain });
    
    const unblocked = rateLimiterService.unblockDomain(domain);
    if (unblocked) {
      res.json({ success: true, message: `Domain ${domain} unblocked` });
    } else {
      res.json({ success: false, message: `Domain ${domain} was not blocked` });
    }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/test-fetch", async (req: Request, res: Response) => {
  try {
    if (!await requireOwnerOrAdmin(req, res)) return;
    
    const { url, forceRefresh, timeout } = req.body;
    if (!url) {
      return res.status(400).json({ error: "URL required" });
    }
    
    const userId = (req as any).userId;
    auditLog("TEST_FETCH", userId, { url });
    
    const result = await smartFetchContent(url, { 
      forceRefresh: forceRefresh || false, 
      timeout: timeout || 30000,
      userId: userId?.toString()
    });
    
    res.json({
      success: result.success,
      method: result.method,
      loadTimeMs: result.loadTimeMs,
      contentLength: result.contentLength,
      cached: result.cached,
      error: result.error,
      contentPreview: result.content.substring(0, 500) + (result.content.length > 500 ? "..." : "")
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get("/profiles", async (_req: Request, res: Response) => {
  try {
    const stats = browserService.getStats();
    res.json({
      profiles: stats.profiles,
      domainMappings: stats.domainMappings,
      savedSessions: stats.savedSessions
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/initialize", async (req: Request, res: Response) => {
  try {
    if (!await requireOwnerOrAdmin(req, res)) return;
    
    const userId = (req as any).userId;
    auditLog("BROWSER_INITIALIZE", userId);
    
    await browserService.initialize();
    res.json({ success: true, message: "Browser initialized" });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/shutdown", async (req: Request, res: Response) => {
  try {
    if (!await requireOwnerOrAdmin(req, res)) return;
    
    const userId = (req as any).userId;
    auditLog("BROWSER_SHUTDOWN", userId);
    
    await browserService.shutdown();
    res.json({ success: true, message: "Browser shutdown" });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
