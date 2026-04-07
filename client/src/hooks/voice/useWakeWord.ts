import { useState, useCallback, useMemo } from "react";

export interface WakeWordConfig {
  wakeWords?: string[];
  enabled?: boolean;
}

interface UseWakeWordResult {
  wakeWordActive: boolean;
  setWakeWordActive: (active: boolean) => void;
  processTranscript: (text: string) => { 
    hasWakeWord: boolean; 
    cleanedText: string; 
    originalText: string;
  };
  wakeWords: string[];
}

const DEFAULT_WAKE_WORDS = [
  "hey ulysse",
  "salut ulysse", 
  "ok ulysse",
  "ulysse",
  "hey ulisse",
  "ulisse",
  "hey iris",
  "salut iris",
  "ok iris",
  "iris"
];

export function useWakeWord(config: WakeWordConfig = {}): UseWakeWordResult {
  const { 
    wakeWords = DEFAULT_WAKE_WORDS,
    enabled = true 
  } = config;
  
  const [wakeWordActive, setWakeWordActive] = useState(false);

  const wakeWordPattern = useMemo(() => {
    const escaped = wakeWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(escaped.join('|'), 'gi');
  }, [wakeWords]);

  const processTranscript = useCallback((text: string): { 
    hasWakeWord: boolean; 
    cleanedText: string; 
    originalText: string;
  } => {
    if (!enabled) {
      return { hasWakeWord: false, cleanedText: text, originalText: text };
    }

    const normalized = text.toLowerCase().trim();
    const hasWakeWord = wakeWords.some(word => normalized.includes(word.toLowerCase()));
    const cleanedText = text.replace(wakeWordPattern, '').trim();

    return {
      hasWakeWord,
      cleanedText,
      originalText: text
    };
  }, [enabled, wakeWords, wakeWordPattern]);

  return {
    wakeWordActive,
    setWakeWordActive,
    processTranscript,
    wakeWords
  };
}
