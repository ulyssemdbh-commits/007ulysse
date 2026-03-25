import { useState } from "react";
import { useLocation } from "wouter";
import { useTabListener } from "@/hooks/useAppNavigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { 
  RefreshCw, 
  Code2, 
  TestTube,
  Hammer,
  AlertTriangle,
  BarChart3,
  Zap,
  FileCode,
  GitBranch,
  Play,
  Check,
  X,
  Clock,
  Activity,
  TrendingUp,
  Settings,
  Rocket,
  Paintbrush,
  Search,
  Home
} from "lucide-react";

type DevMode = "ship" | "craft" | "audit";

interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  failures: Array<{ testName: string; file: string; message: string }>;
}

interface BuildError {
  file: string;
  line: number;
  message: string;
  code?: string;
  severity: string;
}

interface ErrorStats {
  total: number;
  bySource: Record<string, number>;
  byLevel: Record<string, number>;
  topErrors: Array<{ message: string; count: number }>;
}

interface PerfStats {
  api: { avgDurationMs: number; p95Ms: number; totalRequests: number };
  db: { avgDurationMs: number; p95Ms: number; totalRequests: number };
  externalApi: { avgDurationMs: number; p95Ms: number; totalRequests: number };
}

interface InsightsData {
  mode: { mode: DevMode; preferences: any };
  tests: { recent: any[]; summary: string };
  builds: { recent: any[]; summary: string };
  errors: { stats: ErrorStats; summary: string };
  usage: { stats: any[]; personas: any[]; summary: string };
  performance: { stats: PerfStats; slowEndpoints: any[]; slowQueries: any[]; summary: string };
  patches: { pending: any[]; summary: string };
  styleGuide: { guide: any; summary: string };
}

const MODE_ICONS: Record<DevMode, typeof Rocket> = {
  ship: Rocket,
  craft: Paintbrush,
  audit: Search
};

const MODE_COLORS: Record<DevMode, string> = {
  ship: "bg-orange-500",
  craft: "bg-blue-500",
  audit: "bg-purple-500"
};

