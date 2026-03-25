import { memo } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { History, Brain, Activity, LogOut, Plus, Zap, ZapOff } from "lucide-react";
interface HeaderBarProps {
  personaName: string;
  isActive: boolean;
  showHistory: boolean;
  useRealtimeMode: boolean;
  onToggleHistory: () => void;
  onNewConversation: () => void;
  onShowMemory: () => void;
  onShowDiagnostics: () => void;
  onToggleRealtimeMode: () => void;
  onLogout: () => void;
}

export const HeaderBar = memo(function HeaderBar({
  personaName,
  isActive,
  showHistory,
  useRealtimeMode,
  onToggleHistory,
  onNewConversation,
  onShowMemory,
  onShowDiagnostics,
  onToggleRealtimeMode,
  onLogout,
}: HeaderBarProps) {
  return (
    <motion.div 
      className="absolute top-0 left-0 right-0 z-30 safe-area-top"
      initial={{ y: -50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.2 }}
    >
      <div className="flex items-center justify-between gap-2 p-3 md:p-4 bg-background/80 backdrop-blur-xl border-b border-border/50">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleHistory}
            className={showHistory ? "bg-primary/20" : ""}
            data-testid="button-toggle-history"
          >
            <History className="w-5 h-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onNewConversation}
            data-testid="button-new-conversation"
          >
            <Plus className="w-5 h-5" />
          </Button>
        </div>
        
        <motion.h1 
          className="text-lg md:text-xl font-semibold text-foreground"
          animate={{ 
            opacity: isActive ? 1 : 0.7,
            scale: isActive ? 1.02 : 1
          }}
        >
          {personaName}
        </motion.h1>
        
        <div className="flex items-center gap-1 md:gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onShowMemory}
            data-testid="button-show-memory"
          >
            <Brain className="w-5 h-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onShowDiagnostics}
            data-testid="button-show-diagnostics"
          >
            <Activity className="w-5 h-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleRealtimeMode}
            title={useRealtimeMode ? "Mode standard" : "Mode temps réel"}
            data-testid="button-toggle-realtime"
          >
            {useRealtimeMode ? <Zap className="w-5 h-5 text-yellow-500" /> : <ZapOff className="w-5 h-5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onLogout}
            data-testid="button-logout"
          >
            <LogOut className="w-5 h-5" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
});
