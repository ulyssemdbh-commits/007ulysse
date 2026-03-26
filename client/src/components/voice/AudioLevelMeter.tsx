import { useEffect, useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Mic, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface AudioLevelMeterProps {
  type: "mic" | "speaker";
  level: number;
  isActive: boolean;
  showWaveform?: boolean;
  className?: string;
}

export function AudioLevelMeter({
  type,
  level,
  isActive,
  showWaveform = false,
  className,
}: AudioLevelMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const waveformDataRef = useRef<number[]>([]);
  const animationFrameRef = useRef<number>();
  
  const normalizedLevel = Math.min(1, Math.max(0, level));
  const dbLevel = level > 0 ? 20 * Math.log10(level) : -60;
  const displayDb = Math.max(-60, Math.min(0, dbLevel));
  
  useEffect(() => {
    if (!showWaveform || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    const width = canvas.width;
    const height = canvas.height;
    
    waveformDataRef.current.push(normalizedLevel);
    if (waveformDataRef.current.length > width) {
      waveformDataRef.current.shift();
    }
    
    ctx.fillStyle = "rgba(17, 24, 39, 0.3)";
    ctx.fillRect(0, 0, width, height);
    
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    if (type === "mic") {
      gradient.addColorStop(0, "#10b981");
      gradient.addColorStop(0.5, "#34d399");
      gradient.addColorStop(1, "#6ee7b7");
    } else {
      gradient.addColorStop(0, "#8b5cf6");
      gradient.addColorStop(0.5, "#a78bfa");
      gradient.addColorStop(1, "#c4b5fd");
    }
    
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    const data = waveformDataRef.current;
    const sliceWidth = width / Math.max(data.length - 1, 1);
    
    for (let i = 0; i < data.length; i++) {
      const x = i * sliceWidth;
      const y = height - (data[i] * height * 0.8) - height * 0.1;
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    
    ctx.stroke();
    
  }, [level, showWaveform, type, normalizedLevel]);
  
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);
  
  const bars = 12;
  const activeColor = type === "mic" ? "bg-green-500" : "bg-purple-500";
  const inactiveColor = "bg-gray-700";
  
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-2">
        <div className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center",
          isActive ? (type === "mic" ? "bg-green-600/20" : "bg-purple-600/20") : "bg-gray-800"
        )}>
          {type === "mic" ? (
            <Mic className={cn("w-4 h-4", isActive ? "text-green-400" : "text-gray-500")} />
          ) : (
            <Volume2 className={cn("w-4 h-4", isActive ? "text-purple-400" : "text-gray-500")} />
          )}
        </div>
        
        <div className="flex-1">
          <div className="flex gap-0.5 h-6 items-end">
            {Array.from({ length: bars }).map((_, i) => {
              const threshold = (i + 1) / bars;
              const isLit = normalizedLevel >= threshold && isActive;
              const height = 4 + (i * 1.5);
              
              return (
                <motion.div
                  key={i}
                  className={cn(
                    "w-2 rounded-sm transition-colors duration-75",
                    isLit ? activeColor : inactiveColor
                  )}
                  style={{ height: `${height}px` }}
                  animate={isLit ? { opacity: [0.7, 1, 0.7] } : { opacity: 0.3 }}
                  transition={{ duration: 0.15 }}
                />
              );
            })}
          </div>
          
          <div className="flex justify-between mt-1">
            <span className="text-xs text-gray-500">
              {type === "mic" ? "Micro" : "Sortie"}
            </span>
            <span className={cn(
              "text-xs font-mono",
              isActive ? "text-gray-300" : "text-gray-600"
            )}>
              {displayDb.toFixed(0)} dB
            </span>
          </div>
        </div>
      </div>
      
      {showWaveform && (
        <canvas
          ref={canvasRef}
          width={200}
          height={40}
          className="w-full h-10 rounded bg-gray-900/50"
        />
      )}
    </div>
  );
}

interface DualAudioMeterProps {
  micLevel: number;
  speakerLevel: number;
  isMicActive: boolean;
  isSpeakerActive: boolean;
  showWaveform?: boolean;
  className?: string;
}

export function DualAudioMeter({
  micLevel,
  speakerLevel,
  isMicActive,
  isSpeakerActive,
  showWaveform = false,
  className,
}: DualAudioMeterProps) {
  return (
    <div className={cn("space-y-3 p-3 bg-gray-900/50 rounded-xl", className)}>
      <AudioLevelMeter
        type="mic"
        level={micLevel}
        isActive={isMicActive}
        showWaveform={showWaveform}
      />
      <AudioLevelMeter
        type="speaker"
        level={speakerLevel}
        isActive={isSpeakerActive}
        showWaveform={showWaveform}
      />
    </div>
  );
}
