/**
 * realtimeResponse.ts — CORE VOICE PIPELINE v4.1
 *
 * Architecture :  Whisper STT → LLM Stream → Sentence Queue → Parallel TTS → Audio Stream
 *
 * Perf :
 *   1. LLM streaming (stream: true) — première phrase dispo en ~200ms
 *   2. TTS démarre par phrase dès qu'elle est complète
 *   3. TTS parallèles, lecture séquentielle ordonnée
 *   4. Fallback "split forcé" si pas de ponctuation après X caractères
 *
 * Fixes v4.1 :
 *   - Barge-in : reset propre + event voice_reset client
 *   - isProcessing : guard d'entrée + finally garanti
 *   - Protocole events : speaking → audio_chunk* → audio_end → done
 *   - Erreurs TTS/LLM remontées explicitement au client
 *   - Fallback phrase si buffer > 120 chars sans ponctuation
 *   - Taille max réponse (600 tokens → truncate)
 *   - executeActionViaChat : log erreurs HTTP + réseau
 *   - VoiceSessionRef typé (interface)
 */

import { getOpenAIAudio, getOpenAINullable } from '../core/openaiClient.js';
import { chatStorage } from '../../replit_integrations/chat/storage.js';
import { emitConversationMessage } from '../realtimeSync.js';
import { voiceActivityService } from './activity.js';
import { routeVoiceRequest, logVoiceSession, type VoiceMetadata } from './voiceIntentRouter.js';
import { hearingHub, voiceOutputHub, brainHub } from '../sensory/index.js';
import { formatSportsContextForAI } from '../sportsScreenContext.js';
import { shouldPlayTTS } from './realtimeFilters.js';
import { resolveDialogueStyle, buildDialogueSystemHint, type DialogueStyle } from './dialogueManager.js';
import { voiceSessionManager } from './voiceSessionManager.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VoiceSessionShape {
    ws: { readyState: number; send: (data: string) => void };
    userId?: string | number;
    userName?: string;
    persona?: string;
    isOwner?: boolean;
    isInCallMode?: boolean;
    isProcessing: boolean;
    bargeInRequested: boolean;
    hasValidHeader: boolean;
    audioChunks: Buffer[];
    pcmBuffer: Buffer[];
    callHistory: Array<{ role: string; content: string }>;
    lastAssistantResponse?: string;
    systemPrompt?: string;
    conversationId?: string | number;
    channel?: string;
    httpRequest?: { headers?: { cookie?: string } };
    _brainDomain?: string;
    _dialogueStyle?: DialogueStyle;
    turnDetector?: { reset: () => void };
}

// Loose alias — keeps backward compat with existing callers
export type VoiceSessionRef = VoiceSessionShape | any;

// ─── Constants ────────────────────────────────────────────────────────────────

const SENTENCE_END_RE = /[.!?。！？]\s*/;
const MIN_SENTENCE_CHARS = 8;
const FORCE_SPLIT_CHARS = 120;   // Force TTS if buffer exceeds this without punctuation
const MAX_RESPONSE_CHARS = 1800; // Truncate past this (≈ 600 tokens)
const MAX_TTS_NULL_STREAK = 3;   // Send tts_error to client after N consecutive null TTS

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sendJson(session: VoiceSessionRef, data: Record<string, unknown>) {
    try {
        if (session.ws?.readyState === 1) {
            session.ws.send(JSON.stringify(data));
        }
    } catch (e) {
        console.warn("[VoicePipeline] sendJson failed:", e);
    }
    try {
        const sid = session.sessionId;
        if (!sid) return;
        const t = data.type as string;
        if (t === "listening" || t === "listening_started") {
            voiceSessionManager.transition(sid, "listening");
        } else if (t === "processing" || t === "thinking") {
            voiceSessionManager.transition(sid, "thinking", data as any);
        } else if (t === "speaking") {
            voiceSessionManager.transition(sid, "speaking");
        } else if (t === "done" || t === "voice_reset") {
            voiceSessionManager.transition(sid, "idle");
            voiceSessionManager.sendDone(sid);
        } else if (t === "transcript") {
            voiceSessionManager.sendTranscript(sid, data.text as string, true);
        } else if (t === "response_chunk") {
            voiceSessionManager.sendResponseChunk(sid, data.text as string);
        } else if (t === "response") {
            if (data.full) voiceSessionManager.sendResponseFull(sid, data.text as string, data.domain as string);
        } else if (t === "response_truncated") {
            voiceSessionManager.sendProgress(sid, "truncated", "Réponse tronquée");
        } else if (t === "ui_action") {
            voiceSessionManager.sendUIAction(sid, data.action as string, data.data);
        } else if (t === "system_command") {
            voiceSessionManager.sendSystemCommand(sid, data.command as string, data.data);
        } else if (t === "error" || t === "tts_error") {
            voiceSessionManager.sendError(sid, data.message as string);
        }
    } catch {}
}

