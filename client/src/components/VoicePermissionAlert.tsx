import { AlertCircle, Settings, ExternalLink } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface VoicePermissionAlertProps {
  type: "mic" | "tts";
  platform?: "ios" | "android" | "desktop";
  onRetry?: () => void;
}

function detectPlatform(): "ios" | "android" | "desktop" {
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  return "desktop";
}

export function VoicePermissionAlert({ type, platform, onRetry }: VoicePermissionAlertProps) {
  const detectedPlatform = platform || detectPlatform();
  
  const getTitle = () => {
    if (type === "mic") return "Microphone bloqué";
    return "Synthèse vocale désactivée";
  };
  
  const getInstructions = () => {
    if (type === "mic") {
      switch (detectedPlatform) {
        case "ios":
          return {
            main: "Safari a besoin de votre permission pour le microphone.",
            steps: [
              "Ouvrez Réglages sur votre iPhone",
              "Descendez jusqu'à Safari",
              "Appuyez sur Microphone",
              "Sélectionnez 'Autoriser' ou 'Demander'"
            ],
            tip: "Rafraîchissez ensuite cette page."
          };
        case "android":
          return {
            main: "Chrome a besoin de votre permission pour le microphone.",
            steps: [
              "Appuyez sur l'icône du cadenas à côté de l'URL",
              "Appuyez sur 'Autorisations du site'",
              "Activez 'Microphone'"
            ],
            tip: "Ou allez dans Paramètres > Applications > Chrome > Autorisations."
          };
        default:
          return {
            main: "Votre navigateur a bloqué l'accès au microphone.",
            steps: [
              "Cliquez sur l'icône du cadenas dans la barre d'adresse",
              "Trouvez 'Microphone' dans les paramètres du site",
              "Changez la permission en 'Autoriser'"
            ],
            tip: "Rafraîchissez la page après avoir modifié les permissions."
          };
      }
    } else {
      return {
        main: "La synthèse vocale n'est pas disponible.",
        steps: [
          "Vérifiez que le son de votre appareil n'est pas coupé",
          "Assurez-vous que votre navigateur supporte la synthèse vocale"
        ],
        tip: "Essayez de rafraîchir la page."
      };
    }
  };
  
  const instructions = getInstructions();
  
  return (
    <Alert variant="destructive" className="my-4">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle className="flex items-center gap-2">
        {getTitle()}
      </AlertTitle>
      <AlertDescription className="mt-2 space-y-3">
        <p className="text-sm">{instructions.main}</p>
        
        <ol className="text-sm space-y-1 ml-4 list-decimal">
          {instructions.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
        
        {instructions.tip && (
          <p className="text-xs text-muted-foreground">{instructions.tip}</p>
        )}
        
        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="mt-2"
            data-testid="button-retry-permission"
          >
            <Settings className="h-4 w-4 mr-2" />
            Réessayer
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function VoiceStatusBadge({ 
  micPermission, 
  sttSupported, 
  ttsSupported,
  isIOS 
}: { 
  micPermission: string;
  sttSupported: boolean;
  ttsSupported: boolean;
  isIOS: boolean;
}) {
  const getStatus = () => {
    if (micPermission === "denied") {
      return { 
        label: "Micro bloqué", 
        variant: "destructive" as const,
        description: isIOS 
          ? "Allez dans Réglages > Safari > Microphone" 
          : "Cliquez sur le cadenas pour autoriser"
      };
    }
    if (!sttSupported && !ttsSupported) {
      return { 
        label: "Voix non disponible", 
        variant: "outline" as const,
        description: "Votre navigateur ne supporte pas la voix"
      };
    }
    if (!sttSupported) {
      return { 
        label: "Micro non disponible", 
        variant: "secondary" as const,
        description: isIOS 
          ? "La reconnaissance vocale n'est pas disponible sur Safari iOS" 
          : "Reconnaissance vocale non supportée"
      };
    }
    if (!ttsSupported) {
      return { 
        label: "Synthèse non disponible", 
        variant: "secondary" as const,
        description: "La synthèse vocale n'est pas supportée"
      };
    }
    return null;
  };
  
  const status = getStatus();
  if (!status) return null;
  
  return (
    <div className="text-xs text-muted-foreground text-center p-2 bg-muted/50 rounded-md">
      <p className="font-medium">{status.label}</p>
      <p className="opacity-70">{status.description}</p>
    </div>
  );
}
