/**
 * Bank Statement PDF Parser — Société Générale format
 * Parses SG business account PDFs into structured bank entries
 * for the SUGU Valentine management system.
 */

import * as fs from "fs";

// Lazy-loaded pdf-parse
let pdfParseFn: any = null;
let pdfModuleLoaded = false;

async function ensurePdfLoaded(): Promise<void> {
    if (pdfModuleLoaded) return;
    try {
        const pdfModule = await import("pdf-parse/lib/pdf-parse.js");
        pdfParseFn = pdfModule.default || pdfModule;
        pdfModuleLoaded = true;
        console.log("[BankParser] pdf-parse loaded");
    } catch (e) {
        console.error("[BankParser] Failed to load pdf-parse:", e);
    }
}

ensurePdfLoaded().catch(() => { });

export interface ParsedBankEntry {
    entryDate: string;       // YYYY-MM-DD
    label: string;           // Description
    amount: number;          // positive=credit, negative=debit
    balance: number | null;  // solde after operation
    category: string;        // auto-categorized
}

export interface BankStatementParseResult {
    success: boolean;
    bankName: string;
    accountNumber: string;
    periodStart: string;
    periodEnd: string;
    openingBalance: number;
    closingBalance: number;
    totalDebits: number;
    totalCredits: number;
    entries: ParsedBankEntry[];
    rawLineCount: number;
    errors: string[];
}

// ====== Auto-categorization rules ======
function categorizeEntry(label: string, amount: number): string {
    const l = label.toLowerCase();

    // Revenue: CB remises, Uber, Deliveroo, Zenorder, TheFork
    if (l.includes("remise cb") || l.includes("remisecb")) return "encaissement_cb";
    if (l.includes("uber") || l.includes("deliveroo") || l.includes("zenorder") || l.includes("thefork")) return "plateforme";
    if (l.includes("kolibri")) return "encaissement_virement";

    // Purchases: METRO, suppliers
    if (/carte\s*x\d+\s+rem/i.test(l)) return "remboursement_fournisseur";
    if (l.includes("metro")) return "achat_fournisseur";
    if (l.includes("asia pack") || l.includes("soysoy") || l.includes("yesh") || l.includes("foodex") || l.includes("bross") || l.includes("boucher gourmet")) return "achat_fournisseur";
    if (l.includes("am discount") || l.includes("paris store") || l.includes("parisstore")) return "achat_fournisseur";
    if (l.includes("espace cafe") || l.includes("cafe capsules")) return "achat_fournisseur";

    // Rent & property
    if (l.includes("loyer") || l.includes("mddimmo") || l.includes("mddi")) return "loyer";

    // Staff payments
    if (l.includes("charles") || l.includes("tuan") || l.includes("van trung") || l.includes("pham") || l.includes("mdbh") || l.includes("desurmont") || l.includes("avichai") || l.includes("fhima")) return "salaire";
    if (l.includes("acompte")) return "salaire";
    if (l.includes("solde de tout compte") || l.includes("solde cpte")) return "salaire";
    if (l.includes("valentine solde")) return "virement_interne";

    // Bank fees & subscriptions
    if (l.includes("cions tenue") || l.includes("commission") || l.includes("frais") || l.includes("cotis") || l.includes("cotisation") || l.includes("abonnement")) return "frais_bancaires";
    if (l.includes("loyer tpe") || l.includes("monetia")) return "frais_bancaires";

    // Insurance
    if (l.includes("axa") || l.includes("mutuelle") || l.includes("insure")) return "assurance";

    // Loan
    if (l.includes("echeance pret") || l.includes("échéance prêt")) return "emprunt";
    if (l.includes("sogelease") || l.includes("grenke")) return "leasing";

    // Energy & utilities
    if (l.includes("edf") || l.includes("see") || l.includes("eau")) return "energie";
    if (l.includes("agip") || l.includes("essence") || l.includes("carburant")) return "carburant";
    if (l.includes("orange") || l.includes("telecom") || l.includes("fibre")) return "telecom";

    // Social charges
    if (l.includes("urssaf")) return "charges_sociales";
    if (l.includes("klesia") || l.includes("retraite")) return "charges_sociales";

    // Equipment & vehicles
    if (l.includes("scoot") || l.includes("scooter")) return "vehicule";
    if (l.includes("castorama") || l.includes("sc a j pro")) return "equipement";
    if (l.includes("festivite") || l.includes("replit")) return "divers";

    // Cards / misc expenses
    if (l.includes("le colombia") || l.includes("colombia")) return "divers";
    if (l.includes("plombieres") || l.includes("dovi")) return "divers";
    if (l.includes("colombo") || l.includes("jardin")) return "achat_fournisseur";

    // Prelevement generique  
    if (l.includes("thefork") && l.includes("prelevement")) return "commission_plateforme";
    if (l.includes("prelevement") || l.includes("prélevement")) return "prelevement";

    // Virement émis
    if (l.includes("vir") && (l.includes("emis") || l.includes("émis") || l.includes("instantane") || l.includes("europeen"))) {
        if (amount < 0) return "virement_emis";
    }

    // Virement reçu
    if (l.includes("vir") && (l.includes("recu") || l.includes("reçu"))) return "virement_recu";

    // Default
    return amount > 0 ? "credit_divers" : "debit_divers";
}

// ====== RECHERCHE D'OPERATIONS format parser ======
// Handles "RECHERCHE D'OPERATIONS SUR COMPTE" PDFs exported from SG online banking.
// Format differences from standard "Relevé de Compte":
//   - Dates concatenated without space: DD/MM/YYYYDD/MM/YYYY
//   - Amounts embedded inline with sign (-=debit, no sign=credit)
//   - Balance shown after amount on certain rows (first of each date group)
//   - No TOTAUX DES MOUVEMENTS section
//   - Header: "Solde comptable au DD/MM/YYYY : XX XXX,XX EUR"

