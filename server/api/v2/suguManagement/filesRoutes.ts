import { Router, Request, Response } from "express";
import multer from "multer";
import { hybridUpload } from "../../../middleware/base64Upload";
import { db } from "../../../db";
import {
    suguFiles, insertSuguFileSchema,
    suguPurchases, insertSuguPurchaseSchema,
    suguExpenses, insertSuguExpenseSchema,
    suguBankEntries, suguLoans,
    suguSuppliers, insertSuguSupplierSchema,
    suguBackups, suguTrash,
    suguEmployees, suguPayroll,
    suguInventoryItems,
} from "@shared/schema";
import { eq, desc, sql, and, inArray, ilike, isNull } from "drizzle-orm";
import { emitSuguFilesUpdated, emitSuguPurchasesUpdated, emitSuguExpensesUpdated, emitSuguEmployeesUpdated, emitSuguPayrollUpdated, emitSuguBankUpdated } from "../../../services/realtimeSync";
import { uploadToObjectStorage, downloadFromObjectStorage, deleteFromObjectStorage, getArchiver, tablesReady, importStatusMap } from "./shared";
import { parseLoanDocument, ParsedDocumentData, extractAmountFromFilename, extractSupplierFromFilename } from "./documentParsers";
import { parseDocumentPDF, parseMultiInvoicePDF } from "./invoiceParsers";
import { getKnowledgePromptHints, overrideCategoryFromKnowledge, consolidateSupplierKnowledge, getKnowledgeStats } from "../../../services/suguLearningService";

const router = Router();

function normalizeArticleName(name: string): string {
    return name.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export async function saveInventoryItemsFromParsed(
    parsed: any,
    ctx: { fileId?: number | null; purchaseId?: number | null; expenseId?: number | null; supplier: string; invoiceNumber?: string | null; invoiceDate?: string | null; category?: string | null; }
): Promise<number> {
    try {
        const items: any[] = Array.isArray(parsed?.lineItems) ? parsed.lineItems : [];
        if (!items.length) return 0;
        const rows = items.map((li: any) => {
            const totalHt = typeof li.totalHt === "number" ? li.totalHt : (typeof li.unitPriceHt === "number" && typeof li.quantity === "number" ? li.unitPriceHt * li.quantity : null);
            const vatRate = typeof li.vatRate === "number" ? li.vatRate : null;
            const totalTtc = totalHt != null && vatRate != null ? Math.round(totalHt * (1 + vatRate / 100) * 100) / 100 : null;
            return {
                fileId: ctx.fileId ?? null,
                purchaseId: ctx.purchaseId ?? null,
                expenseId: ctx.expenseId ?? null,
                supplier: ctx.supplier,
                invoiceNumber: ctx.invoiceNumber ?? null,
                invoiceDate: ctx.invoiceDate ?? null,
                articleName: String(li.articleName).substring(0, 200),
                articleNameNormalized: (normalizeArticleName(String(li.articleName)) || String(li.articleName).toLowerCase()).substring(0, 200) || "article",
                articleCode: li.articleCode ?? null,
                category: ctx.category ?? null,
                unit: li.unit ?? null,
                quantity: li.quantity ?? null,
                unitPriceHt: li.unitPriceHt ?? null,
                totalHt,
                vatRate,
                totalTtc,
            };
        });
        await db.insert(suguInventoryItems).values(rows);
        console.log(`[SUGU INVENTORY] Saved ${rows.length} article(s) from ${ctx.supplier} (file=${ctx.fileId}, purchase=${ctx.purchaseId}, expense=${ctx.expenseId})`);
        try {
            const { brainPulse } = await import("../../../services/sensory/BrainPulse");
            brainPulse(["hippocampus", "concept"], "suguInventory", `+${rows.length} article(s) ${ctx.supplier}`, { intensity: Math.min(1, 0.3 + rows.length * 0.05) });
        } catch {}
        try {
            const { sensorySystemService } = await import("../../../services/sensory");
            sensorySystemService.recordPulse?.({
                zones: ["hippocampus", "concept", "association"],
                intensity: Math.min(1, 0.3 + rows.length * 0.05),
                source: "sugu.inventory.save",
                meta: { count: rows.length, supplier: ctx.supplier, fileId: ctx.fileId, invoice: ctx.invoiceNumber },
            });
        } catch {}
        try {
            const { brainHub } = await import("../../../services/sensory/BrainHub");
            brainHub.addToWorkingMemory({
                type: "input",
                content: `SUGU Inventory: +${rows.length} article(s) from ${ctx.supplier}${ctx.invoiceNumber ? ` (facture ${ctx.invoiceNumber})` : ""}`,
                source: "sugu.inventory.backfill",
                timestamp: new Date(),
                importance: Math.min(90, 40 + rows.length * 2),
                ttlMs: 5 * 60 * 1000,
            } as any);
        } catch (e) {
            console.warn("[SUGU INVENTORY] brainHub working memory push failed:", (e as any)?.message);
        }
        try {
            const { broadcastSyncEvent } = await import("../../../services/realtimeSync");
            broadcastSyncEvent("sugu.inventory.updated" as any, { count: rows.length, supplier: ctx.supplier, fileId: ctx.fileId });
        } catch {}
        return rows.length;
    } catch (err: any) {
        console.error("[SUGU INVENTORY] Failed to save line items:", err?.message);
        return 0;
    }
}

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
                    await saveInventoryItemsFromParsed(p, { fileId: result.id, expenseId: expense.id, supplier: resolvedSupplier, invoiceNumber: resolvedInvoice, invoiceDate: resolvedDate, category: resolvedCategory });
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
                            await saveInventoryItemsFromParsed(parsed, { fileId: result.id, expenseId: expense.id, supplier: betterSupplier, invoiceNumber: betterInvoice, invoiceDate: betterDate, category: betterCategory });
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
                    await saveInventoryItemsFromParsed(p, { fileId: result.id, purchaseId: purchase.id, supplier: resolvedSupplier, invoiceNumber: resolvedInvoice, invoiceDate: resolvedDate, category: resolvedCategory });
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
                                await saveInventoryItemsFromParsed(parsed, { fileId: result.id, purchaseId: purchase.id, supplier: resolvedSupplier, invoiceNumber: resolvedInvoice, invoiceDate: resolvedDate, category: parsed.category || "alimentaire" });
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
                            await saveInventoryItemsFromParsed(parsed, { fileId: result.id, purchaseId: purchase.id, supplier: resolvedSupplier, invoiceNumber: resolvedInvoice, invoiceDate: resolvedDate, category: parsed.category || "autre" });
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
                            await saveInventoryItemsFromParsed(parsed, { fileId: result.id, purchaseId: purchase.id, supplier: resolvedSupplier, invoiceNumber: resolvedInvoice, invoiceDate: resolvedDate, category: resolvedCategory });
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

router.post("/inventory/backfill", async (req: Request, res: Response) => {
    try {
        const { executeSuguInventoryManagement } = await import("../../../services/tools/utilityTools");
        const out = await executeSuguInventoryManagement({ action: "backfill", skip_existing: req.body?.skip_existing !== false, max_files: req.body?.max_files });
        res.json(JSON.parse(out));
    } catch (e: any) { res.status(500).json({ error: e?.message }); }
});

router.get("/inventory/backfill/status", async (_req: Request, res: Response) => {
    try {
        const { executeSuguInventoryManagement } = await import("../../../services/tools/utilityTools");
        const out = await executeSuguInventoryManagement({ action: "backfill_status" });
        res.json(JSON.parse(out));
    } catch (e: any) { res.status(500).json({ error: e?.message }); }
});

export default router;
