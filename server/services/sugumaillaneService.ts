import { db } from "../db";
import { sugumaillaneCategories, sugumaillaneItems, sugumaillaneChecks, sugumaillaneEmailLogs, sugumaillaneFutureItems } from "@shared/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { emailActionService } from "./emailActionService";
import { getTodayDate } from "./baseSuguHelpers";
import { BaseSuguService } from "./BaseSuguService";

const SUGUMAILLANE_EMAIL_TO = process.env.SUGUMAILLANE_EMAIL_TO || "sugu.resto@gmail.com";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5 * 60 * 1000;

class SugumaillaneService extends BaseSuguService {
  constructor() {
    super(
      {
        categories: sugumaillaneCategories,
        items: sugumaillaneItems,
        checks: sugumaillaneChecks,
        emailLogs: sugumaillaneEmailLogs,
        futureItems: sugumaillaneFutureItems,
      },
      {
        storeName: "Sugumaillane",
        emailTo: SUGUMAILLANE_EMAIL_TO,
        emailSubjectPrefix: "[SUGU MAILLANE]",
      }
    );
  }

  async getCheckedItemsForToday() {
    const today = getTodayDate();
    const checks = await db.select().from(sugumaillaneChecks)
      .where(and(eq(sugumaillaneChecks.checkDate, today), eq(sugumaillaneChecks.isChecked, true)));
    if (checks.length === 0) return [];
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

  async sendDailyEmail(overrideDay?: string, overrideDate?: Date): Promise<{ success: boolean; message: string }> {
    const today = getTodayDate();
    const checkedItems = await this.getCheckedItemsForToday();
    console.log(`[Sugumaillane] Sending email with ${checkedItems.length} checked items`);

    const byCategory: Record<string, string[]> = {};
    for (const item of checkedItems) {
      if (!byCategory[item.categoryName]) byCategory[item.categoryName] = [];
      byCategory[item.categoryName].push(item.itemName);
    }

    const itemsList = Object.entries(byCategory)
      .map(([cat, items]) => `\n${cat}:\n${items.map(i => `  - ${i}`).join("\n")}`)
      .join("\n");

    const deliveryDayStr = this.computeDeliveryDay(overrideDay, overrideDate);
    const weeklyStats = await this.getWeeklyStats();
    const weeklyRecap = this.buildWeeklyRecap(weeklyStats);

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
      const results = await emailActionService.executeActions([{
        type: "send",
        to: this.config.emailTo,
        subject: `${this.config.emailSubjectPrefix} Liste des courses - ${deliveryDayStr}`,
        body: emailContent
      }], 'ulysse', 1);

      const result = results[0] || { success: false, error: "No result" };
      await this.logEmail(today, checkedItems.length, checkedItems, result.success, result.success ? null : (result.error || null));

      console.log(`[Sugumaillane] Daily email ${result.success ? 'sent' : 'failed'}: ${checkedItems.length} items`);
      return { success: result.success, message: result.success ? `Email sent with ${checkedItems.length} items` : (result.error || "Unknown error") };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      await this.logEmail(today, checkedItems.length, checkedItems, false, errorMsg);
      console.error("[Sugumaillane] Email failed:", errorMsg);
      return { success: false, message: errorMsg };
    }
  }

