/**
 * Speaker Recognition API Routes
 * Proxies requests to the Python speaker recognition service
 */

import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import fetch from "node-fetch";
import FormData from "form-data";
import multer from "multer";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const SPEAKER_SERVICE_URL = process.env.SPEAKER_SERVICE_URL || "http://localhost:5001";

// Health check for speaker service
router.get("/health", async (req: Request, res: Response) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${SPEAKER_SERVICE_URL}/health`, {
      signal: controller.signal as any,
    });
    clearTimeout(timeout);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(503).json({ 
      status: "unavailable", 
      error: "Speaker recognition service is not running" 
    });
  }
});

// Enroll a voice sample for the current user
router.post("/enroll", requireAuth, upload.single("audio"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file provided" });
    }

    const userId = (req as any).user?.id?.toString();
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    // Create form data for Python service
    const formData = new FormData();
    formData.append("audio", req.file.buffer, {
      filename: "audio.wav",
      contentType: req.file.mimetype || "audio/wav",
    });
    formData.append("user_id", userId);

    const response = await fetch(`${SPEAKER_SERVICE_URL}/enroll`, {
      method: "POST",
      body: formData as any,
      headers: formData.getHeaders(),
    });

    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    console.log(`[Speaker] Enrolled voice sample for user ${userId}, count: ${data.sample_count}`);
    res.json(data);
  } catch (error: any) {
    console.error("[Speaker] Enrollment error:", error.message);
    res.status(500).json({ error: "Failed to enroll voice sample" });
  }
});

// Identify speaker from audio (requires authentication for security)
router.post("/identify", requireAuth, upload.single("audio"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file provided" });
    }

    const formData = new FormData();
    formData.append("audio", req.file.buffer, {
      filename: "audio.wav",
      contentType: req.file.mimetype || "audio/wav",
    });

    const response = await fetch(`${SPEAKER_SERVICE_URL}/identify`, {
      method: "POST",
      body: formData as any,
      headers: formData.getHeaders(),
    });

    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    console.log(`[Speaker] Identified: ${data.speaker}, confidence: ${data.confidence}`);
    res.json(data);
  } catch (error: any) {
    console.error("[Speaker] Identification error:", error.message);
    res.status(500).json({ error: "Failed to identify speaker" });
  }
});

// Verify if audio matches a specific user
router.post("/verify", requireAuth, upload.single("audio"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file provided" });
    }

    const userId = (req as any).user?.id?.toString();
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const formData = new FormData();
    formData.append("audio", req.file.buffer, {
      filename: "audio.wav",
      contentType: req.file.mimetype || "audio/wav",
    });
    formData.append("user_id", userId);

    const response = await fetch(`${SPEAKER_SERVICE_URL}/verify`, {
      method: "POST",
      body: formData as any,
      headers: formData.getHeaders(),
    });

    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    console.log(`[Speaker] Verified user ${userId}: ${data.verified}, confidence: ${data.confidence}`);
    res.json(data);
  } catch (error: any) {
    console.error("[Speaker] Verification error:", error.message);
    res.status(500).json({ error: "Failed to verify speaker" });
  }
});

// Get current user's enrollment status
router.get("/profile", requireAuth, async (req: Request, res: Response) => {
  try {
    const response = await fetch(`${SPEAKER_SERVICE_URL}/profiles`);
    const data = await response.json() as { profiles: Array<{ user_id: string; sample_count: number }> };
    
    const userId = (req as any).user?.id?.toString();
    const userProfile = data.profiles?.find((p: any) => p.user_id === userId);
    
    if (userProfile) {
      res.json({
        enrolled: true,
        sample_count: userProfile.sample_count,
        user_id: userId,
      });
    } else {
      res.json({
        enrolled: false,
        sample_count: 0,
        user_id: userId,
      });
    }
  } catch (error: any) {
    console.error("[Speaker] Profile check error:", error.message);
    res.status(500).json({ error: "Failed to check profile" });
  }
});

// Delete current user's voice profile
router.delete("/profile", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id?.toString();
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const response = await fetch(`${SPEAKER_SERVICE_URL}/profiles/${userId}`, {
      method: "DELETE",
    });

    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    console.log(`[Speaker] Deleted voice profile for user ${userId}`);
    res.json(data);
  } catch (error: any) {
    console.error("[Speaker] Profile deletion error:", error.message);
    res.status(500).json({ error: "Failed to delete profile" });
  }
});

export default router;
