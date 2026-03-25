import { db } from "../db";
import { homeworkExecution, ulysseHomework, type UlysseHomework, type HomeworkExecution } from "@shared/schema";
import { eq, and, sql, gte, desc } from "drizzle-orm";
import OpenAI from "openai";
import { canMakeCall, withRateLimit } from "./rateLimiter";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

interface CachedPrompt {
  prompt: string;
  score: number;
  usageCount: number;
  createdAt: Date;
  successRate: number;
}

interface FailurePattern {
  errorType: string;
  count: number;
  lastOccurred: Date;
  suggestedFix: string;
  taskTypes: string[];
}

interface ExecutionMetrics {
  totalExecutions: number;
  successRate: number;
  avgDurationMs: number;
  failurePatterns: FailurePattern[];
  bestExecutionHours: number[];
}

interface SmartRecurrenceConditions {
  onlyIfOnline?: boolean;
  skipIfNoChange?: boolean;
  timeWindow?: { start: number; end: number };
  maxRetries?: number;
  minIntervalHours?: number;
}

export class HomeworkIntelligenceService {
  private promptCache = new Map<string, CachedPrompt>();
  private failurePatterns = new Map<string, FailurePattern>();
  private executionStats = new Map<number, { startTime: Date; tokensUsed: number }>();
  
  private readonly PROMPT_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  private readonly PROMPT_MAX_USAGE = 100;
  private readonly MIN_PROMPT_SCORE = 0.6;

  private extractTaskPattern(homework: UlysseHomework): string {
    const title = homework.title.toLowerCase();
    if (title.includes("recherche") || title.includes("cherche")) return "research";
    if (title.includes("http") || title.includes("www") || title.includes(".com")) return "url_fetch";
    if (title.includes("email") || title.includes("mail")) return "email";
    if (title.includes("rappel") || title.includes("reminder")) return "reminder";
    if (title.includes("analyse") || title.includes("analyze")) return "analysis";
    return "generic";
  }

  async getOrGenerateOptimizedPrompt(
    homework: UlysseHomework,
    taskType: "research" | "url_fetch" | "generic",
    personaName: string,
    generateFn: () => Promise<string>
  ): Promise<string> {
    const pattern = this.extractTaskPattern(homework);
    const cacheKey = `${taskType}_${pattern}_${personaName}`;
    const cached = this.promptCache.get(cacheKey);
    
    const now = new Date();
    if (cached) {
      const age = now.getTime() - cached.createdAt.getTime();
      if (age < this.PROMPT_CACHE_MAX_AGE_MS && 
          cached.score >= this.MIN_PROMPT_SCORE && 
          cached.usageCount < this.PROMPT_MAX_USAGE) {
        cached.usageCount++;
        console.log(`[HomeworkIntelligence] Using cached prompt for ${cacheKey} (score: ${cached.score.toFixed(2)}, uses: ${cached.usageCount})`);
        return cached.prompt;
      }
    }
    
    const newPrompt = await generateFn();
    this.promptCache.set(cacheKey, {
      prompt: newPrompt,
      score: 0.7,
      usageCount: 1,
      createdAt: now,
      successRate: 1.0
    });
    
    console.log(`[HomeworkIntelligence] Generated new prompt for ${cacheKey}`);
    return newPrompt;
  }

  async updatePromptScore(
    homework: UlysseHomework,
    taskType: "research" | "url_fetch" | "generic",
    personaName: string,
    success: boolean,
    qualityIndicators: { responseLength: number; hasStructure: boolean; completedFast: boolean }
  ): Promise<void> {
    const pattern = this.extractTaskPattern(homework);
    const cacheKey = `${taskType}_${pattern}_${personaName}`;
    const cached = this.promptCache.get(cacheKey);
    
    if (!cached) return;
    
    let qualityScore = success ? 0.5 : 0;
    if (qualityIndicators.responseLength > 200) qualityScore += 0.15;
    if (qualityIndicators.hasStructure) qualityScore += 0.2;
    if (qualityIndicators.completedFast) qualityScore += 0.15;
    
    const alpha = 0.3;
    cached.score = cached.score * (1 - alpha) + qualityScore * alpha;
    cached.successRate = (cached.successRate * (cached.usageCount - 1) + (success ? 1 : 0)) / cached.usageCount;
    
    console.log(`[HomeworkIntelligence] Updated prompt score for ${cacheKey}: ${cached.score.toFixed(2)} (success rate: ${(cached.successRate * 100).toFixed(0)}%)`);
  }

