import { chromium, Browser, Page } from "playwright";
import OpenAI from "openai";
import { db } from "../../db";
import { screenshotCache } from "../../../shared/schema";
import { eq, lt, and, desc } from "drizzle-orm";

// Use AI Integrations for Replit Core compatibility
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

let browser: Browser | null = null;
let lastBrowserUse = 0;
const BROWSER_IDLE_TIMEOUT = 60000;

export interface ScreenshotResult {
  success: boolean;
  imageBase64?: string;
  analysis?: string;
  error?: string;
  url: string;
  screenshotId?: number;
  fromCache?: boolean;
}

interface AnalysisOptions {
  prompt?: string;
  focusOn?: string;
  saveToDb?: boolean;
  userId?: number;
  maxTokens?: number;
}

async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) {
    lastBrowserUse = Date.now();
    return browser;
  }

  console.log("[ScreenshotCrawler] Launching new browser...");
  browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--window-size=1920,1080",
    ],
  });

  lastBrowserUse = Date.now();

  setTimeout(() => checkIdleBrowser(), BROWSER_IDLE_TIMEOUT);

  return browser;
}

function checkIdleBrowser() {
  if (browser && Date.now() - lastBrowserUse > BROWSER_IDLE_TIMEOUT) {
    console.log("[ScreenshotCrawler] Closing idle browser...");
    browser.close().catch(() => {});
    browser = null;
  } else if (browser) {
    setTimeout(() => checkIdleBrowser(), BROWSER_IDLE_TIMEOUT);
  }
}

