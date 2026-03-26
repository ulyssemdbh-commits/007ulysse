import { db } from "../../db";
import { eq, sql, and, desc, gte } from "drizzle-orm";
import { knowledgeBase } from "@shared/schema";

interface LearnedResponse {
  id: number;
  inputPattern: string;
  response: string;
  context: {
    persona?: string;
    category?: string;
  };
  quality: number;
  usageCount: number;
  successRate: number;
  createdAt: Date;
  lastUsedAt: Date;
}

interface SimilarityMatch {
  response: string;
  confidence: number;
  sourceId: string;
}

interface ConversationSession {
  userId: number;
  messages: { role: 'user' | 'assistant'; content: string; timestamp: number }[];
  startedAt: number;
  lastActivityAt: number;
  domain?: string;
}

export class ResponseLearningService {
  private learningBuffer: Map<string, { 
    input: string; 
    output: string; 
    context: any;
    timestamp: number;
  }[]> = new Map();
  
  private vectorCache: Map<string, number[]> = new Map();
  private idfCache: Map<string, number> = new Map();
  private documentCount: number = 0;
  private sessions: Map<string, ConversationSession> = new Map();

  private readonly SIMILARITY_THRESHOLD = 0.72;
  private readonly BUFFER_SIZE = 100;
  private readonly LEARNING_BATCH_SIZE = 10;
  private readonly VECTOR_DIM = 512;
  private readonly SESSION_TIMEOUT = 30 * 60 * 1000;
  private readonly SESSION_SUMMARY_MIN_MESSAGES = 4;

  constructor() {
    console.log('[ResponseLearning] V2 Service initialized — TF-IDF vectorization + session memory');
    setInterval(() => this.consolidateSessions(), 10 * 60 * 1000);
  }

  async learn(input: string, output: string, context: any): Promise<void> {
    const userId = context.userId;
    const bufferKey = `user:${userId}`;
    
    if (!this.learningBuffer.has(bufferKey)) {
      this.learningBuffer.set(bufferKey, []);
    }
    
    const buffer = this.learningBuffer.get(bufferKey)!;
    buffer.push({
      input: input.toLowerCase().trim(),
      output,
      context: {
        persona: context.persona,
        hasFamilyAccess: context.hasFamilyAccess
      },
      timestamp: Date.now()
    });

    this.trackSession(userId, input, output, context.domain);

    if (buffer.length >= this.LEARNING_BATCH_SIZE) {
      await this.processBatch(userId, buffer);
      this.learningBuffer.set(bufferKey, []);
    }
  }

  async findSimilar(input: string, context: any): Promise<SimilarityMatch | null> {
    const normalizedInput = input.toLowerCase().trim();
    const inputVector = this.textToVectorTFIDF(normalizedInput);
    
    const bufferKey = `user:${context.userId}`;
    const buffer = this.learningBuffer.get(bufferKey) || [];
    
    let bestMatch: SimilarityMatch | null = null;
    let bestScore = 0;

    for (const entry of buffer) {
      const entryVector = this.textToVectorTFIDF(entry.input);
      const similarity = this.cosineSimilarity(inputVector, entryVector);
      
      const recencyBoost = Math.max(0, 1 - (Date.now() - entry.timestamp) / (24 * 60 * 60 * 1000)) * 0.05;
      const adjustedSimilarity = similarity + recencyBoost;
      
      if (adjustedSimilarity >= this.SIMILARITY_THRESHOLD && adjustedSimilarity > bestScore) {
        bestScore = adjustedSimilarity;
        bestMatch = {
          response: entry.output,
          confidence: adjustedSimilarity,
          sourceId: `buffer:${entry.timestamp}`
        };
      }
    }

    if (bestMatch) return bestMatch;

    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const learned = await db.select()
        .from(knowledgeBase)
        .where(and(
          eq(knowledgeBase.userId, context.userId),
          eq(knowledgeBase.type, 'learned_response')
        ))
        .orderBy(desc(knowledgeBase.accessCount))
        .limit(80);
      
      for (const entry of learned) {
        if (entry.summary) {
          const entryVector = this.textToVectorTFIDF(entry.summary);
          const similarity = this.cosineSimilarity(inputVector, entryVector);
          
          const accessBoost = Math.min(0.05, (entry.accessCount || 0) * 0.005);
          const recencyDecay = entry.lastAccessedAt 
            ? Math.max(0, 1 - (Date.now() - new Date(entry.lastAccessedAt).getTime()) / (30 * 24 * 60 * 60 * 1000)) * 0.03
            : 0;
          const adjustedSimilarity = similarity + accessBoost + recencyDecay;
          
          if (adjustedSimilarity >= this.SIMILARITY_THRESHOLD && adjustedSimilarity > bestScore) {
            bestScore = adjustedSimilarity;
            bestMatch = {
              response: entry.content || '',
              confidence: adjustedSimilarity,
              sourceId: `kb:${entry.id}`
            };

            db.update(knowledgeBase)
              .set({ 
                accessCount: sql`${knowledgeBase.accessCount} + 1`,
                lastAccessedAt: new Date()
              })
              .where(eq(knowledgeBase.id, entry.id))
              .catch(() => {});
          }
        }
      }
    } catch (error) {
      console.error('[ResponseLearning] Error searching learned responses:', error);
    }
    
