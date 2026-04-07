import { Router, Request, Response } from "express";
import { db } from "../../../db";
import {
    suguPurchases, suguExpenses, suguFiles,
    suguCashRegister, suguPayroll, suguBankEntries,
    suguEmployees, suguLoans, suguAbsences,
    suguSuppliers, insertSuguSupplierSchema,
    suguBackups,
} from "@shared/schema";
import { eq, desc, sql, and, gte, lte } from "drizzle-orm";
import { suguFinancialLimiter } from "../../../middleware/security";
import { hubriseService } from "../../../services/hubriseService";
import { uploadToObjectStorage, downloadFromObjectStorage, tablesReady } from "./shared";

const router = Router();

router.get("/suppliers", async (_req: Request, res: Response) => {
    try {
        const data = await db.select().from(suguSuppliers).orderBy(desc(suguSuppliers.name));
        res.json(data);
    } catch (error: any) {
        console.error("[SUGU] Error fetching suppliers:", error?.message);
        res.json([]);
    }
});

router.get("/suppliers/:id", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const [supplier] = await db.select().from(suguSuppliers).where(eq(suguSuppliers.id, id));
        if (!supplier) return res.status(404).json({ error: "Fournisseur introuvable" });

        const purchases = await db.select().from(suguPurchases).where(eq(suguPurchases.supplierId, id)).orderBy(desc(suguPurchases.invoiceDate));
        const expenses = await db.select().from(suguExpenses).where(eq(suguExpenses.supplierId, id)).orderBy(desc(suguExpenses.dueDate));

        res.json({ ...supplier, purchases, expenses });
    } catch (error: any) {
        console.error("[SUGU] Error fetching supplier:", error?.message);
        res.status(500).json({ error: "Erreur serveur" });
    }
});

router.post("/suppliers", async (req: Request, res: Response) => {
    try {
        const body = req.body || {};
        const values = {
            name: body.name || "Sans nom",
            shortName: body.shortName || null,
            siret: body.siret || null,
            tvaNumber: body.tvaNumber || null,
            accountNumber: body.accountNumber || null,
            address: body.address || null,
            city: body.city || null,
            postalCode: body.postalCode || null,
            phone: body.phone || null,
            email: body.email || null,
            website: body.website || null,
            contactName: body.contactName || null,
            category: body.category || "autre",
            paymentTerms: body.paymentTerms || null,
            defaultPaymentMethod: body.defaultPaymentMethod || null,
            bankIban: body.bankIban || null,
            bankBic: body.bankBic || null,
            notes: body.notes || null,
            isActive: body.isActive !== false,
        };
        const [result] = await db.insert(suguSuppliers).values(values).returning();
        console.log(`[SUGU] Created supplier: ${result.name} (#${result.id})`);
        res.json(result);
    } catch (error: any) {
        console.error("[SUGU] Error creating supplier:", error?.message);
        res.status(500).json({ error: "Erreur création fournisseur" });
    }
});

router.put("/suppliers/:id", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const body = req.body || {};
        const updates: Record<string, any> = {};
        const fields = ["name", "shortName", "siret", "tvaNumber", "accountNumber", "address", "city", "postalCode", "phone", "email", "website", "contactName", "category", "paymentTerms", "defaultPaymentMethod", "bankIban", "bankBic", "notes", "isActive"];
        for (const f of fields) {
            if (body[f] !== undefined) updates[f] = body[f];
        }
        if (Object.keys(updates).length === 0) return res.status(400).json({ error: "Rien à mettre à jour" });

        const [result] = await db.update(suguSuppliers).set(updates).where(eq(suguSuppliers.id, id)).returning();
        if (!result) return res.status(404).json({ error: "Fournisseur introuvable" });
        console.log(`[SUGU] Updated supplier #${id}: ${result.name}`);
        res.json(result);
    } catch (error: any) {
        console.error("[SUGU] Error updating supplier:", error?.message);
        res.status(500).json({ error: "Erreur mise à jour fournisseur" });
    }
});

