import { db } from "../db";
import { suguvalItems, suguvalChecks, suguvalCategories, sugumaillaneItems, sugumaillaneChecks, sugumaillaneCategories, suguAnalytics, type InsertSuguAnalytics } from "@shared/schema";
import { eq, and, gte, lte, desc, sql, count } from "drizzle-orm";

interface RotationAnalysis {
  itemId: number;
  itemName: string;
  categoryName: string;
  checkCount: number;
  daysAnalyzed: number;
  rotationRate: number; // checks per day
  trend: "increasing" | "stable" | "decreasing";
  lastChecked: Date | null;
}

interface StockoutAnalysis {
  itemId: number;
  itemName: string;
  categoryName: string;
  stockoutCount: number;
  daysWithStockout: number;
  stockoutRate: number; // percentage of days with stockout
  isRecurring: boolean;
  lastStockout: Date | null;
}

interface CategoryPerformance {
  categoryId: number;
  categoryName: string;
  zoneName: string;
  totalItems: number;
  averageCompletionRate: number;
  bestDay: { date: string; rate: number };
  worstDay: { date: string; rate: number };
  trend: "improving" | "stable" | "declining";
}

interface UnifiedInsight {
  type: "rotation" | "stockout" | "overstock" | "trend" | "recommendation";
  severity: "info" | "warning" | "critical";
  store: "suguval" | "sugumaillane" | "both";
  title: string;
  description: string;
  actionRequired: boolean;
  affectedItems?: string[];
  metrics?: Record<string, number>;
}

interface DashboardSummary {
  suguval: {
    totalItems: number;
    avgCompletionRate: number;
    stockoutRisk: number;
    topPerformingCategories: string[];
    issuesCount: number;
  };
  sugumaillane: {
    totalItems: number;
    avgCompletionRate: number;
    stockoutRisk: number;
    topPerformingCategories: string[];
    issuesCount: number;
  };
  insights: UnifiedInsight[];
  lastAnalyzed: Date;
}

const ZONE_NAMES: Record<number, string> = {
  1: "CUISINE",
  2: "SUSHI BAR",
  3: "RÉSERVE SÈCHE",
  4: "HYGIÈNE & CONSOMMABLES",
  5: "BOISSONS",
  6: "LIVRAISON & EMBALLAGES"
};

class SuguAnalyticsService {

  async analyzeRotation(store: "suguval" | "sugumaillane", days: number = 30): Promise<RotationAnalysis[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const items = store === "suguval"
      ? await db.select().from(suguvalItems).where(eq(suguvalItems.isActive, true))
      : await db.select().from(sugumaillaneItems).where(eq(sugumaillaneItems.isActive, true));

    const categories = store === "suguval"
      ? await db.select().from(suguvalCategories)
      : await db.select().from(sugumaillaneCategories);

    const categoryMap = new Map(categories.map(c => [c.id, c.name]));

    const checksTable = store === "suguval" ? suguvalChecks : sugumaillaneChecks;
    
    const results: RotationAnalysis[] = [];

    for (const item of items) {
      const checks = await db.select()
        .from(checksTable)
        .where(and(
          eq(checksTable.itemId, item.id),
          gte(checksTable.checkDate, startDate.toISOString().split("T")[0])
        ));

      const checkCount = checks.filter(c => c.isChecked).length;
      const rotationRate = checkCount / days;

      // Calculate trend based on first half vs second half
      const midpoint = new Date(startDate.getTime() + (Date.now() - startDate.getTime()) / 2);
      const firstHalf = checks.filter(c => new Date(c.checkDate) < midpoint && c.isChecked).length;
      const secondHalf = checks.filter(c => new Date(c.checkDate) >= midpoint && c.isChecked).length;
      
      let trend: "increasing" | "stable" | "decreasing" = "stable";
      if (secondHalf > firstHalf * 1.2) trend = "increasing";
      else if (secondHalf < firstHalf * 0.8) trend = "decreasing";

      const lastCheck = checks.filter(c => c.isChecked).sort((a, b) => 
        new Date(b.checkDate).getTime() - new Date(a.checkDate).getTime()
      )[0];

      results.push({
        itemId: item.id,
        itemName: item.name,
        categoryName: categoryMap.get(item.categoryId) || "Unknown",
        checkCount,
        daysAnalyzed: days,
        rotationRate: Math.round(rotationRate * 100) / 100,
        trend,
        lastChecked: lastCheck ? new Date(lastCheck.checkDate) : null
      });
    }

    return results.sort((a, b) => b.rotationRate - a.rotationRate);
  }

