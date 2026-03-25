import { marsService, MARSSearchResult } from "./marsService";
import { memoryService } from "./memory";
import { translationService } from "./translationService";
import { autoVerifiedScrape } from "./scraper/verified";
import { db } from "../db";
import { webSearchMemory, marsSearchHistory } from "@shared/schema";
import { eq, desc, gte, and, like, sql } from "drizzle-orm";

// SUPER ULYSSE: Verified scrape data structure
interface VerifiedScrapeData {
  type: string;
  url: string;
  data: any;
  confidence: "verified" | "probable";
}

export interface ResearchGapAnalysis {
  hasGaps: boolean;
  gapTypes: string[];
  confidenceLevel: "high" | "medium" | "low" | "insufficient";
  verifiedFactsCount: number;
  probableFactsCount: number;
  unverifiedFactsCount: number;
  dataGaps: string[];
  warnings: string[];
  needsDeepDive: boolean;
  suggestedQueries: string[];
}

export interface EnrichedSearchResult {
  originalQuery: string;
  reformulations: string[];
  combinedResults: MARSSearchResult;
  memoryEnrichment: string[];
  verifiedMemoryEnrichment: string[];
  verifiedScrapeData: VerifiedScrapeData[];
  crossReferencedFacts: Array<{
    fact: string;
    sourceCount: number;
    confidence: "verified" | "probable" | "unverified";
    isTranslated?: boolean;
  }>;
  researchDepth: "shallow" | "standard" | "deep" | "exhaustive";
  totalSearches: number;
  executionTime: number;
}

const QUERY_REFORMULATION_TEMPLATES = [
  (q: string) => `${q} actualités récentes`,
  (q: string) => `${q} dernières informations 2024 2025 2026`,
  (q: string) => `${q} chiffres officiels`,
  (q: string) => `${q} données précises`,
  (q: string) => `${q} sources fiables`,
  (q: string) => `site:gouv.fr ${q}`,
  (q: string) => `${q} statistiques`,
  (q: string) => `${q} analyse détaillée`,
];

// Tracking for learning and auto-regeneration (scoped by userId)
interface ResearchLearning {
  query: string;
  successfulStrategies: string[];
  failedStrategies: string[];
  bestReformulations: string[];
  timestamp: number;
}

// User-scoped learning cache: userId -> queryKey -> learning
const researchLearningCache: Map<number, Map<string, ResearchLearning>> = new Map();
const MAX_LEARNING_CACHE_PER_USER = 50;

