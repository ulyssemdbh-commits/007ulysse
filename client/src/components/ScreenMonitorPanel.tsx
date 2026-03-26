import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { 
  Monitor, 
  Play,
  Pause,
  Square,
  Eye,
  EyeOff,
  Activity,
  Clock,
  Cpu,
  Loader2,
  Download,
  AlertTriangle,
  CheckCircle,
  TrendingUp,
  BarChart
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface ScreenMonitorPreferences {
  userId: number;
  enabled: boolean;
  analysisIntervalSec: number;
  saveHistory: boolean;
  privacyFilterEnabled: boolean;
  allowedApps: string[];
  blockedApps: string[];
}

interface ScreenMonitorSession {
  id: number;
  status: string;
  startedAt: string;
  pausedAt?: string;
  endedAt?: string;
  deviceId: string;
  deviceName?: string;
  framesReceived: number;
  framesAnalyzed: number;
  lastFrameAt?: string;
}

interface ScreenContextEvent {
  id: number;
  context: string;
  tags: string[];
  activeApp?: string;
  activeWindow?: string;
  suggestions?: string[];
  createdAt: string;
}

interface WorkPattern {
  pattern: string;
  occurrences: number;
  confidence: number;
  lastSeen?: string;
}

interface MonitorStatus {
  preferences: ScreenMonitorPreferences;
  activeSession: ScreenMonitorSession | null;
  stats: {
    totalSessions: number;
    totalFrames: number;
    totalEvents: number;
  };
}

interface ScreenMonitorPanelProps {
  trigger?: React.ReactNode;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ScreenMonitorPanel({ trigger, isOpen, onOpenChange }: ScreenMonitorPanelProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isOpen !== undefined ? isOpen : internalOpen;
  const setOpen = onOpenChange !== undefined ? onOpenChange : setInternalOpen;
  const [activeTab, setActiveTab] = useState<"status" | "context" | "patterns">("status");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: status, isLoading: statusLoading } = useQuery<MonitorStatus>({
    queryKey: ["/api/v2/screen-monitor/status"],
    refetchInterval: 5000,
    enabled: open,
  });

  const { data: contextEvents, isLoading: contextLoading } = useQuery<ScreenContextEvent[]>({
    queryKey: ["/api/v2/screen-monitor/context"],
    enabled: open && activeTab === "context",
    refetchInterval: 10000,
  });

  const { data: patterns, isLoading: patternsLoading } = useQuery<WorkPattern[]>({
    queryKey: ["/api/v2/screen-monitor/patterns"],
    enabled: open && activeTab === "patterns",
  });

  const updatePreferences = useMutation({
    mutationFn: async (prefs: Partial<ScreenMonitorPreferences>) => {
      return apiRequest("PUT", "/api/v2/screen-monitor/preferences", prefs);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v2/screen-monitor/status"] });
      toast({ title: "Préférences mises à jour" });
    },
    onError: (err: any) => {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    }
  });

  const toggleMonitoring = useMutation({
    mutationFn: async (action: "start" | "pause" | "resume" | "stop") => {
      return apiRequest("POST", "/api/v2/screen-monitor/toggle", { action });
    },
    onSuccess: (_, action) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v2/screen-monitor/status"] });
      const messages = {
        start: "Surveillance démarrée",
        pause: "Surveillance en pause",
        resume: "Surveillance reprise",
        stop: "Surveillance arrêtée"
      };
      toast({ title: messages[action as keyof typeof messages] });
    },
    onError: (err: any) => {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    }
  });

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const getSessionDuration = (session: ScreenMonitorSession) => {
    const start = new Date(session.startedAt).getTime();
    const end = session.endedAt 
      ? new Date(session.endedAt).getTime()
      : session.pausedAt
        ? new Date(session.pausedAt).getTime()
        : Date.now();
    const minutes = Math.floor((end - start) / 60000);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}min`;
  };

  const getTagColor = (tag: string) => {
    const colors: Record<string, string> = {
      coding: "bg-blue-500/20 text-blue-400",
      browsing: "bg-purple-500/20 text-purple-400",
      documentation: "bg-green-500/20 text-green-400",
      multimedia: "bg-orange-500/20 text-orange-400",
      communication: "bg-pink-500/20 text-pink-400",
      productivity: "bg-cyan-500/20 text-cyan-400",
      gaming: "bg-red-500/20 text-red-400",
      other: "bg-gray-500/20 text-gray-400"
    };
    return colors[tag] || colors.other;
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {trigger && <SheetTrigger asChild>{trigger}</SheetTrigger>}
      <SheetContent className="w-[450px] sm:w-[540px] sm:max-w-none">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Monitor className="h-5 w-5" />
            Surveillance Écran Live
          </SheetTitle>
          <SheetDescription>
            Ulysse analyse ton écran en temps réel pour mieux t'assister
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="status" className="gap-1" data-testid="tab-status">
                <Activity className="h-4 w-4" />
                Statut
              </TabsTrigger>
              <TabsTrigger value="context" className="gap-1" data-testid="tab-context">
                <Eye className="h-4 w-4" />
                Contexte
              </TabsTrigger>
              <TabsTrigger value="patterns" className="gap-1" data-testid="tab-patterns">
                <BarChart className="h-4 w-4" />
                Patterns
              </TabsTrigger>
            </TabsList>

            <TabsContent value="status" className="mt-4 space-y-4">
              {statusLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : status ? (
                <>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center justify-between">
                        <span>État du Monitoring</span>
                        {status.activeSession ? (
                          <Badge className={cn(
                            status.activeSession.status === "active" && "bg-green-500/20 text-green-400",
                            status.activeSession.status === "paused" && "bg-yellow-500/20 text-yellow-400"
                          )}>
                            {status.activeSession.status === "active" ? "Actif" : "En pause"}
                          </Badge>
                        ) : (
                          <Badge variant="outline">Inactif</Badge>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {status.activeSession ? (
                        <>
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <p className="text-muted-foreground">Appareil</p>
                              <p className="font-medium">{status.activeSession.deviceName || status.activeSession.deviceId}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Durée</p>
                              <p className="font-medium">{getSessionDuration(status.activeSession)}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Frames reçues</p>
                              <p className="font-medium">{status.activeSession.framesReceived}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Frames analysées</p>
                              <p className="font-medium">{status.activeSession.framesAnalyzed}</p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            {status.activeSession.status === "active" ? (
                              <Button 
                                variant="outline" 
                                size="sm" 
                                onClick={() => toggleMonitoring.mutate("pause")}
                                disabled={toggleMonitoring.isPending}
                                data-testid="button-pause"
                              >
                                <Pause className="h-4 w-4 mr-1" />
                                Pause
                              </Button>
                            ) : (
                              <Button 
                                variant="outline" 
                                size="sm" 
                                onClick={() => toggleMonitoring.mutate("resume")}
                                disabled={toggleMonitoring.isPending}
                                data-testid="button-resume"
                              >
                                <Play className="h-4 w-4 mr-1" />
                                Reprendre
                              </Button>
                            )}
                            <Button 
                              variant="destructive" 
                              size="sm" 
                              onClick={() => toggleMonitoring.mutate("stop")}
                              disabled={toggleMonitoring.isPending}
                              data-testid="button-stop"
                            >
                              <Square className="h-4 w-4 mr-1" />
                              Arrêter
                            </Button>
                          </div>
                        </>
                      ) : (
                        <div className="text-center py-4">
                          <p className="text-muted-foreground mb-4">
                            Aucune session active. Lance l'agent Windows pour démarrer.
                          </p>
                          <div className="flex flex-col gap-2 items-center">
                            <p className="text-xs text-muted-foreground">URL WebSocket à copier :</p>
                            <code 
                              className="text-xs bg-muted p-2 rounded cursor-pointer hover:bg-muted/80 select-all break-all max-w-full"
                              onClick={() => {
                                const wsUrl = `wss://${window.location.host}/ws/screen`;
                                navigator.clipboard.writeText(wsUrl);
                                toast({ title: "URL copiée !", description: wsUrl });
                              }}
                              data-testid="code-websocket-url"
                            >
                              wss://{window.location.host}/ws/screen
                            </code>
                            <p className="text-xs text-muted-foreground mt-2">Ou commande complète :</p>
                            <code 
                              className="text-xs bg-muted p-2 rounded cursor-pointer hover:bg-muted/80 select-all break-all max-w-full"
                              onClick={() => {
                                const cmd = `python ulysse_screen_agent.py --server wss://${window.location.host}/ws/screen --user-id 1`;
                                navigator.clipboard.writeText(cmd);
                                toast({ title: "Commande copiée !" });
                              }}
                              data-testid="code-full-command"
                            >
                              python ulysse_screen_agent.py --server wss://{window.location.host}/ws/screen --user-id 1
                            </code>
                            <p className="text-xs text-muted-foreground mt-1">(Cliquez pour copier)</p>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Préférences</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="enabled">Surveillance activée</Label>
                        <Switch
                          id="enabled"
                          checked={status.preferences.enabled}
                          onCheckedChange={(enabled) => updatePreferences.mutate({ enabled })}
                          data-testid="switch-enabled"
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <Label htmlFor="privacy">Filtrage vie privée</Label>
                        <Switch
                          id="privacy"
                          checked={status.preferences.privacyFilterEnabled}
                          onCheckedChange={(privacyFilterEnabled) => updatePreferences.mutate({ privacyFilterEnabled })}
                          data-testid="switch-privacy"
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <Label htmlFor="history">Sauvegarder historique</Label>
                        <Switch
                          id="history"
                          checked={status.preferences.saveHistory}
                          onCheckedChange={(saveHistory) => updatePreferences.mutate({ saveHistory })}
                          data-testid="switch-history"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Intervalle d'analyse: {status.preferences.analysisIntervalSec}s</Label>
                        <Slider
                          value={[status.preferences.analysisIntervalSec]}
                          onValueChange={([v]) => updatePreferences.mutate({ analysisIntervalSec: v })}
                          min={3}
                          max={30}
                          step={1}
                          data-testid="slider-interval"
                        />
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Statistiques</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                          <p className="text-2xl font-bold">{status.stats.totalSessions}</p>
                          <p className="text-xs text-muted-foreground">Sessions</p>
                        </div>
                        <div>
                          <p className="text-2xl font-bold">{status.stats.totalFrames}</p>
                          <p className="text-xs text-muted-foreground">Frames</p>
                        </div>
                        <div>
                          <p className="text-2xl font-bold">{status.stats.totalEvents}</p>
                          <p className="text-xs text-muted-foreground">Événements</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </>
              ) : (
                <Card>
                  <CardContent className="py-8 text-center">
                    <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                    <p>Impossible de charger le statut</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="context" className="mt-4">
              {contextLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : contextEvents && contextEvents.length > 0 ? (
                <ScrollArea className="h-[500px]">
                  <div className="space-y-3">
                    {contextEvents.map((event) => (
                      <Card key={event.id}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex flex-wrap gap-1">
                              {event.tags.map((tag) => (
                                <Badge key={tag} className={cn("text-xs", getTagColor(tag))}>
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {formatDate(event.createdAt)}
                            </span>
                          </div>
                          <p className="text-sm">{event.context}</p>
                          {event.activeApp && (
                            <p className="text-xs text-muted-foreground mt-2">
                              App: {event.activeApp} {event.activeWindow && `- ${event.activeWindow}`}
                            </p>
                          )}
                          {event.suggestions && event.suggestions.length > 0 && (
                            <div className="mt-2 pt-2 border-t">
                              <p className="text-xs text-muted-foreground mb-1">Suggestions:</p>
                              <ul className="text-xs space-y-1">
                                {event.suggestions.map((s, i) => (
                                  <li key={i} className="flex items-center gap-1">
                                    <TrendingUp className="h-3 w-3 text-primary" />
                                    {s}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <Card>
                  <CardContent className="py-8 text-center">
                    <Eye className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-muted-foreground">Aucun contexte enregistré</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Les événements apparaîtront ici quand l'agent sera actif
                    </p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="patterns" className="mt-4">
              {patternsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : patterns && patterns.length > 0 ? (
                <ScrollArea className="h-[500px]">
                  <div className="space-y-3">
                    {patterns.map((pattern, i) => (
                      <Card key={i}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between mb-2">
                            <p className="font-medium">{pattern.pattern}</p>
                            <Badge variant="outline" className="text-xs">
                              {pattern.occurrences}x
                            </Badge>
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">Confiance</span>
                              <span>{Math.round(pattern.confidence * 100)}%</span>
                            </div>
                            <Progress value={pattern.confidence * 100} className="h-2" />
                          </div>
                          {pattern.lastSeen && (
                            <p className="text-xs text-muted-foreground mt-2">
                              Dernière occurrence: {formatDate(pattern.lastSeen)}
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <Card>
                  <CardContent className="py-8 text-center">
                    <BarChart className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-muted-foreground">Aucun pattern détecté</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Les patterns de travail apparaîtront après quelques jours d'utilisation
                    </p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <div className="mt-6 p-4 bg-muted/50 rounded-lg">
          <h4 className="text-sm font-medium flex items-center gap-2 mb-2">
            <Download className="h-4 w-4" />
            Agent Windows
          </h4>
          <p className="text-xs text-muted-foreground mb-2">
            Télécharge et lance l'agent sur ton PC Windows pour activer la surveillance écran.
          </p>
          <code className="text-xs block bg-background p-2 rounded">
            pip install dxcam opencv-python pillow websocket-client pywin32 psutil
          </code>
        </div>
      </SheetContent>
    </Sheet>
  );
}
