import { db } from "../../db";
import { sql } from "drizzle-orm";
import { decryptToken, isEncrypted, encryptToken } from "./cryptoService";

const tokenValidityCache: Record<string, { valid: boolean; checkedAt: number }> = {};

export async function isTokenValid(token: string): Promise<boolean> {
  const cached = tokenValidityCache[token];
  if (cached && Date.now() - cached.checkedAt < 5 * 60 * 1000) return cached.valid;
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (res.ok) {
      tokenValidityCache[token] = { valid: true, checkedAt: Date.now() };
      return true;
    }
    if (res.status === 403) {
      const rateCheck = await fetch("https://api.github.com/rate_limit", {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      });
      if (rateCheck.ok) {
        tokenValidityCache[token] = { valid: true, checkedAt: Date.now() };
        return true;
      }
    }
    console.warn(`[DevMaxOps] Token validation failed: status=${res.status}`);
    tokenValidityCache[token] = { valid: false, checkedAt: Date.now() };
    return false;
  } catch {
    tokenValidityCache[token] = { valid: false, checkedAt: Date.now() };
    return false;
  }
}

async function decryptAndMigrateToken(raw: string, table: string, idColumn: string, idValue: string): Promise<string> {
  const plaintext = decryptToken(raw);
  if (!isEncrypted(raw)) {
    const encrypted = encryptToken(plaintext);
    db.execute(sql`UPDATE ${sql.raw(table)} SET github_token = ${encrypted} WHERE ${sql.raw(idColumn)} = ${idValue}`)
      .then(() => console.log(`[DevMaxOps] Auto-encrypted github_token in ${table} for ${idValue}`))
      .catch(() => {});
  }
  return plaintext;
}

export async function resolveProjectGitHubToken(projectId: string): Promise<string | null> {
  try {
    const [project] = await db.execute(sql`
      SELECT github_token, github_provider, tenant_id, repo_owner FROM devmax_projects WHERE id = ${projectId}
    `).then((r: any) => r.rows || r);
    if (project?.github_token) {
      const token = await decryptAndMigrateToken(project.github_token, "devmax_projects", "id", projectId);
      if (await isTokenValid(token)) return token;
      console.warn(`[DevMaxOps] Project token expired for ${projectId}, trying fallbacks`);
    }
    if (project?.tenant_id) {
      const [tenant] = await db.execute(sql`
        SELECT id, github_token FROM devmax_tenants WHERE id = ${project.tenant_id} AND github_token IS NOT NULL
      `).then((r: any) => r.rows || r);
      if (tenant?.github_token) {
        return decryptAndMigrateToken(tenant.github_token, "devmax_tenants", "id", tenant.id);
      }
    }
    if (project?.repo_owner) {
      const tenantRows = await db.execute(sql`
        SELECT id, github_token FROM devmax_tenants WHERE github_org = ${project.repo_owner} AND github_token IS NOT NULL LIMIT 1
      `).then((r: any) => r.rows || r);
      if (tenantRows?.[0]?.github_token) {
        return decryptAndMigrateToken(tenantRows[0].github_token, "devmax_tenants", "id", tenantRows[0].id);
      }
    }
  } catch (e: any) {
    console.warn(`[DevMaxOps] Token resolution failed for project ${projectId}:`, e.message);
  }
  console.warn(`[DevMaxOps] No valid token found for project ${projectId} — using owner fallback`);
  if (process.env.MAURICE_GITHUB_PAT) return process.env.MAURICE_GITHUB_PAT;
  return null;
}
