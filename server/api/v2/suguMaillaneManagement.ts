import { Router, Request, Response } from "express";
import multer from "multer";
import { hybridUpload } from "../../middleware/base64Upload";
import { db } from "../../db";
import {
    suguMaillanePurchases, insertSuguMaillanePurchaseSchema,
    suguMaillaneExpenses, insertSuguMaillaneExpenseSchema,
    suguMaillaneBankEntries, insertSuguMaillaneBankEntrySchema,
    suguMaillaneLoans, insertSuguMaillaneLoanSchema,
    suguMaillaneCashRegister, insertSuguMaillaneCashRegisterSchema,
    suguMaillaneEmployees, insertSuguMaillaneEmployeeSchema,
    suguMaillanePayroll, insertSuguMaillanePayrollSchema,
    suguMaillaneAbsences, insertSuguMaillaneAbsenceSchema,
    suguMaillaneFiles, insertSuguMaillaneFileSchema,
    suguMaillaneSuppliers, insertSuguMaillaneSupplierSchema,
    sugumTrash,
} from "@shared/schema";
import { ilike } from "drizzle-orm";
import { objectStorageClient } from "../../replit_integrations/object_storage/objectStorage";
import { eq, desc, sql, and, gte, lte, inArray } from "drizzle-orm";
import { parseBankStatementPDF, parseBankStatementText, parseBankStatementCSV } from "../../services/bankStatementParser";
import { parsePayrollPDF } from "../../services/payrollParserService";
import { emitSuguPurchasesUpdated, emitSuguExpensesUpdated, emitSuguBankUpdated, emitSuguCashUpdated, emitSuguFilesUpdated, emitSuguEmployeesUpdated, emitSuguPayrollUpdated, emitSuguAbsencesUpdated, emitSuguLoansUpdated } from "../../services/realtimeSync";

const router = Router();

function normalizeExpenseCategory(cat: string | null | undefined): string {
    if (!cat) return "autre";
    const lower = cat.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (["electricite", "energie", "energy"].includes(lower)) return "energie";
    if (["telecom", "telecommunication", "telecommunications", "telecomunications"].includes(lower)) return "telecom";
    if (lower === "eau" || lower === "water") return "eau";
    if (lower === "loyer" || lower === "rent") return "loyer";
    if (lower === "assurance" || lower === "insurance") return "assurance";
    return cat.toLowerCase();
}

const SUGUM_BUCKET_PREFIX = "sugu-maillane-files";

async function uploadToObjectStorage(buffer: Buffer, fileName: string, mimeType: string): Promise<string> {
    const privateDir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!privateDir) throw new Error("PRIVATE_OBJECT_DIR not set");
    const fullPath = `${privateDir}/${SUGUM_BUCKET_PREFIX}/${fileName}`;
    const parts = fullPath.startsWith("/") ? fullPath.slice(1).split("/") : fullPath.split("/");
    const bucketName = parts[0];
    const objectName = parts.slice(1).join("/");
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    await file.save(buffer, { contentType: mimeType });
    return fullPath;
}

async function downloadFromObjectStorage(storagePath: string): Promise<{ buffer: Buffer }> {
    const parts = storagePath.startsWith("/") ? storagePath.slice(1).split("/") : storagePath.split("/");
    const bucketName = parts[0];
    const objectName = parts.slice(1).join("/");
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    const [exists] = await file.exists();
    if (!exists) throw new Error("File not found in object storage");
    const [contents] = await file.download();
    return { buffer: contents };
}

async function deleteFromObjectStorage(storagePath: string): Promise<void> {
    const parts = storagePath.startsWith("/") ? storagePath.slice(1).split("/") : storagePath.split("/");
    const bucketName = parts[0];
    const objectName = parts.slice(1).join("/");
    if (!bucketName || !objectName) throw new Error(`Invalid storagePath: ${storagePath}`);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    const [exists] = await file.exists();
    if (exists) {
        await file.delete();
        console.log(`[SUGU-M] Permanently deleted from storage: ${objectName}`);
    } else {
        console.warn(`[SUGU-M] File not found in storage (already gone?): ${objectName}`);
    }
}

router.use((req: Request, res: Response, next) => {
    const user = (req as any).user;
    const isOwner = (req as any).isOwner;
    if (isOwner || user?.role === "approved" || user?.role === "sugumaillane_only") {
        if (user?.role === "sugumaillane_only" && req.method !== "GET") {
            const allowedPostPaths = [/\/files\/\d+\/download$/, /\/files\/\d+\/send-email$/, /\/files\/send-email-bulk$/, /\/cash\/parse-ticket$/];
            const isAllowed = allowedPostPaths.some(p => p.test(req.path));
            if (!isAllowed) {
                return res.status(403).json({ error: "Lecture seule — opération non autorisée" });
            }
        }
        return next();
    }
    return res.status(403).json({ error: "Access denied for SUGU Maillane management" });
});

const pdfUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ============ ACHATS / PURCHASES ============

router.get("/purchases", async (req: Request, res: Response) => {
    try {
        const data = await db.select().from(suguMaillanePurchases).orderBy(desc(suguMaillanePurchases.invoiceDate));

        console.log(`[SUGU-M] Fetched ${data.length} purchases`);
        res.json(data);
    } catch (error: any) {
        console.error("[SUGU-M] Error fetching purchases:", error?.message || error);
        if (error?.message?.includes("does not exist") || error?.message?.includes("relation")) {
            console.error("[SUGU-M] Table sugum_purchases may not exist. Run 'npm run db:push' to sync schema.");
            res.json([]);
        } else {
            res.status(500).json({ error: "Failed to fetch purchases" });
        }
    }
});

router.post("/purchases", async (req: Request, res: Response) => {
    console.log("[SUGU-M] POST /purchases received");
    try {
        let parsed: any;
        try {
            parsed = insertSuguMaillanePurchaseSchema.parse(req.body);
        } catch (zodErr: any) {
            console.error("[SUGU-M] Zod validation failed:", zodErr?.issues || zodErr?.message);
            return res.status(400).json({ error: "Invalid data", details: zodErr?.issues });
        }

        try {
            const [result] = await db.insert(suguMaillanePurchases).values(parsed).returning();
            console.log("[SUGU-M] Purchase created via Drizzle:", result?.id);
            emitSuguPurchasesUpdated();
            res.json(result);
            return;
        } catch (drizzleErr: any) {
            console.error("[SUGU-M] Drizzle insert failed:", drizzleErr?.message || drizzleErr);

            console.log("[SUGU-M] Trying raw SQL fallback...");
            const result = await db.execute(sql`
                INSERT INTO sugum_purchases (supplier, category, description, amount, tax_amount, invoice_number, invoice_date, due_date, is_paid, paid_date, payment_method, notes)
                VALUES (${parsed.supplier}, ${parsed.category}, ${parsed.description || ''}, ${parsed.amount}, ${parsed.taxAmount || 0}, ${parsed.invoiceNumber}, ${parsed.invoiceDate}, ${parsed.dueDate}, ${parsed.isPaid || false}, ${parsed.paidDate}, ${parsed.paymentMethod}, ${parsed.notes})
                RETURNING *
            `);
            const row = (result as any).rows?.[0] || (result as any)[0];
            console.log("[SUGU-M] Purchase created via raw SQL:", row?.id);
            emitSuguPurchasesUpdated();
            res.json(row);
            return;
        }
    } catch (error: any) {
        console.error("[SUGU-M] FATAL Error creating purchase:", error?.message || error);
        res.status(500).json({ error: "Erreur serveur: " + (error?.message || "Unknown") });
    }
});

router.put("/purchases/:id", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const { supplier, category, description, amount, taxAmount, invoiceNumber, invoiceDate, dueDate, isPaid, paidDate, paymentMethod, notes } = req.body;
        const [result] = await db.update(suguMaillanePurchases).set({ supplier, category, description, amount, taxAmount, invoiceNumber, invoiceDate, dueDate, isPaid, paidDate, paymentMethod, notes }).where(eq(suguMaillanePurchases.id, id)).returning();
        emitSuguPurchasesUpdated();
        res.json(result);
    } catch (error) {
        console.error("[SUGU-M] Error updating purchase:", error);
        res.status(500).json({ error: "Failed to update purchase" });
    }
});

router.delete("/purchases/:id", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        await db.delete(suguMaillanePurchases).where(eq(suguMaillanePurchases.id, id));
        emitSuguPurchasesUpdated();
        res.json({ success: true });
    } catch (error) {
        console.error("[SUGU-M] Error deleting purchase:", error);
        res.status(500).json({ error: "Failed to delete purchase" });
    }
});

// ============ FRAIS GÉNÉRAUX / EXPENSES ============

router.get("/expenses", async (req: Request, res: Response) => {
    try {
        const data = await db.select().from(suguMaillaneExpenses).orderBy(desc(suguMaillaneExpenses.period));
        console.log(`[SUGU-M] Fetched ${data.length} expenses`);
        res.json(data);
    } catch (error: any) {
        console.error("[SUGU-M] Error fetching expenses:", error?.message || error);
        if (error?.message?.includes("does not exist") || error?.message?.includes("relation")) {
            console.error("[SUGU-M] Table sugum_general_expenses may not exist. Run 'npm run db:push' to sync schema.");
            res.json([]);
        } else {
            res.status(500).json({ error: "Failed to fetch expenses" });
        }
    }
});

router.post("/expenses", async (req: Request, res: Response) => {
    console.log("[SUGU-M] POST /expenses received");
    try {
        let parsed: any;
        try {
            parsed = insertSuguMaillaneExpenseSchema.parse(req.body);
        } catch (zodErr: any) {
            console.error("[SUGU-M] Zod validation failed:", zodErr?.issues || zodErr?.message);
            return res.status(400).json({ error: "Invalid data", details: zodErr?.issues });
        }

        parsed.category = normalizeExpenseCategory(parsed.category);
        try {
            const [result] = await db.insert(suguMaillaneExpenses).values(parsed).returning();
            console.log("[SUGU-M] Expense created via Drizzle:", result?.id);
            emitSuguExpensesUpdated();
            res.json(result);
            return;
        } catch (drizzleErr: any) {
            console.error("[SUGU-M] Drizzle insert failed:", drizzleErr?.message || drizzleErr);

            console.log("[SUGU-M] Trying raw SQL fallback...");
            const result = await db.execute(sql`
                INSERT INTO sugum_general_expenses (label, category, description, amount, tax_amount, period, frequency, due_date, is_paid, paid_date, payment_method, is_recurring, notes)
                VALUES (${parsed.label}, ${normalizeExpenseCategory(parsed.category)}, ${parsed.description || ''}, ${parsed.amount}, ${parsed.taxAmount || 0}, ${parsed.period}, ${parsed.frequency || 'mensuel'}, ${parsed.dueDate}, ${parsed.isPaid || false}, ${parsed.paidDate}, ${parsed.paymentMethod}, ${parsed.isRecurring || false}, ${parsed.notes})
                RETURNING *
            `);
            const row = (result as any).rows?.[0] || (result as any)[0];
            console.log("[SUGU-M] Expense created via raw SQL:", row?.id);
            emitSuguExpensesUpdated();
            res.json(row);
            return;
        }
    } catch (error: any) {
        console.error("[SUGU-M] FATAL Error creating expense:", error?.message || error);
        res.status(500).json({ error: "Erreur serveur: " + (error?.message || "Unknown") });
    }
});

router.put("/expenses/:id", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const { label, category, description, amount, taxAmount, period, frequency, dueDate, isPaid, paidDate, paymentMethod, isRecurring, invoiceNumber, notes } = req.body;
        const [result] = await db.update(suguMaillaneExpenses).set({ label, category: normalizeExpenseCategory(category), description, amount, taxAmount, period, frequency, dueDate, isPaid, paidDate, paymentMethod, isRecurring, invoiceNumber: invoiceNumber || null, notes }).where(eq(suguMaillaneExpenses.id, id)).returning();
        emitSuguExpensesUpdated();
        res.json(result);
    } catch (error) {
        console.error("[SUGU-M] Error updating expense:", error);
        res.status(500).json({ error: "Failed to update expense" });
    }
});

router.delete("/expenses/:id", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        await db.delete(suguMaillaneExpenses).where(eq(suguMaillaneExpenses.id, id));
        emitSuguExpensesUpdated();
        res.json({ success: true });
    } catch (error) {
        console.error("[SUGU-M] Error deleting expense:", error);
        res.status(500).json({ error: "Failed to delete expense" });
    }
});

// ============ BANQUE / BANK ============

router.get("/bank", async (req: Request, res: Response) => {
    try {
        const data = await db.select().from(suguMaillaneBankEntries).orderBy(desc(suguMaillaneBankEntries.entryDate));
        res.json(data);
    } catch (error) {
        console.error("[SUGU-M] Error fetching bank entries:", error);
        res.status(500).json({ error: "Failed to fetch bank entries" });
    }
});

router.post("/bank", async (req: Request, res: Response) => {
    try {
        const parsed = insertSuguMaillaneBankEntrySchema.parse(req.body);
        const [result] = await db.insert(suguMaillaneBankEntries).values(parsed).returning();
        emitSuguBankUpdated();
        res.json(result);
    } catch (error) {
        console.error("[SUGU-M] Error creating bank entry:", error);
        res.status(400).json({ error: "Invalid bank entry data" });
    }
});

router.put("/bank/:id", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const { bankName, entryDate, label, amount, balance, category, isReconciled, notes } = req.body;
        const [result] = await db.update(suguMaillaneBankEntries).set({ bankName, entryDate, label, amount, balance, category, isReconciled, notes }).where(eq(suguMaillaneBankEntries.id, id)).returning();
        emitSuguBankUpdated();
        res.json(result);
    } catch (error) {
        console.error("[SUGU-M] Error updating bank entry:", error);
        res.status(500).json({ error: "Failed to update bank entry" });
    }
});

router.delete("/bank/:id", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        await db.delete(suguMaillaneBankEntries).where(eq(suguMaillaneBankEntries.id, id));
        emitSuguBankUpdated();
        res.json({ success: true });
    } catch (error) {
        console.error("[SUGU-M] Error deleting bank entry:", error);
        res.status(500).json({ error: "Failed to delete bank entry" });
    }
});

// TEMP — Reset all bank data (owner only)
router.delete("/bank-reset-all", async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const isOwner = (req as any).isOwner;
        if (!isOwner && user?.role !== "admin") return res.status(403).json({ error: "Owner only" });
        // Delete bank files from object storage first
        const bankFiles = await db.select().from(suguMaillaneFiles).where(eq(suguMaillaneFiles.category, "banque"));
        for (const f of bankFiles) {
            try { await deleteFromObjectStorage(f.storagePath); } catch (e) { console.error(`[SUGU-M] Storage delete failed for file ${f.id}:`, e); }
        }
        await db.delete(suguMaillaneBankEntries);
        await db.delete(suguMaillaneFiles).where(eq(suguMaillaneFiles.category, "banque"));
        console.log(`[SUGU-M] ADMIN bank reset by ${user?.username} — ${bankFiles.length} files permanently deleted`);
        emitSuguBankUpdated();
        emitSuguFilesUpdated();
        res.json({ success: true, message: `All Maillane bank entries and ${bankFiles.length} bank files permanently deleted` });
    } catch (error) {
        console.error("[SUGU-M] Error resetting bank:", error);
        res.status(500).json({ error: "Failed to reset bank" });
    }
});

// Loans
router.get("/loans", async (req: Request, res: Response) => {
    try {
        const rows = await db
            .select({ loan: suguMaillaneLoans, file: suguMaillaneFiles })
            .from(suguMaillaneLoans)
            .leftJoin(suguMaillaneFiles, eq(suguMaillaneLoans.originalFileId, suguMaillaneFiles.id))
            .orderBy(desc(suguMaillaneLoans.startDate));
        const data = rows.map(r => ({ ...r.loan, originalFile: r.file ?? null }));
        res.json(data);
    } catch (error) {
        console.error("[SUGU-M] Error fetching loans:", error);
        res.status(500).json({ error: "Failed to fetch loans" });
    }
});

router.put("/loans/:id", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const { originalFileId, loanLabel, bankName, loanType, totalAmount, remainingAmount, monthlyPayment, interestRate, startDate, endDate, notes } = req.body;
        const updateFields: Record<string, any> = {};
        if (originalFileId !== undefined) updateFields.originalFileId = originalFileId ?? null;
        if (loanLabel !== undefined) updateFields.loanLabel = loanLabel;
        if (bankName !== undefined) updateFields.bankName = bankName;
        if (loanType !== undefined) updateFields.loanType = loanType;
        if (totalAmount !== undefined) updateFields.totalAmount = totalAmount;
        if (remainingAmount !== undefined) updateFields.remainingAmount = remainingAmount;
        if (monthlyPayment !== undefined) updateFields.monthlyPayment = monthlyPayment;
        if (interestRate !== undefined) updateFields.interestRate = interestRate;
        if (startDate !== undefined) updateFields.startDate = startDate;
        if (endDate !== undefined) updateFields.endDate = endDate;
        if (notes !== undefined) updateFields.notes = notes;
        const [updated] = await db.update(suguMaillaneLoans).set(updateFields).where(eq(suguMaillaneLoans.id, id)).returning();
        emitSuguLoansUpdated();
        res.json(updated);
    } catch (error) {
        console.error("[SUGU-M] Error updating loan:", error);
        res.status(500).json({ error: "Failed to update loan" });
    }
});

router.post("/loans", async (req: Request, res: Response) => {
    try {
        const parsed = insertSuguMaillaneLoanSchema.parse(req.body);
        const [result] = await db.insert(suguMaillaneLoans).values(parsed).returning();
        emitSuguLoansUpdated();
        res.json(result);
    } catch (error) {
        console.error("[SUGU-M] Error creating loan:", error);
        res.status(400).json({ error: "Invalid loan data" });
    }
});

router.delete("/loans/:id", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        await db.delete(suguMaillaneLoans).where(eq(suguMaillaneLoans.id, id));
        emitSuguLoansUpdated();
        res.json({ success: true });
    } catch (error) {
        console.error("[SUGU-M] Error deleting loan:", error);
        res.status(500).json({ error: "Failed to delete loan" });
    }
});

// Parse a loan amortization document and return pre-filled loan fields
router.post("/loans/parse-document", hybridUpload({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }), async (req: Request, res: Response) => {
    try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: "No file provided" });
        const result = await parseLoanDocumentM(file.buffer, file.originalname);
        res.json(result);
    } catch (err: any) {
        console.error("[SUGU-M] Error parsing loan document:", err?.message);
        res.status(500).json({ error: "Failed to parse loan document" });
    }
});

// ============ JOURNAL DE CAISSE / CASH REGISTER ============

router.get("/cash", async (req: Request, res: Response) => {
    try {
        const { from, to } = req.query;
        let query = db.select().from(suguMaillaneCashRegister);

        if (from && to) {
            query = query.where(and(
                gte(suguMaillaneCashRegister.entryDate, from as string),
                lte(suguMaillaneCashRegister.entryDate, to as string)
            )) as any;
        }

        const data = await query.orderBy(desc(suguMaillaneCashRegister.entryDate));
        res.json(data);
    } catch (error) {
        console.error("[SUGU-M] Error fetching cash register:", error);
        res.status(500).json({ error: "Failed to fetch cash register" });
    }
});

router.post("/cash", async (req: Request, res: Response) => {
    try {
        const parsed = insertSuguMaillaneCashRegisterSchema.parse(req.body);
        if (parsed.totalRevenue && parsed.coversCount && parsed.coversCount > 0 && !parsed.averageTicket) {
            (parsed as any).averageTicket = parsed.totalRevenue / parsed.coversCount;
        }
        const [result] = await db.insert(suguMaillaneCashRegister).values(parsed).returning();
        emitSuguCashUpdated();
        res.json(result);
    } catch (error) {
        console.error("[SUGU-M] Error creating cash entry:", error);
        res.status(400).json({ error: "Invalid cash register data" });
    }
});

router.put("/cash/:id", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const { entryDate, totalRevenue, cashAmount, cbAmount, cbzenAmount, trAmount, ctrAmount, ubereatsAmount, deliverooAmount, chequeAmount, virementAmount, ticketRestoAmount, onlineAmount, coversCount, averageTicket, notes } = req.body;
        const [result] = await db.update(suguMaillaneCashRegister).set({ entryDate, totalRevenue, cashAmount, cbAmount, cbzenAmount, trAmount, ctrAmount, ubereatsAmount, deliverooAmount, chequeAmount, virementAmount, ticketRestoAmount, onlineAmount, coversCount, averageTicket, notes }).where(eq(suguMaillaneCashRegister.id, id)).returning();
        emitSuguCashUpdated();
        res.json(result);
    } catch (error) {
        console.error("[SUGU-M] Error updating cash entry:", error);
        res.status(500).json({ error: "Failed to update cash entry" });
    }
});

router.delete("/cash/:id", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        await db.delete(suguMaillaneCashRegister).where(eq(suguMaillaneCashRegister.id, id));
        emitSuguCashUpdated();
        res.json({ success: true });
    } catch (error) {
        console.error("[SUGU-M] Error deleting cash entry:", error);
        res.status(500).json({ error: "Failed to delete cash entry" });
    }
});

router.get("/cash/summary", async (req: Request, res: Response) => {
    try {
        const year = req.query.year as string || new Date().getFullYear().toString();
        const data = await db.select().from(suguMaillaneCashRegister)
            .where(sql`${suguMaillaneCashRegister.entryDate} LIKE ${year + '%'}`)
            .orderBy(suguMaillaneCashRegister.entryDate);

        const monthly: Record<string, { revenue: number; covers: number; days: number; avgTicket: number }> = {};
        for (const entry of data) {
            const month = entry.entryDate.substring(0, 7);
            if (!monthly[month]) monthly[month] = { revenue: 0, covers: 0, days: 0, avgTicket: 0 };
            monthly[month].revenue += Number(entry.totalRevenue || 0);
            monthly[month].covers += Number(entry.coversCount || 0);
            monthly[month].days += 1;
        }
        for (const m of Object.values(monthly)) {
            m.avgTicket = m.covers > 0 ? m.revenue / m.covers : 0;
        }

        const totalRevenue = data.reduce((s: number, e: any) => s + Number(e.totalRevenue || 0), 0);
        const totalCovers = data.reduce((s: number, e: any) => s + Number(e.coversCount || 0), 0);
        const totalDays = data.length;

        res.json({
            year,
            totalRevenue,
            totalCovers,
            totalDays,
            avgDailyRevenue: totalDays > 0 ? totalRevenue / totalDays : 0,
            avgTicket: totalCovers > 0 ? totalRevenue / totalCovers : 0,
            monthly,
        });
    } catch (error) {
        console.error("[SUGU-M] Error fetching cash summary:", error);
        res.status(500).json({ error: "Failed to fetch cash summary" });
    }
});

// ============ GESTION RH / EMPLOYEES ============

router.get("/employees", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const data = await db.select().from(suguMaillaneEmployees).orderBy(suguMaillaneEmployees.lastName);
        console.log(`[SUGU-M] Fetched ${data.length} employees`);
        res.json(data);
    } catch (error: any) {
        console.error("[SUGU-M] Error fetching employees:", error?.message || error);
        if (error?.message?.includes("does not exist") || error?.message?.includes("relation")) {
            res.json([]);
        } else {
            res.status(500).json({ error: "Failed to fetch employees" });
        }
    }
});

