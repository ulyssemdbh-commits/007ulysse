import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { 
  RefreshCw, 
  CheckCircle, 
  XCircle, 
  AlertCircle, 
  Clock, 
  Database, 
  Bot, 
  Music, 
  Calendar, 
  Mail, 
  Search, 
  Cpu,
  Zap,
  Activity,
  Play,
  Loader2,
  Home
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface ServiceStatus {
  name: string;
  status: "ok" | "error" | "warning" | "unavailable";
  message: string;
  latencyMs?: number;
  details?: any;
}

interface ToolStatus {
  name: string;
  category: string;
  available: boolean;
}

interface DiagnosticsResult {
  timestamp: string;
  system: {
    uptime: number;
    memoryUsage: {
      heapUsed: number;
      heapTotal: number;
      rss: number;
    };
    nodeVersion: string;
    environment: string;
  };
  services: ServiceStatus[];
  tools: ToolStatus[];
  connections: {
    discord: { connected: boolean; botName?: string; guilds?: number };
    spotify: { connected: boolean; user?: string };
    calendar: { connected: boolean };
    email: { connected: boolean };
    notion: { connected: boolean };
    todoist: { connected: boolean };
  };
  apis: {
    openai: { available: boolean; model?: string };
    gemini: { available: boolean };
    serper: { available: boolean };
    perplexity: { available: boolean };
  };
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "ok":
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    case "error":
      return <XCircle className="h-5 w-5 text-red-500" />;
    case "warning":
      return <AlertCircle className="h-5 w-5 text-yellow-500" />;
    default:
      return <Clock className="h-5 w-5 text-muted-foreground" />;
  }
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    ok: "default",
    error: "destructive",
    warning: "secondary",
    unavailable: "outline"
  };
  return <Badge variant={variants[status] || "outline"}>{status.toUpperCase()}</Badge>;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

