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

let _openaiCircuitOpen = false;
let _openaiCircuitOpenAt = 0;
const OPENAI_CIRCUIT_RESET_MS = 5 * 60 * 1000;

export function markOpenAIDown() {
    if (!_openaiCircuitOpen) {
        console.log("[AI-Circuit] OpenAI circuit breaker OPEN — switching to Gemini");
    }
    _openaiCircuitOpen = true;
    _openaiCircuitOpenAt = Date.now();
}

export function markOpenAIUp() {
    if (_openaiCircuitOpen) {
        console.log("[AI-Circuit] OpenAI circuit breaker CLOSED — back to normal");
    }
    _openaiCircuitOpen = false;
}

export function isOpenAIAvailable(): boolean {
    if (!_openaiCircuitOpen) return true;
    if (Date.now() - _openaiCircuitOpenAt > OPENAI_CIRCUIT_RESET_MS) {
        console.log("[AI-Circuit] OpenAI circuit breaker auto-reset after 5min");
        _openaiCircuitOpen = false;
        return true;
    }
    return false;
}

const CONTEXT_MODEL_MAP: Record<AIContext, string> = {
    owner: "gpt-5.1",
    iris: "gpt-4o",
    devops: "gpt-4.1",
    devops_iris: "gpt-4o",
    devmax: "gpt-4.1",
    suguval: "gpt-4.1-mini",
    coba: "gpt-4.1-mini",
    guest: "gpt-4.1-mini",
    background: "gpt-4.1-mini",
};

export function getAIForContext(_context: AIContext): AIEntry {
    if (!isOpenAIAvailable()) {
        const gemini = getGemini();
        if (gemini) {
            return { client: gemini, model: "gemini-2.5-pro", provider: "gemini" };
        }
    }
    const model = CONTEXT_MODEL_MAP[_context] || "gpt-4.1-mini";
    return { client: getOpenAI(), model, provider: "openai" };
}

export function getFallbackChainForContext(_context: AIContext): AIEntry[] {
    const chain: AIEntry[] = [];
    const contextModel = CONTEXT_MODEL_MAP[_context] || "gpt-4.1-mini";
    if (isOpenAIAvailable()) {
        const openai = getOpenAINullable();
        if (openai) chain.push({ client: openai, model: contextModel, provider: "openai" });
        const gemini = getGemini();
        if (gemini) chain.push({ client: gemini, model: "gemini-2.5-pro", provider: "gemini" });
    } else {
        const gemini = getGemini();
        if (gemini) chain.push({ client: gemini, model: "gemini-2.5-pro", provider: "gemini" });
        const openai = getOpenAINullable();
        if (openai) chain.push({ client: openai, model: contextModel, provider: "openai" });
    }
    return chain;
}

export function getPrimaryAI(): AIEntry {
    if (!isOpenAIAvailable()) {
        const gemini = getGemini();
        if (gemini) return { client: gemini, model: "gemini-2.5-pro", provider: "gemini" };
    }
    return { client: getOpenAI(), model: "gpt-4.1-mini", provider: "openai" };
}

export function getSmartAI(): OpenAI {
    if (!isOpenAIAvailable()) {
        const gemini = getGemini();
        if (gemini) return gemini;
    }
    return getOpenAI();
}

export function getSmartAINullable(): OpenAI | null {
    if (!isOpenAIAvailable()) {
        const gemini = getGemini();
        if (gemini) return gemini;
    }
    return getOpenAINullable();
}

export function wrapWithCircuitBreaker(fn: () => Promise<any>): Promise<any> {
    return fn().catch((err: any) => {
        const isQuota = err.status === 429 || err.code === 'insufficient_quota' || err.message?.includes('insufficient_quota') || err.message?.includes('exceeded your current quota');
        if (isQuota) {
            markOpenAIDown();
            const gemini = getGemini();
            if (gemini) {
                return fn();
            }
        }
        throw err;
    });
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
