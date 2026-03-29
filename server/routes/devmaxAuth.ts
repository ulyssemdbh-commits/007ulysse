import { Router, Request, Response } from "express";
import { db } from "../db";
import { devmaxSessions, devmaxActivityLog } from "@shared/schema";
import { eq, and, gt, SQL } from "drizzle-orm";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { githubService, withGitHubToken } from "../services/githubService";
import { devmaxStorage } from "../services/devmaxStorage";
import { safeCatch, safeCatchDebug } from "../services/logger";

const router = Router();

const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000;

async function ensureDevmaxTables() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS devmax_sessions (
        id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        display_name TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        last_active_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL,
        ip_address TEXT,
        user_agent TEXT
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS devmax_activity_log (
        id SERIAL PRIMARY KEY,
        session_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        details JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS devmax_projects (
        id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        repo_owner TEXT,
        repo_name TEXT,
        repo_url TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`ALTER TABLE devmax_projects ADD COLUMN IF NOT EXISTS github_token TEXT`).catch((e) => safeCatchDebug("devmax-alter-github_token", e));
    await db.execute(sql`ALTER TABLE devmax_projects ADD COLUMN IF NOT EXISTS github_provider TEXT DEFAULT 'owner'`).catch((e) => safeCatchDebug("devmax-alter-github_provider", e));
    await db.execute(sql`ALTER TABLE devmax_projects ADD COLUMN IF NOT EXISTS github_user TEXT`).catch((e) => safeCatchDebug("devmax-alter-github_user", e));
    await db.execute(sql`ALTER TABLE devmax_projects ADD COLUMN IF NOT EXISTS github_scopes TEXT`).catch((e) => safeCatchDebug("devmax-alter-github_scopes", e));
    await db.execute(sql`ALTER TABLE devmax_projects ADD COLUMN IF NOT EXISTS github_connected_at TIMESTAMP`).catch((e) => safeCatchDebug("devmax-alter-github_connected_at", e));
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS devmax_chat_history (
        id SERIAL PRIMARY KEY,
        project_id TEXT,
        session_id TEXT NOT NULL,
        thread_id INTEGER,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls JSONB,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS devmax_project_journal (
        id SERIAL PRIMARY KEY,
        project_id TEXT NOT NULL,
        session_id TEXT,
        entry_type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        files_changed TEXT[],
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_devmax_chat_project ON devmax_chat_history(project_id)`).catch((e) => safeCatchDebug("devmax-idx-chat_project", e));
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_devmax_chat_session ON devmax_chat_history(session_id)`).catch((e) => safeCatchDebug("devmax-idx-chat_session", e));
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_devmax_journal_project ON devmax_project_journal(project_id)`).catch((e) => safeCatchDebug("devmax-idx-journal_project", e));
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS devmax_users (
        id TEXT PRIMARY KEY,
        fingerprint TEXT UNIQUE NOT NULL,
        username TEXT NOT NULL,
        display_name TEXT,
        email TEXT,
        pin TEXT NOT NULL DEFAULT '102040',
        role TEXT NOT NULL DEFAULT 'user',
        active BOOLEAN NOT NULL DEFAULT true,
        permissions JSONB DEFAULT '{}',
        last_login_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `).catch((e) => safeCatchDebug("devmax-create-users", e));
    await db.execute(sql`ALTER TABLE devmax_users ADD COLUMN IF NOT EXISTS email TEXT`).catch((e) => safeCatchDebug("devmax-alter-users-email", e));
    await db.execute(sql`ALTER TABLE devmax_users ADD COLUMN IF NOT EXISTS first_name TEXT`).catch((e) => safeCatchDebug("devmax-alter-users-first_name", e));
    await db.execute(sql`ALTER TABLE devmax_users ADD COLUMN IF NOT EXISTS last_name TEXT`).catch((e) => safeCatchDebug("devmax-alter-users-last_name", e));
    await db.execute(sql`ALTER TABLE devmax_users ADD COLUMN IF NOT EXISTS login_id TEXT UNIQUE`).catch((e) => safeCatchDebug("devmax-alter-users-login_id", e));
    await db.execute(sql`ALTER TABLE devmax_users ADD COLUMN IF NOT EXISTS password_hash TEXT`).catch((e) => safeCatchDebug("devmax-alter-users-password_hash", e));
    await db.execute(sql`ALTER TABLE devmax_users ADD COLUMN IF NOT EXISTS pin_hash TEXT`).catch((e) => safeCatchDebug("devmax-alter-users-pin_hash", e));
    await db.execute(sql`ALTER TABLE devmax_users ADD COLUMN IF NOT EXISTS github_username TEXT`).catch((e) => safeCatchDebug("devmax-alter-users-github_username", e));
    await db.execute(sql`ALTER TABLE devmax_users ADD COLUMN IF NOT EXISTS github_token TEXT`).catch((e) => safeCatchDebug("devmax-alter-users-github_token", e));
    await db.execute(sql`ALTER TABLE devmax_users ADD COLUMN IF NOT EXISTS ssh_public_key TEXT`).catch((e) => safeCatchDebug("devmax-alter-users-ssh_public_key", e));
    await db.execute(sql`ALTER TABLE devmax_users ADD COLUMN IF NOT EXISTS avatar_url TEXT`).catch((e) => safeCatchDebug("devmax-alter-users-avatar_url", e));
    await db.execute(sql`ALTER TABLE devmax_users ADD COLUMN IF NOT EXISTS phone TEXT`).catch((e) => safeCatchDebug("devmax-alter-users-phone", e));
    await db.execute(sql`ALTER TABLE devmax_users ADD COLUMN IF NOT EXISTS bio TEXT`).catch((e) => safeCatchDebug("devmax-alter-users-bio", e));
    await db.execute(sql`ALTER TABLE devmax_users ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'Europe/Paris'`).catch((e) => safeCatchDebug("devmax-alter-users-timezone", e));
    await db.execute(sql`ALTER TABLE devmax_users ADD COLUMN IF NOT EXISTS preferred_language TEXT DEFAULT 'fr'`).catch((e) => safeCatchDebug("devmax-alter-users-preferred_language", e));
    await db.execute(sql`ALTER TABLE devmax_users ADD COLUMN IF NOT EXISTS failed_attempts INTEGER DEFAULT 0`).catch((e) => safeCatchDebug("devmax-alter-users-failed_attempts", e));
    await db.execute(sql`ALTER TABLE devmax_users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP`).catch((e) => safeCatchDebug("devmax-alter-users-locked_until", e));
    await db.execute(sql`ALTER TABLE devmax_users ADD COLUMN IF NOT EXISTS last_failed_at TIMESTAMP`).catch((e) => safeCatchDebug("devmax-alter-users-last_failed_at", e));
    await db.execute(sql`ALTER TABLE devmax_users ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{"email": true, "push": false}'`).catch((e) => safeCatchDebug("devmax-alter-users-notification_prefs", e));
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_devmax_users_fp ON devmax_users(fingerprint)`).catch((e) => safeCatchDebug("devmax-idx-users_fp", e));
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_devmax_users_login ON devmax_users(login_id)`).catch((e) => safeCatchDebug("devmax-idx-users_login", e));

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS devmax_tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        owner_id TEXT REFERENCES devmax_users(id),
        plan TEXT NOT NULL DEFAULT 'free',
        plan_limits JSONB DEFAULT '{"max_projects": 3, "max_users": 2, "max_deploys_month": 10, "max_storage_gb": 1, "custom_domain": false, "priority_support": false, "api_access": false}',
        billing_email TEXT,
        billing_status TEXT DEFAULT 'active',
        trial_ends_at TIMESTAMP,
        logo_url TEXT,
        settings JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `).catch((e) => safeCatchDebug("devmax-create-tenants", e));
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_devmax_tenants_slug ON devmax_tenants(slug)`).catch((e) => safeCatchDebug("devmax-idx-tenants_slug", e));

    const tenantCols: Array<[string, string]> = [
      ["production_url", "TEXT"],
      ["staging_url", "TEXT"],
      ["github_org", "TEXT"],
      ["github_repo", "TEXT"],
      ["github_token", "TEXT"],
      ["contact_name", "TEXT"],
      ["contact_email", "TEXT"],
      ["contact_phone", "TEXT"],
      ["address", "TEXT"],
      ["stripe_customer_id", "TEXT"],
      ["payment_method", "TEXT DEFAULT 'none'"],
      ["credential_login", "TEXT"],
      ["credential_password", "TEXT"],
    ];
    for (const [col, type] of tenantCols) {
      await db.execute(sql.raw(`ALTER TABLE devmax_tenants ADD COLUMN IF NOT EXISTS ${col} ${type}`)).catch(() => {});
    }

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS devmax_tenant_members (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES devmax_tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES devmax_users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'member',
        permissions JSONB DEFAULT '{}',
        invited_by TEXT,
        joined_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(tenant_id, user_id)
      )
    `).catch((e) => safeCatchDebug("devmax-create-tenant_members", e));
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_devmax_tm_tenant ON devmax_tenant_members(tenant_id)`).catch((e) => safeCatchDebug("devmax-idx-tm_tenant", e));
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_devmax_tm_user ON devmax_tenant_members(user_id)`).catch((e) => safeCatchDebug("devmax-idx-tm_user", e));

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS devmax_invitations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES devmax_tenants(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        token TEXT UNIQUE NOT NULL,
        invited_by TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        expires_at TIMESTAMP NOT NULL,
        accepted_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `).catch((e) => safeCatchDebug("devmax-create-invitations", e));

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS devmax_api_keys (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES devmax_tenants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        key_prefix TEXT NOT NULL,
        permissions JSONB DEFAULT '["read"]',
        last_used_at TIMESTAMP,
        expires_at TIMESTAMP,
        active BOOLEAN NOT NULL DEFAULT true,
        created_by TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `).catch((e) => safeCatchDebug("devmax-create-api_keys", e));

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS devmax_usage_logs (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        user_id TEXT,
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `).catch((e) => safeCatchDebug("devmax-create-usage_logs", e));
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_devmax_usage_tenant ON devmax_usage_logs(tenant_id, created_at)`).catch((e) => safeCatchDebug("devmax-idx-usage_tenant", e));

    await db.execute(sql`ALTER TABLE devmax_projects ADD COLUMN IF NOT EXISTS tenant_id TEXT`).catch((e) => safeCatchDebug("devmax-alter-projects-tenant_id", e));
    await db.execute(sql`ALTER TABLE devmax_users ADD COLUMN IF NOT EXISTS tenant_id TEXT`).catch((e) => safeCatchDebug("devmax-alter-users-tenant_id", e));
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_devmax_projects_tenant ON devmax_projects(tenant_id)`).catch((e) => safeCatchDebug("devmax-idx-projects_tenant", e));

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS devmax_audit_log (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT,
        user_id TEXT,
        action TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        old_values JSONB,
        new_values JSONB,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `).catch((e) => safeCatchDebug("devmax-create-audit_log", e));
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_devmax_audit_tenant ON devmax_audit_log(tenant_id, created_at)`).catch((e) => safeCatchDebug("devmax-idx-audit_tenant", e));

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS devmax_integrations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES devmax_tenants(id) ON DELETE CASCADE,
        service TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'disconnected',
        config JSONB DEFAULT '{}',
        credentials JSONB DEFAULT '{}',
        last_sync_at TIMESTAMP,
        last_error TEXT,
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(tenant_id, service)
      )
    `).catch((e) => safeCatchDebug("devmax-create-integrations", e));
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_devmax_integrations_tenant ON devmax_integrations(tenant_id)`).catch((e) => safeCatchDebug("devmax-idx-integrations_tenant", e));

    await db.execute(sql`ALTER TABLE devmax_sessions ADD COLUMN IF NOT EXISTS user_id TEXT`).catch(() => {});
    await db.execute(sql`ALTER TABLE devmax_sessions ADD COLUMN IF NOT EXISTS tenant_id TEXT`).catch(() => {});

    await db.execute(sql`ALTER TABLE devmax_projects ADD COLUMN IF NOT EXISTS staging_port INTEGER`).catch(() => {});
    await db.execute(sql`ALTER TABLE devmax_projects ADD COLUMN IF NOT EXISTS production_port INTEGER`).catch(() => {});
    await db.execute(sql`ALTER TABLE devmax_projects ADD COLUMN IF NOT EXISTS webhook_secret TEXT`).catch(() => {});
    await db.execute(sql`ALTER TABLE devmax_projects ADD COLUMN IF NOT EXISTS cicd_enabled BOOLEAN DEFAULT true`).catch(() => {});
    await db.execute(sql`ALTER TABLE devmax_projects ADD COLUMN IF NOT EXISTS cicd_branch TEXT DEFAULT 'main'`).catch(() => {});
    await db.execute(sql`ALTER TABLE devmax_projects ADD COLUMN IF NOT EXISTS webhook_id TEXT`).catch(() => {});

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS devmax_deployments (
        id SERIAL PRIMARY KEY,
        project_id TEXT NOT NULL,
        environment TEXT NOT NULL DEFAULT 'staging',
        trigger TEXT NOT NULL DEFAULT 'manual',
        commit_sha TEXT,
        commit_message TEXT,
        branch TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        url TEXT,
        logs JSONB DEFAULT '[]',
        duration_ms INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `).catch((e) => safeCatchDebug("devmax-create-deployments", e));
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_devmax_deployments_project ON devmax_deployments(project_id)`).catch(() => {});
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_devmax_deployments_created ON devmax_deployments(created_at DESC)`).catch(() => {});

    const migrated = await db.execute(sql`
      UPDATE devmax_projects 
      SET staging_url = REPLACE(REPLACE(staging_url, '.test.ulyssepro.org', '.dev.ulyssepro.org'), '-dev.ulyssepro.org', '.dev.ulyssepro.org')
      WHERE staging_url LIKE '%.test.ulyssepro.org%' OR staging_url LIKE '%-dev.ulyssepro.org%'
    `).catch(() => null);
    if (migrated && (migrated as any).rowCount > 0) {
      console.log(`[DevMax] Migrated ${(migrated as any).rowCount} staging URLs from .test.ulyssepro.org to -dev.ulyssepro.org`);
    }

    const duplicates = await db.execute(sql`
      DELETE FROM devmax_projects 
      WHERE id IN (
        SELECT id FROM (
          SELECT id, deploy_slug, tenant_id,
            ROW_NUMBER() OVER (PARTITION BY deploy_slug ORDER BY 
              CASE WHEN tenant_id IS NOT NULL THEN 0 ELSE 1 END, 
              created_at ASC
            ) as rn
          FROM devmax_projects WHERE deploy_slug IS NOT NULL
        ) ranked WHERE rn > 1
      )
    `).catch(() => null);
    if (duplicates && (duplicates as any).rowCount > 0) {
      console.log(`[DevMax] Cleaned ${(duplicates as any).rowCount} duplicate projects (kept oldest per slug with tenant priority)`);
    }

    await db.execute(sql`
      UPDATE devmax_projects 
      SET staging_url = 'https://' || deploy_slug || '.dev.ulyssepro.org',
          production_url = 'https://' || deploy_slug || '.ulyssepro.org'
      WHERE deploy_slug IS NOT NULL 
        AND (staging_url IS NULL OR production_url IS NULL)
    `).catch(() => {});

    const unassigned = await db.execute(sql`
      SELECT id, deploy_slug FROM devmax_projects 
      WHERE deploy_slug IS NOT NULL 
        AND (staging_port IS NULL OR production_port IS NULL)
    `).then((r: any) => r.rows || r).catch(() => []);
    if (unassigned.length > 0) {
      console.log(`[DevMax] Assigning ports to ${unassigned.length} projects without reserved ports...`);
      try {
        const { sshService } = await import("../services/sshService");
        for (const p of unassigned) {
          const ports = await sshService.reserveProjectPorts(p.id, "max");
          console.log(`[DevMax] Ports assigned to ${p.deploy_slug}: staging=${ports.stagingPort} prod=${ports.productionPort}`);
        }
      } catch (e: any) {
        console.error(`[DevMax] Port assignment failed:`, e.message);
      }
    }

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS devmax_notifications (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT,
        project_id TEXT,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT,
        channel TEXT NOT NULL DEFAULT 'email',
        recipient TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        metadata JSONB DEFAULT '{}',
        read_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `).catch((e) => safeCatchDebug("devmax-create-notifications", e));
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_devmax_notif_tenant ON devmax_notifications(tenant_id, created_at DESC)`).catch(() => {});

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS devmax_env_vars (
        id SERIAL PRIMARY KEY,
        project_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        environment TEXT NOT NULL DEFAULT 'all',
        is_secret BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(project_id, key, environment)
      )
    `).catch((e) => safeCatchDebug("devmax-create-env_vars", e));
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_devmax_envvars_project ON devmax_env_vars(project_id)`).catch(() => {});

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS devmax_metrics (
        id SERIAL PRIMARY KEY,
        project_id TEXT NOT NULL,
        environment TEXT NOT NULL DEFAULT 'staging',
        cpu_percent REAL,
        memory_mb REAL,
        memory_percent REAL,
        uptime_seconds INTEGER,
        restarts INTEGER DEFAULT 0,
        status TEXT,
        response_time_ms INTEGER,
        collected_at TIMESTAMP DEFAULT NOW()
      )
    `).catch((e) => safeCatchDebug("devmax-create-metrics", e));
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_devmax_metrics_project ON devmax_metrics(project_id, collected_at DESC)`).catch(() => {});

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS devmax_custom_domains (
        id SERIAL PRIMARY KEY,
        project_id TEXT NOT NULL,
        tenant_id TEXT,
        domain TEXT UNIQUE NOT NULL,
        environment TEXT NOT NULL DEFAULT 'production',
        dns_status TEXT NOT NULL DEFAULT 'pending',
        ssl_status TEXT NOT NULL DEFAULT 'pending',
        cloudflare_record_id TEXT,
        verified_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `).catch((e) => safeCatchDebug("devmax-create-custom_domains", e));

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS devmax_logs (
        id SERIAL PRIMARY KEY,
        project_id TEXT NOT NULL,
        environment TEXT NOT NULL DEFAULT 'staging',
        level TEXT NOT NULL DEFAULT 'info',
        message TEXT NOT NULL,
        source TEXT DEFAULT 'pm2',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `).catch((e) => safeCatchDebug("devmax-create-logs", e));
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_devmax_logs_project ON devmax_logs(project_id, created_at DESC)`).catch(() => {});

    await db.execute(sql`ALTER TABLE devmax_tenants ADD COLUMN IF NOT EXISTS notification_webhook TEXT`).catch(() => {});
    await db.execute(sql`ALTER TABLE devmax_tenants ADD COLUMN IF NOT EXISTS notification_email TEXT`).catch(() => {});
    await db.execute(sql`ALTER TABLE devmax_tenants ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false`).catch(() => {});
    await db.execute(sql`ALTER TABLE devmax_tenants ADD COLUMN IF NOT EXISTS onboarding_step TEXT DEFAULT 'welcome'`).catch(() => {});

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS devmax_ai_costs (
        id SERIAL PRIMARY KEY,
        provider TEXT NOT NULL DEFAULT 'openai',
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        context TEXT NOT NULL DEFAULT 'chat',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `).catch((e) => safeCatchDebug("devmax-create-ai_costs", e));
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_devmax_ai_costs_date ON devmax_ai_costs(created_at DESC)`).catch(() => {});

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS devmax_github_events (
        id SERIAL PRIMARY KEY,
        project_id TEXT,
        event_type TEXT NOT NULL,
        repo TEXT NOT NULL,
        branch TEXT,
        actor TEXT,
        title TEXT,
        details JSONB DEFAULT '{}',
        notified BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `).catch((e) => safeCatchDebug("devmax-create-github_events", e));
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_devmax_github_events_project ON devmax_github_events(project_id, created_at DESC)`).catch(() => {});

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS devmax_health_checks (
        id SERIAL PRIMARY KEY,
        app_name TEXT NOT NULL,
        project_id TEXT,
        http_code INTEGER,
        response_time_ms INTEGER,
        pm2_status TEXT,
        alert_sent BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `).catch((e) => safeCatchDebug("devmax-create-health_checks", e));
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_devmax_health_app ON devmax_health_checks(app_name, created_at DESC)`).catch(() => {});

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS devmax_secrets (
        id SERIAL PRIMARY KEY,
        project_id TEXT NOT NULL,
        key TEXT NOT NULL,
        encrypted_value TEXT NOT NULL,
        environment TEXT NOT NULL DEFAULT 'all',
        last_rotated_at TIMESTAMP,
        accessed_count INTEGER DEFAULT 0,
        last_accessed_at TIMESTAMP,
        created_by TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(project_id, key, environment)
      )
    `).catch((e) => safeCatchDebug("devmax-create-secrets", e));
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_devmax_secrets_project ON devmax_secrets(project_id)`).catch(() => {});

    await db.execute(sql`ALTER TABLE devmax_deployments ADD COLUMN IF NOT EXISTS git_diff TEXT`).catch(() => {});
    await db.execute(sql`ALTER TABLE devmax_deployments ADD COLUMN IF NOT EXISTS prev_commit_sha TEXT`).catch(() => {});
    await db.execute(sql`ALTER TABLE devmax_deployments ADD COLUMN IF NOT EXISTS files_changed JSONB`).catch(() => {});

    console.log("[DevMax] Tables ensured");
  } catch (e: any) {
    console.error("[DevMax] Table creation error:", e.message);
  }
}

