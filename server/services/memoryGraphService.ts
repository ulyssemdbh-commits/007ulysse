import { db } from "../db";
import { memoryConnections, ulysseMemory, MemoryConnection } from "@shared/schema";
import { eq, and, or, desc, sql, lt } from "drizzle-orm";

const LOG_PREFIX = "[MemoryGraph]";

class MemoryGraphService {

  async connectMemories(
    memId1: number,
    memId2: number,
    relationship: string,
    strength: number = 0.5
  ): Promise<MemoryConnection | null> {
    try {
      const existing = await db.select().from(memoryConnections)
        .where(and(
          eq(memoryConnections.sourceMemoryId, memId1),
          eq(memoryConnections.targetMemoryId, memId2),
          eq(memoryConnections.relationshipType, relationship)
        ));

      if (existing.length > 0) {
        const newStrength = Math.min(1, existing[0].strength + 0.1);
        await db.update(memoryConnections)
          .set({ strength: newStrength })
          .where(eq(memoryConnections.id, existing[0].id));
        return { ...existing[0], strength: newStrength };
      }

      const [connection] = await db.insert(memoryConnections).values({
        sourceMemoryId: memId1,
        targetMemoryId: memId2,
        relationshipType: relationship,
        strength
      }).returning();

      return connection;
    } catch (error) {
      console.error(`${LOG_PREFIX} connectMemories error:`, error);
      return null;
    }
  }

  async autoConnect(memoryId: number): Promise<number> {
    try {
      const [memory] = await db.select().from(ulysseMemory)
        .where(eq(ulysseMemory.id, memoryId));

      if (!memory) return 0;

      const candidates = await db.select().from(ulysseMemory)
        .where(and(
          eq(ulysseMemory.userId, memory.userId),
          sql`${ulysseMemory.id} != ${memoryId}`
        ))
        .limit(100);

      let connected = 0;
      const memWords = new Set(
        (memory.key + " " + memory.value).toLowerCase().split(/\s+/).filter(w => w.length > 3)
      );

      for (const candidate of candidates) {
        if (candidate.category === memory.category) {
          await this.connectMemories(memoryId, candidate.id, "same_category", 0.3);
          connected++;
          continue;
        }

        const candidateWords = new Set(
          (candidate.key + " " + candidate.value).toLowerCase().split(/\s+/).filter(w => w.length > 3)
        );

        let overlap = 0;
        memWords.forEach(w => { if (candidateWords.has(w)) overlap++; });

        if (overlap >= 2) {
          const strength = Math.min(0.9, 0.3 + overlap * 0.15);
          await this.connectMemories(memoryId, candidate.id, "keyword_overlap", strength);
          connected++;
        }
      }

      if (connected > 0) {
        console.log(`${LOG_PREFIX} Auto-connected memory ${memoryId} to ${connected} others`);
      }
      return connected;
    } catch (error) {
      console.error(`${LOG_PREFIX} autoConnect error:`, error);
      return 0;
    }
  }

  async getRelatedMemories(memoryId: number, maxDepth: number = 2): Promise<{
    memory: typeof ulysseMemory.$inferSelect;
    relationship: string;
    strength: number;
    depth: number;
  }[]> {
    try {
      const visited = new Set<number>([memoryId]);
      const results: {
        memory: typeof ulysseMemory.$inferSelect;
        relationship: string;
        strength: number;
        depth: number;
      }[] = [];

      let currentIds = [memoryId];

      for (let depth = 1; depth <= maxDepth; depth++) {
        if (currentIds.length === 0) break;

        const connections = await db.select().from(memoryConnections)
          .where(or(
            sql`${memoryConnections.sourceMemoryId} IN (${sql.join(currentIds.map(id => sql`${id}`), sql`, `)})`,
            sql`${memoryConnections.targetMemoryId} IN (${sql.join(currentIds.map(id => sql`${id}`), sql`, `)})`
          ))
          .orderBy(desc(memoryConnections.strength));

        const nextIds: number[] = [];

        for (const conn of connections) {
          const relatedId = currentIds.includes(conn.sourceMemoryId)
            ? conn.targetMemoryId
            : conn.sourceMemoryId;

          if (visited.has(relatedId)) continue;
          visited.add(relatedId);

          const [mem] = await db.select().from(ulysseMemory)
            .where(eq(ulysseMemory.id, relatedId));

          if (mem) {
            results.push({
              memory: mem,
              relationship: conn.relationshipType,
              strength: conn.strength,
              depth
            });
            nextIds.push(relatedId);
          }
        }

        currentIds = nextIds;
      }

      return results.sort((a, b) => b.strength - a.strength).slice(0, 10);
    } catch (error) {
      console.error(`${LOG_PREFIX} getRelatedMemories error:`, error);
      return [];
    }
  }

