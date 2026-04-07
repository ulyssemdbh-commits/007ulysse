import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Shield, ShieldAlert, ShieldCheck, Lock, Unlock, Users, Clock,
  AlertTriangle, RefreshCw, LogOut, Activity, Eye, EyeOff, Filter
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";

const MONTHS_FR = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jun", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"];

interface SecurityEvent {
  id: number;
  action: string;
  resource: string | null;
  details: string | null;
  ipAddress: string | null;
  timestamp: string;
  userId: number | null;
}

interface SecuritySummary {
  failedLogins: number;
  blockedAttempts: number;
  successLogins: number;
  blockedAccess: number;
  lockedAccounts: number;
  suspiciousAccounts: number;
}

interface SecurityData {
  summary: SecuritySummary;
  lockedAccounts: string[];
  suspiciousAccounts: string[];
  events: SecurityEvent[];
}

interface ActiveSession {
  id: string;
  userId: number;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: string;
  createdAt: string;
  username: string | null;
  displayName: string | null;
  role: string | null;
}

interface SessionsData {
  count: number;
  sessions: ActiveSession[];
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function actionBadge(action: string) {
  switch (action) {
    case "LOGIN_FAILED": return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">Échec login</Badge>;
    case "LOGIN_BLOCKED": return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Bloqué</Badge>;
    case "LOGIN_SUCCESS": return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Connecté</Badge>;
    case "BLOCKED_ACCESS": return <Badge className="bg-red-600/20 text-red-300 border-red-600/30">Accès bloqué</Badge>;
    default: return <Badge className="bg-slate-500/20 text-slate-400">{action}</Badge>;
  }
}

export default function SecurityDashboard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [actionFilter, setActionFilter] = useState<string>("");
  const [showSessions, setShowSessions] = useState(false);

  const { data: secData, isLoading: secLoading, refetch: refetchSec } = useQuery<SecurityData>({
    queryKey: ["/api/admin/security-events"],
  });

  const { data: sessData, isLoading: sessLoading } = useQuery<SessionsData>({
    queryKey: ["/api/admin/active-sessions"],
    enabled: showSessions,
  });

  const forceLogoutMutation = useMutation({
    mutationFn: (userId: number) => apiRequest("DELETE", `/api/admin/users/${userId}/sessions`),
    onSuccess: () => {
      toast({ title: "Sessions révoquées", description: "L'utilisateur a été déconnecté de toutes ses sessions." });
      qc.invalidateQueries({ queryKey: ["/api/admin/active-sessions"] });
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible de révoquer les sessions.", variant: "destructive" });
    },
  });

  const summary = secData?.summary;
  const events = (secData?.events || []).filter(e => !actionFilter || e.action === actionFilter);
  const locked = secData?.lockedAccounts || [];
  const suspicious = secData?.suspiciousAccounts || [];

