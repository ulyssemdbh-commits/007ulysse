import { db } from "../db";
import { 
  knowledgeBase, knowledgeGraph, learningLog, ulysseMemory, 
  webSearchMemory, projectMemory, InsertKnowledgeBase, InsertKnowledgeGraph
} from "@shared/schema";
import { eq, desc, and, isNull, sql, ne } from "drizzle-orm";
import { brainService } from "./brainService";
import { globalOptimizerService } from "./globalOptimizerService";

interface SyncResult {
  migrated: number;
  connections: number;
  errors: number;
  details: string[];
}

class BrainSyncService {
  
  private categoryMapping: Record<string, { type: string; category: string; importance: number }> = {
    personality: { type: "fact", category: "personal", importance: 80 },
    preference: { type: "fact", category: "personal", importance: 70 },
    skill: { type: "concept", category: "technical", importance: 75 },
    interest: { type: "fact", category: "personal", importance: 60 },
    habit: { type: "fact", category: "personal", importance: 65 },
    fact: { type: "fact", category: "reference", importance: 50 },
    homework: { type: "fact", category: "work", importance: 55 },
    knowledge: { type: "concept", category: "learning", importance: 70 },
    project: { type: "concept", category: "work", importance: 75 },
    context: { type: "fact", category: "reference", importance: 40 },
    files: { type: "fact", category: "reference", importance: 30 },
  };

  async migrateMemoriesToBrain(userId: number): Promise<SyncResult> {
    const result: SyncResult = { migrated: 0, connections: 0, errors: 0, details: [] };
    
    try {
      const memories = await db.select().from(ulysseMemory)
        .where(eq(ulysseMemory.userId, userId));
      
      console.log(`[BrainSync] Found ${memories.length} memories to migrate for user ${userId}`);
      
      const existingKnowledge = await db.select({ title: knowledgeBase.title })
        .from(knowledgeBase)
        .where(eq(knowledgeBase.userId, userId));
      const existingTitles = new Set(existingKnowledge.map(k => k.title.toLowerCase()));
      
      let skippedWeak = 0;
      for (const memory of memories) {
        try {
          const normalizedKey = memory.key.toLowerCase().trim();
          if (existingTitles.has(normalizedKey)) {
            continue;
          }
          
          if (memory.value.length < 10) {
            skippedWeak++;
            continue;
          }
          
          if (memory.category === 'context' && memory.value.length < 50) {
            skippedWeak++;
            continue;
          }
          
          const mapping = this.categoryMapping[memory.category];
          if (!mapping) {
            console.log(`[BrainSync] Unknown category fallback: "${memory.category}" for memory "${memory.key}"`);
          }
          const finalMapping = mapping || { type: "fact", category: "reference", importance: 50 };
          
          const knowledgeData: Omit<InsertKnowledgeBase, 'userId'> = {
            title: memory.key,
            content: memory.value,
            summary: memory.value.length > 200 ? memory.value.substring(0, 200) + "..." : memory.value,
            type: finalMapping.type,
            category: finalMapping.category,
            subcategory: memory.category,
            tags: [...this.extractTags(memory.key, memory.value, memory.category), `year:${new Date().getFullYear()}`],
            source: memory.source || "ai_memory migration",
            sourceType: "conversation",
            importance: finalMapping.importance,
            confidence: 80,
          };
          
          await brainService.addKnowledge(userId, knowledgeData);
          existingTitles.add(normalizedKey);
          result.migrated++;
          
        } catch (err) {
          console.error(`[BrainSync] Error migrating memory ${memory.id}:`, err);
          result.errors++;
        }
      }
      
      result.details.push(`Migrated ${result.migrated} memories to Brain System (${skippedWeak} weak entries skipped)`);
      console.log(`[BrainSync] Migration complete: ${result.migrated} migrated, ${skippedWeak} skipped (weak), ${result.errors} errors`);
      
    } catch (error) {
      console.error("[BrainSync] Migration error:", error);
      result.errors++;
      result.details.push(`Migration error: ${error}`);
    }
    
    return result;
  }

