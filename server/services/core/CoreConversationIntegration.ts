import { ulysseCoreEngine } from "./UlysseCoreEngine";
import { ulysseToolsV2, executeToolCallV2, toolOrchestrator, OrchestrationResult, getToolsForPersona } from "../ulysseToolsServiceV2";
import OpenAI from "openai";
import { getPreloadedContextAsPrompt } from "../context/preloader";
import { autoLearningEngine } from "../autoLearningEngine";
import { cumulativeLearningEngine } from "../cumulativeLearningEngine";
import { findMatchingStrategy } from "../../config/ulysseOptimumStrategies";
import { ulysseKPIService } from "../ulysseKPIService";
import { generateEnhancedConsciousnessPrompt } from "../../config/ulysseConsciousness";
import { smartModelRouter } from "../smartModelRouter";
import { kpiClosedLoopService } from "../kpiClosedLoop";
import { feedbackProtocolService } from "../feedbackProtocol";
import { enhancedSelfCritiqueService } from "../enhancedSelfCritique";
import { decisionCoachService } from "../decisionCoachService";
import { unifiedRAGService } from "../context/unifiedRAG";
import { plannerService } from "./PlannerExecutorVerifier";
import { autonomousInitiativeEngine } from "../autonomousInitiativeEngine";
import { conversationalPreferencesService } from "../conversationalPreferencesService";
import { traceCollector } from "../traceCollector";

interface ConversationContext {
  userId: number;
  persona: 'ulysse' | 'iris' | 'alfred';
  conversationId?: number;
  hasFamilyAccess: boolean;
}

interface ProcessingDecision {
  strategy: 'local' | 'tools' | 'provider' | 'hybrid';
  confidence: number;
  suggestedTools?: string[];
  localResponse?: string;
  reasoning: string;
}

interface IntegratedResponse {
  response: string;
  toolsUsed: string[];
  processingSource: 'core_cache' | 'core_pattern' | 'core_learned' | 'tools' | 'provider';
  metrics: {
    totalTimeMs: number;
    coreProcessingMs: number;
    toolsProcessingMs: number;
    providerProcessingMs: number;
  };
}

