import { Router, Request, Response } from "express";
import { traceCollector } from "../services/traceCollector";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  try {
    const { agent, domain, status, from, to, limit, offset } = req.query;
    const userId = (req as any).user?.id;
    const result = await traceCollector.getTraces({
      userId,
      agent: agent as string,
      domain: domain as string,
      status: status as string,
      from: from ? new Date(from as string) : undefined,
      to: to ? new Date(to as string) : undefined,
      limit: limit ? parseInt(limit as string) : 50,
      offset: offset ? parseInt(offset as string) : 0,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/stats", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const days = req.query.days ? parseInt(req.query.days as string) : 30;
    const stats = await traceCollector.getStats({ userId, days });
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:traceId", async (req: Request, res: Response) => {
  try {
    const trace = await traceCollector.getTrace(req.params.traceId);
    if (!trace) return res.status(404).json({ error: "Trace not found" });
    res.json(trace);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:traceId/feedback", async (req: Request, res: Response) => {
  try {
    const { feedback, score } = req.body;
    if (!feedback) return res.status(400).json({ error: "feedback required" });
    const ok = await traceCollector.recordFeedback(req.params.traceId, feedback, score);
    res.json({ success: ok });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
