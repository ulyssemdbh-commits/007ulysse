/**
 * VOICE OUTPUT HUB - Centre de Parole Unifié d'Ulysse
 * 
 * Point de sortie unique pour TOUT ce qu'Ulysse dit, quelle que soit la destination.
 * Gère le TTS, la priorisation, le formatage vocal et la diffusion multi-canal.
 * 
 * Destinations supportées:
 * - Web Voice (TalkingApp V3 Pro)
 * - Discord Voice
 * - Web Chat (texte seulement)
 * - Notifications
 * - API Response
 * 
 * Architecture:
 * [Cerveau] → VoiceOutputHub → [Formatage + TTS] → [Interface appropriée]
 */

import { textToSpeech, TTSOptions, isVoiceSupported } from "../voice/core";

export type DialogueMode = 'short_answer' | 'step_by_step' | 'action_only';

const WORDS_PER_MINUTE = 170;

function formatForVoice(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/#+\s/g, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function vocalizeText(text: string): string {
  let t = text;
  t = t.replace(/=>/g, 'donc');
  t = t.replace(/→/g, 'puis');
  t = t.replace(/\s*[•\-]\s+/g, '. ');
  t = t.replace(/\s*\d+\.\s+/g, '. ');
  t = t.replace(/\bi\.e\.\s*/gi, "c'est-à-dire ");
  t = t.replace(/\be\.g\.\s*/gi, 'par exemple ');
  t = t.replace(/\betc\.\s*/gi, 'et cetera. ');
  t = t.replace(/\bvs\.?\s*/gi, 'contre ');
  t = t.replace(/(\d+)\s*%/g, '$1 pour cent');
  t = t.replace(/(\d+)\s*€/g, '$1 euros');
  t = t.replace(/(\d+)\s*\$/g, '$1 dollars');
  t = t.replace(/\.\s*\./g, '.');
  t = t.replace(/\s+/g, ' ');
  return t.trim();
}

function estimateSpokenSeconds(text: string): number {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return (wordCount / WORDS_PER_MINUTE) * 60;
}

function truncateForDuration(text: string, maxSeconds: number): { text: string; truncated: boolean } {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  let result = '';
  let totalSeconds = 0;

  for (const sentence of sentences) {
    const sentenceSeconds = estimateSpokenSeconds(sentence);
    if (totalSeconds + sentenceSeconds > maxSeconds && result.length > 0) {
      return { text: result.trim() + ' — Tu veux la suite ?', truncated: true };
    }
    result += (result ? ' ' : '') + sentence;
    totalSeconds += sentenceSeconds;
  }

  return { text: result.trim(), truncated: false };
}

function applyDialogueMode(text: string, mode: DialogueMode, maxSpokenSeconds: number): string {
  let processed = vocalizeText(formatForVoice(text));

  if (mode === 'action_only') {
    const sentences = processed.split(/(?<=[.!?])\s+/).filter(Boolean);
    processed = sentences.slice(0, 2).join(' ');
    if (sentences.length > 2) {
      processed += ' — C\'est fait.';
    }
  } else if (mode === 'short_answer') {
    const { text: truncated } = truncateForDuration(processed, Math.min(maxSpokenSeconds, 25));
    processed = truncated;
  } else if (mode === 'step_by_step') {
    const { text: truncated } = truncateForDuration(processed, Math.min(maxSpokenSeconds, 60));
    processed = truncated;
  }

  return processed;
}

// ============== TYPES ==============

export type OutputDestination = 
  | "web_voice"      // TalkingApp avec TTS
  | "discord_voice"  // Discord avec TTS
  | "web_chat"       // Chat texte (pas de TTS)
  | "notification"   // Notification push
  | "api";           // Réponse API

export type OutputPriority = "critical" | "high" | "normal" | "low";

export interface VoiceOutputMetadata {
  destination: OutputDestination;
  priority: OutputPriority;
  userId: number;
  persona: "ulysse" | "iris" | "alfred";
  conversationId?: number;
  
