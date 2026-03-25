import { db } from "../db";
import { workJournal } from "@shared/schema";
import type { WorkJournalEntry, InsertWorkJournalEntry } from "@shared/schema";
import { eq, and, desc, asc, inArray, isNull, or, sql, ne } from "drizzle-orm";

class WorkJournalService {
  private static instance: WorkJournalService;

  static getInstance(): WorkJournalService {
    if (!WorkJournalService.instance) {
      WorkJournalService.instance = new WorkJournalService();
    }
    return WorkJournalService.instance;
  }

  async ensureTable(): Promise<void> {
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS work_journal (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          context TEXT NOT NULL DEFAULT 'general',
          entry_type TEXT NOT NULL DEFAULT 'task',
          title TEXT NOT NULL,
          content TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          priority TEXT NOT NULL DEFAULT 'normal',
          source TEXT NOT NULL DEFAULT 'user',
          related_files TEXT[],
          tags TEXT[],
          outcome TEXT,
          parent_id INTEGER,
          conversation_id INTEGER,
          due_date TIMESTAMP,
          completed_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
      console.log("[WorkJournal] Table ensured");
    } catch (err: any) {
      if (!err.message?.includes("already exists")) {
        console.error("[WorkJournal] Table creation error:", err.message);
      }
    }
  }

  async addEntry(data: Partial<InsertWorkJournalEntry> & { userId: number; title: string }): Promise<WorkJournalEntry> {
    const [entry] = await db.insert(workJournal).values({
      userId: data.userId,
      context: data.context || "general",
      entryType: data.entryType || "task",
      title: data.title,
      content: data.content || null,
      status: data.status || "pending",
      priority: data.priority || "normal",
      source: data.source || "user",
      relatedFiles: data.relatedFiles || null,
      tags: data.tags || null,
      parentId: data.parentId || null,
      conversationId: data.conversationId || null,
      dueDate: data.dueDate || null,
    }).returning();

    console.log(`[WorkJournal] ✏️ Added: "${entry.title}" [${entry.context}/${entry.entryType}] #${entry.id}`);
    return entry;
  }

  async updateEntry(id: number, updates: Partial<Pick<WorkJournalEntry, "title" | "content" | "status" | "priority" | "outcome" | "tags" | "relatedFiles" | "dueDate">>): Promise<WorkJournalEntry | null> {
    const updateData: any = { ...updates, updatedAt: new Date() };

    if (updates.status === "done" && !updateData.completedAt) {
      updateData.completedAt = new Date();
    }

    const [entry] = await db.update(workJournal)
      .set(updateData)
      .where(eq(workJournal.id, id))
      .returning();

    if (entry) {
      console.log(`[WorkJournal] ✅ Updated #${id}: status=${entry.status}`);
    }
    return entry || null;
  }

  async checkTask(id: number, outcome?: string): Promise<WorkJournalEntry | null> {
    return this.updateEntry(id, { status: "done", outcome: outcome || "Terminé" });
  }

  async uncheckTask(id: number): Promise<WorkJournalEntry | null> {
    const [entry] = await db.update(workJournal)
      .set({ status: "pending", completedAt: null, updatedAt: new Date() })
      .where(eq(workJournal.id, id))
      .returning();
    return entry || null;
  }

  async getEntry(id: number): Promise<WorkJournalEntry | null> {
    const [entry] = await db.select().from(workJournal).where(eq(workJournal.id, id));
    return entry || null;
  }

  async listEntries(userId: number, options?: {
    context?: string;
    status?: string | string[];
    entryType?: string;
    limit?: number;
    includeCompleted?: boolean;
  }): Promise<WorkJournalEntry[]> {
    const conditions = [eq(workJournal.userId, userId)];

    if (options?.context) {
      conditions.push(eq(workJournal.context, options.context));
    }
    if (options?.status) {
      if (Array.isArray(options.status)) {
        conditions.push(inArray(workJournal.status, options.status));
      } else {
        conditions.push(eq(workJournal.status, options.status));
      }
    }
    if (options?.entryType) {
      conditions.push(eq(workJournal.entryType, options.entryType));
    }
    if (!options?.includeCompleted && !options?.status) {
      conditions.push(ne(workJournal.status, "done"));
      conditions.push(ne(workJournal.status, "cancelled"));
    }

    return db.select().from(workJournal)
      .where(and(...conditions))
      .orderBy(
        sql`CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END`,
        desc(workJournal.createdAt)
      )
      .limit(options?.limit || 50);
  }

  async getPendingChecklist(userId: number, context?: string): Promise<WorkJournalEntry[]> {
    return this.listEntries(userId, {
      context,
      status: ["pending", "in_progress", "blocked"],
      entryType: "task",
    });
  }

