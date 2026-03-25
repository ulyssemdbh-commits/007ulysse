import { db } from "../db";
import { cachedMatches, cachedTeamStats, cachedOdds } from "@shared/schema";
import { eq, and, or, desc, gte, lte, notInArray } from "drizzle-orm";
import { GoogleGenAI } from "@google/genai";

// Types pour le modèle de probabilités
interface TeamStats {
  form: string;
  goalsScored: number;
  goalsConceded: number;
  over25Rate: number;
  bttsRate: number;
  cleanSheetRate: number;
  failedToScoreRate: number;
  homeWinRate?: number;
  awayWinRate?: number;
  drawRate?: number;
  homeGoalsForAvg?: number;
  homeGoalsAgainstAvg?: number;
  homeOver25Rate?: number;
  homeBttsRate?: number;
  awayGoalsForAvg?: number;
  awayGoalsAgainstAvg?: number;
  awayOver25Rate?: number;
  awayBttsRate?: number;
  last10Wins?: number;
  last10Draws?: number;
  last10Losses?: number;
  league?: string;
}

interface LeagueCalibration {
  homeAdvantage: number;
  avgGoalsPerMatch: number;
  drawRate: number;
  homeWinRate: number;
}

const LEAGUE_CALIBRATIONS: Record<string, LeagueCalibration> = {
  'Premier League': { homeAdvantage: 1.10, avgGoalsPerMatch: 2.85, drawRate: 0.22, homeWinRate: 0.45 },
  'La Liga': { homeAdvantage: 1.14, avgGoalsPerMatch: 2.55, drawRate: 0.25, homeWinRate: 0.47 },
  'Bundesliga': { homeAdvantage: 1.12, avgGoalsPerMatch: 3.10, drawRate: 0.21, homeWinRate: 0.44 },
  'Serie A': { homeAdvantage: 1.16, avgGoalsPerMatch: 2.65, drawRate: 0.24, homeWinRate: 0.46 },
  'Ligue 1': { homeAdvantage: 1.18, avgGoalsPerMatch: 2.60, drawRate: 0.24, homeWinRate: 0.46 },
  'Eredivisie': { homeAdvantage: 1.10, avgGoalsPerMatch: 3.05, drawRate: 0.20, homeWinRate: 0.44 },
  'Liga Portugal': { homeAdvantage: 1.15, avgGoalsPerMatch: 2.50, drawRate: 0.26, homeWinRate: 0.48 },
  'Super Lig': { homeAdvantage: 1.20, avgGoalsPerMatch: 2.75, drawRate: 0.22, homeWinRate: 0.50 },
  'Championship': { homeAdvantage: 1.12, avgGoalsPerMatch: 2.70, drawRate: 0.26, homeWinRate: 0.43 },
  'Champions League': { homeAdvantage: 1.08, avgGoalsPerMatch: 2.95, drawRate: 0.22, homeWinRate: 0.46 },
  'Europa League': { homeAdvantage: 1.10, avgGoalsPerMatch: 2.75, drawRate: 0.24, homeWinRate: 0.45 },
};
const DEFAULT_CALIBRATION: LeagueCalibration = { homeAdvantage: 1.12, avgGoalsPerMatch: 2.65, drawRate: 0.24, homeWinRate: 0.45 };

interface MatchProbabilities {
  homeWin: number;
  draw: number;
  awayWin: number;
  over15: number;
  over25: number;
  over35: number;
  under25: number;
  btts: number;
  bttsNo: number;
  homeCleanSheet: number;
  awayCleanSheet: number;
  homeOver05: number;
  awayOver05: number;
  confidence: number;
  confidenceLevel: "high" | "medium" | "low";
  method: string;
}

interface PredictionResult {
  matchId: number;
  fixtureId?: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchDate: Date;
  probabilities: MatchProbabilities;
  recommendations: BetRecommendation[];
  analysis: MatchAnalysis;
  bestBet?: string;
  confidence?: number;
  valueScore?: number;
  reasoning?: string;
}

interface BetRecommendation {
  betType: string;
  prediction: string;
  probability: number;
  impliedOdds: number;
  bookmakerOdds?: number;
  valueRating: number;
  valueTier: "none" | "moderate" | "strong";
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

interface MatchIntelligence {
  homeInjuries?: { player: string; type: string; reason: string }[];
  awayInjuries?: { player: string; type: string; reason: string }[];
  apiPrediction?: { advice?: string; percentHome?: string; percentDraw?: string; percentAway?: string; underOver?: string; goals?: { home?: string; away?: string }; winner?: { name?: string } };
  lineups?: { team: string; formation?: string }[];
  h2h?: { scoreHome: number; scoreAway: number }[];
}

interface MatchAnalysis {
  homeForm: string;
  awayForm: string;
  scoringTrend: string;
  defensiveTrend: string;
  keyFactors: string[];
  riskLevel: "low" | "medium" | "high";
  intelligenceFactors?: string[];
}

interface PredictionCriteria {
  mode?: "safe" | "aggressive";
  betType?: "all" | "1X2" | "over_under" | "btts";
  minConfidence?: number;
  valueOnly?: boolean;
  sortBy?: "confidence" | "value" | "odds";
}

class ProbabilityModelService {
  
  private getLeagueCalibration(league?: string): LeagueCalibration {
    if (!league) return DEFAULT_CALIBRATION;
    return LEAGUE_CALIBRATIONS[league] || DEFAULT_CALIBRATION;
  }

  private formToScore(form: string): number {
    if (!form) return 0.5;
    let score = 0;
    let count = 0;
    const weights = [1.0, 0.95, 0.85, 0.75, 0.65, 0.55, 0.45, 0.38, 0.32, 0.28];
    
    for (let i = 0; i < Math.min(form.length, 10); i++) {
      const char = form[i].toUpperCase();
      const weight = weights[i];
      if (char === 'W' || char === 'V') score += 1.0 * weight;
      else if (char === 'D' || char === 'N') score += 0.35 * weight;
      else if (char === 'L') score += 0.0 * weight;
      count += weight;
    }
    
    return count > 0 ? score / count : 0.5;
  }

  private detectStreak(form: string): { type: 'win' | 'draw' | 'loss' | 'none'; length: number; momentum: number } {
    if (!form || form.length === 0) return { type: 'none', length: 0, momentum: 0 };
    
    const firstChar = form[0].toUpperCase();
    let streakChar = firstChar === 'V' ? 'W' : firstChar;
    let length = 1;
    
    for (let i = 1; i < form.length; i++) {
      const c = form[i].toUpperCase();
      const normalized = c === 'V' ? 'W' : c === 'N' ? 'D' : c;
      if (normalized === streakChar) length++;
      else break;
    }

    const type = streakChar === 'W' ? 'win' : streakChar === 'D' ? 'draw' : streakChar === 'L' ? 'loss' : 'none';
    
    const recentForm = form.substring(0, Math.min(5, form.length));
    let wins = 0, losses = 0;
    for (const c of recentForm) {
      const u = c.toUpperCase();
      if (u === 'W' || u === 'V') wins++;
      if (u === 'L') losses++;
    }
    const momentum = (wins - losses) / Math.max(1, recentForm.length);

    return { type, length, momentum };
  }
  
