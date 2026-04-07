export async function crawlWithBrowser(url: string, options?: {
  waitForSelector?: string;
  timeoutMs?: number;
  blockAssets?: boolean;
  extractText?: boolean;
}): Promise<{ success: boolean; content?: string; error?: string }> {
  console.warn("[BrowserCrawler] Service not available - Puppeteer/Playwright not installed");
  return { success: false, error: "Browser crawler not available in this environment" };
}

export function getBrowserPoolStats(): { active: number; idle: number; total: number } {
  return { active: 0, idle: 0, total: 0 };
}
