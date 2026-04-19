import OpenAI from "openai";
import type { UlysseHomework } from "@shared/schema";
import { canMakeCall, withRateLimit } from "../rateLimiter";
import { searchWeb, formatSearchResultsForAI } from "../websearch";
import { memoryService } from "../memory";
import { generateOptimizedPrompt } from "./promptBuilder";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export async function executeResearchTask(
  userId: number,
  homework: UlysseHomework,
  searchQuery: string,
  personaName: string = "Ulysse",
): Promise<{ summary: string; artifacts: any }> {
  try {
    const query = searchQuery || homework.title;
    console.log(`[HomeworkExecution] Performing web search for: "${query}"`);

    const searchResponse = await searchWeb(query);

    if (!searchResponse.success || searchResponse.results.length === 0) {
      return {
        summary: `Recherche effectuée pour "${homework.title}" mais aucun résultat trouvé.`,
        artifacts: { searchQuery: query, results: [] },
      };
    }

    const formattedResults = formatSearchResultsForAI(searchResponse);

    let summary = `Recherche web effectuée pour "${homework.title}":\n\n`;

    if (canMakeCall("combined")) {
      const optimizedPrompt = await generateOptimizedPrompt(homework, "research", personaName);
      console.log(`[HomeworkExecution] Using optimized prompt for research`);

      const analysisResponse = await withRateLimit("combined", () =>
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: optimizedPrompt },
            {
              role: "user",
              content: `Tâche: ${homework.title}\n${homework.description || ""}\n\nRésultats:\n${formattedResults}`,
            },
          ],
          temperature: 0.3,
          max_tokens: 500,
        }),
        0,
      );

      summary = analysisResponse.choices[0].message.content || summary;
    } else {
      summary += searchResponse.results
        .slice(0, 3)
        .map((r, i: number) => `${i + 1}. ${r.title}\n   ${r.snippet}`)
        .join("\n\n");
    }

    await memoryService.updateOrCreateMemory(
      userId,
      "knowledge",
      `homework_research_${homework.id}`,
      summary.substring(0, 1500),
      `homework:${homework.id}:research`,
    );

    return {
      summary,
      artifacts: {
        searchQuery: query,
        resultsCount: searchResponse.results.length,
        topResults: searchResponse.results.slice(0, 5),
      },
    };
  } catch (error) {
    console.error("[HomeworkExecution] Research task failed:", error);
    return {
      summary: `Erreur lors de la recherche pour "${homework.title}"`,
      artifacts: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

export async function executeGenericTask(
  userId: number,
  homework: UlysseHomework,
  personaName: string = "Ulysse",
  userName?: string,
): Promise<{ summary: string; artifacts: any }> {
  const targetUser = userName || (personaName === "Ulysse" ? "Maurice" : "l'utilisateur");

  if (!canMakeCall("combined")) {
    return {
      summary: `Tâche "${homework.title}" enregistrée. ${personaName} la traitera lors de la prochaine conversation.`,
      artifacts: { processed: false, reason: "rate_limit" },
    };
  }

  try {
    const optimizedPrompt = await generateOptimizedPrompt(homework, "generic", personaName);
    console.log(`[HomeworkExecution] Using optimized prompt for generic task`);

    const response = await withRateLimit("combined", () =>
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: optimizedPrompt },
          {
            role: "user",
            content: `Tâche: ${homework.title}\n\nDescription: ${homework.description || "Aucune description"}\n\nPrépare cette tâche en détail avec des explications pratiques pour ${targetUser}.`,
          },
        ],
        temperature: 0.5,
        max_tokens: 1000,
      }),
      0,
    );

    const summary = response.choices[0].message.content || `Tâche "${homework.title}" préparée.`;

    await memoryService.updateOrCreateMemory(
      userId,
      "homework",
      `homework_prep_${homework.id}`,
      summary.substring(0, 1500),
      `homework:${homework.id}:prep`,
    );

    return {
      summary,
      artifacts: { processed: true },
    };
  } catch (error) {
    console.error("[HomeworkExecution] Generic task failed:", error);
    return {
      summary: `Tâche "${homework.title}" en attente de traitement.`,
      artifacts: { processed: false, error: error instanceof Error ? error.message : String(error) },
    };
  }
}
