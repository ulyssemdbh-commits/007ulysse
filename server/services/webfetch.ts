import * as cheerio from "cheerio";
import OpenAI from "openai";
import Firecrawl from "@mendable/firecrawl-js";
import { ApifyClient } from "apify-client";
import { crawlWithBrowser, detectSPAIndicators, type BrowserCrawlResult } from "./scraper/browser";
import { crawlWithScreenshot, type ScreenshotResult } from "./scraper/screenshot";

let openaiClient: OpenAI | null = null;
let firecrawlClient: Firecrawl | null = null;
let apifyClient: ApifyClient | null = null;

// Initialize Firecrawl client
function getFirecrawl(): Firecrawl | null {
  if (!process.env.FIRECRAWL_API_KEY) {
    return null;
  }
  if (!firecrawlClient) {
    firecrawlClient = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY });
  }
  return firecrawlClient;
}

// Initialize Apify client
function getApify(): ApifyClient | null {
  if (!process.env.APIFY_API_TOKEN) {
    return null;
  }
  if (!apifyClient) {
    apifyClient = new ApifyClient({ token: process.env.APIFY_API_TOKEN });
  }
  return apifyClient;
}

// Apify - Cloud scraping platform with pre-built actors
export async function fetchViaApify(url: string): Promise<{ title: string; content: string } | null> {
  const client = getApify();
  if (!client) {
    console.log("[WebCrawl] Apify API token not available");
    return null;
  }
  
  try {
    console.log(`[WebCrawl] Using Apify for: ${url}`);
    
    // Use the "website-content-crawler" actor for generic scraping
    const run = await client.actor("apify/website-content-crawler").call({
      startUrls: [{ url }],
      maxCrawlPages: 1,
      crawlerType: "playwright:adaptive",
      maxConcurrency: 1,
    });
    
    // Get results from the dataset
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    
    if (items && items.length > 0) {
      const page = items[0] as { title?: string; text?: string; markdown?: string };
      const content = page.markdown || page.text || "";
      const title = page.title || url;
      
      if (content.length > 100) {
        console.log(`[WebCrawl] Apify success: ${content.length} chars`);
        return { title, content };
      }
    }
    
    console.log("[WebCrawl] Apify returned no content");
    return null;
  } catch (error) {
    console.error("[WebCrawl] Apify error:", error);
    return null;
  }
}

// Firecrawl - Powerful JavaScript rendering API (replaces Playwright in production)
export async function fetchViaFirecrawl(url: string): Promise<{ title: string; content: string } | null> {
  const client = getFirecrawl();
  if (!client) {
    console.log("[WebCrawl] Firecrawl API key not available");
    return null;
  }
  
  try {
    console.log(`[WebCrawl] Using Firecrawl for: ${url}`);
    
    const result = await client.scrapeUrl(url, {
      formats: ['markdown'],
      onlyMainContent: true,
      waitFor: 3000, // Wait for JavaScript to render
      timeout: 30000
    });
    
    if (result.success && result.markdown) {
      const content = result.markdown;
      const title = result.metadata?.title || url;
      
      console.log(`[WebCrawl] Firecrawl success: ${content.length} chars`);
      return { title, content };
    }
    
    console.log("[WebCrawl] Firecrawl returned no content");
    return null;
  } catch (error) {
    console.error("[WebCrawl] Firecrawl error:", error);
    return null;
  }
}

