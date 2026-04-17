/**
 * BrainHub - Centre de conscience unifié d'Ulysse
 * 
 * Le cerveau central qui coordonne les 4 sens et maintient
 * l'état de conscience d'Ulysse en temps réel.
 * 
 * Architecture:
 * [HearingHub] ─┐
 * [VisionHub]  ─┼─→ [BrainHub] ─→ [CoreEngine] ─→ [VoiceOutputHub/ActionHub]
 * [Context]    ─┘
 */

import { EventEmitter } from 'events';
import { hearingHub, type HearingInput, type ProcessedHearing } from './HearingHub';
import { voiceOutputHub, type VoiceOutput, type DialogueMode } from './VoiceOutputHub';
import { visionHub, type VisionInput, type ProcessedVision } from './VisionHub';
import { actionHub, type ActionResult } from './ActionHub';
import { autonomousInitiativeEngine } from '../autonomousInitiativeEngine';
import { APP_PAGES, type AppPage } from '../../config/appNavigation';

// ============== TYPES ==============

export interface NavigationContext {
  pageId: string | null;
  tabId: string | null;
  pageLabel: string | null;
  availableActions: string[];
}

export interface ConsciousnessState {
  currentFocus: 'idle' | 'listening' | 'thinking' | 'speaking' | 'acting' | 'observing';
  activeUserId: number | null;
  activePersona: 'ulysse' | 'iris' | 'alfred' | 'maxai' | null;
  activeInterface: 'web' | 'discord' | 'api' | 'pwa' | null;
  navigationContext: NavigationContext;
  workingMemory: WorkingMemoryItem[];
  cognitiveLoad: number; // 0-100
  lastActivity: Date;
  isProcessing: boolean;
}

export interface WorkingMemoryItem {
  type: 'input' | 'output' | 'thought' | 'context';
  content: string;
  source: string;
  timestamp: Date;
  importance: number; // 0-100
  ttlMs: number;
}

export interface BrainEvent {
  type: 'input_received' | 'output_sent' | 'action_executed' | 'vision_processed' | 'state_changed' | 'decision_made';
  source: string;
  data: any;
  timestamp: Date;
}

export type UlysseDomainBrain = 'sports' | 'sugu' | 'dev' | 'personal' | 'generic' | 'finance' | 'monitoring' | 'email' | 'studio';

export interface BrainDecision {
  action: 'respond' | 'act' | 'observe' | 'wait' | 'escalate';
  reason: string;
  confidence: number;
  suggestedHub: 'voice' | 'action' | 'vision' | null;
  domain?: UlysseDomainBrain;
  strategy?: string;
}

export interface BrainStats {
  totalInputs: number;
  totalOutputs: number;
  totalActions: number;
  totalDecisions: number;
  avgCognitiveLoad: number;
  uptime: number;
  workingMemorySize: number;
}

interface UserDialogueState {
  mode: DialogueMode;
  maxSpokenSeconds: number;
  lastDomain?: UlysseDomainBrain;
  lastIntent?: string;
  awaitingConfirmation: boolean;
  continuationText?: string;
}

export type VoiceSessionState = 'idle' | 'listening' | 'thinking' | 'speaking';

interface VoiceSession {
  state: VoiceSessionState;
  lastUpdated: number;
  userId: number;
}

const voiceSessions = new Map<number, VoiceSession>();

export function setVoiceSessionState(userId: number, state: VoiceSessionState): void {
  voiceSessions.set(userId, { state, lastUpdated: Date.now(), userId });
}

export function getVoiceSessionState(userId: number): VoiceSession {
  return voiceSessions.get(userId) || { state: 'idle', lastUpdated: Date.now(), userId };
}

// ============== ATTENTION ENGINE ==============

type AttentionSource = 'web_voice' | 'web_chat' | 'discord_voice' | 'discord_text' | 'api' | 'system' | 'cron' | 'screen' | 'monitoring' | 'email' | 'siri' | 'notification' | 'sms';

interface AttentionSignal {
  source: AttentionSource;
  domain: UlysseDomainBrain;
  userId: number;
  content: string;
  isVoice: boolean;
  isOwner: boolean;
  urgencyHint?: 'critical' | 'high' | 'normal' | 'low';
  timestamp: number;
}

interface AttentionScore {
  priority: number;
  shouldProcess: boolean;
  shouldDefer: boolean;
  reason: string;
}

interface DeferredSignal {
  signal: AttentionSignal;
  score: AttentionScore;
  deferredAt: number;
  expiresAt: number;
}

export interface AttentionStats {
  totalEvaluated: number;
  totalProcessed: number;
  totalDeferred: number;
  totalDropped: number;
  deferredQueue: number;
  avgPriority: number;
}

