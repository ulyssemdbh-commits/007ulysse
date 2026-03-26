import { motion, AnimatePresence } from "framer-motion";
import { 
  X, Sun, Moon, Camera, RefreshCw, History, Brain, 
  FolderOpen, Mail, MapPin, Stethoscope, BookOpen 
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { WakeLockToggle } from "@/components/WakeLockToggle";
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

interface MobileMenuProps {
  isOpen: boolean;
  isReconnecting: boolean;
  onClose: () => void;
  onOpenHistory: () => void;
  onOpenMemory: () => void;
  onOpenFiles: () => void;
  onOpenEmail: () => void;
  onOpenGeolocation: () => void;
  onOpenDiagnostics: () => void;
  onOpenHomework: () => void;
  onOpenCamera: () => void;
  onForceReconnect: () => void;
  onLogout: () => void;
}

export function MobileMenu({
  isOpen,
  isReconnecting,
  onClose,
  onOpenHistory,
  onOpenMemory,
  onOpenFiles,
  onOpenEmail,
  onOpenGeolocation,
  onOpenDiagnostics,
  onOpenHomework,
  onOpenCamera,
  onForceReconnect,
  onLogout,
}: MobileMenuProps) {
  const { theme, setTheme } = useTheme();

  const menuItems = [
    { icon: History, label: "Historique", action: onOpenHistory },
    { icon: Brain, label: "Mémoire", action: onOpenMemory },
    { icon: FolderOpen, label: "Fichiers", action: onOpenFiles },
    { icon: Mail, label: "Emails", action: onOpenEmail },
    { icon: MapPin, label: "Géoloc", action: onOpenGeolocation },
    { icon: Stethoscope, label: "Diag", action: onOpenDiagnostics },
    { icon: BookOpen, label: "Homework", action: onOpenHomework },
    { 
      icon: theme === "dark" ? Sun : Moon, 
      label: theme === "dark" ? "Clair" : "Sombre",
      action: () => setTheme(theme === "dark" ? "light" : "dark")
    },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="absolute top-16 left-4 right-4 z-50 glass-panel rounded-2xl p-4 shadow-2xl"
        >
          <div className="grid grid-cols-4 gap-3 mb-4">
            {menuItems.map((item, index) => (
              <button
                key={index}
                onClick={() => { item.action(); onClose(); }}
                className="flex flex-col items-center justify-center gap-1 p-3 rounded-xl glass-button min-h-[70px]"
                data-testid={`button-menu-${item.label.toLowerCase()}`}
              >
                <item.icon className="w-5 h-5" />
                <span className="text-[10px] font-medium">{item.label}</span>
              </button>
            ))}
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={() => { onOpenCamera(); onClose(); }}
              className="flex-1 flex items-center justify-center gap-2 p-3 rounded-xl glass-button text-foreground"
              data-testid="button-camera"
            >
              <Camera className="w-4 h-4" />
              <span className="text-sm">Caméra</span>
            </button>
            <WakeLockToggle className="p-3 rounded-xl glass-button" />
            <button
              onClick={() => { onForceReconnect(); onClose(); }}
              disabled={isReconnecting}
              className="flex-1 flex items-center justify-center gap-2 p-3 rounded-xl glass-button text-foreground disabled:opacity-50"
              data-testid="button-reconnect"
            >
              <RefreshCw className={`w-4 h-4 ${isReconnecting ? "animate-spin" : ""}`} />
              <span className="text-sm">{isReconnecting ? "..." : "Sync"}</span>
            </button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-destructive/10 text-destructive border border-destructive/20"
                  data-testid="button-logout"
                >
                  <X className="w-4 h-4" />
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
        </motion.div>
      )}
    </AnimatePresence>
  );
}
