/**
 * Voice Engine OpenAI - Implémentation directe pour TTS/STT
 * Utilise l'API OpenAI Audio (tts-1, whisper-1)
 */

import OpenAI from "openai";
import { Readable } from "stream";
import type {
  IVoiceEngine,
  VoiceCapabilities,
  TTSOptions,
  STTOptions,
} from "./types";

const directApiKey = process.env.OPENAI_API_KEY || null;

const openaiAudio = directApiKey
  ? new OpenAI({
      apiKey: directApiKey,
    })
  : null;

export class OpenAIVoiceEngine implements IVoiceEngine {
  private name = "OpenAI Direct";

  getName(): string {
    return this.name;
  }

  getCapabilities(): VoiceCapabilities {
    if (!openaiAudio) {
      return {
        tts: false,
        stt: false,
        provider: "none",
        supportsStreamingTTS: false,
        maxTTSChars: 4000,
        maxSTTSeconds: 600,
      };
    }

    return {
      tts: true,
      stt: true,
      provider: "openai_direct",
      supportsStreamingTTS: true,
      maxTTSChars: 4000,
      maxSTTSeconds: 600,
    };
  }

  async textToSpeech(text: string, options: TTSOptions = {}): Promise<Buffer> {
    if (!openaiAudio) {
      throw new Error(
        "TTS_NOT_SUPPORTED: OPENAI_API_KEY direct requis pour la voix."
      );
    }

    const { voice = "onyx", speed = 1.0, model = "tts-1" } = options;

    try {
      const res = await openaiAudio.audio.speech.create({
        model,
        voice,
        input: text,
        speed,
        response_format: "mp3",
      });

      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      console.error("[VoiceEngine:OpenAI] TTS error:", error);
      throw new Error("TTS_ERROR: " + (error as Error).message);
    }
  }

  async textToSpeechStream(
    text: string,
    options: TTSOptions = {}
  ): Promise<NodeJS.ReadableStream> {
    const buffer = await this.textToSpeech(text, options);
    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);
    return readable;
  }

  async speechToText(
    audioBuffer: Buffer,
    options: STTOptions = {}
  ): Promise<string> {
    if (!openaiAudio) {
      throw new Error(
        "STT_NOT_SUPPORTED: OPENAI_API_KEY direct requis pour la voix."
      );
    }

    const language = options.language || "fr";
    const mimeType = options.mimeType || "audio/webm";

    try {
      let extension = "webm";
      let contentType = "audio/webm";

      if (mimeType.includes("mp4") || mimeType.includes("m4a")) {
        extension = "m4a";
        contentType = "audio/m4a";
      } else if (mimeType.includes("ogg") || mimeType.includes("oga")) {
        extension = "ogg";
        contentType = "audio/ogg";
      } else if (mimeType.includes("wav")) {
        extension = "wav";
        contentType = "audio/wav";
      } else if (
        mimeType.includes("mp3") ||
        mimeType.includes("mpeg") ||
        mimeType.includes("mpga")
      ) {
        extension = "mp3";
        contentType = "audio/mpeg";
      } else if (mimeType.includes("flac")) {
        extension = "flac";
        contentType = "audio/flac";
      }

      console.log(
        `[VoiceEngine:OpenAI:STT] mimeType=${mimeType}, extension=${extension}, size=${audioBuffer.length}`
      );

      const file = new File([audioBuffer], `audio.${extension}`, {
        type: contentType,
      });

      const transcription = await openaiAudio.audio.transcriptions.create({
        file,
        model: "whisper-1",
        language,
        response_format: "text",
      });

      return transcription as unknown as string;
    } catch (error) {
      console.error("[VoiceEngine:OpenAI] STT error:", error);
      throw new Error("STT_ERROR: " + (error as Error).message);
    }
  }
}
