import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Send, Volume2, VolumeX, Sparkles, Activity, Plus, History, Mic, MicOff, Brain,
  LogOut, X, FolderOpen, Stethoscope, Wand2, BookOpen, MapPin, Camera, Eye, Music,
  Phone, PhoneOff, Menu, Check, Trophy, DollarSign, Settings, Mail, Store, ListTodo,
  BarChart3, Users, GitBranch, Pencil,
} from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { VoiceSettingsPanel } from "@/components/VoiceSettingsPanel";
import { PCMonitorToggle } from "@/components/PCMonitorToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UlysseAvatar } from "@/components/visualizer/UlysseAvatar";
import { IrisAvatar } from "@/components/visualizer/IrisAvatar";
import type { PanelManager } from "@/hooks/usePanelManager";

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

  return (
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
          <SpeakerButton
            autoSpeak={autoSpeak} setAutoSpeak={setAutoSpeak}
            isSpeaking={isSpeaking} stopSpeaking={stopSpeaking}
            isIOS={isIOS} unlockTTS={unlockTTS}
          />
        )}

        <div
          role="button" tabIndex={0}
          onClick={() => { if (isInCall) endCall(); else startCall(); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (isInCall) endCall(); else startCall(); } }}
          title={isInCall ? "Raccrocher" : "Appeler"}
          aria-label={isInCall ? "Terminer l'appel" : "Démarrer un appel vocal"}
          data-testid="button-voice-call"
          className={cn(
            "flex items-center justify-center w-11 h-11 rounded-xl border cursor-pointer select-none transition-colors text-white",
            isInCall ? "bg-red-500 border-red-600 hover:bg-red-600 animate-pulse"
              : callState === "connecting" ? "bg-yellow-500 border-yellow-600 hover:bg-yellow-600"
              : "bg-green-500 border-green-600 hover:bg-green-600"
          )}
          style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent", WebkitUserSelect: "none" }}
        >
          {isInCall ? <PhoneOff className="w-4 h-4 pointer-events-none" /> : <Phone className="w-4 h-4 pointer-events-none" />}
        </div>

        <div className="w-px h-6 bg-border mx-1" />

        <div className="hidden lg:flex items-center gap-1">
          <VoiceSettingsPanel />
          <Button size="icon" variant="outline" onClick={() => { createConversation.mutate("Ulysse Hub", { onSuccess: (newConv) => setActiveConversationId(newConv.id) }); }} title="Nouvelle conversation" data-testid="button-new-conversation">
            <Plus className="w-4 h-4" />
          </Button>
          <div className="w-px h-6 bg-border mx-1" />
          <Button size="icon" variant={panels.showHistory ? "default" : "outline"} onClick={() => panels.togglePanel("history")} title="Historique" data-testid="button-toggle-history"><History className="w-4 h-4" /></Button>
          <Button size="icon" variant={panels.showMemory ? "default" : "outline"} onClick={() => panels.togglePanel("memory")} title="Mémoire" data-testid="button-toggle-memory"><Brain className="w-4 h-4" /></Button>
          <Button size="icon" variant={panels.showFiles ? "default" : "outline"} onClick={() => panels.openPanel("files")} title="Fichiers" data-testid="button-toggle-files"><FolderOpen className="w-4 h-4" /></Button>
          <Button size="icon" variant={panels.showStudio ? "default" : "outline"} onClick={() => panels.togglePanel("studio")} title="Studio" data-testid="button-toggle-studio"><Wand2 className="w-4 h-4" /></Button>
          <Button size="icon" variant={panels.showDiagnostics ? "default" : "outline"} onClick={() => panels.togglePanel("diagnostics")} title="Diagnostics" data-testid="button-toggle-diagnostics"><Stethoscope className="w-4 h-4" /></Button>
          <Button size="icon" variant="outline" onClick={() => panels.openPanel("homework")} title="Homework" data-testid="button-toggle-homework"><BookOpen className="w-4 h-4" /></Button>
          <Button size="icon" variant={panels.showGeolocation ? "default" : "outline"} onClick={() => panels.togglePanel("geolocation")} title="Géolocalisation" data-testid="button-toggle-geolocation"><MapPin className="w-4 h-4" /></Button>
          <Button size="icon" variant={panels.showCamera ? "default" : "outline"} onClick={() => panels.openPanel("camera")} title="Caméra" data-testid="button-toggle-camera"><Camera className="w-4 h-4" /></Button>
          <Button size="icon" variant={panels.showLiveVision ? "default" : "outline"} onClick={() => panels.togglePanel("liveVision")} title="Vision Live" data-testid="button-toggle-vision"><Eye className="w-4 h-4" /></Button>
          <Button size="icon" variant={panels.showIntegrations ? "default" : "outline"} onClick={() => panels.togglePanel("integrations")} title="Intégrations" data-testid="button-toggle-integrations"><Music className="w-4 h-4" /></Button>
          <div className="w-px h-6 bg-border mx-1" />
          <Button size="icon" variant="outline" onClick={() => navigate("/sports/predictions")} title="Djedou Pronos" data-testid="button-goto-pronos"><Trophy className="w-4 h-4" /></Button>
          <Button size="icon" variant="outline" onClick={() => navigate("/superchat")} title="SuperChat" data-testid="button-goto-superchat"><Users className="w-4 h-4" /></Button>
          <div className="w-px h-6 bg-border mx-1" />
          <ThemeToggle />
          <PCMonitorToggle />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="icon" variant="ghost" title={`Déconnexion${user?.displayName ? ` (${user.displayName})` : ''}`} data-testid="button-logout"><LogOut className="w-4 h-4" /></Button>
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
    <div
      role="button" tabIndex={0}
      onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); handleToggle(); }}
      onClick={(e) => { if (isIOS) return; e.preventDefault(); e.stopPropagation(); handleToggle(); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleToggle(); } }}
      title={micPermission === "denied" ? "Cliquez pour autoriser le micro" : isProcessing ? "Traitement en cours..." : isListening ? "Appuyez pour arrêter l'écoute" : "Appuyez pour parler"}
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
      {isProcessing ? <Activity className="w-4 h-4 pointer-events-none animate-spin" /> : isListening ? <Mic className="w-4 h-4 pointer-events-none" /> : <MicOff className="w-4 h-4 pointer-events-none" />}
    </div>
  );
}

