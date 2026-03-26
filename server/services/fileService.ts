import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import ExcelJS from "exceljs";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } from "docx";
import mammoth from "mammoth";
import PDFDocument from "pdfkit";

// PDF parsing with lazy loading for ESM compatibility
let pdfParseFn: any = null;
let pdfParseError: string | null = null;
let pdfModuleLoaded = false;

// Promise to track module loading
let pdfModuleLoadingPromise: Promise<void> | null = null;

// Lazy load PDF module (called on first use)
async function ensurePdfModuleLoaded(): Promise<void> {
  if (pdfModuleLoaded) return;
  if (pdfModuleLoadingPromise) return pdfModuleLoadingPromise;
  
  pdfModuleLoadingPromise = (async () => {
    try {
      // pdf-parse v1.1.1 - import the actual parsing function
      const pdfModule = await import("pdf-parse/lib/pdf-parse.js");
      pdfParseFn = pdfModule.default || pdfModule;
      pdfModuleLoaded = true;
      console.log("[FileService] pdf-parse v1.1.1 loaded successfully");
    } catch (e) {
      pdfParseError = e instanceof Error ? e.message : "Unknown error loading pdf-parse";
      console.error("[FileService] Failed to load pdf-parse:", pdfParseError);
    }
  })();
  
  return pdfModuleLoadingPromise;
}

// Initialize on module load (non-blocking)
ensurePdfModuleLoaded().catch(e => console.error("[FileService] PDF init error:", e));
import archiver from "archiver";
import AdmZip from "adm-zip";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const GENERATED_DIR = path.join(process.cwd(), "generated_files");

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(GENERATED_DIR)) {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
}

export interface FileAnalysis {
  fileName: string;
  fileType: string;
  content: string;
  metadata: Record<string, unknown>;
  summary?: string;
}

export interface GeneratedFile {
  fileName: string;
  filePath: string;
  fileType: string;
  size: number;
}

export class FileService {
  async readPDF(filePath: string): Promise<FileAnalysis> {
    // Ensure PDF module is loaded before use
    await ensurePdfModuleLoaded();
    
    const buffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath).toLowerCase();
    
    // Détection intelligente des factures fournisseur pour utiliser le parser PRO
    const isInvoicePDF = (
      fileName.includes('facture') ||
      fileName.includes('invoice') ||
      fileName.includes('zouaghi') ||
      fileName.includes('metro') ||
      fileName.includes('promocash') ||
      fileName.includes('relevé') ||
      fileName.includes('releve')
    );
    
