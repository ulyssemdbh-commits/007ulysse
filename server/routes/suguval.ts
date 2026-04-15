import type { Express, Request, Response, NextFunction } from "express";
import { suguvalService } from "../services/suguvalService";
import { z } from "zod";
import OpenAI from "openai";
import { db } from "../db";
import { suguvalComments, suguvalEmailLogs } from "@shared/schema";
import { getAIForContext } from "../services/core/openaiClient";
import { desc, eq } from "drizzle-orm";
import { calendarService } from "../services/googleCalendarService";
import { emitSuguChecklistUpdated } from "../services/realtimeSync";
import { emailActionService } from "../services/emailActionService";
import { getSessionToken } from "../middleware/auth";
import { authService } from "../services/auth";

const SUGUVAL_EMAIL_TO = process.env.SUGUVAL_EMAIL_TO || "sugu.gestion@gmail.com";

// Lightweight auth check for checklist admin operations (destructive/expensive)
// Keeps toggle/read public for staff tablets, but protects structural changes
async function requireSuguAuth(req: Request, res: Response, next: NextFunction) {
  const token = getSessionToken(req);
  if (!token) return res.status(403).json({ error: "Connexion requise pour cette opération" });
  const result = await authService.validateSession(token);
  if (!result.success) return res.status(403).json({ error: "Session invalide" });
  return next();
}

const SUGUVAL_API_SECRET = process.env.SUGUVAL_API_SECRET || (() => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("[Suguval] SUGUVAL_API_SECRET must be set in production");
  }
  console.warn("[Suguval] WARNING: Using default API secret — set SUGUVAL_API_SECRET in production");
  return "suguval-internal-2024";
})();

function requireSuguSecret(req: Request, res: Response, next: NextFunction) {
  const secret = req.headers["x-suguval-secret"];
  if (secret !== SUGUVAL_API_SECRET) return res.status(403).json({ error: "Forbidden" });
  return next();
}