export async function captureScreenshot(
  url: string,
  options: {
    fullPage?: boolean;
    waitForSelector?: string;
    waitMs?: number;
    viewport?: { width: number; height: number };
  } = {}
): Promise<{ success: boolean; imageBase64?: string; error?: string }> {
  const {
    fullPage = false,
    waitForSelector,
    waitMs = 3000,
    viewport = { width: 1920, height: 1080 },
  } = options;

  let page: Page | null = null;

  try {
    const browserInstance = await getBrowser();
    page = await browserInstance.newPage();

    await page.setViewportSize(viewport);

    await page.route("**/*", (route) => {
      const resourceType = route.request().resourceType();
      if (["font", "media"].includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    console.log(`[ScreenshotCrawler] Navigating to ${url}...`);
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    
    // Wait for JavaScript to render dynamic content
    await page.waitForTimeout(3000);

    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: 10000 }).catch(() => {});
    }

    if (waitMs > 0) {
      await page.waitForTimeout(waitMs);
    }

    console.log("[ScreenshotCrawler] Taking screenshot...");
    const screenshot = await page.screenshot({
      fullPage,
      type: "png",
    });

    const imageBase64 = screenshot.toString("base64");

    console.log(`[ScreenshotCrawler] Screenshot captured: ${Math.round(screenshot.length / 1024)}KB`);

    return {
      success: true,
      imageBase64,
    };
  } catch (error: any) {
    console.error("[ScreenshotCrawler] Error:", error.message);
    return {
      success: false,
      error: error.message,
    };
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
}

export async function analyzeWithVision(
  imageBase64: string,
  options: AnalysisOptions = {}
): Promise<{ success: boolean; analysis?: string; error?: string }> {
  const {
    prompt = `Tu es l'œil visuel d'Ulysse. Regarde cette image comme un humain — VOIS et INTERPRÈTE visuellement.

RÈGLE : Décris ce que tu VOIS réellement. Ne devine pas, n'invente pas.

1. PREMIÈRE IMPRESSION — Qu'est-ce que tu vois d'un coup d'œil ? Décris la scène visuellement.
2. ESTHÉTIQUE — Couleurs dominantes exactes, harmonie, contrastes, qualité visuelle (amateur/correct/soigné/premium)
3. COMPOSITION — Layout, hiérarchie visuelle (ce qui attire l'œil en premier), densité d'information, espacement
4. ERGONOMIE (si interface) — Clarté des actions, navigation intuitive ou non, infos mises en avant
5. CONTENU — Textes lisibles, données, chiffres, statuts affichés
6. VERDICT — Note /10, points forts, points faibles, améliorations concrètes

Réponds en français naturel, comme si tu parlais à Maurice.`,
    focusOn,
    maxTokens = 2500,
  } = options;

  try {
    let fullPrompt = prompt;
    if (focusOn) {
      fullPrompt += `\n\nConcentre-toi particulièrement sur: ${focusOn}`;
    }

    console.log("[ScreenshotCrawler] Analyzing with GPT-4 Vision...");

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: maxTokens,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: fullPrompt,
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${imageBase64}`,
                detail: "high",
              },
            },
          ],
        },
      ],
    });

    const analysis = response.choices[0]?.message?.content || "";
    console.log(`[ScreenshotCrawler] Vision analysis complete: ${analysis.length} chars`);

    return {
      success: true,
      analysis,
    };
  } catch (error: any) {
    console.error("[ScreenshotCrawler] Vision error:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

export async function crawlWithScreenshot(
  url: string,
  options: AnalysisOptions & {
    fullPage?: boolean;
    waitForSelector?: string;
    waitMs?: number;
    useCache?: boolean;
    cacheHours?: number;
  } = {}
): Promise<ScreenshotResult> {
  const {
    saveToDb = true,
    userId,
    useCache = true,
    cacheHours = 6,
    fullPage = false,
    waitForSelector,
    waitMs = 3000,
    ...analysisOptions
  } = options;

  if (useCache && userId) {
    const cached = await db
      .select()
      .from(screenshotCache)
      .where(
        and(
          eq(screenshotCache.url, url),
          eq(screenshotCache.userId, userId)
        )
      )
      .orderBy(desc(screenshotCache.createdAt))
      .limit(1);

    if (cached.length > 0) {
      const cacheAge = Date.now() - new Date(cached[0].createdAt).getTime();
      if (cacheAge < cacheHours * 60 * 60 * 1000) {
        console.log(`[ScreenshotCrawler] Using cached analysis (${Math.round(cacheAge / 60000)}min old)`);
        return {
          success: true,
          url,
          analysis: cached[0].analysis,
          screenshotId: cached[0].id,
          fromCache: true,
        };
      }
    }
  }

  const screenshotResult = await captureScreenshot(url, {
    fullPage,
    waitForSelector,
    waitMs,
  });

  if (!screenshotResult.success || !screenshotResult.imageBase64) {
    return {
      success: false,
      url,
      error: screenshotResult.error || "Screenshot failed",
    };
  }

  const visionResult = await analyzeWithVision(screenshotResult.imageBase64, analysisOptions);

  if (!visionResult.success) {
    return {
      success: false,
      url,
      error: visionResult.error || "Vision analysis failed",
      imageBase64: screenshotResult.imageBase64,
    };
  }

  let screenshotId: number | undefined;

  if (saveToDb && userId) {
    try {
      const [inserted] = await db
        .insert(screenshotCache)
        .values({
          url,
          userId,
          imageBase64: screenshotResult.imageBase64,
          analysis: visionResult.analysis || "",
          metadata: {
            fullPage,
            prompt: analysisOptions.prompt,
            focusOn: analysisOptions.focusOn,
          },
        })
        .returning();

      screenshotId = inserted.id;
      console.log(`[ScreenshotCrawler] Saved to DB with id=${screenshotId}`);
    } catch (err: any) {
      console.error("[ScreenshotCrawler] DB save error:", err.message);
    }
  }

  return {
    success: true,
    url,
    imageBase64: screenshotResult.imageBase64,
    analysis: visionResult.analysis,
    screenshotId,
    fromCache: false,
  };
}

export async function cleanupOldScreenshots(daysToKeep: number = 30): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

  try {
    const deleted = await db
      .delete(screenshotCache)
      .where(lt(screenshotCache.createdAt, cutoffDate))
      .returning();

    console.log(`[ScreenshotCrawler] Cleaned up ${deleted.length} old screenshots (>${daysToKeep} days)`);
    return deleted.length;
  } catch (err: any) {
    console.error("[ScreenshotCrawler] Cleanup error:", err.message);
    return 0;
  }
}

export async function getScreenshotStats(userId?: number): Promise<{
  totalCount: number;
  totalSizeKB: number;
  oldestDate?: Date;
  newestDate?: Date;
}> {
  try {
    let query = db.select().from(screenshotCache);
    if (userId) {
      query = query.where(eq(screenshotCache.userId, userId)) as typeof query;
    }
    
    const screenshots = await query;
    
    if (screenshots.length === 0) {
      return { totalCount: 0, totalSizeKB: 0 };
    }

    const totalSizeKB = screenshots.reduce((sum, s) => {
      return sum + Math.round((s.imageBase64?.length || 0) * 0.75 / 1024);
    }, 0);

    const dates = screenshots.map(s => new Date(s.createdAt)).sort((a, b) => a.getTime() - b.getTime());

    return {
      totalCount: screenshots.length,
      totalSizeKB,
      oldestDate: dates[0],
      newestDate: dates[dates.length - 1],
    };
  } catch (err: any) {
    console.error("[ScreenshotCrawler] Stats error:", err.message);
    return { totalCount: 0, totalSizeKB: 0 };
  }
}

export function getScreenshotCrawlerStatus(): {
  browserActive: boolean;
  lastUse: number;
  idleTimeoutMs: number;
} {
  return {
    browserActive: browser !== null && browser.isConnected(),
    lastUse: lastBrowserUse,
    idleTimeoutMs: BROWSER_IDLE_TIMEOUT,
  };
}
