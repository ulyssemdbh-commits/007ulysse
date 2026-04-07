import { useState, useEffect } from "react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  ChevronRight,
  Zap,
  Shield,
  Eye,
  TrendingUp,
  Target,
  TrendingDown,
  UserCheck,
  Users,
  Trophy,
  Swords,
} from "lucide-react";
import type { PredictionStats, UpcomingMatch, Prediction, GeneratedPrediction } from "./types";
import { LEAGUE_FLAGS, LEAGUE_COLORS } from "./types";

export function StatsCard({ stats }: { stats: PredictionStats }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Total Prédictions</p>
              <p className="text-2xl font-bold" data-testid="text-total-predictions">{stats.total}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-green-500" />
            <div>
              <p className="text-sm text-muted-foreground">Gagnées</p>
              <p className="text-2xl font-bold text-green-600" data-testid="text-won-predictions">{stats.won}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-red-500" />
            <div>
              <p className="text-sm text-muted-foreground">Perdues</p>
              <p className="text-2xl font-bold text-red-600" data-testid="text-lost-predictions">{stats.lost}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Taux Réussite</p>
              <p className="text-2xl font-bold" data-testid="text-success-rate">{stats.successRate}%</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function LeagueTab({ code, name, count }: { code: string; name: string; count: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-bold">{LEAGUE_FLAGS[code] || code}</span>
      <span className="hidden sm:inline">{name}</span>
      <span className="sm:hidden">{code}</span>
      {count > 0 && (
        <Badge variant="secondary" className="ml-1 text-xs">{count}</Badge>
      )}
    </div>
  );
}

export function OddsCell({ label, value, isHighlight, size = "normal" }: { label: string; value: number | null | undefined; isHighlight?: boolean; size?: "normal" | "small" }) {
  const hasValue = value !== null && value !== undefined;
  const isSmall = size === "small";
  return (
    <div className={`flex flex-col items-center ${isSmall ? "min-w-[56px]" : "min-w-[72px]"}`}>
      <span className={`${isSmall ? "text-[10px]" : "text-[11px]"} text-muted-foreground truncate max-w-full`}>{label}</span>
      <span 
        className={`font-bold ${isSmall ? "text-sm" : "text-base"} ${isHighlight ? "text-emerald-400" : ""}`}
        data-testid={`odds-${label.toLowerCase().replace(/[\s/]+/g, '-')}`}
      >
        {hasValue ? value.toFixed(2) : "-"}
      </span>
    </div>
  );
}

export function ProbabilityBar({ homePercent, drawPercent, awayPercent }: { homePercent: number; drawPercent: number; awayPercent: number }) {
  const total = homePercent + drawPercent + awayPercent;
  const h = total > 0 ? (homePercent / total) * 100 : 0;
  const d = total > 0 ? (drawPercent / total) * 100 : 0;
  const a = total > 0 ? (awayPercent / total) * 100 : 0;
  return (
    <div className="flex h-1.5 rounded-full overflow-hidden bg-muted">
      <div className="bg-blue-500 transition-all" style={{ width: `${h}%` }} />
      <div className="bg-amber-400 transition-all" style={{ width: `${d}%` }} />
      <div className="bg-red-400 transition-all" style={{ width: `${a}%` }} />
    </div>
  );
}

export function MatchIntelligencePanel({ match, isLive, isFinished }: { match: UpcomingMatch; isLive: boolean; isFinished: boolean }) {
  const [intelData, setIntelData] = useState<any>(null);
  const [intelLoading, setIntelLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"intel" | "lineups" | "events">("intel");
  const [lineupsData, setLineupsData] = useState<any>(null);
  const [eventsData, setEventsData] = useState<any>(null);
  const [lineupsLoading, setLineupsLoading] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);

  useEffect(() => {
    if (!intelData && !intelLoading) {
      setIntelLoading(true);
      apiRequest("GET", `/api/sports/fixture/${match.fixtureId}/prediction`)
        .then(res => res.json())
        .then(data => setIntelData(data))
        .catch(() => setIntelData({ error: true }))
        .finally(() => setIntelLoading(false));
    }
  }, [match.fixtureId]);

  const loadLineups = async () => {
    if (lineupsData) return;
    setLineupsLoading(true);
    try {
      const res = await apiRequest("GET", `/api/sports/fixture/${match.fixtureId}/lineups`);
      setLineupsData(await res.json());
    } catch { setLineupsData({ error: true }); }
    setLineupsLoading(false);
  };

  const loadEvents = async () => {
    if (eventsData) return;
    setEventsLoading(true);
    try {
      const res = await apiRequest("GET", `/api/sports/fixture/${match.fixtureId}/events`);
      setEventsData(await res.json());
    } catch { setEventsData({ error: true }); }
    setEventsLoading(false);
  };

  const pred = intelData?.prediction || intelData?.response?.[0] || intelData;
  const predictions = pred?.predictions || pred;
  const comparison = pred?.comparison;
  const teams = pred?.teams;
  const hasH2h = pred?.h2h?.length > 0;

  return (
    <div className="border-t px-3 py-2.5 space-y-3" data-testid={`intel-panel-${match.fixtureId}`}>
      <div className="flex gap-2 flex-wrap">
        <Button
          variant={activeTab === "intel" ? "default" : "outline"}
          size="sm"
          onClick={(e) => { e.stopPropagation(); setActiveTab("intel"); }}
          data-testid={`button-intel-${match.fixtureId}`}
        >
          <Eye className="h-3 w-3 mr-1" />
          Intelligence
        </Button>
        {(isLive || isFinished) && (
          <>
            <Button
              variant={activeTab === "lineups" ? "default" : "outline"}
              size="sm"
              onClick={(e) => { e.stopPropagation(); setActiveTab("lineups"); loadLineups(); }}
              disabled={lineupsLoading}
              data-testid={`button-lineups-${match.fixtureId}`}
            >
              {lineupsLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Users className="h-3 w-3 mr-1" />}
              Compos
            </Button>
            <Button
              variant={activeTab === "events" ? "default" : "outline"}
              size="sm"
              onClick={(e) => { e.stopPropagation(); setActiveTab("events"); loadEvents(); }}
              disabled={eventsLoading}
              data-testid={`button-events-${match.fixtureId}`}
            >
              {eventsLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Swords className="h-3 w-3 mr-1" />}
              Events
            </Button>
          </>
        )}
      </div>

      {activeTab === "intel" && (
        <div className="space-y-2">
          {intelLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              Chargement intelligence...
            </div>
          )}
          {intelData && !intelData.error && predictions && (
            <>
              {predictions.winner && (
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">Favori: {predictions.winner.name || "N/A"}</span>
                  {predictions.winner.comment && (
                    <span className="text-xs text-muted-foreground">({predictions.winner.comment})</span>
                  )}
                </div>
              )}
              {predictions.advice && (
                <div className="flex items-center gap-2 text-xs">
                  <UserCheck className="h-3 w-3 text-emerald-500 shrink-0" />
                  <span>{predictions.advice}</span>
                </div>
              )}
              {predictions.percent && (
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="py-1 rounded-md bg-muted/50">
                    <span className="text-muted-foreground block">Dom.</span>
                    <span className="font-bold text-blue-400">{predictions.percent.home || "-"}</span>
                  </div>
                  <div className="py-1 rounded-md bg-muted/50">
                    <span className="text-muted-foreground block">Nul</span>
                    <span className="font-bold text-amber-400">{predictions.percent.draw || "-"}</span>
                  </div>
                  <div className="py-1 rounded-md bg-muted/50">
                    <span className="text-muted-foreground block">Ext.</span>
                    <span className="font-bold text-red-400">{predictions.percent.away || "-"}</span>
                  </div>
                </div>
              )}
              {predictions.goals && (
                <div className="flex gap-2 text-xs">
                  <div className="flex-1 py-1 rounded-md bg-muted/50 text-center">
                    <span className="text-muted-foreground block">Buts attendus</span>
                    <span className="font-bold">{predictions.goals.home || "?"} - {predictions.goals.away || "?"}</span>
                  </div>
                  {predictions.under_over && (
                    <div className="flex-1 py-1 rounded-md bg-muted/50 text-center">
                      <span className="text-muted-foreground block">Over/Under</span>
                      <span className="font-bold">{predictions.under_over}</span>
                    </div>
                  )}
                </div>
              )}
              {comparison && (
                <div className="space-y-1 pt-1 border-t">
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Comparaison</span>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                    {Object.entries(comparison as Record<string, any>).slice(0, 6).map(([key, val]: [string, any]) => (
                      <div key={key} className="flex items-center justify-between">
                        <span className="text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</span>
                        <div className="flex gap-1">
                          <span className="text-blue-400 font-medium">{val?.home || "-"}</span>
                          <span className="text-muted-foreground">-</span>
                          <span className="text-red-400 font-medium">{val?.away || "-"}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {hasH2h && (
                <div className="space-y-1 pt-1 border-t">
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Confrontations directes</span>
                  <div className="flex gap-1 flex-wrap">
                    {pred.h2h.slice(0, 5).map((h: any, i: number) => {
                      const homeTeamIsFirst = h.teams?.home?.id === teams?.home?.id;
                      const s1 = h.goals?.home ?? 0;
                      const s2 = h.goals?.away ?? 0;
                      const won = homeTeamIsFirst ? s1 > s2 : s2 > s1;
                      const lost = homeTeamIsFirst ? s1 < s2 : s2 < s1;
                      return (
                        <Badge
                          key={i}
                          variant="outline"
                          className={`text-[10px] ${won ? 'text-emerald-500' : lost ? 'text-red-400' : 'text-amber-400'}`}
                        >
                          {s1}-{s2}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
          {intelData?.error && (
            <p className="text-xs text-muted-foreground">Donnees intelligence non disponibles</p>
          )}
        </div>
      )}

      {activeTab === "lineups" && (
        <div className="space-y-2">
          {lineupsLoading && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Chargement...</div>}
          {lineupsData && !lineupsData.error && (lineupsData.lineups || []).length > 0 ? (
            (lineupsData.lineups || []).map((lineup: any, idx: number) => (
              <Card key={idx}>
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-2">
                    {lineup.team?.logo && <img src={lineup.team.logo} alt="" className="w-5 h-5 object-contain" />}
                    <span className="font-semibold text-sm">{lineup.team?.name || "Equipe"}</span>
                    {lineup.formation && <Badge variant="outline" className="text-xs">{lineup.formation}</Badge>}
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {(lineup.startXI || []).map((entry: any, i: number) => {
                      const p = entry?.player || entry;
                      return <span key={i} className="text-xs text-muted-foreground">{p?.number ? `${p.number}. ` : ""}{p?.name || "N/A"}</span>;
                    })}
                  </div>
                </CardContent>
              </Card>
            ))
          ) : lineupsData && !lineupsLoading ? (
            <p className="text-xs text-muted-foreground">Compositions non disponibles</p>
          ) : null}
        </div>
      )}

      {activeTab === "events" && (
        <div className="space-y-1">
          {eventsLoading && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Chargement...</div>}
          {eventsData && !eventsData.error && (eventsData.events || []).length > 0 ? (
            (eventsData.events || []).map((event: any, idx: number) => (
              <div key={idx} className="flex items-center gap-2 text-xs py-1 border-b border-muted last:border-0">
                <span className="font-bold min-w-[3ch] text-right text-muted-foreground">{event.time?.elapsed || "-"}'</span>
                <Badge variant="outline" className="text-[10px]">{event.type || "N/A"}</Badge>
                <span className="truncate">{event.player?.name || "N/A"}</span>
                {event.detail && <span className="text-muted-foreground truncate">({event.detail})</span>}
              </div>
            ))
          ) : eventsData && !eventsLoading ? (
            <p className="text-xs text-muted-foreground">Aucun evenement</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function MatchCard({ match, onGeneratePrediction, generatedPrediction, isGenerating }: { 
  match: UpcomingMatch; 
  onGeneratePrediction: (match: UpcomingMatch) => void;
  generatedPrediction?: GeneratedPrediction | null;
  isGenerating?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const matchDate = new Date(match.date);
  const formattedDate = matchDate.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  const formattedTime = matchDate.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  const isLive = match.status === "1H" || match.status === "2H" || match.status === "HT";
  const isFinished = match.status === "FT" || match.status === "AET" || match.status === "PEN";

  const odds = match.odds;
  const homePercent = odds?.homeOdds ? Math.round(100 / odds.homeOdds) : 0;
  const drawPercent = odds?.drawOdds ? Math.round(100 / odds.drawOdds) : 0;
  const awayPercent = odds?.awayOdds ? Math.round(100 / odds.awayOdds) : 0;
  const hasOdds = odds && (odds.homeOdds || odds.drawOdds || odds.awayOdds);
  const hasExtraMarkets = odds && (odds.over25Odds || odds.bttsYes || odds.dc1X);

  return (
    <Card
      className="overflow-visible"
      data-testid={`card-match-${match.fixtureId}`}
    >
      <div
        className="p-3 cursor-pointer hover-elevate"
        onClick={() => setExpanded(!expanded)}
        data-testid={`toggle-match-${match.fixtureId}`}
      >
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <Badge variant="outline" className={`text-[10px] shrink-0 ${LEAGUE_COLORS[match.league.code] || ""}`}>
              {LEAGUE_FLAGS[match.league.code]} {match.league.code}
            </Badge>
            <span className="text-xs text-muted-foreground">{formattedDate} {formattedTime}</span>
            {isLive && <Badge className="bg-red-500 animate-pulse text-[10px]">LIVE</Badge>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {hasOdds && odds?.totalMarkets && odds.totalMarkets > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {odds.totalMarkets} marchés
              </Badge>
            )}
            {odds?.bookmaker && (
              <span className="text-[10px] text-muted-foreground hidden sm:inline">{odds.bookmaker}</span>
            )}
            <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex-1 min-w-0 flex items-center gap-1 sm:gap-2">
            <div className="flex items-center gap-1 sm:gap-1.5 flex-1 min-w-0 justify-end">
              <span className="font-semibold text-sm sm:text-lg truncate text-right">{match.homeTeam.name}</span>
              {match.homeTeam.logo ? (
                <img src={match.homeTeam.logo} alt="" className="w-6 h-6 sm:w-8 sm:h-8 object-contain shrink-0" />
              ) : (
                <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-muted flex items-center justify-center text-[10px] sm:text-xs font-bold shrink-0">{match.homeTeam.name.charAt(0)}</div>
              )}
            </div>

            <div className="flex items-center gap-0.5 sm:gap-1 shrink-0 px-0.5 sm:px-1">
              {isFinished && match.goals.home !== null ? (
                <span className="font-bold text-sm sm:text-base min-w-[2ch] text-center">{match.goals.home}</span>
              ) : null}
              <span className="text-muted-foreground text-xs">-</span>
              {isFinished && match.goals.away !== null ? (
                <span className="font-bold text-sm sm:text-base min-w-[2ch] text-center">{match.goals.away}</span>
              ) : null}
            </div>

            <div className="flex items-center gap-1 sm:gap-1.5 flex-1 min-w-0">
              {match.awayTeam.logo ? (
                <img src={match.awayTeam.logo} alt="" className="w-6 h-6 sm:w-8 sm:h-8 object-contain shrink-0" />
              ) : (
                <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-muted flex items-center justify-center text-[10px] sm:text-xs font-bold shrink-0">{match.awayTeam.name.charAt(0)}</div>
              )}
              <span className="font-semibold text-sm sm:text-lg truncate">{match.awayTeam.name}</span>
            </div>
          </div>

          {!isFinished && hasOdds && (
            <div className="flex gap-0.5 sm:gap-1 shrink-0">
              <div className="flex flex-col items-center min-w-[40px] sm:min-w-[52px] px-1 sm:px-1.5 py-1 rounded-md bg-muted/60">
                <span className="text-[9px] sm:text-[10px] text-muted-foreground">1</span>
                <span className="font-bold text-xs sm:text-sm text-blue-400">{odds.homeOdds?.toFixed(2) || "-"}</span>
                <span className="text-[8px] sm:text-[9px] text-muted-foreground">{homePercent}%</span>
              </div>
              <div className="flex flex-col items-center min-w-[40px] sm:min-w-[52px] px-1 sm:px-1.5 py-1 rounded-md bg-muted/60">
                <span className="text-[9px] sm:text-[10px] text-muted-foreground">N</span>
                <span className="font-bold text-xs sm:text-sm text-amber-400">{odds.drawOdds?.toFixed(2) || "-"}</span>
                <span className="text-[8px] sm:text-[9px] text-muted-foreground">{drawPercent}%</span>
              </div>
              <div className="flex flex-col items-center min-w-[40px] sm:min-w-[52px] px-1 sm:px-1.5 py-1 rounded-md bg-muted/60">
                <span className="text-[9px] sm:text-[10px] text-muted-foreground">2</span>
                <span className="font-bold text-xs sm:text-sm text-red-400">{odds.awayOdds?.toFixed(2) || "-"}</span>
                <span className="text-[8px] sm:text-[9px] text-muted-foreground">{awayPercent}%</span>
              </div>
            </div>
          )}

          {!isFinished && !hasOdds && (
            <div className="flex gap-0.5 sm:gap-1 shrink-0">
              <div className="flex flex-col items-center min-w-[40px] sm:min-w-[52px] px-1 sm:px-1.5 py-1 rounded-md bg-muted/60">
                <span className="text-[9px] sm:text-[10px] text-muted-foreground">1</span>
                <span className="font-bold text-xs sm:text-sm">-</span>
              </div>
              <div className="flex flex-col items-center min-w-[40px] sm:min-w-[52px] px-1 sm:px-1.5 py-1 rounded-md bg-muted/60">
                <span className="text-[9px] sm:text-[10px] text-muted-foreground">N</span>
                <span className="font-bold text-xs sm:text-sm">-</span>
              </div>
              <div className="flex flex-col items-center min-w-[40px] sm:min-w-[52px] px-1 sm:px-1.5 py-1 rounded-md bg-muted/60">
                <span className="text-[9px] sm:text-[10px] text-muted-foreground">2</span>
                <span className="font-bold text-xs sm:text-sm">-</span>
              </div>
            </div>
          )}

          {isFinished && (
            <Badge variant="outline" className="text-xs shrink-0">FT</Badge>
          )}
        </div>

        {hasOdds && !isFinished && (
          <div className="mt-2">
            <ProbabilityBar homePercent={homePercent} drawPercent={drawPercent} awayPercent={awayPercent} />
          </div>
        )}
      </div>
      {expanded && hasExtraMarkets && !isFinished && (
        <div className="border-t px-2 sm:px-3 py-2 sm:py-2.5 bg-muted/30 space-y-2" data-testid={`expanded-odds-${match.fixtureId}`}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
            <div className="space-y-1">
              <span className="text-[9px] sm:text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Over/Under 2.5</span>
              <div className="flex gap-1 sm:gap-2">
                <div className="flex-1 text-center py-1 rounded-md bg-card border">
                  <span className="text-[9px] sm:text-[10px] text-muted-foreground block">Over</span>
                  <span className="font-bold text-xs sm:text-sm text-emerald-400">{odds?.over25Odds?.toFixed(2) || "-"}</span>
                </div>
                <div className="flex-1 text-center py-1 rounded-md bg-card border">
                  <span className="text-[9px] sm:text-[10px] text-muted-foreground block">Under</span>
                  <span className="font-bold text-xs sm:text-sm">{odds?.under25Odds?.toFixed(2) || "-"}</span>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-[9px] sm:text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Les 2 marquent</span>
              <div className="flex gap-1 sm:gap-2">
                <div className="flex-1 text-center py-1 rounded-md bg-card border">
                  <span className="text-[9px] sm:text-[10px] text-muted-foreground block">Oui</span>
                  <span className="font-bold text-xs sm:text-sm text-emerald-400">{odds?.bttsYes?.toFixed(2) || "-"}</span>
                </div>
                <div className="flex-1 text-center py-1 rounded-md bg-card border">
                  <span className="text-[9px] sm:text-[10px] text-muted-foreground block">Non</span>
                  <span className="font-bold text-xs sm:text-sm">{odds?.bttsNo?.toFixed(2) || "-"}</span>
                </div>
              </div>
            </div>

            <div className="space-y-1 col-span-2 sm:col-span-1">
              <span className="text-[9px] sm:text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Double Chance</span>
              <div className="flex gap-1">
                <div className="flex-1 text-center py-1 rounded-md bg-card border">
                  <span className="text-[9px] sm:text-[10px] text-muted-foreground block">1X</span>
                  <span className="font-bold text-xs">{odds?.dc1X?.toFixed(2) || "-"}</span>
                </div>
                <div className="flex-1 text-center py-1 rounded-md bg-card border">
                  <span className="text-[9px] sm:text-[10px] text-muted-foreground block">X2</span>
                  <span className="font-bold text-xs">{odds?.dcX2?.toFixed(2) || "-"}</span>
                </div>
                <div className="flex-1 text-center py-1 rounded-md bg-card border">
                  <span className="text-[9px] sm:text-[10px] text-muted-foreground block">12</span>
                  <span className="font-bold text-xs">{odds?.dc12?.toFixed(2) || "-"}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {expanded && !hasExtraMarkets && !isFinished && (
        <div className="border-t px-3 py-3 bg-muted/30 text-center">
          <span className="text-xs text-muted-foreground">Marchés détaillés non disponibles pour ce match</span>
        </div>
      )}
      {expanded && !isFinished && (
        <div className="border-t px-3 py-2.5">
          {generatedPrediction ? (
            <PredictionResult prediction={generatedPrediction} />
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={(e) => { e.stopPropagation(); onGeneratePrediction(match); }}
              disabled={isGenerating}
              data-testid={`button-predict-${match.fixtureId}`}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Analyse en cours...
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4 mr-2" />
                  Générer pronostic
                </>
              )}
            </Button>
          )}
        </div>
      )}
      {expanded && (
        <MatchIntelligencePanel match={match} isLive={isLive} isFinished={isFinished} />
      )}
    </Card>
  );
}

export function PredictionResult({ prediction }: { prediction: GeneratedPrediction }) {
  const total = prediction.homeWinProb + prediction.drawProb + prediction.awayWinProb;
  const normHome = total > 0 ? Math.round((prediction.homeWinProb / total) * 100) : 0;
  const normDraw = total > 0 ? Math.round((prediction.drawProb / total) * 100) : 0;
  const normAway = total > 0 ? Math.round((prediction.awayWinProb / total) * 100) : 0;
  
  const confidenceColor = prediction.confidence >= 70 ? "text-emerald-500" : prediction.confidence >= 50 ? "text-amber-500" : "text-red-400";
  
  return (
    <div className="space-y-2" data-testid={`prediction-result-${prediction.fixtureId}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">Pronostic</span>
        </div>
        <Badge className={confidenceColor}>
          {prediction.confidence}% confiance
        </Badge>
      </div>
      
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="default" data-testid={`text-bestbet-${prediction.fixtureId}`}>
          {prediction.bestBet}
        </Badge>
        {prediction.valueScore > 0 && (
          <Badge variant="secondary">
            Value: {prediction.valueScore.toFixed(1)}
          </Badge>
        )}
      </div>
      
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="py-1 rounded-md bg-muted/50">
          <span className="text-muted-foreground block">Dom.</span>
          <span className="font-bold text-blue-400">{normHome}%</span>
        </div>
        <div className="py-1 rounded-md bg-muted/50">
          <span className="text-muted-foreground block">Nul</span>
          <span className="font-bold text-amber-400">{normDraw}%</span>
        </div>
        <div className="py-1 rounded-md bg-muted/50">
          <span className="text-muted-foreground block">Ext.</span>
          <span className="font-bold text-red-400">{normAway}%</span>
        </div>
      </div>
      
      {(prediction.over25Prob || prediction.bttsProb) && (
        <div className="flex gap-2 text-xs">
          {prediction.over25Prob != null && (
            <div className="flex-1 py-1 rounded-md bg-muted/50 text-center">
              <span className="text-muted-foreground block">+2.5 buts</span>
              <span className="font-bold">{Math.round(prediction.over25Prob)}%</span>
            </div>
          )}
          {prediction.bttsProb != null && (
            <div className="flex-1 py-1 rounded-md bg-muted/50 text-center">
              <span className="text-muted-foreground block">BTTS</span>
              <span className="font-bold">{Math.round(prediction.bttsProb)}%</span>
            </div>
          )}
        </div>
      )}
      
      {prediction.reasoning && (
        <p className="text-xs text-muted-foreground border-t pt-2 mt-1">{prediction.reasoning}</p>
      )}
    </div>
  );
}

export function HistoryCard({ prediction }: { prediction: Prediction }) {
  const matchDate = new Date(prediction.matchDate);
  const formattedDate = matchDate.toLocaleDateString("fr-FR", { 
    day: "numeric", 
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
  
  const hasResult = prediction.actualResult && prediction.predictionPerformance;
  const won = prediction.predictionPerformance?.mainBetWon;
  
  return (
    <Card data-testid={`card-history-${prediction.id}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">{prediction.league}</Badge>
          </div>
          <span className="text-xs text-muted-foreground">{formattedDate}</span>
        </div>
        
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="font-medium">{prediction.homeTeam}</p>
            <p className="text-sm text-muted-foreground">vs {prediction.awayTeam}</p>
          </div>
          
          {hasResult && (
            <div className="text-right">
              <p className="text-lg font-bold">
                {prediction.actualResult?.homeScore} - {prediction.actualResult?.awayScore}
              </p>
              <Badge variant={won ? "default" : "secondary"}>
                {won ? "GAGNÉ" : "PERDU"}
              </Badge>
            </div>
          )}
        </div>
        
        <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Pari:</span>
            <span className="font-medium">{prediction.recommendations.bestBet}</span>
          </div>
          <Badge variant={prediction.recommendations.confidence >= 70 ? "default" : "outline"}>
            {prediction.recommendations.confidence}%
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

export function EmptyState({ icon: Icon, title, description }: { icon: any; title: string; description: string }) {
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <Icon className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-lg font-medium">{title}</p>
        <p className="text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

