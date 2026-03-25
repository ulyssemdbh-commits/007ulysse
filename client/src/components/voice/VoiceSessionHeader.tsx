import { motion } from "framer-motion";
import { Wifi, WifiOff, Phone, PhoneOff, Loader2, Shield, ShieldOff, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConnectionState, VoiceState } from "./types";
import { CONNECTION_LABELS, VOICE_STATE_LABELS } from "./types";

interface VoiceSessionHeaderProps {
  connectionState: ConnectionState;
  voiceState: VoiceState;
  isInCall: boolean;
  userName?: string;
  personaName?: string;
  voiceSecurityEnabled?: boolean;
  degradedMode?: boolean;
}

export function VoiceSessionHeader({
  connectionState,
  voiceState,
  isInCall,
  userName,
  personaName = "Ulysse",
  voiceSecurityEnabled = false,
  degradedMode = false,
}: VoiceSessionHeaderProps) {
  const isConnected = connectionState === "authenticated" || connectionState === "connected";
  const isConnecting = connectionState === "connecting" || connectionState === "authenticating";
  
  return (
    <div className="flex items-center justify-between p-4 bg-gray-900/80 backdrop-blur-sm border-b border-gray-800">
      <div className="flex items-center gap-3">
        <div className="relative">
          <motion.div
            className={cn(
              "w-12 h-12 rounded-full flex items-center justify-center",
              isInCall ? "bg-green-600" : "bg-gray-700"
            )}
            animate={isInCall ? { scale: [1, 1.05, 1] } : {}}
            transition={{ repeat: Infinity, duration: 2 }}
          >
            {isInCall ? (
              <Phone className="w-6 h-6 text-white" />
            ) : (
              <PhoneOff className="w-6 h-6 text-gray-400" />
            )}
          </motion.div>
          
          {voiceState === "speaking" && (
            <motion.div
              className="absolute -bottom-1 -right-1 w-5 h-5 bg-purple-500 rounded-full flex items-center justify-center"
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ repeat: Infinity, duration: 0.5 }}
            >
              <Volume2 className="w-3 h-3 text-white" />
            </motion.div>
          )}
        </div>
        
        <div>
          <h2 className="text-white font-semibold text-lg">{personaName}</h2>
          <div className="flex items-center gap-2">
            <span className={cn(
              "text-sm",
              voiceState === "listening" ? "text-green-400" :
              voiceState === "speaking" ? "text-purple-400" :
              voiceState === "processing" ? "text-yellow-400" :
              "text-gray-400"
            )}>
              {VOICE_STATE_LABELS[voiceState]}
            </span>
            
            {voiceState === "listening" && (
              <motion.span
                className="inline-block w-2 h-2 bg-green-400 rounded-full"
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ repeat: Infinity, duration: 1 }}
              />
            )}
          </div>
        </div>
      </div>
      
      <div className="flex items-center gap-3">
        {degradedMode && (
          <div className="px-2 py-1 bg-yellow-600/20 rounded text-yellow-400 text-xs">
            Mode degrade
          </div>
        )}
        
        <div className="flex items-center gap-2">
          {voiceSecurityEnabled ? (
            <Shield className="w-4 h-4 text-green-400" />
          ) : (
            <ShieldOff className="w-4 h-4 text-gray-500" />
          )}
          
          <div className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-full text-xs",
            isConnected ? "bg-green-600/20 text-green-400" :
            isConnecting ? "bg-yellow-600/20 text-yellow-400" :
            connectionState === "error" ? "bg-red-600/20 text-red-400" :
            "bg-gray-700 text-gray-400"
          )}>
            {isConnecting ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : isConnected ? (
              <Wifi className="w-3 h-3" />
            ) : (
              <WifiOff className="w-3 h-3" />
            )}
            <span>{CONNECTION_LABELS[connectionState]}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