const SOURCE_BASE_PRIORITY: Record<AttentionSource, number> = {
  web_voice: 0.9,
  siri: 0.85,
  web_chat: 0.8,
  discord_voice: 0.75,
  discord_text: 0.5,
  sms: 0.7,
  email: 0.4,
  api: 0.6,
  screen: 0.65,
  monitoring: 0.55,
  notification: 0.45,
  system: 0.3,
  cron: 0.2,
};

const DOMAIN_URGENCY_BOOST: Partial<Record<UlysseDomainBrain, number>> = {
  monitoring: 0.15,
  finance: 0.1,
  sugu: 0.05,
};

// ============== CONSTANTS ==============

const WORKING_MEMORY_MAX_ITEMS = 200;
const WORKING_MEMORY_DEFAULT_TTL = 30 * 60 * 1000;
const COGNITIVE_LOAD_DECAY_RATE = 0.1;
const COGNITIVE_LOAD_DECAY_INTERVAL = 1000;
const ATTENTION_DEFER_TTL = 10 * 60 * 1000;
const ATTENTION_PROCESS_THRESHOLD = 0.35;
const ATTENTION_DEFER_THRESHOLD = 0.25;

// ============== BRAIN HUB ==============

class BrainHub extends EventEmitter {
  private static instance: BrainHub;
  
  private consciousness: ConsciousnessState;
  private stats: BrainStats;
  private startTime: Date;
  private decayInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private dialogueStates: Map<number, UserDialogueState> = new Map();
  private deferredQueue: DeferredSignal[] = [];
  private attentionStats: AttentionStats = {
    totalEvaluated: 0,
    totalProcessed: 0,
    totalDeferred: 0,
    totalDropped: 0,
    deferredQueue: 0,
    avgPriority: 0,
  };

  private constructor() {
    super();
    this.startTime = new Date();
    
    this.consciousness = {
      currentFocus: 'idle',
      activeUserId: null,
      activePersona: null,
      activeInterface: null,
      navigationContext: {
        pageId: null,
        tabId: null,
        pageLabel: null,
        availableActions: [],
      },
      workingMemory: [],
      cognitiveLoad: 0,
      lastActivity: new Date(),
      isProcessing: false,
    };
    
    this.stats = {
      totalInputs: 0,
      totalOutputs: 0,
      totalActions: 0,
      totalDecisions: 0,
      avgCognitiveLoad: 0,
      uptime: 0,
      workingMemorySize: 0,
    };
    
    this.setupSensoryListeners();
    this.startBackgroundProcesses();
    
    console.log('[BrainHub] Centre de conscience unifié initialisé');
  }

  static getInstance(): BrainHub {
    if (!BrainHub.instance) {
      BrainHub.instance = new BrainHub();
    }
    return BrainHub.instance;
  }

  // ============== SENSORY INTEGRATION ==============

  private setupSensoryListeners(): void {
    // Écouter les entrées auditives
    hearingHub.onHear((hearing) => {
      this.processHearingInput(hearing as any);
    });

    // Écouter les sorties vocales
    voiceOutputHub.onSpeak((output) => {
      this.processVoiceOutput(output as any);
    });

    // Écouter les entrées visuelles
    visionHub.onSee((vision) => {
      this.processVisionInput(vision as any);
    });

    // Écouter les actions exécutées
    actionHub.onAction((log) => {
      this.processActionResult(log.result);
    });

    console.log('[BrainHub] Listeners sensoriels configurés');
  }

  private processHearingInput(input: HearingInput): void {
    this.stats.totalInputs++;

    const source = (input.metadata?.source || 'web_chat') as AttentionSource;
    const attentionScore = this.evaluateAttention({
      source,
      domain: 'generic',
      userId: input.metadata?.userId || 0,
      content: input.content,
      isVoice: input.metadata?.type === 'voice',
      isOwner: input.metadata?.userId === 1,
      timestamp: Date.now(),
    });

    if (!attentionScore.shouldProcess && !attentionScore.shouldDefer) {
      console.log(`[AttentionEngine] Dropped hearing input: ${attentionScore.reason}`);
      return;
    }
    if (attentionScore.shouldDefer) {
      console.log(`[AttentionEngine] Deferred hearing input: ${attentionScore.reason}`);
      return;
    }

    const userId = input.metadata?.userId || 0;
    if (input.metadata?.type === 'voice' || source === 'web_voice') {
      setVoiceSessionState(userId, 'listening');
    }

    this.updateFocus('listening');
    this.updateCognitiveLoad(15);
    
    if (input.metadata?.userId) {
      this.consciousness.activeUserId = input.metadata.userId;
    }
    if (input.metadata?.persona) {
      this.consciousness.activePersona = input.metadata.persona as any;
    }
    if (input.metadata?.source) {
      this.consciousness.activeInterface = this.mapSourceToInterface(input.metadata.source);
    }

    this.addToWorkingMemory({
      type: 'input',
      content: input.content,
      source: input.metadata?.source || 'unknown',
      timestamp: new Date(),
      importance: Math.round(attentionScore.priority * 100),
      ttlMs: WORKING_MEMORY_DEFAULT_TTL,
    });

    this.emitEvent('input_received', 'hearing', input);
  }

