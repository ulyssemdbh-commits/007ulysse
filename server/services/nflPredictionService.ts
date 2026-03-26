import { db } from "../db";
import { cachedMatches, cachedTeamStats, cachedOdds } from "@shared/schema";
import { eq, and, gte, lte, like, or, notInArray } from "drizzle-orm";

interface NFLTeamStats {
  form: string;
  pointsPerGame: number;
  pointsAllowedPerGame: number;
  yardsPerGame: number;
  yardsAllowedPerGame: number;
  turnoversPerGame: number;
  takeawaysPerGame: number;
}

interface NFLProbabilities {
  homeWin: number;
  awayWin: number;
  homeSpread: number;
  awaySpread: number;
  overTotal: number;
  underTotal: number;
  predictedHomeScore: number;
  predictedAwayScore: number;
  predictedTotal: number;
  predictedSpread: number;
  confidence: number;
  method: string;
}

interface NFLPrediction {
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchDate: Date;
  probabilities: NFLProbabilities;
  recommendations: NFLRecommendation[];
  analysis: NFLAnalysis;
}

interface NFLRecommendation {
  betType: string;
  prediction: string;
  probability: number;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

interface NFLAnalysis {
  homeForm: string;
  awayForm: string;
  offensiveTrend: string;
  defensiveTrend: string;
  keyFactors: string[];
  riskLevel: "low" | "medium" | "high";
}

class NFLPredictionService {
  
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
  
  async getTeamStats(teamName: string): Promise<NFLTeamStats | null> {
    const [stats] = await db.select()
      .from(cachedTeamStats)
      .where(eq(cachedTeamStats.teamName, teamName))
      .limit(1);
    
    if (!stats) return null;
    
    return {
      form: stats.formString || "",
      pointsPerGame: (stats.goalsForAvg || 0) * 16,
      pointsAllowedPerGame: (stats.goalsAgainstAvg || 0) * 16,
      yardsPerGame: 350,
      yardsAllowedPerGame: 340,
      turnoversPerGame: 1.2,
      takeawaysPerGame: 1.3,
    };
  }
  
  async calculateProbabilities(
    homeTeam: string,
    awayTeam: string,
    spreadLine: number = 0,
    totalLine: number = 45.5
  ): Promise<NFLProbabilities> {
    const homeStats = await this.getTeamStats(homeTeam);
    const awayStats = await this.getTeamStats(awayTeam);
    
    const defaultStats: NFLTeamStats = {
      form: "WLWLW",
      pointsPerGame: 23,
      pointsAllowedPerGame: 22,
      yardsPerGame: 350,
      yardsAllowedPerGame: 340,
      turnoversPerGame: 1.2,
      takeawaysPerGame: 1.3,
    };
    
    const home = homeStats || defaultStats;
    const away = awayStats || defaultStats;
    
    const homeFormScore = this.formToScore(home.form);
    const awayFormScore = this.formToScore(away.form);
    
    const homeAdvantage = 2.5;
    const leagueAvgPoints = 23;
    
    const homeOffenseRating = home.pointsPerGame / leagueAvgPoints;
    const awayDefenseRating = away.pointsAllowedPerGame / leagueAvgPoints;
    const awayOffenseRating = away.pointsPerGame / leagueAvgPoints;
    const homeDefenseRating = home.pointsAllowedPerGame / leagueAvgPoints;
    
    let predictedHomeScore = homeOffenseRating * awayDefenseRating * leagueAvgPoints + homeAdvantage;
    let predictedAwayScore = awayOffenseRating * homeDefenseRating * leagueAvgPoints;
    
    const formAdjust = (homeFormScore - awayFormScore) * 4;
    predictedHomeScore += formAdjust;
    predictedAwayScore -= formAdjust;
    
    predictedHomeScore = Math.max(10, Math.round(predictedHomeScore));
    predictedAwayScore = Math.max(10, Math.round(predictedAwayScore));
    
    const predictedTotal = predictedHomeScore + predictedAwayScore;
    const predictedSpread = predictedAwayScore - predictedHomeScore;
    
    const stdDevMargin = 13.5;
    const stdDevTotal = 10;
    
    const homeWinProb = this.gaussianProbability(predictedSpread, stdDevMargin, 0);
    const awayWinProb = 1 - homeWinProb;
    
    const homeSpreadProb = this.gaussianProbability(predictedSpread, stdDevMargin, spreadLine);
    const awaySpreadProb = 1 - homeSpreadProb;
    
    const overProb = 1 - this.gaussianProbability(predictedTotal, stdDevTotal, totalLine);
    const underProb = this.gaussianProbability(predictedTotal, stdDevTotal, totalLine);
    
    let confidence = 0.55;
    if (homeStats && awayStats) confidence += 0.15;
    if (Math.abs(homeFormScore - awayFormScore) > 0.3) confidence += 0.1;
    
    return {
      homeWin: Math.round(homeWinProb * 1000) / 10,
      awayWin: Math.round(awayWinProb * 1000) / 10,
      homeSpread: Math.round(homeSpreadProb * 1000) / 10,
      awaySpread: Math.round(awaySpreadProb * 1000) / 10,
      overTotal: Math.round(overProb * 1000) / 10,
      underTotal: Math.round(underProb * 1000) / 10,
      predictedHomeScore,
      predictedAwayScore,
      predictedTotal,
      predictedSpread,
      confidence: Math.min(0.80, confidence),
      method: "gaussian_nfl"
    };
  }
  
