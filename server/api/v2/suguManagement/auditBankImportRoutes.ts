import { Router, Request, Response } from "express";
import multer from "multer";
import { hybridUpload } from "../../../middleware/base64Upload";
import { db } from "../../../db";
import {
    suguPurchases, suguExpenses, suguBankEntries,
    suguCashRegister, suguPayroll, suguEmployees,
    suguLoans, suguFiles, insertSuguBankEntrySchema,
} from "@shared/schema";
import { eq, desc, sql, and, gte, lte } from "drizzle-orm";
import { emitSuguBankUpdated, emitSuguFilesUpdated } from "../../../services/realtimeSync";
import { parseBankStatementPDF, parseBankStatementText, parseBankStatementCSV } from "../../../services/bankStatementParser";
import { tablesReady, importStatusMap, uploadToObjectStorage } from "./shared";

const router = Router();

// ============ AUDIT / DASHBOARD ============

router.get("/audit/overview", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        let requestedYear = req.query.year as string || new Date().getFullYear().toString();

        const availableYearsResult = await db.execute(sql`
            SELECT DISTINCT y FROM (
                SELECT LEFT(${suguPurchases.invoiceDate}, 4) AS y FROM ${suguPurchases} WHERE ${suguPurchases.invoiceDate} IS NOT NULL
                UNION SELECT LEFT(${suguExpenses.period}, 4) AS y FROM ${suguExpenses} WHERE ${suguExpenses.period} IS NOT NULL
                UNION SELECT LEFT(${suguCashRegister.entryDate}, 4) AS y FROM ${suguCashRegister} WHERE ${suguCashRegister.entryDate} IS NOT NULL
                UNION SELECT LEFT(${suguPayroll.period}, 4) AS y FROM ${suguPayroll} WHERE ${suguPayroll.period} IS NOT NULL
                UNION SELECT LEFT(${suguBankEntries.entryDate}, 4) AS y FROM ${suguBankEntries} WHERE ${suguBankEntries.entryDate} IS NOT NULL
            ) sub WHERE y IS NOT NULL AND y != '' ORDER BY y DESC
        `);
        const currentYearStr = new Date().getFullYear().toString();
        const availableYears = [...new Set([
            ...(availableYearsResult.rows as any[]).map((r: any) => r.y).filter(Boolean),
            currentYearStr
        ])].sort((a, b) => Number(b) - Number(a));

        const year = requestedYear;

        const useAllData = req.query.all === 'true';

        const [purchases, expenses, cashEntries, payrolls, employees, loans, bankEntries] = await Promise.all([
            useAllData
                ? db.select().from(suguPurchases)
                : db.select().from(suguPurchases).where(sql`${suguPurchases.invoiceDate} LIKE ${year + '%'}`),
            useAllData
                ? db.select().from(suguExpenses)
                : db.select().from(suguExpenses).where(sql`${suguExpenses.period} LIKE ${year + '%'}`),
            useAllData
                ? db.select().from(suguCashRegister)
                : db.select().from(suguCashRegister).where(sql`${suguCashRegister.entryDate} LIKE ${year + '%'}`),
            useAllData
                ? db.select().from(suguPayroll)
                : db.select().from(suguPayroll).where(sql`${suguPayroll.period} LIKE ${year + '%'}`),
            db.select().from(suguEmployees).where(eq(suguEmployees.isActive, true)),
            db.select().from(suguLoans),
            useAllData
                ? db.select().from(suguBankEntries)
                : db.select().from(suguBankEntries).where(sql`${suguBankEntries.entryDate} LIKE ${year + '%'}`),
        ]);

        const totalRevenue = cashEntries.reduce((s: number, e: any) => s + Number(e.totalRevenue || 0), 0);
        const totalPurchases = purchases.reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
        const totalExpenses = expenses.reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
        const totalPayroll = payrolls.reduce((s: number, e: any) => s + Number(e.grossSalary || 0), 0);
        const totalSocialCharges = payrolls.reduce((s: number, e: any) => s + Number(e.socialCharges || 0), 0);
        const totalLoanPayments = loans.reduce((s: number, l: any) => s + Number(l.monthlyPayment || 0) * 12, 0);
        const totalBankDebits = bankEntries.filter((e: any) => Number(e.amount) < 0).reduce((s: number, e: any) => s + Math.abs(Number(e.amount)), 0);
        const totalBankCredits = bankEntries.filter((e: any) => Number(e.amount) > 0).reduce((s: number, e: any) => s + Number(e.amount), 0);
        console.log(`[SUGU-AUDIT] year=${year} (requested=${requestedYear}) purchases=${purchases.length}(${totalPurchases}) expenses=${expenses.length}(${totalExpenses}) payroll=${payrolls.length}(${totalPayroll}) bank=${bankEntries.length} cash=${cashEntries.length}(${totalRevenue}) availableYears=${availableYears.join(',')}`);

        const totalCosts = totalPurchases + totalExpenses + totalPayroll + totalSocialCharges + totalLoanPayments;
        const operatingProfit = totalRevenue - totalCosts;
        const profitMargin = totalRevenue > 0 ? (operatingProfit / totalRevenue) * 100 : 0;

        const totalTVA10 = cashEntries.reduce((s: number, e: any) => s + Number(e.coversCount || 0), 0);
        const totalTVA20 = cashEntries.reduce((s: number, e: any) => s + Number(e.averageTicket || 0), 0);
        const operatingDays = cashEntries.length;

        const monthlyRevenue: Record<string, number> = {};
        for (const e of cashEntries) {
            const month = e.entryDate.substring(0, 7);
            monthlyRevenue[month] = (monthlyRevenue[month] || 0) + e.totalRevenue;
        }

        const monthlyCosts: Record<string, number> = {};
        for (const p of purchases) {
            const month = (p as any).invoiceDate?.substring(0, 7);
            if (month) monthlyCosts[month] = (monthlyCosts[month] || 0) + Number((p as any).amount || 0);
        }
        for (const e of expenses) {
            const month = (e as any).period?.substring(0, 7);
            if (month) monthlyCosts[month] = (monthlyCosts[month] || 0) + Number((e as any).amount || 0);
        }

        const costBreakdown = {
            achats: totalPurchases,
            fraisGeneraux: totalExpenses,
            salaires: totalPayroll,
            chargesSociales: totalSocialCharges,
            emprunts: totalLoanPayments,
        };

        const unpaidPurchases = purchases.filter((p: any) => !p.isPaid).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
        const unpaidExpenses = expenses.filter((e: any) => !e.isPaid).reduce((s: number, e: any) => s + Number(e.amount || 0), 0);

        const topSuppliers: Record<string, number> = {};
        for (const p of purchases) {
            const supplier = (p as any).supplier || 'Inconnu';
            topSuppliers[supplier] = (topSuppliers[supplier] || 0) + Number((p as any).amount || 0);
        }
        const sortedSuppliers = Object.entries(topSuppliers).sort((a, b) => b[1] - a[1]).slice(0, 10);

        res.json({
            year,
            requestedYear,
            availableYears,
            totalRevenue,
            totalCosts,
            operatingProfit,
            profitMargin: profitMargin.toFixed(1),
            totalTVA10,
            totalTVA20,
            totalCovers: totalTVA10,
            operatingDays,
            avgDailyRevenue: operatingDays > 0 ? totalRevenue / operatingDays : 0,
            avgTicket: 0,
            activeEmployees: employees.length,
            costBreakdown,
            monthlyRevenue,
            monthlyCosts,
            unpaidPurchases,
            unpaidExpenses,
            totalRemainingLoans: loans.reduce((s: number, l: any) => s + Number(l.remainingAmount || 0), 0),
            totalBankDebits,
            totalBankCredits,
            bankEntriesCount: bankEntries.length,
            purchasesCount: purchases.length,
            expensesCount: expenses.length,
            topSuppliers: sortedSuppliers.map(([name, total]) => ({ name, total })),
        });
    } catch (error) {
        console.error("[SUGU] Error fetching audit overview:", error);
        res.status(500).json({ error: "Failed to fetch audit" });
    }
});

