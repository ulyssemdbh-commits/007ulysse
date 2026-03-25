import { db } from "../db";
import { cachedMatches, cachedTeamStats, cachedOdds } from "@shared/schema";
import { eq, and, gte, lte, like, notInArray } from "drizzle-orm";

interface BasketballTeamStats {
  form: string;
  pointsPerGame: number;
  pointsAllowedPerGame: number;
  pace: number;
  offensiveRating: number;
  defensiveRating: number;
}

interface BasketballProbabilities {
  homeWin: number;
  awayWin: number;
  overTotal: number;
  underTotal: number;
  homeSpread: number;
  awaySpread: number;
  predictedHomeScore: number;
  predictedAwayScore: number;
  predictedTotal: number;
  confidence: number;
  method: string;
}

interface BasketballPrediction {
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchDate: Date;
  probabilities: BasketballProbabilities;
  recommendations: BasketballRecommendation[];
  analysis: BasketballAnalysis;
}

interface BasketballRecommendation {
  betType: string;
  prediction: string;
  probability: number;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

interface BasketballAnalysis {
  homeForm: string;
  awayForm: string;
  paceTrend: string;
  scoringTrend: string;
  keyFactors: string[];
  riskLevel: "low" | "medium" | "high";
}

class BasketballPredictionService {
  
  private formToScore(form: string): number {
    if (!form) return 0.5;
    let score = 0;
    let count = 0;
    const weights = [1.0, 0.9, 0.8, 0.7, 0.6];
    
    for (let i = 0; i < Math.min(form.length, 5); i++) {
      const char = form[i].toUpperCase();
      const weight = weights[i];
      if (char === 'W') score += 1.0 * weight;
      else if (char === 'L') score += 0.0 * weight;
      count += weight;
    }
    
    return count > 0 ? score / count : 0.5;
  }
  
  private gaussianProbability(mean: number, stdDev: number, value: number): number {
    const z = (value - mean) / stdDev;
    return 0.5 * (1 + this.erf(z / Math.sqrt(2)));
  }
  
  private erf(x: number): number {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    
    return sign * y;
  }
  
  async getTeamStats(teamName: string): Promise<BasketballTeamStats | null> {
    const [stats] = await db.select()
      .from(cachedTeamStats)
      .where(eq(cachedTeamStats.teamName, teamName))
      .limit(1);
    
    if (!stats) return null;
    
    return {
      form: stats.formString || "",
      pointsPerGame: (stats.goalsForAvg || 0) * 80,
      pointsAllowedPerGame: (stats.goalsAgainstAvg || 0) * 80,
      pace: 100,
      offensiveRating: 110,
      defensiveRating: 110,
    };
  }
  
  async calculateProbabilities(
    homeTeam: string,
    awayTeam: string,
    totalLine: number = 220,
    spreadLine: number = 0
  ): Promise<BasketballProbabilities> {
    const homeStats = await this.getTeamStats(homeTeam);
    const awayStats = await this.getTeamStats(awayTeam);
    
    const defaultStats: BasketballTeamStats = {
      form: "WLWLW",
      pointsPerGame: 108,
      pointsAllowedPerGame: 108,
      pace: 100,
      offensiveRating: 110,
      defensiveRating: 110,
    };
    
    const home = homeStats || defaultStats;
    const away = awayStats || defaultStats;
    
    const homeFormScore = this.formToScore(home.form);
    const awayFormScore = this.formToScore(away.form);
    
    const homeAdvantage = 3.5;
    const leagueAvgPoints = 112;
    
    const homeOffense = (home.pointsPerGame / leagueAvgPoints) * leagueAvgPoints;
    const awayDefense = (away.pointsAllowedPerGame / leagueAvgPoints) * leagueAvgPoints;
    const awayOffense = (away.pointsPerGame / leagueAvgPoints) * leagueAvgPoints;
    const homeDefense = (home.pointsAllowedPerGame / leagueAvgPoints) * leagueAvgPoints;
    
    let predictedHomeScore = (homeOffense + awayDefense) / 2 + homeAdvantage;
    let predictedAwayScore = (awayOffense + homeDefense) / 2;
    
    const formAdjustment = (homeFormScore - awayFormScore) * 5;
    predictedHomeScore += formAdjustment;
    predictedAwayScore -= formAdjustment;
    
    const predictedTotal = predictedHomeScore + predictedAwayScore;
    const predictedSpread = predictedAwayScore - predictedHomeScore;
    
    const stdDevMargin = 12;
    const stdDevTotal = 15;
    
    const homeWinProb = this.gaussianProbability(predictedSpread, stdDevMargin, 0);
    const awayWinProb = 1 - homeWinProb;
    
    const overProb = 1 - this.gaussianProbability(predictedTotal, stdDevTotal, totalLine);
    const underProb = this.gaussianProbability(predictedTotal, stdDevTotal, totalLine);
    
    const homeSpreadProb = this.gaussianProbability(predictedSpread, stdDevMargin, spreadLine);
    const awaySpreadProb = 1 - homeSpreadProb;
    
    let confidence = 0.6;
    if (homeStats && awayStats) confidence += 0.15;
    if (Math.abs(homeFormScore - awayFormScore) > 0.3) confidence += 0.1;
    
    return {
      homeWin: Math.round(homeWinProb * 1000) / 10,
      awayWin: Math.round(awayWinProb * 1000) / 10,
      overTotal: Math.round(overProb * 1000) / 10,
      underTotal: Math.round(underProb * 1000) / 10,
      homeSpread: Math.round(homeSpreadProb * 1000) / 10,
      awaySpread: Math.round(awaySpreadProb * 1000) / 10,
      predictedHomeScore: Math.round(predictedHomeScore),
      predictedAwayScore: Math.round(predictedAwayScore),
      predictedTotal: Math.round(predictedTotal),
      confidence: Math.min(0.85, confidence),
      method: "gaussian_spread_total"
    };
  }
  
