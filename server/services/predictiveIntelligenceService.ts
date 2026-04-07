import { db } from "../db";
import { suguPurchases, suguGeneralExpenses, suguCashRegister, suguBankEntries, suguLoans } from "@shared/schema";
import { eq, gte, desc, sql, and } from "drizzle-orm";

interface PredictionAlert {
  id: string;
  type: "revenue_forecast" | "cost_trend" | "anomaly" | "supplier_alert" | "cash_flow";
  severity: "info" | "warning" | "critical";
  restaurant: "valentine" | "maillane" | "both";
  title: string;
  description: string;
  confidence: number;
  metric?: string;
  currentValue?: number;
  predictedValue?: number;
  trend?: "up" | "down" | "stable";
  actionSuggestion?: string;
  createdAt: string;
}

interface RevenueForecast {
  restaurant: string;
  dayOfWeek: string;
  predictedRevenue: number;
  confidence: number;
  basedOnDays: number;
  trend: "up" | "down" | "stable";
}

interface CostTrend {
  category: string;
  restaurant: string;
  currentMonthAvg: number;
  previousMonthAvg: number;
  changePercent: number;
  trend: "up" | "down" | "stable";
  isAnomaly: boolean;
}

interface SupplierAnalysis {
  supplier: string;
  restaurant: string;
  totalSpent: number;
  invoiceCount: number;
  avgInvoice: number;
  lastInvoice: string;
  priceVariation: number;
  trend: "increasing" | "stable" | "decreasing";
}

const DAY_NAMES = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

