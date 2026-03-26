/**
 * MARS - Multi-source Accurate Research System
 * Search Orchestrator: Parallel multi-engine search with result merging
 * 
 * Engines:
 * 1. Serper (Google) - snippets and organic results
 * 2. Perplexity Sonar - factual answers with citations
 * 3. Brave Search - fallback for resilience
 * 
 * Features:
 * - Parallel query dispatch
 * - Result normalization with ML-inspired scoring
 * - Engine-specific weighting
 * - Deduplication by URL
 * - Smart content extraction (static/dynamic detection)
 * - Intelligent caching with TTL
 * - Query rewriting for better results
 * - Source blacklist filtering
 * - Exponential retry with backoff
 * - Prometheus-ready metrics
 */

import { searchWeb, WebSearchResult, WebSearchResponse } from "./websearch";
import { smartFetch, fetchDynamicPage, DynamicPageResult } from "./dynamicPageService";
import { rateLimiterService } from "./rateLimiterService";
import { marsSearchCache } from "./marsSearchCache";
import { marsQueryRewriter, rewriteQuery } from "./marsQueryRewriter";
import { marsSourceBlacklist, filterResults as filterBlacklisted, evaluateSource } from "./marsSourceBlacklist";
import { marsMetrics } from "./marsMetrics";
import { marsResultScorer, scoreAndRankResults } from "./marsResultScorer";
import { searchBrave, normalizeBraveResults, getBraveStatus } from "./marsBraveSearch";
import { withRetry, withTimeoutAndRetry } from "./marsRetryHandler";

export interface EngineResult {
  engine: "serper" | "perplexity" | "brave";
  title: string;
  url: string;
  snippet: string;
  rank: number;
  score?: number;
  date?: string;
  citations?: string[];
  directAnswer?: string;
}

export interface OrchestratorResponse {
  results: EngineResult[];
  directAnswers: { engine: string; answer: string; citations: string[] }[];
  engineStats: {
    serper: { success: boolean; resultCount: number; timeMs: number };
    perplexity: { success: boolean; resultCount: number; timeMs: number };
    brave?: { success: boolean; resultCount: number; timeMs: number };
  };
  queryRewrite?: { original: string; rewritten: string; transformations: string[] };
  cacheHit: boolean;
  filteredCount: number;
  totalTime: number;
  success: boolean;
  error?: string;
}

interface PerplexityResponse {
  id: string;
  model: string;
  citations?: string[];
  choices: {
    message: {
      role: string;
      content: string;
    };
  }[];
}

