import type { UlysseHomework } from "@shared/schema";
import { type HomeworkTargetType } from "./targetClassifier";
import {
  extractGithubRepo,
  extractWebArticle,
  extractPdf,
  extractNotionPage,
  unknownTargetResult,
  type ExtractorResult,
} from "./extractors";
import { executeSportUrlFetchTask } from "./sportPipeline";

export async function executeMultiTargetFetchTask(
  userId: number,
  homework: UlysseHomework,
  classified: { url: string; classification: { type: HomeworkTargetType; confidence: number; reason: string } }[],
  personaName: string = "Ulysse",
): Promise<{ summary: string; artifacts: any }> {
  const taskHint = `${homework.title}\n${homework.description || ""}`.trim();

  const perUrl: Array<{
    url: string;
    type: HomeworkTargetType;
    result: ExtractorResult;
  }> = [];

  for (const { url, classification } of classified) {
    let result: ExtractorResult;
    try {
      switch (classification.type) {
        case "github_repo":
          result = await extractGithubRepo(url);
          break;
        case "web_article":
          result = await extractWebArticle(url, taskHint);
          break;
        case "pdf":
          result = await extractPdf(url, taskHint);
          break;
        case "notion":
          result = await extractNotionPage(url, taskHint);
          break;
        case "sports_betting":
        case "sports_ranking": {
          const legacy = await executeSportUrlFetchTask(userId, homework, url, personaName);
          result = {
            ok: true,
            summary: legacy.summary,
            artifacts: { ...(legacy.artifacts || {}), targetType: classification.type },
            confidence: 0.7,
          };
          break;
        }
        default:
          result = unknownTargetResult(url);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      result = {
        ok: false,
        summary: `Erreur d'extraction (${classification.type}) pour ${url}: ${msg}`,
        artifacts: { url, targetType: classification.type },
        confidence: 0,
        error: msg,
      };
    }
    perUrl.push({ url, type: classification.type, result });
  }

  const okCount = perUrl.filter((p) => p.result.ok).length;

  let summary = "";
  if (perUrl.length === 1) {
    summary = perUrl[0].result.summary;
  } else {
    summary = perUrl.map((p, i) => `\n---\n## SOURCE ${i + 1} — ${p.type}\n${p.result.summary}`).join("\n");
  }

  summary +=
    `\n\n---\n**Sources traitées (${okCount}/${perUrl.length}) — types détectés:** ` +
    perUrl.map((p) => `${p.type}${p.result.ok ? "" : "❌"}`).join(", ");

  return {
    summary,
    artifacts: {
      urls: classified.map((c) => c.url),
      targetTypes: perUrl.map((p) => p.type),
      successCount: okCount,
      totalUrls: perUrl.length,
      sources: perUrl.map((p) => ({
        url: p.url,
        targetType: p.type,
        ok: p.result.ok,
        confidence: p.result.confidence,
        ...(p.result.artifacts || {}),
      })),
      processed: true,
      confidence: perUrl.length > 0 ? perUrl.reduce((s, p) => s + p.result.confidence, 0) / perUrl.length : 0,
    },
  };
}
