import { Router, Request } from "express";
import { storage } from "../storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { emitProjectsUpdated, emitTasksUpdated, emitNotesUpdated } from "../services/realtimeSync";

const router = Router();

function getUserId(req: Request): number {
  const userId = (req.session as any)?.userId;
  if (!userId) {
    throw new Error("User not authenticated");
  }
  return userId;
}

// Approved Users Management (owner only)
router.get("/api/approved-users", async (req, res) => {
  try {
    const userId = getUserId(req);
    const user = await storage.getUser(userId);
    if (!user?.isOwner) {
      return res.status(403).json({ message: "Only the owner can manage approved users" });
    }
    const approved = await storage.getApprovedUsers();
    res.json(approved);
  } catch (err) {
    res.status(500).json({ message: "Failed to get approved users" });
  }
});

router.post("/api/approved-users", async (req, res) => {
  try {
    const userId = getUserId(req);
    const user = await storage.getUser(userId);
    if (!user?.isOwner) {
      return res.status(403).json({ message: "Only the owner can approve users" });
    }
    const { targetUserId, accessLevel, note } = req.body;
    const approved = await storage.addApprovedUser({
      userId: targetUserId,
      approvedBy: userId,
      accessLevel: accessLevel || "basic",
      note,
    });
    res.status(201).json(approved);
  } catch (err: any) {
    if (err.message?.includes("Maximum")) {
      return res.status(400).json({ message: err.message });
    }
    res.status(500).json({ message: "Failed to approve user" });
  }
});

router.delete("/api/approved-users/:userId", async (req, res) => {
  try {
    const currentUserId = getUserId(req);
    const user = await storage.getUser(currentUserId);
    if (!user?.isOwner) {
      return res.status(403).json({ message: "Only the owner can remove approved users" });
    }
    await storage.removeApprovedUser(Number(req.params.userId));
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ message: "Failed to remove approved user" });
  }
});

// Projects (all protected by middleware above, filtered by userId)
router.get(api.projects.list.path, async (req, res) => {
  const userId = getUserId(req);
  const projects = await storage.getProjects(userId);
  res.json(projects);
});

router.get(api.projects.get.path, async (req, res) => {
  const userId = getUserId(req);
  const project = await storage.getProject(Number(req.params.id), userId);
  if (!project) return res.status(404).json({ message: "Project not found" });
  res.json(project);
});

router.post(api.projects.create.path, async (req, res) => {
  try {
    const userId = getUserId(req);
    const input = api.projects.create.input.omit({ userId: true }).parse(req.body);
    const project = await storage.createProject({ ...input, userId });
    res.status(201).json(project);
    emitProjectsUpdated(userId);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
    }
    throw err;
  }
});

router.patch(api.projects.update.path, async (req, res) => {
  try {
    const userId = getUserId(req);
    const input = api.projects.update.input.parse(req.body);
    const project = await storage.updateProject(Number(req.params.id), userId, input);
    if (!project) return res.status(404).json({ message: "Project not found" });
    res.json(project);
    emitProjectsUpdated(userId);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
    }
    throw err;
  }
});

router.delete(api.projects.delete.path, async (req, res) => {
  const userId = getUserId(req);
  await storage.deleteProject(Number(req.params.id), userId);
  res.status(204).send();
  emitProjectsUpdated(userId);
});

// Tasks (filtered by userId)
router.get(api.tasks.list.path, async (req, res) => {
  const userId = getUserId(req);
  const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
  const tasks = await storage.getTasks(userId, projectId);
  res.json(tasks);
});

router.post(api.tasks.create.path, async (req, res) => {
  try {
    const userId = getUserId(req);
    const input = api.tasks.create.input.parse(req.body);
    const task = await storage.createTask({ ...input, userId });
    res.status(201).json(task);
    emitTasksUpdated(userId);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
    }
    throw err;
  }
});

router.patch(api.tasks.update.path, async (req, res) => {
  try {
    const userId = getUserId(req);
    const input = api.tasks.update.input.parse(req.body);
    const task = await storage.updateTask(Number(req.params.id), userId, input);
    if (!task) return res.status(404).json({ message: "Task not found" });
    res.json(task);
    emitTasksUpdated(userId);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
    }
    throw err;
  }
});