router.delete("/suppliers/:id", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        await db.delete(suguSuppliers).where(eq(suguSuppliers.id, id));
        console.log(`[SUGU] Deleted supplier #${id}`);
        res.json({ success: true });
    } catch (error: any) {
        console.error("[SUGU] Error deleting supplier:", error?.message);
        res.status(500).json({ error: "Erreur suppression fournisseur" });
    }
});

router.get("/suppliers/:id/stats", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const purchases = await db.select().from(suguPurchases).where(eq(suguPurchases.supplierId, id));
        const expenses = await db.select().from(suguExpenses).where(eq(suguExpenses.supplierId, id));

        const totalPurchases = purchases.reduce((s, p) => s + Number(p.amount || 0), 0);
        const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
        const unpaidPurchases = purchases.filter(p => !p.isPaid).reduce((s, p) => s + Number(p.amount || 0), 0);
        const unpaidExpenses = expenses.filter(e => !e.isPaid).reduce((s, e) => s + Number(e.amount || 0), 0);

        res.json({
            totalPurchases,
            totalExpenses,
            totalAll: totalPurchases + totalExpenses,
            unpaidPurchases,
            unpaidExpenses,
            unpaidAll: unpaidPurchases + unpaidExpenses,
            purchaseCount: purchases.length,
            expenseCount: expenses.length,
        });
    } catch (error: any) {
        console.error("[SUGU] Error fetching supplier stats:", error?.message);
        res.status(500).json({ error: "Erreur statistiques fournisseur" });
    }
});




// ============ ANALYTICS / EXPERT COMPTABLE ============

router.get("/analytics/tva", async (req: Request, res: Response) => {
    try {
        const year = req.query.year as string;
        const from = req.query.from as string;
        const to = req.query.to as string;
        if (!year && !from) return res.status(400).json({ error: "Year or from/to is required" });

        const useRange = !!from && !!to;
        const dateFilter = (col: any) => useRange
            ? sql`${col} >= ${from} AND ${col} <= ${to}`
            : sql`SUBSTRING(${col}, 1, 4) = ${year}`;

        const purchases = await db.select().from(suguPurchases).where(dateFilter(suguPurchases.invoiceDate));
        const expenses = await db.select().from(suguExpenses).where(dateFilter(suguExpenses.period));
        const cashEntries = await db.select().from(suguCashRegister).where(dateFilter(suguCashRegister.entryDate));

        const monthSet = new Set<string>();
        if (useRange) {
            const startY = parseInt(from.slice(0, 4)), startM = parseInt(from.slice(5, 7));
            const endY = parseInt(to.slice(0, 4)), endM = parseInt(to.slice(5, 7));
            for (let y = startY; y <= endY; y++) {
                const mStart = y === startY ? startM : 1;
                const mEnd = y === endY ? endM : 12;
                for (let m = mStart; m <= mEnd; m++) monthSet.add(`${y}-${m.toString().padStart(2, '0')}`);
            }
        } else {
            for (let i = 1; i <= 12; i++) monthSet.add(`${year}-${i.toString().padStart(2, '0')}`);
        }
        const months = Array.from(monthSet).sort();

        const monthly = months.map(monthStr => {
            const deductible = [...purchases, ...expenses]
                .filter(item => {
                    const date = 'invoiceDate' in item ? item.invoiceDate : item.period;
                    return date?.startsWith(monthStr);
                })
                .reduce((sum, item) => sum + Number(item.taxAmount || 0), 0);
            const collectee = cashEntries
                .filter(e => e.entryDate.startsWith(monthStr))
                .reduce((sum, e) => sum + Number(e.totalRevenue || 0) * 0.10, 0);
            return { month: monthStr, deductible, collectee, solde: collectee - deductible };
        });

        const annual = monthly.reduce((acc, m) => ({
            deductible: acc.deductible + m.deductible,
            collectee: acc.collectee + m.collectee,
            solde: acc.solde + m.solde
        }), { deductible: 0, collectee: 0, solde: 0 });

        res.json({ year: year || "all", annual, monthly });
    } catch (error: any) {
        console.error("[SUGU] TVA Analytics error:", error);
        res.status(500).json({ error: "Failed to fetch TVA analytics" });
    }
});