class CoreConversationIntegration {
  private queryPatterns = new Map<string, RegExp>([
    ['greeting', /^(salut|bonjour|hello|hey|coucou|bonsoir)/i],
    ['time', /quelle?\s*(heure|jour|date)/i],
    ['weather', /(météo|temps\s+qu'il\s+fait|température)/i],
    ['thanks', /^(merci|thanks|thx)/i],
    ['goodbye', /^(bye|au\s*revoir|à\s*plus|ciao|salut\s*!?$)/i],
    ['calendar', /(agenda|calendrier|événement|rdv|rendez-vous)/i],
    ['email', /(email|mail|message|boîte|inbox)/i],
    ['music', /(musique|spotify|joue|écoute|morceau|artiste)/i],
    ['lights', /(lumière|lampe|éclairage|allume|éteins)/i],
    ['sports', /(match|foot|équipe|classement|score|pari|cote)/i],
    ['stocks', /(bourse|action|cours|marché|trading|bitcoin|crypto)/i],
    ['memory', /(souviens|rappelle|mémoire|tu\s+sais\s+que)/i],
    ['search', /(cherche|recherche|trouve|google|internet)/i],
    ['image', /(image|photo|génère|crée.*visuel|dalle)/i],
  ]);

  async analyzeQuery(query: string, context: ConversationContext): Promise<ProcessingDecision> {
    const queryLower = query.toLowerCase().trim();
    
    // Check for simple patterns first
    for (const [patternName, regex] of Array.from(this.queryPatterns.entries())) {
      if (regex.test(queryLower)) {
        return this.getDecisionForPattern(patternName, query, context);
      }
    }

    const coreResult = await ulysseCoreEngine.process({ message: query, context: { userId: context.userId, persona: context.persona, hasFamilyAccess: context.hasFamilyAccess, conversationId: context.conversationId } });
    if (coreResult.source !== 'provider' && coreResult.confidence > 0.8) {
      return {
        strategy: 'local',
        confidence: coreResult.confidence,
        localResponse: coreResult.content,
        reasoning: `Core Engine (${coreResult.source}) avec confiance ${coreResult.confidence}`
      };
    }

    // Analyze for tool needs
    const suggestedTools = this.detectRequiredTools(queryLower);
    if (suggestedTools.length > 0) {
      return {
        strategy: suggestedTools.length > 2 ? 'hybrid' : 'tools',
        confidence: 0.7,
        suggestedTools,
        reasoning: `Détection de ${suggestedTools.length} tool(s) nécessaire(s): ${suggestedTools.join(', ')}`
      };
    }

    // Default to provider
    return {
      strategy: 'provider',
      confidence: 0.5,
      reasoning: 'Requête complexe nécessitant le provider AI'
    };
  }

  private getDecisionForPattern(pattern: string, query: string, context: ConversationContext): ProcessingDecision {
    const toolMappings: Record<string, string[]> = {
      'calendar': ['calendar_list_events'],
      'email': ['email_list_inbox'],
      'music': ['spotify_control'],
      'lights': ['smarthome_control'],
      'sports': ['query_sports_data', 'query_match_intelligence'],
      'stocks': ['query_stock_data'],
      'memory': ['query_brain'],
      'search': ['web_search'],
      'image': ['image_generate'],
      'weather': ['location_get_weather'],
    };

    const simplePatterns = ['greeting', 'thanks', 'goodbye', 'time'];
    
    if (simplePatterns.includes(pattern)) {
      return {
        strategy: 'local',
        confidence: 0.95,
        reasoning: `Pattern simple détecté: ${pattern}`
      };
    }

    const tools = toolMappings[pattern];
    if (tools) {
      return {
        strategy: 'tools',
        confidence: 0.85,
        suggestedTools: tools,
        reasoning: `Pattern ${pattern} → tools: ${tools.join(', ')}`
      };
    }

    return {
      strategy: 'provider',
      confidence: 0.6,
      reasoning: `Pattern ${pattern} sans mapping tool direct`
    };
  }

  private detectRequiredTools(query: string): string[] {
    const tools: string[] = [];

    // Multi-intent detection
    if (/calendrier|agenda|événement|rdv/i.test(query)) tools.push('calendar_list_events');
    if (/créer?\s*(un\s*)?(événement|rdv)/i.test(query)) tools.push('calendar_create_event');
    if (/email|mail|message/i.test(query)) tools.push('email_list_inbox');
    if (/envo(ie|yer)\s*(un\s*)?mail/i.test(query)) tools.push('email_send');
    if (/spotify|musique|joue|écoute/i.test(query)) tools.push('spotify_control');
    if (/lumière|lampe|éclairage/i.test(query)) tools.push('smarthome_control');
    if (/météo|température|temps\s+qu/i.test(query)) tools.push('location_get_weather');
    if (/match|foot|équipe|score|cote/i.test(query)) tools.push('query_sports_data');
    if (/prono|pronostic|bless|absent|compo|composition|lineup|intelligence/i.test(query)) tools.push('query_match_intelligence');
    if (/bourse|action|cours|marché|bitcoin/i.test(query)) tools.push('query_stock_data');
    if (/cherche|recherche|google/i.test(query)) tools.push('web_search');
    if (/rappelle|souviens|mémoire/i.test(query)) tools.push('query_brain');
    if (/(génère|crée)\s*(une?\s*)?(image|photo)/i.test(query)) tools.push('image_generate');
    if (/suguval|sugumaillane|courses/i.test(query)) tools.push('query_suguval_history');
    if (/chiffre\s*d.affaires|CA\s+[0-9]|revenue|combien.*restaurant|comment\s+va.*restaurant|bilan.*restaurant|résultat.*restaurant|performance.*restaurant|restaurant.*performance|restaurant.*bilan/i.test(query)) tools.push('sugu_full_overview', 'compute_business_health');
    if (/CA\s*(uber|deliveroo|zenorder|plateforme)|uber.*eats?\s*(CA|chiffre|montant|combien)|deliveroo\s*(CA|chiffre|montant|combien)|recette.*(?:uber|deliveroo|plateforme)|(?:combien|quel).*(?:uber|deliveroo).*(?:fait|gagné|encaissé)/i.test(query)) tools.push('query_hubrise', 'search_sugu_data');
    if (/caisse|ticket\s*z|journal\s*(?:de\s*)?caisse|hubrise/i.test(query)) tools.push('query_hubrise', 'search_sugu_data');
    if (/achats?\s+(fournisseur|restau|sugu)|facture.*fournisseur|impay[eé]|METRO|POMONA|TRANSGOURMET/i.test(query)) tools.push('manage_sugu_purchases');
    if (/frais\s+g[eé]n[eé]raux|charges?\s+fix|loyer|[eé]nergie.*restaurant|eau.*restaurant|assurance.*restaurant/i.test(query)) tools.push('manage_sugu_expenses');
    if (/solde\s+banque|[eé]criture.*banque|banque.*restaurant|trésorerie|relevé\s+banc/i.test(query)) tools.push('manage_sugu_bank');
    if (/employ[eé]|salaire|RH\s+sugu|masse\s+salariale|paie.*restaurant|équipe.*restaurant/i.test(query)) tools.push('manage_sugu_employees');
    if (/emprunt|prêt.*restaurant|capital.*restant|mensualité.*restaurant/i.test(query)) tools.push('sugu_full_overview');
    if (/anomalie|alerte.*restaurant|vérifi.*restaurant|anomal/i.test(query)) tools.push('detect_anomalies');
    if (/analyse.*business|analyse.*restaurant|santé.*restaurant|score.*santé|indicateur.*restaurant|KPI.*restaurant/i.test(query)) tools.push('compute_business_health', 'detect_anomalies');
    if (/(où|position|localisation)/i.test(query)) tools.push('location_get_weather');

    return Array.from(new Set(tools));
  }

  async processWithCore(
    query: string,
    context: ConversationContext,
    openaiClient: OpenAI
  ): Promise<IntegratedResponse> {
    const startTime = Date.now();
    let coreProcessingMs = 0;
    let toolsProcessingMs = 0;
    let providerProcessingMs = 0;
    const toolsUsed: string[] = [];

    const traceId = traceCollector.startTrace({
      userId: context.userId,
      agent: context.persona,
      model: "auto",
      query,
      domain: this.detectDomain(query),
      source: "core_conversation",
    });

    // Step 1: Analyze query
    const coreStart = Date.now();
    const decision = await this.analyzeQuery(query, context);
    coreProcessingMs = Date.now() - coreStart;

    console.log(`[CoreIntegration] Decision: ${decision.strategy} (confidence: ${decision.confidence})`);

    // Step 2: Execute based on strategy
    if (decision.strategy === 'local' && decision.localResponse) {
      traceCollector.endTrace(traceId, {
        response: decision.localResponse,
        status: "completed",
        metadata: { strategy: "local", source: "core_cache" },
      }).catch(() => {});
      return {
        response: decision.localResponse,
        toolsUsed: [],
        processingSource: 'core_cache',
        metrics: { totalTimeMs: Date.now() - startTime, coreProcessingMs, toolsProcessingMs: 0, providerProcessingMs: 0 }
      };
    }

    if (decision.strategy === 'tools' && decision.suggestedTools) {
      // Execute suggested tools
      const toolStart = Date.now();
      const toolCalls = decision.suggestedTools.map(name => ({
        name,
        args: this.buildToolArgs(name, query, context)
      }));

      const orchestrationResult = await toolOrchestrator.executeParallel(toolCalls, context.userId);
      toolsProcessingMs = Date.now() - toolStart;
      toolsUsed.push(...decision.suggestedTools);

      // Generate response from tool results
      const providerStart = Date.now();
      const response = await this.generateResponseFromTools(query, orchestrationResult, context, openaiClient);
      providerProcessingMs = Date.now() - providerStart;

      // Auto-learning + KPI: record this interaction
      const totalTimeMs = Date.now() - startTime;
      const detectedDomain = this.detectDomain(query);
      autoLearningEngine.recordInteraction({
        query,
        toolsUsed: decision.suggestedTools || [],
        success: !!response,
        responseTimeMs: totalTimeMs,
        domain: detectedDomain
      });
      const matchedStrategy = findMatchingStrategy(query);
      if (matchedStrategy) {
        autoLearningEngine.recordStrategySuccess(matchedStrategy.name, query.substring(0, 80), decision.suggestedTools || []);
      }

      cumulativeLearningEngine.recordTaskOutcome({
        agent: "ulysse",
        taskType: detectedDomain,
        taskDescription: query.slice(0, 300),
        outcome: response ? "success" : "failure",
        toolsUsed: decision.suggestedTools || [],
        toolSequence: decision.suggestedTools || [],
        durationMs: totalTimeMs,
        errorEncountered: response ? undefined : "Pas de réponse générée",
      }).catch(() => {});
      for (const tool of (decision.suggestedTools || [])) {
        cumulativeLearningEngine.recordToolCall({
          agent: "ulysse",
          toolName: tool,
          success: !!response,
          durationMs: toolsProcessingMs,
          combinedWith: (decision.suggestedTools || []).filter(t => t !== tool),
        }).catch(() => {});
      }

      // KPI tracking
      ulysseKPIService.recordLatency(detectedDomain, totalTimeMs);
      for (const tool of (decision.suggestedTools || [])) {
        ulysseKPIService.recordToolCall(tool, !!response, toolsProcessingMs, decision.suggestedTools || []);
      }
      ulysseKPIService.recordLearningEvent();
      ulysseKPIService.detectSatisfactionFromMessage(query, detectedDomain);

      conversationalPreferencesService.analyzeResponsePreference(context.userId, query, response).catch(() => {});

      traceCollector.endTrace(traceId, {
        response,
        status: "completed",
        toolsUsed: decision.suggestedTools || [],
        toolCallCount: (decision.suggestedTools || []).length,
        metadata: { strategy: "tools" },
      }).catch(() => {});

      return {
        response,
        toolsUsed,
        processingSource: 'tools',
        metrics: { totalTimeMs, coreProcessingMs, toolsProcessingMs, providerProcessingMs }
      };
    }

    // Enhanced intelligence pipeline
    const detectedDomain = this.detectDomain(query);

    // 0. Check for proactive initiatives (async, non-blocking)
    autonomousInitiativeEngine.runChecks().catch(() => {});

    // 1. Feedback protocol: detect if this is owner feedback
    const feedback = feedbackProtocolService.detectFeedback(query, detectedDomain);
    if (feedback) {
      ulysseKPIService.detectSatisfactionFromMessage(query, detectedDomain);
    }

    // 2. KPI closed-loop: run periodic behavior analysis
    kpiClosedLoopService.analyzeAndAdjust().catch(() => {});

    // 2b. Planner: detect complex multi-step queries
    if (plannerService.isComplexQuery(query)) {
      console.log(`[CoreIntegration] Complex query detected → Planner activated`);
      try {
        const plan = plannerService.createPlan(query);
        if (plan && plan.steps.length > 1) {
          const planContext = `\n[PLAN MULTI-ÉTAPES DÉTECTÉ]\nÉtapes: ${plan.steps.map((s, i) => `${i + 1}. ${s.description}`).join(" → ")}\nExécute ce plan de manière structurée.`;
          // Inject plan context into RAG for the provider call
          const planResult = await this.callProviderWithTools(query, context, openaiClient, {
            domain: detectedDomain,
            ragContext: planContext,
            isDecision: false,
            modelRoute: smartModelRouter.route(query, detectedDomain, "openai")
          });
          const totalTimeMs = Date.now() - startTime;
          ulysseKPIService.recordLatency(detectedDomain, totalTimeMs);
          return {
            response: planResult.content,
            toolsUsed: planResult.toolsUsed,
            processingSource: 'provider',
            metrics: { totalTimeMs, coreProcessingMs, toolsProcessingMs: 0, providerProcessingMs: Date.now() - startTime - coreProcessingMs }
          };
        }
      } catch (err) {
        console.log(`[CoreIntegration] Planner error, falling back to standard pipeline`);
      }
    }

    // 3. Decision coach: detect decision queries
    const isDecision = decisionCoachService.isDecisionQuery(query);

    // 4. Smart model routing
    const modelRoute = smartModelRouter.route(query, detectedDomain);
    console.log(`[CoreIntegration] Model route: ${modelRoute.model} (${modelRoute.reason})`);

    // 5. Unified RAG context retrieval
    let ragContext = "";
    try {
      const ragResult = await unifiedRAGService.retrieve(context.userId, query, { domainBoost: detectedDomain, maxTokens: 2000, recencyHours: 168 });
      if (ragResult.fragments.length > 0) {
        ragContext = "\n[CONTEXTE RAG]\n" + ragResult.fragments.map(f => `[${f.source}|${f.score.toFixed(1)}] ${f.content}`).join("\n");
      }
    } catch {}

    // Default: Use provider with tools available + enhanced context
    const providerStart = Date.now();
    const response = await this.callProviderWithTools(query, context, openaiClient, {
      domain: detectedDomain,
      ragContext,
      isDecision,
      modelRoute
    });
    providerProcessingMs = Date.now() - providerStart;

    // 6. Enhanced self-critique on critical domains
    const critique = enhancedSelfCritiqueService.evaluate(response.content, detectedDomain, response.toolsUsed);
    let finalContent = response.content;
    if (!critique.shouldProceed && critique.suggestedDisclaimer) {
      finalContent = `${critique.suggestedDisclaimer}\n\n${response.content}`;
      console.log(`[CoreIntegration] Self-critique added disclaimer for ${detectedDomain} (confidence: ${critique.confidenceLevel}%)`);
    }

    // 7. Record model performance
    smartModelRouter.recordOutcome(detectedDomain, modelRoute.provider, modelRoute.model, providerProcessingMs, !!response.content);

    // Auto-learning + KPI tracking
    const providerTotalMs = Date.now() - startTime;
    autoLearningEngine.recordInteraction({
      query,
      toolsUsed: response.toolsUsed,
      success: !!response.content,
      responseTimeMs: providerTotalMs,
      domain: detectedDomain
    });

    ulysseKPIService.recordLatency(detectedDomain, providerTotalMs);
    for (const tool of response.toolsUsed) {
      ulysseKPIService.recordToolCall(tool, !!response.content, providerProcessingMs, response.toolsUsed);
    }
    ulysseKPIService.recordLearningEvent();
    ulysseKPIService.detectSatisfactionFromMessage(query, detectedDomain);

    conversationalPreferencesService.analyzeResponsePreference(context.userId, query, finalContent).catch(() => {});

    traceCollector.endTrace(traceId, {
      response: finalContent,
      status: "completed",
      toolsUsed: response.toolsUsed,
      toolCallCount: response.toolsUsed.length,
      metadata: { strategy: "provider", model: modelRoute.model, domain: detectedDomain },
    }).catch(() => {});

    return {
      response: finalContent,
      toolsUsed: response.toolsUsed,
      processingSource: 'provider',
      metrics: { totalTimeMs: providerTotalMs, coreProcessingMs, toolsProcessingMs, providerProcessingMs }
    };
  }

  private detectDomain(query: string): string {
    const queryLower = query.toLowerCase();
    if (/foot|match|prono|cote|sport|ligue|premier league/i.test(queryLower)) return "sports";
    if (/email|mail|inbox/i.test(queryLower)) return "email";
    if (/agenda|calendrier|événement|rdv/i.test(queryLower)) return "calendar";
    if (/musique|spotify|joue|écoute/i.test(queryLower)) return "music";
    if (/lumière|lampe|allume|éteins|thermostat/i.test(queryLower)) return "domotique";
    if (/bourse|action|bitcoin|crypto/i.test(queryLower)) return "finance";
    if (/cherche|recherche|google/i.test(queryLower)) return "search";
    if (/sugu|restaurant|courses|checklist/i.test(queryLower)) return "sugu";
    if (/souviens|rappelle|mémoire/i.test(queryLower)) return "memory";
    if (/météo|température|temps/i.test(queryLower)) return "weather";
    return "general";
  }

  private buildToolArgs(toolName: string, query: string, context: ConversationContext): Record<string, any> {
    // Build appropriate args based on tool and query
    switch (toolName) {
      case 'calendar_list_events':
        return { days_ahead: 7, max_results: 10 };
      case 'email_list_inbox':
        return { inbox: context.persona, limit: 10 };
      case 'spotify_control':
        if (/joue|écoute/i.test(query)) {
          const match = query.match(/(?:joue|écoute)\s+(.+)/i);
          return { action: 'search', query: match?.[1] || '' };
        }
        if (/pause/i.test(query)) return { action: 'pause' };
        if (/suivant/i.test(query)) return { action: 'next' };
        return { action: 'playback_status' };
      case 'smarthome_control':
        if (/allume/i.test(query)) return { action: 'turn_on', device_name: this.extractDeviceName(query) };
        if (/éteins/i.test(query)) return { action: 'turn_off', device_name: this.extractDeviceName(query) };
        return { action: 'list_devices' };
      case 'location_get_weather':
        return { location: 'Marseille' };
      case 'query_sports_data':
        return { query_type: 'today_matches' };
      case 'query_stock_data':
        const symbolMatch = query.match(/\b([A-Z]{1,5})\b/);
        return symbolMatch ? { query_type: 'analysis', symbol: symbolMatch[1] } : { query_type: 'daily_brief' };
      case 'web_search':
        return { query, max_results: 5 };
      case 'query_brain':
        return { query, category: 'all', limit: 10 };
      case 'sugu_full_overview':
        return { year: new Date().getFullYear().toString() };
      case 'compute_business_health': {
        const isYear = /ann[eé]e|year|YTD/i.test(query);
        const isLastMonth = /mois\s+dernier|le mois pass[eé]/i.test(query);
        const is3Months = /3\s+mois|trimestre/i.test(query);
        return { period: isYear ? 'year' : isLastMonth ? 'last_month' : is3Months ? 'last_3_months' : 'year' };
      }
      case 'manage_sugu_purchases':
        return { action: 'list', limit: 20 };
      case 'manage_sugu_expenses':
        return { action: 'list', limit: 20 };
      case 'manage_sugu_bank':
        return { action: 'list', limit: 20 };
      case 'manage_sugu_employees':
        return { action: 'list' };
      case 'detect_anomalies':
        return { days: 30 };
      default:
        return {};
    }
  }

  private extractDeviceName(query: string): string {
    const patterns = [
      /(?:la\s+)?lumière\s+(?:de\s+)?(?:la\s+|du\s+)?(\w+)/i,
      /(?:la\s+)?lampe\s+(?:de\s+)?(?:la\s+|du\s+)?(\w+)/i,
      /(\w+)\s+(?:light|lamp)/i,
    ];
    for (const pattern of patterns) {
      const match = query.match(pattern);
      if (match) return match[1];
    }
    return 'salon';
  }

  private async generateResponseFromTools(
    query: string,
    orchestrationResult: OrchestrationResult,
    context: ConversationContext,
    openaiClient: OpenAI
  ): Promise<string> {
    const toolResultsSummary = orchestrationResult.results
      .map(r => `[${r.name}]: ${r.result}`)
      .join('\n\n');

    const completion = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Tu es ${context.persona === 'ulysse' ? 'Ulysse' : context.persona === 'iris' ? 'Iris' : 'Max'}. 
Génère une réponse naturelle et concise basée sur les résultats des outils ci-dessous.
Ne mentionne pas les outils utilisés, parle comme si tu avais fait les actions toi-même.
MAX 3 phrases sauf si plus de détails demandés.
IMPORTANT: Ne JAMAIS inventer de score, résultat ou statistique. Si les données disent homeScore=null ou scoreAvailable=false, dis que tu n'as pas le résultat.`
        },
        {
          role: 'user',
          content: `Question: ${query}\n\nRésultats des outils:\n${toolResultsSummary}`
        }
      ],
      max_tokens: 500,
      temperature: 0.7
    });

    return completion.choices[0]?.message?.content || "Je n'ai pas pu traiter ta demande.";
  }

  private async callProviderWithTools(
    query: string,
    context: ConversationContext,
    openaiClient: OpenAI,
    enhanced?: { domain?: string; ragContext?: string; isDecision?: boolean; modelRoute?: import("../smartModelRouter").ModelRoute }
  ): Promise<{ content: string; toolsUsed: string[] }> {
    const toolsUsed: string[] = [];
    const domain = enhanced?.domain || "general";

    const preloadedContext = getPreloadedContextAsPrompt(context.userId, domain);
    const consciousnessPrompt = generateEnhancedConsciousnessPrompt(domain);
    const preferencesPrompt = await conversationalPreferencesService.getPreferencesPrompt(context.userId);
    
    const personaName = context.persona === 'ulysse' ? 'Ulysse' : context.persona === 'iris' ? 'Iris' : context.persona === 'maxai' ? 'MaxAI' : context.persona === 'alfred' ? 'Alfred' : 'Max';
    const basePrompt = `Tu es ${personaName}, assistant IA personnel.
Tu as accès à de nombreux outils pour aider l'utilisateur.
Utilise les tools quand nécessaire pour accomplir les tâches demandées.

RÈGLE ABSOLUE ANTI-HALLUCINATION (SPORTS):
- Ne JAMAIS inventer un score, un résultat, ou un statut de match.
- Si un match a homeScore=null ou awayScore=null → dire "je n'ai pas le score" au lieu d'inventer.
- Si un match est marqué "scheduled" mais que l'heure est passée → dire "le match devrait être terminé mais je n'ai pas encore le résultat".
- Toujours utiliser query_sports_data ou query_matchendirect pour vérifier AVANT de répondre sur un score.
- Si aucune donnée fiable n'est disponible → le dire clairement plutôt que broder.

RÈGLE DIAGNOSTIC PRISE EN MAIN:
- Quand l'utilisateur dit "diagnostic prise en main", "teste tes outils", "vérifie que tu es opérationnel", "self test", "teste la prise en main", "es-tu opérationnel" → OBLIGATOIREMENT appeler screen_monitor_manage avec action "self_test".
- Ne PAS faire un diagnostic interne général. Utiliser l'action self_test qui teste les 13 capacités réelles (connexion agent, pyautogui, screenshot, vision, souris, clavier, URL, multi-action, frame storage).
- Rapporter le résultat du self_test tel quel à l'utilisateur avec tous les PASS/FAIL.`;
    
    let systemPrompt = basePrompt;
    if (preferencesPrompt) systemPrompt += preferencesPrompt;
    if (consciousnessPrompt) systemPrompt += `\n${consciousnessPrompt}`;
    if (preloadedContext) systemPrompt += `\n\n--- CONTEXTE ACTUEL ---${preloadedContext}--- FIN CONTEXTE ---`;
    if (enhanced?.ragContext) systemPrompt += enhanced.ragContext;
    if (enhanced?.isDecision) {
      systemPrompt += "\n" + decisionCoachService.generateDecisionPrompt(query, domain);
    }

    const model = enhanced?.modelRoute?.model || 'gpt-4o';
    const maxTokens = enhanced?.modelRoute?.maxTokens || 1000;
    const temperature = enhanced?.modelRoute?.temperature || 0.7;

    const completion = await openaiClient.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query }
      ],
      tools: context.hasFamilyAccess ? ulysseToolsV2 : undefined,
      tool_choice: context.hasFamilyAccess ? 'auto' : undefined,
      max_tokens: maxTokens,
      temperature
    });

    let response = completion.choices[0]?.message;

    // Handle tool calls if any
    if (response?.tool_calls && response.tool_calls.length > 0) {
      const toolResults = await Promise.all(
        response.tool_calls.map(async (tc: any) => {
          let args: any = {};
          try { args = JSON.parse(tc.function.arguments || "{}"); } catch { console.warn(`[CoreConv] Failed to parse tool args for ${tc.function.name}`); }
          const result = await executeToolCallV2(tc.function.name, args, context.userId);
          toolsUsed.push(tc.function.name);
          return { role: 'tool' as const, tool_call_id: tc.id, content: result };
        })
      );

      // Get final response with tool results
      const finalCompletion = await openaiClient.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: `Tu es ${context.persona}. Réponds naturellement avec les résultats des outils.` },
          { role: 'user', content: query },
          response,
          ...toolResults
        ],
        max_tokens: 1000
      });

      return {
        content: finalCompletion.choices[0]?.message?.content || '',
        toolsUsed
      };
    }

    return {
      content: response?.content || '',
      toolsUsed
    };
  }

  getAvailableTools(): typeof ulysseToolsV2 {
    return ulysseToolsV2;
  }

  async getMetrics(): Promise<{
    coreStats: any;
    toolsAvailable: number;
    integrationStatus: string;
    enhancedIntelligence: any;
  }> {
    const coreStats = ulysseCoreEngine.getStats();
    return {
      coreStats,
      toolsAvailable: ulysseToolsV2.length,
      integrationStatus: 'active',
      enhancedIntelligence: {
        modelRouter: smartModelRouter.getStats(),
        kpiClosedLoop: kpiClosedLoopService.getStats(),
        feedbackProtocol: feedbackProtocolService.getStats(),
        selfCritique: enhancedSelfCritiqueService.getStats(),
        decisionCoach: decisionCoachService.getStats()
      }
    };
  }
}

export const coreConversationIntegration = new CoreConversationIntegration();
