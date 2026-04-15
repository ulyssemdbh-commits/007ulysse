import { Router, Request, Response } from "express";
  import { db } from "../../db";
  import { devmaxSessions, devmaxActivityLog } from "@shared/schema";
  import { eq, and, gt } from "drizzle-orm";
  import { sql } from "drizzle-orm";
  import { randomUUID } from "crypto";
  import { githubService, withGitHubToken } from "../../services/githubService";
  import { devmaxStorage } from "../../services/devmaxStorage";
  import {
    hashPin, verifyPin, hashPassword, verifyPassword,
    requireDevmaxAuth, logDevmaxActivity, getProjectGitHubToken,
    checkPlanLimits, sendDevmaxNotification, getSessionUser,
    verifyProjectAccess, SESSION_DURATION_MS, MAX_LOGIN_ATTEMPTS,
    LOCKOUT_DURATION_MS, requireAdminAuth, ADMIN_PIN, logAdminAudit,
    getPlanLimits
  } from "./devmaxMiddleware";
  import { encryptToken } from "../../services/devmax/cryptoService";
  
  const router = Router();

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
      const rows = await db.execute(sql`SELECT * FROM devmax_users WHERE (pin_hash IS NOT NULL OR pin IS NOT NULL) AND active = true`).then((r: any) => r.rows || r);
      for (const candidate of rows) {
        const storedHash = candidate.pin_hash || candidate.pin;
        if (storedHash && await verifyPin(pin, storedHash)) {
          user = candidate;
          if (!candidate.pin_hash || !candidate.pin_hash.startsWith("$2")) {
            const newHash = await hashPin(pin);
            await db.execute(sql`UPDATE devmax_users SET pin_hash = ${newHash}, pin = NULL, updated_at = NOW() WHERE id = ${candidate.id}`).catch(() => {});
          }
          break;
        }
      }
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
      const storedHash = user.pin_hash || user.pin;
      if (storedHash) {
        authValid = await verifyPin(pin, storedHash);
        if (authValid && (!user.pin_hash || !user.pin_hash.startsWith("$2"))) {
          const newHash = await hashPin(pin);
          await db.execute(sql`UPDATE devmax_users SET pin_hash = ${newHash}, pin = NULL, updated_at = NOW() WHERE id = ${user.id}`).catch(() => {});
        }
      }
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

    const setClauses: ReturnType<typeof sql>[] = [];
    if (firstName !== undefined) setClauses.push(sql`first_name = ${firstName}`);
    if (lastName !== undefined) setClauses.push(sql`last_name = ${lastName}`);
    if (displayName !== undefined) setClauses.push(sql`display_name = ${displayName}`);
    if (email !== undefined) setClauses.push(sql`email = ${email}`);
    if (phone !== undefined) setClauses.push(sql`phone = ${phone}`);
    if (bio !== undefined) setClauses.push(sql`bio = ${bio}`);
    if (timezone !== undefined) setClauses.push(sql`timezone = ${timezone}`);
    if (preferredLanguage !== undefined) setClauses.push(sql`preferred_language = ${preferredLanguage}`);
    if (avatarUrl !== undefined) setClauses.push(sql`avatar_url = ${avatarUrl}`);
    if (githubUsername !== undefined) setClauses.push(sql`github_username = ${githubUsername}`);
    if (sshPublicKey !== undefined) setClauses.push(sql`ssh_public_key = ${sshPublicKey}`);
    if (notificationPreferences !== undefined) setClauses.push(sql`notification_preferences = ${JSON.stringify(notificationPreferences)}::jsonb`);
    setClauses.push(sql`updated_at = NOW()`);

    const setQuery = sql.join(setClauses, sql`, `);
    await db.execute(sql`UPDATE devmax_users SET ${setQuery} WHERE id = ${ctx.user.id}`);
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
      const storedHash = u.pin_hash || u.pin;
      const pinValid = storedHash ? await verifyPin(currentPin, storedHash) : false;
      if (!pinValid) {
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
    const encValue = githubToken ? encryptToken(githubToken) : null;
    await db.execute(sql`UPDATE devmax_users SET github_token = ${encValue}, updated_at = NOW() WHERE id = ${ctx.user.id}`);
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


  export default router;
  