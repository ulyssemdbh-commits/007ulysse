import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTabListener } from "@/hooks/useAppNavigation";
import { useSportsScreenContext } from "@/hooks/useSportsScreenContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  TrendingUp,
  TrendingDown,
  Trophy,
  Target,
  Calendar,
  RefreshCw,
  ArrowLeft,
  Activity,
  Zap,
  BarChart3,
  Globe,
  ChevronRight,
  Loader2,
  DollarSign,
  Users,
  Flame,
  Shield,
  UserCheck,
  Swords,
  Star,
  AlertTriangle,
  Eye,
  SlidersHorizontal,
  Minus,
  Plus,
  BookOpen,
  Filter,
  Wallet,
  ArrowUpDown,
  Check,
  Percent,
  Gem,
  CircleDot,
  RotateCcw,
} from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface PredictionStats {
  total: number;
  pending: number;
  won: number;
  lost: number;
  successRate: number;
  bySport: Record<string, { total: number; won: number; rate: number }>;
}

interface League {
  id: number;
  name: string;
  code: string;
  country: string;
}

interface Team {
  id: number;
  name: string;
  logo?: string;
}

interface UpcomingMatch {
  fixtureId: number;
  date: string;
  status: string;
  league: League;
  homeTeam: Team;
  awayTeam: Team;
  goals: { home: number | null; away: number | null };
  odds?: MatchOdds | null;
}

interface MatchOdds {
  fixtureId: number;
  homeOdds: number | null;
  drawOdds: number | null;
  awayOdds: number | null;
  over25Odds?: number | null;
  under25Odds?: number | null;
  bttsYes?: number | null;
  bttsNo?: number | null;
  dc1X?: number | null;
  dcX2?: number | null;
  dc12?: number | null;
  bookmaker?: string;
  totalMarkets?: number;
}

