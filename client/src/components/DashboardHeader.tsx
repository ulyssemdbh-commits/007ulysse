import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Send, Volume2, VolumeX, Sparkles, Activity, Plus, History, Mic, MicOff, Brain,
  LogOut, X, FolderOpen, Stethoscope, Wand2, BookOpen, MapPin, Camera, Eye, Music,
  Phone, PhoneOff, Menu, Check, Trophy, DollarSign, Settings, Mail, Store, ListTodo,
  BarChart3, Users, GitBranch, Pencil, Power, Bell, Clock, CloudSun, Zap,
} from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { VoiceSettingsPanel } from "@/components/VoiceSettingsPanel";
import { PCMonitorToggle } from "@/components/PCMonitorToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UlysseAvatar } from "@/components/visualizer/UlysseAvatar";
import { IrisAvatar } from "@/components/visualizer/IrisAvatar";
import type { PanelManager } from "@/hooks/usePanelManager";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

interface DashboardHeaderProps {
  user: { isOwner?: boolean; displayName?: string; username?: string; role?: string } | null | undefined;
  personaName: string;
  panels: PanelManager;
  logout: () => void;
  createConversation: { mutate: (title: string, opts?: { onSuccess?: (newConv: { id: number }) => void }) => void };
  setActiveConversationId: (id: number) => void;
  isSpeaking: boolean;
  isListening: boolean;
  isStreaming: boolean;
  isProcessing: boolean;
  isInCall: boolean;
  callState: string;
  startCall: () => void;
  endCall: () => void;
  autoSpeak: boolean;
  setAutoSpeak: (v: boolean) => void;
  sttSupported: boolean;
  ttsSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
  stopSpeaking: () => void;
  setConversationMode: (v: boolean) => void;
  micPermission: string;
  requestMicrophonePermission: () => Promise<void>;
  isIOS: boolean;
  unlockTTS: () => Promise<void>;
  burgerMenuOpen: boolean;
  setBurgerMenuOpen: (v: boolean) => void;
  handleLogoLongPressStart: () => void;
  handleLogoLongPressEnd: () => void;
}

