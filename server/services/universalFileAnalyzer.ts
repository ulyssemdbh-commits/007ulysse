/** 
 * Universal File Analyzer for Ulysse
 * Handles all file types with AI-powered intelligent analysis
 * 
 * Supported formats:
 * - PDF (text extraction + AI analysis)
 * - Excel/CSV (table parsing + AI analysis)
 * - Word/DOCX (text extraction + AI analysis)
 * - Images (OCR + Vision AI analysis)
 * - Text files (direct AI analysis)
 * 
 * Security: Only allows files in approved directories
 * 
 * Integration:
 * - VisionHub: Sends all analyzed documents for visual tracking
 * - BrainHub: Stores important insights in working memory
 */

import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
let _ExcelJS: any = null;
async function getExcelJS() {
  if (!_ExcelJS) { try { _ExcelJS = (await import("exceljs")).default; } catch { console.warn("[FileAnalyzer] exceljs not available"); } }
  return _ExcelJS;
}
let _mammoth: any = null;
async function getMammoth() {
  if (!_mammoth) { try { _mammoth = (await import("mammoth")).default || await import("mammoth"); } catch { console.warn("[FileAnalyzer] mammoth not available"); } }
  return _mammoth;
}
import OpenAI from "openai";
import { visionHub } from "./sensory/VisionHub";
import { brainHub } from "./sensory/BrainHub";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Security: Allowed directories for file access (absolute paths resolved at runtime)
const ALLOWED_DIRECTORIES = [
  "uploads",
  "attached_assets", 
  "tmp",
  "suguval",
  "sugumaillane",
  "sugu"
];

const OWNER_CODE_DIRECTORIES = [
  "server",
  "client",
  "shared",
  "src",
  "lib",
  "test",
  "tests",
  "__tests__",
  "scripts",
  "config",
  "public",
];

/**
 * Security check: Validate file path is in allowed directory
 * Uses realpath to prevent symlink attacks
 */
function isPathAllowed(filePath: string, isOwner: boolean = false): boolean {
  try {
    let resolvedPath: string;
    try {
      resolvedPath = fs.realpathSync(filePath);
    } catch {
      resolvedPath = path.resolve(filePath);
    }
    
    const cwd = process.cwd();
    
    if (filePath.includes("..")) {
      console.warn(`[Security] Blocked path traversal: ${filePath}`);
      return false;
    }
    
    for (const allowed of ALLOWED_DIRECTORIES) {
      const allowedAbs = path.resolve(cwd, allowed);
      if (resolvedPath.startsWith(allowedAbs + path.sep) || resolvedPath === allowedAbs) {
        return true;
      }
    }
    
    if (isOwner) {
      for (const codeDir of OWNER_CODE_DIRECTORIES) {
        const codeDirAbs = path.resolve(cwd, codeDir);
        if (resolvedPath.startsWith(codeDirAbs + path.sep) || resolvedPath === codeDirAbs) {
          return true;
        }
      }
      if (resolvedPath.startsWith(cwd + path.sep) && !resolvedPath.includes("node_modules") && !resolvedPath.includes(".git")) {
        const ext = path.extname(resolvedPath).toLowerCase();
        const codeExts = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".css", ".html", ".md", ".yaml", ".yml", ".env.example", ".sql", ".sh", ".py"]);
        if (codeExts.has(ext)) {
          return true;
        }
      }
    }
    
    if (resolvedPath.startsWith("/tmp/") && !resolvedPath.includes("..")) {
      const realTmp = fs.realpathSync("/tmp");
      if (resolvedPath.startsWith(realTmp + "/")) {
        return true;
      }
    }
    
    console.warn(`[Security] Path not in allowed directories: ${resolvedPath}${isOwner ? " (owner)" : ""}`);
    return false;
  } catch (e) {
    console.error(`[Security] Path validation error: ${e}`);
    return false;
  }
}

// Lazy-loaded modules
let pdfParse: any = null;
let Tesseract: any = null;

export interface FileAnalysisResult {
  success: boolean;
  fileType: string;
  fileName: string;
  rawText: string;
  analysis: {
    documentType: string;
    summary: string;
    structuredData: any;
    confidence: number;
  };
  error?: string;
}