  private processVoiceOutput(output: VoiceOutput): void {
    this.stats.totalOutputs++;
    this.updateFocus('speaking');
    this.updateCognitiveLoad(-10);

    this.addToWorkingMemory({
      type: 'output',
      content: output.text.substring(0, 200),
      source: output.metadata?.destination || 'voice',
      timestamp: new Date(),
      importance: 60,
      ttlMs: WORKING_MEMORY_DEFAULT_TTL,
    });

    this.emitEvent('output_sent', 'voice', output);
  }

  private processVisionInput(input: ProcessedVision): void {
    this.updateFocus('observing');
    this.updateCognitiveLoad(20);

    if (input.text) {
      this.addToWorkingMemory({
        type: 'context',
        content: input.text.substring(0, 300),
        source: input.source || 'vision',
        timestamp: new Date(),
        importance: 40,
        ttlMs: WORKING_MEMORY_DEFAULT_TTL * 2,
      });
    }

    this.emitEvent('vision_processed', 'vision', input);
  }

  private processActionResult(result: ActionResult): void {
    this.stats.totalActions++;
    this.updateFocus('acting');
    this.updateCognitiveLoad(result.success ? -15 : 10);

    this.addToWorkingMemory({
      type: 'thought',
      content: `Action ${result.name}: ${result.success ? 'succès' : 'échec'}`,
      source: 'action',
      timestamp: new Date(),
      importance: result.success ? 50 : 80,
      ttlMs: WORKING_MEMORY_DEFAULT_TTL,
    });

    this.emitEvent('action_executed', 'action', result);
  }

  // ============== ATTENTION ENGINE ==============

  evaluateAttention(signal: AttentionSignal): AttentionScore {
    this.attentionStats.totalEvaluated++;
    const load = this.consciousness.cognitiveLoad;

    let priority = SOURCE_BASE_PRIORITY[signal.source] || 0.5;

    if (signal.isOwner) priority += 0.15;
    if (signal.isVoice) priority += 0.1;

    priority += DOMAIN_URGENCY_BOOST[signal.domain] || 0;

    const urgencyMap: Record<string, number> = { critical: 0.3, high: 0.15, normal: 0, low: -0.1 };
    priority += urgencyMap[signal.urgencyHint || 'normal'] || 0;

    if (this.consciousness.activeUserId === signal.userId && this.consciousness.currentFocus !== 'idle') {
      priority += 0.1;
    }

    const errorKeywords = /erreur|error|crash|down|urgente?|critique|critical|alerte?|alert/i;
    if (errorKeywords.test(signal.content)) {
      priority += 0.2;
    }

    priority = Math.max(0, Math.min(1, priority));

    const n = this.attentionStats.totalEvaluated;
    this.attentionStats.avgPriority = ((n - 1) * this.attentionStats.avgPriority + priority) / n;

    const loadPenalty = load > 70 ? 0.15 : load > 50 ? 0.05 : 0;
    const effectivePriority = priority - loadPenalty;

    if (effectivePriority >= ATTENTION_PROCESS_THRESHOLD) {
      this.attentionStats.totalProcessed++;
      return { priority, shouldProcess: true, shouldDefer: false, reason: `Priorité ${(priority * 100).toFixed(0)}% — traitement immédiat` };
    }

    if (effectivePriority >= ATTENTION_DEFER_THRESHOLD) {
      this.attentionStats.totalDeferred++;
      this.deferredQueue.push({
        signal,
        score: { priority, shouldProcess: false, shouldDefer: true, reason: `Charge cognitive ${load}% — différé` },
        deferredAt: Date.now(),
        expiresAt: Date.now() + ATTENTION_DEFER_TTL,
      });
      this.attentionStats.deferredQueue = this.deferredQueue.length;
      return { priority, shouldProcess: false, shouldDefer: true, reason: `Charge cognitive ${load}% — différé` };
    }

    this.attentionStats.totalDropped++;
    return { priority, shouldProcess: false, shouldDefer: false, reason: `Priorité trop basse (${(effectivePriority * 100).toFixed(0)}%) — ignoré` };
  }

