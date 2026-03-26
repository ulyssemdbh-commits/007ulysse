import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export type UlysseState = "disconnected" | "quiet" | "listening" | "thinking" | "speaking";

interface AvatarUlysseProps {
  state: UlysseState;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  showLabel?: boolean;
}

const STATE_COLORS: Record<UlysseState, { bg: string; glow: string; label: string }> = {
  disconnected: {
    bg: "bg-red-500",
    glow: "0 0 30px rgba(239, 68, 68, 0.6)",
    label: "Déconnecté",
  },
  quiet: {
    bg: "bg-green-500",
    glow: "0 0 30px rgba(34, 197, 94, 0.5)",
    label: "En ligne",
  },
  listening: {
    bg: "bg-blue-500",
    glow: "0 0 50px rgba(59, 130, 246, 0.7)",
    label: "Écoute...",
  },
  thinking: {
    bg: "bg-orange-500",
    glow: "0 0 50px rgba(249, 115, 22, 0.7)",
    label: "Réflexion...",
  },
  speaking: {
    bg: "bg-white",
    glow: "0 0 60px rgba(255, 255, 255, 0.8)",
    label: "Parle",
  },
};

const SIZE_CLASSES: Record<string, { container: string; inner: string; text: string }> = {
  sm: { container: "w-12 h-12", inner: "w-6 h-6", text: "text-lg" },
  md: { container: "w-20 h-20", inner: "w-10 h-10", text: "text-2xl" },
  lg: { container: "w-32 h-32", inner: "w-16 h-16", text: "text-4xl" },
  xl: { container: "w-44 h-44 sm:w-56 sm:h-56", inner: "w-20 h-20 sm:w-24 sm:h-24", text: "text-5xl sm:text-7xl" },
};

export function AvatarUlysse({ state, size = "md", className, showLabel = false }: AvatarUlysseProps) {
  const colors = STATE_COLORS[state];
  const sizeClasses = SIZE_CLASSES[size];
  
  const isAnimating = state === "listening" || state === "thinking" || state === "speaking";
  
  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <motion.div
        animate={{
          scale: isAnimating ? [1, 1.08, 1] : 1,
          boxShadow: isAnimating 
            ? [colors.glow, colors.glow.replace("0.7", "0.9").replace("0.6", "0.8").replace("0.5", "0.7"), colors.glow]
            : colors.glow,
        }}
        transition={{
          duration: state === "speaking" ? 0.5 : state === "thinking" ? 0.8 : 1,
          repeat: isAnimating ? Infinity : 0,
          ease: "easeInOut",
        }}
        className={cn(
          "rounded-full flex items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900 relative",
          sizeClasses.container
        )}
        data-testid="avatar-ulysse"
        data-state={state}
      >
        <motion.div
          animate={{
            scale: isAnimating ? [1, 1.15, 1] : 1,
          }}
          transition={{
            duration: state === "speaking" ? 0.4 : state === "thinking" ? 0.6 : 0.8,
            repeat: isAnimating ? Infinity : 0,
            ease: "easeInOut",
          }}
          className={cn(
            "rounded-full transition-colors duration-300",
            sizeClasses.inner,
            colors.bg
          )}
        />
        <span className={cn(
          "absolute font-bold text-gray-900",
          sizeClasses.text,
          state === "speaking" ? "text-gray-800" : "text-white"
        )}>
          U
        </span>
      </motion.div>
      
      {showLabel && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-sm text-gray-400"
        >
          {colors.label}
        </motion.p>
      )}
    </div>
  );
}

export function getUlysseState(options: {
  isConnected: boolean;
  isListening: boolean;
  isProcessing: boolean;
  isSpeaking: boolean;
}): UlysseState {
  if (!options.isConnected) return "disconnected";
  if (options.isSpeaking) return "speaking";
  if (options.isProcessing) return "thinking";
  if (options.isListening) return "listening";
  return "quiet";
}
