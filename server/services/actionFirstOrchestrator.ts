/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ACTION-FIRST ORCHESTRATOR V4 - PRO LEVEL IMPLEMENTATION
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * This is the central brain that bridges the gap between:
 * - Backend Action-First design (OpenAI function calling tools V2)
 * - Runtime conversation system (text markers)
 * 
 * Core Responsibilities:
 * 1. Workflow Detection - Analyzes user message BEFORE AI responds
 * 2. Action-First Prompt Injection - Injects directives with PRIORITY
 * 3. Marker-to-Tool Adapter - Maps tools V2 to text markers for execution
 * 4. Persona-Aware Behavior - Different rules for Ulysse/Iris/Alfred
 * 5. Execution Tracking - Monitors action success/failure for learning
 * 
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │                        ActionFirstOrchestrator                              │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │  User Message → detectWorkflow() → getEnhancedPrompt() → AI Response       │
 * │                                                          ↓                  │
 * │                                               parseAndExecuteMarkers()      │
 * │                                                          ↓                  │
 * │                                               ActionResultTracker           │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */

import { 
  ACTION_WORKFLOWS, 
  ActionWorkflow,
  BEHAVIOR_DIRECTIVES, 
  OUTPUT_MARKERS,
  detectWorkflow,
  getActionPromptEnhancement
} from "../config/ulysseBehaviorRules";

export type PersonaType = 'ulysse' | 'iris' | 'alfred';

export interface PersonaConfig {
  name: string;
  actionFirstEnabled: boolean;
  requiresConfirmationOverride: boolean;
  allowedWorkflows: string[];
  greetingStyle: 'sarcastic' | 'warm' | 'professional';
  dataAccessLevel: 'full' | 'family' | 'external';
}

export const PERSONA_CONFIGS: Record<PersonaType, PersonaConfig> = {
  ulysse: {
    name: 'Ulysse',
    actionFirstEnabled: true,
    requiresConfirmationOverride: false,
    allowedWorkflows: Object.keys(ACTION_WORKFLOWS),
    greetingStyle: 'sarcastic',
    dataAccessLevel: 'full'
  },
  iris: {
    name: 'Iris',
    actionFirstEnabled: true,
    requiresConfirmationOverride: false,
    allowedWorkflows: Object.keys(ACTION_WORKFLOWS),
    greetingStyle: 'warm',
    dataAccessLevel: 'family'
  },
  alfred: {
    name: 'Max',
    actionFirstEnabled: false,
    requiresConfirmationOverride: true,
    allowedWorkflows: ['prono', 'briefing'],
    greetingStyle: 'professional',
    dataAccessLevel: 'external'
  }
};

export interface WorkflowDetectionResult {
  detected: boolean;
  workflow: ActionWorkflow | null;
  workflowType: string | null;
  confidence: number;
  matchedTriggers: string[];
  suggestedAction: string | null;
}

export interface ActionFirstContext {
  persona: PersonaType;
  personaConfig: PersonaConfig;
  workflowResult: WorkflowDetectionResult;
  enhancedPrompt: string;
  executionPlan: ExecutionPlan | null;
}

export interface ExecutionPlan {
  primaryAction: string;
  outputType: string;
  toolsToUse: string[];
  markerTemplate: string | null;
  requiresConfirmation: boolean;
  antiPattern: string;
}

export interface ActionExecutionResult {
  success: boolean;
  actionType: string;
  marker: string;
  executedAt: Date;
  executionTimeMs: number;
  error?: string;
  resultData?: any;
}

export interface OrchestratorMetrics {
  totalRequests: number;
  workflowsDetected: number;
  actionsExecuted: number;
  successfulActions: number;
  failedActions: number;
  averageExecutionTimeMs: number;
  byWorkflowType: Record<string, { count: number; successRate: number }>;
}

class ActionFirstOrchestrator {
  private metrics: OrchestratorMetrics = {
    totalRequests: 0,
    workflowsDetected: 0,
    actionsExecuted: 0,
    successfulActions: 0,
    failedActions: 0,
    averageExecutionTimeMs: 0,
    byWorkflowType: {}
  };