  async detectUrgency(homework: UlysseHomework): Promise<"low" | "normal" | "high" | "critical"> {
    const content = `${homework.title} ${homework.description || ""}`.toLowerCase();
    
    const criticalKeywords = ["urgent", "immédiat", "asap", "critique", "deadline aujourd'hui"];
    const highKeywords = ["important", "priorité", "bientôt", "deadline", "échéance"];
    const lowKeywords = ["optionnel", "quand possible", "pas pressé", "un jour"];
    
    if (criticalKeywords.some(k => content.includes(k))) return "critical";
    if (highKeywords.some(k => content.includes(k))) return "high";
    if (lowKeywords.some(k => content.includes(k))) return "low";
    
    const recentFailures = await this.getRecentFailureCount(homework.id);
    if (recentFailures >= 2) return "high";
    
    return "normal";
  }

  async shouldExecuteNow(
    homework: UlysseHomework,
    conditions?: SmartRecurrenceConditions
  ): Promise<{ execute: boolean; reason: string }> {
    const now = new Date();
    const currentHour = now.getHours();
    
    if (conditions?.timeWindow) {
      const { start, end } = conditions.timeWindow;
      if (currentHour < start || currentHour > end) {
        return { execute: false, reason: `Hors fenêtre horaire (${start}h-${end}h)` };
      }
    }
    
    if (conditions?.maxRetries) {
      const recentFailures = await this.getRecentFailureCount(homework.id);
      if (recentFailures >= conditions.maxRetries) {
        return { execute: false, reason: `Max retries atteint (${recentFailures}/${conditions.maxRetries})` };
      }
    }
    
    if (conditions?.minIntervalHours && homework.lastExecutedAt) {
      const lastExec = new Date(homework.lastExecutedAt);
      const hoursSince = (now.getTime() - lastExec.getTime()) / (1000 * 60 * 60);
      if (hoursSince < conditions.minIntervalHours) {
        return { execute: false, reason: `Intervalle minimum non atteint (${hoursSince.toFixed(1)}h/${conditions.minIntervalHours}h)` };
      }
    }
    
    const urgency = await this.detectUrgency(homework);
    if (urgency === "critical") {
      return { execute: true, reason: "Tâche critique - exécution immédiate" };
    }
    
    return { execute: true, reason: "Conditions remplies" };
  }

  private async getRecentFailureCount(homeworkId: number): Promise<number> {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const failures = await db.select({ count: sql<number>`count(*)` })
      .from(homeworkExecution)
      .where(and(
        eq(homeworkExecution.homeworkId, homeworkId),
        eq(homeworkExecution.status, "failed"),
        gte(homeworkExecution.startedAt, oneDayAgo)
      ));
    
    return Number(failures[0]?.count || 0);
  }

  categorizeError(error: Error | string): string {
    const errorStr = typeof error === "string" ? error : error.message;
    const errorLower = errorStr.toLowerCase();
    
    if (errorLower.includes("rate limit") || errorLower.includes("429")) return "rate_limit";
    if (errorLower.includes("timeout") || errorLower.includes("timed out")) return "timeout";
    if (errorLower.includes("network") || errorLower.includes("econnrefused")) return "network";
    if (errorLower.includes("unauthorized") || errorLower.includes("401")) return "auth";
    if (errorLower.includes("not found") || errorLower.includes("404")) return "not_found";
    if (errorLower.includes("blocked") || errorLower.includes("forbidden")) return "blocked";
    if (errorLower.includes("json") || errorLower.includes("parse")) return "parse_error";
    return "unknown";
  }

