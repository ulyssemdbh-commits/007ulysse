import { Router, Request, Response } from "express";
import { db } from "../../db";
import { agentmailMessages, agentmailAttachments, users } from "@shared/schema";
import { eq, desc, and, like, or, sql } from "drizzle-orm";
import { agentMailService } from "../../services/agentMailService";

const router = Router();

router.get("/inbox", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user?.isOwner) {
      return res.status(403).json({ error: "Email access is owner-only" });
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const category = req.query.category as string;
    const unreadOnly = req.query.unread === 'true';

    const emails = await agentMailService.getStoredEmails(userId, { 
      limit, 
      category, 
      unreadOnly 
    });

    const unreadCount = emails.filter(e => !e.isRead).length;
    const inboxAddress = await agentMailService.getInboxAddress();

    res.json({
      inboxAddress,
      emails: emails.map(e => ({
        id: e.id,
        messageId: e.messageId,
        threadId: e.threadId,
        from: e.from,
        to: e.to,
        subject: e.subject,
        snippet: e.snippet,
        body: e.body,
        isRead: e.isRead,
        category: e.category,
        priority: e.priority,
        sentiment: e.sentiment,
        receivedAt: e.receivedAt,
        attachments: e.attachments
      })),
      stats: {
        total: emails.length,
        unread: unreadCount
      }
    });
  } catch (error: any) {
    console.error("[V2 Emails] Inbox error:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

router.get("/message/:messageId", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { messageId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const [email] = await db.select()
      .from(agentmailMessages)
      .where(eq(agentmailMessages.messageId, messageId));

    if (!email || email.userId !== userId) {
      return res.status(404).json({ error: "Email not found" });
    }

    await agentMailService.markAsRead(messageId);

    const attachments = await db.select()
      .from(agentmailAttachments)
      .where(eq(agentmailAttachments.messageId, messageId));

    res.json({
      email: {
        id: email.id,
        messageId: email.messageId,
        threadId: email.threadId,
        inboxId: email.inboxId,
        from: email.from,
        to: email.to,
        cc: email.cc,
        subject: email.subject,
        body: email.body,
        htmlBody: email.htmlBody,
        isRead: true,
        isProcessed: email.isProcessed,
        category: email.category,
        priority: email.priority,
        sentiment: email.sentiment,
        receivedAt: email.receivedAt,
        attachments: attachments.map(a => ({
          id: a.attachmentId,
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
          url: a.url
        }))
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/search", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const query = req.query.q as string;
    if (!query || query.length < 2) {
      return res.status(400).json({ error: "Search query too short (min 2 chars)" });
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const searchPattern = `%${query.toLowerCase()}%`;

    const emails = await db.select()
      .from(agentmailMessages)
      .where(and(
        eq(agentmailMessages.userId, userId),
        or(
          sql`LOWER(${agentmailMessages.subject}) LIKE ${searchPattern}`,
          sql`LOWER(${agentmailMessages.from}) LIKE ${searchPattern}`,
          sql`LOWER(${agentmailMessages.body}) LIKE ${searchPattern}`
        )
      ))
      .orderBy(desc(agentmailMessages.receivedAt))
      .limit(limit);

    res.json({
      query,
      results: emails.map(e => ({
        id: e.id,
        messageId: e.messageId,
        from: e.from,
        subject: e.subject,
        snippet: e.snippet,
        receivedAt: e.receivedAt,
        category: e.category
      })),
      count: emails.length
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/fetch", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user?.isOwner) {
      return res.status(403).json({ error: "Email fetch is owner-only" });
    }

    const isConnected = await agentMailService.isConnected();
    if (!isConnected) {
      return res.status(503).json({ error: "AgentMail not connected" });
    }

    const result = await agentMailService.fetchAndStoreEmails();

    res.json({
      success: true,
      newEmails: result.newEmails,
      processed: result.processed,
      summary: result.summary
    });
  } catch (error: any) {
    console.error("[V2 Emails] Fetch error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/mark-read/:messageId", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { messageId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const [email] = await db.select()
      .from(agentmailMessages)
      .where(eq(agentmailMessages.messageId, messageId));

    if (!email || email.userId !== userId) {
      return res.status(404).json({ error: "Email not found" });
    }

    await agentMailService.markAsRead(messageId);

    res.json({ success: true, messageId });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/summary", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user?.isOwner) {
      return res.status(403).json({ error: "Email summary is owner-only" });
    }

    const summary = await agentMailService.getEmailSummaryForAI(userId);
    const inboxAddress = await agentMailService.getInboxAddress();

    res.json({
      inboxAddress,
      summary,
      isConnected: await agentMailService.isConnected()
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/diagnostics", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user?.isOwner) {
      return res.status(403).json({ error: "Diagnostics is owner-only" });
    }

    const diagnostics = await agentMailService.runDiagnostics();
    const sendHistory = await agentMailService.getSendHistory(20);
    
    res.json({
      success: true,
      diagnostics,
      sendHistory: sendHistory.map(h => ({
        trackingId: h.trackingId,
        to: h.toAddress,
        subject: h.subject,
        status: h.status,
        attempts: h.attempts,
        deliveryStatus: h.deliveryStatus,
        sentAt: h.sentAt,
        createdAt: h.createdAt,
        error: h.errorMessage
      })),
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error("[V2 Emails] Diagnostics error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/send-history", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user?.isOwner) {
      return res.status(403).json({ error: "Send history is owner-only" });
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const history = await agentMailService.getSendHistory(limit);
    
    res.json({
      success: true,
      history: history.map(h => ({
        trackingId: h.trackingId,
        persona: h.persona,
        to: h.toAddress,
        subject: h.subject,
        bodyLength: h.bodyLength,
        hasAttachments: h.hasAttachments,
        status: h.status,
        attempts: h.attempts,
        maxAttempts: h.maxAttempts,
        deliveryStatus: h.deliveryStatus,
        messageId: h.messageId,
        error: h.errorMessage,
        sentAt: h.sentAt,
        createdAt: h.createdAt,
        lastAttemptAt: h.lastAttemptAt
      })),
      stats: {
        total: history.length,
        sent: history.filter(h => h.status === 'sent').length,
        failed: history.filter(h => h.status === 'failed').length,
        pending: history.filter(h => h.status === 'pending' || h.status === 'retrying').length
      }
    });
  } catch (error: any) {
    console.error("[V2 Emails] Send history error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/stats", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const allEmails = await db.select()
      .from(agentmailMessages)
      .where(eq(agentmailMessages.userId, userId));

    const stats = {
      total: allEmails.length,
      unread: allEmails.filter(e => !e.isRead).length,
      byCategory: {} as Record<string, number>,
      byPriority: {} as Record<string, number>,
      bySentiment: {} as Record<string, number>
    };

    for (const email of allEmails) {
      const cat = email.category || 'general';
      const pri = email.priority || 'normal';
      const sent = email.sentiment || 'neutral';
      
      stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;
      stats.byPriority[pri] = (stats.byPriority[pri] || 0) + 1;
      stats.bySentiment[sent] = (stats.bySentiment[sent] || 0) + 1;
    }

    const isConnected = await agentMailService.isConnected();
    const inboxAddress = isConnected ? await agentMailService.getInboxAddress() : null;

    res.json({
      inboxAddress,
      isConnected,
      stats
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
