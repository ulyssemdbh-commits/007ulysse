import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useAudioContextManager } from "./useAudioContextManager";
import { useTextToSpeech } from "./useTextToSpeech";
import { useSpeechToText } from "./useSpeechToText";
import { useEchoGuard } from "./useEchoGuard";
import { useWakeWord } from "./useWakeWord";
import { useVAD } from "./useVAD";
import { createVoiceFSM, VoiceFSM } from "./voiceFSM";
import type { VoiceState, VoiceError, VoiceProfile, PermissionState, VoiceModeStatus, ConversationMode, SpeechRecognition, SpeechRecognitionEvent } from "./types";

interface UseVoiceControllerResult {
  isListening: boolean;
  isSpeaking: boolean;
  isProcessing: boolean;
  transcript: string;
  sttSupported: boolean;
  ttsSupported: boolean;
  voicesLoaded: boolean;
  lastSpokenText: string;
  micPermission: PermissionState;
  permissionsReady: boolean;
  ttsUnlocked: boolean;
  isIOS: boolean;
  wakeWordActive: boolean;
  useOpenAITTS: boolean;
  useBrowserFallback: boolean;
  voiceState: VoiceState;
  voiceError: VoiceError | null;
  voiceModeStatus: VoiceModeStatus;
  conversationMode: ConversationMode;
  isConversationActive: boolean;
  vadIsSpeaking: boolean;
  startListening: () => Promise<void>;
  stopListening: () => void;
  speak: (text: string, profile?: Partial<VoiceProfile>) => Promise<void>;
  stopSpeaking: () => void;
  unlockTTS: () => Promise<boolean>;
  interrupt: () => void;
  requestMicrophonePermission: () => Promise<boolean>;
  cancelOperation: () => void;
  setTranscript: (text: string) => void;
  setWakeWordActive: (active: boolean) => void;
  suspendAudio: () => Promise<void>;
  resumeAudio: () => Promise<void>;
  initializeAudio: () => Promise<boolean>;
  setVoiceProfile: (profile: Partial<VoiceProfile>) => void;
  setConversationMode: (mode: ConversationMode) => void;
  startConversation: () => Promise<void>;
  endConversation: () => void;
  setOnVADSilence: (callback: (() => void) | null) => void;
  setPostTTSCooldown: (ms: number) => void;
  setOnAutoSubmit: (callback: ((transcript: string) => void) | null) => void;
  wakeWordListeningEnabled: boolean;
  enableWakeWordListening: (enabled: boolean) => void;
}

