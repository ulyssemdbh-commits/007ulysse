// services/scraperService.ts - SUPER ULYSSE + Jina fallback
// Version hybride : HTTP maison + Jina cloud optionnel pour JS

import * as cheerio from 'cheerio';
import { fetchViaJina } from '../webfetch';
import type {
  ScrapeRequest,
  ScrapeResult,
  ScrapedPage,
  ScrapeMode,
  SelectorConfig,
  LinkScope,
  ScraperProfile,
} from '../../types/scraper';

// ================================
// Configuration
// ================================

export const DEFAULT_USER_AGENT =
  'UlysseScraperBot/4.2 (+https://ulysseproject.org; contact: admin@local)';

export const REQUEST_TIMEOUT = 30000;
const RETRY_COUNT = 3;
const MIN_DELAY = 100;
const MAX_DELAY = 500;

const BLOCK_LOCALHOST_BY_DEFAULT = true;
const BLOCKED_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];

// ================================
// Profils prédéfinis
// ================================

export const SCRAPER_PROFILES: Record<string, ScraperProfile> = {
  default: {
    name: 'default',
    description: 'Profil par défaut, équilibré',
    defaults: {
      depth: 0,
      maxPages: 50,
      maxConcurrency: 3,
      linkScope: 'same-host',
      extract: { text: true, links: true, metadata: true },
    },
  },
  news: {
    name: 'news',
    description: 'Optimisé pour sites d\'actualités',
    defaults: {
      depth: 1,
      maxPages: 40,
      maxConcurrency: 4,
      linkScope: 'same-host',
      extract: { text: true, links: true, metadata: true },
    },
  },
  foot: {
    name: 'foot',
    description: 'Optimisé pour sites de football/classements',
    defaults: {
      mode: 'auto',
      depth: 1,
      maxPages: 60,
      maxConcurrency: 4,
      linkScope: 'same-host',
      extract: {
        text: true,
        links: true,
        metadata: true,
        selectors: {
          teams: {
            selector: '.participant__participantName, .team_name, .team',
            multi: true,
          },
          scores: {
            selector: '.detailScore__wrapper, .score',
            multi: true,
          },
          standings: {
            selector: '.ui-table__row, .standings__row, tr',
            multi: true,
          },
        },
      },
    },
  },
  ecommerce: {
    name: 'ecommerce',
    description: 'Optimisé pour sites e-commerce',
    defaults: {
      depth: 1,
      maxPages: 80,
      maxConcurrency: 5,
      linkScope: 'same-host',
      excludeExtensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf'],
      extract: {
        text: true,
        links: true,
        metadata: true,
        selectors: {
          products: {
            selector: '.product, .product-item, [data-product]',
            multi: true,
          },
          prices: {
            selector: '.price, .product-price, [data-price]',
            multi: true,
          },
          titles: {
            selector: '.product-title, .product-name, h2.title',
            multi: true,
          },
        },
      },
    },
  },
  flashscore: {
    name: 'flashscore',
    description: 'Profil spécifique Flashscore (Jina fallback)',
    defaults: {
      mode: 'browser',
      depth: 0,
      maxPages: 1,
      extract: {
        text: true,
        links: false,
        metadata: true,
      },
    },
  },
};

// ================================
// Utilitaires
// ================================

function basicHostCheck(url: string): void {
  if (!BLOCK_LOCALHOST_BY_DEFAULT) return;
  const host = new URL(url).hostname.toLowerCase();
  if (BLOCKED_HOSTS.includes(host)) {
    throw new Error(`Host "${host}" bloqué par sécurité.`);
  }
}

function applyProfileDefaults(req: ScrapeRequest): ScrapeRequest {
  const profile =
    SCRAPER_PROFILES[req.profile || 'default'] || SCRAPER_PROFILES.default;

  return {
    ...profile.defaults,
    ...req,
    extract: {
      ...profile.defaults.extract,
      ...req.extract,
      selectors: {
        ...(profile.defaults.extract?.selectors || {}),
        ...(req.extract?.selectors || {}),
      },
    },
  };
}

