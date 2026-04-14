/**
 * VOICE OUTPUT HUB BRIDGE - Harmonisation du système vocal de sortie
 * 
 * Connecte VoiceOutputHub avec les services existants:
 * - TTS (text-to-speech)
 * - Discord voice output
 * - Web voice response
 * - Chat text response
 * - Notifications
 * 
 * Flow unifié:
 * [Réponse AI] → VoiceOutputHub.speak() → [TTS/Text] → [Destination]
 */

import { voiceOutputHub } from "./VoiceOutputHub";
import type { OutputDestination, OutputPriority } from "./VoiceOutputHub";

let bridgeInitialized = false;

export function initializeVoiceOutputHubBridge(): void {
  if (bridgeInitialized) {
    console.log("[VoiceOutputHubBridge] Déjà initialisé");
    return;
  }

  console.log("[VoiceOutputHubBridge] Initialisation du bridge vocal sortie...");
  bridgeInitialized = true;
  console.log("[VoiceOutputHubBridge] ✅ Bridge vocal sortie initialisé");
}

export async function speakViaVoiceOutputHub(
  content: string,
  userId: number,
  persona: "ulysse" | "iris" | "alfred" | "maxai",
  destination: OutputDestination,
  _generateAudio: boolean = false
): Promise<{
  success: boolean;
  audioGenerated: boolean;
  audioDurationMs?: number;
}> {
  const mappedPersona = persona === "maxai" ? "ulysse" : persona;

  const result = await voiceOutputHub.speak({
    text: content,
    metadata: {
      destination,
      priority: "normal" as OutputPriority,
      userId,
      persona: mappedPersona,
    }
  });

  return {
    success: result.success,
    audioGenerated: result.audioGenerated,
    audioDurationMs: result.audioDurationMs,
  };
}

export async function speakToWebVoiceViaBridge(
  content: string,
  userId: number,
  persona: "ulysse" | "iris" | "alfred" | "maxai"
) {
  const mappedPersona = persona === "maxai" ? "ulysse" : persona;
  return voiceOutputHub.speakToWebVoice(content, userId, mappedPersona);
}

export async function speakToDiscordViaBridge(
  content: string,
  _guildId: string,
  _channelId: string,
  userId: number,
  persona: "ulysse" | "iris" | "alfred" | "maxai" = "ulysse"
) {
  const mappedPersona = persona === "maxai" ? "ulysse" : persona;
  return voiceOutputHub.speakToDiscord(content, userId, {
    persona: mappedPersona,
  });
}

export async function respondToChatViaBridge(
  content: string,
  userId: number,
  persona: "ulysse" | "iris" | "alfred" | "maxai",
  conversationId?: number
) {
  const mappedPersona = persona === "maxai" ? "ulysse" : persona;
  return voiceOutputHub.respondToChat(content, userId, mappedPersona, conversationId);
}

export async function notifyViaBridge(
  content: string,
  userId: number,
  _persona: "ulysse" | "iris" | "alfred" | "maxai" = "ulysse",
  priority: OutputPriority = "normal"
) {
  return voiceOutputHub.notify(content, userId, priority);
}

export function getVoiceOutputHubStats() {
  return {
    bridgeInitialized,
    hubStats: voiceOutputHub.getStats()
  };
}
