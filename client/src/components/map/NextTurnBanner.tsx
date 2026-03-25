import { 
  ArrowUp, 
  ArrowUpRight, 
  ArrowRight, 
  ArrowDownRight,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpLeft,
  CornerDownRight,
  CornerDownLeft,
  Milestone,
  Flag,
  RotateCcw,
  RotateCw,
  CircleDot,
  MapPin,
  MoveRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

interface NextTurnBannerProps {
  instruction: string;
  distanceMeters: number;
  isLast: boolean;
  className?: string;
}

type TurnDirection = 
  | "straight" 
  | "slight-right" 
  | "right" 
  | "sharp-right" 
  | "u-turn-right"
  | "slight-left" 
  | "left" 
  | "sharp-left" 
  | "u-turn-left"
  | "roundabout"
  | "roundabout-exit"
  | "destination"
  | "waypoint"
  | "merge"
  | "continue";

type LaneGuidance = {
  totalLanes: number;
  recommendedLanes: number[];
  turnDirection: "left" | "straight" | "right";
};

function detectTurnDirection(instruction: string): TurnDirection {
  const lower = instruction.toLowerCase();
  
  // Destination patterns (French + English)
  if (/arrivée|destination|vous êtes arrivé|arrived|you have arrived|fin de l'itinéraire/.test(lower)) {
    return "destination";
  }
  
  // Waypoint patterns
  if (/étape|waypoint|point intermédiaire/.test(lower)) {
    return "waypoint";
  }
  
  // Roundabout patterns (French + English) - check before regular turns
  // Handle ordinal exits like "prenez la 2e sortie", "take the 3rd exit"
  if (/rond-point|giratoire|roundabout|rotonde/.test(lower)) {
    if (/sortie|exit|\d+e\s|1st|2nd|3rd|\d+th|première|deuxième|troisième/.test(lower)) {
      return "roundabout-exit";
    }
    return "roundabout";
  }
  
  // U-turn patterns
  if (/demi-tour|u-turn|faire demi|faites demi|retournez/.test(lower)) {
    if (/gauche|left/.test(lower)) return "u-turn-left";
    return "u-turn-right";
  }
  
  // Merge patterns
  if (/insérez|merger|merge|rejoign|join/.test(lower)) {
    return "merge";
  }
  
  // Keep right/left patterns (French + English) - lane keeping
  // "restez sur la file de droite", "keep right", "serrez à droite"
  if (/file de droite|keep right|serrez.*droite|restez.*droite|voie de droite/.test(lower)) {
    return "slight-right";
  }
  if (/file de gauche|keep left|serrez.*gauche|restez.*gauche|voie de gauche/.test(lower)) {
    return "slight-left";
  }
  
  // Sharp turn patterns (French + English)
  if (/fortement|sharp|virage serré|brusque/.test(lower)) {
    if (/droite|right/.test(lower)) return "sharp-right";
    if (/gauche|left/.test(lower)) return "sharp-left";
  }
  
  // Slight turn patterns (French + English)
  if (/légèrement|slight|doucement|gentle|bifurq/.test(lower)) {
    if (/droite|right/.test(lower)) return "slight-right";
    if (/gauche|left/.test(lower)) return "slight-left";
  }
  
  // Regular right turn patterns - expanded for ordinals
  // "prenez la 2e à droite", "take the 2nd right"
  if (/à droite|tournez à droite|turn right|virez.*droite|prenez.*droite|\d+e.*droite|\d+(st|nd|rd|th).*right/.test(lower) ||
      (/droite/.test(lower) && /tourner|virez|prenez/.test(lower))) {
    return "right";
  }
  
  // Regular left turn patterns - expanded for ordinals
  // "prenez la 2e à gauche", "take the 2nd left"
  if (/à gauche|tournez à gauche|turn left|virez.*gauche|prenez.*gauche|\d+e.*gauche|\d+(st|nd|rd|th).*left/.test(lower) ||
      (/gauche/.test(lower) && /tourner|virez|prenez/.test(lower))) {
    return "left";
  }
  
  // Continue/straight patterns (French conjugations + English)
  if (/continuer|continuez|continue|tout droit|straight|restez|stay|suivez|follow|gardez/.test(lower)) {
    return "straight";
  }
  
  // Default to continue for unknown patterns
  return "continue";
}

function TurnIcon({ direction, className }: { direction: TurnDirection; className?: string }) {
  const iconClass = cn("w-full h-full", className);
  
  switch (direction) {
    case "straight":
    case "continue":
      return <ArrowUp className={iconClass} />;
    case "slight-right":
      return <ArrowUpRight className={iconClass} />;
    case "right":
      return <CornerDownRight className={iconClass} />;
    case "sharp-right":
      return <ArrowDownRight className={iconClass} />;
    case "u-turn-right":
      return <RotateCw className={iconClass} />;
    case "slight-left":
      return <ArrowUpLeft className={iconClass} />;
    case "left":
      return <CornerDownLeft className={iconClass} />;
    case "sharp-left":
      return <ArrowDownLeft className={iconClass} />;
    case "u-turn-left":
      return <RotateCcw className={iconClass} />;
    case "roundabout":
    case "roundabout-exit":
      return <CircleDot className={iconClass} />;
    case "destination":
      return <Flag className={iconClass} />;
    case "waypoint":
      return <MapPin className={iconClass} />;
    case "merge":
      return <MoveRight className={iconClass} />;
    default:
      return <Milestone className={iconClass} />;
  }
}

function detectLaneGuidance(instruction: string, direction: TurnDirection): LaneGuidance | null {
  const lower = instruction.toLowerCase();
  
  let turnDir: "left" | "straight" | "right" = "straight";
  if (["right", "slight-right", "sharp-right", "u-turn-right", "merge"].includes(direction)) {
    turnDir = "right";
  } else if (["left", "slight-left", "sharp-left", "u-turn-left"].includes(direction)) {
    turnDir = "left";
  }
  
  if (/voie de droite|file de droite|keep right|stay right|restez.*droite/.test(lower)) {
    return { totalLanes: 3, recommendedLanes: [3], turnDirection: "right" };
  }
  if (/voie de gauche|file de gauche|keep left|stay left|restez.*gauche/.test(lower)) {
    return { totalLanes: 3, recommendedLanes: [1], turnDirection: "left" };
  }
  if (/voie du milieu|centre|center lane|middle lane/.test(lower)) {
    return { totalLanes: 3, recommendedLanes: [2], turnDirection: "straight" };
  }
  
  if (/autoroute|highway|motorway|bretelle|ramp|sortie.*\d/.test(lower)) {
    if (turnDir === "right") {
      return { totalLanes: 3, recommendedLanes: [2, 3], turnDirection: "right" };
    } else if (turnDir === "left") {
      return { totalLanes: 3, recommendedLanes: [1, 2], turnDirection: "left" };
    }
  }
  
  if (["right", "sharp-right"].includes(direction)) {
    return { totalLanes: 2, recommendedLanes: [2], turnDirection: "right" };
  }
  if (["left", "sharp-left"].includes(direction)) {
    return { totalLanes: 2, recommendedLanes: [1], turnDirection: "left" };
  }
  
  return null;
}

function LaneIndicator({ guidance, className }: { guidance: LaneGuidance; className?: string }) {
  const { totalLanes, recommendedLanes, turnDirection } = guidance;
  
  return (
    <div className={cn("flex items-center gap-0.5 justify-center", className)} data-testid="lane-indicator">
      {Array.from({ length: totalLanes }, (_, i) => {
        const laneNum = i + 1;
        const isRecommended = recommendedLanes.includes(laneNum);
        const arrowRotation = turnDirection === "left" ? -45 : turnDirection === "right" ? 45 : 0;
        
        return (
          <div
            key={laneNum}
            className={cn(
              "w-5 h-6 rounded-sm flex items-center justify-center border transition-colors",
              isRecommended 
                ? "bg-green-500 border-green-600 text-white" 
                : "bg-muted/50 border-muted-foreground/30 text-muted-foreground/50"
            )}
          >
            <svg 
              width="12" 
              height="12" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="3"
              strokeLinecap="round" 
              strokeLinejoin="round"
              style={{ transform: isRecommended ? `rotate(${arrowRotation}deg)` : "rotate(0deg)" }}
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </div>
        );
      })}
    </div>
  );
}

function formatDistanceCompact(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  if (meters > 100) {
    return `${Math.round(meters / 50) * 50} m`;
  }
  if (meters > 30) {
    return `${Math.round(meters / 10) * 10} m`;
  }
  if (meters <= 0) {
    return "Maintenant";
  }
  return `${Math.round(meters)} m`;
}

function getDistanceState(meters: number, isLast: boolean): "imminent" | "approaching" | "soon" | "far" | "arrived" {
  if (isLast && meters <= 50) return "arrived";
  if (meters <= 50) return "imminent";
  if (meters <= 150) return "approaching";
  if (meters <= 300) return "soon";
  return "far";
}

export function NextTurnBanner({ 
  instruction, 
  distanceMeters, 
  isLast,
  className 
}: NextTurnBannerProps) {
  const direction = detectTurnDirection(instruction);
  const distance = formatDistanceCompact(distanceMeters);
  const state = getDistanceState(distanceMeters, isLast);
  const laneGuidance = distanceMeters < 500 ? detectLaneGuidance(instruction, direction) : null;
  
  return (
    <Card 
      className={cn(
        "flex flex-col gap-2 p-3 shadow-lg transition-colors duration-300 border-2",
        state === "arrived" && "bg-green-500/20 border-green-500 dark:bg-green-500/30",
        state === "imminent" && "bg-destructive/20 border-destructive dark:bg-destructive/30 animate-pulse",
        state === "approaching" && "bg-amber-500/20 border-amber-500 dark:bg-amber-500/30",
        state === "soon" && "bg-yellow-500/15 border-yellow-500/50 dark:bg-yellow-500/20",
        state === "far" && "bg-primary/10 border-primary/50 dark:bg-primary/20",
        className
      )}
      data-testid="next-turn-banner"
    >
      <div className="flex items-center gap-3">
        <div className={cn(
          "w-14 h-14 flex-shrink-0 rounded-lg flex items-center justify-center",
          state === "arrived" && "bg-green-500 text-white",
          state === "imminent" && "bg-destructive text-destructive-foreground",
          state === "approaching" && "bg-amber-500 text-white",
          state === "soon" && "bg-yellow-500 text-black",
          state === "far" && "bg-primary text-primary-foreground"
        )}>
          <TurnIcon direction={direction} className="w-9 h-9" />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="text-base font-bold leading-tight line-clamp-2 text-foreground">
            {instruction}
          </div>
        </div>
        
        <div className="flex-shrink-0 text-right">
          <div className={cn(
            "text-2xl font-black leading-none",
            state === "imminent" && "text-destructive animate-pulse",
            state === "approaching" && "text-amber-600 dark:text-amber-400",
            state === "arrived" && "text-green-600 dark:text-green-400",
            (state === "soon" || state === "far") && "text-foreground"
          )}>
            {distance}
          </div>
        </div>
      </div>
      
      {laneGuidance && (
        <div className="flex items-center justify-between border-t border-muted pt-2">
          <span className="text-xs text-muted-foreground font-medium">Voies:</span>
          <LaneIndicator guidance={laneGuidance} />
        </div>
      )}
    </Card>
  );
}

export { detectTurnDirection, TurnIcon };