    return bestMatch;
  }

  private trackSession(userId: number, input: string, output: string, domain?: string): void {
    const sessionKey = `session:${userId}`;
    const now = Date.now();

    let session = this.sessions.get(sessionKey);
    
    if (!session || (now - session.lastActivityAt) > this.SESSION_TIMEOUT) {
      if (session && session.messages.length >= this.SESSION_SUMMARY_MIN_MESSAGES) {
        this.saveSessionSummary(session).catch(e => 
          console.error('[ResponseLearning] Session summary save error:', e)
        );
      }
      
      session = {
        userId,
        messages: [],
        startedAt: now,
        lastActivityAt: now,
        domain
      };
      this.sessions.set(sessionKey, session);
    }

    session.messages.push(
      { role: 'user', content: input.substring(0, 500), timestamp: now },
      { role: 'assistant', content: output.substring(0, 500), timestamp: now }
    );
    session.lastActivityAt = now;
    if (domain) session.domain = domain;

    if (session.messages.length > 40) {
      session.messages = session.messages.slice(-30);
    }
  }

  private async saveSessionSummary(session: ConversationSession): Promise<void> {
    if (session.messages.length < this.SESSION_SUMMARY_MIN_MESSAGES) return;

    const userMessages = session.messages.filter(m => m.role === 'user').map(m => m.content);
    const topics = this.extractTopics(userMessages);
    const duration = session.lastActivityAt - session.startedAt;
    
    const summaryContent = [
      `Session ${session.domain || 'general'} — ${new Date(session.startedAt).toLocaleString('fr-FR')}`,
      `Durée: ${Math.round(duration / 60000)}min, ${session.messages.length} messages`,
      `Sujets: ${topics.join(', ')}`,
      `Dernières questions: ${userMessages.slice(-3).join(' | ')}`
    ].join('\n');

    try {
      await db.insert(knowledgeBase).values({
        userId: session.userId,
        title: `Session: ${topics.slice(0, 3).join(', ')}`,
        content: summaryContent,
        summary: userMessages.join(' ').substring(0, 300),
        type: 'session_summary',
        category: session.domain || 'general',
        importance: Math.min(10, Math.ceil(session.messages.length / 4)),
        confidence: 0.9,
        sourceType: 'session_consolidation',
        metadata: {
          messageCount: session.messages.length,
          duration,
          topics,
          domain: session.domain
        }
      }).onConflictDoNothing();
      
      console.log(`[ResponseLearning] Session summary saved: ${topics.slice(0, 3).join(', ')} (${session.messages.length} msgs)`);
    } catch (error) {
      console.error('[ResponseLearning] Error saving session summary:', error);
    }
  }

  private extractTopics(messages: string[]): string[] {
    const stopWords = new Set([
      'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'et', 'ou', 'mais', 'donc',
      'car', 'ni', 'que', 'qui', 'quoi', 'dont', 'où', 'est', 'sont', 'a', 'ont',
      'pour', 'avec', 'dans', 'sur', 'par', 'en', 'au', 'aux', 'ce', 'ces', 'mon',
      'ton', 'son', 'ma', 'ta', 'sa', 'mes', 'tes', 'ses', 'nous', 'vous', 'ils',
      'elles', 'je', 'tu', 'il', 'elle', 'on', 'the', 'is', 'are', 'was', 'were',
      'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'can', 'could', 'may', 'might', 'shall', 'should', 'not', 'and', 'but',
      'or', 'if', 'then', 'else', 'when', 'how', 'what', 'which', 'who', 'this',
      'that', 'these', 'those', 'from', 'to', 'at', 'by', 'for', 'with', 'about',
      'me', 'moi', 'toi', 'lui', 'ça', 'cela', 'ceci', 'tout', 'tous', 'pas',
      'plus', 'moins', 'très', 'bien', 'aussi', 'comme', 'fait', 'faire', 'fais',
      'dit', 'dire', 'dis', 'peux', 'peut', 'veux', 'veut', 'donne', 'donner',
    ]);

    const wordFreq = new Map<string, number>();
    const bigramFreq = new Map<string, number>();

    for (const msg of messages) {
      const words = msg.toLowerCase()
        .replace(/[^\wàâäéèêëïîôùûüÿçœæ\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w));

      for (const w of words) {
        wordFreq.set(w, (wordFreq.get(w) || 0) + 1);
      }
      for (let i = 0; i < words.length - 1; i++) {
        const bigram = `${words[i]} ${words[i + 1]}`;
        bigramFreq.set(bigram, (bigramFreq.get(bigram) || 0) + 1);
      }
    }

    const topBigrams = [...bigramFreq.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([bg]) => bg);

    const topWords = [...wordFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([w]) => w);

    return [...topBigrams, ...topWords].slice(0, 6);
  }

  private async consolidateSessions(): Promise<void> {
    const now = Date.now();
    const expired: string[] = [];

    for (const [key, session] of this.sessions) {
      if ((now - session.lastActivityAt) > this.SESSION_TIMEOUT) {
        if (session.messages.length >= this.SESSION_SUMMARY_MIN_MESSAGES) {
          await this.saveSessionSummary(session).catch(() => {});
        }
        expired.push(key);
      }
    }

    for (const key of expired) {
      this.sessions.delete(key);
    }

    if (expired.length > 0) {
      console.log(`[ResponseLearning] Consolidated ${expired.length} expired sessions`);
    }
  }

  private async processBatch(userId: number, buffer: typeof this.learningBuffer extends Map<string, infer V> ? V : never): Promise<void> {
    console.log(`[ResponseLearning] Processing batch of ${buffer.length} entries for user ${userId}`);
    
    const grouped = new Map<string, typeof buffer>();
    for (const entry of buffer) {
      const key = this.extractPatternKey(entry.input);
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(entry);
    }

    for (const [patternKey, entries] of grouped) {
      if (patternKey.length < 3) continue;
      const representative = entries[entries.length - 1];
      const importance = Math.min(10, 4 + entries.length);
      const confidence = Math.min(0.95, 0.65 + entries.length * 0.05);
      
      try {
        await db.insert(knowledgeBase).values({
          userId,
          title: `Learned: ${patternKey.substring(0, 50)}`,
          content: representative.output,
          summary: representative.input,
          type: 'learned_response',
          category: 'response_learning',
          importance,
          confidence,
          sourceType: 'learning',
          metadata: {
            patternKey,
            learnedFrom: entries.length,
            context: representative.context,
            learnedAt: new Date().toISOString()
          }
        }).onConflictDoNothing();
        
        console.log(`[ResponseLearning] Learned pattern: ${patternKey} (from ${entries.length} occurrences)`);
      } catch (error) {
        console.error('[ResponseLearning] Error saving learned response:', error);
      }
    }

    this.documentCount += buffer.length;
    this.updateIDF(buffer.map(e => e.input));
  }

  private extractPatternKey(input: string): string {
    const stopWords = new Set([
      'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'et', 'ou', 'mais',
      'donc', 'car', 'ni', 'que', 'qui', 'quoi', 'dont', 'où', 'est', 'sont',
      'a', 'ont', 'pour', 'avec', 'dans', 'sur', 'par', 'en', 'au', 'aux',
      'me', 'te', 'se', 'ce', 'mon', 'ton', 'son', 'the', 'is', 'are', 'and'
    ]);
    
    const words = input.toLowerCase()
      .replace(/[^\wàâäéèêëïîôùûüÿçœæ\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));
    
    const scored = words.map(w => ({
      word: w,
      score: (this.idfCache.get(w) || 1) * (w.length > 5 ? 1.3 : 1)
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 5).map(s => s.word).sort().join('_');
  }

  private textToVectorTFIDF(text: string): number[] {
    if (this.vectorCache.has(text)) {
      return this.vectorCache.get(text)!;
    }

    const words = text.toLowerCase()
      .replace(/[^\wàâäéèêëïîôùûüÿçœæ\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 1);
    
    const vector = new Array(this.VECTOR_DIM).fill(0);
    const totalWords = words.length || 1;

    const tf = new Map<string, number>();
    for (const w of words) {
      tf.set(w, (tf.get(w) || 0) + 1);
    }

    for (const [word, count] of tf) {
      const termFreq = count / totalWords;
      const idf = this.idfCache.get(word) || Math.log(100);
      const tfidf = termFreq * idf;

      const h1 = this.hashWord(word, 0) % this.VECTOR_DIM;
      const h2 = this.hashWord(word, 1) % this.VECTOR_DIM;
      const h3 = this.hashWord(word, 2) % this.VECTOR_DIM;
      vector[h1] += tfidf;
      vector[h2] += tfidf * 0.7;
      vector[h3] += tfidf * 0.5;
    }

    for (let i = 0; i < words.length - 1; i++) {
      const bigram = `${words[i]}_${words[i + 1]}`;
      const bigramHash = this.hashWord(bigram, 3) % this.VECTOR_DIM;
      const idf = this.idfCache.get(bigram) || Math.log(50);
      vector[bigramHash] += (1 / totalWords) * idf * 0.6;
    }

    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (magnitude > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= magnitude;
      }
    }

    this.vectorCache.set(text, vector);
    if (this.vectorCache.size > 2000) {
      const keys = [...this.vectorCache.keys()];
      for (let i = 0; i < 500; i++) {
        this.vectorCache.delete(keys[i]);
      }
    }
    
    return vector;
  }

  private hashWord(word: string, seed: number): number {
    let hash = seed * 2654435761;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) + hash + word.charCodeAt(i)) >>> 0;
    }
    return hash >>> 0;
  }

  private updateIDF(documents: string[]): void {
    const docWords = new Set<string>();
    for (const doc of documents) {
      const words = doc.toLowerCase().split(/\s+/).filter(w => w.length > 1);
      const unique = new Set(words);
      for (const w of unique) {
        docWords.add(w);
        const current = this.idfCache.get(w) || 0;
        this.idfCache.set(w, Math.log((this.documentCount + 1) / (current + 1)));
      }
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }
    
    const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
    return magnitude > 0 ? dotProduct / magnitude : 0;
  }

  getStats(): { 
    bufferSize: number; 
    vectorCacheSize: number;
    activeUsers: number;
    activeSessions: number;
    idfVocabSize: number;
  } {
    let totalBufferSize = 0;
    for (const buffer of this.learningBuffer.values()) {
      totalBufferSize += buffer.length;
    }
    
    return {
      bufferSize: totalBufferSize,
      vectorCacheSize: this.vectorCache.size,
      activeUsers: this.learningBuffer.size,
      activeSessions: this.sessions.size,
      idfVocabSize: this.idfCache.size
    };
  }

  async flushAll(): Promise<void> {
    for (const [key, buffer] of this.learningBuffer) {
      if (buffer.length > 0) {
        const userId = parseInt(key.split(':')[1]);
        await this.processBatch(userId, buffer);
      }
    }
    this.learningBuffer.clear();

    for (const [key, session] of this.sessions) {
      if (session.messages.length >= this.SESSION_SUMMARY_MIN_MESSAGES) {
        await this.saveSessionSummary(session).catch(() => {});
      }
    }
    this.sessions.clear();
  }

  getSessionContext(userId: number): string | null {
    const sessionKey = `session:${userId}`;
    const session = this.sessions.get(sessionKey);
    if (!session || session.messages.length === 0) return null;

    const recentMessages = session.messages.slice(-8);
    const topics = this.extractTopics(
      recentMessages.filter(m => m.role === 'user').map(m => m.content)
    );

    return [
      `Session active depuis ${Math.round((Date.now() - session.startedAt) / 60000)}min`,
      `Domaine: ${session.domain || 'général'}`,
      `Sujets: ${topics.join(', ')}`,
      `Derniers échanges: ${recentMessages.slice(-4).map(m => `[${m.role}] ${m.content.substring(0, 80)}`).join(' → ')}`
    ].join(' | ');
  }
}
