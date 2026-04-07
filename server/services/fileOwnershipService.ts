import path from "path";
import fs from "fs";
import { db } from "../db";
import { mediaLibrary } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { storage } from "../storage";

export interface PathValidationResult {
  valid: boolean;
  resolvedPath: string;
  error?: string;
}

const VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov", ".avi", ".mkv"];

export async function validateVideoPathWithOwnership(
  videoPath: string,
  userId: number
): Promise<PathValidationResult> {
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  const mediaDir = path.resolve(process.cwd(), "media_library");

  const resolvedPath = path.resolve(videoPath);

  const isInUploads = resolvedPath.startsWith(uploadsDir);
  const isInMedia = resolvedPath.startsWith(mediaDir);

  if (!isInUploads && !isInMedia) {
    return { valid: false, resolvedPath, error: "Chemin vidéo non autorisé" };
  }

  if (!fs.existsSync(resolvedPath)) {
    return { valid: false, resolvedPath, error: "Fichier vidéo introuvable" };
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  if (!VIDEO_EXTENSIONS.includes(ext)) {
    return { valid: false, resolvedPath, error: "Type de fichier non autorisé" };
  }

  const filename = path.basename(resolvedPath);

  if (isInMedia) {
    const mediaFiles = await db
      .select()
      .from(mediaLibrary)
      .where(and(eq(mediaLibrary.userId, userId), eq(mediaLibrary.filename, filename)));
    if (mediaFiles.length === 0) {
      return { valid: false, resolvedPath, error: "Accès non autorisé à ce fichier" };
    }
  } else if (isInUploads) {
    const userFiles = await storage.getUlysseFiles(userId);
    const ownsFile = userFiles.some(
      (f) =>
        f.storagePath?.includes(filename) ||
        f.originalName === filename ||
        f.filename === filename
    );
    if (!ownsFile) {
      return { valid: false, resolvedPath, error: "Accès non autorisé à ce fichier" };
    }
  }

  return { valid: true, resolvedPath };
}