  private executionHistory: ActionExecutionResult[] = [];
  private readonly MAX_HISTORY_SIZE = 1000;

  detectWorkflowEnhanced(userMessage: string): WorkflowDetectionResult {
    const lowerMessage = userMessage.toLowerCase();
    const matchedTriggers: string[] = [];
    let bestMatch: { type: string; workflow: ActionWorkflow; triggerCount: number } | null = null;

    for (const [workflowType, workflow] of Object.entries(ACTION_WORKFLOWS)) {
      const matches = workflow.trigger.filter(t => lowerMessage.includes(t.toLowerCase()));
      
      if (matches.length > 0) {
        matchedTriggers.push(...matches);
        
        if (!bestMatch || matches.length > bestMatch.triggerCount) {
          bestMatch = { type: workflowType, workflow, triggerCount: matches.length };
        }
      }
    }

    if (bestMatch) {
      this.metrics.workflowsDetected++;
      return {
        detected: true,
        workflow: bestMatch.workflow,
        workflowType: bestMatch.type,
        confidence: Math.min(100, bestMatch.triggerCount * 25 + 50),
        matchedTriggers,
        suggestedAction: bestMatch.workflow.defaultAction
      };
    }

    return {
      detected: false,
      workflow: null,
      workflowType: null,
      confidence: 0,
      matchedTriggers: [],
      suggestedAction: null
    };
  }

  determinePersona(isOwner: boolean, userRole: string): PersonaType {
    // ═══════════════════════════════════════════════════════════════════════════
    // STRICT PERSONA MAPPING - Aligns with access control model
    // ═══════════════════════════════════════════════════════════════════════════
    // Ulysse: Owner only (full access)
    // Iris: Approved family members only (family access)
    // Alfred: All other users (external, guest, user, etc.) - no action execution
    if (isOwner) return 'ulysse';
    if (userRole === 'approved') return 'iris';
    // All other roles (external, guest, user, etc.) are treated as Alfred
    return 'alfred';
  }

  getPersonaConfig(persona: PersonaType): PersonaConfig {
    return PERSONA_CONFIGS[persona];
  }

  buildExecutionPlan(workflow: ActionWorkflow, persona: PersonaType): ExecutionPlan {
    const personaConfig = this.getPersonaConfig(persona);
    
    const markerTemplate = this.getMarkerTemplate(workflow.outputType);
    
    return {
      primaryAction: workflow.defaultAction,
      outputType: workflow.outputType,
      toolsToUse: workflow.toolsToUse,
      markerTemplate,
      requiresConfirmation: personaConfig.requiresConfirmationOverride 
        ? true 
        : workflow.requiresConfirmation,
      antiPattern: workflow.antiPattern
    };
  }

  private getMarkerTemplate(outputType: string): string | null {
    const templates: Record<string, string> = {
      email_sent: OUTPUT_MARKERS.email_sent,
      email_with_pdf: OUTPUT_MARKERS.email_with_pdf,
      email_with_word: OUTPUT_MARKERS.email_with_word,
      email_reply: OUTPUT_MARKERS.email_reply,
      todoist_task: OUTPUT_MARKERS.todoist_task,
      kanban_task: OUTPUT_MARKERS.kanban_task,
      calendar_event: 'calendar_create_event (function calling)',
      prono_structured: OUTPUT_MARKERS.prono_structured,
      domotique_action: OUTPUT_MARKERS.domotique_action,
      data_analysis: OUTPUT_MARKERS.data_analysis,
      conversation: null
    };
    return templates[outputType] || null;
  }

