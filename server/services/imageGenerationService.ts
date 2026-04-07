import { generateImageBuffer } from "../replit_integrations/image/client";
import { persistentStorageService } from "./persistentStorageService";
import { broadcastToUser } from "./realtimeSync";
import { db } from "../db";
import { ulysseFiles } from "@shared/schema";

type ImageSize = "1024x1024" | "512x512" | "256x256";

interface ImageStyle {
  id: string;
  label: string;
  promptPrefix: string;
  promptSuffix: string;
}

const IMAGE_STYLES: Record<string, ImageStyle> = {
  realistic: {
    id: "realistic",
    label: "Photoréaliste",
    promptPrefix: "Photorealistic, ultra-detailed photograph,",
    promptSuffix: "high resolution, natural lighting, professional photography, 8K quality"
  },
  illustration: {
    id: "illustration",
    label: "Illustration",
    promptPrefix: "Digital illustration, stylized artwork,",
    promptSuffix: "clean lines, vibrant colors, professional digital art, detailed illustration"
  },
  technical: {
    id: "technical",
    label: "Schéma technique",
    promptPrefix: "Technical blueprint diagram, isometric view,",
    promptSuffix: "clean technical drawing, labeled components, dark background with bright lines, precise engineering style"
  },
  watercolor: {
    id: "watercolor",
    label: "Aquarelle",
    promptPrefix: "Watercolor painting style,",
    promptSuffix: "soft washes, flowing colors, paper texture, artistic brushstrokes, elegant watercolor rendering"
  },
  cartoon: {
    id: "cartoon",
    label: "Cartoon",
    promptPrefix: "Cartoon style illustration, fun and colorful,",
    promptSuffix: "bold outlines, expressive characters, playful design, vibrant cartoon art"
  },
  minimalist: {
    id: "minimalist",
    label: "Minimaliste",
    promptPrefix: "Minimalist design,",
    promptSuffix: "clean composition, limited color palette, negative space, elegant simplicity, modern aesthetic"
  },
  cinematic: {
    id: "cinematic",
    label: "Cinématique",
    promptPrefix: "Cinematic shot, movie scene,",
    promptSuffix: "dramatic lighting, film grain, wide angle, depth of field, Hollywood production quality"
  },
  logo: {
    id: "logo",
    label: "Logo / Icône",
    promptPrefix: "Professional logo design, icon,",
    promptSuffix: "vector-style, clean shape, scalable design, centered composition, white or transparent background"
  },
  infographic: {
    id: "infographic",
    label: "Infographie",
    promptPrefix: "Infographic design, data visualization,",
    promptSuffix: "clear hierarchy, modern layout, professional color scheme, easy to read, clean typography"
  },
  portrait: {
    id: "portrait",
    label: "Portrait",
    promptPrefix: "Professional portrait,",
    promptSuffix: "studio lighting, sharp focus on face, bokeh background, high-end portrait photography"
  },
  "3d": {
    id: "3d",
    label: "3D Render",
    promptPrefix: "3D rendered scene, high quality CGI,",
    promptSuffix: "ray tracing, global illumination, photorealistic materials, octane render quality"
  },
  pixel: {
    id: "pixel",
    label: "Pixel Art",
    promptPrefix: "Pixel art style,",
    promptSuffix: "retro 16-bit aesthetic, crisp pixels, limited palette, nostalgic video game art"
  }
};

interface GenerationOptions {
  prompt: string;
  style?: string;
  size?: string;
  enhancePrompt?: boolean;
  userId?: number;
  retryOnFail?: boolean;
  variations?: number;
}

interface GenerationResult {
  success: boolean;
  url?: string;
  fileName?: string;
  storagePath?: string;
  sizeBytes?: number;
  enhancedPrompt?: string;
  style?: string;
  generationTimeMs?: number;
  error?: string;
}

const generationHistory: Array<{
  timestamp: number;
  prompt: string;
  enhancedPrompt: string;
  style: string;
  size: string;
  success: boolean;
  url?: string;
  error?: string;
  generationTimeMs: number;
  userId?: number;
}> = [];

const MAX_HISTORY = 100;