router.post("/employees", async (req: Request, res: Response) => {
    console.log("[SUGU-M] POST /employees body:", JSON.stringify(req.body));
    try {
        await tablesReady;
        let parsed: any;
        try {
            parsed = insertSuguMaillaneEmployeeSchema.parse(req.body);
        } catch (zodErr: any) {
            console.error("[SUGU-M] Employee Zod validation failed:", zodErr?.issues || zodErr?.message || zodErr);
            const b = req.body || {};
            parsed = {
                firstName: b.firstName || "Inconnu",
                lastName: b.lastName || "Inconnu",
                role: b.role || "Non spécifié",
                contractType: b.contractType || "CDI",
                monthlySalary: typeof b.monthlySalary === "number" ? b.monthlySalary : b.monthlySalary ? parseFloat(b.monthlySalary) : null,
                hourlyRate: typeof b.hourlyRate === "number" ? b.hourlyRate : b.hourlyRate ? parseFloat(b.hourlyRate) : null,
                weeklyHours: typeof b.weeklyHours === "number" ? b.weeklyHours : b.weeklyHours ? parseFloat(b.weeklyHours) : 35,
                startDate: b.startDate || new Date().toISOString().substring(0, 10),
                endDate: b.endDate || null,
                isActive: b.isActive === true || b.isActive === "true",
                phone: b.phone || null,
                email: b.email || null,
                notes: b.notes || null,
            };
            console.log("[SUGU-M] Using manual fallback for employee:", JSON.stringify(parsed));
        }

        try {
            const [result] = await db.insert(suguMaillaneEmployees).values(parsed).returning();
            console.log("[SUGU-M] Employee created via Drizzle:", result?.id);
            emitSuguEmployeesUpdated();
            res.json(result);
            return;
        } catch (drizzleErr: any) {
            console.error("[SUGU-M] Drizzle insert failed for employee:", drizzleErr?.message || drizzleErr);
            console.log("[SUGU-M] Trying raw SQL fallback for employee...");
            const result = await db.execute(sql`
                INSERT INTO sugum_employees (first_name, last_name, role, contract_type, monthly_salary, hourly_rate, weekly_hours, start_date, end_date, is_active, phone, email, notes)
                VALUES (${parsed.firstName}, ${parsed.lastName}, ${parsed.role}, ${parsed.contractType || 'CDI'}, ${parsed.monthlySalary}, ${parsed.hourlyRate}, ${parsed.weeklyHours || 35}, ${parsed.startDate}, ${parsed.endDate}, ${parsed.isActive !== false}, ${parsed.phone}, ${parsed.email}, ${parsed.notes})
                RETURNING *
            `);
            const row = (result as any).rows?.[0] || (result as any)[0];
            console.log("[SUGU-M] Employee created via raw SQL:", row?.id);
            emitSuguEmployeesUpdated();
            res.json(row);
            return;
        }
    } catch (error: any) {
        console.error("[SUGU-M] FATAL Error creating employee:", error?.message || error);
        res.status(500).json({ error: "Erreur serveur: " + (error?.message || "Unknown") });
    }
});

router.put("/employees/:id", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const id = parseInt(req.params.id);
        const { firstName, lastName, role, contractType, monthlySalary, hourlyRate, weeklyHours, startDate, endDate, isActive, phone, email, notes } = req.body;
        const [result] = await db.update(suguMaillaneEmployees).set({ firstName, lastName, role, contractType, monthlySalary, hourlyRate, weeklyHours, startDate, endDate, isActive, phone, email, notes }).where(eq(suguMaillaneEmployees.id, id)).returning();
        emitSuguEmployeesUpdated();
        res.json(result);
    } catch (error) {
        console.error("[SUGU-M] Error updating employee:", error);
        res.status(500).json({ error: "Failed to update employee" });
    }
});

router.delete("/employees/:id", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const id = parseInt(req.params.id);
        await db.delete(suguMaillaneEmployees).where(eq(suguMaillaneEmployees.id, id));
        emitSuguEmployeesUpdated();
        res.json({ success: true });
    } catch (error) {
        console.error("[SUGU-M] Error deleting employee:", error);
        res.status(500).json({ error: "Failed to delete employee" });
    }
});

// Payroll
router.get("/payroll", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const period = req.query.period as string;
        let query = db.select().from(suguMaillanePayroll);
        if (period) {
            query = query.where(eq(suguMaillanePayroll.period, period)) as any;
        }
        const data = await query.orderBy(desc(suguMaillanePayroll.period));
        res.json(data);
    } catch (error) {
        console.error("[SUGU-M] Error fetching payroll:", error);
        res.status(500).json({ error: "Failed to fetch payroll" });
    }
});

router.post("/payroll", async (req: Request, res: Response) => {
    console.log("[SUGU-M] POST /payroll body:", JSON.stringify(req.body));
    try {
        await tablesReady;
        let parsed: any;
        try {
            parsed = insertSuguMaillanePayrollSchema.parse(req.body);
        } catch (zodErr: any) {
            console.error("[SUGU-M] Payroll Zod validation failed:", zodErr?.issues || zodErr?.message || zodErr);
            const b = req.body || {};
            parsed = {
                employeeId: typeof b.employeeId === "number" ? b.employeeId : parseInt(b.employeeId) || 0,
                period: b.period || new Date().toISOString().substring(0, 7),
                grossSalary: typeof b.grossSalary === "number" ? b.grossSalary : parseFloat(b.grossSalary) || 0,
                netSalary: typeof b.netSalary === "number" ? b.netSalary : parseFloat(b.netSalary) || 0,
                socialCharges: typeof b.socialCharges === "number" ? b.socialCharges : b.socialCharges ? parseFloat(b.socialCharges) : 0,
                bonus: typeof b.bonus === "number" ? b.bonus : b.bonus ? parseFloat(b.bonus) : 0,
                overtime: typeof b.overtime === "number" ? b.overtime : b.overtime ? parseFloat(b.overtime) : 0,
                isPaid: b.isPaid === true || b.isPaid === "true",
                paidDate: b.paidDate || null,
                notes: b.notes || null,
            };
            console.log("[SUGU-M] Using manual fallback for payroll:", JSON.stringify(parsed));
        }

        try {
            const [result] = await db.insert(suguMaillanePayroll).values(parsed).returning();
            console.log("[SUGU-M] Payroll created via Drizzle:", result?.id);
            emitSuguPayrollUpdated();
            res.json(result);
            return;
        } catch (drizzleErr: any) {
            console.error("[SUGU-M] Drizzle insert failed for payroll:", drizzleErr?.message || drizzleErr);
            const result = await db.execute(sql`
                INSERT INTO sugum_payroll (employee_id, period, gross_salary, net_salary, social_charges, bonus, overtime, is_paid, paid_date, notes)
                VALUES (${parsed.employeeId}, ${parsed.period}, ${parsed.grossSalary}, ${parsed.netSalary}, ${parsed.socialCharges || 0}, ${parsed.bonus || 0}, ${parsed.overtime || 0}, ${parsed.isPaid || false}, ${parsed.paidDate}, ${parsed.notes})
                RETURNING *
            `);
            const row = (result as any).rows?.[0] || (result as any)[0];
            console.log("[SUGU-M] Payroll created via raw SQL:", row?.id);
            emitSuguPayrollUpdated();
            res.json(row);
            return;
        }
    } catch (error: any) {
        console.error("[SUGU-M] FATAL Error creating payroll:", error?.message || error);
        res.status(500).json({ error: "Erreur serveur: " + (error?.message || "Unknown") });
    }
});

router.put("/payroll/:id", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const id = parseInt(req.params.id);
        const { employeeId, period, grossSalary, netSalary, socialCharges, bonus, overtime, isPaid, paidDate, pdfPath, notes } = req.body;
        const [result] = await db.update(suguMaillanePayroll).set({ employeeId, period, grossSalary, netSalary, socialCharges, bonus, overtime, isPaid, paidDate, pdfPath, notes }).where(eq(suguMaillanePayroll.id, id)).returning();
        emitSuguPayrollUpdated();
        res.json(result);
    } catch (error) {
        console.error("[SUGU-M] Error updating payroll:", error);
        res.status(500).json({ error: "Failed to update payroll" });
    }
});

router.delete("/payroll/:id", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const id = parseInt(req.params.id);
        const [result] = await db.delete(suguMaillanePayroll).where(eq(suguMaillanePayroll.id, id)).returning();
        if (!result) return res.status(404).json({ error: "Payroll not found" });
        emitSuguPayrollUpdated();
        res.json({ success: true });
    } catch (error) {
        console.error("[SUGU-M] Error deleting payroll:", error);
        res.status(500).json({ error: "Failed to delete payroll" });
    }
});

// In-memory import status tracking for Maillane
const maillaneImportStatusMap = new Map<string, { status: string; step?: string; result?: any; error?: string; updatedAt: number }>();
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of maillaneImportStatusMap) {
        if (now - val.updatedAt > 300000) maillaneImportStatusMap.delete(key);
    }
}, 60000);

// POST /payroll/import-pdf
router.post("/payroll/import-pdf", hybridUpload({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }), async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const file = (req as any).file;
        if (!file) {
            return res.status(400).json({ error: "No file uploaded" });
        }
        const importId = `impm_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        console.log(`[SUGU-M] Payroll PDF import queued: ${file.originalname}, ${file.size} bytes (${importId})`);

        const userId = (req as any).session?.userId || 1;
        const autoCreate = req.body?.autoCreate !== "false";
        const fileBuffer = Buffer.from(file.buffer);
        const fileName = file.originalname;
        const fileSize = file.size;
        const fileMime = file.mimetype || "application/pdf";

        res.json({
            success: true,
            async: true,
            importId,
            message: "Bulletin en cours de traitement...",
        });

        processMaillanePayrollImportAsync(importId, fileBuffer, fileName, fileSize, fileMime, autoCreate, userId).catch(err => {
            console.error(`[SUGU-M] Background import ${importId} failed:`, err?.message || err);
        });
    } catch (error: any) {
        console.error("[SUGU-M] Error importing payroll PDF:", error?.message || error);
        res.status(500).json({ error: "Erreur serveur: " + (error?.message || "Unknown") });
    }
});

router.get("/payroll/import-status/:importId", async (req: Request, res: Response) => {
    const { importId } = req.params;
    const status = maillaneImportStatusMap.get(importId);
    if (!status) {
        return res.json({ status: "processing", step: "En traitement..." });
    }
    res.json(status);
});

async function processMaillanePayrollImportAsync(
    importId: string,
    fileBuffer: Buffer,
    fileName: string,
    fileSize: number,
    fileMime: string,
    autoCreate: boolean,
    userId: number,
) {
    const { broadcastToUser } = await import("../../services/realtimeSync");

    const sendProgress = (step: string) => {
        maillaneImportStatusMap.set(importId, { status: "processing", step, updatedAt: Date.now() });
        broadcastToUser(userId, {
            type: "sugu.payroll.import.progress",
            userId,
            data: { importId, step, fileName },
            timestamp: Date.now(),
        });
    };

    try {
        sendProgress("Lecture du PDF...");
        const result = await parsePayrollPDF(fileBuffer, fileName);

        if (!result.success || !result.data) {
            maillaneImportStatusMap.set(importId, { status: "error", error: "Impossible de lire le bulletin", updatedAt: Date.now() });
            return;
        }

        const parsed = result.data;
        let employeeId: number | null = null;
        let employeeCreated = false;
        let payrollCreated = false;

        if (autoCreate && parsed.employee?.lastName) {
            sendProgress("Recherche de l'employé...");
            const existingEmps = await db.select().from(suguMaillaneEmployees);
            const match = existingEmps.find(e =>
                e.lastName.toLowerCase() === parsed.employee.lastName.toLowerCase() &&
                e.firstName.toLowerCase() === (parsed.employee.firstName || "").toLowerCase()
            );

            if (match) {
                employeeId = match.id;
                const updates: any = {};
                if (parsed.employee.role && parsed.employee.role !== "Non précisé" && (!match.role || match.role === "Non précisé")) updates.role = parsed.employee.role;
                if (parsed.hourlyRate && !match.hourlyRate) updates.hourlyRate = parsed.hourlyRate;
                if (parsed.employee.weeklyHours && !match.weeklyHours) updates.weeklyHours = parsed.employee.weeklyHours;
                if (parsed.grossSalary && (!match.monthlySalary || match.monthlySalary === 0)) updates.monthlySalary = parsed.grossSalary;
                if (Object.keys(updates).length > 0) {
                    await db.update(suguMaillaneEmployees).set(updates).where(eq(suguMaillaneEmployees.id, match.id));
                }
            } else {
                const [newEmp] = await db.insert(suguMaillaneEmployees).values({
                    firstName: parsed.employee.firstName || "Inconnu",
                    lastName: parsed.employee.lastName,
                    role: parsed.employee.role || "Non précisé",
                    contractType: parsed.employee.contractType || "CDI",
                    monthlySalary: parsed.grossSalary || null,
                    hourlyRate: parsed.hourlyRate || null,
                    weeklyHours: parsed.employee.weeklyHours || 35,
                    startDate: parsed.employee.startDate || new Date().toISOString().substring(0, 10),
                    isActive: true,
                }).returning();
                employeeId = newEmp.id;
                employeeCreated = true;
            }

            if (employeeId && parsed.period && parsed.grossSalary) {
                const existingPayroll = await db.select().from(suguMaillanePayroll)
                    .where(and(
                        eq(suguMaillanePayroll.employeeId, employeeId),
                        eq(suguMaillanePayroll.period, parsed.period)
                    ));

                sendProgress("Archivage du PDF...");
                let pdfStoragePath: string | null = null;
                try {
                    const timestamp = Date.now();
                    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
                    const storedName = `${timestamp}-${safeName}`;
                    const objectPath = await uploadToObjectStorage(fileBuffer, storedName, fileMime);
                    const [fileRecord] = await db.insert(suguMaillaneFiles).values({
                        fileName: storedName,
                        originalName: fileName,
                        mimeType: fileMime,
                        fileSize: fileSize,
                        category: "rh",
                        fileType: "bulletin_paie",
                        supplier: null,
                        description: `Bulletin de paie - ${parsed.employee.firstName || ""} ${parsed.employee.lastName} - ${parsed.period}`,
                        fileDate: parsed.paymentDate || new Date().toISOString().substring(0, 10),
                        storagePath: objectPath,
                        employeeId: employeeId || null,
                    }).returning();
                    pdfStoragePath = fileRecord.id.toString();
                } catch (pdfErr: any) {
                    console.error("[SUGU-M] Failed to archive payroll PDF:", pdfErr?.message);
                }

                if (existingPayroll.length === 0) {
                    sendProgress("Création de la fiche de paie...");
                    await db.insert(suguMaillanePayroll).values({
                        employeeId,
                        period: parsed.period,
                        grossSalary: parsed.grossSalary,
                        netSalary: parsed.netSalary || 0,
                        socialCharges: parsed.socialCharges || 0,
                        bonus: parsed.bonus || 0,
                        overtime: parsed.overtime || 0,
                        isPaid: true,
                        paidDate: parsed.paymentDate || null,
                        pdfPath: pdfStoragePath,
                        notes: `Import PDF: ${fileName}`,
                    });
                    payrollCreated = true;
                } else {
                    if (pdfStoragePath && !existingPayroll[0].pdfPath) {
                        await db.update(suguMaillanePayroll).set({ pdfPath: pdfStoragePath }).where(eq(suguMaillanePayroll.id, existingPayroll[0].id));
                    }
                    result.warnings.push(`Fiche de paie déjà existante pour ${parsed.period}`);
                }
            }
        }

        const completeResult = {
            parsed: { employee: parsed.employee, period: parsed.period, grossSalary: parsed.grossSalary, netSalary: parsed.netSalary },
            actions: { employeeCreated, employeeId, payrollCreated },
            confidence: result.confidence,
            source: result.source,
            warnings: result.warnings,
        };
        maillaneImportStatusMap.set(importId, { status: "complete", result: completeResult, updatedAt: Date.now() });
        console.log(`[SUGU-M] Import ${importId} completed successfully`);
    } catch (error: any) {
        console.error(`[SUGU-M] Import ${importId} error:`, error?.message || error);
        maillaneImportStatusMap.set(importId, { status: "error", error: error?.message || "Erreur interne", updatedAt: Date.now() });
    }
}

// POST /payroll/reparse-all — Re-parse all RH PDFs from storage and update payroll records
router.post("/payroll/reparse-all", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const { persistentStorageService } = await import("../../services/persistentStorageService");
        
        let rhFiles = await db.select().from(suguMaillaneFiles)
            .where(and(eq(suguMaillaneFiles.category, "rh"), eq(suguMaillaneFiles.fileType, "bulletin_paie")))
            .orderBy(suguMaillaneFiles.id);

        if (rhFiles.length === 0) {
            const allRhFiles = await db.select().from(suguMaillaneFiles)
                .where(eq(suguMaillaneFiles.category, "rh"))
                .orderBy(suguMaillaneFiles.id);
            rhFiles = allRhFiles.filter(f => f.originalName.toLowerCase().includes("bs ") || f.originalName.toLowerCase().includes("bulletin"));
        }

        if (rhFiles.length === 0) return res.json({ message: "No RH files found", results: [] });

        console.log(`[SUGU-M] Reparse: Found ${rhFiles.length} payroll PDFs to re-parse`);
        const results: any[] = [];

        for (const file of rhFiles) {
            try {
                if (!file.storagePath) { results.push({ fileId: file.id, fileName: file.originalName, status: "skipped", reason: "No storage path" }); continue; }
                const buffer = await persistentStorageService.downloadFile(file.storagePath);
                console.log(`[SUGU-M] Reparsing: ${file.originalName} (${buffer.length} bytes)`);
                const parsed = await parsePayrollPDF(buffer, file.originalName);
                if (!parsed.grossSalary || !parsed.netSalary) { results.push({ fileId: file.id, fileName: file.originalName, status: "failed", reason: "Could not extract salary data" }); continue; }
                const period = parsed.period || (() => { const m = file.originalName.match(/(\d{2})(\d{2})\s/); if (m) { const month = parseInt(m[1]); const yr = parseInt(m[2]); const year = yr >= 50 ? 1900 + yr : 2000 + yr; return `${year}-${String(month).padStart(2, '0')}`; } return null; })();
                if (!period) { results.push({ fileId: file.id, fileName: file.originalName, status: "failed", reason: "Could not determine period" }); continue; }
                let employeeId = file.employeeId;
                if (!employeeId && parsed.employee?.lastName) {
                    const existingEmps = await db.select().from(suguMaillaneEmployees);
                    const match = existingEmps.find(e => e.lastName.toUpperCase() === (parsed.employee?.lastName || "").toUpperCase());
                    if (match) { employeeId = match.id; await db.update(suguMaillaneFiles).set({ employeeId }).where(eq(suguMaillaneFiles.id, file.id)); }
                }
                if (!employeeId) { results.push({ fileId: file.id, fileName: file.originalName, status: "failed", reason: "No employee match" }); continue; }
                const existingPayroll = await db.select().from(suguMaillanePayroll).where(and(eq(suguMaillanePayroll.employeeId, employeeId), eq(suguMaillanePayroll.period, period)));
                const payrollData = { grossSalary: parsed.grossSalary, netSalary: parsed.netSalary, socialCharges: parsed.socialCharges || null, bonus: parsed.bonus || null, overtime: parsed.overtime || null, pdfStoragePath: String(file.id) };
                if (existingPayroll.length > 0) {
                    const old = existingPayroll[0];
                    await db.update(suguMaillanePayroll).set(payrollData).where(eq(suguMaillanePayroll.id, old.id));
                    results.push({ fileId: file.id, fileName: file.originalName, status: "updated", employeeId, period, old: { gross: old.grossSalary, net: old.netSalary }, new: { gross: parsed.grossSalary, net: parsed.netSalary }, changed: old.grossSalary !== parsed.grossSalary || old.netSalary !== parsed.netSalary });
                } else {
                    await db.insert(suguMaillanePayroll).values({ employeeId, period, ...payrollData });
                    results.push({ fileId: file.id, fileName: file.originalName, status: "created", employeeId, period, data: { gross: parsed.grossSalary, net: parsed.netSalary } });
                }
            } catch (err: any) {
                console.error(`[SUGU-M] Reparse error for ${file.originalName}:`, err?.message);
                results.push({ fileId: file.id, fileName: file.originalName, status: "error", error: err?.message });
            }
        }
        const updated = results.filter(r => r.status === "updated" && r.changed).length;
        const created = results.filter(r => r.status === "created").length;
        const failed = results.filter(r => r.status === "failed" || r.status === "error").length;
        console.log(`[SUGU-M] Reparse complete: ${updated} updated, ${created} created, ${failed} failed out of ${rhFiles.length} files`);
        res.json({ message: "Reparse complete", total: rhFiles.length, updated, created, failed, results });
    } catch (error: any) {
        console.error("[SUGU-M] Error reparsing payrolls:", error?.message || error);
        res.status(500).json({ error: "Erreur serveur: " + (error?.message || "Unknown") });
    }
});

// Absences
router.get("/absences", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const employeeId = req.query.employeeId ? parseInt(req.query.employeeId as string) : undefined;
        let query = db.select().from(suguMaillaneAbsences);
        if (employeeId) {
            query = query.where(eq(suguMaillaneAbsences.employeeId, employeeId)) as any;
        }
        const data = await query.orderBy(desc(suguMaillaneAbsences.startDate));
        res.json(data);
    } catch (error) {
        console.error("[SUGU-M] Error fetching absences:", error);
        res.status(500).json({ error: "Failed to fetch absences" });
    }
});

router.post("/absences", async (req: Request, res: Response) => {
    console.log("[SUGU-M] POST /absences body:", JSON.stringify(req.body));
    try {
        await tablesReady;
        let parsed: any;
        try {
            parsed = insertSuguMaillaneAbsenceSchema.parse(req.body);
        } catch (zodErr: any) {
            console.error("[SUGU-M] Absence Zod validation failed:", zodErr?.issues || zodErr?.message || zodErr);
            const b = req.body || {};
            parsed = {
                employeeId: typeof b.employeeId === "number" ? b.employeeId : parseInt(b.employeeId) || 0,
                type: b.type || "conge",
                startDate: b.startDate || new Date().toISOString().substring(0, 10),
                endDate: b.endDate || null,
                duration: typeof b.duration === "number" ? b.duration : b.duration ? parseFloat(b.duration) : null,
                isApproved: b.isApproved === true || b.isApproved === "true",
                reason: b.reason || null,
                notes: b.notes || null,
            };
            console.log("[SUGU-M] Using manual fallback for absence:", JSON.stringify(parsed));
        }

        try {
            const [result] = await db.insert(suguMaillaneAbsences).values(parsed).returning();
            console.log("[SUGU-M] Absence created via Drizzle:", result?.id);
            emitSuguAbsencesUpdated();
            res.json(result);
            return;
        } catch (drizzleErr: any) {
            console.error("[SUGU-M] Drizzle insert failed for absence:", drizzleErr?.message || drizzleErr);
            const result = await db.execute(sql`
                INSERT INTO sugum_absences (employee_id, type, start_date, end_date, duration, is_approved, reason, notes)
                VALUES (${parsed.employeeId}, ${parsed.type}, ${parsed.startDate}, ${parsed.endDate}, ${parsed.duration}, ${parsed.isApproved || false}, ${parsed.reason}, ${parsed.notes})
                RETURNING *
            `);
            const row = (result as any).rows?.[0] || (result as any)[0];
            console.log("[SUGU-M] Absence created via raw SQL:", row?.id);
            emitSuguAbsencesUpdated();
            res.json(row);
            return;
        }
    } catch (error: any) {
        console.error("[SUGU-M] FATAL Error creating absence:", error?.message || error);
        res.status(500).json({ error: "Erreur serveur: " + (error?.message || "Unknown") });
    }
});

router.delete("/absences/:id", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const id = parseInt(req.params.id);
        await db.delete(suguMaillaneAbsences).where(eq(suguMaillaneAbsences.id, id));
        emitSuguAbsencesUpdated();
        res.json({ success: true });
    } catch (error) {
        console.error("[SUGU-M] Error deleting absence:", error);
        res.status(500).json({ error: "Failed to delete absence" });
    }
});

// ============ AUDIT / DASHBOARD ============

router.get("/audit/overview", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        let requestedYear = req.query.year as string || new Date().getFullYear().toString();

        const availableYearsResult = await db.execute(sql`
            SELECT DISTINCT y FROM (
                SELECT LEFT(${suguMaillanePurchases.invoiceDate}, 4) AS y FROM ${suguMaillanePurchases} WHERE ${suguMaillanePurchases.invoiceDate} IS NOT NULL
                UNION SELECT LEFT(${suguMaillaneExpenses.period}, 4) AS y FROM ${suguMaillaneExpenses} WHERE ${suguMaillaneExpenses.period} IS NOT NULL
                UNION SELECT LEFT(${suguMaillaneCashRegister.entryDate}, 4) AS y FROM ${suguMaillaneCashRegister} WHERE ${suguMaillaneCashRegister.entryDate} IS NOT NULL
                UNION SELECT LEFT(${suguMaillanePayroll.period}, 4) AS y FROM ${suguMaillanePayroll} WHERE ${suguMaillanePayroll.period} IS NOT NULL
                UNION SELECT LEFT(${suguMaillaneBankEntries.entryDate}, 4) AS y FROM ${suguMaillaneBankEntries} WHERE ${suguMaillaneBankEntries.entryDate} IS NOT NULL
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
                ? db.select().from(suguMaillanePurchases)
                : db.select().from(suguMaillanePurchases).where(sql`${suguMaillanePurchases.invoiceDate} LIKE ${year + '%'}`),
            useAllData
                ? db.select().from(suguMaillaneExpenses)
                : db.select().from(suguMaillaneExpenses).where(sql`${suguMaillaneExpenses.period} LIKE ${year + '%'}`),
            useAllData
                ? db.select().from(suguMaillaneCashRegister)
                : db.select().from(suguMaillaneCashRegister).where(sql`${suguMaillaneCashRegister.entryDate} LIKE ${year + '%'}`),
            useAllData
                ? db.select().from(suguMaillanePayroll)
                : db.select().from(suguMaillanePayroll).where(sql`${suguMaillanePayroll.period} LIKE ${year + '%'}`),
            db.select().from(suguMaillaneEmployees).where(eq(suguMaillaneEmployees.isActive, true)),
            db.select().from(suguMaillaneLoans),
            useAllData
                ? db.select().from(suguMaillaneBankEntries)
                : db.select().from(suguMaillaneBankEntries).where(sql`${suguMaillaneBankEntries.entryDate} LIKE ${year + '%'}`),
        ]);

        const totalRevenue = cashEntries.reduce((s: number, e: any) => s + Number(e.totalRevenue || 0), 0);
        const totalPurchases = purchases.reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
        const totalExpenses = expenses.reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
        const totalPayroll = payrolls.reduce((s: number, e: any) => s + Number(e.grossSalary || 0), 0);
        const totalSocialCharges = payrolls.reduce((s: number, e: any) => s + Number(e.socialCharges || 0), 0);
        const totalLoanPayments = loans.reduce((s: number, l: any) => s + Number(l.monthlyPayment || 0) * 12, 0);
        const totalBankDebits = bankEntries.filter((e: any) => Number(e.amount) < 0).reduce((s: number, e: any) => s + Math.abs(Number(e.amount)), 0);
        const totalBankCredits = bankEntries.filter((e: any) => Number(e.amount) > 0).reduce((s: number, e: any) => s + Number(e.amount), 0);
        console.log(`[SUGU-M-AUDIT] year=${year} (requested=${requestedYear}) purchases=${purchases.length}(${totalPurchases}) expenses=${expenses.length}(${totalExpenses}) payroll=${payrolls.length}(${totalPayroll}) bank=${bankEntries.length} cash=${cashEntries.length}(${totalRevenue}) availableYears=${availableYears.join(',')}`);

        const totalCosts = totalPurchases + totalExpenses + totalPayroll + totalSocialCharges;
        const operatingProfit = totalRevenue - totalCosts;
        const profitMargin = totalRevenue > 0 ? (operatingProfit / totalRevenue) * 100 : 0;

        const totalCovers = cashEntries.reduce((s: number, e: any) => s + Number(e.coversCount || 0), 0);
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
            totalCovers,
            operatingDays,
            avgDailyRevenue: operatingDays > 0 ? totalRevenue / operatingDays : 0,
            avgTicket: totalCovers > 0 ? totalRevenue / totalCovers : 0,
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
        console.error("[SUGU-M] Error fetching audit overview:", error);
        res.status(500).json({ error: "Failed to fetch audit" });
    }
});

