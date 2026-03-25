import { useState, useEffect, useMemo } from "react";

export type OrbState = "idle" | "listening" | "thinking" | "streaming" | "speaking";

interface UseOrbStateOptions {
  isListening: boolean;
  isThinking: boolean;
  isStreaming: boolean;
  isSpeaking: boolean;
}

export function useOrbState(options: UseOrbStateOptions) {
  const { isListening, isThinking, isStreaming, isSpeaking } = options;
  const [activityDots, setActivityDots] = useState("");

  const orbState = useMemo((): OrbState => {
    if (isListening) return "listening";
    if (isStreaming) return "streaming";
    if (isThinking) return "thinking";
    if (isSpeaking) return "speaking";
    return "idle";
  }, [isListening, isThinking, isStreaming, isSpeaking]);

  useEffect(() => {
    if (orbState !== "idle") {
      const interval = setInterval(() => {
        setActivityDots(prev => prev.length >= 3 ? "" : prev + ".");
      }, 400);
      return () => clearInterval(interval);
    } else {
      setActivityDots("");
    }
  }, [orbState]);

  return {
    orbState,
    activityDots,
  };
}
