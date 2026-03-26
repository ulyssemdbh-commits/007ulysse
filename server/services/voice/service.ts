/**
 * Voice Core Ulysse v1.0 - Façade centrale pour toute la voix
 * 
 * Architecture:
 * - Engine = implémentation (OpenAI, autre provider, local)
 * - Core = façade unique utilisée partout
 * 
 * Features:
 * - Abstraction des providers
 * - Introspection (capabilities, stats)
 * - Résilience (fallbacks, erreurs propres)
 * - Optimisation (cache TTS, debounce)
 */

import { Readable } from "stream";
import type {
  IVoiceEngine,
  VoiceCapabilities,
  TTSOptions,
  STTOptions,
  VoiceStats,
  VoiceCoreStatus,
} from "./types";
import { OpenAIVoiceEngine } from "./engineOpenAI";

// ============================================================================
// Engine Management
// ============================================================================

const engine: IVoiceEngine = new OpenAIVoiceEngine();
const ENGINE_NAME = "OpenAI Direct";

// ============================================================================
// Stats Tracking
// ============================================================================

const stats: VoiceStats = {
  ttsCallCount: 0,
  sttCallCount: 0,
  ttsErrorCount: 0,
  sttErrorCount: 0,
  totalTTSChars: 0,
  totalSTTSeconds: 0,
  cacheHits: 0,
  cacheMisses: 0,
};

// ============================================================================
// TTS Cache (optimize repeated phrases)
// ============================================================================

interface TTSCacheEntry {
  buffer: Buffer;
  createdAt: number;
  voice: string;
}

const ttsCache = new Map<string, TTSCacheEntry>();
const TTS_CACHE_MAX_SIZE = 50;
const TTS_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getTTSCacheKey(text: string, voice: string): string {
  return `${voice}:${text.slice(0, 200)}`;
}

function getCachedTTS(text: string, voice: string): Buffer | null {
  const key = getTTSCacheKey(text, voice);
  const entry = ttsCache.get(key);
  
  if (!entry) {
    stats.cacheMisses++;
    return null;
  }
  
  if (Date.now() - entry.createdAt > TTS_CACHE_TTL_MS) {
    ttsCache.delete(key);
    stats.cacheMisses++;
    return null;
  }
  
  stats.cacheHits++;
  return entry.buffer;
}

function setCachedTTS(text: string, voice: string, buffer: Buffer): void {
  // Evict oldest if full
  if (ttsCache.size >= TTS_CACHE_MAX_SIZE) {
    const oldest = [...ttsCache.entries()].sort(
      (a, b) => a[1].createdAt - b[1].createdAt
    )[0];
    if (oldest) {
      ttsCache.delete(oldest[0]);
    }
  }
  
  const key = getTTSCacheKey(text, voice);
  ttsCache.set(key, {
    buffer,
    createdAt: Date.now(),
    voice,
  });
}

// ============================================================================
// Public API - Capabilities & Status
// ============================================================================

/**
 * Retourne les capacités réelles de la stack vocale
 */
export function getVoiceCapabilities(): VoiceCapabilities {
  return engine.getCapabilities();
}

/**
 * Vérifie si la voix est supportée (TTS + STT)
 */
export function isVoiceSupported(): boolean {
  const caps = getVoiceCapabilities();
  return caps.tts && caps.stt;
}

/**
 * Vérifie si uniquement TTS est supporté
 */
export function isTTSSupported(): boolean {
  return getVoiceCapabilities().tts;
}

/**
 * Vérifie si uniquement STT est supporté
 */
export function isSTTSupported(): boolean {
  return getVoiceCapabilities().stt;
}

/**
 * Retourne le statut complet du Voice Core
 */
export function getVoiceCoreStatus(): VoiceCoreStatus {
  return {
    available: isVoiceSupported(),
    capabilities: getVoiceCapabilities(),
    stats: { ...stats },
    engineName: ENGINE_NAME,
  };
}

/**
 * Reset les stats (pour tests ou monitoring)
 */
export function resetVoiceStats(): void {
  stats.ttsCallCount = 0;
  stats.sttCallCount = 0;
  stats.ttsErrorCount = 0;
  stats.sttErrorCount = 0;
  stats.totalTTSChars = 0;
  stats.totalSTTSeconds = 0;
  stats.cacheHits = 0;
  stats.cacheMisses = 0;
}

/**
 * Vide le cache TTS
 */
export function clearTTSCache(): void {
  ttsCache.clear();
}

// ============================================================================
// Public API - TTS (Text-to-Speech)
// ============================================================================

/**
 * TTS Core - utilisé partout (réponses audio, feedback vocal, etc.)
 * Avec cache automatique pour les phrases répétées
 */
