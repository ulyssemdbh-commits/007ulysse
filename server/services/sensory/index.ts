/**
 * SENSORY SYSTEM - Système Sensoriel Unifié d'Ulysse
 * 
 * Point d'entrée central pour tous les sens d'Ulysse.
 * Connecte les 4 hubs sensoriels au cerveau central (BrainHub).
 * 
 * Architecture:
 * 
 *                         ┌─────────────────┐
 *                         │    BRAIN HUB    │ ← Conscience unifiée
 *                         │   (Cerveau)     │
 *                         └────────┬────────┘
 *                                  │
 *                         ┌────────┴────────┐
 *                         │  CORE ENGINE    │ ← Traitement AI
 *                         └────────┬────────┘
 *                                  │
 *          ┌───────────────────────┼───────────────────────┐
 *          │              ┌────────┴────────┐              │
 *    ┌─────┴─────┐        │                 │       ┌──────┴──────┐
 *    │ HEARING   │        │                 │       │  ACTION     │
 *    │   HUB     │        │   VISION HUB    │       │    HUB      │
 *    │ (Oreilles)│        │    (Yeux)       │       │  (Mains)    │
 *    └─────┬─────┘        └────────┬────────┘       └──────┬──────┘
 *          │                       │                       │
 *    ┌─────┴─────┐          ┌──────┴──────┐         ┌──────┴──────┐
 *    │ Web Voice │          │ Screen Mon  │         │ Tool Calls  │
 *    │ Discord   │          │ Web Scrape  │         │ Homework    │
 *    │ Text Chat │          │ Screenshots │         │ Domotique   │
 *    │ Siri      │          │ Documents   │         │ Emails      │
 *    └───────────┘          └─────────────┘         └─────────────┘
 *          │
 *    ┌─────┴─────┐
 *    │  VOICE    │
 *    │ OUTPUT HUB│
 *    │ (Bouche)  │
 *    └───────────┘
 * 
 * Usage:
 *   import { sensorySystem, hearingHub, visionHub, actionHub, voiceOutputHub } from './sensory';
 *   
 *   // Ulysse entend quelque chose
 *   const hearing = await hearingHub.hearFromWebVoice(transcript, userId, "ulysse");
 *   
 *   // Si besoin, traiter avec le cerveau
 *   if (hearing.shouldRouteToBrain) {
 *     const response = await ulysseCoreEngine.process({ message: hearing.resolvedContent, context });
 *     await voiceOutputHub.speakToWebVoice(response.content, userId, "ulysse");
 *   }
 */

// ============== IMPORTS DES HUBS ==============

import { hearingHub, type HearingInput, type ProcessedHearing, type HearingSource, type HearingMetadata, type UlysseDomain } from './HearingHub';
import { voiceOutputHub, type VoiceOutput, type OutputResult, type OutputDestination, type VoiceOutputMetadata } from './VoiceOutputHub';
import { visionHub, type VisionInput, type ProcessedVision, type VisionSource, type VisionMetadata } from './VisionHub';
import { actionHub, type ActionInput, type ActionResult, type ActionCategory, type ActionMetadata } from './ActionHub';
import { brainHub, type ConsciousnessState, type NavigationContext, type BrainEvent, type BrainDecision, type BrainStats, type WorkingMemoryItem, type VoiceSessionState, setVoiceSessionState, getVoiceSessionState } from './BrainHub';

// ============== TYPES UNIFIÉS ==============

export interface SensoryEvent {
  type: "hearing" | "vision" | "action" | "speech";
  timestamp: number;
  userId: number;
  data: ProcessedHearing | ProcessedVision | ActionResult | VoiceOutput;
}

export interface SensoryStats {
  hearing: ReturnType<typeof hearingHub.getStats>;
  vision: ReturnType<typeof visionHub.getStats>;
  action: ReturnType<typeof actionHub.getStats>;
  output: ReturnType<typeof voiceOutputHub.getStats>;
  totalEvents: number;
  lastActivity: number;
}

// ============== SYSTÈME SENSORIEL CENTRAL ==============

class SensorySystemService {
  private eventLog: SensoryEvent[] = [];
  private maxEventLogSize = 500;
  private lastActivity = Date.now();
  private listeners: Array<(event: SensoryEvent) => void> = [];

  constructor() {
    console.log("[SensorySystem] Initialisation du système sensoriel unifié");
    this.setupHubListeners();
  }

  /**
   * Configure les listeners sur tous les hubs
   */
  private setupHubListeners(): void {
    // Écouter les entrées audio/texte
    hearingHub.onHear((hearing) => {
      this.logEvent({
        type: "hearing",
        timestamp: Date.now(),
        userId: hearing.metadata.userId,
        data: hearing
      });
    });

    // Écouter les entrées visuelles
    visionHub.onSee((vision) => {
      this.logEvent({
        type: "vision",
        timestamp: Date.now(),
        userId: vision.userId,
        data: vision
      });
    });

    // Écouter les actions exécutées
    actionHub.onAction((log) => {
      this.logEvent({
        type: "action",
        timestamp: Date.now(),
        userId: log.action.metadata.userId,
        data: log.result
      });
    });

    // Écouter les sorties vocales
    voiceOutputHub.onSpeak((output) => {
      this.logEvent({
        type: "speech",
        timestamp: Date.now(),
        userId: output.metadata.userId,
        data: output
      });
    });

    console.log("[SensorySystem] Listeners configurés sur les 4 hubs");
  }

