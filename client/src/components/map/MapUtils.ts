export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}min`;
  }
  return `${minutes} min`;
}

export function formatSpeed(metersPerSecond: number): string {
  const kmh = metersPerSecond * 3.6;
  return `${Math.round(kmh)} km/h`;
}

export function getNavigationCenter(
  lat: number, 
  lng: number, 
  headingDeg: number, 
  isNavigating: boolean
): [number, number] {
  if (!isNavigating) return [lat, lng];
  
  const offsetDistance = 0.002;
  const headingRad = (headingDeg * Math.PI) / 180;
  
  const offsetLat = lat + offsetDistance * Math.cos(headingRad);
  const offsetLng = lng + offsetDistance * Math.sin(headingRad) / Math.cos(lat * Math.PI / 180);
  
  return [offsetLat, offsetLng];
}

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const lambda1 = (lon1 * Math.PI) / 180;
  const lambda2 = (lon2 * Math.PI) / 180;

  const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);
  const theta = Math.atan2(y, x);

  return ((theta * 180) / Math.PI + 360) % 360;
}

export function getMapTileUrl(style: string): string {
  switch (style) {
    case "satellite":
      return "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
    case "terrain":
      return "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png";
    case "topo":
      return `https://tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey=${import.meta.env.VITE_THUNDERFOREST_API_KEY ?? ""}`;
    default:
      return "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  }
}

export function getTransportModeIcon(mode: string): string {
  switch (mode) {
    case "cycling-regular":
      return "bicycle";
    case "foot-walking":
      return "walking";
    default:
      return "car";
  }
}