// ============ ANOMALY DETECTION ============

// GET /anomalies — Detect financial anomalies (unpaid invoices, unmatched debits, missing cash days, outlier amounts)
router.get("/anomalies", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const days = parseInt(req.query.days as string) || 30;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffStr = cutoff.toISOString().substring(0, 10);

        const [bankEntries, purchases, payrolls, cashEntries] = await Promise.all([
            db.select().from(suguBankEntries).orderBy(desc(suguBankEntries.entryDate)),
            db.select().from(suguPurchases),
            db.select().from(suguPayroll),
            db.select().from(suguCashRegister).orderBy(desc(suguCashRegister.entryDate)),
        ]);

        const recentBank = bankEntries.filter((e: any) => e.entryDate >= cutoffStr);
        const anomalies: Array<{ type: string; severity: string; description: string }> = [];

        // 1. Old unpaid invoices (>30 days)
        const oldUnpaid = purchases.filter((p: any) => {
            if (p.isPaid) return false;
            const inv = p.invoiceDate;
            if (!inv) return false;
            const daysDiff = Math.floor((Date.now() - new Date(inv).getTime()) / 86400000);
            return daysDiff > 30;
        });
        for (const p of oldUnpaid as any[]) {
            const daysDiff = Math.floor((Date.now() - new Date(p.invoiceDate).getTime()) / 86400000);
            anomalies.push({
                type: "facture_impayee_ancienne",
                severity: daysDiff > 60 ? "haute" : "moyenne",
                description: `Facture ${p.supplier || 'inconnu'} du ${p.invoiceDate}: ${p.amount}€ impayée depuis ${daysDiff} jours`
            });
        }

        // 2. Large bank debits without matching purchase
        const purchaseAmounts = new Set(purchases.map((p: any) => Math.abs(p.amount).toFixed(2)));
        const largeBankDebits = recentBank.filter((e: any) => e.amount < -200 && e.category === 'achat_fournisseur');
        for (const e of largeBankDebits as any[]) {
            const absAmount = Math.abs(e.amount).toFixed(2);
            if (!purchaseAmounts.has(absAmount)) {
                anomalies.push({
                    type: "debit_sans_facture",
                    severity: "moyenne",
                    description: `Débit bancaire ${e.entryDate} de ${e.amount}€ (${e.label?.substring(0, 40)}) sans facture correspondante`
                });
            }
        }

        // 3. Cash register gaps (missing days in last N)
        const cashDates = new Set(cashEntries.filter((c: any) => c.entryDate >= cutoffStr).map((c: any) => c.entryDate));
        const today = new Date();
        let missingDays = 0;
        for (let d = new Date(cutoff); d <= today; d.setDate(d.getDate() + 1)) {
            const dow = d.getDay();
            if (dow === 0) continue; // skip Sunday
            const ds = d.toISOString().substring(0, 10);
            if (!cashDates.has(ds) && ds < today.toISOString().substring(0, 10)) missingDays++;
        }
        if (missingDays > 3) {
            anomalies.push({
                type: "jours_caisse_manquants",
                severity: missingDays > 7 ? "haute" : "moyenne",
                description: `${missingDays} jours sans écriture de caisse sur les ${days} derniers jours (hors dimanche)`
            });
        }

        // 4. Unusually high single transactions
        const avgAbsAmount = recentBank.length > 0
            ? recentBank.reduce((s: number, e: any) => s + Math.abs(Number(e.amount || 0)), 0) / recentBank.length
            : 500;
        const threshold = avgAbsAmount * 5;
        const outliers = recentBank.filter((e: any) => Math.abs(e.amount) > threshold && Math.abs(e.amount) > 2000);
        for (const e of outliers as any[]) {
            anomalies.push({
                type: "montant_inhabituel",
                severity: "info",
                description: `Écriture ${e.entryDate}: ${e.amount}€ (${e.label?.substring(0, 40)}) — montant significativement au-dessus de la moyenne (${avgAbsAmount.toFixed(0)}€)`
            });
        }

        res.json({
            success: true,
            période: `${days} derniers jours`,
            totalAnomalies: anomalies.length,
            parSévérité: {
                haute: anomalies.filter(a => a.severity === "haute").length,
                moyenne: anomalies.filter(a => a.severity === "moyenne").length,
                info: anomalies.filter(a => a.severity === "info").length,
            },
            anomalies,
        });
    } catch (error) {
        console.error("[SUGU] Error detecting anomalies:", error);
        res.status(500).json({ error: "Failed to detect anomalies" });
    }
});