/**
 * Réinitialise proprement l'état d'une session vocale.
 * À appeler en début de nouveau tour, après erreur, ou après barge-in.
 */
export function resetVoiceSession(session: VoiceSessionRef) {
    session.bargeInRequested = false;
    session.isProcessing = false;
    session.audioChunks = [];
    session.pcmBuffer = [];           // Vide le buffer PCM résiduel du tour précédent
    session.hasValidHeader = false;
    session.turnDetector?.reset?.();  // Réinitialise le détecteur de fin de parole
    sendJson(session, { type: "voice_reset" });
}

// ─── Sentence segmentation ────────────────────────────────────────────────────

function extractSentences(buffer: string): { sentences: string[]; remainder: string } {
    const sentences: string[] = [];
    let remainder = buffer;

    while (true) {
        const match = SENTENCE_END_RE.exec(remainder);
        if (!match) break;
        const end = match.index + match[0].length;
        const sentence = remainder.slice(0, end).trim();
        if (sentence.length >= MIN_SENTENCE_CHARS) {
            sentences.push(sentence);
        }
        remainder = remainder.slice(end);
    }

    // Force-split fallback: buffer trop long sans ponctuation
    if (sentences.length === 0 && remainder.length > FORCE_SPLIT_CHARS) {
        // Coupe à la dernière virgule ou espace avant la limite
        const cutPoint = remainder.lastIndexOf(",", FORCE_SPLIT_CHARS) > 20
            ? remainder.lastIndexOf(",", FORCE_SPLIT_CHARS) + 1
            : remainder.lastIndexOf(" ", FORCE_SPLIT_CHARS);
        if (cutPoint > MIN_SENTENCE_CHARS) {
            sentences.push(remainder.slice(0, cutPoint).trim());
            remainder = remainder.slice(cutPoint).trim();
        }
    }

    return { sentences, remainder };
}

// ─── Piper TTS engine — circuit breaker ───────────────────────────────────────
//
// Priority: Piper (local, ~100ms, zero API cost) → OpenAI TTS (fallback)
// Circuit breaker: 3 consecutive Piper failures → cooldown 30s → try again

const PIPER_URL = process.env.PIPER_TTS_URL || "http://localhost:5002/tts";
const PIPER_MAX_ERRORS = 3;
const PIPER_COOLDOWN_MS = 30_000;

let piperErrorCount = 0;
let piperDownUntil = 0;

function piperCircuitOpen(): boolean {
    if (piperDownUntil > 0) {
        if (Date.now() < piperDownUntil) return true;
        // Cooldown expired — half-open: try one request
        piperErrorCount = 0;
        piperDownUntil = 0;
    }
    return false;
}

function recordPiperError() {
    piperErrorCount++;
    if (piperErrorCount >= PIPER_MAX_ERRORS) {
        piperDownUntil = Date.now() + PIPER_COOLDOWN_MS;
        console.error(`[PiperTTS] ⚡ Circuit OPEN — Piper paused ${PIPER_COOLDOWN_MS / 1000}s, using OpenAI fallback`);
    }
}

function recordPiperSuccess() {
    if (piperErrorCount > 0) {
        console.log("[PiperTTS] Circuit reset — Piper recovered");
    }
    piperErrorCount = 0;
    piperDownUntil = 0;
}

type AudioResult = { audio: string; mimeType: string };

async function ttsViaPiper(text: string): Promise<AudioResult | null> {
    if (piperCircuitOpen()) return null;
    try {
        const resp = await fetch(PIPER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: text.trim(), cache: true }),
            signal: AbortSignal.timeout(8000),
        });
        if (!resp.ok) {
            recordPiperError();
            console.warn(`[PiperTTS] HTTP ${resp.status} — falling back to OpenAI`);
            return null;
        }
        const json = await resp.json() as { audio_base64?: string; mime_type?: string; latency_ms?: number };
        if (!json.audio_base64) {
            recordPiperError();
            return null;
        }
        recordPiperSuccess();
        if (json.latency_ms) {
            console.log(`[PiperTTS] ✓ ${json.latency_ms}ms${json.latency_ms < 50 ? " (cache hit)" : ""}`);
        }
        return { audio: json.audio_base64, mimeType: json.mime_type || "audio/wav" };
    } catch (err: any) {
        recordPiperError();
        if (err?.name !== "TimeoutError") {
            console.warn("[PiperTTS] Error:", err?.message || err);
        }
        return null;
    }
}

