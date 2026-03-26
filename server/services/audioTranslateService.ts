import { db } from "../db";
import { ulysseFiles } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { translationService } from "./translationService";
import { 
  coreSpeechToText, 
  coreTextToSpeech, 
  isVoiceSupported 
} from "./voice";
import type { TTSOptions } from "./voice";
import { ObjectStorageService } from "../replit_integrations/object_storage/objectStorage";

const objectStorage = new ObjectStorageService();

export interface AudioTranslateRequest {
  userId: number;
  fileId?: number;
  audioBuffer?: Buffer;
  audioMimeType?: string;
  targetLang: string;
  sourceLang?: string;
  domain?: "general" | "sports" | "tech" | "business";
  tone?: "neutral" | "formal" | "casual";
  generateAudio?: boolean;
  ttsVoice?: TTSOptions["voice"];
}

export interface AudioTranslateResult {
  success: boolean;
  error?: string;
  sourceLang: string;
  targetLang: string;
  originalTranscript: string;
  translatedTranscript: string;
  audioBuffer?: Buffer;
  audioFileId?: number;
  metadata: {
    durationMs: number;
    fromCache: boolean;
    transcriptionLength: number;
    translationLength: number;
  };
}

export class AudioTranslateService {
  async translateAudio(req: AudioTranslateRequest): Promise<AudioTranslateResult> {
    const start = Date.now();
    
    if (!isVoiceSupported()) {
      return {
        success: false,
        error: "Voice features not supported: No OpenAI API key configured (OPENAI_API_KEY required)",
        sourceLang: req.sourceLang || "unknown",
        targetLang: req.targetLang,
        originalTranscript: "",
        translatedTranscript: "",
        metadata: {
          durationMs: Date.now() - start,
          fromCache: false,
          transcriptionLength: 0,
          translationLength: 0,
        },
      };
    }

    try {
      let audioBuffer: Buffer;
      let mimeType = req.audioMimeType || "audio/webm";

      if (req.audioBuffer) {
        audioBuffer = req.audioBuffer;
      } else if (req.fileId) {
        const fileData = await this.getFileBuffer(req.userId, req.fileId);
        if (!fileData) {
          return {
            success: false,
            error: "Fichier introuvable ou accès refusé",
            sourceLang: req.sourceLang || "unknown",
            targetLang: req.targetLang,
            originalTranscript: "",
            translatedTranscript: "",
            metadata: {
              durationMs: Date.now() - start,
              fromCache: false,
              transcriptionLength: 0,
              translationLength: 0,
            },
          };
        }
        audioBuffer = fileData.buffer;
        mimeType = fileData.mimeType;
      } else {
        return {
          success: false,
          error: "Aucun audio fourni (fileId ou audioBuffer requis)",
          sourceLang: req.sourceLang || "unknown",
          targetLang: req.targetLang,
          originalTranscript: "",
          translatedTranscript: "",
          metadata: {
            durationMs: Date.now() - start,
            fromCache: false,
            transcriptionLength: 0,
            translationLength: 0,
          },
        };
      }

      console.log(`[AudioTranslate] Starting: ${audioBuffer.length} bytes, target=${req.targetLang}`);

      // 1) Transcription avec Whisper
      const sourceLangForWhisper = req.sourceLang && req.sourceLang !== "auto" 
        ? req.sourceLang 
        : undefined;
      
      let originalTranscript: string;
      try {
        originalTranscript = await coreSpeechToText(audioBuffer, {
          language: sourceLangForWhisper || "auto",
          mimeType,
        });
      } catch (sttError: any) {
        console.error("[AudioTranslate] Transcription error:", sttError);
        return {
          success: false,
          error: `Erreur de transcription: ${sttError.message}`,
          sourceLang: req.sourceLang || "unknown",
          targetLang: req.targetLang,
          originalTranscript: "",
          translatedTranscript: "",
          metadata: {
            durationMs: Date.now() - start,
            fromCache: false,
            transcriptionLength: 0,
            translationLength: 0,
          },
        };
      }

      if (!originalTranscript || originalTranscript.trim().length < 3) {
        return {
          success: false,
          error: "Transcription vide ou trop courte",
          sourceLang: req.sourceLang || "unknown",
          targetLang: req.targetLang,
          originalTranscript: originalTranscript || "",
          translatedTranscript: "",
          metadata: {
            durationMs: Date.now() - start,
            fromCache: false,
            transcriptionLength: originalTranscript?.length || 0,
            translationLength: 0,
          },
        };
      }

      console.log(`[AudioTranslate] Transcribed: ${originalTranscript.length} chars`);

      // Detect source language if not specified
      const detectedSourceLang = req.sourceLang && req.sourceLang !== "auto"
        ? req.sourceLang
        : await this.detectLanguage(originalTranscript);

      // 2) Traduction via Ulysse Translation Core
      const translation = await translationService.translate({
        text: originalTranscript,
        targetLang: req.targetLang,
        sourceLang: detectedSourceLang,
        domain: req.domain || "general",
        tone: req.tone || "neutral",
      });

      console.log(`[AudioTranslate] Translated: ${translation.translated.length} chars (cache: ${translation.fromCache})`);

      let resultAudioBuffer: Buffer | undefined;
      let audioFileId: number | undefined;

      // 3) Synthèse audio optionnelle
      if (req.generateAudio !== false) {
        try {
          resultAudioBuffer = await coreTextToSpeech(translation.translated, {
            voice: req.ttsVoice || this.getVoiceForLanguage(req.targetLang),
            speed: 1.0,
          });

          console.log(`[AudioTranslate] TTS generated: ${resultAudioBuffer.length} bytes`);

          // Sauvegarder le fichier audio traduit
          if (req.userId) {
            audioFileId = await this.saveAudioFile(
              req.userId,
              resultAudioBuffer,
              req.targetLang,
              translation.translated.slice(0, 100)
            );
          }
        } catch (ttsError: any) {
          console.error("[AudioTranslate] TTS error:", ttsError);
        }
      }

      return {
        success: true,
        sourceLang: translation.sourceLang || detectedSourceLang,
        targetLang: translation.targetLang,
        originalTranscript,
        translatedTranscript: translation.translated,
        audioBuffer: resultAudioBuffer,
        audioFileId,
        metadata: {
          durationMs: Date.now() - start,
          fromCache: translation.fromCache,
          transcriptionLength: originalTranscript.length,
          translationLength: translation.translated.length,
        },
      };
    } catch (error: any) {
      console.error("[AudioTranslate] Error:", error);
      return {
        success: false,
        error: error.message || "Erreur inconnue lors de la traduction audio",
        sourceLang: req.sourceLang || "unknown",
        targetLang: req.targetLang,
        originalTranscript: "",
        translatedTranscript: "",
        metadata: {
          durationMs: Date.now() - start,
          fromCache: false,
          transcriptionLength: 0,
          translationLength: 0,
        },
      };
    }
  }