// ============ BANK STATEMENT PDF IMPORT ============

// POST /bank/import-pdf — Upload PDF and parse + import bank entries
router.post("/bank/import-pdf", hybridUpload({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }), async (req: Request, res: Response) => {
    try {
        const file = (req as any).file;
        if (!file) {
            return res.status(400).json({ error: "No PDF file provided" });
        }

        console.log(`[SUGU] Bank PDF import: ${file.originalname} (${(file.size / 1024).toFixed(0)} KB)`);

        const result = await parseBankStatementPDF(file.buffer);

        if (!result.success || result.entries.length === 0) {
            return res.status(400).json({
                error: "Aucune opération trouvée dans ce PDF",
                details: result.errors,
            });
        }

        // Replace mode: delete existing entries for the period and re-import all
        const replaceMode = req.query.replace === "true";

        const existingEntries = await db.select()
            .from(suguBankEntries)
            .where(
                and(
                    gte(suguBankEntries.entryDate, result.periodStart),
                    lte(suguBankEntries.entryDate, result.periodEnd)
                )
            );

        if (replaceMode && existingEntries.length > 0) {
            await db.delete(suguBankEntries).where(
                and(
                    gte(suguBankEntries.entryDate, result.periodStart),
                    lte(suguBankEntries.entryDate, result.periodEnd)
                )
            );
            console.log(`[SUGU] Replace mode: deleted ${existingEntries.length} entries for ${result.periodStart}→${result.periodEnd}`);
        }

        let newEntries = result.entries;
        let skippedCount = 0;

        if (!replaceMode) {
            const existingSet = new Set(
                existingEntries.map((e: any) => `${e.entryDate}|${e.amount}|${e.label?.substring(0, 30)}`)
            );
            newEntries = result.entries.filter(e =>
                !existingSet.has(`${e.entryDate}|${e.amount}|${e.label.substring(0, 30)}`)
            );
            skippedCount = result.entries.length - newEntries.length;

            if (newEntries.length === 0) {
                return res.json({
                    success: true,
                    message: `Les ${result.entries.length} opérations de ce relevé existent déjà en base`,
                    imported: 0,
                    skipped: result.entries.length,
                    period: `${result.periodStart} → ${result.periodEnd}`,
                    hasExisting: true,
                });
            }
        }

        // Insert entries
        const inserted = await db.insert(suguBankEntries).values(
            newEntries.map(e => ({
                bankName: result.bankName,
                entryDate: e.entryDate,
                label: e.label,
                amount: e.amount,
                balance: e.balance,
                category: e.category,
                isReconciled: false,
                notes: `Import PDF ${file.originalname}`,
            }))
        ).returning();

        console.log(`[SUGU] Imported ${inserted.length} bank entries (${skippedCount} skipped${replaceMode ? ", replace mode" : ""})`);

        res.json({
            success: true,
            message: `${inserted.length} opérations importées avec succès`,
            imported: inserted.length,
            skipped: result.entries.length - newEntries.length,
            total: result.entries.length,
            period: `${result.periodStart} → ${result.periodEnd}`,
            bankName: result.bankName,
            totalDebits: result.totalDebits,
            totalCredits: result.totalCredits,
            openingBalance: result.openingBalance,
            closingBalance: result.closingBalance,
        });
        emitSuguBankUpdated();
    } catch (error) {
        console.error("[SUGU] PDF import error:", error);
        res.status(500).json({ error: "Erreur lors de l'import du relevé bancaire" });
    }
});

