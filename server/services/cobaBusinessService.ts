import { db } from "../db";
import { sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

const SCHEMA_PREFIX = "coba_biz_";
const initializedSchemas = new Set<string>();

function schemaName(tenantId: string): string {
  return `${SCHEMA_PREFIX}${tenantId.replace(/[^a-z0-9_]/gi, "_").toLowerCase()}`;
}

async function ensureTenantSchema(tenantId: string) {
  const sn = schemaName(tenantId);
  if (initializedSchemas.has(sn)) return sn;

  await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS "${sn}"`));

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "${sn}".purchases (
      id SERIAL PRIMARY KEY,
      supplier TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL DEFAULT 'alimentaire',
      amount REAL NOT NULL,
      tax_amount REAL DEFAULT 0,
      invoice_number TEXT,
      invoice_date TEXT,
      due_date TEXT,
      is_paid BOOLEAN NOT NULL DEFAULT false,
      paid_date TEXT,
      payment_method TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS "${sn}".expenses (
      id SERIAL PRIMARY KEY,
      label TEXT DEFAULT 'Non spécifié',
      category TEXT NOT NULL DEFAULT 'energie',
      description TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL,
      tax_amount REAL DEFAULT 0,
      period TEXT,
      frequency TEXT DEFAULT 'mensuel',
      due_date TEXT,
      is_paid BOOLEAN NOT NULL DEFAULT false,
      paid_date TEXT,
      payment_method TEXT,
      is_recurring BOOLEAN NOT NULL DEFAULT false,
      invoice_number TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS "${sn}".bank_entries (
      id SERIAL PRIMARY KEY,
      bank_name TEXT NOT NULL DEFAULT 'Banque Principale',
      entry_date TEXT NOT NULL,
      label TEXT NOT NULL,
      amount REAL NOT NULL,
      balance REAL,
      category TEXT,
      is_reconciled BOOLEAN NOT NULL DEFAULT false,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS "${sn}".loans (
      id SERIAL PRIMARY KEY,
      bank_name TEXT NOT NULL,
      loan_label TEXT NOT NULL,
      loan_type TEXT NOT NULL DEFAULT 'emprunt',
      total_amount REAL NOT NULL,
      remaining_amount REAL NOT NULL,
      monthly_payment REAL NOT NULL,
      interest_rate REAL,
      start_date TEXT NOT NULL,
      end_date TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS "${sn}".cash_entries (
      id SERIAL PRIMARY KEY,
      entry_date TEXT NOT NULL,
      total_revenue REAL NOT NULL,
      cash_amount REAL DEFAULT 0,
      cb_amount REAL DEFAULT 0,
      ubereats_amount REAL DEFAULT 0,
      deliveroo_amount REAL DEFAULT 0,
      online_amount REAL DEFAULT 0,
      other_amount REAL DEFAULT 0,
      covers_count INTEGER DEFAULT 0,
      average_ticket REAL DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS "${sn}".employees (
      id SERIAL PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      role TEXT NOT NULL,
      contract_type TEXT NOT NULL DEFAULT 'CDI',
      monthly_salary REAL,
      hourly_rate REAL,
      weekly_hours REAL DEFAULT 35,
      start_date TEXT NOT NULL,
      end_date TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      phone TEXT,
      email TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS "${sn}".payroll (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      gross_salary REAL NOT NULL,
      net_salary REAL NOT NULL,
      social_charges REAL DEFAULT 0,
      employer_charges REAL,
      total_employer_cost REAL,
      bonus REAL DEFAULT 0,
      overtime REAL DEFAULT 0,
      is_paid BOOLEAN NOT NULL DEFAULT false,
      paid_date TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS "${sn}".suppliers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      short_name TEXT,
      siret TEXT,
      tva_number TEXT,
      account_number TEXT,
      address TEXT,
      city TEXT,
      postal_code TEXT,
      phone TEXT,
      email TEXT,
      website TEXT,
      contact_name TEXT,
      category TEXT DEFAULT 'alimentaire',
      payment_terms TEXT,
      default_payment_method TEXT,
      bank_iban TEXT,
      bank_bic TEXT,
      notes TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS "${sn}".absences (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'conge',
      start_date TEXT NOT NULL,
      end_date TEXT,
      duration REAL,
      reason TEXT,
      is_approved BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS "${sn}".files (
      id SERIAL PRIMARY KEY,
      file_name TEXT NOT NULL,
      file_type TEXT NOT NULL DEFAULT 'document',
      file_path TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      category TEXT DEFAULT 'autre',
      description TEXT,
      parsed_data JSONB,
      upload_source TEXT DEFAULT 'manual',
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS "${sn}".hubrise_config (
      id SERIAL PRIMARY KEY,
      access_token TEXT NOT NULL,
      account_id TEXT,
      location_id TEXT,
      catalog_id TEXT,
      customer_list_id TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      last_sync_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS "${sn}".hubrise_orders (
      id SERIAL PRIMARY KEY,
      order_id TEXT UNIQUE NOT NULL,
      status TEXT,
      created_at_hr TEXT,
      total REAL DEFAULT 0,
      service_type TEXT,
      channel TEXT,
      customer_name TEXT,
      items JSONB,
      payments JSONB,
      raw_data JSONB,
      synced_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS "${sn}".chat_history (
      id SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      pro_user_id TEXT NOT NULL,
      pro_user_name TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_calls JSONB,
      tool_results JSONB,
      tokens_used INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_chat_history_session ON "${sn}".chat_history(session_id);
    CREATE INDEX IF NOT EXISTS idx_chat_history_created ON "${sn}".chat_history(created_at);
  `));

  initializedSchemas.add(sn);
  console.log(`[COBA-Business] Schema "${sn}" ensured for tenant "${tenantId}"`);
  return sn;
}

