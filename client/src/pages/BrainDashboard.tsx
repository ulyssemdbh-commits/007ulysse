import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Brain, RefreshCw, Download, AlertTriangle, TrendingUp, Activity, Zap, Target, Home } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface DomainStats {
  count: number;
  avgConfidence: number;
  avgUsefulness: number;
  totalPatterns: number;
}

interface LearningStats {
  totalTopics: number;
  domainStats: Record<string, DomainStats>;
  patterns: {
    structural: number;
    situational: number;
  };
  health: {
    lowConfidence: number;
    highPerformance: number;
    recentlyDecayed: number;
  };
  lastUpdate: string;
}

interface Alert {
  type: string;
  severity: string;
  topic?: string;
  domain?: string;
  message: string;
  confidence?: number;
}

interface TopPattern {
  id: number;
  topic: string;
  domain: string;
  patternType: string;
  usefulness: number;
  confidence: number;
  trackedPredictions: number;
}

export default function BrainDashboard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery<LearningStats>({
    queryKey: ["/api/learning/stats"]
  });

  const { data: alerts } = useQuery<{ alerts: Alert[]; summary: { total: number; warnings: number } }>({
    queryKey: ["/api/learning/alerts"]
  });

  const { data: metrics } = useQuery<Record<string, number>>({
    queryKey: ["/api/learning/metrics"]
  });

  const { data: topPatterns } = useQuery<{ patterns: TopPattern[]; total: number }>({
    queryKey: ["/api/learning/top-patterns"]
  });

  const invalidateLearningQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/learning/stats"] });
    queryClient.invalidateQueries({ queryKey: ["/api/learning/alerts"] });
    queryClient.invalidateQueries({ queryKey: ["/api/learning/metrics"] });
    queryClient.invalidateQueries({ queryKey: ["/api/learning/top-patterns"] });
  };

  const triggerMutation = useMutation({
    mutationFn: async (eventType: string) => {
      return apiRequest("POST", "/api/learning/trigger", { eventType });
    },
    onSuccess: () => {
      toast({ title: "Cycle d'apprentissage lancé" });
      invalidateLearningQueries();
    },
    onError: () => {
      toast({ title: "Erreur", variant: "destructive" });
    }
  });

  const decayMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/learning/decay", {});
    },
    onSuccess: (data: any) => {
      toast({ title: `Decay appliqué: ${data.decayed} topics` });
      invalidateLearningQueries();
    },
    onError: () => {
      toast({ title: "Erreur lors du decay", variant: "destructive" });
    }
  });

  const domainColors: Record<string, string> = {
    sports: "bg-green-500",
    trading: "bg-blue-500",
    sugu: "bg-purple-500",
    dev: "bg-orange-500",
    perso: "bg-pink-500",
    autre: "bg-gray-500"
  };

  const domainLabels: Record<string, string> = {
    sports: "Sports",
    trading: "Trading",
    sugu: "SUGU",
    dev: "Dev",
    perso: "Personnel",
    autre: "Autre"
  };

  if (statsLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Chargement du cerveau...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6" data-testid="brain-dashboard">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/")} data-testid="button-back-dashboard">
              <Home className="w-4 h-4" />
            </Button>
            <Brain className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">Cerveau Ulysse</h1>
              <p className="text-muted-foreground text-sm">Système d'apprentissage autonome V3</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchStats()}
              data-testid="button-refresh-stats"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Actualiser
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => triggerMutation.mutate("manual")}
              disabled={triggerMutation.isPending}
              data-testid="button-trigger-learning"
            >
              <Zap className="h-4 w-4 mr-2" />
              Lancer cycle
            </Button>
            <Button
              variant="outline"
              size="sm"
              asChild
              data-testid="button-export-brain"
            >
              <a href="/api/learning/export" download>
                <Download className="h-4 w-4 mr-2" />
                Exporter
              </a>
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Topics Total</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.totalTopics || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Patterns Gagnants</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-500">{metrics?.learning_patterns_winning || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Confiance Moyenne</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metrics?.learning_confidence_avg || 50}%</div>
              <Progress value={metrics?.learning_confidence_avg || 50} className="mt-2" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Prédictions Tracées</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metrics?.learning_predictions_tracked || 0}</div>
            </CardContent>
          </Card>
        </div>

        {alerts && alerts.summary.warnings > 0 && (
          <Card className="border-yellow-500/50 bg-yellow-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                Alertes ({alerts.summary.warnings})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {alerts.alerts.filter(a => a.severity === "warning").slice(0, 3).map((alert, i) => (
                  <div key={i} className="text-sm text-muted-foreground">
                    {alert.message}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="domains">
          <TabsList>
            <TabsTrigger value="domains" data-testid="tab-domains">Domaines</TabsTrigger>
            <TabsTrigger value="patterns" data-testid="tab-patterns">Top Patterns</TabsTrigger>
            <TabsTrigger value="health" data-testid="tab-health">Santé</TabsTrigger>
          </TabsList>

          <TabsContent value="domains" className="mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {stats?.domainStats && Object.entries(stats.domainStats).map(([domain, domainData]) => (
                <Card key={domain}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full ${domainColors[domain]}`} />
                      {domainLabels[domain] || domain}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Topics</span>
                        <span className="font-medium">{domainData.count}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Confiance</span>
                        <span className="font-medium">{domainData.avgConfidence}%</span>
                      </div>
                      <Progress value={domainData.avgConfidence} />
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Utilité</span>
                        <span className="font-medium">{domainData.avgUsefulness}%</span>
                      </div>
                      <Progress value={domainData.avgUsefulness} className="bg-muted" />
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Patterns</span>
                        <span className="font-medium">{domainData.totalPatterns}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="patterns" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Top Patterns par Utilité
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px]">
                  <div className="space-y-3">
                    {topPatterns?.patterns.map((pattern) => (
                      <div
                        key={pattern.id}
                        className="flex items-center justify-between p-3 rounded-lg border bg-card"
                      >
                        <div className="flex-1">
                          <div className="font-medium text-sm">{pattern.topic}</div>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className="text-xs">
                              {pattern.patternType}
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              {pattern.domain}
                            </Badge>
                            {pattern.trackedPredictions > 0 && (
                              <span className="text-xs text-muted-foreground">
                                {pattern.trackedPredictions} prédictions
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-bold text-green-500">{pattern.usefulness}%</div>
                          <div className="text-xs text-muted-foreground">conf: {pattern.confidence}%</div>
                        </div>
                      </div>
                    ))}
                    {(!topPatterns?.patterns || topPatterns.patterns.length === 0) && (
                      <div className="text-center text-muted-foreground py-8">
                        Aucun pattern détecté
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="health" className="mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    État du Système
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span>Patterns structurels</span>
                    <Badge>{stats?.patterns.structural || 0}</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Patterns situationnels</span>
                    <Badge variant="secondary">{stats?.patterns.situational || 0}</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Confiance faible (&lt;30%)</span>
                    <Badge variant="destructive">{stats?.health.lowConfidence || 0}</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Haute performance (&gt;80%)</span>
                    <Badge className="bg-green-500">{stats?.health.highPerformance || 0}</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Décroissance récente</span>
                    <Badge variant="outline">{stats?.health.recentlyDecayed || 0}</Badge>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Target className="h-5 w-5" />
                    Actions
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Button
                    className="w-full"
                    onClick={() => triggerMutation.mutate("prediction_added")}
                    disabled={triggerMutation.isPending}
                    data-testid="button-trigger-prediction"
                  >
                    Analyser prédictions récentes
                  </Button>
                  <Button
                    className="w-full"
                    variant="outline"
                    onClick={() => decayMutation.mutate()}
                    disabled={decayMutation.isPending}
                    data-testid="button-apply-decay"
                  >
                    Appliquer decay confiance
                  </Button>
                  <Button
                    className="w-full"
                    variant="outline"
                    onClick={() => triggerMutation.mutate("pattern_detected")}
                    disabled={triggerMutation.isPending}
                    data-testid="button-detect-patterns"
                  >
                    Détecter nouveaux patterns
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        <div className="text-xs text-muted-foreground text-center">
          Dernière mise à jour: {stats?.lastUpdate ? new Date(stats.lastUpdate).toLocaleString("fr-FR") : "N/A"}
        </div>
      </div>
    </div>
  );
}
