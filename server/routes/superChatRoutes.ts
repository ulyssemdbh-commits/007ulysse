import { Router, Request, Response } from "express";
import { aiRouter, type ChatMessage } from "../services/aiRouter";

const router = Router();

const AI_PERSONAS: Record<string, { name: string; emoji: string; color: string; systemPrompt: string }> = {
  ulysse: {
    name: "Ulysse",
    emoji: "🧠",
    color: "#3b82f6",
    systemPrompt: `Tu es Ulysse, l'assistant IA personnel de Maurice (Moe). Tu es sarcastique mais efficace, direct, tu tutoies Maurice. Tu es l'IA principale — stratégique, polyvalente, experte en tech, sport, business et vie perso. Tu parles en français, ton style est concis et percutant. Dans ce SuperChat, tu interagis avec les autres IA (Iris, Alfred, MaxAI) et Maurice. Tu peux interpeller les autres IA, réagir à leurs propos, et collaborer. Sois bref (2-4 phrases max).`
  },
  iris: {
    name: "Iris",
    emoji: "🌸",
    color: "#ec4899",
    systemPrompt: `Tu es Iris, l'IA familiale bienveillante de la famille Djedou. Tu es chaleureuse, attentionnée, tu parles en français avec douceur. Tu connais bien Kelly, Lenny et Micky (les enfants). Tu gères le calendrier familial, Spotify, les devoirs, les activités. Dans ce SuperChat, tu interagis avec Ulysse, Alfred, MaxAI et Maurice. Tu peux réagir, compléter ou nuancer ce que disent les autres. Sois brève (2-4 phrases max).`
  },
  alfred: {
    name: "Alfred",
    emoji: "🎩",
    color: "#f59e0b",
    systemPrompt: `Tu es Alfred (MaxAI), l'IA business de SUGU Maillane — assistant professionnel style majordome. Tu vouvoies sauf dans ce SuperChat privé où tu peux être plus décontracté. Expert en restauration, Convention HCR, food cost, gestion d'équipe. Dans ce SuperChat, tu interagis avec Ulysse, Iris, Maurice. Tu apportes le point de vue business/opérationnel. Sois bref (2-4 phrases max).`
  },
  maxai: {
    name: "MaxAI",
    emoji: "⚡",
    color: "#8b5cf6",
    systemPrompt: `Tu es MaxAI, l'IA DevOps et technique. Expert en développement, CI/CD, GitHub, déploiement Hetzner, architecture logicielle. Tu es efficace, technique, précis. Dans ce SuperChat, tu interagis avec Ulysse, Iris, Alfred et Maurice. Tu apportes l'expertise technique et dev. Sois bref (2-4 phrases max).`
  }
};

interface SuperChatMessage {
  id: string;
  sender: string;
  senderName: string;
  emoji: string;
  color: string;
  content: string;
  timestamp: number;
}

const conversationHistory: ChatMessage[] = [];
const MAX_HISTORY = 40;

router.post("/message", async (req: Request, res: Response) => {
  try {
    const { message, respondents } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message requis" });
    }

    const targets: string[] = respondents && Array.isArray(respondents) && respondents.length > 0
      ? respondents
      : Object.keys(AI_PERSONAS);

    conversationHistory.push({ role: "user", content: `[Maurice]: ${message}` });
    if (conversationHistory.length > MAX_HISTORY) {
      conversationHistory.splice(0, conversationHistory.length - MAX_HISTORY);
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const results: SuperChatMessage[] = [];

    for (const personaKey of targets) {
      const persona = AI_PERSONAS[personaKey];
      if (!persona) continue;

      const messages: ChatMessage[] = [
        { role: "system", content: persona.systemPrompt + `\n\nContexte du SuperChat — conversation de groupe entre Maurice et ses 4 IA. Historique récent:\n${conversationHistory.map(m => m.content).join("\n")}` },
        { role: "user", content: message }
      ];

      let fullResponse = "";
      try {
        await aiRouter.streamChat(
          messages,
          { provider: "auto" },
          (chunk: string) => {
            fullResponse += chunk;
            res.write(`data: ${JSON.stringify({
              type: "chunk",
              sender: personaKey,
              senderName: persona.name,
              emoji: persona.emoji,
              color: persona.color,
              content: chunk
            })}\n\n`);
          }
        );

        conversationHistory.push({ role: "assistant", content: `[${persona.name}]: ${fullResponse}` });

        results.push({
          id: `${personaKey}-${Date.now()}`,
          sender: personaKey,
          senderName: persona.name,
          emoji: persona.emoji,
          color: persona.color,
          content: fullResponse,
          timestamp: Date.now()
        });

        res.write(`data: ${JSON.stringify({
          type: "done",
          sender: personaKey,
          senderName: persona.name,
          emoji: persona.emoji,
          color: persona.color,
          content: fullResponse
        })}\n\n`);

      } catch (err: any) {
        console.error(`[SuperChat] Error from ${persona.name}:`, err.message);
        res.write(`data: ${JSON.stringify({
          type: "error",
          sender: personaKey,
          senderName: persona.name,
          emoji: persona.emoji,
          color: persona.color,
          content: `[Erreur: ${err.message}]`
        })}\n\n`);
      }
    }

    if (conversationHistory.length > MAX_HISTORY) {
      conversationHistory.splice(0, conversationHistory.length - MAX_HISTORY);
    }

    res.write(`data: ${JSON.stringify({ type: "all_done" })}\n\n`);
    res.end();
  } catch (err: any) {
    console.error("[SuperChat] Fatal error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", content: err.message })}\n\n`);
      res.end();
    }
  }
});

router.post("/reset", (_req: Request, res: Response) => {
  conversationHistory.length = 0;
  res.json({ success: true });
});

router.get("/personas", (_req: Request, res: Response) => {
  const personas = Object.entries(AI_PERSONAS).map(([key, p]) => ({
    id: key, name: p.name, emoji: p.emoji, color: p.color
  }));
  res.json(personas);
});

export default router;
