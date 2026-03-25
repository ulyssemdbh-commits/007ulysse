import { Router, Request, Response } from "express";
import { storage } from "../storage";

const router = Router();

function getUserId(req: Request): number {
  return (req as any).userId;
}

router.get("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    const profiles = await storage.getAmbianceProfiles(userId);
    res.json(profiles);
  } catch (err) {
    res.status(500).json({ message: "Failed to get ambiance profiles" });
  }
});

router.get("/active", async (req, res) => {
  try {
    const userId = getUserId(req);
    const profile = await storage.getActiveAmbianceProfile(userId);
    res.json(profile || null);
  } catch (err) {
    res.status(500).json({ message: "Failed to get active profile" });
  }
});

router.post("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    const profile = await storage.createAmbianceProfile({ ...req.body, userId });
    res.status(201).json(profile);
  } catch (err) {
    res.status(500).json({ message: "Failed to create ambiance profile" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    const profile = await storage.updateAmbianceProfile(Number(req.params.id), userId, req.body);
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    res.json(profile);
  } catch (err) {
    res.status(500).json({ message: "Failed to update ambiance profile" });
  }
});

router.post("/:id/activate", async (req, res) => {
  try {
    const userId = getUserId(req);
    const profile = await storage.setActiveAmbianceProfile(Number(req.params.id), userId);
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    res.json(profile);
  } catch (err) {
    res.status(500).json({ message: "Failed to activate ambiance profile" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    await storage.deleteAmbianceProfile(Number(req.params.id), userId);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ message: "Failed to delete ambiance profile" });
  }
});

export default router;
