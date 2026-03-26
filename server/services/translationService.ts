import OpenAI from "openai";
import crypto from "crypto";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

type Tone = "neutral" | "formal" | "casual";
type Domain = "general" | "sports" | "tech" | "business";

export interface TranslationRequest {
  text: string;
  targetLang: string;
  sourceLang?: string;
  domain?: Domain;
  tone?: Tone;
}

export interface TranslationResult {
  original: string;
  translated: string;
  sourceLang: string;
  targetLang: string;
  fromCache: boolean;
}

interface CacheEntry {
  translated: string;
  sourceLang: string;
  targetLang: string;
  timestamp: number;
}

const translationCache = new Map<string, CacheEntry>();
const TRANSLATION_CACHE_TTL = 6 * 60 * 60 * 1000; // 6h

function makeCacheKey(req: TranslationRequest): string {
  const raw = JSON.stringify({
    text: req.text.slice(0, 2000),
    targetLang: req.targetLang,
    sourceLang: req.sourceLang || "auto",
    domain: req.domain || "general",
    tone: req.tone || "neutral",
  });
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function getFromCache(key: string): CacheEntry | null {
  const entry = translationCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > TRANSLATION_CACHE_TTL) {
    translationCache.delete(key);
    return null;
  }
  return entry;
}

function setCache(key: string, entry: CacheEntry) {
  translationCache.set(key, { ...entry, timestamp: Date.now() });
}

function buildSystemPrompt(req: TranslationRequest): string {
  const tone = req.tone || "neutral";
  const domain = req.domain || "general";

  let toneInstruction = "";
  if (tone === "formal") toneInstruction = "Style formel, poli, sans tutoiement.";
  else if (tone === "casual") toneInstruction = "Style naturel et fluide, mais sans familiarité excessive.";
  else toneInstruction = "Style neutre, clair et naturel.";

  let domainInstruction = "";
  if (domain === "sports") domainInstruction = "Garde la terminologie sportive exacte (noms de clubs, joueurs, compétitions).";
  else if (domain === "tech") domainInstruction = "Respecte les termes techniques, ne traduis pas les noms de librairies, frameworks, APIs.";
  else if (domain === "business") domainInstruction = "Garde un ton professionnel adapté au contexte business.";

  return [
    "Tu es un moteur de TRADUCTION professionnel.",
    "Règles:",
    "- Tu traduis UNIQUEMENT le texte fourni, sans ajouter de commentaires.",
    "- Tu dois respecter le sens exact, sans interprétation ni résumé.",
    "- Tu dois conserver la mise en forme de base (paragraphes, listes, etc.).",
    "- Ne traduis pas les noms propres (personnes, clubs, marques) sauf si la traduction est standard (ex: Germany = Allemagne).",
    toneInstruction,
    domainInstruction,
  ].join("\n");
}

export class TranslationService {
  async translate(req: TranslationRequest): Promise<TranslationResult> {
    const text = req.text?.trim();
    if (!text) {
      return {
        original: "",
        translated: "",
        sourceLang: req.sourceLang || "unknown",
        targetLang: req.targetLang,
        fromCache: false,
      };
    }

    if (text.length < 4 || /^[\d\s.,;:!?€$%#@&*()\-+=<>{}[\]/\\|'"]+$/.test(text)) {
      return {
        original: text,
        translated: text,
        sourceLang: req.sourceLang || "auto",
        targetLang: req.targetLang,
        fromCache: false,
      };
    }

    if (req.sourceLang && req.sourceLang !== "auto" && req.sourceLang === req.targetLang) {
      return {
        original: text,
        translated: text,
        sourceLang: req.sourceLang,
        targetLang: req.targetLang,
        fromCache: false,
      };
    }

    const cacheKey = makeCacheKey(req);
    const cached = getFromCache(cacheKey);
    if (cached) {
      console.log(`[Translation] Cache hit for ${req.targetLang}`);
      return {
        original: text,
        translated: cached.translated,
        sourceLang: cached.sourceLang,
        targetLang: cached.targetLang,
        fromCache: true,
      };
    }

    const systemPrompt = buildSystemPrompt(req);
    const sourceLang = req.sourceLang || "auto";

    const messages = [
      {
        role: "system" as const,
        content: systemPrompt,
      },
      {
        role: "user" as const,
        content: `Langue source: ${sourceLang} (ou détecte automatiquement si "auto")\nLangue cible: ${req.targetLang}\n\nTexte à traduire:\n${text}`,
      },
    ];

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        temperature: 0.0,
        max_tokens: Math.min(4000, Math.floor(text.length * 1.2) + 64),
      });

      const translated = response.choices[0]?.message?.content?.trim() || text;
      const detectedLang = sourceLang === "auto" ? "auto-detect" : sourceLang;

      const entry: CacheEntry = {
        translated,
        sourceLang: detectedLang,
        targetLang: req.targetLang,
        timestamp: Date.now(),
      };
      setCache(cacheKey, entry);

      console.log(`[Translation] Translated ${text.length} chars from ${detectedLang} to ${req.targetLang}`);

      return {
        original: text,
        translated,
        sourceLang: detectedLang,
        targetLang: req.targetLang,
        fromCache: false,
      };
    } catch (error) {
      console.error("[Translation] Error:", error);
      return {
        original: text,
        translated: text,
        sourceLang: sourceLang,
        targetLang: req.targetLang,
        fromCache: false,
      };
    }
  }

  getCacheStats(): { size: number; entries: string[] } {
    return {
      size: translationCache.size,
      entries: Array.from(translationCache.keys()).slice(0, 10),
    };
  }

  clearCache(): void {
    translationCache.clear();
    console.log("[Translation] Cache cleared");
  }
}

export const translationService = new TranslationService();
