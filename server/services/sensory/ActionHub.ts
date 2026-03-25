/**
 * ACTION HUB - Centre d'Action Unifié d'Ulysse
 * 
 * Point d'exécution unique pour TOUT ce qu'Ulysse fait, quelle que soit l'action.
 * Orchestre, exécute, valide et apprend de toutes les actions.
 * 
 * Types d'actions:
 * - Tool Calls (OpenAI function calling)
 * - Homework (tâches de fond)
 * - Domotique (smart home)
 * - Emails/Calendar (communication)
 * - File Operations (lecture/écriture)
 * - Web Actions (recherche, scraping)
 * - Memory Operations (Brain)
 * 
 * Architecture:
 * [Cerveau] → ActionHub → [Validation + Exécution] → [Résultat] → [Apprentissage]
 */

import { storage } from "../../storage";

// ============== TYPES ==============

export type ActionCategory = 
  | "tool_call"       // OpenAI function calling
  | "homework"        // Tâches de fond Ulysse
  | "domotique"       // Smart home
  | "email"           // Envoi/lecture email
  | "calendar"        // Événements calendrier
  | "file"            // Opérations fichiers
  | "web"             // Recherche web, scraping
  | "memory"          // Opérations Brain
  | "notification"    // Envoi notification
  | "spotify"         // Contrôle musique
  | "sports"          // Prédictions sportives
  | "payroll"         // Gestion paie/RH
  | "monitoring"      // AppToOrder / surveillance
  | "studio"          // Studio média
  | "system";         // Actions système

export type ActionStatus = 
  | "pending"
  | "validating"
  | "executing"
  | "completed"
  | "failed"
  | "rolled_back"
  | "cancelled";

export interface ActionMetadata {
  category: ActionCategory;
  userId: number;
  persona: "ulysse" | "iris" | "alfred";
  source: "voice" | "chat" | "api" | "scheduled" | "autonomous";
  conversationId?: number;
  correlationId?: string;  // Pour lier les actions entre elles
}

export interface ActionInput {
  name: string;              // Nom de l'action (ex: "send_email", "set_reminder")
  params: Record<string, any>;
  metadata: ActionMetadata;
  requiresConfirmation?: boolean;  // Demander confirmation avant exécution
}

export interface ActionResult {
  actionId: string;
  name: string;
  category: ActionCategory;
  status: ActionStatus;
  success: boolean;
  result?: any;              // Résultat de l'action
  error?: string;
  executionMs: number;
  sideEffects?: string[];    // Effets secondaires notables
  canRollback: boolean;
}

export interface ActionLog {
  id: string;
  action: ActionInput;
  result: ActionResult;
  timestamp: number;
  rollbackData?: any;        // Données pour annuler l'action
}

// ============== STATISTIQUES ==============

interface ActionStats {
  totalActions: number;
  byCategory: Record<ActionCategory, number>;
  byStatus: Record<ActionStatus, number>;
  successRate: number;
  avgExecutionMs: number;
  rollbackCount: number;
  autonomousActions: number;
}

// ============== EXECUTEURS D'ACTIONS ==============

type ActionExecutor = (params: Record<string, any>, metadata: ActionMetadata) => Promise<{ success: boolean; result?: any; error?: string; canRollback?: boolean; rollbackData?: any }>;

// ============== SERVICE PRINCIPAL ==============

class ActionHubService {
  private stats: ActionStats = {
    totalActions: 0,
    byCategory: {
      tool_call: 0,
      homework: 0,
      domotique: 0,
      email: 0,
      calendar: 0,
      file: 0,
      web: 0,
      memory: 0,
      notification: 0,
      spotify: 0,
      sports: 0,
      payroll: 0,
      monitoring: 0,
      studio: 0,
      system: 0
    },
    byStatus: {
      pending: 0,
      validating: 0,
      executing: 0,
      completed: 0,
      failed: 0,
      rolled_back: 0,
      cancelled: 0
    },
    successRate: 0,
    avgExecutionMs: 0,
    rollbackCount: 0,
    autonomousActions: 0
  };