  async translateAudioDirect(
    audioBuffer: Buffer,
    targetLang: string,
    options?: {
      sourceLang?: string;
      domain?: "general" | "sports" | "tech" | "business";
      tone?: "neutral" | "formal" | "casual";
      generateAudio?: boolean;
      mimeType?: string;
    }
  ): Promise<AudioTranslateResult> {
    return this.translateAudio({
      userId: 0,
      audioBuffer,
      audioMimeType: options?.mimeType || "audio/webm",
      targetLang,
      sourceLang: options?.sourceLang,
      domain: options?.domain,
      tone: options?.tone,
      generateAudio: options?.generateAudio,
    });
  }

  private async getFileBuffer(userId: number, fileId: number): Promise<{ buffer: Buffer; mimeType: string } | null> {
    try {
      const [file] = await db
        .select()
        .from(ulysseFiles)
        .where(and(eq(ulysseFiles.id, fileId), eq(ulysseFiles.userId, userId)));

      if (!file) {
        return null;
      }

      const privateDir = objectStorage.getPrivateObjectDir();
      const fullPath = `${privateDir}/${file.storagePath}`;
      
      const { bucketName, objectName } = this.parseObjectPath(fullPath);
      const { objectStorageClient } = await import("../replit_integrations/object_storage/objectStorage");
      
      const bucket = objectStorageClient.bucket(bucketName);
      const fileObj = bucket.file(objectName);
      
      const [exists] = await fileObj.exists();
      if (!exists) {
        console.error(`[AudioTranslate] File not found in storage: ${fullPath}`);
        return null;
      }

      const [buffer] = await fileObj.download();
      return {
        buffer,
        mimeType: file.mimeType,
      };
    } catch (error) {
      console.error("[AudioTranslate] Error getting file:", error);
      return null;
    }
  }

