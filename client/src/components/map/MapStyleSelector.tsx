import { Button } from "@/components/ui/button";
import { Layers, Map as MapIcon, Mountain, Satellite } from "lucide-react";
import type { MapStyleType } from "./MapTypes";

interface MapStyleSelectorProps {
  currentStyle: MapStyleType;
  onStyleChange: (style: MapStyleType) => void;
  isOpen: boolean;
  onToggle: () => void;
}

export function MapStyleSelector({ currentStyle, onStyleChange, isOpen, onToggle }: MapStyleSelectorProps) {
  const styles: { type: MapStyleType; icon: typeof MapIcon; label: string }[] = [
    { type: "standard", icon: MapIcon, label: "Standard" },
    { type: "satellite", icon: Satellite, label: "Satellite" },
    { type: "terrain", icon: Mountain, label: "Terrain" },
  ];
  
  return (
    <div className="relative">
      <Button
        size="icon"
        variant="secondary"
        className="h-10 w-10"
        onClick={onToggle}
        data-testid="button-map-style"
      >
        <Layers className="w-4 h-4" />
      </Button>
      
      {isOpen && (
        <div className="absolute bottom-12 right-0 bg-card border rounded-lg shadow-lg p-1 flex flex-col gap-1 min-w-[120px]">
          {styles.map(({ type, icon: Icon, label }) => (
            <Button
              key={type}
              size="sm"
              variant={currentStyle === type ? "default" : "ghost"}
              className="justify-start gap-2 h-8"
              onClick={() => {
                onStyleChange(type);
                onToggle();
              }}
              data-testid={`button-map-style-${type}`}
            >
              <Icon className="w-3 h-3" />
              {label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export function getMapTileUrl(style: MapStyleType, isNightMode: boolean): string {
  switch (style) {
    case "satellite":
      return "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
    case "terrain":
      return "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png";
    case "standard":
    default:
      if (isNightMode) {
        return "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
      }
      return "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  }
}

export function getMapTileAttribution(style: MapStyleType): string {
  switch (style) {
    case "satellite":
      return "Tiles &copy; Esri";
    case "terrain":
      return "Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap";
    case "standard":
    default:
      return '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  }
}
