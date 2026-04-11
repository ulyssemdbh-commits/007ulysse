import { db } from "../db";
import { suguPurchases, suguExpenses, suguCashRegister, suguBankEntries, suguLoans } from "@shared/schema";
import { eq, gte, desc, sql, and, lte } from "drizzle-orm";

interface UnpaidInvoiceAlert {
  id: number;
  supplier: string;
  amount: number;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  daysOverdue: number;
  severity: "info" | "warning" | "critical";
}

interface TreasuryForecast {
  currentBalance: number;
  projectedBalance: number;
  daysAhead: number;
  expectedRevenue: number;
  expectedExpenses: number;
  loanPayments: number;
  recurringExpenses: number;
  riskLevel: "safe" | "caution" | "danger";
  breakdown: {
    label: string;
    amount: number;
    type: "income" | "expense";
  }[];
}

interface ReconciliationSuggestion {
  bankEntryId: number;
  bankLabel: string;
  bankAmount: number;
  bankDate: string;
  matchedType: "purchase" | "expense";
  matchedId: number;
  matchedLabel: string;
  matchedAmount: number;
  matchedDate: string | null;
  amountDifference: number;
  dateDifferenceDay: number;
  confidence: number;
}

interface SeasonalPattern {
  category: string;
  currentMonthTotal: number;
  sameMonthLastYearTotal: number;
  changePercent: number;
  trend: "up" | "down" | "stable" | "no_data";
  description: string;
}

interface ProactiveReport {
  unpaidInvoices: UnpaidInvoiceAlert[];
  treasury: TreasuryForecast;
  reconciliation: ReconciliationSuggestion[];
  seasonalPatterns: SeasonalPattern[];
  generatedAt: string;
  alertCount: number;
}

const AMOUNT_TOLERANCE = 0.50;
const DATE_PROXIMITY_DAYS = 5;

class SuguProactiveService {
  async detectUnpaidInvoices(store: "valentine" | "maillane" = "valentine"): Promise<UnpaidInvoiceAlert[]> {
    try {
      const unpaid = await db
        .select()
        .from(suguPurchases)
        .where(eq(suguPurchases.isPaid, false))
        .orderBy(desc(suguPurchases.invoiceDate));

      const now = new Date();
      const alerts: UnpaidInvoiceAlert[] = [];

      for (const purchase of unpaid) {
        const refDate = purchase.dueDate || purchase.invoiceDate;
        if (!refDate) continue;

        const dueDate = new Date(refDate);
        const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

        if (daysOverdue < 0) continue;

        let severity: "info" | "warning" | "critical" = "info";
        if (daysOverdue > 30) severity = "critical";
        else if (daysOverdue > 14) severity = "warning";

        alerts.push({
          id: purchase.id,
          supplier: purchase.supplier,
          amount: purchase.amount,
          invoiceNumber: purchase.invoiceNumber,
          invoiceDate: purchase.invoiceDate,
          dueDate: purchase.dueDate,
          daysOverdue,
          severity,
        });
      }

      return alerts.sort((a, b) => {
        const sevOrder = { critical: 0, warning: 1, info: 2 };
        return sevOrder[a.severity] - sevOrder[b.severity] || b.daysOverdue - a.daysOverdue;
      });
    } catch (error) {
      console.error("[SuguProactive] detectUnpaidInvoices error:", error);
      return [];
    }
  }

