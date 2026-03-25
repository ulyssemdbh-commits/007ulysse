import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Route, Clock, ChevronUp, ChevronDown, Navigation } from "lucide-react";
import { RouteInfo, InstructionsPanelHeight } from "./MapTypes";
import { formatDistance, formatDuration } from "./MapUtils";

interface RouteInstructionsPanelProps {
  routeInfo: RouteInfo;
  currentInstructionIndex: number;
  isNavigating: boolean;
  onRepeatInstruction: (text: string) => void;
}

export function RouteInstructionsPanel({
  routeInfo,
  currentInstructionIndex,
  isNavigating,
  onRepeatInstruction,
}: RouteInstructionsPanelProps) {
  const [panelHeight, setPanelHeight] = useState<InstructionsPanelHeight>("collapsed");
  const panelDragRef = useRef<{ startY: number; startHeight: InstructionsPanelHeight } | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    panelDragRef.current = { startY: touch.clientY, startHeight: panelHeight };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!panelDragRef.current) return;
    const touch = e.touches[0];
    const deltaY = panelDragRef.current.startY - touch.clientY;

    if (deltaY > 50 && panelDragRef.current.startHeight === "collapsed") {
      setPanelHeight("partial");
    } else if (deltaY > 50 && panelDragRef.current.startHeight === "partial") {
      setPanelHeight("expanded");
    } else if (deltaY < -50 && panelDragRef.current.startHeight === "expanded") {
      setPanelHeight("partial");
    } else if (deltaY < -50 && panelDragRef.current.startHeight === "partial") {
      setPanelHeight("collapsed");
    }
  };

  const handleTouchEnd = () => {
    panelDragRef.current = null;
  };

  const handleClick = () => {
    setPanelHeight((prev) =>
      prev === "collapsed" ? "partial" : prev === "partial" ? "expanded" : "collapsed"
    );
  };

  const currentInstruction = routeInfo.instructions[currentInstructionIndex];

  return (
    <div
      className={`border-t bg-card transition-all duration-300 ease-out ${
        panelHeight === "collapsed"
          ? "h-14"
          : panelHeight === "partial"
          ? "h-[35vh]"
          : "h-[60vh]"
      }`}
      data-testid="route-instructions-panel"
    >
      <div
        className="flex flex-col items-center py-1 cursor-grab active:cursor-grabbing touch-none select-none"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleClick}
      >
        <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
          {panelHeight === "collapsed" ? (
            <>
              <ChevronUp className="w-3 h-3" /> Glisser pour voir les instructions
            </>
          ) : panelHeight === "expanded" ? (
            <>
              <ChevronDown className="w-3 h-3" /> Réduire
            </>
          ) : (
            <>
              <ChevronUp className="w-3 h-3" /> Agrandir
            </>
          )}
        </div>
      </div>

      {isNavigating && currentInstruction && (
        <div className="px-3 pb-2 border-b bg-primary/5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold">
              {currentInstructionIndex + 1}
            </div>
            <div className="flex-1">
              <div className="font-medium text-sm">{currentInstruction.text}</div>
              <div className="text-xs text-muted-foreground">
                {currentInstruction.distance > 0
                  ? formatDistance(currentInstruction.distance)
                  : "Arrivée"}
              </div>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() => onRepeatInstruction(currentInstruction.text)}
              data-testid="button-repeat-instruction"
            >
              <Navigation className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {panelHeight !== "collapsed" && (
        <div className="p-2 border-b bg-muted/50 flex items-center justify-between">
          <h3 className="font-semibold text-sm">{routeInfo.name}</h3>
          <div className="flex gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Route className="w-3 h-3" />
              {formatDistance(routeInfo.distance)}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatDuration(routeInfo.duration)}
            </span>
          </div>
        </div>
      )}

      {panelHeight !== "collapsed" && (
        <div
          className="overflow-y-auto flex-1"
          style={{
            maxHeight: panelHeight === "partial" ? "calc(35vh - 100px)" : "calc(60vh - 100px)",
          }}
        >
          <div className="divide-y">
            {routeInfo.instructions.map((instruction, index) => (
              <div
                key={index}
                className={`flex items-start gap-2 p-2 text-xs transition-colors ${
                  index === currentInstructionIndex && isNavigating
                    ? "bg-primary/10 border-l-2 border-l-primary"
                    : "hover:bg-muted/30"
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium flex-shrink-0 ${
                    index === currentInstructionIndex && isNavigating
                      ? "bg-primary text-primary-foreground"
                      : "bg-primary/10"
                  }`}
                >
                  {index + 1}
                </span>
                <span className="flex-1">{instruction.text}</span>
                <span className="text-muted-foreground whitespace-nowrap">
                  {instruction.distance > 0 ? formatDistance(instruction.distance) : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
