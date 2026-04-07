import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { UlysseAvatar } from "@/components/visualizer/UlysseAvatar";
import { IrisAvatar } from "@/components/visualizer/IrisAvatar";
import { AlfredAvatar } from "@/components/visualizer/AlfredAvatar";
import { AudioVisualizer } from "@/components/visualizer/AudioVisualizer";
import { DisplayWindow } from "@/components/DisplayWindow";
import type { ConversationMood } from "@/lib/mood";

interface AvatarProps {
  isActive: boolean;
  isSpeaking: boolean;
  isListening: boolean;
  isSearching: boolean;
  isAnalyzing: boolean;
  orbColor: string;
  orbIntensity: number;
  isPaused: boolean;
  reducedMotion: boolean;
}

interface DashboardLeftColumnProps extends AvatarProps {
  personaName: "Ulysse" | "Iris" | "Max";
  visualMode: string;
  conversationMood: ConversationMood;
  displayWindow: {
    content: unknown;
    isOpen: boolean;
    close: () => void;
  };
  isOwner: boolean;
}

function PersonaAvatar({ personaName, className, ...props }: AvatarProps & { personaName: string; className?: string }) {
  if (personaName === "Max") {
    return <AlfredAvatar {...props} className={className} />;
  }
  if (personaName === "Ulysse") {
    return <UlysseAvatar {...props} className={className} />;
  }
  return <IrisAvatar {...props} className={className} />;
}

export function DashboardLeftColumn({
  personaName, visualMode, conversationMood,
  displayWindow, isOwner,
  isActive, isSpeaking, isListening, isSearching, isAnalyzing,
  orbColor, orbIntensity, isPaused, reducedMotion,
}: DashboardLeftColumnProps) {
  const avatarProps: AvatarProps = {
    isActive, isSpeaking, isListening, isSearching, isAnalyzing,
    orbColor, orbIntensity, isPaused, reducedMotion,
  };

  return (
    <div className={cn("flex-col items-center gap-4 z-10 lg:sticky lg:top-8 lg:w-[256px] lg:shrink-0", displayWindow.isOpen ? "hidden lg:flex" : "hidden")}>
      <div className={cn(
        "relative w-full flex flex-col items-center gap-3",
        displayWindow.isOpen && "lg:gap-4"
      )}>
        <div className="hidden">
          <AnimatePresence mode="wait">
            {visualMode === "orb" && (
              <motion.div
                key="orb"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="w-full h-full"
              >
                <PersonaAvatar personaName={personaName} {...avatarProps} className="w-full h-full" />
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
                <PersonaAvatar personaName={personaName} {...avatarProps} className="w-full h-full" />
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
                <AudioVisualizer
                  isActive={isActive}
                  isSpeaking={isSpeaking}
                  isListening={isListening}
                  mood={conversationMood}
                  isPaused={isPaused}
                  reducedMotion={reducedMotion}
                  className="w-full h-24 md:h-48"
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <DisplayWindow
          content={displayWindow.content}
          isOpen={displayWindow.isOpen}
          onClose={displayWindow.close}
          className={cn(
            "w-full max-w-[300px] h-[250px]",
            "lg:max-w-[320px] lg:h-[320px]"
          )}
          persona={isOwner ? "ulysse" : "iris"}
        />
      </div>
    </div>
  );
}
