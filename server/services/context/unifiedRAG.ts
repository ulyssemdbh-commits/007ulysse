/**
 * UNIFIED RAG CONTEXT LAYER V1
 * 
 * Récupération contextuelle unifiée avec scoring par pertinence.
 * Fusionne: mémoire + knowledgeBase + webSearch + projets + actions récentes
 * Score chaque fragment par: pertinence, fraîcheur, confiance, domaine
 * Respecte un budget de tokens pour ne pas surcharger le contexte.
 */

import { db } from "../../db";
import { ulysseMemory, knowledgeBase, webSearchMemory, projectMemory, actionLogs } from "@shared/schema";
import { eq, desc, sql, and, gte, or, like } from "drizzle-orm";

const LOG_PREFIX = "[UnifiedRAG]";
const MAX_CONTEXT_TOKENS = 3000;
const CHARS_PER_TOKEN = 4;

interface RAGFragment {
  source: "memory" | "knowledge" | "web_search" | "project" | "action_log";
  content: string;
  score: number;
  metadata: {
    category?: string;
    confidence?: number;
    freshness: number;
    verified?: boolean;
    domain?: string;
  };
}

interface RAGResult {
  fragments: RAGFragment[];
  totalScore: number;
  tokensUsed: number;
  sourceCounts: Record<string, number>;
  queryDomain: string;
}

interface RAGConfig {
  maxTokens?: number;
  domainBoost?: string;
  recencyHours?: number;
  minConfidence?: number;
  includeActions?: boolean;
}

class UnifiedRAGService {
  private domainKeywords: Record<string, string[]> = {
    sports: ["match", "foot", "equipe", "classement", "score", "pari", "cote", "ligue", "prono", "championnat"],
    sugu: ["sugu", "restaurant", "courses", "checklist", "stock", "panier", "caisse", "facture", "fournisseur"],
    finance: ["bourse", "action", "bitcoin", "crypto", "cours", "trading", "marché", "portefeuille"],
    dev: ["code", "bug", "api", "deploy", "feature", "module", "serveur", "database", "frontend"],
    calendar: ["agenda", "calendrier", "événement", "rdv", "rendez-vous", "réunion", "planning"],
    email: ["email", "mail", "inbox", "message", "réponse", "envoyer"],
    music: ["musique", "spotify", "joue", "écoute", "artiste", "playlist", "morceau"],
    domotique: ["lumière", "lampe", "thermostat", "allume", "éteins", "scène", "maison"],
    perso: ["famille", "enfants", "kelly", "lenny", "micky", "anniversaire", "souvenir"],
    weather: ["météo", "température", "temps", "pluie", "soleil", "vent"]
  };

  detectDomain(query: string): string {
    const q = query.toLowerCase();
    let bestDomain = "general";
    let bestScore = 0;

    for (const [domain, keywords] of Object.entries(this.domainKeywords)) {
      const score = keywords.filter(kw => q.includes(kw)).length;
      if (score > bestScore) {
        bestScore = score;
        bestDomain = domain;
      }
    }
    return bestDomain;
  }

  async retrieve(userId: number, query: string, config: RAGConfig = {}): Promise<RAGResult> {
    const startTime = Date.now();
    const maxTokens = config.maxTokens || MAX_CONTEXT_TOKENS;
    const domain = config.domainBoost || this.detectDomain(query);
    const recencyMs = (config.recencyHours || 72) * 3600 * 1000;
    const minConfidence = config.minConfidence || 20;

    const fragments: RAGFragment[] = [];

    try {
      const [memories, knowledge, webSearches, projects, actions] = await Promise.all([
        this.fetchMemories(userId, query, minConfidence),
        this.fetchKnowledge(userId, query),
        this.fetchWebSearches(userId, query, recencyMs),
        this.fetchProjects(userId, query),
        config.includeActions !== false ? this.fetchRecentActions(userId, recencyMs) : Promise.resolve([])
      ]);

      fragments.push(...memories, ...knowledge, ...webSearches, ...projects, ...actions);
    } catch (err) {
      console.error(`${LOG_PREFIX} Error fetching fragments:`, err);
    }

    for (const f of fragments) {
      f.score = this.computeScore(f, query, domain);
    }

    fragments.sort((a, b) => b.score - a.score);

    const selected: RAGFragment[] = [];
    let tokensUsed = 0;
    const sourceCounts: Record<string, number> = {};

    for (const f of fragments) {
      const fragTokens = Math.ceil(f.content.length / CHARS_PER_TOKEN);
      if (tokensUsed + fragTokens > maxTokens) continue;

      selected.push(f);
      tokensUsed += fragTokens;
      sourceCounts[f.source] = (sourceCounts[f.source] || 0) + 1;
    }

    const elapsed = Date.now() - startTime;
    if (selected.length > 0) {
      console.log(`${LOG_PREFIX} Retrieved ${selected.length}/${fragments.length} fragments (${tokensUsed} tokens, ${elapsed}ms, domain=${domain})`);
    }

    return {
      fragments: selected,
      totalScore: selected.reduce((sum, f) => sum + f.score, 0),
      tokensUsed,
      sourceCounts,
      queryDomain: domain
    };
  }

