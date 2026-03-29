import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, Loader2, Phone, PhoneOff, Volume2, Bluetooth, X, CheckCircle2, AlertCircle, Check, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useRealtimeVoice } from "@/hooks/use-realtime-voice";
import { useVoiceSSE } from "@/hooks/voice/useVoiceSSE";
import { useRealtimeVoiceCall } from "@/hooks/voice/useRealtimeVoiceCall";
import { useToast } from "@/hooks/use-toast";
import { useRealtimeSync, type TalkingMessage, type TTSRequest } from "@/hooks/useRealtimeSync";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, Lock, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { AvatarUlysse, getUlysseState } from "@/components/AvatarUlysse";
import { AvatarIris } from "@/components/AvatarIris";
import { useQuery } from "@tanstack/react-query";
import { usePageManifest } from "@/hooks/usePageManifest";

interface AudioDevice {
  deviceId: string;
  label: string;
  kind: string;
}

type AudioHTMLMediaElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

// iOS haptic feedback helper
const triggerHaptic = (style: "light" | "medium" | "heavy" | "success" | "warning" | "error" = "light") => {
  if ("vibrate" in navigator) {
    const patterns: Record<string, number | number[]> = {
      light: 10,
      medium: 20,
      heavy: 30,
      success: [10, 50, 10],
      warning: [20, 100, 20],
      error: [30, 100, 30, 100, 30],
    };
    navigator.vibrate(patterns[style] || 10);
  }
};

// iOS audio session unlock (required for autoplay)
const unlockAudioSession = async (): Promise<boolean> => {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const buffer = audioContext.createBuffer(1, 1, 22050);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start();
    await audioContext.resume();
    console.log("[iOS] Audio session unlocked");
    return true;
  } catch (err) {
    console.log("[iOS] Audio unlock failed:", err);
    return false;
  }
};