function parseRechercheOperations(rawText: string): { entries: ParsedBankEntry[]; meta: Partial<BankStatementParseResult> } {
    const entries: ParsedBankEntry[] = [];
    const errors: string[] = [];

    const text = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);

    // ── Metadata extraction ──
    let openingBalance = 0;
    let closingBalance = 0;
    let periodStart = "";
    let periodEnd = "";
    let accountNumber = "";

    // "Solde comptable au DD/MM/YYYY : XX XXX,XX EUR"
    const soldeRegex = /Solde comptable au (\d{2}\/\d{2}\/\d{4})\s*:\s*([\d\s]+,\d{2})\s*EUR/g;
    const soldeMatches: RegExpExecArray[] = [];
    let soldeM: RegExpExecArray | null;
    while ((soldeM = soldeRegex.exec(text)) !== null) {
        soldeMatches.push(soldeM);
    }
    if (soldeMatches.length >= 2) {
        openingBalance = parseFrenchAmount(soldeMatches[0][2]);
        closingBalance = parseFrenchAmount(soldeMatches[1][2]);
    } else if (soldeMatches.length === 1) {
        openingBalance = parseFrenchAmount(soldeMatches[0][2]);
    }

    // "Période du DD/MM/YYYY au DD/MM/YYYY"
    const periodeMatch = text.match(/Période du (\d{2}\/\d{2}\/\d{4}) au (\d{2}\/\d{2}\/\d{4})/);
    if (periodeMatch) {
        periodStart = convertDate(periodeMatch[1]);
        periodEnd = convertDate(periodeMatch[2]);
    }

    // Account: "FR76 3000 3032 0500 0200 7068 793"
    const ibanMatch = text.match(/(FR\d{2}\s+\d{4}\s+\d{4}\s+\d{4}\s+\d{4}\s+\d{4}\s+\d{3})/);
    if (ibanMatch) accountNumber = ibanMatch[1].replace(/\s+/g, "");

    console.log(`[BankParser-RECH] Meta: period=${periodStart}→${periodEnd} opening=${openingBalance} closing=${closingBalance}`);

    // ── Skip patterns for this format ──
    const skipPatterns = [
        /^RECHERCHE D.OPERATIONS/i,
        /^Au \d{2}\/\d{2}\/\d{4}/i,
        /^Compte s[eé]lectionn[eé]/i,
        /^SUGU VALENTINE\s*-?\s*FR/i,
        /^Solde comptable/i,
        /^Crit[eè]res/i,
        /^P[eé]riode du/i,
        /^Nature de l.op[eé]ration/i,
        /^Sens de l.[eé]criture/i,
        /^Montant de l.op[eé]ration/i,
        /^Date\s*$/i,
        /^Date de\s*$/i,
        /^Valeur$/i,
        /^D[eé]bit.*EUR/i,
        /^Cr[eé]dit.*EUR/i,
        /^Solde\s*$/i,
        /^comptable.*EUR/i,
        /^[EÉ]dit[eé] le/i,
        /^Les donn[eé]es/i,
        /^\d+\s*\/\s*\d+$/,  // Page numbers "1 / 19"
        /^Toutes$/i,
        /^Tous$/i,
    ];
    function shouldSkipRech(line: string): boolean {
        return skipPatterns.some(p => p.test(line));
    }

    // ── Pre-collect BT/COM net amounts for REMISE CB validation ──
    // BT lines: "BT 696,30E COM 4,76E" → net = 696.30 - 4.76 = 691.54
    // Also handles post-normalisation variants like "BT696,30ECOM4,76E"
    const btComNetAmounts: number[] = [];
    let btComIndex = 0;
    for (const line of lines) {
        const net = parseBtComNet(line);
        if (net !== null) {
            btComNetAmounts.push(net);
        }
    }

    // ── Transaction line regex: two concatenated dates ──
    // DD/MM/YYYYDD/MM/YYYY followed by description+amount+optional_balance
    const txLineRegex = /^(\d{2}\/\d{2}\/\d{4})(\d{2}\/\d{2}\/\d{4})(.*)/;

    // ── Parse transaction blocks ──
    interface RechBlock {
        operDate: string;
        valDate: string;
        rest: string;           // everything after dates on first line
        continuationLines: string[];
        isRemiseCb: boolean;
        btComNet: number | null; // BT-COM net for REMISE CB
    }

    const blocks: RechBlock[] = [];
    let current: RechBlock | null = null;
    let remiseCbCount = 0; // Track how many REMISE CB we've seen for BT/COM matching

    for (const line of lines) {
        if (shouldSkipRech(line)) continue;

        const txMatch = line.match(txLineRegex);
        if (txMatch) {
            // Save previous block
            if (current) blocks.push(current);

            const rest = txMatch[3];
            const isRemise = /REMISE\s*CB/i.test(rest);

            current = {
                operDate: txMatch[1],
                valDate: txMatch[2],
                rest,
                continuationLines: [],
                isRemiseCb: isRemise,
                btComNet: null,
            };

            // Assign BT/COM net amount for REMISE CB
            if (isRemise && remiseCbCount < btComNetAmounts.length) {
                current.btComNet = btComNetAmounts[remiseCbCount];
                remiseCbCount++;
            }
        } else if (current) {
            // BT/COM lines — skip (already pre-processed)
            if (parseBtComNet(line) !== null) continue;

            // Continuation (DE:, REF:, MOTIF:, POUR:, ID:, etc.)
            current.continuationLines.push(line);
        }
    }
    if (current) blocks.push(current);

    console.log(`[BankParser-RECH] Found ${blocks.length} transaction blocks (${remiseCbCount} REMISE CB with BT/COM)`);

    // ── Extract amount + balance from each block ──
    let totalDebits = 0;
    let totalCredits = 0;

    for (const block of blocks) {
        const { amount, balance, description } = extractRechAmounts(block);

        if (amount === 0) {
            // Try to get info from continuation lines
            const fullDesc = block.rest + " " + block.continuationLines.join(" ");
            errors.push(`No amount for: ${block.operDate} ${fullDesc.substring(0, 60)}`);
            continue;
        }

        // Build clean label
        let label = description;
        for (const cl of block.continuationLines) {
            // Skip known non-descriptive continuation
            if (/^MONTANT HT/i.test(cl)) continue;
            if (/^TVA A/i.test(cl)) continue;
            if (/^CAPITAL (AMORTI|RESTANT)/i.test(cl)) continue;
            if (/^INTERETS\s*:/i.test(cl)) continue;
            if (/^ASSURANCE\s*:/i.test(cl)) continue;
            if (/^\d+\s+\d+\s+USD/i.test(cl)) continue; // exchange rate info
            if (/^\d+\s+EUR\s*=/i.test(cl)) continue;
            if (/^COMMERCE ELECTRONIQUE/i.test(cl)) continue;
            if (/^r[eé]seau mobile/i.test(cl)) continue;
            label += " " + cl;
        }

        // Clean up label
        label = label
            .replace(/\s+/g, " ")
            .trim();
        if (label.length > 200) label = label.substring(0, 200);

        const entryDate = convertDate(block.operDate);
        const category = categorizeEntry(label, amount);

        if (amount < 0) totalDebits += Math.abs(amount);
        else totalCredits += amount;

        entries.push({
            entryDate,
            label,
            amount: Math.round(amount * 100) / 100,
            balance,
            category,
        });
    }


    // ── Business rules: force correct debit/credit direction ──
    fixEntryDirections(entries, "[BankParser-RECH]");

    // Sort by date
    entries.sort((a, b) => a.entryDate.localeCompare(b.entryDate));

    // Compute running balance from opening balance
    let runningBalance = openingBalance;
    for (const entry of entries) {
        runningBalance += entry.amount;
        entry.balance = Math.round(runningBalance * 100) / 100;
    }

    console.log(`[BankParser-RECH] ${entries.length} entries | Debits: ${totalDebits.toFixed(2)}€ | Credits: ${totalCredits.toFixed(2)}€`);

    // Verify against closing balance
    if (closingBalance !== 0 && entries.length > 0) {
        const computedClosing = entries[entries.length - 1].balance || 0;
        const diff = Math.abs(computedClosing - closingBalance);
        if (diff > 1.00) {
            console.warn(`[BankParser-RECH] ⚠️ Balance mismatch: computed=${computedClosing.toFixed(2)} expected=${closingBalance.toFixed(2)} diff=${diff.toFixed(2)}`);
            errors.push(`Écart de solde: calculé=${computedClosing.toFixed(2)} attendu=${closingBalance.toFixed(2)}`);
        } else {
            console.log(`[BankParser-RECH] ✅ Final balance verified: ${computedClosing.toFixed(2)} ≈ ${closingBalance.toFixed(2)}`);
        }
    }

    return {
        entries,
        meta: {
            bankName: "Société Générale",
            accountNumber,
            periodStart,
            periodEnd,
            openingBalance,
            closingBalance,
            totalDebits: Math.round(totalDebits * 100) / 100,
            totalCredits: Math.round(totalCredits * 100) / 100,
            errors,
        },
    };
}

/**
 * Read a French-formatted number backwards from the end of a string.
 * Handles: 97,38 | 1 078,21 | 30 248,47 | -40,50 | -1 400,00
 * Correctly stops at CT terminal IDs: 73087500174,69 → reads only 174,69
 * (because 0174 has 4+ consecutive digits with no thousand separator → stops at 174)
 */
function readTrailingFrenchNumber(s: string): { value: number; isNeg: boolean; descEnd: number } | null {
    const len = s.length;
    if (len < 4) return null;
    // Must end with ,\d{2}
    if (s[len - 3] !== ',') return null;
    if (!/\d/.test(s[len - 2]) || !/\d/.test(s[len - 1])) return null;

    // Read integer part backwards from position len-4
    let i = len - 4;
    if (i < 0 || !/\d/.test(s[i])) return null;

    let digitCount = 0;
    while (i >= 0) {
        if (/\d/.test(s[i])) {
            digitCount++;
            i--;
            if (digitCount === 3) {
                // Check for thousand separator (space or dot) followed by more digits
                if (i >= 0 && (s[i] === ' ' || s[i] === '.') && i > 0 && /\d/.test(s[i - 1])) {
                    i--; // skip separator
                    digitCount = 0;
                } else if (i >= 0 && /\d/.test(s[i])) {
                    // 4+ consecutive digits with no separator → we've over-read
                    // The number starts at i+1 (the digit we just counted was the 3rd)
                    break;
                } else {
                    break; // non-digit, non-separator → number boundary
                }
            }
        } else {
            break;
        }
    }

    const isNeg = (i >= 0 && s[i] === '-');
    const numStart = isNeg ? i + 1 : i + 1;
    const numStr = s.substring(numStart, len);
    const value = parseFrenchAmount(numStr);
    if (value === 0) return null;

    return {
        value: isNeg ? -value : value,
        isNeg,
        descEnd: isNeg ? i : i + 1, // index in s where description ends
    };
}

