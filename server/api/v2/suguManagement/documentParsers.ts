import { db } from "../../../db";
import { eq, and, gte, lte } from "drizzle-orm";
import { suguFiles, suguExpenses, suguPurchases, suguBankEntries } from "@shared/schema";
import { downloadFromObjectStorage } from "./shared";
import { parseBankStatementPDF } from "../../../services/bankStatementParser";


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

// ============ PDF INVOICE / BILL PARSER (universal) ============
}
export interface ParsedDocumentData {
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

export function extractAmountFromFilename(filename: string): number {
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

export function extractSupplierFromFilename(filename: string): string | null {
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

export function resolveSupplierFromFilename(filename: string): { name: string; category: string } | null {
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
export async function getPdfParse() {
    if (_pdfParseFn) return _pdfParseFn;
    const mod = await import("pdf-parse/lib/pdf-parse.js");
    _pdfParseFn = mod.default || mod;
    return _pdfParseFn;
}

// Category detection from supplier / text
export const CATEGORY_KEYWORDS: Record<string, string[]> = {
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
export const PAYMENT_KEYWORDS: Record<string, string[]> = {
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

export function parseFrenchAmount(s: string): number | null {
    const clean = s.replace(/[\s\u00a0]/g, "").replace(",", ".");
    const n = parseFloat(clean);
    return isNaN(n) ? null : n;
}

export function parseFrenchDate(s: string): string | null {
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    return `${m[3]}-${m[2]}-${m[1]}`;
}

export function detectBankFromText(text: string): string | null {
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
export function findAfterLabel(text: string, labelRegex: RegExp, valueRegex: RegExp, windowSize = 500): RegExpMatchArray | null {
    const lm = labelRegex.exec(text);
    if (!lm) return null;
    const window = text.substring(lm.index! + lm[0].length, lm.index! + lm[0].length + windowSize);
    return valueRegex.exec(window);
}

export async function parseLoanDocument(buffer: Buffer, filename?: string): Promise<ParsedLoanData> {
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

export async function parseLoanDocumentWithAI(text: string, buffer: Buffer, filename?: string): Promise<ParsedLoanData | null> {
    const { getGeminiNativeRequired } = await import("../../../services/core/openaiClient");
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
export function cleanPdfText(raw: string): string {
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

export function detectBufferMimeType(buffer: Buffer, filename?: string): string {
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

