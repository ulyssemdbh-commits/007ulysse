import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Activity, 
  AlertCircle, 
  CheckCircle, 
  Lightbulb, 
  RefreshCw,
  Wrench,
  X,
  Users,
  Mic,
  Volume2
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";

interface DeviceStatus {
  available: boolean;
  permission: "granted" | "denied" | "prompt" | "unknown";
  deviceName?: string;
}

interface ComponentHealth {
  status: "operational" | "degraded" | "down";
  responseTimeMs?: number;
  lastIssue?: string;
  details?: string;
}

interface SystemHealth {
  status: "healthy" | "degraded" | "unhealthy";
  score: number;
  components: {
    database: ComponentHealth;
    openai: ComponentHealth;
    memory: ComponentHealth;
    agentmail: ComponentHealth;
    calendar: ComponentHealth;
    apiHealth: ComponentHealth;
  };
  recentIssues: number;
  pendingImprovements: number;
  syncedFromIris?: number;
  lastChecked?: string;
}

interface Issue {
  id: number;
  type: string;
  component: string;
  description: string;
  severity: string;
  status: string;
  rootCause?: string;
  solution?: string;
  createdAt: string;
  reportedBy?: string;
  syncedToOwner?: boolean;
}

interface Improvement {
  id: number;
  category: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  createdAt: string;
}

interface DiagnosticsPanelProps {
  onClose: () => void;
  isOwner?: boolean;
}