// ─── TTS single sentence ─────────────────────────────────────────────────────
//
// Flow: Piper (local) → OpenAI TTS fallback

async function ttsOneSentence(text: string, voice: string): Promise<AudioResult | null> {
    if (text.trim().length < 2) return null;

    // 1. Piper local TTS (fast, free, no API dependency)
    const piperResult = await ttsViaPiper(text);
    if (piperResult) return piperResult;

    // 2. OpenAI TTS fallback (if Piper is down or circuit open)
    const client = getOpenAIAudio();
    if (!client) return null;

    try {
        const resp = await client.audio.speech.create({
            model: "tts-1",
            voice: voice as any,
            input: text.trim(),
            response_format: "opus",
            speed: 1.08,
        });
        const buf = Buffer.from(await resp.arrayBuffer());
        return { audio: buf.toString("base64"), mimeType: "audio/ogg" };
    } catch (err) {
        console.error("[VoicePipeline] OpenAI TTS fallback error for:", JSON.stringify(text.slice(0, 40)), err);
        return null;
    }
}

// ─── pipelineStreamTTS — pour texte déjà connu (router) ─────────────────────

async function pipelineStreamTTS(session: VoiceSessionRef, text: string): Promise<void> {
    if (!shouldPlayTTS(session)) {
        // Client must know: no audio_chunk will follow
        sendJson(session, { type: "tts_redirected", message: "Audio sur TalkingApp" });
        sendJson(session, { type: "audio_end" });
        return;
    }

    const voice = session.isOwner ? "onyx" : "nova";
    const raw = text.replace(/\n+/g, " ").trim();
    const { sentences, remainder } = extractSentences(raw);
    const allSentences = [
        ...sentences,
        ...(remainder.trim().length >= MIN_SENTENCE_CHARS ? [remainder.trim()] : []),
    ];

    if (allSentences.length === 0) {
        sendJson(session, { type: "audio_end" });
        return;
    }

    // Launch all TTS in parallel, preserve playback order
    const ttsPromises = allSentences.map(s => ttsOneSentence(s, voice));

    let nullStreak = 0;

    for (let i = 0; i < ttsPromises.length; i++) {
        if (session.bargeInRequested) {
            console.log("[VoicePipeline] pipelineStreamTTS: barge-in, aborting");
            break;
        }
        const result = await ttsPromises[i];
        if (result && !session.bargeInRequested) {
            nullStreak = 0;
            sendJson(session, { type: "audio_chunk", audio: result.audio, mimeType: result.mimeType, sentence: allSentences[i] });
        } else {
            nullStreak++;
            if (nullStreak >= MAX_TTS_NULL_STREAK) {
                sendJson(session, { type: "tts_error", message: "Synthèse vocale indisponible" });
                break;
            }
        }
    }

    sendJson(session, { type: "audio_end" });
}

// ─── streamLLMAndSpeak — pipeline cœur LLM→TTS ──────────────────────────────

