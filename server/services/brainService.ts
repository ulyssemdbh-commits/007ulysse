import { db } from "../db";
import { 
  knowledgeBase, savedLinks, knowledgeGraph, learningLog, brainStatistics,
  ulysseMemory, projectMemory, webSearchMemory, mediaLibrary, capabilityRegistry,
  KnowledgeBase, SavedLink, KnowledgeGraph, LearningLog, BrainStatistics,
  InsertKnowledgeBase, InsertSavedLink, InsertKnowledgeGraph, InsertLearningLog
} from "@shared/schema";
import { eq, desc, sql, and, or, like, gte, lte, isNull } from "drizzle-orm";
import OpenAI from "openai";
import { globalOptimizerService } from "./globalOptimizerService";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export class BrainService {
  
  // ═══════════════════════════════════════════════════════════════
  // KNOWLEDGE BASE - Core brain storage
  // ═══════════════════════════════════════════════════════════════

  async addKnowledge(userId: number, data: Omit<InsertKnowledgeBase, 'userId'>): Promise<KnowledgeBase> {
    const [knowledge] = await db.insert(knowledgeBase).values({
      ...data,
      userId,
    }).returning();
    
    await this.updateStatistics(userId);
    await this.logLearning(userId, {
      topic: data.title,
      content: `Added new ${data.type} knowledge: ${data.title}`,
      learningType: 'fact',
      sourceType: data.sourceType || 'manual',
    });
    
    return knowledge;
  }

  async getKnowledge(userId: number, id: number): Promise<KnowledgeBase | null> {
    const [knowledge] = await db.select().from(knowledgeBase)
      .where(and(eq(knowledgeBase.id, id), eq(knowledgeBase.userId, userId)));
    
    if (knowledge) {
      await db.update(knowledgeBase)
        .set({ 
          accessCount: sql`${knowledgeBase.accessCount} + 1`,
          lastAccessedAt: new Date()
        })
        .where(eq(knowledgeBase.id, id));
    }
    
    return knowledge || null;
  }

  async searchKnowledge(userId: number, query: string, options?: {
    type?: string;
    category?: string;
    limit?: number;
  }): Promise<KnowledgeBase[]> {
    const cacheKey = `search:${userId}:${query}:${options?.type || ''}:${options?.category || ''}`;
    
    return globalOptimizerService.getOrFetch(
      cacheKey,
      "brain_knowledge",
      async () => {
        const conditions = [eq(knowledgeBase.userId, userId)];
        
        if (options?.type) {
          conditions.push(eq(knowledgeBase.type, options.type));
        }
        if (options?.category) {
          conditions.push(eq(knowledgeBase.category, options.category));
        }
        
        const searchPattern = `%${query.toLowerCase()}%`;
        conditions.push(
          or(
            sql`LOWER(${knowledgeBase.title}) LIKE ${searchPattern}`,
            sql`LOWER(${knowledgeBase.content}) LIKE ${searchPattern}`,
            sql`LOWER(${knowledgeBase.summary}) LIKE ${searchPattern}`
          )!
        );
        
        return db.select().from(knowledgeBase)
          .where(and(...conditions))
          .orderBy(desc(knowledgeBase.importance), desc(knowledgeBase.accessCount))
          .limit(options?.limit || 20);
      },
      { customTTL: 30 * 1000 } // 30s TTL for brain searches
    );
  }

  async getRecentKnowledge(userId: number, limit: number = 10): Promise<KnowledgeBase[]> {
    return db.select().from(knowledgeBase)
      .where(eq(knowledgeBase.userId, userId))
      .orderBy(desc(knowledgeBase.createdAt))
      .limit(limit);
  }

  async getMostImportantKnowledge(userId: number, limit: number = 10): Promise<KnowledgeBase[]> {
    return db.select().from(knowledgeBase)
      .where(eq(knowledgeBase.userId, userId))
      .orderBy(desc(knowledgeBase.importance), desc(knowledgeBase.accessCount))
      .limit(limit);
  }

  async updateKnowledgeImportance(userId: number, id: number, delta: number): Promise<void> {
    await db.update(knowledgeBase)
      .set({ 
        importance: sql`LEAST(100, GREATEST(0, ${knowledgeBase.importance} + ${delta}))`,
        updatedAt: new Date()
      })
      .where(and(eq(knowledgeBase.id, id), eq(knowledgeBase.userId, userId)));
  }

  // ═══════════════════════════════════════════════════════════════
  // SAVED LINKS - Bookmarked URLs with analysis
  // ═══════════════════════════════════════════════════════════════

  async saveLink(userId: number, data: Omit<InsertSavedLink, 'userId'>): Promise<SavedLink> {
    const existing = await db.select().from(savedLinks)
      .where(and(eq(savedLinks.userId, userId), eq(savedLinks.url, data.url)));
    
    if (existing.length > 0) {
      const [updated] = await db.update(savedLinks)
        .set({ 
          visitCount: sql`${savedLinks.visitCount} + 1`,
          lastVisitedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(savedLinks.id, existing[0].id))
        .returning();
      return updated;
    }
    
    const [link] = await db.insert(savedLinks).values({
      ...data,
      userId,
    }).returning();
    
    await this.updateStatistics(userId);
    return link;
  }

  async analyzeLinkContent(userId: number, linkId: number, retryCount: number = 0): Promise<boolean> {
    const [link] = await db.select().from(savedLinks)
      .where(and(eq(savedLinks.id, linkId), eq(savedLinks.userId, userId)));
    
    if (!link) {
      console.error(`[Brain] Link ${linkId} not found for user ${userId}`);
      return false;
    }
    
    if (!link.cachedContent) {
      await db.update(savedLinks)
        .set({ crawlStatus: 'pending', updatedAt: new Date() })
        .where(eq(savedLinks.id, linkId));
      return false;
    }
    
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{
          role: "user",
          content: `Analyse ce contenu web et fournis un résumé structuré:

URL: ${link.url}
Titre: ${link.title}
Contenu: ${link.cachedContent.slice(0, 3000)}

Retourne un JSON avec:
{
  "summary": "résumé concis en 2-3 phrases",
  "keyPoints": ["point clé 1", "point clé 2", "point clé 3"],
  "category": "article|tool|reference|tutorial|video|news|other",
  "tags": ["tag1", "tag2"],
  "sentiment": "positive|neutral|negative",
  "readingTime": <minutes>
}`
        }],
        response_format: { type: "json_object" },
        max_tokens: 500
      });
      
      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("Empty response from AI");
      }
      
      let analysis;
      try {
        analysis = JSON.parse(content);
      } catch (parseError) {
        console.error("[Brain] Failed to parse AI response:", parseError);
        throw new Error("Invalid JSON response from AI");
      }
      
      await db.update(savedLinks)
        .set({
          summary: analysis.summary || null,
          keyPoints: analysis.keyPoints || [],
          category: analysis.category || null,
          tags: analysis.tags || [],
          sentiment: analysis.sentiment || null,
          readingTime: analysis.readingTime || null,
          crawlStatus: 'success',
          updatedAt: new Date()
        })
        .where(eq(savedLinks.id, linkId));
      
      console.log(`[Brain] Successfully analyzed link ${linkId}: ${link.title}`);
      return true;
        
    } catch (error) {
      console.error(`[Brain] Failed to analyze link ${linkId}:`, error);
      
      if (retryCount < 2) {
        const delay = Math.pow(2, retryCount) * 1000;
        console.log(`[Brain] Retrying link analysis in ${delay}ms (attempt ${retryCount + 1}/3)`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.analyzeLinkContent(userId, linkId, retryCount + 1);
      }
      
      await db.update(savedLinks)
        .set({ crawlStatus: 'failed', updatedAt: new Date() })
        .where(eq(savedLinks.id, linkId));
      
      return false;
    }
  }

  async getLinks(userId: number, options?: {
    category?: string;
    isFavorite?: boolean;
    isRead?: boolean;
    limit?: number;
  }): Promise<SavedLink[]> {
    const conditions = [eq(savedLinks.userId, userId)];
    
    if (options?.category) conditions.push(eq(savedLinks.category, options.category));
    if (options?.isFavorite !== undefined) conditions.push(eq(savedLinks.isFavorite, options.isFavorite));
    if (options?.isRead !== undefined) conditions.push(eq(savedLinks.isRead, options.isRead));
    
    return db.select().from(savedLinks)
      .where(and(...conditions))
      .orderBy(desc(savedLinks.createdAt))
      .limit(options?.limit || 50);
  }

  // ═══════════════════════════════════════════════════════════════
  // KNOWLEDGE GRAPH - Relationships between entities
  // ═══════════════════════════════════════════════════════════════

  async createRelation(userId: number, data: Omit<InsertKnowledgeGraph, 'userId'>): Promise<KnowledgeGraph> {
    const [relation] = await db.insert(knowledgeGraph).values({
      ...data,
      userId,
    }).returning();
    
    await this.updateStatistics(userId);
    return relation;
  }

  async getRelatedEntities(userId: number, entityType: string, entityId: number): Promise<{
    outgoing: KnowledgeGraph[];
    incoming: KnowledgeGraph[];
  }> {
    const outgoing = await db.select().from(knowledgeGraph)
      .where(and(
        eq(knowledgeGraph.userId, userId),
        eq(knowledgeGraph.sourceType, entityType),
        eq(knowledgeGraph.sourceId, entityId)
      ));
    
    const incoming = await db.select().from(knowledgeGraph)
      .where(and(
        eq(knowledgeGraph.userId, userId),
        eq(knowledgeGraph.targetType, entityType),
        eq(knowledgeGraph.targetId, entityId)
      ));
    
    return { outgoing, incoming };
  }

  async findConnections(userId: number, fromType: string, fromId: number, toType: string, toId: number): Promise<KnowledgeGraph[]> {
    return db.select().from(knowledgeGraph)
      .where(and(
        eq(knowledgeGraph.userId, userId),
        eq(knowledgeGraph.sourceType, fromType),
        eq(knowledgeGraph.sourceId, fromId),
        eq(knowledgeGraph.targetType, toType),
        eq(knowledgeGraph.targetId, toId)
      ));
  }

  // ═══════════════════════════════════════════════════════════════
  // LEARNING LOG - Track what Ulysse learns
  // ═══════════════════════════════════════════════════════════════

  async logLearning(userId: number, data: Omit<InsertLearningLog, 'userId'>): Promise<LearningLog> {
    const [log] = await db.insert(learningLog).values({
      ...data,
      userId,
      appliedAt: new Date(),
    }).returning();
    
    return log;
  }

  async getRecentLearnings(userId: number, limit: number = 20): Promise<LearningLog[]> {
    return db.select().from(learningLog)
      .where(eq(learningLog.userId, userId))
      .orderBy(desc(learningLog.createdAt))
      .limit(limit);
  }

  async getLearningsByType(userId: number, type: string): Promise<LearningLog[]> {
    return db.select().from(learningLog)
      .where(and(eq(learningLog.userId, userId), eq(learningLog.learningType, type)))
      .orderBy(desc(learningLog.createdAt));
  }

  // ═══════════════════════════════════════════════════════════════
  // BRAIN STATISTICS - Overall brain health
  // ═══════════════════════════════════════════════════════════════

  async getStatistics(userId: number): Promise<BrainStatistics | null> {
    const [stats] = await db.select().from(brainStatistics)
      .where(eq(brainStatistics.userId, userId));
    return stats || null;
  }

  async updateStatistics(userId: number): Promise<void> {
    const [knowledgeCount] = await db.select({ count: sql<number>`count(*)` })
      .from(knowledgeBase).where(eq(knowledgeBase.userId, userId));
    
    const [linksCount] = await db.select({ count: sql<number>`count(*)` })
      .from(savedLinks).where(eq(savedLinks.userId, userId));
    
    const [connectionsCount] = await db.select({ count: sql<number>`count(*)` })
      .from(knowledgeGraph).where(eq(knowledgeGraph.userId, userId));
    
    const [learningsCount] = await db.select({ count: sql<number>`count(*)` })
      .from(learningLog).where(eq(learningLog.userId, userId));
    
    const existing = await this.getStatistics(userId);
    
    if (existing) {
      await db.update(brainStatistics)
        .set({
          totalKnowledge: Number(knowledgeCount.count) || 0,
          totalLinks: Number(linksCount.count) || 0,
          totalConnections: Number(connectionsCount.count) || 0,
          totalLearnings: Number(learningsCount.count) || 0,
          updatedAt: new Date()
        })
        .where(eq(brainStatistics.userId, userId));
    } else {
      await db.insert(brainStatistics).values({
        userId,
        totalKnowledge: Number(knowledgeCount.count) || 0,
        totalLinks: Number(linksCount.count) || 0,
        totalConnections: Number(connectionsCount.count) || 0,
        totalLearnings: Number(learningsCount.count) || 0,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // UNIFIED BRAIN QUERY - Search across all memory types
  // ═══════════════════════════════════════════════════════════════

  async queryBrain(userId: number, query: string, options?: {
    includeKnowledge?: boolean;
    includeLinks?: boolean;
    includeMemories?: boolean;
    includeProjects?: boolean;
    limit?: number;
  }): Promise<{
    knowledge: KnowledgeBase[];
    links: SavedLink[];
    memories: any[];
    projects: any[];
  }> {
    const limit = options?.limit || 10;
    const searchPattern = `%${query.toLowerCase()}%`;
    
    const results: {
      knowledge: KnowledgeBase[];
      links: SavedLink[];
      memories: any[];
      projects: any[];
    } = {
      knowledge: [],
      links: [],
      memories: [],
      projects: []
    };
    
    if (options?.includeKnowledge !== false) {
      results.knowledge = await db.select().from(knowledgeBase)
        .where(and(
          eq(knowledgeBase.userId, userId),
          or(
            sql`LOWER(${knowledgeBase.title}) LIKE ${searchPattern}`,
            sql`LOWER(${knowledgeBase.content}) LIKE ${searchPattern}`
          )
        ))
        .orderBy(desc(knowledgeBase.importance))
        .limit(limit);
    }
    
    if (options?.includeLinks !== false) {
      results.links = await db.select().from(savedLinks)
        .where(and(
          eq(savedLinks.userId, userId),
          or(
            sql`LOWER(${savedLinks.title}) LIKE ${searchPattern}`,
            sql`LOWER(${savedLinks.summary}) LIKE ${searchPattern}`
          )
        ))
        .limit(limit);
    }
    
    if (options?.includeMemories !== false) {
      results.memories = await db.select().from(ulysseMemory)
        .where(and(
          eq(ulysseMemory.userId, userId),
          or(
            sql`LOWER(${ulysseMemory.key}) LIKE ${searchPattern}`,
            sql`LOWER(${ulysseMemory.value}) LIKE ${searchPattern}`
          )
        ))
        .orderBy(desc(ulysseMemory.confidence))
        .limit(limit);
    }
    
    if (options?.includeProjects !== false) {
      results.projects = await db.select().from(projectMemory)
        .where(and(
          eq(projectMemory.userId, userId),
          or(
            sql`LOWER(${projectMemory.projectName}) LIKE ${searchPattern}`,
            sql`LOWER(${projectMemory.summary}) LIKE ${searchPattern}`
          )
        ))
        .limit(limit);
    }
    
    return results;
  }

  // ═══════════════════════════════════════════════════════════════
  // CONTEXT BUILDER - Build context for AI conversations
  // ═══════════════════════════════════════════════════════════════

  async buildConversationContext(userId: number, userMessage: string): Promise<string> {
    const results = await this.queryBrain(userId, userMessage, {
      includeKnowledge: true,
      includeMemories: true,
      includeProjects: true,
      limit: 5
    });
    
    let context = "";
    
    if (results.knowledge.length > 0) {
      context += "\n[Connaissances pertinentes]\n";
      results.knowledge.forEach(k => {
        context += `- ${k.title}: ${k.summary || k.content.slice(0, 200)}\n`;
      });
    }
    
    if (results.memories.length > 0) {
      context += "\n[Mémoires de l'utilisateur]\n";
      results.memories.forEach(m => {
        context += `- ${m.key}: ${m.value}\n`;
      });
    }
    
    if (results.projects.length > 0) {
      context += "\n[Projets liés]\n";
      results.projects.forEach(p => {
        context += `- ${p.projectName}: ${p.summary || 'Pas de résumé'}\n`;
      });
    }
    
    return context;
  }

  // ═══════════════════════════════════════════════════════════════
  // BRAIN MAINTENANCE - Cleanup and optimization
  // ═══════════════════════════════════════════════════════════════

  async cleanupExpiredKnowledge(userId: number): Promise<number> {
    const result = await db.delete(knowledgeBase)
      .where(and(
        eq(knowledgeBase.userId, userId),
        eq(knowledgeBase.isTemporary, true),
        lte(knowledgeBase.expiresAt, new Date())
      ))
      .returning();
    
    if (result.length > 0) {
      await this.updateStatistics(userId);
    }
    
    return result.length;
  }

  async decayUnusedKnowledge(userId: number, daysThreshold: number = 30): Promise<number> {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - daysThreshold);
    
    const result = await db.update(knowledgeBase)
      .set({ 
        importance: sql`GREATEST(10, ${knowledgeBase.importance} - 5)`,
        updatedAt: new Date()
      })
      .where(and(
        eq(knowledgeBase.userId, userId),
        or(
          isNull(knowledgeBase.lastAccessedAt),
          lte(knowledgeBase.lastAccessedAt, thresholdDate)
        ),
        sql`${knowledgeBase.importance} > 10`
      ))
      .returning();
    
    return result.length;
  }
}

export const brainService = new BrainService();