    if (isInvoicePDF) {
      console.log(`[FileService] Detected invoice PDF, using PRO parser: ${fileName}`);
      try {
        const { invoiceParserService } = await import("./invoiceParserService");
        const result = await invoiceParserService.extractFromPDF(filePath);
        
        if (result.success && result.factures.length > 0) {
          let content = result.summary;
          
          if (result.validation.warnings.length > 0) {
            content += `\n\n⚠️ **Avertissements:**\n${result.validation.warnings.map(w => `• ${w}`).join("\n")}`;
          }
          
          console.log(`[FileService] PRO extraction: ${result.factures.length} invoices, total ${result.totaux.totalTTC.toFixed(2)}€`);
          
          // Store ALL invoices in BrainHub with FULL details in ONE consolidated entry
          try {
            const { brainHub } = await import("./sensory/BrainHub");
            const TTL_2_YEARS = 2 * 365 * 24 * 60 * 60 * 1000;
            
            // 1. Store supplier summary
            brainHub.addToWorkingMemory({
              type: 'context',
              content: `🏪 FOURNISSEUR: ${result.fournisseur.nom} | Client: ${result.client.nom} | Période: ${result.periode}`,
              source: 'invoice_parser',
              timestamp: new Date(),
              importance: 95,
              ttlMs: TTL_2_YEARS,
            });
            
            // 2. Store global totals
            brainHub.addToWorkingMemory({
              type: 'context',
              content: `💰 TOTAUX ${result.factures.length} FACTURES: HT=${result.totaux.totalHT.toFixed(2)}€ | TVA=${result.totaux.totalTVA.toFixed(2)}€ | TTC=${result.totaux.totalTTC.toFixed(2)}€`,
              source: 'invoice_parser',
              timestamp: new Date(),
              importance: 90,
              ttlMs: TTL_2_YEARS,
            });
            
            // 3. Store each invoice with its articles
            for (const facture of result.factures) {
              const lignesText = facture.lignes.length > 0
                ? facture.lignes.map((l, i) => {
                    const ref = l.reference ? `[${l.reference}]` : '';
                    return `  ${i+1}. ${ref} ${l.designation} | ${l.quantite} × ${l.prixUnitaireHT.toFixed(2)}€ = ${l.montantHT.toFixed(2)}€ (TVA ${l.tva}%)`;
                  }).join('\n')
                : '  (lignes non extraites)';
              
              brainHub.addToWorkingMemory({
                type: 'context',
                content: `🧾 FACTURE ${facture.numero} (${facture.date}) - TTC: ${facture.totalTTC.toFixed(2)}€ [${facture.validationStatus}]\n📦 Articles:\n${lignesText}`,
                source: 'invoice_parser',
                timestamp: new Date(),
                importance: 85,
                ttlMs: TTL_2_YEARS,
              });
            }
            
            console.log(`[FileService] ✅ ${result.factures.length} invoices stored in BrainHub memory (TTL: 2 years)`);
          } catch (brainErr) {
            console.warn(`[FileService] BrainHub storage failed:`, brainErr);
          }
          
          // V6: Le summary contient déjà TOUT en tableaux markdown - afficher tel quel
          const totalLignes = result.factures.reduce((sum, f) => sum + f.lignes.length, 0);
          const enhancedContent = result.summary;
          console.log(`[FileService] V6 Report: ${result.factures.length} factures, ${totalLignes} product lines (tables format)`);
          
          return {
            fileName: path.basename(filePath),
            fileType: "pdf",
            content: enhancedContent,
            summary: result.summary,
            metadata: {
              fournisseur: result.fournisseur.nom,
              client: result.client.nom,
              periode: result.periode,
              nombreFactures: result.factures.length,
              totalTTC: result.totaux.totalTTC,
              factures: result.factures.map(f => ({
                numero: f.numero,
                date: f.date,
                totalTTC: f.totalTTC,
                lignes: f.lignes.map(l => ({
                  reference: l.reference,
                  designation: l.designation,
                  quantite: l.quantite,
                  prixUnitaireHT: l.prixUnitaireHT,
                  montantHT: l.montantHT,
                  tva: l.tva
                }))
              })),
              sizeBytes: buffer.length
            }
          };
        }
        // Fallback to standard extraction if PRO parser fails
        console.log(`[FileService] PRO parser returned no invoices, falling back to standard extraction`);
      } catch (proError) {
        console.warn(`[FileService] PRO parser error, falling back to standard:`, proError);
      }
    }
    
    // Use pdf-parse v1.1.1 for text extraction
    if (pdfParseFn) {
      try {
        const result = await pdfParseFn(buffer);
        const fullText = result.text || "";
        const numPages = result.numpages || 1;
        
        if (!fullText || fullText.trim().length === 0) {
          console.log("[FileService] PDF text empty — delegating to PDFMaster (OCR → Vision cascade)");
          try {
            const { pdfMasterService } = await import("./pdfMasterService");
            const masterResult = await pdfMasterService.extractText(filePath);
            if (masterResult.success) {
              return {
                fileName: path.basename(filePath),
                fileType: "pdf",
                content: masterResult.text,
                metadata: { pages: masterResult.pages, method: masterResult.method, confidence: masterResult.confidence, isScanned: true, sizeBytes: buffer.length }
              };
            }
          } catch (masterErr) {
            console.warn("[FileService] PDFMaster fallback failed:", masterErr);
          }
          return {
            fileName: path.basename(filePath),
            fileType: "pdf",
            content: `[PDF SCANNÉ] Ce PDF semble être une image scannée sans texte extractible. Nombre de pages: ${numPages}. Taille: ${(buffer.length / 1024).toFixed(1)} KB.`,
            metadata: { pages: numPages, isScanned: true, sizeBytes: buffer.length }
          };
        }
        
        console.log(`[FileService] PDF parsed (pdf-parse): ${numPages} pages, ${fullText.length} chars`);
        
        return {
          fileName: path.basename(filePath),
          fileType: "pdf",
          content: fullText.trim(),
          metadata: { pages: numPages, sizeBytes: buffer.length, textLength: fullText.length }
        };
      } catch (pdfError) {
        console.error("[FileService] pdf-parse extraction failed:", pdfError);
      }
    }
    
