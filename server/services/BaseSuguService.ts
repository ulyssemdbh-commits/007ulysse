import { db } from "../db";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { emailActionService } from "./emailActionService";
import { getTodayDate } from "./baseSuguHelpers";

export interface SuguTables {
  categories: any;
  items: any;
  checks: any;
  emailLogs: any;
  futureItems: any;
}

export interface SuguConfig {
  storeName: string;
  emailTo: string;
  emailSubjectPrefix: string;
}

export abstract class BaseSuguService {
  protected tables: SuguTables;
  protected config: SuguConfig;

  constructor(tables: SuguTables, config: SuguConfig) {
    this.tables = tables;
    this.config = config;
  }

  async getCategoriesWithItems() {
    const categories = await db.select().from(this.tables.categories).orderBy(this.tables.categories.sortOrder);
    const items = await db.select().from(this.tables.items).where(eq(this.tables.items.isActive, true)).orderBy(this.tables.items.sortOrder);
    return categories.map((cat: any) => ({
      ...cat,
      items: items.filter((item: any) => item.categoryId === cat.id)
    }));
  }

  async getCategories() {
    return db.select().from(this.tables.categories).orderBy(this.tables.categories.sortOrder);
  }

  async getTodayChecks() {
    const today = getTodayDate();
    return db.select().from(this.tables.checks).where(eq(this.tables.checks.checkDate, today));
  }

  async getDashboardStats() {
    const today = getTodayDate();
    const allItems = await db.select().from(this.tables.items).where(eq(this.tables.items.isActive, true));
    const totalItems = allItems.length;
    const todayChecks = await db.select().from(this.tables.checks).where(eq(this.tables.checks.checkDate, today));
    const checkedItemIds = new Set(todayChecks.filter((c: any) => c.isChecked).map((c: any) => c.itemId));
    const checkedCount = checkedItemIds.size;
    const completionRate = totalItems > 0 ? Math.round((checkedCount / totalItems) * 100) : 0;
    const categories = await db.select().from(this.tables.categories).orderBy(this.tables.categories.sortOrder);
    const categoryStats = categories.map((cat: any) => {
      const catItems = allItems.filter((item: any) => item.categoryId === cat.id);
      const catChecked = catItems.filter((item: any) => checkedItemIds.has(item.id));
      return {
        id: cat.id,
        name: cat.name,
        totalItems: catItems.length,
        checkedItems: catChecked.length,
        completionRate: catItems.length > 0 ? Math.round((catChecked.length / catItems.length) * 100) : 0
      };
    }).filter((c: any) => c.totalItems > 0);
    return { date: today, totalItems, checkedCount, completionRate, categoryStats };
  }

  async getWeeklyStats() {
    const days: Array<{ date: string; dayName: string; totalItems: number; checkedCount: number; completionRate: number }> = [];
    const allItems = await db.select().from(this.tables.items).where(eq(this.tables.items.isActive, true));
    const totalItems = allItems.length;
    const now = new Date();
    const parisNow = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
    for (let i = 6; i >= 0; i--) {
      const targetDate = new Date(parisNow);
      targetDate.setDate(targetDate.getDate() - i);
      const dateStr = targetDate.toISOString().split("T")[0];
      const dayName = targetDate.toLocaleDateString("fr-FR", { weekday: "short" });
      const dayChecks = await db.select().from(this.tables.checks).where(eq(this.tables.checks.checkDate, dateStr));
      const checkedItemIds = new Set(dayChecks.filter((c: any) => c.isChecked).map((c: any) => c.itemId));
      const checkedCount = checkedItemIds.size;
      const completionRate = totalItems > 0 ? Math.round((checkedCount / totalItems) * 100) : 0;
      days.push({ date: dateStr, dayName: dayName.charAt(0).toUpperCase() + dayName.slice(1), totalItems, checkedCount, completionRate });
    }
    const avgCompletion = days.length > 0 ? Math.round(days.reduce((sum, d) => sum + d.completionRate, 0) / days.length) : 0;
    const avgChecked = days.length > 0 ? Math.round(days.reduce((sum, d) => sum + d.checkedCount, 0) / days.length) : 0;
    return {
      startDate: days[0]?.date || getTodayDate(),
      endDate: days[days.length - 1]?.date || getTodayDate(),
      days,
      summary: { averageCompletion: avgCompletion, averageCheckedItems: avgChecked, totalItemsBaseline: totalItems, daysWithActivity: days.filter(d => d.checkedCount > 0).length }
    };
  }

