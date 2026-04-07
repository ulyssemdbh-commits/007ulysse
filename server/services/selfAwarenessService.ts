/**
 * SelfAwarenessService - Ulysse's self-diagnostic capabilities
 * 
 * Allows Ulysse to check system health before responding,
 * adapt tone based on degraded services, and provide accurate
 * information about his own capabilities.
 */

import { db } from "../db";
import { sql, count, eq, gte, desc } from "drizzle-orm";
import { knowledgeBase, actualBets, ulysseHomework, systemDiagnostics } from "@shared/schema";

const SYSTEM_STATUS_SECRET = process.env.SYSTEM_STATUS_SECRET;

export type ComponentName = 
  | 'database' 
  | 'openai' 
  | 'gemini'
  | 'agentmail' 
  | 'calendar' 
  | 'todoist' 
  | 'notion'
  | 'drive'
  | 'spotify'
  | 'sports' 
  | 'stocks'
  | 'brain'
  | 'websocket';

export type ServiceStatus = 'operational' | 'degraded' | 'down' | 'unknown';

interface ComponentHealth {
  status: ServiceStatus;
  latencyMs?: number;
  lastCheck?: string;
  details?: string;
}

interface SystemSummary {
  status: 'healthy' | 'degraded' | 'critical';
  healthScore: number;
  uptime: number;
  degradedComponents: string[];
  downComponents: string[];
  timestamp: string;
}

interface BrainStats {
  totalKnowledge: number;
  byDomain: {
    sports: number;
    trading: number;
    sugu: number;
    dev: number;
    personal: number;
  };
  avgConfidence: number;
  avgImportance: number;
  highImportance: number;
}

interface PronosStats {
  roiOverall: number;
  winrateOverall: number;
  totalBets: number;
  recentPerformance: 'excellent' | 'good' | 'average' | 'poor' | 'unknown';
}

// ========================================
// PALIER 2 & 3: ClarityScore + Intent-based checking
// ========================================

export type ClarityMode = 'normal' | 'cautious' | 'limited';

export type IntentType = 
  | 'sports' | 'pronos' | 'betting'
  | 'email' | 'emails'
  | 'calendar' | 'planning' | 'rdv'
  | 'tasks' | 'todo' | 'todoist'
  | 'sugu' | 'restaurant' | 'stock'
  | 'dev' | 'code' | 'debug'
  | 'music' | 'spotify'
  | 'files' | 'drive' | 'notion'
  | 'trading' | 'stocks' | 'crypto'
  | 'weather' | 'meteo'
  | 'general';

interface ClarityScore {
  score: number;
  mode: ClarityMode;
  factors: {
    healthScore: number;
    criticalServicesUp: boolean;
    brainHealth: number;
    recentErrors: number;
  };
  recommendation: string;
}

interface ContextFlags {
  isSportsDegraded: boolean;
  isEmailDown: boolean;
  isCalendarDown: boolean;
  isBrainWeak: boolean;
  isSuguDegraded: boolean;
  isStocksDegraded: boolean;
  clarityMode: ClarityMode;
  warnings: string[];
}

interface IntentCheck {
  intent: IntentType;
  componentsToCheck: ComponentName[];
  contextFlags: ContextFlags;
  canProceed: boolean;
  adaptiveMessage?: string;
}

class SelfAwarenessService {
  private cache: Map<string, { data: any; expiresAt: number }> = new Map();
  private readonly CACHE_TTL = 30000; // 30 seconds