  formatAsPrompt(result: RAGResult): string {
    if (result.fragments.length === 0) return "";

    const grouped: Record<string, string[]> = {};
    for (const f of result.fragments) {
      if (!grouped[f.source]) grouped[f.source] = [];
      grouped[f.source].push(f.content);
    }

    const sourceLabels: Record<string, string> = {
      memory: "Mémoire",
      knowledge: "Connaissances",
      web_search: "Recherches Web",
      project: "Projets",
      action_log: "Actions Récentes"
    };

    const parts: string[] = [`[CONTEXTE PERTINENT - Domaine: ${result.queryDomain}]`];
    for (const [source, items] of Object.entries(grouped)) {
      parts.push(`\n${sourceLabels[source] || source}:`);
      for (const item of items.slice(0, 5)) {
        parts.push(`- ${item.substring(0, 200)}`);
      }
    }

    return parts.join("\n");
  }

  private computeScore(fragment: RAGFragment, query: string, targetDomain: string): number {
    let score = 0;
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const contentLower = fragment.content.toLowerCase();

    const matchCount = queryWords.filter(w => contentLower.includes(w)).length;
    score += (matchCount / Math.max(queryWords.length, 1)) * 40;

    score += fragment.metadata.freshness * 20;

    if (fragment.metadata.confidence) {
      score += (fragment.metadata.confidence / 100) * 15;
    }

    if (fragment.metadata.verified) {
      score += 10;
    }

    if (fragment.metadata.domain === targetDomain) {
      score += 15;
    }

    const sourceBonus: Record<string, number> = {
      memory: 5,
      knowledge: 8,
      web_search: 3,
      project: 4,
      action_log: 2
    };
    score += sourceBonus[fragment.source] || 0;

    return Math.min(score, 100);
  }

  private async fetchMemories(userId: number, query: string, minConfidence: number): Promise<RAGFragment[]> {
    try {
      const searchPattern = `%${query.toLowerCase().split(/\s+/).slice(0, 3).join("%")}%`;
      const results = await db.select().from(ulysseMemory)
        .where(and(
          eq(ulysseMemory.userId, userId),
          gte(ulysseMemory.confidence, minConfidence),
          or(
            sql`LOWER(${ulysseMemory.key}) LIKE ${searchPattern}`,
            sql`LOWER(${ulysseMemory.value}) LIKE ${searchPattern}`
          )
        ))
        .orderBy(desc(ulysseMemory.confidence))
        .limit(15);

      return results.map(m => ({
        source: "memory" as const,
        content: `[${m.category}] ${m.key}: ${m.value}`,
        score: 0,
        metadata: {
          category: m.category,
          confidence: m.confidence,
          freshness: this.computeFreshness(m.updatedAt),
          verified: m.verified || false,
          domain: this.categoryToDomain(m.category)
        }
      }));
    } catch { return []; }
  }

  private async fetchKnowledge(userId: number, query: string): Promise<RAGFragment[]> {
    try {
      const searchPattern = `%${query.toLowerCase().split(/\s+/).slice(0, 3).join("%")}%`;
      const results = await db.select().from(knowledgeBase)
        .where(and(
          eq(knowledgeBase.userId, userId),
          or(
            sql`LOWER(${knowledgeBase.title}) LIKE ${searchPattern}`,
            sql`LOWER(${knowledgeBase.content}) LIKE ${searchPattern}`
          )
        ))
        .orderBy(desc(knowledgeBase.confidence))
        .limit(10);

      return results.map(k => ({
        source: "knowledge" as const,
        content: `${k.title}: ${k.content?.substring(0, 300) || ''}`,
        score: 0,
        metadata: {
          category: k.category || undefined,
          confidence: k.confidence || 50,
          freshness: this.computeFreshness(k.updatedAt || k.createdAt),
          verified: (k as any).verified || false,
          domain: k.category || undefined
        }
      }));
    } catch { return []; }
  }

