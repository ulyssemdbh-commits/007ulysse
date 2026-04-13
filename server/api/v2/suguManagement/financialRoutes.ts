import { Router, Request, Response } from "express";
import multer from "multer";
import { hybridUpload } from "../../../middleware/base64Upload";
import { db } from "../../../db";
import {
    suguPurchases, insertSuguPurchaseSchema,
    suguExpenses, insertSuguExpenseSchema,
    suguBankEntries, insertSuguBankEntrySchema,
    suguLoans, insertSuguLoanSchema,
    suguCashRegister, insertSuguCashRegisterSchema,
    suguFiles,
} from "@shared/schema";
import { eq, desc, sql, and, gte, lte } from "drizzle-orm";
import { emitSuguPurchasesUpdated, emitSuguExpensesUpdated, emitSuguBankUpdated, emitSuguLoansUpdated, emitSuguCashUpdated } from "../../../services/realtimeSync";
import { normalizeExpenseCategory, deleteFromObjectStorage } from "./shared";
import { parseLoanDocument } from "./documentParsers";

const router = Router();

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

const TICKET_Z_PROMPT = `Tu es un expert en lecture de tickets Z de caisse de restaurant en France.
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

function parseTicketResponse(raw: string) {
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

async function parseTicketWithOpenAI(base64Data: string, mimeType: string) {
    const OpenAI = (await import("openai")).default;
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OpenAI API key not configured");
    const opts: any = { apiKey };
    if (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) opts.baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const openai = new OpenAI(opts);
    const dataUrl = `data:${mimeType};base64,${base64Data}`;
    const response = await openai.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 1000,
        messages: [{
            role: "user",
            content: [
                { type: "text", text: TICKET_Z_PROMPT },
                { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
            ],
        }],
    });
    const raw = response.choices?.[0]?.message?.content || "";
    console.log("[SUGU] Ticket Z parsed via OpenAI GPT-4o");
    return parseTicketResponse(raw);
}

async function parseTicketWithGemini(base64Data: string, mimeType: string) {
    const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Gemini API key not configured");
    const { GoogleGenAI } = await import("@google/genai");
    const geminiOpts: any = { apiKey };
    if (process.env.AI_INTEGRATIONS_GEMINI_BASE_URL) {
        geminiOpts.httpOptions = { apiVersion: "", baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL };
    }
    const gemini = new GoogleGenAI(geminiOpts);
    const response = await gemini.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{
            role: "user",
            parts: [
                { text: TICKET_Z_PROMPT },
                { inlineData: { mimeType, data: base64Data } },
            ],
        }],
    });
    const raw = response.candidates?.[0]?.content?.parts?.[0]?.text || "";
    console.log("[SUGU] Ticket Z parsed via Gemini");
    return parseTicketResponse(raw);
}

async function parseTicketVision(base64Data: string, mimeType: string) {
    try {
        return await parseTicketWithGemini(base64Data, mimeType);
    } catch (geminiErr: any) {
        console.warn("[SUGU] Gemini ticket parsing failed, falling back to OpenAI:", geminiErr.message?.substring(0, 120));
        return await parseTicketWithOpenAI(base64Data, mimeType);
    }
}

router.post("/cash/parse-ticket", hybridUpload({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }), async (req: Request, res: Response) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No image file provided" });
        const base64Data = req.file.buffer.toString("base64");
        const mimeType = req.file.mimetype || "image/jpeg";
        const result = await parseTicketVision(base64Data, mimeType);
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
        const result = await parseTicketVision(base64Data, mime);
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


export default router;
