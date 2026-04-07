import { useState, useEffect, useCallback, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";

interface GeolocationState {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  altitude: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: number | null;
  error: string | null;
  isTracking: boolean;
  permissionState: PermissionState | null;
  lastSyncAt: Date | null;
}

interface GeolocationOptions {
  enableHighAccuracy?: boolean;
  updateIntervalMs?: number;
  syncBatchSize?: number;
  autoSync?: boolean;
}

const DEFAULT_OPTIONS: GeolocationOptions = {
  enableHighAccuracy: false,
  updateIntervalMs: 600000,
  syncBatchSize: 10,
  autoSync: true,
};

export function useGeolocation(options: GeolocationOptions = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  const [state, setState] = useState<GeolocationState>({
    latitude: null,
    longitude: null,
    accuracy: null,
    altitude: null,
    heading: null,
    speed: null,
    timestamp: null,
    error: null,
    isTracking: false,
    permissionState: null,
    lastSyncAt: null,
  });

  const watchIdRef = useRef<number | null>(null);
  const pendingPointsRef = useRef<any[]>([]);
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const deviceIdRef = useRef<string>(getDeviceId());
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef<number>(0);
  const isTrackingIntentRef = useRef<boolean>(false);

  function getDeviceId(): string {
    let id = localStorage.getItem("deviceId");
    if (!id) {
      id = `web-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem("deviceId", id);
    }
    return id;
  }

  const checkPermission = useCallback(async () => {
    if (!navigator.permissions) {
      return "prompt" as PermissionState;
    }
    try {
      const result = await navigator.permissions.query({ name: "geolocation" });
      setState(prev => ({ ...prev, permissionState: result.state }));
      result.addEventListener("change", () => {
        setState(prev => ({ ...prev, permissionState: result.state }));
      });
      return result.state;
    } catch {
      return "prompt" as PermissionState;
    }
  }, []);

  const syncPoints = useCallback(async () => {
    if (pendingPointsRef.current.length === 0) return;

    const points = pendingPointsRef.current.splice(0, opts.syncBatchSize);
    
    try {
      await apiRequest("POST", "/api/v2/location/points/batch", { points });
      setState(prev => ({ ...prev, lastSyncAt: new Date() }));
    } catch (error) {
      pendingPointsRef.current.unshift(...points);
      console.error("[Geolocation] Sync failed, will retry:", error);
    }
  }, [opts.syncBatchSize]);

  const recordPoint = useCallback((position: GeolocationPosition, context: string = "foreground") => {
    const point = {
      latitude: position.coords.latitude.toString(),
      longitude: position.coords.longitude.toString(),
      altitude: position.coords.altitude?.toString() || null,
      accuracy: position.coords.accuracy ? Math.round(position.coords.accuracy) : null,
      altitudeAccuracy: position.coords.altitudeAccuracy ? Math.round(position.coords.altitudeAccuracy) : null,
      heading: position.coords.heading ? Math.round(position.coords.heading) : null,
      speed: position.coords.speed ? Math.round(position.coords.speed) : null,
      context,
      recordedAt: new Date(position.timestamp).toISOString(),
    };

    pendingPointsRef.current.push(point);

    if (opts.autoSync && pendingPointsRef.current.length >= opts.syncBatchSize!) {
      syncPoints();
    }
  }, [opts.autoSync, opts.syncBatchSize, syncPoints]);

  const handleSuccess = useCallback((position: GeolocationPosition) => {
    setState(prev => ({
      ...prev,
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      altitude: position.coords.altitude,
      heading: position.coords.heading,
      speed: position.coords.speed,
      timestamp: position.timestamp,
      error: null,
    }));

    recordPoint(position);
  }, [recordPoint]);

  const restartWatch = useCallback(() => {
    if (!isTrackingIntentRef.current) return;
    
    // Clear existing watch
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    
    // Exponential backoff: 2s, 4s, 8s, 16s, max 30s
    const delay = Math.min(2000 * Math.pow(2, retryCountRef.current), 30000);
    retryCountRef.current++;
    
    console.log(`[Geolocation] Reconnecting in ${delay/1000}s (attempt ${retryCountRef.current})`);
    
    retryTimeoutRef.current = setTimeout(() => {
      if (!isTrackingIntentRef.current) return;
      
      const positionOptions: PositionOptions = opts.enableHighAccuracy
        ? { enableHighAccuracy: true, maximumAge: 0, timeout: 60000 }
        : { enableHighAccuracy: false, maximumAge: 60000, timeout: 30000 };
      
      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
          retryCountRef.current = 0; // Reset on success
          handleSuccess(position);
        },
        handleErrorInternal,
        positionOptions
      );
    }, delay);
  }, [opts.enableHighAccuracy]);

  const handleErrorInternal = useCallback((error: GeolocationPositionError) => {
    let errorMessage: string;
    let shouldRetry = false;
    
    switch (error.code) {
      case error.PERMISSION_DENIED:
        errorMessage = "Accès à la position refusé";
        isTrackingIntentRef.current = false; // Stop trying if permission denied
        setState(prev => ({ ...prev, error: errorMessage, isTracking: false }));
        return;
      case error.POSITION_UNAVAILABLE:
        errorMessage = "Position temporairement indisponible";
        shouldRetry = true;
        break;
      case error.TIMEOUT:
        errorMessage = "Recherche de position...";
        shouldRetry = true;
        break;
      default:
        errorMessage = "Erreur de géolocalisation";
        shouldRetry = true;
    }
    
    // Only show error briefly for recoverable errors
    if (shouldRetry && isTrackingIntentRef.current) {
      setState(prev => ({ ...prev, error: null })); // Don't show error for retryable issues
      restartWatch();
    } else {
      setState(prev => ({ ...prev, error: errorMessage }));
    }
  }, [restartWatch]);

  const handleError = useCallback((error: GeolocationPositionError) => {
    handleErrorInternal(error);
  }, [handleErrorInternal]);

  const startTracking = useCallback(async () => {
    if (!navigator.geolocation) {
      setState(prev => ({ ...prev, error: "Géolocalisation non supportée" }));
      return false;
    }

    const permission = await checkPermission();
    if (permission === "denied") {
      setState(prev => ({ ...prev, error: "Permission refusée" }));
      return false;
    }

    // Mark intent to stay connected
    isTrackingIntentRef.current = true;
    retryCountRef.current = 0;

    try {
      await apiRequest("POST", "/api/v2/location/sessions", {
        deviceId: deviceIdRef.current,
        deviceName: navigator.userAgent.slice(0, 100),
        consentGranted: true,
        consentTimestamp: new Date().toISOString(),
        accuracyMode: opts.enableHighAccuracy ? "high" : "balanced",
        updateIntervalMs: opts.updateIntervalMs,
        backgroundEnabled: false,
      });
    } catch (error) {
      console.error("[Geolocation] Failed to create session:", error);
    }

    // For high accuracy mode, use maximumAge=0 and longer timeout to wait for GPS lock
    const positionOptions: PositionOptions = opts.enableHighAccuracy
      ? { enableHighAccuracy: true, maximumAge: 0, timeout: 60000 }
      : { enableHighAccuracy: false, maximumAge: 60000, timeout: 30000 };

    // Prime GPS with an initial getCurrentPosition for faster lock
    if (opts.enableHighAccuracy) {
      navigator.geolocation.getCurrentPosition(
        (pos) => { retryCountRef.current = 0; handleSuccess(pos); },
        handleError,
        positionOptions
      );
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => { retryCountRef.current = 0; handleSuccess(pos); },
      handleError,
      positionOptions
    );

    if (opts.autoSync) {
      syncIntervalRef.current = setInterval(syncPoints, 60000);
    }

    setState(prev => ({ ...prev, isTracking: true, error: null }));
    return true;
  }, [checkPermission, handleSuccess, handleError, opts, syncPoints]);

  const stopTracking = useCallback(async () => {
    // Clear intent first to prevent auto-reconnect
    isTrackingIntentRef.current = false;
    retryCountRef.current = 0;
    
    // Clear retry timeout
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    if (syncIntervalRef.current) {
      clearInterval(syncIntervalRef.current);
      syncIntervalRef.current = null;
    }

    await syncPoints();

    try {
      await apiRequest("DELETE", `/api/v2/location/sessions/${deviceIdRef.current}`);
    } catch (error) {
      console.error("[Geolocation] Failed to end session:", error);
    }

    setState(prev => ({ ...prev, isTracking: false }));
  }, [syncPoints]);

  const getCurrentPosition = useCallback((): Promise<GeolocationPosition> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Géolocalisation non supportée"));
        return;
      }

      // Use aggressive settings for single position request when high accuracy is enabled
      const positionOptions: PositionOptions = opts.enableHighAccuracy
        ? { enableHighAccuracy: true, maximumAge: 0, timeout: 60000 }
        : { enableHighAccuracy: false, maximumAge: 30000, timeout: 15000 };

      navigator.geolocation.getCurrentPosition(
        (position) => {
          handleSuccess(position);
          resolve(position);
        },
        (error) => {
          handleError(error);
          reject(error);
        },
        positionOptions
      );
    });
  }, [handleSuccess, handleError, opts.enableHighAccuracy]);

  useEffect(() => {
    checkPermission();
    return () => {
      isTrackingIntentRef.current = false;
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [checkPermission]);

  return {
    ...state,
    startTracking,
    stopTracking,
    getCurrentPosition,
    syncPoints,
    pendingPoints: pendingPointsRef.current.length,
  };
}