  async forecastTreasury(store: "valentine" | "maillane" = "valentine", daysAhead: number = 30): Promise<TreasuryForecast> {
    try {
      const bankEntries = await db
        .select()
        .from(suguBankEntries)
        .orderBy(desc(suguBankEntries.entryDate))
        .limit(1);

      const currentBalance = bankEntries.length > 0 ? (bankEntries[0].balance ?? 0) : 0;

      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const ninetyDaysStr = ninetyDaysAgo.toISOString().split("T")[0];

      const [recentCash, recentPurchases, recentExpenses, loans] = await Promise.all([
        db.select().from(suguCashRegister)
          .where(gte(suguCashRegister.entryDate, ninetyDaysStr))
          .orderBy(desc(suguCashRegister.entryDate)),

        db.select().from(suguPurchases)
          .where(gte(suguPurchases.invoiceDate, ninetyDaysStr)),

        db.select().from(suguExpenses)
          .where(eq(suguExpenses.isRecurring, true)),

        db.select().from(suguLoans),
      ]);

      const totalRevenue90d = recentCash.reduce((sum, c) => sum + (c.totalRevenue || 0), 0);
      const daysWithRevenue = recentCash.length || 1;
      const avgDailyRevenue = totalRevenue90d / daysWithRevenue;
      const expectedRevenue = avgDailyRevenue * daysAhead;

      const totalPurchases90d = recentPurchases.reduce((sum, p) => sum + (p.amount || 0), 0);
      const avgDailyPurchases = totalPurchases90d / 90;
      const expectedPurchaseExpenses = avgDailyPurchases * daysAhead;

      const monthlyRecurring = recentExpenses.reduce((sum, e) => {
        const amount = e.amount || 0;
        if (e.frequency === "hebdomadaire") return sum + (amount * 4.33);
        if (e.frequency === "annuel") return sum + (amount / 12);
        return sum + amount;
      }, 0);
      const recurringExpenses = (monthlyRecurring / 30) * daysAhead;

      const monthlyLoanPayments = loans.reduce((sum, l) => sum + (l.monthlyPayment || 0), 0);
      const loanPayments = (monthlyLoanPayments / 30) * daysAhead;

      const totalExpected = expectedPurchaseExpenses + recurringExpenses + loanPayments;
      const projectedBalance = currentBalance + expectedRevenue - totalExpected;

      let riskLevel: "safe" | "caution" | "danger" = "safe";
      if (projectedBalance < 0) riskLevel = "danger";
      else if (projectedBalance < currentBalance * 0.3) riskLevel = "caution";

      const breakdown: TreasuryForecast["breakdown"] = [
        { label: "CA estimé", amount: Math.round(expectedRevenue * 100) / 100, type: "income" },
        { label: "Achats fournisseurs", amount: Math.round(expectedPurchaseExpenses * 100) / 100, type: "expense" },
        { label: "Charges récurrentes", amount: Math.round(recurringExpenses * 100) / 100, type: "expense" },
        { label: "Remboursements emprunts", amount: Math.round(loanPayments * 100) / 100, type: "expense" },
      ];

      return {
        currentBalance: Math.round(currentBalance * 100) / 100,
        projectedBalance: Math.round(projectedBalance * 100) / 100,
        daysAhead,
        expectedRevenue: Math.round(expectedRevenue * 100) / 100,
        expectedExpenses: Math.round(totalExpected * 100) / 100,
        loanPayments: Math.round(loanPayments * 100) / 100,
        recurringExpenses: Math.round(recurringExpenses * 100) / 100,
        riskLevel,
        breakdown,
      };
    } catch (error) {
      console.error("[SuguProactive] forecastTreasury error:", error);
      return {
        currentBalance: 0,
        projectedBalance: 0,
        daysAhead,
        expectedRevenue: 0,
        expectedExpenses: 0,
        loanPayments: 0,
        recurringExpenses: 0,
        riskLevel: "caution",
        breakdown: [],
      };
    }
  }

