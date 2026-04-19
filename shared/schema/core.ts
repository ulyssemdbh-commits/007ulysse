import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  projectId: integer("project_id"),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("todo"),
  priority: text("priority").default("medium"),
  dueDate: timestamp("due_date"),
  recurrenceType: text("recurrence_type"),
  recurrenceInterval: integer("recurrence_interval").default(1),
  parentTaskId: integer("parent_task_id"),
  source: text("source").default("manual"),
  context: text("context"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const subtasks = pgTable("subtasks", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(),
  title: text("title").notNull(),
  completed: boolean("completed").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const taskLabels = pgTable("task_labels", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#6366f1"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const taskLabelAssignments = pgTable("task_label_assignments", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(),
  labelId: integer("label_id").notNull(),
});

export const notes = pgTable("notes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  projectId: integer("project_id"),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const ulysseState = pgTable("ulysse_state", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  level: integer("level").notNull().default(1),
  experience: integer("experience").notNull().default(0),
  unlockedFeatures: text("unlocked_features").array().notNull().default([]),
  capabilities: jsonb("capabilities").default({}),
  personality: text("personality").default("helpful"),
  lastInteraction: timestamp("last_interaction").defaultNow(),
  totalConversations: integer("total_conversations").notNull().default(0),
  totalTasksCompleted: integer("total_tasks_completed").notNull().default(0),
});

