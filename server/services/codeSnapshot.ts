import { db } from "../db";
import { ulysseCodeSnapshots, type UlysseCodeSnapshot, type InsertUlysseCodeSnapshot } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

const RATE_LIMIT_MS = 60 * 60 * 1000; // 1 hour between snapshots
const MAX_SNAPSHOTS = 5; // Keep only last 5 snapshots
const lastSnapshotTime = new Map<number, number>();

const EXCLUDED_DIRS = [
  "node_modules",
  ".git",
  "dist",
  ".replit",
  ".upm",
  ".cache",
  ".config",
  "uploads",
  "attached_assets",
  ".npm",
  "coverage",
  ".turbo",
  ".vscode",
  ".idea",
];

const EXCLUDED_EXTENSIONS = [
  ".log",
  ".lock",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp3",
  ".mp4",
  ".webm",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".rar",
  ".7z",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".dat",
  ".db",
  ".sqlite",
  ".sqlite3",
];

const EXCLUDED_FILES = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".env.test",
  ".npmrc",
  ".netrc",
  "id_rsa",
  "id_ed25519",
  ".htpasswd",
  "secrets.json",
  "credentials.json",
  ".secrets",
];

const MAX_FILE_SIZE = 500 * 1024;

const KEY_FILES = [
  "server/replit_integrations/chat/routes.ts",
  "server/services/memory.ts",
  "server/routes.ts",
  "shared/schema/index.ts",
  "client/src/pages/Dashboard.tsx",
  "client/src/hooks/use-voice.ts",
  "server/services/diagnostics.ts",
  "replit.md",
];

interface FileInfo {
  path: string;
  size: number;
  type: string;
}

class CodeSnapshotService {
  async checkRateLimit(ownerId: number): Promise<{ allowed: boolean; waitMs?: number }> {
    const lastTime = lastSnapshotTime.get(ownerId);
    if (!lastTime) return { allowed: true };
    
    const elapsed = Date.now() - lastTime;
    if (elapsed < RATE_LIMIT_MS) {
      return { allowed: false, waitMs: RATE_LIMIT_MS - elapsed };
    }
    return { allowed: true };
  }

  private shouldIncludeFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    if (EXCLUDED_EXTENSIONS.includes(ext)) return false;
    
    const fileName = path.basename(filePath);
    if (EXCLUDED_FILES.includes(fileName)) return false;
    if (fileName.startsWith(".env")) return false;
    
    const parts = filePath.split(path.sep);
    for (const dir of EXCLUDED_DIRS) {
      if (parts.includes(dir)) return false;
    }
    
