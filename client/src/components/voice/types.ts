export type ConnectionState = "disconnected" | "connecting" | "connected" | "authenticating" | "authenticated" | "error";
export type VoiceState = "idle" | "listening" | "processing" | "speaking";
export type ConversationMode = "push-to-talk" | "continuous";

export interface TimelineMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  origin?: "voice" | "chat" | "talking";
}

export const CONNECTION_LABELS: Record<ConnectionState, string> = {
  disconnected: "Deconnecte",
  connecting: "Connexion...",
  connected: "Connecte",
  authenticating: "Authentification...",
  authenticated: "Pret",
  error: "Erreur",
};

export const VOICE_STATE_LABELS: Record<VoiceState, string> = {
  idle: "En attente",
  listening: "Ecoute...",
  processing: "Traitement...",
  speaking: "Parle...",
};