router.get("/analytics/ratios", async (req: Request, res: Response) => {
    try {
        const year = req.query.year as string;
        const from = req.query.from as string;
        const to = req.query.to as string;
        if (!year && !from) return res.status(400).json({ error: "Year or from/to is required" });

        const useRange = !!from && !!to;
        const dateFilter = (col: any) => useRange
            ? sql`${col} >= ${from} AND ${col} <= ${to}`
            : sql`SUBSTRING(${col}, 1, 4) = ${year}`;

        const cashEntries = await db.select().from(suguCashRegister).where(dateFilter(suguCashRegister.entryDate));
        const purchases = await db.select().from(suguPurchases).where(dateFilter(suguPurchases.invoiceDate));
        const payroll = await db.select().from(suguPayroll).where(dateFilter(suguPayroll.period));
        const expenses = await db.select().from(suguExpenses).where(dateFilter(suguExpenses.period));

        const monthSet = new Set<string>();
        if (useRange) {
            const startY = parseInt(from.slice(0, 4)), startM = parseInt(from.slice(5, 7));
            const endY = parseInt(to.slice(0, 4)), endM = parseInt(to.slice(5, 7));
            for (let y = startY; y <= endY; y++) {
                const mStart = y === startY ? startM : 1;
                const mEnd = y === endY ? endM : 12;
                for (let m = mStart; m <= mEnd; m++) monthSet.add(`${y}-${m.toString().padStart(2, '0')}`);
            }
        } else {
            for (let i = 1; i <= 12; i++) monthSet.add(`${year}-${i.toString().padStart(2, '0')}`);
        }
        const months = Array.from(monthSet).sort();

        const monthly = months.map(monthStr => {
            const ca = cashEntries.filter(e => e.entryDate.startsWith(monthStr)).reduce((sum, e) => sum + Number(e.totalRevenue || 0), 0);
            const foodCost = purchases.filter(p => p.invoiceDate?.startsWith(monthStr) && (p.category === 'alimentaire' || p.category === 'boissons')).reduce((sum, p) => sum + Number(p.amount || 0), 0);
            const payrollCost = payroll.filter(p => p.period.startsWith(monthStr)).reduce((sum, p) => sum + Number(p.grossSalary || 0) + Number(p.socialCharges || 0), 0);
            const overhead = expenses.filter(e => e.period?.startsWith(monthStr)).reduce((sum, e) => sum + Number(e.amount || 0), 0);
            const grossMargin = ca - foodCost;
            return {
                month: monthStr, ca, foodCost,
                foodCostPct: ca > 0 ? (foodCost / ca) * 100 : 0,
                payrollCost, payrollCostPct: ca > 0 ? (payrollCost / ca) * 100 : 0,
                overhead, overheadPct: ca > 0 ? (overhead / ca) * 100 : 0,
                grossMargin, grossMarginPct: ca > 0 ? (grossMargin / ca) * 100 : 0
            };
        });

        const annual = monthly.reduce((acc, m) => {
            acc.ca += m.ca; acc.foodCost += m.foodCost;
            acc.payrollCost += m.payrollCost; acc.overhead += m.overhead;
            return acc;
        }, { ca: 0, foodCost: 0, payrollCost: 0, overhead: 0 });

        const annualStats = {
            ...annual,
            foodCostPct: annual.ca > 0 ? (annual.foodCost / annual.ca) * 100 : 0,
            payrollCostPct: annual.ca > 0 ? (annual.payrollCost / annual.ca) * 100 : 0,
            overheadPct: annual.ca > 0 ? (annual.overhead / annual.ca) * 100 : 0,
            grossMargin: annual.ca - annual.foodCost,
            grossMarginPct: annual.ca > 0 ? ((annual.ca - annual.foodCost) / annual.ca) * 100 : 0
        };

        res.json({ year: year || "all", annual: annualStats, monthly });
    } catch (error: any) {
        console.error("[SUGU] Ratios Analytics error:", error);
        res.status(500).json({ error: "Failed to fetch ratios analytics" });
    }
});

