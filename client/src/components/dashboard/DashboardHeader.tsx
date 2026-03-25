import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
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
import { 
  Volume2, VolumeX, Sparkles, BarChart3, Box, Activity, 
  Plus, History, Brain, LogOut, FolderOpen,
  Zap, BookOpen, MapPin, Monitor, Menu, X, Check
} from "lucide-react";

interface DashboardHeaderProps {
  userName: string;
  personaName: string;
  autoSpeak: boolean;
  showHistory: boolean;
  showMemory: boolean;
  showDiagnostics: boolean;
  showFiles: boolean;
  showCodeSnapshot: boolean;
  showHomework: boolean;
  showGeolocation: boolean;
  isOwner: boolean;
  onToggleAutoSpeak: () => void;
  onNewConversation: () => void;
  onToggleHistory: () => void;
  onToggleMemory: () => void;
  onToggleDiagnostics: () => void;
  onToggleFiles: () => void;
  onToggleCodeSnapshot: () => void;
  onToggleHomework: () => void;
  onToggleGeolocation: () => void;
  onLogout: () => void;
}

export function DashboardHeader({
  userName,
  personaName,
  autoSpeak,
  showHistory,
  showMemory,
  showDiagnostics,
  showFiles,
  showCodeSnapshot,
  showHomework,
  showGeolocation,
  isOwner,
  onToggleAutoSpeak,
  onNewConversation,
  onToggleHistory,
  onToggleMemory,
  onToggleDiagnostics,
  onToggleFiles,
  onToggleCodeSnapshot,
  onToggleHomework,
  onToggleGeolocation,
  onLogout,
}: DashboardHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [menuOpen]);

  const menuItems = [
    { label: "Voix auto", icon: autoSpeak ? Volume2 : VolumeX, active: autoSpeak, onClick: onToggleAutoSpeak, testId: "button-toggle-voice" },
    { label: "Nouveau", icon: Plus, active: false, onClick: onNewConversation, testId: "button-new-conversation" },
    { label: "Historique", icon: History, active: showHistory, onClick: onToggleHistory, testId: "button-toggle-history" },
    { label: "Mémoire", icon: Brain, active: showMemory, onClick: onToggleMemory, testId: "button-toggle-memory" },
    { label: "Fichiers", icon: FolderOpen, active: showFiles, onClick: onToggleFiles, testId: "button-toggle-files" },
    ...(isOwner ? [
      { label: "Code", icon: Monitor, active: showCodeSnapshot, onClick: onToggleCodeSnapshot, testId: "button-toggle-code" },
      { label: "Devoirs", icon: BookOpen, active: showHomework, onClick: onToggleHomework, testId: "button-toggle-homework" },
    ] : []),
    { label: "Géolocalisation", icon: MapPin, active: showGeolocation, onClick: onToggleGeolocation, testId: "button-toggle-geolocation" },
  ];

  const activeCount = menuItems.filter(i => i.active).length;

  return (
    <header className="border-b border-border/50 bg-card/30 backdrop-blur-xl p-3 md:p-4 sticky top-0 z-50 ios-header-safe">
      <div className="flex items-center justify-between gap-2 md:gap-4">
        <div className="flex items-center gap-2 md:gap-4">
          <motion.div
            className="w-10 h-10 md:w-12 md:h-12 rounded-full ai-gradient flex items-center justify-center shadow-lg"
            whileHover={{ scale: 1.1 }}
            transition={{ type: "spring", stiffness: 300 }}
          >
            <span className="text-lg md:text-xl font-bold text-white">{personaName.charAt(0)}</span>
          </motion.div>
          <div>
            <h1 className="text-base md:text-lg font-semibold text-foreground flex items-center gap-1 md:gap-2">
              {personaName}
              <Badge variant="secondary" className="ml-1 md:ml-2 text-xs">
                <Sparkles className="w-2.5 h-2.5 md:w-3 md:h-3 mr-1" /> AI
              </Badge>
            </h1>
            <p className="text-xs md:text-sm text-muted-foreground hidden sm:block">
              Assistant de {userName}
            </p>
          </div>
        </div>
        
        <div className="hidden lg:flex items-center gap-2 flex-wrap justify-end">
          {menuItems.map((item) => (
            <Button
              key={item.testId}
              variant={item.active ? "default" : "outline"}
              size="sm"
              onClick={item.onClick}
              className="shrink-0"
              data-testid={item.testId}
            >
              <item.icon className="w-4 h-4 mr-1" />
              <span>{item.label}</span>
            </Button>
          ))}
          
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="shrink-0" data-testid="button-logout">
                <LogOut className="w-4 h-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirmer la déconnexion</AlertDialogTitle>
                <AlertDialogDescription>
                  Êtes-vous sûr de vouloir vous déconnecter de votre compte ?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-cancel-logout">Annuler</AlertDialogCancel>
                <AlertDialogAction 
                  onClick={onLogout}
                  className="bg-destructive text-destructive-foreground border-destructive-border hover:bg-destructive/90"
                  data-testid="button-confirm-logout"
                >
                  Se déconnecter
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div className="flex lg:hidden items-center gap-2" ref={menuRef}>
          <div className="relative">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setMenuOpen(!menuOpen)}
              data-testid="button-burger-menu"
            >
              {menuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </Button>
            {activeCount > 0 && !menuOpen && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-medium">
                {activeCount}
              </span>
            )}

            {menuOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 rounded-md border bg-popover text-popover-foreground shadow-lg z-[100] py-1 overflow-hidden">
                {menuItems.map((item) => (
                  <button
                    key={item.testId}
                    onClick={() => {
                      item.onClick();
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm hover-elevate transition-colors"
                    data-testid={`menu-${item.testId}`}
                  >
                    <item.icon className="w-4 h-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.active && (
                      <Check className="w-4 h-4 shrink-0 text-primary" />
                    )}
                  </button>
                ))}
                <div className="border-t my-1" />
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-destructive hover-elevate transition-colors"
                      data-testid="menu-button-logout"
                    >
                      <LogOut className="w-4 h-4 shrink-0" />
                      <span className="flex-1 text-left">Déconnexion</span>
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Confirmer la déconnexion</AlertDialogTitle>
                      <AlertDialogDescription>
                        Êtes-vous sûr de vouloir vous déconnecter de votre compte ?
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel data-testid="button-cancel-logout">Annuler</AlertDialogCancel>
                      <AlertDialogAction 
                        onClick={() => { setMenuOpen(false); onLogout(); }}
                        className="bg-destructive text-destructive-foreground border-destructive-border hover:bg-destructive/90"
                        data-testid="button-confirm-logout"
                      >
                        Se déconnecter
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