interface Prediction {
  id: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  sport: string;
  matchDate: string;
  recommendations: {
    bestBet: string;
    confidence: number;
    valueScore: number;
    reasoning: string;
  };
  predictions: {
    homeWinProb: number;
    drawProb?: number;
    awayWinProb: number;
  };
  oddsSnapshot: {
    homeOdds: number;
    drawOdds?: number;
    awayOdds: number;
    bookmaker?: string;
  };
  actualResult?: {
    homeScore: number;
    awayScore: number;
    settledAt?: string;
  };
  predictionPerformance?: {
    mainBetWon: boolean;
    notes?: string;
  };
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface GeneratedPrediction {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  bestBet: string;
  confidence: number;
  valueScore: number;
  reasoning: string;
  poissonHomeGoals?: number;
  poissonAwayGoals?: number;
  over25Prob?: number;
  bttsProb?: number;
  betOdds?: number;
}

type RiskLevel = "safe" | "moderate" | "risky";
type BetTypeFilter = "all" | "1X2" | "over_under" | "btts";
type SortMode = "confidence" | "value" | "odds";

interface PredictionCriteria {
  matchCount: number;
  riskLevel: RiskLevel;
  minOdds: number;
  maxOdds: number;
  betType: BetTypeFilter;
  minConfidence: number;
  valueOnly: boolean;
  sortBy: SortMode;
  selectedLeagues: string[];
  bankroll: number;
  stakePercent: number;
}

const LEAGUE_FLAGS: Record<string, string> = {
  L1: "FR",
  PL: "EN",
  LL: "ES",
  BL: "DE",
  SA: "IT",
  UCL: "UCL",
  UEL: "UEL",
  UECL: "UECL",
  L2: "FR2",
  EFL: "EN2",
  LL2: "ES2",
  BL2: "DE2",
  SB: "IT2",
  CDF: "CDF",
  FAC: "FAC",
  CDR: "CDR",
  DFB: "DFB",
  CI: "CI",
  ERE: "NL",
  JPL: "BE",
  PRI: "PT",
};

const LEAGUE_COLORS: Record<string, string> = {
  // Big 5
  L1: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  PL: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  LL: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  BL: "bg-red-500/20 text-red-400 border-red-500/30",
  SA: "bg-green-500/20 text-green-400 border-green-500/30",
  // European Cups
  UCL: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  UEL: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  UECL: "bg-lime-500/20 text-lime-400 border-lime-500/30",
  // Second Divisions
  L2: "bg-blue-400/15 text-blue-300 border-blue-400/25",
  EFL: "bg-purple-400/15 text-purple-300 border-purple-400/25",
  LL2: "bg-orange-400/15 text-orange-300 border-orange-400/25",
  BL2: "bg-red-400/15 text-red-300 border-red-400/25",
  SB: "bg-green-400/15 text-green-300 border-green-400/25",
  // National Cups
  CDF: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  FAC: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  CDR: "bg-rose-500/20 text-rose-400 border-rose-500/30",
  DFB: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  CI: "bg-teal-500/20 text-teal-400 border-teal-500/30",
  // Other Top Leagues
  ERE: "bg-orange-600/20 text-orange-500 border-orange-600/30",
  JPL: "bg-yellow-600/20 text-yellow-500 border-yellow-600/30",
  PRI: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
};

function StatsCard({ stats }: { stats: PredictionStats }) {
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

function LeagueTab({ code, name, count }: { code: string; name: string; count: number }) {
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

function OddsCell({ label, value, isHighlight, size = "normal" }: { label: string; value: number | null | undefined; isHighlight?: boolean; size?: "normal" | "small" }) {
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

function ProbabilityBar({ homePercent, drawPercent, awayPercent }: { homePercent: number; drawPercent: number; awayPercent: number }) {
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

function MatchIntelligencePanel({ match, isLive, isFinished }: { match: UpcomingMatch; isLive: boolean; isFinished: boolean }) {
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

function MatchCard({ match, onGeneratePrediction, generatedPrediction, isGenerating }: { 
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

function PredictionResult({ prediction }: { prediction: GeneratedPrediction }) {
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

function HistoryCard({ prediction }: { prediction: Prediction }) {
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

function EmptyState({ icon: Icon, title, description }: { icon: any; title: string; description: string }) {
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

export default function SportsPredictions() {
  const [activeTab, setActiveTab] = useState("matches");
  useTabListener(setActiveTab, ["matches", "classement", "buteurs", "blessures", "historique"]);
  const [selectedLeague, setSelectedLeague] = useState("all");
  const [generatedPredictions, setGeneratedPredictions] = useState<Record<number, GeneratedPrediction>>({});
  const [generatingFixtureId, setGeneratingFixtureId] = useState<number | null>(null);
  const [scorerLeague, setScorerLeague] = useState<number>(61);
  const [injuryLeague, setInjuryLeague] = useState<number>(61);
  const [criteria, setCriteria] = useState<PredictionCriteria>({
    matchCount: 3,
    riskLevel: "moderate",
    minOdds: 1.5,
    maxOdds: 50,
    betType: "all",
    minConfidence: 50,
    valueOnly: false,
    sortBy: "confidence",
    selectedLeagues: [],
    bankroll: 100,
    stakePercent: 5,
  });
  const [showCriteria, setShowCriteria] = useState(true);
  const { toast } = useToast();
  const { broadcast: broadcastScreen } = useSportsScreenContext("predictions");
  
  const { data: statsData, isLoading: statsLoading, refetch: refetchStats } = useQuery<{ success: boolean; stats: PredictionStats }>({
    queryKey: ["/api/sports/cache/predictions/stats"],
    refetchInterval: 60000,
  });
  
  const { data: upcomingData, isLoading: upcomingLoading, refetch: refetchUpcoming } = useQuery<{
    success: boolean;
    totalMatches: number;
    matchesByLeague: Record<string, UpcomingMatch[]>;
    leagues: Record<string, League>;
  }>({
    queryKey: ["/api/sports/dashboard/big5/upcoming"],
    refetchInterval: 300000,
  });
  
  const { data: historyData, isLoading: historyLoading, refetch: refetchHistory } = useQuery<{ success: boolean; predictions: Prediction[] }>({
    queryKey: ["/api/sports/cache/predictions/history"],
    refetchInterval: 60000,
  });

  const { data: topScorersData, isLoading: scorersLoading } = useQuery({
    queryKey: ['/api/sports/leagues', scorerLeague, 'topscorers'],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/sports/leagues/${scorerLeague}/topscorers`);
      return await res.json();
    },
    enabled: activeTab === "scorers",
  });

  const { data: injuriesData, isLoading: injuriesLoading } = useQuery({
    queryKey: ['/api/sports/injuries', injuryLeague],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/sports/injuries?league=${injuryLeague}&season=${new Date().getFullYear()}`);
      return await res.json();
    },
    enabled: activeTab === "injuries",
  });

  const generateMatchPrediction = useMutation({
    mutationFn: async (match: UpcomingMatch) => {
      const res = await apiRequest("POST", "/api/sports/cache/predictions/match", {
        homeTeam: match.homeTeam.name,
        awayTeam: match.awayTeam.name,
        league: match.league.name,
        fixtureId: match.fixtureId,
        criteria: {
          riskLevel: criteria.riskLevel,
          betType: criteria.betType,
          minConfidence: criteria.minConfidence,
          valueOnly: criteria.valueOnly,
          sortBy: criteria.sortBy,
        },
        odds: match.odds ? {
          home: match.odds.homeOdds,
          draw: match.odds.drawOdds,
          away: match.odds.awayOdds,
          over25: match.odds.over25Odds,
          under25: match.odds.under25Odds,
          bttsYes: match.odds.bttsYes,
          bttsNo: match.odds.bttsNo,
        } : undefined,
      });
      const data = await res.json();
      return { fixtureId: match.fixtureId, match, data };
    },
    onSuccess: ({ fixtureId, match, data }) => {
      if (data.success && data.prediction) {
        const p = data.prediction;
        const probs = p.probabilities || {};
        const topRec = Array.isArray(p.recommendations) && p.recommendations.length > 0 ? p.recommendations[0] : null;
        const analysisText = p.reasoning || (typeof p.analysis === 'string' ? p.analysis : (p.analysis ? [p.analysis.homeForm, p.analysis.awayForm, p.analysis.scoringTrend, ...(Array.isArray(p.analysis.keyFactors) ? p.analysis.keyFactors : [])].filter(Boolean).join('. ') : ""));
        const bestBetText = p.bestBet || (topRec ? `${topRec.betType}: ${topRec.prediction}` : p.recommendation || "N/A");
        const impliedOdds = topRec?.bookmakerOdds || topRec?.impliedOdds;
        const pred: GeneratedPrediction = {
          fixtureId,
          homeTeam: match.homeTeam.name,
          awayTeam: match.awayTeam.name,
          league: match.league.name,
          homeWinProb: probs.homeWin ?? p.homeWinProbability ?? p.homeWinProb ?? 0,
          drawProb: probs.draw ?? p.drawProbability ?? p.drawProb ?? 0,
          awayWinProb: probs.awayWin ?? p.awayWinProbability ?? p.awayWinProb ?? 0,
          bestBet: bestBetText,
          confidence: (() => {
            const raw = probs.confidence ?? p.confidence ?? 50;
            return raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
          })(),
          valueScore: (topRec ? topRec.valueRating : null) ?? p.valueScore ?? p.value ?? 0,
          reasoning: analysisText,
          poissonHomeGoals: p.poissonHomeGoals ?? p.expectedHomeGoals,
          poissonAwayGoals: p.poissonAwayGoals ?? p.expectedAwayGoals,
          over25Prob: probs.over25 ?? p.over25Probability ?? p.over25Prob,
          bttsProb: probs.btts ?? p.bttsProbability ?? p.bttsProb,
          betOdds: impliedOdds || undefined,
        };
        setGeneratedPredictions(prev => ({ ...prev, [fixtureId]: pred }));
        toast({ title: "Pronostic généré", description: `${match.homeTeam.name} vs ${match.awayTeam.name}` });
      } else {
        toast({ title: "Erreur", description: data.error || "Impossible de générer le pronostic", variant: "destructive" });
      }
      setGeneratingFixtureId(null);
    },
    onError: (error: any) => {
      toast({ title: "Erreur", description: error.message || "Erreur serveur", variant: "destructive" });
      setGeneratingFixtureId(null);
    },
  });

  const generateAllPredictions = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sports/cache/predictions/today", {
        criteria: {
          riskLevel: criteria.riskLevel,
          betType: criteria.betType,
          minConfidence: criteria.minConfidence,
          valueOnly: criteria.valueOnly,
          sortBy: criteria.sortBy,
        }
      });
      return await res.json();
    },
    onSuccess: (data) => {
      if (!data.success || !data.predictions || data.predictions.length === 0) {
        toast({ title: "Aucune prédiction", description: data.error || "Aucun match à analyser aujourd'hui", variant: "destructive" });
        return;
      }
      const newPreds: Record<number, GeneratedPrediction> = {};
      let matchedCount = 0;
      for (const p of data.predictions) {
        let fixtureMatch: UpcomingMatch | undefined;
        if (p.fixtureId) {
          fixtureMatch = allMatches.find(m => m.fixtureId === p.fixtureId);
        }
        if (!fixtureMatch) {
          const homeName = (p.homeTeam || "").toLowerCase();
          const awayName = (p.awayTeam || "").toLowerCase();
          fixtureMatch = allMatches.find(m => {
            const mHome = m.homeTeam.name.toLowerCase();
            const mAway = m.awayTeam.name.toLowerCase();
            return (mHome.includes(homeName.split(' ')[0]) || homeName.includes(mHome.split(' ')[0])) &&
                   (mAway.includes(awayName.split(' ')[0]) || awayName.includes(mAway.split(' ')[0]));
          });
        }
        const fId = fixtureMatch?.fixtureId || p.fixtureId || p.matchId;
        matchedCount++;
        const probs = p.probabilities || {};
        const topRec = Array.isArray(p.recommendations) && p.recommendations.length > 0 ? p.recommendations[0] : null;
        const analysisText = p.reasoning || (typeof p.analysis === 'string' ? p.analysis : (p.analysis ? [p.analysis.homeForm, p.analysis.awayForm, p.analysis.scoringTrend, ...(Array.isArray(p.analysis.keyFactors) ? p.analysis.keyFactors : [])].filter(Boolean).join('. ') : ""));
        const bestBetText = p.bestBet || (topRec ? `${topRec.betType}: ${topRec.prediction}` : p.recommendation || "N/A");
        const bookOdds = topRec?.bookmakerOdds && topRec.bookmakerOdds > 1 ? topRec.bookmakerOdds : undefined;
        newPreds[fId] = {
          fixtureId: fId,
          homeTeam: p.homeTeam || fixtureMatch?.homeTeam.name || "Home",
          awayTeam: p.awayTeam || fixtureMatch?.awayTeam.name || "Away",
          league: p.league || fixtureMatch?.league.name || "",
          homeWinProb: probs.homeWin ?? p.homeWinProbability ?? p.homeWinProb ?? 0,
          drawProb: probs.draw ?? p.drawProbability ?? p.drawProb ?? 0,
          awayWinProb: probs.awayWin ?? p.awayWinProbability ?? p.awayWinProb ?? 0,
          bestBet: bestBetText,
          confidence: (() => {
            const raw = probs.confidence ?? p.confidence ?? 50;
            return raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
          })(),
          valueScore: (topRec ? topRec.valueRating : null) ?? p.valueScore ?? p.value ?? 0,
          reasoning: analysisText,
          poissonHomeGoals: p.poissonHomeGoals ?? p.expectedHomeGoals,
          poissonAwayGoals: p.poissonAwayGoals ?? p.expectedAwayGoals,
          over25Prob: probs.over25 ?? p.over25Probability ?? p.over25Prob,
          bttsProb: probs.btts ?? p.bttsProbability ?? p.bttsProb,
          betOdds: bookOdds,
        };
      }
      setGeneratedPredictions(prev => ({ ...prev, ...newPreds }));
      toast({ title: "Pronostics générés", description: `${Object.keys(newPreds).length} matchs analysés` });
    },
    onError: (error: any) => {
      toast({ title: "Erreur", description: error.message || "Erreur serveur", variant: "destructive" });
    },
  });

  const handleGeneratePrediction = (match: UpcomingMatch) => {
    setGeneratingFixtureId(match.fixtureId);
    generateMatchPrediction.mutate(match);
  };
  
  const stats = statsData?.stats;
  const matchesByLeague = upcomingData?.matchesByLeague || {};
  const leagues = upcomingData?.leagues || {};
  const historyPredictions = historyData?.predictions || [];
  
  const allMatches = Object.values(matchesByLeague).flat();
  const filteredMatches = selectedLeague === "all" 
    ? allMatches 
    : matchesByLeague[selectedLeague] || [];
  
  const generatedList = Object.values(generatedPredictions);

  const isOddsEstimated = (pred: GeneratedPrediction): boolean => {
    if (pred.betOdds && pred.betOdds > 1) return false;
    const match = allMatches.find(m => m.fixtureId === pred.fixtureId);
    return !match?.odds;
  };

  const getMatchOddsForPrediction = (pred: GeneratedPrediction): number => {
    if (pred.betOdds && pred.betOdds > 1) return pred.betOdds;
    const match = allMatches.find(m => m.fixtureId === pred.fixtureId);
    if (!match?.odds) return 1.5;
    const o = match.odds;
    const bet = pred.bestBet.toLowerCase();

    if (bet.includes("1x2: 1") || bet.includes("1x2: home") || bet.includes("domicile") || bet.includes("home win"))
      return o.homeOdds || 1.5;
    if (bet.includes("1x2: x") || bet.includes("nul") || bet.includes("draw"))
      return o.drawOdds || 3;
    if (bet.includes("1x2: 2") || bet.includes("1x2: away") || bet.includes("extérieur") || bet.includes("away win"))
      return o.awayOdds || 2.5;
    if (bet.includes("over 2.5") || bet.includes("+2.5") || bet.includes("over_2_5"))
      return o.over25Odds || 1.8;
    if (bet.includes("under 2.5") || bet.includes("-2.5") || bet.includes("under_2_5"))
      return o.under25Odds || 1.9;
    if (bet.includes("btts") || bet.includes("les deux"))
      return o.bttsYes || 1.8;
    if (bet.includes("double chance") || bet.includes("dc")) {
      if (bet.includes("1x") || bet.includes("home/draw")) return o.dc1X || 1.3;
      if (bet.includes("x2") || bet.includes("draw/away")) return o.dcX2 || 1.3;
      if (bet.includes("12") || bet.includes("home/away")) return o.dc12 || 1.2;
    }

    const maxProb = Math.max(pred.homeWinProb, pred.drawProb, pred.awayWinProb);
    if (maxProb === pred.homeWinProb && o.homeOdds) return o.homeOdds;
    if (maxProb === pred.awayWinProb && o.awayOdds) return o.awayOdds;
    if (o.drawOdds) return o.drawOdds;
    return 1.5;
  };

  const getConfidenceRange = (risk: RiskLevel): [number, number] => {
    switch (risk) {
      case "safe": return [70, 100];
      case "moderate": return [40, 75];
      case "risky": return [0, 55];
    }
  };

  const filteredPredictions = (() => {
    if (generatedList.length === 0) return [];
    const [minConf] = getConfidenceRange(criteria.riskLevel);
    const effectiveMinConf = Math.max(minConf, criteria.minConfidence);
    const withOdds = generatedList.map(p => ({
      pred: p,
      odds: getMatchOddsForPrediction(p),
    }));

    let eligible = withOdds.filter(item => {
      if (item.pred.confidence < effectiveMinConf) return false;
      if (item.odds < 1.01 || item.odds > 100) return false;
      if (criteria.valueOnly && (item.pred.valueScore || 0) <= 0) return false;
      if (criteria.betType !== "all") {
        const bet = item.pred.bestBet.toLowerCase();
        if (criteria.betType === "1X2" && !bet.includes("1x2")) return false;
        if (criteria.betType === "over_under" && !bet.includes("over") && !bet.includes("under") && !bet.includes("+2.5") && !bet.includes("-2.5")) return false;
        if (criteria.betType === "btts" && !bet.includes("btts")) return false;
      }
      if (criteria.selectedLeagues.length > 0) {
        const leagueName = item.pred.league.toLowerCase();
        const leaguePatterns: [string, string][] = [
          ["ligue 1", "L1"], ["ligue1", "L1"], ["france", "L1"],
          ["premier league", "PL"], ["england", "PL"], ["epl", "PL"],
          ["serie a", "SA"], ["seriea", "SA"], ["italy", "SA"],
          ["bundesliga", "BL"], ["germany", "BL"],
          ["la liga", "LL"], ["laliga", "LL"], ["primera", "LL"], ["spain", "LL"],
        ];
        let matchedCode: string | null = null;
        for (const [pattern, code] of leaguePatterns) {
          if (leagueName.includes(pattern)) {
            matchedCode = code;
            break;
          }
        }
        if (!matchedCode) {
          const fixtureMatch = allMatches.find(m => m.fixtureId === item.pred.fixtureId);
          if (fixtureMatch) {
            matchedCode = fixtureMatch.league.code;
          }
        }
        if (matchedCode && !criteria.selectedLeagues.includes(matchedCode)) return false;
        if (!matchedCode) return false;
      }
      return true;
    });

    if (criteria.sortBy === "value") {
      eligible.sort((a, b) => (b.pred.valueScore || 0) - (a.pred.valueScore || 0));
    } else if (criteria.sortBy === "odds") {
      eligible.sort((a, b) => b.odds - a.odds);
    } else {
      eligible.sort((a, b) => b.pred.confidence - a.pred.confidence);
    }

    if (eligible.length === 0 && withOdds.length > 0 && criteria.selectedLeagues.length === 0 && criteria.betType === "all" && !criteria.valueOnly) {
      eligible = withOdds.sort((a, b) => b.pred.confidence - a.pred.confidence);
    }

    const count = Math.min(criteria.matchCount, eligible.length);
    const bestCombo = findBestCombination(eligible, count, criteria.minOdds);
    return bestCombo;
  })();

  function findBestCombination(
    items: { pred: GeneratedPrediction; odds: number }[],
    targetCount: number,
    minCumOdds: number
  ): GeneratedPrediction[] {
    if (items.length === 0) return [];

    const topItems = items.slice(0, Math.min(items.length, 15));

    let bestCombo: { pred: GeneratedPrediction; odds: number }[] = [];
    let bestOdds = 0;

    function search(idx: number, current: typeof bestCombo, cumOdds: number) {
      if (current.length === targetCount) {
        if (cumOdds >= minCumOdds) {
          if (bestCombo.length === 0 || Math.abs(cumOdds - minCumOdds) < Math.abs(bestOdds - minCumOdds)) {
            bestOdds = cumOdds;
            bestCombo = [...current];
          }
        } else if (bestCombo.length === 0) {
          bestOdds = cumOdds;
          bestCombo = [...current];
        }
        return;
      }
      if (idx >= topItems.length) return;
      const remaining = targetCount - current.length;
      if (topItems.length - idx < remaining) return;

      search(idx + 1, [...current, topItems[idx]], cumOdds * topItems[idx].odds);
      search(idx + 1, current, cumOdds);
    }

    search(0, [], 1);

    if (bestCombo.length === 0) {
      return topItems.slice(0, targetCount).map(i => i.pred);
    }

    return bestCombo.map(i => i.pred);
  }

  const cumulativeOdds = filteredPredictions.reduce((acc, p) => acc * getMatchOddsForPrediction(p), 1);
  const oddsInRange = cumulativeOdds >= criteria.minOdds;

  useEffect(() => {
    broadcastScreen({
      tab: activeTab,
      selectedLeague,
      riskLevel: criteria.riskLevel,
      visiblePredictions: filteredPredictions.map(p => ({
        fixtureId: p.fixtureId,
        homeTeam: p.homeTeam,
        awayTeam: p.awayTeam,
        bestBet: p.bestBet,
        confidence: p.confidence,
        odds: getMatchOddsForPrediction(p),
      })),
      cumulativeOdds: filteredPredictions.length >= 2 ? cumulativeOdds : undefined,
    });
  }, [activeTab, selectedLeague, criteria.riskLevel, filteredPredictions.map(p => p.fixtureId).join(","), cumulativeOdds]);
  
  const handleRefresh = () => {
    refetchStats();
    refetchUpcoming();
    refetchHistory();
  };
  
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b pt-safe">
        <div className="container mx-auto px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Link href="/">
              <Button variant="ghost" size="icon" data-testid="button-back">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-semibold flex items-center gap-1.5 sm:gap-2">
                <Activity className="h-4 w-4 sm:h-5 sm:w-5 text-primary shrink-0" />
                <span className="truncate">Djedou Pronos</span>
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground hidden sm:block">Dashboard Prédictions Sportives</p>
            </div>
          </div>
          
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => window.open('/sports/predictions/footalmanach', '_blank')}
              data-testid="button-foot-almanach"
              className="hidden sm:flex"
            >
              <BookOpen className="h-4 w-4 mr-2" />
              Foot-Almanach
            </Button>
            <Button 
              variant="outline" 
              size="icon" 
              onClick={() => window.open('/sports/predictions/footalmanach', '_blank')}
              data-testid="button-foot-almanach-mobile"
              className="sm:hidden"
            >
              <BookOpen className="h-4 w-4" />
            </Button>
            <Button 
              variant="outline" 
              size="icon" 
              onClick={handleRefresh}
              data-testid="button-refresh"
              className="sm:hidden"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleRefresh}
              data-testid="button-refresh-desktop"
              className="hidden sm:flex"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Actualiser
            </Button>
          </div>
        </div>
      </header>
      
      <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {statsLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <Card key={i}>
                <CardContent className="pt-6">
                  <Skeleton className="h-12 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : stats ? (
          <StatsCard stats={stats} />
        ) : null}
        
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="flex w-full overflow-x-auto scrollbar-hide">
            <TabsTrigger value="matches" data-testid="tab-matches" className="flex-1 min-w-[60px] sm:min-w-0 px-1.5 sm:px-4">
              <Globe className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1 sm:mr-2 shrink-0" />
              <span className="hidden sm:inline">Matchs Big 5</span>
              <span className="sm:hidden text-[11px]">Matchs</span>
              {upcomingData?.totalMatches && (
                <Badge variant="secondary" className="ml-1 sm:ml-2 text-[10px] sm:text-xs">{upcomingData.totalMatches}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="predictions" data-testid="tab-predictions" className="flex-1 min-w-[60px] sm:min-w-0 px-1.5 sm:px-4">
              <Zap className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1 sm:mr-2 shrink-0" />
              <span className="hidden sm:inline">Pronostics</span>
              <span className="sm:hidden text-[11px]">Pronos</span>
              {generatedList.length > 0 && (
                <Badge variant="secondary" className="ml-1 sm:ml-2 text-[10px] sm:text-xs">{generatedList.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history" className="flex-1 min-w-[60px] sm:min-w-0 px-1.5 sm:px-4">
              <Trophy className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1 sm:mr-2 shrink-0" />
              <span className="hidden sm:inline">Historique</span>
              <span className="sm:hidden text-[11px]">Histo</span>
              {stats?.pending ? (
                <Badge variant="outline" className="ml-1 sm:ml-2 text-[10px] sm:text-xs hidden sm:inline-flex">{stats.pending} en attente</Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="scorers" data-testid="tab-scorers" className="flex-1 min-w-[60px] sm:min-w-0 px-1.5 sm:px-4">
              <Star className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1 sm:mr-2 shrink-0" />
              <span className="hidden sm:inline">Buteurs</span>
              <span className="sm:hidden text-[11px]">Buts</span>
            </TabsTrigger>
            <TabsTrigger value="injuries" data-testid="tab-injuries" className="flex-1 min-w-[60px] sm:min-w-0 px-1.5 sm:px-4">
              <AlertTriangle className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1 sm:mr-2 shrink-0" />
              <span className="hidden sm:inline">Blessures</span>
              <span className="sm:hidden text-[11px]">Bless.</span>
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="matches" className="mt-4 space-y-4">
            <div className="flex gap-2 overflow-x-auto pb-2">
              <Button
                variant={selectedLeague === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedLeague("all")}
              >
                Tous ({allMatches.length})
              </Button>
              {Object.entries(leagues).map(([code, league]) => (
                <Button
                  key={code}
                  variant={selectedLeague === code ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedLeague(code)}
                  className={selectedLeague === code ? "" : LEAGUE_COLORS[code]}
                >
                  <LeagueTab 
                    code={code} 
                    name={league.name} 
                    count={matchesByLeague[code]?.length || 0} 
                  />
                </Button>
              ))}
            </div>
            
            {upcomingLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5, 6].map(i => (
                  <div key={i} className="bg-card border rounded-lg p-4">
                    <Skeleton className="h-24 w-full" />
                  </div>
                ))}
              </div>
            ) : filteredMatches.length === 0 ? (
              <EmptyState 
                icon={Calendar}
                title="Aucun match à venir"
                description="Les matchs des 14 prochains jours apparaîtront ici. Trêve internationale en cours."
              />
            ) : (
              <div className="space-y-6">
                {Object.entries(
                  filteredMatches
                    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                    .reduce((groups, match) => {
                      const date = new Date(match.date).toLocaleDateString("fr-FR", { 
                        day: "numeric", 
                        month: "long" 
                      });
                      if (!groups[date]) groups[date] = [];
                      groups[date].push(match);
                      return groups;
                    }, {} as Record<string, UpcomingMatch[]>)
                ).map(([date, matches]) => (
                  <div key={date}>
                    <h3 className="text-base sm:text-lg font-semibold text-primary mb-3 sticky top-12 sm:top-16 bg-background/95 backdrop-blur py-2 z-10">
                      {date}
                    </h3>
                    <div className="space-y-3">
                      {matches.map(match => (
                        <MatchCard 
                          key={match.fixtureId} 
                          match={match} 
                          onGeneratePrediction={handleGeneratePrediction}
                          generatedPrediction={generatedPredictions[match.fixtureId] || null}
                          isGenerating={generatingFixtureId === match.fixtureId}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="predictions" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="h-5 w-5 text-primary" />
                    Critères du Pronostic
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowCriteria(!showCriteria)}
                    data-testid="button-toggle-criteria"
                  >
                    {showCriteria ? "Masquer" : "Afficher"}
                  </Button>
                </CardTitle>
              </CardHeader>
              {showCriteria && (
                <CardContent className="space-y-4 pt-0">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Matchs</Label>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => setCriteria(c => ({ ...c, matchCount: Math.max(1, c.matchCount - 1) }))}
                          disabled={criteria.matchCount <= 1}
                          data-testid="button-match-count-minus"
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="text-lg font-bold w-6 text-center" data-testid="text-match-count">
                          {criteria.matchCount}
                        </span>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => setCriteria(c => ({ ...c, matchCount: Math.min(15, c.matchCount + 1) }))}
                          disabled={criteria.matchCount >= 15}
                          data-testid="button-match-count-plus"
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Risque</Label>
                      <div className="flex gap-1 flex-wrap">
                        {([
                          { value: "safe" as RiskLevel, label: "Safe", icon: Shield, color: "text-emerald-500" },
                          { value: "moderate" as RiskLevel, label: "Modéré", icon: Target, color: "text-amber-500" },
                          { value: "risky" as RiskLevel, label: "Risqué", icon: Flame, color: "text-red-400" },
                        ]).map(risk => (
                          <button
                            key={risk.value}
                            onClick={() => setCriteria(c => ({ ...c, riskLevel: risk.value }))}
                            className={`flex items-center gap-1 px-2 py-1.5 rounded-md border text-xs transition-colors ${
                              criteria.riskLevel === risk.value
                                ? "border-primary bg-primary/10"
                                : "border-border hover-elevate"
                            }`}
                            data-testid={`button-risk-${risk.value}`}
                          >
                            <risk.icon className={`h-3 w-3 ${risk.color}`} />
                            <span className="font-medium">{risk.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Type de pari</Label>
                      <div className="flex gap-1 flex-wrap">
                        {([
                          { value: "all" as BetTypeFilter, label: "Tous" },
                          { value: "1X2" as BetTypeFilter, label: "1X2" },
                          { value: "over_under" as BetTypeFilter, label: "+/- 2.5" },
                          { value: "btts" as BetTypeFilter, label: "BTTS" },
                        ]).map(bt => (
                          <button
                            key={bt.value}
                            onClick={() => setCriteria(c => ({ ...c, betType: bt.value }))}
                            className={`px-2 py-1.5 rounded-md border text-xs font-medium transition-colors ${
                              criteria.betType === bt.value
                                ? "border-primary bg-primary/10"
                                : "border-border hover-elevate"
                            }`}
                            data-testid={`button-bettype-${bt.value}`}
                          >
                            {bt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Tri par</Label>
                      <div className="flex gap-1 flex-wrap">
                        {([
                          { value: "confidence" as SortMode, label: "Confiance", icon: Shield },
                          { value: "value" as SortMode, label: "Value", icon: Gem },
                          { value: "odds" as SortMode, label: "Cote", icon: TrendingUp },
                        ]).map(s => (
                          <button
                            key={s.value}
                            onClick={() => setCriteria(c => ({ ...c, sortBy: s.value }))}
                            className={`flex items-center gap-1 px-2 py-1.5 rounded-md border text-xs transition-colors ${
                              criteria.sortBy === s.value
                                ? "border-primary bg-primary/10"
                                : "border-border hover-elevate"
                            }`}
                            data-testid={`button-sort-${s.value}`}
                          >
                            <s.icon className="h-3 w-3" />
                            <span className="font-medium">{s.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 pt-2 border-t">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Cote combi visée</Label>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          min={1}
                          max={100}
                          step={0.5}
                          value={criteria.minOdds}
                          onChange={(e) => setCriteria(c => ({ ...c, minOdds: Math.max(1, parseFloat(e.target.value) || 1) }))}
                          className="w-16"
                          data-testid="input-min-odds"
                        />
                        <span className="text-xs text-muted-foreground">-</span>
                        <Input
                          type="number"
                          min={1}
                          max={100}
                          step={1}
                          value={criteria.maxOdds}
                          onChange={(e) => setCriteria(c => ({ ...c, maxOdds: Math.max(1, parseFloat(e.target.value) || 50) }))}
                          className="w-16"
                          data-testid="input-max-odds"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground flex items-center gap-1">
                        <Percent className="h-3 w-3" />
                        Confiance min
                      </Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={0}
                          max={90}
                          step={5}
                          value={criteria.minConfidence}
                          onChange={(e) => setCriteria(c => ({ ...c, minConfidence: parseInt(e.target.value) }))}
                          className="flex-1 h-2 accent-primary"
                          data-testid="slider-min-confidence"
                        />
                        <span className="text-xs font-mono w-8 text-right">{criteria.minConfidence}%</span>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground flex items-center gap-1">
                        <Gem className="h-3 w-3" />
                        Value Bets
                      </Label>
                      <button
                        onClick={() => setCriteria(c => ({ ...c, valueOnly: !c.valueOnly }))}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors w-full ${
                          criteria.valueOnly
                            ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                            : "border-border hover-elevate"
                        }`}
                        data-testid="button-value-only"
                      >
                        {criteria.valueOnly ? <Check className="h-3 w-3" /> : <CircleDot className="h-3 w-3" />}
                        {criteria.valueOnly ? "Activé" : "Désactivé"}
                      </button>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground flex items-center gap-1">
                        <Wallet className="h-3 w-3" />
                        Bankroll
                      </Label>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          min={1}
                          max={100000}
                          step={10}
                          value={criteria.bankroll}
                          onChange={(e) => setCriteria(c => ({ ...c, bankroll: Math.max(1, parseFloat(e.target.value) || 100) }))}
                          className="w-20"
                          data-testid="input-bankroll"
                        />
                        <span className="text-xs text-muted-foreground">€</span>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground flex items-center gap-1">
                        <Percent className="h-3 w-3" />
                        Mise
                      </Label>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          min={1}
                          max={25}
                          step={1}
                          value={criteria.stakePercent}
                          onChange={(e) => setCriteria(c => ({ ...c, stakePercent: Math.min(25, Math.max(1, parseInt(e.target.value) || 5)) }))}
                          className="w-14"
                          data-testid="input-stake-percent"
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                        <span className="text-xs font-medium ml-1">= {((criteria.bankroll * criteria.stakePercent) / 100).toFixed(0)}€</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1 pt-2 border-t">
                    <Label className="text-xs text-muted-foreground flex items-center gap-1">
                      <Filter className="h-3 w-3" />
                      Championnats
                    </Label>
                    <div className="flex gap-1 flex-wrap">
                      {([
                        { code: "L1", label: "Ligue 1", flag: "🇫🇷" },
                        { code: "PL", label: "Premier League", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
                        { code: "LL", label: "La Liga", flag: "🇪🇸" },
                        { code: "BL", label: "Bundesliga", flag: "🇩🇪" },
                        { code: "SA", label: "Serie A", flag: "🇮🇹" },
                      ]).map(league => {
                        const isSelected = criteria.selectedLeagues.length === 0 || criteria.selectedLeagues.includes(league.code);
                        return (
                          <button
                            key={league.code}
                            onClick={() => setCriteria(c => {
                              if (c.selectedLeagues.length === 0) {
                                return { ...c, selectedLeagues: [league.code] };
                              }
                              if (c.selectedLeagues.includes(league.code)) {
                                const remaining = c.selectedLeagues.filter(l => l !== league.code);
                                return { ...c, selectedLeagues: remaining };
                              }
                              return { ...c, selectedLeagues: [...c.selectedLeagues, league.code] };
                            })}
                            className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md border text-xs transition-colors ${
                              isSelected && criteria.selectedLeagues.length > 0
                                ? "border-primary bg-primary/10"
                                : criteria.selectedLeagues.length === 0
                                  ? "border-border opacity-80 hover-elevate"
                                  : "border-border opacity-40 hover-elevate"
                            }`}
                            data-testid={`button-league-${league.code}`}
                          >
                            <span>{league.flag}</span>
                            <span className="font-medium">{league.label}</span>
                          </button>
                        );
                      })}
                      {criteria.selectedLeagues.length > 0 && (
                        <button
                          onClick={() => setCriteria(c => ({ ...c, selectedLeagues: [] }))}
                          className="flex items-center gap-1 px-2 py-1.5 rounded-md border border-border text-xs hover-elevate text-muted-foreground"
                          data-testid="button-league-reset"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Tous
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t">
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {criteria.bankroll > 0 && filteredPredictions.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Wallet className="h-3 w-3" />
                          Mise: <span className="font-medium text-foreground">{((criteria.bankroll * criteria.stakePercent) / 100).toFixed(0)}€</span>
                          <ArrowUpDown className="h-3 w-3 mx-1" />
                          Gain potentiel: <span className="font-medium text-emerald-400">{(((criteria.bankroll * criteria.stakePercent) / 100) * cumulativeOdds).toFixed(0)}€</span>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setCriteria({
                          matchCount: 3, riskLevel: "moderate", minOdds: 1.5, maxOdds: 50,
                          betType: "all", minConfidence: 50, valueOnly: false, sortBy: "confidence",
                          selectedLeagues: [], bankroll: 100, stakePercent: 5,
                        })}
                        data-testid="button-reset-criteria"
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Reset
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => generateAllPredictions.mutate()}
                        disabled={generateAllPredictions.isPending}
                        data-testid="button-generate-all"
                      >
                        {generateAllPredictions.isPending ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Analyse...
                          </>
                        ) : (
                          <>
                            <Zap className="h-4 w-4 mr-2" />
                            Générer
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Zap className="h-5 w-5 text-yellow-500" />
                    Pronostics du jour
                    {filteredPredictions.length > 0 && (
                      <Badge variant="secondary">{filteredPredictions.length}/{generatedList.length}</Badge>
                    )}
                  </div>
                  {filteredPredictions.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={oddsInRange ? "default" : "secondary"} className="text-sm">
                        Cote: x{cumulativeOdds.toFixed(2)}
                      </Badge>
                      {criteria.bankroll > 0 && (
                        <Badge variant="outline" className="text-sm">
                          <Wallet className="h-3 w-3 mr-1" />
                          {((criteria.bankroll * criteria.stakePercent) / 100).toFixed(0)}€ → {(((criteria.bankroll * criteria.stakePercent) / 100) * cumulativeOdds).toFixed(0)}€
                        </Badge>
                      )}
                    </div>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {generatedList.length === 0 ? (
                  <div className="text-center py-6 space-y-3">
                    <Target className="h-10 w-10 mx-auto text-muted-foreground" />
                    <p className="text-muted-foreground">Aucun pronostic généré pour le moment</p>
                    <p className="text-sm text-muted-foreground">
                      Définissez vos critères ci-dessus puis cliquez "Générer le pronostic".
                    </p>
                    <div className="flex flex-wrap gap-2 justify-center pt-2">
                      <Badge variant="outline">
                        <BarChart3 className="h-3 w-3 mr-1" /> Poisson
                      </Badge>
                      <Badge variant="outline">
                        <Flame className="h-3 w-3 mr-1" /> Forme
                      </Badge>
                      <Badge variant="outline">
                        <Users className="h-3 w-3 mr-1" /> H2H
                      </Badge>
                      <Badge variant="outline">
                        <DollarSign className="h-3 w-3 mr-1" /> Value Bets
                      </Badge>
                    </div>
                  </div>
                ) : filteredPredictions.length === 0 ? (
                  <div className="text-center py-6 space-y-2">
                    <SlidersHorizontal className="h-10 w-10 mx-auto text-muted-foreground" />
                    <p className="text-muted-foreground">Aucun match ne correspond à vos critères</p>
                    <p className="text-sm text-muted-foreground">
                      Essayez d'ajuster le niveau de risque ou la fourchette de cotes.
                    </p>
                  </div>
                ) : (
                  <>
                    {filteredPredictions.map((pred, idx) => (
                      <Card key={pred.fixtureId} data-testid={`card-prediction-${pred.fixtureId}`}>
                        <CardContent className="p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary" className="text-xs">#{idx + 1}</Badge>
                              <span className="font-medium text-sm">
                                {pred.homeTeam} vs {pred.awayTeam}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className={`text-xs ${isOddsEstimated(pred) ? "border-dashed opacity-60" : ""}`} title={isOddsEstimated(pred) ? "Cote estimée (données indisponibles)" : "Cote réelle"}>
                                @{getMatchOddsForPrediction(pred).toFixed(2)}{isOddsEstimated(pred) ? "~" : ""}
                              </Badge>
                              <Badge variant="outline" className="text-xs">{pred.league}</Badge>
                            </div>
                          </div>
                          <PredictionResult prediction={pred} />
                        </CardContent>
                      </Card>
                    ))}

                    {filteredPredictions.length >= 2 && (
                      <Card className="border-primary/30 bg-primary/5">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="space-y-1">
                              <p className="font-semibold text-sm">Combiné {filteredPredictions.length} matchs</p>
                              <p className="text-xs text-muted-foreground">
                                {filteredPredictions.map(p => p.bestBet).join(" + ")}
                              </p>
                            </div>
                            <div className="text-right space-y-1">
                              <p className="text-xl font-bold text-primary" data-testid="text-cumulative-odds">
                                x{cumulativeOdds.toFixed(2)}
                              </p>
                              <p className="text-xs text-muted-foreground">Cote cumulée</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="history" className="mt-4">
            {historyLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map(i => (
                  <Card key={i}>
                    <CardContent className="p-4">
                      <Skeleton className="h-24 w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : historyPredictions.length === 0 ? (
              <EmptyState 
                icon={Trophy}
                title="Aucun historique"
                description="Les prédictions passées apparaîtront ici avec leurs résultats."
              />
            ) : (
              <div className="space-y-4">
                {historyPredictions.map(pred => (
                  <HistoryCard key={pred.id} prediction={pred} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="scorers" className="mt-4 space-y-4">
            <div className="flex gap-2 overflow-x-auto pb-2">
              {[
                { id: 61, name: "Ligue 1" },
                { id: 39, name: "Premier League" },
                { id: 140, name: "La Liga" },
                { id: 78, name: "Bundesliga" },
                { id: 135, name: "Serie A" },
              ].map((league) => (
                <Button
                  key={league.id}
                  variant={scorerLeague === league.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => setScorerLeague(league.id)}
                  data-testid={`button-scorer-league-${league.id}`}
                >
                  {league.name}
                </Button>
              ))}
            </div>

            {scorersLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map(i => (
                  <Card key={i}>
                    <CardContent className="p-4">
                      <Skeleton className="h-16 w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : !topScorersData?.response || topScorersData.response.length === 0 ? (
              <EmptyState
                icon={Star}
                title="Aucun buteur disponible"
                description="Les meilleurs buteurs de cette ligue apparaitront ici."
              />
            ) : (
              <div className="space-y-3">
                {(topScorersData.response || []).map((scorer: any, index: number) => {
                  const player = scorer?.player;
                  const stats = scorer?.statistics?.[0];
                  if (!player) return null;
                  return (
                    <Card key={player.id || index} data-testid={`card-scorer-${player.id || index}`}>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted text-sm font-bold shrink-0">
                            {index + 1}
                          </div>
                          {player.photo ? (
                            <img src={player.photo} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-bold shrink-0">
                              {player.name?.charAt(0) || "?"}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold truncate" data-testid={`text-scorer-name-${player.id || index}`}>{player.name}</p>
                            <div className="flex items-center gap-2">
                              {stats?.team?.logo && (
                                <img src={stats.team.logo} alt="" className="w-4 h-4 object-contain" />
                              )}
                              <span className="text-sm text-muted-foreground truncate">{stats?.team?.name || "N/A"}</span>
                            </div>
                          </div>
                          <div className="flex gap-2 sm:gap-3 shrink-0 text-center">
                            <div>
                              <p className="text-[10px] sm:text-xs text-muted-foreground">Buts</p>
                              <p className="font-bold text-base sm:text-lg" data-testid={`text-scorer-goals-${player.id || index}`}>{stats?.goals?.total ?? 0}</p>
                            </div>
                            <div>
                              <p className="text-[10px] sm:text-xs text-muted-foreground">PD</p>
                              <p className="font-bold text-sm sm:text-base" data-testid={`text-scorer-assists-${player.id || index}`}>{stats?.goals?.assists ?? 0}</p>
                            </div>
                            <div className="hidden sm:block">
                              <p className="text-xs text-muted-foreground">Matchs</p>
                              <p className="font-bold" data-testid={`text-scorer-appearances-${player.id || index}`}>{stats?.games?.appearences ?? 0}</p>
                            </div>
                            <div className="hidden sm:block">
                              <p className="text-xs text-muted-foreground">Note</p>
                              <p className="font-bold" data-testid={`text-scorer-rating-${player.id || index}`}>
                                {stats?.games?.rating ? parseFloat(stats.games.rating).toFixed(1) : "-"}
                              </p>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="injuries" className="mt-4 space-y-4">
            <div className="flex gap-2 overflow-x-auto pb-2">
              {[
                { id: 61, name: "Ligue 1" },
                { id: 39, name: "Premier League" },
                { id: 140, name: "La Liga" },
                { id: 78, name: "Bundesliga" },
                { id: 135, name: "Serie A" },
              ].map((league) => (
                <Button
                  key={league.id}
                  variant={injuryLeague === league.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => setInjuryLeague(league.id)}
                  data-testid={`button-injury-league-${league.id}`}
                >
                  {league.name}
                </Button>
              ))}
            </div>

            {injuriesLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map(i => (
                  <Card key={i}>
                    <CardContent className="p-4">
                      <Skeleton className="h-16 w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : !injuriesData?.response || injuriesData.response.length === 0 ? (
              <EmptyState
                icon={AlertTriangle}
                title="Aucune blessure disponible"
                description="Les blessures des joueurs de cette ligue apparaitront ici."
              />
            ) : (
              <div className="space-y-3">
                {(injuriesData.response || []).map((injury: any, index: number) => {
                  const player = injury?.player;
                  const team = injury?.team;
                  if (!player) return null;
                  return (
                    <Card key={`${player.id || index}-${index}`} data-testid={`card-injury-${player.id || index}`}>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-4">
                          {player.photo ? (
                            <img src={player.photo} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-bold shrink-0">
                              {player.name?.charAt(0) || "?"}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold truncate" data-testid={`text-injury-player-${player.id || index}`}>{player.name}</p>
                            <div className="flex items-center gap-2">
                              {team?.logo && (
                                <img src={team.logo} alt="" className="w-4 h-4 object-contain" />
                              )}
                              <span className="text-sm text-muted-foreground truncate">{team?.name || "N/A"}</span>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <Badge variant="outline" className="mb-1" data-testid={`text-injury-type-${player.id || index}`}>
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              {injury?.player?.type || "Blessure"}
                            </Badge>
                            <p className="text-xs text-muted-foreground" data-testid={`text-injury-reason-${player.id || index}`}>
                              {injury?.player?.reason || "Non spécifié"}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
