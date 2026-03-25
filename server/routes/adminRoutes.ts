/**
 * Admin Dashboard API Routes
 * Provides system monitoring, metrics, and management endpoints.
 * Protected by owner/admin auth.
 */

import { Router, Request, Response } from 'express';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { getRedisStats } from '../services/redisService';
import { getMemoryStats } from '../services/ragMemoryService';
import os from 'os';
import { desc as descOp, eq as eqOp, gte as gteOp } from 'drizzle-orm';
import { auditLogs, sessions as sessionsTable, users as usersTable } from '@shared/schema';
import { getLoginAttemptStats } from '../services/auth';

const router = Router();

// ============================================================================
// Auth middleware — owner or admin only
// ============================================================================

function requireAdmin(req: Request, res: Response, next: Function) {
    const user = (req as any).user;
    if (!user || (!user.isOwner && user.role !== 'admin')) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

router.use(requireAdmin);

// ============================================================================
// GET /api/admin/dashboard — Full system overview
// ============================================================================

router.get('/dashboard', async (_req: Request, res: Response) => {
    try {
        const [system, database, redis, jobs] = await Promise.all([
            getSystemMetrics(),
            getDatabaseMetrics(),
            getRedisStats(),
            getJobsStatus(),
        ]);

        res.json({
            timestamp: new Date().toISOString(),
            system,
            database,
            redis,
            jobs,
            uptime: process.uptime(),
            nodeVersion: process.version,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// GET /api/admin/system — Server system metrics
// ============================================================================

router.get('/system', async (_req: Request, res: Response) => {
    try {
        const metrics = await getSystemMetrics();
        res.json(metrics);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// GET /api/admin/database — Database stats
// ============================================================================

router.get('/database', async (_req: Request, res: Response) => {
    try {
        const metrics = await getDatabaseMetrics();
        res.json(metrics);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// GET /api/admin/redis — Redis stats
// ============================================================================

router.get('/redis', async (_req: Request, res: Response) => {
    try {
        const stats = await getRedisStats();
        res.json(stats);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// GET /api/admin/users — User summary
// ============================================================================

router.get('/users', async (_req: Request, res: Response) => {
    try {
        const users = await db.execute(sql`
      SELECT 
        u.id, u.username, u.role, u."isOwner",
        u."createdAt",
        COUNT(DISTINCT c.id) as conversation_count,
        COUNT(DISTINCT m.id) as message_count,
        MAX(m."createdAt") as last_activity
      FROM users u
      LEFT JOIN conversations c ON c."userId" = u.id
      LEFT JOIN messages m ON m."conversationId" = c.id
      GROUP BY u.id
      ORDER BY last_activity DESC NULLS LAST
    `);
        res.json({ users: users.rows });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// GET /api/admin/conversations — Recent conversations summary
// ============================================================================

router.get('/conversations', async (req: Request, res: Response) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const convos = await db.execute(sql`
      SELECT 
        c.id, c.title, c."userId", u.username,
        c."createdAt", c."updatedAt",
        COUNT(m.id) as message_count
      FROM conversations c
      LEFT JOIN users u ON u.id = c."userId"
      LEFT JOIN messages m ON m."conversationId" = c.id
      GROUP BY c.id, u.username
      ORDER BY c."updatedAt" DESC NULLS LAST
      LIMIT ${limit}
    `);
        res.json({ conversations: convos.rows, count: convos.rows.length });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// GET /api/admin/memory/:userId — RAG memory stats
// ============================================================================

router.get('/memory/:userId', async (req: Request, res: Response) => {
    try {
        const userId = Number(req.params.userId);
        const stats = await getMemoryStats(userId);
        res.json(stats);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// GET /api/admin/errors — Recent error logs
// ============================================================================

router.get('/errors', async (req: Request, res: Response) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const errors = await db.execute(sql`
      SELECT id, "errorType" as error_type, message, stack, context, "createdAt"
      FROM diagnostics
      WHERE "errorType" IS NOT NULL
      ORDER BY "createdAt" DESC
      LIMIT ${limit}
    `);
        res.json({ errors: errors.rows, count: errors.rows.length });
    } catch (error: any) {
        // Table might not exist
        res.json({ errors: [], count: 0, note: 'Diagnostics table unavailable' });
    }
});

// ============================================================================
// GET /api/admin/betting — Betting pipeline status
// ============================================================================

router.get('/betting', async (_req: Request, res: Response) => {
    try {
        const [matches, predictions, bets] = await Promise.all([
            db.execute(sql`SELECT COUNT(*) as count FROM betting_matches`).catch(() => ({ rows: [{ count: 0 }] })),
            db.execute(sql`SELECT COUNT(*) as count FROM betting_predictions`).catch(() => ({ rows: [{ count: 0 }] })),
            db.execute(sql`SELECT COUNT(*) as count, SUM(CASE WHEN status = 'won' THEN profit ELSE 0 END) as total_profit FROM betting_tracked_bets`).catch(() => ({ rows: [{ count: 0, total_profit: 0 }] })),
        ]);

        res.json({
            matches: Number(matches.rows[0]?.count || 0),
            predictions: Number(predictions.rows[0]?.count || 0),
            trackedBets: Number(bets.rows[0]?.count || 0),
            totalProfit: Number(bets.rows[0]?.total_profit || 0),
        });
    } catch (error: any) {
        res.json({ matches: 0, predictions: 0, trackedBets: 0, totalProfit: 0 });
    }
});

// ============================================================================
// POST /api/admin/maintenance/vacuum — Run VACUUM ANALYZE
// ============================================================================

router.post('/maintenance/vacuum', async (_req: Request, res: Response) => {
    try {
        const start = Date.now();
        await db.execute(sql`VACUUM ANALYZE`);
        res.json({ success: true, duration: `${Date.now() - start}ms` });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// POST /api/admin/maintenance/reindex — Reindex database
// ============================================================================

router.post('/maintenance/reindex', async (_req: Request, res: Response) => {
    try {
        const start = Date.now();
        await db.execute(sql`REINDEX DATABASE ulysse`);
        res.json({ success: true, duration: `${Date.now() - start}ms` });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// Helper Functions
// ============================================================================

async function getSystemMetrics() {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const processMemory = process.memoryUsage();

    return {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        cpuModel: cpus[0]?.model || 'unknown',
        cpuCores: cpus.length,
        cpuUsage: os.loadavg(),
        memory: {
            total: formatBytes(totalMem),
            used: formatBytes(usedMem),
            free: formatBytes(freeMem),
            usagePercent: Math.round((usedMem / totalMem) * 100),
        },
        process: {
            heapUsed: formatBytes(processMemory.heapUsed),
            heapTotal: formatBytes(processMemory.heapTotal),
            external: formatBytes(processMemory.external),
            rss: formatBytes(processMemory.rss),
            pid: process.pid,
        },
        uptime: {
            system: formatUptime(os.uptime()),
            process: formatUptime(process.uptime()),
        },
    };
}

async function getDatabaseMetrics() {
    try {
        const [sizeResult, tableCountResult, connectionResult, activityResult] = await Promise.all([
            db.execute(sql`SELECT pg_database_size(current_database()) as size`),
            db.execute(sql`SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'public'`),
            db.execute(sql`SELECT count(*) as active_connections FROM pg_stat_activity WHERE state = 'active'`),
            db.execute(sql`
        SELECT schemaname, relname as table_name, 
               n_tup_ins as inserts, n_tup_upd as updates, n_tup_del as deletes,
               n_live_tup as live_rows
        FROM pg_stat_user_tables 
        ORDER BY n_live_tup DESC LIMIT 10
      `),
        ]);

        return {
            size: formatBytes(Number(sizeResult.rows[0]?.size || 0)),
            sizeBytes: Number(sizeResult.rows[0]?.size || 0),
            tableCount: Number(tableCountResult.rows[0]?.count || 0),
            activeConnections: Number(connectionResult.rows[0]?.active_connections || 0),
            topTables: activityResult.rows,
        };
    } catch (error: any) {
        return { error: error.message };
    }
}

async function getJobsStatus() {
    try {
        // Try to get job scheduler info from global
        const { jobScheduler } = await import('../services/scheduledJobs');
        const jobs = (jobScheduler as any).jobs || [];

        return jobs.map((job: any) => ({
            id: job.id,
            name: job.name,
            enabled: job.enabled,
            interval: job.interval,
            lastRun: job.lastRun?.toISOString() || null,
            nextRun: job.lastRun ? new Date(job.lastRun.getTime() + job.interval).toISOString() : null,
            runCount: job.runCount || 0,
            lastError: job.lastError || null,
        }));
    } catch {
        return [];
    }
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${d}d ${h}h ${m}m`;
}

export default router;

// ============================================================================
// SECURITY EVENTS & SESSION MANAGEMENT
// ============================================================================


// GET /api/admin/security-events — recent security events from audit log
router.get('/security-events', async (req: Request, res: Response) => {
    try {
        const limit = Math.min(parseInt(req.query.limit as string || '100'), 500);
        const action = req.query.action as string | undefined;
        const since = req.query.since ? new Date(req.query.since as string) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const conditions: any[] = [gteOp(auditLogs.timestamp, since)];
        if (action) conditions.push(eqOp(auditLogs.action, action));

        const events = await db
            .select({
                id: auditLogs.id,
                action: auditLogs.action,
                resource: auditLogs.resource,
                details: auditLogs.details,
                ipAddress: auditLogs.ipAddress,
                timestamp: auditLogs.timestamp,
                userId: auditLogs.userId,
            })
            .from(auditLogs)
            .where(conditions.length === 1 ? conditions[0] : conditions.reduce((a: any, b: any) => ({ ...a, ...b })))
            .orderBy(descOp(auditLogs.timestamp))
            .limit(limit);

        const failedLogins = events.filter(e => e.action === 'LOGIN_FAILED').length;
        const blockedAttempts = events.filter(e => e.action === 'LOGIN_BLOCKED').length;
        const successLogins = events.filter(e => e.action === 'LOGIN_SUCCESS').length;
        const blockedAccess = events.filter(e => e.action === 'BLOCKED_ACCESS').length;

        const lockoutStats = getLoginAttemptStats();

        res.json({
            summary: { failedLogins, blockedAttempts, successLogins, blockedAccess, lockedAccounts: lockoutStats.locked.length, suspiciousAccounts: lockoutStats.suspicious.length },
            lockedAccounts: lockoutStats.locked,
            suspiciousAccounts: lockoutStats.suspicious,
            events,
        });
    } catch (error) {
        console.error('[Admin] Security events error:', error);
        res.status(500).json({ error: 'Failed to fetch security events' });
    }
});

// GET /api/admin/active-sessions — all active sessions grouped by user
router.get('/active-sessions', async (req: Request, res: Response) => {
    try {
        const now = new Date();
        const activeSessions = await db
            .select({
                id: sessionsTable.id,
                userId: sessionsTable.userId,
                userAgent: sessionsTable.userAgent,
                ipAddress: sessionsTable.ipAddress,
                expiresAt: sessionsTable.expiresAt,
                createdAt: sessionsTable.createdAt,
                username: usersTable.username,
                displayName: usersTable.displayName,
                role: usersTable.role,
            })
            .from(sessionsTable)
            .leftJoin(usersTable, eqOp(sessionsTable.userId, usersTable.id))
            .where(gteOp(sessionsTable.expiresAt, now))
            .orderBy(descOp(sessionsTable.createdAt));

        res.json({ count: activeSessions.length, sessions: activeSessions });
    } catch (error) {
        console.error('[Admin] Active sessions error:', error);
        res.status(500).json({ error: 'Failed to fetch active sessions' });
    }
});

// DELETE /api/admin/users/:userId/sessions — force-logout all sessions for a user
router.delete('/users/:userId/sessions', async (req: Request, res: Response) => {
    try {
        const targetUserId = parseInt(req.params.userId);
        if (isNaN(targetUserId)) return res.status(400).json({ error: 'Invalid user ID' });

        const requester = (req as any).user;
        if (targetUserId === requester?.id) {
            return res.status(400).json({ error: 'Impossible de révoquer votre propre session' });
        }

        await db.delete(sessionsTable).where(eqOp(sessionsTable.userId, targetUserId));

        console.log(`[Security] Admin ${requester?.username} force-logged out all sessions for user ${targetUserId}`);
        res.json({ success: true, message: `Toutes les sessions de l'utilisateur ${targetUserId} ont été révoquées` });
    } catch (error) {
        console.error('[Admin] Force logout error:', error);
        res.status(500).json({ error: 'Failed to revoke sessions' });
    }
});
