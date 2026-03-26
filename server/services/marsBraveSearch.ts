/**
 * MARS Brave Search - Third search engine for fallback resilience
 * 
 * Features:
 * - Brave Search API integration
 * - Free tier support (2000 requests/month)
 * - Independent privacy-focused results
 * - Fallback when Serper/Perplexity fail
 */

export interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
  age?: string;
  extra_snippets?: string[];
}

export interface BraveSearchResponse {
  results: BraveSearchResult[];
  query: string;
  success: boolean;
  error?: string;
  timeMs: number;
}

// Circuit breaker state
let braveFailures = 0;
let braveLastFailure = 0;
const BRAVE_MAX_FAILURES = 5;
const BRAVE_COOLDOWN_MS = 120000; // 2 minutes

/**
 * Check if Brave Search is available
 */
function isBraveAvailable(): boolean {
  if (braveFailures >= BRAVE_MAX_FAILURES) {
    if (Date.now() - braveLastFailure > BRAVE_COOLDOWN_MS) {
      braveFailures = 0;
      console.log(`[MARS:Brave] Circuit breaker reset après cooldown`);
      return true;
    }
    return false;
  }
  return true;
}

/**
 * Record a failure
 */
function recordFailure(): void {
  braveFailures++;
  braveLastFailure = Date.now();
  console.log(`[MARS:Brave] Failure recorded (${braveFailures}/${BRAVE_MAX_FAILURES})`);
}

/**
 * Record a success
 */
function recordSuccess(): void {
  if (braveFailures > 0) {
    braveFailures = Math.max(0, braveFailures - 1);
  }
}

/**
 * Search using Brave Search API
 */
export async function searchBrave(
  query: string,
  numResults: number = 10,
  options?: {
    country?: string;
    freshness?: 'pd' | 'pw' | 'pm' | 'py'; // day, week, month, year
    safesearch?: 'off' | 'moderate' | 'strict';
  }
): Promise<BraveSearchResponse> {
  const startTime = Date.now();
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;

  // No API key - graceful fallback
  if (!apiKey) {
    return {
      results: [],
      query,
      success: false,
      error: 'BRAVE_SEARCH_API_KEY not configured',
      timeMs: 0
    };
  }

  // Circuit breaker check
  if (!isBraveAvailable()) {
    return {
      results: [],
      query,
      success: false,
      error: 'Circuit breaker active - too many failures',
      timeMs: 0
    };
  }

  try {
    const params = new URLSearchParams({
      q: query,
      count: numResults.toString(),
      country: options?.country || 'fr',
      search_lang: 'fr',
      safesearch: options?.safesearch || 'moderate',
      text_decorations: 'false',
      spellcheck: 'true'
    });

    if (options?.freshness) {
      params.append('freshness', options.freshness);
    }

    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey
      }
    });

    const timeMs = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      recordFailure();
      console.error(`[MARS:Brave] API error: ${response.status} - ${errorText}`);
      return {
        results: [],
        query,
        success: false,
        error: `API error: ${response.status}`,
        timeMs
      };
    }

    const data = await response.json();

    // Extract web results
    const webResults = data.web?.results || [];
    const results: BraveSearchResult[] = webResults.map((r: any) => ({
      title: r.title || '',
      url: r.url || '',
      description: r.description || '',
      age: r.age,
      extra_snippets: r.extra_snippets
    }));

    recordSuccess();
    console.log(`[MARS:Brave] Query: "${query.substring(0, 40)}..." → ${results.length} results in ${timeMs}ms`);

    return {
      results,
      query,
      success: true,
      timeMs
    };
  } catch (error) {
    const timeMs = Date.now() - startTime;
    recordFailure();
    console.error(`[MARS:Brave] Error:`, error);
    return {
      results: [],
      query,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timeMs
    };
  }
}

/**
 * Convert Brave results to MARS engine result format
 */
export function normalizeBraveResults(braveResults: BraveSearchResult[]): Array<{
  engine: 'brave';
  title: string;
  url: string;
  snippet: string;
  rank: number;
}> {
  return braveResults.map((r, index) => ({
    engine: 'brave' as const,
    title: r.title,
    url: r.url,
    snippet: r.extra_snippets?.join(' ') || r.description,
    rank: index + 1
  }));
}

/**
 * Get Brave Search status
 */
export function getBraveStatus(): {
  available: boolean;
  configured: boolean;
  failures: number;
  lastFailure: number | null;
} {
  return {
    available: isBraveAvailable(),
    configured: !!process.env.BRAVE_SEARCH_API_KEY,
    failures: braveFailures,
    lastFailure: braveLastFailure > 0 ? braveLastFailure : null
  };
}

/**
 * Reset circuit breaker (for testing)
 */
export function resetBraveCircuitBreaker(): void {
  braveFailures = 0;
  braveLastFailure = 0;
}

export const marsBraveSearch = {
  searchBrave,
  normalizeBraveResults,
  getBraveStatus,
  resetBraveCircuitBreaker
};