export const autonomousResearchService = {
  // AUTONOMIE: More aggressive gap detection thresholds
  AGGRESSIVE_MODE: true,
  MIN_VERIFIED_FACTS: 2,
  MIN_SOURCES: 4,
  MIN_RELIABILITY: 55,
  
  // AUTO-REGENERATION: Track and learn from research patterns (scoped by userId)
  learnFromResult(userId: number, queryKey: string, reformulation: string, wasSuccessful: boolean, verifiedFactsCount: number): void {
    if (!researchLearningCache.has(userId)) {
      researchLearningCache.set(userId, new Map());
    }
    const userCache = researchLearningCache.get(userId)!;
    
    const existing = userCache.get(queryKey) || {
      query: queryKey,
      successfulStrategies: [],
      failedStrategies: [],
      bestReformulations: [],
      timestamp: Date.now()
    };
    
    if (wasSuccessful && verifiedFactsCount > 0) {
      if (!existing.successfulStrategies.includes(reformulation)) {
        existing.successfulStrategies.push(reformulation);
      }
      if (verifiedFactsCount >= 2 && !existing.bestReformulations.includes(reformulation)) {
        existing.bestReformulations.push(reformulation);
      }
    } else {
      if (!existing.failedStrategies.includes(reformulation)) {
        existing.failedStrategies.push(reformulation);
      }
    }
    
    existing.timestamp = Date.now();
    userCache.set(queryKey, existing);
    
    // Cleanup old entries for this user
    if (userCache.size > MAX_LEARNING_CACHE_PER_USER) {
      const entries = Array.from(userCache.entries());
      const oldestKey = entries.sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
      userCache.delete(oldestKey);
    }
  },
  
  // PROACTIVITE: Get learned successful strategies for similar queries (scoped by userId)
  getLearnedStrategies(userId: number, query: string): string[] {
    if (!query) return [];
    const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const suggestions: string[] = [];
    
    const userCache = researchLearningCache.get(userId);
    if (!userCache) return [];
    
    const entries = Array.from(userCache.entries());
    for (const [key, learning] of entries) {
      const keyWords = key.toLowerCase().split(/\s+/);
      const overlap = keywords.filter(k => keyWords.includes(k)).length;
      
      if (overlap >= 2) {
        suggestions.push(...learning.bestReformulations.slice(0, 2));
      }
    }
    
    return Array.from(new Set(suggestions)).slice(0, 3);
  },
  
  // PROACTIVITE: Get failed strategies to avoid (scoped by userId)
  getFailedStrategies(userId: number, query: string): string[] {
    if (!query) return [];
    const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const failed: string[] = [];
    
    const userCache = researchLearningCache.get(userId);
    if (!userCache) return [];
    
    const entries = Array.from(userCache.entries());
    for (const [key, learning] of entries) {
      const keyWords = key.toLowerCase().split(/\s+/);
      const overlap = keywords.filter(k => keyWords.includes(k)).length;
      
      if (overlap >= 2) {
        failed.push(...learning.failedStrategies.slice(0, 3));
      }
    }
    
    return Array.from(new Set(failed));
  },
  
  // AUTO-REGENERATION: Detect if we should retry with different strategy
  shouldRetryWithDifferentStrategy(gapAnalysis: ResearchGapAnalysis, attemptCount: number): boolean {
    if (attemptCount >= 1) return false;
    
    // Retry if we have critical gaps
    if (gapAnalysis.verifiedFactsCount === 0 && gapAnalysis.probableFactsCount < 2) {
      return true;
    }
    
    if (gapAnalysis.confidenceLevel === "insufficient") {
      return true;
    }
    
    return false;
  },

  analyzeGaps(userId: number, marsResult: MARSSearchResult, options?: { isUrlRead?: boolean }): ResearchGapAnalysis {
    const facts = marsResult.factAggregation?.facts || [];
    const verifiedFacts = facts.filter(f => f.confidence === "verified");
    const probableFacts = facts.filter(f => f.confidence === "probable");
    const unverifiedFacts = facts.filter(f => f.confidence === "unverified");
    
    const dataGaps = marsResult.factAggregation?.dataGaps || [];
    const warnings = marsResult.policyDecision?.warnings || [];
    const confidence = marsResult.policyDecision?.confidenceLevel || "insufficient";
    
    const gapTypes: string[] = [];
    
    const isUrlRead = options?.isUrlRead || false;
    const effectiveAggressive = isUrlRead ? false : this.AGGRESSIVE_MODE;
    
    const minVerified = effectiveAggressive ? this.MIN_VERIFIED_FACTS : 1;
    const minSources = effectiveAggressive ? this.MIN_SOURCES : 3;
    const minReliability = effectiveAggressive ? this.MIN_RELIABILITY : 50;
    
    if (verifiedFacts.length < minVerified) {
      gapTypes.push("no_verified_facts");
    }
    if (dataGaps.length > 0) {
      gapTypes.push("explicit_data_gaps");
    }
    if (confidence === "low" || confidence === "insufficient") {
      gapTypes.push("low_confidence");
    }
    if (marsResult.orchestratorResponse.results.length < minSources) {
      gapTypes.push("insufficient_sources");
    }
    if (unverifiedFacts.length > verifiedFacts.length + probableFacts.length) {
      gapTypes.push("mostly_unverified");
    }
    
    const avgReliability = marsResult.reliabilityScores.length > 0
      ? marsResult.reliabilityScores.reduce((a, b) => a + b.total, 0) / marsResult.reliabilityScores.length
      : 0;
    
    if (avgReliability < minReliability) {
      gapTypes.push("low_reliability_sources");
    }
    
    const needsDeepDive = effectiveAggressive
      ? (gapTypes.length >= 2 || (confidence === "insufficient" && verifiedFacts.length === 0))
      : (gapTypes.length >= 2 || confidence === "insufficient" || (verifiedFacts.length === 0 && probableFacts.length < 3));
    
    const suggestedQueries = this.generateReformulations(userId, marsResult.query, gapTypes);
    
    return {
      hasGaps: gapTypes.length > 0,
      gapTypes,
      confidenceLevel: confidence as "high" | "medium" | "low" | "insufficient",
      verifiedFactsCount: verifiedFacts.length,
      probableFactsCount: probableFacts.length,
      unverifiedFactsCount: unverifiedFacts.length,
      dataGaps,
      warnings,
      needsDeepDive,
      suggestedQueries
    };
  },

  generateReformulations(userId: number, query: string, gapTypes: string[]): string[] {
    const reformulations: string[] = [];
    const baseQuery = query.replace(/[?!.,;:]/g, "").trim();
    
    // PROACTIVITE: First, add learned successful strategies from similar queries
    const learnedStrategies = this.getLearnedStrategies(userId, query);
    reformulations.push(...learnedStrategies);
    
    // AUTO-REGENERATION: Exclude failed strategies from suggestions
    const failedStrategies = this.getFailedStrategies(userId, query);
    
    // Filter out strategies that have failed before
    const filterFailed = (strat: string) => !failedStrategies.some(f => strat.includes(f) || f.includes(strat));
    
    if (gapTypes.includes("no_verified_facts") || gapTypes.includes("mostly_unverified")) {
      reformulations.push(`${baseQuery} sources officielles`);
      reformulations.push(`${baseQuery} rapport officiel`);
    }
    
    if (gapTypes.includes("explicit_data_gaps")) {
      reformulations.push(`${baseQuery} données complètes`);
      reformulations.push(`${baseQuery} détails précis`);
    }
    
    if (gapTypes.includes("low_confidence")) {
      reformulations.push(`${baseQuery} actualités 2025 2026`);
      reformulations.push(`${baseQuery} dernières nouvelles`);
    }
    
    if (gapTypes.includes("insufficient_sources")) {
      reformulations.push(`${baseQuery} articles`);
      reformulations.push(`${baseQuery} presse`);
    }
    
    if (gapTypes.includes("low_reliability_sources")) {
      reformulations.push(`site:lemonde.fr OR site:lefigaro.fr ${baseQuery}`);
      reformulations.push(`site:reuters.com ${baseQuery}`);
    }
    
    // AUTONOMIE: Always add some templates if we have room
    if (reformulations.length < 5) {
      const templates = QUERY_REFORMULATION_TEMPLATES.slice(0, 6 - reformulations.length);
      for (const template of templates) {
        reformulations.push(template(baseQuery));
      }
    }
    
    // Apply failed strategy filter and return
    return Array.from(new Set(reformulations)).filter(filterFailed).slice(0, 6);
  },

  async enrichFromMemory(userId: number, query: string): Promise<string[]> {
    try {
      if (!query) return [];
      const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const enrichments: string[] = [];
      
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const relatedSearches = await db
        .select()
        .from(webSearchMemory)
        .where(
          and(
            eq(webSearchMemory.userId, userId),
            gte(webSearchMemory.createdAt, thirtyDaysAgo)
          )
        )
        .orderBy(desc(webSearchMemory.reliabilityScore))
        .limit(10);
      
      for (const search of relatedSearches) {
        const searchKeywords = (search.query || "").toLowerCase().split(/\s+/);
        const overlap = keywords.filter(k => searchKeywords.includes(k)).length;
        
        if (overlap >= 2 && search.keyFindings) {
          for (const finding of search.keyFindings.slice(0, 2)) {
            enrichments.push(`[Mémoire] ${finding}`);
          }
        }
      }
      
      const marsHistory = await db
        .select()
        .from(marsSearchHistory)
        .where(
          and(
            eq(marsSearchHistory.userId, userId),
            gte(marsSearchHistory.createdAt, thirtyDaysAgo)
          )
        )
        .orderBy(desc(marsSearchHistory.createdAt))
        .limit(5);
      
      for (const history of marsHistory) {
        const historyKeywords = (history.query || "").toLowerCase().split(/\s+/);
        const overlap = keywords.filter(k => historyKeywords.includes(k)).length;
        
        if (overlap >= 2 && history.verifiedFacts && Array.isArray(history.verifiedFacts)) {
          for (const fact of (history.verifiedFacts as string[]).slice(0, 2)) {
            enrichments.push(`[Historique MARS] ${fact}`);
          }
        }
      }
      
      return Array.from(new Set(enrichments)).slice(0, 5);
    } catch (error) {
      console.error("[AutonomousResearch] Memory enrichment error:", error);
      return [];
    }
  },

  // SUPER ULYSSE: Enrichir avec les mémoires VERIFIED (données scrapées validées)
  async enrichFromVerifiedMemories(userId: number, query: string): Promise<string[]> {
    try {
      if (!query) return [];
      const memories = await memoryService.getVerifiedMemories(userId);
      const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const enrichments: string[] = [];

      for (const mem of memories) {
        const text = `${mem.key} ${mem.value}`.toLowerCase();
        const overlap = keywords.filter(k => text.includes(k)).length;
        if (overlap >= 1) {
          enrichments.push(`[MEMORY_VERIFIED] ${mem.value.slice(0, 300)}`);
        }
      }

      return Array.from(new Set(enrichments)).slice(0, 5);
    } catch (error) {
      console.error("[AutonomousResearch] Verified memory enrichment error:", error);
      return [];
    }
  },

  // SUPER ULYSSE: Détecter si c'est une query structurée (sports/cotes/classements)
  isStructuredSportsQuery(query: string): boolean {
    return /classement|ranking|standings|buteur|scorer|cotes?|odds?|score|match|ligue\s*1|serie\s*a|premier\s*league|la\s*liga|bundesliga|champions\s*league/i.test(
      query.toLowerCase()
    );
  },

  // SUPER ULYSSE: Enrichir avec des scrapes vérifiés depuis les URLs MARS
  async enrichWithVerifiedScrapes(
    userId: number,
    marsResult: MARSSearchResult
  ): Promise<VerifiedScrapeData[]> {
    const urls = marsResult.orchestratorResponse.results
      .map(r => r.url)
      .filter(u => !!u)
      .slice(0, 3);

    const verifiedData: VerifiedScrapeData[] = [];

    for (const url of urls) {
      try {
        const { type, result } = await autoVerifiedScrape(url, undefined, { maxAttempts: 2 });
        if (result.ok && result.verified && result.data) {
          verifiedData.push({ 
            type, 
            url, 
            data: result.data,
            confidence: "verified"
          });
          console.log(`[AutonomousResearch] Verified scrape success: ${type} from ${url}`);
        }
      } catch (e) {
        console.warn("[AutonomousResearch] Verified scrape failed for", url);
      }
    }

    return verifiedData;
  },

  // SUPER ULYSSE: Normaliser les faits en français via Translation Core
  async normalizeFactLanguage(fact: string): Promise<{ normalized: string; wasTranslated: boolean }> {
    try {
      // Détection rapide si déjà en français (mots courants)
      const frenchWords = ["le", "la", "les", "de", "du", "des", "et", "ou", "est", "sont", "un", "une"];
      const words = fact.toLowerCase().split(/\s+/);
      const frenchCount = words.filter(w => frenchWords.includes(w)).length;
      
      // Si plus de 20% des mots sont français, on considère que c'est déjà en FR
      if (frenchCount / words.length > 0.2) {
        return { normalized: fact, wasTranslated: false };
      }

      const res = await translationService.translate({
        text: fact,
        targetLang: "fr",
        sourceLang: "auto",
        domain: "general",
        tone: "neutral"
      });
      
      return { 
        normalized: res.translated || fact,
        wasTranslated: res.translated !== fact
      };
    } catch (error) {
      return { normalized: fact, wasTranslated: false };
    }
  },

  async executeDeepResearch(
    userId: number, 
    query: string, 
    initialResult: MARSSearchResult,
    gapAnalysis: ResearchGapAnalysis
  ): Promise<EnrichedSearchResult> {
    const startTime = Date.now();
    const reformulations = gapAnalysis.suggestedQueries;
    const allFacts: Map<string, { fact: string; sources: Set<string>; confidence: string }> = new Map();
    
    for (const fact of initialResult.factAggregation?.facts || []) {
      const key = fact.content.toLowerCase().substring(0, 100);
      allFacts.set(key, {
        fact: fact.content,
        sources: new Set(fact.sources),
        confidence: fact.confidence
      });
    }
    
    let totalSearches = 1;
    const additionalResults: MARSSearchResult[] = [];
    
    const maxAdditionalSearches = gapAnalysis.needsDeepDive ? 2 : 1;
    const searchesToRun = reformulations.slice(0, maxAdditionalSearches);
    
    console.log(`[AutonomousResearch] Launching ${searchesToRun.length} additional searches for: "${query}"`);
    
    const queryKey = query.toLowerCase().substring(0, 50);
    
    for (const reformulation of searchesToRun) {
      try {
        console.log(`[AutonomousResearch] Searching: "${reformulation}"`);
        const result = await marsService.searchWithMARS(userId, reformulation, {
          maxDeepRead: 3,
          minReliabilityForDeepRead: 35,
          enableFactExtraction: true,
          enablePolicyEnforcement: false,
          freshnessRequired: false
        });
        
        const verifiedCount = result.factAggregation?.facts?.filter(f => f.confidence === "verified").length || 0;
        
        if (result.success) {
          additionalResults.push(result);
          totalSearches++;
          
          // AUTO-REGENERATION: Learn from successful searches
          this.learnFromResult(userId, queryKey, reformulation, true, verifiedCount);
          
          for (const fact of result.factAggregation?.facts || []) {
            const key = fact.content.toLowerCase().substring(0, 100);
            if (allFacts.has(key)) {
              const existing = allFacts.get(key)!;
              Array.from(fact.sources).forEach(source => {
                existing.sources.add(source);
              });
              if (fact.confidence === "verified" || (fact.confidence === "probable" && existing.confidence === "unverified")) {
                existing.confidence = fact.confidence;
              }
            } else {
              allFacts.set(key, {
                fact: fact.content,
                sources: new Set(fact.sources),
                confidence: fact.confidence
              });
            }
          }
        } else {
          // AUTO-REGENERATION: Learn from failed searches
          this.learnFromResult(userId, queryKey, reformulation, false, 0);
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.error(`[AutonomousResearch] Error searching "${reformulation}":`, error);
        this.learnFromResult(userId, queryKey, reformulation, false, 0);
      }
    }
    
    // SUPER ULYSSE: Enrichir avec mémoires normales + vérifiées
    const memoryEnrichment = await this.enrichFromMemory(userId, query);
    const verifiedMemoryEnrichment = await this.enrichFromVerifiedMemories(userId, query);
    
    // SUPER ULYSSE: Si query sports/structurée, lancer des scrapes vérifiés
    let verifiedScrapeData: VerifiedScrapeData[] = [];
    if (this.isStructuredSportsQuery(query)) {
      console.log(`[AutonomousResearch] SUPER ULYSSE: Structured sports query detected, launching verified scrapes`);
      verifiedScrapeData = await this.enrichWithVerifiedScrapes(userId, initialResult);
      
      // Injecter les données scrapées vérifiées comme faits avec confiance maximale
      for (const scrape of verifiedScrapeData) {
        const factText = typeof scrape.data === 'string' 
          ? scrape.data.slice(0, 500)
          : JSON.stringify(scrape.data).slice(0, 500);
        const key = factText.toLowerCase().substring(0, 100);
        
        if (!allFacts.has(key)) {
          allFacts.set(key, {
            fact: `[VERIFIED_SCRAPE:${scrape.type}] ${factText}`,
            sources: new Set([scrape.url, 'verified_scraper']),
            confidence: "verified"
          });
        }
      }
    }
    
    // SUPER ULYSSE: Normaliser les faits en français via Translation Core
    const normalizedFacts: Array<{ fact: string; sourceCount: number; confidence: "verified" | "probable" | "unverified"; isTranslated?: boolean }> = [];
    
    for (const f of Array.from(allFacts.values())) {
      const { normalized, wasTranslated } = await this.normalizeFactLanguage(f.fact);
      normalizedFacts.push({
        fact: normalized,
        sourceCount: f.sources.size,
        confidence: (f.sources.size >= 3 ? "verified" : f.sources.size >= 2 ? "probable" : "unverified") as "verified" | "probable" | "unverified",
        isTranslated: wasTranslated
      });
    }
    
    const crossReferencedFacts = normalizedFacts.sort((a, b) => b.sourceCount - a.sourceCount);
    
    const combinedResults = this.mergeResults(initialResult, additionalResults);
    
    let researchDepth: "shallow" | "standard" | "deep" | "exhaustive" = "standard";
    if (totalSearches >= 4) researchDepth = "exhaustive";
    else if (totalSearches >= 3) researchDepth = "deep";
    else if (totalSearches === 1) researchDepth = "shallow";
    
    console.log(`[AutonomousResearch] SUPER ULYSSE Completed: ${totalSearches} searches, ${crossReferencedFacts.length} facts, ${verifiedScrapeData.length} verified scrapes, depth: ${researchDepth}`);
    
    return {
      originalQuery: query,
      reformulations: searchesToRun,
      combinedResults,
      memoryEnrichment,
      verifiedMemoryEnrichment,
      verifiedScrapeData,
      crossReferencedFacts,
      researchDepth,
      totalSearches,
      executionTime: Date.now() - startTime
    };
  },

  mergeResults(primary: MARSSearchResult, additional: MARSSearchResult[]): MARSSearchResult {
    const allResults = [...primary.orchestratorResponse.results];
    const seenUrls = new Set(allResults.map(r => r.url));
    
    for (const result of additional) {
      for (const r of result.orchestratorResponse.results) {
        if (!seenUrls.has(r.url)) {
          allResults.push(r);
          seenUrls.add(r.url);
        }
      }
    }
    
    const allReliabilityScores = [...primary.reliabilityScores];
    const seenScoreUrls = new Set(allReliabilityScores.map(s => s.url));
    
    for (const result of additional) {
      for (const score of result.reliabilityScores) {
        if (!seenScoreUrls.has(score.url)) {
          allReliabilityScores.push(score);
          seenScoreUrls.add(score.url);
        }
      }
    }
    
    return {
      ...primary,
      orchestratorResponse: {
        ...primary.orchestratorResponse,
        results: allResults.slice(0, 15)
      },
      reliabilityScores: allReliabilityScores.slice(0, 15),
      policyDecision: {
        ...primary.policyDecision,
        confidenceLevel: allResults.length >= 8 ? "high" : allResults.length >= 5 ? "medium" : primary.policyDecision.confidenceLevel
      }
    };
  },

  formatEnrichedResultsForAI(enriched: EnrichedSearchResult): string {
    let formatted = `\n\n### 🔍 SUPER ULYSSE - RECHERCHE AUTONOME (${enriched.researchDepth.toUpperCase()}):\n`;
    formatted += `_${enriched.totalSearches} recherches, ${enriched.verifiedScrapeData?.length || 0} scrapes vérifiés, ${enriched.executionTime}ms_\n\n`;
    
    const verifiedFacts = enriched.crossReferencedFacts.filter(f => f.confidence === "verified");
    const probableFacts = enriched.crossReferencedFacts.filter(f => f.confidence === "probable");
    const weakFacts = enriched.crossReferencedFacts.filter(f => f.confidence === "unverified");
    
    // SUPER ULYSSE: Données scrapées vérifiées en premier (confiance maximale)
    if (enriched.verifiedScrapeData && enriched.verifiedScrapeData.length > 0) {
      formatted += `**📊 DONNÉES VÉRIFIÉES PAR SCRAPING (double-validation):**\n`;
      for (const scrape of enriched.verifiedScrapeData.slice(0, 5)) {
        const preview = typeof scrape.data === 'string' 
          ? scrape.data.slice(0, 200) 
          : JSON.stringify(scrape.data).slice(0, 200);
        formatted += `[SCRAPE:${scrape.type}] ${preview}... [${scrape.url}]\n`;
      }
      formatted += `\n`;
    }
    
    // Faits vérifiés multi-sources
    if (verifiedFacts.length > 0) {
      formatted += `**✅ FAITS VÉRIFIÉS (multi-sources - FIABLE):**\n`;
      for (const fact of verifiedFacts.slice(0, 8)) {
        const translatedTag = fact.isTranslated ? " [traduit]" : "";
        formatted += `[VERIFIED] ${fact.fact} [${fact.sourceCount} sources]${translatedTag}\n`;
      }
      formatted += `\n`;
    }
    
    // Faits probables
    if (probableFacts.length > 0) {
      formatted += `**🔶 FAITS PROBABLES (2 sources - À NUANCER):**\n`;
      for (const fact of probableFacts.slice(0, 5)) {
        const translatedTag = fact.isTranslated ? " [traduit]" : "";
        formatted += `[PROBABLE] ${fact.fact} [${fact.sourceCount} sources]${translatedTag}\n`;
      }
      formatted += `\n`;
    }
    
    // SUPER ULYSSE: Faits faibles avec avertissement clair
    if (weakFacts.length > 0) {
      formatted += `**⚠️ FAITS FAIBLES (1 seule source - À TRAITER AVEC PRUDENCE):**\n`;
      for (const fact of weakFacts.slice(0, 5)) {
        formatted += `[WEAK] ${fact.fact} [${fact.sourceCount} source]\n`;
      }
      formatted += `\n`;
    }
    
    // Mémoires vérifiées en priorité
    if (enriched.verifiedMemoryEnrichment && enriched.verifiedMemoryEnrichment.length > 0) {
      formatted += `**🧠 MÉMOIRE VÉRIFIÉE:**\n`;
      for (const memory of enriched.verifiedMemoryEnrichment) {
        formatted += `${memory}\n`;
      }
      formatted += `\n`;
    }
    
    // Mémoires normales
    if (enriched.memoryEnrichment.length > 0) {
      formatted += `**📝 ENRICHISSEMENT MÉMOIRE:**\n`;
      for (const memory of enriched.memoryEnrichment) {
        formatted += `${memory}\n`;
      }
      formatted += `\n`;
    }
    
    formatted += `**📚 SOURCES CONSULTÉES (${enriched.combinedResults.orchestratorResponse.results.length}):**\n`;
    const topResults = enriched.combinedResults.orchestratorResponse.results.slice(0, 8);
    for (let i = 0; i < topResults.length; i++) {
      const result = topResults[i];
      const score = enriched.combinedResults.reliabilityScores[i];
      const scoreLabel = score ? ` [${score.confidence}:${score.total}]` : "";
      formatted += `${i + 1}. **${result.title}**${scoreLabel}\n`;
      formatted += `   ${result.snippet.substring(0, 100)}...\n`;
    }
    
    if (enriched.reformulations.length > 0) {
      formatted += `\n_Recherches: "${enriched.originalQuery}" + ${enriched.reformulations.length} reformulations_\n`;
    }
    
    // SUPER ULYSSE: Règle d'utilisation explicite
    formatted += `\n> **RÈGLE D'UTILISATION:** Base-toi d'abord sur les DONNÉES VÉRIFIÉES et FAITS VÉRIFIÉS. Les PROBABLES peuvent être mentionnés avec nuance. Les WEAK ne doivent JAMAIS être présentés comme des certitudes - indique clairement l'incertitude.\n`;
    
    return formatted;
  },

  async searchWithAutonomy(userId: number, query: string): Promise<{
    result: MARSSearchResult | EnrichedSearchResult;
    wasEnriched: boolean;
    gapAnalysis: ResearchGapAnalysis | null;
    formattedForAI: string;
  }> {
    const initialResult = await marsService.searchWithMARS(userId, query);
    
    if (!initialResult.success) {
      return {
        result: initialResult,
        wasEnriched: false,
        gapAnalysis: null,
        formattedForAI: initialResult.formattedForAI
      };
    }
    
    let gapAnalysis = this.analyzeGaps(userId, initialResult);
    let attemptCount = 0;
    let currentResult: MARSSearchResult | EnrichedSearchResult = initialResult;
    let wasEnriched = false;
    
    console.log(`[AutonomousResearch] Gap analysis for "${query}":`, {
      hasGaps: gapAnalysis.hasGaps,
      gapTypes: gapAnalysis.gapTypes,
      needsDeepDive: gapAnalysis.needsDeepDive,
      verifiedFacts: gapAnalysis.verifiedFactsCount
    });
    
    // AUTO-REGENERATION: Retry loop with different strategies
    while (gapAnalysis.needsDeepDive && this.shouldRetryWithDifferentStrategy(gapAnalysis, attemptCount)) {
      attemptCount++;
      console.log(`[AutonomousResearch] Deep dive attempt ${attemptCount} - launching autonomous research`);
      
      const enrichedResult = await this.executeDeepResearch(userId, query, initialResult, gapAnalysis);
      currentResult = enrichedResult;
      wasEnriched = true;
      
      // Re-analyze gaps after deep research to see if we need another attempt
      const verifiedFactsAfter = enrichedResult.crossReferencedFacts.filter(f => f.confidence === "verified").length;
      const probableFactsAfter = enrichedResult.crossReferencedFacts.filter(f => f.confidence === "probable").length;
      
      // Update gap analysis based on enriched results
      gapAnalysis = {
        ...gapAnalysis,
        verifiedFactsCount: verifiedFactsAfter,
        probableFactsCount: probableFactsAfter,
        needsDeepDive: verifiedFactsAfter < this.MIN_VERIFIED_FACTS && probableFactsAfter < 3
      };
      
      console.log(`[AutonomousResearch] After attempt ${attemptCount}: verified=${verifiedFactsAfter}, probable=${probableFactsAfter}`);
      
      // If we got enough facts, break
      if (verifiedFactsAfter >= this.MIN_VERIFIED_FACTS || probableFactsAfter >= 3) {
        break;
      }
    }
    
    if (wasEnriched) {
      const formattedForAI = this.formatEnrichedResultsForAI(currentResult as EnrichedSearchResult);
      return {
        result: currentResult,
        wasEnriched: true,
        gapAnalysis,
        formattedForAI
      };
    }
    
    // Single deep dive if needed but retry not triggered
    if (gapAnalysis.needsDeepDive) {
      console.log(`[AutonomousResearch] Deep dive required - launching autonomous research`);
      
      const enrichedResult = await this.executeDeepResearch(userId, query, initialResult, gapAnalysis);
      const formattedForAI = this.formatEnrichedResultsForAI(enrichedResult);
      
      return {
        result: enrichedResult,
        wasEnriched: true,
        gapAnalysis,
        formattedForAI
      };
    }
    
    return {
      result: initialResult,
      wasEnriched: false,
      gapAnalysis,
      formattedForAI: initialResult.formattedForAI
    };
  }
};
