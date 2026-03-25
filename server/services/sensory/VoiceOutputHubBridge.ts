/**
 * VOICE OUTPUT HUB BRIDGE - Harmonisation du système vocal de sortie
 * 
 * Connecte VoiceOutputHub avec les services existants:
 * - TTS (text-to-speech)
 * - Discord voice output
 * - Web voice response
 * - Chat text response
 * 
 * Flow unifié:
 * [Réponse AI] → VoiceOutputHub.speak() → [TTS/Text] → [Destination]
 */

import { voiceOutputHub } from "./VoiceOutputHub";
import type { OutputDestination } from "./VoiceOutputHub";

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
  persona: "ulysse" | "iris" | "alfred",
  destination: OutputDestination,
  generateAudio: boolean = false
): Promise<{
  success: boolean;
  audioUrl?: string;
  duration?: number;
}> {
  const result = await voiceOutputHub.speak({
    content,
    destination,
    metadata: {
      userId,
      timestamp: Date.now(),
      persona,
      destination,
      generateAudio
    }
  });

  return {
    success: result.success,
    audioUrl: result.audioUrl,
    duration: result.duration
  };
}

export async function speakToWebVoiceViaBridge(
  content: string,
  userId: number,
  persona: "ulysse" | "iris" | "alfred"
) {
  return voiceOutputHub.speakToWebVoice(content, userId, persona);
}

export async function speakToDiscordViaBridge(
  content: string,
  guildId: string,
  channelId: string,
  userId: number,
  persona: "ulysse" | "iris" | "alfred"
) {
  return voiceOutputHub.speakToDiscord(content, guildId, channelId, userId, persona);
}

export async function respondToChatViaBridge(
  content: string,
  userId: number,
  persona: "ulysse" | "iris" | "alfred",
  conversationId?: number
) {
  return voiceOutputHub.respondToChat(content, userId, persona, conversationId);
}

export async function notifyViaBridge(
  content: string,
  userId: number,
  persona: "ulysse" | "iris" | "alfred",
  priority: "low" | "medium" | "high" = "medium"
) {
  return voiceOutputHub.notify(content, userId, persona, priority);
}

export function getVoiceOutputHubStats() {
  return {
    bridgeInitialized,
    hubStats: voiceOutputHub.getStats()
  };
}
