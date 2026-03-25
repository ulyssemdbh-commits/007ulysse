import { useEffect, useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { ConversationMood, moodColorMap } from "@/lib/mood";

interface AudioVisualizerProps {
  isActive?: boolean;
  isSpeaking?: boolean;
  isListening?: boolean;
  mood?: ConversationMood;
  className?: string;
  isPaused?: boolean;
  reducedMotion?: boolean;
}

export function AudioVisualizer({ 
  isActive = false, 
  isSpeaking = false,
  isListening = false,
  mood = "neutral",
  className,
  isPaused = false,
  reducedMotion = false
}: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const [bars, setBars] = useState<number[]>(Array(32).fill(0.1));
  const moodColors = moodColorMap[mood];

  const generateBars = useCallback(() => {
    if (isSpeaking) {
      // Active animation only when speaking
      return Array(32).fill(0).map(() => 0.3 + Math.random() * 0.7);
    } else {
      // Static minimal bars when not speaking
      return Array(32).fill(0).map((_, i) => {
        const center = 16;
        const dist = Math.abs(i - center) / center;
        return 0.08 + (1 - dist) * 0.12;
      });
    }
  }, [isSpeaking]);

  useEffect(() => {
    if (isPaused || reducedMotion) {
      setBars(generateBars());
      return;
    }
    
    let lastUpdate = 0;
    const updateInterval = isSpeaking ? 50 : 500;

    const animate = (timestamp: number) => {
      if (timestamp - lastUpdate > updateInterval) {
        setBars(generateBars());
        lastUpdate = timestamp;
      }
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [generateBars, isSpeaking, isListening, isPaused, reducedMotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const barCount = bars.length;
    const barWidth = width / barCount * 0.6;
    const gap = width / barCount * 0.4;

    ctx.clearRect(0, 0, width, height);

    bars.forEach((value, i) => {
      const x = i * (barWidth + gap) + gap / 2;
      const barHeight = value * height * 0.8;
      const y = (height - barHeight) / 2;

      const gradient = ctx.createLinearGradient(x, y, x, y + barHeight);
      
      if (isSpeaking) {
        gradient.addColorStop(0, "rgba(16, 185, 129, 0.9)");
        gradient.addColorStop(0.5, "rgba(20, 184, 166, 0.8)");
        gradient.addColorStop(1, "rgba(6, 182, 212, 0.7)");
      } else if (isListening) {
        gradient.addColorStop(0, "rgba(139, 92, 246, 0.9)");
        gradient.addColorStop(0.5, "rgba(168, 85, 247, 0.8)");
        gradient.addColorStop(1, "rgba(192, 132, 252, 0.7)");
      } else {
        gradient.addColorStop(0, hexToRgba(moodColors.primary, 0.9));
        gradient.addColorStop(0.5, hexToRgba(moodColors.secondary, 0.7));
        gradient.addColorStop(1, hexToRgba(moodColors.accent, 0.5));
      }

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2);
      ctx.fill();
    });
  }, [bars, isSpeaking, isListening, moodColors]);

  return (
    <div className={cn("relative", className)}>
      <motion.div
        className="absolute inset-0 rounded-full"
        animate={{
          boxShadow: isSpeaking 
            ? "0 0 60px rgba(16, 185, 129, 0.4), 0 0 120px rgba(20, 184, 166, 0.2)"
            : `0 0 20px ${moodColors.glow}`
        }}
        transition={{ duration: 0.5 }}
      />
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return `rgba(100, 116, 139, ${alpha})`;
  const r = parseInt(result[1], 16);
  const g = parseInt(result[2], 16);
  const b = parseInt(result[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
