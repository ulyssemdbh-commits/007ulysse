import { useState, useRef, useCallback } from "react";
import { Volume2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface DashboardiOSSliderProps {
  isIOS: boolean;
  ttsSupported: boolean;
  ttsUnlocked: boolean;
  unlockTTS: () => Promise<void> | void;
}

const TRACK_WIDTH = 300;
const SLIDE_THRESHOLD = 0.65;

export function DashboardiOSSlider({ isIOS, ttsSupported, ttsUnlocked, unlockTTS }: DashboardiOSSliderProps) {
  const [slideProgress, setSlideProgress] = useState(0);
  const [isSliding, setIsSliding] = useState(false);
  const slideStartXRef = useRef<number>(0);
  const slideUnlockedRef = useRef(false);

  const handleSlideTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    slideStartXRef.current = touch.clientX;
    setIsSliding(true);
    setSlideProgress(0);
  }, []);

  const handleSlideTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isSliding) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - slideStartXRef.current;
    const progress = Math.max(0, Math.min(1, deltaX / (TRACK_WIDTH - 60)));
    setSlideProgress(progress);

    if (progress >= SLIDE_THRESHOLD && !slideUnlockedRef.current) {
      slideUnlockedRef.current = true;
      console.log("[TTS] Slide threshold reached, unlocking immediately...");
      unlockTTS();
      setIsSliding(false);
      setSlideProgress(0);
    }
  }, [isSliding, unlockTTS]);

  const handleSlideTouchEnd = useCallback(() => {
    if (!slideUnlockedRef.current && slideProgress >= SLIDE_THRESHOLD) {
      console.log("[TTS] Slide complete on release, unlocking...");
      unlockTTS();
    }
    slideUnlockedRef.current = false;
    setIsSliding(false);
    setSlideProgress(0);
  }, [slideProgress, unlockTTS]);

  return (
    <AnimatePresence>
      {isIOS && ttsSupported && !ttsUnlocked && (
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 50 }}
          className="fixed inset-x-0 bottom-1/2 translate-y-1/2 z-[100] flex justify-center items-center pointer-events-none"
          style={{ touchAction: 'none' }}
        >
          <div
            className="relative rounded-full bg-gradient-to-r from-emerald-600/90 to-teal-700/90 backdrop-blur-sm shadow-2xl overflow-hidden pointer-events-auto border-2 border-white/20"
            style={{ 
              width: `${TRACK_WIDTH}px`, 
              height: '64px',
              WebkitTapHighlightColor: 'transparent'
            }}
            onTouchStart={handleSlideTouchStart}
            onTouchMove={handleSlideTouchMove}
            onTouchEnd={handleSlideTouchEnd}
            data-testid="slider-unlock-tts"
          >
            <motion.div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-400 to-teal-400"
              style={{ width: `${slideProgress * 100}%` }}
              animate={{ width: `${slideProgress * 100}%` }}
              transition={{ duration: 0 }}
            />
            
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <motion.span 
                className="text-white text-base font-semibold select-none tracking-wide"
                animate={{ opacity: isSliding ? 0.4 : 1 }}
              >
                {slideProgress >= SLIDE_THRESHOLD ? "Relâchez !" : "Glisser →"}
              </motion.span>
            </div>
            
            <motion.div
              className="absolute top-1.5 bottom-1.5 left-1.5 w-14 rounded-full bg-white shadow-lg flex items-center justify-center"
              style={{ 
                x: slideProgress * (TRACK_WIDTH - 64),
              }}
              animate={{
                scale: isSliding ? 1.08 : 1,
                backgroundColor: slideProgress >= SLIDE_THRESHOLD ? "#22c55e" : "#ffffff"
              }}
            >
              <Volume2 className={cn(
                "w-6 h-6 transition-colors",
                slideProgress >= SLIDE_THRESHOLD ? "text-white" : "text-emerald-600"
              )} />
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
