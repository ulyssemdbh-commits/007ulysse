/**
 * DevMax Standalone — Database Schema
 * Only DevMax-specific tables (extracted from Ulysse monolith).
 */
import { pgTable, text, serial, integer, boolean, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── Sessions ──
export const devmaxSessions = pgTable("devmax_sessions", {
  id: text("id").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
  displayName: text("display_name"),
  userId: text("user_id"),
  tenantId: text("tenant_id"),
  createdAt: timestamp("created_at").defaultNow(),
  lastActiveAt: timestamp("last_active_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
});

// ── Activity Log ──
export const devmaxActivityLog = pgTable("devmax_activity_log", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  action: text("action").notNull(),
  target: text("target"),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ── Projects ──
export const devmaxProjects = pgTable("devmax_projects", {
  id: text("id").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  repoOwner: text("repo_owner"),
  repoName: text("repo_name"),
  repoUrl: text("repo_url"),
  techStack: text("tech_stack").array(),
  deploySlug: text("deploy_slug"),
  deployUrl: text("deploy_url"),
  stagingUrl: text("staging_url"),
  stagingPort: integer("staging_port"),
  productionUrl: text("production_url"),
  productionPort: integer("production_port"),
  environment: text("environment").default("staging"),
  lastDeployedAt: timestamp("last_deployed_at"),
  lastPromotedAt: timestamp("last_promoted_at"),
  status: text("status").default("active"),
  config: jsonb("config"),
  githubToken: text("github_token"),
  githubProvider: text("github_provider").default("owner"),
  githubUser: text("github_user"),
  githubScopes: text("github_scopes"),
  githubConnectedAt: timestamp("github_connected_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ── Chat History ──
export const devmaxChatHistory = pgTable("devmax_chat_history", {
  id: serial("id").primaryKey(),
  projectId: text("project_id"),
  sessionId: text("session_id").notNull(),
  threadId: integer("thread_id"),
  role: text("role").notNull(),
  content: text("content").notNull(),
  toolCalls: jsonb("tool_calls"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ── Project Journal ──
export const devmaxProjectJournal = pgTable("devmax_project_journal", {
  id: serial("id").primaryKey(),
  projectId: text("project_id").notNull(),
  sessionId: text("session_id"),
  entryType: text("entry_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  filesChanged: text("files_changed").array(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ── DGM (DevOps Governance Model) ──
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

// ── Insert Schemas ──
export const insertDevmaxSessionSchema = createInsertSchema(devmaxSessions);
export const insertDevmaxActivityLogSchema = createInsertSchema(devmaxActivityLog).omit({ id: true, createdAt: true });
export const insertDevmaxProjectSchema = createInsertSchema(devmaxProjects);
export const insertDevmaxChatHistorySchema = createInsertSchema(devmaxChatHistory).omit({ id: true, createdAt: true });
export const insertDevmaxProjectJournalSchema = createInsertSchema(devmaxProjectJournal).omit({ id: true, createdAt: true });

// ── Types ──
export type DevmaxSession = typeof devmaxSessions.$inferSelect;
export type DevmaxActivityLogEntry = typeof devmaxActivityLog.$inferSelect;
export type DevmaxProject = typeof devmaxProjects.$inferSelect;
export type DevmaxChatMessage = typeof devmaxChatHistory.$inferSelect;
export type DevmaxProjectJournal = typeof devmaxProjectJournal.$inferSelect;
