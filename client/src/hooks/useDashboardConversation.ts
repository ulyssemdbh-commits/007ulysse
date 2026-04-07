import { useState, useRef, useEffect, useCallback } from "react";

interface UseDashboardConversationOptions {
  transcript: string;
  setTranscript: (text: string) => void;
  isSpeaking: boolean;
  isListening: boolean;
  isStreaming: boolean;
  ttsSupported: boolean;
  sttSupported: boolean;
  speak: (text: string) => void;
  stopSpeaking: () => void;
  stopListening: () => void;
  startListening: () => void;
  lastSpokenText: string;
  handleSendMessage: (msg: string) => void;
  handleSendMessageRef: React.MutableRefObject<(msg: string) => void>;
  setOnAutoSubmit: (fn: ((text: string) => void) | null) => void;
  isOwner: boolean;
  personaName: string;
  ttsEndTimeRef: React.MutableRefObject<number>;
}

export function useDashboardConversation({
  transcript, setTranscript, isSpeaking, isListening, isStreaming,
  ttsSupported, sttSupported, speak, stopSpeaking, stopListening, startListening,
  lastSpokenText, handleSendMessage, handleSendMessageRef, setOnAutoSubmit,
  isOwner, personaName, ttsEndTimeRef,
}: UseDashboardConversationOptions) {
  const [conversationMode, setConversationMode] = useState(false);
  const pendingVoiceMessageRef = useRef<string>("");
  const manualStopRef = useRef(false);
  const wasListeningBeforeTTSRef = useRef<boolean>(false);

  useEffect(() => {
    if (!transcript) return;

    if (isSpeaking) {
      console.log("[EchoBlock] Ignoring transcript while speaking:", transcript.slice(0, 30));
      return;
    }

    const timeSinceTTS = Date.now() - ttsEndTimeRef.current;
    if (timeSinceTTS < 800 && ttsEndTimeRef.current > 0) {
      console.log("[EchoBlock] Ignoring transcript during cooldown:", transcript.slice(0, 30));
      setTranscript("");
      pendingVoiceMessageRef.current = "";
      return;
    }

    const lowerTranscript = transcript.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    const ulysseWakeWords = ["hey ulysse", "he ulysse", "eh ulysse", "hey ulisse", "he ulisse", "ulysse", "ulisse", "hey ulis", "he ulis", "eh ulis", "ulis"];
    const irisWakeWords = ["hey iris", "he iris", "eh iris", "iris"];
    const wakeWords = isOwner ? ulysseWakeWords : irisWakeWords;

    console.log("Transcript received:", transcript);

    const isPauseCommand = lowerTranscript.includes("on reprend plus tard") ||
                           lowerTranscript.includes("on reprends plus tard");

    if (isPauseCommand) {
      console.log("Pause command - deactivating mic, keeping speakers");
      stopListening();
      manualStopRef.current = true;
      setConversationMode(false);
      setTranscript("");
      pendingVoiceMessageRef.current = "";
      if (ttsSupported) {
        const response = isOwner ? "OK Maurice, je reste à l'écoute. Dis Hey Ulysse quand tu veux reprendre !" : "D'accord, à bientôt !";
        speak(response);
      }
      return;
    }

    const isOverCommand = lowerTranscript.trim() === "over" || 
                          lowerTranscript.endsWith(" over") ||
                          lowerTranscript.includes("over.");

    if (isOverCommand) {
      console.log("Over command - deactivating mic AND speakers");
      stopSpeaking();
      stopListening();
      manualStopRef.current = true;
      setConversationMode(false);
      setTranscript("");
      pendingVoiceMessageRef.current = "";
      return;
    }

    const hasWakeWord = wakeWords.some(wake => lowerTranscript.includes(wake));

    if (hasWakeWord && !conversationMode) {
      console.log(`Starting conversation mode via wake word (${personaName})`);
      setConversationMode(true);

      let command = transcript;
      for (const wake of wakeWords) {
        const idx = lowerTranscript.indexOf(wake);
        if (idx !== -1) {
          command = transcript.slice(idx + wake.length).trim();
          break;
        }
      }

      if (command.trim()) {
        setTranscript("");
        handleSendMessage(command);
      } else {
        setTranscript("");
        if (ttsSupported) {
          const greeting = isOwner ? "Oui Maurice, je t'écoute !" : "Oui, je vous écoute !";
          speak(greeting);
        }
      }
    } else if (conversationMode) {
      pendingVoiceMessageRef.current = transcript;
    } else if (isListening && transcript.trim().length > 2) {
      console.log("Direct voice message (mic active):", transcript);
      pendingVoiceMessageRef.current = transcript;
      setConversationMode(true);
    }
  }, [transcript, conversationMode, ttsSupported, speak, isSpeaking, stopSpeaking, isListening, isOwner, personaName]);

  useEffect(() => {
    if (conversationMode && pendingVoiceMessageRef.current && !isStreaming) {
      const timer = setTimeout(() => {
        const message = pendingVoiceMessageRef.current;
        if (message.trim() && message.length > 2) {
          pendingVoiceMessageRef.current = "";
          setTranscript("");
          handleSendMessage(message);
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [transcript, conversationMode, isStreaming]);

  useEffect(() => {
    setOnAutoSubmit((text: string) => {
      console.log("[Dashboard] 'À toi' triggered auto-submit:", text.slice(0, 30));
      setConversationMode(true);
      handleSendMessageRef.current(text);
    });
    return () => setOnAutoSubmit(null);
  }, [setOnAutoSubmit]);

  useEffect(() => {
    if (isSpeaking) {
      if (isListening) {
        console.log("[EchoFix] Stopping mic while Ulysse speaks");
        wasListeningBeforeTTSRef.current = true;
        stopListening();
      }
      pendingVoiceMessageRef.current = "";
      setTranscript("");
    } else {
      ttsEndTimeRef.current = Date.now();
    }
  }, [isSpeaking, isListening, stopListening]);

  useEffect(() => {
    if (!isSpeaking && conversationMode && sttSupported && !isListening && !isStreaming && !manualStopRef.current) {
      const timeSinceTTSEnd = Date.now() - ttsEndTimeRef.current;
      const cooldown = Math.max(0, 1500 - timeSinceTTSEnd);

      const timer = setTimeout(() => {
        if (!isSpeaking && !isListening && !manualStopRef.current) {
          console.log("[EchoFix] Restarting mic after TTS cooldown");
          startListening();
        }
      }, cooldown);
      return () => clearTimeout(timer);
    }
  }, [conversationMode, sttSupported, isListening, isStreaming, isSpeaking, startListening]);

  const isEchoOfTTS = useCallback((text: string): boolean => {
    if (!lastSpokenText) return false;

    const normalizedTranscript = text.toLowerCase().trim().replace(/[.,!?'"]/g, "");
    const normalizedSpoken = lastSpokenText.toLowerCase().replace(/[.,!?'"]/g, "");

    const transcriptWords = normalizedTranscript.split(/\s+/).filter(w => w.length >= 3);
    const spokenWords = normalizedSpoken.split(/\s+/).filter(w => w.length >= 3);

    if (transcriptWords.length === 0) return false;

    let matchCount = 0;
    for (const word of transcriptWords) {
      if (spokenWords.some(sw => sw.includes(word) || word.includes(sw))) {
        matchCount++;
      }
    }

    const matchRatio = matchCount / transcriptWords.length;
    return matchRatio > 0.4;
  }, [lastSpokenText]);

  useEffect(() => {
    const timeSinceTTSEnd = Date.now() - ttsEndTimeRef.current;
    if (timeSinceTTSEnd < 1500 && transcript) {
      if (isEchoOfTTS(transcript)) {
        console.log("[EchoFix] Ignoring echo transcript:", transcript.slice(0, 40));
        setTranscript("");
        pendingVoiceMessageRef.current = "";
        return;
      }
    }
  }, [transcript, isEchoOfTTS]);

  return {
    conversationMode,
    setConversationMode,
    manualStopRef,
    pendingVoiceMessageRef,
  };
}
