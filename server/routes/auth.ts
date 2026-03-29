import { Router } from "express";
import { z } from "zod";
import { authService, adminUnlockAccount } from "../services/auth";
import { diagnosticsService } from "../services/diagnostics";
import { 
  requireAuth, 
  requireOwner, 
  setSessionCookie, 
  clearSessionCookie,
  checkOwnerExists,
  getSessionToken
} from "../middleware/auth";
import { authLimiter } from "../middleware/apiRateLimit";

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const registerOwnerSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(8),
  displayName: z.string().min(1),
});

const registerUserSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(8),
  displayName: z.string().optional(),
});

const approveUserSchema = z.object({
  userId: z.number(),
  accessLevel: z.enum(["basic", "full"]).default("basic"),
  note: z.string().optional(),
});

router.get("/status", async (req, res) => {
  try {
    const ownerExists = await checkOwnerExists();
    res.json({ 
      ownerExists,
      needsSetup: !ownerExists,
    });
  } catch (error) {
    console.error("Auth status error:", error);
    res.status(500).json({ error: "Failed to check auth status" });
  }
});

router.post("/setup", authLimiter, async (req, res) => {
  try {
    const ownerExists = await checkOwnerExists();
    if (ownerExists) {
      return res.status(400).json({ error: "Owner already exists" });
    }

    const data = registerOwnerSchema.parse(req.body);
    const result = await authService.registerOwner(
      data.username,
      data.password,
      data.displayName
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    if (result.session) {
      setSessionCookie(res, result.session.id);
    }

    res.json({
      success: true,
      user: {
        id: result.user!.id,
        username: result.user!.username,
        displayName: result.user!.displayName,
        role: result.user!.role,
        isOwner: result.user!.isOwner,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: error.errors });
    }
    console.error("Setup error:", error);
    res.status(500).json({ error: "Setup failed" });
  }
});

router.post("/unlock-account", requireAuth, requireOwner, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: "Username requis" });
    const unlocked = adminUnlockAccount(username);
    res.json({ success: true, unlocked, message: unlocked ? `Compte ${username} déverrouillé` : `Pas de verrouillage actif pour ${username}` });
  } catch (error) {
    res.status(500).json({ error: "Erreur lors du déverrouillage" });
  }
});

