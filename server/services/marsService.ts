/**
 * MARS - Multi-source Accurate Research System
 * Main orchestration service combining all modules
 * 
 * Pipeline:
 * 1. Search Orchestrator → Multi-engine parallel search
 * 2. Content Fetcher → Deep reading of top sources
 * 3. Reliability Scorer → 4-axis scoring
 * 4. Fact Aggregator → Semantic extraction and cross-referencing
 * 5. Response Policy → Anti-approximation enforcement
 */

import { orchestrateSearch, OrchestratorResponse, formatOrchestratorResultsForAI } from "./searchOrchestrator";
import { fetchMultiple, ExtractedContent } from "./contentFetcher";
import { calculateReliability, ReliabilityScore, calculateQuickReliability } from "./reliabilityScorer";
import { aggregateFacts, FactAggregation, formatFactsForAI } from "./factAggregator";
import { classifyQuery, evaluateResponsePolicy, generateResponseTemplate, PolicyDecision, formatPolicyReport } from "./responsePolicy";
import { createAuditEntry, logMarsQuery, MarsAuditEntry, safeGetHostname } from "./marsAuditService";
import { db } from "../db";
import { webSearchMemory, marsSearchHistory } from "@shared/schema";
import { eq, desc, gte, and, like } from "drizzle-orm";

export interface MARSSearchResult {
  query: string;
  queryType: string;
  orchestratorResponse: OrchestratorResponse;
  extractedContents: ExtractedContent[];
  reliabilityScores: ReliabilityScore[];
  factAggregation: FactAggregation;
  policyDecision: PolicyDecision;
  formattedForAI: string;
  totalTime: number;
  success: boolean;
  error?: string;
}

export interface MARSConfig {
  maxDeepRead: number;
  minReliabilityForDeepRead: number;
  enableFactExtraction: boolean;
  enablePolicyEnforcement: boolean;
  freshnessRequired: boolean;
  maxTotalTimeMs: number;        // Time budget total
  enableEarlyExit: boolean;      // Exit early if direct answer found
  minDirectAnswerConfidence: number; // Seuil pour early exit
}

const DEFAULT_CONFIG: MARSConfig = {
  maxDeepRead: 5,
  minReliabilityForDeepRead: 40,
  enableFactExtraction: true,
  enablePolicyEnforcement: true,
  freshnessRequired: false,
  maxTotalTimeMs: 15000,         // 15s max total
  enableEarlyExit: true,         // Exit early if high confidence answer
  minDirectAnswerConfidence: 0.7 // 70% pour skip deep read
};