function SpeakerButton({ autoSpeak, setAutoSpeak, isSpeaking, stopSpeaking, isIOS, unlockTTS }: {
  autoSpeak: boolean; setAutoSpeak: (v: boolean) => void;
  isSpeaking: boolean; stopSpeaking: () => void;
  isIOS: boolean; unlockTTS: () => Promise<void>;
}) {
  const handleToggle = async () => {
    if (isIOS) await unlockTTS();
    if (isSpeaking) stopSpeaking();
    setAutoSpeak(!autoSpeak);
  };

  return (
    <div
      role="button" tabIndex={0}
      onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); handleToggle(); }}
      onClick={(e) => { if (isIOS) return; e.preventDefault(); e.stopPropagation(); handleToggle(); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleToggle(); } }}
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
  const activePanelCount = [panels.showHistory, panels.showMemory, panels.showFiles, panels.showStudio, panels.showDiagnostics, panels.showGeolocation, panels.showCamera, panels.showIntegrations].filter(Boolean).length;

  const menuItems = [
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
  ];

  return (
    <div className="lg:hidden relative">
      <Button size="icon" variant="outline" onClick={() => setBurgerMenuOpen(!burgerMenuOpen)} data-testid="button-burger-menu">
        {burgerMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
      </Button>
      {activePanelCount > 0 && !burgerMenuOpen && (
        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-medium pointer-events-none">
          {activePanelCount}
        </span>
      )}
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
            {menuItems.map((item) => (
              <button key={item.label} onClick={() => { item.action(); }} className="w-full flex items-center gap-3 px-3 py-2.5 text-sm hover-elevate" data-testid={`menu-${item.label.toLowerCase()}`}>
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
  );
}
