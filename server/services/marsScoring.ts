export interface SourceEvaluation {
  url: string;
  domain: string;
  isBlacklisted: boolean;
  isWhitelisted: boolean;
  qualityScore: number;
  reason?: string;
  penalties: string[];
}

const BLACKLISTED_DOMAINS = new Set([
  'ehow.com', 'answerbag.com', 'ask.com', 'answers.com', 'answers.yahoo.com', 'quora.com',
  'articlebiz.com', 'articlebase.com', 'ezinearticles.com', 'hubpages.com', 'squidoo.com', 'buzzle.com',
  'alltop.com', 'digg.com', 'reddit.com',
  'copyblogger.com', 'contentmarketinginstitute.com',
  'infowars.com', 'naturalnews.com', 'beforeitsnews.com', 'globalresearch.ca', 'zerohedge.com',
  'buzzfeed.com', 'upworthy.com', 'viralnova.com',
  'slickdeals.net', 'dealnews.com',
  '4chan.org', '8kun.top'
]);

const WHITELISTED_DOMAINS = new Set([
  'wikipedia.org', 'britannica.com', 'larousse.fr',
  'scholar.google.com', 'arxiv.org', 'pubmed.ncbi.nlm.nih.gov', 'researchgate.net', 'jstor.org',
  'gouv.fr', 'gov.uk', 'gov', 'europa.eu',
  'reuters.com', 'apnews.com', 'bbc.com', 'bbc.co.uk', 'lemonde.fr', 'lefigaro.fr', 'liberation.fr',
  'nytimes.com', 'theguardian.com', 'washingtonpost.com',
  'developer.mozilla.org', 'docs.microsoft.com', 'cloud.google.com', 'aws.amazon.com', 'stackoverflow.com', 'github.com',
  'uefa.com', 'fifa.com', 'ligue1.fr', 'lequipe.fr', 'espn.com', 'nba.com', 'nfl.com', 'nhl.com',
  'bloomberg.com', 'ft.com', 'lesechos.fr', 'boursorama.com', 'tradingview.com'
]);

const SUSPICIOUS_PATTERNS = [
  /\.(ru|cn|tk|ml|ga|cf)$/,
  /\/(wp-content|wp-includes)\//i,
  /\/amp\//i,
  /\?.*utm_/i,
  /\/tag\//i,
  /\/category\//i,
  /\/page\/\d+/i,
  /\.(pdf|doc|xls|ppt)$/i,
  /forum.*\/viewtopic/i,
  /-sponsored-/i,
  /\/affiliate/i,
];

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

export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function isWhitelisted(domain: string): boolean {
  for (const trusted of WHITELISTED_DOMAINS) {
    if (domain === trusted || domain.endsWith(`.${trusted}`)) return true;
  }
  return false;
}