export function DashboardHeader(props: DashboardHeaderProps) {
  const [, navigate] = useLocation();
  const {
    user, personaName, panels, logout, createConversation, setActiveConversationId,
    isSpeaking, isListening, isStreaming, isProcessing,
    isInCall, callState, startCall, endCall,
    autoSpeak, setAutoSpeak, sttSupported, ttsSupported,
    startListening, stopListening, stopSpeaking, setConversationMode,
    micPermission, requestMicrophonePermission,
    isIOS, unlockTTS, burgerMenuOpen, setBurgerMenuOpen,
    handleLogoLongPressStart, handleLogoLongPressEnd,
  } = props;

  const { data: marseilleInfo } = useQuery<{ weather: { temperature: string; condition: string } }>({
    queryKey: ["/api/marseille-info"],
    refetchInterval: 60000,
  });

  const [time, setTime] = useState(() =>
    new Date().toLocaleTimeString("fr-FR", { hour12: false })
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date().toLocaleTimeString("fr-FR", { hour12: false }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const notifications = 7;

  return (
    <header className="flex items-center justify-between h-11 sm:h-14 shrink-0 border border-blue-200 dark:border-cyan-500/30 bg-white/80 dark:bg-black/40 backdrop-blur-md rounded-xl px-2 sm:px-5 relative z-50">
      <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-blue-400 dark:via-cyan-400 to-transparent opacity-50" />

      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <div
          className="relative w-7 h-7 sm:w-9 sm:h-9 flex-shrink-0 flex items-center justify-center cursor-pointer"
          onMouseDown={handleLogoLongPressStart}
          onMouseUp={handleLogoLongPressEnd}
          onMouseLeave={handleLogoLongPressEnd}
          onTouchStart={handleLogoLongPressStart}
          onTouchEnd={handleLogoLongPressEnd}
          data-testid="logo-avatar"
        >
          <div className="absolute inset-0 rounded-full border-2 border-blue-500/50 dark:border-cyan-500/50 animate-[spin_4s_linear_infinite]" />
          <div className="absolute inset-1 rounded-full border border-indigo-400/50 dark:border-blue-500/50 animate-[spin_3s_linear_infinite_reverse]" />
          <Power className="w-3 h-3 sm:w-4 sm:h-4 text-blue-600 dark:text-cyan-400" />
        </div>
        <div className="min-w-0">
          <h1 className="text-sm sm:text-lg font-bold tracking-widest text-blue-700 dark:text-cyan-400 uppercase dark:drop-shadow-[0_0_8px_rgba(0,212,255,0.8)] truncate">ULYSSE</h1>
          <div className="text-[8px] sm:text-[9px] font-mono text-blue-500/70 dark:text-cyan-500/70 tracking-widest hidden sm:block">ASSISTANT IA PERSONNEL</div>
        </div>
      </div>

      <div className="hidden lg:flex items-center gap-4 font-mono text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/30 dark:border-red-500/30 border-red-200 cursor-pointer hover:bg-red-500/20 transition-colors" onClick={() => navigate("/emails")}>
            <Mail className="w-3 h-3 text-red-500 dark:text-red-400" />
            <span className="text-red-600 dark:text-red-300 font-bold">3</span>
            <span className="text-red-400/60 text-[10px]">non lus</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 dark:border-amber-500/30 border-amber-200 cursor-pointer hover:bg-amber-500/20 transition-colors" onClick={() => navigate("/tasks")}>
            <ListTodo className="w-3 h-3 text-amber-500 dark:text-amber-400" />
            <span className="text-amber-600 dark:text-amber-300 font-bold">5</span>
            <span className="text-amber-400/60 text-[10px]">taches</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-blue-500/10 dark:bg-cyan-500/10 border border-blue-200 dark:border-cyan-500/30 relative cursor-pointer hover:bg-blue-500/20 dark:hover:bg-cyan-500/20 transition-colors" onClick={() => panels.togglePanel("diagnostics")}>
            <Bell className="w-3 h-3 text-blue-500 dark:text-cyan-400" />
            <span className="text-blue-600 dark:text-cyan-300 font-bold">{notifications}</span>
            <span className="text-blue-400/60 dark:text-cyan-400/60 text-[10px]">alertes</span>
            {notifications > 0 && (
              <div className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 dark:bg-cyan-400 rounded-full animate-pulse dark:shadow-[0_0_6px_#00d4ff]" />
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-3 md:gap-5 font-mono">
        <div className="flex items-center gap-1 sm:gap-2">
          {sttSupported && (
            <MicButton
              isListening={isListening} isProcessing={isProcessing}
              micPermission={micPermission} isIOS={isIOS}
              startListening={startListening} stopListening={stopListening}
              setConversationMode={setConversationMode}
              requestMicrophonePermission={requestMicrophonePermission}
              unlockTTS={unlockTTS}
            />
          )}
          {ttsSupported && (
            <button
              onClick={async () => {
                if (isIOS) await unlockTTS();
                if (isSpeaking) stopSpeaking();
                setAutoSpeak(!autoSpeak);
              }}
              data-testid="button-toggle-autospeak"
              className={cn(
                "p-1.5 rounded-lg border transition-all",
                autoSpeak
                  ? "border-blue-500/50 dark:border-cyan-500/50 text-blue-600 dark:text-cyan-400 bg-blue-50 dark:bg-cyan-950/30"
                  : "border-blue-200 dark:border-cyan-900/30 text-blue-400 dark:text-cyan-700 hover:text-blue-600 dark:hover:text-cyan-400"
              )}
            >
              {autoSpeak ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            </button>
          )}
          <div
            role="button" tabIndex={0}
            onClick={() => { if (isInCall) endCall(); else startCall(); }}
            data-testid="button-voice-call"
            className={cn(
              "p-1.5 rounded-lg border transition-all cursor-pointer",
              isInCall
                ? "border-red-500/50 text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/30"
                : "border-blue-200 dark:border-cyan-900/50 text-blue-500 dark:text-cyan-600 bg-blue-50 dark:bg-cyan-950/30 hover:border-emerald-500/50 hover:text-emerald-500 dark:hover:text-emerald-400"
            )}
          >
            {isInCall ? <PhoneOff className="w-3.5 h-3.5" /> : <Phone className="w-3.5 h-3.5" />}
          </div>
        </div>

        <div className="hidden lg:flex items-center gap-3">
          <div className="h-7 w-px bg-blue-200 dark:bg-cyan-900/50" />
          <ThemeToggle />
          <div className="h-7 w-px bg-blue-200 dark:bg-cyan-900/50" />
          <div className="flex flex-col items-end">
            <div className="flex items-center gap-2 text-blue-600 dark:text-cyan-300">
              <CloudSun className="w-4 h-4" />
              <span className="text-sm">{marseilleInfo?.weather?.temperature || "--"}C</span>
            </div>
            <div className="text-[9px] text-blue-400/70 dark:text-cyan-500/70 tracking-widest uppercase">MARSEILLE</div>
          </div>
          <div className="h-7 w-px bg-blue-200 dark:bg-cyan-900/50" />
          <div className="flex items-center gap-2 text-lg tracking-wider text-blue-800 dark:text-cyan-100 dark:drop-shadow-[0_0_5px_rgba(0,212,255,0.5)]">
            <Clock className="w-4 h-4 text-blue-500 dark:text-cyan-500" />
            {time}
          </div>
        </div>

        <div className="hidden xl:flex items-center gap-1 ml-2">
          <Button size="icon" variant="ghost" className="w-7 h-7 text-blue-500 dark:text-cyan-600 hover:text-blue-700 dark:hover:text-cyan-400" onClick={() => { createConversation.mutate("Ulysse Hub", { onSuccess: (newConv) => setActiveConversationId(newConv.id) }); }} title="Nouvelle conversation" data-testid="button-new-conversation">
            <Plus className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className={cn("w-7 h-7", panels.showHistory ? "text-blue-700 dark:text-cyan-300" : "text-blue-500 dark:text-cyan-600 hover:text-blue-700 dark:hover:text-cyan-400")} onClick={() => panels.togglePanel("history")} title="Historique" data-testid="button-toggle-history"><History className="w-3.5 h-3.5" /></Button>
          <Button size="icon" variant="ghost" className={cn("w-7 h-7", panels.showMemory ? "text-blue-700 dark:text-cyan-300" : "text-blue-500 dark:text-cyan-600 hover:text-blue-700 dark:hover:text-cyan-400")} onClick={() => panels.togglePanel("memory")} title="Memoire" data-testid="button-toggle-memory"><Brain className="w-3.5 h-3.5" /></Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="icon" variant="ghost" className="w-7 h-7 text-blue-500 dark:text-cyan-600 hover:text-blue-700 dark:hover:text-cyan-400" title="Deconnexion" data-testid="button-logout"><LogOut className="w-3.5 h-3.5" /></Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirmer la deconnexion</AlertDialogTitle>
                <AlertDialogDescription>Etes-vous sur de vouloir vous deconnecter ?</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-cancel-logout">Annuler</AlertDialogCancel>
                <AlertDialogAction onClick={() => logout()} className="bg-destructive text-destructive-foreground border-destructive-border hover:bg-destructive/90" data-testid="button-confirm-logout">Se deconnecter</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <BurgerMenu
          burgerMenuOpen={burgerMenuOpen} setBurgerMenuOpen={setBurgerMenuOpen}
          panels={panels} navigate={navigate} logout={logout}
          createConversation={createConversation} setActiveConversationId={setActiveConversationId}
          user={user}
        />
      </div>
    </header>
  );
}

function MicButton({ isListening, isProcessing, micPermission, isIOS, startListening, stopListening, setConversationMode, requestMicrophonePermission, unlockTTS }: {
  isListening: boolean; isProcessing: boolean; micPermission: string; isIOS: boolean;
  startListening: () => void; stopListening: () => void; setConversationMode: (v: boolean) => void;
  requestMicrophonePermission: () => Promise<void>; unlockTTS: () => Promise<void>;
}) {
  const handleToggle = async () => {
    if (isIOS) await unlockTTS();
    if (isListening) {
      stopListening();
      setConversationMode(false);
    } else if (micPermission === "denied") {
      await requestMicrophonePermission();
    } else {
      startListening();
    }
  };

  return (
    <button
      onClick={handleToggle}
      data-testid="button-toggle-mic"
      className={cn(
        "p-1.5 rounded-lg border transition-all duration-300 relative overflow-hidden",
        isListening
          ? "border-red-500/50 text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/30 shadow-[0_0_15px_rgba(239,68,68,0.2)]"
          : "border-blue-200 dark:border-cyan-900/50 text-blue-500 dark:text-cyan-600 bg-blue-50 dark:bg-cyan-950/30 hover:border-blue-400 dark:hover:border-cyan-500/50 hover:text-blue-700 dark:hover:text-cyan-300"
      )}
    >
      {isListening && <div className="absolute inset-0 bg-red-500/20 animate-pulse" />}
      {isProcessing ? <Activity className="w-3.5 h-3.5 relative z-10 animate-spin" /> : <Mic className="w-3.5 h-3.5 relative z-10" />}
    </button>
  );
}

function BurgerMenu({ burgerMenuOpen, setBurgerMenuOpen, panels, navigate, logout, createConversation, setActiveConversationId, user }: {
  burgerMenuOpen: boolean; setBurgerMenuOpen: (v: boolean) => void;
  panels: PanelManager; navigate: (path: string) => void;
  logout: () => void;
  createConversation: { mutate: (title: string, opts?: { onSuccess?: (newConv: { id: number }) => void }) => void };
  setActiveConversationId: (id: number) => void;
  user: { isOwner?: boolean; displayName?: string } | null | undefined;
}) {
  const menuItems = [
    { label: "Historique", icon: History, active: panels.showHistory, action: () => panels.togglePanel("history") },
    { label: "Memoire", icon: Brain, active: panels.showMemory, action: () => panels.togglePanel("memory") },
    { label: "Fichiers", icon: FolderOpen, active: panels.showFiles, action: () => panels.openPanel("files") },
    { label: "Studio", icon: Wand2, active: panels.showStudio, action: () => panels.togglePanel("studio") },
    { label: "Diagnostics", icon: Stethoscope, active: panels.showDiagnostics, action: () => panels.togglePanel("diagnostics") },
    { label: "Devoirs", icon: BookOpen, active: false, action: () => panels.openPanel("homework") },
    { label: "Geolocalisation", icon: MapPin, active: panels.showGeolocation, action: () => panels.togglePanel("geolocation") },
    { label: "Camera", icon: Camera, active: panels.showCamera, action: () => panels.openPanel("camera") },
    { label: "Vision Live", icon: Eye, active: panels.showLiveVision, action: () => panels.togglePanel("liveVision") },
    { label: "Integrations", icon: Music, active: panels.showIntegrations, action: () => panels.togglePanel("integrations") },
  ];

  const navShortcuts = user?.isOwner ? [
    { label: "Pronos", icon: Trophy, path: "/sports/predictions", color: "text-yellow-400" },
    { label: "Brain", icon: Brain, path: "/brain", color: "text-purple-400" },
    { label: "Val", icon: Store, path: "/suguval", color: "text-emerald-400" },
    { label: "Maillane", icon: Store, path: "/sugumaillane", color: "text-teal-400" },
    { label: "Finances", icon: DollarSign, path: "/finances", color: "text-blue-400" },
    { label: "Projets", icon: FolderOpen, path: "/projects", color: "text-orange-400" },
    { label: "Taches", icon: ListTodo, path: "/tasks", color: "text-green-400" },
    { label: "Notes", icon: Pencil, path: "/notes", color: "text-pink-400" },
    { label: "Emails", icon: Mail, path: "/emails", color: "text-red-400" },
    { label: "Insights", icon: BarChart3, path: "/ulysse-insights", color: "text-cyan-400" },
    { label: "DevOps", icon: GitBranch, path: "/devops", color: "text-indigo-400" },
    { label: "Iris", icon: Sparkles, path: "/devops-iris", color: "text-amber-400" },
    { label: "SuperChat", icon: Users, path: "/superchat", color: "text-violet-400" },
    { label: "Traces", icon: Activity, path: "/traces", color: "text-cyan-400" },
    { label: "Skills", icon: Zap, path: "/skills", color: "text-yellow-400" },
    { label: "Diag", icon: Stethoscope, path: "/diagnostics", color: "text-slate-400" },
    { label: "Reglages", icon: Settings, path: "/settings", color: "text-slate-300" },
  ] : [];

  return (
    <div className="relative">
      <button onClick={() => setBurgerMenuOpen(!burgerMenuOpen)} data-testid="button-burger-menu"
        className="p-1.5 rounded-lg border border-blue-200 dark:border-cyan-900/50 text-blue-500 dark:text-cyan-600 bg-blue-50 dark:bg-cyan-950/30 hover:text-blue-700 dark:hover:text-cyan-400 transition-all">
        {burgerMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
      </button>
      {burgerMenuOpen && (
        <>
          <div className="fixed inset-0 z-[99]" onClick={() => setBurgerMenuOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-blue-200 dark:border-cyan-500/30 bg-white/95 dark:bg-[#0a0e1a]/95 backdrop-blur-md text-blue-700 dark:text-cyan-300 shadow-lg z-[100] py-1 overflow-hidden max-h-[80vh] overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
            <div className="px-3 py-2">
              <ThemeToggle className="w-full justify-start" />
            </div>
            <div className="border-t border-blue-100 dark:border-cyan-900/30 my-1" />
            <button onClick={() => { createConversation.mutate("Ulysse Hub", { onSuccess: (newConv) => setActiveConversationId(newConv.id) }); setBurgerMenuOpen(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-blue-50 dark:hover:bg-cyan-950/30 transition-colors" data-testid="menu-new-conversation">
              <Plus className="w-4 h-4 shrink-0 text-blue-500 dark:text-cyan-600" />
              <span className="flex-1 text-left font-mono text-xs">Nouvelle conversation</span>
            </button>

            {navShortcuts.length > 0 && (
              <div className="lg:hidden">
                <div className="border-t border-blue-100 dark:border-cyan-900/30 my-1" />
                <div className="px-3 py-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-blue-400/60 dark:text-cyan-600/60 font-semibold">Modules</span>
                </div>
                <div className="grid grid-cols-3 gap-1 px-2 pb-1">
                  {navShortcuts.map((item) => (
                    <button key={item.label} onClick={() => { setBurgerMenuOpen(false); navigate(item.path); }} className="flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-blue-50 dark:hover:bg-cyan-950/30 transition-colors" data-testid={`menu-nav-${item.label.toLowerCase()}`}>
                      <item.icon className={cn("w-4 h-4 shrink-0", item.color)} />
                      <span className="text-[10px] font-mono text-blue-600 dark:text-cyan-400/80 truncate w-full text-center">{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t border-blue-100 dark:border-cyan-900/30 my-1" />
            <div className="px-3 py-1.5">
              <span className="text-[10px] uppercase tracking-wider text-blue-400/60 dark:text-cyan-600/60 font-semibold">Panneaux</span>
            </div>
            {menuItems.map((item) => (
              <button key={item.label} onClick={() => { item.action(); }} className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-blue-50 dark:hover:bg-cyan-950/30 transition-colors" data-testid={`menu-${item.label.toLowerCase()}`}>
                <item.icon className="w-4 h-4 shrink-0 text-blue-500 dark:text-cyan-600" />
                <span className="flex-1 text-left font-mono text-xs">{item.label}</span>
                {item.active && <Check className="w-4 h-4 shrink-0 text-blue-600 dark:text-cyan-400" />}
              </button>
            ))}
            <div className="border-t border-blue-100 dark:border-cyan-900/30 my-1" />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-red-400 hover:bg-red-950/20 transition-colors" data-testid="menu-logout">
                  <LogOut className="w-4 h-4 shrink-0" />
                  <span className="flex-1 text-left font-mono text-xs">Deconnexion</span>
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirmer la deconnexion</AlertDialogTitle>
                  <AlertDialogDescription>Etes-vous sur de vouloir vous deconnecter ?</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-cancel-logout">Annuler</AlertDialogCancel>
                  <AlertDialogAction onClick={() => { setBurgerMenuOpen(false); logout(); }} className="bg-destructive text-destructive-foreground border-destructive-border hover:bg-destructive/90" data-testid="button-confirm-logout">Se deconnecter</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </>
      )}
    </div>
  );
}