  async getRecentJournal(userId: number, options?: { context?: string; days?: number; limit?: number }): Promise<WorkJournalEntry[]> {
    const daysBack = options?.days || 7;
    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    const conditions = [
      eq(workJournal.userId, userId),
      sql`${workJournal.createdAt} >= ${cutoff}`,
    ];

    if (options?.context) {
      conditions.push(eq(workJournal.context, options.context));
    }

    return db.select().from(workJournal)
      .where(and(...conditions))
      .orderBy(desc(workJournal.createdAt))
      .limit(options?.limit || 30);
  }

  async buildJournalContext(userId: number, context?: string): Promise<string> {
    const pending = await this.getPendingChecklist(userId, context);
    const recent = await this.getRecentJournal(userId, { context, days: 3, limit: 15 });

    const recentDone = recent.filter(e => e.status === "done");
    const reflections = recent.filter(e => e.entryType === "reflection" || e.entryType === "strategy");

    if (pending.length === 0 && recentDone.length === 0 && reflections.length === 0) {
      return "";
    }

    let journalCtx = `\n[JOURNAL DE TRAVAIL ULYSSE${context ? ` — ${context.toUpperCase()}` : ""}]\n`;

    if (pending.length > 0) {
      journalCtx += `\n📋 TÂCHES EN COURS (${pending.length}):\n`;
      for (const t of pending) {
        const icon = t.status === "blocked" ? "🔴" : t.status === "in_progress" ? "🔵" : "⬜";
        const prio = t.priority === "critical" ? " ⚠️CRITIQUE" : t.priority === "high" ? " ❗" : "";
        const tags = t.tags?.length ? ` [${t.tags.join(", ")}]` : "";
        const files = t.relatedFiles?.length ? ` → ${t.relatedFiles.slice(0, 3).join(", ")}` : "";
        const due = t.dueDate ? ` (échéance: ${new Date(t.dueDate).toLocaleDateString("fr-FR")})` : "";
        journalCtx += `${icon} #${t.id}${prio}: ${t.title}${tags}${files}${due}\n`;
        if (t.content && t.content.length < 200) {
          journalCtx += `   └─ ${t.content}\n`;
        }
      }
    }

    if (recentDone.length > 0) {
      journalCtx += `\n✅ RÉCEMMENT TERMINÉ (${recentDone.length}):\n`;
      for (const t of recentDone.slice(0, 8)) {
        const ago = this.timeAgo(t.completedAt || t.updatedAt || t.createdAt);
        journalCtx += `✓ #${t.id}: ${t.title} (${ago})${t.outcome ? ` → ${t.outcome.substring(0, 100)}` : ""}\n`;
      }
    }

    if (reflections.length > 0) {
      journalCtx += `\n💭 RÉFLEXIONS & STRATÉGIES:\n`;
      for (const r of reflections.slice(0, 5)) {
        journalCtx += `• ${r.title}: ${(r.content || "").substring(0, 150)}\n`;
      }
    }

    journalCtx += `\nRÈGLE JOURNAL: Tu DOIS mettre à jour le journal via work_journal_manage après chaque action significative. Marque les tâches terminées (check), ajoute les nouvelles demandes de Maurice, note tes réflexions stratégiques. Reprends proactivement les tâches non-complétées.\n`;

    return journalCtx;
  }

  async getStats(userId: number, context?: string): Promise<{
    total: number;
    pending: number;
    inProgress: number;
    done: number;
    blocked: number;
    cancelled: number;
  }> {
    const conditions = [eq(workJournal.userId, userId)];
    if (context) conditions.push(eq(workJournal.context, context));

    const entries = await db.select({ status: workJournal.status })
      .from(workJournal)
      .where(and(...conditions));

    return {
      total: entries.length,
      pending: entries.filter(e => e.status === "pending").length,
      inProgress: entries.filter(e => e.status === "in_progress").length,
      done: entries.filter(e => e.status === "done").length,
      blocked: entries.filter(e => e.status === "blocked").length,
      cancelled: entries.filter(e => e.status === "cancelled").length,
    };
  }

  async deleteEntry(id: number): Promise<boolean> {
    const result = await db.delete(workJournal).where(eq(workJournal.id, id));
    return true;
  }

  private timeAgo(date: Date | null): string {
    if (!date) return "?";
    const ms = Date.now() - new Date(date).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `il y a ${mins}min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `il y a ${hours}h`;
    const days = Math.floor(hours / 24);
    return `il y a ${days}j`;
  }
}

export const workJournalService = WorkJournalService.getInstance();