  private poissonProbability(lambda: number, k: number): number {
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / this.factorial(k);
  }
  
  private factorial(n: number): number {
    if (n <= 1) return 1;
    let result = 1;
    for (let i = 2; i <= n; i++) result *= i;
    return result;
  }
  
  private calculateExpectedGoals(
    attackStrength: number,
    defenseWeakness: number,
    leagueAvgPerSide: number,
    locationFactor: number
  ): number {
    return attackStrength * defenseWeakness * leagueAvgPerSide * locationFactor;
  }
  
  private oddsToImpliedProb(odds: number): number {
    if (!odds || odds <= 1) return 0;
    return 1 / odds;
  }
  
  private normalizeProbabilities(probs: number[]): number[] {
    const sum = probs.reduce((a, b) => a + b, 0);
    if (sum === 0) return probs.map(() => 1 / probs.length);
    return probs.map(p => p / sum);
  }
  
  private calculateValue(probability: number, odds: number): number {
    if (!odds || odds <= 1) return 0;
    const impliedProb = this.oddsToImpliedProb(odds);
    return ((probability - impliedProb) / impliedProb) * 100;
  }

  private calculateDataQuality(homeStats: TeamStats | null, awayStats: TeamStats | null): number {
    let quality = 0;
    if (homeStats) {
      quality += 0.3;
      if (homeStats.homeGoalsForAvg !== undefined) quality += 0.1;
      if (homeStats.form && homeStats.form.length >= 5) quality += 0.05;
      if (homeStats.last10Wins !== undefined) quality += 0.05;
    }
    if (awayStats) {
      quality += 0.3;
      if (awayStats.awayGoalsForAvg !== undefined) quality += 0.1;
      if (awayStats.form && awayStats.form.length >= 5) quality += 0.05;
      if (awayStats.last10Wins !== undefined) quality += 0.05;
    }
    return Math.min(1, quality);
  }
  
  async getTeamStats(teamName: string): Promise<TeamStats | null> {
    const [stats] = await db.select()
      .from(cachedTeamStats)
      .where(eq(cachedTeamStats.teamName, teamName))
      .limit(1);
    
    if (!stats) return null;
    
    return {
      form: stats.formString || "",
      goalsScored: stats.goalsForAvg || 0,
      goalsConceded: stats.goalsAgainstAvg || 0,
      over25Rate: stats.over25Rate || 0.5,
      bttsRate: stats.bttsRate || 0.5,
      cleanSheetRate: stats.cleanSheetRate || 0.3,
      failedToScoreRate: stats.failedToScoreRate || 0.2,
      homeGoalsForAvg: stats.homeGoalsForAvg ?? undefined,
      homeGoalsAgainstAvg: stats.homeGoalsAgainstAvg ?? undefined,
      homeOver25Rate: stats.homeOver25Rate ?? undefined,
      homeBttsRate: stats.homeBttsRate ?? undefined,
      awayGoalsForAvg: stats.awayGoalsForAvg ?? undefined,
      awayGoalsAgainstAvg: stats.awayGoalsAgainstAvg ?? undefined,
      awayOver25Rate: stats.awayOver25Rate ?? undefined,
      awayBttsRate: stats.awayBttsRate ?? undefined,
      last10Wins: stats.last10Wins ?? undefined,
      last10Draws: stats.last10Draws ?? undefined,
      last10Losses: stats.last10Losses ?? undefined,
      league: stats.league,
    };
  }
  
