import { Router, Request, Response } from "express";
import multer from "multer";
import { hybridUpload } from "../../middleware/base64Upload";
import { db } from "../../db";
import {
    suguPurchases, insertSuguPurchaseSchema,
    suguExpenses, insertSuguExpenseSchema,
    suguBankEntries, insertSuguBankEntrySchema,
    suguLoans, insertSuguLoanSchema,
    suguCashRegister, insertSuguCashRegisterSchema,
    suguEmployees, insertSuguEmployeeSchema,
    suguPayroll, insertSuguPayrollSchema,
    suguAbsences, insertSuguAbsenceSchema,
    suguFiles, insertSuguFileSchema,
    suguSuppliers, insertSuguSupplierSchema,
    suguBackups,
    suguTrash,
} from "@shared/schema";
import { ilike } from "drizzle-orm";
import { objectStorageClient } from "../../replit_integrations/object_storage/objectStorage";
import { eq, desc, sql, and, gte, lte, inArray, isNull } from "drizzle-orm";
import { parseBankStatementPDF, parseBankStatementText, parseBankStatementCSV } from "../../services/bankStatementParser";
import { parsePayrollPDF } from "../../services/payrollParserService";
import { emitSuguPurchasesUpdated, emitSuguExpensesUpdated, emitSuguBankUpdated, emitSuguCashUpdated, emitSuguFilesUpdated, emitSuguEmployeesUpdated, emitSuguPayrollUpdated, emitSuguAbsencesUpdated, emitSuguLoansUpdated } from "../../services/realtimeSync";
import { getKnowledgePromptHints, overrideCategoryFromKnowledge, consolidateSupplierKnowledge, getKnowledgeStats } from "../../services/suguLearningService";
import { aiUploadLimiter, suguFinancialLimiter } from "../../middleware/security";
import archiver from "archiver";

const router = Router();

const importStatusMap = new Map<string, { status: string; step?: string; result?: any; error?: string; updatedAt: number }>();

setInterval(() => {
    const now = Date.now();
    for (const [key, val] of importStatusMap) {
        if (now - val.updatedAt > 300000) importStatusMap.delete(key);
    }
}, 60000);

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

const SUGU_BUCKET_PREFIX = "sugu-valentine-files";
const IS_REPLIT = !!(process.env.REPL_ID || process.env.REPLIT_CONNECTORS_HOSTNAME);
const LOCAL_STORAGE_ROOT = process.env.LOCAL_STORAGE_PATH || "/opt/ulysse/storage";

async function uploadToObjectStorage(buffer: Buffer, fileName: string, mimeType: string): Promise<string> {
    if (!IS_REPLIT) {
        const fs = await import("fs");
        const path = await import("path");
        const dir = path.join(LOCAL_STORAGE_ROOT, SUGU_BUCKET_PREFIX);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, fileName);
        fs.writeFileSync(filePath, buffer);
        return `${SUGU_BUCKET_PREFIX}/${fileName}`;
    }
    const privateDir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!privateDir) throw new Error("PRIVATE_OBJECT_DIR not set");
    const fullPath = `${privateDir}/${SUGU_BUCKET_PREFIX}/${fileName}`;
    const parts = fullPath.startsWith("/") ? fullPath.slice(1).split("/") : fullPath.split("/");
    const bucketName = parts[0];
    const objectName = parts.slice(1).join("/");
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    await file.save(buffer, { contentType: mimeType });
    return fullPath;
}

async function downloadFromObjectStorage(storagePath: string): Promise<{ buffer: Buffer; }> {
    if (!IS_REPLIT) {
        const fs = await import("fs");
        const path = await import("path");
        const filePath = path.join(LOCAL_STORAGE_ROOT, storagePath);
        if (!fs.existsSync(filePath)) throw new Error("File not found: " + filePath);
        return { buffer: fs.readFileSync(filePath) };
    }
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
    if (!IS_REPLIT) {
        const fs = await import("fs");
        const path = await import("path");
        const filePath = path.join(LOCAL_STORAGE_ROOT, storagePath);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`[SUGU] Deleted local file: ${filePath}`);
        }
        return;
    }
    const parts = storagePath.startsWith("/") ? storagePath.slice(1).split("/") : storagePath.split("/");
    const bucketName = parts[0];
    const objectName = parts.slice(1).join("/");
    if (!bucketName || !objectName) throw new Error(`Invalid storagePath: ${storagePath}`);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    const [exists] = await file.exists();
    if (exists) {
        await file.delete();
        console.log(`[SUGU] Permanently deleted from storage: ${objectName}`);
    } else {
        console.warn(`[SUGU] File not found in storage (already gone?): ${objectName}`);
    }
}

router.post("/cash/batch-import-init", async (req: Request, res: Response) => {
    const secret = req.headers["x-import-secret"];
    if (!secret || secret !== process.env.SYSTEM_STATUS_SECRET) {
        return res.status(403).json({ error: "Forbidden" });
    }
    try {
        const entries: any[] = req.body;
        if (!Array.isArray(entries)) return res.status(400).json({ error: "Expected array" });
        let inserted = 0, skipped = 0;
        for (const entry of entries) {
            const existing = await db.select({ id: suguCashRegister.id }).from(suguCashRegister).where(eq(suguCashRegister.entryDate, entry.entryDate)).limit(1);
            if (existing.length > 0) { skipped++; continue; }
            await db.insert(suguCashRegister).values({
                entryDate: entry.entryDate, totalRevenue: entry.totalRevenue,
                cashAmount: entry.cashAmount || 0, cbAmount: entry.cbAmount || 0,
                cbzenAmount: entry.cbzenAmount || 0, trAmount: entry.trAmount || 0,
                ctrAmount: entry.ctrAmount || 0, chequeAmount: entry.chequeAmount || 0,
                virementAmount: entry.virementAmount || 0, ubereatsAmount: entry.ubereatsAmount || 0,
                deliverooAmount: entry.deliverooAmount || 0,
            });
            inserted++;
        }
        return res.json({ inserted, skipped });
    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
});

import { hubriseService } from "../../services/hubriseService";
(async () => { try { await hubriseService.ensureTable(); console.log("[HubRise] Table ready"); } catch (e: any) { console.error("[HubRise] Init error:", e?.message); } })();

router.get("/hubrise/callback", async (req: Request, res: Response) => {
    const { code } = req.query;
    if (!code || typeof code !== "string") return res.status(400).send("Missing authorization code");
    try {
        const host = req.headers.host || req.hostname;
        const proto = req.headers["x-forwarded-proto"] || req.protocol;
        const redirectUri = `${proto}://${host}/api/v2/sugu-management/hubrise/callback`;
        await hubriseService.handleCallback(code, redirectUri);
        res.send(`<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:white"><div style="text-align:center"><h1 style="color:#f97316">✓ HubRise connecté !</h1><p>Vous pouvez fermer cette fenêtre et retourner sur SUGU.</p><script>setTimeout(()=>window.close(),3000)</script></div></body></html>`);
    } catch (e: any) {
        console.error("[HubRise] Callback error:", e?.message);
        res.status(500).send(`<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:white"><div style="text-align:center"><h1 style="color:#ef4444">Erreur HubRise</h1><p>${e.message}</p></div></body></html>`);
    }
});

router.use((req: Request, res: Response, next) => {
    const user = (req as any).user;
    const isOwner = (req as any).isOwner;
    if (isOwner || user?.role === "approved" || user?.role === "suguval_only") {
        if (user?.role === "suguval_only" && req.method !== "GET") {
            const allowedPostPaths = [/\/files\/\d+\/download$/, /\/files\/\d+\/send-email$/, /\/files\/send-email-bulk$/, /\/cash\/parse-ticket$/];
            const isAllowed = allowedPostPaths.some(p => p.test(req.path));
            if (!isAllowed) {
                return res.status(403).json({ error: "Lecture seule — opération non autorisée" });
            }
        }
        return next();
    }
    return res.status(403).json({ error: "Access denied for SUGU Valentine management" });
});

const pdfUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ============ ACHATS / PURCHASES ============

router.get("/purchases", async (req: Request, res: Response) => {
    try {
        const data = await db.select().from(suguPurchases).orderBy(desc(suguPurchases.invoiceDate));

        console.log(`[SUGU] Fetched ${data.length} purchases`);
        res.json(data);
    } catch (error: any) {
        console.error("[SUGU] Error fetching purchases:", error?.message || error);
        if (error?.message?.includes("does not exist") || error?.message?.includes("relation")) {
            console.error("[SUGU] Table sugu_purchases may not exist. Run 'npm run db:push' to sync schema.");
            res.json([]);
        } else {
            res.status(500).json({ error: "Failed to fetch purchases" });
        }
    }
});

router.post("/purchases", async (req: Request, res: Response) => {
    console.log("[SUGU] POST /purchases received");
    try {
        // Step 1: Validate with Zod
        let parsed: any;
        try {
            parsed = insertSuguPurchaseSchema.parse(req.body);
        } catch (zodErr: any) {
            console.error("[SUGU] Zod validation failed:", zodErr?.issues || zodErr?.message);
            return res.status(400).json({ error: "Invalid data", details: zodErr?.issues });
        }

        // Step 2: Try Drizzle ORM insert
        try {
            const [result] = await db.insert(suguPurchases).values(parsed).returning();
            console.log("[SUGU] Purchase created via Drizzle:", result?.id);
            res.json(result);
            emitSuguPurchasesUpdated();
            return;
        } catch (drizzleErr: any) {
            console.error("[SUGU] Drizzle insert failed:", drizzleErr?.message || drizzleErr);

            // Step 3: Fallback to raw SQL
            console.log("[SUGU] Trying raw SQL fallback...");
            const result = await db.execute(sql`
                INSERT INTO sugu_purchases (supplier, category, description, amount, tax_amount, invoice_number, invoice_date, due_date, is_paid, paid_date, payment_method, notes)
                VALUES (${parsed.supplier}, ${parsed.category}, ${parsed.description || ''}, ${parsed.amount}, ${parsed.taxAmount || 0}, ${parsed.invoiceNumber}, ${parsed.invoiceDate}, ${parsed.dueDate}, ${parsed.isPaid || false}, ${parsed.paidDate}, ${parsed.paymentMethod}, ${parsed.notes})
                RETURNING *
            `);
            const row = (result as any).rows?.[0] || (result as any)[0];
            console.log("[SUGU] Purchase created via raw SQL:", row?.id);
            res.json(row);
            emitSuguPurchasesUpdated();
            return;
        }
    } catch (error: any) {
        console.error("[SUGU] FATAL Error creating purchase:", error?.message || error);
        res.status(500).json({ error: "Erreur serveur: " + (error?.message || "Unknown") });
    }
});

router.put("/purchases/:id", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const { supplier, category, description, amount, taxAmount, invoiceNumber, invoiceDate, dueDate, isPaid, paidDate, paymentMethod, notes } = req.body;
        const [result] = await db.update(suguPurchases).set({ supplier, category, description, amount, taxAmount, invoiceNumber, invoiceDate, dueDate, isPaid, paidDate, paymentMethod, notes }).where(eq(suguPurchases.id, id)).returning();
        res.json(result);
        emitSuguPurchasesUpdated();
    } catch (error) {
        console.error("[SUGU] Error updating purchase:", error);
        res.status(500).json({ error: "Failed to update purchase" });
    }
});

router.delete("/purchases/:id", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        await db.delete(suguPurchases).where(eq(suguPurchases.id, id));
        res.json({ success: true });
        emitSuguPurchasesUpdated();
    } catch (error) {
        console.error("[SUGU] Error deleting purchase:", error);
        res.status(500).json({ error: "Failed to delete purchase" });
    }
});

// ============ FRAIS GÉNÉRAUX / EXPENSES ============

router.get("/expenses", async (req: Request, res: Response) => {
    try {
        const data = await db.select().from(suguExpenses).orderBy(desc(suguExpenses.period));
        console.log(`[SUGU] Fetched ${data.length} expenses`);
        res.json(data);
    } catch (error: any) {
        console.error("[SUGU] Error fetching expenses:", error?.message || error);
        // If the table doesn't exist, return empty array instead of crashing
        if (error?.message?.includes("does not exist") || error?.message?.includes("relation")) {
            console.error("[SUGU] Table sugu_general_expenses may not exist. Run 'npm run db:push' to sync schema.");
            res.json([]);
        } else {
            res.status(500).json({ error: "Failed to fetch expenses" });
        }
    }
});

router.post("/expenses", async (req: Request, res: Response) => {
    console.log("[SUGU] POST /expenses received");
    try {
        // Step 1: Validate with Zod
        let parsed: any;
        try {
            parsed = insertSuguExpenseSchema.parse(req.body);
        } catch (zodErr: any) {
            console.error("[SUGU] Zod validation failed:", zodErr?.issues || zodErr?.message);
            return res.status(400).json({ error: "Invalid data", details: zodErr?.issues });
        }

        // Step 2: Try Drizzle ORM insert
        parsed.category = normalizeExpenseCategory(parsed.category);
        try {
            const [result] = await db.insert(suguExpenses).values(parsed).returning();
            console.log("[SUGU] Expense created via Drizzle:", result?.id);
            res.json(result);
            emitSuguExpensesUpdated();
            return;
        } catch (drizzleErr: any) {
            console.error("[SUGU] Drizzle insert failed:", drizzleErr?.message || drizzleErr);

            // Step 3: Fallback to raw SQL
            console.log("[SUGU] Trying raw SQL fallback...");
            const result = await db.execute(sql`
                INSERT INTO sugu_general_expenses (label, category, description, amount, tax_amount, invoice_number, period, frequency, due_date, is_paid, paid_date, payment_method, is_recurring, notes)
                VALUES (${parsed.label}, ${normalizeExpenseCategory(parsed.category)}, ${parsed.description || ''}, ${parsed.amount}, ${parsed.taxAmount || 0}, ${(parsed as any).invoiceNumber || null}, ${parsed.period}, ${parsed.frequency || 'mensuel'}, ${parsed.dueDate}, ${parsed.isPaid || false}, ${parsed.paidDate}, ${parsed.paymentMethod}, ${parsed.isRecurring || false}, ${parsed.notes})
                RETURNING *
            `);
            const row = (result as any).rows?.[0] || (result as any)[0];
            console.log("[SUGU] Expense created via raw SQL:", row?.id);
            res.json(row);
            emitSuguExpensesUpdated();
            return;
        }
    } catch (error: any) {
        console.error("[SUGU] FATAL Error creating expense:", error?.message || error);
        res.status(500).json({ error: "Erreur serveur: " + (error?.message || "Unknown") });
    }
});

router.put("/expenses/:id", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const { label, category, description, amount, taxAmount, period, frequency, dueDate, isPaid, paidDate, paymentMethod, isRecurring, invoiceNumber, notes } = req.body;
        const [result] = await db.update(suguExpenses).set({ label, category: normalizeExpenseCategory(category), description, amount, taxAmount, period, frequency, dueDate, isPaid, paidDate, paymentMethod, isRecurring, invoiceNumber: invoiceNumber || null, notes }).where(eq(suguExpenses.id, id)).returning();
        res.json(result);
        emitSuguExpensesUpdated();
    } catch (error) {
        console.error("[SUGU] Error updating expense:", error);
        res.status(500).json({ error: "Failed to update expense" });
    }
});

router.delete("/expenses/:id", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        await db.delete(suguExpenses).where(eq(suguExpenses.id, id));
        res.json({ success: true });
        emitSuguExpensesUpdated();
    } catch (error) {
        console.error("[SUGU] Error deleting expense:", error);
        res.status(500).json({ error: "Failed to delete expense" });
    }
});

// ============ BANQUE / BANK ============

router.get("/bank", async (req: Request, res: Response) => {
    try {
        const data = await db.select().from(suguBankEntries).orderBy(desc(suguBankEntries.entryDate));
        res.json(data);
    } catch (error) {
        console.error("[SUGU] Error fetching bank entries:", error);
        res.status(500).json({ error: "Failed to fetch bank entries" });
    }
});

// GET /bank/unreconciled — unreconciled bank entries + matching invoices for rapprochement
router.get("/bank/unreconciled", async (req: Request, res: Response) => {
    try {
        const entries = await db.select().from(suguBankEntries)
            .where(eq(suguBankEntries.isReconciled, false))
            .orderBy(desc(suguBankEntries.entryDate));
        const unpaidPurchases = await db.select({ id: suguPurchases.id, supplier: suguPurchases.supplier, amount: suguPurchases.amount, invoiceDate: suguPurchases.invoiceDate, invoiceNumber: suguPurchases.invoiceNumber })
            .from(suguPurchases).where(eq(suguPurchases.isPaid, false)).limit(200);
        const unpaidExpenses = await db.select({ id: suguExpenses.id, description: suguExpenses.label, amount: suguExpenses.amount, expenseDate: suguExpenses.period })
            .from(suguExpenses).where(eq(suguExpenses.isPaid, false)).limit(200);
        const debits = entries.filter(e => e.amount < 0);
        const enriched = debits.map(e => {
            const absAmt = Math.abs(e.amount);
            const matchingPurchases = unpaidPurchases.filter(p => Math.abs(p.amount - absAmt) / Math.max(absAmt, 1) < 0.10);
            const matchingExpenses = unpaidExpenses.filter(x => Math.abs(x.amount - absAmt) / Math.max(absAmt, 1) < 0.10);
            return { ...e, matchingPurchases, matchingExpenses };
        });
        res.json({
            count: entries.length,
            totalAmount: entries.reduce((s, e) => s + Math.abs(e.amount), 0),
            entries: enriched,
        });
    } catch (err: any) {
        console.error("[SUGU] Error fetching unreconciled bank entries:", err);
        res.status(500).json({ error: "Failed to fetch unreconciled entries" });
    }
});

router.post("/bank", async (req: Request, res: Response) => {
    try {
        const parsed = insertSuguBankEntrySchema.parse(req.body);
        const [result] = await db.insert(suguBankEntries).values(parsed).returning();
        res.json(result);
        emitSuguBankUpdated();
    } catch (error) {
        console.error("[SUGU] Error creating bank entry:", error);
        res.status(400).json({ error: "Invalid bank entry data" });
    }
});

router.put("/bank/:id", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const { bankName, entryDate, label, amount, balance, category, isReconciled, notes } = req.body;
        const [result] = await db.update(suguBankEntries).set({ bankName, entryDate, label, amount, balance, category, isReconciled, notes }).where(eq(suguBankEntries.id, id)).returning();
        res.json(result);
        emitSuguBankUpdated();
    } catch (error) {
        console.error("[SUGU] Error updating bank entry:", error);
        res.status(500).json({ error: "Failed to update bank entry" });
    }
});

router.delete("/bank/:id", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        await db.delete(suguBankEntries).where(eq(suguBankEntries.id, id));
        res.json({ success: true });
        emitSuguBankUpdated();
    } catch (error) {
        console.error("[SUGU] Error deleting bank entry:", error);
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
        const bankFiles = await db.select().from(suguFiles).where(eq(suguFiles.category, "banque"));
        for (const f of bankFiles) {
            try { await deleteFromObjectStorage(f.storagePath); } catch (e) { console.error(`[SUGU] Storage delete failed for file ${f.id}:`, e); }
        }
        await db.delete(suguBankEntries);
        await db.delete(suguFiles).where(eq(suguFiles.category, "banque"));
        console.log(`[SUGU] ADMIN bank reset by ${user?.username} — ${bankFiles.length} files permanently deleted`);
        emitSuguBankUpdated();
        res.json({ success: true, message: `All bank entries and ${bankFiles.length} bank files permanently deleted` });
    } catch (error) {
        console.error("[SUGU] Error resetting bank:", error);
        res.status(500).json({ error: "Failed to reset bank" });
    }
});

// Loans
router.get("/loans", async (req: Request, res: Response) => {
    try {
        const rows = await db
            .select({ loan: suguLoans, file: suguFiles })
            .from(suguLoans)
            .leftJoin(suguFiles, eq(suguLoans.originalFileId, suguFiles.id))
            .orderBy(desc(suguLoans.startDate));
        const data = rows.map(r => ({ ...r.loan, originalFile: r.file ?? null }));
        res.json(data);
    } catch (error) {
        console.error("[SUGU] Error fetching loans:", error);
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
        const [updated] = await db.update(suguLoans).set(updateFields).where(eq(suguLoans.id, id)).returning();
        res.json(updated);
        emitSuguLoansUpdated();
    } catch (error) {
        console.error("[SUGU] Error updating loan:", error);
        res.status(500).json({ error: "Failed to update loan" });
    }
});

router.post("/loans", async (req: Request, res: Response) => {
    try {
        const parsed = insertSuguLoanSchema.parse(req.body);
        const [result] = await db.insert(suguLoans).values(parsed).returning();
        res.json(result);
        emitSuguLoansUpdated();
    } catch (error) {
        console.error("[SUGU] Error creating loan:", error);
        res.status(400).json({ error: "Invalid loan data" });
    }
});

router.delete("/loans/:id", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        await db.delete(suguLoans).where(eq(suguLoans.id, id));
        res.json({ success: true });
        emitSuguLoansUpdated();
    } catch (error) {
        console.error("[SUGU] Error deleting loan:", error);
        res.status(500).json({ error: "Failed to delete loan" });
    }
});

// Parse a loan amortization document and return pre-filled loan fields
router.post("/loans/parse-document", hybridUpload({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }), async (req: Request, res: Response) => {
    try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: "No file provided" });
        const result = await parseLoanDocument(file.buffer, file.originalname);
        res.json(result);
    } catch (err: any) {
        console.error("[SUGU] Error parsing loan document:", err?.message);
        res.status(500).json({ error: "Failed to parse loan document" });
    }
});

// ============ JOURNAL DE CAISSE / CASH REGISTER ============

router.get("/cash", async (req: Request, res: Response) => {
    try {
        const { from, to } = req.query;
        let query = db.select().from(suguCashRegister);

        if (from && to) {
            query = query.where(and(
                gte(suguCashRegister.entryDate, from as string),
                lte(suguCashRegister.entryDate, to as string)
            )) as any;
        }

        const data = await query.orderBy(desc(suguCashRegister.entryDate));
        res.json(data);
    } catch (error) {
        console.error("[SUGU] Error fetching cash register:", error);
        res.status(500).json({ error: "Failed to fetch cash register" });
    }
});

const ticketImageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

