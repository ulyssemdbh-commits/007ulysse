/**
 * MARS - Fact Aggregator
 * Semantic extraction and cross-referencing of facts
 * 
 * Features:
 * - Fact extraction from multiple sources
 * - Semantic matching for deduplication
 * - Confidence scoring based on multi-source confirmation
 * - Numeric value consensus detection
 */

import { ExtractedContent } from "./contentFetcher";
import { ReliabilityScore, calculateReliability } from "./reliabilityScorer";

export interface ExtractedFact {
  content: string;
  type: "statistic" | "date" | "name" | "event" | "claim" | "definition";
  sources: string[];
  sourceScores: number[];
  consensus: number;
  numericValue?: number;
  numericUnit?: string;
  confidence: "verified" | "probable" | "unverified" | "disputed";
  variations: string[];
}

export interface FactAggregation {
  facts: ExtractedFact[];
  summary: string;
  overallConfidence: number;
  controversies: string[];
  dataGaps: string[];
}

const FACT_PATTERNS = {
  statistic: [
    /(\d+(?:[.,]\d+)?)\s*(%|pour cent|pourcent)/gi,
    /(\d+(?:[.,]\d+)?)\s*(millions?|milliards?|mille|k|M|G)/gi,
    /(\d+(?:[.,]\d+)?)\s*(€|euros?|dollars?|\$|£)/gi,
    /(\d+(?:[.,]\d+)?)\s*(km|m|cm|mm|kg|g|mg|L|mL)/gi,
  ],
  date: [
    /le\s+(\d{1,2})\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+(\d{4})/gi,
    /(\d{4}-\d{2}-\d{2})/g,
    /(depuis|en|à partir de)\s+(\d{4})/gi,
  ],
  score: [
    /(\d+)\s*[-–]\s*(\d+)/g,
    /score\s*:?\s*(\d+)/gi,
    /résultat\s*:?\s*(\d+)/gi,
  ],
};

