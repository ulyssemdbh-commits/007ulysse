import { db } from "./server/db";
import { suguFiles } from "./shared/schema";
import { Storage } from "@google-cloud/storage";
import * as fs from "fs";
import * as path from "path";

const objectStorageClient = new Storage({
  apiEndpoint: process.env.REPLIT_OBJECTSTORAGE_URL || `http://${process.env.REPLIT_CONNECTORS_HOSTNAME}:8787`,
});

async function downloadFile(storagePath: string): Promise<Buffer> {
  const parts = storagePath.startsWith("/") ? storagePath.slice(1).split("/") : storagePath.split("/");
  const bucketName = parts[0];
  const objectName = parts.slice(1).join("/");
  const bucket = objectStorageClient.bucket(bucketName);
  const file = bucket.file(objectName);
  const [contents] = await file.download();
  return contents;
}

async function main() {
  const files = await db.select().from(suguFiles);
  console.log(`Found ${files.length} files to export`);
  
  const exportDir = "/tmp/sugu_files_export";
  let success = 0, failed = 0;
  const manifest: any[] = [];
  
  for (const f of files) {
    try {
      const buffer = await downloadFile(f.storagePath);
      // Save with id as prefix to avoid name collisions
      const safeFileName = `${f.id}_${f.fileName}`;
      const filePath = path.join(exportDir, safeFileName);
      fs.writeFileSync(filePath, buffer);
      manifest.push({ id: f.id, fileName: f.fileName, originalName: f.originalName, storagePath: f.storagePath, exportedAs: safeFileName, size: buffer.length });
      success++;
      if (success % 50 === 0) console.log(`  Progress: ${success}/${files.length}`);
    } catch (e: any) {
      failed++;
      console.log(`  FAILED file #${f.id} (${f.fileName}): ${e.message}`);
    }
  }
  
  fs.writeFileSync(path.join(exportDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\nDone: ${success} exported, ${failed} failed`);
  process.exit(0);
}

main();
