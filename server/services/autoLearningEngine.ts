/**
 * AUTO-LEARNING ENGINE V1
 * 
 * Moteur d'apprentissage autonome pour Ulysse.
 * Responsabilités:
 * - Observer chaque interaction et en extraire des apprentissages
 * - Détecter les patterns de succès et d'échec
 * - Mémoriser automatiquement les faits importants
 * - Améliorer les stratégies d'utilisation des outils
 * - Fournir un prompt d'auto-apprentissage à injecter dans le contexte
 */

import { brainHub, type WorkingMemoryItem } from './sensory/BrainHub';

export interface LearningEntry {
  id: string;
  domain: string;
  type: "success_pattern" | "failure_lesson" | "fact_learned" | "preference_detected" | "strategy_optimized" | "tool_performance";
  content: string;
  source: string;
  confidence: number;
  createdAt: number;
  usageCount: number;
  lastUsedAt: number;
}

export interface ToolPerformance {
  toolName: string;
  totalCalls: number;
  successCount: number;
  avgResponseTimeMs: number;
  lastError?: string;
  bestCombinations: string[];
}

export interface LearningStats {
  totalEntries: number;
  byDomain: Record<string, number>;
  byType: Record<string, number>;
  topPatterns: LearningEntry[];
  toolPerformance: ToolPerformance[];
  learningVelocity: number;
}

class AutoLearningEngine {
  private learnings: Map<string, LearningEntry> = new Map();
  private toolMetrics: Map<string, ToolPerformance> = new Map();
  private maxEntries = 500;
  private interactionCount = 0;

  constructor() {
    console.log("[AutoLearningEngine] Moteur d'apprentissage autonome initialisé");
  }

  recordInteraction(data: {
    query: string;
    toolsUsed: string[];
    success: boolean;
    responseTimeMs: number;
    domain?: string;
  }): void {
    this.interactionCount++;

    for (const tool of data.toolsUsed) {
      this.updateToolPerformance(tool, data.success, data.responseTimeMs);
    }

    if (data.toolsUsed.length > 1) {
      this.learnToolCombination(data.toolsUsed, data.success);
    }

    if (!data.success && data.toolsUsed.length > 0) {
      this.recordFailure(data.query, data.toolsUsed, data.domain || "general");
    }
  }

  recordFact(fact: string, source: string, domain: string, confidence: number = 0.8): void {
    const id = `fact_${this.hashString(fact)}`;

    if (this.learnings.has(id)) {
      const existing = this.learnings.get(id)!;
      existing.usageCount++;
      existing.lastUsedAt = Date.now();
      existing.confidence = Math.min(1, existing.confidence + 0.05);
      return;
    }

    this.addLearning({
      id,
      domain,
      type: "fact_learned",
      content: fact,
      source,
      confidence,
      createdAt: Date.now(),
      usageCount: 1,
      lastUsedAt: Date.now()
    });
  }

  recordPreference(preference: string, userId: number): void {
    const id = `pref_${userId}_${this.hashString(preference)}`;

    this.addLearning({
      id,
      domain: "preferences",
      type: "preference_detected",
      content: preference,
      source: `user_${userId}`,
      confidence: 0.7,
      createdAt: Date.now(),
      usageCount: 1,
      lastUsedAt: Date.now()
    });
  }

  recordStrategySuccess(strategy: string, context: string, tools: string[]): void {
    const id = `strategy_${this.hashString(strategy)}`;

    if (this.learnings.has(id)) {
      const existing = this.learnings.get(id)!;
      existing.usageCount++;
      existing.lastUsedAt = Date.now();
      existing.confidence = Math.min(1, existing.confidence + 0.1);
      return;
    }

    this.addLearning({
      id,
      domain: "strategies",
      type: "strategy_optimized",
      content: `${strategy} (outils: ${tools.join(' + ')}) → Contexte: ${context}`,
      source: "auto_learning",
      confidence: 0.6,
      createdAt: Date.now(),
      usageCount: 1,
      lastUsedAt: Date.now()
    });
  }

  private updateToolPerformance(toolName: string, success: boolean, responseTimeMs: number): void {
    let perf = this.toolMetrics.get(toolName);
    if (!perf) {
      perf = {
        toolName,
        totalCalls: 0,
        successCount: 0,
        avgResponseTimeMs: 0,
        bestCombinations: []
      };
      this.toolMetrics.set(toolName, perf);
    }

    perf.totalCalls++;
    if (success) perf.successCount++;
    perf.avgResponseTimeMs = ((perf.avgResponseTimeMs * (perf.totalCalls - 1)) + responseTimeMs) / perf.totalCalls;
  }

  private learnToolCombination(tools: string[], success: boolean): void {
    if (!success) return;

    const combinationKey = tools.sort().join('+');
    for (const tool of tools) {
      const perf = this.toolMetrics.get(tool);
      if (perf && !perf.bestCombinations.includes(combinationKey)) {
        perf.bestCombinations.push(combinationKey);
        if (perf.bestCombinations.length > 5) {
          perf.bestCombinations.shift();
        }
      }
    }
  }

