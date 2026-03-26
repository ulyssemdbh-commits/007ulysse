import OpenAI from "openai";
import { ResponseLearningService } from "./ResponseLearningService";
import { PatternRecognitionService } from "./PatternRecognitionService";
import { DecisionCacheService } from "./DecisionCacheService";
import { CoreEvolutionService } from "./CoreEvolutionService";
import { globalOptimizerService } from "../globalOptimizerService";

export interface CoreContext {
  userId: number;
  persona: 'ulysse' | 'iris' | 'alfred';
  hasFamilyAccess: boolean;
  conversationId?: number;
  messageHistory?: Array<{ role: string; content: string }>;
  brainContext?: string;
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
}

export interface CoreRequest {
  message: string;
  context: CoreContext;
  stream?: boolean;
}

export type ConfidenceLevel = 'certain' | 'probable' | 'incertain';

export interface ConfidenceFactors {
  sourceType: number;
  marsVerification: number;
  memorySupport: number;
  toolResultQuality: number;
  domainExpertise: number;
}

export interface CoreResponse {
  content: string;
  source: 'cache' | 'pattern' | 'learned' | 'provider';
  provider?: 'openai' | 'gemini' | 'grok' | 'local';
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  confidenceFactors?: ConfidenceFactors;
  toolCalls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
  metadata?: {
    tokensUsed?: number;
    latencyMs?: number;
    patternId?: string;
    learnedFromId?: string;
  };
}

export interface ProviderConfig {
  name: 'openai' | 'gemini' | 'grok' | 'local';
  priority: number;
  enabled: boolean;
  model: string;
  maxTokens: number;
  temperature: number;
}

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
  cooldownMs: number;
  successStreak: number;
  totalCalls: number;
  totalFailures: number;
  avgLatencyMs: number;
}

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  { name: 'openai', priority: 1, enabled: true, model: 'gpt-4o', maxTokens: 4096, temperature: 0.7 },
  { name: 'gemini', priority: 2, enabled: true, model: 'gemini-2.0-flash', maxTokens: 4096, temperature: 0.7 },
  { name: 'grok', priority: 3, enabled: !!process.env.XAI_API_KEY, model: 'grok-2-1212', maxTokens: 8192, temperature: 0.7 },
  { name: 'local', priority: 4, enabled: false, model: 'llama3', maxTokens: 2048, temperature: 0.7 }
];

const CIRCUIT_BREAKER_DEFAULTS = {
  maxFailures: 3,
  cooldownMs: 60000,
  maxCooldownMs: 300000,
  halfOpenTimeout: 30000,
};

export class UlysseCoreEngine {
  private responseLearning: ResponseLearningService;
  private patternRecognition: PatternRecognitionService;
  private decisionCache: DecisionCacheService;
  private coreEvolution: CoreEvolutionService;
  private providers: ProviderConfig[];
  private openai: OpenAI;
  
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  
  private stats = {
    totalRequests: 0,
    cacheHits: 0,
    patternMatches: 0,
    learnedResponses: 0,
    providerCalls: 0,
    errorCount: 0,
    avgLatencyMs: 0,
    tokensSaved: 0,
    fallbacksTriggered: 0,
    circuitBreaks: 0,
  };