  async toggleCheck(itemId: number, isChecked: boolean) {
    const today = getTodayDate();
    const [existing] = await db.select().from(this.tables.checks)
      .where(and(eq(this.tables.checks.itemId, itemId), eq(this.tables.checks.checkDate, today)));
    if (existing) {
      await db.update(this.tables.checks).set({ isChecked, checkedAt: new Date() }).where(eq(this.tables.checks.id, existing.id));
      return { ...existing, isChecked };
    } else {
      const [newCheck] = await db.insert(this.tables.checks).values({ itemId, checkDate: today, isChecked, checkedAt: new Date() }).returning();
      return newCheck;
    }
  }

  async resetTodayChecks() {
    const today = getTodayDate();
    await db.update(this.tables.checks).set({ isChecked: false, checkedAt: new Date() }).where(eq(this.tables.checks.checkDate, today));
    console.log(`[${this.config.storeName}] Reset all checks for ${today}`);
    return { success: true, date: today };
  }

  async updateItem(itemId: number, data: { name?: string; nameVi?: string | null; nameTh?: string | null; categoryId?: number; sortOrder?: number }) {
    const updateData: Record<string, any> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.nameVi !== undefined) updateData.nameVi = data.nameVi;
    if (data.nameTh !== undefined) updateData.nameTh = data.nameTh;
    if (data.categoryId !== undefined) updateData.categoryId = data.categoryId;
    if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;
    const [updated] = await db.update(this.tables.items).set(updateData).where(eq(this.tables.items.id, itemId)).returning();
    return updated;
  }

  async moveItem(itemId: number, direction: "up" | "down") {
    const [item] = await db.select().from(this.tables.items).where(eq(this.tables.items.id, itemId));
    if (!item) return null;
    const categoryItems = await db.select().from(this.tables.items).where(eq(this.tables.items.categoryId, item.categoryId)).orderBy(this.tables.items.sortOrder);
    const currentIndex = categoryItems.findIndex((i: any) => i.id === itemId);
    if (currentIndex === -1) return null;
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= categoryItems.length) return null;
    const targetItem = categoryItems[targetIndex];
    await db.update(this.tables.items).set({ sortOrder: targetItem.sortOrder }).where(eq(this.tables.items.id, itemId));
    await db.update(this.tables.items).set({ sortOrder: item.sortOrder }).where(eq(this.tables.items.id, targetItem.id));
    return { moved: true };
  }

  async reorderItems(categoryId: number, orderedIds: number[]) {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.update(this.tables.items).set({ sortOrder: i }).where(eq(this.tables.items.id, orderedIds[i]));
    }
    return { reordered: true, count: orderedIds.length };
  }

  async updateCategory(categoryId: number, data: { name?: string; nameVi?: string | null; nameTh?: string | null; sortOrder?: number }) {
    const updateData: Record<string, any> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.nameVi !== undefined) updateData.nameVi = data.nameVi;
    if (data.nameTh !== undefined) updateData.nameTh = data.nameTh;
    if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;
    const [updated] = await db.update(this.tables.categories).set(updateData).where(eq(this.tables.categories.id, categoryId)).returning();
    return updated;
  }

  async reorderCategories(orderedIds: number[]) {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.update(this.tables.categories).set({ sortOrder: i }).where(eq(this.tables.categories.id, orderedIds[i]));
    }
    return true;
  }

  async createCategory(name: string, sheet: "Feuil1" | "Feuil2") {
    const categories = await db.select().from(this.tables.categories).where(eq(this.tables.categories.sheet, sheet));
    const maxSortOrder = categories.length > 0 ? Math.max(...categories.map((c: any) => c.sortOrder)) + 1 : 0;
    const [created] = await db.insert(this.tables.categories).values({ name, sheet, sortOrder: maxSortOrder }).returning();
    return created;
  }

  async deleteCategory(categoryId: number) {
    const items = await db.select().from(this.tables.items).where(eq(this.tables.items.categoryId, categoryId));
    for (const item of items) {
      await db.delete(this.tables.checks).where(eq(this.tables.checks.itemId, item.id));
      await db.delete(this.tables.futureItems).where(eq(this.tables.futureItems.itemId, item.id));
    }
    await db.delete(this.tables.items).where(eq(this.tables.items.categoryId, categoryId));
    await db.delete(this.tables.categories).where(eq(this.tables.categories.id, categoryId));
    return { deleted: true };
  }

  async createItem(name: string, categoryId: number) {
    const items = await db.select().from(this.tables.items).where(eq(this.tables.items.categoryId, categoryId));
    const maxSortOrder = items.length > 0 ? Math.max(...items.map((i: any) => i.sortOrder)) + 1 : 0;
    const [created] = await db.insert(this.tables.items).values({ name, categoryId, sortOrder: maxSortOrder, isActive: true }).returning();
    return created;
  }

  async addItem(data: { categoryId: number; name: string; nameVi?: string | null; nameTh?: string | null }) {
    const items = await db.select().from(this.tables.items).where(eq(this.tables.items.categoryId, data.categoryId));
    const maxSortOrder = items.length > 0 ? Math.max(...items.map((i: any) => i.sortOrder)) + 1 : 0;
    const [created] = await db.insert(this.tables.items).values({
      name: data.name, categoryId: data.categoryId,
      nameVi: data.nameVi || null, nameTh: data.nameTh || null,
      sortOrder: maxSortOrder, isActive: true
    }).returning();
    return created;
  }

  async deleteItem(itemId: number) {
    await db.delete(this.tables.checks).where(eq(this.tables.checks.itemId, itemId));
    await db.delete(this.tables.futureItems).where(eq(this.tables.futureItems.itemId, itemId));
    await db.delete(this.tables.items).where(eq(this.tables.items.id, itemId));
    return { deleted: true };
  }

  abstract getCheckedItemsForToday(): Promise<any[]>;

  async getEmailLogs(limit: number = 30) {
    return db.select().from(this.tables.emailLogs).orderBy(desc(this.tables.emailLogs.sentAt)).limit(limit);
  }

  async getHistory(month?: string) {
    const logs = await db.select().from(this.tables.emailLogs).where(eq(this.tables.emailLogs.success, true)).orderBy(desc(this.tables.emailLogs.sentAt));
    const filteredLogs = month ? logs.filter((log: any) => log.emailDate.startsWith(month)) : logs;
    const items = await db.select().from(this.tables.items);
    const categories = await db.select().from(this.tables.categories);
    return filteredLogs.map((log: any) => {
      let parsedItems: Array<{ itemName: string; categoryName: string }> = [];
      try { parsedItems = JSON.parse(log.itemsList); } catch {}
      const enrichedItems = parsedItems.map(parsed => {
        const item = items.find((i: any) => i.name === parsed.itemName);
        return { id: item?.id || 0, name: parsed.itemName, nameVi: item?.nameVi || null, nameTh: item?.nameTh || null, categoryName: parsed.categoryName };
      });
      return { date: log.emailDate, sentAt: log.sentAt, items: enrichedItems };
    });
  }

  async getFutureItems(targetDate: string): Promise<number[]> {
    const items = await db.select().from(this.tables.futureItems).where(eq(this.tables.futureItems.targetDate, targetDate));
    return items.map((item: any) => item.itemId);
  }

  async addFutureItem(itemId: number, targetDate: string) {
    const [existing] = await db.select().from(this.tables.futureItems)
      .where(and(eq(this.tables.futureItems.itemId, itemId), eq(this.tables.futureItems.targetDate, targetDate)));
    if (existing) return existing;
    const [newItem] = await db.insert(this.tables.futureItems).values({ itemId, targetDate }).returning();
    return newItem;
  }

  async removeFutureItem(itemId: number, targetDate: string) {
    await db.delete(this.tables.futureItems).where(and(eq(this.tables.futureItems.itemId, itemId), eq(this.tables.futureItems.targetDate, targetDate)));
    return { success: true };
  }

  async applyFutureItemsForToday() {
    const today = getTodayDate();
    const futureItems = await this.getFutureItems(today);
    if (futureItems.length === 0) return { applied: 0 };
    for (const itemId of futureItems) {
      await this.toggleCheck(itemId, true);
    }
    await db.delete(this.tables.futureItems).where(eq(this.tables.futureItems.targetDate, today));
    return { applied: futureItems.length };
  }

  async getLowStockAlerts(): Promise<string[]> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoff = sevenDaysAgo.toISOString().split("T")[0];
    const recentChecks = await db.select({
      itemId: this.tables.checks.itemId,
      count: sql<number>`count(*)::int`
    }).from(this.tables.checks)
      .where(and(eq(this.tables.checks.isChecked, true), gte(this.tables.checks.checkDate, cutoff)))
      .groupBy(this.tables.checks.itemId);
    const highDemand = recentChecks.filter((r: any) => r.count >= 4);
    if (highDemand.length === 0) return [];
    const items = await db.select().from(this.tables.items);
    return highDemand.map((r: any) => {
      const item = items.find((i: any) => i.id === r.itemId);
      return item ? `${item.name} (commandé ${r.count}x cette semaine)` : `Article #${r.itemId} (${r.count}x)`;
    });
  }

  async recoverFailedEmails(): Promise<{ checked: number; recovered: number; failed: string[] }> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoffDate = sevenDaysAgo.toISOString().split("T")[0];
    const failedEmails = await db.select().from(this.tables.emailLogs)
      .where(eq(this.tables.emailLogs.success, false))
      .orderBy(desc(this.tables.emailLogs.sentAt))
      .limit(20);
    const recentFailures = failedEmails.filter((e: any) => e.emailDate >= cutoffDate);
    if (recentFailures.length === 0) {
      console.log(`[${this.config.storeName}] No failed emails to recover`);
      return { checked: 0, recovered: 0, failed: [] };
    }
    console.log(`[${this.config.storeName}] Found ${recentFailures.length} failed emails to recover`);
    let recovered = 0;
    const failedRecoveries: string[] = [];
    for (const failedEmail of recentFailures) {
      if (recovered > 0) await new Promise(resolve => setTimeout(resolve, 2000));
      try {
        const result = await this.sendDailyEmail(undefined, new Date(failedEmail.emailDate));
        if (result.success) {
          await db.update(this.tables.emailLogs).set({ success: true, error: null }).where(eq(this.tables.emailLogs.id, failedEmail.id));
          recovered++;
        } else {
          failedRecoveries.push(`${failedEmail.emailDate}: ${result.message}`);
        }
      } catch (e) {
        failedRecoveries.push(`${failedEmail.emailDate}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    console.log(`[${this.config.storeName}] Recovery complete: ${recovered}/${recentFailures.length} emails recovered`);
    return { checked: recentFailures.length, recovered, failed: failedRecoveries };
  }

  async getEmailHealth(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    totalEmails: number; successfulEmails: number; failedEmails: number;
    successRate: number; recentFailures: Array<{ date: string; error: string | null }>;
  }> {
    const logs = await db.select().from(this.tables.emailLogs).orderBy(desc(this.tables.emailLogs.sentAt)).limit(30);
    const totalEmails = logs.length;
    const successfulEmails = logs.filter((l: any) => l.success).length;
    const failedEmails = totalEmails - successfulEmails;
    const successRate = totalEmails > 0 ? (successfulEmails / totalEmails) * 100 : 100;
    const recentFailures = logs.filter((l: any) => !l.success).slice(0, 5).map((l: any) => ({ date: l.emailDate, error: l.error }));
    let status: "healthy" | "degraded" | "unhealthy" = "healthy";
    if (successRate < 70) status = "unhealthy";
    else if (successRate < 90 || failedEmails > 0) status = "degraded";
    return { status, totalEmails, successfulEmails, failedEmails, successRate: Math.round(successRate), recentFailures };
  }

  abstract sendDailyEmail(overrideDay?: string, overrideDate?: Date): Promise<{ success: boolean; message: string }>;

  protected async logEmail(today: string, itemCount: number, checkedItems: any[], success: boolean, error: string | null) {
    await db.insert(this.tables.emailLogs).values({
      emailDate: today,
      itemCount,
      itemsList: JSON.stringify(checkedItems),
      success,
      error
    });
  }

  protected buildWeeklyRecap(weeklyStats: Awaited<ReturnType<BaseSuguService["getWeeklyStats"]>>): string {
    return `

== RÉCAP HEBDO (7 derniers jours) ==
  Taux moyen: ${weeklyStats.summary.averageCompletion}%
  Articles cochés/jour: ${weeklyStats.summary.averageCheckedItems}
  Jours actifs: ${weeklyStats.summary.daysWithActivity}/7
  Période: ${weeklyStats.startDate} → ${weeklyStats.endDate}`;
  }

  protected computeDeliveryDay(overrideDay?: string, overrideDate?: Date): string {
    if (overrideDay) {
      const dateToUse = overrideDate ? new Date(overrideDate) : (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d; })();
      return `${overrideDay} ${dateToUse.getDate()} ${dateToUse.toLocaleDateString("fr-FR", { month: "long" })}`;
    }
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    return tomorrowDate.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  }
}
