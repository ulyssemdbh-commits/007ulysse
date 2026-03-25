/**
 * MARS - Reliability Scorer (Hardcore Version)
 * 4-axis scoring system for source reliability
 * 
 * Axes:
 * 1. Domain Trust (0-40): Whitelist/blacklist/greylist
 * 2. Freshness (0-20): Publication date scoring
 * 3. Cross-Reference (0-30): Multi-source confirmation
 * 4. Structure Quality (0-10): Content quality signals
 */

import { ExtractedContent } from "./contentFetcher";

export interface ReliabilityScore {
  total: number;
  breakdown: {
    domainTrust: number;
    freshness: number;
    crossReference: number;
    structureQuality: number;
  };
  flags: string[];
  confidence: "high" | "medium" | "low" | "unreliable";
  url: string;
  domain: string;
  contentDomain: string;
}

const DOMAIN_WHITELIST: Record<string, number> = {
  "gouv.fr": 40, "service-public.fr": 40,
  "europa.eu": 38, "who.int": 38, "un.org": 38,
  
  "reuters.com": 36, "apnews.com": 36,
  "bbc.com": 35, "bbc.co.uk": 35,
  "nytimes.com": 34, "theguardian.com": 34,
  "economist.com": 35, "ft.com": 35,
  
  "lemonde.fr": 34, "lesechos.fr": 34, "lefigaro.fr": 32,
  "liberation.fr": 30, "lequipe.fr": 32, "leparisien.fr": 30,
  "franceinfo.fr": 34, "france24.com": 34,
  
  "developer.mozilla.org": 38, "w3.org": 38,
  "docs.microsoft.com": 35, "learn.microsoft.com": 35,
  "cloud.google.com": 35, "aws.amazon.com": 35,
  "docs.github.com": 34, "nodejs.org": 34, "python.org": 34,
  "reactjs.org": 33, "vuejs.org": 33, "angular.io": 33,
  "stackoverflow.com": 30,
  
  "wikipedia.org": 28, "britannica.com": 32,
  "scholar.google.com": 35, "arxiv.org": 35, "pubmed.gov": 38,
  
  "crunchbase.com": 28, "bloomberg.com": 34,
  "forbes.com": 26, "businessinsider.com": 24,
  "techcrunch.com": 26, "wired.com": 26,
  
  "github.com": 28,
  "gitlab.com": 26,
  "npm.io": 25, "npmjs.com": 25, "pypi.org": 25,
  
  "imdb.com": 28, "rottentomatoes.com": 26,
  "allociné.fr": 26, "senscritique.com": 24,
  
  "transfermarkt.com": 30, "sofascore.com": 28,
  "flashscore.fr": 26, "whoscored.com": 28,
  "footmercato.net": 22, "sofoot.com": 24,
  
  "insee.fr": 38, "data.gouv.fr": 36,
  "banque-france.fr": 36, "ecb.europa.eu": 36,
};

const DOMAIN_GREYLIST: Record<string, number> = {
  "medium.com": 18,
  "dev.to": 20,
  "reddit.com": 16,
  "quora.com": 14,
  "linkedin.com": 18,
  "twitter.com": 12, "x.com": 12,
  "facebook.com": 10,
  "youtube.com": 14,
  "tiktok.com": 8,
};

const DOMAIN_BLACKLIST_PATTERNS = [
  /\.blogspot\./,
  /\.wordpress\.com$/,
  /\.wix\.com$/,
  /\.weebly\.com$/,
  /\bfake\b/i,
  /\bhoax\b/i,
  /\bscam\b/i,
  /clickbait/i,
  /\bspam\b/i,
];

function getDomainFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const parts = hostname.split(".");
    if (parts.length >= 2) {
      return parts.slice(-2).join(".");
    }
    return hostname;
  } catch {
    return "";
  }
}

function scoreDomainTrust(url: string): { score: number; flags: string[] } {
  const flags: string[] = [];
  const domain = getDomainFromUrl(url);
  const fullHostname = new URL(url).hostname.replace(/^www\./, "");
  
  for (const pattern of DOMAIN_BLACKLIST_PATTERNS) {
    if (pattern.test(url) || pattern.test(domain)) {
      flags.push("blacklisted_domain");
      return { score: 0, flags };
    }
  }
  
  if (DOMAIN_WHITELIST[fullHostname]) {
    flags.push("whitelisted");
    return { score: DOMAIN_WHITELIST[fullHostname], flags };
  }
  if (DOMAIN_WHITELIST[domain]) {
    flags.push("whitelisted");
    return { score: DOMAIN_WHITELIST[domain], flags };
  }
  
  if (DOMAIN_GREYLIST[fullHostname]) {
    flags.push("greylisted");
    return { score: DOMAIN_GREYLIST[fullHostname], flags };
  }
  if (DOMAIN_GREYLIST[domain]) {
    flags.push("greylisted");
    return { score: DOMAIN_GREYLIST[domain], flags };
  }
  
  let baseScore = 15;
  
  if (url.startsWith("https://")) {
    baseScore += 3;
    flags.push("https");
  }
  
  if (domain.endsWith(".edu")) {
    baseScore += 8;
    flags.push("edu_domain");
  } else if (domain.endsWith(".gov")) {
    baseScore += 10;
    flags.push("gov_domain");
  } else if (domain.endsWith(".org")) {
    baseScore += 3;
    flags.push("org_domain");
  }
  
  flags.push("unknown_domain");
  return { score: Math.min(baseScore, 25), flags };
}

