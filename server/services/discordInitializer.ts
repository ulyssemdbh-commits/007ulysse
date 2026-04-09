/**
 * Discord Bot Initialization Module
 * Extracted from index.ts for maintainability.
 * Handles Discord bot startup with full Ulysse AI integration,
 * conversation persistence, and brain context.
 */

import { db } from "../db";
import { ulysseMemory, conversationThreads, conversationMessages } from "@shared/schema";

type UlysseHandler = (messageText: string, discordUserId: string) => Promise<string>;

const discordConversations = new Map<string, { conversationId: number; history: Array<{role: string; content: string}> }>();

async function createUlysseHandler(): Promise<UlysseHandler> {
  const { ulysseCoreEngine } = await import("./core/UlysseCoreEngine");
  const { brainContextService } = await import("./brainContextService");
  const { getPersonaPromptContext, SPEAKER_PERSONA_MAP } = await import("../config/personaMapping");

  return async (messageText: string, discordUserId: string): Promise<string> => {
    try {
      console.log(`[DiscordBot] Processing: "${messageText}" from Discord user ${discordUserId}`);
      const userId = 1;

      let session = discordConversations.get(discordUserId);
      if (!session) {
        const { eq, desc, and, gte } = await import("drizzle-orm");
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const [existingThread] = await db
          .select()
          .from(conversationThreads)
          .where(and(
            eq(conversationThreads.userId, userId),
            eq(conversationThreads.originDevice, 'discord'),
            gte(conversationThreads.lastMessageAt!, cutoff)
          ))
          .orderBy(desc(conversationThreads.lastMessageAt))
          .limit(1);

        let conversationId: number;
        let history: Array<{role: string; content: string}> = [];

        if (existingThread) {
          conversationId = existingThread.id;
          const recentMsgs = await db
            .select()
            .from(conversationMessages)
            .where(eq(conversationMessages.threadId, conversationId))
            .orderBy(desc(conversationMessages.createdAt))
            .limit(20);
          history = recentMsgs.reverse().map(m => ({ role: m.role, content: m.content }));
          console.log(`[DiscordBot] Resumed conversation ${conversationId} (${history.length} messages loaded) for Discord user ${discordUserId}`);
        } else {
          const [newConv] = await db.insert(conversationThreads).values({
            userId,
            title: `Discord - ${new Date().toLocaleDateString('fr-FR')}`,
            originDevice: 'discord'
          }).returning();
          conversationId = newConv.id;
          console.log(`[DiscordBot] Created new conversation ${conversationId} for Discord user ${discordUserId}`);
        }

        session = { conversationId, history };
        discordConversations.set(discordUserId, session);
      }

      session.history.push({ role: 'user', content: messageText });
      if (session.history.length > 20) {
        session.history = session.history.slice(-20);
      }

      await db.insert(conversationMessages).values({
        threadId: session.conversationId,
        userId,
        role: 'user',
        content: messageText
      });

      {
        const { eq: eqUpd } = await import("drizzle-orm");
        await db.update(conversationThreads)
          .set({ lastMessageAt: new Date() })
          .where(eqUpd(conversationThreads.id, session.conversationId));
      }

      const personaConfig = SPEAKER_PERSONA_MAP['maurice'] || SPEAKER_PERSONA_MAP['owner'];
      const personaPrompt = getPersonaPromptContext(personaConfig);

      const brainContext = await brainContextService.getContext({
        userId,
        query: messageText,
        persona: 'ulysse',
        maxTokens: 2000,
        includeGraph: true
      });

      const discordHistoryBlock = session.history.length > 2
        ? `HISTORIQUE DISCORD (${session.history.length} messages depuis le début de notre session):\n` +
          session.history.slice(0, -1).map(m =>
            `${m.role === 'user' ? 'Maurice' : 'Ulysse'}: ${m.content.substring(0, 300)}`
          ).join('\n')
        : '';

      const systemPrompt = `${personaPrompt}

Tu es sur Discord, tu discutes avec Maurice. Tu as accès à l'historique complet de notre conversation Discord actuelle.
Date: ${new Date().toLocaleDateString('fr-FR')} ${new Date().toLocaleTimeString('fr-FR')}

${discordHistoryBlock ? `${discordHistoryBlock}\n` : ''}
${brainContext.contextBlock ? `CONTEXTE MÉMOIRE:\n${brainContext.contextBlock}` : ''}

RÈGLES DISCORD:
- Réponds de manière concise mais complète
- Tu peux utiliser des emojis si approprié
- Si on te demande ce qu'on a dit avant, cite l'historique ci-dessus avec précision
- Tu retiens cette conversation pour nos futurs échanges`;

      const result = await ulysseCoreEngine.process({
        message: messageText,
        context: {
          userId,
          persona: 'ulysse',
          hasFamilyAccess: true,
          conversationId: session.conversationId,
          messageHistory: session.history.slice(-10),
          brainContext: systemPrompt
        }
      });

      const response = result.content || "Je n'ai pas compris, peux-tu reformuler ?";

      await db.insert(conversationMessages).values({
        threadId: session.conversationId,
        userId,
        role: 'assistant',
        content: response
      });

      session.history.push({ role: 'assistant', content: response });

      if (messageText.length > 20) {
        try {
          await db.insert(ulysseMemory).values({
            userId,
            category: 'interaction',
            key: `discord_${Date.now()}`,
            value: `[Discord] User: ${messageText}\nUlysse: ${response.substring(0, 500)}`,
            source: 'discord',
            confidence: 50,
            verified: true
          });
        } catch (memError: any) {
          console.log('[DiscordBot] Memory save skipped:', memError.message);
        }
      }

      console.log(`[DiscordBot] Response (${response.length} chars) saved to conv ${session.conversationId}`);
      return response;

    } catch (error: any) {
      console.error('[DiscordBot] Ulysse processing error:', error.message, error.stack);
      return "Désolé, une erreur s'est produite. Réessaie dans un moment.";
    }
  };
}

export async function initializeDiscordBot(): Promise<void> {
  const { discordBotService } = await import("./discordBotService");
  const ulysseHandler = await createUlysseHandler();

  const connected = await discordBotService.initialize(ulysseHandler);
  if (connected) {
    console.log('[Startup] Discord Bot connected with full memory integration');
  } else {
    console.log('[Startup] Discord Bot not configured (no token)');
  }
}