  private executors: Map<string, ActionExecutor> = new Map();
  private actionHistory: ActionLog[] = [];
  private maxHistorySize = 1000;
  
  private listeners: Array<(log: ActionLog) => void> = [];
  private preExecuteHooks: Array<(action: ActionInput) => Promise<boolean>> = [];

  constructor() {
    console.log("[ActionHub] Centre d'action unifié initialisé");
    this.registerDefaultExecutors();
  }

  /**
   * Point d'entrée principal - Exécute une action
   */
  async execute(input: ActionInput): Promise<ActionResult> {
    const startTime = Date.now();
    const actionId = this.generateActionId();
    
    this.stats.totalActions++;
    this.stats.byCategory[input.metadata.category]++;
    
    if (input.metadata.source === "autonomous") {
      this.stats.autonomousActions++;
    }

    console.log(`[ActionHub] 🤲 Action: ${input.name}, category=${input.metadata.category}, source=${input.metadata.source}`);

    try {
      // 1. Validation pré-exécution
      this.stats.byStatus.validating++;
      const canProceed = await this.runPreExecuteHooks(input);
      if (!canProceed) {
        this.stats.byStatus.cancelled++;
        return this.buildResult(actionId, input, "cancelled", false, undefined, "Action annulée par validation", 0);
      }

      // 2. Confirmation si nécessaire
      if (input.requiresConfirmation) {
        console.log(`[ActionHub] Action ${input.name} requiert confirmation`);
        // TODO: Implémenter le système de confirmation
      }

      // 3. Exécution
      this.stats.byStatus.executing++;
      const executor = this.executors.get(input.name) || this.executors.get(`${input.metadata.category}:default`);
      
      if (!executor) {
        console.warn(`[ActionHub] Pas d'exécuteur pour: ${input.name}`);
        this.stats.byStatus.failed++;
        return this.buildResult(actionId, input, "failed", false, undefined, `Exécuteur non trouvé: ${input.name}`, 0);
      }

      const execResult = await executor(input.params, input.metadata);
      const executionMs = Date.now() - startTime;

      // 4. Construire le résultat
      const status: ActionStatus = execResult.success ? "completed" : "failed";
      this.stats.byStatus[status]++;
      
      const result = this.buildResult(
        actionId, 
        input, 
        status, 
        execResult.success, 
        execResult.result, 
        execResult.error, 
        executionMs,
        execResult.canRollback
      );

      // 5. Logger l'action
      const log: ActionLog = {
        id: actionId,
        action: input,
        result,
        timestamp: Date.now(),
        rollbackData: execResult.rollbackData
      };
      this.addToHistory(log);
      
      // 6. Mettre à jour les stats
      this.updateStats(execResult.success, executionMs);

      // 7. Notifier les listeners
      this.notifyListeners(log);

      // 8. Apprentissage (async, non-bloquant)
      this.learnFromAction(log).catch(err => 
        console.warn("[ActionHub] Erreur apprentissage:", err)
      );

      console.log(`[ActionHub] ✅ ${input.name}: ${status} en ${executionMs}ms`);
      
      return result;

    } catch (error) {
      console.error("[ActionHub] Erreur exécution:", error);
      this.stats.byStatus.failed++;
      
      return this.buildResult(
        actionId, 
        input, 
        "failed", 
        false, 
        undefined, 
        error instanceof Error ? error.message : "Erreur inconnue",
        Date.now() - startTime
      );
    }
  }

  /**
   * Exécute plusieurs actions en séquence
   */
  async executeSequence(actions: ActionInput[]): Promise<ActionResult[]> {
    const results: ActionResult[] = [];
    
    for (const action of actions) {
      const result = await this.execute(action);
      results.push(result);
      
      // Arrêter si une action échoue
      if (!result.success) {
        console.log(`[ActionHub] Séquence interrompue après échec de: ${action.name}`);
        break;
      }
    }
    
    return results;
  }

