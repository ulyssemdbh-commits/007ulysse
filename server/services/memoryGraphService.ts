import { db } from "../db";
import { memoryConnections, ulysseMemory, MemoryConnection } from "@shared/schema";
import { eq, and, or, desc, sql, lt, inArray } from "drizzle-orm";
import { generateEmbedding, cosineSimilarity } from "./embeddingHelper";

const LOG_PREFIX = "[MemoryGraph]";

interface UsageEntry {
  memoryIds: number[];
  connectionIds: number[];
  timestamp: number;
}

interface ReinforcementStats {
  totalSignals: number;
  positiveSignals: number;
  negativeSignals: number;
  totalStrengthDelta: number;
  totalConfidenceDelta: number;
}

class MemoryGraphService {
  // Tunables (mutable for meta-learning)
  private embeddingThreshold = 0.72;
  private hebbianLearningRate = 0.08;
  private maxCandidates = 100;
  private usageBufferSize = 5;

  // Per-user usage buffer (FIFO of last N injections)
  private usageBuffer = new Map<number, UsageEntry[]>();

  private stats: ReinforcementStats = {
    totalSignals: 0,
    positiveSignals: 0,
    negativeSignals: 0,
    totalStrengthDelta: 0,
    totalConfidenceDelta: 0,
  };

  // ============= Tunable accessors (used by metaLearningService) =============
  setEmbeddingThreshold(v: number): void {
    this.embeddingThreshold = Math.max(0.4, Math.min(0.95, v));
  }
  getEmbeddingThreshold(): number { return this.embeddingThreshold; }

  setHebbianLearningRate(v: number): void {
    this.hebbianLearningRate = Math.max(0.005, Math.min(0.3, v));
  }
  getHebbianLearningRate(): number { return this.hebbianLearningRate; }

  getReinforcementStats(): ReinforcementStats { return { ...this.stats }; }

  // ============= Embedding helper =============
  private async getOrComputeEmbedding(
    mem: typeof ulysseMemory.$inferSelect
  ): Promise<number[] | null> {
    const meta = (mem.metadata || {}) as Record<string, any>;
    if (Array.isArray(meta.embedding) && meta.embedding.length > 0) {
      return meta.embedding as number[];
    }
    const text = `${mem.key}: ${mem.value}`;
    const emb = await generateEmbedding(text);
    if (!emb) return null;
    try {
      await db.update(ulysseMemory)
        .set({ metadata: { ...meta, embedding: emb, embeddedAt: Date.now() } })
        .where(eq(ulysseMemory.id, mem.id));
    } catch (e) {
      // best-effort cache; don't fail
    }
    return emb;
  }

  // ============= Connection management =============
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
        const newStrength = Math.min(1, Math.max(existing[0].strength, strength));
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

  // ============= Auto-connect (now embedding-first) =============
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
        .limit(this.maxCandidates);

      if (candidates.length === 0) return 0;

      const memEmbedding = await this.getOrComputeEmbedding(memory);

      let connected = 0;
      const memWords = new Set(
        (memory.key + " " + memory.value).toLowerCase().split(/\s+/).filter(w => w.length > 3)
      );