  generateRecommendations(probs: BasketballProbabilities, totalLine: number = 220): BasketballRecommendation[] {
    const recommendations: BasketballRecommendation[] = [];
    
    const bets = [
      { type: "moneyline", prediction: "Domicile", prob: probs.homeWin / 100 },
      { type: "moneyline", prediction: "Exterieur", prob: probs.awayWin / 100 },
      { type: "total", prediction: `Over ${totalLine}`, prob: probs.overTotal / 100 },
      { type: "total", prediction: `Under ${totalLine}`, prob: probs.underTotal / 100 },
    ];
    
    for (const bet of bets) {
      let confidence: "high" | "medium" | "low" = "low";
      if (bet.prob >= 0.60) confidence = "high";
      else if (bet.prob >= 0.50) confidence = "medium";
      
      recommendations.push({
        betType: bet.type,
        prediction: bet.prediction,
        probability: bet.prob * 100,
        confidence,
        reasoning: `Probabilite: ${(bet.prob * 100).toFixed(1)}%. Score predit: ${probs.predictedHomeScore}-${probs.predictedAwayScore} (Total: ${probs.predictedTotal})`
      });
    }
    
    return recommendations.sort((a, b) => b.probability - a.probability);
  }
  
  async analyzeMatch(
    homeTeam: string,
    awayTeam: string,
    league: string,
    matchDate: Date,
    totalLine: number = 220
  ): Promise<BasketballPrediction> {
    const probs = await this.calculateProbabilities(homeTeam, awayTeam, totalLine);
    const recommendations = this.generateRecommendations(probs, totalLine);
    
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
    homeStats: BasketballTeamStats | null,
    awayStats: BasketballTeamStats | null,
    probs: BasketballProbabilities
  ): BasketballAnalysis {
    const keyFactors: string[] = [];
    
    let homeForm = "Forme inconnue";
    let awayForm = "Forme inconnue";
    
    if (homeStats?.form) {
      const score = this.formToScore(homeStats.form);
      homeForm = score >= 0.7 ? "Excellente forme" : score >= 0.5 ? "Forme correcte" : "Forme difficile";
      if (score >= 0.7) keyFactors.push("Domicile en serie positive");
    }
    
    if (awayStats?.form) {
      const score = this.formToScore(awayStats.form);
      awayForm = score >= 0.7 ? "Excellente forme" : score >= 0.5 ? "Forme correcte" : "Forme difficile";
      if (score >= 0.7) keyFactors.push("Exterieur en serie positive");
    }
    
    let paceTrend = "Pace standard";
    let scoringTrend = "Scoring moyen";
    
    if (probs.predictedTotal >= 230) {
      scoringTrend = "Match a haut scoring attendu";
      keyFactors.push("Potentiel Over eleve");
    } else if (probs.predictedTotal <= 210) {
      scoringTrend = "Match defensif attendu";
      keyFactors.push("Potentiel Under eleve");
    }
    
    let riskLevel: "low" | "medium" | "high" = "medium";
    const maxProb = Math.max(probs.homeWin, probs.awayWin);
    if (maxProb >= 60) riskLevel = "low";
    else if (maxProb <= 52) riskLevel = "high";
    
    if (keyFactors.length === 0) {
      keyFactors.push("Match equilibre");
    }
    
    return {
      homeForm,
      awayForm,
      paceTrend,
      scoringTrend,
      keyFactors,
      riskLevel
    };
  }
  
  async analyzeTodayMatches(): Promise<BasketballPrediction[]> {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setHours(23, 59, 59, 999);
    
    const finishedStatuses = ["finished", "FT", "AET", "PEN", "PST", "CANC", "ABD", "AWD", "WO", "postponed", "cancelled"];
    
    const matches = await db.select()
      .from(cachedMatches)
      .where(and(
        gte(cachedMatches.matchDate, now),
        lte(cachedMatches.matchDate, tomorrow),
        like(cachedMatches.league, '%NBA%'),
        notInArray(cachedMatches.status, finishedStatuses)
      ))
      .orderBy(cachedMatches.matchDate);
    
    const results: BasketballPrediction[] = [];
    
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
  
  formatPredictionsForAI(predictions: BasketballPrediction[]): string {
    if (predictions.length === 0) {
      return "Aucun match NBA disponible pour aujourd'hui.";
    }
    
    const lines: string[] = [
      "=== PREDICTIONS BASKETBALL (NBA) ===",
      `Analyse du ${new Date().toLocaleDateString('fr-FR')}`,
      "Methode: Modele gaussien (spread + totaux)",
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
      line += `\n  Score predit: ${probs.predictedHomeScore}-${probs.predictedAwayScore} (Total: ${probs.predictedTotal})`;
      line += `\n  Moneyline: Dom=${probs.homeWin}% Ext=${probs.awayWin}%`;
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

export const basketballPredictionService = new BasketballPredictionService();
