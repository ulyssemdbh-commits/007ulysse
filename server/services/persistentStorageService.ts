import * as fs from "fs";
import * as path from "path";

const IS_REPLIT = !!process.env.REPL_ID || !!process.env.REPLIT_CONNECTORS_HOSTNAME;
const LOCAL_STORAGE_ROOT = process.env.LOCAL_STORAGE_PATH || "/opt/ulysse/storage";

export interface StoredFile {
  objectPath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

function getMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".zip": "application/zip",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".txt": "text/plain",
    ".json": "application/json",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

class LocalStorageService {
  private root: string;

  constructor() {
    this.root = LOCAL_STORAGE_ROOT;
    if (!fs.existsSync(this.root)) {
      fs.mkdirSync(this.root, { recursive: true });
    }
  }

  private resolvePath(objectPath: string): string {
    let normalized = objectPath;
    if (normalized.startsWith("/")) normalized = normalized.slice(1);
    return path.join(this.root, normalized);
  }

  isConfigured(): boolean {
    return true;
  }

  async uploadFile(localPath: string, category: "generated" | "received", userId: number): Promise<StoredFile> {
    const fileName = path.basename(localPath);
    const objectName = `ulysse-files/${userId}/${category}/${Date.now()}-${fileName}`;
    const destPath = path.join(this.root, objectName);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(localPath, destPath);
    const stats = fs.statSync(destPath);
    return { objectPath: `/${objectName}`, originalName: fileName, mimeType: getMimeType(fileName), sizeBytes: stats.size };
  }

  async uploadBuffer(buffer: Buffer, fileName: string, category: "generated" | "received", userId: number): Promise<StoredFile> {
    const objectName = `ulysse-files/${userId}/${category}/${Date.now()}-${fileName}`;
    const destPath = path.join(this.root, objectName);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, buffer);
    return { objectPath: `/${objectName}`, originalName: fileName, mimeType: getMimeType(fileName), sizeBytes: buffer.length };
  }

  async downloadFile(objectPath: string): Promise<Buffer> {
    const filePath = this.resolvePath(objectPath);
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${objectPath}`);
    return fs.readFileSync(filePath);
  }

  async streamFile(objectPath: string, res: import("express").Response, filename: string, mimeType?: string): Promise<void> {
    const filePath = this.resolvePath(objectPath);
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${objectPath}`);
    const stats = fs.statSync(filePath);
    res.setHeader("Content-Type", mimeType || getMimeType(filename));
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", stats.size);
    const stream = fs.createReadStream(filePath);
    stream.on("error", (err) => {
      console.error("Stream error:", err);
      if (!res.headersSent) res.status(500).json({ error: "Error streaming file" });
    });
    stream.pipe(res);
  }

  async deleteFile(objectPath: string): Promise<void> {
    const filePath = this.resolvePath(objectPath);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  async fileExists(objectPath: string): Promise<boolean> {
    return fs.existsSync(this.resolvePath(objectPath));
  }

  getPublicUrl(objectPath: string): string {
    return `/api/storage/files${objectPath}`;
  }
}

class ReplitStorageService {
  private getObjectStorageClient() {
    const { objectStorageClient } = require("../replit_integrations/object_storage");
    return objectStorageClient;
  }

  private async getSetAclPolicy() {
    const { setObjectAclPolicy } = await import("../replit_integrations/object_storage/objectAcl");
    return setObjectAclPolicy;
  }

  isConfigured(): boolean {
    return !!process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  }

  private getBucketName(): string {
    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
    return bucketId;
  }

  private parseObjectPath(objectPath: string): { bucketName: string; objectName: string } {
    let p = objectPath;
    if (!p.startsWith("/")) p = `/${p}`;
    const parts = p.split("/").filter(s => s.length > 0);
    if (parts.length < 2) throw new Error(`Invalid object path: ${objectPath}`);
    return { bucketName: parts[0], objectName: parts.slice(1).join("/") };
  }

