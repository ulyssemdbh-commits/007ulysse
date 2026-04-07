import { db } from "../db";
import {
  usageEvents,
  userBehaviorEvents,
  diagnosticRuns,
  diagnosticFindings,
  styleGuides,
  patchProposals,
} from "@shared/schema";
import { eq, and, desc, sql, gte } from "drizzle-orm";

class AISystemIntegrationService {

  async trackUsageEvent(params: {
    userId: number;
    module: string;
    feature: string;
    persona?: string;
    durationMs?: number;
    success?: boolean;
    errorMessage?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    try {
      await db.insert(usageEvents).values({
        userId: params.userId,
        module: params.module,
        feature: params.feature,
        persona: params.persona,
        durationMs: params.durationMs,
        success: params.success ?? true,
        errorMessage: params.errorMessage,
        metadata: params.metadata,
      });
    } catch (err) {
      console.error("[AISystem] Failed to track usage event:", err);
    }
  }

  async trackBehaviorEvent(params: {
    userId: number;
    eventType: string;
    eventSource: string;
    targetType?: string;
    targetId?: number;
    targetName?: string;
    context?: Record<string, any>;
    previousState?: Record<string, any>;
    newState?: Record<string, any>;
  }): Promise<void> {
    try {
      const now = new Date();
      await db.insert(userBehaviorEvents).values({
        userId: params.userId,
        eventType: params.eventType,
        eventSource: params.eventSource,
        targetType: params.targetType,
        targetId: params.targetId,
        targetName: params.targetName,
        context: {
          ...params.context,
          hour: now.getHours(),
          dayOfWeek: now.getDay(),
          timestamp: now.toISOString(),
        },
        previousState: params.previousState || {},
        newState: params.newState || {},
      });
    } catch (err) {
      console.error("[AISystem] Failed to track behavior event:", err);
    }
  }

  async runDiagnostic(params: {
    userId?: number;
    runType: string;
    triggeredBy: string;
  }): Promise<{
    runId: number;
    overallScore: number;
    findings: Array<{
      domain: string;
      component: string;
      severity: string;
      title: string;
      description: string;
      recommendation?: string;
      canAutoFix: boolean;
    }>;
  }> {
    const [run] = await db.insert(diagnosticRuns).values({
      userId: params.userId,
      runType: params.runType,
      triggeredBy: params.triggeredBy,
      status: "running",
    }).returning();

    const findings: Array<{
      domain: string;
      component: string;
      severity: string;
      title: string;
      description: string;
      recommendation?: string;
      canAutoFix: boolean;
    }> = [];

    try {
      const dbCheck = await this.checkDatabase();
      findings.push(...dbCheck);

      const apiCheck = await this.checkAPIHealth();
      findings.push(...apiCheck);

      const memCheck = this.checkMemoryUsage();
      findings.push(...memCheck);

      const tableCheck = await this.checkEmptyTables();
      findings.push(...tableCheck);

      for (const finding of findings) {
        await db.insert(diagnosticFindings).values({
          runId: run.id,
          domain: finding.domain,
          component: finding.component,
          severity: finding.severity,
          title: finding.title,
          description: finding.description,
          recommendation: finding.recommendation,
          canAutoFix: finding.canAutoFix,
        });
      }

      const criticalCount = findings.filter(f => f.severity === "critical").length;
      const warningCount = findings.filter(f => f.severity === "warning").length;
      const infoCount = findings.filter(f => f.severity === "info").length;
      const overallScore = Math.max(0, 100 - (criticalCount * 25) - (warningCount * 10) - (infoCount * 2));

      await db.update(diagnosticRuns)
        .set({
          status: "completed",
          overallScore,
          findingsCount: findings.length,
          criticalCount,
          warningCount,
          infoCount,
          systemHealth: { score: overallScore, checks: findings.filter(f => f.domain === "system") },
          interfaceHealth: { score: 100, checks: findings.filter(f => f.domain === "interface") },
          communicationHealth: { score: 100, checks: findings.filter(f => f.domain === "communication") },
          completedAt: new Date(),
        })
        .where(eq(diagnosticRuns.id, run.id));

      console.log(`[AISystem] Diagnostic run #${run.id} complete: score=${overallScore}, findings=${findings.length} (${criticalCount}C/${warningCount}W/${infoCount}I)`);

      return { runId: run.id, overallScore, findings };
    } catch (err) {
      await db.update(diagnosticRuns)
        .set({ status: "failed", completedAt: new Date() })
        .where(eq(diagnosticRuns.id, run.id));
      throw err;
    }
  }

  private async checkDatabase(): Promise<Array<any>> {
    const findings: any[] = [];
    try {
      const start = Date.now();
      await db.execute(sql`SELECT 1`);
      const duration = Date.now() - start;

      if (duration > 500) {
        findings.push({
          domain: "system",
          component: "database",
          severity: "warning",
          title: "Latence base de données élevée",
          description: `Temps de réponse DB: ${duration}ms (seuil: 500ms)`,
          recommendation: "Vérifier la charge du serveur PostgreSQL",
          canAutoFix: false,
        });
      } else {
        findings.push({
          domain: "system",
          component: "database",
          severity: "info",
          title: "Base de données OK",
          description: `Temps de réponse: ${duration}ms`,
          canAutoFix: false,
        });
      }

      const bloatResult = await db.execute(sql`
        SELECT count(*) as table_count,
               sum((xpath('/row/cnt/text()', query_to_xml('SELECT count(*) as cnt FROM "' || tablename || '"', false, true, '')))[1]::text::int) as total_rows
        FROM pg_tables WHERE schemaname = 'public'
      `);
      const bloatRows = (bloatResult as any).rows || bloatResult;
      const bloat = Array.isArray(bloatRows) ? bloatRows[0] : bloatRows;
      
      const totalRows = Number((bloat as any)?.total_rows) || 0;
      if (totalRows > 1000000) {
        findings.push({
          domain: "system",
          component: "database",
          severity: "warning",
          title: "Volume de données élevé",
          description: `${totalRows.toLocaleString()} lignes au total. Envisager un archivage des anciennes données.`,
          recommendation: "Archiver perf_metrics et capability_changelog (>30 jours)",
          canAutoFix: true,
        });
      }
    } catch (err) {
      findings.push({
        domain: "system",
        component: "database",
        severity: "critical",
        title: "Base de données inaccessible",
        description: `Erreur: ${(err as Error).message}`,
        recommendation: "Vérifier DATABASE_URL et la connectivité",
        canAutoFix: false,
      });
    }
    return findings;
  }

  private async checkAPIHealth(): Promise<Array<any>> {
    const findings: any[] = [];
    
    if (!process.env.OPENAI_API_KEY) {
      findings.push({
        domain: "system",
        component: "openai",
        severity: "critical",
        title: "Clé API OpenAI manquante",
        description: "OPENAI_API_KEY non configurée",
        canAutoFix: false,
      });
    }

    if (!process.env.GITHUB_TOKEN) {
      findings.push({
        domain: "communication",
        component: "github",
        severity: "warning",
        title: "Token GitHub manquant",
        description: "GITHUB_TOKEN non configuré, DevOps limité",
        canAutoFix: false,
      });
    }

    return findings;
  }

  private checkMemoryUsage(): Array<any> {
    const findings: any[] = [];
    const mem = process.memoryUsage();
    const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
    const rssMB = Math.round(mem.rss / 1024 / 1024);

    if (heapUsedMB > 1500) {
      findings.push({
        domain: "system",
        component: "memory",
        severity: "critical",
        title: "Mémoire heap critique",
        description: `Heap: ${heapUsedMB}MB/${heapTotalMB}MB, RSS: ${rssMB}MB`,
        recommendation: "Redémarrer le service, vérifier les fuites mémoire",
        canAutoFix: true,
      });
    } else if (heapUsedMB > 800) {
      findings.push({
        domain: "system",
        component: "memory",
        severity: "warning",
        title: "Mémoire heap élevée",
        description: `Heap: ${heapUsedMB}MB/${heapTotalMB}MB, RSS: ${rssMB}MB`,
        canAutoFix: false,
      });
    } else {
      findings.push({
        domain: "system",
        component: "memory",
        severity: "info",
        title: "Mémoire OK",
        description: `Heap: ${heapUsedMB}MB/${heapTotalMB}MB, RSS: ${rssMB}MB`,
        canAutoFix: false,
      });
    }

    return findings;
  }

  private async checkEmptyTables(): Promise<Array<any>> {
    const findings: any[] = [];
    try {
      const result = await db.execute(sql`
        SELECT count(*) as empty_count FROM (
          SELECT tablename FROM pg_tables WHERE schemaname = 'public'
          AND (xpath('/row/cnt/text()', query_to_xml('SELECT count(*) as cnt FROM "' || tablename || '"', false, true, '')))[1]::text::int = 0
        ) t
      `);
      const emptyCount = Number((result as any)[0]?.empty_count) || 0;
      if (emptyCount > 50) {
        findings.push({
          domain: "system",
          component: "schema",
          severity: "info",
          title: `${emptyCount} tables vides`,
          description: "Certaines fonctionnalités structurées ne sont pas encore utilisées",
          recommendation: "Vérifier si les tables vides correspondent à des features planifiées",
          canAutoFix: false,
        });
      }
    } catch {}
    return findings;
  }

  async saveStyleGuide(params: {
    userId: number;
    snapshotId: string;
    rules: Array<{
      category: string;
      rule: string;
      examples: string[];
      confidence: number;
    }>;
    analysis: {
      frameworks: string[];
      conventions: Record<string, string>;
      patterns: string[];
      antiPatterns: string[];
    };
  }): Promise<number> {
    const [guide] = await db.insert(styleGuides).values({
      userId: params.userId,
      snapshotId: params.snapshotId,
      rules: params.rules,
      analysis: params.analysis,
    }).returning();
    console.log(`[AISystem] Style guide saved: ${params.snapshotId} (${params.rules.length} rules)`);
    return guide.id;
  }

  async getLatestStyleGuide(userId: number): Promise<any | null> {
    const [guide] = await db.select()
      .from(styleGuides)
      .where(eq(styleGuides.userId, userId))
      .orderBy(desc(styleGuides.createdAt))
      .limit(1);
    return guide || null;
  }

  async savePatchProposal(params: {
    userId: number;
    title: string;
    description?: string;
    diff: string;
    files: Array<{
      path: string;
      action: 'add' | 'modify' | 'delete';
      additions: number;
      deletions: number;
    }>;
    changelog?: string;
  }): Promise<number> {
    const [patch] = await db.insert(patchProposals).values({
      userId: params.userId,
      title: params.title,
      description: params.description,
      diff: params.diff,
      files: params.files,
      changelog: params.changelog,
    }).returning();
    console.log(`[AISystem] Patch proposal #${patch.id}: "${params.title}" (${params.files.length} files)`);
    return patch.id;
  }

  async getPendingPatches(userId: number): Promise<any[]> {
    return db.select()
      .from(patchProposals)
      .where(and(
        eq(patchProposals.userId, userId),
        eq(patchProposals.status, "pending")
      ))
      .orderBy(desc(patchProposals.createdAt));
  }

  async updatePatchStatus(patchId: number, status: "applied" | "rejected"): Promise<void> {
    await db.update(patchProposals)
      .set({
        status,
        appliedAt: status === "applied" ? new Date() : undefined,
      })
      .where(eq(patchProposals.id, patchId));
  }

  async getUsageStats(userId: number, days: number = 30): Promise<{
    totalEvents: number;
    byModule: Record<string, number>;
    byPersona: Record<string, number>;
    errorRate: number;
    topFeatures: Array<{ feature: string; count: number }>;
  }> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const events = await db.select()
      .from(usageEvents)
      .where(and(
        eq(usageEvents.userId, userId),
        gte(usageEvents.createdAt, since)
      ));

    const byModule: Record<string, number> = {};
    const byPersona: Record<string, number> = {};
    const byFeature: Record<string, number> = {};
    let errorCount = 0;

    for (const event of events) {
      byModule[event.module] = (byModule[event.module] || 0) + 1;
      if (event.persona) {
        byPersona[event.persona] = (byPersona[event.persona] || 0) + 1;
      }
      byFeature[`${event.module}:${event.feature}`] = (byFeature[`${event.module}:${event.feature}`] || 0) + 1;
      if (!event.success) errorCount++;
    }

    const topFeatures = Object.entries(byFeature)
      .map(([feature, count]) => ({ feature, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalEvents: events.length,
      byModule,
      byPersona,
      errorRate: events.length > 0 ? Math.round((errorCount / events.length) * 100) : 0,
      topFeatures,
    };
  }

  async getDiagnosticHistory(limit: number = 10): Promise<any[]> {
    return db.select()
      .from(diagnosticRuns)
      .orderBy(desc(diagnosticRuns.startedAt))
      .limit(limit);
  }

  async getDiagnosticFindings(runId: number): Promise<any[]> {
    return db.select()
      .from(diagnosticFindings)
      .where(eq(diagnosticFindings.runId, runId))
      .orderBy(desc(diagnosticFindings.severity));
  }
}

export const aiSystemIntegration = new AISystemIntegrationService();
