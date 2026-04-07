import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { api } from "@shared/routes";
import { z } from "zod";

const router = Router();

function getUserId(req: Request): number {
  return (req as any).userId;
}

router.get(api.notes.list.path.replace("/api", ""), async (req, res) => {
  const userId = getUserId(req);
  const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
  const notes = await storage.getNotes(userId, projectId);
  res.json(notes);
});

router.get(api.notes.get.path.replace("/api", ""), async (req, res) => {
  const userId = getUserId(req);
  const note = await storage.getNote(Number(req.params.id), userId);
  if (!note) return res.status(404).json({ message: "Note not found" });
  res.json(note);
});

router.post(api.notes.create.path.replace("/api", ""), async (req, res) => {
  try {
    const userId = getUserId(req);
    const input = api.notes.create.input.parse(req.body);
    const note = await storage.createNote({ ...input, userId });
    res.status(201).json(note);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
    }
    throw err;
  }
});

router.patch(api.notes.update.path.replace("/api", ""), async (req, res) => {
  try {
    const userId = getUserId(req);
    const input = api.notes.update.input.parse(req.body);
    const note = await storage.updateNote(Number(req.params.id), userId, input);
    if (!note) return res.status(404).json({ message: "Note not found" });
    res.json(note);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
    }
    throw err;
  }
});

router.delete(api.notes.delete.path.replace("/api", ""), async (req, res) => {
  const userId = getUserId(req);
  await storage.deleteNote(Number(req.params.id), userId);
  res.status(204).send();
});

export default router;