/**
 * Extract amount, balance, and cleaned description from a RECHERCHE transaction block.
 *
 * The SG "RECHERCHE D'OPERATIONS" PDF concatenates amounts and balance
 * WITHOUT separators. Examples:
 *   "VIR RECU    0287799436S63,9430 410,47"   → amt=+63.94  bal=30410.47
 *   "ABONNEMENT MATERIEL-40,5030 248,47"      → amt=-40.50  bal=30248.47
 *   "CARTE X8707 30/12 METRO-10,44"           → amt=-10.44  bal=null
 *   "VIR RECU    1285211109S1 078,21"          → amt=+1078.21 bal=null
 *   "REMISE CB ... CT3732630001691,54"         → amt from BT/COM line
 *
 * Strategy: find ALL ,\d{2} positions. If 2 at end, split into amount+balance.
 * For REMISE CB: always use BT/COM net amount (CT terminal IDs create ambiguity).
 */
function extractRechAmounts(block: {
    rest: string;
    isRemiseCb: boolean;
    btComNet: number | null;
    continuationLines: string[];
}): { amount: number; balance: number | null; description: string } {
    let s = block.rest.trimEnd();

    // ── REMISE CB: use BT/COM net ──
    if (block.isRemiseCb) {
        // Build clean description: strip CT terminal ID suffix
        const desc = s.replace(/\s*CT\d+.*$/i, '').trim();
        // Priority 1: btComNet pre-computed from BT/COM line
        if (block.btComNet !== null && block.btComNet > 0) {
            return { amount: Math.round(block.btComNet * 100) / 100, balance: null, description: desc };
        }
        // Priority 2: BT/COM line may appear in continuationLines (matched after normalisation)
        for (const cl of block.continuationLines) {
            const net = parseBtComNet(cl);
            if (net !== null && net > 0) {
                return { amount: Math.round(net * 100) / 100, balance: null, description: desc };
            }
        }
        // Priority 3: Try to read trailing amount from the first line (after stripping CT)
        const sNoCtRef = s.replace(/\s*CT\d+.*$/i, '').trimEnd();
        if (sNoCtRef !== s) {
            const parsed = readTrailingFrenchNumber(sNoCtRef);
            if (parsed && parsed.value > 0) {
                return { amount: Math.round(parsed.value * 100) / 100, balance: null, description: sNoCtRef.substring(0, parsed.descEnd).trimEnd() };
            }
        }
        // Fallback: no amount found for this REMISE CB — will be logged as error
        if (desc) return { amount: 0, balance: null, description: desc };
    }

    // ── Find all ,\d{2} positions (potential decimal separators) ──
    const commaPositions: number[] = [];
    for (let ci = 1; ci <= s.length - 3; ci++) {
        if (s[ci] === ',' && /\d/.test(s[ci - 1]) && /\d\d/.test(s.substring(ci + 1, ci + 3))) {
            commaPositions.push(ci);
        }
    }

    if (commaPositions.length === 0) {
        return { amount: 0, balance: null, description: s };
    }

    // ── Two or more commas: try amount + balance split ──
    if (commaPositions.length >= 2) {
        const prevComma = commaPositions[commaPositions.length - 2];
        const lastComma = commaPositions[commaPositions.length - 1];

        // Balance text: everything from prevComma+3 (after ,XX of amount) to end
        const balText = s.substring(prevComma + 3).trim();

        // Validate: balText should be a positive number with optional space-thousands
        if (/^\d[\d\s]*,\d{2}$/.test(balText)) {
            const balance = parseFrenchAmount(balText);
            // Extract amount from the portion ending at prevComma+3
            const amtPortion = s.substring(0, prevComma + 3);
            const parsed = readTrailingFrenchNumber(amtPortion);
            if (parsed) {
                return {
                    amount: Math.round(parsed.value * 100) / 100,
                    balance,
                    description: amtPortion.substring(0, parsed.descEnd).trimEnd(),
                };
            }
        }
    }

    // ── Single number at end (or fallback) ──
    const parsed = readTrailingFrenchNumber(s);
    if (parsed) {
        return {
            amount: Math.round(parsed.value * 100) / 100,
            balance: null,
            description: s.substring(0, parsed.descEnd).trimEnd(),
        };
    }

    return { amount: 0, balance: null, description: s };
}