  getHomeworkSuggestions(): string[] {
    const suggestions: string[] = [];
    const entries = Array.from(this.learnings.values());
    
    const domainCounts: Record<string, number> = {};
    for (const entry of entries) {
      domainCounts[entry.domain] = (domainCounts[entry.domain] || 0) + 1;
    }
    
    const weakDomains = Object.entries(domainCounts)
      .filter(([_, count]) => count >= 3)
      .map(([domain]) => domain);
    
    const failedTools = entries
      .filter(e => e.type === "failure_lesson" && e.usageCount >= 2)
      .map(e => e.content);
    
    if (failedTools.length > 0) {
      suggestions.push(`HOMEWORK SUGGÉRÉ: Créer un homework d'auto-diagnostic pour les outils qui échouent souvent: ${failedTools.slice(0, 3).join(', ')}`);
    }
    
    for (const [toolName, perf] of this.toolMetrics.entries()) {
      if (perf.totalCalls >= 5 && (perf.successCount / perf.totalCalls) < 0.5) {
        suggestions.push(`HOMEWORK SUGGÉRÉ: L'outil ${toolName} a un taux de succès de ${Math.round((perf.successCount / perf.totalCalls) * 100)}% — explorer des stratégies alternatives ou des combinaisons d'outils.`);
      }
    }
    
    const successPatterns = entries
      .filter(e => e.type === "success_pattern" && e.usageCount >= 3)
      .slice(0, 3);
    for (const pattern of successPatterns) {
      suggestions.push(`HOMEWORK SUGGÉRÉ: Automatiser le pattern récurrent "${pattern.content.substring(0, 80)}" en homework permanent.`);
    }
    
    return suggestions;
  }

  private recordFailure(query: string, tools: string[], domain: string): void {
    const id = `fail_${this.hashString(query.substring(0, 50))}`;

    this.addLearning({
      id,
      domain,
      type: "failure_lesson",
      content: `Échec avec ${tools.join(' + ')} pour "${query.substring(0, 80)}"`,
      source: "auto_learning",
      confidence: 0.5,
      createdAt: Date.now(),
      usageCount: 1,
      lastUsedAt: Date.now()
    });
  }

  private addLearning(entry: LearningEntry): void {
    this.learnings.set(entry.id, entry);

    if (this.learnings.size > this.maxEntries) {
      const sorted = Array.from(this.learnings.entries())
        .sort((a, b) => {
          const scoreA = a[1].confidence * a[1].usageCount;
          const scoreB = b[1].confidence * b[1].usageCount;
          return scoreA - scoreB;
        });

      const toRemove = sorted.slice(0, Math.floor(this.maxEntries * 0.1));
      for (const [key] of toRemove) {
        this.learnings.delete(key);
      }
    }

    brainHub.addToWorkingMemory({
      type: 'thought',
      content: `[Learning] ${entry.type}: ${entry.content.substring(0, 100)}`,
      source: 'auto_learning',
      timestamp: new Date(),
      importance: entry.confidence * 100,
      ttlMs: 10 * 60 * 1000
    });
  }

  getStats(): LearningStats {
    const entries = Array.from(this.learnings.values());
    const byDomain: Record<string, number> = {};
    const byType: Record<string, number> = {};

    for (const entry of entries) {
      byDomain[entry.domain] = (byDomain[entry.domain] || 0) + 1;
      byType[entry.type] = (byType[entry.type] || 0) + 1;
    }

    const topPatterns = entries
      .sort((a, b) => (b.confidence * b.usageCount) - (a.confidence * a.usageCount))
      .slice(0, 10);

    return {
      totalEntries: entries.length,
      byDomain,
      byType,
      topPatterns,
      toolPerformance: Array.from(this.toolMetrics.values()),
      learningVelocity: this.interactionCount > 0 ? entries.length / this.interactionCount : 0
    };
  }

  generateLearningPrompt(): string {
    const stats = this.getStats();

    if (stats.totalEntries === 0) {
      return `\n## AUTO-APPRENTISSAGE\nMode: Initialisation - Aucun apprentissage enregistré. Commence à apprendre dès cette interaction.\n`;
    }

    const topLessons = stats.topPatterns
      .filter(p => p.confidence > 0.6)
      .slice(0, 5)
      .map(p => `• [${p.domain}] ${p.content.substring(0, 120)} (confiance: ${Math.round(p.confidence * 100)}%)`)
      .join('\n');

    const toolInsights = stats.toolPerformance
      .filter(t => t.totalCalls >= 3)
      .sort((a, b) => b.totalCalls - a.totalCalls)
      .slice(0, 5)
      .map(t => {
        const rate = t.totalCalls > 0 ? Math.round((t.successCount / t.totalCalls) * 100) : 0;
        return `• ${t.toolName}: ${rate}% succès (${t.totalCalls} appels, ${Math.round(t.avgResponseTimeMs)}ms)`;
      })
      .join('\n');

    const failureLessons = Array.from(this.learnings.values())
      .filter(l => l.type === "failure_lesson")
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 3)
      .map(l => `⚠️ ${l.content.substring(0, 100)}`)
      .join('\n');

    return `
## 🧠 AUTO-APPRENTISSAGE (${stats.totalEntries} entrées, vélocité: ${stats.learningVelocity.toFixed(2)})

### Patterns appris les plus fiables:
${topLessons || "Pas encore assez de données"}

### Performance des outils:
${toolInsights || "Métriques en cours de collecte"}

${failureLessons ? `### Leçons d'échecs récents:\n${failureLessons}` : ""}

${(() => {
      const hw = this.getHomeworkSuggestions();
      return hw.length > 0 ? `### 🎯 Suggestions d'auto-amélioration:\n${hw.join('\n')}\nSi pertinent, propose à Maurice de créer ces homework ou exécute-les automatiquement.` : "";
    })()}

📌 RAPPEL: Après cette interaction, mémoriser ce qui a fonctionné/échoué. Si un pattern se répète 3+ fois, créer un homework pour l'automatiser.
`;

  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }
}

export const autoLearningEngine = new AutoLearningEngine();
