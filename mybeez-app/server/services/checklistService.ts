import { eq, and, desc, gte, sql } from "drizzle-orm";
import {
  categories,
  items,
  checks,
  futureItems,
  emailLogs,
  comments,
} from "@shared/schema/checklist";
import { getTenantDb, type TenantDb } from "../tenantDb";
import { RESTAURANTS, type RestaurantConfig } from "@shared/restaurants";
import { getTodayDate } from "./baseSuguHelpers";

// ---------------------------------------------------------------------------
// ChecklistService — one instance per tenant, operates on tenant's own DB
// ---------------------------------------------------------------------------

export class ChecklistService {
  constructor(
    private db: TenantDb,
    private config: RestaurantConfig,
  ) {}

  private get zoneNames(): Record<number, string> {
    return this.config.zoneNames ?? {};
  }

  // ─── Read operations ────────────────────────────────────────────────

  async getCategories() {
    const rows = this.config.features.zones
      ? await this.db.select().from(categories).orderBy(categories.zone, categories.sortOrder)
      : await this.db.select().from(categories).orderBy(categories.sortOrder);

    return rows.map((cat) => ({
      ...cat,
      zoneName: this.zoneNames[cat.zone ?? 0] || (this.config.features.zones ? "AUTRE" : undefined),
    }));
  }

  async getCategoriesWithItems() {
    const cats = this.config.features.zones
      ? await this.db.select().from(categories).orderBy(categories.zone, categories.sortOrder)
      : await this.db.select().from(categories).orderBy(categories.sortOrder);

    const allItems = await this.db
      .select()
      .from(items)
      .where(eq(items.isActive, true))
      .orderBy(items.sortOrder);

    return cats.map((cat) => ({
      ...cat,
      zoneName: this.zoneNames[cat.zone ?? 0] || (this.config.features.zones ? "AUTRE" : undefined),
      items: allItems.filter((i) => i.categoryId === cat.id),
    }));
  }

  async getTodayChecks() {
    const today = getTodayDate();
    return this.db.select().from(checks).where(eq(checks.checkDate, today));
  }

  async getDashboardStats() {
    const today = getTodayDate();
    const allItems = await this.db.select().from(items).where(eq(items.isActive, true));
    const totalItems = allItems.length;

    const todayChecks = await this.db.select().from(checks).where(eq(checks.checkDate, today));
    const checkedIds = new Set(todayChecks.filter((c) => c.isChecked).map((c) => c.itemId));
    const checkedCount = checkedIds.size;
    const completionRate = totalItems > 0 ? Math.round((checkedCount / totalItems) * 100) : 0;

    const cats = this.config.features.zones
      ? await this.db.select().from(categories).orderBy(categories.zone, categories.sortOrder)
      : await this.db.select().from(categories).orderBy(categories.sortOrder);

    const categoryStats = cats
      .map((cat) => {
        const catItems = allItems.filter((i) => i.categoryId === cat.id);
        const catChecked = catItems.filter((i) => checkedIds.has(i.id));
        return {
          id: cat.id,
          name: cat.name,
          zoneName: this.zoneNames[cat.zone ?? 0] || (this.config.features.zones ? "AUTRE" : undefined),
          totalItems: catItems.length,
          checkedItems: catChecked.length,
          completionRate: catItems.length > 0 ? Math.round((catChecked.length / catItems.length) * 100) : 0,
        };
      })
      .filter((c) => c.totalItems > 0);

    return { date: today, totalItems, checkedCount, completionRate, categoryStats };
  }

  async getWeeklyStats() {
    const allItems = await this.db.select().from(items).where(eq(items.isActive, true));
    const totalItems = allItems.length;

    const now = new Date();
    const parisNow = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" }));

    const days: Array<{
      date: string;
      dayName: string;
      totalItems: number;
      checkedCount: number;
      completionRate: number;
    }> = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(parisNow);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      const dayName = d.toLocaleDateString("fr-FR", { weekday: "short" });

      const dayChecks = await this.db.select().from(checks).where(eq(checks.checkDate, dateStr));
      const checkedCount = new Set(dayChecks.filter((c) => c.isChecked).map((c) => c.itemId)).size;
      const completionRate = totalItems > 0 ? Math.round((checkedCount / totalItems) * 100) : 0;

      days.push({
        date: dateStr,
        dayName: dayName.charAt(0).toUpperCase() + dayName.slice(1),
        totalItems,
        checkedCount,
        completionRate,
      });
    }

    const avgCompletion = days.length > 0 ? Math.round(days.reduce((s, d) => s + d.completionRate, 0) / days.length) : 0;
    const avgChecked = days.length > 0 ? Math.round(days.reduce((s, d) => s + d.checkedCount, 0) / days.length) : 0;

