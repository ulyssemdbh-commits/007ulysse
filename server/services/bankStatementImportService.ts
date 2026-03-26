import OpenAI from "openai";
import { db } from "../db";
import { sql } from "drizzle-orm";

const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY });

interface ParsedBankEntry {
  date: string;
  label: string;
  amount: number;
  category: string;
  matchedSupplier: string;
  confidence: number;
  originalLine: string;
}

interface ImportPreview {
  entries: ParsedBankEntry[];
  summary: {
    totalCredits: number;
    totalDebits: number;
    entryCount: number;
    categorized: number;
    uncategorized: number;
  };
  restaurant: string;
}

interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  errors: string[];
}

const KNOWN_SUPPLIERS: Record<string, { category: string; normalized: string }> = {
  "metro": { category: "achat_fournisseur", normalized: "Metro" },
  "brake": { category: "achat_fournisseur", normalized: "Brake" },
  "promocash": { category: "achat_fournisseur", normalized: "Promocash" },
  "transgourmet": { category: "achat_fournisseur", normalized: "Transgourmet" },
  "davigel": { category: "achat_fournisseur", normalized: "Davigel" },
  "orange": { category: "telecom", normalized: "Orange" },
  "sfr": { category: "telecom", normalized: "SFR" },
  "bouygues": { category: "telecom", normalized: "Bouygues" },
  "edf": { category: "energie", normalized: "EDF" },
  "engie": { category: "energie", normalized: "Engie" },
  "suez": { category: "eau", normalized: "Suez" },
  "veolia": { category: "eau", normalized: "Veolia" },
  "deliveroo": { category: "plateforme", normalized: "Deliveroo" },
  "uber eats": { category: "plateforme", normalized: "Uber Eats" },
  "just eat": { category: "plateforme", normalized: "Just Eat" },
  "sumup": { category: "encaissement_cb", normalized: "SumUp" },
  "zettle": { category: "encaissement_cb", normalized: "Zettle" },
  "loyer": { category: "loyer", normalized: "Loyer" },
  "assurance": { category: "assurance", normalized: "Assurance" },
  "axa": { category: "assurance", normalized: "AXA" },
  "maif": { category: "assurance", normalized: "MAIF" },
  "urssaf": { category: "salaire", normalized: "URSSAF" },
  "cpam": { category: "salaire", normalized: "CPAM" },
  "salaire": { category: "salaire", normalized: "Salaire" },
  "vir": { category: "virement", normalized: "Virement" }
};

function matchSupplier(label: string): { category: string; supplier: string; confidence: number } {
  const lower = label.toLowerCase();
  for (const [key, val] of Object.entries(KNOWN_SUPPLIERS)) {
    if (lower.includes(key)) {
      return { category: val.category, supplier: val.normalized, confidence: 0.9 };
    }
  }
  return { category: "autre", supplier: "", confidence: 0.3 };
}

