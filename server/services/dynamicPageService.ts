import { browserService, BrowserCrawlRequest, BrowserCrawlResponse, BrowserAction } from "./browserService";
import { fetchViaJina, fetchViaApify } from "./webfetch";
import * as cheerio from "cheerio";

export interface DynamicExtractOptions {
  url: string;
  project?: string;
  extractorId?: string;
  mode?: "html" | "text" | "dom" | "auto" | "xhr";
  script?: string;
  selectors?: string[];
  actions?: BrowserAction[];
  forceRefresh?: boolean;
  timeout?: number;
  humanSimulation?: boolean;
}

export interface DynamicPageResult {
  success: boolean;
  url: string;
  urlFinal: string;
  content: string;
  html?: string;
  data?: unknown;
  xhrData?: unknown[];
  method: "browser" | "jina" | "apify" | "http";
  meta: {
    loadTimeMs: number;
    contentLength: number;
    project?: string;
    profile?: string;
    cached?: boolean;
  };
  error?: string;
}

interface DomainConfig {
  profile: string;
  humanSimulation: boolean;
  waitForNetworkIdle: boolean;
  interceptXhr: boolean;
  defaultActions?: BrowserAction[];
  extractorScript?: string;
  cacheDurationMinutes: number;
}

const DOMAIN_CONFIGS: Record<string, DomainConfig> = {
  "parionssport.fdj.fr": {
    profile: "betting",
    humanSimulation: true,
    waitForNetworkIdle: false, // Use timeout-based wait instead (FDJ never stops loading)
    interceptXhr: true,
    defaultActions: [
      { type: "waitForLoadState", state: "domcontentloaded" },
      { type: "delay", ms: 5000 }, // Critical: Let JS render content (like the guide recommends)
      { type: "scroll", y: 800 },
      { type: "delay", ms: 2000 },
      { type: "scroll", y: 1600 },
      { type: "delay", ms: 2000 },
      { type: "scroll", y: 0 },
      { type: "delay", ms: 1500 }
    ],
    extractorScript: `
      (() => {
        const result = { matches: [], rawText: '', debug: {} };
        
        // ParionsSport-specific selectors from FDJ DOM structure (guide-validated)
        const eventSelectors = [
          "[data-test='event-row']",
          ".event-row",
          ".c-events__item",           // From guide
          "[class*='EventRow']",
          "[class*='event-row']",
          ".pari-event-row",
          "[data-eventid]",
          "[data-event-id]",
          "li[class*='event']",
          "div[class*='sport-event']",
          "[class*='match-row']"
        ];
        
        let eventRows = [];
        for (const sel of eventSelectors) {
          try {
            const found = document.querySelectorAll(sel);
            if (found.length > 0) {
              eventRows = [...found];
              result.debug.usedSelector = sel;
              result.debug.rowCount = found.length;
              break;
            }
          } catch(e) {}
        }
        
        // Team selectors - guide-validated + extended
        const homeSelectors = [
          "[data-test='event-home-team-name']",
          ".event-row__participant--home",
          ".c-events__team--home",     // From guide
          ".team-home",
          "[class*='home-team']",
          "[class*='HomeTeam']",
          "[class*='participant']:first-child"
        ];
        const awaySelectors = [
          "[data-test='event-away-team-name']",
          ".event-row__participant--away",
          ".c-events__team--away",     // From guide
          ".team-away",
          "[class*='away-team']",
          "[class*='AwayTeam']",
          "[class*='participant']:last-child"
        ];
        
        // Odds selectors - guide-validated + extended
        const odd1Selectors = [
          "[data-selection='1']",
          "[data-outcome='1']",
          "[data-test='market-outcome-1']",   // From guide
          ".odd-1",
          "[class*='odd-1']",
          "button:nth-child(1)"
        ];
        const oddNSelectors = [
          "[data-selection='N']",
          "[data-outcome='N']",
          "[data-test='market-outcome-N']",   // From guide
          ".odd-n",
          "[class*='odd-n']",
          "button:nth-child(2)"
        ];
        const odd2Selectors = [
          "[data-selection='2']",
          "[data-outcome='2']",
          "[data-test='market-outcome-2']",   // From guide
          ".odd-2",
          "[class*='odd-2']",
          "button:nth-child(3)"
        ];
        
        const findText = (el, selectors) => {
          for (const sel of selectors) {
            try {
              const found = el.querySelector(sel);
              if (found) return found.textContent?.trim() || '';
            } catch(e) {}
          }
          return '';
        };
        
        const findOdd = (el, selectors) => {
          for (const sel of selectors) {
            try {
              const found = el.querySelector(sel);
              if (found) {
                const txt = found.textContent?.replace(',', '.').trim() || '';
                const num = parseFloat(txt);
                if (!isNaN(num) && num > 1 && num < 100) return num;
              }
            } catch(e) {}
          }
          return null;
        };
        
        eventRows.forEach((row, idx) => {
          const homeTeam = findText(row, homeSelectors);
          const awayTeam = findText(row, awaySelectors);
          const odd1 = findOdd(row, odd1Selectors);
          const oddN = findOdd(row, oddNSelectors);
          const odd2 = findOdd(row, odd2Selectors);
          
          // Fallback: extract all odds from text
          const text = row.textContent?.trim() || '';
          const oddsMatch = text.match(/(\\d+[.,]\\d{2})/g) || [];
          const allOdds = oddsMatch.map(o => parseFloat(o.replace(',', '.'))).filter(n => n > 1 && n < 100);
          
          if (homeTeam || awayTeam || allOdds.length >= 2) {
            result.matches.push({
              index: idx,
              homeTeam: homeTeam || 'Unknown',
              awayTeam: awayTeam || 'Unknown',
              odds1: odd1 || allOdds[0] || null,
              oddsN: oddN || allOdds[1] || null,
              odds2: odd2 || allOdds[2] || null,
              rawText: text.substring(0, 300)
            });
          }
        });
        
        // Get raw page text for AI fallback
        const main = document.querySelector('main, #main, .main, [role="main"]') || document.body;
        result.rawText = main.innerText?.substring(0, 50000) || '';
        result.debug.totalOddsButtons = document.querySelectorAll('[class*="odd"], [class*="cote"], button[class*="Quote"]').length;
        result.debug.pageTitle = document.title;
        
        return result;
      })()
    `,
    cacheDurationMinutes: 5
  },
  "winamax.fr": {
    profile: "betting",
    humanSimulation: true,
    waitForNetworkIdle: true,
    interceptXhr: true,
    defaultActions: [
      { type: "waitForLoadState", state: "networkidle" },
      { type: "delay", ms: 2000 }
    ],
    cacheDurationMinutes: 5
  },
  "betclic.fr": {
    profile: "betting",
    humanSimulation: true,
    waitForNetworkIdle: true,
    interceptXhr: true,
    cacheDurationMinutes: 5
  },
  "lequipe.fr": {
    profile: "default",
    humanSimulation: false,
    waitForNetworkIdle: true,
    interceptXhr: false,
    extractorScript: `
      (() => {
        const rankings = [];
        const rows = document.querySelectorAll('table tr, [class*="ranking"] [class*="row"]');
        rows.forEach(row => {
          const cells = row.querySelectorAll('td, [class*="cell"]');
          if (cells.length >= 3) {
            rankings.push({
              position: cells[0]?.textContent?.trim(),
              team: cells[1]?.textContent?.trim(),
              points: cells[cells.length - 1]?.textContent?.trim()
            });
          }
        });
        return rankings;
      })()
    `,
    cacheDurationMinutes: 30
  },
  "flashscore.fr": {
    profile: "default",
    humanSimulation: false,
    waitForNetworkIdle: true,
    interceptXhr: true,
    cacheDurationMinutes: 5
  },
  "sofascore.com": {
    profile: "default",
    humanSimulation: false,
    waitForNetworkIdle: true,
    interceptXhr: true,
    cacheDurationMinutes: 5
  },
  "pronosoft.com": {
    profile: "betting",
    humanSimulation: false,
    waitForNetworkIdle: true,
    interceptXhr: false,
    defaultActions: [
      { type: "waitForLoadState", state: "domcontentloaded" },
      { type: "delay", ms: 1500 },
      // Accept cookie consent modal to reveal match data
      { type: "click", selector: "button[class*='accept'], .accept-cookies, #accept-cookies, [id*='accept'], .didomi-continue-without-agreeing, .consent-accept, [class*='agree'], button:has-text('Tout accepter'), button:has-text('Accept')", timeout: 3000 },
      { type: "delay", ms: 2000 }
    ],
    extractorScript: `
      (() => {
        const result = { matches: [], debug: {} };
        
        // Pronosoft uses tables with specific structure for ParionsSport odds
        const rows = document.querySelectorAll('table tr, [class*="match"], [class*="event"], .ligne_match, .ligne-match');
        result.debug.totalRows = rows.length;
        
        rows.forEach((row, idx) => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 4) {
            // Try to extract teams and odds
            const text = row.textContent || '';
            
            // Look for pattern: "Team A - Team B" or two team cells
            let teams = '';
            let odd1 = null, oddN = null, odd2 = null;
            
            // Check for combined teams cell (usually has " - " separator)
            for (const cell of cells) {
              const cellText = cell.textContent?.trim() || '';
              if (cellText.includes(' - ') && cellText.length > 5 && cellText.length < 100) {
                teams = cellText;
                break;
              }
            }
            
            // If no combined cell, try first two text cells
            if (!teams && cells.length >= 2) {
              const t1 = cells[0]?.textContent?.trim() || '';
              const t2 = cells[1]?.textContent?.trim() || '';
              if (t1 && t2 && !t1.match(/^\\d/) && !t2.match(/^\\d/)) {
                teams = t1 + ' - ' + t2;
              }
            }
            
            // Extract odds from last 3 numeric cells
            const numericCells = [...cells].filter(c => {
              const t = c.textContent?.replace(',', '.').trim() || '';
              const n = parseFloat(t);
              return !isNaN(n) && n >= 1 && n < 100;
            });
            
            if (numericCells.length >= 3) {
              const last3 = numericCells.slice(-3);
              odd1 = parseFloat(last3[0]?.textContent?.replace(',', '.').trim() || '');
              oddN = parseFloat(last3[1]?.textContent?.replace(',', '.').trim() || '');
              odd2 = parseFloat(last3[2]?.textContent?.replace(',', '.').trim() || '');
            }
            
            // Fallback: regex all odds from row text
            if (!odd1 || !oddN || !odd2) {
              const oddsMatch = text.match(/(\\d+[.,]\\d{2})/g) || [];
              const allOdds = oddsMatch.map(o => parseFloat(o.replace(',', '.'))).filter(n => n >= 1.01 && n < 100);
              if (allOdds.length >= 3) {
                odd1 = odd1 || allOdds[allOdds.length - 3];
                oddN = oddN || allOdds[allOdds.length - 2];
                odd2 = odd2 || allOdds[allOdds.length - 1];
              }
            }
            
            if (teams && (odd1 || oddN || odd2)) {
              result.matches.push({
                index: idx,
                teams: teams,
                odd1: odd1 || null,
                oddN: oddN || null,
                odd2: odd2 || null,
                rawText: text.substring(0, 200).trim()
              });
            }
          }
        });
        
        // Also try to get page title/header for competition context
        const h1 = document.querySelector('h1, .titre, .title');
        result.debug.pageTitle = h1?.textContent?.trim() || document.title;
        result.debug.matchCount = result.matches.length;
        
        // Include raw text content for fallback parsing
        result.rawText = document.body?.innerText || document.body?.textContent || '';
        
        return result;
      })()
    `,
    cacheDurationMinutes: 10
  }
};