  suggestFix(errorType: string): string {
    const fixes: Record<string, string> = {
      rate_limit: "Augmenter l'intervalle entre les exécutions ou utiliser un fallback",
      timeout: "Réduire la complexité de la tâche ou augmenter le timeout",
      network: "Vérifier la connectivité réseau, réessayer plus tard",
      auth: "Vérifier les clés API et tokens d'authentification",
      not_found: "Vérifier l'URL ou la ressource demandée",
      blocked: "Le site bloque les requêtes automatiques, essayer Perplexity fallback",
      parse_error: "Le format de réponse est invalide, ajuster le prompt",
      unknown: "Analyser les logs pour identifier la cause"
    };
    return fixes[errorType] || fixes.unknown;
  }

  async recordFailure(
    homework: UlysseHomework,
    error: Error | string,
    execution: HomeworkExecution
  ): Promise<void> {
    const errorType = this.categorizeError(error);
    const pattern = this.extractTaskPattern(homework);
    const key = `${errorType}_${pattern}`;
    
    const existing = this.failurePatterns.get(key);
    if (existing) {
      existing.count++;
      existing.lastOccurred = new Date();
      if (!existing.taskTypes.includes(homework.title)) {
        existing.taskTypes.push(homework.title.substring(0, 50));
      }
    } else {
      this.failurePatterns.set(key, {
        errorType,
        count: 1,
        lastOccurred: new Date(),
        suggestedFix: this.suggestFix(errorType),
        taskTypes: [homework.title.substring(0, 50)]
      });
    }
    
    console.log(`[HomeworkIntelligence] Recorded failure pattern: ${key} (count: ${this.failurePatterns.get(key)?.count})`);
    
    if (this.failurePatterns.get(key)!.count >= 3) {
      await this.triggerAutoAdjustment(homework, errorType);
    }
  }

  private async triggerAutoAdjustment(homework: UlysseHomework, errorType: string): Promise<void> {
    console.log(`[HomeworkIntelligence] Auto-adjusting homework ${homework.id} due to repeated ${errorType} failures`);
    
    if (errorType === "rate_limit" && homework.recurrence === "hourly") {
      await db.update(ulysseHomework)
        .set({ 
          recurrence: "daily",
          notes: `${homework.notes || ""}\n[Auto-ajusté: hourly->daily cause rate limits]`
        })
        .where(eq(ulysseHomework.id, homework.id));
      console.log(`[HomeworkIntelligence] Adjusted recurrence: hourly -> daily`);
    }
    
    if (errorType === "blocked" || errorType === "not_found") {
      await db.update(ulysseHomework)
        .set({ 
          status: "paused",
          notes: `${homework.notes || ""}\n[Pausé automatiquement: ${errorType}]`
        })
        .where(eq(ulysseHomework.id, homework.id));
      console.log(`[HomeworkIntelligence] Paused homework due to ${errorType}`);
    }
  }

  startExecution(executionId: number): void {
    this.executionStats.set(executionId, {
      startTime: new Date(),
      tokensUsed: 0
    });
  }

  recordTokenUsage(executionId: number, tokens: number): void {
    const stats = this.executionStats.get(executionId);
    if (stats) {
      stats.tokensUsed += tokens;
    }
  }

  async endExecution(executionId: number, success: boolean): Promise<{ durationMs: number; tokensUsed: number } | null> {
    const stats = this.executionStats.get(executionId);
    if (!stats) return null;
    
    const durationMs = Date.now() - stats.startTime.getTime();
    this.executionStats.delete(executionId);
    
    return { durationMs, tokensUsed: stats.tokensUsed };
  }

  async getExecutionMetrics(userId: number, days: number = 7): Promise<ExecutionMetrics> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    const executions = await db.select()
      .from(homeworkExecution)
      .where(and(
        eq(homeworkExecution.userId, userId),
        gte(homeworkExecution.startedAt, since)
      ));
    
    const total = executions.length;
    const successful = executions.filter(e => e.status === "completed").length;
    const successRate = total > 0 ? successful / total : 0;
    
    const durations = executions
      .filter(e => e.completedAt && e.startedAt)
      .map(e => new Date(e.completedAt!).getTime() - new Date(e.startedAt!).getTime());
    const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    
    const hourCounts = new Map<number, number>();
    executions.filter(e => e.status === "completed" && e.startedAt).forEach(e => {
      const hour = new Date(e.startedAt!).getHours();
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    });
    
