import { Router, Request, Response } from "express";
import { skillEngine } from "../services/skillEngine";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { category, enabled } = req.query;
    const result = await skillEngine.listSkills({
      userId,
      category: category as string,
      enabled: enabled !== undefined ? enabled === "true" : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/catalog", async (_req: Request, res: Response) => {
  try {
    const catalog = await skillEngine.getCatalog();
    res.json(catalog);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const skill = await skillEngine.getSkill(parseInt(req.params.id));
    if (!skill) return res.status(404).json({ error: "Skill not found" });
    res.json(skill);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const skill = await skillEngine.createSkill({ userId, ...req.body });
    res.status(201).json(skill);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const { steps, ...data } = req.body;
    const updated = await skillEngine.updateSkill(parseInt(req.params.id), data);
    if (steps) {
      await skillEngine.updateSkillSteps(parseInt(req.params.id), steps);
    }
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    await skillEngine.deleteSkill(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/execute", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const result = await skillEngine.executeSkill(parseInt(req.params.id), {
      userId,
      params: req.body.params,
      agent: req.body.agent,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/executions/all", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const executions = await skillEngine.getExecutions({
      userId,
      limit: req.query.limit ? parseInt(req.query.limit as string) : 30,
    });
    res.json(executions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id/executions", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const executions = await skillEngine.getExecutions({
      skillId: parseInt(req.params.id),
      userId,
      limit: req.query.limit ? parseInt(req.query.limit as string) : 20,
    });
    res.json(executions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/seed", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "User ID required" });
    const count = await skillEngine.seedDefaultSkills(userId);
    res.json({ success: true, seeded: count });
  } catch (err: any) {
    console.error("[Skills] Seed error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
