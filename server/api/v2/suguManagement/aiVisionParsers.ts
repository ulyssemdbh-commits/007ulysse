import { ParsedDocumentData, detectBufferMimeType } from "./documentParsers";

export async function parseDocumentWithAI(pdfText: string, filename?: string, knowledgeHints?: string): Promise<Partial<ParsedDocumentData> | null> {
    const { getGeminiNativeRequired } = await import("../../../services/core/openaiClient");
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

export async function parseDocumentWithGPT4oVision(pdfBuffer: Buffer, filename?: string, knowledgeHints?: string): Promise<Partial<ParsedDocumentData> | null> {
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

export async function parseDocumentWithAIVision(pdfBuffer: Buffer, filename?: string, knowledgeHints?: string): Promise<Partial<ParsedDocumentData> | null> {
    const { getGeminiNativeRequired } = await import("../../../services/core/openaiClient");
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

