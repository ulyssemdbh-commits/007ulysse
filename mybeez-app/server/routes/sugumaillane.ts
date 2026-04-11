import type { Express, Request, Response, NextFunction } from "express";
import { getSessionToken } from "../middleware/auth";
import { authService } from "../services/auth";

async function requireSuguAuth(req: Request, res: Response, next: NextFunction) {
  const token = getSessionToken(req);
  if (!token) return res.status(403).json({ error: "Connexion requise pour cette opération" });
  const result = await authService.validateSession(token);
  if (!result.success) return res.status(403).json({ error: "Session invalide" });
  return next();
}
import { sugumaillaneService } from "../services/sugumaillaneService";
import { z } from "zod";
import { emitSuguChecklistUpdated } from "../services/realtimeSync";

export function registerSugumaillaneRoutes(app: Express) {
  // Initialize data from Excel (run once)
  sugumaillaneService.initializeFromExcel().catch(err => {
    console.error("[Sugumaillane] Init error:", err);
  });

  // Get all categories with items
  app.get("/api/sugumaillane/categories", async (req: Request, res: Response) => {
    try {
      const categories = await sugumaillaneService.getCategoriesWithItems();
      res.json(categories);
    } catch (error) {
      console.error("[Sugumaillane] Get categories error:", error);
      res.status(500).json({ error: "Failed to get categories" });
    }
  });

  // Get dashboard stats for today
  app.get("/api/sugumaillane/dashboard", async (req: Request, res: Response) => {
    try {
      const stats = await sugumaillaneService.getDashboardStats();
      res.json(stats);
    } catch (error) {
      console.error("[Sugumaillane] Get dashboard error:", error);
      res.status(500).json({ error: "Failed to get dashboard stats" });
    }
  });

  // Get today's checks
  app.get("/api/sugumaillane/checks", async (req: Request, res: Response) => {
    try {
      const checks = await sugumaillaneService.getTodayChecks();
      res.json(checks);
    } catch (error) {
      console.error("[Sugumaillane] Get checks error:", error);
      res.status(500).json({ error: "Failed to get checks" });
    }
  });

  // Toggle item check
  const toggleSchema = z.object({
    itemId: z.number(),
    isChecked: z.boolean()
  });

  app.post("/api/sugumaillane/toggle", async (req: Request, res: Response) => {
    try {
      const data = toggleSchema.parse(req.body);
      const result = await sugumaillaneService.toggleCheck(data.itemId, data.isChecked);
      res.json(result);
      emitSuguChecklistUpdated();
    } catch (error) {
      console.error("[Sugumaillane] Toggle error:", error);
      res.status(500).json({ error: "Failed to toggle check" });
    }
  });

  // Reset all checks for today
  app.post("/api/sugumaillane/reset", requireSuguAuth, async (req: Request, res: Response) => {
    try {
      const result = await sugumaillaneService.resetTodayChecks();
      res.json(result);
      emitSuguChecklistUpdated();
    } catch (error) {
      console.error("[Sugumaillane] Reset error:", error);
      res.status(500).json({ error: "Failed to reset checks" });
    }
  });

  // Update item translations
  const updateItemSchema = z.object({
    nameVi: z.string().nullable().optional(),
    nameTh: z.string().nullable().optional()
  });

  app.patch("/api/sugumaillane/items/:id", async (req: Request, res: Response) => {
    try {
      const itemId = parseInt(req.params.id);
      if (isNaN(itemId)) {
        res.status(400).json({ error: "Invalid item ID" });
        return;
      }
      const data = updateItemSchema.parse(req.body);
      const result = await sugumaillaneService.updateItem(itemId, data);
      res.json(result);
      emitSuguChecklistUpdated();
    } catch (error) {
      console.error("[Sugumaillane] Update item error:", error);
      res.status(500).json({ error: "Failed to update item" });
    }
  });

  // Update category name and translations
  const updateCategorySchema = z.object({
    name: z.string().min(1).optional(),
    nameVi: z.string().nullable().optional(),
    nameTh: z.string().nullable().optional(),
    sortOrder: z.number().optional()
  });

  app.patch("/api/sugumaillane/categories/:id", async (req: Request, res: Response) => {
    try {
      const categoryId = parseInt(req.params.id);
      if (isNaN(categoryId)) {
        res.status(400).json({ error: "Invalid category ID" });
        return;
      }
      const data = updateCategorySchema.parse(req.body);
      const result = await sugumaillaneService.updateCategory(categoryId, data);
      res.json(result);
      emitSuguChecklistUpdated();
    } catch (error) {
      console.error("[Sugumaillane] Update category error:", error);
      res.status(500).json({ error: "Failed to update category" });
    }
  });

  // Reorder categories
  const reorderCategoriesSchema = z.object({
    orderedIds: z.array(z.number())
  });

  app.post("/api/sugumaillane/categories/reorder", requireSuguAuth, async (req: Request, res: Response) => {
    try {
      const data = reorderCategoriesSchema.parse(req.body);
      await sugumaillaneService.reorderCategories(data.orderedIds);
      res.json({ success: true });
      emitSuguChecklistUpdated();
    } catch (error) {
      console.error("[Sugumaillane] Reorder categories error:", error);
      res.status(500).json({ error: "Failed to reorder categories" });
    }
  });

  // Get checked items for today (for preview)
  app.get("/api/sugumaillane/summary", async (req: Request, res: Response) => {
    try {
      const items = await sugumaillaneService.getCheckedItemsForToday();
      res.json({ date: new Date().toISOString().split("T")[0], items, count: items.length });
    } catch (error) {
      console.error("[Sugumaillane] Summary error:", error);
      res.status(500).json({ error: "Failed to get summary" });
    }
  });

  // Manually trigger email (protected - requires secret header)
  app.post("/api/sugumaillane/send-email", requireSuguAuth, async (req: Request, res: Response) => {
    try {
      const secret = req.headers["x-sugumaillane-secret"];
      if (secret !== "sugumaillane-internal-2024") {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      const result = await sugumaillaneService.sendDailyEmail();
      res.json(result);
    } catch (error) {
      console.error("[Sugumaillane] Email error:", error);
      res.status(500).json({ error: "Failed to send email" });
    }
  });

  // Get email logs (protected)
  app.get("/api/sugumaillane/email-logs", async (req: Request, res: Response) => {
    try {
      const secret = req.headers["x-sugumaillane-secret"];
      if (secret !== "sugumaillane-internal-2024") {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      const logs = await sugumaillaneService.getEmailLogs();
      res.json(logs);
    } catch (error) {
      console.error("[Sugumaillane] Logs error:", error);
      res.status(500).json({ error: "Failed to get logs" });
    }
  });

  // Get history of sent lists (public - only shows confirmed sent emails)
  app.get("/api/sugumaillane/history", async (req: Request, res: Response) => {
    try {
      const month = req.query.month as string;
      const history = await sugumaillaneService.getHistory(month);
      res.json(history);
    } catch (error) {
      console.error("[Sugumaillane] History error:", error);
      res.status(500).json({ error: "Failed to get history" });
    }
  });

  // Get weekly stats (last 7 days trend) for historical analysis
  app.get("/api/sugumaillane/weekly", async (req: Request, res: Response) => {
    try {
      const stats = await sugumaillaneService.getWeeklyStats();
      res.json(stats);
    } catch (error) {
      console.error("[Sugumaillane] Weekly stats error:", error);
      res.status(500).json({ error: "Failed to get weekly stats" });
    }
  });

  // AI-only endpoint for Ulysse to consult and analyze the checklist
  app.get("/api/sugumaillane/ai-consult", async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user?.isOwner) {
        res.status(403).json({ error: "Access reserved for Ulysse only" });
        return;
      }

      const categories = await sugumaillaneService.getCategoriesWithItems();
      const todayChecks = await sugumaillaneService.getTodayChecks();
      const checkedItems = await sugumaillaneService.getCheckedItemsForToday();
      const recentHistory = await sugumaillaneService.getHistory();

      const today = new Date().toISOString().split("T")[0];
      const totalItems = categories.reduce((acc, cat) => acc + cat.items.length, 0);
      const checkedCount = checkedItems.length;

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
            restaurant: "SUGU Maillane",
            destination: "sugu.resto@gmail.com",
            emailTime: "23h59 daily",
            languages: ["FR", "VN", "TH"]
          }
        }
      });
    } catch (error) {
      console.error("[Sugumaillane] AI consult error:", error);
      res.status(500).json({ error: "Failed to get AI consultation data" });
    }
  });

  // Get future items for a specific date
  app.get("/api/sugumaillane/future", async (req: Request, res: Response) => {
    try {
      const date = req.query.date as string;
      if (!date) {
        res.status(400).json({ error: "Date is required" });
        return;
      }
      const items = await sugumaillaneService.getFutureItems(date);
      res.json(items);
    } catch (error) {
      console.error("[Sugumaillane] Get future items error:", error);
      res.status(500).json({ error: "Failed to get future items" });
    }
  });

  // Add future item
  const futureItemSchema = z.object({
    itemId: z.number(),
    date: z.string()
  });

  app.post("/api/sugumaillane/future", async (req: Request, res: Response) => {
    try {
      const data = futureItemSchema.parse(req.body);
      const result = await sugumaillaneService.addFutureItem(data.itemId, data.date);
      res.json(result);
      emitSuguChecklistUpdated();
    } catch (error) {
      console.error("[Sugumaillane] Add future item error:", error);
      res.status(500).json({ error: "Failed to add future item" });
    }
  });

  // Remove future item
  app.delete("/api/sugumaillane/future", requireSuguAuth, async (req: Request, res: Response) => {
    try {
      const data = futureItemSchema.parse(req.body);
      const result = await sugumaillaneService.removeFutureItem(data.itemId, data.date);
      res.json(result);
      emitSuguChecklistUpdated();
    } catch (error) {
      console.error("[Sugumaillane] Remove future item error:", error);
      res.status(500).json({ error: "Failed to remove future item" });
    }
  });

  console.log("[Sugumaillane] Routes registered");
}
