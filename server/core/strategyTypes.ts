/**
 * Strategy Engine Types - Core types for intelligent web scraping
 * Extends existing scraper types with strategy learning capabilities
 */

export type RenderStrategy = 'http' | 'jina' | 'playwright' | 'firecrawl' | 'apify' | 'perplexity';

// Liste complète des stratégies (pour analytics, stats, etc.)
export const ALL_STRATEGIES: RenderStrategy[] = ['http', 'playwright', 'jina', 'firecrawl', 'apify', 'perplexity'];

export interface StrategyResult {
  strategy: RenderStrategy;
  success: boolean;
  contentLength: number;
  qualityScore: number;
  durationMs: number;
  error?: string;
}

export interface DomainProfile {
  domain: string;
  successCount: number;
  failureCount: number;
  lastSuccessStrategy?: RenderStrategy;
  failedStrategies: RenderStrategy[];
  jsRequired: boolean;
  avgQualityScore: number;
  lastUpdatedAt: string;
}

export interface SmartCrawlRequest {
  url: string;
  forceStrategy?: RenderStrategy;
  timeoutMs?: number;
  userAgent?: string;
  waitForJs?: boolean;
  extractText?: boolean;
  extractLinks?: boolean;
  extractMetadata?: boolean;
  minContentLength?: number;
  qualityThreshold?: number;
}

export interface SmartCrawlResult {
  url: string;
  finalUrl: string;
  success: boolean;
  strategyUsed: RenderStrategy;
  strategiesAttempted: StrategyResult[];
  title: string;
  content: string;
  contentLength: number;
  qualityScore: number;
  metadata?: {
    description?: string;
    author?: string;
    publishDate?: string;
    language?: string;
    canonical?: string;
    ogImage?: string;
  };
  links?: string[];
  timing: {
    totalMs: number;
    perStrategy: Record<RenderStrategy, number>;
  };
  domainProfile?: DomainProfile;
  error?: string;
}

export interface QualityMetrics {
  hasTitle: boolean;
  hasContent: boolean;
  contentLength: number;
  wordCount: number;
  hasStructuredData: boolean;
  hasMetadata: boolean;
  linkCount: number;
  imageCount: number;
  jsDetected: boolean;
  emptyBodyRatio: number;
}

// Type de config complet pour une stratégie
export interface StrategyConfig {
  strategy: RenderStrategy;
  enabled: boolean;
  timeoutMs?: number;
  priority?: number;        // pour l'ordre d'essai ou d'affichage
  minQualityScore?: number; // seuil de qualité souhaité pour considérer la stratégie "bonne"
  requiresApiKey?: string;  // nom de la variable d'env si nécessaire (ex: "JINA_API_KEY")
}

// Config centrale des stratégies (ordre + activation)
const STRATEGY_CONFIGS: StrategyConfig[] = [
  {
    strategy: "http",
    enabled: true,
    timeoutMs: 12000,
    priority: 1,
    minQualityScore: 0.3,
  },
  {
    strategy: "playwright",
    enabled: true,
    timeoutMs: 20000,
    priority: 2,
    minQualityScore: 0.3,
  },
  {
    strategy: "jina",
    enabled: true,
    timeoutMs: 15000,
    priority: 3,
    minQualityScore: 0.4,
    requiresApiKey: "JINA_API_KEY",
  },
  {
    strategy: "firecrawl",
    enabled: true,
    timeoutMs: 15000,
    priority: 4,
    minQualityScore: 0.4,
    requiresApiKey: "FIRECRAWL_API_KEY",
  },
  {
    strategy: "apify",
    enabled: false,
    timeoutMs: 20000,
    priority: 5,
    minQualityScore: 0.4,
    requiresApiKey: "APIFY_API_TOKEN",
  },
  {
    strategy: "perplexity",
    enabled: false,
    timeoutMs: 15000,
    priority: 6,
    minQualityScore: 0.4,
    requiresApiKey: "PERPLEXITY_API_KEY",
  },
];

// Legacy export for compatibility
export const DEFAULT_STRATEGY_ORDER = STRATEGY_CONFIGS;

export function getEnabledStrategies(): StrategyConfig[] {
  return STRATEGY_CONFIGS.filter((c) => c.enabled);
}