  processDeferredSignals(): DeferredSignal[] {
    if (this.consciousness.cognitiveLoad > 40) return [];

    const now = Date.now();
    const ready: DeferredSignal[] = [];
    const remaining: DeferredSignal[] = [];

    for (const d of this.deferredQueue) {
      if (d.expiresAt < now) {
        this.attentionStats.totalDropped++;
        continue;
      }
      if (this.consciousness.cognitiveLoad < 30) {
        ready.push(d);
        this.attentionStats.totalProcessed++;
      } else {
        remaining.push(d);
      }
    }

    this.deferredQueue = remaining;
    this.attentionStats.deferredQueue = this.deferredQueue.length;

    if (ready.length > 0) {
      console.log(`[AttentionEngine] Processing ${ready.length} deferred signals (load: ${this.consciousness.cognitiveLoad}%)`);
    }

    return ready.sort((a, b) => b.score.priority - a.score.priority);
  }

  getAttentionStats(): AttentionStats {
    return { ...this.attentionStats, deferredQueue: this.deferredQueue.length };
  }

  // ============== CONSCIOUSNESS MANAGEMENT ==============

  private updateFocus(focus: ConsciousnessState['currentFocus']): void {
    const previous = this.consciousness.currentFocus;
    this.consciousness.currentFocus = focus;
    this.consciousness.lastActivity = new Date();
    
    if (previous !== focus) {
      this.emitEvent('state_changed', 'brain', { from: previous, to: focus });
    }
  }

  private updateCognitiveLoad(delta: number): void {
    this.consciousness.cognitiveLoad = Math.max(0, Math.min(100, 
      this.consciousness.cognitiveLoad + delta
    ));
    this.consciousness.isProcessing = this.consciousness.cognitiveLoad > 20;
  }

  addToWorkingMemory(item: WorkingMemoryItem): void {
    if (item.importance >= 70) {
      item.ttlMs = Math.max(item.ttlMs, 60 * 60 * 1000);
    } else if (item.importance >= 50) {
      item.ttlMs = Math.max(item.ttlMs, 45 * 60 * 1000);
    }

    this.consciousness.workingMemory.unshift(item);
    
    if (this.consciousness.workingMemory.length > WORKING_MEMORY_MAX_ITEMS) {
      this.consciousness.workingMemory.sort((a, b) => {
        const aValid = a.timestamp && typeof a.timestamp.getTime === 'function';
        const bValid = b.timestamp && typeof b.timestamp.getTime === 'function';
        if (!aValid) return 1;
        if (!bValid) return -1;
        const aAge = Date.now() - a.timestamp.getTime();
        const bAge = Date.now() - b.timestamp.getTime();
        const aScore = a.importance * Math.max(0.1, 1 - aAge / a.ttlMs);
        const bScore = b.importance * Math.max(0.1, 1 - bAge / b.ttlMs);
        return bScore - aScore;
      });
      this.consciousness.workingMemory = this.consciousness.workingMemory
        .slice(0, WORKING_MEMORY_MAX_ITEMS);
    }
    
    this.stats.workingMemorySize = this.consciousness.workingMemory.length;
  }

  private cleanupWorkingMemory(): void {
    const now = Date.now();
    this.consciousness.workingMemory = this.consciousness.workingMemory.filter(item => {
      if (!item.timestamp || typeof item.timestamp.getTime !== 'function') {
        return false;
      }
      const age = now - item.timestamp.getTime();
      return age < item.ttlMs;
    });
    this.stats.workingMemorySize = this.consciousness.workingMemory.length;
  }

  // ============== DECISION MAKING ==============

  makeDecision(context: { 
    input?: string; 
    userId?: number; 
    urgency?: 'low' | 'normal' | 'high';
    domain?: UlysseDomainBrain;
  }): BrainDecision {
    this.stats.totalDecisions++;
    
    const load = this.consciousness.cognitiveLoad;
    const hasRecentInput = this.consciousness.workingMemory.some(
      m => m.type === 'input' && m.timestamp && typeof m.timestamp.getTime === 'function' && Date.now() - m.timestamp.getTime() < 5000
    );
    
    let decision: BrainDecision;

    if (context.urgency === 'high' || hasRecentInput) {
      decision = {
        action: 'respond',
        reason: 'Input récent nécessitant une réponse',
        confidence: 0.9,
        suggestedHub: 'voice',
      };
    } else if (load > 80) {
      decision = {
        action: 'wait',
        reason: 'Charge cognitive élevée, attendre',
        confidence: 0.7,
        suggestedHub: null,
      };
    } else if (load < 20 && !hasRecentInput) {
      decision = {
        action: 'observe',
        reason: 'Charge faible, observer l\'environnement',
        confidence: 0.6,
        suggestedHub: 'vision',
      };
    } else {
      decision = {
        action: 'respond',
        reason: 'Traitement normal',
        confidence: 0.8,
        suggestedHub: 'voice',
      };
    }

    decision.domain = context.domain || 'generic';
    decision.strategy = this.inferStrategy(context.domain, context.input);

    this.emitEvent('decision_made', 'brain', decision);
    return decision;
  }

