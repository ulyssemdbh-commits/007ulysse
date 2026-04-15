import { db } from "../db";
import { suguPurchases, suguExpenses, suguCashRegister, suguEmployees, suguPayroll } from "@shared/schema";
import { eq, gte, desc } from "drizzle-orm";

interface RestaurantSnapshot {
  restaurant: string;
  period: string;
  revenue: { total: number; dailyAvg: number; daysWithData: number };
  costs: { purchases: number; expenses: number; payroll: number; total: number };
  employees: { active: number; totalGross: number; avgSalary: number };
  margin: { gross: number; net: number; ratio: number };
  topSuppliers: { name: string; total: number; invoiceCount: number }[];
  topExpenseCategories: { category: string; total: number }[];
}

interface SimulationScenario {
  type: "remove_employee" | "add_employee" | "change_supplier" | "price_change" | "add_expense" | "remove_expense" | "revenue_change" | "custom";
  params: Record<string, any>;
  description?: string;
}

interface SimulationResult {
  success: boolean;
  scenario: SimulationScenario;
  before: { revenue: number; costs: number; margin: number; marginRatio: number };
  after: { revenue: number; costs: number; margin: number; marginRatio: number };
  impact: { revenueDelta: number; costsDelta: number; marginDelta: number; marginRatioDelta: number };
  verdict: "positive" | "negative" | "neutral";
  explanation: string;
  recommendations: string[];
  error?: string;
}

class DigitalTwinService {
  private static instance: DigitalTwinService;
  static getInstance(): DigitalTwinService {
    if (!this.instance) this.instance = new DigitalTwinService();
    return this.instance;
  }

  async getSnapshot(restaurant: string = "suguval"): Promise<RestaurantSnapshot> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateStr = thirtyDaysAgo.toISOString().split("T")[0];

    const [purchases, expenses, cashEntries, employees, payroll] = await Promise.all([
      db.select().from(suguPurchases).where(gte(suguPurchases.invoiceDate, dateStr)).orderBy(desc(suguPurchases.invoiceDate)),
      db.select().from(suguExpenses).orderBy(desc(suguExpenses.dueDate)),
      db.select().from(suguCashRegister).orderBy(desc(suguCashRegister.entryDate)).limit(30),
      db.select().from(suguEmployees).where(eq(suguEmployees.isActive, true)),
      db.select().from(suguPayroll).orderBy(desc(suguPayroll.period)).limit(20),
    ]);

    const totalRevenue = cashEntries.reduce((s, e) => s + Number(e.totalRevenue || 0), 0);
    const daysWithData = new Set(cashEntries.map(e => e.entryDate)).size || 1;
    const totalPurchases = purchases.reduce((s, p) => s + Number(p.amount || 0), 0);
    const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
    const totalPayrollGross = payroll.reduce((s, p) => s + Number(p.grossSalary || 0), 0);
    const totalCosts = totalPurchases + totalExpenses + totalPayrollGross;
    const grossMargin = totalRevenue - totalCosts;

    const supplierMap = new Map<string, { total: number; count: number }>();
    for (const p of purchases) {
      const name = String(p.supplier || "Inconnu");
      const existing = supplierMap.get(name) || { total: 0, count: 0 };
      existing.total += Number(p.amount || 0);
      existing.count++;
      supplierMap.set(name, existing);
    }

    const expCatMap = new Map<string, number>();
    for (const e of expenses) {
      const cat = String(e.category || "Autre");
      expCatMap.set(cat, (expCatMap.get(cat) || 0) + Number(e.amount || 0));
    }

