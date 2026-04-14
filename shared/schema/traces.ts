import { pgTable, text, serial, integer, timestamp, jsonb, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const agentTraces = pgTable("agent_traces", {
  id: serial("id").primaryKey(),
  traceId: text("trace_id").notNull().unique(),
  userId: integer("user_id").notNull(),
  agent: text("agent").notNull(),
  model: text("model").notNull(),
  query: text("query").notNull(),
  response: text("response"),
  status: text("status").notNull().default("running"),
  totalLatencyMs: integer("total_latency_ms"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  totalTokens: integer("total_tokens"),
  toolsUsed: text("tools_used").array().default([]),
  toolCallCount: integer("tool_call_count").default(0),
  errorMessage: text("error_message"),
  userFeedback: text("user_feedback"),
  feedbackScore: real("feedback_score"),
  domain: text("domain"),
  source: text("source").default("chat"),
  metadata: jsonb("metadata"),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const traceSteps = pgTable("trace_steps", {
  id: serial("id").primaryKey(),
  traceId: text("trace_id").notNull(),
  stepOrder: integer("step_order").notNull(),
  stepType: text("step_type").notNull(),
  name: text("name").notNull(),
  input: jsonb("input"),
  output: jsonb("output"),
  latencyMs: integer("latency_ms"),
  tokensUsed: integer("tokens_used"),
  status: text("status").notNull().default("success"),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAgentTraceSchema = createInsertSchema(agentTraces).omit({ id: true });
export const insertTraceStepSchema = createInsertSchema(traceSteps).omit({ id: true });

export type AgentTrace = typeof agentTraces.$inferSelect;
export type InsertAgentTrace = z.infer<typeof insertAgentTraceSchema>;
export type TraceStep = typeof traceSteps.$inferSelect;
export type InsertTraceStep = z.infer<typeof insertTraceStepSchema>;
