import { db } from "../db";
import { sql } from "drizzle-orm";
import { agentMailService } from "./agentMailService";

interface ReportData {
  restaurant: "suguval" | "sugumaillane" | "both";
  period: { start: string; end: string; label: string };
  revenue: { total: number; byCategory: Record<string, number> };
  purchases: { total: number; count: number; topSuppliers: { name: string; total: number }[] };
  expenses: { total: number; count: number; byCategory: Record<string, number> };
  bank: { credits: number; debits: number; balance: number };
  employees: { count: number; payrollTotal: number };
  trends: { purchaseTrend: string; revenueTrend: string };
}

interface GeneratedReport {
  html: string;
  text: string;
  data: ReportData;
  generatedAt: string;
}

async function getRestaurantData(prefix: string, startDate: string, endDate: string): Promise<Omit<ReportData, "restaurant" | "period" | "trends">> {
  const [purchasesResult, purchasesBySupplier, expensesResult, expensesByCategory, bankResult, employeesResult, payrollResult] = await Promise.allSettled([
    db.execute(sql`SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM ${sql.raw(`${prefix}_purchases`)} WHERE invoice_date >= ${startDate} AND invoice_date <= ${endDate}`),
    db.execute(sql`SELECT supplier as name, COALESCE(SUM(amount), 0) as total FROM ${sql.raw(`${prefix}_purchases`)} WHERE invoice_date >= ${startDate} AND invoice_date <= ${endDate} GROUP BY supplier ORDER BY total DESC LIMIT 10`),
    db.execute(sql`SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM ${sql.raw(`${prefix}_expenses`)} WHERE due_date >= ${startDate} AND due_date <= ${endDate}`),
    db.execute(sql`SELECT category, COALESCE(SUM(amount), 0) as total FROM ${sql.raw(`${prefix}_expenses`)} WHERE due_date >= ${startDate} AND due_date <= ${endDate} GROUP BY category`),
    db.execute(sql`SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as credits, COALESCE(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0) as debits, COALESCE((SELECT balance FROM ${sql.raw(`${prefix}_bank`)} ORDER BY entry_date DESC, id DESC LIMIT 1), 0) as balance FROM ${sql.raw(`${prefix}_bank`)} WHERE entry_date >= ${startDate} AND entry_date <= ${endDate}`),
    db.execute(sql`SELECT COUNT(*) as count FROM ${sql.raw(`${prefix}_employees`)} WHERE is_active = true`),
    db.execute(sql`SELECT COALESCE(SUM(net_salary), 0) as total FROM ${sql.raw(`${prefix}_payroll`)} WHERE pay_period >= ${startDate} AND pay_period <= ${endDate}`)
  ]);

  const purchases = purchasesResult.status === "fulfilled" ? purchasesResult.value.rows[0] : { total: 0, count: 0 };
  const suppliers = purchasesBySupplier.status === "fulfilled" ? purchasesBySupplier.value.rows : [];
  const expenses = expensesResult.status === "fulfilled" ? expensesResult.value.rows[0] : { total: 0, count: 0 };
  const expCats = expensesByCategory.status === "fulfilled" ? expensesByCategory.value.rows : [];
  const bank = bankResult.status === "fulfilled" ? bankResult.value.rows[0] : { credits: 0, debits: 0, balance: 0 };
  const emps = employeesResult.status === "fulfilled" ? employeesResult.value.rows[0] : { count: 0 };
  const payroll = payrollResult.status === "fulfilled" ? payrollResult.value.rows[0] : { total: 0 };

  const byCategory: Record<string, number> = {};
  (expCats as any[]).forEach(r => { byCategory[r.category || "autre"] = Number(r.total); });

  return {
    revenue: { total: Number((bank as any).credits || 0), byCategory: {} },
    purchases: {
      total: Number((purchases as any).total || 0),
      count: Number((purchases as any).count || 0),
      topSuppliers: (suppliers as any[]).map(s => ({ name: s.name, total: Number(s.total) }))
    },
    expenses: {
      total: Number((expenses as any).total || 0),
      count: Number((expenses as any).count || 0),
      byCategory
    },
    bank: {
      credits: Number((bank as any).credits || 0),
      debits: Math.abs(Number((bank as any).debits || 0)),
      balance: Number((bank as any).balance || 0)
    },
    employees: {
      count: Number((emps as any).count || 0),
      payrollTotal: Number((payroll as any).total || 0)
    }
  };
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
}