  async calculateMatchProbabilities(
    homeTeam: string,
    awayTeam: string,
    homeOdds?: number,
    drawOdds?: number,
    awayOdds?: number,
    league?: string
  ): Promise<MatchProbabilities> {
    const homeStats = await this.getTeamStats(homeTeam);
    const awayStats = await this.getTeamStats(awayTeam);
    
    const matchLeague = league || homeStats?.league || awayStats?.league;
    const cal = this.getLeagueCalibration(matchLeague);
    const leagueAvgPerSide = cal.avgGoalsPerMatch / 2;
    
    const defaultStats: TeamStats = {
      form: "DWDWD",
      goalsScored: leagueAvgPerSide,
      goalsConceded: leagueAvgPerSide,
      over25Rate: 0.5,
      bttsRate: 0.5,
      cleanSheetRate: 0.3,
      failedToScoreRate: 0.2,
    };
    
    const home = homeStats || defaultStats;
    const away = awayStats || defaultStats;
    
    const homeFormScore = this.formToScore(home.form);
    const awayFormScore = this.formToScore(away.form);
    const homeStreak = this.detectStreak(home.form);
    const awayStreak = this.detectStreak(away.form);
    
    const homeAttackGoals = home.homeGoalsForAvg ?? home.goalsScored;
    const homeDefenseGoals = home.homeGoalsAgainstAvg ?? home.goalsConceded;
    const awayAttackGoals = away.awayGoalsForAvg ?? away.goalsScored;
    const awayDefenseGoals = away.awayGoalsAgainstAvg ?? away.goalsConceded;
    
    const homeAttackStrength = homeAttackGoals / leagueAvgPerSide;
    const homeDefenseWeakness = awayDefenseGoals / leagueAvgPerSide;
    const awayAttackStrength = awayAttackGoals / leagueAvgPerSide;
    const awayDefenseWeakness = homeDefenseGoals / leagueAvgPerSide;
    
    let homeLambda = this.calculateExpectedGoals(
      homeAttackStrength, homeDefenseWeakness, leagueAvgPerSide, cal.homeAdvantage
    );
    let awayLambda = this.calculateExpectedGoals(
      awayAttackStrength, awayDefenseWeakness, leagueAvgPerSide, 1 / cal.homeAdvantage
    );

    if (homeStreak.type === 'win' && homeStreak.length >= 3) {
      homeLambda *= 1 + Math.min(0.08, homeStreak.length * 0.02);
    } else if (homeStreak.type === 'loss' && homeStreak.length >= 3) {
      homeLambda *= 1 - Math.min(0.08, homeStreak.length * 0.02);
    }
    if (awayStreak.type === 'win' && awayStreak.length >= 3) {
      awayLambda *= 1 + Math.min(0.08, awayStreak.length * 0.02);
    } else if (awayStreak.type === 'loss' && awayStreak.length >= 3) {
      awayLambda *= 1 - Math.min(0.08, awayStreak.length * 0.02);
    }

    homeLambda += homeStreak.momentum * 0.06;
    awayLambda += awayStreak.momentum * 0.06;

    homeLambda = Math.max(0.3, Math.min(4.0, homeLambda));
    awayLambda = Math.max(0.2, Math.min(3.5, awayLambda));
    
    let homeWinProb = 0;
    let drawProb = 0;
    let awayWinProb = 0;
    let over15Prob = 0;
    let over25Prob = 0;
    let over35Prob = 0;
    let bttsProb = 0;
    let homeOver05Prob = 0;
    let awayOver05Prob = 0;
    
    for (let hg = 0; hg <= 6; hg++) {
      for (let ag = 0; ag <= 6; ag++) {
        const prob = this.poissonProbability(homeLambda, hg) * 
                     this.poissonProbability(awayLambda, ag);
        
        if (hg > ag) homeWinProb += prob;
        else if (hg === ag) drawProb += prob;
        else awayWinProb += prob;
        
        const total = hg + ag;
        if (total > 1.5) over15Prob += prob;
        if (total > 2.5) over25Prob += prob;
        if (total > 3.5) over35Prob += prob;
        
        if (hg > 0 && ag > 0) bttsProb += prob;
        if (hg > 0) homeOver05Prob += prob;
        if (ag > 0) awayOver05Prob += prob;
      }
    }
    
    let confidence = 0.5;
    let method = "poisson_v2_stats";
    const dataQuality = this.calculateDataQuality(homeStats, awayStats);
    
    if (homeOdds && drawOdds && awayOdds) {
      const impliedHome = this.oddsToImpliedProb(homeOdds);
      const impliedDraw = this.oddsToImpliedProb(drawOdds);
      const impliedAway = this.oddsToImpliedProb(awayOdds);
      const [normHome, normDraw, normAway] = this.normalizeProbabilities([impliedHome, impliedDraw, impliedAway]);
      
      const statsWeight = 0.15 + dataQuality * 0.30;
      const oddsWeight = 1 - statsWeight;
      
      homeWinProb = homeWinProb * statsWeight + normHome * oddsWeight;
      drawProb = drawProb * statsWeight + normDraw * oddsWeight;
      awayWinProb = awayWinProb * statsWeight + normAway * oddsWeight;
      
      const poissonOddsAgreement = 1 - Math.abs(homeWinProb - normHome) - Math.abs(drawProb - normDraw);
      confidence = 0.55 + dataQuality * 0.15 + Math.max(0, poissonOddsAgreement) * 0.1;
      method = dataQuality > 0.5 ? "poisson_v2_blend" : "odds_v2_dominant";
    } else if (!homeStats && !awayStats) {
      confidence = 0.30;
      method = "poisson_v2_no_data";
    } else {
      confidence = 0.45 + dataQuality * 0.2;
    }
    
    const formDelta = homeFormScore - awayFormScore;
    const formAdjustment = formDelta * 0.06;
    const momentumAdjustment = (homeStreak.momentum - awayStreak.momentum) * 0.04;
    homeWinProb += formAdjustment + momentumAdjustment;
    awayWinProb -= formAdjustment + momentumAdjustment;
    
    const [finalHome, finalDraw, finalAway] = this.normalizeProbabilities([
      Math.max(0.03, homeWinProb),
      Math.max(0.05, drawProb),
      Math.max(0.03, awayWinProb)
    ]);
    
    const homeO25 = home.homeOver25Rate ?? home.over25Rate;
    const awayO25 = away.awayOver25Rate ?? away.over25Rate;
    const avgOver25Rate = (homeO25 + awayO25) / 2;
    over25Prob = over25Prob * 0.55 + avgOver25Rate * 0.45;
    
    const homeBtts = home.homeBttsRate ?? home.bttsRate;
    const awayBtts = away.awayBttsRate ?? away.bttsRate;
    const avgBttsRate = (homeBtts + awayBtts) / 2;
    bttsProb = bttsProb * 0.55 + avgBttsRate * 0.45;
    
    confidence += dataQuality * 0.05;
    const finalConfidence = Math.min(0.92, confidence);
    const confidenceLevel: "high" | "medium" | "low" = 
      finalConfidence >= 0.75 ? "high" : finalConfidence >= 0.60 ? "medium" : "low";
    
    return {
      homeWin: Math.round(finalHome * 1000) / 10,
      draw: Math.round(finalDraw * 1000) / 10,
      awayWin: Math.round(finalAway * 1000) / 10,
      over15: Math.round(over15Prob * 1000) / 10,
      over25: Math.round(over25Prob * 1000) / 10,
      over35: Math.round(over35Prob * 1000) / 10,
      under25: Math.round((1 - over25Prob) * 1000) / 10,
      btts: Math.round(bttsProb * 1000) / 10,
      bttsNo: Math.round((1 - bttsProb) * 1000) / 10,
      homeCleanSheet: Math.round((1 - awayOver05Prob) * home.cleanSheetRate * 1000) / 10,
      awayCleanSheet: Math.round((1 - homeOver05Prob) * away.cleanSheetRate * 1000) / 10,
      homeOver05: Math.round(homeOver05Prob * 1000) / 10,
      awayOver05: Math.round(awayOver05Prob * 1000) / 10,
      confidence: finalConfidence,
      confidenceLevel,
      method
    };
  }
  