  async syncWebSearchesToBrain(userId: number): Promise<SyncResult> {
    const result: SyncResult = { migrated: 0, connections: 0, errors: 0, details: [] };
    
    try {
      const searches = await db.select().from(webSearchMemory)
        .where(eq(webSearchMemory.userId, userId))
        .orderBy(desc(webSearchMemory.createdAt))
        .limit(100);
      
      console.log(`[BrainSync] Found ${searches.length} web searches to sync for user ${userId}`);
      
      const existingKnowledge = await db.select({ sourceUrl: knowledgeBase.sourceUrl })
        .from(knowledgeBase)
        .where(and(
          eq(knowledgeBase.userId, userId),
          eq(knowledgeBase.sourceType, "web_search")
        ));
      const existingUrls = new Set(existingKnowledge.map(k => k.sourceUrl).filter(Boolean));
      
      let skippedWeak = 0;
      for (const search of searches) {
        try {
          const searchId = `mars_search_${search.id}`;
          if (existingUrls.has(searchId)) {
            continue;
          }
          
          const keyFindings = search.keyFindings as string[] || [];
          
          if (keyFindings.length === 0 && !search.learnedInsights) {
            skippedWeak++;
            continue;
          }
          const content = `Recherche: "${search.query}"
          
Topic: ${search.topic || "Non classifié"}

Résultats clés:
${keyFindings.map((f, i) => `${i + 1}. ${f}`).join("\n")}

${search.learnedInsights ? `Apprentissage: ${search.learnedInsights}` : ""}`;

          const knowledgeData: Omit<InsertKnowledgeBase, 'userId'> = {
            title: search.topic || search.query,
            content: content,
            summary: search.learnedInsights || keyFindings[0] || search.query,
            type: "fact",
            category: "learning",
            subcategory: "web_research",
            tags: [...this.extractTags(search.query, content, "research"), "web", `year:${new Date().getFullYear()}`],
            source: "MARS Web Search",
            sourceUrl: searchId,
            sourceType: "web_search",
            importance: 60,
            confidence: 70,
          };
          
          await brainService.addKnowledge(userId, knowledgeData);
          existingUrls.add(searchId);
          result.migrated++;
          
        } catch (err) {
          console.error(`[BrainSync] Error syncing search ${search.id}:`, err);
          result.errors++;
        }
      }
      
      result.details.push(`Synced ${result.migrated} web searches to Brain System (${skippedWeak} weak entries skipped)`);
      console.log(`[BrainSync] Web search sync: ${result.migrated} synced, ${skippedWeak} skipped (weak)`);
      
    } catch (error) {
      console.error("[BrainSync] Web search sync error:", error);
      result.errors++;
    }
    
    return result;
  }

  async syncProjectsToBrain(userId: number): Promise<SyncResult> {
    const result: SyncResult = { migrated: 0, connections: 0, errors: 0, details: [] };
    
    try {
      const projects = await db.select().from(projectMemory)
        .where(eq(projectMemory.userId, userId));
      
      console.log(`[BrainSync] Found ${projects.length} projects to sync for user ${userId}`);
      
      const existingKnowledge = await db.select({ title: knowledgeBase.title })
        .from(knowledgeBase)
        .where(and(
          eq(knowledgeBase.userId, userId),
          eq(knowledgeBase.category, "work"),
          eq(knowledgeBase.subcategory, "project")
        ));
      const existingTitles = new Set(existingKnowledge.map(k => k.title.toLowerCase()));
      
      for (const project of projects) {
        try {
          const projectTitle = `Projet: ${project.projectName}`;
          if (existingTitles.has(projectTitle.toLowerCase())) {
            continue;
          }
          
          const techStack = project.techStack as string[] || [];
          const content = `Projet: ${project.projectName}

${project.summary || ""}

${techStack.length > 0 ? `Technologies: ${techStack.join(", ")}` : ""}

${project.context || ""}`;

          const knowledgeData: Omit<InsertKnowledgeBase, 'userId'> = {
            title: projectTitle,
            content: content,
            summary: project.summary || `Projet ${project.projectName}`,
            type: "concept",
            category: "work",
            subcategory: "project",
            tags: [...techStack, "projet", project.projectName.toLowerCase(), `year:${new Date().getFullYear()}`],
            source: "project_memory",
            sourceType: "conversation",
            importance: 75,
            confidence: 90,
          };
          
          await brainService.addKnowledge(userId, knowledgeData);
          existingTitles.add(projectTitle.toLowerCase());
          result.migrated++;
          
        } catch (err) {
          console.error(`[BrainSync] Error syncing project ${project.id}:`, err);
          result.errors++;
        }
      }
      
      result.details.push(`Synced ${result.migrated} projects to Brain System`);
      
    } catch (error) {
      console.error("[BrainSync] Project sync error:", error);
      result.errors++;
    }
    
    return result;
  }