// Jina AI Reader - FREE, reliable fallback for web content extraction
export async function fetchViaJina(url: string): Promise<{ title: string; content: string } | null> {
  try {
    console.log(`[WebCrawl] Using Jina Reader fallback for: ${url}`);
    const jinaUrl = `https://r.jina.ai/${url}`;
    
    const response = await fetch(jinaUrl, {
      method: "GET",
      headers: {
        "Accept": "text/markdown",
        "X-Return-Format": "markdown",
        "X-With-Links-Summary": "true",
        "X-With-Images-Summary": "false"
      },
      signal: AbortSignal.timeout(60000) // 60s timeout for slow JS sites
    });
    
    if (!response.ok) {
      console.error(`[WebCrawl] Jina Reader error: ${response.status}`);
      return null;
    }
    
    const content = await response.text();
    
    if (content && content.length > 100) {
      // Extract title from first # heading or first line
      let title = url;
      const titleMatch = content.match(/^#\s+(.+)$/m);
      if (titleMatch) {
        title = titleMatch[1];
      } else {
        const firstLine = content.split('\n')[0];
        if (firstLine && firstLine.length < 200) {
          title = firstLine.replace(/^[#*_]+/, '').trim();
        }
      }
      
      console.log(`[WebCrawl] Jina Reader success: ${content.length} chars`);
      return { title, content };
    }
    
    console.log(`[WebCrawl] Jina Reader returned insufficient content`);
    return null;
  } catch (error) {
    console.error("[WebCrawl] Jina Reader error:", error);
    return null;
  }
}

// Perplexity fallback for blocked websites (exported for use in chat routes)
export async function fetchViaPerplexity(url: string): Promise<{ title: string; content: string } | null> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    console.log("[WebCrawl] Perplexity API key not available for fallback");
    return null;
  }
  
  try {
    console.log(`[WebCrawl] Using Perplexity fallback for: ${url}`);
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [
          {
            role: "system",
            content: "Tu es un assistant qui extrait le contenu principal d'une page web. Fournis un résumé structuré et complet du contenu visible sur la page, en français. Inclus les titres, listes, données importantes, prix si présents. Sois précis et exhaustif."
          },
          {
            role: "user",
            content: `Analyse et extrais le contenu complet de cette page web: ${url}\n\nDonne-moi:\n1. Le titre de la page\n2. Le contenu principal avec tous les détails importants (listes, tableaux, prix, matchs, événements, etc.)\n3. Les informations clés visibles sur la page`
          }
        ],
        max_tokens: 4000,
        temperature: 0.1,
        search_domain_filter: [(() => { try { return new URL(url).hostname; } catch { return url; } })()],
        return_images: false,
        return_related_questions: false
      }),
      signal: AbortSignal.timeout(30000)
    });
    
    if (!response.ok) {
      console.error(`[WebCrawl] Perplexity API error: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (content) {
      // Extract title from first line if present
      const lines = content.split("\n");
      let title = url;
      let mainContent = content;
      
      // Try to extract title from # heading
      const titleMatch = content.match(/^#\s+(.+)$/m);
      if (titleMatch) {
        title = titleMatch[1];
      }
      
      console.log(`[WebCrawl] Perplexity fallback success: ${content.length} chars`);
      return { title, content: mainContent };
    }
    
    return null;
  } catch (error) {
    console.error("[WebCrawl] Perplexity fallback error:", error);
    return null;
  }
}

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }
  return openaiClient;
}

export interface FetchTiming {
  startTime: number;
  endTime: number;
  durationMs: number;
  durationFormatted: string;
  phases?: {
    dns?: number;
    connect?: number;
    ttfb?: number;
    download?: number;
    parse?: number;
  };
}

export interface WebFetchResult {
  url: string;
  title: string;
  content: string;
  success: boolean;
  error?: string;
  metadata?: WebPageMetadata;
  structure?: PageStructure;
  media?: PageMedia;
  timing?: FetchTiming;
}

export interface WebPageMetadata {
  description?: string;
  keywords?: string[];
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  author?: string;
  language?: string;
  canonical?: string;
}

export interface PageStructure {
  headings: { level: number; text: string }[];
  links: { href: string; text: string }[];
  images: { src: string; alt: string }[];
  lists: string[];
  mainContentLength: number;
}

export interface MediaItem {
  type: "image" | "video" | "youtube" | "vimeo" | "embed";
  src: string;
  alt?: string;
  title?: string;
  context?: string;
  analysis?: string;
  thumbnail?: string;
  duration?: string;
}

export interface PageMedia {
  images: MediaItem[];
  videos: MediaItem[];
  totalCount: number;
}

export interface CrawlResult extends WebFetchResult {
  subPages?: WebFetchResult[];
  crawlDepth: number;
  totalPages: number;
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Get browser-like headers to avoid bot detection
function getBrowserHeaders(referer?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": getRandomUserAgent(),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Ch-Ua": '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
    "DNT": "1"
  };
  if (referer) {
    headers["Referer"] = referer;
    headers["Sec-Fetch-Site"] = "same-origin";
  }
  return headers;
}

// Try to fetch via Google cache if direct access fails
async function fetchViaGoogleCache(url: string): Promise<Response | null> {
  try {
    const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`;
    const response = await fetch(cacheUrl, {
      headers: getBrowserHeaders("https://www.google.com/"),
      redirect: "follow",
      signal: AbortSignal.timeout(10000)
    });
    if (response.ok) {
      console.log(`[WebCrawl] Fetched via Google cache: ${url}`);
      return response;
    }
  } catch (e) {
    console.log(`[WebCrawl] Google cache fallback failed for ${url}`);
  }
  return null;
}

// Retry fetch with different strategies
async function fetchWithRetry(url: string, maxRetries: number = 2): Promise<Response> {
  let lastError: Error | null = null;
  
  // Strategy 1: Direct fetch with browser headers
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, {
        headers: getBrowserHeaders(i > 0 ? "https://www.google.com/" : undefined),
        redirect: "follow",
        signal: AbortSignal.timeout(15000)
      });
      
      if (response.ok) return response;
      
      // If 403, try with different approach
      if (response.status === 403 && i < maxRetries - 1) {
        console.log(`[WebCrawl] Got 403, retrying with referer...`);
        await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
        continue;
      }
      
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 300));
      }
    }
  }
  
  // Strategy 2: Try Google cache as fallback
  const cacheResponse = await fetchViaGoogleCache(url);
  if (cacheResponse) return cacheResponse;
  
  throw lastError || new Error("Fetch failed after all retries");
}

