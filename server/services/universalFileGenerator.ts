/**
 * UNIVERSAL FILE GENERATOR V1 - Génération de fichiers tous formats pour Ulysse
 * 
 * Capacités:
 * - PDF: Rapports, factures, documents formatés
 * - Excel: Tableaux, analyses, exports
 * - Word: Documents texte structurés
 * - CSV: Exports de données
 * - JSON: Données structurées
 * - Images: Via intégration génération AI
 * 
 * Performance:
 * - Cache intelligent
 * - Parallélisation des tâches
 * - Modèles optimisés (gpt-4o-mini)
 */

import * as fs from "fs";
import * as path from "path";
import ExcelJS from "exceljs";
import OpenAI from "openai";
let PDFDocument: any = null;
async function getPDFDocument() {
  if (!PDFDocument) {
    const mod = await import("pdfkit");
    PDFDocument = mod.default;
  }
  return PDFDocument;
}

// Use AI Integrations for Replit Core compatibility
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// Répertoire de sortie pour les fichiers générés (même que fileService)
const OUTPUT_DIR = path.join(process.cwd(), "generated_files");

// Créer le répertoire s'il n'existe pas
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Registre des fichiers générés pour le téléchargement sécurisé
const generatedFilesRegistry: Map<string, { filePath: string; fileName: string; createdAt: Date }> = new Map();

/**
 * SECURITE: Sanitize le nom de fichier pour éviter path traversal
 */
