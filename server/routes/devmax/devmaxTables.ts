import { db } from "../../db";
import { sql } from "drizzle-orm";
import { safeCatchDebug } from "../../services/logger";

export async function ensureDevmaxTables() {
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
        pin TEXT,
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

    await db.execute(sql`ALTER TABLE devmax_projects ADD COLUMN IF NOT EXISTS staging_repo_owner TEXT`).catch(() => {});
    await db.execute(sql`ALTER TABLE devmax_projects ADD COLUMN IF NOT EXISTS staging_repo_name TEXT`).catch(() => {});
    await db.execute(sql`ALTER TABLE devmax_projects ADD COLUMN IF NOT EXISTS staging_repo_url TEXT`).catch(() => {});
    await db.execute(sql`ALTER TABLE devmax_projects ADD COLUMN IF NOT EXISTS storage_mode TEXT DEFAULT 'github'`).catch(() => {});

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS devmax_files (
        id SERIAL PRIMARY KEY,
        project_id TEXT NOT NULL,
        branch TEXT NOT NULL DEFAULT 'main',
        file_path TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        sha TEXT,
        size INTEGER DEFAULT 0,
        encoding TEXT DEFAULT 'utf-8',
        updated_by TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(project_id, branch, file_path)
      )
    `).catch(() => {});
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_devmax_files_project ON devmax_files(project_id, branch)`).catch(() => {});

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
      SET staging_url = REPLACE(REPLACE(staging_url, '.test.ulyssepro.org', '-dev.ulyssepro.org'), '.dev.ulyssepro.org', '-dev.ulyssepro.org')
      WHERE staging_url LIKE '%.test.ulyssepro.org%' OR staging_url LIKE '%.dev.ulyssepro.org%'
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
      SET staging_url = 'https://' || deploy_slug || '-dev.ulyssepro.org',
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
        const { sshService } = await import("../../services/sshService");
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
  