  // Génération de recommandations de paris
  // mode: "safe" = filtrage strict (prob > 55%, value > 5, confiance >= 0.7)
  // mode: "aggressive" = inclut plus de bets avec value potentielle
  generateRecommendations(
    probs: MatchProbabilities,
    homeOdds?: number,
    drawOdds?: number,
    awayOdds?: number,
    over25Odds?: number,
    under25Odds?: number,
    bttsYesOdds?: number,
    bttsNoOdds?: number,
    mode: "safe" | "aggressive" = "safe",
    criteria?: PredictionCriteria
  ): BetRecommendation[] {
    const recommendations: BetRecommendation[] = [];
    
    const allBetTypes = [
      { type: "1X2", prediction: "1", prob: probs.homeWin / 100, odds: homeOdds, name: "Victoire domicile" },
      { type: "1X2", prediction: "X", prob: probs.draw / 100, odds: drawOdds, name: "Match nul" },
      { type: "1X2", prediction: "2", prob: probs.awayWin / 100, odds: awayOdds, name: "Victoire exterieur" },
      { type: "over_under", prediction: "+2.5", prob: probs.over25 / 100, odds: over25Odds, name: "Plus de 2.5 buts" },
      { type: "over_under", prediction: "-2.5", prob: probs.under25 / 100, odds: under25Odds, name: "Moins de 2.5 buts" },
      { type: "btts", prediction: "Oui", prob: probs.btts / 100, odds: bttsYesOdds, name: "Les deux equipes marquent" },
      { type: "btts", prediction: "Non", prob: probs.bttsNo / 100, odds: bttsNoOdds, name: "Les deux ne marquent pas" },
    ];

    const betTypeFilter = criteria?.betType || "all";
    const betTypes = betTypeFilter === "all" ? allBetTypes : allBetTypes.filter(b => {
      if (betTypeFilter === "1X2") return b.type === "1X2";
      if (betTypeFilter === "over_under") return b.type === "over_under";
      if (betTypeFilter === "btts") return b.type === "btts";
      return true;
    });
    
    for (const bet of betTypes) {
      const impliedOdds = bet.prob > 0 ? 1 / bet.prob : 99;
      const valueRating = bet.odds ? this.calculateValue(bet.prob, bet.odds) : 0;
      
      let valueTier: "none" | "moderate" | "strong" = "none";
      if (valueRating >= 10) valueTier = "strong";
      else if (valueRating >= 5) valueTier = "moderate";
      
      let confidence: "high" | "medium" | "low" = "low";
      if (bet.prob >= 0.55) confidence = "high";
      else if (bet.prob >= 0.40) confidence = "medium";
      
      let reasoning = `Probabilite calculee: ${(bet.prob * 100).toFixed(1)}%`;
      if (bet.odds) {
        reasoning += `. Cote bookmaker: ${bet.odds.toFixed(2)}`;
        if (valueTier !== "none") {
          reasoning += `. VALUE ${valueTier.toUpperCase()}: +${valueRating.toFixed(1)}%`;
        }
      }
      
      recommendations.push({
        betType: bet.type,
        prediction: bet.prediction,
        probability: bet.prob * 100,
        impliedOdds: Math.round(impliedOdds * 100) / 100,
        bookmakerOdds: bet.odds,
        valueRating: Math.round(valueRating * 10) / 10,
        valueTier,
        confidence,
        reasoning
      });
    }
    
    let sorted = [...recommendations];

    const effectiveMode = criteria?.mode || mode;
    const minConf = criteria?.minConfidence || 0;

    if (effectiveMode === "safe") {
      sorted = sorted.filter(r => {
        if (r.betType === "1X2" && r.prediction === "X") return false;
        if (probs.method === "poisson_no_data") return false;
        return r.probability >= Math.max(60, minConf) && 
          r.valueTier !== "none" &&
          r.valueRating >= 8 &&
          probs.confidence >= 0.65;
      });
    } else {
      sorted = sorted.filter(r => {
        if (probs.method === "poisson_no_data" && r.probability < 65) return false;
        return r.probability >= Math.max(45, minConf);
      });
    }

    if (criteria?.valueOnly) {
      sorted = sorted.filter(r => r.valueTier !== "none");
    }

    const sortBy = criteria?.sortBy || "confidence";
    if (sortBy === "value") {
      sorted.sort((a, b) => b.valueRating - a.valueRating);
    } else if (sortBy === "odds") {
      sorted.sort((a, b) => (b.bookmakerOdds || 0) - (a.bookmakerOdds || 0));
    } else {
      sorted.sort((a, b) => b.probability - a.probability);
    }
    
    return sorted;
  }
  
  private applyIntelligenceAdjustments(probs: MatchProbabilities, intel: MatchIntelligence): { adjustedProbs: MatchProbabilities; factors: string[] } {
    const factors: string[] = [];
    let confidenceBoost = 0;

    let h = probs.homeWin;
    let d = probs.draw;
    let a = probs.awayWin;

    if (intel.apiPrediction?.percentHome && intel.apiPrediction?.percentAway) {
      const apiH = parseFloat(intel.apiPrediction.percentHome.replace('%', ''));
      const apiD = parseFloat(intel.apiPrediction.percentDraw?.replace('%', '') || '0');
      const apiA = parseFloat(intel.apiPrediction.percentAway.replace('%', ''));
      const apiTotal = apiH + apiD + apiA;
      if (apiTotal > 0) {
        const normH = (apiH / apiTotal) * 100;
        const normD = (apiD / apiTotal) * 100;
        const normA = (apiA / apiTotal) * 100;
        const w = 0.15;
        h = h * (1 - w) + normH * w;
        d = d * (1 - w) + normD * w;
        a = a * (1 - w) + normA * w;
        confidenceBoost += 0.05;
        factors.push(`API Football prediction: ${intel.apiPrediction.advice || 'N/A'}`);
      }
    }

    const homeInj = intel.homeInjuries || [];
    const awayInj = intel.awayInjuries || [];
    if (homeInj.length > 0) {
      const sev = homeInj.length >= 3 ? 6 : 3;
      h -= sev;
      a += sev * 0.4;
      d += sev * 0.1;
      factors.push(`DOM: ${homeInj.length} absent(s) (${homeInj.map(i => i.player).join(', ')})`);
    }
    if (awayInj.length > 0) {
      const sev = awayInj.length >= 3 ? 6 : 3;
      a -= sev;
      h += sev * 0.4;
      d += sev * 0.1;
      factors.push(`EXT: ${awayInj.length} absent(s) (${awayInj.map(i => i.player).join(', ')})`);
    }

    if (intel.h2h && intel.h2h.length >= 3) {
      const homeH2HWins = intel.h2h.filter(m => m.scoreHome > m.scoreAway).length;
      const awayH2HWins = intel.h2h.filter(m => m.scoreAway > m.scoreHome).length;
      const dominance = (homeH2HWins - awayH2HWins) / intel.h2h.length;
      h += dominance * 3;
      a -= dominance * 3;
      confidenceBoost += 0.03;
      factors.push(`H2H: DOM ${homeH2HWins}V - EXT ${awayH2HWins}V sur ${intel.h2h.length} matchs`);
    }

    if (intel.apiPrediction?.underOver) {
      const uo = intel.apiPrediction.underOver;
      if (uo.includes('+') || uo.includes('Over')) {
        probs.over25 = Math.min(95, probs.over25 + 3);
        factors.push(`API: Over attendu (${uo})`);
      } else if (uo.includes('-') || uo.includes('Under')) {
        probs.under25 = Math.min(95, probs.under25 + 3);
        factors.push(`API: Under attendu (${uo})`);
      }
    }

    h = Math.max(2, h);
    d = Math.max(2, d);
    a = Math.max(2, a);
    const total = h + d + a;
    probs.homeWin = Math.round(h / total * 1000) / 10;
    probs.draw = Math.round(d / total * 1000) / 10;
    probs.awayWin = Math.round(a / total * 1000) / 10;

    probs.confidence = Math.min(0.95, probs.confidence + confidenceBoost);
    probs.confidenceLevel = probs.confidence >= 0.8 ? "high" : probs.confidence >= 0.65 ? "medium" : "low";
    if (factors.length > 0) probs.method += "_intel";

    return { adjustedProbs: probs, factors };
  }

