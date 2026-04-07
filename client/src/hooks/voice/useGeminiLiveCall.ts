import { useState, useRef, useCallback, useEffect } from "react";

export type GeminiCallState = "idle" | "connecting" | "ready" | "in_call" | "error";

export interface GeminiTranscriptEntry {
    id: string;
    text: string;
    isUser: boolean;
    timestamp: number;
}

export interface UseGeminiLiveCallOptions {
    persona?: "ulysse" | "iris";
    userName?: string;
    onTranscript?: (entry: GeminiTranscriptEntry) => void;
    onStateChange?: (state: GeminiCallState) => void;
}

export interface UseGeminiLiveCallResult {
    callState: GeminiCallState;
    isListening: boolean;
    isSpeaking: boolean;
    micLevel: number;
    speakerLevel: number;
    transcripts: GeminiTranscriptEntry[];
    error: string | null;
    startCall: () => Promise<void>;
    endCall: () => void;
    toggleMute: () => void;
    isMuted: boolean;
}

// ─── PCM16 Helpers ────────────────────────────────────────────────────────────

function float32ToPCM16Base64(float32: Float32Array): string {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
        const clamped = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }
    const bytes = new Uint8Array(int16.buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function pcm16Base64ToFloat32(base64: string): Float32Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768.0;
    return float32;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGeminiLiveCall(options: UseGeminiLiveCallOptions = {}): UseGeminiLiveCallResult {
    const { persona = "ulysse", userName, onTranscript, onStateChange } = options;

    const [callState, setCallStateRaw] = useState<GeminiCallState>("idle");
    const [isListening, setIsListening] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [micLevel, setMicLevel] = useState(0);
    const [speakerLevel, setSpeakerLevel] = useState(0);
    const [transcripts, setTranscripts] = useState<GeminiTranscriptEntry[]>([]);
    const [error, setError] = useState<string | null>(null);

    const wsRef = useRef<WebSocket | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const micStreamRef = useRef<MediaStream | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const isMutedRef = useRef(false);
    const playbackQueueRef = useRef<{ data: Float32Array; sampleRate: number }[]>([]);
    const isPlayingRef = useRef(false);
    const micLevelTimerRef = useRef<number | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const setCallState = useCallback((state: GeminiCallState) => {
        setCallStateRaw(state);
        onStateChange?.(state);
    }, [onStateChange]);

    // ─── Playback Queue ───────────────────────────────────────────────────────

    const playNextChunk = useCallback(() => {
        const ctx = audioContextRef.current;
        if (!ctx || playbackQueueRef.current.length === 0) {
            isPlayingRef.current = false;
            setIsSpeaking(false);
            return;
        }

        isPlayingRef.current = true;
        setIsSpeaking(true);

        const { data, sampleRate } = playbackQueueRef.current.shift()!;
        const buffer = ctx.createBuffer(1, data.length, sampleRate);
        buffer.copyToChannel(data, 0);

        const source = ctx.createBufferSource();
        source.buffer = buffer;

        // Analyser for speaker level
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyser.connect(ctx.destination);

        const dataArr = new Uint8Array(analyser.frequencyBinCount);
        const levelInterval = setInterval(() => {
            analyser.getByteFrequencyData(dataArr);
            const avg = dataArr.reduce((a, b) => a + b, 0) / dataArr.length;
            setSpeakerLevel(Math.min(1, avg / 128));
        }, 50);

        source.onended = () => {
            clearInterval(levelInterval);
            setSpeakerLevel(0);
            playNextChunk();
        };

        source.start();
    }, []);

    const enqueueAudio = useCallback((base64: string, mimeType: string) => {
        const sampleRate = mimeType.includes("24000") ? 24000 : 24000;
        const float32 = pcm16Base64ToFloat32(base64);
        playbackQueueRef.current.push({ data: float32, sampleRate });

        if (!isPlayingRef.current) {
            playNextChunk();
        }
    }, [playNextChunk]);

    // ─── WebSocket Messages ───────────────────────────────────────────────────

    const handleMessage = useCallback((event: MessageEvent) => {
        let msg: any;
        try {
            msg = JSON.parse(event.data);
        } catch {
            return;
        }

        switch (msg.type) {
            case "ready":
                break;

            case "authenticated":
                console.log("[GeminiLive] Authenticated, waiting for Gemini...");
                break;

            case "gemini_connected":
                setCallState("in_call");
                setIsListening(true);
                setError(null);
                console.log("[GeminiLive] Gemini Live session ready, conversation active");
                break;

            case "audio":
                enqueueAudio(msg.data, msg.mimeType || "audio/pcm;rate=24000");
                break;

            case "transcript": {
                const entry: GeminiTranscriptEntry = {
                    id: `${Date.now()}-${Math.random()}`,
                    text: msg.text,
                    isUser: msg.isUser,
                    timestamp: Date.now(),
                };
                setTranscripts(prev => [...prev.slice(-50), entry]);
                onTranscript?.(entry);
                break;
            }

            case "turn_complete":
                break;

            case "gemini_disconnected":
                setIsListening(false);
                setIsSpeaking(false);
                break;

            case "error":
                setError(msg.message);
                console.error("[GeminiLive] Server error:", msg.message);
                break;

            case "pong":
                break;
        }
    }, [enqueueAudio, setCallState, onTranscript]);

    // ─── Mic Capture ─────────────────────────────────────────────────────────

    const startMicCapture = useCallback(async (ws: WebSocket) => {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 16000,
            },
        });

        micStreamRef.current = stream;

        const ctx = new AudioContext({ sampleRate: 16000 });
        audioContextRef.current = ctx;

        const source = ctx.createMediaStreamSource(stream);
        sourceRef.current = source;

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyserRef.current = analyser;
        source.connect(analyser);

        const processor = ctx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;
        source.connect(processor);
        processor.connect(ctx.destination);

        const dataArr = new Uint8Array(analyser.frequencyBinCount);
        micLevelTimerRef.current = window.setInterval(() => {
            analyser.getByteFrequencyData(dataArr);
            const avg = dataArr.reduce((a, b) => a + b, 0) / dataArr.length;
            setMicLevel(Math.min(1, avg / 60));
        }, 50);

        let lastSend = Date.now();
        const SEND_INTERVAL_MS = 200;

        processor.onaudioprocess = (e) => {
            if (isMutedRef.current) return;
            if (ws.readyState !== WebSocket.OPEN) return;

            const now = Date.now();
            if (now - lastSend < SEND_INTERVAL_MS) return;
            lastSend = now;

            const inputData = e.inputBuffer.getChannelData(0);
            const base64 = float32ToPCM16Base64(inputData);

            // Send as binary when possible, JSON fallback
            try {
                const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
                ws.send(bytes.buffer);
            } catch {
                ws.send(JSON.stringify({ type: "audio_base64", data: base64 }));
            }
        };
    }, []);

    // ─── Connect ──────────────────────────────────────────────────────────────

    const startCall = useCallback(async () => {
        if (callState !== "idle" && callState !== "error") return;

        setCallState("connecting");
        setError(null);
        setTranscripts([]);
        playbackQueueRef.current = [];
        isPlayingRef.current = false;

        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${protocol}//${window.location.host}/ws/voice/gemini`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = async () => {
            console.log("[GeminiLive] WebSocket connected");
            ws.send(JSON.stringify({
                type: "auth",
                persona,
                userName: userName || "User",
            }));

            try {
                await startMicCapture(ws);
            } catch (err: any) {
                setError("Microphone inaccessible: " + err.message);
                setCallState("error");
                ws.close();
            }
        };

        ws.onmessage = handleMessage;

        ws.onclose = () => {
            console.log("[GeminiLive] WebSocket closed");
            setIsListening(false);
            setIsSpeaking(false);
            if (callState === "in_call") {
                setCallState("idle");
            }
        };

        ws.onerror = () => {
            setError("Connexion au serveur Gemini Live échouée");
            setCallState("error");
        };

        setCallState("connecting");
    }, [callState, persona, userName, handleMessage, startMicCapture, setCallState]);

    // ─── Disconnect ───────────────────────────────────────────────────────────

    const endCall = useCallback(() => {
        if (micLevelTimerRef.current) {
            clearInterval(micLevelTimerRef.current);
            micLevelTimerRef.current = null;
        }
        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }
        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current = null;
        }
        if (sourceRef.current) {
            sourceRef.current.disconnect();
            sourceRef.current = null;
        }
        if (micStreamRef.current) {
            micStreamRef.current.getTracks().forEach(t => t.stop());
            micStreamRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close().catch(() => {});
            audioContextRef.current = null;
        }
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }

        playbackQueueRef.current = [];
        isPlayingRef.current = false;
        setCallState("idle");
        setIsListening(false);
        setIsSpeaking(false);
        setMicLevel(0);
        setSpeakerLevel(0);
    }, [setCallState]);

    const toggleMute = useCallback(() => {
        isMutedRef.current = !isMutedRef.current;
        setIsMuted(isMutedRef.current);
    }, []);

    useEffect(() => {
        return () => {
            endCall();
        };
    }, []);

    return {
        callState,
        isListening,
        isSpeaking,
        micLevel,
        speakerLevel,
        transcripts,
        error,
        startCall,
        endCall,
        toggleMute,
        isMuted,
    };
}