export default function Diagnostics() {
  const [, navigate] = useLocation();
  const [selectedTool, setSelectedTool] = useState("");
  const [toolArgs, setToolArgs] = useState("{}");
  const [toolResult, setToolResult] = useState<any>(null);

  const { data, isLoading, refetch, isFetching } = useQuery<DiagnosticsResult>({
    queryKey: ["/api/v2/diagnostics"],
    refetchInterval: 30000
  });

  const testToolMutation = useMutation({
    mutationFn: async ({ toolName, args }: { toolName: string; args: any }) => {
      const response = await apiRequest("POST", "/api/v2/diagnostics/test-tool", {
        toolName,
        args
      });
      return response.json();
    },
    onSuccess: (data) => {
      setToolResult(data);
    }
  });

  const handleTestTool = () => {
    if (!selectedTool) return;
    try {
      const args = JSON.parse(toolArgs);
      testToolMutation.mutate({ toolName: selectedTool, args });
    } catch (e) {
      setToolResult({ error: "JSON invalide pour les arguments" });
    }
  };

  const toolsByCategory = data?.tools?.reduce((acc, tool) => {
    if (!acc[tool.category]) acc[tool.category] = [];
    acc[tool.category].push(tool);
    return acc;
  }, {} as Record<string, ToolStatus[]>) || {};

  return (
    <div className="container mx-auto p-6 max-w-7xl" data-testid="diagnostics-page">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/")} data-testid="button-back-dashboard">
            <Home className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Diagnostics Ulysse</h1>
            <p className="text-muted-foreground">
              Statut complet du système et tests des outils
            </p>
          </div>
        </div>
        <Button 
          onClick={() => refetch()} 
          disabled={isFetching}
          data-testid="button-refresh-diagnostics"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
          Actualiser
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : data ? (
        <div className="grid gap-6">
          {/* System Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="h-5 w-5" />
                Système
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-4 bg-muted rounded-lg" data-testid="stat-uptime">
                  <div className="text-2xl font-bold">{formatUptime(data.system.uptime)}</div>
                  <div className="text-sm text-muted-foreground">Uptime</div>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg" data-testid="stat-memory">
                  <div className="text-2xl font-bold">{formatBytes(data.system.memoryUsage.heapUsed)}</div>
                  <div className="text-sm text-muted-foreground">Mémoire utilisée</div>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg" data-testid="stat-node">
                  <div className="text-2xl font-bold">{data.system.nodeVersion}</div>
                  <div className="text-sm text-muted-foreground">Node.js</div>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg" data-testid="stat-env">
                  <div className="text-2xl font-bold capitalize">{data.system.environment}</div>
                  <div className="text-sm text-muted-foreground">Environnement</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Services Status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Services Principaux
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3">
                {data.services.map((service) => (
                  <div 
                    key={service.name} 
                    className="flex items-center justify-between p-3 border rounded-lg"
                    data-testid={`service-${service.name.toLowerCase()}`}
                  >
                    <div className="flex items-center gap-3">
                      <StatusIcon status={service.status} />
                      <div>
                        <div className="font-medium">{service.name}</div>
                        <div className="text-sm text-muted-foreground">{service.message}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {service.latencyMs && (
                        <span className="text-sm text-muted-foreground">
                          {service.latencyMs}ms
                        </span>
                      )}
                      <StatusBadge status={service.status} />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Connections */}
          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  Connexions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between" data-testid="connection-discord">
                    <div className="flex items-center gap-2">
                      <Bot className="h-4 w-4" />
                      <span>Discord</span>
                    </div>
                    <Badge variant={data.connections.discord.connected ? "default" : "outline"}>
                      {data.connections.discord.connected 
                        ? `${data.connections.discord.botName} (${data.connections.discord.guilds} serveurs)` 
                        : "Déconnecté"}
                    </Badge>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between" data-testid="connection-spotify">
                    <div className="flex items-center gap-2">
                      <Music className="h-4 w-4" />
                      <span>Spotify</span>
                    </div>
                    <Badge variant={data.connections.spotify.connected ? "default" : "outline"}>
                      {data.connections.spotify.connected ? data.connections.spotify.user : "Déconnecté"}
                    </Badge>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between" data-testid="connection-calendar">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      <span>Google Calendar</span>
                    </div>
                    <Badge variant={data.connections.calendar.connected ? "default" : "outline"}>
                      {data.connections.calendar.connected ? "Connecté" : "Déconnecté"}
                    </Badge>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between" data-testid="connection-email">
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      <span>AgentMail</span>
                    </div>
                    <Badge variant={data.connections.email.connected ? "default" : "outline"}>
                      {data.connections.email.connected ? "Connecté" : "Déconnecté"}
                    </Badge>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between" data-testid="connection-todoist">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4" />
                      <span>Todoist</span>
                    </div>
                    <Badge variant={data.connections.todoist.connected ? "default" : "outline"}>
                      {data.connections.todoist.connected ? "Connecté" : "Déconnecté"}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Search className="h-5 w-5" />
                  APIs IA
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between" data-testid="api-openai">
                    <span>OpenAI</span>
                    <Badge variant={data.apis.openai.available ? "default" : "destructive"}>
                      {data.apis.openai.available ? `OK (${data.apis.openai.model})` : "Indisponible"}
                    </Badge>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between" data-testid="api-gemini">
                    <span>Gemini</span>
                    <Badge variant={data.apis.gemini.available ? "default" : "destructive"}>
                      {data.apis.gemini.available ? "OK" : "Indisponible"}
                    </Badge>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between" data-testid="api-serper">
                    <span>Serper (Web Search)</span>
                    <Badge variant={data.apis.serper.available ? "default" : "destructive"}>
                      {data.apis.serper.available ? "OK" : "Indisponible"}
                    </Badge>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between" data-testid="api-perplexity">
                    <span>Perplexity</span>
                    <Badge variant={data.apis.perplexity.available ? "default" : "outline"}>
                      {data.apis.perplexity.available ? "OK" : "Non configuré"}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tools */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Outils Ulysse ({data.tools.length})
              </CardTitle>
              <CardDescription>
                Tous les outils disponibles pour l'assistant IA
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4">
                {Object.entries(toolsByCategory).map(([category, tools]) => (
                  <div key={category}>
                    <h4 className="font-medium mb-2 text-sm text-muted-foreground">{category}</h4>
                    <div className="flex flex-wrap gap-2">
                      {tools.map((tool) => (
                        <Badge 
                          key={tool.name}
                          variant={tool.available ? "secondary" : "outline"}
                          className="cursor-pointer"
                          onClick={() => setSelectedTool(tool.name)}
                          data-testid={`tool-${tool.name}`}
                        >
                          {tool.name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Tool Tester */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Play className="h-5 w-5" />
                Testeur d'outil
              </CardTitle>
              <CardDescription>
                Testez un outil spécifique avec des arguments personnalisés
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex gap-4">
                  <Input
                    placeholder="Nom de l'outil (ex: discord_status)"
                    value={selectedTool}
                    onChange={(e) => setSelectedTool(e.target.value)}
                    className="flex-1"
                    data-testid="input-tool-name"
                  />
                  <Input
                    placeholder='Arguments JSON (ex: {"query": "test"})'
                    value={toolArgs}
                    onChange={(e) => setToolArgs(e.target.value)}
                    className="flex-1"
                    data-testid="input-tool-args"
                  />
                  <Button 
                    onClick={handleTestTool}
                    disabled={!selectedTool || testToolMutation.isPending}
                    data-testid="button-test-tool"
                  >
                    {testToolMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                {toolResult && (
                  <div className="p-4 bg-muted rounded-lg overflow-auto max-h-64">
                    <pre className="text-sm" data-testid="text-tool-result">
                      {JSON.stringify(toolResult, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Timestamp */}
          <div className="text-center text-sm text-muted-foreground" data-testid="text-last-updated">
            Dernière mise à jour: {new Date(data.timestamp).toLocaleString('fr-FR')}
          </div>
        </div>
      ) : (
        <Card data-testid="card-error">
          <CardContent className="p-8 text-center">
            <XCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
            <p data-testid="text-error-message">Impossible de charger les diagnostics</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
