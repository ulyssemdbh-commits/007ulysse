/**
 * MARS Source Blacklist - Filter out spam, low-quality, and unreliable sources
 * 
 * Features:
 * - Domain-based blacklisting
 * - Pattern-based filtering
 * - Quality scoring with penalties
 * - Whitelist for trusted sources
 */

export interface SourceEvaluation {
  url: string;
  domain: string;
  isBlacklisted: boolean;
  isWhitelisted: boolean;
  qualityScore: number;
  reason?: string;
  penalties: string[];
}

// Domaines spam/faible qualité à exclure
const BLACKLISTED_DOMAINS = new Set([
  // Content farms
  'ehow.com',
  'answerbag.com',
  'ask.com',
  'answers.com',
  'answers.yahoo.com',
  'quora.com', // Contenu souvent non-vérifié
  
  // SEO spam
  'articlebiz.com',
  'articlebase.com',
  'ezinearticles.com',
  'hubpages.com',
  'squidoo.com',
  'buzzle.com',
  
  // Agrégateurs sans valeur ajoutée
  'alltop.com',
  'digg.com',
  'reddit.com', // Trop variable en qualité
  
  // Sites de scraping
  'copyblogger.com',
  'contentmarketinginstitute.com',
  
  // Fake news / désinformation
  'infowars.com',
  'naturalnews.com',
  'beforeitsnews.com',
  'globalresearch.ca',
  'zerohedge.com',
  
  // Clickbait
  'buzzfeed.com',
  'upworthy.com',
  'viralnova.com',
  
  // Sites de comparaison affiliés
  'slickdeals.net',
  'dealnews.com',
  
  // Forums non modérés
  '4chan.org',
  '8kun.top'
]);

// Domaines de confiance (bonus de qualité)
const WHITELISTED_DOMAINS = new Set([
  // Encyclopédies
  'wikipedia.org',
  'britannica.com',
  'larousse.fr',
  
  // Académique
  'scholar.google.com',
  'arxiv.org',
  'pubmed.ncbi.nlm.nih.gov',
  'researchgate.net',
  'jstor.org',
  
  // Gouvernement
  'gouv.fr',
  'gov.uk',
  'gov',
  'europa.eu',
  
  // News fiables
  'reuters.com',
  'apnews.com',
  'bbc.com',
  'bbc.co.uk',
  'lemonde.fr',
  'lefigaro.fr',
  'liberation.fr',
  'nytimes.com',
  'theguardian.com',
  'washingtonpost.com',
  
  // Tech documentation
  'developer.mozilla.org',
  'docs.microsoft.com',
  'cloud.google.com',
  'aws.amazon.com',
  'stackoverflow.com',
  'github.com',
  
  // Sports officiels
  'uefa.com',
  'fifa.com',
  'ligue1.fr',
  'lequipe.fr',
  'espn.com',
  'nba.com',
  'nfl.com',
  'nhl.com',
  
  // Finance
  'bloomberg.com',
  'ft.com',
  'lesechos.fr',
  'boursorama.com',
  'tradingview.com'
]);

// Patterns URL suspects
const SUSPICIOUS_PATTERNS = [
  /\.(ru|cn|tk|ml|ga|cf)$/, // TLDs à risque
  /\/(wp-content|wp-includes)\//i, // Pages WordPress internes
  /\/amp\//i, // Pages AMP (souvent dégradées)
  /\?.*utm_/i, // Tracking URLs
  /\/tag\//i, // Pages de tags
  /\/category\//i, // Pages de catégories
  /\/page\/\d+/i, // Pagination
  /\.(pdf|doc|xls|ppt)$/i, // Documents (pas indexables)
  /forum.*\/viewtopic/i, // Forums non-modérés
  /-sponsored-/i, // Contenu sponsorisé
  /\/affiliate/i, // Pages affiliées
];

