import { useState, useCallback, useRef, useEffect } from "react";
import type { PermissionState, SpeechRecognition, SpeechRecognitionEvent } from "./types";
import defaultVoiceAPI, { VoiceAPI } from "./voiceAPI";

interface STTOptions {
  onTranscript?: (text: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  onListeningChange?: (listening: boolean) => void;
  initAudioContext?: () => Promise<unknown>;
  resumeAudioContext?: () => Promise<void>;
  connectInputStream?: (stream: MediaStream) => void;
  voiceAPI?: VoiceAPI;
}

interface STTResult {
  isListening: boolean;
  isProcessing: boolean;
  transcript: string;
  sttSupported: boolean;
  micPermission: PermissionState;
  permissionsReady: boolean;
  isIOS: boolean;
  degradedMode: boolean;
  startListening: () => Promise<void>;
  stopListening: () => void;
  requestMicrophonePermission: () => Promise<boolean>;
  setTranscript: (text: string) => void;
}

export function useSpeechToText(options: STTOptions = {}): STTResult {
  const {
    onTranscript,
    onError,
    onListeningChange,
    initAudioContext,
    resumeAudioContext,
    connectInputStream,
    voiceAPI = defaultVoiceAPI,
  } = options;

  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [sttSupported, setSttSupported] = useState(true);
  const [micPermission, setMicPermission] = useState<PermissionState>("prompt");
  const [permissionsReady, setPermissionsReady] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [degradedMode, setDegradedMode] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const browserRecognitionRef = useRef<SpeechRecognition | null>(null);
  const recognitionSessionIdRef = useRef<number>(0);
  const isRecordingRef = useRef(false);
  const processingRef = useRef(false);
  const keepListeningRef = useRef(true);
  const restartTimeoutRef = useRef<number | null>(null);
  const restartAttemptsRef = useRef<number>(0);
  const silenceTimeoutRef = useRef<number | null>(null);
  const silenceTimeoutForIOSRef = useRef<number | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const abortControllerRef = useRef<AbortController | null>(null);
  const failureCountRef = useRef<number>(0);

  useEffect(() => {
    const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIOS(isiOS);

    const handleVisibilityChange = () => {
      if (document.hidden && isiOS) {
        if (browserRecognitionRef.current) {
          try {
            browserRecognitionRef.current.abort();
            browserRecognitionRef.current = null;
          } catch (e) {}
        }
        keepListeningRef.current = false;
        isRecordingRef.current = false;
        setIsListening(false);
        onListeningChange?.(false);
        console.log("[STT] iOS: Stopped recognition due to visibility change");
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [onListeningChange]);

  const requestMicrophonePermission = useCallback(async (): Promise<boolean> => {
    const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

    try {
      const constraints: MediaStreamConstraints = {
        audio: isiOS
          ? { echoCancellation: true, noiseSuppression: true }
          : { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 16000 },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      await initAudioContext?.();
      connectInputStream?.(stream);

      setMicPermission("granted");
      setPermissionsReady(true);
      console.log("[STT] Microphone permission granted");
      return true;
    } catch (err: unknown) {
      console.error("[STT] Microphone permission error:", err);
      const error = err as Error & { name?: string };
      if (error.name === "NotAllowedError") {
        setMicPermission("denied");
        onError?.("not-allowed");
      } else {
        setMicPermission("unavailable");
        onError?.("audio-capture");
      }
      return false;
    }
  }, [initAudioContext, connectInputStream, onError]);

  const sendAudioToWhisper = useCallback(async (audioBlob: Blob): Promise<string> => {
    try {
      setIsProcessing(true);
      abortControllerRef.current = new AbortController();

      const transcript = await voiceAPI.stt(
        { audio: audioBlob, language: "fr" },
        abortControllerRef.current.signal
      );

      setIsProcessing(false);
      abortControllerRef.current = null;
      failureCountRef.current = 0;
      return transcript;
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        console.log("[STT] Request cancelled");
      } else {
        console.error("[STT] Whisper error:", error);
        failureCountRef.current++;
        if (failureCountRef.current >= 3) {
          setDegradedMode(true);
          onError?.("ios-degraded");
        }
      }
      setIsProcessing(false);
      abortControllerRef.current = null;
      return "";
    }
  }, [onError, voiceAPI]);

  const processTranscriptResult = useCallback((text: string, isFinal: boolean) => {
    if (!text.trim()) return;
    setTranscript(text);
    onTranscript?.(text, isFinal);
  }, [onTranscript]);

  const startBrowserRecognition = useCallback((): boolean => {
    if (document.hidden) {
      console.log("[STT] Document is hidden, skipping start");
      return false;
    }

    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      console.log("[STT] Speech recognition not supported");
      setSttSupported(false);
      setIsListening(false);
      return false;
    }

    const isiOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);

    if (isiOSDevice && !window.isSecureContext) {
      console.error("[STT] iOS: Speech recognition requires HTTPS");
      setSttSupported(false);
      return false;
    }

    recognitionSessionIdRef.current += 1;
    const currentSessionId = recognitionSessionIdRef.current;

    try {
      const recognition = new SpeechRecognitionClass();
      recognition.continuous = !isiOSDevice;
      recognition.interimResults = true;
      recognition.lang = "fr-FR";
      browserRecognitionRef.current = recognition;

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        if (silenceTimeoutForIOSRef.current) {
          clearTimeout(silenceTimeoutForIOSRef.current);
        }

        let finalTranscript = "";
        let interimTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            finalTranscript += result[0].transcript;
          } else {
            interimTranscript += result[0].transcript;
          }
        }

        if (finalTranscript.trim()) {
          processTranscriptResult(finalTranscript, true);
        } else if (interimTranscript.trim()) {
          processTranscriptResult(interimTranscript, false);
        }

        if (isiOSDevice && (interimTranscript || finalTranscript)) {
          silenceTimeoutForIOSRef.current = window.setTimeout(() => {
            if (browserRecognitionRef.current && isRecordingRef.current) {
              try {
                browserRecognitionRef.current.stop();
              } catch (e) {}
            }
          }, 2000);
        }
      };

      recognition.onerror = (event: Event & { error?: string }) => {
        const errorType = event.error || "unknown";
        console.error("[STT] Recognition error:", errorType);

        if (silenceTimeoutForIOSRef.current) {
          clearTimeout(silenceTimeoutForIOSRef.current);
          silenceTimeoutForIOSRef.current = null;
        }

        isRecordingRef.current = false;
        setIsListening(false);
        onListeningChange?.(false);

        if (errorType === "not-allowed") {
          setMicPermission("denied");
          setSttSupported(false);
          keepListeningRef.current = false;
          onError?.("not-allowed");
        } else if (errorType === "audio-capture") {
          setMicPermission("unavailable");
          keepListeningRef.current = false;
          onError?.("audio-capture");
        } else if (errorType === "network") {
          onError?.("network");
        } else if (errorType !== "no-speech" && errorType !== "aborted") {
          keepListeningRef.current = false;
        }
      };

      recognition.onend = () => {
        if (currentSessionId !== recognitionSessionIdRef.current) {
          return;
        }

        if (silenceTimeoutForIOSRef.current) {
          clearTimeout(silenceTimeoutForIOSRef.current);
          silenceTimeoutForIOSRef.current = null;
        }

        isRecordingRef.current = false;
        setIsListening(false);
        onListeningChange?.(false);

        if (keepListeningRef.current) {
          restartAttemptsRef.current++;
          const baseDelay = isiOSDevice ? 300 : 200;
          const backoffDelay = Math.min(baseDelay * Math.pow(1.5, restartAttemptsRef.current - 1), 5000);
          restartTimeoutRef.current = window.setTimeout(() => {
            if (keepListeningRef.current && currentSessionId === recognitionSessionIdRef.current) {
              startBrowserRecognition();
            }
          }, backoffDelay);
        }
      };

      recognition.start();
      isRecordingRef.current = true;
      setIsListening(true);
      onListeningChange?.(true);
      restartAttemptsRef.current = 0;

      if (isiOSDevice) {
        silenceTimeoutForIOSRef.current = window.setTimeout(() => {
          if (browserRecognitionRef.current && isRecordingRef.current) {
            try {
              browserRecognitionRef.current.stop();
            } catch (e) {}
          }
        }, 5000);
      }

      return true;
    } catch (err) {
      console.error("[STT] Failed to start recognition:", err);
      setIsListening(false);
      return false;
    }
  }, [processTranscriptResult, onError, onListeningChange]);

  const startListening = useCallback(async () => {
    if (processingRef.current) {
      console.log("[STT] Still processing previous audio");
      return;
    }

    keepListeningRef.current = false;

    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }

    if (browserRecognitionRef.current) {
      try {
        browserRecognitionRef.current.abort();
      } catch (e) {}
      browserRecognitionRef.current = null;
    }
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    isRecordingRef.current = false;

    if (isIOS) {
      await resumeAudioContext?.();
    }

    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognitionClass) {
      keepListeningRef.current = true;
      const started = startBrowserRecognition();
      if (started) return;
      if (isIOS) {
        keepListeningRef.current = false;
        return;
      }
    }

    if (typeof MediaRecorder === "undefined") {
      setSttSupported(false);
      return;
    }

    if (!streamRef.current) {
      await requestMicrophonePermission();
      if (!streamRef.current) return;
    }

    keepListeningRef.current = true;
    isRecordingRef.current = true;
    setIsListening(true);
    onListeningChange?.(true);
    audioChunksRef.current = [];
    lastActivityRef.current = Date.now();

    try {
      const supportedTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/wav", ""];
      let mimeType = "";
      for (const type of supportedTypes) {
        if (!type || MediaRecorder.isTypeSupported(type)) {
          mimeType = type;
          break;
        }
      }

      const recorderOptions: MediaRecorderOptions = mimeType ? { mimeType } : {};
      const mediaRecorder = new MediaRecorder(streamRef.current, recorderOptions);
      mediaRecorderRef.current = mediaRecorder;

      const actualMimeType = mediaRecorder.mimeType || mimeType || "audio/webm";
      let totalDataSize = 0;
      const recordingStartTime = Date.now();

      mediaRecorder.ondataavailable = (event) => {
        totalDataSize += event.data.size;
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
          lastActivityRef.current = Date.now();
        }
      };

      mediaRecorder.onstop = async () => {
        isRecordingRef.current = false;

        if (audioChunksRef.current.length > 0 && !processingRef.current) {
          const audioBlob = new Blob(audioChunksRef.current, { type: actualMimeType });
          audioChunksRef.current = [];

          if (audioBlob.size > 500) {
            processingRef.current = true;
            const transcriptResult = await sendAudioToWhisper(audioBlob);
            processingRef.current = false;

            if (transcriptResult.trim()) {
              processTranscriptResult(transcriptResult, true);
            }
          }
        }

        if (keepListeningRef.current && streamRef.current && !isRecordingRef.current) {
          if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
          restartTimeoutRef.current = window.setTimeout(() => {
            if (keepListeningRef.current) {
              startListening();
            }
          }, 100);
        }
      };

      const isiOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);

      if (isiOSDevice) {
        mediaRecorder.start();
      } else {
        mediaRecorder.start(250);
      }

      if (silenceTimeoutRef.current) clearInterval(silenceTimeoutRef.current);

      let noDataWarned = false;
      let requestDataInterval: number | null = null;

      if (isiOSDevice) {
        requestDataInterval = window.setInterval(() => {
          if (mediaRecorder.state === "recording") {
            try {
              mediaRecorder.requestData();
            } catch (e) {}
          }
        }, 500);
      }

      silenceTimeoutRef.current = window.setInterval(() => {
        const elapsed = Date.now() - recordingStartTime;
        const timeSinceActivity = Date.now() - lastActivityRef.current;

        if (elapsed > 2000 && totalDataSize === 0 && !noDataWarned) {
          noDataWarned = true;
          console.warn("[STT] No audio data after 2s - iOS MediaRecorder may not be working");
          setDegradedMode(true);
        }

        if (timeSinceActivity > 2500 && mediaRecorder.state === "recording" && !processingRef.current) {
          if (requestDataInterval) clearInterval(requestDataInterval);
          mediaRecorder.stop();
        }
      }, 300);
    } catch (err) {
      console.error("[STT] MediaRecorder error:", err);
      isRecordingRef.current = false;
      setIsListening(false);
      onListeningChange?.(false);
      if (!isIOS) {
        startBrowserRecognition();
      }
    }
  }, [requestMicrophonePermission, sendAudioToWhisper, processTranscriptResult, startBrowserRecognition, isIOS, resumeAudioContext, onListeningChange]);

  const stopListening = useCallback(() => {
    keepListeningRef.current = false;
    isRecordingRef.current = false;
    processingRef.current = false;

    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }

    if (silenceTimeoutRef.current) {
      clearInterval(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }

    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;

    if (browserRecognitionRef.current) {
      try {
        browserRecognitionRef.current.abort();
      } catch (e) {}
      browserRecognitionRef.current = null;
    }

    setIsListening(false);
    onListeningChange?.(false);
    audioChunksRef.current = [];
  }, [onListeningChange]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return {
    isListening,
    isProcessing,
    transcript,
    sttSupported,
    micPermission,
    permissionsReady,
    isIOS,
    degradedMode,
    startListening,
    stopListening,
    requestMicrophonePermission,
    setTranscript,
  };
}