function normalizeUrl(url: string): string {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return "https://" + url;
  }
  return url;
}

function extractDomain(url: string): string {
  try {
    const parsed = new URL(normalizeUrl(url));
    return parsed.hostname;
  } catch {
    return url;
  }
}

function isInternalLink(link: string, baseUrl: string): boolean {
  try {
    const baseDomain = extractDomain(baseUrl);
    if (link.startsWith("/") || link.startsWith("#")) return true;
    if (link.startsWith("http")) {
      return extractDomain(link) === baseDomain;
    }
    return true;
  } catch {
    return false;
  }
}

function resolveUrl(link: string, baseUrl: string): string {
  try {
    return new URL(link, baseUrl).href;
  } catch {
    return link;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = ((ms % 60000) / 1000).toFixed(0);
  return `${mins}m${secs}s`;
}

function createTiming(startTime: number, endTime: number): FetchTiming {
  const durationMs = endTime - startTime;
  return {
    startTime,
    endTime,
    durationMs,
    durationFormatted: formatDuration(durationMs)
  };
}

// Check if URL points to a PDF
function isPdfUrl(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  return lowerUrl.endsWith('.pdf') || 
         lowerUrl.includes('.pdf?') || 
         lowerUrl.includes('.pdf#');
}

// Fetch and parse PDF from URL
async function fetchPdfContent(url: string): Promise<WebFetchResult> {
  const startTime = Date.now();
  
  try {
    console.log(`[WebCrawl] Fetching PDF: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        ...getBrowserHeaders(),
        "Accept": "application/pdf,*/*"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30000) // 30s for larger PDFs
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("pdf") && !isPdfUrl(url)) {
      // Not actually a PDF, return null to try normal HTML parsing
      throw new Error("Not a PDF response");
    }
    
    // Download PDF buffer
    const buffer = Buffer.from(await response.arrayBuffer());
    console.log(`[WebCrawl] PDF downloaded: ${(buffer.length / 1024).toFixed(1)} KB`);
    
    // Parse PDF using pdf-parse
    let pdfParse: (buffer: Buffer) => Promise<{ text: string; numpages: number; info?: { Title?: string; Author?: string } }>;
    try {
      pdfParse = require("pdf-parse");
    } catch {
      console.error("[WebCrawl] pdf-parse not available");
      throw new Error("PDF parsing library not available");
    }
    
    const pdfData = await pdfParse(buffer);
    const endTime = Date.now();
    
    // Extract title from PDF metadata or URL
    const fileName = url.split("/").pop()?.replace(/\?.+$/, "") || "document.pdf";
    const title = pdfData.info?.Title || fileName.replace(".pdf", "");
    
    // Clean up the text content
    let content = pdfData.text
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    
    // Truncate if very long
    if (content.length > 50000) {
      content = content.substring(0, 50000) + "\n\n[...contenu tronqué, PDF très long...]";
    }
    
    console.log(`[WebCrawl] PDF parsed: ${pdfData.numpages} pages, ${content.length} chars`);
    
    return {
      url,
      title: `📄 ${title}`,
      content,
      success: true,
      metadata: {
        description: `Document PDF - ${pdfData.numpages} page(s)`,
        author: pdfData.info?.Author
      },
      timing: createTiming(startTime, endTime)
    };
  } catch (error) {
    const endTime = Date.now();
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[WebCrawl] PDF fetch error: ${errorMessage}`);
    
    return {
      url,
      title: url,
      content: "",
      success: false,
      error: `Impossible de lire le PDF: ${errorMessage}`,
      timing: createTiming(startTime, endTime)
    };
  }
}

export async function fetchWithVision(
  url: string,
  options?: {
    userId?: number;
    prompt?: string;
    focusOn?: string;
    fullPage?: boolean;
    useCache?: boolean;
    cacheHours?: number;
  }
): Promise<WebFetchResult> {
  const startTime = Date.now();
  
  try {
    console.log(`[WebCrawl] Using Vision approach for: ${url}`);
    
    const result = await crawlWithScreenshot(url, {
      userId: options?.userId,
      prompt: options?.prompt,
      focusOn: options?.focusOn,
      fullPage: options?.fullPage ?? false,
      useCache: options?.useCache ?? true,
      cacheHours: options?.cacheHours ?? 6,
      saveToDb: true,
    });
    
    const endTime = Date.now();
    
    if (!result.success) {
      console.error(`[WebCrawl] Vision approach failed: ${result.error}`);
      return {
        url,
        title: url,
        content: "",
        success: false,
        error: result.error || "Vision analysis failed",
        timing: createTiming(startTime, endTime),
      };
    }
    
    console.log(`[WebCrawl] Vision analysis complete${result.fromCache ? " (from cache)" : ""}: ${result.analysis?.length || 0} chars`);
    
    return {
      url,
      title: `Vision Analysis: ${url}`,
      content: result.analysis || "",
      success: true,
      timing: createTiming(startTime, endTime),
      metadata: {
        screenshotId: result.screenshotId,
        fromCache: result.fromCache,
        method: "vision",
      } as any,
    };
  } catch (error) {
    const endTime = Date.now();
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[WebCrawl] Vision fetch error: ${errorMessage}`);
    
    return {
      url,
      title: url,
      content: "",
      success: false,
      error: `Vision analysis failed: ${errorMessage}`,
      timing: createTiming(startTime, endTime),
    };
  }
}

export async function fetchWebsiteContent(url: string, options?: {
  timeout?: number;
  extractStructure?: boolean;
  maxLength?: number;
  useVision?: boolean;
  userId?: number;
  visionPrompt?: string;
  focusOn?: string;
}): Promise<WebFetchResult> {
  const extractStructure = options?.extractStructure ?? true;
  const maxLength = options?.maxLength || 20000;
  const startTime = Date.now();
  
  // Use Vision approach if explicitly requested
  if (options?.useVision) {
    console.log(`[WebCrawl] Vision mode requested for: ${url}`);
    return await fetchWithVision(url, {
      userId: options.userId,
      prompt: options.visionPrompt,
      focusOn: options.focusOn,
    });
  }
  
  try {
    url = normalizeUrl(url);
    console.log(`[WebCrawl] Fetching: ${url}`);

    // Check if this is a PDF URL - handle it specially
    if (isPdfUrl(url)) {
      console.log(`[WebCrawl] Detected PDF URL, using PDF parser`);
      return await fetchPdfContent(url);
    }

    // Use retry logic with anti-bot headers
    const fetchStart = Date.now();
    const response = await fetchWithRetry(url, 3);
    const fetchEnd = Date.now();
    
    // Check content-type - might be PDF even without .pdf extension
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/pdf")) {
      console.log(`[WebCrawl] Content-Type is PDF, using PDF parser`);
      return await fetchPdfContent(url);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract metadata
    const metadata: WebPageMetadata = {
      description: $('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content"),
      keywords: $('meta[name="keywords"]').attr("content")?.split(",").map(k => k.trim()).filter(Boolean),
      ogTitle: $('meta[property="og:title"]').attr("content"),
      ogDescription: $('meta[property="og:description"]').attr("content"),
      ogImage: $('meta[property="og:image"]').attr("content"),
      author: $('meta[name="author"]').attr("content"),
      language: $("html").attr("lang") || $('meta[http-equiv="content-language"]').attr("content"),
      canonical: $('link[rel="canonical"]').attr("href")
    };

    const title = $("title").text().trim() || metadata.ogTitle || url;

    // Remove unwanted elements
    $("script, style, noscript, iframe, svg, canvas").remove();
    $("nav, footer, header, aside, .sidebar, .menu, .navigation, .footer, .header, .ads, .advertisement, .cookie-banner, .popup").remove();
    $('[role="navigation"], [role="banner"], [role="contentinfo"], [aria-hidden="true"]').remove();

    // Extract structure if requested
    let structure: PageStructure | undefined;
    if (extractStructure) {
      const headings: { level: number; text: string }[] = [];
      $("h1, h2, h3, h4, h5, h6").each((_, el) => {
        const level = parseInt(el.tagName.substring(1));
        const text = $(el).text().trim();
        if (text) headings.push({ level, text });
      });

      const links: { href: string; text: string }[] = [];
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href") || "";
        const text = $(el).text().trim();
        if (href && text && !href.startsWith("#") && !href.startsWith("javascript:")) {
          links.push({ href: resolveUrl(href, url), text: text.substring(0, 100) });
        }
      });

      const images: { src: string; alt: string }[] = [];
      $("img[src]").each((_, el) => {
        const src = $(el).attr("src") || $(el).attr("data-src") || "";
        const alt = $(el).attr("alt") || "";
        if (src) images.push({ src: resolveUrl(src, url), alt });
      });

      const lists: string[] = [];
      $("ul, ol").each((_, el) => {
        const items: string[] = [];
        $(el).find("li").each((_, li) => {
          const text = $(li).text().trim();
          if (text) items.push(text.substring(0, 200));
        });
        if (items.length > 0) lists.push(items.join(" | "));
      });

      structure = {
        headings: headings.slice(0, 30),
        links: links.slice(0, 50),
        images: images.slice(0, 20),
        lists: lists.slice(0, 10),
        mainContentLength: 0
      };
    }

    // Extract main content - prioritize article, main, or largest text block
    let mainContent = "";
    
    const mainSelectors = [
      "article",
      "main",
      '[role="main"]',
      ".content",
      ".main-content",
      "#content",
      "#main",
      ".post-content",
      ".article-content",
      ".entry-content"
    ];

    for (const selector of mainSelectors) {
      const element = $(selector).first();
      if (element.length) {
        mainContent = element.text();
        break;
      }
    }

    // Fallback to body if no main content found
    if (!mainContent || mainContent.length < 100) {
      mainContent = $("body").text();
    }

    // Clean up content
    let content = mainContent
      .replace(/\s+/g, " ")
      .replace(/\n\s*\n/g, "\n")
      .trim();

    if (structure) {
      structure.mainContentLength = content.length;
    }

    // Truncate if too long
    if (content.length > maxLength) {
      content = content.substring(0, maxLength) + "... [contenu tronqué]";
    }

    // If content is too short or SPA detected, try Playwright browser fallback first
    const isSPA = detectSPAIndicators(html);
    if (content.length < 200 || isSPA) {
      console.log(`[WebCrawl] Content too short (${content.length} chars) or SPA detected, trying Playwright browser`);
      
      const browserResult = await crawlWithBrowser(url, {
        timeoutMs: 20000,
        blockAssets: true,
        extractText: true
      });
      
      if (browserResult.success && browserResult.textContent && browserResult.textContent.length > content.length) {
        const browserContent = browserResult.textContent
          .replace(/\s+/g, " ")
          .replace(/\n\s*\n/g, "\n")
          .trim()
          .substring(0, maxLength);
        
        const endTime = Date.now();
        const timing = createTiming(startTime, endTime);
        console.log(`[WebCrawl] Playwright provided better content: ${browserContent.length} chars (mode: browser)`);
        return {
          url,
          title: browserResult.title || title,
          content: browserContent,
          success: true,
          metadata: { ...metadata, description: "Contenu extrait via navigateur headless" },
          timing
        };
      }
      
      // If Playwright failed or didn't provide better content, try Perplexity
      if (!browserResult.success || (browserResult.textContent?.length || 0) < 200) {
        console.log(`[WebCrawl] Browser crawl insufficient, trying Perplexity fallback`);
        const perplexityResult = await fetchViaPerplexity(url);
        if (perplexityResult && perplexityResult.content.length > content.length) {
          const endTime = Date.now();
          const timing = createTiming(startTime, endTime);
          console.log(`[WebCrawl] Perplexity provided better content: ${perplexityResult.content.length} chars`);
          return {
            url,
            title: perplexityResult.title || title,
            content: perplexityResult.content,
            success: true,
            metadata: { ...metadata, description: "Contenu enrichi via Perplexity AI" },
            timing
          };
        }
      }
    }

    const endTime = Date.now();
    const timing = createTiming(startTime, endTime);
    const ttfbTime = fetchEnd - fetchStart;
    const parseTime = endTime - fetchEnd;
    timing.phases = {
      ttfb: ttfbTime,
      parse: parseTime
    };

    console.log(`[WebCrawl] Success: ${url} - ${content.length} chars in ${timing.durationFormatted} (fetch: ${formatDuration(ttfbTime)}, parse: ${formatDuration(parseTime)})`);

    return {
      url,
      title,
      content,
      success: true,
      metadata,
      structure,
      timing
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Erreur inconnue";
    console.error(`[WebCrawl] Direct fetch failed for ${url}:`, errorMsg);
    
    // Try Playwright browser as first fallback
    console.log(`[WebCrawl] Trying Playwright browser fallback for ${url}`);
    const browserResult = await crawlWithBrowser(url, {
      timeoutMs: 25000,
      blockAssets: true,
      extractText: true
    });
    
    if (browserResult.success && browserResult.textContent && browserResult.textContent.length > 100) {
      const browserContent = browserResult.textContent
        .replace(/\s+/g, " ")
        .replace(/\n\s*\n/g, "\n")
        .trim()
        .substring(0, 20000);
      
      const endTime = Date.now();
      const timing = createTiming(startTime, endTime);
      console.log(`[WebCrawl] Playwright fallback success for ${url}: ${browserContent.length} chars`);
      
      return {
        url,
        title: browserResult.title || url,
        content: browserContent,
        success: true,
        metadata: { description: "Contenu extrait via navigateur headless" },
        timing
      };
    }
    
    // Log browser failure reason for debugging
    if (!browserResult.success) {
      console.log(`[WebCrawl] Browser fallback failed: ${browserResult.errorType} - ${browserResult.error}`);
    }
    
    // Try Perplexity as last resort
    const perplexityResult = await fetchViaPerplexity(url);
    if (perplexityResult) {
      const endTime = Date.now();
      const timing = createTiming(startTime, endTime);
      console.log(`[WebCrawl] Perplexity fallback success for ${url}`);
      
      return {
        url,
        title: perplexityResult.title,
        content: perplexityResult.content,
        success: true,
        metadata: { description: "Contenu extrait via Perplexity AI" },
        timing
      };
    }
    
    const endTime = Date.now();
    const timing = createTiming(startTime, endTime);
    return {
      url,
      title: "",
      content: "",
      success: false,
      error: `Échec de toutes les méthodes: HTTP (${errorMsg}), Browser (${browserResult.errorType || 'échec'}), Perplexity (indisponible)`,
      timing
    };
  }
}

export async function crawlWebsite(url: string, options?: {
  maxPages?: number;
  maxDepth?: number;
  timeout?: number;
  sameHostOnly?: boolean;
}): Promise<CrawlResult> {
  const maxPages = options?.maxPages || 5;
  const maxDepth = options?.maxDepth || 1;
  const timeout = options?.timeout || 15000;
  const sameHostOnly = options?.sameHostOnly ?? true;

  console.log(`[WebCrawl] Starting crawl: ${url} (max ${maxPages} pages, depth ${maxDepth})`);

  const mainPage = await fetchWebsiteContent(url, { timeout, extractStructure: true });
  
  if (!mainPage.success) {
    return {
      ...mainPage,
      crawlDepth: 0,
      totalPages: 0
    };
  }

  const result: CrawlResult = {
    ...mainPage,
    subPages: [],
    crawlDepth: maxDepth,
    totalPages: 1
  };

  // If depth > 0, crawl internal links
  if (maxDepth > 0 && mainPage.structure?.links) {
    const internalLinks = mainPage.structure.links
      .filter(link => sameHostOnly ? isInternalLink(link.href, url) : true)
      .filter(link => !link.href.includes("#") && !link.href.match(/\.(pdf|zip|doc|xls|png|jpg|gif|mp4|mp3)$/i))
      .slice(0, maxPages - 1);

    const crawledUrls = new Set([url]);
    
    for (const link of internalLinks) {
      if (crawledUrls.has(link.href)) continue;
      crawledUrls.add(link.href);

      try {
        const subPage = await fetchWebsiteContent(link.href, { 
          timeout: timeout / 2,
          extractStructure: false,
          maxLength: 5000
        });
        
        if (subPage.success) {
          result.subPages!.push(subPage);
          result.totalPages++;
        }

        // Small delay to be polite
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (err) {
        console.log(`[WebCrawl] Skipped subpage ${link.href}: ${err}`);
      }

      if (result.totalPages >= maxPages) break;
    }
  }

  console.log(`[WebCrawl] Crawl complete: ${result.totalPages} pages crawled`);
  return result;
}

export function formatWebContentForAI(result: WebFetchResult): string {
  if (!result.success) {
    const timeInfo = result.timing ? ` (échec après ${result.timing.durationFormatted})` : "";
    return `[Impossible de lire le site ${result.url}${timeInfo}: ${result.error}]`;
  }

  let output = `### Contenu du site web: ${result.title}\n`;
  output += `URL: ${result.url}\n`;
  
  // Add timing info - real consultation time
  if (result.timing) {
    output += `⏱️ Temps de consultation: ${result.timing.durationFormatted}`;
    if (result.timing.phases) {
      const phases: string[] = [];
      if (result.timing.phases.ttfb) phases.push(`réseau: ${formatDuration(result.timing.phases.ttfb)}`);
      if (result.timing.phases.parse) phases.push(`analyse: ${formatDuration(result.timing.phases.parse)}`);
      if (phases.length > 0) output += ` (${phases.join(", ")})`;
    }
    output += "\n";
  }
  
  if (result.metadata) {
    if (result.metadata.description) {
      output += `Description: ${result.metadata.description}\n`;
    }
    if (result.metadata.language) {
      output += `Langue: ${result.metadata.language}\n`;
    }
  }

  if (result.structure) {
    if (result.structure.headings.length > 0) {
      output += `\n**Structure du site:**\n`;
      result.structure.headings.slice(0, 15).forEach(h => {
        output += `${"#".repeat(h.level)} ${h.text}\n`;
      });
    }

    if (result.structure.images.length > 0) {
      output += `\n**Images (${result.structure.images.length}):** `;
      output += result.structure.images.slice(0, 5).map(img => img.alt || "image").join(", ");
      output += "\n";
    }
  }

  output += `\n**Contenu principal:**\n${result.content}`;

  return output;
}

export function formatCrawlResultForAI(result: CrawlResult): string {
  let output = formatWebContentForAI(result);
  
  if (result.subPages && result.subPages.length > 0) {
    output += `\n\n---\n**Pages liées crawlées (${result.subPages.length}):**\n`;
    
    for (const subPage of result.subPages) {
      output += `\n### ${subPage.title}\n`;
      output += `URL: ${subPage.url}\n`;
      output += subPage.content.substring(0, 2000);
      if (subPage.content.length > 2000) output += "...";
      output += "\n";
    }
  }

  // Calculate total time for crawl
  let totalTime = result.timing?.durationMs || 0;
  if (result.subPages) {
    for (const subPage of result.subPages) {
      totalTime += subPage.timing?.durationMs || 0;
    }
  }
  
  output += `\n[Crawl: ${result.totalPages} page(s), profondeur ${result.crawlDepth}, temps total: ${formatDuration(totalTime)}]`;
  return output;
}

// Extract YouTube video ID from URL
function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Extract Vimeo video ID from URL
function extractVimeoId(url: string): string | null {
  const match = url.match(/vimeo\.com\/(\d+)/);
  return match ? match[1] : null;
}

// Get YouTube video info via oEmbed
export async function getYouTubeInfo(videoUrl: string): Promise<MediaItem | null> {
  try {
    const videoId = extractYouTubeId(videoUrl);
    if (!videoId) return null;
    
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const response = await fetch(oembedUrl, { signal: AbortSignal.timeout(5000) });
    
    if (!response.ok) return null;
    
    const data = await response.json();
    return {
      type: "youtube",
      src: `https://www.youtube.com/watch?v=${videoId}`,
      title: data.title || "YouTube Video",
      thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      context: data.author_name ? `Par ${data.author_name}` : undefined
    };
  } catch (error) {
    console.error("[WebCrawl] YouTube info error:", error);
    return null;
  }
}

// Get Vimeo video info via oEmbed
export async function getVimeoInfo(videoUrl: string): Promise<MediaItem | null> {
  try {
    const videoId = extractVimeoId(videoUrl);
    if (!videoId) return null;
    
    const oembedUrl = `https://vimeo.com/api/oembed.json?url=https://vimeo.com/${videoId}`;
    const response = await fetch(oembedUrl, { signal: AbortSignal.timeout(5000) });
    
    if (!response.ok) return null;
    
    const data = await response.json();
    return {
      type: "vimeo",
      src: `https://vimeo.com/${videoId}`,
      title: data.title || "Vimeo Video",
      thumbnail: data.thumbnail_url,
      duration: data.duration ? `${Math.floor(data.duration / 60)}:${(data.duration % 60).toString().padStart(2, "0")}` : undefined,
      context: data.author_name ? `Par ${data.author_name}` : undefined
    };
  } catch (error) {
    console.error("[WebCrawl] Vimeo info error:", error);
    return null;
  }
}

// Analyze an image using GPT-4 Vision
export async function analyzeImage(imageUrl: string, context?: string): Promise<string> {
  try {
    const openai = getOpenAI();
    const prompt = context 
      ? `Décris cette image de manière concise. Contexte: ${context}` 
      : "Décris cette image de manière concise (max 2-3 phrases).";
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageUrl, detail: "low" } }
          ]
        }
      ]
    });
    
    return response.choices[0]?.message?.content || "Image non analysable";
  } catch (error) {
    console.error("[WebCrawl] Image analysis error:", error);
    return "Erreur d'analyse d'image";
  }
}

