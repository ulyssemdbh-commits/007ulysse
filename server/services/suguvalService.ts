import { db } from "../db";
import { suguvalCategories, suguvalItems, suguvalChecks, suguvalEmailLogs, suguvalFutureItems, suguvalComments, sugumaillaneCategories, sugumaillaneItems } from "@shared/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { emailActionService } from "./emailActionService";
import { calendarService } from "./googleCalendarService";
import { getTodayDate } from "./baseSuguHelpers";

const SUGUVAL_EMAIL_TO = process.env.SUGUVAL_EMAIL_TO || "sugu.gestion@gmail.com";

const ZONE_NAMES: Record<number, string> = {
  1: "CUISINE",
  2: "SUSHI BAR",
  3: "RÉSERVE SÈCHE",
  4: "HYGIÈNE & CONSOMMABLES",
  5: "BOISSONS",
  6: "LIVRAISON & EMBALLAGES"
};

const ZONE_ORDER = [1, 2, 3, 4, 5, 6];

class SuguvalService {
  // Get just categories (without items) - for management
  async getCategories() {
    const categories = await db.select().from(suguvalCategories).orderBy(suguvalCategories.zone, suguvalCategories.sortOrder);
    return categories.map(cat => ({
      ...cat,
      zoneName: ZONE_NAMES[cat.zone] || "AUTRE"
    }));
  }

  // Get all categories with their items (sorted by zone first, then sortOrder)
  async getCategoriesWithItems() {
    const categories = await db.select().from(suguvalCategories).orderBy(suguvalCategories.zone, suguvalCategories.sortOrder);
    const items = await db.select().from(suguvalItems).where(eq(suguvalItems.isActive, true)).orderBy(suguvalItems.sortOrder);
    
    return categories.map(cat => ({
      ...cat,
      zoneName: ZONE_NAMES[cat.zone] || "AUTRE",
      items: items.filter(item => item.categoryId === cat.id)
    }));
  }

  // Get today's checks
  async getTodayChecks() {
    const today = getTodayDate();
    return db.select().from(suguvalChecks).where(eq(suguvalChecks.checkDate, today));
  }

  // Get dashboard stats for today
  async getDashboardStats() {
    const today = getTodayDate();
    
    // Get all active items
    const allItems = await db.select().from(suguvalItems).where(eq(suguvalItems.isActive, true));
    const totalItems = allItems.length;
    
    // Get today's checks
    const todayChecks = await db.select().from(suguvalChecks).where(eq(suguvalChecks.checkDate, today));
    const checkedItemIds = new Set(todayChecks.filter(c => c.isChecked).map(c => c.itemId));
    const checkedCount = checkedItemIds.size;
    
    // Calculate completion rate
    const completionRate = totalItems > 0 ? Math.round((checkedCount / totalItems) * 100) : 0;
    
    // Get categories with their completion stats
    const categories = await db.select().from(suguvalCategories).orderBy(suguvalCategories.zone, suguvalCategories.sortOrder);
    
    const categoryStats = categories.map(cat => {
      const catItems = allItems.filter(item => item.categoryId === cat.id);
      const catChecked = catItems.filter(item => checkedItemIds.has(item.id));
      return {
        id: cat.id,
        name: cat.name,
        zoneName: ZONE_NAMES[cat.zone] || "AUTRE",
        totalItems: catItems.length,
        checkedItems: catChecked.length,
        completionRate: catItems.length > 0 ? Math.round((catChecked.length / catItems.length) * 100) : 0
      };
    }).filter(c => c.totalItems > 0);
    
    return {
      date: today,
      totalItems,
      checkedCount,
      completionRate,
      categoryStats
    };
  }

  // Get weekly stats (last 7 days) for historical trend analysis
  async getWeeklyStats() {
    const days: Array<{
      date: string;
      dayName: string;
      totalItems: number;
      checkedCount: number;
      completionRate: number;
    }> = [];

    // Get all active items count (baseline)
    const allItems = await db.select().from(suguvalItems).where(eq(suguvalItems.isActive, true));
    const totalItems = allItems.length;

    // Get last 7 days of check data
    const now = new Date();
    const parisNow = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
    
    for (let i = 6; i >= 0; i--) {
      const targetDate = new Date(parisNow);
      targetDate.setDate(targetDate.getDate() - i);
      const dateStr = targetDate.toISOString().split("T")[0];
      const dayName = targetDate.toLocaleDateString("fr-FR", { weekday: "short" });
      
      // Get checks for this day
      const dayChecks = await db.select().from(suguvalChecks).where(eq(suguvalChecks.checkDate, dateStr));
      const checkedItemIds = new Set(dayChecks.filter(c => c.isChecked).map(c => c.itemId));
      const checkedCount = checkedItemIds.size;
      const completionRate = totalItems > 0 ? Math.round((checkedCount / totalItems) * 100) : 0;
      
      days.push({
        date: dateStr,
        dayName: dayName.charAt(0).toUpperCase() + dayName.slice(1),
        totalItems,
        checkedCount,
        completionRate
      });
    }

    // Calculate weekly averages
    const avgCompletion = days.length > 0 
      ? Math.round(days.reduce((sum, d) => sum + d.completionRate, 0) / days.length)
      : 0;
    const avgChecked = days.length > 0
      ? Math.round(days.reduce((sum, d) => sum + d.checkedCount, 0) / days.length)
      : 0;

    return {
      startDate: days[0]?.date || getTodayDate(),
      endDate: days[days.length - 1]?.date || getTodayDate(),
      days,
      summary: {
        averageCompletion: avgCompletion,
        averageCheckedItems: avgChecked,
        totalItemsBaseline: totalItems,
        daysWithActivity: days.filter(d => d.checkedCount > 0).length
      }
    };
  }