export const ulysseMemory = pgTable("ulysse_memory", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  category: text("category").notNull(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  confidence: integer("confidence").notNull().default(50),
  source: text("source"),
  verified: boolean("verified").default(false),
  metadata: jsonb("metadata").$type<Record<string, any> | null>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const projectMemory = pgTable("project_memory", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  projectId: integer("project_id"),
  projectName: text("project_name").notNull(),
  summary: text("summary"),
  techStack: text("tech_stack").array().default([]),
  goals: text("goals").array().default([]),
  decisions: jsonb("decisions").default([]),
  challenges: text("challenges").array().default([]),
  nextSteps: text("next_steps").array().default([]),
  status: text("status").default("active"),
  lastDiscussed: timestamp("last_discussed").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const webSearchMemory = pgTable("web_search_memory", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  query: text("query").notNull(),
  topic: text("topic"),
  keyFindings: text("key_findings").array().default([]),
  sources: jsonb("sources").default([]),
  userContext: text("user_context"),
  learnedInsights: text("learned_insights"),
  usefulnessScore: integer("usefulness_score").default(50),
  timesReferenced: integer("times_referenced").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  reliabilityScore: integer("reliability_score").default(0),
  tags: text("tags").array().default([]),
  category: text("category"),
  domain: text("domain"),
  confidenceScore: integer("confidence_score").default(0),
  expiresAt: timestamp("expires_at"),
  policyReport: jsonb("policy_report").default({}),
});

export const marsSearchHistory = pgTable("mars_search_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  query: text("query").notNull(),
  queryType: text("query_type").notNull(),
  success: boolean("success").notNull().default(true),
  totalTime: integer("total_time"),
  sourceCount: integer("source_count").default(0),
  verifiedFactCount: integer("verified_fact_count").default(0),
  confidenceLevel: text("confidence_level"),
  directAnswers: jsonb("direct_answers").default([]),
  verifiedFacts: jsonb("verified_facts").default([]),
  topSources: jsonb("top_sources").default([]),
  crawledContent: text("crawled_content"),
  canRespond: boolean("can_respond").default(true),
  disclaimers: text("disclaimers").array().default([]),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const ulysseDiagnostics = pgTable("ulysse_diagnostics", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  reportedBy: text("reported_by").notNull().default("ulysse"),
  syncedToOwner: boolean("synced_to_owner").notNull().default(false),
  type: text("type").notNull(),
  component: text("component").notNull(),
  description: text("description").notNull(),
  severity: text("severity").notNull().default("medium"),
  status: text("status").notNull().default("detected"),
  rootCause: text("root_cause"),
  solution: text("solution"),
  proposedUpgrade: text("proposed_upgrade"),
  userImpact: text("user_impact"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const ulysseImprovements = pgTable("ulysse_improvements", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  originatedFrom: text("originated_from").notNull().default("ulysse"),
  category: text("category").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("proposed"),
  userFeedback: text("user_feedback"),
  implementedAt: timestamp("implemented_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const projectsRelations = relations(projects, ({ many }) => ({
  tasks: many(tasks),
  notes: many(notes),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
}));

export const notesRelations = relations(notes, ({ one }) => ({
  project: one(projects, {
    fields: [notes.projectId],
    references: [projects.id],
  }),
}));

export const ulysseFiles = pgTable("ulysse_files", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull().default("application/pdf"),
  sizeBytes: integer("size_bytes").notNull().default(0),
  storagePath: text("storage_path").notNull(),
  description: text("description"),
  generatedBy: text("generated_by").notNull().default("ulysse"),
  category: text("category").notNull().default("generated"),
  parentFileId: integer("parent_file_id"),
  version: integer("version").notNull().default(1),
  versionLabel: text("version_label"),
  editPrompt: text("edit_prompt"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const ulysseCodeSnapshots = pgTable("ulysse_code_snapshots", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").notNull(),
  version: text("version").notNull(),
  summary: text("summary"),
  filesCount: integer("files_count").notNull().default(0),
  totalSize: integer("total_size").notNull().default(0),
  codeContent: text("code_content").notNull(),
  structureMap: jsonb("structure_map").default({}),
  keyComponents: text("key_components").array().default([]),
  analysisNotes: text("analysis_notes"),
  lastAnalyzedAt: timestamp("last_analyzed_at"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const voiceSettings = pgTable("voice_settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  ttsVoice: text("tts_voice").notNull().default("onyx"),
  ttsSpeed: integer("tts_speed").notNull().default(100),
  ttsPitch: text("tts_pitch").notNull().default("normal"),
  ttsAutoSpeak: boolean("tts_auto_speak").notNull().default(true),
  ttsMaxLength: integer("tts_max_length").default(500),
  sttMode: text("stt_mode").notNull().default("auto"),
  sttLanguage: text("stt_language").notNull().default("fr-FR"),
  sttWakeWordEnabled: boolean("stt_wake_word_enabled").notNull().default(true),
  preferBrowserFallback: boolean("prefer_browser_fallback").notNull().default(false),
  voiceFeedbackEnabled: boolean("voice_feedback_enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const ulysseHomework = pgTable("ulysse_homework", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  instructions: text("instructions"),
  priority: text("priority").notNull().default("medium"),
  recurrence: text("recurrence").notNull().default("none"),
  status: text("status").notNull().default("pending"),
  enabled: boolean("enabled").notNull().default(true),
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  nextOccurrence: timestamp("next_occurrence"),
  nextRun: timestamp("next_run"),
  lastExecutedAt: timestamp("last_executed_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const homeworkExecution = pgTable("homework_execution", {
  id: serial("id").primaryKey(),
  homeworkId: integer("homework_id").notNull(),
  userId: integer("user_id").notNull(),
  triggeredBy: text("triggered_by").notNull().default("auto"),
  status: text("status").notNull().default("pending"),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  resultSummary: text("result_summary"),
  artifacts: jsonb("artifacts").default({}),
  error: text("error"),
});

export const taskQueues = pgTable("task_queues", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title").notNull(),
  source: text("source").notNull().default("chat"),
  status: text("status").notNull().default("pending"),
  totalItems: integer("total_items").notNull().default(0),
  completedItems: integer("completed_items").notNull().default(0),
  currentItemId: integer("current_item_id"),
  threadId: integer("thread_id"),
  createdAt: timestamp("created_at").defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

export const taskQueueItems = pgTable("task_queue_items", {
  id: serial("id").primaryKey(),
  queueId: integer("queue_id").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  title: text("title").notNull(),
  description: text("description"),
  toolName: text("tool_name"),
  toolArgs: jsonb("tool_args"),
  status: text("status").notNull().default("pending"),
  result: text("result"),
  error: text("error"),
  durationMs: integer("duration_ms"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

export const dgmSessions = pgTable("dgm_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  active: boolean("active").notNull().default(false),
  objective: text("objective"),
  repoContext: text("repo_context"),
  currentTaskId: integer("current_task_id"),
  totalTasks: integer("total_tasks").notNull().default(0),
  completedTasks: integer("completed_tasks").notNull().default(0),
  activatedAt: timestamp("activated_at"),
  deactivatedAt: timestamp("deactivated_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const dgmTasks = pgTable("dgm_tasks", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("pending"),
  testCriteria: text("test_criteria"),
  testResult: text("test_result"),
  codeChanges: jsonb("code_changes"),
  error: text("error"),
  impactedFiles: text("impacted_files").array(),
  riskScore: integer("risk_score"),
  riskLevel: text("risk_level"),
  prNumber: integer("pr_number"),
  prUrl: text("pr_url"),
  pipelineStage: text("pipeline_stage").notNull().default("pending"),
  reviewResult: jsonb("review_result"),
  deployResult: jsonb("deploy_result"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  testedAt: timestamp("tested_at"),
});

export const dgmPipelineRuns = pgTable("dgm_pipeline_runs", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  taskId: integer("task_id").notNull(),
  stage: text("stage").notNull(),
  status: text("status").notNull().default("running"),
  input: jsonb("input"),
  output: jsonb("output"),
  durationMs: integer("duration_ms"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const ambianceProfiles = pgTable("ambiance_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  isPreset: boolean("is_preset").notNull().default(false),
  isActive: boolean("is_active").notNull().default(false),
  visualMode: text("visual_mode").notNull().default("orb"),
  orbColor: text("orb_color").default("#6366f1"),
  orbIntensity: integer("orb_intensity").default(50),
  backgroundGradient: text("background_gradient"),
  autoSpeak: boolean("auto_speak").notNull().default(true),
  voiceSpeed: integer("voice_speed").default(100),
  voicePitch: integer("voice_pitch").default(100),
  ambientSound: text("ambient_sound"),
  ambientVolume: integer("ambient_volume").default(30),
  createdAt: timestamp("created_at").defaultNow(),
});

export const workJournal = pgTable("work_journal", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  context: text("context").notNull().default("general"),
  entryType: text("entry_type").notNull().default("task"),
  title: text("title").notNull(),
  content: text("content"),
  status: text("status").notNull().default("pending"),
  priority: text("priority").notNull().default("normal"),
  source: text("source").notNull().default("user"),
  relatedFiles: text("related_files").array(),
  tags: text("tags").array(),
  outcome: text("outcome"),
  parentId: integer("parent_id"),
  conversationId: integer("conversation_id"),
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertProjectSchema = createInsertSchema(projects).omit({ id: true, createdAt: true });
export const insertTaskSchema = createInsertSchema(tasks).omit({ id: true, createdAt: true });
export const insertSubtaskSchema = createInsertSchema(subtasks).omit({ id: true, createdAt: true });
export const insertTaskLabelSchema = createInsertSchema(taskLabels).omit({ id: true, createdAt: true });
export const insertTaskLabelAssignmentSchema = createInsertSchema(taskLabelAssignments).omit({ id: true });
export const insertNoteSchema = createInsertSchema(notes).omit({ id: true, createdAt: true });
export const insertUlysseStateSchema = createInsertSchema(ulysseState).omit({ id: true, lastInteraction: true });
export const insertUlysseMemorySchema = createInsertSchema(ulysseMemory).omit({ id: true, createdAt: true, updatedAt: true });
export const insertProjectMemorySchema = createInsertSchema(projectMemory).omit({ id: true, createdAt: true, lastDiscussed: true });
export const insertWebSearchMemorySchema = createInsertSchema(webSearchMemory).omit({ id: true, createdAt: true });
export const insertMarsSearchHistorySchema = createInsertSchema(marsSearchHistory).omit({ id: true, createdAt: true });
export const insertUlysseDiagnosticsSchema = createInsertSchema(ulysseDiagnostics).omit({ id: true, createdAt: true, resolvedAt: true });
export const insertUlysseImprovementsSchema = createInsertSchema(ulysseImprovements).omit({ id: true, createdAt: true, implementedAt: true });
export const insertVoiceSettingsSchema = createInsertSchema(voiceSettings).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAmbianceProfileSchema = createInsertSchema(ambianceProfiles).omit({ id: true, createdAt: true });
export const insertUlysseFileSchema = createInsertSchema(ulysseFiles).omit({ id: true, createdAt: true });
export const insertUlysseCodeSnapshotSchema = createInsertSchema(ulysseCodeSnapshots).omit({ id: true, createdAt: true, lastAnalyzedAt: true });
export const insertUlysseHomeworkSchema = createInsertSchema(ulysseHomework).omit({ id: true, createdAt: true, completedAt: true, lastExecutedAt: true });
export const insertHomeworkExecutionSchema = createInsertSchema(homeworkExecution).omit({ id: true, startedAt: true, completedAt: true });
export const insertTaskQueueSchema = createInsertSchema(taskQueues).omit({ id: true, createdAt: true, startedAt: true, completedAt: true });
export const insertTaskQueueItemSchema = createInsertSchema(taskQueueItems).omit({ id: true, startedAt: true, completedAt: true });
export const insertWorkJournalSchema = createInsertSchema(workJournal).omit({ id: true, createdAt: true, updatedAt: true, completedAt: true });

export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;

export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;

export type Subtask = typeof subtasks.$inferSelect;
export type InsertSubtask = z.infer<typeof insertSubtaskSchema>;

export type TaskLabel = typeof taskLabels.$inferSelect;
export type InsertTaskLabel = z.infer<typeof insertTaskLabelSchema>;

export type TaskLabelAssignment = typeof taskLabelAssignments.$inferSelect;
export type InsertTaskLabelAssignment = z.infer<typeof insertTaskLabelAssignmentSchema>;

export type TaskWithSubtasks = Task & { subtasks: Subtask[]; labels: TaskLabel[] };

export type Note = typeof notes.$inferSelect;
export type InsertNote = z.infer<typeof insertNoteSchema>;

export type UlysseState = typeof ulysseState.$inferSelect;
export type InsertUlysseState = z.infer<typeof insertUlysseStateSchema>;

export type UlysseMemory = typeof ulysseMemory.$inferSelect;
export type InsertUlysseMemory = z.infer<typeof insertUlysseMemorySchema>;

export type ProjectMemory = typeof projectMemory.$inferSelect;
export type InsertProjectMemory = z.infer<typeof insertProjectMemorySchema>;

export type WebSearchMemory = typeof webSearchMemory.$inferSelect;
export type InsertWebSearchMemory = z.infer<typeof insertWebSearchMemorySchema>;

export type MarsSearchHistory = typeof marsSearchHistory.$inferSelect;
export type InsertMarsSearchHistory = z.infer<typeof insertMarsSearchHistorySchema>;

export type UlysseDiagnostic = typeof ulysseDiagnostics.$inferSelect;
export type InsertUlysseDiagnostic = z.infer<typeof insertUlysseDiagnosticsSchema>;

export type UlysseImprovement = typeof ulysseImprovements.$inferSelect;
export type InsertUlysseImprovement = z.infer<typeof insertUlysseImprovementsSchema>;

export type VoiceSettings = typeof voiceSettings.$inferSelect;
export type InsertVoiceSettings = z.infer<typeof insertVoiceSettingsSchema>;

export type AmbianceProfile = typeof ambianceProfiles.$inferSelect;
export type InsertAmbianceProfile = z.infer<typeof insertAmbianceProfileSchema>;

export type UlysseFile = typeof ulysseFiles.$inferSelect;
export type InsertUlysseFile = z.infer<typeof insertUlysseFileSchema>;

export type UlysseCodeSnapshot = typeof ulysseCodeSnapshots.$inferSelect;
export type InsertUlysseCodeSnapshot = z.infer<typeof insertUlysseCodeSnapshotSchema>;

export type UlysseHomework = typeof ulysseHomework.$inferSelect;
export type InsertUlysseHomework = z.infer<typeof insertUlysseHomeworkSchema>;

export type HomeworkExecution = typeof homeworkExecution.$inferSelect;
export type InsertHomeworkExecution = z.infer<typeof insertHomeworkExecutionSchema>;

export type TaskQueue = typeof taskQueues.$inferSelect;
export type InsertTaskQueue = z.infer<typeof insertTaskQueueSchema>;

export type TaskQueueItem = typeof taskQueueItems.$inferSelect;
export type InsertTaskQueueItem = z.infer<typeof insertTaskQueueItemSchema>;

export type WorkJournalEntry = typeof workJournal.$inferSelect;
export type InsertWorkJournalEntry = z.infer<typeof insertWorkJournalSchema>;