export function useVoiceController(): UseVoiceControllerResult {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceError, setVoiceError] = useState<VoiceError | null>(null);
  const [voicesLoaded, setVoicesLoaded] = useState(true);
  const [conversationMode, setConversationMode] = useState<ConversationMode>("push-to-talk");
  const [isConversationActive, setIsConversationActive] = useState(false);
  const ttsSupported = true;

  const conversationActiveRef = useRef(false);
  const autoRestartTimeoutRef = useRef<number | null>(null);
  const postTTSCooldownRef = useRef(1500);
  const endTriggerFiredRef = useRef(false);

  const wakeWord = useWakeWord();
  const [wakeWordListeningEnabled, setWakeWordListeningEnabled] = useState(false);
  const wakeWordRecognitionRef = useRef<SpeechRecognition | null>(null);
  const wakeWordSessionIdRef = useRef(0);
  const wakeWordTriggeredRef = useRef(false); // Guard against race conditions

  const fsmRef = useRef<VoiceFSM | null>(null);
  if (!fsmRef.current) {
    fsmRef.current = createVoiceFSM();
  }
  const fsm = fsmRef.current;

  useEffect(() => {
    const unsubscribe = fsm.subscribe((ctx) => {
      setVoiceState(ctx.state);
      setVoiceError(ctx.error);
    });
    return unsubscribe;
  }, [fsm]);

  const audioManager = useAudioContextManager();

  const getAudioEnergyRef = useRef(() => {
    return audioManager.getMicEnergy();
  });

  const echoGuard = useEchoGuard({
    getAudioEnergy: () => getAudioEnergyRef.current(),
  });

  const onVADSilenceRef = useRef<(() => void) | null>(null);
  const onAutoSubmitRef = useRef<((transcript: string) => void) | null>(null);

  const handleSilenceDetected = useCallback(() => {
    if (conversationActiveRef.current && conversationMode === "continuous") {
      console.log("[VoiceController] VAD detected end of speech - finalizing transcript");
      const currentTranscript = sttRef.current?.transcript || "";
      sttRef.current?.stopListening();
      
      if (currentTranscript.trim()) {
        console.log("[VoiceController] Auto-submitting transcript:", currentTranscript);
        onAutoSubmitRef.current?.(currentTranscript.trim());
        sttRef.current?.setTranscript("");
      }
      
      onVADSilenceRef.current?.();
    }
  }, [conversationMode]);

  const vad = useVAD({
    getAudioEnergy: () => audioManager.getMicEnergy(),
    silenceThreshold: 0.01,
    silenceDuration: 1500,
    onSilenceDetected: handleSilenceDetected,
    onSpeechStart: () => {
      console.log("[VoiceController] VAD detected speech start");
    },
    onSpeechEnd: () => {
      console.log("[VoiceController] VAD detected speech end - stopping listening for finalization");
    },
  });

  const onSpeakingStart = useCallback((text: string) => {
    fsm.transition({ type: "START_SPEAKING" });
    echoGuard.setIsSpeaking(true);
    echoGuard.setLastSpokenText(text);
    echoGuard.setTTSStartTime();
    
    // Stop STT and VAD during TTS to prevent echo feedback
    sttRef.current?.stopListening();
    vad.stopMonitoring();
    console.log("[VoiceController] Paused STT/VAD during TTS playback");
    
    if (autoRestartTimeoutRef.current) {
      clearTimeout(autoRestartTimeoutRef.current);
      autoRestartTimeoutRef.current = null;
    }
  }, [fsm, echoGuard, vad]);

  const onSpeakingEnd = useCallback(() => {
    fsm.transition({ type: "SPEAKING_COMPLETE" });
    echoGuard.setIsSpeaking(false);
    echoGuard.setTTSEndTime();
    
    if (conversationActiveRef.current && conversationMode === "continuous") {
      console.log("[VoiceController] Continuous mode: auto-restart listening after cooldown");
      autoRestartTimeoutRef.current = window.setTimeout(() => {
        if (conversationActiveRef.current) {
          console.log("[VoiceController] Auto-restarting listening and VAD");
          vad.startMonitoring();
          sttRef.current?.startListening();
        }
      }, postTTSCooldownRef.current);
    }
  }, [fsm, echoGuard, conversationMode, vad]);
  
  const sttRef = useRef<ReturnType<typeof useSpeechToText> | null>(null);

  const onTTSError = useCallback((error: string) => {
    fsm.transition({ type: "ERROR", error });
  }, [fsm]);

  const tts = useTextToSpeech({
    connectTTSElement: audioManager.connectTTSElement,
    disconnectTTSSource: audioManager.disconnectTTSSource,
    getAudioEnergy: () => {
      const energy = audioManager.getTtsEnergy();
      if (energy > 0) {
        echoGuard.setTTSEnergyThreshold(energy);
      }
      return energy;
    },
    onSpeakingStart,
    onSpeakingEnd,
    onError: onTTSError,
  });

  const detectEndTrigger = useCallback((text: string): { hasEndTrigger: boolean; cleanedText: string } => {
    const normalizedText = text.toLowerCase().trim();
    const endTriggers = ["à toi", "a toi", "àtoi", "atoi"];
    
    for (const trigger of endTriggers) {
      if (normalizedText.endsWith(trigger)) {
        const cleanedText = text.slice(0, text.toLowerCase().lastIndexOf(trigger)).trim();
        return { hasEndTrigger: true, cleanedText };
      }
      const triggerWithPunctuation = new RegExp(`${trigger}[.,!?;:]*$`, "i");
      if (triggerWithPunctuation.test(normalizedText)) {
        const match = text.match(new RegExp(`(.*)${trigger}[.,!?;:]*$`, "i"));
        if (match) {
          return { hasEndTrigger: true, cleanedText: match[1].trim() };
        }
      }
    }
    return { hasEndTrigger: false, cleanedText: text };
  }, []);

  const onTranscript = useCallback((text: string, isFinal: boolean) => {
    if (echoGuard.shouldFilterTranscript(text)) {
      console.log("[VoiceController] Echo guard filtered transcript");
      return;
    }

    const { hasWakeWord, cleanedText: wakeWordCleanedText } = wakeWord.processTranscript(text);
    let processedText = hasWakeWord ? wakeWordCleanedText : text;

    if (hasWakeWord || wakeWord.wakeWordActive) {
      if (!wakeWord.wakeWordActive) wakeWord.setWakeWordActive(true);
      if (wakeWordCleanedText) {
        processedText = wakeWordCleanedText;
        wakeWord.setWakeWordActive(false);
      }
    }

    stt.setTranscript(processedText);

    if (isFinal) {
      const { hasEndTrigger, cleanedText: endTriggerCleanedText } = detectEndTrigger(processedText);
      
      if (hasEndTrigger && !endTriggerFiredRef.current) {
        endTriggerFiredRef.current = true;
        console.log("[VoiceController] Detected 'à toi' end trigger on final result - stopping and submitting");
        stt.stopListening();
        
        if (endTriggerCleanedText.trim()) {
          stt.setTranscript(endTriggerCleanedText);
          setTimeout(() => {
            onAutoSubmitRef.current?.(endTriggerCleanedText.trim());
            stt.setTranscript("");
            endTriggerFiredRef.current = false;
          }, 50);
        } else {
          endTriggerFiredRef.current = false;
        }
      }
    }
  }, [echoGuard, wakeWord, detectEndTrigger]);

  const onSTTError = useCallback((error: string) => {
    fsm.transition({ type: "ERROR", error });
  }, [fsm]);

  const onListeningChange = useCallback((listening: boolean) => {
    if (listening) {
      fsm.transition({ type: "START_LISTENING" });
      if (conversationMode === "continuous") {
        vad.startMonitoring();
      }
    } else if (fsm.getState() === "listening") {
      fsm.transition({ type: "STOP_LISTENING" });
      vad.stopMonitoring();
    }
  }, [fsm, conversationMode, vad]);

  const stt = useSpeechToText({
    onTranscript,
    onError: onSTTError,
    onListeningChange,
    initAudioContext: audioManager.initAudioContext,
    resumeAudioContext: audioManager.resumeAudio,
    connectInputStream: audioManager.connectInputStream,
  });
  
  useEffect(() => {
    sttRef.current = stt;
  }, [stt]);

  const voiceModeStatus = useMemo((): VoiceModeStatus => {
    if (!stt.sttSupported) return "unavailable";
    if (stt.degradedMode || fsm.isDegraded()) return "degraded";
    return "full";
  }, [stt.sttSupported, stt.degradedMode, fsm]);

  const startListening = useCallback(async () => {
    if (voiceState === "speaking") {
      console.log("[VoiceController] Cannot listen while speaking");
      return;
    }
    await stt.startListening();
  }, [stt, voiceState]);

  const stopListening = useCallback(() => {
    stt.stopListening();
    wakeWord.setWakeWordActive(false);
  }, [stt, wakeWord]);

  const speak = useCallback(async (text: string, profile?: Partial<VoiceProfile>) => {
    await tts.speak(text, profile);
  }, [tts]);

  const stopSpeaking = useCallback(() => {
    tts.stopSpeaking();
    echoGuard.resetEchoGuard();
  }, [tts, echoGuard]);

  const interrupt = useCallback(() => {
    stopSpeaking();
    wakeWord.setWakeWordActive(false);
    fsm.transition({ type: "RESET" });
  }, [stopSpeaking, wakeWord, fsm]);

  const cancelOperation = useCallback(() => {
    stopListening();
    stopSpeaking();
    fsm.transition({ type: "RESET" });
  }, [stopListening, stopSpeaking, fsm]);

  const startConversation = useCallback(async () => {
    console.log("[VoiceController] Starting conversation mode:", conversationMode);
    conversationActiveRef.current = true;
    setIsConversationActive(true);
    await stt.startListening();
    if (conversationMode === "continuous") {
      vad.startMonitoring();
    }
  }, [stt, conversationMode, vad]);

  const endConversation = useCallback(() => {
    console.log("[VoiceController] Ending conversation");
    conversationActiveRef.current = false;
    setIsConversationActive(false);
    vad.stopMonitoring();
    
    if (autoRestartTimeoutRef.current) {
      clearTimeout(autoRestartTimeoutRef.current);
      autoRestartTimeoutRef.current = null;
    }
    
    stt.stopListening();
    tts.stopSpeaking();
    wakeWord.setWakeWordActive(false);
    fsm.transition({ type: "RESET" });
  }, [stt, tts, wakeWord, fsm, vad]);

  const initializeAudio = useCallback(async (): Promise<boolean> => {
    const isiOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
    console.log("[VoiceController] Initializing audio for", isiOSDevice ? "iOS" : "other platform");

    fsm.transition({ type: "UNLOCK" });

    await audioManager.initAudioContext();
    await audioManager.resumeAudio();
    const unlocked = await tts.unlockTTS();

    if (typeof window !== "undefined" && window.speechSynthesis) {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length === 0) {
        await new Promise<void>((resolve) => {
          const onVoicesLoaded = () => {
            window.speechSynthesis.removeEventListener("voiceschanged", onVoicesLoaded);
            setVoicesLoaded(true);
            resolve();
          };
          window.speechSynthesis.addEventListener("voiceschanged", onVoicesLoaded);
          setTimeout(resolve, 1000);
        });
      } else {
        setVoicesLoaded(true);
      }
    }

    if (unlocked) {
      fsm.transition({ type: "UNLOCK_SUCCESS" });
    } else {
      fsm.transition({ type: "UNLOCK_FAIL", error: "tts-failed" });
    }

    console.log("[VoiceController] Audio initialization complete");
    return unlocked;
  }, [audioManager, tts, fsm]);

  // ======================= WAKE WORD ALWAYS-ON LISTENER =======================
  // Lightweight SpeechRecognition session for passive wake word detection
  const startWakeWordListener = useCallback(() => {
    // Don't start if already listening (main STT), speaking, triggered, or document hidden
    if (stt.isListening || tts.isSpeaking || document.hidden || wakeWordTriggeredRef.current) {
      return;
    }

    // Gate on secure context (required for mic on iOS)
    if (!window.isSecureContext) {
      console.log("[WakeWordListener] Not in secure context, cannot access microphone");
      return;
    }

    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      console.log("[WakeWordListener] SpeechRecognition not supported");
      return;
    }

    // Check mic permission before starting (avoid error loops)
    if (stt.micPermission === "denied") {
      console.log("[WakeWordListener] Microphone permission denied");
      return;
    }

    const isiOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
    wakeWordSessionIdRef.current += 1;
    const currentSessionId = wakeWordSessionIdRef.current;

    try {
      const recognition = new SpeechRecognitionClass() as SpeechRecognition;
      recognition.continuous = !isiOSDevice;
      recognition.interimResults = true;
      recognition.lang = "fr-FR";
      wakeWordRecognitionRef.current = recognition;

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }

        const normalizedTranscript = transcript.toLowerCase().trim();
        // Use wake words from useWakeWord hook (consistent with main STT processing)
        const configuredWakeWords = wakeWord.wakeWords;
        
        const detectedWakeWord = configuredWakeWords.some(w => normalizedTranscript.includes(w.toLowerCase()));
        
        if (detectedWakeWord) {
          console.log("[WakeWordListener] Wake word detected! Starting full STT...");
          
          // Set guard to prevent race condition with auto-restart
          wakeWordTriggeredRef.current = true;
          
          // Stop wake word listener
          try {
            recognition.abort();
          } catch (e) {}
          wakeWordRecognitionRef.current = null;
          
          // Set wake word active and start full listening
          wakeWord.setWakeWordActive(true);
          stt.startListening();
        }
      };

      recognition.onerror = (event: Event & { error?: string }) => {
        const errorType = event.error || "unknown";
        if (errorType !== "no-speech" && errorType !== "aborted") {
          console.log("[WakeWordListener] Error:", errorType);
        }
        // On permission error, don't retry
        if (errorType === "not-allowed") {
          setWakeWordListeningEnabled(false);
        }
      };

      recognition.onend = () => {
        if (currentSessionId !== wakeWordSessionIdRef.current) return;
        
        wakeWordRecognitionRef.current = null;
        
        // Don't auto-restart if wake word was triggered (wait for main STT to finish)
        if (wakeWordTriggeredRef.current) {
          return;
        }
        
        // Auto-restart if enabled and not already listening/speaking
        if (wakeWordListeningEnabled && !stt.isListening && !tts.isSpeaking && !document.hidden) {
          setTimeout(() => {
            if (wakeWordListeningEnabled && currentSessionId === wakeWordSessionIdRef.current && !wakeWordTriggeredRef.current) {
              startWakeWordListener();
            }
          }, 300);
        }
      };

      recognition.start();
      console.log("[WakeWordListener] Started passive wake word detection");

      // iOS: auto-stop after 5 seconds to prevent hanging
      if (isiOSDevice) {
        setTimeout(() => {
          if (wakeWordRecognitionRef.current && currentSessionId === wakeWordSessionIdRef.current) {
            try {
              wakeWordRecognitionRef.current.stop();
            } catch (e) {}
          }
        }, 5000);
      }
    } catch (err) {
      console.error("[WakeWordListener] Failed to start:", err);
    }
  }, [stt.isListening, tts.isSpeaking, wakeWord, stt, wakeWordListeningEnabled, stt.micPermission]);

  const stopWakeWordListener = useCallback(() => {
    wakeWordSessionIdRef.current += 1;
    if (wakeWordRecognitionRef.current) {
      try {
        wakeWordRecognitionRef.current.abort();
      } catch (e) {}
      wakeWordRecognitionRef.current = null;
    }
    console.log("[WakeWordListener] Stopped");
  }, []);

  const enableWakeWordListening = useCallback((enabled: boolean) => {
    setWakeWordListeningEnabled(enabled);
    if (enabled) {
      startWakeWordListener();
    } else {
      stopWakeWordListener();
    }
  }, [startWakeWordListener, stopWakeWordListener]);

  // Auto-restart wake word listener when main STT stops (if enabled)
  useEffect(() => {
    if (wakeWordListeningEnabled && !stt.isListening && !tts.isSpeaking) {
      const timeout = setTimeout(() => {
        // Reset the triggered guard when main STT finishes
        wakeWordTriggeredRef.current = false;
        startWakeWordListener();
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [wakeWordListeningEnabled, stt.isListening, tts.isSpeaking, startWakeWordListener]);

  // Pause wake word listener during TTS
  useEffect(() => {
    if (tts.isSpeaking && wakeWordRecognitionRef.current) {
      stopWakeWordListener();
    }
  }, [tts.isSpeaking, stopWakeWordListener]);

  // Handle visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopWakeWordListener();
      } else if (wakeWordListeningEnabled && !stt.isListening && !tts.isSpeaking) {
        setTimeout(startWakeWordListener, 500);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [wakeWordListeningEnabled, stt.isListening, tts.isSpeaking, startWakeWordListener, stopWakeWordListener]);

  useEffect(() => {
    return () => {
      if (autoRestartTimeoutRef.current) {
        clearTimeout(autoRestartTimeoutRef.current);
      }
      stopWakeWordListener();
      cancelOperation();
      audioManager.closeAudioContext();
    };
  }, []);

  return {
    isListening: stt.isListening,
    isSpeaking: tts.isSpeaking,
    isProcessing: stt.isProcessing,
    transcript: stt.transcript,
    sttSupported: stt.sttSupported,
    ttsSupported,
    voicesLoaded,
    lastSpokenText: tts.lastSpokenText,
    micPermission: stt.micPermission,
    permissionsReady: stt.permissionsReady,
    ttsUnlocked: tts.ttsUnlocked,
    isIOS: stt.isIOS,
    wakeWordActive: wakeWord.wakeWordActive,
    useOpenAITTS: tts.useOpenAITTS,
    useBrowserFallback: tts.useBrowserFallback,
    voiceState,
    voiceError,
    voiceModeStatus,
    conversationMode,
    isConversationActive,
    vadIsSpeaking: vad.isSpeaking,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    unlockTTS: tts.unlockTTS,
    interrupt,
    requestMicrophonePermission: stt.requestMicrophonePermission,
    cancelOperation,
    setTranscript: stt.setTranscript,
    setWakeWordActive: wakeWord.setWakeWordActive,
    suspendAudio: audioManager.suspendAudio,
    resumeAudio: audioManager.resumeAudio,
    initializeAudio,
    setVoiceProfile: tts.setVoiceProfile,
    setConversationMode,
    startConversation,
    endConversation,
    setOnVADSilence: (callback: (() => void) | null) => {
      onVADSilenceRef.current = callback;
    },
    setPostTTSCooldown: (ms: number) => {
      postTTSCooldownRef.current = ms;
    },
    setOnAutoSubmit: (callback: ((transcript: string) => void) | null) => {
      onAutoSubmitRef.current = callback;
    },
    wakeWordListeningEnabled,
    enableWakeWordListening,
  };
}
