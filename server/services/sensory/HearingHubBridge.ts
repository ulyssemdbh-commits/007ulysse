/**
 * HEARING HUB BRIDGE - Harmonisation du système auditif
 * 
 * Connecte HearingHub avec les services existants:
 * - Whisper transcription (voix → texte)
 * - Discord voice (messages vocaux Discord)
 * - Web chat (messages texte)
 * - TalkingApp (voix web)
 * 
 * Flow unifié:
 * [Audio/Texte] → HearingHub.hear() → [Analyse + Intent] → [Résultat]
 */

import { hearingHub } from "./HearingHub";
import type { HearingSource } from "./HearingHub";

let bridgeInitialized = false;

export function initializeHearingHubBridge(): void {
  if (bridgeInitialized) {
    console.log("[HearingHubBridge] Déjà initialisé");
    return;
  }

  console.log("[HearingHubBridge] Initialisation du bridge auditif...");
  bridgeInitialized = true;
  console.log("[HearingHubBridge] ✅ Bridge auditif initialisé");
}

export async function transcribeViaHearingHub(
  transcript: string,
  userId: number,
  persona: "ulysse" | "iris" | "alfred",
  source: HearingSource = "web_voice"
): Promise<{
  resolvedContent: string;
  intent: any;
  shouldRouteToBrain: boolean;
  confidence: number;
}> {
  const result = await hearingHub.hear({
    rawContent: transcript,
    source,
    metadata: {
      userId,
      timestamp: Date.now(),
      persona,
      source
    }
  });

  return {
    resolvedContent: result.resolvedContent,
    intent: result.intent,
    shouldRouteToBrain: result.shouldRouteToBrain,
    confidence: result.confidence
  };
}

export async function hearFromWebVoiceViaBridge(
  transcript: string,
  userId: number,
  persona: "ulysse" | "iris" | "alfred"
) {
  return hearingHub.hearFromWebVoice(transcript, userId, persona);
}

export async function hearFromDiscordViaBridge(
  transcript: string,
  discordUserId: string,
  guildId: string,
  channelId: string,
  userId: number,
  persona: "ulysse" | "iris" | "alfred"
) {
  return hearingHub.hearFromDiscordVoice(
    transcript,
    discordUserId,
    guildId,
    channelId,
    userId,
    persona
  );
}

export async function hearFromChatViaBridge(
  message: string,
  userId: number,
  persona: "ulysse" | "iris" | "alfred",
  conversationId?: number
) {
  return hearingHub.hearFromWebChat(message, userId, persona, conversationId);
}

export async function hearFromSiriViaBridge(
  transcript: string,
  deviceId: string,
  userId: number
) {
  return hearingHub.hearFromSiri(transcript, deviceId, userId);
}

export function getHearingHubStats() {
  return {
    bridgeInitialized,
    hubStats: hearingHub.getStats()
  };
}
