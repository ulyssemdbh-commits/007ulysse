import { db } from "../db";
import { agentTraces, traceSteps } from "@shared/schema";
import { eq, desc, sql, and, gte, lte, count } from "drizzle-orm";
import { randomUUID } from "crypto";
import { BrainService } from "./brainService";

export interface TraceContext {
  traceId: string;
  userId: number;
  agent: string;
  model: string;
  query: string;
  domain?: string;
  source?: string;
  startTime: number;
  steps: StepData[];
}

interface StepData {
  stepType: string;
  name: string;
  input?: any;
  output?: any;
  latencyMs?: number;
  tokensUsed?: number;
  status?: string;
  errorMessage?: string;
  metadata?: any;
}

class TraceCollector {
  private activeTraces = new Map<string, TraceContext>();

  startTrace(params: {
    userId: number;
    agent: string;
    model: string;
    query: string;
    domain?: string;
    source?: string;
  }): string {
    const traceId = `tr_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    this.activeTraces.set(traceId, {
      traceId,
      ...params,
      startTime: Date.now(),
      steps: [],
    });
    return traceId;
  }

  addStep(traceId: string, step: StepData): void {
    const ctx = this.activeTraces.get(traceId);
    if (!ctx) return;
    ctx.steps.push(step);
  }

  async endTrace(traceId: string, result: {
    response?: string;
    status?: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    toolsUsed?: string[];
    toolCallCount?: number;
    errorMessage?: string;
    metadata?: any;
  }): Promise<void> {
    const ctx = this.activeTraces.get(traceId);
    if (!ctx) return;

    const totalLatencyMs = Date.now() - ctx.startTime;

    try {
      await db.insert(agentTraces).values({
        traceId: ctx.traceId,
        userId: ctx.userId,
        agent: ctx.agent,
        model: ctx.model,
        query: ctx.query,
        response: result.response?.slice(0, 10000),
        status: result.status || "completed",
        totalLatencyMs,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.totalTokens,
        toolsUsed: result.toolsUsed || [],
        toolCallCount: result.toolCallCount || 0,
        errorMessage: result.errorMessage,
        domain: ctx.domain,
        source: ctx.source || "chat",
        metadata: result.metadata,
        startedAt: new Date(ctx.startTime),
        completedAt: new Date(),
      });

      if (ctx.steps.length > 0) {
        await db.insert(traceSteps).values(
          ctx.steps.map((s, i) => ({
            traceId: ctx.traceId,
            stepOrder: i + 1,
            stepType: s.stepType,
            name: s.name,
            input: s.input,
            output: s.output,
            latencyMs: s.latencyMs,
            tokensUsed: s.tokensUsed,
            status: s.status || "success",
            errorMessage: s.errorMessage,
            metadata: s.metadata,
          }))
        );
      }
    } catch (err: any) {
      console.error("[TraceCollector] Failed to save trace:", err.message);
    } finally {
      this.activeTraces.delete(traceId);
    }
  }

  async recordFeedback(traceId: string, feedback: string, score?: number): Promise<boolean> {
    try {
      await db.update(agentTraces)
        .set({ userFeedback: feedback, feedbackScore: score ?? null })
        .where(eq(agentTraces.traceId, traceId));

      try {
        const [trace] = await db.select().from(agentTraces).where(eq(agentTraces.traceId, traceId));
        if (trace) {
          const brainService = new BrainService();
          const isPositive = (score ?? 0) >= 0.5;
          await brainService.addKnowledge(trace.userId, {
            title: `[Trace Feedback] ${isPositive ? "👍" : "👎"} ${trace.agent}: ${trace.query.slice(0, 80)}`,
            content: `Agent: ${trace.agent}\nQuery: ${trace.query}\nFeedback: ${feedback}\nScore: ${score}\nLatence: ${trace.totalLatencyMs}ms\nOutils: ${(trace.toolsUsed || []).join(", ")}\nSource: ${trace.source}\nDomaine: ${trace.domain}`,
            type: "insight" as any,
            category: "operational" as any,
            importance: isPositive ? 60 : 85,
            confidence: 95,
            sourceType: "trace_feedback" as any,
          });
          console.log(`[TraceCollector] Feedback saved to Brain for trace ${traceId}`);
        }
      } catch (brainErr: any) {
        console.error("[TraceCollector] Brain sync failed:", brainErr.message);
      }

      return true;
    } catch (err: any) {
      console.error("[TraceCollector] Failed to record feedback:", err.message);
      return false;
    }
  }

  async getTraces(params: {
    userId?: number;
    agent?: string;
    domain?: string;
    status?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }) {
    const conditions: any[] = [];
    if (params.userId) conditions.push(eq(agentTraces.userId, params.userId));
    if (params.agent) conditions.push(eq(agentTraces.agent, params.agent));
    if (params.domain) conditions.push(eq(agentTraces.domain, params.domain));
    if (params.status) conditions.push(eq(agentTraces.status, params.status));
    if (params.from) conditions.push(gte(agentTraces.startedAt, params.from));
    if (params.to) conditions.push(lte(agentTraces.startedAt, params.to));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [traces, totalResult] = await Promise.all([
      db.select().from(agentTraces)
        .where(where)
        .orderBy(desc(agentTraces.startedAt))
        .limit(params.limit || 50)
        .offset(params.offset || 0),
      db.select({ count: count() }).from(agentTraces).where(where),
    ]);

    return { traces, total: totalResult[0]?.count || 0 };
  }

  async getTrace(traceId: string) {
    const [trace] = await db.select().from(agentTraces).where(eq(agentTraces.traceId, traceId));
    if (!trace) return null;
    const steps = await db.select().from(traceSteps)
      .where(eq(traceSteps.traceId, traceId))
      .orderBy(traceSteps.stepOrder);
    return { ...trace, steps };
  }

  async getStats(params?: { userId?: number; days?: number }) {
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - (params?.days || 30));

    const conditions: any[] = [gte(agentTraces.startedAt, daysAgo)];
    if (params?.userId) conditions.push(eq(agentTraces.userId, params.userId));
    const where = and(...conditions);

    const [totalTraces] = await db.select({ count: count() }).from(agentTraces).where(where);

    const agentStats = await db.select({
      agent: agentTraces.agent,
      count: count(),
      avgLatency: sql<number>`AVG(${agentTraces.totalLatencyMs})::int`,
      avgTokens: sql<number>`AVG(${agentTraces.totalTokens})::int`,
      successRate: sql<number>`ROUND(100.0 * SUM(CASE WHEN ${agentTraces.status} = 'completed' THEN 1 ELSE 0 END) / COUNT(*), 1)`,
      avgFeedback: sql<number>`AVG(${agentTraces.feedbackScore})`,
    }).from(agentTraces).where(where).groupBy(agentTraces.agent);

    const modelStats = await db.select({
      model: agentTraces.model,
      count: count(),
      avgLatency: sql<number>`AVG(${agentTraces.totalLatencyMs})::int`,
      avgTokens: sql<number>`AVG(${agentTraces.totalTokens})::int`,
    }).from(agentTraces).where(where).groupBy(agentTraces.model);

    const topTools = await db.select({
      tool: sql<string>`unnest(${agentTraces.toolsUsed})`,
      count: count(),
    }).from(agentTraces).where(where)
      .groupBy(sql`unnest(${agentTraces.toolsUsed})`)
      .orderBy(desc(count()))
      .limit(15);

    const dailyVolume = await db.select({
      date: sql<string>`DATE(${agentTraces.startedAt})`,
      count: count(),
      avgLatency: sql<number>`AVG(${agentTraces.totalLatencyMs})::int`,
    }).from(agentTraces).where(where)
      .groupBy(sql`DATE(${agentTraces.startedAt})`)
      .orderBy(sql`DATE(${agentTraces.startedAt})`);

    return {
      totalTraces: totalTraces?.count || 0,
      agentStats,
      modelStats,
      topTools,
      dailyVolume,
    };
  }
}

export const traceCollector = new TraceCollector();