export function registerSuguvalRoutes(app: Express) {
  // Initialize data from Excel (run once)
  suguvalService.initializeFromExcel().catch(err => {
    console.error("[Suguval] Init error:", err);
  });

  // Get all categories with items
  app.get("/api/suguval/categories", async (req: Request, res: Response) => {
    try {
      const categories = await suguvalService.getCategoriesWithItems();
      res.json(categories);
    } catch (error) {
      console.error("[Suguval] Get categories error:", error);
      res.status(500).json({ error: "Failed to get categories" });
    }
  });

  // Get dashboard stats for today
  app.get("/api/suguval/dashboard", async (req: Request, res: Response) => {
    try {
      const stats = await suguvalService.getDashboardStats();
      res.json(stats);
    } catch (error) {
      console.error("[Suguval] Get dashboard error:", error);
      res.status(500).json({ error: "Failed to get dashboard stats" });
    }
  });

  // Get today's checks
  app.get("/api/suguval/checks", async (req: Request, res: Response) => {
    try {
      const checks = await suguvalService.getTodayChecks();
      res.json(checks);
    } catch (error) {
      console.error("[Suguval] Get checks error:", error);
      res.status(500).json({ error: "Failed to get checks" });
    }
  });

  // Toggle item check
  const toggleSchema = z.object({
    itemId: z.number(),
    isChecked: z.boolean()
  });

  app.post("/api/suguval/toggle", async (req: Request, res: Response) => {
    try {
      const data = toggleSchema.parse(req.body);
      const result = await suguvalService.toggleCheck(data.itemId, data.isChecked);
      res.json(result);
      emitSuguChecklistUpdated();
    } catch (error) {
      console.error("[Suguval] Toggle error:", error);
      res.status(500).json({ error: "Failed to toggle check" });
    }
  });

  // Reset all checks for today
  app.post("/api/suguval/reset", requireSuguAuth, async (req: Request, res: Response) => {
    try {
      const result = await suguvalService.resetTodayChecks();
      res.json(result);
      emitSuguChecklistUpdated();
    } catch (error) {
      console.error("[Suguval] Reset error:", error);
      res.status(500).json({ error: "Failed to reset checks" });
    }
  });

  // Update item translations and category
  const updateItemSchema = z.object({
    name: z.string().optional(),
    nameVi: z.string().nullable().optional(),
    nameTh: z.string().nullable().optional(),
    categoryId: z.number().optional()
  });

  app.patch("/api/suguval/items/:id", async (req: Request, res: Response) => {
    try {
      const itemId = parseInt(req.params.id);
      if (isNaN(itemId)) {
        res.status(400).json({ error: "Invalid item ID" });
        return;
      }
      const data = updateItemSchema.parse(req.body);
      const result = await suguvalService.updateItem(itemId, data);
      res.json(result);
      emitSuguChecklistUpdated();
    } catch (error) {
      console.error("[Suguval] Update item error:", error);
      res.status(500).json({ error: "Failed to update item" });
    }
  });

  // Translate item name to target language
  const translateSchema = z.object({
    text: z.string(),
    targetLanguage: z.enum(["vi", "th"])
  });

  app.post("/api/suguval/translate", requireSuguAuth, async (req: Request, res: Response) => {
    try {
      const { text, targetLanguage } = translateSchema.parse(req.body);
      
      const _suguvalAI = getAIForContext("suguval");

      const languageName = targetLanguage === "vi" ? "Vietnamese" : "Thai";
      
      const response = await _suguvalAI.client.chat.completions.create({
        model: _suguvalAI.model,
        messages: [
          {
            role: "system",
            content: `You are a translator. Translate the given French food/grocery item name to ${languageName}. Return ONLY the translated text, nothing else. Keep the translation natural and commonly used in ${languageName}-speaking contexts.`
          },
          {
            role: "user",
            content: text
          }
        ],
        max_completion_tokens: 100
      });

      const translation = response.choices[0]?.message?.content?.trim() || "";
      res.json({ translation });
    } catch (error) {
      console.error("[Suguval] Translation error:", error);
      res.status(500).json({ error: "Failed to translate" });
    }
  });

  // Move item up or down within its category
  const moveItemSchema = z.object({
    direction: z.enum(["up", "down"])
  });

  app.post("/api/suguval/items/:id/move", requireSuguAuth, async (req: Request, res: Response) => {
    try {
      const itemId = parseInt(req.params.id);
      if (isNaN(itemId)) {
        res.status(400).json({ error: "Invalid item ID" });
        return;
      }
      const { direction } = moveItemSchema.parse(req.body);
      const result = await suguvalService.moveItem(itemId, direction);
      if (!result) {
        res.status(400).json({ error: "Cannot move item" });
        return;
      }
      res.json(result);
      emitSuguChecklistUpdated();
    } catch (error) {
      console.error("[Suguval] Move item error:", error);
      res.status(500).json({ error: "Failed to move item" });
    }
  });

  // Reorder items within a category (drag-and-drop)
  const reorderItemsSchema = z.object({
    categoryId: z.number(),
    orderedIds: z.array(z.number())
  });

  app.post("/api/suguval/items/reorder", requireSuguAuth, async (req: Request, res: Response) => {
    try {
      const { categoryId, orderedIds } = reorderItemsSchema.parse(req.body);
      const result = await suguvalService.reorderItems(categoryId, orderedIds);
      res.json(result);
      emitSuguChecklistUpdated();
    } catch (error) {
      console.error("[Suguval] Reorder items error:", error);
      res.status(500).json({ error: "Failed to reorder items" });
    }
  });

  // Update category name and translations
  const updateCategorySchema = z.object({
    name: z.string().min(1).optional(),
    nameVi: z.string().nullable().optional(),
    nameTh: z.string().nullable().optional(),
    sortOrder: z.number().optional()
  });

  app.patch("/api/suguval/categories/:id", async (req: Request, res: Response) => {
    try {
      const categoryId = parseInt(req.params.id);
      if (isNaN(categoryId)) {
        res.status(400).json({ error: "Invalid category ID" });
        return;
      }
      const data = updateCategorySchema.parse(req.body);
      const result = await suguvalService.updateCategory(categoryId, data);
      res.json(result);
      emitSuguChecklistUpdated();
    } catch (error) {
      console.error("[Suguval] Update category error:", error);
      res.status(500).json({ error: "Failed to update category" });
    }
  });

  // Create new category
  const createCategorySchema = z.object({
    name: z.string().min(1),
    sheet: z.enum(["Feuil1", "Feuil2"])
  });

  app.post("/api/suguval/categories", requireSuguAuth, async (req: Request, res: Response) => {
    try {
      const data = createCategorySchema.parse(req.body);
      const result = await suguvalService.createCategory(data.name, data.sheet);
      res.json(result);
      emitSuguChecklistUpdated();
    } catch (error) {
      console.error("[Suguval] Create category error:", error);
      res.status(500).json({ error: "Failed to create category" });
    }
  });

  // Delete category
  app.delete("/api/suguval/categories/:id", requireSuguAuth, async (req: Request, res: Response) => {
    try {
      const categoryId = parseInt(req.params.id);
      if (isNaN(categoryId)) {
        res.status(400).json({ error: "Invalid category ID" });
        return;
      }
      const result = await suguvalService.deleteCategory(categoryId);
      res.json(result);
      emitSuguChecklistUpdated();
    } catch (error) {
      console.error("[Suguval] Delete category error:", error);
      res.status(500).json({ error: "Failed to delete category" });
    }
  });

  // Create new item
  const createItemSchema = z.object({
    name: z.string().min(1),
    categoryId: z.number()
  });

  app.post("/api/suguval/items", requireSuguAuth, async (req: Request, res: Response) => {
    try {
      const data = createItemSchema.parse(req.body);
      const result = await suguvalService.createItem(data.name, data.categoryId);
      res.json(result);
      emitSuguChecklistUpdated();
    } catch (error) {
      console.error("[Suguval] Create item error:", error);
      res.status(500).json({ error: "Failed to create item" });
    }
  });

  // Delete item
  app.delete("/api/suguval/items/:id", requireSuguAuth, async (req: Request, res: Response) => {
    try {
      const itemId = parseInt(req.params.id);
      if (isNaN(itemId)) {
        res.status(400).json({ error: "Invalid item ID" });
        return;
      }
      const result = await suguvalService.deleteItem(itemId);
      res.json(result);
      emitSuguChecklistUpdated();
    } catch (error) {
      console.error("[Suguval] Delete item error:", error);
      res.status(500).json({ error: "Failed to delete item" });
    }
  });

  // Reorder categories
  const reorderCategoriesSchema = z.object({
    orderedIds: z.array(z.number())
  });

  app.post("/api/suguval/categories/reorder", requireSuguAuth, async (req: Request, res: Response) => {
    try {
      const data = reorderCategoriesSchema.parse(req.body);
      await suguvalService.reorderCategories(data.orderedIds);
      res.json({ success: true });
      emitSuguChecklistUpdated();
    } catch (error) {
      console.error("[Suguval] Reorder categories error:", error);
      res.status(500).json({ error: "Failed to reorder categories" });
    }
  });

  // Get checked items for today (for preview)
  app.get("/api/suguval/summary", async (req: Request, res: Response) => {
    try {
      const items = await suguvalService.getCheckedItemsForToday();
      res.json({ date: new Date().toISOString().split("T")[0], items, count: items.length });
    } catch (error) {
      console.error("[Suguval] Summary error:", error);
      res.status(500).json({ error: "Failed to get summary" });
    }
  });

  // Manually trigger email (protected - requires secret header)
  app.post("/api/suguval/send-email", requireSuguAuth, requireSuguSecret, async (req: Request, res: Response) => {
    try {
      const result = await suguvalService.sendDailyEmail();
      res.json(result);
    } catch (error) {
      console.error("[Suguval] Email error:", error);
      res.status(500).json({ error: "Failed to send email" });
    }
  });

  // Get email logs (protected)
  app.get("/api/suguval/email-logs", requireSuguSecret, async (req: Request, res: Response) => {
    try {
      const logs = await suguvalService.getEmailLogs();
      res.json(logs);
    } catch (error) {
      console.error("[Suguval] Logs error:", error);
      res.status(500).json({ error: "Failed to get logs" });
    }
  });

  // Get history of sent lists (public - only shows confirmed sent emails)
  app.get("/api/suguval/history", async (req: Request, res: Response) => {
    try {
      const month = req.query.month as string; // YYYY-MM format
      const history = await suguvalService.getHistory(month);
      res.json(history);
    } catch (error) {
      console.error("[Suguval] History error:", error);
      res.status(500).json({ error: "Failed to get history" });
    }
  });

  // Get weekly stats (last 7 days trend) for historical analysis
  app.get("/api/suguval/weekly", async (req: Request, res: Response) => {
    try {
      const stats = await suguvalService.getWeeklyStats();
      res.json(stats);
    } catch (error) {
      console.error("[Suguval] Weekly stats error:", error);
      res.status(500).json({ error: "Failed to get weekly stats" });
    }
  });

  // Simulation endpoint: Send 6 emails representing a full week of different grocery lists
  // Protected with secret header - only for testing
  app.post("/api/suguval/simulate-week", requireSuguSecret, async (req: Request, res: Response) => {
    try {

      const categories = await suguvalService.getCategoriesWithItems();
      
      // 6 days of simulation (excluding Friday evening and Saturday)
      // Dimanche soir → Lundi, Lundi → Mardi, Mardi → Mercredi, Mercredi → Jeudi, Jeudi → Vendredi
      // Dimanche sends Friday's list for Monday
      const weekDays = [
        { dayName: "Dimanche", deliveryDay: "Lundi", dayNum: 27 },
        { dayName: "Lundi", deliveryDay: "Mardi", dayNum: 28 },
        { dayName: "Mardi", deliveryDay: "Mercredi", dayNum: 29 },
        { dayName: "Mercredi", deliveryDay: "Jeudi", dayNum: 30 },
        { dayName: "Jeudi", deliveryDay: "Vendredi", dayNum: 31 },
        // Additional day to reach 6 emails - simulate next week's Sunday
        { dayName: "Dimanche (sem+1)", deliveryDay: "Lundi", dayNum: 3 }
      ];

      // Different item selections for each day (realistic patterns)
      const dailySelections = [
        // Dimanche: Full weekly stock for Monday
        ["RIZ", "SEL", "POIVRE", "HUILE DE TOURNESOL", "OEUFS", "SAUMON", "POULET", "CAROTTE", "CONCOMBRE", "CITRON", "ANETH", "COCA", "EVIAN"],
        // Lundi: Light day
        ["THON NATURE", "MAIS", "SALADE", "TOMATE CERISE", "MENTHE", "ORANGINA"],
        // Mardi: Viandes focus
        ["BŒUF", "DINDE", "CHAMPIGNONS BLANCS", "POIVRON", "GINGEMBRE", "ASAHI", "SINGHA"],
        // Mercredi: Asian products
        ["VERMICELLE DE RIZ", "NOUILLES JAUNES", "PAD THAI", "SAUCE SOJA", "SAUCE NEMS", "EDAMAME", "MANGUE"],
        // Jeudi: Full restock for weekend prep (Friday)
        ["FARINE", "SUCRE EN SAC", "CREME LIQUIDE DESSERT", "AVOCAT", "ANANAS", "KIWI", "CAFE", "THE", "CHARLOTTES", "GANTS M"],
        // Dimanche suivant: New week
        ["RIZ", "HUILE D'OLIVE", "SAUMON", "THON ROUGE", "CHOU BLANC", "OIGNONS", "AIL", "CORRIANDRE", "CEBETTE", "HEINEKEN"]
      ];

      const results: Array<{ day: string; deliveryDay: string; itemCount: number; success: boolean }> = [];

      for (let i = 0; i < weekDays.length; i++) {
        const day = weekDays[i];
        const selectedItems = dailySelections[i];
        
        // Build items list with categories
        const itemsWithCategories: Array<{ itemName: string; categoryName: string }> = [];
        for (const itemName of selectedItems) {
          for (const cat of categories) {
            const foundItem = cat.items.find(item => item.name === itemName);
            if (foundItem) {
              itemsWithCategories.push({ itemName: foundItem.name, categoryName: cat.name });
              break;
            }
          }
        }

        // Group by category
        const byCategory: Record<string, string[]> = {};
        for (const item of itemsWithCategories) {
          if (!byCategory[item.categoryName]) {
            byCategory[item.categoryName] = [];
          }
          byCategory[item.categoryName].push(item.itemName);
        }

        const itemsList = Object.entries(byCategory)
          .map(([cat, items]) => `\n${cat}:\n${items.map(it => `  - ${it}`).join("\n")}`)
          .join("\n");

        const emailContent = `Bonjour,

[SIMULATION - Jour ${i + 1}/6 : ${day.dayName}]

Voici la liste des courses à effectuer pour ${day.deliveryDay} ${day.dayNum} janvier:
${itemsList}

Total: ${itemsWithCategories.length} articles à acheter.

---
Ce message est une SIMULATION envoyée par Ulysse pour tester le système Suguval.`;

        try {
          const emailResults = await emailActionService.executeActions([{
            type: "send",
            to: SUGUVAL_EMAIL_TO,
            subject: `[SIMULATION ${i + 1}/6] Liste courses ${day.deliveryDay} - Suguval`,
            body: emailContent
          }], 'ulysse', 1);

          const emailSuccess = emailResults[0]?.success ?? false;
          
          // Log to history
          const simDate = `2026-01-${String(day.dayNum).padStart(2, '0')}`;
          await db.insert(suguvalEmailLogs).values({
            emailDate: simDate,
            itemCount: itemsWithCategories.length,
            itemsList: JSON.stringify(itemsWithCategories.map(i => ({ itemName: i.itemName, categoryName: i.categoryName }))),
            success: emailSuccess,
            error: emailSuccess ? null : "Simulation"
          });
          
          // Add calendar event
          if (emailSuccess) {
            try {
              const deliveryDate = new Date(2026, 0, day.dayNum);
              const calStart = new Date(deliveryDate);
              calStart.setHours(8, 0, 0, 0);
              const calEnd = new Date(deliveryDate);
              calEnd.setHours(10, 0, 0, 0);
              
              await calendarService.createEvent(
                1,
                `[SUGUVAL SIM] Livraison ${day.deliveryDay} - ${itemsWithCategories.length} articles`,
                calStart,
                calEnd,
                { description: `Simulation: ${selectedItems.join(', ')}` }
              );
            } catch (calErr) {
              console.warn(`[Suguval] Sim calendar error:`, calErr);
            }
          }

          results.push({
            day: day.dayName,
            deliveryDay: day.deliveryDay,
            itemCount: itemsWithCategories.length,
            success: emailSuccess
          });

          // Small delay between emails to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 1500));
        } catch (error) {
          results.push({
            day: day.dayName,
            deliveryDay: day.deliveryDay,
            itemCount: itemsWithCategories.length,
            success: false
          });
        }
      }

      const successCount = results.filter(r => r.success).length;
      res.json({
        message: `Simulation terminée: ${successCount}/${results.length} emails envoyés avec succès`,
        results,
        destination: SUGUVAL_EMAIL_TO,
        savedToHistory: true,
        savedToCalendar: true
      });
    } catch (error) {
      console.error("[Suguval] Simulation error:", error);
      res.status(500).json({ error: "Failed to run simulation" });
    }
  });

  // Send shopping list via Discord bot
  app.post("/api/suguval/send-discord", async (req: Request, res: Response) => {
    try {
      const { discordBotService } = await import("../services/discordBotService");
      const checkedItems = await suguvalService.getCheckedItemsForToday();

      if (checkedItems.length === 0) {
        res.json({ success: false, message: "Aucun article coché à envoyer" });
        return;
      }

      if (!discordBotService.isReady()) {
        res.status(503).json({ success: false, message: "Bot Discord non connecté" });
        return;
      }

      const today = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long" });

      // Group by zone → category (preserving the sorted order from getCheckedItemsForToday)
      const byZone: { zoneName: string; categories: { catName: string; items: string[] }[] }[] = [];
      for (const item of checkedItems) {
        let zoneEntry = byZone.find(z => z.zoneName === item.zoneName);
        if (!zoneEntry) {
          zoneEntry = { zoneName: item.zoneName, categories: [] };
          byZone.push(zoneEntry);
        }
        let catEntry = zoneEntry.categories.find(c => c.catName === item.categoryName);
        if (!catEntry) {
          catEntry = { catName: item.categoryName, items: [] };
          zoneEntry.categories.push(catEntry);
        }
        catEntry.items.push(item.itemName);
      }

      let msg = `🛒 **Liste de courses SUGU Valentine** — ${today}\n`;
      msg += `**${checkedItems.length} article${checkedItems.length > 1 ? "s" : ""} à commander**\n\n`;

      for (const zone of byZone) {
        msg += `**━━ ${zone.zoneName} ━━**\n`;
        for (const cat of zone.categories) {
          msg += `__${cat.catName}__\n`;
          msg += cat.items.map(i => `• ${i}`).join("\n") + "\n";
        }
        msg += "\n";
      }

      // Find the right channel via the bot
      const guilds = await discordBotService.getGuilds();
      if (guilds.length === 0) {
        res.status(503).json({ success: false, message: "Bot n'est dans aucun serveur Discord" });
        return;
      }

      const channels = await discordBotService.getChannels(guilds[0].id);
      const targetName = process.env.DISCORD_SHOPPING_CHANNEL || "général";
      const channel = channels.find(c =>
        c.name.toLowerCase() === targetName.toLowerCase() ||
        c.name.toLowerCase() === targetName.replace(/[éèê]/g, "e").toLowerCase()
      ) || channels[0];

      if (!channel) {
        res.status(503).json({ success: false, message: "Aucun canal Discord disponible" });
        return;
      }

      const success = await discordBotService.sendMessage(channel.id, msg);
      if (success) {
        console.log(`[Suguval] Liste courses envoyée sur Discord #${channel.name} (${checkedItems.length} articles)`);
        res.json({ success: true, count: checkedItems.length, channel: channel.name });
      } else {
        res.status(500).json({ success: false, message: "Échec de l'envoi Discord" });
      }
    } catch (error: any) {
      console.error("[Suguval] Discord send error:", error.message);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Manual email send — triggered from the checklist UI (requireSuguAuth only, no secret header)
  app.post("/api/suguval/send-list-email", requireSuguAuth, async (req: Request, res: Response) => {
    try {
      const result = await suguvalService.sendDailyEmail();
      res.json(result);
    } catch (error: any) {
      console.error("[Suguval] Manual email error:", error.message);
      res.status(500).json({ success: false, message: error.message || "Erreur lors de l'envoi" });
    }
  });

  // AI-only endpoint for Ulysse to consult and analyze the checklist
  // Protected: requires authenticated user with isOwner=true (Ulysse persona only)
  app.get("/api/suguval/ai-consult", async (req: Request, res: Response) => {
    try {
      // Only allow Ulysse (owner) - not Iris or Alfred
      const user = (req as any).user;
      if (!user?.isOwner) {
        res.status(403).json({ error: "Access reserved for Ulysse only" });
        return;
      }

      // Get complete data for AI analysis
      const categories = await suguvalService.getCategoriesWithItems();
      const todayChecks = await suguvalService.getTodayChecks();
      const checkedItems = await suguvalService.getCheckedItemsForToday();
      const recentHistory = await suguvalService.getHistory();

      // Build comprehensive analysis report
      const today = new Date().toISOString().split("T")[0];
      const totalItems = categories.reduce((acc, cat) => acc + cat.items.length, 0);
      const checkedCount = checkedItems.length;

      // Group items by category for better analysis
      const categorySummary = categories.map(cat => {
        const catChecks = todayChecks.filter(c => 
          cat.items.some(item => item.id === c.itemId) && c.isChecked
        );
        return {
          name: cat.name,
          sheet: cat.sheet,
          totalItems: cat.items.length,
          checkedToday: catChecks.length,
          items: cat.items.map(item => ({
            name: item.name,
            nameVi: item.nameVi,
            nameTh: item.nameTh,
            isCheckedToday: todayChecks.some(c => c.itemId === item.id && c.isChecked)
          }))
        };
      });

      // Recent purchases analysis (last 7 days from history)
      const recentPurchases = recentHistory.slice(0, 7).map(h => ({
        date: h.date,
        itemCount: h.items.length,
        items: h.items.map(i => i.name)
      }));

      res.json({
        consultation: {
          date: today,
          summary: {
            totalItems,
            checkedToday: checkedCount,
            percentageComplete: totalItems > 0 ? Math.round((checkedCount / totalItems) * 100) : 0
          },
          categories: categorySummary,
          todayCheckedItems: checkedItems.map(i => ({
            name: i.itemName,
            category: i.categoryName
          })),
          recentHistory: recentPurchases,
          metadata: {
            restaurant: "Suguval",
            destination: SUGUVAL_EMAIL_TO,
            emailTime: "23h59 daily",
            languages: ["FR", "VN", "TH"]
          }
        }
      });
    } catch (error) {
      console.error("[Suguval] AI consult error:", error);
      res.status(500).json({ error: "Failed to get AI consultation data" });
    }
  });

  // Get future items for a specific date
  app.get("/api/suguval/future", async (req: Request, res: Response) => {
    try {
      const date = req.query.date as string;
      if (!date) {
        res.status(400).json({ error: "Date is required" });
        return;
      }
      const items = await suguvalService.getFutureItems(date);
      res.json(items);
    } catch (error) {
      console.error("[Suguval] Get future items error:", error);
      res.status(500).json({ error: "Failed to get future items" });
    }
  });

  // Add future item
  const futureItemSchema = z.object({
    itemId: z.number(),
    date: z.string()
  });

  app.post("/api/suguval/future", async (req: Request, res: Response) => {
    try {
      const data = futureItemSchema.parse(req.body);
      const result = await suguvalService.addFutureItem(data.itemId, data.date);
      res.json(result);
      emitSuguChecklistUpdated();
    } catch (error) {
      console.error("[Suguval] Add future item error:", error);
      res.status(500).json({ error: "Failed to add future item" });
    }
  });

  // Remove future item
  app.delete("/api/suguval/future", requireSuguAuth, async (req: Request, res: Response) => {
    try {
      const data = futureItemSchema.parse(req.body);
      const result = await suguvalService.removeFutureItem(data.itemId, data.date);
      res.json(result);
      emitSuguChecklistUpdated();
    } catch (error) {
      console.error("[Suguval] Remove future item error:", error);
      res.status(500).json({ error: "Failed to remove future item" });
    }
  });

  // Sync catalog from Suguval (master) to SUGU Maillane
  // Copies all categories and items to Sugumaillane database
  app.post("/api/suguval/sync-to-maillane", requireSuguAuth, async (req: Request, res: Response) => {
    try {
      const result = await suguvalService.syncToMaillane();
      res.json(result);
      emitSuguChecklistUpdated();
    } catch (error) {
      console.error("[Suguval] Sync to Maillane error:", error);
      res.status(500).json({ error: "Failed to sync catalog to Maillane" });
    }
  });

  // Assign zones to existing categories (one-time migration)
  app.post("/api/suguval/assign-zones", requireSuguAuth, requireSuguSecret, async (req: Request, res: Response) => {
    try {
      const result = await suguvalService.assignZonesToCategories();
      res.json({ success: true, ...result });
      emitSuguChecklistUpdated();
    } catch (error) {
      console.error("[Suguval] Assign zones error:", error);
      res.status(500).json({ error: "Failed to assign zones" });
    }
  });

  // ============================================
  // COMMENTS - Employee notes to admin
  // ============================================

  // Get recent comments
  app.get("/api/suguval/comments", async (req: Request, res: Response) => {
    try {
      const comments = await db.select()
        .from(suguvalComments)
        .orderBy(desc(suguvalComments.createdAt))
        .limit(20);
      res.json(comments);
    } catch (error) {
      console.error("[Suguval] Get comments error:", error);
      res.status(500).json({ error: "Failed to get comments" });
    }
  });

  // Add new comment
  const addCommentSchema = z.object({
    author: z.string().min(1).max(50),
    message: z.string().min(1).max(500)
  });

  app.post("/api/suguval/comments", requireSuguAuth, async (req: Request, res: Response) => {
    try {
      const data = addCommentSchema.parse(req.body);
      const [comment] = await db.insert(suguvalComments)
        .values(data)
        .returning();
      res.json(comment);
      emitSuguChecklistUpdated();
    } catch (error) {
      console.error("[Suguval] Add comment error:", error);
      res.status(500).json({ error: "Failed to add comment" });
    }
  });

  // Update comment
  const updateCommentSchema = z.object({
    message: z.string().min(1).max(500)
  });

  app.patch("/api/suguval/comments/:id", requireSuguAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid comment ID" });
        return;
      }
      const data = updateCommentSchema.parse(req.body);
      const [comment] = await db.update(suguvalComments)
        .set({ message: data.message })
        .where(eq(suguvalComments.id, id))
        .returning();
      if (!comment) {
        res.status(404).json({ error: "Comment not found" });
        return;
      }
      res.json(comment);
      emitSuguChecklistUpdated();
    } catch (error) {
      console.error("[Suguval] Update comment error:", error);
      res.status(500).json({ error: "Failed to update comment" });
    }
  });

  // Delete comment
  app.delete("/api/suguval/comments/:id", requireSuguAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid comment ID" });
        return;
      }
      const [deleted] = await db.delete(suguvalComments)
        .where(eq(suguvalComments.id, id))
        .returning();
      if (!deleted) {
        res.status(404).json({ error: "Comment not found" });
        return;
      }
      res.json({ success: true });
      emitSuguChecklistUpdated();
    } catch (error) {
      console.error("[Suguval] Delete comment error:", error);
      res.status(500).json({ error: "Failed to delete comment" });
    }
  });

  // Translate text endpoint for comments using Core Ulysse translation service
  const commentTranslateSchema = z.object({
    text: z.string().min(1),
    fromLang: z.enum(["fr", "vi", "th"]),
    toLang: z.enum(["fr", "vi", "th"])
  });

  app.post("/api/suguval/translate-comment", requireSuguAuth, async (req: Request, res: Response) => {
    try {
      const { text, fromLang, toLang } = commentTranslateSchema.parse(req.body);
      
      if (fromLang === toLang || !text.trim()) {
        res.json({ translatedText: text, fromCache: false });
        return;
      }

      // Import translation service dynamically to avoid circular deps
      const { translationService } = await import("../services/translationService");
      
      const result = await translationService.translate({
        text,
        sourceLang: fromLang,
        targetLang: toLang,
        domain: "general",
        tone: "casual"
      });

      res.json({ 
        translatedText: result.translated,
        fromCache: result.fromCache,
        sourceLang: result.sourceLang,
        targetLang: result.targetLang
      });
    } catch (error) {
      console.error("[Suguval] Translate error:", error);
      res.status(500).json({ error: "Failed to translate" });
    }
  });

  console.log("[Suguval] Routes registered");
}
