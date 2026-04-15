import { Router, Request, Response } from "express";

const router = Router();

router.post("/analyze", async (req: Request, res: Response) => {
  try {
    const { visionLiveService } = await import("../../services/visionLiveService");
    const { imageBase64, mimeType, restaurant } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: "imageBase64 requis" });
    }

    const result = await visionLiveService.analyzeImage(
      imageBase64,
      mimeType || "image/jpeg",
      restaurant || "suguval"
    );

    res.json(result);
  } catch (error: any) {
    console.error("[VisionRoute] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
