import { createPortal } from "react-dom";
import { PageContainer } from "@/components/layout/PageContainer";
import { useConversations, useCreateConversation, useConversation } from "@/hooks/use-chat";
import { useVoice } from "@/hooks/use-voice";
import { useSharedVoice } from "@/components/VoiceProvider";
import { useVoiceState } from "@/hooks/use-voice-state";
import { useAuth } from "@/hooks/use-auth";
import { useConversationSync, type SyncMessage } from "@/hooks/useConversationSync";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UlysseAvatar } from "@/components/visualizer/UlysseAvatar";
import { IrisAvatar } from "@/components/visualizer/IrisAvatar";
import { Bot, Send, Plus, User, Sparkles, Mic, MicOff, Volume2, VolumeX, Square, Loader2, AlertCircle, Clock, MapPin, Calendar, Phone, ChevronsUp, ChevronsDown } from "lucide-react";
import { useLocation } from "wouter";
import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

const StatusPill = memo(function StatusPill({ 
  state, 
  partialTranscript 
}: { 
  state: "idle" | "listening" | "thinking" | "speaking" | "wakeword";
  partialTranscript: string;
}) {
  const config = useMemo(() => ({
    idle: { text: "", color: "bg-muted", icon: null },
    listening: { text: partialTranscript || "Je vous ecoute...", color: "bg-violet-500", icon: Mic },
    thinking: { text: "Je reflechis...", color: "bg-amber-500", icon: Loader2 },
    speaking: { text: "Je parle...", color: "bg-emerald-500", icon: Volume2 },
    wakeword: { text: "Mot de reveil detecte!", color: "bg-amber-400", icon: Sparkles }
  }), [partialTranscript]);

  const current = config[state];
  
  if (state === "idle") return null;

  const Icon = current.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={cn(
        "flex items-center gap-2 px-4 py-2 rounded-full text-white text-sm font-medium shadow-lg",
        current.color
      )}
    >
      {Icon && <Icon className={cn("w-4 h-4", state === "thinking" && "animate-spin")} />}
      <span className="max-w-[200px] truncate">{current.text}</span>
    </motion.div>
  );
});

