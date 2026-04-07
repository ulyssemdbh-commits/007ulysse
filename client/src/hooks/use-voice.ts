import { useState, useCallback, useRef, useEffect } from "react";

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

export type PermissionState = "prompt" | "granted" | "denied" | "unavailable";

interface AudioQueueItem {
  audio: HTMLAudioElement;
  text: string;
}

type VoiceState = "idle" | "listening" | "processing" | "speaking";

export interface VoiceDebugInfo {
  state: VoiceState;
  wakeWordActive: boolean;
  endTriggerFired: boolean;
  echoFilterApplied: boolean;
  lastEvent: string;
  lastEventTime: number;
  iOSSilenceTimeout: boolean;
  restartAttempts: number;
  isRecording: boolean;
  keepListening: boolean;
}

export function useVoice() {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [sttSupported, setSttSupported] = useState(true);
  const [ttsSupported, setTtsSupported] = useState(true);
  const [voicesLoaded, setVoicesLoaded] = useState(true);
  const [lastSpokenText, setLastSpokenText] = useState("");
  const [micPermission, setMicPermission] = useState<PermissionState>("prompt");
  const [permissionsReady, setPermissionsReady] = useState(false);
  const [ttsUnlocked, setTtsUnlocked] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [wakeWordActive, setWakeWordActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [useOpenAITTS, setUseOpenAITTS] = useState(true);
  const [useBrowserFallback, setUseBrowserFallback] = useState(false);
  
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const voiceStateRef = useRef<VoiceState>("idle");
  const operationLockRef = useRef<Promise<void> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const restartAttemptsRef = useRef<number>(0);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const ttsSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  
  const updateVoiceState = (newState: VoiceState) => {
    voiceStateRef.current = newState;
    setVoiceState(newState);
  };

  const isSpeakingRef = useRef<boolean>(false);
  const ttsStartTimeRef = useRef<number>(0);
  const ttsEndTimeRef = useRef<number>(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioQueueRef = useRef<AudioQueueItem[]>([]);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingRef = useRef(false);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const ttsAnalyserRef = useRef<AnalyserNode | null>(null);
  const energyHistoryRef = useRef<number[]>([]);
  const ttsEnergyThresholdRef = useRef<number>(0);
  
  const silenceTimeoutRef = useRef<number | null>(null);
  const restartTimeoutRef = useRef<number | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const isRecordingRef = useRef(false);
  
  // VAD (Voice Activity Detection) refs for proper cleanup
  const vadAnalyserRef = useRef<AnalyserNode | null>(null);
  const vadSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processingRef = useRef(false);
  const keepListeningRef = useRef(true);
  const browserRecognitionRef = useRef<SpeechRecognition | null>(null);
  const recognitionSessionIdRef = useRef<number>(0);
  const audioOutputDeviceIdRef = useRef<string>("");
  const audioInputDeviceIdRef = useRef<string>("");
  
  const lastDebugEventRef = useRef<string>("initialized");
  const lastDebugEventTimeRef = useRef<number>(Date.now());
  const echoFilterAppliedRef = useRef<boolean>(false);
  const iOSSilenceTimeoutTriggeredRef = useRef<boolean>(false);
  
  // iOS State Machine for reliable session management
  type IOSSessionState = "idle" | "listening" | "restarting" | "disabled";
  const iOSStateRef = useRef<IOSSessionState>("idle");
  
  const setIOSState = useCallback((newState: IOSSessionState, reason: string) => {
    if (iOSStateRef.current === newState) return;
    iOSStateRef.current = newState;
    console.log(`[iOS VOICE] state=${newState} reason=${reason}`);
    lastDebugEventRef.current = `iOS:${newState} (${reason})`;
    lastDebugEventTimeRef.current = Date.now();
  }, []);
  
  const logDebugEvent = useCallback((event: string) => {
    lastDebugEventRef.current = event;
    lastDebugEventTimeRef.current = Date.now();
    console.log(`[VOICE DEBUG] ${event}`);
  }, []);

  const initAudioContext = useCallback(async () => {
    if (audioContextRef.current) return audioContextRef.current;
    
    try {
      const AudioContextClass = window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return null;
      
      const ctx = new AudioContextClass();
      audioContextRef.current = ctx;
      
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      analyserRef.current = analyser;
      
      const ttsAnalyser = ctx.createAnalyser();
      ttsAnalyser.fftSize = 256;
      ttsAnalyser.smoothingTimeConstant = 0.3;
      ttsAnalyserRef.current = ttsAnalyser;
      
      return ctx;
    } catch (err) {
      console.error("Failed to create AudioContext:", err);
      return null;
    }
  }, []);

  const getAudioEnergy = useCallback((analyser: AnalyserNode): number => {
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);
    
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    return sum / dataArray.length;
  }, []);

  const isEchoFeedback = useCallback((transcriptEnergy: number): boolean => {
    // Allow user to interrupt (barge-in) if they're speaking loudly enough
    const BARGE_IN_ENERGY_THRESHOLD = 25; // User speaking clearly overrides echo detection
    
    if (!isSpeakingRef.current) return false;
    
    const timeSinceTTSEnd = Date.now() - ttsEndTimeRef.current;
    
    // Short cooldown after TTS ends (300ms instead of 500ms for faster response)
    if (timeSinceTTSEnd < 300) {
      // But allow barge-in if user speaks loudly
      if (transcriptEnergy > BARGE_IN_ENERGY_THRESHOLD) {
        console.log("Barge-in detected: high energy overrides cooldown");
        return false;
      }
      return true;
    }
    
    // Energy-based filtering: only filter if user energy is very low (likely echo)
    if (isSpeakingRef.current && ttsEnergyThresholdRef.current > 0) {
      // Filter only if user energy is significantly lower than TTS AND below barge-in threshold
      if (transcriptEnergy < ttsEnergyThresholdRef.current * 0.5 && transcriptEnergy < BARGE_IN_ENERGY_THRESHOLD) {
        return true;
      }
    }
    
    // REMOVED: The aggressive 10-second block that prevented all conversation during TTS
    // Now we rely on energy detection and content similarity instead
    
    return false;
  }, []);

  const checkContentSimilarity = useCallback((text: string): boolean => {
    if (!lastSpokenText) return false;
    
    const normalized = text.toLowerCase().trim();
    const lastNormalized = lastSpokenText.toLowerCase().slice(0, 100);
    
    const words = normalized.split(" ").slice(0, 5);
    const lastWords = lastNormalized.split(" ");
    let matchCount = 0;
    for (const word of words) {
      if (word.length > 3 && lastWords.some((lw) => lw.includes(word))) {
        matchCount++;
      }
    }
    return words.length > 0 && matchCount / words.length > 0.5;
  }, [lastSpokenText]);

  // Echo Analysis with scoring system (0 = not echo, 1 = certain echo)
  const analyzeEchoSuspicion = useCallback((text: string): { score: number; reasons: string[] } => {
    const reasons: string[] = [];
    let score = 0;

    // If not speaking, no echo possible
    if (!isSpeakingRef.current) {
      return { score: 0, reasons };
    }

    const now = Date.now();
    const timeSinceTTSEnd = now - ttsEndTimeRef.current;

    // 1) Cooldown very close to TTS end → medium suspicion
    if (timeSinceTTSEnd < 300) {
      score += 0.35;
      reasons.push("cooldown");
    }

    // 2) Content similarity with last spoken text
    if (checkContentSimilarity(text)) {
      score += 0.35;
      reasons.push("content");
    }

    // 3) Energy-based analysis if analyser available
    if (analyserRef.current) {
      const energy = getAudioEnergy(analyserRef.current);

      // Check if energy pattern matches echo (low energy during TTS)
      if (isEchoFeedback(energy)) {
        score += 0.30;
        reasons.push("energy");
      }

      // Reduce suspicion if energy is high (clear barge-in)
      if (energy > 30) {
        score -= 0.25;
        reasons.push("barge-in");
      }
    }

    // Clamp between 0 and 1
    score = Math.max(0, Math.min(1, score));

    return { score, reasons };
  }, [checkContentSimilarity, getAudioEnergy, isEchoFeedback]);

  const shouldFilterTranscript = useCallback((text: string): boolean => {
    if (!isSpeakingRef.current) {
      echoFilterAppliedRef.current = false;
      return false;
    }

    const { score, reasons } = analyzeEchoSuspicion(text);
    const ECHO_THRESHOLD = 0.75; // Configurable threshold

    if (score >= ECHO_THRESHOLD) {
      logDebugEvent(`Echo filter: score=${score.toFixed(2)} reasons=${reasons.join("+") || "none"}`);
      echoFilterAppliedRef.current = true;
      return true;
    }

    echoFilterAppliedRef.current = false;
    return false;
  }, [analyzeEchoSuspicion, logDebugEvent]);
  
  const resetSession = useCallback(() => {
    logDebugEvent("Session reset");
    
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    if (silenceTimeoutRef.current) {
      clearInterval(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    if (silenceTimeoutForIOSRef.current) {
      clearTimeout(silenceTimeoutForIOSRef.current);
      silenceTimeoutForIOSRef.current = null;
    }
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    endTriggerFiredRef.current = false;
    keepListeningRef.current = false;
    isRecordingRef.current = false;
    processingRef.current = false;
    echoFilterAppliedRef.current = false;
    iOSSilenceTimeoutTriggeredRef.current = false;
    restartAttemptsRef.current = 0;
    
    if (browserRecognitionRef.current) {
      try { browserRecognitionRef.current.abort(); } catch {}
      browserRecognitionRef.current = null;
    }
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    
    updateVoiceState("idle");
    setIsListening(false);
    setIsProcessing(false);
    setWakeWordActive(false);
  }, [logDebugEvent]);

  const requestMicrophonePermission = useCallback(async (): Promise<boolean> => {
    const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    
    try {
      const audioConstraints: MediaTrackConstraints = isiOS 
          ? { echoCancellation: true, noiseSuppression: true }
          : { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 16000 };
      
      if (audioInputDeviceIdRef.current) {
        audioConstraints.deviceId = { exact: audioInputDeviceIdRef.current };
        console.log("[Voice] Using selected input device:", audioInputDeviceIdRef.current);
      }
      
      const constraints: MediaStreamConstraints = { audio: audioConstraints };
      
      console.log("Requesting microphone with constraints:", JSON.stringify(constraints));
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      const tracks = stream.getAudioTracks();
      console.log("Got audio tracks:", tracks.length, tracks.map(t => ({
        label: t.label,
        enabled: t.enabled,
        readyState: t.readyState,
        settings: t.getSettings()
      })));

      streamRef.current = stream;
      
      await initAudioContext();
      if (audioContextRef.current && analyserRef.current) {
        if (audioSourceRef.current) {
          try { audioSourceRef.current.disconnect(); } catch {}
        }
        const source = audioContextRef.current.createMediaStreamSource(stream);
        source.connect(analyserRef.current);
        audioSourceRef.current = source;
      }
      
      setMicPermission("granted");
      setPermissionsReady(true);
      console.log("Microphone permission granted");
      return true;
    } catch (err: unknown) {
      console.error("Microphone permission error:", err);
      const error = err as Error & { name?: string };
      if (error.name === "NotAllowedError") {
        setMicPermission("denied");
      } else {
        setMicPermission("unavailable");
      }
      return false;
    }
  }, [initAudioContext]);

  useEffect(() => {
    const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIOS(isiOS);
    if (!isiOS) {
      setTtsUnlocked(true);
    }
    
    if (typeof window !== "undefined" && window.speechSynthesis) {
      const loadVoices = () => {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
          setVoicesLoaded(true);
          console.log("Voices loaded:", voices.length, "French:", voices.filter(v => v.lang.startsWith("fr")).map(v => v.name));
        }
      };
      
      loadVoices();
      
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
      }
      
      if (isiOS) {
        setTimeout(loadVoices, 500);
      }
    }
    
    fetch("/api/voice/status", { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (data.useBrowserFallback) {
          setUseBrowserFallback(true);
          setUseOpenAITTS(false);
          console.log("Using browser voice fallback");
        }
      })
      .catch(() => {
        setUseBrowserFallback(true);
        setUseOpenAITTS(false);
      });
    
    const handleVisibilityChange = () => {
      if (document.hidden && isiOS) {
        if (browserRecognitionRef.current) {
          try {
            browserRecognitionRef.current.abort();
            browserRecognitionRef.current = null;
          } catch (e) {}
        }
        keepListeningRef.current = false;
        isRecordingRef.current = false;
        setIsListening(false);
        setIOSState("idle", "visibilitychange-hidden");
        console.log("iOS: Stopped recognition due to visibility change");
      }
    };
    
    document.addEventListener("visibilitychange", handleVisibilityChange);
    
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  const unlockTTS = useCallback(async () => {
    if (ttsUnlocked) return true;
    
    try {
      if (!audioContextRef.current) {
        await initAudioContext();
      }
      
      const ctx = audioContextRef.current;
      if (ctx && ctx.state === "suspended") {
        await ctx.resume();
        console.log("AudioContext resumed for iOS");
      }
      
      if (typeof window !== "undefined" && window.speechSynthesis) {
        try {
          const utterance = new SpeechSynthesisUtterance("");
          utterance.volume = 0;
          window.speechSynthesis.speak(utterance);
          window.speechSynthesis.cancel();
        } catch (e) {
          console.log("TTS unlock utterance failed (expected on some iOS versions):", e);
        }
      }
      
      const silentAudio = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA");
      silentAudio.volume = 0.01;
      
      // Timeout to prevent indefinite blocking on iOS
      const playPromise = Promise.race([
        silentAudio.play().catch(() => {}),
        new Promise(resolve => setTimeout(resolve, 500))
      ]);
      await playPromise;
      
      setTtsUnlocked(true);
      console.log("TTS unlocked for iOS");
      return true;
    } catch (err) {
      console.error("Failed to unlock TTS:", err);
      setTtsUnlocked(true);
      return true;
    }
  }, [ttsUnlocked, initAudioContext]);

  const revokeAudioUrl = useCallback((audio: HTMLAudioElement) => {
    if (audio.src && audio.src.startsWith("blob:")) {
      URL.revokeObjectURL(audio.src);
    }
  }, []);

  const playNextInQueue = useCallback(() => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;

    const item = audioQueueRef.current.shift();
    if (!item) return;

    isPlayingRef.current = true;
    isSpeakingRef.current = true;
    updateVoiceState("speaking");
    setIsSpeaking(true);
    currentAudioRef.current = item.audio;
    setLastSpokenText(item.text);

    if (audioContextRef.current && ttsAnalyserRef.current) {
      try {
        if (ttsSourceRef.current) {
          try { ttsSourceRef.current.disconnect(); } catch {}
        }
        const source = audioContextRef.current.createMediaElementSource(item.audio);
        source.connect(ttsAnalyserRef.current);
        ttsAnalyserRef.current.connect(audioContextRef.current.destination);
        ttsSourceRef.current = source;
        
        const measureEnergy = () => {
          if (ttsAnalyserRef.current && isSpeakingRef.current) {
            const energy = getAudioEnergy(ttsAnalyserRef.current);
            ttsEnergyThresholdRef.current = Math.max(ttsEnergyThresholdRef.current, energy);
            requestAnimationFrame(measureEnergy);
          }
        };
        measureEnergy();
      } catch (err) {
        item.audio.volume = 1;
      }
    }

    item.audio.onended = () => {
      revokeAudioUrl(item.audio);
      if (ttsSourceRef.current) {
        try { ttsSourceRef.current.disconnect(); } catch {}
        ttsSourceRef.current = null;
      }
      isPlayingRef.current = false;
      currentAudioRef.current = null;
      ttsEndTimeRef.current = Date.now();
      
      if (audioQueueRef.current.length === 0) {
        if (ttsAnalyserRef.current) {
          try { ttsAnalyserRef.current.disconnect(); } catch {}
        }
        isSpeakingRef.current = false;
        updateVoiceState("idle");
        setIsSpeaking(false);
        setLastSpokenText("");
        ttsEnergyThresholdRef.current = 0;
      } else {
        playNextInQueue();
      }
    };

    item.audio.onerror = () => {
      console.error("Audio playback error");
      revokeAudioUrl(item.audio);
      if (ttsSourceRef.current) {
        try { ttsSourceRef.current.disconnect(); } catch {}
        ttsSourceRef.current = null;
      }
      isPlayingRef.current = false;
      currentAudioRef.current = null;
      ttsEndTimeRef.current = Date.now();
      ttsEnergyThresholdRef.current = 0;
      
      if (audioQueueRef.current.length > 0) {
        playNextInQueue();
      } else {
        if (ttsAnalyserRef.current) {
          try { ttsAnalyserRef.current.disconnect(); } catch {}
        }
        isSpeakingRef.current = false;
        updateVoiceState("idle");
        setIsSpeaking(false);
      }
    };

    ttsStartTimeRef.current = Date.now();
    
    item.audio.play().catch((err) => {
      console.error("Failed to play audio:", err);
      revokeAudioUrl(item.audio);
      if (ttsSourceRef.current) {
        try { ttsSourceRef.current.disconnect(); } catch {}
        ttsSourceRef.current = null;
      }
      if (ttsAnalyserRef.current) {
        try { ttsAnalyserRef.current.disconnect(); } catch {}
      }
      isPlayingRef.current = false;
      isSpeakingRef.current = false;
      updateVoiceState("idle");
      ttsEndTimeRef.current = Date.now();
      ttsEnergyThresholdRef.current = 0;
      setIsSpeaking(false);
    });
  }, [revokeAudioUrl, getAudioEnergy]);

  const speak = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      if (isIOS && !ttsUnlocked) {
        console.warn("TTS not unlocked on iOS");
        return;
      }

      if (useBrowserFallback) {
        fallbackSpeak(text);
        return;
      }

      try {
        const response = await fetch("/api/voice/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice: "onyx", speed: 1.0 }),
          credentials: 'include',
        });

        if (!response.ok) throw new Error("TTS request failed");

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);

        audio.onloadeddata = () => {
          audioQueueRef.current.push({ audio, text });
          if (!isPlayingRef.current) {
            playNextInQueue();
          }
        };
      } catch (error) {
        console.error("TTS error:", error);
        fallbackSpeak(text);
      }
    },
    [isIOS, ttsUnlocked, playNextInQueue, useBrowserFallback]
  );

  const fallbackSpeak = useCallback((text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      console.log("Browser speech synthesis not available");
      return;
    }

    // iOS Safari fix: ensure speechSynthesis is active
    window.speechSynthesis.cancel();
    
    // iOS workaround: speechSynthesis can get stuck, create a tiny utterance first
    if (isIOS) {
      const warmup = new SpeechSynthesisUtterance("");
      warmup.volume = 0;
      window.speechSynthesis.speak(warmup);
      window.speechSynthesis.cancel();
    }

    const maxLength = isIOS ? 200 : 500;
    const chunks: string[] = [];
    
    if (text.length <= maxLength) {
      chunks.push(text);
    } else {
      const sentences = text.split(/(?<=[.!?])\s+/);
      let currentChunk = "";
      
      for (const sentence of sentences) {
        if ((currentChunk + " " + sentence).length <= maxLength) {
          currentChunk = currentChunk ? currentChunk + " " + sentence : sentence;
        } else {
          if (currentChunk) chunks.push(currentChunk);
          
          if (sentence.length <= maxLength) {
            currentChunk = sentence;
          } else {
            let remaining = sentence;
            while (remaining.length > maxLength) {
              let splitIndex = remaining.lastIndexOf(" ", maxLength);
              if (splitIndex <= 0) splitIndex = maxLength;
              chunks.push(remaining.substring(0, splitIndex).trim());
              remaining = remaining.substring(splitIndex).trim();
            }
            currentChunk = remaining;
          }
        }
      }
      if (currentChunk) chunks.push(currentChunk);
    }

    let chunkIndex = 0;
    
    const speakNextChunk = () => {
      if (chunkIndex >= chunks.length) {
        isSpeakingRef.current = false;
        updateVoiceState("idle");
        setIsSpeaking(false);
        setLastSpokenText("");
        ttsEnergyThresholdRef.current = 0;
        return;
      }

      const utterance = new SpeechSynthesisUtterance(chunks[chunkIndex]);
      utterance.lang = "fr-FR";
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      const voices = window.speechSynthesis.getVoices();
      const frenchVoice = voices.find(v => v.lang.startsWith("fr")) || voices[0];
      if (frenchVoice) utterance.voice = frenchVoice;

      utterance.onstart = () => {
        isSpeakingRef.current = true;
        updateVoiceState("speaking");
        setIsSpeaking(true);
        setLastSpokenText(chunks[chunkIndex]);
        ttsStartTimeRef.current = Date.now();
      };

      utterance.onend = () => {
        ttsEndTimeRef.current = Date.now();
        chunkIndex++;
        if (chunkIndex >= chunks.length) {
          isSpeakingRef.current = false;
          updateVoiceState("idle");
          ttsEnergyThresholdRef.current = 0;
        }
        speakNextChunk();
      };

      utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
        ttsEndTimeRef.current = Date.now();
        isSpeakingRef.current = false;
        updateVoiceState("idle");
        ttsEnergyThresholdRef.current = 0;
        if (event.error !== "interrupted" && event.error !== "canceled") {
          console.error("Speech synthesis error:", event.error);
        }
        setIsSpeaking(false);
        setLastSpokenText("");
      };

      if (isIOS && chunkIndex > 0) {
        setTimeout(() => window.speechSynthesis.speak(utterance), 100);
      } else {
        window.speechSynthesis.speak(utterance);
      }
    };

    speakNextChunk();
  }, [isIOS]);

  const stopSpeaking = useCallback(() => {
    if (currentAudioRef.current) {
      if (currentAudioRef.current.src?.startsWith("blob:")) {
        URL.revokeObjectURL(currentAudioRef.current.src);
      }
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }
    if (ttsSourceRef.current) {
      try { ttsSourceRef.current.disconnect(); } catch {}
      ttsSourceRef.current = null;
    }
    if (ttsAnalyserRef.current) {
      try { ttsAnalyserRef.current.disconnect(); } catch {}
    }
    audioQueueRef.current.forEach(item => {
      if (item.audio.src?.startsWith("blob:")) {
        URL.revokeObjectURL(item.audio.src);
      }
    });
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    isSpeakingRef.current = false;
    updateVoiceState("idle");
    ttsEndTimeRef.current = Date.now();
    ttsEnergyThresholdRef.current = 0;
    setIsSpeaking(false);
    setLastSpokenText("");

    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const interrupt = useCallback(() => {
    stopSpeaking();
    setWakeWordActive(false);
    processingRef.current = false;
    updateVoiceState("idle");
    console.log("Speech interrupted by user");
  }, [stopSpeaking]);

  const sendAudioToWhisper = useCallback(async (audioBlob: Blob): Promise<string> => {
    try {
      setIsProcessing(true);
      updateVoiceState("processing");
      
      abortControllerRef.current = new AbortController();
      const formData = new FormData();
      
      // Determine correct file extension based on actual mimeType
      const mimeType = audioBlob.type || "audio/webm";
      let extension = "webm";
      if (mimeType.includes("mp4") || mimeType.includes("m4a")) {
        extension = "m4a";
      } else if (mimeType.includes("ogg")) {
        extension = "ogg";
      } else if (mimeType.includes("wav")) {
        extension = "wav";
      } else if (mimeType.includes("mp3") || mimeType.includes("mpeg")) {
        extension = "mp3";
      }
      
      formData.append("audio", audioBlob, `audio.${extension}`);
      formData.append("language", "fr");
      formData.append("mimeType", mimeType);

      const response = await fetch("/api/voice/stt", {
        method: "POST",
        body: formData,
        signal: abortControllerRef.current.signal,
        credentials: 'include', // Include cookies for cross-origin requests from ulysseproject.org
      });

      if (!response.ok) throw new Error("STT request failed");

      const data = await response.json();
      setIsProcessing(false);
      abortControllerRef.current = null;
      return data.transcript || "";
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        console.log("STT request cancelled");
      } else {
        console.error("Whisper STT error:", error);
      }
      setIsProcessing(false);
      abortControllerRef.current = null;
      return "";
    }
  }, []);

  const checkForWakeWord = useCallback((text: string): boolean => {
    const wakeWords = ["hey ulysse", "salut ulysse", "ok ulysse", "ulysse", "hey ulisse", "ulisse", "hey ulis", "ulis", "hey iris", "salut iris", "ok iris", "iris"];
    const normalized = text.toLowerCase().trim();
    return wakeWords.some((word) => normalized.includes(word));
  }, []);

  const endTriggerFiredRef = useRef(false);
  const onAutoSubmitRef = useRef<((text: string) => void) | null>(null);

  const detectEndTrigger = useCallback((text: string): { hasEndTrigger: boolean; cleanedText: string } => {
    const normalized = text.toLowerCase().trim();
    const endTriggerPattern = /[,\s]*(à\s*toi|a\s*toi|àtoi|atoi)[.!?,\s]*$/i;
    const hasEndTrigger = endTriggerPattern.test(normalized);
    const cleanedText = hasEndTrigger ? text.replace(endTriggerPattern, "").trim() : text;
    return { hasEndTrigger, cleanedText };
  }, []);

  const setOnAutoSubmit = useCallback((callback: ((text: string) => void) | null) => {
    onAutoSubmitRef.current = callback;
  }, []);

  const processTranscript = useCallback((transcriptResult: string) => {
    if (!transcriptResult.trim()) return;
    
    if (shouldFilterTranscript(transcriptResult)) {
      logDebugEvent("Transcript filtered by echo guard");
      return;
    }
    
    const hasWakeWord = checkForWakeWord(transcriptResult);
    let cleanedText = transcriptResult
      .replace(/hey ulysse|salut ulysse|ok ulysse|ulysse|hey ulisse|ulisse|hey ulis|ulis|hey iris|salut iris|ok iris|iris/gi, "")
      .trim();
    
    if (hasWakeWord || wakeWordActive) {
      logDebugEvent(`Wake word detected: ${hasWakeWord ? "in text" : "active mode"}`);
      if (!wakeWordActive) setWakeWordActive(true);
      if (cleanedText) {
        setTranscript(cleanedText);
        setWakeWordActive(false);
      }
    } else {
      setTranscript(transcriptResult);
      cleanedText = transcriptResult;
    }

    const { hasEndTrigger, cleanedText: endTriggerCleanedText } = detectEndTrigger(cleanedText || transcriptResult);
    
    if (hasEndTrigger && !endTriggerFiredRef.current) {
      endTriggerFiredRef.current = true;
      logDebugEvent("End trigger 'à toi' detected - synchronous submit");
      
      keepListeningRef.current = false;
      
      if (silenceTimeoutForIOSRef.current) {
        clearTimeout(silenceTimeoutForIOSRef.current);
        silenceTimeoutForIOSRef.current = null;
      }
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current);
        restartTimeoutRef.current = null;
      }
      
      if (browserRecognitionRef.current) {
        try { browserRecognitionRef.current.abort(); } catch {}
        browserRecognitionRef.current = null;
      }
      isRecordingRef.current = false;
      updateVoiceState("idle");
      setIsListening(false);
      
      const finalText = endTriggerCleanedText.trim();
      if (finalText) {
        setTranscript(finalText);
        onAutoSubmitRef.current?.(finalText);
        setTranscript("");
      }
      
      endTriggerFiredRef.current = false;
    }
  }, [checkForWakeWord, wakeWordActive, shouldFilterTranscript, detectEndTrigger, logDebugEvent]);

  const silenceTimeoutForIOSRef = useRef<number | null>(null);
  
  const startBrowserRecognition = useCallback(() => {
    if (document.hidden) {
      console.log("Document is hidden, skipping speech recognition start");
      return false;
    }
    
    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      console.log("Speech recognition not supported");
      setSttSupported(false);
      setIsListening(false);
      return false;
    }

    const isiOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
    
    // iOS: Check if state is disabled (permission denied or audio capture failed)
    if (isiOSDevice && iOSStateRef.current === "disabled") {
      console.log("[iOS VOICE] startBrowserRecognition called but state is disabled, aborting");
      return false;
    }
    
    // iOS Safari requires specific handling
    if (isiOSDevice) {
      console.log("iOS: Checking speech recognition availability...");
      // Ensure we're in a secure context
      if (!window.isSecureContext) {
        console.error("iOS: Speech recognition requires HTTPS");
        setSttSupported(false);
        return false;
      }
    }

    // Increment session ID to invalidate any pending onend callbacks from previous sessions
    recognitionSessionIdRef.current += 1;
    const currentSessionId = recognitionSessionIdRef.current;
    console.log(`Starting speech recognition session ${currentSessionId}`);

    try {
      const recognition = new SpeechRecognitionClass();
      recognition.continuous = !isiOSDevice;
      recognition.interimResults = true;
      recognition.lang = "fr-FR";
      browserRecognitionRef.current = recognition;
      
      // Set iOS state to listening
      if (isiOSDevice) {
        setIOSState("listening", "startBrowserRecognition");
      }

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        if (silenceTimeoutForIOSRef.current) {
          clearTimeout(silenceTimeoutForIOSRef.current);
        }
        
        let finalTranscript = "";
        let interimTranscript = "";
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            finalTranscript += result[0].transcript;
          } else {
            interimTranscript += result[0].transcript;
          }
        }
        
        if (finalTranscript.trim()) {
          processTranscript(finalTranscript);
        }
        
        if (isiOSDevice && (interimTranscript || finalTranscript)) {
          silenceTimeoutForIOSRef.current = window.setTimeout(() => {
            if (browserRecognitionRef.current && isRecordingRef.current) {
              iOSSilenceTimeoutTriggeredRef.current = true;
              logDebugEvent("iOS silence timeout (3s) - stopping recognition");
              try {
                browserRecognitionRef.current.stop();
              } catch (e) {}
            }
          }, 3000);
        }
      };

      recognition.onerror = (event: Event & { error?: string }) => {
        const errorType = event.error || "unknown";
        logDebugEvent(`SpeechRecognition error: ${errorType}`);
        
        // iOS-specific error logging
        if (isiOSDevice) {
          console.log(`[iOS VOICE] onerror type=${errorType}`);
        }
        
        if (silenceTimeoutForIOSRef.current) {
          clearTimeout(silenceTimeoutForIOSRef.current);
          silenceTimeoutForIOSRef.current = null;
        }
        
        isRecordingRef.current = false;
        updateVoiceState("idle");
        setIsListening(false);
        
        if (errorType === "not-allowed") {
          logDebugEvent("Mic permission denied - needs browser/device settings");
          setMicPermission("denied");
          setSttSupported(false);
          keepListeningRef.current = false;
          if (isiOSDevice) {
            setIOSState("disabled", "not-allowed");
          }
        } else if (errorType === "audio-capture") {
          logDebugEvent("No microphone detected or in use by another app");
          setMicPermission("unavailable");
          keepListeningRef.current = false;
          if (isiOSDevice) {
            setIOSState("disabled", "audio-capture");
          }
        } else if (errorType === "network") {
          logDebugEvent("Network error - will retry");
        } else if (errorType === "no-speech") {
          logDebugEvent("No speech detected");
        } else if (errorType !== "aborted") {
          keepListeningRef.current = false;
          if (isiOSDevice) {
            setIOSState("idle", `error:${errorType}`);
          }
        }
      };

      recognition.onend = () => {
        // Check if this session is still the current one - if not, ignore
        if (currentSessionId !== recognitionSessionIdRef.current) {
          console.log(`Session ${currentSessionId} ended but current is ${recognitionSessionIdRef.current}, ignoring restart`);
          return;
        }
        
        if (silenceTimeoutForIOSRef.current) {
          clearTimeout(silenceTimeoutForIOSRef.current);
          silenceTimeoutForIOSRef.current = null;
        }
        
        isRecordingRef.current = false;
        setIsListening(false);
        
        // iOS-specific onend logging
        if (isiOSDevice) {
          console.log("[iOS VOICE] onend fired, keepListening=", keepListeningRef.current);
        }
        
        if (keepListeningRef.current) {
          restartAttemptsRef.current++;
          const baseDelay = isiOSDevice ? 300 : 200;
          const backoffDelay = Math.min(baseDelay * Math.pow(1.5, restartAttemptsRef.current - 1), 5000);
          
          if (isiOSDevice) {
            setIOSState("restarting", `onend-backoff-${backoffDelay}ms`);
          }
          
          restartTimeoutRef.current = window.setTimeout(() => {
            if (!keepListeningRef.current || currentSessionId !== recognitionSessionIdRef.current) {
              return;
            }
            // iOS: Check if state became disabled during wait
            if (isiOSDevice && iOSStateRef.current === "disabled") {
              console.log("[iOS VOICE] restart skipped because state=disabled");
              return;
            }
            startBrowserRecognition();
          }, backoffDelay);
        } else {
          if (isiOSDevice) {
            setIOSState("idle", "onend-no-keepListening");
          }
          updateVoiceState("idle");
        }
      };

      recognition.start();
      isRecordingRef.current = true;
      updateVoiceState("listening");
      setIsListening(true);
      restartAttemptsRef.current = 0;
      console.log(isiOSDevice ? "iOS: Started webkitSpeechRecognition" : "Started browser speech recognition");
      
      if (isiOSDevice) {
        silenceTimeoutForIOSRef.current = window.setTimeout(() => {
          if (browserRecognitionRef.current && isRecordingRef.current) {
            iOSSilenceTimeoutTriggeredRef.current = true;
            logDebugEvent("iOS initial silence timeout (7s) - no speech detected");
            try {
              browserRecognitionRef.current.stop();
            } catch (e) {}
          }
        }, 7000);
      }
      
      return true;
    } catch (err) {
      console.error("Failed to start speech recognition:", err);
      logDebugEvent(`Failed to start speech recognition: ${err}`);
      setIsListening(false);
      return false;
    }
  }, [processTranscript, logDebugEvent]);

  const startListening = useCallback(async () => {
    // Don't block if already recording - just clean up and restart
    if (processingRef.current) {
      console.log("Still processing previous audio, please wait");
      return;
    }
    
    if (voiceState === "speaking") {
      console.log("Cannot start listening while speaking");
      return;
    }
    
    // Clean up any previous recording session before starting
    // Important: Set keepListeningRef to false BEFORE aborting to prevent auto-restart loop
    keepListeningRef.current = false;
    
    // Reset end trigger flag for new session
    endTriggerFiredRef.current = false;
    
    // Clear any pending restart timeouts
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    
    if (browserRecognitionRef.current) {
      try { browserRecognitionRef.current.abort(); } catch(e) {}
      browserRecognitionRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    isRecordingRef.current = false;
    
    // iOS: Ensure AudioContext is running and TTS is unlocked first
    if (isIOS) {
      if (!audioContextRef.current) {
        await initAudioContext();
      }
      if (audioContextRef.current?.state === "suspended") {
        try {
          await audioContextRef.current.resume();
          console.log("iOS: AudioContext resumed before listening");
        } catch (e) {
          console.error("iOS: Failed to resume AudioContext:", e);
        }
      }
      // Also unlock TTS on iOS if not done
      if (!ttsUnlocked) {
        await unlockTTS();
      }
    }
    
    // iOS: Check if state is disabled (permission denied or audio capture failed)
    if (isIOS && iOSStateRef.current === "disabled") {
      console.log("[iOS VOICE] startListening aborted because state=disabled");
      return;
    }
    
    if (useBrowserFallback || isIOS) {
      const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognitionClass) {
        keepListeningRef.current = true;
        console.log(isIOS ? "iOS: Starting webkitSpeechRecognition..." : "Starting browser speech recognition...");
        const started = startBrowserRecognition();
        if (started) return;
        if (isIOS) {
          console.log("iOS: Speech recognition not started (document hidden or unavailable), aborting");
          keepListeningRef.current = false;
          return;
        }
      }
    }
    
    if (typeof MediaRecorder === "undefined") {
      console.log("Neither SpeechRecognition nor MediaRecorder available");
      setSttSupported(false);
      return;
    }
    
    if (!streamRef.current) {
      await requestMicrophonePermission();
      if (!streamRef.current) return;
    }

    keepListeningRef.current = true;
    isRecordingRef.current = true;
    updateVoiceState("listening");
    setIsListening(true);
    lastActivityRef.current = Date.now();

    try {
      const supportedTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
        "audio/wav",
        ""
      ];
      
      let mimeType = "";
      for (const type of supportedTypes) {
        if (!type || MediaRecorder.isTypeSupported(type)) {
          mimeType = type;
          break;
        }
      }
      
      console.log("MediaRecorder mimeType selected:", mimeType || "(default)");
      console.log("Supported types check:", supportedTypes.map(t => ({ type: t, supported: !t || MediaRecorder.isTypeSupported(t) })));
      
      const recorderOptions: MediaRecorderOptions = mimeType ? { mimeType } : {};
      const mediaRecorder = new MediaRecorder(streamRef.current, recorderOptions);
      mediaRecorderRef.current = mediaRecorder;
      
      const actualMimeType = mediaRecorder.mimeType || mimeType || "audio/webm";
      console.log("MediaRecorder actual mimeType:", actualMimeType);
      
      setSttSupported(true);
      
      let dataReceivedCount = 0;
      let totalDataSize = 0;
      const recordingStartTime = Date.now();
      
      // Use LOCAL array for this session to avoid race condition with ref
      const sessionChunks: Blob[] = [];

      mediaRecorder.ondataavailable = (event) => {
        dataReceivedCount++;
        totalDataSize += event.data.size;
        console.log(`MediaRecorder data #${dataReceivedCount}: size=${event.data.size}, total=${totalDataSize}, time=${Date.now() - recordingStartTime}ms`);
        
        if (event.data.size > 0) {
          sessionChunks.push(event.data);
          lastActivityRef.current = Date.now();
        }
      };
      
      mediaRecorder.onerror = (event) => {
        console.error("MediaRecorder error event:", event);
      };
      
      mediaRecorder.onstart = () => {
        console.log("MediaRecorder started, state:", mediaRecorder.state);
      };

      mediaRecorder.onstop = async () => {
        console.log(`MediaRecorder stopped. Chunks: ${sessionChunks.length}, Total size: ${totalDataSize}`);
        isRecordingRef.current = false;
        
        if (sessionChunks.length > 0 && !processingRef.current) {
          const audioBlob = new Blob(sessionChunks, { type: actualMimeType });
          console.log(`Created audio blob: size=${audioBlob.size}, type=${audioBlob.type}`);
          
          if (audioBlob.size > 500) {
            processingRef.current = true;
            const transcriptResult = await sendAudioToWhisper(audioBlob);
            processingRef.current = false;
            
            if (transcriptResult.trim()) {
              processTranscript(transcriptResult);
            }
          } else {
            console.log("Audio blob too small, skipping transcription");
          }
        } else {
          console.log("No audio chunks to process or already processing");
        }
        
        if (keepListeningRef.current && streamRef.current && !isRecordingRef.current) {
          if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
          restartTimeoutRef.current = window.setTimeout(() => {
            if (keepListeningRef.current) {
              startListening();
            }
          }, 100);
        } else {
          updateVoiceState("idle");
        }
      };

      const isiOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
      
      if (isiOSDevice) {
        mediaRecorder.start();
        console.log("iOS: Started MediaRecorder without timeslice, will use requestData()");
      } else {
        mediaRecorder.start(250);
      }

      if (silenceTimeoutRef.current) clearInterval(silenceTimeoutRef.current);
      
      let noDataWarned = false;
      let requestDataInterval: number | null = null;
      
      if (isiOSDevice) {
        requestDataInterval = window.setInterval(() => {
          if (mediaRecorder.state === "recording") {
            try {
              mediaRecorder.requestData();
            } catch (e) {
              console.log("requestData failed:", e);
            }
          }
        }, 500);
      }
      
      // VAD (Voice Activity Detection) - Connect stream to analyser for volume detection
      let silenceStartTime: number | null = null;
      let hasDetectedSpeech = false;
      let speechConfirmCount = 0; // Count consecutive frames above threshold
      const SPEECH_THRESHOLD = 15; // Volume level above which is considered speech (raised for Bluetooth noise)
      const SILENCE_THRESHOLD = 12; // Volume below which is silence (raised for Bluetooth noise floor)
      const SPEECH_CONFIRM_FRAMES = 2; // Need 2 consecutive frames above threshold to confirm speech
      const SILENCE_DURATION = 1500; // 1.5 seconds of silence to trigger stop
      const MIN_SPEECH_DURATION = 500; // Minimum recording time before VAD kicks in
      const INITIAL_SILENCE_TIMEOUT = 8000; // Stop after 8s if no speech detected
      const MAX_RECORDING_DURATION = 30000; // Absolute max 30 seconds to prevent infinite recording
      let volumeLogCounter = 0; // For periodic volume logging
      
      // Cleanup any previous VAD nodes before creating new ones
      if (vadSourceRef.current) {
        try { vadSourceRef.current.disconnect(); } catch (e) {}
        vadSourceRef.current = null;
      }
      vadAnalyserRef.current = null;
      
      try {
        const ctx = audioContextRef.current || await initAudioContext();
        if (ctx && streamRef.current) {
          vadAnalyserRef.current = ctx.createAnalyser();
          vadAnalyserRef.current.fftSize = 256;
          vadAnalyserRef.current.smoothingTimeConstant = 0.5;
          vadSourceRef.current = ctx.createMediaStreamSource(streamRef.current);
          vadSourceRef.current.connect(vadAnalyserRef.current);
          console.log("[VAD] Voice Activity Detection initialized");
        }
      } catch (e) {
        console.log("[VAD] Could not initialize, falling back to data-based detection");
      }
      
      // Reusable cleanup function for VAD resources
      const cleanupVAD = () => {
        if (vadSourceRef.current) {
          try { vadSourceRef.current.disconnect(); } catch (e) {}
          vadSourceRef.current = null;
        }
        vadAnalyserRef.current = null;
      };
      
      silenceTimeoutRef.current = window.setInterval(() => {
        const elapsed = Date.now() - recordingStartTime;
        
        if (elapsed > 2000 && totalDataSize === 0 && !noDataWarned) {
          noDataWarned = true;
          console.warn("No audio data received after 2s - iOS MediaRecorder may not be working");
        }
        
        // VAD-based silence detection
        if (vadAnalyserRef.current && mediaRecorder.state === "recording" && !processingRef.current) {
          const dataArray = new Uint8Array(vadAnalyserRef.current.frequencyBinCount);
          vadAnalyserRef.current.getByteFrequencyData(dataArray);
          const volume = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
          
          // Log volume every 2 seconds for debugging
          volumeLogCounter++;
          if (volumeLogCounter % 13 === 0) { // ~every 2 seconds (150ms * 13)
            console.log(`[VAD] Volume: ${volume.toFixed(1)}, speech=${hasDetectedSpeech}, silenceStart=${silenceStartTime ? 'yes' : 'no'}`);
          }
          
          if (volume > SPEECH_THRESHOLD) {
            // User is speaking - require multiple consecutive frames to confirm
            speechConfirmCount++;
            if (speechConfirmCount >= SPEECH_CONFIRM_FRAMES) {
              if (!hasDetectedSpeech) {
                hasDetectedSpeech = true;
                console.log(`[VAD] Speech confirmed, volume=${volume.toFixed(1)}`);
              }
              // Only reset silence timer if speech is actually confirmed (not just a brief spike)
              silenceStartTime = null;
            }
            lastActivityRef.current = Date.now();
          } else if (volume < SILENCE_THRESHOLD && hasDetectedSpeech && elapsed > MIN_SPEECH_DURATION) {
            // Definite silence detected after confirmed speech
            speechConfirmCount = 0;
            if (!silenceStartTime) {
              silenceStartTime = Date.now();
              console.log(`[VAD] Silence started, volume=${volume.toFixed(1)}`);
            } else if (Date.now() - silenceStartTime > SILENCE_DURATION) {
              console.log(`[VAD] Silence timeout (${SILENCE_DURATION}ms), stopping recorder`);
              if (requestDataInterval) clearInterval(requestDataInterval);
              cleanupVAD();
              mediaRecorder.stop();
            }
          } else if (volume >= SILENCE_THRESHOLD && volume <= SPEECH_THRESHOLD) {
            // Ambiguous zone - don't reset silence timer but also don't confirm speech
            speechConfirmCount = 0;
          } else if (!hasDetectedSpeech && elapsed > INITIAL_SILENCE_TIMEOUT) {
            // No speech detected for too long, stop recording
            console.log(`[VAD] No speech detected after ${INITIAL_SILENCE_TIMEOUT}ms, stopping recorder`);
            if (requestDataInterval) clearInterval(requestDataInterval);
            cleanupVAD();
            mediaRecorder.stop();
          }
          
          // Absolute max recording duration safety check
          if (elapsed > MAX_RECORDING_DURATION) {
            console.log(`[VAD] Max recording duration (${MAX_RECORDING_DURATION}ms) reached, forcing stop`);
            if (requestDataInterval) clearInterval(requestDataInterval);
            cleanupVAD();
            mediaRecorder.stop();
          }
        } else {
          // Fallback to data-based detection
          const timeSinceActivity = Date.now() - lastActivityRef.current;
          if (timeSinceActivity > 2500 && mediaRecorder.state === "recording" && !processingRef.current) {
            console.log("Silence timeout reached (fallback), stopping recorder");
            if (requestDataInterval) clearInterval(requestDataInterval);
            cleanupVAD();
            mediaRecorder.stop();
          }
        }
      }, 150);
    } catch (err) {
      console.error("MediaRecorder error:", err);
      isRecordingRef.current = false;
      updateVoiceState("idle");
      setIsListening(false);
      if (!isIOS) {
        startBrowserRecognition();
      }
    }
  }, [requestMicrophonePermission, sendAudioToWhisper, processTranscript, useBrowserFallback, startBrowserRecognition, isIOS, initAudioContext, unlockTTS, ttsUnlocked, voiceState]);

  const stopListening = useCallback(() => {
    keepListeningRef.current = false;
    isRecordingRef.current = false;
    processingRef.current = false;
    
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    
    if (silenceTimeoutRef.current) {
      clearInterval(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    
    // Cleanup VAD resources
    if (vadSourceRef.current) {
      try { vadSourceRef.current.disconnect(); } catch (e) {}
      vadSourceRef.current = null;
    }
    vadAnalyserRef.current = null;
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    
    if (browserRecognitionRef.current) {
      try {
        browserRecognitionRef.current.abort();
      } catch (e) {}
      browserRecognitionRef.current = null;
    }
    
    updateVoiceState("idle");
    setIsListening(false);
    setWakeWordActive(false);
    audioChunksRef.current = [];
  }, []);

  const suspendAudio = useCallback(async () => {
    if (audioContextRef.current && audioContextRef.current.state === "running") {
      try {
        await audioContextRef.current.suspend();
        console.log("AudioContext suspended");
      } catch (err) {
        console.error("Failed to suspend AudioContext:", err);
      }
    }
    if (currentAudioRef.current && !currentAudioRef.current.paused) {
      currentAudioRef.current.pause();
    }
  }, []);

  const resumeAudio = useCallback(async () => {
    if (audioContextRef.current && audioContextRef.current.state === "suspended") {
      try {
        await audioContextRef.current.resume();
        console.log("AudioContext resumed");
      } catch (err) {
        console.error("Failed to resume AudioContext:", err);
      }
    }
  }, []);

  const cancelOperation = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    if (ttsSourceRef.current) {
      try { ttsSourceRef.current.disconnect(); } catch {}
      ttsSourceRef.current = null;
    }
    if (ttsAnalyserRef.current) {
      try { ttsAnalyserRef.current.disconnect(); } catch {}
    }
    stopListening();
    stopSpeaking();
    updateVoiceState("idle");
  }, [stopListening, stopSpeaking]);

  const initializeAudio = useCallback(async () => {
    const isiOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
    console.log("Initializing audio for", isiOSDevice ? "iOS" : "other platform");
    
    await initAudioContext();
    
    if (audioContextRef.current?.state === "suspended") {
      try {
        await audioContextRef.current.resume();
        console.log("AudioContext resumed during initialization");
      } catch (e) {
        console.error("Failed to resume AudioContext:", e);
      }
    }
    
    await unlockTTS();
    
    if (typeof window !== "undefined" && window.speechSynthesis) {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length === 0) {
        await new Promise<void>(resolve => {
          const onVoicesLoaded = () => {
            window.speechSynthesis.removeEventListener("voiceschanged", onVoicesLoaded);
            resolve();
          };
          window.speechSynthesis.addEventListener("voiceschanged", onVoicesLoaded);
          setTimeout(resolve, 1000);
        });
      }
    }
    
    console.log("Audio initialization complete");
    return true;
  }, [initAudioContext, unlockTTS]);

  const getDebugInfo = useCallback((): VoiceDebugInfo => {
    return {
      state: voiceStateRef.current,
      wakeWordActive,
      endTriggerFired: endTriggerFiredRef.current,
      echoFilterApplied: echoFilterAppliedRef.current,
      lastEvent: lastDebugEventRef.current,
      lastEventTime: lastDebugEventTimeRef.current,
      iOSSilenceTimeout: iOSSilenceTimeoutTriggeredRef.current,
      restartAttempts: restartAttemptsRef.current,
      isRecording: isRecordingRef.current,
      keepListening: keepListeningRef.current,
    };
  }, [wakeWordActive]);

  useEffect(() => {
    return () => {
      cancelOperation();
      if (audioSourceRef.current) {
        try { audioSourceRef.current.disconnect(); } catch {}
        audioSourceRef.current = null;
      }
      if (ttsSourceRef.current) {
        try { ttsSourceRef.current.disconnect(); } catch {}
        ttsSourceRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      analyserRef.current = null;
      ttsAnalyserRef.current = null;
    };
  }, [cancelOperation]);

  // Progressive TTS - speak sentences as they arrive during streaming
  const progressiveTTSBuffer = useRef<string>("");
  const progressiveTTSQueue = useRef<string[]>([]);
  const isProgressiveSpeaking = useRef<boolean>(false);
  
  const speakProgressiveChunk = useCallback(async (sentence: string) => {
    if (!sentence.trim()) return;
    
    if (useBrowserFallback) {
      fallbackSpeak(sentence);
      return;
    }
    
    try {
      const response = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sentence, voice: "onyx", speed: 1.0 }),
        credentials: 'include',
      });
      
      if (!response.ok) throw new Error("TTS request failed");
      
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl) as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      
      if (audioOutputDeviceIdRef.current && audio.setSinkId) {
        try {
          await audio.setSinkId(audioOutputDeviceIdRef.current);
          console.log("[TTS] Audio output set to device:", audioOutputDeviceIdRef.current);
        } catch (e) {
          console.log("[TTS] Could not set audio output device:", e);
        }
      }
      
      audio.onloadeddata = () => {
        audioQueueRef.current.push({ audio, text: sentence });
        if (!isPlayingRef.current) {
          playNextInQueue();
        }
      };
    } catch (error) {
      console.error("Progressive TTS error:", error);
      fallbackSpeak(sentence);
    }
  }, [useBrowserFallback, fallbackSpeak, playNextInQueue]);
  
  const processProgressiveQueue = useCallback(async () => {
    if (isProgressiveSpeaking.current) return;
    if (progressiveTTSQueue.current.length === 0) return;
    
    isProgressiveSpeaking.current = true;
    
    while (progressiveTTSQueue.current.length > 0) {
      const sentence = progressiveTTSQueue.current.shift();
      if (sentence) {
        await speakProgressiveChunk(sentence);
        // Small delay between sentences for natural pacing
        await new Promise(r => setTimeout(r, 50));
      }
    }
    
    isProgressiveSpeaking.current = false;
  }, [speakProgressiveChunk]);
  
  // Feed streaming text chunk by chunk - speaks as complete sentences arrive
  const speakProgressive = useCallback((chunk: string, isFinal: boolean = false) => {
    progressiveTTSBuffer.current += chunk;
    
    // Look for complete sentences
    const sentenceRegex = /[^.!?]*[.!?]+\s*/g;
    const buffer = progressiveTTSBuffer.current;
    let match;
    let lastIndex = 0;
    
    while ((match = sentenceRegex.exec(buffer)) !== null) {
      const sentence = match[0].trim();
      if (sentence.length > 3) { // Ignore very short fragments
        progressiveTTSQueue.current.push(sentence);
        console.log(`[TTS Progressive] Queued: "${sentence.substring(0, 40)}..."`);
      }
      lastIndex = sentenceRegex.lastIndex;
    }
    
    // Keep remaining incomplete text in buffer
    progressiveTTSBuffer.current = buffer.substring(lastIndex);
    
    // If final, flush remaining buffer
    if (isFinal && progressiveTTSBuffer.current.trim()) {
      progressiveTTSQueue.current.push(progressiveTTSBuffer.current.trim());
      console.log(`[TTS Progressive] Flushed final: "${progressiveTTSBuffer.current.substring(0, 40)}..."`);
      progressiveTTSBuffer.current = "";
    }
    
    // Start processing queue
    processProgressiveQueue();
  }, [processProgressiveQueue]);
  
  // Reset progressive TTS state
  const resetProgressiveTTS = useCallback(() => {
    progressiveTTSBuffer.current = "";
    progressiveTTSQueue.current = [];
    isProgressiveSpeaking.current = false;
  }, []);
  
  // Set audio input device for microphone
  const setAudioInputDevice = useCallback((deviceId: string) => {
    audioInputDeviceIdRef.current = deviceId;
    console.log("[Voice] Audio input device set to:", deviceId);
  }, []);
  
  // Set audio output device for TTS playback
  const setAudioOutputDevice = useCallback((deviceId: string) => {
    audioOutputDeviceIdRef.current = deviceId;
    console.log("[Voice] Audio output device set to:", deviceId);
    
    // Apply to currently playing audio if any
    if (currentAudioRef.current) {
      const audio = currentAudioRef.current as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      if (audio.setSinkId && deviceId) {
        audio.setSinkId(deviceId).catch(e => console.log("[Voice] Could not update current audio device:", e));
      }
    }
  }, []);

  return {
    isListening,
    isSpeaking,
    isProcessing,
    transcript,
    sttSupported,
    ttsSupported,
    voicesLoaded,
    lastSpokenText,
    micPermission,
    permissionsReady,
    ttsUnlocked,
    isIOS,
    wakeWordActive,
    useOpenAITTS,
    useBrowserFallback,
    voiceState,
    startListening,
    stopListening,
    speak,
    speakProgressive,
    resetProgressiveTTS,
    stopSpeaking,
    unlockTTS,
    interrupt,
    requestMicrophonePermission,
    cancelOperation,
    setTranscript,
    setWakeWordActive,
    suspendAudio,
    resumeAudio,
    initializeAudio,
    setOnAutoSubmit,
    resetSession,
    getDebugInfo,
    setAudioOutputDevice,
    setAudioInputDevice,
  };
}
