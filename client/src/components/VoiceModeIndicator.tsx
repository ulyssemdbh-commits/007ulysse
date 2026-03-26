import { AlertTriangle, CheckCircle, WifiOff, Mic } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { VoiceModeStatus, VoiceError } from "@/hooks/voice/types";
import { cn } from "@/lib/utils";

interface VoiceModeIndicatorProps {
  status: VoiceModeStatus;
  error: VoiceError | null;
  isIOS: boolean;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
}

export function VoiceModeIndicator({
  status,
  error,
  isIOS,
  onRetry,
  onDismiss,
  className,
}: VoiceModeIndicatorProps) {
  if (status === "full" && !error) {
    return null;
  }

  if (status === "degraded") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/20",
          className
        )}
        data-testid="voice-mode-degraded-banner"
      >
        <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
            Mode voix limité
          </p>
          <p className="text-xs text-muted-foreground">
            {isIOS
              ? "Sur iOS Safari, appuyez pour parler. L'écoute continue n'est pas disponible."
              : "Certaines fonctionnalités vocales sont limitées."}
          </p>
        </div>
        {onRetry && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onRetry}
            className="flex-shrink-0"
            data-testid="button-retry-voice"
          >
            Réessayer
          </Button>
        )}
      </div>
    );
  }

  if (status === "unavailable") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/20",
          className
        )}
        data-testid="voice-mode-unavailable-banner"
      >
        <WifiOff className="h-4 w-4 text-destructive flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-destructive">
            Voix indisponible
          </p>
          <p className="text-xs text-muted-foreground">
            La reconnaissance vocale n'est pas disponible sur ce navigateur.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/20",
          className
        )}
        data-testid="voice-error-banner"
      >
        <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-destructive">
            {error.userMessage}
          </p>
          {error.recoverable && onRetry && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onRetry}
              className="h-auto p-0 text-xs underline"
              data-testid="button-retry-error"
            >
              Réessayer
            </Button>
          )}
        </div>
        {onDismiss && (
          <Button
            size="icon"
            variant="ghost"
            onClick={onDismiss}
            className="flex-shrink-0"
            data-testid="button-dismiss-error"
          >
            <span className="sr-only">Fermer</span>
            <span aria-hidden>×</span>
          </Button>
        )}
      </div>
    );
  }

  return null;
}

interface VoiceStatusBadgeProps {
  status: VoiceModeStatus;
  isListening: boolean;
  isSpeaking: boolean;
  className?: string;
}

export function VoiceStatusBadge({
  status,
  isListening,
  isSpeaking,
  className,
}: VoiceStatusBadgeProps) {
  if (isSpeaking) {
    return (
      <Badge variant="default" className={cn("gap-1", className)} data-testid="badge-speaking">
        <Mic className="h-3 w-3 animate-pulse" />
        Parle
      </Badge>
    );
  }

  if (isListening) {
    return (
      <Badge variant="secondary" className={cn("gap-1", className)} data-testid="badge-listening">
        <Mic className="h-3 w-3 animate-pulse text-green-500" />
        Écoute
      </Badge>
    );
  }

  if (status === "degraded") {
    return (
      <Badge variant="outline" className={cn("gap-1 border-amber-500/50 text-amber-600", className)} data-testid="badge-degraded">
        <AlertTriangle className="h-3 w-3" />
        Limité
      </Badge>
    );
  }

  if (status === "unavailable") {
    return (
      <Badge variant="destructive" className={cn("gap-1", className)} data-testid="badge-unavailable">
        <WifiOff className="h-3 w-3" />
        Indisponible
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className={cn("gap-1 text-muted-foreground", className)} data-testid="badge-ready">
      <CheckCircle className="h-3 w-3" />
      Prêt
    </Badge>
  );
}