async function q(tenantId: string, query: string): Promise<any[]> {
  const sn = await ensureTenantSchema(tenantId);
  const result = await db.execute(sql.raw(query.replace(/__SCHEMA__/g, `"${sn}"`)));
  return result.rows as any[];
}

function esc(val: any): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") return String(val);
  return `'${String(val).replace(/'/g, "''")}'`;
}

function buildInsert(table: string, data: Record<string, any>): string {
  const keys = Object.keys(data).filter(k => data[k] !== undefined);
  const cols = keys.map(k => k.replace(/([A-Z])/g, "_$1").toLowerCase()).join(", ");
  const vals = keys.map(k => esc(data[k])).join(", ");
  return `INSERT INTO __SCHEMA__.${table} (${cols}) VALUES (${vals}) RETURNING *`;
}

function buildUpdate(table: string, id: number, data: Record<string, any>): string {
  const keys = Object.keys(data).filter(k => data[k] !== undefined && k !== "id" && k !== "tenantId");
  const sets = keys.map(k => {
    const col = k.replace(/([A-Z])/g, "_$1").toLowerCase();
    return `${col} = ${esc(data[k])}`;
  }).join(", ");
  return `UPDATE __SCHEMA__.${table} SET ${sets} WHERE id = ${id} RETURNING *`;
}

// ─── PURCHASES ───
async function listPurchases(tenantId: string, opts?: { year?: string; isPaid?: boolean }) {
  let where = "WHERE 1=1";
  if (opts?.isPaid !== undefined) where += ` AND is_paid = ${opts.isPaid}`;
  if (opts?.year) where += ` AND (invoice_date LIKE '${opts.year}%' OR created_at::text LIKE '${opts.year}%')`;
  return q(tenantId, `SELECT * FROM __SCHEMA__.purchases ${where} ORDER BY created_at DESC LIMIT 500`);
}

async function addPurchase(tenantId: string, data: any) {
  const rows = await q(tenantId, buildInsert("purchases", data));
  return rows[0];
}

async function updatePurchase(tenantId: string, id: number, data: any) {
  const rows = await q(tenantId, buildUpdate("purchases", id, data));
  return rows[0];
}

async function deletePurchase(tenantId: string, id: number) {
  await q(tenantId, `DELETE FROM __SCHEMA__.purchases WHERE id = ${id}`);
}

// ─── EXPENSES ───
async function listExpenses(tenantId: string, opts?: { year?: string; category?: string }) {
  let where = "WHERE 1=1";
  if (opts?.category) where += ` AND category = ${esc(opts.category)}`;
  if (opts?.year) where += ` AND (period LIKE '${opts.year}%' OR created_at::text LIKE '${opts.year}%')`;
  return q(tenantId, `SELECT * FROM __SCHEMA__.expenses ${where} ORDER BY created_at DESC LIMIT 500`);
}

async function addExpense(tenantId: string, data: any) {
  const rows = await q(tenantId, buildInsert("expenses", data));
  return rows[0];
}

async function updateExpense(tenantId: string, id: number, data: any) {
  const rows = await q(tenantId, buildUpdate("expenses", id, data));
  return rows[0];
}

async function deleteExpense(tenantId: string, id: number) {
  await q(tenantId, `DELETE FROM __SCHEMA__.expenses WHERE id = ${id}`);
}

// ─── BANK ───
async function listBankEntries(tenantId: string, opts?: { year?: string }) {
  let where = "WHERE 1=1";
  if (opts?.year) where += ` AND entry_date LIKE '${opts.year}%'`;
  return q(tenantId, `SELECT * FROM __SCHEMA__.bank_entries ${where} ORDER BY entry_date DESC LIMIT 500`);
}

async function addBankEntry(tenantId: string, data: any) {
  const rows = await q(tenantId, buildInsert("bank_entries", data));
  return rows[0];
}

async function updateBankEntry(tenantId: string, id: number, data: any) {
  const rows = await q(tenantId, buildUpdate("bank_entries", id, data));
  return rows[0];
}

async function deleteBankEntry(tenantId: string, id: number) {
  await q(tenantId, `DELETE FROM __SCHEMA__.bank_entries WHERE id = ${id}`);
}

// ─── LOANS ───
async function listLoans(tenantId: string) {
  return q(tenantId, `SELECT * FROM __SCHEMA__.loans ORDER BY created_at DESC`);
}

async function addLoan(tenantId: string, data: any) {
  const rows = await q(tenantId, buildInsert("loans", data));
  return rows[0];
}

async function updateLoan(tenantId: string, id: number, data: any) {
  const rows = await q(tenantId, buildUpdate("loans", id, data));
  return rows[0];
}

async function deleteLoan(tenantId: string, id: number) {
  await q(tenantId, `DELETE FROM __SCHEMA__.loans WHERE id = ${id}`);
}

// ─── CASH REGISTER ───
async function listCashEntries(tenantId: string, opts?: { year?: string; month?: string }) {
  let where = "WHERE 1=1";
  if (opts?.month) where += ` AND entry_date LIKE '${opts.month}%'`;
  else if (opts?.year) where += ` AND entry_date LIKE '${opts.year}%'`;
  return q(tenantId, `SELECT * FROM __SCHEMA__.cash_entries ${where} ORDER BY entry_date DESC LIMIT 365`);
}