    const sortedHours = Array.from(hourCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([hour]) => hour);
    
    return {
      totalExecutions: total,
      successRate,
      avgDurationMs: avgDuration,
      failurePatterns: Array.from(this.failurePatterns.values()),
      bestExecutionHours: sortedHours
    };
  }

  async generateWeeklyInsights(userId: number): Promise<string> {
    const metrics = await this.getExecutionMetrics(userId, 7);
    
    if (metrics.totalExecutions === 0) {
      return "Aucune tâche exécutée cette semaine.";
    }
    
    const completedTasks = await db.select()
      .from(homeworkExecution)
      .where(and(
        eq(homeworkExecution.userId, userId),
        eq(homeworkExecution.status, "completed"),
        gte(homeworkExecution.startedAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
      ))
      .orderBy(desc(homeworkExecution.completedAt))
      .limit(10);
    
    let insights = `📊 **Synthèse Hebdomadaire des Tâches**\n\n`;
    insights += `• ${metrics.totalExecutions} tâches exécutées\n`;
    insights += `• Taux de réussite: ${(metrics.successRate * 100).toFixed(0)}%\n`;
    insights += `• Durée moyenne: ${(metrics.avgDurationMs / 1000).toFixed(1)}s\n`;
    
    if (metrics.bestExecutionHours.length > 0) {
      insights += `• Meilleures heures: ${metrics.bestExecutionHours.map(h => `${h}h`).join(", ")}\n`;
    }
    
    if (metrics.failurePatterns.length > 0) {
      insights += `\n⚠️ **Problèmes détectés:**\n`;
      metrics.failurePatterns.slice(0, 3).forEach(p => {
        insights += `• ${p.errorType}: ${p.count}x - ${p.suggestedFix}\n`;
      });
    }
    
    if (completedTasks.length > 0) {
      insights += `\n✅ **Dernières réussites:**\n`;
      completedTasks.slice(0, 5).forEach(t => {
        const summary = t.resultSummary?.substring(0, 60) || "Tâche complétée";
        insights += `• ${summary}...\n`;
      });
    }
    
    if (canMakeCall("combined")) {
      try {
        const aiInsights = await withRateLimit("combined", () =>
          openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: "Tu es Ulysse. Analyse ces métriques et donne 2-3 recommandations courtes pour améliorer l'efficacité des tâches automatiques."
              },
              {
                role: "user",
                content: `Métriques: ${JSON.stringify(metrics)}\n\nDonne des recommandations pratiques.`
              }
            ],
            temperature: 0.5,
            max_tokens: 200
          }),
          0
        );
        
        const recommendations = aiInsights.choices[0].message.content;
        if (recommendations) {
          insights += `\n💡 **Recommandations:**\n${recommendations}`;
        }
      } catch (error) {
        console.error("[HomeworkIntelligence] Failed to generate AI insights:", error);
      }
    }
    
    return insights;
  }

  getPromptCacheStats(): { size: number; avgScore: number; totalUsage: number } {
    let totalScore = 0;
    let totalUsage = 0;
    
    this.promptCache.forEach(cached => {
      totalScore += cached.score;
      totalUsage += cached.usageCount;
    });
    
    return {
      size: this.promptCache.size,
      avgScore: this.promptCache.size > 0 ? totalScore / this.promptCache.size : 0,
      totalUsage
    };
  }

  clearOldCaches(): void {
    const now = Date.now();
    let cleared = 0;
    
    this.promptCache.forEach((cached, key) => {
      if (now - cached.createdAt.getTime() > this.PROMPT_CACHE_MAX_AGE_MS) {
        this.promptCache.delete(key);
        cleared++;
      }
    });
    
    const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    this.failurePatterns.forEach((pattern, key) => {
      if (pattern.lastOccurred < oneWeekAgo) {
        this.failurePatterns.delete(key);
        cleared++;
      }
    });
    
    if (cleared > 0) {
      console.log(`[HomeworkIntelligence] Cleared ${cleared} old cache entries`);
    }
  }
}

export const homeworkIntelligence = new HomeworkIntelligenceService();
