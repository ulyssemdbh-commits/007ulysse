import OpenAI from "openai";
import { Readable } from "stream";

// For audio (TTS/STT), we MUST use the direct OpenAI API, not modelfarm
// Modelfarm doesn't support audio endpoints
// Priority: user's own OPENAI_API_KEY, then fallback to AI integrations
const directApiKey = process.env.OPENAI_API_KEY;
const modelfarmApiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;

// Check if modelfarm key is a placeholder/dummy
const isModelfarmKeyValid = modelfarmApiKey && !modelfarmApiKey.includes('DUMMY');

// For TTS, we need a real OpenAI API key (not modelfarm)
// Use user's own key if provided, otherwise TTS won't work
const ttsApiKey = directApiKey || null;

// Check if this is modelfarm (contains 'modelfarm' or 'replit' in the URL)
const isModelfarm = baseURL ? (baseURL.includes('modelfarm') || baseURL.includes('replit')) : false;

// For audio, always use direct OpenAI API (no baseURL override)
// Only create if we have a valid key
const openaiForAudio = ttsApiKey ? new OpenAI({
  apiKey: ttsApiKey,
  // Don't use baseURL for audio - must go directly to OpenAI
}) : null;

// For regular text completions, use whatever is configured
const apiKey = directApiKey || modelfarmApiKey;
const openai = new OpenAI({
  apiKey: apiKey,
  baseURL: isModelfarm ? baseURL : undefined,
});

export interface TTSOptions {
  voice?: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
  speed?: number;
  model?: string;
}

export async function textToSpeech(
  text: string,
  options: TTSOptions = {}
): Promise<Buffer> {
  // Check if we have an API key for TTS
  if (!openaiForAudio) {
    throw new Error("TTS_NOT_SUPPORTED: No OpenAI API key configured. TTS requires a direct OpenAI API key (OPENAI_API_KEY), Modelfarm does not support audio.");
  }
  
  const { voice = "onyx", speed = 1.0, model = "tts-1" } = options;

  try {
    // Always use openaiForAudio (direct OpenAI, not modelfarm)
    const mp3Response = await openaiForAudio.audio.speech.create({
      model,
      voice,
      input: text,
      speed,
      response_format: "mp3",
    });

    const arrayBuffer = await mp3Response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error("TTS error:", error);
    throw error;
  }
}

export async function textToSpeechStream(
  text: string,
  options: TTSOptions = {}
): Promise<Readable> {
  if (!openaiForAudio) {
    throw new Error("TTS_NOT_SUPPORTED: No OpenAI API key configured. TTS requires a direct OpenAI API key (OPENAI_API_KEY), Modelfarm does not support audio.");
  }

  const { voice = "onyx", speed = 1.0, model = "tts-1" } = options;

  try {
    // Always use openaiForAudio (direct OpenAI, not modelfarm)
    const response = await openaiForAudio.audio.speech.create({
      model,
      voice,
      input: text,
      speed,
      response_format: "mp3",
    });

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);
    return readable;
  } catch (error) {
    console.error("TTS stream error:", error);
    throw error;
  }
}

export async function speechToText(
  audioBuffer: Buffer,
  language: string = "fr",
  mimeType: string = "audio/webm"
): Promise<string> {
  // Check if we have an API key for audio
  if (!openaiForAudio) {
    throw new Error("STT_NOT_SUPPORTED: No OpenAI API key configured. STT requires a direct OpenAI API key (OPENAI_API_KEY), Modelfarm does not support audio.");
  }
  
  try {
    // Detect format from mimeType and use correct extension
    // Whisper supports: flac, m4a, mp3, mp4, mpeg, mpga, oga, ogg, wav, webm
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
    } else if (mimeType.includes("mp3") || mimeType.includes("mpeg") || mimeType.includes("mpga")) {
      extension = "mp3";
      contentType = "audio/mpeg";
    } else if (mimeType.includes("flac")) {
      extension = "flac";
      contentType = "audio/flac";
    } else if (mimeType.includes("webm")) {
      extension = "webm";
      contentType = "audio/webm";
    }
    
    console.log(`[STT] Processing audio: mimeType=${mimeType}, extension=${extension}, size=${audioBuffer.length}`);
    
    const file = new File([audioBuffer], `audio.${extension}`, { type: contentType });
    
    // Always use openaiForAudio (direct OpenAI, not modelfarm)
    const transcription = await openaiForAudio.audio.transcriptions.create({
      file,
      model: "whisper-1",
      language,
      response_format: "text",
    });

    return transcription as unknown as string;
  } catch (error) {
    console.error("Whisper STT error:", error);
    throw error;
  }
}

// Export helper to check if voice features are available
export function isVoiceSupported(): boolean {
  // Voice is supported if we have a direct OpenAI API key (not modelfarm)
  return !!ttsApiKey;
}

export function splitTextForStreaming(text: string): string[] {
  const chunks: string[] = [];
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  
  let currentChunk = "";
  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > 150) {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += sentence;
    }
  }
  if (currentChunk.trim()) chunks.push(currentChunk.trim());
  
  return chunks.length > 0 ? chunks : [text];
}