  async analyzeMatch(
    homeTeam: string,
    awayTeam: string,
    league: string,
    matchDate: Date,
    odds?: { home?: number; draw?: number; away?: number; over25?: number; under25?: number; bttsYes?: number; bttsNo?: number },
    mode: "safe" | "aggressive" = "aggressive",
    intelligence?: MatchIntelligence,
    criteria?: PredictionCriteria
  ): Promise<PredictionResult> {
    const effectiveMode = criteria?.mode || mode;
    const probs = await this.calculateMatchProbabilities(
      homeTeam,
      awayTeam,
      odds?.home,
      odds?.draw,
      odds?.away,
      league
    );
    
    let intelligenceFactors: string[] = [];
    if (intelligence) {
      const { adjustedProbs, factors } = this.applyIntelligenceAdjustments(probs, intelligence);
      Object.assign(probs, adjustedProbs);
      intelligenceFactors = factors;
    }

    if (effectiveMode === "safe") {
      const confBoost = 0.05;
      probs.confidence = Math.min(0.95, probs.confidence + confBoost);
      probs.confidenceLevel = probs.confidence >= 0.8 ? "high" : probs.confidence >= 0.65 ? "medium" : "low";
    }
    
    const recommendations = this.generateRecommendations(
      probs,
      odds?.home,
      odds?.draw,
      odds?.away,
      odds?.over25,
      odds?.under25,
      odds?.bttsYes,
      odds?.bttsNo,
      effectiveMode,
      criteria
    );
    
    const homeStats = await this.getTeamStats(homeTeam);
    const awayStats = await this.getTeamStats(awayTeam);
    
    const analysis = this.generateAnalysis(homeStats, awayStats, probs);
    analysis.intelligenceFactors = intelligenceFactors;
    
    const topRec = recommendations[0];
    const bestBetText = topRec ? `${topRec.betType}: ${topRec.prediction}` : undefined;
    const bestValue = topRec?.valueRating || 0;

    let aiReasoning: string | undefined;
    let aiConfidence: number | undefined;
    try {
      const aiResults = await this.generateAIBatchAnalysis([{
        homeTeam, awayTeam, league, probs,
        odds: odds ? { home: odds.home, draw: odds.draw, away: odds.away, over25: odds.over25, bttsYes: odds.bttsYes } : undefined,
        intelligence, homeStats, awayStats,
      }]);
      const key = `${homeTeam} vs ${awayTeam}`;
      const ai = aiResults.get(key);
      if (ai) {
        aiReasoning = ai.reasoning;
        aiConfidence = ai.confidence;
        if (ai.keyFactors.length > 0) analysis.keyFactors = ai.keyFactors;
      }
    } catch (e) {}

    return {
      matchId: 0,
      homeTeam,
      awayTeam,
      league,
      matchDate,
      probabilities: probs,
      recommendations,
      analysis,
      bestBet: bestBetText,
      confidence: aiConfidence ?? Math.round(probs.confidence * 100),
      valueScore: bestValue,
      reasoning: aiReasoning,
    };
  }
  
  private getGeminiClient(): GoogleGenAI | null {
    const apiKey = process.env.GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
    if (!apiKey) return null;
    const opts: any = { apiKey };
    if (process.env.AI_INTEGRATIONS_GEMINI_BASE_URL) {
      opts.httpOptions = { apiVersion: "", baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL };
    }
    return new GoogleGenAI(opts);
  }

  async generateAIBatchAnalysis(
    matches: {
      homeTeam: string;
      awayTeam: string;
      league: string;
      probs: MatchProbabilities;
      odds?: { home?: number; draw?: number; away?: number; over25?: number; bttsYes?: number };
      intelligence?: MatchIntelligence;
      homeStats: TeamStats | null;
      awayStats: TeamStats | null;
    }[]
  ): Promise<Map<string, { reasoning: string; confidence: number; keyFactors: string[] }>> {
    const results = new Map<string, { reasoning: string; confidence: number; keyFactors: string[] }>();
    const gemini = this.getGeminiClient();
    if (!gemini || matches.length === 0) return results;

    const matchDescriptions = matches.map((m, i) => {
      const key = `${m.homeTeam} vs ${m.awayTeam}`;
      let desc = `MATCH ${i + 1}: ${key} (${m.league})\n`;
      desc += `  Probas Poisson: Dom=${m.probs.homeWin}% Nul=${m.probs.draw}% Ext=${m.probs.awayWin}% | O2.5=${m.probs.over25}% BTTS=${m.probs.btts}%\n`;
      if (m.odds?.home) desc += `  Cotes: 1@${m.odds.home} X@${m.odds.draw} 2@${m.odds.away} O2.5@${m.odds.over25 || '?'} BTTS@${m.odds.bttsYes || '?'}\n`;
      if (m.homeStats) desc += `  Stats DOM: forme=${m.homeStats.form || '?'} buts/m=${m.homeStats.goalsScored?.toFixed(1)} enc/m=${m.homeStats.goalsConceded?.toFixed(1)} O2.5=${(m.homeStats.over25Rate * 100).toFixed(0)}% BTTS=${(m.homeStats.bttsRate * 100).toFixed(0)}%\n`;
      if (m.awayStats) desc += `  Stats EXT: forme=${m.awayStats.form || '?'} buts/m=${m.awayStats.goalsScored?.toFixed(1)} enc/m=${m.awayStats.goalsConceded?.toFixed(1)} O2.5=${(m.awayStats.over25Rate * 100).toFixed(0)}% BTTS=${(m.awayStats.bttsRate * 100).toFixed(0)}%\n`;
      if (m.intelligence?.apiPrediction) {
        const ap = m.intelligence.apiPrediction;
        desc += `  API-Football: ${ap.advice || ''} | Dom=${ap.percentHome} Nul=${ap.percentDraw} Ext=${ap.percentAway} | Winner=${ap.winner?.name || '?'}\n`;
      }
      if (m.intelligence?.h2h?.length) {
        const h2h = m.intelligence.h2h;
        const domW = h2h.filter(x => x.scoreHome > x.scoreAway).length;
        const extW = h2h.filter(x => x.scoreAway > x.scoreHome).length;
        const draws = h2h.length - domW - extW;
        desc += `  H2H (${h2h.length} matchs): Dom ${domW}V ${draws}N ${extW}D\n`;
      }
      if (m.intelligence?.homeInjuries?.length) {
        desc += `  Absents DOM: ${m.intelligence.homeInjuries.map(i => `${i.player} (${i.reason})`).join(', ')}\n`;
      }
      if (m.intelligence?.awayInjuries?.length) {
        desc += `  Absents EXT: ${m.intelligence.awayInjuries.map(i => `${i.player} (${i.reason})`).join(', ')}\n`;
      }
      return { key, desc };
    });

    const prompt = `Expert pronostics football. Analyse chaque match avec les données fournies.

Pour chaque match: analyse (2 phrases FR), confiance (45-92, VARIEE), 2 facteurs clés (max 6 mots).

${matchDescriptions.map(m => m.desc).join('\n')}

Réponds UNIQUEMENT en JSON array, sans markdown:
[{"match":"Equipe1 vs Equipe2","reasoning":"...","confidence":72,"keyFactors":["..",".."]},...]`;

    try {
      const response = await gemini.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          temperature: 0.6,
          maxOutputTokens: 16384,
          thinkingConfig: { thinkingBudget: 0 },
        },
      });