// POST /bank/import-csv — Upload CSV and parse + import bank entries
router.post("/bank/import-csv", hybridUpload({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }), async (req: Request, res: Response) => {
    try {
        const file = (req as any).file;
        if (!file) {
            return res.status(400).json({ error: "No CSV file provided" });
        }

        console.log(`[SUGU] Bank CSV import: ${file.originalname} (${(file.size / 1024).toFixed(0)} KB)`);

        const csvText = file.buffer.toString("utf-8");
        const result = parseBankStatementCSV(csvText);

        if (!result.success || result.entries.length === 0) {
            return res.status(400).json({
                error: "Aucune opération trouvée dans ce CSV",
                details: result.errors,
            });
        }

        // Check for duplicates by date range
        const existingEntries = await db.select()
            .from(suguBankEntries)
            .where(
                and(
                    gte(suguBankEntries.entryDate, result.periodStart),
                    lte(suguBankEntries.entryDate, result.periodEnd)
                )
            );

        const existingSet = new Set(
            existingEntries.map((e: any) => `${e.entryDate}|${e.amount}|${e.label?.substring(0, 30)}`)
        );

        const newEntries = result.entries.filter(e =>
            !existingSet.has(`${e.entryDate}|${e.amount}|${e.label.substring(0, 30)}`)
        );

        if (newEntries.length === 0) {
            return res.json({
                success: true,
                message: `Les ${result.entries.length} opérations de ce relevé existent déjà en base`,
                imported: 0,
                skipped: result.entries.length,
                period: `${result.periodStart} → ${result.periodEnd}`,
            });
        }

        // Insert new entries
        const inserted = await db.insert(suguBankEntries).values(
            newEntries.map(e => ({
                bankName: result.bankName,
                entryDate: e.entryDate,
                label: e.label,
                amount: e.amount,
                balance: e.balance,
                category: e.category,
                isReconciled: false,
                notes: `Import CSV ${file.originalname}`,
            }))
        ).returning();

        console.log(`[SUGU] CSV Imported ${inserted.length} bank entries (${result.entries.length - newEntries.length} skipped as duplicates)`);

        res.json({
            success: true,
            message: `${inserted.length} opérations importées avec succès`,
            imported: inserted.length,
            skipped: result.entries.length - newEntries.length,
            total: result.entries.length,
            period: `${result.periodStart} → ${result.periodEnd}`,
            bankName: result.bankName,
            totalDebits: result.totalDebits,
            totalCredits: result.totalCredits,
            openingBalance: result.openingBalance,
            closingBalance: result.closingBalance,
        });
        emitSuguBankUpdated();
    } catch (error) {
        console.error("[SUGU] CSV import error:", error);
        res.status(500).json({ error: "Erreur lors de l'import du relevé CSV" });
    }
});