  const threatLevel = (summary?.lockedAccounts || 0) > 0 || (summary?.blockedAttempts || 0) > 3
    ? "high"
    : (summary?.failedLogins || 0) > 5
    ? "medium"
    : "low";

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-white/40 hover:text-white/70 transition-colors text-sm">← Retour</Link>
            <div className="w-px h-4 bg-white/20" />
            <Shield className="h-5 w-5 text-blue-400" />
            <h1 className="font-bold text-lg">Tableau de bord Sécurité</h1>
            {threatLevel === "high" && (
              <Badge className="bg-red-500/20 text-red-400 border-red-500/30 animate-pulse">
                <ShieldAlert className="h-3 w-3 mr-1" /> Menace détectée
              </Badge>
            )}
            {threatLevel === "medium" && (
              <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">
                <AlertTriangle className="h-3 w-3 mr-1" /> Vigilance
              </Badge>
            )}
            {threatLevel === "low" && (
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                <ShieldCheck className="h-3 w-3 mr-1" /> Sécurisé
              </Badge>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchSec()}
            className="border-white/20 text-white/70 hover:bg-white/10"
            data-testid="button-refresh-security"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${secLoading ? "animate-spin" : ""}`} />
            Actualiser
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        {/* KPI Row */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card className="bg-white/5 border-white/10">
            <CardContent className="p-4">
              <p className="text-xs text-white/50 mb-1">Connexions réussies</p>
              <p className="text-2xl font-bold text-emerald-400" data-testid="kpi-success-logins">{summary?.successLogins ?? "—"}</p>
              <p className="text-xs text-white/30 mt-1">7 derniers jours</p>
            </CardContent>
          </Card>
          <Card className="bg-white/5 border-white/10">
            <CardContent className="p-4">
              <p className="text-xs text-white/50 mb-1">Échecs login</p>
              <p className="text-2xl font-bold text-orange-400" data-testid="kpi-failed-logins">{summary?.failedLogins ?? "—"}</p>
              <p className="text-xs text-white/30 mt-1">7 derniers jours</p>
            </CardContent>
          </Card>
          <Card className="bg-white/5 border-white/10">
            <CardContent className="p-4">
              <p className="text-xs text-white/50 mb-1">Tentatives bloquées</p>
              <p className={`text-2xl font-bold ${(summary?.blockedAttempts ?? 0) > 0 ? "text-red-400" : "text-white/60"}`} data-testid="kpi-blocked-attempts">
                {summary?.blockedAttempts ?? "—"}
              </p>
              <p className="text-xs text-white/30 mt-1">7 derniers jours</p>
            </CardContent>
          </Card>
          <Card className="bg-white/5 border-white/10">
            <CardContent className="p-4">
              <p className="text-xs text-white/50 mb-1">Accès bloqués</p>
              <p className={`text-2xl font-bold ${(summary?.blockedAccess ?? 0) > 0 ? "text-red-400" : "text-white/60"}`} data-testid="kpi-blocked-access">
                {summary?.blockedAccess ?? "—"}
              </p>
              <p className="text-xs text-white/30 mt-1">7 derniers jours</p>
            </CardContent>
          </Card>
          <Card className={`border-white/10 ${(summary?.lockedAccounts ?? 0) > 0 ? "bg-red-500/10 border-red-500/20" : "bg-white/5"}`}>
            <CardContent className="p-4">
              <p className="text-xs text-white/50 mb-1">Comptes verrouillés</p>
              <p className={`text-2xl font-bold ${(summary?.lockedAccounts ?? 0) > 0 ? "text-red-400" : "text-white/60"}`} data-testid="kpi-locked-accounts">
                {summary?.lockedAccounts ?? "—"}
              </p>
              <p className="text-xs text-white/30 mt-1">Actifs maintenant</p>
            </CardContent>
          </Card>
          <Card className="bg-white/5 border-white/10">
            <CardContent className="p-4">
              <p className="text-xs text-white/50 mb-1">Comptes suspects</p>
              <p className={`text-2xl font-bold ${(summary?.suspiciousAccounts ?? 0) > 0 ? "text-amber-400" : "text-white/60"}`} data-testid="kpi-suspicious-accounts">
                {summary?.suspiciousAccounts ?? "—"}
              </p>
              <p className="text-xs text-white/30 mt-1">Actifs maintenant</p>
            </CardContent>
          </Card>
        </div>

        {/* Locked & Suspicious accounts */}
        {(locked.length > 0 || suspicious.length > 0) && (
          <div className="grid md:grid-cols-2 gap-4">
            {locked.length > 0 && (
              <Card className="bg-red-500/10 border-red-500/20">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-red-400 flex items-center gap-2">
                    <Lock className="h-4 w-4" /> Comptes verrouillés ({locked.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {locked.map(username => (
                    <div key={username} className="flex items-center justify-between py-1 px-3 rounded-lg bg-red-500/10" data-testid={`locked-account-${username}`}>
                      <span className="text-sm font-medium text-red-300">@{username}</span>
                      <Badge className="bg-red-500/20 text-red-400 text-xs">Verrouillé 30min</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
            {suspicious.length > 0 && (
              <Card className="bg-amber-500/10 border-amber-500/20">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-amber-400 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" /> Comptes suspects ({suspicious.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {suspicious.map(username => (
                    <div key={username} className="flex items-center justify-between py-1 px-3 rounded-lg bg-amber-500/10" data-testid={`suspicious-account-${username}`}>
                      <span className="text-sm font-medium text-amber-300">@{username}</span>
                      <Badge className="bg-amber-500/20 text-amber-400 text-xs">3+ échecs</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Active Sessions Panel */}
        <Card className="bg-white/5 border-white/10">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm text-white/80 flex items-center gap-2">
                <Users className="h-4 w-4 text-blue-400" /> Sessions actives
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSessions(v => !v)}
                className="text-white/50 hover:text-white/80"
                data-testid="button-toggle-sessions"
              >
                {showSessions ? <EyeOff className="h-4 w-4 mr-1" /> : <Eye className="h-4 w-4 mr-1" />}
                {showSessions ? "Masquer" : "Afficher"}
              </Button>
            </div>
          </CardHeader>
          {showSessions && (
            <CardContent>
              {sessLoading ? (
                <div className="text-center py-4 text-white/40">Chargement...</div>
              ) : !sessData?.sessions.length ? (
                <div className="text-center py-4 text-white/40">Aucune session active</div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-white/40 mb-3">{sessData.count} session(s) active(s)</p>
                  {sessData.sessions.map(sess => (
                    <div key={sess.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5 border border-white/10" data-testid={`session-${sess.id}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white/90">{sess.displayName || sess.username || `User ${sess.userId}`}</span>
                          {sess.role && <Badge className="bg-blue-500/20 text-blue-400 text-xs">{sess.role}</Badge>}
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          {sess.ipAddress && <span className="text-xs text-white/40">{sess.ipAddress}</span>}
                          <span className="text-xs text-white/30">Connecté {formatDate(sess.createdAt)}</span>
                          <span className="text-xs text-white/30">Expire {formatDate(sess.expiresAt)}</span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => forceLogoutMutation.mutate(sess.userId)}
                        disabled={forceLogoutMutation.isPending}
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/10 ml-2"
                        data-testid={`button-force-logout-${sess.userId}`}
                      >
                        <LogOut className="h-4 w-4 mr-1" />
                        Déconnecter
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          )}
        </Card>

        {/* Security Events Log */}
        <Card className="bg-white/5 border-white/10">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm text-white/80 flex items-center gap-2">
                <Activity className="h-4 w-4 text-purple-400" /> Journal des événements sécurité (7 derniers jours)
              </CardTitle>
              <div className="flex items-center gap-2">
                <Filter className="h-3.5 w-3.5 text-white/40" />
                <select
                  value={actionFilter}
                  onChange={e => setActionFilter(e.target.value)}
                  className="text-xs bg-white/10 border border-white/20 rounded px-2 py-1 text-white/70"
                  data-testid="select-event-filter"
                >
                  <option value="">Tous</option>
                  <option value="LOGIN_FAILED">Échecs login</option>
                  <option value="LOGIN_BLOCKED">Bloqués</option>
                  <option value="LOGIN_SUCCESS">Succès</option>
                  <option value="BLOCKED_ACCESS">Accès bloqué</option>
                </select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {secLoading ? (
              <div className="text-center py-8 text-white/40">Chargement...</div>
            ) : !events.length ? (
              <div className="text-center py-8 text-white/40">Aucun événement trouvé</div>
            ) : (
              <div className="space-y-1 max-h-96 overflow-y-auto">
                {events.map(evt => (
                  <div key={evt.id} className="flex items-start gap-3 py-2 px-3 rounded-lg hover:bg-white/5 transition-colors" data-testid={`event-${evt.id}`}>
                    <div className="mt-0.5">{actionBadge(evt.action)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {evt.details && (
                          <span className="text-xs text-white/60 truncate">{evt.details}</span>
                        )}
                        {evt.ipAddress && (
                          <span className="text-xs text-white/30 font-mono">{evt.ipAddress}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-white/30">
                      <Clock className="h-3 w-3" />
                      <span className="text-xs whitespace-nowrap">{formatDate(evt.timestamp)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* CSP & Rate Limiting Status */}
        <Card className="bg-white/5 border-white/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-white/80 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-400" /> Protections actives
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Content Security Policy", desc: "Headers CSP stricts", ok: true },
                { label: "Rate Limiting Auth", desc: "5 essais → lockout 30min", ok: true },
                { label: "Rate Limiting IA/Upload", desc: "10 req / 5 min", ok: true },
                { label: "Brute Force Protection", desc: "Par username + Discord alerts", ok: true },
                { label: "Audit Log", desc: "Toutes les actions sensibles", ok: true },
                { label: "Session Expiry", desc: "Sessions à durée limitée", ok: true },
                { label: "Helmet Headers", desc: "XSS, clickjacking, sniffing", ok: true },
                { label: "User Blocking", desc: "IPs externes bloquées", ok: true },
              ].map(({ label, desc, ok }) => (
                <div key={label} className={`p-3 rounded-lg border ${ok ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20"}`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    {ok ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> : <ShieldAlert className="h-3.5 w-3.5 text-red-400" />}
                    <span className="text-xs font-medium text-white/80">{label}</span>
                  </div>
                  <p className="text-xs text-white/40">{desc}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
