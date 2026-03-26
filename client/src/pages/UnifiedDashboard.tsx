import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { Link } from "wouter";
import {
  BarChart3, TrendingUp, TrendingDown, AlertTriangle, Activity,
  DollarSign, ShoppingCart, Utensils, Brain, ArrowLeft,
  ChevronRight, CheckCircle2, XCircle, Minus, Bell,
  Truck, PieChart, Zap
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart as RePieChart, Pie, Cell, Area, AreaChart
} from "recharts";

const COLORS = ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe", "#ede9fe"];
const STATUS_COLORS = { critical: "bg-red-500", warning: "bg-amber-500", info: "bg-blue-500" };

function n(v: any, decimals = 0): string {
  const num = Number(v);
  return isNaN(num) ? "0" : num.toFixed(decimals);
}

function TrendIcon({ trend }: { trend?: string }) {
  if (trend === "up" || trend === "increasing" || trend === "improving") return <TrendingUp className="w-4 h-4 text-green-500" />;
  if (trend === "down" || trend === "decreasing" || trend === "declining") return <TrendingDown className="w-4 h-4 text-red-500" />;
  return <Minus className="w-4 h-4 text-gray-400" />;
}

function MetricCard({ title, value, subtitle, icon: Icon, trend, className = "" }: {
  title: string; value: string | number; subtitle?: string;
  icon: any; trend?: string; className?: string;
}) {
  return (
    <Card className={`${className}`} data-testid={`metric-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{title}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
          </div>
          <div className="flex flex-col items-center gap-1">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Icon className="w-5 h-5 text-primary" />
            </div>
            {trend && <TrendIcon trend={trend} />}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AlertCard({ alert }: { alert: any }) {
  const severityColor = STATUS_COLORS[alert.severity as keyof typeof STATUS_COLORS] || "bg-gray-500";
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border bg-card" data-testid={`alert-${alert.id}`}>
      <div className={`w-2 h-2 rounded-full mt-2 ${severityColor}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{alert.title}</p>
          <Badge variant={alert.severity === "critical" ? "destructive" : "secondary"} className="text-xs">
            {alert.severity}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{alert.description}</p>
        {alert.actionSuggestion && (
          <p className="text-xs text-primary mt-1 italic">{alert.actionSuggestion}</p>
        )}
      </div>
      <TrendIcon trend={alert.trend} />
    </div>
  );
}

function OverviewTab({ overview, predictions }: { overview: any; predictions: any }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {overview?.hubrise && (
          <>
            <MetricCard
              title="CA HubRise"
              value={`${n(overview.hubrise.totalRevenue)}€`}
              subtitle={`${overview.hubrise.totalOrders || 0} commandes`}
              icon={DollarSign}
            />
            <MetricCard
              title="Ticket Moyen"
              value={`${n(overview.hubrise.avgTicket, 1)}€`}
              icon={ShoppingCart}
            />
          </>
        )}
        {overview?.system && (
          <>
            <MetricCard
              title="Santé Système"
              value={`${overview.system.healthScore || 0}/100`}
              subtitle={`Grade ${overview.system.healthGrade || "?"}`}
              icon={Activity}
            />
            <MetricCard
              title="Outils IA"
              value={`${n(overview.system.toolSuccessRate)}%`}
              subtitle="Taux de succès"
              icon={Brain}
            />
          </>
        )}
        {overview?.sports && (
          <>
            <MetricCard
              title="ROI Paris"
              value={`${n(overview.sports.roi, 1)}%`}
              subtitle={`Win rate: ${n(overview.sports.winRate)}%`}
              icon={TrendingUp}
              trend={overview.sports.roi > 0 ? "up" : "down"}
            />
            <MetricCard
              title="Paris Total"
              value={overview.sports.totalBets || 0}
              subtitle={`Profit: ${n(overview.sports.totalProfit)}€`}
              icon={PieChart}
            />
          </>
        )}
        {overview?.restaurants?.suguval && (
          <MetricCard
            title="Valentine"
            value={`${n(overview.restaurants.suguval.avgCompletionRate)}%`}
            subtitle={`${overview.restaurants.suguval.issuesCount || 0} alertes`}
            icon={Utensils}
          />
        )}
        {overview?.restaurants?.sugumaillane && (
          <MetricCard
            title="Maillane"
            value={`${n(overview.restaurants.sugumaillane.avgCompletionRate)}%`}
            subtitle={`${overview.restaurants.sugumaillane.issuesCount || 0} alertes`}
            icon={Utensils}
          />
        )}
      </div>

      {predictions?.alerts?.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="w-4 h-4" />
              Alertes Prédictives ({predictions.alerts.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {predictions.alerts.slice(0, 5).map((alert: any, i: number) => (
              <AlertCard key={i} alert={alert} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function HubriseTab({ period }: { period: string }) {
  const { data: hubrise, isLoading } = useQuery({
    queryKey: ["/api/v2/analytics/hubrise", period],
    enabled: true,
  });

  if (isLoading) return <div className="text-center py-8 text-muted-foreground">Chargement HubRise...</div>;
  if (!hubrise?.success) return <div className="text-center py-8 text-muted-foreground">Données HubRise non disponibles</div>;

  const dailyData = hubrise.daily || [];
  const serviceData = Object.entries(hubrise.byServiceType || {}).map(([name, data]: [string, any]) => ({
    name, orders: data.orders, revenue: data.revenue,
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <MetricCard title="Commandes" value={hubrise.summary?.totalOrders || 0} icon={ShoppingCart} />
        <MetricCard title="CA Total" value={`${n(hubrise.summary?.totalRevenue)}€`} icon={DollarSign} />
        <MetricCard title="Ticket Moyen" value={`${n(hubrise.summary?.avgTicket, 1)}€`} icon={BarChart3} />
      </div>

      {dailyData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">CA par jour</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => d?.substring(5)} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => `${n(v)}€`} />
                <Area type="monotone" dataKey="revenue" stroke="#6366f1" fill="#6366f1" fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {serviceData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Par type de service</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={serviceData}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="revenue" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="CA (€)" />
                <Bar dataKey="orders" fill="#a78bfa" radius={[4, 4, 0, 0]} name="Commandes" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PredictionsTab() {
  const { data: predictions, isLoading } = useQuery({
    queryKey: ["/api/v2/analytics/predictions"],
  });

  if (isLoading) return <div className="text-center py-8 text-muted-foreground">Analyse prédictive en cours...</div>;
  if (!predictions?.success) return <div className="text-center py-8 text-muted-foreground">Données prédictives non disponibles</div>;

  return (
    <div className="space-y-6">
      {predictions.forecasts?.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="w-4 h-4" />
              Prévisions CA par jour
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={predictions.forecasts}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="dayOfWeek" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => `${n(v)}€`} />
                <Bar dataKey="predictedRevenue" fill="#6366f1" radius={[4, 4, 0, 0]} name="CA prévu (€)" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {predictions.costTrends?.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShoppingCart className="w-4 h-4" />
              Tendances des Coûts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {predictions.costTrends.slice(0, 8).map((trend: any, i: number) => (
                <div key={i} className="flex items-center justify-between p-2 rounded border" data-testid={`cost-trend-${i}`}>
                  <div className="flex items-center gap-2">
                    <TrendIcon trend={trend.trend} />
                    <span className="text-sm font-medium">{trend.category}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-muted-foreground">{trend.previousMonthAvg}€</span>
                    <ChevronRight className="w-3 h-3" />
                    <span className={trend.trend === "up" ? "text-red-500 font-medium" : trend.trend === "down" ? "text-green-500 font-medium" : ""}>
                      {trend.currentMonthAvg}€
                    </span>
                    <Badge variant={trend.isAnomaly ? "destructive" : "secondary"} className="text-xs">
                      {trend.changePercent > 0 ? "+" : ""}{trend.changePercent}%
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {predictions.suppliers?.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Truck className="w-4 h-4" />
              Top Fournisseurs (60j)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={predictions.suppliers.slice(0, 10)} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="supplier" type="category" width={120} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: any) => `${n(v)}€`} />
                <Bar dataKey="totalSpent" fill="#a78bfa" radius={[0, 4, 4, 0]} name="Total (€)" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {predictions.alerts?.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="w-4 h-4" />
              Alertes ({predictions.alerts.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {predictions.alerts.map((alert: any, i: number) => (
              <AlertCard key={i} alert={alert} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SportsTab() {
  const { data: sports, isLoading } = useQuery({
    queryKey: ["/api/v2/analytics/sports"],
  });

  if (isLoading) return <div className="text-center py-8 text-muted-foreground">Chargement statistiques sport...</div>;
  if (!sports?.success) return <div className="text-center py-8 text-muted-foreground">Données sports non disponibles</div>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard title="ROI" value={`${n(sports.overall?.roi, 1)}%`} icon={TrendingUp} trend={sports.overall?.roi > 0 ? "up" : "down"} />
        <MetricCard title="Win Rate" value={`${n(sports.overall?.winRate)}%`} icon={CheckCircle2} />
        <MetricCard title="Total Paris" value={sports.overall?.totalBets || 0} icon={PieChart} />
        <MetricCard title="Profit" value={`${n(sports.overall?.totalProfit)}€`} icon={DollarSign} trend={sports.overall?.totalProfit > 0 ? "up" : "down"} />
      </div>

      {sports.byLeague?.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Performance par Ligue</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={sports.byLeague.slice(0, 10)}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="league" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="roi" fill="#6366f1" radius={[4, 4, 0, 0]} name="ROI (%)" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {sports.byType?.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Par Type de Pari</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {sports.byType.map((type: any, i: number) => (
                <div key={i} className="flex items-center justify-between p-2 rounded border" data-testid={`bet-type-${i}`}>
                  <span className="text-sm font-medium">{type.betType || type.type}</span>
                  <div className="flex items-center gap-3 text-sm">
                    <span>{type.totalBets || type.count} paris</span>
                    <Badge variant={type.roi > 0 ? "default" : "destructive"} className="text-xs">
                      ROI: {n(type.roi, 1)}%
                    </Badge>
                    <span className="text-muted-foreground">WR: {n(type.winRate)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SystemTab() {
  const { data: system, isLoading } = useQuery({
    queryKey: ["/api/v2/analytics/system"],
  });

  if (isLoading) return <div className="text-center py-8 text-muted-foreground">Chargement système...</div>;
  if (!system?.success) return <div className="text-center py-8 text-muted-foreground">Données système non disponibles</div>;

  const kpis = system.kpis;
  const healthColor = kpis?.overallHealth?.score >= 80 ? "text-green-500" : kpis?.overallHealth?.score >= 60 ? "text-amber-500" : "text-red-500";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard title="Santé" value={`${kpis?.overallHealth?.score}/100`} subtitle={`Grade ${kpis?.overallHealth?.grade}`} icon={Activity} />
        <MetricCard title="Latence Moy." value={`${n(kpis?.kpi1_latency?.globalAvg)}ms`} icon={Zap} trend={kpis?.kpi1_latency?.trend} />
        <MetricCard title="Outils" value={`${n(kpis?.kpi2_toolSuccess?.globalSuccessRate)}%`} subtitle="Taux succès" icon={CheckCircle2} />
        <MetricCard title="Satisfaction" value={`${n(kpis?.kpi5_satisfaction?.overallScore)}/100`} icon={Brain} />
      </div>

      {system.memory && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Ressources Système</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 rounded-lg border">
                <p className="text-2xl font-bold">{system.memory.rss}MB</p>
                <p className="text-xs text-muted-foreground">RSS</p>
              </div>
              <div className="text-center p-3 rounded-lg border">
                <p className="text-2xl font-bold">{system.memory.heapUsed}MB</p>
                <p className="text-xs text-muted-foreground">Heap Used</p>
              </div>
              <div className="text-center p-3 rounded-lg border">
                <p className="text-2xl font-bold">{system.memory.heapTotal}MB</p>
                <p className="text-xs text-muted-foreground">Heap Total</p>
              </div>
              <div className="text-center p-3 rounded-lg border">
                <p className="text-2xl font-bold">{Math.floor(system.uptime / 3600)}h</p>
                <p className="text-xs text-muted-foreground">Uptime</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {kpis?.kpi4_learningVelocity && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Apprentissage</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 rounded-lg border">
                <p className="text-2xl font-bold">{kpis.kpi4_learningVelocity.patternsLast24h || 0}</p>
                <p className="text-xs text-muted-foreground">Patterns (24h)</p>
              </div>
              <div className="text-center p-3 rounded-lg border">
                <p className="text-2xl font-bold">{kpis.kpi4_learningVelocity.patternsLast7d || 0}</p>
                <p className="text-xs text-muted-foreground">Patterns (7j)</p>
              </div>
              <div className="text-center p-3 rounded-lg border">
                <p className="text-2xl font-bold capitalize">{kpis.kpi4_learningVelocity.trend || "stable"}</p>
                <p className="text-xs text-muted-foreground">Tendance</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PushNotificationsCard() {
  const { data: vapidData } = useQuery({ queryKey: ["/api/v2/push/vapid-key"] });
  const { data: subs } = useQuery({ queryKey: ["/api/v2/push/subscriptions"] });

  const [subscribing, setSubscribing] = useState(false);
  const [testSending, setTestSending] = useState(false);

  async function subscribe() {
    setSubscribing(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const vapidKey = vapidData?.publicKey;
      if (!vapidKey) throw new Error("VAPID key not available");

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      const keys = sub.toJSON();
      await fetch("/api/v2/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          endpoint: keys.endpoint,
          p256dh: keys.keys?.p256dh,
          auth: keys.keys?.auth,
          deviceName: navigator.userAgent.includes("Mobile") ? "Mobile" : "Desktop",
          alertTypes: ["morning_briefing", "anomaly", "sports_result", "system_alert"],
        }),
      });
    } catch (e: any) {
      console.error("Push subscription failed:", e);
    }
    setSubscribing(false);
  }

  async function sendTest() {
    setTestSending(true);
    try {
      await fetch("/api/v2/push/test", { method: "POST", credentials: "include" });
    } catch {}
    setTestSending(false);
  }

  const subscriptionCount = subs?.subscriptions?.length || 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="w-4 h-4" />
          Notifications Push
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Appareils abonnés: {subscriptionCount}</span>
          {subscriptionCount > 0 && (
            <Badge variant="default" className="text-xs">
              <CheckCircle2 className="w-3 h-3 mr-1" /> Actif
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={subscribe}
            disabled={subscribing}
            data-testid="button-subscribe-push"
          >
            {subscribing ? "Activation..." : "Activer sur cet appareil"}
          </Button>
          {subscriptionCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={sendTest}
              disabled={testSending}
              data-testid="button-test-push"
            >
              Tester
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function UnifiedDashboard() {
  const { user } = useAuth();
  const [period, setPeriod] = useState("30");

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ["/api/v2/analytics/overview"],
  });

  const { data: predictions } = useQuery({
    queryKey: ["/api/v2/analytics/predictions"],
  });

  const isOwner = user?.isOwner;
  const role = overview?.role || user?.role || "approved";

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-6 py-3">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon" data-testid="button-back-dashboard">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-lg font-bold" data-testid="text-dashboard-title">Analytics Ulysse</h1>
              <p className="text-xs text-muted-foreground">Vue unifiée — {new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
            </div>
          </div>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-32" data-testid="select-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 jours</SelectItem>
              <SelectItem value="30">30 jours</SelectItem>
              <SelectItem value="90">90 jours</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {overviewLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center space-y-3">
              <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto" />
              <p className="text-muted-foreground">Chargement du tableau de bord...</p>
            </div>
          </div>
        ) : (
          <Tabs defaultValue="overview" className="space-y-6">
            <TabsList className="flex flex-wrap gap-1" data-testid="tabs-analytics">
              <TabsTrigger value="overview" data-testid="tab-overview">Vue d'ensemble</TabsTrigger>
              {(isOwner || role === "suguval_only" || role === "sugumaillane_only") && (
                <TabsTrigger value="hubrise" data-testid="tab-hubrise">HubRise</TabsTrigger>
              )}
              {isOwner && <TabsTrigger value="predictions" data-testid="tab-predictions">Prédictions</TabsTrigger>}
              {isOwner && <TabsTrigger value="sports" data-testid="tab-sports">Sports</TabsTrigger>}
              {isOwner && <TabsTrigger value="system" data-testid="tab-system">Système</TabsTrigger>}
            </TabsList>

            <TabsContent value="overview">
              <OverviewTab overview={overview} predictions={predictions} />
              {isOwner && <div className="mt-6"><PushNotificationsCard /></div>}
            </TabsContent>

            <TabsContent value="hubrise">
              <HubriseTab period={period} />
            </TabsContent>

            <TabsContent value="predictions">
              <PredictionsTab />
            </TabsContent>

            <TabsContent value="sports">
              <SportsTab />
            </TabsContent>

            <TabsContent value="system">
              <SystemTab />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}