  voice?: TTSOptions["voice"];
  speed?: number;
  language?: string;
  
  inResponseTo?: string;
  intent?: string;
  domain?: 'sports' | 'sugu' | 'dev' | 'personal' | 'generic' | 'finance' | 'monitoring' | 'email' | 'studio';
  strategy?: string;
  kpiTag?: string;
  
  dialogueMode?: DialogueMode;
  maxSpokenSeconds?: number;
}

export interface VoiceOutput {
  text: string;              // Texte à dire/afficher
  metadata: VoiceOutputMetadata;
  formattedText?: string;    // Texte formaté pour la voix
  audioBuffer?: Buffer;      // Audio TTS généré
}

export interface OutputResult {
  success: boolean;
  destination: OutputDestination;
  text: string;
  audioGenerated: boolean;
  audioDurationMs?: number;
  error?: string;
}

// ============== GESTION DES PRIORITÉS ==============

interface ActiveChannel {
  destination: OutputDestination;
  userId: number;
  priority: OutputPriority;
  startedAt: number;
  expiresAt: number;
}

// ============== STATISTIQUES ==============

interface OutputStats {
  totalOutputs: number;
  byDestination: Record<OutputDestination, number>;
  ttsGenerations: number;
  ttsErrorCount: number;
  avgTTSDurationMs: number;
  charactersSynthesized: number;
}

// ============== SERVICE PRINCIPAL ==============

class VoiceOutputHubService {
  private activeChannels: Map<string, ActiveChannel> = new Map();
  
  private stats: OutputStats = {
    totalOutputs: 0,
    byDestination: {
      web_voice: 0,
      discord_voice: 0,
      web_chat: 0,
      notification: 0,
      api: 0
    },
    ttsGenerations: 0,
    ttsErrorCount: 0,
    avgTTSDurationMs: 0,
    charactersSynthesized: 0
  };

  // Voix par défaut par persona
  private voicesByPersona: Record<string, TTSOptions["voice"]> = {
    ulysse: "onyx",    // Voix grave masculine
    iris: "nova",      // Voix féminine douce
    alfred: "echo"     // Voix neutre formelle
  };

  private listeners: Array<(output: VoiceOutput) => void> = [];
  private postProcessors: Array<(output: VoiceOutput) => VoiceOutput> = [];

  constructor() {
    console.log("[VoiceOutputHub] Centre de parole unifié initialisé");
    
    setInterval(() => this.cleanupExpiredChannels(), 30000);
  }

  registerPostProcessor(fn: (output: VoiceOutput) => VoiceOutput): void {
    this.postProcessors.push(fn);
    console.log(`[VoiceOutputHub] Post-processor registered (total: ${this.postProcessors.length})`);
  }

