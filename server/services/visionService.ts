import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

interface VisionPage {
  pageNumber: number;
  imageBase64: string;
  mimeType: string;
}

interface VisionResult {
  success: boolean;
  pages: VisionPage[];
  error?: string;
  totalPages: number;
  method: string;
}

interface VideoFrame {
  timestamp: number;
  imageBase64: string;
  mimeType: string;
}

interface VideoVisionResult {
  success: boolean;
  frames: VideoFrame[];
  error?: string;
  duration: number;
  totalFrames: number;
  method: string;
}

class VisionService {
  private tempDir: string;
  private pdftoppmAvailable: boolean | null = null;
  private ffmpegAvailable: boolean | null = null;

  constructor() {
    this.tempDir = path.join(process.cwd(), "uploads", "vision-temp");
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async pdfToImages(filePath: string, maxPages: number = 5, dpi: number = 150): Promise<VisionResult> {
    const startTime = Date.now();
    console.log(`[VisionService] Converting PDF to images: ${path.basename(filePath)} (max ${maxPages} pages, ${dpi} DPI)`);

    try {
      if (this.pdftoppmAvailable === null) {
        this.pdftoppmAvailable = await this.checkCommand("pdftoppm");
      }

      if (this.pdftoppmAvailable) {
        return await this.pdfToImagesPoppler(filePath, maxPages, dpi);
      }

      console.log(`[VisionService] pdftoppm not available — PDF vision disabled. Install poppler-utils for visual PDF analysis.`);
      return { success: false, pages: [], error: "pdftoppm not installed", totalPages: 0, method: "none" };
    } catch (err: any) {
      console.error(`[VisionService] PDF conversion failed:`, err.message);
      return { success: false, pages: [], error: err.message, totalPages: 0, method: "none" };
    } finally {
      console.log(`[VisionService] PDF conversion completed in ${Date.now() - startTime}ms`);
    }
  }

  private async pdfToImagesPoppler(filePath: string, maxPages: number, dpi: number): Promise<VisionResult> {
    const sessionId = Date.now().toString(36);
    const outputPrefix = path.join(this.tempDir, `pdf_${sessionId}`);
    const pages: VisionPage[] = [];

    try {
      const args = [
        "-jpeg",
        "-r", dpi.toString(),
        "-l", maxPages.toString(),
        filePath,
        outputPrefix,
      ];

      await execFileAsync("pdftoppm", args, { timeout: 30000 });

      const tempFiles = fs.readdirSync(this.tempDir)
        .filter(f => f.startsWith(`pdf_${sessionId}`))
        .sort();

      for (let i = 0; i < tempFiles.length; i++) {
        const imgPath = path.join(this.tempDir, tempFiles[i]);
        const imgBuffer = fs.readFileSync(imgPath);
        const base64 = imgBuffer.toString("base64");
        pages.push({
          pageNumber: i + 1,
          imageBase64: `data:image/jpeg;base64,${base64}`,
          mimeType: "image/jpeg",
        });
        fs.unlinkSync(imgPath);
      }

      console.log(`[VisionService] Poppler: ${pages.length} pages converted to images`);
      return { success: true, pages, totalPages: pages.length, method: "poppler" };
    } catch (err: any) {
      this.cleanupTempFiles(sessionId);
      throw err;
    }
  }

  async videoToFrames(filePath: string, maxFrames: number = 6, quality: number = 2): Promise<VideoVisionResult> {
    const startTime = Date.now();
    console.log(`[VisionService] Extracting frames from video: ${path.basename(filePath)} (max ${maxFrames} frames)`);

    try {
      if (this.ffmpegAvailable === null) {
        this.ffmpegAvailable = await this.checkCommand("ffmpeg");
      }

      if (!this.ffmpegAvailable) {
        return { success: false, frames: [], error: "ffmpeg not available", duration: 0, totalFrames: 0, method: "none" };
      }

      const durationResult = await execFileAsync("ffprobe", [
        "-v", "quiet",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        filePath,
      ], { timeout: 10000 });

      const duration = parseFloat(durationResult.stdout.trim()) || 30;
      const interval = Math.max(1, duration / (maxFrames + 1));
      const sessionId = Date.now().toString(36);
      const frames: VideoFrame[] = [];

      for (let i = 0; i < maxFrames; i++) {
        const timestamp = Math.min(interval * (i + 1), duration - 0.5);
        if (timestamp < 0) continue;
        const outputPath = path.join(this.tempDir, `frame_${sessionId}_${i}.jpg`);

        try {
          await execFileAsync("ffmpeg", [
            "-ss", timestamp.toFixed(2),
            "-i", filePath,
            "-vframes", "1",
            "-q:v", quality.toString(),
            "-vf", "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease",
            "-y",
            outputPath,
          ], { timeout: 15000 });

          if (fs.existsSync(outputPath)) {
            const imgBuffer = fs.readFileSync(outputPath);
            frames.push({
              timestamp: Math.round(timestamp),
              imageBase64: `data:image/jpeg;base64,${imgBuffer.toString("base64")}`,
              mimeType: "image/jpeg",
            });
            fs.unlinkSync(outputPath);
          }
        } catch (frameErr: any) {
          console.warn(`[VisionService] Frame ${i} at ${timestamp.toFixed(1)}s failed: ${frameErr.message}`);
        }
      }

      console.log(`[VisionService] FFmpeg: ${frames.length} frames extracted from ${duration.toFixed(1)}s video in ${Date.now() - startTime}ms`);
      return { success: true, frames, duration, totalFrames: frames.length, method: "ffmpeg" };
    } catch (err: any) {
      console.error(`[VisionService] Video frame extraction failed:`, err.message);
      return { success: false, frames: [], error: err.message, duration: 0, totalFrames: 0, method: "none" };
    }
  }

  private async checkCommand(cmd: string): Promise<boolean> {
    try {
      await execFileAsync("which", [cmd], { timeout: 3000 });
      console.log(`[VisionService] ${cmd} is available`);
      return true;
    } catch {
      console.log(`[VisionService] ${cmd} not found`);
      return false;
    }
  }

  private cleanupTempFiles(sessionId: string) {
    try {
      const files = fs.readdirSync(this.tempDir).filter(f => f.includes(sessionId));
      for (const file of files) {
        fs.unlinkSync(path.join(this.tempDir, file));
      }
    } catch {}
  }

  cleanup() {
    try {
      const files = fs.readdirSync(this.tempDir);
      const now = Date.now();
      for (const file of files) {
        const fullPath = path.join(this.tempDir, file);
        const stat = fs.statSync(fullPath);
        if (now - stat.mtimeMs > 3600000) {
          fs.unlinkSync(fullPath);
        }
      }
    } catch {}
  }
}

export const visionService = new VisionService();