export async function searchWithMARS(
  userId: number,
  query: string,
  config: Partial<MARSConfig> = {}
): Promise<MARSSearchResult> {
  const startTime = Date.now();
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  console.log(`[MARS] Starting search for user ${userId}: "${query}"`);
  
  // Filter out ambiguous/conversational queries that won't yield useful results
  const ambiguousPatterns = [
    /^(ok|oui|non|d'accord|compris|entendu|merci|super|parfait|génial)$/i,
    /^50\/50/i, // Expression de jeu télévisé, pas une recherche
    /^et les \d+$/i,
    /^(c'est bon|ça marche|vas-y|go|let's go)$/i
  ];
  
  const isAmbiguous = ambiguousPatterns.some(p => p.test(query.trim())) || 
                      query.trim().length < 5 ||
                      query.split(/\s+/).length < 2;
  
  if (isAmbiguous) {
    console.log(`[MARS] Query too ambiguous, skipping: "${query}"`);
    const result: MARSSearchResult = {
      query,
      queryType: "ambiguous",
      orchestratorResponse: { results: [], directAnswers: [], engineStats: { serper: { success: false, resultCount: 0, timeMs: 0 }, perplexity: { success: false, resultCount: 0, timeMs: 0 } }, totalTime: 0, success: false },
      extractedContents: [],
      reliabilityScores: [],
      factAggregation: { facts: [], summary: "Requête trop vague pour une recherche fiable", overallConfidence: 0, controversies: [], dataGaps: ["Reformulez avec plus de détails"] },
      policyDecision: { canRespond: false, confidenceLevel: "insufficient", reasoning: "Ambiguous query", warnings: ["Requête ambiguë"], recommendations: ["Précisez votre recherche"], mustDisclaim: true, disclaimers: [] },
      formattedForAI: `[MARS: Requête "${query}" trop vague - précisez ce que vous cherchez]`,
      totalTime: 0,
      success: false,
      error: "Query too ambiguous"
    };
    buildAndLogAudit(result, { earlyExitReason: 'no_better_sources' });
    return result;
  }
  
  try {
    const queryType = classifyQuery(query);
    console.log(`[MARS] Query classified as: ${queryType}`);
    
    if (queryType === "conversational") {
      const result: MARSSearchResult = {
        query,
        queryType,
        orchestratorResponse: { results: [], directAnswers: [], engineStats: { serper: { success: true, resultCount: 0, timeMs: 0 }, perplexity: { success: true, resultCount: 0, timeMs: 0 } }, totalTime: 0, success: true },
        extractedContents: [],
        reliabilityScores: [],
        factAggregation: { facts: [], summary: "Message conversationnel - pas de recherche nécessaire", overallConfidence: 100, controversies: [], dataGaps: [] },
        policyDecision: { canRespond: true, confidenceLevel: "high", reasoning: "Conversational message - no search needed", warnings: [], recommendations: [], mustDisclaim: false, disclaimers: [] },
        formattedForAI: "",
        totalTime: Date.now() - startTime,
        success: true
      };
      buildAndLogAudit(result, { wasEarlyExit: true, earlyExitReason: 'no_better_sources' });
      return result;
    }
    
    if (queryType === "temporal" || queryType === "news") {
      cfg.freshnessRequired = true;
    }
    
    // ══════════════════════════════════════════════════════════════════
    // SPORTS ROUTING - Use specialized handlers with Djedou Pronos cache
    // ══════════════════════════════════════════════════════════════════
    if (queryType === "sports_football") {
      return await searchSportsFootballWithMARS(userId, query, startTime);
    }
    
    if (queryType === "sports_basketball") {
      return await searchSportsBasketballWithMARS(userId, query, startTime);
    }
    
    if (queryType === "sports_motorsport") {
      // F1/Motorsport - fall through to generic search for now
      console.log(`[MARS] Motorsport query - using generic search`);
    }
    
    const orchestratorResponse = await orchestrateSearch(query, 10);
    const elapsedAfterSearch = Date.now() - startTime;
    
    if (!orchestratorResponse.success) {
      const failedResult: MARSSearchResult = {
        query,
        queryType,
        orchestratorResponse,
        extractedContents: [],
        reliabilityScores: [],
        factAggregation: { facts: [], summary: "Aucune donnée", overallConfidence: 0, controversies: [], dataGaps: ["Recherche échouée"] },
        policyDecision: { canRespond: false, confidenceLevel: "insufficient", reasoning: "Search failed", warnings: [], recommendations: [], mustDisclaim: true, disclaimers: [] },
        formattedForAI: `[MARS: Recherche échouée - ${orchestratorResponse.error}]`,
        totalTime: Date.now() - startTime,
        success: false,
        error: orchestratorResponse.error
      };
      buildAndLogAudit(failedResult);
      return failedResult;
    }
    
    // ══════════════════════════════════════════════════════════════════
    // EARLY EXIT: Si réponse directe haute confiance, skip deep read
    // ══════════════════════════════════════════════════════════════════
    const hasDirectAnswer = orchestratorResponse.directAnswers.length > 0;
    const hasPerplexityAnswer = orchestratorResponse.directAnswers.some(a => a.engine === "perplexity" && a.answer.length > 100);
    const hasGoodResults = orchestratorResponse.results.length >= 5;
    
    // Calculer la confiance initiale
    const initialConfidence = hasPerplexityAnswer ? 0.85 : 
                              hasDirectAnswer && hasGoodResults ? 0.75 :
                              hasDirectAnswer ? 0.6 : 0.4;
    
    // Vérifier time budget et conditions early exit
    const timeRemaining = cfg.maxTotalTimeMs - elapsedAfterSearch;
    const shouldEarlyExit = cfg.enableEarlyExit && 
                            initialConfidence >= cfg.minDirectAnswerConfidence &&
                            hasDirectAnswer;
    
    if (shouldEarlyExit) {
      console.log(`[MARS] ⚡ EARLY EXIT: Direct answer found (confidence: ${(initialConfidence * 100).toFixed(0)}%), skipping deep read`);
      
      // Créer une réponse rapide basée sur les réponses directes
      const fastFactAggregation: FactAggregation = {
        facts: orchestratorResponse.directAnswers.map((da, i) => ({
          claim: da.answer.substring(0, 500),
          confidence: da.engine === "perplexity" ? 85 : 70,
          sources: da.citations.slice(0, 3),
          sourceCount: da.citations.length,
          verified: true
        })),
        summary: orchestratorResponse.directAnswers[0]?.answer || "Réponse directe disponible",
        overallConfidence: initialConfidence * 100,
        controversies: [],
        dataGaps: []
      };
      
      // IMPORTANT: Still run policy evaluation even on early exit
      let fastPolicyDecision: PolicyDecision;
      if (cfg.enablePolicyEnforcement) {
        fastPolicyDecision = evaluateResponsePolicy(
          queryType as any,
          fastFactAggregation,
          [], // No reliability scores in early exit
          cfg.freshnessRequired
        );
        console.log(`[MARS] Early exit policy: ${fastPolicyDecision.confidenceLevel}`);
      } else {
        fastPolicyDecision = {
          canRespond: true,
          confidenceLevel: initialConfidence >= 0.8 ? "high" : "medium",
          reasoning: "Early exit - policy enforcement disabled",
          warnings: [],
          recommendations: [],
          mustDisclaim: false,
          disclaimers: []
        };
      }
      
      const formattedForAI = formatMARSResults({
        extractedContents: [],
        orchestratorResponse,
        factAggregation: fastFactAggregation,
        policyDecision: fastPolicyDecision,
        reliabilityScores: [],
        queryType
      });
      
      await saveSearchToMemory(userId, query, queryType, fastFactAggregation, [], fastPolicyDecision);
      
      const earlyExitResult: MARSSearchResult = {
        query,
        queryType,
        orchestratorResponse,
        extractedContents: [],
        reliabilityScores: [],
        factAggregation: fastFactAggregation,
        policyDecision: fastPolicyDecision,
        formattedForAI,
        totalTime: Date.now() - startTime,
        success: true
      };
      buildAndLogAudit(earlyExitResult, { 
        wasEarlyExit: true, 
        earlyExitReason: 'high_confidence_answer',
        timeBudgetMs: cfg.maxTotalTimeMs
      });
      return earlyExitResult;
    }
    
    // ══════════════════════════════════════════════════════════════════
    // HARD TIME BUDGET: Skip deep read entirely if budget exhausted
    // ══════════════════════════════════════════════════════════════════
    if (timeRemaining <= 0) {
      console.log(`[MARS] ⏱️ TIME BUDGET EXHAUSTED (${timeRemaining}ms) - returning orchestrator results only`);
      
      const minimalFacts: FactAggregation = {
        facts: orchestratorResponse.results.slice(0, 3).map(r => ({
          claim: r.snippet,
          confidence: 50,
          sources: [r.url],
          sourceCount: 1,
          verified: false
        })),
        summary: orchestratorResponse.directAnswers[0]?.answer || "Résultats partiels (time budget atteint)",
        overallConfidence: 40,
        controversies: [],
        dataGaps: ["Analyse approfondie non effectuée (time budget)"]
      };
      
      const timeoutPolicy: PolicyDecision = cfg.enablePolicyEnforcement
        ? evaluateResponsePolicy(queryType as any, minimalFacts, [], cfg.freshnessRequired)
        : { canRespond: true, confidenceLevel: "low", reasoning: "Time budget exceeded", warnings: ["Analyse incomplète"], recommendations: [], mustDisclaim: true, disclaimers: ["Résultats partiels"] };
      
      const formattedForAI = formatMARSResults({
        extractedContents: [],
        orchestratorResponse,
        factAggregation: minimalFacts,
        policyDecision: timeoutPolicy,
        reliabilityScores: [],
        queryType
      });
      
      const budgetExhaustedResult: MARSSearchResult = {
        query,
        queryType,
        orchestratorResponse,
        extractedContents: [],
        reliabilityScores: [],
        factAggregation: minimalFacts,
        policyDecision: timeoutPolicy,
        formattedForAI,
        totalTime: Date.now() - startTime,
        success: true
      };
      buildAndLogAudit(budgetExhaustedResult, { 
        wasBudgetHit: true,
        earlyExitReason: 'time_budget_exhausted',
        timeBudgetMs: cfg.maxTotalTimeMs
      });
      return budgetExhaustedResult;
    }
    
    // Limit deep read based on remaining time
    if (timeRemaining < 3000) {
      console.log(`[MARS] ⏱️ Time budget low (${timeRemaining}ms left), limiting deep read`);
    }
    
    const urlsForDeepRead = orchestratorResponse.results
      .filter(r => calculateQuickReliability(r.url) >= cfg.minReliabilityForDeepRead)
      .slice(0, timeRemaining < 5000 ? 2 : timeRemaining < 8000 ? 3 : cfg.maxDeepRead)
      .map(r => r.url);
    
    console.log(`[MARS] Deep reading ${urlsForDeepRead.length} URLs (${timeRemaining}ms remaining)...`);
    
    const extractedContents = await fetchMultiple(urlsForDeepRead);
    const successfulContents = extractedContents.filter(c => c.success);
    
    console.log(`[MARS] Extracted ${successfulContents.length}/${urlsForDeepRead.length} pages`);
    
    const reliabilityScores: ReliabilityScore[] = [];
    for (const content of successfulContents) {
      const score = calculateReliability(content, successfulContents, []);
      reliabilityScores.push(score);
    }
    
    let factAggregation: FactAggregation;
    if (cfg.enableFactExtraction && successfulContents.length > 0) {
      factAggregation = await aggregateFacts(successfulContents, query);
    } else {
      const reason = !cfg.enableFactExtraction 
        ? "Extraction de faits désactivée"
        : successfulContents.length === 0 && urlsForDeepRead.length === 0
          ? "Aucune source fiable trouvée pour cette recherche"
          : successfulContents.length === 0
            ? `Échec d'extraction de ${urlsForDeepRead.length} source(s) - contenu inaccessible`
            : "Aucun contenu disponible";
      
      console.log(`[MARS] Fact extraction skipped: ${reason}`);
      
      factAggregation = {
        facts: [],
        summary: reason,
        overallConfidence: 0,
        controversies: [],
        dataGaps: urlsForDeepRead.length === 0 ? ["Aucune source fiable"] : ["Sources inaccessibles"]
      };
    }
    
    let policyDecision: PolicyDecision;
    if (cfg.enablePolicyEnforcement) {
      policyDecision = evaluateResponsePolicy(
        queryType as any,
        factAggregation,
        reliabilityScores,
        cfg.freshnessRequired
      );
    } else {
      policyDecision = {
        canRespond: true,
        confidenceLevel: "medium",
        reasoning: "Policy enforcement disabled",
        warnings: [],
        recommendations: [],
        mustDisclaim: false,
        disclaimers: []
      };
    }
    
    const formattedForAI = formatMARSResults({
      extractedContents: successfulContents,
      orchestratorResponse,
      factAggregation,
      policyDecision,
      reliabilityScores,
      queryType
    });
    
    await saveSearchToMemory(userId, query, queryType, factAggregation, reliabilityScores, policyDecision);
    
    // Save to MARS history with 31-day TTL
    await saveToMarsHistory(userId, query, queryType, {
      orchestratorResponse,
      extractedContents: successfulContents,
      factAggregation,
      policyDecision,
      reliabilityScores
    });
    
    const totalTime = Date.now() - startTime;
    console.log(`[MARS] Search complete in ${totalTime}ms - Confidence: ${policyDecision.confidenceLevel}`);
    
    const successResult: MARSSearchResult = {
      query,
      queryType,
      orchestratorResponse,
      extractedContents,
      reliabilityScores,
      factAggregation,
      policyDecision,
      formattedForAI,
      totalTime,
      success: true
    };
    buildAndLogAudit(successResult, {
      timeBudgetMs: cfg.maxTotalTimeMs,
      smartCrawlTimeMs: totalTime - (orchestratorResponse.totalTime || 0)
    });
    return successResult;
  } catch (error) {
    console.error("[MARS] Error:", error);
    const errorResult: MARSSearchResult = {
      query,
      queryType: "factual",
      orchestratorResponse: { results: [], directAnswers: [], engineStats: { serper: { success: false, resultCount: 0, timeMs: 0 }, perplexity: { success: false, resultCount: 0, timeMs: 0 } }, totalTime: 0, success: false },
      extractedContents: [],
      reliabilityScores: [],
      factAggregation: { facts: [], summary: "Erreur", overallConfidence: 0, controversies: [], dataGaps: [] },
      policyDecision: { canRespond: false, confidenceLevel: "insufficient", reasoning: "Error", warnings: [], recommendations: [], mustDisclaim: true, disclaimers: [] },
      formattedForAI: `[MARS: Erreur - ${error instanceof Error ? error.message : "Unknown"}]`,
      totalTime: Date.now() - startTime,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
    buildAndLogAudit(errorResult);
    return errorResult;
  }
}

function formatMARSResults(data: {
  orchestratorResponse: OrchestratorResponse;
  factAggregation: FactAggregation;
  policyDecision: PolicyDecision;
  reliabilityScores: ReliabilityScore[];
  queryType: string;
  extractedContents?: ExtractedContent[];
}): string {
  const { orchestratorResponse, factAggregation, policyDecision, reliabilityScores, queryType, extractedContents } = data;
  
  const template = generateResponseTemplate(policyDecision);
  let formatted = template.prefix;
  
  formatted += `### Résultats MARS (Multi-source Accurate Research)\n\n`;
  formatted += `**Type:** ${queryType} | **Confiance:** ${policyDecision.confidenceLevel} | **Sources:** ${reliabilityScores.length}\n\n`;
  
  if (orchestratorResponse.directAnswers.length > 0) {
    formatted += `**Réponses directes:**\n`;
    for (const da of orchestratorResponse.directAnswers) {
      formatted += `\n[${da.engine.toUpperCase()}]:\n${da.answer}\n`;
      if (da.citations.length > 0) {
        formatted += `_Sources: ${da.citations.slice(0, 3).join(", ")}_\n`;
      }
    }
    formatted += `\n`;
  }
  
  if (factAggregation.facts.length > 0) {
    const verifiedFacts = factAggregation.facts.filter(f => f.confidence === "verified");
    const probableFacts = factAggregation.facts.filter(f => f.confidence === "probable");
    
    if (verifiedFacts.length > 0) {
      formatted += `**Faits vérifiés (multi-sources):**\n`;
      for (const fact of verifiedFacts.slice(0, 5)) {
        formatted += `✅ ${fact.content} [${fact.consensus} sources]\n`;
      }
      formatted += `\n`;
    }
    
    if (probableFacts.length > 0) {
      formatted += `**Faits probables:**\n`;
      for (const fact of probableFacts.slice(0, 3)) {
        formatted += `⚡ ${fact.content}\n`;
      }
      formatted += `\n`;
    }
  }
  
  if (factAggregation.controversies.length > 0) {
    formatted += `**⚠️ Divergences détectées:**\n`;
    for (const c of factAggregation.controversies) {
      formatted += `- ${c}\n`;
    }
    formatted += `\n`;
  }
  
  // Include crawled page content for AI analysis
  if (extractedContents && extractedContents.length > 0) {
    formatted += `\n═══════════════════════════════════════\n`;
    formatted += `**📄 CONTENU CRAWLÉ DES PAGES (utilise ces données!):**\n`;
    formatted += `═══════════════════════════════════════\n\n`;
    
    for (const content of extractedContents.slice(0, 3)) {
      if (content.success && content.text) {
        formatted += `### ${content.title}\n`;
        formatted += `_Source: ${content.url}_\n`;
        if (content.publishDate) {
          formatted += `_Date: ${content.publishDate}_\n`;
        }
        formatted += `\n`;
        // Limit content to 2000 chars per page to avoid token overflow
        const trimmedText = content.text.length > 2000 
          ? content.text.substring(0, 2000) + "...[suite disponible]" 
          : content.text;
        formatted += `${trimmedText}\n\n`;
        formatted += `---\n\n`;
      }
    }
  }
  
  formatted += `**Sources consultées:**\n`;
  const topResults = orchestratorResponse.results.slice(0, 8);
  for (let i = 0; i < topResults.length; i++) {
    const result = topResults[i];
    const score = reliabilityScores[i];
    const scoreLabel = score ? ` [${score.confidence}:${score.total}]` : "";
    formatted += `${i + 1}. **${result.title}**${scoreLabel}\n`;
    formatted += `   ${result.snippet.substring(0, 150)}...\n`;
    formatted += `   _${result.url}_\n\n`;
  }
  
  if (policyDecision.mustDisclaim && policyDecision.disclaimers.length > 0) {
    formatted += `\n---\n**Avertissements:**\n`;
    for (const d of policyDecision.disclaimers) {
      formatted += `- ⚠️ ${d}\n`;
    }
  }
  
  formatted += template.suffix;
  
  return formatted;
}

async function saveSearchToMemory(
  userId: number,
  query: string,
  queryType: string,
  factAggregation: FactAggregation,
  scores: ReliabilityScore[],
  policyDecision: PolicyDecision
): Promise<void> {
  try {
    const avgScore = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b.total, 0) / scores.length)
      : 0;
    
    const verifiedFacts = factAggregation.facts.filter(f => f.confidence === "verified");
    const probableFacts = factAggregation.facts.filter(f => f.confidence === "probable");
    
    // Save verified facts with high confidence
    for (const fact of verifiedFacts.slice(0, 3)) {
      await db.insert(webSearchMemory).values({
        userId,
        query,
        topic: queryType,
        sources: fact.sources.map(url => ({ url, title: "", snippet: fact.content })),
        keyFindings: [fact.content],
        learnedInsights: `MARS verified: ${fact.content} from ${fact.sources.length} sources`,
        usefulnessScore: avgScore,
        reliabilityScore: avgScore,
        tags: ["mars", "verified", fact.type],
        category: fact.type,
        domain: queryType,
        confidenceScore: 90,
        expiresAt: queryType === "temporal" ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null,
        policyReport: {
          confidenceLevel: policyDecision.confidenceLevel,
          canRespond: policyDecision.canRespond,
          reasoning: policyDecision.reasoning
        }
      });
    }
    
    // Save probable facts with medium confidence
    for (const fact of probableFacts.slice(0, 2)) {
      await db.insert(webSearchMemory).values({
        userId,
        query,
        topic: queryType,
        sources: fact.sources.map(url => ({ url, title: "", snippet: fact.content })),
        keyFindings: [fact.content],
        learnedInsights: `MARS probable: ${fact.content}`,
        usefulnessScore: Math.round(avgScore * 0.7),
        reliabilityScore: Math.round(avgScore * 0.7),
        tags: ["mars", "probable", fact.type],
        category: fact.type,
        domain: queryType,
        confidenceScore: 60,
        expiresAt: queryType === "temporal" ? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) : null,
        policyReport: {
          confidenceLevel: policyDecision.confidenceLevel,
          reasoning: policyDecision.reasoning
        }
      });
    }
    
    // Always save search summary even if no verified facts
    if (verifiedFacts.length === 0 && probableFacts.length === 0 && scores.length > 0) {
      await db.insert(webSearchMemory).values({
        userId,
        query,
        topic: queryType,
        sources: scores.slice(0, 3).map(s => ({ url: s.domain, title: "", snippet: "" })),
        keyFindings: factAggregation.dataGaps.length > 0 ? factAggregation.dataGaps : ["Aucun fait vérifié extrait"],
        learnedInsights: `MARS search: ${policyDecision.reasoning}`,
        usefulnessScore: avgScore,
        reliabilityScore: avgScore,
        tags: ["mars", "search", policyDecision.confidenceLevel],
        category: "search",
        domain: queryType,
        confidenceScore: policyDecision.confidenceLevel === "high" ? 80 : policyDecision.confidenceLevel === "medium" ? 50 : 30,
        expiresAt: null,
        policyReport: {
          confidenceLevel: policyDecision.confidenceLevel,
          canRespond: policyDecision.canRespond,
          reasoning: policyDecision.reasoning,
          controversies: factAggregation.controversies
        }
      });
    }
    
    const savedCount = verifiedFacts.length + Math.min(probableFacts.length, 2) + (verifiedFacts.length === 0 && probableFacts.length === 0 && scores.length > 0 ? 1 : 0);
    if (savedCount > 0) {
      console.log(`[MARS] Saved ${savedCount} items to memory (verified: ${verifiedFacts.length}, probable: ${Math.min(probableFacts.length, 2)})`);
    }
  } catch (error) {
    console.error("[MARS] Error saving to memory:", error);
  }
}