const LocationInfo = memo(function LocationInfo() {
  const [time, setTime] = useState(new Date());
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setLocationError(null);
        },
        (err) => {
          setLocationError(err.message);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      setLocationError("GPS non disponible");
    }
  }, []);

  const formatDate = (d: Date) => {
    return d.toLocaleDateString("fr-FR", { 
      weekday: "short", 
      day: "numeric", 
      month: "short",
      year: "numeric"
    });
  };

  const formatTime = (d: Date) => {
    return d.toLocaleTimeString("fr-FR", { 
      hour: "2-digit", 
      minute: "2-digit",
      second: "2-digit"
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <div className="flex items-center gap-1">
        <Clock className="w-3 h-3" />
        <span data-testid="text-time">{formatTime(time)}</span>
      </div>
      <div className="flex items-center gap-1">
        <Calendar className="w-3 h-3" />
        <span data-testid="text-date">{formatDate(time)}</span>
      </div>
      <div className="flex items-center gap-1">
        <MapPin className="w-3 h-3" />
        {location ? (
          <span data-testid="text-gps">
            {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
          </span>
        ) : locationError ? (
          <span className="text-destructive/70" data-testid="text-gps-error">
            {locationError}
          </span>
        ) : (
          <span data-testid="text-gps-loading">Localisation...</span>
        )}
      </div>
    </div>
  );
});

const MessageBubble = memo(function MessageBubble({ 
  msg, 
  idx, 
  ttsSupported, 
  onSpeak 
}: { 
  msg: { role: string; content: string };
  idx: number;
  ttsSupported: boolean;
  onSpeak: (text: string) => void;
}) {
  const isUser = msg.role === "user";
  
  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={cn(
        "flex gap-3 max-w-[90%] md:max-w-3xl",
        isUser ? "ml-auto flex-row-reverse" : "mr-auto"
      )}
    >
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-md",
        isUser ? "bg-primary text-white" : "bg-gradient-to-br from-emerald-400 to-teal-600 text-white"
      )}>
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>
      <div className={cn(
        "rounded-2xl px-4 py-3 shadow-md",
        isUser 
          ? "bg-primary text-primary-foreground" 
          : "bg-secondary/80 text-foreground border border-border/50"
      )}>
        <div className="prose prose-sm dark:prose-invert max-w-none break-words [&_*]:text-foreground [&_a]:text-blue-500 dark:[&_a]:text-blue-400 [&_a]:underline">
          <ReactMarkdown>{msg.content}</ReactMarkdown>
        </div>
        {!isUser && ttsSupported && (
          <Button
            size="sm"
            variant="ghost"
            className="mt-1 text-xs text-muted-foreground p-1 h-auto"
            onClick={() => onSpeak(msg.content.replace(/```[\s\S]*?```/g, "").replace(/[#*_`]/g, "").replace(/\n+/g, " "))}
            data-testid={`button-speak-message-${idx}`}
          >
            <Volume2 className="w-3 h-3 mr-1" /> Lire
          </Button>
        )}
      </div>
    </motion.div>
  );
});

export default function Assistant() {
  const { data: conversations, isLoading: loadingConvs } = useConversations();
  const createConversation = useCreateConversation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  // Use shared autoSpeak from VoiceProvider context
  const { autoSpeak, setAutoSpeak } = useSharedVoice();
  
  const [showSidebar, setShowSidebar] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedIdRef = useRef<number | null>(null);
  const isStreamingRef = useRef(false);
  const handleSendRef = useRef<(msg?: string) => void>(() => {});
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerPrefetch = useCallback((text: string) => {
    if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
    if (!text || text.trim().length < 4 || isStreamingRef.current) return;
    prefetchTimerRef.current = setTimeout(async () => {
      try {
        await fetch("/api/chat/prefetch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text, conversationId: selectedIdRef.current }),
          credentials: "include"
        });
      } catch {}
    }, 700);
  }, []);

  // Callback for receiving synced messages from other devices (mobile, etc.)
  const handleSyncedMessage = useCallback((message: SyncMessage, origin: string, threadId?: string) => {
    console.log(`[AssistantSync] Received message from ${origin}:`, message.content.substring(0, 50));
    
    // Immediately update the query cache with the new message for real-time display
    if (selectedIdRef.current) {
      queryClient.setQueryData(
        ["/api/conversations", selectedIdRef.current],
        (old: any) => {
          if (!old || !old.messages) return old;
          // Check if message already exists to avoid duplicates
          const exists = old.messages.some((m: any) => 
            m.content === message.content && 
            Math.abs(new Date(m.createdAt).getTime() - new Date(message.timestamp).getTime()) < 5000
          );
          if (exists) return old;
          return {
            ...old,
            messages: [...old.messages, {
              id: Date.now(),
              conversationId: selectedIdRef.current,
              role: message.role,
              content: message.content,
              createdAt: new Date(message.timestamp)
            }]
          };
        }
      );
    }
    
    // Also invalidate to ensure persistence sync
    queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
  }, [queryClient]);

  // Conversation sync for bidirectional real-time sync with mobile
  const { sendMessage: syncMessage, isConnected: isSyncConnected } = useConversationSync({
    userId: user?.id,
    deviceId: "web",
    onMessage: handleSyncedMessage,
    enabled: !!user?.id
  });

  // Reload conversation when updates come from other devices
  const handleConversationsUpdated = useCallback((conversationId?: number) => {
    queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    if (conversationId && conversationId !== selectedIdRef.current) {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversationId] });
    }
  }, [queryClient]);

  // Handle incoming messages from TalkingApp (/talking)
  const handleTalkingMessage = useCallback((message: any) => {
    console.log(`[AssistantSync] Received message from /talking:`, message.content?.substring(0, 50));
    // Invalidate conversations to refresh the chat with new messages
    if (selectedIdRef.current) {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", selectedIdRef.current] });
    }
    queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
  }, [queryClient]);

  // Real-time sync to reload conversations when updated from other sources
  const { sendTalkingMessage } = useRealtimeSync({
    userId: user?.id,
    onConversationsUpdated: handleConversationsUpdated,
    onTalkingMessage: handleTalkingMessage
  });

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const voiceState = useVoiceState({ enableHaptics: true });

  const { 
    isListening, 
    isSpeaking, 
    transcript, 
    sttSupported,
    ttsSupported,
    startListening, 
    stopListening, 
    speak, 
    stopSpeaking,
    setTranscript,
    interrupt,
    isProcessing,
    initializeAudio,
    isIOS,
    micPermission,
    requestMicrophonePermission,
    setOnAutoSubmit
  } = useVoice();

  const audioInitializedRef = useRef(false);
  
  const ensureAudioInitialized = useCallback(async () => {
    if (!audioInitializedRef.current) {
      audioInitializedRef.current = true;
      await initializeAudio();
    }
  }, [initializeAudio]);

  const { data: activeConversation } = useConversation(selectedId);

  useEffect(() => {
    if (scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    }
  }, [activeConversation?.messages, streamingContent, selectedId]);

  useEffect(() => {
    if (!selectedId && conversations?.length && conversations.length > 0) {
      setSelectedId(conversations[0].id);
    }
  }, [conversations, selectedId]);

  useEffect(() => {
    if (isListening) {
      voiceState.startListening();
    } else if (isProcessing || isStreaming) {
      voiceState.startThinking();
    } else if (isSpeaking) {
      voiceState.startSpeaking();
    } else {
      voiceState.goIdle();
    }
  }, [isListening, isSpeaking, isProcessing, isStreaming, voiceState]);

  const handleVoiceSend = useCallback((text: string) => {
    if (!text.trim() || !selectedIdRef.current || isStreamingRef.current) return;
    handleSendRef.current(text);
  }, []);

  // Register auto-submit callback for "à toi" voice trigger
  useEffect(() => {
    setOnAutoSubmit((text: string) => {
      console.log("[Assistant] 'À toi' triggered auto-submit:", text.slice(0, 30));
      handleVoiceSend(text);
    });
    return () => setOnAutoSubmit(null);
  }, [setOnAutoSubmit, handleVoiceSend]);

  useEffect(() => {
    if (transcript) {
      voiceState.updatePartialTranscript(transcript);
      
      if (!isListening) {
        const finalTranscript = transcript;
        setInput(finalTranscript);
        setTranscript("");
        
        if (finalTranscript.trim()) {
          setTimeout(() => handleVoiceSend(finalTranscript), 1000);
        }
      }
    }
  }, [transcript, isListening, setTranscript, voiceState, handleVoiceSend]);

  const handleCreateNew = useCallback(() => {
    createConversation.mutate("Chat avec Ulysse", {
      onSuccess: (newConv) => {
        setSelectedId(newConv.id);
        setShowSidebar(false);
      }
    });
  }, [createConversation]);

  const handleSend = useCallback(async (messageOverride?: string) => {
    const messageToSend = messageOverride || input;
    if (!messageToSend.trim() || !selectedId || isStreaming) return;
    
    if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
    const userMessage = messageToSend.trim();
    const userMessageId = `user_${Date.now()}`;
    setInput("");
    setIsStreaming(true);
    setStreamingContent("");
    voiceState.startThinking();

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    queryClient.setQueryData(["/api/conversations", selectedId], (old: any) => ({
      ...old,
      messages: [...(old?.messages || []), { role: "user", content: userMessage, createdAt: new Date() }]
    }));

    // Sync user message to other devices (mobile)
    syncMessage({
      id: userMessageId,
      role: "user",
      content: userMessage,
      timestamp: new Date()
    }, String(selectedId));

    // Sync to TalkingApp (/talking)
    sendTalkingMessage({
      id: userMessageId,
      role: "user",
      content: userMessage,
      timestamp: new Date(),
      origin: "chat"
    });

    let fullResponse = "";
    let lastHeartbeat = Date.now();
    const assistantMessageId = `assistant_${Date.now()}`;

    try {
      const res = await fetch(`/api/conversations/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: userMessage }),
        signal: abortControllerRef.current.signal,
        credentials: "include"
      });

      if (!res.ok) throw new Error("Failed to send message");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) return;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        lastHeartbeat = Date.now();
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n\n");
        
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                fullResponse += data.content;
                setStreamingContent(prev => prev + data.content);
              }
            } catch {
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("Streaming error", err);
        setMessages(prev => [...prev, { role: "assistant" as const, content: "Désolé, une erreur est survenue. Réessaie." }]);
      }
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
      abortControllerRef.current = null;
      
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", selectedId] });
      
      // Sync assistant response to other devices after streaming completes
      if (fullResponse) {
        syncMessage({
          id: assistantMessageId,
          role: "assistant",
          content: fullResponse,
          timestamp: new Date()
        }, String(selectedId));
        
        // Sync to TalkingApp (/talking)
        sendTalkingMessage({
          id: assistantMessageId,
          role: "assistant",
          content: fullResponse,
          timestamp: new Date(),
          origin: "chat"
        });
      }
      
      if (autoSpeak && fullResponse && ttsSupported) {
        voiceState.startSpeaking();
        const cleanText = fullResponse
          .replace(/```[\s\S]*?```/g, "")
          .replace(/[#*_`]/g, "")
          .replace(/\n+/g, " ")
          .trim();
        speak(cleanText);
      } else {
        voiceState.goIdle();
      }
    }
  }, [input, selectedId, isStreaming, queryClient, autoSpeak, ttsSupported, speak, voiceState, syncMessage, sendTalkingMessage]);

  useEffect(() => {
    handleSendRef.current = handleSend;
  }, [handleSend]);

  const toggleListening = useCallback(async () => {
    await ensureAudioInitialized();
    
    if (isSpeaking) {
      interrupt();
      voiceState.triggerHaptic("light");
    }
    
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, isSpeaking, startListening, stopListening, interrupt, voiceState, ensureAudioInitialized]);

  const handleInterrupt = useCallback(() => {
    if (isSpeaking) {
      stopSpeaking();
      voiceState.triggerHaptic("light");
    }
    if (isStreaming && abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
      setStreamingContent("");
    }
    voiceState.goIdle();
  }, [isSpeaking, isStreaming, stopSpeaking, voiceState]);

  const handleSpeak = useCallback((text: string) => {
    speak(text);
  }, [speak]);

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  return (
    <PageContainer title="Ulysse - Assistant IA">
      <div className="flex flex-col md:grid md:grid-cols-4 gap-4 md:gap-6 h-[calc(100vh-8rem)] md:h-[calc(100vh-12rem)]">
        
        <div className={cn(
          "md:col-span-1 md:flex md:flex-col",
          isMobile ? (showSidebar ? "fixed inset-0 z-50 bg-background p-4" : "hidden") : ""
        )}>
          {isMobile && showSidebar && (
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-semibold">Conversations</h2>
              <Button size="icon" variant="ghost" onClick={() => setShowSidebar(false)} data-testid="button-close-sidebar">
                <Square className="w-4 h-4" />
              </Button>
            </div>
          )}
          <Card className="bg-card border-border flex flex-col overflow-hidden flex-1">
            <div className="p-3 border-b border-border">
              <Button 
                className="w-full justify-start bg-primary/10 text-primary border border-primary/20"
                onClick={handleCreateNew}
                disabled={createConversation.isPending}
                data-testid="button-new-chat"
              >
                <Plus className="mr-2 h-4 w-4" /> Nouvelle conversation
              </Button>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-1">
                {loadingConvs ? (
                  <div className="p-4 text-center text-muted-foreground">Chargement...</div>
                ) : conversations?.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => { setSelectedId(conv.id); setShowSidebar(false); }}
                    data-testid={`button-conversation-${conv.id}`}
                    className={cn(
                      "w-full text-left px-3 py-3 rounded-lg text-sm transition-colors truncate flex items-center gap-2",
                      selectedId === conv.id
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover-elevate active-elevate-2"
                    )}
                  >
                    <Bot className="w-4 h-4 shrink-0" />
                    <span className="truncate">{conv.title}</span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </Card>
        </div>

        <Card className="flex-1 md:col-span-3 bg-card border-border flex flex-col overflow-hidden relative">
          {selectedId ? (
            <>
              <div className="p-3 md:p-4 border-b border-border flex items-center justify-between gap-2 md:gap-4">
                <div className="flex items-center gap-2 md:gap-3">
                  {isMobile && (
                    <Button size="icon" variant="ghost" onClick={() => setShowSidebar(true)} data-testid="button-show-sidebar">
                      <Bot className="w-5 h-5" />
                    </Button>
                  )}
                  <div className="w-10 h-10 md:w-12 md:h-12 relative">
                    {user?.isOwner ? (
                      <UlysseAvatar
                        isActive={voiceState.state !== "idle"}
                        isSpeaking={voiceState.isSpeaking}
                        isListening={voiceState.isListening}
                        className="w-full h-full"
                        reducedMotion={false}
                      />
                    ) : (
                      <IrisAvatar
                        isActive={voiceState.state !== "idle"}
                        isSpeaking={voiceState.isSpeaking}
                        isListening={voiceState.isListening}
                        className="w-full h-full"
                        reducedMotion={false}
                      />
                    )}
                  </div>
                  <div className="hidden md:block">
                    <h2 className="font-semibold text-foreground">Ulysse</h2>
                    <LocationInfo />
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <AnimatePresence>
                    {voiceState.state !== "idle" && (
                      <StatusPill state={voiceState.state} partialTranscript={voiceState.partialTranscript} />
                    )}
                  </AnimatePresence>
                  
                  {(isSpeaking || isStreaming) && (
                    <Button
                      size="icon"
                      variant="destructive"
                      onClick={handleInterrupt}
                      title="Interrompre"
                      data-testid="button-interrupt"
                    >
                      <Square className="w-4 h-4" />
                    </Button>
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
                        if (isSpeaking) stopSpeaking();
                        setAutoSpeak(!autoSpeak);
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
                          if (isSpeaking) stopSpeaking();
                          setAutoSpeak(!autoSpeak);
                        }
                      }}
                      title={autoSpeak ? "Voix activee" : "Voix desactivee"}
                      data-testid="button-toggle-autospeak"
                      className={cn(
                        "flex items-center justify-center w-9 h-9 rounded-md border cursor-pointer select-none transition-colors",
                        autoSpeak ? "bg-primary border-primary text-primary-foreground" : "bg-background border-border text-foreground hover:bg-accent"
                      )}
                      style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent", WebkitUserSelect: "none" }}
                    >
                      {autoSpeak ? <Volume2 className="w-4 h-4 pointer-events-none" /> : <VolumeX className="w-4 h-4 pointer-events-none" />}
                    </div>
                  )}
                  
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate("/talking")}
                    title="Appel vocal"
                    data-testid="button-voice-call-header"
                    className="flex items-center justify-center w-9 h-9 rounded-md border cursor-pointer select-none transition-colors bg-green-500 border-green-600 text-white hover:bg-green-600"
                    style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent", WebkitUserSelect: "none" }}
                  >
                    <Phone className="w-4 h-4 pointer-events-none" />
                  </div>

                </div>
              </div>

              <div 
                className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-6 scroll-smooth" 
                ref={scrollRef}
              >
                {activeConversation?.messages?.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-50 px-4">
                    <div className="w-24 h-24 mb-6">
                      {user?.isOwner ? (
                        <UlysseAvatar isActive className="w-full h-full" />
                      ) : (
                        <IrisAvatar isActive className="w-full h-full" />
                      )}
                    </div>
                    <Sparkles className="w-8 h-8 mb-3" />
                    <p className="text-center text-lg">Salut Maurice!</p>
                    <p className="text-sm mt-2 text-center">Parle-moi, je suis la pour t'aider.</p>
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
                          toggleListening();
                        }}
                        onClick={(e) => {
                          if (isIOS) return;
                          e.preventDefault();
                          e.stopPropagation();
                          toggleListening();
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggleListening();
                          }
                        }}
                        className="mt-6 flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-md cursor-pointer select-none transition-colors hover:bg-primary/90"
                        style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent", WebkitUserSelect: "none" }}
                        data-testid="button-start-voice"
                      >
                        <Mic className="w-5 h-5 pointer-events-none" /> <span className="pointer-events-none">Appuie pour parler</span>
                      </div>
                    )}
                  </div>
                )}
                
                {activeConversation?.messages?.map((msg, idx) => (
                  <MessageBubble 
                    key={idx}
                    msg={msg}
                    idx={idx}
                    ttsSupported={ttsSupported}
                    onSpeak={handleSpeak}
                  />
                ))}

                <AnimatePresence>
                  {isStreaming && streamingContent && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="flex gap-3 max-w-[90%] md:max-w-3xl mr-auto"
                    >
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 text-white flex items-center justify-center shrink-0 shadow-md">
                        <Bot className="w-4 h-4" />
                      </div>
                      <div className="rounded-2xl px-4 py-3 shadow-md ai-bubble border border-border/50">
                        <div className="prose prose-sm dark:prose-invert max-w-none break-words [&_*]:text-foreground [&_a]:text-blue-500 dark:[&_a]:text-blue-400 [&_a]:underline">
                          <ReactMarkdown>{streamingContent}</ReactMarkdown>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="p-3 md:p-4 border-t border-border bg-card/80 backdrop-blur-sm safe-area-inset-bottom">
                <form 
                  onSubmit={(e) => { e.preventDefault(); handleSend(); }}
                  className="flex gap-2 max-w-3xl mx-auto items-center"
                >
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
                        if (isStreaming && !isSpeaking) return;
                        (async () => {
                          if (micPermission === "denied") {
                            await requestMicrophonePermission();
                          } else {
                            toggleListening();
                          }
                        })();
                      }}
                      onClick={(e) => {
                        if (isIOS) return;
                        e.preventDefault();
                        e.stopPropagation();
                        if (isStreaming && !isSpeaking) return;
                        (async () => {
                          if (micPermission === "denied") {
                            await requestMicrophonePermission();
                          } else {
                            toggleListening();
                          }
                        })();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          if (isStreaming && !isSpeaking) return;
                          (async () => {
                            if (micPermission === "denied") {
                              await requestMicrophonePermission();
                            } else {
                              toggleListening();
                            }
                          })();
                        }
                      }}
                      title={
                        micPermission === "denied" 
                          ? "Micro bloque - appuie pour reessayer" 
                          : isListening ? "Arreter" : "Parler"
                      }
                      data-testid="button-voice-input"
                      className={cn(
                        "flex items-center justify-center shrink-0 h-12 w-12 md:h-9 md:w-9 rounded-full border cursor-pointer select-none transition-colors",
                        isListening && "bg-destructive border-destructive text-destructive-foreground animate-pulse ring-2 ring-violet-500 ring-offset-2",
                        !isListening && micPermission === "denied" && "bg-secondary border-secondary text-secondary-foreground opacity-50",
                        !isListening && micPermission !== "denied" && "bg-background border-border text-foreground hover:bg-accent",
                        (isStreaming && !isSpeaking) && "opacity-50 cursor-not-allowed"
                      )}
                      style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent", WebkitUserSelect: "none" }}
                    >
                      {micPermission === "denied" ? (
                        <AlertCircle className="w-5 h-5 md:w-4 md:h-4 text-destructive pointer-events-none" />
                      ) : isListening ? (
                        <MicOff className="w-5 h-5 md:w-4 md:h-4 pointer-events-none" />
                      ) : (
                        <Mic className="w-5 h-5 md:w-4 md:h-4 pointer-events-none" />
                      )}
                    </div>
                  )}
                  <Input 
                    ref={inputRef}
                    value={input}
                    onChange={(e) => { setInput(e.target.value); triggerPrefetch(e.target.value); }}
                    placeholder={isListening ? "Je t'ecoute..." : "Ecris ton message..."}
                    className="flex-1 bg-secondary border-input focus:border-primary focus:ring-primary/20 h-12 md:h-9 text-base md:text-sm rounded-full px-4"
                    disabled={isStreaming || isListening}
                    data-testid="input-message"
                  />
                  <Button 
                    type="submit" 
                    size="icon" 
                    disabled={!input.trim() || isStreaming}
                    className="bg-primary shrink-0 h-12 w-12 md:h-9 md:w-9 rounded-full"
                    data-testid="button-send-message"
                  >
                    <Send className="w-5 h-5 md:w-4 md:h-4" />
                  </Button>
                </form>
              </div>

              {createPortal(
                <div style={{ position: 'fixed', right: '12px', top: '50%', transform: 'translateY(-50%)', zIndex: 2147483647, display: 'flex', flexDirection: 'column', gap: '8px', pointerEvents: 'auto' }}>
                  <button
                    onClick={() => scrollRef.current && (scrollRef.current.scrollTop = 0)}
                    data-testid="button-scroll-top"
                    style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(99,102,241,0.85)', border: '2px solid rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}
                    title="Remonter en haut"
                  >
                    <ChevronsUp style={{ width: '22px', height: '22px', color: 'white' }} />
                  </button>
                  <button
                    onClick={() => scrollRef.current && (scrollRef.current.scrollTop = scrollRef.current.scrollHeight)}
                    data-testid="button-scroll-bottom"
                    style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(99,102,241,0.85)', border: '2px solid rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}
                    title="Descendre en bas"
                  >
                    <ChevronsDown style={{ width: '22px', height: '22px', color: 'white' }} />
                  </button>
                </div>,
                document.body
              )}
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-6">
              <div className="w-32 h-32 mb-6">
                {user?.isOwner ? (
                  <UlysseAvatar isActive={false} className="w-full h-full" />
                ) : (
                  <IrisAvatar isActive={false} className="w-full h-full" />
                )}
              </div>
              <p className="text-center mb-4">Selectionne ou cree une conversation</p>
              <Button onClick={handleCreateNew} data-testid="button-create-first-chat">
                <Plus className="w-4 h-4 mr-2" /> Nouvelle conversation
              </Button>
            </div>
          )}
        </Card>
      </div>
    </PageContainer>
  );
}