  async buildKnowledgeConnections(userId: number): Promise<SyncResult> {
    const result: SyncResult = { migrated: 0, connections: 0, errors: 0, details: [] };
    
    try {
      const knowledge = await db.select().from(knowledgeBase)
        .where(eq(knowledgeBase.userId, userId))
        .orderBy(desc(knowledgeBase.importance));
      
      if (knowledge.length < 2) {
        result.details.push("Not enough knowledge entries to build connections");
        return result;
      }
      
      console.log(`[BrainSync] Building connections for ${knowledge.length} knowledge entries`);
      
      const existingConnections = await db.select({
        sourceId: knowledgeGraph.sourceId,
        targetId: knowledgeGraph.targetId
      }).from(knowledgeGraph).where(eq(knowledgeGraph.userId, userId));
      
      const existingPairs = new Set<string>();
      for (const c of existingConnections) {
        existingPairs.add(`${c.sourceId}-${c.targetId}`);
        existingPairs.add(`${c.targetId}-${c.sourceId}`);
      }
      
      const connectionsToInsert: {
        userId: number;
        sourceType: string;
        sourceId: number;
        sourceLabel: string;
        relationship: string;
        relationshipStrength: number;
        targetType: string;
        targetId: number;
        targetLabel: string;
        context: string;
        isInferred: boolean;
        confidence: number;
      }[] = [];
      
      const maxEntries = Math.min(knowledge.length, 50);
      for (let i = 0; i < maxEntries; i++) {
        for (let j = i + 1; j < maxEntries; j++) {
          const source = knowledge[i];
          const target = knowledge[j];
          
          const pairKey = `${source.id}-${target.id}`;
          if (existingPairs.has(pairKey)) {
            continue;
          }
          
          const connection = this.detectConnection(source, target);
          if (connection) {
            connectionsToInsert.push({
              userId,
              sourceType: "knowledge",
              sourceId: source.id,
              sourceLabel: source.title?.substring(0, 100) || "Unknown",
              relationship: connection.type,
              relationshipStrength: connection.strength,
              targetType: "knowledge",
              targetId: target.id,
              targetLabel: target.title?.substring(0, 100) || "Unknown",
              context: connection.context,
              isInferred: true,
              confidence: Math.min(connection.strength, 100),
            });
            existingPairs.add(pairKey);
            existingPairs.add(`${target.id}-${source.id}`);
          }
        }
      }
      
      const MAX_CONNECTIONS = 1000;
      if (connectionsToInsert.length > MAX_CONNECTIONS) {
        console.log(`[BrainSync] Hard cap applied: ${connectionsToInsert.length} -> ${MAX_CONNECTIONS} connections`);
        connectionsToInsert.length = MAX_CONNECTIONS;
      }
      
      if (connectionsToInsert.length > 0) {
        const batchSize = 50;
        for (let i = 0; i < connectionsToInsert.length; i += batchSize) {
          const batch = connectionsToInsert.slice(i, i + batchSize);
          try {
            await db.insert(knowledgeGraph).values(batch).onConflictDoNothing();
            result.connections += batch.length;
          } catch (err) {
            console.error(`[BrainSync] Batch insert error:`, err);
            result.errors += batch.length;
          }
        }
      }
      
      result.details.push(`Created ${result.connections} knowledge connections`);
      console.log(`[BrainSync] Built ${result.connections} connections`);
      
    } catch (error) {
      console.error("[BrainSync] Connection building error:", error);
      result.errors++;
    }
    
    return result;
  }

