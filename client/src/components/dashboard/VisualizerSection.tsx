import { memo, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ConversationMood } from "@/lib/mood";

const UlysseAvatar = lazy(() => import("@/components/visualizer/UlysseAvatar").then(m => ({ default: m.UlysseAvatar })));
const IrisAvatar = lazy(() => import("@/components/visualizer/IrisAvatar").then(m => ({ default: m.IrisAvatar })));
const AlfredAvatar = lazy(() => import("@/components/visualizer/AlfredAvatar").then(m => ({ default: m.AlfredAvatar })));
const AudioVisualizer = lazy(() => import("@/components/visualizer/AudioVisualizer").then(m => ({ default: m.AudioVisualizer })));

interface VisualizerSectionProps {
  visualMode: "orb" | "avatar" | "equalizer";
  isActive: boolean;
  isSpeaking: boolean;
  isListening: boolean;
  isSearching?: boolean;
  isAnalyzing?: boolean;
  conversationMood: ConversationMood;
  orbColor: string;
  orbIntensity: number;
  persona?: "Ulysse" | "Iris" | "Max";
}

const VisualizerFallback = () => (
  <div className="w-full h-full flex items-center justify-center">
    <div className="w-32 h-32 md:w-48 md:h-48 rounded-full bg-primary/20 animate-pulse" />
  </div>
);

export const VisualizerSection = memo(function VisualizerSection({
  visualMode,
  isActive,
  isSpeaking,
  isListening,
  isSearching,
  isAnalyzing,
  conversationMood,
  orbColor,
  orbIntensity,
  persona = "Ulysse"
}: VisualizerSectionProps) {
  const AvatarComponent = persona === "Max" ? AlfredAvatar : persona === "Iris" ? IrisAvatar : UlysseAvatar;
  
  return (
    <div className="relative z-10 w-full max-w-[250px] md:max-w-md aspect-square mb-4 md:mb-8">
      <AnimatePresence mode="wait">
        {visualMode === "orb" && (
          <motion.div
            key="orb"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="w-full h-full"
          >
            <Suspense fallback={<VisualizerFallback />}>
              <AvatarComponent
                isActive={isActive}
                isSpeaking={isSpeaking}
                isListening={isListening}
                isSearching={isSearching}
                isAnalyzing={isAnalyzing}
                orbColor={orbColor}
                orbIntensity={orbIntensity}
                className="w-full h-full"
              />
            </Suspense>
          </motion.div>
        )}
        {visualMode === "avatar" && (
          <motion.div
            key="avatar"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="w-full h-full"
          >
            <Suspense fallback={<VisualizerFallback />}>
              <AvatarComponent
                isActive={isActive}
                isSpeaking={isSpeaking}
                isListening={isListening}
                isSearching={isSearching}
                isAnalyzing={isAnalyzing}
                orbColor={orbColor}
                orbIntensity={orbIntensity}
                className="w-full h-full"
              />
            </Suspense>
          </motion.div>
        )}
        {visualMode === "equalizer" && (
          <motion.div
            key="equalizer"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="w-full h-full flex items-center justify-center"
          >
            <Suspense fallback={<VisualizerFallback />}>
              <AudioVisualizer
                isActive={isActive}
                isSpeaking={isSpeaking}
                isListening={isListening}
                mood={conversationMood}
                className="w-full h-24 md:h-48"
              />
            </Suspense>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