  private async saveAudioFile(
    userId: number,
    audioBuffer: Buffer,
    lang: string,
    description: string
  ): Promise<number | undefined> {
    try {
      const filename = `audio_translation_${lang}_${Date.now()}.mp3`;
      const storagePath = `translations/${userId}/${filename}`;
      
      const privateDir = objectStorage.getPrivateObjectDir();
      const fullPath = `${privateDir}/${storagePath}`;
      
      const { bucketName, objectName } = this.parseObjectPath(fullPath);
      const { objectStorageClient } = await import("../replit_integrations/object_storage/objectStorage");
      
      const bucket = objectStorageClient.bucket(bucketName);
      const fileObj = bucket.file(objectName);
      
      await fileObj.save(audioBuffer, {
        contentType: "audio/mpeg",
        resumable: false,
      });

      const [inserted] = await db
        .insert(ulysseFiles)
        .values({
          userId,
          filename,
          originalName: filename,
          mimeType: "audio/mpeg",
          sizeBytes: audioBuffer.length,
          storagePath,
          description: `Traduction audio (${lang}): ${description}...`,
          generatedBy: "audio_translate",
          category: "generated",
        })
        .returning();

      console.log(`[AudioTranslate] Saved audio file: ${inserted.id}`);
      return inserted.id;
    } catch (error) {
      console.error("[AudioTranslate] Error saving audio file:", error);
      return undefined;
    }
  }

  private parseObjectPath(path: string): { bucketName: string; objectName: string } {
    const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
    const parts = normalizedPath.split("/");
    const bucketName = parts[0];
    const objectName = parts.slice(1).join("/");
    return { bucketName, objectName };
  }

  private async detectLanguage(text: string): Promise<string> {
    const sample = text.slice(0, 500).toLowerCase();
    
    const frenchWords = ["le", "la", "les", "un", "une", "de", "du", "des", "et", "ou", "est", "sont", "être", "avoir", "que", "qui", "dans", "pour", "sur", "avec", "ce", "cette", "ces"];
    const englishWords = ["the", "a", "an", "is", "are", "was", "were", "be", "been", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "can", "may", "might", "of", "to", "in", "for", "on", "with", "at", "by"];
    const spanishWords = ["el", "la", "los", "las", "un", "una", "de", "del", "y", "o", "es", "son", "ser", "estar", "que", "en", "para", "por", "con", "como"];
    const germanWords = ["der", "die", "das", "ein", "eine", "und", "oder", "ist", "sind", "haben", "sein", "werden", "nicht", "mit", "von", "zu", "in", "auf", "für"];
    const italianWords = ["il", "la", "le", "un", "una", "di", "del", "della", "e", "o", "è", "sono", "essere", "avere", "che", "in", "per", "con", "come"];
    const vietnameseWords = ["là", "có", "và", "hoặc", "của", "trong", "để", "với", "này", "đó", "không", "được", "các", "những", "một"];
    const thaiPatterns = /[\u0E00-\u0E7F]/;

    const countMatches = (words: string[]) => {
      const sampleWords = sample.split(/\s+/);
      return sampleWords.filter(w => words.includes(w)).length;
    };

    if (thaiPatterns.test(sample)) return "th";
    
    const scores: Record<string, number> = {
      fr: countMatches(frenchWords),
      en: countMatches(englishWords),
      es: countMatches(spanishWords),
      de: countMatches(germanWords),
      it: countMatches(italianWords),
      vi: countMatches(vietnameseWords),
    };

    const maxScore = Math.max(...Object.values(scores));
    if (maxScore < 2) return "auto";
    
    return Object.entries(scores).find(([, v]) => v === maxScore)?.[0] || "auto";
  }

  private getVoiceForLanguage(lang: string): TTSOptions["voice"] {
    const voiceMap: Record<string, TTSOptions["voice"]> = {
      fr: "onyx",
      en: "alloy",
      es: "nova",
      de: "echo",
      it: "shimmer",
      vi: "nova",
      th: "nova",
    };
    return voiceMap[lang] || "alloy";
  }
}

export const audioTranslateService = new AudioTranslateService();
