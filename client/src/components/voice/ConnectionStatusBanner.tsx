import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Wifi, WifiOff, RefreshCw, AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ConnectionState } from "./types";

interface ConnectionStatusBannerProps {
  connectionState: ConnectionState;
  degradedMode: boolean;
  onReconnect: () => void;
  onDismiss?: () => void;
  lastError?: string;
  reconnectAttempts?: number;
  maxReconnectAttempts?: number;
}

export function ConnectionStatusBanner({
  connectionState,
  degradedMode,
  onReconnect,
  onDismiss,
  lastError,
  reconnectAttempts = 0,
  maxReconnectAttempts = 5,
}: ConnectionStatusBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [countdown, setCountdown] = useState(0);
  
  const isDisconnected = connectionState === "disconnected" || connectionState === "error";
  const isConnecting = connectionState === "connecting" || connectionState === "authenticating";
  const isConnected = connectionState === "connected" || connectionState === "authenticated";
  
  const shouldShow = (isDisconnected || degradedMode) && !dismissed;
  
  useEffect(() => {
    if (isDisconnected && reconnectAttempts > 0 && reconnectAttempts < maxReconnectAttempts) {
      const delay = Math.min(Math.pow(2, reconnectAttempts) * 1000, 30000);
      setCountdown(Math.ceil(delay / 1000));
      
      const interval = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      
      return () => clearInterval(interval);
    }
  }, [isDisconnected, reconnectAttempts, maxReconnectAttempts]);
  
  useEffect(() => {
    if (isConnected) {
      setDismissed(false);
    }
  }, [isConnected]);
  
  const handleDismiss = useCallback(() => {
    setDismissed(true);
    onDismiss?.();
  }, [onDismiss]);
  
  if (!shouldShow) return null;
  
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className={cn(
          "flex items-center justify-between gap-3 px-4 py-3 rounded-lg",
          degradedMode && !isDisconnected
            ? "bg-yellow-900/30 border border-yellow-700"
            : "bg-red-900/30 border border-red-700"
        )}
      >
        <div className="flex items-center gap-3">
          {isConnecting ? (
            <RefreshCw className="w-5 h-5 text-yellow-400 animate-spin" />
          ) : degradedMode && !isDisconnected ? (
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
          ) : (
            <WifiOff className="w-5 h-5 text-red-400" />
          )}
          
          <div>
            <p className={cn(
              "text-sm font-medium",
              degradedMode && !isDisconnected ? "text-yellow-200" : "text-red-200"
            )}>
              {isConnecting 
                ? "Reconnexion en cours..."
                : degradedMode && !isDisconnected
                  ? "Mode degrade actif"
                  : "Connexion perdue"
              }
            </p>
            
            {lastError && !isConnecting && (
              <p className="text-xs text-gray-400 mt-0.5">{lastError}</p>
            )}
            
            {countdown > 0 && !isConnecting && (
              <p className="text-xs text-gray-400 mt-0.5">
                Nouvelle tentative dans {countdown}s ({reconnectAttempts}/{maxReconnectAttempts})
              </p>
            )}
            
            {degradedMode && !isDisconnected && (
              <p className="text-xs text-gray-400 mt-0.5">
                Utilisation du navigateur pour la voix
              </p>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {isDisconnected && (
            <Button
              variant="outline"
              size="sm"
              onClick={onReconnect}
              disabled={isConnecting}
              className="h-8 text-xs bg-transparent border-gray-600 text-white hover:bg-gray-800"
            >
              <RefreshCw className={cn("w-3 h-3 mr-1", isConnecting && "animate-spin")} />
              Reconnecter
            </Button>
          )}
          
          {onDismiss && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDismiss}
              className="h-8 w-8 text-gray-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
