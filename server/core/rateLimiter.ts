/**
 * Rate Limiter - Per-domain rate limiting for web scraping
 * Prevents overwhelming target servers and respects robots.txt limits
 */

interface DomainRateState {
  domain: string;
  requestsInWindow: number;
  windowStart: number;
  lastRequest: number;
  blocked: boolean;
  blockedUntil?: number;
}

const rateStates = new Map<string, DomainRateState>();

const DEFAULT_RATE_LIMIT = 60; // requests per minute
const WINDOW_MS = 60000; // 1 minute
const BACKOFF_BASE_MS = 1000; // 1 second base backoff
const MAX_BACKOFF_MS = 30000; // 30 seconds max backoff

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function getOrCreateState(domain: string): DomainRateState {
  if (!rateStates.has(domain)) {
    rateStates.set(domain, {
      domain,
      requestsInWindow: 0,
      windowStart: Date.now(),
      lastRequest: 0,
      blocked: false,
    });
  }
  return rateStates.get(domain)!;
}

export function canMakeRequest(url: string, rateLimit: number = DEFAULT_RATE_LIMIT): boolean {
  const domain = extractDomain(url);
  const state = getOrCreateState(domain);
  const now = Date.now();

  if (state.blocked && state.blockedUntil && now < state.blockedUntil) {
    return false;
  }

  if (state.blocked && (!state.blockedUntil || now >= state.blockedUntil)) {
    state.blocked = false;
    state.blockedUntil = undefined;
  }

  if (now - state.windowStart > WINDOW_MS) {
    state.requestsInWindow = 0;
    state.windowStart = now;
  }

  return state.requestsInWindow < rateLimit;
}

export function recordRequest(url: string): void {
  const domain = extractDomain(url);
  const state = getOrCreateState(domain);
  const now = Date.now();

  if (now - state.windowStart > WINDOW_MS) {
    state.requestsInWindow = 0;
    state.windowStart = now;
  }

  state.requestsInWindow++;
  state.lastRequest = now;
}

export function recordRateLimitHit(url: string): void {
  const domain = extractDomain(url);
  const state = getOrCreateState(domain);
  const now = Date.now();

  const currentBackoff = state.blockedUntil 
    ? Math.min((state.blockedUntil - now) * 2, MAX_BACKOFF_MS)
    : BACKOFF_BASE_MS;

  state.blocked = true;
  state.blockedUntil = now + currentBackoff;

  console.log(`[RateLimiter] Domain ${domain} rate limited, backing off for ${currentBackoff}ms`);
}

export function getWaitTime(url: string, rateLimit: number = DEFAULT_RATE_LIMIT): number {
  const domain = extractDomain(url);
  const state = getOrCreateState(domain);
  const now = Date.now();

  if (state.blocked && state.blockedUntil && now < state.blockedUntil) {
    return state.blockedUntil - now;
  }

  if (now - state.windowStart > WINDOW_MS) {
    return 0;
  }

  if (state.requestsInWindow < rateLimit) {
    return 0;
  }

  return WINDOW_MS - (now - state.windowStart);
}

export async function waitForRateLimit(url: string, rateLimit: number = DEFAULT_RATE_LIMIT): Promise<void> {
  const waitTime = getWaitTime(url, rateLimit);
  if (waitTime > 0) {
    console.log(`[RateLimiter] Waiting ${waitTime}ms for ${extractDomain(url)}`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
}

export function getRateLimitStats(): {
  domains: number;
  blockedDomains: number;
  stats: Array<{
    domain: string;
    requestsInWindow: number;
    blocked: boolean;
    blockedUntil?: string;
  }>;
} {
  const stats = Array.from(rateStates.values()).map(state => ({
    domain: state.domain,
    requestsInWindow: state.requestsInWindow,
    blocked: state.blocked,
    blockedUntil: state.blockedUntil ? new Date(state.blockedUntil).toISOString() : undefined,
  }));

  return {
    domains: rateStates.size,
    blockedDomains: stats.filter(s => s.blocked).length,
    stats,
  };
}

export function clearRateLimitState(url?: string): void {
  if (url) {
    const domain = extractDomain(url);
    rateStates.delete(domain);
  } else {
    rateStates.clear();
  }
}
