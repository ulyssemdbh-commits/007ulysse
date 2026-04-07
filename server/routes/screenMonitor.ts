import { Router, Request, Response } from "express";
import { z } from "zod";
import { screenMonitorService } from "../services/screenMonitorService";
import { isUserScreenActive, pauseUserSession, resumeUserSession, stopUserSession, sendRemoteControlCommand, isAgentRemoteControlCapable, isAgentRemoteControlEnabled } from "../services/screenMonitorWs";

const router = Router();

function requireOwner(req: Request, res: Response): boolean {
  const isOwner = (req as any).isOwner;
  if (!isOwner) {
    res.status(403).json({ error: "Owner access required for screen monitoring" });
    return false;
  }
  return true;
}

const preferencesSchema = z.object({
  enabled: z.boolean().optional(),
  analysisIntervalSec: z.number().min(3).max(30).optional(),
  saveHistory: z.boolean().optional(),
  privacyFilterEnabled: z.boolean().optional(),
  allowedApps: z.array(z.string()).optional(),
  blockedApps: z.array(z.string()).optional()
});

router.get("/preferences", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId || !requireOwner(req, res)) return;

    const prefs = await screenMonitorService.getPreferences(userId);
    res.json({
      userId,
      enabled: prefs?.isEnabled ?? false,
      analysisIntervalSec: Math.round((prefs?.captureIntervalMs ?? 5000) / 1000),
      saveHistory: true,
      privacyFilterEnabled: (prefs?.privacyFilters?.length ?? 0) > 0,
      allowedApps: [],
      blockedApps: prefs?.privacyFilters ?? []
    });
  } catch (error) {
    console.error("[ScreenMonitor] Error getting preferences:", error);
    res.status(500).json({ error: "Failed to get preferences" });
  }
});

router.put("/preferences", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId || !requireOwner(req, res)) return;

    const data = preferencesSchema.parse(req.body);
    
    const updateData: any = {};
    if (data.enabled !== undefined) updateData.isEnabled = data.enabled;
    if (data.analysisIntervalSec !== undefined) updateData.captureIntervalMs = data.analysisIntervalSec * 1000;
    if (data.privacyFilterEnabled !== undefined && data.blockedApps) updateData.privacyFilters = data.blockedApps;
    else if (data.privacyFilterEnabled === false) updateData.privacyFilters = [];
    
    const updated = await screenMonitorService.setPreferences(userId, updateData);
    res.json({
      userId,
      enabled: updated.isEnabled,
      analysisIntervalSec: Math.round(updated.captureIntervalMs / 1000),
      saveHistory: true,
      privacyFilterEnabled: (updated.privacyFilters?.length ?? 0) > 0,
      allowedApps: [],
      blockedApps: updated.privacyFilters ?? []
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    console.error("[ScreenMonitor] Error updating preferences:", error);
    res.status(500).json({ error: "Failed to update preferences" });
  }
});

router.get("/status", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId || !requireOwner(req, res)) return;

    const prefs = await screenMonitorService.getPreferences(userId);
    const session = await screenMonitorService.getActiveSession(userId);
    const allStats = await screenMonitorService.getSessionStats(userId);

    res.json({
      preferences: {
        userId,
        enabled: prefs?.isEnabled ?? false,
        analysisIntervalSec: Math.round((prefs?.captureIntervalMs ?? 5000) / 1000),
        saveHistory: true,
        privacyFilterEnabled: (prefs?.privacyFilters?.length ?? 0) > 0,
        allowedApps: [],
        blockedApps: prefs?.privacyFilters ?? []
      },
      activeSession: session ? {
        id: session.id,
        status: session.status,
        startedAt: session.startedAt,
        pausedAt: session.pausedAt,
        endedAt: session.endedAt,
        deviceId: session.deviceId,
        deviceName: session.deviceName,
        framesReceived: session.totalFrames ?? 0,
        framesAnalyzed: session.totalAnalyses ?? 0,
        lastFrameAt: session.lastFrameAt
      } : null,
      stats: {
        totalSessions: allStats.totalSessions ?? 0,
        totalFrames: allStats.totalFrames ?? 0,
        totalEvents: allStats.totalEvents ?? 0
      }
    });
  } catch (error) {
    console.error("[ScreenMonitor] Error getting status:", error);
    res.status(500).json({ error: "Failed to get status" });
  }
});

const toggleSchema = z.object({
  action: z.enum(["start", "pause", "resume", "stop"])
});

router.post("/toggle", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId || !requireOwner(req, res)) return;

    const { action } = toggleSchema.parse(req.body);
    
    switch (action) {
      case "start":
        await screenMonitorService.setPreferences(userId, { isEnabled: true });
        res.json({ success: true, message: "Screen monitoring enabled" });
        break;
        
      case "pause":
        await pauseUserSession(userId);
        res.json({ success: true, message: "Session paused" });
        break;
        
      case "resume":
        await resumeUserSession(userId);
        res.json({ success: true, message: "Session resumed" });
        break;
        
      case "stop":
        await stopUserSession(userId);
        await screenMonitorService.endSession(userId);
        await screenMonitorService.setPreferences(userId, { isEnabled: false });
        res.json({ success: true, message: "Session stopped" });
        break;
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid action", details: error.errors });
    }
    console.error("[ScreenMonitor] Error toggling:", error);
    res.status(500).json({ error: "Failed to toggle monitoring" });
  }
});

router.get("/context", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId || !requireOwner(req, res)) return;

    const limit = parseInt(req.query.limit as string) || 10;
    const events = await screenMonitorService.getRecentContext(userId, limit);
    res.json(events);
  } catch (error) {
    console.error("[ScreenMonitor] Error getting context:", error);
    res.status(500).json({ error: "Failed to get context" });
  }
});