    // No parser available
    console.error("[FileService] No PDF parser available");
    return {
      fileName: path.basename(filePath),
      fileType: "pdf",
      content: `[ERREUR] Aucun module de lecture PDF disponible. Erreur: ${pdfParseError || "Modules non chargés"}`,
      metadata: { pages: 0, error: pdfParseError || "No PDF parser", sizeBytes: buffer.length }
    };
  }

  // Extraction intelligente des factures fournisseur
  async extractInvoicesFromPDF(filePath: string): Promise<{
    fournisseur: string;
    periode: string;
    factures: Array<{
      numero: string;
      date: string;
      totalTTC: string;
      produits?: Array<{ designation: string; quantite: string; prixUnit: string; montantHT: string }>;
    }>;
    totalGeneral: string;
    summary: string;
  } | null> {
    await ensurePdfModuleLoaded();
    if (!pdfParseFn) return null;
    
    try {
      const buffer = fs.readFileSync(filePath);
      const result = await pdfParseFn(buffer);
      const pageText = result.text || "";
      const numPages = result.numpages || 1;
      
      const factures: Array<{ numero: string; date: string; totalTTC: string; produits: Array<{ designation: string; quantite: string; prixUnit: string; montantHT: string }> }> = [];
      let fournisseur = "";
      
      // Détecter le fournisseur
      if (pageText.toLowerCase().includes("zouaghi")) {
        fournisseur = "ZOUAGHI CACHER";
      } else if (pageText.toLowerCase().includes("metro")) {
        fournisseur = "METRO";
      } else if (pageText.toLowerCase().includes("promocash")) {
        fournisseur = "PROMOCASH";
      } else {
        const match = pageText.match(/(?:SARL|SA|SAS|EURL)\s+([A-Z][A-Z\s]+)/);
        if (match) fournisseur = match[1].trim();
      }
      
      // Extraire numéros de facture
      const numMatches = pageText.match(/F\d{7}/g) || [];
      const dateMatches = pageText.match(/(\d{2}\/\d{2}\/\d{2,4})/g) || [];
      const totalMatches = pageText.match(/NET A PAYER.*?(\d{1,3}(?:\s\d{3})*[,.]\d{2})\s*€/gi) || [];
      
      for (let i = 0; i < numMatches.length; i++) {
        const numero = numMatches[i];
        const date = dateMatches[i] || "";
        const totalStr = totalMatches[i] || "";
        const totalMatch = totalStr.match(/(\d{1,3}(?:\s\d{3})*[,.]\d{2})/);
        
        factures.push({
          numero,
          date: date || "N/A",
          totalTTC: totalMatch ? totalMatch[1] + " €" : "N/A",
          produits: []
        });
      }
      
      if (factures.length === 0) return null;
      
      // Calculer le total général (supprimer espaces des montants type "1 239,42 €")
      let totalGeneral = 0;
      for (const f of factures) {
        const montant = parseFloat(f.totalTTC.replace(/\s/g, "").replace(",", ".").replace("€", "")) || 0;
        totalGeneral += montant;
      }
      
      // Déterminer la période
      const dates = factures.map(f => f.date).filter(d => d !== "N/A");
      let periode = "";
      if (dates.length > 0) {
        const mois = dates[0].split("/")[1];
        const annee = dates[0].split("/")[2];
        const moisNoms = ["", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
        periode = `${moisNoms[parseInt(mois)] || mois} 20${annee.length === 2 ? annee : annee.slice(-2)}`;
      }
      
      // Générer le résumé
      const summary = `📄 **FACTURES ${fournisseur || "FOURNISSEUR"} - ${periode}**\n\n` +
        `${factures.length} factures extraites:\n` +
        factures.map(f => `• ${f.numero} du ${f.date}: **${f.totalTTC}**`).join("\n") +
        `\n\n💰 **TOTAL ${periode.toUpperCase()}: ${totalGeneral.toFixed(2).replace(".", ",")} €**`;
      
      console.log(`[FileService] Extracted ${factures.length} invoices from ${path.basename(filePath)}, total: ${totalGeneral.toFixed(2)} €`);
      
      return {
        fournisseur: fournisseur || "Inconnu",
        periode,
        factures,
        totalGeneral: totalGeneral.toFixed(2).replace(".", ",") + " €",
        summary
      };
    } catch (err) {
      console.error("[FileService] Error extracting invoices:", err);
      return null;
    }
  }

  async readWord(filePath: string): Promise<FileAnalysis> {
    const buffer = fs.readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer });
    
    return {
      fileName: path.basename(filePath),
      fileType: "docx",
      content: result.value,
      metadata: {
        messages: result.messages
      }
    };
  }

  async readExcel(filePath: string): Promise<FileAnalysis> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    
    const sheets: Record<string, unknown[][]> = {};
    const sheetNames: string[] = [];
    let fullContent = "";
    
    workbook.eachSheet((worksheet) => {
      const sheetName = worksheet.name;
      sheetNames.push(sheetName);
      const data: unknown[][] = [];
      
      worksheet.eachRow((row) => {
        const rowValues = row.values as unknown[];
        data.push(rowValues.slice(1));
      });
      
      sheets[sheetName] = data;
      
      fullContent += `\n=== Feuille: ${sheetName} ===\n`;
      for (const row of data) {
        fullContent += (row as unknown[]).join("\t") + "\n";
      }
    });
    
    return {
      fileName: path.basename(filePath),
      fileType: "xlsx",
      content: fullContent,
      metadata: {
        sheetNames,
        sheets
      }
    };
  }

  readZip(filePath: string): FileAnalysis {
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries();
    const fileList: string[] = [];
    let contentPreview = "";
    
    const filesByType: Record<string, string[]> = {
      text: [],
      code: [],
      documents: [],
      images: [],
      audio: [],
      video: [],
      data: [],
      archives: [],
      other: []
    };
    
    let totalSize = 0;
    const extractedContents: string[] = [];
    
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      
      const entryName = entry.entryName;
      const ext = path.extname(entryName).toLowerCase();
      const size = entry.header.size;
      totalSize += size;
      
      fileList.push(`${entryName} (${this.formatFileSize(size)})`);
      
      if (ext.match(/\.(txt|md|readme|log)$/i)) {
        filesByType.text.push(entryName);
        try {
          const content = entry.getData().toString("utf-8");
          extractedContents.push(`\n📄 ${entryName}:\n${content.slice(0, 2000)}${content.length > 2000 ? "\n[...tronqué...]" : ""}`);
        } catch { }
      } else if (ext.match(/\.(json|xml|yaml|yml|toml|ini|cfg|conf)$/i)) {
        filesByType.data.push(entryName);
        try {
          const content = entry.getData().toString("utf-8");
          extractedContents.push(`\n📋 ${entryName}:\n${content.slice(0, 2000)}${content.length > 2000 ? "\n[...tronqué...]" : ""}`);
        } catch { }
      } else if (ext.match(/\.(js|ts|jsx|tsx|py|java|c|cpp|h|hpp|cs|go|rs|rb|php|swift|kt|scala|sh|bash|ps1|sql)$/i)) {
        filesByType.code.push(entryName);
        try {
          const content = entry.getData().toString("utf-8");
          extractedContents.push(`\n💻 ${entryName}:\n${content.slice(0, 1500)}${content.length > 1500 ? "\n[...tronqué...]" : ""}`);
        } catch { }
      } else if (ext.match(/\.(csv|tsv)$/i)) {
        filesByType.data.push(entryName);
        try {
          const content = entry.getData().toString("utf-8");
          const lines = content.split("\n").slice(0, 20);
          extractedContents.push(`\n📊 ${entryName} (${content.split("\n").length} lignes):\n${lines.join("\n")}${content.split("\n").length > 20 ? "\n[...suite...]" : ""}`);
        } catch { }
      } else if (ext.match(/\.(html|htm|css|scss|less)$/i)) {
        filesByType.code.push(entryName);
        try {
          const content = entry.getData().toString("utf-8");
          extractedContents.push(`\n🌐 ${entryName}:\n${content.slice(0, 1500)}${content.length > 1500 ? "\n[...tronqué...]" : ""}`);
        } catch { }
      } else if (ext.match(/\.(pdf|doc|docx|odt|rtf)$/i)) {
        filesByType.documents.push(entryName);
      } else if (ext.match(/\.(xls|xlsx|ods)$/i)) {
        filesByType.data.push(entryName);
      } else if (ext.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|heic|heif|tiff|raw)$/i)) {
        filesByType.images.push(entryName);
      } else if (ext.match(/\.(mp3|wav|ogg|flac|aac|m4a|wma|aiff|opus)$/i)) {
        filesByType.audio.push(entryName);
      } else if (ext.match(/\.(mp4|webm|mov|avi|mkv|wmv|flv|m4v)$/i)) {
        filesByType.video.push(entryName);
      } else if (ext.match(/\.(zip|rar|7z|tar|gz|bz2)$/i)) {
        filesByType.archives.push(entryName);
      } else {
        filesByType.other.push(entryName);
      }
    }
    
    contentPreview = `📦 ANALYSE DE L'ARCHIVE: ${path.basename(filePath)}\n`;
    contentPreview += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    contentPreview += `📊 Statistiques:\n`;
    contentPreview += `   • Nombre total de fichiers: ${fileList.length}\n`;
    contentPreview += `   • Taille totale: ${this.formatFileSize(totalSize)}\n\n`;
    
    contentPreview += `📁 Contenu par type:\n`;
    if (filesByType.text.length > 0) {
      contentPreview += `   📄 Texte (${filesByType.text.length}): ${filesByType.text.slice(0, 5).join(", ")}${filesByType.text.length > 5 ? "..." : ""}\n`;
    }
    if (filesByType.code.length > 0) {
      contentPreview += `   💻 Code (${filesByType.code.length}): ${filesByType.code.slice(0, 5).join(", ")}${filesByType.code.length > 5 ? "..." : ""}\n`;
    }
    if (filesByType.documents.length > 0) {
      contentPreview += `   📝 Documents (${filesByType.documents.length}): ${filesByType.documents.slice(0, 5).join(", ")}${filesByType.documents.length > 5 ? "..." : ""}\n`;
    }
    if (filesByType.data.length > 0) {
      contentPreview += `   📋 Données (${filesByType.data.length}): ${filesByType.data.slice(0, 5).join(", ")}${filesByType.data.length > 5 ? "..." : ""}\n`;
    }
    if (filesByType.images.length > 0) {
      contentPreview += `   🖼️ Images (${filesByType.images.length}): ${filesByType.images.slice(0, 5).join(", ")}${filesByType.images.length > 5 ? "..." : ""}\n`;
    }
    if (filesByType.audio.length > 0) {
      contentPreview += `   🎵 Audio (${filesByType.audio.length}): ${filesByType.audio.slice(0, 5).join(", ")}${filesByType.audio.length > 5 ? "..." : ""}\n`;
    }
    if (filesByType.video.length > 0) {
      contentPreview += `   🎬 Vidéo (${filesByType.video.length}): ${filesByType.video.slice(0, 5).join(", ")}${filesByType.video.length > 5 ? "..." : ""}\n`;
    }
    if (filesByType.archives.length > 0) {
      contentPreview += `   📦 Archives imbriquées (${filesByType.archives.length}): ${filesByType.archives.slice(0, 3).join(", ")}${filesByType.archives.length > 3 ? "..." : ""}\n`;
    }
    if (filesByType.other.length > 0) {
      contentPreview += `   📎 Autres (${filesByType.other.length}): ${filesByType.other.slice(0, 3).join(", ")}${filesByType.other.length > 3 ? "..." : ""}\n`;
    }
    
    if (extractedContents.length > 0) {
      contentPreview += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      contentPreview += `📖 CONTENU EXTRAIT DES FICHIERS LISIBLES:\n`;
      const totalChars = extractedContents.join("").length;
      const maxChars = 15000;
      let currentChars = 0;
      for (const content of extractedContents) {
        if (currentChars + content.length > maxChars) {
          contentPreview += `\n[...${extractedContents.length - extractedContents.indexOf(content)} fichiers supplémentaires non affichés pour limiter la taille...]`;
          break;
        }
        contentPreview += content;
        currentChars += content.length;
      }
    }
    
    if (filesByType.audio.length > 0) {
      contentPreview += `\n\n🎵 NOTE: Cette archive contient ${filesByType.audio.length} fichier(s) audio. `;
      contentPreview += `Pour une transcription, extrais les fichiers et envoie-les individuellement.`;
    }
    
    return {
      fileName: path.basename(filePath),
      fileType: "zip",
      content: contentPreview,
      metadata: {
        fileCount: entries.length,
        totalSize,
        totalSizeFormatted: this.formatFileSize(totalSize),
        files: fileList,
        filesByType,
        hasAudio: filesByType.audio.length > 0,
        hasVideo: filesByType.video.length > 0,
        hasImages: filesByType.images.length > 0,
        hasDocuments: filesByType.documents.length > 0,
        hasCode: filesByType.code.length > 0,
        extractedTextCount: extractedContents.length
      }
    };
  }

  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  readImage(filePath: string): FileAnalysis {
    const ext = path.extname(filePath).toLowerCase().slice(1);
    const stats = fs.statSync(filePath);
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString("base64");
    const mimeType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
    
    return {
      fileName: path.basename(filePath),
      fileType: "image",
      content: `[IMAGE JOINTE: ${path.basename(filePath)}]\nCette image est envoyée pour analyse visuelle. Décris ce que tu vois et réponds à la demande de l'utilisateur.`,
      metadata: {
        mimeType,
        size: stats.size,
        base64: base64,
        imageDataUrl: `data:${mimeType};base64,${base64}`,
        imagePath: filePath,
        isImage: true
      }
    };
  }

  readVideo(filePath: string): FileAnalysis {
    const ext = path.extname(filePath).toLowerCase().slice(1);
    const stats = fs.statSync(filePath);
    const mimeTypes: Record<string, string> = {
      mp4: "video/mp4",
      webm: "video/webm",
      mov: "video/quicktime",
      avi: "video/x-msvideo",
      mkv: "video/x-matroska"
    };
    const mimeType = mimeTypes[ext] || `video/${ext}`;
    const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
    
    return {
      fileName: path.basename(filePath),
      fileType: "video",
      content: `[VIDEO JOINTE: ${path.basename(filePath)}]\nUne vidéo de ${sizeInMB} Mo a été envoyée. Format: ${ext.toUpperCase()}. La vidéo est stockée et accessible.`,
      metadata: {
        mimeType,
        size: stats.size,
        sizeInMB: parseFloat(sizeInMB),
        videoPath: filePath,
        isVideo: true,
        format: ext.toUpperCase()
      }
    };
  }
  
  getImageBase64(filePath: string): { base64: string; mimeType: string } | null {
    try {
      const ext = path.extname(filePath).toLowerCase().slice(1);
      const buffer = fs.readFileSync(filePath);
      const base64 = buffer.toString("base64");
      const mimeType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
      return { base64, mimeType };
    } catch {
      return null;
    }
  }

  async readFile(filePath: string): Promise<FileAnalysis> {
    const ext = path.extname(filePath).toLowerCase();
    
    switch (ext) {
      case ".pdf":
        return this.readPDF(filePath);
      case ".docx":
      case ".doc":
        return this.readWord(filePath);
      case ".xlsx":
      case ".xls":
        return await this.readExcel(filePath);
      case ".zip":
        return this.readZip(filePath);
      case ".jpg":
      case ".jpeg":
      case ".png":
      case ".gif":
      case ".webp":
      case ".heic":
      case ".heif":
        return this.readImage(filePath);
      case ".mp4":
      case ".webm":
      case ".mov":
      case ".avi":
      case ".mkv":
        return this.readVideo(filePath);
      default:
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, "utf-8");
          return {
            fileName: path.basename(filePath),
            fileType: ext.slice(1),
            content,
            metadata: {}
          };
        }
        throw new Error(`Type de fichier non supporté: ${ext}`);
    }
  }

  // Generate intelligent file name from title
  private generateFileName(title: string | undefined, extension: string, prefix = "document"): string {
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    
    if (title) {
      // Sanitize title for filename: remove special chars, limit length
      const sanitized = title
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
        .replace(/[^a-z0-9\s-]/g, "") // Keep only alphanumeric, spaces, hyphens
        .replace(/\s+/g, "_") // Replace spaces with underscores
        .slice(0, 40) // Limit length
        .replace(/_+$/, ""); // Remove trailing underscores
      
      return `${sanitized}_${timestamp}.${extension}`;
    }
    
    return `${prefix}_${timestamp}_${Date.now().toString(36)}.${extension}`;
  }

  async generatePDF(content: string, options: { title?: string; author?: string } = {}): Promise<GeneratedFile> {
    const fileName = this.generateFileName(options.title, "pdf", "document");
    const filePath = path.join(GENERATED_DIR, fileName);
    
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
      const stream = fs.createWriteStream(filePath);
      
      doc.pipe(stream);
      
      doc.font("Helvetica");
      
      if (options.title) {
        doc.fontSize(20).fillColor("#2c3e50").text(options.title, { align: "center" });
        doc.moveDown(0.3);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#3498db").lineWidth(2).stroke();
        doc.moveDown(1);
      }
      
      const lines = content.split("\n");
      for (const line of lines) {
        if (doc.y > 740) doc.addPage();
        if (line.startsWith("### ")) {
          doc.moveDown(0.5).fontSize(13).fillColor("#34495e").font("Helvetica-Bold").text(line.replace(/^###\s*/, ""));
          doc.font("Helvetica");
        } else if (line.startsWith("## ")) {
          doc.moveDown(0.5).fontSize(15).fillColor("#2c3e50").font("Helvetica-Bold").text(line.replace(/^##\s*/, ""));
          doc.font("Helvetica");
        } else if (line.startsWith("# ")) {
          doc.moveDown(0.5).fontSize(18).fillColor("#2c3e50").font("Helvetica-Bold").text(line.replace(/^#\s*/, ""));
          doc.font("Helvetica");
        } else if (line.startsWith("- ") || line.startsWith("* ")) {
          doc.fontSize(10).fillColor("#333").text(`  \u2022  ${line.replace(/^[-*]\s*/, "")}`, { indent: 15 });
        } else if (line.match(/^\d+\.\s/)) {
          doc.fontSize(10).fillColor("#333").text(`  ${line}`, { indent: 10 });
        } else if (line.startsWith("**") && line.endsWith("**")) {
          doc.fontSize(10).fillColor("#222").font("Helvetica-Bold").text(line.replace(/\*\*/g, ""));
          doc.font("Helvetica");
        } else if (line.trim() === "") {
          doc.moveDown(0.4);
        } else {
          doc.fontSize(10).fillColor("#333").text(line, { lineGap: 3 });
        }
      }

      doc.moveDown(2);
      if (doc.y > 740) doc.addPage();
      doc.fontSize(8).fillColor("#999").text(`Généré par Ulysse AI — ${new Date().toLocaleDateString("fr-FR")}`, { align: "center" });
      
      doc.end();
      
      stream.on("finish", () => {
        const stats = fs.statSync(filePath);
        resolve({
          fileName,
          filePath,
          fileType: "pdf",
          size: stats.size
        });
      });
      
      stream.on("error", reject);
    });
  }

  async generateWord(content: string, options: { title?: string } = {}): Promise<GeneratedFile> {
    const fileName = this.generateFileName(options.title, "docx", "document");
    const filePath = path.join(GENERATED_DIR, fileName);
    
    const paragraphs: Paragraph[] = [];
    
    if (options.title) {
      paragraphs.push(
        new Paragraph({
          text: options.title,
          heading: HeadingLevel.HEADING_1
        })
      );
    }
    
    const lines = content.split("\n");
    for (const line of lines) {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun(line)]
        })
      );
    }
    
    const doc = new Document({
      sections: [{
        properties: {},
        children: paragraphs
      }]
    });
    
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(filePath, buffer);
    
    const stats = fs.statSync(filePath);
    return {
      fileName,
      filePath,
      fileType: "docx",
      size: stats.size
    };
  }

  async generateExcel(data: unknown[][], options: { sheetName?: string; headers?: string[]; title?: string } = {}): Promise<GeneratedFile> {
    const fileName = this.generateFileName(options.title || options.sheetName, "xlsx", "tableau");
    const filePath = path.join(GENERATED_DIR, fileName);
    
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(options.sheetName || "Données");
    
    if (options.headers) {
      worksheet.addRow(options.headers);
    }
    
    for (const row of data) {
      worksheet.addRow(row);
    }
    
    await workbook.xlsx.writeFile(filePath);
    
    const stats = fs.statSync(filePath);
    return {
      fileName,
      filePath,
      fileType: "xlsx",
      size: stats.size
    };
  }

  async generateZip(files: Array<{ name: string; content: string | Buffer }>, options: { title?: string } = {}): Promise<GeneratedFile> {
    const fileName = this.generateFileName(options.title, "zip", "archive");
    const filePath = path.join(GENERATED_DIR, fileName);
    
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(filePath);
      const archive = archiver("zip", { zlib: { level: 9 } });
      
      output.on("close", () => {
        resolve({
          fileName,
          filePath,
          fileType: "zip",
          size: archive.pointer()
        });
      });
      
      archive.on("error", reject);
      archive.pipe(output);
      
      for (const file of files) {
        archive.append(file.content, { name: file.name });
      }
      
      archive.finalize();
    });
  }

  async zipDirectory(dirPath: string, outputName?: string): Promise<GeneratedFile> {
    const fileName = outputName || `backup_${Date.now()}.zip`;
    const filePath = path.join(GENERATED_DIR, fileName);
    
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(filePath);
      const archive = archiver("zip", { zlib: { level: 9 } });
      
      output.on("close", () => {
        resolve({
          fileName,
          filePath,
          fileType: "zip",
          size: archive.pointer()
        });
      });
      
      archive.on("error", reject);
      archive.pipe(output);
      archive.directory(dirPath, false);
      archive.finalize();
    });
  }

  extractZip(zipPath: string, outputDir?: string): string[] {
    const zip = new AdmZip(zipPath);
    const extractTo = outputDir || path.join(UPLOAD_DIR, `extracted_${Date.now()}`);
    
    zip.extractAllTo(extractTo, true);
    
    return zip.getEntries().map(e => path.join(extractTo, e.entryName));
  }

  getGeneratedFiles(): GeneratedFile[] {
    if (!fs.existsSync(GENERATED_DIR)) return [];
    
    const files = fs.readdirSync(GENERATED_DIR);
    return files.map(fileName => {
      const filePath = path.join(GENERATED_DIR, fileName);
      const stats = fs.statSync(filePath);
      const ext = path.extname(fileName).toLowerCase().slice(1);
      
      return {
        fileName,
        filePath,
        fileType: ext,
        size: stats.size
      };
    });
  }

  deleteGeneratedFile(fileName: string): boolean {
    const filePath = path.join(GENERATED_DIR, fileName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  }

  formatForAI(analysis: FileAnalysis): string {
    let formatted = `\n### Fichier: ${analysis.fileName} (${analysis.fileType.toUpperCase()})\n`;
    
    if (analysis.fileType === "xlsx") {
      const meta = analysis.metadata as { sheetNames: string[] };
      formatted += `Feuilles: ${meta.sheetNames.join(", ")}\n`;
    } else if (analysis.fileType === "zip") {
      const meta = analysis.metadata as { fileCount: number; files: string[] };
      formatted += `Contenu: ${meta.fileCount} fichiers\n`;
      formatted += `Fichiers: ${meta.files.slice(0, 10).join(", ")}${meta.files.length > 10 ? "..." : ""}\n`;
    } else if (analysis.fileType === "pdf") {
      const meta = analysis.metadata as { pages: number };
      formatted += `Pages: ${meta.pages}\n`;
    }
    
    const maxContent = 5000;
    if (analysis.content.length > maxContent) {
      formatted += `\nContenu (tronqué):\n${analysis.content.slice(0, maxContent)}...\n[${analysis.content.length - maxContent} caractères supplémentaires]`;
    } else {
      formatted += `\nContenu:\n${analysis.content}`;
    }
    
    return formatted;
  }
}

export const fileService = new FileService();
