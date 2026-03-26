/**
 * Failure Pattern Analysis Service
 * 
 * Analyse les patterns d'échec récurrents et génère des recommandations
 * préventives avant les tentatives d'action.
 * 
 * Point 6 de la proposition utilisateur:
 * - Analyse des logs a posteriori
 * - Apprentissage des patterns d'échec
 * - Recommandations claires avant tentative
 */

import { db } from "../db";
import { actionLogs } from "@shared/schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";

export interface FailurePattern {
  actionType: string;
  actionCategory: string;
  failureRate: number;
  totalAttempts: number;
  recentFailures: number;
  commonErrors: string[];
  timePatterns: {
    hourOfDay?: number;
    dayOfWeek?: number;
  };
  recommendations: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
}

export interface PreActionRecommendation {
  shouldProceed: boolean;
  riskLevel: "low" | "medium" | "high" | "critical";
  recommendations: string[];
  alternatives?: string[];
  successProbability: number;
}

export interface PatternAnalysisResult {
  patterns: FailurePattern[];
  overallHealth: number;
  criticalPatterns: number;
  lastAnalyzed: Date;
}

class FailurePatternService {
  private patternCache: Map<number, PatternAnalysisResult> = new Map();
  private cacheDurationMs = 15 * 60 * 1000; // 15 minutes
  private lastCacheTime: Map<number, Date> = new Map();
  
  async analyzePatterns(userId: number, daysBack: number = 30): Promise<PatternAnalysisResult> {
    // Check cache
    const lastCache = this.lastCacheTime.get(userId);
    if (lastCache && Date.now() - lastCache.getTime() < this.cacheDurationMs) {
      const cached = this.patternCache.get(userId);
      if (cached) return cached;
    }
    
    console.log(`[FailurePattern] Analyzing patterns for user ${userId} (last ${daysBack} days)`);
    
    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    
    const actions = await db.select()
      .from(actionLogs)
      .where(and(
        eq(actionLogs.userId, userId),
        gte(actionLogs.startedAt, cutoff)
      ))
      .orderBy(desc(actionLogs.startedAt));
    
    // Grouper par type d'action
    const actionGroups = new Map<string, typeof actions>();
    for (const action of actions) {
      const key = `${action.actionCategory}:${action.actionType}`;
      if (!actionGroups.has(key)) {
        actionGroups.set(key, []);
      }
      actionGroups.get(key)!.push(action);
    }
    
    const patterns: FailurePattern[] = [];
    
    for (const [key, groupActions] of actionGroups) {
      const [category, type] = key.split(":");
      const total = groupActions.length;
      const failures = groupActions.filter(a => a.status === "failed");
      const failureRate = total > 0 ? failures.length / total : 0;
      
      // Ne pas analyser si pas assez de données
      if (total < 5) continue;
      
      // Extraire les erreurs communes
      const errorCounts = new Map<string, number>();
      for (const fail of failures) {
        const error = fail.errorMessage || "Unknown error";
        const normalized = this.normalizeError(error);
        errorCounts.set(normalized, (errorCounts.get(normalized) || 0) + 1);
      }
      
      const commonErrors = Array.from(errorCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([error]) => error);
      
      // Analyser les patterns temporels
      const failureHours = failures.map(f => f.startedAt ? new Date(f.startedAt).getHours() : -1).filter(h => h >= 0);
      const failureDays = failures.map(f => f.startedAt ? new Date(f.startedAt).getDay() : -1).filter(d => d >= 0);
      
      const timePatterns: FailurePattern["timePatterns"] = {};
      if (failureHours.length >= 3) {
        const hourCounts = this.countOccurrences(failureHours);
        const peakHour = this.findPeak(hourCounts);
        if (peakHour !== null && hourCounts.get(peakHour)! >= 3) {
          timePatterns.hourOfDay = peakHour;
        }
      }
      if (failureDays.length >= 3) {
        const dayCounts = this.countOccurrences(failureDays);
        const peakDay = this.findPeak(dayCounts);
        if (peakDay !== null && dayCounts.get(peakDay)! >= 3) {
          timePatterns.dayOfWeek = peakDay;
        }
      }
      
      // Calculer le niveau de risque
      let riskLevel: FailurePattern["riskLevel"] = "low";
      if (failureRate > 0.5) riskLevel = "critical";
      else if (failureRate > 0.3) riskLevel = "high";
      else if (failureRate > 0.15) riskLevel = "medium";
      
      // Générer des recommandations
      const recommendations = this.generateRecommendations(
        type,
        category,
        failureRate,
        commonErrors,
        timePatterns
      );
      
      // Compter les échecs récents (dernières 24h)
      const recentCutoff = Date.now() - 24 * 60 * 60 * 1000;
      const recentFailures = failures.filter(f => 
        f.startedAt && new Date(f.startedAt).getTime() > recentCutoff
      ).length;
      
      patterns.push({
        actionType: type,
        actionCategory: category,
        failureRate,
        totalAttempts: total,
        recentFailures,
        commonErrors,
        timePatterns,
        recommendations,
        riskLevel
      });
    }
    
    // Trier par niveau de risque
    patterns.sort((a, b) => {
      const riskOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    });
    
    const result: PatternAnalysisResult = {
      patterns,
      overallHealth: this.calculateOverallHealth(patterns),
      criticalPatterns: patterns.filter(p => p.riskLevel === "critical").length,
      lastAnalyzed: new Date()
    };
    
    // Update cache
    this.patternCache.set(userId, result);
    this.lastCacheTime.set(userId, new Date());
    
    console.log(`[FailurePattern] Found ${patterns.length} patterns, ${result.criticalPatterns} critical`);
    
    return result;
  }
  