  private async fetchWebSearches(userId: number, query: string, recencyMs: number): Promise<RAGFragment[]> {
    try {
      const cutoff = new Date(Date.now() - recencyMs);
      const searchPattern = `%${query.toLowerCase().split(/\s+/).slice(0, 2).join("%")}%`;
      const results = await db.select().from(webSearchMemory)
        .where(and(
          eq(webSearchMemory.userId, userId),
          gte(webSearchMemory.createdAt, cutoff),
          or(
            sql`LOWER(${webSearchMemory.query}) LIKE ${searchPattern}`,
            sql`LOWER(${webSearchMemory.learnedInsights}) LIKE ${searchPattern}`
          )
        ))
        .orderBy(desc(webSearchMemory.createdAt))
        .limit(5);

      return results.map(w => ({
        source: "web_search" as const,
        content: `Recherche "${w.query}": ${w.learnedInsights?.substring(0, 250) || w.keyFindings?.join(", ") || ''}`,
        score: 0,
        metadata: {
          freshness: this.computeFreshness(w.createdAt),
          domain: this.detectDomain(w.query)
        }
      }));
    } catch { return []; }
  }

  private async fetchProjects(userId: number, query: string): Promise<RAGFragment[]> {
    try {
      const searchPattern = `%${query.toLowerCase().split(/\s+/).slice(0, 2).join("%")}%`;
      const results = await db.select().from(projectMemory)
        .where(and(
          eq(projectMemory.userId, userId),
          eq(projectMemory.status, "active"),
          or(
            sql`LOWER(${projectMemory.projectName}) LIKE ${searchPattern}`,
            sql`LOWER(${projectMemory.summary}) LIKE ${searchPattern}`
          )
        ))
        .orderBy(desc(projectMemory.lastDiscussed))
        .limit(5);

      return results.map(p => ({
        source: "project" as const,
        content: `Projet "${p.projectName}": ${p.summary?.substring(0, 200) || ''} | Stack: ${p.techStack?.join(", ") || ''}`,
        score: 0,
        metadata: {
          freshness: this.computeFreshness(p.lastDiscussed),
          domain: "dev"
        }
      }));
    } catch { return []; }
  }

  private async fetchRecentActions(userId: number, recencyMs: number): Promise<RAGFragment[]> {
    try {
      const cutoff = new Date(Date.now() - recencyMs);
      const results = await db.select().from(actionLogs)
        .where(and(
          eq(actionLogs.userId, userId),
          gte(actionLogs.startedAt, cutoff)
        ))
        .orderBy(desc(actionLogs.startedAt))
        .limit(5);

      return results.map(a => ({
        source: "action_log" as const,
        content: `Action ${a.actionType} (${a.actionCategory}): ${a.status} ${a.validationNotes?.substring(0, 150) || ''}`,
        score: 0,
        metadata: {
          freshness: this.computeFreshness(a.startedAt),
          domain: a.actionCategory || undefined
        }
      }));
    } catch { return []; }
  }

  private computeFreshness(date: Date | string | null): number {
    if (!date) return 0;
    const ageMs = Date.now() - new Date(date).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    if (ageHours < 1) return 1.0;
    if (ageHours < 24) return 0.8;
    if (ageHours < 72) return 0.6;
    if (ageHours < 168) return 0.4;
    if (ageHours < 720) return 0.2;
    return 0.1;
  }

  private categoryToDomain(category: string): string {
    const map: Record<string, string> = {
      "sport": "sports", "foot": "sports", "match": "sports", "prono": "sports",
      "sugu": "sugu", "restaurant": "sugu",
      "dev": "dev", "code": "dev", "projet": "dev",
      "perso": "perso", "famille": "perso",
      "finance": "finance", "bourse": "finance",
    };
    return map[category.toLowerCase()] || "general";
  }
}

export const unifiedRAGService = new UnifiedRAGService();
