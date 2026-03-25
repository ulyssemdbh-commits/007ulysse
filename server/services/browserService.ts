import { chromium, Browser, BrowserContext, Page } from "playwright";
import * as fs from "fs";
import * as path from "path";

export interface BrowserAction {
  type: "goto" | "waitForSelector" | "click" | "scroll" | "delay" | "type" | "screenshot" | "evaluate" | "waitForLoadState";
  url?: string;
  selector?: string;
  timeoutMs?: number;
  y?: number;
  ms?: number;
  text?: string;
  script?: string;
  state?: "load" | "domcontentloaded" | "networkidle";
}

export interface BrowserProfile {
  name: string;
  userAgent: string;
  viewport: { width: number; height: number };
  locale: string;
  timezoneId: string;
  deviceScaleFactor?: number;
  isMobile?: boolean;
  hasTouch?: boolean;
  colorScheme?: "light" | "dark";
  extraHTTPHeaders?: Record<string, string>;
}

export interface ExtractOptions {
  mode: "html" | "text" | "dom" | "script" | "xhr";
  script?: string;
  selectors?: string[];
}

export interface BrowserCrawlRequest {
  url: string;
  actions?: BrowserAction[];
  extract?: ExtractOptions;
  profile?: string;
  proxyGroup?: string;
  sessionId?: string;
  timeout?: number;
  waitForNetworkIdle?: boolean;
  interceptXhr?: boolean;
  humanSimulation?: boolean;
}

export interface BrowserCrawlResponse {
  success: boolean;
  statusCode?: number;
  urlFinal: string;
  html?: string;
  text?: string;
  data?: unknown;
  xhrData?: XhrCapture[];
  screenshot?: Buffer;
  error?: string;
  meta: {
    loadTimeMs: number;
    requests: number;
    consoleErrors: number;
    redirects: string[];
    blockedResources: number;
    profile: string;
  };
}

export interface XhrCapture {
  url: string;
  method: string;
  contentType?: string;
  responseBody?: unknown;
  statusCode: number;
}

const PROFILES: Record<string, BrowserProfile> = {
  default: {
    name: "Chrome Desktop FR",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    colorScheme: "light"
  },
  mobile: {
    name: "iPhone Safari",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    viewport: { width: 390, height: 844 },
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3
  },
  betting: {
    name: "Chrome Betting FR",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    colorScheme: "light",
    extraHTTPHeaders: {
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
    }
  },
  banking: {
    name: "Chrome Banking Secure",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    colorScheme: "light"
  },
  stealth: {
    name: "Chrome Stealth Mode",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1680, height: 1050 },
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    deviceScaleFactor: 2,
    colorScheme: "light"
  }
};

const DOMAIN_PROFILES: Record<string, string> = {
  "parionssport.fdj.fr": "betting",
  "winamax.fr": "betting",
  "betclic.fr": "betting",
  "unibet.fr": "betting",
  "pmu.fr": "betting",
  "zebet.fr": "betting",
  "bet365.com": "betting",
  "bwin.fr": "betting",
  "boursorama.com": "banking",
  "labanquepostale.fr": "banking",
  "credit-agricole.fr": "banking",
  "societegenerale.fr": "banking"
};

const SESSIONS_DIR = path.join(process.cwd(), "data", "browser-sessions");

class BrowserService {
  private browser: Browser | null = null;
  private requestCount: Map<string, number> = new Map();
  private lastRequestTime: Map<string, number> = new Map();
  private consoleErrors: string[] = [];
  
