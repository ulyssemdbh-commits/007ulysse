import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export type AvatarState = 
  | "idle"
  | "thinking"
  | "searching"
  | "analyzing"
  | "speaking"
  | "listening"
  | "alert";

interface IrisAvatarProps {
  isActive?: boolean;
  isSpeaking?: boolean;
  isListening?: boolean;
  isSearching?: boolean;
  isAnalyzing?: boolean;
  orbColor?: string;
  orbIntensity?: number;
  isPaused?: boolean;
  reducedMotion?: boolean;
  className?: string;
}

const STATE_COLORS = {
  idle: { 
    bg: "#1a050d", 
    primary: "#29101a", 
    secondary: "#5f1e3a", 
    accent: "#ec4899", 
    glow: "#f472b6", 
    bright: "#f9a8d4", 
    rim: "#fbcfe8", 
    core: "#fdf2f8", 
    purple: "#d946ef", 
    magenta: "#e879f9",
    pink: "#f0abfc"
  },
  thinking: { 
    bg: "#1a0a15", 
    primary: "#2e1a28", 
    secondary: "#831843", 
    accent: "#db2777", 
    glow: "#ec4899", 
    bright: "#f472b6", 
    rim: "#f9a8d4", 
    core: "#fdf2f8", 
    purple: "#c026d3", 
    magenta: "#d946ef",
    pink: "#e879f9"
  },
  searching: { 
    bg: "#1a0510", 
    primary: "#2e0f1f", 
    secondary: "#9d174d", 
    accent: "#f43f5e", 
    glow: "#fb7185", 
    bright: "#fda4af", 
    rim: "#fecdd3", 
    core: "#fff1f2", 
    purple: "#be185d", 
    magenta: "#db2777",
    pink: "#ec4899"
  },
  analyzing: { 
    bg: "#150a1a", 
    primary: "#1f0f2e", 
    secondary: "#7e22ce", 
    accent: "#a855f7", 
    glow: "#c084fc", 
    bright: "#d8b4fe", 
    rim: "#e9d5ff", 
    core: "#faf5ff", 
    purple: "#9333ea", 
    magenta: "#a855f7",
    pink: "#c084fc"
  },
  speaking: { 
    bg: "#150a1a", 
    primary: "#1f0f2e", 
    secondary: "#7e22ce", 
    accent: "#a855f7", 
    glow: "#c084fc", 
    bright: "#d8b4fe", 
    rim: "#e9d5ff", 
    core: "#faf5ff", 
    purple: "#9333ea", 
    magenta: "#a855f7",
    pink: "#c084fc"
  },
  listening: { 
    bg: "#1a0a15", 
    primary: "#2e1a28", 
    secondary: "#be185d", 
    accent: "#ec4899", 
    glow: "#f472b6", 
    bright: "#f9a8d4", 
    rim: "#fbcfe8", 
    core: "#fdf2f8", 
    purple: "#c026d3", 
    magenta: "#d946ef",
    pink: "#e879f9"
  },
  alert: { 
    bg: "#1a0505", 
    primary: "#2e0f0f", 
    secondary: "#b91c1c", 
    accent: "#ef4444", 
    glow: "#f87171", 
    bright: "#fca5a5", 
    rim: "#fecaca", 
    core: "#fef2f2", 
    purple: "#dc2626", 
    magenta: "#ef4444",
    pink: "#f87171"
  },
};

