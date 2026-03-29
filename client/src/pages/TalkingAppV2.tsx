import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Lock, Eye, EyeOff, User, Bluetooth, ChevronUp, ChevronDown, Zap, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { useRealtimeVoice } from "@/hooks/use-realtime-voice";
import { useVoiceSSE } from "@/hooks/voice/useVoiceSSE";
import { useToast } from "@/hooks/use-toast";
import { useRealtimeSync, type TalkingMessage, type TTSRequest } from "@/hooks/useRealtimeSync";
import { useQuery } from "@tanstack/react-query";
import { usePageManifest } from "@/hooks/usePageManifest";
import { cn } from "@/lib/utils";
import { useGeminiLiveCall } from "@/hooks/voice/useGeminiLiveCall";

import { 
  VoiceSessionHeader, 
  DualAudioMeter, 
  ConversationTimeline, 
  VoiceControls, 
  VoiceDevicePanel, 
  ConnectionStatusBanner,
  VoiceDataCard,
  type TimelineMessage,
  type ConversationMode,
  type VoiceCardData
} from "@/components/voice";
import type { VoiceUIAction, VoiceSystemCommand } from "@/hooks/use-realtime-voice";

const triggerHaptic = (style: "light" | "medium" | "heavy" | "success" | "warning" | "error" = "light") => {
  if ("vibrate" in navigator) {
    const patterns: Record<string, number | number[]> = {
      light: 10, medium: 20, heavy: 30,
      success: [10, 50, 10], warning: [20, 100, 20], error: [30, 100, 30, 100, 30],
    };
    navigator.vibrate(patterns[style] || 10);
  }
};

const TALKING_USERS = [
  { id: "maurice", name: "Maurice", username: "Maurice", persona: "ulysse" },
  { id: "kelly", name: "Kelly", username: "KellyIris001", persona: "iris" },
  { id: "lenny", name: "Lenny", username: "LennyIris002", persona: "iris" },
  { id: "micky", name: "Micky", username: "MickyIris003", persona: "iris" },
];