  // Toggle item check for today
  async toggleCheck(itemId: number, isChecked: boolean) {
    const today = getTodayDate();
    
    // Check if there's already a check for today
    const [existing] = await db.select().from(suguvalChecks)
      .where(and(eq(suguvalChecks.itemId, itemId), eq(suguvalChecks.checkDate, today)));
    
    if (existing) {
      // Update existing
      await db.update(suguvalChecks)
        .set({ isChecked, checkedAt: new Date() })
        .where(eq(suguvalChecks.id, existing.id));
      return { ...existing, isChecked };
    } else {
      // Create new
      const [newCheck] = await db.insert(suguvalChecks)
        .values({ itemId, checkDate: today, isChecked, checkedAt: new Date() })
        .returning();
      return newCheck;
    }
  }

  // Reset all checks for today
  async resetTodayChecks() {
    const today = getTodayDate();
    
    // Update all checks for today to isChecked = false
    await db.update(suguvalChecks)
      .set({ isChecked: false, checkedAt: new Date() })
      .where(eq(suguvalChecks.checkDate, today));
    
    console.log(`[Suguval] Reset all checks for ${today}`);
    return { success: true, date: today };
  }

  // Update item translations and category
  async updateItem(itemId: number, data: { name?: string; nameVi?: string | null; nameTh?: string | null; categoryId?: number; sortOrder?: number }) {
    const updateData: Record<string, any> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.nameVi !== undefined) updateData.nameVi = data.nameVi;
    if (data.nameTh !== undefined) updateData.nameTh = data.nameTh;
    if (data.categoryId !== undefined) updateData.categoryId = data.categoryId;
    if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;
    