export async function getMARSMetrics(userId: number, daysBack: number = 30): Promise<{
  totalSearches: number;
  avgReliability: number;
  verifiedFactsCount: number;
  probableFactsCount: number;
  insufficientCount: number;
  topQueryTypes: { type: string; count: number }[];
  controversiesDetected: number;
  highConfidenceRate: number;
}> {
  try {
    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    
    // Get all MARS-tagged searches for this user
    const searches = await db.select()
      .from(webSearchMemory)
      .where(eq(webSearchMemory.userId, userId))
      .limit(1000);
    
    // Filter to MARS searches and within date range
    const marsSearches = searches.filter(s => 
      s.tags && s.tags.includes("mars") && 
      s.createdAt && new Date(s.createdAt) >= cutoff
    );
    
    const queryTypes: Record<string, number> = {};
    let totalReliability = 0;
    let verifiedCount = 0;
    let probableCount = 0;
    let insufficientCount = 0;
    let controversiesCount = 0;
    
    for (const search of marsSearches) {
      if (search.topic) {
        queryTypes[search.topic] = (queryTypes[search.topic] || 0) + 1;
      }
      if (search.reliabilityScore) {
        totalReliability += search.reliabilityScore;
      }
      if (search.tags && search.tags.includes("verified")) {
        verifiedCount++;
      }
      if (search.tags && search.tags.includes("probable")) {
        probableCount++;
      }
      if (search.tags && search.tags.includes("insufficient")) {
        insufficientCount++;
      }
      // Check for controversies in policy report
      const report = search.policyReport as any;
      if (report && report.controversies && Array.isArray(report.controversies)) {
        controversiesCount += report.controversies.length;
      }
    }
    
    const topQueryTypes = Object.entries(queryTypes)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    
    const highConfidenceSearches = marsSearches.filter(s => s.confidenceScore && s.confidenceScore >= 70);
    
    return {
      totalSearches: marsSearches.length,
      avgReliability: marsSearches.length > 0 ? Math.round(totalReliability / marsSearches.length) : 0,
      verifiedFactsCount: verifiedCount,
      probableFactsCount: probableCount,
      insufficientCount,
      topQueryTypes,
      controversiesDetected: controversiesCount,
      highConfidenceRate: marsSearches.length > 0 ? Math.round((highConfidenceSearches.length / marsSearches.length) * 100) : 0
    };
  } catch (error) {
    console.error("[MARS] Metrics error:", error);
    return {
      totalSearches: 0,
      avgReliability: 0,
      verifiedFactsCount: 0,
      probableFactsCount: 0,
      insufficientCount: 0,
      topQueryTypes: [],
      controversiesDetected: 0,
      highConfidenceRate: 0
    };
  }
}