  async analyzeStockouts(store: "suguval" | "sugumaillane", days: number = 30): Promise<StockoutAnalysis[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const items = store === "suguval"
      ? await db.select().from(suguvalItems).where(eq(suguvalItems.isActive, true))
      : await db.select().from(sugumaillaneItems).where(eq(sugumaillaneItems.isActive, true));

    const categories = store === "suguval"
      ? await db.select().from(suguvalCategories)
      : await db.select().from(sugumaillaneCategories);

    const categoryMap = new Map(categories.map(c => [c.id, c.name]));
    const checksTable = store === "suguval" ? suguvalChecks : sugumaillaneChecks;
    
    const results: StockoutAnalysis[] = [];

    for (const item of items) {
      const checks = await db.select()
        .from(checksTable)
        .where(and(
          eq(checksTable.itemId, item.id),
          gte(checksTable.checkDate, startDate.toISOString().split("T")[0])
        ));

      // Count stockouts (days where item was NOT checked but should have been)
      const uniqueDays = new Set(checks.map(c => c.checkDate));
      const checkedDays = new Set(checks.filter(c => c.isChecked).map(c => c.checkDate));
      const stockoutDays = [...uniqueDays].filter(d => !checkedDays.has(d));

      const stockoutRate = uniqueDays.size > 0 ? (stockoutDays.length / uniqueDays.size) * 100 : 0;
      const isRecurring = stockoutDays.length >= 3; // 3+ stockouts = recurring issue

      const lastStockout = stockoutDays.sort().reverse()[0];

      results.push({
        itemId: item.id,
        itemName: item.name,
        categoryName: categoryMap.get(item.categoryId) || "Unknown",
        stockoutCount: stockoutDays.length,
        daysWithStockout: stockoutDays.length,
        stockoutRate: Math.round(stockoutRate * 10) / 10,
        isRecurring,
        lastStockout: lastStockout ? new Date(lastStockout) : null
      });
    }

    return results.filter(r => r.stockoutCount > 0).sort((a, b) => b.stockoutRate - a.stockoutRate);
  }

  async analyzeCategoryPerformance(store: "suguval" | "sugumaillane", days: number = 30): Promise<CategoryPerformance[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const categories = store === "suguval"
      ? await db.select().from(suguvalCategories)
      : await db.select().from(sugumaillaneCategories);

    const items = store === "suguval"
      ? await db.select().from(suguvalItems).where(eq(suguvalItems.isActive, true))
      : await db.select().from(sugumaillaneItems).where(eq(sugumaillaneItems.isActive, true));

    const checksTable = store === "suguval" ? suguvalChecks : sugumaillaneChecks;
    
    const results: CategoryPerformance[] = [];

    for (const category of categories) {
      const categoryItems = items.filter(i => i.categoryId === category.id);
      if (categoryItems.length === 0) continue;

      const itemIds = categoryItems.map(i => i.id);
      
      // Get all checks for this category's items
      const allChecks: any[] = [];
      for (const itemId of itemIds) {
        const checks = await db.select()
          .from(checksTable)
          .where(and(
            eq(checksTable.itemId, itemId),
            gte(checksTable.checkDate, startDate.toISOString().split("T")[0])
          ));
        allChecks.push(...checks);
      }

      // Group by date
      const byDate = new Map<string, { checked: number; total: number }>();
      for (const check of allChecks) {
        const date = check.checkDate;
        if (!byDate.has(date)) byDate.set(date, { checked: 0, total: categoryItems.length });
        if (check.isChecked) byDate.get(date)!.checked++;
      }

      // Calculate daily rates
      const dailyRates = Array.from(byDate.entries()).map(([date, { checked, total }]) => ({
        date,
        rate: (checked / total) * 100
      })).sort((a, b) => a.date.localeCompare(b.date));

      const avgRate = dailyRates.length > 0
        ? dailyRates.reduce((sum, d) => sum + d.rate, 0) / dailyRates.length
        : 0;

      const bestDay = dailyRates.reduce((best, d) => d.rate > best.rate ? d : best, { date: "", rate: 0 });
      const worstDay = dailyRates.reduce((worst, d) => d.rate < worst.rate ? d : worst, { date: "", rate: 100 });

      // Calculate trend
      const midIdx = Math.floor(dailyRates.length / 2);
      const firstHalfAvg = dailyRates.slice(0, midIdx).reduce((s, d) => s + d.rate, 0) / Math.max(1, midIdx);
      const secondHalfAvg = dailyRates.slice(midIdx).reduce((s, d) => s + d.rate, 0) / Math.max(1, dailyRates.length - midIdx);

      let trend: "improving" | "stable" | "declining" = "stable";
      if (secondHalfAvg > firstHalfAvg + 10) trend = "improving";
      else if (secondHalfAvg < firstHalfAvg - 10) trend = "declining";

      results.push({
        categoryId: category.id,
        categoryName: category.name,
        zoneName: ZONE_NAMES[category.zone] || "AUTRE",
        totalItems: categoryItems.length,
        averageCompletionRate: Math.round(avgRate * 10) / 10,
        bestDay,
        worstDay: worstDay.date ? worstDay : { date: "N/A", rate: 0 },
        trend
      });
    }

    return results.sort((a, b) => b.averageCompletionRate - a.averageCompletionRate);
  }

