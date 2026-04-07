import { db } from "../db";
import { knowledgeBase, conversations, messages } from "@shared/schema";
import { eq, desc, and, sql, ilike } from "drizzle-orm";

export interface PreThinkResult {
  intent: string | null;
  category: string | null;
  context: string[];
  suggestedTools: string[];
  isReading: boolean;
  confidence: number;
}

interface CachedAnalysis {
  result: PreThinkResult;
  timestamp: number;
  textHash: string;
}

class PreThinkingService {
  private cache = new Map<number, CachedAnalysis>();
  private readonly CACHE_TTL = 5000;
  private readonly MIN_TEXT_LENGTH = 10;
  
  private intentPatterns: Array<{ pattern: RegExp; intent: string; category: string; tools: string[] }> = [
    { pattern: /^(bonjour|salut|hello|hey|coucou)/i, intent: "greeting", category: "conversation", tools: [] },
    { pattern: /(météo|weather|temps|température|pluie|soleil)/i, intent: "weather_query", category: "info", tools: ["weather"] },
    { pattern: /(heure|time|date|jour|aujourd'hui)/i, intent: "time_query", category: "info", tools: [] },
    { pattern: /(email|mail|message|envoie|envoyer)/i, intent: "email_action", category: "action", tools: ["email", "agentmail"] },
    { pattern: /(calendrier|rdv|rendez-vous|réunion|event|agenda)/i, intent: "calendar_action", category: "action", tools: ["calendar"] },
    { pattern: /(rappel|reminder|rappelle|n'oublie pas)/i, intent: "reminder", category: "action", tools: ["todoist"] },
    { pattern: /(tâche|task|todo|liste|faire)/i, intent: "task_action", category: "action", tools: ["todoist", "kanban"] },
    { pattern: /(cherche|recherche|trouve|search|web|internet)/i, intent: "web_search", category: "search", tools: ["mars", "web_search"] },
    { pattern: /(foot|football|match|ligue|champion|pari|bet|prono)/i, intent: "sports_query", category: "sports", tools: ["sports_data", "predictions"] },
    { pattern: /(bourse|stock|action|trading|marché|crypto)/i, intent: "stocks_query", category: "finance", tools: ["stocks"] },
    { pattern: /(spotify|musique|music|joue|play|chanson|artiste)/i, intent: "music_action", category: "action", tools: ["spotify"] },
    { pattern: /(image|photo|génère|dessine|draw|picture)/i, intent: "image_gen", category: "creative", tools: ["image_generation"] },
    { pattern: /(note|notion|document|fichier|drive)/i, intent: "document_action", category: "action", tools: ["notion", "drive"] },
    { pattern: /(maison|lumière|light|domotique|home|smart)/i, intent: "smart_home", category: "action", tools: ["domotique"] },
    { pattern: /(souviens|rappelle|mémoire|memory|sais-tu|tu sais)/i, intent: "memory_query", category: "memory", tools: ["memory"] },
    { pattern: /(analyse|explique|explain|pourquoi|comment|how|why)/i, intent: "analysis", category: "reasoning", tools: [] },
  ];

  async analyze(userId: number, text: string, conversationId?: number): Promise<PreThinkResult | null> {
    if (text.length < this.MIN_TEXT_LENGTH) {
      return null;
    }

    const textHash = this.hashText(text);
    const cached = this.cache.get(userId);
    
    if (cached && cached.textHash === textHash && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.result;
    }

    const result = await this.performAnalysis(userId, text, conversationId);
    
    this.cache.set(userId, {
      result,
      timestamp: Date.now(),
      textHash
    });

    return result;
  }

  private async performAnalysis(userId: number, text: string, conversationId?: number): Promise<PreThinkResult> {
    const result: PreThinkResult = {
      intent: null,
      category: null,
      context: [],
      suggestedTools: [],
      isReading: true,
      confidence: 0
    };

    for (const { pattern, intent, category, tools } of this.intentPatterns) {
      if (pattern.test(text)) {
        result.intent = intent;
        result.category = category;
        result.suggestedTools = tools;
        result.confidence = 70;
        break;
      }
    }

    if (!result.intent && text.endsWith("?")) {
      result.intent = "question";
      result.category = "reasoning";
      result.confidence = 50;
    }

    try {
      const keywords = this.extractKeywords(text);
      if (keywords.length > 0) {
        const relevantKnowledge = await db.select({
          title: knowledgeBase.title,
          summary: knowledgeBase.summary,
          category: knowledgeBase.category
        })
        .from(knowledgeBase)
        .where(
          and(
            eq(knowledgeBase.userId, userId),
            sql`${knowledgeBase.content} ILIKE ${`%${keywords[0]}%`}`
          )
        )
        .limit(3);

        if (relevantKnowledge.length > 0) {
          result.context = relevantKnowledge.map(k => k.summary || k.title);
          result.confidence = Math.min(90, result.confidence + 15);
        }
      }
    } catch (e) {}

    if (conversationId) {
      try {
        const recentMessages = await db.select({
          role: messages.role,
          content: messages.content
        })
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(desc(messages.createdAt))
        .limit(2);

        if (recentMessages.length > 0) {
          result.context.push(`[Context recent] ${recentMessages.map(m => m.content?.slice(0, 100)).join(" | ")}`);
        }
      } catch (e) {}
    }

    return result;
  }

  private extractKeywords(text: string): string[] {
    const stopWords = new Set(["le", "la", "les", "de", "du", "des", "un", "une", "et", "ou", "pour", "avec", "dans", "sur", "je", "tu", "il", "elle", "nous", "vous", "ils", "elles", "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses", "que", "qui", "quoi", "est", "sont", "a", "ai", "as", "ont", "être", "avoir", "faire", "dit", "dit", "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "must", "shall"]);
    
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(word => word.length > 3 && !stopWords.has(word))
      .slice(0, 5);
  }

  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  clear(userId: number): void {
    this.cache.delete(userId);
  }
}

export const preThinkingService = new PreThinkingService();
