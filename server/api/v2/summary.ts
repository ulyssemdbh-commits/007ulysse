import { Router, Request, Response } from "express";
import { db } from "../../db";
import { dailySummaries, tasks, conversationThreads, ulysseMemory } from "@shared/schema";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import OpenAI from "openai";

const router = Router();

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

function getTodayDate(): string {
  return new Date().toISOString().split("T")[0];
}

router.get("/today", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const today = getTodayDate();

    const [existingSummary] = await db.select()
      .from(dailySummaries)
      .where(and(
        eq(dailySummaries.userId, userId),
        eq(dailySummaries.date, today)
      ));

    if (existingSummary && existingSummary.expiresAt && new Date(existingSummary.expiresAt) > new Date()) {
      return res.json({
        summary: existingSummary.summary,
        highlights: existingSummary.highlights,
        tasksCompleted: existingSummary.tasksCompleted,
        conversationsCount: existingSummary.conversationsCount,
        emailsSummary: existingSummary.emailsSummary,
        weatherInfo: existingSummary.weatherInfo,
        cached: true,
        generatedAt: existingSummary.generatedAt,
      });
    }

    const todayStart = new Date(today);
    const todayEnd = new Date(today);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const completedTasks = await db.select()
      .from(tasks)
      .where(and(
        eq(tasks.userId, userId),
        eq(tasks.status, "done")
      ))
      .limit(10);

    const recentConversations = await db.select()
      .from(conversationThreads)
      .where(eq(conversationThreads.userId, userId))
      .orderBy(desc(conversationThreads.lastMessageAt))
      .limit(5);

    const memories = await db.select()
      .from(ulysseMemory)
      .where(eq(ulysseMemory.userId, userId))
      .limit(5);

    let weatherInfo = {};
    try {
      const weatherResponse = await fetch(
        "https://api.open-meteo.com/v1/forecast?latitude=43.2965&longitude=5.3698&current=temperature_2m,weather_code&timezone=Europe/Paris"
      );
      const weatherData = await weatherResponse.json();
      weatherInfo = {
        temperature: weatherData.current?.temperature_2m,
        location: "Marseille",
      };
    } catch (e) {
    }

    const summaryPrompt = `Tu es Ulysse. Génère un brief du jour pour Maurice, en français, naturel et concis.

Données:
- Tâches complétées aujourd'hui: ${completedTasks.length}
- Conversations récentes: ${recentConversations.length}
- Météo: ${JSON.stringify(weatherInfo)}
- Mémoire: ${memories.map(m => m.key).join(", ")}

Format: Un paragraphe de 2-3 phrases max, naturel, comme si tu lui parlais.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: summaryPrompt }],
      max_tokens: 300,
    });

    const generatedSummary = completion.choices[0]?.message?.content || "Pas de brief disponible pour aujourd'hui.";

    const highlights = [
      ...(completedTasks.length > 0 ? [{ type: "tasks", title: "Tâches", description: `${completedTasks.length} tâches complétées` }] : []),
      ...(recentConversations.length > 0 ? [{ type: "conversations", title: "Conversations", description: `${recentConversations.length} conversations récentes` }] : []),
    ];

    if (existingSummary) {
      await db.update(dailySummaries)
        .set({
          summary: generatedSummary,
          highlights,
          tasksCompleted: completedTasks.length,
          conversationsCount: recentConversations.length,
          weatherInfo,
          generatedAt: new Date(),
          expiresAt: new Date(Date.now() + 3600000), // 1 hour cache
        })
        .where(eq(dailySummaries.id, existingSummary.id));
    } else {
      await db.insert(dailySummaries).values({
        userId,
        date: today,
        summary: generatedSummary,
        highlights,
        tasksCompleted: completedTasks.length,
        conversationsCount: recentConversations.length,
        weatherInfo,
        expiresAt: new Date(Date.now() + 3600000),
      });
    }

    res.json({
      summary: generatedSummary,
      highlights,
      tasksCompleted: completedTasks.length,
      conversationsCount: recentConversations.length,
      weatherInfo,
      cached: false,
      generatedAt: new Date(),
    });
  } catch (error: any) {
    console.error("[V2 Summary] Error:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

router.post("/today/refresh", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const today = getTodayDate();

    await db.delete(dailySummaries)
      .where(and(
        eq(dailySummaries.userId, userId),
        eq(dailySummaries.date, today)
      ));

    res.json({ success: true, message: "Cache cleared. Call GET /today to regenerate." });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
