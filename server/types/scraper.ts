export type ScrapeMode = 'auto' | 'http' | 'browser';
export type LinkScope = 'same-domain' | 'same-host' | 'same-path' | 'all' | 'none';

export interface SelectorConfig {
  selector: string;
  attr?: string;   // "href", "src", "data-*"... sinon texte
  multi?: boolean; // true = tableau, false = un seul
}

export interface ScrapeRequest {
  url: string;

  mode?: ScrapeMode;              // auto | http | browser
  depth?: number;                 // 0 = pas de crawl, >0 = profondeur max
  maxPages?: number;              // global
  maxConcurrency?: number;        // parallélisme

  userAgent?: string;
  respectRobotsTxt?: boolean;     // hook futur
  linkScope?: LinkScope;          // où suivre les liens
  excludeExtensions?: string[];   // à ignorer: [".jpg", ".png", ".pdf", ...]
  timeoutMs?: number;             // timeout global job
  maxBodySizeBytes?: number;      // taille max par réponse

  profile?: 'default' | 'news' | 'foot' | 'ecommerce' | string;

  extract?: {
    text?: boolean;
    html?: boolean;
    links?: boolean;
    metadata?: boolean;
    selectors?: Record<string, string | SelectorConfig>;
  };
}

export interface ScrapedPage {
  url: string;
  status: number;
  metadata?: {
    title?: string;
    contentType?: string;
    description?: string;
    canonical?: string;
  };
  links?: string[];
  text?: string;
  html?: string;
  extracted?: Record<string, any>;
  error?: string;
  timing?: number;
}

export interface ScrapeResult {
  startedAt: string;
  finishedAt: string;
  modeUsed: ScrapeMode;
  url: string;
  pages: ScrapedPage[];
  stats: {
    pagesCount: number;
    successCount: number;
    failCount: number;
    durationMs: number;
    avgPageTime: number;
  };
}

export interface ScraperProfile {
  name: string;
  description: string;
  defaults: Partial<ScrapeRequest>;
}
