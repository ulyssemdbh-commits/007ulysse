import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConversations, useCreateConversation } from "@/hooks/use-chat";
import { useVoice } from "@/hooks/use-voice";
import { useDashboardVoice } from "@/hooks/useDashboardVoice";
import { useDashboardSettings } from "@/hooks/useDashboardSettings";
import { useDashboardConversation } from "@/hooks/useDashboardConversation";
import { useAuth } from "@/hooks/use-auth";
import { useVisibility, useReducedMotion, useIOSDetection } from "@/hooks/use-visibility";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { useDeviceId } from "@/hooks/useDeviceId";
import { usePanelManager } from "@/hooks/usePanelManager";
import { setSharedConversationId } from "@/contexts/UlysseChatContext";
import { useDashboardChat } from "@/hooks/useDashboardChat";
import { Button } from "@/components/ui/button";
import { Volume2, VolumeX, Sparkles, Mic } from "lucide-react";
import { useLocation } from "wouter";
import { DashboardPanels } from "@/components/DashboardPanels";
import { DashboardHeader } from "@/components/DashboardHeader";
import { DashboardChatArea } from "@/components/DashboardChatArea";
import { DashboardiOSSlider } from "@/components/DashboardiOSSlider";
import { DashboardLeftColumn } from "@/components/DashboardLeftColumn";
import { DashboardShortcuts } from "@/components/DashboardShortcuts";
import { useDisplayWindow } from "@/components/DisplayWindow";
import { ProgressTrackerInline } from "@/components/ProgressTracker";
import { PreviewConfirmationCard } from "@/components/PreviewConfirmationCard";
import { useAIPreview } from "@/hooks/useAIPreview";
import { MarseilleInfo } from "@/components/MarseilleInfo";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { analyzeMood, type ConversationMood, moodColorMap, getAmbiance } from "@/lib/mood";