async function addCashEntry(tenantId: string, data: any) {
  const rows = await q(tenantId, buildInsert("cash_entries", data));
  return rows[0];
}

async function updateCashEntry(tenantId: string, id: number, data: any) {
  const rows = await q(tenantId, buildUpdate("cash_entries", id, data));
  return rows[0];
}

async function deleteCashEntry(tenantId: string, id: number) {
  await q(tenantId, `DELETE FROM __SCHEMA__.cash_entries WHERE id = ${id}`);
}

// ─── EMPLOYEES ───
async function listEmployees(tenantId: string, activeOnly = true) {
  let where = activeOnly ? "WHERE is_active = TRUE" : "";
  return q(tenantId, `SELECT * FROM __SCHEMA__.employees ${where} ORDER BY last_name`);
}

async function addEmployee(tenantId: string, data: any) {
  const rows = await q(tenantId, buildInsert("employees", data));
  return rows[0];
}

async function updateEmployee(tenantId: string, id: number, data: any) {
  const rows = await q(tenantId, buildUpdate("employees", id, data));
  return rows[0];
}

async function deleteEmployee(tenantId: string, id: number) {
  await q(tenantId, `UPDATE __SCHEMA__.employees SET is_active = FALSE WHERE id = ${id}`);
}

// ─── PAYROLL ───
async function listPayroll(tenantId: string, opts?: { period?: string; employeeId?: number }) {
  let where = "WHERE 1=1";
  if (opts?.employeeId) where += ` AND employee_id = ${opts.employeeId}`;
  if (opts?.period) where += ` AND period LIKE '${opts.period}%'`;
  return q(tenantId, `SELECT * FROM __SCHEMA__.payroll ${where} ORDER BY period DESC LIMIT 200`);
}

async function addPayroll(tenantId: string, data: any) {
  const rows = await q(tenantId, buildInsert("payroll", data));
  return rows[0];
}

async function updatePayroll(tenantId: string, id: number, data: any) {
  const rows = await q(tenantId, buildUpdate("payroll", id, data));
  return rows[0];
}

// ─── SUPPLIERS (Fournisseurs) ───
async function listSuppliers(tenantId: string, opts?: { active?: boolean }) {
  let where = "WHERE 1=1";
  if (opts?.active !== undefined) where += ` AND is_active = ${opts.active ? 'TRUE' : 'FALSE'}`;
  return q(tenantId, `SELECT s.*, 
    COALESCE((SELECT COUNT(*) FROM __SCHEMA__.purchases p WHERE p.supplier = s.name), 0) as invoice_count,
    COALESCE((SELECT SUM(p.amount) FROM __SCHEMA__.purchases p WHERE p.supplier = s.name), 0) as total_purchases,
    (SELECT MAX(p.invoice_date) FROM __SCHEMA__.purchases p WHERE p.supplier = s.name) as last_invoice_date
    FROM __SCHEMA__.suppliers s ${where} ORDER BY s.name`);
}

async function addSupplier(tenantId: string, data: any) {
  const rows = await q(tenantId, buildInsert("suppliers", data));
  return rows[0];
}

async function updateSupplier(tenantId: string, id: number, data: any) {
  const rows = await q(tenantId, buildUpdate("suppliers", id, data));
  return rows[0];
}

async function deleteSupplier(tenantId: string, id: number) {
  await q(tenantId, `UPDATE __SCHEMA__.suppliers SET is_active = FALSE WHERE id = ${id}`);
}

// ─── ABSENCES ───
async function listAbsences(tenantId: string, opts?: { employeeId?: number; year?: string }) {
  let where = "WHERE 1=1";
  if (opts?.employeeId) where += ` AND employee_id = ${opts.employeeId}`;
  if (opts?.year) where += ` AND start_date LIKE '${opts.year}%'`;
  return q(tenantId, `SELECT * FROM __SCHEMA__.absences ${where} ORDER BY start_date DESC LIMIT 200`);
}

async function addAbsence(tenantId: string, data: any) {
  const rows = await q(tenantId, buildInsert("absences", data));
  return rows[0];
}

async function updateAbsence(tenantId: string, id: number, data: any) {
  const rows = await q(tenantId, buildUpdate("absences", id, data));
  return rows[0];
}

async function deleteAbsence(tenantId: string, id: number) {
  await q(tenantId, `DELETE FROM __SCHEMA__.absences WHERE id = ${id}`);
}