  async generateInsights(days: number = 30): Promise<UnifiedInsight[]> {
    const insights: UnifiedInsight[] = [];

    // Analyze both stores
    const [suguvalRotation, sugumaillaneRotation] = await Promise.all([
      this.analyzeRotation("suguval", days),
      this.analyzeRotation("sugumaillane", days)
    ]);

    const [suguvalStockouts, sugumaillaneStockouts] = await Promise.all([
      this.analyzeStockouts("suguval", days),
      this.analyzeStockouts("sugumaillane", days)
    ]);

    const [suguvalCategories, sugumaillaneCategories] = await Promise.all([
      this.analyzeCategoryPerformance("suguval", days),
      this.analyzeCategoryPerformance("sugumaillane", days)
    ]);

    // High rotation items
    const highRotationSuguval = suguvalRotation.filter(r => r.rotationRate > 0.8);
    const highRotationSugumaillane = sugumaillaneRotation.filter(r => r.rotationRate > 0.8);

    if (highRotationSuguval.length > 0) {
      insights.push({
        type: "rotation",
        severity: "info",
        store: "suguval",
        title: "Produits à forte rotation (Suguval)",
        description: `${highRotationSuguval.length} produits sont vérifiés quotidiennement`,
        actionRequired: false,
        affectedItems: highRotationSuguval.slice(0, 5).map(r => r.itemName),
        metrics: { count: highRotationSuguval.length }
      });
    }

    // Recurring stockouts
    const recurringStockoutsSuguval = suguvalStockouts.filter(s => s.isRecurring);
    const recurringStockoutsSugumaillane = sugumaillaneStockouts.filter(s => s.isRecurring);

    if (recurringStockoutsSuguval.length > 0) {
      insights.push({
        type: "stockout",
        severity: "warning",
        store: "suguval",
        title: "Ruptures récurrentes (Suguval)",
        description: `${recurringStockoutsSuguval.length} produits ont des ruptures régulières`,
        actionRequired: true,
        affectedItems: recurringStockoutsSuguval.map(s => s.itemName),
        metrics: { 
          count: recurringStockoutsSuguval.length,
          avgStockoutRate: Math.round(recurringStockoutsSuguval.reduce((s, r) => s + r.stockoutRate, 0) / recurringStockoutsSuguval.length)
        }
      });
    }

    if (recurringStockoutsSugumaillane.length > 0) {
      insights.push({
        type: "stockout",
        severity: "warning",
        store: "sugumaillane",
        title: "Ruptures récurrentes (Sugumaillane)",
        description: `${recurringStockoutsSugumaillane.length} produits ont des ruptures régulières`,
        actionRequired: true,
        affectedItems: recurringStockoutsSugumaillane.map(s => s.itemName),
        metrics: { 
          count: recurringStockoutsSugumaillane.length,
          avgStockoutRate: Math.round(recurringStockoutsSugumaillane.reduce((s, r) => s + r.stockoutRate, 0) / recurringStockoutsSugumaillane.length)
        }
      });
    }

    // Declining categories
    const decliningCategoriesSuguval = suguvalCategories.filter(c => c.trend === "declining");
    const decliningCategoriesSugumaillane = sugumaillaneCategories.filter(c => c.trend === "declining");

    if (decliningCategoriesSuguval.length > 0) {
      insights.push({
        type: "trend",
        severity: "warning",
        store: "suguval",
        title: "Catégories en déclin (Suguval)",
        description: `${decliningCategoriesSuguval.length} catégories montrent une baisse de performance`,
        actionRequired: true,
        affectedItems: decliningCategoriesSuguval.map(c => c.categoryName)
      });
    }

    // Low performing categories
    const lowPerformingSuguval = suguvalCategories.filter(c => c.averageCompletionRate < 50);
    if (lowPerformingSuguval.length > 0) {
      insights.push({
        type: "recommendation",
        severity: "critical",
        store: "suguval",
        title: "Catégories sous-performantes (Suguval)",
        description: `${lowPerformingSuguval.length} catégories ont moins de 50% de complétion`,
        actionRequired: true,
        affectedItems: lowPerformingSuguval.map(c => `${c.categoryName} (${c.averageCompletionRate}%)`)
      });
    }

    return insights.sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }

