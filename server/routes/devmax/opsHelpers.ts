import { Request, Response } from "express";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { withGitHubToken } from "../../services/githubService";
import { resolveProjectGitHubToken } from "../../services/devmax/tokenService";

export async function getProjectRepo(req: Request, res: Response): Promise<{ owner: string; name: string; deploySlug: string; githubToken: string | null; storageMode: string; env: string } | null> {
  const projectId = req.headers["x-devmax-project"] as string;
  if (!projectId) {
    res.status(400).json({ error: "Project ID requis (header x-devmax-project)" });
    return null;
  }

  const session = (req as any).devmaxSession;
  if (!session) {
    res.status(401).json({ error: "Session invalide" });
    return null;
  }

  const project = await db.execute(sql`
    SELECT * FROM devmax_projects 
    WHERE id = ${projectId}
  `);

  if (!project.rows?.length) {
    res.status(404).json({ error: "Projet non trouve ou acces interdit" });
    return null;
  }

  const p = project.rows[0] as any;

  const env = (req.query.env as string) || (req.headers["x-devmax-env"] as string) || "production";
  const isStaging = env === "staging";

  const owner = isStaging && p.staging_repo_owner ? p.staging_repo_owner : p.repo_owner;
  const name = isStaging && p.staging_repo_name ? p.staging_repo_name : p.repo_name;
  const storageMode = p.storage_mode || "github";

  if (storageMode === "github" && (!owner || !name)) {
    res.status(400).json({ error: "Ce projet n'a pas de repo GitHub configure" });
    return null;
  }

  await db.execute(sql`UPDATE devmax_projects SET updated_at = NOW() WHERE id = ${projectId}`);

  const githubToken = storageMode === "github" ? await resolveProjectGitHubToken(projectId) : null;

  const deploySlug = p.deploy_slug || (name || p.name || "").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return { owner: owner || "", name: name || "", deploySlug, githubToken, storageMode, env };
}

export function withRepoToken<T>(token: string | null, fn: () => Promise<T>): Promise<T> {
  if (token) return withGitHubToken(token, fn);
  return fn();
}
