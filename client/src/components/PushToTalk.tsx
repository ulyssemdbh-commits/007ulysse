import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PushToTalkProps {
  onTranscript: (text: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "default" | "lg" | "icon";
}

type RecordingState = "idle" | "recording" | "processing" | "error";

export function PushToTalk({
  onTranscript,
  onStart,
  onEnd,
  disabled = false,
  className,
  size = "icon",
}: PushToTalkProps) {
  const [state, setState] = useState<RecordingState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const touchStartRef = useRef<number>(0);
  const minRecordingMs = 500;

  const isIOS = typeof navigator !== "undefined" && 
    /iPad|iPhone|iPod/.test(navigator.userAgent);

  const cleanup = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {
        console.log("[PTT] Error stopping recorder:", e);
      }
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
  }, []);

  const processAudio = useCallback(async (audioBlob: Blob) => {
    if (audioBlob.size < 1000) {
      console.log("[PTT] Audio too short, ignoring");
      setState("idle");
      return;
    }

    setState("processing");
    
    try {
      const formData = new FormData();
      
      // Determine correct file extension based on actual mimeType
      const mimeType = audioBlob.type || "audio/webm";
      let extension = "webm";
      if (mimeType.includes("mp4") || mimeType.includes("m4a")) {
        extension = "m4a";
      } else if (mimeType.includes("ogg")) {
        extension = "ogg";
      } else if (mimeType.includes("wav")) {
        extension = "wav";
      } else if (mimeType.includes("mp3") || mimeType.includes("mpeg")) {
        extension = "mp3";
      }
      
      formData.append("audio", audioBlob, `recording.${extension}`);
      formData.append("mimeType", mimeType);
      
      const response = await fetch("/api/voice/stt", {
        method: "POST",
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error(`STT failed: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Server returns 'transcript', not 'text'
      const transcriptText = data.transcript || data.text || "";
      if (transcriptText.trim()) {
        onTranscript(transcriptText.trim());
      }
    } catch (error) {
      console.error("[PTT] Processing error:", error);
      setErrorMessage("Erreur de transcription");
      setTimeout(() => setErrorMessage(null), 2000);
    } finally {
      setState("idle");
    }
  }, [onTranscript]);

  const startRecording = useCallback(async () => {
    if (disabled || state !== "idle") return;
    
    cleanup();
    setErrorMessage(null);
    touchStartRef.current = Date.now();
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      
      streamRef.current = stream;
      
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : MediaRecorder.isTypeSupported("audio/mp4")
            ? "audio/mp4"
            : "";
      
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { 
          type: mimeType || "audio/webm" 
        });
        
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
        
        const recordingDuration = Date.now() - touchStartRef.current;
        if (recordingDuration >= minRecordingMs) {
          processAudio(audioBlob);
        } else {
          setState("idle");
        }
      };
      
      recorder.onerror = (event) => {
        console.error("[PTT] Recorder error:", event);
        setState("error");
        setErrorMessage("Erreur d'enregistrement");
        cleanup();
        setTimeout(() => {
          setState("idle");
          setErrorMessage(null);
        }, 2000);
      };
      
      if (isIOS) {
        recorder.start(100);
      } else {
        recorder.start();
      }
      
      setState("recording");
      onStart?.();
      
    } catch (error: any) {
      console.error("[PTT] Start error:", error);
      setState("error");
      
      if (error.name === "NotAllowedError") {
        setErrorMessage("Micro non autorisé");
      } else if (error.name === "NotFoundError") {
        setErrorMessage("Micro introuvable");
      } else {
        setErrorMessage("Erreur micro");
      }
      
      setTimeout(() => {
        setState("idle");
        setErrorMessage(null);
      }, 2000);
    }
  }, [disabled, state, cleanup, processAudio, onStart, isIOS]);

  const stopRecording = useCallback(() => {
    if (state !== "recording") return;
    
    onEnd?.();
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {
        console.log("[PTT] Error stopping:", e);
        cleanup();
        setState("idle");
      }
    } else {
      cleanup();
      setState("idle");
    }
  }, [state, cleanup, onEnd]);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && state === "recording") {
        stopRecording();
      }
    };
    
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [state, stopRecording]);

  const handleTouchStart = (e: React.TouchEvent) => {
    startRecording();
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    stopRecording();
  };

  const handleMouseDown = () => {
    startRecording();
  };

  const handleMouseUp = () => {
    stopRecording();
  };

  const handleMouseLeave = () => {
    if (state === "recording") {
      stopRecording();
    }
  };

  return (
    <div className={cn("relative inline-flex flex-col items-center gap-1", className)}>
      <Button
        size={size}
        variant={state === "recording" ? "default" : "outline"}
        disabled={disabled || state === "processing"}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        className={cn(
          "select-none touch-none transition-all duration-200",
          state === "recording" && "bg-red-500 hover:bg-red-600 scale-110 animate-pulse",
          state === "processing" && "opacity-70",
          state === "error" && "bg-destructive"
        )}
        data-testid="button-push-to-talk"
        aria-label={state === "recording" ? "Enregistrement en cours" : "Maintenir pour parler"}
      >
        {state === "processing" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : state === "error" ? (
          <MicOff className="h-4 w-4" />
        ) : (
          <Mic className={cn("h-4 w-4", state === "recording" && "text-white")} />
        )}
      </Button>
      
      {errorMessage && (
        <span className="text-xs text-destructive absolute -bottom-5 whitespace-nowrap">
          {errorMessage}
        </span>
      )}
      
      {state === "recording" && (
        <span className="text-xs text-muted-foreground absolute -bottom-5 whitespace-nowrap">
          Relâcher pour envoyer
        </span>
      )}
    </div>
  );
}
