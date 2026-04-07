import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const commaxAccounts = pgTable("commax_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  platform: text("platform").notNull(),
  accountName: text("account_name").notNull(),
  accountHandle: text("account_handle"),
  accountId: text("account_id"),
  avatarUrl: text("avatar_url"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  status: text("status").notNull().default("pending"),
  followersCount: integer("followers_count").default(0),
  followingCount: integer("following_count").default(0),
  postsCount: integer("posts_count").default(0),
  metadata: jsonb("metadata").default({}),
  connectedAt: timestamp("connected_at").defaultNow(),
  lastSyncAt: timestamp("last_sync_at"),
});

export const commaxPosts = pgTable("commax_posts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title"),
  content: text("content").notNull(),
  mediaUrls: text("media_urls").array().default([]),
  status: text("status").notNull().default("draft"),
  scheduledAt: timestamp("scheduled_at"),
  publishedAt: timestamp("published_at"),
  platforms: text("platforms").array().default([]),
  accountIds: integer("account_ids").array().default([]),
  aiGenerated: boolean("ai_generated").default(false),
  prompt: text("prompt"),
  tags: text("tags").array().default([]),
  campaignName: text("campaign_name"),
  publishResults: jsonb("publish_results").default({}),
  engagementStats: jsonb("engagement_stats").default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const commaxMentions = pgTable("commax_mentions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  accountId: integer("account_id").notNull(),
  platform: text("platform").notNull(),
  type: text("type").notNull().default("mention"),
  authorName: text("author_name"),
  authorHandle: text("author_handle"),
  authorAvatarUrl: text("author_avatar_url"),
  content: text("content").notNull(),
  sentiment: text("sentiment"),
  isRead: boolean("is_read").default(false),
  isReplied: boolean("is_replied").default(false),
  reply: text("reply"),
  externalId: text("external_id"),
  externalUrl: text("external_url"),
  metadata: jsonb("metadata").default({}),
  receivedAt: timestamp("received_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const commaxTemplates = pgTable("commax_templates", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  content: text("content").notNull(),
  platforms: text("platforms").array().default([]),
  tags: text("tags").array().default([]),
  usageCount: integer("usage_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const commaxAnalytics = pgTable("commax_analytics", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull(),
  platform: text("platform").notNull(),
  date: text("date").notNull(),
  impressions: integer("impressions").default(0),
  reach: integer("reach").default(0),
  engagement: integer("engagement").default(0),
  likes: integer("likes").default(0),
  comments: integer("comments").default(0),
  shares: integer("shares").default(0),
  saves: integer("saves").default(0),
  clicks: integer("clicks").default(0),
  profileVisits: integer("profile_visits").default(0),
  newFollowers: integer("new_followers").default(0),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
});

export const commaxCmJournal = pgTable("commax_cm_journal", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  date: text("date").notNull(),
  type: text("type").notNull().default("note"),
  title: text("title").notNull(),
  content: text("content").notNull(),
  platforms: text("platforms").array().default([]),
  postId: integer("post_id"),
  sessionId: integer("session_id"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCommaxAccountSchema = createInsertSchema(commaxAccounts).omit({ id: true, connectedAt: true, lastSyncAt: true });
export const insertCommaxPostSchema = createInsertSchema(commaxPosts).omit({ id: true, createdAt: true, updatedAt: true, publishedAt: true });
export const insertCommaxMentionSchema = createInsertSchema(commaxMentions).omit({ id: true, createdAt: true });
export const insertCommaxTemplateSchema = createInsertSchema(commaxTemplates).omit({ id: true, createdAt: true });
export const insertCommaxAnalyticsSchema = createInsertSchema(commaxAnalytics).omit({ id: true, createdAt: true });
export const insertCommaxCmJournalSchema = createInsertSchema(commaxCmJournal).omit({ id: true, createdAt: true });

export type CommaxAccount = typeof commaxAccounts.$inferSelect;
export type InsertCommaxAccount = z.infer<typeof insertCommaxAccountSchema>;

export type CommaxPost = typeof commaxPosts.$inferSelect;
export type InsertCommaxPost = z.infer<typeof insertCommaxPostSchema>;

export type CommaxMention = typeof commaxMentions.$inferSelect;
export type InsertCommaxMention = z.infer<typeof insertCommaxMentionSchema>;

export type CommaxTemplate = typeof commaxTemplates.$inferSelect;
export type InsertCommaxTemplate = z.infer<typeof insertCommaxTemplateSchema>;

export type CommaxAnalytics = typeof commaxAnalytics.$inferSelect;
export type InsertCommaxAnalytics = z.infer<typeof insertCommaxAnalyticsSchema>;

export type CommaxCmJournal = typeof commaxCmJournal.$inferSelect;
export type InsertCommaxCmJournal = z.infer<typeof insertCommaxCmJournalSchema>;