export function DiagnosticsPanel({ onClose, isOwner: isOwnerProp }: DiagnosticsPanelProps) {
  const [activeTab, setActiveTab] = useState<"health" | "issues" | "iris" | "improvements">("health");
  const [micStatus, setMicStatus] = useState<DeviceStatus>({ available: false, permission: "unknown" });
  const [speakerStatus, setSpeakerStatus] = useState<DeviceStatus>({ available: false, permission: "unknown" });
  const [isCheckingDevices, setIsCheckingDevices] = useState(false);
  const { user } = useAuth();
  // Use prop if provided, otherwise fall back to useAuth hook
  const isOwner = isOwnerProp !== undefined ? isOwnerProp : (user?.isOwner || user?.role === "admin");
  const personaName = isOwner ? "Ulysse" : "Iris";

  const checkDevices = useCallback(async () => {
    setIsCheckingDevices(true);
    
    try {
      const SpeechRecognitionClass = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      const sttAvailable = !!SpeechRecognitionClass;
      const ttsAvailable = "speechSynthesis" in window;
      
      let micPermission: DeviceStatus["permission"] = "unknown";
      let micDeviceName: string | undefined;
      
      try {
        const permissionStatus = await navigator.permissions.query({ name: "microphone" as PermissionName });
        micPermission = permissionStatus.state as DeviceStatus["permission"];
      } catch {
        micPermission = "unknown";
      }
      
      if (micPermission === "granted" || micPermission === "unknown") {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const tracks = stream.getAudioTracks();
          if (tracks.length > 0) {
            micDeviceName = tracks[0].label || "Microphone";
            micPermission = "granted";
          }
          stream.getTracks().forEach(t => t.stop());
        } catch (err: any) {
          if (err.name === "NotAllowedError") {
            micPermission = "denied";
          }
        }
      }
      
      setMicStatus({
        available: sttAvailable,
        permission: micPermission,
        deviceName: micDeviceName,
      });
      
      let speakerDeviceName: string | undefined;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioOutputs = devices.filter(d => d.kind === "audiooutput");
        if (audioOutputs.length > 0) {
          speakerDeviceName = audioOutputs[0].label || "Haut-parleur";
        }
      } catch {
        speakerDeviceName = undefined;
      }
      
      setSpeakerStatus({
        available: ttsAvailable,
        permission: "granted",
        deviceName: speakerDeviceName,
      });
    } catch (err) {
      console.error("Device check error:", err);
    } finally {
      setIsCheckingDevices(false);
    }
  }, []);

  useEffect(() => {
    checkDevices();
  }, [checkDevices]);

  const { data: health, isLoading: healthLoading, refetch: refetchHealth } = useQuery<SystemHealth>({
    queryKey: ["/api/diagnostics/health"],
  });

  const { data: issues, refetch: refetchIssues } = useQuery<Issue[]>({
    queryKey: ["/api/diagnostics/issues"],
  });

  const { data: irisIssues, refetch: refetchIrisIssues } = useQuery<Issue[]>({
    queryKey: ["/api/diagnostics/iris-issues"],
    enabled: isOwner,
  });

  const { data: improvements, refetch: refetchImprovements } = useQuery<Improvement[]>({
    queryKey: ["/api/diagnostics/improvements"],
  });

  const uniqueImprovements = useMemo(() => {
    if (!improvements) return [];
    const seen = new Set<string>();
    return improvements.filter((imp) => {
      if (seen.has(imp.title)) return false;
      seen.add(imp.title);
      return true;
    });
  }, [improvements]);

  const runDiagnostics = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/diagnostics/run");
      return res.json();
    },
    onSuccess: () => {
      refetchHealth();
      refetchIssues();
      if (isOwner) refetchIrisIssues();
      refetchImprovements();
    },
  });

  const approveImprovement = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("PATCH", `/api/diagnostics/improvements/${id}/approve`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/diagnostics/improvements"] });
    },
  });

  const statusColors = {
    healthy: "text-green-500",
    degraded: "text-yellow-500",
    unhealthy: "text-red-500",
  };

  const severityColors = {
    low: "bg-blue-500/20 text-blue-500",
    medium: "bg-yellow-500/20 text-yellow-500",
    high: "bg-orange-500/20 text-orange-500",
    critical: "bg-red-500/20 text-red-500",
  };

  return (
    <Card className="fixed inset-4 md:inset-auto md:right-4 md:top-20 md:w-80 md:max-h-[calc(100vh-8rem)] z-50 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 p-4 border-b">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          <span className="font-semibold" data-testid="text-diagnostics-title">Diagnostics {personaName}</span>
        </div>
        <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-close-diagnostics">
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex gap-1 p-2 border-b flex-wrap">
        <Button
          size="sm"
          variant={activeTab === "health" ? "default" : "ghost"}
          onClick={() => setActiveTab("health")}
          data-testid="button-tab-health"
        >
          Santé
        </Button>
        <Button
          size="sm"
          variant={activeTab === "issues" ? "default" : "ghost"}
          onClick={() => setActiveTab("issues")}
          data-testid="button-tab-issues"
        >
          Problèmes
          {issues && issues.filter(i => i.status === "detected").length > 0 && (
            <Badge variant="destructive" className="ml-1 text-xs">
              {issues.filter(i => i.status === "detected").length}
            </Badge>
          )}
        </Button>
        {isOwner && (
          <Button
            size="sm"
            variant={activeTab === "iris" ? "default" : "ghost"}
            onClick={() => setActiveTab("iris")}
            data-testid="button-tab-iris"
          >
            <Users className="w-3 h-3 mr-1" />
            Iris
            {irisIssues && irisIssues.filter(i => i.status === "detected").length > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs">
                {irisIssues.filter(i => i.status === "detected").length}
              </Badge>
            )}
          </Button>
        )}
        <Button
          size="sm"
          variant={activeTab === "improvements" ? "default" : "ghost"}
          onClick={() => setActiveTab("improvements")}
          data-testid="button-tab-improvements"
        >
          Améliorations
          {uniqueImprovements.filter(i => i.status === "proposed").length > 0 && (
            <Badge variant="secondary" className="ml-1 text-xs">
              {uniqueImprovements.filter(i => i.status === "proposed").length}
            </Badge>
          )}
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        {activeTab === "health" && (
          <div className="space-y-5 p-4">
            {/* Status Header */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-card border">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center",
                  health?.status === "healthy" ? "bg-green-500/10" : 
                  health?.status === "degraded" ? "bg-yellow-500/10" : "bg-red-500/10"
                )}>
                  {health?.status === "healthy" ? (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  ) : (
                    <AlertCircle className={cn("w-5 h-5", statusColors[health?.status || "healthy"])} />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className={cn("font-semibold", statusColors[health?.status || "healthy"])}>
                      {health?.status === "healthy" ? "Système opérationnel" : 
                       health?.status === "degraded" ? "Performances réduites" : "Problèmes détectés"}
                    </span>
                    {health?.score !== undefined && (
                      <Badge 
                        variant="outline" 
                        className={cn(
                          "text-xs font-mono",
                          health.score >= 90 ? "border-green-500 text-green-500" :
                          health.score >= 70 ? "border-yellow-500 text-yellow-500" :
                          "border-red-500 text-red-500"
                        )}
                      >
                        {health.score}/100
                      </Badge>
                    )}
                  </div>
                  {health?.lastChecked && (
                    <p className="text-xs text-muted-foreground">
                      Dernière vérification: {new Date(health.lastChecked).toLocaleTimeString("fr-FR")}
                    </p>
                  )}
                </div>
              </div>
              <Button 
                size="icon" 
                variant="outline" 
                onClick={() => runDiagnostics.mutate()}
                disabled={runDiagnostics.isPending}
                data-testid="button-run-diagnostics"
              >
                <RefreshCw className={cn("w-4 h-4", runDiagnostics.isPending && "animate-spin")} />
              </Button>
            </div>

            {/* Server Components */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Composants Serveur
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {health?.components && Object.entries(health.components).map(([name, comp]) => {
                  const componentNames: Record<string, string> = {
                    database: "Base de données",
                    openai: "OpenAI",
                    memory: "Mémoire",
                    agentmail: "AgentMail",
                    calendar: "Calendrier",
                    apiHealth: "API Serveur"
                  };
                  const statusIcon = comp.status === "operational" ? (
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                  ) : comp.status === "degraded" ? (
                    <div className="w-2 h-2 rounded-full bg-yellow-500" />
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                  );
                  return (
                    <div key={name} className="p-2.5 rounded-lg bg-secondary/30 border border-border/50">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">{componentNames[name] || name}</span>
                        {statusIcon}
                      </div>
                      {comp.responseTimeMs !== undefined && (
                        <span className="text-[10px] text-muted-foreground">{comp.responseTimeMs}ms</span>
                      )}
                      {comp.lastIssue && (
                        <p className="text-[10px] text-destructive truncate mt-1">{comp.lastIssue}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Audio Connections */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Audio
                </h4>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2"
                  onClick={checkDevices}
                  disabled={isCheckingDevices}
                  data-testid="button-check-devices"
                >
                  <RefreshCw className={cn("w-3 h-3 mr-1", isCheckingDevices && "animate-spin")} />
                  <span className="text-xs">Tester</span>
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2.5 rounded-lg bg-secondary/30 border border-border/50">
                  <div className="flex items-center gap-2 mb-1">
                    <Mic className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium">Micro</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">
                      {micStatus.deviceName ? micStatus.deviceName.split(" - ")[0] : "—"}
                    </span>
                    <div className={cn(
                      "w-2 h-2 rounded-full",
                      micStatus.permission === "granted" ? "bg-green-500" : 
                      micStatus.permission === "denied" ? "bg-red-500" : "bg-yellow-500"
                    )} />
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-secondary/30 border border-border/50">
                  <div className="flex items-center gap-2 mb-1">
                    <Volume2 className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium">Haut-parleur</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">
                      {speakerStatus.deviceName ? speakerStatus.deviceName.split(" - ")[0] : "—"}
                    </span>
                    <div className={cn(
                      "w-2 h-2 rounded-full",
                      speakerStatus.available ? "bg-green-500" : "bg-yellow-500"
                    )} />
                  </div>
                </div>
              </div>
              {/* Audio diagnostic messages */}
              <div className="space-y-1 mt-2">
                <p className={cn(
                  "text-[10px]",
                  micStatus.permission === "granted" ? "text-green-600 dark:text-green-400" :
                  micStatus.permission === "denied" ? "text-red-500" : "text-muted-foreground"
                )}>
                  {micStatus.permission === "denied" 
                    ? "Micro bloqué - vérifier les permissions navigateur"
                    : micStatus.permission === "granted" && micStatus.available
                      ? "Reconnaissance vocale disponible"
                      : micStatus.available
                        ? "Micro disponible (permission requise)"
                        : "STT non supporté sur ce navigateur"}
                </p>
                <p className={cn(
                  "text-[10px]",
                  speakerStatus.available ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                )}>
                  {speakerStatus.available 
                    ? "Synthèse vocale disponible" 
                    : "TTS non supporté sur ce navigateur"}
                </p>
              </div>
            </div>

            {/* Stats Summary */}
            <div className={cn("grid gap-3", isOwner ? "grid-cols-3" : "grid-cols-2")}>
              <div className="p-3 rounded-lg bg-card border text-center">
                <p className={cn(
                  "text-2xl font-bold",
                  (issues?.filter(i => i.status === "detected").length || 0) > 0 ? "text-red-500" : "text-green-500"
                )}>
                  {issues?.filter(i => i.status === "detected").length || 0}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Problèmes</p>
              </div>
              <div className="p-3 rounded-lg bg-card border text-center">
                <p className="text-2xl font-bold text-primary">
                  {uniqueImprovements.filter(i => i.status === "proposed").length}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Améliorations</p>
              </div>
              {isOwner && (
                <div className="p-3 rounded-lg bg-card border text-center">
                  <p className="text-2xl font-bold text-blue-500">
                    {irisIssues?.filter(i => i.status === "detected").length || 0}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Via Iris</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "issues" && (
          <div className="space-y-3 p-4">
            {(!issues || issues.length === 0) ? (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>Aucun problème détecté</p>
              </div>
            ) : (
              issues.map((issue) => (
                <div key={issue.id} className="p-3 rounded-md border bg-card space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Wrench className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{issue.component}</span>
                    </div>
                    <Badge className={severityColors[issue.severity as keyof typeof severityColors]}>
                      {issue.severity}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{issue.description}</p>
                  {issue.solution && (
                    <p className="text-xs text-green-500">Solution: {issue.solution}</p>
                  )}
                  <Badge variant={issue.status === "resolved" ? "outline" : "secondary"}>
                    {issue.status}
                  </Badge>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "iris" && isOwner && (
          <div className="space-y-3 p-4">
            <div className="p-3 rounded-md bg-primary/10 text-sm">
              <p className="font-medium mb-1">Problèmes signalés par Iris</p>
              <p className="text-xs text-muted-foreground">
                Ces problèmes ont été rencontrés par les utilisateurs approuvés. 
                Ulysse peut les analyser pour améliorer le système.
              </p>
            </div>
            {(!irisIssues || irisIssues.length === 0) ? (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>Aucun problème signalé par Iris</p>
              </div>
            ) : (
              irisIssues.map((issue) => (
                <div key={issue.id} className="p-3 rounded-md border bg-card space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{issue.component}</span>
                    </div>
                    <Badge className={severityColors[issue.severity as keyof typeof severityColors]}>
                      {issue.severity}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{issue.description}</p>
                  {issue.solution && (
                    <p className="text-xs text-green-500">Solution: {issue.solution}</p>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={issue.status === "resolved" ? "outline" : "secondary"}>
                      {issue.status}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      via Iris
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "improvements" && (
          <div className="space-y-3 p-4">
            {uniqueImprovements.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Lightbulb className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>Aucune amélioration proposée</p>
                <p className="text-xs mt-1">{personaName} proposera des améliorations basées sur votre utilisation</p>
              </div>
            ) : (
              uniqueImprovements.map((improvement) => (
                <div key={improvement.id} className="p-3 rounded-md border bg-card space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium">{improvement.title}</span>
                    <Badge variant="outline">{improvement.category}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{improvement.description}</p>
                  <div className="flex items-center justify-between">
                    <Badge variant="secondary">{improvement.status}</Badge>
                    {improvement.status === "proposed" && (
                      <Button 
                        size="sm" 
                        onClick={() => approveImprovement.mutate(improvement.id)}
                        disabled={approveImprovement.isPending}
                        data-testid={`button-approve-improvement-${improvement.id}`}
                      >
                        Approuver
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </ScrollArea>
    </Card>
  );
}
