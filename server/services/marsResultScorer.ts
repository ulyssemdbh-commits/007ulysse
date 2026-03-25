/**
 * MARS Result Scorer - ML-inspired scoring for search results
 * 
 * Features:
 * - Freshness scoring (date-based)
 * - Domain authority scoring
 * - Semantic relevance (keyword matching)
 * - Content quality signals
 * - Combined weighted scoring
 */

import { marsSourceBlacklist } from "./marsSourceBlacklist";

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

// Autorité de domaine (approximation basée sur la réputation)
const DOMAIN_AUTHORITY: Record<string, number> = {
  // Max authority (90-100)
  'wikipedia.org': 95,
  'britannica.com': 90,
  'scholar.google.com': 95,
  'arxiv.org': 90,
  'pubmed.ncbi.nlm.nih.gov': 92,
  
  // High authority (75-89)
  'bbc.com': 85,
  'bbc.co.uk': 85,
  'reuters.com': 88,
  'apnews.com': 87,
  'nytimes.com': 82,
  'theguardian.com': 80,
  'lemonde.fr': 82,
  'lefigaro.fr': 78,
  'lesechos.fr': 80,
  'lequipe.fr': 82,
  'developer.mozilla.org': 90,
  'docs.microsoft.com': 85,
  'cloud.google.com': 85,
  'stackoverflow.com': 80,
  'github.com': 78,
  
  // Medium authority (50-74)
  'medium.com': 55,
  'dev.to': 60,
  'hackernews.com': 65,
  'techcrunch.com': 68,
  'verge.com': 65,
  'wired.com': 70,
  'arstechnica.com': 72,
  
  // Default
  'default': 50
};

// Indicateurs de fraîcheur dans le contenu
const FRESHNESS_PATTERNS = [
  { pattern: /202[5-9]|203\d/, score: 100 }, // Futur proche
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

// Signaux de qualité de contenu
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

/**
 * Calcule le score de fraîcheur
 */
function calculateFreshnessScore(text: string, date?: string): number {
  let score = 50; // Score par défaut

  // Si date explicite fournie
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
    } catch {
      // Ignore parsing errors
    }
  }

  // Sinon, chercher des patterns de date dans le texte
  for (const { pattern, score: patternScore } of FRESHNESS_PATTERNS) {
    if (pattern.test(text)) {
      score = Math.max(score, patternScore);
    }
  }

  return score;
}

/**
 * Calcule le score d'autorité du domaine
 */
function calculateAuthorityScore(url: string): number {
  const evaluation = marsSourceBlacklist.evaluateSource(url);
  
  if (evaluation.isBlacklisted) {
    return 0;
  }

  const domain = marsSourceBlacklist.extractDomain(url);
  
  // Chercher une correspondance exacte ou partielle
  for (const [knownDomain, authority] of Object.entries(DOMAIN_AUTHORITY)) {
    if (domain === knownDomain || domain.endsWith(`.${knownDomain}`)) {
      // Bonus pour whitelist
      const bonus = evaluation.isWhitelisted ? 5 : 0;
      return Math.min(100, authority + bonus);
    }
  }

  // Score par défaut ajusté par l'évaluation de qualité
  return Math.max(0, Math.min(100, evaluation.qualityScore));
}

/**
 * Calcule le score de pertinence sémantique
 */
function calculateRelevanceScore(query: string, title: string, snippet: string): number {
  const queryWords = query.toLowerCase()
    .replace(/[^\w\sàâäéèêëïîôöùûüç-]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2);
  
  const text = `${title} ${snippet}`.toLowerCase();
  
  if (queryWords.length === 0) {
    return 50;
  }

  let matchedWords = 0;
  let exactPhraseMatch = false;
  
  // Vérifier correspondance exacte de la phrase
  if (text.includes(query.toLowerCase())) {
    exactPhraseMatch = true;
  }

  // Compter les mots correspondants
  for (const word of queryWords) {
    if (text.includes(word)) {
      matchedWords++;
    }
  }

  const wordMatchRatio = matchedWords / queryWords.length;
  
  let score = wordMatchRatio * 70; // Max 70 pour correspondance de mots
  
  if (exactPhraseMatch) {
    score += 30; // Bonus pour correspondance exacte
  }

  // Bonus si le titre contient les mots clés
  const titleLower = title.toLowerCase();
  const titleMatches = queryWords.filter(w => titleLower.includes(w)).length;
  score += (titleMatches / queryWords.length) * 10;

  return Math.min(100, Math.max(0, score));
}

