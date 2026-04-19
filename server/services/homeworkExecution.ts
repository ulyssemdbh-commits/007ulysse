import { db } from "../db";
import {
  ulysseHomework,
  homeworkExecution,
  type UlysseHomework,
  type HomeworkExecution,
} from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { canMakeCall } from "./rateLimiter";
import { homeworkIntelligence } from "./homeworkIntelligence";
import { traceCollector } from "./traceCollector";
import { memoryGraphService } from "./memoryGraphService";
import { type HomeworkTargetType } from "./homework/targetClassifier";
import { routeHomeworkUrls } from "./homework/dispatcher";
import {
  executeSportMultiUrlFetchTask,
} from "./homework/sportPipeline";
import { executeMultiTargetFetchTask } from "./homework/multiTarget";
import { executeResearchTask, executeGenericTask } from "./homework/genericPipeline";
import { getPersonaInfo } from "./homework/persona";

export class HomeworkExecutionService {
  async executeHomework(
    userId: number,
    homework: UlysseHomework,
    triggeredBy: "auto" | "manual" | "daily" = "auto",
  ): Promise<HomeworkExecution | null> {
    try {
      const urgency = await homeworkIntelligence.detectUrgency(homework);
      console.log(
        `[HomeworkExecution] Starting execution for homework ${homework.id}: "${homework.title}" (urgency: ${urgency})`,
      );

      const traceId = traceCollector.startTrace({
        userId,
        agent: "ulysse",
        model: "auto",
        query: `[Devoir] ${homework.title}`,
        domain: "homework",
        source: `homework_${triggeredBy}`,
      });

      const [execution] = await db
        .insert(homeworkExecution)
        .values({
          homeworkId: homework.id,
          userId,
          triggeredBy,
          status: "running",
        })
        .returning();

      homeworkIntelligence.startExecution(execution.id);

      await db
        .update(ulysseHomework)
        .set({ status: "in_progress" })
        .where(and(eq(ulysseHomework.id, homework.id), eq(ulysseHomework.userId, userId)));

      try {
        const startTime = Date.now();
        const result = await this.performTask(userId, homework);
        const durationMs = Date.now() - startTime;

        const [completed] = await db
          .update(homeworkExecution)
          .set({
            status: "completed",
            completedAt: new Date(),
            resultSummary: result.summary,
            artifacts: result.artifacts,
          })
          .where(eq(homeworkExecution.id, execution.id))
          .returning();

        await homeworkIntelligence.endExecution(execution.id, true);

        const taskType = this.detectTaskTypeFromHomework(homework);
        const persona = await getPersonaInfo(userId);
        await homeworkIntelligence.updatePromptScore(homework, taskType, persona.name, true, {
          responseLength: result.summary?.length || 0,
          hasStructure: result.summary?.includes("\n") || false,
          completedFast: durationMs < 30000,
        });

        const newStatus = homework.recurrence && homework.recurrence !== "none" ? "pending" : "completed";

        await db
          .update(ulysseHomework)
          .set({
            status: newStatus,
            lastExecutedAt: new Date(),
            notes: result.summary?.substring(0, 10000) || homework.notes,
          })
          .where(and(eq(ulysseHomework.id, homework.id), eq(ulysseHomework.userId, userId)));

        traceCollector
          .endTrace(traceId, {
            response: result.summary?.slice(0, 5000),
            status: "completed",
            metadata: { homeworkId: homework.id, executionId: execution.id, durationMs, triggeredBy },
          })
          .catch(() => {});

        try {
          interface HomeworkArtifactsShape {
            targetType?: HomeworkTargetType;
            targetTypes?: HomeworkTargetType[];
            url?: string;
            urls?: string[];
            confidence?: number;
          }
          const artifacts: HomeworkArtifactsShape = (result.artifacts as HomeworkArtifactsShape | undefined) ?? {};
          const firstType = Array.isArray(artifacts.targetTypes) ? artifacts.targetTypes[0] : undefined;
          const targetType: HomeworkTargetType = artifacts.targetType ?? firstType ?? "unknown";
          const url: string | undefined = artifacts.url ?? (Array.isArray(artifacts.urls) ? artifacts.urls[0] : undefined);
          const confidence = typeof artifacts.confidence === "number" ? Math.round(artifacts.confidence * 100) : 60;
          const shortSummary = (result.summary || homework.title).slice(0, 800);
          await memoryGraphService.recordObservation({
            userId,
            kind: "homework_result",
            summary: `[${targetType}] ${homework.title} → ${shortSummary}`,
            confidence,
            source: `homework:${homework.id}:${triggeredBy}`,
            payload: {
              homeworkId: homework.id,
              executionId: execution.id,
              targetType,
              url,
              durationMs,
              triggeredBy,
              recordedAt: Date.now(),
            },
          });
        } catch (memErr) {
          console.warn(`[HomeworkExecution] memoryGraph recordObservation failed:`, memErr);
        }

        console.log(`[HomeworkExecution] Completed homework ${homework.id} in ${durationMs}ms`);
        return completed;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[HomeworkExecution] Failed homework ${homework.id}:`, errorMessage);

        await homeworkIntelligence.endExecution(execution.id, false);
        await homeworkIntelligence.recordFailure(homework, error instanceof Error ? error : errorMessage, execution);

        const taskType = this.detectTaskTypeFromHomework(homework);
        const persona = await getPersonaInfo(userId);
        await homeworkIntelligence.updatePromptScore(homework, taskType, persona.name, false, {
          responseLength: 0,
          hasStructure: false,
          completedFast: false,
        });

        await db
          .update(homeworkExecution)
          .set({
            status: "failed",
            completedAt: new Date(),
            error: errorMessage,
          })
          .where(eq(homeworkExecution.id, execution.id));

        await db
          .update(ulysseHomework)
          .set({ status: "pending" })
          .where(and(eq(ulysseHomework.id, homework.id), eq(ulysseHomework.userId, userId)));

        traceCollector
          .endTrace(traceId, {
            status: "error",
            errorMessage,
            metadata: { homeworkId: homework.id, executionId: execution.id, triggeredBy },
          })
          .catch(() => {});

        return null;
      }
    } catch (error) {
      console.error(`[HomeworkExecution] Error creating execution record:`, error);
      return null;
    }
  }

  private detectTaskTypeFromHomework(homework: UlysseHomework): "research" | "url_fetch" | "generic" {
    const content = `${homework.title} ${homework.description || ""}`.toLowerCase();
    if (content.includes("http") || content.includes("www") || content.includes(".com")) return "url_fetch";
    if (content.includes("recherche") || content.includes("cherche") || content.includes("trouve")) return "research";
    return "generic";
  }

  private async performTask(userId: number, homework: UlysseHomework): Promise<{ summary: string; artifacts: any }> {
    const taskContent = `${homework.title}\n${homework.description || ""}`;
    const taskContentLower = taskContent.toLowerCase();
    const persona = await getPersonaInfo(userId);

    const detectedUrls = this.detectUrls(taskContent);
    if (detectedUrls.length > 0) {
      console.log(`[HomeworkExecution] Processing ${detectedUrls.length} URL(s)`);

      const route = routeHomeworkUrls(detectedUrls, taskContent);
      if (route.mode === "multi-target") {
        console.log(
          `[HomeworkExecution] 🎯 Non-sport target(s) detected: ${route.classified
            .map((c) => `${c.classification.type}@${c.url}`)
            .join(", ")}`,
        );
        return await executeMultiTargetFetchTask(userId, homework, route.classified, persona.name);
      }

      if (canMakeCall("combined")) {
        return await executeSportMultiUrlFetchTask(userId, homework, detectedUrls, persona.name);
      }
      console.warn(`[HomeworkExecution] Sport pipeline rate-limited; emitting factual no-op summary.`);
      return {
        summary: `Tâche sportive en attente: quota d'appels combinés atteint. Réessai au prochain cycle.`,
        artifacts: { urls: detectedUrls, targetType: "sports_betting" as HomeworkTargetType, rateLimited: true },
      };
    }

    const taskType = this.detectTaskType(taskContentLower);
    if (taskType.needsWebSearch && canMakeCall("combined")) {
      return await executeResearchTask(userId, homework, taskType.searchQuery, persona.name);
    }

    return await executeGenericTask(userId, homework, persona.name, persona.userName);
  }