export default function TalkingAppV2() {
  usePageManifest({
    title: "Ulysse Voice Pro",
    manifestPath: "/manifest-talking.json",
    themeColor: "#7c3aed",
    appleTitle: "Ulysse"
  });

  const { user, isLoading: authLoading, isAuthenticated, login } = useAuth();
  const { toast } = useToast();
  
  const { data: conversations } = useQuery<any[]>({
    queryKey: ["/api/conversations"],
    enabled: isAuthenticated,
  });
  
  const mainConversationId = conversations?.find((c: any) => c.title === "Ulysse Hub")?.id || conversations?.[0]?.id;
  
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pinCode, setPinCode] = useState("");
  const [pinStep, setPinStep] = useState<"pin" | "logging">("pin");
  const [pinError, setPinError] = useState(false);
  
  const [isInCall, setIsInCall] = useState(false);
  const [useGeminiMode, setUseGeminiModeRaw] = useState(true);
  const useGeminiModeRef = useRef(true);
  const setUseGeminiMode = useCallback((val: boolean) => {
    useGeminiModeRef.current = val;
    setUseGeminiModeRaw(val);
  }, []);
  const [conversationMode, setConversationMode] = useState<ConversationMode>("continuous");
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const [showDevicePanel, setShowDevicePanel] = useState(false);
  const [selectedInputId, setSelectedInputId] = useState("");
  const [selectedOutputId, setSelectedOutputId] = useState("");
  const [isTestingAudio, setIsTestingAudio] = useState(false);
  const [sinkIdSupported, setSinkIdSupported] = useState(true);
  const [isIOS, setIsIOS] = useState(false);
  const [voiceSecurityEnabled, setVoiceSecurityEnabled] = useState(false);
  const [degradedMode, setDegradedMode] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [showMeters, setShowMeters] = useState(true);
  
  const [messages, setMessages] = useState<TimelineMessage[]>([]);
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [streamingResponse, setStreamingResponse] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [speakerLevel, setSpeakerLevel] = useState(0);
  const [voiceCardData, setVoiceCardData] = useState<VoiceCardData | null>(null);
  
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const sendTalkingMessageRef = useRef<((msg: TalkingMessage) => void) | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const ttsAnalyserRef = useRef<AnalyserNode | null>(null);
  const ttsSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micLevelIntervalRef = useRef<number | null>(null);
  const speakerLevelIntervalRef = useRef<number | null>(null);
  const isResumingListeningRef = useRef(false);
  const currentAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioElementSourceMapRef = useRef<WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>>(new WeakMap());
  
  const handleAudioElement = useCallback((audio: HTMLAudioElement | null) => {
    console.log("[TalkingV2] handleAudioElement called with:", audio ? "audio element" : "null");
    
    if (speakerLevelIntervalRef.current) {
      clearInterval(speakerLevelIntervalRef.current);
      speakerLevelIntervalRef.current = null;
    }
    
    if (ttsSourceRef.current) {
      try { ttsSourceRef.current.disconnect(); } catch {}
      ttsSourceRef.current = null;
    }
    if (ttsAnalyserRef.current) {
      try { ttsAnalyserRef.current.disconnect(); } catch {}
    }
    
    if (!audio) {
      setSpeakerLevel(0);
      currentAudioElementRef.current = null;
      return;
    }
    
    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      console.log("[TalkingV2] No AudioContext for TTS visualization, audio will play normally without visualization");
      setSpeakerLevel(0);
      return;
    }
    
    console.log("[TalkingV2] AudioContext state:", audioContextRef.current.state);
    
    if (audioContextRef.current.state === "suspended") {
      console.log("[TalkingV2] AudioContext suspended - audio will play without visualization to avoid silent playback");
      setSpeakerLevel(0);
      return;
    }
    
    if (audioContextRef.current.state !== "running") {
      console.log("[TalkingV2] AudioContext not running (" + audioContextRef.current.state + ") - audio will play normally");
      setSpeakerLevel(0);
      return;
    }
    
    currentAudioElementRef.current = audio;
    
    try {
      let source = audioElementSourceMapRef.current.get(audio);
      if (!source) {
        source = audioContextRef.current.createMediaElementSource(audio);
        audioElementSourceMapRef.current.set(audio, source);
        console.log("[TalkingV2] Created new MediaElementSource for audio");
      }
      
      const ttsAnalyser = audioContextRef.current.createAnalyser();
      ttsAnalyser.fftSize = 256;
      ttsAnalyser.smoothingTimeConstant = 0.3;
      ttsAnalyserRef.current = ttsAnalyser;
      
      source.connect(ttsAnalyser);
      ttsAnalyser.connect(audioContextRef.current.destination);
      ttsSourceRef.current = source;
      console.log("[TalkingV2] TTS audio connected to destination");
      
      const dataArray = new Uint8Array(ttsAnalyser.frequencyBinCount);
      speakerLevelIntervalRef.current = window.setInterval(() => {
        if (ttsAnalyserRef.current && audio.paused === false) {
          ttsAnalyserRef.current.getByteFrequencyData(dataArray);
          const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
          setSpeakerLevel(avg / 255);
        } else if (audio.paused || audio.ended) {
          setSpeakerLevel(0);
        }
      }, 50);
      
      const cleanup = () => {
        if (speakerLevelIntervalRef.current) {
          clearInterval(speakerLevelIntervalRef.current);
          speakerLevelIntervalRef.current = null;
        }
        if (ttsSourceRef.current) {
          try { ttsSourceRef.current.disconnect(); } catch {}
          ttsSourceRef.current = null;
        }
        if (ttsAnalyserRef.current) {
          try { ttsAnalyserRef.current.disconnect(); } catch {}
          ttsAnalyserRef.current = null;
        }
        setSpeakerLevel(0);
        currentAudioElementRef.current = null;
        audio.removeEventListener('ended', cleanup);
        audio.removeEventListener('pause', cleanup);
      };
      
      audio.addEventListener('ended', cleanup);
      audio.addEventListener('pause', cleanup);
      
    } catch (err) {
      console.warn("[TalkingV2] Could not connect TTS to analyser:", err);
      setSpeakerLevel(0);
    }
  }, []);
  
  const voice = useRealtimeVoice({
    userName: user?.displayName || user?.username || "User",
    conversationId: mainConversationId,
    channel: "talking-v2", // TTS priority: this page gets audio over chat page
    onAudioElement: handleAudioElement,
    onTranscript: (text) => {
      setCurrentTranscript(text);
      sendTalkingMessageRef.current?.({
        id: `voice_user_${Date.now()}`,
        role: "user",
        content: text,
        timestamp: new Date(),
        origin: "voice"
      });
    },
    onResponse: (resp) => {
      setStreamingResponse("");
      setMessages(prev => [...prev, {
        id: `msg_${Date.now()}`,
        role: "assistant",
        content: resp,
        timestamp: new Date(),
        origin: "voice"
      }]);
      sendTalkingMessageRef.current?.({
        id: `voice_assistant_${Date.now()}`,
        role: "assistant",
        content: resp,
        timestamp: new Date(),
        origin: "voice"
      });
    },
    onResponseChunk: (chunk) => {
      setStreamingResponse(prev => prev + chunk);
    },
    onError: (err) => {
      console.error("[TalkingV2] Voice error:", err);
      toast({ title: "Erreur", description: err, variant: "destructive" });
    },
    onAuthenticated: (persona) => {
      toast({ title: `${persona === "ulysse" ? "Ulysse" : "Iris"} est pret` });
      setReconnectAttempts(0);
    },
    onSpeakerVerified: (confidence) => {
      setVoiceSecurityEnabled(true);
    },
    onSpeakerRejected: (message, confidence) => {
      toast({ 
        title: "Voix non reconnue", 
        description: `Je ne reponds qu'a ta voix. (${(confidence * 100).toFixed(0)}%)`,
        variant: "destructive" 
      });
    },
    onVerificationSkipped: (reason, error) => {
      setVoiceSecurityEnabled(false);
      setDegradedMode(true);
    },
    onUIAction: (action: VoiceUIAction) => {
      console.log("[TalkingV2] UI Action:", action);
      
      switch (action.type) {
        case "display_ranking":
          setVoiceCardData({
            type: "ranking",
            ranking: action.data?.ranking?.map((r: any, i: number) => ({
              position: r.position || i + 1,
              team: r.team || r.name || "-",
              points: r.points || 0,
              played: r.played,
              wins: r.wins,
              draws: r.draws,
              losses: r.losses,
            })),
            league: action.data?.league,
          });
          break;
          
        case "display_topscorers":
          setVoiceCardData({
            type: "topscorers",
            scorers: action.data?.scorers?.map((s: any, i: number) => ({
              position: s.position || i + 1,
              name: s.name || s.player || "-",
              team: s.team || "-",
              goals: s.goals || 0,
              assists: s.assists,
            })),
            league: action.data?.league,
          });
          break;
          
        case "display_live_scores":
          setVoiceCardData({
            type: "live_scores",
            matches: action.data?.matches,
          });
          break;
          
        case "display_odds":
          setVoiceCardData({
            type: "odds",
            odds: action.data?.odds,
            team: action.data?.team,
          });
          break;
          
        default:
          console.log("[TalkingV2] Unknown UI action type:", action.type);
      }
    },
    onSystemCommand: (command: VoiceSystemCommand) => {
      console.log("[TalkingV2] System command:", command);
      
      switch (command.command) {
        case "mute_mic":
          setIsMuted(true);
          break;
        case "unmute_mic":
          setIsMuted(false);
          break;
        case "end_call":
          handleEndCall();
          break;
        case "toggle_speaker":
          setIsSpeakerMuted(prev => !prev);
          break;
        default:
          console.log("[TalkingV2] Unknown system command:", command.command);
      }
    },
  });

  const voiceSSE = useVoiceSSE({
    sessionId: voice.sessionId,
    enabled: voice.connectionState === "authenticated",
    onStateChange: (sseState) => {
      console.log("[TalkingV2] SSE state:", sseState);
    },
    onTranscriptFinal: (text) => {
      console.log("[TalkingV2] SSE transcript:", text.substring(0, 50));
    },
    onResponseFull: (text, domain) => {
      console.log("[TalkingV2] SSE full response (domain:", domain, "):", text.substring(0, 50));
    },
    onUIAction: (action, data) => {
      console.log("[TalkingV2] SSE UI action:", action, data);
    },
    onSystemCommand: (command, data) => {
      console.log("[TalkingV2] SSE system command:", command, data);
    },
    onError: (msg) => {
      console.warn("[TalkingV2] SSE error:", msg);
    },
  });
  
  // ─── Gemini Live Call ──────────────────────────────────────────────────────
  const talkingUser = TALKING_USERS.find(u => u.username === user?.username);
  const geminiLive = useGeminiLiveCall({
    persona: (talkingUser?.persona || "ulysse") as "ulysse" | "iris",
    userName: user?.displayName || user?.username || "User",
    onTranscript: (entry) => {
      setMessages(prev => {
        if (prev.some(m => m.id === entry.id)) return prev;
        return [...prev, {
          id: entry.id,
          role: entry.isUser ? "user" : "assistant",
          content: entry.text,
          timestamp: new Date(entry.timestamp),
          origin: "voice" as const,
        }];
      });
    },
  });

  const handleChatMessage = useCallback((message: TalkingMessage) => {
    if (message.origin === "chat") {
      setMessages(prev => {
        if (prev.some(m => m.id === message.id)) return prev;
        return [...prev, {
          ...message,
          timestamp: new Date(message.timestamp)
        }];
      });
    }
  }, []);
  
  const handleTTSRequest = useCallback(async (request: TTSRequest) => {
    if (isSpeakerMuted) return;
    
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: request.text }),
        credentials: "include"
      });
      
      if (!response.ok) return;
      
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      
      audio.onended = () => URL.revokeObjectURL(audioUrl);
      
      if (selectedOutputId && "setSinkId" in audio) {
        try {
          await (audio as any).setSinkId(selectedOutputId);
        } catch (err) {
          console.warn("[TalkingV2] Could not set audio output device");
        }
      }
      
      await audio.play();
    } catch (err) {
      console.error("[TalkingV2] Error playing TTS:", err);
    }
  }, [selectedOutputId, isSpeakerMuted]);
  
  const { sendTalkingMessage } = useRealtimeSync({
    userId: user?.id,
    deviceId: "talking",
    onTalkingMessage: handleChatMessage,
    onTTSRequest: handleTTSRequest
  });
  
  useEffect(() => {
    sendTalkingMessageRef.current = sendTalkingMessage;
  }, [sendTalkingMessage]);
  
  useEffect(() => {
    const audio = document.createElement("audio") as any;
    setSinkIdSupported(typeof audio.setSinkId === "function");
    setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent));
  }, []);
  
  const requestWakeLock = useCallback(async () => {
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
      }
    } catch (err) {
      console.log("[TalkingV2] Wake Lock not available");
    }
  }, []);
  
  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  }, []);
  
  const startMicLevelMonitoring = useCallback(async () => {
    console.log("[TalkingV2] Starting mic level monitoring");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      if (ctx.state === "suspended") {
        console.log("[TalkingV2] AudioContext created in suspended state, resuming...");
        await ctx.resume();
        console.log("[TalkingV2] AudioContext resumed, state:", ctx.state);
      } else {
        console.log("[TalkingV2] AudioContext created in state:", ctx.state);
      }
      
      const analyser = ctx.createAnalyser();
      const source = ctx.createMediaStreamSource(stream);
      
      analyser.fftSize = 256;
      source.connect(analyser);
      
      audioContextRef.current = ctx;
      analyserRef.current = analyser;
      
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      
      micLevelIntervalRef.current = window.setInterval(() => {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setMicLevel(average / 255);
      }, 50);
      
      console.log("[TalkingV2] Mic level monitoring started successfully");
      
    } catch (err) {
      console.error("[TalkingV2] Failed to start mic monitoring:", err);
      toast({ 
        title: "Avertissement", 
        description: "Monitoring micro indisponible - l'interruption automatique est désactivée",
        variant: "destructive"
      });
    }
  }, [toast]);
  
  const stopMicLevelMonitoring = useCallback(() => {
    if (micLevelIntervalRef.current) {
      clearInterval(micLevelIntervalRef.current);
      micLevelIntervalRef.current = null;
    }
    if (speakerLevelIntervalRef.current) {
      clearInterval(speakerLevelIntervalRef.current);
      speakerLevelIntervalRef.current = null;
    }
    if (ttsSourceRef.current) {
      try { ttsSourceRef.current.disconnect(); } catch {}
      ttsSourceRef.current = null;
    }
    if (ttsAnalyserRef.current) {
      try { ttsAnalyserRef.current.disconnect(); } catch {}
      ttsAnalyserRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setMicLevel(0);
    setSpeakerLevel(0);
  }, []);
  
  const handleStartCall = useCallback(async () => {
    triggerHaptic("success");
    setIsInCall(true);

    if (useGeminiModeRef.current) {
      try {
        await geminiLive.startCall();
      } catch (err: any) {
        toast({ title: "Erreur Gemini Live", description: err.message, variant: "destructive" });
        setIsInCall(false);
      }
      return;
    }

    // Classic mode — unlock audio on all mobile browsers (iOS + some Android)
    try {
      await voice.unlockAudio();
    } catch (err) {
      console.warn("[TalkingV2] Audio unlock failed:", err);
    }
    await requestWakeLock();
    await startMicLevelMonitoring();
    voice.startListening();
  }, [geminiLive, requestWakeLock, startMicLevelMonitoring, voice, isIOS, toast]);
  
  const handleEndCall = useCallback(() => {
    triggerHaptic("medium");
    setIsInCall(false);

    if (useGeminiModeRef.current) {
      geminiLive.endCall();
      return;
    }

    // Classic mode
    releaseWakeLock();
    stopMicLevelMonitoring();
    voice.cancel();
  }, [geminiLive, releaseWakeLock, stopMicLevelMonitoring, voice]);
  
  const handleInterrupt = useCallback(() => {
    triggerHaptic("light");
    voice.cancel();
    setStreamingResponse("");
    setSpeakerLevel(0);
    if (conversationMode === "continuous") {
      isResumingListeningRef.current = true;
      setTimeout(() => {
        voice.startListening();
      }, 300);
    }
  }, [voice, conversationMode]);
  
  const handleToggleMode = useCallback(() => {
    setConversationMode(prev => prev === "continuous" ? "push-to-talk" : "continuous");
    toast({ title: conversationMode === "continuous" ? "Mode push-to-talk" : "Mode continu actif" });
  }, [conversationMode, toast]);
  
  const interruptCooldownRef = useRef(false);
  const prevVoiceStateRef = useRef<string>("idle");
  
  useEffect(() => {
    const micMonitorActive = micStreamRef.current !== null && analyserRef.current !== null;
    
    if (conversationMode === "continuous" && voice.isSpeaking && isInCall && !isMuted && micMonitorActive && micLevel > 0.15) {
      if (!interruptCooldownRef.current) {
        interruptCooldownRef.current = true;
        console.log("[TalkingV2] Auto-interrupt: user speaking during TTS");
        handleInterrupt();
        setTimeout(() => {
          interruptCooldownRef.current = false;
        }, 1500);
      }
    }
  }, [conversationMode, voice.isSpeaking, isInCall, isMuted, micLevel, handleInterrupt]);
  
  useEffect(() => {
    if (voice.isListening) {
      isResumingListeningRef.current = false;
    }
  }, [voice.isListening]);
  
  useEffect(() => {
    if (isResumingListeningRef.current) {
      const timeout = setTimeout(() => {
        if (isResumingListeningRef.current) {
          console.warn("[TalkingV2] Timeout: clearing stuck isResumingListening flag");
          isResumingListeningRef.current = false;
        }
      }, 5000);
      return () => clearTimeout(timeout);
    }
  }, [voice.voiceState]);
  
  useEffect(() => {
    const wasIdle = prevVoiceStateRef.current === "speaking" && voice.voiceState === "idle";
    prevVoiceStateRef.current = voice.voiceState;
    
    if (wasIdle && isInCall && conversationMode === "continuous" && !isMuted && !isResumingListeningRef.current) {
      console.log("[TalkingV2] Auto-resume listening after TTS complete");
      isResumingListeningRef.current = true;
      const timeout = setTimeout(() => {
        voice.startListening();
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [voice.voiceState, isInCall, conversationMode, isMuted, voice]);
  
  const handleReconnect = useCallback(() => {
    setReconnectAttempts(prev => prev + 1);
    voice.connect();
  }, [voice]);
  
  const testAudioOutput = useCallback(async () => {
    setIsTestingAudio(true);
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (audioContext.state === "suspended") await audioContext.resume();
      
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.frequency.setValueAtTime(440, audioContext.currentTime);
      oscillator.type = "sine";
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.8);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.8);
      
      setTimeout(() => {
        setIsTestingAudio(false);
        toast({ title: "Son joue" });
        audioContext.close();
      }, 1000);
    } catch (err) {
      setIsTestingAudio(false);
      toast({ title: "Erreur test audio", variant: "destructive" });
    }
  }, [toast]);
  
  const handlePinDigit = (digit: string) => {
    if (pinCode.length >= 4) return;
    const newPin = pinCode + digit;
    setPinCode(newPin);
    setPinError(false);
    triggerHaptic("light");

    if (newPin.length === 4) {
      // Do NOT validate PIN client-side — let the server decide
      setPinStep("logging");
      handlePinLogin(newPin);
    }
  };

  const handlePinDelete = () => {
    if (pinCode.length > 0) {
      setPinCode(pinCode.slice(0, -1));
      triggerHaptic("light");
    }
  };

  const handlePinLogin = async (pin: string) => {
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/talking/pin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ pin }),
      });

      if (response.ok) {
        const data = await response.json();
        triggerHaptic("success");
        toast({ title: `Bienvenue ${data.user?.displayName || data.user?.username || ""}` });
        window.location.reload();
      } else {
        triggerHaptic("error");
        setPinError(true);
        const data = await response.json();
        toast({ title: "Erreur", description: data.error || "Connexion échouée", variant: "destructive" });
        setTimeout(() => {
          setPinStep("pin");
          setPinCode("");
          setPinError(false);
        }, 500);
      }
    } catch (error) {
      triggerHaptic("error");
      toast({ title: "Erreur", description: "Impossible de se connecter", variant: "destructive" });
      setPinStep("pin");
      setPinCode("");
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await login(authUsername, authPassword);
      toast({ title: "Connexion reussie" });
    } catch (error: any) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  useEffect(() => {
    if (voice.isSpeaking) {
      setSpeakerLevel(0.6 + Math.random() * 0.3);
    } else {
      setSpeakerLevel(0);
    }
  }, [voice.isSpeaking]);
  
  useEffect(() => {
    if (voice.isListening && !currentTranscript && voice.transcript) {
      setCurrentTranscript(voice.transcript);
    }
    if (!voice.isListening && currentTranscript) {
      if (currentTranscript.trim()) {
        setMessages(prev => [...prev, {
          id: `msg_${Date.now()}`,
          role: "user",
          content: currentTranscript,
          timestamp: new Date(),
          origin: "voice"
        }]);
      }
      setCurrentTranscript("");
    }
  }, [voice.isListening, voice.transcript, currentTranscript]);
  
  useEffect(() => {
    return () => {
      releaseWakeLock();
      stopMicLevelMonitoring();
    };
  }, [releaseWakeLock, stopMicLevelMonitoring]);
  
  // ─── Computed display values (unified for both modes) ─────────────────────
  const displayMicLevel = useGeminiMode ? geminiLive.micLevel : micLevel;
  const displaySpeakerLevel = useGeminiMode ? geminiLive.speakerLevel : speakerLevel;
  const displayIsListening = useGeminiMode ? geminiLive.isListening : voice.isListening;
  const displayIsSpeaking = useGeminiMode ? geminiLive.isSpeaking : voice.isSpeaking;
  const displayVoiceState = useGeminiMode
    ? (geminiLive.callState === "in_call" ? (geminiLive.isListening ? "listening" : geminiLive.isSpeaking ? "speaking" : "idle") : "idle")
    : voice.voiceState;
  const displayConnectionState = useGeminiMode
    ? (geminiLive.callState === "in_call" || geminiLive.callState === "ready" ? "authenticated" : geminiLive.callState === "connecting" ? "connecting" : "disconnected")
    : voice.connectionState;
  const isGeminiDisabled = useGeminiMode
    ? (geminiLive.callState === "connecting")
    : (voice.connectionState !== "authenticated");

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    );
  }
  
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col">
        <div className="flex-1 flex items-center justify-center p-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-sm"
          >
            <div className="text-center mb-8">
              <div className="w-20 h-20 bg-purple-600 rounded-full mx-auto mb-4 flex items-center justify-center">
                <Lock className="w-10 h-10 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-white">Ulysse Voice Pro</h1>
              <p className="text-gray-400 mt-2">Entrez votre code PIN</p>
            </div>
            
            {pinStep === "pin" ? (
              <>
                <div className="flex justify-center gap-3 mb-8">
                  {[0, 1, 2, 3].map((i) => (
                    <motion.div
                      key={i}
                      className={cn(
                        "w-4 h-4 rounded-full border-2 transition-all",
                        i < pinCode.length
                          ? pinError
                            ? "bg-red-500 border-red-500"
                            : "bg-purple-500 border-purple-500"
                          : "border-gray-600"
                      )}
                      animate={pinError && i < pinCode.length ? { x: [-5, 5, -5, 5, 0] } : {}}
                      transition={{ duration: 0.3 }}
                    />
                  ))}
                </div>
                
                <div className="grid grid-cols-3 gap-4 max-w-xs mx-auto">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, "del"].map((digit, i) => (
                    digit !== null ? (
                      <button
                        key={i}
                        onClick={() => digit === "del" ? handlePinDelete() : handlePinDigit(String(digit))}
                        className={cn(
                          "w-16 h-16 rounded-full text-xl font-semibold transition-all",
                          digit === "del"
                            ? "text-gray-400 hover:text-white"
                            : "bg-gray-800 text-white hover:bg-gray-700 active:scale-95"
                        )}
                        data-testid={digit === "del" ? "button-pin-delete" : `button-pin-${digit}`}
                      >
                        {digit === "del" ? "Del" : digit}
                      </button>
                    ) : (
                      <div key={i} className="w-16 h-16" />
                    )
                  ))}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
                <span className="text-gray-400">Connexion en cours...</span>
              </div>
            )}
          </motion.div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <VoiceSessionHeader
        connectionState={voice.connectionState}
        voiceState={voice.voiceState}
        isInCall={isInCall}
        userName={user?.displayName || user?.username}
        personaName="Ulysse"
        voiceSecurityEnabled={voiceSecurityEnabled}
        degradedMode={degradedMode}
      />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        {(voice.connectionState === "disconnected" || voice.connectionState === "error" || degradedMode) && (
          <div className="px-4 py-2">
            <ConnectionStatusBanner
              connectionState={voice.connectionState}
              degradedMode={degradedMode}
              onReconnect={handleReconnect}
              lastError={voice.error || undefined}
              reconnectAttempts={reconnectAttempts}
            />
          </div>
        )}
        
        <div className="px-4 py-2">
          <button
            onClick={() => setShowMeters(!showMeters)}
            className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            {showMeters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Niveaux audio
          </button>
          
          <AnimatePresence>
            {showMeters && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <DualAudioMeter
                  micLevel={micLevel}
                  speakerLevel={speakerLevel}
                  isMicActive={voice.isListening && !isMuted}
                  isSpeakerActive={voice.isSpeaking && !isSpeakerMuted}
                  showWaveform={isInCall}
                  className="mt-2"
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        
        <ConversationTimeline
          messages={messages}
          currentTranscript={currentTranscript}
          isListening={voice.isListening}
          isProcessing={voice.isProcessing}
          isSpeaking={voice.isSpeaking}
          streamingResponse={streamingResponse}
          maxHeight="calc(100vh - 400px)"
          className="flex-1"
        />
        
        <div className="p-4 bg-gray-900/50 border-t border-gray-800">
          <VoiceControls
            isInCall={isInCall}
            voiceState={voice.voiceState}
            conversationMode={conversationMode}
            isMuted={isMuted}
            isSpeakerMuted={isSpeakerMuted}
            onStartCall={handleStartCall}
            onEndCall={handleEndCall}
            onToggleMute={() => setIsMuted(!isMuted)}
            onToggleSpeaker={() => setIsSpeakerMuted(!isSpeakerMuted)}
            onInterrupt={handleInterrupt}
            onToggleMode={handleToggleMode}
            onOpenSettings={() => setShowDevicePanel(true)}
            disabled={voice.connectionState !== "authenticated"}
          />
        </div>
      </div>
      
      {voiceCardData && (
        <VoiceDataCard
          data={voiceCardData}
          onClose={() => setVoiceCardData(null)}
        />
      )}
      
      <VoiceDevicePanel
        isOpen={showDevicePanel}
        onClose={() => setShowDevicePanel(false)}
        selectedInputId={selectedInputId}
        selectedOutputId={selectedOutputId}
        onSelectInput={(id, label) => {
          setSelectedInputId(id);
          toast({ title: "Micro selectionne", description: label });
        }}
        onSelectOutput={(id, label) => {
          setSelectedOutputId(id);
          toast({ title: "Sortie selectionnee", description: label });
        }}
        onTestAudio={testAudioOutput}
        isTestingAudio={isTestingAudio}
        sinkIdSupported={sinkIdSupported}
        isIOS={isIOS}
      />
    </div>
  );
}