  buildEnhancedPrompt(
    workflowResult: WorkflowDetectionResult, 
    persona: PersonaType,
    additionalContext?: string
  ): string {
    const personaConfig = this.getPersonaConfig(persona);
    const parts: string[] = [];

    // NOTE: getBehaviorPrompt() is NOT called here to avoid duplication
    // The baseSystemPrompt already contains behavior rules
    // This method only adds workflow-specific enhancements

    if (workflowResult.detected && workflowResult.workflow) {
      if (personaConfig.allowedWorkflows.includes(workflowResult.workflowType!)) {
        parts.push(getActionPromptEnhancement(workflowResult.workflow));
        
        const plan = this.buildExecutionPlan(workflowResult.workflow, persona);
        if (plan.markerTemplate) {
          parts.push(`\nMARQUEUR A UTILISER: ${plan.markerTemplate}`);
        }
        
        parts.push(`\nANTI-PATTERN: ${plan.antiPattern}`);
      }
    }

    if (personaConfig.actionFirstEnabled) {
      parts.push(this.getPersonaSpecificRules(persona));
    }

    if (additionalContext) {
      parts.push(additionalContext);
    }

    return parts.join('\n\n');
  }

  private getPersonaSpecificRules(persona: PersonaType): string {
    switch (persona) {
      case 'ulysse':
        return `
REGLES ULYSSE (OWNER):
- Tu es le patron, tu executes TOUT sans hesiter
- Ton ton est sarcastique-complice, comme un pote expert
- Tu as acces a TOUTES les donnees: famille, perso, business
- JAMAIS de confirmation pour: emails, taches, fichiers, domotique
- Confirmation UNIQUEMENT pour: evenements calendrier`;
      
      case 'iris':
        return `
REGLES IRIS (FAMILLE APPROUVEE):
- Tu es l'assistante bienveillante et chaleureuse
- Tu executes les actions sans demander, mais avec douceur
- Tu as acces aux donnees familiales mais pas aux donnees business confidentielles
- Tu encourages et motives dans tes reponses`;
      
      case 'alfred':
        return `
REGLES ALFRED (UTILISATEUR EXTERNE):
- Tu es professionnel et formel
- Tu DEMANDES TOUJOURS confirmation avant d'executer
- Tu n'as PAS acces aux donnees personnelles/familiales
- Tu te limites aux informations publiques et aux pronostics sportifs
- Tu ne tutoies pas, tu vouvoies`;
    }
  }

  async processUserMessage(
    userMessage: string,
    userId: number,
    isOwner: boolean,
    userRole: string
  ): Promise<ActionFirstContext> {
    this.metrics.totalRequests++;
    
    const persona = this.determinePersona(isOwner, userRole);
    const personaConfig = this.getPersonaConfig(persona);
    const workflowResult = this.detectWorkflowEnhanced(userMessage);
    
    let executionPlan: ExecutionPlan | null = null;
    if (workflowResult.detected && workflowResult.workflow) {
      executionPlan = this.buildExecutionPlan(workflowResult.workflow, persona);
    }

    const enhancedPrompt = this.buildEnhancedPrompt(workflowResult, persona);

    console.log(`[ActionFirst] User: ${userId}, Persona: ${persona}, Workflow: ${workflowResult.workflowType || 'none'}, Confidence: ${workflowResult.confidence}%`);

    return {
      persona,
      personaConfig,
      workflowResult,
      enhancedPrompt,
      executionPlan
    };
  }

  recordActionExecution(result: ActionExecutionResult): void {
    this.executionHistory.push(result);
    
    if (this.executionHistory.length > this.MAX_HISTORY_SIZE) {
      this.executionHistory = this.executionHistory.slice(-this.MAX_HISTORY_SIZE);
    }

    this.metrics.actionsExecuted++;
    if (result.success) {
      this.metrics.successfulActions++;
    } else {
      this.metrics.failedActions++;
    }

    const totalTime = this.executionHistory.reduce((sum, r) => sum + r.executionTimeMs, 0);
    this.metrics.averageExecutionTimeMs = totalTime / this.executionHistory.length;

    if (!this.metrics.byWorkflowType[result.actionType]) {
      this.metrics.byWorkflowType[result.actionType] = { count: 0, successRate: 0 };
    }
    const typeMetrics = this.metrics.byWorkflowType[result.actionType];
    typeMetrics.count++;
    
    const typeHistory = this.executionHistory.filter(r => r.actionType === result.actionType);
    const typeSuccesses = typeHistory.filter(r => r.success).length;
    typeMetrics.successRate = (typeSuccesses / typeHistory.length) * 100;
  }

  getMetrics(): OrchestratorMetrics {
    return { ...this.metrics };
  }