// AMÉLIORATION: Décroissance exponentielle contextuelle (proposition Ulysse + point 5 user)
const FRESHNESS_DECAY_BY_DOMAIN: Record<string, number> = {
  news: 0.92,       // Perd 8%/jour - actualités très sensibles au temps
  sports: 0.90,     // Perd 10%/jour - résultats sportifs très temporels
  finance: 0.94,    // Perd 6%/jour - données financières assez volatiles
  tech: 0.97,       // Perd 3%/jour - documentation technique plus stable
  science: 0.995,   // Perd 0.5%/jour - publications scientifiques stables
  health: 0.96,     // Perd 4%/jour - recommandations médicales évoluent
  history: 1.0,     // Pas de décroissance - faits historiques stables
  evergreen: 0.998, // Presque pas de décroissance - contenu intemporel
  default: 0.95     // Perd 5%/jour - valeur par défaut
};

function detectContentDomain(content: ExtractedContent): string {
  const text = (content.title + " " + content.text).toLowerCase();
  const url = content.url.toLowerCase();
  
  // Détection par URL
  if (/lequipe|sport|football|soccer|nba|nfl|tennis/i.test(url)) return "sports";
  if (/news|actualite|breaking|reuters|bbc|cnn/i.test(url)) return "news";
  if (/finance|bloomberg|bourse|stock|trading/i.test(url)) return "finance";
  if (/github|stackoverflow|docs\.|developer|api/i.test(url)) return "tech";
  if (/pubmed|arxiv|scholar|research|science/i.test(url)) return "science";
  if (/health|medical|sante|who\.int|nih\.gov/i.test(url)) return "health";
  if (/wikipedia|britannica|history/i.test(url)) return "history";
  
  // Détection par contenu
  if (/match|score|victoire|défaite|équipe|joueur|but|goal/i.test(text)) return "sports";
  if (/aujourd'hui|hier|breaking|annonce|déclaration/i.test(text)) return "news";
  if (/action|bourse|investissement|trading|marché/i.test(text)) return "finance";
  if (/code|api|framework|library|programming/i.test(text)) return "tech";
  
  return "default";
}

function scoreFreshness(content: ExtractedContent, contentDomain?: string): { score: number; flags: string[] } {
  const flags: string[] = [];
  const dateStr = content.updateDate || content.publishDate;
  const domain = contentDomain || detectContentDomain(content);
  const decayRate = FRESHNESS_DECAY_BY_DOMAIN[domain] || FRESHNESS_DECAY_BY_DOMAIN.default;
  
  flags.push(`domain:${domain}`);
  
  if (!dateStr) {
    flags.push("no_date_found");
    return { score: 5, flags };
  }
  
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      flags.push("invalid_date");
      return { score: 5, flags };
    }
    
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) {
      flags.push("future_date");
      return { score: 5, flags };
    }
    
    // AMÉLIORATION: Score avec décroissance exponentielle contextuelle
    // Score max = 20, applique decay^diffDays
    const baseScore = 20;
    const decayedScore = Math.round(baseScore * Math.pow(decayRate, diffDays));
    const finalScore = Math.max(2, Math.min(20, decayedScore));
    
    // Ajouter des flags descriptifs
    if (diffDays <= 1) {
      flags.push("today");
    } else if (diffDays <= 7) {
      flags.push("very_fresh");
    } else if (diffDays <= 30) {
      flags.push("fresh");
    } else if (diffDays <= 90) {
      flags.push("recent");
    } else if (diffDays <= 365) {
      flags.push("within_year");
    } else {
      flags.push("older_content");
    }
    
    flags.push(`decay:${(decayRate * 100).toFixed(1)}%/day`);
    flags.push(`raw_score:${finalScore}`);
    
    return { score: finalScore, flags };
  } catch {
    flags.push("date_parse_error");
    return { score: 5, flags };
  }
}