  async initializeFromExcel() {
    const existingCategories = await db.select().from(sugumaillaneCategories);
    if (existingCategories.length > 0) {
      console.log("[Sugumaillane] Already initialized with", existingCategories.length, "categories");
      return;
    }
    console.log("[Sugumaillane] Initializing categories and items from Excel...");
    const feuil1Categories = [
      { name: "RESERVE SECHE", sheet: "Feuil1" as const, sortOrder: 0 },
      { name: "HUILES & DESSERTS", sheet: "Feuil1" as const, sortOrder: 1 },
      { name: "POSTE LIVRAISON", sheet: "Feuil1" as const, sortOrder: 2 },
      { name: "BOISSONS LIVRAISON", sheet: "Feuil1" as const, sortOrder: 3 },
      { name: "BOISSONS SUR PLACE", sheet: "Feuil1" as const, sortOrder: 4 },
      { name: "HYGIENE & CONSOMMABLES", sheet: "Feuil1" as const, sortOrder: 5 },
      { name: "CAFE & THE", sheet: "Feuil1" as const, sortOrder: 6 },
    ];
    const feuil2Categories = [
      { name: "VIANDES & POISSONS", sheet: "Feuil2" as const, sortOrder: 7 },
      { name: "LEGUMES", sheet: "Feuil2" as const, sortOrder: 8 },
      { name: "CHAMPIGNONS", sheet: "Feuil2" as const, sortOrder: 9 },
      { name: "FRUITS", sheet: "Feuil2" as const, sortOrder: 10 },
      { name: "HERBES & EPICES", sheet: "Feuil2" as const, sortOrder: 11 },
    ];
    const allCategories = [...feuil1Categories, ...feuil2Categories];
    const insertedCategories = await db.insert(sugumaillaneCategories).values(allCategories).returning();
    const itemsData: { category: string; items: { name: string; nameVi?: string }[] }[] = [
      { category: "RESERVE SECHE", items: [{ name: "RIZ" }, { name: "SEL" }, { name: "POIVRE" }, { name: "MOUTARDE" }, { name: "MAYONNAISE" }, { name: "HARISSA" }, { name: "THON NATURE" }, { name: "MAIS" }, { name: "FARINE" }, { name: "PUREE" }, { name: "VERMICELLE DE RIZ" }, { name: "VERMICELLE pour NEMS" }, { name: "NOUILLES BLANCHES" }, { name: "NOUILLES JAUNES" }, { name: "PAD THAI" }, { name: "GALETTE DE RIZ Diam18" }, { name: "GALETTE DE RIZ Diam28" }, { name: "GALETTE DE RIZ carré19" }, { name: "PANKO" }, { name: "SESAME BLANC" }, { name: "SESAME NOIR" }, { name: "CACAHUETE" }, { name: "OIGNONS FRITS" }, { name: "ALGUES" }, { name: "SALADE ALGUES" }] },
      { category: "HUILES & DESSERTS", items: [{ name: "HUILE DE TOURNESOL" }, { name: "HUILE D'OLIVE" }, { name: "HUILE DE SESAME" }, { name: "OEUFS" }, { name: "SUCRE EN SAC" }, { name: "CHAPELURE" }, { name: "Chocolat DELINUT" }, { name: "Chocolat liquide" }, { name: "Chocolat Buchette" }, { name: "AMANDES Grillées" }, { name: "BOUDOIRS" }, { name: "CREME LIQUIDE DESSERT" }, { name: "CHANTILLY" }, { name: "CACAO" }, { name: "MIEL" }, { name: "CONFITURE FIGUE" }, { name: "WASABI" }, { name: "GINGEMBRE" }, { name: "SAUCE SOJA" }, { name: "SAUCE MIRYNE" }, { name: "SAUCE NEMS" }] },
      { category: "POSTE LIVRAISON", items: [{ name: "Petits SACS" }, { name: "Grand SACS" }, { name: "Baguettes" }, { name: "Couverts" }, { name: "Serviettes Blanches" }, { name: "Serviettes Noires" }, { name: "Barquettes 6" }, { name: "Barquettes 12" }, { name: "Barquettes 18" }, { name: "Barquettes KHAO" }, { name: "Bowls Edamme" }, { name: "Bowls RTT" }, { name: "Pots Nouilles" }, { name: "Pots Nems" }, { name: "Pot sauces Nems" }] },
      { category: "BOISSONS LIVRAISON", items: [{ name: "COCA" }, { name: "COCA ZERO" }, { name: "ORANGINA" }, { name: "ICETEA" }, { name: "FUZETEA" }, { name: "OASIS" }, { name: "SCHWEPPES" }, { name: "EVIAN" }, { name: "SAN PEL" }] },
      { category: "BOISSONS SUR PLACE", items: [{ name: "COCA" }, { name: "COCA ZERO" }, { name: "EVIAN 50 CL" }, { name: "EVIAN 1L" }, { name: "SAN PEL 50CL" }, { name: "SAN PEL 1L" }, { name: "HEINEKEN" }, { name: "ASAHI" }, { name: "SAKE" }] },
      { category: "HYGIENE & CONSOMMABLES", items: [{ name: "SOPALIN" }, { name: "PAPIER TOILETTE" }, { name: "LIQUIDE VAISSELLE" }, { name: "SAVON MAINS" }, { name: "JAVEL" }, { name: "LAVETTES" }, { name: "EPONGES" }, { name: "SACS POUBELLE" }, { name: "FILM ALIMENTAIRE" }, { name: "PAPIER ALU" }] },
      { category: "CAFE & THE", items: [{ name: "CAFE EN GRAINS" }, { name: "THE VERT" }, { name: "THE JASMIN" }, { name: "LAIT" }, { name: "SUCRE DOSETTES" }] },
      { category: "VIANDES & POISSONS", items: [{ name: "POULET", nameVi: "GÀ" }, { name: "BOEUF", nameVi: "BÒ" }, { name: "PORC", nameVi: "HEO" }, { name: "CREVETTES", nameVi: "TÔM" }, { name: "SAUMON", nameVi: "CÁ HỒI" }, { name: "THON FRAIS", nameVi: "CÁ NGỪ" }, { name: "CALAMAR", nameVi: "MỰC" }, { name: "SURIMI" }, { name: "TOFU", nameVi: "ĐẬU HŨ" }] },
      { category: "LEGUMES", items: [{ name: "CAROTTES", nameVi: "CÀ RỐT" }, { name: "OIGNONS", nameVi: "HÀNH TÂY" }, { name: "AIL", nameVi: "TỎI" }, { name: "POIVRONS", nameVi: "ỚT CHUÔNG" }, { name: "COURGETTES", nameVi: "BÍ NGÒI" }, { name: "TOMATES", nameVi: "CÀ CHUA" }, { name: "CONCOMBRE", nameVi: "DƯA CHUỘT" }, { name: "SALADE", nameVi: "XÀ LÁCH" }, { name: "CHOU", nameVi: "BẮP CẢI" }, { name: "BROCOLI", nameVi: "BÔNG CẢI XANH" }, { name: "HARICOTS VERTS", nameVi: "ĐẬU QUE" }, { name: "GERMES SOJA", nameVi: "GIÁ ĐỖ" }, { name: "AVOCAT", nameVi: "BƠ" }] },
      { category: "CHAMPIGNONS", items: [{ name: "CHAMPIGNONS BLANCS", nameVi: "NẤM TRẮNG" }, { name: "CHAMPIGNONS NOIRS", nameVi: "NẤM ĐEN" }, { name: "PATATE DOUCE", nameVi: "KHOAI LANG" }, { name: "PETITS POIS", nameVi: "ĐẬU HÀ LAN" }, { name: "EDAMAME" }] },
      { category: "FRUITS", items: [{ name: "ANANAS", nameVi: "DỨA" }, { name: "BANANE", nameVi: "CHUỐI" }, { name: "ORANGE", nameVi: "CAM" }, { name: "POMME", nameVi: "TÁO" }, { name: "POIRE", nameVi: "LÊ" }, { name: "RAISIN", nameVi: "NHO" }, { name: "KIWI" }, { name: "MANGUE", nameVi: "XOÀI" }] },
      { category: "HERBES & EPICES", items: [{ name: "CITRON", nameVi: "CHANH" }, { name: "ANETH", nameVi: "THÌ LÀ" }, { name: "CORRIANDRE", nameVi: "NGÒ" }, { name: "CEBETTE", nameVi: "HÀNH LÁ" }, { name: "MENTHE", nameVi: "HẠT BẠC HÀ" }, { name: "PIMENT", nameVi: "ỚT" }, { name: "GINGEMBRE", nameVi: "GỪNG" }, { name: "SEL", nameVi: "MUỐI" }, { name: "SUCRE", nameVi: "ĐƯỜNG" }, { name: "POIVRE EN POUDRE", nameVi: "TIÊU BỘT" }, { name: "POIVRE EN GRAINS", nameVi: "TIÊU HAT" }, { name: "CURRY", nameVi: "CÀ RI" }, { name: "CUMIN", nameVi: "THÌ LÀ ẤN ĐỘ" }] },
    ];
    for (const catData of itemsData) {
      const category = insertedCategories.find(c => c.name === catData.category);
      if (category) {
        const itemsToInsert = catData.items.map((item, idx) => ({
          categoryId: category.id, name: item.name, nameVi: item.nameVi || null, sortOrder: idx, isActive: true
        }));
        await db.insert(sugumaillaneItems).values(itemsToInsert);
      }
    }
    console.log("[Sugumaillane] Initialized with", insertedCategories.length, "categories");
  }

