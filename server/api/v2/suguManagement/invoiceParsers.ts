import { ParsedDocumentData, extractAmountFromFilename, extractSupplierFromFilename, resolveSupplierFromFilename, getPdfParse, cleanPdfText, detectBufferMimeType, PAYMENT_KEYWORDS, CATEGORY_KEYWORDS } from "./documentParsers";
import { parseDocumentWithAI, parseDocumentWithGPT4oVision, parseDocumentWithAIVision } from "./aiVisionParsers";
import { getKnowledgePromptHints, overrideCategoryFromKnowledge } from "../../../services/suguLearningService";

export async function parseDocumentPDF(buffer: Buffer, filename?: string, restaurant: "val" | "maillane" = "val"): Promise<ParsedDocumentData> {
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
    {
        let aiResult: Partial<ParsedDocumentData> | null = null;

        if (pdfTextExtracted) {
            try {
                aiResult = await parseDocumentWithAI(text, filename, knowledgeHints);
            } catch (e: any) {
                console.warn(`[SUGU] Gemini text extraction failed: ${e?.message}`);
            }
        }

        if (!aiResult || !(aiResult.supplier && typeof aiResult.amount === "number" && aiResult.amount !== 0)) {
            try {
                console.log(`[SUGU] Text-based AI ${pdfTextExtracted ? "incomplete" : "skipped (no text)"}, trying GPT-4o vision...`);
                aiResult = await parseDocumentWithGPT4oVision(buffer, filename, knowledgeHints);
            } catch (e: any) {
                console.warn(`[SUGU] GPT-4o vision failed: ${e?.message}`);
            }
        }

        if (!aiResult || !(aiResult.supplier && typeof aiResult.amount === "number" && aiResult.amount !== 0)) {
            try {
                console.log(`[SUGU] GPT-4o vision incomplete, falling back to Gemini vision...`);
                aiResult = await parseDocumentWithAIVision(buffer, filename, knowledgeHints);
            } catch (e: any) {
                console.warn(`[SUGU] Gemini vision failed: ${e?.message}`);
            }
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

        if (!aiSuccess) {
            console.warn(`[SUGU] All AI extraction methods failed, using regex fallback`);
        }
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

export async function parseMultiInvoicePDF(buffer: Buffer, filename?: string): Promise<ParsedDocumentData[]> {
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
        const { getGeminiNativeRequired } = await import("../../../services/core/openaiClient");
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