  private inferStrategy(domain?: string, input?: string): string {
    if (!domain || domain === 'generic') return 'standard_response';
    const strategies: Record<string, string> = {
      sports: 'sports_data_pipeline',
      sugu: 'sugu_management_pipeline',
      dev: 'dev_assistant_pipeline',
      personal: 'personal_assistant_pipeline',
      finance: 'payroll_hr_pipeline',
      monitoring: 'monitoring_apptoorder_pipeline',
      email: 'gmail_communication_pipeline',
      studio: 'studio_media_pipeline',
    };
    return strategies[domain] || 'standard_response';
  }

  // ============== DIALOGUE MODE MANAGEMENT ==============

  getDialogueState(userId: number): UserDialogueState {
    if (!this.dialogueStates.has(userId)) {
      this.dialogueStates.set(userId, {
        mode: 'short_answer',
        maxSpokenSeconds: userId === 1 ? 18 : 25,
        awaitingConfirmation: false,
      });
    }
    return this.dialogueStates.get(userId)!;
  }

  resolveDialogueMode(domain?: UlysseDomainBrain, intent?: string, isVoice?: boolean): { mode: DialogueMode; maxSpokenSeconds: number } {
    if (!isVoice) {
      return { mode: 'step_by_step', maxSpokenSeconds: 120 };
    }

    const actionIntents = [
      'create_event', 'send_email', 'reply', 'forward',
      'todo', 'reminder', 'alarm', 'spotify', 'smarthome',
      'discord_send', 'todoist',
    ];
    const intentStr = typeof intent === 'string' ? intent.toLowerCase() : '';
    if (intentStr && actionIntents.some(a => intentStr.includes(a))) {
      return { mode: 'action_only', maxSpokenSeconds: 10 };
    }

    const explanationIntents = ['explain', 'tutorial', 'debug', 'analyze', 'detail', 'compare'];
    if (intentStr && explanationIntents.some(e => intentStr.includes(e))) {
      return { mode: 'step_by_step', maxSpokenSeconds: 45 };
    }

    if (domain === 'sports') return { mode: 'short_answer', maxSpokenSeconds: 20 };
    if (domain === 'finance') return { mode: 'short_answer', maxSpokenSeconds: 20 };
    if (domain === 'monitoring') return { mode: 'action_only', maxSpokenSeconds: 15 };
    if (domain === 'sugu') return { mode: 'short_answer', maxSpokenSeconds: 25 };
    if (domain === 'dev') return { mode: 'step_by_step', maxSpokenSeconds: 40 };
    if (domain === 'studio') return { mode: 'action_only', maxSpokenSeconds: 10 };

    return { mode: 'short_answer', maxSpokenSeconds: 25 };
  }

  updateDialogueState(userId: number, domain?: UlysseDomainBrain, intent?: string, isVoice?: boolean): UserDialogueState {
    const prev = this.dialogueStates.get(userId);
    const resolved = this.resolveDialogueMode(domain, intent, isVoice);

    const intentLc = typeof intent === 'string' ? intent.toLowerCase() : '';
    if (prev?.awaitingConfirmation && intentLc && ['oui', 'yes', 'continue', 'suite', 'go'].some(w => intentLc.includes(w))) {
      const state: UserDialogueState = {
        ...resolved,
        lastDomain: domain,
        lastIntent: intent,
        awaitingConfirmation: false,
        continuationText: prev.continuationText,
      };
      this.dialogueStates.set(userId, state);
      return state;
    }

    const state: UserDialogueState = {
      ...resolved,
      lastDomain: domain,
      lastIntent: intent,
      awaitingConfirmation: false,
    };
    this.dialogueStates.set(userId, state);
    return state;
  }

  setAwaitingConfirmation(userId: number, continuation?: string): void {
    const state = this.getDialogueState(userId);
    state.awaitingConfirmation = true;
    state.continuationText = continuation;
    this.dialogueStates.set(userId, state);
  }

  getVoiceSession(userId: number): VoiceSession {
    return getVoiceSessionState(userId);
  }

  setVoiceSession(userId: number, state: VoiceSessionState): void {
    setVoiceSessionState(userId, state);
  }