class PredictiveIntelligenceService {
  async getRevenueForecast(restaurant: "valentine" | "maillane" = "valentine"): Promise<RevenueForecast[]> {
    try {
      const table = suguCashRegister;
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 90);

      const entries = await db.select({
        date: table.entryDate,
        totalRevenue: table.totalRevenue,
      })
        .from(table)
        .where(gte(table.entryDate, thirtyDaysAgo.toISOString().split("T")[0]))
        .orderBy(desc(table.entryDate));

      const byDayOfWeek: Record<number, number[]> = {};
      for (let i = 0; i < 7; i++) byDayOfWeek[i] = [];

      for (const entry of entries) {
        if (!entry.date) continue;
        const d = new Date(entry.date);
        const dow = d.getDay();
        const total = parseFloat(String(entry.totalRevenue || 0));
        if (total > 0) byDayOfWeek[dow].push(total);
      }

      const forecasts: RevenueForecast[] = [];
      for (let dow = 0; dow < 7; dow++) {
        const values = byDayOfWeek[dow];
        if (values.length < 2) continue;

        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const recent = values.slice(0, Math.min(4, values.length));
        const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
        const older = values.slice(Math.min(4, values.length));
        const olderAvg = older.length > 0 ? older.reduce((a, b) => a + b, 0) / older.length : avg;

        const changePercent = olderAvg > 0 ? ((recentAvg - olderAvg) / olderAvg) * 100 : 0;
        const trend: "up" | "down" | "stable" = changePercent > 5 ? "up" : changePercent < -5 ? "down" : "stable";
        const confidence = Math.min(95, 50 + values.length * 5);

        forecasts.push({
          restaurant,
          dayOfWeek: DAY_NAMES[dow],
          predictedRevenue: Math.round(recentAvg * 100) / 100,
          confidence,
          basedOnDays: values.length,
          trend,
        });
      }

      return forecasts;
    } catch (error) {
      console.error("[PredictiveIntelligence] Revenue forecast error:", error);
      return [];
    }
  }

  async getCostTrends(restaurant: "valentine" | "maillane" = "valentine"): Promise<CostTrend[]> {
    try {
      const table = suguPurchases;
      const now = new Date();
      const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthStr = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}`;

      const purchases = await db.select({
        supplier: table.supplier,
        amount: table.amount,
        date: table.invoiceDate,
        category: table.category,
      })
        .from(table)
        .where(gte(table.invoiceDate, `${lastMonthStr}-01`))
        .orderBy(desc(table.invoiceDate));

      const byCat: Record<string, { current: number[]; previous: number[] }> = {};

      for (const p of purchases) {
        const cat = (p.category as string) || "Autre";
        if (!byCat[cat]) byCat[cat] = { current: [], previous: [] };

        const month = (p.date as string)?.substring(0, 7);
        const amount = parseFloat(String(p.amount || 0));
        if (amount <= 0) continue;

        if (month === thisMonth) {
          byCat[cat].current.push(amount);
        } else {
          byCat[cat].previous.push(amount);
        }
      }

      const trends: CostTrend[] = [];
      for (const [category, data] of Object.entries(byCat)) {
        const currentAvg = data.current.length > 0 
          ? data.current.reduce((a, b) => a + b, 0) / data.current.length : 0;
        const previousAvg = data.previous.length > 0 
          ? data.previous.reduce((a, b) => a + b, 0) / data.previous.length : 0;

        const changePercent = previousAvg > 0 ? ((currentAvg - previousAvg) / previousAvg) * 100 : 0;
        const isAnomaly = Math.abs(changePercent) > 25;
        const trend: "up" | "down" | "stable" = changePercent > 10 ? "up" : changePercent < -10 ? "down" : "stable";

        trends.push({
          category,
          restaurant,
          currentMonthAvg: Math.round(currentAvg * 100) / 100,
          previousMonthAvg: Math.round(previousAvg * 100) / 100,
          changePercent: Math.round(changePercent * 10) / 10,
          trend,
          isAnomaly,
        });
      }

      return trends.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
    } catch (error) {
      console.error("[PredictiveIntelligence] Cost trends error:", error);
      return [];
    }
  }

  async getSupplierAnalysis(restaurant: "valentine" | "maillane" = "valentine"): Promise<SupplierAnalysis[]> {
    try {
      const table = suguPurchases;
      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

      const purchases = await db.select({
        supplier: table.supplier,
        amount: table.amount,
        date: table.invoiceDate,
      })
        .from(table)
        .where(gte(table.invoiceDate, sixtyDaysAgo.toISOString().split("T")[0]))
        .orderBy(desc(table.invoiceDate));

      const bySupplier: Record<string, { amounts: number[]; dates: string[] }> = {};

      for (const p of purchases) {
        const supplier = (p.supplier as string) || "Inconnu";
        if (!bySupplier[supplier]) bySupplier[supplier] = { amounts: [], dates: [] };
        const amount = parseFloat(String(p.amount || 0));
        if (amount > 0) {
          bySupplier[supplier].amounts.push(amount);
          bySupplier[supplier].dates.push(p.date as string);
        }
      }

      const analyses: SupplierAnalysis[] = [];
      for (const [supplier, data] of Object.entries(bySupplier)) {
        if (data.amounts.length < 2) continue;

        const totalSpent = data.amounts.reduce((a, b) => a + b, 0);
        const avgInvoice = totalSpent / data.amounts.length;

        const firstHalf = data.amounts.slice(Math.floor(data.amounts.length / 2));
        const secondHalf = data.amounts.slice(0, Math.floor(data.amounts.length / 2));
        const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
        const secondAvg = secondHalf.length > 0 ? secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length : firstAvg;

        const variation = firstAvg > 0 ? ((secondAvg - firstAvg) / firstAvg) * 100 : 0;
        const trend: "increasing" | "stable" | "decreasing" = 
          variation > 10 ? "increasing" : variation < -10 ? "decreasing" : "stable";

        analyses.push({
          supplier,
          restaurant,
          totalSpent: Math.round(totalSpent * 100) / 100,
          invoiceCount: data.amounts.length,
          avgInvoice: Math.round(avgInvoice * 100) / 100,
          lastInvoice: data.dates[0] || "",
          priceVariation: Math.round(variation * 10) / 10,
          trend,
        });
      }

      return analyses.sort((a, b) => b.totalSpent - a.totalSpent);
    } catch (error) {
      console.error("[PredictiveIntelligence] Supplier analysis error:", error);
      return [];
    }
  }

  async generateAlerts(): Promise<PredictionAlert[]> {
    const alerts: PredictionAlert[] = [];
    const now = new Date().toISOString();

    try {
      const costTrends = await this.getCostTrends("valentine");
      for (const trend of costTrends) {
        if (trend.isAnomaly && trend.trend === "up") {
          alerts.push({
            id: `cost-${trend.category}-${Date.now()}`,
            type: "cost_trend",
            severity: trend.changePercent > 50 ? "critical" : "warning",
            restaurant: "valentine",
            title: `Hausse des coûts: ${trend.category}`,
            description: `Les achats "${trend.category}" ont augmenté de ${trend.changePercent}% ce mois par rapport au mois dernier (${trend.previousMonthAvg}€ → ${trend.currentMonthAvg}€ en moyenne par facture).`,
            confidence: 80,
            metric: "cost_change",
            currentValue: trend.currentMonthAvg,
            predictedValue: trend.previousMonthAvg,
            trend: "up",
            actionSuggestion: "Vérifier les factures récentes et négocier avec le fournisseur si nécessaire.",
            createdAt: now,
          });
        }
        if (trend.isAnomaly && trend.trend === "down") {
          alerts.push({
            id: `cost-savings-${trend.category}-${Date.now()}`,
            type: "cost_trend",
            severity: "info",
            restaurant: "valentine",
            title: `Économie détectée: ${trend.category}`,
            description: `Les achats "${trend.category}" ont baissé de ${Math.abs(trend.changePercent)}% ce mois.`,
            confidence: 75,
            trend: "down",
            createdAt: now,
          });
        }
      }

      const suppliers = await this.getSupplierAnalysis("valentine");
      for (const s of suppliers) {
        if (s.trend === "increasing" && s.priceVariation > 15) {
          alerts.push({
            id: `supplier-${s.supplier}-${Date.now()}`,
            type: "supplier_alert",
            severity: "warning",
            restaurant: "valentine",
            title: `Prix en hausse: ${s.supplier}`,
            description: `Le fournisseur "${s.supplier}" a augmenté ses prix de ${s.priceVariation}% sur les dernières factures (${s.invoiceCount} factures, total ${s.totalSpent}€).`,
            confidence: 70,
            trend: "up",
            actionSuggestion: "Comparer les prix avec d'autres fournisseurs ou négocier.",
            createdAt: now,
          });
        }
      }

      const forecasts = await this.getRevenueForecast("valentine");
      const downTrends = forecasts.filter(f => f.trend === "down");
      if (downTrends.length >= 3) {
        alerts.push({
          id: `revenue-decline-${Date.now()}`,
          type: "revenue_forecast",
          severity: "warning",
          restaurant: "valentine",
          title: "Tendance baissière du CA",
          description: `Le chiffre d'affaires est en baisse sur ${downTrends.length} jours de la semaine (${downTrends.map(d => d.dayOfWeek).join(", ")}).`,
          confidence: 65,
          trend: "down",
          actionSuggestion: "Analyser les causes possibles et envisager des actions commerciales.",
          createdAt: now,
        });
      }
    } catch (error) {
      console.error("[PredictiveIntelligence] Alert generation error:", error);
    }

    return alerts.sort((a, b) => {
      const sevOrder = { critical: 0, warning: 1, info: 2 };
      return (sevOrder[a.severity] || 2) - (sevOrder[b.severity] || 2);
    });
  }

  async getFullPredictions() {
    const [forecasts, costTrends, suppliers, alerts] = await Promise.all([
      this.getRevenueForecast("valentine"),
      this.getCostTrends("valentine"),
      this.getSupplierAnalysis("valentine"),
      this.generateAlerts(),
    ]);

    return {
      forecasts,
      costTrends,
      suppliers,
      alerts,
      generatedAt: new Date().toISOString(),
    };
  }
}

export const predictiveIntelligenceService = new PredictiveIntelligenceService();