// ============ ANOMALY DETECTION ============

router.get("/anomalies", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const days = parseInt(req.query.days as string) || 30;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffStr = cutoff.toISOString().substring(0, 10);

        const [bankEntries, purchases, payrolls, cashEntries] = await Promise.all([
            db.select().from(suguMaillaneBankEntries).orderBy(desc(suguMaillaneBankEntries.entryDate)),
            db.select().from(suguMaillanePurchases),
            db.select().from(suguMaillanePayroll),
            db.select().from(suguMaillaneCashRegister).orderBy(desc(suguMaillaneCashRegister.entryDate)),
        ]);

        const recentBank = bankEntries.filter((e: any) => e.entryDate >= cutoffStr);
        const anomalies: Array<{ type: string; severity: string; description: string }> = [];

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

        const cashDates = new Set(cashEntries.filter((c: any) => c.entryDate >= cutoffStr).map((c: any) => c.entryDate));
        const today = new Date();
        let missingDays = 0;
        for (let d = new Date(cutoff); d <= today; d.setDate(d.getDate() + 1)) {
            const dow = d.getDay();
            if (dow === 0) continue;
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
        console.error("[SUGU-M] Error detecting anomalies:", error);
        res.status(500).json({ error: "Failed to detect anomalies" });
    }
});

// ============ BANK STATEMENT PDF IMPORT ============

