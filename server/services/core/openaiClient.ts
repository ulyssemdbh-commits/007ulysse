/**
 * Centralized AI client factory — single shared instances.
 *
 * AI ROUTING: OpenAI (gpt-4o-mini) pour TOUS les contextes.
 * Fallback: OpenAI → Gemini.
 */
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";

let _geminiNativeClient: GoogleGenAI | null = null;
let _geminiNativeChecked = false;

export function getGeminiNative(): GoogleGenAI | null {
    if (!_geminiNativeChecked) {
        const apiKey = process.env.GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
        if (apiKey) {
            const opts: any = { apiKey };
            if (process.env.AI_INTEGRATIONS_GEMINI_BASE_URL) {
                opts.httpOptions = { apiVersion: "", baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL };
            }
            _geminiNativeClient = new GoogleGenAI(opts);
        }
        _geminiNativeChecked = true;
    }
    return _geminiNativeClient;
}

export function getGeminiNativeRequired(): GoogleGenAI {
    const client = getGeminiNative();
    if (!client) throw new Error("Gemini API key missing — set GEMINI_API_KEY or AI_INTEGRATIONS_GEMINI_API_KEY");
    return client;
}

export type AIContext =
    | "owner"
    | "iris"
    | "devops"
    | "devops_iris"
    | "devmax"
    | "suguval"
    | "coba"
    | "guest"
    | "background";

type AIEntry = { client: OpenAI; model: string; provider: string };

export const OLLAMA_MODEL = "gpt-4o-mini";

export function getOllama(): OpenAI | null {
    return null;
}

let _geminiClient: OpenAI | null = null;
let _geminiChecked = false;

export function getGemini(): OpenAI | null {
    if (!_geminiChecked) {
        const geminiKey = process.env.GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
        if (geminiKey) {
            _geminiClient = new OpenAI({
                apiKey: geminiKey,
                baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
                timeout: 30000,
                maxRetries: 1,
            });
        }
        _geminiChecked = true;
    }
    return _geminiClient;
}

let _chatClient: OpenAI | null = null;
let _chatChecked = false;

export function getOpenAI(): OpenAI {
    if (!_chatChecked) {
        const integrationKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
        const directKey = process.env.OPENAI_API_KEY;
        const apiKey = integrationKey || directKey;
        if (apiKey) {
            _chatClient = new OpenAI({
                apiKey,
                baseURL: integrationKey
                    ? process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
                    : undefined,
                timeout: 60000,
                maxRetries: 2,
            });
        }
        _chatChecked = true;
    }
    if (!_chatClient) {
        throw new Error(
            "OpenAI API key missing — set AI_INTEGRATIONS_OPENAI_API_KEY or OPENAI_API_KEY"
        );
    }
    return _chatClient;
}

export function getOpenAINullable(): OpenAI | null {
    if (!_chatChecked) {
        try {
            return getOpenAI();
        } catch {
            return null;
        }
    }
    return _chatClient;
}

export function getAIForContext(_context: AIContext): AIEntry {
    return { client: getOpenAI(), model: "gpt-4o-mini", provider: "openai" };
}

export function getFallbackChainForContext(_context: AIContext): AIEntry[] {
    const chain: AIEntry[] = [];
    const openai = getOpenAINullable();
    if (openai) chain.push({ client: openai, model: "gpt-4o-mini", provider: "openai" });
    const gemini = getGemini();
    if (gemini) chain.push({ client: gemini, model: "gemini-2.0-flash", provider: "gemini" });
    return chain;
}

export function getPrimaryAI(): AIEntry {
    return { client: getOpenAI(), model: "gpt-4o-mini", provider: "openai" };
}

let _audioClient: OpenAI | null = null;
let _audioChecked = false;

export function getOpenAIAudio(): OpenAI | null {
    if (!_audioChecked) {
        const directKey = process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
        if (directKey) {
            _audioClient = new OpenAI({
                apiKey: directKey,
                timeout: 30000,
                maxRetries: 1,
            });
        }
        _audioChecked = true;
    }
    return _audioClient;
}
