import { crawlWithBrowser } from "./browser";
import { crawlWithScreenshot } from "./screenshot";
import { fetchViaApify, fetchViaFirecrawl, fetchViaJina, fetchViaPerplexity } from "../webfetch";
import * as cheerio from "cheerio";
import { globalOptimizerService } from "../globalOptimizerService";

const isProduction = process.env.NODE_ENV === "production";
console.log(`[CrawlService] Environment: isProduction=${isProduction}, NODE_ENV=${process.env.NODE_ENV}`);

export type CrawlMode = "auto" | "http" | "browser" | "vision" | "perplexity";
export type ModeUsed = "http" | "browser" | "vision" | "perplexity";
export type ErrorType = "timeout" | "network" | "captcha" | "login_required" | "blocked" | "unknown";
export type CrawlStatus = "success" | "partial" | "failed";

export interface CrawlRequest {
  url: string;
  mode?: CrawlMode;
  waitForSelector?: string | null;
  timeoutMs?: number;
  maxBytes?: number;
  visionPrompt?: string;
}

export interface CrawlResponse {
  success: boolean;
  crawlStatus: CrawlStatus;
  modeUsed: ModeUsed;
  url: string;
  finalUrl: string | null;
  statusCode: number | null;
  suspectedSPA: boolean;
  timings: {
    totalMs: number;
    httpMs: number;
    browserMs: number;
    visionMs: number;
    perplexityMs: number;
  };
  content: {
    title: string | null;
    html: string;
    text: string;
    language: string | null;
    htmlLength: number;
    textLength: number;
  };
  meta: {
    favicon?: string;
    description?: string;
    ogTitle?: string;
    ogDescription?: string;
    ogImage?: string;
    canonical?: string;
  };
  warnings: string[];
  error: null | {
    type: ErrorType;
    message: string;
  };
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1"
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getBrowserHeaders(): Record<string, string> {
  return {
    "User-Agent": getRandomUserAgent(),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Ch-Ua": '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Cache-Control": "max-age=0"
  };
}

// Sites that require browser rendering due to JavaScript data loading
const BROWSER_REQUIRED_DOMAINS = [
  "eurotopteam.com",
  "flashscore.com",
  "sofascore.com",
  "transfermarkt.com",
  "whoscored.com",
  "fbref.com",
  "soccerway.com",
  "football365.fr",
  // Betting sites (JS-rendered)
  "parionssport.fdj.fr",
  "enligne.parionssport.fdj.fr",
  "winamax.fr",
  "betclic.fr",
  "unibet.fr",
  "pmu.fr",
  "zebet.fr",
  "bwin.fr",
  "betway.fr",
  "pokerstars.fr"
];

function requiresBrowser(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return BROWSER_REQUIRED_DOMAINS.some(domain => hostname.includes(domain));
  } catch {
    return false;
  }
}

function detectSPA(html: string, url?: string): boolean {
  // Check if domain is in the list of known browser-required sites
  if (url && requiresBrowser(url)) {
    console.log(`[Crawl] Domain requires browser: ${url}`);
    return true;
  }
  
  const lower = html.toLowerCase();
  const scriptCount = (lower.match(/<script/gi) || []).length;
  
  const hasRootDiv =
    lower.includes('id="root"') ||
    lower.includes('id="app"') ||
    lower.includes('id="__next"') ||
    lower.includes('id="___gatsby"') ||
    lower.includes('id="__nuxt"');
  
  // Check for jQuery/AJAX data loading patterns
  const hasJQueryAjax = lower.includes('$.ajax') || lower.includes('$.get') || lower.includes('$.post') || 
                        lower.includes('.load(') || lower.includes('document.ready');
  
  // Check for table placeholders that will be filled by JS
  const hasEmptyTables = (lower.match(/<tbody[^>]*>\s*<\/tbody>/gi) || []).length > 0 ||
                         (lower.match(/<table[^>]*>\s*<\/table>/gi) || []).length > 0;
  
  const textOnly = lower.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const wordCount = textOnly.split(/\s+/).filter(w => w.length > 3).length;
  const hasFewWords = wordCount < 150;
  
  // Also check if content has numbers that look like rankings/stats
  const hasRankingNumbers = (textOnly.match(/\b\d+\s*(pts?|points?|but|goal|victoire|win|match|joué)/gi) || []).length > 0;
  const noRankingData = !hasRankingNumbers && lower.includes('classement');
  
  return (scriptCount > 15 && hasRootDiv) || 
         (hasFewWords && scriptCount > 10) || 
         hasEmptyTables ||
         (hasJQueryAjax && noRankingData);
}