router.get("/analytics/tresorerie", async (req: Request, res: Response) => {
    try {
        const year = req.query.year as string;
        const from = req.query.from as string;
        const to = req.query.to as string;
        const monthsCount = parseInt(req.query.months as string || "3");
        if (!year && !from) return res.status(400).json({ error: "Year or from/to is required" });

        const useRange = !!from && !!to;
        const dateFilter = (col: any) => useRange
            ? sql`${col} >= ${from} AND ${col} <= ${to}`
            : sql`SUBSTRING(${col}, 1, 4) = ${year}`;

        const latestBankEntry = await db.select().from(suguBankEntries).orderBy(desc(suguBankEntries.entryDate)).limit(1);
        const currentBalance = latestBankEntry[0]?.balance || 0;

        const cashEntries = await db.select().from(suguCashRegister).where(dateFilter(suguCashRegister.entryDate));
        const purchases = await db.select().from(suguPurchases).where(dateFilter(suguPurchases.invoiceDate));
        const expenses = await db.select().from(suguExpenses).where(dateFilter(suguExpenses.period));
        const payroll = await db.select().from(suguPayroll).where(dateFilter(suguPayroll.period));

        const unpaidPurchases = await db.select().from(suguPurchases).where(eq(suguPurchases.isPaid, false));
        const unpaidExpenses = await db.select().from(suguExpenses).where(eq(suguExpenses.isPaid, false));
        const unpaidPayables = [...unpaidPurchases, ...unpaidExpenses].reduce((sum, item) => sum + Number(item.amount || 0), 0);

        const monthSet = new Set<string>();
        if (useRange) {
            const startY = parseInt(from.slice(0, 4)), startM = parseInt(from.slice(5, 7));
            const endY = parseInt(to.slice(0, 4)), endM = parseInt(to.slice(5, 7));
            for (let y = startY; y <= endY; y++) {
                const mStart = y === startY ? startM : 1;
                const mEnd = y === endY ? endM : 12;
                for (let m = mStart; m <= mEnd; m++) monthSet.add(`${y}-${m.toString().padStart(2, '0')}`);
            }
        } else {
            for (let i = 1; i <= 12; i++) monthSet.add(`${year}-${i.toString().padStart(2, '0')}`);
        }
        const months = Array.from(monthSet).sort();

        const monthly = months.map(monthStr => {
            const cashIn = cashEntries.filter(e => e.entryDate.startsWith(monthStr)).reduce((sum, e) => sum + Number(e.totalRevenue || 0), 0);
            const cashOut = [
                ...purchases.filter(p => p.invoiceDate?.startsWith(monthStr)),
                ...expenses.filter(e => e.period?.startsWith(monthStr)),
                ...payroll.filter(p => p.period.startsWith(monthStr))
            ].reduce((sum, item) => sum + Number('amount' in item ? item.amount : (Number(item.grossSalary) + Number(item.socialCharges))), 0);
            return { month: monthStr, cashIn, cashOut, netFlow: cashIn - cashOut };
        });

        const totalNetFlow = monthly.reduce((sum, m) => sum + m.netFlow, 0);
        let currentIterBalance = currentBalance - totalNetFlow;
        const monthlyWithCum = monthly.map(m => {
            currentIterBalance += m.netFlow;
            return { ...m, cumulativeBalance: currentIterBalance };
        });

        const last3MonthsFlows = monthlyWithCum.filter(m => m.cashIn > 0 || m.cashOut > 0).slice(-monthsCount);
        const avg3m = last3MonthsFlows.length > 0 ? last3MonthsFlows.reduce((sum, m) => sum + m.netFlow, 0) / last3MonthsFlows.length : 0;

        res.json({
            currentBalance, unpaidPayables, monthly: monthlyWithCum,
            projection: {
                avg3m,
                projected1m: currentBalance + avg3m,
                projected2m: currentBalance + avg3m * 2,
                projected3m: currentBalance + avg3m * 3
            }
        });
    } catch (error: any) {
        console.error("[SUGU] Tresorerie Analytics error:", error);
        res.status(500).json({ error: "Failed to fetch tresorerie analytics" });
    }
});