router.post("/bank/import-pdf", hybridUpload({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }), async (req: Request, res: Response) => {
    try {
        const file = (req as any).file;
        if (!file) {
            return res.status(400).json({ error: "No PDF file provided" });
        }

        console.log(`[SUGU-M] Bank PDF import: ${file.originalname} (${(file.size / 1024).toFixed(0)} KB)`);

        const result = await parseBankStatementPDF(file.buffer);

        if (!result.success || result.entries.length === 0) {
            return res.status(400).json({
                error: "Aucune opération trouvée dans ce PDF",
                details: result.errors,
            });
        }

        const replaceMode = req.query.replace === "true";

        const existingEntries = await db.select()
            .from(suguMaillaneBankEntries)
            .where(
                and(
                    gte(suguMaillaneBankEntries.entryDate, result.periodStart),
                    lte(suguMaillaneBankEntries.entryDate, result.periodEnd)
                )
            );

        if (replaceMode && existingEntries.length > 0) {
            await db.delete(suguMaillaneBankEntries).where(
                and(
                    gte(suguMaillaneBankEntries.entryDate, result.periodStart),
                    lte(suguMaillaneBankEntries.entryDate, result.periodEnd)
                )
            );
            console.log(`[SUGU-M] Replace mode: deleted ${existingEntries.length} entries for ${result.periodStart}→${result.periodEnd}`);
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

        const inserted = await db.insert(suguMaillaneBankEntries).values(
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

        console.log(`[SUGU-M] Imported ${inserted.length} bank entries (${skippedCount} skipped${replaceMode ? ", replace mode" : ""})`);

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
    } catch (error) {
        console.error("[SUGU-M] PDF import error:", error);
        res.status(500).json({ error: "Erreur lors de l'import du relevé bancaire" });
    }
});

router.post("/bank/import-csv", hybridUpload({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }), async (req: Request, res: Response) => {
    try {
        const file = (req as any).file;
        if (!file) {
            return res.status(400).json({ error: "No CSV file provided" });
        }

        console.log(`[SUGU-M] Bank CSV import: ${file.originalname} (${(file.size / 1024).toFixed(0)} KB)`);

        const csvText = file.buffer.toString("utf-8");
        const result = parseBankStatementCSV(csvText);

        if (!result.success || result.entries.length === 0) {
            return res.status(400).json({
                error: "Aucune opération trouvée dans ce CSV",
                details: result.errors,
            });
        }

        const existingEntries = await db.select()
            .from(suguMaillaneBankEntries)
            .where(
                and(
                    gte(suguMaillaneBankEntries.entryDate, result.periodStart),
                    lte(suguMaillaneBankEntries.entryDate, result.periodEnd)
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

        const inserted = await db.insert(suguMaillaneBankEntries).values(
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

        console.log(`[SUGU-M] CSV Imported ${inserted.length} bank entries (${result.entries.length - newEntries.length} skipped as duplicates)`);

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
    } catch (error) {
        console.error("[SUGU-M] CSV import error:", error);
        res.status(500).json({ error: "Erreur lors de l'import du relevé CSV" });
    }
});

router.post("/bank/import-text", async (req: Request, res: Response) => {
    try {
        const { text } = req.body;
        if (!text || text.length < 50) {
            return res.status(400).json({ error: "Texte trop court ou vide" });
        }

        console.log(`[SUGU-M] Bank text import: ${text.length} chars`);

        const result = parseBankStatementText(text);

        if (!result.success || result.entries.length === 0) {
            return res.status(400).json({
                error: "Aucune opération trouvée dans ce texte",
                details: result.errors,
            });
        }

        const minDate = result.entries[0].entryDate;
        const maxDate = result.entries[result.entries.length - 1].entryDate;

        const existingEntries = await db.select()
            .from(suguMaillaneBankEntries)
            .where(and(
                gte(suguMaillaneBankEntries.entryDate, minDate),
                lte(suguMaillaneBankEntries.entryDate, maxDate)
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

        const inserted = await db.insert(suguMaillaneBankEntries).values(
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

        console.log(`[SUGU-M] Text import: ${inserted.length} entries (${result.entries.length - newEntries.length} dupes skipped)`);

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
    } catch (error) {
        console.error("[SUGU-M] Text import error:", error);
        res.status(500).json({ error: "Erreur lors de l'import texte" });
    }
});

router.post("/bank/import-preview", hybridUpload({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }), async (req: Request, res: Response) => {
    try {
        const file = (req as any).file;
        if (!file) {
            return res.status(400).json({ error: "No PDF file provided" });
        }

        const result = await parseBankStatementPDF(file.buffer);
        res.json(result);
    } catch (error) {
        console.error("[SUGU-M] Preview error:", error);
        res.status(500).json({ error: "Erreur lors de l'analyse du PDF" });
    }
});

// ============ FILES / ARCHIVES ============

async function waitForDb(maxWaitMs = 300000) {
    const start = Date.now();
    let attempt = 0;
    while (Date.now() - start < maxWaitMs) {
        attempt++;
        try {
            await db.execute(sql`SELECT 1`);
            console.log(`[SUGU-M] DB ready after ${attempt} ping(s) (${((Date.now() - start) / 1000).toFixed(1)}s)`);
            return true;
        } catch {
            const wait = Math.min(attempt * 5000, 20000);
            await new Promise(r => setTimeout(r, wait));
        }
    }
    console.error(`[SUGU-M] DB not responsive after ${maxWaitMs / 1000}s`);
    return false;
}

async function ensureSuguMaillaneTables() {
    const isNeon = (process.env.DATABASE_URL || '').includes('neon.tech');
    if (isNeon) {
        console.log("[SUGU-M] Neon detected — waiting 45s for DB warmup before table creation...");
        await new Promise(r => setTimeout(r, 45000));
    } else {
        console.log("[SUGU-M] Local/non-Neon DB — skipping warmup delay, creating tables now...");
    }
    const dbReady = await waitForDb();
    if (!dbReady) return;

    const tables: Array<{ name: string; ddl: ReturnType<typeof sql> }> = [
        {
            name: "sugum_purchases", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugum_purchases (
                id SERIAL PRIMARY KEY, supplier TEXT NOT NULL, description TEXT,
                category TEXT NOT NULL DEFAULT 'alimentaire', amount REAL NOT NULL,
                tax_amount REAL DEFAULT 0, invoice_number TEXT, invoice_date TEXT,
                due_date TEXT, is_paid BOOLEAN NOT NULL DEFAULT FALSE, paid_date TEXT,
                payment_method TEXT, notes TEXT, created_at TIMESTAMP DEFAULT NOW()
            )` },
        {
            name: "sugum_general_expenses", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugum_general_expenses (
                id SERIAL PRIMARY KEY, label TEXT DEFAULT 'Non spécifié',
                category TEXT NOT NULL DEFAULT 'energie', description TEXT NOT NULL DEFAULT '',
                amount REAL NOT NULL, tax_amount REAL DEFAULT 0, period TEXT,
                frequency TEXT DEFAULT 'mensuel', due_date TEXT,
                is_paid BOOLEAN NOT NULL DEFAULT FALSE, paid_date TEXT,
                payment_method TEXT, is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
                notes TEXT, created_at TIMESTAMP DEFAULT NOW()
            )` },
        {
            name: "sugum_files", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugum_files (
                id SERIAL PRIMARY KEY, file_name TEXT NOT NULL, original_name TEXT NOT NULL,
                mime_type TEXT NOT NULL, file_size INTEGER NOT NULL, category TEXT NOT NULL,
                file_type TEXT NOT NULL DEFAULT 'file', supplier TEXT, description TEXT,
                file_date TEXT, storage_path TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW()
            )` },
        {
            name: "sugum_bank_entries", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugum_bank_entries (
                id SERIAL PRIMARY KEY, bank_name TEXT NOT NULL DEFAULT 'Banque Principale',
                entry_date TEXT NOT NULL, label TEXT NOT NULL, amount REAL NOT NULL,
                balance REAL, category TEXT, is_reconciled BOOLEAN NOT NULL DEFAULT FALSE,
                notes TEXT, created_at TIMESTAMP DEFAULT NOW()
            )` },
        {
            name: "sugum_loans", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugum_loans (
                id SERIAL PRIMARY KEY, bank_name TEXT NOT NULL, loan_label TEXT NOT NULL,
                total_amount REAL NOT NULL, remaining_amount REAL NOT NULL,
                monthly_payment REAL NOT NULL, interest_rate REAL,
                start_date TEXT NOT NULL, end_date TEXT, notes TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )` },
        {
            name: "sugum_cash_entries", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugum_cash_entries (
                id SERIAL PRIMARY KEY, entry_date TEXT NOT NULL, total_revenue REAL NOT NULL,
                cash_amount REAL DEFAULT 0, cb_amount REAL DEFAULT 0,
                cbzen_amount REAL DEFAULT 0, tr_amount REAL DEFAULT 0, ctr_amount REAL DEFAULT 0,
                ubereats_amount REAL DEFAULT 0, deliveroo_amount REAL DEFAULT 0,
                cheque_amount REAL DEFAULT 0, virement_amount REAL DEFAULT 0,
                ticket_resto_amount REAL DEFAULT 0, online_amount REAL DEFAULT 0,
                covers_count INTEGER DEFAULT 0, average_ticket REAL DEFAULT 0,
                notes TEXT, created_at TIMESTAMP DEFAULT NOW()
            )` },
        {
            name: "sugum_employees", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugum_employees (
                id SERIAL PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
                role TEXT NOT NULL, contract_type TEXT NOT NULL DEFAULT 'CDI',
                monthly_salary REAL, hourly_rate REAL, weekly_hours REAL DEFAULT 35,
                start_date TEXT NOT NULL, end_date TEXT,
                is_active BOOLEAN NOT NULL DEFAULT TRUE, phone TEXT, email TEXT,
                notes TEXT, created_at TIMESTAMP DEFAULT NOW()
            )` },
        {
            name: "sugum_payroll", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugum_payroll (
                id SERIAL PRIMARY KEY, employee_id INTEGER NOT NULL, period TEXT NOT NULL,
                gross_salary REAL NOT NULL, net_salary REAL NOT NULL,
                social_charges REAL DEFAULT 0, bonus REAL DEFAULT 0, overtime REAL DEFAULT 0,
                is_paid BOOLEAN NOT NULL DEFAULT FALSE, paid_date TEXT,
                notes TEXT, created_at TIMESTAMP DEFAULT NOW()
            )` },
        {
            name: "sugum_absences", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugum_absences (
                id SERIAL PRIMARY KEY, employee_id INTEGER NOT NULL, type TEXT NOT NULL,
                start_date TEXT NOT NULL, end_date TEXT, duration REAL,
                is_approved BOOLEAN NOT NULL DEFAULT FALSE, reason TEXT, notes TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )` },
        {
            name: "sugum_trash", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugum_trash (
                id SERIAL PRIMARY KEY, original_file_id INTEGER,
                file_name TEXT NOT NULL, original_name TEXT NOT NULL,
                mime_type TEXT NOT NULL, file_size INTEGER NOT NULL,
                category TEXT NOT NULL, file_type TEXT NOT NULL DEFAULT 'file',
                supplier TEXT, description TEXT, file_date TEXT,
                storage_path TEXT NOT NULL, emailed_to TEXT[],
                deleted_at TIMESTAMP DEFAULT NOW(),
                expires_at TIMESTAMP NOT NULL
            )` },
    ];

    let ok = 0;
    for (const t of tables) {
        try {
            await db.execute(t.ddl);
            ok++;
            console.log(`[SUGU-M] ${t.name} ensured`);
        } catch (err: any) {
            console.error(`[SUGU-M] Failed to create ${t.name}:`, err?.message);
        }
    }
    console.log(`[SUGU-M] Tables: ${ok}/${tables.length} ensured`);

    const alterStatements = [
        sql`ALTER TABLE sugum_general_expenses ADD COLUMN IF NOT EXISTS label TEXT DEFAULT 'Non spécifié'`,
        sql`ALTER TABLE sugum_general_expenses ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'energie'`,
        sql`ALTER TABLE sugum_general_expenses ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''`,
        sql`ALTER TABLE sugum_general_expenses ADD COLUMN IF NOT EXISTS amount REAL NOT NULL DEFAULT 0`,
        sql`ALTER TABLE sugum_general_expenses ADD COLUMN IF NOT EXISTS tax_amount REAL DEFAULT 0`,
        sql`ALTER TABLE sugum_general_expenses ADD COLUMN IF NOT EXISTS period TEXT`,
        sql`ALTER TABLE sugum_general_expenses ADD COLUMN IF NOT EXISTS frequency TEXT DEFAULT 'mensuel'`,
        sql`ALTER TABLE sugum_general_expenses ADD COLUMN IF NOT EXISTS due_date TEXT`,
        sql`ALTER TABLE sugum_general_expenses ADD COLUMN IF NOT EXISTS is_paid BOOLEAN NOT NULL DEFAULT FALSE`,
        sql`ALTER TABLE sugum_general_expenses ADD COLUMN IF NOT EXISTS paid_date TEXT`,
        sql`ALTER TABLE sugum_general_expenses ADD COLUMN IF NOT EXISTS payment_method TEXT`,
        sql`ALTER TABLE sugum_general_expenses ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT FALSE`,
        sql`ALTER TABLE sugum_general_expenses ADD COLUMN IF NOT EXISTS notes TEXT`,
        sql`ALTER TABLE sugum_general_expenses ADD COLUMN IF NOT EXISTS invoice_number TEXT`,
        sql`ALTER TABLE sugum_purchases ADD COLUMN IF NOT EXISTS supplier TEXT NOT NULL DEFAULT ''`,
        sql`ALTER TABLE sugum_purchases ADD COLUMN IF NOT EXISTS description TEXT`,
        sql`ALTER TABLE sugum_purchases ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'alimentaire'`,
        sql`ALTER TABLE sugum_purchases ADD COLUMN IF NOT EXISTS amount REAL NOT NULL DEFAULT 0`,
        sql`ALTER TABLE sugum_purchases ADD COLUMN IF NOT EXISTS invoice_number TEXT`,
        sql`ALTER TABLE sugum_purchases ADD COLUMN IF NOT EXISTS invoice_date TEXT`,
        sql`ALTER TABLE sugum_purchases ADD COLUMN IF NOT EXISTS due_date TEXT`,
        sql`ALTER TABLE sugum_purchases ADD COLUMN IF NOT EXISTS is_paid BOOLEAN NOT NULL DEFAULT FALSE`,
        sql`ALTER TABLE sugum_purchases ADD COLUMN IF NOT EXISTS paid_date TEXT`,
        sql`ALTER TABLE sugum_purchases ADD COLUMN IF NOT EXISTS payment_method TEXT`,
        sql`ALTER TABLE sugum_purchases ADD COLUMN IF NOT EXISTS notes TEXT`,
        sql`ALTER TABLE sugum_loans ADD COLUMN IF NOT EXISTS original_file_id INTEGER`,
        sql`ALTER TABLE sugum_loans ADD COLUMN IF NOT EXISTS loan_type TEXT NOT NULL DEFAULT 'emprunt'`,
        sql`ALTER TABLE sugum_files ADD COLUMN IF NOT EXISTS employee_id INTEGER`,
        sql`ALTER TABLE sugum_files ADD COLUMN IF NOT EXISTS emailed_to TEXT[]`,
    ];
    for (const stmt of alterStatements) {
        try { await db.execute(stmt); } catch { }
    }
    const cashColumnAlters = [
        sql`ALTER TABLE sugum_cash_entries ADD COLUMN IF NOT EXISTS cbzen_amount REAL DEFAULT 0`,
        sql`ALTER TABLE sugum_cash_entries ADD COLUMN IF NOT EXISTS tr_amount REAL DEFAULT 0`,
        sql`ALTER TABLE sugum_cash_entries ADD COLUMN IF NOT EXISTS ctr_amount REAL DEFAULT 0`,
        sql`ALTER TABLE sugum_cash_entries ADD COLUMN IF NOT EXISTS ubereats_amount REAL DEFAULT 0`,
        sql`ALTER TABLE sugum_cash_entries ADD COLUMN IF NOT EXISTS deliveroo_amount REAL DEFAULT 0`,
        sql`ALTER TABLE sugum_cash_entries ADD COLUMN IF NOT EXISTS cheque_amount REAL DEFAULT 0`,
        sql`ALTER TABLE sugum_cash_entries ADD COLUMN IF NOT EXISTS virement_amount REAL DEFAULT 0`,
    ];
    for (const alter of cashColumnAlters) {
        try { await db.execute(alter); } catch { }
    }

    console.log("[SUGU-M] Column schema sync complete");

    try {
        await db.execute(sql`UPDATE sugum_general_expenses SET category = 'energie' WHERE category != 'energie' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(category, 'é', 'e'), 'É', 'E'), 'è', 'e'), 'È', 'E')) ~* '^[eé]lectricit[eé]$|^[eé]nergie?$|^energy$'`);
        await db.execute(sql`UPDATE sugum_general_expenses SET category = 'telecom' WHERE LOWER(REPLACE(REPLACE(category, 'é', 'e'), 'É', 'e')) IN ('telecom', 'telecommunications', 'telecomunications') AND category != 'telecom'`);
        await db.execute(sql`UPDATE sugum_general_expenses SET category = 'eau' WHERE category != 'eau' AND LOWER(category) = 'eau'`);
    } catch {}

    try {
        await db.execute(sql`UPDATE sugum_general_expenses SET "paymentMethod" = 'prelevement' WHERE ("paymentMethod" IS NULL OR "paymentMethod" = '') AND notes LIKE '%Prélèvement%'`);
        await db.execute(sql`UPDATE sugum_general_expenses SET "paymentMethod" = 'virement' WHERE ("paymentMethod" IS NULL OR "paymentMethod" = '') AND notes LIKE '%Virement%'`);
        await db.execute(sql`UPDATE sugum_general_expenses SET "paymentMethod" = 'cheque' WHERE ("paymentMethod" IS NULL OR "paymentMethod" = '') AND notes LIKE '%Chèque%'`);
        await db.execute(sql`UPDATE sugum_general_expenses SET "paymentMethod" = 'carte' WHERE ("paymentMethod" IS NULL OR "paymentMethod" = '') AND notes LIKE '%Carte%'`);
        await db.execute(sql`UPDATE sugum_general_expenses SET "paymentMethod" = 'especes' WHERE ("paymentMethod" IS NULL OR "paymentMethod" = '') AND notes LIKE '%Espèces%'`);
    } catch {}

    // Backfill: extract invoice numbers from notes into the dedicated invoice_number column
    try {
        const orphans = await db.execute(sql`SELECT id, notes FROM sugum_general_expenses WHERE invoice_number IS NULL AND notes LIKE '%Facture: %'`);
        const rows: any[] = (orphans as any).rows ?? (Array.isArray(orphans) ? orphans : []);
        for (const row of rows) {
            const m = (row.notes || "").match(/Facture:\s*([^\s|]{2,50})/);
            if (m?.[1]) {
                await db.execute(sql`UPDATE sugum_general_expenses SET invoice_number = ${m[1].trim()} WHERE id = ${row.id} AND invoice_number IS NULL`);
            }
        }
        if (rows.length > 0) console.log(`[SUGU-M] Backfilled invoice_number for ${rows.length} expense(s)`);
    } catch (e: any) { console.error("[SUGU-M] invoice_number backfill error:", e?.message); }
}

async function backfillPurchasesFromFiles() {
    try {
        const files = await db.select().from(suguMaillaneFiles).where(eq(suguMaillaneFiles.category, "achats"));
        if (!files.length) return;

        const purchases = await db.select().from(suguMaillanePurchases);

        const orphanFiles = files.filter(f =>
            !purchases.some(p =>
                (p.notes && p.notes.includes(f.originalName)) ||
                (p.description && p.description.includes(f.originalName)) ||
                (p.invoiceNumber && f.originalName.includes(p.invoiceNumber || ""))
            )
        );

        if (!orphanFiles.length) {
            console.log(`[SUGU-M] Backfill: all ${files.length} achats files have linked purchases`);
            return;
        }

        console.log(`[SUGU-M] Backfill: ${orphanFiles.length} achats files without purchases, creating...`);

        for (const f of orphanFiles) {
            try {
                const parsed: ParsedDocumentDataM = { supplier: null, amount: null, taxAmount: null, date: null, dueDate: null, invoiceNumber: null, paymentMethod: null, category: null, siret: null, tvaNumber: null, address: null, city: null, postalCode: null, phone: null, email: null, iban: null };
                // NOTE: PDF parsing is intentionally SKIPPED during startup backfill to prevent
                // EIO crashes when pdf-parse loads its internal PDF.js dependency on GCE production.

                const resolvedSupplier = String(parsed.supplier || f.supplier || f.originalName.replace(/\.[^.]+$/, "") || "Non spécifié");
                const resolvedAmount = typeof parsed.amount === "number" && parsed.amount >= 0 ? parsed.amount : 0;
                const resolvedDate = parsed.date || (f.fileDate ? String(f.fileDate) : new Date().toISOString().substring(0, 10));
                const resolvedPayment = parsed.paymentMethod || null;
                const resolvedInvoice = parsed.invoiceNumber || null;

                const noteParts: string[] = [];
                if (resolvedInvoice) noteParts.push(`Facture: ${resolvedInvoice}`);
                if (resolvedPayment) noteParts.push(`Paiement: ${resolvedPayment}`);
                noteParts.push(`Document: ${f.originalName}`);

                await db.insert(suguMaillanePurchases).values({
                    supplier: resolvedSupplier,
                    description: f.description || `Document: ${f.originalName}`,
                    category: "autre",
                    amount: resolvedAmount,
                    taxAmount: typeof parsed.taxAmount === "number" && parsed.taxAmount >= 0 ? parsed.taxAmount : 0,
                    invoiceNumber: resolvedInvoice,
                    invoiceDate: resolvedDate,
                    isPaid: resolvedAmount > 0,
                    paymentMethod: resolvedPayment,
                    notes: noteParts.join(" | "),
                }).returning();

                console.log(`[SUGU-M] Backfill: created purchase from file "${f.originalName}"`);
            } catch (pErr: any) {
                console.error("[SUGU-M] Failed to backfill purchase for file", f.id, pErr?.message || pErr);
            }
        }

        console.log(`[SUGU-M] Backfill: completed purchases for ${orphanFiles.length} files`);
    } catch (err) {
        console.error("[SUGU-M] Backfill purchases failed:", err);
    }
}

async function backfillBankEntriesFromFiles() {
    try {
        const files = await db.select().from(suguMaillaneFiles).where(eq(suguMaillaneFiles.category, "banque"));
        if (!files.length) return;

        const bankEntries = await db.select().from(suguMaillaneBankEntries);
        const orphanFiles = files.filter(f =>
            f.mimeType === "application/pdf" &&
            !bankEntries.some(b => b.notes && b.notes.includes(f.originalName))
        );

        if (!orphanFiles.length) {
            console.log(`[SUGU-M] Backfill: all ${files.length} banque files have linked entries`);
            return;
        }

        console.log(`[SUGU-M] Backfill: ${orphanFiles.length} banque PDF files without entries, parsing...`);

        for (const f of orphanFiles) {
            try {
                if (f.storagePath.startsWith("uploads/")) {
                    continue;
                }
                let buffer: Buffer;
                try {
                    const result = await downloadFromObjectStorage(f.storagePath);
                    buffer = result.buffer;
                } catch {
                    console.log(`[SUGU-M] Backfill bank: file not found in storage: ${f.storagePath}`);
                    continue;
                }
                const bankResult = await parseBankStatementPDF(buffer);

                if (!bankResult.success || bankResult.entries.length === 0) {
                    console.log(`[SUGU-M] Backfill bank: no entries found in "${f.originalName}"`);
                    continue;
                }

                const existingEntries = await db.select()
                    .from(suguMaillaneBankEntries)
                    .where(
                        and(
                            gte(suguMaillaneBankEntries.entryDate, bankResult.periodStart),
                            lte(suguMaillaneBankEntries.entryDate, bankResult.periodEnd)
                        )
                    );

                const existingSet = new Set(
                    existingEntries.map((e: any) => `${e.entryDate}|${e.amount}|${e.label?.substring(0, 30)}`)
                );
                const newEntries = bankResult.entries.filter(e =>
                    !existingSet.has(`${e.entryDate}|${e.amount}|${e.label.substring(0, 30)}`)
                );

                if (newEntries.length === 0) {
                    console.log(`[SUGU-M] Backfill bank: all ${bankResult.entries.length} entries from "${f.originalName}" already exist`);
                    continue;
                }

                const inserted = await db.insert(suguMaillaneBankEntries).values(
                    newEntries.map(e => ({
                        bankName: bankResult.bankName,
                        entryDate: e.entryDate,
                        label: e.label,
                        amount: e.amount,
                        balance: e.balance,
                        category: e.category,
                        isReconciled: false,
                        notes: `Import PDF ${f.originalName}`,
                    }))
                ).returning();
                console.log(`[SUGU-M] Backfill bank: imported ${inserted.length} entries from "${f.originalName}"`);
            } catch (parseErr: any) {
                console.error(`[SUGU-M] Backfill bank: failed for "${f.originalName}":`, parseErr?.message);
            }
        }
    } catch (err: any) {
        console.error("[SUGU-M] Backfill bank entries failed:", err?.message || err);
    }
}

async function backfillExpensesFromFiles() {
    try {
        const files = await db.select().from(suguMaillaneFiles).where(eq(suguMaillaneFiles.category, "frais_generaux"));
        if (!files.length) return;

        const expenses = await db.select().from(suguMaillaneExpenses);

        const orphanFiles = files.filter(f =>
            !expenses.some(e => e.notes && e.notes.includes(f.originalName))
        );

        if (!orphanFiles.length) {
            console.log(`[SUGU-M] Backfill: all ${files.length} frais_généraux files have linked expenses`);
            return;
        }

        console.log(`[SUGU-M] Backfill: ${orphanFiles.length} frais_généraux files without expenses, creating...`);

        for (const f of orphanFiles) {
            try {
                let parsed: ParsedDocumentDataM = { supplier: null, amount: null, taxAmount: null, date: null, dueDate: null, invoiceNumber: null, paymentMethod: null, category: null, siret: null, tvaNumber: null, address: null, city: null, postalCode: null, phone: null, email: null, iban: null };
                if (f.mimeType === "application/pdf" && !f.storagePath.startsWith("uploads/")) {
                    try {
                        const { buffer } = await downloadFromObjectStorage(f.storagePath);
                        parsed = await parseDocumentPDF_M(buffer, f.originalName);
                    } catch { }
                }

                const resolvedSupplier = String(parsed.supplier || f.supplier || f.originalName.replace(/\.[^.]+$/, "") || "Non spécifié");
                const resolvedAmount = typeof parsed.amount === "number" && parsed.amount !== 0 ? parsed.amount : 0;
                const resolvedDate = parsed.date || (f.fileDate ? String(f.fileDate) : new Date().toISOString().substring(0, 10));
                const resolvedCategory = parsed.category || "autre";
                const period = resolvedDate.substring(0, 7);

                const resolvedTaxAmount = typeof parsed.taxAmount === "number" && parsed.taxAmount >= 0 ? parsed.taxAmount : 0;
                const [expense] = await db.insert(suguMaillaneExpenses).values({
                    label: resolvedSupplier,
                    category: resolvedCategory,
                    description: `Facture ${resolvedSupplier} - ${resolvedDate}`,
                    amount: resolvedAmount,
                    taxAmount: resolvedTaxAmount,
                    period,
                    dueDate: resolvedDate,
                    isPaid: resolvedAmount > 0,
                    paymentMethod: parsed.paymentMethod || null,
                    isRecurring: false,
                    notes: `Document: ${f.originalName}`,
                }).returning();

                console.log(`[SUGU-M] Backfill: created expense #${expense.id} from file "${f.originalName}"`);
            } catch (insertErr: any) {
                console.error(`[SUGU-M] Backfill: failed to create expense for "${f.originalName}":`, insertErr?.message);
            }
        }
    } catch (err: any) {
        console.error("[SUGU-M] Backfill error:", err?.message || err);
    }
}

const tablesReady = ensureSuguMaillaneTables();

const fileUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
});

function extractAmountFromFilename(filename: string): number {
    const nameWithoutExt = filename.replace(/\.[^.]+$/, "");
    const patterns = [
        /(\d+[.,]\d{2})e\b/i,
        /(\d+[.,]\d{2})\s*(?:€|eur)/i,
        /[\s\-_](\d{1,6}[.,]\d{2})[\s\-_]/,
        /[\s\-_](\d{1,6}[.,]\d{2})$/,
    ];
    for (const pat of patterns) {
        const m = nameWithoutExt.match(pat);
        if (m?.[1]) {
            const val = parseFloat(m[1].replace(",", "."));
            if (val > 0 && val < 1_000_000) return val;
        }
    }
    return 0;
}

function extractSupplierFromFilename(filename: string): string | null {
    const nameWithoutExt = filename.replace(/\.[^.]+$/, "");
    const firstPart = nameWithoutExt.split(/[\s_\-]+/)[0];
    if (firstPart && firstPart.length >= 3 && !/^\d+$/.test(firstPart) && !/^(facture|fac|bs|bulletin|paie|doc|document|scan)$/i.test(firstPart)) {
        return firstPart.charAt(0).toUpperCase() + firstPart.slice(1).toLowerCase();
    }
    return null;
}

const KNOWN_SUPPLIER_MAP_M: Record<string, { name: string; category: string }> = {
    "elis": { name: "ELIS", category: "entretien" },
    "metro": { name: "Metro", category: "alimentaire" },
    "sysco": { name: "Sysco", category: "alimentaire" },
    "transgourmet": { name: "Transgourmet", category: "alimentaire" },
    "pomona": { name: "Pomona", category: "alimentaire" },
    "brake": { name: "Brake", category: "alimentaire" },
    "davigel": { name: "Davigel", category: "alimentaire" },
    "promocash": { name: "Promocash", category: "alimentaire" },
    "zouaghi": { name: "Zouaghi", category: "alimentaire" },
    "edf": { name: "EDF", category: "energie" },
    "engie": { name: "ENGIE", category: "energie" },
    "enedis": { name: "Enedis", category: "energie" },
    "grdf": { name: "GRDF", category: "energie" },
    "totalenergies": { name: "TotalEnergies", category: "energie" },
    "orange": { name: "Orange", category: "telecom" },
    "sfr": { name: "SFR", category: "telecom" },
    "bouygues": { name: "Bouygues Telecom", category: "telecom" },
    "free": { name: "Free", category: "telecom" },
    "veolia": { name: "Veolia", category: "eau" },
    "suez": { name: "Suez", category: "eau" },
    "saur": { name: "Saur", category: "eau" },
    "semm": { name: "SEMM Eau de Marseille", category: "eau" },
    "axa": { name: "AXA", category: "assurance" },
    "allianz": { name: "Allianz", category: "assurance" },
    "maif": { name: "MAIF", category: "assurance" },
    "macif": { name: "MACIF", category: "assurance" },
    "groupama": { name: "Groupama", category: "assurance" },
    "mma": { name: "MMA", category: "assurance" },
    "generali": { name: "Generali", category: "assurance" },
    "deliveroo": { name: "Deliveroo", category: "plateformes" },
    "ubereats": { name: "Uber Eats", category: "plateformes" },
    "justeat": { name: "Just Eat", category: "plateformes" },
    "glovo": { name: "Glovo", category: "plateformes" },
    "urssaf": { name: "Urssaf", category: "comptabilite" },
    "see": { name: "SEE Comptable", category: "comptabilite" },
    "lyreco": { name: "Lyreco", category: "fournitures" },
    "manutan": { name: "Manutan", category: "fournitures" },
    "aro": { name: "ARO NEGOCIATION", category: "materiels" },
    "aro negociation": { name: "ARO NEGOCIATION", category: "materiels" },
};

function resolveSupplierFromFilenameM(filename: string): { name: string; category: string } | null {
    const nameWithoutExt = filename.replace(/\.[^.]+$/, "").toLowerCase();
    const parts = nameWithoutExt.split(/[\s_\-]+/);
    for (const part of parts) {
        if (part.length < 2) continue;
        const match = KNOWN_SUPPLIER_MAP_M[part];
        if (match) return match;
    }
    const joined = parts.join("");
    for (const [key, val] of Object.entries(KNOWN_SUPPLIER_MAP_M)) {
        if (joined.includes(key)) return val;
    }
    return null;
}

// Backfill is intentionally NOT auto-run at startup.
// It can be triggered manually via POST /api/v2/sugumaillane/admin/run-backfill

// POST /files/parse-preview — parse a file without saving (for UX confirmation step)
router.post("/files/parse-preview", hybridUpload({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }), async (req: Request, res: Response) => {
    try {
        const file = (req as any).file;
        if (!file) return res.status(400).json({ error: "No file" });
        const { category } = req.body;
        if (!["achats", "frais_generaux"].includes(category || "")) {
            return res.status(400).json({ error: "Preview only available for achats/frais_generaux" });
        }
        const pdfBuffer = Buffer.from(file.buffer);
        let parsed: Partial<ParsedDocumentDataM> | null = null;
        try {
            parsed = await parseDocumentPDF_M(pdfBuffer, file.originalname);
        } catch {
            parsed = null;
        }
        if (!parsed || !parsed.supplier) {
            return res.json({ success: false, message: "Impossible d'extraire les données", parsed: null });
        }
        const confidence = (() => {
            const fields = ["supplier", "amount", "date", "category", "invoiceNumber", "taxAmount"];
            const filled = fields.filter(f => !!(parsed as any)[f]).length;
            return Math.round((filled / fields.length) * 100);
        })();
        const existingSuppliers = await db.select({ id: suguMaillaneSuppliers.id, name: suguMaillaneSuppliers.name }).from(suguMaillaneSuppliers).limit(200);
        const matchedSupplier = existingSuppliers.find(s =>
            s.name.toLowerCase().includes((parsed!.supplier || "").toLowerCase()) ||
            (parsed!.supplier || "").toLowerCase().includes(s.name.toLowerCase())
        );
        res.json({ success: true, parsed, confidence, matchedSupplier: matchedSupplier || null });
    } catch (err: any) {
        console.error("[ParsePreview-M] Error:", err?.message);
        res.status(500).json({ error: "Erreur parsing preview", detail: err?.message });
    }
});

// GET /files
router.get("/files", async (req: Request, res: Response) => {
    try {
        const { category, search, sort, employeeId } = req.query;
        const conditions: any[] = [];
        if (category && typeof category === "string") {
            conditions.push(eq(suguMaillaneFiles.category, category));
        }
        if (search && typeof search === "string") {
            conditions.push(ilike(suguMaillaneFiles.originalName, `%${search}%`));
        }
        if (employeeId && typeof employeeId === "string") {
            conditions.push(eq(suguMaillaneFiles.employeeId, parseInt(employeeId)));
        }

        const data = conditions.length > 0
            ? await db.select().from(suguMaillaneFiles).where(and(...conditions)).orderBy(desc(suguMaillaneFiles.createdAt))
            : await db.select().from(suguMaillaneFiles).orderBy(desc(suguMaillaneFiles.createdAt));
        res.json(data);
    } catch (error) {
        console.error("[SUGU-M] Error fetching files:", error);
        res.status(500).json({ error: "Failed to fetch files" });
    }
});

// POST /files
router.post("/files", hybridUpload({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }), async (req: Request, res: Response) => {
    try {
        const file = (req as any).file;
        if (!file) {
            return res.status(400).json({ error: "No file provided" });
        }

        const { category, fileType, supplier, description, fileDate, amount: formAmount, parsedJson, employeeId } = req.body;
        let previewParsed: ParsedDocumentDataM | null = null;
        if (parsedJson) {
            try { previewParsed = JSON.parse(parsedJson); } catch { /* ignore */ }
        }
        if (!category || !["achats", "frais_generaux", "banque", "rh", "emprunt"].includes(category)) {
            return res.status(400).json({ error: "Catégorie invalide (achats, frais_generaux, banque, rh, emprunt)" });
        }

        const timestamp = Date.now();

        // Auto-rename file using parsed supplier name + invoice number if available
        if (previewParsed) {
            const p = previewParsed;
            const supplierName = (p.supplier || supplier || "").replace(/[^a-zA-Z0-9À-ÿ]/g, "");
            const invoiceNum = (p.invoiceNumber || "").replace(/[^a-zA-Z0-9]/g, "");
            if (supplierName) {
                const ext = file.originalname.substring(file.originalname.lastIndexOf("."));
                const baseName = invoiceNum ? `${supplierName}${invoiceNum}` : `${supplierName}_${timestamp}`;
                let candidateName = `${baseName}${ext}`;
                const dupes = await db.select({ originalName: suguMaillaneFiles.originalName })
                    .from(suguMaillaneFiles)
                    .where(sql`${suguMaillaneFiles.originalName} LIKE ${baseName + '%'} AND ${suguMaillaneFiles.category} = ${category}`);
                if (dupes.length > 0) {
                    candidateName = `${baseName}_${dupes.length + 1}${ext}`;
                }
                console.log(`[SUGU-M] Auto-rename: "${file.originalname}" → "${candidateName}"`);
                file.originalname = candidateName;
            }
        }

        // Rename generic camera filenames to avoid duplicate collisions
        const genericCameraNames = /^(image|photo|img|capture|scan|document|facture|invoice|pic|picture|dsc|screenshot)\d*\.(jpe?g|png|heic|webp)$/i;
        if (genericCameraNames.test(file.originalname)) {
            const ext = file.originalname.substring(file.originalname.lastIndexOf("."));
            const base = file.originalname.substring(0, file.originalname.lastIndexOf("."));
            file.originalname = `${base}_${timestamp}${ext}`;
        }

        // Duplicate file detection
        const existingFiles = await db.select({ id: suguMaillaneFiles.id, originalName: suguMaillaneFiles.originalName })
            .from(suguMaillaneFiles)
            .where(sql`${suguMaillaneFiles.originalName} = ${file.originalname} AND ${suguMaillaneFiles.category} = ${category}`)
            .limit(1);
        if (existingFiles.length > 0) {
            return res.status(409).json({
                error: `Doublon détecté : "${file.originalname}" existe déjà dans cette catégorie (ID #${existingFiles[0].id}). Supprimez-le d'abord si vous voulez le remplacer.`
            });
        }
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storedName = `${timestamp}-${safeName}`;
        const pdfBuffer = Buffer.from(file.buffer);
        const objectPath = await uploadToObjectStorage(file.buffer, storedName, file.mimetype || "application/pdf");

        const [result] = await db.insert(suguMaillaneFiles).values({
            fileName: storedName,
            originalName: file.originalname,
            mimeType: file.mimetype,
            fileSize: file.size,
            category,
            fileType: fileType || "file",
            supplier: supplier || null,
            description: description || null,
            fileDate: fileDate || new Date().toISOString().substring(0, 10),
            storagePath: objectPath,
            employeeId: employeeId ? parseInt(employeeId) : null,
        }).returning();

        console.log(`[SUGU-M] File uploaded: ${file.originalname} → ${category} (${(file.size / 1024).toFixed(0)} KB)`);

        if (category === "frais_generaux") {
            // If frontend already parsed the file (via parse-preview), use that data directly
            if (previewParsed && (previewParsed.supplier || (typeof previewParsed.amount === "number" && previewParsed.amount > 0))) {
                const p = previewParsed;
                const resolvedSupplier = p.supplier || supplier || file.originalname.replace(/\.[^.]+$/, "") || "Non spécifié";
                const userAmount = formAmount ? parseFloat(formAmount) : 0;
                const resolvedAmount = userAmount > 0 ? userAmount : (typeof p.amount === "number" && p.amount > 0 ? p.amount : extractAmountFromFilename(file.originalname));
                const todayStr = new Date().toISOString().substring(0, 10);
                const formDateStr = fileDate ? String(fileDate) : todayStr;
                let resolvedDate = p.date || formDateStr;
                const parsedDateMs = new Date(resolvedDate).getTime();
                const eighteenMonthsAgo = Date.now() - 18 * 30 * 24 * 60 * 60 * 1000;
                const sixMonthsAhead = Date.now() + 6 * 30 * 24 * 60 * 60 * 1000;
                if (isNaN(parsedDateMs) || parsedDateMs < eighteenMonthsAgo || parsedDateMs > sixMonthsAhead) {
                    console.log(`[SUGU-M] Date sanity check failed: AI date "${resolvedDate}" out of range, using form date "${formDateStr}"`);
                    resolvedDate = formDateStr;
                }
                const resolvedTaxAmount = typeof p.taxAmount === "number" && p.taxAmount >= 0 ? p.taxAmount : 0;
                const resolvedInvoice = p.invoiceNumber || null;
                const resolvedPayment = p.paymentMethod || null;
                const resolvedCategory = p.category || "autre";
                const supplierId = await findOrCreateSupplier(p, resolvedSupplier);
                const noteParts: string[] = [];
                if (resolvedInvoice) noteParts.push(`Facture: ${resolvedInvoice}`);
                if (resolvedPayment) noteParts.push(`Paiement: ${resolvedPayment}`);
                noteParts.push(`Document: ${file.originalname}`);
                if (description) noteParts.push(String(description));
                const [expense] = await db.insert(suguMaillaneExpenses).values({
                    label: resolvedSupplier,
                    supplierId,
                    category: resolvedCategory,
                    description: String(description || `Facture ${resolvedSupplier} - ${resolvedDate}`),
                    amount: resolvedAmount,
                    taxAmount: resolvedTaxAmount,
                    period: resolvedDate.substring(0, 7),
                    dueDate: resolvedDate,
                    isPaid: resolvedAmount > 0,
                    paymentMethod: resolvedPayment,
                    invoiceNumber: resolvedInvoice,
                    isRecurring: false,
                    notes: noteParts.join(" | "),
                }).returning();
                console.log(`[SUGU-M] Expense #${expense.id} from preview-parsed data: ${resolvedSupplier} ${resolvedAmount}€ TVA=${resolvedTaxAmount} N°${resolvedInvoice || "—"} date=${resolvedDate}`);
                res.json({ ...result, linkedExpenseId: expense.id, parsedData: p });
                emitSuguFilesUpdated();
                emitSuguExpensesUpdated();
                return;
            }

            let parsed: ParsedDocumentDataM = { supplier: null, amount: null, taxAmount: null, date: null, invoiceNumber: null, paymentMethod: null, category: null, siret: null, tvaNumber: null, address: null, city: null, postalCode: null, phone: null, email: null, iban: null };
            try {
                if (file.mimetype === "application/pdf" && pdfBuffer.length > 0) {
                    parsed = await parseDocumentPDF_M(pdfBuffer, file.originalname);
                    console.log(`[SUGU-M] PDF parsed for expense auto-create:`, JSON.stringify(parsed));
                }
            } catch (parseErr) {
                console.error("[SUGU-M] PDF parse failed (continuing with form metadata):", parseErr);
            }

            try {
                const resolvedSupplier = String(parsed.supplier || supplier || file.originalname.replace(/\.[^.]+$/, "") || "Non spécifié");
                const userAmount = formAmount ? parseFloat(formAmount) : 0;
                const filenameAmount = extractAmountFromFilename(file.originalname);
                const resolvedAmount = (typeof parsed.amount === "number" && parsed.amount !== 0)
                    ? parsed.amount
                    : (userAmount > 0 ? userAmount : (filenameAmount > 0 ? filenameAmount : 0));
                console.log(`[SUGU-M] Amount resolution (expense): pdf=${parsed.amount}, form=${userAmount}, filename=${filenameAmount} -> resolved=${resolvedAmount}`);
                const bgTodayStr = new Date().toISOString().substring(0, 10);
                const bgFormDateStr = fileDate ? String(fileDate) : bgTodayStr;
                let resolvedDate = parsed.date || bgFormDateStr;
                const bgParsedMs = new Date(resolvedDate).getTime();
                const bg18mo = Date.now() - 18 * 30 * 24 * 60 * 60 * 1000;
                const bg6moAhead = Date.now() + 6 * 30 * 24 * 60 * 60 * 1000;
                if (isNaN(bgParsedMs) || bgParsedMs < bg18mo || bgParsedMs > bg6moAhead) {
                    console.log(`[SUGU-M] Background parse date sanity check failed: "${resolvedDate}" out of range, keeping "${bgFormDateStr}"`);
                    resolvedDate = bgFormDateStr;
                }
                const resolvedCategory = parsed.category || "autre";
                const resolvedPayment = parsed.paymentMethod || null;
                const resolvedInvoice = parsed.invoiceNumber || null;
                const period = resolvedDate.substring(0, 7);

                const supplierId = await findOrCreateSupplier(parsed, resolvedSupplier);

                const noteParts: string[] = [];
                if (resolvedInvoice) noteParts.push(`Facture: ${resolvedInvoice}`);
                if (resolvedPayment) noteParts.push(`Paiement: ${resolvedPayment}`);
                noteParts.push(`Document: ${file.originalname}`);
                if (description) noteParts.push(String(description));

                const resolvedTaxAmount = typeof parsed.taxAmount === "number" && parsed.taxAmount >= 0 ? parsed.taxAmount : 0;

                const expenseValues = {
                    label: resolvedSupplier,
                    supplierId: supplierId,
                    category: resolvedCategory,
                    description: String(description || `Facture ${resolvedSupplier} - ${resolvedDate}`),
                    amount: resolvedAmount,
                    taxAmount: resolvedTaxAmount,
                    period,
                    dueDate: resolvedDate,
                    isPaid: resolvedAmount > 0,
                    paymentMethod: resolvedPayment,
                    invoiceNumber: resolvedInvoice,
                    isRecurring: false,
                    notes: noteParts.join(" | "),
                };
                console.log(`[SUGU-M] Inserting expense from upload:`, JSON.stringify(expenseValues));

                const [expense] = await db.insert(suguMaillaneExpenses).values(expenseValues).returning();
                console.log(`[SUGU-M] Auto-created expense #${expense.id}: ${resolvedSupplier} = ${resolvedAmount}€ (${resolvedCategory})`);
                res.json({ ...result, linkedExpenseId: expense.id, parsedData: parsed, supplierId });
                return;
            } catch (expErr: any) {
                console.error("[SUGU-M] Failed to auto-create expense from upload:", expErr?.message || expErr, expErr?.stack);
                res.json({ ...result, autoCreateError: expErr?.message || "Erreur lors de la création automatique du frais" });
                return;
            }
        }

        if (category === "achats") {
            try {
                const createdPurchases: any[] = [];

                // If frontend already parsed the file (via parse-preview), use that data directly
                if (previewParsed && (previewParsed.supplier || (typeof previewParsed.amount === "number" && previewParsed.amount > 0))) {
                    const p = previewParsed;
                    const resolvedSupplier = p.supplier || supplier || extractSupplierFromFilename(file.originalname) || file.originalname.replace(/\.[^.]+$/, "");
                    const userAmount = formAmount ? parseFloat(formAmount) : 0;
                    const resolvedAmount = userAmount > 0 ? userAmount : (typeof p.amount === "number" && p.amount > 0 ? p.amount : extractAmountFromFilename(file.originalname));
                    const acTodayStr = new Date().toISOString().substring(0, 10);
                    const acFormDateStr = fileDate ? String(fileDate) : acTodayStr;
                    let resolvedDate = p.date || acFormDateStr;
                    const acParsedMs = new Date(resolvedDate).getTime();
                    const ac18mo = Date.now() - 18 * 30 * 24 * 60 * 60 * 1000;
                    const ac6moAhead = Date.now() + 6 * 30 * 24 * 60 * 60 * 1000;
                    if (isNaN(acParsedMs) || acParsedMs < ac18mo || acParsedMs > ac6moAhead) {
                        console.log(`[SUGU-M] Date sanity check failed: AI date "${resolvedDate}" out of range, using form date "${acFormDateStr}"`);
                        resolvedDate = acFormDateStr;
                    }
                    const resolvedTaxAmount = typeof p.taxAmount === "number" && p.taxAmount >= 0 ? p.taxAmount : 0;
                    const resolvedInvoice = p.invoiceNumber || null;
                    const resolvedPayment = p.paymentMethod || null;
                    const resolvedCategory = p.category || "alimentaire";
                    const resolvedDueDate = p.dueDate || resolvedDate;
                    const supplierId = await findOrCreateSupplier(p, resolvedSupplier);
                    const noteParts: string[] = [];
                    if (resolvedInvoice) noteParts.push(`Facture: ${resolvedInvoice}`);
                    if (resolvedPayment) noteParts.push(`Paiement: ${resolvedPayment}`);
                    noteParts.push(`Document: ${file.originalname}`);
                    if (description) noteParts.push(String(description));
                    const [purchase] = await db.insert(suguMaillanePurchases).values({
                        supplier: resolvedSupplier,
                        supplierId,
                        description: description || `Document: ${file.originalname}`,
                        category: resolvedCategory,
                        amount: resolvedAmount,
                        taxAmount: resolvedTaxAmount,
                        invoiceNumber: resolvedInvoice,
                        invoiceDate: resolvedDate,
                        dueDate: resolvedDueDate,
                        isPaid: resolvedAmount > 0,
                        paymentMethod: resolvedPayment,
                        notes: noteParts.join(" | "),
                    }).returning();
                    console.log(`[SUGU-M] Purchase #${purchase.id} from preview-parsed data: ${resolvedSupplier} ${resolvedAmount}€ TVA=${resolvedTaxAmount} N°${resolvedInvoice || "—"} date=${resolvedDate}`);
                    res.json({ ...result, linkedPurchaseId: purchase.id, parsedData: p, supplierId });
                    emitSuguFilesUpdated();
                    emitSuguPurchasesUpdated();
                    return;
                }

                if (file.mimetype === "application/pdf" && pdfBuffer.length > 0) {
                    try {
                        const multiParsed = await parseMultiInvoicePDF_M(pdfBuffer, file.originalname);
                        console.log(`[SUGU-M] Multi-invoice result: ${multiParsed.length} invoice(s) from ${file.originalname}`);

                        if (multiParsed.length > 1) {
                            for (let i = 0; i < multiParsed.length; i++) {
                                const parsed = multiParsed[i];
                                const resolvedSupplier = parsed.supplier || supplier || file.originalname.replace(/\.[^.]+$/, "");
                                const resolvedAmount = (typeof parsed.amount === "number" && parsed.amount !== 0) ? parsed.amount : 0;
                                const resolvedDate = parsed.date || (fileDate ? String(fileDate) : new Date().toISOString().substring(0, 10));
                                const resolvedPayment = parsed.paymentMethod || null;
                                const resolvedInvoice = parsed.invoiceNumber || null;
                                const resolvedTaxAmount = typeof parsed.taxAmount === "number" && parsed.taxAmount >= 0 ? parsed.taxAmount : 0;
                                const supplierId = await findOrCreateSupplier(parsed, resolvedSupplier);
                                const noteParts: string[] = [];
                                if (resolvedInvoice) noteParts.push(`Facture: ${resolvedInvoice}`);
                                if (resolvedPayment) noteParts.push(`Paiement: ${resolvedPayment}`);
                                noteParts.push(`Document: ${file.originalname} (facture ${i + 1}/${multiParsed.length})`);
                                if (description) noteParts.push(description);

                                const [purchase] = await db.insert(suguMaillanePurchases).values({
                                    supplier: resolvedSupplier,
                                    supplierId: supplierId,
                                    description: description || `Facture ${i + 1}/${multiParsed.length}: ${resolvedSupplier} - ${resolvedDate}`,
                                    category: parsed.category || "alimentaire",
                                    amount: resolvedAmount,
                                    taxAmount: resolvedTaxAmount,
                                    invoiceNumber: resolvedInvoice,
                                    invoiceDate: resolvedDate,
                                    isPaid: resolvedAmount > 0,
                                    paymentMethod: resolvedPayment,
                                    notes: noteParts.join(" | "),
                                }).returning();
                                createdPurchases.push(purchase);
                                console.log(`[SUGU-M] Multi-invoice: created purchase #${purchase.id} (${i + 1}/${multiParsed.length}): ${resolvedSupplier} = ${resolvedAmount}€`);
                            }
                            res.json({
                                ...result,
                                multiInvoice: true,
                                invoiceCount: multiParsed.length,
                                linkedPurchaseIds: createdPurchases.map(p => p.id),
                                parsedInvoices: multiParsed,
                            });
                            return;
                        }

                        if (multiParsed.length === 1) {
                            const parsed = multiParsed[0];
                            const filenameSupplier = extractSupplierFromFilename(file.originalname);
                            const resolvedSupplier = parsed.supplier || supplier || filenameSupplier || file.originalname.replace(/\.[^.]+$/, "");
                            const userAmount = formAmount ? parseFloat(formAmount) : 0;
                            const filenameAmount = extractAmountFromFilename(file.originalname);
                            const pdfAmount = (typeof parsed.amount === "number" && parsed.amount !== 0) ? parsed.amount : 0;
                            const resolvedAmount = userAmount !== 0 ? userAmount : (pdfAmount !== 0 ? pdfAmount : (filenameAmount > 0 ? filenameAmount : 0));
                            const resolvedDate = parsed.date || (fileDate ? String(fileDate) : new Date().toISOString().substring(0, 10));
                            const resolvedPayment = parsed.paymentMethod || null;
                            const resolvedInvoice = parsed.invoiceNumber || null;
                            const resolvedTaxAmount = typeof parsed.taxAmount === "number" && parsed.taxAmount >= 0 ? parsed.taxAmount : 0;
                            const supplierId = await findOrCreateSupplier(parsed, resolvedSupplier);
                            const noteParts: string[] = [];
                            if (resolvedInvoice) noteParts.push(`Facture: ${resolvedInvoice}`);
                            if (resolvedPayment) noteParts.push(`Paiement: ${resolvedPayment}`);
                            noteParts.push(`Document: ${file.originalname}`);
                            if (description) noteParts.push(description);

                            const [purchase] = await db.insert(suguMaillanePurchases).values({
                                supplier: resolvedSupplier,
                                supplierId: supplierId,
                                description: description || `Document: ${file.originalname}`,
                                category: parsed.category || "autre",
                                amount: resolvedAmount,
                                taxAmount: resolvedTaxAmount,
                                invoiceNumber: resolvedInvoice,
                                invoiceDate: resolvedDate,
                                isPaid: resolvedAmount > 0,
                                paymentMethod: resolvedPayment,
                                notes: noteParts.join(" | "),
                            }).returning();
                            console.log(`[SUGU-M] Auto-created purchase #${purchase.id} from PDF: ${resolvedSupplier} = ${resolvedAmount}€`);
                            res.json({ ...result, linkedPurchaseId: purchase.id, parsedData: parsed, supplierId });
                            return;
                        }
                    } catch (parseErr) {
                        console.error("[SUGU-M] Multi-invoice PDF parse failed (falling back):", parseErr);
                    }
                }

                const filenameSupplier = extractSupplierFromFilename(file.originalname);
                const resolvedSupplier = supplier || filenameSupplier || file.originalname.replace(/\.[^.]+$/, "");
                const userAmount = formAmount ? parseFloat(formAmount) : 0;
                const filenameAmount = extractAmountFromFilename(file.originalname);
                const resolvedAmount = userAmount > 0 ? userAmount : (filenameAmount > 0 ? filenameAmount : 0);
                const resolvedDate = fileDate ? String(fileDate) : new Date().toISOString().substring(0, 10);
                const supplierId = await findOrCreateSupplier({ supplier: resolvedSupplier, amount: resolvedAmount, taxAmount: null, date: resolvedDate, dueDate: null, invoiceNumber: null, paymentMethod: null, category: null, siret: null, tvaNumber: null, address: null, city: null, postalCode: null, phone: null, email: null, iban: null }, resolvedSupplier);
                const [purchase] = await db.insert(suguMaillanePurchases).values({
                    supplier: resolvedSupplier,
                    supplierId: supplierId,
                    description: description || `Document: ${file.originalname}`,
                    category: "autre",
                    amount: resolvedAmount,
                    taxAmount: 0,
                    invoiceDate: resolvedDate,
                    isPaid: resolvedAmount > 0,
                    notes: `Document: ${file.originalname}`,
                }).returning();
                console.log(`[SUGU-M] Fallback purchase #${purchase.id}: ${resolvedSupplier} = ${resolvedAmount}€`);
                res.json({ ...result, linkedPurchaseId: purchase.id, supplierId });
                return;
            } catch (purchErr) {
                console.error("[SUGU-M] Failed to auto-create purchase from upload:", purchErr);
            }
        }

        if (category === "banque" && file.mimetype === "application/pdf" && pdfBuffer.length > 0) {
            try {
                const bankResult = await parseBankStatementPDF(pdfBuffer);
                if (bankResult.success && bankResult.entries.length > 0) {
                    console.log(`[SUGU-M] Bank PDF parsed: ${bankResult.entries.length} entries found (${bankResult.periodStart} → ${bankResult.periodEnd})`);

                    const existingEntries = await db.select()
                        .from(suguMaillaneBankEntries)
                        .where(
                            and(
                                gte(suguMaillaneBankEntries.entryDate, bankResult.periodStart),
                                lte(suguMaillaneBankEntries.entryDate, bankResult.periodEnd)
                            )
                        );

                    const existingSet = new Set(
                        existingEntries.map((e: any) => `${e.entryDate}|${e.amount}|${e.label?.substring(0, 30)}`)
                    );
                    const newEntries = bankResult.entries.filter(e =>
                        !existingSet.has(`${e.entryDate}|${e.amount}|${e.label.substring(0, 30)}`)
                    );

                    if (newEntries.length > 0) {
                        const inserted = await db.insert(suguMaillaneBankEntries).values(
                            newEntries.map(e => ({
                                bankName: bankResult.bankName,
                                entryDate: e.entryDate,
                                label: e.label,
                                amount: e.amount,
                                balance: e.balance,
                                category: e.category,
                                isReconciled: false,
                                notes: `Import PDF ${file.originalname}`,
                            }))
                        ).returning();
                        console.log(`[SUGU-M] Auto-imported ${inserted.length} bank entries from upload (${bankResult.entries.length - newEntries.length} skipped as duplicates)`);
                        res.json({ ...result, bankImport: { imported: inserted.length, skipped: bankResult.entries.length - newEntries.length, period: `${bankResult.periodStart} → ${bankResult.periodEnd}` } });
                        return;
                    } else {
                        console.log(`[SUGU-M] Bank PDF: all ${bankResult.entries.length} entries already exist`);
                        res.json({ ...result, bankImport: { imported: 0, skipped: bankResult.entries.length, period: `${bankResult.periodStart} → ${bankResult.periodEnd}`, message: "Toutes les opérations existent déjà" } });
                        return;
                    }
                } else {
                    console.log(`[SUGU-M] Bank PDF parse: no entries found in ${file.originalname}`, bankResult.errors);
                }
            } catch (bankErr: any) {
                console.error("[SUGU-M] Failed to auto-parse bank PDF:", bankErr?.message || bankErr);
            }
        }

        if (category === "rh" && file.mimetype === "application/pdf" && pdfBuffer.length > 0) {
            const fnLower = (file.originalname || "").toLowerCase();
            const isPayrollPDF = /\b(bs|bulletin|paie|salaire|fiche.de.paie)\b/.test(fnLower) || fileType === "bulletin_paie";
            if (isPayrollPDF) {
                try {
                    const payrollResult = await parsePayrollPDF(pdfBuffer, file.originalname);
                    if (payrollResult.success && payrollResult.data?.employee?.lastName) {
                        const parsed = payrollResult.data;
                        console.log(`[SUGU-M] RH file detected as payroll: ${file.originalname} → ${parsed.employee.firstName} ${parsed.employee.lastName}`);

                        const existingEmps = await db.select().from(suguMaillaneEmployees);
                        const match = existingEmps.find(e =>
                            e.lastName.toLowerCase() === parsed.employee.lastName.toLowerCase() &&
                            e.firstName.toLowerCase() === (parsed.employee.firstName || "").toLowerCase()
                        );

                        let employeeId: number | null = null;
                        let employeeCreated = false;

                        if (match) {
                            employeeId = match.id;
                            console.log(`[SUGU-M] RH auto-link: existing employee ${match.firstName} ${match.lastName} (ID ${match.id})`);
                            const updates: any = {};
                            if (parsed.employee.role && parsed.employee.role !== "Non précisé" && (!match.role || match.role === "Non précisé")) updates.role = parsed.employee.role;
                            if (parsed.hourlyRate && !match.hourlyRate) updates.hourlyRate = parsed.hourlyRate;
                            if (parsed.employee.weeklyHours && !match.weeklyHours) updates.weeklyHours = parsed.employee.weeklyHours;
                            if (parsed.grossSalary && (!match.monthlySalary || match.monthlySalary === 0)) updates.monthlySalary = parsed.grossSalary;
                            if (Object.keys(updates).length > 0) {
                                await db.update(suguMaillaneEmployees).set(updates).where(eq(suguMaillaneEmployees.id, match.id));
                            }
                        } else {
                            const [newEmp] = await db.insert(suguMaillaneEmployees).values({
                                firstName: parsed.employee.firstName || "Inconnu",
                                lastName: parsed.employee.lastName,
                                role: parsed.employee.role || "Non précisé",
                                contractType: parsed.employee.contractType || "CDI",
                                monthlySalary: parsed.grossSalary || null,
                                hourlyRate: parsed.hourlyRate || null,
                                weeklyHours: parsed.employee.weeklyHours || 35,
                                startDate: parsed.employee.startDate || new Date().toISOString().substring(0, 10),
                                isActive: true,
                            }).returning();
                            employeeId = newEmp.id;
                            employeeCreated = true;
                            console.log(`[SUGU-M] RH auto-created employee: ${newEmp.firstName} ${newEmp.lastName} (ID ${newEmp.id})`);
                        }

                        if (employeeId && parsed.period && parsed.grossSalary) {
                            const existingPayroll = await db.select().from(suguMaillanePayroll)
                                .where(and(
                                    eq(suguMaillanePayroll.employeeId, employeeId),
                                    eq(suguMaillanePayroll.period, parsed.period)
                                ));
                            if (existingPayroll.length === 0) {
                                await db.insert(suguMaillanePayroll).values({
                                    employeeId,
                                    period: parsed.period,
                                    grossSalary: parsed.grossSalary,
                                    netSalary: parsed.netSalary || 0,
                                    socialCharges: parsed.socialCharges || 0,
                                    bonus: parsed.bonus || 0,
                                    overtime: parsed.overtime || 0,
                                    isPaid: true,
                                    paidDate: parsed.paymentDate || null,
                                    pdfPath: result.id.toString(),
                                    notes: `Import auto (RH): ${file.originalname}`,
                                });
                                console.log(`[SUGU-M] RH auto-created payroll: ${parsed.period} for employee ${employeeId}`);
                            }
                        }

                        await db.update(suguMaillaneFiles).set({
                            fileType: "bulletin_paie",
                            description: `Bulletin de paie - ${parsed.employee.firstName || ""} ${parsed.employee.lastName} - ${parsed.period || ""}`.trim(),
                        }).where(eq(suguMaillaneFiles.id, result.id));

                        res.json({ ...result, fileType: "bulletin_paie", autoDetected: true, employeeCreated, employeeId, parsed: payrollResult.data });
                        return;
                    }
                } catch (payrollErr) {
                    console.error("[SUGU-M] RH payroll auto-detect failed (continuing as regular file):", payrollErr);
                }
            }
        }

        res.json(result);
    } catch (error) {
        console.error("[SUGU-M] Error uploading file:", error);
        res.status(500).json({ error: "Failed to upload file" });
    }
});

router.get("/files/:id/download", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const [file] = await db.select().from(suguMaillaneFiles).where(eq(suguMaillaneFiles.id, id));
        if (!file) {
            return res.status(404).json({ error: "File not found" });
        }

        const { buffer } = await downloadFromObjectStorage(file.storagePath);
        res.setHeader("Content-Type", file.mimeType);
        res.setHeader("Content-Disposition", `inline; filename="${file.originalName}"`);
        res.send(buffer);
    } catch (error) {
        console.error("[SUGU-M] Error downloading file:", error);
        res.status(500).json({ error: "Failed to download file" });
    }
});

const CATEGORY_LABELS_M: Record<string, string> = {
    achats: "Achats / Factures fournisseurs",
    frais_generaux: "Frais généraux",
    banque: "Relevés bancaires",
    rh: "Ressources humaines",
    emprunt: "Emprunts / Financements",
};

// POST /files/send-email-bulk — send multiple files as attachments in a single email
router.post("/files/send-email-bulk", async (req: Request, res: Response) => {
    try {
        const { to, fileIds } = req.body;
        if (!to || typeof to !== "string" || !to.includes("@")) {
            return res.status(400).json({ error: "Adresse email destinataire invalide" });
        }
        if (!Array.isArray(fileIds) || fileIds.length === 0) {
            return res.status(400).json({ error: "Aucun fichier sélectionné" });
        }

        const files = await db.select().from(suguMaillaneFiles).where(inArray(suguMaillaneFiles.id, fileIds.map(Number)));
        if (files.length === 0) return res.status(404).json({ error: "Aucun fichier trouvé" });

        const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
        const fileDetails: string[] = [];
        for (const file of files) {
            const { buffer } = await downloadFromObjectStorage(file.storagePath);
            attachments.push({ filename: file.originalName, content: buffer, contentType: file.mimeType });
            const categoryLabel = CATEGORY_LABELS_M[file.category] || file.category;
            const parts = [`  • ${file.originalName} (${categoryLabel})`];
            if (file.supplier) parts[0] += ` — ${file.supplier}`;
            fileDetails.push(parts[0]);
        }

        const dateStr = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
        const subject = `[SUGU Maillane] ${files.length} document${files.length > 1 ? "s" : ""} — ${dateStr}`;
        const body = [
            `Bonjour,`,
            ``,
            `Veuillez trouver ci-joint ${files.length} document${files.length > 1 ? "s" : ""} depuis SUGU Maillane :`,
            ``,
            ...fileDetails,
            ``,
            `  • Envoyé le : ${dateStr}`,
            ``,
            `Cordialement,`,
            `SUGU Maillane`,
        ].join("\n");

        const { gmailImapService } = await import("../../services/gmailImapService");
        await gmailImapService.sendSmtp({ to, subject, body, attachments });

        for (const file of files) {
            await db.update(suguMaillaneFiles)
                .set({ emailedTo: sql`array_append(coalesce(emailed_to, '{}'::text[]), ${to}::text)` })
                .where(eq(suguMaillaneFiles.id, file.id));
        }

        console.log(`[SUGU-M] Bulk email: ${files.length} files sent to ${to} (${files.map(f => f.originalName).join(", ")})`);
        res.json({ success: true, message: `${files.length} fichier(s) envoyé(s) à ${to}`, count: files.length });
    } catch (error: any) {
        console.error("[SUGU-M] Error sending bulk email:", error);
        res.status(500).json({ error: "Échec de l'envoi : " + error?.message });
    }
});

// POST /files/:id/send-email — send file as attachment to a given email address
router.post("/files/:id/send-email", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const { to } = req.body;
        if (!to || typeof to !== "string" || !to.includes("@")) {
            return res.status(400).json({ error: "Adresse email destinataire invalide" });
        }

        const [file] = await db.select().from(suguMaillaneFiles).where(eq(suguMaillaneFiles.id, id));
        if (!file) return res.status(404).json({ error: "Fichier introuvable" });

        const { buffer } = await downloadFromObjectStorage(file.storagePath);

        const categoryLabel = CATEGORY_LABELS_M[file.category] || file.category;
        const dateStr = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
        const subject = `[SUGU Maillane] ${file.originalName}`;
        const body = [
            `Bonjour,`,
            ``,
            `Veuillez trouver ci-joint le document suivant depuis SUGU Maillane :`,
            ``,
            `  • Fichier   : ${file.originalName}`,
            `  • Catégorie : ${categoryLabel}`,
            file.supplier ? `  • Fournisseur : ${file.supplier}` : null,
            file.fileDate ? `  • Date doc.  : ${file.fileDate}` : null,
            file.description ? `  • Description : ${file.description}` : null,
            `  • Envoyé le  : ${dateStr}`,
            ``,
            `Cordialement,`,
            `SUGU Maillane`,
        ].filter(Boolean).join("\n");

        const attachment = { filename: file.originalName, content: buffer, contentType: file.mimeType };

        const { gmailImapService } = await import("../../services/gmailImapService");
        await gmailImapService.sendSmtp({ to, subject, body, attachments: [attachment] });

        await db.update(suguMaillaneFiles)
            .set({ emailedTo: sql`array_append(coalesce(emailed_to, '{}'::text[]), ${to}::text)` })
            .where(eq(suguMaillaneFiles.id, id));

        console.log(`[SUGU-M] File ${file.originalName} sent by email to ${to}`);
        res.json({ success: true, message: `Fichier envoyé à ${to}` });
    } catch (error: any) {
        console.error("[SUGU-M] Error sending file by email:", error);
        res.status(500).json({ error: "Échec de l'envoi : " + error?.message });
    }
});

// DELETE /files/:id — soft-delete: move to trash (kept 7 days), file stays in storage
router.delete("/files/:id", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    try {
        const [file] = await db.select().from(suguMaillaneFiles).where(eq(suguMaillaneFiles.id, id));
        if (!file) return res.status(404).json({ error: "File not found" });

        const now = new Date();
        const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        await db.insert(sugumTrash).values({
            originalFileId: file.id,
            fileName: file.fileName,
            originalName: file.originalName,
            mimeType: file.mimeType,
            fileSize: file.fileSize,
            category: file.category,
            fileType: file.fileType,
            supplier: file.supplier,
            description: file.description,
            fileDate: file.fileDate,
            storagePath: file.storagePath,
            emailedTo: file.emailedTo,
            deletedAt: now,
            expiresAt,
        });

        await db.delete(suguMaillaneFiles).where(eq(suguMaillaneFiles.id, id));

        console.log(`[SUGU-M] File ${id} (${file.originalName}) moved to trash — expires ${expiresAt.toISOString()}`);
        emitSuguFilesUpdated();
        res.json({ success: true, expiresAt: expiresAt.toISOString() });
    } catch (error) {
        console.error(`[SUGU-M] Error moving file ${id} to trash:`, error);
        res.status(500).json({ error: "Failed to move file to trash" });
    }
});

// GET /trash — list trash files
router.get("/trash", async (_req: Request, res: Response) => {
    try {
        const items = await db.select().from(sugumTrash).orderBy(desc(sugumTrash.deletedAt));
        res.json(items);
    } catch (error) {
        console.error("[SUGU-M] Error listing trash:", error);
        res.status(500).json({ error: "Failed to list trash" });
    }
});

// POST /trash/:id/restore — restore a file from trash back to suguMaillaneFiles
router.post("/trash/:id/restore", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    try {
        const [item] = await db.select().from(sugumTrash).where(eq(sugumTrash.id, id));
        if (!item) return res.status(404).json({ error: "Trash item not found" });

        await db.insert(suguMaillaneFiles).values({
            fileName: item.fileName,
            originalName: item.originalName,
            mimeType: item.mimeType,
            fileSize: item.fileSize,
            category: item.category,
            fileType: item.fileType,
            supplier: item.supplier,
            description: item.description,
            fileDate: item.fileDate,
            storagePath: item.storagePath,
            emailedTo: item.emailedTo,
        });

        await db.delete(sugumTrash).where(eq(sugumTrash.id, id));

        console.log(`[SUGU-M] Trash item ${id} (${item.originalName}) restored`);
        emitSuguFilesUpdated();
        res.json({ success: true });
    } catch (error) {
        console.error(`[SUGU-M] Error restoring trash item ${id}:`, error);
        res.status(500).json({ error: "Failed to restore file" });
    }
});

