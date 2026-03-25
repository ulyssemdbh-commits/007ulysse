import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { 
  Square, 
  AlertTriangle, 
  Compass, 
  Camera, 
  GraduationCap, 
  CornerDownRight,
  Volume2,
  VolumeX,
  Gauge,
  Moon,
  Sun,
  Navigation,
  Vibrate
} from "lucide-react";
import { NextTurnBanner } from "./NextTurnBanner";
import { RouteInfo } from "./MapTypes";

interface NavigationHUDProps {
  isNavigating: boolean;
  onStopNavigation: () => void;
  currentSpeed: number;
  speedLimit: number | null;
  isOverSpeed: boolean;
  roadName: string | null;
  remainingDistance: number;
  dynamicEta: string | null;
  navProgress: { percent: number; eta: string | null; distanceFromRoute: number };
  isGpsLost: boolean;
  autoRecalculating: boolean;
  speedCameraAlert: { distance: number } | null;
  schoolZoneAlert: { name: string; distance: number } | null;
  curveWarning: { recommendedSpeed: number } | null;
  voiceEnabled: boolean;
  onToggleVoice: () => void;
  isNightMode: boolean;
  onToggleNightMode: () => void;
  currentInstruction?: { text: string; distance: number } | null;
  currentInstructionIndex?: number;
  totalInstructions?: number;
  distanceToNextTurn?: number;
  isLastInstruction?: boolean;
}

export function NavigationHUD({
  isNavigating,
  onStopNavigation,
  currentSpeed,
  speedLimit,
  isOverSpeed,
  roadName,
  remainingDistance,
  dynamicEta,
  navProgress,
  isGpsLost,
  autoRecalculating,
  speedCameraAlert,
  schoolZoneAlert,
  curveWarning,
  voiceEnabled,
  onToggleVoice,
  isNightMode,
  onToggleNightMode,
  currentInstruction,
  currentInstructionIndex = 0,
  totalInstructions = 0,
  distanceToNextTurn = 0,
  isLastInstruction = false,
}: NavigationHUDProps) {
  if (!isNavigating) return null;

  const formatDistance = (meters: number) => {
    if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
    return `${Math.round(meters)} m`;
  };

  return (
    <div className="absolute top-2 left-2 right-2 z-[1000] pointer-events-auto flex flex-col gap-2">
      {currentInstruction && (
        <NextTurnBanner
          instruction={currentInstruction.text}
          distanceMeters={distanceToNextTurn > 0 ? distanceToNextTurn : currentInstruction.distance}
          isLast={isLastInstruction}
        />
      )}
      
      <div className="flex items-start gap-2">
        <Button
          size="sm"
          variant="destructive"
          onClick={onStopNavigation}
          className="h-8 gap-1"
          data-testid="button-stop-navigation"
        >
          <Square className="w-3 h-3" />
          Arrêter
        </Button>
        
        <Button
          size="icon"
          variant="secondary"
          className="h-8 w-8"
          onClick={onToggleVoice}
          data-testid="button-toggle-voice"
        >
          {voiceEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
        </Button>

        <div className="flex-1" />
        
        {speedLimit && (
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg ${isOverSpeed ? "bg-red-500 text-white animate-pulse" : "bg-card"}`}>
            <Gauge className="w-3.5 h-3.5" />
            <span className="text-sm font-bold">{speedLimit}</span>
          </div>
        )}
        
        <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-card">
          <span className="text-lg font-bold">{Math.round(currentSpeed)}</span>
          <span className="text-[10px] text-muted-foreground">km/h</span>
        </div>
      </div>
      
      {roadName && (
        <div className="text-xs text-center text-muted-foreground bg-card/80 px-2 py-1 rounded self-center">
          {roadName}
        </div>
      )}
      
      <Card className="bg-card/95 shadow-lg">
        <CardContent className="p-2 space-y-1">
          <div className="flex items-center gap-2 mb-1">
            <Navigation className="w-3 h-3 text-primary" />
            <span className="text-[10px] text-muted-foreground">
              Étape {currentInstructionIndex + 1}/{totalInstructions}
            </span>
          </div>
          
          <Progress
            value={navProgress.percent}
            className="h-1.5"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{formatDistance(remainingDistance)}</span>
            {(dynamicEta || navProgress.eta) && <span>ETA {dynamicEta || navProgress.eta}</span>}
          </div>
          
          {navProgress.distanceFromRoute > 30 && (
            <div className="text-[10px] text-amber-500 flex items-center gap-1">
              <AlertTriangle className="w-2.5 h-2.5" />
              {autoRecalculating ? "Recalcul..." : `${Math.round(navProgress.distanceFromRoute)}m hors route`}
            </div>
          )}
          
          {isGpsLost && (
            <div className="text-[10px] text-orange-500 flex items-center gap-1">
              <Compass className="w-2.5 h-2.5 animate-pulse" />
              Signal GPS faible
            </div>
          )}
          
          {speedCameraAlert && (
            <div className="text-[10px] text-red-500 flex items-center gap-1 animate-pulse">
              <Camera className="w-2.5 h-2.5" />
              Radar {speedCameraAlert.distance}m
            </div>
          )}
          
          {schoolZoneAlert && (
            <div className="text-[10px] text-yellow-500 flex items-center gap-1">
              <GraduationCap className="w-2.5 h-2.5" />
              Zone école
            </div>
          )}
          
          {curveWarning && (
            <div className="text-[10px] text-orange-400 flex items-center gap-1">
              <CornerDownRight className="w-2.5 h-2.5" />
              Virage {curveWarning.recommendedSpeed}km/h
            </div>
          )}
        </CardContent>
      </Card>
      
      <Button
        size="icon"
        variant="secondary"
        className="h-10 w-10 self-end"
        onClick={onToggleNightMode}
        data-testid="button-toggle-night-mode"
      >
        {isNightMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </Button>
    </div>
  );
}
