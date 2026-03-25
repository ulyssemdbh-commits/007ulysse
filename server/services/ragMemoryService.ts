/**
 * RAG Memory Service — Long-term semantic memory for Ulysse
 * Uses OpenAI embeddings + PostgreSQL for vector-like similarity search.
 * Enables "remember anything" pattern — Ulysse can recall past conversations,
 * learned facts, research results by semantic meaning.
 */

import { db } from '../db';
import { eq, desc, and, sql, gte } from 'drizzle-orm';
import * as schema from '@shared/schema';
import OpenAI from 'openai';
import { redisGet, redisSet } from './redisService';

// ============================================================================
// Types
// ============================================================================

export interface MemoryEntry {
    id: number;
    userId: number;
    content: string;
    category: 'conversation' | 'fact' | 'research' | 'preference' | 'decision' | 'insight';
    source: string;
    embedding?: number[];
    relevanceScore?: number;
    createdAt: Date;
}

export interface MemorySearchResult {
    entries: MemoryEntry[];
    query: string;
    totalFound: number;
    searchTime: number;
}

export interface MemoryStats {
    totalEntries: number;
    byCategory: Record<string, number>;
    oldestEntry: string;
    newestEntry: string;
}

// ============================================================================
// Configuration
// ============================================================================

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 256; // Smaller = faster, still accurate
const MAX_MEMORY_RESULTS = 10;
const MEMORY_RELEVANCE_THRESHOLD = 0.3;
const EMBEDDING_CACHE_TTL = 3600; // 1 hour

let openai: OpenAI | null = null;

function getOpenAI(): OpenAI | null {
    if (!openai) {
        const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
        if (apiKey) {
            openai = new OpenAI({ apiKey });
        }
    }
    return openai;
}

// ============================================================================
// Embedding Functions
// ============================================================================

/**
 * Generate embedding vector for text
 */
async function generateEmbedding(text: string): Promise<number[] | null> {
    const ai = getOpenAI();
    if (!ai) return null;

    // Check cache
    const cacheKey = `emb:${Buffer.from(text.slice(0, 200)).toString('base64').slice(0, 60)}`;
    const cached = await redisGet<number[]>(cacheKey);
    if (cached) return cached;

    try {
        // Truncate to ~8000 tokens (~32000 chars)
        const truncated = text.slice(0, 32000);

        const response = await ai.embeddings.create({
            model: EMBEDDING_MODEL,
            input: truncated,
            dimensions: EMBEDDING_DIMENSIONS,
        });

        const embedding = response.data[0]?.embedding;
        if (embedding) {
            await redisSet(cacheKey, embedding, EMBEDDING_CACHE_TTL);
        }
        return embedding || null;
    } catch (error) {
        console.error('[RAG] Embedding generation failed:', error);
        return null;
    }
}

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
}

// ============================================================================
// Memory Operations
// ============================================================================

/**
 * Store a memory entry with optional embedding
 */
export async function storeMemory(
    userId: number,
    content: string,
    category: MemoryEntry['category'],
    source: string,
    metadata?: Record<string, any>
): Promise<number | null> {
    try {
        // Generate embedding
        const embedding = await generateEmbedding(content);

        // Store in ulysse_memory table
        const [result] = await db.insert(schema.ulysseMemory).values({
            userId,
            category,
            key: `rag_${category}_${Date.now()}`,
            value: content,
            confidence: 70,
            source,
            metadata: {
                ...metadata,
                embedding: embedding ? true : false,
                embeddingModel: EMBEDDING_MODEL,
                dimensions: EMBEDDING_DIMENSIONS,
            },
        }).returning({ id: schema.ulysseMemory.id });

        // Store embedding in Redis for fast retrieval
        if (embedding && result) {
            await redisSet(`emb:entry:${result.id}`, embedding, 86400 * 7); // 7 days
        }

        console.log(`[RAG] Stored memory #${result?.id} (${category}) for user ${userId}`);
        return result?.id || null;
    } catch (error) {
        console.error('[RAG] Store memory failed:', error);
        return null;
    }
}

/**
 * Search memories by semantic similarity
 */
export async function searchMemory(
    userId: number,
    query: string,
    options: {
        category?: MemoryEntry['category'];
        maxResults?: number;
        minRelevance?: number;
        daysBack?: number;
    } = {}
): Promise<MemorySearchResult> {
    const startTime = Date.now();
    const maxResults = options.maxResults || MAX_MEMORY_RESULTS;
    const minRelevance = options.minRelevance || MEMORY_RELEVANCE_THRESHOLD;

    try {
        // Generate query embedding
        const queryEmbedding = await generateEmbedding(query);

        // Fetch candidate memories from DB
        let conditions = [eq(schema.ulysseMemory.userId, userId)];

        if (options.category) {
            conditions.push(eq(schema.ulysseMemory.category, options.category));
        }

        if (options.daysBack) {
            const since = new Date(Date.now() - options.daysBack * 86400000);
            conditions.push(gte(schema.ulysseMemory.createdAt, since));
        }

        const candidates = await db.select()
            .from(schema.ulysseMemory)
            .where(and(...conditions))
            .orderBy(desc(schema.ulysseMemory.createdAt))
            .limit(500); // Get recent 500 for scoring

        // Score by relevance
        const scored: MemoryEntry[] = [];

        for (const mem of candidates) {
            let relevanceScore = 0;

            if (queryEmbedding) {
                // Try to get stored embedding from Redis
                const storedEmbedding = await redisGet<number[]>(`emb:entry:${mem.id}`);

                if (storedEmbedding) {
                    relevanceScore = cosineSimilarity(queryEmbedding, storedEmbedding);
                } else {
                    // Fallback: keyword matching
                    relevanceScore = keywordSimilarity(query, mem.value);
                }
            } else {
                // No embeddings available — use keyword matching
                relevanceScore = keywordSimilarity(query, mem.value);
            }

            if (relevanceScore >= minRelevance) {
                scored.push({
                    id: mem.id,
                    userId: mem.userId,
                    content: mem.value,
                    category: mem.category as MemoryEntry['category'],
                    source: mem.source || '',
                    relevanceScore: Math.round(relevanceScore * 1000) / 1000,
                    createdAt: mem.createdAt || new Date(),
                });
            }
        }

        // Sort by relevance
        scored.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
        const results = scored.slice(0, maxResults);

        return {
            entries: results,
            query,
            totalFound: scored.length,
            searchTime: Date.now() - startTime,
        };
    } catch (error) {
        console.error('[RAG] Search failed:', error);
        return {
            entries: [],
            query,
            totalFound: 0,
            searchTime: Date.now() - startTime,
        };
    }
}