// POST /bank/import-text — Parse copy-pasted text and import
router.post("/bank/import-text", async (req: Request, res: Response) => {
    try {
        const { text } = req.body;
        if (!text || text.length < 50) {
            return res.status(400).json({ error: "Texte trop court ou vide" });
        }

        console.log(`[SUGU] Bank text import: ${text.length} chars`);

        const result = parseBankStatementText(text);

        if (!result.success || result.entries.length === 0) {
            return res.status(400).json({
                error: "Aucune opération trouvée dans ce texte",
                details: result.errors,
            });
        }

        // Check for duplicates
        const minDate = result.entries[0].entryDate;
        const maxDate = result.entries[result.entries.length - 1].entryDate;

        const existingEntries = await db.select()
            .from(suguBankEntries)
            .where(and(
                gte(suguBankEntries.entryDate, minDate),
                lte(suguBankEntries.entryDate, maxDate)
            ));

        const existingSet = new Set(
            existingEntries.map((e: any) => `${e.entryDate}|${e.amount}|${e.label?.substring(0, 30)}`)
        );

        const newEntries = result.entries.filter(e =>
            !existingSet.has(`${e.entryDate}|${e.amount}|${e.label.substring(0, 30)}`)
        );

        if (newEntries.length === 0) {
            return res.json({
                success: true,
                message: `Les ${result.entries.length} opérations existent déjà`,
                imported: 0,
                skipped: result.entries.length,
            });
        }

        const inserted = await db.insert(suguBankEntries).values(
            newEntries.map(e => ({
                bankName: result.bankName || "Société Générale",
                entryDate: e.entryDate,
                label: e.label,
                amount: e.amount,
                balance: e.balance,
                category: e.category,
                isReconciled: false,
                notes: "Import texte copié-collé",
            }))
        ).returning();

        console.log(`[SUGU] Text import: ${inserted.length} entries (${result.entries.length - newEntries.length} dupes skipped)`);

        res.json({
            success: true,
            message: `${inserted.length} opérations importées`,
            imported: inserted.length,
            skipped: result.entries.length - newEntries.length,
            total: result.entries.length,
            period: `${result.periodStart} → ${result.periodEnd}`,
            totalDebits: result.totalDebits,
            totalCredits: result.totalCredits,
        });
        emitSuguBankUpdated();
    } catch (error) {
        console.error("[SUGU] Text import error:", error);
        res.status(500).json({ error: "Erreur lors de l'import texte" });
    }
});

// GET /bank/import-preview — Preview parsed PDF without importing (dry run)
router.post("/bank/import-preview", hybridUpload({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }), async (req: Request, res: Response) => {
    try {
        const file = (req as any).file;
        if (!file) {
            return res.status(400).json({ error: "No PDF file provided" });
        }

        const result = await parseBankStatementPDF(file.buffer);
        res.json(result);
    } catch (error) {
        console.error("[SUGU] Preview error:", error);
        res.status(500).json({ error: "Erreur lors de l'analyse du PDF" });
    }
});


export default router;
