import { Circle, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import type { Geofence } from "./MapTypes";

const geofenceIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface GeofenceLayerProps {
  geofences: Geofence[];
  onDeleteGeofence?: (id: number) => void;
}

export function GeofenceLayer({ geofences, onDeleteGeofence }: GeofenceLayerProps) {
  return (
    <>
      {geofences.map((gf) => (
        <div key={gf.id}>
          <Circle
            center={[gf.latitude, gf.longitude]}
            radius={gf.radius}
            pathOptions={{
              color: gf.isActive ? "#22c55e" : "#9ca3af",
              fillColor: gf.isActive ? "#22c55e" : "#9ca3af",
              fillOpacity: 0.2,
              weight: 2,
            }}
          />
          <Marker position={[gf.latitude, gf.longitude]} icon={geofenceIcon}>
            <Popup>
              <div className="p-2 min-w-[150px]">
                <h4 className="font-semibold text-sm mb-1">{gf.name}</h4>
                <p className="text-xs text-muted-foreground mb-2">
                  Rayon: {gf.radius}m
                </p>
                <div className="flex gap-1 text-xs mb-2">
                  {gf.triggerOnEnter && (
                    <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded">Entrée</span>
                  )}
                  {gf.triggerOnExit && (
                    <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded">Sortie</span>
                  )}
                </div>
                {onDeleteGeofence && (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="w-full h-7 text-xs"
                    onClick={() => onDeleteGeofence(gf.id)}
                    data-testid={`button-delete-geofence-${gf.id}`}
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
                    Supprimer
                  </Button>
                )}
              </div>
            </Popup>
          </Marker>
        </div>
      ))}
    </>
  );
}
