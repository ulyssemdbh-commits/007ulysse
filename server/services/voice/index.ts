/**
 * Voice Module - Unified voice services
 * Re-exports all voice-related functionality
 */

// Types
export * from "./types";

// Core voice functions (TTS/STT basic) - selective exports to avoid conflicts
export { 
  splitTextForStreaming,
  textToSpeech,
  speechToText 
} from "./core";

// Voice engine implementation
export { OpenAIVoiceEngine } from "./engineOpenAI";

// Voice core service (main service) - primary source for all voice functions
export {
  isVoiceSupported,
  isTTSSupported,
  isSTTSupported,
  coreTextToSpeech,
  coreSpeechToText,
  getVoiceCapabilities,
  getVoiceCoreStatus
} from "./service";

// Voice activity detection
export { voiceActivityService } from "./activity";

// Voice authentication
export {
  authorizeVoiceAction,
  getEnrollmentStatus,
  addEnrollmentSample,
  deleteVoiceProfile,
  type VoiceAction
} from "./auth";

// Realtime voice WebSocket
export { setupRealtimeVoice, handleVoiceUpgrade } from "./realtime";
