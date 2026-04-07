import { useState, useCallback, useRef, useEffect } from "react";

export type CallState = "idle" | "connecting" | "connected" | "in_call" | "error";

interface UseRealtimeVoiceCallOptions {
  onTranscript?: (text: string) => void;
  onResponse?: (text: string) => void;
  onError?: (error: string) => void;
  onStateChange?: (state: CallState) => void;
  userName?: string;
  conversationId?: number;
  earbudsMode?: boolean;
}

interface UseRealtimeVoiceCallResult {
  callState: CallState;
  isInCall: boolean;
  isSpeaking: boolean;
  isListening: boolean;
  transcript: string;
  lastResponse: string;
  startCall: () => Promise<void>;
  endCall: () => void;
  error: string | null;
}

export function useRealtimeVoiceCall(options: UseRealtimeVoiceCallOptions = {}): UseRealtimeVoiceCallResult {
  const [callState, setCallState] = useState<CallState>("idle");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [lastResponse, setLastResponse] = useState("");
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const optionsRef = useRef(options);
  const authResolveRef = useRef<(() => void) | null>(null);

  optionsRef.current = options;

  const updateState = useCallback((state: CallState) => {
    setCallState(state);
    optionsRef.current.onStateChange?.(state);
  }, []);

  const playAudioQueue = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) {
      if (audioQueueRef.current.length === 0) {
        setIsSpeaking(false);
        isSpeakingRef.current = false;
      }
      return;
    }

    isPlayingRef.current = true;
    setIsSpeaking(true);
    isSpeakingRef.current = true;

    const audioData = audioQueueRef.current.shift()!;

    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }

      const audioBuffer = await audioContextRef.current.decodeAudioData(audioData.slice(0));
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);

      source.onended = () => {
        isPlayingRef.current = false;
        playAudioQueue();
      };

      source.start();
    } catch (err) {
      console.error("[RealtimeVoiceCall] Audio playback error:", err);
      isPlayingRef.current = false;
      playAudioQueue();
    }
  }, []);

  const handleMessage = useCallback(async (event: MessageEvent) => {
    if (event.data instanceof Blob) {
      const arrayBuffer = await event.data.arrayBuffer();
      audioQueueRef.current.push(arrayBuffer);
      if (!isPlayingRef.current) {
        playAudioQueue();
      }
      return;
    }

    try {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case "connected":
          console.log("[RealtimeVoiceCall] Connected to voice server");
          break;

        case "authenticated":
          console.log("[RealtimeVoiceCall] Authenticated as", data.persona);
          updateState("connected");
          if (authResolveRef.current) {
            authResolveRef.current();
            authResolveRef.current = null;
          }
          break;

        case "call_started":
          console.log("[RealtimeVoiceCall] Call started - full duplex active");
          updateState("in_call");
          setIsListening(true);
          break;

        case "transcript":
          setTranscript(data.text);
          optionsRef.current.onTranscript?.(data.text);
          break;

        case "response":
          if (data.full) {
            setLastResponse(data.text);
            optionsRef.current.onResponse?.(data.text);
          }
          break;

        case "audio_chunk":
          if (data.audio) {
            try {
              const binaryString = atob(data.audio);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              audioQueueRef.current.push(bytes.buffer);
              if (!isPlayingRef.current) {
                playAudioQueue();
              }
            } catch (e) {
              console.error("[RealtimeVoiceCall] Failed to decode audio chunk:", e);
            }
          }
          break;

        case "done":
          setIsSpeaking(false);
          isSpeakingRef.current = false;
          setIsListening(true);
          break;

        case "listening":
          setIsListening(true);
          setIsSpeaking(false);
          isSpeakingRef.current = false;
          break;

        case "speaking":
        case "processing":
          setIsSpeaking(true);
          isSpeakingRef.current = true;
          setIsListening(false);
          break;

        case "error":
          setError(data.message);
          optionsRef.current.onError?.(data.message);
          break;

        case "call_ended":
          updateState("idle");
          setIsListening(false);
          setIsSpeaking(false);
          isSpeakingRef.current = false;
          break;
      }
    } catch (err) {
      console.error("[RealtimeVoiceCall] Message parse error:", err);
    }
  }, [updateState, playAudioQueue]);

  const connectWebSocket = useCallback((): Promise<void> => {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws/voice`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      const timeout = setTimeout(() => {
        authResolveRef.current = null;
        reject(new Error("Connection timeout"));
        ws.close();
      }, 10000);

      authResolveRef.current = () => {
        clearTimeout(timeout);
        resolve();
      };

      ws.onopen = () => {
        console.log("[RealtimeVoiceCall] WebSocket connected, sending auth...");
        updateState("connecting");

        ws.send(JSON.stringify({
          type: "auth",
          userName: optionsRef.current.userName || "User",
          channel: "talking-v2"
        }));
      };

      ws.onmessage = handleMessage;

      ws.onerror = (err) => {
        clearTimeout(timeout);
        authResolveRef.current = null;
        console.error("[RealtimeVoiceCall] WebSocket error:", err);
        reject(new Error("WebSocket connection failed"));
      };

      ws.onclose = () => {
        console.log("[RealtimeVoiceCall] WebSocket closed");
        authResolveRef.current = null;
        if (callState === "in_call") {
          updateState("idle");
        }
      };
    });
  }, [handleMessage, updateState, callState]);

  const startAudioCapture = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
        }
      });

      mediaStreamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      let audioBuffer: Float32Array[] = [];
      let lastSendTime = Date.now();
      const SEND_INTERVAL = 250;

      processor.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        if (isSpeakingRef.current && !optionsRef.current.earbudsMode) return;

        const inputData = e.inputBuffer.getChannelData(0);
        audioBuffer.push(new Float32Array(inputData));

        const now = Date.now();
        if (now - lastSendTime >= SEND_INTERVAL) {
          const totalLength = audioBuffer.reduce((acc, arr) => acc + arr.length, 0);
          const combined = new Float32Array(totalLength);
          let offset = 0;
          for (const arr of audioBuffer) {
            combined.set(arr, offset);
            offset += arr.length;
          }

          const pcm16 = new Int16Array(combined.length);
          for (let i = 0; i < combined.length; i++) {
            const s = Math.max(-1, Math.min(1, combined[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }

          wsRef.current.send(pcm16.buffer);
          audioBuffer = [];
          lastSendTime = now;
        }
      };

      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);

      console.log("[RealtimeVoiceCall] Audio capture started");
    } catch (err) {
      console.error("[RealtimeVoiceCall] Failed to start audio capture:", err);
      throw err;
    }
  }, []);

  const stopAudioCapture = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    console.log("[RealtimeVoiceCall] Audio capture stopped");
  }, []);

  const startCall = useCallback(async () => {
    try {
      setError(null);
      updateState("connecting");

      await connectWebSocket();
      console.log("[RealtimeVoiceCall] Auth confirmed, sending start_call...");

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: "start_call",
          conversationId: optionsRef.current.conversationId
        }));
        console.log("[RealtimeVoiceCall] start_call sent, starting audio capture...");
      }

      await startAudioCapture();

      updateState("in_call");
      setIsListening(true);

      console.log("[RealtimeVoiceCall] Call started successfully — full duplex active");
    } catch (err: any) {
      console.error("[RealtimeVoiceCall] Failed to start call:", err);
      setError(err.message);
      updateState("error");
      optionsRef.current.onError?.(err.message);
    }
  }, [connectWebSocket, startAudioCapture, updateState]);

  const endCall = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "end_call" }));
      wsRef.current.close();
    }
    wsRef.current = null;

    stopAudioCapture();
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    isSpeakingRef.current = false;

    updateState("idle");
    setIsListening(false);
    setIsSpeaking(false);
    setTranscript("");

    console.log("[RealtimeVoiceCall] Call ended");
  }, [stopAudioCapture, updateState]);

  useEffect(() => {
    return () => {
      endCall();
    };
  }, []);

  return {
    callState,
    isInCall: callState === "in_call",
    isSpeaking,
    isListening,
    transcript,
    lastResponse,
    startCall,
    endCall,
    error,
  };
}
