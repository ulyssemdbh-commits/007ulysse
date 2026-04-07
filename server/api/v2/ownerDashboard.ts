import { Router, Request, Response } from "express";
import { db } from "../../db";
import { knowledgeBase, users } from "@shared/schema";
import { eq, sql, and, desc, gte } from "drizzle-orm";
import { sportsPredictionMemoryService } from "../../services/sportsPredictionMemoryService";
import { jobScheduler } from "../../services/scheduledJobs";
import { metricsService } from "../../services/metricsService";
import { diagnosticsService } from "../../services/diagnostics";

const router = Router();

interface BrainHealth {
  totalKnowledge: number;
  byLayer: { L1: number; L2: number; L3: number; L4: number; L5: number };
  byDomain: Record<string, { count: number; avgConfidence: number }>;
  recentInsights: Array<{ id: number; title: string; layer: string; confidence: number; createdAt: Date }>;
}

interface PronosStats {
  total: number;
  pending: number;
  won: number;
  lost: number;
  successRate: number;
  roi: number;
  bySport: Record<string, { total: number; won: number; rate: number }>;
  recentResults: Array<{ match: string; bet: string; won: boolean; date: string }>;
}

interface JobsStatus {
  total: number;
  enabled: number;
  recentExecutions: Array<{ name: string; lastRun: string; success: boolean; duration: number }>;
  upcomingJobs: Array<{ name: string; nextRun: string }>;
}

interface OwnerDashboard {
  timestamp: string;
  brain: BrainHealth;
  pronos: PronosStats;
  jobs: JobsStatus;
  systemHealth: {
    status: string;
    uptime: number;
    dependencies: Record<string, boolean>;
  };
}

async function getBrainHealth(userId: number): Promise<BrainHealth> {
  const allKnowledge = await db.select().from(knowledgeBase)
    .where(eq(knowledgeBase.userId, userId));

  const byLayer = { L1: 0, L2: 0, L3: 0, L4: 0, L5: 0 };
  const byDomain: Record<string, { count: number; totalConfidence: number }> = {};

  for (const k of allKnowledge) {
    const tags = k.tags || [];
    
    if (tags.includes("L5")) byLayer.L5++;
    else if (tags.includes("L4")) byLayer.L4++;
    else if (tags.includes("L3")) byLayer.L3++;
    else if (tags.includes("L2")) byLayer.L2++;
    else byLayer.L1++;

    const domains = ["sports", "trading", "sugu", "dev", "perso"];
    for (const domain of domains) {
      if (tags.includes(domain)) {
        if (!byDomain[domain]) byDomain[domain] = { count: 0, totalConfidence: 0 };
        byDomain[domain].count++;
        byDomain[domain].totalConfidence += k.confidence || 50;
      }
    }
  }

  const domainStats: Record<string, { count: number; avgConfidence: number }> = {};
  for (const [domain, data] of Object.entries(byDomain)) {
    domainStats[domain] = {
      count: data.count,
      avgConfidence: data.count > 0 ? Math.round(data.totalConfidence / data.count) : 0
    };
  }

  const recentInsights = await db.select().from(knowledgeBase)
    .where(and(
      eq(knowledgeBase.userId, userId),
      sql`${knowledgeBase.tags} @> ARRAY['L4']::text[] OR ${knowledgeBase.tags} @> ARRAY['L5']::text[]`
    ))
    .orderBy(desc(knowledgeBase.createdAt))
    .limit(5);

  return {
    totalKnowledge: allKnowledge.length,
    byLayer,
    byDomain: domainStats,
    recentInsights: recentInsights.map(k => ({
      id: k.id,
      title: k.title,
      layer: k.tags?.includes("L5") ? "L5" : "L4",
      confidence: k.confidence || 50,
      createdAt: k.createdAt || new Date()
    }))
  };
}

async function getPronosStats(): Promise<PronosStats> {
  const stats = await sportsPredictionMemoryService.getPredictionStats();
  
  const { sportsPredictionSnapshots } = await import("@shared/schema");
  const recentPredictions = await db.select()
    .from(sportsPredictionSnapshots)
    .where(sql`${sportsPredictionSnapshots.actualResult} IS NOT NULL`)
    .orderBy(desc(sportsPredictionSnapshots.updatedAt))
    .limit(10);

  const recentResults = recentPredictions.map(p => {
    const perf = p.predictionPerformance as any;
    const recs = p.recommendations as any;
    return {
      match: `${p.homeTeam} vs ${p.awayTeam}`,
      bet: recs?.bestBet || "N/A",
      won: perf?.mainBetWon || false,
      date: p.matchDate?.toISOString().split("T")[0] || "N/A"
    };
  });

  const avgOdds = 1.85;
  const roi = stats.total > 0 
    ? Math.round(((stats.won * avgOdds - stats.total) / stats.total) * 100 * 10) / 10
    : 0;

  return {
    total: stats.total,
    pending: stats.pending,
    won: stats.won,
    lost: stats.lost,
    successRate: stats.successRate,
    roi,
    bySport: stats.bySport,
    recentResults
  };
}