  // ============== CONTEXT FOR CORE ENGINE ==============

  getContextForCoreEngine(): {
    workingMemory: string[];
    recentInputs: string[];
    cognitiveState: string;
    focus: string;
  } {
    const recentInputs = this.consciousness.workingMemory
      .filter(m => m.type === 'input')
      .slice(0, 5)
      .map(m => m.content);

    const contextItems = this.consciousness.workingMemory
      .filter(m => m.type === 'context' || m.type === 'thought')
      .slice(0, 3)
      .map(m => m.content);

    let cognitiveState = 'normal';
    if (this.consciousness.cognitiveLoad > 70) cognitiveState = 'surchargé';
    else if (this.consciousness.cognitiveLoad < 20) cognitiveState = 'détendu';

    return {
      workingMemory: contextItems,
      recentInputs,
      cognitiveState,
      focus: this.consciousness.currentFocus,
    };
  }

  // ============== BACKGROUND PROCESSES ==============

  private startBackgroundProcesses(): void {
    this.decayInterval = setInterval(() => {
      if (this.consciousness.currentFocus === 'idle') {
        this.updateCognitiveLoad(-COGNITIVE_LOAD_DECAY_RATE * 10);
      }
      
      const idleTime = Date.now() - this.consciousness.lastActivity.getTime();
      if (idleTime > 10000 && this.consciousness.currentFocus !== 'idle') {
        this.updateFocus('idle');
      }

      if (this.consciousness.currentFocus === 'idle' && this.deferredQueue.length > 0) {
        const processed = this.processDeferredSignals();
        for (const d of processed) {
          this.addToWorkingMemory({
            type: 'context',
            content: `[Deferred] ${d.signal.source}/${d.signal.domain}: ${d.signal.content.substring(0, 100)}`,
            source: 'attention',
            timestamp: new Date(),
            importance: Math.round(d.score.priority * 100),
            ttlMs: WORKING_MEMORY_DEFAULT_TTL,
          });
          this.emitEvent('input_received', 'attention_deferred', d.signal);
        }
      }
    }, COGNITIVE_LOAD_DECAY_INTERVAL);

    this.cleanupInterval = setInterval(() => {
      this.cleanupWorkingMemory();
    }, 30000);
  }

  // ============== HELPERS ==============

  private mapSourceToInterface(source: string): ConsciousnessState['activeInterface'] {
    if (source.includes('discord')) return 'discord';
    if (source.includes('api')) return 'api';
    if (source.includes('pwa')) return 'pwa';
    return 'web';
  }

  private emitEvent(type: BrainEvent['type'], source: string, data: any): void {
    const event: BrainEvent = {
      type,
      source,
      data,
      timestamp: new Date(),
    };
    this.emit('event', event);
    this.emit(type, event);
  }

  // ============== CHEF D'ORCHESTRE - PROCESS INPUT ==============

  /**
   * Point d'entrée principal du chef d'orchestre
   * Route tous les inputs vers le traitement approprié
   */
  async processInput(input: {
    content: string;
    source: 'web_chat' | 'talking_v3' | 'discord_text' | 'discord_voice' | 'api';
    userId: number;
    persona: 'ulysse' | 'iris' | 'alfred' | 'maxai';
    isVoice: boolean;
    pageId?: string;
    tabId?: string;
    metadata?: Record<string, any>;
  }): Promise<{
    response: string;
    shouldSpeak: boolean;
    actions: any[];
    decision: BrainDecision;
    dialogueMode: DialogueMode;
    maxSpokenSeconds: number;
  }> {
    const startTime = Date.now();
    this.consciousness.isProcessing = true;
    this.updateFocus('thinking');
    this.updateCognitiveLoad(25);

    const iface = this.mapSourceToInterface(input.source);
    this.setActiveContext(
      input.userId,
      input.persona,
      iface || 'web'
    );

    if (input.pageId) {
      this.updateNavigationContext(input.pageId, input.tabId);
    }

    // 2. Ajouter à la mémoire de travail
    this.addToWorkingMemory({
      type: 'input',
      content: input.content,
      source: input.source,
      timestamp: new Date(),
      importance: input.isVoice ? 85 : 70,
      ttlMs: WORKING_MEMORY_DEFAULT_TTL,
    });

    const inputDomain = input.metadata?.domain as BrainDecision['domain'] | undefined;
    const decision = this.makeDecision({
      input: input.content,
      userId: input.userId,
      urgency: input.isVoice ? 'high' : 'normal',
      domain: inputDomain,
    });

    const dialogueState = this.updateDialogueState(
      input.userId,
      inputDomain,
      input.metadata?.intent as string | undefined,
      input.isVoice
    );
    console.log(`[BrainHub] DialogueMode: ${dialogueState.mode} (${dialogueState.maxSpokenSeconds}s max) for domain=${inputDomain || 'generic'}`);

    const brainContext = this.getContextForCoreEngine();
    
    // 5. Journaliser le processing
    this.addToWorkingMemory({
      type: 'thought',
      content: `Processing: ${decision.action} (${(decision.confidence * 100).toFixed(0)}% confiance)`,
      source: 'brain',
      timestamp: new Date(),
      importance: 40,
      ttlMs: 60000,
    });

    const processingTime = Date.now() - startTime;
    console.log(`[BrainHub] 🧠 processInput: source=${input.source}, decision=${decision.action}, time=${processingTime}ms`);

    // 6. Mettre à jour l'état final
    this.consciousness.isProcessing = false;
    this.updateCognitiveLoad(-10);

    return {
      response: '',
      shouldSpeak: input.isVoice || input.source.includes('voice'),
      actions: [],
      decision,
      dialogueMode: dialogueState.mode,
      maxSpokenSeconds: dialogueState.maxSpokenSeconds,
    };
  }

