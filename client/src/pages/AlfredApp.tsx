import { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useSharedVoice } from "@/components/VoiceProvider";
import { useVoice } from "@/hooks/use-voice";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { DisplayWindow, useDisplayWindow } from "@/components/DisplayWindow";
import { AlfredAvatar } from "@/components/visualizer/AlfredAvatar";
import { MarseilleInfo } from "@/components/MarseilleInfo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AlfredPinPad, useAlfredPinAuth } from "@/components/AlfredPinPad";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLocation } from "wouter";
import { Send, Loader2, Volume2, VolumeX, LogOut, RefreshCw, Sparkles, Lock, Terminal, MessageSquare } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import { usePageManifest } from "@/hooks/usePageManifest";

const DevOpsMax = lazy(() => import("@/components/DevOpsMax"));

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface AuthUser {
  id: number;
  username: string;
  displayName?: string;
  isOwner?: boolean;
  role?: string;
}

function generateBrowserSessionId(): string {
  const existing = localStorage.getItem("alfred_browser_session");
  if (existing) return existing;
  const newId = `alfred_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  localStorage.setItem("alfred_browser_session", newId);
  return newId;
}

export default function AlfredApp() {
  usePageManifest({
    title: "Max Assistant",
    manifestPath: "/manifest-alfred.json",
    themeColor: "#4f46e5",
    appleTitle: "Max"
  });

  const { user, isLoading: authLoading, isAuthenticated, logout } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [isAutoLogging, setIsAutoLogging] = useState(false);
  const [autoLoginAttempted, setAutoLoginAttempted] = useState(false);
  const browserSessionId = useRef(generateBrowserSessionId());
  
  useEffect(() => {
    if (!authLoading && !isAuthenticated && !autoLoginAttempted) {
      setAutoLoginAttempted(true);
      setIsAutoLogging(true);
      
      fetch("/api/auth/max-auto-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ browserSessionId: browserSessionId.current }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error("Auto-login failed");
          const data = await res.json();
          if (data.success) {
            window.location.reload();
          }
        })
        .catch((error: any) => {
          console.error("[Alfred] Auto-login failed:", error);
          toast({ title: "Erreur", description: "Connexion impossible", variant: "destructive" });
        })
        .finally(() => {
          setIsAutoLogging(false);
        });
    }
  }, [authLoading, isAuthenticated, autoLoginAttempted, toast]);
  
  if (authLoading || isAutoLogging || (!isAuthenticated && !autoLoginAttempted)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center animate-pulse">
            <span className="text-3xl font-bold text-white">M</span>
          </div>
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground text-sm">Connexion en cours...</p>
        </div>
      </div>
    );
  }
  
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Impossible de se connecter à Max</p>
          <Button onClick={() => setAutoLoginAttempted(false)}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Réessayer
          </Button>
        </div>
      </div>
    );
  }
  
  return <AlfredWithPinProtection user={user as AuthUser} onLogout={logout} browserSessionId={browserSessionId.current} />;
}

function AlfredWithPinProtection({ user, onLogout, browserSessionId }: { user: AuthUser; onLogout: () => void; browserSessionId: string }) {
  const { isAuthenticated: isPinAuthenticated, authenticate: authenticatePin, logout: logoutPin } = useAlfredPinAuth();

  const handleLogout = useCallback(() => {
    logoutPin();
    onLogout();
  }, [logoutPin, onLogout]);

  const handleLockScreen = useCallback(() => {
    logoutPin();
  }, [logoutPin]);

  if (!isPinAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-8">
          <div className="absolute top-4 right-4">
            <ThemeToggle />
          </div>
          <AlfredPinPad
            correctPin="115256"
            onSuccess={authenticatePin}
          />
          <p className="text-xs text-muted-foreground max-w-xs text-center">
            La session expire apres 5 minutes d'inactivite
          </p>
        </div>
      </div>
    );
  }

  return (
    <AlfredDashboard 
      user={user} 
      onLogout={handleLogout} 
      browserSessionId={browserSessionId}
      onLockScreen={handleLockScreen}
    />
  );
}

function AlfredDashboard({ user, onLogout, browserSessionId, onLockScreen }: { user: AuthUser; onLogout: () => void; browserSessionId: string; onLockScreen?: () => void }) {
  const [activeSection, setActiveSection] = useState<"chat" | "devops">("chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [currentThreadId, setCurrentThreadId] = useState<number | null>(null);
  const { toast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const { autoSpeak, setAutoSpeak } = useSharedVoice();
  const { speak, stopSpeaking, isSpeaking, ttsSupported } = useVoice();
  
  // Display window for showing images and search results
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
  
  // Real-time sync for search results
  useRealtimeSync({ 
    userId: user.id,
    onSearchResults: handleSearchResults
  });
  
  const isSearching = useMemo(() => {
    if (!isStreaming || !streamingContent) return false;
    const searchKeywords = ["recherche", "searching", "🔍", "sources", "web", "internet"];
    return searchKeywords.some(kw => streamingContent.toLowerCase().includes(kw.toLowerCase()));
  }, [isStreaming, streamingContent]);
  
  const isAnalyzing = useMemo(() => {
    if (!isStreaming || !streamingContent) return false;
    const analyzeKeywords = ["analyse", "analyzing", "recoup", "vérifi", "cross-check"];
    return analyzeKeywords.some(kw => streamingContent.toLowerCase().includes(kw.toLowerCase()));
  }, [isStreaming, streamingContent]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  const isActive = isStreaming || isSpeaking;

  const handleSend = useCallback(async () => {
    const trimmedInput = input.trim();
    if (!trimmedInput || isStreaming) return;

    setInput("");
    setIsStreaming(true);
    setStreamingContent("");

    const userMessage: Message = {
      id: `user_${Date.now()}`,
      role: "user",
      content: trimmedInput,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);

    try {
      const response = await fetch("/api/v2/conversations", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Accept": "text/event-stream",
        },
        credentials: "include",
        body: JSON.stringify({
          message: trimmedInput,
          threadId: currentThreadId,
          browserSessionId,
          sessionContext: "alfred",
        }),
      });

      if (!response.ok) {
        throw new Error("Erreur lors de l'envoi du message");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";
      const assistantId = `assistant_${Date.now()}`;

      const assistantMessage: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === "start") {
                setCurrentThreadId(data.threadId);
              } else if (data.type === "chunk") {
                fullContent += data.content;
                setStreamingContent(fullContent);
                setMessages(prev => prev.map(m => 
                  m.id === assistantId ? { ...m, content: fullContent } : m
                ));
              } else if (data.type === "done") {
                setCurrentThreadId(data.threadId);
                if (autoSpeak && fullContent) {
                  speak(fullContent);
                }
              }
            } catch (e) {
              console.error("Parse error:", e);
            }
          }
        }
      }
    } catch (error: any) {
      console.error("Error:", error);
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
    }
  }, [input, currentThreadId, browserSessionId, isStreaming, autoSpeak, speak, toast]);

  const handleNewConversation = useCallback(() => {
    setMessages([]);
    setCurrentThreadId(null);
  }, []);

  const lastMessages = messages.slice(-10);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b bg-background/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center shadow-lg">
            <span className="text-lg font-bold text-white">M</span>
          </div>
          <div>
            <h1 className="font-semibold text-lg">Max</h1>
            <p className="text-xs text-muted-foreground">À votre service</p>
          </div>
          <div className="flex items-center ml-4 bg-muted rounded-lg p-0.5">
            <Button
              size="sm"
              variant={activeSection === "chat" ? "default" : "ghost"}
              className="h-7 text-xs gap-1.5 rounded-md"
              onClick={() => setActiveSection("chat")}
              data-testid="tab-max-chat"
            >
              <MessageSquare className="w-3.5 h-3.5" /> Chat
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs gap-1.5 rounded-md"
              onClick={() => navigate("/devmax")}
              data-testid="tab-max-devops"
            >
              <Terminal className="w-3.5 h-3.5" /> DevOpsMax
            </Button>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {activeSection === "chat" && ttsSupported && (
            <Button
              size="icon"
              variant={autoSpeak ? "default" : "outline"}
              onClick={() => {
                if (isSpeaking) stopSpeaking();
                setAutoSpeak(!autoSpeak);
              }}
              title={autoSpeak ? "Désactiver la voix" : "Activer la voix"}
              data-testid="button-toggle-voice"
            >
              {autoSpeak ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </Button>
          )}
          
          {activeSection === "chat" && (
            <Button
              size="icon"
              variant="outline"
              onClick={handleNewConversation}
              title="Nouvelle conversation"
              data-testid="button-new-conversation"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          )}

          <ThemeToggle />

          {onLockScreen && (
            <Button
              size="icon"
              variant="ghost"
              onClick={onLockScreen}
              title="Verrouiller"
              data-testid="button-lock-screen"
            >
              <Lock className="w-4 h-4" />
            </Button>
          )}

          <Button
            size="icon"
            variant="ghost"
            onClick={onLogout}
            title="Deconnexion"
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {activeSection === "devops" ? (
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>}>
            <DevOpsMax />
          </Suspense>
        </div>
      ) : (
      <>
      {/* Voice Status Bar */}
      <AnimatePresence>
        {(isSpeaking || isStreaming) && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-secondary/30 backdrop-blur-sm px-4 py-1.5 flex items-center justify-center gap-4 text-sm"
          >
            {isSpeaking && (
              <motion.div
                className="flex items-center gap-1.5 text-blue-500"
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 0.5, repeat: Infinity }}
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span className="font-medium">Max parle</span>
              </motion.div>
            )}
            {isStreaming && !isSpeaking && (
              <motion.div
                className="flex items-center gap-1.5 text-primary"
                animate={{ opacity: [1, 0.6, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span className="font-medium">Max réfléchit...</span>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-start md:justify-center p-4 md:p-8 relative overflow-y-auto">
        {/* Time and Weather Info */}
        <div className="w-full max-w-sm mb-4 md:mb-6 z-10">
          <MarseilleInfo />
        </div>

        {/* Background glow */}
        <motion.div 
          className="absolute inset-0 pointer-events-none overflow-hidden"
          animate={{ opacity: isActive ? 0.4 : 0.15 }}
          transition={{ duration: 0.8 }}
        >
          <motion.div 
            className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[200px] md:w-[350px] h-[200px] md:h-[350px] rounded-full"
            style={{
              background: `radial-gradient(circle, rgba(100,116,139,0.2) 0%, rgba(100,116,139,0.08) 40%, transparent 70%)`,
              filter: 'blur(60px)'
            }}
          />
        </motion.div>

        {/* Avatar */}
        <div className="relative z-10 w-full mb-4 md:mb-6 flex flex-col items-center gap-3">
          <div className="w-full max-w-[180px] md:max-w-[220px] aspect-square transition-all duration-300">
            <AlfredAvatar
              isActive={isActive}
              isSpeaking={isSpeaking}
              isListening={false}
              isSearching={isSearching}
              isAnalyzing={isAnalyzing}
              className="w-full h-full"
            />
          </div>
        </div>

        {/* Status text */}
        <motion.div
          className="text-center mb-4 md:mb-6 z-10"
          animate={{ opacity: isActive ? 1 : 0.7 }}
        >
          <h2 className="text-lg md:text-2xl font-semibold text-foreground mb-2 flex items-center justify-center gap-2">
            {isSpeaking ? "Max parle" : isStreaming ? (
              <>
                <span>Max réfléchit</span>
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
            ) : "Comment puis-je vous aider ?"}
          </h2>
          <p className="text-muted-foreground text-sm max-w-md mx-auto">
            Je suis en développement, merci d'être indulgent ;)
          </p>
          {isSpeaking && (
            <Button variant="ghost" size="sm" onClick={stopSpeaking} data-testid="button-stop-speaking">
              <VolumeX className="w-4 h-4 mr-2" /> Interrompre
            </Button>
          )}
        </motion.div>

        {/* Conversation Card */}
        <Card className="w-full max-w-2xl glass-card border-white/10 mb-4 md:mb-6 z-10 overflow-hidden">
          <ScrollArea className="h-64 md:h-80" ref={scrollRef}>
            <div className="p-4 md:p-5 space-y-3">
              {lastMessages.length === 0 && !streamingContent && (
                <p className="text-center text-muted-foreground text-sm py-8">
                  Dites "Bonjour" pour commencer la conversation
                </p>
              )}
              {lastMessages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "text-sm p-3 md:p-4 rounded-xl",
                    msg.role === "user" 
                      ? "user-bubble ml-8 md:ml-16"
                      : "ai-bubble mr-8 md:mr-16"
                  )}
                >
                  <p className="text-xs text-muted-foreground mb-1">
                    {msg.role === "user" ? "Vous" : "Max"}
                  </p>
                  <div className="prose prose-sm dark:prose-invert max-w-none [&_*]:text-foreground [&_a]:text-blue-500 dark:[&_a]:text-blue-400 [&_a]:underline">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                </motion.div>
              ))}
              {isStreaming && !streamingContent && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-sm p-2 md:p-3 rounded-lg ai-bubble mr-4 md:mr-8"
                >
                  <p className="text-xs text-muted-foreground mb-1">Max</p>
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
            </div>
          </ScrollArea>
        </Card>

        {/* Input Area */}
        <div className="w-full max-w-2xl z-10 pb-4">
          <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex items-center gap-3">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Écrivez votre message..."
              className="flex-1 h-12 md:h-14 glass-input border-white/10 rounded-2xl text-base px-5"
              disabled={isStreaming}
              data-testid="input-message"
            />
            <Button
              type="submit"
              size="default"
              disabled={!input.trim() || isStreaming}
              className="shrink-0 h-12 md:h-14 px-6"
              data-testid="button-send-message"
            >
              <Send className="w-5 h-5" />
            </Button>
          </form>
        </div>
      </div>
      
      {/* Display Window for images and search results */}
      <DisplayWindow
        content={displayWindow.content}
        isOpen={displayWindow.isOpen}
        onClose={displayWindow.close}
        className="z-50"
        persona="alfred"
      />
      </>
      )}
    </div>
  );
}
