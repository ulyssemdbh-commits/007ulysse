import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { api } from "@shared/routes";
import { z } from "zod";

const router = Router();

function getUserId(req: Request): number {
  return (req as any).userId;
}

router.get(api.projects.list.path.replace("/api", ""), async (req, res) => {
  const userId = getUserId(req);
  const projects = await storage.getProjects(userId);
  res.json(projects);
});

router.get(api.projects.get.path.replace("/api", ""), async (req, res) => {
  const userId = getUserId(req);
  const project = await storage.getProject(Number(req.params.id), userId);
  if (!project) return res.status(404).json({ message: "Project not found" });
  res.json(project);
});

router.post(api.projects.create.path.replace("/api", ""), async (req, res) => {
  try {
    const userId = getUserId(req);
    const input = api.projects.create.input.parse(req.body);
    const project = await storage.createProject({ ...input, userId });
    res.status(201).json(project);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
    }
    throw err;
  }
});

router.patch(api.projects.update.path.replace("/api", ""), async (req, res) => {
  try {
    const userId = getUserId(req);
    const input = api.projects.update.input.parse(req.body);
    const project = await storage.updateProject(Number(req.params.id), userId, input);
    if (!project) return res.status(404).json({ message: "Project not found" });
    res.json(project);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
    }
    throw err;
  }
});

router.delete(api.projects.delete.path.replace("/api", ""), async (req, res) => {
  const userId = getUserId(req);
  await storage.deleteProject(Number(req.params.id), userId);
  res.status(204).send();
});

export default router;
