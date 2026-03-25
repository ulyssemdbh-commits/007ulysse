export async function crawlWithScreenshot(url: string, prompt: string): Promise<{
  success: boolean;
  analysis?: string;
  screenshotSize?: number;
  error?: string;
}> {
  console.warn("[ScreenshotCrawler] Service not available");
  return { success: false, error: "Screenshot crawler not available in this environment" };
}

export async function analyzeWebsiteViaScreenshot(url: string, prompt: string): Promise<{
  success: boolean;
  analysis?: string;
  screenshotSize?: number;
  error?: string;
}> {
  console.warn("[ScreenshotCrawler] Vision analysis not available");
  return { success: false, error: "Screenshot analysis not available in this environment" };
}