  async autoReconcile(store: "valentine" | "maillane" = "valentine"): Promise<ReconciliationSuggestion[]> {
    try {
      const unreconciledBank = await db
        .select()
        .from(suguBankEntries)
        .where(eq(suguBankEntries.isReconciled, false))
        .orderBy(desc(suguBankEntries.entryDate));

      if (unreconciledBank.length === 0) return [];

      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
      const sixtyDaysStr = sixtyDaysAgo.toISOString().split("T")[0];

      const [purchases, expenses] = await Promise.all([
        db.select().from(suguPurchases)
          .where(gte(suguPurchases.invoiceDate, sixtyDaysStr)),
        db.select().from(suguExpenses)
          .where(gte(suguExpenses.dueDate, sixtyDaysStr)),
      ]);

      const suggestions: ReconciliationSuggestion[] = [];
      const usedPurchaseIds = new Set<number>();
      const usedExpenseIds = new Set<number>();

      for (const bankEntry of unreconciledBank) {
        const bankAmount = Math.abs(bankEntry.amount);
        const bankDate = new Date(bankEntry.entryDate);

        for (const purchase of purchases) {
          if (usedPurchaseIds.has(purchase.id)) continue;
          const purchaseAmount = Math.abs(purchase.amount);
          const amountDiff = Math.abs(bankAmount - purchaseAmount);

          if (amountDiff > AMOUNT_TOLERANCE) continue;

          const purchaseDate = purchase.invoiceDate ? new Date(purchase.invoiceDate) : null;
          const dateDiff = purchaseDate
            ? Math.abs(Math.floor((bankDate.getTime() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24)))
            : 999;

          if (dateDiff > DATE_PROXIMITY_DAYS) continue;

          const confidence = Math.max(0, 100 - (amountDiff * 50) - (dateDiff * 5));

          suggestions.push({
            bankEntryId: bankEntry.id,
            bankLabel: bankEntry.label,
            bankAmount: bankEntry.amount,
            bankDate: bankEntry.entryDate,
            matchedType: "purchase",
            matchedId: purchase.id,
            matchedLabel: purchase.supplier,
            matchedAmount: purchase.amount,
            matchedDate: purchase.invoiceDate,
            amountDifference: Math.round(amountDiff * 100) / 100,
            dateDifferenceDay: dateDiff,
            confidence: Math.round(confidence),
          });

          usedPurchaseIds.add(purchase.id);
          break;
        }

        for (const expense of expenses) {
          if (usedExpenseIds.has(expense.id)) continue;
          const expenseAmount = Math.abs(expense.amount);
          const amountDiff = Math.abs(bankAmount - expenseAmount);

          if (amountDiff > AMOUNT_TOLERANCE) continue;

          const expenseDate = expense.dueDate ? new Date(expense.dueDate) : null;
          const dateDiff = expenseDate
            ? Math.abs(Math.floor((bankDate.getTime() - expenseDate.getTime()) / (1000 * 60 * 60 * 24)))
            : 999;

          if (dateDiff > DATE_PROXIMITY_DAYS) continue;

          const confidence = Math.max(0, 100 - (amountDiff * 50) - (dateDiff * 5));

          suggestions.push({
            bankEntryId: bankEntry.id,
            bankLabel: bankEntry.label,
            bankAmount: bankEntry.amount,
            bankDate: bankEntry.entryDate,
            matchedType: "expense",
            matchedId: expense.id,
            matchedLabel: expense.label || expense.description || "Charge",
            matchedAmount: expense.amount,
            matchedDate: expense.dueDate,
            amountDifference: Math.round(amountDiff * 100) / 100,
            dateDifferenceDay: dateDiff,
            confidence: Math.round(confidence),
          });

          usedExpenseIds.add(expense.id);
          break;
        }
      }

      return suggestions.sort((a, b) => b.confidence - a.confidence);
    } catch (error) {
      console.error("[SuguProactive] autoReconcile error:", error);
      return [];
    }
  }