async function parseTicketWithGemini(base64Data: string, mimeType: string) {
    const { GoogleGenAI } = await import("@google/genai");
    const apiKey = process.env.GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
    if (!apiKey) throw new Error("Gemini API key not configured");
    const geminiOpts: any = { apiKey };
    if (process.env.AI_INTEGRATIONS_GEMINI_BASE_URL) {
        geminiOpts.httpOptions = { apiVersion: "", baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL };
    }
    const gemini = new GoogleGenAI(geminiOpts);
    const prompt = `Tu es un expert en lecture de tickets Z de caisse de restaurant en France.
Analyse cette photo d'un ticket Z (clôture de caisse) et extrait les montants exacts.

Le ticket Z (appelé "FLASH" ou "CLOTURE CAISSE TOTALITE") contient :
- La date au format "FLASH du DD/MM/YYYY" — convertis-la en format ISO YYYY-MM-DD pour le champ entryDate
- Les règlements par type : Espèces (A), C.B. (B), T.R. ou Ticket Restaurant (D), UBEREATS (D), CB ZEN (D), Deliveroo (D), Chèque, Virement
- Le TOTAL NET EN CAISSE ou TOTAL GENERAL = totalRevenue
- "Règl. Clients (total)" ou "Règlements clients" = une ligne informative (total des règlements clients en €), NE PAS mettre cette valeur dans coversCount
- "coversCount" = nombre de couverts (tables servies, personnes reçues). Si ce nombre n'est PAS explicitement indiqué sur le ticket, mettre null.

Réponds UNIQUEMENT avec un JSON valide sans markdown, sans backticks :
{
  "entryDate": "YYYY-MM-DD",
  "totalRevenue": 0.00,
  "cashAmount": 0.00,
  "cbAmount": 0.00,
  "cbzenAmount": 0.00,
  "trAmount": 0.00,
  "ctrAmount": 0.00,
  "ubereatsAmount": 0.00,
  "deliverooAmount": 0.00,
  "chequeAmount": 0.00,
  "virementAmount": 0.00,
  "coversCount": null,
  "notes": ""
}
Si un champ n'est pas présent sur le ticket, mets null ou 0.
Ne devine jamais un montant — utilise uniquement ce qui est lisible sur le ticket.`;

    const response = await gemini.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{
            role: "user",
            parts: [
                { text: prompt },
                { inlineData: { mimeType, data: base64Data } },
            ],
        }],
    });
    const raw = response.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    let parsed: any;
    try {
        parsed = JSON.parse(cleaned);
    } catch {
        console.error("[SUGU] parse-ticket JSON parse failed:", cleaned);
        throw new Error("Impossible de lire le JSON généré par l'IA");
    }
    const toNum = (v: any) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) ? null : Number(v);
    return {
        entryDate: parsed.entryDate || null,
        totalRevenue: toNum(parsed.totalRevenue),
        cashAmount: toNum(parsed.cashAmount),
        cbAmount: toNum(parsed.cbAmount),
        cbzenAmount: toNum(parsed.cbzenAmount),
        trAmount: toNum(parsed.trAmount),
        ctrAmount: toNum(parsed.ctrAmount),
        ubereatsAmount: toNum(parsed.ubereatsAmount),
        deliverooAmount: toNum(parsed.deliverooAmount),
        chequeAmount: toNum(parsed.chequeAmount),
        virementAmount: toNum(parsed.virementAmount),
        coversCount: toNum(parsed.coversCount),
        notes: parsed.notes || null,
    };
}

router.post("/cash/parse-ticket", hybridUpload({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }), async (req: Request, res: Response) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No image file provided" });
        const base64Data = req.file.buffer.toString("base64");
        const mimeType = req.file.mimetype || "image/jpeg";
        const result = await parseTicketWithGemini(base64Data, mimeType);
        return res.json(result);
    } catch (err: any) {
        console.error("[SUGU] parse-ticket error:", err);
        return res.status(500).json({ error: err.message || "Internal server error" });
    }
});

router.post("/cash/parse-ticket-base64", async (req: Request, res: Response) => {
    try {
        const { image, mimeType } = req.body;
        if (!image) return res.status(400).json({ error: "No image data provided" });
        const base64Data = image.replace(/^data:[^;]+;base64,/, "");
        const mime = mimeType || "image/jpeg";
        const result = await parseTicketWithGemini(base64Data, mime);
        return res.json(result);
    } catch (err: any) {
        console.error("[SUGU] parse-ticket-base64 error:", err);
        return res.status(500).json({ error: err.message || "Internal server error" });
    }
});

router.post("/cash/batch-import", async (req: Request, res: Response) => {
    const secret = req.headers["x-import-secret"];
    if (!secret || secret !== process.env.SYSTEM_STATUS_SECRET) {
        return res.status(403).json({ error: "Forbidden" });
    }
    try {
        const entries: any[] = req.body;
        if (!Array.isArray(entries)) return res.status(400).json({ error: "Expected array" });
        let inserted = 0, skipped = 0;
        for (const entry of entries) {
            const existing = await db.select({ id: suguCashRegister.id }).from(suguCashRegister).where(eq(suguCashRegister.entryDate, entry.entryDate)).limit(1);
            if (existing.length > 0) { skipped++; continue; }
            await db.insert(suguCashRegister).values({
                entryDate: entry.entryDate, totalRevenue: entry.totalRevenue,
                cashAmount: entry.cashAmount || 0, cbAmount: entry.cbAmount || 0,
                cbzenAmount: entry.cbzenAmount || 0, trAmount: entry.trAmount || 0,
                ctrAmount: entry.ctrAmount || 0, chequeAmount: entry.chequeAmount || 0,
                virementAmount: entry.virementAmount || 0, ubereatsAmount: entry.ubereatsAmount || 0,
                deliverooAmount: entry.deliverooAmount || 0,
            });
            inserted++;
        }
        return res.json({ inserted, skipped });
    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
});

router.post("/cash", async (req: Request, res: Response) => {
    try {
        const parsed = insertSuguCashRegisterSchema.parse(req.body);
        // Auto-calculate average ticket
        if (parsed.totalRevenue && parsed.coversCount && parsed.coversCount > 0 && !parsed.averageTicket) {
            (parsed as any).averageTicket = parsed.totalRevenue / parsed.coversCount;
        }
        const [result] = await db.insert(suguCashRegister).values(parsed).returning();
        res.json(result);
        emitSuguCashUpdated();
    } catch (error) {
        console.error("[SUGU] Error creating cash entry:", error);
        res.status(400).json({ error: "Invalid cash register data" });
    }
});

router.put("/cash/:id", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const { entryDate, totalRevenue, cashAmount, cbAmount, cbzenAmount, trAmount, ctrAmount, ubereatsAmount, deliverooAmount, chequeAmount, virementAmount, ticketRestoAmount, onlineAmount, coversCount, averageTicket, notes } = req.body;
        const [result] = await db.update(suguCashRegister).set({ entryDate, totalRevenue, cashAmount, cbAmount, cbzenAmount, trAmount, ctrAmount, ubereatsAmount, deliverooAmount, chequeAmount, virementAmount, ticketRestoAmount, onlineAmount, coversCount, averageTicket, notes }).where(eq(suguCashRegister.id, id)).returning();
        res.json(result);
        emitSuguCashUpdated();
    } catch (error) {
        console.error("[SUGU] Error updating cash entry:", error);
        res.status(500).json({ error: "Failed to update cash entry" });
    }
});

router.delete("/cash/:id", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        await db.delete(suguCashRegister).where(eq(suguCashRegister.id, id));
        res.json({ success: true });
        emitSuguCashUpdated();
    } catch (error) {
        console.error("[SUGU] Error deleting cash entry:", error);
        res.status(500).json({ error: "Failed to delete cash entry" });
    }
});

// Cash summary (monthly/yearly stats)
router.get("/cash/summary", async (req: Request, res: Response) => {
    try {
        const year = req.query.year as string || new Date().getFullYear().toString();
        const data = await db.select().from(suguCashRegister)
            .where(sql`${suguCashRegister.entryDate} LIKE ${year + '%'}`)
            .orderBy(suguCashRegister.entryDate);

        // Group by month
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
        console.error("[SUGU] Error fetching cash summary:", error);
        res.status(500).json({ error: "Failed to fetch cash summary" });
    }
});

// ============ GESTION RH / EMPLOYEES ============

router.get("/employees", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const data = await db.select().from(suguEmployees).orderBy(suguEmployees.lastName);
        console.log(`[SUGU] Fetched ${data.length} employees`);
        res.json(data);
    } catch (error: any) {
        console.error("[SUGU] Error fetching employees:", error?.message || error);
        if (error?.message?.includes("does not exist") || error?.message?.includes("relation")) {
            res.json([]);
        } else {
            res.status(500).json({ error: "Failed to fetch employees" });
        }
    }
});

router.post("/employees", async (req: Request, res: Response) => {
    console.log("[SUGU] POST /employees body:", JSON.stringify(req.body));
    try {
        await tablesReady;
        let parsed: any;
        try {
            parsed = insertSuguEmployeeSchema.parse(req.body);
        } catch (zodErr: any) {
            console.error("[SUGU] Employee Zod validation failed:", zodErr?.issues || zodErr?.message || zodErr);
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
            console.log("[SUGU] Using manual fallback for employee:", JSON.stringify(parsed));
        }

        try {
            const [result] = await db.insert(suguEmployees).values(parsed).returning();
            console.log("[SUGU] Employee created via Drizzle:", result?.id);
            res.json(result);
            emitSuguEmployeesUpdated();
            return;
        } catch (drizzleErr: any) {
            console.error("[SUGU] Drizzle insert failed for employee:", drizzleErr?.message || drizzleErr);
            console.log("[SUGU] Trying raw SQL fallback for employee...");
            const result = await db.execute(sql`
                INSERT INTO sugu_employees (first_name, last_name, role, contract_type, monthly_salary, hourly_rate, weekly_hours, start_date, end_date, is_active, phone, email, notes)
                VALUES (${parsed.firstName}, ${parsed.lastName}, ${parsed.role}, ${parsed.contractType || 'CDI'}, ${parsed.monthlySalary}, ${parsed.hourlyRate}, ${parsed.weeklyHours || 35}, ${parsed.startDate}, ${parsed.endDate}, ${parsed.isActive !== false}, ${parsed.phone}, ${parsed.email}, ${parsed.notes})
                RETURNING *
            `);
            const row = (result as any).rows?.[0] || (result as any)[0];
            console.log("[SUGU] Employee created via raw SQL:", row?.id);
            res.json(row);
            emitSuguEmployeesUpdated();
            return;
        }
    } catch (error: any) {
        console.error("[SUGU] FATAL Error creating employee:", error?.message || error);
        res.status(500).json({ error: "Erreur serveur: " + (error?.message || "Unknown") });
    }
});

router.put("/employees/:id", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const id = parseInt(req.params.id);
        const { firstName, lastName, role, contractType, monthlySalary, hourlyRate, weeklyHours, startDate, endDate, isActive, phone, email, notes } = req.body;
        const [result] = await db.update(suguEmployees).set({ firstName, lastName, role, contractType, monthlySalary, hourlyRate, weeklyHours, startDate, endDate, isActive, phone, email, notes }).where(eq(suguEmployees.id, id)).returning();
        res.json(result);
        emitSuguEmployeesUpdated();
    } catch (error) {
        console.error("[SUGU] Error updating employee:", error);
        res.status(500).json({ error: "Failed to update employee" });
    }
});

router.delete("/employees/:id", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const id = parseInt(req.params.id);
        await db.delete(suguEmployees).where(eq(suguEmployees.id, id));
        res.json({ success: true });
        emitSuguEmployeesUpdated();
    } catch (error) {
        console.error("[SUGU] Error deleting employee:", error);
        res.status(500).json({ error: "Failed to delete employee" });
    }
});

// Payroll
router.get("/payroll", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const period = req.query.period as string;
        let query = db.select().from(suguPayroll);
        if (period) {
            query = query.where(eq(suguPayroll.period, period)) as any;
        }
        const data = await query.orderBy(desc(suguPayroll.period));
        res.json(data);
    } catch (error) {
        console.error("[SUGU] Error fetching payroll:", error);
        res.status(500).json({ error: "Failed to fetch payroll" });
    }
});

router.post("/payroll", async (req: Request, res: Response) => {
    console.log("[SUGU] POST /payroll body:", JSON.stringify(req.body));
    try {
        await tablesReady;
        let parsed: any;
        try {
            parsed = insertSuguPayrollSchema.parse(req.body);
        } catch (zodErr: any) {
            console.error("[SUGU] Payroll Zod validation failed:", zodErr?.issues || zodErr?.message || zodErr);
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
            console.log("[SUGU] Using manual fallback for payroll:", JSON.stringify(parsed));
        }

        try {
            const [result] = await db.insert(suguPayroll).values(parsed).returning();
            console.log("[SUGU] Payroll created via Drizzle:", result?.id);
            res.json(result);
            emitSuguPayrollUpdated();
            return;
        } catch (drizzleErr: any) {
            console.error("[SUGU] Drizzle insert failed for payroll:", drizzleErr?.message || drizzleErr);
            const result = await db.execute(sql`
                INSERT INTO sugu_payroll (employee_id, period, gross_salary, net_salary, social_charges, employer_charges, total_employer_cost, bonus, overtime, is_paid, paid_date, notes)
                VALUES (${parsed.employeeId}, ${parsed.period}, ${parsed.grossSalary}, ${parsed.netSalary}, ${parsed.socialCharges || 0}, ${parsed.employerCharges || null}, ${parsed.totalEmployerCost || null}, ${parsed.bonus || 0}, ${parsed.overtime || 0}, ${parsed.isPaid || false}, ${parsed.paidDate}, ${parsed.notes})
                RETURNING *
            `);
            const row = (result as any).rows?.[0] || (result as any)[0];
            console.log("[SUGU] Payroll created via raw SQL:", row?.id);
            res.json(row);
            emitSuguPayrollUpdated();
            return;
        }
    } catch (error: any) {
        console.error("[SUGU] FATAL Error creating payroll:", error?.message || error);
        res.status(500).json({ error: "Erreur serveur: " + (error?.message || "Unknown") });
    }
});

router.put("/payroll/:id", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const id = parseInt(req.params.id);
        const { employeeId, period, grossSalary, netSalary, socialCharges, bonus, overtime, isPaid, paidDate, pdfPath, notes } = req.body;
        const [result] = await db.update(suguPayroll).set({ employeeId, period, grossSalary, netSalary, socialCharges, bonus, overtime, isPaid, paidDate, pdfPath, notes }).where(eq(suguPayroll.id, id)).returning();
        res.json(result);
        emitSuguPayrollUpdated();
    } catch (error) {
        console.error("[SUGU] Error updating payroll:", error);
        res.status(500).json({ error: "Failed to update payroll" });
    }
});

router.delete("/payroll/:id", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const id = parseInt(req.params.id);
        const [result] = await db.delete(suguPayroll).where(eq(suguPayroll.id, id)).returning();
        if (!result) return res.status(404).json({ error: "Payroll not found" });
        res.json({ success: true });
        emitSuguPayrollUpdated();
    } catch (error) {
        console.error("[SUGU] Error deleting payroll:", error);
        res.status(500).json({ error: "Failed to delete payroll" });
    }
});