/**
 * Calcule le score de qualité du contenu
 */
function calculateQualityScore(title: string, snippet: string, url: string): number {
  const text = `${title} ${snippet}`;
  let score = 50;

  // Signaux positifs
  for (const { pattern, weight } of QUALITY_SIGNALS.positive) {
    if (pattern.test(text)) {
      score += weight;
    }
  }

  // Signaux négatifs
  for (const { pattern, weight } of QUALITY_SIGNALS.negative) {
    if (pattern.test(text)) {
      score += weight; // weight est déjà négatif
    }
  }

  // Bonus pour snippet long (plus informatif)
  if (snippet.length > 200) {
    score += 5;
  } else if (snippet.length < 50) {
    score -= 10;
  }

  // Pénalité pour tout en majuscules
  const uppercaseRatio = (text.match(/[A-Z]/g) || []).length / text.length;
  if (uppercaseRatio > 0.5) {
    score -= 15;
  }

  return Math.min(100, Math.max(0, score));
}

/**
 * Score un résultat de recherche
 */
export function scoreResult(
  result: { url: string; title: string; snippet: string; date?: string },
  query: string,
  originalRank: number
): ScoredResult {
  const freshness = calculateFreshnessScore(`${result.title} ${result.snippet}`, result.date);
  const authority = calculateAuthorityScore(result.url);
  const relevance = calculateRelevanceScore(query, result.title, result.snippet);
  const quality = calculateQualityScore(result.title, result.snippet, result.url);

  // Pondération des composants
  const weights = {
    freshness: 0.15,
    authority: 0.30,
    relevance: 0.40,
    quality: 0.15
  };

  // Score combiné
  const combinedScore = 
    freshness * weights.freshness +
    authority * weights.authority +
    relevance * weights.relevance +
    quality * weights.quality;

  // Ajustement par rang original (léger bonus pour les premiers résultats)
  const rankBonus = Math.max(0, 10 - originalRank) * 0.5;
  const finalScore = Math.min(100, combinedScore + rankBonus);

  return {
    url: result.url,
    title: result.title,
    snippet: result.snippet,
    score: Math.round(finalScore * 10) / 10,
    components: {
      freshness: Math.round(freshness),
      authority: Math.round(authority),
      relevance: Math.round(relevance),
      quality: Math.round(quality)
    },
    rank: originalRank
  };
}

/**
 * Score et trie une liste de résultats
 */
export function scoreAndRankResults(
  results: Array<{ url: string; title: string; snippet: string; date?: string; rank?: number }>,
  query: string,
  options?: {
    minScore?: number;
    maxResults?: number;
  }
): ScoredResult[] {
  const minScore = options?.minScore ?? 0;
  const maxResults = options?.maxResults ?? results.length;

  const scored = results.map((result, index) => 
    scoreResult(result, query, result.rank ?? index + 1)
  );

  // Filtrer par score minimum
  const filtered = scored.filter(r => r.score >= minScore);

  // Trier par score décroissant
  filtered.sort((a, b) => b.score - a.score);

  // Réassigner les rangs
  return filtered.slice(0, maxResults).map((result, index) => ({
    ...result,
    rank: index + 1
  }));
}

/**
 * Obtenir les stats de scoring pour debug
 */
export function getScoringStats(results: ScoredResult[]): {
  avgScore: number;
  scoreDistribution: { low: number; medium: number; high: number };
  componentAverages: { freshness: number; authority: number; relevance: number; quality: number };
} {
  if (results.length === 0) {
    return {
      avgScore: 0,
      scoreDistribution: { low: 0, medium: 0, high: 0 },
      componentAverages: { freshness: 0, authority: 0, relevance: 0, quality: 0 }
    };
  }

  const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;

  const scoreDistribution = {
    low: results.filter(r => r.score < 40).length,
    medium: results.filter(r => r.score >= 40 && r.score < 70).length,
    high: results.filter(r => r.score >= 70).length
  };

  const componentAverages = {
    freshness: results.reduce((sum, r) => sum + r.components.freshness, 0) / results.length,
    authority: results.reduce((sum, r) => sum + r.components.authority, 0) / results.length,
    relevance: results.reduce((sum, r) => sum + r.components.relevance, 0) / results.length,
    quality: results.reduce((sum, r) => sum + r.components.quality, 0) / results.length
  };

  return { avgScore, scoreDistribution, componentAverages };
}

export const marsResultScorer = {
  scoreResult,
  scoreAndRankResults,
  getScoringStats
};
