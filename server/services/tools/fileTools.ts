import type OpenAI from "openai";

type ChatCompletionTool = OpenAI.Chat.Completions.ChatCompletionTool;

// ── Tool definitions ────────────────────────────────────────────────────────

export const fileToolDefs: ChatCompletionTool[] = [
    // === UNIVERSAL FILE ANALYSIS ===
    {
        type: "function",
        function: {
            name: "analyze_file",
            description: "Analyse intelligente de n'importe quel fichier (PDF, Excel, Word, images, CSV). Utilise l'IA pour extraire et structurer les données. Pour les factures, extrait automatiquement: fournisseur, montants, lignes de produits avec validation mathématique.",
            parameters: {
                type: "object",
                properties: {
                    file_path: { type: "string", description: "Chemin du fichier à analyser" },
                    analysis_type: { type: "string", enum: ["auto", "invoice", "contract", "report", "data"], description: "Type d'analyse: auto (détection automatique), invoice (facture), contract, report, data" }
                },
                required: ["file_path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "analyze_invoice",
            description: "Analyse spécialisée d'une facture avec extraction précise de toutes les données: fournisseur, numéro, date, totaux HT/TVA/TTC, lignes de produits (référence, désignation, quantité, prix unitaire, montant). Validation mathématique automatique.",
            parameters: {
                type: "object",
                properties: {
                    file_path: { type: "string", description: "Chemin du fichier facture (PDF, image, etc.)" }
                },
                required: ["file_path"]
            }
        }
    },
    // === UNIVERSAL FILE GENERATION ===
    {
        type: "function",
        function: {
            name: "generate_file",
            description: `Génère un VRAI fichier natif (Excel, CSV, PDF, Word). Le PDF est un vrai .pdf natif via pdfkit, PAS du HTML.
✅ format="pdf" → génère un VRAI fichier PDF téléchargeable directement. 
⚠️ RÈGLE CRITIQUE POUR EXPORTS DE FACTURES/DONNÉES:
- Tu DOIS passer les vraies données dans "data" (tableau d'objets)
- NE PAS passer une description vague dans content_description
- Chaque ligne du tableau = un objet avec les valeurs exactes

EXEMPLE CORRECT pour export facture:
{
  "format": "excel",
  "data": [
    {"Réf": "F2256V", "Désignation": "FILET DE POULET", "Qté": 55.43, "PU_HT": 13.30, "Total_HT": 737.22},
    {"Réf": "13342", "Désignation": "CUISSES DE POULET", "Qté": 20.5, "PU_HT": 4.50, "Total_HT": 92.25}
  ],
  "file_name": "Export_Facture",
  "title": "Articles Janvier 2026"
}`,
            parameters: {
                type: "object",
                properties: {
                    format: { type: "string", enum: ["excel", "csv", "pdf", "word", "json", "markdown"], description: "Format de sortie" },
                    data: {
                        type: "array",
                        items: { type: "object" },
                        description: "⚠️ OBLIGATOIRE pour exports factures: Tableau d'objets avec les VRAIES données (Réf, Désignation, Qté, Prix, etc.)"
                    },
                    content_description: { type: "string", description: "⚠️ NE PAS UTILISER pour exports de données - utiliser 'data' à la place" },
                    file_name: { type: "string", description: "Nom du fichier (sans extension)" },
                    title: { type: "string", description: "Titre du document" }
                },
                required: ["format"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "export_analysis",
            description: "Exporte les résultats d'une analyse de fichier vers un nouveau format (Excel, PDF, etc.). Utile pour convertir les données extraites d'une facture en tableau Excel.",
            parameters: {
                type: "object",
                properties: {
                    analysis_data: { type: "object", description: "Données d'analyse à exporter" },
                    export_format: { type: "string", enum: ["excel", "csv", "pdf", "markdown"], description: "Format d'export" },
                    file_name: { type: "string", description: "Nom du fichier de sortie" }
                },
                required: ["analysis_data", "export_format"]
            }
        }
    },
    // === EXPORT FACTURE AUTOMATIQUE ===
    {
        type: "function",
        function: {
            name: "export_invoice_excel",
            description: `🎯 UTILISE CE TOOL pour exporter des factures en Excel.
Génère automatiquement l'Excel avec TOUTES les lignes d'articles.

⚠️ IMPORTANT: Passe le rapport markdown COMPLET dans "invoice_report" si tu l'as déjà.
Le rapport contient les tableaux avec Réf, Désignation, Qté, PU HT, Total HT, TVA.

QUAND L'UTILISER:
- L'utilisateur demande un Excel des factures/achats
- Tu as déjà analysé le PDF et affiché le rapport
- L'utilisateur veut un tableau filtrable/triable des produits`,
            parameters: {
                type: "object",
                properties: {
                    invoice_report: { type: "string", description: "⚠️ OBLIGATOIRE: Le rapport markdown COMPLET des factures (avec tous les tableaux d'articles)" },
                    file_name: { type: "string", description: "Nom du fichier Excel de sortie" },
                    fournisseur: { type: "string", description: "Nom du fournisseur" }
                },
                required: ["invoice_report"]
            }
        }
    ,
    {
        type: "function",
        function: {
            name: "generate_invoice_pdf",
            description: `Genere un VRAI PDF de FACTURE avec mise en page professionnelle (en-tete, tableau, totaux, TVA).
Utilise ce tool quand l'utilisateur veut creer, modifier ou reproduire une facture PDF.
Tu DOIS fournir TOUTES les donnees structurees de la facture.`,
            parameters: {
                type: "object",
                properties: {
                    emetteur: {
                        type: "object",
                        description: "Emetteur de la facture",
                        properties: {
                            nom: { type: "string" },
                            adresse: { type: "string" },
                            tel: { type: "string" },
                            siret: { type: "string" },
                            rcs: { type: "string" }
                        },
                        required: ["nom"]
                    },
                    client: {
                        type: "object",
                        description: "Client destinataire",
                        properties: {
                            nom: { type: "string" },
                            adresse: { type: "string" }
                        },
                        required: ["nom"]
                    },
                    numero: { type: "string", description: "Numero de facture" },
                    date: { type: "string", description: "Date de la facture" },
                    code_client: { type: "string", description: "Code client si present" },
                    chantier: { type: "string", description: "Reference chantier" },
                    lignes: {
                        type: "array",
                        description: "Lignes de la facture",
                        items: {
                            type: "object",
                            properties: {
                                designation: { type: "string" },
                                unite: { type: "string" },
                                quantite: { type: "number" },
                                prix_unitaire: { type: "number" },
                                tva_taux: { type: "number", description: "Taux TVA en % (0 = exonere)" },
                                remise: { type: "number", description: "Remise en %" }
                            },
                            required: ["designation", "prix_unitaire"]
                        }
                    },
                    acompte: { type: "number", description: "Montant acompte deja verse" },
                    file_name: { type: "string", description: "Nom du fichier PDF" },
                    mentions_legales: { type: "string" }
                },
                required: ["emetteur", "client", "numero", "date", "lignes"]
            }
        }
    }
];

// ── Handler implementations ─────────────────────────────────────────────────

export async function executeAnalyzeFile(args: { file_path: string; analysis_type?: string }): Promise<string> {
    try {
        const { universalFileAnalyzer } = await import("../universalFileAnalyzer");

        const result = await universalFileAnalyzer.analyzeFile(args.file_path, args.analysis_type);

        if (!result.success) {
            return JSON.stringify({
                success: false,
                error: result.error || "Échec de l'analyse"
            });
        }

        console.log(`[FileAnalysis] ${result.fileName}: ${result.analysis.documentType}, confidence: ${result.analysis.confidence}%`);

        return JSON.stringify({
            success: true,
            fileName: result.fileName,
            fileType: result.fileType,
            documentType: result.analysis.documentType,
            summary: result.analysis.summary,
            structuredData: result.analysis.structuredData,
            confidence: result.analysis.confidence,
            rawTextPreview: result.rawText.substring(0, 500) + "..."
        });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[FileAnalysis] Error:", msg);
        return JSON.stringify({ success: false, error: msg });
    }
}

export async function executeAnalyzeInvoice(args: { file_path: string }): Promise<string> {
    try {
        const { universalFileAnalyzer } = await import("../universalFileAnalyzer");

        const invoice = await universalFileAnalyzer.analyzeInvoice(args.file_path);

        console.log(`[InvoiceAnalysis] ${invoice.fournisseur} - ${invoice.numeroFacture}: ${invoice.lignes.length} lignes, validated: ${invoice.validated}`);

        return JSON.stringify({
            success: true,
            fournisseur: invoice.fournisseur,
            numeroFacture: invoice.numeroFacture,
            date: invoice.date,
            totalHT: invoice.totalHT,
            totalTVA: invoice.totalTVA,
            totalTTC: invoice.totalTTC,
            lignes: invoice.lignes,
            nombreLignes: invoice.lignes.length,
            validated: invoice.validated,
            validationDetails: invoice.validationDetails
        });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[InvoiceAnalysis] Error:", msg);
        return JSON.stringify({ success: false, error: msg });
    }
}

export async function executeGenerateFile(args: {
    format: "excel" | "csv" | "pdf" | "word" | "json" | "markdown";
    content_description?: string;
    data?: any;
    file_name?: string;
    title?: string;
}): Promise<string> {
    try {
        const { fileGenerator } = await import("../universalFileGenerator");

        const { format, content_description, data, file_name, title } = args;

        console.log(`[FileGenerator] Generating ${format}: ${file_name || content_description}`);

        // ⚠️ RÈGLE CRITIQUE: Pour Excel/CSV, EXIGER les vraies données
        if ((format === "excel" || format === "csv") && !data) {
            console.error(`[FileGenerator] ❌ REJETÉ: Excel/CSV sans données structurées`);
            return JSON.stringify({
                success: false,
                error: `❌ ERREUR: Pour générer un Excel/CSV, tu DOIS passer les vraies données dans "data".

EXEMPLE OBLIGATOIRE:
{
  "format": "excel",
  "data": [
    {"Réf": "F2256V", "Désignation": "FILET DE POULET", "Qté": 55.43, "PU_HT": 13.30, "Total_HT": 737.22},
    {"Réf": "13342", "Désignation": "CUISSES DE POULET", "Qté": 20.5, "PU_HT": 4.50}
  ],
  "file_name": "Export_Facture"
}

⚠️ Tu as les données dans le rapport - extrais chaque ligne et passe-les dans "data"!`
            });
        }

        let result;

        // Si description fournie, utiliser l'AI pour générer le contenu
        if (content_description && !data) {
            result = await fileGenerator.generateWithAI(content_description, format, { title });
        } else if (data) {
            // Sinon utiliser les données fournies
            result = await fileGenerator.generate({
                type: format,
                content: data,
                fileName: file_name,
                options: { title }
            });
        } else {
            return JSON.stringify({
                success: false,
                error: "Fournir soit content_description (génération AI) soit data (données brutes)"
            });
        }

        if (result.success) {
            console.log(`[FileGenerator] ✅ Generated: ${result.fileName} (${result.size} bytes)`);
            return JSON.stringify({
                success: true,
                message: `Fichier ${result.fileName} généré avec succès`,
                fileName: result.fileName,
                fileType: result.fileType,
                size: result.size,
                downloadUrl: result.downloadUrl
            });
        } else {
            return JSON.stringify({ success: false, error: result.error });
        }
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[FileGenerator] Error:", msg);
        return JSON.stringify({ success: false, error: msg });
    }
}

export async function executeExportAnalysis(args: {
    analysis_data: any;
    export_format: "excel" | "csv" | "pdf" | "markdown";
    file_name?: string;
}): Promise<string> {
    try {
        const { fileGenerator } = await import("../universalFileGenerator");

        const { analysis_data, export_format, file_name } = args;

        console.log(`[ExportAnalysis] Exporting to ${export_format}`);

        const result = await fileGenerator.generateReport(analysis_data, export_format);

        if (result.success) {
            console.log(`[ExportAnalysis] ✅ Exported: ${result.fileName}`);
            return JSON.stringify({
                success: true,
                message: `Export ${result.fileName} créé avec succès`,
                fileName: result.fileName,
                fileType: result.fileType,
                size: result.size,
                downloadUrl: result.downloadUrl
            });
        } else {
            return JSON.stringify({ success: false, error: result.error });
        }
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[ExportAnalysis] Error:", msg);
        return JSON.stringify({ success: false, error: msg });
    }
}

export async function executeExportInvoiceExcel(args: {
    invoice_report: string;
    file_name?: string;
    fournisseur?: string;
}): Promise<string> {
    try {
        const { fileGenerator } = await import("../universalFileGenerator");

        const { invoice_report, file_name, fournisseur } = args;

        console.log(`[ExportInvoiceExcel] 🎯 Parsing rapport markdown (${invoice_report.length} chars)`);

        // Parser le rapport markdown pour extraire les lignes d'articles
        const excelData: any[] = [];
        let currentFacture = "";
        let currentDate = "";

        // Regex pour les en-têtes de facture: ### F212340802 - 31/12/2025 (305,67 €)
        const factureHeaderRegex = /###\s+(F\d+)\s+-\s+(\d{2}\/\d{2}\/\d{2,4})/g;

        // Regex pour les lignes de tableau: | 13342 | HEN FEUILLES DE BRICKS 170G | 10 | 1,30 € | 13,00 € | 5.5% |
        const tableRowRegex = /\|\s*([A-Z0-9]+)\s*\|\s*(.+?)\s*\|\s*([\d.,]+)\s*\|\s*([\d.,]+)\s*€?\s*\|\s*([\d.,]+)\s*€?\s*\|\s*([\d.,]+)%?\s*\|/g;

        // Split par sections de facture
        const sections = invoice_report.split(/###\s+F\d+\s+-/);
        const headers = [...invoice_report.matchAll(/###\s+(F\d+)\s+-\s+(\d{2}\/\d{2}\/\d{2,4})/g)];

        for (let i = 0; i < headers.length; i++) {
            const match = headers[i];
            currentFacture = match[1];
            currentDate = match[2];

            // Trouver la section correspondante
            const sectionContent = sections[i + 1] || "";

            // Extraire les lignes de tableau
            const lines = sectionContent.split('\n');
            for (const line of lines) {
                // Skip header rows
                if (line.includes('Réf') || line.includes('---')) continue;

                const rowMatch = line.match(/\|\s*([A-Z0-9]+)\s*\|\s*(.+?)\s*\|\s*([\d.,]+)\s*\|\s*([\d.,]+)\s*€?\s*\|\s*([\d.,]+)\s*€?\s*\|\s*([\d.,]+)%?\s*\|/);
                if (rowMatch) {
                    excelData.push({
                        "N° Facture": currentFacture,
                        "Date": currentDate,
                        "Réf": rowMatch[1].trim(),
                        "Désignation": rowMatch[2].trim(),
                        "Qté": parseFloat(rowMatch[3].replace(',', '.')),
                        "PU HT": parseFloat(rowMatch[4].replace(',', '.')),
                        "Total HT": parseFloat(rowMatch[5].replace(',', '.')),
                        "TVA %": rowMatch[6].trim() + "%",
                        "Fournisseur": fournisseur || "Zouaghi"
                    });
                }
            }
        }

        console.log(`[ExportInvoiceExcel] Parsed ${excelData.length} lignes d'articles`);

        if (excelData.length === 0) {
            return JSON.stringify({
                success: false,
                error: "Aucune ligne d'article trouvée dans le rapport. Vérifie que le rapport contient des tableaux avec Réf, Désignation, Qté, etc."
            });
        }

        // Générer l'Excel
        const outputName = file_name || `Export_${fournisseur || 'Factures'}_${new Date().toISOString().split('T')[0]}`;

        const result = await fileGenerator.generate({
            type: "excel",
            content: excelData,
            fileName: outputName,
            options: { title: `Factures ${fournisseur || 'Export'}` }
        });

        if (result.success) {
            console.log(`[ExportInvoiceExcel] ✅ Excel généré: ${result.fileName} (${result.size} bytes, ${excelData.length} lignes)`);
            return JSON.stringify({
                success: true,
                message: `✅ Excel généré avec ${excelData.length} lignes d'articles`,
                fileName: result.fileName,
                fileType: result.fileType,
                size: result.size,
                downloadUrl: result.downloadUrl,
                lignesExportees: excelData.length,
                fournisseur: fournisseur || "Zouaghi"
            });
        } else {
            return JSON.stringify({ success: false, error: result.error });
        }
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[ExportInvoiceExcel] Error:", msg);
        return JSON.stringify({ success: false, error: msg });
    }
}

export async function executeGenerateInvoicePdf(args: {
    emetteur: { nom: string; adresse?: string; tel?: string; siret?: string; rcs?: string };
    client: { nom: string; adresse?: string };
    numero: string;
    date: string;
    chantier?: string;
    lignes: Array<{ designation: string; unite?: string; quantite?: number; prix_unitaire: number; tva_taux?: number; remise?: number }>;
    acompte?: number;
    file_name?: string;
    mentions_legales?: string;
}): Promise<string> {
    try {
        const { fileGenerator } = await import("../universalFileGenerator");
        const fileName = (args.file_name || `Facture_${args.numero}`).replace(/[^a-zA-Z0-9_-]/g, "_");
        console.log(`[InvoicePDF] Generating: ${fileName}`);
        
        const result = await fileGenerator.generateInvoicePDF({
            emetteur: args.emetteur,
            client: args.client,
            numero: args.numero,
            date: args.date,
            chantier: args.chantier,
            lignes: args.lignes,
            acompte: args.acompte,
            mentions_legales: args.mentions_legales
        }, fileName);

        if (result.success) {
            // Persist to DB
            try {
                const { storage } = await import("../../storage");
                await storage.createFile({
                    userId: 1,
                    originalName: result.fileName,
                    storedPath: result.filePath,
                    mimeType: "application/pdf",
                    size: result.size,
                    personaId: "ulysse"
                });
                console.log(`[InvoicePDF] Saved to DB: ${result.fileName}`);
            } catch {}
            
            console.log(`[InvoicePDF] Generated: ${result.fileName} (${result.size} bytes)`);
            return JSON.stringify({
                success: true,
                message: `Facture PDF generee: ${result.fileName}`,
                fileName: result.fileName,
                fileType: "pdf",
                size: result.size,
                downloadUrl: result.downloadUrl
            });
        }
        return JSON.stringify({ success: false, error: result.error });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[InvoicePDF] Error:", msg);
        return JSON.stringify({ success: false, error: msg });
    }
}