// ====== Main text parser (Relevé de Compte format) ======
function parseLines(rawText: string): { entries: ParsedBankEntry[]; meta: Partial<BankStatementParseResult> } {
    const entries: ParsedBankEntry[] = [];
    const errors: string[] = [];

    // Clean up raw PDF text
    const text = rawText
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n");

    const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);

    // Extract metadata
    let accountNumber = "";
    let periodStart = "";
    let periodEnd = "";
    let openingBalance = 0;
    let closingBalance = 0;

    // Find account number
    const accountMatch = text.match(/n[°o]\s*([\d\s]+\d{2})/);
    if (accountMatch) accountNumber = accountMatch[1].replace(/\s+/g, " ").trim();

    // Find period
    const periodMatch = text.match(/du\s+(\d{2}\/\d{2}\/\d{4})\s+au\s+(\d{2}\/\d{2}\/\d{4})/i);
    if (periodMatch) {
        periodStart = convertDate(periodMatch[1]);
        periodEnd = convertDate(periodMatch[2]);
    }

    // Find opening balance (SOLDE PRECEDENT)
    const soldePrecMatch = text.match(/SOLDE\s*PR[EÉ]C[EÉ]DENT\s+AU\s+\d{2}\/\d{2}\/\d{4}\s*(\d{1,3}(?:[\s.]\d{3})*[.,]\d{2})/i);
    if (soldePrecMatch) {
        openingBalance = parseFrenchAmount(soldePrecMatch[1]);
    }

    // Find closing balance (NOUVEAU SOLDE)
    const soldeFinMatch = text.match(/NOUVEAU\s*SOLDE.*?([+\-])?\s*(\d{1,3}(?:[\s.]\d{3})*[.,]\d{2})/i);
    if (soldeFinMatch) {
        closingBalance = parseFrenchAmount(soldeFinMatch[2]);
        if (soldeFinMatch[1] === "-") closingBalance = -closingBalance;
    }

    // Find totals — TOTAUX DES MOUVEMENTS debit credit
    let totalDebits = 0;
    let totalCredits = 0;
    const totauxMatch = text.match(/TOTAUX\s*DES\s*MOUVEMENTS\s*(\d{1,3}(?:[\s.]\d{3})*[.,]\d{2})\s*(\d{1,3}(?:[\s.]\d{3})*[.,]\d{2})/i);
    if (totauxMatch) {
        totalDebits = parseFrenchAmount(totauxMatch[1]);
        totalCredits = parseFrenchAmount(totauxMatch[2]);
    }

    console.log(`[BankParser] Meta: period=${periodStart}→${periodEnd} opening=${openingBalance} closing=${closingBalance} debits=${totalDebits} credits=${totalCredits}`);

    // ====== Parse transaction lines ======
    // SG PDF format after text extraction:
    // Line with 2 dates + start of description
    // Continuation lines (POUR:, REF:, MOTIF:, CHEZ:, LIB:, DE:)
    // Amount lines: standalone numbers like "80.000,00" or "5.000,00" or "13,00*"
    //
    // The challenge: amounts from Débit and Crédit columns get extracted as separate lines
    // or merged with description. We need to collect all amounts per transaction block,
    // then use TOTAUX to calibrate debit vs credit assignment.

    const dateRegex = /^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(.*)/;
    // Structured amount pattern: 1-3 digits, then optional groups of (space/dot + exactly 3 digits), then comma/dot + 2 decimals
    // This correctly handles: 500,00 | 1.045,24 | 1 045,24 | 80 000,00 | 5.000,00
    const amountPattern = '\\d{1,3}(?:[\\s.]\\d{3})*[.,]\\d{2}';
    const amountLineRegex = new RegExp(`^\\s*-?\\s*(${amountPattern})\\s*[E€]?\\s*\\*?\\s*$`); // standalone amount line
    const inlineAmountRegex = new RegExp(`(${amountPattern})\\s*[E€]?\\s*\\*?\\s*$`); // amount at end of line
    const commissionLineRegex = new RegExp(`(${amountPattern})\\s*E?\\s*COM\\s*(${amountPattern})\\s*E?\\s*$`, 'i'); // "1.045,24E COM 13,00E"
    // Pattern for lines with two amounts side by side (debit + credit columns in PDF extraction)
    const twoAmountsLineRegex = new RegExp(`^\\s*(${amountPattern})\\s*[E€]?\\s+(${amountPattern})\\s*[E€]?\\s*\\*?\\s*$`);

    // Skip header/footer patterns
    const skipPatterns = [
        /^RELEV[EÉ]/i, /^COMPTE/i, /^COMPTED/i, /^n[°o]\s*\d/i, /^du\s+\d/i,
        /^envoi/i, /^Date\s+Valeur/i, /^Soci[eé]t[eé]\s+G[eé]n[eé]rale/i,
        /^S\.A\./i, /^552\s+120/i, /^29,\s*bd/i, /^Si[eè]ge/i, /^suite\s*>/i,
        /^RA\d+/i, /^N[°o]\s*ADEME/i, /^Pour\s+toute/i, /^Le\s+m[eé]diateur/i,
        /^PROGRAMME/i, /^Montant\s+cumul/i, /^Au\s+\d/i, /^Rappel\s+des/i,
        /^Votre\s+compte/i, /^\d+\s*euros?\s+d[eé]pens/i, /^VOS\s*CONTACTS/i,
        /^Votre\s+(Banque|agence|conseiller)/i, /^par\s+(t[eé]l|courrier|e-mail)/i,
        /^sur\s+(internet|votre)/i, /^Ce\s+document/i, /^MR[A-Z]/i, /^RDC\s+/i,
        /^\d{5}\s+MARS/i, /^SUGU\s+VALENTINE$/i, /^6\s+AVENUE/i, /^JAC$/i,
        /^Page\s+\d/i, /^[12]-\s/i, /^3-\s+Le/i, /^TOTAUX/i, /^NOUVEAU/i,
        /^SOLDE/i, /^\*\s*Op/i, /^service\s+gratuit/i, /^Du\s+lundi/i,
        /^INFO/i, /^Depuis/i, /^1\s+Depuis/i, /^courrier\s/i,
        /^SG-Soci/i, /^SG\s+SOCIETE/i, /^\d{3}\s+\d{3}/i, /^TSA\s+/i,
        /^cotisation\)/i, /^Business\s+et\s+Jazz/i, /^DATE\s+PREVISIONNELLE/i,
        /^\d[\d\s.]*euros\s+d[eé]pens/i, /^une\s+p[eé]riode/i, /^vous\s+pouvez/i, /^pour\s+un/i,
    ];

    function shouldSkip(line: string): boolean {
        return skipPatterns.some(p => p.test(line));
    }

    // Phase 1: Collect transaction blocks
    // Each block = { dates, descLines, amounts[] }
    interface TxBlock {
        operDate: string;
        valDate: string;
        descLines: string[];
        amounts: number[];
    }

    const blocks: TxBlock[] = [];
    let current: TxBlock | null = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (shouldSkip(line)) continue;

        // Check for date line starting a new transaction
        const dateMatch = line.match(dateRegex);
        if (dateMatch) {
            if (current) blocks.push(current);

            current = {
                operDate: dateMatch[1],
                valDate: dateMatch[2],
                descLines: [],
                amounts: [],
            };

            // The rest after dates may contain description + optionally an amount
            let rest = dateMatch[3].trim();

            // Check for commission pattern first: "1.045,24E COM 13,00E"
            const commMatchRest = rest.match(commissionLineRegex);
            if (commMatchRest) {
                const mainAmt = parseFrenchAmount(commMatchRest[1]);
                if (mainAmt > 0) current.amounts.push(mainAmt);
                // Intentionally skip the commission amount (commMatchRest[2])
                rest = rest.replace(commissionLineRegex, "").trim();
            } else {
                const inlineAmt = rest.match(inlineAmountRegex);
                if (inlineAmt) {
                    const amt = parseFrenchAmount(inlineAmt[1]);
                    if (amt > 0) current.amounts.push(amt);
                    rest = rest.replace(inlineAmountRegex, "").trim();
                }
            }
            if (rest) current.descLines.push(rest);

        } else if (current) {
            // ── Filter: skip technical/informational lines — do NOT add their amounts ──
            // These lines carry sub-amounts (interest, insurance, capital, VAT) that
            // must NOT pollute block.amounts. Only the final operation amount matters.
            const isTechnicalLine = /^(INTERETS|INT[EÉ]R[EÊ]TS)\s*:/i.test(line)
                || /^ASSURANCE\s*:/i.test(line)
                || /^CAPITAL\s+(AMORTI|RESTANT)/i.test(line)
                || /^MONTANT\s+HT/i.test(line)
                || /^TVA\s+A\s/i.test(line);

            if (isTechnicalLine) {
                // Keep as description line but do NOT extract amounts
                current.descLines.push(line);
            }
            // Check for commission pattern first: "1.045,24E COM 13,00E"
            else if (commissionLineRegex.test(line)) {
                const commMatch = line.match(commissionLineRegex)!;
                const mainAmt = parseFrenchAmount(commMatch[1]);
                if (mainAmt > 0) current.amounts.push(mainAmt);
                // Skip the commission amount
                const textBefore = line.replace(commissionLineRegex, "").trim();
                if (textBefore) current.descLines.push(textBefore);
            }
            // Check for two amounts on one line (debit + credit columns extracted together)
            else if (twoAmountsLineRegex.test(line)) {
                const twoMatch = line.match(twoAmountsLineRegex)!;
                const amt1 = parseFrenchAmount(twoMatch[1]);
                const amt2 = parseFrenchAmount(twoMatch[2]);
                // Take the larger one (the other is likely a commission or fee)
                if (amt1 > 0 || amt2 > 0) current.amounts.push(Math.max(amt1, amt2));
            }
            // Check if this is a standalone amount line
            else {
                const amtMatch = line.match(amountLineRegex);
                if (amtMatch) {
                    const amt = parseFrenchAmount(amtMatch[1]);
                    if (amt > 0) current.amounts.push(amt);
                } else {
                    // Check for amount at end of a continuation line
                    const endAmt = line.match(inlineAmountRegex);
                    if (endAmt) {
                        const amt = parseFrenchAmount(endAmt[1]);
                        const textPart = line.replace(inlineAmountRegex, "").trim();
                        if (amt > 0) current.amounts.push(amt);
                        if (textPart) current.descLines.push(textPart);
                    } else {
                        current.descLines.push(line);
                    }
                }
            }
        }
    }
    if (current) blocks.push(current);

    console.log(`[BankParser] Found ${blocks.length} transaction blocks`);

    // Phase 2: For each block, extract the main unsigned amount + description
    // We do NOT assign debit/credit signs yet — that comes in Phase 3 using TOTAUX

    interface RawEntry {
        entryDate: string;
        label: string;
        absAmount: number; // always positive
        guessIsCredit: boolean; // initial keyword-based guess
        locked: boolean; // true = subset-sum must NOT flip this entry
        category: string;
    }
    const rawEntries: RawEntry[] = [];

    for (const block of blocks) {
        const desc = block.descLines.join(" ").replace(/\s+/g, " ").trim();
        if (!desc) continue;

        let mainAmount = 0;
        if (block.amounts.length === 0) {
            errors.push(`No amount for: ${block.operDate} ${desc.substring(0, 60)}`);
            continue;
        } else if (block.amounts.length === 1) {
            mainAmount = block.amounts[0];
        } else {
            // Multiple amounts in a block.
            // Strategy: prefer the LAST standalone amount line in the block.
            // In SG PDFs, the real operation amount is typically the last number
            // appearing on its own line (e.g., "125,12" alone after INTERETS/ASSURANCE lines).
            // The first amount may come from the inline date-line and might be a subtotal.
            // Fallback: use the last amount (closest to the actual operation total).
            mainAmount = block.amounts[block.amounts.length - 1];
            if (block.amounts.length > 1) {
                console.log(`[BankParser] Multiple amounts for ${block.operDate} ${desc.substring(0, 40)}: [${block.amounts.join(', ')}] → picked last: ${mainAmount}`);
            }
        }

        let cleanDesc = desc
            .replace(/\d+[.,]\d{2}\s*E?\s*COM\s*\d+[.,]\d{2}\s*E?/gi, "") // remove commission patterns
            .replace(/\d{1,3}(?:[\s.]\d{3})*[.,]\d{2}\s*[E€]?/g, "")     // remove leftover amount strings
            .replace(/BT\s+/g, "")
            .replace(/\s+/g, " ")
            .trim();
        if (cleanDesc.length > 200) cleanDesc = cleanDesc.substring(0, 200);

        const guessIsCredit = detectCredit(cleanDesc, block.operDate);
        const locked = isLockedDirection(cleanDesc);

        rawEntries.push({
            entryDate: convertDate(block.operDate),
            label: cleanDesc,
            absAmount: Math.round(mainAmount * 100) / 100,
            guessIsCredit,
            locked,
            category: "",
        });
    }

    console.log(`[BankParser] ${rawEntries.length} entries parsed. Totals from PDF: debits=${totalDebits} credits=${totalCredits}`);

    // Phase 3: Assign debit/credit signs using TOTAUX DES MOUVEMENTS from the PDF
    // This is much more reliable than keyword-based detection
    let isCredit: boolean[] = rawEntries.map(e => e.guessIsCredit);

    // Build locked indices: entries whose direction must NOT be flipped by subset-sum
    const lockedIndices = new Set<number>();
    for (let i = 0; i < rawEntries.length; i++) {
        if (rawEntries[i].locked) lockedIndices.add(i);
    }
    if (lockedIndices.size > 0) {
        console.log(`[BankParser] ${lockedIndices.size} entries locked (VIR EMIS/RECU, REMISE CB, CARTE): will not be flipped by subset-sum`);
    }

    if (totalDebits > 0 && totalCredits > 0) {
        // We know the exact totals — use subset-sum to find correct assignment
        const amounts = rawEntries.map(e => e.absAmount);
        const guessedDebitSum = amounts.filter((a, i) => !isCredit[i]).reduce((s, a) => s + a, 0);
        const guessedCreditSum = amounts.filter((a, i) => isCredit[i]).reduce((s, a) => s + a, 0);

        console.log(`[BankParser] Initial guess: debits=${guessedDebitSum.toFixed(2)} (target=${totalDebits.toFixed(2)}) credits=${guessedCreditSum.toFixed(2)} (target=${totalCredits.toFixed(2)})`);

        const debitOk = Math.abs(guessedDebitSum - totalDebits) < 0.02;
        const creditOk = Math.abs(guessedCreditSum - totalCredits) < 0.02;

        if (!debitOk || !creditOk) {
            console.log(`[BankParser] Keyword-based guess is wrong, using totals-based correction...`);

            // Pre-compute locked sums to subtract from targets
            let lockedCreditSum = 0;
            let lockedDebitSum = 0;
            for (const idx of lockedIndices) {
                if (isCredit[idx]) lockedCreditSum += amounts[idx];
                else lockedDebitSum += amounts[idx];
            }

            // Build unlocked amounts for subset-sum
            const unlockedIndices = amounts.map((_, i) => i).filter(i => !lockedIndices.has(i));
            const unlockedAmounts = unlockedIndices.map(i => amounts[i]);
            const targetUnlockedCredits = totalCredits - lockedCreditSum;

            if (unlockedAmounts.length > 0 && targetUnlockedCredits >= 0) {
                const found = findSubsetSum(unlockedAmounts, targetUnlockedCredits);
                if (found) {
                    // Reset only unlocked entries
                    for (const ui of unlockedIndices) isCredit[ui] = false;
                    for (const fi of found) isCredit[unlockedIndices[fi]] = true;
                    const verifyDebits = amounts.filter((a, i) => !isCredit[i]).reduce((s, a) => s + a, 0);
                    const verifyCredits = amounts.filter((a, i) => isCredit[i]).reduce((s, a) => s + a, 0);
                    console.log(`[BankParser] ✅ Subset-sum found (locked respected): debits=${verifyDebits.toFixed(2)} credits=${verifyCredits.toFixed(2)}`);
                } else {
                    const targetUnlockedDebits = totalDebits - lockedDebitSum;
                    const foundDebits = targetUnlockedDebits >= 0 ? findSubsetSum(unlockedAmounts, targetUnlockedDebits) : null;
                    if (foundDebits) {
                        for (const ui of unlockedIndices) isCredit[ui] = true;
                        for (const fi of foundDebits) isCredit[unlockedIndices[fi]] = false;
                        console.log(`[BankParser] ✅ Subset-sum (debits, locked respected) found`);
                    } else {
                        console.warn(`[BankParser] ⚠️ Subset-sum failed, falling back to keyword-based guess (locked entries preserved)`);
                        errors.push("⚠️ Classification débit/crédit automatique impossible — vérifier manuellement les montants");
                    }
                }
            }
        } else {
            console.log(`[BankParser] ✅ Keyword-based guess matches totals perfectly`);
        }
    }

    // Build final entries with correct signs
    for (let i = 0; i < rawEntries.length; i++) {
        const r = rawEntries[i];
        const amount = isCredit[i] ? r.absAmount : -r.absAmount;
        entries.push({
            entryDate: r.entryDate,
            label: r.label,
            amount: Math.round(amount * 100) / 100,
            balance: null,
            category: categorizeEntry(r.label, amount),
        });
    }


    // ── Business rules: force correct debit/credit direction ──
    fixEntryDirections(entries, "[BankParser]");

    // Sort by date
    entries.sort((a, b) => a.entryDate.localeCompare(b.entryDate));

    // Compute running balance from opening balance
    let runningBalance = openingBalance;
    for (const entry of entries) {
        runningBalance += entry.amount;
        entry.balance = Math.round(runningBalance * 100) / 100;
    }

    // Final verification against closing balance
    if (closingBalance !== 0 && entries.length > 0) {
        const computedClosing = entries[entries.length - 1].balance || 0;
        if (Math.abs(computedClosing - closingBalance) > 0.10) {
            console.warn(`[BankParser] Final balance check: computed=${computedClosing.toFixed(2)} expected=${closingBalance.toFixed(2)}`);
            errors.push(`Écart de solde: calculé=${computedClosing.toFixed(2)} attendu=${closingBalance.toFixed(2)}`);
        } else {
            console.log(`[BankParser] ✅ Final balance verified: ${computedClosing.toFixed(2)} ≈ ${closingBalance.toFixed(2)}`);
        }
    }

    return {
        entries,
        meta: {
            bankName: "Société Générale",
            accountNumber,
            periodStart,
            periodEnd,
            openingBalance,
            closingBalance,
            totalDebits,
            totalCredits,
            errors,
        },
    };
}