  generateRecommendations(
    probs: NFLProbabilities,
    spreadLine: number = 0,
    totalLine: number = 45.5
  ): NFLRecommendation[] {
    const recommendations: NFLRecommendation[] = [];
    
    const bets = [
      { type: "moneyline", prediction: "Domicile ML", prob: probs.homeWin / 100 },
      { type: "moneyline", prediction: "Exterieur ML", prob: probs.awayWin / 100 },
      { type: "spread", prediction: `Domicile ${spreadLine > 0 ? '+' : ''}${spreadLine}`, prob: probs.homeSpread / 100 },
      { type: "spread", prediction: `Exterieur ${-spreadLine > 0 ? '+' : ''}${-spreadLine}`, prob: probs.awaySpread / 100 },
      { type: "total", prediction: `Over ${totalLine}`, prob: probs.overTotal / 100 },
      { type: "total", prediction: `Under ${totalLine}`, prob: probs.underTotal / 100 },
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
        reasoning: `Probabilite: ${(bet.prob * 100).toFixed(1)}%. Score predit: ${probs.predictedHomeScore}-${probs.predictedAwayScore}`
      });
    }
    
    return recommendations.sort((a, b) => b.probability - a.probability);
  }
  
  async analyzeMatch(
    homeTeam: string,
    awayTeam: string,
    league: string,
    matchDate: Date,
    spreadLine: number = 0,
    totalLine: number = 45.5
  ): Promise<NFLPrediction> {
    const probs = await this.calculateProbabilities(homeTeam, awayTeam, spreadLine, totalLine);
    const recommendations = this.generateRecommendations(probs, spreadLine, totalLine);
    
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
    homeStats: NFLTeamStats | null,
    awayStats: NFLTeamStats | null,
    probs: NFLProbabilities
  ): NFLAnalysis {
    const keyFactors: string[] = [];
    
    let homeForm = "Forme inconnue";
    let awayForm = "Forme inconnue";
    
    if (homeStats?.form) {
      const score = this.formToScore(homeStats.form);
      homeForm = score >= 0.7 ? "Excellente forme" : score >= 0.5 ? "Forme correcte" : "En difficulte";
      if (score >= 0.7) keyFactors.push("Domicile en momentum");
    }
    
    if (awayStats?.form) {
      const score = this.formToScore(awayStats.form);
      awayForm = score >= 0.7 ? "Excellente forme" : score >= 0.5 ? "Forme correcte" : "En difficulte";
      if (score >= 0.7) keyFactors.push("Exterieur en momentum");
    }
    
    let offensiveTrend = "Offenses equilibrees";
    let defensiveTrend = "Defenses standard";
    
    if (probs.predictedTotal >= 50) {
      offensiveTrend = "Match a haut scoring attendu";
      keyFactors.push("Potentiel Over eleve");
    } else if (probs.predictedTotal <= 40) {
      offensiveTrend = "Match defensif attendu";
      keyFactors.push("Potentiel Under eleve");
    }
    
    if (Math.abs(probs.predictedSpread) >= 7) {
      keyFactors.push("Ecart de niveau significatif");
    }
    
    let riskLevel: "low" | "medium" | "high" = "medium";
    const maxProb = Math.max(probs.homeWin, probs.awayWin);
    if (maxProb >= 60) riskLevel = "low";
    else if (maxProb <= 53) riskLevel = "high";
    
    if (keyFactors.length === 0) {
      keyFactors.push("Match equilibre");
    }
    
    return {
      homeForm,
      awayForm,
      offensiveTrend,
      defensiveTrend,
      keyFactors,
      riskLevel
    };
  }
  
  async analyzeTodayMatches(): Promise<NFLPrediction[]> {
    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + 7);
    
    const finishedStatuses = ["finished", "FT", "AET", "PEN", "PST", "CANC", "ABD", "AWD", "WO", "postponed", "cancelled"];
    
    const matches = await db.select()
      .from(cachedMatches)
      .where(and(
        gte(cachedMatches.matchDate, now),
        lte(cachedMatches.matchDate, endDate),
        or(
          like(cachedMatches.league, '%NFL%'),
          like(cachedMatches.league, '%American Football%')
        ),
        notInArray(cachedMatches.status, finishedStatuses)
      ))
      .orderBy(cachedMatches.matchDate);
    
    const results: NFLPrediction[] = [];
    
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
  
  formatPredictionsForAI(predictions: NFLPrediction[]): string {
    if (predictions.length === 0) {
      return "Aucun match NFL disponible cette semaine.";
    }
    
    const lines: string[] = [
      "=== PREDICTIONS NFL ===",
      `Analyse du ${new Date().toLocaleDateString('fr-FR')}`,
      "Methode: Modele gaussien spread/totaux NFL",
      ""
    ];
    
    const sorted = [...predictions].sort((a, b) => 
      b.probabilities.confidence - a.probabilities.confidence
    );
    
    for (const pred of sorted) {
      const probs = pred.probabilities;
      const date = pred.matchDate.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
      const time = pred.matchDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const topRec = pred.recommendations[0];
      
      let line = `[${date} ${time}] ${pred.homeTeam} vs ${pred.awayTeam}`;
      line += `\n  Score predit: ${probs.predictedHomeScore}-${probs.predictedAwayScore} (Total: ${probs.predictedTotal})`;
      line += `\n  Spread predit: ${probs.predictedSpread > 0 ? '+' : ''}${probs.predictedSpread}`;
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

export const nflPredictionService = new NFLPredictionService();