function normalizeUrl(base: string, href: string): string | null {
  try {
    if (
      !href ||
      href.startsWith('#') ||
      href.startsWith('javascript:') ||
      href.startsWith('mailto:')
    ) {
      return null;
    }
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function shouldFollowLink(
  currentUrl: string,
  targetUrl: string,
  scope: LinkScope | undefined
): boolean {
  if (!scope || scope === 'none') return false;

  try {
    const from = new URL(currentUrl);
    const to = new URL(targetUrl);

    switch (scope) {
      case 'same-domain':
        return (
          from.hostname.split('.').slice(-2).join('.') ===
          to.hostname.split('.').slice(-2).join('.')
        );
      case 'same-host':
        return from.hostname === to.hostname;
      case 'same-path':
        return (
          from.hostname === to.hostname &&
          to.pathname.startsWith(from.pathname)
        );
      case 'all':
        return true;
      default:
        return false;
    }
  } catch {
    return false;
  }
}

function isExtensionExcluded(url: string, exts?: string[]): boolean {
  if (!exts || exts.length === 0) return false;
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return exts.some((ext) => pathname.endsWith(ext.toLowerCase()));
  } catch {
    return false;
  }
}

function parseSelectorConfig(raw: string | SelectorConfig): SelectorConfig {
  if (typeof raw === 'string') return { selector: raw };
  return raw;
}

async function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function randomDelay(): Promise<void> {
  await delay(MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY));
}

// ================================
// HTTP Fetch avec retry (100% maison)
// ================================

export async function fetchWithRetry(
  url: string,
  userAgent: string,
  timeoutMs: number = REQUEST_TIMEOUT,
  maxBodySize?: number
): Promise<{ html: string; status: number; contentType: string } | null> {
  for (let attempt = 0; attempt < RETRY_COUNT; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        headers: {
          'User-Agent': userAgent,
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
        signal: controller.signal,
        redirect: 'follow',
      } as RequestInit);

      clearTimeout(timeoutId);

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter
          ? parseInt(retryAfter) * 1000
          : Math.pow(2, attempt) * 1000;
        console.log(`[Scraper] 429 (rate limit), attente ${waitTime}ms...`);
        await delay(waitTime);
        continue;
      }

      if (response.status >= 500) {
        console.log(`[Scraper] Erreur serveur (${response.status}), retry ${attempt + 1}/${RETRY_COUNT}`);
        await delay(Math.pow(2, attempt) * 1000);
        continue;
      }

      const contentLength = response.headers.get('content-length');
      if (maxBodySize && contentLength && parseInt(contentLength) > maxBodySize) {
        console.log(`[Scraper] Body trop gros: ${contentLength} > ${maxBodySize}`);
        return null;
      }

      const html = await response.text();
      const contentType = response.headers.get('content-type') || 'text/html';

      return { html, status: response.status, contentType };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log(`[Scraper] Timeout pour ${url}, retry ${attempt + 1}/${RETRY_COUNT}`);
      } else {
        console.error(`[Scraper] Erreur fetch (tentative ${attempt + 1}):`, error.message);
      }

      if (attempt < RETRY_COUNT - 1) {
        await delay(Math.pow(2, attempt) * 1000);
      }
    }
  }
  return null;
}

// ================================
// Extraction Cheerio
// ================================

function extractMetadata($: cheerio.CheerioAPI, url: string, contentType?: string) {
  const title =
    $('meta[property="og:title"]').attr('content') ||
    $('title').first().text().trim() ||
    undefined;

  const description =
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    undefined;

  const canonicalHref = $('link[rel="canonical"]').attr('href') || undefined;
  const canonical = canonicalHref
    ? normalizeUrl(url, canonicalHref) ?? canonicalHref
    : undefined;

  return {
    title,
    description,
    canonical,
    contentType,
  };
}

function extractWithCheerio(
  url: string,
  html: string,
  contentType: string | undefined,
  extract: ScrapeRequest['extract']
): ScrapedPage {
  const $ = cheerio.load(html);
  const page: ScrapedPage = {
    url,
    status: 200,
  };

  const $clean = cheerio.load(html);
  $clean('script, style, noscript, iframe, svg, head').remove();

  if (extract?.metadata !== false) {
    page.metadata = extractMetadata($, url, contentType);
  }

  if (extract?.text !== false) {
    page.text = $clean('body')
      .text()
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (extract?.html) {
    page.html = html;
  }

  if (extract?.links !== false) {
    const links: string[] = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      const absolute = href ? normalizeUrl(url, href) : null;
      if (absolute) links.push(absolute);
    });
    page.links = [...new Set(links)];
  }

  if (extract?.selectors) {
    const result: Record<string, any> = {};
    for (const [key, rawCfg] of Object.entries(extract.selectors)) {
      const cfg = parseSelectorConfig(rawCfg);
      try {
        const elements = $(cfg.selector);

        const getValue = (idx: number) => {
          const el = elements.eq(idx);
          if (cfg.attr) return el.attr(cfg.attr) ?? null;
          return el.text().trim();
        };

        if (elements.length === 0) {
          result[key] = cfg.multi ? [] : null;
        } else if (cfg.multi) {
          result[key] = elements
            .map((i) => getValue(i))
            .get()
            .filter((v) => v != null && String(v).trim() !== '');
        } else {
          result[key] = getValue(0);
        }
      } catch {
        result[key] = cfg.multi ? [] : null;
      }
    }
    page.extracted = result;
  }

  return page;
}

