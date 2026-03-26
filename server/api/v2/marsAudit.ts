import { Router, Request, Response, NextFunction } from "express";
import { 
  getAuditLogs, 
  calculateStats, 
  exportAsNDJSON, 
  getLogCount,
  clearAuditLogs 
} from "../../services/marsAuditService";

const router = Router();

function requireOwner(req: Request, res: Response, next: NextFunction) {
  if (!(req as any).isOwner) {
    return res.status(403).json({ error: "Owner access required" });
  }
  next();
}

/**
 * GET /api/v2/mars/logs
 * Retrieve MARS audit logs with filtering
 */
router.get("/logs", requireOwner, async (req: Request, res: Response) => {
  try {
    const { from, to, type, limit, confidence, failures } = req.query;
    
    const logs = getAuditLogs({
      from: from ? new Date(from as string) : undefined,
      to: to ? new Date(to as string) : undefined,
      queryType: type as string | undefined,
      limit: limit ? parseInt(limit as string) : 100,
      confidenceLevel: confidence as string | undefined,
      onlyFailures: failures === 'true'
    });
    
    res.json({
      success: true,
      count: logs.length,
      totalInBuffer: getLogCount(),
      logs
    });
  } catch (error) {
    console.error("[MarsAudit] Error fetching logs:", error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Unknown error" 
    });
  }
});

/**
 * GET /api/v2/mars/stats
 * Get aggregated statistics
 */
router.get("/stats", requireOwner, async (req: Request, res: Response) => {
  try {
    const { from, to, type } = req.query;
    
    let logs = getAuditLogs({
      from: from ? new Date(from as string) : undefined,
      to: to ? new Date(to as string) : undefined,
      queryType: type as string | undefined
    });
    
    const stats = calculateStats(logs);
    
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error("[MarsAudit] Error calculating stats:", error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Unknown error" 
    });
  }
});

/**
 * GET /api/v2/mars/export
 * Export logs as NDJSON for external analysis
 */
router.get("/export", requireOwner, async (req: Request, res: Response) => {
  try {
    const { from, to, type, limit } = req.query;
    
    const logs = getAuditLogs({
      from: from ? new Date(from as string) : undefined,
      to: to ? new Date(to as string) : undefined,
      queryType: type as string | undefined,
      limit: limit ? parseInt(limit as string) : undefined
    });
    
    const ndjson = exportAsNDJSON(logs);
    
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Content-Disposition', `attachment; filename=mars-audit-${new Date().toISOString().split('T')[0]}.ndjson`);
    res.send(ndjson);
  } catch (error) {
    console.error("[MarsAudit] Error exporting logs:", error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Unknown error" 
    });
  }
});

/**
 * GET /api/v2/mars/dashboard
 * Get a summary dashboard for quick overview
 */
router.get("/dashboard", requireOwner, async (req: Request, res: Response) => {
  try {
    const allStats = calculateStats();
    
    // Get last 24h stats
    const last24h = getAuditLogs({
      from: new Date(Date.now() - 24 * 60 * 60 * 1000)
    });
    const stats24h = calculateStats(last24h);
    
    // Get last hour stats
    const lastHour = getAuditLogs({
      from: new Date(Date.now() - 60 * 60 * 1000)
    });
    const statsHour = calculateStats(lastHour);
    
    // Recent failures
    const recentFailures = getAuditLogs({
      onlyFailures: true,
      limit: 10
    });
    
    // Slow queries (>10s)
    const allLogs = getAuditLogs({ limit: 1000 });
    const slowQueries = allLogs
      .filter(l => l.totalTimeMs > 10000)
      .slice(-10);
    
    res.json({
      success: true,
      dashboard: {
        current: {
          totalInBuffer: getLogCount(),
          avgLatencyMs: allStats.avgLatencyMs,
          p95LatencyMs: allStats.p95LatencyMs,
          canRespondRate: allStats.canRespondRate,
          earlyExitRate: allStats.earlyExitRate
        },
        lastHour: {
          queries: statsHour.totalQueries,
          avgLatencyMs: statsHour.avgLatencyMs,
          canRespondRate: statsHour.canRespondRate
        },
        last24h: {
          queries: stats24h.totalQueries,
          avgLatencyMs: stats24h.avgLatencyMs,
          p95LatencyMs: stats24h.p95LatencyMs,
          canRespondRate: stats24h.canRespondRate,
          queryTypeDistribution: stats24h.queryTypeDistribution,
          avgLatencyByType: stats24h.avgLatencyByType
        },
        engines: {
          perplexityUsageRate: allStats.perplexityUsageRate,
          perplexityTimeoutRate: allStats.perplexityTimeoutRate,
          serperUsageRate: allStats.serperUsageRate,
          serperTimeoutRate: allStats.serperTimeoutRate
        },
        sports: {
          queryRate: allStats.sportsQueryRate,
          cacheHitRate: allStats.sportsCacheHitRate,
          avgMatchesFromCache: allStats.avgMatchesFromCache,
          avgValueBetsDetected: allStats.avgValueBetsDetected
        },
        alerts: {
          recentFailures: recentFailures.map(f => ({
            id: f.id,
            query: f.queryOriginal.substring(0, 50),
            reason: f.policyReason,
            timestamp: f.timestamp
          })),
          slowQueries: slowQueries.map(s => ({
            id: s.id,
            query: s.queryOriginal.substring(0, 50),
            timeMs: s.totalTimeMs,
            timestamp: s.timestamp
          }))
        }
      }
    });
  } catch (error) {
    console.error("[MarsAudit] Error building dashboard:", error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Unknown error" 
    });
  }
});

/**
 * DELETE /api/v2/mars/logs (owner only, for maintenance)
 */
router.delete("/logs", requireOwner, async (req: Request, res: Response) => {
  try {
    clearAuditLogs();
    res.json({ success: true, message: "Audit logs cleared" });
  } catch (error) {
    console.error("[MarsAudit] Error clearing logs:", error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Unknown error" 
    });
  }
});

export default router;