// ─── AUDIT ───
async function getAuditOverview(tenantId: string, year?: string) {
  const y = year || new Date().getFullYear().toString();
  const synthesis = await getFinancialSynthesis(tenantId, y);
  const purchases = await listPurchases(tenantId, { year: y });
  const expenses = await listExpenses(tenantId, { year: y });
  const cash = await listCashEntries(tenantId, { year: y });
  const loans = await listLoans(tenantId);
  const payroll = await listPayroll(tenantId, { period: y });
  const bank = await listBankEntries(tenantId, { year: y });

  const totalCovers = cash.reduce((s: number, c: any) => s + (c.covers_count || 0), 0);
  const operatingDays = cash.length;
  const avgDailyRevenue = operatingDays > 0 ? synthesis.kpis.totalRevenue / operatingDays : 0;
  const avgTicket = totalCovers > 0 ? synthesis.kpis.totalRevenue / totalCovers : 0;

  const unpaidPurchases = purchases.filter((p: any) => !p.is_paid).length;
  const unpaidExpenses = expenses.filter((e: any) => !e.is_paid).length;
  const totalRemainingLoans = loans.reduce((s: number, l: any) => s + (l.remaining_amount || 0), 0);
  const totalBankDebits = bank.filter((b: any) => b.amount < 0).reduce((s: number, b: any) => s + Math.abs(b.amount), 0);
  const totalBankCredits = bank.filter((b: any) => b.amount > 0).reduce((s: number, b: any) => s + b.amount, 0);

  const monthlyRevenue: Record<string, number> = {};
  const monthlyCosts: Record<string, number> = {};
  cash.forEach((c: any) => {
    const m = (c.entry_date || "").substring(0, 7);
    monthlyRevenue[m] = (monthlyRevenue[m] || 0) + (c.total_revenue || 0);
  });
  purchases.forEach((p: any) => {
    const m = (p.invoice_date || "").substring(0, 7);
    monthlyCosts[m] = (monthlyCosts[m] || 0) + (p.amount || 0);
  });
  expenses.forEach((e: any) => {
    const m = (e.period || "").substring(0, 7);
    monthlyCosts[m] = (monthlyCosts[m] || 0) + (e.amount || 0);
  });

  const supplierTotals: Record<string, number> = {};
  purchases.forEach((p: any) => {
    supplierTotals[p.supplier] = (supplierTotals[p.supplier] || 0) + (p.amount || 0);
  });
  const topSuppliers = Object.entries(supplierTotals)
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  return {
    year: y,
    totalRevenue: synthesis.kpis.totalRevenue,
    totalCosts: synthesis.kpis.totalPurchases + synthesis.kpis.totalExpenses + synthesis.kpis.totalSalaries + synthesis.kpis.totalCharges,
    operatingProfit: synthesis.kpis.totalRevenue - (synthesis.kpis.totalPurchases + synthesis.kpis.totalExpenses + synthesis.kpis.totalSalaries + synthesis.kpis.totalCharges),
    profitMargin: synthesis.kpis.margin + "%",
    totalCovers,
    operatingDays,
    avgDailyRevenue: Math.round(avgDailyRevenue * 100) / 100,
    avgTicket: Math.round(avgTicket * 100) / 100,
    activeEmployees: synthesis.kpis.activeEmployees,
    costBreakdown: {
      achats: synthesis.kpis.totalPurchases,
      fraisGeneraux: synthesis.kpis.totalExpenses,
      salaires: synthesis.kpis.totalSalaries,
      chargesSociales: synthesis.kpis.totalCharges,
      emprunts: synthesis.kpis.totalLoanPayments,
    },
    monthlyRevenue,
    monthlyCosts,
    unpaidPurchases,
    unpaidExpenses,
    totalRemainingLoans,
    totalBankDebits: Math.round(totalBankDebits * 100) / 100,
    totalBankCredits: Math.round(totalBankCredits * 100) / 100,
    bankEntriesCount: bank.length,
    purchasesCount: purchases.length,
    expensesCount: expenses.length,
    topSuppliers,
  };
}

