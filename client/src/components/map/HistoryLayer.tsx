import { Polyline } from "react-leaflet";
import type { LocationPoint } from "./MapTypes";

interface HistoryLayerProps {
  locationHistory: LocationPoint[];
  showHistory: boolean;
}

export function HistoryLayer({ locationHistory, showHistory }: HistoryLayerProps) {
  if (!showHistory || locationHistory.length < 2) return null;
  
  const positions = locationHistory.map(p => [p.latitude, p.longitude] as [number, number]);
  
  return (
    <Polyline
      positions={positions}
      pathOptions={{
        color: "#3b82f6",
        weight: 3,
        opacity: 0.6,
        dashArray: "5, 10",
      }}
    />
  );
}
