/**
 * Brain Context Service V2
 * 
 * Injects relevant Brain knowledge into AI prompts:
 * - Searches relevant knowledge based on query/context
 * - Formats context for prompt injection
 * - Maintains persona-aware filtering
 */

import { brainService } from "./brainService";
import { memoryGraphService } from "./memoryGraphService";
import { pugi } from "./proactiveGeneralIntelligence";
import { db } from "../db";
import { knowledgeBase, knowledgeGraph, ulysseMemory, projectMemory, actionLogs } from "@shared/schema";
import { eq, desc, and, or, sql, inArray } from "drizzle-orm";
import { PersonaType } from "../config/personaMapping";

const LOG_PREFIX = "[BrainContext]";

export interface BrainContextRequest {
  userId: number;
  query: string;
  persona: PersonaType;
  domain?: string;
  maxTokens?: number;
  includeGraph?: boolean;
}

export interface BrainContextResponse {
  contextBlock: string;
  sources: BrainSource[];
  relevanceScore: number;
  directAnswer?: string;
  relatedTopics: string[];
  personalRules?: string[];
}

export interface BrainSource {
  id: number;
  title: string;
  type: string;
  category: string;
  importance: number;
  confidence: number;
  excerpt: string;
}

const DOMAIN_CATEGORIES: Record<string, string[]> = {
  sugu: ["work", "project"],
  foot: ["sports", "learning"],
  pronos: ["sports", "learning"],
  trading: ["trading", "learning", "finance"],
  marche: ["trading", "finance"],
  perso: ["personal", "reference"],
  famille: ["personal"],
  domotique: ["technical", "reference"]
};

const TRADING_KEYWORDS = [
  "trading", "bourse", "action", "stock", "marche", "investissement",
  "position", "stop-loss", "take-profit", "risque", "portefeuille",
  "analyse", "scenario", "crypto", "forex", "cfd", "etf"
];

const SPORTS_KEYWORDS = [
  "foot", "football", "match", "ligue", "championnat", "equipe",
  "prono", "pronos", "paris", "bet", "cote", "bookmaker",
  "bankroll", "stake", "value", "handicap", "over", "under",
  "btts", "victoire", "nul", "defaite", "score"
];

const GENERAL_KEYWORDS = [
  "email", "mail", "message", "calendrier", "agenda", "reunion",
  "rappel", "note", "fichier", "document", "recherche", "web",
  "meteo", "temps", "heure", "date", "question", "aide",
  "info", "actualite", "news", "traduction", "calcul"
];

const PERSONA_ALLOWED_DOMAINS: Record<PersonaType, string[]> = {
  ulysse: ["sugu", "foot", "pronos", "trading", "perso", "famille", "domotique"],
  iris: ["perso", "famille", "domotique"],
  alfred: ["sugu"]
};

class BrainContextService {

  async getContext(request: BrainContextRequest): Promise<BrainContextResponse> {
    console.log(`${LOG_PREFIX} Building context for query: "${request.query.slice(0, 50)}..."`);
    
    const allowedDomains = PERSONA_ALLOWED_DOMAINS[request.persona] || [];
    const effectiveDomain = request.domain && allowedDomains.includes(request.domain) 
      ? request.domain 
      : undefined;
    
    const [knowledge, graphConnections, personalRules, projectContext, memoryGraphBlock] = await Promise.all([
      this.searchRelevantKnowledge(request.userId, request.query, effectiveDomain),
      request.includeGraph !== false ? this.getGraphContext(request.userId, request.query) : [],
      this.getPersonalRules(request.userId, request.persona),
      effectiveDomain ? this.getProjectContext(request.userId, effectiveDomain) : null,
      memoryGraphService.buildGraphContextBlock(request.query, request.userId)
    ]);
    
    const sources = this.formatSources(knowledge);
    const relevanceScore = this.calculateRelevance(knowledge, request.query);
    
    const directAnswer = this.findDirectAnswer(knowledge);
    const relatedTopics = this.extractTopics(knowledge, graphConnections);
    
    let contextBlock = this.buildContextBlock(
      knowledge,
      graphConnections,
      projectContext,
      personalRules,
      request
    );
    
    if (memoryGraphBlock) {
      contextBlock += memoryGraphBlock;
    }

    const pugiBlock = pugi.generatePromptBlock();
    if (pugiBlock) {
      contextBlock += `\n\n${pugiBlock}`;
    }
    
    return {
      contextBlock,
      sources,
      relevanceScore,
      directAnswer,
      relatedTopics,
      personalRules
    };
  }

