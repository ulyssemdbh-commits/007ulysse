import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";

interface VoiceContextType {
  isListening: boolean;
  isSpeaking: boolean;
  autoSpeak: boolean;
  sttSupported: boolean;
  ttsSupported: boolean;
  ttsUnlocked: boolean;
  isIOS: boolean;
  micPermission: PermissionState;
  permissionsReady: boolean;
  transcript: string;
  setTranscript: (text: string) => void;
  startListening: () => void;
  stopListening: () => void;
  speak: (text: string) => Promise<void>;
  stopSpeaking: () => void;
  unlockTTS: () => Promise<void>;
  requestMicrophonePermission: () => Promise<boolean>;
  setAutoSpeak: (value: boolean) => void;
  initializeAudio: () => Promise<void>;
}

const VoiceContext = createContext<VoiceContextType | null>(null);

export function useSharedVoice() {
  const context = useContext(VoiceContext);
  if (!context) {
    throw new Error("useSharedVoice must be used within a VoiceProvider");
  }
  return context;
}

interface VoiceProviderProps {
  children: ReactNode;
}

export function VoiceProvider({ children }: VoiceProviderProps) {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [autoSpeak, setAutoSpeakState] = useState(() => {
    const saved = localStorage.getItem("ulysse-autospeak");
    return saved !== null ? saved === "true" : true;
  });
  const [sttSupported, setSttSupported] = useState(true);
  const [ttsSupported, setTtsSupported] = useState(true);
  const [ttsUnlocked, setTtsUnlocked] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [micPermission, setMicPermission] = useState<PermissionState>("prompt");
  const [permissionsReady, setPermissionsReady] = useState(false);
  const [transcript, setTranscript] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const keepListeningRef = useRef(true);
  const isRecordingRef = useRef(false);
  const processingRef = useRef(false);
  const silenceTimeoutRef = useRef<number | null>(null);
  const restartTimeoutRef = useRef<number | null>(null);
  const browserRecognitionRef = useRef<any>(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    const isIOSDevice = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setIsIOS(isIOSDevice);

    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setSttSupported(Boolean(SpeechRecognitionAPI));
    setTtsSupported("speechSynthesis" in window);

    checkMicrophonePermission();
  }, []);

  useEffect(() => {
    localStorage.setItem("ulysse-autospeak", String(autoSpeak));
  }, [autoSpeak]);

  useEffect(() => {
    localStorage.setItem("ulysse-mic-active", String(isListening));
  }, [isListening]);

  const setAutoSpeak = useCallback((value: boolean) => {
    setAutoSpeakState(value);
  }, []);

  const checkMicrophonePermission = useCallback(async () => {
    try {
      if (navigator.permissions) {
        const result = await navigator.permissions.query({ name: "microphone" as PermissionName });
        setMicPermission(result.state);
        result.onchange = () => setMicPermission(result.state);
      }
      setPermissionsReady(true);
    } catch {
      setPermissionsReady(true);
    }
  }, []);

  const requestMicrophonePermission = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      setMicPermission("granted");
      return true;
    } catch {
      setMicPermission("denied");
      return false;
    }
  }, []);

  const initAudioContext = useCallback(async () => {
    if (audioContextRef.current) return audioContextRef.current;
    try {
      const AudioContextClass = window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return null;
      const ctx = new AudioContextClass();
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      audioContextRef.current = ctx;
      return ctx;
    } catch {
      return null;
    }
  }, []);

  const initializeAudio = useCallback(async () => {
    await initAudioContext();
  }, [initAudioContext]);

  const unlockTTS = useCallback(async () => {
    if (ttsUnlocked) return;
    try {
      await initAudioContext();
      if ("speechSynthesis" in window) {
        const utterance = new SpeechSynthesisUtterance("");
        utterance.volume = 0;
        window.speechSynthesis.speak(utterance);
      }
      const audio = new Audio();
      audio.volume = 0;
      audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
      try { await audio.play(); } catch {}
      setTtsUnlocked(true);
    } catch {
      setTtsUnlocked(true);
    }
  }, [ttsUnlocked, initAudioContext]);

  const startListening = useCallback(() => {
    if (isListening || processingRef.current) return;

    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) return;

    try {
      keepListeningRef.current = true;
      const recognition = new SpeechRecognitionAPI();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "fr-FR";

      recognition.onstart = () => {
        setIsListening(true);
        isRecordingRef.current = true;
      };

      recognition.onresult = (event: any) => {
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
        if (finalTranscript) {
          setTranscript(finalTranscript);
        } else if (interimTranscript) {
          setTranscript(interimTranscript);
        }
      };

      recognition.onerror = (event: any) => {
        console.log("Speech recognition error:", event.error);
        if (event.error === "not-allowed") {
          setMicPermission("denied");
        }
      };

      recognition.onend = () => {
        isRecordingRef.current = false;
        if (keepListeningRef.current) {
          try {
            recognition.start();
          } catch {}
        } else {
          setIsListening(false);
        }
      };

      recognition.start();
      browserRecognitionRef.current = recognition;
    } catch (err) {
      console.error("Failed to start speech recognition:", err);
      setIsListening(false);
    }
  }, [isListening]);

  const stopListening = useCallback(() => {
    keepListeningRef.current = false;
    if (browserRecognitionRef.current) {
      try {
        browserRecognitionRef.current.stop();
      } catch {}
      browserRecognitionRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    setIsListening(false);
    isRecordingRef.current = false;
  }, []);

  const speak = useCallback(async (text: string) => {
    if (!text || !ttsSupported) return;

    try {
      setIsSpeaking(true);
      
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text })
      });

      if (response.ok) {
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        currentAudioRef.current = audio;

        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          setIsSpeaking(false);
          currentAudioRef.current = null;
        };

        audio.onerror = () => {
          URL.revokeObjectURL(audioUrl);
          setIsSpeaking(false);
          currentAudioRef.current = null;
          fallbackBrowserTTS(text);
        };

        await audio.play();
      } else {
        fallbackBrowserTTS(text);
      }
    } catch {
      fallbackBrowserTTS(text);
    }
  }, [ttsSupported]);

  const fallbackBrowserTTS = useCallback((text: string) => {
    if (!("speechSynthesis" in window)) {
      setIsSpeaking(false);
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "fr-FR";
    utterance.rate = 1;
    utterance.pitch = 1;

    const voices = window.speechSynthesis.getVoices();
    const frenchVoice = voices.find(v => v.lang.startsWith("fr"));
    if (frenchVoice) utterance.voice = frenchVoice;

    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  }, []);

  const stopSpeaking = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, []);

  return (
    <VoiceContext.Provider
      value={{
        isListening,
        isSpeaking,
        autoSpeak,
        sttSupported,
        ttsSupported,
        ttsUnlocked,
        isIOS,
        micPermission,
        permissionsReady,
        transcript,
        setTranscript,
        startListening,
        stopListening,
        speak,
        stopSpeaking,
        unlockTTS,
        requestMicrophonePermission,
        setAutoSpeak,
        initializeAudio
      }}
    >
      {children}
    </VoiceContext.Provider>
  );
}