  async detectSeasonalPatterns(store: "valentine" | "maillane" = "valentine"): Promise<SeasonalPattern[]> {
    try {
      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();
      const lastYear = currentYear - 1;

      const currentMonthStr = `${currentYear}-${String(currentMonth).padStart(2, "0")}`;
      const lastYearMonthStr = `${lastYear}-${String(currentMonth).padStart(2, "0")}`;

      const [currentPurchases, lastYearPurchases] = await Promise.all([
        db.select().from(suguPurchases)
          .where(
            and(
              gte(suguPurchases.invoiceDate, `${currentMonthStr}-01`),
              lte(suguPurchases.invoiceDate, `${currentMonthStr}-31`)
            )
          ),
        db.select().from(suguPurchases)
          .where(
            and(
              gte(suguPurchases.invoiceDate, `${lastYearMonthStr}-01`),
              lte(suguPurchases.invoiceDate, `${lastYearMonthStr}-31`)
            )
          ),
      ]);

      const currentByCategory: Record<string, number> = {};
      const lastYearByCategory: Record<string, number> = {};

      for (const p of currentPurchases) {
        const cat = p.category || "Autre";
        currentByCategory[cat] = (currentByCategory[cat] || 0) + (p.amount || 0);
      }

      for (const p of lastYearPurchases) {
        const cat = p.category || "Autre";
        lastYearByCategory[cat] = (lastYearByCategory[cat] || 0) + (p.amount || 0);
      }

      const allCategories = new Set([...Object.keys(currentByCategory), ...Object.keys(lastYearByCategory)]);
      const patterns: SeasonalPattern[] = [];

      for (const category of allCategories) {
        const current = currentByCategory[category] || 0;
        const lastYearVal = lastYearByCategory[category] || 0;

        let changePercent = 0;
        let trend: SeasonalPattern["trend"] = "no_data";
        let description = "";

        if (lastYearVal === 0 && current === 0) {
          continue;
        } else if (lastYearVal === 0) {
          trend = "up";
          changePercent = 100;
          description = `Nouvelle catégorie ce mois: ${Math.round(current)}€ d'achats (pas de données l'année dernière).`;
        } else {
          changePercent = ((current - lastYearVal) / lastYearVal) * 100;
          if (changePercent > 15) {
            trend = "up";
            description = `Hausse de ${Math.round(changePercent)}% vs. même mois l'an dernier (${Math.round(lastYearVal)}€ → ${Math.round(current)}€).`;
          } else if (changePercent < -15) {
            trend = "down";
            description = `Baisse de ${Math.round(Math.abs(changePercent))}% vs. même mois l'an dernier (${Math.round(lastYearVal)}€ → ${Math.round(current)}€).`;
          } else {
            trend = "stable";
            description = `Stable par rapport au même mois l'an dernier (${Math.round(lastYearVal)}€ → ${Math.round(current)}€).`;
          }
        }

        patterns.push({
          category,
          currentMonthTotal: Math.round(current * 100) / 100,
          sameMonthLastYearTotal: Math.round(lastYearVal * 100) / 100,
          changePercent: Math.round(changePercent * 10) / 10,
          trend,
          description,
        });
      }

      return patterns.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
    } catch (error) {
      console.error("[SuguProactive] detectSeasonalPatterns error:", error);
      return [];
    }
  }

  async getFullReport(store: "valentine" | "maillane" = "valentine", daysAhead: number = 30): Promise<ProactiveReport> {
    const [unpaidInvoices, treasury, reconciliation, seasonalPatterns] = await Promise.all([
      this.detectUnpaidInvoices(store),
      this.forecastTreasury(store, daysAhead),
      this.autoReconcile(store),
      this.detectSeasonalPatterns(store),
    ]);

    const alertCount =
      unpaidInvoices.filter(i => i.severity !== "info").length +
      (treasury.riskLevel !== "safe" ? 1 : 0) +
      seasonalPatterns.filter(p => p.trend === "up" && p.changePercent > 25).length;

    return {
      unpaidInvoices,
      treasury,
      reconciliation,
      seasonalPatterns,
      generatedAt: new Date().toISOString(),
      alertCount,
    };
  }

  getBriefingSummary(report: ProactiveReport): string {
    const lines: string[] = [];

    const criticalUnpaid = report.unpaidInvoices.filter(i => i.severity === "critical");
    const warningUnpaid = report.unpaidInvoices.filter(i => i.severity === "warning");

    if (criticalUnpaid.length > 0) {
      const totalCritical = criticalUnpaid.reduce((s, i) => s + i.amount, 0);
      lines.push(`URGENT: ${criticalUnpaid.length} facture(s) impayée(s) > 30j (total: ${Math.round(totalCritical)}€)`);
    }
    if (warningUnpaid.length > 0) {
      lines.push(`Attention: ${warningUnpaid.length} facture(s) en retard (14-30j)`);
    }

    if (report.treasury.riskLevel === "danger") {
      lines.push(`ALERTE TRÉSORERIE: Solde projeté négatif à ${report.treasury.daysAhead}j (${report.treasury.projectedBalance}€)`);
    } else if (report.treasury.riskLevel === "caution") {
      lines.push(`Trésorerie: attention, solde projeté en baisse à ${report.treasury.daysAhead}j (${report.treasury.projectedBalance}€)`);
    }

    if (report.reconciliation.length > 0) {
      lines.push(`${report.reconciliation.length} rapprochement(s) bancaire(s) suggéré(s)`);
    }

    const significantPatterns = report.seasonalPatterns.filter(p => Math.abs(p.changePercent) > 25);
    if (significantPatterns.length > 0) {
      lines.push(`${significantPatterns.length} variation(s) saisonnière(s) notable(s) détectée(s)`);
    }

    return lines.length > 0 ? lines.join("\n") : "Aucune alerte proactive.";
  }
}

export const suguProactiveService = new SuguProactiveService();