/**
 * Find a subset of amounts that sums to the target (within 0.02€ tolerance).
 * Uses sorted backtracking with pruning. Returns indices of matching amounts or null.
 */
function findSubsetSum(amounts: number[], target: number): number[] | null {
    if (target <= 0) return null;
    const n = amounts.length;
    if (n === 0) return null;

    // Sort by amount descending for better pruning, keep original indices
    const indexed = amounts.map((a, i) => ({ a, i })).sort((x, y) => y.a - x.a);
    const sorted = indexed.map(x => x.a);
    const result: number[] = [];
    let found = false;
    let iterations = 0;
    const MAX_ITERATIONS = 500_000; // Safety limit

    function backtrack(idx: number, remaining: number): boolean {
        if (found) return true;
        if (Math.abs(remaining) < 0.02) { found = true; return true; }
        if (remaining < -0.02) return false;
        if (idx >= n) return false;
        if (++iterations > MAX_ITERATIONS) return false;
        // Pruning: if remaining amount is less than smallest remaining element, skip
        if (remaining > 0 && sorted[idx] > remaining + 0.02) {
            // This element is too big, skip it but continue
            return backtrack(idx + 1, remaining);
        }

        // Include this element
        result.push(idx);
        if (backtrack(idx + 1, remaining - sorted[idx])) return true;
        result.pop();

        // Exclude this element
        return backtrack(idx + 1, remaining);
    }

    backtrack(0, target);

    if (found) {
        // Map back to original indices
        return result.map(sortedIdx => indexed[sortedIdx].i);
    }
    return null;
}

