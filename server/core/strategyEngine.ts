/**
 * Strategy Engine v2 - Orchestration intelligente des stratégies de scraping
 * - Multi-stratégies (HTTP / Playwright / Jina / Firecrawl / Apify / Perplexity)
 * - Apprentissage par domaine (domainProfileService)
 * - Scoring qualité (qualityScoring)
 * - Rate limiting par domaine
 * - Analytics et statistiques
 */

import * as cheerio from 'cheerio';
import {
  RenderStrategy,
  SmartCrawlRequest,
  SmartCrawlResult,
  StrategyResult,
  StrategyConfig,
  getEnabledStrategies,
} from './strategyTypes';
import { getDomainProfile, updateDomainProfile, getBestStrategy } from './domainProfileService';
import { calculateQualityScore, detectSPAIndicators, estimateJsRequirement } from './qualityScoring';
import { fetchViaJina, fetchViaFirecrawl, fetchViaApify, fetchViaPerplexity } from '../services/webfetch';
import { fetchWithRetry, DEFAULT_USER_AGENT } from '../services/scraper/core';
import { canMakeRequest, recordRequest, recordRateLimitHit, waitForRateLimit } from './rateLimiter';
import { recordStrategyAttempt } from './strategyAnalytics';

const DEFAULT_MIN_QUALITY = 0.3;
const DEFAULT_TIMEOUT = 30000;

interface RawStrategyResult {
  title: string;
  content: string;
  html: string;
  success: boolean;
  error?: string;
  finalUrl?: string;
  metadata?: {
    description?: string;
    author?: string;
    publishDate?: string;
    language?: string;
    canonical?: string;
    ogImage?: string;
  };
  links?: string[];
}

function extractMetadata(html: string, url: string): RawStrategyResult['metadata'] {
  if (!html) return undefined;
  
  try {
    const $ = cheerio.load(html);
    
    return {
      description: $('meta[name="description"]').attr('content') ||
                   $('meta[property="og:description"]').attr('content') || undefined,
      author: $('meta[name="author"]').attr('content') ||
              $('meta[property="article:author"]').attr('content') || undefined,
      publishDate: $('meta[property="article:published_time"]').attr('content') ||
                   $('meta[name="date"]').attr('content') ||
                   $('time[datetime]').first().attr('datetime') || undefined,
      language: $('html').attr('lang') ||
                $('meta[http-equiv="content-language"]').attr('content') || undefined,
      canonical: $('link[rel="canonical"]').attr('href') || undefined,
      ogImage: $('meta[property="og:image"]').attr('content') ||
               $('meta[name="twitter:image"]').attr('content') || undefined,
    };
  } catch {
    return undefined;
  }
}

function extractLinks(html: string, baseUrl: string): string[] {
  if (!html) return [];
  
  try {
    const $ = cheerio.load(html);
    const links: string[] = [];
    const seen = new Set<string>();
    
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      
      try {
        const absoluteUrl = new URL(href, baseUrl).href;
        if (!seen.has(absoluteUrl) && absoluteUrl.startsWith('http')) {
          seen.add(absoluteUrl);
          links.push(absoluteUrl);
        }
      } catch {
      }
    });
    
    return links.slice(0, 100);
  } catch {
    return [];
  }
}

function extractTablesAsMarkdown($: cheerio.CheerioAPI): string {
  const tables: string[] = [];
  
  $('table').each((_, table) => {
    const rows: string[][] = [];
    
    $(table).find('tr').each((_, tr) => {
      const cells: string[] = [];
      $(tr).find('td, th').each((_, cell) => {
        const text = $(cell).text().trim().replace(/\s+/g, ' ');
        cells.push(text);
      });
      if (cells.length > 0 && cells.some(c => c.length > 0)) {
        rows.push(cells);
      }
    });
    
    if (rows.length > 1) {
      const maxCols = Math.max(...rows.map(r => r.length));
      const normalizedRows = rows.map(row => {
        while (row.length < maxCols) row.push('');
        return row;
      });
      
      let markdownTable = '';
      normalizedRows.forEach((row, idx) => {
        markdownTable += '| ' + row.join(' | ') + ' |\n';
        if (idx === 0) {
          markdownTable += '|' + row.map(() => '---').join('|') + '|\n';
        }
      });
      
      if (markdownTable.length > 50) {
        tables.push(markdownTable);
      }
    }
  });
  
  return tables.join('\n\n');
}