// Save MARS search to history with 31-day TTL
async function saveToMarsHistory(
  userId: number,
  query: string,
  queryType: string,
  data: {
    orchestratorResponse: OrchestratorResponse;
    extractedContents: ExtractedContent[];
    factAggregation: FactAggregation;
    policyDecision: PolicyDecision;
    reliabilityScores: ReliabilityScore[];
  }
): Promise<void> {
  try {
    const { orchestratorResponse, extractedContents, factAggregation, policyDecision, reliabilityScores } = data;
    
    // Calculate expiration date (31 days from now)
    const expiresAt = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    
    // Extract verified facts
    const verifiedFacts = factAggregation.facts
      .filter(f => f.confidence === "verified")
      .slice(0, 10)
      .map(f => ({
        content: f.content,
        sources: f.sources,
        consensus: f.consensus
      }));
    
    // Extract top sources with reliability scores
    const topSources = orchestratorResponse.results.slice(0, 10).map((r, i) => ({
      url: r.url,
      title: r.title,
      reliabilityScore: reliabilityScores[i]?.total || 0
    }));
    
    // Compress crawled content to summary (first 3000 chars total)
    const crawledSummary = extractedContents
      .filter(c => c.success && c.text)
      .slice(0, 3)
      .map(c => `[${c.title}]: ${c.text.substring(0, 1000)}`)
      .join("\n\n")
      .substring(0, 3000);
    
    // Extract direct answers
    const directAnswers = orchestratorResponse.directAnswers.map(da => ({
      engine: da.engine,
      answer: da.answer.substring(0, 2000),
      citations: da.citations.slice(0, 5)
    }));
    
    await db.insert(marsSearchHistory).values({
      userId,
      query,
      queryType,
      success: true,
      totalTime: 0,
      sourceCount: orchestratorResponse.results.length,
      verifiedFactCount: verifiedFacts.length,
      confidenceLevel: policyDecision.confidenceLevel,
      directAnswers,
      verifiedFacts,
      topSources,
      crawledContent: crawledSummary,
      canRespond: policyDecision.canRespond,
      disclaimers: policyDecision.disclaimers,
      expiresAt
    });
    
    console.log(`[MARS] Saved to history: "${query.substring(0, 50)}..." (expires ${expiresAt.toISOString().split('T')[0]})`);
  } catch (error) {
    console.error("[MARS] Failed to save to history:", error);
  }
}