function getJobsStatus(): JobsStatus {
  const jobs = jobScheduler.getJobStatus();
  const metrics = metricsService.getJobMetrics();
  
  const now = Date.now();
  const recentExecutions: Array<{ name: string; lastRun: string; success: boolean; duration: number }> = [];
  const upcomingJobs: Array<{ name: string; nextRun: string }> = [];

  for (const job of jobs) {
    if (job.lastRun > 0) {
      const metric = metrics.find(m => m.jobId === job.id);
      recentExecutions.push({
        name: job.name,
        lastRun: new Date(job.lastRun).toISOString(),
        success: metric?.lastSuccess ?? true,
        duration: metric?.avgDuration ?? 0
      });
    }
    
    if (job.enabled && job.nextRun > 0) {
      // nextRun is already an absolute timestamp from scheduler
      upcomingJobs.push({
        name: job.name,
        nextRun: new Date(job.nextRun).toISOString()
      });
    }
  }

  recentExecutions.sort((a, b) => new Date(b.lastRun).getTime() - new Date(a.lastRun).getTime());
  upcomingJobs.sort((a, b) => new Date(a.nextRun).getTime() - new Date(b.nextRun).getTime());

  return {
    total: jobs.length,
    enabled: jobs.filter(j => j.enabled).length,
    recentExecutions: recentExecutions.slice(0, 10),
    upcomingJobs: upcomingJobs.slice(0, 5)
  };
}

router.get("/dashboard", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Non autorisé" });
    }

    const [user] = await db.select().from(users)
      .where(eq(users.id, userId));
    
    if (!user || !user.isOwner) {
      return res.status(403).json({ error: "Accès réservé au propriétaire" });
    }

    const [brain, pronos, jobs, diagnostics] = await Promise.all([
      getBrainHealth(userId),
      getPronosStats(),
      getJobsStatus(),
      diagnosticsService.runQuickDiagnostic()
    ]);

    const dashboard: OwnerDashboard = {
      timestamp: new Date().toISOString(),
      brain,
      pronos,
      jobs,
      systemHealth: {
        status: diagnostics.overallStatus,
        uptime: process.uptime(),
        dependencies: diagnostics.checks?.reduce((acc: Record<string, boolean>, check: any) => {
          acc[check.name] = check.status === "ok";
          return acc;
        }, {}) || {}
      }
    };

    res.json(dashboard);
  } catch (error: any) {
    console.error("[OwnerDashboard] Error:", error);
    res.status(500).json({ error: "Erreur lors du chargement du dashboard", details: error.message });
  }
});

router.get("/summary", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Non autorisé" });
    }

    const [user] = await db.select().from(users)
      .where(eq(users.id, userId));
    
    if (!user || !user.isOwner) {
      return res.status(403).json({ error: "Accès réservé au propriétaire" });
    }

    const [brain, pronos] = await Promise.all([
      getBrainHealth(userId),
      getPronosStats()
    ]);

    const summary = {
      brain: {
        totalL4L5: brain.byLayer.L4 + brain.byLayer.L5,
        topDomain: Object.entries(brain.byDomain)
          .sort((a, b) => b[1].avgConfidence - a[1].avgConfidence)[0]?.[0] || "N/A",
        avgConfidence: Object.values(brain.byDomain).length > 0
          ? Math.round(Object.values(brain.byDomain).reduce((sum, d) => sum + d.avgConfidence, 0) / Object.values(brain.byDomain).length)
          : 0
      },
      pronos: {
        winRate: pronos.successRate,
        roi: pronos.roi,
        trend: pronos.recentResults.slice(0, 5).filter(r => r.won).length >= 3 ? "up" : "stable"
      },
      message: generateOwnerMessage(brain, pronos)
    };

    res.json(summary);
  } catch (error: any) {
    console.error("[OwnerDashboard] Summary error:", error);
    res.status(500).json({ error: "Erreur", details: error.message });
  }
});

function generateOwnerMessage(brain: BrainHealth, pronos: PronosStats): string {
  const messages: string[] = [];

  if (brain.byLayer.L4 + brain.byLayer.L5 >= 10) {
    messages.push(`Cerveau solide avec ${brain.byLayer.L4 + brain.byLayer.L5} insights stratégiques.`);
  } else {
    messages.push(`Cerveau en développement (${brain.byLayer.L4 + brain.byLayer.L5} insights L4/L5).`);
  }

  if (pronos.successRate >= 55) {
    messages.push(`Paris en forme: ${pronos.successRate}% de réussite.`);
  } else if (pronos.successRate < 45 && pronos.total > 10) {
    messages.push(`Attention: taux de réussite faible (${pronos.successRate}%).`);
  }

  if (pronos.roi > 0) {
    messages.push(`ROI positif: +${pronos.roi}%.`);
  }

  return messages.join(" ");
}

export default router;
