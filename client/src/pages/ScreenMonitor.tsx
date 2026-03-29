import { useState, useEffect, useRef } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  Monitor, Eye, EyeOff, Mouse, Keyboard, Power, PowerOff,
  Activity, Shield, ShieldAlert, ShieldCheck, Terminal,
  AlertCircle, CheckCircle, Loader2, RefreshCcw, Camera,
  ChevronRight, Code, Copy
} from "lucide-react";

// ─── Status dot ───────────────────────────────────────────────
function StatusDot({ active, pulse }: { active: boolean; pulse?: boolean }) {
  return (
    <span className={cn(
      "w-2.5 h-2.5 rounded-full flex-shrink-0",
      active ? "bg-green-400" : "bg-red-400/60",
      active && pulse && "animate-pulse shadow-sm shadow-green-400/60"
    )} />
  );
}

// ─── Copy to clipboard ─────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      data-testid="button-copy-command"
      className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
    >
      {copied ? <CheckCircle className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// ─── Code line ─────────────────────────────────────────────────
function CodeLine({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-2 font-mono text-xs text-green-300 bg-black/40 rounded-lg px-3 py-2.5 border border-white/5">
      <span className="text-white/30 flex-shrink-0">$</span>
      <span className="flex-1 overflow-x-auto whitespace-nowrap">{children}</span>
      <CopyButton text={children} />
    </div>
  );
}

// ─── Remote Control Panel ─────────────────────────────────────
function RemoteControlPanel({ status }: { status: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const enableMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/screen-monitor/remote-control/enable"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/screen-monitor/remote-control/status"] });
      toast({ title: "Prise en main activée", description: "Ulysse peut maintenant contrôler votre écran." });
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const disableMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/screen-monitor/remote-control/disable"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/screen-monitor/remote-control/status"] });
      toast({ title: "Prise en main désactivée" });
    },
  });

  const enabled = status?.remoteControlEnabled;
  const capable = status?.remoteControlCapable;
  const agentConnected = status?.agentConnected;

  return (
    <Card className={cn(
      "border transition-all duration-300",
      enabled
        ? "bg-orange-500/10 border-orange-500/30 shadow-lg shadow-orange-500/10"
        : "bg-card/60 border-border/50"
    )}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          {enabled ? (
            <ShieldAlert className="w-4 h-4 text-orange-400" />
          ) : (
            <Shield className="w-4 h-4 text-muted-foreground" />
          )}
          Prise en main
          {enabled && (
            <Badge className="bg-orange-500/20 text-orange-300 border-orange-500/30 text-[10px] ml-auto animate-pulse">
              ACTIVE
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Quand activée, Ulysse peut déplacer la souris, cliquer et saisir du texte sur votre écran pour vous assister directement.
        </p>

        {!agentConnected && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-300">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            Agent non connecté — lancez l'agent bureau pour activer la prise en main.
          </div>
        )}

        {agentConnected && !capable && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-300">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            L'agent ne supporte pas la prise en main — installez pyautogui sur le bureau.
          </div>
        )}

        {agentConnected && capable && (
          <div className="flex items-center justify-between gap-4 p-3 rounded-xl border border-border/40 bg-background/40">
            <div className="flex items-center gap-2">
              <Mouse className="w-4 h-4 text-orange-400" />
              <span className="text-sm font-medium">
                {enabled ? "Contrôle actif" : "Contrôle inactif"}
              </span>
            </div>
            <Switch
              data-testid="switch-remote-control"
              checked={enabled}
              disabled={enableMut.isPending || disableMut.isPending}
              onCheckedChange={(v) => v ? enableMut.mutate() : disableMut.mutate()}
            />
          </div>
        )}

        {enabled && (
          <div className="space-y-1.5 p-3 rounded-xl bg-orange-500/10 border border-orange-500/20">
            <p className="text-[11px] font-semibold text-orange-300 uppercase tracking-wider mb-2">Commandes disponibles</p>
            {[
              { icon: Mouse, label: "Déplacer la souris", desc: "Pointer vers un élément" },
              { icon: Mouse, label: "Cliquer", desc: "Clic gauche / droit / double" },
              { icon: Keyboard, label: "Saisir du texte", desc: "Taper du contenu" },
              { icon: Keyboard, label: "Raccourcis clavier", desc: "Ctrl+C, Alt+Tab, etc." },
              { icon: Camera, label: "Capture d'écran", desc: "Screenshot immédiat" },
            ].map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex items-center gap-2 text-xs text-orange-200/80">
                <Icon className="w-3 h-3 flex-shrink-0" />
                <span className="font-medium">{label}</span>
                <span className="text-orange-300/50">—</span>
                <span className="text-orange-300/60">{desc}</span>
              </div>
            ))}
          </div>
        )}

        {enabled && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-[11px] text-red-300">
            <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0" />
            Sécurité : déplacez la souris en haut à gauche de l'écran pour couper immédiatement la prise en main.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Agent Setup Card ─────────────────────────────────────────
function AgentSetupCard() {
  const domain = window.location.hostname;
  const wsUrl = `wss://${domain}/ws/screen`;

  return (
    <Card className="bg-card/60 border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Terminal className="w-4 h-4 text-blue-400" />
          Agent bureau (Windows)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Téléchargez et lancez l'agent sur votre PC Windows pour activer le partage d'écran et la prise en main.
        </p>

        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">1. Installer les dépendances</p>
          <CodeLine>pip install dxcam opencv-python pillow websocket-client pywin32 psutil pyautogui</CodeLine>
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">2. Lancer l'agent</p>
          <CodeLine>{`python ulysse_screen_agent.py --server ${wsUrl} --user-id 1 --fps 2`}</CodeLine>
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">3. Avec prise en main (pyautogui requis)</p>
          <CodeLine>{`python ulysse_screen_agent.py --server ${wsUrl} --user-id 1 --fps 3 --quality high`}</CodeLine>
        </div>

        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-[11px] text-blue-300">
          <Code className="w-3.5 h-3.5 flex-shrink-0" />
          Fichier agent : <span className="font-mono">server/assets/ulysse_screen_agent.py</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Screen Context Card ──────────────────────────────────────
function ScreenContextCard() {
  const { data: context, isLoading } = useQuery<any[]>({
    queryKey: ["/api/screen-monitor/context"],
    refetchInterval: 8000,
  });

  if (isLoading) {
    return (
      <Card className="bg-card/60 border-border/50">
        <CardContent className="py-6 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!context || context.length === 0) {
    return (
      <Card className="bg-card/60 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Eye className="w-4 h-4 text-muted-foreground" />
            Ce qu'Ulysse voit
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
            <EyeOff className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm">Aucune activité — lancez l'agent pour commencer.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card/60 border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Eye className="w-4 h-4 text-green-400" />
          Ce qu'Ulysse voit
          <Badge className="ml-auto bg-green-500/10 text-green-400 border-green-500/20 text-[10px]">Live</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {context.slice(0, 5).map((ev: any, i) => (
          <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-background/40 border border-border/30">
            <Activity className="w-3.5 h-3.5 text-green-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              {ev.activeApp && (
                <p className="text-[11px] font-medium text-white/80 truncate">{ev.activeApp}</p>
              )}
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{ev.context}</p>
              {ev.tags && Array.isArray(ev.tags) && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {ev.tags.slice(0, 3).map((tag: string) => (
                    <span key={tag} className="px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary/70 border border-primary/20">{tag}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────
export default function ScreenMonitorPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: status, isLoading: statusLoading } = useQuery<any>({
    queryKey: ["/api/screen-monitor/remote-control/status"],
    refetchInterval: 5000,
  });

  const { data: monStatus } = useQuery<any>({
    queryKey: ["/api/screen-monitor/status"],
    refetchInterval: 8000,
  });

  const agentConnected = status?.agentConnected ?? false;
  const rcEnabled = status?.remoteControlEnabled ?? false;

  return (
    <PageContainer>
      <div className="max-w-4xl mx-auto space-y-6 py-6">

        {/* Header */}
        <div className="flex items-center gap-4">
          <div className={cn(
            "w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg transition-all duration-300",
            rcEnabled
              ? "bg-gradient-to-tr from-orange-500 to-red-500 shadow-orange-500/30"
              : agentConnected
                ? "bg-gradient-to-tr from-green-500 to-emerald-500 shadow-green-500/30"
                : "bg-gradient-to-tr from-slate-600 to-slate-700"
          )}>
            <Monitor className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              Ulysse Vision
              {rcEnabled && (
                <Badge className="bg-orange-500/20 text-orange-300 border-orange-500/30 text-xs animate-pulse">
                  Prise en main
                </Badge>
              )}
            </h1>
            <p className="text-muted-foreground text-sm">Partage d'écran & prise en main à distance — Ulysse voit et aide</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            data-testid="button-refresh-status"
            className="ml-auto"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/screen-monitor/remote-control/status"] });
              queryClient.invalidateQueries({ queryKey: ["/api/screen-monitor/status"] });
            }}
          >
            <RefreshCcw className="w-4 h-4" />
          </Button>
        </div>

        {/* Status cards row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Agent status */}
          <Card className={cn(
            "border transition-all duration-300",
            agentConnected ? "bg-green-500/10 border-green-500/30" : "bg-card/60 border-border/50"
          )}>
            <CardContent className="py-4 flex items-center gap-3">
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", agentConnected ? "bg-green-500/20" : "bg-muted/50")}>
                {agentConnected ? <Power className="w-5 h-5 text-green-400" /> : <PowerOff className="w-5 h-5 text-muted-foreground" />}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Agent bureau</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <StatusDot active={agentConnected} pulse={agentConnected} />
                  <p className="text-sm font-medium">{agentConnected ? "Connecté" : "Déconnecté"}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Screen sharing */}
          <Card className={cn(
            "border transition-all duration-300",
            monStatus?.activeSession ? "bg-blue-500/10 border-blue-500/30" : "bg-card/60 border-border/50"
          )}>
            <CardContent className="py-4 flex items-center gap-3">
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", monStatus?.activeSession ? "bg-blue-500/20" : "bg-muted/50")}>
                {monStatus?.activeSession ? <Eye className="w-5 h-5 text-blue-400" /> : <EyeOff className="w-5 h-5 text-muted-foreground" />}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Partage d'écran</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <StatusDot active={!!monStatus?.activeSession} pulse={!!monStatus?.activeSession} />
                  <p className="text-sm font-medium">{monStatus?.activeSession ? "Actif" : "Inactif"}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Remote control */}
          <Card className={cn(
            "border transition-all duration-300",
            rcEnabled ? "bg-orange-500/10 border-orange-500/30" : "bg-card/60 border-border/50"
          )}>
            <CardContent className="py-4 flex items-center gap-3">
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", rcEnabled ? "bg-orange-500/20" : "bg-muted/50")}>
                {rcEnabled ? <ShieldCheck className="w-5 h-5 text-orange-400" /> : <Shield className="w-5 h-5 text-muted-foreground" />}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Prise en main</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <StatusDot active={rcEnabled} pulse={rcEnabled} />
                  <p className="text-sm font-medium">{rcEnabled ? "Activée" : "Désactivée"}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Session stats */}
        {monStatus?.stats && (
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Sessions aujourd'hui", value: monStatus.stats.totalSessions ?? monStatus.stats.totalSessionsToday ?? 0 },
              { label: "Frames reçues", value: monStatus.stats.totalFrames ?? 0 },
              { label: "Analyses IA", value: monStatus.stats.totalEvents ?? monStatus.stats.totalAnalyses ?? 0 },
            ].map(({ label, value }) => (
              <div key={label} className="flex flex-col items-center justify-center p-4 rounded-xl border border-border/40 bg-card/40">
                <p className="text-2xl font-bold text-white">{value}</p>
                <p className="text-xs text-muted-foreground mt-0.5 text-center">{label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Two-column layout */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <RemoteControlPanel status={status} />
          <ScreenContextCard />
        </div>

        {/* Agent setup */}
        <AgentSetupCard />

        {/* Info boxes */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl border border-blue-500/20 bg-blue-500/5">
            <div className="flex items-center gap-2 mb-2">
              <Eye className="w-4 h-4 text-blue-400" />
              <h3 className="text-sm font-semibold text-blue-300">Partage d'écran</h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              L'agent capture votre écran à 2-3 fps et l'envoie à Ulysse. GPT-4o Vision analyse chaque frame pour comprendre ce que vous faites. Tout reste privé et les contenus sensibles (banque, mots de passe) sont automatiquement filtrés.
            </p>
          </div>
          <div className="p-4 rounded-xl border border-orange-500/20 bg-orange-500/5">
            <div className="flex items-center gap-2 mb-2">
              <Mouse className="w-4 h-4 text-orange-400" />
              <h3 className="text-sm font-semibold text-orange-300">Prise en main</h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Activez-la pour laisser Ulysse contrôler votre souris et clavier à votre demande. Utile pour résoudre un bug, remplir un formulaire ou naviguer dans une app. Désactivez à tout moment avec le toggle ou en déplaçant la souris en haut à gauche.
            </p>
          </div>
        </div>

      </div>
    </PageContainer>
  );
}