function generateHtmlReport(report: GeneratedReport): string {
  const d = report.data;
  const restaurantName = d.restaurant === "suguval" ? "SUGU Valentine" : d.restaurant === "sugumaillane" ? "SUGU Maillane" : "SUGU (Valentine + Maillane)";

  const supplierRows = d.purchases.topSuppliers.slice(0, 8).map(s => 
    `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;">${s.name}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;">${formatCurrency(s.total)}</td></tr>`
  ).join("");

  const expenseRows = Object.entries(d.expenses.byCategory).map(([cat, total]) =>
    `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;text-transform:capitalize;">${cat}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;">${formatCurrency(total)}</td></tr>`
  ).join("");

  const profit = d.bank.credits - d.bank.debits;
  const profitColor = profit >= 0 ? "#22c55e" : "#ef4444";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Rapport ${restaurantName} — ${d.period.label}</title></head>
<body style="margin:0;padding:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;">
<div style="max-width:700px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

  <div style="background:linear-gradient(135deg,#1e3a5f 0%,#2d5a8e 100%);color:white;padding:32px;text-align:center;">
    <h1 style="margin:0;font-size:22px;">📊 Rapport Financier</h1>
    <p style="margin:8px 0 0;opacity:0.9;font-size:16px;">${restaurantName}</p>
    <p style="margin:4px 0 0;opacity:0.7;font-size:14px;">${d.period.label}</p>
  </div>

  <div style="padding:24px;">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">
      <div style="background:#f0fdf4;border-radius:12px;padding:16px;text-align:center;">
        <div style="font-size:12px;color:#666;text-transform:uppercase;">Encaissements</div>
        <div style="font-size:24px;font-weight:700;color:#22c55e;">${formatCurrency(d.bank.credits)}</div>
      </div>
      <div style="background:#fef2f2;border-radius:12px;padding:16px;text-align:center;">
        <div style="font-size:12px;color:#666;text-transform:uppercase;">Décaissements</div>
        <div style="font-size:24px;font-weight:700;color:#ef4444;">${formatCurrency(d.bank.debits)}</div>
      </div>
      <div style="background:#f5f3ff;border-radius:12px;padding:16px;text-align:center;">
        <div style="font-size:12px;color:#666;text-transform:uppercase;">Résultat</div>
        <div style="font-size:24px;font-weight:700;color:${profitColor};">${formatCurrency(profit)}</div>
      </div>
      <div style="background:#eff6ff;border-radius:12px;padding:16px;text-align:center;">
        <div style="font-size:12px;color:#666;text-transform:uppercase;">Solde Bancaire</div>
        <div style="font-size:24px;font-weight:700;color:#2563eb;">${formatCurrency(d.bank.balance)}</div>
      </div>
    </div>

    <h3 style="color:#1e3a5f;border-bottom:2px solid #e5e7eb;padding-bottom:8px;">🛒 Achats Fournisseurs</h3>
    <p>Total: <b>${formatCurrency(d.purchases.total)}</b> (${d.purchases.count} factures)</p>
    ${supplierRows ? `<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <thead><tr style="background:#f8f9fa;"><th style="padding:8px 12px;text-align:left;">Fournisseur</th><th style="padding:8px 12px;text-align:right;">Montant</th></tr></thead>
      <tbody>${supplierRows}</tbody>
    </table>` : "<p>Aucune donnée</p>"}

    <h3 style="color:#1e3a5f;border-bottom:2px solid #e5e7eb;padding-bottom:8px;">💰 Frais Généraux</h3>
    <p>Total: <b>${formatCurrency(d.expenses.total)}</b> (${d.expenses.count} écritures)</p>
    ${expenseRows ? `<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <thead><tr style="background:#f8f9fa;"><th style="padding:8px 12px;text-align:left;">Catégorie</th><th style="padding:8px 12px;text-align:right;">Montant</th></tr></thead>
      <tbody>${expenseRows}</tbody>
    </table>` : "<p>Aucune donnée</p>"}

    <h3 style="color:#1e3a5f;border-bottom:2px solid #e5e7eb;padding-bottom:8px;">👥 Employés & Paie</h3>
    <p>Effectif actif: <b>${d.employees.count}</b> | Masse salariale: <b>${formatCurrency(d.employees.payrollTotal)}</b></p>
  </div>

  <div style="background:#f8f9fa;padding:16px;text-align:center;color:#999;font-size:12px;">
    Généré par Ulysse le ${new Date(report.generatedAt).toLocaleString("fr-FR")}
  </div>
</div>
</body>
</html>`;
}

function generateTextReport(report: GeneratedReport): string {
  const d = report.data;
  const name = d.restaurant === "suguval" ? "SUGU Valentine" : d.restaurant === "sugumaillane" ? "SUGU Maillane" : "SUGU Combiné";
  let text = `RAPPORT FINANCIER — ${name}\n${d.period.label}\n${"=".repeat(50)}\n\n`;

  text += `BANQUE\n`;
  text += `  Encaissements: ${formatCurrency(d.bank.credits)}\n`;
  text += `  Décaissements: ${formatCurrency(d.bank.debits)}\n`;
  text += `  Résultat: ${formatCurrency(d.bank.credits - d.bank.debits)}\n`;
  text += `  Solde: ${formatCurrency(d.bank.balance)}\n\n`;

  text += `ACHATS FOURNISSEURS (${d.purchases.count} factures)\n`;
  text += `  Total: ${formatCurrency(d.purchases.total)}\n`;
  d.purchases.topSuppliers.forEach(s => {
    text += `  - ${s.name}: ${formatCurrency(s.total)}\n`;
  });
  text += `\n`;

  text += `FRAIS GÉNÉRAUX (${d.expenses.count} écritures)\n`;
  text += `  Total: ${formatCurrency(d.expenses.total)}\n`;
  Object.entries(d.expenses.byCategory).forEach(([cat, total]) => {
    text += `  - ${cat}: ${formatCurrency(total)}\n`;
  });
  text += `\n`;

  text += `EMPLOYÉS & PAIE\n`;
  text += `  Effectif: ${d.employees.count}\n`;
  text += `  Masse salariale: ${formatCurrency(d.employees.payrollTotal)}\n`;

  return text;
}

export async function generateReport(
  restaurant: "suguval" | "sugumaillane" | "both",
  periodType: "week" | "month" | "quarter" | "year" | "custom",
  customStart?: string,
  customEnd?: string
): Promise<GeneratedReport> {
  const now = new Date();
  let start: string, end: string, label: string;

  switch (periodType) {
    case "week": {
      const dayOfWeek = now.getDay();
      const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const monday = new Date(now);
      monday.setDate(now.getDate() - mondayOffset - 7);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      start = monday.toISOString().split("T")[0];
      end = sunday.toISOString().split("T")[0];
      label = `Semaine du ${monday.toLocaleDateString("fr-FR")} au ${sunday.toLocaleDateString("fr-FR")}`;
      break;
    }
    case "month": {
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
      start = prevMonth.toISOString().split("T")[0];
      end = lastDay.toISOString().split("T")[0];
      label = `${prevMonth.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}`;
      break;
    }
    case "quarter": {
      const currentQ = Math.floor(now.getMonth() / 3);
      const prevQ = currentQ === 0 ? 3 : currentQ - 1;
      const prevQYear = currentQ === 0 ? now.getFullYear() - 1 : now.getFullYear();
      start = `${prevQYear}-${String(prevQ * 3 + 1).padStart(2, "0")}-01`;
      const endMonth = prevQ * 3 + 3;
      const endDate = new Date(prevQYear, endMonth, 0);
      end = endDate.toISOString().split("T")[0];
      label = `T${prevQ + 1} ${prevQYear}`;
      break;
    }
    case "year": {
      const prevYear = now.getFullYear() - 1;
      start = `${prevYear}-01-01`;
      end = `${prevYear}-12-31`;
      label = `Année ${prevYear}`;
      break;
    }
    case "custom":
    default: {
      start = customStart || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      end = customEnd || now.toISOString().split("T")[0];
      label = `Du ${new Date(start).toLocaleDateString("fr-FR")} au ${new Date(end).toLocaleDateString("fr-FR")}`;
    }
  }

  let reportData: ReportData;

  if (restaurant === "both") {
    const [valData, mailData] = await Promise.all([
      getRestaurantData("sugu", start, end),
      getRestaurantData("sugum", start, end)
    ]);
    reportData = {
      restaurant: "both",
      period: { start, end, label },
      revenue: { total: valData.revenue.total + mailData.revenue.total, byCategory: {} },
      purchases: {
        total: valData.purchases.total + mailData.purchases.total,
        count: valData.purchases.count + mailData.purchases.count,
        topSuppliers: [...valData.purchases.topSuppliers, ...mailData.purchases.topSuppliers]
          .reduce((acc, s) => {
            const existing = acc.find(x => x.name === s.name);
            if (existing) existing.total += s.total;
            else acc.push({ ...s });
            return acc;
          }, [] as { name: string; total: number }[])
          .sort((a, b) => b.total - a.total)
          .slice(0, 10)
      },
      expenses: {
        total: valData.expenses.total + mailData.expenses.total,
        count: valData.expenses.count + mailData.expenses.count,
        byCategory: Object.entries({ ...valData.expenses.byCategory }).reduce((acc, [k, v]) => {
          acc[k] = (acc[k] || 0) + v;
          return acc;
        }, { ...mailData.expenses.byCategory } as Record<string, number>)
      },
      bank: {
        credits: valData.bank.credits + mailData.bank.credits,
        debits: valData.bank.debits + mailData.bank.debits,
        balance: valData.bank.balance + mailData.bank.balance
      },
      employees: {
        count: valData.employees.count + mailData.employees.count,
        payrollTotal: valData.employees.payrollTotal + mailData.employees.payrollTotal
      },
      trends: { purchaseTrend: "stable", revenueTrend: "stable" }
    };
  } else {
    const prefix = restaurant === "suguval" ? "sugu" : "sugum";
    const data = await getRestaurantData(prefix, start, end);
    reportData = {
      restaurant,
      period: { start, end, label },
      ...data,
      trends: { purchaseTrend: "stable", revenueTrend: "stable" }
    };
  }

  const report: GeneratedReport = {
    html: "",
    text: "",
    data: reportData,
    generatedAt: new Date().toISOString()
  };
  report.html = generateHtmlReport(report);
  report.text = generateTextReport(report);

  return report;
}

export async function generateAndEmailReport(
  restaurant: "suguval" | "sugumaillane" | "both",
  periodType: "week" | "month" | "quarter" | "year" | "custom",
  recipientEmail: string,
  customStart?: string,
  customEnd?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const report = await generateReport(restaurant, periodType, customStart, customEnd);
    const name = restaurant === "suguval" ? "Valentine" : restaurant === "sugumaillane" ? "Maillane" : "Combiné";

    try {
      const { googleMailService } = await import('./googleMailService');
      const gmailConnected = await googleMailService.isConnected();
      if (gmailConnected) {
        await googleMailService.sendWithAttachment({ to: recipientEmail, subject: `📊 Rapport ${name} — ${report.data.period.label}`, body: report.html });
        console.log(`[ReportGenerator] Report sent via Gmail to ${recipientEmail}`);
      } else {
        await agentMailService.sendEmail({ to: recipientEmail, subject: `📊 Rapport ${name} — ${report.data.period.label}`, body: report.html }, "ulysse");
      }
    } catch (gmailErr: any) {
      console.warn(`[ReportGenerator] Gmail failed, fallback AgentMail: ${gmailErr.message}`);
      await agentMailService.sendEmail({ to: recipientEmail, subject: `📊 Rapport ${name} — ${report.data.period.label}`, body: report.html }, "ulysse");
    }

    console.log(`[ReportGenerator] Report sent to ${recipientEmail}`);
    return { success: true };
  } catch (e: any) {
    console.error("[ReportGenerator] Error:", e.message);
    return { success: false, error: e.message };
  }
}

let reportSchedule = {
  enabled: false,
  frequency: "monthly" as "weekly" | "monthly",
  recipientEmail: "",
  restaurants: ["suguval", "sugumaillane"] as ("suguval" | "sugumaillane")[]
};

export function getReportSchedule() { return reportSchedule; }

export function updateReportSchedule(updates: Partial<typeof reportSchedule>) {
  reportSchedule = { ...reportSchedule, ...updates };
  return reportSchedule;
}

export async function checkAndSendScheduledReports(): Promise<void> {
  if (!reportSchedule.enabled || !reportSchedule.recipientEmail) return;
  const now = new Date();
  const isMonday = now.getDay() === 1;
  const isFirstOfMonth = now.getDate() === 1;

  if (reportSchedule.frequency === "weekly" && isMonday && now.getHours() === 8) {
    for (const r of reportSchedule.restaurants) {
      await generateAndEmailReport(r, "week", reportSchedule.recipientEmail);
    }
  }
  if (reportSchedule.frequency === "monthly" && isFirstOfMonth && now.getHours() === 8) {
    for (const r of reportSchedule.restaurants) {
      await generateAndEmailReport(r, "month", reportSchedule.recipientEmail);
    }
  }
}

export const reportGeneratorService = {
  generateReport,
  generateAndEmailReport,
  getReportSchedule,
  updateReportSchedule,
  checkAndSendScheduledReports
};
