import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const capabilityRegistry = pgTable("capability_registry", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  marker: text("marker"),
  isAvailable: boolean("is_available").notNull().default(true),
  lastVerified: timestamp("last_verified").defaultNow(),
  failureReason: text("failure_reason"),
  version: text("version").notNull().default("1.0.0"),
  dependencies: text("dependencies").array().default([]),
  usageCount: integer("usage_count").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  failureCount: integer("failure_count").notNull().default(0),
  lastUsed: timestamp("last_used"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const actionLogs = pgTable("action_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  persona: text("persona").notNull().default("ulysse"),
  actionType: text("action_type").notNull(),
  actionCategory: text("action_category").notNull(),
  inputPayload: jsonb("input_payload"),
  outputPayload: jsonb("output_payload"),
  status: text("status").notNull().default("pending"),
  effectivenessScore: integer("effectiveness_score"),
  coherenceScore: integer("coherence_score"),
  precisionScore: integer("precision_score"),
  overallScore: integer("overall_score"),
  validationNotes: text("validation_notes"),
  errorMessage: text("error_message"),
  executionTimeMs: integer("execution_time_ms"),
  wasRolledBack: boolean("was_rolled_back").notNull().default(false),
  relatedActionId: integer("related_action_id"),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const diagnosticRuns = pgTable("diagnostic_runs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  runType: text("run_type").notNull(),
  triggeredBy: text("triggered_by").notNull(),
  status: text("status").notNull().default("running"),
  systemHealth: jsonb("system_health"),
  interfaceHealth: jsonb("interface_health"),
  communicationHealth: jsonb("communication_health"),
  overallScore: integer("overall_score"),
  findingsCount: integer("findings_count").notNull().default(0),
  criticalCount: integer("critical_count").notNull().default(0),
  warningCount: integer("warning_count").notNull().default(0),
  infoCount: integer("info_count").notNull().default(0),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const diagnosticFindings = pgTable("diagnostic_findings", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull(),
  domain: text("domain").notNull(),
  component: text("component").notNull(),
  severity: text("severity").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  recommendation: text("recommendation"),
  selfHealingAction: text("self_healing_action"),
  canAutoFix: boolean("can_auto_fix").notNull().default(false),
  wasAutoFixed: boolean("was_auto_fixed").notNull().default(false),
  fixResult: text("fix_result"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

export const capabilityChangelog = pgTable("capability_changelog", {
  id: serial("id").primaryKey(),
  capabilityId: integer("capability_id"),
  changeType: text("change_type").notNull(),
  previousValue: jsonb("previous_value"),
  newValue: jsonb("new_value"),
  reason: text("reason"),
  version: text("version").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCapabilityRegistrySchema = createInsertSchema(capabilityRegistry).omit({ id: true, createdAt: true, updatedAt: true, lastVerified: true });
export const insertActionLogSchema = createInsertSchema(actionLogs).omit({ id: true, startedAt: true, completedAt: true });
export const insertDiagnosticRunSchema = createInsertSchema(diagnosticRuns).omit({ id: true, startedAt: true, completedAt: true });
export const insertDiagnosticFindingSchema = createInsertSchema(diagnosticFindings).omit({ id: true, createdAt: true, resolvedAt: true });
export const insertCapabilityChangelogSchema = createInsertSchema(capabilityChangelog).omit({ id: true, createdAt: true });

export type CapabilityRegistry = typeof capabilityRegistry.$inferSelect;
export type InsertCapabilityRegistry = z.infer<typeof insertCapabilityRegistrySchema>;

export type ActionLog = typeof actionLogs.$inferSelect;
export type InsertActionLog = z.infer<typeof insertActionLogSchema>;

export type DiagnosticRun = typeof diagnosticRuns.$inferSelect;
export type InsertDiagnosticRun = z.infer<typeof insertDiagnosticRunSchema>;

export type DiagnosticFinding = typeof diagnosticFindings.$inferSelect;
export type InsertDiagnosticFinding = z.infer<typeof insertDiagnosticFindingSchema>;

export type CapabilityChangelog = typeof capabilityChangelog.$inferSelect;
export type InsertCapabilityChangelog = z.infer<typeof insertCapabilityChangelogSchema>;
