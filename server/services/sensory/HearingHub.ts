/**
 * HEARING HUB - Centre d'Écoute Unifié d'Ulysse
 * 
 * Point d'entrée unique pour TOUT ce qu'Ulysse entend, quelle que soit la source.
 * Normalise les entrées audio/texte et les envoie au cerveau avec contexte enrichi.
 * 
 * Sources supportées:
 * - Web Voice (TalkingApp V3 Pro)
 * - Discord Voice  
 * - Text Chat (clavier)
 * - SMS/Messages externes
 * - API (programmatic)
 * 
 * Architecture:
 * [Audio/Texte] → HearingHub → [Normalisation + Enrichissement] → [Cerveau]
 */

import { detectIntent, type DetectedIntent } from "../voice/voiceIntentRouter";
import { resolveReferences, addContextSubject, hasReferencePattern, getSessionContext } from "../voice/voiceContextMemory";
import { storage } from "../../storage";
import { detectSentiment, recordSentiment, getCurrentMood, getAdaptiveInstructions, type Mood, type SentimentResult } from "../sentimentService";

export type UlysseDomain = 'sports' | 'sugu' | 'dev' | 'personal' | 'generic' | 'finance' | 'monitoring' | 'email' | 'studio';

// ============== TYPES ==============

export type HearingSource = 
  | "web_voice"      // TalkingApp V3 Pro
  | "discord_voice"  // Discord bot vocal
  | "web_chat"       // Chat texte web
  | "discord_text"   // Chat texte Discord
  | "api"            // API programmatique
  | "sms"            // SMS entrant
  | "email"          // Email (AgentMail)
  | "siri"           // Commande Siri
  | "system";        // Événement système

export type HearingType = "voice" | "text" | "command" | "notification";

export interface HearingMetadata {
  source: HearingSource;
  type: HearingType;
  timestamp: number;
  userId: number;
  persona: "ulysse" | "iris" | "alfred";
  
  // Contexte vocal (si applicable)
  voiceContext?: {
    confidence: number;        // Confiance STT
    speakerVerified: boolean;  // Locuteur vérifié
    language: string;
    durationMs: number;
  };
  
  // Contexte Discord (si applicable)
  discordContext?: {
    guildId: string;
    channelId: string;
    memberId: string;
    memberName: string;
  };
  
  // Contexte de conversation
  conversationId?: number;
  messageHistory?: Array<{ role: string; content: string }>;
}

export interface HearingInput {
  content: string;           // Texte (transcrit ou saisi)
  rawAudio?: Buffer;         // Audio brut (si disponible)
  metadata: HearingMetadata;
}

export interface ProcessedHearing {
  originalContent: string;
  resolvedContent: string;   // Après résolution des références ("il", "elle", etc.)
  intent: DetectedIntent | null;
  domain: UlysseDomain;      // Domaine global dérivé de l'intent
  metadata: HearingMetadata;
  contextSubjects: string[]; // Sujets actifs en mémoire
  isSystemCommand: boolean;
  shouldRouteToBrain: boolean;
  sentiment: SentimentResult; // Mood detected from the message
  adaptiveInstructions: string; // System prompt adjustments based on mood
  activeProactiveAlerts?: number; // Number of active PUGI signals
  proactiveContext?: string; // PUGI cross-domain insights summary
}

// ============== STATISTIQUES ==============

interface HearingStats {
  totalInputs: number;
  bySource: Record<HearingSource, number>;
  byType: Record<HearingType, number>;
  avgProcessingMs: number;
  intentDetectionRate: number;
  referenceResolutionRate: number;
}

// ============== SERVICE PRINCIPAL ==============

class HearingHubService {
  private stats: HearingStats = {
    totalInputs: 0,
    bySource: {
      web_voice: 0,
      discord_voice: 0,
      web_chat: 0,
      discord_text: 0,
      api: 0,
      sms: 0,
      email: 0,
      siri: 0,
      system: 0
    },
    byType: { voice: 0, text: 0, command: 0, notification: 0 },
    avgProcessingMs: 0,
    intentDetectionRate: 0,
    referenceResolutionRate: 0
  };

