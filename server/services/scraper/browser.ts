export interface BrowserCrawlResult {
  success: boolean;
  url: string;
  title?: string;
  html?: string;
  textContent?: string;
  htmlLength?: number;
  mode: 'browser';
  errorType?: 'captcha' | 'login_required' | 'timeout' | 'blocked' | 'unknown';
  error?: string;
  durationMs?: number;
}

interface CrawlOptions {
  waitForSelector?: string;
  timeoutMs?: number;
  blockAssets?: boolean;
  extractText?: boolean;
  extendedWaitMs?: number;
}

export function detectSPAIndicators(html: string): boolean {
  const spaIndicators = [
    /<div[^>]*id=["']root["'][^>]*>\s*<\/div>/i,
    /<div[^>]*id=["']app["'][^>]*>\s*<\/div>/i,
    /<div[^>]*id=["']__next["'][^>]*>/i,
    /window\.__INITIAL_STATE__/,
    /window\.__NUXT__/,
    /__NEXT_DATA__/,
    /react-root/,
    /ng-app/,
    /data-reactroot/
  ];
  
  return spaIndicators.some(pattern => pattern.test(html));
}

export async function crawlWithBrowser(
  url: string,
  options?: CrawlOptions
): Promise<BrowserCrawlResult> {
  console.log(`[BrowserCrawler] Browser crawling disabled - use Firecrawl/Jina instead: ${url}`);
  
  return {
    success: false,
    url,
    mode: 'browser',
    errorType: 'unknown',
    error: 'Browser crawling disabled in production. Use Firecrawl or Jina API instead.',
    durationMs: 0
  };
}

export async function closeBrowser(): Promise<void> {
  console.log('[BrowserCrawler] No browser to close (browser crawling disabled)');
}
