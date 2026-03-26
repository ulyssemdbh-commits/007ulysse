import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

export type ImageEditPreset = 
  | "profile_square"
  | "profile_circle" 
  | "blur_background"
  | "enhance_brightness"
  | "enhance_contrast"
  | "grayscale"
  | "resize_small"
  | "resize_medium";

interface EditOptions {
  preset: ImageEditPreset;
  customOptions?: {
    brightness?: number;
    contrast?: number;
    blur?: number;
    width?: number;
    height?: number;
  };
}

interface EditResult {
  success: boolean;
  dataUrl: string;
  fileName: string;
  savedPath: string;
}

function ensureUploadsDir(): void {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

function extractBase64Data(imageBase64: string): { format: string; data: Buffer } | null {
  const match = imageBase64.match(/^data:image\/(png|jpeg|jpg|webp|heic);base64,(.+)$/);
  if (!match) return null;
  return {
    format: match[1],
    data: Buffer.from(match[2], "base64")
  };
}

export async function editImageWithPreset(
  imageBase64: string,
  options: EditOptions
): Promise<EditResult> {
  ensureUploadsDir();
  
  const extracted = extractBase64Data(imageBase64);
  if (!extracted) {
    throw new Error("Invalid image format. Use PNG, JPEG, or WebP.");
  }

  let pipeline = sharp(extracted.data);
  const metadata = await pipeline.metadata();
  const originalWidth = metadata.width || 800;
  const originalHeight = metadata.height || 800;

  switch (options.preset) {
    case "profile_square": {
      const size = Math.min(originalWidth, originalHeight);
      const left = Math.floor((originalWidth - size) / 2);
      const top = Math.floor((originalHeight - size) / 2);
      pipeline = pipeline
        .extract({ left, top, width: size, height: size })
        .resize(512, 512)
        .modulate({ brightness: 1.05, saturation: 1.1 })
        .sharpen();
      break;
    }

    case "profile_circle": {
      const size = Math.min(originalWidth, originalHeight);
      const left = Math.floor((originalWidth - size) / 2);
      const top = Math.floor((originalHeight - size) / 2);
      pipeline = pipeline
        .extract({ left, top, width: size, height: size })
        .resize(512, 512)
        .modulate({ brightness: 1.05, saturation: 1.1 })
        .sharpen();
      const circleMask = Buffer.from(
        `<svg width="512" height="512"><circle cx="256" cy="256" r="256" fill="white"/></svg>`
      );
      pipeline = pipeline.composite([{ input: circleMask, blend: "dest-in" }]);
      break;
    }

    case "blur_background": {
      const blurAmount = options.customOptions?.blur || 15;
      const blurredBuffer = await sharp(extracted.data)
        .blur(blurAmount)
        .toBuffer();
      const centerWidth = Math.floor(originalWidth * 0.6);
      const centerHeight = Math.floor(originalHeight * 0.7);
      const centerLeft = Math.floor((originalWidth - centerWidth) / 2);
      const centerTop = Math.floor((originalHeight - centerHeight) / 4);
      const centerCrop = await sharp(extracted.data)
        .extract({ 
          left: centerLeft, 
          top: centerTop, 
          width: centerWidth, 
          height: centerHeight 
        })
        .toBuffer();
      pipeline = sharp(blurredBuffer)
        .composite([{ 
          input: centerCrop, 
          left: centerLeft, 
          top: centerTop,
          blend: "over"
        }]);
      break;
    }

    case "enhance_brightness": {
      const brightness = options.customOptions?.brightness || 1.2;
      pipeline = pipeline
        .modulate({ brightness })
        .sharpen();
      break;
    }

    case "enhance_contrast": {
      const contrast = options.customOptions?.contrast || 1.3;
      pipeline = pipeline
        .linear(contrast, -(128 * (contrast - 1)))
        .sharpen();
      break;
    }

    case "grayscale": {
      pipeline = pipeline
        .grayscale()
        .modulate({ brightness: 1.1 })
        .sharpen();
      break;
    }

    case "resize_small": {
      const width = options.customOptions?.width || 480;
      pipeline = pipeline.resize(width, null, { fit: "inside" });
      break;
    }

    case "resize_medium": {
      const width = options.customOptions?.width || 800;
      pipeline = pipeline.resize(width, null, { fit: "inside" });
      break;
    }

    default:
      throw new Error(`Unknown preset: ${options.preset}`);
  }

  const outputBuffer = await pipeline.png().toBuffer();
  
  const randomSuffix = Math.random().toString(36).substring(2, 10);
  const fileName = `edited_${options.preset}_${Date.now()}_${randomSuffix}.png`;
  const savedPath = path.join(UPLOADS_DIR, fileName);
  
  fs.writeFileSync(savedPath, outputBuffer);
  
  const base64Output = outputBuffer.toString("base64");
  const dataUrl = `data:image/png;base64,${base64Output}`;

  console.log(`[IMAGE-EDIT] Preset "${options.preset}" applied, saved to ${savedPath}`);

  return {
    success: true,
    dataUrl,
    fileName,
    savedPath
  };
}

export const PRESET_DESCRIPTIONS: Record<ImageEditPreset, string> = {
  profile_square: "Photo de profil carrée (512x512) avec amélioration couleurs",
  profile_circle: "Photo de profil ronde avec fond transparent",
  blur_background: "Floute l'arrière-plan pour mettre le sujet en valeur",
  enhance_brightness: "Améliore la luminosité de l'image",
  enhance_contrast: "Augmente le contraste pour plus de punch",
  grayscale: "Convertit en noir et blanc élégant",
  resize_small: "Redimensionne en petite taille (480px)",
  resize_medium: "Redimensionne en taille moyenne (800px)"
};