function sanitizeFileName(fileName: string): string {
  // Supprimer les caractères dangereux et les path traversal
  return fileName
    .replace(/\.\./g, "") // Empêcher path traversal
    .replace(/[\/\\]/g, "") // Supprimer les slashes
    .replace(/[<>:"|?*]/g, "") // Supprimer caractères interdits Windows
    .replace(/\s+/g, "_") // Espaces en underscores
    .replace(/[^\w\-_.]/g, "") // Garder seulement alphanumériques, tirets, underscores, points
    .substring(0, 200); // Limiter la longueur
}

/**
 * Export du registre pour le système de téléchargement
 */
export function getGeneratedFilesFromRegistry(): Array<{ filePath: string; fileName: string }> {
  const files: Array<{ filePath: string; fileName: string }> = [];
  for (const [, value] of generatedFilesRegistry.entries()) {
    if (fs.existsSync(value.filePath)) {
      files.push({ filePath: value.filePath, fileName: value.fileName });
    }
  }
  return files;
}

export interface GenerationRequest {
  type: "pdf" | "excel" | "csv" | "json" | "word" | "markdown";
  content: any;
  fileName?: string;
  template?: string;
  options?: {
    title?: string;
    author?: string;
    columns?: string[];
    sheetName?: string;
    styling?: boolean;
  };
}

export interface GenerationResult {
  success: boolean;
  filePath: string;
  fileName: string;
  fileType: string;
  size: number;
  downloadUrl?: string;
  error?: string;
}

export class UniversalFileGenerator {
  private static instance: UniversalFileGenerator;
  private cache: Map<string, { result: GenerationResult; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  private constructor() {
    // Nettoyage du cache périodique
    setInterval(() => this.cleanCache(), 60 * 1000);
  }

  static getInstance(): UniversalFileGenerator {
    if (!UniversalFileGenerator.instance) {
      UniversalFileGenerator.instance = new UniversalFileGenerator();
    }
    return UniversalFileGenerator.instance;
  }

  private cleanCache(): void {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.CACHE_TTL) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Enregistre un fichier généré dans le registre
   */
  private registerFile(result: GenerationResult): void {
    if (result.success) {
      generatedFilesRegistry.set(result.fileName, {
        filePath: result.filePath,
        fileName: result.fileName,
        createdAt: new Date()
      });
    }
  }

  /**
   * Point d'entrée principal - génère un fichier de n'importe quel type
   */
  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const startTime = Date.now();
    // SECURITE: Sanitize le nom de fichier
    const rawFileName = request.fileName || `generated_${Date.now()}`;
    const fileName = sanitizeFileName(rawFileName);
    
    if (!fileName) {
      return {
        success: false,
        filePath: "",
        fileName: rawFileName,
        fileType: request.type,
        size: 0,
        error: "Nom de fichier invalide"
      };
    }
    
    console.log(`[FileGenerator] Starting ${request.type} generation: ${fileName}`);

    try {
      let result: GenerationResult;

      switch (request.type) {
        case "excel":
          result = await this.generateExcel(request.content, fileName, request.options);
          break;
        case "csv":
          result = await this.generateCSV(request.content, fileName);
          break;
        case "json":
          result = await this.generateJSON(request.content, fileName);
          break;
        case "markdown":
          result = await this.generateMarkdown(request.content, fileName);
          break;
        case "pdf":
          result = await this.generatePDF(request.content, fileName, request.options);
          break;
        case "word":
          result = await this.generateWord(request.content, fileName, request.options);
          break;
        default:
          throw new Error(`Type non supporté: ${request.type}`);
      }

      const duration = Date.now() - startTime;
      console.log(`[FileGenerator] ✅ ${request.type} generated in ${duration}ms: ${result.fileName}`);
      
      // Enregistrer le fichier pour le téléchargement sécurisé
      this.registerFile(result);
      
      return result;
    } catch (error: any) {
      console.error(`[FileGenerator] ❌ Generation failed:`, error);
      return {
        success: false,
        filePath: "",
        fileName: fileName,
        fileType: request.type,
        size: 0,
        error: error.message
      };
    }
  }

  /**
   * Génération Excel avec styles professionnels
   */
  private async generateExcel(
    data: any[] | { sheets: Array<{ name: string; data: any[] }> },
    fileName: string,
    options?: GenerationRequest["options"]
  ): Promise<GenerationResult> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = options?.author || "Ulysse AI";
    workbook.created = new Date();

    // Support multi-feuilles ou données simples
    const sheets = Array.isArray(data) 
      ? [{ name: options?.sheetName || "Données", data }]
      : data.sheets;

    for (const sheet of sheets) {
      const worksheet = workbook.addWorksheet(sheet.name);
      
      if (sheet.data.length === 0) continue;

      // Détecter les colonnes depuis les données
      const columns = options?.columns || Object.keys(sheet.data[0]);
      worksheet.columns = columns.map(col => ({
        header: col,
        key: col,
        width: Math.max(15, col.length + 5)
      }));

      // Ajouter les données
      for (const row of sheet.data) {
        worksheet.addRow(row);
      }

      // Styling si activé
      if (options?.styling !== false) {
        // En-tête stylisé
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: "FFFFFF" } };
        headerRow.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "4472C4" }
        };
        headerRow.alignment = { horizontal: "center" };

        // Bordures
        worksheet.eachRow((row, rowNumber) => {
          row.eachCell((cell) => {
            cell.border = {
              top: { style: "thin" },
              left: { style: "thin" },
              bottom: { style: "thin" },
              right: { style: "thin" }
            };
          });
        });

        // Auto-filter
        worksheet.autoFilter = {
          from: { row: 1, column: 1 },
          to: { row: 1, column: columns.length }
        };
      }
    }

    const filePath = path.join(OUTPUT_DIR, `${fileName}.xlsx`);
    await workbook.xlsx.writeFile(filePath);
    const stats = fs.statSync(filePath);

    return {
      success: true,
      filePath,
      fileName: `${fileName}.xlsx`,
      fileType: "excel",
      size: stats.size,
      downloadUrl: `/api/files/download/${encodeURIComponent(`${fileName}.xlsx`)}`
    };
  }

  /**
   * Génération CSV optimisée
   */
  private async generateCSV(data: any[], fileName: string): Promise<GenerationResult> {
    if (!data || data.length === 0) {
      throw new Error("Données vides");
    }

    const columns = Object.keys(data[0]);
    const lines: string[] = [];
    
    // En-tête
    lines.push(columns.map(c => `"${c}"`).join(";"));
    
    // Données
    for (const row of data) {
      const values = columns.map(col => {
        const val = row[col];
        if (val === null || val === undefined) return "";
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      });
      lines.push(values.join(";"));
    }

    const content = lines.join("\n");
    const filePath = path.join(OUTPUT_DIR, `${fileName}.csv`);
    fs.writeFileSync(filePath, "\uFEFF" + content, "utf-8"); // BOM pour Excel
    const stats = fs.statSync(filePath);

    return {
      success: true,
      filePath,
      fileName: `${fileName}.csv`,
      fileType: "csv",
      size: stats.size,
      downloadUrl: `/api/files/download/${encodeURIComponent(`${fileName}.csv`)}`
    };
  }

  /**
   * Génération JSON formaté
   */
  private async generateJSON(data: any, fileName: string): Promise<GenerationResult> {
    const content = JSON.stringify(data, null, 2);
    const filePath = path.join(OUTPUT_DIR, `${fileName}.json`);
    fs.writeFileSync(filePath, content, "utf-8");
    const stats = fs.statSync(filePath);

    return {
      success: true,
      filePath,
      fileName: `${fileName}.json`,
      fileType: "json",
      size: stats.size,
      downloadUrl: `/api/files/download/${encodeURIComponent(`${fileName}.json`)}`
    };
  }

  /**
   * Génération Markdown
   */
  private async generateMarkdown(content: string | { title?: string; sections: Array<{ heading: string; content: string }> }, fileName: string): Promise<GenerationResult> {
    let markdown: string;
    
    if (typeof content === "string") {
      markdown = content;
    } else {
      const parts: string[] = [];
      if (content.title) {
        parts.push(`# ${content.title}\n`);
      }
      for (const section of content.sections) {
        parts.push(`## ${section.heading}\n\n${section.content}\n`);
      }
      markdown = parts.join("\n");
    }

    const filePath = path.join(OUTPUT_DIR, `${fileName}.md`);
    fs.writeFileSync(filePath, markdown, "utf-8");
    const stats = fs.statSync(filePath);

    return {
      success: true,
      filePath,
      fileName: `${fileName}.md`,
      fileType: "markdown",
      size: stats.size,
      downloadUrl: `/api/files/download/${encodeURIComponent(`${fileName}.md`)}`
    };
  }

  private async generatePDF(
    content: string | { title?: string; body: string } | Array<Record<string, any>>,
    fileName: string,
    options?: GenerationRequest["options"]
  ): Promise<GenerationResult> {
    const title = typeof content === "string"
      ? options?.title || "Document"
      : Array.isArray(content) ? options?.title || "Document" : content.title || "Document";

    const filePath = path.join(OUTPUT_DIR, `${fileName}.pdf`);
    const writeStream = fs.createWriteStream(filePath);

    const PDFDoc = await getPDFDocument();
    const doc = new PDFDoc({ size: "A4", margin: 50, bufferPages: true });
    doc.pipe(writeStream);

    doc.fontSize(20).fillColor("#2c3e50").text(title, { align: "center" });
    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#3498db").lineWidth(2).stroke();
    doc.moveDown(1);

    if (Array.isArray(content) && content.length > 0 && Object.keys(content[0]).length > 0) {
      const cols = Object.keys(content[0]);
      const colCount = cols.length;
      const tableWidth = 495;
      const colWidth = Math.min(tableWidth / colCount, 200);
      const startX = 50;
      const rowHeight = 22;

      const drawRow = (values: string[], y: number, isHeader: boolean) => {
        if (isHeader) {
          doc.rect(startX, y, tableWidth, rowHeight).fill("#3498db");
        }
        for (let i = 0; i < values.length; i++) {
          const x = startX + i * colWidth;
          doc.rect(x, y, colWidth, rowHeight).strokeColor("#ddd").lineWidth(0.5).stroke();
          doc.fontSize(8)
            .fillColor(isHeader ? "#ffffff" : "#333333")
            .text(String(values[i] ?? ""), x + 4, y + 5, { width: colWidth - 8, height: rowHeight - 6, ellipsis: true });
        }
      };

      let currentY = doc.y;
      drawRow(cols, currentY, true);
      currentY += rowHeight;

      for (let r = 0; r < content.length; r++) {
        if (currentY + rowHeight > 750) {
          doc.addPage();
          currentY = 50;
          drawRow(cols, currentY, true);
          currentY += rowHeight;
        }
        if (r % 2 === 0) {
          doc.rect(startX, currentY, tableWidth, rowHeight).fill("#f8f8f8");
        }
        drawRow(cols.map(c => String(content[r][c] ?? "")), currentY, false);
        currentY += rowHeight;
      }
      doc.y = currentY + 10;
    } else {
      const body = typeof content === "string" ? content : (content as any).body || "";
      const lines = body.split("\n");
      for (const line of lines) {
        if (doc.y > 740) doc.addPage();
        if (line.startsWith("### ")) {
          doc.moveDown(0.5).font("Helvetica-Bold").fontSize(13).fillColor("#34495e").text(line.replace(/^###\s*/, ""));
          doc.font("Helvetica");
        } else if (line.startsWith("## ")) {
          doc.moveDown(0.5).font("Helvetica-Bold").fontSize(15).fillColor("#2c3e50").text(line.replace(/^##\s*/, ""));
          doc.font("Helvetica");
        } else if (line.startsWith("# ")) {
          doc.moveDown(0.5).font("Helvetica-Bold").fontSize(18).fillColor("#2c3e50").text(line.replace(/^#\s*/, ""));
          doc.font("Helvetica");
        } else if (line.startsWith("- ") || line.startsWith("* ")) {
          doc.fontSize(10).fillColor("#333").text(`  \u2022  ${line.replace(/^[-*]\s*/, "")}`, { indent: 15 });
        } else if (line.match(/^\d+\.\s/)) {
          doc.fontSize(10).fillColor("#333").text(`  ${line}`, { indent: 10 });
        } else if (line.startsWith("**") && line.endsWith("**")) {
          doc.font("Helvetica-Bold").fontSize(10).fillColor("#222").text(line.replace(/\*\*/g, ""));
          doc.font("Helvetica");
        } else if (line.trim() === "") {
          doc.moveDown(0.4);
        } else {
          doc.fontSize(10).fillColor("#333").text(line);
        }
      }
    }

    doc.moveDown(2);
    if (doc.y > 740) doc.addPage();
    doc.fontSize(8).fillColor("#999").text(`Généré par Ulysse AI — ${new Date().toLocaleDateString("fr-FR")}`, { align: "center" });

    doc.end();

    await new Promise<void>((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    const stats = fs.statSync(filePath);
    return {
      success: true,
      filePath,
      fileName: `${fileName}.pdf`,
      fileType: "pdf",
      size: stats.size,
      downloadUrl: `/api/files/download/${encodeURIComponent(`${fileName}.pdf`)}`,
    };
  }

  async generateInvoicePDF(invoiceData: {
    emetteur: { nom: string; adresse?: string; tel?: string; siret?: string; rcs?: string };
    client: { nom: string; adresse?: string };
    numero: string;
    date: string;
    code_client?: string;
    chantier?: string;
    lignes: Array<{ designation: string; unite?: string; quantite?: number; prix_unitaire: number; tva_taux?: number; remise?: number }>;
    acompte?: number;
    mentions_legales?: string;
    total_rows?: number;
  }, fileName: string): Promise<GenerationResult> {
    const filePath = path.join(OUTPUT_DIR, `${fileName}.pdf`);
    const writeStream = fs.createWriteStream(filePath);
    const PDFDoc2 = await getPDFDocument();
    const doc = new PDFDoc2({ size: "A4", margin: 40, bufferPages: true });
    doc.pipe(writeStream);

    const { emetteur, client, numero, date, code_client, chantier, lignes, acompte, mentions_legales, total_rows } = invoiceData;

    const fmtEur = (n: number): string => {
      const parts = n.toFixed(2).split(".");
      const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
      return `${intPart},${parts[1]} \u20AC`;
    };

    const fmtEurNaked = (n: number): string => {
      const parts = n.toFixed(2).split(".");
      const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
      return `${intPart},${parts[1]}`;
    };

    doc.fontSize(16).fillColor("#000").font("Helvetica-Bold")
      .text("Facture en Euros", 0, 40, { align: "center", width: 595 });

    const headerY = 80;
    doc.fontSize(10).fillColor("#000").font("Helvetica-Bold");
    const emLines = (emetteur.adresse || "").split("\n");
    doc.text(emetteur.nom, 40, headerY);
    doc.font("Helvetica");
    for (const line of emLines) {
      if (line.trim()) doc.text(line.trim(), 40, doc.y);
    }
    if (emetteur.rcs) doc.text(emetteur.rcs, 40, doc.y);
    const emBottomY = doc.y;
    if (emetteur.tel) {
      doc.moveDown(0.3);
      doc.text(`Tel : ${emetteur.tel}`, 40, doc.y);
    }

    doc.font("Helvetica-Bold").fontSize(10);
    doc.text(client.nom, 380, headerY, { width: 180 });
    doc.font("Helvetica");
    if (client.adresse) {
      const clLines = client.adresse.split("\n");
      for (const line of clLines) {
        if (line.trim()) doc.text(line.trim(), 380, doc.y, { width: 180 });
      }
    }

    const infoY = Math.max(doc.y, emBottomY) + 20;

    const infoColX = [130, 260, 380];
    const infoHeaders = ["Date", "Code Client", "N\u00B0 de facture"];
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#000");
    doc.rect(40, infoY - 2, 515, 16).lineWidth(0.5).stroke();
    for (let i = 0; i < infoHeaders.length; i++) {
      doc.text(infoHeaders[i], i === 0 ? 45 : infoColX[i - 1] + 5, infoY + 1, { width: 120 });
    }
    const infoValY = infoY + 18;
    doc.font("Helvetica").fontSize(9);
    doc.text(date, 45, infoValY);
    doc.text(code_client || "", infoColX[0] + 5, infoValY);
    doc.text(numero, infoColX[1] + 5, infoValY);

    let tableTop = infoValY + 25;

    const colDefs = [
      { header: "Code article", x: 40, w: 70 },
      { header: "Designation", x: 110, w: 140 },
      { header: "QUANTITE", x: 250, w: 95 },
      { header: "P.U. HT", x: 345, w: 65 },
      { header: "Montant HT", x: 410, w: 80 },
      { header: "TVA", x: 490, w: 65 },
    ];
    const subHeaders = [
      { label: "Unite", x: 255 },
      { label: "Nbre", x: 290 },
      { label: "Px unit", x: 315 },
      { label: "Rem", x: 340 },
    ];

    const rowH = 18;

    doc.rect(40, tableTop, 515, rowH * 2).lineWidth(0.5).stroke();
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000");
    for (const col of colDefs) {
      doc.text(col.header, col.x + 2, tableTop + 3, { width: col.w - 4 });
    }
    doc.font("Helvetica").fontSize(7);
    for (const sh of subHeaders) {
      doc.text(sh.label, sh.x, tableTop + rowH + 3);
    }
    doc.moveTo(40, tableTop + rowH).lineTo(555, tableTop + rowH).lineWidth(0.3).stroke();
    for (const col of colDefs) {
      doc.moveTo(col.x, tableTop).lineTo(col.x, tableTop + rowH * 2).lineWidth(0.3).stroke();
    }
    doc.moveTo(555, tableTop).lineTo(555, tableTop + rowH * 2).lineWidth(0.3).stroke();

    let y = tableTop + rowH * 2;
    let totalHT = 0;
    const tvaMap: Record<string, number> = {};

    const displayRows = total_rows || Math.max(lignes.length + 4, 12);

    for (let i = 0; i < displayRows; i++) {
      if (y + rowH > 720) { doc.addPage(); y = 50; }

      doc.rect(40, y, 515, rowH).lineWidth(0.3).stroke();
      for (const col of colDefs) {
        doc.moveTo(col.x, y).lineTo(col.x, y + rowH).lineWidth(0.3).stroke();
      }
      doc.moveTo(555, y).lineTo(555, y + rowH).lineWidth(0.3).stroke();

      if (i < lignes.length) {
        const l = lignes[i];
        const qte = l.quantite ?? 1;
        const rem = l.remise ?? 0;
        const montantHT = l.prix_unitaire * qte * (1 - rem / 100);
        totalHT += montantHT;
        const tvaTaux = l.tva_taux ?? 0;
        const tvaKey = tvaTaux === 0 ? "Exo" : `${tvaTaux}%`;
        tvaMap[tvaKey] = (tvaMap[tvaKey] || 0) + montantHT * tvaTaux / 100;

        doc.font("Helvetica").fontSize(7.5).fillColor("#000");

        if (i === 0 && chantier) {
          doc.font("Helvetica-Bold").text(`CHANTIER :`, colDefs[1].x + 2, y + 4, { width: colDefs[1].w - 4 });
          doc.font("Helvetica");
          y += rowH;
          doc.rect(40, y, 515, rowH).lineWidth(0.3).stroke();
          for (const col of colDefs) {
            doc.moveTo(col.x, y).lineTo(col.x, y + rowH).lineWidth(0.3).stroke();
          }
          doc.moveTo(555, y).lineTo(555, y + rowH).lineWidth(0.3).stroke();
        }

        doc.text(l.designation, colDefs[1].x + 2, y + 4, { width: colDefs[1].w - 4 });
        doc.text(l.unite || "forfait", 255, y + 4, { width: 30 });
        doc.text(String(qte), 290, y + 4, { width: 25 });
        doc.text(fmtEurNaked(l.prix_unitaire), 310, y + 4, { width: 35 });
        doc.text(rem > 0 ? `${rem}%` : "0%", 340, y + 4, { width: 25 });
        doc.text(fmtEur(montantHT), colDefs[4].x + 2, y + 4, { width: colDefs[4].w - 4, align: "right" });
        doc.text(tvaTaux === 0 ? "0" : String(tvaTaux), colDefs[5].x + 2, y + 4, { width: colDefs[5].w - 4 });
      } else {
        doc.font("Helvetica").fontSize(7.5).fillColor("#000");
        doc.text("- \u20AC", colDefs[4].x + 2, y + 4, { width: colDefs[4].w - 4, align: "right" });
      }

      y += rowH;
    }

    const totalTVA = Object.values(tvaMap).reduce((a, b) => a + b, 0);
    const totalTTC = totalHT + totalTVA;
    const acompteVal = acompte || 0;
    const resteARegler = totalTTC - acompteVal;

    y += 10;
    if (y + 120 > 780) { doc.addPage(); y = 50; }

    const leftX = 40;
    const rightLabelX = 330;
    const rightValX = 430;
    const rightW = 125;

    doc.font("Helvetica-Bold").fontSize(9).fillColor("#000");
    doc.text("Montant TTC", leftX, y, { continued: true });
    doc.text("       TVA", { continued: true });
    doc.text("       TVA");

    doc.text("TOTAL TTC", rightLabelX, y);
    doc.text(fmtEur(totalTTC), rightValX, y, { width: rightW, align: "right" });

    y += 16;
    doc.font("Helvetica").fontSize(9);

    const tvaKeys = Object.keys(tvaMap);
    if (tvaKeys.length === 0) tvaMap["Exo"] = 0;

    const tvaEntries = Object.entries(tvaMap);
    let leftTvaY = y;
    doc.text(fmtEur(totalTTC), leftX + 5, leftTvaY, { width: 70 });
    for (const [key, val] of tvaEntries) {
      doc.text(key === "Exo" ? "Exo" : key, leftX + 85, leftTvaY);
      doc.text(fmtEurNaked(val), leftX + 130, leftTvaY);
      leftTvaY += 13;
    }
    doc.text("10%", leftX + 85, leftTvaY);
    leftTvaY += 13;
    doc.text("20%", leftX + 85, leftTvaY);

    doc.font("Helvetica-Bold").fontSize(9);
    doc.text("ACOMPTE", rightLabelX, y);
    doc.text(fmtEur(acompteVal), rightValX, y, { width: rightW, align: "right" });

    y += 16;
    doc.text("Total TTC", rightLabelX, y);
    doc.text(fmtEur(totalTTC), rightValX, y, { width: rightW, align: "right" });

    y += 20;
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text("Reste a regler", rightLabelX, y);
    doc.text(fmtEur(resteARegler), rightValX, y, { width: rightW, align: "right" });

    const mentionsY = Math.max(leftTvaY + 20, y + 25);
    const legalText = mentions_legales || "En cas de retard de paiement, une penalite egale\na 1,5 fois le taux d'interet legal, sera facturee";
    doc.font("Helvetica").fontSize(7).fillColor("#555");
    doc.text(legalText, leftX, mentionsY, { width: 280 });

    doc.end();
    await new Promise<void>((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    const stats = fs.statSync(filePath);
    return {
      success: true,
      filePath,
      fileName: `${fileName}.pdf`,
      fileType: "pdf",
      size: stats.size,
      downloadUrl: `/api/files/download/${encodeURIComponent(`${fileName}.pdf`)}`,
    };
  }

  /**
   * Génération Word (DOCX) simplifié
   */
  private async generateWord(
    content: string | { title?: string; body: string },
    fileName: string,
    options?: GenerationRequest["options"]
  ): Promise<GenerationResult> {
    // Pour une vraie implémentation, utiliser docx ou officegen
    // Ici on génère un HTML que Word peut ouvrir
    
    const title = typeof content === "string" ? options?.title || "Document" : content.title || "Document";
    const body = typeof content === "string" ? content : content.body;
    
    const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <!--[if gte mso 9]>
  <xml>
    <w:WordDocument>
      <w:View>Print</w:View>
    </w:WordDocument>
  </xml>
  <![endif]-->
  <style>
    body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.5; }
    h1 { font-size: 18pt; color: #2c3e50; }
    h2 { font-size: 14pt; color: #34495e; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #000; padding: 5px; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${this.markdownToHtml(body)}
</body>
</html>`;

    const filePath = path.join(OUTPUT_DIR, `${fileName}.doc`);
    fs.writeFileSync(filePath, html, "utf-8");
    const stats = fs.statSync(filePath);

    return {
      success: true,
      filePath,
      fileName: `${fileName}.doc`,
      fileType: "word",
      size: stats.size,
      downloadUrl: `/api/files/download/${encodeURIComponent(`${fileName}.doc`)}`
    };
  }

  /**
   * Conversion Markdown vers HTML basique
   */
  private markdownToHtml(markdown: string): string {
    return markdown
      // Headers
      .replace(/^### (.*$)/gm, '<h3>$1</h3>')
      .replace(/^## (.*$)/gm, '<h2>$1</h2>')
      .replace(/^# (.*$)/gm, '<h1>$1</h1>')
      // Bold & Italic
      .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      // Lists
      .replace(/^\- (.*)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      // Tables (basique)
      .replace(/\|(.+)\|/g, (match) => {
        const cells = match.split('|').filter(c => c.trim());
        if (cells.every(c => /^-+$/.test(c.trim()))) return '';
        const tag = cells.length > 0 ? 'td' : 'th';
        return '<tr>' + cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('') + '</tr>';
      })
      // Paragraphs
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(.+)$/gm, (match) => {
        if (match.startsWith('<')) return match;
        return match;
      });
  }

  /**
   * Génération intelligente via AI
   * L'AI génère le contenu structuré, puis on le convertit au format demandé
   */
  async generateWithAI(
    prompt: string,
    outputType: GenerationRequest["type"],
    options?: GenerationRequest["options"]
  ): Promise<GenerationResult> {
    console.log(`[FileGenerator] AI generation: ${outputType}`);
    
    try {
      // Demander à l'AI d'EXTRAIRE les données réelles (pas les inventer)
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.1, // Très bas pour extraction factuelle
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `Tu es un extracteur de données professionnel. Ta mission est d'EXTRAIRE les données RÉELLES présentes dans le texte fourni.

⚠️ RÈGLES CRITIQUES:
1. N'INVENTE JAMAIS de données - utilise UNIQUEMENT ce qui est dans le texte
2. Si tu vois des tableaux markdown, extrais chaque ligne exactement
3. Si tu vois des références produits (F2256V, 13342, etc.), garde-les telles quelles
4. Si tu vois des prix, quantités, dates - recopie-les EXACTEMENT
5. Ne génère PAS de données de démo (A001, Article 1, etc.) - c'est INTERDIT

FORMAT DE SORTIE JSON:
{
  "title": "Titre extrait du document",
  "data": [...], 
  "metadata": { "author": "Ulysse AI", "date": "...", "source": "extraction" }
}

Pour les tableaux Excel:
- "data" = tableau d'objets avec les vraies colonnes et vraies valeurs
- Chaque objet = une ligne du tableau source
- Clés = noms des colonnes (Réf, Désignation, Qté, PU HT, Total HT, TVA, Date, N° Facture, etc.)

EXEMPLE:
Si le texte contient:
| Réf | Désignation | Qté | PU HT |
| F2256V | FILET DE POULET | 55.43 | 13,30 € |

Tu retournes:
{ "data": [{ "Réf": "F2256V", "Désignation": "FILET DE POULET", "Qté": 55.43, "PU_HT": 13.30 }] }`
          },
          {
            role: "user",
            content: `EXTRAIS les données RÉELLES de ce contenu (n'invente rien):\n\n${prompt}`
          }
        ]
      });

      let content: any = {};
      try { content = JSON.parse(response.choices[0]?.message?.content || "{}"); } catch { console.warn("[FileGenerator] Failed to parse AI response"); }
      const fileName = options?.title?.replace(/[^a-zA-Z0-9]/g, "_") || `ai_generated_${Date.now()}`;

      // Générer le fichier selon le type demandé
      if (outputType === "excel" || outputType === "csv") {
        return this.generate({
          type: outputType,
          content: content.data || [content],
          fileName,
          options: { ...options, title: content.title }
        });
      } else {
        return this.generate({
          type: outputType,
          content: content.body || JSON.stringify(content, null, 2),
          fileName,
          options: { ...options, title: content.title }
        });
      }
    } catch (error: any) {
      console.error(`[FileGenerator] AI generation failed:`, error);
      return {
        success: false,
        filePath: "",
        fileName: "",
        fileType: outputType,
        size: 0,
        error: error.message
      };
    }
  }

  /**
   * Génération de rapport à partir de données analysées
   */
  async generateReport(
    analysisResult: any,
    format: "excel" | "pdf" | "markdown" = "markdown"
  ): Promise<GenerationResult> {
    const title = `Rapport_${new Date().toISOString().split('T')[0]}`;
    
    if (format === "excel" && analysisResult.structuredData) {
      // Convertir les données structurées en tableau Excel
      const data = this.flattenForExcel(analysisResult.structuredData);
      return this.generate({
        type: "excel",
        content: data,
        fileName: title,
        options: { title: analysisResult.summary || "Rapport" }
      });
    }
    
    // Format texte (markdown ou PDF)
    const body = this.formatReportBody(analysisResult);
    return this.generate({
      type: format,
      content: { title: analysisResult.documentType || "Rapport", body },
      fileName: title
    });
  }

  private flattenForExcel(data: any): any[] {
    if (Array.isArray(data)) return data;
    if (data.factures) return data.factures;
    if (data.lignes) return data.lignes;
    if (data.articles) return data.articles;
    
    // Convertir objet en tableau de paires clé-valeur
    return Object.entries(data).map(([key, value]) => ({
      Champ: key,
      Valeur: typeof value === "object" ? JSON.stringify(value) : value
    }));
  }

  private formatReportBody(result: any): string {
    const lines: string[] = [];
    
    if (result.summary) {
      lines.push(`## Résumé\n${result.summary}\n`);
    }
    
    if (result.structuredData) {
      lines.push(`## Données extraites\n`);
      lines.push("```json");
      lines.push(JSON.stringify(result.structuredData, null, 2));
      lines.push("```\n");
    }
    
    if (result.confidence) {
      lines.push(`**Confiance: ${result.confidence}%**`);
    }
    
    return lines.join("\n");
  }
}

// Export singleton
export const fileGenerator = UniversalFileGenerator.getInstance();
