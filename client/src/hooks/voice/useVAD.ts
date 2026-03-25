import { useState, useCallback, useRef, useEffect } from "react";

export type VADProfile = "default" | "bluetooth" | "ambient" | "quiet" | "continuous";

export interface VADProfileConfig {
  silenceThreshold: number;
  silenceDuration: number;
  speechFramesThreshold: number;
  silenceFramesThreshold: number;
  description: string;
}

export const VAD_PROFILES: Record<VADProfile, VADProfileConfig> = {
  default: {
    silenceThreshold: 0.01,
    silenceDuration: 1500,
    speechFramesThreshold: 3,
    silenceFramesThreshold: 5,
    description: "Configuration standard pour utilisation normale",
  },
  bluetooth: {
    silenceThreshold: 0.008,
    silenceDuration: 1800,
    speechFramesThreshold: 4,
    silenceFramesThreshold: 6,
    description: "Optimisé pour casques/écouteurs Bluetooth (latence plus élevée)",
  },
  ambient: {
    silenceThreshold: 0.025,
    silenceDuration: 1200,
    speechFramesThreshold: 4,
    silenceFramesThreshold: 4,
    description: "Environnement bruyant (bureau, transport)",
  },
  quiet: {
    silenceThreshold: 0.005,
    silenceDuration: 2000,
    speechFramesThreshold: 2,
    silenceFramesThreshold: 7,
    description: "Environnement calme (domicile, nuit)",
  },
  continuous: {
    silenceThreshold: 0.012,
    silenceDuration: 2500,
    speechFramesThreshold: 3,
    silenceFramesThreshold: 8,
    description: "Talking App - écoute continue avec pauses plus longues",
  },
};

interface VADOptions {
  profile?: VADProfile;
  silenceThreshold?: number;
  silenceDuration?: number;
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  onSilenceDetected?: () => void;
  getAudioEnergy?: () => number;
}

interface VADResult {
  isSpeaking: boolean;
  silenceDetected: boolean;
  lastSpeechTime: number;
  startMonitoring: () => void;
  stopMonitoring: () => void;
  isMonitoring: boolean;
  currentProfile: VADProfile;
  setSilenceThreshold: (threshold: number) => void;
  setSilenceDuration: (duration: number) => void;
  setProfile: (profile: VADProfile) => void;
}

export function useVAD(options: VADOptions = {}): VADResult {
  const {
    profile: initialProfile = "default",
    silenceThreshold: customThreshold,
    silenceDuration: customDuration,
    onSpeechStart,
    onSpeechEnd,
    onSilenceDetected,
    getAudioEnergy,
  } = options;

  const profileConfig = VAD_PROFILES[initialProfile];
  const initialThreshold = customThreshold ?? profileConfig.silenceThreshold;
  const initialDuration = customDuration ?? profileConfig.silenceDuration;

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [silenceDetected, setSilenceDetected] = useState(false);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [lastSpeechTime, setLastSpeechTime] = useState(Date.now());
  const [currentProfile, setCurrentProfile] = useState<VADProfile>(initialProfile);

  const silenceThresholdRef = useRef(initialThreshold);
  const silenceDurationRef = useRef(initialDuration);
  const speechFramesThresholdRef = useRef(profileConfig.speechFramesThreshold);
  const silenceFramesThresholdRef = useRef(profileConfig.silenceFramesThreshold);
  const isSpeakingRef = useRef(false);
  const lastSpeechTimeRef = useRef(Date.now());
  const monitorIntervalRef = useRef<number | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const consecutiveSilenceFramesRef = useRef(0);
  const consecutiveSpeechFramesRef = useRef(0);

  const checkVoiceActivity = useCallback(() => {
    if (!getAudioEnergy) return;

    const energy = getAudioEnergy();
    const now = Date.now();

    if (energy > silenceThresholdRef.current) {
      consecutiveSpeechFramesRef.current++;
      consecutiveSilenceFramesRef.current = 0;
      silenceStartRef.current = null;
      setSilenceDetected(false);

      if (consecutiveSpeechFramesRef.current >= speechFramesThresholdRef.current && !isSpeakingRef.current) {
        isSpeakingRef.current = true;
        setIsSpeaking(true);
        lastSpeechTimeRef.current = now;
        setLastSpeechTime(now);
        onSpeechStart?.();
      }

      if (isSpeakingRef.current) {
        lastSpeechTimeRef.current = now;
        setLastSpeechTime(now);
      }
    } else {
      consecutiveSilenceFramesRef.current++;
      consecutiveSpeechFramesRef.current = 0;

      if (isSpeakingRef.current) {
        if (!silenceStartRef.current) {
          silenceStartRef.current = now;
        }

        const silenceDuration = now - silenceStartRef.current;

        if (silenceDuration >= silenceDurationRef.current && 
            consecutiveSilenceFramesRef.current >= silenceFramesThresholdRef.current) {
          isSpeakingRef.current = false;
          setIsSpeaking(false);
          setSilenceDetected(true);
          onSpeechEnd?.();
          onSilenceDetected?.();
          silenceStartRef.current = null;
        }
      }
    }
  }, [getAudioEnergy, onSpeechStart, onSpeechEnd, onSilenceDetected]);

  const startMonitoring = useCallback(() => {
    if (monitorIntervalRef.current) return;

    setIsMonitoring(true);
    consecutiveSilenceFramesRef.current = 0;
    consecutiveSpeechFramesRef.current = 0;
    silenceStartRef.current = null;

    monitorIntervalRef.current = window.setInterval(checkVoiceActivity, 100);
    console.log("[VAD] Started monitoring");
  }, [checkVoiceActivity]);

  const stopMonitoring = useCallback(() => {
    if (monitorIntervalRef.current) {
      clearInterval(monitorIntervalRef.current);
      monitorIntervalRef.current = null;
    }
    setIsMonitoring(false);
    setIsSpeaking(false);
    setSilenceDetected(false);
    isSpeakingRef.current = false;
    consecutiveSilenceFramesRef.current = 0;
    consecutiveSpeechFramesRef.current = 0;
    silenceStartRef.current = null;
    console.log("[VAD] Stopped monitoring");
  }, []);

  const setSilenceThreshold = useCallback((threshold: number) => {
    silenceThresholdRef.current = threshold;
  }, []);

  const setSilenceDuration = useCallback((duration: number) => {
    silenceDurationRef.current = duration;
  }, []);

  const setProfile = useCallback((profile: VADProfile) => {
    const config = VAD_PROFILES[profile];
    silenceThresholdRef.current = config.silenceThreshold;
    silenceDurationRef.current = config.silenceDuration;
    speechFramesThresholdRef.current = config.speechFramesThreshold;
    silenceFramesThresholdRef.current = config.silenceFramesThreshold;
    setCurrentProfile(profile);
    console.log(`[VAD] Profile changed to: ${profile} - ${config.description}`);
  }, []);

  useEffect(() => {
    return () => {
      if (monitorIntervalRef.current) {
        clearInterval(monitorIntervalRef.current);
      }
    };
  }, []);

  return {
    isSpeaking,
    silenceDetected,
    lastSpeechTime,
    startMonitoring,
    stopMonitoring,
    isMonitoring,
    currentProfile,
    setSilenceThreshold,
    setSilenceDuration,
    setProfile,
  };
}