  private detectUrls(content: string): string[] {
    let cleaned = content
      .replace(/(https?:\/\/[^\s\n]*-)[\r\n]+([a-zA-Z0-9])/gi, "$1$2")
      .replace(/(https?:\/\/[^\s\n]*\/)[\r\n]+([a-zA-Z0-9])/gi, "$1$2");

    const urlPattern = /(?:https?:\/\/)?(?:www\.)?(?:[a-zA-Z0-9][-a-zA-Z0-9]*\.)+[a-zA-Z]{2,}(?:\/[^\s\n)]*)?/gi;
    const matches = cleaned.match(urlPattern);
    if (!matches || matches.length === 0) return [];

    const seen = new Set<string>();
    const uniqueUrls: string[] = [];
    for (let url of matches) {
      url = url.replace(/[),;.]+$/, "");
      if (!url.startsWith("http")) url = `https://${url}`;
      if (!seen.has(url)) {
        seen.add(url);
        uniqueUrls.push(url);
      }
    }
    console.log(`[HomeworkExecution] Detected ${uniqueUrls.length} unique URL(s):`, uniqueUrls);
    return uniqueUrls;
  }

  private detectTaskType(content: string): { needsWebSearch: boolean; searchQuery: string } {
    const searchKeywords = [
      "recherche", "cherche", "trouve", "infos", "information", "actualité", "news", "presse",
      "article", "consulte", "vérifie", "analyse", "compare", "liste", "prix", "météo",
      "horaire", "adresse", "contact", "site",
    ];
    const needsWebSearch = searchKeywords.some((k) => content.includes(k));
    const searchQuery = content
      .replace(/consulte|recherche|cherche|trouve|vérifie/gi, "")
      .trim()
      .substring(0, 100);
    return { needsWebSearch, searchQuery };
  }

  async cleanupOrphanedExecutions(): Promise<number> {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const orphaned = await db
        .update(homeworkExecution)
        .set({
          status: "failed",
          completedAt: new Date(),
          error: "Execution timed out (orphaned from server restart)",
        })
        .where(
          and(
            eq(homeworkExecution.status, "running"),
            sql`${homeworkExecution.startedAt} < ${oneHourAgo.toISOString()}`,
          ),
        )
        .returning();

      if (orphaned.length > 0) {
        console.log(`[HomeworkExecution] Cleaned up ${orphaned.length} orphaned executions`);
        const homeworkIds = Array.from(new Set(orphaned.map((e) => e.homeworkId)));
        for (const hId of homeworkIds) {
          await db
            .update(ulysseHomework)
            .set({ status: "pending" })
            .where(and(eq(ulysseHomework.id, hId), eq(ulysseHomework.status, "in_progress")));
        }
      }
      return orphaned.length;
    } catch (error) {
      console.error(`[HomeworkExecution] Cleanup error:`, error);
      return 0;
    }
  }

  async executeDailyTasks(userId: number): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tasks = await db
      .select()
      .from(ulysseHomework)
      .where(
        and(
          eq(ulysseHomework.userId, userId),
          eq(ulysseHomework.status, "pending"),
          sql`${ulysseHomework.recurrence} != 'none'`,
        ),
      );

    let executedCount = 0;

    for (const task of tasks) {
      const lastExecuted = task.lastExecutedAt ? new Date(task.lastExecutedAt) : null;

      if (lastExecuted) {
        lastExecuted.setHours(0, 0, 0, 0);
        if (lastExecuted.getTime() >= today.getTime()) continue;
      }

      const shouldExecute = this.shouldExecuteRecurringTask(task, today, lastExecuted);
      if (!shouldExecute) continue;

      const conditions = {
        timeWindow: { start: 6, end: 23 },
        maxRetries: 5,
        minIntervalHours: 12,
      };
      const check = await homeworkIntelligence.shouldExecuteNow(task, conditions);
      if (!check.execute) {
        console.log(`[HomeworkExecution] Skipping daily task ${task.id}: ${check.reason}`);
        continue;
      }

      const result = await this.executeHomework(userId, task, "daily");
      if (result) executedCount++;
    }

    console.log(`[HomeworkExecution] Executed ${executedCount} daily tasks for user ${userId}`);
    return executedCount;
  }

  private shouldExecuteRecurringTask(task: UlysseHomework, today: Date, lastExecuted: Date | null): boolean {
    if (!lastExecuted) return true;
    const days = Math.floor((today.getTime() - lastExecuted.getTime()) / (1000 * 60 * 60 * 24));
    switch (task.recurrence) {
      case "daily":
        return days >= 1;
      case "weekly":
        return days >= 7;
      case "monthly":
        return days >= 30;
      case "yearly":
        return days >= 365;
      default:
        return false;
    }
  }

  async getExecutionHistory(userId: number, homeworkId?: number, limit: number = 10): Promise<HomeworkExecution[]> {
    if (homeworkId) {
      return db
        .select()
        .from(homeworkExecution)
        .where(and(eq(homeworkExecution.userId, userId), eq(homeworkExecution.homeworkId, homeworkId)))
        .orderBy(sql`${homeworkExecution.startedAt} DESC`)
        .limit(limit);
    }
    return db
      .select()
      .from(homeworkExecution)
      .where(eq(homeworkExecution.userId, userId))
      .orderBy(sql`${homeworkExecution.startedAt} DESC`)
      .limit(limit);
  }
}

export const homeworkExecutionService = new HomeworkExecutionService();