router.get("/analytics/bilan-mensuel", async (req: Request, res: Response) => {
    try {
        const year = req.query.year as string;
        const from = req.query.from as string;
        const to = req.query.to as string;
        if (!year && !from) return res.status(400).json({ error: "Year or from/to is required" });

        const useRange = !!from && !!to;
        const dateFilter = (col: any) => useRange
            ? sql`${col} >= ${from} AND ${col} <= ${to}`
            : sql`SUBSTRING(${col}, 1, 4) = ${year}`;

        const cashEntries = await db.select().from(suguCashRegister).where(dateFilter(suguCashRegister.entryDate));
        const purchases = await db.select().from(suguPurchases).where(dateFilter(suguPurchases.invoiceDate));
        const expenses = await db.select().from(suguExpenses).where(dateFilter(suguExpenses.period));
        const payroll = await db.select().from(suguPayroll).where(dateFilter(suguPayroll.period));

        const monthSet = new Set<string>();
        if (useRange) {
            const startY = parseInt(from.slice(0, 4)), startM = parseInt(from.slice(5, 7));
            const endY = parseInt(to.slice(0, 4)), endM = parseInt(to.slice(5, 7));
            for (let y = startY; y <= endY; y++) {
                const mStart = y === startY ? startM : 1;
                const mEnd = y === endY ? endM : 12;
                for (let m = mStart; m <= mEnd; m++) monthSet.add(`${y}-${m.toString().padStart(2, '0')}`);
            }
        } else {
            for (let i = 1; i <= 12; i++) monthSet.add(`${year}-${i.toString().padStart(2, '0')}`);
        }
        const months = Array.from(monthSet).sort();

        const monthly = months.map(monthStr => {
            const ca = cashEntries.filter(e => e.entryDate.startsWith(monthStr)).reduce((sum, e) => sum + Number(e.totalRevenue || 0), 0);
            const ach_alim = purchases.filter(p => p.invoiceDate?.startsWith(monthStr) && p.category === 'alimentaire').reduce((sum, p) => sum + Number(p.amount || 0), 0);
            const ach_boiss = purchases.filter(p => p.invoiceDate?.startsWith(monthStr) && p.category === 'boissons').reduce((sum, p) => sum + Number(p.amount || 0), 0);
            const ach_emb = purchases.filter(p => p.invoiceDate?.startsWith(monthStr) && p.category === 'emballages').reduce((sum, p) => sum + Number(p.amount || 0), 0);
            const ach_autres = purchases.filter(p => p.invoiceDate?.startsWith(monthStr) && !['alimentaire', 'boissons', 'emballages'].includes(p.category)).reduce((sum, p) => sum + Number(p.amount || 0), 0);
            const achats_total = ach_alim + ach_boiss + ach_emb + ach_autres;
            const frais_total = expenses.filter(e => e.period?.startsWith(monthStr)).reduce((sum, e) => sum + Number(e.amount || 0), 0);
            const salaires_total = payroll.filter(p => p.period.startsWith(monthStr)).reduce((sum, p) => sum + Number(p.grossSalary || 0), 0);
            const charges_total = payroll.filter(p => p.period.startsWith(monthStr)).reduce((sum, p) => sum + Number(p.socialCharges || 0), 0);
            const result = ca - achats_total - frais_total - salaires_total - charges_total;
            return {
                month: monthStr, ca,
                achats: { total: achats_total, alim: ach_alim, boiss: ach_boiss, emb: ach_emb, autres: ach_autres },
                fraisGeneraux: frais_total, masseSalariale: salaires_total, chargesSociales: charges_total,
                resultat: result, margePct: ca > 0 ? (result / ca) * 100 : 0
            };
        });

        const annual = monthly.reduce((acc, m) => {
            acc.ca += m.ca; acc.achats.total += m.achats.total; acc.achats.alim += m.achats.alim;
            acc.achats.boiss += m.achats.boiss; acc.achats.emb += m.achats.emb; acc.achats.autres += m.achats.autres;
            acc.fraisGeneraux += m.fraisGeneraux; acc.masseSalariale += m.masseSalariale;
            acc.chargesSociales += m.chargesSociales; acc.resultat += m.resultat;
            return acc;
        }, { ca: 0, achats: { total: 0, alim: 0, boiss: 0, emb: 0, autres: 0 }, fraisGeneraux: 0, masseSalariale: 0, chargesSociales: 0, resultat: 0 });

        res.json({ year: year || "all", annual: { ...annual, margePct: annual.ca > 0 ? (annual.resultat / annual.ca) * 100 : 0 }, monthly });
    } catch (error: any) {
        console.error("[SUGU] Bilan Analytics error:", error);
        res.status(500).json({ error: "Failed to fetch bilan analytics" });
    }
});

