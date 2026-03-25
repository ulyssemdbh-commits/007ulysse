import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSportsScreenContext } from "@/hooks/useSportsScreenContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronDown,
  ChevronRight,
  Trophy,
  Users,
  BarChart3,
  Globe,
  ArrowLeft,
  Shield,
  Star,
  BookOpen,
  MapPin,
  Calendar,
  X,
  Activity,
  Target,
  Zap,
  AlertTriangle,
  Menu,
} from "lucide-react";

interface AlmanachLeague {
  id: number;
  name: string;
  code: string;
  type: string;
}

interface AlmanachCountry {
  name: string;
  leagues: AlmanachLeague[];
}

interface AlmanachSeason {
  year: number;
  label: string;
  isCurrent: boolean;
}

interface StandingTeam {
  rank: number;
  team: { id: number; name: string; logo: string };
  points: number;
  goalsDiff: number;
  all: {
    played: number;
    win: number;
    draw: number;
    lose: number;
    goals: { for: number; against: number };
  };
}

interface SquadPlayer {
  id: number;
  name: string;
  age: number;
  number: number | null;
  position: string;
  photo: string;
}

interface PlayerStatistics {
  team: { id: number; name: string; logo: string };
  league: { id: number; name: string; country: string; season: number };
  games: { appearences: number; lineups: number; minutes: number; position: string; rating: string | null };
  goals: { total: number | null; conceded: number | null; assists: number | null };
  shots: { total: number | null; on: number | null };
  passes: { total: number | null; key: number | null; accuracy: number | null };
  tackles: { total: number | null; blocks: number | null; interceptions: number | null };
  duels: { total: number | null; won: number | null };
  dribbles: { attempts: number | null; success: number | null };
  fouls: { drawn: number | null; committed: number | null };
  cards: { yellow: number; yellowred: number; red: number };
  penalty: { won: number | null; commited: number | null; scored: number | null; missed: number | null };
}

interface PlayerFullInfo {
  player: {
    id: number;
    name: string;
    firstname: string;
    lastname: string;
    age: number;
    birth: { date: string; place: string | null; country: string | null };
    nationality: string;
    height: string | null;
    weight: string | null;
    photo: string;
    injured: boolean;
  };
  statistics: PlayerStatistics[];
}

type ViewMode = "countries" | "teams" | "competitions" | "standings";

interface CompetitionLine {
  league: string;
  leagueId: number;
  matches: number;
  goals: number;
  assists: number;
  rating: string | null;
  minutes: number;
  cards: { yellow: number; red: number };
}

interface PlayerApiResponse {
  success: boolean;
  player: PlayerFullInfo;
  aggregated: PlayerStatistics | null;
  domesticLeagueName: string | null;
  competitions: CompetitionLine[];
}

