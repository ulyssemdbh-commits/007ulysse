import { devopsIntelligenceEngine, recordFileEvent } from "./devopsIntelligenceEngine";
import { db } from "../db";
import { ulysseHomework, devopsFileHistory } from "@shared/schema";
import { sql, desc, eq } from "drizzle-orm";

export interface LearningAction {
  type: "homework_created" | "knowledge_added" | "gap_detected" | "fragility_updated";
  detail: string;
}

export async function processBugAndLearn(userId: number, files: string[], description: string, commitSha?: string): Promise<{
  eventsRecorded: number;
  gapsFound: number;
  homeworksCreated: number;
  actions: LearningAction[];
}> {
  const actions: LearningAction[] = [];

  const eventsRecorded = await recordFileEvent(files.map(f => ({
    filePath: f,
    eventType: "bug_report",
    eventResult: "bug" as const,
    commitSha: commitSha || undefined,
    description,
    userId,
  })));
  actions.push({ type: "fragility_updated", detail: `${eventsRecorded} fichier(s) marqué(s) comme bug` });

  let gapsFound = 0;
  let homeworksCreated = 0;

  try {
    const gaps = await devopsIntelligenceEngine.analyzeLearningGaps(userId);
    gapsFound = gaps.length;

    for (const gap of gaps.filter(g => g.severity === "critical" || g.severity === "important")) {
      actions.push({ type: "gap_detected", detail: `[${gap.domain}] ${gap.topic}: ${gap.evidence}` });

      try {
        const existing = await db.execute(
          sql`SELECT id FROM ulysse_homework WHERE user_id = ${userId} AND title LIKE ${'%' + gap.topic.slice(0, 30) + '%'} AND status != 'completed' AND status != 'cancelled' LIMIT 1`
        );
        const existingRows = (existing as any).rows || existing || [];
        if (existingRows.length > 0) continue;

        const isRecurring = gap.severity === "critical";
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + (gap.severity === "critical" ? 1 : 7));

        await db.insert(ulysseHomework).values({
          userId,
          title: `[DevOps Auto] ${gap.topic}`,
          description: `${gap.evidence}\n\nAction suggérée: ${gap.suggestedAction}${gap.homeworkSuggestion ? `\n\nHomework: ${gap.homeworkSuggestion.title} (${gap.homeworkSuggestion.type})` : ""}`,
          priority: gap.severity === "critical" ? "high" : "medium",
          recurrence: isRecurring ? "weekly" : "none",
          status: "pending",
          dueDate,
        });
        homeworksCreated++;
        actions.push({ type: "homework_created", detail: `Homework: "${gap.topic}" (${gap.severity}, due ${dueDate.toLocaleDateString("fr-FR")})` });
      } catch (err: any) {
        console.error(`[DevOpsLearning] Homework creation error: ${err.message}`);
      }
    }
  } catch (err: any) {
    console.error(`[DevOpsLearning] Gap analysis error: ${err.message}`);
  }

  try {
    const { brainService } = await import("./brainService");
    await brainService.addKnowledge(userId, {
      title: `Bug détecté: ${description.slice(0, 80)}`,
      content: `Fichiers: ${files.join(", ")}\nGaps: ${gapsFound}\nHomeworks créés: ${homeworksCreated}`,
      type: "fact",
      category: "technical",
      importance: 75,
      confidence: 90,
    });
    actions.push({ type: "knowledge_added", detail: `Bug enregistré dans Brain` });
  } catch {}

  console.log(`[DevOpsLearning] Bug processed: ${eventsRecorded} events, ${gapsFound} gaps, ${homeworksCreated} homeworks`);
  return { eventsRecorded, gapsFound, homeworksCreated, actions };
}

export async function processRevert(userId: number, files: string[], commitSha: string, reason: string): Promise<LearningAction[]> {
  const actions: LearningAction[] = [];

  await recordFileEvent(files.map(f => ({
    filePath: f,
    eventType: "revert",
    eventResult: "revert" as const,
    commitSha,
    description: reason,
    userId,
  })));
  actions.push({ type: "fragility_updated", detail: `${files.length} fichier(s) marqué(s) comme revert` });

  const result = await processBugAndLearn(userId, files, `Revert: ${reason}`, commitSha);
  actions.push(...result.actions);

  return actions;
}

export async function processHotfix(userId: number, files: string[], commitSha: string, description: string): Promise<LearningAction[]> {
  const actions: LearningAction[] = [];

  await recordFileEvent(files.map(f => ({
    filePath: f,
    eventType: "hotfix",
    eventResult: "hotfix" as const,
    commitSha,
    description,
    userId,
  })));
  actions.push({ type: "fragility_updated", detail: `${files.length} fichier(s) marqué(s) comme hotfix` });

  return actions;
}

export async function onHomeworkCompleted(userId: number, homeworkTitle: string, relatedFiles: string[]): Promise<void> {
  if (!relatedFiles.length) return;

  try {
    await recordFileEvent(relatedFiles.map(f => ({
      filePath: f,
      eventType: "review",
      eventResult: "success" as const,
      description: `Homework completed: ${homeworkTitle}`,
      userId,
    })));

    const { brainService } = await import("./brainService");
    await brainService.addKnowledge(userId, {
      title: `Homework terminé: ${homeworkTitle}`,
      content: `Fichiers stabilisés: ${relatedFiles.join(", ")}`,
      type: "fact",
      category: "technical",
      importance: 60,
      confidence: 85,
    });
  } catch (err: any) {
    console.error(`[DevOpsLearning] Homework completion record error: ${err.message}`);
  }
}

export async function getRecentIncidents(limit = 20): Promise<any[]> {
  try {
    const result: any = await db.execute(sql`
      SELECT file_path, event_type, event_result, risk_score, lines_changed, commit_sha, domains, description, created_at
      FROM devops_file_history
      WHERE event_result IN ('bug', 'revert', 'hotfix', 'failure')
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    return (result.rows || result || []);
  } catch {
    return [];
  }
}

export const devopsLearningService = {
  processBugAndLearn,
  processRevert,
  processHotfix,
  onHomeworkCompleted,
  getRecentIncidents,
};
