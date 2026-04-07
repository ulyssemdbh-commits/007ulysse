import { useState, useCallback, useRef, useEffect } from "react";

type ConnectionState = "disconnected" | "connecting" | "connected" | "authenticating" | "authenticated" | "error";
type VoiceState = "idle" | "listening" | "processing" | "speaking";

export interface VoiceUIAction {
  type: string;
  data: any;
  action?: string;
}

export interface VoiceSystemCommand {
  command: string;
  data?: any;
}

type VoiceChannel = "talking-v2" | "chat";

interface UseRealtimeVoiceOptions {
  onTranscript?: (text: string) => void;
  onResponse?: (text: string) => void;
  onResponseChunk?: (chunk: string) => void;
  onError?: (error: string) => void;
  onStateChange?: (state: VoiceState) => void;
  onAuthenticated?: (persona: string) => void;
  onSpeakerVerified?: (confidence: number) => void;
  onSpeakerRejected?: (message: string, confidence: number) => void;
  onVerificationSkipped?: (reason: string, error?: string) => void;
  onAudioElement?: (audio: HTMLAudioElement | null) => void;
  onUIAction?: (action: VoiceUIAction) => void;
  onSystemCommand?: (command: VoiceSystemCommand) => void;
  onTTSRedirected?: (message: string) => void;
  context?: Array<{ role: string; content: string }>;
  conversationId?: number;
  userName?: string;
  channel?: VoiceChannel; // For TTS priority: talking-v2 > chat
}