    return {
      startDate: days[0]?.date || getTodayDate(),
      endDate: days[days.length - 1]?.date || getTodayDate(),
      days,
      summary: {
        averageCompletion: avgCompletion,
        averageCheckedItems: avgChecked,
        totalItemsBaseline: totalItems,
        daysWithActivity: days.filter((d) => d.checkedCount > 0).length,
      },
    };
  }

  async getHistory(month?: string) {
    const logs = await this.db
      .select()
      .from(emailLogs)
      .where(eq(emailLogs.success, true))
      .orderBy(desc(emailLogs.sentAt));

    const filtered = month ? logs.filter((l) => l.emailDate.startsWith(month)) : logs;

    const allItems = await this.db.select().from(items);
    const allCats = await this.db.select().from(categories);

    return filtered.map((log) => {
      let parsed: Array<{ itemName: string; categoryName: string }> = [];
      try {
        parsed = JSON.parse(log.itemsList);
      } catch {
        parsed = [];
      }

      const enriched = parsed.map((p) => {
        const item = allItems.find((i) => i.name === p.itemName);
        return {
          id: item?.id || 0,
          itemName: p.itemName,
          categoryName: p.categoryName,
          nameVi: item?.nameVi || null,
          nameTh: item?.nameTh || null,
        };
      });

      return {
        id: log.id,
        date: log.emailDate,
        sentAt: log.sentAt,
        itemCount: log.itemCount,
        items: enriched,
      };
    });
  }

  async getCheckedItemsForToday() {
    const today = getTodayDate();
    const todayChecks = await this.db
      .select()
      .from(checks)
      .where(and(eq(checks.checkDate, today), eq(checks.isChecked, true)));

    if (todayChecks.length === 0) return [];

    const allItems = await this.db.select().from(items).orderBy(items.sortOrder);
    const allCats = this.config.features.zones
      ? await this.db.select().from(categories).orderBy(categories.zone, categories.sortOrder)
      : await this.db.select().from(categories).orderBy(categories.sortOrder);

    return todayChecks
      .map((c) => {
        const item = allItems.find((i) => i.id === c.itemId);
        const cat = item ? allCats.find((ct) => ct.id === item.categoryId) : null;
        return {
          itemName: item?.name || "Unknown",
          categoryName: cat?.name || "Unknown",
          zone: cat?.zone ?? 99,
          zoneName: cat ? this.zoneNames[cat.zone ?? 0] || "AUTRE" : "AUTRE",
          categorySortOrder: cat?.sortOrder ?? 999,
          itemSortOrder: item?.sortOrder ?? 999,
          checkedAt: c.checkedAt,
        };
      })
      .sort((a, b) => {
        if (a.zone !== b.zone) return a.zone - b.zone;
        if (a.categorySortOrder !== b.categorySortOrder) return a.categorySortOrder - b.categorySortOrder;
        return a.itemSortOrder - b.itemSortOrder;
      });
  }

  async getEmailLogs(limit = 30) {
    return this.db.select().from(emailLogs).orderBy(desc(emailLogs.sentAt)).limit(limit);
  }

  async getFutureItems(targetDate: string): Promise<number[]> {
    const rows = await this.db.select().from(futureItems).where(eq(futureItems.targetDate, targetDate));
    return rows.map((r) => r.itemId);
  }

  // ─── Write operations ───────────────────────────────────────────────

  async toggleCheck(itemId: number, isChecked: boolean) {
    const today = getTodayDate();
    const [existing] = await this.db
      .select()
      .from(checks)
      .where(and(eq(checks.itemId, itemId), eq(checks.checkDate, today)));

    if (existing) {
      await this.db.update(checks).set({ isChecked, checkedAt: new Date() }).where(eq(checks.id, existing.id));
      return { ...existing, isChecked };
    }
    const [created] = await this.db.insert(checks).values({ itemId, checkDate: today, isChecked, checkedAt: new Date() }).returning();
    return created;
  }

  async resetTodayChecks() {
    const today = getTodayDate();
    await this.db.update(checks).set({ isChecked: false, checkedAt: new Date() }).where(eq(checks.checkDate, today));
    return { success: true, date: today };
  }

  async updateItem(itemId: number, data: { name?: string; nameVi?: string | null; nameTh?: string | null; categoryId?: number; sortOrder?: number }) {
    const u: Record<string, any> = {};
    if (data.name !== undefined) u.name = data.name;
    if (data.nameVi !== undefined) u.nameVi = data.nameVi;
    if (data.nameTh !== undefined) u.nameTh = data.nameTh;
    if (data.categoryId !== undefined) u.categoryId = data.categoryId;
    if (data.sortOrder !== undefined) u.sortOrder = data.sortOrder;
    const [updated] = await this.db.update(items).set(u).where(eq(items.id, itemId)).returning();
    return updated;
  }

  async moveItem(itemId: number, direction: "up" | "down") {
    const [item] = await this.db.select().from(items).where(eq(items.id, itemId));
    if (!item) return null;

    const catItems = await this.db.select().from(items).where(eq(items.categoryId, item.categoryId)).orderBy(items.sortOrder);
    const idx = catItems.findIndex((i) => i.id === itemId);
    if (idx === -1) return null;

    const target = direction === "up" ? idx - 1 : idx + 1;
    if (target < 0 || target >= catItems.length) return null;

    const other = catItems[target];
    await this.db.update(items).set({ sortOrder: other.sortOrder }).where(eq(items.id, itemId));
    await this.db.update(items).set({ sortOrder: item.sortOrder }).where(eq(items.id, other.id));
    return { moved: true };
  }

  async reorderItems(categoryId: number, orderedIds: number[]) {
    for (let i = 0; i < orderedIds.length; i++) {
      await this.db.update(items).set({ sortOrder: i }).where(eq(items.id, orderedIds[i]));
    }
    return { reordered: true, count: orderedIds.length };
  }

  async updateCategory(categoryId: number, data: { name?: string; nameVi?: string | null; nameTh?: string | null; sortOrder?: number }) {
    const u: Record<string, any> = {};
    if (data.name !== undefined) u.name = data.name;
    if (data.nameVi !== undefined) u.nameVi = data.nameVi;
    if (data.nameTh !== undefined) u.nameTh = data.nameTh;
    if (data.sortOrder !== undefined) u.sortOrder = data.sortOrder;
    const [updated] = await this.db.update(categories).set(u).where(eq(categories.id, categoryId)).returning();
    return updated;
  }

  async reorderCategories(orderedIds: number[]) {
    for (let i = 0; i < orderedIds.length; i++) {
      await this.db.update(categories).set({ sortOrder: i }).where(eq(categories.id, orderedIds[i]));
    }
    return true;
  }

  async createCategory(name: string, sheet: "Feuil1" | "Feuil2") {
    const existing = await this.db.select().from(categories).where(eq(categories.sheet, sheet));
    const maxSort = existing.length > 0 ? Math.max(...existing.map((c) => c.sortOrder)) + 1 : 0;
    const [created] = await this.db.insert(categories).values({ name, sheet, sortOrder: maxSort }).returning();
    return created;
  }

  async deleteCategory(categoryId: number) {
    const catItems = await this.db.select().from(items).where(eq(items.categoryId, categoryId));
    for (const item of catItems) {
      await this.db.delete(checks).where(eq(checks.itemId, item.id));
      await this.db.delete(futureItems).where(eq(futureItems.itemId, item.id));
    }
    await this.db.delete(items).where(eq(items.categoryId, categoryId));
    await this.db.delete(categories).where(eq(categories.id, categoryId));
    return { deleted: true };
  }

  async createItem(name: string, categoryId: number) {
    const existing = await this.db.select().from(items).where(eq(items.categoryId, categoryId));
    const maxSort = existing.length > 0 ? Math.max(...existing.map((i) => i.sortOrder)) + 1 : 0;
    const [created] = await this.db.insert(items).values({ name, categoryId, sortOrder: maxSort, isActive: true }).returning();
    return created;
  }

  async deleteItem(itemId: number) {
    await this.db.delete(checks).where(eq(checks.itemId, itemId));
    await this.db.delete(futureItems).where(eq(futureItems.itemId, itemId));
    await this.db.delete(items).where(eq(items.id, itemId));
    return { deleted: true };
  }

  async addFutureItem(itemId: number, targetDate: string) {
    const [existing] = await this.db
      .select()
      .from(futureItems)
      .where(and(eq(futureItems.itemId, itemId), eq(futureItems.targetDate, targetDate)));
    if (existing) return existing;
    const [created] = await this.db.insert(futureItems).values({ itemId, targetDate }).returning();
    return created;
  }

  async removeFutureItem(data: { itemId: number; targetDate: string }) {
    await this.db.delete(futureItems).where(and(eq(futureItems.itemId, data.itemId), eq(futureItems.targetDate, data.targetDate)));
    return { success: true };
  }

  async sendDailyEmail(): Promise<{ success: boolean; message: string }> {
    const today = getTodayDate();
    const checkedItems = await this.getCheckedItemsForToday();

    // Log the email
    await this.db.insert(emailLogs).values({
      emailDate: today,
      itemCount: checkedItems.length,
      itemsList: JSON.stringify(checkedItems),
      success: true,
    });

    return { success: true, message: `Logged ${checkedItems.length} items for ${today}` };
  }
}

// ---------------------------------------------------------------------------
// Factory — one instance per tenant, cached
// ---------------------------------------------------------------------------

const serviceCache = new Map<string, ChecklistService>();

export function getChecklistService(tenantId: string): ChecklistService {
  if (serviceCache.has(tenantId)) return serviceCache.get(tenantId)!;

  const config = RESTAURANTS[tenantId];
  if (!config) throw new Error(`Unknown tenant: ${tenantId}`);

  const db = getTenantDb(tenantId);
  const service = new ChecklistService(db, config);
  serviceCache.set(tenantId, service);
  return service;
}