// Extract all media from HTML
export function extractMediaFromHtml(html: string, baseUrl: string): PageMedia {
  const $ = cheerio.load(html);
  const images: MediaItem[] = [];
  const videos: MediaItem[] = [];
  
  // Extract images
  $("img[src], img[data-src]").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || "";
    if (!src || src.startsWith("data:")) return;
    
    const alt = $(el).attr("alt") || "";
    const title = $(el).attr("title") || "";
    const parent = $(el).parent();
    const context = parent.text().trim().substring(0, 100);
    
    images.push({
      type: "image",
      src: resolveUrl(src, baseUrl),
      alt,
      title,
      context: context || undefined
    });
  });
  
  // Extract YouTube embeds
  $('iframe[src*="youtube"], iframe[src*="youtu.be"]').each((_, el) => {
    const src = $(el).attr("src") || "";
    const videoId = extractYouTubeId(src);
    if (videoId) {
      videos.push({
        type: "youtube",
        src: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        title: $(el).attr("title") || "YouTube Video"
      });
    }
  });
  
  // Extract Vimeo embeds
  $('iframe[src*="vimeo"]').each((_, el) => {
    const src = $(el).attr("src") || "";
    const videoId = extractVimeoId(src);
    if (videoId) {
      videos.push({
        type: "vimeo",
        src: `https://vimeo.com/${videoId}`,
        title: $(el).attr("title") || "Vimeo Video"
      });
    }
  });
  
  // Extract HTML5 video tags
  $("video source, video[src]").each((_, el) => {
    const src = $(el).attr("src") || "";
    if (src) {
      const video = $(el).closest("video");
      videos.push({
        type: "video",
        src: resolveUrl(src, baseUrl),
        title: video.attr("title") || "Video"
      });
    }
  });
  
  // Extract video links (common patterns)
  $('a[href*=".mp4"], a[href*=".webm"], a[href*=".mov"]').each((_, el) => {
    const href = $(el).attr("href") || "";
    videos.push({
      type: "video",
      src: resolveUrl(href, baseUrl),
      title: $(el).text().trim() || "Video Link"
    });
  });
  
  return {
    images: images.slice(0, 30),
    videos: videos.slice(0, 20),
    totalCount: images.length + videos.length
  };
}