function extractContentWithTables($: cheerio.CheerioAPI): string {
  const tableMarkdowns: string[] = [];
  
  $('table').each((idx, table) => {
    const rows: string[][] = [];
    
    $(table).find('tr').each((_, tr) => {
      const cells: string[] = [];
      $(tr).find('td, th').each((_, cell) => {
        const text = $(cell).text().trim().replace(/\s+/g, ' ');
        cells.push(text);
      });
      if (cells.length > 0 && cells.some(c => c.length > 0)) {
        rows.push(cells);
      }
    });
    
    if (rows.length > 1) {
      const maxCols = Math.max(...rows.map(r => r.length));
      const normalizedRows = rows.map(row => {
        while (row.length < maxCols) row.push('');
        return row;
      });
      
      let markdownTable = '';
      normalizedRows.forEach((row, rowIdx) => {
        markdownTable += '| ' + row.join(' | ') + ' |\n';
        if (rowIdx === 0) {
          markdownTable += '|' + row.map(() => '---').join('|') + '|\n';
        }
      });
      
      if (markdownTable.length > 50) {
        tableMarkdowns.push(markdownTable);
        $(table).replaceWith(`\n[TABLE_${idx}]\n`);
      } else {
        $(table).remove();
      }
    } else {
      $(table).remove();
    }
  });
  
  $('script, style, nav, footer, header, aside, .sidebar, .ads, .advertisement, [role="navigation"], [role="banner"]').remove();
  
  const mainContent = $('article, main, [role="main"], .content, .post-content, .article-content, .entry-content').first();
  let textContent = mainContent.length > 0 
    ? mainContent.text() 
    : $('body').text();
  
  textContent = textContent
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();
  
  tableMarkdowns.forEach((md, idx) => {
    textContent = textContent.replace(`[TABLE_${idx}]`, '\n\n' + md + '\n');
  });
  
  const hasRemainingPlaceholders = /\[TABLE_\d+\]/.test(textContent);
  if (!hasRemainingPlaceholders && tableMarkdowns.length > 0) {
    textContent = textContent + '\n\n---\n**TABLEAUX EXTRAITS:**\n\n' + tableMarkdowns.join('\n\n');
  }
  
  return textContent;
}

/* -------------------------------------------------------------------------- */
/*                               STRATÉGIES RAW                               */
/* -------------------------------------------------------------------------- */

async function executeHttpStrategy(url: string, timeout: number): Promise<RawStrategyResult> {
  try {
    await waitForRateLimit(url);
    recordRequest(url);
    
    const result = await fetchWithRetry(url, DEFAULT_USER_AGENT, timeout);
    
    if (result?.status === 429) {
      recordRateLimitHit(url);
      return { 
        title: '', 
        content: '', 
        html: '', 
        success: false, 
        error: 'Rate limited (429)',
        finalUrl: result?.finalUrl || url,
      };
    }
    
    if (!result || result.status !== 200 || !result.html) {
      return { 
        title: '', 
        content: '', 
        html: '', 
        success: false, 
        error: `HTTP ${result?.status || 'failed'}`,
        finalUrl: result?.finalUrl || url,
      };
    }

    const $ = cheerio.load(result.html);
    
    const title = $('title').first().text().trim() ||
                  $('meta[property="og:title"]').attr('content') ||
                  $('h1').first().text().trim() ||
                  url;

    const $forTables = cheerio.load(result.html);
    const textContent = extractContentWithTables($forTables);

    return {
      title,
      content: textContent,
      html: result.html,
      success: textContent.length > 100,
      finalUrl: result.finalUrl || url,
      metadata: extractMetadata(result.html, url),
      links: extractLinks(result.html, result.finalUrl || url),
    };
  } catch (error: any) {
    return { title: '', content: '', html: '', success: false, error: error.message, finalUrl: url };
  }
}

