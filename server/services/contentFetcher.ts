/**
 * MARS - Content Fetcher
 * Deep reading of web pages with content extraction
 * 
 * Features:
 * - HTML content extraction (Readability-style)
 * - Date detection (publication/update)
 * - Content type classification
 * - Image extraction for vision analysis
 */

import * as cheerio from "cheerio";

export interface ExtractedContent {
  url: string;
  title: string;
  text: string;
  publishDate: string | null;
  updateDate: string | null;
  author: string | null;
  contentType: "article" | "documentation" | "forum" | "news" | "other";
  images: ExtractedImage[];
  tables: ExtractedTable[];
  wordCount: number;
  language: string | null;
  success: boolean;
  error?: string;
}

export interface ExtractedImage {
  src: string;
  alt: string;
  caption?: string;
  isChart: boolean;
}

export interface ExtractedTable {
  headers: string[];
  rows: string[][];
  caption?: string;
  context?: string;
}

const DATE_PATTERNS = [
  /(\d{4}-\d{2}-\d{2})/,
  /(\d{2}\/\d{2}\/\d{4})/,
  /(\d{1,2}\s+(?:janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+\d{4})/i,
  /(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4})/i,
  /((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/i
];

function extractDates(html: string, $: cheerio.CheerioAPI): { publish: string | null; update: string | null } {
  let publishDate: string | null = null;
  let updateDate: string | null = null;

  const dateSelectors = [
    'meta[property="article:published_time"]',
    'meta[name="date"]',
    'meta[name="publish-date"]',
    'time[datetime]',
    '[itemprop="datePublished"]',
    '.date',
    '.publish-date',
    '.article-date'
  ];

  for (const selector of dateSelectors) {
    const elem = $(selector).first();
    if (elem.length) {
      const dateStr = elem.attr("content") || elem.attr("datetime") || elem.text();
      if (dateStr && !publishDate) {
        publishDate = dateStr.trim().substring(0, 50);
        break;
      }
    }
  }

  const modifiedSelectors = [
    'meta[property="article:modified_time"]',
    'meta[name="last-modified"]',
    '[itemprop="dateModified"]'
  ];

  for (const selector of modifiedSelectors) {
    const elem = $(selector).first();
    if (elem.length) {
      const dateStr = elem.attr("content") || elem.text();
      if (dateStr) {
        updateDate = dateStr.trim().substring(0, 50);
        break;
      }
    }
  }

  if (!publishDate) {
    for (const pattern of DATE_PATTERNS) {
      const match = html.match(pattern);
      if (match) {
        publishDate = match[1];
        break;
      }
    }
  }

  return { publish: publishDate, update: updateDate };
}

function classifyContentType(url: string, $: cheerio.CheerioAPI): "article" | "documentation" | "forum" | "news" | "other" {
  const urlLower = url.toLowerCase();
  
  if (urlLower.includes("/docs/") || urlLower.includes("/documentation/") || 
      urlLower.includes("developer.") || urlLower.includes("docs.")) {
    return "documentation";
  }
  
  if (urlLower.includes("/forum/") || urlLower.includes("stackoverflow.") ||
      urlLower.includes("reddit.com") || urlLower.includes("/discussion/")) {
    return "forum";
  }
  
  if (urlLower.includes("/news/") || urlLower.includes("/actualit") ||
      $('meta[property="og:type"]').attr("content") === "article") {
    return "news";
  }
  
  if ($("article").length > 0 || $('[itemprop="articleBody"]').length > 0) {
    return "article";
  }
  
  return "other";
}

function extractMainContent($: cheerio.CheerioAPI): string {
  $("script, style, nav, header, footer, aside, .sidebar, .menu, .advertisement, .ads, .comments").remove();
  
  const contentSelectors = [
    "article",
    '[itemprop="articleBody"]',
    ".post-content",
    ".article-content",
    ".entry-content",
    ".content",
    "main",
    "#content",
    ".markdown-body"
  ];
  
  for (const selector of contentSelectors) {
    const content = $(selector).first();
    if (content.length && content.text().trim().length > 100) {
      return content.text().trim();
    }
  }
  
  return $("body").text().trim();
}

function extractImages($: cheerio.CheerioAPI, baseUrl: string): ExtractedImage[] {
  const images: ExtractedImage[] = [];
  const seen = new Set<string>();
  
  $("img").each((_, elem) => {
    const $img = $(elem);
    let src = $img.attr("src") || $img.attr("data-src") || "";
    
    if (src && !seen.has(src)) {
      seen.add(src);
      
      if (src.startsWith("/")) {
        try {
          const base = new URL(baseUrl);
          src = `${base.origin}${src}`;
        } catch {}
      }
      
      const alt = $img.attr("alt") || "";
      const caption = $img.closest("figure").find("figcaption").text() || undefined;
      
      const isChart = alt.toLowerCase().includes("chart") ||
                     alt.toLowerCase().includes("graph") ||
                     src.includes("chart") ||
                     src.includes("graph") ||
                     $img.closest(".chart, .graph, .diagram").length > 0;
      
      images.push({
        src,
        alt,
        caption,
        isChart
      });
    }
  });
  
  return images.slice(0, 10);
}

function detectLanguage($: cheerio.CheerioAPI): string | null {
  return $("html").attr("lang") || 
         $('meta[http-equiv="content-language"]').attr("content") ||
         null;
}

function extractTables($: cheerio.CheerioAPI): ExtractedTable[] {
  const tables: ExtractedTable[] = [];
  
  $("table").each((_, tableElem) => {
    const $table = $(tableElem);
    
    if ($table.find("tr").length < 2) return;
    
    const headers: string[] = [];
    const rows: string[][] = [];
    
    $table.find("thead tr th, thead tr td, tr:first-child th").each((_, th) => {
      const text = $(th).text().trim().replace(/\s+/g, " ");
      if (text) headers.push(text.substring(0, 100));
    });
    
    if (headers.length === 0) {
      const firstRow = $table.find("tr").first();
      firstRow.find("td, th").each((_, cell) => {
        const text = $(cell).text().trim().replace(/\s+/g, " ");
        headers.push(text.substring(0, 100));
      });
    }
    
    const dataRows = headers.length > 0 && $table.find("thead").length > 0
      ? $table.find("tbody tr")
      : $table.find("tr").slice(1);
    
    dataRows.each((_, tr) => {
      const row: string[] = [];
      $(tr).find("td, th").each((_, cell) => {
        const text = $(cell).text().trim().replace(/\s+/g, " ");
        row.push(text.substring(0, 200));
      });
      if (row.length > 0 && row.some(cell => cell.length > 0)) {
        rows.push(row);
      }
    });
    
    if (rows.length === 0 || headers.length === 0) return;
    
    const caption = $table.find("caption").text().trim() || 
                    $table.prev("h2, h3, h4, p").text().trim().substring(0, 100) ||
                    undefined;
    
    const context = $table.closest("section, article, div[class*='content']")
                          .find("h2, h3").first().text().trim().substring(0, 100) || undefined;
    
    tables.push({
      headers,
      rows: rows.slice(0, 50),
      caption,
      context
    });
  });
  
  return tables.slice(0, 10);
}

export async function fetchAndExtract(url: string, timeoutMs: number = 10000): Promise<ExtractedContent> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    console.log(`[MARS:ContentFetcher] Fetching: ${url}`);
    
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; UlysseBot/1.0; +https://devflow.app)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8"
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    const title = $("title").text().trim() || 
                  $('meta[property="og:title"]').attr("content") || 
                  "Sans titre";
    
    const text = extractMainContent($);
    const dates = extractDates(html, $);
    const contentType = classifyContentType(url, $);
    const images = extractImages($, url);
    const tables = extractTables($);
    const language = detectLanguage($);
    
    const author = $('[itemprop="author"]').text().trim() ||
                   $('meta[name="author"]').attr("content") ||
                   $(".author").first().text().trim() ||
                   null;
    
    console.log(`[MARS:ContentFetcher] Extracted: ${text.length} chars, ${images.length} images, ${tables.length} tables, type=${contentType}`);
    
    return {
      url,
      title: title.substring(0, 200),
      text: text.substring(0, 15000),
      publishDate: dates.publish,
      updateDate: dates.update,
      author,
      contentType,
      images,
      tables,
      wordCount: text.split(/\s+/).length,
      language,
      success: true
    };
  } catch (error) {
    clearTimeout(timeoutId);
    console.error(`[MARS:ContentFetcher] Error fetching ${url}:`, error);
    
    return {
      url,
      title: "",
      text: "",
      publishDate: null,
      updateDate: null,
      author: null,
      contentType: "other",
      images: [],
      tables: [],
      wordCount: 0,
      language: null,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

export async function fetchMultiple(urls: string[], maxConcurrent: number = 3): Promise<ExtractedContent[]> {
  const results: ExtractedContent[] = [];
  
  for (let i = 0; i < urls.length; i += maxConcurrent) {
    const batch = urls.slice(i, i + maxConcurrent);
    const batchResults = await Promise.all(batch.map(url => fetchAndExtract(url)));
    results.push(...batchResults);
  }
  
  return results;
}

export const contentFetcherService = {
  fetchAndExtract,
  fetchMultiple
};