function normalizeNumber(str: string): number | null {
  const cleaned = str
    .replace(/\s/g, "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "");
  
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function extractFactsFromText(text: string, url: string): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  
  for (const pattern of FACT_PATTERNS.statistic) {
    const matches = Array.from(text.matchAll(pattern));
    for (const match of matches) {
      const fullMatch = match[0];
      const value = normalizeNumber(match[1]);
      const unit = match[2] || "";
      
      if (value !== null) {
        facts.push({
          content: fullMatch.trim(),
          type: "statistic",
          sources: [url],
          sourceScores: [],
          consensus: 1,
          numericValue: value,
          numericUnit: unit.toLowerCase(),
          confidence: "unverified",
          variations: [fullMatch.trim()]
        });
      }
    }
  }
  
  for (const pattern of FACT_PATTERNS.date) {
    const matches = Array.from(text.matchAll(pattern));
    for (const match of matches) {
      facts.push({
        content: match[0].trim(),
        type: "date",
        sources: [url],
        sourceScores: [],
        consensus: 1,
        confidence: "unverified",
        variations: [match[0].trim()]
      });
    }
  }
  
  for (const pattern of FACT_PATTERNS.score) {
    const matches = Array.from(text.matchAll(pattern));
    for (const match of matches) {
      facts.push({
        content: match[0].trim(),
        type: "event",
        sources: [url],
        sourceScores: [],
        consensus: 1,
        confidence: "unverified",
        variations: [match[0].trim()]
      });
    }
  }
  
  return facts;
}

function areSimilarFacts(fact1: ExtractedFact, fact2: ExtractedFact): boolean {
  if (fact1.type !== fact2.type) return false;
  
  if (fact1.type === "statistic" && fact2.type === "statistic") {
    if (fact1.numericValue !== undefined && fact2.numericValue !== undefined) {
      const diff = Math.abs(fact1.numericValue - fact2.numericValue);
      const avg = (fact1.numericValue + fact2.numericValue) / 2;
      if (avg > 0 && diff / avg < 0.1) {
        return fact1.numericUnit === fact2.numericUnit;
      }
    }
  }
  
  const words1 = fact1.content.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const words2 = fact2.content.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const set1 = new Set(words1);
  const set2 = new Set(words2);
  
  const intersection = words1.filter(x => set2.has(x));
  const unionArr = [...words1, ...words2.filter(w => !set1.has(w))];
  
  return unionArr.length > 0 ? intersection.length / unionArr.length > 0.6 : false;
}

function mergeFacts(facts: ExtractedFact[]): ExtractedFact[] {
  const merged: ExtractedFact[] = [];
  const used = new Set<number>();
  
  for (let i = 0; i < facts.length; i++) {
    if (used.has(i)) continue;
    
    const group: ExtractedFact[] = [facts[i]];
    used.add(i);
    
    for (let j = i + 1; j < facts.length; j++) {
      if (used.has(j)) continue;
      
      if (areSimilarFacts(facts[i], facts[j])) {
        group.push(facts[j]);
        used.add(j);
      }
    }
    
    if (group.length === 1) {
      merged.push(facts[i]);
    } else {
      const allSourcesSet = new Set(group.flatMap(f => f.sources));
      const allSources = Array.from(allSourcesSet);
      const allScores = group.flatMap(f => f.sourceScores);
      const allVariationsSet = new Set(group.flatMap(f => f.variations));
      const allVariations = Array.from(allVariationsSet);
      
      let numericValue: number | undefined;
      if (group[0].type === "statistic") {
        const values = group
          .map(f => f.numericValue)
          .filter((v): v is number => v !== undefined);
        if (values.length > 0) {
          numericValue = values.reduce((a, b) => a + b, 0) / values.length;
        }
      }
      
      let confidence: ExtractedFact["confidence"];
      if (allSources.length >= 3) {
        confidence = "verified";
      } else if (allSources.length === 2) {
        confidence = "probable";
      } else {
        confidence = "unverified";
      }
      
      merged.push({
        content: group[0].content,
        type: group[0].type,
        sources: allSources,
        sourceScores: allScores,
        consensus: allSources.length,
        numericValue,
        numericUnit: group[0].numericUnit,
        confidence,
        variations: allVariations
      });
    }
  }
  
  return merged;
}

function detectControversies(facts: ExtractedFact[]): string[] {
  const controversies: string[] = [];
  
  for (const fact of facts) {
    if (fact.type === "statistic" && fact.variations.length > 1) {
      const values = fact.variations
        .map(v => {
          const match = v.match(/(\d+(?:[.,]\d+)?)/);
          return match ? normalizeNumber(match[1]) : null;
        })
        .filter((v): v is number => v !== null);
      
      if (values.length > 1) {
        const min = Math.min(...values);
        const max = Math.max(...values);
        const avg = (min + max) / 2;
        
        if (avg > 0 && (max - min) / avg > 0.2) {
          controversies.push(
            `Divergence sur "${fact.content}": valeurs varient de ${min} à ${max} (${fact.sources.length} sources)`
          );
        }
      }
    }
  }
  
  return controversies;
}

export async function aggregateFacts(
  contents: ExtractedContent[],
  query: string
): Promise<FactAggregation> {
  const allFacts: ExtractedFact[] = [];
  
  for (const content of contents) {
    if (!content.success || !content.text) continue;
    
    const score = calculateReliability(content, contents, []);
    const facts = extractFactsFromText(content.text, content.url);
    
    for (const fact of facts) {
      fact.sourceScores = [score.total];
    }
    
    allFacts.push(...facts);
  }
  
  const mergedFacts = mergeFacts(allFacts);
  
  mergedFacts.sort((a, b) => {
    if (a.confidence !== b.confidence) {
      const order = { verified: 0, probable: 1, unverified: 2, disputed: 3 };
      return order[a.confidence] - order[b.confidence];
    }
    return b.consensus - a.consensus;
  });
  
  const controversies = detectControversies(mergedFacts);
  
  const verifiedCount = mergedFacts.filter(f => f.confidence === "verified").length;
  const probableCount = mergedFacts.filter(f => f.confidence === "probable").length;
  const totalFacts = mergedFacts.length;
  
  const overallConfidence = totalFacts > 0
    ? Math.round((verifiedCount * 100 + probableCount * 70) / totalFacts)
    : 0;
  
  let summary = `Analyse de ${contents.length} sources:\n`;
  summary += `- ${verifiedCount} fait(s) vérifié(s) (multi-sources)\n`;
  summary += `- ${probableCount} fait(s) probable(s)\n`;
  summary += `- ${mergedFacts.length - verifiedCount - probableCount} fait(s) non vérifiés\n`;
  
  if (controversies.length > 0) {
    summary += `\n⚠️ ${controversies.length} divergence(s) détectée(s)`;
  }
  
  const dataGaps: string[] = [];
  if (totalFacts === 0) {
    dataGaps.push("Aucun fait quantifiable extrait des sources");
  }
  if (verifiedCount === 0 && totalFacts > 0) {
    dataGaps.push("Aucun fait confirmé par plusieurs sources");
  }
  
  return {
    facts: mergedFacts,
    summary,
    overallConfidence,
    controversies,
    dataGaps
  };
}

export function formatFactsForAI(aggregation: FactAggregation): string {
  let formatted = `### Analyse factuelle MARS\n\n`;
  formatted += aggregation.summary + "\n\n";
  
  if (aggregation.facts.length > 0) {
    formatted += "**Faits extraits:**\n";
    
    const verifiedFacts = aggregation.facts.filter(f => f.confidence === "verified");
    if (verifiedFacts.length > 0) {
      formatted += "\n✅ **Vérifiés (multi-sources):**\n";
      for (const fact of verifiedFacts.slice(0, 5)) {
        formatted += `- ${fact.content} [${fact.consensus} sources]\n`;
      }
    }
    
    const probableFacts = aggregation.facts.filter(f => f.confidence === "probable");
    if (probableFacts.length > 0) {
      formatted += "\n⚡ **Probables (2 sources):**\n";
      for (const fact of probableFacts.slice(0, 5)) {
        formatted += `- ${fact.content}\n`;
      }
    }
  }
  
  if (aggregation.controversies.length > 0) {
    formatted += "\n⚠️ **Divergences:**\n";
    for (const controversy of aggregation.controversies) {
      formatted += `- ${controversy}\n`;
    }
  }
  
  if (aggregation.dataGaps.length > 0) {
    formatted += "\n❓ **Données manquantes:**\n";
    for (const gap of aggregation.dataGaps) {
      formatted += `- ${gap}\n`;
    }
  }
  
  formatted += `\n**Confiance globale:** ${aggregation.overallConfidence}%\n`;
  
  return formatted;
}

export const factAggregatorService = {
  aggregateFacts,
  formatFactsForAI
};