// Fetch website with full media extraction and optional analysis
export async function fetchWebsiteWithMedia(url: string, options?: {
  analyzeImages?: boolean;
  maxImagesToAnalyze?: number;
  getVideoInfo?: boolean;
}): Promise<WebFetchResult> {
  const analyzeImages = options?.analyzeImages ?? false;
  const maxImagesToAnalyze = options?.maxImagesToAnalyze || 3;
  const getVideoInfo = options?.getVideoInfo ?? true;
  
  url = normalizeUrl(url);
  console.log(`[WebCrawl] Fetching with media: ${url}`);
  
  // Check if this is a PDF URL - PDFs don't have extractable media
  if (isPdfUrl(url)) {
    console.log(`[WebCrawl] PDF URL detected, fetching as PDF (no media extraction)`);
    return await fetchPdfContent(url);
  }
  
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": getRandomUserAgent(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20000)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    // Check content-type - might be PDF even without .pdf extension
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/pdf")) {
      console.log(`[WebCrawl] Content-Type is PDF, fetching as PDF`);
      return await fetchPdfContent(url);
    }
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Extract basic content first
    const baseResult = await fetchWebsiteContent(url, { extractStructure: true });
    if (!baseResult.success) return baseResult;
    
    // Extract media
    const media = extractMediaFromHtml(html, url);
    
    // Get video info for YouTube/Vimeo
    if (getVideoInfo) {
      for (let i = 0; i < Math.min(media.videos.length, 5); i++) {
        const video = media.videos[i];
        if (video.type === "youtube") {
          const info = await getYouTubeInfo(video.src);
          if (info) {
            media.videos[i] = { ...video, ...info };
          }
        } else if (video.type === "vimeo") {
          const info = await getVimeoInfo(video.src);
          if (info) {
            media.videos[i] = { ...video, ...info };
          }
        }
      }
    }
    
    // Analyze key images if requested
    if (analyzeImages && media.images.length > 0) {
      const imagesToAnalyze = media.images
        .filter(img => img.src.match(/\.(jpg|jpeg|png|gif|webp)$/i))
        .slice(0, maxImagesToAnalyze);
      
      for (const img of imagesToAnalyze) {
        try {
          img.analysis = await analyzeImage(img.src, img.context);
        } catch (e) {
          console.log(`[WebCrawl] Skipped image analysis: ${e}`);
        }
      }
    }
    
    console.log(`[WebCrawl] Media extracted: ${media.images.length} images, ${media.videos.length} videos`);
    
    return {
      ...baseResult,
      media
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Erreur inconnue";
    console.error(`[WebCrawl] Media fetch error for ${url}:`, errorMsg);
    return {
      url,
      title: "",
      content: "",
      success: false,
      error: errorMsg
    };
  }
}