const JS_HEAVY_PATTERNS = [
  /react|angular|vue|next|nuxt|gatsby/i,
  /spa|single.?page/i,
  /app\.(js|jsx|tsx)/i,
  /__NEXT_DATA__|__NUXT__|window\.__INITIAL_STATE__/i
];

const DYNAMIC_DOMAINS = [
  "parionssport.fdj.fr",
  "winamax.fr",
  "betclic.fr",
  "unibet.fr",
  "pmu.fr",
  "zebet.fr",
  "pronosoft.com",     // ParionsSport odds aggregator
  "flashscore",
  "sofascore",
  "livescore",
  "365scores",
  "fotmob",
  "whoscored"
];

const pageCache = new Map<string, { result: DynamicPageResult; timestamp: number }>();

function isLikelyDynamic(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return DYNAMIC_DOMAINS.some(domain => hostname.includes(domain));
  } catch {
    return false;
  }
}

function getDomainConfig(url: string): DomainConfig | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    for (const [domain, config] of Object.entries(DOMAIN_CONFIGS)) {
      if (hostname.includes(domain)) {
        return config;
      }
    }
  } catch {}
  return null;
}

function getCacheKey(url: string, mode: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}:${mode}`;
  } catch {
    return `${url}:${mode}`;
  }
}

function getCachedResult(url: string, mode: string, maxAgeMinutes: number): DynamicPageResult | null {
  const key = getCacheKey(url, mode);
  const cached = pageCache.get(key);
  if (cached && Date.now() - cached.timestamp < maxAgeMinutes * 60 * 1000) {
    return { ...cached.result, meta: { ...cached.result.meta, cached: true } };
  }
  return null;
}

function setCachedResult(url: string, mode: string, result: DynamicPageResult): void {
  const key = getCacheKey(url, mode);
  pageCache.set(key, { result, timestamp: Date.now() });
  
  if (pageCache.size > 100) {
    const entries = Array.from(pageCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    for (let i = 0; i < 20; i++) {
      pageCache.delete(entries[i][0]);
    }
  }
}

export async function fetchDynamicPage(opts: DynamicExtractOptions): Promise<DynamicPageResult> {
  const startTime = Date.now();
  const mode = opts.mode || "auto";
  
  const domainConfig = getDomainConfig(opts.url);
  const cacheDuration = domainConfig?.cacheDurationMinutes || 15;
  
  if (!opts.forceRefresh) {
    const cached = getCachedResult(opts.url, mode, cacheDuration);
    if (cached) {
      console.log(`[DynamicPage] Cache hit: ${opts.url}`);
      return cached;
    }
  }
  
  const isDynamic = isLikelyDynamic(opts.url);
  
  if (!isDynamic && mode !== "xhr") {
    console.log(`[DynamicPage] Trying simple fetch first: ${opts.url}`);
    try {
      const jinaResult = await fetchViaJina(opts.url);
      if (jinaResult && jinaResult.content && jinaResult.content.length > 500) {
        const result: DynamicPageResult = {
          success: true,
          url: opts.url,
          urlFinal: opts.url,
          content: jinaResult.content,
          method: "jina",
          meta: {
            loadTimeMs: Date.now() - startTime,
            contentLength: jinaResult.content.length,
            project: opts.project
          }
        };
        setCachedResult(opts.url, mode, result);
        return result;
      }
    } catch (err) {
      console.log(`[DynamicPage] Simple fetch failed, falling back to browser: ${(err as Error).message}`);
    }
  }
  
  console.log(`[DynamicPage] Using browser for: ${opts.url}`);
  
  const request: BrowserCrawlRequest = {
    url: opts.url,
    profile: domainConfig?.profile,
    humanSimulation: opts.humanSimulation ?? domainConfig?.humanSimulation ?? false,
    waitForNetworkIdle: domainConfig?.waitForNetworkIdle ?? true,
    interceptXhr: opts.mode === "xhr" || domainConfig?.interceptXhr,
    timeout: opts.timeout || 30000,
    actions: opts.actions || domainConfig?.defaultActions,
    extract: {
      // Use "script" mode when there's an extractor script, otherwise default to html
      mode: mode === "auto" 
        ? ((opts.script || domainConfig?.extractorScript) ? "script" : "html")
        : mode as any,
      script: opts.script || domainConfig?.extractorScript,
      selectors: opts.selectors
    }
  };
  
  console.log(`[DynamicPage] Extract mode: ${request.extract?.mode}, hasScript: ${!!request.extract?.script}, originalMode: ${mode}`);
  
  const browserResult = await browserService.crawl(request);
  
  if (!browserResult.success) {
    console.log(`[DynamicPage] Browser failed: ${browserResult.error}`);
    
    try {
      console.log(`[DynamicPage] Trying Apify as final fallback...`);
      const apifyResult = await fetchViaApify(opts.url);
      if (apifyResult && apifyResult.content && apifyResult.content.length > 200) {
        const result: DynamicPageResult = {
          success: true,
          url: opts.url,
          urlFinal: opts.url,
          content: apifyResult.content,
          method: "apify",
          meta: {
            loadTimeMs: Date.now() - startTime,
            contentLength: apifyResult.content.length,
            project: opts.project
          }
        };
        setCachedResult(opts.url, mode, result);
        return result;
      }
    } catch {}
    
    return {
      success: false,
      url: opts.url,
      urlFinal: opts.url,
      content: "",
      method: "browser",
      error: browserResult.error,
      meta: {
        loadTimeMs: Date.now() - startTime,
        contentLength: 0,
        project: opts.project,
        profile: browserResult.meta.profile
      }
    };
  }
  
  let content = "";
  if (browserResult.text) {
    content = browserResult.text;
  } else if (browserResult.html) {
    const $ = cheerio.load(browserResult.html);
    $("script, style, noscript, iframe").remove();
    content = $("body").text().replace(/\s+/g, " ").trim();
  } else if (browserResult.data) {
    content = JSON.stringify(browserResult.data, null, 2);
  }
  
  const result: DynamicPageResult = {
    success: true,
    url: opts.url,
    urlFinal: browserResult.urlFinal,
    content,
    html: browserResult.html,
    data: browserResult.data,
    xhrData: browserResult.xhrData,
    method: "browser",
    meta: {
      loadTimeMs: browserResult.meta.loadTimeMs,
      contentLength: content.length,
      project: opts.project,
      profile: browserResult.meta.profile
    }
  };
  
  setCachedResult(opts.url, mode, result);
  return result;
}

export async function smartFetch(url: string): Promise<DynamicPageResult> {
  return fetchDynamicPage({ url, mode: "auto" });
}

export async function fetchWithExtractor(url: string, extractorScript: string): Promise<DynamicPageResult> {
  return fetchDynamicPage({ url, mode: "dom", script: extractorScript });
}

export async function fetchXhrData(url: string): Promise<DynamicPageResult> {
  return fetchDynamicPage({ url, mode: "xhr" });
}

export function getDynamicPageStats(): {
  cacheSize: number;
  cachedUrls: string[];
  domainConfigs: string[];
  dynamicDomains: string[];
} {
  return {
    cacheSize: pageCache.size,
    cachedUrls: Array.from(pageCache.keys()),
    domainConfigs: Object.keys(DOMAIN_CONFIGS),
    dynamicDomains: DYNAMIC_DOMAINS
  };
}

export function clearDynamicPageCache(): void {
  pageCache.clear();
  console.log("[DynamicPage] Cache cleared");
}