// DELETE /trash/:id — permanently delete a trash item (file + storage)
router.delete("/trash/:id", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    try {
        const [item] = await db.select().from(sugumTrash).where(eq(sugumTrash.id, id));
        if (!item) return res.status(404).json({ error: "Trash item not found" });

        await deleteFromObjectStorage(item.storagePath);
        await db.delete(sugumTrash).where(eq(sugumTrash.id, id));

        console.log(`[SUGU-M] Trash item ${id} (${item.originalName}) permanently deleted`);
        res.json({ success: true });
    } catch (error) {
        console.error(`[SUGU-M] Error permanently deleting trash item ${id}:`, error);
        res.status(500).json({ error: "Failed to permanently delete trash item" });
    }
});

// ============ SUPPLIERS (Fournisseurs) ============

interface ParsedDocumentDataM {
    supplier: string | null;
    amount: number | null;
    taxAmount: number | null;
    date: string | null;
    dueDate: string | null;
    invoiceNumber: string | null;
    paymentMethod: string | null;
    category: string | null;
    siret: string | null;
    tvaNumber: string | null;
    address: string | null;
    city: string | null;
    postalCode: string | null;
    phone: string | null;
    email: string | null;
    iban: string | null;
}

let _pdfParseFnM: any = null;
async function getPdfParseM() {
    if (_pdfParseFnM) return _pdfParseFnM;
    const mod = await import("pdf-parse/lib/pdf-parse.js");
    _pdfParseFnM = mod.default || mod;
    return _pdfParseFnM;
}