  /**
   * Obtient le prompt de conscience à injecter dans le contexte AI
   */
  getConsciousnessPrompt(): string {
    const ctx = this.getContextForCoreEngine();
    const c = this.consciousness;
    
    let prompt = `[ÉTAT MENTAL ULYSSE]\n`;
    prompt += `Focus: ${c.currentFocus} | Charge cognitive: ${c.cognitiveLoad}% | État: ${ctx.cognitiveState}\n`;
    
    if (c.navigationContext.pageId) {
      prompt += `Page active: ${c.navigationContext.pageLabel || c.navigationContext.pageId}`;
      if (c.navigationContext.tabId) {
        prompt += ` (onglet: ${c.navigationContext.tabId})`;
      }
      prompt += '\n';
      if (c.navigationContext.availableActions.length > 0) {
        prompt += `Actions possibles: ${c.navigationContext.availableActions.slice(0, 5).join(', ')}\n`;
      }
    }
    
    if (ctx.workingMemory.length > 0) {
      prompt += `Contexte récent: ${ctx.workingMemory.slice(0, 2).join(' | ')}\n`;
    }
    
    if (c.activeUserId) {
      prompt += `Interlocuteur actif: User #${c.activeUserId} via ${c.activeInterface}\n`;
    }

    if (this.deferredQueue.length > 0) {
      prompt += `Attention: ${this.deferredQueue.length} signal(s) en attente\n`;
    }

    const initiativePrompt = autonomousInitiativeEngine.generateInitiativePrompt();
    if (initiativePrompt) {
      prompt += initiativePrompt + '\n';
    }

    try {
      const { pugi } = require("../proactiveGeneralIntelligence");
      const pugiBlock = pugi.generatePromptBlock();
      if (pugiBlock) {
        prompt += pugiBlock + '\n';
      }
    } catch {}
    
    return prompt;
  }

  /**
   * Vérifie si le BrainHub peut traiter un nouvel input
   */
  canProcess(): { ready: boolean; reason: string } {
    if (this.consciousness.cognitiveLoad >= 95) {
      return { ready: false, reason: 'Charge cognitive maximale' };
    }
    if (this.consciousness.isProcessing) {
      return { ready: false, reason: 'Traitement en cours' };
    }
    return { ready: true, reason: 'Prêt' };
  }

  /**
   * Force le reset de l'état de processing (en cas de timeout)
   */
  resetProcessingState(): void {
    this.consciousness.isProcessing = false;
    this.updateFocus('idle');
    this.updateCognitiveLoad(-20);
    console.log('[BrainHub] État de processing réinitialisé');
  }

  // ============== PUBLIC API ==============

  getConsciousness(): ConsciousnessState {
    return { ...this.consciousness };
  }

  getStats(): BrainStats {
    return {
      ...this.stats,
      uptime: Date.now() - this.startTime.getTime(),
      avgCognitiveLoad: this.consciousness.cognitiveLoad,
    };
  }

  setActiveContext(userId: number, persona: 'ulysse' | 'iris' | 'alfred' | 'maxai', iface: 'web' | 'discord' | 'api' | 'pwa'): void {
    this.consciousness.activeUserId = userId;
    this.consciousness.activePersona = persona;
    this.consciousness.activeInterface = iface;
    this.consciousness.lastActivity = new Date();
  }