// POST /payroll/import-pdf — Parse payroll PDF and create employee + payroll entries
router.post("/payroll/import-pdf", hybridUpload({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }), async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const file = (req as any).file;
        if (!file) {
            return res.status(400).json({ error: "No file uploaded" });
        }
        const importId = `imp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        console.log(`[SUGU] Payroll PDF import queued: ${file.originalname}, ${file.size} bytes (${importId})`);

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

        processPayrollImportAsync(importId, fileBuffer, fileName, fileSize, fileMime, autoCreate, userId).catch(err => {
            console.error(`[SUGU] Background import ${importId} failed:`, err?.message || err);
        });
    } catch (error: any) {
        console.error("[SUGU] Error importing payroll PDF:", error?.message || error);
        res.status(500).json({ error: "Erreur serveur: " + (error?.message || "Unknown") });
    }
});

router.get("/payroll/import-status/:importId", async (req: Request, res: Response) => {
    const { importId } = req.params;
    const status = importStatusMap.get(importId);
    if (!status) {
        return res.json({ status: "processing", step: "En traitement..." });
    }
    res.json(status);
});

async function processPayrollImportAsync(
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
        importStatusMap.set(importId, { status: "processing", step, updatedAt: Date.now() });
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
            importStatusMap.set(importId, { status: "error", error: "Impossible de lire le bulletin", updatedAt: Date.now() });
            broadcastToUser(userId, {
                type: "sugu.payroll.import.error",
                userId,
                data: { importId, fileName, error: "Impossible de lire le bulletin", details: result.errors },
                timestamp: Date.now(),
            });
            return;
        }

        const parsed = result.data;
        let employeeId: number | null = null;
        let employeeCreated = false;
        let payrollCreated = false;

        if (autoCreate && parsed.employee?.lastName) {
            sendProgress("Recherche de l'employé...");
            const existingEmps = await db.select().from(suguEmployees);
            const parsedSSN = parsed.employee.socialSecurityNumber?.replace(/\s/g, "") || null;

            let match = null as typeof existingEmps[0] | null;
            if (parsedSSN && parsedSSN.length >= 13) {
                match = existingEmps.find(e => e.socialSecurityNumber && e.socialSecurityNumber.replace(/\s/g, "") === parsedSSN) || null;
                if (match) console.log(`[SUGU] SSN match: ${parsedSSN} → employee ${match.firstName} ${match.lastName} (ID ${match.id})`);
            }
            if (!match) {
                match = existingEmps.find(e =>
                    e.lastName.toLowerCase() === parsed.employee.lastName.toLowerCase() &&
                    e.firstName.toLowerCase() === (parsed.employee.firstName || "").toLowerCase()
                ) || null;
            }
            if (!match) {
                const pLast = parsed.employee.lastName.toUpperCase().trim();
                const pFirst = (parsed.employee.firstName || "").toUpperCase().trim();
                match = existingEmps.find(e => {
                    const eLast = e.lastName.toUpperCase().trim();
                    const eFirst = e.firstName.toUpperCase().trim();
                    if (eLast === pLast) return true;
                    if (eFirst === pLast && eLast === pFirst) return true;
                    const pFull = `${pFirst} ${pLast}`;
                    const eFull = `${eFirst} ${eLast}`;
                    if (pFull.includes(eLast) && pFull.includes(eFirst)) return true;
                    if (eFull.includes(pLast) || pFull.includes(eLast)) return true;
                    return false;
                }) || null;
            }

            if (match) {
                employeeId = match.id;
                console.log(`[SUGU] Found existing employee: ${match.firstName} ${match.lastName} (ID ${match.id})`);

                const updates: any = {};
                if (parsed.employee.role && parsed.employee.role !== "Non précisé" && (!match.role || match.role === "Non précisé")) {
                    updates.role = parsed.employee.role;
                }
                if (parsed.hourlyRate && !match.hourlyRate) {
                    updates.hourlyRate = parsed.hourlyRate;
                }
                if (parsed.employee.weeklyHours && !match.weeklyHours) {
                    updates.weeklyHours = parsed.employee.weeklyHours;
                }
                if (parsed.grossSalary && (!match.monthlySalary || match.monthlySalary === 0)) {
                    updates.monthlySalary = parsed.grossSalary;
                }
                if (parsedSSN && parsedSSN.length >= 13 && !match.socialSecurityNumber) {
                    updates.socialSecurityNumber = parsedSSN;
                }
                if (Object.keys(updates).length > 0) {
                    await db.update(suguEmployees).set(updates).where(eq(suguEmployees.id, match.id));
                    console.log(`[SUGU] Updated employee ${match.id} with payroll data:`, updates);
                }
            } else {
                const [newEmp] = await db.insert(suguEmployees).values({
                    firstName: parsed.employee.firstName || "Inconnu",
                    lastName: parsed.employee.lastName,
                    role: parsed.employee.role || "Non précisé",
                    contractType: parsed.employee.contractType || "CDI",
                    monthlySalary: parsed.grossSalary || null,
                    hourlyRate: parsed.hourlyRate || null,
                    weeklyHours: parsed.employee.weeklyHours || 35,
                    startDate: parsed.employee.startDate || new Date().toISOString().substring(0, 10),
                    isActive: true,
                    socialSecurityNumber: parsedSSN,
                }).returning();
                employeeId = newEmp.id;
                employeeCreated = true;
                console.log(`[SUGU] Created new employee: ${newEmp.firstName} ${newEmp.lastName} (ID ${newEmp.id}) SSN=${parsedSSN || "N/A"}`);
                emitSuguEmployeesUpdated();
            }

            if (employeeId && parsed.period && parsed.grossSalary) {
                const existingPayroll = await db.select().from(suguPayroll)
                    .where(and(
                        eq(suguPayroll.employeeId, employeeId),
                        eq(suguPayroll.period, parsed.period)
                    ));

                sendProgress("Archivage du PDF...");
                let pdfStoragePath: string | null = null;
                try {
                    const timestamp = Date.now();
                    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
                    const storedName = `${timestamp}-${safeName}`;
                    const objectPath = await uploadToObjectStorage(fileBuffer, storedName, fileMime);

                    const [fileRecord] = await db.insert(suguFiles).values({
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
                    console.log(`[SUGU] Payroll PDF archived: ${fileName} → sugu_files ID ${fileRecord.id}`);
                    emitSuguFilesUpdated();
                } catch (pdfErr: any) {
                    console.error("[SUGU] Failed to archive payroll PDF (continuing):", pdfErr?.message);
                }

                if (existingPayroll.length === 0) {
                    sendProgress("Création de la fiche de paie...");
                    await db.insert(suguPayroll).values({
                        employeeId,
                        period: parsed.period,
                        grossSalary: parsed.grossSalary,
                        netSalary: parsed.netSalary || 0,
                        socialCharges: parsed.socialCharges || 0,
                        employerCharges: parsed.employerCharges || null,
                        totalEmployerCost: parsed.totalEmployerCost || null,
                        bonus: parsed.bonus || 0,
                        overtime: parsed.overtime || 0,
                        isPaid: true,
                        paidDate: parsed.paymentDate || null,
                        pdfPath: pdfStoragePath,
                        notes: `Import PDF: ${fileName}`,
                    });
                    payrollCreated = true;
                    console.log(`[SUGU] Created payroll for employee ${employeeId}, period ${parsed.period}`);
                    emitSuguPayrollUpdated();
                } else {
                    if (pdfStoragePath && !existingPayroll[0].pdfPath) {
                        await db.update(suguPayroll).set({ pdfPath: pdfStoragePath }).where(eq(suguPayroll.id, existingPayroll[0].id));
                        emitSuguPayrollUpdated();
                    }
                    console.log(`[SUGU] Payroll already exists for employee ${employeeId}, period ${parsed.period} - skipping`);
                    result.warnings.push(`Fiche de paie déjà existante pour ${parsed.period}`);
                }
            }
        }

        const completeResult = {
            parsed: {
                employee: parsed.employee,
                period: parsed.period,
                grossSalary: parsed.grossSalary,
                netSalary: parsed.netSalary,
            },
            actions: { employeeCreated, employeeId, payrollCreated },
            confidence: result.confidence,
            source: result.source,
            warnings: result.warnings,
        };

        importStatusMap.set(importId, { status: "complete", result: completeResult, updatedAt: Date.now() });

        broadcastToUser(userId, {
            type: "sugu.payroll.import.complete",
            userId,
            data: { importId, fileName, ...completeResult },
            timestamp: Date.now(),
        });

        console.log(`[SUGU] Import ${importId} completed successfully`);
    } catch (error: any) {
        console.error(`[SUGU] Import ${importId} error:`, error?.message || error);
        importStatusMap.set(importId, { status: "error", error: error?.message || "Erreur interne", updatedAt: Date.now() });
        broadcastToUser(userId, {
            type: "sugu.payroll.import.error",
            userId,
            data: { importId, fileName, error: error?.message || "Erreur interne" },
            timestamp: Date.now(),
        });
    }
}

// POST /payroll/reparse-all — Re-parse all RH PDFs from storage and update payroll records
router.post("/payroll/reparse-all", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const { persistentStorageService } = await import("../../services/persistentStorageService");
        
        const rhFiles = await db.select().from(suguFiles)
            .where(and(eq(suguFiles.category, "rh"), eq(suguFiles.fileType, "bulletin_paie")))
            .orderBy(suguFiles.id);

        if (rhFiles.length === 0) {
            const allRhFiles = await db.select().from(suguFiles)
                .where(eq(suguFiles.category, "rh"))
                .orderBy(suguFiles.id);
            if (allRhFiles.length === 0) {
                return res.json({ message: "No RH files found", results: [] });
            }
            // Use all RH files if none are tagged as bulletin_paie
            rhFiles.push(...allRhFiles.filter(f => f.originalName.toLowerCase().includes("bs ") || f.originalName.toLowerCase().includes("bulletin")));
        }

        console.log(`[SUGU] Reparse: Found ${rhFiles.length} payroll PDFs to re-parse`);
        const results: any[] = [];

        for (const file of rhFiles) {
            try {
                if (!file.storagePath) {
                    results.push({ fileId: file.id, fileName: file.originalName, status: "skipped", reason: "No storage path" });
                    continue;
                }
                
                const buffer = await persistentStorageService.downloadFile(file.storagePath);
                console.log(`[SUGU] Reparsing: ${file.originalName} (${buffer.length} bytes)`);
                
                const parsed = await parsePayrollPDF(buffer, file.originalName);
                
                if (!parsed.grossSalary || !parsed.netSalary) {
                    console.log(`[SUGU] Reparse: ${file.originalName} - no salary data (gross=${parsed.grossSalary}, net=${parsed.netSalary})`);
                    results.push({ fileId: file.id, fileName: file.originalName, status: "failed", reason: "Could not extract salary data", parsed });
                    continue;
                }

                const period = parsed.period || (() => {
                    const m = file.originalName.match(/(\d{2})(\d{2})\s/);
                    if (m) {
                        const month = parseInt(m[1]);
                        const yearSuffix = parseInt(m[2]);
                        const year = yearSuffix >= 50 ? 1900 + yearSuffix : 2000 + yearSuffix;
                        return `${year}-${String(month).padStart(2, '0')}`;
                    }
                    return null;
                })();

                if (!period) {
                    results.push({ fileId: file.id, fileName: file.originalName, status: "failed", reason: "Could not determine period", parsed });
                    continue;
                }

                let employeeId = file.employeeId;
                console.log(`[SUGU] Reparse: Processing ${file.originalName} - empId=${employeeId}, period=${period}, gross=${parsed.grossSalary}, net=${parsed.netSalary}`);
                
                if (employeeId) {
                    const empExists = await db.select({ id: suguEmployees.id }).from(suguEmployees).where(eq(suguEmployees.id, employeeId));
                    if (empExists.length === 0) {
                        console.log(`[SUGU] Reparse: File ${file.originalName} linked to deleted employee ${employeeId}, clearing`);
                        employeeId = null;
                        await db.update(suguFiles).set({ employeeId: null }).where(eq(suguFiles.id, file.id));
                    }
                }

                const existingEmps = await db.select().from(suguEmployees);
                const parsedSSN = parsed.employee?.socialSecurityNumber?.replace(/\s/g, "") || null;

                if (!employeeId && parsedSSN && parsedSSN.length >= 13) {
                    const ssnMatch = existingEmps.find(e => e.socialSecurityNumber && e.socialSecurityNumber.replace(/\s/g, "") === parsedSSN);
                    if (ssnMatch) {
                        employeeId = ssnMatch.id;
                        await db.update(suguFiles).set({ employeeId }).where(eq(suguFiles.id, file.id));
                        console.log(`[SUGU] Reparse: SSN match ${parsedSSN} → ${ssnMatch.firstName} ${ssnMatch.lastName} (id=${ssnMatch.id})`);
                    }
                }

                if (!employeeId && parsed.employee?.lastName) {
                    const pFirst = (parsed.employee?.firstName || "").toUpperCase().trim();
                    const pLast = (parsed.employee?.lastName || "").toUpperCase().trim();
                    const pFull = `${pFirst} ${pLast}`.trim();
                    const match = existingEmps.find(e => {
                        const eFirst = e.firstName.toUpperCase().trim();
                        const eLast = e.lastName.toUpperCase().trim();
                        const eFull = `${eFirst} ${eLast}`.trim();
                        if (eLast === pLast) return true;
                        if (eFirst === pFirst && eLast === pLast) return true;
                        if (eFirst === pLast && eLast === pFirst) return true;
                        if (eFull === pFull || eFull === `${pLast} ${pFirst}`.trim()) return true;
                        if (pFull.includes(eLast) && pFull.includes(eFirst)) return true;
                        if (eFull.includes(pLast) || pFull.includes(eLast)) return true;
                        return false;
                    });
                    if (match) {
                        employeeId = match.id;
                        await db.update(suguFiles).set({ employeeId }).where(eq(suguFiles.id, file.id));
                        console.log(`[SUGU] Reparse: Matched ${pFirst} ${pLast} to employee ${match.firstName} ${match.lastName} (id=${match.id})`);
                        if (parsedSSN && parsedSSN.length >= 13 && !match.socialSecurityNumber) {
                            await db.update(suguEmployees).set({ socialSecurityNumber: parsedSSN }).where(eq(suguEmployees.id, match.id));
                            console.log(`[SUGU] Reparse: Saved SSN ${parsedSSN} for employee ${match.id}`);
                        }
                    }
                }

                if (!employeeId && parsed.employee?.lastName && parsed.employee?.firstName) {
                    const [newEmp] = await db.insert(suguEmployees).values({
                        firstName: parsed.employee.firstName,
                        lastName: parsed.employee.lastName,
                        role: parsed.employee.role || "Non précisé",
                        contractType: (parsed.employee.contractType as any) || "CDI",
                        startDate: parsed.employee.startDate || null,
                        isActive: true,
                        socialSecurityNumber: parsedSSN,
                    }).returning();
                    employeeId = newEmp.id;
                    await db.update(suguFiles).set({ employeeId }).where(eq(suguFiles.id, file.id));
                    console.log(`[SUGU] Reparse: Created new employee from PDF: ${parsed.employee.lastName} ${parsed.employee.firstName} (id=${newEmp.id}) SSN=${parsedSSN || "N/A"}`);
                }

                if (!employeeId) {
                    console.log(`[SUGU] Reparse: No employee match for ${file.originalName} (parsed name: ${parsed.employee?.firstName} ${parsed.employee?.lastName})`);
                    results.push({ fileId: file.id, fileName: file.originalName, status: "failed", reason: "No employee match", parsed });
                    continue;
                }

                const existingPayroll = await db.select().from(suguPayroll)
                    .where(and(eq(suguPayroll.employeeId, employeeId), eq(suguPayroll.period, period)));
                
                const payrollData = {
                    grossSalary: parsed.grossSalary,
                    netSalary: parsed.netSalary,
                    socialCharges: parsed.socialCharges || null,
                    employerCharges: parsed.employerCharges || null,
                    totalEmployerCost: parsed.totalEmployerCost || null,
                    bonus: parsed.bonus || null,
                    overtime: parsed.overtime || null,
                    pdfStoragePath: String(file.id),
                };

                if (existingPayroll.length > 0) {
                    const old = existingPayroll[0];
                    await db.update(suguPayroll).set(payrollData).where(eq(suguPayroll.id, old.id));
                    const changed = old.grossSalary !== parsed.grossSalary || old.netSalary !== parsed.netSalary;
                    console.log(`[SUGU] Reparse: Updated payroll ${old.id} for emp ${employeeId} period ${period} (changed=${changed})`);
                    results.push({ 
                        fileId: file.id, fileName: file.originalName, status: "updated", 
                        employeeId, period,
                        old: { gross: old.grossSalary, net: old.netSalary, charges: old.socialCharges },
                        new: { gross: parsed.grossSalary, net: parsed.netSalary, charges: parsed.socialCharges },
                        changed
                    });
                } else {
                    await db.insert(suguPayroll).values({
                        employeeId,
                        period,
                        ...payrollData,
                    });
                    console.log(`[SUGU] Reparse: Created payroll for emp ${employeeId} period ${period} (net=${parsed.netSalary})`);
                    results.push({ 
                        fileId: file.id, fileName: file.originalName, status: "created", 
                        employeeId, period,
                        data: { gross: parsed.grossSalary, net: parsed.netSalary, charges: parsed.socialCharges }
                    });
                }
            } catch (err: any) {
                console.error(`[SUGU] Reparse error for ${file.originalName}:`, err?.message);
                results.push({ fileId: file.id, fileName: file.originalName, status: "error", error: err?.message });
            }
        }

        const updated = results.filter(r => r.status === "updated" && r.changed).length;
        const created = results.filter(r => r.status === "created").length;
        const failed = results.filter(r => r.status === "failed" || r.status === "error").length;
        
        console.log(`[SUGU] Reparse complete: ${updated} updated, ${created} created, ${failed} failed out of ${rhFiles.length} files`);
        res.json({ message: `Reparse complete`, total: rhFiles.length, updated, created, failed, results });
    } catch (error: any) {
        console.error("[SUGU] Error reparsing payrolls:", error?.message || error);
        res.status(500).json({ error: "Erreur serveur: " + (error?.message || "Unknown") });
    }
});

// Absences
router.get("/absences", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const employeeId = req.query.employeeId ? parseInt(req.query.employeeId as string) : undefined;
        let query = db.select().from(suguAbsences);
        if (employeeId) {
            query = query.where(eq(suguAbsences.employeeId, employeeId)) as any;
        }
        const data = await query.orderBy(desc(suguAbsences.startDate));
        res.json(data);
    } catch (error) {
        console.error("[SUGU] Error fetching absences:", error);
        res.status(500).json({ error: "Failed to fetch absences" });
    }
});

router.post("/absences", async (req: Request, res: Response) => {
    console.log("[SUGU] POST /absences body:", JSON.stringify(req.body));
    try {
        await tablesReady;
        let parsed: any;
        try {
            parsed = insertSuguAbsenceSchema.parse(req.body);
        } catch (zodErr: any) {
            console.error("[SUGU] Absence Zod validation failed:", zodErr?.issues || zodErr?.message || zodErr);
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
            console.log("[SUGU] Using manual fallback for absence:", JSON.stringify(parsed));
        }

        try {
            const [result] = await db.insert(suguAbsences).values(parsed).returning();
            console.log("[SUGU] Absence created via Drizzle:", result?.id);
            res.json(result);
            emitSuguAbsencesUpdated();
            return;
        } catch (drizzleErr: any) {
            console.error("[SUGU] Drizzle insert failed for absence:", drizzleErr?.message || drizzleErr);
            const result = await db.execute(sql`
                INSERT INTO sugu_absences (employee_id, type, start_date, end_date, duration, is_approved, reason, notes)
                VALUES (${parsed.employeeId}, ${parsed.type}, ${parsed.startDate}, ${parsed.endDate}, ${parsed.duration}, ${parsed.isApproved || false}, ${parsed.reason}, ${parsed.notes})
                RETURNING *
            `);
            const row = (result as any).rows?.[0] || (result as any)[0];
            console.log("[SUGU] Absence created via raw SQL:", row?.id);
            res.json(row);
            emitSuguAbsencesUpdated();
            return;
        }
    } catch (error: any) {
        console.error("[SUGU] FATAL Error creating absence:", error?.message || error);
        res.status(500).json({ error: "Erreur serveur: " + (error?.message || "Unknown") });
    }
});

router.delete("/absences/:id", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const id = parseInt(req.params.id);
        await db.delete(suguAbsences).where(eq(suguAbsences.id, id));
        res.json({ success: true });
        emitSuguAbsencesUpdated();
    } catch (error) {
        console.error("[SUGU] Error deleting absence:", error);
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

// ============ FILES / ARCHIVES ============

// Auto-create all SUGU tables if not exists (no auto-migration on this project)
// Step 1: Wait for DB to be responsive (Neon serverless cold start can take 30-60s)
// Step 2: Create each table independently (one failure doesn't block others)
async function waitForDb(maxWaitMs = 300000) {
    const start = Date.now();
    let attempt = 0;
    while (Date.now() - start < maxWaitMs) {
        attempt++;
        try {
            await db.execute(sql`SELECT 1`);
            console.log(`[SUGU] DB ready after ${attempt} ping(s) (${((Date.now() - start) / 1000).toFixed(1)}s)`);
            return true;
        } catch {
            // Wait with exponential backoff: 5s, 10s, 15s, 20s, 20s...
            const wait = Math.min(attempt * 5000, 20000);
            await new Promise(r => setTimeout(r, wait));
        }
    }
    console.error(`[SUGU] ❌ DB not responsive after ${maxWaitMs / 1000}s`);
    return false;
}

async function ensureSuguTables() {
    const isNeon = (process.env.DATABASE_URL || '').includes('neon.tech');
    if (isNeon) {
        console.log("[SUGU] Neon detected — waiting 45s for DB warmup before table creation...");
        await new Promise(r => setTimeout(r, 45000));
    } else {
        console.log("[SUGU] Local/non-Neon DB — skipping warmup delay, creating tables now...");
    }
    const dbReady = await waitForDb();
    if (!dbReady) return;

    const tables: Array<{ name: string; ddl: ReturnType<typeof sql> }> = [
        {
            name: "sugu_purchases", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugu_purchases (
                id SERIAL PRIMARY KEY, supplier TEXT NOT NULL, description TEXT,
                category TEXT NOT NULL DEFAULT 'alimentaire', amount REAL NOT NULL,
                tax_amount REAL DEFAULT 0, invoice_number TEXT, invoice_date TEXT,
                due_date TEXT, is_paid BOOLEAN NOT NULL DEFAULT FALSE, paid_date TEXT,
                payment_method TEXT, notes TEXT, created_at TIMESTAMP DEFAULT NOW()
            )` },
        {
            name: "sugu_general_expenses", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugu_general_expenses (
                id SERIAL PRIMARY KEY, label TEXT DEFAULT 'Non spécifié',
                category TEXT NOT NULL DEFAULT 'energie', description TEXT NOT NULL DEFAULT '',
                amount REAL NOT NULL, tax_amount REAL DEFAULT 0, period TEXT,
                frequency TEXT DEFAULT 'mensuel', due_date TEXT,
                is_paid BOOLEAN NOT NULL DEFAULT FALSE, paid_date TEXT,
                payment_method TEXT, is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
                notes TEXT, created_at TIMESTAMP DEFAULT NOW()
            )` },
        {
            name: "sugu_files", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugu_files (
                id SERIAL PRIMARY KEY, file_name TEXT NOT NULL, original_name TEXT NOT NULL,
                mime_type TEXT NOT NULL, file_size INTEGER NOT NULL, category TEXT NOT NULL,
                file_type TEXT NOT NULL DEFAULT 'file', supplier TEXT, description TEXT,
                file_date TEXT, storage_path TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW()
            )` },
        {
            name: "sugu_bank_entries", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugu_bank_entries (
                id SERIAL PRIMARY KEY, bank_name TEXT NOT NULL DEFAULT 'Banque Principale',
                entry_date TEXT NOT NULL, label TEXT NOT NULL, amount REAL NOT NULL,
                balance REAL, category TEXT, is_reconciled BOOLEAN NOT NULL DEFAULT FALSE,
                notes TEXT, created_at TIMESTAMP DEFAULT NOW()
            )` },
        {
            name: "sugu_loans", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugu_loans (
                id SERIAL PRIMARY KEY, bank_name TEXT NOT NULL, loan_label TEXT NOT NULL,
                total_amount REAL NOT NULL, remaining_amount REAL NOT NULL,
                monthly_payment REAL NOT NULL, interest_rate REAL,
                start_date TEXT NOT NULL, end_date TEXT, notes TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )` },
        {
            name: "sugu_cash_entries", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugu_cash_entries (
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
            name: "sugu_employees", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugu_employees (
                id SERIAL PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
                role TEXT NOT NULL, contract_type TEXT NOT NULL DEFAULT 'CDI',
                monthly_salary REAL, hourly_rate REAL, weekly_hours REAL DEFAULT 35,
                start_date TEXT NOT NULL, end_date TEXT,
                is_active BOOLEAN NOT NULL DEFAULT TRUE, phone TEXT, email TEXT,
                notes TEXT, created_at TIMESTAMP DEFAULT NOW()
            )` },
        {
            name: "sugu_payroll", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugu_payroll (
                id SERIAL PRIMARY KEY, employee_id INTEGER NOT NULL, period TEXT NOT NULL,
                gross_salary REAL NOT NULL, net_salary REAL NOT NULL,
                social_charges REAL DEFAULT 0, bonus REAL DEFAULT 0, overtime REAL DEFAULT 0,
                is_paid BOOLEAN NOT NULL DEFAULT FALSE, paid_date TEXT,
                notes TEXT, created_at TIMESTAMP DEFAULT NOW()
            )` },
        {
            name: "sugu_absences", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugu_absences (
                id SERIAL PRIMARY KEY, employee_id INTEGER NOT NULL, type TEXT NOT NULL,
                start_date TEXT NOT NULL, end_date TEXT, duration REAL,
                is_approved BOOLEAN NOT NULL DEFAULT FALSE, reason TEXT, notes TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )` },
        {
            name: "sugu_trash", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugu_trash (
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
            console.log(`[SUGU] ✅ ${t.name} ensured`);
        } catch (err: any) {
            console.error(`[SUGU] ⚠️ Failed to create ${t.name}:`, err?.message);
        }
    }
    console.log(`[SUGU] Tables: ${ok}/${tables.length} ensured`);

    // Ensure all columns exist (ALTER TABLE ADD COLUMN IF NOT EXISTS)
    // This handles tables created by older schema versions missing newer columns
    const alterStatements = [
        sql`ALTER TABLE sugu_general_expenses ADD COLUMN IF NOT EXISTS label TEXT DEFAULT 'Non spécifié'`,
        sql`ALTER TABLE sugu_general_expenses ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'energie'`,
        sql`ALTER TABLE sugu_general_expenses ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''`,
        sql`ALTER TABLE sugu_general_expenses ADD COLUMN IF NOT EXISTS amount REAL NOT NULL DEFAULT 0`,
        sql`ALTER TABLE sugu_general_expenses ADD COLUMN IF NOT EXISTS tax_amount REAL DEFAULT 0`,
        sql`ALTER TABLE sugu_general_expenses ADD COLUMN IF NOT EXISTS period TEXT`,
        sql`ALTER TABLE sugu_general_expenses ADD COLUMN IF NOT EXISTS frequency TEXT DEFAULT 'mensuel'`,
        sql`ALTER TABLE sugu_general_expenses ADD COLUMN IF NOT EXISTS due_date TEXT`,
        sql`ALTER TABLE sugu_general_expenses ADD COLUMN IF NOT EXISTS is_paid BOOLEAN NOT NULL DEFAULT FALSE`,
        sql`ALTER TABLE sugu_general_expenses ADD COLUMN IF NOT EXISTS paid_date TEXT`,
        sql`ALTER TABLE sugu_general_expenses ADD COLUMN IF NOT EXISTS payment_method TEXT`,
        sql`ALTER TABLE sugu_general_expenses ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT FALSE`,
        sql`ALTER TABLE sugu_general_expenses ADD COLUMN IF NOT EXISTS notes TEXT`,
        sql`ALTER TABLE sugu_general_expenses ADD COLUMN IF NOT EXISTS invoice_number TEXT`,
        sql`ALTER TABLE sugu_purchases ADD COLUMN IF NOT EXISTS supplier TEXT NOT NULL DEFAULT ''`,
        sql`ALTER TABLE sugu_purchases ADD COLUMN IF NOT EXISTS description TEXT`,
        sql`ALTER TABLE sugu_purchases ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'alimentaire'`,
        sql`ALTER TABLE sugu_purchases ADD COLUMN IF NOT EXISTS amount REAL NOT NULL DEFAULT 0`,
        sql`ALTER TABLE sugu_purchases ADD COLUMN IF NOT EXISTS invoice_number TEXT`,
        sql`ALTER TABLE sugu_purchases ADD COLUMN IF NOT EXISTS invoice_date TEXT`,
        sql`ALTER TABLE sugu_purchases ADD COLUMN IF NOT EXISTS due_date TEXT`,
        sql`ALTER TABLE sugu_purchases ADD COLUMN IF NOT EXISTS is_paid BOOLEAN NOT NULL DEFAULT FALSE`,
        sql`ALTER TABLE sugu_purchases ADD COLUMN IF NOT EXISTS paid_date TEXT`,
        sql`ALTER TABLE sugu_purchases ADD COLUMN IF NOT EXISTS payment_method TEXT`,
        sql`ALTER TABLE sugu_purchases ADD COLUMN IF NOT EXISTS notes TEXT`,
        sql`ALTER TABLE sugu_loans ADD COLUMN IF NOT EXISTS original_file_id INTEGER`,
        sql`ALTER TABLE sugu_loans ADD COLUMN IF NOT EXISTS loan_type TEXT NOT NULL DEFAULT 'emprunt'`,
        sql`ALTER TABLE sugu_files ADD COLUMN IF NOT EXISTS employee_id INTEGER`,
    ];
    for (const stmt of alterStatements) {
        try { await db.execute(stmt); } catch { /* column already exists or table missing — ignore */ }
    }
    const cashColumnAlters = [
        sql`ALTER TABLE sugu_cash_entries ADD COLUMN IF NOT EXISTS cbzen_amount REAL DEFAULT 0`,
        sql`ALTER TABLE sugu_cash_entries ADD COLUMN IF NOT EXISTS tr_amount REAL DEFAULT 0`,
        sql`ALTER TABLE sugu_cash_entries ADD COLUMN IF NOT EXISTS ctr_amount REAL DEFAULT 0`,
        sql`ALTER TABLE sugu_cash_entries ADD COLUMN IF NOT EXISTS ubereats_amount REAL DEFAULT 0`,
        sql`ALTER TABLE sugu_cash_entries ADD COLUMN IF NOT EXISTS deliveroo_amount REAL DEFAULT 0`,
        sql`ALTER TABLE sugu_cash_entries ADD COLUMN IF NOT EXISTS cheque_amount REAL DEFAULT 0`,
        sql`ALTER TABLE sugu_cash_entries ADD COLUMN IF NOT EXISTS virement_amount REAL DEFAULT 0`,
    ];
    for (const alter of cashColumnAlters) {
        try { await db.execute(alter); } catch {}
    }

    console.log("[SUGU] ✅ Column schema sync complete");

    try {
        await db.execute(sql`UPDATE sugu_general_expenses SET category = 'energie' WHERE category != 'energie' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(category, 'é', 'e'), 'É', 'E'), 'è', 'e'), 'È', 'E')) ~* '^[eé]lectricit[eé]$|^[eé]nergie?$|^energy$'`);
        await db.execute(sql`UPDATE sugu_general_expenses SET category = 'telecom' WHERE LOWER(REPLACE(REPLACE(category, 'é', 'e'), 'É', 'e')) IN ('telecom', 'telecommunications', 'telecomunications') AND category != 'telecom'`);
        await db.execute(sql`UPDATE sugu_general_expenses SET category = 'eau' WHERE category != 'eau' AND LOWER(category) = 'eau'`);
    } catch {}

    try {
        await db.execute(sql`UPDATE sugu_general_expenses SET "paymentMethod" = 'prelevement' WHERE ("paymentMethod" IS NULL OR "paymentMethod" = '') AND notes LIKE '%Prélèvement%'`);
        await db.execute(sql`UPDATE sugu_general_expenses SET "paymentMethod" = 'virement' WHERE ("paymentMethod" IS NULL OR "paymentMethod" = '') AND notes LIKE '%Virement%'`);
        await db.execute(sql`UPDATE sugu_general_expenses SET "paymentMethod" = 'cheque' WHERE ("paymentMethod" IS NULL OR "paymentMethod" = '') AND notes LIKE '%Chèque%'`);
        await db.execute(sql`UPDATE sugu_general_expenses SET "paymentMethod" = 'carte' WHERE ("paymentMethod" IS NULL OR "paymentMethod" = '') AND notes LIKE '%Carte%'`);
        await db.execute(sql`UPDATE sugu_general_expenses SET "paymentMethod" = 'especes' WHERE ("paymentMethod" IS NULL OR "paymentMethod" = '') AND notes LIKE '%Espèces%'`);
    } catch {}

    // Backfill: extract invoice numbers from notes into the dedicated invoice_number column
    try {
        const orphans = await db.execute(sql`SELECT id, notes FROM sugu_general_expenses WHERE invoice_number IS NULL AND notes LIKE '%Facture: %'`);
        const rows: any[] = (orphans as any).rows ?? (Array.isArray(orphans) ? orphans : []);
        for (const row of rows) {
            const m = (row.notes || "").match(/Facture:\s*([^\s|]{2,50})/);
            if (m?.[1]) {
                await db.execute(sql`UPDATE sugu_general_expenses SET invoice_number = ${m[1].trim()} WHERE id = ${row.id} AND invoice_number IS NULL`);
            }
        }
        if (rows.length > 0) console.log(`[SUGU] Backfilled invoice_number for ${rows.length} expense(s)`);
    } catch (e: any) { console.error("[SUGU] invoice_number backfill error:", e?.message); }

    try {
        const orphanRhFiles = await db.select().from(suguFiles)
            .where(and(eq(suguFiles.category, "rh"), isNull(suguFiles.employeeId)));
        if (orphanRhFiles.length > 0) {
            const allEmps = await db.select().from(suguEmployees);
            let linked = 0;
            for (const f of orphanRhFiles) {
                const name = (f.originalName || "").toUpperCase();
                const match = allEmps.find(e => {
                    const fullA = `${e.lastName} ${e.firstName}`.toUpperCase();
                    const fullB = `${e.firstName} ${e.lastName}`.toUpperCase();
                    return name.includes(fullA) || name.includes(fullB);
                });
                if (match) {
                    await db.update(suguFiles).set({ employeeId: match.id }).where(eq(suguFiles.id, f.id));
                    linked++;
                }
            }
            if (linked > 0) console.log(`[SUGU] Auto-linked ${linked}/${orphanRhFiles.length} orphaned RH files to employees`);
        }
    } catch (e: any) { console.error("[SUGU] RH auto-link error:", e?.message); }
}

// Backfill: create expense entries for frais_generaux files that have no associated expense
async function backfillExpensesFromFiles() {
    try {
        // Get all frais_generaux files
        const files = await db.select().from(suguFiles).where(eq(suguFiles.category, "frais_generaux"));
        if (!files.length) return;

        // Get all existing expenses
        const expenses = await db.select().from(suguExpenses);

        // Find files whose originalName isn't referenced in any expense's notes
        const orphanFiles = files.filter(f =>
            !expenses.some(e => e.notes && e.notes.includes(f.originalName))
        );

        if (!orphanFiles.length) {
            console.log(`[SUGU] Backfill: all ${files.length} frais_généraux files have linked expenses`);
            return;
        }

        console.log(`[SUGU] Backfill: ${orphanFiles.length} frais_généraux files without expenses, creating...`);

        for (const f of orphanFiles) {
            try {
                let parsed: ParsedDocumentData = { supplier: null, amount: null, taxAmount: null, date: null, dueDate: null, invoiceNumber: null, paymentMethod: null, category: null, siret: null, tvaNumber: null, address: null, city: null, postalCode: null, phone: null, email: null, iban: null };
                if (f.mimeType === "application/pdf" && !f.storagePath.startsWith("uploads/")) {
                    try {
                        const { buffer } = await downloadFromObjectStorage(f.storagePath);
                        parsed = await parseDocumentPDF(buffer, f.originalName);
                    } catch { /* file not in object storage */ }
                }

                const resolvedSupplier = String(parsed.supplier || f.supplier || f.originalName.replace(/\.[^.]+$/, "") || "Non spécifié");
                const resolvedAmount = typeof parsed.amount === "number" && parsed.amount > 0 ? parsed.amount : 0;
                const resolvedDate = parsed.date || (f.fileDate ? String(f.fileDate) : new Date().toISOString().substring(0, 10));
                const supplierCategoryMap: Record<string, string> = {
                    "zenorder": "plateformes", "pardes ventures": "plateformes", "eatoffice": "plateformes",
                    "deliveroo": "plateformes", "uber eats": "plateformes", "just eat": "plateformes", "glovo": "plateformes",
                    "edf": "energie", "engie": "energie", "enedis": "energie", "grdf": "energie",
                    "saur": "eau", "veolia": "eau", "suez": "eau", "semm": "eau", "eau de marseille": "eau",
                    "elis": "entretien",
                    "axa": "assurances", "allianz": "assurances", "maif": "assurances", "macif": "assurances", "groupama": "assurances",
                    "orange": "telecom", "sfr": "telecom", "bouygues telecom": "telecom", "free": "telecom",
                };
                const supplierLower = resolvedSupplier.toLowerCase();
                const inferredCategory = Object.entries(supplierCategoryMap).find(([k]) => supplierLower.includes(k))?.[1];
                const resolvedCategory = parsed.category || inferredCategory || "autre";
                const period = resolvedDate.substring(0, 7);

                const resolvedTaxAmount = typeof parsed.taxAmount === "number" && parsed.taxAmount >= 0 ? parsed.taxAmount : 0;
                const [expense] = await db.insert(suguExpenses).values({
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

                console.log(`[SUGU] Backfill: created expense #${expense.id} from file "${f.originalName}"`);
            } catch (insertErr: any) {
                console.error(`[SUGU] Backfill: failed to create expense for "${f.originalName}":`, insertErr?.message);
            }
        }
    } catch (err: any) {
        console.error("[SUGU] Backfill error:", err?.message || err);
    }
}