const CATEGORY_KEYWORDS_M: Record<string, string[]> = {
    energie: ["edf", "engie", "total energie", "gaz", "electricite", "électricité", "kwh", "compteur", "enedis", "grdf", "compteur gaz", "compteur electrique", "consommation electrique"],
    telecom: ["orange", "sfr", "bouygues", "free", "sosh", "internet", "mobile", "fibre", "forfait"],
    assurance: ["axa", "allianz", "maif", "macif", "matmut", "groupama", "assurance", "police", "prime d'assurance"],
    loyer: ["loyer", "bail", "fermage", "location"],
    entretien: ["entretien", "nettoyage", "maintenance", "réparation", "plombier", "electricien", "elis", "linge", "blanchisserie", "pressing", "hygiène", "désinsectisation", "dératisation", "3d"],
    fournitures: ["fourniture", "papeterie", "bureau", "cartouche", "toner"],
    eau: ["eau", "veolia", "suez", "saur", "lyonnaise des eaux", "semm", "eau de marseille", "société des eaux", "assainissement", "seau"],
    comptabilite: ["comptable", "expert-comptable", "expertise comptable", "cabinet comptable", "commissaire aux comptes", "bilan", "see-sugu"],
    emballages: ["emballage", "barquette", "film alimentaire", "papier aluminium", "sac", "sachet", "vaisselle jetable"],
    vehicules: ["auto", "garage", "contrôle technique", "vidange", "pneu", "carburant", "gasoil", "diesel", "essence", "péage", "autoroute", "parking"],
    materiels: ["matériel", "materiel", "équipement", "equipement", "machine", "four", "friteuse", "réfrigérateur", "congélateur", "vitrine", "caisse enregistreuse", "hotte", "variateur", "climatisation", "climatiseur"],
    plateformes: ["deliveroo", "uber eats", "ubereats", "just eat", "justeat", "glovo", "commission plateforme"],
    alimentaire: ["alimentaire", "viande", "poisson", "légume", "fruit", "épice", "huile", "farine", "sucre", "lait", "fromage", "beurre", "oeuf", "volaille", "boeuf", "poulet"],
    boissons: ["boisson", "coca", "orangina", "bière", "vin", "jus", "limonade", "sirop", "eau minérale", "perrier", "evian", "vittel", "badoit"],
    services: ["commission", "frais d'adhésion", "onboarding fee", "relevé de paiement", "frais de service"],
};

const PAYMENT_KEYWORDS_M: Record<string, string[]> = {
    prelevement: ["prélèvement", "prelevement", "prélevé", "preleve", "mandat sepa", "rum", "sepa", "prélèvement sepa", "tip sepa", "avis de prélèvement"],
    virement: ["virement", "rib", "iban", "vir ", "virement bancaire", "virement sepa"],
    cb: ["carte bancaire", "carte bleue", "cb ", "visa", "mastercard", "terminal", "tpe", "paiement carte"],
    cheque: ["chèque", "cheque", "chq"],
    especes: ["espèces", "especes", "cash"],
};

// ============ LOAN DOCUMENT PARSER (MAILLANE) ============

interface ParsedLoanDataM {
    loanLabel?: string;
    bankName?: string;
    loanType?: string;
    totalAmount?: number;
    remainingAmount?: number;
    monthlyPayment?: number;
    interestRate?: number;
    startDate?: string;
    endDate?: string;
    notes?: string;
    confidence?: "high" | "medium" | "low";
    detectedDocType?: string;
}

function parseFrenchAmountM(s: string): number | null {
    const clean = s.replace(/[\s\u00a0]/g, "").replace(",", ".");
    const n = parseFloat(clean);
    return isNaN(n) ? null : n;
}

function parseFrenchDateM(s: string): string | null {
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    return `${m[3]}-${m[2]}-${m[1]}`;
}

function detectBankM(text: string): string | null {
    const checks: [RegExp, string][] = [
        [/soci[eé]t[eé]\s*g[eé]n[eé]rale|professionnels\.sg\.fr|sg\.fr/i, "Société Générale"],
        [/bnp\s*paribas/i, "BNP Paribas"],
        [/cr[eé]dit\s*agricole/i, "Crédit Agricole"],
        [/caisse\s*d['e]?\s*[eé]pargne/i, "Caisse d'Épargne"],
        [/la\s*banque\s*postale/i, "La Banque Postale"],
        [/lcl|le\s*cr[eé]dit\s*lyonnais/i, "LCL"],
        [/cr[eé]dit\s*mutuel/i, "Crédit Mutuel"],
        [/cic\b/i, "CIC"],
        [/bpifrance|bpi\s*france/i, "BPIFrance"],
        [/banque\s*populaire/i, "Banque Populaire"],
        [/hsbc/i, "HSBC"],
    ];
    for (const [rx, name] of checks) {
        if (rx.test(text)) return name;
    }
    return null;
}

// Helper: find value within a window after a label (Maillane)
function findAfterLabelM(text: string, labelRegex: RegExp, valueRegex: RegExp, windowSize = 500): RegExpMatchArray | null {
    const lm = labelRegex.exec(text);
    if (!lm) return null;
    const win = text.substring(lm.index! + lm[0].length, lm.index! + lm[0].length + windowSize);
    return valueRegex.exec(win);
}

async function parseLoanDocumentM(buffer: Buffer, filename?: string): Promise<ParsedLoanDataM> {
    const result: ParsedLoanDataM = { loanType: "emprunt", confidence: "low" };
    let text = "";
    try {
        const pdfParseTimeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("pdf-parse timeout (10s)")), 10000)
        );
        const parsePdf = await getPdfParseM();
        const pdfData = await Promise.race([parsePdf(buffer), pdfParseTimeout]);
        text = pdfData.text || "";
    } catch (e: any) {
        console.warn("[SUGU-M] Loan pdf-parse failed:", e?.message);
    }

    // Normalize ALL Unicode whitespace
    const textNorm = text.replace(/[\s\u00a0\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u200b\u202f\u205f\u3000\ufeff]+/g, " ").trim();
    console.log(`[SUGU-M] Loan PDF text: ${textNorm.length} chars, preview: "${textNorm.substring(0, 200)}"`);

    const isLOA = /location\s+avec\s+option\s+d['\u2019]achat|loa\b|loyer.*option/i.test(textNorm);
    const isLLD = /location\s+longue\s+dur[eé]e|lld\b|leasing.*longue/i.test(textNorm);
    const isAmortTable = /tableau\s+d['\u2019e]amortissement|plan\s+de\s+remboursement|[eé]ch[eé]ancier/i.test(textNorm);
    if (isLOA) result.loanType = "loa";
    else if (isLLD) result.loanType = "lld";
    result.detectedDocType = isAmortTable ? "tableau_amortissement" : isLOA ? "loa" : isLLD ? "lld" : "document_financier";
    const bank = detectBankM(textNorm);
    if (bank) result.bankName = bank;

    const amtPat = /(\d[\d\s]*[,\.]\d{2})/;
    const datePat = /(\d{2}\/\d{2}\/\d{4})/;

    if (text.length > 50) {
        // Montant du prêt (window-based, tolerates column-extracted PDFs)
        const totalAmtM =
            findAfterLabelM(textNorm, /montant\s+du\s+pr[eê]t/i, amtPat, 500) ||
            findAfterLabelM(textNorm, /capital\s+emprunt[eé]/i, amtPat, 300) ||
            findAfterLabelM(textNorm, /montant\s+financ[eé]/i, amtPat, 300) ||
            findAfterLabelM(textNorm, /capital\s+initial/i, amtPat, 300);
        if (totalAmtM) { const v = parseFrenchAmountM(totalAmtM[1]); if (v && v > 1000) result.totalAmount = v; }

        const rateMatch = textNorm.match(/taux\s+d['\u2019e]int[eé]r[eê]t[^%\d]{0,80}(\d+[\.,]\d+)\s*%/i) ||
                          textNorm.match(/taux\s+annuel[^%\d]{0,80}(\d+[\.,]\d+)\s*%/i);
        if (rateMatch) { const v = parseFrenchAmountM(rateMatch[1]); if (v && v < 30) result.interestRate = v; }

        const sigDateM =
            findAfterLabelM(textNorm, /date\s+de\s+signature/i, datePat, 300) ||
            findAfterLabelM(textNorm, /date\s+d['\u2019e]ff?et/i, datePat, 300) ||
            findAfterLabelM(textNorm, /souscrit\s+le/i, datePat, 100);
        if (sigDateM) { const d = parseFrenchDateM(sigDateM[1]); if (d) result.startDate = d; }

        const endDateM =
            findAfterLabelM(textNorm, /date\s+de\s+fin/i, datePat, 300) ||
            findAfterLabelM(textNorm, /derni[eè]re\s+[eé]ch[eé]ance/i, datePat, 200);
        if (endDateM) { const d = parseFrenchDateM(endDateM[1]); if (d) result.endDate = d; }

        const refM = findAfterLabelM(textNorm, /r[eé]f[eé]rence\s+du\s+pr[eê]t/i, /(\w[\w\-]+)/, 200) ||
                     findAfterLabelM(textNorm, /n[°º]\s*de\s+pr[eê]t\s*:?/i, /(\w[\w\-]+)/, 100);
        if (refM) result.notes = `Réf. prêt: ${refM[1]}`;

        // Amortization rows
        const rowRegex = /\b(\d{1,4})\s+(\d{2}\/\d{2}\/\d{4})\s+(?:EUR\s+)?([\d][\d\s]*[,\.]\d{2})\s+([\d][\d\s]*[,\.]\d{2})\s+([\d][\d\s]*[,\.]\d{2})\s+([\d][\d\s]*[,\.]\d{2})\s+([\d][\d\s]*[,\.]\d{2})/g;
        const rows: Array<{ n: number; date: Date; monthly: number; capital: number }> = [];
        let m: RegExpExecArray | null;
        while ((m = rowRegex.exec(textNorm)) !== null) {
            const rowN = parseInt(m[1]);
            if (rowN < 1 || rowN > 600) continue;
            const dateStr = parseFrenchDateM(m[2]);
            const monthly = parseFrenchAmountM(m[3]);
            const capital = parseFrenchAmountM(m[7]);
            if (dateStr && monthly && capital && monthly > 10 && capital > 0) {
                rows.push({ n: rowN, date: new Date(dateStr), monthly, capital });
            }
        }
        console.log(`[SUGU-M] Loan amort rows found: ${rows.length}`);

        if (rows.length > 0) {
            result.monthlyPayment = rows[0].monthly;
            const now = new Date();
            const past = rows.filter(r => r.date <= now);
            if (past.length > 0) result.remainingAmount = past[past.length - 1].capital;
            else result.remainingAmount = result.totalAmount;
            if (!result.endDate && rows.length > 0) result.endDate = rows[rows.length - 1].date.toISOString().split("T")[0];
            result.confidence = "high";
        } else if (result.totalAmount) {
            result.confidence = "medium";
        }

        const emprunteurM = findAfterLabelM(textNorm, /emprunteur/i, /([A-ZÀÂÇÉÈÊËÎÏÔÙÛÜ][A-ZÀÂÇÉÈÊËÎÏÔÙÛÜ\s]{2,40})/, 200);
        if (emprunteurM) {
            const emprunteur = emprunteurM[1].trim().replace(/\s+/g, " ");
            const typeLabel = result.loanType === "loa" ? "LOA" : result.loanType === "lld" ? "LLD" : "Emprunt";
            result.loanLabel = `${typeLabel} ${result.bankName || ""} — ${emprunteur}`.replace(/\s+/g, " ").trim();
        }
    }

    if (!result.totalAmount || !result.monthlyPayment || !result.startDate) {
        try {
            const { getGeminiNativeRequired } = await import("../../services/core/openaiClient");
            const gemini = getGeminiNativeRequired();
            const today = new Date().toISOString().split("T")[0];
            const prompt = `Analyse ce document financier et extrais les infos du prêt. Date du jour: ${today}\n\nTEXTE:\n${text.substring(0, 8000)}\n\nRéponds UNIQUEMENT avec un JSON valide:\n{"loanLabel":"...","bankName":"...","loanType":"emprunt|loa|lld","totalAmount":0,"remainingAmount":0,"monthlyPayment":0,"interestRate":0,"startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","notes":"..."}\n\nREMARQUE: remainingAmount = capital restant dû à la date ${today} (dernière ligne passée du tableau).`;
            const resp = await gemini.models.generateContent({ model: "gemini-2.5-flash", contents: [{ role: "user", parts: [{ text: prompt }] }] });
            const raw = resp.candidates?.[0]?.content?.parts?.[0]?.text || "";
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (typeof parsed.loanLabel === "string" && !result.loanLabel) result.loanLabel = parsed.loanLabel;
                if (typeof parsed.bankName === "string" && !result.bankName) result.bankName = parsed.bankName;
                if (["emprunt","loa","lld"].includes(parsed.loanType)) result.loanType = parsed.loanType;
                if (typeof parsed.totalAmount === "number" && parsed.totalAmount > 0 && !result.totalAmount) result.totalAmount = parsed.totalAmount;
                if (typeof parsed.remainingAmount === "number" && parsed.remainingAmount >= 0 && !result.remainingAmount) result.remainingAmount = parsed.remainingAmount;
                if (typeof parsed.monthlyPayment === "number" && parsed.monthlyPayment > 0 && !result.monthlyPayment) result.monthlyPayment = parsed.monthlyPayment;
                if (typeof parsed.interestRate === "number" && parsed.interestRate > 0 && !result.interestRate) result.interestRate = parsed.interestRate;
                if (typeof parsed.startDate === "string" && parsed.startDate.match(/^\d{4}-\d{2}-\d{2}$/) && !result.startDate) result.startDate = parsed.startDate;
                if (typeof parsed.endDate === "string" && parsed.endDate.match(/^\d{4}-\d{2}-\d{2}$/) && !result.endDate) result.endDate = parsed.endDate;
                if (typeof parsed.notes === "string" && !result.notes) result.notes = parsed.notes;
                if (result.totalAmount && result.confidence === "low") result.confidence = "medium";
            }
        } catch (e: any) { console.error("[SUGU-M] Loan AI parse failed:", e?.message); }
    }

    if (result.totalAmount && result.monthlyPayment && result.startDate) result.confidence = result.confidence === "high" ? "high" : "medium";
    console.log(`[SUGU-M] Loan doc parsed (${result.confidence}): ${result.loanLabel || "?"}, ${result.totalAmount}€`);
    return result;
}

async function parseDocumentWithAI_M(pdfText: string, filename?: string): Promise<Partial<ParsedDocumentDataM> | null> {
    const { getGeminiNativeRequired } = await import("../../services/core/openaiClient");
    const gemini = getGeminiNativeRequired();
    const MAX_CHARS = 12000;
    const truncatedText = pdfText.length > MAX_CHARS
        ? pdfText.substring(0, 8000) + "\n\n[...]\n\n" + pdfText.substring(pdfText.length - 3000)
        : pdfText;
    const filenameHint = filename ? `\nNom du fichier: ${filename}` : "";
    const prompt = `Tu es un expert en extraction de données de factures françaises. Analyse ce texte extrait d'un PDF de facture et extrais les informations suivantes.

RÈGLES CRITIQUES:
- Le FOURNISSEUR est l'ÉMETTEUR de la facture (l'entreprise qui envoie la facture), PAS le client/destinataire. Le client est généralement "SUGU MAILLANE".
- ATTENTION: "ZENORDER" (Pardes Ventures SAS) est une plateforme de commande en ligne. Si le texte contient "ZENORDER" ou "Pardes Ventures" ou "zenorder", le fournisseur est "Zenorder" et la catégorie est "plateformes". Ne PAS confondre avec Saur ou d'autres fournisseurs.
- Le montant TTC est le MONTANT FINAL que le client doit payer. Cherche dans cet ordre de priorité:
  1. "Total à payer" → c'est TOUJOURS le bon montant
  2. "NET A PAYER" → montant final
  3. Le total TTC sur la ligne récapitulative finale (la DERNIÈRE ligne du tableau récapitulatif TVA, pas les lignes intermédiaires)
  4. ATTENTION: Les factures METRO ont un tableau TVA avec plusieurs lignes (ex: 11,00 à 0% + 40,49 à 5.5%). Le montant correct est le TOTAL de ces lignes (ex: 53,72), PAS une ligne individuelle.
- JAMAIS prendre un montant HT partiel ou une ligne TVA individuelle comme montant total.
- Si les montants sont NÉGATIFS (ex: €-22,50), GARDE le signe négatif (ex: -22.50). Les relevés Deliveroo/Uber Eats ont souvent des montants négatifs pour les commissions/frais.
- Pour les relevés de paiement (Deliveroo, Uber Eats, Just Eat):
  * Le MONTANT (amount) est le "Montant total à payer à SUGU" (ce que le restaurant reçoit). Peut être NÉGATIF si c'est un débit (ex: frais d'adhésion = -22,50€ → amount = -22.50)
  * Si le "Montant total à payer" est €0,00 mais qu'il y a des "Débit : frais supplémentaires" (ex: €-22,50), alors le montant est cette valeur négative (ex: -22.50)
  * Le "Montant total de la commande TTC" (ex: 52,50€) n'est PAS le montant ni la TVA - c'est le chiffre d'affaires brut avant commission
  * La TVA (taxAmount) pour les relevés Deliveroo doit être 0 car le document dit "Ceci n'est pas une facture avec la TVA". Ne JAMAIS prendre le "Montant total de la commande" comme TVA
  * ATTENTION: Ne JAMAIS confondre le "Montant total de la commande" avec la TVA. La TVA est toujours un petit montant (quelques euros), jamais le montant total de commande
- Si le total TTC est masqué (XXXXXX), calcule-le en additionnant tous les montants HT des lignes + TVA, ou utilise le montant du filename.
- La date est au format YYYY-MM-DD. Convertir les dates textuelles (ex: "13 oct. 2025" → "2025-10-13").
- Le numéro de facture est un identifiant unique (ex: F2122443, res-fr-530567-5). Pour Deliveroo, c'est le "Facture correspondante".
- La "dueDate" est la date d'échéance / date limite de paiement, au format YYYY-MM-DD. Cherche "échéance", "date limite de paiement", "payable avant le".
- Le "paymentMethod" doit être une des valeurs suivantes: "virement", "chèque", "carte", "espèces", "prélèvement". Null si non trouvé.
- La "category" doit être une des valeurs suivantes: "alimentaire", "boissons", "emballages", "entretien", "comptabilite", "assurances", "vehicules", "plateformes", "materiels", "eau", "energie", "autre". Règles de détection par fournisseur:
  - ELIS → "entretien" (linge/blanchisserie)
  - SEMM, Eau de Marseille → "eau"
  - EDF, ENGIE, Enedis, GRDF → "energie"
  - Deliveroo, Uber Eats, Just Eat, Glovo, Zenorder, EatOffice → "plateformes"
  - Metro, Zouaghi, Promocash, Transgourmet, Pomona → "alimentaire"
  - AXA, Allianz, MAIF, MACIF, Groupama → "assurances"
  - Orange, SFR, Bouygues Telecom, Free → "telecom"
  - Saur, Veolia, Suez, SEMM, Eau de Marseille, Lyonnaise des Eaux → "eau"
${filenameHint}

TEXTE DU PDF:
${truncatedText}

Réponds UNIQUEMENT avec un JSON valide (pas de markdown):
{
  "supplier": "nom du fournisseur émetteur (pas SUGU MAILLANE)",
  "amount": 0.00,
  "taxAmount": 0.00,
  "date": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD ou null",
  "invoiceNumber": "numéro facture",
  "paymentMethod": "virement|chèque|carte|espèces|prélèvement ou null",
  "siret": null,
  "tvaNumber": null,
  "address": null,
  "city": null,
  "postalCode": null,
  "phone": null,
  "email": null,
  "iban": null,
  "category": "alimentaire|boissons|emballages|entretien|comptabilite|assurances|vehicules|plateformes|materiels|eau|energie|telecom|autre"
}`;
    const response = await gemini.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: { temperature: 0, maxOutputTokens: 2048 },
    });
    const responseText = response.text || "";
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    const result: Partial<ParsedDocumentDataM> = {};
    if (parsed.supplier && typeof parsed.supplier === "string" && parsed.supplier.length > 1) {
        const sup = parsed.supplier.trim();
        if (!sup.toLowerCase().includes("sugu") && sup.length <= 80) result.supplier = sup;
    }
    if (typeof parsed.amount === "number" && parsed.amount !== 0) result.amount = Math.round(parsed.amount * 100) / 100;
    if (typeof parsed.taxAmount === "number" && parsed.taxAmount !== 0) {
        const tax = Math.round(parsed.taxAmount * 100) / 100;
        if (result.amount && Math.abs(tax) > Math.abs(result.amount)) {
            console.log(`[SUGU-M] AI taxAmount (${tax}) > amount (${result.amount}) — likely wrong extraction, setting to 0`);
            result.taxAmount = 0;
        } else {
            result.taxAmount = tax;
        }
    }
    if (parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) result.date = parsed.date;
    if (parsed.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(parsed.dueDate)) {
        const yr = parseInt(parsed.dueDate.substring(0, 4));
        if (yr >= 2000 && yr <= 2099) result.dueDate = parsed.dueDate;
    }
    if (parsed.invoiceNumber) result.invoiceNumber = String(parsed.invoiceNumber).trim().substring(0, 30);
    if (parsed.paymentMethod) result.paymentMethod = parsed.paymentMethod;
    if (parsed.siret) result.siret = String(parsed.siret).replace(/\s/g, "").substring(0, 14);
    if (parsed.tvaNumber) result.tvaNumber = String(parsed.tvaNumber).replace(/\s/g, "");
    if (parsed.address) result.address = String(parsed.address).substring(0, 120);
    if (parsed.city) result.city = parsed.city;
    if (parsed.postalCode) result.postalCode = parsed.postalCode;
    if (parsed.phone) result.phone = String(parsed.phone).replace(/[\s.\-]/g, "").substring(0, 15);
    if (parsed.email) result.email = String(parsed.email).toLowerCase();
    if (parsed.iban) result.iban = String(parsed.iban).replace(/\s/g, "");
    if (parsed.category) result.category = parsed.category;
    return result;
}

async function parseDocumentWithGPT4oVision_M(pdfBuffer: Buffer, filename?: string): Promise<Partial<ParsedDocumentDataM> | null> {
    try {
        const { default: OpenAI } = await import("openai");
        const openai = new OpenAI({
            apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
            baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
        });

        const filenameHint = filename ? `\nNom du fichier: ${filename}` : "";
        const prompt = `Tu es un expert en extraction de données de factures françaises. Analyse cette facture et extrais les informations structurées.

RÈGLES STRICTES:
- Le FOURNISSEUR est l'ÉMETTEUR de la facture (celui qui vend/facture), jamais le client. Le client est souvent "SUGU", "Restaurant SUGU", "SAS SUGU" — ne l'inclus JAMAIS comme fournisseur.
- Le montant TTC est le montant FINAL à payer (cherche "Total à payer", "NET A PAYER", "Total TTC", "Montant TTC").
- Si les montants sont négatifs (relevés Deliveroo/Uber/plateforme), garde le signe négatif.
- La date de facture au format YYYY-MM-DD.
- "paymentMethod": "virement", "chèque", "carte", "espèces", "prélèvement" ou null.
- "category" parmi: "alimentaire", "boissons", "emballages", "entretien", "comptabilite", "assurance", "vehicules", "plateformes", "materiels", "eau", "energie", "telecom", "loyer", "travaux", "fournitures", "services", "autre".
${filenameHint}

Réponds UNIQUEMENT avec un objet JSON valide (sans markdown ni \`\`\`):
{"supplier":"nom exact du fournisseur","amount":0.00,"taxAmount":0.00,"date":"YYYY-MM-DD","dueDate":"YYYY-MM-DD ou null","invoiceNumber":"numéro","paymentMethod":null,"siret":null,"tvaNumber":null,"address":null,"city":null,"postalCode":null,"phone":null,"email":null,"iban":null,"category":"catégorie"}`;

        const base64Pdf = pdfBuffer.toString("base64");
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{
                role: "user",
                content: [
                    {
                        type: "file" as any,
                        file: {
                            filename: filename || "document.pdf",
                            file_data: `data:application/pdf;base64,${base64Pdf}`,
                        },
                    } as any,
                    { type: "text", text: prompt },
                ],
            }],
            temperature: 0,
            max_tokens: 1024,
        });

        const responseText = response.choices?.[0]?.message?.content || "";
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;

        const parsed = JSON.parse(jsonMatch[0]);
        const result: Partial<ParsedDocumentDataM> = {};
        if (parsed.supplier && typeof parsed.supplier === "string" && parsed.supplier.length > 1) {
            const sup = parsed.supplier.trim();
            if (!sup.toLowerCase().includes("sugu") && sup.length <= 80) result.supplier = sup;
        }
        if (typeof parsed.amount === "number" && parsed.amount !== 0) result.amount = Math.round(parsed.amount * 100) / 100;
        if (typeof parsed.taxAmount === "number" && parsed.taxAmount !== 0) {
            const tax = Math.round(parsed.taxAmount * 100) / 100;
            if (result.amount && Math.abs(tax) > Math.abs(result.amount)) {
                result.taxAmount = 0;
            } else {
                result.taxAmount = tax;
            }
        }
        if (parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) {
            const yr = parseInt(parsed.date.substring(0, 4));
            if (yr >= 2000 && yr <= 2099) result.date = parsed.date;
        }
        if (parsed.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(parsed.dueDate)) {
            const yr = parseInt(parsed.dueDate.substring(0, 4));
            if (yr >= 2000 && yr <= 2099) result.dueDate = parsed.dueDate;
        }
        if (parsed.invoiceNumber && typeof parsed.invoiceNumber === "string") result.invoiceNumber = parsed.invoiceNumber.trim().substring(0, 30);
        if (parsed.paymentMethod && typeof parsed.paymentMethod === "string") result.paymentMethod = parsed.paymentMethod;
        if (parsed.siret && typeof parsed.siret === "string") result.siret = parsed.siret.replace(/\s/g, "").substring(0, 14);
        if (parsed.tvaNumber && typeof parsed.tvaNumber === "string") result.tvaNumber = parsed.tvaNumber.replace(/\s/g, "");
        if (parsed.address && typeof parsed.address === "string") result.address = parsed.address.substring(0, 120);
        if (parsed.city && typeof parsed.city === "string") result.city = parsed.city;
        if (parsed.postalCode && typeof parsed.postalCode === "string") result.postalCode = parsed.postalCode;
        if (parsed.phone && typeof parsed.phone === "string") result.phone = parsed.phone.replace(/[\s.\-]/g, "").substring(0, 15);
        if (parsed.email && typeof parsed.email === "string") result.email = parsed.email.toLowerCase();
        if (parsed.iban && typeof parsed.iban === "string") result.iban = parsed.iban.replace(/\s/g, "");
        if (parsed.category && typeof parsed.category === "string") result.category = parsed.category;
        console.log(`[SUGU-M] GPT-4o vision: supplier=${result.supplier}, amount=${result.amount}, category=${result.category}`);
        return result;
    } catch (err: any) {
        console.error("[SUGU-M] GPT-4o vision failed:", err?.message);
        return null;
    }
}