router.delete(api.tasks.delete.path, async (req, res) => {
  const userId = getUserId(req);
  await storage.deleteTask(Number(req.params.id), userId);
  res.status(204).send();
  emitTasksUpdated(userId);
});

// Task Labels
router.get("/api/labels", async (req, res) => {
  try {
    const userId = getUserId(req);
    const labels = await storage.getTaskLabels(userId);
    res.json(labels);
  } catch (err) {
    console.error("[Labels] GET error:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

router.post("/api/labels", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { name, color } = req.body;
    if (!name) return res.status(400).json({ message: "Name is required" });
    const label = await storage.createTaskLabel({ name, color, userId });
    res.status(201).json(label);
  } catch (err) {
    console.error("[Labels] POST error:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

router.delete("/api/labels/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    const id = Number(req.params.id);
    if (isNaN(id) || id <= 0) return res.status(400).json({ message: "Invalid label id" });
    await storage.deleteTaskLabel(id, userId);
    res.status(204).send();
  } catch (err) {
    console.error("[Labels] DELETE error:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

router.get("/api/tasks/:taskId/labels", async (req, res) => {
  try {
    const userId = getUserId(req);
    const taskId = Number(req.params.taskId);
    if (isNaN(taskId) || taskId <= 0) return res.status(400).json({ message: "Invalid task id" });
    const labels = await storage.getTaskLabelAssignments(taskId, userId);
    res.json(labels);
  } catch (err) {
    console.error("[TaskLabels] GET error:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

router.post("/api/tasks/:taskId/labels/:labelId", async (req, res) => {
  try {
    const userId = getUserId(req);
    const taskId = Number(req.params.taskId);
    const labelId = Number(req.params.labelId);
    if (isNaN(taskId) || isNaN(labelId)) return res.status(400).json({ message: "Invalid id" });
    await storage.assignLabelToTask(taskId, labelId);
    res.status(201).json({ success: true });
  } catch (err) {
    console.error("[TaskLabels] POST error:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

router.delete("/api/tasks/:taskId/labels/:labelId", async (req, res) => {
  try {
    const userId = getUserId(req);
    const taskId = Number(req.params.taskId);
    const labelId = Number(req.params.labelId);
    if (isNaN(taskId) || isNaN(labelId)) return res.status(400).json({ message: "Invalid id" });
    await storage.unassignLabelFromTask(taskId, labelId);
    res.status(204).send();
  } catch (err) {
    console.error("[TaskLabels] DELETE error:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// Notes (filtered by userId)
router.get(api.notes.list.path, async (req, res) => {
  const userId = getUserId(req);
  const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
  const notes = await storage.getNotes(userId, projectId);
  res.json(notes);
});

router.get(api.notes.get.path, async (req, res) => {
  const userId = getUserId(req);
  const note = await storage.getNote(Number(req.params.id), userId);
  if (!note) return res.status(404).json({ message: "Note not found" });
  res.json(note);
});

router.post(api.notes.create.path, async (req, res) => {
  try {
    const userId = getUserId(req);
    const input = api.notes.create.input.parse(req.body);
    const note = await storage.createNote({ ...input, userId });
    res.status(201).json(note);
    emitNotesUpdated(userId);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
    }
    throw err;
  }
});

router.patch(api.notes.update.path, async (req, res) => {
  try {
    const userId = getUserId(req);
    const input = api.notes.update.input.parse(req.body);
    const note = await storage.updateNote(Number(req.params.id), userId, input);
    if (!note) return res.status(404).json({ message: "Note not found" });
    res.json(note);
    emitNotesUpdated(userId);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
    }
    throw err;
  }
});

router.delete(api.notes.delete.path, async (req, res) => {
  const userId = getUserId(req);
  await storage.deleteNote(Number(req.params.id), userId);
  res.status(204).send();
  emitNotesUpdated(userId);
});

// Ambiance Profiles (filtered by userId)
router.get("/api/ambiance-profiles", async (req, res) => {
  try {
    const userId = getUserId(req);
    const profiles = await storage.getAmbianceProfiles(userId);
    res.json(profiles);
  } catch (err) {
    res.status(500).json({ message: "Failed to get ambiance profiles" });
  }
});

router.get("/api/ambiance-profiles/active", async (req, res) => {
  try {
    const userId = getUserId(req);
    const profile = await storage.getActiveAmbianceProfile(userId);
    res.json(profile || null);
  } catch (err) {
    res.status(500).json({ message: "Failed to get active profile" });
  }
});

router.post("/api/ambiance-profiles", async (req, res) => {
  try {
    const userId = getUserId(req);
    const profile = await storage.createAmbianceProfile({ ...req.body, userId });
    res.status(201).json(profile);
  } catch (err) {
    res.status(500).json({ message: "Failed to create ambiance profile" });
  }
});

router.patch("/api/ambiance-profiles/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    const profile = await storage.updateAmbianceProfile(Number(req.params.id), userId, req.body);
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    res.json(profile);
  } catch (err) {
    res.status(500).json({ message: "Failed to update ambiance profile" });
  }
});

router.post("/api/ambiance-profiles/:id/activate", async (req, res) => {
  try {
    const userId = getUserId(req);
    const profile = await storage.setActiveAmbianceProfile(Number(req.params.id), userId);
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    res.json(profile);
  } catch (err) {
    res.status(500).json({ message: "Failed to activate profile" });
  }
});

router.delete("/api/ambiance-profiles/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    await storage.deleteAmbianceProfile(Number(req.params.id), userId);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ message: "Failed to delete ambiance profile" });
  }
});

router.post("/api/ambiance-profiles/init-presets", async (req, res) => {
  try {
    const userId = getUserId(req);
    const existing = await storage.getAmbianceProfiles(userId);
    
    if (existing.length > 0) {
      return res.json({ message: "Presets already exist", profiles: existing });
    }

    const presets = [
      {
        userId,
        name: "Zen",
        description: "Ambiance calme et apaisante",
        isPreset: true,
        visualMode: "orb",
        orbColor: "#22c55e",
        orbIntensity: 30,
        backgroundGradient: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)",
        autoSpeak: true,
        voiceSpeed: 90,
        voicePitch: 95,
        ambientSound: "rain",
        ambientVolume: 25,
      },
      {
        userId,
        name: "Focus",
        description: "Mode concentration maximale",
        isPreset: true,
        visualMode: "equalizer",
        orbColor: "#6366f1",
        orbIntensity: 50,
        backgroundGradient: "linear-gradient(135deg, #0c0a09 0%, #1c1917 100%)",
        autoSpeak: false,
        voiceSpeed: 110,
        voicePitch: 100,
        ambientSound: "none",
        ambientVolume: 0,
      },
      {
        userId,
        name: "Creative",
        description: "Inspiration et creativite",
        isPreset: true,
        visualMode: "orb",
        orbColor: "#f59e0b",
        orbIntensity: 70,
        backgroundGradient: "linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)",
        autoSpeak: true,
        voiceSpeed: 100,
        voicePitch: 105,
        ambientSound: "forest",
        ambientVolume: 20,
      },
      {
        userId,
        name: "Night",
        description: "Mode nuit reposant",
        isPreset: true,
        isActive: true,
        visualMode: "orb",
        orbColor: "#8b5cf6",
        orbIntensity: 25,
        backgroundGradient: "linear-gradient(135deg, #020617 0%, #0f172a 100%)",
        autoSpeak: true,
        voiceSpeed: 85,
        voicePitch: 90,
        ambientSound: "ocean",
        ambientVolume: 15,
      },
    ];

    const created = [];
    for (const preset of presets) {
      const profile = await storage.createAmbianceProfile(preset as any);
      created.push(profile);
    }

    res.status(201).json({ message: "Presets initialized", profiles: created });
  } catch (err) {
    console.error("Failed to initialize presets:", err);
    res.status(500).json({ message: "Failed to initialize presets" });
  }
});

export default router;