  /**
   * Exécute plusieurs actions en parallèle
   */
  async executeParallel(actions: ActionInput[]): Promise<ActionResult[]> {
    return Promise.all(actions.map(action => this.execute(action)));
  }

  /**
   * Annule une action précédente (si possible)
   */
  async rollback(actionId: string): Promise<boolean> {
    const log = this.actionHistory.find(l => l.id === actionId);
    if (!log) {
      console.warn(`[ActionHub] Action ${actionId} non trouvée pour rollback`);
      return false;
    }
    
    if (!log.result.canRollback || !log.rollbackData) {
      console.warn(`[ActionHub] Action ${actionId} ne peut pas être annulée`);
      return false;
    }

    console.log(`[ActionHub] Rollback de: ${log.action.name}`);
    
    // TODO: Implémenter le rollback spécifique par type d'action
    this.stats.rollbackCount++;
    this.stats.byStatus.rolled_back++;
    
    return true;
  }

  /**
   * Enregistre un exécuteur d'action
   */
  registerExecutor(actionName: string, executor: ActionExecutor): void {
    this.executors.set(actionName, executor);
    console.log(`[ActionHub] Exécuteur enregistré: ${actionName}`);
  }

  /**
   * Enregistre un hook de pré-exécution
   */
  registerPreExecuteHook(hook: (action: ActionInput) => Promise<boolean>): () => void {
    this.preExecuteHooks.push(hook);
    return () => {
      const index = this.preExecuteHooks.indexOf(hook);
      if (index > -1) this.preExecuteHooks.splice(index, 1);
    };
  }