  private listeners: Array<(hearing: ProcessedHearing) => void> = [];

  constructor() {
    console.log("[HearingHub] Centre d'écoute unifié initialisé");
  }

  /**
   * Point d'entrée principal - Reçoit et traite tout ce qu'Ulysse entend
   */
  async hear(input: HearingInput): Promise<ProcessedHearing> {
    const startTime = Date.now();
    this.stats.totalInputs++;
    this.stats.bySource[input.metadata.source]++;
    this.stats.byType[input.metadata.type]++;

    console.log(`[HearingHub] 👂 Input reçu: source=${input.metadata.source}, type=${input.metadata.type}, length=${input.content.length}`);

    try {
      // 1. Pré-traitement et nettoyage
      const cleanedContent = this.cleanInput(input.content);
      
      // 2. Résolution des références contextuelles ("il", "son prochain match", etc.)
      let resolvedContent = cleanedContent;
      if (hasReferencePattern(cleanedContent)) {
        const resolved = resolveReferences(input.metadata.userId, cleanedContent);
        resolvedContent = resolved.resolvedMessage;
        if (resolvedContent !== cleanedContent) {
          console.log(`[HearingHub] Référence résolue: "${cleanedContent}" → "${resolvedContent}"`);
        }
      }

      // 3. Détection d'intention (pour les sources vocales)
      let intent: DetectedIntent | null = null;
      if (input.metadata.type === "voice" || this.shouldDetectIntent(input.metadata.source)) {
        intent = detectIntent(resolvedContent);
        
        if (intent && intent.confidence > 0.7) {
          console.log(`[HearingHub] Intent détecté: ${intent.domain} (${(intent.confidence * 100).toFixed(0)}%)`);
        }
      }

      // 4. Vérifier si c'est une commande système
      const isSystemCommand = this.isSystemCommand(cleanedContent);

      // 5. Mettre à jour le contexte de conversation
      if (intent && intent.domain !== "generic" && intent.confidence > 0.7) {
        const entities = Object.values(intent.entities || {}).filter(e => e);
        if (entities.length > 0) {
          addContextSubject(input.metadata.userId, {
            domain: intent.domain,
            type: intent.domain,
            entity: String(entities[0]),
            entityType: "generic"
          });
        }
      }

      // 6. Dériver le domaine global depuis l'intent
      const domain = this.mapIntentToDomain(intent, resolvedContent);

      // 6b. Récupérer les sujets actifs de la mémoire contextuelle
      const session = getSessionContext(input.metadata.userId);
      const contextSubjects = session.subjects.map(s => `${s.entityType}:${s.entity}`);

      // 6c. Détection satisfaction/feedback naturel pour les KPIs
      this.detectSatisfactionSignal(cleanedContent, domain);

      // 6d. Sentiment detection
      const sentiment = detectSentiment(cleanedContent);
      if (sentiment.mood !== 'neutral') {
        console.log(`[HearingHub] Sentiment detected: ${sentiment.mood} (${(sentiment.confidence * 100).toFixed(0)}%) - indicators: ${sentiment.indicators.join(', ')}`);
      }
      recordSentiment(input.metadata.userId, sentiment, cleanedContent);
      const currentMood = getCurrentMood(input.metadata.userId);
      const adaptiveInstructions = getAdaptiveInstructions(currentMood);

      // 6e. PUGI proactive context enrichment
      let activeProactiveAlerts = 0;
      let proactiveContext = '';
      try {
        const { pugi } = require("../proactiveGeneralIntelligence");
        const digest = pugi.getDigest(2);
        activeProactiveAlerts = digest.stats.totalSignals;
        if (digest.insights.length > 0 || digest.topActions.length > 0) {
          const parts: string[] = [];
          for (const insight of digest.insights.slice(0, 2)) {
            parts.push(insight.description);
          }
          for (const action of digest.topActions.slice(0, 2)) {
            parts.push(`[${action.domain}] ${action.title}`);
          }
          proactiveContext = parts.join(' | ');
        }
      } catch {}

      // 7. Construire la réponse
      const processed: ProcessedHearing = {
        originalContent: input.content,
        resolvedContent,
        intent,
        domain,
        metadata: input.metadata,
        contextSubjects,
        isSystemCommand,
        shouldRouteToBrain: !isSystemCommand && cleanedContent.length > 2,
        sentiment,
        adaptiveInstructions,
        activeProactiveAlerts,
        proactiveContext,
      };

      // 7. Notifier les listeners
      this.notifyListeners(processed);

      // 8. Mettre à jour les statistiques
      const processingMs = Date.now() - startTime;
      this.updateStats(processingMs, intent !== null, resolvedContent !== cleanedContent);

      console.log(`[HearingHub] ✅ Traité en ${processingMs}ms: routeToBrain=${processed.shouldRouteToBrain}`);
      
      return processed;

    } catch (error) {
      console.error("[HearingHub] Erreur de traitement:", error);
      
      return {
        originalContent: input.content,
        resolvedContent: input.content,
        intent: null,
        domain: 'generic' as UlysseDomain,
        metadata: input.metadata,
        contextSubjects: [],
        isSystemCommand: false,
        shouldRouteToBrain: true,
        sentiment: { mood: 'neutral', confidence: 0.5, indicators: [] },
        adaptiveInstructions: '',
      };
    }
  }