// Backfill: create purchase entries for achats files that have no associated purchase
async function backfillPurchasesFromFiles() {
    try {
        const files = await db.select().from(suguFiles).where(eq(suguFiles.category, "achats"));
        if (!files.length) return;

        const purchases = await db.select().from(suguPurchases);

        const orphanFiles = files.filter(f =>
            !purchases.some(p =>
                (p.notes && p.notes.includes(f.originalName)) ||
                (p.description && p.description.includes(f.originalName)) ||
                (p.invoiceNumber && f.originalName.includes(p.invoiceNumber || ""))
            )
        );

        if (!orphanFiles.length) {
            console.log(`[SUGU] Backfill: all ${files.length} achats files have linked purchases`);
            return;
        }

        console.log(`[SUGU] Backfill: ${orphanFiles.length} achats files without purchases, creating...`);

        for (const f of orphanFiles) {
            try {
                const parsed: ParsedDocumentData = { supplier: null, amount: null, taxAmount: null, date: null, dueDate: null, invoiceNumber: null, paymentMethod: null, category: null, siret: null, tvaNumber: null, address: null, city: null, postalCode: null, phone: null, email: null, iban: null };
                // NOTE: PDF parsing is intentionally SKIPPED during startup backfill to prevent
                // EIO crashes when pdf-parse loads its internal PDF.js dependency on GCE production.
                // The user can re-parse or edit the entry manually after it's created.

                const resolvedSupplier = String(parsed.supplier || f.supplier || f.originalName.replace(/\.[^.]+$/, "") || "Non spécifié");
                const resolvedAmount = typeof parsed.amount === "number" && parsed.amount >= 0 ? parsed.amount : 0;
                const resolvedDate = parsed.date || (f.fileDate ? String(f.fileDate) : new Date().toISOString().substring(0, 10));
                const resolvedPayment = parsed.paymentMethod || null;
                const resolvedInvoice = parsed.invoiceNumber || null;

                const noteParts: string[] = [];
                if (resolvedInvoice) noteParts.push(`Facture: ${resolvedInvoice}`);
                if (resolvedPayment) noteParts.push(`Paiement: ${resolvedPayment}`);
                noteParts.push(`Document: ${f.originalName}`);

                await db.insert(suguPurchases).values({
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

                console.log(`[SUGU] Backfill: created purchase from file "${f.originalName}"`);
            } catch (pErr: any) {
                console.error("[SUGU] Failed to backfill purchase for file", f.id, pErr?.message || pErr);
            }
        }

        console.log(`[SUGU] Backfill: completed purchases for ${orphanFiles.length} files`);
    } catch (err) {
        console.error("[SUGU] Backfill purchases failed:", err);
    }
}

// Backfill: parse bank PDF files that have no associated bank entries
async function backfillBankEntriesFromFiles() {
    try {
        const files = await db.select().from(suguFiles).where(eq(suguFiles.category, "banque"));
        if (!files.length) return;

        const bankEntries = await db.select().from(suguBankEntries);
        const orphanFiles = files.filter(f =>
            f.mimeType === "application/pdf" &&
            !bankEntries.some(b => b.notes && b.notes.includes(f.originalName))
        );

        if (!orphanFiles.length) {
            console.log(`[SUGU] Backfill: all ${files.length} banque files have linked entries`);
            return;
        }

        console.log(`[SUGU] Backfill: ${orphanFiles.length} banque PDF files without entries, parsing...`);

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
                    console.log(`[SUGU] Backfill bank: file not found in object storage: ${f.storagePath}`);
                    continue;
                }
                const bankResult = await parseBankStatementPDF(buffer);

                if (!bankResult.success || bankResult.entries.length === 0) {
                    console.log(`[SUGU] Backfill bank: no entries found in "${f.originalName}"`);
                    continue;
                }

                const existingEntries = await db.select()
                    .from(suguBankEntries)
                    .where(
                        and(
                            gte(suguBankEntries.entryDate, bankResult.periodStart),
                            lte(suguBankEntries.entryDate, bankResult.periodEnd)
                        )
                    );

                const existingSet = new Set(
                    existingEntries.map((e: any) => `${e.entryDate}|${e.amount}|${e.label?.substring(0, 30)}`)
                );
                const newEntries = bankResult.entries.filter(e =>
                    !existingSet.has(`${e.entryDate}|${e.amount}|${e.label.substring(0, 30)}`)
                );

                if (newEntries.length === 0) {
                    console.log(`[SUGU] Backfill bank: all ${bankResult.entries.length} entries from "${f.originalName}" already exist`);
                    continue;
                }

                const inserted = await db.insert(suguBankEntries).values(
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
                console.log(`[SUGU] Backfill bank: imported ${inserted.length} entries from "${f.originalName}"`);
            } catch (parseErr: any) {
                console.error(`[SUGU] Backfill bank: failed for "${f.originalName}":`, parseErr?.message);
            }
        }
    } catch (err: any) {
        console.error("[SUGU] Backfill bank entries failed:", err?.message || err);
    }
}

// Launch table creation with retry (non-blocking)
const tablesReady = ensureSuguTables();

const fileUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// ============ PDF INVOICE / BILL PARSER (universal) ============
interface ParsedDocumentData {
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

const KNOWN_SUPPLIER_MAP: Record<string, { name: string; category: string }> = {
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

function resolveSupplierFromFilename(filename: string): { name: string; category: string } | null {
    const nameWithoutExt = filename.replace(/\.[^.]+$/, "").toLowerCase();
    const parts = nameWithoutExt.split(/[\s_\-]+/);
    for (const part of parts) {
        if (part.length < 2) continue;
        const match = KNOWN_SUPPLIER_MAP[part];
        if (match) return match;
    }
    const joined = parts.join("");
    for (const [key, val] of Object.entries(KNOWN_SUPPLIER_MAP)) {
        if (joined.includes(key)) return val;
    }
    return null;
}

let _pdfParseFn: any = null;
async function getPdfParse() {
    if (_pdfParseFn) return _pdfParseFn;
    const mod = await import("pdf-parse/lib/pdf-parse.js");
    _pdfParseFn = mod.default || mod;
    return _pdfParseFn;
}

// Category detection from supplier / text
const CATEGORY_KEYWORDS: Record<string, string[]> = {
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
    travaux: ["travaux", "rénovation", "renovation", "réparation", "chantier", "maçonnerie", "peinture", "plâtrerie", "carrelage", "plomberie", "électricité", "toiture", "façade", "terrassement", "démolition", "construction", "btp", "gros oeuvre", "second oeuvre"],
    plateformes: ["deliveroo", "uber eats", "ubereats", "just eat", "justeat", "glovo", "commission plateforme"],
    alimentaire: ["alimentaire", "viande", "poisson", "légume", "fruit", "épice", "huile", "farine", "sucre", "lait", "fromage", "beurre", "oeuf", "volaille", "boeuf", "poulet"],
    boissons: ["boisson", "coca", "orangina", "bière", "vin", "jus", "limonade", "sirop", "eau minérale", "perrier", "evian", "vittel", "badoit"],
    services: ["commission", "frais d'adhésion", "onboarding fee", "relevé de paiement", "frais de service"],
};

// Payment method detection
const PAYMENT_KEYWORDS: Record<string, string[]> = {
    prelevement: ["prélèvement", "prelevement", "prélevé", "preleve", "mandat sepa", "rum", "sepa", "prélèvement sepa", "tip sepa", "avis de prélèvement"],
    virement: ["virement", "rib", "iban", "vir ", "virement bancaire", "virement sepa"],
    cb: ["carte bancaire", "carte bleue", "cb ", "visa", "mastercard", "terminal", "tpe", "paiement carte"],
    cheque: ["chèque", "cheque", "chq"],
    especes: ["espèces", "especes", "cash"],
};

// ============ LOAN DOCUMENT PARSER ============

export interface ParsedLoanData {
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

function parseFrenchAmount(s: string): number | null {
    const clean = s.replace(/[\s\u00a0]/g, "").replace(",", ".");
    const n = parseFloat(clean);
    return isNaN(n) ? null : n;
}

function parseFrenchDate(s: string): string | null {
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    return `${m[3]}-${m[2]}-${m[1]}`;
}

function detectBankFromText(text: string): string | null {
    const checks: [RegExp, string][] = [
        [/soci[eé]t[eé]\s*g[eé]n[eé]rale|professionnels\.sg\.fr|sg\.fr/i, "Société Générale"],
        [/bnp\s*paribas|mabanque\.bnpparibas/i, "BNP Paribas"],
        [/cr[eé]dit\s*agricole/i, "Crédit Agricole"],
        [/caisse\s*d['e]?\s*[eé]pargne/i, "Caisse d'Épargne"],
        [/la\s*banque\s*postale/i, "La Banque Postale"],
        [/lcl|le\s*cr[eé]dit\s*lyonnais/i, "LCL"],
        [/cr[eé]dit\s*mutuel/i, "Crédit Mutuel"],
        [/cic\b/i, "CIC"],
        [/hsbc/i, "HSBC"],
        [/bpifrance|bpi\s*france/i, "BPIFrance"],
        [/boursorama/i, "Boursorama"],
        [/ing\s*direct|ingdirect/i, "ING Direct"],
        [/hello\s*bank/i, "Hello Bank"],
        [/revolut/i, "Revolut"],
        [/banque\s*populaire/i, "Banque Populaire"],
    ];
    for (const [rx, name] of checks) {
        if (rx.test(text)) return name;
    }
    return null;
}

// Helper: find a value within a window of chars after a label
function findAfterLabel(text: string, labelRegex: RegExp, valueRegex: RegExp, windowSize = 500): RegExpMatchArray | null {
    const lm = labelRegex.exec(text);
    if (!lm) return null;
    const window = text.substring(lm.index! + lm[0].length, lm.index! + lm[0].length + windowSize);
    return valueRegex.exec(window);
}

async function parseLoanDocument(buffer: Buffer, filename?: string): Promise<ParsedLoanData> {
    const result: ParsedLoanData = { loanType: "emprunt", confidence: "low" };

    // Extract raw text
    let text = "";
    try {
        const pdfParseTimeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("pdf-parse timeout (10s)")), 10000)
        );
        const parsePdf = await getPdfParse();
        const pdfData = await Promise.race([parsePdf(buffer), pdfParseTimeout]);
        text = pdfData.text || "";
    } catch (e: any) {
        console.warn("[SUGU] Loan pdf-parse failed:", e?.message);
    }

    // Normalize ALL Unicode whitespace (incl. non-breaking space U+00A0, etc.)
    // Note: JS \s already matches U+00A0, but some PDFs use other space chars
    const textNorm = text.replace(/[\s\u00a0\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u200b\u202f\u205f\u3000\ufeff]+/g, " ").trim();

    console.log(`[SUGU] Loan PDF text extracted: ${textNorm.length} chars, preview: "${textNorm.substring(0, 200)}"`);

    // --- Detect document type ---
    const isAmortTable = /tableau\s+d['\u2019e]amortissement|plan\s+de\s+remboursement|[eé]ch[eé]ancier/i.test(textNorm);
    const isLoanOffer = /offre\s+de\s+pr[eê]t|contrat\s+de\s+pr[eê]t/i.test(textNorm);
    const isLOA = /location\s+avec\s+option\s+d['\u2019]achat|loa\b|loyer.*option/i.test(textNorm);
    const isLLD = /location\s+longue\s+dur[eé]e|lld\b|leasing.*longue/i.test(textNorm);

    if (isLOA) result.loanType = "loa";
    else if (isLLD) result.loanType = "lld";
    else result.loanType = "emprunt";

    result.detectedDocType = isAmortTable ? "tableau_amortissement" : isLoanOffer ? "offre_pret" : isLOA ? "loa" : isLLD ? "lld" : "document_financier";

    // --- Bank detection ---
    const bank = detectBankFromText(textNorm);
    if (bank) result.bankName = bank;

    // French amount pattern: "50 000,00" or "50000.00" or "50 000.00"
    const amtPat = /(\d[\d\s]*[,\.]\d{2})/;

    if (text.length > 50) {
        // --- Montant du prêt ---
        // PDFs à deux colonnes: label et valeur peuvent être éloignés jusqu'à 500 chars
        const totalAmtM =
            findAfterLabel(textNorm, /montant\s+du\s+pr[eê]t/i, amtPat, 500) ||
            findAfterLabel(textNorm, /capital\s+emprunt[eé]/i, amtPat, 300) ||
            findAfterLabel(textNorm, /montant\s+financ[eé]/i, amtPat, 300) ||
            findAfterLabel(textNorm, /capital\s+initial/i, amtPat, 300);
        if (totalAmtM) {
            const v = parseFrenchAmount(totalAmtM[1]);
            if (v && v > 1000) result.totalAmount = v;
        }

        // --- Taux d'intérêt ---
        const rateMatch = textNorm.match(/taux\s+d['\u2019e]int[eé]r[eê]t[^%\d]{0,80}(\d+[\.,]\d+)\s*%/i) ||
                          textNorm.match(/taux\s+annuel[^%\d]{0,80}(\d+[\.,]\d+)\s*%/i) ||
                          textNorm.match(/taux\s+nominale?[^%\d]{0,80}(\d+[\.,]\d+)\s*%/i);
        if (rateMatch) {
            const v = parseFrenchAmount(rateMatch[1]);
            if (v && v < 30) result.interestRate = v;
        }

        // --- Date de signature / début ---
        const datePat = /(\d{2}\/\d{2}\/\d{4})/;
        const sigDateM =
            findAfterLabel(textNorm, /date\s+de\s+signature/i, datePat, 300) ||
            findAfterLabel(textNorm, /date\s+d['\u2019e]ff?et/i, datePat, 300) ||
            findAfterLabel(textNorm, /souscrit\s+le/i, datePat, 100) ||
            findAfterLabel(textNorm, /sign[eé]\s+le/i, datePat, 100);
        if (sigDateM) {
            const d = parseFrenchDate(sigDateM[1]);
            if (d) result.startDate = d;
        }

        // --- Date de fin ---
        const endDateM =
            findAfterLabel(textNorm, /date\s+de\s+fin/i, datePat, 300) ||
            findAfterLabel(textNorm, /derni[eè]re\s+[eé]ch[eé]ance/i, datePat, 200) ||
            findAfterLabel(textNorm, /fin\s+du\s+pr[eê]t/i, datePat, 100);
        if (endDateM) {
            const d = parseFrenchDate(endDateM[1]);
            if (d) result.endDate = d;
        }

        // --- Référence du prêt → notes ---
        const refMatch =
            findAfterLabel(textNorm, /r[eé]f[eé]rence\s+du\s+pr[eê]t/i, /(\w[\w\-]+)/, 200) ||
            findAfterLabel(textNorm, /n[°º]\s*de\s+pr[eê]t\s*:?/i, /(\w[\w\-]+)/, 100) ||
            findAfterLabel(textNorm, /num[eé]ro\s+de\s+pr[eê]t\s*:?/i, /(\w[\w\-]+)/, 100);
        if (refMatch) result.notes = `Réf. prêt: ${refMatch[1]}`;

        // --- Mensualité (fallback si pas trouvé dans les lignes) ---
        const echeanceM =
            findAfterLabel(textNorm, /[eé]ch[eé]ance\s+globale/i, amtPat, 200) ||
            findAfterLabel(textNorm, /mensualit[eé]/i, amtPat, 200) ||
            findAfterLabel(textNorm, /montant\s+de\s+l['\u2019]?[eé]ch[eé]ance/i, amtPat, 200);
        let fallbackMonthly: number | undefined;
        if (echeanceM) {
            const v = parseFrenchAmount(echeanceM[1]);
            if (v && v > 10) fallbackMonthly = v;
        }

        // --- Parse amortization table rows ---
        // Format: "1 05/12/2025 EUR 745,46 17,12 201,40 526,94 47 905,29"
        // Also try without EUR: "1 05/12/2025 745,46 17,12 201,40 526,94 47 905,29"
        const rowRegex = /\b(\d{1,4})\s+(\d{2}\/\d{2}\/\d{4})\s+(?:EUR\s+)?([\d][\d\s]*[,\.]\d{2})\s+([\d][\d\s]*[,\.]\d{2})\s+([\d][\d\s]*[,\.]\d{2})\s+([\d][\d\s]*[,\.]\d{2})\s+([\d][\d\s]*[,\.]\d{2})/g;
        const rows: Array<{ n: number; date: Date; monthly: number; capital: number }> = [];
        let m: RegExpExecArray | null;
        while ((m = rowRegex.exec(textNorm)) !== null) {
            const rowN = parseInt(m[1]);
            if (rowN < 1 || rowN > 600) continue;
            const dateStr = parseFrenchDate(m[2]);
            const monthly = parseFrenchAmount(m[3]);
            const capital = parseFrenchAmount(m[7]);
            if (dateStr && monthly && capital && monthly > 10 && capital > 0) {
                rows.push({ n: rowN, date: new Date(dateStr), monthly, capital });
            }
        }

        console.log(`[SUGU] Loan amort rows found: ${rows.length}`);

        if (rows.length > 0) {
            result.monthlyPayment = rows[0].monthly;
            const now = new Date();
            const past = rows.filter(r => r.date <= now);
            const future = rows.filter(r => r.date > now);
            if (past.length > 0) {
                result.remainingAmount = past[past.length - 1].capital;
            } else if (future.length > 0) {
                result.remainingAmount = result.totalAmount || future[0].capital + future[0].monthly;
            }
            if (!result.endDate && rows.length > 0) {
                result.endDate = rows[rows.length - 1].date.toISOString().split("T")[0];
            }
            if (!result.startDate && rows.length > 0) {
                // Estimate start date: first row date minus 1 month approx
                const firstDate = new Date(rows[0].date);
                firstDate.setMonth(firstDate.getMonth() - 8);
                result.startDate = firstDate.toISOString().split("T")[0];
            }
            result.confidence = "high";
        } else if (result.totalAmount || (result.interestRate && result.bankName)) {
            if (fallbackMonthly) result.monthlyPayment = fallbackMonthly;
            result.confidence = result.totalAmount ? "medium" : "low";
        }

        // --- Emprunteur → build loan label ---
        const emprunteurM = findAfterLabel(textNorm, /emprunteur/i, /([A-ZÀÂÇÉÈÊËÎÏÔÙÛÜ][A-ZÀÂÇÉÈÊËÎÏÔÙÛÜ\s]{2,40})/, 200);
        if (emprunteurM) {
            const emprunteur = emprunteurM[1].trim().replace(/\s+/g, " ");
            const typeLabel = result.loanType === "loa" ? "LOA" : result.loanType === "lld" ? "LLD" : "Emprunt";
            result.loanLabel = `${typeLabel} ${result.bankName || ""} — ${emprunteur}`.replace(/\s+/g, " ").trim();
        }
    }

    // --- AI fallback if regex gave low/medium confidence without key fields ---
    if (!result.totalAmount || !result.monthlyPayment || !result.startDate) {
        console.log("[SUGU] Loan regex parse incomplete, trying AI...");
        try {
            const aiResult = await parseLoanDocumentWithAI(text || "", buffer, filename);
            if (aiResult) {
                if (aiResult.loanLabel && !result.loanLabel) result.loanLabel = aiResult.loanLabel;
                if (aiResult.bankName && !result.bankName) result.bankName = aiResult.bankName;
                if (aiResult.loanType) result.loanType = aiResult.loanType;
                if (aiResult.totalAmount && !result.totalAmount) result.totalAmount = aiResult.totalAmount;
                if (aiResult.remainingAmount && !result.remainingAmount) result.remainingAmount = aiResult.remainingAmount;
                if (aiResult.monthlyPayment && !result.monthlyPayment) result.monthlyPayment = aiResult.monthlyPayment;
                if (aiResult.interestRate && !result.interestRate) result.interestRate = aiResult.interestRate;
                if (aiResult.startDate && !result.startDate) result.startDate = aiResult.startDate;
                if (aiResult.endDate && !result.endDate) result.endDate = aiResult.endDate;
                if (aiResult.notes && !result.notes) result.notes = aiResult.notes;
                if (result.totalAmount && result.confidence === "low") result.confidence = "medium";
            }
        } catch (e: any) {
            console.error("[SUGU] Loan AI parse failed:", e?.message);
        }
    }

    // Final confidence recalculation
    if (result.confidence === "low" && (result.bankName || result.interestRate)) result.confidence = "low";
    if (result.totalAmount && result.monthlyPayment && result.startDate) result.confidence = result.confidence === "high" ? "high" : "medium";

    console.log(`[SUGU] Loan doc parsed (${result.confidence}): ${result.loanLabel || "?"}, ${result.totalAmount}€, ${result.bankName || "??"}`);
    return result;
}

async function parseLoanDocumentWithAI(text: string, buffer: Buffer, filename?: string): Promise<ParsedLoanData | null> {
    const { getGeminiNativeRequired } = await import("../../services/core/openaiClient");
    const gemini = getGeminiNativeRequired();

    const today = new Date().toISOString().split("T")[0];
    const filenameHint = filename ? `\nNom du fichier: ${filename}` : "";
    const hasText = text.trim().length >= 20;

    const promptInstructions = `Tu es un expert en analyse de documents financiers français. Analyse ce document et extrait les informations du prêt / financement.${filenameHint}

Date du jour: ${today}

${hasText ? `TEXTE EXTRAIT DU PDF:\n${text.substring(0, 8000)}` : "ATTENTION: Le texte n'a pas pu être extrait du PDF. Analyse l'image/document visuel fourni."}

Extrais ces informations et réponds UNIQUEMENT avec un JSON valide:
{
  "loanLabel": "Libellé du prêt (ex: Emprunt Société Générale — SUGU VALENTINE)",
  "bankName": "Nom de la banque ou organisme financier",
  "loanType": "emprunt|loa|lld",
  "totalAmount": 50000.00,
  "remainingAmount": 46844.83,
  "monthlyPayment": 745.46,
  "interestRate": 4.99,
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "notes": "Réf. contrat si disponible"
}

RÈGLES:
- totalAmount = montant total emprunté (initial)
- remainingAmount = capital restant dû À LA DATE DU JOUR (${today}), pas à la fin
- Pour un tableau d'amortissement: trouve la dernière ligne dont la date est PASSÉE (avant ${today}), c'est le "capital restant dû après amortissement" de cette ligne
- monthlyPayment = mensualité/loyer mensuel
- loanType: "emprunt" si prêt classique, "loa" si Location avec Option d'Achat, "lld" si Location Longue Durée
- Si information non trouvée, mets null (pas de chaîne vide)`;

    const parseLoanJson = (raw: string): ParsedLoanData | null => {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;
        try {
            const parsed = JSON.parse(jsonMatch[0]);
            const result: ParsedLoanData = {};
            if (typeof parsed.loanLabel === "string") result.loanLabel = parsed.loanLabel;
            if (typeof parsed.bankName === "string") result.bankName = parsed.bankName;
            if (["emprunt", "loa", "lld"].includes(parsed.loanType)) result.loanType = parsed.loanType;
            if (typeof parsed.totalAmount === "number" && parsed.totalAmount > 0) result.totalAmount = parsed.totalAmount;
            if (typeof parsed.remainingAmount === "number" && parsed.remainingAmount >= 0) result.remainingAmount = parsed.remainingAmount;
            if (typeof parsed.monthlyPayment === "number" && parsed.monthlyPayment > 0) result.monthlyPayment = parsed.monthlyPayment;
            if (typeof parsed.interestRate === "number" && parsed.interestRate > 0) result.interestRate = parsed.interestRate;
            if (typeof parsed.startDate === "string" && parsed.startDate.match(/^\d{4}-\d{2}-\d{2}$/)) result.startDate = parsed.startDate;
            if (typeof parsed.endDate === "string" && parsed.endDate.match(/^\d{4}-\d{2}-\d{2}$/)) result.endDate = parsed.endDate;
            if (typeof parsed.notes === "string") result.notes = parsed.notes;
            return result;
        } catch { return null; }
    };

    // When text was extracted successfully, use text-based approach
    if (hasText) {
        try {
            const resp = await gemini.models.generateContent({
                model: "gemini-2.5-flash",
                contents: [{ role: "user", parts: [{ text: promptInstructions }] }],
            });
            const raw = resp.candidates?.[0]?.content?.parts?.[0]?.text || "";
            return parseLoanJson(raw);
        } catch (e: any) {
            console.error("[SUGU] Gemini loan text parse failed:", e?.message);
            return null;
        }
    }

    // Fallback: pdf-parse failed (EIO in production) — send PDF as base64 vision to Gemini
    // Gemini natively supports PDF inline data for vision analysis
    console.log("[SUGU] Loan PDF text empty — switching to Gemini PDF vision fallback");
    try {
        const detectedMime = detectBufferMimeType(buffer, filename);
        const mimeType = detectedMime === "application/pdf" ? "application/pdf" : detectedMime;
        const base64Data = buffer.toString("base64");
        const resp = await gemini.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{
                role: "user",
                parts: [
                    { inlineData: { mimeType, data: base64Data } },
                    { text: promptInstructions },
                ],
            }],
        });
        const raw = resp.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const result = parseLoanJson(raw);
        if (result) console.log("[SUGU] Gemini PDF vision loan parse succeeded");
        return result;
    } catch (e: any) {
        console.error("[SUGU] Gemini loan vision parse failed:", e?.message);
        return null;
    }
}

/**
 * Cleans watermark artifacts from PDF text (e.g. METRO "DUPLICATE" diagonal watermark
 * which pdf-parse extracts as isolated short tokens like "ta", "a", "lic", "p", "Du", "**").
 * Removes lines consisting solely of 1-3 non-space chars or only asterisks/dashes.
 */
function cleanPdfText(raw: string): string {
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

function detectBufferMimeType(buffer: Buffer, filename?: string): string {
    if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return "image/jpeg";
    if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return "image/png";
    if (buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) return "application/pdf";
    if (filename) {
        const ext = filename.toLowerCase().split(".").pop();
        if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
        if (ext === "png") return "image/png";
        if (ext === "pdf") return "application/pdf";
    }
    return "application/octet-stream";
}

async function parseDocumentPDF(buffer: Buffer, filename?: string, restaurant: "val" | "maillane" = "val"): Promise<ParsedDocumentData> {
    const result: ParsedDocumentData = {
        supplier: null, amount: null, taxAmount: null, date: null, dueDate: null,
        invoiceNumber: null, paymentMethod: null, category: null,
        siret: null, tvaNumber: null, address: null, city: null,
        postalCode: null, phone: null, email: null, iban: null,
    };

    const detectedMime = detectBufferMimeType(buffer, filename);
    const isImage = detectedMime.startsWith("image/");

    const knowledgeHints = await getKnowledgePromptHints(restaurant).catch(() => "");

    let text = "";
    let textLower = "";
    let pdfTextExtracted = false;

    if (!isImage) {
        try {
            const pdfParseTimeout = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("pdf-parse timeout (10s)")), 10000)
            );
            const parsePdf = await getPdfParse();
            const pdfData = await Promise.race([parsePdf(buffer), pdfParseTimeout]);
            text = cleanPdfText(pdfData.text || "");
            textLower = text.toLowerCase();
            pdfTextExtracted = text.length >= 20;
        } catch (pdfErr: any) {
            console.warn(`[SUGU] pdf-parse text extraction failed (${pdfErr?.message}), will use vision AI`);
        }
    } else {
        console.log(`[SUGU] Image file detected (${detectedMime}), skipping pdf-parse — going straight to vision AI`);
    }

    // =================================================================
    // PRIMARY: AI extraction using Gemini (most reliable for all formats)
    // Strategy: text-based AI if text available, direct PDF vision if not
    // =================================================================
    let aiSuccess = false;
    try {
        let aiResult: Partial<ParsedDocumentData> | null = null;
        if (pdfTextExtracted) {
            aiResult = await parseDocumentWithAI(text, filename, knowledgeHints);
        }
        if (!aiResult || !(aiResult.supplier && typeof aiResult.amount === "number" && aiResult.amount !== 0)) {
            console.log(`[SUGU] Text-based AI ${pdfTextExtracted ? "incomplete" : "skipped (no text)"}, trying GPT-4o vision...`);
            aiResult = await parseDocumentWithGPT4oVision(buffer, filename, knowledgeHints);
        }
        if (!aiResult || !(aiResult.supplier && typeof aiResult.amount === "number" && aiResult.amount !== 0)) {
            console.log(`[SUGU] GPT-4o vision incomplete, falling back to Gemini vision...`);
            aiResult = await parseDocumentWithAIVision(buffer, filename, knowledgeHints);
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
            console.log(`[SUGU] AI extraction: supplier=${result.supplier}, amount=${result.amount}, date=${result.date}, invoice=${result.invoiceNumber}`);
        }
    } catch (aiErr: any) {
        console.error(`[SUGU] AI extraction failed, using regex fallback:`, aiErr?.message);
    }

    if (result.supplier) {
        const learnedCategory = await overrideCategoryFromKnowledge(result.supplier, restaurant).catch(() => null);
        if (learnedCategory && learnedCategory !== result.category) {
            console.log(`[SuguLearning] Category override: "${result.category}" → "${learnedCategory}" for supplier "${result.supplier}"`);
            result.category = learnedCategory;
        }
    }

    if (!pdfTextExtracted) {
        console.log(`[SUGU] PDF text unavailable — regex fallback skipped, AI-only results used`);
        return result;
    }

        // =================================================================
        // AMOUNT OVERRIDE: "Total à payer" is always the definitive amount
        // This catches cases where AI picks a partial TVA line instead
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
                    console.log(`[SUGU] Amount override: ${result.amount} → ${val} (from "Total à payer" / CB receipt)`);
                    result.amount = val;
                    break;
                }
            }
        }

        // =================================================================
        // FALLBACK: Regex extraction (fill gaps not covered by AI)
        // =================================================================

        // --- SUPPLIER ---
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

        // --- AMOUNTS: TTC > Total > Montant (only if AI didn't find one) ---
        if (result.amount == null || result.amount === 0) {
            const isDeliverooDoc = textLower.includes("relevé de paiement") || textLower.includes("deliveroo") || textLower.includes("uber eats");
            if (isDeliverooDoc) {
                const deliverooPayMatch = text.match(/Montant\s+total\s+à\s+payer\s+(?:à\s+)?(?:SUGU|au\s+site)[^€]*€\s*(-?\d[\d\s]*[.,]\d{2})/i);
                if (deliverooPayMatch?.[1]) {
                    const cleaned = deliverooPayMatch[1].replace(/\s/g, "").replace(",", ".");
                    const val = parseFloat(cleaned);
                    if (Math.abs(val) < 1_000_000) { result.amount = val; }
                }
                if ((result.amount == null || result.amount === 0)) {
                    const debitMatch = text.match(/Débit\s*:\s*frais\s+supplémentaires\s+€?\s*(-?\d[\d\s]*[.,]\d{2})/i)
                        || text.match(/Débit\s*:\s*frais\s+supplémentaires[^€]*€\s*(-?\d[\d\s]*[.,]\d{2})/i);
                    if (debitMatch?.[1]) {
                        const cleaned = debitMatch[1].replace(/\s/g, "").replace(",", ".");
                        const val = parseFloat(cleaned);
                        if (val !== 0 && Math.abs(val) < 1_000_000) { result.amount = val; }
                    }
                }
            }
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

        // --- TVA AMOUNT ---
        if (result.taxAmount === null) {
            const isDeliverooStyle = textLower.includes("relevé de paiement") || textLower.includes("ceci n'est pas une facture avec la tva");
            if (!isDeliverooStyle) {
                const tvaPatterns = [
                    /(?:total\s+t\.?v\.?a\.?|montant\s+t\.?v\.?a\.?)[^\d-]*(-?\d[\d\s]*[.,]\d{2})\s*(?:€|eur)?/i,
                    /(?:dont\s+t\.?v\.?a\.?)\s*[:\s]*(-?\d[\d\s]*[.,]\d{2})\s*(?:€|eur)?/i,
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
            } else {
                result.taxAmount = 0;
                console.log(`[SUGU] Deliveroo/platform payment statement detected — setting taxAmount=0`);
            }
        }

        // --- TVA SANITY CHECK: taxAmount should never exceed amount ---
        if (result.taxAmount !== null && result.amount !== null && Math.abs(result.taxAmount) > Math.abs(result.amount)) {
            console.log(`[SUGU] Regex taxAmount (${result.taxAmount}) > amount (${result.amount}) — resetting to 0`);
            result.taxAmount = 0;
        }

        // --- DATE ---
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

        // --- INVOICE NUMBER ---
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

        // --- PAYMENT METHOD ---
        if (!result.paymentMethod) {
            for (const [method, keywords] of Object.entries(PAYMENT_KEYWORDS)) {
                if (keywords.some(kw => textLower.includes(kw))) {
                    result.paymentMethod = method === "prelevement" ? "prélèvement"
                        : method === "cheque" ? "chèque"
                            : method === "especes" ? "espèces"
                                : method;
                    break;
                }
            }
        }

        // --- CATEGORY ---
        if (!result.category) {
            for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
                if (keywords.some(kw => textLower.includes(kw))) {
                    result.category = cat;
                    break;
                }
            }
        }

        // --- SIRET ---
        if (!result.siret) {
            const siretMatch = text.match(/(?:siret|siren)\s*[:\s]*(\d[\d\s]{8,16}\d)/i);
            if (siretMatch?.[1]) result.siret = siretMatch[1].replace(/\s/g, "").substring(0, 14);
        }

        // --- TVA INTRA-COMMUNAUTAIRE ---
        if (!result.tvaNumber) {
            const tvaNumMatch = text.match(/(?:tva\s+intra|n[°o]\s*tva|identifiant\s+tva)\s*[:\s]*(FR\s*\d{2}\s*\d{3}\s*\d{3}\s*\d{3})/i);
            if (tvaNumMatch?.[1]) result.tvaNumber = tvaNumMatch[1].replace(/\s/g, "");
        }

        // --- ADDRESS / CITY / POSTAL CODE ---
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

        // --- PHONE ---
        if (!result.phone) {
            const phoneMatch = text.match(/(?:t[ée]l[ée]?phone|t[ée]l\.?|tel\s*:)\s*[:\s]*((?:\+33|0)\s*[\d\s.\-]{8,14})/i)
                || text.match(/((?:\+33|0)\d[\s.\-]?\d{2}[\s.\-]?\d{2}[\s.\-]?\d{2}[\s.\-]?\d{2})/);
            if (phoneMatch?.[1]) result.phone = phoneMatch[1].replace(/[\s.\-]/g, "").substring(0, 15);
        }

        // --- EMAIL ---
        if (!result.email) {
            const emailMatch = text.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/);
            if (emailMatch?.[1]) result.email = emailMatch[1].toLowerCase();
        }

        // --- IBAN ---
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
            const knownFromFilename = resolveSupplierFromFilename(filename);
            if (knownFromFilename) {
                if (result.supplier !== knownFromFilename.name) {
                    console.log(`[SUGU] Supplier override from filename: "${result.supplier}" → "${knownFromFilename.name}" (filename: ${filename})`);
                    result.supplier = knownFromFilename.name;
                }
                if (!result.category || result.category !== knownFromFilename.category) {
                    console.log(`[SUGU] Category override from filename supplier: "${result.category}" → "${knownFromFilename.category}"`);
                    result.category = knownFromFilename.category;
                }
            }
        }

    console.log(`[SUGU] PDF parsed (AI=${aiSuccess ? "yes" : "no"}): supplier=${result.supplier}, amount=${result.amount}, category=${result.category}, taxAmount=${result.taxAmount}, siret=${result.siret}, tva=${result.tvaNumber}, date=${result.date}, invoice=${result.invoiceNumber}`);

    return result;
}

async function parseDocumentWithAI(pdfText: string, filename?: string, knowledgeHints?: string): Promise<Partial<ParsedDocumentData> | null> {
    const { getGeminiNativeRequired } = await import("../../services/core/openaiClient");
    const gemini = getGeminiNativeRequired();

    const MAX_CHARS = 12000;
    const truncatedText = pdfText.length > MAX_CHARS
        ? pdfText.substring(0, 8000) + "\n\n[...]\n\n" + pdfText.substring(pdfText.length - 3000)
        : pdfText;
    const filenameHint = filename ? `\nNom du fichier: ${filename}` : "";

    const prompt = `Tu es un expert en extraction de données de factures françaises. Analyse ce texte extrait d'un PDF de facture et extrais les informations suivantes.

RÈGLES CRITIQUES:
- Le FOURNISSEUR est l'ÉMETTEUR de la facture (l'entreprise qui envoie la facture), PAS le client/destinataire. Le client est généralement "SUGU VALENTINE".
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
- La "category" doit être une des valeurs suivantes: "alimentaire", "boissons", "emballages", "entretien", "comptabilite", "assurances", "vehicules", "plateformes", "materiels", "eau", "energie", "telecom", "travaux", "autre". Règles de détection par fournisseur:
  - ELIS → "entretien" (linge/blanchisserie)
  - SEMM, Eau de Marseille → "eau"
  - EDF, ENGIE, Enedis, GRDF → "energie"
  - Deliveroo, Uber Eats, Just Eat, Glovo, Zenorder, EatOffice → "plateformes"
  - Metro, Zouaghi, Promocash, Transgourmet, Pomona → "alimentaire"
  - AXA, Allianz, MAIF, MACIF, Groupama → "assurances"
  - Orange, SFR, Bouygues Telecom, Free → "telecom"
  - Saur, Veolia, Suez, SEMM, Eau de Marseille, Lyonnaise des Eaux → "eau"
${knowledgeHints || ""}${filenameHint}

TEXTE DU PDF:
${truncatedText}

Réponds UNIQUEMENT avec un JSON valide (pas de markdown, pas de \`\`\`):
{
  "supplier": "nom du fournisseur émetteur (pas SUGU VALENTINE)",
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
  "category": "alimentaire|boissons|emballages|entretien|comptabilite|assurances|vehicules|plateformes|materiels|eau|energie|autre"
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

    const result: Partial<ParsedDocumentData> = {};
    if (parsed.supplier && typeof parsed.supplier === "string" && parsed.supplier.length > 1) {
        const sup = parsed.supplier.trim();
        if (!sup.toLowerCase().includes("sugu") && sup.length <= 80) {
            result.supplier = sup;
        }
    }
    if (typeof parsed.amount === "number" && parsed.amount !== 0) result.amount = Math.round(parsed.amount * 100) / 100;
    if (typeof parsed.taxAmount === "number" && parsed.taxAmount !== 0) {
        const tax = Math.round(parsed.taxAmount * 100) / 100;
        if (result.amount && Math.abs(tax) > Math.abs(result.amount)) {
            console.log(`[SUGU] AI taxAmount (${tax}) > amount (${result.amount}) — likely wrong extraction, setting to 0`);
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

    return result;
}

async function parseDocumentWithGPT4oVision(pdfBuffer: Buffer, filename?: string, knowledgeHints?: string): Promise<Partial<ParsedDocumentData> | null> {
    try {
        const { default: OpenAI } = await import("openai");
        const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
        if (!apiKey) {
            console.warn("[SUGU] GPT-4o vision: no OpenAI API key available, skipping");
            return null;
        }
        const openai = new OpenAI({
            apiKey,
            baseURL: process.env.AI_INTEGRATIONS_OPENAI_API_KEY ? process.env.AI_INTEGRATIONS_OPENAI_BASE_URL : undefined,
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
${knowledgeHints || ""}${filenameHint}

Réponds UNIQUEMENT avec un objet JSON valide (sans markdown ni \`\`\`):
{"supplier":"nom exact du fournisseur","amount":0.00,"taxAmount":0.00,"date":"YYYY-MM-DD","dueDate":"YYYY-MM-DD ou null","invoiceNumber":"numéro","paymentMethod":null,"siret":null,"tvaNumber":null,"address":null,"city":null,"postalCode":null,"phone":null,"email":null,"iban":null,"category":"catégorie"}`;

        const detectedMime = detectBufferMimeType(pdfBuffer, filename);
        const isImage = detectedMime.startsWith("image/");
        const base64Data = pdfBuffer.toString("base64");
        const messageParts: any[] = isImage
            ? [
                { type: "image_url", image_url: { url: `data:${detectedMime};base64,${base64Data}`, detail: "high" } },
                { type: "text", text: prompt },
              ]
            : [
                { type: "file" as any, file: { filename: filename || "document.pdf", file_data: `data:application/pdf;base64,${base64Data}` } } as any,
                { type: "text", text: prompt },
              ];
        console.log(`[SUGU] GPT-4o vision: sending as ${isImage ? detectedMime + " image" : "PDF"} (${pdfBuffer.length} bytes)`);
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{
                role: "user",
                content: messageParts,
            }],
            temperature: 0,
            max_tokens: 1024,
        });

        const responseText = response.choices?.[0]?.message?.content || "";
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;

        const parsed = JSON.parse(jsonMatch[0]);
        const result: Partial<ParsedDocumentData> = {};
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
        console.log(`[SUGU] GPT-4o vision: supplier=${result.supplier}, amount=${result.amount}, category=${result.category}`);
        return result;
    } catch (err: any) {
        console.error("[SUGU] GPT-4o vision failed:", err?.message);
        return null;
    }
}