async function streamLLMAndSpeak(
    session: VoiceSessionRef,
    messages: any[],
    onComplete: (fullText: string) => Promise<void>,
    opts: { maxTokens?: number } = {}
): Promise<void> {
    if (!shouldPlayTTS(session)) {
        sendJson(session, { type: "tts_redirected", message: "Audio sur TalkingApp" });
        sendJson(session, { type: "audio_end" });
        return;
    }

    const chatClient = getOpenAINullable();
    if (!chatClient) {
        sendJson(session, { type: "response", text: "Configuration IA manquante.", full: true });
        sendJson(session, { type: "audio_end" });
        return;
    }

    const voice = session.isOwner ? "onyx" : "nova";

    let stream: AsyncIterable<any>;
    try {
        stream = await chatClient.chat.completions.create({
            model: "gpt-4o-mini",
            messages,
            max_tokens: opts.maxTokens || 400,
            temperature: 0.75,
            stream: true,
        });
    } catch (err) {
        console.error("[VoicePipeline] LLM stream creation error:", err);
        sendJson(session, { type: "error", message: "Erreur IA vocale" });
        sendJson(session, { type: "audio_end" });
        return;
    }

    let tokenBuffer = "";
    let fullResponse = "";
    let nullStreak = 0;

    // Ordered TTS queue
    const ttsQueue: Array<{ sentence: string; promise: Promise<AudioResult | null> }> = [];
    let draining: Promise<void> | null = null;

    async function drainQueue() {
        while (ttsQueue.length > 0) {
            if (session.bargeInRequested) break;
            const item = ttsQueue.shift()!;
            const result = await item.promise;
            if (result && !session.bargeInRequested) {
                nullStreak = 0;
                sendJson(session, { type: "audio_chunk", audio: result.audio, mimeType: result.mimeType, sentence: item.sentence });
            } else {
                nullStreak++;
                if (nullStreak >= MAX_TTS_NULL_STREAK) {
                    sendJson(session, { type: "tts_error", message: "Synthèse vocale indisponible" });
                    // Vide la queue — inutile de continuer si TTS est mort
                    ttsQueue.length = 0;
                    break;
                }
            }
        }
    }

    function enqueueSentence(sentence: string) {
        if (session.bargeInRequested) return;
        const promise = ttsOneSentence(sentence, voice);
        ttsQueue.push({ sentence, promise });
        if (!draining) {
            draining = drainQueue().then(() => { draining = null; });
        }
    }

    sendJson(session, { type: "speaking" });

    try {
        for await (const chunk of stream) {
            if (session.bargeInRequested) break;

            const token = chunk.choices[0]?.delta?.content ?? "";
            if (!token) continue;

            // Guard max response length
            if (fullResponse.length + token.length > MAX_RESPONSE_CHARS) {
                sendJson(session, { type: "response_truncated", message: "Réponse tronquée" });
                break;
            }

            tokenBuffer += token;
            fullResponse += token;
            sendJson(session, { type: "response_chunk", text: token });

            const { sentences, remainder } = extractSentences(tokenBuffer);
            tokenBuffer = remainder;
            for (const s of sentences) enqueueSentence(s);
        }
    } catch (err) {
        console.error("[VoicePipeline] LLM streaming error mid-stream:", err);
        sendJson(session, { type: "error", message: "Erreur IA vocale" });
        sendJson(session, { type: "audio_end" });
        return;
    }

    // Flush final fragment
    const finalChunk = tokenBuffer.trim();
    if (finalChunk.length > 0 && !session.bargeInRequested) {
        enqueueSentence(finalChunk);
    }

    // Wait for all queued TTS
    if (draining) await draining;
    while (ttsQueue.length > 0 && !session.bargeInRequested) {
        const item = ttsQueue.shift()!;
        const result = await item.promise;
        if (result) sendJson(session, { type: "audio_chunk", audio: result.audio, mimeType: result.mimeType, sentence: item.sentence });
    }

    sendJson(session, { type: "audio_end" });

    // Fire onComplete (DB sync, response event) — after all audio
    await onComplete(fullResponse);
}

// ─── detectActionRequest ─────────────────────────────────────────────────────

export function detectActionRequest(message: string): { needsAction: boolean; actionType: string | null } {
    const patterns = [
        { pattern: /génèr|gener|crée|créer|fais.*image|photo|dessin/i, type: "image" },
        { pattern: /cherche|recherche|google|trouve.*info|actualité|news/i, type: "search" },
        { pattern: /envoie|envoi.*email|mail/i, type: "email" },
        { pattern: /calendrier|rdv|rendez-vous|événement/i, type: "calendar" },
        { pattern: /spotify|musique|joue|play|mets.*chanson/i, type: "music" },
    ];
    for (const { pattern, type } of patterns) {
        if (pattern.test(message)) return { needsAction: true, actionType: type };
    }
    return { needsAction: false, actionType: null };
}

// ─── executeActionViaChat ────────────────────────────────────────────────────