// ================================
// Détection JavaScript
// ================================

// Domaines connus pour charger du contenu via JavaScript
const JS_HEAVY_DOMAINS = [
  'eurotopteam.com',
  'flashscore',
  'transfermarkt',
  'sofascore',
  'whoscored',
  'fotmob',
  'livescore',
  'soccerway'
];

function isJavaScriptHeavy($: cheerio.CheerioAPI, text: string, url?: string): boolean {
  // Vérifier si le domaine est connu comme JS-heavy
  if (url) {
    const hostname = new URL(url).hostname.toLowerCase();
    if (JS_HEAVY_DOMAINS.some(domain => hostname.includes(domain))) {
      console.log(`[Scraper] Domaine JS-heavy détecté: ${hostname}`);
      return true;
    }
  }
  
  const hasLittleContent = text.length < 500;
  const hasReactRoot = $('#root, #app, #__next, [data-reactroot]').length > 0;
  const hasAngularRoot = $('[ng-app], [data-ng-app], app-root').length > 0;
  const hasVueRoot = $('#app[data-v-app], [data-v-]').length > 0;
  const hasNoscriptWarning = $('noscript').text().toLowerCase().includes('javascript');
  const hasLoadingIndicators = $('.loading, .spinner, [data-loading], .skeleton').length > 0;
  const hasFewElements = $('body *').length < 50;

  const isJsApp = hasReactRoot || hasAngularRoot || hasVueRoot;
  const seemsEmpty = hasLittleContent && (hasFewElements || hasLoadingIndicators);

  return (isJsApp && hasLittleContent) || hasNoscriptWarning || seemsEmpty;
}

// ================================
// Jina Fallback (gratuit, optionnel)
// ================================

async function fetchViaJinaFallback(url: string): Promise<ScrapedPage | null> {
  console.log(`[Scraper] Jina fallback pour: ${url}`);

  const jinaResult = await fetchViaJina(url);
  if (jinaResult && jinaResult.content.length > 100) {
    console.log(`[Scraper] Jina success: ${jinaResult.content.length} chars`);
    return {
      url,
      status: 200,
      metadata: { title: jinaResult.title, contentType: 'text/html' },
      text: jinaResult.content,
      links: extractLinksFromMarkdown(jinaResult.content),
    };
  }

  return null;
}

function extractLinksFromMarkdown(content: string): string[] {
  const linkRegex = /\[([^\]]*)\]\((https?:\/\/[^\)]+)\)/g;
  const links: string[] = [];
  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    links.push(match[2]);
  }
  return [...new Set(links)];
}

// ================================
// Queue interne pour le crawl
// ================================

interface QueueItem {
  url: string;
  depth: number;
}

// ================================
// Fonction principale SUPER ULYSSE
// ================================