export function useRealtimeVoice(options: UseRealtimeVoiceOptions = {}) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [lastResponse, setLastResponse] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<Array<{ audio: string; mimeType: string }>>([]);
  const isPlayingRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const authResolveRef = useRef<(() => void) | null>(null);
  const connectionStateRef = useRef<ConnectionState>("disconnected");
  const optionsRef = useRef(options);

  // Web Speech API refs for streaming STT
  const speechRecognitionRef = useRef<SpeechRecognition | null>(null);
  const webSpeechFinalRef = useRef<string>("");
  const webSpeechAvailableRef = useRef<boolean>(
    typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
  );
  const interimThrottleRef = useRef<number | null>(null);
  
  // Silence detection refs for auto-stopListening
  const silenceDetectorRef = useRef<number | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const lastSpeechTimeRef = useRef<number>(0);
  const hasSpeechStartedRef = useRef(false);
  const speechStartTimeRef = useRef<number>(0);
  
  // === PRO SILENCE DETECTOR V2 - Professional Quality ===
  // Calibration du bruit de fond
  const noiseFloorRef = useRef<number>(0);
  const noiseCalibrationSamplesRef = useRef<number[]>([]);
  const isCalibrationCompleteRef = useRef(false);
  
  // Seuils adaptatifs
  const CALIBRATION_SAMPLES = 30; // ~500ms de calibration
  const NOISE_FLOOR_MULTIPLIER = 2.5; // Seuil = bruit de fond × multiplier
  const MIN_SPEECH_THRESHOLD = 0.015; // Seuil minimum absolu
  const MAX_SPEECH_THRESHOLD = 0.08; // Seuil maximum
  
  // Durées configurables
  const SILENCE_DURATION = 700; // ms de silence avant auto-stop (réduit de 1500ms)
  const MIN_SPEECH_DURATION = 300; // Durée minimum de parole (ms)
  const DEBOUNCE_TIME = 100; // Anti-rebond pour transitions
  
  // Hystérésis pour éviter les faux positifs
  const speechConfidenceRef = useRef<number>(0);
  const SPEECH_CONFIRM_FRAMES = 5; // Frames consécutives pour confirmer parole
  const SILENCE_CONFIRM_FRAMES = 8; // Frames consécutives pour confirmer silence
  const silenceConfidenceRef = useRef<number>(0);
  
  // Statistiques de debug
  const statsRef = useRef({ 
    peakLevel: 0, 
    avgLevel: 0, 
    speechDuration: 0,
    calibratedThreshold: 0.02
  });

  // Flag to block restart until server completes processing
  const processingBlockRef = useRef(false);

  optionsRef.current = options;
  connectionStateRef.current = connectionState;

  const updateVoiceState = useCallback((state: VoiceState) => {
    setVoiceState(state);
    setIsListening(state === "listening");
    setIsSpeaking(state === "speaking");
    optionsRef.current.onStateChange?.(state);
  }, []);

  // Mute/unmute mic to prevent echo feedback
  const muteMic = useCallback((mute: boolean) => {
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !mute;
      });
    }
  }, []);

  const playNextAudio = useCallback(async () => {
    console.log("[RealtimeVoice] playNextAudio called, isPlaying:", isPlayingRef.current, "queueSize:", audioQueueRef.current.length);
    
    if (isPlayingRef.current || audioQueueRef.current.length === 0) {
      if (audioQueueRef.current.length === 0 && !isPlayingRef.current) {
        muteMic(false); // Unmute mic when done playing
        updateVoiceState("idle");
      }
      return;
    }

    isPlayingRef.current = true;
    muteMic(true); // Mute mic during TTS playback to prevent echo
    updateVoiceState("speaking");

    const { audio: base64Audio, mimeType: audioMimeType } = audioQueueRef.current.shift()!;
    console.log("[RealtimeVoice] Playing audio chunk, base64 length:", base64Audio.length, "mime:", audioMimeType);
    
    try {
      const audioData = atob(base64Audio);
      const audioArray = new Uint8Array(audioData.length);
      for (let i = 0; i < audioData.length; i++) {
        audioArray[i] = audioData.charCodeAt(i);
      }
      
      const blob = new Blob([audioArray], { type: audioMimeType });
      const url = URL.createObjectURL(blob);
      
      const audio = new Audio(url);
      currentAudioRef.current = audio;
      console.log("[RealtimeVoice] Created audio element, calling onAudioElement");
      optionsRef.current.onAudioElement?.(audio);
      
      audio.onended = () => {
        console.log("[RealtimeVoice] Audio ended");
        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
        optionsRef.current.onAudioElement?.(null);
        isPlayingRef.current = false;
        playNextAudio();
      };
      
      audio.onerror = (e) => {
        console.error("[RealtimeVoice] Audio playback error:", e);
        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
        optionsRef.current.onAudioElement?.(null);
        isPlayingRef.current = false;
        playNextAudio();
      };
      
      console.log("[RealtimeVoice] Calling audio.play()...");
      await audio.play();
      console.log("[RealtimeVoice] audio.play() succeeded");
    } catch (err) {
      console.error("[RealtimeVoice] Failed to play audio:", err);
      isPlayingRef.current = false;
      muteMic(false);
      playNextAudio();
    }
  }, [updateVoiceState, muteMic]);

  const sendAuth = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "auth",
        userName: optionsRef.current.userName || "User",
        channel: optionsRef.current.channel || "chat" // TTS priority: talking-v2 > chat
      }));
      setConnectionState("authenticating");
    }
  }, []);

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case "connected":
          setConnectionState("connected");
          setError(null);
          if (data.sessionId) {
            setSessionId(data.sessionId);
            console.log(`[RealtimeVoice] Session ID: ${data.sessionId}`);
          }
          setTimeout(() => sendAuth(), 100);
          break;

        case "authenticated":
          setConnectionState("authenticated");
          connectionStateRef.current = "authenticated";
          console.log(`[RealtimeVoice] Authenticated as ${data.persona}`);
          if (data.sessionId) setSessionId(data.sessionId);
          optionsRef.current.onAuthenticated?.(data.persona);
          // Resolve any pending auth wait
          if (authResolveRef.current) {
            authResolveRef.current();
            authResolveRef.current = null;
          }
          break;

        case "auth.failed":
          setConnectionState("error");
          connectionStateRef.current = "error";
          setError("Authentication failed");
          optionsRef.current.onError?.("Authentication failed");
          // Reject auth wait
          if (authResolveRef.current) {
            authResolveRef.current();
            authResolveRef.current = null;
          }
          break;

        case "listening_started":
        case "listening":
          updateVoiceState("listening");
          break;

        case "speaking":
          updateVoiceState("speaking");
          break;

        case "transcript":
          setTranscript(data.text);
          optionsRef.current.onTranscript?.(data.text);
          break;

        case "processing":
          updateVoiceState("processing");
          break;

        case "response_chunk":
          optionsRef.current.onResponseChunk?.(data.text);
          break;

        case "response_complete":
          setLastResponse(data.text);
          optionsRef.current.onResponse?.(data.text);
          break;

        case "barge_in":
          console.log("[RealtimeVoice] Barge-in acknowledged by server, stopping playback");
          audioQueueRef.current = [];
          isPlayingRef.current = false;
          if (audioContextRef.current) {
            try {
              audioContextRef.current.close().catch(() => {});
              audioContextRef.current = null;
            } catch (e) {}
          }
          break;

        case "audio_chunk":
          console.log("[RealtimeVoice] Received audio_chunk, queue size before:", audioQueueRef.current.length);
          audioQueueRef.current.push({ audio: data.audio, mimeType: data.mimeType || "audio/mpeg" });
          if (!isPlayingRef.current) {
            console.log("[RealtimeVoice] Starting playback...");
            playNextAudio();
          }
          break;

        case "done":
          // Clear processing block - server finished
          processingBlockRef.current = false;
          console.log("[RealtimeVoice] Processing block cleared (done)");
          if (audioQueueRef.current.length === 0 && !isPlayingRef.current) {
            updateVoiceState("idle");
          }
          break;

        case "cancelled":
          processingBlockRef.current = false;
          console.log("[RealtimeVoice] Processing block cleared (cancelled)");
          updateVoiceState("idle");
          break;

        case "verifying_speaker":
          console.log("[RealtimeVoice] Verifying speaker...");
          updateVoiceState("processing");
          break;

        case "speaker_verified":
          console.log(`[RealtimeVoice] Speaker verified: confidence=${data.confidence?.toFixed(2)}`);
          optionsRef.current.onSpeakerVerified?.(data.confidence);
          break;

        case "speaker_rejected":
          console.log(`[RealtimeVoice] Speaker rejected: confidence=${data.confidence?.toFixed(2)}`);
          processingBlockRef.current = false;
          console.log("[RealtimeVoice] Processing block cleared (speaker_rejected)");
          setError(data.message);
          optionsRef.current.onSpeakerRejected?.(data.message, data.confidence);
          updateVoiceState("idle");
          break;

        case "verification_skipped":
          console.warn(`[RealtimeVoice] Verification skipped: ${data.reason} - ${data.error || ''}`);
          optionsRef.current.onVerificationSkipped?.(data.reason, data.error);
          // Don't clear block here - processing continues after verification skip
          break;

        case "error":
          processingBlockRef.current = false;
          console.log("[RealtimeVoice] Processing block cleared (error)");
          setError(data.message);
          optionsRef.current.onError?.(data.message);
          updateVoiceState("idle");
          // Handle auth-related errors by re-triggering auth
          if (data.message === "Authentication required") {
            console.log("[RealtimeVoice] Re-sending auth after error");
            sendAuth();
          }
          break;

        case "tts_error":
          console.error("TTS error:", data.message);
          break;

        case "tts_redirected":
          // TTS is playing on talking-v2 instead of this chat session
          // No audio_chunk will follow — stop waiting for audio
          console.log("[RealtimeVoice] TTS redirected:", data.message);
          optionsRef.current.onTTSRedirected?.(data.message);
          break;

        case "audio_end":
          // Server finished sending all audio chunks for this turn
          // If audio queue is empty and nothing playing, go idle
          if (audioQueueRef.current.length === 0 && !isPlayingRef.current) {
            updateVoiceState("idle");
          }
          break;

        case "voice_reset":
          // Server reset the session state (barge-in, error recovery, etc.)
          console.log("[RealtimeVoice] Voice session reset by server");
          audioQueueRef.current = [];
          isPlayingRef.current = false;
          processingBlockRef.current = false;
          updateVoiceState("idle");
          break;

        case "busy":
          // Server is already processing a request
          console.warn("[RealtimeVoice] Server busy:", data.message);
          break;

        case "response_truncated":
          // Server truncated a too-long response
          console.warn("[RealtimeVoice] Response truncated by server");
          break;

        case "echo_detected":
          processingBlockRef.current = false;
          console.log("[RealtimeVoice] Processing block cleared (echo_detected)");
          updateVoiceState("idle");
          break;

        case "ui_action":
          console.log("[RealtimeVoice] UI Action received:", data.action, data.data);
          optionsRef.current.onUIAction?.({
            type: data.action || "unknown",
            data: data.data,
            action: data.action,
          });
          break;

        case "system_command":
          console.log("[RealtimeVoice] System command received:", data.command, data.data);
          optionsRef.current.onSystemCommand?.({
            command: data.command,
            data: data.data,
          });
          break;

        case "response":
          // Full response with domain info
          if (data.full) {
            setLastResponse(data.text);
            optionsRef.current.onResponse?.(data.text);
          }
          break;
      }
    } catch (err) {
      console.error("Failed to parse WebSocket message:", err);
    }
  }, [updateVoiceState, playNextAudio]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    
    setConnectionState("connecting");
    
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/voice`);
    
    ws.onopen = () => {
      console.log("Voice WebSocket connected");
      wsRef.current = ws;
      reconnectAttemptsRef.current = 0; // Reset backoff on success
    };
    
    ws.onmessage = handleMessage;
    
    ws.onclose = () => {
      console.log("Voice WebSocket closed");
      setConnectionState("disconnected");
      connectionStateRef.current = "disconnected";
      wsRef.current = null;
      
      // Clear any pending auth wait
      if (authResolveRef.current) {
        authResolveRef.current();
        authResolveRef.current = null;
      }
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
      const attempts = reconnectAttemptsRef.current;
      const delay = Math.min(1000 * Math.pow(2, attempts), 30000);
      reconnectAttemptsRef.current = attempts + 1;
      console.log(`[RealtimeVoice] Reconnecting in ${delay}ms (attempt ${attempts + 1})`);
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect();
      }, delay);
    };
    
    ws.onerror = (err) => {
      console.error("Voice WebSocket error:", err);
      setConnectionState("error");
      setError("Connexion perdue");
    };
    
    wsRef.current = ws;
  }, [handleMessage]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    // Clear auth waiting state
    if (authResolveRef.current) {
      authResolveRef.current();
      authResolveRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    setConnectionState("disconnected");
    connectionStateRef.current = "disconnected";
  }, []);

  const requestMicrophoneAccess = useCallback(async () => {
    try {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      
      const constraints: MediaStreamConstraints = {
        audio: isIOS ? true : {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      
      console.log("Microphone access granted, tracks:", stream.getAudioTracks().map(t => ({
        label: t.label,
        enabled: t.enabled,
        muted: t.muted,
        settings: t.getSettings()
      })));
      
      return true;
    } catch (err) {
      console.error("Microphone access denied:", err);
      setError("Accès au microphone refusé");
      return false;
    }
  }, []);

  const waitForAuth = useCallback(async (timeoutMs: number = 5000): Promise<boolean> => {
    // Already authenticated
    if (connectionStateRef.current === "authenticated") return true;
    
    // Wait for auth to complete
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        authResolveRef.current = null;
        resolve(false);
      }, timeoutMs);
      
      authResolveRef.current = () => {
        clearTimeout(timeout);
        resolve(connectionStateRef.current === "authenticated");
      };
    });
  }, []);

  // === PRO SILENCE DETECTOR V2 - Professional Quality ===
  // Calibration automatique, seuils adaptatifs, hystérésis anti-faux positifs
  const startSilenceDetection = useCallback(() => {
    if (!streamRef.current) {
      console.warn("[SilenceDetector PRO] No audio stream available");
      return;
    }
    
    // Create audio context if needed
    if (!audioContextRef.current) {
      try {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      } catch (e) {
        console.error("[SilenceDetector PRO] Failed to create AudioContext:", e);
        return;
      }
    }
    
    // Resume audio context if suspended
    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume();
    }
    
    const audioContext = audioContextRef.current;
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512; // Higher resolution for better accuracy
    analyser.smoothingTimeConstant = 0.3; // Smooth transitions
    analyserNodeRef.current = analyser;
    
    try {
      const source = audioContext.createMediaStreamSource(streamRef.current);
      source.connect(analyser);
    } catch (e) {
      console.error("[SilenceDetector PRO] Failed to connect audio source:", e);
      return;
    }
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const now = Date.now();
    
    // Reset all state
    lastSpeechTimeRef.current = now;
    hasSpeechStartedRef.current = false;
    speechStartTimeRef.current = 0;
    speechConfidenceRef.current = 0;
    silenceConfidenceRef.current = 0;
    noiseCalibrationSamplesRef.current = [];
    isCalibrationCompleteRef.current = false;
    noiseFloorRef.current = 0;
    statsRef.current = { peakLevel: 0, avgLevel: 0, speechDuration: 0, calibratedThreshold: MIN_SPEECH_THRESHOLD };
    
    console.log("[SilenceDetector PRO] Started - Phase 1: Calibrating noise floor...");
    
    const checkSilence = () => {
      if (!analyserNodeRef.current) return;
      
      try {
        analyser.getByteFrequencyData(dataArray);
      } catch (e) {
        console.error("[SilenceDetector PRO] Error getting audio data:", e);
        silenceDetectorRef.current = window.requestAnimationFrame(checkSilence);
        return;
      }
      
      // Calculate RMS (Root Mean Square) for more accurate level measurement
      let sumSquares = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const normalized = dataArray[i] / 255;
        sumSquares += normalized * normalized;
      }
      const rmsLevel = Math.sqrt(sumSquares / dataArray.length);
      
      // Also calculate peak for statistics
      const peakValue = Math.max(...dataArray) / 255;
      
      const currentTime = Date.now();
      
      // === PHASE 1: Calibration du bruit de fond ===
      if (!isCalibrationCompleteRef.current) {
        noiseCalibrationSamplesRef.current.push(rmsLevel);
        
        if (noiseCalibrationSamplesRef.current.length >= CALIBRATION_SAMPLES) {
          // Calculate noise floor as average + standard deviation
          const samples = noiseCalibrationSamplesRef.current;
          const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
          const variance = samples.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / samples.length;
          const stdDev = Math.sqrt(variance);
          
          noiseFloorRef.current = avg + stdDev;
          
          // Calculate adaptive threshold
          let adaptiveThreshold = noiseFloorRef.current * NOISE_FLOOR_MULTIPLIER;
          adaptiveThreshold = Math.max(MIN_SPEECH_THRESHOLD, Math.min(MAX_SPEECH_THRESHOLD, adaptiveThreshold));
          
          statsRef.current.calibratedThreshold = adaptiveThreshold;
          isCalibrationCompleteRef.current = true;
          
          console.log(`[SilenceDetector PRO] Calibration complete:`, {
            noiseFloor: noiseFloorRef.current.toFixed(4),
            stdDev: stdDev.toFixed(4),
            threshold: adaptiveThreshold.toFixed(4)
          });
        }
        
        silenceDetectorRef.current = window.requestAnimationFrame(checkSilence);
        return;
      }
      
      // === PHASE 2: Détection de parole avec hystérésis ===
      const threshold = statsRef.current.calibratedThreshold;
      const isAboveThreshold = rmsLevel > threshold;
      
      // Update statistics
      statsRef.current.peakLevel = Math.max(statsRef.current.peakLevel, peakValue);
      statsRef.current.avgLevel = (statsRef.current.avgLevel * 0.95) + (rmsLevel * 0.05);
      
      if (isAboveThreshold) {
        // Potential speech detected
        speechConfidenceRef.current++;
        silenceConfidenceRef.current = 0;
        
        // Hystérésis: Confirmer la parole après N frames consécutives
        if (speechConfidenceRef.current >= SPEECH_CONFIRM_FRAMES) {
          if (!hasSpeechStartedRef.current) {
            hasSpeechStartedRef.current = true;
            speechStartTimeRef.current = currentTime;
            console.log(`[SilenceDetector PRO] ✓ Speech CONFIRMED (level: ${rmsLevel.toFixed(3)}, threshold: ${threshold.toFixed(3)})`);
          }
          lastSpeechTimeRef.current = currentTime;
        }
      } else {
        // Potential silence detected
        silenceConfidenceRef.current++;
        speechConfidenceRef.current = Math.max(0, speechConfidenceRef.current - 1); // Decay slowly
        
        // Only process silence if speech was confirmed
        if (hasSpeechStartedRef.current && silenceConfidenceRef.current >= SILENCE_CONFIRM_FRAMES) {
          const silenceDuration = currentTime - lastSpeechTimeRef.current;
          const speechDuration = lastSpeechTimeRef.current - speechStartTimeRef.current;
          
          // Validate speech duration before triggering
          if (silenceDuration >= SILENCE_DURATION && speechDuration >= MIN_SPEECH_DURATION) {
            statsRef.current.speechDuration = speechDuration;
            
            console.log(`[SilenceDetector PRO] ✓ End of speech detected:`, {
              silenceDuration: `${silenceDuration}ms`,
              speechDuration: `${speechDuration}ms`,
              peakLevel: statsRef.current.peakLevel.toFixed(3),
              avgLevel: statsRef.current.avgLevel.toFixed(3)
            });
            
            // Stop detection and trigger processing
            stopSilenceDetection();
            
            // Block restart until server responds (with 30s fail-safe timeout)
            processingBlockRef.current = true;
            console.log("[SilenceDetector PRO] Processing block enabled");
            
            // Fail-safe: clear block after 30s if server doesn't respond
            setTimeout(() => {
              if (processingBlockRef.current) {
                console.warn("[SilenceDetector PRO] Processing block timeout - clearing after 30s");
                processingBlockRef.current = false;
              }
            }, 30000);
            
            if (mediaRecorderRef.current?.state === "recording") {
              // Stop Web Speech API if active
              if (speechRecognitionRef.current) {
                try { speechRecognitionRef.current.stop(); } catch {}
                speechRecognitionRef.current = null;
              }
              if (interimThrottleRef.current) {
                clearTimeout(interimThrottleRef.current);
                interimThrottleRef.current = null;
              }
              
              const recorder = mediaRecorderRef.current;
              const capturedFinal = webSpeechFinalRef.current;
              
              recorder.onstop = () => {
                console.log("[SilenceDetector PRO] MediaRecorder stopped, sending to server");
                setTimeout(() => {
                  if (capturedFinal) {
                    // ✅ Web Speech API path: skip Whisper entirely (-700ms)
                    console.log(`[SilenceDetector PRO] Using Web Speech transcript: "${capturedFinal.substring(0, 50)}"`);
                    wsRef.current?.send(JSON.stringify({
                      type: "final_transcript",
                      text: capturedFinal,
                      context: optionsRef.current.context || []
                    }));
                  } else {
                    // 🔄 Whisper fallback (Safari/Firefox or Web Speech API failed)
                    console.log("[SilenceDetector PRO] No Web Speech transcript, falling back to Whisper");
                    wsRef.current?.send(JSON.stringify({
                      type: "stop_listening",
                      context: optionsRef.current.context || []
                    }));
                  }
                  webSpeechFinalRef.current = "";
                }, 100);
              };
              recorder.stop();
              mediaRecorderRef.current = null;
              updateVoiceState("processing");
            }
            return; // Exit loop
          }
        }
      }
      
      silenceDetectorRef.current = window.requestAnimationFrame(checkSilence);
    };
    
    silenceDetectorRef.current = window.requestAnimationFrame(checkSilence);
  }, [updateVoiceState]);
  
  const stopSilenceDetection = useCallback(() => {
    if (silenceDetectorRef.current) {
      window.cancelAnimationFrame(silenceDetectorRef.current);
      silenceDetectorRef.current = null;
    }
    
    // Log final statistics if speech occurred
    if (hasSpeechStartedRef.current && statsRef.current.speechDuration > 0) {
      console.log("[SilenceDetector PRO] Session stats:", {
        speechDuration: `${statsRef.current.speechDuration}ms`,
        peakLevel: statsRef.current.peakLevel.toFixed(3),
        avgLevel: statsRef.current.avgLevel.toFixed(3),
        calibratedThreshold: statsRef.current.calibratedThreshold.toFixed(4)
      });
    }
    
    analyserNodeRef.current = null;
    hasSpeechStartedRef.current = false;
    speechStartTimeRef.current = 0;
    isCalibrationCompleteRef.current = false;
    console.log("[SilenceDetector PRO] Stopped");
  }, []);

  const startListening = useCallback(async () => {
    // Ensure connected
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      connect();
      // Wait for WebSocket to open
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Wait for authentication - gate on actual auth success, not timeout
    if (connectionStateRef.current !== "authenticated") {
      const authSuccess = await waitForAuth(5000);
      if (!authSuccess) {
        console.error("[RealtimeVoice] Authentication timeout");
        setError("Authentication timeout");
        optionsRef.current.onError?.("Authentication timeout");
        return;
      }
    }
    
    if (!streamRef.current) {
      const hasAccess = await requestMicrophoneAccess();
      if (!hasAccess) return;
    }
    
    if (!streamRef.current) return;
    
    wsRef.current?.send(JSON.stringify({
      type: "start_listening",
      conversationId: optionsRef.current.conversationId
    }));
    
    try {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      
      const supportedTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
        ""
      ];
      
      let mimeType = "";
      for (const type of supportedTypes) {
        if (!type || MediaRecorder.isTypeSupported(type)) {
          mimeType = type;
          break;
        }
      }
      
      console.log("MediaRecorder mimeType:", mimeType || "(default)");
      
      const recorderOptions: MediaRecorderOptions = mimeType ? { mimeType } : {};
      const mediaRecorder = new MediaRecorder(streamRef.current, recorderOptions);
      mediaRecorderRef.current = mediaRecorder;
      
      const chunks: Blob[] = [];
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
          
          event.data.arrayBuffer().then(buffer => {
            // Only send audio if WebSocket is open AND we're authenticated
            const isOpen = wsRef.current?.readyState === WebSocket.OPEN;
            const isAuth = connectionStateRef.current === "authenticated";
            console.log(`[AudioChunk] ${buffer.byteLength} bytes, wsOpen: ${isOpen}, auth: ${isAuth}`);
            if (isOpen && isAuth) {
              wsRef.current!.send(buffer);
              console.log(`[AudioChunk] Sent ${buffer.byteLength} bytes to server`);
            }
          });
        }
      };
      
      mediaRecorder.onstop = () => {
        console.log("MediaRecorder stopped, chunks:", chunks.length);
      };
      
      mediaRecorder.onerror = (e) => {
        console.error("MediaRecorder error:", e);
      };
      
      if (isIOS) {
        mediaRecorder.start();
        const requestDataInterval = setInterval(() => {
          if (mediaRecorder.state === "recording") {
            try {
              mediaRecorder.requestData();
            } catch (e) {
              console.log("requestData error:", e);
            }
          } else {
            clearInterval(requestDataInterval);
          }
        }, 500);
      } else {
        mediaRecorder.start(250);
      }
      
      updateVoiceState("listening");
      console.log("Started listening, MediaRecorder state:", mediaRecorder.state);
      
      // ── Web Speech API streaming STT ──────────────────────────────────────
      // Chrome/Edge/Safari: gives real-time transcript → bypasses Whisper (-700ms)
      // Firefox/unsupported: falls back to Whisper automatically
      webSpeechFinalRef.current = "";
      if (webSpeechAvailableRef.current && !isIOS) {
        try {
          const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
          const recognition: SpeechRecognition = new SpeechRecognitionCtor();
          recognition.lang = "fr-FR";
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.maxAlternatives = 1;
          
          let latestInterim = "";
          
          recognition.onresult = (event: SpeechRecognitionEvent) => {
            let interimText = "";
            let finalText = "";
            
            for (let i = event.resultIndex; i < event.results.length; i++) {
              const result = event.results[i];
              if (result.isFinal) {
                finalText += result[0].transcript;
              } else {
                interimText += result[0].transcript;
              }
            }
            
            if (finalText) {
              // Accumulate finals (multiple final results can arrive)
              webSpeechFinalRef.current = (webSpeechFinalRef.current + " " + finalText).trim();
              latestInterim = "";
              console.log(`[WebSpeech] Final: "${webSpeechFinalRef.current.substring(0, 60)}"`);
            } else if (interimText && interimText !== latestInterim) {
              latestInterim = interimText;
              // Throttle interim sends to max 1 per 200ms to avoid flooding WS
              if (!interimThrottleRef.current) {
                interimThrottleRef.current = window.setTimeout(() => {
                  interimThrottleRef.current = null;
                  const combined = (webSpeechFinalRef.current + " " + latestInterim).trim();
                  if (combined && wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({ type: "interim_transcript", text: combined }));
                  }
                }, 200);
              }
            }
          };
          
          recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
            if (event.error !== "no-speech" && event.error !== "aborted") {
              console.warn(`[WebSpeech] Error: ${event.error} — Whisper fallback active`);
            }
          };
          
          recognition.onend = () => {
            console.log("[WebSpeech] Recognition ended");
            speechRecognitionRef.current = null;
          };
          
          recognition.start();
          speechRecognitionRef.current = recognition;
          console.log("[WebSpeech] Started — streaming STT active, Whisper bypassed");
        } catch (e) {
          console.warn("[WebSpeech] Failed to start, using Whisper fallback:", e);
          speechRecognitionRef.current = null;
        }
      } else {
        console.log("[WebSpeech] Not available on this browser/device — Whisper active");
      }
      
      // Start automatic silence detection for end-of-speech
      startSilenceDetection();
      
    } catch (err) {
      console.error("Failed to start MediaRecorder:", err);
      setError("Erreur d'enregistrement audio");
    }
  }, [connect, waitForAuth, requestMicrophoneAccess, updateVoiceState, startSilenceDetection]);

  const stopListening = useCallback(() => {
    // Stop silence detection first
    stopSilenceDetection();
    
    // Stop Web Speech API and grab any final transcript
    if (speechRecognitionRef.current) {
      try { speechRecognitionRef.current.stop(); } catch {}
      speechRecognitionRef.current = null;
    }
    if (interimThrottleRef.current) {
      clearTimeout(interimThrottleRef.current);
      interimThrottleRef.current = null;
    }
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      const recorder = mediaRecorderRef.current;
      const capturedFinal = webSpeechFinalRef.current;
      
      recorder.onstop = () => {
        console.log("MediaRecorder fully stopped, sending to server");
        setTimeout(() => {
          if (capturedFinal) {
            // ✅ Web Speech API path: skip Whisper
            wsRef.current?.send(JSON.stringify({
              type: "final_transcript",
              text: capturedFinal,
              context: optionsRef.current.context || []
            }));
          } else {
            // 🔄 Whisper fallback
            wsRef.current?.send(JSON.stringify({
              type: "stop_listening",
              context: optionsRef.current.context || []
            }));
          }
          webSpeechFinalRef.current = "";
        }, 100);
      };
      
      recorder.stop();
      mediaRecorderRef.current = null;
    } else {
      // No recording in progress, send directly
      const capturedFinal = webSpeechFinalRef.current;
      webSpeechFinalRef.current = "";
      if (capturedFinal) {
        wsRef.current?.send(JSON.stringify({
          type: "final_transcript",
          text: capturedFinal,
          context: optionsRef.current.context || []
        }));
      } else {
        wsRef.current?.send(JSON.stringify({
          type: "stop_listening",
          context: optionsRef.current.context || []
        }));
      }
    }
    
    updateVoiceState("processing");
  }, [updateVoiceState, stopSilenceDetection]);

  const cancel = useCallback(() => {
    // Stop silence detection
    stopSilenceDetection();
    
    // Stop Web Speech API
    if (speechRecognitionRef.current) {
      try { speechRecognitionRef.current.stop(); } catch {}
      speechRecognitionRef.current = null;
    }
    if (interimThrottleRef.current) {
      clearTimeout(interimThrottleRef.current);
      interimThrottleRef.current = null;
    }
    webSpeechFinalRef.current = "";
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    
    wsRef.current?.send(JSON.stringify({ type: "cancel" }));
    
    updateVoiceState("idle");
  }, [updateVoiceState, stopSilenceDetection]);

  const sendTextMessage = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      connect();
      setTimeout(() => sendTextMessage(text), 1000);
      return;
    }
    
    wsRef.current.send(JSON.stringify({
      type: "text_input",
      text,
      context: optionsRef.current.context || []
    }));
    
    updateVoiceState("processing");
  }, [connect, updateVoiceState]);

  const unlockAudio = useCallback(async () => {
    try {
      if (!audioContextRef.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          audioContextRef.current = new AudioContextClass();
        }
      }
      
      if (audioContextRef.current?.state === "suspended") {
        await audioContextRef.current.resume();
      }
      
      const silentAudio = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA");
      await silentAudio.play().catch(() => {});
      
      console.log("Audio unlocked");
    } catch (err) {
      console.error("Failed to unlock audio:", err);
    }
  }, []);

  useEffect(() => {
    connect();
    
    return () => {
      disconnect();
      
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, [connect, disconnect]);

  // Function to check if restart is blocked (for external use)
  const isProcessingBlocked = useCallback(() => {
    return processingBlockRef.current;
  }, []);

  return {
    connectionState,
    voiceState,
    isListening,
    isSpeaking,
    isProcessing: voiceState === "processing",
    isAuthenticated: connectionState === "authenticated",
    transcript,
    lastResponse,
    error,
    
    startListening,
    stopListening,
    cancel,
    sendTextMessage,
    unlockAudio,
    connect,
    disconnect,
    requestMicrophoneAccess,
    sendAuth,
    isProcessingBlocked,
    sessionId,
  };
}