export async function executeActionViaChat(session: VoiceSessionRef, userMessage: string): Promise<string | null> {
    if (!session.conversationId || !session.userId) return null;

    try {
        const port = process.env.PORT || 5000;
        const response = await fetch(`http://localhost:${port}/api/conversations/${session.conversationId}/messages`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Cookie": session.httpRequest?.headers?.cookie || "",
            },
            body: JSON.stringify({ content: userMessage }),
        });

        if (!response.ok) {
            console.error(`[VoicePipeline] executeActionViaChat HTTP ${response.status}`);
            return null;
        }

        const result = await response.json();
        return result.content || result.message || "Action exécutée.";
    } catch (err) {
        console.error("[VoicePipeline] executeActionViaChat network error:", err);
        return null;
    }
}

// ─── processTextAndRespond ────────────────────────────────────────────────────

export async function processTextAndRespond(session: VoiceSessionRef, text: string, context: any[]) {
    if (session.isProcessing) {
        console.log("[VoicePipeline] Barge-in: interrupting current turn for new input");
        session.bargeInRequested = true;
        await new Promise(r => setTimeout(r, 80));
        resetVoiceSession(session);
    }

    try {
        sendJson(session, { type: "processing" });

        if (session.userId) {
            const processedHearing = await hearingHub.hear({
                content: text,
                metadata: {
                    source: session.channel === "talking-v2" ? "web_voice" : "web_chat",
                    type: "text",
                    timestamp: Date.now(),
                    userId: session.userId,
                    persona: session.persona,
                    conversationId: session.conversationId,
                    messageHistory: session.callHistory.slice(-5).map((m: any) => ({
                        role: m.role, content: m.content
                    }))
                }
            });

            const dialogueStyle = resolveDialogueStyle({
                domain: processedHearing.domain,
                intent: processedHearing.intent,
                sentiment: processedHearing.sentiment,
            });
            session._dialogueStyle = dialogueStyle;
            session._brainDomain = processedHearing.domain;

            if (dialogueStyle.fillerEnabled && dialogueStyle.fillerText) {
                sendJson(session, { type: "thinking", message: dialogueStyle.fillerText });
            }

            try {
                const brainResult = await brainHub.processInput({
                    content: processedHearing.resolvedContent,
                    source: session.channel === "talking-v2" ? 'talking_v3' : 'web_chat',
                    userId: session.userId,
                    persona: session.persona as 'ulysse' | 'iris' | 'alfred',
                    isVoice: true,
                    metadata: {
                        conversationId: session.conversationId,
                        intent: processedHearing.intent,
                        domain: processedHearing.domain
                    }
                });
                if (brainResult.decision.action === 'wait' && brainResult.decision.confidence > 0.8) {
                    sendJson(session, { type: 'thinking', message: 'Un moment...' });
                    await new Promise(r => setTimeout(r, 300));
                }
            } catch { /* Brain non-bloquant */ }

            await generateAndStreamResponse(session, processedHearing.resolvedContent, context);
        } else {
            await generateAndStreamResponse(session, text, context);
        }
    } catch (error) {
        console.error("[VoicePipeline] processTextAndRespond error:", error);
        sendJson(session, { type: "error", message: "Erreur de traitement" });
        session.isProcessing = false;
        session.audioChunks = [];
    }
}

// ─── generateAndStreamResponse — orchestrateur principal ─────────────────────

