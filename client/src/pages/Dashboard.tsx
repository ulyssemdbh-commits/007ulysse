import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useConversations, useCreateConversation, useConversation } from "@/hooks/use-chat";
import { useVoice } from "@/hooks/use-voice";
import { useSharedVoice } from "@/components/VoiceProvider";
import { useRealtimeVoice } from "@/hooks/use-realtime-voice";
import { useRealtimeDiagnostics } from "@/hooks/use-realtime-diagnostics";
import { useAuth } from "@/hooks/use-auth";
import { useVisibility, useReducedMotion, useIOSDetection } from "@/hooks/use-visibility";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useDeviceId } from "@/hooks/useDeviceId";
import { usePanelManager } from "@/hooks/usePanelManager";
import { useOrbState } from "@/hooks/useOrbState";
import { emitChatSync, setSharedConversationId } from "@/contexts/UlysseChatContext";
import { removeNavigationTagFromResponse, type NavigationDestination } from "@/hooks/useNavigationRequest";
import { processAssistantResponse, cleanResponseForTTS } from "@/utils/responseProcessor";
import { UlysseAvatar } from "@/components/visualizer/UlysseAvatar";
import { IrisAvatar } from "@/components/visualizer/IrisAvatar";
import { AlfredAvatar } from "@/components/visualizer/AlfredAvatar";
import { AudioVisualizer } from "@/components/visualizer/AudioVisualizer";
import { ConversationHistory } from "@/components/ConversationHistory";
import { VoiceSettingsPanel } from "@/components/VoiceSettingsPanel";
import { CodeSnapshotModal } from "@/components/CodeSnapshotModal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Send, Volume2, VolumeX, Sparkles, Activity, Plus, History, Mic, MicOff, Brain, LogOut, AlertTriangle, X, FolderOpen, Stethoscope, Zap, BookOpen, Pencil, MapPin, Camera, Eye, Music, Phone, PhoneOff, Menu, Check, Trophy, DollarSign, Settings, Mail, Store, ListTodo, BarChart3, ChevronsUp, ChevronsDown, ShieldCheck, ShieldAlert, ShieldQuestion, Wand2, GitBranch, Copy, Users } from "lucide-react";
import { useLocation } from "wouter";
import { ImageEditor } from "@/components/ImageEditor";
import { StudioPanel } from "@/components/StudioPanel";
import { MemoryPanel } from "@/components/MemoryPanel";
import { DiagnosticsPanel } from "@/components/DiagnosticsPanel";
import { GeneratedFilesModal } from "@/components/GeneratedFilesModal";
import { HomeworkPanel } from "@/components/HomeworkPanel";
import { GeolocationPanel } from "@/components/GeolocationPanel";
import IntegrationsPanel from "@/components/IntegrationsPanel";
import { EmailPanel } from "@/components/EmailPanel";
import { CameraCapture } from "@/components/CameraCapture";
import { LiveVision } from "@/components/LiveVision";
import { FileUpload } from "@/components/FileUpload";
import { MarseilleInfo } from "@/components/MarseilleInfo";
import { DisplayWindow, useDisplayWindow } from "@/components/DisplayWindow";
import { ProgressTrackerInline } from "@/components/ProgressTracker";
import { PreviewConfirmationCard } from "@/components/PreviewConfirmationCard";
import { useAIPreview } from "@/hooks/useAIPreview";
import { PCMonitorToggle } from "@/components/PCMonitorToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { analyzeMood, ConversationMood, moodColorMap, getAmbiance } from "@/lib/mood";

