import { useState, useRef, useCallback, useEffect } from "react";

interface UseVoiceManagerOptions {
  enabled?: boolean;
  onSpeakStart?: () => void;
  onSpeakEnd?: () => void;
}

export function useVoiceManager(options: UseVoiceManagerOptions = {}) {
  const { enabled: initialEnabled = true, onSpeakStart, onSpeakEnd } = options;
  
  const [voiceEnabled, setVoiceEnabled] = useState(() => {
    const saved = localStorage.getItem("ulysse_voice_enabled");
    return saved !== "false" && initialEnabled;
  });
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isContinuousListening, setIsContinuousListening] = useState(false);
  const [continuousTranscript, setContinuousTranscript] = useState("");
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const keepListeningRef = useRef(false);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastTranscriptRef = useRef<string>("");

  const fallbackBrowserTTS = useCallback((text: string, messageId?: string) => {
    if (!("speechSynthesis" in window)) {
      setIsSpeaking(false);
      setSpeakingMessageId(null);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "fr-FR";
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    
    const voices = window.speechSynthesis.getVoices();
    const frenchVoice = voices.find(v => v.lang.startsWith("fr") && v.name.includes("Google")) 
      || voices.find(v => v.lang.startsWith("fr"));
    if (frenchVoice) utterance.voice = frenchVoice;
    
    utterance.onend = () => {
      setIsSpeaking(false);
      setSpeakingMessageId(null);
      onSpeakEnd?.();
    };
    
    utterance.onerror = () => {
      setIsSpeaking(false);
      setSpeakingMessageId(null);
    };
    
    window.speechSynthesis.speak(utterance);
  }, [onSpeakEnd]);

  const speak = useCallback(async (text: string, messageId?: string) => {
    if (!voiceEnabled) return;
    
    keepListeningRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    setIsListening(false);
    setIsContinuousListening(false);
    
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    window.speechSynthesis.cancel();
    
    setIsSpeaking(true);
    if (messageId) setSpeakingMessageId(messageId);
    onSpeakStart?.();

    try {
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
        audioRef.current = audio;

        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          setIsSpeaking(false);
          setSpeakingMessageId(null);
          audioRef.current = null;
          onSpeakEnd?.();
        };

        audio.onerror = () => {
          URL.revokeObjectURL(audioUrl);
          fallbackBrowserTTS(text, messageId);
        };

        await audio.play();
        return;
      }
    } catch {}
    
    fallbackBrowserTTS(text, messageId);
  }, [voiceEnabled, fallbackBrowserTTS, onSpeakStart, onSpeakEnd]);

  const stopSpeaking = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setSpeakingMessageId(null);
  }, []);

  const toggleVoice = useCallback(() => {
    const newValue = !voiceEnabled;
    setVoiceEnabled(newValue);
    localStorage.setItem("ulysse_voice_enabled", String(newValue));
    if (!newValue) stopSpeaking();
  }, [voiceEnabled, stopSpeaking]);

  const startListening = useCallback((onResult: (text: string) => void) => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("[VoiceManager] Speech recognition not supported");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "fr-FR";

    recognition.onresult = (event: any) => {
      let finalTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }
      if (finalTranscript) {
        onResult(finalTranscript);
      }
    };

    recognition.onerror = (event: any) => {
      console.error("[VoiceManager] Recognition error:", event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      if (keepListeningRef.current) {
        try {
          recognition.start();
        } catch {}
      } else {
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;
    setIsListening(true);
    
    try {
      recognition.start();
    } catch (err) {
      console.error("[VoiceManager] Failed to start recognition:", err);
      setIsListening(false);
    }
  }, []);

  const stopListening = useCallback(() => {
    keepListeningRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    setIsListening(false);
    setIsContinuousListening(false);
  }, []);

  useEffect(() => {
    return () => {
      stopSpeaking();
      stopListening();
    };
  }, [stopSpeaking, stopListening]);

  return {
    voiceEnabled,
    setVoiceEnabled,
    isSpeaking,
    speakingMessageId,
    isListening,
    isContinuousListening,
    continuousTranscript,
    speak,
    stopSpeaking,
    toggleVoice,
    startListening,
    stopListening,
    keepListeningRef,
    silenceTimerRef,
    lastTranscriptRef,
    setContinuousTranscript,
    setIsContinuousListening,
    setIsListening,
  };
}
