import * as fs from "fs";
import * as path from "path";
import { PDFDocument, rgb, StandardFonts, degrees } from "pdf-lib";
import { getSmartAI, markOpenAIDown, getGeminiNative } from "./core/openaiClient";

let pdfParseFn: any = null;
let pdfParseLoaded = false;

async function ensurePdfParse(): Promise<void> {
  if (pdfParseLoaded) return;
  try {
    const mod = await import("pdf-parse/lib/pdf-parse.js");
    pdfParseFn = mod.default || mod;
    pdfParseLoaded = true;
  } catch {
    console.warn("[PDFMaster] pdf-parse not available");
  }
}

export interface PDFExtractionResult {
  success: boolean;
  text: string;
  method: "text" | "ocr" | "vision" | "hybrid";
  pages: number;
  confidence: number;
  metadata: Record<string, unknown>;
}

export interface PDFAnalysisResult {
  success: boolean;
  summary: string;
  documentType: string;
  language: string;
  keyData: Record<string, unknown>;
  entities: string[];
  tables?: string[][];
}

export interface PDFEditResult {
  success: boolean;
  outputPath: string;
  fileName: string;
  sizeBytes: number;
}

class PDFMasterService {
  private readonly uploadDir = path.join(process.cwd(), "uploads");
  private readonly generatedDir = path.join(process.cwd(), "generated_files");

  constructor() {
    for (const dir of [this.uploadDir, this.generatedDir]) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
  }

  async extractText(filePath: string): Promise<PDFExtractionResult> {
    const buffer = fs.readFileSync(filePath);
    const pages = await this.countPages(buffer);

    const textResult = await this.extractViaText(buffer);
    if (textResult && textResult.trim().length > 50) {
      return {
        success: true,
        text: textResult,
        method: "text",
        pages,
        confidence: 0.95,
        metadata: { sizeBytes: buffer.length },
      };
    }

    console.log("[PDFMaster] Text extraction insufficient, trying OCR...");
    const ocrResult = await this.extractViaOCR(buffer, filePath);
    if (ocrResult && ocrResult.text.trim().length > 30) {
      return {
        success: true,
        text: ocrResult.text,
        method: "ocr",
        pages,
        confidence: ocrResult.confidence,
        metadata: { sizeBytes: buffer.length, ocrLanguage: "fra+eng" },
      };
    }

    console.log("[PDFMaster] OCR insufficient, trying Vision AI...");
    const visionResult = await this.extractViaVision(buffer, filePath);
    if (visionResult && visionResult.trim().length > 10) {
      return {
        success: true,
        text: visionResult,
        method: "vision",
        pages,
        confidence: 0.85,
        metadata: { sizeBytes: buffer.length, model: "gpt-4o" },
      };
    }

    const combined = [textResult, ocrResult?.text, visionResult]
      .filter(Boolean)
      .join("\n---\n");
    if (combined.trim().length > 0) {
      return {
        success: true,
        text: combined,
        method: "hybrid",
        pages,
        confidence: 0.6,
        metadata: { sizeBytes: buffer.length, note: "Partial extraction" },
      };
    }

    return {
      success: false,
      text: "[Extraction échouée] Impossible de lire le contenu de ce PDF.",
      method: "text",
      pages,
      confidence: 0,
      metadata: { sizeBytes: buffer.length },
    };
  }

  async analyze(filePath: string, question?: string): Promise<PDFAnalysisResult> {
    const extraction = await this.extractText(filePath);
    if (!extraction.success || extraction.text.length < 10) {
      return {
        success: false,
        summary: "Impossible d'extraire le contenu du PDF pour analyse.",
        documentType: "unknown",
        language: "unknown",
        keyData: {},
        entities: [],
      };
    }

    const textSnippet = extraction.text.substring(0, 12000);
    const userPrompt = question
      ? `Analyse ce document PDF et réponds à cette question: "${question}"\n\nContenu:\n${textSnippet}`
      : `Analyse ce document PDF en détail.\n\nContenu:\n${textSnippet}`;

    const systemPrompt = `Tu es un expert en analyse documentaire. Analyse le document fourni et retourne un JSON:
{
  "summary": "Résumé détaillé du document (3-5 phrases)",
  "documentType": "facture|contrat|rapport|lettre|formulaire|technique|juridique|autre",
  "language": "fr|en|...",
  "keyData": { "clé": "valeur" },
  "entities": ["entité1", "entité2"],
  "tables": [["col1","col2"],["val1","val2"]]
}
Extrais toutes les données clés: noms, dates, montants, références, adresses.
Si c'est une facture: fournisseur, montant TTC/HT/TVA, date, numéro.
Si c'est un contrat: parties, objet, durée, montant.
Retourne UNIQUEMENT le JSON.`;

    try {
      const ai = getSmartAI();
      const response = await ai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 3000,
        response_format: { type: "json_object" },
      });

