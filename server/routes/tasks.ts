import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { api } from "@shared/routes";
import { z } from "zod";

const router = Router();

// Étendre le type Request pour userId (injecté par le middleware auth)
interface AuthedRequest extends Request {
  userId?: number;
}

function getUserId(req: AuthedRequest): number {
  if (!req.userId || typeof req.userId !== "number") {
    throw new Error("UNAUTHENTICATED: userId missing on request");
  }
  return req.userId;
}

router.get(api.tasks.list.path.replace("/api", ""), async (req: AuthedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const projectIdParam = req.query.projectId;
    const projectId =
      typeof projectIdParam === "string" && projectIdParam.trim() !== ""
        ? Number(projectIdParam)
        : undefined;

    if (projectIdParam && (isNaN(Number(projectIdParam)) || projectId! < 0)) {
      return res.status(400).json({ message: "Invalid projectId" });
    }

    const tasks = await storage.getTasks(userId, projectId);
    return res.json(tasks);
  } catch (err) {
    console.error("[Tasks] GET list error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

router.post(api.tasks.create.path.replace("/api", ""), async (req: AuthedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const input = api.tasks.create.input.parse(req.body);
    const task = await storage.createTask({ ...input, userId });
    return res.status(201).json(task);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({
        message: err.errors[0]?.message || "Validation error",
        field: err.errors[0]?.path?.join(".") || undefined,
      });
    }
    console.error("[Tasks] POST create error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

router.patch(api.tasks.update.path.replace("/api", ""), async (req: AuthedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const id = Number(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid task id" });
    }

    // Check if task exists and get current state (for recurrence check)
    const currentTask = await storage.getTask(id, userId);
    if (!currentTask) {
      return res.status(404).json({ message: "Task not found" });
    }

    const input = api.tasks.update.input.parse(req.body);
    const task = await storage.updateTask(id, userId, input);
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    // Auto-generate next recurring task when marked as done
    if (input.status === 'done' && currentTask.status !== 'done' && task.recurrenceType) {
      const nextTask = await storage.generateNextRecurringTask(task);
      if (nextTask) {
        console.log(`[Tasks] Generated recurring task ${nextTask.id} from ${task.id}`);
      }
    }

    return res.json(task);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({
        message: err.errors[0]?.message || "Validation error",
        field: err.errors[0]?.path?.join(".") || undefined,
      });
    }
    console.error("[Tasks] PATCH update error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

router.delete(api.tasks.delete.path.replace("/api", ""), async (req: AuthedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const id = Number(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid task id" });
    }

    await storage.deleteTask(id, userId);
    return res.status(204).send();
  } catch (err) {
    console.error("[Tasks] DELETE error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// ========== SUBTASKS ==========
// Helper to verify task ownership
async function verifyTaskOwnership(taskId: number, userId: number): Promise<boolean> {
  const task = await storage.getTask(taskId, userId);
  return !!task;
}

router.get("/tasks/:taskId/subtasks", async (req: AuthedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const taskId = Number(req.params.taskId);
    if (isNaN(taskId) || taskId <= 0) {
      return res.status(400).json({ message: "Invalid task id" });
    }
    // Verify task ownership
    if (!await verifyTaskOwnership(taskId, userId)) {
      return res.status(404).json({ message: "Task not found" });
    }
    const subtasks = await storage.getSubtasks(taskId);
    return res.json(subtasks);
  } catch (err) {
    console.error("[Subtasks] GET error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

router.post("/tasks/:taskId/subtasks", async (req: AuthedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const taskId = Number(req.params.taskId);
    if (isNaN(taskId) || taskId <= 0) {
      return res.status(400).json({ message: "Invalid task id" });
    }
    // Verify task ownership
    if (!await verifyTaskOwnership(taskId, userId)) {
      return res.status(404).json({ message: "Task not found" });
    }
    const input = api.subtasks.create.input.parse(req.body);
    const subtask = await storage.createSubtask(taskId, input);
    return res.status(201).json(subtask);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: err.errors[0]?.message || "Validation error" });
    }
    console.error("[Subtasks] POST error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

router.patch("/subtasks/:id", async (req: AuthedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const id = Number(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid subtask id" });
    }
    // Verify subtask belongs to user's task
    const subtask = await storage.getSubtaskWithOwnership(id, userId);
    if (!subtask) {
      return res.status(404).json({ message: "Subtask not found" });
    }
    const input = api.subtasks.update.input.parse(req.body);
    const updated = await storage.updateSubtask(id, input);
    return res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: err.errors[0]?.message || "Validation error" });
    }
    console.error("[Subtasks] PATCH error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

router.delete("/subtasks/:id", async (req: AuthedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const id = Number(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid subtask id" });
    }
    // Verify subtask belongs to user's task
    const subtask = await storage.getSubtaskWithOwnership(id, userId);
    if (!subtask) {
      return res.status(404).json({ message: "Subtask not found" });
    }
    await storage.deleteSubtask(id);
    return res.status(204).send();
  } catch (err) {
    console.error("[Subtasks] DELETE error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// ========== TASK LABELS ==========

router.get("/labels", async (req: AuthedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const labels = await storage.getTaskLabels(userId);
    return res.json(labels);
  } catch (err) {
    console.error("[Labels] GET error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

router.post("/labels", async (req: AuthedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const input = api.taskLabels.create.input.parse(req.body);
    const label = await storage.createTaskLabel({ ...input, userId });
    return res.status(201).json(label);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: err.errors[0]?.message || "Validation error" });
    }
    console.error("[Labels] POST error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

router.delete("/labels/:id", async (req: AuthedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const id = Number(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid label id" });
    }
    await storage.deleteTaskLabel(id, userId);
    return res.status(204).send();
  } catch (err) {
    console.error("[Labels] DELETE error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

router.get("/tasks/:taskId/labels", async (req: AuthedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const taskId = Number(req.params.taskId);
    if (isNaN(taskId) || taskId <= 0) {
      return res.status(400).json({ message: "Invalid task id" });
    }
    // Verify task ownership
    if (!await verifyTaskOwnership(taskId, userId)) {
      return res.status(404).json({ message: "Task not found" });
    }
    const labels = await storage.getTaskLabelAssignments(taskId, userId);
    return res.json(labels);
  } catch (err) {
    console.error("[TaskLabels] GET error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

router.post("/tasks/:taskId/labels/:labelId", async (req: AuthedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const taskId = Number(req.params.taskId);
    const labelId = Number(req.params.labelId);
    if (isNaN(taskId) || taskId <= 0 || isNaN(labelId) || labelId <= 0) {
      return res.status(400).json({ message: "Invalid id" });
    }
    // Verify task ownership
    if (!await verifyTaskOwnership(taskId, userId)) {
      return res.status(404).json({ message: "Task not found" });
    }
    // Verify label belongs to user
    const labels = await storage.getTaskLabels(userId);
    if (!labels.some(l => l.id === labelId)) {
      return res.status(404).json({ message: "Label not found" });
    }
    await storage.assignLabelToTask(taskId, labelId);
    return res.status(201).json({ success: true });
  } catch (err) {
    console.error("[TaskLabels] POST error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

router.delete("/tasks/:taskId/labels/:labelId", async (req: AuthedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const taskId = Number(req.params.taskId);
    const labelId = Number(req.params.labelId);
    if (isNaN(taskId) || taskId <= 0 || isNaN(labelId) || labelId <= 0) {
      return res.status(400).json({ message: "Invalid id" });
    }
    // Verify task ownership
    if (!await verifyTaskOwnership(taskId, userId)) {
      return res.status(404).json({ message: "Task not found" });
    }
    // Verify label belongs to user
    const labels = await storage.getTaskLabels(userId);
    if (!labels.some(l => l.id === labelId)) {
      return res.status(404).json({ message: "Label not found" });
    }
    await storage.unassignLabelFromTask(taskId, labelId);
    return res.status(204).send();
  } catch (err) {
    console.error("[TaskLabels] DELETE error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

export default router;