async function parseDocumentWithAIVision_M(pdfBuffer: Buffer, filename?: string): Promise<Partial<ParsedDocumentDataM> | null> {
    const { getGeminiNativeRequired } = await import("../../services/core/openaiClient");
    const gemini = getGeminiNativeRequired();

    const filenameHint = filename ? `\nNom du fichier: ${filename}` : "";
    const prompt = `Tu es un expert en extraction de données de factures françaises. Analyse cette facture PDF et extrais les informations.

RÈGLES:
- Le FOURNISSEUR est l'ÉMETTEUR (celui qui envoie la facture), PAS le client/destinataire (le client est souvent "SUGU").
- Le montant TTC est le montant FINAL à payer. Priorité: "Total à payer" > "NET A PAYER" > total TTC récapitulatif.
- Si les montants sont négatifs (relevés Deliveroo/Uber), garde le signe négatif.
- La date au format YYYY-MM-DD.
- "paymentMethod": "virement"|"chèque"|"carte"|"espèces"|"prélèvement" ou null.
- "category" parmi: "alimentaire", "boissons", "emballages", "entretien", "comptabilite", "assurances", "vehicules", "plateformes", "materiels", "eau", "energie", "telecom", "autre". Déduis la catégorie du type de produit/service facturé.
${filenameHint}

Réponds UNIQUEMENT avec un JSON valide (pas de markdown):
{
  "supplier": "nom du fournisseur émetteur",
  "amount": 0.00,
  "taxAmount": 0.00,
  "date": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD ou null",
  "invoiceNumber": "numéro facture",
  "paymentMethod": "virement|chèque|carte|espèces|prélèvement ou null",
  "siret": null,
  "tvaNumber": null,
  "address": "adresse du fournisseur",
  "city": null,
  "postalCode": null,
  "phone": null,
  "email": null,
  "iban": null,
  "category": "catégorie"
}`;

    const base64Pdf = pdfBuffer.toString("base64");
    const response = await gemini.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
            {
                role: "user",
                parts: [
                    { inlineData: { mimeType: "application/pdf", data: base64Pdf } },
                    { text: prompt },
                ],
            },
        ],
        config: { temperature: 0, maxOutputTokens: 2048 },
    });

    const responseText = response.text || "";
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    const result: Partial<ParsedDocumentDataM> = {};
    if (parsed.supplier && typeof parsed.supplier === "string" && parsed.supplier.length > 1) {
        const sup = parsed.supplier.trim();
        if (!sup.toLowerCase().includes("sugu") && sup.length <= 80) result.supplier = sup;
    }
    if (typeof parsed.amount === "number" && parsed.amount !== 0) result.amount = Math.round(parsed.amount * 100) / 100;
    if (typeof parsed.taxAmount === "number" && parsed.taxAmount !== 0) {
        const tax = Math.round(parsed.taxAmount * 100) / 100;
        if (result.amount && Math.abs(tax) > Math.abs(result.amount)) {
            result.taxAmount = 0;
        } else {
            result.taxAmount = tax;
        }
    }
    if (parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) result.date = parsed.date;
    if (parsed.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(parsed.dueDate)) {
        const yr = parseInt(parsed.dueDate.substring(0, 4));
        if (yr >= 2000 && yr <= 2099) result.dueDate = parsed.dueDate;
    }
    if (parsed.invoiceNumber) result.invoiceNumber = String(parsed.invoiceNumber).trim().substring(0, 30);
    if (parsed.paymentMethod) result.paymentMethod = parsed.paymentMethod;
    if (parsed.siret) result.siret = String(parsed.siret).replace(/\s/g, "").substring(0, 14);
    if (parsed.tvaNumber) result.tvaNumber = String(parsed.tvaNumber).replace(/\s/g, "");
    if (parsed.address) result.address = String(parsed.address).substring(0, 120);
    if (parsed.city) result.city = parsed.city;
    if (parsed.postalCode) result.postalCode = parsed.postalCode;
    if (parsed.phone) result.phone = String(parsed.phone).replace(/[\s.\-]/g, "").substring(0, 15);
    if (parsed.email) result.email = String(parsed.email).toLowerCase();
    if (parsed.iban) result.iban = String(parsed.iban).replace(/\s/g, "");
    if (parsed.category) result.category = parsed.category;
    console.log(`[SUGU-M] PDF Vision extraction: supplier=${result.supplier}, amount=${result.amount}, category=${result.category}`);
    return result;
}

async function parseMultiInvoiceWithAI_M(fullText: string, expectedCount: number, filename?: string): Promise<ParsedDocumentDataM[] | null> {
    try {
        const { getGeminiNativeRequired } = await import("../../services/core/openaiClient");
        const gemini = getGeminiNativeRequired();
        const truncated = fullText.substring(0, 120000);
        const prompt = `Tu es un expert en extraction de données de factures françaises. Ce PDF contient PLUSIEURS factures (environ ${expectedCount}) du même fournisseur.
${filename ? `Nom du fichier: ${filename}` : ""}

RÈGLES CRITIQUES:
- Le FOURNISSEUR est l'ÉMETTEUR de la facture (PAS "SUGU VALENTINE" ni "SUGU MAILLANE" qui sont les CLIENTS).
- Chaque facture a son propre numéro, date, et montant NET A PAYER / Total TTC.
- Extrais CHAQUE facture séparément. Ne fusionne PAS les montants.
- Les dates au format JJ/MM/AA doivent être converties en YYYY-MM-DD (ex: 03/11/25 = 2025-11-03, 02/01/26 = 2026-01-02).
- Tu dois extraire TOUTES les factures jusqu'à la fin du document.

FORMAT SPÉCIAL ZOUAGHI (fournisseur: zouaghi-cacher.com):
- Chaque facture commence par "FACTURE CORRESPONDANT AU BL N°Fxxxxxxx DU JJ/MM/AA".
- Le numéro de facture est de type "Fxxxxxxx" (lettre F + 7 chiffres), ex: F2123408.
- La date est affichée sous la colonne "DATE", format JJ/MM/AA, ex: "02/01/26" = 2026-01-02.
- Le montant TTC est la valeur après "NET A PAYER" dans le tableau du bas de chaque facture.
- La TVA est dans le récapitulatif "En Euro XXXXX € X,X% XXXXX €" — la 3ème valeur est le montant TVA.
- Chaque section se termine par "Exemplaire provisoire".
- Mode de règlement: chercher "Chèque", "Virement", "CB" après "Mode de règlement".

TEXTE DU PDF:
${truncated}

Réponds UNIQUEMENT avec un JSON valide (pas de markdown, pas de \`\`\`):
{
  "invoices": [
    {
      "supplier": "nom du fournisseur émetteur",
      "amount": 0.00,
      "taxAmount": 0.00,
      "date": "YYYY-MM-DD",
      "dueDate": "YYYY-MM-DD",
      "invoiceNumber": "numéro facture",
      "paymentMethod": "Chèque",
      "siret": null,
      "tvaNumber": null,
      "address": null,
      "city": null,
      "postalCode": null,
      "phone": null,
      "email": null,
      "iban": null,
      "category": "alimentaire"
    }
  ]
}`;
        const response = await gemini.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: { temperature: 0, maxOutputTokens: 16384 },
        });
        const responseText = response.text || "";
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;
        // Robust JSON parsing with repair for truncated responses
        let parsed: any;
        try {
            parsed = JSON.parse(jsonMatch[0]);
        } catch (jsonErr) {
            console.log(`[SUGU-M] JSON malformed, attempting repair...`);
            const invoiceObjectRegex = /\{[^{}]*"invoiceNumber"[^{}]*\}/g;
            const individualMatches = responseText.match(invoiceObjectRegex) || [];
            if (individualMatches.length > 0) {
                parsed = { invoices: individualMatches.map((s: string) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean) };
                console.log(`[SUGU-M] JSON repair: recovered ${parsed.invoices.length} invoice objects via regex`);
            } else {
                const truncatedJson = jsonMatch[0].replace(/,\s*\{[^}]*$/, ']}}');
                try { parsed = JSON.parse(truncatedJson); console.log(`[SUGU-M] JSON repair: truncated`); }
                catch { console.error(`[SUGU-M] JSON repair failed`); return null; }
            }
        }
        if (!parsed.invoices || !Array.isArray(parsed.invoices) || parsed.invoices.length === 0) return null;
        const results: ParsedDocumentDataM[] = [];
        for (const inv of parsed.invoices) {
            if (!inv.supplier && (!inv.amount || inv.amount <= 0)) continue;
            const sup = (inv.supplier || "").trim();
            if (sup.toLowerCase().includes("sugu")) continue;
            results.push({
                supplier: sup.length > 1 && sup.length <= 80 ? sup : null,
                amount: typeof inv.amount === "number" && inv.amount > 0 ? Math.round(inv.amount * 100) / 100 : null,
                taxAmount: typeof inv.taxAmount === "number" && inv.taxAmount >= 0 ? Math.round(inv.taxAmount * 100) / 100 : null,
                date: inv.date && /^\d{4}-\d{2}-\d{2}$/.test(String(inv.date)) ? String(inv.date) : null,
                dueDate: inv.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(String(inv.dueDate)) ? String(inv.dueDate) : null,
                invoiceNumber: inv.invoiceNumber ? String(inv.invoiceNumber).trim().substring(0, 30) : null,
                paymentMethod: inv.paymentMethod || null,
                category: inv.category || null,
                siret: inv.siret ? String(inv.siret).replace(/\s/g, "").substring(0, 14) : null,
                tvaNumber: inv.tvaNumber ? String(inv.tvaNumber).replace(/\s/g, "") : null,
                address: inv.address ? String(inv.address).substring(0, 120) : null,
                city: inv.city || null,
                postalCode: inv.postalCode || null,
                phone: inv.phone ? String(inv.phone).replace(/[\s.\-]/g, "").substring(0, 15) : null,
                email: inv.email ? String(inv.email).toLowerCase() : null,
                iban: inv.iban ? String(inv.iban).replace(/\s/g, "") : null,
            });
        }
        console.log(`[SUGU-M] AI multi-invoice: extracted ${results.length} valid invoices`);
        return results.length > 0 ? results : null;
    } catch (err: any) {
        console.error(`[SUGU-M] AI multi-invoice extraction failed:`, err?.message);
        return null;
    }
}

function splitTextByInvoicesM(fullText: string): string[] {
    const invoiceStarts: number[] = [];
    let m: RegExpExecArray | null;

    const headerRegex = /\bFacture\b[^\n]*\bNUMERO\b|\bFACTURE\s+CORRESPONDANT\s+AU\s+BL\b/gi;
    while ((m = headerRegex.exec(fullText)) !== null) {
        invoiceStarts.push(m.index);
    }

    if (invoiceStarts.length <= 1) {
        const zouaghiRegex = /Désignation\nDATEREFERENCE/g;
        while ((m = zouaghiRegex.exec(fullText)) !== null) {
            invoiceStarts.push(m.index);
        }
    }

    if (invoiceStarts.length <= 1) {
        invoiceStarts.length = 0;
        const mergedInvoiceRegex = /F\d{7}\d{2}\/\d{2}\/\d{2}/g;
        const positions: number[] = [];
        while ((m = mergedInvoiceRegex.exec(fullText)) !== null) {
            positions.push(m.index);
        }
        if (positions.length > 1) {
            for (const pos of positions) {
                const lookBack = fullText.substring(Math.max(0, pos - 500), pos);
                const sectionStart = lookBack.lastIndexOf("Désignation");
                if (sectionStart !== -1) {
                    invoiceStarts.push(Math.max(0, pos - 500) + sectionStart);
                } else {
                    invoiceStarts.push(pos);
                }
            }
        }
    }

    if (invoiceStarts.length <= 1) {
        invoiceStarts.length = 0;
        const altRegex = /(?:^|\n).*?(?:N°\s*(?:Siret|intracommunautaire)\s*:).*?(?:ADRESSE\s+DE\s+FACTURATION)/gi;
        while ((m = altRegex.exec(fullText)) !== null) {
            if (invoiceStarts.length === 0 || m.index - invoiceStarts[invoiceStarts.length - 1] > 200) {
                invoiceStarts.push(m.index);
            }
        }
    }

    if (invoiceStarts.length <= 1) return [fullText];

    invoiceStarts.sort((a, b) => a - b);
    const unique = [...new Set(invoiceStarts)];

    const chunks: string[] = [];
    for (let i = 0; i < unique.length; i++) {
        const start = unique[i];
        const end = i < unique.length - 1 ? unique[i + 1] : fullText.length;
        const chunk = fullText.substring(start, end).trim();
        if (chunk.length > 100) chunks.push(chunk);
    }
    return chunks.length > 0 ? chunks : [fullText];
}

async function parseMultiInvoicePDF_M(buffer: Buffer, filename?: string): Promise<ParsedDocumentDataM[]> {
    try {
        let text = "";
        try {
            const pdfParseTimeout = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("pdf-parse timeout (10s)")), 10000)
            );
            const parsePdf = await getPdfParseM();
            const pdfData = await Promise.race([parsePdf(buffer), pdfParseTimeout]);
            text = pdfData.text || "";
        } catch (pdfErr: any) {
            console.warn(`[SUGU-M] pdf-parse text extraction failed in multi-invoice (${pdfErr?.message}), using vision fallback`);
        }
        if (!text || text.length < 50) {
            const single = await parseDocumentPDF_M(buffer, filename);
            return (single.supplier || (single.amount && single.amount > 0)) ? [single] : [];
        }

        const chunks = splitTextByInvoicesM(text);
        console.log(`[SUGU-M] Multi-invoice detection: ${chunks.length} invoice(s) in ${filename || 'unknown'} (${text.length} chars)`);

        if (chunks.length <= 1) {
            const aiResult = await parseDocumentWithAI_M(text, filename);
            if (aiResult && (aiResult.supplier || (typeof aiResult.amount === "number" && aiResult.amount > 0))) {
                return [{
                    supplier: aiResult.supplier || null, amount: typeof aiResult.amount === "number" ? aiResult.amount : null,
                    taxAmount: typeof aiResult.taxAmount === "number" ? aiResult.taxAmount : null,
                    date: aiResult.date || null, dueDate: aiResult.dueDate || null, invoiceNumber: aiResult.invoiceNumber || null,
                    paymentMethod: aiResult.paymentMethod || null, category: aiResult.category || null,
                    siret: aiResult.siret || null, tvaNumber: aiResult.tvaNumber || null,
                    address: aiResult.address || null, city: aiResult.city || null,
                    postalCode: aiResult.postalCode || null, phone: aiResult.phone || null,
                    email: aiResult.email || null, iban: aiResult.iban || null,
                }];
            }
            return [];
        }

        const batchResult = await parseMultiInvoiceWithAI_M(text, chunks.length, filename);
        if (batchResult && batchResult.length > 0) return batchResult;

        const results: ParsedDocumentDataM[] = [];
        for (let i = 0; i < chunks.length; i++) {
            try {
                const aiResult = await parseDocumentWithAI_M(chunks[i], `${filename}_invoice_${i + 1}`);
                if (aiResult && (aiResult.supplier || (typeof aiResult.amount === "number" && aiResult.amount > 0))) {
                    results.push({
                        supplier: aiResult.supplier || null, amount: typeof aiResult.amount === "number" ? aiResult.amount : null,
                        taxAmount: typeof aiResult.taxAmount === "number" ? aiResult.taxAmount : null,
                        date: aiResult.date || null, dueDate: aiResult.dueDate || null, invoiceNumber: aiResult.invoiceNumber || null,
                        paymentMethod: aiResult.paymentMethod || null, category: aiResult.category || null,
                        siret: aiResult.siret || null, tvaNumber: aiResult.tvaNumber || null,
                        address: aiResult.address || null, city: aiResult.city || null,
                        postalCode: aiResult.postalCode || null, phone: aiResult.phone || null,
                        email: aiResult.email || null, iban: aiResult.iban || null,
                    });
                }
            } catch (err: any) {
                console.error(`[SUGU-M] Failed to parse invoice chunk ${i + 1}:`, err?.message);
            }
        }
        return results;
    } catch (err: any) {
        console.error(`[SUGU-M] Multi-invoice parse failed:`, err?.message);
        return [];
    }
}

function cleanPdfText_M(raw: string): string {
    return raw
        .split("\n")
        .filter(line => {
            const stripped = line.trim();
            if (stripped.length === 0) return true;
            if (/^\*+$/.test(stripped)) return false;
            if (/^-{3,}$/.test(stripped)) return true;
            if (stripped.length <= 3 && /^[a-zA-ZÀ-ü\*]+$/.test(stripped)) return false;
            return true;
        })
        .join("\n")
        .replace(/\n{4,}/g, "\n\n");
}

