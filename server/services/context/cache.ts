import { db } from "../../db";
import { ulysseMemory, savedLinks, users } from "@shared/schema";
import { eq, desc, and, gte, isNotNull } from "drizzle-orm";
import { assistantModeService } from "../assistantModeService";
import { testBuildCollector } from "../testBuildCollector";
import { runtimeErrorCollector } from "../runtimeErrorCollector";
import { perfProfiler } from "../perfProfiler";
import { patchProposalService } from "../patchProposalService";
import { getBehaviorPrompt, detectWorkflow, getActionPromptEnhancement } from "../../config/ulysseBehaviorRules";

interface CachedContext {
  systemPrompt: string;
  recentMemories: string[];
  importantKnowledge: string[];
  devContext?: string;
  timestamp: number;
  ttl: number;
}

interface UserContext {
  userId: number;
  cache: CachedContext | null;
}

const contextCache = new Map<number, UserContext>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MEMORY_LIMIT = 10;
const KNOWLEDGE_LIMIT = 15;

export const contextCacheService = {
  async getContext(userId: number): Promise<CachedContext | null> {
    const cached = contextCache.get(userId);
    if (cached?.cache && Date.now() - cached.cache.timestamp < cached.cache.ttl) {
      console.log(`[ContextCache] Cache hit for user ${userId}`);
      return cached.cache;
    }
    return null;
  },

  async buildContext(userId: number, forceRefresh = false): Promise<CachedContext> {
    if (!forceRefresh) {
      const cached = await this.getContext(userId);
      if (cached) return cached;
    }

    console.log(`[ContextCache] Building context for user ${userId}`);
    const startTime = Date.now();

    const [memories, knowledge, devContext] = await Promise.all([
      this.fetchRecentMemories(userId),
      this.fetchImportantKnowledge(userId),
      this.fetchDevContext(userId)
    ]);

    const context: CachedContext = {
      systemPrompt: this.buildSystemPrompt(userId),
      recentMemories: memories,
      importantKnowledge: knowledge,
      devContext,
      timestamp: Date.now(),
      ttl: CACHE_TTL
    };

    contextCache.set(userId, { userId, cache: context });
    console.log(`[ContextCache] Context built in ${Date.now() - startTime}ms`);
    
    return context;
  },

  async fetchRecentMemories(userId: number): Promise<string[]> {
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const memories = await db.select()
        .from(ulysseMemory)
        .where(and(
          eq(ulysseMemory.userId, userId),
          gte(ulysseMemory.createdAt, oneDayAgo)
        ))
        .orderBy(desc(ulysseMemory.createdAt))
        .limit(MEMORY_LIMIT);

      return memories.map(m => `[${m.category}] ${m.key}: ${m.value}`);
    } catch {
      return [];
    }
  },

  async fetchImportantKnowledge(userId: number): Promise<string[]> {
    try {
      const links = await db.select()
        .from(savedLinks)
        .where(and(
          eq(savedLinks.userId, userId),
          isNotNull(savedLinks.summary)
        ))
        .orderBy(desc(savedLinks.createdAt))
        .limit(KNOWLEDGE_LIMIT);

      return links.map(l => `[Link] ${l.title}: ${(l.summary || "").substring(0, 200)}`);
    } catch {
      return [];
    }
  },

  buildSystemPrompt(userId: number): string {
    const basePrompt = `Tu es Ulysse, un assistant IA personnel sarcastique mais efficace.
Réponds de manière ultra-concise (max 3 phrases) sauf demande explicite.
Utilise le français naturel avec une touche d'humour subtil.
Tu as accès à la mémoire et aux connaissances de l'utilisateur.`;
    
    const behaviorRules = getBehaviorPrompt();
    
    return `${basePrompt}\n\n${behaviorRules}`;
  },
  
  enhancePromptWithAction(basePrompt: string, userMessage: string): string {
    const workflow = detectWorkflow(userMessage);
    if (workflow) {
      const enhancement = getActionPromptEnhancement(workflow);
      return `${basePrompt}\n\n${enhancement}`;
    }
    return basePrompt;
  },

  async fetchDevContext(userId: number): Promise<string | undefined> {
    try {
      const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user[0]?.isOwner) {
        return undefined;
      }

      const mode = await assistantModeService.getMode(userId);
      const modeBehavior = this.getModeBehavior(mode.mode);
      
      const [testSummary, errorStats, perfStats, pendingPatches] = await Promise.all([
        testBuildCollector.getTestsSummary(24),
        runtimeErrorCollector.getErrorStats(7),
        perfProfiler.getOverallStats(24),
        patchProposalService.getPendingPatches(userId)
      ]);

      const parts: string[] = [];
      
      parts.push(`[DEV MODE: ${mode.mode.toUpperCase()}]`);
      parts.push(modeBehavior);

      if (testSummary.total > 0) {
        const failRate = testSummary.total > 0 ? ((testSummary.failed / testSummary.total) * 100).toFixed(0) : "0";
        parts.push(`[Tests] ${testSummary.passed}/${testSummary.total} passés (${failRate}% échecs)`);
        if (testSummary.failures.length > 0) {
          parts.push(`[Échecs récents] ${testSummary.failures.slice(0, 3).map(f => f.testName).join(", ")}`);
        }
      }

      if (errorStats.total > 0) {
        parts.push(`[Erreurs 7j] ${errorStats.total} (frontend: ${errorStats.bySource.frontend || 0}, backend: ${errorStats.bySource.backend || 0})`);
        if (errorStats.topErrors.length > 0) {
          parts.push(`[Top erreur] ${errorStats.topErrors[0].message.substring(0, 100)} (${errorStats.topErrors[0].count}x)`);
        }
      }

      if (perfStats.api.totalRequests > 0) {
        parts.push(`[Perf API] avg: ${perfStats.api.avgDurationMs}ms, p95: ${perfStats.api.p95Ms}ms`);
      }

      if (pendingPatches.length > 0) {
        parts.push(`[Patches] ${pendingPatches.length} en attente`);
      }

      return parts.join("\n");
    } catch (err) {
      console.error("[ContextCache] Error fetching dev context:", err);
      return undefined;
    }
  },

  getModeBehavior(mode: string): string {
    switch (mode) {
      case "ship":
        return "Mode SHIP: Livraison rapide. Minimalise les revues de code. Focus sur la fonctionnalité. Accepte les compromis de qualité raisonnables.";
      case "craft":
        return "Mode CRAFT: Équilibre qualité/vitesse. Revues de code modérées. Tests recommandés. Bonnes pratiques encouragées.";
      case "audit":
        return "Mode AUDIT: Analyse seulement. NE PAS modifier le code. Fournir des analyses, suggestions, et revues détaillées.";
      default:
        return "";
    }
  },

  async preloadContext(userId: number): Promise<void> {
    await this.buildContext(userId, false);
  },

  invalidateCache(userId: number): void {
    contextCache.delete(userId);
    console.log(`[ContextCache] Cache invalidated for user ${userId}`);
  },

  getStats(): { users: number; cachedEntries: number } {
    return {
      users: contextCache.size,
      cachedEntries: contextCache.size
    };
  }
};