function parseCSVContent(content: string): { headers: string[]; rows: string[][] } {
  const lines = content.split("\n").filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  const separator = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(separator).map(h => h.trim().replace(/"/g, ""));
  const rows = lines.slice(1).map(line => {
    const cols: string[] = [];
    let inQuote = false;
    let current = "";
    for (const char of line) {
      if (char === '"') { inQuote = !inQuote; continue; }
      if (char === separator[0] && !inQuote) { cols.push(current.trim()); current = ""; continue; }
      current += char;
    }
    cols.push(current.trim());
    return cols;
  });

  return { headers, rows };
}

function detectColumns(headers: string[]): { dateCol: number; labelCol: number; amountCol: number; debitCol: number; creditCol: number } {
  const lower = headers.map(h => h.toLowerCase());
  
  let dateCol = lower.findIndex(h => h.includes("date") && !h.includes("valeur"));
  if (dateCol === -1) dateCol = lower.findIndex(h => h.includes("date"));
  if (dateCol === -1) dateCol = 0;

  let labelCol = lower.findIndex(h => h.includes("libellé") || h.includes("libelle") || h.includes("label") || h.includes("description") || h.includes("intitulé"));
  if (labelCol === -1) labelCol = 1;

  let amountCol = lower.findIndex(h => h.includes("montant") || h.includes("amount") || h.includes("somme"));
  let debitCol = lower.findIndex(h => h.includes("débit") || h.includes("debit"));
  let creditCol = lower.findIndex(h => h.includes("crédit") || h.includes("credit"));

  if (amountCol === -1 && debitCol === -1) {
    amountCol = lower.length > 2 ? 2 : -1;
  }

  return { dateCol, labelCol, amountCol, debitCol, creditCol };
}

function parseDate(dateStr: string): string {
  const trimmed = dateStr.replace(/"/g, "").trim();
  
  const ddmmyyyy = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, "0")}-${ddmmyyyy[1].padStart(2, "0")}`;

  const yyyymmdd = trimmed.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/);
  if (yyyymmdd) return `${yyyymmdd[1]}-${yyyymmdd[2].padStart(2, "0")}-${yyyymmdd[3].padStart(2, "0")}`;

  return trimmed;
}

function parseAmount(str: string): number {
  const cleaned = str.replace(/"/g, "").replace(/\s/g, "").replace(/€/g, "").replace(/,/g, ".").trim();
  return parseFloat(cleaned) || 0;
}

export async function parseCSVBankStatement(
  csvContent: string,
  restaurant: "suguval" | "sugumaillane"
): Promise<ImportPreview> {
  const { headers, rows } = parseCSVContent(csvContent);
  const cols = detectColumns(headers);
  const entries: ParsedBankEntry[] = [];

  for (const row of rows) {
    if (row.length < 2) continue;

    const dateStr = row[cols.dateCol] || "";
    const label = row[cols.labelCol] || "";
    let amount = 0;

    if (cols.amountCol >= 0 && row[cols.amountCol]) {
      amount = parseAmount(row[cols.amountCol]);
    } else if (cols.debitCol >= 0 || cols.creditCol >= 0) {
      const debit = cols.debitCol >= 0 ? parseAmount(row[cols.debitCol] || "0") : 0;
      const credit = cols.creditCol >= 0 ? parseAmount(row[cols.creditCol] || "0") : 0;
      amount = credit > 0 ? credit : -Math.abs(debit);
    }

    if (!label && !amount) continue;

    const match = matchSupplier(label);
    entries.push({
      date: parseDate(dateStr),
      label: label,
      amount,
      category: match.category,
      matchedSupplier: match.supplier,
      confidence: match.confidence,
      originalLine: row.join(" | ")
    });
  }

  const totalCredits = entries.filter(e => e.amount > 0).reduce((sum, e) => sum + e.amount, 0);
  const totalDebits = entries.filter(e => e.amount < 0).reduce((sum, e) => sum + Math.abs(e.amount), 0);
  const categorized = entries.filter(e => e.confidence > 0.5).length;

  return {
    entries,
    summary: {
      totalCredits,
      totalDebits,
      entryCount: entries.length,
      categorized,
      uncategorized: entries.length - categorized
    },
    restaurant
  };
}

export async function enhanceCategoriesWithAI(preview: ImportPreview): Promise<ImportPreview> {
  const uncategorized = preview.entries.filter(e => e.confidence < 0.6);
  if (uncategorized.length === 0) return preview;

  try {
    const lines = uncategorized.map((e, i) => `${i}: "${e.label}" (${e.amount}€)`).join("\n");
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Tu es un comptable expert en restauration. Catégorise chaque écriture bancaire.
Catégories possibles: encaissement_cb, plateforme, achat_fournisseur, loyer, salaire, energie, telecom, eau, assurance, virement, prelevement, autre.
Retourne un JSON: [{"index": 0, "category": "...", "supplier": "Nom normalisé", "confidence": 0.8}]`
        },
        { role: "user", content: `Catégorise ces écritures bancaires d'un restaurant:\n${lines}` }
      ],
      max_tokens: 1500,
      temperature: 0.1
    });

    const content = response.choices[0]?.message?.content || "";
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      let categorizations: any[] = [];
      try { categorizations = JSON.parse(jsonMatch[0]); } catch { console.warn("[BankImport] Failed to parse AI categorization response"); }
      for (const cat of categorizations) {
        const entry = uncategorized[cat.index];
        if (entry) {
          entry.category = cat.category || entry.category;
          entry.matchedSupplier = cat.supplier || entry.matchedSupplier;
          entry.confidence = Math.max(entry.confidence, cat.confidence || 0.7);
        }
      }
    }
  } catch (e: any) {
    console.error("[BankImport] AI categorization error:", e.message);
  }

  return preview;
}