function StatBlock({ label, value, sub, className }: { label: string; value: string | number; sub?: string; className?: string }) {
  return (
    <div className="py-2 rounded-md bg-muted/50 text-center">
      <span className="block text-[10px] text-muted-foreground">{label}</span>
      <span className={`font-bold ${className || ""}`}>{value}</span>
      {sub && <span className="block text-[9px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

function StatsSection({ stats, title }: { stats: PlayerStatistics; title: string }) {
  const rating = stats.games?.rating ? parseFloat(stats.games.rating) : null;
  const ratingColor = rating
    ? rating >= 7.5 ? "text-emerald-500" : rating >= 6.5 ? "text-amber-400" : "text-red-400"
    : "text-muted-foreground";
  const duelsWonPct = stats.duels?.total && stats.duels?.won
    ? Math.round((stats.duels.won / stats.duels.total) * 100) : null;
  const dribblesPct = stats.dribbles?.attempts && stats.dribbles?.success
    ? Math.round((stats.dribbles.success / stats.dribbles.attempts) * 100) : null;

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold flex items-center gap-2">
        <Activity className="h-4 w-4 text-primary" />
        {title}
      </h4>
      <div className="grid grid-cols-3 gap-2">
        <StatBlock label="Note moy." value={rating ? rating.toFixed(1) : "N/A"} className={`text-lg ${ratingColor}`} />
        <StatBlock label="Matchs" value={stats.games.appearences || 0} className="text-lg" />
        <StatBlock label="Minutes" value={stats.games.minutes || 0} className="text-lg" />
      </div>
      <div className="grid grid-cols-4 gap-2">
        <StatBlock label="Buts" value={stats.goals.total ?? 0} />
        <StatBlock label="Passes D." value={stats.goals.assists ?? 0} />
        <StatBlock label="Tirs cadres" value={`${stats.shots.on ?? 0}/${stats.shots.total ?? 0}`} />
        <StatBlock label="Passes cle" value={stats.passes.key ?? 0} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <StatBlock label="Duels gagnes" value={duelsWonPct !== null ? `${duelsWonPct}%` : "N/A"} sub={stats.duels.total != null ? `${stats.duels.won}/${stats.duels.total}` : undefined} />
        <StatBlock label="Dribbles reussis" value={dribblesPct !== null ? `${dribblesPct}%` : "N/A"} sub={stats.dribbles.attempts != null ? `${stats.dribbles.success}/${stats.dribbles.attempts}` : undefined} />
        <StatBlock label="Tacles + Int." value={(stats.tackles.total ?? 0) + (stats.tackles.interceptions ?? 0)} />
      </div>
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1">
          <div className="w-3 h-4 rounded-sm bg-amber-400" />
          <span>{stats.cards.yellow}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-4 rounded-sm bg-red-500" />
          <span>{stats.cards.red + stats.cards.yellowred}</span>
        </div>
        <span className="text-muted-foreground">Fautes: {stats.fouls.committed ?? 0}</span>
        {stats.passes.accuracy != null && (
          <span className="text-muted-foreground">Precision: {stats.passes.accuracy}%</span>
        )}
      </div>
    </div>
  );
}

function PlayerDetail({ playerId, teamId, onClose }: { playerId: number; teamId?: number; onClose: () => void }) {
  const [viewMode, setViewMode] = useState<"league" | "all">("league");

  const { data, isLoading } = useQuery<PlayerApiResponse>({
    queryKey: ["/api/sports/almanach/player", playerId, teamId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (teamId) params.set("team", String(teamId));
      const res = await fetch(`/api/sports/almanach/player/${playerId}?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch player data");
      return res.json();
    },
  });

  const player = data?.player?.player;
  const leagueStats = data?.player?.statistics?.[0];
  const aggStats = data?.aggregated;
  const competitions = data?.competitions || [];
  const activeStats = viewMode === "all" && aggStats ? aggStats : leagueStats;
  const hasMultipleComps = competitions.length > 1;
  const leagueButtonLabel = data?.domesticLeagueName || leagueStats?.league.name || "Championnat";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={onClose}>
      <Card className="w-full max-w-lg mx-0 sm:mx-4 max-h-[90vh] sm:max-h-[85vh] overflow-y-auto rounded-b-none sm:rounded-b-lg" onClick={(e) => e.stopPropagation()}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {isLoading ? (
                <Skeleton className="w-16 h-16 rounded-full shrink-0" />
              ) : player?.photo ? (
                <img src={player.photo} alt="" className="w-16 h-16 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center text-xl font-bold shrink-0">?</div>
              )}
              <div className="min-w-0">
                {isLoading ? (
                  <Skeleton className="h-5 w-32" />
                ) : (
                  <>
                    <CardTitle className="text-lg truncate">{player?.name}</CardTitle>
                    <p className="text-sm text-muted-foreground">{leagueStats?.games?.position || "N/A"}</p>
                    {player?.injured && (
                      <Badge variant="destructive" className="text-[10px] mt-1">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        Blesse
                      </Badge>
                    )}
                  </>
                )}
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-player">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        {isLoading ? (
          <CardContent className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </CardContent>
        ) : player && activeStats ? (
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Nationalite</span>
                <span className="font-medium">{player.nationality}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Age</span>
                <span className="font-medium">{player.age} ans</span>
              </div>
              {player.height && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Taille</span>
                  <span className="font-medium">{player.height}</span>
                </div>
              )}
              {player.weight && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Poids</span>
                  <span className="font-medium">{player.weight}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Club</span>
                <span className="font-medium truncate">{activeStats.team.name}</span>
              </div>
              {leagueStats && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Saison</span>
                  <span className="font-medium">{leagueStats.league.season}/{leagueStats.league.season + 1}</span>
                </div>
              )}
            </div>

            {hasMultipleComps && (
              <div className="flex gap-1 border-t pt-3">
                <Button
                  variant={viewMode === "league" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("league")}
                  data-testid="button-stats-league"
                >
                  {leagueButtonLabel}
                </Button>
                <Button
                  variant={viewMode === "all" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("all")}
                  data-testid="button-stats-all"
                >
                  Toutes comp.
                </Button>
              </div>
            )}

            <div className="border-t pt-3">
              <StatsSection
                stats={activeStats}
                title={viewMode === "all" && hasMultipleComps
                  ? "Toutes competitions confondues"
                  : leagueButtonLabel}
              />
            </div>

            {hasMultipleComps && (
              <div className="border-t pt-3">
                <h4 className="text-sm font-semibold mb-2">Detail par competition</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs" data-testid="table-player-competitions">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-1.5 px-1">Competition</th>
                        <th className="text-center py-1.5 px-1">MJ</th>
                        <th className="text-center py-1.5 px-1">Min</th>
                        <th className="text-center py-1.5 px-1">B</th>
                        <th className="text-center py-1.5 px-1">PD</th>
                        <th className="text-center py-1.5 px-1">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {competitions.map((c) => (
                        <tr key={c.leagueId} className="border-b border-muted/30">
                          <td className="py-1.5 px-1 font-medium truncate max-w-[140px]">{c.league}</td>
                          <td className="text-center py-1.5 px-1">{c.matches}</td>
                          <td className="text-center py-1.5 px-1">{c.minutes}</td>
                          <td className="text-center py-1.5 px-1">{c.goals}</td>
                          <td className="text-center py-1.5 px-1">{c.assists}</td>
                          <td className="text-center py-1.5 px-1">{c.rating ? parseFloat(c.rating).toFixed(1) : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        ) : (
          <CardContent>
            <p className="text-sm text-muted-foreground">Donnees joueur non disponibles.</p>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function StandingsTable({ standings, leagueName, seasonLabel }: { standings: StandingTeam[]; leagueName: string; seasonLabel: string }) {
  if (!standings.length) {
    return <p className="text-sm text-muted-foreground p-4">Classement non disponible pour cette competition ({seasonLabel}).</p>;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-lg font-semibold flex items-center gap-2" data-testid="text-standings-title">
        <BarChart3 className="h-5 w-5 text-primary" />
        Classement - {leagueName}
        <Badge variant="outline" className="text-xs ml-1">{seasonLabel}</Badge>
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="table-standings">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="text-left py-2 px-2 w-8">#</th>
              <th className="text-left py-2 px-2">Equipe</th>
              <th className="text-center py-2 px-1">MJ</th>
              <th className="text-center py-2 px-1">V</th>
              <th className="text-center py-2 px-1">N</th>
              <th className="text-center py-2 px-1">D</th>
              <th className="text-center py-2 px-1">BP</th>
              <th className="text-center py-2 px-1">BC</th>
              <th className="text-center py-2 px-1">Diff</th>
              <th className="text-center py-2 px-2 font-bold">Pts</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s) => (
              <tr key={s.team.id} className="border-b border-muted/30 hover-elevate" data-testid={`row-standing-${s.team.id}`}>
                <td className="py-2 px-2 font-bold text-muted-foreground">{s.rank}</td>
                <td className="py-2 px-2">
                  <div className="flex items-center gap-2">
                    {s.team.logo && <img src={s.team.logo} alt="" className="w-5 h-5 object-contain" />}
                    <span className="font-medium truncate">{s.team.name}</span>
                  </div>
                </td>
                <td className="text-center py-2 px-1">{s.all.played}</td>
                <td className="text-center py-2 px-1 text-emerald-500">{s.all.win}</td>
                <td className="text-center py-2 px-1 text-amber-400">{s.all.draw}</td>
                <td className="text-center py-2 px-1 text-red-400">{s.all.lose}</td>
                <td className="text-center py-2 px-1">{s.all.goals.for}</td>
                <td className="text-center py-2 px-1">{s.all.goals.against}</td>
                <td className="text-center py-2 px-1 font-medium">{s.goalsDiff > 0 ? `+${s.goalsDiff}` : s.goalsDiff}</td>
                <td className="text-center py-2 px-2 font-bold text-primary">{s.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TeamDetail({ teamId, teamName }: { teamId: number; teamName: string }) {
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);

  const { data, isLoading } = useQuery<{ success: boolean; squad: any; stats: any }>({
    queryKey: [`/api/sports/almanach/team/${teamId}`],
  });

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const squad = data?.squad;
  const stats = data?.stats;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold flex items-center gap-2" data-testid="text-team-detail-title">
        <Shield className="h-5 w-5 text-primary" />
        {teamName}
      </h3>

      {stats && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Statistiques (10 derniers matchs)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center text-sm">
              <div className="py-2 rounded-md bg-muted/50">
                <span className="block text-xs text-muted-foreground">Forme</span>
                <span className="font-bold">{stats.form || "N/A"}</span>
              </div>
              <div className="py-2 rounded-md bg-muted/50">
                <span className="block text-xs text-muted-foreground">Buts/Match</span>
                <span className="font-bold">{stats.goalsAvg?.toFixed(1) || "N/A"}</span>
              </div>
              <div className="py-2 rounded-md bg-muted/50">
                <span className="block text-xs text-muted-foreground">Over 2.5</span>
                <span className="font-bold">{stats.over25Rate ? `${(stats.over25Rate * 100).toFixed(0)}%` : "N/A"}</span>
              </div>
              <div className="py-2 rounded-md bg-muted/50">
                <span className="block text-xs text-muted-foreground">BTTS</span>
                <span className="font-bold">{stats.bttsRate ? `${(stats.bttsRate * 100).toFixed(0)}%` : "N/A"}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {squad?.players && squad.players.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="h-4 w-4" />
              Effectif ({squad.players.length} joueurs)
            </CardTitle>
            <p className="text-[11px] text-muted-foreground">Cliquez sur un joueur pour voir ses stats</p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
              {(squad.players as SquadPlayer[]).map((p: SquadPlayer) => (
                <div
                  key={p.id}
                  className="flex items-center gap-1.5 sm:gap-2 py-1.5 px-1.5 sm:px-2 text-sm rounded-md cursor-pointer hover-elevate"
                  onClick={() => setSelectedPlayerId(p.id)}
                  data-testid={`button-player-${p.id}`}
                >
                  {p.photo ? (
                    <img src={p.photo} alt="" className="w-6 h-6 sm:w-7 sm:h-7 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-muted flex items-center justify-center text-[10px] sm:text-xs font-bold shrink-0">
                      {p.name?.charAt(0) || "?"}
                    </div>
                  )}
                  <span className="truncate flex-1 text-xs sm:text-sm">{p.number ? `${p.number}. ` : ""}{p.name}</span>
                  <Badge variant="outline" className="text-[10px] shrink-0">{p.position}</Badge>
                  {p.age > 0 && <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">{p.age} ans</span>}
                  <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {!squad?.players && !stats && (
        <p className="text-sm text-muted-foreground">Aucune donnee disponible pour cette equipe.</p>
      )}

      {selectedPlayerId && (
        <PlayerDetail playerId={selectedPlayerId} teamId={teamId} onClose={() => setSelectedPlayerId(null)} />
      )}
    </div>
  );
}

export default function FootAlmanach() {
  const [expandedCountry, setExpandedCountry] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewMode>("countries");
  const [selectedLeagueId, setSelectedLeagueId] = useState<number | null>(null);
  const [selectedLeagueName, setSelectedLeagueName] = useState<string>("");
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [selectedTeamName, setSelectedTeamName] = useState<string>("");
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { broadcast: broadcastScreen } = useSportsScreenContext("almanach");

  const { data: countriesData, isLoading: countriesLoading } = useQuery<{ success: boolean; countries: AlmanachCountry[] }>({
    queryKey: ["/api/sports/almanach/countries"],
  });

  const { data: seasonsData } = useQuery<{ success: boolean; seasons: AlmanachSeason[] }>({
    queryKey: ["/api/sports/almanach/available-seasons"],
  });

  const seasons = seasonsData?.seasons || [];
  const currentSeason = seasons.find(s => s.isCurrent);
  const activeSeason = selectedSeason || currentSeason?.year;
  const activeSeasonLabel = seasons.find(s => s.year === activeSeason)?.label || "";

  const standingsUrl = selectedLeagueId && activeSeason
    ? `/api/sports/almanach/standings/${selectedLeagueId}?season=${activeSeason}`
    : null;

  const { data: standingsData, isLoading: standingsLoading } = useQuery<{ success: boolean; standings: StandingTeam[] }>({
    queryKey: [standingsUrl],
    enabled: !!standingsUrl && (activeView === "standings" || activeView === "teams"),
  });

  const countries = countriesData?.countries || [];

  useEffect(() => {
    broadcastScreen({
      tab: activeView,
      selectedLeague: selectedLeagueName || undefined,
      selectedTeamId: selectedTeamId || undefined,
      selectedTeamName: selectedTeamName || undefined,
      standings: activeView === "standings" && standingsData?.standings
        ? standingsData.standings.slice(0, 10).map(s => ({
            position: s.rank,
            team: s.team?.name || "",
            points: s.points,
          }))
        : undefined,
    });
  }, [activeView, selectedLeagueName, selectedTeamId, selectedTeamName, standingsData?.standings?.map(s => `${s.rank}-${s.team?.name}-${s.points}`).join(",") || ""]);

  const handleSelectLeague = (leagueId: number, leagueName: string, view: ViewMode) => {
    setSelectedLeagueId(leagueId);
    setSelectedLeagueName(leagueName);
    setActiveView(view);
    setSelectedTeamId(null);
    setSelectedTeamName("");
    setSidebarOpen(false);
  };

  const handleSelectTeam = (teamId: number, teamName: string) => {
    setSelectedTeamId(teamId);
    setSelectedTeamName(teamName);
    setActiveView("teams");
    setSidebarOpen(false);
  };

  const handleBack = () => {
    if (selectedTeamId) {
      setSelectedTeamId(null);
      setSelectedTeamName("");
    } else if (selectedLeagueId) {
      setSelectedLeagueId(null);
      setSelectedLeagueName("");
      setActiveView("countries");
    }
  };

  const sidebarContent = (
    <>
      <div className="p-3 sm:p-4 border-b">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base sm:text-lg font-bold flex items-center gap-2" data-testid="text-almanach-title">
            <BookOpen className="h-5 w-5 text-primary shrink-0" />
            <span className="truncate">Foot-Almanach</span>
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(false)}
            className="md:hidden shrink-0"
            data-testid="button-close-sidebar"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">Encyclopedie du football europeen</p>
        {seasons.length > 0 && (
          <div className="mt-3">
            <Select
              value={String(activeSeason)}
              onValueChange={(v) => setSelectedSeason(parseInt(v))}
            >
              <SelectTrigger className="w-full" data-testid="select-season">
                <Calendar className="h-4 w-4 mr-2 shrink-0 text-muted-foreground" />
                <SelectValue placeholder="Saison" />
              </SelectTrigger>
              <SelectContent>
                {seasons.map((s) => (
                  <SelectItem key={s.year} value={String(s.year)} data-testid={`option-season-${s.year}`}>
                    {s.label}{s.isCurrent ? " (en cours)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {countriesLoading ? (
          <div className="space-y-2 p-2">
            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : (
          countries.map((country) => (
            <div key={country.name}>
              <Button
                variant="ghost"
                onClick={() => setExpandedCountry(expandedCountry === country.name ? null : country.name)}
                className="w-full justify-start gap-2 font-medium"
                data-testid={`button-country-${country.name}`}
              >
                <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 text-left truncate">{country.name}</span>
                {expandedCountry === country.name ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
              </Button>

              {expandedCountry === country.name && (
                <div className="ml-4 space-y-0.5 pb-1">
                  {country.leagues.map((league) => (
                    <div key={league.code} className="space-y-0.5">
                      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        {league.name}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSelectLeague(league.id, league.name, "teams")}
                        className={`w-full justify-start gap-2 text-xs ${
                          selectedLeagueId === league.id && activeView === "teams" ? "bg-primary/10 text-primary" : ""
                        }`}
                        data-testid={`button-league-teams-${league.code}`}
                      >
                        <Users className="h-3 w-3 shrink-0" />
                        <span>Equipes</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSelectLeague(league.id, league.name, "competitions")}
                        className={`w-full justify-start gap-2 text-xs ${
                          selectedLeagueId === league.id && activeView === "competitions" ? "bg-primary/10 text-primary" : ""
                        }`}
                        data-testid={`button-league-competitions-${league.code}`}
                      >
                        <Trophy className="h-3 w-3 shrink-0" />
                        <span>Competitions</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSelectLeague(league.id, league.name, "standings")}
                        className={`w-full justify-start gap-2 text-xs ${
                          selectedLeagueId === league.id && activeView === "standings" ? "bg-primary/10 text-primary" : ""
                        }`}
                        data-testid={`button-league-standings-${league.code}`}
                      >
                        <BarChart3 className="h-3 w-3 shrink-0" />
                        <span>Classements</span>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </nav>
    </>
  );

  return (
    <div className="flex h-screen bg-background">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`
        fixed inset-y-0 left-0 z-50 w-72 border-r bg-background flex flex-col overflow-hidden
        transform transition-transform duration-200 ease-in-out
        md:relative md:translate-x-0 md:z-auto
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
      `}>
        {sidebarContent}
      </aside>

      <main className="flex-1 overflow-y-auto min-w-0">
        <header className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b">
          <div className="px-3 sm:px-6 py-2 sm:py-3 flex items-center gap-2 sm:gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(true)}
              className="md:hidden shrink-0"
              data-testid="button-open-sidebar"
            >
              <Menu className="h-5 w-5" />
            </Button>
            {(selectedLeagueId || selectedTeamId) && (
              <Button variant="ghost" size="icon" onClick={handleBack} data-testid="button-almanach-back">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-base sm:text-lg font-semibold truncate" data-testid="text-main-title">
                {selectedTeamId ? selectedTeamName : selectedLeagueName || "Foot-Almanach"}
              </h1>
              {!selectedLeagueId && !selectedTeamId && (
                <>
                  <p className="text-xs text-muted-foreground md:hidden">Ouvrez le menu pour naviguer</p>
                  <p className="text-sm text-muted-foreground hidden md:block">Selectionnez un pays et une competition dans le menu</p>
                </>
              )}
            </div>
            {selectedLeagueId && activeSeasonLabel && (
              <Badge variant="secondary" className="shrink-0" data-testid="badge-active-season">
                <Calendar className="h-3 w-3 mr-1" />
                {activeSeasonLabel}
              </Badge>
            )}
          </div>
        </header>

        <div className="p-3 sm:p-6">
          {!selectedLeagueId && !selectedTeamId && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {countries.map((country) => (
                <Card key={country.name} className="hover-elevate cursor-pointer" onClick={() => setExpandedCountry(country.name)} data-testid={`card-country-${country.name}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <Globe className="h-5 w-5 text-primary shrink-0" />
                      <div className="flex-1">
                        <h3 className="font-semibold">{country.name}</h3>
                        <p className="text-xs text-muted-foreground">{country.leagues.length} competition{country.leagues.length > 1 ? "s" : ""}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {country.leagues.map((l) => (
                        <Badge key={l.code} variant="outline" className="text-[10px]">{l.name}</Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {selectedLeagueId && activeView === "standings" && (
            <>
              {standingsLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : (
                <StandingsTable standings={standingsData?.standings || []} leagueName={selectedLeagueName} seasonLabel={activeSeasonLabel} />
              )}
            </>
          )}

          {selectedLeagueId && activeView === "teams" && !selectedTeamId && (
            <>
              {standingsLoading ? (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-20 w-full" />)}
                </div>
              ) : (
                <div className="space-y-3">
                  <h3 className="text-lg font-semibold flex items-center gap-2" data-testid="text-teams-title">
                    <Users className="h-5 w-5 text-primary" />
                    Equipes - {selectedLeagueName}
                    <Badge variant="outline" className="text-xs ml-1">{activeSeasonLabel}</Badge>
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {(standingsData?.standings || []).map((s) => (
                      <Card
                        key={s.team.id}
                        className="hover-elevate cursor-pointer"
                        onClick={() => handleSelectTeam(s.team.id, s.team.name)}
                        data-testid={`card-team-${s.team.id}`}
                      >
                        <CardContent className="p-4 flex items-center gap-3">
                          {s.team.logo && <img src={s.team.logo} alt="" className="w-10 h-10 object-contain shrink-0" />}
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold truncate">{s.team.name}</p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>#{s.rank}</span>
                              <span>{s.points} pts</span>
                              <span>{s.all.win}V {s.all.draw}N {s.all.lose}D</span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {selectedTeamId && (
            <TeamDetail teamId={selectedTeamId} teamName={selectedTeamName} />
          )}

          {selectedLeagueId && activeView === "competitions" && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold flex items-center gap-2" data-testid="text-competition-title">
                <Trophy className="h-5 w-5 text-primary" />
                {selectedLeagueName}
                <Badge variant="outline" className="text-xs ml-1">{activeSeasonLabel}</Badge>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="hover-elevate cursor-pointer" onClick={() => handleSelectLeague(selectedLeagueId, selectedLeagueName, "standings")} data-testid="card-goto-standings">
                  <CardContent className="p-4 flex items-center gap-3">
                    <BarChart3 className="h-8 w-8 text-primary shrink-0" />
                    <div>
                      <p className="font-semibold">Classement</p>
                      <p className="text-xs text-muted-foreground">Voir le classement complet</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="hover-elevate cursor-pointer" onClick={() => handleSelectLeague(selectedLeagueId, selectedLeagueName, "teams")} data-testid="card-goto-teams">
                  <CardContent className="p-4 flex items-center gap-3">
                    <Users className="h-8 w-8 text-primary shrink-0" />
                    <div>
                      <p className="font-semibold">Equipes</p>
                      <p className="text-xs text-muted-foreground">Toutes les equipes</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="hover-elevate cursor-pointer" data-testid="card-goto-topscorers">
                  <CardContent className="p-4 flex items-center gap-3">
                    <Star className="h-8 w-8 text-amber-500 shrink-0" />
                    <div>
                      <p className="font-semibold">Meilleurs buteurs</p>
                      <p className="text-xs text-muted-foreground">Top scorers de la saison</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
