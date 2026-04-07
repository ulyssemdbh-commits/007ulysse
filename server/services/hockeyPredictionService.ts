import { db } from "../db";
import { cachedMatches, cachedTeamStats, cachedOdds } from "@shared/schema";
import { eq, and, gte, lte, like, or, notInArray } from "drizzle-orm";

interface HockeyTeamStats {
  form: string;
  goalsPerGame: number;
  goalsAllowedPerGame: number;
  powerPlayPct: number;
  penaltyKillPct: number;
  shotsPerGame: number;
  savePct: number;
}

interface HockeyProbabilities {
  homeWin: number;
  draw: number;
  awayWin: number;
  homeWinRegulation: number;
  awayWinRegulation: number;
  over55: number;
  under55: number;
  over65: number;
  under65: number;
  btts: number;
  predictedHomeGoals: number;
  predictedAwayGoals: number;
  predictedTotal: number;
  confidence: number;
  method: string;
}

interface HockeyPrediction {
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchDate: Date;
  probabilities: HockeyProbabilities;
  recommendations: HockeyRecommendation[];
  analysis: HockeyAnalysis;
}

interface HockeyRecommendation {
  betType: string;
  prediction: string;
  probability: number;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

interface HockeyAnalysis {
  homeForm: string;
  awayForm: string;
  scoringTrend: string;
  specialTeamsTrend: string;
  keyFactors: string[];
  riskLevel: "low" | "medium" | "high";
}

class HockeyPredictionService {
  
