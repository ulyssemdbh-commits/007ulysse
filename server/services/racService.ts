/**
 * RAC - Recherche Augmentée par Contexte (Context-Augmented Search)
 * 
 * Système en 3 phases:
 * 1. Enrichissement contextuel - injection du contexte utilisateur dans les recherches
 * 2. Recherche multi-sources avec scoring de fiabilité
 * 3. Mémoire intelligente - sauvegarde automatique des faits vérifiés avec tags
 */

import { db } from "../db";
import { ulysseMemory, webSearchMemory, projectMemory, projects } from "@shared/schema";
import { eq, desc, and, sql, gte } from "drizzle-orm";
import { searchWeb, WebSearchResponse, WebSearchResult } from "./websearch";

// ============================================================================
// TYPES
// ============================================================================

export interface EnrichedQuery {
  original: string;
  enriched: string;
  contextUsed: string[];
  userDomains: string[];
}

export interface ScoredSource {
  title: string;
  url: string;
  snippet: string;
  reliabilityScore: number;  // 0-100
  domain: string;
  factors: ReliabilityFactors;
}

export interface ReliabilityFactors {
  domainTrust: number;      // 0-30 - based on known reliable domains
  httpsBonus: number;       // 0-10 - HTTPS = more secure
  freshness: number;        // 0-20 - recent content preferred
  crossReference: number;   // 0-40 - confirmed by other sources
}

export interface EnrichedSearchResponse {
  query: EnrichedQuery;
  results: ScoredSource[];
  summary: string;
  averageReliability: number;
  crossReferencedFacts: string[];
  searchTime: number;
  success: boolean;
  error?: string;
}

export interface MemoryTag {
  name: string;
  confidence: number;
}

export interface StructuredMemory {
  id: number;
  content: string;
  tags: MemoryTag[];
  category: string;
  domain: string;
  confidence: number;
  expiresAt: Date | null;
  source: string | null;
  createdAt: Date;
}

export interface RACMetrics {
  totalSearches: number;
  averageReliability: number;
  contextHitRate: number;      // % of searches that used context
  memorySavings: number;       // facts saved to memory
  crossReferenceRate: number;  // % of facts confirmed by multiple sources
  topDomains: { domain: string; count: number }[];
  efficiencyScore: number;     // 0-100 overall
}

// ============================================================================
// PHASE 1: CONTEXT ENRICHMENT
// ============================================================================

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  "business": ["entreprise", "startup", "investissement", "finance", "market", "revenue", "profit", "stratégie", "b2b", "client"],
  "tech": ["code", "développement", "api", "javascript", "react", "node", "python", "ia", "ml", "cloud", "devops"],
  "football": ["foot", "football", "om", "marseille", "ligue 1", "but", "match", "joueur", "transfert", "mercato"],
  "personal": ["famille", "santé", "voyage", "loisir", "musique", "film", "livre"],
  "finance": ["bourse", "action", "crypto", "bitcoin", "investir", "rendement", "portefeuille"]
};