      for (const candidate of candidates) {
        // 1. Embedding-based semantic link (preferred)
        if (memEmbedding) {
          const candEmbedding = await this.getOrComputeEmbedding(candidate);
          if (candEmbedding) {
            const sim = cosineSimilarity(memEmbedding, candEmbedding);
            if (sim >= this.embeddingThreshold) {
              const strength = Math.min(0.95, sim);
              await this.connectMemories(memoryId, candidate.id, "semantic_similarity", strength);
              connected++;
              continue;
            }
          }
        }

        // 2. Same-category fallback
        if (candidate.category === memory.category) {
          await this.connectMemories(memoryId, candidate.id, "same_category", 0.3);
          connected++;
          continue;
        }

        // 3. Keyword overlap fallback (when embeddings unavailable or below threshold)
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
        console.log(`${LOG_PREFIX} Auto-connected memory ${memoryId} → ${connected} others (embeddings: ${memEmbedding ? "on" : "off"})`);
      }
      return connected;
    } catch (error) {
      console.error(`${LOG_PREFIX} autoConnect error:`, error);
      return 0;
    }
  }

  // ============= Graph traversal =============
  async getRelatedMemories(memoryId: number, maxDepth: number = 2): Promise<{
    memory: typeof ulysseMemory.$inferSelect;
    relationship: string;
    strength: number;
    depth: number;
    connectionId: number;
  }[]> {
    try {
      const visited = new Set<number>([memoryId]);
      const results: {
        memory: typeof ulysseMemory.$inferSelect;
        relationship: string;
        strength: number;
        depth: number;
        connectionId: number;
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
              depth,
              connectionId: conn.id
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

  // ============= Contextual lookup (now embedding-aware + tracks usage) =============
  async getContextualMemories(query: string, userId: number): Promise<{
    memory: typeof ulysseMemory.$inferSelect;
    relationship: string;
    strength: number;
    connectionId?: number;
  }[]> {
    try {
      const queryEmbedding = await generateEmbedding(query);

      const allRelated = new Map<number, {
        memory: typeof ulysseMemory.$inferSelect;
        relationship: string;
        strength: number;
        connectionId?: number;
      }>();

      // 1. Semantic match via embeddings
      let matchingMemories: typeof ulysseMemory.$inferSelect[] = [];
      if (queryEmbedding) {
        const userMems = await db.select().from(ulysseMemory)
          .where(eq(ulysseMemory.userId, userId))
          .orderBy(desc(ulysseMemory.confidence))
          .limit(60);

        const scored: { mem: typeof ulysseMemory.$inferSelect; sim: number }[] = [];
        for (const m of userMems) {
          const emb = await this.getOrComputeEmbedding(m);
          if (!emb) continue;
          const sim = cosineSimilarity(queryEmbedding, emb);
          if (sim >= this.embeddingThreshold * 0.85) scored.push({ mem: m, sim });
        }
        scored.sort((a, b) => b.sim - a.sim);
        matchingMemories = scored.slice(0, 5).map(s => s.mem);
        for (const s of scored.slice(0, 5)) {
          allRelated.set(s.mem.id, {
            memory: s.mem,
            relationship: "semantic_match",
            strength: s.sim,
          });
        }
      }

      // 2. Keyword fallback if embedding unavailable / no hit
      if (matchingMemories.length === 0) {
        const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        if (queryWords.length === 0) return [];
        const searchConditions = queryWords.map(word => {
          const pattern = `%${word}%`;
          return or(
            sql`LOWER(${ulysseMemory.key}) LIKE ${pattern}`,
            sql`LOWER(${ulysseMemory.value}) LIKE ${pattern}`
          );
        });
        matchingMemories = await db.select().from(ulysseMemory)
          .where(and(eq(ulysseMemory.userId, userId), or(...searchConditions.filter(Boolean))!))
          .orderBy(desc(ulysseMemory.confidence))
          .limit(5);
        for (const mem of matchingMemories) {
          allRelated.set(mem.id, { memory: mem, relationship: "direct_match", strength: 1.0 });
        }
      }

      // 3. Walk the graph 1 hop from each match
      for (const mem of matchingMemories) {
        const related = await this.getRelatedMemories(mem.id, 1);
        for (const r of related) {
          if (!allRelated.has(r.memory.id)) {
            allRelated.set(r.memory.id, {
              memory: r.memory,
              relationship: r.relationship,
              strength: r.strength * 0.7,
              connectionId: r.connectionId,
            });
          }
        }
      }

      const result = Array.from(allRelated.values())
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 8);

      // 4. Track usage for later reinforcement
      this.trackUsage(userId, {
        memoryIds: result.map(r => r.memory.id),
        connectionIds: result.map(r => r.connectionId).filter((x): x is number => typeof x === "number"),
        timestamp: Date.now(),
      });

      return result;
    } catch (error) {
      console.error(`${LOG_PREFIX} getContextualMemories error:`, error);
      return [];
    }
  }

  // ============= Hebbian reinforcement =============
  private trackUsage(userId: number, entry: UsageEntry): void {
    const arr = this.usageBuffer.get(userId) || [];
    arr.push(entry);
    while (arr.length > this.usageBufferSize) arr.shift();
    this.usageBuffer.set(userId, arr);
  }

  /**
   * Apply a reinforcement signal to the most recent context served to a user.
   * @param userId target user
   * @param signal in [-1, +1]; positive = "this context was useful", negative = "wrong/misleading"
   * @param windowMs only consider usage entries newer than this (default 5 min)
   */
  async reinforce(userId: number, signal: number, windowMs: number = 5 * 60 * 1000): Promise<{
    connectionsUpdated: number;
    memoriesUpdated: number;
    avgStrengthDelta: number;
  }> {
    const arr = this.usageBuffer.get(userId);
    if (!arr || arr.length === 0) {
      return { connectionsUpdated: 0, memoriesUpdated: 0, avgStrengthDelta: 0 };
    }

    const now = Date.now();
    const sigClamped = Math.max(-1, Math.min(1, signal));
    const lr = this.hebbianLearningRate;

    const allMemIds = new Set<number>();
    const allConnIds = new Set<number>();
    for (const entry of arr) {
      if (now - entry.timestamp > windowMs) continue;
      entry.memoryIds.forEach(id => allMemIds.add(id));
      entry.connectionIds.forEach(id => allConnIds.add(id));
    }

    if (allMemIds.size === 0 && allConnIds.size === 0) {
      return { connectionsUpdated: 0, memoriesUpdated: 0, avgStrengthDelta: 0 };
    }

    let connUpdated = 0;
    let strengthDeltaSum = 0;

    // Update connection strengths (Hebbian-like, bounded [0, 1])
    if (allConnIds.size > 0) {
      const conns = await db.select().from(memoryConnections)
        .where(inArray(memoryConnections.id, Array.from(allConnIds)));
      for (const c of conns) {
        const s = c.strength;
        // For positive signal: pull toward 1 proportional to (1 - s)
        // For negative signal: pull toward 0 proportional to s
        const delta = sigClamped >= 0
          ? lr * sigClamped * (1 - s)
          : lr * sigClamped * s;
        const newStrength = Math.max(0, Math.min(1, s + delta));
        if (Math.abs(newStrength - s) < 0.001) continue;
        await db.update(memoryConnections)
          .set({ strength: newStrength })
          .where(eq(memoryConnections.id, c.id));
        connUpdated++;
        strengthDeltaSum += (newStrength - s);
      }
    }

    // Update node confidences (clamped 0-100)
    let memUpdated = 0;
    let confDeltaSum = 0;
    if (allMemIds.size > 0) {
      const mems = await db.select().from(ulysseMemory)
        .where(inArray(ulysseMemory.id, Array.from(allMemIds)));
      for (const m of mems) {
        const c = m.confidence;
        const cDelta = sigClamped >= 0
          ? lr * 100 * sigClamped * (1 - c / 100)
          : lr * 100 * sigClamped * (c / 100);
        const newConf = Math.max(0, Math.min(100, Math.round(c + cDelta)));
        if (newConf === c) continue;
        await db.update(ulysseMemory)
          .set({ confidence: newConf, updatedAt: new Date() })
          .where(eq(ulysseMemory.id, m.id));
        memUpdated++;
        confDeltaSum += (newConf - c);
      }
    }

    this.stats.totalSignals++;
    if (sigClamped > 0) this.stats.positiveSignals++;
    else if (sigClamped < 0) this.stats.negativeSignals++;
    this.stats.totalStrengthDelta += strengthDeltaSum;
    this.stats.totalConfidenceDelta += confDeltaSum;

    if (connUpdated + memUpdated > 0) {
      console.log(`${LOG_PREFIX} Reinforce[user=${userId}] sig=${sigClamped.toFixed(2)} → ${connUpdated} conns Δ${strengthDeltaSum.toFixed(3)}, ${memUpdated} mems Δ${confDeltaSum.toFixed(1)}`);
    }

    // Clear consumed buffer to avoid double-reinforcement
    this.usageBuffer.delete(userId);

    return {
      connectionsUpdated: connUpdated,
      memoriesUpdated: memUpdated,
      avgStrengthDelta: connUpdated > 0 ? strengthDeltaSum / connUpdated : 0,
    };
  }

  // ============= Existing methods (kept) =============
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

    const graphOnly = contextual.filter(c => c.relationship !== "direct_match" && c.relationship !== "semantic_match");
    const semanticOnly = contextual.filter(c => c.relationship === "semantic_match");

    let block = "";
    if (semanticOnly.length > 0) {
      block += "\n## Mémoires similaires (sémantique)\n";
      for (const item of semanticOnly.slice(0, 5)) {
        block += `- [${item.memory.category}] ${item.memory.key}: ${item.memory.value} (sim: ${(item.strength * 100).toFixed(0)}%)\n`;
      }
    }
    if (graphOnly.length > 0) {
      block += "\n## Mémoires connectées (graphe)\n";
      for (const item of graphOnly.slice(0, 5)) {
        block += `- [${item.memory.category}] ${item.memory.key}: ${item.memory.value} (via ${item.relationship}, force: ${(item.strength * 100).toFixed(0)}%)\n`;
      }
    }
    return block;
  }
}

export const memoryGraphService = new MemoryGraphService();
