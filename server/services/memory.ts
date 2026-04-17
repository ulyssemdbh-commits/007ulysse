import { db } from "../db";
import { ulysseMemory, projectMemory, webSearchMemory, ulysseFiles, users, knowledgeBase, savedLinks, conversationMessages, conversationThreads, UlysseMemory, ProjectMemory, WebSearchMemory, UlysseFile } from "@shared/schema";
import { eq, desc, sql, and, lt, gte, ne, inArray } from "drizzle-orm";
import OpenAI from "openai";
import { canMakeCall, withRateLimit } from "./rateLimiter";
import { emitMemoryUpdated } from "./realtimeSync";
import { brainService } from "./brainService";
import { memoryGraphService } from "./memoryGraphService";

// Memory optimization constants
const MEMORY_DECAY_DAYS = 30; // Start decay after 30 days
const MEMORY_DECAY_RATE = 5; // Points per decay cycle
const MIN_CONFIDENCE = 10; // Minimum confidence before deletion
const MAX_MEMORIES_PER_CATEGORY = 20; // Limit per category for context
const SIMILARITY_THRESHOLD = 0.7; // For duplicate detection

// Curiosity system constants
const CURIOSITY_COOLDOWN_HOURS = 4; // Wait between curiosity questions
const MAX_PENDING_CURIOSITY = 5; // Max pending questions per user
const CURIOSITY_CATEGORY = "curiosity"; // Category in ulysseMemory for pending questions

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// Sanitize user input before sending to AI
function sanitizeForAI(text: string | undefined | null, maxLength: number = 2000): string {
  if (!text) return '';
  return String(text)
    .replace(/[<>{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, maxLength)
    .trim();
}

export class MemoryService {
  // All methods now require userId for proper data isolation

  async getAllMemories(userId: number): Promise<UlysseMemory[]> {
    return db.select().from(ulysseMemory)
      .where(eq(ulysseMemory.userId, userId))
      .orderBy(desc(ulysseMemory.confidence));
  }

  async getMemoriesByCategory(userId: number, category: string): Promise<UlysseMemory[]> {
    return db.select().from(ulysseMemory)
      .where(and(eq(ulysseMemory.userId, userId), eq(ulysseMemory.category, category)));
  }

  async getAllProjectMemories(userId: number): Promise<ProjectMemory[]> {
    return db.select().from(projectMemory)
      .where(eq(projectMemory.userId, userId))
      .orderBy(desc(projectMemory.lastDiscussed));
  }

  async getActiveProjects(userId: number): Promise<ProjectMemory[]> {
    return db.select().from(projectMemory)
      .where(and(eq(projectMemory.userId, userId), eq(projectMemory.status, "active")));
  }

  async updateOrCreateMemory(
    userId: number, 
    category: string, 
    key: string, 
    value: string, 
    source?: string,
    options?: { verified?: boolean; data?: any }
  ): Promise<void> {
    const verified = options?.verified ?? false;
    const metadata = options?.data ? { source, data: options.data } : (source ? { source } : null);
    
    const existing = await db.select().from(ulysseMemory)
      .where(and(
        eq(ulysseMemory.userId, userId),
        eq(ulysseMemory.category, category),
        eq(ulysseMemory.key, key)
      ));
    
    if (existing.length > 0) {
      // Verified data gets higher confidence boost
      const confidenceBoost = verified ? 20 : 10;
      const newConfidence = Math.min(100, existing[0].confidence + confidenceBoost);
      await db.update(ulysseMemory)
        .set({ 
          value, 
          confidence: newConfidence, 
          source: source || existing[0].source,
          verified,
          metadata,
          updatedAt: new Date()
        })
        .where(and(eq(ulysseMemory.id, existing[0].id), eq(ulysseMemory.userId, userId)));
    } else {
      const initialConfidence = verified ? 85 : 50;
      const [inserted] = await db.insert(ulysseMemory).values({
        userId,
        category,
        key,
        value,
        confidence: initialConfidence,
        source,
        verified,
        metadata
      }).returning();
      
      if (inserted) {
        memoryGraphService.autoConnect(inserted.id).catch(err => 
          console.error("[Memory] autoConnect error:", err)
        );
      }
    }
    try {
      const { sensorySystemService } = await import("./sensory/index.js");
      sensorySystemService.recordPulse?.({
        zones: ["hippocampus", "association"],
        intensity: 0.7,
        source: "memory.updateOrCreate",
        meta: { userId, category, key },
      });
    } catch {}
  }

  // Get only verified memories (for critical operations)
  async getVerifiedMemories(userId: number, category?: string): Promise<UlysseMemory[]> {
    if (category) {
      return db.select().from(ulysseMemory)
        .where(and(
          eq(ulysseMemory.userId, userId),
          eq(ulysseMemory.category, category),
          eq(ulysseMemory.verified, true)
        ))
        .orderBy(desc(ulysseMemory.confidence));
    }
    return db.select().from(ulysseMemory)
      .where(and(
        eq(ulysseMemory.userId, userId),
        eq(ulysseMemory.verified, true)
      ))
      .orderBy(desc(ulysseMemory.confidence));
  }

  async updateOrCreateProject(userId: number, name: string, updates: Partial<Omit<ProjectMemory, 'id' | 'userId' | 'projectName'>>): Promise<void> {
    const existing = await db.select().from(projectMemory)
      .where(and(eq(projectMemory.userId, userId), eq(projectMemory.projectName, name)));
    
    if (existing.length > 0) {
      await db.update(projectMemory)
        .set({ ...updates, lastDiscussed: new Date() })
        .where(and(eq(projectMemory.id, existing[0].id), eq(projectMemory.userId, userId)));
    } else {
      await db.insert(projectMemory).values({
        userId,
        projectName: name,
        ...updates
      });
    }
  }

  async extractInsightsFromConversation(userId: number, userMessage: string, assistantResponse: string): Promise<void> {
    if (!canMakeCall("combined")) {
      console.log("Rate limit reached for memory extraction, skipping");
      return;
    }
    
    try {
      const sanitizedUserMessage = sanitizeForAI(userMessage, 1000);
      const sanitizedResponse = sanitizeForAI(assistantResponse, 1500);
      
      if (sanitizedUserMessage.length < 10 || sanitizedResponse.length < 20) {
        return;
      }
      
      const extractionPrompt = `Analyse cette conversation et extrais les informations à retenir sur l'utilisateur.

MESSAGE UTILISATEUR: "${sanitizedUserMessage}"
RÉPONSE ASSISTANT: "${sanitizedResponse}"

Retourne un JSON avec:
{
  "memories": [
    {"category": "preference|personality|skill|interest|habit|fact", "key": "identifiant_court", "value": "information apprise"}
  ],
  "project": {
    "name": "nom du projet si mentionné ou null",
    "summary": "résumé si applicable",
    "techStack": ["technologies mentionnées"],
    "decisions": ["décisions prises"],
    "nextSteps": ["prochaines étapes"]
  }
}

Règles:
- Ne retourne que des informations nouvelles et significatives
- Ignore les salutations et bavardages sans contenu
- Sois concis dans les valeurs
- IMPORTANT: Extrais TOUJOURS les informations personnelles comme date de naissance, âge, anniversaire, nom complet, adresse, numéro de téléphone
- Si rien d'important, retourne {"memories": [], "project": null}`;

      const response = await withRateLimit("combined", () => 
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: extractionPrompt }],
          response_format: { type: "json_object" },
          max_tokens: 500
        }),
        1
      );

      const content = response.choices[0]?.message?.content;
      if (!content) return;

      const insights = JSON.parse(content);

      let hasUpdates = false;
      for (const memory of insights.memories || []) {
        if (memory.category && memory.key && memory.value) {
          // Use smart update with duplicate detection
          const result = await this.updateOrCreateMemorySmart(
            userId,
            memory.category,
            memory.key,
            memory.value,
            userMessage.slice(0, 100)
          );
          if (!result.skipped) {
            hasUpdates = true;
          }
        }
      }

      if (insights.project?.name) {
        await this.updateOrCreateProject(userId, insights.project.name, {
          summary: insights.project.summary,
          techStack: insights.project.techStack || [],
          nextSteps: insights.project.nextSteps || []
        });
        hasUpdates = true;
      }

      if (hasUpdates) {
        emitMemoryUpdated(userId);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("RATE_LIMIT_EXCEEDED")) {
        console.log("Rate limit reached during memory extraction");
      } else {
        console.error("Error extracting insights:", error);
      }
    }
  }

  async buildContextPrompt(userId: number, isOwner: boolean = true): Promise<string> {
    const [memories, projects, importantKnowledge] = await Promise.all([
      this.getAllMemories(userId),
      this.getActiveProjects(userId),
      brainService.getMostImportantKnowledge(userId, 5)
    ]);

    if (memories.length === 0 && projects.length === 0 && importantKnowledge.length === 0) {
      return "";
    }

    const userName = isOwner ? "MAURICE" : "L'UTILISATEUR";
    let context = `\n\nCE QUE TU SAIS SUR ${userName}:\n`;

    const categories: Record<string, UlysseMemory[]> = {};
    for (const mem of memories) {
      if (!categories[mem.category]) categories[mem.category] = [];
      categories[mem.category].push(mem);
    }

    const categoryLabels: Record<string, string> = {
      personality: "Personnalité",
      preference: "Préférences",
      skill: "Compétences",
      interest: "Intérêts",
      habit: "Habitudes",
      fact: "Faits",
      homework: "Tâches accomplies",
      knowledge: "Connaissances acquises"
    };

    for (const [cat, items] of Object.entries(categories)) {
      if (items.length > 0) {
        context += `\n${categoryLabels[cat] || cat}:\n`;
        for (const item of items.slice(0, 5)) {
          context += `- ${item.key}: ${item.value}\n`;
        }
      }
    }

    if (projects.length > 0) {
      context += "\nPROJETS ACTIFS:\n";
      for (const proj of projects.slice(0, 3)) {
        context += `- ${proj.projectName}`;
        if (proj.summary) context += `: ${proj.summary}`;
        if (proj.techStack && proj.techStack.length > 0) {
          context += ` [${proj.techStack.join(", ")}]`;
        }
        context += "\n";
      }
    }

    if (importantKnowledge.length > 0) {
      context += "\nCONNAISSANCES IMPORTANTES:\n";
      for (const knowledge of importantKnowledge) {
        context += `- [${knowledge.category}] ${knowledge.title}`;
        if (knowledge.summary) {
          context += `: ${knowledge.summary}`;
        } else if (knowledge.content.length < 150) {
          context += `: ${knowledge.content}`;
        }
        context += "\n";
      }
    }

    return context;
  }

  async deleteMemory(userId: number, id: number): Promise<void> {
    await db.delete(ulysseMemory)
      .where(and(eq(ulysseMemory.id, id), eq(ulysseMemory.userId, userId)));
  }

  async deleteProjectMemory(userId: number, id: number): Promise<void> {
    await db.delete(projectMemory)
      .where(and(eq(projectMemory.id, id), eq(projectMemory.userId, userId)));
  }

  async saveWebSearchToMemory(
    userId: number,
    query: string,
    results: Array<{ title: string; url: string; snippet: string }>,
    userContext: string
  ): Promise<void> {
    if (!canMakeCall("combined")) {
      console.log("Rate limit reached for web search memory, skipping");
      return;
    }
    
    try {
      const sanitizedQuery = sanitizeForAI(query, 200);
      const sanitizedContext = sanitizeForAI(userContext, 500);
      const sanitizedResults = results.slice(0, 5).map(r => ({
        title: sanitizeForAI(r.title, 100),
        snippet: sanitizeForAI(r.snippet, 200)
      }));
      
      const extractPrompt = `Analyse cette recherche web et extrait les informations clés à retenir.

REQUÊTE: "${sanitizedQuery}"
CONTEXTE UTILISATEUR: "${sanitizedContext}"
RÉSULTATS:
${sanitizedResults.map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}`).join("\n\n")}