  private formToScore(form: string): number {
    if (!form) return 0.5;
    let score = 0;
    let count = 0;
    const weights = [1.0, 0.9, 0.8, 0.7, 0.6];
    
    for (let i = 0; i < Math.min(form.length, 5); i++) {
      const char = form[i].toUpperCase();
      const weight = weights[i];
      if (char === 'W') score += 1.0 * weight;
      else if (char === 'O') score += 0.5 * weight;
      else if (char === 'L') score += 0.0 * weight;
      count += weight;
    }
    
    return count > 0 ? score / count : 0.5;
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
  
  async getTeamStats(teamName: string): Promise<HockeyTeamStats | null> {
    const [stats] = await db.select()
      .from(cachedTeamStats)
      .where(eq(cachedTeamStats.teamName, teamName))
      .limit(1);
    
    if (!stats) return null;
    
    return {
      form: stats.formString || "",
      goalsPerGame: (stats.goalsForAvg || 0) * 2.2,
      goalsAllowedPerGame: (stats.goalsAgainstAvg || 0) * 2.2,
      powerPlayPct: 20,
      penaltyKillPct: 80,
      shotsPerGame: 30,
      savePct: 0.91,
    };
  }
  
  async calculateProbabilities(
    homeTeam: string,
    awayTeam: string,
    totalLine: number = 5.5
  ): Promise<HockeyProbabilities> {
    const homeStats = await this.getTeamStats(homeTeam);
    const awayStats = await this.getTeamStats(awayTeam);
    
    const defaultStats: HockeyTeamStats = {
      form: "WLWOL",
      goalsPerGame: 3.0,
      goalsAllowedPerGame: 2.8,
      powerPlayPct: 20,
      penaltyKillPct: 80,
      shotsPerGame: 30,
      savePct: 0.91,
    };
    
    const home = homeStats || defaultStats;
    const away = awayStats || defaultStats;
    
    const homeFormScore = this.formToScore(home.form);
    const awayFormScore = this.formToScore(away.form);
    
    const leagueAvgGoals = 3.0;
    const homeAdvantage = 1.08;
    
    const homeAttack = home.goalsPerGame / leagueAvgGoals;
    const awayDefense = away.goalsAllowedPerGame / leagueAvgGoals;
    const awayAttack = away.goalsPerGame / leagueAvgGoals;
    const homeDefense = home.goalsAllowedPerGame / leagueAvgGoals;
    
    let homeLambda = homeAttack * awayDefense * leagueAvgGoals * homeAdvantage;
    let awayLambda = awayAttack * homeDefense * leagueAvgGoals * (1 / homeAdvantage);
    
    const formAdjust = (homeFormScore - awayFormScore) * 0.3;
    homeLambda += formAdjust;
    awayLambda -= formAdjust;
    
    homeLambda = Math.max(1.5, homeLambda);
    awayLambda = Math.max(1.5, awayLambda);
    
    let homeWinProb = 0;
    let drawProb = 0;
    let awayWinProb = 0;
    let over55Prob = 0;
    let over65Prob = 0;
    let bttsProb = 0;
    
    for (let homeGoals = 0; homeGoals <= 10; homeGoals++) {
      for (let awayGoals = 0; awayGoals <= 10; awayGoals++) {
        const prob = this.poissonProbability(homeLambda, homeGoals) * 
                     this.poissonProbability(awayLambda, awayGoals);
        
        if (homeGoals > awayGoals) homeWinProb += prob;
        else if (homeGoals === awayGoals) drawProb += prob;
        else awayWinProb += prob;
        
        const total = homeGoals + awayGoals;
        if (total > 5.5) over55Prob += prob;
        if (total > 6.5) over65Prob += prob;
        
        if (homeGoals > 0 && awayGoals > 0) bttsProb += prob;
      }
    }
    
    const regulationDrawProb = drawProb;
    const homeWinRegulation = homeWinProb;
    const awayWinRegulation = awayWinProb;
    
    const otHomeWinShare = 0.52;
    const homeWinTotal = homeWinProb + drawProb * otHomeWinShare;
    const awayWinTotal = awayWinProb + drawProb * (1 - otHomeWinShare);
    
    let confidence = 0.6;
    if (homeStats && awayStats) confidence += 0.15;
    if (Math.abs(homeFormScore - awayFormScore) > 0.3) confidence += 0.1;
    
    return {
      homeWin: Math.round(homeWinTotal * 1000) / 10,
      draw: Math.round(regulationDrawProb * 1000) / 10,
      awayWin: Math.round(awayWinTotal * 1000) / 10,
      homeWinRegulation: Math.round(homeWinRegulation * 1000) / 10,
      awayWinRegulation: Math.round(awayWinRegulation * 1000) / 10,
      over55: Math.round(over55Prob * 1000) / 10,
      under55: Math.round((1 - over55Prob) * 1000) / 10,
      over65: Math.round(over65Prob * 1000) / 10,
      under65: Math.round((1 - over65Prob) * 1000) / 10,
      btts: Math.round(bttsProb * 1000) / 10,
      predictedHomeGoals: Math.round(homeLambda * 10) / 10,
      predictedAwayGoals: Math.round(awayLambda * 10) / 10,
      predictedTotal: Math.round((homeLambda + awayLambda) * 10) / 10,
      confidence: Math.min(0.85, confidence),
      method: "poisson_hockey"
    };
  }
  
  generateRecommendations(probs: HockeyProbabilities): HockeyRecommendation[] {
    const recommendations: HockeyRecommendation[] = [];
    
    const bets = [
      { type: "moneyline", prediction: "Domicile (incl. OT)", prob: probs.homeWin / 100 },
      { type: "moneyline", prediction: "Exterieur (incl. OT)", prob: probs.awayWin / 100 },
      { type: "total", prediction: "Over 5.5", prob: probs.over55 / 100 },
      { type: "total", prediction: "Under 5.5", prob: probs.under55 / 100 },
      { type: "total", prediction: "Over 6.5", prob: probs.over65 / 100 },
      { type: "btts", prediction: "Les deux marquent", prob: probs.btts / 100 },
    ];
    
    for (const bet of bets) {
      let confidence: "high" | "medium" | "low" = "low";
      if (bet.prob >= 0.58) confidence = "high";
      else if (bet.prob >= 0.48) confidence = "medium";
      
      recommendations.push({
        betType: bet.type,
        prediction: bet.prediction,
        probability: bet.prob * 100,
        confidence,
        reasoning: `Probabilite: ${(bet.prob * 100).toFixed(1)}%. Total predit: ${probs.predictedTotal}`
      });
    }
    
    return recommendations.sort((a, b) => b.probability - a.probability);
  }
  
  async analyzeMatch(
    homeTeam: string,
    awayTeam: string,
    league: string,
    matchDate: Date
  ): Promise<HockeyPrediction> {
    const probs = await this.calculateProbabilities(homeTeam, awayTeam);
    const recommendations = this.generateRecommendations(probs);
    
    const homeStats = await this.getTeamStats(homeTeam);
    const awayStats = await this.getTeamStats(awayTeam);
    
    const analysis = this.generateAnalysis(homeStats, awayStats, probs);
    
    return {
      matchId: 0,
      homeTeam,
      awayTeam,
      league,
      matchDate,
      probabilities: probs,
      recommendations,
      analysis
    };
  }
  
  private generateAnalysis(
    homeStats: HockeyTeamStats | null,
    awayStats: HockeyTeamStats | null,
    probs: HockeyProbabilities
  ): HockeyAnalysis {
    const keyFactors: string[] = [];
    
    let homeForm = "Forme inconnue";
    let awayForm = "Forme inconnue";
    
    if (homeStats?.form) {
      const score = this.formToScore(homeStats.form);
      homeForm = score >= 0.7 ? "Excellente forme" : score >= 0.5 ? "Forme correcte" : "En difficulte";
      if (score >= 0.7) keyFactors.push("Domicile en serie");
    }
    
    if (awayStats?.form) {
      const score = this.formToScore(awayStats.form);
      awayForm = score >= 0.7 ? "Excellente forme" : score >= 0.5 ? "Forme correcte" : "En difficulte";
      if (score >= 0.7) keyFactors.push("Exterieur en serie");
    }
    
    let scoringTrend = "Scoring standard";
    if (probs.predictedTotal >= 6.5) {
      scoringTrend = "Match offensif attendu";
      keyFactors.push("Potentiel Over eleve");
    } else if (probs.predictedTotal <= 5.0) {
      scoringTrend = "Match defensif attendu";
      keyFactors.push("Potentiel Under eleve");
    }
    
    let specialTeamsTrend = "Special teams standard";
    
    let riskLevel: "low" | "medium" | "high" = "medium";
    const maxProb = Math.max(probs.homeWin, probs.awayWin);
    if (maxProb >= 58) riskLevel = "low";
    else if (maxProb <= 52) riskLevel = "high";
    
    if (keyFactors.length === 0) {
      keyFactors.push("Match equilibre");
    }
    
    return {
      homeForm,
      awayForm,
      scoringTrend,
      specialTeamsTrend,
      keyFactors,
      riskLevel
    };
  }
  
  async analyzeTodayMatches(): Promise<HockeyPrediction[]> {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setHours(23, 59, 59, 999);
    
    const finishedStatuses = ["finished", "FT", "AET", "PEN", "PST", "CANC", "ABD", "AWD", "WO", "postponed", "cancelled"];
    
    const matches = await db.select()
      .from(cachedMatches)
      .where(and(
        gte(cachedMatches.matchDate, now),
        lte(cachedMatches.matchDate, tomorrow),
        or(
          like(cachedMatches.league, '%NHL%'),
          like(cachedMatches.league, '%Hockey%')
        ),
        notInArray(cachedMatches.status, finishedStatuses)
      ))
      .orderBy(cachedMatches.matchDate);
    
    const results: HockeyPrediction[] = [];
    
    for (const match of matches) {
      const prediction = await this.analyzeMatch(
        match.homeTeam,
        match.awayTeam,
        match.league,
        match.matchDate
      );
      prediction.matchId = match.id;
      results.push(prediction);
    }
    
    return results;
  }
  
  formatPredictionsForAI(predictions: HockeyPrediction[]): string {
    if (predictions.length === 0) {
      return "Aucun match NHL/Hockey disponible pour aujourd'hui.";
    }
    
    const lines: string[] = [
      "=== PREDICTIONS HOCKEY (NHL) ===",
      `Analyse du ${new Date().toLocaleDateString('fr-FR')}`,
      "Methode: Modele Poisson adapte hockey",
      ""
    ];
    
    const sorted = [...predictions].sort((a, b) => 
      b.probabilities.confidence - a.probabilities.confidence
    );
    
    for (const pred of sorted) {
      const probs = pred.probabilities;
      const time = pred.matchDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const topRec = pred.recommendations[0];
      
      let line = `[${time}] ${pred.homeTeam} vs ${pred.awayTeam}`;
      line += `\n  Buts predits: ${probs.predictedHomeGoals}-${probs.predictedAwayGoals} (Total: ${probs.predictedTotal})`;
      line += `\n  Moneyline: Dom=${probs.homeWin}% Ext=${probs.awayWin}%`;
      line += `\n  Over 5.5=${probs.over55}% | Over 6.5=${probs.over65}%`;
      line += `\n  Recommandation: ${topRec.prediction} (${topRec.probability.toFixed(1)}%)`;
      line += `\n  Analyse: ${pred.analysis.keyFactors.join(", ")}`;
      line += `\n  Risque: ${pred.analysis.riskLevel} | Confiance: ${(probs.confidence * 100).toFixed(0)}%`;
      
      lines.push(line);
    }
    
    lines.push("");
    lines.push("Note: Probabilites calculees sur base statistique.");
    
    return lines.join("\n");
  }
}

export const hockeyPredictionService = new HockeyPredictionService();