async function executeJinaStrategy(url: string): Promise<RawStrategyResult> {
  try {
    const result = await fetchViaJina(url);
    if (!result || !result.content) {
      return { title: '', content: '', html: '', success: false, error: 'Jina returned no content', finalUrl: url };
    }
    return {
      title: result.title,
      content: result.content,
      html: '',
      success: result.content.length > 100,
      finalUrl: result.finalUrl || url,
    };
  } catch (error: any) {
    return { title: '', content: '', html: '', success: false, error: error.message, finalUrl: url };
  }
}

async function executePlaywrightStrategy(url: string, timeout: number): Promise<RawStrategyResult> {
  try {
    await waitForRateLimit(url);
    recordRequest(url);
    
    const { crawlWithBrowser } = await import('../services/browserCrawler');
    const result = await crawlWithBrowser(url, { timeoutMs: timeout });
    
    if (!result.success || !result.html) {
      return { title: '', content: '', html: '', success: false, error: result.error || 'Playwright failed', finalUrl: result.finalUrl || url };
    }

    const $ = cheerio.load(result.html);
    
    const title = $('title').first().text().trim() || 
                  $('meta[property="og:title"]').attr('content') ||
                  $('h1').first().text().trim() ||
                  url;

    const $forTables = cheerio.load(result.html);
    const textContent = extractContentWithTables($forTables);

    return {
      title,
      content: textContent,
      html: result.html,
      success: textContent.length > 100,
      finalUrl: result.finalUrl || url,
      metadata: extractMetadata(result.html, url),
      links: extractLinks(result.html, result.finalUrl || url),
    };
  } catch (error: any) {
    return { title: '', content: '', html: '', success: false, error: error.message, finalUrl: url };
  }
}

async function executeFirecrawlStrategy(url: string): Promise<RawStrategyResult> {
  try {
    const result = await fetchViaFirecrawl(url);
    if (!result || !result.content) {
      return { title: '', content: '', html: '', success: false, error: 'Firecrawl returned no content', finalUrl: url };
    }
    return {
      title: result.title,
      content: result.content,
      html: '',
      success: result.content.length > 100,
      finalUrl: result.finalUrl || url,
    };
  } catch (error: any) {
    return { title: '', content: '', html: '', success: false, error: error.message, finalUrl: url };
  }
}

async function executeApifyStrategy(url: string): Promise<RawStrategyResult> {
  try {
    const result = await fetchViaApify(url);
    if (!result || !result.content) {
      return { title: '', content: '', html: '', success: false, error: 'Apify returned no content', finalUrl: url };
    }
    return {
      title: result.title,
      content: result.content,
      html: '',
      success: result.content.length > 100,
      finalUrl: result.finalUrl || url,
    };
  } catch (error: any) {
    return { title: '', content: '', html: '', success: false, error: error.message, finalUrl: url };
  }
}

async function executePerplexityStrategy(url: string): Promise<RawStrategyResult> {
  try {
    const result = await fetchViaPerplexity(url);
    if (!result || !result.content) {
      return { title: '', content: '', html: '', success: false, error: 'Perplexity returned no content', finalUrl: url };
    }
    return {
      title: result.title,
      content: result.content,
      html: '',
      success: result.content.length > 100,
      finalUrl: result.finalUrl || url,
    };
  } catch (error: any) {
    return { title: '', content: '', html: '', success: false, error: error.message, finalUrl: url };
  }
}

async function executeStrategy(
  strategy: RenderStrategy,
  url: string,
  timeout: number,
): Promise<RawStrategyResult> {
  switch (strategy) {
    case 'http':
      return executeHttpStrategy(url, timeout);
    case 'jina':
      return executeJinaStrategy(url);
    case 'playwright':
      return executePlaywrightStrategy(url, timeout);
    case 'firecrawl':
      return executeFirecrawlStrategy(url);
    case 'apify':
      return executeApifyStrategy(url);
    case 'perplexity':
      return executePerplexityStrategy(url);
    default:
      return { title: '', content: '', html: '', success: false, error: `Unknown strategy: ${strategy}`, finalUrl: url };
  }
}