export default function TalkingApp({ irisMode = false }: { irisMode?: boolean } = {}) {
  usePageManifest({
    title: irisMode ? "Iris Voice" : "Ulysse Voice",
    manifestPath: "/manifest-talking.json",
    themeColor: irisMode ? "#ec4899" : "#7c3aed",
    appleTitle: irisMode ? "Iris" : "Ulysse"
  });

  const { user, isLoading: authLoading, isAuthenticated, login } = useAuth();
  const { toast } = useToast();
  
  // Fetch conversations to get the main one (Ulysse Hub)
  const { data: conversations } = useQuery<any[]>({
    queryKey: ["/api/conversations"],
    enabled: isAuthenticated,
  });
  
  // Get the main conversation ID (first "Ulysse Hub" or create new one)
  const mainConversationId = conversations?.find((c: any) => c.title === "Ulysse Hub")?.id || conversations?.[0]?.id;
  
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pinCode, setPinCode] = useState("");
  const [pinStep, setPinStep] = useState<"pin" | "logging">("pin");
  const [pinError, setPinError] = useState(false);
  
  const ALL_TALKING_USERS = [
    { id: "maurice", name: "Maurice", username: "Maurice", persona: "ulysse" },
    { id: "kelly", name: "Kelly", username: "KellyIris001", persona: "iris" },
    { id: "lenny", name: "Lenny", username: "LennyIris002", persona: "iris" },
    { id: "micky", name: "Micky", username: "MickyIris003", persona: "iris" },
  ];
  const TALKING_USERS = irisMode ? ALL_TALKING_USERS.filter(u => u.persona === "iris") : ALL_TALKING_USERS;
  const [isInCall, setIsInCall] = useState(false);
  const [showBluetoothPanel, setShowBluetoothPanel] = useState(false);
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [inputDevices, setInputDevices] = useState<AudioDevice[]>([]);
  const [bluetoothStatus, setBluetoothStatus] = useState<"unknown" | "connected" | "none">("unknown");
  const [micBluetoothStatus, setMicBluetoothStatus] = useState<"unknown" | "connected" | "none">("unknown");
  const [isTestingAudio, setIsTestingAudio] = useState(false);
  const [selectedOutputId, setSelectedOutputId] = useState<string>("");
  const [selectedInputId, setSelectedInputId] = useState<string>("");
  const [sinkIdSupported, setSinkIdSupported] = useState<boolean>(true);
  const [isIOS, setIsIOS] = useState(false);
  const [serverConnected, setServerConnected] = useState<boolean | null>(null);
  const [voiceSecurityEnabled, setVoiceSecurityEnabled] = useState(false);
  const [micPermission, setMicPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [earbudsMode, setEarbudsMode] = useState(false);
  
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const keepAliveAudioRef = useRef<HTMLAudioElement | null>(null);
  const testAudioRef = useRef<AudioHTMLMediaElement | null>(null);
  const ttsAudioRef = useRef<AudioHTMLMediaElement | null>(null);
  
  // Ref for sending messages to /hub (initialized after useRealtimeSync)
  const sendTalkingMessageRef = useRef<((msg: TalkingMessage) => void) | null>(null);
  
  const voice = useRealtimeVoice({
    userName: user?.displayName || user?.username || "User",
    conversationId: mainConversationId,
    onTranscript: (text) => {
      console.log("[Talking] Transcript:", text.substring(0, 50));
      // Sync user transcript to /hub
      sendTalkingMessageRef.current?.({
        id: `voice_user_${Date.now()}`,
        role: "user",
        content: text,
        timestamp: new Date(),
        origin: "voice"
      });
    },
    onResponse: (resp) => {
      console.log("[Talking] Response:", resp.substring(0, 50));
      // Sync assistant response to /hub
      sendTalkingMessageRef.current?.({
        id: `voice_assistant_${Date.now()}`,
        role: "assistant",
        content: resp,
        timestamp: new Date(),
        origin: "voice"
      });
    },
    onError: (err) => {
      console.error("[Talking] Voice error:", err);
      toast({ title: "Erreur", description: err, variant: "destructive" });
    },
    onAuthenticated: (persona) => {
      console.log("[Talking] Authenticated as", persona);
      toast({ title: `${persona === "ulysse" ? "Ulysse" : "Iris"} est prêt` });
    },
    onSpeakerVerified: (confidence) => {
      console.log("[Talking] Speaker verified:", confidence);
      setVoiceSecurityEnabled(true);
    },
    onSpeakerRejected: (message, confidence) => {
      console.log("[Talking] Speaker rejected:", confidence);
      toast({ 
        title: "Voix non reconnue", 
        description: `Je ne réponds qu'à ta voix. (${(confidence * 100).toFixed(0)}%)`,
        variant: "destructive" 
      });
    },
    onVerificationSkipped: (reason, error) => {
      console.warn("[Talking] Verification skipped:", reason, error);
      setVoiceSecurityEnabled(false);
      toast({ 
        title: "Vérification vocale indisponible", 
        description: "Mode dégradé : réponse sans vérification de voix."
      });
    },
  });

  const voiceSSE = useVoiceSSE({
    sessionId: voice.sessionId,
    enabled: voice.connectionState === "authenticated",
    onStateChange: (sseState) => {
      console.log("[Talking] SSE state:", sseState);
    },
    onTranscriptFinal: (text) => {
      console.log("[Talking] SSE transcript:", text.substring(0, 50));
    },
    onResponseFull: (text, domain) => {
      console.log("[Talking] SSE full response (domain:", domain, "):", text.substring(0, 50));
    },
    onError: (msg) => {
      console.warn("[Talking] SSE error:", msg);
    },
  });
  
  const realtimeCall = useRealtimeVoiceCall({
    userName: user?.displayName || user?.username || "User",
    conversationId: mainConversationId,
    earbudsMode,
    onTranscript: (text) => {
      console.log("[Talking] Call transcript:", text.substring(0, 50));
      // Sync user transcript to /hub
      sendTalkingMessageRef.current?.({
        id: `call_user_${Date.now()}`,
        role: "user",
        content: text,
        timestamp: new Date(),
        origin: "talking"
      });
    },
    onResponse: (text) => {
      console.log("[Talking] Call response:", text.substring(0, 50));
      // Sync assistant response to /hub
      sendTalkingMessageRef.current?.({
        id: `call_assistant_${Date.now()}`,
        role: "assistant",
        content: text,
        timestamp: new Date(),
        origin: "talking"
      });
    },
    onError: (err) => {
      console.error("[Talking] Call error:", err);
      toast({ title: "Erreur d'appel", description: err, variant: "destructive" });
    },
    onStateChange: (state) => {
      console.log("[Talking] Call state:", state);
      if (state === "in_call") {
        setVoiceSecurityEnabled(true);
      }
    },
  });
  
  // Handle messages from .org chat - the TTS is handled by the backend via WebSocket
  const handleChatMessage = useCallback((message: TalkingMessage) => {
    if (message.origin === "chat") {
      console.log("[Talking] Received message from /hub chat:", message.content.substring(0, 50));
      // Messages from /hub are already in the main conversation - just log for debugging
    }
  }, []);
  
  // Handle TTS requests from chat (priority mode: /talking speaks responses from chat)
  const handleTTSRequest = useCallback(async (request: TTSRequest) => {
    console.log("[Talking] TTS request from chat:", request.text.substring(0, 50));
    
    // Use OpenAI TTS API to generate audio and play it
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: request.text }),
        credentials: "include"
      });
      
      if (!response.ok) {
        console.error("[Talking] TTS API error:", response.status);
        return;
      }
      
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      
      // Play the audio
      const audio = new Audio(audioUrl);
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        console.log("[Talking] TTS playback finished");
      };
      
      // Set sink ID if supported and a device is selected
      if (selectedOutputId && 'setSinkId' in audio) {
        try {
          await (audio as any).setSinkId(selectedOutputId);
        } catch (err) {
          console.warn("[Talking] Could not set audio output device:", err);
        }
      }
      
      await audio.play();
      console.log("[Talking] Playing TTS from chat");
    } catch (err) {
      console.error("[Talking] Error playing TTS:", err);
    }
  }, [selectedOutputId]);
  
  // Connect to realtime sync as "talking" device to receive messages from .org chat
  const { sendTalkingMessage } = useRealtimeSync({
    userId: user?.id,
    deviceId: "talking",
    onTalkingMessage: handleChatMessage,
    onTTSRequest: handleTTSRequest
  });
  
  // Update ref when sendTalkingMessage changes
  useEffect(() => {
    sendTalkingMessageRef.current = sendTalkingMessage;
  }, [sendTalkingMessage]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await login(authUsername, authPassword);
      toast({ title: "Connexion réussie" });
    } catch (error: any) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

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
    } catch (error: any) {
      triggerHaptic("error");
      toast({ title: "Erreur", description: "Impossible de se connecter", variant: "destructive" });
      setPinStep("pin");
      setPinCode("");
    } finally {
      setIsSubmitting(false);
    }
  };

  const requestWakeLock = useCallback(async () => {
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
        console.log("[Talking] Wake Lock acquired");
      }
    } catch (err) {
      console.log("[Talking] Wake Lock not available:", err);
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
      console.log("[Talking] Wake Lock released");
    }
  }, []);

  const startKeepAlive = useCallback(() => {
    if (!keepAliveAudioRef.current) {
      const audio = new Audio();
      audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
      audio.loop = true;
      audio.volume = 0.01;
      keepAliveAudioRef.current = audio;
    }
    keepAliveAudioRef.current.play().catch(() => {});
  }, []);

  const stopKeepAlive = useCallback(() => {
    if (keepAliveAudioRef.current) {
      keepAliveAudioRef.current.pause();
      keepAliveAudioRef.current = null;
    }
  }, []);

  const selectAudioOutput = useCallback(async () => {
    if (!("selectAudioOutput" in navigator.mediaDevices)) {
      openBluetoothPanel();
      return;
    }
    try {
      const device = await (navigator.mediaDevices as any).selectAudioOutput();
      setSelectedOutputId(device.deviceId);
      // Audio output is set via setSinkId on audio elements
      toast({ title: "Sortie audio", description: device.label });
      checkBluetoothDevices();
    } catch (err: any) {
      if (err.name !== "NotAllowedError") {
        toast({ title: "Erreur audio", variant: "destructive" });
      }
    }
  }, [toast, voice]);

  const selectOutputDevice = useCallback(async (deviceId: string, label: string) => {
    triggerHaptic("light");
    if (!sinkIdSupported) {
      toast({ 
        title: "Non supporté sur iOS", 
        description: "Utilisez le Control Center pour changer de sortie audio"
      });
      return;
    }
    
    try {
      if (!testAudioRef.current) {
        testAudioRef.current = new Audio() as AudioHTMLMediaElement;
      }
      
      if (testAudioRef.current.setSinkId) {
        await testAudioRef.current.setSinkId(deviceId);
        setSelectedOutputId(deviceId);
        // Audio output is applied to audio elements via setSinkId
        toast({ title: "Sortie audio", description: label });
        console.log("[Talking] Audio output set to:", label);
      }
    } catch (err) {
      console.error("[Talking] Failed to set audio output:", err);
      toast({ 
        title: "Erreur", 
        description: "Impossible de changer la sortie audio",
        variant: "destructive" 
      });
    }
  }, [sinkIdSupported, toast]);

  const selectInputDevice = useCallback((deviceId: string, label: string) => {
    triggerHaptic("light");
    setSelectedInputId(deviceId);
    // Input device selection is handled via getUserMedia constraints
    toast({ title: "Micro sélectionné", description: label });
    console.log("[Talking] Audio input set to:", label);
  }, [toast]);

  useEffect(() => {
    const checkSinkIdSupport = () => {
      const audio = document.createElement("audio") as AudioHTMLMediaElement;
      const supported = typeof audio.setSinkId === "function";
      setSinkIdSupported(supported);
      
      const iosDetected = /iPad|iPhone|iPod/.test(navigator.userAgent);
      setIsIOS(iosDetected);
      
      console.log("[Talking] setSinkId supported:", supported, "iOS:", iosDetected);
    };
    checkSinkIdSupport();
  }, []);

  const checkBluetoothDevices = useCallback(async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      
      const btKeywords = ["bluetooth", "airpod", "earpod", "buds", "wireless", "bt", "headphone", "casque", "earphone", "sena", "smh", "wf-c510", "wf-c", "sony", "jabra", "bose", "beats"];
      
      const audioOutputs = devices
        .filter(d => d.kind === "audiooutput" && d.label)
        .map(d => ({ deviceId: d.deviceId, label: d.label, kind: d.kind }));
      
      const audioInputs = devices
        .filter(d => d.kind === "audioinput" && d.label)
        .map(d => ({ deviceId: d.deviceId, label: d.label, kind: d.kind }));
      
      setAudioDevices(audioOutputs);
      setInputDevices(audioInputs);
      
      const hasBluetoothOutput = audioOutputs.some(d => 
        btKeywords.some(kw => d.label.toLowerCase().includes(kw))
      );
      
      const hasBluetoothInput = audioInputs.some(d => 
        btKeywords.some(kw => d.label.toLowerCase().includes(kw))
      );
      
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
      const isIOSSafari = isIOS || isSafari;
      
      if (isIOSSafari && audioOutputs.length === 0 && hasBluetoothInput) {
        setBluetoothStatus("connected");
      } else {
        setBluetoothStatus(hasBluetoothOutput ? "connected" : "none");
      }
      setMicBluetoothStatus(hasBluetoothInput ? "connected" : "none");

      if (hasBluetoothOutput || hasBluetoothInput) {
        setEarbudsMode(true);
      }
      
      console.log("[Talking] Audio outputs:", audioOutputs.map(d => d.label));
      console.log("[Talking] Audio inputs (mics):", audioInputs.map(d => d.label));
      console.log("[Talking] iOS/Safari detected:", isIOSSafari);
    } catch (err) {
      console.log("[Talking] Cannot enumerate devices:", err);
      setBluetoothStatus("unknown");
      setMicBluetoothStatus("unknown");
    }
  }, []);

  const testAudioOutput = useCallback(async () => {
    setIsTestingAudio(true);
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.setValueAtTime(440, audioContext.currentTime);
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.8);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.8);
      
      setTimeout(() => {
        setIsTestingAudio(false);
        const selectedDevice = audioDevices.find(d => d.deviceId === selectedOutputId);
        const deviceName = selectedDevice?.label || "Sortie par défaut";
        toast({ title: "Son joué", description: deviceName });
        audioContext.close();
      }, 1000);
    } catch (err) {
      console.log("[Talking] Audio test error:", err);
      setIsTestingAudio(false);
      toast({ title: "Erreur test audio", description: "Touchez d'abord l'écran", variant: "destructive" });
    }
  }, [toast, selectedOutputId, audioDevices]);

  const openBluetoothPanel = useCallback(async () => {
    triggerHaptic("light");
    await checkBluetoothDevices();
    setShowBluetoothPanel(true);
  }, [checkBluetoothDevices]);

  // Check microphone permission status on page load (non-blocking)
  useEffect(() => {
    const checkMicPermission = async () => {
      try {
        // Try to check permission status (works on most browsers)
        if (navigator.permissions && navigator.permissions.query) {
          const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
          console.log("[Talking] Mic permission status:", result.state);
          if (result.state === 'granted') {
            setMicPermission('granted');
            checkBluetoothDevices();
          } else if (result.state === 'denied') {
            setMicPermission('denied');
          }
          // Listen for changes
          result.onchange = () => {
            console.log("[Talking] Mic permission changed to:", result.state);
            setMicPermission(result.state === 'granted' ? 'granted' : result.state === 'denied' ? 'denied' : 'unknown');
          };
        }
      } catch (err) {
        console.log("[Talking] Permission API not supported, will request on click");
      }
    };
    checkMicPermission();
  }, [checkBluetoothDevices]);

  // Function to request mic permission (requires user gesture on iOS)
  const requestMicPermission = useCallback(async () => {
    try {
      console.log("[Talking] Requesting microphone permission...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      console.log("[Talking] Microphone permission granted");
      setMicPermission('granted');
      checkBluetoothDevices();
      toast({ title: "Micro activé", description: "Vous pouvez maintenant appeler Ulysse" });
    } catch (err: any) {
      console.error("[Talking] Microphone permission denied:", err);
      setMicPermission('denied');
      toast({ 
        title: "Accès micro refusé", 
        description: "Autorisez l'accès au microphone dans les réglages",
        variant: "destructive"
      });
    }
  }, [checkBluetoothDevices, toast]);

  const handleAudioOutputClick = useCallback(() => {
    triggerHaptic("light");
    selectAudioOutput();
  }, [selectAudioOutput]);

  // Continuous secure listening - auto-restart when not speaking and not processing
  // BUT only if NOT using realtime call mode (PCM streaming)
  useEffect(() => {
    // Skip if realtime call is active - it handles its own audio capture
    if (realtimeCall.isInCall) {
      return;
    }
    
    if (isInCall && voiceSecurityEnabled && !voice.isListening && !voice.isSpeaking && !voice.isProcessing) {
      // Auto-restart listening after TTS finishes and processing completes (fallback mode only)
      const timeout = setTimeout(() => {
        console.log("[Talking] Auto-restarting continuous listening (fallback mode)");
        voice.startListening();
      }, 300);
      return () => clearTimeout(timeout);
    }
  }, [isInCall, voiceSecurityEnabled, voice.isListening, voice.isSpeaking, voice.isProcessing, voice, realtimeCall.isInCall]);

  const startCall = useCallback(async () => {
    console.log("[Talking] startCall pressed, micPermission:", micPermission);
    triggerHaptic("success");

    if (micPermission !== 'granted') {
      try {
        console.log("[Talking] Requesting mic permission first...");
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        setMicPermission('granted');
        checkBluetoothDevices();
        console.log("[Talking] Mic permission granted, continuing to call...");
      } catch (err: any) {
        console.error("[Talking] Mic permission denied:", err?.message || err);
        setMicPermission('denied');
        toast({ title: "Accès micro refusé", description: "Autorisez l'accès au microphone dans les réglages", variant: "destructive" });
        return;
      }
    }

    if (isIOS) {
      await unlockAudioSession();
    }
    setIsInCall(true);
    setVoiceSecurityEnabled(true);
    await requestWakeLock();
    startKeepAlive();
    
    try {
      console.log("[Talking] Calling realtimeCall.startCall()...");
      await realtimeCall.startCall();
      console.log("[Talking] realtimeCall.startCall() resolved OK");
      toast({ title: "Appel en cours", description: "Mode bidirectionnel PCM16 activé" });
    } catch (err: any) {
      console.error("[Talking] Failed to start call:", err?.message || err);
      voice.startListening();
      toast({ title: "Écoute continue activée", description: "Mode MediaRecorder (fallback)" });
    }
  }, [voice, realtimeCall, toast, requestWakeLock, startKeepAlive, isIOS, micPermission, checkBluetoothDevices]);

  const endCall = useCallback(() => {
    triggerHaptic("warning");
    setIsInCall(false);
    setVoiceSecurityEnabled(false);
    releaseWakeLock();
    stopKeepAlive();
    
    // End realtime call if active
    if (realtimeCall.isInCall) {
      realtimeCall.endCall();
    }
    
    // Also stop MediaRecorder mode if it was used as fallback
    voice.stopListening();
    voice.cancel();
    toast({ title: "Appel terminé" });
  }, [voice, realtimeCall, toast, releaseWakeLock, stopKeepAlive]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && isInCall) {
        requestWakeLock();
        // Realtime call auto-recovers, only restart MediaRecorder fallback mode
        if (voiceSecurityEnabled && !realtimeCall.isInCall && !voice.isListening && !voice.isSpeaking) {
          voice.startListening();
        }
      }
    };
    
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      releaseWakeLock();
      stopKeepAlive();
    };
  }, [isInCall, voice, realtimeCall, voiceSecurityEnabled, requestWakeLock, releaseWakeLock, stopKeepAlive]);

  // Server connection check
  useEffect(() => {
    const checkServer = async () => {
      try {
        const response = await fetch("/api/v2/health", { 
          method: "GET",
          credentials: "include",
          signal: AbortSignal.timeout(5000)
        });
        setServerConnected(response.ok);
      } catch {
        setServerConnected(false);
      }
    };
    
    checkServer();
    const interval = setInterval(checkServer, 30000);
    return () => clearInterval(interval);
  }, []);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen min-h-[100dvh] flex flex-col items-center justify-center bg-black p-6 pb-safe pt-safe px-safe">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-xs"
        >
          {pinStep === "logging" ? (
            <div className="text-center">
              <div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center mb-4">
                <Loader2 className="w-10 h-10 text-white animate-spin" />
              </div>
              <h1 className="text-xl font-bold text-white">Connexion...</h1>
            </div>
          ) : (
            <>
              <div className="text-center mb-8">
                <div className={cn(
                  "w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-4",
                  irisMode ? "bg-gradient-to-br from-pink-500 to-purple-500" : "bg-gradient-to-br from-blue-600 to-purple-600"
                )}>
                  <Lock className="w-10 h-10 text-white" />
                </div>
                <h1 className="text-2xl font-bold text-white">{irisMode ? "Iris — Code PIN" : "Code PIN"}</h1>
              </div>
              
              <div className="flex justify-center gap-3 mb-8">
                {[0, 1, 2, 3].map((i) => (
                  <motion.div
                    key={i}
                    animate={pinError ? { x: [-4, 4, -4, 4, 0] } : {}}
                    transition={{ duration: 0.3 }}
                    className={cn(
                      "w-4 h-4 rounded-full transition-colors",
                      i < pinCode.length 
                        ? pinError ? "bg-red-500" : (irisMode ? "bg-pink-500" : "bg-blue-500") 
                        : "bg-gray-700"
                    )}
                  />
                ))}
              </div>
              
              <div className="grid grid-cols-3 gap-3">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "delete"].map((key) => (
                  <motion.button
                    key={key}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => {
                      if (key === "delete") handlePinDelete();
                      else if (key) handlePinDigit(key);
                    }}
                    disabled={!key}
                    className={cn(
                      "h-16 rounded-xl text-2xl font-medium transition-colors",
                      key === "" ? "invisible" :
                      key === "delete" ? "bg-gray-800 active:bg-gray-700 text-gray-400" :
                      "bg-gray-800 active:bg-gray-700 text-white"
                    )}
                    data-testid={key ? `button-pin-${key}` : undefined}
                  >
                    {key === "delete" ? <X className="w-6 h-6 mx-auto" /> : key}
                  </motion.button>
                ))}
              </div>
            </>
          )}
        </motion.div>
      </div>
    );
  }

  // Use realtimeCall state when in call mode, otherwise use voice state
  const activeIsListening = realtimeCall.isInCall ? realtimeCall.isListening : voice.isListening;
  const activeIsSpeaking = realtimeCall.isInCall ? realtimeCall.isSpeaking : voice.isSpeaking;
  const activeIsProcessing = voice.isProcessing; // realtimeCall uses isSpeaking for processing
  
  const ulysseState = getUlysseState({
    isConnected: serverConnected === true && isInCall,
    isListening: activeIsListening,
    isProcessing: activeIsProcessing,
    isSpeaking: activeIsSpeaking,
  });

  return (
    <div className="min-h-screen min-h-[100dvh] bg-black flex flex-col items-center justify-center select-none relative pb-safe pt-safe px-safe">
      {/* Server connection indicator */}
      <div className="absolute top-4 left-4 flex items-center gap-2 pt-safe pl-safe">
        <div className={cn(
          "w-2.5 h-2.5 rounded-full",
          serverConnected === null ? "bg-yellow-500 animate-pulse" :
          serverConnected ? "bg-green-500" : "bg-red-500"
        )} />
        <span className="text-xs text-gray-500">
          {serverConnected === null ? "Connexion..." :
           serverConnected ? "Serveur connecté" : "Serveur déconnecté"}
        </span>
      </div>

      {irisMode ? (
        <AvatarIris 
          state={ulysseState} 
          size="xl" 
          showLabel={false}
        />
      ) : (
        <AvatarUlysse 
          state={ulysseState} 
          size="xl" 
          showLabel={false}
        />
      )}

      <p className="mt-4 text-xl sm:text-2xl text-white font-light">
        {irisMode ? "Comment puis-je t'aider ?" : "Comment puis-je vous aider ?"}
      </p>

      <p className="mt-2 text-sm text-gray-400">
        {activeIsSpeaking ? (irisMode ? "Iris parle" : "Ulysse parle") :
         activeIsListening ? "Écoute..." :
         isInCall ? "En ligne" :
         "Hors ligne"}
      </p>
      
      {/* Call mode indicator */}
      {realtimeCall.isInCall && (
        <p className="text-xs text-green-400 mt-1">PCM16 bidirectionnel</p>
      )}

      {/* Mic permission button - shows if permission not yet granted */}
      {micPermission !== 'granted' && !isInCall && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 px-4"
        >
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={requestMicPermission}
            className="w-full py-4 px-6 rounded-xl bg-amber-600 active:bg-amber-700 text-white font-medium flex items-center justify-center gap-3 shadow-lg"
            data-testid="button-request-mic"
          >
            <Mic className="w-6 h-6" />
            <span>Autoriser le microphone</span>
          </motion.button>
          <p className="text-gray-400 text-sm text-center mt-2">
            {micPermission === 'denied' 
              ? "Permission refusée. Activez-la dans Réglages > Safari" 
              : "Appuyez pour autoriser l'accès au micro"}
          </p>
        </motion.div>
      )}

      <div className="mt-10 sm:mt-16 flex justify-center items-center gap-4 sm:gap-6 md:gap-8 px-4 pb-4">
        {!isInCall ? (
          <>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={openBluetoothPanel}
              className={cn(
                "rounded-full flex items-center justify-center shrink-0",
                bluetoothStatus === "connected" 
                  ? "bg-blue-600 shadow-lg shadow-blue-500/40" 
                  : "bg-gray-700 active:bg-gray-600"
              )}
              style={{ width: 64, height: 64 }}
              data-testid="button-bluetooth"
            >
              <Bluetooth className={cn(
                "w-7 h-7",
                bluetoothStatus === "connected" ? "text-white" : "text-gray-300"
              )} />
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={startCall}
              className="w-20 h-20 sm:w-24 sm:h-24 rounded-full flex items-center justify-center shadow-2xl shrink-0 bg-green-500 active:bg-green-600 shadow-green-500/40"
              data-testid="button-start-call"
            >
              <Phone className="w-9 h-9 sm:w-10 sm:h-10 text-white" />
            </motion.button>
          </>
        ) : (
          <>
            {/* Simplified UI - just end call and audio controls */}
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={openBluetoothPanel}
              className={cn(
                "rounded-full flex items-center justify-center shrink-0",
                bluetoothStatus === "connected" 
                  ? "bg-blue-600 shadow-lg shadow-blue-500/40" 
                  : "bg-gray-700 active:bg-gray-600"
              )}
              style={{ width: 64, height: 64 }}
              data-testid="button-bluetooth-incall"
            >
              <Bluetooth className={cn(
                "w-7 h-7",
                bluetoothStatus === "connected" ? "text-white" : "text-gray-300"
              )} />
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={endCall}
              className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-red-500 active:bg-red-600 flex items-center justify-center shadow-2xl shadow-red-500/40 shrink-0"
              data-testid="button-end-call"
            >
              <PhoneOff className="w-9 h-9 sm:w-10 sm:h-10 text-white" />
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={handleAudioOutputClick}
              className="rounded-full bg-gray-700 active:bg-gray-600 flex items-center justify-center shrink-0"
              style={{ width: 64, height: 64 }}
              data-testid="button-audio-output"
            >
              <Volume2 className="w-7 h-7 text-gray-300" />
            </motion.button>
          </>
        )}
      </div>

      {isInCall && earbudsMode && (
        <div className="mt-3 flex justify-center">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-900/40 border border-green-700/50">
            <Bluetooth className="w-3.5 h-3.5 text-green-400" />
            <span className="text-xs text-green-300">Oreillettes — micro ouvert</span>
          </div>
        </div>
      )}

      <AnimatePresence>
        {showBluetoothPanel && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 flex items-end justify-center z-50"
            onClick={() => setShowBluetoothPanel(false)}
          >
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-gray-900 rounded-t-3xl p-6 pb-safe"
              style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px) + 24px, 40px)" }}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                  <Bluetooth className="w-5 h-5" />
                  Périphériques Audio
                </h2>
                <button
                  onClick={() => { triggerHaptic("light"); setShowBluetoothPanel(false); }}
                  className="p-2 rounded-full bg-gray-800 active:bg-gray-700"
                  data-testid="button-close-bluetooth"
                >
                  <X className="w-5 h-5 text-gray-400" />
                </button>
              </div>

              {isIOS && (
                <div className="mb-4 p-3 rounded-xl bg-blue-900/30 border border-blue-700/50">
                  <div className="flex items-start gap-3">
                    <Smartphone className="w-5 h-5 text-blue-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-blue-300 text-sm font-medium">Astuce iOS</p>
                      <p className="text-blue-400/80 text-xs mt-1">
                        Pour changer de sortie audio, ouvrez le Control Center et maintenez le contrôle audio
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="mb-4">
                <button
                  onClick={() => { triggerHaptic("light"); setEarbudsMode(!earbudsMode); }}
                  className={cn(
                    "w-full flex items-center justify-between p-4 rounded-xl transition-colors",
                    earbudsMode
                      ? "bg-green-900/40 border border-green-600/50"
                      : "bg-gray-800 border border-gray-700"
                  )}
                  data-testid="button-earbuds-mode"
                >
                  <div className="flex items-center gap-3">
                    <Bluetooth className={cn("w-5 h-5", earbudsMode ? "text-green-400" : "text-gray-400")} />
                    <div className="text-left">
                      <p className={cn("text-sm font-medium", earbudsMode ? "text-green-300" : "text-gray-300")}>
                        Mode oreillettes
                      </p>
                      <p className="text-xs text-gray-500">
                        Micro ouvert en continu (pas de coupure anti-écho)
                      </p>
                    </div>
                  </div>
                  <div className={cn(
                    "w-10 h-6 rounded-full relative transition-colors",
                    earbudsMode ? "bg-green-500" : "bg-gray-600"
                  )}>
                    <div className={cn(
                      "w-4 h-4 rounded-full bg-white absolute top-1 transition-all",
                      earbudsMode ? "left-5" : "left-1"
                    )} />
                  </div>
                </button>
              </div>

              <div className="space-y-3 mb-6">
                <div className="flex items-center gap-3 p-4 rounded-xl bg-gray-800">
                  {micBluetoothStatus === "connected" ? (
                    <CheckCircle2 className="w-6 h-6 text-green-500" />
                  ) : micBluetoothStatus === "none" ? (
                    <AlertCircle className="w-6 h-6 text-yellow-500" />
                  ) : (
                    <Mic className="w-6 h-6 text-gray-400" />
                  )}
                  <div className="flex-1">
                    <p className="text-white font-medium">
                      {micBluetoothStatus === "connected" 
                        ? "Micro Bluetooth détecté" 
                        : micBluetoothStatus === "none"
                          ? "Micro interne uniquement"
                          : "Vérification micro..."}
                    </p>
                    <p className="text-sm text-gray-400">
                      {inputDevices.length} micro{inputDevices.length !== 1 ? "s" : ""} disponible{inputDevices.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-3 p-4 rounded-xl bg-gray-800">
                  {bluetoothStatus === "connected" ? (
                    <CheckCircle2 className="w-6 h-6 text-green-500" />
                  ) : bluetoothStatus === "none" ? (
                    <AlertCircle className="w-6 h-6 text-yellow-500" />
                  ) : (
                    <Volume2 className="w-6 h-6 text-gray-400" />
                  )}
                  <div className="flex-1">
                    <p className="text-white font-medium">
                      {bluetoothStatus === "connected" 
                        ? "Sortie Bluetooth détectée" 
                        : bluetoothStatus === "none"
                          ? "Haut-parleur interne uniquement"
                          : "Vérification sortie..."}
                    </p>
                    <p className="text-sm text-gray-400">
                      {audioDevices.length === 0 
                        ? "iOS gère le routage audio" 
                        : `${audioDevices.length} sortie${audioDevices.length !== 1 ? "s" : ""} audio`}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mb-4">
                <p className="text-sm text-gray-400 mb-2 flex items-center gap-2">
                  <Mic className="w-4 h-4" /> Micros
                  <span className="text-xs text-green-400">(sélection active)</span>
                </p>
                <div className="space-y-2 max-h-24 overflow-y-auto">
                  {inputDevices.map((device, i) => {
                    const isBluetooth = ["bluetooth", "airpod", "earpod", "buds", "wireless", "bt", "headphone", "casque", "earphone", "wf-c510", "wf-c", "sony", "jabra", "bose", "beats"]
                      .some(kw => device.label.toLowerCase().includes(kw));
                    const isSelected = selectedInputId === device.deviceId;
                    return (
                      <button
                        key={device.deviceId || i}
                        onClick={() => selectInputDevice(device.deviceId, device.label)}
                        className={cn(
                          "w-full p-3 rounded-lg flex items-center gap-3 text-left transition-all",
                          isSelected 
                            ? "bg-green-600 border border-green-500" 
                            : isBluetooth 
                              ? "bg-green-900/30 border border-green-700 active:bg-green-800/50" 
                              : "bg-gray-800 active:bg-gray-700"
                        )}
                        data-testid={`button-select-input-${i}`}
                      >
                        {isSelected ? (
                          <Check className="w-5 h-5 text-white" />
                        ) : isBluetooth ? (
                          <Bluetooth className="w-5 h-5 text-green-400" />
                        ) : (
                          <Mic className="w-5 h-5 text-gray-400" />
                        )}
                        <span className={cn("text-sm truncate flex-1", isSelected ? "text-white font-medium" : "text-white")}>
                          {device.label || "Micro inconnu"}
                        </span>
                        {isSelected && <span className="text-xs text-green-200">Actif</span>}
                      </button>
                    );
                  })}
                  {inputDevices.length === 0 && (
                    <p className="text-gray-500 text-center py-2 text-sm">Aucun micro détecté</p>
                  )}
                </div>
              </div>

              <div className="mb-6">
                <p className="text-sm text-gray-400 mb-2 flex items-center gap-2">
                  <Volume2 className="w-4 h-4" /> Sorties audio
                  {sinkIdSupported && <span className="text-xs text-green-400">(sélection active)</span>}
                </p>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {audioDevices.map((device, i) => {
                    const isBluetooth = ["bluetooth", "airpod", "earpod", "buds", "wireless", "bt", "headphone", "casque", "earphone", "wf-c510", "wf-c", "sony", "jabra", "bose", "beats"]
                      .some(kw => device.label.toLowerCase().includes(kw));
                    const isSelected = selectedOutputId === device.deviceId;
                    return (
                      <button
                        key={device.deviceId || i}
                        onClick={() => selectOutputDevice(device.deviceId, device.label)}
                        className={cn(
                          "w-full p-3 rounded-lg flex items-center gap-3 text-left transition-all",
                          isSelected 
                            ? "bg-blue-600 border border-blue-500" 
                            : isBluetooth 
                              ? "bg-blue-900/30 border border-blue-700 active:bg-blue-800/50" 
                              : "bg-gray-800 active:bg-gray-700"
                        )}
                        data-testid={`button-select-output-${i}`}
                      >
                        {isSelected ? (
                          <Check className="w-5 h-5 text-white" />
                        ) : isBluetooth ? (
                          <Bluetooth className="w-5 h-5 text-blue-400" />
                        ) : (
                          <Volume2 className="w-5 h-5 text-gray-400" />
                        )}
                        <span className={cn("text-sm truncate flex-1", isSelected ? "text-white font-medium" : "text-white")}>
                          {device.label || "Sortie inconnue"}
                        </span>
                        {isSelected && <span className="text-xs text-blue-200">Actif</span>}
                      </button>
                    );
                  })}
                  {audioDevices.length === 0 && (
                    <div className="text-center py-4">
                      {isIOS ? (
                        <div className="space-y-2">
                          <Smartphone className="w-8 h-8 text-gray-500 mx-auto" />
                          <p className="text-gray-400 text-sm">Sur iOS, utilisez le Control Center</p>
                          <p className="text-gray-500 text-xs">Glissez depuis le coin supérieur droit, maintenez le contrôle audio et choisissez votre appareil Bluetooth</p>
                        </div>
                      ) : (
                        <p className="text-gray-500 text-sm">Aucune sortie détectée</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={checkBluetoothDevices}
                  variant="outline"
                  className="flex-1 bg-gray-800 border-gray-700 text-white"
                  data-testid="button-refresh-devices"
                >
                  Actualiser
                </Button>
                <Button
                  onClick={testAudioOutput}
                  disabled={isTestingAudio}
                  className="flex-1 bg-blue-600 hover:bg-blue-700"
                  data-testid="button-test-audio"
                >
                  {isTestingAudio ? <Loader2 className="w-4 h-4 animate-spin" /> : "Tester le son"}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
