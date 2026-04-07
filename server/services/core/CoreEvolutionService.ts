import { db } from "../../db";
import { eq, sql, and, desc, gte } from "drizzle-orm";
import { knowledgeBase, learningLog } from "@shared/schema";

interface Interaction {
  request: string;
  response: string;
  source: 'cache' | 'pattern' | 'learned' | 'provider';
  latencyMs: number;
  userId: number;
  feedback?: 'positive' | 'negative' | 'neutral';
}

interface EvolutionMetrics {
  totalInteractions: number;
  localProcessingRate: number;
  avgLatency: number;
  learningVelocity: number;
  patternCoverage: number;
  autonomyScore: number;
}

interface EvolutionReport {
  learningProgress: number;
  patternsDiscovered: number;
  autonomyLevel: number;
  recommendations: string[];
}

export class CoreEvolutionService {
  private interactions: Interaction[] = [];
  private readonly MAX_INTERACTIONS = 1000;
  private evolutionCheckpoints: Array<{ timestamp: number; metrics: EvolutionMetrics }> = [];
  private readonly CHECKPOINT_INTERVAL = 3600000;
  private lastCheckpoint = 0;

  constructor() {
    console.log('[CoreEvolution] Service initialized');
  }

  async recordInteraction(interaction: Interaction): Promise<void> {
    this.interactions.push(interaction);

    if (this.interactions.length > this.MAX_INTERACTIONS) {
      this.interactions = this.interactions.slice(-this.MAX_INTERACTIONS);
    }

    if (Date.now() - this.lastCheckpoint > this.CHECKPOINT_INTERVAL) {
      await this.createCheckpoint();
    }

    if (interaction.source !== 'provider' && interaction.latencyMs < 100) {
      await this.reinforceLocalProcessing(interaction);
    }
  }

  async recordFeedback(requestHash: string, feedback: 'positive' | 'negative' | 'neutral'): Promise<void> {
    const recentInteraction = this.interactions.find(i => 
      this.hashRequest(i.request) === requestHash
    );

    if (recentInteraction) {
      recentInteraction.feedback = feedback;

      if (feedback === 'negative' && recentInteraction.source !== 'provider') {
        console.log('[CoreEvolution] Negative feedback on local response - marking for re-learning');
      }

      if (feedback === 'positive' && recentInteraction.source === 'provider') {
        await this.prioritizeLearning(recentInteraction);
      }
    }
  }

  async getEvolutionReport(): Promise<EvolutionReport> {
    const metrics = this.calculateMetrics();
    const recommendations = this.generateRecommendations(metrics);

    const learnedCount = await this.countLearnedResponses();
    const patternCount = await this.countDiscoveredPatterns();

    const autonomyLevel = Math.min(100, Math.round(
      (metrics.localProcessingRate * 40) +
      (Math.min(learnedCount / 100, 1) * 30) +
      (Math.min(patternCount / 50, 1) * 20) +
      (metrics.avgLatency < 200 ? 10 : 0)
    ));

    return {
      learningProgress: Math.round(metrics.learningVelocity * 100),
      patternsDiscovered: patternCount,
      autonomyLevel,
      recommendations
    };
  }

  private calculateMetrics(): EvolutionMetrics {
    if (this.interactions.length === 0) {
      return {
        totalInteractions: 0,
        localProcessingRate: 0,
        avgLatency: 0,
        learningVelocity: 0,
        patternCoverage: 0,
        autonomyScore: 0
      };
    }

    const localCount = this.interactions.filter(i => 
      i.source === 'cache' || i.source === 'pattern' || i.source === 'learned'
    ).length;

    const totalLatency = this.interactions.reduce((sum, i) => sum + i.latencyMs, 0);

    const recentInteractions = this.interactions.slice(-100);
    const recentLocalRate = recentInteractions.filter(i => i.source !== 'provider').length / recentInteractions.length;
    const oldInteractions = this.interactions.slice(0, 100);
    const oldLocalRate = oldInteractions.length > 0 
      ? oldInteractions.filter(i => i.source !== 'provider').length / oldInteractions.length 
      : 0;
    const learningVelocity = Math.max(0, recentLocalRate - oldLocalRate);

    const uniquePatterns = new Set(
      this.interactions
        .filter(i => i.source === 'pattern')
        .map(i => this.extractPatternSignature(i.request))
    ).size;

    return {
      totalInteractions: this.interactions.length,
      localProcessingRate: localCount / this.interactions.length,
      avgLatency: totalLatency / this.interactions.length,
      learningVelocity,
      patternCoverage: Math.min(uniquePatterns / 100, 1),
      autonomyScore: (localCount / this.interactions.length) * 100
    };
  }

