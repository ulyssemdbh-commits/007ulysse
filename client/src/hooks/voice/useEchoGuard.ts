import { useCallback, useRef } from "react";

interface EchoGuardOptions {
  getAudioEnergy: () => number;
}

interface EchoGuardResult {
  shouldFilterTranscript: (text: string) => boolean;
  setLastSpokenText: (text: string) => void;
  setIsSpeaking: (speaking: boolean) => void;
  setTTSStartTime: () => void;
  setTTSEndTime: () => void;
  setTTSEnergyThreshold: (energy: number) => void;
  resetEchoGuard: () => void;
}

export function useEchoGuard(options: EchoGuardOptions): EchoGuardResult {
  const { getAudioEnergy } = options;
  
  const lastSpokenTextRef = useRef<string>("");
  const isSpeakingRef = useRef<boolean>(false);
  const ttsStartTimeRef = useRef<number>(0);
  const ttsEndTimeRef = useRef<number>(0);
  const ttsEnergyThresholdRef = useRef<number>(0);

  const checkContentSimilarity = useCallback((text: string): boolean => {
    if (!lastSpokenTextRef.current) return false;
    
    const normalized = text.toLowerCase().trim();
    const lastNormalized = lastSpokenTextRef.current.toLowerCase().slice(0, 100);
    
    const words = normalized.split(" ").slice(0, 5);
    const lastWords = lastNormalized.split(" ");
    let matchCount = 0;
    for (const word of words) {
      if (word.length > 3 && lastWords.some((lw) => lw.includes(word))) {
        matchCount++;
      }
    }
    return words.length > 0 && matchCount / words.length > 0.5;
  }, []);

  const isEchoFeedback = useCallback((transcriptEnergy: number): boolean => {
    if (!isSpeakingRef.current) return false;
    
    const BARGE_IN_ENERGY_THRESHOLD = 25;
    const timeSinceTTSEnd = Date.now() - ttsEndTimeRef.current;
    
    // Short cooldown after TTS ends
    if (timeSinceTTSEnd < 300) {
      // Allow barge-in if user speaks loudly
      if (transcriptEnergy > BARGE_IN_ENERGY_THRESHOLD) {
        return false;
      }
      return true;
    }
    
    // Energy-based filtering: only filter if user energy is very low
    if (isSpeakingRef.current && ttsEnergyThresholdRef.current > 0) {
      if (transcriptEnergy < ttsEnergyThresholdRef.current * 0.5 && transcriptEnergy < BARGE_IN_ENERGY_THRESHOLD) {
        return true;
      }
    }
    
    return false;
  }, []);

  // Echo Analysis with scoring system (0 = not echo, 1 = certain echo)
  const analyzeEchoSuspicion = useCallback((text: string): { score: number; reasons: string[] } => {
    const reasons: string[] = [];
    let score = 0;

    if (!isSpeakingRef.current) {
      return { score: 0, reasons };
    }

    const now = Date.now();
    const timeSinceTTSEnd = now - ttsEndTimeRef.current;

    // 1) Cooldown very close to TTS end
    if (timeSinceTTSEnd < 300) {
      score += 0.35;
      reasons.push("cooldown");
    }

    // 2) Content similarity with last spoken text
    if (checkContentSimilarity(text)) {
      score += 0.35;
      reasons.push("content");
    }

    // 3) Energy-based analysis
    const energy = getAudioEnergy();
    if (isEchoFeedback(energy)) {
      score += 0.30;
      reasons.push("energy");
    }

    // Reduce suspicion if energy is high (clear barge-in)
    if (energy > 30) {
      score -= 0.25;
      reasons.push("barge-in");
    }

    // Clamp between 0 and 1
    score = Math.max(0, Math.min(1, score));

    return { score, reasons };
  }, [checkContentSimilarity, getAudioEnergy, isEchoFeedback]);

  const shouldFilterTranscript = useCallback((text: string): boolean => {
    if (!isSpeakingRef.current) return false;

    const { score, reasons } = analyzeEchoSuspicion(text);
    const ECHO_THRESHOLD = 0.75;

    if (score >= ECHO_THRESHOLD) {
      console.log(`[EchoGuard] Filtered: score=${score.toFixed(2)} reasons=${reasons.join("+") || "none"}`);
      return true;
    }
    
    return false;
  }, [analyzeEchoSuspicion]);

  const setLastSpokenText = useCallback((text: string) => {
    lastSpokenTextRef.current = text;
  }, []);

  const setIsSpeaking = useCallback((speaking: boolean) => {
    isSpeakingRef.current = speaking;
  }, []);

  const setTTSStartTime = useCallback(() => {
    ttsStartTimeRef.current = Date.now();
  }, []);

  const setTTSEndTime = useCallback(() => {
    ttsEndTimeRef.current = Date.now();
  }, []);

  const setTTSEnergyThreshold = useCallback((energy: number) => {
    ttsEnergyThresholdRef.current = Math.max(ttsEnergyThresholdRef.current, energy);
  }, []);

  const resetEchoGuard = useCallback(() => {
    lastSpokenTextRef.current = "";
    isSpeakingRef.current = false;
    ttsStartTimeRef.current = 0;
    ttsEndTimeRef.current = 0;
    ttsEnergyThresholdRef.current = 0;
  }, []);

  return {
    shouldFilterTranscript,
    setLastSpokenText,
    setIsSpeaking,
    setTTSStartTime,
    setTTSEndTime,
    setTTSEnergyThreshold,
    resetEchoGuard,
  };
}