  async getContextualMemories(query: string, userId: number): Promise<{
    memory: typeof ulysseMemory.$inferSelect;
    relationship: string;
    strength: number;
  }[]> {
    try {
      const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      if (queryWords.length === 0) return [];

      const searchConditions = queryWords.map(word => {
        const pattern = `%${word}%`;
        return or(
          sql`LOWER(${ulysseMemory.key}) LIKE ${pattern}`,
          sql`LOWER(${ulysseMemory.value}) LIKE ${pattern}`
        );
      });

      const matchingMemories = await db.select().from(ulysseMemory)
        .where(and(
          eq(ulysseMemory.userId, userId),
          or(...searchConditions.filter(Boolean))!
        ))
        .orderBy(desc(ulysseMemory.confidence))
        .limit(5);

      if (matchingMemories.length === 0) return [];

      const allRelated: Map<number, {
        memory: typeof ulysseMemory.$inferSelect;
        relationship: string;
        strength: number;
      }> = new Map();

      for (const mem of matchingMemories) {
        allRelated.set(mem.id, {
          memory: mem,
          relationship: "direct_match",
          strength: 1.0
        });
      }

      for (const mem of matchingMemories) {
        const related = await this.getRelatedMemories(mem.id, 1);
        for (const r of related) {
          if (!allRelated.has(r.memory.id)) {
            allRelated.set(r.memory.id, {
              memory: r.memory,
              relationship: r.relationship,
              strength: r.strength * 0.7
            });
          }
        }
      }

      return Array.from(allRelated.values())
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 8);
    } catch (error) {
      console.error(`${LOG_PREFIX} getContextualMemories error:`, error);
      return [];
    }
  }

  async summarizeOldMemories(userId: number): Promise<{ summarized: number; removed: number }> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 60);

      const oldMemories = await db.select().from(ulysseMemory)
        .where(and(
          eq(ulysseMemory.userId, userId),
          lt(ulysseMemory.updatedAt, cutoffDate),
          sql`${ulysseMemory.confidence} < 40`
        ))
        .orderBy(ulysseMemory.category);

      if (oldMemories.length < 3) return { summarized: 0, removed: 0 };

      const byCategory: Record<string, typeof oldMemories> = {};
      for (const mem of oldMemories) {
        if (!byCategory[mem.category]) byCategory[mem.category] = [];
        byCategory[mem.category].push(mem);
      }

      let summarized = 0;
      let removed = 0;

      for (const [category, memories] of Object.entries(byCategory)) {
        if (memories.length < 2) continue;

        const summaryValue = memories
          .map(m => `${m.key}: ${m.value}`)
          .join("; ");

        const truncatedSummary = summaryValue.slice(0, 500);

        await db.insert(ulysseMemory).values({
          userId,
          category,
          key: `summary_${category}_${Date.now()}`,
          value: truncatedSummary,
          confidence: 30,
          source: `Consolidated from ${memories.length} old memories`
        });
        summarized++;

        for (const mem of memories) {
          await db.delete(memoryConnections)
            .where(or(
              eq(memoryConnections.sourceMemoryId, mem.id),
              eq(memoryConnections.targetMemoryId, mem.id)
            ));
          await db.delete(ulysseMemory)
            .where(and(eq(ulysseMemory.id, mem.id), eq(ulysseMemory.userId, userId)));
          removed++;
        }
      }

      if (summarized > 0) {
        console.log(`${LOG_PREFIX} Summarized ${summarized} categories, removed ${removed} old memories for user ${userId}`);
      }

      return { summarized, removed };
    } catch (error) {
      console.error(`${LOG_PREFIX} summarizeOldMemories error:`, error);
      return { summarized: 0, removed: 0 };
    }
  }

  async buildGraphContextBlock(query: string, userId: number): Promise<string> {
    const contextual = await this.getContextualMemories(query, userId);
    if (contextual.length === 0) return "";

    const graphOnly = contextual.filter(c => c.relationship !== "direct_match");
    if (graphOnly.length === 0) return "";

    let block = "\n## Mémoires connectées (graphe)\n";
    for (const item of graphOnly.slice(0, 5)) {
      block += `- [${item.memory.category}] ${item.memory.key}: ${item.memory.value} (via ${item.relationship}, force: ${(item.strength * 100).toFixed(0)}%)\n`;
    }
    return block;
  }
}

export const memoryGraphService = new MemoryGraphService();