      const raw = response.choices[0]?.message?.content || "{}";
      const parsed = JSON.parse(raw);
      return {
        success: true,
        summary: parsed.summary || "Analyse effectuée",
        documentType: parsed.documentType || "autre",
        language: parsed.language || "fr",
        keyData: parsed.keyData || {},
        entities: parsed.entities || [],
        tables: parsed.tables,
      };
    } catch (err: any) {
      if (err.status === 429 || err.code === "insufficient_quota") {
        markOpenAIDown();
      }
      return await this.analyzeWithGemini(textSnippet, question);
    }
  }

  private async analyzeWithGemini(text: string, question?: string): Promise<PDFAnalysisResult> {
    const gemini = getGeminiNative();
    if (!gemini) {
      return {
        success: false,
        summary: "Aucun provider IA disponible pour l'analyse.",
        documentType: "unknown",
        language: "unknown",
        keyData: {},
        entities: [],
      };
    }

    try {
      const prompt = question
        ? `Analyse ce document PDF et réponds: "${question}"\n\nContenu:\n${text.substring(0, 10000)}\n\nRetourne un JSON avec: summary, documentType, language, keyData, entities.`
        : `Analyse ce document PDF en détail.\n\nContenu:\n${text.substring(0, 10000)}\n\nRetourne un JSON avec: summary, documentType (facture/contrat/rapport/lettre/formulaire/technique/juridique/autre), language, keyData (données clés extraites), entities (personnes/entreprises/lieux).`;

      const result = await gemini.models.generateContent({
        model: "gemini-2.0-flash",
        contents: prompt,
      });

      const raw = (result as any).text?.() || (result as any).candidates?.[0]?.content?.parts?.[0]?.text || "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return { success: true, ...parsed };
      }
      return {
        success: true,
        summary: raw.substring(0, 2000),
        documentType: "autre",
        language: "fr",
        keyData: {},
        entities: [],
      };
    } catch (e) {
      console.error("[PDFMaster] Gemini analysis failed:", e);
      return {
        success: false,
        summary: "Analyse échouée sur tous les providers IA.",
        documentType: "unknown",
        language: "unknown",
        keyData: {},
        entities: [],
      };
    }
  }

  async mergePDFs(filePaths: string[], outputName?: string): Promise<PDFEditResult> {
    const mergedPdf = await PDFDocument.create();

    for (const fp of filePaths) {
      const bytes = fs.readFileSync(fp);
      const srcPdf = await PDFDocument.load(bytes);
      const copiedPages = await mergedPdf.copyPages(srcPdf, srcPdf.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    }

    const fileName = outputName || `merged_${Date.now()}.pdf`;
    const outputPath = path.join(this.generatedDir, fileName);
    const mergedBytes = await mergedPdf.save();
    fs.writeFileSync(outputPath, mergedBytes);

    return {
      success: true,
      outputPath,
      fileName,
      sizeBytes: mergedBytes.length,
    };
  }

  async splitPDF(filePath: string, pageRanges: [number, number][]): Promise<PDFEditResult[]> {
    const srcBytes = fs.readFileSync(filePath);
    const srcPdf = await PDFDocument.load(srcBytes);
    const results: PDFEditResult[] = [];

    for (let i = 0; i < pageRanges.length; i++) {
      const [start, end] = pageRanges[i];
      const newPdf = await PDFDocument.create();
      const indices = [];
      for (let p = start - 1; p < Math.min(end, srcPdf.getPageCount()); p++) {
        indices.push(p);
      }
      const copiedPages = await srcPdf.copyPages(srcPdf, indices);
      copiedPages.forEach((page) => newPdf.addPage(page));

      const fileName = `split_${i + 1}_pages_${start}-${end}_${Date.now()}.pdf`;
      const outputPath = path.join(this.generatedDir, fileName);
      const bytes = await newPdf.save();
      fs.writeFileSync(outputPath, bytes);

      results.push({ success: true, outputPath, fileName, sizeBytes: bytes.length });
    }
    return results;
  }

  async extractPages(filePath: string, pageNumbers: number[]): Promise<PDFEditResult> {
    const srcBytes = fs.readFileSync(filePath);
    const srcPdf = await PDFDocument.load(srcBytes);
    const newPdf = await PDFDocument.create();

    const indices = pageNumbers.map((p) => p - 1).filter((p) => p >= 0 && p < srcPdf.getPageCount());
    const copiedPages = await srcPdf.copyPages(srcPdf, indices);
    copiedPages.forEach((page) => newPdf.addPage(page));

    const fileName = `extracted_pages_${pageNumbers.join("-")}_${Date.now()}.pdf`;
    const outputPath = path.join(this.generatedDir, fileName);
    const bytes = await newPdf.save();
    fs.writeFileSync(outputPath, bytes);

    return { success: true, outputPath, fileName, sizeBytes: bytes.length };
  }

  async addWatermark(filePath: string, text: string, options?: { opacity?: number; angle?: number; fontSize?: number }): Promise<PDFEditResult> {
    const srcBytes = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(srcBytes);
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const opacity = options?.opacity ?? 0.15;
    const angle = options?.angle ?? 45;
    const fontSize = options?.fontSize ?? 60;

    for (const page of pdfDoc.getPages()) {
      const { width, height } = page.getSize();
      const textWidth = font.widthOfTextAtSize(text, fontSize);
      page.drawText(text, {
        x: width / 2 - textWidth / 2,
        y: height / 2,
        size: fontSize,
        font,
        color: rgb(0.7, 0.7, 0.7),
        opacity,
        rotate: degrees(angle),
      });
    }

    const fileName = `watermarked_${Date.now()}.pdf`;
    const outputPath = path.join(this.generatedDir, fileName);
    const bytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, bytes);

    return { success: true, outputPath, fileName, sizeBytes: bytes.length };
  }

  async addText(filePath: string, additions: Array<{ page: number; text: string; x: number; y: number; fontSize?: number; color?: { r: number; g: number; b: number } }>): Promise<PDFEditResult> {
    const srcBytes = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(srcBytes);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();

    for (const add of additions) {
      const pageIndex = add.page - 1;
      if (pageIndex >= 0 && pageIndex < pages.length) {
        const c = add.color || { r: 0, g: 0, b: 0 };
        pages[pageIndex].drawText(add.text, {
          x: add.x,
          y: add.y,
          size: add.fontSize || 12,
          font,
          color: rgb(c.r / 255, c.g / 255, c.b / 255),
        });
      }
    }

    const fileName = `edited_${Date.now()}.pdf`;
    const outputPath = path.join(this.generatedDir, fileName);
    const bytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, bytes);

    return { success: true, outputPath, fileName, sizeBytes: bytes.length };
  }

  async getInfo(filePath: string): Promise<Record<string, unknown>> {
    const buffer = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];

    return {
      pageCount: pdfDoc.getPageCount(),
      title: pdfDoc.getTitle() || null,
      author: pdfDoc.getAuthor() || null,
      subject: pdfDoc.getSubject() || null,
      creator: pdfDoc.getCreator() || null,
      producer: pdfDoc.getProducer() || null,
      creationDate: pdfDoc.getCreationDate()?.toISOString() || null,
      modificationDate: pdfDoc.getModificationDate()?.toISOString() || null,
      firstPageSize: firstPage ? { width: firstPage.getWidth(), height: firstPage.getHeight() } : null,
      sizeBytes: buffer.length,
      sizeMB: +(buffer.length / 1024 / 1024).toFixed(2),
    };
  }

  async rotatePage(filePath: string, pageNumber: number, angle: 0 | 90 | 180 | 270): Promise<PDFEditResult> {
    const srcBytes = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(srcBytes);
    const pages = pdfDoc.getPages();
    const idx = pageNumber - 1;
    if (idx >= 0 && idx < pages.length) {
      pages[idx].setRotation(degrees(angle));
    }
    const fileName = `rotated_${Date.now()}.pdf`;
    const outputPath = path.join(this.generatedDir, fileName);
    const bytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, bytes);
    return { success: true, outputPath, fileName, sizeBytes: bytes.length };
  }

  async compress(filePath: string): Promise<PDFEditResult> {
    const srcBytes = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(srcBytes);

    const fileName = `compressed_${Date.now()}.pdf`;
    const outputPath = path.join(this.generatedDir, fileName);
    const bytes = await pdfDoc.save({ useObjectStreams: true });
    fs.writeFileSync(outputPath, bytes);

    const ratio = ((1 - bytes.length / srcBytes.length) * 100).toFixed(1);
    console.log(`[PDFMaster] Compressed: ${srcBytes.length} → ${bytes.length} bytes (${ratio}% reduction)`);

    return { success: true, outputPath, fileName, sizeBytes: bytes.length };
  }

  async convertPageToImage(filePath: string, pageNumber: number = 1): Promise<string | null> {
    try {
      const { execSync } = await import("child_process");
      const tmpOutput = path.join("/tmp", `pdf_page_${Date.now()}`);
      execSync(`pdftoppm -png -f ${pageNumber} -l ${pageNumber} -r 200 "${filePath}" "${tmpOutput}"`, { timeout: 15000 });

      const possibleFiles = [
        `${tmpOutput}-${String(pageNumber).padStart(1, "0")}.png`,
        `${tmpOutput}-${String(pageNumber).padStart(2, "0")}.png`,
        `${tmpOutput}-${String(pageNumber).padStart(3, "0")}.png`,
        `${tmpOutput}-1.png`,
        `${tmpOutput}-01.png`,
      ];

      for (const f of possibleFiles) {
        if (fs.existsSync(f)) return f;
      }

      const dir = fs.readdirSync("/tmp").filter((f) => f.startsWith(path.basename(tmpOutput)));
      if (dir.length > 0) return path.join("/tmp", dir[0]);

      return null;
    } catch (e) {
      console.warn("[PDFMaster] pdftoppm not available:", (e as Error).message);
      return null;
    }
  }

  private async extractViaText(buffer: Buffer): Promise<string | null> {
    await ensurePdfParse();
    if (!pdfParseFn) return null;
    try {
      const result = await pdfParseFn(buffer);
      return result.text || null;
    } catch (e) {
      console.warn("[PDFMaster] pdf-parse failed:", (e as Error).message);
      return null;
    }
  }

  private async extractViaOCR(buffer: Buffer, filePath: string): Promise<{ text: string; confidence: number } | null> {
    try {
      const imagePath = await this.convertPageToImage(filePath, 1);
      if (!imagePath) {
        console.warn("[PDFMaster] Cannot convert PDF to image for OCR (pdftoppm missing)");
        return null;
      }

      const Tesseract = (await import("tesseract.js")).default;
      const worker = await Tesseract.createWorker("fra+eng");
      const { data } = await worker.recognize(imagePath);
      await worker.terminate();

      try { fs.unlinkSync(imagePath); } catch {}

      if (data.text && data.text.trim().length > 10) {
        return { text: data.text, confidence: data.confidence / 100 };
      }
      return null;
    } catch (e) {
      console.warn("[PDFMaster] OCR failed:", (e as Error).message);
      return null;
    }
  }

  private async extractViaVision(buffer: Buffer, filePath: string): Promise<string | null> {
    let imageBase64: string | null = null;

    const imagePath = await this.convertPageToImage(filePath, 1);
    if (imagePath) {
      imageBase64 = fs.readFileSync(imagePath).toString("base64");
      try { fs.unlinkSync(imagePath); } catch {}
    } else {
      imageBase64 = buffer.toString("base64");
    }

    try {
      const ai = getSmartAI();
      const response = await ai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "Tu es un expert en extraction de texte. Extrais TOUT le texte visible dans cette image de document PDF. Retourne le texte brut tel quel, sans reformulation.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Extrais tout le texte de ce document." },
              {
                type: "image_url",
                image_url: {
                  url: imagePath
                    ? `data:image/png;base64,${imageBase64}`
                    : `data:application/pdf;base64,${imageBase64}`,
                },
              },
            ],
          },
        ],
        max_tokens: 4000,
        temperature: 0,
      });

      return response.choices[0]?.message?.content || null;
    } catch (err: any) {
      if (err.status === 429 || err.code === "insufficient_quota") {
        markOpenAIDown();
      }
      console.warn("[PDFMaster] Vision extraction failed:", err.message);

      return await this.extractViaGeminiVision(buffer, filePath);
    }
  }

  private async extractViaGeminiVision(buffer: Buffer, filePath: string): Promise<string | null> {
    const gemini = getGeminiNative();
    if (!gemini) return null;

    try {
      let imageBase64: string;
      let mimeType: string;

      const imagePath = await this.convertPageToImage(filePath, 1);
      if (imagePath) {
        imageBase64 = fs.readFileSync(imagePath).toString("base64");
        mimeType = "image/png";
        try { fs.unlinkSync(imagePath); } catch {}
      } else {
        imageBase64 = buffer.toString("base64");
        mimeType = "application/pdf";
      }

      const result = await gemini.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [
          {
            role: "user",
            parts: [
              { text: "Extrais TOUT le texte visible dans ce document. Retourne uniquement le texte brut." },
              { inlineData: { data: imageBase64, mimeType } },
            ],
          },
        ],
      });

      const text = (result as any).text?.() || (result as any).candidates?.[0]?.content?.parts?.[0]?.text || "";
      return text || null;
    } catch (e) {
      console.warn("[PDFMaster] Gemini vision failed:", (e as Error).message);
      return null;
    }
  }

  private async countPages(buffer: Buffer): Promise<number> {
    try {
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      return pdfDoc.getPageCount();
    } catch {
      await ensurePdfParse();
      if (pdfParseFn) {
        try {
          const r = await pdfParseFn(buffer);
          return r.numpages || 1;
        } catch {}
      }
      return 1;
    }
  }
}

export const pdfMasterService = new PDFMasterService();