export async function confirmAndImport(
  preview: ImportPreview,
  selectedIndices?: number[]
): Promise<ImportResult> {
  const entries = selectedIndices 
    ? preview.entries.filter((_, i) => selectedIndices.includes(i))
    : preview.entries;

  const bankTable = preview.restaurant === "suguval" ? sql.raw("sugu_bank") : sql.raw("sugum_bank");
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const entry of entries) {
    try {
      const existing = await db.execute(sql`
        SELECT id FROM ${bankTable}
        WHERE entry_date = ${entry.date} AND amount = ${entry.amount} AND label = ${entry.label}
        LIMIT 1
      `);

      if (existing.rows.length > 0) {
        skipped++;
        continue;
      }

      await db.execute(sql`
        INSERT INTO ${bankTable} (label, amount, entry_date, category, bank_name, notes, user_id)
        VALUES (${entry.label}, ${entry.amount}, ${entry.date}, ${entry.category}, ${"Import CSV"}, ${entry.matchedSupplier ? `Fournisseur: ${entry.matchedSupplier}` : "Import automatique"}, 1)
      `);
      imported++;
    } catch (e: any) {
      errors.push(`${entry.label}: ${e.message}`);
    }
  }

  console.log(`[BankImport] Done: ${imported} imported, ${skipped} skipped, ${errors.length} errors`);
  return { success: errors.length === 0, imported, skipped, errors };
}

export async function parsePDFBankStatement(
  base64Content: string,
  restaurant: "suguval" | "sugumaillane"
): Promise<ImportPreview> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `Tu es un expert comptable. Extrais TOUTES les écritures bancaires de ce relevé PDF.
Retourne un JSON strict: {"entries": [{"date": "YYYY-MM-DD", "label": "...", "amount": -123.45}]}
Les débits sont négatifs, les crédits positifs. La date au format YYYY-MM-DD.`
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extrais toutes les écritures de ce relevé bancaire." },
            { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64Content}` } }
          ]
        }
      ],
      max_tokens: 4000,
      temperature: 0.1
    });

    const content = response.choices[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { entries: [], summary: { totalCredits: 0, totalDebits: 0, entryCount: 0, categorized: 0, uncategorized: 0 }, restaurant };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const entries: ParsedBankEntry[] = (parsed.entries || []).map((e: any) => {
      const match = matchSupplier(e.label || "");
      return {
        date: e.date || "",
        label: e.label || "",
        amount: Number(e.amount) || 0,
        category: match.category,
        matchedSupplier: match.supplier,
        confidence: match.confidence,
        originalLine: `${e.date} | ${e.label} | ${e.amount}`
      };
    });

    const totalCredits = entries.filter(e => e.amount > 0).reduce((sum, e) => sum + e.amount, 0);
    const totalDebits = entries.filter(e => e.amount < 0).reduce((sum, e) => sum + Math.abs(e.amount), 0);
    const categorized = entries.filter(e => e.confidence > 0.5).length;

    return {
      entries,
      summary: { totalCredits, totalDebits, entryCount: entries.length, categorized, uncategorized: entries.length - categorized },
      restaurant
    };
  } catch (e: any) {
    console.error("[BankImport] PDF parse error:", e.message);
    return { entries: [], summary: { totalCredits: 0, totalDebits: 0, entryCount: 0, categorized: 0, uncategorized: 0 }, restaurant };
  }
}

export const bankStatementImportService = {
  parseCSV: parseCSVBankStatement,
  parsePDF: parsePDFBankStatement,
  enhanceWithAI: enhanceCategoriesWithAI,
  confirmImport: confirmAndImport,
  matchSupplier
};
