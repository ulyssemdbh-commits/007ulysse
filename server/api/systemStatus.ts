import { Router, Request, Response } from "express";
import { db } from "../db";
import { users, conversationThreads, conversationMessages, knowledgeBase, ulysseHomework, projects, tasks, actualBets } from "@shared/schema";
import { eq, count, desc, gte, and, sql, lt, or, like } from "drizzle-orm";
import { getConnectedClientsCount, getAuthenticatedClientsCount, getConnectedDevices } from "../services/realtimeSync";

const router = Router();

const startTime = Date.now();

// Secret key for autonomous access (Ulysse)
const SYSTEM_STATUS_SECRET = process.env.SYSTEM_STATUS_SECRET;

// Validate access - either authenticated user or secret key
function validateSystemStatusAccess(req: Request): { allowed: boolean; userId: number } {
  // Check for secret key in header or query
  const secretKey = req.headers["x-system-status-key"] || req.query.key;
  
  // Check for authenticated user
  const userId = (req as any).userId || (req as any).user?.id;
  
  if (userId) {
    return { allowed: true, userId };
  }
  
  if (SYSTEM_STATUS_SECRET && secretKey === SYSTEM_STATUS_SECRET) {
    return { allowed: true, userId: 1 }; // Owner access with secret key
  }
  
  return { allowed: false, userId: 0 };
}

interface ComponentHealth {
  status: "operational" | "degraded" | "down";
  latencyMs?: number;
  lastCheck?: string;
  details?: string;
}

interface JobStatus {
  lastRun: string | null;
  lastStatus: "success" | "failed" | "pending";
  nextRun?: string;
}

// Track recent job executions
const recentJobExecutions: Array<{ 
  name: string; 
  status: "success" | "failed"; 
  duration: number; 
  timestamp: string 
}> = [];

// Track important job last runs
const importantJobsLastRun: Record<string, { timestamp: string; status: "success" | "failed" }> = {};

export function recordJobExecution(name: string, status: "success" | "failed", duration: number) {
  const execution = {
    name,
    status,
    duration,
    timestamp: new Date().toISOString()
  };
  
  recentJobExecutions.unshift(execution);
  if (recentJobExecutions.length > 100) {
    recentJobExecutions.pop();
  }
  
  // Track important jobs specifically
  const importantJobs = [
    "Owner Morning Brief",
    "Daily Value Bets", 
    "SUGU Daily Check",
    "AgentMail Email Fetch",
    "Autonomous Learning Cycle",
    "Brain System Synchronization",
    "Sports Odds Hourly Refresh",
    "Sports Prediction Results Tracking"
  ];
  
  if (importantJobs.some(j => name.includes(j))) {
    importantJobsLastRun[name] = { timestamp: execution.timestamp, status };
  }
}

async function measureLatency<T>(fn: () => Promise<T>): Promise<{ result: T; latencyMs: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, latencyMs: Date.now() - start };
}