ensureDevmaxTables();

async function hashPin(pin: string): Promise<string> {
  const crypto = await import("crypto");
  return crypto.createHash("sha256").update(pin).digest("hex");
}

async function hashPassword(password: string): Promise<string> {
  const crypto = await import("crypto");
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const crypto = await import("crypto");
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return test === hash;
}

router.post("/auth", async (req: Request, res: Response) => {
  try {
    const { pin, fingerprint, loginId, password } = req.body;
    if (!fingerprint) {
      return res.status(400).json({ error: "fingerprint requis" });
    }

    let user: any = null;
    let tenantAuth = false;
    let resolvedTenantId: string | null = null;

    if (loginId && password) {
      const rows = await db.execute(sql`SELECT * FROM devmax_users WHERE login_id = ${loginId} AND active = true`).then((r: any) => r.rows || r);
      if (rows.length > 0) user = rows[0];

      const tenantRows = await db.execute(sql`
        SELECT t.*, u.id as owner_user_id FROM devmax_tenants t
        LEFT JOIN devmax_users u ON t.owner_id = u.id
        WHERE t.credential_login = ${loginId}
      `).then((r: any) => r.rows || r);

      if (tenantRows.length > 0) {
        const tenant = tenantRows[0];
        let credMatch = false;
        if (tenant.credential_password) {
          if (tenant.credential_password.includes(":")) {
            credMatch = await verifyPassword(password, tenant.credential_password);
          } else {
            credMatch = tenant.credential_password === password;
          }
        }

        if (credMatch) {
          if (tenant.credential_password && !tenant.credential_password.includes(":")) {
            const migrated = await hashPassword(password);
            await db.execute(sql`UPDATE devmax_tenants SET credential_password = ${migrated} WHERE id = ${tenant.id}`).catch(() => {});
          }
          resolvedTenantId = tenant.id;
          if (user && user.tenant_id === tenant.id) {
            tenantAuth = true;
          } else {
            if (tenant.owner_user_id) {
              const [ownerUser] = await db.execute(sql`SELECT * FROM devmax_users WHERE id = ${tenant.owner_user_id} AND active = true`).then((r: any) => r.rows || r);
              if (ownerUser) { user = ownerUser; tenantAuth = true; }
            }
            if (!tenantAuth) {
              const [firstUser] = await db.execute(sql`
                SELECT * FROM devmax_users
                WHERE tenant_id = ${tenant.id} AND active = true
                ORDER BY created_at LIMIT 1
              `).then((r: any) => r.rows || r);
              if (firstUser) { user = firstUser; tenantAuth = true; }
            }
            if (!tenantAuth) {
              if (user) {
                tenantAuth = true;
              } else {
                const newUserId = randomUUID();
                const fp = `tenant-${tenant.slug}`;
                await db.execute(sql`
                  INSERT INTO devmax_users (id, fingerprint, username, display_name, login_id, role, tenant_id, active)
                  VALUES (${newUserId}, ${fp}, ${tenant.slug}, ${tenant.name}, ${loginId}, 'user', ${tenant.id}, true)
                `);
                const [created] = await db.execute(sql`SELECT * FROM devmax_users WHERE id = ${newUserId}`).then((r: any) => r.rows || r);
                if (created) { user = created; tenantAuth = true; }
              }
            }
          }
        }
      }
    } else if (pin) {
      const pinH = await hashPin(pin);
      const rows = await db.execute(sql`SELECT * FROM devmax_users WHERE (pin_hash = ${pinH} OR pin = ${pin}) AND active = true`).then((r: any) => r.rows || r);
      if (rows.length > 0) user = rows[0];
    }

    if (!user) {
      await db.insert(devmaxActivityLog).values({
        sessionId: "failed",
        action: "auth_failed",
        target: loginId || "pin",
        details: { ip: req.ip, fingerprint: fingerprint.slice(0, 16), reason: "user_not_found" },
      }).catch(() => {});
      return res.status(401).json({ error: "Identifiants incorrects" });
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const remainingMin = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
      return res.status(423).json({
        error: "Compte verrouillé",
        locked: true,
        remainingMinutes: remainingMin,
        message: `Compte verrouillé suite à trop de tentatives. Réessayez dans ${remainingMin} min.`
      });
    }

    let authValid = tenantAuth;
    if (!authValid && loginId && password) {
      if (user.password_hash) {
        authValid = await verifyPassword(password, user.password_hash);
      }
    } else if (!authValid && pin) {
      const pinH = await hashPin(pin);
      authValid = user.pin_hash === pinH || user.pin === pin;
    }

    if (!authValid) {
      const newAttempts = (user.failed_attempts || 0) + 1;
      const lockUntil = newAttempts >= MAX_LOGIN_ATTEMPTS ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null;
      await db.execute(sql`
        UPDATE devmax_users SET failed_attempts = ${newAttempts}, last_failed_at = NOW(),
          locked_until = ${lockUntil}
        WHERE id = ${user.id}
      `).catch(() => {});
      await db.insert(devmaxActivityLog).values({
        sessionId: "failed",
        action: "auth_failed",
        target: loginId || "pin",
        details: { ip: req.ip, fingerprint: fingerprint.slice(0, 16), attempts: newAttempts, locked: newAttempts >= MAX_LOGIN_ATTEMPTS },
      }).catch(() => {});
      const remaining = MAX_LOGIN_ATTEMPTS - newAttempts;
      if (remaining <= 0) {
        return res.status(423).json({ error: "Compte verrouillé", locked: true, remainingMinutes: 30, message: "Trop de tentatives. Compte verrouillé 30 minutes." });
      }
      return res.status(401).json({ error: "Identifiants incorrects", remainingAttempts: remaining });
    }

    await db.execute(sql`UPDATE devmax_users SET failed_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ${user.id}`).catch(() => {});

    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

    await db.insert(devmaxSessions).values({
      id: sessionId,
      fingerprint,
      displayName: user.display_name || user.username,
      userId: user.id,
      tenantId: resolvedTenantId || user.tenant_id || null,
      createdAt: new Date(),
      lastActiveAt: new Date(),
      expiresAt,
      ipAddress: req.ip || null,
      userAgent: req.headers["user-agent"] || null,
    });

    await db.insert(devmaxActivityLog).values({
      sessionId,
      action: "auth_success",
      target: user.username,
      details: { ip: req.ip, userId: user.id },
    }).catch(() => {});

    let tenantSlug: string | null = null;
    if (resolvedTenantId || user.tenant_id) {
      const tid = resolvedTenantId || user.tenant_id;
      const [t] = await db.execute(sql`SELECT slug FROM devmax_tenants WHERE id = ${tid}`).then((r: any) => r.rows || r);
      if (t) tenantSlug = t.slug;
    }

    res.json({
      success: true,
      sessionId,
      expiresAt: expiresAt.toISOString(),
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatar_url,
        tenantSlug,
      }
    });
  } catch (error: any) {
    console.error("[DevMax] Auth error:", error.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.get("/session", async (req: Request, res: Response) => {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const [session] = await db.select().from(devmaxSessions)
      .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
      .limit(1);

    if (!session) return res.status(401).json({ error: "Session expired" });

    await db.update(devmaxSessions)
      .set({ lastActiveAt: new Date() })
      .where(eq(devmaxSessions.id, token))
      .catch(() => {});

    let userRows;
    if (session.userId) {
      userRows = await db.execute(sql`
        SELECT id, username, display_name, first_name, last_name, email, role, avatar_url,
          github_username, phone, bio, timezone, preferred_language, tenant_id
        FROM devmax_users WHERE id = ${session.userId}
      `).then((r: any) => r.rows || r);
    } else {
      userRows = await db.execute(sql`
        SELECT id, username, display_name, first_name, last_name, email, role, avatar_url,
          github_username, phone, bio, timezone, preferred_language, tenant_id
        FROM devmax_users WHERE fingerprint = ${session.fingerprint}
      `).then((r: any) => r.rows || r);
    }
    const user = userRows.length > 0 ? userRows[0] : null;

    let tenantSlug: string | null = null;
    const tid = session.tenantId || user?.tenant_id;
    if (tid) {
      if (!session.tenantId) {
        await db.update(devmaxSessions).set({ tenantId: tid }).where(eq(devmaxSessions.id, token)).catch(() => {});
      }
      const [t] = await db.execute(sql`SELECT slug FROM devmax_tenants WHERE id = ${tid}`).then((r: any) => r.rows || r);
      if (t) tenantSlug = t.slug;
    }

    res.json({
      valid: true,
      sessionId: session.id,
      fingerprint: session.fingerprint,
      displayName: session.displayName,
      createdAt: session.createdAt,
      user: user ? {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatar_url,
        githubUsername: user.github_username,
        phone: user.phone,
        bio: user.bio,
        timezone: user.timezone,
        preferredLanguage: user.preferred_language,
        tenantSlug,
      } : null,
    });
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/logout", async (req: Request, res: Response) => {
  const token = req.headers["x-devmax-token"] as string;
  if (token) {
    await db.delete(devmaxSessions).where(eq(devmaxSessions.id, token)).catch(() => {});
    await db.insert(devmaxActivityLog).values({
      sessionId: token,
      action: "logout",
    }).catch(() => {});
  }
  res.json({ success: true });
});

router.get("/activity", async (req: Request, res: Response) => {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const logs = await db.select().from(devmaxActivityLog)
      .orderBy(sql`created_at DESC`)
      .limit(100);
    res.json(logs);
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

async function getSessionUser(req: Request): Promise<{ session: any; user: any } | null> {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return null;
  const [session] = await db.select().from(devmaxSessions)
    .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
    .limit(1);
  if (!session) return null;
  const userRows = await db.execute(sql`SELECT * FROM devmax_users WHERE fingerprint = ${session.fingerprint}`).then((r: any) => r.rows || r);
  return { session, user: userRows.length > 0 ? userRows[0] : null };
}

router.get("/me", async (req: Request, res: Response) => {
  try {
    const ctx = await getSessionUser(req);
    if (!ctx || !ctx.user) return res.status(401).json({ error: "Non authentifié" });
    const u = ctx.user;

    const sessions = await db.execute(sql`
      SELECT id, created_at, last_active_at, expires_at, ip_address, user_agent
      FROM devmax_sessions WHERE fingerprint = ${ctx.session.fingerprint} AND expires_at > NOW()
      ORDER BY last_active_at DESC
    `).then((r: any) => r.rows || r);

    const projectCount = await db.execute(sql`SELECT COUNT(*) as count FROM devmax_projects WHERE fingerprint = ${ctx.session.fingerprint}`).then((r: any) => {
      const rows = r.rows || r;
      return parseInt(rows[0]?.count || "0");
    });

    const recentActivity = await db.execute(sql`
      SELECT action, target, details, created_at FROM devmax_activity_log
      WHERE session_id IN (SELECT id FROM devmax_sessions WHERE fingerprint = ${ctx.session.fingerprint})
      ORDER BY created_at DESC LIMIT 20
    `).then((r: any) => r.rows || r);

    res.json({
      id: u.id,
      username: u.username,
      loginId: u.login_id,
      displayName: u.display_name,
      firstName: u.first_name,
      lastName: u.last_name,
      email: u.email,
      phone: u.phone,
      bio: u.bio,
      role: u.role,
      avatarUrl: u.avatar_url,
      githubUsername: u.github_username,
      hasGithubToken: !!u.github_token,
      sshPublicKey: u.ssh_public_key,
      timezone: u.timezone,
      preferredLanguage: u.preferred_language,
      notificationPreferences: u.notification_preferences,
      hasPassword: !!u.password_hash,
      hasPin: !!(u.pin_hash || u.pin),
      lastLoginAt: u.last_login_at,
      createdAt: u.created_at,
      updatedAt: u.updated_at,
      activeSessions: sessions.length,
      sessions,
      projectCount,
      recentActivity,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/me", async (req: Request, res: Response) => {
  try {
    const ctx = await getSessionUser(req);
    if (!ctx || !ctx.user) return res.status(401).json({ error: "Non authentifié" });

    const { firstName, lastName, displayName, email, phone, bio, timezone, preferredLanguage, avatarUrl, githubUsername, sshPublicKey, notificationPreferences } = req.body;

    const fields: string[] = [];
    const safeStr = (v: string) => v.replace(/'/g, "''");
    if (firstName !== undefined) fields.push(`first_name = '${safeStr(firstName)}'`);
    if (lastName !== undefined) fields.push(`last_name = '${safeStr(lastName)}'`);
    if (displayName !== undefined) fields.push(`display_name = '${safeStr(displayName)}'`);
    if (email !== undefined) fields.push(`email = '${safeStr(email)}'`);
    if (phone !== undefined) fields.push(`phone = '${safeStr(phone)}'`);
    if (bio !== undefined) fields.push(`bio = '${safeStr(bio)}'`);
    if (timezone !== undefined) fields.push(`timezone = '${safeStr(timezone)}'`);
    if (preferredLanguage !== undefined) fields.push(`preferred_language = '${safeStr(preferredLanguage)}'`);
    if (avatarUrl !== undefined) fields.push(`avatar_url = '${safeStr(avatarUrl)}'`);
    if (githubUsername !== undefined) fields.push(`github_username = '${safeStr(githubUsername)}'`);
    if (sshPublicKey !== undefined) fields.push(`ssh_public_key = '${safeStr(sshPublicKey)}'`);
    if (notificationPreferences !== undefined) fields.push(`notification_preferences = '${JSON.stringify(notificationPreferences).replace(/'/g, "''")}'`);
    fields.push(`updated_at = NOW()`);

    await db.execute(sql.raw(`UPDATE devmax_users SET ${fields.join(", ")} WHERE id = '${safeStr(ctx.user.id)}'`));
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/me/pin", async (req: Request, res: Response) => {
  try {
    const ctx = await getSessionUser(req);
    if (!ctx || !ctx.user) return res.status(401).json({ error: "Non authentifié" });

    const { currentPin, newPin } = req.body;
    if (!newPin || newPin.length < 4 || newPin.length > 8) {
      return res.status(400).json({ error: "Le PIN doit contenir entre 4 et 8 chiffres" });
    }
    if (!/^\d+$/.test(newPin)) {
      return res.status(400).json({ error: "Le PIN ne doit contenir que des chiffres" });
    }

    const u = ctx.user;
    if (u.pin_hash || u.pin) {
      if (!currentPin) return res.status(400).json({ error: "PIN actuel requis" });
      const currentH = await hashPin(currentPin);
      if (u.pin_hash !== currentH && u.pin !== currentPin) {
        return res.status(401).json({ error: "PIN actuel incorrect" });
      }
    }

    const newPinHash = await hashPin(newPin);
    await db.execute(sql`UPDATE devmax_users SET pin_hash = ${newPinHash}, pin = NULL, updated_at = NOW() WHERE id = ${u.id}`);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/me/password", async (req: Request, res: Response) => {
  try {
    const ctx = await getSessionUser(req);
    if (!ctx || !ctx.user) return res.status(401).json({ error: "Non authentifié" });

    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: "Le mot de passe doit contenir au moins 8 caractères" });
    }

    const u = ctx.user;
    if (u.password_hash) {
      if (!currentPassword) return res.status(400).json({ error: "Mot de passe actuel requis" });
      const valid = await verifyPassword(currentPassword, u.password_hash);
      if (!valid) return res.status(401).json({ error: "Mot de passe actuel incorrect" });
    }

    const newHash = await hashPassword(newPassword);
    await db.execute(sql`UPDATE devmax_users SET password_hash = ${newHash}, updated_at = NOW() WHERE id = ${u.id}`);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/me/login-id", async (req: Request, res: Response) => {
  try {
    const ctx = await getSessionUser(req);
    if (!ctx || !ctx.user) return res.status(401).json({ error: "Non authentifié" });

    const { loginId } = req.body;
    if (!loginId || loginId.length < 3) return res.status(400).json({ error: "Login ID doit contenir au moins 3 caractères" });

    const existing = await db.execute(sql`SELECT id FROM devmax_users WHERE login_id = ${loginId} AND id != ${ctx.user.id}`).then((r: any) => r.rows || r);
    if (existing.length > 0) return res.status(409).json({ error: "Ce Login ID est déjà utilisé" });

    await db.execute(sql`UPDATE devmax_users SET login_id = ${loginId}, updated_at = NOW() WHERE id = ${ctx.user.id}`);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/me/github-token", async (req: Request, res: Response) => {
  try {
    const ctx = await getSessionUser(req);
    if (!ctx || !ctx.user) return res.status(401).json({ error: "Non authentifié" });

    const { githubToken } = req.body;
    await db.execute(sql`UPDATE devmax_users SET github_token = ${githubToken || null}, updated_at = NOW() WHERE id = ${ctx.user.id}`);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/me/sessions/:sessionId", async (req: Request, res: Response) => {
  try {
    const ctx = await getSessionUser(req);
    if (!ctx) return res.status(401).json({ error: "Non authentifié" });

    const targetId = req.params.sessionId;
    if (targetId === ctx.session.id) return res.status(400).json({ error: "Impossible de révoquer la session courante" });

    await db.execute(sql`DELETE FROM devmax_sessions WHERE id = ${targetId} AND fingerprint = ${ctx.session.fingerprint}`);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/projects", async (req: Request, res: Response) => {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const [session] = await db.select().from(devmaxSessions)
      .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
      .limit(1);
    if (!session) return res.status(401).json({ error: "Session expired" });

    const showArchived = req.query.showArchived === "true";
    let projects;
    if (session.tenantId) {
      projects = await db.execute(sql`
        SELECT * FROM devmax_projects WHERE tenant_id = ${session.tenantId}
        ${showArchived ? sql`` : sql`AND (status IS NULL OR status != 'archived')`}
        ORDER BY updated_at DESC
      `);
    } else {
      projects = await db.execute(sql`
        SELECT * FROM devmax_projects 
        ${showArchived ? sql`` : sql`WHERE (status IS NULL OR status != 'archived')`}
        ORDER BY updated_at DESC
      `);
    }
    res.json(projects.rows || []);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/projects", async (req: Request, res: Response) => {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const [session] = await db.select().from(devmaxSessions)
      .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
      .limit(1);
    if (!session) return res.status(401).json({ error: "Session expired" });

    const { name, description, repoOwner, repoName, deploySlug, template } = req.body;
    if (!name) return res.status(400).json({ error: "Nom du projet requis" });

    const id = randomUUID();
    const repoUrl = repoOwner && repoName ? `https://github.com/${repoOwner}/${repoName}` : null;
    const slug = (deploySlug || repoName || name).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

    const stagingUrl = slug ? `https://${slug}.dev.ulyssepro.org` : null;
    const productionUrl = slug ? `https://${slug}.ulyssepro.org` : null;

    await db.execute(sql`
      INSERT INTO devmax_projects (id, fingerprint, name, description, repo_owner, repo_name, repo_url, deploy_slug, staging_url, production_url, deploy_url, tenant_id)
      VALUES (${id}, ${session.fingerprint}, ${name}, ${description || null}, ${repoOwner || null}, ${repoName || null}, ${repoUrl}, ${slug}, ${stagingUrl}, ${productionUrl}, ${productionUrl}, ${session.tenantId || null})
    `);

    let reservedPorts: { stagingPort: number; productionPort: number } | null = null;
    if (slug) {
      try {
        const { sshService } = await import("../services/sshService");
        reservedPorts = await sshService.reserveProjectPorts(id, "max");
        console.log(`[DevMax] Ports reserved for ${name}: staging=${reservedPorts.stagingPort} prod=${reservedPorts.productionPort}`);
      } catch (e: any) {
        console.error(`[DevMax] Port reservation failed for ${name}:`, e.message);
      }
    }

    await logDevmaxActivity(req, "create_project", name, { id, repoOwner, repoName, deploySlug: slug, template: template || null, ports: reservedPorts });

    res.json({ id, name, description, repoOwner, repoName, repoUrl, deploySlug: slug, template: template || null, stagingUrl, productionUrl, ports: reservedPorts });

    if (slug) {
      import("../services/sshService").then(({ sshService }) => {
        sshService.deployPlaceholderPages(slug, name).then(result => {
          console.log(`[DevMax] Placeholder pages for ${name}: ${result.success ? "OK" : "FAILED"} — ${result.message}`);
        }).catch(err => {
          console.error(`[DevMax] Placeholder pages failed for ${name}:`, err.message);
        });
      });
    }

    if (repoOwner && repoName && slug) {
      autoDeployProject(id, repoOwner, repoName, slug, name, template || null).catch(err => {
        console.error(`[DevMax] Auto-deploy failed for ${name}:`, err.message);
      });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

async function autoDeployProject(projectId: string, repoOwner: string, repoName: string, slug: string, projectName: string, template?: string | null) {
  const logs: string[] = [];
  console.log(`[DevMax] Auto-deploy starting for ${projectName} (${slug})${template ? ` [template: ${template}]` : ""}`);

  const projectGhToken = await getProjectGitHubToken(projectId);
  const runWithToken = <T>(fn: () => Promise<T>): Promise<T> => {
    if (projectGhToken) return withGitHubToken(projectGhToken, fn);
    return fn();
  };

  try {
    const existingRepo = await runWithToken(() => githubService.getRepo(repoOwner, repoName)).catch(() => null);
    if (!existingRepo) {
      console.log(`[DevMax] Creating GitHub repo: ${repoOwner}/${repoName}`);
      await runWithToken(() => githubService.createRepo(repoName, {
        description: `${projectName} — managed by MaxAI / DevMax`,
        isPrivate: false,
        autoInit: true,
      }));
      logs.push(`GitHub repo created: ${repoOwner}/${repoName}`);
    } else {
      logs.push(`GitHub repo exists: ${repoOwner}/${repoName}`);
    }

    if (template && ["express-api", "react-vite", "fullstack", "nextjs", "static-html"].includes(template)) {
      try {
        console.log(`[DevMax] Applying template "${template}" to ${repoOwner}/${repoName}`);
        const { applyPatch } = await import("../services/githubService");
        const scaffoldTemplates: Record<string, { files: Array<{ path: string; content: string }>; deps: string; devDeps: string; buildCmd?: string; description: string }> = {
          "express-api": {
            description: "Express.js REST API with TypeScript",
            deps: "express cors helmet morgan dotenv",
            devDeps: "typescript @types/express @types/cors @types/morgan @types/node ts-node nodemon",
            files: [
              { path: "src/index.ts", content: `import express from "express";\nimport cors from "cors";\nimport helmet from "helmet";\nimport morgan from "morgan";\nimport dotenv from "dotenv";\n\ndotenv.config();\nconst app = express();\nconst PORT = parseInt(process.env.PORT || "3000", 10);\n\napp.use(cors());\napp.use(helmet());\napp.use(morgan("combined"));\napp.use(express.json());\napp.use(express.urlencoded({ extended: true }));\n\napp.get("/", (req, res) => res.json({ name: "${projectName}", status: "running", version: "1.0.0" }));\napp.get("/api/health", (req, res) => res.json({ status: "ok", timestamp: new Date().toISOString(), uptime: process.uptime() }));\n\napp.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {\n  console.error(err.stack);\n  res.status(500).json({ error: "Internal Server Error" });\n});\n\napp.listen(PORT, "0.0.0.0", () => console.log(\`Server running on port \${PORT}\`));\n` },
              { path: "tsconfig.json", content: `{"compilerOptions":{"target":"ES2020","module":"commonjs","lib":["ES2020"],"outDir":"./dist","rootDir":"./src","strict":true,"esModuleInterop":true,"skipLibCheck":true,"forceConsistentCasingInFileNames":true,"resolveJsonModule":true},"include":["src/**/*"]}` },
              { path: ".env.example", content: `PORT=3000\nNODE_ENV=development\nDATABASE_URL=postgresql://user:pass@localhost:5432/dbname` },
              { path: ".gitignore", content: `node_modules/\ndist/\n.env\n*.log` },
            ],
          },
          "react-vite": {
            description: "React + Vite + TypeScript SPA",
            deps: "react react-dom",
            devDeps: "typescript @types/react @types/react-dom vite @vitejs/plugin-react",
            files: [
              { path: "index.html", content: `<!DOCTYPE html>\n<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${projectName}</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>` },
              { path: "src/main.tsx", content: `import { StrictMode } from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./index.css";\n\ncreateRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);` },
              { path: "src/App.tsx", content: `export default function App() {\n  return <div className="app"><h1>${projectName}</h1><p>Ready to build.</p></div>;\n}` },
              { path: "src/index.css", content: `*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;min-height:100vh}.app{max-width:1200px;margin:0 auto;padding:2rem}` },
              { path: "vite.config.ts", content: `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\n\nexport default defineConfig({ plugins: [react()] });` },
              { path: "tsconfig.json", content: `{"compilerOptions":{"target":"ES2020","useDefineForClassFields":true,"lib":["ES2020","DOM","DOM.Iterable"],"module":"ESNext","skipLibCheck":true,"moduleResolution":"bundler","allowImportingTsExtensions":true,"resolveJsonModule":true,"isolatedModules":true,"noEmit":true,"jsx":"react-jsx","strict":true},"include":["src"]}` },
              { path: ".gitignore", content: `node_modules/\ndist/\n.env\n*.log` },
            ],
          },
          "fullstack": {
            description: "Express API + React frontend (monorepo)",
            deps: "express cors helmet dotenv react react-dom",
            devDeps: "typescript @types/express @types/cors @types/node @types/react @types/react-dom vite @vitejs/plugin-react concurrently ts-node nodemon",
            buildCmd: "tsc && cd client && npx vite build",
            files: [
              { path: "server/index.ts", content: `import express from "express";\nimport cors from "cors";\nimport helmet from "helmet";\nimport path from "path";\nimport dotenv from "dotenv";\n\ndotenv.config();\nconst app = express();\nconst PORT = parseInt(process.env.PORT || "3000", 10);\n\napp.use(cors());\napp.use(helmet());\napp.use(express.json());\napp.use(express.urlencoded({ extended: true }));\n\nconst clientDist = path.join(__dirname, "../client/dist");\napp.use(express.static(clientDist));\n\napp.get("/api/health", (req, res) => res.json({ status: "ok", timestamp: new Date().toISOString(), uptime: process.uptime() }));\n\napp.get("*", (req, res) => {\n  if (!req.path.startsWith("/api")) {\n    res.sendFile(path.join(clientDist, "index.html"));\n  }\n});\n\napp.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {\n  console.error(err.stack);\n  res.status(500).json({ error: "Internal Server Error" });\n});\n\napp.listen(PORT, "0.0.0.0", () => console.log(\`Server running on port \${PORT}\`));\n` },
              { path: "client/index.html", content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${projectName}</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>` },
              { path: "client/src/main.tsx", content: `import { StrictMode } from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App";\n\ncreateRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);` },
              { path: "client/src/App.tsx", content: `import { useState, useEffect } from "react";\n\nexport default function App() {\n  const [status, setStatus] = useState("");\n  useEffect(() => { fetch("/api/health").then(r=>r.json()).then(d=>setStatus(d.status)).catch(()=>setStatus("offline")); }, []);\n  return <div style={{maxWidth:"1200px",margin:"0 auto",padding:"2rem"}}><h1>${projectName}</h1><p>API Status: <strong>{status || "loading..."}</strong></p></div>;\n}` },
              { path: "client/vite.config.ts", content: `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\n\nexport default defineConfig({ plugins: [react()], server: { proxy: { "/api": "http://localhost:3000" } } });` },
              { path: "tsconfig.json", content: `{"compilerOptions":{"target":"ES2020","module":"commonjs","lib":["ES2020"],"outDir":"./dist","rootDir":"./server","strict":true,"esModuleInterop":true,"skipLibCheck":true},"include":["server/**/*"]}` },
              { path: ".env.example", content: `PORT=3000\nNODE_ENV=development` },
              { path: ".gitignore", content: `node_modules/\ndist/\nclient/dist/\n.env\n*.log` },
            ],
          },
          "nextjs": {
            description: "Next.js 14 with App Router",
            deps: "next react react-dom",
            devDeps: "typescript @types/react @types/react-dom @types/node",
            buildCmd: "npx next build",
            files: [
              { path: "app/layout.tsx", content: `export const metadata = { title: "${projectName}", description: "Built with Next.js" };\n\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return <html lang="en"><body>{children}</body></html>;\n}` },
              { path: "app/page.tsx", content: `export default function Home() {\n  return <main><h1>${projectName}</h1><p>Ready to build.</p></main>;\n}` },
              { path: "app/api/health/route.ts", content: `import { NextResponse } from "next/server";\n\nexport async function GET() {\n  return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() });\n}` },
              { path: "next.config.js", content: `/** @type {import('next').NextConfig} */\nmodule.exports = { reactStrictMode: true };` },
              { path: "tsconfig.json", content: `{"compilerOptions":{"target":"es5","lib":["dom","dom.iterable","esnext"],"allowJs":true,"skipLibCheck":true,"strict":true,"noEmit":true,"esModuleInterop":true,"module":"esnext","moduleResolution":"bundler","resolveJsonModule":true,"isolatedModules":true,"jsx":"preserve","incremental":true,"plugins":[{"name":"next"}],"paths":{"@/*":["./*"]}},"include":["next-env.d.ts","**/*.ts","**/*.tsx",".next/types/**/*.ts"],"exclude":["node_modules"]}` },
              { path: ".gitignore", content: `node_modules/\n.next/\n.env\n*.log` },
            ],
          },
          "static-html": {
            description: "Static HTML/CSS/JS website",
            deps: "",
            devDeps: "",
            files: [
              { path: "index.html", content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${projectName}</title><link rel="stylesheet" href="style.css"/></head><body><header><h1>${projectName}</h1></header><main><p>Ready to build.</p></main><script src="script.js"></script></body></html>` },
              { path: "style.css", content: `*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;min-height:100vh;background:#f8f9fa}header{background:#1a1a2e;color:white;padding:2rem;text-align:center}main{max-width:1200px;margin:2rem auto;padding:0 1rem}` },
              { path: "script.js", content: `document.addEventListener("DOMContentLoaded", () => {\n  console.log("${projectName} loaded");\n});` },
              { path: ".gitignore", content: `node_modules/\n.env\n*.log` },
            ],
          },
        };
        const tmpl = scaffoldTemplates[template];
        if (tmpl) {
          const blobs = [...tmpl.files];
          const pkgJson: any = { name: repoName, version: "1.0.0", description: tmpl.description, scripts: {} };
          if (template === "express-api") {
            pkgJson.scripts = { dev: "nodemon --exec ts-node src/index.ts", build: "tsc", start: "node dist/index.js", test: "jest --passWithNoTests", "test:watch": "jest --watch" };
            tmpl.devDeps += " jest ts-jest @types/jest supertest @types/supertest";
            blobs.push({ path: "src/__tests__/health.test.ts", content: `import { describe, it, expect } from "@jest/globals";\n\ndescribe("Health Check", () => {\n  it("should return status ok", async () => {\n    const res = await fetch("http://localhost:3000/api/health");\n    const data = await res.json();\n    expect(data.status).toBe("ok");\n    expect(data.timestamp).toBeDefined();\n  });\n});\n` });
            blobs.push({ path: "jest.config.js", content: `module.exports = {\n  preset: "ts-jest",\n  testEnvironment: "node",\n  roots: ["<rootDir>/src"],\n  testMatch: ["**/__tests__/**/*.test.ts"],\n};\n` });
          }
          else if (template === "react-vite") {
            pkgJson.scripts = { dev: "vite", build: "vite build", preview: "vite preview", test: "vitest run", "test:watch": "vitest" };
            tmpl.devDeps += " vitest @testing-library/react @testing-library/jest-dom jsdom";
            blobs.push({ path: "src/__tests__/App.test.tsx", content: `import { describe, it, expect } from "vitest";\nimport { render, screen } from "@testing-library/react";\nimport App from "../App";\n\ndescribe("App", () => {\n  it("renders without crashing", () => {\n    render(<App />);\n    expect(document.querySelector(".app")).toBeTruthy();\n  });\n});\n` });
            blobs.push({ path: "vitest.config.ts", content: `import { defineConfig } from "vitest/config";\nimport react from "@vitejs/plugin-react";\n\nexport default defineConfig({\n  plugins: [react()],\n  test: {\n    environment: "jsdom",\n    globals: true,\n  },\n});\n` });
          }
          else if (template === "fullstack") {
            pkgJson.scripts = { dev: "concurrently \"nodemon --exec ts-node server/index.ts\" \"cd client && vite\"", build: "tsc && cd client && vite build", start: "node dist/index.js", test: "jest --passWithNoTests", "test:watch": "jest --watch" };
            tmpl.devDeps += " jest ts-jest @types/jest supertest @types/supertest";
            blobs.push({ path: "server/__tests__/health.test.ts", content: `import { describe, it, expect } from "@jest/globals";\n\ndescribe("API Health", () => {\n  it("should return status ok", async () => {\n    const res = await fetch("http://localhost:3000/api/health");\n    const data = await res.json();\n    expect(data.status).toBe("ok");\n  });\n});\n` });
            blobs.push({ path: "jest.config.js", content: `module.exports = {\n  preset: "ts-jest",\n  testEnvironment: "node",\n  roots: ["<rootDir>/server"],\n  testMatch: ["**/__tests__/**/*.test.ts"],\n};\n` });
          }
          else if (template === "nextjs") {
            pkgJson.scripts = { dev: "next dev", build: "next build", start: "next start -p $PORT", test: "jest --passWithNoTests" };
            tmpl.devDeps += " jest @testing-library/react @testing-library/jest-dom jest-environment-jsdom";
            blobs.push({ path: "app/__tests__/page.test.tsx", content: `import { render } from "@testing-library/react";\nimport Home from "../page";\n\ndescribe("Home", () => {\n  it("renders without crashing", () => {\n    const { container } = render(<Home />);\n    expect(container.querySelector("main")).toBeTruthy();\n  });\n});\n` });
          }
          if (tmpl.deps) {
            pkgJson.dependencies = {};
            tmpl.deps.split(" ").filter(Boolean).forEach((d: string) => { pkgJson.dependencies[d] = "latest"; });
          }
          if (tmpl.devDeps) {
            pkgJson.devDependencies = {};
            tmpl.devDeps.split(" ").filter(Boolean).forEach((d: string) => { pkgJson.devDependencies[d] = "latest"; });
          }
          if (Object.keys(pkgJson.scripts).length > 0 || tmpl.deps || tmpl.devDeps) {
            blobs.push({ path: "package.json", content: JSON.stringify(pkgJson, null, 2) });
          }
          blobs.push({ path: "README.md", content: `# ${projectName}\n\n${tmpl.description}\n\nManaged by MaxAI / DevMax.\n\n## Setup\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n` });
          await new Promise(resolve => setTimeout(resolve, 2000));
          await runWithToken(() => applyPatch(repoOwner, repoName, "main", blobs, `scaffold: ${template} project structure`));
          logs.push(`Template "${template}" applied: ${blobs.length} files created`);
          console.log(`[DevMax] Template "${template}" applied to ${repoOwner}/${repoName}: ${blobs.map(b => b.path).join(", ")}`);
        }
      } catch (tmplErr: any) {
        console.error(`[DevMax] Template apply failed:`, tmplErr.message);
        logs.push(`Template apply warning: ${tmplErr.message?.substring(0, 200)}`);
      }
    }

    const stagingRepoName = `${repoName}-test`;
    const existingStaging = await runWithToken(() => githubService.getRepo(repoOwner, stagingRepoName)).catch(() => null);
    if (!existingStaging) {
      console.log(`[DevMax] Creating staging repo: ${repoOwner}/${stagingRepoName}`);
      await runWithToken(() => githubService.createRepo(stagingRepoName, {
        description: `Staging clone of ${repoName} — auto-managed by Ulysse AI`,
        isPrivate: true,
        autoInit: false,
      }));
      logs.push(`Staging repo created: ${repoOwner}/${stagingRepoName}`);
    } else {
      logs.push(`Staging repo exists: ${repoOwner}/${stagingRepoName}`);
    }

    const { sshService } = await import("../services/sshService");

    const ghToken = projectGhToken || await sshService.resolveGitHubToken();
    if (ghToken) {
      const mirrorResult = await sshService.executeCommand(
        `cd /tmp && rm -rf _staging_mirror_${slug} && ` +
        `git clone --mirror https://x-access-token:${ghToken}@github.com/${repoOwner}/${repoName}.git _staging_mirror_${slug} 2>&1 && ` +
        `cd _staging_mirror_${slug} && ` +
        `git remote set-url --push origin https://x-access-token:${ghToken}@github.com/${repoOwner}/${stagingRepoName}.git && ` +
        `git push --mirror 2>&1 && ` +
        `cd /tmp && rm -rf _staging_mirror_${slug}`,
        120000
      );
      logs.push(mirrorResult.success ? `Code mirrored to staging repo` : `Mirror warning: ${mirrorResult.error?.substring(0, 200)}`);
    }

    const reserved = await sshService.reserveProjectPorts(projectId, "max");
    console.log(`[DevMax] Deploying staging: ${slug}.dev.ulyssepro.org (port ${reserved.stagingPort})`);
    const stagingResult = await sshService.deployStagingApp({
      repoUrl: `https://github.com/${repoOwner}/${stagingRepoName}.git`,
      appName: slug,
      branch: "main",
      port: reserved.stagingPort,
      caller: "max",
    });
    logs.push(stagingResult.success ? `Staging deployed: ${stagingResult.stagingUrl} (port ${reserved.stagingPort})` : `Staging deploy: ${stagingResult.message}`);

    if (stagingResult.success) {
      await db.execute(sql`
        UPDATE devmax_projects 
        SET staging_url = ${stagingResult.stagingUrl || null}, 
            staging_port = ${reserved.stagingPort},
            environment = 'staging',
            last_deployed_at = NOW(),
            updated_at = NOW()
        WHERE id = ${projectId}
      `);

      console.log(`[DevMax] Promoting to production: ${slug}.ulyssepro.org (port ${reserved.productionPort})`);
      const prodResult = await sshService.promoteToProduction({
        appName: slug,
        port: reserved.productionPort,
        caller: "max",
      });
      logs.push(prodResult.success ? `Production deployed: ${prodResult.productionUrl} (port ${reserved.productionPort})` : `Production: ${prodResult.message}`);

      if (prodResult.success) {
        sshService.removePlaceholderPages(slug).catch(() => {});
        await db.execute(sql`
          UPDATE devmax_projects 
          SET production_url = ${prodResult.productionUrl || null},
              deploy_url = ${prodResult.productionUrl || null},
              production_port = ${reserved.productionPort},
              environment = 'production',
              last_promoted_at = NOW(),
              updated_at = NOW()
          WHERE id = ${projectId}
        `);
      }
    }

    console.log(`[DevMax] Auto-deploy complete for ${projectName}. Running URL diagnostics...`);

    const stagingDomain = `${slug}.dev.ulyssepro.org`;
    const prodDomain = `${slug}.ulyssepro.org`;
    const repoUrl = `https://github.com/${repoOwner}/${repoName}.git`;

    try {
      const stagingDiag = await sshService.diagnoseAndFixUrl({
        domain: stagingDomain, appName: slug, autoFix: true, repoUrl, caller: "max",
      });
      logs.push(`Staging diagnosis: ${stagingDiag.finalStatus}`);
      if (stagingDiag.fixes.length > 0) logs.push(`Staging fixes: ${stagingDiag.fixes.join(", ")}`);
      console.log(`[DevMax] Staging URL diag: HTTP ${stagingDiag.httpCode}, issues=${stagingDiag.issues.length}, fixes=${stagingDiag.fixes.length}`);
    } catch (diagErr: any) {
      logs.push(`Staging diagnosis error: ${diagErr.message}`);
    }

    try {
      const prodDiag = await sshService.diagnoseAndFixUrl({
        domain: prodDomain, appName: slug, autoFix: true, repoUrl, caller: "max",
      });
      logs.push(`Production diagnosis: ${prodDiag.finalStatus}`);
      if (prodDiag.fixes.length > 0) logs.push(`Production fixes: ${prodDiag.fixes.join(", ")}`);
      console.log(`[DevMax] Production URL diag: HTTP ${prodDiag.httpCode}, issues=${prodDiag.issues.length}, fixes=${prodDiag.fixes.length}`);
    } catch (diagErr: any) {
      logs.push(`Production diagnosis error: ${diagErr.message}`);
    }

    console.log(`[DevMax] Auto-deploy + diagnostics complete for ${projectName}:`, logs.join(" | "));
    await db.execute(sql`
      INSERT INTO devmax_activity_log (session_id, action, target, details, created_at) 
      VALUES (${'system'}, ${'auto_deploy'}, ${projectName}, ${JSON.stringify({ logs, projectId, slug })}, NOW())
    `);
  } catch (err: any) {
    console.error(`[DevMax] Auto-deploy error for ${projectName}:`, err.message);
    logs.push(`Error: ${err.message}`);
  }
}

router.put("/projects/:projectId", async (req: Request, res: Response) => {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const [session] = await db.select().from(devmaxSessions)
      .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
      .limit(1);
    if (!session) return res.status(401).json({ error: "Session expired" });

    const { projectId } = req.params;
    const project = await db.execute(sql`
      SELECT * FROM devmax_projects WHERE id = ${projectId}
    `);
    if (!project.rows?.length) return res.status(404).json({ error: "Projet non trouve" });

    const { name, description, repoOwner, repoName, deploySlug } = req.body;
    const repoUrl = repoOwner && repoName ? `https://github.com/${repoOwner}/${repoName}` : null;
    const slug = deploySlug ? deploySlug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") : null;

    await db.execute(sql`
      UPDATE devmax_projects SET
        name = COALESCE(${name || null}, name),
        description = ${description ?? null},
        repo_owner = ${repoOwner || null},
        repo_name = ${repoName || null},
        repo_url = ${repoUrl},
        deploy_slug = COALESCE(${slug}, deploy_slug),
        updated_at = NOW()
      WHERE id = ${projectId}
    `);

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/projects/:projectId", async (req: Request, res: Response) => {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const [session] = await db.select().from(devmaxSessions)
      .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
      .limit(1);
    if (!session) return res.status(401).json({ error: "Session expired" });

    const { projectId } = req.params;

    const [project] = await db.execute(sql`SELECT deploy_slug FROM devmax_projects WHERE id = ${projectId}`).then((r: any) => r.rows || r);
    const slug = project?.deploy_slug;

    const cleanupLogs: string[] = [];

    if (slug) {
      try {
        const { sshService } = await import("../services/sshService");
        const prodResult = await sshService.apps.deleteApp(slug);
        cleanupLogs.push(`Prod app cleanup: ${prodResult}`);
      } catch (e: any) {
        cleanupLogs.push(`Prod app cleanup error: ${e.message}`);
      }

      try {
        const { sshService } = await import("../services/sshService");
        const stagingResult = await sshService.apps.deleteApp(`${slug}-dev`);
        cleanupLogs.push(`Staging app cleanup: ${stagingResult}`);
      } catch (e: any) {
        cleanupLogs.push(`Staging app cleanup error: ${e.message}`);
      }

      try {
        const cloudflareService = await import("../services/cloudflareService").then(m => m.default || m);
        const dnsResult = await cloudflareService.removeDnsRecords(slug);
        cleanupLogs.push(`DNS cleanup: removed ${dnsResult.removed.length} records (${dnsResult.removed.join(", ")})`);
      } catch (e: any) {
        cleanupLogs.push(`DNS cleanup error: ${e.message}`);
      }
    }

    await db.execute(sql`DELETE FROM devmax_deployments WHERE project_id = ${projectId}`).catch(() => {});
    await db.execute(sql`DELETE FROM devmax_env_vars WHERE project_id = ${projectId}`).catch(() => {});
    await db.execute(sql`DELETE FROM devmax_secrets WHERE project_id = ${projectId}`).catch(() => {});
    await db.execute(sql`DELETE FROM devmax_custom_domains WHERE project_id = ${projectId}`).catch(() => {});
    await db.execute(sql`DELETE FROM devmax_logs WHERE project_id = ${projectId}`).catch(() => {});
    await db.execute(sql`DELETE FROM devmax_metrics WHERE project_id = ${projectId}`).catch(() => {});
    await db.execute(sql`DELETE FROM devmax_github_events WHERE project_id = ${projectId}`).catch(() => {});

    await db.execute(sql`DELETE FROM devmax_projects WHERE id = ${projectId}`);

    console.log(`[DevMax] Project ${slug || projectId} deleted. Cleanup: ${cleanupLogs.join(" | ")}`);
    await logDevmaxActivity(req, "delete_project", projectId, { slug, cleanup: cleanupLogs });
    res.json({ success: true, cleanup: cleanupLogs });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/projects/:projectId", async (req: Request, res: Response) => {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const [session] = await db.select().from(devmaxSessions)
      .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
      .limit(1);
    if (!session) return res.status(401).json({ error: "Session expired" });

    const project = await db.execute(sql`
      SELECT * FROM devmax_projects WHERE id = ${req.params.projectId} AND fingerprint = ${session.fingerprint}
    `);
    if (!project.rows?.length) return res.status(404).json({ error: "Projet non trouve" });

    res.json(project.rows[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/github/oauth/start", async (req: Request, res: Response) => {
  const token = req.headers["x-devmax-token"] as string || req.query.token as string;
  const projectId = req.query.projectId as string;
  if (!token || !projectId) return res.status(400).json({ error: "Token et projectId requis" });

  try {
    const [session] = await db.select().from(devmaxSessions)
      .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
      .limit(1);
    if (!session) return res.status(401).json({ error: "Session expired" });

    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
    if (!clientId) return res.status(500).json({ error: "GitHub OAuth App non configuree. Definir GITHUB_OAUTH_CLIENT_ID." });

    const state = Buffer.from(JSON.stringify({ projectId, sessionId: token, ts: Date.now() })).toString("base64url");
    const scopes = "repo,read:user,read:org";
    const redirectUri = `${req.protocol}://${req.get("host")}/api/devmax/github/oauth/callback`;
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&state=${state}`;

    res.json({ authUrl, state });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/github/oauth/callback", async (req: Request, res: Response) => {
  const { code, state } = req.query as { code: string; state: string };
  if (!code || !state) return res.status(400).send("Missing code or state");

  try {
    const stateData = JSON.parse(Buffer.from(state, "base64url").toString());
    const { projectId, sessionId } = stateData;

    const [session] = await db.select().from(devmaxSessions)
      .where(and(eq(devmaxSessions.id, sessionId), gt(devmaxSessions.expiresAt, new Date())))
      .limit(1);
    if (!session) return res.status(401).send("Session expired");

    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) return res.status(500).send("OAuth not configured");

    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const tokenData = await tokenRes.json() as any;
    if (tokenData.error) return res.status(400).send(`OAuth error: ${tokenData.error_description || tokenData.error}`);

    const accessToken = tokenData.access_token;
    const scopes = tokenData.scope || "";

    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" },
    });
    const userData = await userRes.json() as any;
    const githubUser = userData.login || "unknown";

    await db.execute(sql`
      UPDATE devmax_projects 
      SET github_token = ${accessToken},
          github_provider = 'oauth',
          github_user = ${githubUser},
          github_scopes = ${scopes},
          github_connected_at = NOW(),
          updated_at = NOW()
      WHERE id = ${projectId}
    `);

    console.log(`[DevMax] GitHub OAuth connected for project ${projectId}: user=${githubUser}, scopes=${scopes}`);

    res.send(`
      <html><body style="background:#18181b;color:white;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
        <div style="text-align:center">
          <h2 style="color:#10b981">GitHub connecte</h2>
          <p>Compte: <strong>${githubUser}</strong></p>
          <p style="color:#71717a">Vous pouvez fermer cette fenetre</p>
          <script>setTimeout(() => window.close(), 2000);</script>
        </div>
      </body></html>
    `);
  } catch (e: any) {
    console.error("[DevMax] OAuth callback error:", e.message);
    res.status(500).send(`OAuth error: ${e.message}`);
  }
});

router.post("/github/pat", async (req: Request, res: Response) => {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const [session] = await db.select().from(devmaxSessions)
      .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
      .limit(1);
    if (!session) return res.status(401).json({ error: "Session expired" });

    const { projectId, pat } = req.body;
    if (!projectId || !pat) return res.status(400).json({ error: "projectId et pat requis" });

    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json" },
    });
    if (!userRes.ok) return res.status(400).json({ error: "Token invalide — verification GitHub echouee" });
    const userData = await userRes.json() as any;
    const githubUser = userData.login || "unknown";

    const scopeHeader = userRes.headers.get("x-oauth-scopes") || "";

    await db.execute(sql`
      UPDATE devmax_projects 
      SET github_token = ${pat},
          github_provider = 'pat',
          github_user = ${githubUser},
          github_scopes = ${scopeHeader},
          github_connected_at = NOW(),
          updated_at = NOW()
      WHERE id = ${projectId}
    `);

    await logDevmaxActivity(req, "github_pat_connected", projectId, { githubUser });
    console.log(`[DevMax] GitHub PAT connected for project ${projectId}: user=${githubUser}`);

    res.json({ success: true, githubUser, scopes: scopeHeader });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/github/disconnect/:projectId", async (req: Request, res: Response) => {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const [session] = await db.select().from(devmaxSessions)
      .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
      .limit(1);
    if (!session) return res.status(401).json({ error: "Session expired" });

    const { projectId } = req.params;
    await db.execute(sql`
      UPDATE devmax_projects 
      SET github_token = NULL,
          github_provider = 'owner',
          github_user = NULL,
          github_scopes = NULL,
          github_connected_at = NULL,
          updated_at = NOW()
      WHERE id = ${projectId}
    `);

    await logDevmaxActivity(req, "github_disconnected", projectId);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/github/status/:projectId", async (req: Request, res: Response) => {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const [session] = await db.select().from(devmaxSessions)
      .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
      .limit(1);
    if (!session) return res.status(401).json({ error: "Session expired" });

    const { projectId } = req.params;
    const [project] = await db.execute(sql`
      SELECT github_provider, github_user, github_scopes, github_connected_at, github_token IS NOT NULL as has_token
      FROM devmax_projects WHERE id = ${projectId}
    `).then((r: any) => r.rows || r);

    if (!project) return res.status(404).json({ error: "Project not found" });

    const result: any = {
      provider: project.github_provider || "owner",
      user: project.github_user || null,
      scopes: project.github_scopes || null,
      connectedAt: project.github_connected_at || null,
      hasToken: !!project.has_token,
    };

    if (result.hasToken && project.github_provider !== "owner") {
      try {
        const ghToken = await getProjectGitHubToken(projectId);
        const checkRes = await fetch("https://api.github.com/user", {
          headers: { Authorization: `Bearer ${ghToken}`, Accept: "application/vnd.github+json" },
        });
        result.tokenValid = checkRes.ok;
        if (checkRes.ok) {
          const d = await checkRes.json() as any;
          result.user = d.login;
        }
      } catch {
        result.tokenValid = false;
      }
    } else {
      result.tokenValid = result.provider === "owner";
    }

    const hasOAuthConfig = !!(process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET);
    result.oauthAvailable = hasOAuthConfig;

    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

async function verifyProjectAccess(session: any, projectId: string): Promise<boolean> {
  if (!session.tenantId) return true;
  if (!projectId) return true;
  const result = await db.execute(sql`SELECT tenant_id FROM devmax_projects WHERE id = ${projectId}`).then((r: any) => r.rows || r);
  if (!result.length) return false;
  return !result[0].tenant_id || result[0].tenant_id === session.tenantId;
}

router.post("/chat/save", async (req: Request, res: Response) => {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const [session] = await db.select().from(devmaxSessions)
      .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
      .limit(1);
    if (!session) return res.status(401).json({ error: "Session expired" });

    const { projectId, threadId, role, content, toolCalls, metadata } = req.body;
    if (!role || !content) return res.status(400).json({ error: "role et content requis" });
    if (projectId && !(await verifyProjectAccess(session, projectId))) return res.status(403).json({ error: "Accès refusé à ce projet" });

    const truncContent = content.length > 50000 ? content.substring(0, 50000) : content;

    await db.execute(sql`
      INSERT INTO devmax_chat_history (project_id, session_id, thread_id, role, content, tool_calls, metadata)
      VALUES (${projectId || null}, ${token}, ${threadId || null}, ${role}, ${truncContent}, 
        ${toolCalls ? JSON.stringify(toolCalls) : null}::jsonb, 
        ${metadata ? JSON.stringify(metadata) : null}::jsonb)
    `);

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/chat/history/:projectId", async (req: Request, res: Response) => {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const [session] = await db.select().from(devmaxSessions)
      .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
      .limit(1);
    if (!session) return res.status(401).json({ error: "Session expired" });

    const { projectId } = req.params;
    if (!(await verifyProjectAccess(session, projectId))) return res.status(403).json({ error: "Accès refusé à ce projet" });
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = parseInt(req.query.offset as string) || 0;

    const rows = await db.execute(sql`
      SELECT id, project_id, thread_id, role, content, tool_calls, metadata, created_at
      FROM devmax_chat_history 
      WHERE project_id = ${projectId}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `).then((r: any) => r.rows || r);

    const total = await db.execute(sql`
      SELECT COUNT(*) as count FROM devmax_chat_history WHERE project_id = ${projectId}
    `).then((r: any) => {
      const rows = r.rows || r;
      return parseInt(rows[0]?.count || "0", 10);
    });

    res.json({ messages: rows.reverse(), total, limit, offset });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/chat/threads/:projectId", async (req: Request, res: Response) => {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const [session] = await db.select().from(devmaxSessions)
      .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
      .limit(1);
    if (!session) return res.status(401).json({ error: "Session expired" });

    const { projectId } = req.params;
    if (!(await verifyProjectAccess(session, projectId))) return res.status(403).json({ error: "Accès refusé à ce projet" });
    const rows = await db.execute(sql`
      SELECT thread_id, 
             MIN(created_at) as started_at, 
             MAX(created_at) as last_message_at,
             COUNT(*) as message_count,
             (SELECT content FROM devmax_chat_history c2 WHERE c2.thread_id = c.thread_id AND c2.project_id = ${projectId} AND c2.role = 'user' ORDER BY c2.created_at ASC LIMIT 1) as first_message
      FROM devmax_chat_history c
      WHERE project_id = ${projectId} AND thread_id IS NOT NULL
      GROUP BY thread_id
      ORDER BY last_message_at DESC
      LIMIT 50
    `).then((r: any) => r.rows || r);

    res.json({ threads: rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/journal/add", async (req: Request, res: Response) => {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const [session] = await db.select().from(devmaxSessions)
      .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
      .limit(1);
    if (!session) return res.status(401).json({ error: "Session expired" });

    const { projectId, entryType, title, description, filesChanged, metadata } = req.body;
    if (!projectId || !entryType || !title) return res.status(400).json({ error: "projectId, entryType et title requis" });
    if (!(await verifyProjectAccess(session, projectId))) return res.status(403).json({ error: "Accès refusé à ce projet" });

    const filesArr = Array.isArray(filesChanged) ? filesChanged.map(String) : null;

    await db.execute(sql`
      INSERT INTO devmax_project_journal (project_id, session_id, entry_type, title, description, files_changed, metadata)
      VALUES (${projectId}, ${token}, ${entryType}, ${title}, ${description || null}, 
        ${filesArr}::text[],
        ${metadata ? JSON.stringify(metadata) : null}::jsonb)
    `);

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/journal/:projectId", async (req: Request, res: Response) => {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const [session] = await db.select().from(devmaxSessions)
      .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
      .limit(1);
    if (!session) return res.status(401).json({ error: "Session expired" });

    const { projectId } = req.params;
    if (!(await verifyProjectAccess(session, projectId))) return res.status(403).json({ error: "Accès refusé à ce projet" });
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const entryType = req.query.type as string;

    let rows: any[];
    if (entryType) {
      rows = await db.execute(sql`SELECT * FROM devmax_project_journal WHERE project_id = ${projectId} AND entry_type = ${entryType} ORDER BY created_at DESC LIMIT ${limit}`).then((r: any) => r.rows || r);
    } else {
      rows = await db.execute(sql`SELECT * FROM devmax_project_journal WHERE project_id = ${projectId} ORDER BY created_at DESC LIMIT ${limit}`).then((r: any) => r.rows || r);
    }

    res.json({ entries: rows, total: rows.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

const PLAN_LIMITS: Record<string, { max_projects: number; max_users: number; max_deploys_month: number; max_storage_gb: number; custom_domain: boolean; api_access: boolean }> = {
  free: { max_projects: 3, max_users: 2, max_deploys_month: 10, max_storage_gb: 1, custom_domain: false, api_access: false },
  starter: { max_projects: 10, max_users: 5, max_deploys_month: 50, max_storage_gb: 5, custom_domain: true, api_access: false },
  pro: { max_projects: 50, max_users: 20, max_deploys_month: 500, max_storage_gb: 50, custom_domain: true, api_access: true },
  enterprise: { max_projects: 999, max_users: 999, max_deploys_month: 9999, max_storage_gb: 500, custom_domain: true, api_access: true },
};

export async function checkPlanLimits(tenantId: string | null, action: "deploy" | "create_project" | "add_user" | "custom_domain" | "api_access"): Promise<{ allowed: boolean; reason?: string; plan?: string; usage?: any; limit?: any }> {
  if (!tenantId) return { allowed: true, plan: "owner" };
  try {
    const [tenant] = await db.execute(sql`SELECT plan, plan_limits FROM devmax_tenants WHERE id = ${tenantId}`).then((r: any) => r.rows || r);
    if (!tenant) return { allowed: true };
    const plan = tenant.plan || "free";
    const limits = tenant.plan_limits || PLAN_LIMITS[plan] || PLAN_LIMITS.free;

    if (action === "deploy") {
      if (limits.max_deploys_month === -1) return { allowed: true, plan };
      const [{ count }] = await db.execute(sql`
        SELECT COUNT(*)::int as count FROM devmax_deployments d
        JOIN devmax_projects p ON d.project_id = p.id
        WHERE p.tenant_id = ${tenantId} AND d.created_at > NOW() - INTERVAL '30 days'
      `).then((r: any) => r.rows || r);
      if (count >= limits.max_deploys_month) return { allowed: false, reason: `Limite de ${limits.max_deploys_month} déploiements/mois atteinte (plan ${plan}). Passez au plan supérieur.`, plan, usage: count, limit: limits.max_deploys_month };
    } else if (action === "create_project") {
      if (limits.max_projects === -1) return { allowed: true, plan };
      const [{ count }] = await db.execute(sql`SELECT COUNT(*)::int as count FROM devmax_projects WHERE tenant_id = ${tenantId}`).then((r: any) => r.rows || r);
      if (count >= limits.max_projects) return { allowed: false, reason: `Limite de ${limits.max_projects} projets atteinte (plan ${plan}). Passez au plan supérieur.`, plan, usage: count, limit: limits.max_projects };
    } else if (action === "add_user") {
      if (limits.max_users === -1) return { allowed: true, plan };
      const [{ count }] = await db.execute(sql`SELECT COUNT(*)::int as count FROM devmax_users WHERE tenant_id = ${tenantId} AND active = true`).then((r: any) => r.rows || r);
      if (count >= limits.max_users) return { allowed: false, reason: `Limite de ${limits.max_users} utilisateurs atteinte (plan ${plan}).`, plan, usage: count, limit: limits.max_users };
    } else if (action === "custom_domain") {
      if (!limits.custom_domain) return { allowed: false, reason: `Les domaines personnalisés ne sont pas disponibles avec le plan ${plan}. Passez au plan Starter ou supérieur.`, plan };
    } else if (action === "api_access") {
      if (!limits.api_access) return { allowed: false, reason: `L'accès API n'est pas disponible avec le plan ${plan}. Passez au plan Pro ou supérieur.`, plan };
    }
    return { allowed: true, plan };
  } catch (e: any) {
    console.error("[DevMax] Plan limits check failed:", e.message);
    return { allowed: true };
  }
}

export async function sendDevmaxNotification(params: {
  tenantId?: string | null;
  projectId?: string;
  type: string;
  title: string;
  message: string;
  metadata?: any;
}) {
  try {
    const { tenantId, projectId, type, title, message, metadata } = params;
    await db.execute(sql`
      INSERT INTO devmax_notifications (tenant_id, project_id, type, title, message, channel, metadata, status)
      VALUES (${tenantId || null}, ${projectId || null}, ${type}, ${title}, ${message}, 'in_app', ${JSON.stringify(metadata || {})}, 'sent')
    `).catch(() => {});

    if (tenantId) {
      const [tenant] = await db.execute(sql`SELECT notification_email, notification_webhook, name FROM devmax_tenants WHERE id = ${tenantId}`).then((r: any) => r.rows || r);
      if (tenant?.notification_email) {
        try {
          const { gmailService } = await import("../services/gmailService");
          await gmailService.sendEmail({
            to: tenant.notification_email,
            subject: `[DevMax] ${title}`,
            body: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
              <h2 style="color:#10b981">DevMax</h2>
              <h3>${title}</h3>
              <p>${message}</p>
              <hr style="border:1px solid #e5e7eb;margin:20px 0"/>
              <p style="color:#9ca3af;font-size:12px">Tenant: ${tenant.name} | ${new Date().toLocaleString("fr-FR")}</p>
            </div>`,
            isHtml: true,
          });
          await db.execute(sql`
            INSERT INTO devmax_notifications (tenant_id, project_id, type, title, message, channel, status)
            VALUES (${tenantId}, ${projectId || null}, ${type}, ${title}, ${message}, 'email', 'sent')
          `).catch(() => {});
        } catch (e: any) {
          console.warn("[DevMax] Email notification failed:", e.message);
        }
      }
      if (tenant?.notification_webhook) {
        try {
          await fetch(tenant.notification_webhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type, title, message, projectId, tenantId, metadata, timestamp: new Date().toISOString() }),
          });
          await db.execute(sql`
            INSERT INTO devmax_notifications (tenant_id, project_id, type, title, message, channel, status)
            VALUES (${tenantId}, ${projectId || null}, ${type}, ${title}, ${message}, 'webhook', 'sent')
          `).catch(() => {});
        } catch (e: any) {
          console.warn("[DevMax] Webhook notification failed:", e.message);
        }
      }
    }
  } catch (e: any) {
    console.error("[DevMax] Notification error:", e.message);
  }
}

export async function getProjectGitHubToken(projectId: string): Promise<string | null> {
  try {
    const [project] = await db.execute(sql`
      SELECT github_token, github_provider, tenant_id, repo_owner FROM devmax_projects WHERE id = ${projectId}
    `).then((r: any) => r.rows || r);
    if (project?.github_token) return project.github_token;
    if (project?.tenant_id) {
      const [tenant] = await db.execute(sql`
        SELECT github_token FROM devmax_tenants WHERE id = ${project.tenant_id} AND github_token IS NOT NULL
      `).then((r: any) => r.rows || r);
      if (tenant?.github_token) return tenant.github_token;
    }
    if (project?.repo_owner) {
      const tenantRows = await db.execute(sql`
        SELECT github_token FROM devmax_tenants WHERE github_org = ${project.repo_owner} AND github_token IS NOT NULL LIMIT 1
      `).then((r: any) => r.rows || r);
      if (tenantRows?.[0]?.github_token) return tenantRows[0].github_token;
    }
  } catch {}
  if (process.env.MAURICE_GITHUB_PAT) return process.env.MAURICE_GITHUB_PAT;
  return null;
}

export function requireDevmaxAuth(req: Request, res: Response, next: any) {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return res.status(401).json({ error: "DevMax authentication required" });
  
  db.select().from(devmaxSessions)
    .where(and(eq(devmaxSessions.id, token), gt(devmaxSessions.expiresAt, new Date())))
    .limit(1)
    .then(([session]) => {
      if (!session) return res.status(401).json({ error: "Session expired" });
      (req as any).devmaxSession = session;
      db.update(devmaxSessions)
        .set({ lastActiveAt: new Date() })
        .where(eq(devmaxSessions.id, token))
        .catch(() => {});
      next();
    })
    .catch(() => res.status(500).json({ error: "Auth error" }));
}

export async function logDevmaxActivity(req: Request, action: string, target?: string, details?: any) {
  const token = req.headers["x-devmax-token"] as string;
  if (!token) return;
  await db.insert(devmaxActivityLog).values({
    sessionId: token,
    action,
    target,
    details,
  }).catch(() => {});
}

const ADMIN_PIN = process.env.DEVMAX_ADMIN_PIN || "123adminMDBH";

function requireAdminAuth(req: Request, res: Response, next: any) {
  const adminToken = req.headers["x-devmax-admin"] as string;
  if (!adminToken) return res.status(401).json({ error: "Admin auth required" });
  db.execute(sql`SELECT id FROM devmax_sessions WHERE id = ${adminToken} AND expires_at > NOW()`)
    .then((r: any) => {
      const rows = r.rows || r;
      if (!rows.length) return res.status(401).json({ error: "Admin session expired" });
      next();
    })
    .catch(() => res.status(500).json({ error: "Auth error" }));
}

router.post("/admin/auth", async (req: Request, res: Response) => {
  const { pin } = req.body;
  if (pin !== ADMIN_PIN) return res.status(401).json({ error: "Invalid admin PIN" });

  const id = randomUUID();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
  await db.execute(sql`
    INSERT INTO devmax_sessions (id, fingerprint, display_name, expires_at, ip_address, user_agent)
    VALUES (${id}, ${'master-admin'}, ${'Master Admin'}, ${expiresAt}, ${req.ip || null}, ${req.headers["user-agent"] || null})
  `);
  res.json({ sessionId: id });
});

router.get("/admin/users", requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const users = await db.execute(sql`
      SELECT u.*, 
        (SELECT COUNT(*) FROM devmax_projects WHERE fingerprint = u.fingerprint) as project_count,
        (SELECT COUNT(*) FROM devmax_sessions WHERE fingerprint = u.fingerprint AND expires_at > NOW()) as active_sessions
      FROM devmax_users u ORDER BY u.created_at DESC
    `).then((r: any) => r.rows || r);

    const fingerprints = await db.execute(sql`
      SELECT DISTINCT fingerprint, 
        MAX(last_active_at) as last_active,
        COUNT(*) as session_count
      FROM devmax_sessions 
      GROUP BY fingerprint
      ORDER BY MAX(last_active_at) DESC
    `).then((r: any) => r.rows || r);

    res.json({ users, fingerprints });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/users", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { username, displayName, firstName, lastName, email, pin, loginId, password, role, fingerprint } = req.body;
    if (!username) return res.status(400).json({ error: "username requis" });
    if (!pin || pin.length < 4) return res.status(400).json({ error: "PIN requis (min 4 chiffres)" });

    const id = randomUUID();
    const fp = fingerprint || randomUUID();
    const userRole = role || "user";
    const pinHash = await hashPin(pin);
    const passwordHash = password ? await hashPassword(password) : null;

    await db.execute(sql`
      INSERT INTO devmax_users (id, fingerprint, username, display_name, first_name, last_name, email, login_id, pin_hash, password_hash, role)
      VALUES (${id}, ${fp}, ${username}, ${displayName || `${firstName || ''} ${lastName || ''}`.trim() || username}, ${firstName || null}, ${lastName || null}, ${email || null}, ${loginId || null}, ${pinHash}, ${passwordHash}, ${userRole})
    `);

    await logAdminAudit(req, "user_created", "user", id, null, { username, role: userRole });
    res.json({ id, fingerprint: fp, username, displayName: displayName || username, role: userRole, loginId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/admin/users/:userId", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { username, displayName, firstName, lastName, email, pin, loginId, password, role, active, unlock } = req.body;
    const safeStr = (v: string) => v.replace(/'/g, "''");

    const updates: string[] = [];
    if (username !== undefined) updates.push(`username = '${safeStr(username)}'`);
    if (displayName !== undefined) updates.push(`display_name = '${safeStr(displayName)}'`);
    if (firstName !== undefined) updates.push(`first_name = '${safeStr(firstName)}'`);
    if (lastName !== undefined) updates.push(`last_name = '${safeStr(lastName)}'`);
    if (email !== undefined) updates.push(`email = '${safeStr(email)}'`);
    if (loginId !== undefined) updates.push(`login_id = '${safeStr(loginId)}'`);
    if (pin !== undefined) {
      const pinHash = await hashPin(pin);
      updates.push(`pin_hash = '${pinHash}'`);
      updates.push(`pin = NULL`);
    }
    if (password !== undefined) {
      const passHash = await hashPassword(password);
      updates.push(`password_hash = '${safeStr(passHash)}'`);
    }
    if (role !== undefined) updates.push(`role = '${safeStr(role)}'`);
    if (active !== undefined) updates.push(`active = ${active}`);
    if (unlock) {
      updates.push(`failed_attempts = 0`);
      updates.push(`locked_until = NULL`);
    }
    updates.push(`updated_at = NOW()`);

    await db.execute(sql.raw(`UPDATE devmax_users SET ${updates.join(", ")} WHERE id = '${safeStr(userId)}'`));
    await logAdminAudit(req, "user_updated", "user", userId, null, { fields: Object.keys(req.body) });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/admin/users/:userId", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    await db.execute(sql`DELETE FROM devmax_users WHERE id = ${req.params.userId}`);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/admin/projects", requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const projects = await db.execute(sql`
      SELECT p.*, 
        u.username as owner_username, u.display_name as owner_display_name,
        (SELECT COUNT(*) FROM devmax_chat_history WHERE project_id = p.id) as chat_count,
        (SELECT COUNT(*) FROM devmax_project_journal WHERE project_id = p.id) as journal_count
      FROM devmax_projects p
      LEFT JOIN devmax_users u ON p.fingerprint = u.fingerprint
      ORDER BY p.updated_at DESC
    `).then((r: any) => r.rows || r);
    res.json(projects);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/admin/projects/:projectId/detail", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const [project] = await db.execute(sql`SELECT * FROM devmax_projects WHERE id = ${projectId}`).then((r: any) => r.rows || r);
    if (!project) return res.status(404).json({ error: "Projet non trouvé" });

    const recentChat = await db.execute(sql`
      SELECT role, content, created_at FROM devmax_chat_history 
      WHERE project_id = ${projectId} ORDER BY created_at DESC LIMIT 20
    `).then((r: any) => r.rows || r);

    const journal = await db.execute(sql`
      SELECT * FROM devmax_project_journal 
      WHERE project_id = ${projectId} ORDER BY created_at DESC LIMIT 20
    `).then((r: any) => r.rows || r);

    const activity = await db.execute(sql`
      SELECT * FROM devmax_activity_log 
      WHERE details::text LIKE ${`%${projectId}%`} 
      ORDER BY created_at DESC LIMIT 20
    `).then((r: any) => r.rows || r);

    res.json({ project, recentChat: recentChat.reverse(), journal, activity });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/admin/activity", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const activity = await db.execute(sql`
      SELECT a.*, s.fingerprint, s.display_name 
      FROM devmax_activity_log a 
      LEFT JOIN devmax_sessions s ON a.session_id = s.id
      ORDER BY a.created_at DESC 
      LIMIT ${limit}
    `).then((r: any) => r.rows || r);
    res.json(activity);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/admin/stats", requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const stats = await db.execute(sql`
      SELECT 
        (SELECT COUNT(*) FROM devmax_users) as total_users,
        (SELECT COUNT(*) FROM devmax_users WHERE active = true) as active_users,
        (SELECT COUNT(*) FROM devmax_projects) as total_projects,
        (SELECT COUNT(*) FROM devmax_sessions WHERE expires_at > NOW()) as active_sessions,
        (SELECT COUNT(*) FROM devmax_chat_history) as total_messages,
        (SELECT COUNT(*) FROM devmax_project_journal) as total_journal_entries,
        (SELECT COUNT(*) FROM devmax_activity_log WHERE created_at > NOW() - INTERVAL '24 hours') as activity_24h,
        (SELECT COUNT(DISTINCT fingerprint) FROM devmax_sessions WHERE last_active_at > NOW() - INTERVAL '7 days') as users_7d
    `).then((r: any) => (r.rows || r)[0]);
    res.json(stats);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/admin/deployed-apps", requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const projects = await devmaxStorage.getDeployedProjects();
    res.json(projects);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/tenants", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { name, slug, ownerId, plan, billingEmail, trialMonths,
      productionUrl, stagingUrl, githubOrg, githubRepo, githubToken,
      contactName, contactEmail, contactPhone, address,
      stripeCustomerId, paymentMethod } = req.body;
    if (!name || !slug) return res.status(400).json({ error: "name et slug requis" });

    const existing = await db.execute(sql`SELECT id FROM devmax_tenants WHERE slug = ${slug}`).then((r: any) => (r.rows || r));
    if (existing.length) return res.status(409).json({ error: "Ce slug existe deja" });

    const id = randomUUID();
    const planLimits = getPlanLimits(plan || "free");
    const trialEnd = trialMonths ? new Date(Date.now() + trialMonths * 30 * 86400000) : null;

    const credLogin = `${slug}-devmax`;
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let credPassPlain = "D-";
    for (let i = 0; i < 12; i++) credPassPlain += chars[Math.floor(Math.random() * chars.length)];
    const credPassHash = await hashPassword(credPassPlain);

    await db.execute(sql`
      INSERT INTO devmax_tenants (id, name, slug, owner_id, plan, plan_limits, billing_email, trial_ends_at,
        production_url, staging_url, github_org, github_repo, github_token,
        contact_name, contact_email, contact_phone, address,
        stripe_customer_id, payment_method, credential_login, credential_password)
      VALUES (${id}, ${name}, ${slug}, ${ownerId || null}, ${plan || "free"}, ${JSON.stringify(planLimits)}, ${billingEmail || null}, ${trialEnd},
        ${productionUrl || null}, ${stagingUrl || null}, ${githubOrg || null}, ${githubRepo || null}, ${githubToken || null},
        ${contactName || null}, ${contactEmail || null}, ${contactPhone || null}, ${address || null},
        ${stripeCustomerId || null}, ${paymentMethod || "none"}, ${credLogin}, ${credPassHash})
    `);

    if (ownerId) {
      await db.execute(sql`UPDATE devmax_users SET tenant_id = ${id} WHERE id = ${ownerId}`);
    }

    await logAdminAudit(req, "tenant_created", "tenant", id, null, { name, slug, plan: plan || "free" });
    res.json({ id, name, slug, plan: plan || "free", credentials: { login: credLogin, password: credPassPlain } });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/admin/tenants", requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const tenants = await db.execute(sql`
      SELECT t.*,
        u.username as owner_username, u.display_name as owner_display_name,
        (SELECT COUNT(*) FROM devmax_users WHERE tenant_id = t.id AND active = true) as member_count,
        (SELECT COUNT(*) FROM devmax_projects WHERE tenant_id = t.id) as project_count,
        (SELECT COUNT(*) FROM devmax_usage_logs WHERE tenant_id = t.id AND created_at > NOW() - INTERVAL '30 days') as usage_30d
      FROM devmax_tenants t
      LEFT JOIN devmax_users u ON t.owner_id = u.id
      ORDER BY t.created_at DESC
    `).then((r: any) => r.rows || r);
    res.json(tenants);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/admin/tenants/:tenantId", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    const [tenant] = await db.execute(sql`
      SELECT t.*, u.username as owner_username, u.display_name as owner_display_name
      FROM devmax_tenants t LEFT JOIN devmax_users u ON t.owner_id = u.id WHERE t.id = ${tenantId}
    `).then((r: any) => r.rows || r);
    if (!tenant) return res.status(404).json({ error: "Tenant non trouve" });

    if (!tenant.credential_login || !tenant.credential_password) {
      const credLogin = `${tenant.slug}-devmax`;
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      let credPassPlain = "D-";
      for (let i = 0; i < 12; i++) credPassPlain += chars[Math.floor(Math.random() * chars.length)];
      const credPassHash = await hashPassword(credPassPlain);
      await db.execute(sql`UPDATE devmax_tenants SET credential_login = ${credLogin}, credential_password = ${credPassHash} WHERE id = ${tenantId}`);
      tenant.credential_login = credLogin;
      tenant.credential_password = credPassPlain;
    }

    const members = await db.execute(sql`
      SELECT id, fingerprint, username, display_name, email, active, role, last_login_at, created_at, tenant_id
      FROM devmax_users
      WHERE tenant_id = ${tenantId} ORDER BY created_at
    `).then((r: any) => r.rows || r);

    const projects = await db.execute(sql`
      SELECT id, name, deploy_slug, staging_url, production_url, environment, updated_at
      FROM devmax_projects WHERE tenant_id = ${tenantId} ORDER BY updated_at DESC
    `).then((r: any) => r.rows || r);

    const invitations = await db.execute(sql`
      SELECT * FROM devmax_invitations WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT 20
    `).then((r: any) => r.rows || r);

    const apiKeys = await db.execute(sql`
      SELECT id, name, key_prefix, permissions, last_used_at, expires_at, active, created_at
      FROM devmax_api_keys WHERE tenant_id = ${tenantId} ORDER BY created_at DESC
    `).then((r: any) => r.rows || r);

    const usageStats = await db.execute(sql`
      SELECT action, COUNT(*) as count FROM devmax_usage_logs
      WHERE tenant_id = ${tenantId} AND created_at > NOW() - INTERVAL '30 days'
      GROUP BY action ORDER BY count DESC
    `).then((r: any) => r.rows || r);

    const recentAudit = await db.execute(sql`
      SELECT * FROM devmax_audit_log WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT 30
    `).then((r: any) => r.rows || r);

    const integrations = await db.execute(sql`
      SELECT id, service, status, config, last_sync_at, last_error, enabled, created_at, updated_at
      FROM devmax_integrations WHERE tenant_id = ${tenantId} ORDER BY service
    `).then((r: any) => r.rows || r);

    const safeTenant = { ...tenant };
    if (safeTenant.credential_password) {
      safeTenant.credential_password_masked = "••••••••••••";
      safeTenant.credential_password_is_set = true;
      delete safeTenant.credential_password;
    }

    res.json({ tenant: safeTenant, members, projects, invitations, apiKeys, usageStats, recentAudit, integrations });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/admin/tenants/:tenantId", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    const { name, plan, billingEmail, billingStatus, settings, ownerId,
      productionUrl, stagingUrl, githubOrg, githubRepo, githubToken,
      contactName, contactEmail, contactPhone, address,
      stripeCustomerId, paymentMethod } = req.body;

    const sets: string[] = [];
    if (name) sets.push(`name = '${name.replace(/'/g, "''")}'`);
    if (plan) {
      sets.push(`plan = '${plan}'`);
      sets.push(`plan_limits = '${JSON.stringify(getPlanLimits(plan))}'::jsonb`);
    }
    if (billingEmail !== undefined) sets.push(`billing_email = ${billingEmail ? `'${billingEmail.replace(/'/g, "''")}'` : 'NULL'}`);
    if (billingStatus) sets.push(`billing_status = '${billingStatus}'`);
    if (settings) sets.push(`settings = '${JSON.stringify(settings)}'::jsonb`);
    if (ownerId) sets.push(`owner_id = '${ownerId}'`);
    if (req.body.credentialPassword) {
      const hashedCred = await hashPassword(req.body.credentialPassword);
      sets.push(`credential_password = '${hashedCred.replace(/'/g, "''")}'`);
    }
    const textFields: Array<[string, string | undefined]> = [
      ["production_url", productionUrl], ["staging_url", stagingUrl],
      ["github_org", githubOrg], ["github_repo", githubRepo], ["github_token", githubToken],
      ["contact_name", contactName], ["contact_email", contactEmail], ["contact_phone", contactPhone],
      ["address", address], ["stripe_customer_id", stripeCustomerId], ["payment_method", paymentMethod],
      ["credential_login", req.body.credentialLogin],
    ];
    for (const [col, val] of textFields) {
      if (val !== undefined) sets.push(`${col} = ${val ? `'${val.replace(/'/g, "''")}'` : 'NULL'}`);
    }
    sets.push(`updated_at = NOW()`);

    await db.execute(sql.raw(`UPDATE devmax_tenants SET ${sets.join(", ")} WHERE id = '${tenantId.replace(/'/g, "''")}'`));
    await logAdminAudit(req, "tenant_updated", "tenant", tenantId, null, req.body);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/admin/tenants/:tenantId", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    await db.execute(sql`UPDATE devmax_projects SET tenant_id = NULL WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`UPDATE devmax_users SET tenant_id = NULL WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM devmax_tenants WHERE id = ${tenantId}`);
    await logAdminAudit(req, "tenant_deleted", "tenant", tenantId, null, null);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/tenants/:tenantId/members", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    const { userId, role } = req.body;
    if (!userId) return res.status(400).json({ error: "userId requis" });

    await db.execute(sql`UPDATE devmax_users SET tenant_id = ${tenantId}, role = ${role || 'user'} WHERE id = ${userId}`);
    await logAdminAudit(req, "member_added", "tenant_member", tenantId, null, { userId, role });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/admin/tenants/:tenantId/members/:userId", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = req.params;
    await db.execute(sql`UPDATE devmax_users SET tenant_id = NULL WHERE id = ${userId} AND tenant_id = ${tenantId}`);
    await logAdminAudit(req, "member_removed", "tenant_member", tenantId, null, { userId });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/tenants/:tenantId/assign-project", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    const { projectId } = req.body;
    if (!projectId) return res.status(400).json({ error: "projectId requis" });

    await devmaxStorage.assignProjectToTenant(tenantId, projectId);
    await logAdminAudit(req, "project_assigned", "project", projectId, null, { tenantId });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/invitations", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId, email, role } = req.body;
    if (!tenantId || !email) return res.status(400).json({ error: "tenantId et email requis" });

    const result = await devmaxStorage.createInvitation(tenantId, email, role || "member");
    await logAdminAudit(req, "invitation_sent", "invitation", result.id, null, { email, role, tenantId });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/admin/invitations/:invitationId", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    await devmaxStorage.deleteInvitation(req.params.invitationId);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/api-keys", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId, name, permissions, expiresInDays } = req.body;
    if (!tenantId || !name) return res.status(400).json({ error: "tenantId et name requis" });

    const result = await devmaxStorage.createApiKey(tenantId, name, permissions || ["read"], expiresInDays);
    await logAdminAudit(req, "api_key_created", "api_key", result.id, null, { name, tenantId });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/admin/api-keys/:keyId", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    await devmaxStorage.deleteApiKey(req.params.keyId);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/admin/api-keys/:keyId/toggle", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    await devmaxStorage.toggleApiKey(req.params.keyId);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/admin/audit", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const tenantId = req.query.tenantId as string;
    const audit = await devmaxStorage.getAuditLog({ limit, tenantId });
    res.json(audit);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/admin/usage", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenantId as string;
    const days = parseInt(req.query.days as string) || 30;
    const usage = await devmaxStorage.getUsageStats({ tenantId, days });
    res.json(usage);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/admin/platform-health", requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const health = await devmaxStorage.getPlatformHealth();
    res.json(health);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/admin/scalability-health", requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const { healthMonitor } = await import("../middleware/scalability");
    const health = healthMonitor.getHealth();
    const { pool } = await import("../db");
    const poolStats = {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    };
    const { workerManager } = await import("../middleware/workerManager");
    const { domainIsolation } = await import("../middleware/domainIsolation");
    res.json({
      ...health,
      dbPool: poolStats,
      workers: workerManager.getWorkerStats(),
      workerTasks: workerManager.getActiveTasksList(),
      domains: domainIsolation.getDomainHealth(),
      roadmap: domainIsolation.getRoadmap(),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

function getPlanLimits(plan: string) {
  const plans: Record<string, any> = {
    free: { max_projects: 3, max_users: 2, max_deploys_month: 10, max_storage_gb: 1, custom_domain: false, priority_support: false, api_access: false },
    starter: { max_projects: 10, max_users: 5, max_deploys_month: 50, max_storage_gb: 5, custom_domain: false, priority_support: false, api_access: true },
    pro: { max_projects: 50, max_users: 20, max_deploys_month: 200, max_storage_gb: 25, custom_domain: true, priority_support: true, api_access: true },
    enterprise: { max_projects: -1, max_users: -1, max_deploys_month: -1, max_storage_gb: 100, custom_domain: true, priority_support: true, api_access: true },
  };
  return plans[plan] || plans.free;
}

const INTEGRATION_CATALOG = [
  { service: "gmail", label: "Gmail", icon: "Mail", category: "communication", description: "Envoi et lecture d'emails via Google", fields: ["client_id", "client_secret", "refresh_token"] },
  { service: "notion", label: "Notion", icon: "BookOpen", category: "productivity", description: "Gestion de bases de données et pages Notion", fields: ["api_key", "workspace_id"] },
  { service: "spotify", label: "Spotify", icon: "Music", category: "media", description: "Accès aux playlists et données musicales", fields: ["client_id", "client_secret", "refresh_token"] },
  { service: "discord", label: "Discord", icon: "MessageCircle", category: "communication", description: "Bots et webhooks Discord", fields: ["bot_token", "webhook_url"] },
  { service: "github", label: "GitHub", icon: "Github", category: "development", description: "Accès aux repos, issues, et CI/CD", fields: ["token", "org", "repo"] },
  { service: "google_drive", label: "Google Drive", icon: "HardDrive", category: "storage", description: "Stockage et partage de fichiers", fields: ["client_id", "client_secret", "refresh_token"] },
  { service: "google_calendar", label: "Google Calendar", icon: "Calendar", category: "productivity", description: "Gestion d'événements et calendriers", fields: ["client_id", "client_secret", "refresh_token"] },
  { service: "stripe", label: "Stripe", icon: "CreditCard", category: "payment", description: "Paiements et facturation", fields: ["secret_key", "publishable_key", "webhook_secret"] },
  { service: "todoist", label: "Todoist", icon: "CheckSquare", category: "productivity", description: "Gestion de tâches et projets", fields: ["api_key"] },
  { service: "slack", label: "Slack", icon: "Hash", category: "communication", description: "Messagerie d'équipe et notifications", fields: ["bot_token", "webhook_url"] },
  { service: "openai", label: "OpenAI", icon: "Cpu", category: "ai", description: "Accès aux modèles GPT et DALL-E", fields: ["api_key", "org_id"] },
  { service: "vercel", label: "Vercel", icon: "Triangle", category: "deployment", description: "Déploiement et hébergement", fields: ["token", "team_id"] },
  { service: "supabase", label: "Supabase", icon: "Database", category: "database", description: "Base de données et authentification", fields: ["url", "anon_key", "service_role_key"] },
  { service: "twilio", label: "Twilio", icon: "Phone", category: "communication", description: "SMS et appels téléphoniques", fields: ["account_sid", "auth_token", "phone_number"] },
  { service: "sendgrid", label: "SendGrid", icon: "Send", category: "communication", description: "Envoi d'emails transactionnels", fields: ["api_key"] },
  { service: "aws_s3", label: "AWS S3", icon: "Cloud", category: "storage", description: "Stockage objet cloud Amazon", fields: ["access_key_id", "secret_access_key", "region", "bucket"] },
  { service: "firebase", label: "Firebase", icon: "Flame", category: "database", description: "Base de données temps réel et hosting", fields: ["project_id", "api_key", "service_account_json"] },
  { service: "webhook", label: "Webhook personnalisé", icon: "Link", category: "custom", description: "Intégration via webhook HTTP", fields: ["url", "secret", "method"] },
];

router.get("/admin/integration-catalog", requireAdminAuth, async (_req: Request, res: Response) => {
  res.json({ catalog: INTEGRATION_CATALOG });
});

router.get("/admin/tenants/:tenantId/integrations", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    const integrations = await db.execute(sql`
      SELECT id, tenant_id, service, status, config, last_sync_at, last_error, enabled, created_at, updated_at
      FROM devmax_integrations WHERE tenant_id = ${tenantId} ORDER BY service
    `).then((r: any) => r.rows || r);
    res.json({ integrations });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/tenants/:tenantId/integrations", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    const { service, credentials, config } = req.body;
    if (!service) return res.status(400).json({ error: "Service requis" });

    const catalogEntry = INTEGRATION_CATALOG.find(c => c.service === service);
    if (!catalogEntry) return res.status(400).json({ error: "Service inconnu" });

    const existing = await db.execute(sql`SELECT id FROM devmax_integrations WHERE tenant_id = ${tenantId} AND service = ${service}`).then((r: any) => r.rows || r);
    if (existing.length > 0) return res.status(409).json({ error: "Integration deja configuree" });

    const id = randomUUID();
    const hasCredentials = credentials && Object.values(credentials).some((v: any) => v && v.trim());
    await db.execute(sql`
      INSERT INTO devmax_integrations (id, tenant_id, service, status, config, credentials, enabled)
      VALUES (${id}, ${tenantId}, ${service}, ${hasCredentials ? 'connected' : 'disconnected'}, ${JSON.stringify(config || {})}, ${JSON.stringify(credentials || {})}, ${true})
    `);
    await logAdminAudit(req, "integration_added", "integration", id, null, { service, tenantId });
    res.json({ success: true, id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/admin/tenants/:tenantId/integrations/:integrationId", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId, integrationId } = req.params;
    const { credentials, config, enabled, status } = req.body;

    const setParts: SQL[] = [];
    if (credentials !== undefined) {
      const hasCredentials = Object.values(credentials as Record<string, any>).some((v: any) => v && String(v).trim());
      setParts.push(sql`credentials = ${JSON.stringify(credentials)}::jsonb`);
      setParts.push(sql`status = ${hasCredentials ? 'connected' : 'disconnected'}`);
    }
    if (config !== undefined) {
      setParts.push(sql`config = ${JSON.stringify(config)}::jsonb`);
    }
    if (enabled !== undefined) {
      setParts.push(sql`enabled = ${enabled}`);
    }
    if (status && credentials === undefined) {
      setParts.push(sql`status = ${status}`);
    }
    setParts.push(sql`updated_at = NOW()`);

    await db.execute(sql`UPDATE devmax_integrations SET ${sql.join(setParts, sql`, `)} WHERE id = ${integrationId} AND tenant_id = ${tenantId}`);
    await logAdminAudit(req, "integration_updated", "integration", integrationId, null, req.body);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/admin/tenants/:tenantId/integrations/:integrationId", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId, integrationId } = req.params;
    await db.execute(sql`DELETE FROM devmax_integrations WHERE id = ${integrationId} AND tenant_id = ${tenantId}`);
    await logAdminAudit(req, "integration_removed", "integration", integrationId, null, null);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/admin/tenants/:tenantId/integrations/:integrationId/test", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId, integrationId } = req.params;
    const [integration] = await db.execute(sql`SELECT * FROM devmax_integrations WHERE id = ${integrationId} AND tenant_id = ${tenantId}`).then((r: any) => r.rows || r);
    if (!integration) return res.status(404).json({ error: "Integration non trouvee" });

    await db.execute(sql`UPDATE devmax_integrations SET last_sync_at = NOW(), status = 'connected', last_error = NULL WHERE id = ${integrationId}`);
    res.json({ success: true, status: "connected" });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

async function logAdminAudit(req: Request, action: string, entityType: string, entityId: string, oldValues: any, newValues: any) {
  try {
    await db.execute(sql`
      INSERT INTO devmax_audit_log (tenant_id, user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
      VALUES (${null}, ${"master-admin"}, ${action}, ${entityType}, ${entityId}, ${oldValues ? JSON.stringify(oldValues) : null}, ${newValues ? JSON.stringify(newValues) : null}, ${req.ip || null}, ${req.headers["user-agent"] || null})
    `);
  } catch (e) {
    safeCatch("devmax-audit-log", e);
  }
}

router.post("/contact/enterprise", async (req: Request, res: Response) => {
  try {
    const { company, name, email, phone, projectCount, message } = req.body;
    if (!email || !name || !company) {
      return res.status(400).json({ error: "Nom, email et entreprise sont requis" });
    }
    await db.execute(sql`
      INSERT INTO devmax_enterprise_inquiries (company, contact_name, email, phone, project_count, message, status, created_at)
      VALUES (${company}, ${name}, ${email}, ${phone || null}, ${projectCount || null}, ${message || null}, 'new', NOW())
    `).catch(async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS devmax_enterprise_inquiries (
          id SERIAL PRIMARY KEY, company TEXT NOT NULL, contact_name TEXT NOT NULL, email TEXT NOT NULL,
          phone TEXT, project_count TEXT, message TEXT, status TEXT DEFAULT 'new', created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await db.execute(sql`
        INSERT INTO devmax_enterprise_inquiries (company, contact_name, email, phone, project_count, message, status, created_at)
        VALUES (${company}, ${name}, ${email}, ${phone || null}, ${projectCount || null}, ${message || null}, 'new', NOW())
      `);
    });

    try {
      const { gmailService } = await import("../services/gmailService");
      await gmailService.sendEmail({
        to: "maurice.djedou@gmail.com",
        subject: `[DevMax Enterprise] Nouvelle demande de ${company}`,
        body: `<h2>Demande Enterprise DevMax</h2><p><b>Entreprise:</b> ${company}</p><p><b>Contact:</b> ${name} (${email})</p><p><b>Téléphone:</b> ${phone || "Non fourni"}</p><p><b>Nombre de projets estimé:</b> ${projectCount || "Non précisé"}</p><p><b>Message:</b></p><p>${message || "Aucun message"}</p>`,
        isHtml: true,
      });
    } catch {}

    sendDevmaxNotification({ tenantId: null, projectId: null, type: "enterprise_inquiry", title: `Demande Enterprise: ${company}`, message: `${name} (${email}) souhaite discuter du plan Enterprise. ${projectCount ? `Projets estimés: ${projectCount}` : ""}` }).catch(() => {});

    res.json({ success: true, message: "Votre demande a été envoyée. Nous vous contacterons sous 24h." });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