// ─── FINANCIAL SYNTHESIS ───
async function getFinancialSynthesis(tenantId: string, year?: string) {
  const y = year || new Date().getFullYear().toString();

  const purchases = await listPurchases(tenantId, { year: y });
  const expenses = await listExpenses(tenantId, { year: y });
  const cash = await listCashEntries(tenantId, { year: y });
  const employees = await listEmployees(tenantId, true);
  const payroll = await listPayroll(tenantId, { period: y });
  const loans = await listLoans(tenantId);

  const totalPurchases = purchases.reduce((s: number, p: any) => s + (p.amount || 0), 0);
  const totalExpenses = expenses.reduce((s: number, e: any) => s + (e.amount || 0), 0);
  const totalRevenue = cash.reduce((s: number, c: any) => s + (c.total_revenue || 0), 0);
  const totalSalaries = payroll.reduce((s: number, p: any) => s + (p.gross_salary || 0), 0);
  const totalCharges = payroll.reduce((s: number, p: any) => s + (p.social_charges || 0) + (p.employer_charges || 0), 0);
  const totalLoanPayments = loans.reduce((s: number, l: any) => s + (l.monthly_payment || 0), 0) * 12;

  const totalCosts = totalPurchases + totalExpenses + totalSalaries + totalCharges;
  const margin = totalRevenue > 0 ? ((totalRevenue - totalCosts) / totalRevenue * 100) : 0;
  const foodCost = totalRevenue > 0 ? (totalPurchases / totalRevenue * 100) : 0;
  const overhead = totalRevenue > 0 ? (totalExpenses / totalRevenue * 100) : 0;

  const laborCost = totalRevenue > 0 ? ((totalSalaries + totalCharges) / totalRevenue * 100) : 0;
  const primeCost = foodCost + laborCost;

  let healthScore = 70;
  if (foodCost > 40) healthScore -= 25;
  else if (foodCost > 35) healthScore -= 15;
  else if (foodCost > 30) healthScore -= 5;
  else if (foodCost < 25) healthScore += 10;
  if (laborCost > 45) healthScore -= 15;
  else if (laborCost > 40) healthScore -= 5;
  if (primeCost > 70) healthScore -= 15;
  else if (primeCost > 65) healthScore -= 5;
  else if (primeCost < 60) healthScore += 10;
  if (overhead > 20) healthScore -= 10;
  if (margin < 5) healthScore -= 20;
  else if (margin > 15) healthScore += 15;
  if (totalRevenue === 0) healthScore = 50;
  healthScore = Math.max(0, Math.min(100, healthScore));

  const alerts: string[] = [];
  if (foodCost > 35) alerts.push(`⚠️ Food cost élevé: ${foodCost.toFixed(1)}% (cible: 25-30%)`);
  if (foodCost > 40) alerts.push(`🔴 Food cost CRITIQUE: ${foodCost.toFixed(1)}% — action immédiate requise`);
  if (laborCost > 45) alerts.push(`⚠️ Masse salariale excessive: ${laborCost.toFixed(1)}% du CA (cible: 30-35%)`);
  if (primeCost > 65) alerts.push(`⚠️ Prime cost trop élevé: ${primeCost.toFixed(1)}% (cible: < 65%)`);
  if (margin < 5 && totalRevenue > 0) alerts.push(`🔴 Marge nette critique: ${margin.toFixed(1)}% — seuil de viabilité = 5%`);

  const purchasesByCategory: Record<string, number> = {};
  purchases.forEach((p: any) => {
    purchasesByCategory[p.category] = (purchasesByCategory[p.category] || 0) + (p.amount || 0);
  });

  const expensesByCategory: Record<string, number> = {};
  expenses.forEach((e: any) => {
    expensesByCategory[e.category] = (expensesByCategory[e.category] || 0) + (e.amount || 0);
  });

  const revenueByMonth: Record<string, number> = {};
  cash.forEach((c: any) => {
    const month = (c.entry_date || "").substring(0, 7);
    revenueByMonth[month] = (revenueByMonth[month] || 0) + (c.total_revenue || 0);
  });

  return {
    tenantId,
    year: y,
    isolatedSchema: schemaName(tenantId),
    kpis: {
      healthScore: Math.round(healthScore),
      healthLabel: healthScore >= 75 ? "BON" : healthScore >= 50 ? "MOYEN" : "CRITIQUE",
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalPurchases: Math.round(totalPurchases * 100) / 100,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      totalSalaries: Math.round(totalSalaries * 100) / 100,
      totalCharges: Math.round(totalCharges * 100) / 100,
      margin: Math.round(margin * 10) / 10,
      foodCostPercent: Math.round(foodCost * 10) / 10,
      laborCostPercent: Math.round(laborCost * 10) / 10,
      primeCostPercent: Math.round(primeCost * 10) / 10,
      overheadPercent: Math.round(overhead * 10) / 10,
      activeEmployees: employees.length,
      totalLoanPayments: Math.round(totalLoanPayments * 100) / 100,
    },
    alerts,
    ratiosCiblesHCR: {
      foodCostCible: "25-30%",
      laborCostCible: "30-35% (charges incluses: 40-45%)",
      primeCostCible: "< 65%",
      overheadCible: "< 20%",
      margeCible: "> 5%",
    },
    breakdowns: {
      purchasesByCategory,
      expensesByCategory,
      revenueByMonth,
    },
    counts: {
      purchases: purchases.length,
      expenses: expenses.length,
      cashEntries: cash.length,
      employees: employees.length,
      payrollEntries: payroll.length,
      loans: loans.length,
    },
  };
}

// ─── MAXAI CROSS-TENANT OVERVIEW (admin only) ───
async function getAllTenantsOverview(year?: string) {
  const y = year || new Date().getFullYear().toString();
  const schemas = await db.execute(sql.raw(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE '${SCHEMA_PREFIX}%' ORDER BY schema_name`
  ));

  const tenants: any[] = [];
  for (const row of schemas.rows as any[]) {
    const sn = row.schema_name as string;
    const tid = sn.replace(SCHEMA_PREFIX, "");
    try {
      const synthesis = await getFinancialSynthesis(tid, y);
      tenants.push(synthesis);
    } catch (e) {
      tenants.push({ tenantId: tid, error: (e as Error).message });
    }
  }
  return { year: y, tenantCount: tenants.length, tenants };
}

async function listRegisteredTenants() {
  const schemas = await db.execute(sql.raw(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE '${SCHEMA_PREFIX}%' ORDER BY schema_name`
  ));
  return (schemas.rows as any[]).map(r => ({
    tenantId: (r.schema_name as string).replace(SCHEMA_PREFIX, ""),
    schema: r.schema_name,
  }));
}

// ─── FILES (Gestion de fichiers par tenant) ───
const COBA_UPLOADS_DIR = path.join(process.cwd(), "uploads", "coba-files");
if (!fs.existsSync(COBA_UPLOADS_DIR)) {
  fs.mkdirSync(COBA_UPLOADS_DIR, { recursive: true });
}

