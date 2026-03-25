export interface LocationPoint {
  latitude: number;
  longitude: number;
  accuracy?: number;
  recordedAt?: Date;
  address?: string;
}

export interface Geofence {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  triggerOnEnter: boolean;
  triggerOnExit: boolean;
  isActive: boolean;
}

export interface RouteInstruction {
  text: string;
  distance: number;
}

export interface RouteInfo {
  distance: number;
  duration: number;
  instructions: RouteInstruction[];
  name: string;
}

export interface ItineraryWaypoint {
  id?: string;
  name: string;
  latitude: number;
  longitude: number;
  order: number;
  visited?: boolean;
}

export interface SavedItinerary {
  id: number;
  name: string;
  createdAt: string;
  waypoints: ItineraryWaypoint[];
}

export interface POI {
  id: string;
  name: string;
  type: string;
  lat: number;
  lon: number;
  distance?: number;
  tags?: Record<string, string>;
}

export interface SafetyAlert {
  id: string;
  type: "radar" | "school" | "curve" | "accident";
  latitude: number;
  longitude: number;
  distance: number;
  message: string;
  severity: "info" | "warning" | "danger";
}

export interface TripStats {
  distanceTraveled: number;
  currentSpeed: number;
  avgSpeed: number;
  maxSpeed: number;
  duration: number;
  startTime: Date | null;
}

export type MapInteractionMode = "none" | "geofence" | "destination";
export type TransportMode = "driving-car" | "cycling-regular" | "foot-walking";
export type MapStyleType = "standard" | "satellite" | "terrain" | "topo";
export type InstructionsPanelHeight = "collapsed" | "partial" | "expanded";
