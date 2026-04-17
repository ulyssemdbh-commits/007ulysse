import OpenAI from "openai";

const LOG_PREFIX = "[EmbeddingHelper]";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 384;
const MEMORY_CACHE_MAX = 2000;

let _client: OpenAI | null = null;
const memCache = new Map<string, number[]>();
const inFlight = new Map<string, Promise<number[] | null>>();

function getClient(): OpenAI | null {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!apiKey) return null;
  _client = new OpenAI({
    apiKey,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
    timeout: 15000,
  });
  return _client;
}

function cacheKey(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h) ^ text.charCodeAt(i);
  return (h >>> 0).toString(36) + ":" + text.length;
}

export async function generateEmbedding(text: string): Promise<number[] | null> {
  const trimmed = (text || "").slice(0, 4000).trim();
  if (!trimmed) return null;

  const key = cacheKey(trimmed);
  const cached = memCache.get(key);
  if (cached) return cached;

  try {
    const { brainPulse } = await import("./sensory/BrainPulse");
    brainPulse("feature", "embedding", `vectorise "${trimmed.slice(0, 50)}"`, { intensity: 1, throttleMs: 500 });
  } catch { /* best-effort */ }

  // Dedup concurrent identical embedding requests
  const pending = inFlight.get(key);
  if (pending) return pending;

  const ai = getClient();
  if (!ai) return null;

  const promise = (async () => {
    try {
      const res = await ai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: trimmed,
        dimensions: EMBEDDING_DIMENSIONS,
      });
      const emb = res.data[0]?.embedding;
      if (!emb) return null;
      if (memCache.size >= MEMORY_CACHE_MAX) {
        const firstKey = memCache.keys().next().value;
        if (firstKey) memCache.delete(firstKey);
      }
      memCache.set(key, emb);
      return emb;
    } catch (err: any) {
      console.warn(`${LOG_PREFIX} embed failed:`, err?.message || err);
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function getEmbeddingCacheStats(): { size: number; max: number } {
  return { size: memCache.size, max: MEMORY_CACHE_MAX };
}