  /**
   * Get quick system summary
   */
  async getSummary(): Promise<SystemSummary> {
    const cached = this.getFromCache('summary');
    if (cached) return cached;

    try {
      const components = await this.checkAllComponents();
      
      const degradedComponents = Object.entries(components)
        .filter(([_, health]) => health.status === 'degraded')
        .map(([name]) => name);
      
      const downComponents = Object.entries(components)
        .filter(([_, health]) => health.status === 'down')
        .map(([name]) => name);

      const healthScore = this.calculateHealthScore(components);
      
      const summary: SystemSummary = {
        status: healthScore >= 80 ? 'healthy' : healthScore >= 50 ? 'degraded' : 'critical',
        healthScore,
        uptime: Math.floor(process.uptime()),
        degradedComponents,
        downComponents,
        timestamp: new Date().toISOString()
      };

      this.setCache('summary', summary);
      return summary;
    } catch (error) {
      return {
        status: 'critical',
        healthScore: 0,
        uptime: 0,
        degradedComponents: [],
        downComponents: ['unknown'],
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Check if a specific component is degraded or down
   */
  async isDegraded(component: ComponentName): Promise<boolean> {
    const health = await this.checkComponent(component);
    return health.status === 'degraded' || health.status === 'down';
  }

  /**
   * Check if a specific component is completely down
   */
  async isDown(component: ComponentName): Promise<boolean> {
    const health = await this.checkComponent(component);
    return health.status === 'down';
  }

  /**
   * Check if system is healthy enough for a specific operation
   */
  async canPerform(operation: 'sports' | 'email' | 'calendar' | 'tasks' | 'stocks' | 'music' | 'brain' | 'image'): Promise<{ 
    canPerform: boolean; 
    reason?: string;
    fallbackSuggestion?: string;
  }> {
    const componentMap: Record<string, ComponentName[]> = {
      sports: ['database', 'sports'],
      email: ['agentmail'],
      calendar: ['calendar'],
      tasks: ['todoist'],
      stocks: ['database'],
      music: ['spotify'],
      brain: ['database', 'openai'],
      image: ['openai']
    };

    const requiredComponents = componentMap[operation] || ['database'];
    
    for (const comp of requiredComponents) {
      if (await this.isDown(comp)) {
        return {
          canPerform: false,
          reason: `Le service ${comp} est actuellement indisponible`,
          fallbackSuggestion: this.getFallbackSuggestion(operation, comp)
        };
      }
    }

    const degradedComponents = [];
    for (const comp of requiredComponents) {
      if (await this.isDegraded(comp)) {
        degradedComponents.push(comp);
      }
    }

    if (degradedComponents.length > 0) {
      return {
        canPerform: true,
        reason: `Services en mode dégradé: ${degradedComponents.join(', ')}. Les données peuvent être partielles ou en cache.`
      };
    }

    return { canPerform: true };
  }

  /**
   * Get brain/knowledge stats
   */
  async getBrainStats(userId: number = 1): Promise<BrainStats> {
    const cached = this.getFromCache(`brain_${userId}`);
    if (cached) return cached;

    try {
      const [total, byDomain, stats] = await Promise.all([
        db.select({ count: count() })
          .from(knowledgeBase)
          .where(eq(knowledgeBase.userId, userId))
          .then(r => r[0]?.count || 0),
        
        db.execute(sql`
          SELECT 
            CASE 
              WHEN lower(content) LIKE '%football%' OR lower(content) LIKE '%match%' 
                   OR lower(content) LIKE '%ligue%' OR lower(content) LIKE '%pronos%' THEN 'sports'
              WHEN lower(content) LIKE '%trading%' OR lower(content) LIKE '%crypto%' THEN 'trading'
              WHEN lower(content) LIKE '%sugu%' OR lower(content) LIKE '%restaurant%' THEN 'sugu'
              WHEN lower(content) LIKE '%code%' OR lower(content) LIKE '%api%' OR lower(content) LIKE '%react%' THEN 'dev'
              ELSE 'personal'
            END as domain,
            COUNT(*) as cnt
          FROM knowledge_base WHERE user_id = ${userId}
          GROUP BY 1
        `).then(r => r.rows as any[]).catch(() => []),
        
        db.execute(sql`
          SELECT 
            AVG(confidence) as avg_conf, 
            AVG(importance) as avg_imp,
            COUNT(*) FILTER (WHERE importance >= 80) as high_imp
          FROM knowledge_base WHERE user_id = ${userId}
        `).then(r => r.rows[0] as any).catch(() => ({}))
      ]);

      const domainCounts: Record<string, number> = {
        sports: 0, trading: 0, sugu: 0, dev: 0, personal: 0
      };
      for (const row of byDomain) {
        if (row.domain in domainCounts) {
          domainCounts[row.domain] = Number(row.cnt);
        }
      }

      const result: BrainStats = {
        totalKnowledge: Number(total),
        byDomain: domainCounts as any,
        avgConfidence: Math.round(Number(stats.avg_conf || 0)),
        avgImportance: Math.round(Number(stats.avg_imp || 0)),
        highImportance: Number(stats.high_imp || 0)
      };

      this.setCache(`brain_${userId}`, result, 60000); // 1 minute cache
      return result;
    } catch (error) {
      return {
        totalKnowledge: 0,
        byDomain: { sports: 0, trading: 0, sugu: 0, dev: 0, personal: 0 },
        avgConfidence: 0,
        avgImportance: 0,
        highImportance: 0
      };
    }
  }

  /**
   * Get betting/pronos performance stats
   */
  async getPronosStats(userId: number = 1): Promise<PronosStats> {
    const cached = this.getFromCache(`pronos_${userId}`);
    if (cached) return cached;

    try {
      const stats = await db.execute(sql`
        SELECT 
          COUNT(*) as total_bets,
          COUNT(*) FILTER (WHERE result = 'won') as wins,
          COUNT(*) FILTER (WHERE result IN ('won', 'lost')) as settled,
          COALESCE(SUM(CASE WHEN result = 'won' THEN stake * (odds - 1) ELSE -stake END), 0) as profit,
          COALESCE(SUM(stake), 0) as total_staked
        FROM actual_bets
        WHERE user_id = ${userId}
      `).then(r => r.rows[0] as any).catch(() => ({}));

      const totalBets = Number(stats.total_bets || 0);
      const wins = Number(stats.wins || 0);
      const settled = Number(stats.settled || 0);
      const profit = Number(stats.profit || 0);
      const totalStaked = Number(stats.total_staked || 0);

      const winrate = settled > 0 ? (wins / settled) * 100 : 0;
      const roi = totalStaked > 0 ? (profit / totalStaked) * 100 : 0;

      let recentPerformance: PronosStats['recentPerformance'] = 'unknown';
      if (settled >= 10) {
        if (roi >= 10) recentPerformance = 'excellent';
        else if (roi >= 0) recentPerformance = 'good';
        else if (roi >= -10) recentPerformance = 'average';
        else recentPerformance = 'poor';
      }

      const result: PronosStats = {
        roiOverall: Math.round(roi * 100) / 100,
        winrateOverall: Math.round(winrate * 100) / 100,
        totalBets,
        recentPerformance
      };

      this.setCache(`pronos_${userId}`, result, 60000);
      return result;
    } catch (error) {
      return {
        roiOverall: 0,
        winrateOverall: 0,
        totalBets: 0,
        recentPerformance: 'unknown'
      };
    }
  }

  /**
   * Generate context injection for AI based on current system state
   */
  async generateContextInjection(userId: number = 1): Promise<string> {
    const [summary, brain, pronos] = await Promise.all([
      this.getSummary(),
      this.getBrainStats(userId),
      this.getPronosStats(userId)
    ]);

    const lines: string[] = [
      `[SYSTEM STATUS: ${summary.status.toUpperCase()} - Score: ${summary.healthScore}/100]`
    ];

    if (summary.downComponents.length > 0) {
      lines.push(`⚠️ Services DOWN: ${summary.downComponents.join(', ')}`);
    }
    if (summary.degradedComponents.length > 0) {
      lines.push(`⚡ Services dégradés: ${summary.degradedComponents.join(', ')}`);
    }

    lines.push(`[BRAIN: ${brain.totalKnowledge} topics | Sports: ${brain.byDomain.sports} | Dev: ${brain.byDomain.dev} | SUGU: ${brain.byDomain.sugu}]`);

    if (pronos.totalBets > 0) {
      lines.push(`[PRONOS: ROI ${pronos.roiOverall}% | Winrate ${pronos.winrateOverall}% | ${pronos.totalBets} paris | Performance: ${pronos.recentPerformance}]`);
    }

    return lines.join('\n');
  }

  /**
   * Get adaptive response prefix based on system state
   */
  async getAdaptivePrefix(operation: string): Promise<string | null> {
    const check = await this.canPerform(operation as any);
    
    if (!check.canPerform) {
      return `⚠️ ${check.reason}. ${check.fallbackSuggestion || ''}`;
    }
    
    if (check.reason) {
      return `ℹ️ ${check.reason}`;
    }

    return null;
  }

  // ========================================
  // PALIER 2: Intent-based contextual checking
  // ========================================

  /**
   * Detect intent from user message
   */
  detectIntent(message: string): IntentType {
    const lowerMessage = message.toLowerCase();
    
    const intentPatterns: Record<IntentType, string[]> = {
      sports: ['foot', 'match', 'ligue', 'équipe', 'joueur', 'football', 'nba', 'nhl', 'nfl'],
      pronos: ['prono', 'pari', 'cote', 'bet', 'mise', 'bookmaker', 'value bet'],
      betting: ['1xbet', 'betclic', 'winamax', 'unibet', 'paris sportif'],
      email: ['mail', 'email', 'message', 'inbox', 'envoyer'],
      emails: ['mails', 'emails', 'messages', 'boîte'],
      calendar: ['calendrier', 'agenda', 'rdv', 'rendez-vous', 'réunion'],
      planning: ['planning', 'schedule', 'event', 'événement'],
      rdv: ['rdv', 'rendez-vous', 'appointment'],
      tasks: ['tâche', 'task', 'todo', 'à faire'],
      todo: ['todo', 'checklist', 'list'],
      todoist: ['todoist'],
      sugu: ['sugu', 'suguval', 'sugumaillane', 'restaurant', 'inventaire'],
      restaurant: ['restaurant', 'menu', 'cuisine'],
      stock: ['stock', 'rupture', 'produit', 'rotation'],
      dev: ['code', 'développement', 'bug', 'feature', 'api'],
      code: ['typescript', 'javascript', 'react', 'node', 'fonction'],
      debug: ['debug', 'erreur', 'error', 'fix', 'problème'],
      music: ['musique', 'chanson', 'artiste', 'album', 'playlist'],
      spotify: ['spotify', 'play', 'écouter', 'jouer'],
      files: ['fichier', 'file', 'document', 'pdf'],
      drive: ['drive', 'google drive', 'storage'],
      notion: ['notion', 'page', 'database', 'wiki'],
      trading: ['trading', 'trader', 'position', 'ordre'],
      stocks: ['bourse', 'action', 'nasdaq', 'cac40', 's&p'],
      crypto: ['bitcoin', 'eth', 'crypto', 'binance'],
      weather: ['météo', 'temps', 'pluie', 'soleil', 'température'],
      meteo: ['météo', 'weather'],
      general: []
    };

    for (const [intent, patterns] of Object.entries(intentPatterns)) {
      if (patterns.some(p => lowerMessage.includes(p))) {
        return intent as IntentType;
      }
    }

    return 'general';
  }

  /**
   * Get components required for an intent
   */
  private getComponentsForIntent(intent: IntentType): ComponentName[] {
    const intentComponentMap: Record<IntentType, ComponentName[]> = {
      sports: ['database', 'sports'],
      pronos: ['database', 'sports'],
      betting: ['database', 'sports'],
      email: ['agentmail'],
      emails: ['agentmail'],
      calendar: ['calendar'],
      planning: ['calendar'],
      rdv: ['calendar'],
      tasks: ['todoist'],
      todo: ['todoist'],
      todoist: ['todoist'],
      sugu: ['database'],
      restaurant: ['database'],
      stock: ['database'],
      dev: ['database', 'openai'],
      code: ['database', 'openai'],
      debug: ['database', 'openai'],
      music: ['spotify'],
      spotify: ['spotify'],
      files: ['drive'],
      drive: ['drive'],
      notion: ['notion'],
      trading: ['stocks'],
      stocks: ['stocks'],
      crypto: ['stocks'],
      weather: ['database'],
      meteo: ['database'],
      general: ['database', 'openai']
    };

    return intentComponentMap[intent] || ['database'];
  }

  /**
   * Check intent and get context flags (PALIER 2 core)
   */
  async checkIntentContext(message: string): Promise<IntentCheck> {
    const intent = this.detectIntent(message);
    const componentsToCheck = this.getComponentsForIntent(intent);
    
    const [summary, contextFlags] = await Promise.all([
      this.getSummary(),
      this.getContextFlags()
    ]);

    let canProceed = true;
    let adaptiveMessage: string | undefined;

    // Check if required components are down
    for (const comp of componentsToCheck) {
      if (await this.isDown(comp)) {
        canProceed = false;
        adaptiveMessage = this.getAdaptiveMessageForComponent(comp, 'down');
        break;
      }
    }

    // Check for degraded components
    if (canProceed) {
      for (const comp of componentsToCheck) {
        if (await this.isDegraded(comp)) {
          adaptiveMessage = this.getAdaptiveMessageForComponent(comp, 'degraded');
          break;
        }
      }
    }

    // Add clarity mode message
    if (contextFlags.clarityMode === 'limited') {
      adaptiveMessage = (adaptiveMessage || '') + ' Mode limité actif - réponses prudentes.';
    } else if (contextFlags.clarityMode === 'cautious') {
      adaptiveMessage = (adaptiveMessage || '') + ' Mode prudent - vérifications renforcées.';
    }

    return {
      intent,
      componentsToCheck,
      contextFlags,
      canProceed,
      adaptiveMessage: adaptiveMessage?.trim()
    };
  }

  /**
   * Get context flags for current system state
   */
  async getContextFlags(): Promise<ContextFlags> {
    const cached = this.getFromCache('context_flags');
    if (cached) return cached;

    const [
      summary,
      sportsStatus,
      emailStatus,
      calendarStatus,
      stocksStatus,
      clarityScore
    ] = await Promise.all([
      this.getSummary(),
      this.checkComponent('sports'),
      this.checkComponent('agentmail'),
      this.checkComponent('calendar'),
      this.checkComponent('stocks'),
      this.getClarityScore()
    ]);

    const flags: ContextFlags = {
      isSportsDegraded: sportsStatus.status !== 'operational',
      isEmailDown: emailStatus.status === 'down',
      isCalendarDown: calendarStatus.status === 'down',
      isBrainWeak: summary.healthScore < 60,
      isSuguDegraded: summary.degradedComponents.includes('database'),
      isStocksDegraded: stocksStatus.status !== 'operational',
      clarityMode: clarityScore.mode,
      warnings: [
        ...summary.degradedComponents.map(c => `${c} en mode dégradé`),
        ...summary.downComponents.map(c => `${c} indisponible`)
      ]
    };

    this.setCache('context_flags', flags, 15000); // 15 sec cache
    return flags;
  }

  private getAdaptiveMessageForComponent(component: ComponentName, status: 'down' | 'degraded'): string {
    const messages: Record<ComponentName, Record<'down' | 'degraded', string>> = {
      database: {
        down: "La base de données est indisponible. Je ne peux pas accéder aux données.",
        degraded: "La base de données est lente. Les réponses peuvent prendre plus de temps."
      },
      openai: {
        down: "Le service IA est indisponible. Mes capacités sont réduites.",
        degraded: "Le service IA est en mode dégradé."
      },
      gemini: {
        down: "Gemini est indisponible.",
        degraded: "Gemini est en mode dégradé."
      },
      agentmail: {
        down: "Le service email est indisponible. Tu peux checker ta boîte directement.",
        degraded: "Le service email est en mode dégradé. Les données peuvent être en cache."
      },
      calendar: {
        down: "Google Calendar est indisponible. Accède-y directement.",
        degraded: "Le calendrier est en mode dégradé."
      },
      todoist: {
        down: "Todoist est indisponible. Accède-y directement.",
        degraded: "Todoist est en mode dégradé."
      },
      notion: {
        down: "Notion est indisponible.",
        degraded: "Notion est en mode dégradé."
      },
      drive: {
        down: "Google Drive est indisponible.",
        degraded: "Google Drive est en mode dégradé."
      },
      spotify: {
        down: "Spotify est déconnecté. Ouvre l'app directement.",
        degraded: "Spotify a des difficultés."
      },
      sports: {
        down: "Les services sports sont indisponibles. Je m'appuie sur le cache.",
        degraded: "Le cache sports est en mode dégradé. Les données peuvent ne pas être à jour."
      },
      stocks: {
        down: "Les services financiers sont indisponibles.",
        degraded: "Les données financières peuvent être retardées."
      },
      brain: {
        down: "Ma mémoire est inaccessible.",
        degraded: "Ma mémoire a des difficultés d'accès."
      },
      websocket: {
        down: "Les connexions temps réel sont coupées.",
        degraded: "Les connexions temps réel sont instables."
      }
    };

    return messages[component]?.[status] || `${component} est ${status === 'down' ? 'indisponible' : 'en mode dégradé'}.`;
  }

  // ========================================
  // PALIER 3: ClarityScore + Diagnostics
  // ========================================

  /**
   * Calculate ClarityScore - Ulysse's self-awareness of reliability
   */
  async getClarityScore(): Promise<ClarityScore> {
    const cached = this.getFromCache('clarity_score');
    if (cached) return cached;

    const [summary, brainStats, recentDiagnostics] = await Promise.all([
      this.getSummary(),
      this.getBrainStats(),
      this.getRecentDiagnostics(5)
    ]);

    // Calculate factors
    const healthScore = summary.healthScore;
    
    // Critical services: database, openai
    const dbStatus = await this.checkComponent('database');
    const aiStatus = await this.checkComponent('openai');
    const criticalServicesUp = dbStatus.status === 'operational' && aiStatus.status === 'operational';

    // Brain health based on knowledge base quality
    const brainHealth = Math.min(100, 
      (brainStats.totalKnowledge > 100 ? 30 : 10) +
      (brainStats.avgConfidence > 60 ? 30 : 15) +
      (brainStats.highImportance > 50 ? 40 : 20)
    );

    // Recent errors from diagnostics
    const recentErrors = recentDiagnostics.filter(d => 
      d.status === 'critical' || (d.downComponents?.length || 0) > 0
    ).length;

    // Calculate overall clarity score
    let clarityScore = 100;
    
    // Health impact (40% weight)
    clarityScore -= (100 - healthScore) * 0.4;
    
    // Critical services impact (30% weight)
    if (!criticalServicesUp) {
      clarityScore -= 30;
    }
    
    // Brain health impact (20% weight)
    clarityScore -= (100 - brainHealth) * 0.2;
    
    // Recent errors impact (10% weight)
    clarityScore -= recentErrors * 5;

    clarityScore = Math.max(0, Math.min(100, Math.round(clarityScore)));

    // Determine mode
    let mode: ClarityMode;
    let recommendation: string;

    if (clarityScore >= 70) {
      mode = 'normal';
      recommendation = 'Fonctionnement optimal. Toutes les réponses sont fiables.';
    } else if (clarityScore >= 50) {
      mode = 'cautious';
      recommendation = 'Mode prudent activé. Vérifications supplémentaires sur les données sensibles.';
    } else {
      mode = 'limited';
      recommendation = 'Mode limité. Je préfère ne pas affirmer sur les domaines critiques (scores live, prix temps réel).';
    }

    const result: ClarityScore = {
      score: clarityScore,
      mode,
      factors: {
        healthScore,
        criticalServicesUp,
        brainHealth,
        recentErrors
      },
      recommendation
    };

    this.setCache('clarity_score', result, 30000);
    return result;
  }

  /**
   * Get recent diagnostics from database
   */
  async getRecentDiagnostics(limit: number = 10): Promise<Array<{
    id: number;
    healthScore: number;
    status: string;
    clarityScore: number;
    clarityMode: string;
    downComponents: string[] | null;
    createdAt: Date | null;
  }>> {
    try {
      const diagnostics = await db
        .select({
          id: systemDiagnostics.id,
          healthScore: systemDiagnostics.healthScore,
          status: systemDiagnostics.status,
          clarityScore: systemDiagnostics.clarityScore,
          clarityMode: systemDiagnostics.clarityMode,
          downComponents: systemDiagnostics.downComponents,
          createdAt: systemDiagnostics.createdAt
        })
        .from(systemDiagnostics)
        .orderBy(desc(systemDiagnostics.createdAt))
        .limit(limit);
      
      return diagnostics;
    } catch {
      return [];
    }
  }

  /**
   * Run self-diagnostic and save to database
   */
  async runDiagnostic(triggeredBy: 'scheduled' | 'manual' | 'event' = 'manual'): Promise<{
    id: number;
    summary: SystemSummary;
    clarityScore: ClarityScore;
    brainStats: BrainStats;
  }> {
    // Clear cache to get fresh data
    this.clearCache();

    const [summary, clarityScore, brainStats, components] = await Promise.all([
      this.getSummary(),
      this.getClarityScore(),
      this.getBrainStats(),
      this.checkAllComponents()
    ]);

    // Save to database
    const [saved] = await db.insert(systemDiagnostics).values({
      healthScore: summary.healthScore,
      status: summary.status,
      clarityScore: clarityScore.score,
      clarityMode: clarityScore.mode,
      components: components as any,
      warnings: clarityScore.factors.recentErrors > 0 ? ['Recent errors detected'] : [],
      degradedComponents: summary.degradedComponents,
      downComponents: summary.downComponents,
      brainStats: brainStats as any,
      triggeredBy
    }).returning({ id: systemDiagnostics.id });

    return {
      id: saved.id,
      summary,
      clarityScore,
      brainStats
    };
  }

  /**
   * Get last diagnostic
   */
  async getLastDiagnostic() {
    const [last] = await this.getRecentDiagnostics(1);
    if (!last) return null;

    const timeSince = last.createdAt 
      ? Math.floor((Date.now() - last.createdAt.getTime()) / 60000)
      : null;

    return {
      ...last,
      minutesSinceLastDiag: timeSince,
      summary: `Dernier diagnostic: healthScore ${last.healthScore}, ${last.clarityMode} mode${timeSince ? ` (il y a ${timeSince} min)` : ''}`
    };
  }

  /**
   * Generate enhanced context injection with ClarityScore (PALIER 3)
   */
  async generateEnhancedContextInjection(userId: number = 1, message?: string): Promise<string> {
    const [summary, brain, pronos, clarityScore, lastDiag] = await Promise.all([
      this.getSummary(),
      this.getBrainStats(userId),
      this.getPronosStats(userId),
      this.getClarityScore(),
      this.getLastDiagnostic()
    ]);

    const lines: string[] = [
      `[SYSTEM: ${summary.status.toUpperCase()} | Health: ${summary.healthScore}/100 | Clarity: ${clarityScore.score}/100 (${clarityScore.mode.toUpperCase()})]`
    ];

    // Mode-specific instructions
    if (clarityScore.mode === 'limited') {
      lines.push(`⚠️ MODE LIMITÉ - Éviter les affirmations sur: scores live, prix temps réel, données critiques`);
    } else if (clarityScore.mode === 'cautious') {
      lines.push(`⚡ MODE PRUDENT - Vérifier les sources avant d'affirmer sur les données sensibles`);
    }

    if (summary.downComponents.length > 0) {
      lines.push(`🔴 DOWN: ${summary.downComponents.join(', ')}`);
    }
    if (summary.degradedComponents.length > 0) {
      lines.push(`🟡 DÉGRADÉ: ${summary.degradedComponents.join(', ')}`);
    }

    lines.push(`[BRAIN: ${brain.totalKnowledge} topics | Conf: ${brain.avgConfidence}%]`);

    if (pronos.totalBets > 0) {
      lines.push(`[PRONOS: ROI ${pronos.roiOverall}% | WR ${pronos.winrateOverall}% | ${pronos.recentPerformance}]`);
    }

    if (lastDiag && lastDiag.minutesSinceLastDiag !== null && lastDiag.minutesSinceLastDiag < 60) {
      lines.push(`[LAST DIAG: ${lastDiag.minutesSinceLastDiag}min ago]`);
    }

    // If message provided, add intent-specific context
    if (message) {
      const intentCheck = await this.checkIntentContext(message);
      if (intentCheck.adaptiveMessage) {
        lines.push(`[INTENT ${intentCheck.intent.toUpperCase()}: ${intentCheck.adaptiveMessage}]`);
      }
    }

    return lines.join('\n');
  }

  // Private methods

  private async checkComponent(component: ComponentName): Promise<ComponentHealth> {
    const cached = this.getFromCache(`component_${component}`);
    if (cached) return cached;

    let health: ComponentHealth;

    try {
      switch (component) {
        case 'database':
          await db.execute(sql`SELECT 1`);
          health = { status: 'operational' };
          break;
        
        case 'openai':
          health = { 
            status: (process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY) 
              ? 'operational' : 'down' 
          };
          break;
        
        case 'gemini':
          health = { 
            status: process.env.GEMINI_API_KEY ? 'operational' : 'down' 
          };
          break;
        
        case 'agentmail':
          health = { 
            status: process.env.AGENTMAIL_API_KEY ? 'operational' : 'degraded' 
          };
          break;
        
        case 'calendar':
          try {
            const { calendarService } = await import("./googleCalendarService");
            const connected = await calendarService.isConnected();
            health = { status: connected ? 'operational' : 'degraded' };
          } catch {
            health = { status: 'degraded' };
          }
          break;
        
        case 'todoist':
          try {
            const { checkTodoistConnection } = await import("./todoistService");
            const connected = await checkTodoistConnection();
            health = { status: connected ? 'operational' : 'degraded' };
          } catch {
            health = { status: 'degraded' };
          }
          break;
        
        case 'spotify':
          health = { 
            status: process.env.SPOTIFY_CLIENT_ID ? 'operational' : 'degraded' 
          };
          break;
        
        case 'sports':
          health = { 
            status: process.env.API_FOOTBALL_KEY ? 'operational' : 'degraded' 
          };
          break;
        
        case 'stocks':
          health = { 
            status: (process.env.FINNHUB_API_KEY || process.env.TWELVE_DATA_API_KEY) 
              ? 'operational' : 'degraded' 
          };
          break;
        
        default:
          health = { status: 'unknown' };
      }
    } catch (error) {
      health = { status: 'down', details: String(error) };
    }

    this.setCache(`component_${component}`, health);
    return health;
  }

  private async checkAllComponents(): Promise<Record<string, ComponentHealth>> {
    const components: ComponentName[] = [
      'database', 'openai', 'agentmail', 'calendar', 'todoist', 'spotify', 'sports', 'stocks'
    ];

    const results: Record<string, ComponentHealth> = {};
    
    await Promise.all(
      components.map(async (comp) => {
        results[comp] = await this.checkComponent(comp);
      })
    );

    return results;
  }

  private calculateHealthScore(components: Record<string, ComponentHealth>): number {
    const weights: Record<string, number> = {
      database: 25,
      openai: 20,
      agentmail: 10,
      calendar: 10,
      todoist: 10,
      spotify: 5,
      sports: 10,
      stocks: 10
    };

    let score = 0;
    let totalWeight = 0;

    for (const [name, health] of Object.entries(components)) {
      const weight = weights[name] || 5;
      totalWeight += weight;
      
      if (health.status === 'operational') {
        score += weight;
      } else if (health.status === 'degraded') {
        score += weight * 0.5;
      }
    }

    return totalWeight > 0 ? Math.round((score / totalWeight) * 100) : 0;
  }

  private getFallbackSuggestion(operation: string, failedComponent: string): string {
    const suggestions: Record<string, Record<string, string>> = {
      sports: {
        sports: "Je peux te donner les infos en cache si disponibles.",
        database: "Réessaie dans quelques instants."
      },
      email: {
        agentmail: "Tu peux checker ta boîte mail directement."
      },
      calendar: {
        calendar: "Accède à Google Calendar directement."
      },
      tasks: {
        todoist: "Accède à Todoist directement."
      },
      music: {
        spotify: "Ouvre Spotify directement sur ton device."
      }
    };

    return suggestions[operation]?.[failedComponent] || "Réessaie plus tard.";
  }

  private getFromCache(key: string): any | null {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
    this.cache.delete(key);
    return null;
  }

  private setCache(key: string, data: any, ttl: number = this.CACHE_TTL): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttl
    });
  }

  /**
   * Clear all caches (for testing or forced refresh)
   */
  clearCache(): void {
    this.cache.clear();
  }
}

export const selfAwarenessService = new SelfAwarenessService();