function extractMeta(html: string): CrawlResponse["meta"] {
  try {
    const $ = cheerio.load(html);
    return {
      favicon: $('link[rel="icon"]').attr("href") || $('link[rel="shortcut icon"]').attr("href"),
      description: $('meta[name="description"]').attr("content"),
      ogTitle: $('meta[property="og:title"]').attr("content"),
      ogDescription: $('meta[property="og:description"]').attr("content"),
      ogImage: $('meta[property="og:image"]').attr("content"),
      canonical: $('link[rel="canonical"]').attr("href")
    };
  } catch {
    return {};
  }
}

function extractText(html: string): string {
  try {
    const $ = cheerio.load(html);
    $("script, style, nav, footer, header, aside, noscript, iframe").remove();
    
    const mainContent = $("main, article, .content, .post, .entry, #content, #main").first();
    if (mainContent.length > 0) {
      return mainContent.text().replace(/\s+/g, " ").trim();
    }
    
    return $("body").text().replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

function extractTitle(html: string): string | null {
  try {
    const $ = cheerio.load(html);
    return $("title").text().trim() || $("h1").first().text().trim() || null;
  } catch {
    return null;
  }
}

function extractLanguage(html: string): string | null {
  try {
    const $ = cheerio.load(html);
    return $("html").attr("lang") || $('meta[http-equiv="content-language"]').attr("content") || null;
  } catch {
    return null;
  }
}

async function crawlHttp(
  url: string, 
  timeoutMs: number = 15000, 
  maxBytes: number = 2 * 1024 * 1024
): Promise<{ success: boolean; html: string; statusCode: number | null; finalUrl: string | null; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    
    const response = await fetch(url, {
      headers: getBrowserHeaders(),
      redirect: "follow",
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      return { 
        success: false, 
        html: "", 
        statusCode: response.status, 
        finalUrl: response.url,
        error: `HTTP ${response.status}` 
      };
    }
    
    let html = await response.text();
    if (html.length > maxBytes) {
      html = html.substring(0, maxBytes);
    }
    
    return { 
      success: true, 
      html, 
      statusCode: response.status, 
      finalUrl: response.url 
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { 
      success: false, 
      html: "", 
      statusCode: null, 
      finalUrl: null, 
      error: message.includes("abort") ? "timeout" : message 
    };
  }
}

function createEmptyResponse(url: string): CrawlResponse {
  return {
    success: false,
    crawlStatus: "failed",
    modeUsed: "http",
    url,
    finalUrl: null,
    statusCode: null,
    suspectedSPA: false,
    timings: { totalMs: 0, httpMs: 0, browserMs: 0, visionMs: 0, perplexityMs: 0 },
    content: { title: null, html: "", text: "", language: null, htmlLength: 0, textLength: 0 },
    meta: {},
    warnings: [],
    error: null
  };
}

function determineCrawlStatus(textLength: number, success: boolean): CrawlStatus {
  if (!success) return "failed";
  if (textLength < 100) return "partial";
  return "success";
}

export async function crawl(request: CrawlRequest): Promise<CrawlResponse> {
  const { 
    url, 
    mode = "auto", 
    waitForSelector, 
    timeoutMs: requestTimeoutMs, 
    maxBytes = 2 * 1024 * 1024,
    visionPrompt 
  } = request;
  
  if (mode === "http" && !requiresBrowser(url)) {
    const cached = await globalOptimizerService.getOrFetch(
      url,
      "web_crawl",
      async () => {
        return crawlInternal(request);
      }
    );
    return cached;
  }
  
  return crawlInternal(request);
}

async function crawlInternal(request: CrawlRequest): Promise<CrawlResponse> {
  const { 
    url, 
    mode = "auto", 
    waitForSelector, 
    timeoutMs: requestTimeoutMs, 
    maxBytes = 2 * 1024 * 1024,
    visionPrompt 
  } = request;
  
  // For sports sites that need extended waits, use longer timeout by default
  const isSportsSite = requiresBrowser(url);
  const timeoutMs = requestTimeoutMs ?? (isSportsSite ? 90000 : 15000);
  
  const startTime = Date.now();
  const response = createEmptyResponse(url);
  response.url = url;
  
  console.log(`[Crawl] Starting crawl: url=${url}, mode=${mode}`);

  if (mode === "http") {
    const httpStart = Date.now();
    const result = await crawlHttp(url, timeoutMs, maxBytes);
    response.timings.httpMs = Date.now() - httpStart;
    response.timings.totalMs = Date.now() - startTime;
    response.modeUsed = "http";
    response.statusCode = result.statusCode;
    response.finalUrl = result.finalUrl;
    
    if (result.success) {
      response.success = true;
      response.content.html = result.html;
      response.content.text = extractText(result.html);
      response.content.title = extractTitle(result.html);
      response.content.language = extractLanguage(result.html);
      response.content.htmlLength = result.html.length;
      response.content.textLength = response.content.text.length;
      response.meta = extractMeta(result.html);
      response.suspectedSPA = detectSPA(result.html, url);
    } else {
      let errorType: ErrorType = "network";
      if (result.error?.includes("timeout")) errorType = "timeout";
      else if (result.statusCode === 403) errorType = "blocked";
      else if (result.statusCode === 401) errorType = "login_required";
      else if (result.statusCode && result.statusCode >= 400) errorType = "network";
      response.error = { type: errorType, message: result.error || "HTTP fetch failed" };
    }
    
    response.crawlStatus = determineCrawlStatus(response.content.textLength, response.success);
    return response;
  }

  if (mode === "browser") {
    const browserStart = Date.now();
    const result = await crawlWithBrowser(url, { waitForSelector: waitForSelector || undefined, timeoutMs, extractText: true });
    response.timings.browserMs = Date.now() - browserStart;
    response.timings.totalMs = Date.now() - startTime;
    response.modeUsed = "browser";
    
    if (result.success && result.html) {
      response.success = true;
      response.content.html = result.html;
      response.content.text = result.textContent || extractText(result.html);
      response.content.title = result.title || extractTitle(result.html);
      response.content.language = extractLanguage(result.html);
      response.content.htmlLength = result.html.length;
      response.content.textLength = response.content.text.length;
      response.meta = extractMeta(result.html);
      response.finalUrl = result.url;
    } else {
      response.error = { type: result.errorType || "unknown", message: result.error || "Browser crawl failed" };
    }
    
    response.crawlStatus = determineCrawlStatus(response.content.textLength, response.success);
    return response;
  }

  if (mode === "vision") {
    const visionStart = Date.now();
    const result = await crawlWithScreenshot(url, { prompt: visionPrompt, cacheDurationHours: 6 });
    response.timings.visionMs = Date.now() - visionStart;
    response.timings.totalMs = Date.now() - startTime;
    response.modeUsed = "vision";
    
    if (result.success && result.analysis) {
      response.success = true;
      response.content.text = result.analysis;
      response.content.textLength = result.analysis.length;
      response.content.title = url;
      response.finalUrl = url;
      response.warnings.push("vision_mode_no_html");
    } else {
      response.error = { type: "unknown", message: result.error || "Vision crawl failed" };
    }
    
    response.crawlStatus = determineCrawlStatus(response.content.textLength, response.success);
    return response;
  }

  if (mode === "perplexity") {
    const pplxStart = Date.now();
    const result = await fetchViaPerplexity(url);
    response.timings.perplexityMs = Date.now() - pplxStart;
    response.timings.totalMs = Date.now() - startTime;
    response.modeUsed = "perplexity";
    
    if (result) {
      response.success = true;
      response.content.text = result.content;
      response.content.title = result.title;
      response.content.textLength = result.content.length;
      response.finalUrl = url;
      response.warnings.push("perplexity_mode_no_html");
    } else {
      response.error = { type: "unknown", message: "Perplexity extraction failed" };
    }
    
    response.crawlStatus = determineCrawlStatus(response.content.textLength, response.success);
    return response;
  }

  const httpStart = Date.now();
  const httpResult = await crawlHttp(url, timeoutMs, maxBytes);
  response.timings.httpMs = Date.now() - httpStart;
  
  response.statusCode = httpResult.statusCode;
  response.finalUrl = httpResult.finalUrl;
  
  if (httpResult.success) {
    response.suspectedSPA = detectSPA(httpResult.html, url);
    
    if (!response.suspectedSPA) {
      response.modeUsed = "http";
      response.success = true;
      response.statusCode = httpResult.statusCode;
      response.finalUrl = httpResult.finalUrl;
      response.content.html = httpResult.html;
      response.content.text = extractText(httpResult.html);
      response.content.title = extractTitle(httpResult.html);
      response.content.language = extractLanguage(httpResult.html);
      response.content.htmlLength = httpResult.html.length;
      response.content.textLength = response.content.text.length;
      response.meta = extractMeta(httpResult.html);
      response.timings.totalMs = Date.now() - startTime;
      response.crawlStatus = determineCrawlStatus(response.content.textLength, response.success);
      console.log(`[Crawl] HTTP success: ${url}, textLength=${response.content.textLength}`);
      return response;
    }
    
    console.log(`[Crawl] SPA detected, falling back to browser: ${url}`);
    response.warnings.push("spa_detected");
  }

  const browserStart = Date.now();
  let browserResult: Awaited<ReturnType<typeof crawlWithBrowser>>;
  
  if (isProduction) {
    console.log(`[Crawl] Production mode: skipping browser, using Perplexity fallback for ${url}`);
    browserResult = { success: false, url, mode: 'browser', errorType: 'unknown', error: 'Browser unavailable in production' };
  } else {
    browserResult = await crawlWithBrowser(url, { waitForSelector: waitForSelector || undefined, timeoutMs, extractText: true });
  }
  response.timings.browserMs = Date.now() - browserStart;
  
  if (browserResult.success && browserResult.html) {
    response.modeUsed = "browser";
    response.success = true;
    response.suspectedSPA = true;
    response.content.html = browserResult.html;
    response.content.text = browserResult.textContent || extractText(browserResult.html);
    response.content.title = browserResult.title || extractTitle(browserResult.html);
    response.content.language = extractLanguage(browserResult.html);
    response.content.htmlLength = browserResult.html.length;
    response.content.textLength = response.content.text.length;
    response.meta = extractMeta(browserResult.html);
    response.finalUrl = browserResult.url;
    response.timings.totalMs = Date.now() - startTime;
    response.crawlStatus = determineCrawlStatus(response.content.textLength, response.success);
    console.log(`[Crawl] Browser success: ${url}, textLength=${response.content.textLength}`);
    
    const isSportsSite = requiresBrowser(url);
    const minContentForSports = 300;
    
    if (isSportsSite && response.content.textLength < minContentForSports) {
      console.log(`[Crawl] Sports site with insufficient content (${response.content.textLength} < ${minContentForSports}), trying vision fallback...`);
      response.warnings.push("browser_content_insufficient");
      
      const visionStart = Date.now();
      const visionResult = await crawlWithScreenshot(url, { 
        prompt: visionPrompt || "Extrais le classement complet avec positions, équipes, points, et statistiques de cette page web.",
        cacheDurationHours: 1
      });
      response.timings.visionMs = Date.now() - visionStart;
      
      if (visionResult.success && visionResult.analysis && visionResult.analysis.length > response.content.textLength) {
        console.log(`[Crawl] Vision fallback success: ${visionResult.analysis.length} chars (better than browser)`);
        response.modeUsed = "vision";
        response.content.text = visionResult.analysis;
        response.content.textLength = visionResult.analysis.length;
        response.crawlStatus = "success";
        response.timings.totalMs = Date.now() - startTime;
      }
    }
    
    return response;
  }

  if (browserResult.errorType === "captcha" || browserResult.errorType === "blocked" || browserResult.errorType === "login_required") {
    console.log(`[Crawl] Browser blocked (${browserResult.errorType}), trying vision: ${url}`);
    response.warnings.push(`browser_${browserResult.errorType}`);
    
    const visionStart = Date.now();
    const visionResult = await crawlWithScreenshot(url, { prompt: visionPrompt, cacheDurationHours: 6 });
    response.timings.visionMs = Date.now() - visionStart;
    
    if (visionResult.success && visionResult.analysis) {
      response.modeUsed = "vision";
      response.success = true;
      response.content.text = visionResult.analysis;
      response.content.textLength = visionResult.analysis.length;
      response.content.title = url;
      response.finalUrl = url;
      response.timings.totalMs = Date.now() - startTime;
      response.crawlStatus = determineCrawlStatus(response.content.textLength, response.success);
      console.log(`[Crawl] Vision success: ${url}, textLength=${response.content.textLength}`);
      return response;
    }
  }

  console.log(`[Crawl] Browser/Vision failed, trying API fallbacks: ${url}`);
  response.warnings.push("browser_fallback_failed");
  
  // Fallback chain: Apify → Firecrawl → Jina (free) → Perplexity
  
  // 1. Try Apify first (cloud scraping platform)
  const apifyStart = Date.now();
  const apifyResult = await fetchViaApify(url);
  response.timings.perplexityMs = Date.now() - apifyStart;
  
  if (apifyResult) {
    response.modeUsed = "perplexity";
    response.success = true;
    response.content.text = apifyResult.content;
    response.content.title = apifyResult.title;
    response.content.textLength = apifyResult.content.length;
    response.finalUrl = url;
    response.timings.totalMs = Date.now() - startTime;
    response.crawlStatus = determineCrawlStatus(response.content.textLength, response.success);
    console.log(`[Crawl] Apify success: ${url}, textLength=${response.content.textLength}`);
    return response;
  }
  
  // 2. Try Firecrawl (JavaScript rendering API)
  console.log(`[Crawl] Apify unavailable, trying Firecrawl: ${url}`);
  const firecrawlStart = Date.now();
  const firecrawlResult = await fetchViaFirecrawl(url);
  response.timings.perplexityMs += Date.now() - firecrawlStart;
  
  if (firecrawlResult) {
    response.modeUsed = "perplexity";
    response.success = true;
    response.content.text = firecrawlResult.content;
    response.content.title = firecrawlResult.title;
    response.content.textLength = firecrawlResult.content.length;
    response.finalUrl = url;
    response.timings.totalMs = Date.now() - startTime;
    response.crawlStatus = determineCrawlStatus(response.content.textLength, response.success);
    console.log(`[Crawl] Firecrawl success: ${url}, textLength=${response.content.textLength}`);
    return response;
  }
  
  // 3. Try Jina Reader (FREE, no API key needed)
  console.log(`[Crawl] Firecrawl unavailable, trying Jina Reader (free): ${url}`);
  const jinaStart = Date.now();
  const jinaResult = await fetchViaJina(url);
  response.timings.perplexityMs += Date.now() - jinaStart;
  
  if (jinaResult) {
    response.modeUsed = "perplexity";
    response.success = true;
    response.content.text = jinaResult.content;
    response.content.title = jinaResult.title;
    response.content.textLength = jinaResult.content.length;
    response.finalUrl = url;
    response.timings.totalMs = Date.now() - startTime;
    response.crawlStatus = determineCrawlStatus(response.content.textLength, response.success);
    console.log(`[Crawl] Jina Reader success: ${url}, textLength=${response.content.textLength}`);
    return response;
  }
  
  // 3. Final fallback to Perplexity
  console.log(`[Crawl] Jina failed, trying Perplexity: ${url}`);
  const pplxStart = Date.now();
  const pplxResult = await fetchViaPerplexity(url);
  response.timings.perplexityMs += Date.now() - pplxStart;
  response.timings.totalMs = Date.now() - startTime;
  
  if (pplxResult) {
    response.modeUsed = "perplexity";
    response.success = true;
    response.content.text = pplxResult.content;
    response.content.title = pplxResult.title;
    response.content.textLength = pplxResult.content.length;
    response.finalUrl = url;
    response.crawlStatus = determineCrawlStatus(response.content.textLength, response.success);
    console.log(`[Crawl] Perplexity success: ${url}, textLength=${response.content.textLength}`);
    return response;
  }

  response.error = { 
    type: browserResult.errorType || "unknown", 
    message: "All crawl methods failed (HTTP, Browser, Firecrawl, Jina, Perplexity)" 
  };
  response.crawlStatus = "failed";
  response.timings.totalMs = Date.now() - startTime;
  console.log(`[Crawl] All methods failed: ${url}`);
  
  return response;
}

export function isContentReliable(response: CrawlResponse): boolean {
  if (!response.success) return false;
  if (response.crawlStatus === "failed") return false;
  if (response.content.textLength < 50) return false;
  if (response.error?.type === "captcha" || response.error?.type === "login_required") return false;
  return true;
}