  async retryFailedEmail(emailLogId: number): Promise<{ success: boolean; message: string }> {
    try {
      const [emailLog] = await db.select().from(sugumaillaneEmailLogs).where(eq(sugumaillaneEmailLogs.id, emailLogId));
      if (!emailLog) return { success: false, message: "Email log not found" };
      if (emailLog.success) return { success: true, message: "Email already sent successfully" };

      let checkedItems: Array<{ itemName: string; categoryName: string }> = [];
      try { checkedItems = JSON.parse(emailLog.itemsList); } catch {}

      if (checkedItems.length === 0) {
        return { success: false, message: "No items in failed email log" };
      }

      const byCategory: Record<string, string[]> = {};
      for (const item of checkedItems) {
        if (!byCategory[item.categoryName]) byCategory[item.categoryName] = [];
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
        to: this.config.emailTo,
        subject: `${this.config.emailSubjectPrefix} Liste des courses - ${emailLog.emailDate} (Récupération)`,
        body: emailContent
      }], 'ulysse', 1);

      const result = results[0] || { success: false, error: "No result" };

      if (result.success) {
        await db.update(sugumaillaneEmailLogs)
          .set({ success: true, error: `Recovered at ${new Date().toISOString()}` })
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

  async recoverFailedEmails(): Promise<{ checked: number; recovered: number; failed: string[] }> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoffDate = sevenDaysAgo.toISOString().split("T")[0];
    const failedEmails = await db.select().from(sugumaillaneEmailLogs)
      .where(eq(sugumaillaneEmailLogs.success, false))
      .orderBy(desc(sugumaillaneEmailLogs.sentAt))
      .limit(20);
    const recentFailures = failedEmails.filter(e => e.emailDate >= cutoffDate);
    if (recentFailures.length === 0) {
      console.log("[Sugumaillane] No failed emails to recover");
      return { checked: 0, recovered: 0, failed: [] };
    }
    console.log(`[Sugumaillane] Found ${recentFailures.length} failed emails to recover`);
    let recovered = 0;
    const failedRecoveries: string[] = [];
    for (const failedEmail of recentFailures) {
      if (recovered > 0) await new Promise(resolve => setTimeout(resolve, 2000));
      try {
        const result = await this.retryFailedEmail(failedEmail.id);
        if (result.success) {
          recovered++;
        } else {
          failedRecoveries.push(`${failedEmail.emailDate}: ${result.message}`);
        }
      } catch (e) {
        failedRecoveries.push(`${failedEmail.emailDate}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    console.log(`[Sugumaillane] Recovery complete: ${recovered}/${recentFailures.length} emails recovered`);
    return { checked: recentFailures.length, recovered, failed: failedRecoveries };
  }

  async sendDailyEmailWithRetry(overrideDay?: string, retryCount: number = 0, overrideDate?: Date): Promise<{ success: boolean; message: string }> {
    const result = await this.sendDailyEmail(overrideDay, overrideDate);
    if (result.success) return result;
    if (retryCount < MAX_RETRIES) {
      console.log(`[Sugumaillane] Email failed, scheduling retry ${retryCount + 1}/${MAX_RETRIES} in ${RETRY_DELAY_MS / 1000}s...`);
      setTimeout(async () => {
        const retryResult = await this.sendDailyEmailWithRetry(overrideDay, retryCount + 1, overrideDate);
        console.log(`[Sugumaillane] Retry ${retryCount + 1} result: ${retryResult.message}`);
      }, RETRY_DELAY_MS);
      return { success: false, message: `${result.message} - Retry scheduled (${retryCount + 1}/${MAX_RETRIES})` };
    }
    console.error(`[Sugumaillane] All ${MAX_RETRIES} retries exhausted for daily email`);
    return { success: false, message: `${result.message} - All ${MAX_RETRIES} retries exhausted` };
  }
}

export const sugumaillaneService = new SugumaillaneService();