router.get("/patterns", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId || !requireOwner(req, res)) return;

    const patterns = await screenMonitorService.getWorkPatterns(userId);
    res.json(patterns);
  } catch (error) {
    console.error("[ScreenMonitor] Error getting patterns:", error);
    res.status(500).json({ error: "Failed to get patterns" });
  }
});

router.get("/current-context", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId || !requireOwner(req, res)) return;

    const context = await screenMonitorService.getCurrentContext(userId);
    res.json({ context });
  } catch (error) {
    console.error("[ScreenMonitor] Error getting current context:", error);
    res.status(500).json({ error: "Failed to get current context" });
  }
});

// NEW: Get session profile (focus_dev, distraction, business, etc.)
router.get("/session-profile", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId || !requireOwner(req, res)) return;

    const timeWindow = parseInt(req.query.timeWindow as string) || 30;
    const profile = await screenMonitorService.computeSessionProfile(userId, timeWindow);
    res.json(profile);
  } catch (error) {
    console.error("[ScreenMonitor] Error getting session profile:", error);
    res.status(500).json({ error: "Failed to get session profile" });
  }
});

// NEW: Get flow suggestions based on current patterns
router.get("/flow-suggestion", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId || !requireOwner(req, res)) return;

    const suggestion = await screenMonitorService.suggestFlowFromPatterns(userId);
    res.json(suggestion);
  } catch (error) {
    console.error("[ScreenMonitor] Error getting flow suggestion:", error);
    res.status(500).json({ error: "Failed to get flow suggestion" });
  }
});

// NEW: Get Kanban/task suggestions based on screen activity
router.get("/kanban-suggestions", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId || !requireOwner(req, res)) return;

    const suggestions = await screenMonitorService.getKanbanSuggestions(userId);
    res.json(suggestions);
  } catch (error) {
    console.error("[ScreenMonitor] Error getting kanban suggestions:", error);
    res.status(500).json({ error: "Failed to get kanban suggestions" });
  }
});

// NEW: Get brain-ready screen context (for BrainContextService)
router.get("/brain-context", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId || !requireOwner(req, res)) return;

    const context = await screenMonitorService.generateBrainScreenContext(userId);
    res.json({ context });
  } catch (error) {
    console.error("[ScreenMonitor] Error getting brain context:", error);
    res.status(500).json({ error: "Failed to get brain context" });
  }
});

// NEW: Get full insights for brain sync (includes session profile)
router.get("/brain-insights", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId || !requireOwner(req, res)) return;

    const insights = await screenMonitorService.getInsightsForBrain(userId);
    res.json(insights);
  } catch (error) {
    console.error("[ScreenMonitor] Error getting brain insights:", error);
    res.status(500).json({ error: "Failed to get brain insights" });
  }
});

// ─── REMOTE CONTROL (Prise en main) ──────────────────────────

router.get("/remote-control/status", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId || !requireOwner(req, res)) return;

    const agentConnected = isUserScreenActive(userId);
    const capable = isAgentRemoteControlCapable(userId);
    const enabled = isAgentRemoteControlEnabled(userId);

    res.json({
      agentConnected,
      remoteControlCapable: capable,
      remoteControlEnabled: enabled,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to get remote control status" });
  }
});

router.post("/remote-control/enable", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId || !requireOwner(req, res)) return;

    if (!isUserScreenActive(userId)) {
      return res.status(400).json({ error: "No agent connected" });
    }

    const sent = sendRemoteControlCommand(userId, { type: "remote_control.enable" });
    res.json({ success: sent, message: sent ? "Prise en main activée" : "Agent non connecté" });
  } catch (error) {
    res.status(500).json({ error: "Failed to enable remote control" });
  }
});

router.post("/remote-control/disable", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId || !requireOwner(req, res)) return;

    const sent = sendRemoteControlCommand(userId, { type: "remote_control.disable" });
    res.json({ success: sent, message: "Prise en main désactivée" });
  } catch (error) {
    res.status(500).json({ error: "Failed to disable remote control" });
  }
});

const remoteControlCmdSchema = z.object({
  cmd: z.enum(["mouse_move", "click", "double_click", "right_click", "scroll", "key_press", "type_text", "screenshot"]),
  x: z.number().optional(),
  y: z.number().optional(),
  button: z.enum(["left", "right", "middle"]).optional(),
  key: z.string().optional(),
  text: z.string().optional(),
  clicks: z.number().optional(),
});

router.post("/remote-control/cmd", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId || !requireOwner(req, res)) return;

    if (!isAgentRemoteControlEnabled(userId)) {
      return res.status(400).json({ error: "Remote control not enabled" });
    }

    const cmd = remoteControlCmdSchema.parse(req.body);
    const sent = sendRemoteControlCommand(userId, { type: "remote_control.cmd", ...cmd });
    res.json({ success: sent });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid command", details: error.errors });
    }
    res.status(500).json({ error: "Failed to send command" });
  }
});

import path from "path";
import fs from "fs";

router.get("/download-agent", async (_req: Request, res: Response) => {
  try {
    const agentPath = path.join(process.cwd(), "server", "assets", "ulysse_screen_agent.py");
    if (!fs.existsSync(agentPath)) {
      return res.status(404).json({ error: "Agent script not found" });
    }
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", "attachment; filename=ulysse_screen_agent.py");
    fs.createReadStream(agentPath).pipe(res);
  } catch (error) {
    res.status(500).json({ error: "Failed to download agent" });
  }
});

export default router;