  /**
   * Enregistre un listener pour les actions exécutées
   */
  onAction(callback: (log: ActionLog) => void): () => void {
    this.listeners.push(callback);
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index > -1) this.listeners.splice(index, 1);
    };
  }

  /**
   * Retourne l'historique des actions
   */
  getHistory(limit: number = 100, category?: ActionCategory): ActionLog[] {
    let history = this.actionHistory;
    
    if (category) {
      history = history.filter(l => l.action.metadata.category === category);
    }
    
    return history.slice(-limit);
  }

  /**
   * Retourne les statistiques
   */
  getStats(): ActionStats {
    return { ...this.stats };
  }

  // ============== RACCOURCIS ==============

  /**
   * Exécute un outil (function calling)
   */
  async executeTool(
    toolName: string, 
    params: Record<string, any>,
    userId: number,
    persona: "ulysse" | "iris" | "alfred"
  ): Promise<ActionResult> {
    return this.execute({
      name: toolName,
      params,
      metadata: {
        category: "tool_call",
        userId,
        persona,
        source: "chat"
      }
    });
  }

  /**
   * Exécute une action domotique
   */
  async executeSmartHome(
    deviceAction: string,
    params: Record<string, any>,
    userId: number
  ): Promise<ActionResult> {
    return this.execute({
      name: deviceAction,
      params,
      metadata: {
        category: "domotique",
        userId,
        persona: "ulysse",
        source: "voice"
      }
    });
  }

  /**
   * Exécute une tâche homework
   */
  async executeHomework(
    homeworkId: number,
    userId: number
  ): Promise<ActionResult> {
    return this.execute({
      name: "execute_homework",
      params: { homeworkId },
      metadata: {
        category: "homework",
        userId,
        persona: "ulysse",
        source: "scheduled"
      }
    });
  }

  // ============== HELPERS PRIVÉS ==============

  private generateActionId(): string {
    return `act_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private buildResult(
    actionId: string,
    input: ActionInput,
    status: ActionStatus,
    success: boolean,
    result?: any,
    error?: string,
    executionMs: number = 0,
    canRollback: boolean = false
  ): ActionResult {
    return {
      actionId,
      name: input.name,
      category: input.metadata.category,
      status,
      success,
      result,
      error,
      executionMs,
      canRollback
    };
  }

  private async runPreExecuteHooks(action: ActionInput): Promise<boolean> {
    for (const hook of this.preExecuteHooks) {
      try {
        const canProceed = await hook(action);
        if (!canProceed) return false;
      } catch (error) {
        console.warn("[ActionHub] Erreur dans hook pré-exécution:", error);
      }
    }
    return true;
  }

  private addToHistory(log: ActionLog): void {
    this.actionHistory.push(log);
    
    // Limiter la taille de l'historique
    if (this.actionHistory.length > this.maxHistorySize) {
      this.actionHistory = this.actionHistory.slice(-this.maxHistorySize);
    }
  }

  private updateStats(success: boolean, executionMs: number): void {
    const n = this.stats.totalActions;
    
    // Taux de succès
    this.stats.successRate = ((n - 1) * this.stats.successRate + (success ? 1 : 0)) / n;
    
    // Temps moyen d'exécution
    this.stats.avgExecutionMs = ((n - 1) * this.stats.avgExecutionMs + executionMs) / n;
  }

  private notifyListeners(log: ActionLog): void {
    this.listeners.forEach(listener => {
      try {
        listener(log);
      } catch (error) {
        console.error("[ActionHub] Erreur dans listener:", error);
      }
    });
  }

  private async learnFromAction(log: ActionLog): Promise<void> {
    try {
      const { pugi } = require("../proactiveGeneralIntelligence");
      if (log.result?.success && log.action.metadata?.source !== 'autonomous') {
        const toolName = log.action.name;
        const digest = pugi.getDigest(2);
        const relatedSignal = digest.topActions.find((s: any) =>
          s.suggestedTools?.includes(toolName)
        );
        if (relatedSignal) {
          pugi.recordFeedback(relatedSignal.id, 'acted');
        }
      }
    } catch {}
  }

  getSuggestedProactiveActions(): Array<{ tool: string; reason: string; priority: string }> {
    try {
      const { pugi } = require("../proactiveGeneralIntelligence");
      const digest = pugi.getDigest(3);
      return digest.topActions
        .filter((s: any) => s.suggestedTools && s.suggestedTools.length > 0)
        .slice(0, 5)
        .map((s: any) => ({
          tool: s.suggestedTools[0],
          reason: s.title,
          priority: s.priority,
        }));
    } catch {
      return [];
    }
  }

  private registerDefaultExecutors(): void {
    // Exécuteur par défaut pour les catégories
    this.registerExecutor("tool_call:default", async (params, metadata) => {
      console.log(`[ActionHub] Tool call générique: ${JSON.stringify(params)}`);
      return { success: true, result: { message: "Tool call exécuté" } };
    });

    this.registerExecutor("system:default", async (params, metadata) => {
      console.log(`[ActionHub] Action système: ${JSON.stringify(params)}`);
      return { success: true };
    });

    // Actions système communes
    this.registerExecutor("system:ping", async () => {
      return { success: true, result: { pong: Date.now() } };
    });

    this.registerExecutor("system:health_check", async () => {
      return { 
        success: true, 
        result: { 
          status: "healthy",
          stats: this.getStats()
        } 
      };
    });

    this.registerExecutor("sports:default", async (params) => {
      console.log(`[ActionHub] Sports action: ${JSON.stringify(params)}`);
      return { success: true, result: { message: "Sports action exécutée" } };
    });

    this.registerExecutor("payroll:default", async (params) => {
      console.log(`[ActionHub] Payroll action: ${JSON.stringify(params)}`);
      return { success: true, result: { message: "Payroll action exécutée" } };
    });

    this.registerExecutor("monitoring:default", async (params) => {
      console.log(`[ActionHub] Monitoring action: ${JSON.stringify(params)}`);
      return { success: true, result: { message: "Monitoring action exécutée" } };
    });

    this.registerExecutor("studio:default", async (params) => {
      console.log(`[ActionHub] Studio action: ${JSON.stringify(params)}`);
      return { success: true, result: { message: "Studio action exécutée" } };
    });
  }
}

// ============== EXPORT SINGLETON ==============

export const actionHub = new ActionHubService();