    const [updated] = await db.update(suguvalItems)
      .set(updateData)
      .where(eq(suguvalItems.id, itemId))
      .returning();
    return updated;
  }

  async moveItem(itemId: number, direction: "up" | "down") {
    const [item] = await db.select().from(suguvalItems).where(eq(suguvalItems.id, itemId));
    if (!item) return null;

    const categoryItems = await db.select()
      .from(suguvalItems)
      .where(eq(suguvalItems.categoryId, item.categoryId))
      .orderBy(suguvalItems.sortOrder);

    const currentIndex = categoryItems.findIndex(i => i.id === itemId);
    if (currentIndex === -1) return null;

    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= categoryItems.length) return null;

    const targetItem = categoryItems[targetIndex];
    
    await db.update(suguvalItems).set({ sortOrder: targetItem.sortOrder }).where(eq(suguvalItems.id, itemId));
    await db.update(suguvalItems).set({ sortOrder: item.sortOrder }).where(eq(suguvalItems.id, targetItem.id));

    return { moved: true };
  }

  async reorderItems(categoryId: number, orderedIds: number[]) {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.update(suguvalItems)
        .set({ sortOrder: i })
        .where(eq(suguvalItems.id, orderedIds[i]));
    }
    return { reordered: true, count: orderedIds.length };
  }

  // Update category name or sort order
  async updateCategory(categoryId: number, data: { name?: string; nameVi?: string | null; nameTh?: string | null; sortOrder?: number }) {
    const updateData: Record<string, any> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.nameVi !== undefined) updateData.nameVi = data.nameVi;
    if (data.nameTh !== undefined) updateData.nameTh = data.nameTh;
    if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;
    
    const [updated] = await db.update(suguvalCategories)
      .set(updateData)
      .where(eq(suguvalCategories.id, categoryId))
      .returning();
    return updated;
  }

  // Reorder categories by setting sortOrder based on array position
  async reorderCategories(orderedIds: number[]) {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.update(suguvalCategories)
        .set({ sortOrder: i })
        .where(eq(suguvalCategories.id, orderedIds[i]));
    }
    return true;
  }

  // Create a new category
  async createCategory(name: string, sheet: "Feuil1" | "Feuil2") {
    const categories = await db.select().from(suguvalCategories).where(eq(suguvalCategories.sheet, sheet));
    const maxSortOrder = categories.length > 0 ? Math.max(...categories.map(c => c.sortOrder)) + 1 : 0;
    
    const [created] = await db.insert(suguvalCategories)
      .values({ name, sheet, sortOrder: maxSortOrder })
      .returning();
    return created;
  }

  // Add category with zone (for AI management) - zone determines sheet automatically
  async addCategory(name: string, zone: number = 1) {
    // Zone 1-2 = Feuil1 (Cuisine), Zone 3-6 = Feuil2 (Reserve)
    const sheet = zone <= 2 ? "Feuil1" : "Feuil2";
    const categories = await db.select().from(suguvalCategories).where(eq(suguvalCategories.zone, zone));
    const maxSortOrder = categories.length > 0 ? Math.max(...categories.map(c => c.sortOrder)) + 1 : 0;
    
    const [created] = await db.insert(suguvalCategories)
      .values({ name, sheet, zone, sortOrder: maxSortOrder })
      .returning();
    return created;
  }

  // Delete a category and all its items (including related checks/future items)
  async deleteCategory(categoryId: number) {
    // Get all items in this category
    const items = await db.select().from(suguvalItems).where(eq(suguvalItems.categoryId, categoryId));
    
    // Delete checks and future items for each item
    for (const item of items) {
      await db.delete(suguvalChecks).where(eq(suguvalChecks.itemId, item.id));
      await db.delete(suguvalFutureItems).where(eq(suguvalFutureItems.itemId, item.id));
    }
    
    // Delete all items in the category
    await db.delete(suguvalItems).where(eq(suguvalItems.categoryId, categoryId));
    
    // Delete the category itself
    await db.delete(suguvalCategories).where(eq(suguvalCategories.id, categoryId));
    return { deleted: true };
  }

  // Create a new item in a category
  async createItem(name: string, categoryId: number) {
    const items = await db.select().from(suguvalItems).where(eq(suguvalItems.categoryId, categoryId));
    const maxSortOrder = items.length > 0 ? Math.max(...items.map(i => i.sortOrder)) + 1 : 0;
    
    const [created] = await db.insert(suguvalItems)
      .values({ name, categoryId, sortOrder: maxSortOrder, isActive: true })
      .returning();
    return created;
  }

  // Add item with translations (for AI management)
  async addItem(data: { categoryId: number; name: string; nameVi?: string | null; nameTh?: string | null }) {
    const items = await db.select().from(suguvalItems).where(eq(suguvalItems.categoryId, data.categoryId));
    const maxSortOrder = items.length > 0 ? Math.max(...items.map(i => i.sortOrder)) + 1 : 0;
    
    const [created] = await db.insert(suguvalItems)
      .values({ 
        name: data.name, 
        categoryId: data.categoryId, 
        nameVi: data.nameVi || null,
        nameTh: data.nameTh || null,
        sortOrder: maxSortOrder, 
        isActive: true 
      })
      .returning();
    return created;
  }

  // Delete an item
  async deleteItem(itemId: number) {
    await db.delete(suguvalChecks).where(eq(suguvalChecks.itemId, itemId));
    await db.delete(suguvalFutureItems).where(eq(suguvalFutureItems.itemId, itemId));
    await db.delete(suguvalItems).where(eq(suguvalItems.id, itemId));
    return { deleted: true };
  }

  // Get checked items for today (for email) - sorted by zone
  async getCheckedItemsForToday() {
    const today = getTodayDate();
    const checks = await db.select().from(suguvalChecks)
      .where(and(eq(suguvalChecks.checkDate, today), eq(suguvalChecks.isChecked, true)));
    
    if (checks.length === 0) return [];

    // Fetch items ordered by their sortOrder so item order within category is preserved
    const items = await db.select().from(suguvalItems).orderBy(suguvalItems.sortOrder);
    // Categories already ordered by zone then sortOrder — this matches the UI display order exactly
    const categories = await db.select().from(suguvalCategories).orderBy(suguvalCategories.zone, suguvalCategories.sortOrder);
    
    return checks.map(check => {
      const item = items.find(i => i.id === check.itemId);
      const category = item ? categories.find(c => c.id === item.categoryId) : null;
      return {
        itemName: item?.name || "Unknown",
        categoryName: category?.name || "Unknown",
        zone: category?.zone ?? 99,
        zoneName: category ? (ZONE_NAMES[category.zone] || "AUTRE") : "AUTRE",
        categorySortOrder: category?.sortOrder ?? 999,
        itemSortOrder: item?.sortOrder ?? 999,
        checkedAt: check.checkedAt
      };
    }).sort((a, b) => {
      // Match exact UI display order: zone → category sortOrder → item sortOrder
      if (a.zone !== b.zone) return a.zone - b.zone;
      if (a.categorySortOrder !== b.categorySortOrder) return a.categorySortOrder - b.categorySortOrder;
      return a.itemSortOrder - b.itemSortOrder;
    });
  }

  // Send daily email at 23:59
  // overrideDay: optionnel, pour spécifier un jour précis (ex: "Lundi" pour l'envoi du dimanche)
  async sendDailyEmail(overrideDay?: string, overrideDate?: Date): Promise<{ success: boolean; message: string }> {
    const today = getTodayDate();
    const checkedItems = await this.getCheckedItemsForToday();
    
    // ALWAYS send email, even with 0 items
    console.log(`[Suguval] Sending email with ${checkedItems.length} checked items`);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const comments = await db.select().from(suguvalComments)
      .where(gte(suguvalComments.createdAt, todayStart))
      .orderBy(suguvalComments.createdAt);

    // Group by zone first, then by category within each zone
    const byZone: Record<number, Record<string, string[]>> = {};
    for (const item of checkedItems) {
      if (!byZone[item.zone]) {
        byZone[item.zone] = {};
      }
      if (!byZone[item.zone][item.categoryName]) {
        byZone[item.zone][item.categoryName] = [];
      }
      byZone[item.zone][item.categoryName].push(item.itemName);
    }

    // Build email content grouped by zone
    const knownZones = ZONE_ORDER.filter(zone => byZone[zone]);
    const unknownZones = Object.keys(byZone).map(Number).filter(z => !ZONE_ORDER.includes(z));
    
    const itemsList = [...knownZones, ...unknownZones]
      .map(zone => {
        const zoneName = ZONE_NAMES[zone] || "AUTRE";
        const categories = byZone[zone];
        const catItems = Object.entries(categories)
          .map(([cat, items]) => `  ${cat}:\n${items.map(i => `    - ${i}`).join("\n")}`)
          .join("\n");
        return `\n== ${zoneName} ==\n${catItems}`;
      })
      .join("\n");

    // Build comments section
    let commentsSection = "";
    if (comments.length > 0) {
      commentsSection = `\n\n== COMMENTAIRES ==\n${comments.map(c => `  [${c.author}]: ${c.message}`).join("\n")}`;
    }

    // Calculate delivery day
    let deliveryDayStr: string;
    if (overrideDay) {
      // Use override day; use overrideDate if provided (e.g., Monday 02:00 → today's date), otherwise tomorrow
      const dateToUse = overrideDate ? new Date(overrideDate) : (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d; })();
      deliveryDayStr = `${overrideDay} ${dateToUse.getDate()} ${dateToUse.toLocaleDateString("fr-FR", { month: "long" })}`;
    } else {
      const tomorrowDate = new Date();
      tomorrowDate.setDate(tomorrowDate.getDate() + 1);
      deliveryDayStr = tomorrowDate.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    }

    // Get weekly stats for recap
    const weeklyStats = await this.getWeeklyStats();
    const weeklyRecap = `

== RÉCAP HEBDO (7 derniers jours) ==
  Taux moyen: ${weeklyStats.summary.averageCompletion}%
  Articles cochés/jour: ${weeklyStats.summary.averageCheckedItems}
  Jours actifs: ${weeklyStats.summary.daysWithActivity}/7
  Période: ${weeklyStats.startDate} → ${weeklyStats.endDate}`;

    // Build email content - handle 0 items case
    const emailContent = checkedItems.length === 0 
      ? `Bonjour,

Aucun article n'a été coché aujourd'hui pour ${deliveryDayStr}.

Total: 0 articles à acheter.
${weeklyRecap}

---
Ce message a été envoyé automatiquement par le système de gestion Suguval.`
      : `Bonjour,

Voici la liste des courses à effectuer pour ${deliveryDayStr}:
${itemsList}${commentsSection}

Total: ${checkedItems.length} articles à acheter.
${weeklyRecap}

---
Ce message a été envoyé automatiquement par le système de gestion Suguval.`;

    try {
      // Use emailActionService to send email
      const results = await emailActionService.executeActions([{
        type: "send",
        to: SUGUVAL_EMAIL_TO,
        subject: `[SUGUVAL] Liste des courses - ${deliveryDayStr}`,
        body: emailContent
      }], 'ulysse', 1);

      const result = results[0] || { success: false, error: "No result" };

      // Log the email
      await db.insert(suguvalEmailLogs).values({
        emailDate: today,
        itemCount: checkedItems.length,
        itemsList: JSON.stringify(checkedItems),
        success: result.success,
        error: result.success ? null : (result.error || null)
      });

      // Add calendar event for delivery day
      try {
        const tomorrowDate = new Date();
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);
        const calendarStart = new Date(tomorrowDate);
        calendarStart.setHours(8, 0, 0, 0);
        const calendarEnd = new Date(tomorrowDate);
        calendarEnd.setHours(10, 0, 0, 0);
        
        await calendarService.createEvent(
          1, // System user
          `[SUGUVAL] Livraison courses - ${checkedItems.length} articles`,
          calendarStart,
          calendarEnd,
          { description: `Liste de courses envoyée:\n${checkedItems.map(i => `- ${i.itemName}`).join('\n')}` }
        );
        console.log(`[Suguval] Calendar event created for ${deliveryDayStr}`);
      } catch (calErr) {
        console.warn(`[Suguval] Calendar event failed:`, calErr);
      }

      console.log(`[Suguval] Daily email sent: ${checkedItems.length} items`);
      return { success: true, message: `Email sent with ${checkedItems.length} items` };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      
      // Log the failure
      await db.insert(suguvalEmailLogs).values({
        emailDate: today,
        itemCount: checkedItems.length,
        itemsList: JSON.stringify(checkedItems),
        success: false,
        error: errorMsg
      });

      console.error("[Suguval] Email failed:", errorMsg);
      return { success: false, message: errorMsg };
    }
  }

  // Initialize categories and items from Excel data
  async initializeFromExcel() {
    // Check if already initialized
    const existingCategories = await db.select().from(suguvalCategories);
    if (existingCategories.length > 0) {
      console.log("[Suguval] Already initialized with", existingCategories.length, "categories");
      return;
    }

    console.log("[Suguval] Initializing categories and items from Excel...");

    // Categories from Feuil1
    const feuil1Categories = [
      { name: "RESERVE SECHE", sheet: "Feuil1", sortOrder: 0 },
      { name: "HUILES & DESSERTS", sheet: "Feuil1", sortOrder: 1 },
      { name: "POSTE LIVRAISON", sheet: "Feuil1", sortOrder: 2 },
      { name: "BOISSONS LIVRAISON", sheet: "Feuil1", sortOrder: 3 },
      { name: "BOISSONS SUR PLACE", sheet: "Feuil1", sortOrder: 4 },
      { name: "HYGIENE & CONSOMMABLES", sheet: "Feuil1", sortOrder: 5 },
      { name: "CAFE & THE", sheet: "Feuil1", sortOrder: 6 },
    ];

    // Categories from Feuil2 (Cuisine)
    const feuil2Categories = [
      { name: "VIANDES & POISSONS", sheet: "Feuil2", sortOrder: 7 },
      { name: "LEGUMES", sheet: "Feuil2", sortOrder: 8 },
      { name: "CHAMPIGNONS", sheet: "Feuil2", sortOrder: 9 },
      { name: "FRUITS", sheet: "Feuil2", sortOrder: 10 },
      { name: "HERBES & EPICES", sheet: "Feuil2", sortOrder: 11 },
    ];

    const allCategories = [...feuil1Categories, ...feuil2Categories];
    const insertedCategories = await db.insert(suguvalCategories).values(allCategories).returning();

    // Items data
    const itemsData: { category: string; items: { name: string; nameVi?: string }[] }[] = [
      {
        category: "RESERVE SECHE",
        items: [
          { name: "RIZ" }, { name: "SEL" }, { name: "POIVRE" }, { name: "MOUTARDE" }, { name: "MAYONNAISE" },
          { name: "HARISSA" }, { name: "THON NATURE" }, { name: "MAIS" }, { name: "FARINE" }, { name: "PUREE" },
          { name: "VERMICELLE DE RIZ" }, { name: "VERMICELLE pour NEMS" }, { name: "NOUILLES BLANCHES" },
          { name: "NOUILLES JAUNES" }, { name: "PAD THAI" }, { name: "GALETTE DE RIZ Diam18" },
          { name: "GALETTE DE RIZ Diam28" }, { name: "GALETTE DE RIZ carré19" }, { name: "PANKO" },
          { name: "SESAME BLANC" }, { name: "SESAME NOIR" }, { name: "CACAHUETE" }, { name: "OIGNONS FRITS" },
          { name: "ALGUES" }, { name: "SALADE ALGUES" }
        ]
      },
      {
        category: "HUILES & DESSERTS",
        items: [
          { name: "HUILE DE TOURNESOL" }, { name: "HUILE D'OLIVE" }, { name: "HUILE DE SESAME" },
          { name: "OEUFS" }, { name: "SUCRE EN SAC" }, { name: "CHAPELURE" }, { name: "Chocolat DELINUT" },
          { name: "Chocolat liquide" }, { name: "Chocolat Buchette" }, { name: "AMANDES Grillées" },
          { name: "BOUDOIRS" }, { name: "CREME LIQUIDE DESSERT" }, { name: "CHANTILLY" }, { name: "CACAO" },
          { name: "MIEL" }, { name: "CONFITURE FIGUE" }, { name: "WASABI" }, { name: "GINGEMBRE" },
          { name: "SAUCE SOJA" }, { name: "SAUCE MIRYNE" }, { name: "SAUCE NEMS" }
        ]
      },
      {
        category: "POSTE LIVRAISON",
        items: [
          { name: "Petits SACS" }, { name: "Grand SACS" }, { name: "Baguettes" }, { name: "Couverts" },
          { name: "Serviettes Blanches" }, { name: "Serviettes Noires" }, { name: "Barquettes 6" },
          { name: "Barquettes 12" }, { name: "Barquettes 18" }, { name: "Barquettes KHAO" },
          { name: "Bowls Edamme" }, { name: "Bowls RTT" }, { name: "Pots Nouilles" }, { name: "Pots Nems" },
          { name: "Pot sauces Nems" }
        ]
      },
      {
        category: "BOISSONS LIVRAISON",
        items: [
          { name: "COCA" }, { name: "COCA ZERO" }, { name: "ORANGINA" }, { name: "ICETEA" },
          { name: "FUZETEA" }, { name: "OASIS" }, { name: "SCHWEPPES" }, { name: "EVIAN" }, { name: "SAN PEL" }
        ]
      },
      {
        category: "BOISSONS SUR PLACE",
        items: [
          { name: "COCA" }, { name: "COCA ZERO" }, { name: "EVIAN 50 CL" }, { name: "EVIAN 1L" },
          { name: "SAN PEL 50CL" }, { name: "SAN PEL 1L" }, { name: "HEINEKEN" }, { name: "ASAHI" },
          { name: "SINGHA" }, { name: "SIROP MENTHE" }, { name: "SIROP GRENADINE" }, { name: "SIROP DE FRAISE" }
        ]
      },
      {
        category: "HYGIENE & CONSOMMABLES",
        items: [
          { name: "CHARLOTTES" }, { name: "TABLIERS PLASTIQUES" }, { name: "GANTS M" }, { name: "GANTS L" },
          { name: "FILM PLASTIQUE" }, { name: "SAC POUBELLES" }, { name: "LIQUIDE VAISSELLE" },
          { name: "LIQUIDE LAVE-VERRE" }, { name: "LIQUIDE LAVE-VITRE" }, { name: "LIQUIDE LAVE-MAIN" },
          { name: "VINAIGRE BLANC" }, { name: "DESTOP" }, { name: "PRODUIT SOL" }, { name: "PRODUIT WC" },
          { name: "SOPALIN" }, { name: "ESSUIE MAIN" }, { name: "PAPIER TOILETTES" }, { name: "ROULEAUX CB" },
          { name: "ROULEAUX IMP" }, { name: "AGRAFFES" }, { name: "POCHE A DOUILLE" }
        ]
      },
      {
        category: "CAFE & THE",
        items: [
          { name: "CAFE" }, { name: "DECAFEINE" }, { name: "THE" }, { name: "SUCRE BUCHETTE" }, { name: "SUCRETTE" }
        ]
      },
      {
        category: "VIANDES & POISSONS",
        items: [
          { name: "SAUMON", nameVi: "CÁ HỒI" }, { name: "THON ROUGE", nameVi: "CÁ NGỪ ĐỎ" },
          { name: "POULET", nameVi: "GÀ" }, { name: "BŒUF", nameVi: "BÒ" },
          { name: "VIANDE HACHEE", nameVi: "BO BĂM" }, { name: "DINDE", nameVi: "Thịt nguội" },
          { name: "FOIE GRAS", nameVi: "GAN NGỖNG" }, { name: "SURIMI" },
          { name: "FEUILLES DE BRICK", nameVi: "BÁNH TRÁNG MỎNG" },
          { name: "BOUILLON DE POULET", nameVi: "NƯỚC DÙNG GÀ" }, { name: "LEVURE CHIMIQUE", nameVi: "BỘT NỞ" }
        ]
      },
      {
        category: "LEGUMES",
        items: [
          { name: "AVOCAT", nameVi: "BO" }, { name: "CAROTTE", nameVi: "Cà rôt" },
          { name: "CONCOMBRE", nameVi: "DƯA CHUỘT" }, { name: "AUBERGINE", nameVi: "CÀ TÍM" },
          { name: "COURGETTE", nameVi: "BÍ XANH" }, { name: "POIVRON", nameVi: "Ớt chuông" },
          { name: "POIREAU", nameVi: "Tỏi tây" }, { name: "SALADE", nameVi: "SALAD" },
          { name: "CHOU BLANC", nameVi: "BẮP CẢI TRẮNG" }, { name: "OIGNONS", nameVi: "HÀNH" },
          { name: "AIL", nameVi: "TỎI" }, { name: "TOMATE CERISE", nameVi: "CÀ CHUA BI" }
        ]
      },
      {
        category: "CHAMPIGNONS",
        items: [
          { name: "CHAMPIGNONS BLANCS", nameVi: "NẤM TRẮNG" }, { name: "CHAMPIGNONS NOIRS", nameVi: "NẤM ĐEN" },
          { name: "PATATE DOUCE", nameVi: "KHOAI LANG" }, { name: "PETITS POIS", nameVi: "ĐẬU HÀ LAN" },
          { name: "EDAMAME" }
        ]
      },
      {
        category: "FRUITS",
        items: [
          { name: "ANANAS", nameVi: "DỨA" }, { name: "BANANE", nameVi: "CHUỐI" },
          { name: "ORANGE", nameVi: "CAM" }, { name: "POMME", nameVi: "TÁO" },
          { name: "POIRE", nameVi: "LÊ" }, { name: "RAISIN", nameVi: "NHO" },
          { name: "KIWI" }, { name: "MANGUE", nameVi: "XOÀI" }
        ]
      },
      {
        category: "HERBES & EPICES",
        items: [
          { name: "CITRON", nameVi: "CHANH" }, { name: "ANETH", nameVi: "THÌ LÀ" },
          { name: "CORRIANDRE", nameVi: "NGÒ" }, { name: "CEBETTE", nameVi: "HÀNH LÁ" },
          { name: "MENTHE", nameVi: "HẠT BẠC HÀ" }, { name: "PIMENT", nameVi: "ỚT" },
          { name: "GINGEMBRE", nameVi: "GỪNG" }, { name: "SEL", nameVi: "MUỐI" },
          { name: "SUCRE", nameVi: "ĐƯỜNG" }, { name: "POIVRE EN POUDRE", nameVi: "TIÊU BỘT" },
          { name: "POIVRE EN GRAINS", nameVi: "TIÊU HAT" }, { name: "CURRY", nameVi: "CÀ RI" },
          { name: "CUMIN", nameVi: "THÌ LÀ ẤN ĐỘ" }
        ]
      }
    ];

    // Insert items
    for (const catData of itemsData) {
      const category = insertedCategories.find(c => c.name === catData.category);
      if (category) {
        const itemsToInsert = catData.items.map((item, idx) => ({
          categoryId: category.id,
          name: item.name,
          nameVi: item.nameVi || null,
          sortOrder: idx,
          isActive: true
        }));
        await db.insert(suguvalItems).values(itemsToInsert);
      }
    }

    console.log("[Suguval] Initialized with", insertedCategories.length, "categories");
  }

  async getLowStockAlerts(): Promise<string[]> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoff = sevenDaysAgo.toISOString().split("T")[0];
    const recentChecks = await db.select({
      itemId: suguvalChecks.itemId,
      count: sql<number>`count(*)::int`
    })
      .from(suguvalChecks)
      .where(and(eq(suguvalChecks.isChecked, true), gte(suguvalChecks.checkDate, cutoff)))
      .groupBy(suguvalChecks.itemId);
    const highDemand = recentChecks.filter(r => r.count >= 4);
    if (highDemand.length === 0) return [];
    const items = await db.select().from(suguvalItems);
    return highDemand.map(r => {
      const item = items.find(i => i.id === r.itemId);
      return item ? `${item.name} (commandé ${r.count}x cette semaine)` : `Article #${r.itemId} (${r.count}x)`;
    });
  }

  async recoverFailedEmails(): Promise<{ checked: number; recovered: number; failed: string[] }> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoffDate = sevenDaysAgo.toISOString().split("T")[0];
    const failedEmails = await db.select().from(suguvalEmailLogs)
      .where(eq(suguvalEmailLogs.success, false))
      .orderBy(desc(suguvalEmailLogs.sentAt))
      .limit(20);
    const recentFailures = failedEmails.filter(e => e.emailDate >= cutoffDate);
    if (recentFailures.length === 0) {
      console.log("[Suguval] No failed emails to recover");
      return { checked: 0, recovered: 0, failed: [] };
    }
    console.log(`[Suguval] Found ${recentFailures.length} failed emails to recover`);
    let recovered = 0;
    const failedRecoveries: string[] = [];
    for (const failedEmail of recentFailures) {
      if (recovered > 0) await new Promise(resolve => setTimeout(resolve, 2000));
      try {
        const result = await this.sendDailyEmail(undefined, new Date(failedEmail.emailDate));
        if (result.success) {
          await db.update(suguvalEmailLogs)
            .set({ success: true, error: null })
            .where(eq(suguvalEmailLogs.id, failedEmail.id));
          recovered++;
        } else {
          failedRecoveries.push(`${failedEmail.emailDate}: ${result.message}`);
        }
      } catch (e) {
        failedRecoveries.push(`${failedEmail.emailDate}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    console.log(`[Suguval] Recovery complete: ${recovered}/${recentFailures.length} emails recovered`);
    return { checked: recentFailures.length, recovered, failed: failedRecoveries };
  }

  async getEmailLogs(limit: number = 30) {
    return db.select().from(suguvalEmailLogs).orderBy(desc(suguvalEmailLogs.sentAt)).limit(limit);
  }

  // Get history of sent emails (successful only) for a given month
  async getHistory(month?: string) {
    // Get all successful email logs
    const logs = await db.select()
      .from(suguvalEmailLogs)
      .where(eq(suguvalEmailLogs.success, true))
      .orderBy(desc(suguvalEmailLogs.sentAt));

    // Filter by month if provided
    const filteredLogs = month 
      ? logs.filter(log => log.emailDate.startsWith(month))
      : logs;

    // Get all items and categories for enriching the data
    const items = await db.select().from(suguvalItems);
    const categories = await db.select().from(suguvalCategories);

    // Transform logs to history format
    return filteredLogs.map(log => {
      // Parse itemsList JSON (stored as array of {itemName, categoryName, checkedAt})
      let parsedItems: Array<{ itemName: string; categoryName: string }> = [];
      try {
        parsedItems = JSON.parse(log.itemsList);
      } catch (e) {
        parsedItems = [];
      }

      // Enrich with translations
      const enrichedItems = parsedItems.map(parsed => {
        const item = items.find(i => i.name === parsed.itemName);
        return {
          id: item?.id || 0,
          name: parsed.itemName,
          nameVi: item?.nameVi || null,
          nameTh: item?.nameTh || null,
          categoryName: parsed.categoryName
        };
      });

      return {
        date: log.emailDate,
        sentAt: log.sentAt,
        items: enrichedItems
      };
    });
  }

  // Future items management
  async getFutureItems(targetDate: string): Promise<number[]> {
    const items = await db.select()
      .from(suguvalFutureItems)
      .where(eq(suguvalFutureItems.targetDate, targetDate));
    return items.map(item => item.itemId);
  }

  async addFutureItem(itemId: number, targetDate: string) {
    // Check if already exists
    const [existing] = await db.select()
      .from(suguvalFutureItems)
      .where(and(
        eq(suguvalFutureItems.itemId, itemId),
        eq(suguvalFutureItems.targetDate, targetDate)
      ));
    
    if (existing) {
      return existing;
    }

    const [newItem] = await db.insert(suguvalFutureItems)
      .values({ itemId, targetDate })
      .returning();
    return newItem;
  }

  async removeFutureItem(itemId: number, targetDate: string) {
    await db.delete(suguvalFutureItems)
      .where(and(
        eq(suguvalFutureItems.itemId, itemId),
        eq(suguvalFutureItems.targetDate, targetDate)
      ));
    return { success: true };
  }

  // Apply future items to today's checklist
  async applyFutureItemsForToday() {
    const today = getTodayDate();
    const futureItems = await this.getFutureItems(today);
    
    if (futureItems.length === 0) return { applied: 0 };

    // Auto-check the items for today
    for (const itemId of futureItems) {
      await this.toggleCheck(itemId, true);
    }

    // Clean up the future items for today
    await db.delete(suguvalFutureItems)
      .where(eq(suguvalFutureItems.targetDate, today));

    return { applied: futureItems.length };
  }

  // Sync catalog from Suguval (master) to Sugumaillane (incremental merge)
  async syncToMaillane(): Promise<{ success: boolean; message: string; categoriesSync: number; itemsSync: number; categoriesAdded: number; itemsAdded: number; itemsUpdated: number }> {
    try {
      console.log("[Suguval] Starting incremental catalog sync to Sugumaillane...");

      const suguvalCats = await db.select().from(suguvalCategories).orderBy(suguvalCategories.sortOrder);
      const suguvalItms = await db.select().from(suguvalItems).orderBy(suguvalItems.sortOrder);
      const existingMaillaneCats = await db.select().from(sugumaillaneCategories);
      const existingMaillaneItems = await db.select().from(sugumaillaneItems);

      const categoryIdMap = new Map<number, number>();
      let categoriesAdded = 0;
      let itemsAdded = 0;
      let itemsUpdated = 0;

      for (const cat of suguvalCats) {
        const existing = existingMaillaneCats.find(c => c.name === cat.name);
        if (existing) {
          await db.update(sugumaillaneCategories)
            .set({ nameVi: cat.nameVi, nameTh: cat.nameTh, sheet: cat.sheet, sortOrder: cat.sortOrder })
            .where(eq(sugumaillaneCategories.id, existing.id));
          categoryIdMap.set(cat.id, existing.id);
        } else {
          const [newCat] = await db.insert(sugumaillaneCategories).values({
            name: cat.name, nameVi: cat.nameVi, nameTh: cat.nameTh,
            sheet: cat.sheet, sortOrder: cat.sortOrder
          }).returning();
          categoryIdMap.set(cat.id, newCat.id);
          categoriesAdded++;
        }
      }

      for (const item of suguvalItms) {
        const maillaneCatId = categoryIdMap.get(item.categoryId);
        if (!maillaneCatId) continue;

        const existing = existingMaillaneItems.find(i => i.name === item.name && i.categoryId === maillaneCatId);
        if (existing) {
          await db.update(sugumaillaneItems)
            .set({ nameVi: item.nameVi, nameTh: item.nameTh, sortOrder: item.sortOrder, isActive: item.isActive })
            .where(eq(sugumaillaneItems.id, existing.id));
          itemsUpdated++;
        } else {
          await db.insert(sugumaillaneItems).values({
            categoryId: maillaneCatId, name: item.name,
            nameVi: item.nameVi, nameTh: item.nameTh,
            sortOrder: item.sortOrder, isActive: item.isActive
          });
          itemsAdded++;
        }
      }

      console.log(`[Suguval] Incremental sync complete: ${suguvalCats.length} categories (${categoriesAdded} new), ${itemsAdded} items added, ${itemsUpdated} updated`);
      return {
        success: true,
        message: `Catalogue synchronisé vers SUGU Maillane (incrémental)`,
        categoriesSync: suguvalCats.length,
        itemsSync: itemsAdded + itemsUpdated,
        categoriesAdded,
        itemsAdded,
        itemsUpdated
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error("[Suguval] Sync to Maillane failed:", errorMsg);
      return {
        success: false,
        message: `Erreur de synchronisation: ${errorMsg}`,
        categoriesSync: 0, itemsSync: 0, categoriesAdded: 0, itemsAdded: 0, itemsUpdated: 0
      };
    }
  }

  // Assign zones to existing categories based on category names
  async assignZonesToCategories(): Promise<{ updated: number }> {
    const categories = await db.select().from(suguvalCategories);
    let updated = 0;

    // Zone mapping based on category names
    const zoneMapping: Record<string, number> = {
      // Zone 1: Cuisine
      "VIANDES & POISSONS": 1,
      "LEGUMES": 1,
      "CHAMPIGNONS": 1,
      "FRUITS": 1,
      "HERBES & EPICES": 1,
      // Zone 2: Sushi Bar (items sushi already in other categories, but could add specific ones)
      // Zone 3: Réserve sèche
      "RESERVE SECHE": 3,
      "HUILES & DESSERTS": 3,
      "CAFE & THE": 3,
      // Zone 4: Hygiène & Consommables
      "HYGIENE & CONSOMMABLES": 4,
      // Zone 5: Boissons
      "BOISSONS LIVRAISON": 5,
      "BOISSONS SUR PLACE": 5,
      // Zone 6: Livraison & Emballages
      "POSTE LIVRAISON": 6,
    };

    // New sort order within each zone
    const zoneSortOrder: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

    for (const cat of categories) {
      const zone = zoneMapping[cat.name] || 1; // Default to zone 1 (Cuisine) if not mapped
      const sortOrder = zoneSortOrder[zone]++;
      
      await db.update(suguvalCategories)
        .set({ zone, sortOrder })
        .where(eq(suguvalCategories.id, cat.id));
      updated++;
    }

    console.log(`[Suguval] Assigned zones to ${updated} categories`);
    return { updated };
  }
}

export const suguvalService = new SuguvalService();
