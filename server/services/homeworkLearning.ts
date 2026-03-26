import { db } from "../db";
import { ulysseMemory, type UlysseHomework } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import OpenAI from "openai";
import { canMakeCall, withRateLimit } from "./rateLimiter";
import { memoryService } from "./memory";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export class HomeworkLearningService {
  async learnFromCompletion(userId: number, homework: UlysseHomework): Promise<void> {
    try {
      const content = this.buildHomeworkContent(homework);
      
      if (content.length < 10) {
        console.log(`[HomeworkLearning] Skipping homework ${homework.id}: insufficient content`);
        return;
      }

      if (canMakeCall("combined") && this.shouldUseAI(homework)) {
        await this.extractWithAI(userId, homework, content);
      } else {
        await this.extractDeterministic(userId, homework, content);
      }

      console.log(`[HomeworkLearning] Successfully learned from homework ${homework.id}: "${homework.title}"`);
    } catch (error) {
      console.error(`[HomeworkLearning] Error learning from homework ${homework.id}:`, error);
    }
  }

  private buildHomeworkContent(homework: UlysseHomework): string {
    const parts: string[] = [];
    parts.push(`Tâche: ${homework.title}`);
    if (homework.description) {
      parts.push(`Description: ${homework.description}`);
    }
    if (homework.notes) {
      parts.push(`Notes: ${homework.notes}`);
    }
    if (homework.recurrence && homework.recurrence !== "none") {
      parts.push(`Récurrence: ${homework.recurrence}`);
    }
    return parts.join("\n");
  }

  private shouldUseAI(homework: UlysseHomework): boolean {
    const contentLength = (homework.title?.length || 0) + 
                         (homework.description?.length || 0) + 
                         (homework.notes?.length || 0);
    return contentLength > 50;
  }

  private async extractWithAI(userId: number, homework: UlysseHomework, content: string): Promise<void> {
    try {
      const response = await withRateLimit("combined", () =>
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `Tu es Ulysse, l'assistant personnel de Maurice. Analyse cette tâche complétée et extrais les informations importantes à retenir pour améliorer tes connaissances et mieux assister Maurice à l'avenir.

Retourne un JSON avec:
{
  "summary": "résumé concis de ce qui a été appris/accompli (max 200 chars)",
  "insights": ["point clé 1", "point clé 2"],
  "category": "skill|interest|project|task|preference|knowledge",
  "importance": "low|medium|high"
}`
            },
            {
              role: "user",
              content: content
            }
          ],
          temperature: 0.3,
          max_tokens: 300,
          response_format: { type: "json_object" }
        }),
        0
      );

      let result: any = {};
      try { result = JSON.parse(response.choices[0].message.content || "{}"); } catch { console.warn("[HomeworkLearning] Failed to parse AI response"); }
      
      // Use MemoryService for consistent handling (handles deduplication and confidence boost)
      await memoryService.updateOrCreateMemory(
        userId,
        "homework",
        `homework_${homework.id}`,
        result.summary || homework.title,
        `homework:${homework.id}:${homework.title.substring(0, 30)}`
      );

      // Update/create insight memories
      if (result.insights && result.insights.length > 0) {
        for (let i = 0; i < Math.min(result.insights.length, 3); i++) {
          await memoryService.updateOrCreateMemory(
            userId,
            result.category || "knowledge",
            `homework_insight_${homework.id}_${i}`,
            result.insights[i],
            `homework:${homework.id}`
          );
        }
      }
    } catch (error) {
      console.error("[HomeworkLearning] AI extraction failed, falling back to deterministic:", error);
      await this.extractDeterministic(userId, homework, content);
    }
  }

  private async extractDeterministic(userId: number, homework: UlysseHomework, content: string): Promise<void> {
    let summary = homework.title;
    if (homework.description && homework.description.length < 150) {
      summary = `${homework.title} - ${homework.description}`;
    }
    
    // Use MemoryService for consistent handling
    await memoryService.updateOrCreateMemory(
      userId,
      "homework",
      `homework_${homework.id}`,
      summary.substring(0, 250),
      `homework:${homework.id}:${homework.title.substring(0, 30)}`
    );

    // Always update notes memory if present (allows enrichment on re-completion)
    if (homework.notes && homework.notes.length > 10) {
      await memoryService.updateOrCreateMemory(
        userId,
        "knowledge",
        `homework_notes_${homework.id}`,
        homework.notes.substring(0, 250),
        `homework:${homework.id}:notes`
      );
    }
  }

  async getHomeworkMemories(userId: number): Promise<{ category: string; key: string; value: string; confidence: number }[]> {
    const memories = await db.select({
      category: ulysseMemory.category,
      key: ulysseMemory.key,
      value: ulysseMemory.value,
      confidence: ulysseMemory.confidence
    })
    .from(ulysseMemory)
    .where(and(
      eq(ulysseMemory.userId, userId),
      eq(ulysseMemory.category, "homework")
    ));
    
    return memories;
  }
}

export const homeworkLearningService = new HomeworkLearningService();