  constructor() {
    this.responseLearning = new ResponseLearningService();
    this.patternRecognition = new PatternRecognitionService();
    this.decisionCache = new DecisionCacheService();
    this.coreEvolution = new CoreEvolutionService();
    this.providers = [...DEFAULT_PROVIDERS];
    
    this.openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
    });
    
    for (const p of this.providers) {
      this.circuitBreakers.set(p.name, {
        failures: 0, lastFailure: 0, state: 'closed',
        cooldownMs: CIRCUIT_BREAKER_DEFAULTS.cooldownMs,
        successStreak: 0, totalCalls: 0, totalFailures: 0, avgLatencyMs: 0,
      });
    }
    
    console.log('[UlysseCore] Engine initialized with providers:', this.providers.filter(p => p.enabled).map(p => p.name));
    console.log('[UlysseCore] Circuit breakers active for all providers');
  }

  private isProviderAvailable(name: string): boolean {
    const cb = this.circuitBreakers.get(name);
    if (!cb) return true;
    if (cb.state === 'closed') return true;
    if (cb.state === 'open') {
      if (Date.now() - cb.lastFailure > cb.cooldownMs) {
        cb.state = 'half-open';
        console.log(`[CircuitBreaker] ${name}: OPEN → HALF-OPEN (testing)`);
        return true;
      }
      return false;
    }
    return true;
  }

  private recordProviderSuccess(name: string, latencyMs: number): void {
    const cb = this.circuitBreakers.get(name);
    if (!cb) return;
    cb.totalCalls++;
    cb.successStreak++;
    cb.avgLatencyMs = (cb.avgLatencyMs * (cb.totalCalls - 1) + latencyMs) / cb.totalCalls;
    if (cb.state === 'half-open') {
      cb.state = 'closed';
      cb.failures = 0;
      cb.cooldownMs = CIRCUIT_BREAKER_DEFAULTS.cooldownMs;
      console.log(`[CircuitBreaker] ${name}: HALF-OPEN → CLOSED (recovered)`);
    }
  }

  private recordProviderFailure(name: string, error: string): void {
    const cb = this.circuitBreakers.get(name);
    if (!cb) return;
    cb.totalCalls++;
    cb.totalFailures++;
    cb.failures++;
    cb.successStreak = 0;
    cb.lastFailure = Date.now();
    if (cb.failures >= CIRCUIT_BREAKER_DEFAULTS.maxFailures) {
      cb.state = 'open';
      cb.cooldownMs = Math.min(cb.cooldownMs * 2, CIRCUIT_BREAKER_DEFAULTS.maxCooldownMs);
      this.stats.circuitBreaks++;
      console.log(`[CircuitBreaker] ${name}: → OPEN (${cb.failures} failures, cooldown ${cb.cooldownMs / 1000}s) — ${error}`);
    }
  }

  getProviderHealth(): Record<string, { state: string; failures: number; successRate: number; avgLatencyMs: number }> {
    const health: Record<string, any> = {};
    for (const [name, cb] of this.circuitBreakers) {
      health[name] = {
        state: cb.state,
        failures: cb.failures,
        successRate: cb.totalCalls > 0 ? ((cb.totalCalls - cb.totalFailures) / cb.totalCalls * 100).toFixed(1) + '%' : 'N/A',
        avgLatencyMs: Math.round(cb.avgLatencyMs),
      };
    }
    return health;
  }

  async process(request: CoreRequest): Promise<CoreResponse> {
    const startTime = Date.now();
    this.stats.totalRequests++;
    
    try {
      const cacheKey = this.buildCacheKey(request);
      const cachedResponse = await this.decisionCache.get(cacheKey);
      if (cachedResponse) {
        this.stats.cacheHits++;
        console.log('[UlysseCore] Cache hit for request');
        return {
          ...cachedResponse,
          source: 'cache' as const,
          confidenceLevel: UlysseCoreEngine.getConfidenceLevel(cachedResponse.confidence || 0.9),
          metadata: { ...cachedResponse.metadata, latencyMs: Date.now() - startTime }
        };
      }

      const patternMatch = await this.patternRecognition.match(request.message, request.context);
      if (patternMatch && patternMatch.confidence > 0.85) {
        this.stats.patternMatches++;
        console.log(`[UlysseCore] Pattern match: ${patternMatch.patternId} (confidence: ${patternMatch.confidence})`);
        const response: CoreResponse = {
          content: patternMatch.response,
          source: 'pattern',
          confidence: patternMatch.confidence,
          confidenceLevel: UlysseCoreEngine.getConfidenceLevel(patternMatch.confidence),
          metadata: { patternId: patternMatch.patternId, latencyMs: Date.now() - startTime }
        };
        await this.decisionCache.set(cacheKey, response);
        return response;
      }

      const learnedResponse = await this.responseLearning.findSimilar(request.message, request.context);
      if (learnedResponse && learnedResponse.confidence > 0.78) {
        this.stats.learnedResponses++;
        console.log(`[UlysseCore] Learned response used (confidence: ${learnedResponse.confidence})`);
        const response: CoreResponse = {
          content: learnedResponse.response,
          source: 'learned',
          confidence: learnedResponse.confidence,
          confidenceLevel: UlysseCoreEngine.getConfidenceLevel(learnedResponse.confidence),
          metadata: { learnedFromId: learnedResponse.sourceId, latencyMs: Date.now() - startTime }
        };
        await this.decisionCache.set(cacheKey, response);
        return response;
      }

      const providerResponse = await this.callProvider(request);
      this.stats.providerCalls++;

      await this.responseLearning.learn(request.message, providerResponse.content, request.context);
      await this.patternRecognition.analyze(request.message, providerResponse.content, request.context);
      await this.decisionCache.set(cacheKey, providerResponse);
      await this.coreEvolution.recordInteraction({
        request: request.message,
        response: providerResponse.content,
        source: providerResponse.source,
        latencyMs: Date.now() - startTime,
        userId: request.context.userId
      });

      providerResponse.metadata = { 
        ...providerResponse.metadata, 
        latencyMs: Date.now() - startTime 
      };
      
      this.updateStats(Date.now() - startTime);
      return providerResponse;
      
    } catch (error: any) {
      this.stats.errorCount++;
      console.error('[UlysseCore] Error processing request:', error.message);
      throw error;
    }
  }

  async processStream(request: CoreRequest): AsyncIterable<string> {
    const startTime = Date.now();
    this.stats.totalRequests++;
    
    const cacheKey = this.buildCacheKey(request);
    const cachedResponse = await this.decisionCache.get(cacheKey);
    if (cachedResponse) {
      this.stats.cacheHits++;
      return this.yieldContent(cachedResponse.content);
    }

    const patternMatch = await this.patternRecognition.match(request.message, request.context);
    if (patternMatch && patternMatch.confidence > 0.85) {
      this.stats.patternMatches++;
      return this.yieldContent(patternMatch.response);
    }

    this.stats.providerCalls++;
    return this.streamFromProvider(request, startTime);
  }

  private async *yieldContent(content: string): AsyncIterable<string> {
    const words = content.split(' ');
    for (const word of words) {
      yield word + ' ';
      await new Promise(r => setTimeout(r, 10));
    }
  }

  private async *streamFromProvider(request: CoreRequest, startTime: number): AsyncIterable<string> {
    const provider = this.selectProvider();
    let fullContent = '';
    
    if (provider.name === 'openai') {
      const messages = this.buildMessages(request);
      const stream = await this.openai.chat.completions.create({
        model: provider.model,
        messages,
        temperature: provider.temperature,
        max_tokens: provider.maxTokens,
        stream: true
      });
      
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullContent += content;
          yield content;
        }
      }
    } else if (provider.name === 'gemini') {
      const { GoogleGenerativeAI } = await import("@google/generative-ai");
      const genAI = new GoogleGenerativeAI(process.env.AI_INTEGRATIONS_GEMINI_API_KEY || '');
      const model = genAI.getGenerativeModel({ model: provider.model });
      
      const result = await model.generateContentStream(request.message);
      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          fullContent += text;
          yield text;
        }
      }
    }

    await this.responseLearning.learn(request.message, fullContent, request.context);
    await this.patternRecognition.analyze(request.message, fullContent, request.context);
    await this.decisionCache.set(this.buildCacheKey(request), {
      content: fullContent,
      source: 'provider',
      provider: provider.name,
      confidence: 0.75,
      confidenceLevel: 'probable' as ConfidenceLevel,
    });
    
    this.updateStats(Date.now() - startTime);
  }

  private async callProvider(request: CoreRequest): Promise<CoreResponse> {
    const availableProviders = this.getAvailableProviders();
    if (availableProviders.length === 0) {
      throw new Error('All AI providers are unavailable (circuit breakers open)');
    }

    let lastError: Error | null = null;
    for (let i = 0; i < availableProviders.length; i++) {
      const provider = availableProviders[i];
      const startMs = Date.now();
      
      if (i > 0) {
        this.stats.fallbacksTriggered++;
        console.log(`[UlysseCore] Fallback → ${provider.name} (attempt ${i + 1}/${availableProviders.length})`);
      }

      try {
        const response = await this.callSingleProvider(provider, request);
        this.recordProviderSuccess(provider.name, Date.now() - startMs);
        return response;
      } catch (error: any) {
        lastError = error;
        const errMsg = error.message || 'Unknown error';
        this.recordProviderFailure(provider.name, errMsg);
        console.error(`[UlysseCore] Provider ${provider.name} failed: ${errMsg}`);
      }
    }

    throw lastError || new Error('All providers failed');
  }

  private async callSingleProvider(provider: ProviderConfig, request: CoreRequest): Promise<CoreResponse> {
    if (provider.name === 'openai') {
      const messages = this.buildMessages(request);
      const completion = await this.openai.chat.completions.create({
        model: provider.model,
        messages,
        temperature: provider.temperature,
        max_tokens: provider.maxTokens,
        tools: request.context.tools
      });
      
      const choice = completion.choices[0];
      return {
        content: choice.message.content || '',
        source: 'provider',
        provider: 'openai',
        confidence: 0.75,
        confidenceLevel: 'probable' as ConfidenceLevel,
        toolCalls: choice.message.tool_calls,
        metadata: { tokensUsed: completion.usage?.total_tokens }
      };
    } else if (provider.name === 'gemini') {
      const { GoogleGenerativeAI } = await import("@google/generative-ai");
      const genAI = new GoogleGenerativeAI(process.env.AI_INTEGRATIONS_GEMINI_API_KEY || '');
      const model = genAI.getGenerativeModel({ model: provider.model });
      
      const result = await model.generateContent(request.message);
      const response = result.response;
      
      return {
        content: response.text(),
        source: 'provider',
        provider: 'gemini',
        confidence: 0.7,
        confidenceLevel: 'probable' as ConfidenceLevel,
      };
    }
    
    throw new Error(`Provider ${provider.name} not implemented`);
  }

  private buildMessages(request: CoreRequest): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    
    if (request.context.brainContext) {
      messages.push({ role: 'system', content: request.context.brainContext });
    }
    
    if (request.context.messageHistory) {
      for (const msg of request.context.messageHistory) {
        messages.push({ 
          role: msg.role as 'user' | 'assistant' | 'system', 
          content: msg.content 
        });
      }
    }
    
    messages.push({ role: 'user', content: request.message });
    return messages;
  }

  private getAvailableProviders(): ProviderConfig[] {
    return this.providers
      .filter(p => p.enabled && this.isProviderAvailable(p.name))
      .sort((a, b) => a.priority - b.priority);
  }

  private selectProvider(): ProviderConfig {
    const available = this.getAvailableProviders();
    if (available.length === 0) {
      const enabled = this.providers.filter(p => p.enabled).sort((a, b) => a.priority - b.priority);
      if (enabled.length === 0) throw new Error('No providers enabled');
      console.log(`[UlysseCore] All circuit breakers open, forcing ${enabled[0].name}`);
      return enabled[0];
    }
    return available[0];
  }

  private buildCacheKey(request: CoreRequest): string {
    const hash = this.simpleHash(request.message);
    return `core:${request.context.userId}:${request.context.persona}:${hash}`;
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  private updateStats(latencyMs: number): void {
    const totalLatency = this.stats.avgLatencyMs * (this.stats.totalRequests - 1) + latencyMs;
    this.stats.avgLatencyMs = totalLatency / this.stats.totalRequests;
  }

  static getConfidenceLevel(confidence: number): ConfidenceLevel {
    if (confidence > 0.85) return 'certain';
    if (confidence >= 0.6) return 'probable';
    return 'incertain';
  }

  static calculateConfidence(options: {
    source: 'cache' | 'pattern' | 'learned' | 'provider';
    provider?: string;
    hasToolResults?: boolean;
    toolSuccess?: boolean;
    hasMemorySupport?: boolean;
    hasMarsVerification?: boolean;
    domain?: string;
    brainConfidence?: number;
    hasContextualData?: boolean;
  }): { confidence: number; confidenceLevel: ConfidenceLevel; factors: ConfidenceFactors } {
    const factors: ConfidenceFactors = {
      sourceType: 0,
      marsVerification: 0,
      memorySupport: 0,
      toolResultQuality: 0,
      domainExpertise: 0,
    };

    switch (options.source) {
      case 'cache': factors.sourceType = 0.9; break;
      case 'pattern': factors.sourceType = 0.85; break;
      case 'learned': factors.sourceType = 0.8; break;
      case 'provider':
        factors.sourceType = options.provider === 'openai' ? 0.75 : options.provider === 'gemini' ? 0.7 : 0.6;
        break;
    }

    factors.marsVerification = options.hasMarsVerification ? 0.95 : 0.5;
    factors.memorySupport = options.hasMemorySupport ? 0.9 : 0.5;

    if (options.hasToolResults) {
      factors.toolResultQuality = options.toolSuccess ? 0.95 : 0.3;
    } else {
      factors.toolResultQuality = 0.5;
    }

    const knownDomains = ['sports', 'sugu', 'dev', 'personal', 'finance'];
    factors.domainExpertise = knownDomains.includes(options.domain || '') ? 0.85 : 0.6;

    if (options.hasContextualData) {
      factors.domainExpertise = Math.min(1, factors.domainExpertise + 0.1);
    }

    const weights = { sourceType: 0.3, marsVerification: 0.2, memorySupport: 0.15, toolResultQuality: 0.2, domainExpertise: 0.15 };
    let confidence = 
      factors.sourceType * weights.sourceType +
      factors.marsVerification * weights.marsVerification +
      factors.memorySupport * weights.memorySupport +
      factors.toolResultQuality * weights.toolResultQuality +
      factors.domainExpertise * weights.domainExpertise;

    if (options.brainConfidence !== undefined) {
      confidence = confidence * 0.7 + options.brainConfidence * 0.3;
    }

    confidence = Math.max(0, Math.min(1, confidence));

    return {
      confidence,
      confidenceLevel: UlysseCoreEngine.getConfidenceLevel(confidence),
      factors,
    };
  }

  setProviderPriority(name: string, priority: number): void {
    const provider = this.providers.find(p => p.name === name);
    if (provider) provider.priority = priority;
  }

  enableProvider(name: string, enabled: boolean): void {
    const provider = this.providers.find(p => p.name === name);
    if (provider) provider.enabled = enabled;
  }

  getStats(): typeof this.stats & { 
    cacheHitRate: number; 
    localProcessingRate: number;
    providerDependency: number;
    providerHealth: Record<string, any>;
  } {
    const cacheHitRate = this.stats.totalRequests > 0 
      ? this.stats.cacheHits / this.stats.totalRequests 
      : 0;
    const localProcessing = this.stats.cacheHits + this.stats.patternMatches + this.stats.learnedResponses;
    const localProcessingRate = this.stats.totalRequests > 0 
      ? localProcessing / this.stats.totalRequests 
      : 0;
    const providerDependency = this.stats.totalRequests > 0 
      ? this.stats.providerCalls / this.stats.totalRequests 
      : 1;
    
    return { 
      ...this.stats, 
      cacheHitRate,
      localProcessingRate,
      providerDependency,
      providerHealth: this.getProviderHealth(),
    };
  }

  async getEvolutionReport(): Promise<{
    learningProgress: number;
    patternsDiscovered: number;
    autonomyLevel: number;
    recommendations: string[];
  }> {
    return this.coreEvolution.getEvolutionReport();
  }
}

export const ulysseCoreEngine = new UlysseCoreEngine();
