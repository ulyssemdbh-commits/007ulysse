import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { 
  Music, Lightbulb, Zap, Play, Pause, SkipForward, SkipBack, 
  Volume2, VolumeX, Shuffle, Repeat, Settings, CheckCircle, 
  XCircle, Loader2, Smartphone, Speaker, Tv, Monitor
} from "lucide-react";

interface SpotifyPlayback {
  isPlaying: boolean;
  trackName: string | null;
  artistName: string | null;
  albumArt: string | null;
  volumePercent: number;
  shuffleState: boolean;
  repeatState: string;
  deviceName: string | null;
}

interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  volumePercent: number;
}

function SpotifySection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [volume, setVolume] = useState(50);

  const { data: status } = useQuery<{ connected: boolean }>({
    queryKey: ["/api/v2/spotify/status"],
  });

  const { data: playback, isLoading: loadingPlayback } = useQuery<SpotifyPlayback>({
    queryKey: ["/api/v2/spotify/playback"],
    enabled: status?.connected,
    refetchInterval: 5000,
  });

  const { data: devices } = useQuery<SpotifyDevice[]>({
    queryKey: ["/api/v2/spotify/devices"],
    enabled: status?.connected,
  });

  const playMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/v2/spotify/play", {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/v2/spotify/playback"] }),
  });

  const pauseMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/v2/spotify/pause", {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/v2/spotify/playback"] }),
  });

  const nextMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/v2/spotify/next", {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/v2/spotify/playback"] }),
  });

  const prevMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/v2/spotify/previous", {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/v2/spotify/playback"] }),
  });

  const volumeMutation = useMutation({
    mutationFn: (vol: number) => apiRequest("POST", "/api/v2/spotify/volume", { volume: vol }),
  });

  const shuffleMutation = useMutation({
    mutationFn: (state: boolean) => apiRequest("POST", "/api/v2/spotify/shuffle", { state }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/v2/spotify/playback"] }),
  });

  const repeatMutation = useMutation({
    mutationFn: (state: string) => apiRequest("POST", "/api/v2/spotify/repeat", { state }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/v2/spotify/playback"] }),
  });

  const getNextRepeatState = (current: string | undefined): string => {
    if (!current || current === "off") return "context";
    if (current === "context") return "track";
    return "off";
  };

  const transferMutation = useMutation({
    mutationFn: (deviceId: string) => apiRequest("POST", "/api/v2/spotify/transfer", { deviceId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v2/spotify/devices"] });
      toast({ title: "Lecture transférée" });
    },
  });

  const getDeviceIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case "smartphone": return <Smartphone className="h-4 w-4" />;
      case "speaker": return <Speaker className="h-4 w-4" />;
      case "tv": return <Tv className="h-4 w-4" />;
      default: return <Monitor className="h-4 w-4" />;
    }
  };

  if (!status?.connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Music className="h-5 w-5 text-green-500" />
            Spotify
          </CardTitle>
          <CardDescription>Contrôle musical sur toutes vos enceintes</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-muted-foreground">
            <XCircle className="h-4 w-4" />
            <span>Non connecté</span>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            Connectez Spotify dans les intégrations Replit pour activer le contrôle musical.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Music className="h-5 w-5 text-green-500" />
          Spotify
          <Badge variant="outline" className="ml-auto">
            <CheckCircle className="h-3 w-3 mr-1" />
            Connecté
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadingPlayback ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : playback?.trackName ? (
          <div className="flex items-center gap-4">
            {playback.albumArt && (
              <img 
                src={playback.albumArt} 
                alt="Album" 
                className="w-16 h-16 rounded-md"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{playback.trackName}</p>
              <p className="text-sm text-muted-foreground truncate">{playback.artistName}</p>
              <p className="text-xs text-muted-foreground">{playback.deviceName}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Aucune lecture en cours</p>
        )}

        <div className="flex items-center justify-center gap-2" data-testid="spotify-controls">
          <Button 
            size="icon" 
            variant="ghost"
            onClick={() => shuffleMutation.mutate(!playback?.shuffleState)}
            data-testid="button-shuffle"
          >
            <Shuffle className={`h-4 w-4 ${playback?.shuffleState ? "text-green-500" : ""}`} />
          </Button>
          <Button 
            size="icon" 
            variant="ghost"
            onClick={() => prevMutation.mutate()}
            data-testid="button-previous"
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button 
            size="icon" 
            onClick={() => playback?.isPlaying ? pauseMutation.mutate() : playMutation.mutate()}
            data-testid="button-play-pause"
          >
            {playback?.isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button 
            size="icon" 
            variant="ghost"
            onClick={() => nextMutation.mutate()}
            data-testid="button-next"
          >
            <SkipForward className="h-4 w-4" />
          </Button>
          <Button 
            size="icon" 
            variant="ghost"
            onClick={() => repeatMutation.mutate(getNextRepeatState(playback?.repeatState))}
            data-testid="button-repeat"
          >
            <Repeat className={`h-4 w-4 ${playback?.repeatState !== "off" ? "text-green-500" : ""}`} />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <VolumeX className="h-4 w-4" />
          <Slider
            value={[playback?.volumePercent || volume]}
            onValueChange={([v]) => setVolume(v)}
            onValueCommit={([v]) => volumeMutation.mutate(v)}
            max={100}
            step={1}
            className="flex-1"
            data-testid="slider-volume"
          />
          <Volume2 className="h-4 w-4" />
        </div>

        {devices && devices.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Appareils disponibles</p>
            <div className="flex flex-wrap gap-2">
              {devices.map((device) => (
                <Button
                  key={device.id}
                  size="sm"
                  variant={device.isActive ? "default" : "outline"}
                  onClick={() => !device.isActive && transferMutation.mutate(device.id)}
                  className="gap-1"
                  data-testid={`button-device-${device.id}`}
                >
                  {getDeviceIcon(device.type)}
                  {device.name}
                </Button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TuyaSection() {
  const { data: status } = useQuery<{ configured: boolean; message: string }>({
    queryKey: ["/api/v2/tuya/status"],
  });

  const { data: devices } = useQuery<any[]>({
    queryKey: ["/api/v2/tuya/devices"],
    enabled: status?.configured,
  });

  const { data: instructions } = useQuery<{ instructions: string }>({
    queryKey: ["/api/v2/tuya/setup-instructions"],
    enabled: !status?.configured,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-yellow-500" />
          Tuya / Smart Life
          {status?.configured && (
            <Badge variant="outline" className="ml-auto">
              <CheckCircle className="h-3 w-3 mr-1" />
              Configuré
            </Badge>
          )}
        </CardTitle>
        <CardDescription>Millions d'appareils IoT compatibles</CardDescription>
      </CardHeader>
      <CardContent>
        {!status?.configured ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Settings className="h-4 w-4" />
              <span>Configuration requise</span>
            </div>
            <ScrollArea className="h-48">
              <pre className="text-xs whitespace-pre-wrap">
                {instructions?.instructions || "Chargement des instructions..."}
              </pre>
            </ScrollArea>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-medium">{devices?.length || 0} appareils détectés</p>
            {devices?.map((device: any) => (
              <div 
                key={device.id} 
                className="flex items-center justify-between p-2 rounded-md bg-muted/50"
              >
                <div className="flex items-center gap-2">
                  <Lightbulb className={`h-4 w-4 ${device.online ? "text-green-500" : "text-muted-foreground"}`} />
                  <span className="text-sm">{device.name}</span>
                  <Badge variant="secondary" className="text-xs">{device.categoryName}</Badge>
                </div>
                <Badge variant={device.online ? "default" : "secondary"}>
                  {device.online ? "En ligne" : "Hors ligne"}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function IftttSection() {
  const { data: status } = useQuery<{ configured: boolean; message: string }>({
    queryKey: ["/api/v2/ifttt/status"],
  });

  const { data: applets } = useQuery<any[]>({
    queryKey: ["/api/v2/ifttt/applets"],
  });

  const { data: instructions } = useQuery<{ instructions: string }>({
    queryKey: ["/api/v2/ifttt/setup-instructions"],
    enabled: !status?.configured,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-blue-500" />
          IFTTT Webhooks
          {status?.configured && (
            <Badge variant="outline" className="ml-auto">
              <CheckCircle className="h-3 w-3 mr-1" />
              Configuré
            </Badge>
          )}
        </CardTitle>
        <CardDescription>Pont vers Google Home, Alexa et 700+ services</CardDescription>
      </CardHeader>
      <CardContent>
        {!status?.configured ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Settings className="h-4 w-4" />
              <span>Configuration requise</span>
            </div>
            <ScrollArea className="h-48">
              <pre className="text-xs whitespace-pre-wrap">
                {instructions?.instructions || "Chargement des instructions..."}
              </pre>
            </ScrollArea>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-medium">Applets recommandés</p>
            <div className="grid grid-cols-2 gap-2">
              {applets?.slice(0, 6).map((applet: any) => (
                <div 
                  key={applet.eventName}
                  className="p-2 rounded-md bg-muted/50 text-center"
                >
                  <p className="text-sm font-medium">{applet.displayName}</p>
                  <p className="text-xs text-muted-foreground truncate">{applet.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface IntegrationsPanelProps {
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function IntegrationsPanel({ isOpen, onOpenChange }: IntegrationsPanelProps) {
  const [activeTab, setActiveTab] = useState("spotify");

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b">
        <h2 className="text-lg font-semibold">Intégrations</h2>
        <p className="text-sm text-muted-foreground">Contrôle centralisé de vos services</p>
      </div>
      
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="mx-4 mt-2">
          <TabsTrigger value="spotify" className="gap-1" data-testid="tab-spotify">
            <Music className="h-4 w-4" />
            Musique
          </TabsTrigger>
          <TabsTrigger value="tuya" className="gap-1" data-testid="tab-tuya">
            <Lightbulb className="h-4 w-4" />
            IoT
          </TabsTrigger>
          <TabsTrigger value="ifttt" className="gap-1" data-testid="tab-ifttt">
            <Zap className="h-4 w-4" />
            Auto
          </TabsTrigger>
        </TabsList>
        
        <ScrollArea className="flex-1 p-4">
          <TabsContent value="spotify" className="m-0">
            <SpotifySection />
          </TabsContent>
          <TabsContent value="tuya" className="m-0">
            <TuyaSection />
          </TabsContent>
          <TabsContent value="ifttt" className="m-0">
            <IftttSection />
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}
