import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";
import { users } from "./auth";

export const conversationThreads = pgTable("conversation_threads", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title"),
  summary: text("summary"),
  originDevice: text("origin_device"),
  lastDevice: text("last_device"),
  messageCount: integer("message_count").notNull().default(0),
  isArchived: boolean("is_archived").notNull().default(false),
  isPinned: boolean("is_pinned").notNull().default(false),
  tags: text("tags").array().default([]),
  lastMessageAt: timestamp("last_message_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const conversationMessages = pgTable("conversation_messages", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id").notNull(),
  userId: integer("user_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  modality: text("modality").notNull().default("text"),
  attachments: jsonb("attachments").default([]),
  metadata: jsonb("metadata").default({}),
  isEdited: boolean("is_edited").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const dailySummaries = pgTable("daily_summaries", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  date: text("date").notNull(),
  summary: text("summary").notNull(),
  highlights: jsonb("highlights").default([]),
  tasksCompleted: integer("tasks_completed").default(0),
  conversationsCount: integer("conversations_count").default(0),
  emailsSummary: text("emails_summary"),
  weatherInfo: jsonb("weather_info").default({}),
  generatedAt: timestamp("generated_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
});

export const emailMessages = pgTable("email_messages", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  gmailId: text("gmail_id").notNull().unique(),
  threadId: text("thread_id"),
  from: text("from").notNull(),
  to: text("to"),
  subject: text("subject"),
  snippet: text("snippet"),
  body: text("body"),
  labels: text("labels").array().default([]),
  isRead: boolean("is_read").notNull().default(false),
  isStarred: boolean("is_starred").notNull().default(false),
  hasAttachments: boolean("has_attachments").notNull().default(false),
  receivedAt: timestamp("received_at"),
  cachedAt: timestamp("cached_at").defaultNow(),
});

export const agentmailSendHistory = pgTable("agentmail_send_history", {
  id: serial("id").primaryKey(),
  trackingId: text("tracking_id").notNull().unique(),
  userId: integer("user_id").notNull(),
  persona: text("persona").notNull().default("ulysse"),
  toAddress: text("to_address").notNull(),
  subject: text("subject").notNull(),
  bodyLength: integer("body_length").notNull().default(0),
  hasAttachments: boolean("has_attachments").notNull().default(false),
  attachmentCount: integer("attachment_count").default(0),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(1),
  maxAttempts: integer("max_attempts").notNull().default(3),
  messageId: text("message_id"),
  errorMessage: text("error_message"),
  deliveryStatus: text("delivery_status"),
  sentAt: timestamp("sent_at"),
  lastAttemptAt: timestamp("last_attempt_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const agentmailMessages = pgTable("agentmail_messages", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  messageId: text("message_id").notNull().unique(),
  threadId: text("thread_id"),
  from: text("from").notNull(),
  to: text("to").array().default([]),
  cc: text("cc").array().default([]),
  subject: text("subject"),
  body: text("body"),
  htmlBody: text("html_body"),
  snippet: text("snippet"),
  isRead: boolean("is_read").notNull().default(false),
  isProcessed: boolean("is_processed").notNull().default(false),
  category: text("category"),
  priority: text("priority").default("normal"),
  sentiment: text("sentiment"),
  summary: text("summary"),
  suggestedAction: text("suggested_action"),
  attachments: jsonb("attachments").default([]),
  metadata: jsonb("metadata").default({}),
  receivedAt: timestamp("received_at"),
  cachedAt: timestamp("cached_at").defaultNow(),
});

export const agentmailAttachments = pgTable("agentmail_attachments", {
  id: serial("id").primaryKey(),
  messageId: text("message_id").notNull(),
  attachmentId: text("attachment_id").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull().default(0),
  localPath: text("local_path"),
  url: text("url"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const gmailTokens = pgTable("gmail_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  tokenType: text("token_type").notNull().default("Bearer"),
  scope: text("scope").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const conversationThreadsRelations = relations(conversationThreads, ({ one, many }) => ({
  user: one(users, {
    fields: [conversationThreads.userId],
    references: [users.id],
  }),
  messages: many(conversationMessages),
}));

export const conversationMessagesRelations = relations(conversationMessages, ({ one }) => ({
  thread: one(conversationThreads, {
    fields: [conversationMessages.threadId],
    references: [conversationThreads.id],
  }),
}));

export const insertConversationThreadSchema = createInsertSchema(conversationThreads).omit({ id: true, createdAt: true, lastMessageAt: true });
export const insertConversationMessageSchema = createInsertSchema(conversationMessages).omit({ id: true, createdAt: true });
export const insertDailySummarySchema = createInsertSchema(dailySummaries).omit({ id: true, generatedAt: true });
export const insertEmailMessageSchema = createInsertSchema(emailMessages).omit({ id: true, cachedAt: true });
export const insertAgentmailSendHistorySchema = createInsertSchema(agentmailSendHistory).omit({ id: true, createdAt: true, lastAttemptAt: true, sentAt: true });
export const insertAgentmailMessageSchema = createInsertSchema(agentmailMessages).omit({ id: true, cachedAt: true });
export const insertAgentmailAttachmentSchema = createInsertSchema(agentmailAttachments).omit({ id: true, createdAt: true });

export type ConversationThread = typeof conversationThreads.$inferSelect;
export type InsertConversationThread = z.infer<typeof insertConversationThreadSchema>;

export type ConversationMessage = typeof conversationMessages.$inferSelect;
export type InsertConversationMessage = z.infer<typeof insertConversationMessageSchema>;

export type DailySummary = typeof dailySummaries.$inferSelect;
export type InsertDailySummary = z.infer<typeof insertDailySummarySchema>;

export type EmailMessage = typeof emailMessages.$inferSelect;
export type InsertEmailMessage = z.infer<typeof insertEmailMessageSchema>;

export type AgentmailMessage = typeof agentmailMessages.$inferSelect;
export type InsertAgentmailMessage = z.infer<typeof insertAgentmailMessageSchema>;

export type AgentmailAttachment = typeof agentmailAttachments.$inferSelect;
export type InsertAgentmailAttachment = z.infer<typeof insertAgentmailAttachmentSchema>;