      const text = response.text || '';
      console.log(`[ProbabilityModel] Gemini response length: ${text.length}, first 200: ${text.substring(0, 200)}`);
      let jsonStr = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        let rawJson = jsonMatch[0];
        rawJson = rawJson.replace(/,\s*\]/g, ']').replace(/,\s*\}/g, '}');
        rawJson = rawJson.replace(/[\x00-\x1F\x7F]/g, (c) => c === '\n' || c === '\t' ? c : ' ');
        let parsed: any[];
        try {
          parsed = JSON.parse(rawJson);
        } catch {
          const objects: any[] = [];
          const objRegex = /\{[^{}]*"match"\s*:\s*"[^"]*"[^{}]*\}/g;
          let m;
          while ((m = objRegex.exec(rawJson)) !== null) {
            try { objects.push(JSON.parse(m[0])); } catch {}
          }
          parsed = objects;
          console.log(`[ProbabilityModel] JSON repair: extracted ${objects.length} objects from malformed response`);
        }
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const matchKey = item.match || '';
            const closest = matchDescriptions.find(m =>
              m.key.toLowerCase() === matchKey.toLowerCase() ||
              matchKey.toLowerCase().includes(m.key.split(' vs ')[0].toLowerCase().slice(0, 8))
            );
            if (closest) {
              results.set(closest.key, {
                reasoning: item.reasoning || '',
                confidence: Math.max(45, Math.min(92, item.confidence || 65)),
                keyFactors: Array.isArray(item.keyFactors) ? item.keyFactors : [],
              });
            }
          }
        }
      }
    } catch (e: any) {
      console.error('[ProbabilityModel] AI analysis error:', e.message, e.stack?.split('\n').slice(0, 3).join('\n'));
    }

    return results;
  }

  // Génération de l'analyse textuelle
  private generateAnalysis(
    homeStats: TeamStats | null,
    awayStats: TeamStats | null,
    probs: MatchProbabilities
  ): MatchAnalysis {
    const keyFactors: string[] = [];
    
    // Analyse forme
    let homeForm = "Forme inconnue";
    let awayForm = "Forme inconnue";
    
    if (homeStats?.form) {
      const homeFormScore = this.formToScore(homeStats.form);
      homeForm = homeFormScore >= 0.7 ? "Excellente forme" : 
                 homeFormScore >= 0.5 ? "Forme correcte" : "Forme preoccupante";
      if (homeFormScore >= 0.7) keyFactors.push("Domicile en grande forme");
    }
    
    if (awayStats?.form) {
      const awayFormScore = this.formToScore(awayStats.form);
      awayForm = awayFormScore >= 0.7 ? "Excellente forme" : 
                 awayFormScore >= 0.5 ? "Forme correcte" : "Forme preoccupante";
      if (awayFormScore >= 0.7) keyFactors.push("Exterieur en grande forme");
    }
    
    // Tendance buts
    let scoringTrend = "Tendance neutre";
    if (probs.over25 >= 60) {
      scoringTrend = "Match a buts attendu";
      keyFactors.push("Fort potentiel offensif");
    } else if (probs.under25 >= 60) {
      scoringTrend = "Match ferme attendu";
      keyFactors.push("Defenses solides");
    }
    
    // Tendance défensive
    let defensiveTrend = "Equilibre defensif";
    if (probs.btts >= 65) {
      defensiveTrend = "Defenses permeables";
      keyFactors.push("BTTS probable");
    } else if (probs.bttsNo >= 65) {
      defensiveTrend = "Au moins une clean sheet probable";
    }
    
    // Niveau de risque
    let riskLevel: "low" | "medium" | "high" = "medium";
    const maxProb = Math.max(probs.homeWin, probs.draw, probs.awayWin);
    if (maxProb >= 60 && probs.confidence >= 0.7) riskLevel = "low";
    else if (maxProb <= 40 || probs.confidence < 0.5) riskLevel = "high";
    
    if (!homeStats || !awayStats) {
      keyFactors.push("ATTENTION: Stats incompletes - prediction moins fiable");
      riskLevel = "high";
    }
    
    if (probs.method === "poisson_no_data") {
      keyFactors.push("DONNEES INSUFFISANTES - ne pas parier");
      riskLevel = "high";
    }
    
    if (keyFactors.length === 0) {
      keyFactors.push("Match equilibre sans tendance claire");
    }
    
    return {
      homeForm,
      awayForm,
      scoringTrend,
      defensiveTrend,
      keyFactors,
      riskLevel
    };
  }
  
  async analyzeTodayMatches(criteria?: PredictionCriteria): Promise<PredictionResult[]> {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setHours(23, 59, 59, 999);
    
    const finishedStatuses = ["finished", "FT", "AET", "PEN", "PST", "CANC", "ABD", "AWD", "WO", "postponed", "cancelled"];
    
    const matches = await db.select()
      .from(cachedMatches)
      .where(and(
        gte(cachedMatches.matchDate, now),
        lte(cachedMatches.matchDate, tomorrow),
        notInArray(cachedMatches.status, finishedStatuses)
      ))
      .orderBy(cachedMatches.matchDate);
    
    const matchDataList: {
      match: typeof matches[0];
      oddsData?: any;
      intel?: MatchIntelligence;
      homeStats: TeamStats | null;
      awayStats: TeamStats | null;
      probs: MatchProbabilities;
    }[] = [];

    for (const match of matches) {
      const [odds] = await db.select()
        .from(cachedOdds)
        .where(eq(cachedOdds.matchId, match.id))
        .limit(1);
      
      const oddsData = odds ? {
        home: odds.homeOdds || undefined,
        draw: odds.drawOdds || undefined,
        away: odds.awayOdds || undefined,
        over25: odds.overOdds || undefined,
        under25: odds.underOdds || undefined,
        bttsYes: odds.bttsYes || undefined,
        bttsNo: odds.bttsNo || undefined
      } : undefined;
      
      let intel: MatchIntelligence | undefined;
      try {
        const { apiFootballService } = await import("./apiFootballService");
        if (apiFootballService.isConfigured() && match.externalId) {
          const fixtureId = parseInt(match.externalId);
          if (!isNaN(fixtureId)) {
            const [injuries, prediction] = await Promise.allSettled([
              apiFootballService.getInjuries(undefined, undefined, fixtureId),
              apiFootballService.getFixturePrediction(fixtureId)
            ]);

            intel = {};
            if (injuries.status === 'fulfilled' && injuries.value.length > 0) {
              const homeId = match.homeTeamId;
              const awayId = match.awayTeamId;
              intel.homeInjuries = injuries.value
                .filter(i => homeId ? i.team.id === homeId : i.team.name?.toLowerCase().includes(match.homeTeam.split(' ')[0].toLowerCase()))
                .map(i => ({ player: i.player.name, type: i.player.type, reason: i.player.reason }));
              intel.awayInjuries = injuries.value
                .filter(i => awayId ? i.team.id === awayId : i.team.name?.toLowerCase().includes(match.awayTeam.split(' ')[0].toLowerCase()))
                .map(i => ({ player: i.player.name, type: i.player.type, reason: i.player.reason }));
            }
            if (prediction.status === 'fulfilled' && prediction.value) {
              const p = prediction.value;
              intel.apiPrediction = {
                advice: p.predictions?.advice ?? undefined,
                percentHome: p.predictions?.percent?.home ?? undefined,
                percentDraw: p.predictions?.percent?.draw ?? undefined,
                percentAway: p.predictions?.percent?.away ?? undefined,
                underOver: p.predictions?.under_over ?? undefined,
                goals: p.predictions?.goals ?? undefined,
                winner: p.predictions?.winner ? { name: p.predictions.winner.name ?? undefined } : undefined
              };
              if (p.h2h?.length) {
                intel.h2h = p.h2h.slice(0, 5).map((h: any) => ({
                  scoreHome: h.goals?.home || 0,
                  scoreAway: h.goals?.away || 0
                }));
              }
            }
          }
        }
      } catch (e) {
        // intelligence data is optional
      }

      const probs = await this.calculateMatchProbabilities(
        match.homeTeam, match.awayTeam,
        oddsData?.home, oddsData?.draw, oddsData?.away
      );

      if (intel) {
        const { adjustedProbs } = this.applyIntelligenceAdjustments(probs, intel);
        Object.assign(probs, adjustedProbs);
      }

      const homeStats = await this.getTeamStats(match.homeTeam);
      const awayStats = await this.getTeamStats(match.awayTeam);

      matchDataList.push({ match, oddsData, intel, homeStats, awayStats, probs });
    }

    let aiAnalysis = new Map<string, { reasoning: string; confidence: number; keyFactors: string[] }>();
    try {
      aiAnalysis = await this.generateAIBatchAnalysis(
        matchDataList.map(md => ({
          homeTeam: md.match.homeTeam,
          awayTeam: md.match.awayTeam,
          league: md.match.league,
          probs: md.probs,
          odds: md.oddsData,
          intelligence: md.intel,
          homeStats: md.homeStats,
          awayStats: md.awayStats,
        }))
      );
      console.log(`[ProbabilityModel] AI analysis completed for ${aiAnalysis.size}/${matchDataList.length} matches`);
    } catch (e: any) {
      console.error('[ProbabilityModel] AI batch analysis failed, using fallback:', e.message);
    }

    const results: PredictionResult[] = [];
    const effectiveMode = criteria?.mode || "aggressive";

    for (const md of matchDataList) {
      const { match, oddsData, intel, homeStats, awayStats, probs } = md;
      const matchKey = `${match.homeTeam} vs ${match.awayTeam}`;
      const aiResult = aiAnalysis.get(matchKey);

      if (effectiveMode === "safe") {
        probs.confidence = Math.min(0.95, probs.confidence + 0.05);
        probs.confidenceLevel = probs.confidence >= 0.8 ? "high" : probs.confidence >= 0.65 ? "medium" : "low";
      }

      const recommendations = this.generateRecommendations(
        probs, oddsData?.home, oddsData?.draw, oddsData?.away,
        oddsData?.over25, oddsData?.under25, oddsData?.bttsYes, oddsData?.bttsNo,
        effectiveMode, criteria
      );

      const analysis = this.generateAnalysis(homeStats, awayStats, probs);
      if (intel) {
        const factors: string[] = [];
        if (intel.apiPrediction?.advice) factors.push(`API Football: ${intel.apiPrediction.advice}`);
        if (intel.homeInjuries?.length) factors.push(`DOM: ${intel.homeInjuries.length} absent(s) (${intel.homeInjuries.map(i => i.player).join(', ')})`);
        if (intel.awayInjuries?.length) factors.push(`EXT: ${intel.awayInjuries.length} absent(s) (${intel.awayInjuries.map(i => i.player).join(', ')})`);
        if (intel.h2h?.length) {
          const domW = intel.h2h.filter(m => m.scoreHome > m.scoreAway).length;
          const extW = intel.h2h.filter(m => m.scoreAway > m.scoreHome).length;
          factors.push(`H2H: DOM ${domW}V - EXT ${extW}V sur ${intel.h2h.length} matchs`);
        }
        analysis.intelligenceFactors = factors;
      }

      if (aiResult) {
        analysis.keyFactors = aiResult.keyFactors.length > 0 ? aiResult.keyFactors : analysis.keyFactors;
      }

      const topRec = recommendations[0];
      const bestBetText = topRec ? `${topRec.betType}: ${topRec.prediction}` : undefined;

      const finalConfidence = aiResult
        ? aiResult.confidence
        : Math.round(probs.confidence * 100);

      const reasoning = aiResult?.reasoning || [analysis.homeForm, analysis.awayForm, analysis.scoringTrend, ...analysis.keyFactors].filter(Boolean).join('. ');

      results.push({
        matchId: match.id,
        fixtureId: match.externalId ? parseInt(match.externalId) || undefined : undefined,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        league: match.league,
        matchDate: match.matchDate,
        probabilities: probs,
        recommendations,
        analysis,
        bestBet: bestBetText,
        confidence: finalConfidence,
        valueScore: topRec?.valueRating || 0,
        reasoning,
      });
    }
    
    return results;
  }
  
  // Format pour l'IA assistant
  formatPredictionsForAI(predictions: PredictionResult[]): string {
    if (predictions.length === 0) {
      return "Aucune prediction disponible pour aujourd'hui.";
    }
    
    const hasIntel = predictions.some(p => p.analysis.intelligenceFactors?.length);
    const lines: string[] = [
      "=== PREDICTIONS DJEDOU PRONOS ===",
      `Analyse du ${new Date().toLocaleDateString('fr-FR')}`,
      `Methode: Poisson + Stats + Cotes${hasIntel ? ' + Intelligence (Blessures/H2H/API Prediction)' : ''}`,
      ""
    ];
    
    // Tri par confiance du modèle
    const sorted = [...predictions].sort((a, b) => 
      b.probabilities.confidence - a.probabilities.confidence
    );
    
    // VALUE SPOTS (paris avec value strong)
    const valueSpots = sorted.filter(p => 
      p.recommendations.some(r => r.valueTier === "strong")
    );
    if (valueSpots.length > 0) {
      lines.push("--- VALUE SPOTS (value forte detectee) ---");
      for (const spot of valueSpots.slice(0, 5)) {
        lines.push(this.formatSinglePrediction(spot, true));
      }
      lines.push("");
    }
    
    // Top picks (confiance >= 0.7)
    const topPicks = sorted.filter(p => 
      p.probabilities.confidence >= 0.7 && 
      !valueSpots.includes(p)
    );
    if (topPicks.length > 0) {
      lines.push("--- TOP PICKS (haute confiance) ---");
      for (const pick of topPicks.slice(0, 5)) {
        lines.push(this.formatSinglePrediction(pick));
      }
      lines.push("");
    }
    
    // Autres matchs
    const others = sorted.filter(p => 
      p.probabilities.confidence < 0.7 && 
      !valueSpots.includes(p)
    );
    if (others.length > 0) {
      lines.push("--- AUTRES MATCHS ---");
      for (const match of others.slice(0, 10)) {
        lines.push(this.formatSinglePrediction(match));
      }
    }
    
    lines.push("");
    lines.push("Note: Probabilites calculees sur base statistique, pas de garantie.");
    
    return lines.join("\n");
  }
  
  private formatSinglePrediction(pred: PredictionResult, highlightValue: boolean = false): string {
    const probs = pred.probabilities;
    const topRec = pred.recommendations[0];
    const time = pred.matchDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    
    let line = `[${time}] ${pred.homeTeam} vs ${pred.awayTeam} (${pred.league})`;
    line += `\n  Probas: 1=${probs.homeWin}% X=${probs.draw}% 2=${probs.awayWin}%`;
    line += `\n  O2.5=${probs.over25}% BTTS=${probs.btts}%`;
    
    // Afficher les cotes bookmaker si disponibles
    const homeRec = pred.recommendations.find(r => r.betType === "1X2" && r.prediction === "1");
    const drawRec = pred.recommendations.find(r => r.betType === "1X2" && r.prediction === "X");
    const awayRec = pred.recommendations.find(r => r.betType === "1X2" && r.prediction === "2");
    const over25Rec = pred.recommendations.find(r => r.prediction === "+2.5");
    const bttsRec = pred.recommendations.find(r => r.prediction === "Oui");
    
    if (homeRec?.bookmakerOdds || drawRec?.bookmakerOdds || awayRec?.bookmakerOdds) {
      line += `\n  Cotes: 1@${homeRec?.bookmakerOdds?.toFixed(2) || "?"} X@${drawRec?.bookmakerOdds?.toFixed(2) || "?"} 2@${awayRec?.bookmakerOdds?.toFixed(2) || "?"}`;
    }
    if (over25Rec?.bookmakerOdds) {
      line += ` O2.5@${over25Rec.bookmakerOdds.toFixed(2)}`;
    }
    if (bttsRec?.bookmakerOdds) {
      line += ` BTTS@${bttsRec.bookmakerOdds.toFixed(2)}`;
    }
    
    // Highlight value bets if requested
    if (highlightValue) {
      const valueBets = pred.recommendations.filter(r => r.valueTier !== "none");
      if (valueBets.length > 0) {
        line += `\n  >>> VALUE BETS:`;
        for (const vb of valueBets) {
          line += ` ${vb.prediction}@${vb.bookmakerOdds?.toFixed(2) || "?"} [${vb.valueTier.toUpperCase()} +${vb.valueRating}%]`;
        }
      }
    }
    
    if (topRec) {
      line += `\n  Recommandation: ${topRec.prediction} (${topRec.probability.toFixed(1)}%)`;
      if (topRec.valueTier !== "none") {
        line += ` [VALUE ${topRec.valueTier.toUpperCase()} +${topRec.valueRating.toFixed(1)}%]`;
      }
    }
    
    line += `\n  Analyse: ${pred.analysis.keyFactors.join(", ")}`;
    if (pred.analysis.intelligenceFactors?.length) {
      line += `\n  Intel: ${pred.analysis.intelligenceFactors.join(" | ")}`;
    }
    line += `\n  Risque: ${pred.analysis.riskLevel} | Confiance: ${probs.confidenceLevel.toUpperCase()} (${(probs.confidence * 100).toFixed(0)}%)`;
    
    return line;
  }
}

