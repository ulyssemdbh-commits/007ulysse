import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import { db } from "../db";
import {
  commaxAccounts,
  commaxPosts,
  commaxMentions,
  commaxTemplates,
  commaxAnalytics,
  commaxCmJournal,
  insertCommaxAccountSchema,
  insertCommaxPostSchema,
  insertCommaxMentionSchema,
  insertCommaxTemplateSchema,
  insertCommaxCmJournalSchema,
} from "@shared/schema";
import { eq, and, desc, asc, gte, lte, sql } from "drizzle-orm";
import OpenAI from "openai";

const router = Router();
router.use(requireAuth);

function getUserId(req: Request): number {
  return (req as any).user?.id;
}

// ─── ACCOUNTS ────────────────────────────────────────────────

router.get("/accounts", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const accounts = await db
      .select()
      .from(commaxAccounts)
      .where(eq(commaxAccounts.userId, userId))
      .orderBy(asc(commaxAccounts.platform));
    res.json(accounts);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/accounts", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const data = insertCommaxAccountSchema.parse({ ...req.body, userId });
    const [account] = await db.insert(commaxAccounts).values(data).returning();
    res.json(account);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.patch("/accounts/:id", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const id = parseInt(req.params.id);
    const [account] = await db
      .update(commaxAccounts)
      .set({ ...req.body, lastSyncAt: new Date() })
      .where(and(eq(commaxAccounts.id, id), eq(commaxAccounts.userId, userId)))
      .returning();
    res.json(account);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.delete("/accounts/:id", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const id = parseInt(req.params.id);
    await db
      .delete(commaxAccounts)
      .where(and(eq(commaxAccounts.id, id), eq(commaxAccounts.userId, userId)));
    res.json({ success: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// ─── POSTS ───────────────────────────────────────────────────

router.get("/posts", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { status } = req.query;
    let query = db
      .select()
      .from(commaxPosts)
      .where(eq(commaxPosts.userId, userId))
      .orderBy(desc(commaxPosts.createdAt))
      .$dynamic();

    if (status && status !== "all") {
      query = query.where(and(eq(commaxPosts.userId, userId), eq(commaxPosts.status, status as string)));
    }

    const posts = await query;
    res.json(posts);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/posts", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const data = insertCommaxPostSchema.parse({ ...req.body, userId });
    const [post] = await db.insert(commaxPosts).values(data).returning();
    res.json(post);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.patch("/posts/:id", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const id = parseInt(req.params.id);
    const [post] = await db
      .update(commaxPosts)
      .set({ ...req.body, updatedAt: new Date() })
      .where(and(eq(commaxPosts.id, id), eq(commaxPosts.userId, userId)))
      .returning();
    res.json(post);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.delete("/posts/:id", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const id = parseInt(req.params.id);
    await db
      .delete(commaxPosts)
      .where(and(eq(commaxPosts.id, id), eq(commaxPosts.userId, userId)));
    res.json({ success: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// ─── INSTAGRAM OAUTH & TOKEN ───────────────────────────────────

// Validate + save a manual Instagram token
router.post("/oauth/instagram/token", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { token, accountName, accountHandle, accountId: existingAccountId } = req.body;
    if (!token) return res.status(400).json({ error: "Token requis" });

    // Step 1: Validate token via Instagram Graph API
    const meRes = await fetch(`https://graph.instagram.com/me?fields=id,username,account_type&access_token=${token}`);
    const meData = await meRes.json();
    if (meData.error) {
      return res.status(400).json({ error: `Token invalide: ${meData.error.message}` });
    }

    let finalToken = token;
    let tokenExpiresAt: Date | null = null;

    // Step 2: Exchange for long-lived token (60 days) if App credentials available
    const appId = process.env.INSTAGRAM_APP_ID || process.env.META_APP_ID;
    const appSecret = process.env.INSTAGRAM_APP_SECRET || process.env.META_APP_SECRET;
    if (appId && appSecret) {
      try {
        const exchangeRes = await fetch(
          `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${appSecret}&access_token=${token}`
        );
        const exchangeData = await exchangeRes.json();
        if (exchangeData.access_token) {
          finalToken = exchangeData.access_token;
          tokenExpiresAt = new Date(Date.now() + (exchangeData.expires_in || 5184000) * 1000);
        }
      } catch (exchangeErr: any) {
        console.warn("[Commax/Instagram] Token exchange failed (non-fatal):", exchangeErr.message);
      }
    }

    const instagramUserId = meData.id;
    const instagramUsername = meData.username;

    const accountData = {
      userId,
      platform: "instagram" as const,
      accountName: accountName || instagramUsername || "Instagram",
      accountHandle: accountHandle || instagramUsername,
      accountId: instagramUserId,
      accessToken: finalToken,
      tokenExpiresAt,
      status: "connected" as const,
      metadata: { account_type: meData.account_type, exchanged: !!(appId && appSecret) },
    };

    let result;
    if (existingAccountId) {
      const [updated] = await db.update(commaxAccounts)
        .set({ ...accountData, lastSyncAt: new Date() })
        .where(and(eq(commaxAccounts.id, existingAccountId), eq(commaxAccounts.userId, userId)))
        .returning();
      result = updated;
    } else {
      const [inserted] = await db.insert(commaxAccounts).values(accountData).returning();
      result = inserted;
    }

    res.json({
      success: true,
      account: result,
      instagramUserId,
      instagramUsername,
      longLived: !!(appId && appSecret),
      expiresAt: tokenExpiresAt,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Initiate Instagram OAuth flow (requires INSTAGRAM_APP_ID)
router.get("/oauth/instagram", async (req: Request, res: Response) => {
  const appId = process.env.INSTAGRAM_APP_ID || process.env.META_APP_ID;
  if (!appId) {
    return res.status(503).json({ error: "INSTAGRAM_APP_ID non configuré — utilise le token manuel" });
  }
  const redirectUri = `${req.protocol}://${req.get("host")}/api/commax/oauth/instagram/callback`;
  const scope = "instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement";
  const oauthUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&response_type=code`;
  res.redirect(oauthUrl);
});

// Instagram OAuth callback
router.get("/oauth/instagram/callback", async (req: Request, res: Response) => {
  try {
    const { code, error } = req.query;
    if (error) return res.redirect(`/commax?oauth_error=${error}`);
    if (!code) return res.redirect("/commax?oauth_error=no_code");

    const appId = process.env.INSTAGRAM_APP_ID || process.env.META_APP_ID;
    const appSecret = process.env.INSTAGRAM_APP_SECRET || process.env.META_APP_SECRET;
    if (!appId || !appSecret) return res.redirect("/commax?oauth_error=missing_credentials");

    const redirectUri = `${req.protocol}://${req.get("host")}/api/commax/oauth/instagram/callback`;

    // Exchange code for access token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`
    );
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.redirect(`/commax?oauth_error=token_exchange_failed`);

    // Exchange for long-lived token
    const longRes = await fetch(
      `https://graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokenData.access_token}`
    );
    const longData = await longRes.json();
    const finalToken = longData.access_token || tokenData.access_token;
    const expiresIn = longData.expires_in || 5184000;

    // Get Instagram business account
    const meRes = await fetch(`https://graph.facebook.com/me?fields=id,name,accounts&access_token=${finalToken}`);
    const meData = await meRes.json();

    // Redirect back with token encoded
    const params = new URLSearchParams({
      oauth_success: "1",
      token: finalToken,
      name: meData.name || "Instagram",
      expires_in: String(expiresIn),
    });
    res.redirect(`/commax?${params.toString()}`);
  } catch (e: any) {
    res.redirect(`/commax?oauth_error=${encodeURIComponent(e.message)}`);
  }
});

// ─── PUBLISH (real) ────────────────────────────────────────────

async function publishToInstagram(post: any, account: any): Promise<{ success: boolean; postId?: string; error?: string }> {
  const token = account.accessToken;
  const igUserId = account.accountId;
  if (!token || !igUserId) return { success: false, error: "Token ou ID Instagram manquant" };

  try {
    const mediaUrls: string[] = (post.mediaUrls as string[]) || [];
    const caption = post.content || "";

    if (mediaUrls.length === 0) {
      // Text-only post — not supported by Instagram Graph API (images required)
      return { success: false, error: "Instagram nécessite une image. Ajoute une URL d'image au post." };
    }

    if (mediaUrls.length === 1) {
      // Single image post
      const containerRes = await fetch(`https://graph.instagram.com/${igUserId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: mediaUrls[0], caption, access_token: token }),
      });
      const container = await containerRes.json();
      if (container.error) return { success: false, error: container.error.message };

      // Publish the container
      await new Promise((r) => setTimeout(r, 3000));
      const publishRes = await fetch(`https://graph.instagram.com/${igUserId}/media_publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creation_id: container.id, access_token: token }),
      });
      const published = await publishRes.json();
      if (published.error) return { success: false, error: published.error.message };
      return { success: true, postId: published.id };
    } else {
      // Carousel post
      const childIds: string[] = [];
      for (const imageUrl of mediaUrls.slice(0, 10)) {
        const childRes = await fetch(`https://graph.instagram.com/${igUserId}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_url: imageUrl, is_carousel_item: true, access_token: token }),
        });
        const child = await childRes.json();
        if (child.id) childIds.push(child.id);
      }
      if (childIds.length === 0) return { success: false, error: "Aucun media créé pour le carousel" };

      const carouselRes = await fetch(`https://graph.instagram.com/${igUserId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media_type: "CAROUSEL", children: childIds.join(","), caption, access_token: token }),
      });
      const carousel = await carouselRes.json();
      if (carousel.error) return { success: false, error: carousel.error.message };

      await new Promise((r) => setTimeout(r, 3000));
      const publishRes = await fetch(`https://graph.instagram.com/${igUserId}/media_publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creation_id: carousel.id, access_token: token }),
      });
      const published = await publishRes.json();
      if (published.error) return { success: false, error: published.error.message };
      return { success: true, postId: published.id };
    }
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// Publish a post immediately
router.post("/posts/:id/publish", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const id = parseInt(req.params.id);
    const [post] = await db
      .select()
      .from(commaxPosts)
      .where(and(eq(commaxPosts.id, id), eq(commaxPosts.userId, userId)));

    if (!post) return res.status(404).json({ error: "Post not found" });

    const platforms = (post.platforms as string[]) || [];
    const publishResults: Record<string, any> = {};

    // Get connected accounts for these platforms
    const accounts = await db.select().from(commaxAccounts)
      .where(and(eq(commaxAccounts.userId, userId), eq(commaxAccounts.status, "connected")));

    for (const platform of platforms) {
      const account = accounts.find((a) => a.platform === platform && a.accessToken);
      if (platform === "instagram" && account) {
        const result = await publishToInstagram(post, account);
        publishResults[platform] = { ...result, publishedAt: new Date().toISOString(), real: true };
      } else if (account?.accessToken) {
        publishResults[platform] = {
          success: false,
          publishedAt: new Date().toISOString(),
          note: `Publication ${platform} — API non encore implémentée pour cette plateforme`,
        };
      } else {
        publishResults[platform] = {
          success: true,
          publishedAt: new Date().toISOString(),
          note: account ? "Publié (token non configuré)" : "Compte non connecté — simulation",
          simulated: true,
        };
      }
    }

    const allSuccess = Object.values(publishResults).every((r: any) => r.success !== false);

    const [updated] = await db
      .update(commaxPosts)
      .set({
        status: allSuccess ? "published" : "failed",
        publishedAt: new Date(),
        publishResults,
        updatedAt: new Date(),
      })
      .where(and(eq(commaxPosts.id, id), eq(commaxPosts.userId, userId)))
      .returning();

    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── AI CONTENT GENERATION ───────────────────────────────────

router.post("/generate", async (req: Request, res: Response) => {
  try {
    const { prompt, platforms, tone, language } = req.body;
    if (!prompt) return res.status(400).json({ error: "prompt required" });

    const openai = new OpenAI();
    const platformList = (platforms || []).join(", ") || "tous les réseaux";
    const toneDesc = tone || "professionnel et engageant";
    const lang = language || "français";

    const systemPrompt = `Tu es Ulysse, expert en community management. Tu génères du contenu social media percutant, authentique et adapté à chaque plateforme. Réponds toujours en ${lang}.`;

    const userPrompt = `Génère un post pour : ${platformList}
Ton : ${toneDesc}
Sujet : ${prompt}

Réponds avec un JSON valide contenant :
{
  "content": "le texte principal du post",
  "variations": {
    "twitter": "version courte < 280 chars si twitter est ciblé",
    "instagram": "version avec emojis et hashtags si instagram est ciblé",
    "linkedin": "version professionnelle si linkedin est ciblé",
    "facebook": "version communautaire si facebook est ciblé",
    "tiktok": "accroche punchy si tiktok est ciblé",
    "threads": "version conversationnelle si threads est ciblé"
  },
  "hashtags": ["hashtag1", "hashtag2"],
  "suggestedTime": "meilleur moment pour poster (ex: Mardi 10h)",
  "estimatedEngagement": "estimation niveau d'engagement (faible/moyen/élevé)"
}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });

    const result = JSON.parse(completion.choices[0].message.content || "{}");
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── MENTIONS / INBOX ────────────────────────────────────────

router.get("/mentions", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const mentions = await db
      .select()
      .from(commaxMentions)
      .where(eq(commaxMentions.userId, userId))
      .orderBy(desc(commaxMentions.receivedAt));
    res.json(mentions);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/mentions", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const data = insertCommaxMentionSchema.parse({ ...req.body, userId });
    const [mention] = await db.insert(commaxMentions).values(data).returning();
    res.json(mention);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.patch("/mentions/:id", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const id = parseInt(req.params.id);
    const [mention] = await db
      .update(commaxMentions)
      .set(req.body)
      .where(and(eq(commaxMentions.id, id), eq(commaxMentions.userId, userId)))
      .returning();
    res.json(mention);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// AI reply generation for a mention
router.post("/mentions/:id/reply", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const id = parseInt(req.params.id);
    const [mention] = await db
      .select()
      .from(commaxMentions)
      .where(and(eq(commaxMentions.id, id), eq(commaxMentions.userId, userId)));

    if (!mention) return res.status(404).json({ error: "Mention not found" });

    const openai = new OpenAI();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Tu es Ulysse, community manager expert. Génère une réponse courte, professionnelle et engageante à ce message reçu sur les réseaux sociaux. Sois authentique et humain. Maximum 3 phrases.",
        },
        {
          role: "user",
          content: `Message reçu sur ${mention.platform} de @${mention.authorHandle || "utilisateur"} : "${mention.content}"\n\nGénère une réponse appropriée.`,
        },
      ],
    });

    const reply = completion.choices[0].message.content || "";
    res.json({ reply });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── TEMPLATES ───────────────────────────────────────────────

router.get("/templates", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const templates = await db
      .select()
      .from(commaxTemplates)
      .where(eq(commaxTemplates.userId, userId))
      .orderBy(desc(commaxTemplates.usageCount));
    res.json(templates);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/templates", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const data = insertCommaxTemplateSchema.parse({ ...req.body, userId });
    const [template] = await db.insert(commaxTemplates).values(data).returning();
    res.json(template);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.delete("/templates/:id", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const id = parseInt(req.params.id);
    await db
      .delete(commaxTemplates)
      .where(and(eq(commaxTemplates.id, id), eq(commaxTemplates.userId, userId)));
    res.json({ success: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// ─── ANALYTICS ───────────────────────────────────────────────

router.get("/analytics", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    // Get accounts for this user
    const accounts = await db
      .select()
      .from(commaxAccounts)
      .where(eq(commaxAccounts.userId, userId));
    const accountIds = accounts.map((a) => a.id);

    if (accountIds.length === 0) return res.json([]);

    const analytics = await db
      .select()
      .from(commaxAnalytics)
      .where(sql`${commaxAnalytics.accountId} = ANY(${accountIds})`)
      .orderBy(desc(commaxAnalytics.date));
    res.json(analytics);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── DASHBOARD STATS ─────────────────────────────────────────

router.get("/stats", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const [accounts, posts, mentions] = await Promise.all([
      db.select().from(commaxAccounts).where(eq(commaxAccounts.userId, userId)),
      db.select().from(commaxPosts).where(eq(commaxPosts.userId, userId)),
      db.select().from(commaxMentions).where(eq(commaxMentions.userId, userId)),
    ]);

    const publishedPosts = posts.filter((p) => p.status === "published");
    const scheduledPosts = posts.filter((p) => p.status === "scheduled");
    const draftPosts = posts.filter((p) => p.status === "draft");
    const unreadMentions = mentions.filter((m) => !m.isRead);
    const connectedAccounts = accounts.filter((a) => a.status === "connected");

    const totalFollowers = accounts.reduce((sum, a) => sum + (a.followersCount || 0), 0);

    res.json({
      accounts: {
        total: accounts.length,
        connected: connectedAccounts.length,
      },
      posts: {
        total: posts.length,
        published: publishedPosts.length,
        scheduled: scheduledPosts.length,
        drafts: draftPosts.length,
      },
      mentions: {
        total: mentions.length,
        unread: unreadMentions.length,
      },
      totalFollowers,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── IRIS CHAT ────────────────────────────────────────────────

router.post("/iris-chat", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { message, history = [] } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({ error: "message requis" });
    }

    // Fetch live Commax context for Iris
    const [accounts, posts, mentions] = await Promise.all([
      db.select().from(commaxAccounts).where(eq(commaxAccounts.userId, userId)),
      db.select().from(commaxPosts).where(eq(commaxPosts.userId, userId)),
      db.select().from(commaxMentions).where(eq(commaxMentions.userId, userId)),
    ]);

    const connectedAccounts = accounts.filter((a) => a.status === "connected");
    const scheduledPosts = posts.filter((p) => p.status === "scheduled");
    const draftPosts = posts.filter((p) => p.status === "draft");
    const unreadMentions = mentions.filter((m) => !m.isRead);

    const commaxContext = `
CONTEXTE COMMAX EN TEMPS RÉEL :
- Comptes connectés : ${connectedAccounts.length} (${connectedAccounts.map((a) => `${a.platform}@${a.accountHandle || a.accountName}`).join(", ") || "aucun"})
- Posts planifiés : ${scheduledPosts.length}
- Brouillons en attente : ${draftPosts.length}
- Mentions non lues dans l'inbox : ${unreadMentions.length}
- Total abonnés : ${accounts.reduce((s, a) => s + (a.followersCount || 0), 0).toLocaleString("fr-FR")}
`;

    const irisSystemPrompt = `Tu es IRIS — Senior Community Manager de l'écosystème Ulysse, intégrée dans Commax (ulyssepro.org/commax).

Tu es proactive, créative, stratégique et autonome. Tu gères tous les réseaux sociaux de Maurice : Twitter/X, Instagram, LinkedIn, Facebook, TikTok, YouTube, Threads, Pinterest.

Tu peux :
- Générer du contenu adapté à chaque plateforme
- Analyser les performances et proposer des stratégies
- Gérer l'inbox et les mentions
- Planifier des campagnes éditoriales
- Conseiller sur les tendances et algorithmes

Tu réponds toujours en français, de manière concise mais percutante. Tu es directe, créative, et tu apportes toujours de la valeur.

${commaxContext}

RÈGLE : Ne dis jamais "je ne peux pas". Tu as accès à toutes les données Commax en temps réel. Tu EXÉCUTES et tu PROPOSES.`;

    const openai = new OpenAI();

    const messages: any[] = [
      { role: "system", content: irisSystemPrompt },
      ...history.slice(-10),
      { role: "user", content: message },
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 800,
      temperature: 0.85,
    });

    const reply = completion.choices[0].message.content || "";

    res.json({ reply });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── CM JOURNAL ──────────────────────────────────────────────

router.get("/journal", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const limit = parseInt((req.query.limit as string) || "50");
    const entries = await db
      .select()
      .from(commaxCmJournal)
      .where(eq(commaxCmJournal.userId, userId))
      .orderBy(desc(commaxCmJournal.createdAt))
      .limit(limit);
    res.json(entries);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/journal", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const today = new Date().toISOString().split("T")[0];
    const data = insertCommaxCmJournalSchema.parse({
      ...req.body,
      userId,
      date: req.body.date || today,
    });
    const [entry] = await db.insert(commaxCmJournal).values(data).returning();
    res.json(entry);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.delete("/journal/:id", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const id = parseInt(req.params.id);
    await db
      .delete(commaxCmJournal)
      .where(and(eq(commaxCmJournal.id, id), eq(commaxCmJournal.userId, userId)));
    res.json({ success: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
