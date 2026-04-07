import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  RefreshCw,
  ExternalLink,
  Clock,
  Loader2,
  Folder,
  Rocket,
  Zap,
  CheckCircle2,
  Settings,
  BarChart3,
  ScrollText,
  CreditCard,
  Gauge,
  Cpu,
  HardDrive,
  TrendingUp,
  Package,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  API,
  devmaxFetch,
  devmaxApiRequest,
  useDevmaxAuth,
} from "./types";

export function MetricsPanel() {
  const { activeProject } = useDevmaxAuth();
  const pid = activeProject?.id || "";
  const [hours, setHours] = useState(24);

  const { data, isLoading, refetch } = useQuery({
    queryKey: [API, "metrics", pid, hours],
    queryFn: () => devmaxFetch(`${API}/metrics?hours=${hours}`, undefined, pid).then(r => r.json()),
    enabled: !!pid,
    refetchInterval: 30000,
  });

  const live = data?.live || [];
  const metrics = data?.metrics || [];

  const formatUptime = (seconds: number) => {
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    return `${Math.floor(seconds / 86400)}j ${Math.floor((seconds % 86400) / 3600)}h`;
  };

  return (
    <div className="space-y-4" data-testid="metrics-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold flex items-center gap-2"><BarChart3 className="w-5 h-5 text-emerald-400" /> Métriques</h3>
        <div className="flex gap-2">
          {[1, 6, 24, 72, 168].map(h => (
            <Button key={h} size="sm" variant={hours === h ? "default" : "outline"} className="text-xs" onClick={() => setHours(h)} data-testid={`metrics-hours-${h}`}>
              {h < 24 ? `${h}h` : `${h / 24}j`}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={() => refetch()} data-testid="button-refresh-metrics"><RefreshCw className="w-3 h-3" /></Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>
      ) : (
        <>
          {live.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {live.map((proc: any) => (
                <Card key={proc.name} className={cn("border", proc.status === "online" ? "border-emerald-500/20" : "border-red-500/20")} data-testid={`live-metric-${proc.name}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className={cn("w-2 h-2 rounded-full", proc.status === "online" ? "bg-emerald-400" : "bg-red-400")} />
                      <span className="text-sm font-mono font-bold">{proc.name}</span>
                      <Badge className={cn("text-[10px]", proc.status === "online" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400")}>
                        {proc.status}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="text-center">
                        <Cpu className="w-4 h-4 mx-auto text-blue-400 mb-1" />
                        <p className="text-lg font-bold">{proc.cpu}%</p>
                        <p className="text-[10px] text-muted-foreground">CPU</p>
                      </div>
                      <div className="text-center">
                        <HardDrive className="w-4 h-4 mx-auto text-purple-400 mb-1" />
                        <p className="text-lg font-bold">{proc.memory}<span className="text-xs">MB</span></p>
                        <p className="text-[10px] text-muted-foreground">RAM</p>
                      </div>
                      <div className="text-center">
                        <Clock className="w-4 h-4 mx-auto text-emerald-400 mb-1" />
                        <p className="text-sm font-bold">{formatUptime(proc.uptime)}</p>
                        <p className="text-[10px] text-muted-foreground">Uptime</p>
                      </div>
                      <div className="text-center">
                        <RefreshCw className="w-4 h-4 mx-auto text-amber-400 mb-1" />
                        <p className="text-lg font-bold">{proc.restarts}</p>
                        <p className="text-[10px] text-muted-foreground">Restarts</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {metrics.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Historique ({metrics.length} points)</CardTitle></CardHeader>
              <CardContent className="p-4">
                <div className="h-48 flex items-end gap-px">
                  {metrics.slice(-60).map((m: any, i: number) => {
                    const cpuH = Math.max(2, (m.cpu_percent / 100) * 180);
                    const memH = Math.max(2, Math.min(m.memory_mb / 512, 1) * 180);
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-px justify-end" title={`CPU: ${m.cpu_percent}% | RAM: ${m.memory_mb}MB | ${m.environment}`}>
                        <div className="w-full bg-blue-500/60 rounded-t-sm" style={{ height: cpuH }} />
                        <div className="w-full bg-purple-500/60 rounded-t-sm" style={{ height: memH }} />
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-4 mt-2 justify-center text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><div className="w-2 h-2 rounded bg-blue-500/60" /> CPU</span>
                  <span className="flex items-center gap-1"><div className="w-2 h-2 rounded bg-purple-500/60" /> RAM</span>
                </div>
              </CardContent>
            </Card>
          )}

          {live.length === 0 && metrics.length === 0 && (
            <Card><CardContent className="p-8 text-center text-muted-foreground"><Gauge className="w-8 h-8 mx-auto mb-2 opacity-50" /><p>Aucune métrique disponible. Déployez d'abord votre projet.</p></CardContent></Card>
          )}
        </>
      )}
    </div>
  );
}

export function PlanBillingPanel() {
  const { toast } = useToast();
  const [billingTab, setBillingTab] = useState<"overview" | "invoices">("overview");
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "yearly">("monthly");
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  const { data: billingStatus, isLoading } = useQuery({
    queryKey: [API, "billing", "status"],
    queryFn: () => devmaxFetch(`${API}/billing/status`).then(r => r.json()),
  });

  const { data, isLoading: planLoading } = useQuery({
    queryKey: [API, "plan"],
    queryFn: () => devmaxFetch(`${API}/plan`).then(r => r.json()),
  });

  const { data: invoiceData, isLoading: invoicesLoading } = useQuery({
    queryKey: [API, "billing", "invoices"],
    queryFn: () => devmaxFetch(`${API}/billing/invoices`).then(r => r.json()),
    enabled: billingTab === "invoices",
  });

  const handleCheckout = async (plan: string) => {
    setCheckoutLoading(plan);
    try {
      const res = await devmaxApiRequest("POST", `${API}/billing/checkout`, { plan, billingPeriod });
      if (res.url) {
        window.open(res.url, "_blank");
        toast({ title: "Redirection vers Stripe", description: "Complétez votre paiement dans l'onglet ouvert." });
      }
    } catch (error: any) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
    } finally {
      setCheckoutLoading(null);
    }
  };

  const handlePortal = async () => {
    setPortalLoading(true);
    try {
      const res = await devmaxApiRequest("POST", `${API}/billing/portal`);
      if (res.url) window.open(res.url, "_blank");
    } catch (error: any) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
    } finally {
      setPortalLoading(false);
    }
  };

  if (isLoading || planLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>;

  const plan = data?.plan || billingStatus?.plan || "free";
  const usage = data?.usage || {};
  const isOwner = data?.isOwner || billingStatus?.isOwner;

  const planConfig: Record<string, { label: string; color: string; bg: string; border: string; projects: number; deploys: number; users: number; price: { monthly: number; yearly: number } }> = {
    free: { label: "Free", color: "text-zinc-400", bg: "from-zinc-500/10 to-zinc-600/5", border: "border-zinc-500/20", projects: 3, deploys: 10, users: 2, price: { monthly: 0, yearly: 0 } },
    starter: { label: "Starter", color: "text-blue-400", bg: "from-blue-500/10 to-blue-600/5", border: "border-blue-500/30", projects: 10, deploys: 50, users: 5, price: { monthly: 19, yearly: 190 } },
    pro: { label: "Pro", color: "text-purple-400", bg: "from-purple-500/10 to-purple-600/5", border: "border-purple-500/30", projects: 50, deploys: 500, users: 20, price: { monthly: 49, yearly: 490 } },
    enterprise: { label: "Enterprise", color: "text-emerald-400", bg: "from-emerald-500/10 to-emerald-600/5", border: "border-emerald-500/30", projects: 9999, deploys: 9999, users: 9999, price: { monthly: 0, yearly: 0 } },
    owner: { label: "Owner", color: "text-amber-400", bg: "from-amber-500/10 to-amber-600/5", border: "border-amber-500/30", projects: 9999, deploys: 9999, users: 9999, price: { monthly: 0, yearly: 0 } },
  };

  const cfg = planConfig[plan] || planConfig.free;

  const UsageBar = ({ label, used, max, icon }: { label: string; used: number; max: number; icon: any }) => {
    const pct = max >= 9999 ? 5 : Math.min((used / max) * 100, 100);
    return (
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="flex items-center gap-1 text-muted-foreground">{icon} {label}</span>
          <span className="font-mono">{used} / {max >= 9999 ? "∞" : max}</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div className={cn("h-full rounded-full transition-all", pct > 80 ? "bg-red-500" : pct > 60 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  };

  const billingStatusBadge = billingStatus?.billingStatus || data?.billingStatus;
  const statusColor = billingStatusBadge === "active" ? "bg-emerald-500/20 text-emerald-400" :
    billingStatusBadge === "past_due" ? "bg-red-500/20 text-red-400" :
    billingStatusBadge === "trialing" ? "bg-blue-500/20 text-blue-400" : "bg-zinc-500/20 text-zinc-400";

  return (
    <div className="space-y-4" data-testid="plan-billing-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold flex items-center gap-2"><CreditCard className="w-5 h-5 text-emerald-400" /> Plan & Facturation</h3>
        <div className="flex gap-1 bg-muted rounded-lg p-0.5">
          <button onClick={() => setBillingTab("overview")} className={cn("px-3 py-1 text-xs rounded-md transition-all", billingTab === "overview" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground")} data-testid="tab-billing-overview">Vue d'ensemble</button>
          <button onClick={() => setBillingTab("invoices")} className={cn("px-3 py-1 text-xs rounded-md transition-all", billingTab === "invoices" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground")} data-testid="tab-billing-invoices">Factures</button>
        </div>
      </div>

      {billingTab === "overview" && (
        <>
          <Card className={cn("bg-gradient-to-br", cfg.bg)}>
            <CardContent className="p-6">
              <div className="flex items-center gap-4 mb-6">
                <div className={cn("w-14 h-14 rounded-xl bg-gradient-to-br flex items-center justify-center", cfg.bg)}>
                  <Package className={cn("w-7 h-7", cfg.color)} />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-muted-foreground">Plan actuel</p>
                  <p className={cn("text-2xl font-black", cfg.color)}>{cfg.label}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {billingStatusBadge && (
                    <Badge className={cn("text-xs", statusColor)}>{billingStatusBadge === "active" ? "Actif" : billingStatusBadge === "past_due" ? "Impayé" : billingStatusBadge === "trialing" ? "Essai" : billingStatusBadge}</Badge>
                  )}
                  {cfg.price.monthly > 0 && (
                    <span className="text-xs text-muted-foreground">{cfg.price.monthly}€/mois</span>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <UsageBar label="Projets" used={usage.projects || 0} max={cfg.projects} icon={<Folder className="w-3 h-3" />} />
                <UsageBar label="Déploiements/mois" used={usage.deploysThisMonth || 0} max={cfg.deploys} icon={<Rocket className="w-3 h-3" />} />
                <UsageBar label="Utilisateurs" used={usage.users || 0} max={cfg.users} icon={<Settings className="w-3 h-3" />} />
              </div>

              {!isOwner && plan !== "free" && (
                <div className="mt-4 pt-4 border-t border-border/50 flex gap-2">
                  <Button size="sm" variant="outline" onClick={handlePortal} disabled={portalLoading} data-testid="button-manage-subscription">
                    {portalLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Settings className="w-3 h-3 mr-1" />}
                    Gérer l'abonnement
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {!isOwner && (plan === "free" || plan === "starter") && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Changer de plan</p>
                <div className="flex items-center gap-2 bg-muted rounded-lg p-0.5">
                  <button onClick={() => setBillingPeriod("monthly")} className={cn("px-3 py-1 text-xs rounded-md transition-all", billingPeriod === "monthly" ? "bg-background shadow text-foreground" : "text-muted-foreground")} data-testid="toggle-monthly">Mensuel</button>
                  <button onClick={() => setBillingPeriod("yearly")} className={cn("px-3 py-1 text-xs rounded-md transition-all", billingPeriod === "yearly" ? "bg-background shadow text-foreground" : "text-muted-foreground")} data-testid="toggle-yearly">
                    Annuel <span className="text-emerald-400 font-medium">-17%</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {plan === "free" && (
                  <Card className={cn("border-blue-500/30 hover:border-blue-500/60 transition-all cursor-pointer group")} data-testid="card-plan-starter">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-bold text-blue-400">Starter</h4>
                        <div className="text-right">
                          <span className="text-xl font-black text-blue-400">{billingPeriod === "monthly" ? "19€" : "190€"}</span>
                          <span className="text-xs text-muted-foreground">/{billingPeriod === "monthly" ? "mois" : "an"}</span>
                        </div>
                      </div>
                      <ul className="text-xs text-muted-foreground space-y-1 mb-3">
                        <li className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-blue-400" /> 10 projets</li>
                        <li className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-blue-400" /> 50 déploiements/mois</li>
                        <li className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-blue-400" /> Domaines personnalisés</li>
                        <li className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-blue-400" /> Support email</li>
                      </ul>
                      <Button size="sm" className="w-full bg-blue-600 hover:bg-blue-700" onClick={() => handleCheckout("starter")} disabled={!!checkoutLoading} data-testid="button-upgrade-starter">
                        {checkoutLoading === "starter" ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Zap className="w-3 h-3 mr-1" />}
                        Passer à Starter
                      </Button>
                    </CardContent>
                  </Card>
                )}

                <Card className={cn("border-purple-500/30 hover:border-purple-500/60 transition-all cursor-pointer group", plan === "free" ? "" : "col-span-full max-w-sm")} data-testid="card-plan-pro">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-purple-400">Pro</h4>
                        <Badge className="bg-purple-500/20 text-purple-400 text-[10px]">Populaire</Badge>
                      </div>
                      <div className="text-right">
                        <span className="text-xl font-black text-purple-400">{billingPeriod === "monthly" ? "49€" : "490€"}</span>
                        <span className="text-xs text-muted-foreground">/{billingPeriod === "monthly" ? "mois" : "an"}</span>
                      </div>
                    </div>
                    <ul className="text-xs text-muted-foreground space-y-1 mb-3">
                      <li className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-purple-400" /> 50 projets</li>
                      <li className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-purple-400" /> 500 déploiements/mois</li>
                      <li className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-purple-400" /> CI/CD complet + DGM IA</li>
                      <li className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-purple-400" /> Monitoring avancé</li>
                      <li className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-purple-400" /> Support prioritaire</li>
                    </ul>
                    <Button size="sm" className="w-full bg-purple-600 hover:bg-purple-700" onClick={() => handleCheckout("pro")} disabled={!!checkoutLoading} data-testid="button-upgrade-pro">
                      {checkoutLoading === "pro" ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Zap className="w-3 h-3 mr-1" />}
                      Passer à Pro
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </>
      )}

      {billingTab === "invoices" && (
        <Card>
          <CardContent className="p-4">
            {invoicesLoading ? (
              <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-emerald-400" /></div>
            ) : !invoiceData?.invoices?.length ? (
              <div className="text-center py-6">
                <ScrollText className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">Aucune facture pour le moment</p>
              </div>
            ) : (
              <div className="space-y-2">
                {invoiceData.invoices.map((inv: any) => (
                  <div key={inv.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors" data-testid={`invoice-${inv.id}`}>
                    <div className="flex items-center gap-3">
                      <ScrollText className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{inv.number || inv.id}</p>
                        <p className="text-xs text-muted-foreground">{new Date((inv.created || inv.date) * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge className={cn("text-xs", inv.status === "paid" ? "bg-emerald-500/20 text-emerald-400" : inv.status === "open" ? "bg-amber-500/20 text-amber-400" : "bg-red-500/20 text-red-400")}>
                        {inv.status === "paid" ? "Payée" : inv.status === "open" ? "En attente" : inv.status}
                      </Badge>
                      <span className="text-sm font-mono font-medium">{((inv.amount_paid || inv.total || 0) / 100).toFixed(2)}€</span>
                      {inv.invoice_pdf && (
                        <a href={inv.invoice_pdf} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:text-blue-300" data-testid={`download-invoice-${inv.id}`}>
                          PDF
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!isOwner && plan !== "free" && (
              <div className="mt-4 pt-3 border-t border-border/50">
                <Button size="sm" variant="outline" onClick={handlePortal} disabled={portalLoading} className="w-full" data-testid="button-billing-portal">
                  {portalLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <ExternalLink className="w-3 h-3 mr-1" />}
                  Portail de facturation Stripe
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