/**
 * Post-parse correction: enforce hard business rules on entry direction.
 * VIR EMIS = always debit (negative), VIR RECU = always credit (positive),
 * REMISE CB = always credit, CARTE X = always debit.
 */
function fixEntryDirections(entries: ParsedBankEntry[], tag: string): void {
    for (const entry of entries) {
        const d = entry.label.toLowerCase();

        // REMISE CB = always credit (positive)
        if ((d.includes("remise cb") || d.includes("remisecb")) && entry.amount < 0) {
            console.warn(`${tag} Correcting negative REMISE CB: ${entry.label} ${entry.amount} → ${-entry.amount}`);
            entry.amount = -entry.amount;
            entry.category = "encaissement_cb";
        }

        // CARTE X\d+ = always debit (negative)
        if (/carte\s*x\d+/i.test(entry.label) && entry.amount > 0) {
            console.warn(`${tag} Correcting positive CARTE: ${entry.label} ${entry.amount} → ${-entry.amount}`);
            entry.amount = -entry.amount;
        }

        // VIR EMIS / VIR INSTANTANE EMIS / VIR EUROPEEN EMIS = always debit (negative)
        if ((d.match(/vir\s+\w*\s*emis/i) || d.includes("vir instantane emis") || d.includes("vir europeen emis") || d.includes("virinstantaneemis") || d.includes("vireuropeenemis")) && entry.amount > 0) {
            console.warn(`${tag} Correcting positive VIR EMIS → debit: ${entry.label} ${entry.amount} → ${-entry.amount}`);
            entry.amount = -entry.amount;
            entry.category = categorizeEntry(entry.label, entry.amount);
        }

        // VIR RECU / VIR INSTANTANE RECU / VIR EUROPEEN RECU = always credit (positive)
        if ((d.includes("vir recu") || d.includes("virrecu") || d.includes("vir reçu") || d.includes("vir instantane recu") || d.includes("vir europeen recu") || d.match(/vir\s+\w*\s*recu/i) || d.match(/vir\s+\w*\s*reçu/i)) && entry.amount < 0) {
            console.warn(`${tag} Correcting negative VIR RECU → credit: ${entry.label} ${entry.amount} → ${-entry.amount}`);
            entry.amount = -entry.amount;
            entry.category = categorizeEntry(entry.label, entry.amount);
        }
    }
}

/**
 * Determine if a transaction's direction is LOCKED and must not be flipped
 * by the subset-sum algorithm. VIR EMIS = always debit, VIR RECU = always credit.
 */
function isLockedDirection(desc: string): boolean {
    const d = desc.toLowerCase();
    if (d.includes("remise cb") || d.includes("remisecb")) return true;
    if (/carte\s*x\d+/i.test(d)) return true;
    if (d.includes("vir recu") || d.includes("virrecu") || d.includes("vir reçu")) return true;
    if (d.includes("vir instantane recu") || d.includes("vir europeen recu")) return true;
    if (d.match(/vir\s+\w*\s*recu/i) || d.match(/vir\s+\w*\s*reçu/i)) return true;
    if (d.includes("vir europeen emis") || d.includes("vireuropeenemis")) return true;
    if (d.includes("vir instantane emis") || d.includes("virinstantaneemis")) return true;
    if (d.match(/vir\s+\w*\s*emis/i) || d.match(/vir\s+\w*\s*émis/i)) return true;
    return false;
}

/**
 * Determine if a transaction is a credit (positive) or debit (negative)
 * based on the description text
 */
function detectCredit(desc: string, date: string): boolean {
    const d = desc.toLowerCase();

    // ═══ HARD-LOCKED CREDITS (money coming in — non-negotiable) ═══
    if (d.includes("remise cb") || d.includes("remisecb")) return true;
    if (d.includes("vir recu") || d.includes("virrecu") || d.includes("vir inst re")) return true;
    if (d.includes("vir reçu")) return true;
    if (d.includes("vir instantane recu") || d.includes("vir europeen recu")) return true;
    if (d.includes("virement") && d.includes("achat") && d.includes("fdc")) return true;
    if (d.includes("virement achat")) return true;
    if (d.match(/de:\s*(stichting|stripe|deliveroo|kolibri|gcre\s*thefork|uber)/i)) return true;
    if (d.includes("apport")) return true;
    if (d.includes("deblocage") || d.includes("déblocage")) return true;
    if (d.includes("capital social")) return true;
    if (d.includes("augmentation") && d.includes("capital")) return true;
    if (d.includes("versement") && !d.includes("prelevement")) return true;
    if (d.includes("decaissement pret") || d.includes("décaissement prêt")) return true;
    if (d.includes("decaissement") && d.includes("pret")) return true;
    if (d.includes("operation pret") && d.includes("decaissement")) return true;
    if (d.includes("encaissement")) return true;
    if (d.includes("virement") && !d.includes("emis") && !d.includes("émis") && !d.includes("europeen emis")) {
        if (d.includes("deblocage") || d.includes("capital") || d.includes("reçu") || d.includes("recu")) return true;
    }

    // ═══ HARD-LOCKED DEBITS (money going out — non-negotiable) ═══
    if (d.includes("rembt") || d.includes("remboursement") || /carte\s*x\d+\s+rem/i.test(d)) return true;
    if (d.includes("carte x") || d.includes("cartex")) return false;
    if (d.includes("vir europeen emis") || d.includes("vireuropeenemis")) return false;
    if (d.includes("vir instantane emis") || d.includes("virinstantaneemis")) return false;
    if (d.match(/vir\s+\w*\s*emis/i)) return false; // any VIR ... EMIS
    if (d.includes("prelevement") || d.includes("prélevement") || d.includes("prelevementeuropeen")) return false;
    if (d.includes("prelevement europeen")) return false;
    if (d.includes("echeance pret") || d.includes("échéance prêt") || d.includes("echeance de pret")) return false;
    if (d.includes("abonnement") || d.includes("cotis") || d.includes("cotisation")) return false;
    if (d.includes("cotisation mensuelle")) return false;
    if (d.includes("cions tenue") || d.includes("commission")) return false;
    if (d.includes("frais")) return false;
    if (d.includes("loyer tpe") || d.includes("monetia")) return false;
    if (d.includes("jazz pro")) return false;
    if (d.includes("sogelease") || d.includes("grenke")) return false;
    if (d.includes("commission attente") || d.includes("frais de dossier")) return false;

    // Default: if unclear, assume debit (safer for restaurant accounts)
    return false;
}

/** Parse French-formatted amount: handles dot as thousand separator, comma as decimal */
function parseFrenchAmount(text: string): number {
    if (!text) return 0;
    // Remove spaces, asterisks, and EUR indicators
    let cleaned = text.replace(/\s+/g, "").replace(/[\*E€]/g, "");
    // French format: 80.000,00 → 80000.00
    if (cleaned.includes(",")) {
        // Has comma → French decimal format. Dots are thousand separators.
        cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    } else if (/\.\d{3}$/.test(cleaned) && !cleaned.match(/\.\d{1,2}$/)) {
        // Has dot followed by exactly 3 digits at end, with no comma anywhere:
        // This is a French thousand separator, NOT a decimal point.
        // e.g. "80.000" → 80000, "5.000" → 5000
        cleaned = cleaned.replace(/\./g, "");
    }
    // else: dot is a decimal separator (e.g., "500.00")
    const val = parseFloat(cleaned);
    return isNaN(val) ? 0 : val;
}

