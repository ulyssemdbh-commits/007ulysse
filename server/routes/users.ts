import { Router, Request, Response } from "express";
import { storage } from "../storage";

const router = Router();

function getUserId(req: Request): number {
  return (req as any).userId;
}

router.get("/approved-users", async (req, res) => {
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

router.post("/approved-users", async (req, res) => {
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

router.delete("/approved-users/:userId", async (req, res) => {
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

export default router;