async function searchPerplexity(query: string): Promise<{
  answer: string;
  citations: string[];
  success: boolean;
  error?: string;
}> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  
  if (!apiKey) {
    return {
      answer: "",
      citations: [],
      success: false,
      error: "PERPLEXITY_API_KEY not configured"
    };
  }

  try {
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          {
            role: "system",
            content: "Tu es un assistant de recherche factuel. Réponds de manière précise et concise en français. Cite tes sources. Ne fais pas d'approximations - si tu n'as pas l'information exacte, dis-le clairement."
          },
          {
            role: "user",
            content: query
          }
        ],
        temperature: 0.1,
        top_p: 0.9,
        return_images: true,
        return_related_questions: false,
        search_recency_filter: "week",
        stream: false,
        frequency_penalty: 1
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Perplexity API error: ${response.status} - ${errorText}`);
    }

    const data: PerplexityResponse = await response.json();
    
    const answer = data.choices?.[0]?.message?.content || "";
    const citations = data.citations || [];

    console.log(`[MARS:Perplexity] Query: "${query.substring(0, 50)}..." → ${citations.length} citations`);

    return {
      answer,
      citations,
      success: true
    };
  } catch (error) {
    console.error("[MARS:Perplexity] Error:", error);
    return {
      answer: "",
      citations: [],
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

function normalizeResults(
  serperResults: WebSearchResult[],
  perplexityCitations: string[],
  perplexityAnswer: string
): EngineResult[] {
  const results: EngineResult[] = [];
  const seenUrls = new Set<string>();

  for (let i = 0; i < serperResults.length; i++) {
    const r = serperResults[i];
    if (!seenUrls.has(r.url)) {
      seenUrls.add(r.url);
      results.push({
        engine: "serper",
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        rank: i + 1
      });
    }
  }

  for (let i = 0; i < perplexityCitations.length; i++) {
    const url = perplexityCitations[i];
    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      results.push({
        engine: "perplexity",
        title: extractTitleFromUrl(url),
        url,
        snippet: perplexityAnswer.substring(0, 200) + "...",
        rank: i + 1,
        citations: [url]
      });
    }
  }

  return results;
}

function extractTitleFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace("www.", "");
    return `Source: ${hostname}`;
  } catch {
    return "Source web";
  }
}

// Timeout wrapper pour les requêtes
async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => resolve(fallback), ms);
  });
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch {
    clearTimeout(timeoutId!);
    return fallback;
  }
}

// Circuit breaker simple pour Perplexity
let perplexityFailures = 0;
let perplexityLastFailure = 0;
const PERPLEXITY_MAX_FAILURES = 3;
const PERPLEXITY_COOLDOWN_MS = 60000; // 1 minute

function isPerplexityAvailable(): boolean {
  if (perplexityFailures >= PERPLEXITY_MAX_FAILURES) {
    if (Date.now() - perplexityLastFailure > PERPLEXITY_COOLDOWN_MS) {
      perplexityFailures = 0; // Reset après cooldown
      console.log(`[MARS:Perplexity] Circuit breaker reset après cooldown`);
      return true;
    }
    return false;
  }
  return true;
}

export async function orchestrateSearch(
  query: string,
  numResults: number = 10,
  options?: {
    queryType?: string;
    skipCache?: boolean;
    enableRewrite?: boolean;
  }
): Promise<OrchestratorResponse> {
  const startTime = Date.now();
  const SERPER_TIMEOUT = 5000;
  const PERPLEXITY_TIMEOUT = 6000;
  const BRAVE_TIMEOUT = 4000;
  
  const queryType = options?.queryType || 'default';
  const enableRewrite = options?.enableRewrite !== false;
  
  // ═══════════════════════════════════════════════════════════════════
  // STEP 1: Query Rewriting
  // ═══════════════════════════════════════════════════════════════════
  let effectiveQuery = query;
  let queryRewriteInfo: { original: string; rewritten: string; transformations: string[] } | undefined;
  
  if (enableRewrite) {
    const rewritten = rewriteQuery(query);
    if (rewritten.wasRewritten) {
      effectiveQuery = rewritten.rewritten;
      queryRewriteInfo = {
        original: query,
        rewritten: rewritten.rewritten,
        transformations: rewritten.transformations
      };
      marsMetrics.trackRewrite(true, rewritten.transformations.length);
    } else {
      marsMetrics.trackRewrite(false, 0);
    }
  }
  
  console.log(`[MARS:Orchestrator] Starting multi-engine search: "${effectiveQuery}"`);
  
  // ═══════════════════════════════════════════════════════════════════
  // STEP 2: Cache Check
  // ═══════════════════════════════════════════════════════════════════
  if (!options?.skipCache) {
    const cached = marsSearchCache.get(effectiveQuery, queryType);
    if (cached) {
      marsMetrics.trackCacheHit(true);
      const cachedResponse = cached.response as OrchestratorResponse;
      // Normalize cached response to include new fields (backward compatibility)
      return {
        ...cachedResponse,
        cacheHit: true,
        filteredCount: cachedResponse.filteredCount ?? 0,
        queryRewrite: cachedResponse.queryRewrite ?? queryRewriteInfo,
        totalTime: Date.now() - startTime
      };
    }
    marsMetrics.trackCacheHit(false);
  }

  // ═══════════════════════════════════════════════════════════════════
  // STEP 3: Parallel Engine Search with Retry
  // ═══════════════════════════════════════════════════════════════════
  const serperStart = Date.now();
  const serperPromise = withTimeoutAndRetry(
    () => searchWeb(effectiveQuery, numResults),
    SERPER_TIMEOUT,
    { service: 'serper', fallback: { results: [], success: false, error: "Timeout" } as any }
  );
  
  // Perplexity avec circuit breaker
  let perplexityPromise: Promise<{ data?: { answer: string; citations: string[]; success: boolean }; success: boolean }>;
  const perplexityEnabled = isPerplexityAvailable() && !!process.env.PERPLEXITY_API_KEY;
  let perplexityStart = 0;
  
  if (perplexityEnabled) {
    perplexityStart = Date.now();
    perplexityPromise = withTimeoutAndRetry(
      () => searchPerplexity(effectiveQuery),
      PERPLEXITY_TIMEOUT,
      { service: 'perplexity', fallback: { answer: "", citations: [], success: false } }
    ).then(result => {
      if (!result.success || !result.data?.success) {
        perplexityFailures++;
        perplexityLastFailure = Date.now();
      } else {
        perplexityFailures = 0;
      }
      return result;
    });
  } else {
    perplexityPromise = Promise.resolve({ data: { answer: "", citations: [], success: false }, success: true });
  }

  // Brave Search - exécuté en parallèle comme fallback
  const braveStart = Date.now();
  const bravePromise = withTimeoutAndRetry(
    () => searchBrave(effectiveQuery, Math.min(numResults, 5)),
    BRAVE_TIMEOUT,
    { service: 'brave', fallback: { results: [], query: effectiveQuery, success: false, error: "Timeout", timeMs: 0 } }
  );

  // Attendre tous les résultats en parallèle
  const [serperResult, perplexityResult, braveResult] = await Promise.all([
    serperPromise,
    perplexityPromise,
    bravePromise
  ]);
  
  const serperResponse = serperResult.data || { results: [], success: false, error: "No data" };
  const perplexityResponse = perplexityResult.data || { answer: "", citations: [], success: false };
  const braveResponse = braveResult.data || { results: [], success: false };
  
  const serperTime = Date.now() - serperStart;
  const perplexityTime = perplexityEnabled && perplexityStart > 0 ? Date.now() - perplexityStart : 0;
  const braveTime = Date.now() - braveStart;

  // Track metrics
  marsMetrics.trackSearch('serper', serperResponse.success, serperTime, serperResponse.results?.length || 0);
  marsMetrics.trackSearch('perplexity', perplexityResponse.success, perplexityTime, perplexityResponse.citations?.length || 0);
  marsMetrics.trackSearch('brave', braveResponse.success, braveTime, braveResponse.results?.length || 0);

  const engineStats = {
    serper: {
      success: serperResponse.success,
      resultCount: serperResponse.results?.length || 0,
      timeMs: serperTime
    },
    perplexity: {
      success: perplexityResponse.success,
      resultCount: perplexityResponse.citations?.length || 0,
      timeMs: perplexityTime
    },
    brave: {
      success: braveResponse.success,
      resultCount: braveResponse.results?.length || 0,
      timeMs: braveTime
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // STEP 4: Collect Direct Answers
  // ═══════════════════════════════════════════════════════════════════
  const directAnswers: { engine: string; answer: string; citations: string[] }[] = [];

  if (serperResponse.answer) {
    directAnswers.push({
      engine: "serper",
      answer: serperResponse.answer,
      citations: []
    });
  }

  if (perplexityResponse.success && perplexityResponse.answer) {
    directAnswers.push({
      engine: "perplexity",
      answer: perplexityResponse.answer,
      citations: perplexityResponse.citations
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // STEP 5: Normalize and Merge Results
  // ═══════════════════════════════════════════════════════════════════
  let results = normalizeResults(
    serperResponse.results || [],
    perplexityResponse.citations || [],
    perplexityResponse.answer || ""
  );
  
  // Add Brave results if available
  if (braveResponse.success && braveResponse.results?.length > 0) {
    const braveNormalized = normalizeBraveResults(braveResponse.results);
    results = [...results, ...braveNormalized];
  }

  // ═══════════════════════════════════════════════════════════════════
  // STEP 6: Filter Blacklisted Sources
  // ═══════════════════════════════════════════════════════════════════
  const beforeFilterCount = results.length;
  results = filterBlacklisted(results, { minQuality: 20, logFiltered: true });
  const filteredCount = beforeFilterCount - results.length;
  
  marsMetrics.trackSourceFilter(filteredCount, results.length, filteredCount);

  // ═══════════════════════════════════════════════════════════════════
  // STEP 7: ML-inspired Scoring and Ranking
  // ═══════════════════════════════════════════════════════════════════
  const scoredResults = scoreAndRankResults(
    results.map((r, i) => ({ 
      url: r.url, 
      title: r.title, 
      snippet: r.snippet, 
      rank: r.rank || i + 1 
    })),
    effectiveQuery,
    { minScore: 15, maxResults: numResults }
  );

  // Merge scores back into results
  const finalResults: EngineResult[] = scoredResults.map((scored, index) => {
    const original = results.find(r => r.url === scored.url) || results[index];
    return {
      ...original,
      score: scored.score,
      rank: scored.rank
    };
  });

  const totalTime = Date.now() - startTime;

  // Log summary
  const perplexityStatus = perplexityEnabled 
    ? (perplexityResponse.success ? `✓ ${engineStats.perplexity.resultCount} citations` : '✗ failed')
    : 'skipped';
  const braveStatus = braveResponse.success ? `✓ ${engineStats.brave?.resultCount}` : '✗';
  console.log(`[MARS:Orchestrator] Complete in ${totalTime}ms - Serper: ${engineStats.serper.resultCount}, Perplexity: ${perplexityStatus}, Brave: ${braveStatus}, Filtered: ${filteredCount}`);

  const response: OrchestratorResponse = {
    results: finalResults,
    directAnswers,
    engineStats,
    queryRewrite: queryRewriteInfo,
    cacheHit: false,
    filteredCount,
    totalTime,
    success: serperResponse.success || perplexityResponse.success || braveResponse.success,
    error: !serperResponse.success && !perplexityResponse.success && !braveResponse.success
      ? `All engines failed: Serper(${(serperResponse as any).error || 'unknown'}), Perplexity(${(perplexityResult as any).error || 'unknown'}), Brave(${(braveResponse as any).error || 'unknown'})`
      : undefined
  };

  // ═══════════════════════════════════════════════════════════════════
  // STEP 8: Cache the result
  // ═══════════════════════════════════════════════════════════════════
  if (response.success) {
    marsSearchCache.set(effectiveQuery, queryType, response);
  }

  return response;
}

export function formatOrchestratorResultsForAI(response: OrchestratorResponse): string {
  if (!response.success) {
    return `[MARS: Recherche échouée - ${response.error}]`;
  }

  let formatted = `### Résultats MARS (Multi-source Accurate Research)\n\n`;
  
  // Engine stats with Brave
  const braveCount = response.engineStats.brave?.resultCount || 0;
  formatted += `**Moteurs:** Serper(${response.engineStats.serper.resultCount}), Perplexity(${response.engineStats.perplexity.resultCount}), Brave(${braveCount})`;
  formatted += ` | **Temps:** ${response.totalTime}ms`;
  if (response.cacheHit) {
    formatted += ` | [Cache]`;
  }
  if (response.filteredCount && response.filteredCount > 0) {
    formatted += ` | ${response.filteredCount} filtrés`;
  }
  formatted += `\n\n`;
  
  // Query rewrite info
  if (response.queryRewrite) {
    formatted += `*Query optimisée: "${response.queryRewrite.rewritten}"*\n\n`;
  }

  if (response.directAnswers.length > 0) {
    formatted += `**Réponses directes:**\n`;
    for (const da of response.directAnswers) {
      formatted += `\n[${da.engine.toUpperCase()}]:\n${da.answer}\n`;
      if (da.citations.length > 0) {
        formatted += `Sources: ${da.citations.slice(0, 3).join(", ")}\n`;
      }
    }
    formatted += `\n`;
  }

  formatted += `**Sources web:**\n`;
  for (const result of response.results.slice(0, 10)) {
    const scoreStr = result.score ? ` (score: ${result.score})` : '';
    formatted += `\n**${result.title}** [${result.engine}]${scoreStr}\n`;
    formatted += `${result.snippet}\n`;
    formatted += `URL: ${result.url}\n`;
  }

  return formatted;
}

