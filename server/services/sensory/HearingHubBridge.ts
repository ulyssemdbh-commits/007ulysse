/**
 * HEARING HUB BRIDGE - Harmonisation du système auditif
 * 
 * Connecte HearingHub avec les services existants:
 * - Whisper transcription (voix → texte)
 * - Discord voice (messages vocaux Discord)
 * - Web chat (messages texte)
 * - TalkingApp (voix web)
 * - Siri (commandes vocales)
 * 
 * Flow unifié:
 * [Audio/Texte] → HearingHub.hear() → [Analyse + Intent] → [Résultat]
 */

import { hearingHub, type ProcessedHearing } from "./HearingHub";
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
  persona: "ulysse" | "iris" | "alfred" | "maxai",
  source: HearingSource = "web_voice"
): Promise<{
  resolvedContent: string;
  intent: any;
  shouldRouteToBrain: boolean;
  domain: string;
}> {
  const result: ProcessedHearing = await hearingHub.hear({
    content: transcript,
    metadata: {
      source,
      type: source.includes("voice") ? "voice" : "text",
      timestamp: Date.now(),
      userId,
      persona: persona === "maxai" ? "ulysse" : persona,
    }
  });

  return {
    resolvedContent: result.resolvedContent,
    intent: result.intent,
    shouldRouteToBrain: result.shouldRouteToBrain,
    domain: result.domain,
  };
}

export async function hearFromWebVoiceViaBridge(
  transcript: string,
  userId: number,
  persona: "ulysse" | "iris" | "alfred" | "maxai"
) {
  return hearingHub.hearFromWebVoice(
    transcript,
    userId,
    persona === "maxai" ? "ulysse" : persona
  );
}

export async function hearFromDiscordViaBridge(
  transcript: string,
  discordUserId: string,
  guildId: string,
  channelId: string,
  userId: number,
  persona: "ulysse" | "iris" | "alfred" | "maxai" = "ulysse"
) {
  return hearingHub.hearFromDiscordVoice(
    transcript,
    userId,
    {
      guildId,
      channelId,
      memberId: discordUserId,
      memberName: discordUserId,
    }
  );
}

export async function hearFromChatViaBridge(
  message: string,
  userId: number,
  persona: "ulysse" | "iris" | "alfred" | "maxai",
  conversationId?: number
) {
  return hearingHub.hearFromWebChat(
    message,
    userId,
    persona === "maxai" ? "ulysse" : persona,
    conversationId
  );
}

export async function hearFromSiriViaBridge(
  transcript: string,
  _deviceId: string,
  userId: number
) {
  return hearingHub.hearFromSiri(transcript, userId);
}

export function getHearingHubStats() {
  return {
    bridgeInitialized,
    hubStats: hearingHub.getStats()
  };
}