  async getDashboard(): Promise<DashboardSummary> {
    const insights = await this.generateInsights(30);

    const [suguvalCategories, sugumaillaneCategories] = await Promise.all([
      this.analyzeCategoryPerformance("suguval", 30),
      this.analyzeCategoryPerformance("sugumaillane", 30)
    ]);

    const [suguvalStockouts, sugumaillaneStockouts] = await Promise.all([
      this.analyzeStockouts("suguval", 30),
      this.analyzeStockouts("sugumaillane", 30)
    ]);

    const suguvalItemsData = await db.select().from(suguvalItems).where(eq(suguvalItems.isActive, true));
    const sugumaillaneItemsData = await db.select().from(sugumaillaneItems).where(eq(sugumaillaneItems.isActive, true));

    return {
      suguval: {
        totalItems: suguvalItemsData.length,
        avgCompletionRate: suguvalCategories.length > 0
          ? Math.round(suguvalCategories.reduce((s, c) => s + c.averageCompletionRate, 0) / suguvalCategories.length)
          : 0,
        stockoutRisk: suguvalStockouts.filter(s => s.isRecurring).length,
        topPerformingCategories: suguvalCategories.slice(0, 3).map(c => c.categoryName),
        issuesCount: insights.filter(i => i.store === "suguval" && i.actionRequired).length
      },
      sugumaillane: {
        totalItems: sugumaillaneItemsData.length,
        avgCompletionRate: sugumaillaneCategories.length > 0
          ? Math.round(sugumaillaneCategories.reduce((s, c) => s + c.averageCompletionRate, 0) / sugumaillaneCategories.length)
          : 0,
        stockoutRisk: sugumaillaneStockouts.filter(s => s.isRecurring).length,
        topPerformingCategories: sugumaillaneCategories.slice(0, 3).map(c => c.categoryName),
        issuesCount: insights.filter(i => i.store === "sugumaillane" && i.actionRequired).length
      },
      insights,
      lastAnalyzed: new Date()
    };
  }

  async saveAnalysis(analysis: InsertSuguAnalytics): Promise<number | null> {
    try {
      const inserted = await db.insert(suguAnalytics)
        .values(analysis)
        .returning({ id: suguAnalytics.id });
      return inserted[0]?.id || null;
    } catch (error) {
      console.error("[SUGU-ANALYTICS] Error saving analysis:", error);
      return null;
    }
  }

  async runDailyAnalysis(): Promise<void> {
    console.log("[SUGU-ANALYTICS] Starting daily analysis...");

    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    for (const store of ["suguval", "sugumaillane"] as const) {
      // Save rotation analysis
      const rotations = await this.analyzeRotation(store, 7);
      const highRotation = rotations.filter(r => r.rotationRate > 0.5);
      
      if (highRotation.length > 0) {
        await this.saveAnalysis({
          store,
          analysisType: "rotation",
          period: "weekly",
          periodStart: yesterday,
          periodEnd: now,
          metrics: {
            totalAnalyzed: rotations.length,
            highRotationCount: highRotation.length,
            avgRotationRate: rotations.reduce((s, r) => s + r.rotationRate, 0) / rotations.length,
            topItems: highRotation.slice(0, 5).map(r => ({ name: r.itemName, rate: r.rotationRate }))
          },
          severity: "info",
          actionRequired: false
        });
      }

      // Save stockout analysis
      const stockouts = await this.analyzeStockouts(store, 7);
      const recurring = stockouts.filter(s => s.isRecurring);

      if (stockouts.length > 0) {
        await this.saveAnalysis({
          store,
          analysisType: "stockout",
          period: "weekly",
          periodStart: yesterday,
          periodEnd: now,
          metrics: {
            totalStockouts: stockouts.length,
            recurringCount: recurring.length,
            avgStockoutRate: stockouts.reduce((s, r) => s + r.stockoutRate, 0) / stockouts.length,
            criticalItems: recurring.map(s => ({ name: s.itemName, rate: s.stockoutRate }))
          },
          severity: recurring.length > 3 ? "critical" : recurring.length > 0 ? "warning" : "info",
          actionRequired: recurring.length > 0
        });
      }
    }

    console.log("[SUGU-ANALYTICS] Daily analysis complete");
  }
}

export const suguAnalyticsService = new SuguAnalyticsService();