Retourne un JSON avec:
{
  "topic": "sujet/catégorie principal de la recherche",
  "keyFindings": ["fait important 1", "fait important 2", "fait important 3"],
  "learnedInsights": "ce qu'Ulysse a appris de cette recherche en 1-2 phrases"
}`;

      const response = await withRateLimit("combined", () =>
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: extractPrompt }],
          response_format: { type: "json_object" },
          max_tokens: 300
        }),
        0
      );

      const content = response.choices[0]?.message?.content;
      if (!content) return;

      const insights = JSON.parse(content);

      await db.insert(webSearchMemory).values({
        userId,
        query,
        topic: insights.topic || null,
        keyFindings: insights.keyFindings || [],
        sources: results.slice(0, 5),
        userContext,
        learnedInsights: insights.learnedInsights || null,
        usefulnessScore: 50,
        timesReferenced: 0
      });

      console.log(`Web search memory saved for user ${userId}: "${query}" - Topic: ${insights.topic}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("RATE_LIMIT_EXCEEDED")) {
        console.log("Rate limit reached during web search memory save");
      } else {
        console.error("Error saving web search to memory:", error);
      }
    }
  }

  async getRecentWebSearches(userId: number, limit: number = 10): Promise<WebSearchMemory[]> {
    return db.select().from(webSearchMemory)
      .where(eq(webSearchMemory.userId, userId))
      .orderBy(desc(webSearchMemory.createdAt))
      .limit(limit);
  }

  // Owner-only: Get ALL users' recent web searches (for Ulysse's global view)
  async getAllUsersRecentWebSearches(limit: number = 15): Promise<(WebSearchMemory & { userName?: string })[]> {
    const searches = await db.select({
      search: webSearchMemory,
      userName: users.displayName
    })
      .from(webSearchMemory)
      .leftJoin(users, eq(webSearchMemory.userId, users.id))
      .orderBy(desc(webSearchMemory.createdAt))
      .limit(limit);
    
    return searches.map(s => ({
      ...s.search,
      userName: s.userName || undefined
    }));
  }

  async getWebSearchesByTopic(userId: number, topic: string): Promise<WebSearchMemory[]> {
    return db.select().from(webSearchMemory)
      .where(and(
        eq(webSearchMemory.userId, userId),
        sql`${webSearchMemory.topic} ILIKE ${`%${topic}%`}`
      ));
  }

  async incrementSearchReference(userId: number, id: number): Promise<void> {
    const existing = await db.select().from(webSearchMemory)
      .where(and(eq(webSearchMemory.id, id), eq(webSearchMemory.userId, userId)));
    if (existing.length > 0) {
      const current = existing[0];
      await db.update(webSearchMemory)
        .set({ 
          timesReferenced: (current.timesReferenced ?? 0) + 1,
          usefulnessScore: Math.min(100, (current.usefulnessScore ?? 50) + 5)
        })
        .where(and(eq(webSearchMemory.id, id), eq(webSearchMemory.userId, userId)));
    }
  }

  async buildContextPromptWithSearches(userId: number, isOwner: boolean = true, conversationTopic?: string, userDisplayName?: string): Promise<string> {
    let context = await this.buildOptimizedContext(userId, isOwner, conversationTopic, userDisplayName);
    
    // Owner (Ulysse) gets global view of ALL users' searches
    if (isOwner) {
      const allUsersSearches = await this.getAllUsersRecentWebSearches(10);
      
      if (allUsersSearches.length > 0) {
        context += "\n\n[Vue globale - Recherches récentes de tous les utilisateurs]\n";
        for (const search of allUsersSearches) {
          const userLabel = search.userName ? `[${search.userName}]` : "[Utilisateur]";
          context += `• ${userLabel} ${search.topic || search.query}`;
          if (search.keyFindings && search.keyFindings.length > 0) {
            context += `: ${search.keyFindings.slice(0, 2).join("; ")}`;
          }
          context += "\n";
        }
      }
    } else {
      // Non-owner (Iris/Alfred) only sees their own searches
      const recentSearches = await this.getRecentWebSearches(userId, 5);
      
      if (recentSearches.length > 0) {
        context += "\n\n[Recherches récentes]\n";
        for (const search of recentSearches) {
          context += `• ${search.topic || search.query}`;
          if (search.keyFindings && search.keyFindings.length > 0) {
            context += `: ${search.keyFindings.slice(0, 2).join("; ")}`;
          }
          context += "\n";
        }
      }
    }
    
    // Add file context
    const filesContext = await this.buildFilesContext(userId);
    if (filesContext) {
      context += filesContext;
    }
    
    return context;
  }

  async buildRecentConversationsContext(userId: number, currentThreadId?: number, maxThreads: number = 5): Promise<string> {
    try {
      const recentThreads = await db.select({
        id: conversationThreads.id,
        title: conversationThreads.title,
        createdAt: conversationThreads.createdAt,
      })
        .from(conversationThreads)
        .where(
          currentThreadId
            ? and(eq(conversationThreads.userId, userId), ne(conversationThreads.id, currentThreadId))
            : eq(conversationThreads.userId, userId)
        )
        .orderBy(desc(conversationThreads.createdAt))
        .limit(maxThreads);

      if (recentThreads.length === 0) return "";

      const threadIds = recentThreads.map(t => t.id);
      const messages = await db.select({
        threadId: conversationMessages.threadId,
        role: conversationMessages.role,
        content: conversationMessages.content,
        createdAt: conversationMessages.createdAt,
      })
        .from(conversationMessages)
        .where(inArray(conversationMessages.threadId, threadIds))
        .orderBy(desc(conversationMessages.createdAt))
        .limit(maxThreads * 4);

      if (messages.length === 0) return "";

      const threadMap = new Map<number, typeof messages>();
      for (const msg of messages) {
        if (!threadMap.has(msg.threadId)) threadMap.set(msg.threadId, []);
        threadMap.get(msg.threadId)!.push(msg);
      }

      let context = `\n\n═══ CONVERSATIONS PRÉCÉDENTES ═══\n`;
      for (const thread of recentThreads) {
        const threadMsgs = threadMap.get(thread.id);
        if (!threadMsgs || threadMsgs.length === 0) continue;

        const date = thread.createdAt ? new Date(thread.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
        context += `\n[${date}] "${thread.title || 'Conversation'}":\n`;
        const sorted = threadMsgs.sort((a, b) => new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime());
        for (const msg of sorted.slice(0, 4)) {
          const label = msg.role === "user" ? "Utilisateur" : "Iris";
          context += `  ${label}: ${(msg.content || "").slice(0, 150)}\n`;
        }
      }
      context += `\nTu DOIS utiliser ces conversations pour contextualiser tes réponses. Tu te souviens de tout.\n`;
      return context;
    } catch (err) {
      console.error("[Memory] Error building recent conversations context:", err);
      return "";
    }
  }

  async getUserFiles(userId: number): Promise<UlysseFile[]> {
    return db.select().from(ulysseFiles)
      .where(eq(ulysseFiles.userId, userId))
      .orderBy(desc(ulysseFiles.createdAt))
      .limit(20);
  }

  async buildFilesContext(userId: number): Promise<string> {
    const files = await this.getUserFiles(userId);
    
    if (files.length === 0) {
      return "";
    }

    const generatedFiles = files.filter(f => f.category === "generated");
    const receivedFiles = files.filter(f => f.category === "received");

    let context = "\n\nFICHIERS ACCESSIBLES (tu peux les analyser si demande):\n";
    
    if (generatedFiles.length > 0) {
      context += "\n[GENERES] Fichiers crees par toi:\n";
      for (const file of generatedFiles.slice(0, 10)) {
        const size = file.sizeBytes ? `(${Math.round(file.sizeBytes / 1024)}KB)` : "";
        context += `- ${file.originalName || file.filename} ${size}\n`;
      }
    }
    
    if (receivedFiles.length > 0) {
      context += "\n[RECUS] Fichiers envoyes par l'utilisateur:\n";
      for (const file of receivedFiles.slice(0, 10)) {
        const size = file.sizeBytes ? `(${Math.round(file.sizeBytes / 1024)}KB)` : "";
        const summary = file.description ? ` - ${file.description.slice(0, 100)}` : "";
        context += `- ${file.originalName || file.filename} ${size}${summary}\n`;
      }
    }
    
    return context;
  }

  async storeFileInMemory(userId: number, fileName: string, contentSummary: string, category: "generated" | "received"): Promise<void> {
    const source = category === "generated" ? "Fichier créé par Ulysse" : "Fichier envoyé par l'utilisateur";
    await this.updateOrCreateMemory(
      userId,
      "files",
      fileName,
      contentSummary,
      source
    );
  }

  // ===== MEMORY OPTIMIZATION METHODS =====

  // Calculate text similarity using Jaccard index (fast, no AI needed)
  private calculateSimilarity(text1: string, text2: string): number {
    // Create unique word sets (deduplicated)
    const words1Arr = text1.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const words2Arr = text2.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const words1 = new Set(words1Arr);
    const words2 = new Set(words2Arr);
    
    if (words1.size === 0 && words2.size === 0) return 1;
    if (words1.size === 0 || words2.size === 0) return 0;
    
    // Calculate intersection size (words in both sets)
    let intersectionSize = 0;
    words1.forEach(word => {
      if (words2.has(word)) intersectionSize++;
    });
    
    // Calculate union size (unique words in either set)
    const unionSize = words1.size + words2.size - intersectionSize;
    
    return unionSize > 0 ? intersectionSize / unionSize : 0;
  }

  // Check for duplicate before inserting (prevents redundant memories)
  async isDuplicate(userId: number, category: string, key: string, value: string): Promise<boolean> {
    const existing = await db.select().from(ulysseMemory)
      .where(and(
        eq(ulysseMemory.userId, userId),
        eq(ulysseMemory.category, category)
      ))
      .limit(50);
    
    for (const mem of existing) {
      // Exact key match
      if (mem.key.toLowerCase() === key.toLowerCase()) return true;
      
      // Semantic similarity check on value
      const similarity = this.calculateSimilarity(mem.value, value);
      if (similarity > SIMILARITY_THRESHOLD) {
        console.log(`[Memory] Duplicate detected: "${key}" similar to "${mem.key}" (${(similarity * 100).toFixed(0)}%)`);
        return true;
      }
    }
    return false;
  }

  // Apply memory decay to old unused memories
  async applyMemoryDecay(userId: number): Promise<{ decayed: number; deleted: number }> {
    const decayDate = new Date();
    decayDate.setDate(decayDate.getDate() - MEMORY_DECAY_DAYS);
    
    // Get old memories that haven't been updated
    const oldMemories = await db.select().from(ulysseMemory)
      .where(and(
        eq(ulysseMemory.userId, userId),
        lt(ulysseMemory.updatedAt, decayDate)
      ));
    
    let decayed = 0;
    let deleted = 0;
    
    for (const mem of oldMemories) {
      const newConfidence = mem.confidence - MEMORY_DECAY_RATE;
      
      if (newConfidence < MIN_CONFIDENCE) {
        // Delete very low confidence memories
        await db.delete(ulysseMemory)
          .where(and(eq(ulysseMemory.id, mem.id), eq(ulysseMemory.userId, userId)));
        deleted++;
        console.log(`[Memory] Deleted low-confidence memory: "${mem.key}" (category: ${mem.category})`);
      } else {
        // Decay confidence
        await db.update(ulysseMemory)
          .set({ confidence: newConfidence })
          .where(and(eq(ulysseMemory.id, mem.id), eq(ulysseMemory.userId, userId)));
        decayed++;
      }
    }
    
    if (decayed > 0 || deleted > 0) {
      console.log(`[Memory] Decay applied for user ${userId}: ${decayed} decayed, ${deleted} deleted`);
      emitMemoryUpdated(userId);
    }
    
    return { decayed, deleted };
  }

  // Consolidate similar memories (merge duplicates)
  async consolidateMemories(userId: number): Promise<{ merged: number }> {
    const allMemories = await this.getAllMemories(userId);
    const toDelete: number[] = [];
    const toUpdate: Map<number, { confidence: number; value: string }> = new Map();
    
    // Group by category
    const byCategory: Record<string, UlysseMemory[]> = {};
    for (const mem of allMemories) {
      if (!byCategory[mem.category]) byCategory[mem.category] = [];
      byCategory[mem.category].push(mem);
    }
    
    for (const [category, memories] of Object.entries(byCategory)) {
      const processed = new Set<number>();
      
      for (let i = 0; i < memories.length; i++) {
        if (processed.has(memories[i].id)) continue;
        
        const similar: UlysseMemory[] = [memories[i]];
        
        for (let j = i + 1; j < memories.length; j++) {
          if (processed.has(memories[j].id)) continue;
          
          const similarity = this.calculateSimilarity(
            memories[i].value + " " + memories[i].key,
            memories[j].value + " " + memories[j].key
          );
          
          if (similarity > SIMILARITY_THRESHOLD) {
            similar.push(memories[j]);
            processed.add(memories[j].id);
          }
        }
        
        // Merge if multiple similar entries found
        if (similar.length > 1) {
          // Keep the one with highest confidence
          similar.sort((a, b) => b.confidence - a.confidence);
          const keep = similar[0];
          const remove = similar.slice(1);
          
          // Boost confidence of kept memory
          const totalConfidence = Math.min(100, keep.confidence + remove.length * 5);
          toUpdate.set(keep.id, { 
            confidence: totalConfidence, 
            value: keep.value 
          });
          
          for (const rem of remove) {
            toDelete.push(rem.id);
          }
        }
      }
    }
    
    // Apply changes
    for (const id of toDelete) {
      await db.delete(ulysseMemory)
        .where(and(eq(ulysseMemory.id, id), eq(ulysseMemory.userId, userId)));
    }
    
    const updateEntries = Array.from(toUpdate.entries());
    for (const [id, update] of updateEntries) {
      await db.update(ulysseMemory)
        .set({ confidence: update.confidence, updatedAt: new Date() })
        .where(and(eq(ulysseMemory.id, id), eq(ulysseMemory.userId, userId)));
    }
    
    if (toDelete.length > 0) {
      console.log(`[Memory] Consolidated ${toDelete.length} duplicate memories for user ${userId}`);
      emitMemoryUpdated(userId);
    }
    
    return { merged: toDelete.length };
  }

  // Get relevant memories based on conversation topic
  async getRelevantMemories(userId: number, topic: string, limit: number = 15): Promise<UlysseMemory[]> {
    const allMemories = await this.getAllMemories(userId);
    
    // Score each memory by relevance to topic
    const scored = allMemories.map(mem => {
      const textToMatch = `${mem.key} ${mem.value} ${mem.category}`.toLowerCase();
      const topicWords = topic.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      
      let relevanceScore = 0;
      for (const word of topicWords) {
        if (textToMatch.includes(word)) {
          relevanceScore += 10;
        }
      }
      
      // Boost by confidence (normalized)
      relevanceScore += mem.confidence / 10;
      
      // Boost recent memories
      const daysOld = (Date.now() - new Date(mem.updatedAt!).getTime()) / (1000 * 60 * 60 * 24);
      if (daysOld < 7) relevanceScore += 5;
      else if (daysOld < 30) relevanceScore += 2;
      
      return { memory: mem, score: relevanceScore };
    });
    
    // Sort by score and return top N
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(s => s.memory);
  }

  // Optimized context builder with relevance filtering
  async buildOptimizedContext(
    userId: number, 
    isOwner: boolean = true,
    conversationTopic?: string,
    userDisplayName?: string
  ): Promise<string> {
    const [memories, projects, importantKnowledge, topicKnowledge] = await Promise.all([
      conversationTopic 
        ? this.getRelevantMemories(userId, conversationTopic, 25)
        : this.getAllMemories(userId).then(m => m.slice(0, 40)),
      this.getActiveProjects(userId),
      brainService.getMostImportantKnowledge(userId, 8),
      conversationTopic 
        ? brainService.searchKnowledge(userId, conversationTopic, { limit: 5 })
        : Promise.resolve([])
    ]);

    if (memories.length === 0 && projects.length === 0 && importantKnowledge.length === 0) {
      return "";
    }

    const userName = isOwner ? "MAURICE" : (userDisplayName || "L'UTILISATEUR");
    let context = `\n\n═══ MÉMOIRE DE ${userName.toUpperCase()} (${memories.length} entrées) ═══\n`;

    const categories: Record<string, UlysseMemory[]> = {};
    for (const mem of memories) {
      if (!categories[mem.category]) categories[mem.category] = [];
      if (categories[mem.category].length < MAX_MEMORIES_PER_CATEGORY) {
        categories[mem.category].push(mem);
      }
    }

    const categoryLabels: Record<string, string> = {
      personality: "Personnalité",
      preference: "Préférences",
      skill: "Compétences",
      interest: "Intérêts",
      habit: "Habitudes",
      fact: "Faits",
      homework: "Tâches accomplies",
      knowledge: "Connaissances"
    };

    const priorityOrder = ["fact", "preference", "personality", "skill", "interest", "habit", "homework", "knowledge"];
    
    for (const cat of priorityOrder) {
      const items = categories[cat];
      if (!items || items.length === 0) continue;
      
      context += `\n[${categoryLabels[cat] || cat}]\n`;
      for (const item of items.slice(0, 8)) {
        const conf = item.confidence >= 80 ? "★" : item.confidence >= 50 ? "●" : "○";
        context += `${conf} ${item.key}: ${item.value.slice(0, 150)}\n`;
      }
    }

    const allKnowledge = new Map<number, typeof importantKnowledge[0]>();
    for (const k of importantKnowledge) allKnowledge.set(k.id, k);
    for (const k of topicKnowledge) allKnowledge.set(k.id, k);
    const uniqueKnowledge = [...allKnowledge.values()];

    if (uniqueKnowledge.length > 0) {
      context += `\n[Connaissances acquises (${uniqueKnowledge.length})]\n`;
      for (const k of uniqueKnowledge.slice(0, 10)) {
        const typeLabel = k.type === 'concept' ? '💡' : k.type === 'fact' ? '📌' : k.type === 'pattern' ? '🔄' : k.type === 'insight' ? '🧠' : '•';
        const summary = k.summary || k.content?.slice(0, 150) || '';
        context += `${typeLabel} [${k.category || 'general'}] ${k.title}: ${summary.slice(0, 120)}\n`;
      }
    }

    if (projects.length > 0) {
      context += "\n[Projets actifs]\n";
      for (const proj of projects.slice(0, 3)) {
        context += `• ${proj.projectName}`;
        if (proj.summary) context += `: ${proj.summary.slice(0, 100)}`;
        if (proj.techStack && proj.techStack.length > 0) {
          context += ` [${proj.techStack.slice(0, 3).join(", ")}]`;
        }
        context += "\n";
      }
    }

    return context;
  }

  // Enhanced memory update with duplicate detection
  async updateOrCreateMemorySmart(
    userId: number, 
    category: string, 
    key: string, 
    value: string, 
    source?: string
  ): Promise<{ created: boolean; skipped: boolean }> {
    // Check for exact key match first
    const existing = await db.select().from(ulysseMemory)
      .where(and(
        eq(ulysseMemory.userId, userId),
        eq(ulysseMemory.category, category),
        eq(ulysseMemory.key, key)
      ));
    
    if (existing.length > 0) {
      // Update existing - boost confidence
      const newConfidence = Math.min(100, existing[0].confidence + 10);
      await db.update(ulysseMemory)
        .set({ 
          value, 
          confidence: newConfidence, 
          source: source || existing[0].source,
          updatedAt: new Date()
        })
        .where(and(eq(ulysseMemory.id, existing[0].id), eq(ulysseMemory.userId, userId)));
      return { created: false, skipped: false };
    }
    
    // Check for semantic duplicates
    const isDupe = await this.isDuplicate(userId, category, key, value);
    if (isDupe) {
      return { created: false, skipped: true };
    }
    
    // Create new
    await db.insert(ulysseMemory).values({
      userId,
      category,
      key,
      value,
      confidence: 50,
      source
    });
    
    return { created: true, skipped: false };
  }

  // Memory statistics
  async getMemoryStats(userId: number): Promise<{
    totalMemories: number;
    byCategory: Record<string, number>;
    avgConfidence: number;
    oldMemories: number;
  }> {
    const all = await this.getAllMemories(userId);
    const decayDate = new Date();
    decayDate.setDate(decayDate.getDate() - MEMORY_DECAY_DAYS);
    
    const byCategory: Record<string, number> = {};
    let totalConfidence = 0;
    let oldCount = 0;
    
    for (const mem of all) {
      byCategory[mem.category] = (byCategory[mem.category] || 0) + 1;
      totalConfidence += mem.confidence;
      if (mem.updatedAt && new Date(mem.updatedAt) < decayDate) {
        oldCount++;
      }
    }
    
    return {
      totalMemories: all.length,
      byCategory,
      avgConfidence: all.length > 0 ? Math.round(totalConfidence / all.length) : 0,
      oldMemories: oldCount
    };
  }

  // Full memory optimization run
  async runOptimization(userId: number): Promise<{
    decayed: number;
    deleted: number;
    merged: number;
  }> {
    console.log(`[Memory] Running full optimization for user ${userId}`);
    
    const decayResult = await this.applyMemoryDecay(userId);
    const consolidateResult = await this.consolidateMemories(userId);
    
    return {
      decayed: decayResult.decayed,
      deleted: decayResult.deleted,
      merged: consolidateResult.merged
    };
  }

  // ==================== CURIOSITY SYSTEM ====================
  // Makes Ulysse/Iris show genuine interest in users by asking questions and learning

  // Get all pending curiosity questions (status = pending)
  async getAllPendingCuriosity(userId: number): Promise<UlysseMemory[]> {
    const curiosities = await db.select().from(ulysseMemory)
      .where(and(
        eq(ulysseMemory.userId, userId),
        eq(ulysseMemory.category, CURIOSITY_CATEGORY)
      ));
    
    return curiosities.filter(c => {
      try {
        const data = JSON.parse(c.value);
        return data.status === "pending" || data.status === "suggested";
      } catch {
        return false;
      }
    });
  }

  // Get pending curiosity questions eligible to be asked (respects cooldown)
  async getPendingCuriosityQuestions(userId: number): Promise<UlysseMemory[]> {
    const curiosities = await db.select().from(ulysseMemory)
      .where(and(
        eq(ulysseMemory.userId, userId),
        eq(ulysseMemory.category, CURIOSITY_CATEGORY)
      ))
      .orderBy(desc(ulysseMemory.confidence));
    
    return curiosities.filter(c => {
      try {
        const data = JSON.parse(c.value);
        return data.status === "pending";
      } catch {
        return false;
      }
    }).slice(0, 3);
  }

  // Get recently asked questions awaiting answers
  async getAskedCuriosityQuestions(userId: number): Promise<UlysseMemory[]> {
    const curiosities = await db.select().from(ulysseMemory)
      .where(and(
        eq(ulysseMemory.userId, userId),
        eq(ulysseMemory.category, CURIOSITY_CATEGORY)
      ));
    
    return curiosities.filter(c => {
      try {
        const data = JSON.parse(c.value);
        return data.status === "asked";
      } catch {
        return false;
      }
    });
  }

  // Check if we should ask a curiosity question (rate limiting based on last asked time)
  async shouldAskCuriosity(userId: number): Promise<boolean> {
    const askedQuestions = await this.getAskedCuriosityQuestions(userId);
    if (askedQuestions.length === 0) return true;
    
    // Find the most recently asked
    let lastAskedTime: Date | null = null;
    for (const q of askedQuestions) {
      try {
        const data = JSON.parse(q.value);
        if (data.askedAt) {
          const askedAt = new Date(data.askedAt);
          if (!lastAskedTime || askedAt > lastAskedTime) {
            lastAskedTime = askedAt;
          }
        }
      } catch {
        continue;
      }
    }
    
    if (!lastAskedTime) return true;
    
    const cooldownTime = new Date();
    cooldownTime.setHours(cooldownTime.getHours() - CURIOSITY_COOLDOWN_HOURS);
    
    return lastAskedTime < cooldownTime;
  }

  // Generate curiosity questions from conversation context
  async generateCuriosityFromConversation(
    userId: number, 
    userMessage: string, 
    assistantResponse: string,
    isOwner: boolean,
    isExternal: boolean = false
  ): Promise<void> {
    if (!canMakeCall("combined")) {
      return;
    }

    try {
      const sanitizedUserMessage = sanitizeForAI(userMessage, 500);
      const sanitizedResponse = sanitizeForAI(assistantResponse, 500);
      
      if (sanitizedUserMessage.length < 20) return;

      // Get existing memories to know what we already know
      const existingMemories = await this.getAllMemories(userId);
      const knownFacts = existingMemories
        .filter(m => m.category !== CURIOSITY_CATEGORY)
        .slice(0, 10)
        .map(m => `${m.key}: ${m.value}`)
        .join(", ");

      const persona = isOwner ? "Ulysse" : isExternal ? "Alfred" : "Iris";
      const userName = isOwner ? "Maurice" : "l'utilisateur";

      const curiosityPrompt = `Tu es ${persona}, un assistant IA personnel qui s'intéresse sincèrement à ${userName}.

CONVERSATION:
Utilisateur: "${sanitizedUserMessage}"
${persona}: "${sanitizedResponse}"

CE QUE TU SAIS DÉJÀ: ${knownFacts || "Rien encore"}

Génère 0-2 questions de curiosité sincère pour mieux connaître ${userName}.
Les questions doivent être:
- Naturelles et non intrusives
- Liées au contexte de la conversation
- Utiles pour personnaliser les futures interactions
- PAS des questions sur des tâches ou du travail technique

Catégories possibles: vie_personnelle, passions, preferences, habitudes, objectifs, humeur

Retourne JSON:
{
  "questions": [
    {"key": "question_courte_id", "question": "Question en français?", "reason": "Pourquoi demander ça", "priority": 1-3}
  ]
}

Si aucune question pertinente, retourne {"questions": []}`;

      const response = await withRateLimit("combined", () => 
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: curiosityPrompt }],
          response_format: { type: "json_object" },
          max_tokens: 300
        }),
        1
      );

      const content = response.choices[0]?.message?.content;
      if (!content) return;

      const result = JSON.parse(content);
      const allPending = await this.getAllPendingCuriosity(userId);
      const pendingCount = allPending.length;

      for (const q of (result.questions || []).slice(0, MAX_PENDING_CURIOSITY - pendingCount)) {
        if (q.key && q.question) {
          // Check if similar question already exists
          const exists = allPending.some(p => p.key === q.key);
          if (exists) continue;
          
          // Store as pending curiosity question (don't use updateOrCreate to avoid timestamp issues)
          await db.insert(ulysseMemory).values({
            userId,
            category: CURIOSITY_CATEGORY,
            key: q.key,
            value: JSON.stringify({ 
              question: q.question, 
              reason: q.reason, 
              priority: q.priority || 2, 
              status: "pending",
              createdAt: new Date().toISOString()
            }),
            confidence: 50,
            source: userMessage.slice(0, 50)
          });
          console.log(`[Curiosity] Generated question for user ${userId}: ${q.key}`);
        }
      }
    } catch (error) {
      console.error("[Curiosity] Error generating questions:", error);
    }
  }

  // Mark a curiosity question as asked
  async markCuriosityAsked(userId: number, key: string): Promise<void> {
    const existing = await db.select().from(ulysseMemory)
      .where(and(
        eq(ulysseMemory.userId, userId),
        eq(ulysseMemory.category, CURIOSITY_CATEGORY),
        eq(ulysseMemory.key, key)
      ));
    
    if (existing.length > 0) {
      try {
        const data = JSON.parse(existing[0].value);
        data.status = "asked";
        data.askedAt = new Date().toISOString();
        
        await db.update(ulysseMemory)
          .set({ value: JSON.stringify(data), updatedAt: new Date() })
          .where(eq(ulysseMemory.id, existing[0].id));
      } catch (e) {
        // Not valid JSON, remove it
        await db.delete(ulysseMemory).where(eq(ulysseMemory.id, existing[0].id));
      }
    }
  }

  // Record answer to a curiosity question and convert to learned memory
  async recordCuriosityAnswer(userId: number, key: string, answer: string): Promise<void> {
    // Remove the curiosity question
    await db.delete(ulysseMemory)
      .where(and(
        eq(ulysseMemory.userId, userId),
        eq(ulysseMemory.category, CURIOSITY_CATEGORY),
        eq(ulysseMemory.key, key)
      ));
    
    // Store as a learned fact
    const category = key.includes("passion") || key.includes("hobby") ? "interest" 
      : key.includes("preference") ? "preference"
      : key.includes("habitude") ? "habit"
      : "fact";
    
    await this.updateOrCreateMemory(userId, category, key, answer, "Réponse à une question de curiosité");
    console.log(`[Curiosity] Recorded answer for ${key}: ${answer.slice(0, 50)}...`);
  }

  // Build curiosity prompt injection for AI context
  // Returns { prompt, suggestedKey } - caller should mark as asked only if AI actually asks
  async buildCuriosityPrompt(userId: number, isOwner: boolean, isExternal: boolean = false): Promise<{ prompt: string; suggestedKey: string | null }> {
    const shouldAsk = await this.shouldAskCuriosity(userId);
    if (!shouldAsk) return { prompt: "", suggestedKey: null };

    const pending = await this.getPendingCuriosityQuestions(userId);
    if (pending.length === 0) return { prompt: "", suggestedKey: null };

    // Pick highest priority question
    let bestQuestion: { question: string; key: string } | null = null;
    let bestPriority = 999;

    for (const p of pending) {
      try {
        const data = JSON.parse(p.value);
        if (data.status === "pending" && data.priority < bestPriority) {
          bestPriority = data.priority;
          bestQuestion = { question: data.question, key: p.key };
        }
      } catch (e) {
        continue;
      }
    }

    if (!bestQuestion) return { prompt: "", suggestedKey: null };

    const persona = isOwner ? "Ulysse" : isExternal ? "Alfred" : "Iris";
    const userName = isOwner ? "Maurice" : "l'utilisateur";

    // Don't mark as asked yet - will be done when we detect the question was used
    return {
      prompt: `

[CURIOSITÉ - OPTIONNEL]
${persona}, tu t'intéresses sincèrement à ${userName}. Si le moment est approprié (pas en pleine tâche technique), 
tu peux naturellement poser cette question: "${bestQuestion.question}"

Intègre-la de façon naturelle à ta réponse, ou ignore-la si le contexte ne s'y prête pas.
N'insiste jamais si ${userName} semble occupé ou ne souhaite pas répondre.
Si tu poses la question, inclus le marqueur [CURIOSITÉ_POSÉE] à la fin de ta réponse.`,
      suggestedKey: bestQuestion.key
    };
  }

  // Check if AI asked the curiosity question and mark it as asked
  async processCuriosityInResponse(userId: number, response: string, suggestedKey: string | null): Promise<void> {
    if (!suggestedKey) return;
    
    // Check if AI included the curiosity marker
    if (response.includes("[CURIOSITÉ_POSÉE]")) {
      await this.markCuriosityAsked(userId, suggestedKey);
      console.log(`[Curiosity] Question "${suggestedKey}" was asked`);
    }
  }

  // Detect if user is answering a recently asked curiosity question
  async processPotentialCuriosityAnswer(userId: number, userMessage: string, isOwner: boolean, isExternal: boolean = false): Promise<void> {
    const askedQuestions = await this.getAskedCuriosityQuestions(userId);
    if (askedQuestions.length === 0) return;
    
    // Only process recent questions (asked within last hour)
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);
    
    const recentAsked = askedQuestions.filter(q => {
      try {
        const data = JSON.parse(q.value);
        return data.askedAt && new Date(data.askedAt) > oneHourAgo;
      } catch {
        return false;
      }
    });
    
    if (recentAsked.length === 0) return;
    
    // Use AI to detect if this is an answer to any of the asked questions
    if (!canMakeCall("combined")) return;
    
    try {
      const questionsInfo = recentAsked.map(q => {
        const data = JSON.parse(q.value);
        return { key: q.key, question: data.question };
      });
      
      const sanitizedMessage = sanitizeForAI(userMessage, 500);
      const persona = isOwner ? "Ulysse" : isExternal ? "Alfred" : "Iris";
      
      const detectionPrompt = `${persona} a récemment posé ces questions de curiosité à l'utilisateur:
${questionsInfo.map(q => `- [${q.key}] "${q.question}"`).join("\n")}

Message de l'utilisateur: "${sanitizedMessage}"

Ce message répond-il à l'une de ces questions? Si oui, extrais la réponse.

Retourne JSON:
{
  "isAnswer": true/false,
  "questionKey": "clé de la question si réponse, sinon null",
  "extractedAnswer": "résumé de la réponse en 1-2 phrases, ou null"
}`;

      const response = await withRateLimit("combined", () => 
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: detectionPrompt }],
          response_format: { type: "json_object" },
          max_tokens: 200
        }),
        1
      );

      const content = response.choices[0]?.message?.content;
      if (!content) return;

      const result = JSON.parse(content);
      if (result.isAnswer && result.questionKey && result.extractedAnswer) {
        await this.recordCuriosityAnswer(userId, result.questionKey, result.extractedAnswer);
        emitMemoryUpdated(userId);
      }
    } catch (error) {
      console.error("[Curiosity] Error detecting answer:", error);
    }
  }
}

export const memoryService = new MemoryService();
