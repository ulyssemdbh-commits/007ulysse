import { useState, useEffect, useRef } from "react";
import { useSharedVoice } from "@/components/VoiceProvider";
import { useGeolocation } from "@/hooks/useGeolocation";
import type { NavigationDestination } from "@/hooks/useNavigationRequest";

export function useDashboardSettings() {
  const { autoSpeak, setAutoSpeak } = useSharedVoice();
  const [visualMode, setVisualMode] = useState<"orb" | "avatar" | "equalizer">("avatar");
  const [orbColor, setOrbColor] = useState("#6366f1");
  const [orbIntensity, setOrbIntensity] = useState(50);
  const [voiceSpeed, setVoiceSpeed] = useState(100);
  const [voicePitch, setVoicePitch] = useState(100);
  const [ambientSound, setAmbientSound] = useState<string>("none");
  const [ambientVolume, setAmbientVolume] = useState(30);
  const [profileGradient, setProfileGradient] = useState<string | null>(null);

  useEffect(() => {
    const validTypes = ["rain", "forest", "ocean", "space"];
    if (ambientSound && ambientSound !== "none" && validTypes.includes(ambientSound)) {
      import("@/lib/ambientSounds").then(({ startAmbientSound }) => {
        startAmbientSound(ambientSound as "rain" | "forest" | "ocean" | "space", ambientVolume);
      });
    } else {
      import("@/lib/ambientSounds").then(({ stopAmbientSound }) => {
        stopAmbientSound();
      });
    }
    return () => {
      import("@/lib/ambientSounds").then(({ stopAmbientSound }) => {
        stopAmbientSound();
      });
    };
  }, [ambientSound]);

  useEffect(() => {
    import("@/lib/ambientSounds").then(({ setAmbientVolume: setVol }) => {
      setVol(ambientVolume);
    });
  }, [ambientVolume]);

  const [geoAccuracyMode, setGeoAccuracyMode] = useState<"high" | "balanced" | "low">("balanced");
  const [navigationDestination, setNavigationDestination] = useState<NavigationDestination | null>(null);

  const geo = useGeolocation({
    enableHighAccuracy: geoAccuracyMode === "high",
    updateIntervalMs: geoAccuracyMode === "high" ? 30000 : geoAccuracyMode === "balanced" ? 300000 : 600000,
  });

  const prevAccuracyModeRef = useRef(geoAccuracyMode);
  useEffect(() => {
    if (prevAccuracyModeRef.current !== geoAccuracyMode && geo.isTracking) {
      geo.stopTracking().then(() => {
        geo.startTracking();
      });
    }
    prevAccuracyModeRef.current = geoAccuracyMode;
  }, [geoAccuracyMode, geo.isTracking]);

  return {
    autoSpeak, setAutoSpeak,
    visualMode, setVisualMode,
    orbColor, setOrbColor,
    orbIntensity, setOrbIntensity,
    voiceSpeed, setVoiceSpeed,
    voicePitch, setVoicePitch,
    ambientSound, setAmbientSound,
    ambientVolume, setAmbientVolume,
    profileGradient, setProfileGradient,
    geoAccuracyMode, setGeoAccuracyMode,
    navigationDestination, setNavigationDestination,
    geo,
  };
}
