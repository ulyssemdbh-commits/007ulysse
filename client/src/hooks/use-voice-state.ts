import { useState, useCallback, useRef } from "react";

export type VoiceState = "idle" | "listening" | "thinking" | "speaking" | "wakeword";

interface VoiceStateConfig {
  enableHaptics?: boolean;
}

export function useVoiceState(config: VoiceStateConfig = {}) {
  const { enableHaptics = true } = config;

  const [state, setState] = useState<VoiceState>("idle");
  const [partialTranscript, setPartialTranscript] = useState("");
  const [wakeWordActive, setWakeWordActive] = useState(false);
  const lastStateChange = useRef<number>(Date.now());

  const isIOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);

  const triggerHaptic = useCallback((type: "light" | "medium" | "heavy" | "success" | "error") => {
    if (!enableHaptics) return;
    
    try {
      if ("vibrate" in navigator) {
        const patterns: Record<string, number | number[]> = {
          light: 10,
          medium: 25,
          heavy: 50,
          success: [10, 50, 10],
          error: [50, 30, 50]
        };
        navigator.vibrate(patterns[type]);
      }
    } catch {
    }
  }, [enableHaptics]);

  const transition = useCallback((newState: VoiceState) => {
    const now = Date.now();
    const timeSinceLastChange = now - lastStateChange.current;
    
    if (timeSinceLastChange < 50 && state === newState) return;
    
    lastStateChange.current = now;
    setState(newState);

    switch (newState) {
      case "listening":
        triggerHaptic("light");
        break;
      case "thinking":
        triggerHaptic("medium");
        break;
      case "speaking":
        triggerHaptic("success");
        break;
      case "wakeword":
        setWakeWordActive(true);
        triggerHaptic("light");
        setTimeout(() => setWakeWordActive(false), 1500);
        break;
      case "idle":
        setWakeWordActive(false);
        break;
    }
  }, [state, triggerHaptic]);

  const startListening = useCallback(() => {
    transition("listening");
  }, [transition]);

  const startThinking = useCallback(() => {
    setPartialTranscript("");
    transition("thinking");
  }, [transition]);

  const startSpeaking = useCallback(() => {
    transition("speaking");
  }, [transition]);

  const goIdle = useCallback(() => {
    setPartialTranscript("");
    transition("idle");
  }, [transition]);

  const triggerWakeWord = useCallback(() => {
    transition("wakeword");
  }, [transition]);

  const updatePartialTranscript = useCallback((text: string) => {
    setPartialTranscript(text);
  }, []);

  const interruptSpeaking = useCallback(() => {
    if (state === "speaking") {
      triggerHaptic("light");
      transition("idle");
      return true;
    }
    return false;
  }, [state, transition, triggerHaptic]);

  return {
    state,
    partialTranscript,
    isIOS,
    startListening,
    startThinking,
    startSpeaking,
    goIdle,
    updatePartialTranscript,
    interruptSpeaking,
    triggerHaptic,
    triggerWakeWord,
    wakeWordActive,
    isListening: state === "listening",
    isThinking: state === "thinking",
    isSpeaking: state === "speaking",
    isWakeWord: state === "wakeword",
    isIdle: state === "idle"
  };
}
