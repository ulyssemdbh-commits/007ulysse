import { Router, Request, Response } from 'express';
import { crawlAndScrape, scrapeWithSelectors, scrapeWithProfile, getAvailableProfiles, SCRAPER_PROFILES } from '../services/scraper/core';
import type { ScrapeRequest } from '../types/scraper';
import { z } from 'zod';
import { getEnabledStrategies } from '../core/strategyTypes';

const router = Router();

// ================================
// Validation Schema V3
// ================================

const SelectorConfigSchema = z.union([
  z.string(),
  z.object({
    selector: z.string(),
    attr: z.string().optional(),
    multi: z.boolean().optional(),
  }),
]);

const ScrapeRequestSchema = z.object({
  url: z.string().url(),
  mode: z.enum(['auto', 'http', 'browser']).optional(),
  depth: z.number().min(0).max(10).optional(),
  maxPages: z.number().min(1).max(500).optional(),
  maxConcurrency: z.number().min(1).max(20).optional(),
  userAgent: z.string().optional(),
  respectRobotsTxt: z.boolean().optional(),
  linkScope: z.enum(['same-domain', 'same-host', 'same-path', 'all', 'none']).optional(),
  excludeExtensions: z.array(z.string()).optional(),
  timeoutMs: z.number().min(1000).max(120000).optional(),
  maxBodySizeBytes: z.number().min(1024).optional(),
  profile: z.string().optional(),
  extract: z.object({
    text: z.boolean().optional(),
    html: z.boolean().optional(),
    links: z.boolean().optional(),
    metadata: z.boolean().optional(),
    selectors: z.record(SelectorConfigSchema).optional(),
  }).optional(),
});

// ================================
// Routes
// ================================

router.post('/crawl', async (req: Request, res: Response) => {
  try {
    const parsed = ScrapeRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request',
        details: parsed.error.issues,
      });
    }

    const result = await crawlAndScrape(parsed.data as ScrapeRequest);
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[Scraper API] Error:', err);
    res.status(500).json({
      success: false,
      error: 'Scrape failed',
      details: err.message,
    });
  }
});

router.post('/extract', async (req: Request, res: Response) => {
  try {
    const { url, selectors } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'Missing url',
      });
    }

    if (!selectors || typeof selectors !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid selectors (must be object)',
      });
    }

    const result = await scrapeWithSelectors(url, selectors);
    res.json(result);
  } catch (err: any) {
    console.error('[Scraper API] Extract error:', err);
    res.status(500).json({
      success: false,
      error: 'Extract failed',
      details: err.message,
    });
  }
});

router.post('/profile/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'Missing url',
      });
    }

    if (!SCRAPER_PROFILES[name]) {
      return res.status(400).json({
        success: false,
        error: `Unknown profile: ${name}`,
        availableProfiles: Object.keys(SCRAPER_PROFILES),
      });
    }

    const result = await scrapeWithProfile(url, name);
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[Scraper API] Profile error:', err);
    res.status(500).json({
      success: false,
      error: 'Scrape failed',
      details: err.message,
    });
  }
});

router.get('/profiles', (_req: Request, res: Response) => {
  const profiles = getAvailableProfiles();
  res.json({
    success: true,
    profiles: profiles.map(p => ({
      name: p.name,
      description: p.description,
      defaults: p.defaults,
    })),
  });
});

router.get('/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    status: 'ok',
    service: 'UlysseScraperBot/4.0',
    version: '4.0.0',
    capabilities: {
      modes: ['auto', 'http', 'browser', 'smart'],
      features: ['crawl', 'extract', 'profiles', 'selectors', 'linkScope', 'strategy-learning', 'quality-scoring'],
      fallbacks: ['jina', 'perplexity', 'firecrawl', 'apify'],
      strategies: getEnabledStrategies().map(s => s.strategy),
      profiles: Object.keys(SCRAPER_PROFILES),
    },
    limits: {
      maxDepth: 10,
      maxPages: 500,
      maxConcurrency: 20,
      maxTimeout: 120000,
    },
  });
});

// SMART SCRAPING endpoints removed - canonical versions are in v2/index.ts at /api/v2/scrape/smart/*
// Use /api/v2/scrape/smart instead of /api/scraper/smart

export default router;
