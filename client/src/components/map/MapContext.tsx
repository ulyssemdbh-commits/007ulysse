import { createContext, useContext, useState, useRef, useCallback, ReactNode } from "react";
import { GPSKalmanFilter } from "@/lib/kalmanFilter";
import { SensorFusionEngine } from "@/lib/sensorFusion";
import type { LocationPoint, Geofence, RouteInfo, MapInteractionMode, MapStyleType, InstructionsPanelHeight } from "./MapTypes";

interface MapState {
  interactionMode: MapInteractionMode;
  setInteractionMode: (mode: MapInteractionMode) => void;
  
  showRouting: boolean;
  setShowRouting: (show: boolean) => void;
  
  isNavigating: boolean;
  setIsNavigating: (nav: boolean) => void;
  
  routeInfo: RouteInfo | null;
  setRouteInfo: (info: RouteInfo | null) => void;
  
  currentHeading: number;
  setCurrentHeading: (h: number) => void;
  
  mapStyle: MapStyleType;
  setMapStyle: (style: MapStyleType) => void;
  
  isNightMode: boolean;
  setIsNightMode: (night: boolean) => void;
  
  voiceEnabled: boolean;
  setVoiceEnabled: (enabled: boolean) => void;
  
  instructionsPanelHeight: InstructionsPanelHeight;
  setInstructionsPanelHeight: (h: InstructionsPanelHeight) => void;
  
  currentInstructionIndex: number;
  setCurrentInstructionIndex: (idx: number) => void;
  
  filteredPosition: { lat: number; lng: number } | null;
  setFilteredPosition: (pos: { lat: number; lng: number } | null) => void;
  
  isGpsLost: boolean;
  setIsGpsLost: (lost: boolean) => void;
  
  currentSpeed: number;
  setCurrentSpeed: (speed: number) => void;
  
  kalmanFilter: GPSKalmanFilter;
  sensorFusion: SensorFusionEngine;
  
  announceInstruction: (text: string) => void;
}

const MapContext = createContext<MapState | null>(null);

export function useMapContext() {
  const ctx = useContext(MapContext);
  if (!ctx) throw new Error("useMapContext must be used within MapContextProvider");
  return ctx;
}

interface MapContextProviderProps {
  children: ReactNode;
}

export function MapContextProvider({ children }: MapContextProviderProps) {
  const [interactionMode, setInteractionMode] = useState<MapInteractionMode>("none");
  const [showRouting, setShowRouting] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [currentHeading, setCurrentHeading] = useState(0);
  const [mapStyle, setMapStyle] = useState<MapStyleType>("standard");
  const [isNightMode, setIsNightMode] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [instructionsPanelHeight, setInstructionsPanelHeight] = useState<InstructionsPanelHeight>("partial");
  const [currentInstructionIndex, setCurrentInstructionIndex] = useState(0);
  const [filteredPosition, setFilteredPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [isGpsLost, setIsGpsLost] = useState(false);
  const [currentSpeed, setCurrentSpeed] = useState(0);
  
  const kalmanFilterRef = useRef(new GPSKalmanFilter());
  const sensorFusionRef = useRef(new SensorFusionEngine());
  
  const announceInstruction = useCallback((text: string) => {
    if (!voiceEnabled) return;
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "fr-FR";
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      
      const voices = window.speechSynthesis.getVoices();
      const frenchVoice = voices.find(v => v.lang.startsWith("fr"));
      if (frenchVoice) utterance.voice = frenchVoice;
      
      window.speechSynthesis.speak(utterance);
    }
  }, [voiceEnabled]);
  
  const value: MapState = {
    interactionMode, setInteractionMode,
    showRouting, setShowRouting,
    isNavigating, setIsNavigating,
    routeInfo, setRouteInfo,
    currentHeading, setCurrentHeading,
    mapStyle, setMapStyle,
    isNightMode, setIsNightMode,
    voiceEnabled, setVoiceEnabled,
    instructionsPanelHeight, setInstructionsPanelHeight,
    currentInstructionIndex, setCurrentInstructionIndex,
    filteredPosition, setFilteredPosition,
    isGpsLost, setIsGpsLost,
    currentSpeed, setCurrentSpeed,
    kalmanFilter: kalmanFilterRef.current,
    sensorFusion: sensorFusionRef.current,
    announceInstruction,
  };
  
  return (
    <MapContext.Provider value={value}>
      {children}
    </MapContext.Provider>
  );
}