async function parseDocumentPDF_M(buffer: Buffer, filename?: string): Promise<ParsedDocumentDataM> {
    const result: ParsedDocumentDataM = {
        supplier: null, amount: null, taxAmount: null, date: null, dueDate: null,
        invoiceNumber: null, paymentMethod: null, category: null,
        siret: null, tvaNumber: null, address: null, city: null,
        postalCode: null, phone: null, email: null, iban: null,
    };

    let text = "";
    let textLower = "";
    let pdfTextExtracted = false;

    try {
        const pdfParseTimeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("pdf-parse timeout (10s)")), 10000)
        );
        const parsePdf = await getPdfParseM();
        const pdfData = await Promise.race([parsePdf(buffer), pdfParseTimeout]);
        text = cleanPdfText_M(pdfData.text || "");
        textLower = text.toLowerCase();
        pdfTextExtracted = text.length >= 20;
    } catch (pdfErr: any) {
        console.warn(`[SUGU-M] pdf-parse text extraction failed (${pdfErr?.message}), will use vision AI`);
    }

    let aiSuccess = false;
    try {
        let aiResult: Partial<ParsedDocumentDataM> | null = null;
        if (pdfTextExtracted) {
            aiResult = await parseDocumentWithAI_M(text, filename);
        }
        if (!aiResult || !(aiResult.supplier && typeof aiResult.amount === "number" && aiResult.amount !== 0)) {
            console.log(`[SUGU-M] Text-based AI ${pdfTextExtracted ? "incomplete" : "skipped (no text)"}, trying GPT-4o vision...`);
            aiResult = await parseDocumentWithGPT4oVision_M(buffer, filename);
        }
        if (!aiResult || !(aiResult.supplier && typeof aiResult.amount === "number" && aiResult.amount !== 0)) {
            console.log(`[SUGU-M] GPT-4o vision incomplete, falling back to Gemini vision...`);
            aiResult = await parseDocumentWithAIVision_M(buffer, filename);
        }
        if (aiResult) {
            if (aiResult.supplier) result.supplier = aiResult.supplier;
            if (typeof aiResult.amount === "number" && aiResult.amount !== 0) result.amount = aiResult.amount;
            if (typeof aiResult.taxAmount === "number" && aiResult.taxAmount >= 0) result.taxAmount = aiResult.taxAmount;
            if (aiResult.date) result.date = aiResult.date;
            if (aiResult.dueDate) result.dueDate = aiResult.dueDate;
            if (aiResult.invoiceNumber) result.invoiceNumber = aiResult.invoiceNumber;
            if (aiResult.paymentMethod) result.paymentMethod = aiResult.paymentMethod;
            if (aiResult.siret) result.siret = aiResult.siret;
            if (aiResult.tvaNumber) result.tvaNumber = aiResult.tvaNumber;
            if (aiResult.address) result.address = aiResult.address;
            if (aiResult.city) result.city = aiResult.city;
            if (aiResult.postalCode) result.postalCode = aiResult.postalCode;
            if (aiResult.phone) result.phone = aiResult.phone;
            if (aiResult.email) result.email = aiResult.email;
            if (aiResult.iban) result.iban = aiResult.iban;
            if (aiResult.category) result.category = aiResult.category;
            aiSuccess = !!(result.supplier && result.amount && result.amount !== 0);
            console.log(`[SUGU-M] AI extraction: supplier=${result.supplier}, amount=${result.amount}, date=${result.date}, invoice=${result.invoiceNumber}`);
        }
    } catch (aiErr: any) {
        console.error(`[SUGU-M] AI extraction failed, using regex fallback:`, aiErr?.message);
    }

    if (!pdfTextExtracted) {
        console.log(`[SUGU-M] PDF text unavailable — regex fallback skipped, AI-only results used`);
        return result;
    }

        // =================================================================
        // AMOUNT OVERRIDE: "Total à payer" is always the definitive amount
        // =================================================================
        const totalAPayerPatterns = [
            /total\s+[àa]\s+payer\s+(\d[\d\s]*[.,]\d{2})/i,
            /total\s+[àa]\s+payer[^€\d]*€?\s*(\d[\d\s]*[.,]\d{2})/i,
            /net\s+[àa]\s+payer(?:\s+en\s+eur)?\s*[\n\r\s]+(\d[\d\s]*[.,]\d{2})/i,
            /net\s+[àa]\s+payer(?:\s+en\s+eur)?[^€\d\n]*€?\s*(\d[\d\s]*[.,]\d{2})/i,
            /(?:CB|CARTE\s+BANCAIRE)[^€\d]*(?:MONTANT\s*=?\s*)(\d[\d\s]*[.,]\d{2})\s*(?:€|EUR)/i,
            /montant\s+eur\s+(\d[\d\s]*[.,]\d{2})/i,
            /MONTANT=\s*(\d[\d\s]*[.,]\d{2})\s*EUR/i,
            /total\s+t\.?t\.?c\.?\s+(\d[\d\s]*[.,]\d{2})\s*(?:€|eur)/i,
            /solde\s+[àa]\s+payer\s*[:\s]*(\d[\d\s]*[.,]\d{2})\s*(?:€|eur)?/i,
            /reste\s+[àa]\s+payer\s*[:\s]*(\d[\d\s]*[.,]\d{2})\s*(?:€|eur)?/i,
            /montant\s+total\s+facture\s*[:\s]*(\d[\d\s]*[.,]\d{2})\s*(?:€|eur)?/i,
        ];
        for (const pat of totalAPayerPatterns) {
            const m = text.match(pat);
            if (m?.[1]) {
                const cleaned = m[1].replace(/\s/g, "").replace(",", ".");
                const val = parseFloat(cleaned);
                if (val > 0 && val < 1_000_000 && (result.amount == null || val > result.amount)) {
                    console.log(`[SUGU-M] Amount override: ${result.amount} → ${val} (from "Total à payer" / CB receipt)`);
                    result.amount = val;
                    break;
                }
            }
        }

        if (!result.supplier) {
            const knownCompanies = [
                "Zenorder", "Pardes Ventures", "ARO NEGOCIATION", "ARO Negociation",
                "Zouaghi", "Metro", "Sysco", "Transgourmet", "Pomona", "Brake", "Davigel",
                "Promocash", "Carrefour", "Auchan", "Leclerc", "Intermarché",
                "EDF", "ENGIE", "Total Energies", "Orange", "SFR", "Bouygues Telecom", "Free",
                "AXA", "Allianz", "MAIF", "MACIF", "Veolia", "Suez", "Saur", "Groupama",
                "Société Générale", "BNP Paribas", "Crédit Agricole", "La Poste",
                "Deliveroo", "Uber Eats", "Just Eat", "Glovo",
                "ELIS", "SEMM", "Eau de Marseille", "Lyonnaise des Eaux", "Enedis", "GRDF",
                "MAAF", "MMA", "Generali", "Covéa", "SMABTP", "Apicil",
                "Sodexo", "Compass", "Elior",
                "Lyreco", "Manutan", "Raja",
                "Métro", "Promocash Cash&Carry",
                "Certas", "TotalEnergies",
                "Edenred", "Sodexo Pass", "Swile",
                "Urssaf", "CIPAV", "AG2R", "Humanis", "Malakoff",
                "Boulanger Pro", "Darty Pro", "IKEA",
                "La Mondiale", "Pro BTP",
            ];
            for (const co of knownCompanies) {
                if (textLower.includes(co.toLowerCase())) { result.supplier = co; break; }
            }
        }

        if (result.amount == null || result.amount === 0) {
            const amountPatterns = [
                /(?:net\s+[àa]\s+payer|montant\s+total\s+[àa]\s+payer)\s*[:\s]*(-?\d[\d\s]*[.,]\d{2})\s*(?:€|eur)?/i,
                /(?:net\s+[àa]\s+payer|montant\s+total\s+[àa]\s+payer)\s*[:\s]*€\s*(-?\d[\d\s]*[.,]\d{2})/i,
                /(?:total\s+t\.?t\.?c\.?|montant\s+t\.?t\.?c\.?)\s*[:\s]*(-?\d[\d\s]*[.,]\d{2})\s*(?:€|eur)?/i,
                /(?:total\s+facture|montant\s+total|total\s+général)\s*[:\s]*(-?\d[\d\s]*[.,]\d{2})\s*(?:€|eur)?/i,
                /€\s*(-?\d[\d\s]*[.,]\d{2})\s*(?:frais|commission|adhésion|onboarding)/i,
                /(?:frais|commission|adhésion|onboarding)[^€\d]*€\s*(-?\d[\d\s]*[.,]\d{2})/i,
                /montant\s+total\s+à\s+payer[^€\d]*€\s*(-?\d[\d\s]*[.,]\d{2})/i,
            ];
            for (const pat of amountPatterns) {
                const m = text.match(pat);
                if (m?.[1]) {
                    const cleaned = m[1].replace(/\s/g, "").replace(",", ".");
                    const val = parseFloat(cleaned);
                    if (val !== 0 && Math.abs(val) < 1_000_000) { result.amount = val; break; }
                }
            }
        }

        if (result.taxAmount === null) {
            const tvaPatterns = [
                /(?:total\s+t\.?v\.?a\.?|montant\s+t\.?v\.?a\.?)[^\d-]*(-?\d[\d\s]*[.,]\d{2})\s*(?:€|eur)?/i,
                /(?:dont\s+t\.?v\.?a\.?)\s*[:\s]*(-?\d[\d\s]*[.,]\d{2})\s*(?:€|eur)?/i,
                /t\.?v\.?a\.?\s*[^\d€]*€\s*(-?\d[\d\s]*[.,]\d{2})/i,
                /montant\s+de\s+tva\s*[^€\d]*€?\s*(-?\d[\d\s]*[.,]\d{2})/i,
            ];
            for (const pat of tvaPatterns) {
                const m = text.match(pat);
                if (m?.[1]) {
                    const cleaned = m[1].replace(/\s/g, "").replace(",", ".");
                    const val = parseFloat(cleaned);
                    if (val >= 0 && val < 1_000_000) { result.taxAmount = val; break; }
                }
            }
        }

        if (!result.date) {
            const frenchMonths: Record<string, string> = {
                "janvier": "01", "janv": "01", "jan": "01",
                "février": "02", "fevrier": "02", "fév": "02", "fev": "02", "feb": "02",
                "mars": "03", "mar": "03",
                "avril": "04", "avr": "04", "apr": "04",
                "mai": "05",
                "juin": "06", "jun": "06",
                "juillet": "07", "juil": "07", "jul": "07",
                "août": "08", "aout": "08", "aoû": "08",
                "septembre": "09", "sept": "09", "sep": "09",
                "octobre": "10", "oct": "10",
                "novembre": "11", "nov": "11",
                "décembre": "12", "decembre": "12", "déc": "12", "dec": "12",
            };
            const frenchDateMatch = text.match(/(\d{1,2})\s+(janv(?:ier)?|f[ée]v(?:rier)?|mars|avr(?:il)?|mai|juin|juil(?:let)?|ao[uû]t|sept(?:embre)?|oct(?:obre)?|nov(?:embre)?|d[ée]c(?:embre)?)\s*\.?\s*(\d{4})/i);
            if (frenchDateMatch) {
                const day = frenchDateMatch[1].padStart(2, "0");
                const monthKey = frenchDateMatch[2].toLowerCase().replace(".", "");
                const monthNum = frenchMonths[monthKey];
                const year = frenchDateMatch[3];
                if (monthNum) {
                    const yr = parseInt(year);
                    if (yr >= 2000 && yr <= 2099) {
                        result.date = `${year}-${monthNum}-${day}`;
                    }
                }
            }
            if (!result.date) {
                const datePatterns = [
                    /(?:date\s+(?:de\s+)?factur(?:e|ation)|date\s+d'émission)\s*[:\s]*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/i,
                    /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/,
                ];
                for (const pat of datePatterns) {
                    const m = text.match(pat);
                    if (m) {
                        const day = m[1].padStart(2, "0");
                        const month = m[2].padStart(2, "0");
                        let year = m[3];
                        if (year.length === 2) year = (parseInt(year) > 50 ? "19" : "20") + year;
                        const mo = parseInt(month), da = parseInt(day), yr = parseInt(year);
                        if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31 && yr >= 2000 && yr <= 2099) {
                            result.date = `${year}-${month}-${day}`;
                            break;
                        }
                    }
                }
            }
        }

        if (!result.dueDate) {
            const dueDatePatterns = [
                /(?:date\s+d'[ée]ch[ée]ance|[ée]ch[ée]ance|date\s+limite\s+de\s+paiement|payable\s+(?:avant|le))\s*[:\s]*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/i,
                /(?:[ée]ch[ée]ance|paiement)\s+le\s+(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/i,
            ];
            for (const pat of dueDatePatterns) {
                const m = text.match(pat);
                if (m) {
                    const day = m[1].padStart(2, "0");
                    const month = m[2].padStart(2, "0");
                    let year = m[3];
                    if (year.length === 2) year = (parseInt(year) > 50 ? "19" : "20") + year;
                    const mo = parseInt(month), da = parseInt(day), yr = parseInt(year);
                    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31 && yr >= 2000 && yr <= 2099) {
                        result.dueDate = `${year}-${month}-${day}`;
                        break;
                    }
                }
            }
        }

        if (!result.invoiceNumber) {
            const invoicePatterns = [
                /(?:facture\s*n[°o]?|n[°o]\s*(?:de\s+)?facture)\s*[:\s]*([A-Z0-9][\w\-\/]{2,30})/i,
                /(?:facture\s+correspondante|référence\s+facture|réf\s*\.?\s*facture)\s*[:\s]*([A-Za-z0-9][\w\-\/]{2,40})/i,
                /(?:relevé|releve)\s+(?:de\s+)?(?:paiement|facturation)\s*.*?(?:facture[^:]*:\s*)([A-Za-z0-9][\w\-\/]{2,40})/is,
                /\b(res-[a-z]{2}-\d{4,}-\d+)\b/i,
                /\b([A-Z]{1,4}\d{5,})\b/,
            ];
            for (const pat of invoicePatterns) {
                const m = text.match(pat);
                if (m?.[1]) { result.invoiceNumber = m[1].trim(); break; }
            }
        }

        if (!result.paymentMethod) {
            for (const [method, keywords] of Object.entries(PAYMENT_KEYWORDS_M)) {
                if (keywords.some(kw => textLower.includes(kw))) {
                    result.paymentMethod = method === "prelevement" ? "prélèvement"
                        : method === "cheque" ? "chèque"
                            : method === "especes" ? "espèces"
                                : method;
                    break;
                }
            }
        }

        if (!result.category) {
            for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS_M)) {
                if (keywords.some(kw => textLower.includes(kw))) {
                    result.category = cat;
                    break;
                }
            }
        }

        if (!result.siret) {
            const siretMatch = text.match(/(?:siret|siren)\s*[:\s]*(\d[\d\s]{8,16}\d)/i);
            if (siretMatch?.[1]) result.siret = siretMatch[1].replace(/\s/g, "").substring(0, 14);
        }

        if (!result.tvaNumber) {
            const tvaNumMatch = text.match(/(?:tva\s+intra|n[°o]\s*tva|identifiant\s+tva)\s*[:\s]*(FR\s*\d{2}\s*\d{3}\s*\d{3}\s*\d{3})/i);
            if (tvaNumMatch?.[1]) result.tvaNumber = tvaNumMatch[1].replace(/\s/g, "");
        }

        if (!result.postalCode) {
            const postalMatch = text.match(/(\d{5})\s+([A-ZÀ-Ÿ][A-ZÀ-Ÿa-zà-ÿ\s\-]{1,40})/);
            if (postalMatch) {
                result.postalCode = postalMatch[1];
                if (!result.city) result.city = postalMatch[2].trim();
            }
        }
        if (!result.address) {
            const lines = text.split("\n").map((l: string) => l.trim()).filter((l: string) => l.length > 0);
            for (let i = 0; i < Math.min(lines.length, 15); i++) {
                if (/\d{1,4}[\s,]+(rue|avenue|boulevard|bd|av\.|allée|chemin|impasse|place|route)\b/i.test(lines[i])) {
                    result.address = lines[i].substring(0, 120);
                    break;
                }
            }
        }

        if (!result.phone) {
            const phoneMatch = text.match(/(?:t[ée]l[ée]?phone|t[ée]l\.?|tel\s*:)\s*[:\s]*((?:\+33|0)\s*[\d\s.\-]{8,14})/i)
                || text.match(/((?:\+33|0)\d[\s.\-]?\d{2}[\s.\-]?\d{2}[\s.\-]?\d{2}[\s.\-]?\d{2})/);
            if (phoneMatch?.[1]) result.phone = phoneMatch[1].replace(/[\s.\-]/g, "").substring(0, 15);
        }

        if (!result.email) {
            const emailMatch = text.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/);
            if (emailMatch?.[1]) result.email = emailMatch[1].toLowerCase();
        }

        if (!result.iban) {
            const ibanMatch = text.match(/(?:iban)\s*[:\s]*(FR\d{2}\s*\d{4}\s*\d{4}\s*\d{4}\s*\d{4}\s*\d{4}\s*\d{3})/i)
                || text.match(/(FR\d{2}\s*\d{4}\s*\d{4}\s*\d{4}\s*\d{4}\s*\d{4}\s*\d{3})/);
            if (ibanMatch?.[1]) result.iban = ibanMatch[1].replace(/\s/g, "");
        }

        // =================================================================
        // FILENAME SUPPLIER OVERRIDE: Known supplier in filename always wins
        // Prevents AI from misidentifying (e.g. ELIS PDF containing "Orange" text)
        // =================================================================
        if (filename) {
            const knownFromFilename = resolveSupplierFromFilenameM(filename);
            if (knownFromFilename) {
                if (result.supplier !== knownFromFilename.name) {
                    console.log(`[SUGU-M] Supplier override from filename: "${result.supplier}" → "${knownFromFilename.name}" (filename: ${filename})`);
                    result.supplier = knownFromFilename.name;
                }
                if (!result.category || result.category !== knownFromFilename.category) {
                    console.log(`[SUGU-M] Category override from filename supplier: "${result.category}" → "${knownFromFilename.category}"`);
                    result.category = knownFromFilename.category;
                }
            }
        }

    console.log(`[SUGU-M] PDF parsed (AI=${aiSuccess ? "yes" : "no"}): supplier=${result.supplier}, amount=${result.amount}, category=${result.category}, taxAmount=${result.taxAmount}, siret=${result.siret}, tva=${result.tvaNumber}, date=${result.date}, invoice=${result.invoiceNumber}`);

    return result;
}

async function findOrCreateSupplier(parsed: ParsedDocumentDataM, fallbackName?: string): Promise<number | null> {
    const supplierName = parsed.supplier || fallbackName;
    if (!supplierName || supplierName.length < 2) return null;

    try {
        const nameNorm = supplierName.trim().toLowerCase();
        const existing = await db.select().from(suguMaillaneSuppliers);
        let match = existing.find(s => s.name.toLowerCase() === nameNorm);
        if (!match && parsed.siret) {
            match = existing.find(s => s.siret === parsed.siret);
        }

        if (match) {
            const updates: Record<string, any> = {};
            if (parsed.siret && !match.siret) updates.siret = parsed.siret;
            if (parsed.tvaNumber && !match.tvaNumber) updates.tvaNumber = parsed.tvaNumber;
            if (parsed.address && !match.address) updates.address = parsed.address;
            if (parsed.city && !match.city) updates.city = parsed.city;
            if (parsed.postalCode && !match.postalCode) updates.postalCode = parsed.postalCode;
            if (parsed.phone && !match.phone) updates.phone = parsed.phone;
            if (parsed.email && !match.email) updates.email = parsed.email;
            if (parsed.iban && !match.bankIban) updates.bankIban = parsed.iban;
            if (parsed.paymentMethod && !match.defaultPaymentMethod) updates.defaultPaymentMethod = parsed.paymentMethod;
            if (parsed.category && !match.category) updates.category = parsed.category;

            const newCount = (match.invoiceCount || 0) + 1;
            const newTotal = (match.totalPurchases || 0) + (parsed.amount || 0);
            updates.invoiceCount = newCount;
            updates.totalPurchases = newTotal;
            if (parsed.date) updates.lastInvoiceDate = parsed.date;

            if (Object.keys(updates).length > 0) {
                await db.update(suguMaillaneSuppliers).set(updates).where(eq(suguMaillaneSuppliers.id, match.id));
                console.log(`[SUGU-M] Updated supplier #${match.id} (${match.name}): +1 invoice`);
            }
            return match.id;
        }

        const [created] = await db.insert(suguMaillaneSuppliers).values({
            name: supplierName.trim().substring(0, 80),
            siret: parsed.siret || null,
            tvaNumber: parsed.tvaNumber || null,
            address: parsed.address || null,
            city: parsed.city || null,
            postalCode: parsed.postalCode || null,
            phone: parsed.phone || null,
            email: parsed.email || null,
            bankIban: parsed.iban || null,
            category: parsed.category || "autre",
            defaultPaymentMethod: parsed.paymentMethod || null,
            totalPurchases: parsed.amount || 0,
            invoiceCount: 1,
            lastInvoiceDate: parsed.date || null,
            isActive: true,
        }).returning();
        console.log(`[SUGU-M] Created new supplier #${created.id}: ${created.name}`);
        return created.id;
    } catch (err) {
        console.error("[SUGU-M] findOrCreateSupplier error:", err);
        return null;
    }
}

router.get("/suppliers", async (_req: Request, res: Response) => {
    try {
        const data = await db.select().from(suguMaillaneSuppliers).orderBy(desc(suguMaillaneSuppliers.name));
        res.json(data);
    } catch (error: any) {
        console.error("[SUGU-M] Error fetching suppliers:", error?.message);
        res.json([]);
    }
});

router.get("/suppliers/:id", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const [supplier] = await db.select().from(suguMaillaneSuppliers).where(eq(suguMaillaneSuppliers.id, id));
        if (!supplier) return res.status(404).json({ error: "Fournisseur introuvable" });

        const purchases = await db.select().from(suguMaillanePurchases).where(eq(suguMaillanePurchases.supplierId, id)).orderBy(desc(suguMaillanePurchases.invoiceDate));
        const expenses = await db.select().from(suguMaillaneExpenses).where(eq(suguMaillaneExpenses.supplierId, id)).orderBy(desc(suguMaillaneExpenses.dueDate));

        res.json({ ...supplier, purchases, expenses });
    } catch (error: any) {
        console.error("[SUGU-M] Error fetching supplier:", error?.message);
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
        const [result] = await db.insert(suguMaillaneSuppliers).values(values).returning();
        console.log(`[SUGU-M] Created supplier: ${result.name} (#${result.id})`);
        res.json(result);
    } catch (error: any) {
        console.error("[SUGU-M] Error creating supplier:", error?.message);
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

        const [result] = await db.update(suguMaillaneSuppliers).set(updates).where(eq(suguMaillaneSuppliers.id, id)).returning();
        if (!result) return res.status(404).json({ error: "Fournisseur introuvable" });
        console.log(`[SUGU-M] Updated supplier #${id}: ${result.name}`);
        res.json(result);
    } catch (error: any) {
        console.error("[SUGU-M] Error updating supplier:", error?.message);
        res.status(500).json({ error: "Erreur mise à jour fournisseur" });
    }
});

router.delete("/suppliers/:id", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        await db.delete(suguMaillaneSuppliers).where(eq(suguMaillaneSuppliers.id, id));
        console.log(`[SUGU-M] Deleted supplier #${id}`);
        res.json({ success: true });
    } catch (error: any) {
        console.error("[SUGU-M] Error deleting supplier:", error?.message);
        res.status(500).json({ error: "Erreur suppression fournisseur" });
    }
});

router.get("/suppliers/:id/stats", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const purchases = await db.select().from(suguMaillanePurchases).where(eq(suguMaillanePurchases.supplierId, id));
        const expenses = await db.select().from(suguMaillaneExpenses).where(eq(suguMaillaneExpenses.supplierId, id));

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
        console.error("[SUGU-M] Error fetching supplier stats:", error?.message);
        res.status(500).json({ error: "Erreur statistiques fournisseur" });
    }
});


export default router;