export async function enrichQueryWithContext(
  userId: number,
  query: string
): Promise<EnrichedQuery> {
  const contextUsed: string[] = [];
  const userDomains: string[] = [];
  
  // Detect domains from query
  const queryLower = query.toLowerCase();
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    if (keywords.some(kw => queryLower.includes(kw))) {
      userDomains.push(domain);
    }
  }

  // Get relevant memories
  const memories = await db.select()
    .from(ulysseMemory)
    .where(eq(ulysseMemory.userId, userId))
    .orderBy(desc(ulysseMemory.confidence))
    .limit(10);

  // Get active projects
  const activeProjects = await db.select()
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.status, "active")))
    .limit(5);

  // Get project memory for context
  const projectContexts = await db.select()
    .from(projectMemory)
    .where(and(eq(projectMemory.userId, userId), eq(projectMemory.status, "active")))
    .orderBy(desc(projectMemory.lastDiscussed))
    .limit(3);

  // Build enrichment string
  let enriched = query;
  const enrichments: string[] = [];

  // Add domain-specific context from memories
  for (const memory of memories) {
    const memoryLower = memory.value.toLowerCase();
    // Check if memory is relevant to query domains
    for (const domain of userDomains) {
      const keywords = DOMAIN_KEYWORDS[domain] || [];
      if (keywords.some(kw => memoryLower.includes(kw))) {
        if (memory.key && !enrichments.includes(memory.key)) {
          enrichments.push(memory.value.substring(0, 50));
          contextUsed.push(`memory:${memory.key}`);
        }
        break;
      }
    }
  }

  // Add project context if relevant
  for (const proj of projectContexts) {
    if (proj.techStack && proj.techStack.length > 0) {
      for (const tech of proj.techStack.slice(0, 3)) {
        if (queryLower.includes(tech.toLowerCase())) {
          contextUsed.push(`project:${proj.projectName}`);
          break;
        }
      }
    }
  }

  // If no domains detected, try to infer from recent search history
  if (userDomains.length === 0) {
    const recentSearches = await db.select()
      .from(webSearchMemory)
      .where(eq(webSearchMemory.userId, userId))
      .orderBy(desc(webSearchMemory.createdAt))
      .limit(5);

    for (const search of recentSearches) {
      if (search.topic) {
        userDomains.push(search.topic);
        contextUsed.push(`recent_search:${search.topic}`);
        break;
      }
    }
  }

  // Create enriched query with context hints
  if (enrichments.length > 0 && enrichments.length <= 2) {
    enriched = `${query} (contexte: ${enrichments.join(", ")})`;
  }

  console.log(`[RAC] Query enriched: "${query}" → domains: [${userDomains.join(", ")}], context: [${contextUsed.join(", ")}]`);

  return {
    original: query,
    enriched,
    contextUsed,
    userDomains
  };
}

// ============================================================================
// PHASE 2: RELIABILITY SCORING
// ============================================================================

const TRUSTED_DOMAINS: Record<string, number> = {
  // News & Media (high trust)
  "reuters.com": 28, "apnews.com": 28, "bbc.com": 27, "bbc.co.uk": 27,
  "lemonde.fr": 26, "lequipe.fr": 25, "lesechos.fr": 26, "lefigaro.fr": 25,
  "nytimes.com": 27, "theguardian.com": 26, "economist.com": 28,
  
  // Tech (high trust)
  "github.com": 25, "stackoverflow.com": 24, "developer.mozilla.org": 28,
  "docs.microsoft.com": 26, "cloud.google.com": 26, "aws.amazon.com": 26,
  "reactjs.org": 25, "nodejs.org": 25, "python.org": 25,
  
  // Knowledge (high trust)
  "wikipedia.org": 22, "britannica.com": 25, "scholar.google.com": 28,
  
  // Business (medium-high trust)
  "crunchbase.com": 23, "linkedin.com": 20, "bloomberg.com": 26,
  "forbes.com": 22, "businessinsider.com": 20,
  
  // Sports (France)
  "footmercato.net": 18, "maxifoot.fr": 16, "sofoot.com": 20,
  
  // Government/Official
  "gouv.fr": 28, "europa.eu": 27, "who.int": 28,
  
  // Medium trust
  "medium.com": 15, "dev.to": 16, "reddit.com": 12,
};

const UNTRUSTED_PATTERNS = [
  /\.blogspot\./,
  /\.wordpress\.com$/,
  /pinterest\./,
  /facebook\.com/,
  /twitter\.com/,
  /tiktok\.com/,
];

function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function calculateReliabilityScore(result: WebSearchResult, allResults: WebSearchResult[]): ScoredSource {
  const domain = extractDomain(result.url);
  const factors: ReliabilityFactors = {
    domainTrust: 0,
    httpsBonus: 0,
    freshness: 15, // Default medium freshness
    crossReference: 0
  };

  // Domain trust (0-30)
  if (TRUSTED_DOMAINS[domain]) {
    factors.domainTrust = TRUSTED_DOMAINS[domain];
  } else if (UNTRUSTED_PATTERNS.some(p => p.test(result.url))) {
    factors.domainTrust = 5;
  } else {
    factors.domainTrust = 12; // Unknown domain = medium trust
  }

  // HTTPS bonus (0-10)
  factors.httpsBonus = result.url.startsWith("https://") ? 10 : 0;

  // Cross-reference: Check if snippet content appears in other results (0-40)
  const snippetWords = result.snippet.toLowerCase().split(/\s+/).filter(w => w.length > 5);
  let matchCount = 0;
  
  for (const other of allResults) {
    if (other.url === result.url) continue;
    const otherSnippet = other.snippet.toLowerCase();
    const matches = snippetWords.filter(word => otherSnippet.includes(word)).length;
    if (matches >= 3) matchCount++;
  }
  
  factors.crossReference = Math.min(40, matchCount * 15);

  const totalScore = factors.domainTrust + factors.httpsBonus + factors.freshness + factors.crossReference;

  return {
    title: result.title,
    url: result.url,
    snippet: result.snippet,
    reliabilityScore: Math.min(100, totalScore),
    domain,
    factors
  };
}