// Format media for AI context
export function formatMediaForAI(media: PageMedia): string {
  let output = "";
  
  if (media.images.length > 0) {
    output += `\n**Images sur la page (${media.images.length}):**\n`;
    media.images.slice(0, 10).forEach((img, i) => {
      output += `${i + 1}. ${img.alt || img.title || "Image sans description"}`;
      if (img.analysis) {
        output += ` - Analyse: ${img.analysis}`;
      }
      output += `\n   URL: ${img.src}\n`;
    });
  }
  
  if (media.videos.length > 0) {
    output += `\n**Vidéos sur la page (${media.videos.length}):**\n`;
    media.videos.forEach((vid, i) => {
      output += `${i + 1}. [${vid.type.toUpperCase()}] ${vid.title || "Vidéo"}`;
      if (vid.duration) output += ` (${vid.duration})`;
      if (vid.context) output += ` - ${vid.context}`;
      output += `\n   URL: ${vid.src}`;
      if (vid.thumbnail) output += `\n   Miniature: ${vid.thumbnail}`;
      output += "\n";
    });
  }
  
  return output;
}

// Enhanced format for AI with media
export function formatWebContentWithMediaForAI(result: WebFetchResult): string {
  let output = formatWebContentForAI(result);
  
  if (result.media && result.media.totalCount > 0) {
    output += formatMediaForAI(result.media);
  }
  
  return output;
}