export interface SmartFetchResult {
  success: boolean;
  url: string;
  content: string;
  method: "browser" | "jina" | "apify" | "http" | "cached";
  loadTimeMs: number;
  contentLength: number;
  cached: boolean;
  error?: string;
}

export async function smartFetchContent(url: string, options?: {
  forceRefresh?: boolean;
  extractorScript?: string;
  timeout?: number;
  userId?: string;
}): Promise<SmartFetchResult> {
  const startTime = Date.now();
  
  const rateCheck = rateLimiterService.checkDomainLimit(url);
  if (!rateCheck.allowed) {
    console.log(`[MARS:SmartFetch] Rate limited: ${url} - ${rateCheck.reason}`);
    return {
      success: false,
      url,
      content: "",
      method: "http",
      loadTimeMs: Date.now() - startTime,
      contentLength: 0,
      cached: false,
      error: rateCheck.reason
    };
  }
  
  if (options?.userId) {
    const userCheck = rateLimiterService.checkUserLimit(options.userId);
    if (!userCheck.allowed) {
      return {
        success: false,
        url,
        content: "",
        method: "http",
        loadTimeMs: Date.now() - startTime,
        contentLength: 0,
        cached: false,
        error: `User rate limit exceeded (0 remaining)`
      };
    }
  }
  
  rateLimiterService.recordRequest(url, options?.userId);
  
  try {
    const result = await fetchDynamicPage({
      url,
      forceRefresh: options?.forceRefresh,
      script: options?.extractorScript,
      timeout: options?.timeout,
      mode: "auto"
    });
    
    if (result.success) {
      rateLimiterService.recordSuccess(url, result.meta.loadTimeMs);
      return {
        success: true,
        url,
        content: result.content,
        method: result.meta.cached ? "cached" : result.method,
        loadTimeMs: result.meta.loadTimeMs,
        contentLength: result.meta.contentLength,
        cached: result.meta.cached || false
      };
    } else {
      rateLimiterService.recordFailure(url, result.error || "Unknown error");
      return {
        success: false,
        url,
        content: "",
        method: result.method,
        loadTimeMs: result.meta.loadTimeMs,
        contentLength: 0,
        cached: false,
        error: result.error
      };
    }
  } catch (error) {
    const errorMsg = (error as Error).message;
    rateLimiterService.recordFailure(url, errorMsg);
    return {
      success: false,
      url,
      content: "",
      method: "http",
      loadTimeMs: Date.now() - startTime,
      contentLength: 0,
      cached: false,
      error: errorMsg
    };
  }
}

