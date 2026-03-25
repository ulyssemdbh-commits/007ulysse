/**
 * Speaker Persona Service
 * 
 * Combines speaker identification with persona mapping.
 * Determines which AI persona (Ulysse/Iris/Alfred) to use based on voice.
 */

import { identifySpeaker, isSpeakerServiceAvailable } from "./speakerVerification";
import {
  getPersonaForSpeaker,
  getPersonaPromptContext,
  canSpeakerPerformAction,
  type PersonaConfig,
  type PersonaType,
  UNKNOWN_SPEAKER_CONFIG,
} from "../config/personaMapping";

export interface SpeakerContext {
  speakerId: string | null;
  confidence: number;
  persona: PersonaType;
  personaConfig: PersonaConfig;
  promptContext: string;
  serviceAvailable: boolean;
}

const speakerSessionCache = new Map<number, {
  context: SpeakerContext;
  lastUpdated: number;
}>();

const SESSION_TTL_MS = 60 * 1000;

/**
 * Identify speaker and get their persona context
 */
export async function identifySpeakerWithPersona(
  audioBuffer: Buffer,
  userId?: number
): Promise<SpeakerContext> {
  const serviceAvailable = await isSpeakerServiceAvailable();
  
  if (!serviceAvailable) {
    const config = UNKNOWN_SPEAKER_CONFIG;
    return {
      speakerId: null,
      confidence: 0,
      persona: config.persona,
      personaConfig: config,
      promptContext: getPersonaPromptContext(config),
      serviceAvailable: false,
    };
  }

  const identification = await identifySpeaker(audioBuffer);
  const config = getPersonaForSpeaker(identification.userId);
  
  const context: SpeakerContext = {
    speakerId: identification.userId,
    confidence: identification.confidence,
    persona: config.persona,
    personaConfig: config,
    promptContext: getPersonaPromptContext(config),
    serviceAvailable: true,
  };

  if (userId) {
    speakerSessionCache.set(userId, {
      context,
      lastUpdated: Date.now(),
    });
  }

  console.log(`[SpeakerPersona] Identified: ${identification.userId || "unknown"} → ${config.persona} (${Math.round(identification.confidence * 100)}%)`);

  return context;
}

/**
 * Get cached speaker context for a user session
 */
export function getCachedSpeakerContext(userId: number): SpeakerContext | null {
  const cached = speakerSessionCache.get(userId);
  
  if (!cached) return null;
  
  if (Date.now() - cached.lastUpdated > SESSION_TTL_MS) {
    speakerSessionCache.delete(userId);
    return null;
  }
  
  return cached.context;
}

/**
 * Set speaker context manually (for text-based auth)
 */
export function setSpeakerContext(userId: number, speakerId: string): SpeakerContext {
  const config = getPersonaForSpeaker(speakerId);
  
  const context: SpeakerContext = {
    speakerId,
    confidence: 1.0,
    persona: config.persona,
    personaConfig: config,
    promptContext: getPersonaPromptContext(config),
    serviceAvailable: true,
  };
  
  speakerSessionCache.set(userId, {
    context,
    lastUpdated: Date.now(),
  });
  
  return context;
}

/**
 * Clear speaker context for a user
 */
export function clearSpeakerContext(userId: number): void {
  speakerSessionCache.delete(userId);
}

/**
 * Check if current speaker can perform an action
 */
export function checkSpeakerPermission(userId: number, action: string): boolean {
  const cached = getCachedSpeakerContext(userId);
  
  if (!cached) {
    return action === "generic_chat";
  }
  
  return canSpeakerPerformAction(cached.speakerId, action);
}

/**
 * Get greeting for identified speaker
 */
export function getSpeakerGreeting(userId: number): string {
  const cached = getCachedSpeakerContext(userId);
  
  if (!cached || !cached.personaConfig.greeting) {
    return "Bonjour ! Comment puis-je vous aider ?";
  }
  
  return cached.personaConfig.greeting;
}

export const speakerPersonaService = {
  identifySpeakerWithPersona,
  getCachedSpeakerContext,
  setSpeakerContext,
  clearSpeakerContext,
  checkSpeakerPermission,
  getSpeakerGreeting,
};

export default speakerPersonaService;
