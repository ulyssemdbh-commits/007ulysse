/**
 * React hook for OpenAI Realtime API voice conversations.
 *
 * Architecture (replaces the legacy MediaRecorder/WebM pipeline):
 *   mic -> AudioWorklet (PCM16 24kHz) -> WS /ws/voice-realtime -> server proxy -> OpenAI
 *   OpenAI -> server proxy -> WS -> base64 PCM16 -> AudioContext playback queue
 *
 * Server-side VAD handles end-of-speech, no silence detection needed client-side.
 */
import { useCallback, useEffect, useRef, useState } from "react";

type ConnectionState = "disconnected" | "connecting" | "authenticating" | "authenticated";
type VoiceState = "idle" | "listening" | "user_speaking" | "processing" | "speaking";

interface UseOpenAIRealtimeOptions {
  autoConnect?: boolean;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk))
    );
  }
  return btoa(binary);
}

export function useOpenAIRealtime(options: UseOpenAIRealtimeOptions = {}) {
  const { autoConnect = true } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playbackTimeRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);

  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState<string>("");
  const [userTranscript, setUserTranscript] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // ---- Audio playback (PCM16 24kHz) ----
  const enqueuePCM16 = useCallback((base64: string) => {
    if (!playbackContextRef.current) {
      playbackContextRef.current = new (window.AudioContext ||
        (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    const ctx = playbackContextRef.current;
    const buffer = base64ToArrayBuffer(base64);
    const pcm16 = new Int16Array(buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 0x8000;

    const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
    audioBuffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const startAt = Math.max(now, playbackTimeRef.current);
    source.start(startAt);
    playbackTimeRef.current = startAt + audioBuffer.duration;
    isPlayingRef.current = true;
    setVoiceState("speaking");

    source.onended = () => {
      // If we've reached the end of the queued audio, go back to listening
      if (playbackContextRef.current && playbackTimeRef.current <= playbackContextRef.current.currentTime + 0.05) {
        isPlayingRef.current = false;
        setVoiceState((s) => (s === "speaking" ? "listening" : s));
      }
    };
  }, []);

  // ---- Mic capture via AudioWorklet ----
  const startMic = useCallback(async () => {
    if (workletNodeRef.current) return;

    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
    }
    const ctx = audioContextRef.current;
    if (ctx.state === "suspended") await ctx.resume();

    try {
      await ctx.audioWorklet.addModule("/pcm16-recorder-worklet.js");
    } catch (err) {
      console.error("[OpenAIRealtime] Failed to load AudioWorklet:", err);
      setError("Impossible de charger le micro AudioWorklet");
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    streamRef.current = stream;

    const source = ctx.createMediaStreamSource(stream);
    sourceNodeRef.current = source;
    const node = new AudioWorkletNode(ctx, "pcm16-recorder");
    workletNodeRef.current = node;

    node.port.onmessage = (ev) => {
      const buffer: ArrayBuffer = ev.data;
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({ type: "audio", data: arrayBufferToBase64(buffer) })
        );
      }
    };
    source.connect(node);
    setVoiceState("listening");
    console.log("[OpenAIRealtime] Mic started, streaming PCM16 to server");
  }, []);

  const stopMic = useCallback(() => {
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setVoiceState("idle");
  }, []);

  // ---- WebSocket lifecycle ----
  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) return;
    setConnectionState("connecting");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/voice-realtime`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[OpenAIRealtime] WS open, sending auth");
      setConnectionState("authenticating");
      ws.send(JSON.stringify({ type: "auth" }));
    };

    ws.onmessage = (ev) => {
      let msg: any;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case "connected":
          break;
        case "auth.ok":
          setConnectionState("authenticated");
          break;
        case "auth.failed":
          setError(msg.error || "auth failed");
          setConnectionState("disconnected");
          ws.close();
          break;
        case "ready":
          console.log("[OpenAIRealtime] Upstream ready, persona:", msg.persona);
          break;
        case "speech_started":
          setVoiceState("user_speaking");
          // Barge-in: stop current playback queue
          playbackTimeRef.current = playbackContextRef.current?.currentTime || 0;
          isPlayingRef.current = false;
          ws.send(JSON.stringify({ type: "interrupt" }));
          break;
        case "speech_stopped":
          setVoiceState("processing");
          break;
        case "user_transcript":
          setUserTranscript(msg.text);
          break;
        case "audio_delta":
          enqueuePCM16(msg.data);
          break;
        case "transcript_delta":
          setTranscript((t) => t + msg.text);
          break;
        case "response_text":
          setTranscript(msg.text);
          break;
        case "response_done":
          // Reset transcript for next turn after a short delay
          setTimeout(() => setTranscript(""), 2000);
          break;
        case "call_started":
        case "call_ended":
          break;
        case "error":
          console.error("[OpenAIRealtime] Server error:", msg.error);
          setError(msg.error);
          break;
        case "upstream_closed":
          setConnectionState("disconnected");
          break;
      }
    };

    ws.onclose = () => {
      console.log("[OpenAIRealtime] WS closed");
      setConnectionState("disconnected");
      stopMic();
    };

    ws.onerror = (err) => {
      console.error("[OpenAIRealtime] WS error:", err);
      setError("WS error");
    };
  }, [enqueuePCM16, stopMic]);

  const disconnect = useCallback(() => {
    stopMic();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnectionState("disconnected");
    setVoiceState("idle");
  }, [stopMic]);

  const startCall = useCallback(async () => {
    if (connectionState !== "authenticated") {
      connect();
      // Wait for auth then start
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN && connectionState === "authenticated") {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 5000);
      });
    }
    wsRef.current?.send(JSON.stringify({ type: "start_call" }));
    await startMic();
  }, [connect, connectionState, startMic]);

  const endCall = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "end_call" }));
    stopMic();
  }, [stopMic]);

  const sendText = useCallback((text: string) => {
    wsRef.current?.send(JSON.stringify({ type: "text", text }));
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) connect();
    return () => {
      disconnect();
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      if (playbackContextRef.current) {
        playbackContextRef.current.close();
        playbackContextRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    connectionState,
    voiceState,
    isListening: voiceState === "listening" || voiceState === "user_speaking",
    isSpeaking: voiceState === "speaking",
    isProcessing: voiceState === "processing",
    isAuthenticated: connectionState === "authenticated",
    transcript,
    userTranscript,
    error,
    connect,
    disconnect,
    startCall,
    endCall,
    sendText,
  };
}
