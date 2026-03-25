/**
 * RAG Service - Recherche Augmentée par Génération
 * Embeddings et recherche vectorielle simplifiée pour docs internes
 */

import OpenAI from "openai";

interface Document {
  id: string;
  content: string;
  metadata: {
    source: string;
    type: "sugu" | "knowledge" | "note" | "conversation" | "file";
    title?: string;
    createdAt: Date;
  };
  embedding?: number[];
}

interface SearchResult {
  document: Document;
  score: number;
  snippet: string;
}

class RagService {
  private documents: Map<string, Document> = new Map();
  private openai: OpenAI | null = null;
  private embeddingModel = "text-embedding-3-small";

  private getOpenAI(): OpenAI {
    if (!this.openai) {
      const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error("OpenAI API key not configured");
      }
      this.openai = new OpenAI({ apiKey });
    }
    return this.openai;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const openai = this.getOpenAI();
      const response = await openai.embeddings.create({
        model: this.embeddingModel,
        input: text.slice(0, 8000)
      });
      return response.data[0].embedding;
    } catch (error) {
      console.error("[RAG] Embedding generation failed:", error);
      return [];
    }
  }

  async addDocument(doc: Omit<Document, "embedding">): Promise<boolean> {
    try {
      const embedding = await this.generateEmbedding(doc.content);
      const fullDoc: Document = { ...doc, embedding };
      this.documents.set(doc.id, fullDoc);
      console.log(`[RAG] Added document: ${doc.id} (${doc.content.length} chars)`);
      return true;
    } catch (error) {
      console.error("[RAG] Failed to add document:", error);
      return false;
    }
  }

  async addDocuments(docs: Omit<Document, "embedding">[]): Promise<number> {
    let added = 0;
    for (const doc of docs) {
      if (await this.addDocument(doc)) {
        added++;
      }
    }
    return added;
  }

  removeDocument(id: string): boolean {
    return this.documents.delete(id);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude > 0 ? dotProduct / magnitude : 0;
  }

  async search(query: string, options: {
    limit?: number;
    type?: Document["metadata"]["type"];
    minScore?: number;
  } = {}): Promise<SearchResult[]> {
    const { limit = 5, type, minScore = 0.5 } = options;

    const queryEmbedding = await this.generateEmbedding(query);
    if (queryEmbedding.length === 0) {
      console.warn("[RAG] Empty query embedding, falling back to keyword search");
      return this.keywordSearch(query, { limit, type });
    }

    const results: SearchResult[] = [];
    
    for (const doc of this.documents.values()) {
      if (type && doc.metadata.type !== type) continue;
      if (!doc.embedding || doc.embedding.length === 0) continue;

      const score = this.cosineSimilarity(queryEmbedding, doc.embedding);
      if (score >= minScore) {
        results.push({
          document: doc,
          score,
          snippet: this.extractSnippet(doc.content, query)
        });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  keywordSearch(query: string, options: {
    limit?: number;
    type?: Document["metadata"]["type"];
  } = {}): SearchResult[] {
    const { limit = 5, type } = options;
    const queryWords = query.toLowerCase().split(/\s+/);
    const results: SearchResult[] = [];

    for (const doc of this.documents.values()) {
      if (type && doc.metadata.type !== type) continue;

      const contentLower = doc.content.toLowerCase();
      let matchCount = 0;
      for (const word of queryWords) {
        if (contentLower.includes(word)) {
          matchCount++;
        }
      }

      if (matchCount > 0) {
        const score = matchCount / queryWords.length;
        results.push({
          document: doc,
          score,
          snippet: this.extractSnippet(doc.content, query)
        });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private extractSnippet(content: string, query: string, maxLength: number = 200): string {
    const lowerContent = content.toLowerCase();
    const queryWords = query.toLowerCase().split(/\s+/);
    
    // Find first occurrence of any query word
    let startIndex = 0;
    for (const word of queryWords) {
      const idx = lowerContent.indexOf(word);
      if (idx >= 0) {
        startIndex = Math.max(0, idx - 50);
        break;
      }
    }

    const snippet = content.slice(startIndex, startIndex + maxLength);
    return (startIndex > 0 ? "..." : "") + snippet + (startIndex + maxLength < content.length ? "..." : "");
  }

  async queryWithContext(query: string, options: {
    limit?: number;
    type?: Document["metadata"]["type"];
    includeRaw?: boolean;
  } = {}): Promise<{
    answer: string;
    sources: SearchResult[];
    context: string;
  }> {
    const { limit = 5, type, includeRaw = false } = options;
    
    const results = await this.search(query, { limit, type, minScore: 0.4 });
    
    if (results.length === 0) {
      return {
        answer: "Aucun document pertinent trouvé.",
        sources: [],
        context: ""
      };
    }

    const context = results
      .map((r, i) => `[Source ${i + 1}: ${r.document.metadata.title || r.document.metadata.source}]\n${r.snippet}`)
      .join("\n\n");

    return {
      answer: `Trouvé ${results.length} document(s) pertinent(s).`,
      sources: results,
      context
    };
  }

  getStats(): {
    totalDocuments: number;
    byType: Record<string, number>;
    totalChars: number;
    withEmbeddings: number;
  } {
    const byType: Record<string, number> = {};
    let totalChars = 0;
    let withEmbeddings = 0;

    for (const doc of this.documents.values()) {
      byType[doc.metadata.type] = (byType[doc.metadata.type] || 0) + 1;
      totalChars += doc.content.length;
      if (doc.embedding && doc.embedding.length > 0) {
        withEmbeddings++;
      }
    }

    return {
      totalDocuments: this.documents.size,
      byType,
      totalChars,
      withEmbeddings
    };
  }

  async indexKnowledgeBase(userId: number): Promise<number> {
    try {
      const { db } = await import("../db");
      const { knowledgeBase } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");

      const items = await db.select().from(knowledgeBase).where(eq(knowledgeBase.userId, userId));

      let indexed = 0;
      for (const item of items) {
        await this.addDocument({
          id: `knowledge-${item.id}`,
          content: `${item.title || ''}\n${item.content}`,
          metadata: {
            source: "knowledge_base",
            type: "knowledge",
            title: item.title || undefined,
            createdAt: item.createdAt || new Date()
          }
        });
        indexed++;
      }

      console.log(`[RAG] Indexed ${indexed} knowledge base items`);
      return indexed;
    } catch (error) {
      console.error("[RAG] Knowledge base indexing failed:", error);
      return 0;
    }
  }

  async indexSuguData(): Promise<number> {
    try {
      const { suguvalService } = await import("./suguvalService");
      const { sugumaillaneService } = await import("./sugumaillaneService");

      const [suguvalCats, sugumaillaneCats] = await Promise.all([
        suguvalService.getAllCategories().catch(() => []),
        sugumaillaneService.getAllCategories().catch(() => [])
      ]);

      let indexed = 0;

      for (const cat of suguvalCats) {
        const items = await suguvalService.getItemsByCategory(cat.id).catch(() => []);
        const content = `Catégorie Suguval: ${cat.name}\nProduits: ${items.map((i: any) => i.name).join(', ')}`;
        
        await this.addDocument({
          id: `sugu-suguval-${cat.id}`,
          content,
          metadata: {
            source: "suguval",
            type: "sugu",
            title: cat.name,
            createdAt: new Date()
          }
        });
        indexed++;
      }

      for (const cat of sugumaillaneCats) {
        const items = await sugumaillaneService.getItemsByCategory(cat.id).catch(() => []);
        const content = `Catégorie Sugumaillane: ${cat.name}\nProduits: ${items.map((i: any) => i.name).join(', ')}`;
        
        await this.addDocument({
          id: `sugu-sugumaillane-${cat.id}`,
          content,
          metadata: {
            source: "sugumaillane",
            type: "sugu",
            title: cat.name,
            createdAt: new Date()
          }
        });
        indexed++;
      }

      console.log(`[RAG] Indexed ${indexed} SUGU categories`);
      return indexed;
    } catch (error) {
      console.error("[RAG] SUGU indexing failed:", error);
      return 0;
    }
  }

  clear(): void {
    this.documents.clear();
    console.log("[RAG] All documents cleared");
  }
}

export const ragService = new RagService();