export default function Dashboard() {
  const [, navigate] = useLocation();
  const { data: conversations } = useConversations();
  const createConversation = useCreateConversation();
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();
  
  // Persona name: Ulysse for owner, Max for external users, Iris for approved family
  const isExternal = user?.role === "external";
  const personaName = useMemo(() => 
    user?.isOwner ? "Ulysse" : isExternal ? "Max" : "Iris", 
    [user?.isOwner, isExternal]
  ) as "Ulysse" | "Iris" | "Max";
  
  // Use shared hooks for device identification and panel management
  const deviceId = useDeviceId({ prefix: "desktop" });
  const panels = usePanelManager();
  
  const [activeConversationId, setActiveConversationId] = useState<number | null>(() => {
    const saved = localStorage.getItem("ulysse-active-conversation");
    return saved ? parseInt(saved, 10) : null;
  });
  const [input, setInput] = useState("");
  const [burgerMenuOpen, setBurgerMenuOpen] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [copiedMsgIdx, setCopiedMsgIdx] = useState<number | null>(null);
  
  // Detect searching/analyzing states from streaming content for orb visualization
  const isSearching = useMemo(() => {
    if (!isStreaming || !streamingContent) return false;
    const searchKeywords = ["recherche", "searching", "🔍", "sources", "web", "internet", "MARS"];
    return searchKeywords.some(kw => streamingContent.toLowerCase().includes(kw.toLowerCase()));
  }, [isStreaming, streamingContent]);
  
  const isAnalyzing = useMemo(() => {
    if (!isStreaming || !streamingContent) return false;
    const analyzeKeywords = ["analyse", "analyzing", "recoup", "vérifi", "cross-check", "fiabilité"];
    return analyzeKeywords.some(kw => streamingContent.toLowerCase().includes(kw.toLowerCase()));
  }, [isStreaming, streamingContent]);
  
  // V3 Pro Voice Call - same capabilities as TalkingApp V3 Pro
  const voiceCall = useRealtimeVoice({
    userName: user?.displayName || user?.username || "User",
    conversationId: activeConversationId ?? undefined,
    channel: "talking-v2", // TTS priority + V3 Pro capabilities
    onTranscript: (text) => {
      console.log("[Dashboard V3 Pro] Transcript:", text);
      // Refresh conversation to show the user's message
      if (activeConversationId) {
        queryClient.invalidateQueries({ queryKey: ["/api/conversations", activeConversationId] });
      }
    },
    onResponse: (text) => {
      console.log("[Dashboard V3 Pro] Response:", text);
      // Refresh conversation to show Ulysse's response in the chat
      if (activeConversationId) {
        queryClient.invalidateQueries({ queryKey: ["/api/conversations", activeConversationId] });
      }
    },
    onError: (error) => {
      console.error("[Dashboard V3 Pro] Error:", error);
    },
  });
  
  // State to track if user wants to start a call
  const [wantsToCall, setWantsToCall] = useState(false);
  
  // Map to call-style interface for compatibility
  const isInCall = voiceCall.isListening || voiceCall.isSpeaking;
  const callState = voiceCall.connectionState === "authenticated" 
    ? (voiceCall.isListening ? "in_call" : "connected")
    : voiceCall.connectionState === "connecting" || voiceCall.connectionState === "authenticating"
      ? "connecting" 
      : "idle";
  
  // Auto-start listening when authenticated and user wants to call
  // Don't restart while processing (after silence detection) - wait for server response via ref flag
  const voiceState = voiceCall.voiceState;
  useEffect(() => {
    // Check ref-based flag to prevent race condition (state updates can be delayed)
    if (voiceCall.isProcessingBlocked?.()) {
      console.log("[Dashboard V3 Pro] Restart blocked - still processing audio");
      return;
    }
    if (wantsToCall && voiceCall.connectionState === "authenticated" && !voiceCall.isListening && voiceState !== "processing") {
      console.log("[Dashboard V3 Pro] Auto-starting listening after auth...");
      voiceCall.startListening();
    }
  }, [wantsToCall, voiceCall.connectionState, voiceCall.isListening, voiceState, voiceCall]);
  
  const startCall = useCallback(async () => {
    console.log("[Dashboard V3 Pro] Starting call...");
    setWantsToCall(true);
    voiceCall.connect();
  }, [voiceCall]);
  
  const endCall = useCallback(() => {
    console.log("[Dashboard V3 Pro] Ending call...");
    setWantsToCall(false);
    voiceCall.stopListening();
    voiceCall.disconnect();
  }, [voiceCall]);
  
  // Use shared autoSpeak from VoiceProvider context
  const { autoSpeak, setAutoSpeak } = useSharedVoice();
  const [visualMode, setVisualMode] = useState<"orb" | "avatar" | "equalizer">("avatar");
  const [orbColor, setOrbColor] = useState("#6366f1");
  const [orbIntensity, setOrbIntensity] = useState(50);
  const [voiceSpeed, setVoiceSpeed] = useState(100);
  const [voicePitch, setVoicePitch] = useState(100);
  const [ambientSound, setAmbientSound] = useState<string>("none");
  const [ambientVolume, setAmbientVolume] = useState(30);
  const [profileGradient, setProfileGradient] = useState<string | null>(null);
  useEffect(() => {
    const validTypes = ["rain", "forest", "ocean", "space"];
    if (ambientSound && ambientSound !== "none" && validTypes.includes(ambientSound)) {
      import("@/lib/ambientSounds").then(({ startAmbientSound }) => {
        startAmbientSound(ambientSound as "rain" | "forest" | "ocean" | "space", ambientVolume);
      });
    } else {
      import("@/lib/ambientSounds").then(({ stopAmbientSound }) => {
        stopAmbientSound();
      });
    }
    return () => {
      import("@/lib/ambientSounds").then(({ stopAmbientSound }) => {
        stopAmbientSound();
      });
    };
  }, [ambientSound]);

  useEffect(() => {
    import("@/lib/ambientSounds").then(({ setAmbientVolume }) => {
      setAmbientVolume(ambientVolume);
    });
  }, [ambientVolume]);
  
  const [hasGreeted, setHasGreeted] = useState(false);
  
  // Geolocation accuracy mode - balanced by default
  const [geoAccuracyMode, setGeoAccuracyMode] = useState<"high" | "balanced" | "low">("balanced");
  const [navigationDestination, setNavigationDestination] = useState<NavigationDestination | null>(null);
  
  // Geolocation hook at Dashboard level to persist tracking when panel is closed
  const geo = useGeolocation({
    enableHighAccuracy: geoAccuracyMode === "high",
    updateIntervalMs: geoAccuracyMode === "high" ? 30000 : geoAccuracyMode === "balanced" ? 300000 : 600000,
  });
  
  // Restart tracking when accuracy mode changes (to apply new GPS settings)
  const prevAccuracyModeRef = useRef(geoAccuracyMode);
  useEffect(() => {
    if (prevAccuracyModeRef.current !== geoAccuracyMode && geo.isTracking) {
      // Stop and restart to apply new accuracy settings
      geo.stopTracking().then(() => {
        geo.startTracking();
      });
    }
    prevAccuracyModeRef.current = geoAccuracyMode;
  }, [geoAccuracyMode, geo.isTracking]);
  
  // Display window for showing Ulysse's work, analyses, images
  const displayWindow = useDisplayWindow();
  
  // Callback for search results from WebSocket
  const handleSearchResults = useCallback((data: any) => {
    // For Google Images or media library results, show in image grid format
    if ((data.source === "google_images" || data.source === "google_images_auto" || data.source === "media_library") && data.images && data.images.length > 0) {
      const gridImages = data.images.map((img: any) => ({
        url: img.link,
        thumbnailUrl: img.thumbnailLink,
        title: img.title,
        link: img.contextLink,
        width: img.width,
        height: img.height
      }));
      const title = data.source === "media_library" 
        ? `Photos de ${data.personName || data.query}` 
        : `Images: ${data.query}`;
      displayWindow.showImageGrid(gridImages, title);
    } else {
      displayWindow.showSearchResults(data, `Résultats: ${data.query}`);
    }
  }, [displayWindow.showSearchResults, displayWindow.showImageGrid]);
  
  // Pre-thinking state for real-time reading feedback
  const [preThinkResult, setPreThinkResult] = useState<{ intent: string | null; isReading: boolean } | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Real-time sync across all devices/portals with search results handler
  const { sendTypingUpdate } = useRealtimeSync({ 
    userId: user?.id,
    onSearchResults: handleSearchResults,
    onPreThink: (result) => {
      setPreThinkResult({ intent: result.intent, isReading: result.isReading });
    }
  });

  // Debounced typing update to send while user types
  const handleTypingUpdate = useCallback((text: string) => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    if (text.length >= 10) {
      setPreThinkResult({ intent: null, isReading: true });
      typingTimeoutRef.current = setTimeout(() => {
        sendTypingUpdate(text, activeConversationId ?? undefined);
      }, 300); // 300ms debounce
    } else {
      setPreThinkResult(null);
    }
  }, [sendTypingUpdate, activeConversationId]);
  
  // AI preview confirmation for user verification before continuing
  const aiPreview = useAIPreview({ userId: user?.id });
  
  const [pendingFileAnalysis, setPendingFileAnalysis] = useState<{ content: string; fileName: string; imageDataUrl?: string; pdfPageImages?: string[]; pdfBase64Full?: string } | null>(null);
  const [showImageEditor, setShowImageEditor] = useState(false);
  const dailyTriggerRef = useRef(false);
  
  // Trigger daily homework execution on first connection each day
  useEffect(() => {
    if (dailyTriggerRef.current || !user) return;
    dailyTriggerRef.current = true;
    
    const lastTrigger = localStorage.getItem("ulysse-daily-trigger-date");
    const today = new Date().toDateString();
    
    if (lastTrigger !== today) {
      localStorage.setItem("ulysse-daily-trigger-date", today);
      fetch("/api/homework/daily-trigger", {
        method: "POST",
        credentials: "include",
      }).then(res => {
        if (res.ok) {
          res.json().then(data => {
            if (data.executedCount > 0) {
              console.log(`[Homework] Executed ${data.executedCount} daily tasks`);
            }
          });
        }
      }).catch(err => {
        console.error("Failed to trigger daily homework:", err);
      });
    }
  }, [user]);
  
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const LONG_PRESS_DURATION = 2000;
  
  const handleLogoLongPressStart = useCallback(() => {
    if (!user?.isOwner) return;
    longPressTimerRef.current = setTimeout(() => {
      panels.openPanel("codeSnapshot");
    }, LONG_PRESS_DURATION);
  }, [user?.isOwner, panels.openPanel]);
  
  const handleLogoLongPressEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);
  
  const [conversationMode, setConversationMode] = useState(false);
  const [useRealtimeMode, setUseRealtimeMode] = useState(() => {
    const saved = localStorage.getItem("ulysse-realtime-mode");
    return saved === "true";
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingVoiceMessageRef = useRef<string>("");
  const manualStopRef = useRef(false);
  const handleSendMessageRef = useRef<(text?: string) => void>(() => {});

  const prefersReducedMotion = useReducedMotion();
  const { isIPhone15Pro } = useIOSDetection();
  
  const suspendAudioRef = useRef<(() => Promise<void>) | null>(null);
  const resumeAudioRef = useRef<(() => Promise<void>) | null>(null);
  const isListeningRef = useRef(false);
  
  const { isPaused: isAppPaused } = useVisibility({
    pauseAfterMs: 30000,
    onHidden: useCallback(() => {
      if (isListeningRef.current) {
        console.log("App backgrounded - pausing voice");
      }
      suspendAudioRef.current?.();
    }, []),
    onVisible: useCallback(() => {
      console.log("App resumed");
      resumeAudioRef.current?.();
    }, [])
  });
  
  const { 
    isListening, 
    isSpeaking, 
    transcript, 
    sttSupported,
    ttsSupported,
    lastSpokenText,
    micPermission,
    permissionsReady,
    ttsUnlocked,
    isIOS,
    isProcessing,
    wakeWordActive,
    startListening, 
    stopListening, 
    speak, 
    stopSpeaking,
    interrupt,
    setTranscript,
    unlockTTS,
    setWakeWordActive,
    requestMicrophonePermission,
    suspendAudio,
    resumeAudio,
    setOnAutoSubmit
  } = useVoice();
  
  // Slide to unlock TTS on iOS
  const slideStartXRef = useRef<number>(0);
  const [slideProgress, setSlideProgress] = useState(0);
  const [isSliding, setIsSliding] = useState(false);
  const SLIDE_THRESHOLD = 0.65; // 65% of track width to unlock (easier)
  const TRACK_WIDTH = 300; // px - wider for easier use
  
  const handleSlideTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    slideStartXRef.current = touch.clientX;
    setIsSliding(true);
    setSlideProgress(0);
  }, []);
  
  const slideUnlockedRef = useRef(false);
  
  const handleSlideTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isSliding) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - slideStartXRef.current;
    const progress = Math.max(0, Math.min(1, deltaX / (TRACK_WIDTH - 60)));
    setSlideProgress(progress);
    
    // Auto-trigger when threshold reached (no need to release)
    if (progress >= SLIDE_THRESHOLD && !slideUnlockedRef.current) {
      slideUnlockedRef.current = true;
      console.log("[TTS] Slide threshold reached, unlocking immediately...");
      unlockTTS();
      // Reset slider state
      setIsSliding(false);
      setSlideProgress(0);
    }
  }, [isSliding, unlockTTS]);
  
  const handleSlideTouchEnd = useCallback(() => {
    // Only reset if not already unlocked
    if (!slideUnlockedRef.current && slideProgress >= SLIDE_THRESHOLD) {
      console.log("[TTS] Slide complete on release, unlocking...");
      unlockTTS();
    }
    slideUnlockedRef.current = false;
    setIsSliding(false);
    setSlideProgress(0);
  }, [slideProgress, unlockTTS]);
  
  useEffect(() => {
    suspendAudioRef.current = suspendAudio;
    resumeAudioRef.current = resumeAudio;
  }, [suspendAudio, resumeAudio]);
  
  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  // Echo prevention: track when TTS ends for cooldown period
  const ttsEndTimeRef = useRef<number>(0);
  const wasListeningBeforeTTSRef = useRef<boolean>(false);

  // Get conversation context for realtime voice
  const { data: activeConversation } = useConversation(activeConversationId);
  
  const conversationContext = useMemo(() => {
    return activeConversation?.messages?.slice(-10).map(m => ({
      role: m.role,
      content: m.content
    })) || [];
  }, [activeConversation?.messages]);

  // Realtime diagnostics hook - tracks errors and issues in realtime
  const diagnostics = useRealtimeDiagnostics();

  // Realtime voice hook - WebSocket-based for fluid conversations
  const realtime = useRealtimeVoice({
    context: conversationContext,
    conversationId: activeConversationId ?? undefined,
    onTranscript: (text) => {
      console.log("Realtime transcript:", text);
    },
    onResponse: (text) => {
      console.log("Realtime response:", text);
      // Add messages to conversation
      if (activeConversationId) {
        queryClient.invalidateQueries({ queryKey: ["/api/conversations", activeConversationId] });
      }
    },
    onError: (error) => {
      console.error("Realtime error:", error);
      diagnostics.trackVoiceError("websocket", `Realtime voice error: ${error}`, undefined, async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        realtime.disconnect();
        await new Promise(resolve => setTimeout(resolve, 500));
        realtime.connect();
        return true;
      });
    }
  });

  // Track voice permission issues (network is tracked internally by the hook)
  const lastMicPermissionRef = useRef(micPermission);
  useEffect(() => {
    if (micPermission === "denied" && lastMicPermissionRef.current !== "denied") {
      diagnostics.logEvent("voice_permission_denied", "voice", "Microphone permission denied");
    }
    lastMicPermissionRef.current = micPermission;
  }, [micPermission, diagnostics]);

  // Persist realtime mode preference
  useEffect(() => {
    localStorage.setItem("ulysse-realtime-mode", String(useRealtimeMode));
  }, [useRealtimeMode]);

  // Sync mic state to localStorage
  useEffect(() => {
    localStorage.setItem("ulysse-mic-active", String(isListening));
  }, [isListening]);

  // Restore mic state from localStorage on mount (if it was active on login page)
  const hasMicRestoredRef = useRef(false);
  useEffect(() => {
    if (hasMicRestoredRef.current || !permissionsReady) return;
    hasMicRestoredRef.current = true;
    
    const savedMicState = localStorage.getItem("ulysse-mic-active");
    if (savedMicState === "true" && !isListening && micPermission !== "denied") {
      startListening();
    }
  }, [permissionsReady, isListening, micPermission, startListening]);

  // Analyze conversation mood based on recent messages
  const conversationMood = useMemo<ConversationMood>(() => {
    if (!activeConversation?.messages || activeConversation.messages.length === 0) {
      return "neutral";
    }
    return analyzeMood(activeConversation.messages);
  }, [activeConversation?.messages]);

  const moodColors = moodColorMap[conversationMood];
  const ambiance = useMemo(() => getAmbiance(conversationMood), [conversationMood]);

  useEffect(() => {
    if (activeConversationId) {
      setSharedConversationId(activeConversationId);
    }
  }, [activeConversationId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.conversationId && detail.source !== "dashboard") {
        if (detail.conversationId === activeConversationId) {
          queryClient.invalidateQueries({ queryKey: ["/api/conversations", activeConversationId] });
        } else {
          setActiveConversationId(detail.conversationId);
        }
      }
    };
    window.addEventListener("ulysse:chat-sync", handler);
    return () => window.removeEventListener("ulysse:chat-sync", handler);
  }, [activeConversationId, queryClient]);

  // Initialize or restore conversation - only runs once on mount
  const hasInitializedRef = useRef(false);
  useEffect(() => {
    if (!conversations || hasInitializedRef.current) return;
    
    // If we have a saved ID, verify it still exists
    if (activeConversationId) {
      const exists = conversations.some(c => c.id === activeConversationId);
      if (exists) {
        hasInitializedRef.current = true;
        return; // Conversation exists, keep it
      }
      // Saved conversation no longer exists, reset
      localStorage.removeItem("ulysse-active-conversation");
    }
    
    // Pick existing conversation or create new one
    if (conversations.length > 0) {
      const mainConv = conversations.find(c => c.title === "Ulysse Hub") || conversations[0];
      setActiveConversationId(mainConv.id);
      hasInitializedRef.current = true;
    } else if (!createConversation.isPending) {
      hasInitializedRef.current = true;
      createConversation.mutate("Ulysse Hub", {
        onSuccess: (newConv) => setActiveConversationId(newConv.id)
      });
    }
  }, [conversations, activeConversationId, createConversation.isPending]);

  // Permission is now auto-requested by the hook on startup
  // This effect handles re-requesting if permission was denied
  useEffect(() => {
    if (micPermission === "denied" && !permissionsReady) {
      console.log("Microphone permission denied - user can click mic button to retry");
    }
  }, [micPermission, permissionsReady]);

  // iOS: Unlock audio on first touch anywhere on the page
  useEffect(() => {
    if (!isIOS || ttsUnlocked) return;
    
    const handleFirstTouch = async () => {
      console.log("iOS first touch - unlocking audio...");
      await unlockTTS();
      document.removeEventListener("touchstart", handleFirstTouch);
      document.removeEventListener("click", handleFirstTouch);
    };
    
    document.addEventListener("touchstart", handleFirstTouch, { once: true, passive: true });
    document.addEventListener("click", handleFirstTouch, { once: true });
    
    return () => {
      document.removeEventListener("touchstart", handleFirstTouch);
      document.removeEventListener("click", handleFirstTouch);
    };
  }, [isIOS, ttsUnlocked, unlockTTS]);

  // Personalized greetings: Ulysse greets Maurice, Iris greets the daughters
  // On iOS, wait for TTS to be unlocked (requires user touch first)
  useEffect(() => {
    if (!user || hasGreeted || !permissionsReady) return;
    // On iOS, wait for TTS to be unlocked before greeting
    if (isIOS && !ttsUnlocked) return;
    
    const greetUser = async () => {
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (!autoSpeak) return;
      
      let greeting = "";
      if (user.isOwner) {
        greeting = "Hi Morris!";
      } else {
        const greetings: Record<string, string> = {
          "KellyIris001": "Hi Kelly!",
          "LennyIris002": "Hi Lenny!",
          "MickyIris003": "Hi Micky!"
        };
        greeting = greetings[user.username] || `Hi ${user.displayName || user.username}!`;
      }
      
      speak(greeting);
      setHasGreeted(true);
    };
    
    greetUser();
  }, [user, hasGreeted, permissionsReady, autoSpeak, speak, isIOS, ttsUnlocked]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeConversation?.messages, streamingContent]);

  // Voice conversation mode: say "Hey Ulysse" (owner) or "Hey Iris" (approved users) to start, "Over" to end
  useEffect(() => {
    if (!transcript) return;
    
    // CRITICAL: Block ALL transcripts while speaking - this is the main echo prevention
    if (isSpeaking) {
      console.log("[EchoBlock] Ignoring transcript while speaking:", transcript.slice(0, 30));
      return;
    }
    
    // Also block transcripts that arrived too soon after TTS ended (reduced from 2000ms to 800ms for faster response)
    const timeSinceTTS = Date.now() - ttsEndTimeRef.current;
    if (timeSinceTTS < 800 && ttsEndTimeRef.current > 0) {
      console.log("[EchoBlock] Ignoring transcript during cooldown:", transcript.slice(0, 30));
      setTranscript("");
      pendingVoiceMessageRef.current = "";
      return;
    }
    
    const lowerTranscript = transcript.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const isOwner = user?.isOwner;
    
    // Wake words based on persona
    const ulysseWakeWords = ["hey ulysse", "he ulysse", "eh ulysse", "hey ulisse", "he ulisse", "ulysse", "ulisse", "hey ulis", "he ulis", "eh ulis", "ulis"];
    const irisWakeWords = ["hey iris", "he iris", "eh iris", "iris"];
    const wakeWords = isOwner ? ulysseWakeWords : irisWakeWords;
    
    console.log("Transcript received:", transcript);
    
    // "On reprend plus tard" - deactivates mic only, speakers stay active
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
    
    // "Over" - deactivates BOTH mic and speakers completely
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
      // No spoken response since we're turning off speakers too
      return;
    }
    
    // Check if transcript contains wake word to start conversation mode
    const hasWakeWord = wakeWords.some(wake => lowerTranscript.includes(wake));
    
    if (hasWakeWord && !conversationMode) {
      console.log(`Starting conversation mode via wake word (${personaName})`);
      setConversationMode(true);
      
      // Extract the command after the wake word
      let command = transcript;
      for (const wake of wakeWords) {
        const idx = lowerTranscript.indexOf(wake);
        if (idx !== -1) {
          command = transcript.slice(idx + wake.length).trim();
          break;
        }
      }
      
      // If there's a command after wake word, send it
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
      // In conversation mode, send everything directly
      pendingVoiceMessageRef.current = transcript;
    } else if (isListening && transcript.trim().length > 2) {
      // When mic is active (user clicked mic button), send messages directly
      // This allows voice input without requiring wake word when actively listening
      console.log("Direct voice message (mic active):", transcript);
      pendingVoiceMessageRef.current = transcript;
      setConversationMode(true); // Enter conversation mode for follow-ups
    }
  }, [transcript, conversationMode, ttsSupported, speak, isSpeaking, stopSpeaking, isListening, user?.isOwner, personaName]);

  // In conversation mode, process messages after brief pause
  useEffect(() => {
    if (conversationMode && pendingVoiceMessageRef.current && !isStreaming) {
      const timer = setTimeout(() => {
        const message = pendingVoiceMessageRef.current;
        if (message.trim() && message.length > 2) {
          pendingVoiceMessageRef.current = "";
          setTranscript("");
          handleSendMessage(message);
        }
      }, 1500); // Wait 1.5s of silence before sending
      return () => clearTimeout(timer);
    }
  }, [transcript, conversationMode, isStreaming]);

  // Register auto-submit callback for "à toi" voice trigger
  useEffect(() => {
    setOnAutoSubmit((text: string) => {
      console.log("[Dashboard] 'À toi' triggered auto-submit:", text.slice(0, 30));
      setConversationMode(true);
      handleSendMessageRef.current(text);
    });
    return () => setOnAutoSubmit(null);
  }, [setOnAutoSubmit]);

  const handleSendMessage = useCallback(async (messageText?: string) => {
    let content = messageText || input;
    
    // If there's a pending file analysis, include it in the message
    let imageDataUrl: string | undefined;
    let pdfPageImages: string[] | undefined;
    let pdfBase64Full: string | undefined;
    let pdfFileName: string | undefined;
    if (pendingFileAnalysis) {
      if (pendingFileAnalysis.imageDataUrl) {
        imageDataUrl = pendingFileAnalysis.imageDataUrl;
        const imageSizeKB = (imageDataUrl.length / 1024).toFixed(1);
        console.log(`[VISION] Sending image for analysis: ${pendingFileAnalysis.fileName} (${imageSizeKB}KB base64)`);
        content = content || "Analyse cette image en détail et décris ce que tu vois.";
      } else if (pendingFileAnalysis.pdfPageImages && pendingFileAnalysis.pdfPageImages.length > 0) {
        pdfPageImages = pendingFileAnalysis.pdfPageImages;
        const fileContext = `[FICHIER PDF JOINT: ${pendingFileAnalysis.fileName}]\n\nContenu textuel extrait:\n${pendingFileAnalysis.content.slice(0, 15000)}\n\n---\n\n${content || "Analyse ce PDF : son contenu ET son design/mise en page."}`;
        content = fileContext;
        console.log(`[VISION] Sending PDF with ${pdfPageImages.length} page images + text for: ${pendingFileAnalysis.fileName}`);
      } else {
        const fileContext = `[FICHIER JOINT: ${pendingFileAnalysis.fileName}]\n\nContenu du fichier:\n${pendingFileAnalysis.content.slice(0, 15000)}\n\n---\n\n${content || "Analyse ce fichier et donne-moi un résumé."}`;
        content = fileContext;
      }
      if (pendingFileAnalysis.pdfBase64Full) {
        pdfBase64Full = pendingFileAnalysis.pdfBase64Full;
        pdfFileName = pendingFileAnalysis.fileName;
        console.log(`[PDF-FALLBACK] Including PDF base64 for server-side save: ${pendingFileAnalysis.fileName}`);
      }
      setPendingFileAnalysis(null);
    }
    
    if (!content.trim() || !activeConversationId || isStreaming) return;
    
    setInput("");
    setPreThinkResult(null); // Clear pre-thinking state on send
    setIsStreaming(true);
    setStreamingContent("");

    // Optimistically add user message
    queryClient.setQueryData(["/api/conversations", activeConversationId], (old: any) => ({
      ...old,
      messages: [...(old?.messages || []), { role: "user", content, createdAt: new Date() }]
    }));

    let fullResponse = "";

    // Timeout controller for long requests (90s max)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    try {
      const res = await fetch(`/api/conversations/${activeConversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, imageDataUrl, pdfPageImages, pdfBase64Full, pdfFileName }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        if (res.status === 401) {
          throw new Error("Session expirée - veuillez vous reconnecter");
        }
        throw new Error("Erreur de communication avec Ulysse");
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) return;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n\n");
        
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                fullResponse += data.content;
                setStreamingContent(fullResponse);
              }
              if (data.type === "done" && data.confidenceLevel) {
                lastConfidenceRef.current = { confidence: data.confidence, confidenceLevel: data.confidenceLevel };
              }
            } catch (e) {}
          }
        }
      }

      // Add assistant message to cache before invalidating
      if (fullResponse) {
        const msgConfidence = lastConfidenceRef.current;
        lastConfidenceRef.current = null;
        queryClient.setQueryData(["/api/conversations", activeConversationId], (old: any) => ({
          ...old,
          messages: [...(old?.messages || []), { role: "assistant", content: fullResponse, createdAt: new Date(), confidence: msgConfidence?.confidence, confidenceLevel: msgConfidence?.confidenceLevel }]
        }));
        
        // Process display markers and navigation commands
        await processAssistantResponse({
          fullResponse,
          displayWindow,
          panels,
          setNavigationDestination,
        });
      }
    } catch (err: any) {
      console.error("Streaming error", err);
      clearTimeout(timeoutId);
      
      // Show error message to user
      const errorMessage = err.name === "AbortError" 
        ? "Ulysse met trop de temps à répondre. Réessayez."
        : err.message || "Erreur de communication avec Ulysse";
      
      // Add error message to conversation
      queryClient.setQueryData(["/api/conversations", activeConversationId], (old: any) => ({
        ...old,
        messages: [...(old?.messages || []), { 
          role: "assistant", 
          content: `⚠️ ${errorMessage}`, 
          createdAt: new Date() 
        }]
      }));
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
      emitChatSync(activeConversationId!, "dashboard");
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", activeConversationId] });
      
      if (autoSpeak && fullResponse && ttsSupported) {
        const cleanText = cleanResponseForTTS(removeNavigationTagFromResponse(fullResponse)).slice(0, 500);
        console.log("Ulysse speaking:", cleanText.slice(0, 100));
        speak(cleanText);
      }
    }
  }, [input, activeConversationId, isStreaming, queryClient, autoSpeak, ttsSupported, speak, pendingFileAnalysis]);

  // Keep ref updated for voice auto-submit callback
  useEffect(() => {
    handleSendMessageRef.current = handleSendMessage;
  }, [handleSendMessage]);

  const handleSend = () => handleSendMessage();

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      // Stop speaking before starting to listen
      if (isSpeaking) stopSpeaking();
      startListening();
    }
  }, [isListening, isSpeaking, stopListening, stopSpeaking, startListening]);

  // CRITICAL FIX: Stop speech recognition when Ulysse speaks to prevent echo loops
  // This is more reliable than trying to filter out Ulysse's own speech
  useEffect(() => {
    if (isSpeaking) {
      // Stop speech recognition when TTS starts
      if (isListening) {
        console.log("[EchoFix] Stopping mic while Ulysse speaks");
        wasListeningBeforeTTSRef.current = true;
        stopListening();
      }
      // Clear any pending voice messages to avoid echo
      pendingVoiceMessageRef.current = "";
      setTranscript("");
    } else {
      // TTS just ended - record time and schedule mic restart
      ttsEndTimeRef.current = Date.now();
    }
  }, [isSpeaking, isListening, stopListening]);
  
  // Restart listening after TTS ends with cooldown
  useEffect(() => {
    if (!isSpeaking && conversationMode && sttSupported && !isListening && !isStreaming && !manualStopRef.current) {
      const timeSinceTTSEnd = Date.now() - ttsEndTimeRef.current;
      const cooldown = Math.max(0, 1500 - timeSinceTTSEnd); // 1.5s cooldown after TTS
      
      const timer = setTimeout(() => {
        if (!isSpeaking && !isListening && !manualStopRef.current) {
          console.log("[EchoFix] Restarting mic after TTS cooldown");
          startListening();
        }
      }, cooldown);
      return () => clearTimeout(timer);
    }
  }, [conversationMode, sttSupported, isListening, isStreaming, isSpeaking, startListening]);
  
  // Helper function to detect if transcript is echo of Ulysse's speech
  const isEchoOfTTS = useCallback((text: string): boolean => {
    if (!lastSpokenText) return false;
    
    const normalizedTranscript = text.toLowerCase().trim().replace(/[.,!?'"]/g, "");
    const normalizedSpoken = lastSpokenText.toLowerCase().replace(/[.,!?'"]/g, "");
    
    // Extract words (3+ chars) from both
    const transcriptWords = normalizedTranscript.split(/\s+/).filter(w => w.length >= 3);
    const spokenWords = normalizedSpoken.split(/\s+/).filter(w => w.length >= 3);
    
    if (transcriptWords.length === 0) return false;
    
    // Count matching words
    let matchCount = 0;
    for (const word of transcriptWords) {
      if (spokenWords.some(sw => sw.includes(word) || word.includes(sw))) {
        matchCount++;
      }
    }
    
    // If >40% of words match Ulysse's speech, it's echo
    const matchRatio = matchCount / transcriptWords.length;
    return matchRatio > 0.4;
  }, [lastSpokenText]);
  
  // Filter echo transcripts - don't process anything that sounds like Ulysse
  const lastInterruptCheckRef = useRef<string>("");
  const lastConfidenceRef = useRef<{ confidence: number; confidenceLevel: string } | null>(null);
  
  useEffect(() => {
    // Extra safety: if we get a transcript right after TTS ended, ignore it
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

  const lastMessages = activeConversation?.messages || [];
  const isActive = isStreaming || isSpeaking || isListening;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isSpeaking) stopSpeaking();
        if (panels.showHistory) panels.closePanel();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && input.trim() && !isStreaming) {
        e.preventDefault();
        handleSend();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "m" && sttSupported) {
        e.preventDefault();
        toggleListening();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "h") {
        e.preventDefault();
        panels.togglePanel("history");
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "n") {
        e.preventDefault();
        createConversation.mutate("Ulysse Hub", {
          onSuccess: (newConv) => setActiveConversationId(newConv.id)
        });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [input, isStreaming, isSpeaking, panels.showHistory, sttSupported, toggleListening, stopSpeaking, handleSend, createConversation]);

  return (
    <div className="min-h-screen bg-background flex flex-col overflow-x-hidden relative">
      {/* Ambient background layers - profile gradient + time/mood fallback */}
      <div className="fixed inset-0 pointer-events-none z-0">
        {profileGradient ? (
          <motion.div
            className="absolute inset-0 transition-all duration-1000"
            style={{ background: profileGradient }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1.5 }}
          />
        ) : (
          <>
            <motion.div 
              className={cn(
                "absolute inset-0 bg-gradient-to-b transition-all duration-1000",
                ambiance.time.gradientFrom,
                ambiance.time.gradientVia,
                ambiance.time.gradientTo
              )}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 2 }}
            />
            <motion.div 
              className={cn(
                "absolute inset-0 bg-gradient-to-br transition-all duration-500",
                ambiance.mood.gradientFrom,
                ambiance.mood.gradientVia,
                ambiance.mood.gradientTo
              )}
              animate={{ opacity: 1 }}
              transition={{ duration: 1 }}
            />
          </>
        )}
      </div>

      {/* Modern glassmorphic header */}
      <header className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b border-white/10 glass-panel sticky top-0 z-50 ios-header-safe">
        <div className="flex items-center gap-3">
          <div 
            className={cn(
              "w-[72px] h-[72px] md:w-[86px] md:h-[86px] select-none",
              user?.isOwner && "cursor-pointer active:scale-95 transition-transform"
            )}
            onMouseDown={handleLogoLongPressStart}
            onMouseUp={handleLogoLongPressEnd}
            onMouseLeave={handleLogoLongPressEnd}
            onTouchStart={handleLogoLongPressStart}
            onTouchEnd={handleLogoLongPressEnd}
            onTouchCancel={handleLogoLongPressEnd}
            style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
            data-testid="logo-avatar"
          >
            {user?.isOwner ? (
              <UlysseAvatar
                isActive={isSpeaking || isListening || isStreaming}
                isSpeaking={isSpeaking}
                isListening={isListening}
                className="w-full h-full pointer-events-none"
                reducedMotion={false}
              />
            ) : (
              <IrisAvatar
                isActive={isSpeaking || isListening || isStreaming}
                isSpeaking={isSpeaking}
                isListening={isListening}
                className="w-full h-full pointer-events-none"
                reducedMotion={false}
              />
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 md:gap-2 justify-end">
          {/* Voice Controls - always visible, using div for iOS compatibility */}
          {sttSupported && (
            <div
              role="button"
              tabIndex={0}
              onTouchStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                e.stopPropagation();
                (async () => {
                  if (isIOS) await unlockTTS();
                  if (isListening) {
                    stopListening();
                    setConversationMode(false);
                  } else if (micPermission === "denied") {
                    await requestMicrophonePermission();
                  } else {
                    startListening();
                  }
                })();
              }}
              onClick={(e) => {
                if (isIOS) return;
                e.preventDefault();
                e.stopPropagation();
                (async () => {
                  if (isListening) {
                    stopListening();
                    setConversationMode(false);
                  } else if (micPermission === "denied") {
                    await requestMicrophonePermission();
                  } else {
                    startListening();
                  }
                })();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  (async () => {
                    if (isIOS) await unlockTTS();
                    if (isListening) {
                      stopListening();
                      setConversationMode(false);
                    } else if (micPermission === "denied") {
                      await requestMicrophonePermission();
                    } else {
                      startListening();
                    }
                  })();
                }
              }}
              title={
                micPermission === "denied" 
                  ? "Cliquez pour autoriser le micro" 
                  : isProcessing 
                    ? "Traitement en cours..." 
                    : isListening 
                      ? "Appuyez pour arrêter l'écoute" 
                      : "Appuyez pour parler"
              }
              aria-label={isListening ? "Arrêter l'écoute vocale" : "Activer le microphone"}
              aria-pressed={isListening}
              data-testid="button-toggle-mic"
              className={cn(
                "flex items-center justify-center w-11 h-11 rounded-xl border cursor-pointer select-none transition-all duration-200",
                micPermission === "denied" && "bg-destructive border-destructive text-destructive-foreground",
                isProcessing && "bg-blue-600 border-blue-500 text-white animate-pulse",
                isListening && !isProcessing && "bg-green-600 border-green-500 text-white",
                !isListening && !isProcessing && micPermission !== "denied" && "bg-muted border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
              style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent", WebkitUserSelect: "none" }}
            >
              {isProcessing ? (
                <Activity className="w-4 h-4 pointer-events-none animate-spin" />
              ) : isListening ? (
                <Mic className="w-4 h-4 pointer-events-none" />
              ) : (
                <MicOff className="w-4 h-4 pointer-events-none" />
              )}
            </div>
          )}
          {ttsSupported && (
            <div
              role="button"
              tabIndex={0}
              onTouchStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                e.stopPropagation();
                (async () => {
                  if (isIOS) await unlockTTS();
                  if (isSpeaking) stopSpeaking();
                  setAutoSpeak(!autoSpeak);
                })();
              }}
              onClick={(e) => {
                if (isIOS) return;
                e.preventDefault();
                e.stopPropagation();
                if (isSpeaking) stopSpeaking();
                setAutoSpeak(!autoSpeak);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  (async () => {
                    if (isIOS) await unlockTTS();
                    if (isSpeaking) stopSpeaking();
                    setAutoSpeak(!autoSpeak);
                  })();
                }
              }}
              title={autoSpeak ? "Désactiver la voix" : "Activer la voix"}
              aria-label={autoSpeak ? "Désactiver la voix automatique" : "Activer la voix automatique"}
              aria-pressed={autoSpeak}
              data-testid="button-toggle-autospeak"
              className={cn(
                "flex items-center justify-center w-11 h-11 rounded-xl border cursor-pointer select-none transition-colors",
                autoSpeak ? "bg-primary border-primary text-primary-foreground" : "bg-background border-border text-foreground hover:bg-accent"
              )}
              style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent", WebkitUserSelect: "none" }}
            >
              {autoSpeak ? <Volume2 className="w-4 h-4 pointer-events-none" /> : <VolumeX className="w-4 h-4 pointer-events-none" />}
            </div>
          )}

          {/* Call button */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => {
              if (isInCall) {
                endCall();
              } else {
                startCall();
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (isInCall) {
                  endCall();
                } else {
                  startCall();
                }
              }
            }}
            title={isInCall ? "Raccrocher" : "Appeler"}
            aria-label={isInCall ? "Terminer l'appel" : "Démarrer un appel vocal"}
            data-testid="button-voice-call"
            className={cn(
              "flex items-center justify-center w-11 h-11 rounded-xl border cursor-pointer select-none transition-colors text-white",
              isInCall 
                ? "bg-red-500 border-red-600 hover:bg-red-600 animate-pulse" 
                : callState === "connecting" 
                  ? "bg-yellow-500 border-yellow-600 hover:bg-yellow-600"
                  : "bg-green-500 border-green-600 hover:bg-green-600"
            )}
            style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent", WebkitUserSelect: "none" }}
          >
            {isInCall ? <PhoneOff className="w-4 h-4 pointer-events-none" /> : <Phone className="w-4 h-4 pointer-events-none" />}
          </div>

          <div className="w-px h-6 bg-border mx-1" />

          {/* Desktop: all buttons inline */}
          <div className="hidden lg:flex items-center gap-1">
            <VoiceSettingsPanel />
            <Button
              size="icon"
              variant="outline"
              onClick={() => {
                createConversation.mutate("Ulysse Hub", {
                  onSuccess: (newConv) => setActiveConversationId(newConv.id)
                });
              }}
              title="Nouvelle conversation"
              data-testid="button-new-conversation"
            >
              <Plus className="w-4 h-4" />
            </Button>

            <div className="w-px h-6 bg-border mx-1" />

            <Button size="icon" variant={panels.showHistory ? "default" : "outline"} onClick={() => panels.togglePanel("history")} title="Historique" data-testid="button-toggle-history">
              <History className="w-4 h-4" />
            </Button>
            <Button size="icon" variant={panels.showMemory ? "default" : "outline"} onClick={() => panels.togglePanel("memory")} title="Mémoire" data-testid="button-toggle-memory">
              <Brain className="w-4 h-4" />
            </Button>
            <Button size="icon" variant={panels.showFiles ? "default" : "outline"} onClick={() => panels.openPanel("files")} title="Fichiers" data-testid="button-toggle-files">
              <FolderOpen className="w-4 h-4" />
            </Button>
            <Button size="icon" variant={panels.showStudio ? "default" : "outline"} onClick={() => panels.togglePanel("studio")} title="Studio" data-testid="button-toggle-studio">
              <Wand2 className="w-4 h-4" />
            </Button>
            <Button size="icon" variant={panels.showDiagnostics ? "default" : "outline"} onClick={() => panels.togglePanel("diagnostics")} title="Diagnostics" data-testid="button-toggle-diagnostics">
              <Stethoscope className="w-4 h-4" />
            </Button>
            <Button size="icon" variant="outline" onClick={() => panels.openPanel("homework")} title="Homework" data-testid="button-toggle-homework">
              <BookOpen className="w-4 h-4" />
            </Button>
            <Button size="icon" variant={panels.showGeolocation ? "default" : "outline"} onClick={() => panels.togglePanel("geolocation")} title="Géolocalisation" data-testid="button-toggle-geolocation">
              <MapPin className="w-4 h-4" />
            </Button>
            <Button size="icon" variant={panels.showCamera ? "default" : "outline"} onClick={() => panels.openPanel("camera")} title="Caméra" data-testid="button-toggle-camera">
              <Camera className="w-4 h-4" />
            </Button>
            <Button size="icon" variant={panels.showLiveVision ? "default" : "outline"} onClick={() => panels.togglePanel("liveVision")} title="Vision Live" data-testid="button-toggle-vision">
              <Eye className="w-4 h-4" />
            </Button>
            <Button size="icon" variant={panels.showIntegrations ? "default" : "outline"} onClick={() => panels.togglePanel("integrations")} title="Intégrations" data-testid="button-toggle-integrations">
              <Music className="w-4 h-4" />
            </Button>

            <div className="w-px h-6 bg-border mx-1" />
            <Button size="icon" variant="outline" onClick={() => navigate("/sports/predictions")} title="Djedou Pronos" data-testid="button-goto-pronos">
              <Trophy className="w-4 h-4" />
            </Button>
            <Button size="icon" variant="outline" onClick={() => navigate("/superchat")} title="SuperChat" data-testid="button-goto-superchat">
              <Users className="w-4 h-4" />
            </Button>

            <div className="w-px h-6 bg-border mx-1" />
            <ThemeToggle />
            <PCMonitorToggle />

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="icon" variant="ghost" title={`Déconnexion${user?.displayName ? ` (${user.displayName})` : ''}`} data-testid="button-logout">
                  <LogOut className="w-4 h-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirmer la déconnexion</AlertDialogTitle>
                  <AlertDialogDescription>Êtes-vous sûr de vouloir vous déconnecter de votre compte ?</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-cancel-logout">Annuler</AlertDialogCancel>
                  <AlertDialogAction onClick={() => logout()} className="bg-destructive text-destructive-foreground border-destructive-border hover:bg-destructive/90" data-testid="button-confirm-logout">Se déconnecter</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          {/* Mobile: burger menu for panels */}
          <div className="lg:hidden relative">
            <Button
              size="icon"
              variant="outline"
              onClick={() => setBurgerMenuOpen(!burgerMenuOpen)}
              data-testid="button-burger-menu"
            >
              {burgerMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </Button>
            {(() => {
              const activePanelCount = [panels.showHistory, panels.showMemory, panels.showFiles, panels.showStudio, panels.showDiagnostics, panels.showGeolocation, panels.showCamera, panels.showIntegrations].filter(Boolean).length;
              return activePanelCount > 0 && !burgerMenuOpen ? (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-medium pointer-events-none">
                  {activePanelCount}
                </span>
              ) : null;
            })()}
            {burgerMenuOpen && (
              <>
                <div className="fixed inset-0 z-[99]" onClick={() => setBurgerMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-2 w-60 rounded-md border bg-popover text-popover-foreground shadow-lg z-[100] py-1 overflow-hidden max-h-[70vh] overflow-y-auto">
                  <div className="px-3 py-2 flex items-center gap-2">
                    <VoiceSettingsPanel />
                    <ThemeToggle />
                    <PCMonitorToggle />
                  </div>
                  <div className="border-t my-1" />
                  <button onClick={() => { createConversation.mutate("Ulysse Hub", { onSuccess: (newConv) => setActiveConversationId(newConv.id) }); setBurgerMenuOpen(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 text-sm hover-elevate" data-testid="menu-new-conversation">
                    <Plus className="w-4 h-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 text-left">Nouvelle conversation</span>
                  </button>
                  <div className="border-t my-1" />
                  {[
                    { label: "Historique", icon: History, active: panels.showHistory, action: () => panels.togglePanel("history") },
                    { label: "Mémoire", icon: Brain, active: panels.showMemory, action: () => panels.togglePanel("memory") },
                    { label: "Fichiers", icon: FolderOpen, active: panels.showFiles, action: () => panels.openPanel("files") },
                    { label: "Studio", icon: Wand2, active: panels.showStudio, action: () => panels.togglePanel("studio") },
                    { label: "Diagnostics", icon: Stethoscope, active: panels.showDiagnostics, action: () => panels.togglePanel("diagnostics") },
                    { label: "Devoirs", icon: BookOpen, active: false, action: () => panels.openPanel("homework") },
                    { label: "Géolocalisation", icon: MapPin, active: panels.showGeolocation, action: () => panels.togglePanel("geolocation") },
                    { label: "Caméra", icon: Camera, active: panels.showCamera, action: () => panels.openPanel("camera") },
                    { label: "Vision Live", icon: Eye, active: panels.showLiveVision, action: () => panels.togglePanel("liveVision") },
                    { label: "Intégrations", icon: Music, active: panels.showIntegrations, action: () => panels.togglePanel("integrations") },
                  ].map((item) => (
                    <button
                      key={item.label}
                      onClick={() => { item.action(); }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-sm hover-elevate"
                      data-testid={`menu-${item.label.toLowerCase()}`}
                    >
                      <item.icon className="w-4 h-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 text-left">{item.label}</span>
                      {item.active && <Check className="w-4 h-4 shrink-0 text-primary" />}
                    </button>
                  ))}
                  <div className="border-t my-1" />
                  <button onClick={() => { setBurgerMenuOpen(false); navigate("/analytics"); }} className="w-full flex items-center gap-3 px-3 py-2.5 text-sm hover-elevate" data-testid="menu-goto-analytics">
                    <BarChart3 className="w-4 h-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 text-left">Analytics</span>
                  </button>
                  <button onClick={() => { setBurgerMenuOpen(false); navigate("/sports/predictions"); }} className="w-full flex items-center gap-3 px-3 py-2.5 text-sm hover-elevate" data-testid="menu-goto-pronos">
                    <Trophy className="w-4 h-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 text-left">Djedou Pronos</span>
                  </button>
                  <button onClick={() => { setBurgerMenuOpen(false); navigate("/superchat"); }} className="w-full flex items-center gap-3 px-3 py-2.5 text-sm hover-elevate" data-testid="menu-goto-superchat">
                    <Users className="w-4 h-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 text-left">SuperChat</span>
                  </button>
                  <div className="border-t my-1" />
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-destructive hover-elevate" data-testid="menu-logout">
                        <LogOut className="w-4 h-4 shrink-0" />
                        <span className="flex-1 text-left">Déconnexion</span>
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Confirmer la déconnexion</AlertDialogTitle>
                        <AlertDialogDescription>Êtes-vous sûr de vouloir vous déconnecter de votre compte ?</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel data-testid="button-cancel-logout">Annuler</AlertDialogCancel>
                        <AlertDialogAction onClick={() => { setBurgerMenuOpen(false); logout(); }} className="bg-destructive text-destructive-foreground border-destructive-border hover:bg-destructive/90" data-testid="button-confirm-logout">Se déconnecter</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Voice Status Bar - compact, only shows when active */}
      <AnimatePresence>
        {(isListening || isSpeaking || conversationMode || isStreaming) && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-secondary/30 backdrop-blur-sm px-2 md:px-4 py-1.5 flex items-center justify-center gap-3 md:gap-4 text-xs md:text-sm"
          >
            {isListening && (
              <motion.div
                className="flex items-center gap-1.5 text-green-500"
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
                data-testid="status-listening"
              >
                <Mic className="w-3.5 h-3.5" />
                <span className="font-medium">Micro actif</span>
              </motion.div>
            )}
            {isSpeaking && (
              <motion.div
                className="flex items-center gap-1.5 text-blue-500"
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 0.5, repeat: Infinity }}
                data-testid="status-speaking"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span className="font-medium">{personaName} parle</span>
              </motion.div>
            )}
            {isStreaming && !isSpeaking && (
              <motion.div
                className="flex items-center gap-1.5 text-primary"
                animate={{ opacity: [1, 0.6, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
                data-testid="status-thinking"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span className="font-medium">{personaName} réfléchit...</span>
              </motion.div>
            )}
            {conversationMode && !isStreaming && !isSpeaking && (
              <div className="flex items-center gap-1.5 text-muted-foreground" data-testid="status-conversation-mode">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Mode conversation - dites "Over" pour terminer</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Real-time Issue Notifications */}
      <AnimatePresence>
        {diagnostics.activeIssues.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-destructive/10 border-b border-destructive/20 px-4 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
                <span className="text-sm text-destructive truncate">
                  {diagnostics.activeIssues[0]?.message}
                </span>
                {diagnostics.activeIssues.length > 1 && (
                  <Badge variant="destructive" className="shrink-0">
                    +{diagnostics.activeIssues.length - 1}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => panels.openPanel("diagnostics")}
                  className="text-destructive"
                  data-testid="button-view-issues"
                >
                  Voir
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => diagnostics.clearActiveIssue(diagnostics.activeIssues[0]?.id)}
                  className="text-destructive"
                  data-testid="button-dismiss-issue"
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* History Panel - slides in from left */}
      <AnimatePresence>
        {panels.showHistory && (
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed inset-0 sm:inset-y-0 sm:left-0 sm:right-auto w-full sm:w-96 z-40 bg-background shadow-xl sm:top-[100px]"
          >
            <ConversationHistory
              onSelectConversation={(id) => {
                setActiveConversationId(id);
                panels.closePanel();
              }}
              onClose={() => panels.closePanel()}
              activeConversationId={activeConversationId}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Memory Panel */}
      <AnimatePresence>
        {panels.showMemory && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50"
            onClick={() => panels.closePanel()}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <MemoryPanel onClose={() => panels.closePanel()} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Diagnostics Panel */}
      <AnimatePresence>
        {panels.showDiagnostics && (
          <motion.div
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 100 }}
          >
            <DiagnosticsPanel onClose={() => panels.closePanel()} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Generated Files Modal */}
      <GeneratedFilesModal 
        isOpen={panels.showFiles} 
        onClose={() => panels.closePanel()} 
        personaName={personaName}
      />

      {/* Studio Panel */}
      <StudioPanel
        isOpen={panels.showStudio}
        onClose={() => panels.closePanel()}
      />

      {/* Homework Panel */}
      <HomeworkPanel 
        isOpen={panels.showHomework} 
        onClose={() => panels.closePanel()} 
      />

      {/* Geolocation Panel */}
      <AnimatePresence>
        {panels.showGeolocation && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <GeolocationPanel 
              geo={geo}
              accuracyMode={geoAccuracyMode}
              setAccuracyMode={setGeoAccuracyMode}
              isMobile={false}
              onClose={() => panels.closePanel()}
              initialDestination={navigationDestination}
              onDestinationCleared={() => setNavigationDestination(null)}
              isOwner={user?.isOwner || false}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Email Panel */}
      <AnimatePresence>
        {panels.showEmail && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <EmailPanel onClose={() => panels.closePanel()} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Camera Capture */}
      <CameraCapture 
        open={panels.showCamera} 
        onClose={() => panels.closePanel()} 
      />

      {/* Live Vision Panel */}
      <AnimatePresence>
        {panels.showLiveVision && (
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 z-40 w-[420px] bg-background shadow-xl border-l overflow-y-auto"
          >
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Eye className="w-5 h-5" /> Vision Live
                </h2>
                <Button variant="ghost" size="icon" onClick={() => panels.closePanel()} data-testid="button-close-vision">
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <LiveVision />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Integrations Panel */}
      <AnimatePresence>
        {panels.showIntegrations && (
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 z-40 w-96 bg-background shadow-xl border-l"
          >
            <IntegrationsPanel />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Image Editor Modal */}
      <AnimatePresence>
        {showImageEditor && pendingFileAnalysis?.imageDataUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={() => setShowImageEditor(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl"
            >
              <ImageEditor
                imageDataUrl={pendingFileAnalysis.imageDataUrl}
                onClose={() => setShowImageEditor(false)}
                onSave={(editedDataUrl) => {
                  setPendingFileAnalysis({
                    ...pendingFileAnalysis,
                    imageDataUrl: editedDataUrl
                  });
                  setShowImageEditor(false);
                }}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Owner-Only: Code Snapshot Modal (Hidden Feature) */}
      {user?.isOwner && (
        <CodeSnapshotModal 
          isOpen={panels.showCodeSnapshot} 
          onClose={() => panels.closePanel()} 
        />
      )}

      {/* iOS TTS Unlock Overlay - Slide to unlock */}
      <AnimatePresence>
        {isIOS && ttsSupported && !ttsUnlocked && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed inset-x-0 bottom-1/2 translate-y-1/2 z-[100] flex justify-center items-center pointer-events-none"
            style={{ touchAction: 'none' }}
          >
            <div
              className="relative rounded-full bg-gradient-to-r from-emerald-600/90 to-teal-700/90 backdrop-blur-sm shadow-2xl overflow-hidden pointer-events-auto border-2 border-white/20"
              style={{ 
                width: `${TRACK_WIDTH}px`, 
                height: '64px',
                WebkitTapHighlightColor: 'transparent'
              }}
              onTouchStart={handleSlideTouchStart}
              onTouchMove={handleSlideTouchMove}
              onTouchEnd={handleSlideTouchEnd}
              data-testid="slider-unlock-tts"
            >
              {/* Progress fill */}
              <motion.div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-400 to-teal-400"
                style={{ width: `${slideProgress * 100}%` }}
                animate={{ width: `${slideProgress * 100}%` }}
                transition={{ duration: 0 }}
              />
              
              {/* Track text */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <motion.span 
                  className="text-white text-base font-semibold select-none tracking-wide"
                  animate={{ opacity: isSliding ? 0.4 : 1 }}
                >
                  {slideProgress >= SLIDE_THRESHOLD ? "Relâchez !" : "Glisser →"}
                </motion.span>
              </div>
              
              {/* Draggable thumb - larger for easier touch */}
              <motion.div
                className="absolute top-1.5 bottom-1.5 left-1.5 w-14 rounded-full bg-white shadow-lg flex items-center justify-center"
                style={{ 
                  x: slideProgress * (TRACK_WIDTH - 64),
                }}
                animate={{
                  scale: isSliding ? 1.08 : 1,
                  backgroundColor: slideProgress >= SLIDE_THRESHOLD ? "#22c55e" : "#ffffff"
                }}
              >
                <Volume2 className={cn(
                  "w-6 h-6 transition-colors",
                  slideProgress >= SLIDE_THRESHOLD ? "text-white" : "text-emerald-600"
                )} />
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 flex flex-col lg:flex-row items-center lg:items-start justify-start lg:justify-center p-4 md:p-8 relative overflow-y-auto overflow-x-hidden gap-6 lg:gap-10 w-full max-w-full">
        {/* Background glow effect - subtle ambient glow based on mood */}
        <motion.div 
          className="absolute inset-0 pointer-events-none overflow-hidden"
          animate={{ opacity: isActive ? 0.4 : 0.15 }}
          transition={{ duration: 0.8 }}
        >
          <motion.div 
            className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[200px] md:w-[350px] h-[200px] md:h-[350px] rounded-full"
            style={{
              background: `radial-gradient(circle, ${moodColors.glow}20 0%, ${moodColors.glow}08 40%, transparent 70%)`,
              filter: 'blur(60px)'
            }}
          />
        </motion.div>

        {/* LEFT COLUMN: Display Window only — visible on desktop when open */}
        <div className={cn("flex-col items-center gap-4 z-10 lg:sticky lg:top-8 lg:w-[256px] lg:shrink-0", displayWindow.isOpen ? "hidden lg:flex" : "hidden")}>
          {/* Avatar Visualization */}
          <div className={cn(
            "relative w-full flex flex-col items-center gap-3",
            displayWindow.isOpen && "lg:gap-4"
          )}>
          {/* Orb/Equalizer Visualization — hidden, avatar lives in header only */}
          <div className="hidden">
            <AnimatePresence mode="wait">
              {visualMode === "orb" && (
                <motion.div
                  key="orb"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="w-full h-full"
                >
                  {personaName === "Max" ? (
                    <AlfredAvatar
                      isActive={isActive}
                      isSpeaking={isSpeaking}
                      isListening={isListening}
                      isSearching={isSearching}
                      isAnalyzing={isAnalyzing}
                      orbColor={orbColor}
                      orbIntensity={orbIntensity}
                      isPaused={isAppPaused}
                      reducedMotion={prefersReducedMotion}
                      className="w-full h-full"
                    />
                  ) : personaName === "Ulysse" ? (
                    <UlysseAvatar
                      isActive={isActive}
                      isSpeaking={isSpeaking}
                      isListening={isListening}
                      isSearching={isSearching}
                      isAnalyzing={isAnalyzing}
                      orbColor={orbColor}
                      orbIntensity={orbIntensity}
                      isPaused={isAppPaused}
                      reducedMotion={prefersReducedMotion}
                      className="w-full h-full"
                    />
                  ) : (
                    <IrisAvatar
                      isActive={isActive}
                      isSpeaking={isSpeaking}
                      isListening={isListening}
                      isSearching={isSearching}
                      isAnalyzing={isAnalyzing}
                      orbColor={orbColor}
                      orbIntensity={orbIntensity}
                      isPaused={isAppPaused}
                      reducedMotion={prefersReducedMotion}
                      className="w-full h-full"
                    />
                  )}
                </motion.div>
              )}
              {visualMode === "avatar" && (
                <motion.div
                  key="avatar"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="w-full h-full"
                >
                  {personaName === "Max" ? (
                    <AlfredAvatar
                      isActive={isActive}
                      isSpeaking={isSpeaking}
                      isListening={isListening}
                      isSearching={isSearching}
                      isAnalyzing={isAnalyzing}
                      orbColor={orbColor}
                      orbIntensity={orbIntensity}
                      isPaused={isAppPaused}
                      reducedMotion={prefersReducedMotion}
                      className="w-full h-full"
                    />
                  ) : personaName === "Ulysse" ? (
                    <UlysseAvatar
                      isActive={isActive}
                      isSpeaking={isSpeaking}
                      isListening={isListening}
                      isSearching={isSearching}
                      isAnalyzing={isAnalyzing}
                      orbColor={orbColor}
                      orbIntensity={orbIntensity}
                      isPaused={isAppPaused}
                      reducedMotion={prefersReducedMotion}
                      className="w-full h-full"
                    />
                  ) : (
                    <IrisAvatar
                      isActive={isActive}
                      isSpeaking={isSpeaking}
                      isListening={isListening}
                      isSearching={isSearching}
                      isAnalyzing={isAnalyzing}
                      orbColor={orbColor}
                      orbIntensity={orbIntensity}
                      isPaused={isAppPaused}
                      reducedMotion={prefersReducedMotion}
                      className="w-full h-full"
                    />
                  )}
                </motion.div>
              )}
              {visualMode === "equalizer" && (
                <motion.div
                  key="equalizer"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="w-full h-full flex items-center justify-center"
                >
                  <AudioVisualizer
                    isActive={isActive}
                    isSpeaking={isSpeaking}
                    isListening={isListening}
                    mood={conversationMood}
                    isPaused={isAppPaused}
                    reducedMotion={prefersReducedMotion}
                    className="w-full h-24 md:h-48"
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Display Window - shows when content available (on left for PC) */}
          <DisplayWindow
            content={displayWindow.content}
            isOpen={displayWindow.isOpen}
            onClose={displayWindow.close}
            className={cn(
              "w-full max-w-[300px] h-[250px]",
              "lg:max-w-[320px] lg:h-[320px]"
            )}
            persona={user?.isOwner ? "ulysse" : "iris"}
          />
          </div>
        </div>

        {/* RIGHT COLUMN: Chat + Input (PC only side-by-side) */}
        <div className="flex flex-col items-center gap-4 z-10 w-full lg:flex-1">
        {/* Status text with loading animation */}
        <motion.div
          className="text-center mb-4 md:mb-6 z-10"
          animate={{ opacity: isActive ? 1 : 0.7 }}
        >
          <h2 className="text-lg md:text-2xl font-semibold text-foreground mb-2 flex items-center justify-center gap-2">
            {isSpeaking ? `${personaName} parle` : isListening ? "Je vous écoute" : isStreaming ? (
              <>
                <span>{personaName} réfléchit</span>
                <span className="inline-flex gap-1">
                  <motion.span
                    className="w-2 h-2 bg-primary rounded-full"
                    animate={{ scale: [1, 1.3, 1], opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 0.8, repeat: Infinity, delay: 0 }}
                  />
                  <motion.span
                    className="w-2 h-2 bg-primary rounded-full"
                    animate={{ scale: [1, 1.3, 1], opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 0.8, repeat: Infinity, delay: 0.2 }}
                  />
                  <motion.span
                    className="w-2 h-2 bg-primary rounded-full"
                    animate={{ scale: [1, 1.3, 1], opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 0.8, repeat: Infinity, delay: 0.4 }}
                  />
                </span>
              </>
            ) : null}
          </h2>
          {!isSpeaking && !isListening && !isStreaming && <MarseilleInfo />}
          {isSpeaking && (
            <Button variant="ghost" size="sm" onClick={stopSpeaking} aria-label="Interrompre la parole" data-testid="button-stop-speaking">
              <VolumeX className="w-4 h-4 mr-2" /> Interrompre
            </Button>
          )}
        </motion.div>

        {/* Progress tracker for long-running AI tasks */}
        <ProgressTrackerInline userId={user?.id} />

        {/* Quick-access shortcuts */}
        {user?.isOwner && (() => {
          const urlShortcuts = [
            { label: "Pronos", icon: Trophy, action: () => navigate("/sports/predictions"), color: "text-yellow-400" },
            { label: "Brain", icon: Brain, action: () => navigate("/brain"), color: "text-purple-400" },
            { label: "Val", icon: Store, action: () => navigate("/suguval"), color: "text-emerald-400" },
            { label: "Maillane", icon: Store, action: () => navigate("/sugumaillane"), color: "text-teal-400" },
            { label: "Finances", icon: DollarSign, action: () => navigate("/finances"), color: "text-blue-400" },
            { label: "Projets", icon: FolderOpen, action: () => navigate("/projects"), color: "text-orange-400" },
            { label: "Tâches", icon: ListTodo, action: () => navigate("/tasks"), color: "text-green-400" },
            { label: "Notes", icon: Pencil, action: () => navigate("/notes"), color: "text-pink-400" },
            { label: "Emails", icon: Mail, action: () => navigate("/emails"), color: "text-red-400" },
            { label: "Insights", icon: BarChart3, action: () => navigate("/ulysse-insights"), color: "text-cyan-400" },
            { label: "DevOps", icon: GitBranch, action: () => navigate("/devops"), color: "text-indigo-400" },
            { label: "Iris DevOps", icon: Sparkles, action: () => navigate("/devops-iris"), color: "text-amber-400" },
            { label: "SuperChat", icon: Users, action: () => navigate("/superchat"), color: "text-violet-400" },
            { label: "Diag", icon: Stethoscope, action: () => navigate("/diagnostics"), color: "text-slate-400" },
            { label: "Réglages", icon: Settings, action: () => navigate("/settings"), color: "text-slate-300" },
          ];
          return (
            <div className="w-full mb-3 z-10">
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                {urlShortcuts.map(s => (
                  <button key={s.label} onClick={s.action} data-testid={`shortcut-${s.label.toLowerCase()}`}
                    className="flex flex-col items-center gap-1 flex-shrink-0 px-2.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 border border-slate-200 hover:border-slate-300 dark:border-white/10 dark:hover:border-white/20 transition-all min-w-[52px]">
                    <s.icon className={`w-4 h-4 ${s.color}`} />
                    <span className="text-[9px] text-slate-600 dark:text-white/60 font-medium leading-none whitespace-nowrap">{s.label}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Recent conversation - glassmorphic card */}
        <Card className="w-full lg:flex-1 min-w-0 max-w-full glass-card border-white/10 mb-4 md:mb-6 z-10 overflow-hidden">
          <div className="h-[400px] md:h-[500px] overflow-y-auto scroll-smooth" ref={scrollRef}>
            <div className="p-4 md:p-5 space-y-3 w-full" style={{ maxWidth: '100%', boxSizing: 'border-box' }}>
              {lastMessages.length === 0 && !streamingContent && (
                <p className="text-center text-muted-foreground text-sm py-8">
                  Dites "Bonjour" pour commencer la conversation
                </p>
              )}
              {lastMessages.map((msg, idx) => (
                <div key={idx} className="pr-2">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      "text-sm p-3 md:p-4 rounded-xl relative group",
                      msg.role === "user" 
                        ? "user-bubble"
                        : "ai-bubble"
                    )}
                    style={{ maxWidth: '90%' }}
                  >
                  {msg.role === "user" && msg.id && (
                    <button
                      onClick={async () => {
                        try {
                          await fetch(`/api/conversations/messages/${msg.id}`, { method: "DELETE", credentials: "include" });
                          queryClient.invalidateQueries({ queryKey: ["/api/conversations", activeConversationId] });
                        } catch (e) {
                          console.error("Failed to delete message:", e);
                        }
                      }}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500/80 hover:bg-red-500 rounded-full flex items-center justify-center md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                      data-testid="button-delete-message"
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  )}
                  <p className="text-xs text-muted-foreground mb-1">
                    {msg.role === "user" ? "Vous" : personaName}
                  </p>
                    <div className="prose prose-sm dark:prose-invert max-w-full overflow-hidden [&_*]:text-foreground [&_a]:text-blue-500 dark:[&_a]:text-blue-400 [&_a]:underline" style={{ wordBreak: 'break-all', overflowWrap: 'anywhere', hyphens: 'auto' }}>
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                    {msg.role === "assistant" && (
                      <div className="flex items-center justify-between mt-1.5">
                        <div className="flex items-center gap-1">
                          {(msg as any).confidenceLevel === "certain" && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500 dark:text-emerald-400">
                              <ShieldCheck className="w-3 h-3" />
                              <span>Certain</span>
                            </span>
                          )}
                          {(msg as any).confidenceLevel === "probable" && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-amber-500 dark:text-amber-400">
                              <ShieldAlert className="w-3 h-3" />
                              <span>Probable</span>
                            </span>
                          )}
                          {(msg as any).confidenceLevel === "incertain" && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-red-400 dark:text-red-400">
                              <ShieldQuestion className="w-3 h-3" />
                              <span>Incertain</span>
                            </span>
                          )}
                        </div>
                        <button
                          className="p-1 rounded text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/50 transition-colors"
                          onClick={() => {
                            navigator.clipboard.writeText(msg.content);
                            setCopiedMsgIdx(idx);
                            setTimeout(() => setCopiedMsgIdx(null), 2000);
                          }}
                          title="Copier"
                          data-testid={`button-copy-message-${idx}`}
                        >
                          {copiedMsgIdx === idx ? (
                            <Check className="h-3.5 w-3.5 text-green-500" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    )}
                  </motion.div>
                </div>
              ))}
              {isStreaming && !streamingContent && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-sm p-2 md:p-3 rounded-lg ai-bubble mr-4 md:mr-8"
                >
                  <p className="text-xs text-muted-foreground mb-1">{personaName}</p>
                  <div className="flex items-center gap-2 py-2">
                    <motion.div
                      className="w-8 h-1 bg-primary/40 rounded-full"
                      animate={{ width: ["32px", "48px", "32px"] }}
                      transition={{ duration: 1.2, repeat: Infinity }}
                    />
                    <motion.div
                      className="w-12 h-1 bg-primary/30 rounded-full"
                      animate={{ width: ["48px", "64px", "48px"] }}
                      transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }}
                    />
                    <motion.div
                      className="w-6 h-1 bg-primary/20 rounded-full"
                      animate={{ width: ["24px", "40px", "24px"] }}
                      transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }}
                    />
                  </div>
                </motion.div>
              )}
              {streamingContent && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-sm p-2 md:p-3 rounded-lg ai-bubble mr-4 md:mr-8 overflow-hidden"
                >
                  <p className="text-xs text-muted-foreground mb-1">{personaName}</p>
                  <div className="prose prose-sm dark:prose-invert max-w-full overflow-hidden [&_*]:text-foreground [&_a]:text-blue-500 dark:[&_a]:text-blue-400 [&_a]:underline" style={{ wordBreak: 'break-all', overflowWrap: 'anywhere', hyphens: 'auto' }}>
                    <ReactMarkdown>{streamingContent}</ReactMarkdown>
                  </div>
                </motion.div>
              )}
            </div>
          </div>
        </Card>

        {/* Scroll navigation */}
        <div className="flex items-center gap-2 w-full justify-center -mt-2 mb-1">
          <button
            onClick={() => scrollRef.current && (scrollRef.current.scrollTop = 0)}
            data-testid="button-scroll-top"
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs text-muted-foreground hover:text-foreground hover:bg-white/10 transition-all border border-white/10"
            title="Remonter en haut"
          >
            <ChevronsUp className="w-3.5 h-3.5" /> Haut
          </button>
          <div className="w-px h-4 bg-white/10" />
          <button
            onClick={() => scrollRef.current && (scrollRef.current.scrollTop = scrollRef.current.scrollHeight)}
            data-testid="button-scroll-bottom"
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs text-muted-foreground hover:text-foreground hover:bg-white/10 transition-all border border-white/10"
            title="Descendre en bas"
          >
            <ChevronsDown className="w-3.5 h-3.5" /> Bas
          </button>
        </div>

        {/* Modern glassmorphic input area */}
        <div className="w-full max-w-4xl z-10 pb-4">
          <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex items-end gap-3">
            <Textarea
              ref={(el) => {
                if (el) {
                  el.style.height = "0px";
                  el.style.height = Math.min(el.scrollHeight, 160) + "px";
                }
              }}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                handleTypingUpdate(e.target.value);
                if (isListening) stopListening();
                const el = e.target;
                el.style.height = "0px";
                el.style.height = Math.min(el.scrollHeight, 160) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={isListening ? "Parlez..." : preThinkResult?.isReading ? `${personaName} lit...` : "Ecrivez votre message..."}
              className="flex-1 min-h-[48px] max-h-[160px] glass-input border-white/10 rounded-2xl text-base px-5 py-3 resize-none overflow-y-auto"
              disabled={isStreaming}
              onFocus={() => { if (isListening) stopListening(); }}
              rows={1}
              data-testid="input-message"
            />
            {sttSupported && (
              <div
                role="button"
                tabIndex={0}
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (isStreaming) return;
                  
                  if (isListening) {
                    // Toggle OFF - deactivate mic
                    console.log("Mic toggle OFF - deactivating");
                    manualStopRef.current = true;
                    stopListening();
                  } else {
                    // Toggle ON - activate mic (stays on until clicked again or voice command)
                    console.log("Mic toggle ON - activating");
                    manualStopRef.current = false;
                    if (isIOS) await unlockTTS();
                    if (micPermission === "denied") {
                      await requestMicrophonePermission();
                    } else {
                      startListening();
                      setConversationMode(true); // Enter conversation mode
                    }
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (isStreaming) return;
                    if (isListening) {
                      manualStopRef.current = true;
                      stopListening();
                    } else {
                      manualStopRef.current = false;
                      if (micPermission === "denied") {
                        requestMicrophonePermission();
                      } else {
                        startListening();
                        setConversationMode(true);
                      }
                    }
                  }
                }}
                className={cn(
                  "flex items-center justify-center min-h-11 min-w-11 px-4 py-2 rounded-xl border cursor-pointer select-none transition-all duration-200 shrink-0",
                  micPermission === "denied" && "bg-destructive border-destructive text-destructive-foreground",
                  isProcessing && "bg-blue-600 border-blue-500 text-white animate-pulse scale-105",
                  isListening && !isProcessing && "bg-green-600 border-green-500 text-white",
                  !isListening && !isProcessing && micPermission !== "denied" && "bg-muted border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  isStreaming && "opacity-50 cursor-not-allowed"
                )}
                style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent", WebkitUserSelect: "none" }}
                aria-label={isProcessing ? "Traitement..." : isListening ? "Cliquez pour désactiver le micro" : "Cliquez pour activer le micro"}
                aria-pressed={isListening}
                data-testid="button-input-mic"
              >
                {isProcessing ? (
                  <Activity className="w-5 h-5 animate-spin pointer-events-none" />
                ) : isListening ? (
                  <MicOff className="w-5 h-5 pointer-events-none" />
                ) : (
                  <Mic className="w-5 h-5 pointer-events-none" />
                )}
              </div>
            )}
            <FileUpload
              compact
              onFileAnalyzed={(analysis, fileName) => {
                let imageDataUrl = analysis.metadata?.imageDataUrl as string | undefined;
                const pdfPageImages = analysis.metadata?.pdfPageImages as string[] | undefined;
                const pdfBase64Full = analysis.metadata?.pdfBase64Full as string | undefined;
                
                if (imageDataUrl) {
                  const sizeKB = (imageDataUrl.length / 1024).toFixed(1);
                  console.log(`[VISION] Image ready: ${fileName} (${sizeKB}KB base64)`);
                }
                if (pdfPageImages && pdfPageImages.length > 0) {
                  console.log(`[VISION] PDF page images ready: ${pdfPageImages.length} pages for ${fileName}`);
                }
                if (pdfBase64Full) {
                  console.log(`[PDF-FALLBACK] PDF base64 data ready for server-side save: ${(pdfBase64Full.length / 1024).toFixed(1)}KB`);
                }
                
                setPendingFileAnalysis({ content: analysis.content, fileName, imageDataUrl, pdfPageImages, pdfBase64Full });
              }}
            />
            <Button
              type="submit"
              size="default"
              disabled={(!input.trim() && !pendingFileAnalysis) || isStreaming}
              className="shrink-0"
              aria-label="Envoyer le message"
              data-testid="button-send-message"
            >
              <Send className="w-5 h-5" />
            </Button>
          </form>
          {pendingFileAnalysis && (
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="px-2 py-1 bg-primary/10 rounded text-primary">
                Fichier prêt: {pendingFileAnalysis.fileName}
              </span>
              {pendingFileAnalysis.imageDataUrl && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => setShowImageEditor(true)}
                  aria-label="Éditer l'image"
                  data-testid="button-edit-image"
                >
                  <Pencil className="w-3 h-3 mr-1" />
                  Éditer
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={() => setPendingFileAnalysis(null)}
                aria-label="Supprimer le fichier joint"
                data-testid="button-remove-file"
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          )}
          {!sttSupported && ttsSupported && (
            <p className="text-center text-xs text-muted-foreground mt-2">
              Tapez votre message - {personaName} vous répondra vocalement
            </p>
          )}
          {!sttSupported && !ttsSupported && (
            <p className="text-center text-xs text-muted-foreground mt-2">
              Entrez votre texte - {personaName} lit les réponses à haute voix
            </p>
          )}
          {isIOS && !sttSupported && (
            <p className="text-center text-xs text-amber-500/70 mt-1">
              La reconnaissance vocale n'est pas disponible sur Safari iOS
            </p>
          )}
        </div>
        </div>
      </div>

      {/* AI Preview Confirmation Card */}
      <PreviewConfirmationCard
        request={aiPreview.pendingPreview}
        isOpen={aiPreview.isOpen}
        onConfirm={aiPreview.handleConfirm}
        onCancel={aiPreview.handleCancel}
        onClose={aiPreview.close}
      />
    </div>
  );
}
