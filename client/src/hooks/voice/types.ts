export type VoiceState = "idle" | "unlocking" | "listening" | "processing" | "speaking" | "error";

export type VoiceModeStatus = "full" | "degraded" | "unavailable";

export type ConversationMode = "push-to-talk" | "continuous";

export interface VoiceError {
  code: string;
  message: string;
  userMessage: string;
  recoverable: boolean;
}

export interface VoiceProfile {
  voiceId: string;
  rate: number;
  pitch: number;
  gender: "male" | "female";
}

export type PermissionState = "prompt" | "granted" | "denied" | "unavailable";

export interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

export interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

export interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

export interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

export interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

export const ERROR_MESSAGES: Record<string, VoiceError> = {
  "not-allowed": {
    code: "not-allowed",
    message: "Microphone permission denied",
    userMessage: "Le micro est bloqué. Autorisez l'accès au micro dans les réglages de votre navigateur.",
    recoverable: true,
  },
  "audio-capture": {
    code: "audio-capture",
    message: "No microphone detected",
    userMessage: "Aucun micro détecté. Vérifiez que votre micro est branché et disponible.",
    recoverable: true,
  },
  "network": {
    code: "network",
    message: "Network error",
    userMessage: "Erreur réseau. Vérifiez votre connexion internet.",
    recoverable: true,
  },
  "tts-failed": {
    code: "tts-failed",
    message: "Text-to-speech failed",
    userMessage: "Impossible de parler. Le service vocal est temporairement indisponible.",
    recoverable: true,
  },
  "stt-failed": {
    code: "stt-failed",
    message: "Speech-to-text failed",
    userMessage: "Impossible de comprendre. Réessayez de parler.",
    recoverable: true,
  },
  "ios-degraded": {
    code: "ios-degraded",
    message: "iOS limitations detected",
    userMessage: "Mode voix limité sur iOS. Appuyez pour parler.",
    recoverable: false,
  },
};