export default function UlysseInsights() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("overview");
  useTabListener(setActiveTab, ["overview", "tests", "errors", "performance", "usage", "codebase", "patches"]);

  const { data: insights, isLoading, refetch } = useQuery<InsightsData>({
    queryKey: ["/api/ulysse-dev/insights"],
    refetchInterval: 60000
  });

  const setModeMutation = useMutation({
    mutationFn: async (mode: DevMode) => {
      return apiRequest("POST", "/api/ulysse-dev/mode", { mode });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ulysse-dev/insights"] });
      toast({ title: "Mode changé avec succès" });
    }
  });

  const scanCodebaseMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/ulysse-dev/codebase/scan", { rootDir: "." });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ulysse-dev/insights"] });
      toast({ title: "Codebase scanné avec succès" });
    }
  });

  const extractStyleMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/ulysse-dev/style-guide/extract", { rootDir: "." });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ulysse-dev/insights"] });
      toast({ title: "Guide de style extrait avec succès" });
    }
  });

  const runTestsMutation = useMutation({
    mutationFn: async (type: string) => {
      return apiRequest("POST", "/api/ulysse-dev/tests/run", { type });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ulysse-dev/insights"] });
      toast({ title: "Tests lancés" });
    }
  });

  const runBuildMutation = useMutation({
    mutationFn: async (type: string) => {
      return apiRequest("POST", "/api/ulysse-dev/builds/run", { type });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ulysse-dev/insights"] });
      toast({ title: "Build lancé" });
    }
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const currentMode = insights?.mode?.mode || "craft";
  const ModeIcon = MODE_ICONS[currentMode];

  return (
    <div className="container mx-auto p-6 max-w-7xl" data-testid="page-ulysse-insights">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/")} data-testid="button-back-dashboard">
            <Home className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3" data-testid="text-page-title">
              <Code2 className="w-8 h-8" />
              Ulysse Dev++
            </h1>
            <p className="text-muted-foreground mt-1">
              Observabilité et intelligence augmentée pour le développement
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => refetch()}
            data-testid="button-refresh"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Rafraîchir
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {(["ship", "craft", "audit"] as DevMode[]).map((mode) => {
          const Icon = MODE_ICONS[mode];
          const isActive = currentMode === mode;
          return (
            <Card 
              key={mode}
              className={`cursor-pointer transition-all ${isActive ? "ring-2 ring-primary" : "hover-elevate"}`}
              onClick={() => setModeMutation.mutate(mode)}
              data-testid={`card-mode-${mode}`}
            >
              <CardContent className="p-4 flex items-center gap-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${MODE_COLORS[mode]} text-white`}>
                  <Icon className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold capitalize">{mode}</h3>
                  <p className="text-sm text-muted-foreground">
                    {mode === "ship" && "Livraison rapide"}
                    {mode === "craft" && "Qualité équilibrée"}
                    {mode === "audit" && "Analyse seule"}
                  </p>
                </div>
                {isActive && <Badge>Actif</Badge>}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4" data-testid="tabs-insights">
          <TabsTrigger value="overview" data-testid="tab-overview">
            <Activity className="w-4 h-4 mr-2" />
            Vue d'ensemble
          </TabsTrigger>
          <TabsTrigger value="tests" data-testid="tab-tests">
            <TestTube className="w-4 h-4 mr-2" />
            Tests & Build
          </TabsTrigger>
          <TabsTrigger value="errors" data-testid="tab-errors">
            <AlertTriangle className="w-4 h-4 mr-2" />
            Erreurs
          </TabsTrigger>
          <TabsTrigger value="performance" data-testid="tab-performance">
            <Zap className="w-4 h-4 mr-2" />
            Performance
          </TabsTrigger>
          <TabsTrigger value="usage" data-testid="tab-usage">
            <BarChart3 className="w-4 h-4 mr-2" />
            Usage
          </TabsTrigger>
          <TabsTrigger value="codebase" data-testid="tab-codebase">
            <FileCode className="w-4 h-4 mr-2" />
            Codebase
          </TabsTrigger>
          <TabsTrigger value="patches" data-testid="tab-patches">
            <GitBranch className="w-4 h-4 mr-2" />
            Patches
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Card data-testid="card-stat-tests">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <TestTube className="w-4 h-4" />
                  <span className="text-sm">Tests</span>
                </div>
                <div className="text-2xl font-bold" data-testid="text-tests-count">
                  {insights?.tests?.recent?.[0]?.summary?.passed || 0} / {insights?.tests?.recent?.[0]?.summary?.total || 0}
                </div>
                <p className="text-sm text-muted-foreground">passés</p>
              </CardContent>
            </Card>

            <Card data-testid="card-stat-errors">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <AlertTriangle className="w-4 h-4" />
                  <span className="text-sm">Erreurs (7j)</span>
                </div>
                <div className="text-2xl font-bold" data-testid="text-errors-count">
                  {insights?.errors?.stats?.total || 0}
                </div>
                <p className="text-sm text-muted-foreground">
                  {insights?.errors?.stats?.bySource?.frontend || 0} front, {insights?.errors?.stats?.bySource?.backend || 0} back
                </p>
              </CardContent>
            </Card>

            <Card data-testid="card-stat-perf">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <Zap className="w-4 h-4" />
                  <span className="text-sm">API (p95)</span>
                </div>
                <div className="text-2xl font-bold" data-testid="text-perf-p95">
                  {insights?.performance?.stats?.api?.p95Ms || 0}ms
                </div>
                <p className="text-sm text-muted-foreground">
                  avg: {insights?.performance?.stats?.api?.avgDurationMs || 0}ms
                </p>
              </CardContent>
            </Card>

            <Card data-testid="card-stat-patches">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <GitBranch className="w-4 h-4" />
                  <span className="text-sm">Patches</span>
                </div>
                <div className="text-2xl font-bold" data-testid="text-patches-count">
                  {insights?.patches?.pending?.length || 0}
                </div>
                <p className="text-sm text-muted-foreground">en attente</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Résumé Tests & Build</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-sm whitespace-pre-wrap text-muted-foreground" data-testid="text-tests-summary">
                  {insights?.tests?.summary || "Aucun test récent"}
                </pre>
                <Separator className="my-3" />
                <pre className="text-sm whitespace-pre-wrap text-muted-foreground" data-testid="text-builds-summary">
                  {insights?.builds?.summary || "Aucun build récent"}
                </pre>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Résumé Erreurs</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-sm whitespace-pre-wrap text-muted-foreground" data-testid="text-errors-summary">
                  {insights?.errors?.summary || "Aucune erreur récente"}
                </pre>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="tests">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-lg">Tests récents</CardTitle>
                <div className="flex gap-2">
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => runTestsMutation.mutate("vitest")}
                    disabled={runTestsMutation.isPending}
                    data-testid="button-run-vitest"
                  >
                    <Play className="w-4 h-4 mr-1" />
                    Vitest
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px]">
                  {insights?.tests?.recent?.map((run: any, i: number) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b last:border-b-0">
                      <div className="flex items-center gap-2">
                        {run.status === "passed" && <Check className="w-4 h-4 text-green-500" />}
                        {run.status === "failed" && <X className="w-4 h-4 text-red-500" />}
                        {run.status === "running" && <RefreshCw className="w-4 h-4 animate-spin" />}
                        <span className="font-mono text-sm">{run.type}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {new Date(run.startedAt).toLocaleString("fr-FR")}
                      </div>
                    </div>
                  ))}
                  {(!insights?.tests?.recent || insights.tests.recent.length === 0) && (
                    <p className="text-muted-foreground text-center py-4">Aucun test récent</p>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-lg">Builds récents</CardTitle>
                <div className="flex gap-2">
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => runBuildMutation.mutate("typescript")}
                    disabled={runBuildMutation.isPending}
                    data-testid="button-run-tsc"
                  >
                    <Hammer className="w-4 h-4 mr-1" />
                    TypeScript
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px]">
                  {insights?.builds?.recent?.map((run: any, i: number) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b last:border-b-0">
                      <div className="flex items-center gap-2">
                        {run.status === "success" && <Check className="w-4 h-4 text-green-500" />}
                        {run.status === "error" && <X className="w-4 h-4 text-red-500" />}
                        {run.status === "running" && <RefreshCw className="w-4 h-4 animate-spin" />}
                        <span className="font-mono text-sm">{run.type}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {new Date(run.startedAt).toLocaleString("fr-FR")}
                      </div>
                    </div>
                  ))}
                  {(!insights?.builds?.recent || insights.builds.recent.length === 0) && (
                    <p className="text-muted-foreground text-center py-4">Aucun build récent</p>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="errors">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            <Card>
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground mb-1">Frontend</div>
                <div className="text-2xl font-bold text-red-500">
                  {insights?.errors?.stats?.bySource?.frontend || 0}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground mb-1">Backend</div>
                <div className="text-2xl font-bold text-orange-500">
                  {insights?.errors?.stats?.bySource?.backend || 0}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground mb-1">Worker</div>
                <div className="text-2xl font-bold text-yellow-500">
                  {insights?.errors?.stats?.bySource?.worker || 0}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Top Erreurs</CardTitle>
              <CardDescription>Erreurs les plus fréquentes sur les 7 derniers jours</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[300px]">
                {insights?.errors?.stats?.topErrors?.map((err, i) => (
                  <div key={i} className="flex items-start gap-3 py-2 border-b last:border-b-0">
                    <Badge variant="outline" className="shrink-0">{err.count}x</Badge>
                    <p className="text-sm font-mono break-all">{err.message}</p>
                  </div>
                ))}
                {(!insights?.errors?.stats?.topErrors || insights.errors.stats.topErrors.length === 0) && (
                  <p className="text-muted-foreground text-center py-4">Aucune erreur</p>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="performance">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">API</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{insights?.performance?.stats?.api?.avgDurationMs || 0}ms</div>
                <p className="text-sm text-muted-foreground">
                  p95: {insights?.performance?.stats?.api?.p95Ms || 0}ms | 
                  {insights?.performance?.stats?.api?.totalRequests || 0} requêtes
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Base de données</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{insights?.performance?.stats?.db?.avgDurationMs || 0}ms</div>
                <p className="text-sm text-muted-foreground">
                  p95: {insights?.performance?.stats?.db?.p95Ms || 0}ms |
                  {insights?.performance?.stats?.db?.totalRequests || 0} queries
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">APIs externes</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{insights?.performance?.stats?.externalApi?.avgDurationMs || 0}ms</div>
                <p className="text-sm text-muted-foreground">
                  p95: {insights?.performance?.stats?.externalApi?.p95Ms || 0}ms
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Endpoints les plus lents</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[250px]">
                  {insights?.performance?.slowEndpoints?.map((ep, i) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b last:border-b-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono text-xs">{ep.method}</Badge>
                        <span className="text-sm font-mono">{ep.endpoint}</span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {ep.avgDurationMs}ms ({ep.count}x)
                      </div>
                    </div>
                  ))}
                  {(!insights?.performance?.slowEndpoints || insights.performance.slowEndpoints.length === 0) && (
                    <p className="text-muted-foreground text-center py-4">Aucune donnée</p>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Queries les plus lentes</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[250px]">
                  {insights?.performance?.slowQueries?.map((q, i) => (
                    <div key={i} className="py-2 border-b last:border-b-0">
                      <p className="text-sm font-mono truncate">{q.query}</p>
                      <p className="text-sm text-muted-foreground">
                        {q.avgDurationMs}ms | {q.count}x | ~{q.avgRows} rows
                      </p>
                    </div>
                  ))}
                  {(!insights?.performance?.slowQueries || insights.performance.slowQueries.length === 0) && (
                    <p className="text-muted-foreground text-center py-4">Aucune donnée</p>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="usage">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Usage par module</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[300px]">
                  {insights?.usage?.stats?.map((stat: any, i: number) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b last:border-b-0">
                      <div>
                        <span className="font-medium">{stat.module}</span>
                        <span className="text-muted-foreground mx-2">/</span>
                        <span className="text-sm text-muted-foreground">{stat.feature}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{stat.count}</Badge>
                        <span className="text-sm text-muted-foreground">
                          {stat.successRate.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  ))}
                  {(!insights?.usage?.stats || insights.usage.stats.length === 0) && (
                    <p className="text-muted-foreground text-center py-4">Aucune donnée d'usage</p>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Usage par persona</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[300px]">
                  {insights?.usage?.personas?.map((ps: any, i: number) => (
                    <div key={i} className="py-2 border-b last:border-b-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium capitalize">{ps.persona}</span>
                        <Badge>{ps.totalEvents} events</Badge>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(ps.modules || {}).map(([mod, count]) => (
                          <Badge key={mod} variant="outline" className="text-xs">
                            {mod}: {count as number}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                  {(!insights?.usage?.personas || insights.usage.personas.length === 0) && (
                    <p className="text-muted-foreground text-center py-4">Aucune donnée</p>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="codebase">
          <div className="flex gap-2 mb-4">
            <Button 
              onClick={() => scanCodebaseMutation.mutate()}
              disabled={scanCodebaseMutation.isPending}
              data-testid="button-scan-codebase"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${scanCodebaseMutation.isPending ? "animate-spin" : ""}`} />
              Scanner le codebase
            </Button>
            <Button 
              variant="outline"
              onClick={() => extractStyleMutation.mutate()}
              disabled={extractStyleMutation.isPending}
              data-testid="button-extract-style"
            >
              <FileCode className={`w-4 h-4 mr-2 ${extractStyleMutation.isPending ? "animate-spin" : ""}`} />
              Extraire le guide de style
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Guide de style</CardTitle>
              <CardDescription>Conventions et patterns détectés dans le codebase</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="text-sm whitespace-pre-wrap text-muted-foreground bg-muted p-4 rounded-md" data-testid="text-style-guide">
                {insights?.styleGuide?.summary || "Aucun guide de style extrait. Lancez l'extraction."}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="patches">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Patches en attente</CardTitle>
              <CardDescription>Modifications proposées par Ulysse</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                {insights?.patches?.pending?.map((patch: any) => (
                  <div key={patch.id} className="py-3 border-b last:border-b-0">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="font-medium">#{patch.id} {patch.title}</span>
                        <p className="text-sm text-muted-foreground">{patch.description}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" data-testid={`button-apply-patch-${patch.id}`}>
                          <Check className="w-4 h-4 mr-1" />
                          Appliquer
                        </Button>
                        <Button size="sm" variant="ghost" data-testid={`button-reject-patch-${patch.id}`}>
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    {patch.files && (
                      <div className="flex flex-wrap gap-1">
                        {(patch.files as any[]).map((f, i) => (
                          <Badge key={i} variant="outline" className="text-xs font-mono">
                            {f.action === "add" && "+"}
                            {f.action === "delete" && "-"}
                            {f.action === "modify" && "~"}
                            {f.path}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {(!insights?.patches?.pending || insights.patches.pending.length === 0) && (
                  <p className="text-muted-foreground text-center py-4">Aucun patch en attente</p>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