export async function crawlAndScrape(req: ScrapeRequest): Promise<ScrapeResult> {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  const config = applyProfileDefaults(req);

  const {
    url,
    mode = 'auto',
    depth = 0,
    maxPages = 50,
    maxConcurrency = 3,
    userAgent = DEFAULT_USER_AGENT,
    linkScope = 'same-host',
    excludeExtensions,
    timeoutMs = REQUEST_TIMEOUT,
    maxBodySizeBytes,
    extract = { text: true, links: true, metadata: true },
  } = config;

  if (!url) {
    throw new Error('url is required');
  }

  basicHostCheck(url);

  console.log(`[Scraper] SUPER ULYSSE: ${url}, mode=${mode}, depth=${depth}, maxPages=${maxPages}`);

  const pages: ScrapedPage[] = [];
  const visited = new Set<string>();
  const queue: QueueItem[] = [{ url, depth: 0 }];
  const baseHost = new URL(url).hostname;

  let modeUsed: ScrapeMode = mode;
  let successCount = 0;
  let failCount = 0;
  let totalPageTime = 0;

  const shouldFollow = depth > 0;

  async function processItem(item: QueueItem): Promise<void> {
    if (visited.has(item.url) || pages.length >= maxPages) return;
    if (isExtensionExcluded(item.url, excludeExtensions)) return;

    visited.add(item.url);
    const pageStart = Date.now();

    try {
      let page: ScrapedPage | null = null;

      // Mode HTTP ou Auto : on essaie d'abord HTTP maison
      if (modeUsed === 'http' || modeUsed === 'auto') {
        const result = await fetchWithRetry(item.url, userAgent, timeoutMs, maxBodySizeBytes);

        if (result && result.status === 200) {
          const $ = cheerio.load(result.html);
          page = extractWithCheerio(item.url, result.html, result.contentType, extract);
          page.status = result.status;

          // Détection JS en mode auto → fallback Jina
          if (modeUsed === 'auto' && isJavaScriptHeavy($, page.text || '', item.url)) {
            console.log(`[Scraper] JS détecté, fallback Jina...`);
            modeUsed = 'browser';
            const jinaPage = await fetchViaJinaFallback(item.url);
            if (jinaPage) {
              page = jinaPage;
            }
          }
        } else if (result) {
          page = { url: item.url, status: result.status, error: `HTTP ${result.status}` };
        }
      }

      // Mode browser direct → Jina
      if (modeUsed === 'browser' && !page) {
        page = await fetchViaJinaFallback(item.url);
      }

      // Fallback Jina si HTTP échoue en mode auto
      if (!page && mode === 'auto') {
        console.log(`[Scraper] HTTP échoué, fallback Jina...`);
        modeUsed = 'browser';
        page = await fetchViaJinaFallback(item.url);
      }

      if (page) {
        page.timing = Date.now() - pageStart;
        totalPageTime += page.timing;
        pages.push(page);

        if (page.status === 200 && !page.error) {
          successCount++;

          // Ajouter les liens à la queue
          if (shouldFollow && item.depth < depth && page.links) {
            for (const link of page.links) {
              if (
                !visited.has(link) &&
                pages.length + queue.length < maxPages &&
                shouldFollowLink(url, link, linkScope) &&
                !isExtensionExcluded(link, excludeExtensions)
              ) {
                try {
                  if (new URL(link).hostname === baseHost) {
                    queue.push({ url: link, depth: item.depth + 1 });
                  }
                } catch {}
              }
            }
          }
        } else {
          failCount++;
        }
      } else {
        pages.push({
          url: item.url,
          status: 0,
          error: 'Toutes les méthodes ont échoué',
          timing: Date.now() - pageStart,
        });
        failCount++;
      }

      await randomDelay();
    } catch (error: any) {
      pages.push({
        url: item.url,
        status: 0,
        error: error.message,
        timing: Date.now() - pageStart,
      });
      failCount++;
    }
  }

  // Traitement concurrent de la queue
  while (queue.length > 0 && pages.length < maxPages) {
    const batch: QueueItem[] = [];
    while (batch.length < maxConcurrency && queue.length > 0) {
      const item = queue.shift();
      if (item && !visited.has(item.url)) {
        batch.push(item);
      }
    }

    if (batch.length > 0) {
      await Promise.all(batch.map(processItem));
    }
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startTime;

  console.log(`[Scraper] Terminé: ${pages.length} pages (${successCount} OK, ${failCount} KO) en ${durationMs}ms`);

  return {
    startedAt,
    finishedAt,
    modeUsed,
    url,
    pages,
    stats: {
      pagesCount: pages.length,
      successCount,
      failCount,
      durationMs,
      avgPageTime: pages.length > 0 ? Math.round(totalPageTime / pages.length) : 0,
    },
  };
}

// ================================
// Fonctions utilitaires exportées
// ================================

export async function scrapeWithSelectors(
  url: string,
  selectors: Record<string, string | SelectorConfig>
): Promise<{ success: boolean; data: Record<string, any> | null; error?: string }> {
  try {
    const result = await crawlAndScrape({
      url,
      mode: 'auto',
      depth: 0,
      maxPages: 1,
      extract: {
        text: false,
        links: false,
        metadata: true,
        selectors,
      },
    });

    if (result.pages.length > 0 && result.pages[0].status === 200) {
      return {
        success: true,
        data: result.pages[0].extracted || null,
      };
    }

    return {
      success: false,
      data: null,
      error: result.pages[0]?.error || 'No data extracted',
    };
  } catch (error: any) {
    return {
      success: false,
      data: null,
      error: error.message,
    };
  }
}

export async function scrapeWithProfile(
  url: string,
  profileName: string
): Promise<ScrapeResult> {
  return crawlAndScrape({
    url,
    profile: profileName,
  });
}

export function getAvailableProfiles(): ScraperProfile[] {
  return Object.values(SCRAPER_PROFILES);
}
