import { GoogleGenAI } from "@google/genai";

const GEMINI_LIVE_MODEL = "gemini-2.0-flash-live-001";

function buildSystemPrompt(persona: "ulysse" | "iris", userName?: string): string {
    if (persona === "ulysse") {
        return `Tu es Ulysse, assistant IA personnel PUISSANT et AUTONOME de Maurice.

RÈGLE ABSOLUE: Ce que Maurice te dit a TOUJOURS priorité sur ta propre réflexion. Ses instructions directes écrasent tes raisonnements internes.

TES CAPACITÉS DIRECTES (tu peux les exécuter maintenant):
- Email (lecture/envoi)
- Recherche web (actualités, infos, météo)
- Mémoire persistante (tu te souviens de tout)
- Spotify (lecture, contrôle, playlists)
- Calendrier Google (événements, rappels)
- Restaurant SUGU Valentine: gestion complète

STYLE: Réponses ultra-courtes (2-3 phrases max), orientées action. Tu ne dis JAMAIS "je ne peux pas" - tu FAIS les choses. Parle naturellement, comme un ami proche expert. Réponds TOUJOURS en français.`;
    } else {
        const name = userName || "l'utilisateur";
        return `Tu es Iris, l'alter ego féminin d'Ulysse. Tu parles avec ${name}.

TES CAPACITÉS DIRECTES:
- Email (lecture/envoi)
- Recherche web (actualités, infos, météo)
- Mémoire persistante
- Spotify (lecture, contrôle, playlists)
- Calendrier Google (événements, rappels)

STYLE: Réponses ultra-courtes (2-3 phrases max), chaleureuse et encourageante. Tu ne dis JAMAIS "je ne peux pas". Parle naturellement comme une amie proche. Réponds TOUJOURS en français.`;
    }
}

export interface GeminiLiveCallbacks {
    onAudio: (audioBase64: string, mimeType: string) => void;
    onTranscript: (text: string, isUser: boolean) => void;
    onTurnComplete: () => void;
    onConnected: () => void;
    onClose: () => void;
    onError: (err: Error) => void;
}

export class GeminiLiveSession {
    private session: any = null;
    private isConnected = false;
    private persona: "ulysse" | "iris";
    private userName?: string;

    constructor(persona: "ulysse" | "iris" = "ulysse", userName?: string) {
        this.persona = persona;
        this.userName = userName;
    }

    async connect(callbacks: GeminiLiveCallbacks): Promise<void> {
        const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
        if (!apiKey) throw new Error("Gemini API key not configured");

        const ai = new GoogleGenAI({ apiKey });

        const systemPrompt = buildSystemPrompt(this.persona, this.userName);

        this.session = await ai.live.connect({
            model: GEMINI_LIVE_MODEL,
            callbacks: {
                onopen: () => {
                    this.isConnected = true;
                    console.log(`[GeminiLive] Session connected (${this.persona})`);
                    callbacks.onConnected();
                },
                onmessage: (msg: any) => {
                    const parts = msg.serverContent?.modelTurn?.parts || [];
                    for (const part of parts) {
                        if (part.inlineData?.data) {
                            callbacks.onAudio(
                                part.inlineData.data,
                                part.inlineData.mimeType || "audio/pcm;rate=24000"
                            );
                        }
                    }

                    if (msg.serverContent?.outputTranscription?.text) {
                        callbacks.onTranscript(msg.serverContent.outputTranscription.text, false);
                    }
                    if (msg.serverContent?.inputTranscription?.text) {
                        callbacks.onTranscript(msg.serverContent.inputTranscription.text, true);
                    }
                    if (msg.serverContent?.turnComplete) {
                        callbacks.onTurnComplete();
                    }
                },
                onerror: (err: any) => {
                    console.error("[GeminiLive] Error:", err);
                    callbacks.onError(new Error(String(err)));
                },
                onclose: () => {
                    this.isConnected = false;
                    console.log("[GeminiLive] Session closed");
                    callbacks.onClose();
                },
            },
            config: {
                responseModalities: ["AUDIO"],
                systemInstruction: { parts: [{ text: systemPrompt }] },
                inputAudioTranscription: {},
                outputAudioTranscription: {},
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: "Aoede" },
                    },
                },
            },
        });
    }

    sendAudio(pcmBase64: string): void {
        if (!this.session || !this.isConnected) return;
        try {
            this.session.sendRealtimeInput({
                audio: { data: pcmBase64, mimeType: "audio/pcm;rate=16000" },
            });
        } catch (err) {
            console.error("[GeminiLive] sendAudio error:", err);
        }
    }

    close(): void {
        if (this.session) {
            try {
                this.session.close();
            } catch {}
            this.session = null;
            this.isConnected = false;
        }
    }

    get connected(): boolean {
        return this.isConnected;
    }
}
