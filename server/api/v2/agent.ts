import { Router, Request, Response } from "express";

const router = Router();

router.post("/execute", async (req: Request, res: Response) => {
  try {
    const { autonomousAgentService } = await import("../../services/autonomousAgentService");
    const { goal, maxSteps } = req.body;
    const userId = (req as any).userId || 1;

    if (!goal) {
      return res.status(400).json({ error: "goal requis — décris ce que tu veux accomplir" });
    }

    const task = await autonomousAgentService.planAndExecute(goal, userId, maxSteps || 8);
    res.json({
      success: task.status === "completed",
      taskId: task.id,
      status: task.status,
      stepsCompleted: task.steps.filter(s => s.status === "completed").length,
      stepsTotal: task.steps.length,
      summary: task.finalSummary,
      steps: task.steps.map(s => ({
        id: s.id,
        tool: s.tool,
        description: s.description,
        status: s.status,
        duration: s.startedAt && s.completedAt ? s.completedAt - s.startedAt : undefined,
        error: s.error,
      })),
      totalTime: task.completedAt ? task.completedAt - task.createdAt : undefined,
    });
  } catch (error: any) {
    console.error("[AgentRoute] Execute error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get("/status/:taskId", async (req: Request, res: Response) => {
  try {
    const { autonomousAgentService } = await import("../../services/autonomousAgentService");
    const task = autonomousAgentService.getTask(req.params.taskId);

    if (!task) {
      return res.status(404).json({ error: "Tâche introuvable" });
    }

    res.json({
      taskId: task.id,
      goal: task.goal,
      status: task.status,
      stepsCompleted: task.steps.filter(s => s.status === "completed").length,
      stepsTotal: task.steps.length,
      summary: task.finalSummary,
      steps: task.steps.map(s => ({
        id: s.id,
        tool: s.tool,
        description: s.description,
        status: s.status,
        duration: s.startedAt && s.completedAt ? s.completedAt - s.startedAt : undefined,
      })),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/active", async (_req: Request, res: Response) => {
  try {
    const { autonomousAgentService } = await import("../../services/autonomousAgentService");
    const active = autonomousAgentService.getActiveTasks();
    res.json({ count: active.length, tasks: active.map(t => ({ id: t.id, goal: t.goal, status: t.status, stepsCompleted: t.steps.filter(s => s.status === "completed").length, stepsTotal: t.steps.length })) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/history", async (req: Request, res: Response) => {
  try {
    const { autonomousAgentService } = await import("../../services/autonomousAgentService");
    const limit = parseInt(req.query.limit as string) || 10;
    const tasks = autonomousAgentService.getRecentTasks(limit);
    res.json({
      count: tasks.length,
      tasks: tasks.map(t => ({
        id: t.id, goal: t.goal, status: t.status,
        stepsCompleted: t.steps.filter(s => s.status === "completed").length,
        stepsTotal: t.steps.length,
        createdAt: t.createdAt, completedAt: t.completedAt,
        totalTime: t.completedAt ? t.completedAt - t.createdAt : undefined,
      })),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