export interface InvoiceAnalysis {
  fournisseur: string;
  numeroFacture: string;
  date: string;
  totalHT: number;
  totalTVA: number;
  totalTTC: number;
  lignes: Array<{
    reference?: string;
    designation: string;
    quantite: number;
    prixUnitaire: number;
    montantHT: number;
    tva: number;
  }>;
  validated: boolean;
  validationDetails?: string;
}

export class UniversalFileAnalyzer {
  private static instance: UniversalFileAnalyzer;

  private constructor() {}

  static getInstance(): UniversalFileAnalyzer {
    if (!UniversalFileAnalyzer.instance) {
      UniversalFileAnalyzer.instance = new UniversalFileAnalyzer();
    }
    return UniversalFileAnalyzer.instance;
  }

  /**
   * Analyze any file with AI-powered intelligence
   */
  async analyzeFile(filePath: string, analysisType?: string, isOwner: boolean = false): Promise<FileAnalysisResult> {
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    if (!isPathAllowed(filePath, isOwner)) {
      console.warn(`[UniversalFileAnalyzer] Security: Blocked access to ${filePath}`);
      return {
        success: false,
        fileType: ext,
        fileName,
        rawText: "",
        analysis: { documentType: "blocked", summary: "", structuredData: null, confidence: 0 },
        error: "Accès au fichier non autorisé. Seuls les fichiers dans uploads/, attached_assets/, tmp/ sont accessibles."
      };
    }

    // Check file exists
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        fileType: ext,
        fileName,
        rawText: "",
        analysis: { documentType: "not_found", summary: "", structuredData: null, confidence: 0 },
        error: `Fichier non trouvé: ${fileName}`
      };
    }

    try {
      // Extract raw content based on file type
      let rawText = "";
      let fileType = "unknown";

      switch (ext) {
        case ".pdf":
          rawText = await this.extractPDF(filePath);
          fileType = "pdf";
          break;
        case ".xlsx":
        case ".xls":
          rawText = await this.extractExcel(filePath);
          fileType = "excel";
          break;
        case ".csv":
          rawText = await this.extractCSV(filePath);
          fileType = "csv";
          break;
        case ".docx":
        case ".doc":
          rawText = await this.extractWord(filePath);
          fileType = "word";
          break;
        case ".png":
        case ".jpg":
        case ".jpeg":
        case ".webp":
        case ".gif":
          rawText = await this.extractImage(filePath);
          fileType = "image";
          break;
        case ".txt":
        case ".md":
        case ".json":
        case ".ts":
        case ".tsx":
        case ".js":
        case ".jsx":
        case ".py":
        case ".html":
        case ".css":
        case ".scss":
        case ".sql":
        case ".yaml":
        case ".yml":
        case ".xml":
        case ".sh":
        case ".env":
        case ".toml":
        case ".ini":
        case ".cfg":
        case ".log":
          rawText = fs.readFileSync(filePath, "utf-8");
          fileType = ext === ".txt" || ext === ".md" || ext === ".log" ? "text" : "code";
          break;
        default:
          return {
            success: false,
            fileType: ext,
            fileName,
            rawText: "",
            analysis: { documentType: "unknown", summary: "", structuredData: null, confidence: 0 },
            error: `Format non supporté: ${ext}`
          };
      }

      if (!rawText || rawText.trim().length < 10) {
        return {
          success: false,
          fileType,
          fileName,
          rawText,
          analysis: { documentType: "unknown", summary: "", structuredData: null, confidence: 0 },
          error: "Impossible d'extraire le contenu du fichier"
        };
      }

      // AI-powered analysis
      const analysis = await this.analyzeWithAI(rawText, fileName, analysisType);

      // Integration with VisionHub - Send document to visual processing
      const mimeType = this.getMimeType(ext);
      visionHub.seeDocument(rawText, fileName, mimeType, 1).catch(err => {
        console.warn("[UniversalFileAnalyzer] VisionHub notification failed:", err.message);
      });

      // Integration with BrainHub - Store important insights
      if (analysis.documentType && analysis.confidence >= 70) {
        brainHub.addThought(
          `📄 Document analysé: ${fileName} - Type: ${analysis.documentType} (${analysis.confidence}% confiance)`,
          analysis.confidence
        );
        
        if (analysis.structuredData) {
          const dataPreview = JSON.stringify(analysis.structuredData).substring(0, 200);
          brainHub.addThought(`Données extraites: ${dataPreview}...`, 60);
        }
      }

      console.log(`[UniversalFileAnalyzer] ✅ ${fileName} analyzed, sent to VisionHub & BrainHub`);

      return {
        success: true,
        fileType,
        fileName,
        rawText: rawText.substring(0, 5000), // Truncate for response
        analysis
      };
    } catch (error) {
      console.error("[UniversalFileAnalyzer] Error:", error);
      return {
        success: false,
        fileType: ext,
        fileName,
        rawText: "",
        analysis: { documentType: "unknown", summary: "", structuredData: null, confidence: 0 },
        error: error instanceof Error ? error.message : "Erreur inconnue"
      };
    }
  }

  /**
   * Specialized invoice analysis with validation
   */
  async analyzeInvoice(filePath: string, isOwner: boolean = false): Promise<InvoiceAnalysis> {
    const result = await this.analyzeFile(filePath, "invoice", isOwner);
    
    if (!result.success) {
      throw new Error(result.error || "Échec de l'analyse");
    }

    // Use AI to extract invoice data with strict formatting
    const invoiceData = await this.extractInvoiceWithAI(result.rawText);
    
    // Mathematical validation
    const validated = this.validateInvoice(invoiceData);
    
    // Integration with BrainHub - Store COMPLETE invoice data (articles, prices, supplier)
    brainHub.storeInvoice({
      ...invoiceData,
      validated
    });
    
    console.log(`[UniversalFileAnalyzer] 🧾 Invoice ${invoiceData.numeroFacture} stored in BrainHub (${invoiceData.lignes.length} articles)`);
    
    return {
      ...invoiceData,
      validated,
      validationDetails: validated 
        ? "✓ Totaux validés mathématiquement" 
        : "⚠ Écart détecté dans les totaux"
    };
  }

  /**
   * Extract text from PDF
   */
  private async extractPDF(filePath: string): Promise<string> {
    if (!pdfParse) {
      try {
        const require = createRequire(import.meta.url || `file://${process.cwd()}/server/services/universalFileAnalyzer.ts`);
        pdfParse = require("pdf-parse");
      } catch (e) {
        console.error("[UniversalFileAnalyzer] Failed to load pdf-parse:", e);
        throw new Error("Module pdf-parse non disponible");
      }
    }

    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    console.log(`[UniversalFileAnalyzer] PDF extracted: ${data.numpages} pages, ${data.text.length} chars`);
    return data.text;
  }

  /**
   * Extract content from Excel
   */
  private async extractExcel(filePath: string): Promise<string> {
    const ext = path.extname(filePath).toLowerCase();
    const workbook = new ExcelJS.Workbook();
    
    try {
      if (ext === ".xlsx") {
        await workbook.xlsx.readFile(filePath);
      } else if (ext === ".xls") {
        // Try reading .xls - ExcelJS has limited support
        // First try as xlsx (some .xls are actually xlsx)
        try {
          await workbook.xlsx.readFile(filePath);
        } catch {
          // Fallback: read as CSV if possible, or signal format issue
          console.warn(`[UniversalFileAnalyzer] Legacy .xls format may have limited support`);
          const buffer = fs.readFileSync(filePath);
          await workbook.xlsx.load(buffer);
        }
      } else {
        await workbook.xlsx.readFile(filePath);
      }
    } catch (e: any) {
      console.error(`[UniversalFileAnalyzer] Excel read failed: ${e.message}`);
      throw new Error(`Format Excel non supporté. Pour les fichiers .xls anciens, convertissez en .xlsx`);
    }
    
    let content = "";
    workbook.eachSheet((sheet) => {
      content += `=== ${sheet.name} ===\n`;
      sheet.eachRow((row, rowNumber) => {
        const values = row.values as any[];
        if (values && values.length > 1) {
          content += values.slice(1).map(v => v?.toString() || "").join("\t") + "\n";
        }
      });
      content += "\n";
    });
    
    console.log(`[UniversalFileAnalyzer] Excel extracted: ${content.length} chars`);
    return content;
  }

  /**
   * Extract content from CSV
   */
  private async extractCSV(filePath: string): Promise<string> {
    return fs.readFileSync(filePath, "utf-8");
  }

  /**
   * Extract text from Word document
   */
  private async extractWord(filePath: string): Promise<string> {
    const buffer = fs.readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer });
    console.log(`[UniversalFileAnalyzer] Word extracted: ${result.value.length} chars`);
    return result.value;
  }

  /**
   * Extract text from image using OCR or Vision
   */
  private async extractImage(filePath: string): Promise<string> {
    // Try Tesseract OCR first
    try {
      if (!Tesseract) {
        Tesseract = await import("tesseract.js");
      }
      
      const worker = await Tesseract.createWorker("fra");
      const { data } = await worker.recognize(filePath);
      await worker.terminate();
      
      if (data.text && data.text.trim().length > 20) {
        console.log(`[UniversalFileAnalyzer] OCR extracted: ${data.text.length} chars`);
        return data.text;
      }
    } catch (e) {
      console.warn("[UniversalFileAnalyzer] OCR failed, trying Vision API");
    }

    // Fallback to GPT-4 Vision
    try {
      const base64 = fs.readFileSync(filePath).toString("base64");
      const ext = path.extname(filePath).toLowerCase().replace(".", "");
      const mimeType = ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/webp";

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Extrais tout le texte visible dans cette image. Retourne uniquement le texte brut, sans commentaires." },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } }
            ]
          }
        ],
        max_tokens: 4000
      });

      const text = response.choices[0]?.message?.content || "";
      console.log(`[UniversalFileAnalyzer] Vision extracted: ${text.length} chars`);
      return text;
    } catch (e) {
      console.error("[UniversalFileAnalyzer] Vision API failed:", e);
      throw new Error("Échec de l'extraction d'image");
    }
  }

  /**
   * AI-FIRST V7 UNIVERSAL - Analyse intelligente tous formats
   * Prompts spécialisés par type de document détecté automatiquement
   */
  private async analyzeWithAI(content: string, fileName: string, analysisType?: string): Promise<FileAnalysisResult["analysis"]> {
    // Détection automatique du type de document
    const detectedType = this.detectDocumentType(content, fileName, analysisType);
    console.log(`[UniversalFileAnalyzer AI-V7] Detected type: ${detectedType}`);
    
    // Prompt spécialisé selon le type
    const systemPrompt = this.getSpecializedPrompt(detectedType);
    const maxTokens = detectedType === "invoice" || detectedType === "report" || detectedType === "code" ? 8000 : 4000;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini", // Optimisé: 10x moins cher, aussi performant
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Analyse ce document "${fileName}":\n\n${content.substring(0, 80000)}` }
        ],
        response_format: { type: "json_object" },
        max_tokens: maxTokens,
        temperature: 0
      });

      const result = JSON.parse(response.choices[0]?.message?.content || "{}");
      console.log(`[UniversalFileAnalyzer] AI analysis: ${result.documentType}, confidence: ${result.confidence}%`);
      
      return {
        documentType: result.documentType || "unknown",
        summary: result.summary || "",
        structuredData: result.structuredData || result,
        confidence: result.confidence || 50
      };
    } catch (e) {
      console.error("[UniversalFileAnalyzer] AI analysis failed:", e);
      return {
        documentType: "unknown",
        summary: "Analyse IA non disponible",
        structuredData: null,
        confidence: 0
      };
    }
  }

  /**
   * AI-V7: Détection automatique du type de document
   */
  private detectDocumentType(content: string, fileName: string, hint?: string): string {
    const lowerContent = content.toLowerCase();
    const lowerName = fileName.toLowerCase();
    
    if (hint) return hint;
    
    const codeExtensions = [".ts", ".tsx", ".js", ".jsx", ".py", ".html", ".css", ".scss", ".sql", ".sh", ".yaml", ".yml", ".xml", ".toml"];
    const ext = "." + lowerName.split(".").pop();
    if (codeExtensions.includes(ext)) return "code";
    
    if (lowerName.includes("factur") || lowerName.includes("invoice")) return "invoice";
    if (lowerName.includes("rapport") || lowerName.includes("report")) return "report";
    if (lowerName.includes("contrat") || lowerName.includes("contract")) return "contract";
    if (lowerName.includes("devis") || lowerName.includes("quote")) return "quote";
    if (lowerName.includes("inventaire") || lowerName.includes("stock")) return "inventory";
    
    // Détection par contenu
    if (lowerContent.includes("facture") && (lowerContent.includes("total ttc") || lowerContent.includes("tva"))) return "invoice";
    if (lowerContent.includes("montant ht") && lowerContent.includes("montant ttc")) return "invoice";
    if (lowerContent.includes("bon de livraison") || lowerContent.includes("bl n°")) return "delivery";
    if (lowerContent.includes("devis") && lowerContent.includes("validité")) return "quote";
    if (lowerContent.includes("contrat") && lowerContent.includes("parties")) return "contract";
    if (lowerContent.includes("rapport") || lowerContent.includes("conclusion")) return "report";
    if (lowerContent.includes("inventaire") || lowerContent.includes("stock")) return "inventory";
    
    // Détection par structure (tableaux avec colonnes typiques)
    if (/réf|référence|désignation|quantité|prix|montant/i.test(content)) return "invoice";
    if (/article|produit|qté|pu|total/i.test(content)) return "invoice";
    
    return "generic";
  }

  /**
   * AI-V7: Prompts spécialisés par type de document
   */
  private getSpecializedPrompt(docType: string): string {
    const prompts: Record<string, string> = {
      invoice: `Tu es un expert comptable français. Analyse cette facture et extrait TOUTES les données en JSON.

RÈGLES STRICTES:
1. Identifie le fournisseur et le client
2. Extrait CHAQUE facture avec numéro, date, totaux (HT, TVA, TTC)
3. Extrait TOUTES les lignes produits: référence, désignation, quantité, prix unitaire HT, montant HT, taux TVA
4. Valide: quantité × prix = montant (±5% tolérance)
5. Détecte frais de livraison/transport

FORMAT JSON:
{
  "documentType": "invoice",
  "summary": "Résumé bref",
  "structuredData": {
    "fournisseur": "NOM",
    "client": "NOM CLIENT",
    "factures": [{
      "numero": "F123",
      "date": "DD/MM/YYYY",
      "totalHT": 123.45,
      "totalTVA": 6.79,
      "totalTTC": 130.24,
      "fraisLivraison": 0,
      "lignes": [{
        "reference": "12345",
        "designation": "PRODUIT XYZ",
        "quantite": 10,
        "prixUnitaire": 1.50,
        "montantHT": 15.00,
        "tva": 5.5
      }]
    }]
  },
  "confidence": 95
}`,

      report: `Tu es un expert en analyse de rapports. Extrait les informations clés de ce rapport.

FORMAT JSON:
{
  "documentType": "report",
  "summary": "Résumé exécutif du rapport",
  "structuredData": {
    "titre": "Titre du rapport",
    "auteur": "Auteur si identifié",
    "date": "Date du rapport",
    "sections": [{"titre": "...", "contenu": "..."}],
    "conclusions": ["Point clé 1", "Point clé 2"],
    "recommandations": ["Action 1", "Action 2"],
    "chiffresClés": {"métrique1": valeur1}
  },
  "confidence": 90
}`,

      inventory: `Tu es un expert en gestion de stocks. Extrait l'inventaire complet.

FORMAT JSON:
{
  "documentType": "inventory",
  "summary": "Résumé de l'inventaire",
  "structuredData": {
    "date": "Date inventaire",
    "lieu": "Emplacement",
    "totalArticles": 123,
    "valeurTotale": 12345.67,
    "articles": [{
      "reference": "REF123",
      "designation": "Produit",
      "quantite": 10,
      "prixUnitaire": 5.50,
      "valeur": 55.00,
      "emplacement": "Rayon A"
    }]
  },
  "confidence": 90
}`,

      contract: `Tu es un expert juridique. Analyse ce contrat et extrait les clauses clés.

FORMAT JSON:
{
  "documentType": "contract",
  "summary": "Résumé du contrat",
  "structuredData": {
    "type": "Type de contrat",
    "parties": [{"nom": "...", "role": "..."}],
    "dateSignature": "DD/MM/YYYY",
    "duree": "Durée du contrat",
    "montant": 1234.56,
    "clausesClés": ["Clause 1", "Clause 2"],
    "conditions": ["Condition 1"],
    "penalites": ["Pénalité si applicable"]
  },
  "confidence": 85
}`,

      quote: `Tu es un expert commercial. Analyse ce devis et extrait les informations.

FORMAT JSON:
{
  "documentType": "quote",
  "summary": "Résumé du devis",
  "structuredData": {
    "fournisseur": "Nom fournisseur",
    "client": "Nom client",
    "numero": "Numéro devis",
    "date": "DD/MM/YYYY",
    "validite": "Date fin validité",
    "totalHT": 1234.56,
    "totalTVA": 123.45,
    "totalTTC": 1358.01,
    "lignes": [{"designation": "...", "quantite": 1, "prixUnitaire": 100, "total": 100}]
  },
  "confidence": 90
}`,

      delivery: `Tu es un expert logistique. Analyse ce bon de livraison.

FORMAT JSON:
{
  "documentType": "delivery",
  "summary": "Résumé du BL",
  "structuredData": {
    "numero": "Numéro BL",
    "date": "DD/MM/YYYY",
    "expediteur": "Nom",
    "destinataire": "Nom",
    "adresse": "Adresse livraison",
    "articles": [{"reference": "...", "designation": "...", "quantite": 1}],
    "totalColis": 5,
    "observations": "Notes si présentes"
  },
  "confidence": 90
}`,

      code: `Tu es Ulysse, AI engineer spécialisé sur le repo ulysseproject (Node/TS, Express, React 18, Vite, Drizzle ORM, PostgreSQL).
Ton objectif: comprendre, diagnostiquer et améliorer le code comme un tech lead qui connaît le projet en profondeur.

CONTEXTE À DÉDUIRE:
- Localisation: server/ (backend Express/TS), client/ (frontend React/TS), shared/ (types/schema)
- Dépendances importantes (services appelés, hooks utilisés, schémas partagés)
- Rôle fonctionnel dans l'app (feature utilisateur, API métier, infra, tool interne)

POINTS D'ATTENTION PRIORITAIRES ULYSSEPROJECT:
- Sécurité: Auth/Session, endpoints sensibles (SUGU, finance, HubRise, Bets), accès par rôle (Ulysse/Iris/Alfred/owner)
- Robustesse intégrations: MARS, Spotify, Todoist, Notion, Gmail, HubRise, AppToOrder, TheOddsAPI, API-Football — timeouts, rate limits, réponses partielles
- Cohérence cerveau/mémoire: données Brain/cache, doublons, info sensible stockée trop large
- Performance: hooks React Query, re-renders, endpoints lourds, jobs homework, cache sports, SUGU

FORMAT JSON OBLIGATOIRE:
{
  "documentType": "code",
  "summary": "3-6 phrases: ce que fait le module, comment il s'intègre au reste, concepts clés utilisés",
  "structuredData": {
    "langage": "TypeScript/JavaScript/Python/etc.",
    "framework": "Express/React/Drizzle/etc.",
    "localisation": "server|client|shared|infra",
    "roleFonctionnel": "Rôle dans l'architecture globale",
    "imports": ["dépendances clés (pas toutes, les importantes)"],
    "exports": ["fonctions/classes/objets exportés"],
    "architectureEtPatterns": {
      "patternsUtilises": ["singleton", "scheduler", "factory", "middleware", "etc."],
      "separationResponsabilites": "bonne|moyenne|faible — pourquoi",
      "typingsQualite": "bonne|moyenne|faible"
    },
    "risquesEtBugs": [
      {"probleme": "description courte", "severite": "critique|important|mineur", "blocOuLigne": "indication si possible", "explication": "pourquoi c'est risqué"}
    ],
    "recommandations": {
      "quickWins": ["action rapide 1", "action rapide 2"],
      "refactorsStructurants": ["refactor important 1"],
      "testsManquants": ["test unitaire/intégration à ajouter"]
    },
    "metriques": {
      "lignesDeCode": 0,
      "complexite": "faible|moyenne|élevée",
      "maintenabilite6mois": "facile|gérable|risqué|ingérable"
    }
  },
  "confidence": 90
}

RÈGLES:
- Concis, direct, technique. Pas de bla-bla théorique.
- Toujours orienté repo réel, pas de recommandations génériques.
- Privilégier clarté > micro-optimisations prématurées.
- Pointer ce qui va devenir ingérable dans 6-12 mois.
- Si tu manques de contexte sur un service/fichier dépendant, le mentionner dans risquesEtBugs.`,

      generic: `Tu es un expert en analyse de documents. Analyse ce document et extrait les informations pertinentes.

FORMAT JSON:
{
  "documentType": "Type identifié",
  "summary": "Résumé concis du document",
  "structuredData": {
    "titre": "Titre si identifié",
    "date": "Date si présente",
    "auteur": "Auteur si identifié",
    "donnéesPrincipales": {...},
    "pointsClés": ["Point 1", "Point 2"]
  },
  "confidence": number (0-100)
}`
    };

    return prompts[docType] || prompts.generic;
  }

  /**
   * Extract invoice data with AI
   */
  private async extractInvoiceWithAI(content: string): Promise<Omit<InvoiceAnalysis, "validated" | "validationDetails">> {
    const systemPrompt = `Tu es un expert comptable français. Extrais les données de cette facture avec une précision absolue.

RÈGLES CRITIQUES:
1. Les montants doivent être exacts (pas d'arrondi)
2. Chaque ligne produit doit avoir: référence, désignation, quantité, prix unitaire, montant HT, TVA%
3. Transport = ligne séparée avec TVA 20%
4. Vérifie que totalHT + totalTVA = totalTTC

FORMAT JSON STRICT:
{
  "fournisseur": "string",
  "numeroFacture": "string", 
  "date": "DD/MM/YYYY",
  "totalHT": number,
  "totalTVA": number,
  "totalTTC": number,
  "lignes": [
    {
      "reference": "string ou null",
      "designation": "string",
      "quantite": number,
      "prixUnitaire": number,
      "montantHT": number,
      "tva": number (5.5, 10, 20, etc.)
    }
  ]
}`;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Extrais les données de cette facture:\n\n${content.substring(0, 20000)}` }
        ],
        response_format: { type: "json_object" },
        max_tokens: 8000,
        temperature: 0
      });

      const result = JSON.parse(response.choices[0]?.message?.content || "{}");
      
      console.log(`[UniversalFileAnalyzer] Invoice extracted: ${result.fournisseur}, ${result.lignes?.length || 0} lines`);
      
      return {
        fournisseur: result.fournisseur || "Inconnu",
        numeroFacture: result.numeroFacture || "",
        date: result.date || "",
        totalHT: parseFloat(result.totalHT) || 0,
        totalTVA: parseFloat(result.totalTVA) || 0,
        totalTTC: parseFloat(result.totalTTC) || 0,
        lignes: (result.lignes || []).map((l: any) => ({
          reference: l.reference || null,
          designation: l.designation || "",
          quantite: parseFloat(l.quantite) || 0,
          prixUnitaire: parseFloat(l.prixUnitaire) || 0,
          montantHT: parseFloat(l.montantHT) || 0,
          tva: parseFloat(l.tva) || 5.5
        }))
      };
    } catch (e) {
      console.error("[UniversalFileAnalyzer] Invoice extraction failed:", e);
      throw new Error("Échec de l'extraction de la facture");
    }
  }

  /**
   * Mathematical validation of invoice
   */
  private validateInvoice(invoice: Omit<InvoiceAnalysis, "validated" | "validationDetails">): boolean {
    let valid = true;
    const errors: string[] = [];
    
    // STRICT: Check HT + TVA = TTC (tolerance: 1 centime)
    const calculatedTTC = invoice.totalHT + invoice.totalTVA;
    const ttcDiff = Math.abs(calculatedTTC - invoice.totalTTC);
    
    if (ttcDiff > 0.02) {
      errors.push(`TTC: calculé ${calculatedTTC.toFixed(2)} ≠ déclaré ${invoice.totalTTC.toFixed(2)}`);
      valid = false;
    }

    // STRICT: Check sum of lines = totalHT (tolerance: 1 centime per line)
    if (invoice.lignes.length > 0) {
      const sumHT = invoice.lignes.reduce((sum, l) => sum + l.montantHT, 0);
      const htDiff = Math.abs(sumHT - invoice.totalHT);
      const maxRoundingTolerance = invoice.lignes.length * 0.01; // 1 cent per line
      
      if (htDiff > Math.max(0.05, maxRoundingTolerance)) {
        errors.push(`Total HT: somme lignes ${sumHT.toFixed(2)} ≠ déclaré ${invoice.totalHT.toFixed(2)}`);
        valid = false;
      }
    }

    // STRICT: Validate EVERY line: qté × PU = montant
    for (const line of invoice.lignes) {
      const calculated = line.quantite * line.prixUnitaire;
      const diff = Math.abs(calculated - line.montantHT);
      
      // Tolerance: 2 cents (minimal rounding)
      if (diff > 0.02) {
        errors.push(`Ligne "${line.designation.substring(0, 30)}": ${line.quantite} × ${line.prixUnitaire.toFixed(2)} = ${calculated.toFixed(2)} ≠ ${line.montantHT.toFixed(2)}`);
        valid = false;
      }
    }
    
    if (!valid) {
      console.warn(`[UniversalFileAnalyzer] VALIDATION FAILED (${errors.length} errors):`);
      errors.forEach(e => console.warn(`  - ${e}`));
    } else {
      console.log(`[UniversalFileAnalyzer] VALIDATION OK: ${invoice.lignes.length} lignes, TTC=${invoice.totalTTC.toFixed(2)}€`);
    }

    return valid;
  }

  /**
   * Get MIME type from extension
   */
  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      ".pdf": "application/pdf",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".xls": "application/vnd.ms-excel",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".doc": "application/msword",
      ".csv": "text/csv",
      ".txt": "text/plain",
      ".md": "text/markdown",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".ts": "text/typescript",
      ".tsx": "text/typescript",
      ".js": "text/javascript",
      ".jsx": "text/javascript",
      ".py": "text/x-python",
      ".html": "text/html",
      ".css": "text/css",
      ".scss": "text/x-scss",
      ".sql": "application/sql",
      ".yaml": "text/yaml",
      ".yml": "text/yaml",
      ".xml": "application/xml",
      ".sh": "text/x-shellscript",
      ".env": "text/plain",
      ".toml": "text/toml",
      ".ini": "text/plain",
      ".cfg": "text/plain",
      ".log": "text/plain"
    };
    return mimeTypes[ext] || "application/octet-stream";
  }

  /**
   * Batch analyze multiple files
   */
  async analyzeMultiple(filePaths: string[], analysisType?: string): Promise<FileAnalysisResult[]> {
    const results: FileAnalysisResult[] = [];
    
    for (const filePath of filePaths) {
      try {
        const result = await this.analyzeFile(filePath, analysisType);
        results.push(result);
      } catch (e) {
        results.push({
          success: false,
          fileType: path.extname(filePath),
          fileName: path.basename(filePath),
          rawText: "",
          analysis: { documentType: "error", summary: "", structuredData: null, confidence: 0 },
          error: e instanceof Error ? e.message : "Erreur inconnue"
        });
      }
    }
    
    return results;
  }
}

// Export singleton instance
export const universalFileAnalyzer = UniversalFileAnalyzer.getInstance();