// Get MARS search history for Ulysse consultation
export async function getMarsHistory(
  userId: number,
  options: {
    limit?: number;
    queryFilter?: string;
    minConfidence?: string;
  } = {}
): Promise<{
  searches: Array<{
    id: number;
    query: string;
    queryType: string;
    confidenceLevel: string | null;
    sourceCount: number | null;
    verifiedFactCount: number | null;
    directAnswers: any;
    verifiedFacts: any;
    topSources: any;
    crawledContent: string | null;
    createdAt: Date | null;
    expiresAt: Date;
  }>;
  total: number;
}> {
  try {
    const { limit = 50, queryFilter, minConfidence } = options;
    
    let query = db.select()
      .from(marsSearchHistory)
      .where(
        and(
          eq(marsSearchHistory.userId, userId),
          gte(marsSearchHistory.expiresAt, new Date())
        )
      )
      .orderBy(desc(marsSearchHistory.createdAt))
      .limit(limit);
    
    const searches = await query;
    
    // Filter by query text if provided
    let filtered = searches;
    if (queryFilter) {
      const lowerFilter = queryFilter.toLowerCase();
      filtered = searches.filter(s => 
        s.query.toLowerCase().includes(lowerFilter)
      );
    }
    
    // Filter by minimum confidence if provided
    if (minConfidence) {
      const confidenceLevels = ["insufficient", "low", "medium", "high"];
      const minIndex = confidenceLevels.indexOf(minConfidence);
      if (minIndex >= 0) {
        filtered = filtered.filter(s => {
          const sIndex = confidenceLevels.indexOf(s.confidenceLevel || "insufficient");
          return sIndex >= minIndex;
        });
      }
    }
    
    return {
      searches: filtered,
      total: filtered.length
    };
  } catch (error) {
    console.error("[MARS] Failed to get history:", error);
    return { searches: [], total: 0 };
  }
}