  /**
   * Raccourci pour l'entrée vocale web (TalkingApp)
   */
  async hearFromWebVoice(
    transcript: string, 
    userId: number, 
    persona: "ulysse" | "iris" | "alfred",
    voiceContext?: HearingMetadata["voiceContext"]
  ): Promise<ProcessedHearing> {
    return this.hear({
      content: transcript,
      metadata: {
        source: "web_voice",
        type: "voice",
        timestamp: Date.now(),
        userId,
        persona,
        voiceContext
      }
    });
  }

  /**
   * Raccourci pour l'entrée vocale Discord
   */
  async hearFromDiscordVoice(
    transcript: string,
    userId: number,
    discordContext: HearingMetadata["discordContext"]
  ): Promise<ProcessedHearing> {
    return this.hear({
      content: transcript,
      metadata: {
        source: "discord_voice",
        type: "voice",
        timestamp: Date.now(),
        userId,
        persona: "ulysse", // Discord = owner seulement
        discordContext
      }
    });
  }

  /**
   * Raccourci pour le chat texte web
   */
  async hearFromWebChat(
    message: string,
    userId: number,
    persona: "ulysse" | "iris" | "alfred",
    conversationId?: number
  ): Promise<ProcessedHearing> {
    return this.hear({
      content: message,
      metadata: {
        source: "web_chat",
        type: "text",
        timestamp: Date.now(),
        userId,
        persona,
        conversationId
      }
    });
  }

  /**
   * Raccourci pour les commandes Siri
   */
  async hearFromSiri(
    command: string,
    userId: number
  ): Promise<ProcessedHearing> {
    return this.hear({
      content: command,
      metadata: {
        source: "siri",
        type: "command",
        timestamp: Date.now(),
        userId,
        persona: "ulysse"
      }
    });
  }

