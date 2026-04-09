import { motion } from "framer-motion";
import { Phone, PhoneOff, Mic, MicOff, Volume2, VolumeX, Settings, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { VoiceState, ConversationMode } from "./types";

interface VoiceControlsProps {
  isInCall: boolean;
  voiceState: VoiceState;
  conversationMode: ConversationMode;
  isMuted: boolean;
  isSpeakerMuted: boolean;
  onStartCall: () => void;
  onEndCall: () => void;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
  onInterrupt: () => void;
  onToggleMode: () => void;
  onOpenSettings: () => void;
  disabled?: boolean;
  className?: string;
}

export function VoiceControls({
  isInCall,
  voiceState,
  conversationMode,
  isMuted,
  isSpeakerMuted,
  onStartCall,
  onEndCall,
  onToggleMute,
  onToggleSpeaker,
  onInterrupt,
  onToggleMode,
  onOpenSettings,
  disabled = false,
  className,
}: VoiceControlsProps) {
  const isListening = voiceState === "listening";
  const isSpeaking = voiceState === "speaking";
  const isProcessing = voiceState === "processing";
  
  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={!isInCall || disabled ? undefined : onToggleMute}
          disabled={!isInCall || disabled}
          aria-label={isMuted ? "Activer le microphone" : "Couper le microphone"}
          className={cn(
            "w-14 h-14 rounded-full flex items-center justify-center cursor-pointer transition-all hover-elevate active-elevate-2 border-0",
            !isInCall || disabled ? "opacity-50 cursor-not-allowed" : "",
            isMuted
              ? "bg-red-600/20 text-red-400"
              : isListening
                ? "bg-green-600/20 text-green-400"
                : "bg-gray-800 text-gray-400"
          )}
          data-testid="button-toggle-mute"
        >
          {isMuted ? (
            <MicOff className="w-6 h-6" />
          ) : (
            <motion.div animate={isListening ? { scale: [1, 1.1, 1] } : {}}>
              <Mic className="w-6 h-6" />
            </motion.div>
          )}
        </button>

        <motion.div
          whileTap={{ scale: 0.95 }}
          animate={isInCall && isListening ? { boxShadow: ["0 0 0 0 rgba(34, 197, 94, 0.4)", "0 0 0 20px rgba(34, 197, 94, 0)", "0 0 0 0 rgba(34, 197, 94, 0)"] } : {}}
          transition={{ repeat: Infinity, duration: 2 }}
        >
          <button
            type="button"
            onClick={disabled ? undefined : (isInCall ? onEndCall : onStartCall)}
            disabled={disabled}
            aria-label={isInCall ? "Raccrocher" : "Appeler"}
            className={cn(
              "w-20 h-20 rounded-full flex items-center justify-center text-white shadow-lg cursor-pointer transition-all hover-elevate active-elevate-2 border-0",
              disabled ? "opacity-50 cursor-not-allowed" : "",
              isInCall
                ? "bg-red-600"
                : "bg-green-600"
            )}
            data-testid={isInCall ? "button-end-call" : "button-start-call"}
          >
            {isInCall ? (
              <PhoneOff className="w-8 h-8" />
            ) : (
              <Phone className="w-8 h-8" />
            )}
          </button>
        </motion.div>
        
        <button
          type="button"
          onClick={!isInCall || disabled ? undefined : onToggleSpeaker}
          disabled={!isInCall || disabled}
          aria-label={isSpeakerMuted ? "Activer le haut-parleur" : "Couper le haut-parleur"}
          className={cn(
            "w-14 h-14 rounded-full flex items-center justify-center cursor-pointer transition-all hover-elevate active-elevate-2 border-0",
            !isInCall || disabled ? "opacity-50 cursor-not-allowed" : "",
            isSpeakerMuted
              ? "bg-red-600/20 text-red-400"
              : isSpeaking
                ? "bg-purple-600/20 text-purple-400"
                : "bg-gray-800 text-gray-400"
          )}
          data-testid="button-toggle-speaker"
        >
          {isSpeakerMuted ? (
            <VolumeX className="w-6 h-6" />
          ) : (
            <motion.div animate={isSpeaking ? { scale: [1, 1.1, 1] } : {}}>
              <Volume2 className="w-6 h-6" />
            </motion.div>
          )}
        </button>
      </div>
      
      {isInCall && isSpeaking && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={onInterrupt}
            className="bg-purple-600/20 border-purple-500/50 text-purple-300 hover:bg-purple-600/30"
            data-testid="button-interrupt"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Interrompre
          </Button>
        </div>
      )}
      
      <div className="flex items-center justify-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleMode}
          disabled={!isInCall || isProcessing}
          className={cn(
            conversationMode === "continuous" 
              ? "bg-green-600/20 text-green-400" 
              : "bg-gray-800 text-gray-400"
          )}
          data-testid="button-toggle-mode"
        >
          {conversationMode === "continuous" ? "Mode continu" : "Push-to-talk"}
        </Button>
        
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenSettings}
          aria-label="Paramètres vocaux"
          data-testid="button-voice-settings"
        >
          <Settings className="w-4 h-4" />
        </Button>
      </div>
      
      {isInCall && (
        <div className="flex justify-center">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-800/50 text-xs text-gray-400" role="status" aria-live="polite">
            <motion.span
              className={cn(
                "w-2 h-2 rounded-full",
                isListening ? "bg-green-500" :
                isProcessing ? "bg-yellow-500" :
                isSpeaking ? "bg-purple-500" :
                "bg-gray-500"
              )}
              animate={{ opacity: [1, 0.5, 1] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
            />
            <span>
              {isListening ? "Je t'ecoute..." :
               isProcessing ? "Je reflechis..." :
               isSpeaking ? "Je parle..." :
               "En attente"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

interface QuickActionsProps {
  onRepeat: () => void;
  onClear: () => void;
  disabled?: boolean;
}

export function VoiceQuickActions({ onRepeat, onClear, disabled }: QuickActionsProps) {
  return (
    <div className="flex items-center justify-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={onRepeat}
        disabled={disabled}
        className="text-xs text-gray-400 hover:text-white"
      >
        Repeter
      </Button>
      <span className="text-gray-600">|</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={onClear}
        disabled={disabled}
        className="text-xs text-gray-400 hover:text-white"
      >
        Effacer
      </Button>
    </div>
  );
}