  async uploadFile(localPath: string, category: "generated" | "received", userId: number): Promise<StoredFile> {
    const client = this.getObjectStorageClient();
    const setAcl = await this.getSetAclPolicy();
    const bucketName = this.getBucketName();
    const bucket = client.bucket(bucketName);
    const fileName = path.basename(localPath);
    const objectName = `ulysse-files/${userId}/${category}/${Date.now()}-${fileName}`;
    const file = bucket.file(objectName);
    const fileBuffer = fs.readFileSync(localPath);
    const mimeType = getMimeType(fileName);
    await file.save(fileBuffer, { metadata: { contentType: mimeType } });
    await setAcl(file, { owner: String(userId), visibility: "private" });
    const stats = fs.statSync(localPath);
    return { objectPath: `/${bucketName}/${objectName}`, originalName: fileName, mimeType, sizeBytes: stats.size };
  }

  async uploadBuffer(buffer: Buffer, fileName: string, category: "generated" | "received", userId: number): Promise<StoredFile> {
    const client = this.getObjectStorageClient();
    const setAcl = await this.getSetAclPolicy();
    const bucketName = this.getBucketName();
    const bucket = client.bucket(bucketName);
    const objectName = `ulysse-files/${userId}/${category}/${Date.now()}-${fileName}`;
    const file = bucket.file(objectName);
    const mimeType = getMimeType(fileName);
    await file.save(buffer, { metadata: { contentType: mimeType } });
    await setAcl(file, { owner: String(userId), visibility: "private" });
    return { objectPath: `/${bucketName}/${objectName}`, originalName: fileName, mimeType, sizeBytes: buffer.length };
  }

  async downloadFile(objectPath: string): Promise<Buffer> {
    const client = this.getObjectStorageClient();
    const { bucketName, objectName } = this.parseObjectPath(objectPath);
    const file = client.bucket(bucketName).file(objectName);
    const [exists] = await file.exists();
    if (!exists) throw new Error(`File not found: ${objectPath}`);
    const [buffer] = await file.download();
    return buffer;
  }

  async streamFile(objectPath: string, res: import("express").Response, filename: string, mimeType?: string): Promise<void> {
    const client = this.getObjectStorageClient();
    const { bucketName, objectName } = this.parseObjectPath(objectPath);
    const file = client.bucket(bucketName).file(objectName);
    const [exists] = await file.exists();
    if (!exists) throw new Error(`File not found: ${objectPath}`);
    const [metadata] = await file.getMetadata();
    res.setHeader("Content-Type", mimeType || metadata.contentType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    if (metadata.size) res.setHeader("Content-Length", metadata.size);
    const stream = file.createReadStream();
    stream.on("error", (err: any) => { console.error("Stream error:", err); if (!res.headersSent) res.status(500).json({ error: "Error streaming file" }); });
    stream.pipe(res);
  }

  async deleteFile(objectPath: string): Promise<void> {
    const client = this.getObjectStorageClient();
    const { bucketName, objectName } = this.parseObjectPath(objectPath);
    const file = client.bucket(bucketName).file(objectName);
    const [exists] = await file.exists();
    if (exists) await file.delete();
  }

  async fileExists(objectPath: string): Promise<boolean> {
    try {
      const client = this.getObjectStorageClient();
      const { bucketName, objectName } = this.parseObjectPath(objectPath);
      const file = client.bucket(bucketName).file(objectName);
      const [exists] = await file.exists();
      return exists;
    } catch { return false; }
  }

  getPublicUrl(objectPath: string): string {
    return `/api/storage/files${objectPath}`;
  }
}

export type PersistentStorageService = LocalStorageService | ReplitStorageService;

export const persistentStorageService: PersistentStorageService = IS_REPLIT
  ? new ReplitStorageService()
  : new LocalStorageService();

console.log(`[Storage] Mode: ${IS_REPLIT ? 'Replit Sidecar' : `Local filesystem (${LOCAL_STORAGE_ROOT})`}`);