async function parseDocumentWithAIVision(pdfBuffer: Buffer, filename?: string, knowledgeHints?: string): Promise<Partial<ParsedDocumentData> | null> {
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
${knowledgeHints || ""}${filenameHint}

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

    const detectedMimeGemini = detectBufferMimeType(pdfBuffer, filename);
    const base64Pdf = pdfBuffer.toString("base64");
    console.log(`[SUGU] Gemini vision: sending as ${detectedMimeGemini} (${pdfBuffer.length} bytes)`);
    const response = await gemini.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
            {
                role: "user",
                parts: [
                    { inlineData: { mimeType: detectedMimeGemini as any, data: base64Pdf } },
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
    const result: Partial<ParsedDocumentData> = {};
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
    console.log(`[SUGU] PDF Vision extraction: supplier=${result.supplier}, amount=${result.amount}, category=${result.category}`);
    return result;
}

function splitTextByInvoices(fullText: string): string[] {
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

async function parseMultiInvoicePDF(buffer: Buffer, filename?: string): Promise<ParsedDocumentData[]> {
    try {
        let text = "";
        try {
            const pdfParseTimeout = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("pdf-parse timeout (10s)")), 10000)
            );
            const parsePdf = await getPdfParse();
            const pdfData = await Promise.race([parsePdf(buffer), pdfParseTimeout]);
            text = pdfData.text || "";
        } catch (pdfErr: any) {
            console.warn(`[SUGU] pdf-parse text extraction failed in multi-invoice (${pdfErr?.message}), using Gemini vision fallback`);
        }

        if (text.length >= 50) {
            const chunks = splitTextByInvoices(text);
            console.log(`[SUGU] Multi-invoice detection: ${chunks.length} invoice(s) found in ${filename || 'unknown'} (${text.length} chars)`);

            if (chunks.length <= 1) {
                const single = await parseDocumentPDF(buffer, filename);
                return (single.supplier || (single.amount && single.amount > 0)) ? [single] : [];
            }

            const batchResult = await parseMultiInvoiceWithAI(text, chunks.length, filename);
            if (batchResult && batchResult.length > 0) {
                console.log(`[SUGU] AI batch extracted ${batchResult.length} invoices`);
                return batchResult;
            }

            const results: ParsedDocumentData[] = [];
            for (let i = 0; i < chunks.length; i++) {
                try {
                    const aiResult = await parseDocumentWithAI(chunks[i], `${filename}_invoice_${i + 1}`);
                    if (aiResult && (aiResult.supplier || (typeof aiResult.amount === "number" && aiResult.amount > 0))) {
                        const entry: ParsedDocumentData = {
                            supplier: aiResult.supplier || null,
                            amount: typeof aiResult.amount === "number" ? aiResult.amount : null,
                            taxAmount: typeof aiResult.taxAmount === "number" ? aiResult.taxAmount : null,
                            date: aiResult.date || null,
                            dueDate: aiResult.dueDate || null,
                            invoiceNumber: aiResult.invoiceNumber || null,
                            paymentMethod: aiResult.paymentMethod || null,
                            category: aiResult.category || null,
                            siret: aiResult.siret || null,
                            tvaNumber: aiResult.tvaNumber || null,
                            address: aiResult.address || null,
                            city: aiResult.city || null,
                            postalCode: aiResult.postalCode || null,
                            phone: aiResult.phone || null,
                            email: aiResult.email || null,
                            iban: aiResult.iban || null,
                        };
                        results.push(entry);
                    }
                } catch (err: any) {
                    console.error(`[SUGU] Failed to parse invoice chunk ${i + 1}:`, err?.message);
                }
            }
            return results;
        }

        console.log(`[SUGU] No text extracted from PDF — using vision-based single parse for ${filename || 'unknown'}`);
        const single = await parseDocumentPDF(buffer, filename);
        return (single.supplier || (single.amount && single.amount > 0)) ? [single] : [];
    } catch (err: any) {
        console.error(`[SUGU] Multi-invoice parse failed:`, err?.message);
        return [];
    }
}

async function parseMultiInvoiceWithAI(fullText: string, expectedCount: number, filename?: string): Promise<ParsedDocumentData[] | null> {
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
            // Attempt to repair truncated JSON by extracting complete invoice objects with regex
            console.log(`[SUGU] JSON malformed, attempting repair...`);
            const invoiceObjectRegex = /\{[^{}]*"invoiceNumber"[^{}]*\}/g;
            const individualMatches = responseText.match(invoiceObjectRegex) || [];
            if (individualMatches.length > 0) {
                parsed = { invoices: individualMatches.map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean) };
                console.log(`[SUGU] JSON repair: recovered ${parsed.invoices.length} invoice objects via regex`);
            } else {
                // Last resort: truncate JSON at last complete object
                const truncatedJson = jsonMatch[0].replace(/,\s*\{[^}]*$/, ']}}');
                try {
                    parsed = JSON.parse(truncatedJson);
                    console.log(`[SUGU] JSON repair: truncated to last complete object`);
                } catch {
                    console.error(`[SUGU] JSON repair failed, giving up`);
                    return null;
                }
            }
        }
        if (!parsed.invoices || !Array.isArray(parsed.invoices) || parsed.invoices.length === 0) return null;

        const results: ParsedDocumentData[] = [];
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

        console.log(`[SUGU] AI multi-invoice: extracted ${results.length} valid invoices from ${parsed.invoices.length} total`);
        return results.length > 0 ? results : null;
    } catch (err: any) {
        console.error(`[SUGU] AI multi-invoice extraction failed:`, err?.message);
        return null;
    }
}

// Backfill is intentionally NOT auto-run at startup.
// It can be triggered manually via POST /api/v2/suguval/admin/run-backfill

// GET /files — list all uploaded files (archives)
router.get("/files", async (req: Request, res: Response) => {
    try {
        const { category, search, sort, employeeId } = req.query;
        const conditions: any[] = [];
        if (category && typeof category === "string") {
            conditions.push(eq(suguFiles.category, category));
        }
        if (search && typeof search === "string") {
            conditions.push(ilike(suguFiles.originalName, `%${search}%`));
        }
        if (employeeId && typeof employeeId === "string") {
            conditions.push(eq(suguFiles.employeeId, parseInt(employeeId)));
        }

        const data = conditions.length > 0
            ? await db.select().from(suguFiles).where(and(...conditions)).orderBy(desc(suguFiles.createdAt))
            : await db.select().from(suguFiles).orderBy(desc(suguFiles.createdAt));
        res.json(data);
    } catch (error) {
        console.error("[SUGU] Error fetching files:", error);
        res.status(500).json({ error: "Failed to fetch files" });
    }
});

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
        let parsed: Partial<ParsedDocumentData> | null = null;
        try {
            parsed = await parseDocumentPDF(pdfBuffer, file.originalname, "val");
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
        const existingPurchases = await db.select({ id: suguPurchases.id, supplier: suguPurchases.supplier, amount: suguPurchases.amount, invoiceDate: suguPurchases.invoiceDate })
            .from(suguPurchases)
            .limit(500);
        const possibleDuplicates = existingPurchases.filter(p => {
            const sameSupplier = p.supplier.toLowerCase().trim() === (parsed!.supplier || "").toLowerCase().trim();
            const closeAmount = parsed!.amount && Math.abs(p.amount - parsed!.amount) / Math.max(p.amount, 1) < 0.05;
            return sameSupplier && closeAmount;
        });
        const existingSuppliers = await db.select({ id: suguSuppliers.id, name: suguSuppliers.name }).from(suguSuppliers).limit(200);
        const matchedSupplier = existingSuppliers.find(s =>
            s.name.toLowerCase().includes((parsed!.supplier || "").toLowerCase()) ||
            (parsed!.supplier || "").toLowerCase().includes(s.name.toLowerCase())
        );
        res.json({
            success: true,
            parsed,
            confidence,
            possibleDuplicates: possibleDuplicates.slice(0, 3),
            matchedSupplier: matchedSupplier || null,
        });
    } catch (err: any) {
        console.error("[ParsePreview] Error:", err?.message);
        res.status(500).json({ error: "Erreur parsing preview", detail: err?.message });
    }
});