  async initialize(): Promise<void> {
    if (this.browser) return;
    
    try {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--disable-gpu",
          "--window-size=1920x1080",
          "--disable-blink-features=AutomationControlled"
        ]
      });
      console.log("[BrowserService] Browser initialized");
      
      if (!fs.existsSync(SESSIONS_DIR)) {
        fs.mkdirSync(SESSIONS_DIR, { recursive: true });
      }
    } catch (error) {
      console.error("[BrowserService] Failed to initialize browser:", error);
      throw error;
    }
  }
  
  async shutdown(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log("[BrowserService] Browser shutdown");
    }
  }
  
  getProfile(profileName: string): BrowserProfile {
    return PROFILES[profileName] || PROFILES.default;
  }
  
  getProfileForDomain(url: string): string {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      for (const [domain, profile] of Object.entries(DOMAIN_PROFILES)) {
        if (hostname.includes(domain)) {
          return profile;
        }
      }
    } catch {}
    return "default";
  }
  
  private async loadSession(sessionId: string): Promise<string | undefined> {
    const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);
    if (fs.existsSync(sessionPath)) {
      return sessionPath;
    }
    return undefined;
  }
  
  private async saveSession(context: BrowserContext, sessionId: string): Promise<void> {
    const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);
    await context.storageState({ path: sessionPath });
    console.log(`[BrowserService] Session saved: ${sessionId}`);
  }
  
  private async humanDelay(min: number = 100, max: number = 500): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min) + min);
    await new Promise(r => setTimeout(r, delay));
  }
  
  private async humanScroll(page: Page, targetY: number): Promise<void> {
    const steps = Math.floor(Math.random() * 3) + 2;
    const stepSize = targetY / steps;
    
    for (let i = 0; i < steps; i++) {
      await page.mouse.wheel(0, stepSize);
      await this.humanDelay(50, 150);
    }
  }
  
  private async humanMouseMove(page: Page): Promise<void> {
    const x = Math.floor(Math.random() * 800) + 100;
    const y = Math.floor(Math.random() * 600) + 100;
    await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 5) + 2 });
  }
  
  async crawl(request: BrowserCrawlRequest): Promise<BrowserCrawlResponse> {
    const startTime = Date.now();
    const meta = {
      loadTimeMs: 0,
      requests: 0,
      consoleErrors: 0,
      redirects: [] as string[],
      blockedResources: 0,
      profile: request.profile || this.getProfileForDomain(request.url)
    };
    
    if (!this.browser) {
      await this.initialize();
    }
    
    // Check if browser is still connected, reinitialize if needed
    if (this.browser && !this.browser.isConnected()) {
      console.log("[BrowserService] Browser disconnected, reinitializing...");
      this.browser = null;
      await this.initialize();
    }
    
    const profile = this.getProfile(meta.profile);
    const xhrCaptures: XhrCapture[] = [];
    this.consoleErrors = [];
    
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    
    try {
      const contextOptions: any = {
        userAgent: profile.userAgent,
        viewport: profile.viewport,
        locale: profile.locale,
        timezoneId: profile.timezoneId,
        deviceScaleFactor: profile.deviceScaleFactor || 1,
        isMobile: profile.isMobile || false,
        hasTouch: profile.hasTouch || false,
        colorScheme: profile.colorScheme || "light",
        extraHTTPHeaders: profile.extraHTTPHeaders || {}
      };
      
      if (request.sessionId) {
        const sessionPath = await this.loadSession(request.sessionId);
        if (sessionPath) {
          contextOptions.storageState = sessionPath;
          console.log(`[BrowserService] Using session: ${request.sessionId}`);
        }
      }
      
      context = await this.browser!.newContext(contextOptions);
      page = await context.newPage();
      
      page.on("console", msg => {
        if (msg.type() === "error") {
          this.consoleErrors.push(msg.text());
        }
      });
      
      page.on("request", () => {
        meta.requests++;
      });
      
      page.on("response", response => {
        if (response.status() >= 300 && response.status() < 400) {
          meta.redirects.push(response.url());
        }
      });
      
      if (request.interceptXhr) {
        page.on("response", async response => {
          const contentType = response.headers()["content-type"] || "";
          if (contentType.includes("application/json") || response.url().includes("/api/")) {
            try {
              const body = await response.json();
              xhrCaptures.push({
                url: response.url(),
                method: response.request().method(),
                contentType,
                responseBody: body,
                statusCode: response.status()
              });
            } catch {}
          }
        });
      }
      
      const timeout = request.timeout || 30000;
      
      await page.goto(request.url, {
        waitUntil: request.waitForNetworkIdle ? "networkidle" : "domcontentloaded",
        timeout
      });
      
      if (request.humanSimulation) {
        await this.humanDelay(500, 1500);
        await this.humanMouseMove(page);
        await this.humanDelay(200, 500);
      }
      
      if (request.actions && request.actions.length > 0) {
        for (const action of request.actions) {
          try {
            switch (action.type) {
              case "goto":
                if (action.url) {
                  await page.goto(action.url, { timeout: action.timeoutMs || timeout });
                }
                break;
                
              case "waitForSelector":
                if (action.selector) {
                  await page.waitForSelector(action.selector, { timeout: action.timeoutMs || 10000 });
                }
                break;
                
              case "waitForLoadState":
                await page.waitForLoadState(action.state || "networkidle", { timeout: action.timeoutMs || timeout });
                break;
                
              case "click":
                if (action.selector) {
                  if (request.humanSimulation) {
                    await this.humanDelay(100, 300);
                  }
                  await page.click(action.selector, { timeout: action.timeoutMs || 5000 });
                }
                break;
                
              case "scroll":
                if (action.y !== undefined) {
                  if (request.humanSimulation) {
                    await this.humanScroll(page, action.y);
                  } else {
                    await page.mouse.wheel(0, action.y);
                  }
                }
                break;
                
              case "delay":
                await new Promise(r => setTimeout(r, action.ms || 1000));
                break;
                
              case "type":
                if (action.selector && action.text) {
                  if (request.humanSimulation) {
                    await page.click(action.selector);
                    await this.humanDelay(50, 150);
                    for (const char of action.text) {
                      await page.keyboard.type(char, { delay: Math.random() * 50 + 30 });
                    }
                  } else {
                    await page.fill(action.selector, action.text);
                  }
                }
                break;
                
              case "evaluate":
                if (action.script) {
                  await page.evaluate(action.script);
                }
                break;
            }
          } catch (actionError) {
            console.warn(`[BrowserService] Action ${action.type} failed:`, (actionError as Error).message);
          }
        }
      }
      
      let result: BrowserCrawlResponse = {
        success: true,
        statusCode: 200,
        urlFinal: page.url(),
        meta,
        xhrData: request.interceptXhr ? xhrCaptures : undefined
      };
      
      const extract = request.extract || { mode: "html" };
      
      switch (extract.mode) {
        case "html":
          result.html = await page.content();
          break;
          
        case "text":
          result.text = await page.evaluate(() => document.body.innerText);
          break;
          
        case "dom":
          if (extract.selectors && extract.selectors.length > 0) {
            const data: Record<string, string[]> = {};
            for (const selector of extract.selectors) {
              data[selector] = await page.$$eval(selector, els => 
                els.map(el => el.textContent?.trim() || "")
              );
            }
            result.data = data;
          }
          break;
          
        case "script":
          if (extract.script) {
            result.data = await page.evaluate(extract.script);
          }
          break;
          
        case "xhr":
          result.data = xhrCaptures;
          break;
      }
      
      if (request.sessionId) {
        await this.saveSession(context, request.sessionId);
      }
      
      meta.loadTimeMs = Date.now() - startTime;
      meta.consoleErrors = this.consoleErrors.length;
      
      return result;
      
    } catch (error) {
      meta.loadTimeMs = Date.now() - startTime;
      meta.consoleErrors = this.consoleErrors.length;
      
      return {
        success: false,
        urlFinal: request.url,
        error: (error as Error).message,
        meta
      };
    } finally {
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
    }
  }
  
  async takeScreenshot(url: string, options?: {
    profile?: string;
    fullPage?: boolean;
    actions?: BrowserAction[];
    humanSimulation?: boolean;
  }): Promise<{ success: boolean; screenshot?: Buffer; error?: string }> {
    if (!this.browser) {
      await this.initialize();
    }
    
    const profileName = options?.profile || this.getProfileForDomain(url);
    const profile = this.getProfile(profileName);
    
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    
    try {
      context = await this.browser!.newContext({
        userAgent: profile.userAgent,
        viewport: profile.viewport,
        locale: profile.locale,
        timezoneId: profile.timezoneId
      });
      
      page = await context.newPage();
      
      await page.goto(url, {
        waitUntil: "networkidle",
        timeout: 30000
      });
      
      if (options?.humanSimulation) {
        await this.humanDelay(500, 1500);
        await this.humanMouseMove(page);
      }
      
      if (options?.actions) {
        for (const action of options.actions) {
          if (action.type === "scroll" && action.y) {
            await page.mouse.wheel(0, action.y);
            await this.humanDelay(200, 400);
          } else if (action.type === "delay" && action.ms) {
            await new Promise(r => setTimeout(r, action.ms));
          } else if (action.type === "click" && action.selector) {
            await page.click(action.selector).catch(() => {});
          }
        }
      }
      
      const screenshot = await page.screenshot({
        fullPage: options?.fullPage ?? false,
        type: "png"
      });
      
      return { success: true, screenshot };
      
    } catch (error) {
      return { success: false, error: (error as Error).message };
    } finally {
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
    }
  }
  
  getStats(): {
    isInitialized: boolean;
    profiles: string[];
    domainMappings: number;
    savedSessions: string[];
  } {
    let savedSessions: string[] = [];
    try {
      if (fs.existsSync(SESSIONS_DIR)) {
        savedSessions = fs.readdirSync(SESSIONS_DIR)
          .filter(f => f.endsWith(".json"))
          .map(f => f.replace(".json", ""));
      }
    } catch {}
    
    return {
      isInitialized: this.browser !== null,
      profiles: Object.keys(PROFILES),
      domainMappings: Object.keys(DOMAIN_PROFILES).length,
      savedSessions
    };
  }
}

export const browserService = new BrowserService();