  private generateRecommendations(metrics: EvolutionMetrics): string[] {
    const recommendations: string[] = [];

    if (metrics.localProcessingRate < 0.3) {
      recommendations.push('Augmenter le seuil de similarité pour capturer plus de patterns');
    }

    if (metrics.avgLatency > 500) {
      recommendations.push('Optimiser le cache et les recherches de patterns');
    }

    if (metrics.learningVelocity < 0.01) {
      recommendations.push('Analyser les requêtes fréquentes pour créer de nouveaux patterns');
    }

    if (metrics.patternCoverage < 0.2) {
      recommendations.push('Enrichir la base de patterns avec les requêtes utilisateur');
    }

    const providerInteractions = this.interactions.filter(i => i.source === 'provider');
    if (providerInteractions.length > 0) {
      const requestTypes = this.analyzeRequestTypes(providerInteractions);
      if (requestTypes.frequent.length > 0) {
        recommendations.push(`Créer des patterns pour: ${requestTypes.frequent.slice(0, 3).join(', ')}`);
      }
    }

    if (recommendations.length === 0) {
      recommendations.push('Le système évolue correctement. Continuer la collecte de données.');
    }

    return recommendations;
  }

  private analyzeRequestTypes(interactions: Interaction[]): { frequent: string[] } {
    const typeCount: Record<string, number> = {};
    
    for (const interaction of interactions) {
      const signature = this.extractPatternSignature(interaction.request);
      typeCount[signature] = (typeCount[signature] || 0) + 1;
    }

    const sorted = Object.entries(typeCount)
      .sort((a, b) => b[1] - a[1])
      .filter(([_, count]) => count >= 3)
      .map(([type]) => type);

    return { frequent: sorted };
  }

  private extractPatternSignature(input: string): string {
    const stopWords = ['le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'et', 'ou', 'que', 'qui'];
    
    return input.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.includes(w))
      .slice(0, 3)
      .sort()
      .join('_');
  }

  private hashRequest(request: string): string {
    let hash = 0;
    for (let i = 0; i < request.length; i++) {
      const char = request.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  private async createCheckpoint(): Promise<void> {
    const metrics = this.calculateMetrics();
    
    this.evolutionCheckpoints.push({
      timestamp: Date.now(),
      metrics
    });

    if (this.evolutionCheckpoints.length > 24) {
      this.evolutionCheckpoints = this.evolutionCheckpoints.slice(-24);
    }

    this.lastCheckpoint = Date.now();
    console.log('[CoreEvolution] Checkpoint created:', {
      autonomyScore: metrics.autonomyScore.toFixed(1) + '%',
      localRate: (metrics.localProcessingRate * 100).toFixed(1) + '%',
      avgLatency: metrics.avgLatency.toFixed(0) + 'ms'
    });
  }

  private async reinforceLocalProcessing(interaction: Interaction): Promise<void> {
    try {
      await db.insert(learningLog).values({
        userId: interaction.userId,
        topic: this.extractPatternSignature(interaction.request),
        content: `Local processing success: ${interaction.source}`,
        learningType: 'reinforcement',
        sourceType: 'core_evolution',
        confidence: 0.9,
        metadata: {
          source: interaction.source,
          latencyMs: interaction.latencyMs,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
    }
  }

  private async prioritizeLearning(interaction: Interaction): Promise<void> {
    console.log('[CoreEvolution] Prioritizing learning for positive feedback response');
  }

  private async countLearnedResponses(): Promise<number> {
    try {
      const result = await db.select({ count: sql<number>`count(*)` })
        .from(knowledgeBase)
        .where(eq(knowledgeBase.type, 'learned_response'));
      return result[0]?.count || 0;
    } catch {
      return 0;
    }
  }

  private async countDiscoveredPatterns(): Promise<number> {
    try {
      const result = await db.select({ count: sql<number>`count(*)` })
        .from(knowledgeBase)
        .where(eq(knowledgeBase.type, 'discovered_pattern'));
      return result[0]?.count || 0;
    } catch {
      return 0;
    }
  }

  getEvolutionTrend(): { direction: 'improving' | 'stable' | 'declining'; details: string } {
    if (this.evolutionCheckpoints.length < 2) {
      return { direction: 'stable', details: 'Pas assez de données pour déterminer la tendance' };
    }

    const recent = this.evolutionCheckpoints.slice(-3);
    const older = this.evolutionCheckpoints.slice(-6, -3);

    if (older.length === 0) {
      return { direction: 'stable', details: 'Collecte de données en cours' };
    }

    const recentAvg = recent.reduce((sum, c) => sum + c.metrics.autonomyScore, 0) / recent.length;
    const olderAvg = older.reduce((sum, c) => sum + c.metrics.autonomyScore, 0) / older.length;

    const diff = recentAvg - olderAvg;

    if (diff > 5) {
      return { 
        direction: 'improving', 
        details: `Autonomie en hausse de ${diff.toFixed(1)}% sur les dernières heures` 
      };
    } else if (diff < -5) {
      return { 
        direction: 'declining', 
        details: `Autonomie en baisse de ${Math.abs(diff).toFixed(1)}% - analyse recommandée` 
      };
    }

    return { 
      direction: 'stable', 
      details: `Autonomie stable autour de ${recentAvg.toFixed(1)}%` 
    };
  }

  getStats(): {
    interactionCount: number;
    checkpointCount: number;
    currentMetrics: EvolutionMetrics;
    trend: ReturnType<typeof this.getEvolutionTrend>;
  } {
    return {
      interactionCount: this.interactions.length,
      checkpointCount: this.evolutionCheckpoints.length,
      currentMetrics: this.calculateMetrics(),
      trend: this.getEvolutionTrend()
    };
  }
}