  private async searchRelevantKnowledge(
    userId: number,
    query: string,
    domain?: string
  ): Promise<typeof knowledgeBase.$inferSelect[]> {
    const baseTerms = this.extractSearchTerms(query);
    const searchTerms = this.enrichWithDomainKeywords(baseTerms, domain);
    const categories = domain ? DOMAIN_CATEGORIES[domain] || [] : [];
    
    const conditions = [eq(knowledgeBase.userId, userId)];
    
    if (categories.length > 0) {
      conditions.push(inArray(knowledgeBase.category, categories));
    }
    
    if (searchTerms.length > 0) {
      const searchConditions = searchTerms.map(term => {
        const pattern = `%${term.toLowerCase()}%`;
        return or(
          sql`LOWER(${knowledgeBase.title}) LIKE ${pattern}`,
          sql`LOWER(${knowledgeBase.content}) LIKE ${pattern}`,
          sql`LOWER(${knowledgeBase.summary}) LIKE ${pattern}`
        );
      });
      conditions.push(or(...searchConditions.filter(Boolean))!);
    }
    
    const results = await db.select()
      .from(knowledgeBase)
      .where(and(...conditions))
      .orderBy(desc(knowledgeBase.importance), desc(knowledgeBase.confidence))
      .limit(10);
    
    return results;
  }

  private async getGraphContext(
    userId: number,
    query: string
  ): Promise<{ sourceLabel: string; relationship: string; targetLabel: string }[]> {
    try {
      const terms = this.extractSearchTerms(query);
      if (terms.length === 0) return [];
      
      const connections = await db.select({
        sourceLabel: knowledgeGraph.sourceLabel,
        relationship: knowledgeGraph.relationship,
        targetLabel: knowledgeGraph.targetLabel
      })
      .from(knowledgeGraph)
      .where(and(
        eq(knowledgeGraph.userId, userId),
        or(
          ...terms.map(term => sql`LOWER(${knowledgeGraph.sourceLabel}) LIKE ${`%${term.toLowerCase()}%`}`),
          ...terms.map(term => sql`LOWER(${knowledgeGraph.targetLabel}) LIKE ${`%${term.toLowerCase()}%`}`)
        )
      ))
      .limit(5);
      
      return connections;
    } catch (error) {
      console.error(`${LOG_PREFIX} Graph context error:`, error);
      return [];
    }
  }