export default function Dashboard() {
  const [, navigate] = useLocation();
  const { data: conversations } = useConversations();
  const createConversation = useCreateConversation();
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();
  
  const isExternal = user?.role === "external";
  const personaName = useMemo(() => 
    user?.isOwner ? "Ulysse" : isExternal ? "Max" : "Iris", 
    [user?.isOwner, isExternal]
  ) as "Ulysse" | "Iris" | "Max";
  
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

  const { 
    isListening, isSpeaking, transcript, sttSupported, ttsSupported,
    lastSpokenText, micPermission, permissionsReady, ttsUnlocked, isIOS,
    isProcessing, wakeWordActive,
    startListening, stopListening, speak, stopSpeaking, interrupt,
    setTranscript, unlockTTS, setWakeWordActive, requestMicrophonePermission,
    suspendAudio, resumeAudio, setOnAutoSubmit
  } = useVoice();

  const { voiceCall, wantsToCall, setWantsToCall, isInCall, callState, startCall, endCall, diagnostics } = useDashboardVoice({
    userName: user?.displayName || user?.username || "User",
    activeConversationId,
    micPermission,
  });
  
  const {
    autoSpeak, setAutoSpeak,
    visualMode, setVisualMode,
    orbColor, setOrbColor,
    orbIntensity, setOrbIntensity,
    voiceSpeed, setVoiceSpeed,
    voicePitch, setVoicePitch,
    ambientSound, setAmbientSound,
    ambientVolume, setAmbientVolume,
    profileGradient, setProfileGradient,
    geoAccuracyMode, setGeoAccuracyMode,
    navigationDestination, setNavigationDestination,
    geo,
  } = useDashboardSettings();
  
  const [hasGreeted, setHasGreeted] = useState(false);
  const displayWindow = useDisplayWindow();
  
  const handleSearchResults = useCallback((data: { source?: string; images?: Array<{ link: string; thumbnailLink: string; title: string; contextLink: string; width: number; height: number }> }) => {
    if ((data.source === "google_images" || data.source === "google_images_auto" || data.source === "media_library") && data.images && data.images.length > 0) {
      const gridImages = data.images.map((img) => ({
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
  
  const [preThinkResult, setPreThinkResult] = useState<{ intent: string | null; isReading: boolean } | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const { sendTypingUpdate } = useRealtimeSync({ 
    userId: user?.id,
    onSearchResults: handleSearchResults,
    onPreThink: (result) => {
      setPreThinkResult({ intent: result.intent, isReading: result.isReading });
    }
  });

  const handleTypingUpdate = useCallback((text: string) => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    if (text.length >= 10) {
      setPreThinkResult({ intent: null, isReading: true });
      typingTimeoutRef.current = setTimeout(() => {
        sendTypingUpdate(text, activeConversationId ?? undefined);
      }, 300);
    } else {
      setPreThinkResult(null);
    }
  }, [sendTypingUpdate, activeConversationId]);
  
  const aiPreview = useAIPreview({ userId: user?.id });
  
  const [pendingFileAnalysis, setPendingFileAnalysis] = useState<{ content: string; fileName: string; imageDataUrl?: string; pdfPageImages?: string[]; pdfBase64Full?: string } | null>(null);
  const [showImageEditor, setShowImageEditor] = useState(false);
  const dailyTriggerRef = useRef(false);
  
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
  
  const [useRealtimeMode, setUseRealtimeMode] = useState(() => {
    const saved = localStorage.getItem("ulysse-realtime-mode");
    return saved === "true";
  });
  const scrollRef = useRef<HTMLDivElement>(null);

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
    handleSendMessage, handleSend, handleSendMessageRef, lastConfidenceRef,
  } = useDashboardChat({
    input, setInput, activeConversationId,
    isStreaming, setIsStreaming, setStreamingContent,
    autoSpeak, ttsSupported, speak,
    pendingFileAnalysis, setPendingFileAnalysis,
    displayWindow, panels,
    setNavigationDestination, setPreThinkResult,
  });

  const ttsEndTimeRef = useRef<number>(0);

  const { conversationMode, setConversationMode, manualStopRef } = useDashboardConversation({
    transcript, setTranscript, isSpeaking, isListening, isStreaming,
    ttsSupported, sttSupported, speak, stopSpeaking, stopListening, startListening,
    lastSpokenText, handleSendMessage, handleSendMessageRef, setOnAutoSubmit,
    isOwner: user?.isOwner || false, personaName, ttsEndTimeRef,
  });
  
  useEffect(() => {
    suspendAudioRef.current = suspendAudio;
    resumeAudioRef.current = resumeAudio;
  }, [suspendAudio, resumeAudio]);
  
  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    localStorage.setItem("ulysse-realtime-mode", String(useRealtimeMode));
  }, [useRealtimeMode]);

  useEffect(() => {
    localStorage.setItem("ulysse-mic-active", String(isListening));
  }, [isListening]);

  const hasMicRestoredRef = useRef(false);
  useEffect(() => {
    if (hasMicRestoredRef.current || !permissionsReady) return;
    hasMicRestoredRef.current = true;
    
    const savedMicState = localStorage.getItem("ulysse-mic-active");
    if (savedMicState === "true" && !isListening && micPermission !== "denied") {
      startListening();
    }
  }, [permissionsReady, isListening, micPermission, startListening]);

  const conversationMood = useMemo<ConversationMood>(() => {
    if (!conversations) return "neutral";
    const activeConv = conversations.find(c => c.id === activeConversationId);
    if (!activeConv?.messages || activeConv.messages.length === 0) return "neutral";
    return analyzeMood(activeConv.messages);
  }, [conversations, activeConversationId]);

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

  const hasInitializedRef = useRef(false);
  useEffect(() => {
    if (!conversations || hasInitializedRef.current) return;
    
    if (activeConversationId) {
      const exists = conversations.some(c => c.id === activeConversationId);
      if (exists) {
        hasInitializedRef.current = true;
        return;
      }
      localStorage.removeItem("ulysse-active-conversation");
    }
    
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

  useEffect(() => {
    if (micPermission === "denied" && !permissionsReady) {
      console.log("Microphone permission denied - user can click mic button to retry");
    }
  }, [micPermission, permissionsReady]);

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

  useEffect(() => {
    if (!user || hasGreeted || !permissionsReady) return;
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

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversations, activeConversationId, streamingContent]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      if (isSpeaking) stopSpeaking();
      startListening();
    }
  }, [isListening, isSpeaking, stopListening, stopSpeaking, startListening]);

  const activeConversation = conversations?.find(c => c.id === activeConversationId);
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

      <DashboardHeader
        user={user}
        personaName={personaName}
        panels={panels}
        logout={logout}
        createConversation={createConversation}
        setActiveConversationId={setActiveConversationId}
        isSpeaking={isSpeaking}
        isListening={isListening}
        isStreaming={isStreaming}
        isProcessing={isProcessing}
        isInCall={isInCall}
        callState={callState}
        startCall={startCall}
        endCall={endCall}
        autoSpeak={autoSpeak}
        setAutoSpeak={setAutoSpeak}
        sttSupported={sttSupported}
        ttsSupported={ttsSupported}
        startListening={startListening}
        stopListening={stopListening}
        stopSpeaking={stopSpeaking}
        setConversationMode={setConversationMode}
        micPermission={micPermission}
        requestMicrophonePermission={requestMicrophonePermission}
        isIOS={isIOS}
        unlockTTS={unlockTTS}
        burgerMenuOpen={burgerMenuOpen}
        setBurgerMenuOpen={setBurgerMenuOpen}
        handleLogoLongPressStart={handleLogoLongPressStart}
        handleLogoLongPressEnd={handleLogoLongPressEnd}
      />

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

      <DashboardPanels
        panels={panels}
        diagnostics={diagnostics}
        activeConversationId={activeConversationId}
        setActiveConversationId={setActiveConversationId}
        personaName={personaName}
        geo={geo}
        geoAccuracyMode={geoAccuracyMode}
        setGeoAccuracyMode={setGeoAccuracyMode}
        navigationDestination={navigationDestination}
        setNavigationDestination={setNavigationDestination}
        isOwner={user?.isOwner || false}
        showImageEditor={showImageEditor}
        setShowImageEditor={setShowImageEditor}
        pendingFileAnalysis={pendingFileAnalysis}
        setPendingFileAnalysis={setPendingFileAnalysis}
      />

      <DashboardiOSSlider
        isIOS={isIOS}
        ttsSupported={ttsSupported}
        ttsUnlocked={ttsUnlocked}
        unlockTTS={unlockTTS}
      />

      <div className="flex-1 flex flex-col lg:flex-row items-center lg:items-start justify-start lg:justify-center p-4 md:p-8 relative overflow-y-auto overflow-x-hidden gap-6 lg:gap-10 w-full max-w-full">
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

        <DashboardLeftColumn
          personaName={personaName}
          visualMode={visualMode}
          conversationMood={conversationMood}
          displayWindow={displayWindow}
          isOwner={user?.isOwner || false}
          isActive={isActive}
          isSpeaking={isSpeaking}
          isListening={isListening}
          isSearching={isSearching}
          isAnalyzing={isAnalyzing}
          orbColor={orbColor}
          orbIntensity={orbIntensity}
          isPaused={isAppPaused}
          reducedMotion={prefersReducedMotion}
        />

        <div className="flex flex-col items-center gap-4 z-10 w-full lg:flex-1">
          <motion.div
            className="text-center mb-4 md:mb-6 z-10"
            animate={{ opacity: isActive ? 1 : 0.7 }}
          >
            <h2 className="text-lg md:text-2xl font-semibold text-foreground mb-2 flex items-center justify-center gap-2">
              {isSpeaking ? `${personaName} parle` : isListening ? "Je vous écoute" : isStreaming ? (
                <>
                  <span>{personaName} réfléchit</span>
                  <span className="inline-flex gap-1">
                    <motion.span className="w-2 h-2 bg-primary rounded-full" animate={{ scale: [1, 1.3, 1], opacity: [0.5, 1, 0.5] }} transition={{ duration: 0.8, repeat: Infinity, delay: 0 }} />
                    <motion.span className="w-2 h-2 bg-primary rounded-full" animate={{ scale: [1, 1.3, 1], opacity: [0.5, 1, 0.5] }} transition={{ duration: 0.8, repeat: Infinity, delay: 0.2 }} />
                    <motion.span className="w-2 h-2 bg-primary rounded-full" animate={{ scale: [1, 1.3, 1], opacity: [0.5, 1, 0.5] }} transition={{ duration: 0.8, repeat: Infinity, delay: 0.4 }} />
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

          <ProgressTrackerInline userId={user?.id} />

          {user?.isOwner && <DashboardShortcuts navigate={navigate} />}

          <DashboardChatArea
            lastMessages={lastMessages}
            streamingContent={streamingContent}
            isStreaming={isStreaming}
            personaName={personaName}
            activeConversationId={activeConversationId}
            copiedMsgIdx={copiedMsgIdx}
            setCopiedMsgIdx={setCopiedMsgIdx}
            scrollRef={scrollRef}
            input={input}
            setInput={setInput}
            handleSend={handleSend}
            handleTypingUpdate={handleTypingUpdate}
            isListening={isListening}
            isProcessing={isProcessing}
            sttSupported={sttSupported}
            ttsSupported={ttsSupported}
            startListening={startListening}
            stopListening={stopListening}
            setConversationMode={setConversationMode}
            micPermission={micPermission}
            requestMicrophonePermission={requestMicrophonePermission}
            isIOS={isIOS}
            unlockTTS={unlockTTS}
            manualStopRef={manualStopRef}
            preThinkResult={preThinkResult}
            pendingFileAnalysis={pendingFileAnalysis}
            setPendingFileAnalysis={setPendingFileAnalysis}
            setShowImageEditor={setShowImageEditor}
            queryClient={queryClient}
          />
        </div>
      </div>

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
