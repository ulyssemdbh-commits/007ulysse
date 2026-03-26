import { Router, Request, Response } from "express";
import { db } from "../db";
import { uiSnapshots } from "@shared/schema";
import { eq, desc, lte, sql, and, gte } from "drizzle-orm";

const router = Router();

router.post("/api/ui-snapshots", async (req: Request, res: Response) => {
  try {
    const { actionType, currentPage, currentTab, elementClicked, visibleComponents, formState, dialogOpen, sidebarState, scrollPosition, viewportWidth, viewportHeight, metadata } = req.body;

    if (!actionType || !currentPage) {
      return res.status(400).json({ error: "actionType and currentPage required" });
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const [snapshot] = await db.insert(uiSnapshots).values({
      userId: 1,
      actionType,
      currentPage,
      currentTab: currentTab || null,
      elementClicked: elementClicked || null,
      visibleComponents: visibleComponents || null,
      formState: formState || null,
      dialogOpen: dialogOpen || null,
      sidebarState: sidebarState || null,
      scrollPosition: scrollPosition || null,
      viewportWidth: viewportWidth || null,
      viewportHeight: viewportHeight || null,
      metadata: metadata || null,
      expiresAt,
    }).returning();

    res.json({ ok: true, id: snapshot.id });
  } catch (err: any) {
    console.error("[UISnapshot] Error saving snapshot:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/ui-snapshots/recent", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const page = req.query.page as string;

    const conditions = [eq(uiSnapshots.userId, 1)];
    if (page) {
      conditions.push(eq(uiSnapshots.currentPage, page));
    }

    const snapshots = await db.select().from(uiSnapshots)
      .where(and(...conditions))
      .orderBy(desc(uiSnapshots.createdAt))
      .limit(limit);

    res.json(snapshots);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/ui-snapshots/summary", async (req: Request, res: Response) => {
  try {
    const since = new Date();
    since.setHours(since.getHours() - 24);

    const stats = await db.select({
      currentPage: uiSnapshots.currentPage,
      actionCount: sql<number>`count(*)`.as("action_count"),
      lastAction: sql<string>`max(${uiSnapshots.createdAt})`.as("last_action"),
    }).from(uiSnapshots)
      .where(and(eq(uiSnapshots.userId, 1), gte(uiSnapshots.createdAt, since)))
      .groupBy(uiSnapshots.currentPage);

    const lastSnapshot = await db.select().from(uiSnapshots)
      .where(eq(uiSnapshots.userId, 1))
      .orderBy(desc(uiSnapshots.createdAt))
      .limit(1);

    res.json({
      last24h: stats,
      currentView: lastSnapshot[0] || null,
      totalActions: stats.reduce((sum, s) => sum + Number(s.actionCount), 0),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/ui-snapshots/cleanup", async (_req: Request, res: Response) => {
  try {
    const result = await db.delete(uiSnapshots)
      .where(lte(uiSnapshots.expiresAt, new Date()))
      .returning({ id: uiSnapshots.id });

    res.json({ deleted: result.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