  async getPreActionRecommendation(
    userId: number,
    actionType: string,
    actionCategory: string
  ): Promise<PreActionRecommendation> {
    const analysis = await this.analyzePatterns(userId);
    
    const pattern = analysis.patterns.find(
      p => p.actionType === actionType && p.actionCategory === actionCategory
    );
    
    if (!pattern) {
      // Pas de données historiques
      return {
        shouldProceed: true,
        riskLevel: "low",
        recommendations: [],
        successProbability: 0.9
      };
    }
    
    const successProbability = Math.round((1 - pattern.failureRate) * 100) / 100;
    
    // Décider si on doit procéder
    let shouldProceed = true;
    const recommendations = [...pattern.recommendations];
    const alternatives: string[] = [];
    
    if (pattern.riskLevel === "critical") {
      shouldProceed = false;
      recommendations.unshift("⚠️ Cette action a un taux d'échec très élevé. Considérez une alternative.");
      
      if (actionCategory === "email") {
        alternatives.push("Vérifiez d'abord la connexion AgentMail");
        alternatives.push("Testez avec un email simple sans pièce jointe");
      } else if (actionCategory === "file") {
        alternatives.push("Vérifiez l'espace de stockage disponible");
        alternatives.push("Essayez avec un fichier plus petit");
      }
    } else if (pattern.riskLevel === "high" && pattern.recentFailures >= 2) {
      recommendations.unshift("⚡ Plusieurs échecs récents détectés. Vérifiez le service avant de continuer.");
    }
    
    // Ajouter des conseils temporels si applicable
    if (pattern.timePatterns.hourOfDay !== undefined) {
      const hour = pattern.timePatterns.hourOfDay;
      recommendations.push(`📊 Les échecs sont plus fréquents vers ${hour}h. Considérez un autre horaire.`);
    }
    
    return {
      shouldProceed,
      riskLevel: pattern.riskLevel,
      recommendations,
      alternatives: alternatives.length > 0 ? alternatives : undefined,
      successProbability
    };
  }
  