function scoreCrossReference(
  content: ExtractedContent,
  allContents: ExtractedContent[],
  keyFacts: string[]
): { score: number; flags: string[]; confirmedFacts: string[] } {
  const flags: string[] = [];
  const confirmedFacts: string[] = [];
  
  if (allContents.length < 2) {
    flags.push("single_source");
    return { score: 10, flags, confirmedFacts };
  }
  
  const otherContents = allContents.filter(c => c.url !== content.url && c.success);
  
  if (otherContents.length === 0) {
    flags.push("no_other_sources");
    return { score: 10, flags, confirmedFacts };
  }
  
  let confirmations = 0;
  
  for (const fact of keyFacts) {
    const factLower = fact.toLowerCase();
    const factWords = factLower.split(/\s+/).filter(w => w.length > 4);
    
    if (factWords.length === 0) continue;
    
    let sourceMatches = 0;
    for (const other of otherContents) {
      const otherTextLower = other.text.toLowerCase();
      const matchingWords = factWords.filter(w => otherTextLower.includes(w));
      
      if (matchingWords.length >= Math.ceil(factWords.length * 0.6)) {
        sourceMatches++;
      }
    }
    
    if (sourceMatches >= 2) {
      confirmedFacts.push(fact);
      confirmations += 2;
    } else if (sourceMatches === 1) {
      confirmedFacts.push(fact);
      confirmations += 1;
    }
  }
  
  const maxScore = 30;
  const score = Math.min(10 + (confirmations * 4), maxScore);
  
  if (confirmations >= 3) {
    flags.push("well_confirmed");
  } else if (confirmations >= 1) {
    flags.push("partially_confirmed");
  } else {
    flags.push("unconfirmed");
  }
  
  return { score, flags, confirmedFacts };
}

function scoreStructureQuality(content: ExtractedContent): { score: number; flags: string[] } {
  const flags: string[] = [];
  let score = 5;
  
  if (content.wordCount > 300 && content.wordCount < 10000) {
    score += 2;
    flags.push("good_length");
  } else if (content.wordCount < 100) {
    score -= 2;
    flags.push("too_short");
  } else if (content.wordCount > 10000) {
    score += 1;
    flags.push("comprehensive");
  }
  
  if (content.author) {
    score += 1;
    flags.push("has_author");
  }
  
  if (content.contentType === "documentation" || content.contentType === "article") {
    score += 1;
    flags.push("structured_content");
  }
  
  const textLower = content.text.toLowerCase();
  const clickbaitPatterns = [
    /you won't believe/i,
    /shocking/i,
    /mind-blowing/i,
    /this one trick/i,
    /doctors hate/i,
    /what happened next/i,
    /breaking:/i,
    /exclusive:/i,
  ];
  
  for (const pattern of clickbaitPatterns) {
    if (pattern.test(textLower)) {
      score -= 2;
      flags.push("clickbait_detected");
      break;
    }
  }
  
  return { score: Math.max(0, Math.min(score, 10)), flags };
}

export function calculateReliability(
  content: ExtractedContent,
  allContents: ExtractedContent[] = [],
  keyFacts: string[] = []
): ReliabilityScore {
  const allFlags: string[] = [];
  
  const domainResult = scoreDomainTrust(content.url);
  allFlags.push(...domainResult.flags);
  
  const freshnessResult = scoreFreshness(content);
  allFlags.push(...freshnessResult.flags);
  
  const crossRefResult = scoreCrossReference(content, allContents, keyFacts);
  allFlags.push(...crossRefResult.flags);
  
  const qualityResult = scoreStructureQuality(content);
  allFlags.push(...qualityResult.flags);
  
  const total = domainResult.score + freshnessResult.score + crossRefResult.score + qualityResult.score;
  
  let confidence: "high" | "medium" | "low" | "unreliable";
  if (total >= 75) {
    confidence = "high";
  } else if (total >= 55) {
    confidence = "medium";
  } else if (total >= 35) {
    confidence = "low";
  } else {
    confidence = "unreliable";
  }
  
  const urlDomain = getDomainFromUrl(content.url);
  const contentDomain = detectContentDomain(content);
  
  return {
    total,
    breakdown: {
      domainTrust: domainResult.score,
      freshness: freshnessResult.score,
      crossReference: crossRefResult.score,
      structureQuality: qualityResult.score
    },
    flags: allFlags,
    confidence,
    url: content.url,
    domain: urlDomain,
    contentDomain
  };
}

export function calculateQuickReliability(url: string): number {
  const { score } = scoreDomainTrust(url);
  const httpsBonus = url.startsWith("https://") ? 5 : 0;
  return Math.min(score + httpsBonus + 10, 50);
}

export const reliabilityScorerService = {
  calculateReliability,
  calculateQuickReliability,
  getDomainFromUrl
};
