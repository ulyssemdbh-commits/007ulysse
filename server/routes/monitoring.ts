import { Router, Request, Response } from "express";
import { z } from "zod";
import {
  addMonitoredSite,
  getMonitoredSites,
  removeMonitoredSite,
  acknowledgeAlert,
  getSiteSummary,
  updateSiteSettings,
  forceCheckSite,
  getMonitoringStats,
  getUnreadAlerts
} from "../services/monitoringService";

const router = Router();

function getUserId(req: Request): number {
  return (req as any).userId;
}

const addSiteSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  checkIntervalMinutes: z.number().min(1).max(1440).optional().default(60),
  alertThresholdMs: z.number().min(100).max(120000).optional().default(30000)
});

const updateSiteSchema = z.object({
  name: z.string().min(1).optional(),
  checkInterval: z.number().min(1).max(1440).optional(),
  alertThreshold: z.number().min(100).max(120000).optional(),
  isActive: z.boolean().optional()
});

router.get("/sites", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const sites = await getMonitoredSites(userId);
    res.json(sites);
  } catch (err) {
    res.status(500).json({ message: "Failed to get monitored sites" });
  }
});

router.get("/sites/:id", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const summary = await getSiteSummary(userId, Number(req.params.id));
    if (!summary) return res.status(404).json({ message: "Site not found" });
    res.json(summary);
  } catch (err) {
    res.status(500).json({ message: "Failed to get site summary" });
  }
});

router.post("/sites", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const parsed = addSiteSchema.parse(req.body);
    const site = await addMonitoredSite(userId, {
      name: parsed.name,
      url: parsed.url,
      checkInterval: parsed.checkIntervalMinutes,
      alertThreshold: parsed.alertThresholdMs
    });
    res.status(201).json(site);
  } catch (err: any) {
    if (err.name === "ZodError") {
      return res.status(400).json({ message: "Invalid request", errors: err.errors });
    }
    res.status(500).json({ message: "Failed to add monitored site" });
  }
});

router.patch("/sites/:id", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const parsed = updateSiteSchema.parse(req.body);
    const site = await updateSiteSettings(userId, Number(req.params.id), parsed);
    if (!site) return res.status(404).json({ message: "Site not found" });
    res.json(site);
  } catch (err: any) {
    if (err.name === "ZodError") {
      return res.status(400).json({ message: "Invalid request", errors: err.errors });
    }
    res.status(500).json({ message: "Failed to update site" });
  }
});

router.delete("/sites/:id", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    await removeMonitoredSite(userId, Number(req.params.id));
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ message: "Failed to delete site" });
  }
});

router.post("/sites/:id/check", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const check = await forceCheckSite(userId, Number(req.params.id));
    if (!check) return res.status(404).json({ message: "Site not found" });
    res.json(check);
  } catch (err) {
    res.status(500).json({ message: "Failed to check site" });
  }
});

router.get("/stats", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const stats = await getMonitoringStats(userId);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ message: "Failed to get monitoring stats" });
  }
});

router.get("/alerts", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const alerts = await getUnreadAlerts(userId);
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ message: "Failed to get alerts" });
  }
});

router.post("/alerts/:id/acknowledge", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const success = await acknowledgeAlert(userId, Number(req.params.id));
    res.json({ acknowledged: success });
  } catch (err) {
    res.status(500).json({ message: "Failed to acknowledge alert" });
  }
});

export default router;