export const probabilityModelService = new ProbabilityModelService();

export const probabilityUtils = {
  poissonProbability(lambda: number, k: number): number {
    const factorial = (n: number): number => {
      if (n <= 1) return 1;
      let result = 1;
      for (let i = 2; i <= n; i++) result *= i;
      return result;
    };
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
  },

  formToScore(form: string): number {
    if (!form) return 0.5;
    let score = 0;
    let count = 0;
    const weights = [1.0, 0.9, 0.8, 0.7, 0.6];
    
    for (let i = 0; i < Math.min(form.length, 5); i++) {
      const char = form[i].toUpperCase();
      const weight = weights[i];
      if (char === 'W') score += 1.0 * weight;
      else if (char === 'D') score += 0.4 * weight;
      else if (char === 'L') score += 0.0 * weight;
      count += weight;
    }
    
    return count > 0 ? score / count : 0.5;
  },

  oddsToImpliedProb(odds: number): number {
    if (!odds || odds <= 1) return 0;
    return 1 / odds;
  },

  calculateValue(probability: number, odds: number): number {
    if (!odds || odds <= 1) return 0;
    const impliedProb = 1 / odds;
    return ((probability - impliedProb) / impliedProb) * 100;
  },

  normalizeProbabilities(probs: number[]): number[] {
    const sum = probs.reduce((a, b) => a + b, 0);
    if (sum === 0) return probs.map(() => 1 / probs.length);
    return probs.map(p => p / sum);
  },

  calculateExpectedGoals(
    attackStrength: number,
    defenseWeakness: number,
    leagueAvg: number = 1.35,
    homeAdvantage: number = 1.15
  ): number {
    return attackStrength * defenseWeakness * leagueAvg * homeAdvantage;
  }
};
