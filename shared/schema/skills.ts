import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const skills = pgTable("skills", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description").notNull(),
  category: text("category").notNull().default("general"),
  icon: text("icon").default("Zap"),
  enabled: boolean("enabled").notNull().default(true),
  requiredTools: text("required_tools").array().default([]),
  allowedAgents: text("allowed_agents").array().default([]),
  triggerPatterns: text("trigger_patterns").array().default([]),
  metadata: jsonb("metadata"),
  executionCount: integer("execution_count").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  avgLatencyMs: integer("avg_latency_ms"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const skillSteps = pgTable("skill_steps", {
  id: serial("id").primaryKey(),
  skillId: integer("skill_id").notNull(),
  stepOrder: integer("step_order").notNull(),
  name: text("name").notNull(),
  toolName: text("tool_name").notNull(),
  parameters: jsonb("parameters"),
  outputKey: text("output_key"),
  conditionExpr: text("condition_expr"),
  onErrorAction: text("on_error_action").default("stop"),
  metadata: jsonb("metadata"),
});

export const skillExecutions = pgTable("skill_executions", {
  id: serial("id").primaryKey(),
  skillId: integer("skill_id").notNull(),
  userId: integer("user_id").notNull(),
  traceId: text("trace_id"),
  status: text("status").notNull().default("running"),
  stepsCompleted: integer("steps_completed").notNull().default(0),
  totalSteps: integer("total_steps").notNull(),
  input: jsonb("input"),
  output: jsonb("output"),
  latencyMs: integer("latency_ms"),
  errorMessage: text("error_message"),
  stepResults: jsonb("step_results"),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertSkillSchema = createInsertSchema(skills).omit({ id: true, executionCount: true, successCount: true, avgLatencyMs: true });
export const insertSkillStepSchema = createInsertSchema(skillSteps).omit({ id: true });
export const insertSkillExecutionSchema = createInsertSchema(skillExecutions).omit({ id: true });

export type Skill = typeof skills.$inferSelect;
export type InsertSkill = z.infer<typeof insertSkillSchema>;
export type SkillStep = typeof skillSteps.$inferSelect;
export type InsertSkillStep = z.infer<typeof insertSkillStepSchema>;
export type SkillExecution = typeof skillExecutions.$inferSelect;
export type InsertSkillExecution = z.infer<typeof insertSkillExecutionSchema>;