/* -------------------------------------------------------------------------- */
/*                               SMART CRAWL V2                               */
/* -------------------------------------------------------------------------- */

export async function smartCrawl(
  request: SmartCrawlRequest,
): Promise<SmartCrawlResult> {
  const startTime = Date.now();
  const url = request.url;
  const timeout = request.timeoutMs || DEFAULT_TIMEOUT;
  const minQuality = request.qualityThreshold ?? DEFAULT_MIN_QUALITY;

  const strategiesAttempted: StrategyResult[] = [];
  const timingPerStrategy: Partial<Record<RenderStrategy, number>> = {};

  let bestResult: {
    title: string;
    content: string;
    html: string;
    qualityScore: number;
    strategy: RenderStrategy;
    finalUrl: string;
    metadata?: RawStrategyResult['metadata'];
    links?: string[];
  } | null = null;

  const domainProfile = await getDomainProfile(url);

  // Déterminer la liste de stratégies à essayer
  let strategiesToTry: RenderStrategy[];

  if (request.forceStrategy) {
    strategiesToTry = [request.forceStrategy];
  } else {
    const enabledConfigs = getEnabledStrategies();
    const enabledStrategies = enabledConfigs.map((c) => c.strategy);

    if (domainProfile.successCount > 0 && domainProfile.lastSuccessStrategy) {
      // On commence par la dernière stratégie qui a fonctionné
      strategiesToTry = [domainProfile.lastSuccessStrategy];

      // On ajoute les autres stratégies actives qui ne sont pas marquées comme "failed" pour ce domaine
      for (const s of enabledStrategies) {
        if (
          !strategiesToTry.includes(s) &&
          !domainProfile.failedStrategies.includes(s)
        ) {
          strategiesToTry.push(s);
        }
      }
    } else {
      // Pas encore de connaissance de domaine → on tente toutes les stratégies actives
      strategiesToTry = enabledStrategies;
    }
  }

  console.log(
    `[StrategyEngine] Crawling ${url} - strategies to try: ${strategiesToTry.join(", ")}`,
  );

  for (const strategy of strategiesToTry) {
    const strategyStart = Date.now();

    try {
      console.log(`[StrategyEngine] Trying ${strategy} for ${url}`);

      const raw = await executeStrategy(strategy, url, timeout);
      const duration = Date.now() - strategyStart;
      timingPerStrategy[strategy] = duration;

      const { score: qualityScore, metrics } = calculateQualityScore(
        raw.content,
        raw.html,
        raw.finalUrl || url,
      );

      const strategyResult: StrategyResult = {
        strategy,
        success: raw.success && qualityScore >= minQuality,
        contentLength: raw.content?.length || 0,
        qualityScore,
        durationMs: duration,
        error: raw.error,
      };
      strategiesAttempted.push(strategyResult);

      console.log(
        `[StrategyEngine] ${strategy}: success=${raw.success}, quality=${qualityScore.toFixed(2)}, length=${raw.content?.length || 0}, time=${duration}ms`,
      );

      const finalUrl = raw.finalUrl || url;

      // Record analytics
      recordStrategyAttempt(strategy, raw.success && qualityScore >= minQuality, qualityScore);

      // Si succès et qualité suffisante → on s'arrête là
      if (raw.success && qualityScore >= minQuality) {
        bestResult = {
          title: raw.title,
          content: raw.content,
          html: raw.html,
          qualityScore,
          strategy,
          finalUrl,
          metadata: raw.metadata,
          links: raw.links,
        };

        const jsDetected =
          metrics.jsDetected ||
          (!!raw.html && detectSPAIndicators(raw.html));

        await updateDomainProfile(finalUrl, strategy, true, qualityScore, jsDetected);
        break;
      }

      // Sinon, on garde le meilleur résultat vu jusqu'ici
      if (!bestResult || qualityScore > bestResult.qualityScore) {
        bestResult = {
          title: raw.title,
          content: raw.content,
          html: raw.html,
          qualityScore,
          strategy,
          finalUrl,
          metadata: raw.metadata,
          links: raw.links,
        };
      }

      const jsDetected = raw.html
        ? estimateJsRequirement(raw.html, raw.content)
        : false;

      await updateDomainProfile(raw.finalUrl || url, strategy, false, qualityScore, jsDetected);
    } catch (error: any) {
      const duration = Date.now() - strategyStart;
      timingPerStrategy[strategy] = duration;

      strategiesAttempted.push({
        strategy,
        success: false,
        contentLength: 0,
        qualityScore: 0,
        durationMs: duration,
        error: error.message,
      });

      recordStrategyAttempt(strategy, false, 0);

      console.error(
        `[StrategyEngine] ${strategy} failed for ${url}:`,
        error.message,
      );
      await updateDomainProfile(url, strategy, false, 0, false);
    }
  }

  const totalTime = Date.now() - startTime;
  const updatedProfile = await getDomainProfile(url);
  const finalBest = bestResult;

  if (
    finalBest &&
    (finalBest.qualityScore >= minQuality || finalBest.content.length > 100)
  ) {
    return {
      url,
      finalUrl: finalBest.finalUrl,
      success: true,
      strategyUsed: finalBest.strategy,
      strategiesAttempted,
      title: finalBest.title,
      content: finalBest.content,
      contentLength: finalBest.content.length,
      qualityScore: finalBest.qualityScore,
      metadata: request.extractMetadata !== false ? finalBest.metadata : undefined,
      links: request.extractLinks ? finalBest.links : undefined,
      timing: {
        totalMs: totalTime,
        perStrategy: timingPerStrategy,
      },
      domainProfile: updatedProfile,
    };
  }

  return {
    url,
    finalUrl: finalBest?.finalUrl || url,
    success: false,
    strategyUsed: strategiesAttempted[0]?.strategy || "http",
    strategiesAttempted,
    title: finalBest?.title || "",
    content: finalBest?.content || "",
    contentLength: finalBest?.content?.length || 0,
    qualityScore: finalBest?.qualityScore || 0,
    metadata: request.extractMetadata !== false ? finalBest?.metadata : undefined,
    links: request.extractLinks ? finalBest?.links : undefined,
    timing: {
      totalMs: totalTime,
      perStrategy: timingPerStrategy,
    },
    domainProfile: updatedProfile,
    error: `All ${strategiesAttempted.length} strategies failed to extract quality content`,
  };
}

