import { Router, type Request, type Response } from "express";
import { getTodoPlanForUser } from "../services/tools/maxAdvancedTools";

const router = Router();

router.get("/state", (req: Request, res: Response) => {
  const userId = (req.session as any)?.userId;
  if (!userId) return res.status(401).json({ error: "Authentification requise" });
  const plan = getTodoPlanForUser(userId);
  if (!plan) return res.json({ active: false });
  const done = plan.steps.filter((s) => s.status === "done").length;
  const inProgress = plan.steps.find((s) => s.status === "in_progress")?.id ?? null;
  res.json({
    active: true,
    objective: plan.objective,
    createdAt: plan.createdAt,
    totalSteps: plan.steps.length,
    doneSteps: done,
    inProgressStepId: inProgress,
    steps: plan.steps,
  });
});

export default router;
