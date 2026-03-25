import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bug, X, RefreshCw } from "lucide-react";
import type { VoiceDebugInfo } from "@/hooks/use-voice";

interface VoiceDebugPanelProps {
  getDebugInfo: () => VoiceDebugInfo;
  isOwner: boolean;
}

export function VoiceDebugPanel({ getDebugInfo, isOwner }: VoiceDebugPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [debugInfo, setDebugInfo] = useState<VoiceDebugInfo | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    
    const interval = setInterval(() => {
      setDebugInfo(getDebugInfo());
    }, 200);
    
    return () => clearInterval(interval);
  }, [isOpen, getDebugInfo]);

  if (!isOwner) return null;

  if (!isOpen) {
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 left-4 z-50 opacity-30"
        data-testid="button-voice-debug-toggle"
        title="Voice Debug Mode"
      >
        <Bug className="h-4 w-4" />
      </Button>
    );
  }

  const getStateColor = (state: string) => {
    switch (state) {
      case "idle": return "bg-gray-500";
      case "listening": return "bg-green-500";
      case "processing": return "bg-yellow-500";
      case "speaking": return "bg-blue-500";
      default: return "bg-gray-500";
    }
  };

  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    if (diff < 1000) return "now";
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    return `${Math.floor(diff / 60000)}m ago`;
  };

  return (
    <Card className="fixed bottom-4 left-4 z-50 w-80 bg-background/95 backdrop-blur shadow-lg border-2" data-testid="panel-voice-debug">
      <CardHeader className="py-2 px-3 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Bug className="h-4 w-4" />
          Voice Debug
        </CardTitle>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setDebugInfo(getDebugInfo())} data-testid="button-voice-debug-refresh">
            <RefreshCw className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setIsOpen(false)} data-testid="button-voice-debug-close">
            <X className="h-3 w-3" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="py-2 px-3 text-xs space-y-2">
        {debugInfo && (
          <>
            <div className="flex items-center justify-between" data-testid="debug-voice-state">
              <span className="text-muted-foreground">State:</span>
              <Badge className={`${getStateColor(debugInfo.state)} text-white text-xs`}>
                {debugInfo.state}
              </Badge>
            </div>
            
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-1" data-testid="debug-wake-word">
                <span className={`w-2 h-2 rounded-full ${debugInfo.wakeWordActive ? "bg-green-500" : "bg-gray-400"}`} />
                <span>Wake Word</span>
              </div>
              <div className="flex items-center gap-1" data-testid="debug-end-trigger">
                <span className={`w-2 h-2 rounded-full ${debugInfo.endTriggerFired ? "bg-green-500" : "bg-gray-400"}`} />
                <span>End Trigger</span>
              </div>
              <div className="flex items-center gap-1" data-testid="debug-echo-filter">
                <span className={`w-2 h-2 rounded-full ${debugInfo.echoFilterApplied ? "bg-orange-500" : "bg-gray-400"}`} />
                <span>Echo Filter</span>
              </div>
              <div className="flex items-center gap-1" data-testid="debug-ios-timeout">
                <span className={`w-2 h-2 rounded-full ${debugInfo.iOSSilenceTimeout ? "bg-red-500" : "bg-gray-400"}`} />
                <span>iOS Timeout</span>
              </div>
              <div className="flex items-center gap-1" data-testid="debug-recording">
                <span className={`w-2 h-2 rounded-full ${debugInfo.isRecording ? "bg-green-500" : "bg-gray-400"}`} />
                <span>Recording</span>
              </div>
              <div className="flex items-center gap-1" data-testid="debug-keep-listen">
                <span className={`w-2 h-2 rounded-full ${debugInfo.keepListening ? "bg-green-500" : "bg-gray-400"}`} />
                <span>Keep Listen</span>
              </div>
            </div>

            <div className="flex items-center justify-between" data-testid="debug-restart-attempts">
              <span className="text-muted-foreground">Restart Attempts:</span>
              <span className="font-mono">{debugInfo.restartAttempts}</span>
            </div>

            <div className="border-t pt-2 mt-2" data-testid="debug-last-event">
              <div className="text-muted-foreground mb-1">Last Event ({formatTime(debugInfo.lastEventTime)}):</div>
              <div className="font-mono text-xs bg-muted p-1 rounded break-words">
                {debugInfo.lastEvent}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