export async function generateAndStreamResponse(session: VoiceSessionRef, userMessage: string, context: any[]) {
    const startTime = Date.now();
    let completedSuccessfully = false;

    // Verrou d'entrée
    session.isProcessing = true;
    session.bargeInRequested = false;

    try {
        // === VOICE ROUTER (domaines spécialisés : football, sugu, météo…) ===
        if (session.userId && session.isInCallMode) {
            const voiceMetadata: VoiceMetadata = {
                origin: "voice",
                channel: "talking-v2",
                mode: "continuous",
                userId: session.userId,
                userName: session.userName,
                persona: session.persona,
                timestamp: Date.now(),
            };

            const routedResponse = await routeVoiceRequest(userMessage, voiceMetadata);

            if (routedResponse?.success && routedResponse.text) {
                const latencyMs = Date.now() - startTime;

                logVoiceSession({
                    channel: "talking-v2",
                    userId: session.userId,
                    userName: session.userName,
                    text: userMessage,
                    intent: routedResponse.action?.type || routedResponse.domain,
                    domain: routedResponse.domain,
                    dataSources: routedResponse.dataSources,
                    latencyMs,
                    success: true,
                    timestamp: new Date(),
                });

                if (routedResponse.domain === "system" && routedResponse.action) {
                    sendJson(session, {
                        type: "system_command",
                        command: routedResponse.action.uiAction,
                        data: routedResponse.action.data,
                    });
                }

                if (routedResponse.action?.uiAction && routedResponse.domain !== "system") {
                    sendJson(session, {
                        type: "ui_action",
                        action: routedResponse.action.uiAction,
                        data: routedResponse.action.data,
                    });
                }

                session.lastAssistantResponse = routedResponse.text;
                sendJson(session, { type: "response", text: routedResponse.text, full: true, domain: routedResponse.domain });

                voiceActivityService.logEvent(session.userId, {
                    type: 'response', content: routedResponse.text, persona: session.persona, domain: routedResponse.domain,
                });

                await syncToConversation(session, userMessage, routedResponse.text);

                // Protocol: speaking → audio_chunk* → audio_end → done
                sendJson(session, { type: "speaking" });
                await pipelineStreamTTS(session, routedResponse.text);
                // audio_end is sent inside pipelineStreamTTS
                sendJson(session, { type: "done" });

                completedSuccessfully = true;
                console.log(`[VoicePipeline] Routed in ${Date.now() - startTime}ms via ${routedResponse.dataSources?.join(", ")}`);
                return;
            }
        }

        // === STANDARD LLM STREAMING PATH ===
        let systemContent = session.systemPrompt || "";
        if (session.userId) {
            const sportsCtx = formatSportsContextForAI(session.userId);
            if (sportsCtx) systemContent += "\n\n" + sportsCtx;
        }

        const dialogueStyle: DialogueStyle | undefined = session._dialogueStyle;
        if (dialogueStyle) {
            systemContent += "\n\n" + buildDialogueSystemHint(dialogueStyle);
        }

        const messages: any[] = [
            { role: "system", content: systemContent },
            ...context.slice(-6),
            { role: "user", content: userMessage }
        ];

        const effectiveMaxTokens = dialogueStyle?.maxTokens || 400;

        await streamLLMAndSpeak(session, messages, async (fullResponse) => {
            session.lastAssistantResponse = fullResponse;
            sendJson(session, { type: "response", text: fullResponse, full: true });

            if (session.userId) {
                voiceActivityService.logEvent(session.userId, {
                    type: 'response', content: fullResponse, persona: session.persona
                });
                voiceOutputHub.speak({
                    text: fullResponse,
                    metadata: {
                        destination: "web_voice",
                        priority: "normal",
                        userId: session.userId,
                        persona: session.persona,
                        conversationId: session.conversationId,
                        inResponseTo: userMessage.substring(0, 100),
                        generateAudio: false,
                        domain: session._brainDomain || 'generic',
                    }
                }).catch(() => {});
            }

            await syncToConversation(session, userMessage, fullResponse);
        }, { maxTokens: effectiveMaxTokens });

        // audio_end already sent inside streamLLMAndSpeak
        sendJson(session, { type: "done" });

        completedSuccessfully = true;
        console.log(`[VoicePipeline] Full response in ${Date.now() - startTime}ms`);

    } catch (error) {
        console.error("[VoicePipeline] generateAndStreamResponse error:", error);
        sendJson(session, { type: "error", message: "Erreur de génération" });
        sendJson(session, { type: "audio_end" });
    } finally {
        if (completedSuccessfully) {
            // Succès : reset silencieux des champs d'état (pas de voice_reset au client)
            session.isProcessing = false;
            session.audioChunks = [];
            session.hasValidHeader = false;
            session.turnDetector?.reset?.();
        } else {
            // Erreur ou interruption : reset complet + signal au client
            resetVoiceSession(session);
        }
    }
}

// ─── generateTTSChunks (compat backward) ─────────────────────────────────────

export async function generateTTSChunks(session: VoiceSessionRef, text: string) {
    await pipelineStreamTTS(session, text);
}

// ─── syncToConversation ───────────────────────────────────────────────────────

async function syncToConversation(session: VoiceSessionRef, userMessage: string, assistantMessage: string) {
    if (!session.conversationId || !session.userId) return;
    try {
        await chatStorage.createMessage(session.conversationId, "user", userMessage);
        await chatStorage.createMessage(session.conversationId, "assistant", assistantMessage);
        emitConversationMessage(session.userId, session.conversationId, "user", userMessage, undefined, "voice");
        emitConversationMessage(session.userId, session.conversationId, "assistant", assistantMessage, undefined, "voice");
    } catch (e) {
        console.warn("[VoicePipeline] Conversation sync failed:", e);
    }
}
