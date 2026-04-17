/**
 * VISION HUB - Centre Visuel Unifié d'Ulysse
 * 
 * Point d'entrée unique pour TOUT ce qu'Ulysse voit, quelle que soit la source.
 * Collecte, analyse et normalise les données visuelles pour le cerveau.
 * 
 * Sources supportées:
 * - Screen Monitor (capture d'écran en temps réel)
 * - Web Scraping (extraction de contenu web)
 * - Web Crawling (exploration multi-pages)
 * - Screenshots (analyse de captures)
 * - OCR (reconnaissance de texte dans images)
 * - Documents (PDFs, images partagées)
 * 
 * Architecture:
 * [Source Visuelle] → VisionHub → [Analyse + Extraction] → [Cerveau]
 */

import { storage } from "../../storage";

// ============== TYPES ==============

export type VisionSource = 
  | "screen_monitor"    // Capture d'écran temps réel
  | "web_scrape"        // Scraping d'une page
  | "web_crawl"         // Crawling multi-pages
  | "screenshot"        // Screenshot d'URL
  | "document"          // Document partagé (PDF, image)
  | "camera"            // Caméra (futur)
  | "ocr"               // OCR sur image
  | "payroll_pdf"       // Bulletin de paie PDF
  | "invoice_pdf"       // Facture fournisseur PDF
  | "studio_media";     // Média Studio (image/vidéo)

export type ContentType = 
  | "webpage"
  | "application" 
  | "document"
  | "image"
  | "video"
  | "table"
  | "form";

export interface VisionMetadata {
  source: VisionSource;
  contentType: ContentType;
  timestamp: number;
  userId: number;
  
  // Contexte URL (si applicable)
  urlContext?: {
    url: string;
    domain: string;
    title?: string;
  };
  
  // Contexte Screen Monitor
  screenContext?: {
    sessionId: number;
    appName?: string;
    windowTitle?: string;
    frameNumber: number;
  };
  
  // Contexte Document
  documentContext?: {
    filename: string;
    mimeType: string;
    pageCount?: number;
  };
}

export interface VisionInput {
  rawData: Buffer | string;  // Image base64 ou texte extrait
  metadata: VisionMetadata;
  extractedText?: string;    // Texte déjà extrait (OCR, scraping)
  structuredData?: any;      // Données structurées (tables, formulaires)
}

export interface VisualInsight {
  type: "summary" | "entity" | "action" | "pattern" | "alert";
  content: string;
  confidence: number;
  metadata?: Record<string, any>;
}

export interface ProcessedVision {
  source: VisionSource;
  contentType: ContentType;
  timestamp: number;
  userId: number;
  
  // Données extraites
  text?: string;              // Texte extrait
  structuredData?: any;       // Données structurées
  entities?: string[];        // Entités détectées
  insights: VisualInsight[];  // Insights générés
  
  // Contexte enrichi
  urlContext?: VisionMetadata["urlContext"];
  screenContext?: VisionMetadata["screenContext"];
  
  // Métriques
  processingMs: number;
  analysisDepth: "shallow" | "deep";
}

// ============== STATISTIQUES ==============

interface VisionStats {
  totalInputs: number;
  bySource: Record<VisionSource, number>;
  byContentType: Record<ContentType, number>;
  avgProcessingMs: number;
  totalTextExtracted: number;
  insightsGenerated: number;
}

// ============== SERVICE PRINCIPAL ==============

class VisionHubService {
  private stats: VisionStats = {
    totalInputs: 0,
    bySource: {
      screen_monitor: 0,
      web_scrape: 0,
      web_crawl: 0,
      screenshot: 0,
      document: 0,
      camera: 0,
      ocr: 0,
      payroll_pdf: 0,
      invoice_pdf: 0,
      studio_media: 0,
    },
    byContentType: {
      webpage: 0,
      application: 0,
      document: 0,
      image: 0,
      video: 0,
      table: 0,
      form: 0
    },
    avgProcessingMs: 0,
    totalTextExtracted: 0,
    insightsGenerated: 0
  };

  private listeners: Array<(vision: ProcessedVision) => void> = [];
  
  // Cache pour éviter les analyses répétées
  private analysisCache: Map<string, { result: ProcessedVision; expiresAt: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    console.log("[VisionHub] Centre visuel unifié initialisé");
    
    // Nettoyage du cache périodique
    setInterval(() => this.cleanupCache(), 60000);
  }