  private detectConnection(source: any, target: any): { type: string; strength: number; context: string } | null {
    const sourceTags = (source.tags || []) as string[];
    const targetTags = (target.tags || []) as string[];
    const sourceContent = `${source.title} ${source.content}`.toLowerCase();
    const targetContent = `${target.title} ${target.content}`.toLowerCase();
    
    const sourceImportance = source.importance || 50;
    const targetImportance = target.importance || 50;
    const importanceFactor = (sourceImportance + targetImportance) / 2;
    
    const applyImportanceWeight = (baseStrength: number): number => {
      return Math.round((baseStrength * 0.6) + (importanceFactor * 0.4));
    };
    
    const commonTags = sourceTags.filter(t => targetTags.includes(t));
    if (commonTags.length > 0) {
      const baseStrength = Math.min(100, commonTags.length * 30);
      return {
        type: "related_by_tag",
        strength: applyImportanceWeight(baseStrength),
        context: `Tags communs: ${commonTags.join(", ")} (importance: ${Math.round(importanceFactor)})`
      };
    }
    
    if (source.category === target.category) {
      const subcategoryMatch = source.subcategory === target.subcategory;
      const baseStrength = subcategoryMatch ? 70 : 40;
      return {
        type: subcategoryMatch ? "same_topic" : "same_category",
        strength: applyImportanceWeight(baseStrength),
        context: `Même catégorie: ${source.category}${subcategoryMatch ? ` / ${source.subcategory}` : ""} (importance: ${Math.round(importanceFactor)})`
      };
    }
    
    const sourceWords = new Set(sourceContent.split(/\s+/).filter((w: string) => w.length > 4));
    const targetWords = new Set(targetContent.split(/\s+/).filter((w: string) => w.length > 4));
    let commonWords = 0;
    sourceWords.forEach(word => {
      if (targetWords.has(word)) commonWords++;
    });
    
    if (commonWords >= 3) {
      const baseStrength = Math.min(80, commonWords * 10);
      return {
        type: "semantic_similarity",
        strength: applyImportanceWeight(baseStrength),
        context: `${commonWords} mots-clés communs (importance: ${Math.round(importanceFactor)})`
      };
    }
    
    return null;
  }

  private extractTags(key: string, value: string, category: string): string[] {
    const tags: string[] = [category];
    const text = `${key} ${value}`.toLowerCase();
    
    const techKeywords = ["javascript", "typescript", "react", "node", "python", "api", "database", "postgresql", "sql", "web", "mobile", "frontend", "backend"];
    const personalKeywords = ["famille", "ami", "sport", "musique", "voyage", "voiture", "maison", "santé"];
    const workKeywords = ["projet", "client", "entreprise", "business", "stratégie", "marketing"];
    
    for (const keyword of [...techKeywords, ...personalKeywords, ...workKeywords]) {
      if (text.includes(keyword)) {
        tags.push(keyword);
      }
    }
    
    return [...new Set(tags)].slice(0, 10);
  }

  async fullBrainSync(userId: number): Promise<SyncResult> {
    console.log(`[BrainSync] Starting full brain sync for user ${userId}`);
    
    const totalResult: SyncResult = { migrated: 0, connections: 0, errors: 0, details: [] };
    
    const memoryResult = await this.migrateMemoriesToBrain(userId);
    totalResult.migrated += memoryResult.migrated;
    totalResult.errors += memoryResult.errors;
    totalResult.details.push(...memoryResult.details);
    
    const searchResult = await this.syncWebSearchesToBrain(userId);
    totalResult.migrated += searchResult.migrated;
    totalResult.errors += searchResult.errors;
    totalResult.details.push(...searchResult.details);
    
    const projectResult = await this.syncProjectsToBrain(userId);
    totalResult.migrated += projectResult.migrated;
    totalResult.errors += projectResult.errors;
    totalResult.details.push(...projectResult.details);
    
    const screenResult = await this.syncScreenPatternsToBrain(userId);
    totalResult.migrated += screenResult.migrated;
    totalResult.errors += screenResult.errors;
    totalResult.details.push(...screenResult.details);
    
    const connectionResult = await this.buildKnowledgeConnections(userId);
    totalResult.connections = connectionResult.connections;
    totalResult.errors += connectionResult.errors;
    totalResult.details.push(...connectionResult.details);
    
    await brainService.updateStatistics(userId);
    
    try {
      const syncSummary = `BrainSync: ${totalResult.migrated} migrated, ${totalResult.connections} connections, ${totalResult.errors} errors`;
      await db.insert(learningLog).values({
        userId,
        timestamp: new Date(),
        actionType: "brain_sync",
        topic: "full_sync",
        content: syncSummary,
        learningType: "system_sync",
        sourceType: "brain_sync",
        sourceContext: JSON.stringify({
          migrated: totalResult.migrated,
          connections: totalResult.connections,
          errors: totalResult.errors,
          details: totalResult.details,
          timestamp: new Date().toISOString()
        }),
        confidence: totalResult.errors === 0 ? 100 : Math.max(0, 100 - (totalResult.errors * 10))
      });
    } catch (logErr) {
      console.error("[BrainSync] Failed to log sync result:", logErr);
    }
    
    console.log(`[BrainSync] Full sync complete: ${totalResult.migrated} migrated, ${totalResult.connections} connections, ${totalResult.errors} errors`);
    
    return totalResult;
  }

