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

    const encryptedToken = encryptToken(accessToken);
    await db.execute(sql`
      UPDATE devmax_projects 
      SET github_token = ${encryptedToken},
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

    const encryptedPat = encryptToken(pat);
    await db.execute(sql`
      UPDATE devmax_projects 
      SET github_token = ${encryptedPat},
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


  export default router;
  