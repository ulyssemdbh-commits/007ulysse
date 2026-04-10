import { db } from "../db";
import { sugumaillaneCategories, sugumaillaneItems, sugumaillaneChecks, sugumaillaneEmailLogs, sugumaillaneFutureItems } from "@shared/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { emailActionService } from "./emailActionService";
import { getTodayDate } from "./baseSuguHelpers";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5 * 60 * 1000;

class SugumaillaneService {
  // Get all categories with their items
  async getCategoriesWithItems() {
    const categories = await db.select().from(sugumaillaneCategories).orderBy(sugumaillaneCategories.sortOrder);
    const items = await db.select().from(sugumaillaneItems).where(eq(sugumaillaneItems.isActive, true)).orderBy(sugumaillaneItems.sortOrder);
    
    return categories.map(cat => ({
      ...cat,
      items: items.filter(item => item.categoryId === cat.id)
    }));
  }

  // Get today's checks
  async getTodayChecks() {
    const today = getTodayDate();
    return db.select().from(sugumaillaneChecks).where(eq(sugumaillaneChecks.checkDate, today));
  }

  // Reset all checks for today
  async resetTodayChecks() {
    const today = getTodayDate();
    
    await db.update(sugumaillaneChecks)
      .set({ isChecked: false, checkedAt: new Date() })
      .where(eq(sugumaillaneChecks.checkDate, today));
    
    console.log(`[Sugumaillane] Reset all checks for ${today}`);
    return { success: true, date: today };
  }