/**
 * Simple keyword-based similarity (fallback when no embeddings)
 */
function keywordSimilarity(query: string, text: string): number {
    const queryWords = new Set(
        query.toLowerCase().split(/\W+/).filter(w => w.length > 2)
    );
    const textWords = new Set(
        text.toLowerCase().split(/\W+/).filter(w => w.length > 2)
    );

    if (queryWords.size === 0 || textWords.size === 0) return 0;

    let matches = 0;
    for (const word of queryWords) {
        if (textWords.has(word)) matches++;
    }

    // Jaccard-like coefficient
    return matches / Math.max(queryWords.size, 1);
}

/**
 * Auto-summarize and store conversation as memory
 */
export async function memorizeConversation(
    userId: number,
    conversationId: number,
    messages: Array<{ role: string; content: string }>
): Promise<void> {
    if (messages.length < 3) return; // Too short to memorize

    const ai = getOpenAI();
    if (!ai) return;

    try {
        // Extract key points from conversation
        const conversationText = messages
            .map(m => `${m.role}: ${m.content}`)
            .join('\n')
            .slice(0, 10000);

        const response = await ai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: 'Extract 3-5 key facts, decisions, or insights from this conversation. Output each as a separate line. Be concise. Only include genuinely important or memorable information.',
                },
                { role: 'user', content: conversationText },
            ],
            max_tokens: 500,
            temperature: 0.3,
        });

        const insights = response.choices[0]?.message?.content;
        if (!insights) return;

        // Store each insight as a separate memory
        const lines = insights.split('\n').filter(l => l.trim().length > 10);

        for (const line of lines.slice(0, 5)) {
            await storeMemory(
                userId,
                line.replace(/^[-•*]\s*/, '').trim(),
                'insight',
                `conversation:${conversationId}`,
                { conversationId }
            );
        }

        console.log(`[RAG] Memorized ${lines.length} insights from conversation ${conversationId}`);
    } catch (error) {
        console.error('[RAG] Memorize conversation failed:', error);
    }
}

/**
 * Build RAG context for a query — returns relevant memories formatted for AI prompt
 */
export async function buildRAGContext(
    userId: number,
    query: string,
    maxTokens: number = 2000
): Promise<string> {
    const results = await searchMemory(userId, query, {
        maxResults: 8,
        minRelevance: 0.25,
        daysBack: 90,
    });

    if (results.entries.length === 0) return '';

    let context = '## Relevant Memories\n';
    let tokenEstimate = 0;

    for (const entry of results.entries) {
        const line = `- [${entry.category}] (${entry.relevanceScore?.toFixed(2)} relevance) ${entry.content}\n`;
        const lineTokens = Math.ceil(line.length / 4);

        if (tokenEstimate + lineTokens > maxTokens) break;

        context += line;
        tokenEstimate += lineTokens;
    }

    return context;
}

/**
 * Get memory statistics for a user
 */
export async function getMemoryStats(userId: number): Promise<MemoryStats> {
    try {
        const entries = await db.select({
            category: schema.ulysseMemory.category,
            count: sql<number>`count(*)`,
            oldest: sql<Date>`min(${schema.ulysseMemory.createdAt})`,
            newest: sql<Date>`max(${schema.ulysseMemory.createdAt})`,
        })
            .from(schema.ulysseMemory)
            .where(eq(schema.ulysseMemory.userId, userId))
            .groupBy(schema.ulysseMemory.category);

        const byCategory: Record<string, number> = {};
        let totalEntries = 0;
        let oldest = new Date().toISOString();
        let newest = new Date(0).toISOString();

        for (const entry of entries) {
            byCategory[entry.category] = Number(entry.count);
            totalEntries += Number(entry.count);
            if (entry.oldest && entry.oldest.toISOString() < oldest) oldest = entry.oldest.toISOString();
            if (entry.newest && entry.newest.toISOString() > newest) newest = entry.newest.toISOString();
        }

        return { totalEntries, byCategory, oldestEntry: oldest, newestEntry: newest };
    } catch {
        return { totalEntries: 0, byCategory: {}, oldestEntry: '', newestEntry: '' };
    }
}