function convertDate(ddmmyyyy: string): string {
    // DD/MM/YYYY -> YYYY-MM-DD
    const parts = ddmmyyyy.split("/");
    if (parts.length !== 3) return ddmmyyyy;
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function parseAmount(text: string): number {
    // Remove spaces (thousand separators) and convert comma to dot
    const cleaned = text.replace(/\s+/g, "").replace(",", ".");
    return parseFloat(cleaned) || 0;
}


// ====== PDF text normalisation ======

/**
 * Fix character-spacing artefacts from PDF text extraction.
 * SG PDFs often store reference numbers/terminal IDs with individual glyph positioning,
 * causing pdf-parse to output "R A 4 2 4 2 5 6" instead of "RA424256"
 * and "B T 6 9 6 , 3 0 E C O M 4 , 7 6 E" instead of "BT 696,30E COM 4,76E".
 * Strategy: per-line, collapse runs of >=4 consecutive single-char tokens (single-space
 * separated) into one token without spaces.
 */
function normalizeCharSpacing(text: string): string {
    return text.split('\n').map(line => {
        const tokens = line.split(' ');
        const out: string[] = [];
        let i = 0;
        while (i < tokens.length) {
            const t = tokens[i];
            if (t.length === 1) {
                let j = i + 1;
                while (j < tokens.length && tokens[j].length === 1) j++;
                const runLen = j - i;
                if (runLen >= 4) {
                    out.push(tokens.slice(i, j).join(''));
                } else {
                    for (let k = i; k < j; k++) out.push(tokens[k]);
                }
                i = j;
            } else {
                out.push(t);
                i++;
            }
        }
        return out.join(' ');
    }).join('\n');
}

/**
 * Parse BT/COM net amount from a line in various formats:
 *   "BT 696,30E COM 4,76E"       (normal)
 *   "BT696,30ECOM4,76E"           (fully collapsed)
 *   "B T  696,30E  C O M  4,76E"  (partially collapsed)
 * Returns brut - com (net credit), or null if not a BT/COM line.
 */
function parseBtComNet(line: string): number | null {
    const patterns = [
        /B\s*T\s+((?:[\d\s]+)[,.]\d{2})\s*E\s*C\s*O\s*M\s*((?:[\d\s]+)[,.]\d{2})\s*E/i,
        /BT([\d.,\s]+)E\s*COM([\d.,\s]+)E/i,
    ];
    for (const re of patterns) {
        const m = line.match(re);
        if (m) {
            const brut = parseFrenchAmount(m[1]);
            const com = parseFrenchAmount(m[2]);
            if (brut > 0) return Math.round((brut - com) * 100) / 100;
        }
    }
    return null;
}

// ====== Public API ======
export async function parseBankStatementPDF(filePathOrBuffer: string | Buffer): Promise<BankStatementParseResult> {
    await ensurePdfLoaded();

    if (!pdfParseFn) {
        return {
            success: false,
            bankName: "",
            accountNumber: "",
            periodStart: "",
            periodEnd: "",
            openingBalance: 0,
            closingBalance: 0,
            totalDebits: 0,
            totalCredits: 0,
            entries: [],
            rawLineCount: 0,
            errors: ["pdf-parse module not available"],
        };
    }

    try {
        const buffer = typeof filePathOrBuffer === "string"
            ? fs.readFileSync(filePathOrBuffer)
            : filePathOrBuffer;

        const pdfData = await pdfParseFn(buffer);
        const rawTextRaw: string = pdfData.text || "";
        const rawText: string = normalizeCharSpacing(rawTextRaw);

        console.log(`[BankParser] Extracted ${rawTextRaw.length} chars from ${pdfData.numpages} pages (normalised to ${rawText.length} chars)`);

        // Auto-detect format: "RECHERCHE D'OPERATIONS" vs standard "Relevé de Compte"
        const isRechercheFormat = /RECHERCHE\s+D.OPERATIONS\s+SUR\s+COMPTE/i.test(rawText);

        const { entries, meta } = isRechercheFormat
            ? parseRechercheOperations(rawText)
            : parseLines(rawText);

        if (isRechercheFormat) {
            console.log(`[BankParser] Detected RECHERCHE D'OPERATIONS format`);
        }

        const result: BankStatementParseResult = {
            success: entries.length > 0,
            bankName: meta.bankName || "Société Générale",
            accountNumber: meta.accountNumber || "",
            periodStart: meta.periodStart || "",
            periodEnd: meta.periodEnd || "",
            openingBalance: meta.openingBalance || 0,
            closingBalance: meta.closingBalance || 0,
            totalDebits: meta.totalDebits || 0,
            totalCredits: meta.totalCredits || 0,
            entries,
            rawLineCount: rawText.split("\n").length,
            errors: meta.errors || [],
        };

        console.log(`[BankParser] Parsed ${entries.length} entries | Debits: ${result.totalDebits}€ | Credits: ${result.totalCredits}€`);

        return result;
    } catch (error) {
        console.error("[BankParser] Parse error:", error);
        return {
            success: false,
            bankName: "",
            accountNumber: "",
            periodStart: "",
            periodEnd: "",
            openingBalance: 0,
            closingBalance: 0,
            totalDebits: 0,
            totalCredits: 0,
            entries: [],
            rawLineCount: 0,
            errors: [(error as Error).message],
        };
    }
}

/**
 * Parse raw text (copy-pasted from statement) into bank entries
 */
export function parseBankStatementText(rawTextInput: string): BankStatementParseResult {
    // Apply character-spacing normalisation (handles garbled PDF copy-paste)
    const rawText = normalizeCharSpacing(rawTextInput);
    const isRechercheFormat = /RECHERCHE\s+D.OPERATIONS\s+SUR\s+COMPTE/i.test(rawText);
    const { entries, meta } = isRechercheFormat
        ? parseRechercheOperations(rawText)
        : parseLines(rawText);

    return {
        success: entries.length > 0,
        bankName: meta.bankName || "Société Générale",
        accountNumber: meta.accountNumber || "",
        periodStart: meta.periodStart || "",
        periodEnd: meta.periodEnd || "",
        openingBalance: meta.openingBalance || 0,
        closingBalance: meta.closingBalance || 0,
        totalDebits: meta.totalDebits || 0,
        totalCredits: meta.totalCredits || 0,
        entries,
        rawLineCount: rawText.split("\n").length,
        errors: meta.errors || [],
    };
}

/**
 * Parse CSV bank statement export.
 * Supports multiple SG CSV formats and generic bank CSV exports:
 *   - Semicolon or comma separated
 *   - Auto-detects columns by header names (date, libellé, débit, crédit, montant, solde, etc.)
 *   - Handles DD/MM/YYYY, YYYY-MM-DD, DD-MM-YYYY date formats
 *   - French decimal format (comma) and international (dot)
 */
export function parseBankStatementCSV(csvText: string): BankStatementParseResult {
    const errors: string[] = [];
    const entries: ParsedBankEntry[] = [];

    // Normalize line endings
    const text = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const rawLines = text.split("\n").filter(l => l.trim().length > 0);

    if (rawLines.length < 2) {
        return emptyResult(["CSV vide ou trop court (pas assez de lignes)"]);
    }

    // Detect separator: semicolon vs comma vs tab
    const firstLines = rawLines.slice(0, 3).join("\n");
    let separator = ";";
    if ((firstLines.match(/;/g) || []).length < (firstLines.match(/\t/g) || []).length) {
        separator = "\t";
    } else if ((firstLines.match(/;/g) || []).length === 0) {
        separator = ",";
    }

    // Parse header row — find column indices
    const headerLine = rawLines[0];
    const headers = splitCSVLine(headerLine, separator).map(h => h.toLowerCase().trim().replace(/[""]/g, ""));

    console.log(`[BankParser CSV] Separator: '${separator === "\t" ? "TAB" : separator}' | Headers: ${headers.join(" | ")}`);

    // Map column indices by common names
    const colDate = findCol(headers, ["date", "date operation", "date opération", "date d'opération", "date_operation", "date comptable", "date op"]);
    const colValeur = findCol(headers, ["date valeur", "date de valeur", "valeur", "date_valeur"]);
    const colLabel = findCol(headers, ["libelle", "libellé", "libellé opération", "description", "label", "intitulé", "designation", "désignation", "detail", "détail", "libelle_operation", "libellé simplifié", "libelle simplifie"]);
    const colDebit = findCol(headers, ["debit", "débit", "montant débit", "montant debit", "debit (eur)", "débit (eur)"]);
    const colCredit = findCol(headers, ["credit", "crédit", "montant crédit", "montant credit", "credit (eur)", "crédit (eur)"]);
    const colAmount = findCol(headers, ["montant", "amount", "montant (eur)", "montant eur"]);
    const colBalance = findCol(headers, ["solde", "solde comptable", "balance", "solde (eur)"]);
    const colCategory = findCol(headers, ["categorie", "catégorie", "category", "type", "type opération", "type operation"]);

    // Must have at least date + label + (amount or debit/credit)
    if (colDate === -1) {
        return emptyResult(["Colonne 'Date' introuvable dans le CSV. En-têtes détectés: " + headers.join(", ")]);
    }
    if (colLabel === -1) {
        return emptyResult(["Colonne 'Libellé' introuvable dans le CSV. En-têtes détectés: " + headers.join(", ")]);
    }
    if (colAmount === -1 && colDebit === -1 && colCredit === -1) {
        return emptyResult(["Colonne 'Montant' ou 'Débit/Crédit' introuvable. En-têtes détectés: " + headers.join(", ")]);
    }

    console.log(`[BankParser CSV] Columns: date=${colDate} label=${colLabel} debit=${colDebit} credit=${colCredit} amount=${colAmount} balance=${colBalance}`);

    // Parse data rows
    let totalDebits = 0;
    let totalCredits = 0;

    for (let i = 1; i < rawLines.length; i++) {
        const line = rawLines[i].trim();
        if (!line) continue;

        const cols = splitCSVLine(line, separator).map(c => c.replace(/^"(.*)"$/, "$1").trim());

        // Extract date
        const rawDate = cols[colDate] || "";
        const entryDate = normalizeDate(rawDate);
        if (!entryDate) {
            // Skip rows without valid date (might be subtotal or footer)
            continue;
        }

        // Extract label
        let label = cols[colLabel] || "";
        // If there's a secondary label column next to the main one, concatenate
        if (label.length < 5 && colLabel + 1 < cols.length && cols[colLabel + 1]) {
            label = (label + " " + cols[colLabel + 1]).trim();
        }
        if (!label || label.length < 2) continue;

        // Extract amount
        let amount = 0;
        if (colAmount !== -1 && cols[colAmount]) {
            amount = parseFrenchNumber(cols[colAmount]);
        } else {
            const debitVal = colDebit !== -1 ? parseFrenchNumber(cols[colDebit] || "") : 0;
            const creditVal = colCredit !== -1 ? parseFrenchNumber(cols[colCredit] || "") : 0;

            if (debitVal !== 0 && creditVal === 0) {
                amount = -Math.abs(debitVal); // debits are negative
            } else if (creditVal !== 0 && debitVal === 0) {
                amount = Math.abs(creditVal); // credits are positive
            } else if (debitVal !== 0 && creditVal !== 0) {
                // Both filled — unusual, use net
                amount = creditVal - debitVal;
            }
        }

        if (amount === 0) continue;

        amount = Math.round(amount * 100) / 100;

        // Track totals
        if (amount < 0) totalDebits += Math.abs(amount);
        else totalCredits += amount;

        // Extract balance
        let balance: number | null = null;
        if (colBalance !== -1 && cols[colBalance]) {
            balance = parseFrenchNumber(cols[colBalance]);
            if (balance === 0 && !cols[colBalance].includes("0")) balance = null;
        }

        // Category: from CSV column or auto-detect
        let category = "";
        if (colCategory !== -1 && cols[colCategory]) {
            category = cols[colCategory].toLowerCase().replace(/\s+/g, "_");
        }
        if (!category) {
            category = categorizeEntry(label, amount);
        }

        entries.push({
            entryDate,
            label: label.substring(0, 250),
            amount,
            balance,
            category,
        });
    }


    // ── Business rules: force correct debit/credit direction ──
    fixEntryDirections(entries, "[BankParser-CSV]");

    // Sort by date
    entries.sort((a, b) => a.entryDate.localeCompare(b.entryDate));

    // Compute running balance if missing
    const hasBalances = entries.some(e => e.balance !== null);
    if (!hasBalances && entries.length > 0) {
        let running = 0;
        for (const e of entries) {
            running += e.amount;
            e.balance = Math.round(running * 100) / 100;
        }
    }

    // Determine period
    const periodStart = entries.length > 0 ? entries[0].entryDate : "";
    const periodEnd = entries.length > 0 ? entries[entries.length - 1].entryDate : "";

    // Opening/closing balance
    const openingBalance = entries.length > 0 && entries[0].balance !== null
        ? Math.round((entries[0].balance - entries[0].amount) * 100) / 100
        : 0;
    const closingBalance = entries.length > 0 && entries[entries.length - 1].balance !== null
        ? entries[entries.length - 1].balance!
        : 0;

    console.log(`[BankParser CSV] Parsed ${entries.length} entries from ${rawLines.length - 1} data rows | Debits: ${totalDebits.toFixed(2)}€ | Credits: ${totalCredits.toFixed(2)}€`);

    return {
        success: entries.length > 0,
        bankName: detectBankFromCSV(text),
        accountNumber: "",
        periodStart,
        periodEnd,
        openingBalance,
        closingBalance,
        totalDebits: Math.round(totalDebits * 100) / 100,
        totalCredits: Math.round(totalCredits * 100) / 100,
        entries,
        rawLineCount: rawLines.length,
        errors,
    };
}

// ====== CSV helper functions ======

function splitCSVLine(line: string, sep: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === sep && !inQuotes) {
            result.push(current);
            current = "";
        } else {
            current += char;
        }
    }
    result.push(current);
    return result;
}