  // Get dashboard stats for today
  async getDashboardStats() {
    const today = getTodayDate();
    
    // Get all active items
    const allItems = await db.select().from(sugumaillaneItems).where(eq(sugumaillaneItems.isActive, true));
    const totalItems = allItems.length;
    
    // Get today's checks
    const todayChecks = await db.select().from(sugumaillaneChecks).where(eq(sugumaillaneChecks.checkDate, today));
    const checkedItemIds = new Set(todayChecks.filter(c => c.isChecked).map(c => c.itemId));
    const checkedCount = checkedItemIds.size;
    
    // Calculate completion rate
    const completionRate = totalItems > 0 ? Math.round((checkedCount / totalItems) * 100) : 0;
    
    // Get categories with their completion stats
    const categories = await db.select().from(sugumaillaneCategories).orderBy(sugumaillaneCategories.sortOrder);
    
    const categoryStats = categories.map(cat => {
      const catItems = allItems.filter(item => item.categoryId === cat.id);
      const catChecked = catItems.filter(item => checkedItemIds.has(item.id));
      return {
        id: cat.id,
        name: cat.name,
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
    const allItems = await db.select().from(sugumaillaneItems).where(eq(sugumaillaneItems.isActive, true));
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
      const dayChecks = await db.select().from(sugumaillaneChecks).where(eq(sugumaillaneChecks.checkDate, dateStr));
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
    const [existing] = await db.select().from(sugumaillaneChecks)
      .where(and(eq(sugumaillaneChecks.itemId, itemId), eq(sugumaillaneChecks.checkDate, today)));
    
    if (existing) {
      // Update existing
      await db.update(sugumaillaneChecks)
        .set({ isChecked, checkedAt: new Date() })
        .where(eq(sugumaillaneChecks.id, existing.id));
      return { ...existing, isChecked };
    } else {
      // Create new
      const [newCheck] = await db.insert(sugumaillaneChecks)
        .values({ itemId, checkDate: today, isChecked, checkedAt: new Date() })
        .returning();
      return newCheck;
    }
  }

  // Update item translations
  async updateItem(itemId: number, data: { nameVi?: string | null; nameTh?: string | null }) {
    const [updated] = await db.update(sugumaillaneItems)
      .set({
        nameVi: data.nameVi,
        nameTh: data.nameTh
      })
      .where(eq(sugumaillaneItems.id, itemId))
      .returning();
    return updated;
  }

  // Update category name or sort order
  async updateCategory(categoryId: number, data: { name?: string; nameVi?: string | null; nameTh?: string | null; sortOrder?: number }) {
    const updateData: Record<string, any> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.nameVi !== undefined) updateData.nameVi = data.nameVi;
    if (data.nameTh !== undefined) updateData.nameTh = data.nameTh;
    if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;
    
    const [updated] = await db.update(sugumaillaneCategories)
      .set(updateData)
      .where(eq(sugumaillaneCategories.id, categoryId))
      .returning();
    return updated;
  }

  // Reorder categories by setting sortOrder based on array position
  async reorderCategories(orderedIds: number[]) {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.update(sugumaillaneCategories)
        .set({ sortOrder: i })
        .where(eq(sugumaillaneCategories.id, orderedIds[i]));
    }
    return true;
  }

  // Get checked items for today (for email)
  async getCheckedItemsForToday() {
    const today = getTodayDate();
    const checks = await db.select().from(sugumaillaneChecks)
      .where(and(eq(sugumaillaneChecks.checkDate, today), eq(sugumaillaneChecks.isChecked, true)));
    
    if (checks.length === 0) return [];

    const itemIds = checks.map(c => c.itemId);
    const items = await db.select().from(sugumaillaneItems);
    const categories = await db.select().from(sugumaillaneCategories);
    
    return checks.map(check => {
      const item = items.find(i => i.id === check.itemId);
      const category = item ? categories.find(c => c.id === item.categoryId) : null;
      return {
        itemName: item?.name || "Unknown",
        categoryName: category?.name || "Unknown",
        checkedAt: check.checkedAt
      };
    }).sort((a, b) => a.categoryName.localeCompare(b.categoryName));
  }

  // Send daily email at 23:59 to sugu.resto@gmail.com
  async sendDailyEmail(overrideDay?: string, overrideDate?: Date): Promise<{ success: boolean; message: string }> {
    const today = getTodayDate();
    const checkedItems = await this.getCheckedItemsForToday();
    
    // ALWAYS send email, even with 0 items
    console.log(`[Sugumaillane] Sending email with ${checkedItems.length} checked items`);

    // Group by category
    const byCategory: Record<string, string[]> = {};
    for (const item of checkedItems) {
      if (!byCategory[item.categoryName]) {
        byCategory[item.categoryName] = [];
      }
      byCategory[item.categoryName].push(item.itemName);
    }

    // Build email content
    const itemsList = Object.entries(byCategory)
      .map(([cat, items]) => `\n${cat}:\n${items.map(i => `  - ${i}`).join("\n")}`)
      .join("\n");

    // Calculate delivery day
    let deliveryDayStr: string;
    if (overrideDay) {
      // Use overrideDate if provided (e.g., Monday 02:00 → today's date), otherwise tomorrow
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
Ce message a été envoyé automatiquement par le système de gestion SUGU Maillane.`
      : `Bonjour,

Voici la liste des courses à effectuer pour ${deliveryDayStr}:
${itemsList}

Total: ${checkedItems.length} articles à acheter.
${weeklyRecap}

---
Ce message a été envoyé automatiquement par le système de gestion SUGU Maillane.`;

    try {
      // Use emailActionService to send email - CHANGED TO sugu.resto@gmail.com
      const results = await emailActionService.executeActions([{
        type: "send",
        to: "sugu.resto@gmail.com",
        subject: `[SUGU MAILLANE] Liste des courses - ${deliveryDayStr}`,
        body: emailContent
      }], 'ulysse', 1);

      const result = results[0] || { success: false, error: "No result" };

      // Log the email
      await db.insert(sugumaillaneEmailLogs).values({
        emailDate: today,
        itemCount: checkedItems.length,
        itemsList: JSON.stringify(checkedItems),
        success: result.success,
        error: result.success ? null : (result.error || null)
      });

      console.log(`[Sugumaillane] Daily email sent: ${checkedItems.length} items`);
      return { success: true, message: `Email sent with ${checkedItems.length} items` };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      
      // Log the failure
      await db.insert(sugumaillaneEmailLogs).values({
        emailDate: today,
        itemCount: checkedItems.length,
        itemsList: JSON.stringify(checkedItems),
        success: false,
        error: errorMsg
      });

      console.error("[Sugumaillane] Email failed:", errorMsg);
      return { success: false, message: errorMsg };
    }
  }

  // Initialize categories and items from Excel data (same as Suguval)
  async initializeFromExcel() {
    // Check if already initialized
    const existingCategories = await db.select().from(sugumaillaneCategories);
    if (existingCategories.length > 0) {
      console.log("[Sugumaillane] Already initialized with", existingCategories.length, "categories");
      return;
    }

    console.log("[Sugumaillane] Initializing categories and items from Excel...");

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
    const insertedCategories = await db.insert(sugumaillaneCategories).values(allCategories).returning();

    // Items data (same as Suguval)
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
        await db.insert(sugumaillaneItems).values(itemsToInsert);
      }
    }

    console.log("[Sugumaillane] Initialized with", insertedCategories.length, "categories");
  }

  // Get email logs
  async getEmailLogs(limit: number = 30) {
    return db.select().from(sugumaillaneEmailLogs).orderBy(desc(sugumaillaneEmailLogs.sentAt)).limit(limit);
  }

  /**
   * FAILURE RECOVERY: Retry sending a failed email with exponential backoff
   * Returns true if email was sent successfully, false otherwise
   */
  async retryFailedEmail(emailLogId: number): Promise<{ success: boolean; message: string }> {
    try {
      // Get the failed email log
      const [emailLog] = await db.select().from(sugumaillaneEmailLogs)
        .where(and(
          eq(sugumaillaneEmailLogs.id, emailLogId),
          eq(sugumaillaneEmailLogs.success, false)
        ));

      if (!emailLog) {
        return { success: false, message: "Email log not found or already successful" };
      }

      // Parse the original items list
      let checkedItems: Array<{ itemName: string; categoryName: string }>;
      try {
        checkedItems = JSON.parse(emailLog.itemsList);
      } catch (e) {
        return { success: false, message: "Could not parse original items list" };
      }

      if (checkedItems.length === 0) {
        return { success: true, message: "No items to send" };
      }

      // Reconstruct and send email
      const byCategory: Record<string, string[]> = {};
      for (const item of checkedItems) {
        if (!byCategory[item.categoryName]) {
          byCategory[item.categoryName] = [];
        }
        byCategory[item.categoryName].push(item.itemName);
      }

      const itemsList = Object.entries(byCategory)
        .map(([cat, items]) => `\n${cat}:\n${items.map(i => `  - ${i}`).join("\n")}`)
        .join("\n");

      const emailContent = `Bonjour,

Voici la liste des courses (RÉCUPÉRATION après échec) pour ${emailLog.emailDate}:
${itemsList}

Total: ${checkedItems.length} articles à acheter.

---
Ce message a été envoyé automatiquement par le système de gestion SUGU Maillane.
⚠️ Ceci est un email de récupération suite à un échec précédent.`;

      console.log(`[Sugumaillane] Retrying failed email from ${emailLog.emailDate}...`);

      const results = await emailActionService.executeActions([{
        type: "send",
        to: "sugu.resto@gmail.com",
        subject: `[SUGU MAILLANE] Liste des courses - ${emailLog.emailDate} (Récupération)`,
        body: emailContent
      }], 'ulysse', 1);

      const result = results[0] || { success: false, error: "No result" };

      if (result.success) {
        // Mark original as recovered
        await db.update(sugumaillaneEmailLogs)
          .set({ 
            success: true, 
            error: `Recovered at ${new Date().toISOString()}` 
          })
          .where(eq(sugumaillaneEmailLogs.id, emailLogId));

        console.log(`[Sugumaillane] Recovery email sent successfully for ${emailLog.emailDate}`);
        return { success: true, message: `Email recovered for ${emailLog.emailDate}` };
      } else {
        console.error(`[Sugumaillane] Recovery failed: ${result.error}`);
        return { success: false, message: result.error || "Unknown error" };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error("[Sugumaillane] Retry error:", errorMsg);
      return { success: false, message: errorMsg };
    }
  }

  /**
   * FAILURE RECOVERY: Check for missed/failed emails in the last 7 days and retry them
   * Called by the recovery job scheduler
   */
  async recoverFailedEmails(): Promise<{
    checked: number;
    recovered: number;
    failed: string[];
  }> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoffDate = sevenDaysAgo.toISOString().split("T")[0];

    // Find failed emails from the last 7 days
    // emailDate is stored as string YYYY-MM-DD, so we filter in JS after fetching
    const failedEmails = await db.select().from(sugumaillaneEmailLogs)
      .where(eq(sugumaillaneEmailLogs.success, false))
      .orderBy(desc(sugumaillaneEmailLogs.sentAt))
      .limit(20);

    // Filter to last 7 days (emailDate comparison as string works for ISO format)
    const recentFailures = failedEmails.filter(e => e.emailDate >= cutoffDate);

    if (recentFailures.length === 0) {
      console.log("[Sugumaillane] No failed emails to recover");
      return { checked: 0, recovered: 0, failed: [] };
    }

    console.log(`[Sugumaillane] Found ${recentFailures.length} failed emails to recover`);

    let recovered = 0;
    const failedRecoveries: string[] = [];

    for (const failedEmail of recentFailures) {
      // Wait between retries to avoid rate limiting
      if (recovered > 0) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      const result = await this.retryFailedEmail(failedEmail.id);
      if (result.success) {
        recovered++;
      } else {
        failedRecoveries.push(`${failedEmail.emailDate}: ${result.message}`);
      }
    }

    console.log(`[Sugumaillane] Recovery complete: ${recovered}/${recentFailures.length} emails recovered`);

    return {
      checked: recentFailures.length,
      recovered,
      failed: failedRecoveries
    };
  }

  /**
   * Send daily email with retry logic
   * Tries up to MAX_RETRIES times with RETRY_DELAY_MS between attempts
   */
  async sendDailyEmailWithRetry(overrideDay?: string, retryCount: number = 0, overrideDate?: Date): Promise<{ success: boolean; message: string }> {
    const result = await this.sendDailyEmail(overrideDay, overrideDate);
    
    if (result.success) {
      return result;
    }

    if (retryCount < MAX_RETRIES) {
      console.log(`[Sugumaillane] Email failed, scheduling retry ${retryCount + 1}/${MAX_RETRIES} in ${RETRY_DELAY_MS / 1000}s...`);
      
      // Schedule retry
      setTimeout(async () => {
        const retryResult = await this.sendDailyEmailWithRetry(overrideDay, retryCount + 1, overrideDate);
        console.log(`[Sugumaillane] Retry ${retryCount + 1} result: ${retryResult.message}`);
      }, RETRY_DELAY_MS);
      
      return { 
        success: false, 
        message: `${result.message} - Retry scheduled (${retryCount + 1}/${MAX_RETRIES})` 
      };
    }

    console.error(`[Sugumaillane] All ${MAX_RETRIES} retries exhausted for daily email`);
    return { 
      success: false, 
      message: `${result.message} - All ${MAX_RETRIES} retries exhausted` 
    };
  }

  /**
   * Get health status for SUGU email system
   * Returns statistics about recent email success/failure rates
   */
  async getEmailHealth(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    totalEmails: number;
    successfulEmails: number;
    failedEmails: number;
    successRate: number;
    recentFailures: Array<{ date: string; error: string | null }>;
  }> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const logs = await db.select().from(sugumaillaneEmailLogs)
      .orderBy(desc(sugumaillaneEmailLogs.sentAt))
      .limit(30);

    const totalEmails = logs.length;
    const successfulEmails = logs.filter(l => l.success).length;
    const failedEmails = totalEmails - successfulEmails;
    const successRate = totalEmails > 0 ? (successfulEmails / totalEmails) * 100 : 100;

    const recentFailures = logs
      .filter(l => !l.success)
      .slice(0, 5)
      .map(l => ({ date: l.emailDate, error: l.error }));

    let status: "healthy" | "degraded" | "unhealthy" = "healthy";
    if (successRate < 70) {
      status = "unhealthy";
    } else if (successRate < 90 || failedEmails > 0) {
      status = "degraded";
    }

    return {
      status,
      totalEmails,
      successfulEmails,
      failedEmails,
      successRate: Math.round(successRate),
      recentFailures
    };
  }

  // Get history of sent emails (successful only) for a given month
  async getHistory(month?: string) {
    const logs = await db.select()
      .from(sugumaillaneEmailLogs)
      .where(eq(sugumaillaneEmailLogs.success, true))
      .orderBy(desc(sugumaillaneEmailLogs.sentAt));

    const filteredLogs = month 
      ? logs.filter(log => log.emailDate.startsWith(month))
      : logs;

    const items = await db.select().from(sugumaillaneItems);
    const categories = await db.select().from(sugumaillaneCategories);

    return filteredLogs.map(log => {
      let parsedItems: Array<{ itemName: string; categoryName: string }> = [];
      try {
        parsedItems = JSON.parse(log.itemsList);
      } catch (e) {
        parsedItems = [];
      }

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
      .from(sugumaillaneFutureItems)
      .where(eq(sugumaillaneFutureItems.targetDate, targetDate));
    return items.map(item => item.itemId);
  }

  async addFutureItem(itemId: number, targetDate: string) {
    const [existing] = await db.select()
      .from(sugumaillaneFutureItems)
      .where(and(
        eq(sugumaillaneFutureItems.itemId, itemId),
        eq(sugumaillaneFutureItems.targetDate, targetDate)
      ));
    
    if (existing) {
      return existing;
    }

    const [newItem] = await db.insert(sugumaillaneFutureItems)
      .values({ itemId, targetDate })
      .returning();
    return newItem;
  }

  async removeFutureItem(itemId: number, targetDate: string) {
    await db.delete(sugumaillaneFutureItems)
      .where(and(
        eq(sugumaillaneFutureItems.itemId, itemId),
        eq(sugumaillaneFutureItems.targetDate, targetDate)
      ));
    return { success: true };
  }

  // Apply future items to today's checklist
  async applyFutureItemsForToday() {
    const today = getTodayDate();
    const futureItems = await this.getFutureItems(today);
    
    if (futureItems.length === 0) return { applied: 0 };

    for (const itemId of futureItems) {
      await this.toggleCheck(itemId, true);
    }

    await db.delete(sugumaillaneFutureItems)
      .where(eq(sugumaillaneFutureItems.targetDate, today));

    return { applied: futureItems.length };
  }

  async getLowStockAlerts(): Promise<string[]> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoff = sevenDaysAgo.toISOString().split("T")[0];
    const recentChecks = await db.select({
      itemId: sugumaillaneChecks.itemId,
      count: sql<number>`count(*)::int`
    })
      .from(sugumaillaneChecks)
      .where(and(eq(sugumaillaneChecks.isChecked, true), gte(sugumaillaneChecks.checkDate, cutoff)))
      .groupBy(sugumaillaneChecks.itemId);
    const highDemand = recentChecks.filter(r => r.count >= 4);
    if (highDemand.length === 0) return [];
    const items = await db.select().from(sugumaillaneItems);
    return highDemand.map(r => {
      const item = items.find(i => i.id === r.itemId);
      return item ? `${item.name} (commandé ${r.count}x cette semaine)` : `Article #${r.itemId} (${r.count}x)`;
    });
  }
}

export const sugumaillaneService = new SugumaillaneService();