  private async getPersonalRules(userId: number, persona: PersonaType): Promise<string[]> {
    const rules: string[] = [];
    
    try {
      const ruleMemories = await db.select()
        .from(ulysseMemory)
        .where(and(
          eq(ulysseMemory.userId, userId),
          or(
            eq(ulysseMemory.category, "preference"),
            eq(ulysseMemory.category, "habit")
          )
        ))
        .limit(10);
      
      for (const memory of ruleMemories) {
        if (persona === "ulysse" || 
            (persona === "iris" && !memory.key.toLowerCase().includes("sugu")) ||
            (persona === "alfred" && memory.key.toLowerCase().includes("sugu"))) {
          rules.push(`${memory.key}: ${memory.value}`);
        }
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} Personal rules error:`, error);
    }
    
    return rules.slice(0, 5);
  }

  async getTradingContext(userId: number): Promise<{
    rules: string[];
    recentAnalyses: string[];
    errors: string[];
    profile: { horizon: string; riskTolerance: string; style: string } | null;
  }> {
    const rules: string[] = [];
    const recentAnalyses: string[] = [];
    const errors: string[] = [];
    
    try {
      const tradingMemories = await db.select()
        .from(ulysseMemory)
        .where(and(
          eq(ulysseMemory.userId, userId),
          or(
            sql`LOWER(${ulysseMemory.key}) LIKE '%trading%'`,
            sql`LOWER(${ulysseMemory.key}) LIKE '%bourse%'`,
            sql`LOWER(${ulysseMemory.key}) LIKE '%risk%'`,
            sql`LOWER(${ulysseMemory.key}) LIKE '%position%'`,
            sql`LOWER(${ulysseMemory.key}) LIKE '%stop%'`
          )
        ))
        .limit(10);
      
      for (const memory of tradingMemories) {
        rules.push(`${memory.key}: ${memory.value}`);
      }
      
      const tradingKnowledge = await db.select()
        .from(knowledgeBase)
        .where(and(
          eq(knowledgeBase.userId, userId),
          or(
            eq(knowledgeBase.category, "trading"),
            eq(knowledgeBase.category, "finance")
          )
        ))
        .orderBy(desc(knowledgeBase.createdAt))
        .limit(10);
      
      for (const k of tradingKnowledge) {
        if (k.type === "insight" || k.type === "analysis") {
          recentAnalyses.push(k.summary || k.title);
        }
        if (k.type === "error" || k.title.toLowerCase().includes("erreur")) {
          errors.push(k.summary || k.title);
        }
      }
      
      let profile = null;
      const profileMemory = tradingMemories.find(m => 
        m.key.toLowerCase().includes("profil") || m.key.toLowerCase().includes("profile")
      );
      if (profileMemory) {
        try {
          profile = JSON.parse(profileMemory.value);
        } catch {
          profile = { horizon: "moyen", riskTolerance: "modere", style: "swing" };
        }
      }
      
      return { rules, recentAnalyses, errors, profile };
    } catch (error) {
      console.error(`${LOG_PREFIX} Trading context error:`, error);
      return { rules: [], recentAnalyses: [], errors: [], profile: null };
    }
  }

  async getSportsContext(userId: number): Promise<{
    rules: string[];
    recentPredictions: string[];
    performance: { wins: number; losses: number; pending: number; winRate: number };
    bankrollRules: string[];
  }> {
    const rules: string[] = [];
    const recentPredictions: string[] = [];
    const bankrollRules: string[] = [];
    
    try {
      const sportsMemories = await db.select()
        .from(ulysseMemory)
        .where(and(
          eq(ulysseMemory.userId, userId),
          or(
            sql`LOWER(${ulysseMemory.key}) LIKE '%prono%'`,
            sql`LOWER(${ulysseMemory.key}) LIKE '%paris%'`,
            sql`LOWER(${ulysseMemory.key}) LIKE '%bankroll%'`,
            sql`LOWER(${ulysseMemory.key}) LIKE '%stake%'`,
            sql`LOWER(${ulysseMemory.key}) LIKE '%foot%'`
          )
        ))
        .limit(15);
      
      for (const memory of sportsMemories) {
        const keyLower = memory.key.toLowerCase();
        if (keyLower.includes("bankroll") || keyLower.includes("stake") || keyLower.includes("mise")) {
          bankrollRules.push(`${memory.key}: ${memory.value}`);
        } else {
          rules.push(`${memory.key}: ${memory.value}`);
        }
      }
      
      const sportsKnowledge = await db.select()
        .from(knowledgeBase)
        .where(and(
          eq(knowledgeBase.userId, userId),
          eq(knowledgeBase.category, "sports")
        ))
        .orderBy(desc(knowledgeBase.createdAt))
        .limit(10);
      
      for (const k of sportsKnowledge) {
        if (k.type === "prediction" || k.title.toLowerCase().includes("prono")) {
          recentPredictions.push(k.summary || k.title);
        }
      }
      
      let wins = 0, losses = 0, pending = 0;
      for (const k of sportsKnowledge) {
        const status = (k.summary || "").toLowerCase();
        if (status.includes("gagne") || status.includes("win")) wins++;
        else if (status.includes("perdu") || status.includes("loss")) losses++;
        else if (status.includes("pending") || status.includes("attente")) pending++;
      }
      
      const total = wins + losses;
      const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
      
      return {
        rules,
        recentPredictions,
        performance: { wins, losses, pending, winRate },
        bankrollRules
      };
    } catch (error) {
      console.error(`${LOG_PREFIX} Sports context error:`, error);
      return {
        rules: [],
        recentPredictions: [],
        performance: { wins: 0, losses: 0, pending: 0, winRate: 0 },
        bankrollRules: []
      };
    }
  }

  async getGeneralContext(userId: number): Promise<{
    preferences: string[];
    recentTopics: string[];
    frequentActions: string[];
    habits: string[];
  }> {
    const preferences: string[] = [];
    const recentTopics: string[] = [];
    const habits: string[] = [];
    
    try {
      const userMemories = await db.select()
        .from(ulysseMemory)
        .where(and(
          eq(ulysseMemory.userId, userId),
          or(
            eq(ulysseMemory.category, "preference"),
            eq(ulysseMemory.category, "habit"),
            eq(ulysseMemory.category, "context")
          )
        ))
        .orderBy(desc(ulysseMemory.updatedAt))
        .limit(20);
      
      for (const memory of userMemories) {
        const entry = `${memory.key}: ${memory.value}`;
        if (memory.category === "preference") {
          preferences.push(entry);
        } else if (memory.category === "habit") {
          habits.push(entry);
        }
      }
      
      const recentKnowledge = await db.select()
        .from(knowledgeBase)
        .where(and(
          eq(knowledgeBase.userId, userId),
          or(
            eq(knowledgeBase.category, "general"),
            eq(knowledgeBase.category, "reference"),
            eq(knowledgeBase.category, "learning")
          )
        ))
        .orderBy(desc(knowledgeBase.createdAt))
        .limit(5);
      
      for (const k of recentKnowledge) {
        recentTopics.push(k.title);
      }
      
      const recentActions = await db.select({
        category: actionLogs.actionCategory,
        count: sql<number>`count(*)`
      })
      .from(actionLogs)
      .where(and(
        eq(actionLogs.userId, userId),
        gte(actionLogs.startedAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
      ))
      .groupBy(actionLogs.actionCategory)
      .orderBy(desc(sql`count(*)`))
      .limit(5);
      
      const frequentActions = recentActions.map(a => 
        `${a.category}: ${a.count} fois`
      );
      
      return {
        preferences: preferences.slice(0, 5),
        recentTopics,
        frequentActions,
        habits: habits.slice(0, 5)
      };
    } catch (error) {
      console.error(`${LOG_PREFIX} General context error:`, error);
      return {
        preferences: [],
        recentTopics: [],
        frequentActions: [],
        habits: []
      };
    }
  }

  private async getProjectContext(
    userId: number,
    domain: string
  ): Promise<{ projectName: string; summary: string; context: string } | null> {
    try {
      const projectName = domain === "sugu" ? "SUGU" : domain.toUpperCase();
      
      const [project] = await db.select()
        .from(projectMemory)
        .where(and(
          eq(projectMemory.userId, userId),
          sql`LOWER(${projectMemory.projectName}) LIKE ${`%${projectName.toLowerCase()}%`}`
        ))
        .limit(1);
      
      if (project) {
        return {
          projectName: project.projectName,
          summary: project.summary || "",
          context: project.context || ""
        };
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} Project context error:`, error);
    }
    