// ============================================================================
// PHASE 3: INTELLIGENT MEMORY
// ============================================================================

async function extractAndSaveFacts(
  userId: number,
  query: string,
  results: ScoredSource[],
  domains: string[]
): Promise<string[]> {
  const savedFacts: string[] = [];
  
  // Only save facts from reliable sources (score >= 60)
  const reliableSources = results.filter(r => r.reliabilityScore >= 60);
  
  if (reliableSources.length === 0) return savedFacts;

  // Extract key findings from top results
  const keyFindings = reliableSources.slice(0, 3).map(r => r.snippet.substring(0, 200));
  
  // Determine topic from domains
  const topic = domains.length > 0 ? domains[0] : "general";
  
  // Calculate average usefulness
  const avgScore = Math.round(
    reliableSources.reduce((sum, r) => sum + r.reliabilityScore, 0) / reliableSources.length
  );

  // Save to web search memory
  try {
    await db.insert(webSearchMemory).values({
      userId,
      query,
      topic,
      keyFindings,
      sources: reliableSources.slice(0, 5).map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet.substring(0, 150),
        reliability: r.reliabilityScore
      })),
      usefulnessScore: avgScore,
      learnedInsights: keyFindings[0] || null,
      createdAt: new Date()
    });
    
    savedFacts.push(`Recherche sauvegardée: "${query}" (fiabilité: ${avgScore}%)`);
    console.log(`[RAC] Saved search to memory: "${query}" with ${reliableSources.length} reliable sources`);
  } catch (error) {
    console.error("[RAC] Failed to save to memory:", error);
  }

  return savedFacts;
}

// ============================================================================
// MAIN SEARCH FUNCTION
// ============================================================================

export async function searchWithRAC(
  userId: number,
  query: string,
  numResults: number = 8
): Promise<EnrichedSearchResponse> {
  const startTime = Date.now();
  
  console.log(`[RAC] Starting augmented search for user ${userId}: "${query}"`);

  // Phase 1: Enrich query with context
  const enrichedQuery = await enrichQueryWithContext(userId, query);

  // Phase 2: Perform search
  const searchResponse = await searchWeb(enrichedQuery.enriched, numResults);
  
  if (!searchResponse.success) {
    return {
      query: enrichedQuery,
      results: [],
      summary: "",
      averageReliability: 0,
      crossReferencedFacts: [],
      searchTime: Date.now() - startTime,
      success: false,
      error: searchResponse.error
    };
  }

  // Phase 2b: Score reliability
  const scoredResults = searchResponse.results.map(r => 
    calculateReliabilityScore(r, searchResponse.results)
  );
  
  // Sort by reliability
  scoredResults.sort((a, b) => b.reliabilityScore - a.reliabilityScore);

  // Calculate average reliability
  const avgReliability = scoredResults.length > 0
    ? Math.round(scoredResults.reduce((sum, r) => sum + r.reliabilityScore, 0) / scoredResults.length)
    : 0;

  // Extract cross-referenced facts (facts confirmed by 2+ sources)
  const crossReferencedFacts: string[] = [];
  for (const result of scoredResults) {
    if (result.factors.crossReference >= 15) {
      crossReferencedFacts.push(result.snippet.substring(0, 100) + "...");
    }
  }

  // Phase 3: Save to intelligent memory
  const savedFacts = await extractAndSaveFacts(
    userId,
    query,
    scoredResults,
    enrichedQuery.userDomains
  );

  // Build summary
  const topResult = scoredResults[0];
  const summary = topResult 
    ? `${searchResponse.answer || topResult.snippet.substring(0, 150)}... (source: ${topResult.domain}, fiabilité: ${topResult.reliabilityScore}%)`
    : "Aucun résultat fiable trouvé.";

  const response: EnrichedSearchResponse = {
    query: enrichedQuery,
    results: scoredResults,
    summary,
    averageReliability: avgReliability,
    crossReferencedFacts: crossReferencedFacts.slice(0, 3),
    searchTime: Date.now() - startTime,
    success: true
  };

  console.log(`[RAC] Search completed in ${response.searchTime}ms - ${scoredResults.length} results, avg reliability: ${avgReliability}%`);

  return response;
}