function tenantUploadDir(tenantId: string): string {
  const dir = path.join(COBA_UPLOADS_DIR, tenantId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function listFiles(tenantId: string, opts?: { category?: string }) {
  let where = "WHERE 1=1";
  if (opts?.category) where += ` AND category = ${esc(opts.category)}`;
  return q(tenantId, `SELECT * FROM __SCHEMA__.files ${where} ORDER BY created_at DESC LIMIT 200`);
}

async function addFile(tenantId: string, data: { fileName: string; fileType: string; filePath: string; fileSize?: number; category?: string; description?: string; parsedData?: any; uploadSource?: string }) {
  const rows = await q(tenantId, buildInsert("files", {
    file_name: data.fileName,
    file_type: data.fileType,
    file_path: data.filePath,
    file_size: data.fileSize || 0,
    category: data.category || "autre",
    description: data.description || "",
    parsed_data: data.parsedData ? JSON.stringify(data.parsedData) : null,
    upload_source: data.uploadSource || "manual",
  }));
  return rows[0];
}

async function getFile(tenantId: string, id: number) {
  const rows = await q(tenantId, `SELECT * FROM __SCHEMA__.files WHERE id = ${id}`);
  return rows[0] || null;
}

async function deleteFile(tenantId: string, id: number) {
  const files = await q(tenantId, `SELECT * FROM __SCHEMA__.files WHERE id = ${id}`);
  if (files[0]?.file_path) {
    try { fs.unlinkSync(files[0].file_path); } catch {}
  }
  await q(tenantId, `DELETE FROM __SCHEMA__.files WHERE id = ${id}`);
}

async function getFileStats(tenantId: string) {
  const rows = await q(tenantId, `SELECT category, COUNT(*) as count, COALESCE(SUM(file_size), 0) as total_size FROM __SCHEMA__.files GROUP BY category ORDER BY count DESC`);
  const total = await q(tenantId, `SELECT COUNT(*) as count, COALESCE(SUM(file_size), 0) as total_size FROM __SCHEMA__.files`);
  return { categories: rows, total: total[0] || { count: 0, total_size: 0 } };
}

// ─── BANK STATEMENT PARSING (multi-tenant) ───
async function parseBankStatementForTenant(tenantId: string, filePath: string, fileName: string) {
  const { parseBankStatementPDF } = await import("./bankStatementParser");
  const result = await parseBankStatementPDF(filePath);

  if (!result.success || result.entries.length === 0) {
    return { success: false, error: "Impossible de parser le relevé bancaire", details: result.errors };
  }

  let imported = 0;
  for (const entry of result.entries) {
    try {
      await addBankEntry(tenantId, {
        bank_name: result.bankName || "Banque",
        entry_date: entry.entryDate,
        label: entry.label,
        amount: entry.amount,
        balance: entry.balance,
        category: entry.category,
        is_reconciled: false,
        notes: `Import auto: ${fileName}`,
      });
      imported++;
    } catch {}
  }

  await addFile(tenantId, {
    fileName,
    fileType: "bank_statement",
    filePath,
    category: "releve_bancaire",
    description: `Relevé ${result.bankName} — ${result.periodStart} à ${result.periodEnd}`,
    parsedData: { bankName: result.bankName, periodStart: result.periodStart, periodEnd: result.periodEnd, entriesCount: result.entries.length, imported },
    uploadSource: "parser",
  });

  console.log(`[COBA-Business] Bank statement parsed for tenant "${tenantId}": ${imported}/${result.entries.length} entries imported`);
  return { success: true, bankName: result.bankName, periodStart: result.periodStart, periodEnd: result.periodEnd, totalEntries: result.entries.length, imported, openingBalance: result.openingBalance, closingBalance: result.closingBalance };
}

// ─── PAYROLL PARSING (multi-tenant) ───
async function parsePayrollForTenant(tenantId: string, filePath: string, fileName: string) {
  const { parsePayrollPDF } = await import("./payrollParserService");
  const fileBuffer = fs.readFileSync(filePath);
  const result = await parsePayrollPDF(fileBuffer, fileName);

  if (!result || !result.success || !result.data) {
    return { success: false, error: "Impossible de parser le bulletin de paie", warnings: result?.warnings || [], errors: result?.errors || [] };
  }

  const pd = result.data;
  let employeeId: number | null = null;
  const existingEmployees = await listEmployees(tenantId, true);
  const match = existingEmployees.find((e: any) =>
    e.last_name?.toLowerCase() === pd.employee.lastName?.toLowerCase() &&
    e.first_name?.toLowerCase() === pd.employee.firstName?.toLowerCase()
  );

  if (match) {
    employeeId = match.id;
  } else {
    const newEmp = await addEmployee(tenantId, {
      first_name: pd.employee.firstName || "Inconnu",
      last_name: pd.employee.lastName || "Inconnu",
      role: pd.employee.role || "Employé",
      contract_type: pd.employee.contractType || "CDI",
      weekly_hours: pd.employee.weeklyHours || 35,
      start_date: pd.employee.startDate || new Date().toISOString().substring(0, 10),
      is_active: true,
    });
    employeeId = newEmp?.id;
  }

  if (employeeId) {
    await addPayroll(tenantId, {
      employee_id: employeeId,
      period: pd.period || new Date().toISOString().substring(0, 7),
      gross_salary: pd.grossSalary || 0,
      net_salary: pd.netSalary || 0,
      social_charges: pd.socialCharges || 0,
      employer_charges: pd.employerCharges || 0,
      total_employer_cost: pd.totalEmployerCost || 0,
      overtime: pd.overtimeHours || 0,
      is_paid: true,
    });
  }

  await addFile(tenantId, {
    fileName,
    fileType: "payroll",
    filePath,
    category: "bulletin_paie",
    description: `Bulletin ${pd.employee.firstName} ${pd.employee.lastName} — ${pd.period}`,
    parsedData: pd,
    uploadSource: "parser",
  });

  console.log(`[COBA-Business] Payroll parsed for tenant "${tenantId}": ${pd.employee.firstName} ${pd.employee.lastName} — ${pd.period}`);
  return { success: true, employee: `${pd.employee.firstName} ${pd.employee.lastName}`, period: pd.period, grossSalary: pd.grossSalary, netSalary: pd.netSalary, employeeId };
}

// ─── HUBRISE (multi-tenant) ───
const HUBRISE_API_BASE = "https://api.hubrise.com/v1";

async function getHubriseConfig(tenantId: string) {
  const rows = await q(tenantId, `SELECT * FROM __SCHEMA__.hubrise_config WHERE is_active = TRUE LIMIT 1`);
  return rows[0] || null;
}

async function setHubriseConfig(tenantId: string, config: { accessToken: string; accountId?: string; locationId?: string; catalogId?: string; customerListId?: string }) {
  const existing = await getHubriseConfig(tenantId);
  if (existing) {
    await q(tenantId, `UPDATE __SCHEMA__.hubrise_config SET access_token = ${esc(config.accessToken)}, account_id = ${esc(config.accountId || null)}, location_id = ${esc(config.locationId || null)}, catalog_id = ${esc(config.catalogId || null)}, customer_list_id = ${esc(config.customerListId || null)} WHERE id = ${existing.id}`);
  } else {
    await q(tenantId, buildInsert("hubrise_config", {
      access_token: config.accessToken,
      account_id: config.accountId || null,
      location_id: config.locationId || null,
      catalog_id: config.catalogId || null,
      customer_list_id: config.customerListId || null,
    }));
  }
  return { success: true, message: "HubRise configuré" };
}

async function syncHubriseOrders(tenantId: string) {
  const config = await getHubriseConfig(tenantId);
  if (!config) return { success: false, error: "HubRise non configuré pour ce tenant" };

  const token = config.access_token;
  const locationId = config.location_id;
  const accountId = config.account_id;

  const baseUrl = locationId
    ? `${HUBRISE_API_BASE}/locations/${locationId}`
    : `${HUBRISE_API_BASE}/accounts/${accountId}`;

  try {
    const res = await fetch(`${baseUrl}/orders?count=100`, {
      headers: { "X-Access-Token": token }
    });
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `HubRise API error: ${res.status} — ${err}` };
    }

    const orders = await res.json() as any[];
    let synced = 0;

    for (const order of orders) {
      const customerName = order.customer
        ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim()
        : "";
      const total = parseFloat(order.total || "0");

      try {
        await q(tenantId, `INSERT INTO __SCHEMA__.hubrise_orders (order_id, status, created_at_hr, total, service_type, channel, customer_name, items, payments, raw_data) VALUES (${esc(order.id)}, ${esc(order.status)}, ${esc(order.created_at)}, ${total}, ${esc(order.service_type || "")}, ${esc(order.channel || "")}, ${esc(customerName)}, ${esc(JSON.stringify(order.items || []))}, ${esc(JSON.stringify(order.payment || []))}, ${esc(JSON.stringify(order))}) ON CONFLICT (order_id) DO UPDATE SET status = EXCLUDED.status, total = EXCLUDED.total`);
        synced++;
      } catch {}
    }

    await q(tenantId, `UPDATE __SCHEMA__.hubrise_config SET last_sync_at = NOW() WHERE is_active = TRUE`);

    console.log(`[COBA-HubRise] Synced ${synced}/${orders.length} orders for tenant "${tenantId}"`);
    return { success: true, totalOrders: orders.length, synced };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

async function getHubriseOrdersSummary(tenantId: string, opts?: { from?: string; to?: string }) {
  let where = "WHERE 1=1";
  if (opts?.from) where += ` AND created_at_hr >= ${esc(opts.from)}`;
  if (opts?.to) where += ` AND created_at_hr <= ${esc(opts.to)}`;

  const orders = await q(tenantId, `SELECT * FROM __SCHEMA__.hubrise_orders ${where} ORDER BY created_at_hr DESC LIMIT 500`);

  const totalRevenue = orders.reduce((s: number, o: any) => s + (o.total || 0), 0);
  const avgTicket = orders.length > 0 ? totalRevenue / orders.length : 0;
  const byChannel: Record<string, { count: number; revenue: number }> = {};
  const byServiceType: Record<string, { count: number; revenue: number }> = {};

  for (const o of orders) {
    const ch = o.channel || "direct";
    if (!byChannel[ch]) byChannel[ch] = { count: 0, revenue: 0 };
    byChannel[ch].count++;
    byChannel[ch].revenue += o.total || 0;

    const st = o.service_type || "unknown";
    if (!byServiceType[st]) byServiceType[st] = { count: 0, revenue: 0 };
    byServiceType[st].count++;
    byServiceType[st].revenue += o.total || 0;
  }

  return { totalOrders: orders.length, totalRevenue, avgTicket, byChannel, byServiceType, recentOrders: orders.slice(0, 20) };
}

async function listHubriseOrders(tenantId: string, opts?: { limit?: number; from?: string; to?: string }) {
  let where = "WHERE 1=1";
  if (opts?.from) where += ` AND created_at_hr >= ${esc(opts.from)}`;
  if (opts?.to) where += ` AND created_at_hr <= ${esc(opts.to)}`;
  const limit = opts?.limit || 100;
  return q(tenantId, `SELECT * FROM __SCHEMA__.hubrise_orders ${where} ORDER BY created_at_hr DESC LIMIT ${limit}`);
}

// ─── PER-TENANT CHAT HISTORY (30-day retention) ───
async function saveChatMessage(tenantId: string, sessionId: string, proUserId: string, proUserName: string | undefined, role: string, content: string, toolCalls?: any, toolResults?: any, tokensUsed?: number) {
  const sn = await ensureTenantSchema(tenantId);
  await db.execute(sql.raw(`
    INSERT INTO "${sn}".chat_history (session_id, pro_user_id, pro_user_name, role, content, tool_calls, tool_results, tokens_used)
    VALUES (${esc(sessionId)}, ${esc(proUserId)}, ${esc(proUserName || '')}, ${esc(role)}, ${esc(content)}, ${toolCalls ? `'${JSON.stringify(toolCalls).replace(/'/g, "''")}'::jsonb` : 'NULL'}, ${toolResults ? `'${JSON.stringify(toolResults).replace(/'/g, "''")}'::jsonb` : 'NULL'}, ${tokensUsed || 0})
  `));
}

async function getChatHistory(tenantId: string, sessionId: string, limit = 30): Promise<any[]> {
  return q(tenantId, `SELECT id, session_id, pro_user_id, pro_user_name, role, content, tokens_used, created_at FROM __SCHEMA__.chat_history WHERE session_id = ${esc(sessionId)} ORDER BY created_at DESC LIMIT ${limit}`).then(rows => rows.reverse());
}

async function getChatHistoryForUser(tenantId: string, proUserId: string, limit = 50): Promise<any[]> {
  return q(tenantId, `SELECT id, session_id, role, content, created_at FROM __SCHEMA__.chat_history WHERE pro_user_id = ${esc(proUserId)} ORDER BY created_at DESC LIMIT ${limit}`).then(rows => rows.reverse());
}

async function getRecentChatContext(tenantId: string, proUserId: string, limit = 10): Promise<string> {
  const rows = await q(tenantId, `SELECT role, content, created_at FROM __SCHEMA__.chat_history WHERE pro_user_id = ${esc(proUserId)} AND created_at > NOW() - INTERVAL '7 days' ORDER BY created_at DESC LIMIT ${limit}`);
  if (rows.length === 0) return "";
  rows.reverse();
  return rows.map((r: any) => `[${r.role === 'user' ? 'CLIENT' : 'COBA'}] ${(r.content || '').slice(0, 300)}`).join("\n");
}

async function getChatStats(tenantId: string): Promise<any> {
  const rows = await q(tenantId, `
    SELECT 
      COUNT(*) as total_messages,
      COUNT(DISTINCT session_id) as total_sessions,
      COUNT(DISTINCT pro_user_id) as total_users,
      COALESCE(SUM(tokens_used), 0) as total_tokens,
      MIN(created_at) as first_message,
      MAX(created_at) as last_message,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as messages_7d,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as messages_24h
    FROM __SCHEMA__.chat_history
  `);
  return rows[0] || {};
}

async function cleanupOldChatHistory(retentionDays = 30): Promise<{ tenantsProcessed: number; messagesDeleted: number }> {
  const schemas = await db.execute(sql.raw(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE '${SCHEMA_PREFIX}%' ORDER BY schema_name`
  ));
  let totalDeleted = 0;
  let processed = 0;
  for (const row of (schemas.rows || schemas) as any[]) {
    const sn = row.schema_name;
    try {
      const tableCheck = await db.execute(sql.raw(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = '${sn}' AND table_name = 'chat_history' LIMIT 1`
      ));
      if (((tableCheck.rows || tableCheck) as any[]).length === 0) continue;
      const result = await db.execute(sql.raw(
        `DELETE FROM "${sn}".chat_history WHERE created_at < NOW() - INTERVAL '${retentionDays} days'`
      ));
      const deleted = (result as any).rowCount || 0;
      if (deleted > 0) {
        totalDeleted += deleted;
        console.log(`[COBA-ChatCleanup] ${sn}: ${deleted} messages deleted (>${retentionDays}d)`);
      }
      processed++;
    } catch (e: any) {
      console.error(`[COBA-ChatCleanup] Error on ${sn}:`, e.message);
    }
  }
  return { tenantsProcessed: processed, messagesDeleted: totalDeleted };
}

export const cobaBusinessService = {
  ensureTenantSchema,
  listPurchases, addPurchase, updatePurchase, deletePurchase,
  listExpenses, addExpense, updateExpense, deleteExpense,
  listBankEntries, addBankEntry, updateBankEntry, deleteBankEntry,
  listLoans, addLoan, updateLoan, deleteLoan,
  listCashEntries, addCashEntry, updateCashEntry, deleteCashEntry,
  listEmployees, addEmployee, updateEmployee, deleteEmployee,
  listPayroll, addPayroll, updatePayroll,
  listSuppliers, addSupplier, updateSupplier, deleteSupplier,
  listAbsences, addAbsence, updateAbsence, deleteAbsence,
  getAuditOverview,
  getFinancialSynthesis,
  getAllTenantsOverview,
  listRegisteredTenants,
  listFiles, getFile, addFile, deleteFile, getFileStats,
  parseBankStatementForTenant, parsePayrollForTenant,
  tenantUploadDir,
  getHubriseConfig, setHubriseConfig, syncHubriseOrders, getHubriseOrdersSummary, listHubriseOrders,
  saveChatMessage, getChatHistory, getChatHistoryForUser, getRecentChatContext, getChatStats, cleanupOldChatHistory,
};