function isDomainBlacklisted(domain: string): boolean {
  for (const blocked of BLACKLISTED_DOMAINS) {
    if (domain === blocked || domain.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

export function evaluateSource(url: string): SourceEvaluation {
  const domain = extractDomain(url);
  const penalties: string[] = [];
  let qualityScore = 50;

  const whitelisted = isWhitelisted(domain);
  if (whitelisted) qualityScore += 30;

  const blacklisted = isDomainBlacklisted(domain);
  if (blacklisted) {
    return { url, domain, isBlacklisted: true, isWhitelisted: false, qualityScore: 0, reason: `Domaine blacklisté: ${domain}`, penalties: ['blacklisted'] };
  }

  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(url)) {
      qualityScore -= 15;
      penalties.push(`pattern:${pattern.source.substring(0, 15)}`);
    }
  }

  for (const { pattern, bonus } of QUALITY_PATTERNS) {
    if (pattern.test(url)) qualityScore += bonus;
  }

  if (url.startsWith('https://')) {
    qualityScore += 5;
  } else {
    qualityScore -= 10;
    penalties.push('no-https');
  }

  if (url.length > 200) {
    qualityScore -= 10;
    penalties.push('url-too-long');
  }

  qualityScore = Math.max(0, Math.min(100, qualityScore));

  return { url, domain, isBlacklisted: false, isWhitelisted: whitelisted, qualityScore, penalties };
}

export function filterResults<T extends { url: string }>(
  results: T[],
  options?: { minQuality?: number; logFiltered?: boolean }
): T[] {
  const minQuality = options?.minQuality ?? 20;
  const logFiltered = options?.logFiltered ?? true;

  return results.filter(result => {
    const evaluation = evaluateSource(result.url);
    if (evaluation.isBlacklisted) {
      if (logFiltered) console.log(`[MARS:Blacklist] BLOCKED: ${result.url} (${evaluation.reason})`);
      return false;
    }
    if (evaluation.qualityScore < minQuality) {
      if (logFiltered) console.log(`[MARS:Blacklist] LOW-QUALITY: ${result.url} (score: ${evaluation.qualityScore}, penalties: ${evaluation.penalties.join(', ')})`);
      return false;
    }
    return true;
  });
}

export function sortByQuality<T extends { url: string }>(results: T[]): T[] {
  return [...results].sort((a, b) => evaluateSource(b.url).qualityScore - evaluateSource(a.url).qualityScore);
}

export function getBlacklistStats(): { blacklistedDomains: number; whitelistedDomains: number; suspiciousPatterns: number; qualityPatterns: number } {
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

export interface ScoredResult {
  url: string;
  title: string;
  snippet: string;
  score: number;
  components: {
    freshness: number;
    authority: number;
    relevance: number;
    quality: number;
  };
  rank: number;
}

const DOMAIN_AUTHORITY: Record<string, number> = {
  'wikipedia.org': 95, 'britannica.com': 90, 'scholar.google.com': 95, 'arxiv.org': 90, 'pubmed.ncbi.nlm.nih.gov': 92,
  'bbc.com': 85, 'bbc.co.uk': 85, 'reuters.com': 88, 'apnews.com': 87, 'nytimes.com': 82,
  'theguardian.com': 80, 'lemonde.fr': 82, 'lefigaro.fr': 78, 'lesechos.fr': 80, 'lequipe.fr': 82,
  'developer.mozilla.org': 90, 'docs.microsoft.com': 85, 'cloud.google.com': 85, 'stackoverflow.com': 80, 'github.com': 78,
  'medium.com': 55, 'dev.to': 60, 'hackernews.com': 65, 'techcrunch.com': 68, 'verge.com': 65, 'wired.com': 70, 'arstechnica.com': 72,
  'default': 50
};

const FRESHNESS_PATTERNS_SCORER = [
  { pattern: /202[5-9]|203\d/, score: 100 },
  { pattern: /2024/, score: 90 },
  { pattern: /2023/, score: 70 },
  { pattern: /2022/, score: 50 },
  { pattern: /202[01]/, score: 30 },
  { pattern: /201\d/, score: 10 },
  { pattern: /aujourd'hui|today|now|maintenant/i, score: 95 },
  { pattern: /hier|yesterday/i, score: 85 },
  { pattern: /cette semaine|this week/i, score: 80 },
  { pattern: /ce mois|this month/i, score: 70 },
];

const QUALITY_SIGNALS = {
  positive: [
    { pattern: /étude|study|research|recherche/i, weight: 10 },
    { pattern: /analyse|analysis/i, weight: 8 },
    { pattern: /rapport|report/i, weight: 7 },
    { pattern: /officiel|official/i, weight: 10 },
    { pattern: /guide|tutoriel|tutorial/i, weight: 6 },
    { pattern: /documentation|docs/i, weight: 8 },
    { pattern: /expert|spécialiste/i, weight: 5 },
    { pattern: /selon|according to|d'après/i, weight: 4 },
  ],
  negative: [
    { pattern: /publicité|advertisement|sponsored/i, weight: -15 },
    { pattern: /clickbait|sensationnel/i, weight: -20 },
    { pattern: /top \d+ |best \d+/i, weight: -5 },
    { pattern: /incroyable|shocking|amazing/i, weight: -8 },
    { pattern: /vous ne croirez pas|you won't believe/i, weight: -15 },
    { pattern: /cliquez ici|click here/i, weight: -10 },
  ]
};

function calculateFreshnessScore(text: string, date?: string): number {
  let score = 50;
  if (date) {
    try {
      const parsed = new Date(date);
      const now = new Date();
      const daysDiff = (now.getTime() - parsed.getTime()) / (1000 * 60 * 60 * 24);
      if (daysDiff < 1) score = 100;
      else if (daysDiff < 7) score = 90;
      else if (daysDiff < 30) score = 75;
      else if (daysDiff < 90) score = 60;
      else if (daysDiff < 365) score = 40;
      else score = 20;
      return score;
    } catch {}
  }
  for (const { pattern, score: patternScore } of FRESHNESS_PATTERNS_SCORER) {
    if (pattern.test(text)) score = Math.max(score, patternScore);
  }
  return score;
}

function calculateAuthorityScore(url: string): number {
  const evaluation = evaluateSource(url);
  if (evaluation.isBlacklisted) return 0;
  const domain = extractDomain(url);
  for (const [knownDomain, authority] of Object.entries(DOMAIN_AUTHORITY)) {
    if (domain === knownDomain || domain.endsWith(`.${knownDomain}`)) {
      const bonus = evaluation.isWhitelisted ? 5 : 0;
      return Math.min(100, authority + bonus);
    }
  }
  return Math.max(0, Math.min(100, evaluation.qualityScore));
}

function calculateRelevanceScore(query: string, title: string, snippet: string): number {
  const queryWords = query.toLowerCase().replace(/[^\w\sàâäéèêëïîôöùûüç-]/g, '').split(/\s+/).filter(w => w.length > 2);
  const text = `${title} ${snippet}`.toLowerCase();
  if (queryWords.length === 0) return 50;
  let matchedWords = 0;
  let exactPhraseMatch = text.includes(query.toLowerCase());
  for (const word of queryWords) { if (text.includes(word)) matchedWords++; }
  const wordMatchRatio = matchedWords / queryWords.length;
  let score = wordMatchRatio * 70;
  if (exactPhraseMatch) score += 30;
  const titleLower = title.toLowerCase();
  const titleMatches = queryWords.filter(w => titleLower.includes(w)).length;
  score += (titleMatches / queryWords.length) * 10;
  return Math.min(100, Math.max(0, score));
}

function calculateContentQualityScore(title: string, snippet: string, _url: string): number {
  const text = `${title} ${snippet}`;
  let score = 50;
  for (const { pattern, weight } of QUALITY_SIGNALS.positive) { if (pattern.test(text)) score += weight; }
  for (const { pattern, weight } of QUALITY_SIGNALS.negative) { if (pattern.test(text)) score += weight; }
  if (snippet.length > 200) score += 5;
  else if (snippet.length < 50) score -= 10;
  const uppercaseRatio = (text.match(/[A-Z]/g) || []).length / text.length;
  if (uppercaseRatio > 0.5) score -= 15;
  return Math.min(100, Math.max(0, score));
}

export function scoreResult(
  result: { url: string; title: string; snippet: string; date?: string },
  query: string,
  originalRank: number
): ScoredResult {
  const freshness = calculateFreshnessScore(`${result.title} ${result.snippet}`, result.date);
  const authority = calculateAuthorityScore(result.url);
  const relevance = calculateRelevanceScore(query, result.title, result.snippet);
  const quality = calculateContentQualityScore(result.title, result.snippet, result.url);
  const weights = { freshness: 0.15, authority: 0.30, relevance: 0.40, quality: 0.15 };
  const combinedScore = freshness * weights.freshness + authority * weights.authority + relevance * weights.relevance + quality * weights.quality;
  const rankBonus = Math.max(0, 10 - originalRank) * 0.5;
  const finalScore = Math.min(100, combinedScore + rankBonus);

  return {
    url: result.url, title: result.title, snippet: result.snippet,
    score: Math.round(finalScore * 10) / 10,
    components: { freshness: Math.round(freshness), authority: Math.round(authority), relevance: Math.round(relevance), quality: Math.round(quality) },
    rank: originalRank
  };
}

export function scoreAndRankResults(
  results: Array<{ url: string; title: string; snippet: string; date?: string; rank?: number }>,
  query: string,
  options?: { minScore?: number; maxResults?: number }
): ScoredResult[] {
  const minScore = options?.minScore ?? 0;
  const maxResults = options?.maxResults ?? results.length;
  const scored = results.map((result, index) => scoreResult(result, query, result.rank ?? index + 1));
  const filtered = scored.filter(r => r.score >= minScore);
  filtered.sort((a, b) => b.score - a.score);
  return filtered.slice(0, maxResults).map((result, index) => ({ ...result, rank: index + 1 }));
}

export function getScoringStats(results: ScoredResult[]): {
  avgScore: number;
  scoreDistribution: { low: number; medium: number; high: number };
  componentAverages: { freshness: number; authority: number; relevance: number; quality: number };
} {
  if (results.length === 0) {
    return { avgScore: 0, scoreDistribution: { low: 0, medium: 0, high: 0 }, componentAverages: { freshness: 0, authority: 0, relevance: 0, quality: 0 } };
  }
  const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
  return {
    avgScore,
    scoreDistribution: { low: results.filter(r => r.score < 40).length, medium: results.filter(r => r.score >= 40 && r.score < 70).length, high: results.filter(r => r.score >= 70).length },
    componentAverages: {
      freshness: results.reduce((sum, r) => sum + r.components.freshness, 0) / results.length,
      authority: results.reduce((sum, r) => sum + r.components.authority, 0) / results.length,
      relevance: results.reduce((sum, r) => sum + r.components.relevance, 0) / results.length,
      quality: results.reduce((sum, r) => sum + r.components.quality, 0) / results.length
    }
  };
}

export const marsResultScorer = {
  scoreResult,
  scoreAndRankResults,
  getScoringStats
};
