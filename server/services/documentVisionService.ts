import OpenAI from "openai";
import { db } from "../db";
import { sql } from "drizzle-orm";

const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY });

interface ExtractedInvoiceData {
  type: "invoice" | "receipt" | "statement" | "other";
  supplier: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  amount: number;
  taxAmount: number;
  currency: string;
  items: { description: string; quantity: number; unitPrice: number; total: number }[];
  paymentMethod: string;
  category: string;
  confidence: number;
  rawText: string;
}

interface VisionResult {
  success: boolean;
  data?: ExtractedInvoiceData;
  error?: string;
  autoFiled?: { restaurant: string; table: string; id: number };
}

export async function analyzeDocumentImage(
  imageBase64: string,
  mimeType: string = "image/jpeg",
  context?: string
): Promise<VisionResult> {
  try {
    const systemPrompt = `Tu es un expert comptable français. Analyse cette image de document (facture, ticket de caisse, relevé) et extrais TOUTES les informations financières.

Retourne un JSON STRICT avec cette structure:
{
  "type": "invoice" | "receipt" | "statement" | "other",
  "supplier": "Nom du fournisseur",
  "invoiceNumber": "Numéro facture",
  "invoiceDate": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD ou vide",
  "amount": 123.45,
  "taxAmount": 12.34,
  "currency": "EUR",
  "items": [{"description": "...", "quantity": 1, "unitPrice": 10.0, "total": 10.0}],
  "paymentMethod": "CB/virement/chèque/espèces",
  "category": "alimentaire/boissons/emballages/consommables/equipement/energie/telecom/loyer/assurance/autre",
  "confidence": 0.95,
  "rawText": "texte brut extrait du document"
}

RÈGLES:
- Les montants sont toujours en décimal (ex: 123.45, pas "123,45€")
- Si TVA non visible, mets 0
- Si Deliveroo/Uber Eats/Just Eat: c'est un relevé de plateforme, taxAmount=0
- La date au format YYYY-MM-DD
- confidence entre 0 et 1
- Catégorise intelligemment selon le fournisseur (Metro=alimentaire, Orange=telecom, EDF=energie, etc.)`;

    const userPrompt = context 
      ? `Analyse ce document. Contexte additionnel: ${context}` 
      : "Analyse ce document et extrais toutes les données financières.";

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } }
          ]
        }
      ],
      max_tokens: 2000,
      temperature: 0.1
    });

    const content = response.choices[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, error: "Impossible d'extraire les données du document" };
    }

    const data: ExtractedInvoiceData = JSON.parse(jsonMatch[0]);
    
    if (data.taxAmount > data.amount) {
      data.taxAmount = 0;
    }

    return { success: true, data };
  } catch (e: any) {
    console.error("[DocumentVision] Error:", e.message);
    return { success: false, error: e.message };
  }
}

export async function analyzeAndAutoFile(
  imageBase64: string,
  mimeType: string,
  restaurant: "suguval" | "sugumaillane",
  fileAs: "purchase" | "expense" | "auto" = "auto"
): Promise<VisionResult> {
  const result = await analyzeDocumentImage(imageBase64, mimeType, `Restaurant: ${restaurant}`);
  if (!result.success || !result.data) return result;

  const data = result.data;
  let targetType = fileAs;
  if (targetType === "auto") {
    const expenseCategories = ["energie", "telecom", "loyer", "assurance", "entretien"];
    targetType = expenseCategories.includes(data.category) ? "expense" : "purchase";
  }

  try {
    const prefix = restaurant === "suguval" ? "sugu" : "sugum";

    if (targetType === "purchase") {
      const insertResult = await db.execute(sql`
        INSERT INTO ${sql.raw(`${prefix}_purchases`)} (supplier, description, category, amount, tax_amount, invoice_number, invoice_date, due_date, payment_method, notes, user_id)
        VALUES (${data.supplier}, ${data.items.map(i => i.description).join(", ")}, ${data.category}, ${data.amount}, ${data.taxAmount}, ${data.invoiceNumber}, ${data.invoiceDate || null}, ${data.dueDate || null}, ${data.paymentMethod}, ${"Auto-filed by Document Vision"}, 1)
        RETURNING id
      `);
      result.autoFiled = { restaurant, table: `${prefix}_purchases`, id: Number(insertResult.rows[0]?.id) };
    } else {
      const insertResult = await db.execute(sql`
        INSERT INTO ${sql.raw(`${prefix}_expenses`)} (label, category, description, amount, tax_amount, due_date, payment_method, notes, user_id)
        VALUES (${data.supplier}, ${data.category}, ${data.items.map(i => i.description).join(", ")}, ${data.amount}, ${data.taxAmount}, ${data.dueDate || null}, ${data.paymentMethod}, ${"Auto-filed by Document Vision"}, 1)
        RETURNING id
      `);
      result.autoFiled = { restaurant, table: `${prefix}_expenses`, id: Number(insertResult.rows[0]?.id) };
    }

    console.log(`[DocumentVision] Auto-filed to ${result.autoFiled.table} #${result.autoFiled.id}`);
  } catch (e: any) {
    console.error("[DocumentVision] Auto-file failed:", e.message);
  }

  return result;
}

export async function analyzeMultipleDocuments(
  documents: { base64: string; mimeType: string; fileName: string }[]
): Promise<{ results: (VisionResult & { fileName: string })[] }> {
  const results = await Promise.allSettled(
    documents.map(async (doc) => {
      const result = await analyzeDocumentImage(doc.base64, doc.mimeType);
      return { ...result, fileName: doc.fileName };
    })
  );

  return {
    results: results.map((r, i) => {
      if (r.status === "fulfilled") return r.value;
      return { success: false, error: String(r.reason), fileName: documents[i].fileName };
    })
  };
}

export const documentVisionService = {
  analyzeDocumentImage,
  analyzeAndAutoFile,
  analyzeMultipleDocuments
};
