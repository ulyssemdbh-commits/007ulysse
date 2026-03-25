import { useState, useCallback, useRef } from "react";

interface Message {
  id?: number;
  role: "user" | "assistant";
  content: string;
}

interface VoiceReplayState {
  isPlaying: boolean;
  currentIndex: number;
  totalMessages: number;
  currentMessage: string;
  progress: number;
}

interface VoiceReplayResult {
  state: VoiceReplayState;
  playConversation: (messages: Message[], startIndex?: number) => Promise<void>;
  playMessage: (message: Message) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  skipToNext: () => void;
  skipToPrevious: () => void;
}

export function useVoiceReplay(): VoiceReplayResult {
  const [state, setState] = useState<VoiceReplayState>({
    isPlaying: false,
    currentIndex: 0,
    totalMessages: 0,
    currentMessage: "",
    progress: 0,
  });

  const messagesRef = useRef<Message[]>([]);
  const currentIndexRef = useRef(0);
  const isPlayingRef = useRef(false);
  const isPausedRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchAndPlayTTS = useCallback(async (text: string): Promise<void> => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          text: text.substring(0, 4000),
          voice: "onyx",
          speed: 1.0,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error("TTS request failed");
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      currentAudioRef.current = audio;

      return new Promise((resolve, reject) => {
        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          resolve();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(audioUrl);
          reject(new Error("Audio playback failed"));
        };
        audio.play().catch(reject);
      });
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        return;
      }
      throw error;
    }
  }, []);

  const playMessage = useCallback(async (message: Message): Promise<void> => {
    if (message.role !== "assistant") return;

    setState((prev) => ({
      ...prev,
      isPlaying: true,
      currentMessage: message.content.substring(0, 100) + "...",
    }));

    try {
      await fetchAndPlayTTS(message.content);
    } catch (error) {
      console.error("[VoiceReplay] Error playing message:", error);
    } finally {
      setState((prev) => ({
        ...prev,
        isPlaying: false,
        currentMessage: "",
      }));
    }
  }, [fetchAndPlayTTS]);

  const playConversation = useCallback(async (messages: Message[], startIndex: number = 0): Promise<void> => {
    const assistantMessages = messages.filter((m) => m.role === "assistant");
    
    if (assistantMessages.length === 0) return;

    messagesRef.current = assistantMessages;
    currentIndexRef.current = Math.min(startIndex, assistantMessages.length - 1);
    isPlayingRef.current = true;
    isPausedRef.current = false;

    setState({
      isPlaying: true,
      currentIndex: currentIndexRef.current,
      totalMessages: assistantMessages.length,
      currentMessage: "",
      progress: 0,
    });

    while (isPlayingRef.current && currentIndexRef.current < assistantMessages.length) {
      if (isPausedRef.current) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }

      const message = assistantMessages[currentIndexRef.current];
      
      setState((prev) => ({
        ...prev,
        currentIndex: currentIndexRef.current,
        currentMessage: message.content.substring(0, 100) + (message.content.length > 100 ? "..." : ""),
        progress: ((currentIndexRef.current + 1) / assistantMessages.length) * 100,
      }));

      try {
        await fetchAndPlayTTS(message.content);
      } catch (error) {
        console.error("[VoiceReplay] Error playing:", error);
      }

      currentIndexRef.current++;
    }

    isPlayingRef.current = false;
    setState((prev) => ({
      ...prev,
      isPlaying: false,
      currentMessage: "",
      progress: 100,
    }));
  }, [fetchAndPlayTTS]);

  const pause = useCallback(() => {
    isPausedRef.current = true;
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
    }
    setState((prev) => ({ ...prev, isPlaying: false }));
  }, []);

  const resume = useCallback(() => {
    isPausedRef.current = false;
    if (currentAudioRef.current) {
      currentAudioRef.current.play();
    }
    setState((prev) => ({ ...prev, isPlaying: true }));
  }, []);

  const stop = useCallback(() => {
    isPlayingRef.current = false;
    isPausedRef.current = false;
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }

    setState({
      isPlaying: false,
      currentIndex: 0,
      totalMessages: 0,
      currentMessage: "",
      progress: 0,
    });
  }, []);

  const skipToNext = useCallback(() => {
    if (currentIndexRef.current < messagesRef.current.length - 1) {
      currentIndexRef.current++;
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current.currentTime = currentAudioRef.current.duration;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      setState((prev) => ({
        ...prev,
        currentIndex: currentIndexRef.current,
      }));
    }
  }, []);

  const skipToPrevious = useCallback(() => {
    if (currentIndexRef.current > 0) {
      currentIndexRef.current = Math.max(0, currentIndexRef.current - 1);
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current.currentTime = currentAudioRef.current.duration;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      setState((prev) => ({
        ...prev,
        currentIndex: currentIndexRef.current,
      }));
    }
  }, []);

  return {
    state,
    playConversation,
    playMessage,
    pause,
    resume,
    stop,
    skipToNext,
    skipToPrevious,
  };
}