router.post("/login", authLimiter, async (req, res) => {
  try {
    const data = loginSchema.parse(req.body);
    const userAgent = req.headers["user-agent"];
    const ipAddress = req.ip || req.connection?.remoteAddress;

    const result = await authService.login(
      data.username,
      data.password,
      userAgent,
      ipAddress
    );

    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }

    if (result.session) {
      setSessionCookie(res, result.session.id);
    }

    if (result.user?.isOwner && result.session) {
      const { twoFactorService } = await import("../services/twoFactorService");
      const otpResult = await twoFactorService.generateAndSend(result.session.id, result.user.id);
      if (!otpResult.success) {
        console.error("[2FA] Failed to send code:", otpResult.error);
      }

      return res.json({
        success: true,
        requires2FA: true,
        user: {
          id: result.user.id,
          username: result.user.username,
          displayName: result.user.displayName,
          role: result.user.role,
          isOwner: result.user.isOwner,
        },
      });
    }

    queueMicrotask(async () => {
      try {
        const diagnosticResult = await diagnosticsService.runAutomaticDiagnosticsOnLogin(result.user!.id);
        console.log(`[Auto-Diagnostic] ${diagnosticResult.message}`);
      } catch (error) {
        console.error("[Auto-Diagnostic] Error:", error);
      }
    });

    res.json({
      success: true,
      user: {
        id: result.user!.id,
        username: result.user!.username,
        displayName: result.user!.displayName,
        role: result.user!.role,
        isOwner: result.user!.isOwner,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input" });
    }
    console.error("Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

const verify2FASchema = z.object({
  code: z.string().length(6),
});

router.post("/2fa/verify", requireAuth, async (req, res) => {
  try {
    const data = verify2FASchema.parse(req.body);
    const sessionToken = getSessionToken(req);
    if (!sessionToken) {
      return res.status(401).json({ error: "Session requise" });
    }

    if (!req.user?.isOwner) {
      return res.status(403).json({ error: "2FA réservé au propriétaire" });
    }

    const { twoFactorService } = await import("../services/twoFactorService");
    const result = await twoFactorService.verify(sessionToken, data.code);

    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }

    queueMicrotask(async () => {
      try {
        const diagnosticResult = await diagnosticsService.runAutomaticDiagnosticsOnLogin(req.user!.id);
        console.log(`[Auto-Diagnostic] ${diagnosticResult.message}`);
      } catch (error) {
        console.error("[Auto-Diagnostic] Error:", error);
      }
    });

    res.json({ success: true, verified: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Code invalide" });
    }
    console.error("2FA verify error:", error);
    res.status(500).json({ error: "Erreur de vérification" });
  }
});

router.post("/2fa/resend", requireAuth, async (req, res) => {
  try {
    if (!req.user?.isOwner) {
      return res.status(403).json({ error: "2FA réservé au propriétaire" });
    }

    const sessionToken = getSessionToken(req);
    if (!sessionToken) {
      return res.status(401).json({ error: "Session requise" });
    }

    const { twoFactorService } = await import("../services/twoFactorService");
    const result = await twoFactorService.resend(sessionToken, req.user.id);

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json({ success: true, message: "Nouveau code envoyé" });
  } catch (error) {
    console.error("2FA resend error:", error);
    res.status(500).json({ error: "Erreur lors du renvoi" });
  }
});

router.post("/max-auto-login", authLimiter, async (req, res) => {
  try {
    if (!process.env.ALFRED_PASSWORD) {
        return res.status(500).json({ error: "Alfred password not configured" });
    }
    const userAgent = req.headers["user-agent"];
    const ipAddress = req.ip || req.connection?.remoteAddress;
    const { browserSessionId } = req.body;

    const result = await authService.login(
      "Alfred-assist",
      process.env.ALFRED_PASSWORD!,
      userAgent,
      ipAddress
    );

    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }

    if (result.session) {
      setSessionCookie(res, result.session.id);
    }

    res.json({
      success: true,
      user: {
        id: result.user!.id,
        username: result.user!.username,
        displayName: result.user!.displayName,
        role: result.user!.role,
        isOwner: result.user!.isOwner,
      },
      browserSessionId: browserSessionId || null,
    });
  } catch (error) {
    console.error("Alfred auto-login error:", error);
    res.status(500).json({ error: "Auto-login failed" });
  }
});

// PIN-only schema: the client sends only the PIN, the server resolves the user.
// This keeps PINs off the frontend JS bundle.
const talkingPinSchema = z.object({
  pin: z.string().length(4).regex(/^\d{4}$/, "Le PIN doit être 4 chiffres"),
});

const TALKING_USER_PINS: Record<string, string> = {};
try {
    let raw = "";
    if (process.env.TALKING_PINS_B64) {
        raw = Buffer.from(process.env.TALKING_PINS_B64, "base64").toString("utf-8");
    } else if (process.env.TALKING_PINS) {
        raw = process.env.TALKING_PINS.trim().replace(/[\u200B\uFEFF\u00A0]/g, "");
    }
    if (raw) {
        const parsed = JSON.parse(raw);
        Object.assign(TALKING_USER_PINS, parsed);
        console.log(`[Auth] TALKING_PINS loaded: ${Object.keys(parsed).length} users`);
    }
} catch (e) {
    console.error("[Auth] Failed to parse TALKING_PINS:", e);
}

router.post("/talking/pin-login", authLimiter, async (req, res) => {
  try {
    const data = talkingPinSchema.parse(req.body);

    // Resolve username from PIN server-side — never trust the client to send a username
    const entry = Object.entries(TALKING_USER_PINS).find(([, p]) => p === data.pin);
    if (!entry) {
      return res.status(401).json({ error: "Code PIN invalide" });
    }
    const username = entry[0];

    const userAgent = req.headers["user-agent"];
    const ipAddress = req.ip || req.connection?.remoteAddress;

    const user = await authService.findUserByUsername(username);
    if (!user) {
      return res.status(404).json({ error: "Utilisateur introuvable" });
    }

    const session = await authService.createSessionForUser(user.id, userAgent, ipAddress);

    if (session) {
      setSessionCookie(res, session.id);
    }

    console.log(`[Talking PIN] User ${username} logged in via PIN`);

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        isOwner: user.isOwner,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides" });
    }
    console.error("Talking PIN login error:", error);
    res.status(500).json({ error: "Connexion échouée" });
  }
});

router.post("/logout", requireAuth, async (req, res) => {
  try {
    if (req.session) {
      await authService.deleteSession(req.session.id);
    }
    clearSessionCookie(res);
    res.json({ success: true });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ error: "Logout failed" });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  const needs2FA = req.user?.isOwner && !req.session?.twoFactorVerified;
  res.json({
    user: {
      id: req.user!.id,
      username: req.user!.username,
      displayName: req.user!.displayName,
      role: req.user!.role,
      isOwner: req.user!.isOwner,
    },
    requires2FA: needs2FA || false,
  });
});

router.get("/approved-users", requireOwner, async (req, res) => {
  try {
    const approvedUsers = await authService.getApprovedUsers();
    res.json(approvedUsers.map(a => ({
      id: a.id,
      userId: a.userId,
      username: a.user.username,
      displayName: a.user.displayName,
      accessLevel: a.accessLevel,
      note: a.note,
      createdAt: a.createdAt,
    })));
  } catch (error) {
    console.error("Get approved users error:", error);
    res.status(500).json({ error: "Failed to get approved users" });
  }
});

router.post("/approve-user", requireOwner, async (req, res) => {
  try {
    const data = approveUserSchema.parse(req.body);
    const approval = await authService.approveUser(
      data.userId,
      req.user!.id,
      data.accessLevel,
      data.note
    );
    res.json({ success: true, approval });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: error.errors });
    }
    console.error("Approve user error:", error);
    res.status(500).json({ error: "Failed to approve user" });
  }
});