// ============================================================================
// FORMAT FOR AI
// ============================================================================

export function formatRACResultsForAI(response: EnrichedSearchResponse): string {
  if (!response.success) {
    return `[Recherche RAC échouée: ${response.error}]`;
  }

  if (response.results.length === 0) {
    return "[Aucun résultat trouvé pour cette recherche]";
  }

  let formatted = `### Résultats de recherche (RAC - Recherche Augmentée)\n\n`;
  formatted += `**Fiabilité moyenne:** ${response.averageReliability}% | **Temps:** ${response.searchTime}ms\n\n`;

  if (response.query.contextUsed.length > 0) {
    formatted += `**Contexte utilisé:** ${response.query.contextUsed.join(", ")}\n\n`;
  }

  if (response.crossReferencedFacts.length > 0) {
    formatted += `**Faits vérifiés (recoupés):**\n`;
    for (const fact of response.crossReferencedFacts) {
      formatted += `✓ ${fact}\n`;
    }
    formatted += `\n`;
  }

  formatted += `**Sources triées par fiabilité:**\n\n`;

  for (const result of response.results.slice(0, 5)) {
    const reliabilityIcon = result.reliabilityScore >= 70 ? "🟢" : 
                            result.reliabilityScore >= 50 ? "🟡" : "🔴";
    formatted += `${reliabilityIcon} **${result.title}** [${result.reliabilityScore}%]\n`;
    formatted += `${result.snippet}\n`;
    formatted += `Source: ${result.url}\n\n`;
  }

  return formatted;
}

// ============================================================================
// METRICS & EFFICIENCY
// ============================================================================

export async function getRACMetrics(userId: number, daysBack: number = 30): Promise<RACMetrics> {
  const since = new Date();
  since.setDate(since.getDate() - daysBack);

  // Get all searches in period
  const searches = await db.select()
    .from(webSearchMemory)
    .where(and(
      eq(webSearchMemory.userId, userId),
      gte(webSearchMemory.createdAt, since)
    ))
    .orderBy(desc(webSearchMemory.createdAt));

  const totalSearches = searches.length;
  
  if (totalSearches === 0) {
    return {
      totalSearches: 0,
      averageReliability: 0,
      contextHitRate: 0,
      memorySavings: 0,
      crossReferenceRate: 0,
      topDomains: [],
      efficiencyScore: 0
    };
  }

  // Calculate average reliability
  const avgReliability = Math.round(
    searches.reduce((sum, s) => sum + (s.usefulnessScore || 50), 0) / totalSearches
  );

  // Context hit rate (searches with topic = context was used)
  const withContext = searches.filter(s => s.topic && s.topic !== "general").length;
  const contextHitRate = Math.round((withContext / totalSearches) * 100);

  // Memory savings (searches with key findings)
  const withFindings = searches.filter(s => s.keyFindings && s.keyFindings.length > 0).length;

  // Cross-reference rate (high usefulness = cross-referenced)
  const highQuality = searches.filter(s => (s.usefulnessScore || 0) >= 70).length;
  const crossReferenceRate = Math.round((highQuality / totalSearches) * 100);

  // Extract top domains from sources
  const domainCounts: Record<string, number> = {};
  for (const search of searches) {
    const sources = search.sources as any[];
    if (sources && Array.isArray(sources)) {
      for (const source of sources) {
        if (source.url) {
          const domain = extractDomain(source.url);
          domainCounts[domain] = (domainCounts[domain] || 0) + 1;
        }
      }
    }
  }

  const topDomains = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([domain, count]) => ({ domain, count }));

  // Calculate overall efficiency score
  const efficiencyScore = Math.round(
    (avgReliability * 0.4) + 
    (contextHitRate * 0.3) + 
    (crossReferenceRate * 0.3)
  );

  return {
    totalSearches,
    averageReliability: avgReliability,
    contextHitRate,
    memorySavings: withFindings,
    crossReferenceRate,
    topDomains,
    efficiencyScore
  };
}

// Export service
export const racService = {
  searchWithRAC,
  enrichQueryWithContext,
  formatRACResultsForAI,
  getRACMetrics
};
