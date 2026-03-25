/**
 * Voice Core Ulysse v1.0 - Types & Interfaces
 * Architecture abstraite pour TTS/STT, découplée des providers
 */

export type VoiceProvider = "openai_direct" | "modelfarm_text_only" | "none";

export interface VoiceCapabilities {
  tts: boolean;
  stt: boolean;
  provider: VoiceProvider;
  supportsStreamingTTS: boolean;
  maxTTSChars: number;
  maxSTTSeconds: number;
}

export interface TTSOptions {
  voice?: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
  speed?: number;
  model?: string;
  language?: string;
}

export interface STTOptions {
  language?: string;
  mimeType?: string;
}

export interface IVoiceEngine {
  getCapabilities(): VoiceCapabilities;
  textToSpeech(text: string, options?: TTSOptions): Promise<Buffer>;
  textToSpeechStream?(text: string, options?: TTSOptions): Promise<NodeJS.ReadableStream>;
  speechToText(audio: Buffer, options?: STTOptions): Promise<string>;
}

export interface VoiceStats {
  ttsCallCount: number;
  sttCallCount: number;
  ttsErrorCount: number;
  sttErrorCount: number;
  totalTTSChars: number;
  totalSTTSeconds: number;
  lastTTSCall?: Date;
  lastSTTCall?: Date;
  cacheHits: number;
  cacheMisses: number;
}

export interface VoiceCoreStatus {
  available: boolean;
  capabilities: VoiceCapabilities;
  stats: VoiceStats;
  engineName: string;
}