// POST /files — upload a file or photo
router.post("/files", hybridUpload({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }), async (req: Request, res: Response) => {
    try {
        const file = (req as any).file;
        if (!file) {
            return res.status(400).json({ error: "No file provided" });
        }

        const { category, fileType, supplier, description, fileDate, amount: formAmount, parsedJson, employeeId } = req.body;
        let previewParsed: ParsedDocumentData | null = null;
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
                const dupes = await db.select({ originalName: suguFiles.originalName })
                    .from(suguFiles)
                    .where(sql`${suguFiles.originalName} LIKE ${baseName + '%'} AND ${suguFiles.category} = ${category}`);
                if (dupes.length > 0) {
                    candidateName = `${baseName}_${dupes.length + 1}${ext}`;
                }
                console.log(`[SUGU] Auto-rename: "${file.originalname}" → "${candidateName}"`);
                file.originalname = candidateName;
            }
        }

        // Rename generic camera filenames (image.jpg, photo.jpg, img.jpg...) to avoid duplicate collisions
        const genericCameraNames = /^(image|photo|img|capture|scan|document|facture|invoice|pic|picture|dsc|screenshot)\d*\.(jpe?g|png|heic|webp)$/i;
        if (genericCameraNames.test(file.originalname)) {
            const ext = file.originalname.substring(file.originalname.lastIndexOf("."));
            const base = file.originalname.substring(0, file.originalname.lastIndexOf("."));
            file.originalname = `${base}_${timestamp}${ext}`;
        }

        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storedName = `${timestamp}-${safeName}`;
        const pdfBuffer = Buffer.from(file.buffer);
        const objectPath = await uploadToObjectStorage(file.buffer, storedName, file.mimetype);

        const [result] = await db.insert(suguFiles).values({
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

        console.log(`[SUGU] File uploaded: ${file.originalname} → ${category} (${(file.size / 1024).toFixed(0)} KB)`);

        // Auto-create an expense entry when uploading a frais_generaux document
        if (category === "frais_generaux") {
            try {
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
                        console.log(`[SUGU] Date sanity check failed: AI date "${resolvedDate}" out of range, using form date "${formDateStr}"`);
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
                    const [expense] = await db.insert(suguExpenses).values({
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
                    console.log(`[SUGU] Expense #${expense.id} from preview-parsed data: ${resolvedSupplier} ${resolvedAmount}€ TVA=${resolvedTaxAmount} N°${resolvedInvoice || "—"} date=${resolvedDate}`);
                    res.json({ ...result, linkedExpenseId: expense.id, parsedData: p });
                    emitSuguFilesUpdated();
                    emitSuguExpensesUpdated();
                    return;
                }

                // Step 1: Create expense entry immediately from form data (no PDF parsing — avoids GCE EIO hang)
                const resolvedSupplierInitial = String(supplier || file.originalname.replace(/\.[^.]+$/, "") || "Non spécifié");
                const userAmount = formAmount ? parseFloat(formAmount) : 0;
                const filenameAmount = extractAmountFromFilename(file.originalname);
                const resolvedAmountInitial = userAmount > 0 ? userAmount : (filenameAmount > 0 ? filenameAmount : 0);
                const resolvedDateInitial = fileDate ? String(fileDate) : new Date().toISOString().substring(0, 10);
                const noteParts: string[] = [`Document: ${file.originalname}`];
                if (description) noteParts.push(String(description));

                const expenseValuesInitial = {
                    label: resolvedSupplierInitial,
                    supplierId: null as number | null,
                    category: "autre",
                    description: String(description || `Facture ${resolvedSupplierInitial} - ${resolvedDateInitial}`),
                    amount: resolvedAmountInitial,
                    taxAmount: 0,
                    period: resolvedDateInitial.substring(0, 7),
                    dueDate: resolvedDateInitial,
                    isPaid: resolvedAmountInitial > 0,
                    paymentMethod: null as string | null,
                    isRecurring: false,
                    notes: noteParts.join(" | "),
                };

                const [expense] = await db.insert(suguExpenses).values(expenseValuesInitial).returning();
                console.log(`[SUGU] Auto-created expense #${expense.id} (form data): ${resolvedSupplierInitial} = ${resolvedAmountInitial}€`);

                // Step 2: Respond immediately — don't wait for PDF parsing
                res.json({ ...result, linkedExpenseId: expense.id, parsedData: null, parsePending: true });
                emitSuguFilesUpdated();
                emitSuguExpensesUpdated();

                // Step 3: Parse in background and update expense with AI-extracted data
                const isParseableFile = (file.mimetype === "application/pdf" || file.mimetype.startsWith("image/")) && pdfBuffer.length > 0;
                if (isParseableFile) {
                    setImmediate(async () => {
                        try {
                            const timeout = file.mimetype === "application/pdf" ? 90000 : 60000;
                            const parseTimeout = new Promise<ParsedDocumentData>((_, reject) =>
                                setTimeout(() => reject(new Error(`Parse timeout (${timeout / 1000}s)`)), timeout)
                            );
                            const parsed = await Promise.race([
                                parseDocumentPDF(pdfBuffer, file.originalname),
                                parseTimeout,
                            ]);
                            console.log(`[SUGU] Background parse complete for expense #${expense.id} (${file.mimetype}):`, JSON.stringify(parsed));

                            const betterSupplier = parsed.supplier || resolvedSupplierInitial;
                            const betterAmount = (typeof parsed.amount === "number" && parsed.amount !== 0) ? parsed.amount : resolvedAmountInitial;
                            let betterDate = parsed.date || resolvedDateInitial;
                            const bgParsedMs = new Date(betterDate).getTime();
                            const bg18mo = Date.now() - 18 * 30 * 24 * 60 * 60 * 1000;
                            const bg6moAhead = Date.now() + 6 * 30 * 24 * 60 * 60 * 1000;
                            if (isNaN(bgParsedMs) || bgParsedMs < bg18mo || bgParsedMs > bg6moAhead) {
                                console.log(`[SUGU] Background parse date sanity check failed: "${betterDate}" out of range, keeping "${resolvedDateInitial}"`);
                                betterDate = resolvedDateInitial;
                            }
                            const betterTax = typeof parsed.taxAmount === "number" && parsed.taxAmount >= 0 ? parsed.taxAmount : 0;
                            const betterCategory = parsed.category || "autre";
                            const betterPayment = parsed.paymentMethod || null;
                            const betterInvoice = parsed.invoiceNumber || null;
                            const supplierId = await findOrCreateSupplier(parsed, betterSupplier);

                            const updatedNotes: string[] = [];
                            if (betterInvoice) updatedNotes.push(`Facture: ${betterInvoice}`);
                            if (betterPayment) updatedNotes.push(`Paiement: ${betterPayment}`);
                            updatedNotes.push(`Document: ${file.originalname}`);
                            if (description) updatedNotes.push(String(description));

                            await db.update(suguExpenses).set({
                                label: betterSupplier,
                                supplierId,
                                category: betterCategory,
                                amount: betterAmount,
                                taxAmount: betterTax,
                                period: betterDate.substring(0, 7),
                                dueDate: betterDate,
                                isPaid: betterAmount > 0,
                                paymentMethod: betterPayment,
                                invoiceNumber: betterInvoice,
                                notes: updatedNotes.join(" | "),
                            }).where(eq(suguExpenses.id, expense.id));
                            console.log(`[SUGU] Expense #${expense.id} updated from ${file.mimetype.startsWith("image/") ? "vision AI" : "PDF"}: ${betterSupplier} = ${betterAmount}€ TVA=${betterTax} N°${betterInvoice || "—"}`);
                            emitSuguExpensesUpdated();
                        } catch (bgErr: any) {
                            console.error(`[SUGU] Background parse failed for expense #${expense.id}:`, bgErr?.message);
                        }
                    });
                }
                return;
            } catch (expErr: any) {
                console.error("[SUGU] Failed to auto-create expense from upload:", expErr?.message || expErr, expErr?.stack);
                res.json({ ...result, autoCreateError: expErr?.message || "Erreur lors de la création automatique du frais" });
                emitSuguFilesUpdated();
                return;
            }
        }

        // Auto-create purchase entries when uploading an achats document (supports multi-invoice PDFs)
        if (category === "achats") {
            try {
                const createdPurchases: any[] = [];

                // If frontend already parsed this file (via parse-preview), use that data directly
                if (previewParsed && (previewParsed.supplier || (typeof previewParsed.amount === "number" && previewParsed.amount > 0))) {
                    const p = previewParsed;
                    const resolvedSupplier = p.supplier || supplier || extractSupplierFromFilename(file.originalname) || file.originalname.replace(/\.[^.]+$/, "");
                    const userAmount = formAmount ? parseFloat(formAmount) : 0;
                    const resolvedAmount = userAmount > 0 ? userAmount : (typeof p.amount === "number" && p.amount > 0 ? p.amount : extractAmountFromFilename(file.originalname));
                    const todayStr = new Date().toISOString().substring(0, 10);
                    const formDateStr = fileDate ? String(fileDate) : todayStr;
                    let resolvedDate = p.date || formDateStr;
                    const parsedDateMs = new Date(resolvedDate).getTime();
                    const eighteenMonthsAgo = Date.now() - 18 * 30 * 24 * 60 * 60 * 1000;
                    const sixMonthsAhead = Date.now() + 6 * 30 * 24 * 60 * 60 * 1000;
                    if (isNaN(parsedDateMs) || parsedDateMs < eighteenMonthsAgo || parsedDateMs > sixMonthsAhead) {
                        console.log(`[SUGU] Date sanity check failed: AI date "${resolvedDate}" out of range, using form date "${formDateStr}"`);
                        resolvedDate = formDateStr;
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
                    const [purchase] = await db.insert(suguPurchases).values({
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
                    console.log(`[SUGU] Purchase #${purchase.id} from preview-parsed data: ${resolvedSupplier} ${resolvedAmount}€ TVA=${resolvedTaxAmount} N°${resolvedInvoice || "—"} date=${resolvedDate}`);
                    res.json({ ...result, linkedPurchaseId: purchase.id, parsedData: p, supplierId });
                    emitSuguFilesUpdated();
                    emitSuguPurchasesUpdated();
                    return;
                }

                if (file.mimetype === "application/pdf" && pdfBuffer.length > 0) {
                    try {
                        const parseTimeout = new Promise<ParsedDocumentData[]>((_, reject) =>
                            setTimeout(() => reject(new Error("PDF parse timeout (45s)")), 45000)
                        );
                        const multiParsed = await Promise.race([
                            parseMultiInvoicePDF(pdfBuffer, file.originalname),
                            parseTimeout,
                        ]);
                        console.log(`[SUGU] Multi-invoice result: ${multiParsed.length} invoice(s) from ${file.originalname}`);

                        if (multiParsed.length > 1) {
                            for (let i = 0; i < multiParsed.length; i++) {
                                const parsed = multiParsed[i];
                                const resolvedSupplier = parsed.supplier || supplier || file.originalname.replace(/\.[^.]+$/, "");
                                const resolvedAmount = (typeof parsed.amount === "number" && parsed.amount > 0) ? parsed.amount : 0;
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

                                const [purchase] = await db.insert(suguPurchases).values({
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
                                console.log(`[SUGU] Multi-invoice: created purchase #${purchase.id} (${i + 1}/${multiParsed.length}): ${resolvedSupplier} = ${resolvedAmount}€`);
                            }
                            res.json({
                                ...result,
                                multiInvoice: true,
                                invoiceCount: multiParsed.length,
                                linkedPurchaseIds: createdPurchases.map(p => p.id),
                                parsedInvoices: multiParsed,
                            });
                            emitSuguFilesUpdated();
                            emitSuguPurchasesUpdated();
                            return;
                        }

                        if (multiParsed.length === 1) {
                            const parsed = multiParsed[0];
                            const filenameSupplier = extractSupplierFromFilename(file.originalname);
                            const resolvedSupplier = parsed.supplier || supplier || filenameSupplier || file.originalname.replace(/\.[^.]+$/, "");
                            const userAmount = formAmount ? parseFloat(formAmount) : 0;
                            const filenameAmount = extractAmountFromFilename(file.originalname);
                            const pdfAmount = (typeof parsed.amount === "number" && parsed.amount > 0) ? parsed.amount : 0;
                            const resolvedAmount = userAmount > 0 ? userAmount
                                : (pdfAmount > 0 ? pdfAmount
                                    : (filenameAmount > 0 ? filenameAmount : 0));
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

                            const [purchase] = await db.insert(suguPurchases).values({
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
                            console.log(`[SUGU] Auto-created purchase #${purchase.id} from PDF: ${resolvedSupplier} = ${resolvedAmount}€`);
                            res.json({ ...result, linkedPurchaseId: purchase.id, parsedData: parsed, supplierId });
                            emitSuguFilesUpdated();
                            emitSuguPurchasesUpdated();
                            return;
                        }
                    } catch (parseErr) {
                        console.error("[SUGU] Multi-invoice PDF parse failed (falling back to single):", parseErr);
                    }
                }

                // Handle image files (JPG/PNG) with vision AI — same as parse-preview
                if (file.mimetype.startsWith("image/") && pdfBuffer.length > 0) {
                    try {
                        console.log(`[SUGU] Image upload detected (${file.mimetype}), running vision AI for achats...`);
                        const parseTimeout = new Promise<ParsedDocumentData>((_, reject) =>
                            setTimeout(() => reject(new Error("Image parse timeout (60s)")), 60000)
                        );
                        const parsed = await Promise.race([
                            parseDocumentPDF(pdfBuffer, file.originalname, "val"),
                            parseTimeout,
                        ]);
                        if (parsed && (parsed.supplier || parsed.amount)) {
                            const filenameSupplier = extractSupplierFromFilename(file.originalname);
                            const userAmount = formAmount ? parseFloat(formAmount) : 0;
                            const resolvedSupplier = parsed.supplier || supplier || filenameSupplier || file.originalname.replace(/\.[^.]+$/, "");
                            const resolvedAmount = userAmount > 0 ? userAmount : ((typeof parsed.amount === "number" && parsed.amount > 0) ? parsed.amount : 0);
                            const resolvedDate = parsed.date || (fileDate ? String(fileDate) : new Date().toISOString().substring(0, 10));
                            const resolvedTax = typeof parsed.taxAmount === "number" && parsed.taxAmount >= 0 ? parsed.taxAmount : 0;
                            const resolvedInvoice = parsed.invoiceNumber || null;
                            const resolvedPayment = parsed.paymentMethod || null;
                            const resolvedCategory = parsed.category || "alimentaire";
                            const supplierId = await findOrCreateSupplier(parsed, resolvedSupplier);
                            const noteParts: string[] = [];
                            if (resolvedInvoice) noteParts.push(`Facture: ${resolvedInvoice}`);
                            if (resolvedPayment) noteParts.push(`Paiement: ${resolvedPayment}`);
                            noteParts.push(`Photo: ${file.originalname}`);
                            if (description) noteParts.push(String(description));
                            const [purchase] = await db.insert(suguPurchases).values({
                                supplier: resolvedSupplier,
                                supplierId,
                                description: description || `Photo facture: ${resolvedSupplier} - ${resolvedDate}`,
                                category: resolvedCategory,
                                amount: resolvedAmount,
                                taxAmount: resolvedTax,
                                invoiceNumber: resolvedInvoice,
                                invoiceDate: resolvedDate,
                                isPaid: resolvedAmount > 0,
                                paymentMethod: resolvedPayment,
                                notes: noteParts.join(" | "),
                            }).returning();
                            console.log(`[SUGU] Vision AI purchase #${purchase.id} from image: ${resolvedSupplier} = ${resolvedAmount}€ (${resolvedCategory})`);
                            res.json({ ...result, linkedPurchaseId: purchase.id, parsedData: parsed, supplierId });
                            emitSuguFilesUpdated();
                            emitSuguPurchasesUpdated();
                            return;
                        }
                        console.log(`[SUGU] Vision AI returned no supplier/amount for image, using fallback`);
                    } catch (imgErr: any) {
                        console.error("[SUGU] Image vision AI failed:", imgErr?.message);
                    }
                }

                const filenameSupplier = extractSupplierFromFilename(file.originalname);
                const resolvedSupplier = supplier || filenameSupplier || file.originalname.replace(/\.[^.]+$/, "");
                const userAmount = formAmount ? parseFloat(formAmount) : 0;
                const filenameAmount = extractAmountFromFilename(file.originalname);
                const resolvedAmount = userAmount > 0 ? userAmount : (filenameAmount > 0 ? filenameAmount : 0);
                const resolvedDate = fileDate ? String(fileDate) : new Date().toISOString().substring(0, 10);
                const [purchase] = await db.insert(suguPurchases).values({
                    supplier: resolvedSupplier,
                    description: description || `Document: ${file.originalname}`,
                    category: "autre",
                    amount: resolvedAmount,
                    taxAmount: 0,
                    invoiceNumber: null,
                    invoiceDate: resolvedDate,
                    isPaid: resolvedAmount > 0,
                    notes: `Document: ${file.originalname}`,
                }).returning();
                console.log(`[SUGU] Fallback purchase #${purchase.id}: ${resolvedSupplier} = ${resolvedAmount}€`);
                res.json({ ...result, linkedPurchaseId: purchase.id });
                emitSuguFilesUpdated();
                emitSuguPurchasesUpdated();
                return;
            } catch (purchErr) {
                console.error("[SUGU] Failed to auto-create purchase from upload:", purchErr);
            }
        }

        // Auto-parse bank statement PDFs uploaded in banque category
        if (category === "banque" && file.mimetype === "application/pdf" && pdfBuffer.length > 0) {
            try {
                const bankResult = await parseBankStatementPDF(pdfBuffer);
                if (bankResult.success && bankResult.entries.length > 0) {
                    console.log(`[SUGU] Bank PDF parsed: ${bankResult.entries.length} entries found (${bankResult.periodStart} → ${bankResult.periodEnd})`);

                    const existingEntries = await db.select()
                        .from(suguBankEntries)
                        .where(
                            and(
                                gte(suguBankEntries.entryDate, bankResult.periodStart),
                                lte(suguBankEntries.entryDate, bankResult.periodEnd)
                            )
                        );

                    const existingSet = new Set(
                        existingEntries.map((e: any) => `${e.entryDate}|${e.amount}|${e.label?.substring(0, 30)}`)
                    );
                    const newEntries = bankResult.entries.filter(e =>
                        !existingSet.has(`${e.entryDate}|${e.amount}|${e.label.substring(0, 30)}`)
                    );

                    if (newEntries.length > 0) {
                        const inserted = await db.insert(suguBankEntries).values(
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
                        console.log(`[SUGU] Auto-imported ${inserted.length} bank entries from upload (${bankResult.entries.length - newEntries.length} skipped as duplicates)`);
                        res.json({ ...result, bankImport: { imported: inserted.length, skipped: bankResult.entries.length - newEntries.length, period: `${bankResult.periodStart} → ${bankResult.periodEnd}` } });
                        emitSuguFilesUpdated();
                        emitSuguBankUpdated();
                        return;
                    } else {
                        console.log(`[SUGU] Bank PDF: all ${bankResult.entries.length} entries already exist`);
                        res.json({ ...result, bankImport: { imported: 0, skipped: bankResult.entries.length, period: `${bankResult.periodStart} → ${bankResult.periodEnd}`, message: "Toutes les opérations existent déjà" } });
                        emitSuguFilesUpdated();
                        return;
                    }
                } else {
                    console.log(`[SUGU] Bank PDF parse: no entries found in ${file.originalname}`, bankResult.errors);
                }
            } catch (bankErr: any) {
                console.error("[SUGU] Failed to auto-parse bank PDF:", bankErr?.message || bankErr);
            }
        }

        // Auto-detect payroll PDFs uploaded in RH category and create employee + payroll
        if (category === "rh" && file.mimetype === "application/pdf" && pdfBuffer.length > 0 && !employeeId) {
            const fnLower = (file.originalname || "").toLowerCase();
            const isPayrollPDF = /\b(bs|bulletin|paie|salaire|fiche.de.paie)\b/.test(fnLower) || fileType === "bulletin_paie";
            if (isPayrollPDF) {
                try {
                    const payrollResult = await parsePayrollPDF(pdfBuffer, file.originalname);
                    if (payrollResult.success && payrollResult.data?.employee?.lastName) {
                        const parsed = payrollResult.data;
                        console.log(`[SUGU] RH file detected as payroll: ${file.originalname} → ${parsed.employee.firstName} ${parsed.employee.lastName}`);

                        const existingEmps = await db.select().from(suguEmployees);
                        const match = existingEmps.find(e =>
                            e.lastName.toLowerCase() === parsed.employee.lastName.toLowerCase() &&
                            e.firstName.toLowerCase() === (parsed.employee.firstName || "").toLowerCase()
                        );

                        let employeeId: number | null = null;
                        let employeeCreated = false;

                        if (match) {
                            employeeId = match.id;
                            console.log(`[SUGU] RH auto-link: existing employee ${match.firstName} ${match.lastName} (ID ${match.id})`);
                            const updates: any = {};
                            if (parsed.employee.role && parsed.employee.role !== "Non précisé" && (!match.role || match.role === "Non précisé")) updates.role = parsed.employee.role;
                            if (parsed.hourlyRate && !match.hourlyRate) updates.hourlyRate = parsed.hourlyRate;
                            if (parsed.employee.weeklyHours && !match.weeklyHours) updates.weeklyHours = parsed.employee.weeklyHours;
                            if (parsed.grossSalary && (!match.monthlySalary || match.monthlySalary === 0)) updates.monthlySalary = parsed.grossSalary;
                            if (Object.keys(updates).length > 0) {
                                await db.update(suguEmployees).set(updates).where(eq(suguEmployees.id, match.id));
                            }
                        } else {
                            const [newEmp] = await db.insert(suguEmployees).values({
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
                            console.log(`[SUGU] RH auto-created employee: ${newEmp.firstName} ${newEmp.lastName} (ID ${newEmp.id})`);
                            emitSuguEmployeesUpdated();
                        }

                        if (employeeId && parsed.period && parsed.grossSalary) {
                            const existingPayroll = await db.select().from(suguPayroll)
                                .where(and(
                                    eq(suguPayroll.employeeId, employeeId),
                                    eq(suguPayroll.period, parsed.period)
                                ));
                            if (existingPayroll.length === 0) {
                                await db.insert(suguPayroll).values({
                                    employeeId,
                                    period: parsed.period,
                                    grossSalary: parsed.grossSalary,
                                    netSalary: parsed.netSalary || 0,
                                    socialCharges: parsed.socialCharges || 0,
                                    employerCharges: parsed.employerCharges || null,
                                    totalEmployerCost: parsed.totalEmployerCost || null,
                                    bonus: parsed.bonus || 0,
                                    overtime: parsed.overtime || 0,
                                    isPaid: true,
                                    paidDate: parsed.paymentDate || null,
                                    pdfPath: result.id.toString(),
                                    notes: `Import auto (RH): ${file.originalname}`,
                                });
                                console.log(`[SUGU] RH auto-created payroll: ${parsed.period} for employee ${employeeId}`);
                                emitSuguPayrollUpdated();
                            }
                        }

                        await db.update(suguFiles).set({
                            fileType: "bulletin_paie",
                            description: `Bulletin de paie - ${parsed.employee.firstName || ""} ${parsed.employee.lastName} - ${parsed.period || ""}`.trim(),
                        }).where(eq(suguFiles.id, result.id));

                        res.json({ ...result, fileType: "bulletin_paie", autoDetected: true, employeeCreated, employeeId, parsed: payrollResult.data });
                        emitSuguFilesUpdated();
                        return;
                    }
                } catch (payrollErr) {
                    console.error("[SUGU] RH payroll auto-detect failed (continuing as regular file):", payrollErr);
                }
            }
        }

        res.json(result);
        emitSuguFilesUpdated();
    } catch (error) {
        console.error("[SUGU] Error uploading file:", error);
        res.status(500).json({ error: "Failed to upload file" });
    }
});

const CATEGORY_LABELS: Record<string, string> = {
    achats: "Achats / Factures fournisseurs",
    frais_generaux: "Frais généraux",
    banque: "Relevés bancaires",
    rh: "Ressources humaines",
    emprunt: "Emprunts / Financements",
};

// GET /files/:id/download — download a file
router.get("/files/:id/download", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const [file] = await db.select().from(suguFiles).where(eq(suguFiles.id, id));
        if (!file) {
            return res.status(404).json({ error: "File not found" });
        }

        const { buffer } = await downloadFromObjectStorage(file.storagePath);
        res.setHeader("Content-Type", file.mimeType);
        res.setHeader("Content-Disposition", `inline; filename="${file.originalName}"`);
        res.send(buffer);

    } catch (error) {
        console.error("[SUGU] Error downloading file:", error);
        res.status(500).json({ error: "Failed to download file" });
    }
});

// POST /files/send-email-bulk — send ONE email with multiple file attachments
router.post("/files/send-email-bulk", async (req: Request, res: Response) => {
    try {
        const { to, fileIds } = req.body;
        if (!to || typeof to !== "string" || !to.includes("@")) {
            return res.status(400).json({ error: "Adresse email destinataire invalide" });
        }
        if (!Array.isArray(fileIds) || fileIds.length === 0) {
            return res.status(400).json({ error: "Aucun fichier sélectionné" });
        }

        const files = await db.select().from(suguFiles).where(inArray(suguFiles.id, fileIds.map(Number)));
        if (files.length === 0) return res.status(404).json({ error: "Aucun fichier trouvé" });

        const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
        const fileDetails: string[] = [];
        for (const file of files) {
            const { buffer } = await downloadFromObjectStorage(file.storagePath);
            attachments.push({ filename: file.originalName, content: buffer, contentType: file.mimeType });
            const categoryLabel = CATEGORY_LABELS[file.category] || file.category;
            const parts = [`  • ${file.originalName} (${categoryLabel})`];
            if (file.supplier) parts[0] += ` — ${file.supplier}`;
            fileDetails.push(parts[0]);
        }

        const dateStr = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
        const subject = `[SUGU Valentine] ${files.length} document${files.length > 1 ? "s" : ""} — ${dateStr}`;
        const body = [
            `Bonjour,`,
            ``,
            `Veuillez trouver ci-joint ${files.length} document${files.length > 1 ? "s" : ""} depuis SUGU Valentine :`,
            ``,
            ...fileDetails,
            ``,
            `  • Envoyé le : ${dateStr}`,
            ``,
            `Cordialement,`,
            `SUGU Valentine`,
        ].join("\n");

        const { gmailImapService } = await import("../../services/gmailImapService");
        await gmailImapService.sendSmtp({ to, subject, body, attachments });

        for (const file of files) {
            await db.update(suguFiles)
                .set({ emailedTo: sql`array_append(coalesce(emailed_to, '{}'::text[]), ${to}::text)` })
                .where(eq(suguFiles.id, file.id));
        }

        console.log(`[SUGU] Bulk email: ${files.length} files sent to ${to} (${files.map(f => f.originalName).join(", ")})`);
        res.json({ success: true, message: `${files.length} fichier(s) envoyé(s) à ${to}`, count: files.length });
    } catch (error: any) {
        console.error("[SUGU] Error sending bulk email:", error);
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

        const [file] = await db.select().from(suguFiles).where(eq(suguFiles.id, id));
        if (!file) return res.status(404).json({ error: "Fichier introuvable" });

        const { buffer } = await downloadFromObjectStorage(file.storagePath);

        const categoryLabel = CATEGORY_LABELS[file.category] || file.category;
        const dateStr = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
        const subject = `[SUGU Valentine] ${file.originalName}`;
        const body = [
            `Bonjour,`,
            ``,
            `Veuillez trouver ci-joint le document suivant depuis SUGU Valentine :`,
            ``,
            `  • Fichier   : ${file.originalName}`,
            `  • Catégorie : ${categoryLabel}`,
            file.supplier ? `  • Fournisseur : ${file.supplier}` : null,
            file.fileDate ? `  • Date doc.  : ${file.fileDate}` : null,
            file.description ? `  • Description : ${file.description}` : null,
            `  • Envoyé le  : ${dateStr}`,
            ``,
            `Cordialement,`,
            `SUGU Valentine`,
        ].filter(Boolean).join("\n");

        const attachment = { filename: file.originalName, content: buffer, contentType: file.mimeType };

        const { gmailImapService } = await import("../../services/gmailImapService");
        await gmailImapService.sendSmtp({ to, subject, body, attachments: [attachment] });

        await db.update(suguFiles)
            .set({ emailedTo: sql`array_append(coalesce(emailed_to, '{}'::text[]), ${to}::text)` })
            .where(eq(suguFiles.id, id));

        console.log(`[SUGU] File ${file.originalName} sent by email to ${to}`);
        res.json({ success: true, message: `Fichier envoyé à ${to}` });
    } catch (error: any) {
        console.error("[SUGU] Error sending file by email:", error);
        res.status(500).json({ error: "Échec de l'envoi : " + error?.message });
    }
});

// DELETE /files/:id — soft-delete: move to trash (kept 7 days), file stays in storage
router.delete("/files/:id", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    try {
        const [file] = await db.select().from(suguFiles).where(eq(suguFiles.id, id));
        if (!file) return res.status(404).json({ error: "File not found" });

        const now = new Date();
        const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        await db.insert(suguTrash).values({
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

        await db.delete(suguFiles).where(eq(suguFiles.id, id));

        console.log(`[SUGU] File ${id} (${file.originalName}) moved to trash — expires ${expiresAt.toISOString()}`);
        emitSuguFilesUpdated();
        res.json({ success: true, expiresAt: expiresAt.toISOString() });
    } catch (error) {
        console.error(`[SUGU] Error moving file ${id} to trash:`, error);
        res.status(500).json({ error: "Failed to move file to trash" });
    }
});

// GET /trash — list trash files
router.get("/trash", async (_req: Request, res: Response) => {
    try {
        const items = await db.select().from(suguTrash).orderBy(desc(suguTrash.deletedAt));
        res.json(items);
    } catch (error) {
        console.error("[SUGU] Error listing trash:", error);
        res.status(500).json({ error: "Failed to list trash" });
    }
});

// POST /trash/:id/restore — restore a file from trash back to suguFiles
router.post("/trash/:id/restore", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    try {
        const [item] = await db.select().from(suguTrash).where(eq(suguTrash.id, id));
        if (!item) return res.status(404).json({ error: "Trash item not found" });

        if (new Date() > new Date(item.expiresAt)) {
            return res.status(410).json({ error: "Fichier expiré — suppression définitive déjà effectuée" });
        }

        await db.insert(suguFiles).values({
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

        await db.delete(suguTrash).where(eq(suguTrash.id, id));

        console.log(`[SUGU] Trash item ${id} (${item.originalName}) restored to files`);
        emitSuguFilesUpdated();
        res.json({ success: true });
    } catch (error) {
        console.error(`[SUGU] Error restoring trash item ${id}:`, error);
        res.status(500).json({ error: "Failed to restore file" });
    }
});

// DELETE /trash/:id — permanently delete a trash item (removes from storage too)
router.delete("/trash/:id", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    try {
        const [item] = await db.select().from(suguTrash).where(eq(suguTrash.id, id));
        if (!item) return res.status(404).json({ error: "Trash item not found" });

        try { await deleteFromObjectStorage(item.storagePath); } catch (e) { console.error(`[SUGU] Storage delete failed for trash ${id}:`, e); }
        await db.delete(suguTrash).where(eq(suguTrash.id, id));

        console.log(`[SUGU] Trash item ${id} (${item.originalName}) permanently deleted`);
        res.json({ success: true });
    } catch (error) {
        console.error(`[SUGU] Error permanently deleting trash item ${id}:`, error);
        res.status(500).json({ error: "Failed to permanently delete" });
    }
});

// Cleanup: permanently delete trash files older than 7 days (auto-purge)
async function purgeExpiredTrash() {
    try {
        const expired = await db.select().from(suguTrash).where(sql`expires_at < NOW()`);
        for (const item of expired) {
            try { await deleteFromObjectStorage(item.storagePath); } catch { /* ignore storage errors */ }
            await db.delete(suguTrash).where(eq(suguTrash.id, item.id));
        }
        if (expired.length > 0) console.log(`[SUGU] Auto-purged ${expired.length} expired trash file(s)`);
    } catch (err) {
        console.error("[SUGU] Error purging expired trash:", err);
    }
}
// Run 10s after startup (table must be ensured first) + schedule every hour
setTimeout(purgeExpiredTrash, 10_000);
setInterval(purgeExpiredTrash, 60 * 60 * 1000);

// ============ SUPPLIERS (Fournisseurs) ============

async function findOrCreateSupplier(parsed: ParsedDocumentData, fallbackName?: string): Promise<number | null> {
    const supplierName = parsed.supplier || fallbackName;
    if (!supplierName || supplierName.length < 2) return null;

    try {
        const nameNorm = supplierName.trim().toLowerCase();
        const existing = await db.select().from(suguSuppliers);
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
                await db.update(suguSuppliers).set(updates).where(eq(suguSuppliers.id, match.id));
                console.log(`[SUGU] Updated supplier #${match.id} (${match.name}): +1 invoice`);
            }
            return match.id;
        }

        const [created] = await db.insert(suguSuppliers).values({
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
        console.log(`[SUGU] Created new supplier #${created.id}: ${created.name}`);
        return created.id;
    } catch (err) {
        console.error("[SUGU] findOrCreateSupplier error:", err);
        return null;
    }
}

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

// ======== EXPERT ACCOUNTING REPORT (AI ANALYSIS) ========

router.post("/analytics/expert-report", suguFinancialLimiter, async (req: Request, res: Response) => {
    try {
        const { year, month, type = "annual" } = req.body;
        if (!year) return res.status(400).json({ error: "year is required" });

        console.log(`[SUGU-EXPERT] Generating ${type} report for ${month ? `${year}-${month}` : year}`);

        const periodFilter = month
            ? (col: string) => sql`SUBSTRING(${sql.raw(col)}, 1, 7) = ${`${year}-${month}`}`
            : (col: string) => sql`SUBSTRING(${sql.raw(col)}, 1, 4) = ${year}`;

        const [cashEntries, purchases, expenses, payrollData, bankEntries, loans, employees] = await Promise.all([
            db.select().from(suguCashRegister).where(periodFilter("entry_date")),
            db.select().from(suguPurchases).where(periodFilter("invoice_date")),
            db.select().from(suguExpenses).where(periodFilter("period")),
            db.select().from(suguPayroll).where(periodFilter("period")),
            db.select().from(suguBankEntries).where(periodFilter("entry_date")),
            db.select().from(suguLoans),
            db.select().from(suguEmployees),
        ]);

        const totalCA = cashEntries.reduce((s, e) => s + Number(e.totalRevenue || 0), 0);
        const totalAchats = purchases.reduce((s, p) => s + Number(p.amount || 0), 0);
        const totalFrais = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
        const totalSalaires = payrollData.reduce((s, p) => s + Number(p.grossSalary || 0), 0);
        const totalChargesSalariales = payrollData.reduce((s, p) => s + Number(p.socialCharges || 0), 0);
        const totalChargesPatronales = payrollData.reduce((s, p) => {
            if (p.employerCharges && Number(p.employerCharges) > 0) return s + Number(p.employerCharges);
            return s + Math.round(Number(p.grossSalary || 0) * 0.13 * 100) / 100;
        }, 0);
        const totalMasseSalariale = totalSalaires + totalChargesPatronales;
        const totalCredits = bankEntries.filter(b => Number(b.credit || 0) > 0).reduce((s, b) => s + Number(b.credit || 0), 0);
        const totalDebits = bankEntries.filter(b => Number(b.debit || 0) > 0).reduce((s, b) => s + Number(b.debit || 0), 0);
        const bankBalance = totalCredits - totalDebits;
        const resultat = totalCA - totalAchats - totalFrais - totalMasseSalariale;
        const marge = totalCA > 0 ? ((resultat / totalCA) * 100).toFixed(1) : "0.0";
        const ratioAchats = totalCA > 0 ? ((totalAchats / totalCA) * 100).toFixed(1) : "0.0";
        const ratioFrais = totalCA > 0 ? ((totalFrais / totalCA) * 100).toFixed(1) : "0.0";
        const ratioMasseS = totalCA > 0 ? ((totalMasseSalariale / totalCA) * 100).toFixed(1) : "0.0";
        const joursOuverture = cashEntries.length;
        const caMoyenJour = joursOuverture > 0 ? (totalCA / joursOuverture).toFixed(2) : "0.00";
        const tvaColl = totalCA * 0.10;
        const tvaDed = [...purchases, ...expenses].reduce((s, i) => s + Number((i as any).taxAmount || 0), 0);
        const tvaSolde = tvaColl - tvaDed;

        const unpaidPurchases = purchases.filter(p => !p.isPaid).reduce((s, p) => s + Number(p.amount || 0), 0);
        const unpaidExpenses = expenses.filter(e => !e.isPaid).reduce((s, e) => s + Number(e.amount || 0), 0);
        const totalRemainingLoans = loans.reduce((s, l) => s + Number(l.remainingAmount || 0), 0);
        const monthlyLoanPayments = loans.reduce((s, l) => s + Number(l.monthlyPayment || 0), 0);
        const activeEmployees = employees.filter(e => e.isActive).length;

        const monthlyBreakdown: Record<string, any> = {};
        for (let m = 1; m <= 12; m++) {
            const ms = m.toString().padStart(2, "0");
            const prefix = `${year}-${ms}`;
            if (month && ms !== month) continue;
            const mCA = cashEntries.filter(e => e.entryDate.startsWith(prefix)).reduce((s, e) => s + Number(e.totalRevenue || 0), 0);
            const mAch = purchases.filter(p => p.invoiceDate?.startsWith(prefix)).reduce((s, p) => s + Number(p.amount || 0), 0);
            const mFr = expenses.filter(e => e.period?.startsWith(prefix)).reduce((s, e) => s + Number(e.amount || 0), 0);
            const mSal = payrollData.filter(p => p.period.startsWith(prefix)).reduce((s, p) => s + Number(p.grossSalary || 0) + Number(p.socialCharges || 0), 0);
            if (mCA > 0 || mAch > 0 || mFr > 0 || mSal > 0) {
                monthlyBreakdown[prefix] = { ca: mCA, achats: mAch, frais: mFr, masseSalariale: mSal, resultat: mCA - mAch - mFr - mSal };
            }
        }

        const periodLabel = month
            ? new Date(`${year}-${month}-01`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })
            : `Exercice ${year}`;

        const dataContext = `
DONNÉES FINANCIÈRES — SUGU Valentine (Restaurant, Marseille 13011)
Période: ${periodLabel}

CHIFFRE D'AFFAIRES: ${totalCA.toFixed(2)}€
- Jours d'ouverture: ${joursOuverture}
- CA moyen/jour: ${caMoyenJour}€

CHARGES:
- Achats fournisseurs: ${totalAchats.toFixed(2)}€ (${ratioAchats}% du CA)
- Frais généraux: ${totalFrais.toFixed(2)}€ (${ratioFrais}% du CA)
- Masse salariale brute: ${totalSalaires.toFixed(2)}€
- Charges salariales: ${totalChargesSalariales.toFixed(2)}€
- Charges patronales (estimées): ${totalChargesPatronales.toFixed(2)}€
- Masse salariale chargée: ${totalMasseSalariale.toFixed(2)}€ (${ratioMasseS}% du CA)

RÉSULTAT D'EXPLOITATION: ${resultat.toFixed(2)}€
MARGE OPÉRATIONNELLE: ${marge}%

TVA:
- TVA collectée (10%): ${tvaColl.toFixed(2)}€
- TVA déductible: ${tvaDed.toFixed(2)}€
- Solde TVA à reverser: ${tvaSolde.toFixed(2)}€

TRÉSORERIE BANCAIRE:
- Total crédits: ${totalCredits.toFixed(2)}€
- Total débits: ${totalDebits.toFixed(2)}€
- Solde bancaire estimé: ${bankBalance.toFixed(2)}€

ENGAGEMENTS:
- Impayés fournisseurs: ${unpaidPurchases.toFixed(2)}€
- Impayés frais généraux: ${unpaidExpenses.toFixed(2)}€
- Capital restant emprunts: ${totalRemainingLoans.toFixed(2)}€
- Mensualités emprunts: ${monthlyLoanPayments.toFixed(2)}€

EFFECTIFS: ${activeEmployees} salarié(s) actif(s)

VENTILATION MENSUELLE:
${Object.entries(monthlyBreakdown).map(([m, d]: [string, any]) => `${m}: CA=${d.ca.toFixed(0)}€ Achats=${d.achats.toFixed(0)}€ Frais=${d.frais.toFixed(0)}€ Masse Sal.=${d.masseSalariale.toFixed(0)}€ Résultat=${d.resultat.toFixed(0)}€`).join("\n")}
`;

        const OpenAI = (await import("openai")).default;
        const openai = new OpenAI({
            apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
            baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
        });

        const systemPrompt = `Tu es un expert-comptable français expérimenté, spécialisé dans la restauration à Marseille. Tu travailles pour le cabinet qui accompagne le restaurant SUGU Valentine (13011 Marseille).

Ton rôle est de produire une VRAIE analyse comptable professionnelle, comme un expert-comptable le ferait dans un cabinet à Marseille. Tu dois :
1. Analyser les données financières fournies avec rigueur
2. Identifier les points forts, les faiblesses et les risques
3. Comparer aux ratios sectoriels de la restauration traditionnelle en France
4. Formuler des recommandations concrètes et actionnables
5. Signaler toute anomalie ou incohérence dans les données

Ratios sectoriels de référence (restauration traditionnelle France) :
- Coût matière (achats/CA) : 25-35%
- Masse salariale chargée/CA : 30-45%
- Frais généraux/CA : 15-25%
- Marge opérationnelle : 5-15%
- Prime cost (matière + main d'œuvre) : 55-70%

Rédige en français professionnel. Utilise le format Markdown avec des titres, sous-titres, tableaux et listes. Sois précis dans les chiffres. Ne mentionne jamais que tu es une IA — tu es un expert-comptable.`;

        const userPrompt = `Produis ${type === "monthly" ? "une synthèse comptable mensuelle" : "un bilan comptable annuel"} professionnel pour la période suivante.

${dataContext}

Structure attendue :
${type === "monthly" ? `
## Synthèse Comptable — [Mois Année]
### 1. Activité du mois
### 2. Analyse des charges
### 3. Résultat et marge
### 4. TVA du mois
### 5. Points d'attention
### 6. Recommandations
` : `
## Bilan Comptable Annuel — Exercice [Année]
### 1. Synthèse de l'exercice
### 2. Évolution du chiffre d'affaires (analyse mensuelle)
### 3. Structure des coûts et ratios clés
### 4. Compte de résultat simplifié
### 5. Analyse de la trésorerie et engagements
### 6. Obligations fiscales (TVA)
### 7. Analyse des effectifs et masse salariale
### 8. Points de vigilance et risques identifiés
### 9. Recommandations stratégiques
### 10. Conclusion et perspectives
`}

Important : si les données sont insuffisantes ou incohérentes, signale-le clairement plutôt que d'inventer des chiffres.`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            temperature: 0.3,
            max_tokens: 4000,
        });

        const analysis = completion.choices[0]?.message?.content || "Analyse non disponible";

        console.log(`[SUGU-EXPERT] Report generated: ${analysis.length} chars`);

        res.json({
            success: true,
            period: periodLabel,
            type,
            analysis,
            data: {
                ca: totalCA, achats: totalAchats, frais: totalFrais,
                masseSalariale: totalMasseSalariale, resultat, marge,
                tvaColl, tvaDed, tvaSolde,
                bankBalance, unpaidPurchases, unpaidExpenses,
                totalRemainingLoans, activeEmployees, joursOuverture,
                monthlyBreakdown
            }
        });
    } catch (error: any) {
        console.error("[SUGU-EXPERT] Report generation error:", error);
        res.status(500).json({ error: "Erreur lors de la génération du rapport", detail: error?.message });
    }
});

router.post("/analytics/expert-report/download", suguFinancialLimiter, async (req: Request, res: Response) => {
    try {
        const { analysis, period, type } = req.body;
        if (!analysis) return res.status(400).json({ error: "analysis content required" });

        const title = type === "monthly"
            ? `Synthèse Comptable — ${period}`
            : `Bilan Comptable Annuel — ${period}`;

        const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
@page { margin: 2cm; size: A4; }
body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 40px; line-height: 1.7; color: #1a1a2e; font-size: 13px; }
.header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: white; padding: 30px; border-radius: 12px; margin-bottom: 30px; }
.header h1 { margin: 0 0 5px 0; font-size: 22px; }
.header .subtitle { opacity: 0.8; font-size: 13px; }
.header .logo { font-size: 28px; font-weight: bold; color: #f97316; }
h2 { color: #1a1a2e; border-bottom: 2px solid #f97316; padding-bottom: 8px; margin-top: 30px; font-size: 16px; }
h3 { color: #16213e; margin-top: 20px; font-size: 14px; }
table { border-collapse: collapse; width: 100%; margin: 15px 0; font-size: 12px; }
th { background: #1a1a2e; color: white; padding: 10px 12px; text-align: left; font-weight: 600; }
td { border: 1px solid #e2e8f0; padding: 8px 12px; }
tr:nth-child(even) { background: #f8fafc; }
strong { color: #1a1a2e; }
ul, ol { padding-left: 20px; }
li { margin-bottom: 4px; }
.footer { margin-top: 40px; padding-top: 15px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; }
@media print { body { padding: 20px; } .header { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<div class="header">
<div class="logo">S SUGU Valentine</div>
<h1>${title}</h1>
<div class="subtitle">Restaurant — 13011 Marseille | Généré le ${new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</div>
</div>
${markdownToHtmlBasic(analysis)}
<div class="footer">
Document généré par Ulysse — Système de gestion SUGU Valentine<br>
Ce document est une analyse automatisée. Il ne remplace pas l'avis d'un expert-comptable diplômé.
</div>
</body>
</html>`;

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(title.replace(/[^a-zA-ZÀ-ÿ0-9 _-]/g, ""))}.html"`);
        res.send(html);
    } catch (error: any) {
        console.error("[SUGU-EXPERT] Download error:", error);
        res.status(500).json({ error: "Erreur téléchargement" });
    }
});

router.post("/analytics/expert-report/email", suguFinancialLimiter, async (req: Request, res: Response) => {
    try {
        const { analysis, period, type, email } = req.body;
        if (!analysis || !email) return res.status(400).json({ error: "analysis and email required" });

        const title = type === "monthly"
            ? `Synthèse Comptable — ${period}`
            : `Bilan Comptable Annuel — ${period}`;

        const htmlContent = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><style>
body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:800px;margin:0 auto;padding:20px}
h1{color:#1a1a2e;border-bottom:2px solid #f97316;padding-bottom:8px}
h2{color:#16213e;margin-top:25px}h3{color:#334155}
table{border-collapse:collapse;width:100%;margin:10px 0}
th{background:#1a1a2e;color:#fff;padding:8px 10px;text-align:left}
td{border:1px solid #e2e8f0;padding:6px 10px}
tr:nth-child(even){background:#f8fafc}
</style></head><body>
<h1>🔶 ${title}</h1>
<p style="color:#64748b;font-size:13px">SUGU Valentine — 13011 Marseille | ${new Date().toLocaleDateString("fr-FR")}</p>
${markdownToHtmlBasic(analysis)}
<hr style="margin-top:30px;border:none;border-top:1px solid #e2e8f0">
<p style="font-size:11px;color:#94a3b8;text-align:center">Document généré par Ulysse — Système de gestion SUGU Valentine</p>
</body></html>`;

        const { gmailImapService } = await import("../../services/gmailImapService");
        await gmailImapService.sendSmtp({
            to: email,
            subject: `${title} — SUGU Valentine`,
            body: `Veuillez trouver ci-joint le rapport : ${title}.\n\nCordialement,\nUlysse — Gestion SUGU Valentine`,
            attachments: [{
                filename: `${title.replace(/[^a-zA-ZÀ-ÿ0-9 _-]/g, "")}.html`,
                content: Buffer.from(htmlContent, "utf-8"),
                contentType: "text/html"
            }]
        });

        console.log(`[SUGU-EXPERT] Report emailed to ${email}`);
        res.json({ success: true, message: `Rapport envoyé à ${email}` });
    } catch (error: any) {
        console.error("[SUGU-EXPERT] Email error:", error);
        res.status(500).json({ error: "Erreur envoi email", detail: error?.message });
    }
});

function markdownToHtmlBasic(md: string): string {
    return md
        .replace(/^### (.*$)/gm, '<h3>$1</h3>')
        .replace(/^## (.*$)/gm, '<h2>$1</h2>')
        .replace(/^# (.*$)/gm, '<h1>$1</h1>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/^\- (.*$)/gm, '<li>$1</li>')
        .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
        .replace(/\|(.+)\|/g, (match) => {
            const cells = match.split('|').filter(c => c.trim());
            if (cells.every(c => c.trim().match(/^[-:]+$/))) return '';
            const tag = cells.every(c => c.trim().match(/^[-:]+$/)) ? 'td' : 'td';
            return '<tr>' + cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('') + '</tr>';
        })
        .replace(/(<tr>.*<\/tr>\n?)+/g, '<table>$&</table>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/^(?!<[hultop])/gm, (line) => line ? `<p>${line}` : '')
        .replace(/<p><\/p>/g, '');
}

// ======== SUPPLIER KNOWLEDGE (AUTONOMOUS LEARNING) ROUTES ========

router.get("/knowledge/stats", async (req: Request, res: Response) => {
    try {
        const restaurant = (req.query.restaurant as string) === "maillane" ? "maillane" : "val";
        const stats = await getKnowledgeStats(restaurant);
        res.json({ success: true, restaurant, ...stats });
    } catch (err: any) {
        res.status(500).json({ error: "Erreur knowledge stats", detail: err?.message });
    }
});

router.post("/knowledge/consolidate", async (req: Request, res: Response) => {
    try {
        const restaurant = req.body?.restaurant === "maillane" ? "maillane" : "val";
        const result = await consolidateSupplierKnowledge(restaurant);
        res.json({ success: true, restaurant, ...result, message: `${result.updated} fournisseurs appris sur ${result.total} distincts` });
    } catch (err: any) {
        res.status(500).json({ error: "Erreur consolidation", detail: err?.message });
    }
});

// ======== BACKUP ROUTES ========

// GET /backups - List all backups (metadata only, no data)
router.get("/backups", async (_req: Request, res: Response) => {
    try {
        const backups = await db.select({
            id: suguBackups.id,
            label: suguBackups.label,
            createdAt: suguBackups.createdAt,
            tableCounts: suguBackups.tableCounts,
            sizeBytes: suguBackups.sizeBytes,
        }).from(suguBackups).orderBy(desc(suguBackups.createdAt));
        res.json(backups);
    } catch (error: any) {
        console.error("[SUGU] Error fetching backups:", error?.message);
        res.status(500).json({ error: "Erreur lors de la récupération des sauvegardes" });
    }
});

// POST /backup - Create a new full backup
router.post("/backup", async (req: Request, res: Response) => {
    try {
        const label = (req.body?.label as string)?.trim() || `Sauvegarde du ${new Date().toLocaleDateString("fr-FR")} à ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;

        const [suppliers, purchases, expenses, bankEntries, loans, cashEntries, employees, payroll, absences, files, hubriseResult] = await Promise.all([
            db.select().from(suguSuppliers),
            db.select().from(suguPurchases),
            db.select().from(suguExpenses),
            db.select().from(suguBankEntries),
            db.select().from(suguLoans),
            db.select().from(suguCashRegister),
            db.select().from(suguEmployees),
            db.select().from(suguPayroll),
            db.select().from(suguAbsences),
            db.select().from(suguFiles),
            db.execute(sql`SELECT id, status, created_at, total, service_type, channel, data, synced_at FROM hubrise_orders ORDER BY created_at DESC`).catch(() => ({ rows: [] })),
        ]);
        const hubriseOrders = (hubriseResult as any).rows || [];

        const tableCounts = {
            suppliers: suppliers.length,
            purchases: purchases.length,
            expenses: expenses.length,
            bankEntries: bankEntries.length,
            loans: loans.length,
            cashEntries: cashEntries.length,
            employees: employees.length,
            payroll: payroll.length,
            absences: absences.length,
            files: files.length,
            hubriseOrders: hubriseOrders.length,
        };

        const dataJson = JSON.stringify({
            version: "1.1",
            createdAt: new Date().toISOString(),
            restaurant: "SUGU Valentine",
            suppliers, purchases, expenses, bankEntries, loans, cashEntries, employees, payroll, absences, files, hubriseOrders,
        });

        const sizeBytes = Buffer.byteLength(dataJson, "utf8");

        const [backup] = await db.insert(suguBackups).values({
            label,
            dataJson,
            tableCounts: JSON.stringify(tableCounts),
            sizeBytes,
        }).returning({ id: suguBackups.id, label: suguBackups.label, createdAt: suguBackups.createdAt, tableCounts: suguBackups.tableCounts, sizeBytes: suguBackups.sizeBytes });

        console.log(`[SUGU] Backup created: "${label}" — ${sizeBytes} bytes, ${Object.values(tableCounts).reduce((a, b) => a + b, 0)} records`);
        res.json(backup);
    } catch (error: any) {
        console.error("[SUGU] Error creating backup:", error?.message);
        res.status(500).json({ error: "Erreur lors de la création de la sauvegarde" });
    }
});

// Helper: timestamp fields stored as ISO strings in JSON must be Date objects for Drizzle
function fixDates(records: any[]): any[] {
    return records.map((r) => {
        const fixed: any = { ...r };
        // Convert any ISO string timestamps back to Date objects
        if (fixed.createdAt && typeof fixed.createdAt === 'string') {
            fixed.createdAt = new Date(fixed.createdAt);
        }
        if (fixed.updatedAt && typeof fixed.updatedAt === 'string') {
            fixed.updatedAt = new Date(fixed.updatedAt);
        }
        return fixed;
    });
}

// POST /backups/:id/restore - Restore from a backup (replaces all data — 100% identical snapshot)
router.post("/backups/:id/restore", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID invalide" });
    try {
        const [backup] = await db.select().from(suguBackups).where(eq(suguBackups.id, id)).limit(1);
        if (!backup) return res.status(404).json({ error: "Sauvegarde introuvable" });

        const data = JSON.parse(backup.dataJson);

        await db.transaction(async (tx) => {
            await tx.delete(suguPayroll);
            await tx.delete(suguAbsences);
            await tx.delete(suguPurchases);
            await tx.delete(suguExpenses);
            await tx.delete(suguBankEntries);
            await tx.delete(suguLoans);
            await tx.delete(suguCashRegister);
            await tx.delete(suguFiles);
            await tx.delete(suguEmployees);
            await tx.delete(suguSuppliers);

            if (data.suppliers?.length) await tx.insert(suguSuppliers).values(fixDates(data.suppliers));
            if (data.employees?.length) await tx.insert(suguEmployees).values(fixDates(data.employees));
            if (data.purchases?.length) await tx.insert(suguPurchases).values(fixDates(data.purchases));
            if (data.expenses?.length) await tx.insert(suguExpenses).values(fixDates(data.expenses));
            if (data.bankEntries?.length) await tx.insert(suguBankEntries).values(fixDates(data.bankEntries));
            if (data.loans?.length) await tx.insert(suguLoans).values(fixDates(data.loans));
            if (data.cashEntries?.length) await tx.insert(suguCashRegister).values(fixDates(data.cashEntries));
            if (data.payroll?.length) await tx.insert(suguPayroll).values(fixDates(data.payroll));
            if (data.absences?.length) await tx.insert(suguAbsences).values(fixDates(data.absences));
            if (data.files?.length) await tx.insert(suguFiles).values(fixDates(data.files));
        });

        if (data.hubriseOrders?.length) {
            await db.execute(sql`DELETE FROM hubrise_orders`);
            for (const order of data.hubriseOrders) {
                await db.execute(sql`INSERT INTO hubrise_orders (id, status, created_at, total, service_type, channel, data, synced_at) VALUES (${order.id}, ${order.status}, ${order.created_at}, ${order.total}, ${order.service_type}, ${order.channel}, ${JSON.stringify(order.data)}::jsonb, NOW()) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, data = EXCLUDED.data`);
            }
        }

        const seqResets: [string, string][] = [
            ["sugu_suppliers", "sugu_suppliers_id_seq"],
            ["sugu_purchases", "sugu_purchases_id_seq"],
            ["sugu_general_expenses", "sugu_general_expenses_id_seq"],
            ["sugu_bank_entries", "sugu_bank_entries_id_seq"],
            ["sugu_loans", "sugu_loans_id_seq"],
            ["sugu_cash_entries", "sugu_cash_entries_id_seq"],
            ["sugu_employees", "sugu_employees_id_seq"],
            ["sugu_payroll", "sugu_payroll_id_seq"],
            ["sugu_absences", "sugu_absences_id_seq"],
            ["sugu_files", "sugu_files_id_seq"],
        ];
        for (const [table, seq] of seqResets) {
            await db.execute(sql.raw(`SELECT setval('${seq}', COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`));
        }

        console.log(`[SUGU] Backup ${id} restored: "${backup.label}" — all data + sequences reset`);
        res.json({ success: true, label: backup.label });
    } catch (error: any) {
        console.error("[SUGU] Error restoring backup:", error?.message);
        res.status(500).json({ error: "Erreur lors de la restauration" });
    }
});

// GET /backups/:id/download - Download backup JSON
router.get("/backups/:id/download", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID invalide" });
    try {
        const [backup] = await db.select().from(suguBackups).where(eq(suguBackups.id, id)).limit(1);
        if (!backup) return res.status(404).json({ error: "Sauvegarde introuvable" });

        const filename = `sugu_valentine_backup_${backup.id}_${backup.createdAt?.toISOString().slice(0, 10)}.json`;
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Type", "application/json");
        res.send(backup.dataJson);
    } catch (error: any) {
        console.error("[SUGU] Error downloading backup:", error?.message);
        res.status(500).json({ error: "Erreur lors du téléchargement" });
    }
});

// GET /backups/:id/download-zip - Download backup as ZIP with actual files
router.get("/backups/:id/download-zip", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID invalide" });
    try {
        const [backup] = await db.select().from(suguBackups).where(eq(suguBackups.id, id)).limit(1);
        if (!backup) return res.status(404).json({ error: "Sauvegarde introuvable" });

        const data = JSON.parse(backup.dataJson);
        const dateStr = backup.createdAt?.toISOString().slice(0, 10) || "unknown";
        const zipName = `sugu_valentine_backup_${backup.id}_${dateStr}.zip`;

        res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);
        res.setHeader("Content-Type", "application/zip");

        const archive = archiver("zip", { zlib: { level: 6 } });
        archive.on("error", (err: any) => { throw err; });
        archive.pipe(res);

        archive.append(backup.dataJson, { name: "donnees.json" });

        const fileRecords = (data.files || []).filter((f: any) => f.storagePath);
        let filesIncluded = 0;
        const BATCH = 5;
        for (let i = 0; i < fileRecords.length; i += BATCH) {
            const batch = fileRecords.slice(i, i + BATCH);
            const results = await Promise.allSettled(batch.map(async (f: any) => {
                const { buffer } = await downloadFromObjectStorage(f.storagePath);
                return { f, buffer };
            }));
            for (const r of results) {
                if (r.status === "fulfilled") {
                    const { f, buffer } = r.value;
                    const safeCategory = (f.category || "autre").replace(/[^a-zA-Z0-9_-]/g, "_");
                    const safeName = (f.originalName || f.fileName || `file_${f.id}`).replace(/[/\\]/g, "_");
                    archive.append(buffer, { name: `fichiers/${safeCategory}/${safeName}` });
                    filesIncluded++;
                } else {
                    console.warn(`[SUGU] ZIP: skipping file: ${r.reason?.message}`);
                }
            }
        }

        const summary = [
            `SAUVEGARDE SUGU VALENTINE`,
            `Date: ${backup.createdAt?.toISOString() || dateStr}`,
            `Label: ${backup.label}`,
            ``,
            `CONTENU:`,
            `- donnees.json : toutes les donnees (fournisseurs, achats, depenses, banque, prets, caisse, employes, paie, absences, fichiers metadata, commandes HubRise)`,
            `- fichiers/ : ${filesIncluded} fichier(s) classes par categorie`,
            ``,
            `TABLES:`,
            ...(data.suppliers?.length ? [`  Fournisseurs: ${data.suppliers.length}`] : []),
            ...(data.purchases?.length ? [`  Achats: ${data.purchases.length}`] : []),
            ...(data.expenses?.length ? [`  Depenses: ${data.expenses.length}`] : []),
            ...(data.bankEntries?.length ? [`  Banque: ${data.bankEntries.length}`] : []),
            ...(data.loans?.length ? [`  Prets: ${data.loans.length}`] : []),
            ...(data.cashEntries?.length ? [`  Caisse: ${data.cashEntries.length}`] : []),
            ...(data.employees?.length ? [`  Employes: ${data.employees.length}`] : []),
            ...(data.payroll?.length ? [`  Paie: ${data.payroll.length}`] : []),
            ...(data.absences?.length ? [`  Absences: ${data.absences.length}`] : []),
            ...(data.files?.length ? [`  Fichiers: ${data.files.length}`] : []),
            ...(data.hubriseOrders?.length ? [`  Commandes HubRise: ${data.hubriseOrders.length}`] : []),
        ].join("\n");
        archive.append(summary, { name: "LISEZ-MOI.txt" });

        console.log(`[SUGU] ZIP backup ${id}: ${filesIncluded} files included`);
        await archive.finalize();
    } catch (error: any) {
        console.error("[SUGU] Error creating ZIP backup:", error?.message);
        if (!res.headersSent) res.status(500).json({ error: "Erreur lors de la creation du ZIP" });
    }
});

// DELETE /backups/:id - Delete a backup
router.delete("/backups/:id", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID invalide" });
    try {
        await db.delete(suguBackups).where(eq(suguBackups.id, id));
        res.json({ success: true });
    } catch (error: any) {
        console.error("[SUGU] Error deleting backup:", error?.message);
        res.status(500).json({ error: "Erreur lors de la suppression" });
    }
});

// ============================================================
// HUBRISE INTEGRATION (auth-protected routes)
// ============================================================

router.get("/hubrise/status", async (_req: Request, res: Response) => {
    try {
        await hubriseService.ensureTable();
        res.json(hubriseService.getStatus());
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get("/hubrise/authorize", async (req: Request, res: Response) => {
    const host = req.headers.host || req.hostname;
    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    const redirectUri = `${proto}://${host}/api/v2/sugu-management/hubrise/callback`;
    const url = hubriseService.getAuthorizeUrl(redirectUri);
    res.json({ url });
});

router.post("/hubrise/disconnect", async (_req: Request, res: Response) => {
    try {
        await hubriseService.disconnect();
        res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get("/hubrise/account", async (_req: Request, res: Response) => {
    try {
        const data = await hubriseService.getAccount();
        res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get("/hubrise/location", async (_req: Request, res: Response) => {
    try {
        const data = await hubriseService.getLocation();
        res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get("/hubrise/orders", async (req: Request, res: Response) => {
    try {
        const { after, before, status, count } = req.query;
        const data = await hubriseService.getOrders({
            after: after as string,
            before: before as string,
            status: status as string,
            count: count ? parseInt(count as string) : 100,
        });
        res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get("/hubrise/orders/summary", async (req: Request, res: Response) => {
    try {
        const { from, to } = req.query;
        const data = await hubriseService.getOrdersSummary(from as string, to as string);
        res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post("/hubrise/sync", async (_req: Request, res: Response) => {
    try {
        await hubriseService.forceSync();
        res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get("/hubrise/catalog", async (_req: Request, res: Response) => {
    try {
        const data = await hubriseService.getCatalog();
        res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
