import type { Express, Request, Response } from "express";
import { openai, editImages } from "./client";
import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { editImageWithPreset, PRESET_DESCRIPTIONS, type ImageEditPreset } from "../../services/imageEdit";
import { imageGenerationService } from "../../services/imageGenerationService";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

export function registerImageRoutes(app: Express): void {
  app.post("/api/generate-image", async (req: Request, res: Response) => {
    try {
      const { prompt, size = "1024x1024" } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const response = await openai.images.generate({
        model: "gpt-image-1",
        prompt,
        n: 1,
        size: size as "1024x1024" | "512x512" | "256x256",
      });

      const imageData = response.data?.[0];
      res.json({
        url: imageData?.url,
        b64_json: imageData?.b64_json,
      });
    } catch (error) {
      console.error("Error generating image:", error);
      res.status(500).json({ error: "Failed to generate image" });
    }
  });

  app.post("/api/edit-image", async (req: Request, res: Response) => {
    let tempInputPath: string | null = null;
    
    try {
      const { imageBase64, prompt } = req.body;

      if (!prompt || typeof prompt !== "string" || prompt.length > 2000) {
        return res.status(400).json({ error: "Valid prompt is required (max 2000 chars)" });
      }

      if (!imageBase64 || typeof imageBase64 !== "string") {
        return res.status(400).json({ error: "Image data (base64) is required" });
      }
      
      // Validate base64 format
      const base64Match = imageBase64.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!base64Match) {
        return res.status(400).json({ error: "Invalid image format. Use PNG, JPEG, or WebP." });
      }
      
      // Ensure uploads directory exists
      if (!fs.existsSync(UPLOADS_DIR)) {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      }
      
      // Create temp input file with random suffix for security
      const randomSuffix = Math.random().toString(36).substring(2, 10);
      tempInputPath = path.join(UPLOADS_DIR, `temp_input_${Date.now()}_${randomSuffix}.png`);
      const base64Data = base64Match[2];
      fs.writeFileSync(tempInputPath, Buffer.from(base64Data, "base64"));

      console.log(`[IMAGE-EDIT] Editing image with prompt: "${prompt.substring(0, 100)}..."`);
      
      const outputFileName = `edited_${Date.now()}_${randomSuffix}.png`;
      const outputPath = path.join(UPLOADS_DIR, outputFileName);
      
      const editedBuffer = await editImages([tempInputPath], prompt, outputPath);
      
      const editedBase64 = editedBuffer.toString("base64");
      const dataUrl = `data:image/png;base64,${editedBase64}`;
      
      console.log(`[IMAGE-EDIT] Image edited successfully, saved to ${outputPath}`);
      
      res.json({
        success: true,
        b64_json: editedBase64,
        dataUrl,
        savedPath: outputPath,
        fileName: outputFileName
      });
    } catch (error) {
      console.error("Error editing image:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: `Failed to edit image: ${errorMessage}` });
    } finally {
      // Clean up temp input file
      if (tempInputPath && fs.existsSync(tempInputPath)) {
        try {
          fs.unlinkSync(tempInputPath);
          console.log(`[IMAGE-EDIT] Cleaned up temp file: ${tempInputPath}`);
        } catch (cleanupErr) {
          console.error(`[IMAGE-EDIT] Failed to cleanup temp file: ${tempInputPath}`, cleanupErr);
        }
      }
    }
  });

  app.get("/api/image/edit/presets", (_req: Request, res: Response) => {
    res.json({
      presets: Object.entries(PRESET_DESCRIPTIONS).map(([id, description]) => ({
        id,
        description
      }))
    });
  });

  app.get("/api/image/generate/styles", (_req: Request, res: Response) => {
    res.json({ styles: imageGenerationService.getStyles() });
  });

  app.get("/api/image/generate/stats", (_req: Request, res: Response) => {
    res.json(imageGenerationService.getStats());
  });

  app.post("/api/image/generate/enhanced", async (req: Request, res: Response) => {
    try {
      const { prompt, style, size, enhance } = req.body;

      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const userId = (req as any).userId || 1;
      const result = await imageGenerationService.generate({
        prompt,
        style,
        size,
        enhancePrompt: enhance !== false,
        userId,
        retryOnFail: true
      });

      if (!result.success) {
        return res.status(500).json({ error: result.error, generationTimeMs: result.generationTimeMs });
      }

      res.json(result);
    } catch (error) {
      console.error("[ImageGen API] Error:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: `Failed to generate image: ${errorMessage}` });
    }
  });

  app.post("/api/image/edit/basic", async (req: Request, res: Response) => {
    try {
      const { imageBase64, preset, customOptions } = req.body;

      if (!imageBase64 || typeof imageBase64 !== "string") {
        return res.status(400).json({ error: "Image data (base64) is required" });
      }

      if (!preset || typeof preset !== "string") {
        return res.status(400).json({ error: "Preset is required" });
      }

      const validPresets = Object.keys(PRESET_DESCRIPTIONS);
      if (!validPresets.includes(preset)) {
        return res.status(400).json({ 
          error: `Invalid preset. Valid options: ${validPresets.join(", ")}` 
        });
      }

      console.log(`[IMAGE-EDIT-BASIC] Applying preset: ${preset}`);

      const result = await editImageWithPreset(imageBase64, {
        preset: preset as ImageEditPreset,
        customOptions
      });

      res.json(result);
    } catch (error) {
      console.error("Error in basic image edit:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: `Failed to edit image: ${errorMessage}` });
    }
  });
}

