import { Router, Request, Response } from "express";
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const router = Router();

router.get("/status", async (_req: Request, res: Response) => {
  try {
    const { voiceModeService } = await import("../../services/voiceModeService");
    res.json(voiceModeService.getStatus());
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/transcribe", upload.single("audio"), async (req: Request, res: Response) => {
  try {
    const { voiceModeService } = await import("../../services/voiceModeService");

    let audioBuffer: Buffer;
    let mimeType: string;

    if (req.file) {
      audioBuffer = req.file.buffer;
      mimeType = req.file.mimetype || "audio/webm";
    } else if (req.body.audioBase64) {
      audioBuffer = Buffer.from(req.body.audioBase64, "base64");
      mimeType = req.body.mimeType || "audio/webm";
    } else {
      return res.status(400).json({ error: "Audio requis (file upload ou audioBase64)" });
    }

    const result = await voiceModeService.transcribe(audioBuffer, mimeType);
    res.json(result);
  } catch (error: any) {
    console.error("[VoiceRoute] Transcribe error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post("/synthesize", async (req: Request, res: Response) => {
  try {
    const { voiceModeService } = await import("../../services/voiceModeService");
    const { text, voice, speed } = req.body;

    if (!text) {
      return res.status(400).json({ error: "text requis" });
    }

    const result = await voiceModeService.synthesize(text, voice || "onyx", speed || 1.0);
    res.json(result);
  } catch (error: any) {
    console.error("[VoiceRoute] Synthesize error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post("/converse", upload.single("audio"), async (req: Request, res: Response) => {
  try {
    const { voiceModeService } = await import("../../services/voiceModeService");
    const userId = (req as any).userId || 1;

    let audioBuffer: Buffer;
    let mimeType: string;

    if (req.file) {
      audioBuffer = req.file.buffer;
      mimeType = req.file.mimetype || "audio/webm";
    } else if (req.body.audioBase64) {
      audioBuffer = Buffer.from(req.body.audioBase64, "base64");
      mimeType = req.body.mimeType || "audio/webm";
    } else {
      return res.status(400).json({ error: "Audio requis (file upload ou audioBase64)" });
    }

    const voice = req.body.voice || "onyx";
    const result = await voiceModeService.converse(audioBuffer, mimeType, userId, voice);
    res.json(result);
  } catch (error: any) {
    console.error("[VoiceRoute] Converse error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post("/reset", async (_req: Request, res: Response) => {
  try {
    const { voiceModeService } = await import("../../services/voiceModeService");
    voiceModeService.resetConversation();
    res.json({ success: true, message: "Conversation vocale réinitialisée" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
