import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-routing-machine";
import "leaflet-routing-machine/dist/leaflet-routing-machine.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Navigation, MapPin, Circle as CircleIcon, Route, X, Plus, Crosshair, Clock, Car, Bike, PersonStanding, Search, Loader2, Save, FolderOpen, Star, Shuffle, GripVertical, Play, Square, AlertTriangle, ChevronUp, ChevronDown, Volume2, VolumeX, Layers, Compass, Map as MapIcon, Mountain, Satellite, Gauge, Camera, GraduationCap, CornerDownRight, Moon, Sun, RefreshCw, LocateFixed } from "lucide-react";
import { GPSKalmanFilter, haversineDistance, calculateBearing } from "@/lib/kalmanFilter";
import { SensorFusionEngine, calculateTurnAnnouncementDistance, shouldAnnounce, formatTurnAnnouncement } from "@/lib/sensorFusion";
import { NextTurnBanner } from "./map/NextTurnBanner";
import { NavigationDebugPanel, type NavigationDebugInfo } from "./map/NavigationDebugPanel";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

const userIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const destinationIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const geofenceIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const createDirectionalIcon = (heading: number, accuracy: number) => {
  const color = accuracy < 30 ? "#22c55e" : accuracy < 100 ? "#3b82f6" : "#ef4444";
  const svgIcon = `
    <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="0.3"/>
        </filter>
      </defs>
      <g transform="rotate(${heading}, 20, 20)" filter="url(#shadow)">
        <circle cx="20" cy="20" r="12" fill="${color}" stroke="white" stroke-width="2"/>
        <polygon points="20,6 26,22 20,18 14,22" fill="white"/>
      </g>
    </svg>
  `;
  return L.divIcon({
    className: "directional-marker",
    html: svgIcon,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
};

interface LocationPoint {
  latitude: number;
  longitude: number;
  accuracy?: number;
  recordedAt?: Date;
  address?: string;
}

interface Geofence {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  triggerOnEnter: boolean;
  triggerOnExit: boolean;
  isActive: boolean;
}

interface RouteInstruction {
  text: string;
  distance: number;
}

interface RouteInfo {
  distance: number;
  duration: number;
  instructions: RouteInstruction[];
  name: string;
}

type MapInteractionMode = "none" | "geofence" | "destination";

export interface InitialDestination {
  address: string;
  coordinates?: { lat: number; lng: number };
}

interface LocationMapProps {
  currentLocation: LocationPoint | null;
  locationHistory: LocationPoint[];
  geofences: Geofence[];
  onCreateGeofence?: (lat: number, lng: number, radius: number, name: string, triggerOn: string) => void;
  onDeleteGeofence?: (id: number) => void;
  isTracking: boolean;
  initialDestination?: InitialDestination | null;
  onDestinationCleared?: () => void;
  isOwner?: boolean;
}

function MapController({ center, zoom, followUser, heading, isNavigating, forceRecenterKey, speed }: { center: [number, number]; zoom: number; followUser: boolean; heading: number; isNavigating: boolean; forceRecenterKey?: number; speed?: number }) {
  const map = useMap();
  const prevCenterRef = useRef<[number, number]>([0, 0]);
  const initializedRef = useRef(false);
  const lastForceRecenterKeyRef = useRef(0);
  const lastZoomUpdateRef = useRef(0);
  
  // Calculate optimal zoom level based on speed (km/h)
  const getSpeedBasedZoom = (speedKmh: number): number => {
    if (speedKmh < 10) return 18;      // Walking/stationary: very close view
    if (speedKmh < 30) return 17;      // Slow urban: close view
    if (speedKmh < 50) return 16;      // Urban driving: normal view
    if (speedKmh < 80) return 15;      // Fast urban/suburban: wider view
    if (speedKmh < 110) return 14;     // Highway: wide view
    return 13;                          // Fast highway: very wide view
  };
  
  // Calculate offset center for navigation mode (show user position lower on screen to see more road ahead)
  const getNavigationCenter = (lat: number, lng: number, headingDeg: number): [number, number] => {
    if (!isNavigating) return [lat, lng];
    
    // Offset the center point forward in the direction of travel
    // This places the user position in the lower third of the screen
    const offsetDistance = 0.002; // ~200m offset at equator
    const headingRad = (headingDeg * Math.PI) / 180;
    
    // Move center point forward in heading direction
    const offsetLat = lat + offsetDistance * Math.cos(headingRad);
    const offsetLng = lng + offsetDistance * Math.sin(headingRad) / Math.cos(lat * Math.PI / 180);
    
    return [offsetLat, offsetLng];
  };
  
  // Auto-zoom based on speed during navigation
  useEffect(() => {
    if (!isNavigating || speed === undefined) return;
    
    const now = Date.now();
    if (now - lastZoomUpdateRef.current < 3000) return; // Only update zoom every 3 seconds
    
    const targetZoom = getSpeedBasedZoom(speed);
    const currentZoom = map.getZoom();
    
    // Only change zoom if difference is significant (avoid jittery zoom)
    if (Math.abs(targetZoom - currentZoom) >= 1) {
      map.setZoom(targetZoom, { animate: true });
      lastZoomUpdateRef.current = now;
    }
  }, [isNavigating, speed, map]);
  
  // Force recenter when button is clicked
  useEffect(() => {
    if (forceRecenterKey && forceRecenterKey !== lastForceRecenterKeyRef.current) {
      lastForceRecenterKeyRef.current = forceRecenterKey;
      if (center[0] !== 0 && center[1] !== 0) {
        map.setView(center, 16, { animate: true });
        prevCenterRef.current = center;
      }
    }
  }, [forceRecenterKey, center, map]);

  useEffect(() => {
    if (center[0] === 0 && center[1] === 0) return;
    
    if (!initializedRef.current) {
      map.setView(center, zoom);
      prevCenterRef.current = center;
      initializedRef.current = true;
      return;
    }
    
    if (!followUser) return;
    
    const prevLat = prevCenterRef.current[0];
    const prevLng = prevCenterRef.current[1];
    const latDiff = Math.abs(center[0] - prevLat);
    const lngDiff = Math.abs(center[1] - prevLng);
    
    const threshold = 0.0005;
    if (latDiff > threshold || lngDiff > threshold) {
      // Use offset center during navigation to show more road ahead
      const targetCenter = getNavigationCenter(center[0], center[1], heading);
      map.setView(targetCenter, map.getZoom(), { animate: true });
      prevCenterRef.current = center;
    }
  }, [center, zoom, map, followUser, heading, isNavigating]);
  
  // Rotate map based on heading during navigation
  useEffect(() => {
    const container = map.getContainer();
    if (isNavigating && heading !== 0) {
      // Rotate map so heading points up (direction of travel)
      // Scale up slightly to cover corners when rotated
      const scale = 1.42; // sqrt(2) to cover diagonal when rotated 45°
      container.style.transform = `rotate(${-heading}deg) scale(${scale})`;
      container.style.transition = "transform 0.5s ease-out";
    } else {
      // Reset to north-up when not navigating
      container.style.transform = "rotate(0deg) scale(1)";
      container.style.transition = "transform 0.3s ease-out";
    }
  }, [map, heading, isNavigating]);
  
  return null;
}

function MapClickHandler({ 
  mode,
  onGeofenceClick,
  onDestinationClick,
  onModeReset,
}: { 
  mode: MapInteractionMode;
  onGeofenceClick: (lat: number, lng: number) => void;
  onDestinationClick: (lat: number, lng: number) => void;
  onModeReset: () => void;
}) {
  useMapEvents({
    click(e) {
      if (mode === "geofence") {
        onGeofenceClick(e.latlng.lat, e.latlng.lng);
        onModeReset();
      } else if (mode === "destination") {
        onDestinationClick(e.latlng.lat, e.latlng.lng);
        onModeReset();
      }
    },
  });
  return null;
}

function RoutingMachine({ 
  startLat,
  startLng,
  endLat,
  endLng,
  profile,
  onRouteFound 
}: { 
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  profile: "driving" | "cycling" | "walking";
  onRouteFound: (info: RouteInfo) => void;
}) {
  const map = useMap();
  const routingControlRef = useRef<L.Routing.Control | null>(null);
  const prevParamsRef = useRef({ startLat: 0, startLng: 0, endLat: 0, endLng: 0, profile: "" });

  useEffect(() => {
    if (!map || startLat === 0 || endLat === 0) return;

    const prev = prevParamsRef.current;
    const paramsChanged = 
      prev.startLat !== startLat || 
      prev.startLng !== startLng || 
      prev.endLat !== endLat || 
      prev.endLng !== endLng || 
      prev.profile !== profile;

    if (!paramsChanged && routingControlRef.current) {
      return;
    }

    prevParamsRef.current = { startLat, startLng, endLat, endLng, profile };

    if (routingControlRef.current) {
      map.removeControl(routingControlRef.current);
      routingControlRef.current = null;
    }

    const profileMap: Record<string, string> = {
      driving: "car",
      cycling: "bike",
      walking: "foot",
    };

    const routingControl = L.Routing.control({
      waypoints: [L.latLng(startLat, startLng), L.latLng(endLat, endLng)],
      routeWhileDragging: false,
      showAlternatives: false,
      fitSelectedRoutes: true,
      show: false,
      addWaypoints: false,
      lineOptions: {
        styles: [{ color: "#6366f1", weight: 5, opacity: 0.8 }],
        extendToWaypoints: true,
        missingRouteTolerance: 0,
      },
      router: L.Routing.osrmv1({
        serviceUrl: "https://router.project-osrm.org/route/v1",
        profile: profileMap[profile],
        language: "fr",
      }),
      createMarker: () => null as any,
    } as any).addTo(map);

    routingControl.on("routesfound", (e: any) => {
      const routes = e.routes;
      if (routes && routes[0]) {
        const route = routes[0];
        onRouteFound({
          distance: route.summary.totalDistance,
          duration: route.summary.totalTime,
          name: route.name || "Itinéraire",
          instructions: route.instructions?.map((i: any) => ({
            text: i.text,
            distance: i.distance || 0,
          })) || [],
        });
      }
    });

    routingControlRef.current = routingControl;

    return () => {
      if (routingControlRef.current) {
        try {
          map.removeControl(routingControlRef.current);
        } catch (e) {}
        routingControlRef.current = null;
      }
    };
  }, [map, startLat, startLng, endLat, endLng, profile, onRouteFound]);

  return null;
}

export function LocationMap({
  currentLocation,
  locationHistory,
  geofences,
  onCreateGeofence,
  onDeleteGeofence,
  isTracking,
  initialDestination,
  onDestinationCleared,
  isOwner = false,
}: LocationMapProps) {
  const [interactionMode, setInteractionMode] = useState<MapInteractionMode>("none");
  const [pendingGeofence, setPendingGeofence] = useState<{ lat: number; lng: number } | null>(null);
  const [geofenceName, setGeofenceName] = useState("");
  const [geofenceRadius, setGeofenceRadius] = useState(100);
  const [geofenceTrigger, setGeofenceTrigger] = useState<string>("both");
  
  const [showRouting, setShowRouting] = useState(false);
  const [waypoints, setWaypoints] = useState<Array<{ lat: number; lng: number; label: string; address?: string }>>([]);
  const [routeProfile, setRouteProfile] = useState<"driving" | "cycling" | "walking">("driving");
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [showAddressInput, setShowAddressInput] = useState<string | null>(null);
  const [addressQuery, setAddressQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [activeWaypointIndex, setActiveWaypointIndex] = useState<number>(0);
  const [showHistory, setShowHistory] = useState(false);
  const [forceRecenterKey, setForceRecenterKey] = useState(0);
  
  const [isNavigating, setIsNavigating] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [routeName, setRouteName] = useState("");
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [proximityAlert, setProximityAlert] = useState<string | null>(null);
  const [navProgress, setNavProgress] = useState<{ percent: number; eta: string | null; distanceFromRoute: number }>({ percent: 0, eta: null, distanceFromRoute: 0 });
  const [currentSpeed, setCurrentSpeed] = useState<number>(0); // km/h
  const [lastPosition, setLastPosition] = useState<{ lat: number; lng: number; time: number } | null>(null);
  const [instructionsPanelHeight, setInstructionsPanelHeight] = useState<"collapsed" | "partial" | "expanded">("partial");
  const [currentInstructionIndex, setCurrentInstructionIndex] = useState(0);
  const [lastAnnouncedInstruction, setLastAnnouncedInstruction] = useState(-1);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [currentHeading, setCurrentHeading] = useState(0); // degrees from north
  const [mapStyle, setMapStyle] = useState<"standard" | "satellite" | "terrain">("standard");
  const [showMapStyleMenu, setShowMapStyleMenu] = useState(false);
  const panelDragRef = useRef<{ startY: number; startHeight: string } | null>(null);
  const [speedLimit, setSpeedLimit] = useState<number | null>(null);
  const [roadName, setRoadName] = useState<string | null>(null);
  const [isOverSpeed, setIsOverSpeed] = useState(false);
  const [dynamicEta, setDynamicEta] = useState<string | null>(null);
  const [remainingDistance, setRemainingDistance] = useState(0);
  const kalmanFilterRef = useRef(new GPSKalmanFilter());
  const sensorFusionRef = useRef(new SensorFusionEngine());
  const [filteredPosition, setFilteredPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [isGpsLost, setIsGpsLost] = useState(false);
  const [autoRecalculating, setAutoRecalculating] = useState(false);
  const lastRecalcTimeRef = useRef(0);
  const offRouteCountRef = useRef(0);
  const lastAnnouncedDistanceRef = useRef<number | null>(null);
  const [speedCameraAlert, setSpeedCameraAlert] = useState<{ distance: number } | null>(null);
  const [schoolZoneAlert, setSchoolZoneAlert] = useState<{ name: string; distance: number } | null>(null);
  const [curveWarning, setCurveWarning] = useState<{ recommendedSpeed: number } | null>(null);
  const [isNightMode, setIsNightMode] = useState(false);
  const lastAlertFetchRef = useRef(0);
  const [distanceToNextTurn, setDistanceToNextTurn] = useState(0);
  const lastProgressiveAnnouncementRef = useRef<{ distance: number; index: number; time: number } | null>(null);
  const previousInstructionIndexRef = useRef<number>(-1);
  const ANNOUNCEMENT_COOLDOWN_MS = 5000;
  
  const { toast } = useToast();
  
  // Auto night mode based on time
  useEffect(() => {
    const checkNightMode = () => {
      const hour = new Date().getHours();
      setIsNightMode(hour >= 20 || hour < 6);
    };
    checkNightMode();
    const interval = setInterval(checkNightMode, 60000);
    return () => clearInterval(interval);
  }, []);
  
  // Track processed destination to avoid re-triggering
  const processedDestinationRef = useRef<string | null>(null);
  
  // Handle initial destination from AI navigation request
  useEffect(() => {
    if (!initialDestination || !initialDestination.address) return;
    
    // Skip if we already processed this destination
    if (processedDestinationRef.current === initialDestination.address) return;
    processedDestinationRef.current = initialDestination.address;
    
    const setupNavigation = async () => {
      try {
        let destLat: number, destLng: number;
        let formattedAddress = initialDestination.address;
        
        // Use provided coordinates or geocode the address
        if (initialDestination.coordinates) {
          destLat = initialDestination.coordinates.lat;
          destLng = initialDestination.coordinates.lng;
        } else {
          // Geocode the address
          const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(initialDestination.address)}&limit=1&addressdetails=1`
          );
          const results = await response.json();
          
          if (!results || results.length === 0) {
            // Silently fail and clear destination - no disruptive toast when geocoding fails in background
            console.warn(`[LocationMap] Geocoding failed for: ${initialDestination.address}`);
            onDestinationCleared?.();
            return;
          }
          
          destLat = parseFloat(results[0].lat);
          destLng = parseFloat(results[0].lon);
          
          // Format address nicely
          if (results[0].display_name) {
            formattedAddress = results[0].display_name.split(",").slice(0, 3).join(", ");
          }
        }
        
        // Set up waypoints: current location (A) and destination (B)
        const newWaypoints: Array<{ lat: number; lng: number; label: string; address?: string }> = [];
        
        // Add current location as starting point
        if (currentLocation) {
          newWaypoints.push({
            lat: currentLocation.latitude,
            lng: currentLocation.longitude,
            label: "A",
            address: "Ma position actuelle",
          });
        }
        
        // Add destination
        newWaypoints.push({
          lat: destLat,
          lng: destLng,
          label: currentLocation ? "B" : "A",
          address: formattedAddress,
        });
        
        setWaypoints(newWaypoints);
        setShowRouting(true);
        
        toast({
          title: "Itinéraire prêt",
          description: `Destination: ${formattedAddress}`,
        });
      } catch (error) {
        // Silently fail - don't disrupt user with toast for background geocoding errors
        console.error("[LocationMap] Navigation setup failed:", error);
        onDestinationCleared?.();
      }
    };
    
    setupNavigation();
  }, [initialDestination, currentLocation, toast, onDestinationCleared]);
  
  // Clear destination when component unmounts or user cancels routing
  useEffect(() => {
    if (!showRouting && waypoints.length === 0 && processedDestinationRef.current) {
      processedDestinationRef.current = null;
      onDestinationCleared?.();
    }
  }, [showRouting, waypoints.length, onDestinationCleared]);
  
  // Auto-clear itinerary when geolocation tracking is disabled
  useEffect(() => {
    if (!isTracking && (waypoints.length > 0 || showRouting)) {
      console.log("[LocationMap] Geolocation disabled - clearing active itinerary");
      setWaypoints([]);
      setShowRouting(false);
      setRouteData(null);
      setIsNavigating(false);
      processedDestinationRef.current = null;
      onDestinationCleared?.();
    }
  }, [isTracking, waypoints.length, showRouting, onDestinationCleared]);
  
  // Map tile URLs for different styles - always light mode as per user preference
  const mapTiles = {
    standard: {
      url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    },
    satellite: {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attribution: '&copy; Esri, Maxar, Earthstar Geographics',
    },
    terrain: {
      url: "https://tiles.stadiamaps.com/tiles/outdoors/{z}/{x}/{y}{r}.png",
      attribution: '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    },
  };
  
  const queryClient = useQueryClient();
  
  const { data: savedRoutes = [] } = useQuery({
    queryKey: ["/api/v2/itinerary/routes"],
    enabled: showLoadDialog,
  });
  
  const { data: routePrefs } = useQuery({
    queryKey: ["/api/v2/itinerary/preferences"],
  });
  
  const { data: activeNav } = useQuery({
    queryKey: ["/api/v2/itinerary/navigation"],
    refetchInterval: isNavigating ? 2000 : false, // Check every 2 seconds during navigation
  });
  
  const saveRouteMutation = useMutation({
    mutationFn: async (data: { name: string; waypoints: any[]; profile: string }) => {
      const res = await apiRequest("POST", "/api/v2/itinerary/routes", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Itinéraire sauvegardé" });
      queryClient.invalidateQueries({ queryKey: ["/api/v2/itinerary/routes"] });
      setShowSaveDialog(false);
      setRouteName("");
    },
  });
  
  const optimizeMutation = useMutation({
    mutationFn: async (wps: any[]) => {
      const res = await apiRequest("POST", "/api/v2/itinerary/optimize", { waypoints: wps });
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.waypoints) {
        setWaypoints(data.waypoints);
        if (data.savings && data.savings.distance > 100) {
          toast({ 
            title: "Itinéraire optimisé", 
            description: `Économie: ${(data.savings.distance / 1000).toFixed(1)} km` 
          });
        }
      }
    },
  });
  
  const startNavMutation = useMutation({
    mutationFn: async (data: { waypoints: any[]; profile: string }) => {
      const res = await apiRequest("POST", "/api/v2/itinerary/navigation/start", data);
      return res.json();
    },
    onSuccess: () => {
      setIsNavigating(true);
      toast({ title: "Navigation démarrée" });
    },
  });
  
  const stopNavMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/v2/itinerary/navigation/stop");
      return res.json();
    },
    onSuccess: () => {
      setIsNavigating(false);
      sensorFusionRef.current.reset();
      toast({ title: "Navigation arrêtée" });
    },
  });
  
  const recalculateMutation = useMutation({
    mutationFn: async (pos: { latitude: number; longitude: number }) => {
      const res = await apiRequest("POST", "/api/v2/itinerary/navigation/recalculate", pos);
      return res.json();
    },
    onSuccess: (data: any) => {
      setAutoRecalculating(false);
      offRouteCountRef.current = 0;
      if (data.success) {
        announceInstruction("Itinéraire recalculé");
        toast({ title: "Itinéraire recalculé" });
      }
    },
    onError: () => {
      setAutoRecalculating(false);
    },
  });
  
  const checkPositionMutation = useMutation({
    mutationFn: async (pos: { latitude: number; longitude: number; currentSpeed: number }) => {
      const res = await apiRequest("POST", "/api/v2/itinerary/navigation/check-position", pos);
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.progressPercent !== undefined) {
        setNavProgress({
          percent: data.progressPercent,
          eta: data.dynamicEta || data.estimatedArrival,
          distanceFromRoute: data.distanceFromRoute || 0,
        });
      }
      
      if (data.speedLimit !== undefined) {
        setSpeedLimit(data.speedLimit);
      }
      if (data.roadName !== undefined) {
        setRoadName(data.roadName);
      }
      if (data.isOverSpeed !== undefined) {
        setIsOverSpeed(data.isOverSpeed);
      }
      if (data.dynamicEta !== undefined) {
        setDynamicEta(data.dynamicEta);
      }
      if (data.remainingDistance !== undefined) {
        setRemainingDistance(data.remainingDistance);
      }
      
      if (data.shouldAlert && data.nearWaypoint) {
        setProximityAlert(`Arrivée à ${data.nearWaypoint.address || data.nearWaypoint.label} dans ${Math.round(data.distanceToWaypoint)}m`);
        setTimeout(() => setProximityAlert(null), 5000);
      }
      
      if (data.isOffRoute && data.distanceFromRoute > 50) {
        offRouteCountRef.current++;
        
        const now = Date.now();
        const timeSinceLastRecalc = now - lastRecalcTimeRef.current;
        
        if (offRouteCountRef.current >= 3 && timeSinceLastRecalc > 30000 && !autoRecalculating && currentLocation) {
          setAutoRecalculating(true);
          lastRecalcTimeRef.current = now;
          announceInstruction("Recalcul de l'itinéraire en cours");
          recalculateMutation.mutate({
            latitude: currentLocation.latitude,
            longitude: currentLocation.longitude,
          });
        } else if (offRouteCountRef.current === 1) {
          announceInstruction(`Attention, vous êtes à ${Math.round(data.distanceFromRoute)} mètres de l'itinéraire`);
        }
      } else {
        offRouteCountRef.current = 0;
      }
    },
  });
  
  const handleOptimize = useCallback(() => {
    if (waypoints.length >= 3) {
      optimizeMutation.mutate(waypoints);
    }
  }, [waypoints, optimizeMutation]);
  
  const handleSaveRoute = useCallback(() => {
    if (routeName.trim() && waypoints.length >= 2) {
      saveRouteMutation.mutate({
        name: routeName.trim(),
        waypoints,
        profile: routeProfile,
      });
    }
  }, [routeName, waypoints, routeProfile, saveRouteMutation]);
  
  const handleLoadRoute = useCallback(async (routeId: number) => {
    try {
      const res = await fetch(`/api/v2/itinerary/routes/${routeId}`, { credentials: "include" });
      const data = await res.json();
      if (data.waypoints) {
        const wps = data.waypoints.map((wp: any) => ({
          lat: parseFloat(wp.latitude),
          lng: parseFloat(wp.longitude),
          label: wp.label,
          address: wp.address,
        }));
        setWaypoints(wps);
        setRouteProfile(data.profile || "driving");
        setShowLoadDialog(false);
        toast({ title: "Itinéraire chargé" });
      }
    } catch (e) {
      toast({ title: "Erreur", description: "Impossible de charger l'itinéraire", variant: "destructive" });
    }
  }, [toast]);
  
  const moveWaypoint = useCallback((fromIndex: number, direction: "up" | "down") => {
    const toIndex = direction === "up" ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= waypoints.length) return;
    
    const newWaypoints = [...waypoints];
    const [moved] = newWaypoints.splice(fromIndex, 1);
    newWaypoints.splice(toIndex, 0, moved);
    
    const relabeled = newWaypoints.map((wp, i) => ({
      ...wp,
      label: String.fromCharCode(65 + i),
    }));
    setWaypoints(relabeled);
  }, [waypoints]);
  
  const handleStartNavigation = useCallback(() => {
    // Navigation starts from current position to waypoint destinations
    if (currentLocation && waypoints.length >= 1) {
      const navWaypoints = [
        { lat: currentLocation.latitude, lng: currentLocation.longitude, label: "START", address: "Ma position actuelle" },
        ...waypoints.sort((a, b) => a.label.localeCompare(b.label))
      ];
      startNavMutation.mutate({ waypoints: navWaypoints, profile: routeProfile });
    }
  }, [waypoints, currentLocation, routeProfile, startNavMutation]);
  
  const handleStopNavigation = useCallback(() => {
    stopNavMutation.mutate();
  }, [stopNavMutation]);
  
  // Track GPS signal quality and timeout
  const lastGpsUpdateRef = useRef<number>(Date.now());
  const lastValidGpsRef = useRef<{ lat: number; lng: number; time: number } | null>(null);
  const rejectedJumpsRef = useRef<number>(0);
  
  // Apply Kalman filter to GPS position and calculate speed/heading
  // With aberrant jump detection (reject points >80m in <2s)
  useEffect(() => {
    if (isNavigating && currentLocation) {
      const now = Date.now();
      const accuracy = currentLocation.accuracy || 10;
      
      // Aberrant jump detection: reject points that jump too far too fast
      if (lastValidGpsRef.current) {
        const timeDiff = (now - lastValidGpsRef.current.time) / 1000; // seconds
        const distanceMeters = haversineDistance(
          lastValidGpsRef.current.lat, lastValidGpsRef.current.lng,
          currentLocation.latitude, currentLocation.longitude
        );
        
        // Calculate max plausible distance based on time (assuming max 150 km/h = 41.7 m/s)
        const maxPlausibleDistance = Math.max(80, timeDiff * 42); // At least 80m or speed-based
        
        // Reject if jump is too large for the time elapsed
        if (distanceMeters > maxPlausibleDistance && timeDiff < 3) {
          console.log(`[Nav] Rejected GPS jump: ${distanceMeters.toFixed(1)}m in ${timeDiff.toFixed(1)}s (max: ${maxPlausibleDistance.toFixed(1)}m)`);
          rejectedJumpsRef.current++;
          // Use predicted position from sensor fusion instead
          const predicted = sensorFusionRef.current.predictPosition((now - lastGpsUpdateRef.current));
          if (predicted) {
            setFilteredPosition({ lat: predicted.lat, lng: predicted.lng });
          }
          return; // Skip this GPS update
        }
      }
      
      // Valid GPS point - update refs and apply Kalman filter
      lastGpsUpdateRef.current = now;
      lastValidGpsRef.current = { lat: currentLocation.latitude, lng: currentLocation.longitude, time: now };
      setIsGpsLost(false);
      rejectedJumpsRef.current = 0;
      
      const filtered = kalmanFilterRef.current.filter(
        currentLocation.latitude,
        currentLocation.longitude,
        accuracy,
        now
      );
      
      setFilteredPosition({ lat: filtered.lat, lng: filtered.lng });
      
      const kalmanSpeed = kalmanFilterRef.current.getSpeed();
      if (kalmanSpeed < 200) {
        setCurrentSpeed(prev => prev * 0.3 + kalmanSpeed * 0.7);
      }
      
      sensorFusionRef.current.updateGps(
        filtered.lat, filtered.lng, kalmanSpeed, currentHeading, accuracy
      );
      
      if (lastPosition) {
        const distanceMeters = haversineDistance(
          lastPosition.lat, lastPosition.lng,
          filtered.lat, filtered.lng
        );
        
        if (distanceMeters > 3) {
          const bearing = calculateBearing(
            lastPosition.lat, lastPosition.lng,
            filtered.lat, filtered.lng
          );
          
          setCurrentHeading(prev => {
            let diff = bearing - prev;
            if (diff > 180) diff -= 360;
            if (diff < -180) diff += 360;
            return (prev + diff * 0.4 + 360) % 360;
          });
        }
      }
      
      setLastPosition({ lat: filtered.lat, lng: filtered.lng, time: now });
      
      const updatedSpeed = kalmanSpeed < 200 ? kalmanSpeed : currentSpeed;
      checkPositionMutation.mutate({
        latitude: filtered.lat,
        longitude: filtered.lng,
        currentSpeed: updatedSpeed,
      });
    } else if (!isNavigating) {
      setCurrentSpeed(0);
      setLastPosition(null);
      setCurrentHeading(0);
      setFilteredPosition(null);
      setIsGpsLost(false);
      kalmanFilterRef.current.reset();
      sensorFusionRef.current.reset();
      lastValidGpsRef.current = null;
      rejectedJumpsRef.current = 0;
      setSpeedLimit(null);
      setRoadName(null);
      setIsOverSpeed(false);
    }
  }, [isNavigating, currentLocation?.latitude, currentLocation?.longitude]);
  
  // Monitor GPS signal loss during navigation
  useEffect(() => {
    if (!isNavigating) return;
    
    const checkGpsSignal = setInterval(() => {
      const timeSinceLastGps = Date.now() - lastGpsUpdateRef.current;
      if (timeSinceLastGps > 5000) {
        setIsGpsLost(true);
        const predicted = sensorFusionRef.current.predictPosition(timeSinceLastGps);
        if (predicted && predicted.source === 'dead_reckoning') {
          setFilteredPosition({ lat: predicted.lat, lng: predicted.lng });
          setCurrentSpeed(predicted.speed);
        }
      }
    }, 1000);
    
    return () => clearInterval(checkGpsSignal);
  }, [isNavigating]);
  
  // Fetch navigation alerts (speed cameras, school zones, curves)
  useEffect(() => {
    if (!isNavigating || !currentLocation) return;
    
    const now = Date.now();
    if (now - lastAlertFetchRef.current < 10000) return;
    lastAlertFetchRef.current = now;
    
    const fetchAlerts = async () => {
      try {
        const res = await fetch(
          `/api/v2/itinerary/navigation/alerts?latitude=${currentLocation.latitude}&longitude=${currentLocation.longitude}&speed=${currentSpeed}&heading=${currentHeading}`,
          { credentials: "include" }
        );
        const data = await res.json();
        
        if (data.speedCameras?.length > 0) {
          const nearest = data.speedCameras[0];
          if (nearest.distance < 500) {
            if (!speedCameraAlert || Math.abs(speedCameraAlert.distance - nearest.distance) > 50) {
              setSpeedCameraAlert(nearest);
              if (nearest.distance < 300) {
                announceInstruction(`Attention, radar dans ${nearest.distance} mètres`);
              }
            }
          } else {
            setSpeedCameraAlert(null);
          }
        } else {
          setSpeedCameraAlert(null);
        }
        
        if (data.schoolZones?.length > 0) {
          const nearest = data.schoolZones[0];
          if (nearest.distance < 150) {
            if (!schoolZoneAlert) {
              setSchoolZoneAlert(nearest);
              announceInstruction(`Zone scolaire à proximité, ralentissez`);
            }
          } else {
            setSchoolZoneAlert(null);
          }
        } else {
          setSchoolZoneAlert(null);
        }
        
        if (data.curveWarning) {
          if (!curveWarning) {
            setCurveWarning(data.curveWarning);
            announceInstruction(`Attention virage, vitesse recommandée ${data.curveWarning.recommendedSpeed} kilomètres heure`);
          }
        } else {
          setCurveWarning(null);
        }
      } catch (e) {
        console.log("[Navigation] Alert fetch failed:", e);
      }
    };
    
    fetchAlerts();
  }, [isNavigating, currentLocation?.latitude, currentLocation?.longitude, currentSpeed, currentHeading]);

  // Voice announcement function
  const announceInstruction = useCallback((text: string) => {
    if (!voiceEnabled || !window.speechSynthesis) return;
    
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "fr-FR";
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    
    // Try to get a French voice
    const voices = window.speechSynthesis.getVoices();
    const frenchVoice = voices.find(v => v.lang.startsWith("fr"));
    if (frenchVoice) {
      utterance.voice = frenchVoice;
    }
    
    window.speechSynthesis.speak(utterance);
  }, [voiceEnabled]);

  // Track current instruction based on distance traveled with improved distance tracking
  useEffect(() => {
    if (!isNavigating || !routeInfo?.instructions?.length || !currentLocation) return;
    
    // Calculate cumulative distances for each instruction
    let cumulativeDistance = 0;
    const instructionDistances: number[] = [];
    for (const inst of routeInfo.instructions) {
      cumulativeDistance += inst.distance;
      instructionDistances.push(cumulativeDistance);
    }
    
    // Estimate how far we've traveled based on progress percentage
    const totalDistance = routeInfo.distance;
    const traveledDistance = (navProgress.percent / 100) * totalDistance;
    
    // Find current instruction
    let newIndex = 0;
    for (let i = 0; i < instructionDistances.length; i++) {
      if (traveledDistance < instructionDistances[i]) {
        newIndex = i;
        break;
      }
      newIndex = i;
    }
    
    // Update instruction index
    setCurrentInstructionIndex(newIndex);
    
    // Calculate distance to current turn point
    const previousCumulative = newIndex > 0 ? instructionDistances[newIndex - 1] : 0;
    const distToTurn = Math.max(0, instructionDistances[newIndex] - traveledDistance);
    setDistanceToNextTurn(Math.round(distToTurn));
    
    // Detect instruction change using ref (works even when no announcements made)
    const instructionChanged = previousInstructionIndexRef.current !== newIndex && 
                               previousInstructionIndexRef.current !== -1;
    
    if (instructionChanged) {
      // Clear progressive announcements when we move to a new instruction
      lastProgressiveAnnouncementRef.current = null;
      setLastAnnouncedInstruction(newIndex);
    }
    
    // Always update the previous instruction index ref
    previousInstructionIndexRef.current = newIndex;
    
    // Progressive voice announcements based on distance and speed
    const instruction = routeInfo.instructions[newIndex];
    if (!instruction) return;
    
    const announcementThresholds = calculateTurnAnnouncementDistance(currentSpeed);
    const progressiveDistances = [
      announcementThresholds * 3,  // Early warning (e.g., 600m at highway speed)
      announcementThresholds,       // Main announcement (e.g., 200m)
      50,                            // Imminent turn
      15                             // Now (final call, only once)
    ];
    
    const now = Date.now();
    const currentAnn = lastProgressiveAnnouncementRef.current;
    
    // Sort thresholds ascending (smallest first) to find the most specific threshold we've reached
    const uniqueThresholds = Array.from(new Set(progressiveDistances)).sort((a, b) => a - b);
    
    // Find the smallest threshold we're at or below (most urgent announcement)
    let matchedThreshold: number | null = null;
    for (const threshold of uniqueThresholds) {
      if (distToTurn <= threshold) {
        matchedThreshold = threshold;
        break;  // Found the smallest matching threshold
      }
    }
    
    // If we matched a threshold, check if we should announce
    if (matchedThreshold !== null) {
      // Skip if within cooldown (prevents spam when hovering at a threshold)
      const withinCooldown = currentAnn && (now - currentAnn.time) < ANNOUNCEMENT_COOLDOWN_MS;
      
      // Skip if already announced at this threshold for this instruction
      // Use exact match to ensure each threshold fires once
      const alreadyAnnounced = currentAnn && 
        currentAnn.index === newIndex && 
        currentAnn.distance === matchedThreshold;
      
      // Special handling for "now" (15m) threshold - only fire once per instruction
      const isNowThreshold = matchedThreshold === 15;
      const nowAlreadyFired = isNowThreshold && currentAnn && 
        currentAnn.index === newIndex && 
        currentAnn.distance <= 15;
      
      if (!withinCooldown && !alreadyAnnounced && !nowAlreadyFired) {
        let announcement: string;
        if (distToTurn <= 15) {
          announcement = instruction.text;
        } else if (distToTurn <= 50) {
          announcement = `Maintenant, ${instruction.text}`;
        } else {
          announcement = formatTurnAnnouncement(
            instruction.text, 
            distToTurn, 
            currentSpeed, 
            roadName
          );
        }
        
        announceInstruction(announcement);
        lastProgressiveAnnouncementRef.current = { distance: matchedThreshold, index: newIndex, time: now };
        
        // Trigger haptic feedback for imminent turns on supported devices
        if (distToTurn <= 100 && "vibrate" in navigator) {
          navigator.vibrate(distToTurn <= 30 ? [100, 50, 100] : [50]);
        }
      }
    }
  }, [isNavigating, navProgress.percent, routeInfo, currentLocation, currentSpeed, roadName, announceInstruction]);

  // Announce when navigation starts
  useEffect(() => {
    if (isNavigating && routeInfo?.instructions?.[0] && lastAnnouncedInstruction === -1) {
      const firstInst = routeInfo.instructions[0];
      announceInstruction(`Navigation démarrée. ${firstInst.text}`);
      setLastAnnouncedInstruction(0);
    }
  }, [isNavigating, routeInfo, lastAnnouncedInstruction, announceInstruction]);

  // Reset state when navigation stops, auto-expand panel when navigation starts
  useEffect(() => {
    if (!isNavigating) {
      setLastAnnouncedInstruction(-1);
      setCurrentInstructionIndex(0);
      setDistanceToNextTurn(0);
      lastProgressiveAnnouncementRef.current = null;
      previousInstructionIndexRef.current = -1;
    } else {
      // Auto-expand instructions panel when navigation starts
      setInstructionsPanelHeight("partial");
    }
  }, [isNavigating]);

  const defaultCenter: [number, number] = [43.2965, 5.3698];
  const center: [number, number] = currentLocation 
    ? [currentLocation.latitude, currentLocation.longitude] 
    : defaultCenter;

  const handleGeofenceClick = useCallback((lat: number, lng: number) => {
    setPendingGeofence({ lat, lng });
  }, []);

  const findNearestHouseNumber = useCallback(async (lat: number, lng: number, roadName: string): Promise<string | null> => {
    try {
      const radius = 50;
      const query = `
        [out:json][timeout:5];
        (
          node["addr:housenumber"]["addr:street"~"${roadName}",i](around:${radius},${lat},${lng});
        );
        out body;
      `;
      const response = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        body: query,
      });
      const data = await response.json();
      if (data.elements && data.elements.length > 0) {
        let closest = data.elements[0];
        let minDist = Infinity;
        for (const el of data.elements) {
          const dist = Math.sqrt(Math.pow(el.lat - lat, 2) + Math.pow(el.lon - lng, 2));
          if (dist < minDist) {
            minDist = dist;
            closest = el;
          }
        }
        return closest.tags?.["addr:housenumber"] || null;
      }
    } catch (e) {
      console.log("Overpass lookup failed:", e);
    }
    return null;
  }, []);

  const handleDestinationClick = useCallback(async (lat: number, lng: number) => {
    const existingLabels = waypoints.map(w => w.label);
    const allLabels = ["A", "B", "C", "D", "E", "F"];
    const nextLabel = allLabels.find(l => !existingLabels.includes(l)) || `${waypoints.length + 1}`;
    
    let address = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`
      );
      const result = await response.json();
      if (result && result.address) {
        const addr = result.address;
        const roadName = addr.road || addr.pedestrian || addr.footway || "";
        let houseNumber = addr.house_number;
        
        if (!houseNumber && roadName) {
          const nearestNumber = await findNearestHouseNumber(lat, lng, roadName);
          if (nearestNumber) {
            houseNumber = `~${nearestNumber}`;
          }
        }
        
        const parts: string[] = [];
        if (houseNumber) parts.push(houseNumber);
        if (roadName) parts.push(roadName);
        if (parts.length > 0) {
          const street = parts.join(" ");
          const area = addr.suburb || addr.neighbourhood || addr.quarter || addr.city_district || "";
          address = area ? `${street}, ${area}` : street;
        } else if (result.display_name) {
          address = result.display_name.split(",").slice(0, 2).join(", ");
        }
      }
    } catch (e) {}
    
    setWaypoints(prev => [...prev, { lat, lng, label: nextLabel, address }]);
  }, [waypoints, findNearestHouseNumber]);

  const resetMode = useCallback(() => {
    setInteractionMode("none");
  }, []);

  const confirmGeofence = useCallback(() => {
    if (pendingGeofence && geofenceName && onCreateGeofence) {
      onCreateGeofence(pendingGeofence.lat, pendingGeofence.lng, geofenceRadius, geofenceName, geofenceTrigger);
      setPendingGeofence(null);
      setGeofenceName("");
      setGeofenceRadius(100);
      setGeofenceTrigger("both");
    }
  }, [pendingGeofence, geofenceName, geofenceRadius, geofenceTrigger, onCreateGeofence]);

  const handleRouteFound = useCallback((info: RouteInfo) => {
    setRouteInfo(info);
  }, []);

  const searchAddress = useCallback(async (waypointLabel: string) => {
    if (!addressQuery.trim()) return;
    
    setIsSearching(true);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addressQuery)}&limit=1&addressdetails=1`
      );
      const results = await response.json();
      
      if (results && results.length > 0) {
        const { lat, lon, address: addr } = results[0];
        let formattedAddress = "";
        if (addr) {
          const roadName = addr.road || addr.pedestrian || addr.footway || "";
          let houseNumber = addr.house_number;
          
          if (!houseNumber) {
            const match = addressQuery.match(/^(\d+[a-zA-Z]?)\s+/);
            if (match) {
              houseNumber = match[1];
            }
          }
          
          if (!houseNumber && roadName) {
            const nearestNumber = await findNearestHouseNumber(parseFloat(lat), parseFloat(lon), roadName);
            if (nearestNumber) {
              houseNumber = `~${nearestNumber}`;
            }
          }
          
          const parts: string[] = [];
          if (houseNumber) parts.push(houseNumber);
          if (roadName) parts.push(roadName);
          if (parts.length > 0) {
            const street = parts.join(" ");
            const area = addr.suburb || addr.neighbourhood || addr.quarter || addr.city_district || "";
            formattedAddress = area ? `${street}, ${area}` : street;
          }
        }
        if (!formattedAddress && results[0].display_name) {
          formattedAddress = results[0].display_name.split(",").slice(0, 2).join(", ");
        }
        const existingIndex = waypoints.findIndex(w => w.label === waypointLabel);
        if (existingIndex >= 0) {
          setWaypoints(prev => prev.map((w, i) => 
            i === existingIndex ? { lat: parseFloat(lat), lng: parseFloat(lon), label: waypointLabel, address: formattedAddress } : w
          ));
        } else {
          setWaypoints(prev => [...prev, { lat: parseFloat(lat), lng: parseFloat(lon), label: waypointLabel, address: formattedAddress }]);
        }
        setShowAddressInput(null);
        setAddressQuery("");
      }
    } catch (error) {
      console.error("Address search failed:", error);
    } finally {
      setIsSearching(false);
    }
  }, [addressQuery, waypoints, findNearestHouseNumber]);

  const removeWaypoint = useCallback((label: string) => {
    setWaypoints(prev => prev.filter(w => w.label !== label));
  }, []);

  const formatDistance = (meters: number) => {
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(1)} km`;
    }
    return `${Math.round(meters)} m`;
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}min`;
    }
    return `${minutes} min`;
  };

  const historyPath = useMemo(() => 
    locationHistory
      .filter(p => p.latitude && p.longitude)
      .map(p => [p.latitude, p.longitude] as [number, number]),
    [locationHistory]
  );

  // Route: Current Position → A → B → C → D
  // Point A = starting point (can be current position or custom address)
  // Points B, C, D = destinations added via + button
  const allWaypoints = useMemo(() => {
    const sortedWaypoints = [...waypoints].sort((a, b) => a.label.localeCompare(b.label));
    
    // A is start point, B/C/D are destinations
    // If A is not set but we have current location, use current location as A
    const hasPointA = sortedWaypoints.some(w => w.label === "A");
    
    if (!hasPointA && currentLocation) {
      return [
        { lat: currentLocation.latitude, lng: currentLocation.longitude, label: "A", address: "Ma position actuelle" },
        ...sortedWaypoints
      ];
    }
    
    // If no current location, use first waypoint as start
    return sortedWaypoints;
  }, [currentLocation?.latitude, currentLocation?.longitude, waypoints]);

  const destination = waypoints.length > 0 ? [waypoints[waypoints.length - 1].lat, waypoints[waypoints.length - 1].lng] as [number, number] : null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap gap-2 p-2 border-b bg-background/95 backdrop-blur">
        <Button
          size="sm"
          variant={showHistory ? "default" : "outline"}
          onClick={() => setShowHistory(!showHistory)}
          data-testid="button-toggle-history"
        >
          <Clock className="w-4 h-4 mr-1" />
          Historique
        </Button>
        
        <Button
          size="sm"
          variant={interactionMode === "geofence" ? "default" : "outline"}
          onClick={() => {
            if (interactionMode === "geofence") {
              setInteractionMode("none");
            } else {
              setInteractionMode("geofence");
            }
          }}
          data-testid="button-create-geofence"
        >
          <CircleIcon className="w-4 h-4 mr-1" />
          {interactionMode === "geofence" ? "Annuler" : "Zone"}
        </Button>
        
        <Button
          size="sm"
          variant={showRouting ? "default" : "outline"}
          onClick={() => {
            setShowRouting(!showRouting);
            if (!showRouting) {
              setWaypoints([]);
              setRouteInfo(null);
              setInteractionMode("none");
            }
          }}
          data-testid="button-toggle-routing"
        >
          <Route className="w-4 h-4 mr-1" />
          Itinéraire
        </Button>
        
        {currentLocation && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setForceRecenterKey(prev => prev + 1);
              toast({ title: "Carte recentrée", description: "Position mise à jour" });
            }}
            data-testid="button-recenter-map"
          >
            <LocateFixed className="w-4 h-4" />
          </Button>
        )}
        
        {currentLocation && (
          <Badge variant="outline" className="ml-auto">
            <Crosshair className="w-3 h-3 mr-1" />
            {currentLocation.accuracy ? `±${Math.round(currentLocation.accuracy)}m` : "GPS"}
          </Badge>
        )}
      </div>

      {interactionMode === "geofence" && (
        <div className="p-2 bg-primary/10 text-sm text-center">
          Cliquez sur la carte pour placer une zone de géofencing
        </div>
      )}

      {interactionMode === "destination" && (
        <div className="p-2 bg-blue-500/10 text-sm text-center">
          Cliquez sur la carte pour définir votre destination
        </div>
      )}

      {showRouting && (
        <div className="p-2 border-b space-y-2">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={routeProfile === "driving" ? "default" : "outline"}
              onClick={() => setRouteProfile("driving")}
              data-testid="button-profile-driving"
            >
              <Car className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant={routeProfile === "cycling" ? "default" : "outline"}
              onClick={() => setRouteProfile("cycling")}
              data-testid="button-profile-cycling"
            >
              <Bike className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant={routeProfile === "walking" ? "default" : "outline"}
              onClick={() => setRouteProfile("walking")}
              data-testid="button-profile-walking"
            >
              <PersonStanding className="w-4 h-4" />
            </Button>
          </div>

          <div className="space-y-2">
            {/* Point A = Starting point (editable) */}
            {(() => {
              const wpA = waypoints.find(w => w.label === "A");
              const isActiveA = showAddressInput === "A";
              const hasCustomStartPoint = wpA !== undefined;
              
              return (
                <div className="flex items-center gap-2">
                  <Badge variant="default" className="w-6 h-6 flex items-center justify-center p-0">
                    A
                  </Badge>
                  {isActiveA ? (
                    <>
                      <Input
                        placeholder="Point de départ (adresse)..."
                        value={addressQuery}
                        onChange={(e) => setAddressQuery(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && searchAddress("A")}
                        className="flex-1"
                        autoFocus
                        data-testid="input-address-A"
                      />
                      <Button
                        size="sm"
                        onClick={() => searchAddress("A")}
                        disabled={isSearching || !addressQuery.trim()}
                        data-testid="button-search-A"
                      >
                        {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setShowAddressInput(null); setAddressQuery(""); }}
                        data-testid="button-cancel-A"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 justify-start"
                        onClick={() => setShowAddressInput("A")}
                        data-testid="button-set-address-A"
                      >
                        {wpA?.address ? wpA.address : 
                         wpA ? `${wpA.lat.toFixed(4)}, ${wpA.lng.toFixed(4)}` :
                         currentLocation ? "Ma position actuelle" : "Définir point de départ"}
                      </Button>
                      {currentLocation && !hasCustomStartPoint && (
                        <Badge variant="secondary" className="text-xs">
                          <Navigation className="w-3 h-3 mr-1" />
                          GPS
                        </Badge>
                      )}
                      {hasCustomStartPoint && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => removeWaypoint("A")}
                          title="Revenir à ma position"
                          data-testid="button-remove-A"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      )}
                      {/* + button to add destination B */}
                      {!waypoints.find(w => w.label === "B") && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setShowAddressInput("B")}
                          data-testid="button-add-waypoint"
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              );
            })()}
            
            {/* Destination waypoints B, C, D */}
            {["B", "C", "D"].filter((label) => {
              const wp = waypoints.find(w => w.label === label);
              return wp !== undefined || showAddressInput === label;
            }).map((label) => {
              const wp = waypoints.find(w => w.label === label);
              const isActive = showAddressInput === label;
              const isLastDestination = label === ["B", "C", "D"].filter(l => 
                waypoints.find(w => w.label === l) || showAddressInput === l
              ).pop();
              const nextLabel = String.fromCharCode(label.charCodeAt(0) + 1);
              const canAddMore = nextLabel <= "D" && !waypoints.find(w => w.label === nextLabel);
              
              return (
                <div key={label} className="flex items-center gap-2">
                  <Badge variant="outline" className="w-6 h-6 flex items-center justify-center p-0">
                    {label}
                  </Badge>
                  {isActive ? (
                    <>
                      <Input
                        placeholder={`Destination ${label}...`}
                        value={addressQuery}
                        onChange={(e) => setAddressQuery(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && searchAddress(label)}
                        className="flex-1"
                        autoFocus
                        data-testid={`input-address-${label}`}
                      />
                      <Button
                        size="sm"
                        onClick={() => searchAddress(label)}
                        disabled={isSearching || !addressQuery.trim()}
                        data-testid={`button-search-${label}`}
                      >
                        {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setShowAddressInput(null); setAddressQuery(""); }}
                        data-testid={`button-cancel-${label}`}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 justify-start"
                        onClick={() => setShowAddressInput(label)}
                        data-testid={`button-set-address-${label}`}
                      >
                        {wp?.address ? wp.address : 
                         wp ? `${wp.lat.toFixed(4)}, ${wp.lng.toFixed(4)}` : 
                         `Définir destination ${label}`}
                      </Button>
                      <Button
                        size="sm"
                        variant={interactionMode === "destination" ? "default" : "outline"}
                        onClick={() => {
                          if (interactionMode === "destination") {
                            setInteractionMode("none");
                          } else {
                            setInteractionMode("destination");
                          }
                        }}
                        data-testid={`button-click-map-${label}`}
                      >
                        <Crosshair className="w-4 h-4" />
                      </Button>
                      {/* + button to add next destination */}
                      {isLastDestination && canAddMore && wp && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setShowAddressInput(nextLabel)}
                          data-testid={`button-add-waypoint-${nextLabel}`}
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                      )}
                      {wp && (
                        <div className="flex gap-0.5">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => {
                              const idx = waypoints.findIndex(w => w.label === label);
                              const destWaypoints = waypoints.filter(w => w.label !== "A");
                              const destIdx = destWaypoints.findIndex(w => w.label === label);
                              if (destIdx > 0) moveWaypoint(idx, "up");
                            }}
                            disabled={waypoints.filter(w => w.label !== "A").findIndex(w => w.label === label) === 0}
                            data-testid={`button-up-${label}`}
                          >
                            <ChevronUp className="w-3 h-3" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => {
                              const idx = waypoints.findIndex(w => w.label === label);
                              const destWaypoints = waypoints.filter(w => w.label !== "A");
                              const destIdx = destWaypoints.findIndex(w => w.label === label);
                              if (destIdx < destWaypoints.length - 1) moveWaypoint(idx, "down");
                            }}
                            disabled={waypoints.filter(w => w.label !== "A").findIndex(w => w.label === label) === waypoints.filter(w => w.label !== "A").length - 1}
                            data-testid={`button-down-${label}`}
                          >
                            <ChevronDown className="w-3 h-3" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => removeWaypoint(label)}
                            data-testid={`button-remove-${label}`}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
          
          <div className="flex flex-wrap gap-2">
            {waypoints.length >= 3 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleOptimize}
                disabled={optimizeMutation.isPending}
                data-testid="button-optimize-route"
              >
                {optimizeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shuffle className="w-4 h-4 mr-1" />}
                Optimiser
              </Button>
            )}
            
            <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={waypoints.length < 2} data-testid="button-save-route">
                  <Save className="w-4 h-4 mr-1" />
                  Sauvegarder
                </Button>
              </DialogTrigger>
              <DialogContent aria-describedby={undefined}>
                <DialogHeader>
                  <DialogTitle>Sauvegarder l'itinéraire</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <Input
                    placeholder="Nom de l'itinéraire..."
                    value={routeName}
                    onChange={(e) => setRouteName(e.target.value)}
                    data-testid="input-route-name"
                  />
                  <Button onClick={handleSaveRoute} disabled={!routeName.trim() || saveRouteMutation.isPending} data-testid="button-confirm-save">
                    {saveRouteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
                    Sauvegarder
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
            
            <Dialog open={showLoadDialog} onOpenChange={setShowLoadDialog}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" data-testid="button-load-route">
                  <FolderOpen className="w-4 h-4 mr-1" />
                  Charger
                </Button>
              </DialogTrigger>
              <DialogContent aria-describedby={undefined}>
                <DialogHeader>
                  <DialogTitle>Itinéraires sauvegardés</DialogTitle>
                </DialogHeader>
                <ScrollArea className="h-64">
                  {Array.isArray(savedRoutes) && savedRoutes.length > 0 ? (
                    <div className="space-y-2">
                      {savedRoutes.map((route: any) => (
                        <Card key={route.id} className="cursor-pointer hover-elevate" onClick={() => handleLoadRoute(route.id)}>
                          <CardContent className="p-3 flex items-center justify-between">
                            <div>
                              <div className="font-medium flex items-center gap-1">
                                {route.isFavorite && <Star className="w-3 h-3 text-yellow-500" />}
                                {route.name}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {route.profile === "driving" ? "Voiture" : route.profile === "cycling" ? "Vélo" : "À pied"}
                              </div>
                            </div>
                            <Badge variant="outline">{route.usageCount || 0}x</Badge>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center text-muted-foreground py-8">
                      Aucun itinéraire sauvegardé
                    </div>
                  )}
                </ScrollArea>
              </DialogContent>
            </Dialog>
            
            {!isNavigating ? (
              <Button
                size="sm"
                onClick={handleStartNavigation}
                disabled={waypoints.length < 1 || startNavMutation.isPending}
                data-testid="button-start-navigation"
              >
                {startNavMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 mr-1" />}
                Démarrer
              </Button>
            ) : (
              <Button
                size="sm"
                variant="destructive"
                onClick={handleStopNavigation}
                disabled={stopNavMutation.isPending}
                data-testid="button-stop-navigation"
              >
                {stopNavMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4 mr-1" />}
                Arrêter
              </Button>
            )}
          </div>
          
          {routeInfo && (
            <Card>
              <CardContent className="p-2">
                <div className="flex gap-4 text-sm">
                  <span className="flex items-center gap-1">
                    <Route className="w-4 h-4" />
                    {formatDistance(routeInfo.distance)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    {formatDuration(routeInfo.duration)}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
      
      {proximityAlert && (
        <div className="p-2 bg-green-500/20 border-b border-green-500/30 text-sm text-center flex items-center justify-center gap-2">
          <AlertTriangle className="w-4 h-4 text-green-600" />
          {proximityAlert}
        </div>
      )}

      {pendingGeofence && (
        <Card className="absolute z-[1000] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <CircleIcon className="w-4 h-4" />
              Nouvelle zone
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="Nom de la zone"
              value={geofenceName}
              onChange={(e) => setGeofenceName(e.target.value)}
              data-testid="input-geofence-name"
            />
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={geofenceRadius}
                onChange={(e) => setGeofenceRadius(Number(e.target.value))}
                className="w-24"
                data-testid="input-geofence-radius"
              />
              <span className="text-sm text-muted-foreground">mètres</span>
            </div>
            <div>
              <Label className="text-xs">Déclencher à</Label>
              <Select value={geofenceTrigger} onValueChange={setGeofenceTrigger}>
                <SelectTrigger data-testid="select-geofence-trigger-map">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="enter">Entrée</SelectItem>
                  <SelectItem value="exit">Sortie</SelectItem>
                  <SelectItem value="both">Les deux</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={confirmGeofence} disabled={!geofenceName} data-testid="button-confirm-geofence">
                <Plus className="w-4 h-4 mr-1" />
                Créer
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPendingGeofence(null)} data-testid="button-cancel-geofence">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex-1 flex flex-col">
        {/* Map on TOP - takes most of the space */}
        <div className={`flex-1 relative overflow-hidden ${routeInfo ? "min-h-[40vh]" : ""}`}>
        <MapContainer
          center={center}
          zoom={15}
          style={{ height: "100%", width: "100%" }}
          className="z-0"
        >
          <TileLayer
            key={mapStyle}
            attribution={mapTiles[mapStyle].attribution}
            url={mapTiles[mapStyle].url}
          />
          
          <MapController center={center} zoom={15} followUser={isTracking || isNavigating} heading={currentHeading} isNavigating={isNavigating} forceRecenterKey={forceRecenterKey} speed={currentSpeed} />
          
          <MapClickHandler
            mode={interactionMode}
            onGeofenceClick={handleGeofenceClick}
            onDestinationClick={handleDestinationClick}
            onModeReset={resetMode}
          />

          {currentLocation && (
            <>
              <Marker 
                position={[currentLocation.latitude, currentLocation.longitude]} 
                icon={isNavigating ? createDirectionalIcon(currentHeading, currentLocation.accuracy || 100) : userIcon}
              >
                <Popup>
                  <div className="text-sm">
                    <strong>Ma position</strong>
                    {currentLocation.accuracy && (
                      <div>Précision: ±{Math.round(currentLocation.accuracy)}m</div>
                    )}
                    {currentLocation.address && <div>{currentLocation.address}</div>}
                  </div>
                </Popup>
              </Marker>
              {currentLocation.accuracy && (
                <Circle
                  center={[currentLocation.latitude, currentLocation.longitude]}
                  radius={currentLocation.accuracy}
                  pathOptions={{ 
                    color: currentLocation.accuracy < 30 ? "#22c55e" : currentLocation.accuracy < 100 ? "#eab308" : "#ef4444",
                    fillColor: currentLocation.accuracy < 30 ? "#22c55e" : currentLocation.accuracy < 100 ? "#eab308" : "#ef4444",
                    fillOpacity: 0.12,
                    weight: 2
                  }}
                />
              )}
            </>
          )}

          {showHistory && historyPath.length > 1 && (
            <Polyline
              positions={historyPath}
              pathOptions={{ color: "#8b5cf6", weight: 3, opacity: 0.7, dashArray: "5, 10" }}
            />
          )}

          {geofences.map((gf) => (
            <Circle
              key={gf.id}
              center={[gf.latitude, gf.longitude]}
              radius={gf.radius}
              pathOptions={{
                color: gf.isActive ? "#22c55e" : "#6b7280",
                fillColor: gf.isActive ? "#22c55e" : "#6b7280",
                fillOpacity: 0.2,
              }}
            >
              <Popup>
                <div className="text-sm space-y-1">
                  <strong>{gf.name}</strong>
                  <div>Rayon: {gf.radius}m</div>
                  <div className="flex gap-1">
                    {gf.triggerOnEnter && <Badge variant="outline">Entrée</Badge>}
                    {gf.triggerOnExit && <Badge variant="outline">Sortie</Badge>}
                  </div>
                  {onDeleteGeofence && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => onDeleteGeofence(gf.id)}
                      className="mt-2"
                      data-testid={`button-delete-geofence-${gf.id}`}
                    >
                      Supprimer
                    </Button>
                  )}
                </div>
              </Popup>
            </Circle>
          ))}

          {geofences.map((gf) => (
            <Marker key={`marker-${gf.id}`} position={[gf.latitude, gf.longitude]} icon={geofenceIcon}>
              <Popup>{gf.name}</Popup>
            </Marker>
          ))}

          {destination && (
            <Marker position={destination} icon={destinationIcon}>
              <Popup>Destination</Popup>
            </Marker>
          )}

          {showRouting && allWaypoints.length >= 2 && (
            <RoutingMachine
              startLat={allWaypoints[0].lat}
              startLng={allWaypoints[0].lng}
              endLat={allWaypoints[allWaypoints.length - 1].lat}
              endLng={allWaypoints[allWaypoints.length - 1].lng}
              profile={routeProfile}
              onRouteFound={handleRouteFound}
            />
          )}
        </MapContainer>
        
        {/* Navigation Debug Panel - Owner only */}
        <NavigationDebugPanel
          isOwner={isOwner}
          debugInfo={{
            lat: currentLocation?.latitude ?? null,
            lng: currentLocation?.longitude ?? null,
            filteredLat: filteredPosition?.lat ?? null,
            filteredLng: filteredPosition?.lng ?? null,
            accuracy: currentLocation?.accuracy ?? null,
            heading: currentHeading,
            speed: currentSpeed,
            distanceFromRoute: navProgress.distanceFromRoute,
            isGpsLost,
            isNavigating,
            recalculating: autoRecalculating,
            offRouteCount: offRouteCountRef.current,
            rejectedJumps: rejectedJumpsRef.current,
            lastEvent: "",
          }}
        />
        
        {/* Map controls overlay */}
        <div className="absolute top-2 right-2 z-[1000] flex flex-col gap-2">
          {/* Compass indicator */}
          <div 
            className="w-10 h-10 bg-background/90 backdrop-blur-sm rounded-full flex items-center justify-center shadow-lg border"
            style={{ transform: `rotate(${-currentHeading}deg)`, transition: "transform 0.3s ease-out" }}
          >
            <div className="relative w-6 h-6">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[12px] border-b-red-500" />
              </div>
              <div className="absolute inset-0 flex items-center justify-center mt-3">
                <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[12px] border-t-muted-foreground/50" />
              </div>
              <span className="absolute -top-1 left-1/2 -translate-x-1/2 text-[8px] font-bold text-red-500">N</span>
            </div>
          </div>
          
          {/* Map style switcher */}
          <div className="relative">
            <Button
              size="icon"
              variant="secondary"
              className="w-10 h-10 bg-background/90 backdrop-blur-sm shadow-lg"
              onClick={() => setShowMapStyleMenu(!showMapStyleMenu)}
              data-testid="button-map-style"
            >
              <Layers className="w-4 h-4" />
            </Button>
            
            {showMapStyleMenu && (
              <div className="absolute right-12 top-0 bg-background/95 backdrop-blur-sm rounded-lg shadow-lg p-1 flex gap-1">
                <Button
                  size="icon"
                  variant={mapStyle === "standard" ? "default" : "ghost"}
                  className="w-9 h-9"
                  onClick={() => { setMapStyle("standard"); setShowMapStyleMenu(false); }}
                  data-testid="button-map-standard"
                >
                  <MapIcon className="w-4 h-4" />
                </Button>
                <Button
                  size="icon"
                  variant={mapStyle === "satellite" ? "default" : "ghost"}
                  className="w-9 h-9"
                  onClick={() => { setMapStyle("satellite"); setShowMapStyleMenu(false); }}
                  data-testid="button-map-satellite"
                >
                  <Satellite className="w-4 h-4" />
                </Button>
                <Button
                  size="icon"
                  variant={mapStyle === "terrain" ? "default" : "ghost"}
                  className="w-9 h-9"
                  onClick={() => { setMapStyle("terrain"); setShowMapStyleMenu(false); }}
                  data-testid="button-map-terrain"
                >
                  <Mountain className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
        
        {/* Scale bar */}
        <div className="absolute bottom-2 left-2 z-[1000] bg-background/80 backdrop-blur-sm px-2 py-1 rounded text-[10px] text-muted-foreground border">
          <div className="flex items-center gap-1">
            <div className="w-12 h-0.5 bg-foreground" />
            <span>100m</span>
          </div>
        </div>
        
        {isTracking && !isNavigating && (
          <div className="absolute bottom-12 left-2 z-[1000] flex flex-col gap-1">
            <Badge className="bg-green-500 animate-pulse">
              <Navigation className="w-3 h-3 mr-1" />
              Suivi actif
            </Badge>
            {currentLocation?.accuracy && (
              <Badge 
                className={`${
                  currentLocation.accuracy < 30 ? "bg-green-500" : 
                  currentLocation.accuracy < 100 ? "bg-yellow-500" : 
                  "bg-red-500"
                }`}
                data-testid="badge-gps-quality"
              >
                <Gauge className="w-3 h-3 mr-1" />
                {currentLocation.accuracy < 30 ? "GPS Précis" : 
                 currentLocation.accuracy < 100 ? "GPS Moyen" : 
                 "GPS Faible"} (±{Math.round(currentLocation.accuracy)}m)
              </Badge>
            )}
          </div>
        )}
        
        {isNavigating && routeInfo?.instructions?.[currentInstructionIndex] && (
          <div className="absolute top-2 left-2 right-2 z-[1000] pointer-events-auto">
            <NextTurnBanner
              instruction={routeInfo.instructions[currentInstructionIndex].text}
              distanceMeters={distanceToNextTurn}
              isLast={currentInstructionIndex === routeInfo.instructions.length - 1}
            />
          </div>
        )}
        
        {isNavigating && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] flex gap-2">
            {/* Speed display */}
            <Card className="bg-background/95 backdrop-blur-sm">
              <CardContent className="p-3 flex flex-col items-center justify-center min-w-[80px]">
                <div className="text-2xl font-bold tabular-nums">
                  {Math.round(currentSpeed)}
                </div>
                <div className="text-xs text-muted-foreground">km/h</div>
              </CardContent>
            </Card>
            
            {/* Speed limit indicator */}
            <div className="flex flex-col items-center justify-center">
              <div className={`w-12 h-12 rounded-full border-4 ${isOverSpeed ? "border-red-600 animate-pulse" : "border-red-500"} bg-white flex items-center justify-center`}>
                <span className={`font-bold text-sm ${isOverSpeed ? "text-red-600" : "text-black"}`}>
                  {speedLimit !== null ? speedLimit : (routeProfile === "walking" ? "—" : routeProfile === "cycling" ? "30" : "50")}
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground mt-0.5 truncate max-w-[60px]">
                {roadName || "Limite"}
              </span>
            </div>
            
            {/* Progress card */}
            <Card className="bg-background/95 backdrop-blur-sm">
              <CardContent className="p-3 space-y-1.5 min-w-[140px]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-medium">
                    <Navigation className="w-3 h-3 text-primary" />
                    Navigation
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => setVoiceEnabled(!voiceEnabled)}
                    data-testid="button-toggle-voice"
                  >
                    {voiceEnabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3 text-muted-foreground" />}
                  </Button>
                </div>
                <div className="w-full bg-muted rounded-full h-1.5">
                  <div 
                    className="bg-primary h-1.5 rounded-full transition-all duration-300" 
                    style={{ width: `${navProgress.percent}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>{remainingDistance > 1000 ? `${(remainingDistance / 1000).toFixed(1)} km` : `${remainingDistance} m`}</span>
                  {(dynamicEta || navProgress.eta) && <span>ETA {dynamicEta || navProgress.eta}</span>}
                </div>
                {navProgress.distanceFromRoute > 30 && (
                  <div className="text-[10px] text-amber-500 flex items-center gap-1">
                    <AlertTriangle className="w-2.5 h-2.5" />
                    {autoRecalculating ? "Recalcul..." : `${navProgress.distanceFromRoute}m hors route`}
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
            
            {/* Night mode toggle */}
            <Button
              size="icon"
              variant="secondary"
              className="h-10 w-10"
              onClick={() => setIsNightMode(!isNightMode)}
              data-testid="button-toggle-night-mode"
            >
              {isNightMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
          </div>
        )}
        </div>
        
        {/* Slidable Instructions panel BELOW the map */}
        {routeInfo && (
          <div 
            className={`border-t bg-card transition-all duration-300 ease-out ${
              instructionsPanelHeight === "collapsed" ? "h-14" : 
              instructionsPanelHeight === "partial" ? "h-[35vh]" : "h-[60vh]"
            }`}
            data-testid="route-instructions-panel"
          >
            {/* Drag handle */}
            <div 
              className="flex flex-col items-center py-1 cursor-grab active:cursor-grabbing touch-none select-none"
              onTouchStart={(e) => {
                const touch = e.touches[0];
                panelDragRef.current = { startY: touch.clientY, startHeight: instructionsPanelHeight };
              }}
              onTouchMove={(e) => {
                if (!panelDragRef.current) return;
                const touch = e.touches[0];
                const deltaY = panelDragRef.current.startY - touch.clientY;
                
                if (deltaY > 50 && panelDragRef.current.startHeight === "collapsed") {
                  setInstructionsPanelHeight("partial");
                } else if (deltaY > 50 && panelDragRef.current.startHeight === "partial") {
                  setInstructionsPanelHeight("expanded");
                } else if (deltaY < -50 && panelDragRef.current.startHeight === "expanded") {
                  setInstructionsPanelHeight("partial");
                } else if (deltaY < -50 && panelDragRef.current.startHeight === "partial") {
                  setInstructionsPanelHeight("collapsed");
                }
              }}
              onTouchEnd={() => { panelDragRef.current = null; }}
              onClick={() => {
                setInstructionsPanelHeight(prev => 
                  prev === "collapsed" ? "partial" : 
                  prev === "partial" ? "expanded" : "collapsed"
                );
              }}
            >
              <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
                {instructionsPanelHeight === "collapsed" ? (
                  <><ChevronUp className="w-3 h-3" /> Glisser pour voir les instructions</>
                ) : instructionsPanelHeight === "expanded" ? (
                  <><ChevronDown className="w-3 h-3" /> Réduire</>
                ) : (
                  <><ChevronUp className="w-3 h-3" /> Agrandir</>
                )}
              </div>
            </div>
            
            {/* Current instruction highlight (always visible) */}
            {isNavigating && routeInfo.instructions[currentInstructionIndex] && (
              <div className="px-3 pb-2 border-b bg-primary/5">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold">
                    {currentInstructionIndex + 1}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-sm">{routeInfo.instructions[currentInstructionIndex].text}</div>
                    <div className="text-xs text-muted-foreground">
                      {routeInfo.instructions[currentInstructionIndex].distance > 0 
                        ? formatDistance(routeInfo.instructions[currentInstructionIndex].distance)
                        : "Arrivée"}
                    </div>
                  </div>
                  <Button 
                    size="icon" 
                    variant="ghost" 
                    className="h-8 w-8"
                    onClick={() => {
                      if (routeInfo.instructions[currentInstructionIndex]) {
                        announceInstruction(routeInfo.instructions[currentInstructionIndex].text);
                      }
                    }}
                    data-testid="button-repeat-instruction"
                  >
                    <Navigation className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
            
            {/* Header with route info */}
            {instructionsPanelHeight !== "collapsed" && (
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
            
            {/* Scrollable instructions list */}
            {instructionsPanelHeight !== "collapsed" && (
              <div className="overflow-y-auto flex-1" style={{ maxHeight: instructionsPanelHeight === "partial" ? "calc(35vh - 100px)" : "calc(60vh - 100px)" }}>
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
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium flex-shrink-0 ${
                        index === currentInstructionIndex && isNavigating 
                          ? "bg-primary text-primary-foreground" 
                          : "bg-primary/10"
                      }`}>
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
        )}
      </div>
    </div>
  );
}