function enhancePrompt(rawPrompt: string, style?: string): string {
  let enhanced = rawPrompt.trim();

  const selectedStyle = style && IMAGE_STYLES[style] ? IMAGE_STYLES[style] : null;

  if (selectedStyle) {
    enhanced = `${selectedStyle.promptPrefix} ${enhanced}. ${selectedStyle.promptSuffix}`;
  }

  const qualityKeywords = ["high quality", "detailed", "professional", "4k", "8k", "hd", "ultra"];
  const hasQuality = qualityKeywords.some(k => enhanced.toLowerCase().includes(k));
  if (!hasQuality && !selectedStyle) {
    enhanced += ". High quality, detailed, professional result";
  }

  const negativeTerms = [
    "no watermark", "no text overlay", "no blurry elements",
    "no distorted faces", "no extra limbs"
  ];
  const hasNegative = enhanced.toLowerCase().includes("no watermark") || enhanced.toLowerCase().includes("without");
  if (!hasNegative) {
    enhanced += `. ${negativeTerms.join(", ")}`;
  }

  if (enhanced.length > 3800) {
    enhanced = enhanced.substring(0, 3800);
  }

  return enhanced;
}

function detectStyleFromPrompt(prompt: string): string | null {
  const lower = prompt.toLowerCase();

  const patterns: Array<{ keywords: string[]; style: string }> = [
    { keywords: ["schéma", "blueprint", "diagramme", "technique", "isométrique", "plan"], style: "technical" },
    { keywords: ["logo", "icône", "icon", "emblème", "badge"], style: "logo" },
    { keywords: ["portrait", "visage", "face", "headshot"], style: "portrait" },
    { keywords: ["aquarelle", "watercolor", "peinture"], style: "watercolor" },
    { keywords: ["cartoon", "dessin animé", "bd", "comic"], style: "cartoon" },
    { keywords: ["pixel", "retro", "8-bit", "16-bit", "jeu vidéo"], style: "pixel" },
    { keywords: ["3d", "render", "cgi", "blender", "octane"], style: "3d" },
    { keywords: ["cinéma", "film", "movie", "cinematic", "scène"], style: "cinematic" },
    { keywords: ["infographie", "infographic", "données", "statistiques", "graphique"], style: "infographic" },
    { keywords: ["photo", "réaliste", "realistic", "photographe"], style: "realistic" },
    { keywords: ["minimaliste", "minimal", "simple", "épuré", "clean"], style: "minimalist" },
    { keywords: ["illustration", "illustré", "dessin", "artwork"], style: "illustration" },
  ];

  for (const { keywords, style } of patterns) {
    if (keywords.some(k => lower.includes(k))) {
      return style;
    }
  }

  return null;
}