export async function coreTextToSpeech(
  text: string,
  options: TTSOptions = {}
): Promise<Buffer> {
  const caps = engine.getCapabilities();
  
  if (!caps.tts) {
    throw new Error("TTS_NOT_SUPPORTED: Aucun engine TTS disponible");
  }

  const voice = options.voice || "onyx";
  const safeText = text.slice(0, caps.maxTTSChars);
  
  // Check cache first
  const cached = getCachedTTS(safeText, voice);
  if (cached) {
    console.log(`[VoiceCore:TTS] Cache hit for "${safeText.slice(0, 30)}..."`);
    return cached;
  }

  try {
    stats.ttsCallCount++;
    stats.totalTTSChars += safeText.length;
    stats.lastTTSCall = new Date();
    
    const buffer = await engine.textToSpeech(safeText, { ...options, voice });
    
    // Cache the result
    setCachedTTS(safeText, voice, buffer);
    
    console.log(
      `[VoiceCore:TTS] Generated ${buffer.length} bytes for ${safeText.length} chars`
    );
    
    return buffer;
  } catch (error) {
    stats.ttsErrorCount++;
    console.error("[VoiceCore:TTS] Error:", error);
    throw error;
  }
}

/**
 * TTS streaming - pour flux audio progressif
 */
export async function coreTextToSpeechStream(
  text: string,
  options: TTSOptions = {}
): Promise<Readable> {
  const caps = engine.getCapabilities();
  
  if (!caps.tts) {
    throw new Error("TTS_NOT_SUPPORTED: Aucun engine TTS disponible");
  }

  if (typeof engine.textToSpeechStream === "function") {
    return engine.textToSpeechStream(text, options) as Promise<Readable>;
  }

  // Fallback si l'engine n'a pas de streaming natif
  const buffer = await coreTextToSpeech(text, options);
  const readable = new Readable();
  readable.push(buffer);
  readable.push(null);
  return readable;
}

// ============================================================================
// Public API - STT (Speech-to-Text)
// ============================================================================

/**
 * STT Core - utilisé pour transcrire les vocaux avant traitement
 */
export async function coreSpeechToText(
  audioBuffer: Buffer,
  options: STTOptions = {}
): Promise<string> {
  const caps = engine.getCapabilities();
  
  if (!caps.stt) {
    throw new Error("STT_NOT_SUPPORTED: Aucun engine STT disponible");
  }

  // Estimation durée basée sur taille (rough: 16kbps for webm voice)
  const estimatedSeconds = (audioBuffer.length * 8) / 16000;
  
  if (estimatedSeconds > caps.maxSTTSeconds) {
    throw new Error(
      `STT_TOO_LONG: Audio trop long (${Math.round(estimatedSeconds)}s, max ${caps.maxSTTSeconds}s)`
    );
  }

  try {
    stats.sttCallCount++;
    stats.totalSTTSeconds += estimatedSeconds;
    stats.lastSTTCall = new Date();
    
    const text = await engine.speechToText(audioBuffer, options);
    
    console.log(
      `[VoiceCore:STT] Transcribed ${audioBuffer.length} bytes -> "${text.slice(0, 50)}..."`
    );
    
    return text;
  } catch (error) {
    stats.sttErrorCount++;
    console.error("[VoiceCore:STT] Error:", error);
    throw error;
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Génère un audio de feedback court (pour confirmations, erreurs, etc.)
 */
export async function generateFeedbackAudio(
  type: "confirm" | "error" | "thinking" | "listening"
): Promise<Buffer | null> {
  if (!isTTSSupported()) {
    return null;
  }

  const phrases: Record<string, string> = {
    confirm: "C'est noté.",
    error: "Désolé, une erreur s'est produite.",
    thinking: "Je réfléchis...",
    listening: "Je t'écoute.",
  };

  const text = phrases[type];
  if (!text) return null;

  try {
    return await coreTextToSpeech(text, { voice: "onyx", speed: 1.1 });
  } catch {
    return null;
  }
}

/**
 * Vérifie la santé du système vocal
 */
export async function checkVoiceHealth(): Promise<{
  healthy: boolean;
  tts: boolean;
  stt: boolean;
  latencyMs?: number;
  error?: string;
}> {
  const caps = getVoiceCapabilities();
  
  if (!caps.tts && !caps.stt) {
    return {
      healthy: false,
      tts: false,
      stt: false,
      error: "No voice engine available",
    };
  }

  const start = Date.now();
  
  try {
    // Quick TTS test
    if (caps.tts) {
      await coreTextToSpeech("test", { voice: "onyx" });
    }
    
    return {
      healthy: true,
      tts: caps.tts,
      stt: caps.stt,
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      healthy: false,
      tts: caps.tts,
      stt: caps.stt,
      latencyMs: Date.now() - start,
      error: (error as Error).message,
    };
  }
}

console.log(
  `[VoiceCore] Initialized with engine: ${ENGINE_NAME}, capabilities:`,
  getVoiceCapabilities()
);