  /**
   * Point d'entrée principal - Reçoit et analyse tout ce qu'Ulysse voit
   */
  async see(input: VisionInput): Promise<ProcessedVision> {
    const startTime = Date.now();
    this.stats.totalInputs++;
    this.stats.bySource[input.metadata.source]++;
    this.stats.byContentType[input.metadata.contentType]++;

    console.log(`[VisionHub] 👁️ Input reçu: source=${input.metadata.source}, type=${input.metadata.contentType}`);

    try {
      const { brainPulse, brainFocus } = await import("./BrainPulse");
      brainPulse("sensory", `vision:${input.metadata.source}`, `voit ${input.metadata.contentType}`, { userId: (input.metadata as any).userId, intensity: 2 });
      brainFocus("observing");
    } catch { /* best-effort */ }

    try {
      // 1. Vérifier le cache
      const cacheKey = this.buildCacheKey(input);
      const cached = this.analysisCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        console.log(`[VisionHub] Cache hit pour ${input.metadata.source}`);
        return cached.result;
      }

      // 2. Extraire le texte si pas déjà fait
      let extractedText = input.extractedText;
      if (!extractedText && typeof input.rawData === 'string') {
        extractedText = input.rawData;
      }

      // 3. Détecter les entités
      const entities = this.extractEntities(extractedText || '');

      // 4. Générer les insights selon la source
      const insights = await this.generateInsights(input, extractedText);

      // 5. Construire le résultat
      const processed: ProcessedVision = {
        source: input.metadata.source,
        contentType: input.metadata.contentType,
        timestamp: input.metadata.timestamp,
        userId: input.metadata.userId,
        text: extractedText,
        structuredData: input.structuredData,
        entities,
        insights,
        urlContext: input.metadata.urlContext,
        screenContext: input.metadata.screenContext,
        processingMs: Date.now() - startTime,
        analysisDepth: insights.length > 2 ? "deep" : "shallow"
      };

      // 6. Mettre en cache
      this.analysisCache.set(cacheKey, {
        result: processed,
        expiresAt: Date.now() + this.CACHE_TTL
      });

      // 7. Mettre à jour les stats
      if (extractedText) {
        this.stats.totalTextExtracted += extractedText.length;
      }
      this.stats.insightsGenerated += insights.length;
      this.updateAvgProcessingMs(processed.processingMs);

      // 8. Notifier les listeners
      this.notifyListeners(processed);

      console.log(`[VisionHub] ✅ Traité en ${processed.processingMs}ms: ${entities.length} entités, ${insights.length} insights`);
      
      return processed;

    } catch (error) {
      console.error("[VisionHub] Erreur de traitement:", error);
      
      return {
        source: input.metadata.source,
        contentType: input.metadata.contentType,
        timestamp: input.metadata.timestamp,
        userId: input.metadata.userId,
        insights: [],
        processingMs: Date.now() - startTime,
        analysisDepth: "shallow"
      };
    }
  }

  /**
   * Raccourci pour le Screen Monitor
   */
  async seeScreen(
    imageBase64: string,
    userId: number,
    screenContext: VisionMetadata["screenContext"]
  ): Promise<ProcessedVision> {
    return this.see({
      rawData: imageBase64,
      metadata: {
        source: "screen_monitor",
        contentType: "application",
        timestamp: Date.now(),
        userId,
        screenContext
      }
    });
  }

  /**
   * Raccourci pour le Web Scraping
   */
  async seeWebpage(
    extractedText: string,
    url: string,
    userId: number,
    structuredData?: any
  ): Promise<ProcessedVision> {
    const urlObj = new URL(url);
    return this.see({
      rawData: extractedText,
      extractedText,
      structuredData,
      metadata: {
        source: "web_scrape",
        contentType: "webpage",
        timestamp: Date.now(),
        userId,
        urlContext: {
          url,
          domain: urlObj.hostname,
          title: structuredData?.title
        }
      }
    });
  }

  /**
   * Raccourci pour les screenshots avec analyse Vision
   */
  async seeScreenshot(
    imageBase64: string,
    url: string,
    userId: number,
    analysis?: string
  ): Promise<ProcessedVision> {
    const urlObj = new URL(url);
    return this.see({
      rawData: imageBase64,
      extractedText: analysis,
      metadata: {
        source: "screenshot",
        contentType: "image",
        timestamp: Date.now(),
        userId,
        urlContext: {
          url,
          domain: urlObj.hostname
        }
      }
    });
  }

  /**
   * Raccourci pour les documents
   */
  async seeDocument(
    content: string,
    filename: string,
    mimeType: string,
    userId: number
  ): Promise<ProcessedVision> {
    return this.see({
      rawData: content,
      extractedText: content,
      metadata: {
        source: "document",
        contentType: "document",
        timestamp: Date.now(),
        userId,
        documentContext: {
          filename,
          mimeType
        }
      }
    });
  }

  /**
   * Enregistre un listener pour les nouvelles visions
   */
  onSee(callback: (vision: ProcessedVision) => void): () => void {
    this.listeners.push(callback);
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index > -1) this.listeners.splice(index, 1);
    };
  }

  /**
   * Retourne les statistiques du hub
   */
  getStats(): VisionStats {
    return { ...this.stats };
  }

  // ============== HELPERS PRIVÉS ==============

  private buildCacheKey(input: VisionInput): string {
    const { source, urlContext, screenContext } = input.metadata;
    
    if (urlContext) {
      return `${source}:${urlContext.url}`;
    }
    if (screenContext) {
      return `${source}:${screenContext.sessionId}:${screenContext.frameNumber}`;
    }
    
    // Hash du contenu pour les autres cas
    const hash = typeof input.rawData === 'string' 
      ? input.rawData.substring(0, 100).replace(/\s/g, '')
      : 'buffer';
    return `${source}:${hash}`;
  }

  private extractEntities(text: string): string[] {
    if (!text) return [];
    
    const entities: string[] = [];
    
    // Emails
    const emails = text.match(/[\w.-]+@[\w.-]+\.\w+/g);
    if (emails) entities.push(...emails.slice(0, 5));
    
    // URLs
    const urls = text.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/g);
    if (urls) entities.push(...urls.slice(0, 5));
    
    // Téléphones
    const phones = text.match(/(?:\+33|0)[1-9](?:[\s.-]?\d{2}){4}/g);
    if (phones) entities.push(...phones.slice(0, 3));
    
    // Montants
    const amounts = text.match(/\d+(?:[.,]\d+)?\s*(?:€|\$|EUR|USD)/gi);
    if (amounts) entities.push(...amounts.slice(0, 5));
    
    // Dates
    const dates = text.match(/\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/g);
    if (dates) entities.push(...dates.slice(0, 5));
    
    return [...new Set(entities)];
  }

  private async generateInsights(
    input: VisionInput, 
    extractedText?: string
  ): Promise<VisualInsight[]> {
    const insights: VisualInsight[] = [];
    
    // Insight basique: résumé du contenu
    if (extractedText && extractedText.length > 100) {
      insights.push({
        type: "summary",
        content: extractedText.substring(0, 200) + "...",
        confidence: 0.8
      });
    }

    // Insights spécifiques selon la source
    switch (input.metadata.source) {
      case "screen_monitor":
        if (input.metadata.screenContext?.appName) {
          insights.push({
            type: "entity",
            content: `Application active: ${input.metadata.screenContext.appName}`,
            confidence: 1.0,
            metadata: { appName: input.metadata.screenContext.appName }
          });
        }
        break;
        
      case "web_scrape":
      case "web_crawl":
        if (input.structuredData?.title) {
          insights.push({
            type: "entity",
            content: `Page: ${input.structuredData.title}`,
            confidence: 1.0,
            metadata: { title: input.structuredData.title }
          });
        }
        break;
    }

    return insights;
  }

  private updateAvgProcessingMs(newMs: number): void {
    const n = this.stats.totalInputs;
    this.stats.avgProcessingMs = ((n - 1) * this.stats.avgProcessingMs + newMs) / n;
  }

  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, value] of this.analysisCache.entries()) {
      if (value.expiresAt < now) {
        this.analysisCache.delete(key);
      }
    }
  }

  private notifyListeners(vision: ProcessedVision): void {
    this.listeners.forEach(listener => {
      try {
        listener(vision);
      } catch (error) {
        console.error("[VisionHub] Erreur dans listener:", error);
      }
    });
  }
}

// ============== EXPORT SINGLETON ==============

export const visionHub = new VisionHubService();
