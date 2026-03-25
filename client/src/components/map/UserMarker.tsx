import { Marker, Popup, Circle } from "react-leaflet";
import L from "leaflet";
import type { LocationPoint } from "./MapTypes";

const userIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface UserMarkerProps {
  location: LocationPoint;
  showAccuracyCircle?: boolean;
}

export function UserMarker({ location, showAccuracyCircle = true }: UserMarkerProps) {
  return (
    <>
      <Marker position={[location.latitude, location.longitude]} icon={userIcon}>
        <Popup>
          <div className="text-sm">
            <strong>Ma position</strong>
            <br />
            {location.accuracy && `Précision: ${Math.round(location.accuracy)}m`}
          </div>
        </Popup>
      </Marker>
      {showAccuracyCircle && location.accuracy && (
        <Circle
          center={[location.latitude, location.longitude]}
          radius={location.accuracy}
          pathOptions={{
            color: "#3b82f6",
            fillColor: "#3b82f6",
            fillOpacity: 0.1,
            weight: 1,
          }}
        />
      )}
    </>
  );
}
