import { motion, AnimatePresence } from "framer-motion";
import { X, Trophy, Users, Zap, TrendingUp, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type VoiceCardType = "ranking" | "topscorers" | "live_scores" | "odds" | "match";

interface RankingItem {
  position: number;
  team: string;
  points: number;
  played?: number;
  wins?: number;
  draws?: number;
  losses?: number;
  goalDiff?: number;
}

interface ScorerItem {
  position: number;
  name: string;
  team: string;
  goals: number;
  assists?: number;
}

interface LiveMatch {
  homeTeam: string;
  awayTeam: string;
  score?: { home: number; away: number };
  minute?: number;
  league?: string;
}

interface OddsData {
  homeWin?: number;
  draw?: number;
  awayWin?: number;
  bookmaker?: string;
}

export interface VoiceCardData {
  type: VoiceCardType;
  ranking?: RankingItem[];
  scorers?: ScorerItem[];
  matches?: LiveMatch[];
  odds?: OddsData;
  league?: string;
  team?: string;
}

interface VoiceDataCardProps {
  data: VoiceCardData | null;
  onClose: () => void;
  className?: string;
}

export function VoiceDataCard({ data, onClose, className }: VoiceDataCardProps) {
  if (!data) return null;

  const renderContent = () => {
    switch (data.type) {
      case "ranking":
        return <RankingCard ranking={data.ranking || []} league={data.league} />;
      case "topscorers":
        return <TopscorersCard scorers={data.scorers || []} league={data.league} />;
      case "live_scores":
        return <LiveScoresCard matches={data.matches || []} />;
      case "odds":
        return <OddsCard odds={data.odds} team={data.team} />;
      default:
        return null;
    }
  };

  const getCardTitle = () => {
    switch (data.type) {
      case "ranking": return `Classement ${data.league || ""}`;
      case "topscorers": return `Buteurs ${data.league || ""}`;
      case "live_scores": return "Matchs en direct";
      case "odds": return `Cotes ${data.team || ""}`;
      default: return "Données";
    }
  };

  const getCardIcon = () => {
    switch (data.type) {
      case "ranking": return Trophy;
      case "topscorers": return Users;
      case "live_scores": return Zap;
      case "odds": return TrendingUp;
      default: return Trophy;
    }
  };

  const Icon = getCardIcon();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className={cn("absolute bottom-20 left-4 right-4 z-50", className)}
      >
        <Card className="bg-card/95 backdrop-blur border shadow-lg" data-testid="voice-data-card">
          <CardHeader className="flex flex-row items-center justify-between gap-2 py-3 px-4">
            <div className="flex items-center gap-2">
              <Icon className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">{getCardTitle()}</CardTitle>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={onClose}
              data-testid="button-close-voice-card"
            >
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            {renderContent()}
          </CardContent>
        </Card>
      </motion.div>
    </AnimatePresence>
  );
}

function RankingCard({ ranking, league }: { ranking: RankingItem[]; league?: string }) {
  if (!ranking.length) return <div className="text-sm text-muted-foreground">Aucune donnée</div>;

  return (
    <div className="space-y-1">
      {ranking.slice(0, 5).map((item, i) => (
        <div
          key={i}
          className={cn(
            "flex items-center justify-between py-1.5 px-2 rounded text-sm",
            i < 4 && "bg-muted/50"
          )}
          data-testid={`ranking-row-${i}`}
        >
          <div className="flex items-center gap-2">
            <span className={cn(
              "w-6 text-center font-bold",
              i === 0 && "text-yellow-500",
              i === 1 && "text-slate-400",
              i === 2 && "text-amber-600"
            )}>
              {item.position}
            </span>
            <span className="font-medium">{item.team}</span>
          </div>
          <div className="flex items-center gap-3 text-muted-foreground">
            <span className="text-xs">{item.played || "-"}J</span>
            <span className="font-bold text-foreground">{item.points} pts</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function TopscorersCard({ scorers, league }: { scorers: ScorerItem[]; league?: string }) {
  if (!scorers.length) return <div className="text-sm text-muted-foreground">Aucune donnée</div>;

  return (
    <div className="space-y-1">
      {scorers.slice(0, 5).map((item, i) => (
        <div
          key={i}
          className="flex items-center justify-between py-1.5 px-2 rounded text-sm"
          data-testid={`scorer-row-${i}`}
        >
          <div className="flex items-center gap-2">
            <span className={cn(
              "w-6 text-center font-bold",
              i === 0 && "text-yellow-500"
            )}>
              {item.position}
            </span>
            <span className="font-medium">{item.name}</span>
            <span className="text-xs text-muted-foreground">({item.team})</span>
          </div>
          <div className="flex items-center gap-1 font-bold">
            <span>{item.goals}</span>
            <Target className="h-3 w-3 text-primary" />
          </div>
        </div>
      ))}
    </div>
  );
}

function LiveScoresCard({ matches }: { matches: LiveMatch[] }) {
  if (!matches.length) return <div className="text-sm text-muted-foreground">Aucun match en cours</div>;

  return (
    <div className="space-y-2">
      {matches.slice(0, 4).map((match, i) => (
        <div
          key={i}
          className="flex items-center justify-between py-2 px-3 rounded bg-muted/50"
          data-testid={`live-match-${i}`}
        >
          <div className="flex-1 text-right text-sm font-medium">{match.homeTeam}</div>
          <div className="px-3 py-1 mx-2 rounded bg-primary/20 text-primary font-bold">
            {match.score ? `${match.score.home} - ${match.score.away}` : "- -"}
          </div>
          <div className="flex-1 text-left text-sm font-medium">{match.awayTeam}</div>
        </div>
      ))}
    </div>
  );
}

function OddsCard({ odds, team }: { odds?: OddsData; team?: string }) {
  if (!odds) return <div className="text-sm text-muted-foreground">Aucune cote disponible</div>;

  return (
    <div className="flex justify-around py-2">
      <div className="text-center" data-testid="odds-home">
        <div className="text-xs text-muted-foreground mb-1">Victoire 1</div>
        <div className="text-xl font-bold text-primary">{odds.homeWin?.toFixed(2) || "-"}</div>
      </div>
      <div className="text-center" data-testid="odds-draw">
        <div className="text-xs text-muted-foreground mb-1">Nul</div>
        <div className="text-xl font-bold">{odds.draw?.toFixed(2) || "-"}</div>
      </div>
      <div className="text-center" data-testid="odds-away">
        <div className="text-xs text-muted-foreground mb-1">Victoire 2</div>
        <div className="text-xl font-bold text-primary">{odds.awayWin?.toFixed(2) || "-"}</div>
      </div>
    </div>
  );
}

export default VoiceDataCard;