  async syncAllUsers(): Promise<{ userId: number; result: SyncResult }[]> {
    const results: { userId: number; result: SyncResult }[] = [];
    
    try {
      const userIds = await db.selectDistinct({ userId: ulysseMemory.userId })
        .from(ulysseMemory);
      
      for (const { userId } of userIds) {
        const result = await this.fullBrainSync(userId);
        results.push({ userId, result });
      }
    } catch (error) {
      console.error("[BrainSync] Error syncing all users:", error);
    }
    
    return results;
  }

  /**
   * Sync screen monitoring patterns to Brain knowledge base
   * Learns from user's work habits and application usage
   */
  async syncScreenPatternsToBrain(userId: number): Promise<SyncResult> {
    const result: SyncResult = { migrated: 0, connections: 0, errors: 0, details: [] };
    
    try {
      const { screenMonitorService } = await import("./screenMonitorService");
      const insights = await screenMonitorService.getInsightsForBrain(userId);
      
      if (!insights || insights.topApps.length === 0) {
        result.details.push("No screen patterns to sync");
        return result;
      }

      console.log(`[BrainSync] Syncing ${insights.topApps.length} screen patterns for user ${userId}`);

      for (const app of insights.topApps) {
        try {
          const title = `Utilisation de ${app.name}`;
          
          const existing = await db.select({ id: knowledgeBase.id })
            .from(knowledgeBase)
            .where(and(
              eq(knowledgeBase.userId, userId),
              eq(knowledgeBase.title, title)
            ))
            .limit(1);

          if (existing.length > 0) {
            await db.update(knowledgeBase)
              .set({
                content: `Application ${app.name} utilisée ${app.uses} fois avec une confiance de ${Math.round(app.confidence * 100)}%`,
                confidence: Math.round(app.confidence * 100),
                updatedAt: new Date()
              })
              .where(eq(knowledgeBase.id, existing[0].id));
          } else {
            const knowledgeData: Omit<InsertKnowledgeBase, 'userId'> = {
              title,
              content: `Application ${app.name} utilisée ${app.uses} fois avec une confiance de ${Math.round(app.confidence * 100)}%`,
              summary: `Habitude d'utilisation de ${app.name}`,
              type: "fact",
              category: "personal",
              subcategory: "work_habit",
              tags: ["screen_monitor", "app_usage", `year:${new Date().getFullYear()}`],
              source: "Screen Monitor",
              sourceType: "screen_monitor",
              importance: 50,
              confidence: Math.round(app.confidence * 100),
            };
            
            await brainService.addKnowledge(userId, knowledgeData);
            result.migrated++;
          }
        } catch (err) {
          console.error(`[BrainSync] Error syncing app ${app.name}:`, err);
          result.errors++;
        }
      }

      if (insights.activityTags.length > 0) {
        const activitySummary = insights.activityTags
          .map(t => `${t.tag}: ${t.count}`)
          .join(", ");
        
        const activityTitle = "Résumé des activités écran";
        
        const existingActivity = await db.select({ id: knowledgeBase.id })
          .from(knowledgeBase)
          .where(and(
            eq(knowledgeBase.userId, userId),
            eq(knowledgeBase.title, activityTitle)
          ))
          .limit(1);

        if (existingActivity.length > 0) {
          await db.update(knowledgeBase)
            .set({
              content: `Activités observées: ${activitySummary}. Total: ${insights.totalAnalyses} analyses.`,
              updatedAt: new Date()
            })
            .where(eq(knowledgeBase.id, existingActivity[0].id));
        } else {
          await brainService.addKnowledge(userId, {
            title: activityTitle,
            content: `Activités observées: ${activitySummary}. Total: ${insights.totalAnalyses} analyses.`,
            summary: "Résumé des activités utilisateur",
            type: "fact",
            category: "personal",
            subcategory: "activity_summary",
            tags: ["screen_monitor", "activity", `year:${new Date().getFullYear()}`],
            source: "Screen Monitor",
            sourceType: "screen_monitor",
            importance: 60,
            confidence: 80,
          });
          result.migrated++;
        }
      }

      result.details.push(`Synced ${result.migrated} screen patterns to Brain`);
      console.log(`[BrainSync] Screen pattern sync complete: ${result.migrated} synced`);
      
    } catch (error) {
      console.error("[BrainSync] Screen pattern sync error:", error);
      result.errors++;
      result.details.push(`Screen pattern sync error: ${error}`);
    }
    
    return result;
  }
}

export const brainSyncService = new BrainSyncService();