/* -------------------------------------------------------------------------- */
/*                          TEST DE TOUTES LES STRATÉGIES                     */
/* -------------------------------------------------------------------------- */

export async function testAllStrategies(url: string): Promise<{
  url: string;
  results: Array<{
    strategy: RenderStrategy;
    success: boolean;
    contentLength: number;
    qualityScore: number;
    durationMs: number;
    preview: string;
    error?: string;
  }>;
}> {
  const enabledStrategies = getEnabledStrategies();

  const results: Array<{
    strategy: RenderStrategy;
    success: boolean;
    contentLength: number;
    qualityScore: number;
    durationMs: number;
    preview: string;
    error?: string;
  }> = [];

  for (const config of enabledStrategies) {
    const start = Date.now();
    try {
      const raw = await executeStrategy(
        config.strategy,
        url,
        config.timeoutMs ?? DEFAULT_TIMEOUT,
      );
      const duration = Date.now() - start;
      const { score } = calculateQualityScore(
        raw.content,
        raw.html,
        raw.finalUrl || url,
      );

      results.push({
        strategy: config.strategy,
        success: raw.success,
        contentLength: raw.content?.length || 0,
        qualityScore: score,
        durationMs: duration,
        preview: raw.content?.substring(0, 200) || "",
        error: raw.error,
      });
    } catch (error: any) {
      results.push({
        strategy: config.strategy,
        success: false,
        contentLength: 0,
        qualityScore: 0,
        durationMs: Date.now() - start,
        preview: "",
        error: error.message,
      });
    }
  }

  return { url, results };
}