  private normalizeError(error: string): string {
    // Normaliser les messages d'erreur pour grouper les similaires
    return error
      .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/g, "[DATE]")
      .replace(/\d+/g, "[N]")
      .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, "[UUID]")
      .substring(0, 100);
  }
  
  private countOccurrences<T>(arr: T[]): Map<T, number> {
    const counts = new Map<T, number>();
    for (const item of arr) {
      counts.set(item, (counts.get(item) || 0) + 1);
    }
    return counts;
  }
  
  private findPeak<T>(counts: Map<T, number>): T | null {
    let max = 0;
    let peak: T | null = null;
    for (const [key, count] of counts) {
      if (count > max) {
        max = count;
        peak = key;
      }
    }
    return peak;
  }
  
  private generateRecommendations(
    actionType: string,
    category: string,
    failureRate: number,
    commonErrors: string[],
    timePatterns: FailurePattern["timePatterns"]
  ): string[] {
    const recs: string[] = [];
    
    // Recommandations basées sur le type d'action
    if (category === "email") {
      if (failureRate > 0.2) {
        recs.push("Vérifiez que l'adresse email est valide");
        recs.push("Simplifiez le contenu du message");
      }
      if (actionType.includes("pdf") || actionType.includes("word")) {
        recs.push("Assurez-vous que le contenu du fichier n'est pas trop volumineux");
      }
    }
    
    if (category === "file") {
      recs.push("Vérifiez les permissions d'écriture");
      if (failureRate > 0.3) {
        recs.push("Réduisez la taille du fichier généré");
      }
    }
    
    if (category === "search") {
      recs.push("Reformulez la requête de manière plus spécifique");
      if (failureRate > 0.2) {
        recs.push("Évitez les requêtes trop longues ou complexes");
      }
    }
    
    // Recommandations basées sur les erreurs communes
    for (const error of commonErrors) {
      if (error.includes("timeout") || error.includes("TIMEOUT")) {
        recs.push("L'opération est souvent lente - patientez ou réessayez plus tard");
      }
      if (error.includes("rate") || error.includes("limit")) {
        recs.push("Limite de requêtes atteinte - attendez quelques minutes");
      }
      if (error.includes("auth") || error.includes("401") || error.includes("403")) {
        recs.push("Problème d'authentification - vérifiez les credentials");
      }
    }
    
    return recs.slice(0, 4); // Max 4 recommandations
  }
  
  private calculateOverallHealth(patterns: FailurePattern[]): number {
    if (patterns.length === 0) return 100;
    
    const weights = { critical: 0, high: 0.3, medium: 0.7, low: 1 };
    let totalWeight = 0;
    let weightedSum = 0;
    
    for (const pattern of patterns) {
      const weight = pattern.totalAttempts; // Pondérer par le nombre d'utilisations
      totalWeight += weight;
      weightedSum += weight * (1 - pattern.failureRate) * weights[pattern.riskLevel];
    }
    
    return totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) : 100;
  }
  
  // API pour le prompt système
  async generatePatternSummaryForPrompt(userId: number): Promise<string> {
    const analysis = await this.analyzePatterns(userId, 7); // Derniers 7 jours
    
    if (analysis.patterns.length === 0) {
      return "";
    }
    
    const criticalPatterns = analysis.patterns.filter(p => p.riskLevel === "critical" || p.riskLevel === "high");
    
    if (criticalPatterns.length === 0) {
      return "";
    }
    
    let summary = `\n⚠️ PATTERNS D'ÉCHEC DÉTECTÉS (derniers 7 jours):\n`;
    
    for (const pattern of criticalPatterns.slice(0, 3)) {
      summary += `  - ${pattern.actionType} (${pattern.actionCategory}): ${Math.round(pattern.failureRate * 100)}% d'échec`;
      if (pattern.recommendations.length > 0) {
        summary += ` → ${pattern.recommendations[0]}`;
      }
      summary += `\n`;
    }
    
    summary += `Santé globale: ${analysis.overallHealth}%\n`;
    
    return summary;
  }
}

export const failurePatternService = new FailurePatternService();
