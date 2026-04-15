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
    console.warn(`[TokenService] Token validation failed: status=${res.status}`);
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
      .then(() => console.log(`[TokenService] Auto-encrypted github_token in ${table} for ${idValue}`))
      .catch(() => {});
  }
  return plaintext;
}

export interface TokenResolutionOptions {
  projectId?: string;
  owner?: string;
  repo?: string;
  tenantContext?: { isTenant?: boolean; tenantUserId?: number; tenantId?: string };
  validate?: boolean;
}

export async function resolveGitHubToken(opts: TokenResolutionOptions): Promise<string | null> {
  const { projectId, owner, repo, tenantContext, validate = false } = opts;
  let resolvedToken: string | null = null;

  try {
    if (projectId) {
      const [project] = await db.execute(sql`
        SELECT github_token, github_provider, tenant_id, repo_owner FROM devmax_projects WHERE id = ${projectId}
      `).then((r: any) => r.rows || r);

      if (project?.github_token) {
        const token = await decryptAndMigrateToken(project.github_token, "devmax_projects", "id", projectId);
        if (!validate || await isTokenValid(token)) {
          resolvedToken = token;
        } else {
          console.warn(`[TokenService] Project token expired for ${projectId}, trying fallbacks`);
        }
      }

      if (!resolvedToken && project?.tenant_id) {
        const [tenant] = await db.execute(sql`
          SELECT id, github_token FROM devmax_tenants WHERE id = ${project.tenant_id} AND github_token IS NOT NULL
        `).then((r: any) => r.rows || r);
        if (tenant?.github_token) {
          console.log(`[TokenService] Token resolved from tenant for project ${projectId}`);
          resolvedToken = await decryptAndMigrateToken(tenant.github_token, "devmax_tenants", "id", tenant.id);
        }
      }

      if (!resolvedToken && project?.repo_owner) {
        const tenantRows = await db.execute(sql`
          SELECT id, github_token FROM devmax_tenants WHERE github_org = ${project.repo_owner} AND github_token IS NOT NULL LIMIT 1
        `).then((r: any) => r.rows || r);
        if (tenantRows?.[0]?.github_token) {
          resolvedToken = await decryptAndMigrateToken(tenantRows[0].github_token, "devmax_tenants", "id", tenantRows[0].id);
        }
      }
    }

    if (!resolvedToken && owner && repo) {
      const rows = await db.execute(sql`
        SELECT id, github_token FROM devmax_projects
        WHERE repo_owner = ${owner} AND repo_name = ${repo} AND github_token IS NOT NULL
        LIMIT 1
      `).then((r: any) => r.rows || r);
      if (rows?.[0]?.github_token) {
        resolvedToken = await decryptAndMigrateToken(rows[0].github_token, "devmax_projects", "id", rows[0].id);
      }
    }

    if (!resolvedToken && owner) {
      const userRows = await db.execute(sql`
        SELECT id, github_token FROM devmax_users
        WHERE github_username = ${owner} AND github_token IS NOT NULL
        LIMIT 1
      `).then((r: any) => r.rows || r);
      if (userRows?.[0]?.github_token) {
        resolvedToken = await decryptAndMigrateToken(userRows[0].github_token, "devmax_users", "id", userRows[0].id);
      }

      if (!resolvedToken) {
        const tenantRows = await db.execute(sql`
          SELECT id, github_token FROM devmax_tenants
          WHERE github_org = ${owner} AND github_token IS NOT NULL
          LIMIT 1
        `).then((r: any) => r.rows || r);
        if (tenantRows?.[0]?.github_token) {
          console.log(`[TokenService] Token resolved from tenant org ${owner}`);
          resolvedToken = await decryptAndMigrateToken(tenantRows[0].github_token, "devmax_tenants", "id", tenantRows[0].id);
        }
      }

      if (!resolvedToken) {
        const projectByOwner = await db.execute(sql`
          SELECT id, github_token FROM devmax_projects
          WHERE repo_owner = ${owner} AND github_token IS NOT NULL
          LIMIT 1
        `).then((r: any) => r.rows || r);
        if (projectByOwner?.[0]?.github_token) {
          console.log(`[TokenService] Token resolved from project for owner ${owner}`);
          resolvedToken = await decryptAndMigrateToken(projectByOwner[0].github_token, "devmax_projects", "id", projectByOwner[0].id);
        }
      }
    }
  } catch (e: any) {
    console.warn(`[TokenService] Token resolution failed:`, e.message);
  }

  if (resolvedToken) return resolvedToken;

  if (owner === 'devmaxtest' && process.env.DEVMAXTEST_GITHUB_PAT) {
    console.log(`[TokenService] Fallback to DEVMAXTEST_GITHUB_PAT for owner devmaxtest`);
    return process.env.DEVMAXTEST_GITHUB_PAT;
  }

  if (process.env.MAURICE_GITHUB_PAT) {
    if (tenantContext?.isTenant) {
      console.warn(`[TokenService] BLOCKED fallback to MAURICE_GITHUB_PAT for tenant userId=${tenantContext.tenantUserId}`);
      return null;
    }
    console.log(`[TokenService] Fallback to MAURICE_GITHUB_PAT for owner ${owner || 'unknown'}`);
    return process.env.MAURICE_GITHUB_PAT;
  }

  return null;
}

export async function resolveProjectGitHubToken(projectId: string): Promise<string | null> {
  return resolveGitHubToken({ projectId, validate: true });
}