    return null;
  }

  private extractSearchTerms(query: string): string[] {
    const stopWords = new Set([
      "le", "la", "les", "un", "une", "des", "de", "du", "au", "aux",
      "et", "ou", "mais", "donc", "car", "ni", "que", "qui", "quoi",
      "est", "sont", "a", "ont", "je", "tu", "il", "elle", "nous", "vous",
      "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses",
      "ce", "cette", "ces", "pour", "par", "avec", "sans", "sur", "sous",
      "the", "a", "an", "is", "are", "was", "were", "be", "been",
      "comment", "quand", "où", "pourquoi", "combien"
    ]);
    
    return query
      .toLowerCase()
      .replace(/[^\w\sàâäéèêëïîôùûüç]/g, " ")
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));
  }

  private enrichWithDomainKeywords(terms: string[], domain?: string): string[] {
    if (!domain) return terms;
    
    const domainKeywords: Record<string, string[]> = {
      trading: TRADING_KEYWORDS,
      marche: TRADING_KEYWORDS,
      foot: SPORTS_KEYWORDS,
      pronos: SPORTS_KEYWORDS,
      sports: SPORTS_KEYWORDS,
      general: GENERAL_KEYWORDS,
      email: GENERAL_KEYWORDS,
      calendrier: GENERAL_KEYWORDS
    };
    
    const keywords = domainKeywords[domain];
    if (!keywords) return terms;
    
    const matchedKeywords = keywords.filter(kw => 
      terms.some(t => kw.includes(t) || t.includes(kw))
    );
    
    const enriched = [...new Set([...terms, ...matchedKeywords.slice(0, 3)])];
    return enriched;
  }

  private formatSources(knowledge: typeof knowledgeBase.$inferSelect[]): BrainSource[] {
    return knowledge.map(k => ({
      id: k.id,
      title: k.title,
      type: k.type,
      category: k.category,
      importance: k.importance,
      confidence: k.confidence,
      excerpt: k.summary || k.content.slice(0, 150) + "..."
    }));
  }

  private calculateRelevance(
    knowledge: typeof knowledgeBase.$inferSelect[],
    query: string
  ): number {
    if (knowledge.length === 0) return 0;
    
    const avgImportance = knowledge.reduce((sum, k) => sum + k.importance, 0) / knowledge.length;
    const avgConfidence = knowledge.reduce((sum, k) => sum + k.confidence, 0) / knowledge.length;
    
    const countBonus = Math.min(30, knowledge.length * 5);
    
    return Math.min(100, Math.round(
      avgImportance * 0.4 + avgConfidence * 0.3 + countBonus
    ));
  }

  private findDirectAnswer(knowledge: typeof knowledgeBase.$inferSelect[]): string | undefined {
    const highConfidence = knowledge.filter(k => k.confidence >= 85 && k.importance >= 70);
    if (highConfidence.length > 0) {
      return highConfidence[0].summary || highConfidence[0].content.slice(0, 300);
    }
    return undefined;
  }

  private extractTopics(
    knowledge: typeof knowledgeBase.$inferSelect[],
    connections: { sourceLabel: string; relationship: string; targetLabel: string }[]
  ): string[] {
    const topics = new Set<string>();
    
    for (const k of knowledge) {
      topics.add(k.category);
      if (k.subcategory) topics.add(k.subcategory);
    }
    
    for (const c of connections) {
      topics.add(c.sourceLabel);
      topics.add(c.targetLabel);
    }
    
    return [...topics].slice(0, 5);
  }

  private buildContextBlock(
    knowledge: typeof knowledgeBase.$inferSelect[],
    graphConnections: { sourceLabel: string; relationship: string; targetLabel: string }[],
    projectContext: { projectName: string; summary: string; context: string } | null,
    personalRules: string[],
    request: BrainContextRequest
  ): string {
    const sections: string[] = [];
    
    if (personalRules.length > 0) {
      sections.push(`## Règles et préférences de l'utilisateur
${personalRules.map(r => `- ${r}`).join("\n")}`);
    }
    
    if (projectContext) {
      sections.push(`## Contexte projet: ${projectContext.projectName}
${projectContext.summary}
${projectContext.context}`);
    }
    
    if (knowledge.length > 0) {
      const knowledgeBlock = knowledge.slice(0, 5).map(k => 
        `### ${k.title} (${k.category}, confiance: ${k.confidence}%)
${k.summary || k.content.slice(0, 200)}`
      ).join("\n\n");
      
      sections.push(`## Connaissances pertinentes
${knowledgeBlock}`);
    }
    
    if (graphConnections.length > 0) {
      const graphBlock = graphConnections.map(c => 
        `- ${c.sourceLabel} → ${c.relationship} → ${c.targetLabel}`
      ).join("\n");
      
      sections.push(`## Connexions dans le graphe de connaissances
${graphBlock}`);
    }
    
    if (sections.length === 0) {
      return "";
    }
    
    return `
═══════════════════════════════════════════════════════════
CONTEXTE BRAIN - Connaissances personnalisées pour ${request.persona.toUpperCase()}
═══════════════════════════════════════════════════════════

${sections.join("\n\n---\n\n")}

═══════════════════════════════════════════════════════════
`;
  }

  async getDomainBrief(
    userId: number,
    domain: string,
    persona: PersonaType
  ): Promise<{
    summary: string;
    recentInsights: string[];
    openTasks: string[];
    warnings: string[];
  }> {
    const recentInsights: string[] = [];
    const warnings: string[] = [];
    
    try {
      const categories = DOMAIN_CATEGORIES[domain] || [];
      
      const recentKnowledge = await db.select()
        .from(knowledgeBase)
        .where(and(
          eq(knowledgeBase.userId, userId),
          inArray(knowledgeBase.category, categories)
        ))
        .orderBy(desc(knowledgeBase.createdAt))
        .limit(5);
      
      for (const k of recentKnowledge) {
        if (k.type === "insight") {
          recentInsights.push(k.summary || k.title);
        }
      }
      
      const summary = recentKnowledge.length > 0
        ? `${recentKnowledge.length} entrées de connaissance pour le domaine ${domain}`
        : `Aucune connaissance spécifique pour ${domain}`;
      
      return {
        summary,
        recentInsights,
        openTasks: [],
        warnings
      };
    } catch (error) {
      console.error(`${LOG_PREFIX} Domain brief error:`, error);
      return {
        summary: "Erreur lors de la récupération du contexte",
        recentInsights: [],
        openTasks: [],
        warnings: ["Erreur de récupération du Brain"]
      };
    }
  }
}

export const brainContextService = new BrainContextService();
