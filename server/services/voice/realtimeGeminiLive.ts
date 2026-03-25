import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { Duplex } from "stream";
import { GeminiLiveSession } from "./engineGeminiLive";
import { validateWebSocketSession } from "../realtimeSync";

interface GeminiLiveClientSession {
    ws: WebSocket;
    gemini: GeminiLiveSession | null;
    userId?: number;
    userName?: string;
    persona: "ulysse" | "iris";
    isAuthenticated: boolean;
    lastActivity: number;
    audioBuffer: Buffer[];
    isConnecting: boolean;
}

let geminiLiveWss: WebSocketServer | null = null;
const sessions = new Map<WebSocket, GeminiLiveClientSession>();

function send(ws: WebSocket, data: object) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

async function startGeminiSession(session: GeminiLiveClientSession): Promise<void> {
    if (session.isConnecting || session.gemini?.connected) return;
    session.isConnecting = true;

    const persona = session.persona;
    const userName = session.userName;

    const gemini = new GeminiLiveSession(persona, userName);
    session.gemini = gemini;

    try {
        await gemini.connect({
            onConnected: () => {
                session.isConnecting = false;
                send(session.ws, { type: "gemini_connected", persona });
                console.log(`[GeminiLiveWS] Gemini Live ready for user=${session.userId} persona=${persona}`);

                // Flush any buffered audio
                if (session.audioBuffer.length > 0) {
                    const combined = Buffer.concat(session.audioBuffer);
                    session.audioBuffer = [];
                    const base64 = combined.toString("base64");
                    gemini.sendAudio(base64);
                }
            },
            onAudio: (audioBase64: string, mimeType: string) => {
                send(session.ws, { type: "audio", data: audioBase64, mimeType });
            },
            onTranscript: (text: string, isUser: boolean) => {
                if (text.trim()) {
                    send(session.ws, { type: "transcript", text, isUser });
                }
            },
            onTurnComplete: () => {
                send(session.ws, { type: "turn_complete" });
            },
            onClose: () => {
                session.isConnecting = false;
                send(session.ws, { type: "gemini_disconnected" });
                // Auto-reconnect if ws still open
                if (session.ws.readyState === WebSocket.OPEN) {
                    console.log("[GeminiLiveWS] Auto-reconnecting Gemini session...");
                    setTimeout(() => startGeminiSession(session), 1000);
                }
            },
            onError: (err: Error) => {
                session.isConnecting = false;
                console.error("[GeminiLiveWS] Gemini error:", err.message);
                send(session.ws, { type: "error", message: err.message });
            },
        });
    } catch (err: any) {
        session.isConnecting = false;
        console.error("[GeminiLiveWS] Failed to connect Gemini session:", err.message);
        send(session.ws, { type: "error", message: `Connexion Gemini échouée: ${err.message}` });
    }
}

export function setupGeminiLiveVoice(): WebSocketServer {
    geminiLiveWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

    console.log("[GeminiLiveWS] WebSocket server initialized on /ws/voice/gemini");

    geminiLiveWss.on("connection", async (ws: WebSocket, request: IncomingMessage) => {
        console.log("[GeminiLiveWS] Client connected");

        const session: GeminiLiveClientSession = {
            ws,
            gemini: null,
            persona: "ulysse",
            isAuthenticated: false,
            lastActivity: Date.now(),
            audioBuffer: [],
            isConnecting: false,
        };

        sessions.set(ws, session);

        // Try cookie-based auth
        try {
            const authResult = await validateWebSocketSession(request);
            if (authResult) {
                session.userId = authResult.userId;
                session.isAuthenticated = true;
            }
        } catch {}

        // Message handler
        ws.on("message", async (data: Buffer | string, isBinary: boolean) => {
            session.lastActivity = Date.now();

            if (isBinary) {
                // Raw PCM16 audio from client
                const pcmBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
                if (session.gemini?.connected) {
                    session.gemini.sendAudio(pcmBuffer.toString("base64"));
                } else {
                    // Buffer until Gemini is ready
                    session.audioBuffer.push(pcmBuffer);
                    if (session.audioBuffer.length > 50) session.audioBuffer.shift(); // cap buffer
                }
                return;
            }

            // JSON control messages
            let msg: any;
            try {
                msg = JSON.parse(data.toString());
            } catch {
                return;
            }

            switch (msg.type) {
                case "auth": {
                    session.userName = msg.userName || "User";
                    const personaRaw = msg.persona || "ulysse";
                    session.persona = personaRaw === "iris" ? "iris" : "ulysse";
                    session.isAuthenticated = true;

                    console.log(`[GeminiLiveWS] Auth: user=${session.userName} persona=${session.persona}`);
                    send(ws, { type: "authenticated", persona: session.persona });

                    // Start Gemini session immediately
                    startGeminiSession(session);
                    break;
                }

                case "audio_base64": {
                    // Fallback: base64 audio sent as JSON (iOS compat)
                    const pcmBase64: string = msg.data;
                    if (session.gemini?.connected) {
                        session.gemini.sendAudio(pcmBase64);
                    } else {
                        const buf = Buffer.from(pcmBase64, "base64");
                        session.audioBuffer.push(buf);
                        if (session.audioBuffer.length > 50) session.audioBuffer.shift();
                    }
                    break;
                }

                case "config": {
                    // Hot reconfigure persona without full reconnect
                    if (msg.persona) {
                        session.persona = msg.persona === "iris" ? "iris" : "ulysse";
                        session.gemini?.close();
                        session.gemini = null;
                        startGeminiSession(session);
                    }
                    break;
                }

                case "ping":
                    send(ws, { type: "pong" });
                    break;
            }
        });

        ws.on("close", () => {
            console.log(`[GeminiLiveWS] Client disconnected user=${session.userId}`);
            session.gemini?.close();
            sessions.delete(ws);
        });

        ws.on("error", (err) => {
            console.error("[GeminiLiveWS] WS error:", err.message);
            session.gemini?.close();
            sessions.delete(ws);
        });

        // Send initial ready signal
        send(ws, { type: "ready" });
    });

    return geminiLiveWss;
}

export function handleGeminiLiveUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    if (!geminiLiveWss) return;
    geminiLiveWss.handleUpgrade(request, socket as any, head, (ws) => {
        geminiLiveWss!.emit("connection", ws, request);
    });
}
