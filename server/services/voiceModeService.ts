import { textToSpeech, speechToText, isVoiceSupported } from "./voice/core";
import { getOpenAI } from "./core/openaiClient";
import type { TTSOptions } from "./voice/core";
import { Readable } from "stream";

interface VoiceConversationResult {
  success: boolean;
  transcription?: string;
  aiResponse?: string;
  audioBase64?: string;
  audioFormat?: string;
  processingTime?: number;
  error?: string;
}

interface VoiceTranscriptionResult {
  success: boolean;
  text?: string;
  language?: string;
  duration?: number;
  confidence?: number;
  error?: string;
}

interface VoiceSynthesisResult {
  success: boolean;
  audioBase64?: string;
  audioFormat?: string;
  charCount?: number;
  error?: string;
}

class VoiceModeService {
  private static instance: VoiceModeService;
  private conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [];

  static getInstance(): VoiceModeService {
    if (!this.instance) this.instance = new VoiceModeService();
    return this.instance;
  }

  getStatus(): { available: boolean; provider: string; capabilities: string[] } {
    const supported = isVoiceSupported();
    return {
      available: supported,
      provider: "OpenAI (Whisper + TTS)",
      capabilities: [
        "transcription (Whisper)",
        "synthesis (TTS alloy/echo/fable/onyx/nova/shimmer)",
        "conversation (full voice loop)",
        "multi-language",
      ],
    };
  }

  async transcribe(audioBuffer: Buffer, mimeType: string = "audio/webm"): Promise<VoiceTranscriptionResult> {
    const start = Date.now();
    try {
      const text = await speechToText(audioBuffer, { mimeType, language: "fr" });

      if (!text || text.trim().length === 0) {
        return { success: false, error: "Aucune parole détectée dans l'audio" };
      }

      console.log(`[VoiceMode] 🎤 Transcribed (${Date.now() - start}ms): "${text.substring(0, 100)}"`);

      return {
        success: true,
        text: text.trim(),
        language: "fr",
        duration: Math.round((Date.now() - start) / 1000),
        confidence: 0.95,
      };
    } catch (error: any) {
      console.error("[VoiceMode] Transcription error:", error.message);
      return { success: false, error: error.message };
    }
  }

  async synthesize(text: string, voice: TTSOptions["voice"] = "onyx", speed: number = 1.0): Promise<VoiceSynthesisResult> {
    const start = Date.now();
    try {
      const audioBuffer = await textToSpeech(text, { voice, speed });

      if (!audioBuffer || audioBuffer.length === 0) {
        return { success: false, error: "Échec de la synthèse vocale" };
      }

      const audioBase64 = Buffer.isBuffer(audioBuffer) ? audioBuffer.toString("base64") : Buffer.from(audioBuffer).toString("base64");

      console.log(`[VoiceMode] 🔊 Synthesized (${Date.now() - start}ms): ${text.length} chars → ${audioBase64.length} base64 chars`);

      return {
        success: true,
        audioBase64,
        audioFormat: "audio/mp3",
        charCount: text.length,
      };
    } catch (error: any) {
      console.error("[VoiceMode] Synthesis error:", error.message);
      return { success: false, error: error.message };
    }
  }

  async converse(audioBuffer: Buffer, mimeType: string = "audio/webm", userId: number = 1, voice: TTSOptions["voice"] = "onyx"): Promise<VoiceConversationResult> {
    const start = Date.now();

    try {
      const transcription = await this.transcribe(audioBuffer, mimeType);
      if (!transcription.success || !transcription.text) {
        return { success: false, error: transcription.error || "Transcription échouée" };
      }

      this.conversationHistory.push({ role: "user", content: transcription.text });
      if (this.conversationHistory.length > 20) {
        this.conversationHistory = this.conversationHistory.slice(-16);
      }

      const openai = getOpenAI();
      const aiResponse = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: `Tu es Ulysse, un assistant IA personnel. Tu réponds de manière naturelle et concise pour une conversation vocale.
Règles pour le mode vocal:
- Réponds en 1 à 3 phrases maximum
- Évite les listes, tableaux et formatage markdown
- Sois direct et naturel comme dans une vraie conversation
- Utilise le tutoiement
- Si on te demande quelque chose de complexe, résume en une phrase et propose d'envoyer les détails par écrit
- Ton propriétaire est Maurice, restaurateur à Marseille`
          },
          ...this.conversationHistory.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
        ],
        max_tokens: 200,
        temperature: 0.7,
      });

      const aiText = aiResponse.choices[0]?.message?.content || "Je n'ai pas compris, peux-tu répéter ?";
      this.conversationHistory.push({ role: "assistant", content: aiText });

      const synthesis = await this.synthesize(aiText, voice);

      console.log(`[VoiceMode] 🔁 Full converse loop: ${Date.now() - start}ms`);

      return {
        success: true,
        transcription: transcription.text,
        aiResponse: aiText,
        audioBase64: synthesis.audioBase64,
        audioFormat: synthesis.audioFormat,
        processingTime: Date.now() - start,
      };
    } catch (error: any) {
      console.error("[VoiceMode] Converse error:", error.message);
      return { success: false, error: error.message };
    }
  }

  resetConversation(): void {
    this.conversationHistory = [];
    console.log("[VoiceMode] Conversation reset");
  }
}

export const voiceModeService = VoiceModeService.getInstance();
