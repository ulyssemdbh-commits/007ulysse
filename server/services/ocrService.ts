/**
 * OCR Service - Tesseract.js pour extraction de texte
 * Analyse factures, tickets, documents
 */

import Tesseract from "tesseract.js";

interface OcrResult {
  success: boolean;
  text: string;
  confidence: number;
  lines: string[];
  words: { text: string; confidence: number }[];
  processingTime: number;
  language: string;
}

interface InvoiceData {
  vendor?: string;
  date?: string;
  total?: number;
  items: { name: string; quantity?: number; price?: number }[];
  raw: string;
}

interface DocumentAnalysis {
  type: "invoice" | "receipt" | "menu" | "list" | "unknown";
  confidence: number;
  extractedData: InvoiceData | Record<string, unknown>;
  summary: string;
}

class OcrService {
  private worker: Tesseract.Worker | null = null;
  private isInitializing = false;

  private async getWorker(): Promise<Tesseract.Worker> {
    if (this.worker) return this.worker;

    if (this.isInitializing) {
      // Wait for existing initialization
      while (this.isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (this.worker) return this.worker;
    }

    this.isInitializing = true;
    try {
      console.log("[OCR] Initializing Tesseract worker...");
      this.worker = await Tesseract.createWorker('fra+eng');
      console.log("[OCR] Worker ready");
      return this.worker;
    } finally {
      this.isInitializing = false;
    }
  }

  async extractText(imageInput: string | Buffer, language: string = "fra+eng"): Promise<OcrResult> {
    const startTime = Date.now();

    try {
      const worker = await this.getWorker();
      
      let input: string | Buffer = imageInput;
      
      // Handle base64 data URLs
      if (typeof imageInput === 'string' && imageInput.startsWith('data:')) {
        input = imageInput;
      }

      const { data } = await worker.recognize(input);

      const processingTime = Date.now() - startTime;

      return {
        success: true,
        text: data.text,
        confidence: data.confidence,
        lines: data.lines?.map(l => l.text) || data.text.split('\n'),
        words: data.words?.map(w => ({ text: w.text, confidence: w.confidence })) || [],
        processingTime,
        language
      };
    } catch (error) {
      console.error("[OCR] Extraction error:", error);
      return {
        success: false,
        text: "",
        confidence: 0,
        lines: [],
        words: [],
        processingTime: Date.now() - startTime,
        language
      };
    }
  }

  async analyzeDocument(imageInput: string | Buffer): Promise<DocumentAnalysis> {
    const ocrResult = await this.extractText(imageInput);

    if (!ocrResult.success || !ocrResult.text.trim()) {
      return {
        type: "unknown",
        confidence: 0,
        extractedData: { items: [], raw: "" },
        summary: "Impossible d'extraire le texte du document"
      };
    }

    const text = ocrResult.text.toLowerCase();
    const lines = ocrResult.lines;

    // Detect document type
    let type: DocumentAnalysis["type"] = "unknown";
    let confidence = ocrResult.confidence / 100;

    if (this.looksLikeInvoice(text)) {
      type = "invoice";
    } else if (this.looksLikeReceipt(text)) {
      type = "receipt";
    } else if (this.looksLikeMenu(text)) {
      type = "menu";
    } else if (this.looksLikeList(text)) {
      type = "list";
    }

    // Extract structured data based on type
    let extractedData: DocumentAnalysis["extractedData"];
    let summary: string;

    switch (type) {
      case "invoice":
      case "receipt":
        extractedData = this.extractInvoiceData(ocrResult.text, lines);
        summary = this.summarizeInvoice(extractedData as InvoiceData);
        break;
      case "menu":
        extractedData = this.extractMenuData(lines);
        summary = `Menu détecté avec ${(extractedData as any).items?.length || 0} plats`;
        break;
      case "list":
        extractedData = { items: lines.filter(l => l.trim()), raw: ocrResult.text };
        summary = `Liste de ${lines.filter(l => l.trim()).length} éléments`;
        break;
      default:
        extractedData = { items: [], raw: ocrResult.text };
        summary = `Document de ${ocrResult.text.length} caractères`;
    }

    return {
      type,
      confidence,
      extractedData,
      summary
    };
  }

  private looksLikeInvoice(text: string): boolean {
    const invoiceKeywords = ['facture', 'invoice', 'total', 'tva', 'ht', 'ttc', 'montant', 'échéance'];
    return invoiceKeywords.some(kw => text.includes(kw));
  }

  private looksLikeReceipt(text: string): boolean {
    const receiptKeywords = ['ticket', 'caisse', 'reçu', 'espèces', 'cb', 'carte', 'rendu'];
    return receiptKeywords.some(kw => text.includes(kw));
  }

  private looksLikeMenu(text: string): boolean {
    const menuKeywords = ['entrée', 'plat', 'dessert', 'menu', 'formule', 'carte'];
    return menuKeywords.some(kw => text.includes(kw));
  }

  private looksLikeList(text: string): boolean {
    const lines = text.split('\n').filter(l => l.trim());
    // A list typically has many short lines
    const avgLineLength = lines.reduce((sum, l) => sum + l.length, 0) / lines.length;
    return lines.length > 3 && avgLineLength < 50;
  }

  private extractInvoiceData(text: string, lines: string[]): InvoiceData {
    const data: InvoiceData = {
      items: [],
      raw: text
    };

    // Extract vendor (usually first lines)
    for (const line of lines.slice(0, 3)) {
      if (line.trim() && !line.match(/\d{2}\/\d{2}\/\d{4}/)) {
        data.vendor = line.trim();
        break;
      }
    }

    // Extract date
    const dateMatch = text.match(/(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{2,4})/);
    if (dateMatch) {
      data.date = dateMatch[1];
    }

    // Extract total
    const totalMatch = text.match(/total[^\d]*(\d+[,\.]\d{2})/i);
    if (totalMatch) {
      data.total = parseFloat(totalMatch[1].replace(',', '.'));
    }

    // Extract line items (lines with prices)
    const pricePattern = /(.+?)\s+(\d+[,\.]\d{2})\s*€?/;
    for (const line of lines) {
      const match = line.match(pricePattern);
      if (match) {
        data.items.push({
          name: match[1].trim(),
          price: parseFloat(match[2].replace(',', '.'))
        });
      }
    }

    return data;
  }

  private extractMenuData(lines: string[]): { items: { name: string; price?: number; category?: string }[] } {
    const items: { name: string; price?: number; category?: string }[] = [];
    let currentCategory = "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Check if it's a category header
      if (trimmed.match(/^(entrée|plat|dessert|boisson|menu|formule)/i)) {
        currentCategory = trimmed;
        continue;
      }

      // Extract item with optional price
      const priceMatch = trimmed.match(/(.+?)\s+(\d+[,\.]\d{2})\s*€?$/);
      if (priceMatch) {
        items.push({
          name: priceMatch[1].trim(),
          price: parseFloat(priceMatch[2].replace(',', '.')),
          category: currentCategory || undefined
        });
      } else if (trimmed.length > 3) {
        items.push({
          name: trimmed,
          category: currentCategory || undefined
        });
      }
    }

    return { items };
  }

  private summarizeInvoice(data: InvoiceData): string {
    const parts: string[] = [];

    if (data.vendor) {
      parts.push(`Fournisseur: ${data.vendor}`);
    }
    if (data.date) {
      parts.push(`Date: ${data.date}`);
    }
    if (data.total !== undefined) {
      parts.push(`Total: ${data.total.toFixed(2)}€`);
    }
    if (data.items.length > 0) {
      parts.push(`${data.items.length} article(s)`);
    }

    return parts.length > 0 ? parts.join(' | ') : "Document analysé";
  }

  async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }
}

export const ocrService = new OcrService();