  updateNavigationContext(pageId: string, tabId?: string): void {
    const page = APP_PAGES.find((p: AppPage) => p.pageId === pageId);
    if (!page) {
      console.warn(`[BrainHub] Unknown pageId: ${pageId}`);
      return;
    }

    const tab = tabId && page.tabs
      ? page.tabs.find((t) => t.id === tabId)
      : null;

    this.consciousness.navigationContext = {
      pageId,
      tabId: tabId || null,
      pageLabel: tab ? `${page.label} > ${tab.label}` : page.label,
      availableActions: tab ? tab.actions : (page.tabs ? page.tabs.flatMap((t) => t.actions) : []),
    };
  }

  getNavigationContext(): NavigationContext {
    return { ...this.consciousness.navigationContext };
  }

  addThought(content: string, importance: number = 50): void {
    this.addToWorkingMemory({
      type: 'thought',
      content,
      source: 'internal',
      timestamp: new Date(),
      importance,
      ttlMs: WORKING_MEMORY_DEFAULT_TTL,
    });
  }

  /**
   * Store detailed invoice data in working memory
   * Stores supplier info, totals, AND all line items with prices
   */
  storeInvoice(invoice: {
    fournisseur: string;
    numeroFacture: string;
    dateFacture: string;
    totalHT: number;
    totalTVA: number;
    totalTTC: number;
    lignes: Array<{
      reference?: string;
      designation: string;
      quantite: number;
      unite?: string;
      prixUnitaire: number;
      montantHT: number;
      tauxTVA?: number;
    }>;
    validated: boolean;
  }): void {
    const TTL_INVOICE = 2 * 365 * 24 * 60 * 60 * 1000; // 2 YEARS for invoice data (legal retention)
    
    // Store supplier summary
    const supplierInfo = `🏪 Fournisseur: ${invoice.fournisseur} | Facture n°${invoice.numeroFacture} du ${invoice.dateFacture}`;
    this.addToWorkingMemory({
      type: 'context',
      content: supplierInfo,
      source: 'invoice_analyzer',
      timestamp: new Date(),
      importance: 90,
      ttlMs: TTL_INVOICE,
    });

    // Store financial totals
    const totalsInfo = `💰 Totaux: HT=${invoice.totalHT.toFixed(2)}€ | TVA=${invoice.totalTVA.toFixed(2)}€ | TTC=${invoice.totalTTC.toFixed(2)}€ | ${invoice.validated ? '✓ Validé' : '⚠ Erreur'}`;
    this.addToWorkingMemory({
      type: 'context',
      content: totalsInfo,
      source: 'invoice_analyzer',
      timestamp: new Date(),
      importance: 85,
      ttlMs: TTL_INVOICE,
    });

    // Store each article line with details
    const articlesDetails = invoice.lignes.map((line, idx) => {
      const ref = line.reference ? `[${line.reference}]` : '';
      const unite = line.unite || 'u';
      const prixDisplay = unite.toLowerCase().includes('kg') 
        ? `${line.prixUnitaire.toFixed(2)}€/kg` 
        : `${line.prixUnitaire.toFixed(2)}€/u`;
      return `${idx + 1}. ${ref} ${line.designation} | Qté: ${line.quantite} ${unite} × ${prixDisplay} = ${line.montantHT.toFixed(2)}€ HT`;
    }).join('\n');

    this.addToWorkingMemory({
      type: 'context',
      content: `📦 Articles (${invoice.lignes.length}):\n${articlesDetails}`,
      source: 'invoice_analyzer',
      timestamp: new Date(),
      importance: 80,
      ttlMs: TTL_INVOICE,
    });

    // Log top 5 most expensive items
    const topExpensive = [...invoice.lignes]
      .sort((a, b) => b.montantHT - a.montantHT)
      .slice(0, 5)
      .map((l, i) => `${i + 1}. ${l.designation}: ${l.montantHT.toFixed(2)}€`)
      .join(' | ');
    
    this.addToWorkingMemory({
      type: 'thought',
      content: `🔝 Top 5 articles coûteux: ${topExpensive}`,
      source: 'invoice_analyzer',
      timestamp: new Date(),
      importance: 75,
      ttlMs: TTL_INVOICE,
    });

    console.log(`[BrainHub] 🧾 Facture ${invoice.numeroFacture} stockée: ${invoice.lignes.length} articles, ${invoice.totalTTC.toFixed(2)}€ TTC`);
  }

  isReady(): boolean {
    return this.consciousness.cognitiveLoad < 90 && !this.consciousness.isProcessing;
  }

  shutdown(): void {
    if (this.decayInterval) clearInterval(this.decayInterval);
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    console.log('[BrainHub] Arrêt du centre de conscience');
  }
}

// ============== SINGLETON EXPORT ==============

export const brainHub = BrainHub.getInstance();
export default brainHub;
