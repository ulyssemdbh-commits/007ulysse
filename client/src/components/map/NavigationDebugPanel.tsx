import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bug, X, Navigation, Satellite, Route } from "lucide-react";

export interface NavigationDebugInfo {
  lat: number | null;
  lng: number | null;
  filteredLat: number | null;
  filteredLng: number | null;
  accuracy: number | null;
  heading: number;
  speed: number;
  distanceFromRoute: number;
  isGpsLost: boolean;
  isNavigating: boolean;
  recalculating: boolean;
  offRouteCount: number;
  rejectedJumps: number;
  lastEvent: string;
}

interface NavigationDebugPanelProps {
  debugInfo: NavigationDebugInfo;
  isOwner: boolean;
}

export function NavigationDebugPanel({ debugInfo, isOwner }: NavigationDebugPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!isOwner || !debugInfo.isNavigating) return null;

  if (!isOpen) {
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen(true)}
        className="absolute top-2 left-2 z-[1000] opacity-50"
        data-testid="button-nav-debug-toggle"
        title="Navigation Debug"
      >
        <Bug className="h-4 w-4" />
      </Button>
    );
  }

  const getGpsQuality = (accuracy: number | null) => {
    if (!accuracy) return { label: "N/A", color: "bg-gray-500" };
    if (accuracy <= 10) return { label: "Excellent", color: "bg-green-500" };
    if (accuracy <= 20) return { label: "Bon", color: "bg-green-400" };
    if (accuracy <= 50) return { label: "Moyen", color: "bg-yellow-500" };
    return { label: "Faible", color: "bg-red-500" };
  };

  const gpsQuality = getGpsQuality(debugInfo.accuracy);

  return (
    <Card className="absolute top-2 left-2 z-[1000] w-72 bg-background/95 backdrop-blur shadow-lg text-xs" data-testid="panel-nav-debug">
      <CardHeader className="py-1.5 px-2 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-xs font-medium flex items-center gap-1">
          <Bug className="h-3 w-3" />
          Nav Debug
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={() => setIsOpen(false)} data-testid="button-nav-debug-close">
          <X className="h-3 w-3" />
        </Button>
      </CardHeader>
      <CardContent className="py-1.5 px-2 space-y-1.5">
        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
          <div className="flex items-center gap-1" data-testid="debug-nav-gps-raw">
            <Satellite className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">GPS:</span>
          </div>
          <span className="font-mono text-[10px]">
            {debugInfo.lat?.toFixed(6) ?? "N/A"}, {debugInfo.lng?.toFixed(6) ?? "N/A"}
          </span>

          <div className="flex items-center gap-1" data-testid="debug-nav-gps-filtered">
            <Navigation className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Filtré:</span>
          </div>
          <span className="font-mono text-[10px]">
            {debugInfo.filteredLat?.toFixed(6) ?? "N/A"}, {debugInfo.filteredLng?.toFixed(6) ?? "N/A"}
          </span>

          <span className="text-muted-foreground">Précision:</span>
          <div className="flex items-center gap-1">
            <Badge className={`${gpsQuality.color} text-white text-[9px] px-1 py-0`}>
              {gpsQuality.label}
            </Badge>
            <span className="font-mono text-[10px]">{debugInfo.accuracy?.toFixed(0) ?? "N/A"}m</span>
          </div>

          <span className="text-muted-foreground">Cap:</span>
          <span className="font-mono text-[10px]">{debugInfo.heading.toFixed(1)}°</span>

          <span className="text-muted-foreground">Vitesse:</span>
          <span className="font-mono text-[10px]">{debugInfo.speed.toFixed(1)} km/h</span>

          <div className="flex items-center gap-1" data-testid="debug-nav-distance-route">
            <Route className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Dist. route:</span>
          </div>
          <span className={`font-mono text-[10px] ${debugInfo.distanceFromRoute > 50 ? "text-red-500" : debugInfo.distanceFromRoute > 30 ? "text-amber-500" : ""}`}>
            {debugInfo.distanceFromRoute.toFixed(0)}m
          </span>
        </div>

        <div className="border-t pt-1 grid grid-cols-3 gap-1">
          <div className="flex items-center gap-0.5" data-testid="debug-nav-gps-status">
            <span className={`w-2 h-2 rounded-full ${debugInfo.isGpsLost ? "bg-red-500 animate-pulse" : "bg-green-500"}`} />
            <span className="text-[9px]">GPS</span>
          </div>
          <div className="flex items-center gap-0.5" data-testid="debug-nav-recalc-status">
            <span className={`w-2 h-2 rounded-full ${debugInfo.recalculating ? "bg-amber-500 animate-pulse" : "bg-gray-400"}`} />
            <span className="text-[9px]">Recalc</span>
          </div>
          <div className="flex items-center gap-0.5" data-testid="debug-nav-offroute-status">
            <span className={`w-2 h-2 rounded-full ${debugInfo.offRouteCount > 0 ? "bg-amber-500" : "bg-gray-400"}`} />
            <span className="text-[9px]">Off:{debugInfo.offRouteCount}</span>
          </div>
        </div>

        {debugInfo.rejectedJumps > 0 && (
          <div className="text-[9px] text-amber-500 border-t pt-1" data-testid="debug-nav-jumps">
            Sauts rejetés: {debugInfo.rejectedJumps}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
