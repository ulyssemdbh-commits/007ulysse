import { useState, useEffect, lazy, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const LocationMap = lazy(() => import("./LocationMap").then(m => ({ default: m.LocationMap })));
import { 
  MapPin, 
  Navigation, 
  Target, 
  Clock, 
  Wifi, 
  WifiOff,
  Plus,
  Trash2,
  X,
  RefreshCw,
  Shield,
  Settings,
  Map as MapIcon,
  List
} from "lucide-react";

interface GeoState {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  altitude: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: number | null;
  isTracking: boolean;
  permissionState: PermissionState | null;
  error: string | null;
  startTracking: () => Promise<boolean>;
  stopTracking: () => Promise<void>;
  getCurrentPosition: () => void;
  syncPoints: () => Promise<void>;
  pendingPoints: number;
}

export interface NavigationDestination {
  address: string;
  coordinates?: { lat: number; lng: number };
}

interface GeolocationPanelProps {
  geo: GeoState;
  accuracyMode: "high" | "balanced" | "low";
  setAccuracyMode: (mode: "high" | "balanced" | "low") => void;
  isMobile: boolean;
  onClose: () => void;
  initialDestination?: NavigationDestination | null;
  onDestinationCleared?: () => void;
  isOwner?: boolean;
}

interface LocationStats {
  totalPoints: number;
  lastLocation: {
    latitude: string;
    longitude: string;
    accuracy: number;
    recordedAt: string;
    city?: string;
    address?: string;
  } | null;
  activeGeofences: number;
  recentEvents: number;
}

interface Geofence {
  id: number;
  name: string;
  latitude: string;
  longitude: string;
  radiusMeters: number;
  triggerOn: string;
  linkedAction: string;
  isActive: boolean;
}

interface LocationPoint {
  id: number;
  latitude: string;
  longitude: string;
  accuracy: number;
  recordedAt: string;
  address?: string;
  city?: string;
}

export function GeolocationPanel({ geo, accuracyMode, setAccuracyMode, isMobile, onClose, initialDestination, onDestinationCleared, isOwner = false }: GeolocationPanelProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"settings" | "map">("map");
  const [showNewGeofence, setShowNewGeofence] = useState(false);
  const [newGeofence, setNewGeofence] = useState({
    name: "",
    radiusMeters: 100,
    triggerOn: "enter",
    linkedAction: "notification"
  });

  const { data: stats, isLoading: loadingStats } = useQuery<LocationStats>({
    queryKey: ["/api/v2/location/stats"],
    refetchInterval: 10000,
  });

  const { data: geofences, isLoading: loadingGeofences } = useQuery<Geofence[]>({
    queryKey: ["/api/v2/location/geofences"],
  });

  const { data: locationHistory } = useQuery<LocationPoint[]>({
    queryKey: ["/api/v2/location/history"],
    refetchInterval: 30000,
  });

  const createGeofence = useMutation({
    mutationFn: async (data: { name: string; latitude: string; longitude: string; radiusMeters: number; triggerOn: string }) => {
      return await apiRequest("POST", "/api/v2/location/geofences", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v2/location/geofences"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v2/location/stats"] });
      setShowNewGeofence(false);
      setNewGeofence({ name: "", radiusMeters: 100, triggerOn: "enter", linkedAction: "notification" });
    },
  });

  const deleteGeofence = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/v2/location/geofences/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v2/location/geofences"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v2/location/stats"] });
    },
  });

  const handleCreateGeofence = () => {
    if (!geo.latitude || !geo.longitude) {
      return;
    }
    createGeofence.mutate({
      ...newGeofence,
      latitude: geo.latitude.toString(),
      longitude: geo.longitude.toString(),
    });
  };

  const handleCreateGeofenceFromMap = (lat: number, lng: number, radius: number, name: string, triggerOn: string) => {
    createGeofence.mutate({
      name,
      latitude: lat.toString(),
      longitude: lng.toString(),
      radiusMeters: radius,
      triggerOn,
    });
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString("fr-FR", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const currentLocation = geo.latitude && geo.longitude ? {
    latitude: geo.latitude,
    longitude: geo.longitude,
    accuracy: geo.accuracy || undefined,
    recordedAt: geo.timestamp ? new Date(geo.timestamp) : undefined,
  } : null;

  const historyPoints = (locationHistory || []).map(p => ({
    latitude: parseFloat(p.latitude),
    longitude: parseFloat(p.longitude),
    accuracy: p.accuracy,
    recordedAt: new Date(p.recordedAt),
    address: p.address,
  }));

  const mapGeofences = (geofences || []).map(gf => ({
    id: gf.id,
    name: gf.name,
    latitude: parseFloat(gf.latitude),
    longitude: parseFloat(gf.longitude),
    radius: gf.radiusMeters,
    triggerOnEnter: gf.triggerOn === "enter" || gf.triggerOn === "both",
    triggerOnExit: gf.triggerOn === "exit" || gf.triggerOn === "both",
    isActive: gf.isActive,
  }));

  return (
    <div 
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="geolocation-panel-title"
    >
      <Card 
        className="w-full max-w-4xl h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 shrink-0">
          <CardTitle id="geolocation-panel-title" className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            Géolocalisation
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 mr-4">
              {geo.isTracking ? (
                <Wifi className="h-4 w-4 text-green-500 animate-pulse" />
              ) : (
                <WifiOff className="h-4 w-4 text-muted-foreground" />
              )}
              <Switch
                checked={geo.isTracking}
                onCheckedChange={(checked) => {
                  if (checked) {
                    geo.startTracking();
                  } else {
                    geo.stopTracking();
                  }
                }}
                data-testid="switch-tracking"
              />
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-geolocation">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="flex-1 overflow-hidden p-0">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="h-full flex flex-col">
            <TabsList className="mx-4 shrink-0">
              <TabsTrigger value="map" className="gap-2" data-testid="tab-map">
                <MapIcon className="h-4 w-4" />
                Carte
              </TabsTrigger>
              <TabsTrigger value="settings" className="gap-2" data-testid="tab-settings">
                <Settings className="h-4 w-4" />
                Paramètres
              </TabsTrigger>
            </TabsList>

            <TabsContent value="map" className="flex-1 overflow-hidden m-0 data-[state=inactive]:hidden">
              <Suspense fallback={<div className="flex items-center justify-center h-full text-muted-foreground">Chargement de la carte...</div>}>
                <LocationMap
                  currentLocation={currentLocation}
                  locationHistory={historyPoints}
                  geofences={mapGeofences}
                  onCreateGeofence={handleCreateGeofenceFromMap}
                  onDeleteGeofence={(id) => deleteGeofence.mutate(id)}
                  initialDestination={initialDestination}
                  onDestinationCleared={onDestinationCleared}
                  isTracking={geo.isTracking}
                  isOwner={isOwner}
                />
              </Suspense>
            </TabsContent>

            <TabsContent value="settings" className="flex-1 overflow-hidden m-0 px-4 pb-4 data-[state=inactive]:hidden">
              <ScrollArea className="h-full">
                <div className="space-y-6 pr-4">
                  <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                    <div className="flex items-center gap-3">
                      {geo.isTracking ? (
                        <Wifi className="h-6 w-6 text-green-500 animate-pulse" />
                      ) : (
                        <WifiOff className="h-6 w-6 text-muted-foreground" />
                      )}
                      <div>
                        <p className="font-medium">
                          {geo.isTracking ? "Suivi actif" : "Suivi inactif"}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {geo.isTracking ? "Reste connecté jusqu'à désactivation" :
                           geo.permissionState === "granted" ? "Permission accordée" : 
                           geo.permissionState === "denied" ? "Permission refusée" : 
                           "Permission en attente"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={geo.isTracking}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            geo.startTracking();
                          } else {
                            geo.stopTracking();
                          }
                        }}
                        data-testid="switch-tracking-settings"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <Card>
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Navigation className="h-4 w-4 text-blue-500" />
                          <span className="text-sm font-medium">Position actuelle</span>
                        </div>
                        {geo.latitude && geo.longitude ? (
                          <div className="space-y-1">
                            <p className="text-xs font-mono">
                              {geo.latitude.toFixed(6)}, {geo.longitude.toFixed(6)}
                            </p>
                            {geo.accuracy && (
                              <p className={`text-xs ${geo.accuracy <= (isMobile && accuracyMode === "high" ? 15 : 150) ? "text-green-600" : "text-amber-600"}`}>
                                Précision: ±{Math.round(geo.accuracy)}m
                                {accuracyMode === "high" && (
                                  <span className="text-muted-foreground ml-1">
                                    (cible: {isMobile ? "±10m" : "±100m"})
                                  </span>
                                )}
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">Non disponible</p>
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Clock className="h-4 w-4 text-orange-500" />
                          <span className="text-sm font-medium">Statistiques</span>
                        </div>
                        {loadingStats ? (
                          <p className="text-xs text-muted-foreground">Chargement...</p>
                        ) : (
                          <div className="space-y-1">
                            <p className="text-xs">
                              {stats?.totalPoints || 0} points enregistrés
                            </p>
                            <p className="text-xs">
                              {stats?.activeGeofences || 0} zones actives
                            </p>
                            <p className="text-xs">
                              {stats?.recentEvents || 0} événements récents
                            </p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Settings className="h-4 w-4" />
                      <Label className="text-sm font-medium">Mode de précision</Label>
                    </div>
                    <Select value={accuracyMode} onValueChange={(v) => setAccuracyMode(v as typeof accuracyMode)}>
                      <SelectTrigger data-testid="select-accuracy-mode">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="high">
                          Haute précision {isMobile ? "(GPS ±10m)" : "(WiFi ±100m)"}
                        </SelectItem>
                        <SelectItem value="balanced">
                          Équilibré {isMobile ? "(±50m)" : "(±300m)"}
                        </SelectItem>
                        <SelectItem value="low">Économie batterie</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Target className="h-4 w-4" />
                        <span className="text-sm font-medium">Géofences (Zones)</span>
                      </div>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => setShowNewGeofence(true)}
                        disabled={!geo.latitude || !geo.longitude}
                        data-testid="button-add-geofence"
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Ajouter
                      </Button>
                    </div>

                    {showNewGeofence && (
                      <Card className="p-4 space-y-3">
                        <Input
                          placeholder="Nom de la zone (ex: Maison)"
                          value={newGeofence.name}
                          onChange={(e) => setNewGeofence(prev => ({ ...prev, name: e.target.value }))}
                          data-testid="input-geofence-name"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-xs">Rayon (m)</Label>
                            <Input
                              type="number"
                              value={newGeofence.radiusMeters}
                              onChange={(e) => setNewGeofence(prev => ({ ...prev, radiusMeters: parseInt(e.target.value) || 100 }))}
                              data-testid="input-geofence-radius"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Déclencher à</Label>
                            <Select 
                              value={newGeofence.triggerOn} 
                              onValueChange={(v) => setNewGeofence(prev => ({ ...prev, triggerOn: v }))}
                            >
                              <SelectTrigger data-testid="select-geofence-trigger">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="enter">Entrée</SelectItem>
                                <SelectItem value="exit">Sortie</SelectItem>
                                <SelectItem value="both">Les deux</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => setShowNewGeofence(false)}
                            data-testid="button-cancel-geofence"
                          >
                            Annuler
                          </Button>
                          <Button 
                            size="sm" 
                            onClick={handleCreateGeofence}
                            disabled={!newGeofence.name || createGeofence.isPending}
                            data-testid="button-create-geofence"
                          >
                            Créer
                          </Button>
                        </div>
                      </Card>
                    )}

                    {loadingGeofences ? (
                      <p className="text-sm text-muted-foreground">Chargement des zones...</p>
                    ) : geofences && geofences.length > 0 ? (
                      <div className="space-y-2">
                        {geofences.map((fence) => (
                          <div 
                            key={fence.id} 
                            className="flex items-center justify-between p-3 bg-muted rounded-lg"
                          >
                            <div>
                              <p className="font-medium text-sm">{fence.name}</p>
                              <p className="text-xs text-muted-foreground">
                                Rayon: {fence.radiusMeters}m • 
                                {fence.triggerOn === "enter" ? " Entrée" : 
                                 fence.triggerOn === "exit" ? " Sortie" : " Entrée/Sortie"}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={fence.isActive ? "default" : "secondary"}>
                                {fence.isActive ? "Actif" : "Inactif"}
                              </Badge>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => deleteGeofence.mutate(fence.id)}
                                data-testid={`button-delete-geofence-${fence.id}`}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        Aucune zone définie. Active le suivi et crée ta première zone!
                      </p>
                    )}
                  </div>

                  <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-green-500" />
                      <span className="text-sm font-medium">Confidentialité</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Tes données de position sont stockées de manière sécurisée et automatiquement supprimées après 30 jours. 
                      Tu peux désactiver le suivi à tout moment.
                    </p>
                  </div>

                  {geo.error && (
                    <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                      <p className="text-sm text-destructive">{geo.error}</p>
                    </div>
                  )}

                  <div className="flex justify-end gap-2">
                    <Button 
                      variant="outline" 
                      onClick={() => geo.getCurrentPosition()}
                      disabled={geo.isTracking}
                      data-testid="button-get-position"
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Position unique
                    </Button>
                  </div>
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
