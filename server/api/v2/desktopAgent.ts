/**
 * Desktop Agent API Routes - Phase 5
 * 
 * Endpoints:
 * - POST /api/v2/desktop-agent/context   — Receive desktop context from agent
 * - GET  /api/v2/desktop-agent/status    — Get agent connection status
 * - POST /api/v2/desktop-agent/register  — Register/pair a desktop agent
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { desktopAgentService } from "../../services/desktopAgentService";

const router = Router();

// ============================================================================
// VALIDATION
// ============================================================================

const desktopContextSchema = z.object({
    activeWindow: z.object({
        title: z.string().max(500),
        appName: z.string().max(200),
        url: z.string().max(2000).optional(),
    }),
    clipboard: z.object({
        text: z.string().max(10000),
        changedAt: z.number(),
    }).optional(),
    screenRegion: z.object({
        base64: z.string().max(500000), // ~375KB max screenshot
        width: z.number().int().min(1).max(4000),
        height: z.number().int().min(1).max(4000),
    }).optional(),
    systemInfo: z.object({
        os: z.string().max(100),
        hostname: z.string().max(200),
        uptime: z.number(),
        batteryLevel: z.number().min(0).max(100).optional(),
    }).optional(),
    timestamp: z.number(),
});

// ============================================================================
// HELPERS
// ============================================================================

function getUserId(req: Request): number {
    const userId = (req as any).userId;
    if (!userId) throw new Error("User not authenticated");
    return userId;
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /context — Receive desktop context snapshot from the agent.
 * Called every 5-10 seconds by the desktop agent.
 */
router.post("/context", async (req: Request, res: Response) => {
    try {
        const userId = getUserId(req);
        const parsed = desktopContextSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: "Invalid desktop context",
                details: parsed.error.flatten(),
            });
        }

        await desktopAgentService.processContext(userId, parsed.data);

        res.json({ ok: true });
    } catch (error) {
        console.error("[DesktopAgent API] Context error:", error);
        res.status(500).json({ error: "Failed to process desktop context" });
    }
});

/**
 * GET /status — Get the desktop agent connection status for the current user.
 */
router.get("/status", async (req: Request, res: Response) => {
    try {
        const userId = getUserId(req);
        const status = desktopAgentService.getStatus(userId);
        res.json(status);
    } catch (error) {
        console.error("[DesktopAgent API] Status error:", error);
        res.status(500).json({ error: "Failed to get agent status" });
    }
});

/**
 * POST /register — Register a new desktop agent pairing.
 * Returns connection details and API key for the agent.
 */
router.post("/register", async (req: Request, res: Response) => {
    try {
        const userId = getUserId(req);

        // For now, registration just confirms the pairing
        // In the future, could generate an agent-specific API key
        res.json({
            success: true,
            userId,
            wsEndpoint: "/ws/sync",
            apiEndpoint: "/api/v2/desktop-agent/context",
            pollingInterval: 5000, // Recommended polling interval in ms
            message: "Desktop agent enregistré. Envoyez le contexte via POST /context.",
        });
    } catch (error) {
        console.error("[DesktopAgent API] Register error:", error);
        res.status(500).json({ error: "Failed to register agent" });
    }
});

export default router;
