import { Router, Request, Response } from "express";
import { db } from "../db";
import { guestSessions, conversationThreads, conversationMessages } from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { z } from "zod";
import OpenAI from "openai";
import { buildAlfredSystemPrompt } from "../replit_integrations/chat/routes";
import { getAIForContext } from "../services/core/openaiClient";

const router = Router();

const ALFRED_ENABLED = false;

const _guestAI = getAIForContext("guest");
const openai = _guestAI.client;
const GUEST_MODEL = _guestAI.model;

const GUEST_USER_ID = -1;

const messageSchema = z.object({
  threadId: z.number().nullable().optional(),
  message: z.string().min(1).max(4000),
});

async function getGuestSession(req: Request) {
  const sessionId = req.cookies?.alfredGuestSession;
  if (!sessionId) return null;
  
  const [session] = await db.select()
    .from(guestSessions)
    .where(eq(guestSessions.id, sessionId))
    .limit(1);
  
  return session;
}

router.post("/", async (req: Request, res: Response) => {
  try {
    // Check if Alfred is suspended
    if (!ALFRED_ENABLED) {
      return res.status(503).json({ 
        error: "Service temporarily unavailable",
        message: "Max est temporairement indisponible. Veuillez réessayer plus tard."
      });
    }
    
    const session = await getGuestSession(req);
    if (!session) {
      return res.status(401).json({ error: "Session invalide. Veuillez rafraîchir la page." });
    }

    const body = messageSchema.parse(req.body);
    let threadId = body.threadId;

    if (!threadId) {
      const [newThread] = await db.insert(conversationThreads).values({
        userId: GUEST_USER_ID,
        title: body.message.slice(0, 50) + (body.message.length > 50 ? "..." : ""),
        originDevice: "alfred-guest",
        lastDevice: "alfred-guest",
        messageCount: 0,
        metadata: { guestSessionId: session.id },
      }).returning();
      threadId = newThread.id;
    }

    const [thread] = await db.select()
      .from(conversationThreads)
      .where(eq(conversationThreads.id, threadId))
      .limit(1);

    if (!thread || (thread.metadata as any)?.guestSessionId !== session.id) {
      return res.status(403).json({ error: "Accès non autorisé à cette conversation" });
    }

    await db.insert(conversationMessages).values({
      threadId,
      userId: GUEST_USER_ID,
      role: "user",
      content: body.message,
      modality: "text",
      attachments: [],
      metadata: { guestSessionId: session.id },
    });

    const previousMessages = await db.select()
      .from(conversationMessages)
      .where(eq(conversationMessages.threadId, threadId))
      .orderBy(desc(conversationMessages.createdAt))
      .limit(10);

    let timeContext = "";
    try {
      const { fetchMarseilleData } = await import("../services/marseilleWeather");
      const marseilleData = await fetchMarseilleData();
      timeContext = `\n### CONTEXTE:\n- Heure: ${marseilleData.time}\n- Date: ${marseilleData.date}\n- Météo Marseille: ${marseilleData.weather.temperature}, ${marseilleData.weather.condition}`;
    } catch (err) {
      console.error("Failed to fetch time context:", err);
    }

    const guestName = session.displayName || "Visiteur";
    const systemMessage = buildAlfredSystemPrompt("", guestName);
    const systemPrompt = systemMessage.content + timeContext;

    const messages: any[] = [
      { role: "system", content: systemPrompt },
      ...previousMessages.reverse().map(m => ({
        role: m.role,
        content: m.content,
      })),
    ];

    const completion = await openai.chat.completions.create({
      model: GUEST_MODEL,
      messages,
      max_tokens: 1000,
      temperature: 0.7,
    });

    const assistantMessage = completion.choices[0]?.message?.content || "Je n'ai pas pu générer de réponse.";

    await db.insert(conversationMessages).values({
      threadId,
      userId: GUEST_USER_ID,
      role: "assistant",
      content: assistantMessage,
      modality: "text",
      attachments: [],
      metadata: { guestSessionId: session.id },
    });

    await db.update(conversationThreads)
      .set({ 
        messageCount: sql`${conversationThreads.messageCount} + 2`,
        lastDevice: "alfred-guest",
      })
      .where(eq(conversationThreads.id, threadId));

    await db.update(guestSessions)
      .set({ 
        messageCount: sql`${guestSessions.messageCount} + 1`,
        lastActiveAt: new Date(),
      })
      .where(eq(guestSessions.id, session.id));

    res.json({
      threadId,
      message: assistantMessage,
      persona: "Max",
    });
  } catch (error: any) {
    console.error("[GuestConversation] Error:", error);
    if (error.name === "ZodError") {
      return res.status(400).json({ error: "Message invalide" });
    }
    res.status(500).json({ error: "Erreur lors du traitement du message" });
  }
});

router.get("/threads", async (req: Request, res: Response) => {
  try {
    const session = await getGuestSession(req);
    if (!session) {
      return res.status(401).json({ error: "Session invalide" });
    }

    const threads = await db.select()
      .from(conversationThreads)
      .where(
        and(
          eq(conversationThreads.userId, GUEST_USER_ID),
          sql`${conversationThreads.metadata}->>'guestSessionId' = ${session.id}`
        )
      )
      .orderBy(desc(conversationThreads.createdAt))
      .limit(20);

    res.json(threads);
  } catch (error) {
    console.error("[GuestConversation] Threads error:", error);
    res.status(500).json({ error: "Erreur lors de la récupération des conversations" });
  }
});

router.get("/threads/:threadId/messages", async (req: Request, res: Response) => {
  try {
    const session = await getGuestSession(req);
    if (!session) {
      return res.status(401).json({ error: "Session invalide" });
    }

    const threadId = parseInt(req.params.threadId);
    const [thread] = await db.select()
      .from(conversationThreads)
      .where(eq(conversationThreads.id, threadId))
      .limit(1);

    if (!thread || (thread.metadata as any)?.guestSessionId !== session.id) {
      return res.status(403).json({ error: "Accès non autorisé" });
    }

    const messages = await db.select()
      .from(conversationMessages)
      .where(eq(conversationMessages.threadId, threadId))
      .orderBy(conversationMessages.createdAt);

    res.json(messages);
  } catch (error) {
    console.error("[GuestConversation] Messages error:", error);
    res.status(500).json({ error: "Erreur lors de la récupération des messages" });
  }
});

export default router;
