import { db } from "../db";
import { sql } from "drizzle-orm";
import { createHash } from "crypto";

export interface DbFile {
  id: number;
  project_id: string;
  branch: string;
  file_path: string;
  content: string;
  sha: string;
  size: number;
  encoding: string;
  updated_by?: string;
  created_at: string;
  updated_at: string;
}

export interface FileTreeItem {
  path: string;
  type: "file" | "dir";
  size?: number;
  sha?: string;
}

function computeSha(content: string): string {
  return createHash("sha1").update(content).digest("hex");
}

export const devmaxFileStorage = {
  async listFiles(projectId: string, branch: string = "main", dirPath?: string): Promise<FileTreeItem[]> {
    let result;
    if (dirPath) {
      result = await db.execute(sql`
        SELECT file_path, size, sha FROM devmax_files 
        WHERE project_id = ${projectId} AND branch = ${branch}
        AND file_path LIKE ${dirPath + "/%"}
        ORDER BY file_path
      `);
    } else {
      result = await db.execute(sql`
        SELECT file_path, size, sha FROM devmax_files 
        WHERE project_id = ${projectId} AND branch = ${branch}
        ORDER BY file_path
      `);
    }

    const rows = (result as any).rows || result;
    const items: FileTreeItem[] = [];
    const dirs = new Set<string>();

    for (const row of rows) {
      const parts = row.file_path.split("/");
      const prefix = dirPath ? dirPath.split("/").length : 0;

      if (parts.length > prefix + 1) {
        const dir = parts.slice(0, prefix + 1).join("/");
        if (!dirs.has(dir)) {
          dirs.add(dir);
          items.push({ path: dir, type: "dir" });
        }
      } else {
        items.push({ path: row.file_path, type: "file", size: row.size, sha: row.sha });
      }
    }

    return items;
  },

  async getFile(projectId: string, branch: string, filePath: string): Promise<DbFile | null> {
    const result = await db.execute(sql`
      SELECT * FROM devmax_files 
      WHERE project_id = ${projectId} AND branch = ${branch} AND file_path = ${filePath}
    `);
    const rows = (result as any).rows || result;
    return rows[0] || null;
  },

  async saveFile(projectId: string, branch: string, filePath: string, content: string, updatedBy?: string): Promise<DbFile> {
    const sha = computeSha(content);
    const size = Buffer.byteLength(content, "utf-8");

    await db.execute(sql`
      INSERT INTO devmax_files (project_id, branch, file_path, content, sha, size, updated_by)
      VALUES (${projectId}, ${branch}, ${filePath}, ${content}, ${sha}, ${size}, ${updatedBy || null})
      ON CONFLICT (project_id, branch, file_path)
      DO UPDATE SET content = ${content}, sha = ${sha}, size = ${size}, updated_by = ${updatedBy || null}, updated_at = NOW()
    `);

    return { id: 0, project_id: projectId, branch, file_path: filePath, content, sha, size, encoding: "utf-8", updated_by: updatedBy, created_at: "", updated_at: "" };
  },

  async deleteFile(projectId: string, branch: string, filePath: string): Promise<boolean> {
    const result = await db.execute(sql`
      DELETE FROM devmax_files WHERE project_id = ${projectId} AND branch = ${branch} AND file_path = ${filePath}
    `);
    return true;
  },

  async saveBatch(projectId: string, branch: string, files: { path: string; content: string }[], updatedBy?: string): Promise<number> {
    let count = 0;
    for (const f of files) {
      await this.saveFile(projectId, branch, f.path, f.content, updatedBy);
      count++;
    }
    return count;
  },

  async deleteAll(projectId: string, branch?: string): Promise<void> {
    if (branch) {
      await db.execute(sql`DELETE FROM devmax_files WHERE project_id = ${projectId} AND branch = ${branch}`);
    } else {
      await db.execute(sql`DELETE FROM devmax_files WHERE project_id = ${projectId}`);
    }
  },

  async listBranches(projectId: string): Promise<string[]> {
    const result = await db.execute(sql`
      SELECT DISTINCT branch FROM devmax_files WHERE project_id = ${projectId} ORDER BY branch
    `);
    const rows = (result as any).rows || result;
    return rows.map((r: any) => r.branch);
  },

  async copyBranch(projectId: string, fromBranch: string, toBranch: string): Promise<number> {
    const result = await db.execute(sql`
      SELECT file_path, content, sha, size, encoding FROM devmax_files 
      WHERE project_id = ${projectId} AND branch = ${fromBranch}
    `);
    const rows = (result as any).rows || result;
    for (const row of rows) {
      await db.execute(sql`
        INSERT INTO devmax_files (project_id, branch, file_path, content, sha, size, encoding)
        VALUES (${projectId}, ${toBranch}, ${row.file_path}, ${row.content}, ${row.sha}, ${row.size}, ${row.encoding})
        ON CONFLICT (project_id, branch, file_path)
        DO UPDATE SET content = ${row.content}, sha = ${row.sha}, size = ${row.size}, updated_at = NOW()
      `);
    }
    return rows.length;
  },

  async getStats(projectId: string, branch: string = "main"): Promise<{ fileCount: number; totalSize: number }> {
    const result = await db.execute(sql`
      SELECT COUNT(*)::int as file_count, COALESCE(SUM(size), 0)::int as total_size 
      FROM devmax_files WHERE project_id = ${projectId} AND branch = ${branch}
    `);
    const rows = (result as any).rows || result;
    return { fileCount: rows[0]?.file_count || 0, totalSize: rows[0]?.total_size || 0 };
  },
};