router.post("/revoke-user/:userId", requireOwner, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }
    await authService.revokeApproval(userId);
    res.json({ success: true });
  } catch (error) {
    console.error("Revoke user error:", error);
    res.status(500).json({ error: "Failed to revoke user" });
  }
});

router.put("/update-user/:userId", requireOwner, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }
    const schema = z.object({
      username: z.string().min(3).optional(),
      password: z.string().min(4).optional(),
      displayName: z.string().optional(),
    });
    const data = schema.parse(req.body);
    const updates: Record<string, string> = {};
    if (data.username) updates.username = data.username;
    if (data.displayName) updates.displayName = data.displayName;
    if (data.password) {
      updates.password = await authService.hashPassword(data.password);
      updates.plainPassword = data.password;
    }
    await authService.updateUser(userId, updates);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: error.errors });
    }
    console.error("Update user error:", error);
    res.status(500).json({ error: "Failed to update user" });
  }
});

router.get("/all-users", requireOwner, async (req, res) => {
  try {
    const { db } = await import("../db");
    const { users } = await import("@shared/schema");
    const allUsers = await db.select({
      id: users.id,
      username: users.username,
      plainPassword: users.plainPassword,
      displayName: users.displayName,
      role: users.role,
      isOwner: users.isOwner,
      createdAt: users.createdAt,
    }).from(users);
    res.json(allUsers);
  } catch (error) {
    console.error("Get all users error:", error);
    res.status(500).json({ error: "Failed to get users" });
  }
});

router.post("/create-user", requireOwner, async (req, res) => {
  try {
    const schema = z.object({
      username: z.string().min(3).max(50),
      password: z.string().min(4),
      displayName: z.string().optional(),
      role: z.enum(["approved", "guest", "external"]).default("approved"),
    });
    const data = schema.parse(req.body);
    const existing = await authService.findUserByUsername(data.username);
    if (existing) {
      return res.status(400).json({ error: "Ce nom d'utilisateur existe déjà" });
    }
    const hashedPassword = await authService.hashPassword(data.password);
    const { db } = await import("../db");
    const { users } = await import("@shared/schema");
    const [newUser] = await db.insert(users).values({
      username: data.username,
      password: hashedPassword,
      plainPassword: data.password,
      displayName: data.displayName || data.username,
      role: data.role,
      isOwner: false,
    }).returning();
    res.json({ success: true, user: { id: newUser.id, username: newUser.username, displayName: newUser.displayName, role: newUser.role } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides", details: error.errors });
    }
    console.error("Create user error:", error);
    res.status(500).json({ error: "Erreur création utilisateur" });
  }
});

router.delete("/delete-user/:userId", requireOwner, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }
    if (userId === req.user!.id) {
      return res.status(400).json({ error: "Vous ne pouvez pas supprimer votre propre compte" });
    }
    await authService.deleteUser(userId);
    res.json({ success: true });
  } catch (error) {
    console.error("Delete user error:", error);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

router.post("/register-user", async (req, res) => {
  try {
    const ownerExists = await checkOwnerExists();
    if (!ownerExists) {
      return res.status(400).json({ error: "Owner must be set up first" });
    }

    const data = registerUserSchema.parse(req.body);
    const user = await authService.registerUser(
      data.username,
      data.password,
      data.displayName
    );

    res.json({
      success: true,
      message: "Account created. Please wait for owner approval.",
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: error.errors });
    }
    console.error("Register user error:", error);
    res.status(500).json({ error: "Registration failed" });
  }
});

export default router;