// Get a specific MARS search by ID with full crawled content
export async function getMarsSearchById(
  userId: number,
  searchId: number
): Promise<{
  id: number;
  query: string;
  queryType: string;
  confidenceLevel: string | null;
  sourceCount: number | null;
  verifiedFactCount: number | null;
  directAnswers: any;
  verifiedFacts: any;
  topSources: any;
  crawledContent: string | null;
  createdAt: Date | null;
  expiresAt: Date;
} | null> {
  try {
    const result = await db.select()
      .from(marsSearchHistory)
      .where(
        and(
          eq(marsSearchHistory.id, searchId),
          eq(marsSearchHistory.userId, userId)
        )
      )
      .limit(1);
    
    return result[0] || null;
  } catch (error) {
    console.error("[MARS] Failed to get search by ID:", error);
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SPORTS SPECIALIZED HANDLERS - Use Djedou Pronos cache for reliable data
// ══════════════════════════════════════════════════════════════════════════════

async function searchSportsFootballWithMARS(
  userId: number,
  query: string,
  startTime: number
): Promise<MARSSearchResult> {
  try {
    console.log(`[MARS SPORTS] Handling sports_football query: "${query}"`);
    
    // Import sports services dynamically
    const { sportsCacheService } = await import("./sportsCacheService");
    const { probabilityModelService } = await import("./probabilityModelService");
    const { sportsApiService } = await import("./sportsApiService");
    
    const queryLower = query.toLowerCase();
    const facts: Array<{type: string; content: string; confidence: "verified" | "probable" | "disputed" | "uncertain"; sources: string[]}> = [];
    let summary = "";
    let dataFound = false;
    
    // 1. Check for standings requests
    if (queryLower.includes("classement") || queryLower.includes("ranking") || queryLower.includes("table")) {
      try {
        const standings = await sportsApiService.getLigue1Standings().catch(() => []);
        if (standings.length > 0) {
          const standingsStr = standings.slice(0, 10).map((t: any, i: number) => 
            `${i + 1}. ${t.team?.name || t.name} - ${t.points} pts`
          ).join(", ");
          facts.push({
            type: "ranking",
            content: `Classement Ligue 1: ${standingsStr}`,
            confidence: "verified",
            sources: ["API-Football"]
          });
          dataFound = true;
        }
      } catch (e) { console.error("[MARS SPORTS] Standings error:", e); }
    }
    
    // 2. Check for match predictions/odds/betting - ALWAYS get full cache with odds
    const bettingKeywords = ["match", "pronostic", "prono", "cote", "pari", "parier", "meilleur", 
                             "aujourd'hui", "ce soir", "jour", "foot", "football"];
    if (bettingKeywords.some(k => queryLower.includes(k))) {
      try {
        // Get full matches with odds from Djedou Pronos cache
        const cachedMatches = await sportsCacheService.getMatchesWithOdds(new Date());
        console.log(`[MARS SPORTS] Found ${cachedMatches.length} matches in cache`);
        
        if (cachedMatches.length > 0) {
          // Use the full formatted output for AI context
          const formattedData = sportsCacheService.formatMatchesForAI(cachedMatches);
          facts.push({
            type: "betting_matches",
            content: formattedData,
            confidence: "verified",
            sources: ["Djedou Pronos Cache"]
          });
          dataFound = true;
          
          // Also add prediction analysis if available
          try {
            const predictions = await probabilityModelService.analyzeTodayMatches().catch(() => []);
            if (predictions.length > 0) {
              const predsStr = predictions.slice(0, 5).map((p: any) => 
                `${p.match?.homeTeam?.name || "?"} vs ${p.match?.awayTeam?.name || "?"}: ${p.recommendation || p.prediction || "N/A"} (confiance: ${p.confidence || "?"}%)`
              ).join("\n");
              facts.push({
                type: "prediction_analysis",
                content: `Analyse Djedou Pronos:\n${predsStr}`,
                confidence: "probable",
                sources: ["Probability Model"]
              });
            }
          } catch (e) { /* predictions are optional bonus */ }
        }
      } catch (e) { 
        console.error("[MARS SPORTS] Cache/Predictions error:", e); 
      }
    }
    
    // 3. Check for Champions League / Europa League
    if (queryLower.includes("ldc") || queryLower.includes("champions league") || queryLower.includes("ligue des champions") ||
        queryLower.includes("europa") || queryLower.includes("coupe d'europe")) {
      try {
        const cachedMatches = await sportsCacheService.getMatchesWithOdds(new Date());
        const euroMatches = cachedMatches.filter((m: any) => 
          m.competition?.includes("Champions") || m.competition?.includes("Europa") ||
          m.league?.name?.includes("Champions") || m.league?.name?.includes("Europa")
        );
        if (euroMatches.length > 0) {
          const matchesStr = euroMatches.slice(0, 5).map((m: any) => 
            `${m.homeTeam} vs ${m.awayTeam}${m.score ? ` (${m.score})` : ""}`
          ).join("; ");
          facts.push({
            type: "match",
            content: `Matchs européens: ${matchesStr}`,
            confidence: "verified",
            sources: ["Sports Cache"]
          });
          dataFound = true;
        }
      } catch (e) { console.error("[MARS SPORTS] European matches error:", e); }
    }
    
    // 4. Fallback: Get today's cached matches
    if (!dataFound) {
      try {
        const cachedMatches = await sportsCacheService.getMatchesWithOdds(new Date());
        if (cachedMatches.length > 0) {
          const formattedData = sportsCacheService.formatMatchesForAI(cachedMatches);
          facts.push({
            type: "matches",
            content: formattedData.slice(0, 500),
            confidence: "verified",
            sources: ["Sports Cache"]
          });
          dataFound = true;
        }
      } catch (e) { console.error("[MARS SPORTS] Cache fallback error:", e); }
    }
    
    // 5. Ultimate fallback: web search if no internal data
    if (!dataFound) {
      console.log("[MARS SPORTS] No internal sports data, falling back to web search");
      const orchestratorResponse = await orchestrateSearch(query, 5);
      
      if (orchestratorResponse.success && orchestratorResponse.results.length > 0) {
        const webFacts = orchestratorResponse.results.slice(0, 3).map(r => ({
          type: "web_result",
          content: r.snippet || r.title,
          confidence: "probable" as const,
          sources: [r.url]
        }));
        facts.push(...webFacts);
        dataFound = true;
      }
    }
    
    // Build summary
    summary = dataFound 
      ? `Données football trouvées: ${facts.length} éléments pour "${query}"`
      : `Pas de données football disponibles pour "${query}"`;
    
    const factAggregation: FactAggregation = {
      facts: facts.map(f => ({
        ...f,
        extractedFrom: f.sources,
        supportingUrls: f.sources
      })),
      summary,
      overallConfidence: dataFound ? 85 : 0,
      controversies: [],
      dataGaps: dataFound ? [] : ["Aucune donnée sport interne disponible"]
    };
    
    const policyDecision: PolicyDecision = {
      canRespond: dataFound,
      confidenceLevel: dataFound ? "high" : "insufficient",
      reasoning: dataFound ? "Sports data from internal cache/API" : "No internal sports data",
      warnings: dataFound ? [] : ["Données sport manquantes"],
      recommendations: dataFound ? [] : ["Vérifier le cache sports ou reformuler"],
      mustDisclaim: !dataFound,
      disclaimers: []
    };
    
    const orchestratorResponse: OrchestratorResponse = {
      results: [],
      directAnswers: facts.map(f => f.content),
      engineStats: {
        serper: { success: false, resultCount: 0, timeMs: 0 },
        perplexity: { success: false, resultCount: 0, timeMs: 0 }
      },
      totalTime: 0,
      success: dataFound
    };
    
    const formattedForAI = formatMARSResults({
      orchestratorResponse,
      factAggregation,
      policyDecision,
      reliabilityScores: [],
      queryType: "sports_football",
      extractedContents: []
    });
    
    await saveSearchToMemory(userId, query, "sports_football", factAggregation, [], policyDecision);
    await saveToMarsHistory(userId, query, "sports_football", {
      orchestratorResponse,
      extractedContents: [],
      factAggregation,
      policyDecision,
      reliabilityScores: []
    });
    
    const totalTime = Date.now() - startTime;
    console.log(`[MARS SPORTS] Football query complete in ${totalTime}ms, found: ${facts.length} facts`);
    
    const sportsResult: MARSSearchResult = {
      query,
      queryType: "sports_football",
      orchestratorResponse,
      extractedContents: [],
      reliabilityScores: [],
      factAggregation,
      policyDecision,
      formattedForAI,
      totalTime,
      success: dataFound
    };
    buildAndLogAudit(sportsResult, {
      sportsContext: {
        matchesFromCache: facts.filter(f => f.type === 'betting_matches').length > 0 ? 1 : 0,
        matchesWithOdds: facts.filter(f => f.content.includes('cote')).length,
        valueBetsDetected: facts.filter(f => f.content.includes('VALUE')).length,
        leagueCoverage: ['Ligue 1', 'Champions League', 'Serie A', 'Premier League', 'La Liga']
      },
      earlyExitReason: 'cache_hit'
    });
    return sportsResult;
  } catch (error) {
    console.error("[MARS SPORTS] Football error:", error);
    const errorResult = createSportsErrorResult(query, "sports_football", startTime, error);
    buildAndLogAudit(errorResult);
    return errorResult;
  }
}

async function searchSportsBasketballWithMARS(
  userId: number,
  query: string,
  startTime: number
): Promise<MARSSearchResult> {
  try {
    console.log(`[MARS SPORTS] Handling sports_basketball query: "${query}"`);
    
    const { basketballPredictionService } = await import("./basketballPredictionService");
    
    const facts: Array<{type: string; content: string; confidence: "verified" | "probable" | "disputed" | "uncertain"; sources: string[]}> = [];
    let dataFound = false;
    
    // Get NBA predictions
    try {
      const predictions = await basketballPredictionService.analyzeTodayMatches().catch(() => []);
      if (predictions.length > 0) {
        const predsStr = predictions.slice(0, 5).map((p: any) => 
          `${p.homeTeam || "?"} vs ${p.awayTeam || "?"}: ${p.prediction || "N/A"}`
        ).join("; ");
        facts.push({
          type: "prediction",
          content: `NBA du jour: ${predsStr}`,
          confidence: "probable",
          sources: ["Djedou Pronos NBA"]
        });
        dataFound = true;
      }
    } catch (e) { console.error("[MARS SPORTS] NBA predictions error:", e); }
    
    // Fallback to web search
    if (!dataFound) {
      console.log("[MARS SPORTS] No NBA data, falling back to web search");
      const orchestratorResponse = await orchestrateSearch(query, 5);
      if (orchestratorResponse.success && orchestratorResponse.results.length > 0) {
        facts.push(...orchestratorResponse.results.slice(0, 3).map(r => ({
          type: "web_result",
          content: r.snippet || r.title,
          confidence: "probable" as const,
          sources: [r.url]
        })));
        dataFound = true;
      }
    }
    
    const factAggregation: FactAggregation = {
      facts: facts.map(f => ({
        ...f,
        extractedFrom: f.sources,
        supportingUrls: f.sources
      })),
      summary: dataFound ? `Données NBA: ${facts.length} éléments` : "Pas de données NBA",
      overallConfidence: dataFound ? 80 : 0,
      controversies: [],
      dataGaps: dataFound ? [] : ["Aucune donnée NBA disponible"]
    };
    
    const policyDecision: PolicyDecision = {
      canRespond: dataFound,
      confidenceLevel: dataFound ? "high" : "insufficient",
      reasoning: dataFound ? "NBA data from predictions" : "No NBA data",
      warnings: [],
      recommendations: [],
      mustDisclaim: !dataFound,
      disclaimers: []
    };
    
    const orchestratorResponse: OrchestratorResponse = {
      results: [],
      directAnswers: facts.map(f => f.content),
      engineStats: { serper: { success: false, resultCount: 0, timeMs: 0 }, perplexity: { success: false, resultCount: 0, timeMs: 0 } },
      totalTime: 0,
      success: dataFound
    };
    
    const formattedForAI = formatMARSResults({
      orchestratorResponse,
      factAggregation,
      policyDecision,
      reliabilityScores: [],
      queryType: "sports_basketball",
      extractedContents: []
    });
    
    await saveSearchToMemory(userId, query, "sports_basketball", factAggregation, [], policyDecision);
    
    const basketballResult: MARSSearchResult = {
      query,
      queryType: "sports_basketball",
      orchestratorResponse,
      extractedContents: [],
      reliabilityScores: [],
      factAggregation,
      policyDecision,
      formattedForAI,
      totalTime: Date.now() - startTime,
      success: dataFound
    };
    buildAndLogAudit(basketballResult, {
      sportsContext: {
        matchesFromCache: facts.filter(f => f.type === 'game').length,
        matchesWithOdds: 0,
        valueBetsDetected: 0,
        leagueCoverage: ['NBA']
      },
      earlyExitReason: 'cache_hit'
    });
    return basketballResult;
  } catch (error) {
    console.error("[MARS SPORTS] Basketball error:", error);
    const errorResult = createSportsErrorResult(query, "sports_basketball", startTime, error);
    buildAndLogAudit(errorResult);
    return errorResult;
  }
}

function createSportsErrorResult(
  query: string,
  queryType: string,
  startTime: number,
  error: unknown
): MARSSearchResult {
  return {
    query,
    queryType,
    orchestratorResponse: {
      results: [],
      directAnswers: [],
      engineStats: { serper: { success: false, resultCount: 0, timeMs: 0 }, perplexity: { success: false, resultCount: 0, timeMs: 0 } },
      totalTime: 0,
      success: false
    },
    extractedContents: [],
    reliabilityScores: [],
    factAggregation: {
      facts: [],
      summary: `Erreur sur la requête ${queryType}`,
      overallConfidence: 0,
      controversies: [],
      dataGaps: []
    },
    policyDecision: {
      canRespond: false,
      confidenceLevel: "insufficient",
      reasoning: "Sports error",
      warnings: [],
      recommendations: [],
      mustDisclaim: true,
      disclaimers: []
    },
    formattedForAI: `[MARS SPORTS] Erreur: ${error instanceof Error ? error.message : "Unknown"}`,
    totalTime: Date.now() - startTime,
    success: false,
    error: error instanceof Error ? error.message : "Unknown sports error"
  };
}

/**
 * Build and log a complete audit entry from MARS results
 */
export function buildAndLogAudit(
  result: MARSSearchResult,
  options: {
    wasEarlyExit?: boolean;
    earlyExitReason?: MarsAuditEntry['earlyExitReason'];
    wasBudgetHit?: boolean;
    sportsContext?: {
      matchesFromCache: number;
      matchesWithOdds: number;
      valueBetsDetected: number;
      leagueCoverage: string[];
    };
    serperTimeMs?: number;
    perplexityTimeMs?: number;
    smartCrawlTimeMs?: number;
    timeBudgetMs?: number;
  } = {}
): void {
  const partial = createAuditEntry(result.query);
  
  // Map MARS queryType to audit queryType (use result's actual classification)
  const mapQueryType = (qt: string): MarsAuditEntry['queryType'] => {
    if (qt.includes('football') || qt.includes('basketball') || qt.includes('sports')) return 'sport';
    if (qt === 'betting') return 'betting';
    if (qt === 'actu' || qt === 'news' || qt === 'temporal') return 'actu';
    if (qt === 'code') return 'code';
    if (qt === 'tuto') return 'tuto';
    if (qt === 'definition') return 'definition';
    if (qt === 'price') return 'price';
    return 'general';
  };
  
  const auditEntry: MarsAuditEntry = {
    ...partial as MarsAuditEntry,
    queryType: mapQueryType(result.queryType),
    
    // Timing
    totalTimeMs: result.totalTime,
    serperTimeMs: options.serperTimeMs || result.orchestratorResponse.engineStats?.serper?.timeMs || 0,
    perplexityTimeMs: options.perplexityTimeMs || result.orchestratorResponse.engineStats?.perplexity?.timeMs || 0,
    smartCrawlTimeMs: options.smartCrawlTimeMs || 0,
    timeBudgetMs: options.timeBudgetMs || 15000,
    timeBudgetUsedPercent: (result.totalTime / (options.timeBudgetMs || 15000)) * 100,
    wasBudgetHit: options.wasBudgetHit || false,
    wasEarlyExit: options.wasEarlyExit || false,
    earlyExitReason: options.earlyExitReason,
    
    // Sources (use safeGetHostname to prevent URL parsing errors)
    sources: result.orchestratorResponse.results.slice(0, 10).map(r => {
      const domain = safeGetHostname(r.url);
      return {
        domain,
        marsScore: result.reliabilityScores.find(s => s.domain === domain)?.overallScore || 0,
        usedInAnswer: result.extractedContents.some(c => c.url === r.url),
        fetchMethod: 'http' as const
      };
    }),
    confidenceLevel: result.policyDecision.confidenceLevel as MarsAuditEntry['confidenceLevel'],
    canRespond: result.policyDecision.canRespond,
    
    // Engine usage
    usedSerper: result.orchestratorResponse.engineStats?.serper?.success || false,
    serperTimeout: !result.orchestratorResponse.engineStats?.serper?.success && (result.orchestratorResponse.engineStats?.serper?.timeMs || 0) >= 5000,
    serperResultCount: result.orchestratorResponse.engineStats?.serper?.resultCount || 0,
    usedPerplexity: result.orchestratorResponse.directAnswers.some(a => a.engine === 'perplexity'),
    perplexityTimeout: (result.orchestratorResponse.engineStats?.perplexity?.timeMs || 0) >= 6000,
    perplexitySkippedByCircuitBreaker: false,
    perplexityAnswer: result.orchestratorResponse.directAnswers.find(a => a.engine === 'perplexity')?.answer,
    
    // Sports context
    sportsContextInjected: options.sportsContext !== undefined,
    matchesFromCache: options.sportsContext?.matchesFromCache || 0,
    matchesWithOdds: options.sportsContext?.matchesWithOdds || 0,
    valueBetsDetected: options.sportsContext?.valueBetsDetected || 0,
    leagueCoverage: options.sportsContext?.leagueCoverage || [],
    
    // Result
    answerLength: result.formattedForAI.length,
    answerType: result.policyDecision.canRespond 
      ? (result.factAggregation.facts.length > 0 ? 'factual' : 'synthesis')
      : (result.policyDecision.confidenceLevel === 'insufficient' ? 'refusal' : 'partial'),
    policyTriggered: !result.policyDecision.canRespond,
    policyReason: result.policyDecision.canRespond ? undefined : result.policyDecision.reasoning
  };
  
  logMarsQuery(auditEntry);
}

export const marsService = {
  searchWithMARS,
  getMARSMetrics,
  getMarsHistory,
  getMarsSearchById,
  buildAndLogAudit
};