  getExecutionHistory(limit: number = 50): ActionExecutionResult[] {
    return this.executionHistory.slice(-limit);
  }

  shouldExecuteImmediately(workflowType: string, persona: PersonaType): boolean {
    const personaConfig = this.getPersonaConfig(persona);
    
    if (!personaConfig.actionFirstEnabled) {
      return false;
    }

    const workflow = ACTION_WORKFLOWS[workflowType];
    if (!workflow) {
      return false;
    }

    if (personaConfig.requiresConfirmationOverride) {
      return false;
    }

    return !workflow.requiresConfirmation;
  }

  validateMarkerFormat(marker: string): { valid: boolean; type: string | null; errors: string[] } {
    const errors: string[] = [];
    let type: string | null = null;

    const patterns: Record<string, RegExp> = {
      email_sent: /\[EMAIL_ENVOYÉ\s*:\s*to="[^"]+"\s*,\s*subject="[^"]+"/i,
      email_with_pdf: /\[EMAIL_AVEC_PDF\s*:\s*to="[^"]+"\s*,\s*subject="[^"]+"\s*,\s*body="[^"]*"\s*,\s*pdfTitle="[^"]+"\s*,\s*pdfContent="/i,
      email_with_word: /\[EMAIL_AVEC_WORD\s*:\s*to="[^"]+"\s*,\s*subject="[^"]+"\s*,\s*body="[^"]*"\s*,\s*wordTitle="[^"]+"\s*,\s*wordContent="/i,
      todoist_task: /\[TODOIST_CREER\s*:\s*tache="[^"]+"/i,
      kanban_task: /\[KANBAN_CREER\s*:\s*titre="[^"]+"/i,
      prono: /\[PRONO\s*:/i,
      domotique: /\[DOMOTIQUE\s*:/i
    };

    for (const [patternType, regex] of Object.entries(patterns)) {
      if (regex.test(marker)) {
        type = patternType;
        break;
      }
    }

    if (!type) {
      errors.push('Format de marqueur non reconnu');
    }

    if (type === 'email_with_pdf' || type === 'email_with_word') {
      const contentMatch = marker.match(/Content="([^"]*)"/i);
      if (contentMatch && contentMatch[1].length < 100) {
        errors.push('Contenu du document trop court (minimum 100 caractères)');
      }
    }

    return { valid: errors.length === 0, type, errors };
  }

  generateDiagnostics(): string {
    const metrics = this.getMetrics();
    const recentHistory = this.getExecutionHistory(10);
    
    let report = `
═══════════════════════════════════════════════════════════════
ACTION-FIRST ORCHESTRATOR - DIAGNOSTIC REPORT
═══════════════════════════════════════════════════════════════

METRIQUES GLOBALES:
- Total requetes: ${metrics.totalRequests}
- Workflows detectes: ${metrics.workflowsDetected} (${metrics.totalRequests > 0 ? ((metrics.workflowsDetected / metrics.totalRequests) * 100).toFixed(1) : 0}%)
- Actions executees: ${metrics.actionsExecuted}
- Taux de succes: ${metrics.actionsExecuted > 0 ? ((metrics.successfulActions / metrics.actionsExecuted) * 100).toFixed(1) : 0}%
- Temps moyen d'execution: ${metrics.averageExecutionTimeMs.toFixed(0)}ms

PAR TYPE DE WORKFLOW:
`;

    for (const [type, data] of Object.entries(metrics.byWorkflowType)) {
      report += `- ${type}: ${data.count} executions, ${data.successRate.toFixed(1)}% succes\n`;
    }

    report += `
HISTORIQUE RECENT (10 dernieres actions):
`;

    for (const action of recentHistory) {
      const status = action.success ? '[OK]' : '[FAIL]';
      const time = action.executedAt.toLocaleTimeString('fr-FR');
      report += `${status} [${time}] ${action.actionType}: ${action.marker.substring(0, 50)}... (${action.executionTimeMs}ms)\n`;
    }

    return report;
  }
}

export const actionFirstOrchestrator = new ActionFirstOrchestrator();

export default actionFirstOrchestrator;