// Patterns de qualité (bonus)
const QUALITY_PATTERNS = [
  { pattern: /\/research\//i, bonus: 10 },
  { pattern: /\/science\//i, bonus: 10 },
  { pattern: /\/docs\//i, bonus: 5 },
  { pattern: /\/documentation\//i, bonus: 5 },
  { pattern: /\/guide\//i, bonus: 5 },
  { pattern: /\/tutorial\//i, bonus: 5 },
  { pattern: /\/how-to\//i, bonus: 3 },
  { pattern: /\/analysis\//i, bonus: 8 },
  { pattern: /\/study\//i, bonus: 8 },
  { pattern: /\/official\//i, bonus: 10 },
];

/**
 * Extrait le domaine d'une URL
 */
function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Vérifie si un domaine est dans la whitelist (inclut sous-domaines)
 */
function isWhitelisted(domain: string): boolean {
  for (const trusted of WHITELISTED_DOMAINS) {
    if (domain === trusted || domain.endsWith(`.${trusted}`)) {
      return true;
    }
  }
  return false;
}

/**
 * Vérifie si un domaine est dans la blacklist
 */
function isBlacklisted(domain: string): boolean {
  for (const blocked of BLACKLISTED_DOMAINS) {
    if (domain === blocked || domain.endsWith(`.${blocked}`)) {
      return true;
    }
  }
  return false;
}

/**
 * Évalue la qualité d'une source
 */
export function evaluateSource(url: string): SourceEvaluation {
  const domain = extractDomain(url);
  const penalties: string[] = [];
  let qualityScore = 50; // Score de base

  // Whitelist check
  const whitelisted = isWhitelisted(domain);
  if (whitelisted) {
    qualityScore += 30;
  }

  // Blacklist check
  const blacklisted = isBlacklisted(domain);
  if (blacklisted) {
    return {
      url,
      domain,
      isBlacklisted: true,
      isWhitelisted: false,
      qualityScore: 0,
      reason: `Domaine blacklisté: ${domain}`,
      penalties: ['blacklisted']
    };
  }

  // Pattern checks
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(url)) {
      qualityScore -= 15;
      penalties.push(`pattern:${pattern.source.substring(0, 15)}`);
    }
  }

  // Quality bonus patterns
  for (const { pattern, bonus } of QUALITY_PATTERNS) {
    if (pattern.test(url)) {
      qualityScore += bonus;
    }
  }

  // HTTPS bonus
  if (url.startsWith('https://')) {
    qualityScore += 5;
  } else {
    qualityScore -= 10;
    penalties.push('no-https');
  }

  // Longueur URL (URLs très longues = souvent spam)
  if (url.length > 200) {
    qualityScore -= 10;
    penalties.push('url-too-long');
  }

  // Clamp score
  qualityScore = Math.max(0, Math.min(100, qualityScore));

  return {
    url,
    domain,
    isBlacklisted: false,
    isWhitelisted: whitelisted,
    qualityScore,
    penalties
  };
}

/**
 * Filtre une liste de résultats en excluant les sources blacklistées
 */
export function filterResults<T extends { url: string }>(
  results: T[],
  options?: {
    minQuality?: number;
    logFiltered?: boolean;
  }
): T[] {
  const minQuality = options?.minQuality ?? 20;
  const logFiltered = options?.logFiltered ?? true;

  return results.filter(result => {
    const evaluation = evaluateSource(result.url);
    
    if (evaluation.isBlacklisted) {
      if (logFiltered) {
        console.log(`[MARS:Blacklist] BLOCKED: ${result.url} (${evaluation.reason})`);
      }
      return false;
    }

    if (evaluation.qualityScore < minQuality) {
      if (logFiltered) {
        console.log(`[MARS:Blacklist] LOW-QUALITY: ${result.url} (score: ${evaluation.qualityScore}, penalties: ${evaluation.penalties.join(', ')})`);
      }
      return false;
    }

    return true;
  });
}

/**
 * Trie les résultats par qualité
 */
export function sortByQuality<T extends { url: string }>(results: T[]): T[] {
  return [...results].sort((a, b) => {
    const scoreA = evaluateSource(a.url).qualityScore;
    const scoreB = evaluateSource(b.url).qualityScore;
    return scoreB - scoreA;
  });
}

/**
 * Statistiques de la blacklist
 */
export function getBlacklistStats(): {
  blacklistedDomains: number;
  whitelistedDomains: number;
  suspiciousPatterns: number;
  qualityPatterns: number;
} {
  return {
    blacklistedDomains: BLACKLISTED_DOMAINS.size,
    whitelistedDomains: WHITELISTED_DOMAINS.size,
    suspiciousPatterns: SUSPICIOUS_PATTERNS.length,
    qualityPatterns: QUALITY_PATTERNS.length
  };
}

export const marsSourceBlacklist = {
  evaluateSource,
  filterResults,
  sortByQuality,
  getBlacklistStats,
  extractDomain
};
