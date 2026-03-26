import { useState, useCallback, useRef, useEffect } from "react";
import type { VoiceProfile } from "./types";
import defaultVoiceAPI, { VoiceAPI } from "./voiceAPI";

interface AudioQueueItem {
  audio: HTMLAudioElement;
  text: string;
}

interface TTSOptions {
  connectTTSElement?: (audio: HTMLAudioElement) => void;
  disconnectTTSSource?: () => void;
  getAudioEnergy?: () => number;
  onSpeakingStart?: (text: string) => void;
  onSpeakingEnd?: () => void;
  onError?: (error: string) => void;
  voiceAPI?: VoiceAPI;
}

interface TTSResult {
  isSpeaking: boolean;
  lastSpokenText: string;
  ttsUnlocked: boolean;
  useOpenAITTS: boolean;
  useBrowserFallback: boolean;
  speak: (text: string, profile?: Partial<VoiceProfile>) => Promise<void>;
  stopSpeaking: () => void;
  unlockTTS: () => Promise<boolean>;
  setVoiceProfile: (profile: Partial<VoiceProfile>) => void;
}

export function useTextToSpeech(options: TTSOptions = {}): TTSResult {
  const {
    connectTTSElement,
    disconnectTTSSource,
    getAudioEnergy,
    onSpeakingStart,
    onSpeakingEnd,
    onError,
    voiceAPI = defaultVoiceAPI,
  } = options;

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [lastSpokenText, setLastSpokenText] = useState("");
  const [ttsUnlocked, setTtsUnlocked] = useState(false);
  const [useOpenAITTS, setUseOpenAITTS] = useState(true);
  const [useBrowserFallback, setUseBrowserFallback] = useState(false);
  const [voiceProfile, setVoiceProfileState] = useState<Partial<VoiceProfile>>({
    voiceId: "onyx",
    rate: 1.0,
    pitch: 1.0,
    gender: "male",
  });

  const audioQueueRef = useRef<AudioQueueItem[]>([]);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const isIOSRef = useRef(false);

  useEffect(() => {
    isIOSRef.current = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (!isIOSRef.current) {
      setTtsUnlocked(true);
    }

    voiceAPI.getStatus()
      .then((data) => {
        if (data.useBrowserFallback) {
          setUseBrowserFallback(true);
          setUseOpenAITTS(false);
        }
      })
      .catch(() => {
        setUseBrowserFallback(true);
        setUseOpenAITTS(false);
      });
  }, [voiceAPI]);

  const unlockTTS = useCallback(async (): Promise<boolean> => {
    if (ttsUnlocked) return true;

    try {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        try {
          const utterance = new SpeechSynthesisUtterance("");
          utterance.volume = 0;
          window.speechSynthesis.speak(utterance);
          window.speechSynthesis.cancel();
        } catch (e) {
          console.log("[TTS] Unlock utterance failed (expected on some iOS):", e);
        }
      }

      const silentAudio = new Audio(
        "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA"
      );
      silentAudio.volume = 0.01;
      await silentAudio.play().catch(() => {});

      setTtsUnlocked(true);
      console.log("[TTS] Unlocked for iOS");
      return true;
    } catch (err) {
      console.error("[TTS] Failed to unlock:", err);
      setTtsUnlocked(true);
      return true;
    }
  }, [ttsUnlocked]);

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
    setIsSpeaking(true);
    currentAudioRef.current = item.audio;
    setLastSpokenText(item.text);
    onSpeakingStart?.(item.text);

    if (connectTTSElement) {
      try {
        connectTTSElement(item.audio);
        if (getAudioEnergy) {
          const measureEnergy = () => {
            if (isSpeakingRef.current) {
              getAudioEnergy();
              requestAnimationFrame(measureEnergy);
            }
          };
          measureEnergy();
        }
      } catch (err) {
        item.audio.volume = 1;
      }
    }

    item.audio.onended = () => {
      revokeAudioUrl(item.audio);
      disconnectTTSSource?.();
      isPlayingRef.current = false;
      currentAudioRef.current = null;

      if (audioQueueRef.current.length === 0) {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        setLastSpokenText("");
        onSpeakingEnd?.();
      } else {
        playNextInQueue();
      }
    };

    item.audio.onerror = () => {
      console.error("[TTS] Audio playback error");
      revokeAudioUrl(item.audio);
      disconnectTTSSource?.();
      isPlayingRef.current = false;
      currentAudioRef.current = null;

      if (audioQueueRef.current.length > 0) {
        playNextInQueue();
      } else {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        onSpeakingEnd?.();
      }
    };

    item.audio.play().catch((err) => {
      console.error("[TTS] Failed to play audio:", err);
      revokeAudioUrl(item.audio);
      disconnectTTSSource?.();
      isPlayingRef.current = false;
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      onError?.("tts-failed");
    });
  }, [revokeAudioUrl, connectTTSElement, disconnectTTSSource, getAudioEnergy, onSpeakingStart, onSpeakingEnd, onError]);

  const fallbackSpeak = useCallback((text: string, profile?: Partial<VoiceProfile>) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      console.log("[TTS] Browser speech synthesis not available");
      return;
    }

    window.speechSynthesis.cancel();

    if (isIOSRef.current) {
      const warmup = new SpeechSynthesisUtterance("");
      warmup.volume = 0;
      window.speechSynthesis.speak(warmup);
      window.speechSynthesis.cancel();
    }

    const maxLength = isIOSRef.current ? 200 : 500;
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
    const rate = profile?.rate ?? voiceProfile.rate ?? 1.0;
    const pitch = profile?.pitch ?? voiceProfile.pitch ?? 1.0;

    const speakNextChunk = () => {
      if (chunkIndex >= chunks.length) {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        setLastSpokenText("");
        onSpeakingEnd?.();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(chunks[chunkIndex]);
      utterance.lang = "fr-FR";
      utterance.rate = rate;
      utterance.pitch = pitch;

      const voices = window.speechSynthesis.getVoices();
      const frenchVoice = voices.find((v) => v.lang.startsWith("fr")) || voices[0];
      if (frenchVoice) utterance.voice = frenchVoice;

      utterance.onstart = () => {
        isSpeakingRef.current = true;
        setIsSpeaking(true);
        setLastSpokenText(chunks[chunkIndex]);
        onSpeakingStart?.(chunks[chunkIndex]);
      };

      utterance.onend = () => {
        chunkIndex++;
        speakNextChunk();
      };

      utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
        isSpeakingRef.current = false;
        if (event.error !== "interrupted" && event.error !== "canceled") {
          console.error("[TTS] Speech synthesis error:", event.error);
        }
        setIsSpeaking(false);
        setLastSpokenText("");
        onSpeakingEnd?.();
      };

      if (isIOSRef.current && chunkIndex > 0) {
        setTimeout(() => window.speechSynthesis.speak(utterance), 100);
      } else {
        window.speechSynthesis.speak(utterance);
      }
    };

    speakNextChunk();
  }, [voiceProfile, onSpeakingStart, onSpeakingEnd]);

  const speak = useCallback(
    async (text: string, profile?: Partial<VoiceProfile>) => {
      if (!text.trim()) return;

      if (isIOSRef.current && !ttsUnlocked) {
        console.warn("[TTS] Not unlocked on iOS");
        return;
      }

      if (useBrowserFallback) {
        fallbackSpeak(text, profile);
        return;
      }

      try {
        const mergedProfile = { ...voiceProfile, ...profile };
        const audioBlob = await voiceAPI.tts({
          text,
          voice: mergedProfile.voiceId || "onyx",
          speed: mergedProfile.rate || 1.0,
        });

        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);

        audio.onloadeddata = () => {
          audioQueueRef.current.push({ audio, text });
          if (!isPlayingRef.current) {
            playNextInQueue();
          }
        };
      } catch (error) {
        console.error("[TTS] Error:", error);
        fallbackSpeak(text, profile);
      }
    },
    [ttsUnlocked, playNextInQueue, useBrowserFallback, fallbackSpeak, voiceProfile]
  );

  const stopSpeaking = useCallback(() => {
    if (currentAudioRef.current) {
      if (currentAudioRef.current.src?.startsWith("blob:")) {
        URL.revokeObjectURL(currentAudioRef.current.src);
      }
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }
    disconnectTTSSource?.();
    audioQueueRef.current.forEach((item) => {
      if (item.audio.src?.startsWith("blob:")) {
        URL.revokeObjectURL(item.audio.src);
      }
    });
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    isSpeakingRef.current = false;
    setIsSpeaking(false);
    setLastSpokenText("");

    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    onSpeakingEnd?.();
  }, [disconnectTTSSource, onSpeakingEnd]);

  const setVoiceProfile = useCallback((profile: Partial<VoiceProfile>) => {
    setVoiceProfileState((prev) => ({ ...prev, ...profile }));
  }, []);

  return {
    isSpeaking,
    lastSpokenText,
    ttsUnlocked,
    useOpenAITTS,
    useBrowserFallback,
    speak,
    stopSpeaking,
    unlockTTS,
    setVoiceProfile,
  };
}