  /**
   * Enregistre un listener pour les nouveaux inputs
   */
  onHear(callback: (hearing: ProcessedHearing) => void): () => void {
    this.listeners.push(callback);
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index > -1) this.listeners.splice(index, 1);
    };
  }

  /**
   * Retourne les statistiques du hub
   */
  getStats(): HearingStats {
    return { ...this.stats };
  }

  // ============== HELPERS PRIVÉS ==============

  private cleanInput(content: string): string {
    return content
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/^(euh|hum|ah|oh|ben)\s+/gi, '') // Enlever les hésitations
      .trim();
  }

  private shouldDetectIntent(source: HearingSource): boolean {
    // Détecter les intentions pour les sources vocales et Siri
    return ["web_voice", "discord_voice", "siri"].includes(source);
  }

  private isSystemCommand(content: string): boolean {
    const systemCommands = [
      /^(mute|coupe|tais-toi|silence)/i,
      /^(unmute|parle|réactive)/i,
      /^(stop|arrête|fin|raccroche)/i,
      /^(volume\s+(plus|moins|up|down))/i,
      /^(répète|redis)/i
    ];
    return systemCommands.some(pattern => pattern.test(content));
  }

  private notifyListeners(hearing: ProcessedHearing): void {
    this.listeners.forEach(listener => {
      try {
        listener(hearing);
      } catch (error) {
        console.error("[HearingHub] Erreur dans listener:", error);
      }
    });
  }

  private mapIntentToDomain(intent: DetectedIntent | null, content: string): UlysseDomain {
    if (intent && intent.confidence > 0.5) {
      const d = intent.domain?.toLowerCase() || '';
      if (['football', 'sports', 'match', 'ligue1', 'pronostic', 'bet', 'cotes'].some(k => d.includes(k))) return 'sports';
      if (['sugu', 'restaurant', 'cuisine', 'facture', 'stock', 'fournisseur'].some(k => d.includes(k))) return 'sugu';
      if (['paie', 'payroll', 'salaire', 'bulletin', 'rh', 'employé', 'absence'].some(k => d.includes(k))) return 'finance';
      if (['apptoorder', 'monitoring', 'surveillance', 'commande'].some(k => d.includes(k))) return 'monitoring';
      if (['gmail', 'email', 'mail', 'courrier'].some(k => d.includes(k))) return 'email';
      if (['studio', 'media', 'video', 'image', 'montage'].some(k => d.includes(k))) return 'studio';
      if (['dev', 'code', 'debug', 'deploy', 'api', 'database', 'git'].some(k => d.includes(k))) return 'dev';
      if (['perso', 'personal', 'agenda', 'rappel', 'memo', 'musique', 'météo'].some(k => d.includes(k))) return 'personal';
    }
    const cl = content.toLowerCase();
    if (/\b(match|foot|ligue|pronostic|pari|cotes?|om|psg|but)\b/.test(cl)) return 'sports';
    if (/\b(paie|salaire|bulletin|rh|employé|absence|congé|fiche de paie|masse salariale)\b/.test(cl)) return 'finance';
    if (/\b(apptoorder|macommande|monitoring|surveillance)\b/.test(cl)) return 'monitoring';
    if (/\b(gmail|email|mail|courrier|inbox|boîte)\b/.test(cl)) return 'email';
    if (/\b(studio|montage|vidéo|image|média|éditer)\b/.test(cl)) return 'studio';
    if (/\b(sugu|restaurant|facture|fournisseur|stock|caisse|menu)\b/.test(cl)) return 'sugu';
    if (/\b(code|bug|deploy|api|serveur|database|commit)\b/.test(cl)) return 'dev';
    if (/\b(rappel|agenda|musique|météo|heure|alarme)\b/.test(cl)) return 'personal';
    return 'generic';
  }

  private detectSatisfactionSignal(content: string, domain: UlysseDomain): void {
    try {
      const { ulysseKPIService } = require('../ulysseKPIService');
      if (ulysseKPIService?.detectSatisfactionFromMessage) {
        ulysseKPIService.detectSatisfactionFromMessage(content, domain);
      }
    } catch {}
  }

  private updateStats(
    processingMs: number, 
    intentDetected: boolean, 
    referenceResolved: boolean
  ): void {
    // Moyenne mobile pour le temps de traitement
    const n = this.stats.totalInputs;
    this.stats.avgProcessingMs = ((n - 1) * this.stats.avgProcessingMs + processingMs) / n;
    
    // Taux de détection d'intention
    if (intentDetected) {
      this.stats.intentDetectionRate = ((n - 1) * this.stats.intentDetectionRate + 1) / n;
    } else {
      this.stats.intentDetectionRate = ((n - 1) * this.stats.intentDetectionRate) / n;
    }
    
    // Taux de résolution de références
    if (referenceResolved) {
      this.stats.referenceResolutionRate = ((n - 1) * this.stats.referenceResolutionRate + 1) / n;
    } else {
      this.stats.referenceResolutionRate = ((n - 1) * this.stats.referenceResolutionRate) / n;
    }
  }
}

// ============== EXPORT SINGLETON ==============

export const hearingHub = new HearingHubService();