export async function batchSmartFetch(urls: string[], options?: {
  maxConcurrent?: number;
  timeout?: number;
}): Promise<SmartFetchResult[]> {
  const maxConcurrent = options?.maxConcurrent || 3;
  const results: SmartFetchResult[] = [];
  
  for (let i = 0; i < urls.length; i += maxConcurrent) {
    const batch = urls.slice(i, i + maxConcurrent);
    const batchResults = await Promise.all(
      batch.map(url => smartFetchContent(url, { timeout: options?.timeout }))
    );
    results.push(...batchResults);
  }
  
  return results;
}

export function getMARSStats() {
  return {
    rateLimiter: rateLimiterService.getStats(),
    cache: marsSearchCache.getStats(),
    metrics: marsMetrics.getSummary(),
    blacklist: marsSourceBlacklist.getBlacklistStats(),
    brave: getBraveStatus()
  };
}

export function getMARSMetricsPrometheus(): string {
  return marsMetrics.exportPrometheus();
}

export function getMARSMetricsJSON() {
  return marsMetrics.exportJSON();
}

export const searchOrchestratorService = {
  orchestrateSearch,
  formatOrchestratorResultsForAI,
  smartFetchContent,
  batchSmartFetch,
  getMARSStats,
  getMARSMetricsPrometheus,
  getMARSMetricsJSON
};

// Re-export utilities
export { marsSearchCache } from "./marsSearchCache";
export { marsQueryRewriter, rewriteQuery } from "./marsQueryRewriter";
export { marsSourceBlacklist, evaluateSource, filterResults as filterBlacklistedResults } from "./marsSourceBlacklist";
export { marsMetrics } from "./marsMetrics";
export { marsResultScorer, scoreAndRankResults } from "./marsResultScorer";
export { marsBraveSearch, searchBrave, getBraveStatus } from "./marsBraveSearch";
export { marsRetryHandler, withRetry, withTimeoutAndRetry } from "./marsRetryHandler";