function findCol(headers: string[], names: string[]): number {
    for (const name of names) {
        const idx = headers.findIndex(h =>
            h === name || h.replace(/[^a-z0-9]/g, "") === name.replace(/[^a-z0-9]/g, "")
        );
        if (idx !== -1) return idx;
    }
    return -1;
}

function normalizeDate(raw: string): string {
    // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
    let m = raw.match(/^(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;

    // YYYY-MM-DD
    m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return raw;

    // YYYY/MM/DD
    m = raw.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;

    return "";
}

function parseFrenchNumber(text: string): number {
    if (!text || text.trim() === "") return 0;
    // Remove spaces (thousand separators), remove currency symbols
    let cleaned = text.replace(/\s+/g, "").replace(/[€$£]/g, "").trim();
    // Handle French format: 1.234,56 → 1234.56
    if (cleaned.includes(",") && cleaned.includes(".")) {
        // Determine which is decimal: last separator wins
        const lastComma = cleaned.lastIndexOf(",");
        const lastDot = cleaned.lastIndexOf(".");
        if (lastComma > lastDot) {
            // French: 1.234,56
            cleaned = cleaned.replace(/\./g, "").replace(",", ".");
        } else {
            // English: 1,234.56
            cleaned = cleaned.replace(/,/g, "");
        }
    } else if (cleaned.includes(",")) {
        // Only comma: French decimal
        cleaned = cleaned.replace(",", ".");
    }
    const val = parseFloat(cleaned);
    return isNaN(val) ? 0 : val;
}

function detectBankFromCSV(text: string): string {
    const t = text.toLowerCase();
    if (t.includes("societe generale") || t.includes("société générale") || t.includes("sg ")) return "Société Générale";
    if (t.includes("bnp") || t.includes("paribas")) return "BNP Paribas";
    if (t.includes("crédit agricole") || t.includes("credit agricole") || t.includes("ca ")) return "Crédit Agricole";
    if (t.includes("lcl")) return "LCL";
    if (t.includes("boursorama") || t.includes("bourso")) return "Boursorama";
    if (t.includes("la banque postale")) return "La Banque Postale";
    if (t.includes("crédit mutuel") || t.includes("credit mutuel")) return "Crédit Mutuel";
    if (t.includes("caisse d'épargne") || t.includes("caisse d'epargne")) return "Caisse d'Épargne";
    if (t.includes("hsbc")) return "HSBC";
    return "Banque Principale";
}

function emptyResult(errors: string[]): BankStatementParseResult {
    return {
        success: false,
        bankName: "",
        accountNumber: "",
        periodStart: "",
        periodEnd: "",
        openingBalance: 0,
        closingBalance: 0,
        totalDebits: 0,
        totalCredits: 0,
        entries: [],
        rawLineCount: 0,
        errors,
    };
}