async function checkComponentHealth(
  name: string,
  checkFn: () => Promise<boolean>
): Promise<ComponentHealth> {
  try {
    const { result, latencyMs } = await measureLatency(checkFn);
    return {
      status: result ? "operational" : "degraded",
      latencyMs,
      lastCheck: new Date().toISOString()
    };
  } catch (error) {
    return {
      status: "down",
      lastCheck: new Date().toISOString(),
      details: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

function calculateHealthScore(components: Record<string, ComponentHealth>): number {
  const weights: Record<string, number> = {
    database: 25,
    openai: 20,
    agentmail: 10,
    calendar: 10,
    todoist: 5,
    websocket: 15,
    cachesSports: 10,
    jobsScheduler: 5
  };
  
  let score = 0;
  let totalWeight = 0;
  
  for (const [key, health] of Object.entries(components)) {
    const weight = weights[key] || 5;
    totalWeight += weight;
    
    if (health.status === "operational") {
      score += weight;
    } else if (health.status === "degraded") {
      score += weight * 0.5;
    }
    // "down" contributes 0
  }
  
  return Math.round((score / totalWeight) * 100);
}

// Main comprehensive status endpoint
router.get("/", async (req: Request, res: Response) => {
  try {
    const access = validateSystemStatusAccess(req);
    
    if (!access.allowed) {
      return res.status(401).json({ 
        error: "Unauthorized", 
        message: "Access requires authentication or valid system key",
        hint: "Use header 'X-System-Status-Key' or query param '?key=...'"
      });
    }
    
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const userId = access.userId;

    // 1️⃣ Components health with latency
    const components: Record<string, ComponentHealth> = {};
    
    const [dbHealth, openaiHealth, agentmailHealth, calendarHealth, todoistHealth] = await Promise.all([
      checkComponentHealth("database", async () => {
        await db.execute(sql`SELECT 1`);
        return true;
      }),
      checkComponentHealth("openai", async () => {
        return !!(process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY);
      }),
      checkComponentHealth("agentmail", async () => {
        return !!process.env.AGENTMAIL_API_KEY;
      }),
      checkComponentHealth("calendar", async () => {
        try {
          const { calendarService } = await import("../services/googleCalendarService");
          return await calendarService.checkConnection();
        } catch {
          return false;
        }
      }),
      checkComponentHealth("todoist", async () => {
        try {
          const { todoistConnectorService } = await import("../services/todoistConnectorService");
          return await todoistConnectorService.isConnected();
        } catch {
          return false;
        }
      })
    ]);
    
    components.database = dbHealth;
    components.openai = openaiHealth;
    components.agentmail = agentmailHealth;
    components.calendar = calendarHealth;
    components.todoist = todoistHealth;
    
    // WebSocket health
    const wsConnections = getConnectedClientsCount();
    components.websocket = {
      status: wsConnections > 0 ? "operational" : "degraded",
      details: `${wsConnections} connections`
    };
    
    // Sports cache health
    let sportsCacheHealth: ComponentHealth = { status: "degraded" };
    try {
      const cachedMatches = await db.execute(sql`
        SELECT COUNT(*) as count FROM sports_cached_matches 
        WHERE updated_at > NOW() - INTERVAL '24 hours'
      `).then(r => Number((r.rows[0] as any)?.count || 0));
      sportsCacheHealth = {
        status: cachedMatches > 0 ? "operational" : "degraded",
        details: `${cachedMatches} matches cached`
      };
    } catch {
      sportsCacheHealth = { status: "down" };
    }
    components.cachesSports = sportsCacheHealth;
    
    // Jobs scheduler health
    const failedLast24h = recentJobExecutions.filter(
      j => j.status === "failed" && new Date(j.timestamp) > last24h
    ).length;
    components.jobsScheduler = {
      status: failedLast24h < 5 ? "operational" : failedLast24h < 15 ? "degraded" : "down",
      details: `${failedLast24h} failures in 24h`
    };
    
    const healthScore = calculateHealthScore(components);
    const overallStatus = healthScore >= 80 ? "healthy" : healthScore >= 50 ? "degraded" : "critical";

    // 2️⃣ Brain / AutoLearning
    const [
      totalKnowledge,
      knowledgeByDomain,
      knowledgeByCategory,
      knowledgeStats
    ] = await Promise.all([
      db.select({ count: count() }).from(knowledgeBase).where(eq(knowledgeBase.userId, userId)).then(r => r[0]?.count || 0),
      
      // By domain (using content patterns - more comprehensive matching)
      db.execute(sql`
        SELECT 
          CASE 
            WHEN lower(content) LIKE '%football%' OR lower(content) LIKE '%match%' OR lower(content) LIKE '%équipe%' 
                 OR lower(content) LIKE '%ligue%' OR lower(content) LIKE '%goal%' OR lower(content) LIKE '%pronos%'
                 OR lower(content) LIKE '%bet%' OR lower(content) LIKE '%cote%' OR lower(content) LIKE '%bookmaker%' THEN 'sports'
            WHEN lower(content) LIKE '%trading%' OR lower(content) LIKE '%crypto%' OR lower(content) LIKE '%bourse%'
                 OR lower(content) LIKE '%bitcoin%' OR lower(content) LIKE '%action%' OR lower(content) LIKE '%marché%' THEN 'trading'
            WHEN lower(content) LIKE '%sugu%' OR lower(content) LIKE '%restaurant%' OR lower(content) LIKE '%rupture%'
                 OR lower(content) LIKE '%checklist%' OR lower(content) LIKE '%inventaire%' THEN 'sugu'
            WHEN lower(content) LIKE '%code%' OR lower(content) LIKE '%développ%' OR lower(content) LIKE '%api%'
                 OR lower(content) LIKE '%react%' OR lower(content) LIKE '%typescript%' OR lower(content) LIKE '%fonction%' THEN 'dev'
            ELSE 'personal'
          END as domain,
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE importance >= 80) as high_importance,
          COUNT(*) FILTER (WHERE importance >= 90) as critical,
          AVG(confidence) as avg_confidence,
          AVG(importance) as avg_importance
        FROM knowledge_base
        WHERE user_id = ${userId}
        GROUP BY 1
      `).then(r => r.rows as any[]).catch(() => []),
      
      // By category (actual DB field)
      db.execute(sql`
        SELECT 
          category,
          COUNT(*) as count,
          AVG(confidence) as avg_confidence
        FROM knowledge_base
        WHERE user_id = ${userId}
        GROUP BY category
        ORDER BY count DESC
      `).then(r => r.rows as any[]).catch(() => []),
      
      // Global stats
      db.execute(sql`
        SELECT 
          AVG(confidence) as avg_confidence,
          AVG(importance) as avg_importance,
          COUNT(*) FILTER (WHERE importance >= 80) as high_importance_count,
          COUNT(*) FILTER (WHERE importance >= 90) as critical_count
        FROM knowledge_base
        WHERE user_id = ${userId}
      `).then(r => r.rows[0] as any).catch(() => ({}))
    ]);
    
    // Build domain stats
    const domainStats: Record<string, { topics: number; highImportance: number; critical: number; avgConfidence: number }> = {};
    for (const row of knowledgeByDomain) {
      domainStats[row.domain] = {
        topics: Number(row.total || 0),
        highImportance: Number(row.high_importance || 0),
        critical: Number(row.critical || 0),
        avgConfidence: Math.round(Number(row.avg_confidence || 0))
      };
    }
    
    // Category counts
    const categoryStats: Record<string, number> = {};
    for (const row of knowledgeByCategory) {
      categoryStats[row.category || 'other'] = Number(row.count || 0);
    }
    
    const brain = {
      totalKnowledge: Number(totalKnowledge),
      topics: {
        total: Number(totalKnowledge),
        highImportance: Number(knowledgeStats.high_importance_count || 0),
        critical: Number(knowledgeStats.critical_count || 0),
        avgConfidence: Math.round(Number(knowledgeStats.avg_confidence || 0)),
        avgImportance: Math.round(Number(knowledgeStats.avg_importance || 0))
      },
      byCategory: categoryStats,
      byDomain: {
        sports: domainStats.sports || { topics: 0, highImportance: 0, critical: 0, avgConfidence: 0 },
        trading: domainStats.trading || { topics: 0, highImportance: 0, critical: 0, avgConfidence: 0 },
        sugu: domainStats.sugu || { topics: 0, highImportance: 0, critical: 0, avgConfidence: 0 },
        dev: domainStats.dev || { topics: 0, highImportance: 0, critical: 0, avgConfidence: 0 },
        personal: domainStats.personal || { topics: 0, highImportance: 0, critical: 0, avgConfidence: 0 }
      }
    };

    // 3️⃣ Pronos / Bets
    let pronos: any = {
      roiOverall: 0,
      winrateOverall: 0,
      totalBets: 0,
      byTag: { SAFE: { count: 0, roi: 0 }, VALUE: { count: 0, roi: 0 }, FUN: { count: 0, roi: 0 } },
      byLeague: {},
      lastBets: []
    };
    
    try {
      // Get overall stats
      const betStats = await db.execute(sql`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'won') as won,
          COUNT(*) FILTER (WHERE status = 'lost') as lost,
          SUM(CASE WHEN status = 'won' THEN stake * odds - stake ELSE -stake END) as profit,
          SUM(stake) as total_stake
        FROM actual_bets
        WHERE user_id = ${userId}
      `).then(r => r.rows[0] as any).catch(() => null);
      
      if (betStats) {
        const totalBets = Number(betStats.total || 0);
        const won = Number(betStats.won || 0);
        const profit = Number(betStats.profit || 0);
        const totalStake = Number(betStats.total_stake || 0);
        
        pronos.totalBets = totalBets;
        pronos.roiOverall = totalStake > 0 ? Math.round((profit / totalStake) * 10000) / 100 : 0;
        pronos.winrateOverall = totalBets > 0 ? Math.round((won / totalBets) * 10000) / 100 : 0;
      }
      
      // By tag
      const byTag = await db.execute(sql`
        SELECT 
          bet_type as tag,
          COUNT(*) as count,
          SUM(CASE WHEN status = 'won' THEN stake * odds - stake ELSE -stake END) as profit,
          SUM(stake) as total_stake
        FROM actual_bets
        WHERE user_id = ${userId} AND bet_type IS NOT NULL
        GROUP BY bet_type
      `).then(r => r.rows as any[]).catch(() => []);
      
      for (const row of byTag) {
        const tag = (row.tag || 'OTHER').toUpperCase();
        const stake = Number(row.total_stake || 0);
        pronos.byTag[tag] = {
          count: Number(row.count || 0),
          roi: stake > 0 ? Math.round((Number(row.profit || 0) / stake) * 10000) / 100 : 0
        };
      }
      
      // By league
      const byLeague = await db.execute(sql`
        SELECT 
          league,
          COUNT(*) as count,
          COUNT(*) FILTER (WHERE status = 'won') as won,
          SUM(CASE WHEN status = 'won' THEN stake * odds - stake ELSE -stake END) as profit,
          SUM(stake) as total_stake
        FROM actual_bets
        WHERE user_id = ${userId} AND league IS NOT NULL
        GROUP BY league
        ORDER BY count DESC
        LIMIT 10
      `).then(r => r.rows as any[]).catch(() => []);
      
      for (const row of byLeague) {
        const stake = Number(row.total_stake || 0);
        pronos.byLeague[row.league] = {
          count: Number(row.count || 0),
          won: Number(row.won || 0),
          roi: stake > 0 ? Math.round((Number(row.profit || 0) / stake) * 10000) / 100 : 0
        };
      }
      
      // Last bets
      const lastBets = await db.execute(sql`
        SELECT 
          match_description,
          bet_type,
          odds,
          stake,
          status,
          league,
          created_at
        FROM actual_bets
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT 5
      `).then(r => r.rows as any[]).catch(() => []);
      
      pronos.lastBets = lastBets.map(b => ({
        match: b.match_description,
        type: b.bet_type,
        odds: Number(b.odds),
        stake: Number(b.stake),
        status: b.status,
        league: b.league,
        date: b.created_at
      }));
      
    } catch (err) {
      console.error("[SystemStatus] Error fetching pronos:", err);
    }

    // 4️⃣ Jobs
    const totalJobs = 38; // From job scheduler registration
    const runningNow = recentJobExecutions.filter(
      j => new Date(j.timestamp) > new Date(Date.now() - 60000)
    ).length;
    
    const jobs = {
      totalJobs,
      runningNow,
      failedLast24h,
      lastRun: {
        MorningBrief: importantJobsLastRun["Owner Morning Brief (8h)"] || null,
        DailyValueBets: importantJobsLastRun["Daily Value Bets (12h)"] || null,
        SuguDailyCheck: importantJobsLastRun["SUGU Daily Check (7h)"] || null,
        AgentMailFetch: importantJobsLastRun["AgentMail Email Fetch"] || null,
        AutoLearning: importantJobsLastRun["Autonomous Learning Cycle"] || null,
        BrainSync: importantJobsLastRun["Brain System Synchronization"] || null,
        SportsOdds: importantJobsLastRun["Sports Odds Hourly Refresh"] || null,
        PredictionTracking: importantJobsLastRun["Sports Prediction Results Tracking"] || null
      },
      recentExecutions: recentJobExecutions.slice(0, 10)
    };

    // 5️⃣ SUGU Summary
    let sugu: any = {
      alertsCount: 0,
      lastAlertAt: null,
      types: { ruptures: 0, surstocks: 0, anomalies: 0 }
    };
    
    try {
      // Try to get SUGU analytics data
      const { suguAnalyticsService } = await import("../services/suguAnalyticsService");
      const insights = await suguAnalyticsService.getActionableInsights().catch(() => []);
      
      sugu.alertsCount = insights.length;
      if (insights.length > 0) {
        sugu.lastAlertAt = new Date().toISOString();
        
        for (const insight of insights) {
          if (insight.type === 'critical' || (insight.message || '').toLowerCase().includes('rupture')) {
            sugu.types.ruptures++;
          } else if ((insight.message || '').toLowerCase().includes('surstock') || (insight.message || '').toLowerCase().includes('stock')) {
            sugu.types.surstocks++;
          } else {
            sugu.types.anomalies++;
          }
        }
      }
    } catch {
      // SUGU service not available
    }

    // Build final response
    const status = {
      timestamp: now.toISOString(),
      status: overallStatus,
      healthScore,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      version: "2.0.0",
      
      components,
      
      brain,
      
      pronos,
      
      jobs,
      
      sugu,
      
      realtime: {
        totalConnections: getConnectedClientsCount(),
        authenticatedConnections: getAuthenticatedClientsCount(),
        devices: getConnectedDevices()
      },
      
      memory: {
        heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024)
      }
    };

    res.json(status);
  } catch (error) {
    console.error("[SystemStatus] Error:", error);
    res.status(500).json({ 
      status: "critical",
      healthScore: 0,
      error: "Failed to get system status",
      timestamp: new Date().toISOString()
    });
  }
});

// Quick summary endpoint
router.get("/summary", async (req: Request, res: Response) => {
  try {
    const access = validateSystemStatusAccess(req);
    if (!access.allowed) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    const components: Record<string, ComponentHealth> = {};
    
    // Quick health checks
    const [dbOk, openaiOk, agentmailOk, calendarOk] = await Promise.all([
      db.execute(sql`SELECT 1`).then(() => true).catch(() => false),
      Promise.resolve(!!(process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY)),
      Promise.resolve(!!process.env.AGENTMAIL_API_KEY),
      import("../services/googleCalendarService")
        .then(({ calendarService }) => calendarService.checkConnection())
        .catch(() => false)
    ]);
    
    components.database = { status: dbOk ? "operational" : "down" };
    components.openai = { status: openaiOk ? "operational" : "down" };
    components.agentmail = { status: agentmailOk ? "operational" : "degraded" };
    components.calendar = { status: calendarOk ? "operational" : "degraded" };
    components.websocket = { status: getConnectedClientsCount() > 0 ? "operational" : "degraded" };
    
    const healthScore = calculateHealthScore(components);
    
    res.json({
      status: healthScore >= 80 ? "healthy" : healthScore >= 50 ? "degraded" : "critical",
      healthScore,
      components,
      connections: getAuthenticatedClientsCount(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ status: "critical", healthScore: 0, error: "System check failed" });
  }
});

// Brain-only endpoint
router.get("/brain", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || (req as any).user?.id || 1;
    
    const [totalKnowledge, byCategory, byDomain, stats] = await Promise.all([
      db.select({ count: count() }).from(knowledgeBase).where(eq(knowledgeBase.userId, userId)).then(r => r[0]?.count || 0),
      
      db.execute(sql`
        SELECT category, COUNT(*) as count, AVG(confidence) as avg_conf
        FROM knowledge_base WHERE user_id = ${userId}
        GROUP BY category ORDER BY count DESC
      `).then(r => r.rows as any[]).catch(() => []),
      
      db.execute(sql`
        SELECT 
          CASE 
            WHEN lower(content) LIKE '%football%' OR lower(content) LIKE '%match%' OR lower(content) LIKE '%ligue%'
                 OR lower(content) LIKE '%pronos%' OR lower(content) LIKE '%bet%' THEN 'sports'
            WHEN lower(content) LIKE '%trading%' OR lower(content) LIKE '%crypto%' OR lower(content) LIKE '%bitcoin%' THEN 'trading'
            WHEN lower(content) LIKE '%sugu%' OR lower(content) LIKE '%restaurant%' OR lower(content) LIKE '%rupture%' THEN 'sugu'
            WHEN lower(content) LIKE '%code%' OR lower(content) LIKE '%api%' OR lower(content) LIKE '%react%' THEN 'dev'
            ELSE 'personal'
          END as domain,
          COUNT(*) as count,
          COUNT(*) FILTER (WHERE importance >= 80) as high_importance,
          AVG(confidence) as avg_conf
        FROM knowledge_base WHERE user_id = ${userId}
        GROUP BY 1
      `).then(r => r.rows as any[]).catch(() => []),
      
      db.execute(sql`
        SELECT AVG(confidence) as avg_conf, AVG(importance) as avg_imp,
               COUNT(*) FILTER (WHERE importance >= 80) as high_imp
        FROM knowledge_base WHERE user_id = ${userId}
      `).then(r => r.rows[0] as any).catch(() => ({}))
    ]);
    
    const categories: Record<string, number> = {};
    for (const row of byCategory) {
      categories[row.category || 'other'] = Number(row.count);
    }
    
    const domains: Record<string, any> = {};
    for (const row of byDomain) {
      domains[row.domain] = {
        topics: Number(row.count),
        highImportance: Number(row.high_importance || 0),
        avgConfidence: Math.round(Number(row.avg_conf || 0))
      };
    }
    
    res.json({
      userId,
      totalKnowledge: Number(totalKnowledge),
      avgConfidence: Math.round(Number(stats.avg_conf || 0)),
      avgImportance: Math.round(Number(stats.avg_imp || 0)),
      highImportance: Number(stats.high_imp || 0),
      categories,
      domains,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to get brain status" });
  }
});

// Pronos-only endpoint
router.get("/pronos", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || (req as any).user?.id || 1;
    
    const [stats, byTag, byLeague, lastBets] = await Promise.all([
      db.execute(sql`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'won') as won,
          COUNT(*) FILTER (WHERE status = 'lost') as lost,
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          SUM(CASE WHEN status = 'won' THEN stake * odds - stake ELSE -stake END) as profit,
          SUM(stake) as total_stake
        FROM actual_bets WHERE user_id = ${userId}
      `).then(r => r.rows[0] as any).catch(() => ({})),
      
      db.execute(sql`
        SELECT bet_type, COUNT(*) as count,
          SUM(CASE WHEN status = 'won' THEN stake * odds - stake ELSE -stake END) as profit,
          SUM(stake) as stake
        FROM actual_bets WHERE user_id = ${userId} AND bet_type IS NOT NULL
        GROUP BY bet_type
      `).then(r => r.rows as any[]).catch(() => []),
      
      db.execute(sql`
        SELECT league, COUNT(*) as count,
          COUNT(*) FILTER (WHERE status = 'won') as won,
          SUM(CASE WHEN status = 'won' THEN stake * odds - stake ELSE -stake END) as profit,
          SUM(stake) as stake
        FROM actual_bets WHERE user_id = ${userId} AND league IS NOT NULL
        GROUP BY league ORDER BY count DESC LIMIT 8
      `).then(r => r.rows as any[]).catch(() => []),
      
      db.execute(sql`
        SELECT match_description, bet_type, odds, stake, status, league, created_at
        FROM actual_bets WHERE user_id = ${userId}
        ORDER BY created_at DESC LIMIT 5
      `).then(r => r.rows as any[]).catch(() => [])
    ]);
    
    const total = Number(stats.total || 0);
    const won = Number(stats.won || 0);
    const profit = Number(stats.profit || 0);
    const stake = Number(stats.total_stake || 0);
    
    res.json({
      roiOverall: stake > 0 ? Math.round((profit / stake) * 10000) / 100 : 0,
      winrateOverall: total > 0 ? Math.round((won / total) * 10000) / 100 : 0,
      totalBets: total,
      pending: Number(stats.pending || 0),
      
      byTag: Object.fromEntries(byTag.map(t => [
        (t.bet_type || 'OTHER').toUpperCase(),
        { 
          count: Number(t.count), 
          roi: Number(t.stake) > 0 ? Math.round((Number(t.profit) / Number(t.stake)) * 10000) / 100 : 0 
        }
      ])),
      
      byLeague: Object.fromEntries(byLeague.map(l => [
        l.league,
        {
          count: Number(l.count),
          won: Number(l.won),
          roi: Number(l.stake) > 0 ? Math.round((Number(l.profit) / Number(l.stake)) * 10000) / 100 : 0
        }
      ])),
      
      lastBets: lastBets.map(b => ({
        match: b.match_description,
        type: b.bet_type,
        odds: Number(b.odds),
        stake: Number(b.stake),
        status: b.status,
        league: b.league
      })),
      
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to get pronos status" });
  }
});

// Jobs-only endpoint
router.get("/jobs", async (req: Request, res: Response) => {
  try {
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const failedLast24h = recentJobExecutions.filter(
      j => j.status === "failed" && new Date(j.timestamp) > last24h
    ).length;
    
    res.json({
      totalJobs: 38,
      runningNow: recentJobExecutions.filter(
        j => new Date(j.timestamp) > new Date(Date.now() - 60000)
      ).length,
      failedLast24h,
      lastRun: importantJobsLastRun,
      recentExecutions: recentJobExecutions.slice(0, 20),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to get jobs status" });
  }
});

// SUGU-only endpoint
router.get("/sugu", async (req: Request, res: Response) => {
  try {
    const { suguAnalyticsService } = await import("../services/suguAnalyticsService");
    const insights = await suguAnalyticsService.getActionableInsights().catch(() => []);
    
    let types = { ruptures: 0, surstocks: 0, anomalies: 0 };
    for (const insight of insights) {
      const msg = (insight.message || '').toLowerCase();
      if (insight.type === 'critical' || msg.includes('rupture')) {
        types.ruptures++;
      } else if (msg.includes('surstock') || msg.includes('stock')) {
        types.surstocks++;
      } else {
        types.anomalies++;
      }
    }
    
    res.json({
      alertsCount: insights.length,
      lastAlertAt: insights.length > 0 ? new Date().toISOString() : null,
      types,
      insights: insights.slice(0, 10),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.json({
      alertsCount: 0,
      lastAlertAt: null,
      types: { ruptures: 0, surstocks: 0, anomalies: 0 },
      timestamp: new Date().toISOString()
    });
  }
});

// ========================================
// PALIER 3: ClarityScore + Diagnostics
// ========================================

// ClarityScore endpoint - Ulysse's self-awareness of reliability
router.get("/clarity", async (req: Request, res: Response) => {
  try {
    const access = validateSystemStatusAccess(req);
    if (!access.allowed) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { selfAwarenessService } = await import("../services/selfAwarenessService");
    const clarityScore = await selfAwarenessService.getClarityScore();
    
    res.json({
      ...clarityScore,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to get clarity score" });
  }
});

// Context flags endpoint - for AI prompt injection
router.get("/context-flags", async (req: Request, res: Response) => {
  try {
    const access = validateSystemStatusAccess(req);
    if (!access.allowed) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { selfAwarenessService } = await import("../services/selfAwarenessService");
    const flags = await selfAwarenessService.getContextFlags();
    
    res.json({
      ...flags,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to get context flags" });
  }
});

// Intent check endpoint - check components for specific intent
router.post("/intent-check", async (req: Request, res: Response) => {
  try {
    const access = validateSystemStatusAccess(req);
    if (!access.allowed) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: "Message is required" });
    }

    const { selfAwarenessService } = await import("../services/selfAwarenessService");
    const check = await selfAwarenessService.checkIntentContext(message);
    
    res.json({
      ...check,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to check intent" });
  }
});

// Run diagnostic - manual trigger
router.post("/diagnostic", async (req: Request, res: Response) => {
  try {
    const access = validateSystemStatusAccess(req);
    if (!access.allowed) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { selfAwarenessService } = await import("../services/selfAwarenessService");
    const result = await selfAwarenessService.runDiagnostic('manual');
    
    res.json({
      success: true,
      diagnosticId: result.id,
      summary: result.summary,
      clarityScore: result.clarityScore,
      brainStats: result.brainStats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to run diagnostic" });
  }
});

// Get diagnostics history
router.get("/diagnostics", async (req: Request, res: Response) => {
  try {
    const access = validateSystemStatusAccess(req);
    if (!access.allowed) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const limit = Math.min(50, parseInt(req.query.limit as string) || 10);

    const { selfAwarenessService } = await import("../services/selfAwarenessService");
    const [diagnostics, lastDiag] = await Promise.all([
      selfAwarenessService.getRecentDiagnostics(limit),
      selfAwarenessService.getLastDiagnostic()
    ]);
    
    res.json({
      total: diagnostics.length,
      lastDiagnostic: lastDiag,
      diagnostics,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to get diagnostics" });
  }
});

// Enhanced context injection for AI - combines everything
router.get("/ai-context", async (req: Request, res: Response) => {
  try {
    const access = validateSystemStatusAccess(req);
    if (!access.allowed) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const message = req.query.message as string | undefined;
    const { selfAwarenessService } = await import("../services/selfAwarenessService");
    const context = await selfAwarenessService.generateEnhancedContextInjection(access.userId, message);
    
    res.json({
      context,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to generate AI context" });
  }
});

router.post("/self-reflection", async (req: Request, res: Response) => {
  try {
    const access = validateSystemStatusAccess(req);
    if (!access.allowed) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { generateSelfReflectionJournal, formatJournalForChat } = await import("../services/selfReflectionJournal");
    const journal = await generateSelfReflectionJournal(access.userId);
    const format = req.query.format as string;

    if (format === "markdown" || format === "chat") {
      res.json({ journal: formatJournalForChat(journal), raw: journal });
    } else {
      res.json(journal);
    }
  } catch (error: any) {
    console.error("[SelfReflection] Error generating journal:", error);
    res.status(500).json({ error: "Failed to generate self-reflection journal", message: error.message });
  }
});

export default router;