    return true;
  }

  private isTextFile(content: Buffer): boolean {
    const sampleSize = Math.min(8000, content.length);
    let nullCount = 0;
    for (let i = 0; i < sampleSize; i++) {
      if (content[i] === 0) nullCount++;
    }
    return nullCount < sampleSize * 0.1;
  }

  private async scanDirectory(dirPath: string, basePath: string = ""): Promise<FileInfo[]> {
    const files: FileInfo[] = [];
    
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.join(basePath, entry.name);
        
        if (entry.isDirectory()) {
          if (!EXCLUDED_DIRS.includes(entry.name)) {
            const subFiles = await this.scanDirectory(fullPath, relativePath);
            files.push(...subFiles);
          }
        } else if (entry.isFile()) {
          if (this.shouldIncludeFile(relativePath)) {
            try {
              const stats = fs.statSync(fullPath);
              if (stats.size <= MAX_FILE_SIZE) {
                files.push({
                  path: relativePath,
                  size: stats.size,
                  type: path.extname(entry.name).slice(1) || "unknown",
                });
              }
            } catch (err) {
              // Skip files we can't stat
            }
          }
        }
      }
    } catch (err) {
      console.error(`Error scanning directory: ${dirPath}`, err);
    }
    
    return files;
  }

  private async readFileContent(filePath: string): Promise<string | null> {
    try {
      const buffer = fs.readFileSync(filePath);
      
      if (!this.isTextFile(buffer)) {
        return null;
      }
      
      const content = buffer.toString("utf-8");
      
      if (content.includes("\0")) {
        return null;
      }
      
      return content;
    } catch (err) {
      return null;
    }
  }

  async captureCodeSnapshot(
    ownerId: number,
    ipAddress?: string,
    userAgent?: string
  ): Promise<UlysseCodeSnapshot> {
    const rateCheck = await this.checkRateLimit(ownerId);
    if (!rateCheck.allowed) {
      throw new Error(`Rate limited. Wait ${Math.ceil((rateCheck.waitMs || 0) / 60000)} minutes.`);
    }

    const rootDir = process.cwd();
    const scannedFiles = await this.scanDirectory(rootDir);
    
    const codeContent: Record<string, string> = {};
    const includedFiles: FileInfo[] = [];
    let totalSize = 0;
    const keyComponents: string[] = [];
    
    for (const file of scannedFiles) {
      const fullPath = path.join(rootDir, file.path);
      const content = await this.readFileContent(fullPath);
      
      if (content) {
        codeContent[file.path] = content;
        includedFiles.push(file);
        totalSize += file.size;
        
        if (KEY_FILES.some(kf => file.path.includes(kf))) {
          keyComponents.push(file.path);
        }
      }
    }

    const structureMap = includedFiles.reduce((acc, file) => {
      const dir = path.dirname(file.path);
      if (!acc[dir]) acc[dir] = [];
      acc[dir].push({ name: path.basename(file.path), size: file.size, type: file.type });
      return acc;
    }, {} as Record<string, Array<{ name: string; size: number; type: string }>>);

    const version = `v${Date.now()}`;
    const encodedContent = Buffer.from(JSON.stringify(codeContent)).toString("base64");

    await this.cleanupOldSnapshots(ownerId);

    const [snapshot] = await db
      .insert(ulysseCodeSnapshots)
      .values({
        ownerId,
        version,
        summary: `Code snapshot with ${includedFiles.length} files (${Math.round(totalSize / 1024)}KB)`,
        filesCount: includedFiles.length,
        totalSize,
        codeContent: encodedContent,
        structureMap,
        keyComponents,
        ipAddress,
        userAgent,
      })
      .returning();

    lastSnapshotTime.set(ownerId, Date.now());

    return snapshot;
  }

  private async cleanupOldSnapshots(ownerId: number): Promise<void> {
    const snapshots = await db
      .select({ id: ulysseCodeSnapshots.id })
      .from(ulysseCodeSnapshots)
      .where(eq(ulysseCodeSnapshots.ownerId, ownerId))
      .orderBy(desc(ulysseCodeSnapshots.createdAt));

    if (snapshots.length >= MAX_SNAPSHOTS) {
      const toDelete = snapshots.slice(MAX_SNAPSHOTS - 1);
      for (const snap of toDelete) {
        await db.delete(ulysseCodeSnapshots).where(eq(ulysseCodeSnapshots.id, snap.id));
      }
    }
  }

  async getLatestSnapshot(ownerId: number): Promise<UlysseCodeSnapshot | null> {
    const [snapshot] = await db
      .select()
      .from(ulysseCodeSnapshots)
      .where(eq(ulysseCodeSnapshots.ownerId, ownerId))
      .orderBy(desc(ulysseCodeSnapshots.createdAt))
      .limit(1);

    return snapshot || null;
  }

  async getSnapshotSummary(ownerId: number): Promise<{
    hasSnapshot: boolean;
    version?: string;
    filesCount?: number;
    totalSize?: number;
    keyComponents?: string[];
    createdAt?: Date;
  }> {
    const snapshot = await this.getLatestSnapshot(ownerId);
    
    if (!snapshot) {
      return { hasSnapshot: false };
    }

    return {
      hasSnapshot: true,
      version: snapshot.version,
      filesCount: snapshot.filesCount,
      totalSize: snapshot.totalSize,
      keyComponents: snapshot.keyComponents || [],
      createdAt: snapshot.createdAt || undefined,
    };
  }

  async getCodeContext(ownerId: number, specificFiles?: string[]): Promise<string | null> {
    const snapshot = await this.getLatestSnapshot(ownerId);
    if (!snapshot) return null;

    try {
      const decoded = Buffer.from(snapshot.codeContent, "base64").toString("utf-8");
      const codeContent = JSON.parse(decoded) as Record<string, string>;

      if (specificFiles && specificFiles.length > 0) {
        const filtered: Record<string, string> = {};
        for (const file of specificFiles) {
          const found = Object.keys(codeContent).find(k => k.includes(file));
          if (found) {
            filtered[found] = codeContent[found];
          }
        }
        return JSON.stringify(filtered, null, 2);
      }

      const keyFileContent: Record<string, string> = {};
      for (const keyFile of snapshot.keyComponents || []) {
        if (codeContent[keyFile]) {
          keyFileContent[keyFile] = codeContent[keyFile];
        }
      }
      
      return JSON.stringify(keyFileContent, null, 2);
    } catch (err) {
      console.error("Error decoding code content:", err);
      return null;
    }
  }

  async getAllSnapshots(ownerId: number): Promise<Array<{
    id: number;
    version: string;
    summary: string | null;
    filesCount: number;
    analysisNotes: string | null;
    createdAt: Date | null;
  }>> {
    return db
      .select({
        id: ulysseCodeSnapshots.id,
        version: ulysseCodeSnapshots.version,
        summary: ulysseCodeSnapshots.summary,
        filesCount: ulysseCodeSnapshots.filesCount,
        analysisNotes: ulysseCodeSnapshots.analysisNotes,
        createdAt: ulysseCodeSnapshots.createdAt,
      })
      .from(ulysseCodeSnapshots)
      .where(eq(ulysseCodeSnapshots.ownerId, ownerId))
      .orderBy(desc(ulysseCodeSnapshots.createdAt));
  }

  async updateAnalysisNotes(
    ownerId: number,
    snapshotId: number,
    notes: string
  ): Promise<boolean> {
    const [updated] = await db
      .update(ulysseCodeSnapshots)
      .set({ 
        analysisNotes: notes,
        lastAnalyzedAt: new Date()
      })
      .where(and(
        eq(ulysseCodeSnapshots.id, snapshotId),
        eq(ulysseCodeSnapshots.ownerId, ownerId)
      ))
      .returning({ id: ulysseCodeSnapshots.id });

    return !!updated;
  }

  async getKeyFilesContext(ownerId: number): Promise<Record<string, string>> {
    const snapshot = await this.getLatestSnapshot(ownerId);
    if (!snapshot) return {};

    try {
      const decoded = Buffer.from(snapshot.codeContent, "base64").toString("utf-8");
      const codeContent = JSON.parse(decoded) as Record<string, string>;

      const keyFileContent: Record<string, string> = {};
      for (const keyFile of snapshot.keyComponents || []) {
        if (codeContent[keyFile]) {
          keyFileContent[keyFile] = codeContent[keyFile];
        }
      }
      
      return keyFileContent;
    } catch (err) {
      console.error("Error decoding code content:", err);
      return {};
    }
  }

  async getSnapshotWithNotes(ownerId: number, snapshotId?: number): Promise<{
    id: number;
    version: string;
    summary: string | null;
    analysisNotes: string | null;
    keyComponents: string[] | null;
    filesCount: number;
    totalSize: number;
    lastAnalyzedAt: Date | null;
    createdAt: Date | null;
  } | null> {
    const query = db
      .select({
        id: ulysseCodeSnapshots.id,
        version: ulysseCodeSnapshots.version,
        summary: ulysseCodeSnapshots.summary,
        analysisNotes: ulysseCodeSnapshots.analysisNotes,
        keyComponents: ulysseCodeSnapshots.keyComponents,
        filesCount: ulysseCodeSnapshots.filesCount,
        totalSize: ulysseCodeSnapshots.totalSize,
        lastAnalyzedAt: ulysseCodeSnapshots.lastAnalyzedAt,
        createdAt: ulysseCodeSnapshots.createdAt,
      })
      .from(ulysseCodeSnapshots)
      .where(eq(ulysseCodeSnapshots.ownerId, ownerId));

    if (snapshotId) {
      const [result] = await query.where(eq(ulysseCodeSnapshots.id, snapshotId)).limit(1);
      return result || null;
    }

    const [result] = await query.orderBy(desc(ulysseCodeSnapshots.createdAt)).limit(1);
    return result || null;
  }
}

export const codeSnapshotService = new CodeSnapshotService();
