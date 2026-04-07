import { pgTable, text, serial, integer, boolean, timestamp, jsonb, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const knowledgeBase = pgTable("knowledge_base", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  summary: text("summary"),
  type: text("type").notNull(),
  category: text("category").notNull(),
  subcategory: text("subcategory"),
  parentId: integer("parent_id"),
  tags: text("tags").array().default([]),
  source: text("source"),
  sourceUrl: text("source_url"),
  sourceType: text("source_type"),
  mediaPath: text("media_path"),
  mediaMimeType: text("media_mime_type"),
  mediaSize: integer("media_size"),
  thumbnailPath: text("thumbnail_path"),
  importance: integer("importance").notNull().default(50),
  confidence: integer("confidence").notNull().default(50),
  usefulness: integer("usefulness").notNull().default(50),
  accessCount: integer("access_count").notNull().default(0),
  isTemporary: boolean("is_temporary").notNull().default(false),
  expiresAt: timestamp("expires_at"),
  lastAccessedAt: timestamp("last_accessed_at"),
  lastVerifiedAt: timestamp("last_verified_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const savedLinks = pgTable("saved_links", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  faviconUrl: text("favicon_url"),
  summary: text("summary"),
  keyPoints: text("key_points").array().default([]),
  category: text("category"),
  tags: text("tags").array().default([]),
  sentiment: text("sentiment"),
  readingTime: integer("reading_time"),
  cachedContent: text("cached_content"),
  lastCrawledAt: timestamp("last_crawled_at"),
  crawlStatus: text("crawl_status"),
  isFavorite: boolean("is_favorite").notNull().default(false),
  isArchived: boolean("is_archived").notNull().default(false),
  isRead: boolean("is_read").notNull().default(false),
  savedFrom: text("saved_from"),
  relatedKnowledgeId: integer("related_knowledge_id"),
  notes: text("notes"),
  visitCount: integer("visit_count").notNull().default(0),
  lastVisitedAt: timestamp("last_visited_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const knowledgeGraph = pgTable("knowledge_graph", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: integer("source_id").notNull(),
  sourceLabel: text("source_label").notNull(),
  relationship: text("relationship").notNull(),
  relationshipStrength: integer("relationship_strength").notNull().default(50),
  targetType: text("target_type").notNull(),
  targetId: integer("target_id").notNull(),
  targetLabel: text("target_label").notNull(),
  context: text("context"),
  isInferred: boolean("is_inferred").notNull().default(false),
  confidence: integer("confidence").notNull().default(80),
  validFrom: timestamp("valid_from"),
  validUntil: timestamp("valid_until"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const learningLog = pgTable("learning_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  topic: text("topic").notNull(),
  content: text("content").notNull(),
  learningType: text("learning_type").notNull(),
  sourceType: text("source_type").notNull(),
  sourceContext: text("source_context"),
  sourceMessageId: integer("source_message_id"),
  affectedEntities: jsonb("affected_entities").default([]),
  impactScore: integer("impact_score").notNull().default(50),
  wasConfirmed: boolean("was_confirmed"),
  wasContradicted: boolean("was_contradicted").notNull().default(false),
  contradictionReason: text("contradiction_reason"),
  isApplied: boolean("is_applied").notNull().default(true),
  appliedAt: timestamp("applied_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const brainStatistics = pgTable("brain_statistics", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  totalKnowledge: integer("total_knowledge").notNull().default(0),
  totalLinks: integer("total_links").notNull().default(0),
  totalConnections: integer("total_connections").notNull().default(0),
  totalLearnings: integer("total_learnings").notNull().default(0),
  knowledgeByCategory: jsonb("knowledge_by_category").default({}),
  knowledgeByType: jsonb("knowledge_by_type").default({}),
  averageConfidence: integer("average_confidence").default(50),
  averageImportance: integer("average_importance").default(50),
  staleKnowledgeCount: integer("stale_knowledge_count").default(0),
  contradictionCount: integer("contradiction_count").default(0),
  learningsToday: integer("learnings_today").default(0),
  learningsThisWeek: integer("learnings_this_week").default(0),
  retrievalsToday: integer("retrievals_today").default(0),
  lastLearningAt: timestamp("last_learning_at"),
  lastRetrievalAt: timestamp("last_retrieval_at"),
  lastCleanupAt: timestamp("last_cleanup_at"),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const learningProgress = pgTable("learning_progress", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  topic: text("topic").notNull(),
  topicHash: text("topic_hash").notNull(),
  category: text("category"),
  domain: text("domain").notNull().default("autre"),
  currentDepth: integer("current_depth").notNull().default(0),
  maxDepth: integer("max_depth").notNull().default(4),
  layer1Status: text("layer1_status").notNull().default("pending"),
  layer2Status: text("layer2_status").notNull().default("pending"),
  layer3Status: text("layer3_status").notNull().default("pending"),
  layer4Status: text("layer4_status").notNull().default("pending"),
  layer1KnowledgeIds: integer("layer1_knowledge_ids").array().default([]),
  layer2KnowledgeIds: integer("layer2_knowledge_ids").array().default([]),
  layer3GraphIds: integer("layer3_graph_ids").array().default([]),
  layer4InsightIds: integer("layer4_insight_ids").array().default([]),
  totalFacts: integer("total_facts").notNull().default(0),
  totalConnections: integer("total_connections").notNull().default(0),
  totalInsights: integer("total_insights").notNull().default(0),
  priority: integer("priority").notNull().default(50),
  recencyScore: integer("recency_score").notNull().default(50),
  frequencyScore: integer("frequency_score").notNull().default(0),
  usefulnessScore: integer("usefulness_score").notNull().default(50),
  patternType: text("pattern_type").default("structural"),
  volatilityFactor: real("volatility_factor").notNull().default(1.0),
  triggerType: text("trigger_type").default("time_based"),
  confidenceScore: integer("confidence_score").notNull().default(70),
  lastAccessedAt: timestamp("last_accessed_at"),
  sourcePredictionIds: integer("source_prediction_ids").array().default([]),
  sourceConversationIds: integer("source_conversation_ids").array().default([]),
  extractedFrom: text("extracted_from"),
  nextRunAt: timestamp("next_run_at"),
  lastRunAt: timestamp("last_run_at"),
  runCount: integer("run_count").notNull().default(0),
  lastError: text("last_error"),
  relatedKnowledgeIds: integer("related_knowledge_ids").array().default([]),
  relatedGraphIds: integer("related_graph_ids").array().default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertKnowledgeBaseSchema = createInsertSchema(knowledgeBase).omit({ id: true, createdAt: true, updatedAt: true, lastAccessedAt: true });
export const insertSavedLinkSchema = createInsertSchema(savedLinks).omit({ id: true, createdAt: true, updatedAt: true, lastVisitedAt: true, lastCrawledAt: true });
export const insertKnowledgeGraphSchema = createInsertSchema(knowledgeGraph).omit({ id: true, createdAt: true, updatedAt: true });
export const insertLearningLogSchema = createInsertSchema(learningLog).omit({ id: true, createdAt: true, appliedAt: true });
export const insertBrainStatisticsSchema = createInsertSchema(brainStatistics).omit({ id: true, createdAt: true, updatedAt: true });
export const insertLearningProgressSchema = createInsertSchema(learningProgress).omit({ id: true, createdAt: true, updatedAt: true, lastRunAt: true, nextRunAt: true });

export type KnowledgeBase = typeof knowledgeBase.$inferSelect;
export type InsertKnowledgeBase = z.infer<typeof insertKnowledgeBaseSchema>;

export type SavedLink = typeof savedLinks.$inferSelect;
export type InsertSavedLink = z.infer<typeof insertSavedLinkSchema>;

export type KnowledgeGraph = typeof knowledgeGraph.$inferSelect;
export type InsertKnowledgeGraph = z.infer<typeof insertKnowledgeGraphSchema>;

export type LearningLog = typeof learningLog.$inferSelect;
export type InsertLearningLog = z.infer<typeof insertLearningLogSchema>;

export type BrainStatistics = typeof brainStatistics.$inferSelect;
export type InsertBrainStatistics = z.infer<typeof insertBrainStatisticsSchema>;

export type LearningProgress = typeof learningProgress.$inferSelect;
export type InsertLearningProgress = z.infer<typeof insertLearningProgressSchema>;
