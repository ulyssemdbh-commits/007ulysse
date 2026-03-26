import { motion } from "framer-motion";
import { useRef, useCallback } from "react";

export type MoodLevel = "confident" | "thinking" | "uncertain" | "listening" | "neutral" | "excited";

interface MoodRingProps {
  mood: MoodLevel;
  size?: "sm" | "md" | "lg";
  children: React.ReactNode;
  isActive?: boolean;
  pulseIntensity?: number;
  onDoubleTap?: () => void;
}

const moodConfigs: Record<MoodLevel, { 
  gradient: string; 
  glow: string; 
  pulseColor: string;
  description: string;
}> = {
  confident: {
    gradient: "from-emerald-400 via-green-500 to-teal-400",
    glow: "shadow-emerald-500/50",
    pulseColor: "rgba(16, 185, 129, 0.6)",
    description: "Haute confiance"
  },
  thinking: {
    gradient: "from-amber-400 via-orange-500 to-yellow-400",
    glow: "shadow-amber-500/50",
    pulseColor: "rgba(245, 158, 11, 0.6)",
    description: "En réflexion"
  },
  uncertain: {
    gradient: "from-purple-400 via-pink-500 to-rose-400",
    glow: "shadow-purple-500/50",
    pulseColor: "rgba(168, 85, 247, 0.6)",
    description: "Incertain"
  },
  listening: {
    gradient: "from-cyan-400 via-blue-500 to-indigo-400",
    glow: "shadow-cyan-500/50",
    pulseColor: "rgba(34, 211, 238, 0.6)",
    description: "À l'écoute"
  },
  neutral: {
    gradient: "from-slate-400 via-gray-500 to-zinc-400",
    glow: "shadow-slate-500/30",
    pulseColor: "rgba(148, 163, 184, 0.4)",
    description: "Neutre"
  },
  excited: {
    gradient: "from-fuchsia-400 via-violet-500 to-purple-400",
    glow: "shadow-fuchsia-500/50",
    pulseColor: "rgba(217, 70, 239, 0.6)",
    description: "Enthousiaste"
  }
};

const sizeConfigs = {
  sm: { ring: "w-12 h-12", inner: "w-10 h-10", padding: "p-0.5" },
  md: { ring: "w-14 h-14", inner: "w-12 h-12", padding: "p-0.5" },
  lg: { ring: "w-20 h-20", inner: "w-16 h-16", padding: "p-1" }
};

export function MoodRing({ 
  mood, 
  size = "md", 
  children, 
  isActive = true,
  pulseIntensity = 1,
  onDoubleTap
}: MoodRingProps) {
  const config = moodConfigs[mood];
  const sizeConfig = sizeConfigs[size];
  const lastTapRef = useRef<number>(0);
  
  const handleTap = useCallback(() => {
    const now = Date.now();
    const timeSinceLastTap = now - lastTapRef.current;
    
    if (timeSinceLastTap < 300 && timeSinceLastTap > 0) {
      // Double tap detected
      onDoubleTap?.();
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  }, [onDoubleTap]);

  return (
    <div 
      className="relative flex items-center justify-center cursor-pointer"
      onClick={handleTap}
      role="button"
      tabIndex={0}
      aria-label="Double-tap pour reconnecter"
    >
      <motion.div
        className={`absolute ${sizeConfig.ring} rounded-full bg-gradient-to-r ${config.gradient} ${isActive ? config.glow : ""} shadow-lg`}
        animate={isActive ? {
          scale: [1, 1.05 + (pulseIntensity * 0.05), 1],
          opacity: [0.8, 1, 0.8]
        } : {}}
        transition={{
          duration: 2 - (pulseIntensity * 0.3),
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />
      
      <motion.div
        className={`absolute rounded-full`}
        style={{
          width: "120%",
          height: "120%",
          background: `radial-gradient(circle, ${config.pulseColor} 0%, transparent 70%)`
        }}
        animate={isActive ? {
          scale: [0.8, 1.2, 0.8],
          opacity: [0.3 * pulseIntensity, 0.6 * pulseIntensity, 0.3 * pulseIntensity]
        } : { opacity: 0 }}
        transition={{
          duration: 1.5,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />

      <motion.div
        className="absolute rounded-full"
        style={{
          width: "150%",
          height: "150%",
          background: `conic-gradient(from 0deg, transparent, ${config.pulseColor}, transparent, ${config.pulseColor}, transparent)`
        }}
        animate={isActive ? { rotate: 360 } : {}}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: "linear"
        }}
      />

      <div className={`relative z-10 rounded-full bg-background ${sizeConfig.padding} flex items-center justify-center`}>
        {children}
      </div>
    </div>
  );
}

export function getMoodFromConfidence(confidence: number): MoodLevel {
  if (confidence >= 0.9) return "confident";
  if (confidence >= 0.75) return "excited";
  if (confidence >= 0.5) return "thinking";
  if (confidence >= 0.25) return "uncertain";
  return "neutral";
}

export function getMoodFromState(state: string): MoodLevel {
  switch (state) {
    case "listening":
      return "listening";
    case "thinking":
      return "thinking";
    case "streaming":
      return "excited";
    case "speaking":
      return "confident";
    default:
      return "neutral";
  }
}