  /**
   * Point d'entrée principal - Envoie la parole d'Ulysse vers la destination
   */
  async speak(output: VoiceOutput): Promise<OutputResult> {
    const startTime = Date.now();
    this.stats.totalOutputs++;
    this.stats.byDestination[output.metadata.destination]++;

    console.log(`[VoiceOutputHub] 👄 Output: dest=${output.metadata.destination}, priority=${output.metadata.priority}, length=${output.text.length}`);

    try {
      // 1. Vérifier les priorités
      if (!this.canSpeak(output.metadata)) {
        console.log(`[VoiceOutputHub] Bloqué par canal prioritaire actif`);
        return {
          success: false,
          destination: output.metadata.destination,
          text: output.text,
          audioGenerated: false,
          error: "Canal prioritaire actif"
        };
      }

      for (const fn of this.postProcessors) {
        output = fn(output);
      }

      let formattedText = output.text;
      if (this.needsVoiceFormatting(output.metadata.destination)) {
        const mode = output.metadata.dialogueMode || 'short_answer';
        const maxSec = output.metadata.maxSpokenSeconds || 25;
        formattedText = applyDialogueMode(output.text, mode, maxSec);
        output.formattedText = formattedText;
      }

      // 3. Générer le TTS si nécessaire
      let audioBuffer: Buffer | undefined;
      let audioDurationMs: number | undefined;
      
      if (this.needsTTS(output.metadata.destination)) {
        const ttsResult = await this.generateTTS(formattedText, output.metadata);
        if (ttsResult.success && ttsResult.audio) {
          audioBuffer = ttsResult.audio;
          audioDurationMs = ttsResult.durationMs;
          output.audioBuffer = audioBuffer;
        } else if (!ttsResult.success) {
          console.warn(`[VoiceOutputHub] TTS échoué: ${ttsResult.error}`);
        }
      }

      // 4. Enregistrer le canal actif (pour la priorisation)
      this.registerActiveChannel(output.metadata);

      // 5. Notifier les listeners
      this.notifyListeners(output);

      const processingMs = Date.now() - startTime;
      console.log(`[VoiceOutputHub] ✅ Output traité en ${processingMs}ms, TTS=${audioBuffer ? 'oui' : 'non'}`);

      this.trackOutputKPI(output.metadata, processingMs);

      return {
        success: true,
        destination: output.metadata.destination,
        text: output.text,
        audioGenerated: !!audioBuffer,
        audioDurationMs
      };

    } catch (error) {
      console.error("[VoiceOutputHub] Erreur:", error);
      return {
        success: false,
        destination: output.metadata.destination,
        text: output.text,
        audioGenerated: false,
        error: error instanceof Error ? error.message : "Erreur inconnue"
      };
    }
  }

  /**
   * Raccourci pour parler sur TalkingApp Web
   */
  async speakToWebVoice(
    text: string,
    userId: number,
    persona: "ulysse" | "iris" | "alfred",
    options?: Partial<VoiceOutputMetadata>
  ): Promise<OutputResult> {
    return this.speak({
      text,
      metadata: {
        destination: "web_voice",
        priority: options?.priority || "normal",
        userId,
        persona,
        voice: options?.voice || this.voicesByPersona[persona],
        ...options
      }
    });
  }

  /**
   * Raccourci pour parler sur Discord
   */
  async speakToDiscord(
    text: string,
    userId: number,
    options?: Partial<VoiceOutputMetadata>
  ): Promise<OutputResult> {
    return this.speak({
      text,
      metadata: {
        destination: "discord_voice",
        priority: options?.priority || "normal",
        userId,
        persona: "ulysse",
        voice: options?.voice || this.voicesByPersona.ulysse,
        ...options
      }
    });
  }

  /**
   * Raccourci pour répondre dans le chat (texte seulement)
   */
  async respondToChat(
    text: string,
    userId: number,
    persona: "ulysse" | "iris" | "alfred",
    conversationId?: number
  ): Promise<OutputResult> {
    return this.speak({
      text,
      metadata: {
        destination: "web_chat",
        priority: "normal",
        userId,
        persona,
        conversationId
      }
    });
  }

  /**
   * Envoie une notification push
   */
  async notify(
    text: string,
    userId: number,
    priority: OutputPriority = "normal"
  ): Promise<OutputResult> {
    return this.speak({
      text,
      metadata: {
        destination: "notification",
        priority,
        userId,
        persona: "ulysse"
      }
    });
  }

  /**
   * Vérifie si le TTS est prioritaire pour cet utilisateur/canal
   */
  isTTSPriorityActive(userId: number, destination: OutputDestination): boolean {
    const key = `${userId}:${destination}`;
    const channel = this.activeChannels.get(key);
    return channel !== undefined && channel.expiresAt > Date.now();
  }

  /**
   * Enregistre un canal vocal comme actif (pour bloquer le chat TTS pendant un appel)
   */
  registerVoiceCall(userId: number): void {
    this.registerActiveChannel({
      destination: "web_voice",
      priority: "high",
      userId,
      persona: "ulysse"
    }, 30 * 60 * 1000); // 30 minutes max
  }