router.get("/analytics/export-comptable", async (req: Request, res: Response) => {
    try {
        const year = req.query.year as string;
        if (!year) return res.status(400).json({ error: "Year is required" });

        // Reuse existing logic by calling internal functions or just re-running queries
        // For efficiency in a script, let's just do a quick consolidated query
        const cashEntries = await db.select().from(suguCashRegister).where(sql`SUBSTRING(entry_date, 1, 4) = ${year}`);
        const purchases = await db.select().from(suguPurchases).where(sql`SUBSTRING(invoice_date, 1, 4) = ${year}`);
        const expenses = await db.select().from(suguExpenses).where(sql`SUBSTRING(period, 1, 4) = ${year}`);
        const payroll = await db.select().from(suguPayroll).where(sql`SUBSTRING(period, 1, 4) = ${year}`);

        let csv = "Mois;CA;Achats;Frais Generaux;Masse Salariale;Charges Sociales;Resultat;Marge %;TVA Collectee;TVA Deductible;Solde TVA\n";

        for (let i = 1; i <= 12; i++) {
            const m = i.toString().padStart(2, '0');
            const monthStr = `${year}-${m}`;

            const ca = cashEntries.filter(e => e.entryDate.startsWith(monthStr)).reduce((sum, e) => sum + Number(e.totalRevenue || 0), 0);
            const ach = purchases.filter(p => p.invoiceDate?.startsWith(monthStr)).reduce((sum, p) => sum + Number(p.amount || 0), 0);
            const frais = expenses.filter(e => e.period?.startsWith(monthStr)).reduce((sum, e) => sum + Number(e.amount || 0), 0);
            const sal = payroll.filter(p => p.period.startsWith(monthStr)).reduce((sum, p) => sum + Number(p.grossSalary || 0), 0);
            const chg = payroll.filter(p => p.period.startsWith(monthStr)).reduce((sum, p) => sum + Number(p.socialCharges || 0), 0);
            const resVal = ca - ach - frais - sal - chg;
            const marge = ca > 0 ? (resVal / ca) * 100 : 0;

            const tvaCol = ca * 0.10;
            const tvaDed = [...purchases.filter(p => p.invoiceDate?.startsWith(monthStr)), ...expenses.filter(e => e.period?.startsWith(monthStr))].reduce((sum, item) => sum + Number(item.taxAmount || 0), 0);
            const tvaSolde = tvaCol - tvaDed;

            csv += `${monthStr};${ca.toFixed(2)};${ach.toFixed(2)};${frais.toFixed(2)};${sal.toFixed(2)};${chg.toFixed(2)};${resVal.toFixed(2)};${marge.toFixed(2)}%;${tvaCol.toFixed(2)};${tvaDed.toFixed(2)};${tvaSolde.toFixed(2)}\n`;
        }

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="rapport-comptable-${year}.csv"`);
        res.send(csv);
    } catch (error: any) {
        console.error("[SUGU] Export error:", error);
        res.status(500).json({ error: "Failed to generate export" });
    }
});

export default router;
