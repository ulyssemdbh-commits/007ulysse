
export interface PredictionStats {
  total: number;
  pending: number;
  won: number;
  lost: number;
  successRate: number;
  bySport: Record<string, { total: number; won: number; rate: number }>;
}

export interface League {
  id: number;
  name: string;
  code: string;
  country: string;
}

export interface Team {
  id: number;
  name: string;
  logo?: string;
}

export interface UpcomingMatch {
  fixtureId: number;
  date: string;
  status: string;
  league: League;
  homeTeam: Team;
  awayTeam: Team;
  goals: { home: number | null; away: number | null };
  odds?: MatchOdds | null;
}

export interface MatchOdds {
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

export interface Prediction {
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

export interface GeneratedPrediction {
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

export type RiskLevel = "safe" | "moderate" | "risky";
export type BetTypeFilter = "all" | "1X2" | "over_under" | "btts";
export type SortMode = "confidence" | "value" | "odds";

export interface PredictionCriteria {
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

export const LEAGUE_FLAGS: Record<string, string> = {
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

export const LEAGUE_COLORS: Record<string, string> = {
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

