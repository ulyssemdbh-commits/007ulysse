import { pgTable, text, serial, integer, boolean, timestamp, jsonb, real, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  deviceName: text("device_name"),
  alertTypes: text("alert_types").array().notNull().default(["morning_briefing", "anomaly", "sports", "task_reminder"]),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const suguSupplierKnowledge = pgTable("sugu_supplier_knowledge", {
  id: serial("id").primaryKey(),
  restaurant: text("restaurant").notNull().default("val"),
  supplierNorm: text("supplier_norm").notNull(),
  supplierDisplay: text("supplier_display").notNull(),
  category: text("category").notNull(),
  categoryConfidence: real("category_confidence").notNull().default(0),
  totalInvoices: integer("total_invoices").notNull().default(0),
  avgAmount: real("avg_amount"),
  minAmount: real("min_amount"),
  maxAmount: real("max_amount"),
  categoryBreakdown: jsonb("category_breakdown").default({}),
  lastLearned: timestamp("last_learned").defaultNow(),
}, (t) => ([
  uniqueIndex("sugu_supplier_knowledge_restaurant_norm_idx").on(t.restaurant, t.supplierNorm),
]));

export const memoryConnections = pgTable("memory_connections", {
  id: serial("id").primaryKey(),
  sourceMemoryId: integer("source_memory_id").notNull(),
  targetMemoryId: integer("target_memory_id").notNull(),
  relationshipType: text("relationship_type").notNull(),
  strength: real("strength").notNull().default(0.5),
  createdAt: timestamp("created_at").defaultNow(),
});

export const userConversationalPreferences = pgTable("user_conversational_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  preferenceType: text("preference_type").notNull(),
  value: text("value").notNull(),
  confidence: real("confidence").notNull().default(0.5),
  learnedFrom: text("learned_from").default("auto"),
  sampleCount: integer("sample_count").notNull().default(1),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const activityStream = pgTable("activity_stream", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull(),
  eventType: text("event_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  occurredAt: timestamp("occurred_at").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  metadata: jsonb("metadata").default({}),
  importance: integer("importance").notNull().default(5),
  restaurant: text("restaurant"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const entityLinks = pgTable("entity_links", {
  id: serial("id").primaryKey(),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  relationshipType: text("relationship_type").notNull(),
  strength: real("strength").notNull().default(1.0),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
});

export const entityTags = pgTable("entity_tags", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  tag: text("tag").notNull(),
  category: text("category"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const ulysseCumulativeInsights = pgTable("ulysse_cumulative_insights", {
  id: serial("id").primaryKey(),
  agent: text("agent").notNull().default("ulysse"),
  category: text("category").notNull(),
  subcategory: text("subcategory"),
  insightType: text("insight_type").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  correctApproach: text("correct_approach"),
  wrongApproach: text("wrong_approach"),
  confidence: integer("confidence").notNull().default(50),
  occurrences: integer("occurrences").notNull().default(1),
  impactScore: integer("impact_score").notNull().default(50),
  sourceContext: text("source_context"),
  sourceProject: text("source_project"),
  sourceFiles: text("source_files").array().default([]),
  tags: text("tags").array().default([]),
  lastSeenAt: timestamp("last_seen_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const ulysseTaskOutcomes = pgTable("ulysse_task_outcomes", {
  id: serial("id").primaryKey(),
  agent: text("agent").notNull().default("ulysse"),
  projectId: text("project_id"),
  taskType: text("task_type").notNull(),
  taskDescription: text("task_description").notNull(),
  outcome: text("outcome").notNull(),
  filesChanged: text("files_changed").array().default([]),
  toolsUsed: text("tools_used").array().default([]),
  toolSequence: text("tool_sequence").array().default([]),
  errorEncountered: text("error_encountered"),
  errorResolution: text("error_resolution"),
  durationMs: integer("duration_ms"),
  retryCount: integer("retry_count").notNull().default(0),
  insightsExtracted: integer("insights_extracted").notNull().default(0),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
});

export const ulysseSkillScores = pgTable("ulysse_skill_scores", {
  id: serial("id").primaryKey(),
  agent: text("agent").notNull().default("ulysse"),
  skill: text("skill").notNull(),
  domain: text("domain").notNull(),
  score: integer("score").notNull().default(50),
  totalAttempts: integer("total_attempts").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  failCount: integer("fail_count").notNull().default(0),
  streakCurrent: integer("streak_current").notNull().default(0),
  streakBest: integer("streak_best").notNull().default(0),
  lastAttemptAt: timestamp("last_attempt_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const ulysseErrorMemory = pgTable("ulysse_error_memory", {
  id: serial("id").primaryKey(),
  agent: text("agent").notNull().default("ulysse"),
  errorSignature: text("error_signature").notNull(),
  errorMessage: text("error_message").notNull(),
  errorContext: text("error_context"),
  resolution: text("resolution"),
  resolutionConfidence: integer("resolution_confidence").notNull().default(0),
  hitCount: integer("hit_count").notNull().default(1),
  lastHitAt: timestamp("last_hit_at").defaultNow(),
  sourceProject: text("source_project"),
  sourceFiles: text("source_files").array().default([]),
  tags: text("tags").array().default([]),
  createdAt: timestamp("created_at").defaultNow(),
});

export const ulysseToolPerformance = pgTable("ulysse_tool_performance", {
  id: serial("id").primaryKey(),
  agent: text("agent").notNull().default("ulysse"),
  toolName: text("tool_name").notNull(),
  totalCalls: integer("total_calls").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  failCount: integer("fail_count").notNull().default(0),
  avgDurationMs: integer("avg_duration_ms").notNull().default(0),
  lastError: text("last_error"),
  bestCombinations: text("best_combinations").array().default([]),
  commonErrors: jsonb("common_errors").default([]),
  lastUsedAt: timestamp("last_used_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({ id: true, createdAt: true });
export const insertActivityStreamSchema = createInsertSchema(activityStream).omit({ id: true, createdAt: true });
export const insertEntityLinkSchema = createInsertSchema(entityLinks).omit({ id: true, createdAt: true });
export const insertEntityTagSchema = createInsertSchema(entityTags).omit({ id: true, createdAt: true });
export const insertUlysseCumulativeInsightSchema = createInsertSchema(ulysseCumulativeInsights).omit({ id: true, createdAt: true });
export const insertUlysseTaskOutcomeSchema = createInsertSchema(ulysseTaskOutcomes).omit({ id: true, createdAt: true });
export const insertUlysseSkillScoreSchema = createInsertSchema(ulysseSkillScores).omit({ id: true, createdAt: true });
export const insertUlysseErrorMemorySchema = createInsertSchema(ulysseErrorMemory).omit({ id: true, createdAt: true });
export const insertUlysseToolPerformanceSchema = createInsertSchema(ulysseToolPerformance).omit({ id: true, createdAt: true });

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;

export type SuguSupplierKnowledge = typeof suguSupplierKnowledge.$inferSelect;

export type MemoryConnection = typeof memoryConnections.$inferSelect;

export type UserConversationalPreference = typeof userConversationalPreferences.$inferSelect;

export type ActivityStream = typeof activityStream.$inferSelect;
export type InsertActivityStream = z.infer<typeof insertActivityStreamSchema>;

export type EntityLink = typeof entityLinks.$inferSelect;
export type InsertEntityLink = z.infer<typeof insertEntityLinkSchema>;

export type EntityTag = typeof entityTags.$inferSelect;
export type InsertEntityTag = z.infer<typeof insertEntityTagSchema>;

export type UlysseCumulativeInsight = typeof ulysseCumulativeInsights.$inferSelect;
export type InsertUlysseCumulativeInsight = z.infer<typeof insertUlysseCumulativeInsightSchema>;

export type UlysseTaskOutcome = typeof ulysseTaskOutcomes.$inferSelect;
export type InsertUlysseTaskOutcome = z.infer<typeof insertUlysseTaskOutcomeSchema>;

export type UlysseSkillScore = typeof ulysseSkillScores.$inferSelect;
export type InsertUlysseSkillScore = z.infer<typeof insertUlysseSkillScoreSchema>;

export type UlysseErrorMemory = typeof ulysseErrorMemory.$inferSelect;
export type InsertUlysseErrorMemory = z.infer<typeof insertUlysseErrorMemorySchema>;

export type UlysseToolPerformance = typeof ulysseToolPerformance.$inferSelect;
export type InsertUlysseToolPerformance = z.infer<typeof insertUlysseToolPerformanceSchema>;