    return {
      restaurant,
      period: `${thirtyDaysAgo.toISOString().split("T")[0]} → ${new Date().toISOString().split("T")[0]}`,
      revenue: { total: Math.round(totalRevenue * 100) / 100, dailyAvg: Math.round((totalRevenue / daysWithData) * 100) / 100, daysWithData },
      costs: { purchases: Math.round(totalPurchases * 100) / 100, expenses: Math.round(totalExpenses * 100) / 100, payroll: Math.round(totalPayrollGross * 100) / 100, total: Math.round(totalCosts * 100) / 100 },
      employees: { active: employees.length, totalGross: Math.round(totalPayrollGross * 100) / 100, avgSalary: employees.length ? Math.round((totalPayrollGross / employees.length) * 100) / 100 : 0 },
      margin: { gross: Math.round(grossMargin * 100) / 100, net: Math.round(grossMargin * 100) / 100, ratio: totalRevenue > 0 ? Math.round((grossMargin / totalRevenue) * 10000) / 100 : 0 },
      topSuppliers: [...supplierMap.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 5).map(([name, d]) => ({ name, total: Math.round(d.total * 100) / 100, invoiceCount: d.count })),
      topExpenseCategories: [...expCatMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([category, total]) => ({ category, total: Math.round(total * 100) / 100 })),
    };
  }

  async simulate(scenario: SimulationScenario, restaurant: string = "suguval"): Promise<SimulationResult> {
    try {
      const snapshot = await this.getSnapshot(restaurant);

      const before = {
        revenue: snapshot.revenue.total,
        costs: snapshot.costs.total,
        margin: snapshot.margin.gross,
        marginRatio: snapshot.margin.ratio,
      };

      let afterRevenue = before.revenue;
      let afterCosts = before.costs;
      let explanation = "";
      const recommendations: string[] = [];

      switch (scenario.type) {
        case "remove_employee": {
          const { employeeName, salary } = scenario.params;
          const salaryAmount = salary || snapshot.employees.avgSalary;
          afterCosts -= salaryAmount;
          explanation = `Suppression de ${employeeName || "un employé"} (salaire brut: ${salaryAmount}€). Économie mensuelle de ${salaryAmount}€ sur la masse salariale.`;
          if (snapshot.employees.active <= 3) {
            recommendations.push("Attention: équipe déjà réduite, risque de surcharge de travail");
          }
          recommendations.push(`Impact annuel: -${Math.round(salaryAmount * 12)}€ de charges`);
          break;
        }

        case "add_employee": {
          const { role, salary } = scenario.params;
          const salaryAmount = salary || 1800;
          afterCosts += salaryAmount;
          explanation = `Ajout d'un ${role || "employé"} à ${salaryAmount}€ brut/mois. Coût supplémentaire mensuel: ${salaryAmount}€.`;
          recommendations.push(`La marge passera de ${before.marginRatio}% à ${((afterRevenue - afterCosts) / afterRevenue * 100).toFixed(1)}%`);
          recommendations.push("Prévoir aussi charges patronales (~42% du brut)");
          break;
        }

        case "change_supplier": {
          const { currentSupplier, newPrice, category } = scenario.params;
          const supplierData = snapshot.topSuppliers.find(s => s.name.toLowerCase().includes((currentSupplier || "").toLowerCase()));
          if (supplierData) {
            const priceChange = newPrice ? (newPrice - supplierData.total) : -(supplierData.total * 0.1);
            afterCosts += priceChange;
            explanation = `Changement de fournisseur "${supplierData.name}". Ancien coût: ${supplierData.total}€, nouveau coût estimé: ${Math.round((supplierData.total + priceChange) * 100) / 100}€.`;
          } else {
            const avgPurchaseSaving = snapshot.costs.purchases * (scenario.params.savingPercent || 10) / 100;
            afterCosts -= avgPurchaseSaving;
            explanation = `Changement de fournisseur ${category || "principal"}. Économie estimée: ${Math.round(avgPurchaseSaving)}€/mois.`;
          }
          recommendations.push("Vérifier la qualité et la fiabilité du nouveau fournisseur");
          recommendations.push("Négocier un contrat de 3 mois minimum pour verrouiller les prix");
          break;
        }

        case "price_change": {
          const { percentChange } = scenario.params;
          const pct = percentChange || 5;
          afterRevenue = before.revenue * (1 + pct / 100);
          explanation = `Augmentation des prix de ${pct}%. Revenu projeté: ${Math.round(afterRevenue)}€ vs ${Math.round(before.revenue)}€.`;
          if (pct > 10) {
            recommendations.push("Risque de perte de clientèle avec une hausse supérieure à 10%");
          }
          recommendations.push(`Gain mensuel estimé: +${Math.round(afterRevenue - before.revenue)}€`);
          recommendations.push("Envisager une hausse progressive plutôt qu'un saut brutal");
          break;
        }

        case "add_expense": {
          const { category, amount, description } = scenario.params;
          afterCosts += (amount || 500);
          explanation = `Nouvelle dépense "${description || category || "investissement"}": +${amount || 500}€/mois.`;
          recommendations.push(`ROI nécessaire: cette dépense doit générer au moins +${Math.round((amount || 500) * 3)}€ de CA pour rester rentable`);
          break;
        }

        case "remove_expense": {
          const { category, amount } = scenario.params;
          const catData = snapshot.topExpenseCategories.find(c => c.category.toLowerCase().includes((category || "").toLowerCase()));
          const saving = amount || (catData?.total || 200);
          afterCosts -= saving;
          explanation = `Suppression dépense "${category || "divers"}": -${saving}€/mois.`;
          recommendations.push("Vérifier que cette dépense n'est pas structurelle");
          break;
        }

        case "revenue_change": {
          const { percentChange, reason } = scenario.params;
          const pct = percentChange || -10;
          afterRevenue = before.revenue * (1 + pct / 100);
          explanation = `Variation de CA de ${pct > 0 ? "+" : ""}${pct}% (${reason || "scénario"}). Revenu projeté: ${Math.round(afterRevenue)}€.`;
          if (pct < -20) {
            recommendations.push("Scénario critique: prévoir un plan de trésorerie d'urgence");
          }
          break;
        }

        case "custom": {
          const { revenueDelta, costsDelta, description } = scenario.params;
          afterRevenue += (revenueDelta || 0);
          afterCosts += (costsDelta || 0);
          explanation = description || `Scénario personnalisé: revenu ${revenueDelta >= 0 ? "+" : ""}${revenueDelta || 0}€, coûts ${costsDelta >= 0 ? "+" : ""}${costsDelta || 0}€.`;
          break;
        }
      }

      const afterMargin = afterRevenue - afterCosts;
      const afterMarginRatio = afterRevenue > 0 ? Math.round((afterMargin / afterRevenue) * 10000) / 100 : 0;

      const after = {
        revenue: Math.round(afterRevenue * 100) / 100,
        costs: Math.round(afterCosts * 100) / 100,
        margin: Math.round(afterMargin * 100) / 100,
        marginRatio: afterMarginRatio,
      };

      const impact = {
        revenueDelta: Math.round((after.revenue - before.revenue) * 100) / 100,
        costsDelta: Math.round((after.costs - before.costs) * 100) / 100,
        marginDelta: Math.round((after.margin - before.margin) * 100) / 100,
        marginRatioDelta: Math.round((after.marginRatio - before.marginRatio) * 100) / 100,
      };

      const verdict = impact.marginDelta > 50 ? "positive" : impact.marginDelta < -50 ? "negative" : "neutral";

      console.log(`[DigitalTwin] Simulation "${scenario.type}": margin ${before.marginRatio}% → ${afterMarginRatio}% (${impact.marginDelta > 0 ? "+" : ""}${impact.marginDelta}€)`);

      return { success: true, scenario, before, after, impact, verdict, explanation, recommendations };
    } catch (error: any) {
      console.error("[DigitalTwin] Error:", error.message);
      return { success: false, scenario, before: { revenue: 0, costs: 0, margin: 0, marginRatio: 0 }, after: { revenue: 0, costs: 0, margin: 0, marginRatio: 0 }, impact: { revenueDelta: 0, costsDelta: 0, marginDelta: 0, marginRatioDelta: 0 }, verdict: "neutral", explanation: "", recommendations: [], error: error.message };
    }
  }

  async multiScenario(scenarios: SimulationScenario[], restaurant: string = "suguval"): Promise<{ snapshot: RestaurantSnapshot; simulations: SimulationResult[]; bestScenario: number; worstScenario: number }> {
    const snapshot = await this.getSnapshot(restaurant);
    const simulations = await Promise.all(scenarios.map(s => this.simulate(s, restaurant)));

    let bestIdx = 0, worstIdx = 0;
    for (let i = 1; i < simulations.length; i++) {
      if (simulations[i].impact.marginDelta > simulations[bestIdx].impact.marginDelta) bestIdx = i;
      if (simulations[i].impact.marginDelta < simulations[worstIdx].impact.marginDelta) worstIdx = i;
    }

    return { snapshot, simulations, bestScenario: bestIdx, worstScenario: worstIdx };
  }
}

export const digitalTwinService = DigitalTwinService.getInstance();
