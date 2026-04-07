import { db } from "../../db";
import { conversations, messages } from "@shared/schema";
import { eq, desc, and, inArray, gte, lte } from "drizzle-orm";

const MAX_CONV_FOR_SEARCH = 200;
const MAX_MSG_PER_CONV_FOR_SEARCH = 50;

export interface ConversationWithPreview {
  id: number;
  userId: number;
  title: string;
  createdAt: Date;
  messageCount: number;
  lastMessage?: string;
  matchedContent?: string;
}

export interface SearchParams {
  query?: string;
  startDate?: Date;
  endDate?: Date;
}

export interface IChatStorage {
  getConversation(id: number, userId: number): Promise<typeof conversations.$inferSelect | undefined>;
  getAllConversations(userId: number, limit?: number, offset?: number): Promise<(typeof conversations.$inferSelect)[]>;
  createConversation(title: string, userId: number): Promise<typeof conversations.$inferSelect>;
  updateConversationTitle(id: number, userId: number, title: string): Promise<typeof conversations.$inferSelect | undefined>;
  deleteConversation(id: number, userId: number): Promise<void>;
  getMessagesByConversation(conversationId: number, userId: number): Promise<(typeof messages.$inferSelect)[]>;
  createMessage(conversationId: number, role: string, content: string): Promise<typeof messages.$inferSelect>;
  updateLastAssistantMessage(conversationId: number, newContent: string): Promise<void>;
  countMessages(conversationId: number): Promise<number>;
  searchConversations(params: SearchParams, userId: number): Promise<ConversationWithPreview[]>;
}

export const chatStorage: IChatStorage = {
  async getConversation(id: number, userId: number) {
    const [conversation] = await db.select().from(conversations).where(
      and(eq(conversations.id, id), eq(conversations.userId, userId))
    );
    return conversation;
  },

  async getAllConversations(userId: number, limit?: number, offset?: number) {
    let query = db.select().from(conversations)
      .where(eq(conversations.userId, userId))
      .orderBy(desc(conversations.createdAt));
    
    if (limit !== undefined) {
      query = query.limit(limit) as typeof query;
    }
    if (offset !== undefined) {
      query = query.offset(offset) as typeof query;
    }
    return query;
  },

  async createConversation(title: string, userId: number) {
    const [conversation] = await db.insert(conversations).values({ title, userId }).returning();
    return conversation;
  },

  async updateConversationTitle(id: number, userId: number, title: string) {
    const [updated] = await db.update(conversations)
      .set({ title })
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
      .returning();
    return updated;
  },

  async deleteConversation(id: number, userId: number) {
    const conv = await this.getConversation(id, userId);
    if (!conv) return;
    await db.delete(messages).where(eq(messages.conversationId, id));
    await db.delete(conversations).where(
      and(eq(conversations.id, id), eq(conversations.userId, userId))
    );
  },

  async getMessagesByConversation(conversationId: number, userId: number) {
    const conv = await this.getConversation(conversationId, userId);
    if (!conv) return [];
    return db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(messages.createdAt);
  },

  async createMessage(conversationId: number, role: string, content: string) {
    const [message] = await db.insert(messages).values({ conversationId, role, content }).returning();
    return message;
  },

  async countMessages(conversationId: number) {
    const rows = await db.select().from(messages).where(eq(messages.conversationId, conversationId));
    return rows.length;
  },

  async updateLastAssistantMessage(conversationId: number, newContent: string) {
    const lastMessage = await db.select()
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), eq(messages.role, 'assistant')))
      .orderBy(desc(messages.createdAt))
      .limit(1);
    
    if (lastMessage.length > 0) {
      await db.update(messages)
        .set({ content: newContent })
        .where(eq(messages.id, lastMessage[0].id));
    }
  },

  async searchConversations(params: SearchParams, userId: number): Promise<ConversationWithPreview[]> {
    const { query, startDate, endDate } = params;
    const hasQuery = !!query && query.trim().length > 0;
    const searchTerm = hasQuery ? query!.toLowerCase() : "";

    const convRows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, userId))
      .orderBy(desc(conversations.createdAt))
      .limit(MAX_CONV_FOR_SEARCH);

    if (convRows.length === 0) return [];

    const convIds = convRows.map((c) => c.id);

    const msgRows = await db
      .select()
      .from(messages)
      .where(inArray(messages.conversationId, convIds))
      .orderBy(desc(messages.createdAt));

    const messagesByConv = new Map<number, typeof messages.$inferSelect[]>();
    const messageCountByConv = new Map<number, number>();

    for (const m of msgRows) {
      const count = messageCountByConv.get(m.conversationId) ?? 0;
      messageCountByConv.set(m.conversationId, count + 1);

      const list = messagesByConv.get(m.conversationId) ?? [];
      if (list.length < MAX_MSG_PER_CONV_FOR_SEARCH) {
        list.push(m);
        messagesByConv.set(m.conversationId, list);
      }
    }

    const results: ConversationWithPreview[] = [];

    for (const conv of convRows) {
      const convMessages = messagesByConv.get(conv.id) ?? [];
      const messageCount = messageCountByConv.get(conv.id) ?? 0;

      const lastMsg = convMessages[0];
      const lastMessage = lastMsg?.content?.slice(0, 100);
      const lastActivityDate = lastMsg?.createdAt || conv.createdAt;

      if (startDate || endDate) {
        const t = lastActivityDate.getTime();
        if (startDate && t < startDate.getTime()) continue;
        if (endDate && t > endDate.getTime()) continue;
      }

      if (hasQuery) {
        const titleMatch = conv.title.toLowerCase().includes(searchTerm);
        const matchedMessage = convMessages.find((m) =>
          m.content.toLowerCase().includes(searchTerm)
        );

        if (titleMatch || matchedMessage) {
          results.push({
            id: conv.id,
            userId: conv.userId,
            title: conv.title,
            createdAt: conv.createdAt,
            messageCount,
            lastMessage,
            matchedContent: matchedMessage?.content?.slice(0, 150),
          });
        }
      } else {
        results.push({
          id: conv.id,
          userId: conv.userId,
          title: conv.title,
          createdAt: conv.createdAt,
          messageCount,
          lastMessage,
        });
      }
    }

    return results;
  },
};