  /**
   * Enregistre un événement sensoriel
   */
  private logEvent(event: SensoryEvent): void {
    this.eventLog.push(event);
    this.lastActivity = event.timestamp;

    // Limiter la taille du log
    if (this.eventLog.length > this.maxEventLogSize) {
      this.eventLog = this.eventLog.slice(-this.maxEventLogSize);
    }

    // Notifier les listeners
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error("[SensorySystem] Erreur dans listener:", error);
      }
    });
  }

  /**
   * Écoute tous les événements sensoriels
   */
  onEvent(callback: (event: SensoryEvent) => void): () => void {
    this.listeners.push(callback);
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index > -1) this.listeners.splice(index, 1);
    };
  }

  /**
   * Retourne les statistiques globales
   */
  getStats(): SensoryStats {
    return {
      hearing: hearingHub.getStats(),
      vision: visionHub.getStats(),
      action: actionHub.getStats(),
      output: voiceOutputHub.getStats(),
      totalEvents: this.eventLog.length,
      lastActivity: this.lastActivity
    };
  }

  /**
   * Retourne les événements récents
   */
  getRecentEvents(limit: number = 50, type?: SensoryEvent["type"]): SensoryEvent[] {
    let events = this.eventLog;
    
    if (type) {
      events = events.filter(e => e.type === type);
    }
    
    return events.slice(-limit);
  }

  /**
   * Retourne l'activité récente d'un utilisateur
   */
  getUserActivity(userId: number, limit: number = 20): SensoryEvent[] {
    return this.eventLog
      .filter(e => e.userId === userId)
      .slice(-limit);
  }

  /**
   * Vérifie si le système est actif
   */
  isActive(): boolean {
    const inactivityThreshold = 5 * 60 * 1000; // 5 minutes
    return (Date.now() - this.lastActivity) < inactivityThreshold;
  }

  /**
   * Retourne un résumé de l'état du système
   */
  getSystemSummary(): {
    status: "active" | "idle" | "inactive";
    uptime: string;
    stats: SensoryStats;
  } {
    const stats = this.getStats();
    const inactiveMs = Date.now() - this.lastActivity;
    
    let status: "active" | "idle" | "inactive";
    if (inactiveMs < 60000) {
      status = "active";
    } else if (inactiveMs < 5 * 60000) {
      status = "idle";
    } else {
      status = "inactive";
    }

    return {
      status,
      uptime: `${Math.floor(process.uptime() / 60)} minutes`,
      stats
    };
  }
}

// ============== SINGLETON ==============

export const sensorySystem = new SensorySystemService();

// ============== SENSORY BRIDGES INIT ==============
// Harmonise tous les hubs avec les services existants

import { initializeActionHubBridge, executeViaActionHub, getActionHubStats } from './ActionHubBridge';
import { initializeVisionHubBridge, analyzeDocumentViaVisionHub, analyzeScreenViaVisionHub, analyzeWebpageViaVisionHub, analyzeScreenshotViaVisionHub, getVisionHubStats } from './VisionHubBridge';
import { initializeHearingHubBridge, transcribeViaHearingHub, hearFromWebVoiceViaBridge, hearFromDiscordViaBridge, hearFromChatViaBridge, hearFromSiriViaBridge, getHearingHubStats } from './HearingHubBridge';
import { initializeVoiceOutputHubBridge, speakViaVoiceOutputHub, speakToWebVoiceViaBridge, speakToDiscordViaBridge, respondToChatViaBridge, notifyViaBridge, getVoiceOutputHubStats } from './VoiceOutputHubBridge';

// Auto-initialize all bridges on module load
initializeActionHubBridge();
initializeVisionHubBridge();
initializeHearingHubBridge();
initializeVoiceOutputHubBridge();

// ActionHub exports
export { executeViaActionHub, getActionHubStats };

// VisionHub exports
export { analyzeDocumentViaVisionHub, analyzeScreenViaVisionHub, analyzeWebpageViaVisionHub, analyzeScreenshotViaVisionHub, getVisionHubStats };

// HearingHub exports
export { transcribeViaHearingHub, hearFromWebVoiceViaBridge, hearFromDiscordViaBridge, hearFromChatViaBridge, hearFromSiriViaBridge, getHearingHubStats };

// VoiceOutputHub exports
export { speakViaVoiceOutputHub, speakToWebVoiceViaBridge, speakToDiscordViaBridge, respondToChatViaBridge, notifyViaBridge, getVoiceOutputHubStats };

// Unified stats for all bridges
export function getAllBridgeStats() {
  return {
    action: getActionHubStats(),
    vision: getVisionHubStats(),
    hearing: getHearingHubStats(),
    voiceOutput: getVoiceOutputHubStats()
  };
}

// ============== EXPORTS ==============

// Hubs individuels
export { hearingHub } from './HearingHub';
export { voiceOutputHub } from './VoiceOutputHub';
export { visionHub } from './VisionHub';
export { actionHub } from './ActionHub';
export { brainHub, setVoiceSessionState, getVoiceSessionState } from './BrainHub';

// Sentiment service
export { detectSentiment, getSentimentHistory, getCurrentMood, getAdaptiveInstructions, getMoodSummary } from '../sentimentService';
export type { Mood, SentimentResult } from '../sentimentService';

// Types
export type {
  // Hearing
  HearingInput,
  ProcessedHearing,
  UlysseDomain,
  HearingSource,
  HearingMetadata,
  // Vision
  VisionInput,
  ProcessedVision,
  VisionSource,
  VisionMetadata,
  // Action
  ActionInput,
  ActionResult,
  ActionCategory,
  ActionMetadata,
  // Voice Output
  VoiceOutput,
  OutputResult,
  OutputDestination,
  VoiceOutputMetadata,
  DialogueMode,
  // Brain
  ConsciousnessState,
  NavigationContext,
  BrainEvent,
  BrainDecision,
  BrainStats,
  WorkingMemoryItem,
  UlysseDomainBrain,
  AttentionStats,
  VoiceSessionState,
};
