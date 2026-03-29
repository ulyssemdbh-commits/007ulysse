import OpenAI from "openai";
import { db } from "../../db";
import {
  commaxAccounts,
  commaxPosts,
  commaxMentions,
  commaxTemplates,
  commaxAnalytics,
  commaxCmJournal,
} from "@shared/schema";
import { eq, and, desc, asc, sql, gte } from "drizzle-orm";

type ChatCompletionTool = OpenAI.Chat.Completions.ChatCompletionTool;

// ─── Tool definitions for Iris / Ulysse ─────────────────────────────────────

export const commaxToolDefs: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "commax_manage",
      description: `Community Management Commax — Iris's primary tool for social media management. Use this tool for EVERYTHING related to social media: creating posts, scheduling campaigns, reading the inbox, replying to mentions, managing accounts, generating AI content, fetching analytics. Iris is the Senior Community Manager. She uses this tool proactively, autonomously, and strategically.

Actions disponibles:
- stats: Dashboard complet (comptes, posts, mentions, abonnés)
- list_posts: Lister les posts (filtrer par status: draft/scheduled/published/all)
- create_post: Créer un nouveau post (draft ou scheduled)
- update_post: Modifier un post existant
- delete_post: Supprimer un post
- publish_post: Publier un post immédiatement
- generate_content: Générer du contenu IA pour un post (retourne variations par plateforme + hashtags)
- list_accounts: Lister les comptes sociaux connectés
- add_account: Ajouter un nouveau compte social
- list_mentions: Lister les mentions/commentaires de l'inbox
- reply_mention: Répondre à une mention (sauvegarder la réponse)
- generate_reply: Générer une réponse IA pour une mention
- mark_read: Marquer une mention comme lue
- list_templates: Lister les templates de contenu
- create_template: Créer un nouveau template
- analytics: Obtenir les stats analytiques par compte/plateforme
- add_journal_entry: Ajouter une entrée dans le Journal CM d'Iris (documenter une action, une session, une décision stratégique, un post créé, une campagne lancée, une mention traitée)
- list_journal: Lister les entrées récentes du journal CM

IMPORTANT: Après chaque action significative (session de travail terminée, post créé, campagne décidée, mention importante traitée), Iris doit automatiquement utiliser add_journal_entry pour documenter son travail dans son journal CM personnel.`,
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "stats", "list_posts", "create_post", "update_post", "delete_post",
              "publish_post", "generate_content", "list_accounts", "add_account",
              "list_mentions", "reply_mention", "generate_reply", "mark_read",
              "list_templates", "create_template", "analytics",
              "add_journal_entry", "list_journal"
            ],
            description: "Action à effectuer"
          },
          // For posts
          postId: { type: "number", description: "ID du post (pour update/delete/publish/reply)" },
          content: { type: "string", description: "Contenu du post ou de la réponse" },
          platforms: {
            type: "array",
            items: { type: "string" },
            description: "Plateformes cibles: twitter, instagram, linkedin, facebook, tiktok, youtube, threads, pinterest"
          },
          status: { type: "string", enum: ["draft", "scheduled", "published", "all"], description: "Statut du post" },
          scheduledAt: { type: "string", description: "Date/heure de publication planifiée (ISO 8601)" },
          title: { type: "string", description: "Titre du post (optionnel)" },
          tags: { type: "array", items: { type: "string" }, description: "Hashtags/tags" },
          campaignName: { type: "string", description: "Nom de la campagne marketing" },
          // For AI generation
          prompt: { type: "string", description: "Description du contenu à générer" },
          tone: { type: "string", description: "Ton voulu: professionnel, décontracté, inspirant, informatif, commercial, storytelling" },
          // For accounts
          platform: { type: "string", enum: ["twitter", "instagram", "linkedin", "facebook", "tiktok", "youtube", "threads", "pinterest"] },
          accountName: { type: "string", description: "Nom du compte social" },
          accountHandle: { type: "string", description: "Handle/pseudo (@...)" },
          followersCount: { type: "number", description: "Nombre d'abonnés" },
          // For mentions
          mentionId: { type: "number", description: "ID de la mention" },
          reply: { type: "string", description: "Texte de réponse à sauvegarder" },
          // For templates
          templateName: { type: "string", description: "Nom du template" },
          // For journal
          journalType: { type: "string", enum: ["note", "session", "post_created", "campaign", "mention_replied", "content_idea", "analytics", "action"], description: "Type d'entrée journal" },
          journalTitle: { type: "string", description: "Titre de l'entrée journal" },
          journalContent: { type: "string", description: "Contenu détaillé de l'entrée journal — description de ce qu'Iris a fait/décidé" },
          // Filters
          limit: { type: "number", description: "Nombre max de résultats (défaut 20)" }
        },
        required: ["action"]
      }
    }
  }
];