  /**
   * Libère un canal vocal
   */
  releaseVoiceCall(userId: number): void {
    const key = `${userId}:web_voice`;
    this.activeChannels.delete(key);
    console.log(`[VoiceOutputHub] Canal vocal libéré pour user ${userId}`);
  }

  /**
   * Enregistre un listener pour les nouveaux outputs
   */
  onSpeak(callback: (output: VoiceOutput) => void): () => void {
    this.listeners.push(callback);
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index > -1) this.listeners.splice(index, 1);
    };
  }

  /**
   * Retourne les statistiques du hub
   */
  getStats(): OutputStats {
    return { ...this.stats };
  }

  // ============== HELPERS PRIVÉS ==============

  private needsTTS(destination: OutputDestination): boolean {
    return ["web_voice", "discord_voice"].includes(destination);
  }

  private needsVoiceFormatting(destination: OutputDestination): boolean {
    return ["web_voice", "discord_voice"].includes(destination);
  }

  private canSpeak(metadata: VoiceOutputMetadata): boolean {
    const priorityOrder: Record<OutputPriority, number> = {
      critical: 4,
      high: 3,
      normal: 2,
      low: 1
    };

    // Vérifier s'il y a un canal prioritaire actif pour cet utilisateur
    for (const [key, channel] of this.activeChannels.entries()) {
      if (channel.userId !== metadata.userId) continue;
      if (channel.expiresAt < Date.now()) continue;
      
      // web_voice prioritaire sur web_chat pour le même utilisateur
      if (channel.destination === "web_voice" && metadata.destination === "web_chat") {
        if (priorityOrder[channel.priority] >= priorityOrder[metadata.priority]) {
          return false;
        }
      }
    }
    
    return true;
  }

  private registerActiveChannel(
    metadata: VoiceOutputMetadata, 
    durationMs: number = 60000
  ): void {
    const key = `${metadata.userId}:${metadata.destination}`;
    this.activeChannels.set(key, {
      destination: metadata.destination,
      userId: metadata.userId,
      priority: metadata.priority,
      startedAt: Date.now(),
      expiresAt: Date.now() + durationMs
    });
  }

  private cleanupExpiredChannels(): void {
    const now = Date.now();
    for (const [key, channel] of this.activeChannels.entries()) {
      if (channel.expiresAt < now) {
        this.activeChannels.delete(key);
      }
    }
  }

  private async generateTTS(
    text: string, 
    metadata: VoiceOutputMetadata
  ): Promise<{ success: boolean; audio?: Buffer; durationMs?: number; error?: string }> {
    if (!isVoiceSupported()) {
      return { success: false, error: "TTS non supporté" };
    }

    const startTime = Date.now();
    
    try {
      const audio = await textToSpeech(text, {
        voice: metadata.voice || this.voicesByPersona[metadata.persona] || "onyx",
        speed: metadata.speed || 1.0
      });

      const durationMs = Date.now() - startTime;
      
      this.stats.ttsGenerations++;
      this.stats.charactersSynthesized += text.length;
      
      // Moyenne mobile
      const n = this.stats.ttsGenerations;
      this.stats.avgTTSDurationMs = ((n - 1) * this.stats.avgTTSDurationMs + durationMs) / n;

      return { success: true, audio, durationMs };

    } catch (error) {
      this.stats.ttsErrorCount++;
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "Erreur TTS" 
      };
    }
  }

  private trackOutputKPI(metadata: VoiceOutputMetadata, processingMs: number): void {
    try {
      const { ulysseKPIService } = require('../ulysseKPIService');
      if (ulysseKPIService?.recordLatency) {
        const domain = metadata.domain || metadata.kpiTag || 'output';
        ulysseKPIService.recordLatency(domain, processingMs);
      }
    } catch {}
  }

  private notifyListeners(output: VoiceOutput): void {
    this.listeners.forEach(listener => {
      try {
        listener(output);
      } catch (error) {
        console.error("[VoiceOutputHub] Erreur dans listener:", error);
      }
    });
  }
}

// ============== EXPORT SINGLETON ==============

export const voiceOutputHub = new VoiceOutputHubService();