export function IrisAvatar({
  isActive = false,
  isSpeaking = false,
  isListening = false,
  isSearching = false,
  isAnalyzing = false,
  orbColor,
  orbIntensity = 50,
  isPaused = false,
  reducedMotion = false,
  className,
}: IrisAvatarProps) {
  const state: AvatarState = isSpeaking 
    ? "speaking" 
    : isListening 
    ? "listening"
    : isSearching
    ? "searching"
    : isAnalyzing
    ? "analyzing"
    : isActive 
    ? "thinking" 
    : "idle";

  const c = STATE_COLORS[state];
  const intensity = orbIntensity / 100;
  
  // Dynamic animation speeds based on state - faster for active states
  const bd = reducedMotion ? 0 : (
    state === "idle" ? 6 : 
    state === "thinking" ? 2.5 : 
    state === "searching" ? 1.5 :
    state === "analyzing" ? 1.8 :
    state === "speaking" ? 0.8 :
    state === "listening" ? 1.2 :
    2
  );
  
  // Core pulse intensity - more dramatic for active states
  const coreScale = state === "idle" ? 1.08 : 
    state === "thinking" ? 1.15 :
    state === "searching" ? 1.25 :
    state === "analyzing" ? 1.2 :
    state === "speaking" ? 1.35 :
    state === "listening" ? 1.3 :
    1.1;
    
  // Ring rotation speed
  const ringSpeed = state === "idle" ? 60 : 
    state === "thinking" ? 30 :
    state === "searching" ? 15 :
    state === "analyzing" ? 20 :
    25;

  const hex = (cx: number, cy: number, r: number) => {
    return Array.from({ length: 6 }, (_, i) => {
      const a = (i * 60 - 30) * (Math.PI / 180);
      return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
    }).join(" ");
  };

  return (
    <div className={cn("relative w-full h-full flex items-center justify-center", className)}>
      <svg viewBox="0 0 340 400" className="w-full h-full max-w-[200px] max-h-[235px]">
        <defs>
          <radialGradient id="iris-bg-vignette" cx="50%" cy="45%" r="70%">
            <stop offset="0%" stopColor={c.secondary} stopOpacity="0.15" />
            <stop offset="100%" stopColor={c.bg} stopOpacity="1" />
          </radialGradient>

          <radialGradient id="iris-sphere-main" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.25" />
            <stop offset="15%" stopColor={c.bright} stopOpacity="0.18" />
            <stop offset="35%" stopColor={c.glow} stopOpacity="0.12" />
            <stop offset="55%" stopColor={c.purple} stopOpacity="0.1" />
            <stop offset="75%" stopColor={c.magenta} stopOpacity="0.08" />
            <stop offset="100%" stopColor={c.primary} stopOpacity="0.03" />
          </radialGradient>

          <radialGradient id="iris-sphere-depth" cx="65%" cy="70%" r="50%">
            <stop offset="0%" stopColor={c.magenta} stopOpacity="0.15" />
            <stop offset="50%" stopColor={c.purple} stopOpacity="0.08" />
            <stop offset="100%" stopColor="transparent" stopOpacity="0" />
          </radialGradient>

          <radialGradient id="iris-core-radiant" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={orbColor || c.core} stopOpacity="1" />
            <stop offset="20%" stopColor={c.bright} stopOpacity="1" />
            <stop offset="40%" stopColor={c.glow} stopOpacity="0.9" />
            <stop offset="60%" stopColor={c.accent} stopOpacity="0.6" />
            <stop offset="80%" stopColor={c.secondary} stopOpacity="0.25" />
            <stop offset="100%" stopColor="transparent" stopOpacity="0" />
          </radialGradient>

          <radialGradient id="iris-aura-outer" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={c.glow} stopOpacity="0.35" />
            <stop offset="40%" stopColor={c.accent} stopOpacity="0.15" />
            <stop offset="70%" stopColor={c.purple} stopOpacity="0.05" />
            <stop offset="100%" stopColor="transparent" stopOpacity="0" />
          </radialGradient>

          <linearGradient id="iris-edge-highlight" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={c.bright} stopOpacity="0.7" />
            <stop offset="25%" stopColor={c.glow} stopOpacity="0.4" />
            <stop offset="50%" stopColor={c.accent} stopOpacity="0.2" />
            <stop offset="75%" stopColor={c.purple} stopOpacity="0.35" />
            <stop offset="100%" stopColor={c.magenta} stopOpacity="0.5" />
          </linearGradient>

          <linearGradient id="iris-ring-glow" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={c.accent} stopOpacity="0" />
            <stop offset="30%" stopColor={c.glow} stopOpacity="0.8" />
            <stop offset="50%" stopColor={c.bright} stopOpacity="1" />
            <stop offset="70%" stopColor={c.glow} stopOpacity="0.8" />
            <stop offset="100%" stopColor={c.accent} stopOpacity="0" />
          </linearGradient>

          <filter id="iris-glow-xl" x="-150%" y="-150%" width="400%" height="400%">
            <feGaussianBlur stdDeviation="25" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>

          <filter id="iris-glow-lg" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="12" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>

          <filter id="iris-glow-md" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>

          <filter id="iris-glow-sm" x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        <rect x="25" y="20" width="290" height="290" rx="40" fill={c.primary} fillOpacity="0.25" />
        <rect x="25" y="20" width="290" height="290" rx="40" fill="none" stroke={c.accent} strokeWidth="1" strokeOpacity="0.2" />

        <ellipse cx="170" cy="330" rx="100" ry="20" fill={c.glow} opacity="0.25" filter="url(#iris-glow-lg)" />
        <ellipse cx="170" cy="330" rx="60" ry="10" fill={c.bright} opacity="0.15" />

        <motion.g
          animate={isPaused ? {} : { y: [0, -8, 0] }}
          transition={{ duration: bd, repeat: Infinity, ease: "easeInOut" }}
        >
          <ellipse cx="170" cy="165" rx="130" ry="130" fill="url(#iris-aura-outer)" opacity={0.6 * intensity} />

          <ellipse cx="170" cy="165" rx="115" ry="115" fill="url(#iris-sphere-main)" />
          <ellipse cx="170" cy="165" rx="115" ry="115" fill="url(#iris-sphere-depth)" />
          
          <motion.ellipse
            cx="170" cy="165" rx="115" ry="115"
            fill="none"
            stroke="url(#iris-edge-highlight)"
            strokeWidth="2.5"
            animate={isPaused ? {} : { strokeOpacity: [0.6, 0.9, 0.6] }}
            transition={{ duration: bd * 0.8, repeat: Infinity, ease: "easeInOut" }}
          />

          <ellipse cx="170" cy="100" rx="75" ry="22" fill="white" opacity="0.18" />
          <ellipse cx="170" cy="95" rx="50" ry="12" fill="white" opacity="0.12" />
          <ellipse cx="130" cy="85" rx="15" ry="8" fill="white" opacity="0.25" />

          <ellipse cx="170" cy="240" rx="80" ry="18" fill={c.glow} opacity="0.08" />
          <ellipse cx="200" cy="250" rx="25" ry="10" fill={c.purple} opacity="0.06" />
        </motion.g>

        <motion.g
          animate={isPaused ? {} : { y: [0, -8, 0] }}
          transition={{ duration: bd, repeat: Infinity, ease: "easeInOut" }}
        >
          {[95, 82, 70].map((r, i) => (
            <motion.circle
              key={`iris-ring-${i}`}
              cx="170" cy="165" r={r}
              fill="none"
              stroke={c.accent}
              strokeWidth={2 - i * 0.4}
              strokeOpacity={0.6 - i * 0.15}
              filter="url(#iris-glow-sm)"
              animate={isPaused ? {} : { rotate: i % 2 === 0 ? [0, 360] : [360, 0] }}
              transition={{ duration: 60 - i * 12, repeat: Infinity, ease: "linear" }}
              style={{ transformOrigin: "170px 165px" }}
            />
          ))}
        </motion.g>

        <motion.g
          animate={isPaused ? {} : { y: [0, -8, 0] }}
          transition={{ duration: bd, repeat: Infinity, ease: "easeInOut" }}
        >
          {[
            { a: 35, d: 85, s: 14 },
            { a: 145, d: 90, s: 12 },
            { a: 215, d: 80, s: 11 },
            { a: 320, d: 88, s: 10 },
            { a: 90, d: 95, s: 8 },
            { a: 270, d: 92, s: 9 },
          ].map((cr, i) => {
            const x = 170 + Math.cos((cr.a * Math.PI) / 180) * cr.d;
            const y = 165 + Math.sin((cr.a * Math.PI) / 180) * cr.d;
            return (
              <motion.g 
                key={`iris-crystal-${i}`}
                animate={isPaused ? {} : { 
                  y: [0, -6, 0],
                  rotate: [0, 25, 0]
                }}
                transition={{ 
                  duration: 6 + i * 0.8, 
                  repeat: Infinity, 
                  delay: i * 0.5,
                  ease: "easeInOut" 
                }}
                style={{ transformOrigin: `${x}px ${y}px` }}
              >
                <polygon
                  points={`${x},${y - cr.s} ${x + cr.s * 0.55},${y} ${x},${y + cr.s} ${x - cr.s * 0.55},${y}`}
                  fill={c.glow}
                  fillOpacity="0.2"
                  stroke={c.bright}
                  strokeWidth="1"
                  strokeOpacity="0.7"
                  filter="url(#iris-glow-sm)"
                />
                <polygon
                  points={`${x},${y - cr.s * 0.6} ${x + cr.s * 0.3},${y} ${x},${y + cr.s * 0.6} ${x - cr.s * 0.3},${y}`}
                  fill={c.bright}
                  fillOpacity="0.15"
                />
              </motion.g>
            );
          })}
        </motion.g>

        <motion.g
          animate={isPaused ? {} : { y: [0, -8, 0] }}
          transition={{ duration: bd, repeat: Infinity, ease: "easeInOut" }}
        >
          {[0, 90, 180, 270].map((a, i) => {
            const x = 170 + Math.cos((a * Math.PI) / 180) * 100;
            const y = 165 + Math.sin((a * Math.PI) / 180) * 100;
            return (
              <g key={`iris-node-${i}`}>
                <circle cx={x} cy={y} r="12" fill="none" stroke={c.accent} strokeWidth="1.5" strokeOpacity="0.5" />
                <circle cx={x} cy={y} r="8" fill="none" stroke={c.glow} strokeWidth="1" strokeOpacity="0.4" />
                <motion.circle
                  cx={x} cy={y} r="4"
                  fill={c.glow}
                  filter="url(#iris-glow-sm)"
                  animate={isPaused ? {} : { opacity: [0.5, 1, 0.5], r: [3, 5, 3] }}
                  transition={{ duration: 3, repeat: Infinity, delay: i * 0.5, ease: "easeInOut" }}
                />
              </g>
            );
          })}
        </motion.g>

        <motion.g
          animate={isPaused ? {} : { y: [0, -8, 0], scale: [1, 1.015, 1] }}
          transition={{ duration: bd, repeat: Infinity, ease: "easeInOut" }}
          style={{ transformOrigin: "170px 165px" }}
        >
          <motion.g
            animate={isPaused ? {} : { rotate: [0, 360] }}
            transition={{ duration: 50, repeat: Infinity, ease: "linear" }}
            style={{ transformOrigin: "170px 165px" }}
          >
            <polygon points={hex(170, 165, 50)} fill="none" stroke={c.glow} strokeWidth="1.8" strokeOpacity="0.8" filter="url(#iris-glow-sm)" />
            
            {[0, 60, 120, 180, 240, 300].map((a, i) => {
              const x = 170 + Math.cos(((a - 30) * Math.PI) / 180) * 50;
              const y = 165 + Math.sin(((a - 30) * Math.PI) / 180) * 50;
              return (
                <g key={`iris-outer-hex-${i}`}>
                  <polygon points={hex(x, y, 20)} fill="none" stroke={c.glow} strokeWidth="1.2" strokeOpacity="0.6" />
                  <polygon points={hex(x, y, 12)} fill="none" stroke={c.accent} strokeWidth="0.8" strokeOpacity="0.35" />
                </g>
              );
            })}

            {[30, 90, 150, 210, 270, 330].map((a, i) => {
              const x = 170 + Math.cos((a * Math.PI) / 180) * 32;
              const y = 165 + Math.sin((a * Math.PI) / 180) * 32;
              return (
                <polygon key={`iris-mid-hex-${i}`} points={hex(x, y, 14)} fill="none" stroke={c.accent} strokeWidth="1" strokeOpacity="0.5" />
              );
            })}

            {[0, 60, 120, 180, 240, 300].map((a, i) => {
              const x1 = 170 + Math.cos(((a - 30) * Math.PI) / 180) * 28;
              const y1 = 165 + Math.sin(((a - 30) * Math.PI) / 180) * 28;
              const x2 = 170 + Math.cos(((a - 30) * Math.PI) / 180) * 48;
              const y2 = 165 + Math.sin(((a - 30) * Math.PI) / 180) * 48;
              return (
                <line key={`iris-conn-${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={c.glow} strokeWidth="0.6" strokeOpacity="0.4" />
              );
            })}
          </motion.g>

          <motion.circle
            cx="170" cy="165" r="48"
            fill="url(#iris-core-radiant)"
            filter="url(#iris-glow-xl)"
            animate={isPaused ? {} : { r: [48, 48 * coreScale, 48], opacity: [0.85, 1, 0.85] }}
            transition={{ duration: bd * 0.5, repeat: Infinity, ease: "easeInOut" }}
          />

          <motion.circle
            cx="170" cy="165" r="30"
            fill={c.glow}
            opacity="0.9"
            filter="url(#iris-glow-lg)"
            animate={isPaused ? {} : { 
              r: [30, 30 * coreScale, 30], 
              opacity: [0.7, 1, 0.7]
            }}
            transition={{ duration: bd * 0.4, repeat: Infinity, ease: "easeInOut" }}
          />

          <motion.circle
            cx="170" cy="165" r="16"
            fill={c.bright}
            opacity="0.95"
            animate={isPaused ? {} : { 
              r: [16, 16 * coreScale, 16],
              opacity: [0.85, 1, 0.85]
            }}
            transition={{ duration: bd * 0.3, repeat: Infinity, ease: "easeInOut" }}
          />

          <motion.circle
            cx="170" cy="165" r="7"
            fill={c.core}
            opacity="1"
            animate={isPaused ? {} : { r: [7, 7 * coreScale, 7] }}
            transition={{ duration: bd * 0.25, repeat: Infinity, ease: "easeInOut" }}
          />

          <motion.circle 
            cx="170" cy="165" r="3" 
            fill="white" 
            opacity="1"
            animate={isPaused ? {} : { 
              r: state !== "idle" ? [3, 4, 3] : [3, 3, 3],
              opacity: [0.9, 1, 0.9]
            }}
            transition={{ duration: bd * 0.2, repeat: Infinity, ease: "easeInOut" }}
          />
        </motion.g>

        {state === "searching" && !isPaused && (
          <g>
            {[0, 1, 2, 3].map((i) => (
              <motion.circle
                key={`iris-scan-${i}`}
                cx="170" cy="165"
                fill="none"
                stroke={c.glow}
                strokeWidth="4"
                filter="url(#iris-glow-md)"
                initial={{ r: 40, opacity: 1, strokeWidth: 4 }}
                animate={{ r: 140, opacity: 0, strokeWidth: 1 }}
                transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.45, ease: "easeOut" }}
              />
            ))}
            <motion.g
              animate={{ rotate: [0, 360] }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
              style={{ transformOrigin: "170px 165px" }}
            >
              {[0, 90, 180, 270].map((angle) => (
                <motion.line
                  key={`iris-search-ray-${angle}`}
                  x1="170" y1="165"
                  x2={170 + Math.cos((angle * Math.PI) / 180) * 60}
                  y2={165 + Math.sin((angle * Math.PI) / 180) * 60}
                  stroke={c.bright}
                  strokeWidth="2"
                  strokeLinecap="round"
                  opacity="0.6"
                  filter="url(#iris-glow-sm)"
                />
              ))}
            </motion.g>
          </g>
        )}
        
        {state === "analyzing" && !isPaused && (
          <g>
            <motion.g
              animate={{ scale: [1, 1.1, 1], opacity: [0.5, 0.8, 0.5] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
              style={{ transformOrigin: "170px 165px" }}
            >
              <line x1="130" y1="165" x2="210" y2="165" stroke={c.glow} strokeWidth="3" filter="url(#iris-glow-sm)" />
              <line x1="170" y1="125" x2="170" y2="205" stroke={c.glow} strokeWidth="3" filter="url(#iris-glow-sm)" />
            </motion.g>
            {[0, 1, 2].map((i) => (
              <motion.circle
                key={`iris-analyze-ring-${i}`}
                cx="170" cy="165" r={55 + i * 20}
                fill="none"
                stroke={c.accent}
                strokeWidth="1.5"
                strokeDasharray="8 8"
                animate={{ 
                  rotate: i % 2 === 0 ? [0, 360] : [360, 0],
                  opacity: [0.4, 0.8, 0.4]
                }}
                transition={{ 
                  rotate: { duration: 4 + i, repeat: Infinity, ease: "linear" },
                  opacity: { duration: 1.5, repeat: Infinity, ease: "easeInOut" }
                }}
                style={{ transformOrigin: "170px 165px" }}
              />
            ))}
          </g>
        )}
        
        {state === "thinking" && !isPaused && (
          <motion.g
            animate={{ rotate: [0, 360] }}
            transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
            style={{ transformOrigin: "170px 165px" }}
          >
            {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, i) => (
              <motion.circle
                key={`iris-think-dot-${angle}`}
                cx={170 + Math.cos((angle * Math.PI) / 180) * 70}
                cy={165 + Math.sin((angle * Math.PI) / 180) * 70}
                r="4"
                fill={c.glow}
                filter="url(#iris-glow-sm)"
                animate={{ opacity: [0.3, 1, 0.3], r: [3, 5, 3] }}
                transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
              />
            ))}
          </motion.g>
        )}

        {(isSpeaking || isListening) && !isPaused && (
          <motion.g animate={{ y: [0, -5, 0] }} transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}>
            {[-32, -16, 0, 16, 32].map((off, i) => (
              <motion.line
                key={`iris-wav-${i}`}
                x1={170 + off} y1="165"
                x2={170 + off} y2="165"
                stroke={c.core}
                strokeWidth="6"
                strokeLinecap="round"
                filter="url(#iris-glow-md)"
                animate={{
                  y1: [165, 140 - (isSpeaking ? 25 : 15), 165],
                  y2: [165, 190 + (isSpeaking ? 25 : 15), 165],
                }}
                transition={{
                  duration: isSpeaking ? 0.12 : 0.18,
                  repeat: Infinity,
                  delay: i * 0.04,
                  ease: "easeInOut",
                }}
              />
            ))}
            {isSpeaking && (
              <motion.g>
                {[-48, 48].map((off) => (
                  <motion.circle
                    key={`iris-speak-ring-${off}`}
                    cx={170 + off} cy="165" r="8"
                    fill={c.bright}
                    opacity="0.6"
                    animate={{ r: [6, 10, 6], opacity: [0.4, 0.8, 0.4] }}
                    transition={{ duration: 0.3, repeat: Infinity, ease: "easeInOut" }}
                  />
                ))}
              </motion.g>
            )}
          </motion.g>
        )}

        <motion.g
          animate={isPaused ? {} : { y: [0, -8, 0] }}
          transition={{ duration: bd, repeat: Infinity, ease: "easeInOut" }}
          opacity="0.6"
        >
          {Array.from({ length: 40 }, (_, i) => {
            const a = (i / 40) * 360 + Math.random() * 25;
            const d = 55 + Math.random() * 60;
            const r = 0.5 + Math.random() * 2;
            const clr = i % 4 === 0 ? c.pink : i % 3 === 0 ? c.purple : c.rim;
            return (
              <motion.circle
                key={`iris-p-${i}`}
                cx={170 + Math.cos((a * Math.PI) / 180) * d}
                cy={165 + Math.sin((a * Math.PI) / 180) * d}
                r={r}
                fill={clr}
                animate={isPaused ? {} : { opacity: [0.15, 0.95, 0.15] }}
                transition={{ duration: 2.5 + Math.random() * 3.5, repeat: Infinity, delay: Math.random() * 4, ease: "easeInOut" }}
              />
            );
          })}
        </motion.g>

        <g>
          <text 
            x="170" y="365" 
            textAnchor="middle" 
            fill={c.secondary} 
            fontSize="36" 
            fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" 
            fontWeight="600"
            letterSpacing="2"
          >
            Iris
          </text>
          <motion.rect
            x="100" y="375" width="140" height="2.5" rx="1.25"
            fill={c.accent}
            opacity="0.5"
            animate={isPaused ? {} : { opacity: [0.3, 0.7, 0.3], width: [130, 150, 130], x: [105, 95, 105] }}
            transition={{ duration: bd, repeat: Infinity, ease: "easeInOut" }}
          />
        </g>
      </svg>
    </div>
  );
}