// ─── Tool executor ────────────────────────────────────────────────────────────

export async function executeCommaxManage(args: any, userId: number): Promise<string> {
  const { action } = args;

  try {
    switch (action) {

      // ─── STATS ───────────────────────────────────────────────────────
      case "stats": {
        const [accounts, posts, mentions] = await Promise.all([
          db.select().from(commaxAccounts).where(eq(commaxAccounts.userId, userId)),
          db.select().from(commaxPosts).where(eq(commaxPosts.userId, userId)),
          db.select().from(commaxMentions).where(eq(commaxMentions.userId, userId)),
        ]);

        const connectedAccounts = accounts.filter(a => a.status === "connected");
        const publishedPosts = posts.filter(p => p.status === "published");
        const scheduledPosts = posts.filter(p => p.status === "scheduled");
        const draftPosts = posts.filter(p => p.status === "draft");
        const unreadMentions = mentions.filter(m => !m.isRead);
        const totalFollowers = accounts.reduce((s, a) => s + (a.followersCount || 0), 0);

        return JSON.stringify({
          accounts: { total: accounts.length, connected: connectedAccounts.length, list: connectedAccounts.map(a => ({ id: a.id, platform: a.platform, name: a.accountName, handle: a.accountHandle, followers: a.followersCount })) },
          posts: { total: posts.length, published: publishedPosts.length, scheduled: scheduledPosts.length, drafts: draftPosts.length },
          mentions: { total: mentions.length, unread: unreadMentions.length },
          totalFollowers,
          summary: `${connectedAccounts.length} compte(s) connecté(s) · ${totalFollowers.toLocaleString("fr-FR")} abonnés totaux · ${publishedPosts.length} posts publiés · ${scheduledPosts.length} planifiés · ${draftPosts.length} brouillons · ${unreadMentions.length} mention(s) non lue(s)`
        });
      }

      // ─── LIST POSTS ───────────────────────────────────────────────────
      case "list_posts": {
        const statusFilter = args.status && args.status !== "all" ? args.status : null;
        let query = db.select().from(commaxPosts).where(eq(commaxPosts.userId, userId)).orderBy(desc(commaxPosts.createdAt)).$dynamic();
        if (statusFilter) {
          query = query.where(and(eq(commaxPosts.userId, userId), eq(commaxPosts.status, statusFilter)));
        }
        const posts = await query;
        const limit = args.limit || 20;
        return JSON.stringify(posts.slice(0, limit).map(p => ({
          id: p.id, status: p.status, content: p.content?.substring(0, 200),
          platforms: p.platforms, scheduledAt: p.scheduledAt, publishedAt: p.publishedAt,
          aiGenerated: p.aiGenerated, tags: p.tags, campaignName: p.campaignName,
          createdAt: p.createdAt
        })));
      }

      // ─── CREATE POST ─────────────────────────────────────────────────
      case "create_post": {
        if (!args.content) return JSON.stringify({ error: "content requis" });
        const [post] = await db.insert(commaxPosts).values({
          userId,
          content: args.content,
          title: args.title,
          platforms: args.platforms || [],
          status: args.status === "scheduled" && args.scheduledAt ? "scheduled" : "draft",
          scheduledAt: args.scheduledAt ? new Date(args.scheduledAt) : null,
          tags: args.tags || [],
          campaignName: args.campaignName,
          aiGenerated: !!args.prompt,
          prompt: args.prompt,
        }).returning();
        return JSON.stringify({ success: true, post: { id: post.id, status: post.status, content: post.content?.substring(0, 100) }, message: `Post créé avec succès (ID: ${post.id}, status: ${post.status})` });
      }

      // ─── UPDATE POST ─────────────────────────────────────────────────
      case "update_post": {
        if (!args.postId) return JSON.stringify({ error: "postId requis" });
        const updates: any = { updatedAt: new Date() };
        if (args.content !== undefined) updates.content = args.content;
        if (args.platforms !== undefined) updates.platforms = args.platforms;
        if (args.status !== undefined) updates.status = args.status;
        if (args.scheduledAt !== undefined) updates.scheduledAt = new Date(args.scheduledAt);
        if (args.tags !== undefined) updates.tags = args.tags;
        if (args.campaignName !== undefined) updates.campaignName = args.campaignName;
        const [post] = await db.update(commaxPosts).set(updates).where(and(eq(commaxPosts.id, args.postId), eq(commaxPosts.userId, userId))).returning();
        return JSON.stringify({ success: true, post: { id: post.id, status: post.status }, message: `Post ${args.postId} mis à jour` });
      }

      // ─── DELETE POST ─────────────────────────────────────────────────
      case "delete_post": {
        if (!args.postId) return JSON.stringify({ error: "postId requis" });
        await db.delete(commaxPosts).where(and(eq(commaxPosts.id, args.postId), eq(commaxPosts.userId, userId)));
        return JSON.stringify({ success: true, message: `Post ${args.postId} supprimé` });
      }

      // ─── PUBLISH POST ─────────────────────────────────────────────────
      case "publish_post": {
        if (!args.postId) return JSON.stringify({ error: "postId requis" });
        const [post] = await db.select().from(commaxPosts).where(and(eq(commaxPosts.id, args.postId), eq(commaxPosts.userId, userId)));
        if (!post) return JSON.stringify({ error: "Post introuvable" });

        const platforms = (post.platforms as string[]) || [];
        const publishResults: Record<string, any> = {};
        for (const platform of platforms) {
          publishResults[platform] = { success: true, publishedAt: new Date().toISOString(), note: "Publication simulée — OAuth requis pour la publication réelle" };
        }

        const [updated] = await db.update(commaxPosts).set({ status: "published", publishedAt: new Date(), publishResults, updatedAt: new Date() }).where(and(eq(commaxPosts.id, args.postId), eq(commaxPosts.userId, userId))).returning();
        return JSON.stringify({ success: true, post: { id: updated.id, status: updated.status, publishedAt: updated.publishedAt }, message: `Post ${args.postId} publié sur ${platforms.join(", ") || "aucune plateforme"}` });
      }

      // ─── GENERATE CONTENT ─────────────────────────────────────────────
      case "generate_content": {
        if (!args.prompt) return JSON.stringify({ error: "prompt requis" });
        const openai = new OpenAI();
        const platforms = (args.platforms || []).join(", ") || "tous les réseaux";
        const tone = args.tone || "professionnel et engageant";

        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "Tu es Iris, Community Manager Senior de l'écosystème Ulysse. Tu crées du contenu social media percutant, authentique et adapté à chaque plateforme. Réponds en français." },
            { role: "user", content: `Génère un post pour : ${platforms}\nTon : ${tone}\nSujet : ${args.prompt}\n\nRéponds avec un JSON valide:\n{"content": "texte principal", "variations": {"twitter": "...", "instagram": "...", "linkedin": "...", "facebook": "...", "tiktok": "...", "threads": "..."}, "hashtags": ["hashtag1", "hashtag2"], "suggestedTime": "meilleur moment", "estimatedEngagement": "faible/moyen/élevé", "strategy": "justification stratégique du contenu"}` }
          ],
          response_format: { type: "json_object" },
        });

        const result = JSON.parse(completion.choices[0].message.content || "{}");
        return JSON.stringify({ success: true, ...result, note: "Contenu généré — utilise create_post pour le sauvegarder" });
      }

      // ─── LIST ACCOUNTS ────────────────────────────────────────────────
      case "list_accounts": {
        const accounts = await db.select().from(commaxAccounts).where(eq(commaxAccounts.userId, userId)).orderBy(asc(commaxAccounts.platform));
        return JSON.stringify(accounts.map(a => ({ id: a.id, platform: a.platform, name: a.accountName, handle: a.accountHandle, followers: a.followersCount, status: a.status })));
      }

      // ─── ADD ACCOUNT ──────────────────────────────────────────────────
      case "add_account": {
        if (!args.platform || !args.accountName) return JSON.stringify({ error: "platform et accountName requis" });
        const [account] = await db.insert(commaxAccounts).values({
          userId,
          platform: args.platform,
          accountName: args.accountName,
          accountHandle: args.accountHandle,
          followersCount: args.followersCount || 0,
          status: "connected",
        }).returning();
        return JSON.stringify({ success: true, account: { id: account.id, platform: account.platform, name: account.accountName }, message: `Compte ${args.accountName} (${args.platform}) ajouté` });
      }

      // ─── LIST MENTIONS ────────────────────────────────────────────────
      case "list_mentions": {
        const mentions = await db.select().from(commaxMentions).where(eq(commaxMentions.userId, userId)).orderBy(desc(commaxMentions.receivedAt));
        const limit = args.limit || 20;
        const filtered = args.status === "unread" ? mentions.filter(m => !m.isRead) : mentions;
        return JSON.stringify(filtered.slice(0, limit).map(m => ({ id: m.id, platform: m.platform, type: m.type, author: m.authorHandle || m.authorName, content: m.content, sentiment: m.sentiment, isRead: m.isRead, isReplied: m.isReplied, receivedAt: m.receivedAt })));
      }

      // ─── REPLY MENTION ────────────────────────────────────────────────
      case "reply_mention": {
        if (!args.mentionId || !args.reply) return JSON.stringify({ error: "mentionId et reply requis" });
        const [mention] = await db.update(commaxMentions).set({ isReplied: true, reply: args.reply, isRead: true }).where(and(eq(commaxMentions.id, args.mentionId), eq(commaxMentions.userId, userId))).returning();
        return JSON.stringify({ success: true, message: `Réponse sauvegardée pour la mention ${args.mentionId}`, reply: args.reply });
      }

      // ─── GENERATE REPLY ───────────────────────────────────────────────
      case "generate_reply": {
        if (!args.mentionId) return JSON.stringify({ error: "mentionId requis" });
        const [mention] = await db.select().from(commaxMentions).where(and(eq(commaxMentions.id, args.mentionId), eq(commaxMentions.userId, userId)));
        if (!mention) return JSON.stringify({ error: "Mention introuvable" });

        const openai = new OpenAI();
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "Tu es Iris, Community Manager Senior. Génère une réponse courte, professionnelle et engageante à ce message reçu sur les réseaux sociaux. Sois authentique, humaine, chaleureuse mais efficace. Maximum 3 phrases." },
            { role: "user", content: `Message sur ${mention.platform} de @${mention.authorHandle || "utilisateur"} : "${mention.content}"\n\nGénère une réponse.` }
          ],
        });

        const reply = completion.choices[0].message.content || "";
        return JSON.stringify({ success: true, reply, mentionId: args.mentionId, note: "Réponse générée — utilise reply_mention pour la sauvegarder" });
      }

      // ─── MARK READ ────────────────────────────────────────────────────
      case "mark_read": {
        if (!args.mentionId) return JSON.stringify({ error: "mentionId requis" });
        await db.update(commaxMentions).set({ isRead: true }).where(and(eq(commaxMentions.id, args.mentionId), eq(commaxMentions.userId, userId)));
        return JSON.stringify({ success: true, message: `Mention ${args.mentionId} marquée comme lue` });
      }

      // ─── LIST TEMPLATES ───────────────────────────────────────────────
      case "list_templates": {
        const templates = await db.select().from(commaxTemplates).where(eq(commaxTemplates.userId, userId)).orderBy(desc(commaxTemplates.usageCount));
        return JSON.stringify(templates.map(t => ({ id: t.id, name: t.name, content: t.content?.substring(0, 200), platforms: t.platforms, tags: t.tags, usageCount: t.usageCount })));
      }

      // ─── CREATE TEMPLATE ──────────────────────────────────────────────
      case "create_template": {
        if (!args.templateName || !args.content) return JSON.stringify({ error: "templateName et content requis" });
        const [template] = await db.insert(commaxTemplates).values({
          userId,
          name: args.templateName,
          content: args.content,
          platforms: args.platforms || [],
          tags: args.tags || [],
        }).returning();
        return JSON.stringify({ success: true, template: { id: template.id, name: template.name }, message: `Template "${args.templateName}" créé` });
      }

      // ─── ANALYTICS ────────────────────────────────────────────────────
      case "analytics": {
        const accounts = await db.select().from(commaxAccounts).where(eq(commaxAccounts.userId, userId));
        const posts = await db.select().from(commaxPosts).where(eq(commaxPosts.userId, userId));
        const mentions = await db.select().from(commaxMentions).where(eq(commaxMentions.userId, userId));

        const published = posts.filter(p => p.status === "published");
        const platformCounts: Record<string, number> = {};
        for (const post of published) {
          for (const platform of (post.platforms as string[] || [])) {
            platformCounts[platform] = (platformCounts[platform] || 0) + 1;
          }
        }

        const sentimentBreakdown = { positive: 0, neutral: 0, negative: 0 };
        for (const m of mentions) {
          if (m.sentiment === "positive") sentimentBreakdown.positive++;
          else if (m.sentiment === "negative") sentimentBreakdown.negative++;
          else sentimentBreakdown.neutral++;
        }

        return JSON.stringify({
          accounts: accounts.map(a => ({ platform: a.platform, name: a.accountName, followers: a.followersCount, status: a.status })),
          postsPerPlatform: platformCounts,
          totalPublished: published.length,
          totalFollowers: accounts.reduce((s, a) => s + (a.followersCount || 0), 0),
          mentionsSentiment: sentimentBreakdown,
          replyRate: mentions.length > 0 ? `${Math.round((mentions.filter(m => m.isReplied).length / mentions.length) * 100)}%` : "N/A",
        });
      }

      // ─── ADD JOURNAL ENTRY ────────────────────────────────────────────
      case "add_journal_entry": {
        if (!args.journalTitle || !args.journalContent) return JSON.stringify({ error: "journalTitle et journalContent requis" });
        const today = new Date().toISOString().split("T")[0];
        const [entry] = await db.insert(commaxCmJournal).values({
          userId,
          date: today,
          type: args.journalType || "note",
          title: args.journalTitle,
          content: args.journalContent,
          platforms: args.platforms || [],
          postId: args.postId || null,
          metadata: {},
        }).returning();
        return JSON.stringify({ success: true, entryId: entry.id, message: `Entrée journal ajoutée: "${args.journalTitle}"`, date: today });
      }

      // ─── LIST JOURNAL ─────────────────────────────────────────────────
      case "list_journal": {
        const limit = args.limit || 10;
        const entries = await db.select().from(commaxCmJournal).where(eq(commaxCmJournal.userId, userId)).orderBy(desc(commaxCmJournal.createdAt)).limit(limit);
        return JSON.stringify(entries.map(e => ({ id: e.id, date: e.date, type: e.type, title: e.title, content: e.content.substring(0, 300), platforms: e.platforms })));
      }

      default:
        return JSON.stringify({ error: `Action inconnue: ${action}` });
    }
  } catch (e: any) {
    return JSON.stringify({ error: e.message, action });
  }
}