async function generateWithRetry(
  prompt: string,
  size: ImageSize,
  maxRetries: number = 2
): Promise<{ buffer: Buffer; attempts: number; finalPrompt: string }> {
  let lastError: Error | null = null;
  let currentPrompt = prompt;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[ImageGen] Attempt ${attempt}/${maxRetries}, prompt length: ${currentPrompt.length}`);
      const buffer = await generateImageBuffer(currentPrompt, size);
      return { buffer, attempts: attempt, finalPrompt: currentPrompt };
    } catch (err: any) {
      lastError = err;
      console.warn(`[ImageGen] Attempt ${attempt} failed: ${err.message}`);

      if (attempt < maxRetries) {
        if (currentPrompt.length > 500) {
          currentPrompt = currentPrompt.substring(0, 500);
          console.log(`[ImageGen] Truncated prompt to ${currentPrompt.length} chars for retry`);
        }

        if (err.message?.includes("content_policy")) {
          currentPrompt = currentPrompt
            .replace(/\b(blood|gore|violence|nude|naked|weapon|gun|kill)\b/gi, "")
            .trim();
          console.log(`[ImageGen] Cleaned prompt for content policy`);
        }

        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }

  throw lastError || new Error("Image generation failed after retries");
}

export async function generateImage(options: GenerationOptions): Promise<GenerationResult> {
  const startTime = Date.now();

  try {
    const validSizes: ImageSize[] = ["1024x1024", "512x512", "256x256"];
    const size: ImageSize = validSizes.includes(options.size as ImageSize)
      ? (options.size as ImageSize)
      : "1024x1024";

    const detectedStyle = options.style || detectStyleFromPrompt(options.prompt);
    const shouldEnhance = options.enhancePrompt !== false;
    const finalPrompt = shouldEnhance
      ? enhancePrompt(options.prompt, detectedStyle || undefined)
      : options.prompt;

    console.log(`[ImageGen] Style: ${detectedStyle || "auto"}, size: ${size}, enhance: ${shouldEnhance}`);
    console.log(`[ImageGen] Original: "${options.prompt.substring(0, 100)}..."`);
    if (shouldEnhance) {
      console.log(`[ImageGen] Enhanced: "${finalPrompt.substring(0, 120)}..."`);
    }

    const maxRetries = options.retryOnFail !== false ? 2 : 1;
    const { buffer: imageBuffer, attempts, finalPrompt: usedPrompt } = await generateWithRetry(finalPrompt, size, maxRetries);

    const generationTimeMs = Date.now() - startTime;
    console.log(`[ImageGen] Generated in ${generationTimeMs}ms (${attempts} attempt${attempts > 1 ? 's' : ''}), ${imageBuffer.length} bytes`);

    let url: string | undefined;
    let fileName: string | undefined;
    let storagePath: string | undefined;
    const userId = options.userId || 1;

    if (persistentStorageService.isConfigured()) {
      const styleSuffix = detectedStyle ? `_${detectedStyle}` : "";
      fileName = `gen${styleSuffix}_${Date.now()}.png`;
      const uploadResult = await persistentStorageService.uploadBuffer(imageBuffer, fileName, 'generated', userId);
      storagePath = uploadResult.objectPath;
      url = persistentStorageService.getPublicUrl(uploadResult.objectPath);

      try {
        await db.insert(ulysseFiles).values({
          userId,
          filename: fileName,
          originalName: fileName,
          mimeType: 'image/png',
          sizeBytes: imageBuffer.length,
          category: 'generated',
          storagePath: uploadResult.objectPath,
          description: `[${detectedStyle || 'auto'}] ${options.prompt.substring(0, 300)}`,
          generatedBy: userId === 1 ? 'ulysse' : userId >= 5 ? 'alfred' : 'iris'
        });
      } catch (dbErr) {
        console.warn(`[ImageGen] DB save failed (non-blocking):`, dbErr);
      }

      console.log(`[ImageGen] Saved: ${fileName} → ${url?.substring(0, 80)}...`);
    }

    if (userId) {
      broadcastToUser(userId, {
        type: 'image.generated',
        userId,
        data: {
          prompt: options.prompt,
          enhancedPrompt: usedPrompt !== options.prompt ? usedPrompt : undefined,
          style: detectedStyle,
          fileName,
          url,
          storagePath,
          sizeBytes: imageBuffer.length,
          generationTimeMs
        },
        timestamp: Date.now()
      });
    }

    generationHistory.push({
      timestamp: Date.now(),
      prompt: options.prompt,
      enhancedPrompt: usedPrompt,
      style: detectedStyle || "auto",
      size,
      success: true,
      url,
      generationTimeMs,
      userId
    });
    if (generationHistory.length > MAX_HISTORY) generationHistory.shift();

    return {
      success: true,
      url,
      fileName,
      storagePath,
      sizeBytes: imageBuffer.length,
      enhancedPrompt: usedPrompt !== options.prompt ? usedPrompt : undefined,
      style: detectedStyle || "auto",
      generationTimeMs
    };
  } catch (err: any) {
    const generationTimeMs = Date.now() - startTime;
    console.error(`[ImageGen] Failed after ${generationTimeMs}ms:`, err.message);

    generationHistory.push({
      timestamp: Date.now(),
      prompt: options.prompt,
      enhancedPrompt: options.prompt,
      style: options.style || "auto",
      size: options.size || "1024x1024",
      success: false,
      error: err.message,
      generationTimeMs,
      userId: options.userId
    });
    if (generationHistory.length > MAX_HISTORY) generationHistory.shift();

    return {
      success: false,
      error: err.message,
      generationTimeMs
    };
  }
}

export function getAvailableStyles(): Array<{ id: string; label: string; description: string }> {
  return Object.values(IMAGE_STYLES).map(s => ({
    id: s.id,
    label: s.label,
    description: `${s.promptPrefix.substring(0, 60)}...`
  }));
}

export function getGenerationStats(): {
  totalGenerated: number;
  successRate: number;
  avgGenerationTimeMs: number;
  recentGenerations: typeof generationHistory;
  styleDistribution: Record<string, number>;
} {
  const successful = generationHistory.filter(h => h.success);
  const avgTime = successful.length > 0
    ? Math.round(successful.reduce((s, h) => s + h.generationTimeMs, 0) / successful.length)
    : 0;

  const styleDistribution: Record<string, number> = {};
  for (const h of generationHistory) {
    styleDistribution[h.style] = (styleDistribution[h.style] || 0) + 1;
  }

  return {
    totalGenerated: generationHistory.length,
    successRate: generationHistory.length > 0
      ? Math.round((successful.length / generationHistory.length) * 100)
      : 0,
    avgGenerationTimeMs: avgTime,
    recentGenerations: generationHistory.slice(-10),
    styleDistribution
  };
}

export const imageGenerationService = {
  generate: generateImage,
  getStyles: getAvailableStyles,
  getStats: getGenerationStats,
  enhancePrompt,
  detectStyle: detectStyleFromPrompt,
  IMAGE_STYLES
};
