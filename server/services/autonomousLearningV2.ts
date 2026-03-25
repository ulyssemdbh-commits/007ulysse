import { db } from "../db";
import { 
  learningProgress, knowledgeBase, knowledgeGraph, learningLog,
  conversationMessages, conversationThreads, sportsPredictionSnapshots,
  LearningProgress, InsertLearningProgress
} from "@shared/schema";
import { eq, desc, sql, and, or, gte, lte, isNull, inArray } from "drizzle-orm";
import { brainService } from "./brainService";
import OpenAI from "openai";
import crypto from "crypto";

const LOG_PREFIX = "[AutoLearningV3]";

let _bgClient: OpenAI | null = null;
let _bgModel = "gpt-4o-mini";

function getBgAI(): OpenAI {
  if (!_bgClient) {
    const geminiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (geminiKey) {
      _bgClient = new OpenAI({
        apiKey: geminiKey,
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
        timeout: 60000,
      });
      _bgModel = "gemini-2.0-flash";
    } else {
      _bgClient = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
        timeout: 30000,
      });
      _bgModel = "gpt-4o-mini";
    }
  }
  return _bgClient;
}

const BG_MODEL_GETTER = () => _bgModel;

type LearningDomain = "sports" | "trading" | "sugu" | "dev" | "perso" | "autre";
type PatternType = "structural" | "situational";
type TriggerType = "time_based" | "event_based" | "manual";

const DOMAIN_WEIGHTS: Record<LearningDomain, number> = {
  sports: 1.3,
  trading: 1.3,
  sugu: 1.2,
  dev: 1.2,
  perso: 1.0,
  autre: 0.8,
};

const VOLATILITY_FACTORS: Record<LearningDomain, number> = {
  sports: 1.8,
  trading: 2.0,
  sugu: 1.0,
  dev: 0.5,
  perso: 0.8,
  autre: 1.0,
};

const MIN_PRIORITY_THRESHOLD = 50;
const L5_MIN_CONFIDENCE = 80;
const L5_MIN_IMPORTANCE = 80;

interface TopicExtraction {
  topic: string;
  category: string;
  importance: number;
  context: string;
  patternType?: PatternType;
}

interface PredictionPattern {
  topic: string;
  patternType: PatternType;
  isWinning: boolean;
  confidence: number;
  sport: string;
  league?: string;
  context: string;
}

interface L5CrossDomainInsight {
  title: string;
  content: string;
  domainsInvolved: LearningDomain[];
  actionsTransferables: string[];
  sourceL4Ids: number[];
}

interface LayerResult {
  success: boolean;
  factsAdded: number;
  connectionsAdded: number;
  insightsAdded: number;
  knowledgeIds: number[];
  error?: string;
}

interface L1Fact {
  id: number;
  title: string;
  content: string;
  tags: string[];
}

interface L2Detail {
  id: number;
  title: string;
  content: string;
  parentFactTitle: string;
  parentFactId?: number;
  keyPoints: string[];
}

function detectDomain(topic: string, context: string = ""): LearningDomain {
  const text = (topic + " " + context).toLowerCase();

  if (/(pari|prono|cote|ligue 1|premier league|champions league|om|psg|match|foot|football|basket|nba|nfl|hockey|serie a|bundesliga|la liga)/.test(text)) {
    return "sports";
  }
  if (/(btc|bitcoin|eth|crypto|up |down |support|résistance|rsi|macd|nasdaq|s&p|action|boursier|trading|forex|analyse technique)/.test(text)) {
    return "trading";
  }
  if (/(sugu|suguval|sugumaillane|economa|checklist|stock|inventaire|restaurant|maillane)/.test(text)) {
    return "sugu";
  }
  if (/(react|node|typescript|scraping|architecture|backend|frontend|api|javascript|python|code|dev|github|drizzle|postgres)/.test(text)) {
    return "dev";
  }
  if (/(famille|perso|santé|relation|loisir|voyage|maison|enfant)/.test(text)) {
    return "perso";
  }
  return "autre";
}

class AutonomousLearningServiceV2 {
  private readonly MAX_TOPICS_PER_RUN = 3;
  private readonly HOURS_BETWEEN_RUNS = 4;
  private readonly LAYER_NAMES = ["Surface (L1)", "Details (L2)", "Connexions (L3)", "Insights (L4)", "Cross-Domain (L5)"];

  async runLearningCycle(userId: number, triggerType: TriggerType = "time_based"): Promise<{
    topicsProcessed: number;
    totalFacts: number;
    totalConnections: number;
    totalInsights: number;
    crossDomainInsights: number;
    errors: string[];
  }> {
    console.log(`${LOG_PREFIX} Starting V3 learning cycle for user ${userId} (trigger: ${triggerType})`);
    
    const results = {
      topicsProcessed: 0,
      totalFacts: 0,
      totalConnections: 0,
      totalInsights: 0,
      crossDomainInsights: 0,
      errors: [] as string[]
    };

    try {
      await this.extractTopicsFromRecentConversations(userId);
      await this.extractTopicsFromHomework(userId);
      await this.extractTopicsFromPredictionLearnings(userId);
      await this.extractTopicsFromAppData(userId);
      
      const topics = await this.getTopicsToProcess(userId);
      
      console.log(`${LOG_PREFIX} Found ${topics.length} topics to process (priority >= ${MIN_PRIORITY_THRESHOLD})`);

      for (const topic of topics.slice(0, this.MAX_TOPICS_PER_RUN)) {
        try {
          const layerResult = await this.processTopicLayers(userId, topic);
          results.topicsProcessed++;
          results.totalFacts += layerResult.factsAdded;
          results.totalConnections += layerResult.connectionsAdded;
          results.totalInsights += layerResult.insightsAdded;
        } catch (error: any) {
          const errorMsg = `Error processing topic "${topic.topic}": ${error.message}`;
          console.error(`${LOG_PREFIX} ${errorMsg}`);
          results.errors.push(errorMsg);
          await this.markTopicError(topic.id, error.message);
        }
      }

      const l5Result = await this.processLayer5CrossDomain(userId);
      results.crossDomainInsights = l5Result.count;

      await this.applyConfidenceDecay(userId);

      console.log(`${LOG_PREFIX} V3 Learning cycle complete: ${results.topicsProcessed} topics, ${results.totalFacts} facts, ${results.totalConnections} connections, ${results.totalInsights} insights, ${results.crossDomainInsights} cross-domain`);
      
    } catch (error: any) {
      console.error(`${LOG_PREFIX} Fatal error in learning cycle:`, error);
      results.errors.push(`Fatal: ${error.message}`);
    }

    return results;
  }

  async triggerEventBasedLearning(userId: number, eventType: "prediction_added" | "homework_hot" | "pattern_detected", context?: string): Promise<void> {
    console.log(`${LOG_PREFIX} Event-based trigger: ${eventType} for user ${userId}${context ? ` (context: ${context})` : ""}`);
    
    let targetDomain: LearningDomain = "autre";
    
    switch (eventType) {
      case "prediction_added":
        await this.extractTopicsFromPredictionLearnings(userId);
        targetDomain = "sports";
        break;
      case "homework_hot":
        await this.extractTopicsFromHomework(userId);
        targetDomain = context?.includes("trading") ? "trading" : context?.includes("sugu") ? "sugu" : "sports";
        break;
      case "pattern_detected":
        targetDomain = context?.includes("trading") ? "trading" : "sports";
        break;
    }
    
    const topics = await db.select().from(learningProgress)
      .where(and(
        eq(learningProgress.userId, userId),
        eq(learningProgress.domain, targetDomain)
      ))
      .orderBy(desc(learningProgress.priority))
      .limit(5);
    
    for (const topic of topics) {
      await db.update(learningProgress)
        .set({ 
          priority: sql`LEAST(100, ${learningProgress.priority} + 10)`,
          triggerType: "event_based",
          lastAccessedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(learningProgress.id, topic.id));
    }
    
    console.log(`${LOG_PREFIX} Boosted ${topics.length} ${targetDomain} topics from event trigger`);
  }

  private async extractTopicsFromRecentConversations(userId: number): Promise<void> {
    const oneDayAgo = new Date();
    oneDayAgo.setHours(oneDayAgo.getHours() - 24);

    const recentMessages = await db.select({
      id: conversationMessages.id,
      content: conversationMessages.content,
      role: conversationMessages.role,
      threadId: conversationMessages.threadId,
      createdAt: conversationMessages.createdAt
    })
    .from(conversationMessages)
    .innerJoin(conversationThreads, eq(conversationThreads.id, conversationMessages.threadId))
    .where(and(
      eq(conversationThreads.userId, userId),
      gte(conversationMessages.createdAt, oneDayAgo),
      eq(conversationMessages.role, "user")
    ))
    .orderBy(desc(conversationMessages.createdAt))
    .limit(50);

    if (recentMessages.length === 0) {
      console.log(`${LOG_PREFIX} No recent messages to extract topics from`);
      return;
    }

    const combinedContent = recentMessages
      .map(m => m.content)
      .join("\n---\n")
      .slice(0, 8000);

    try {
      const response = await getBgAI().chat.completions.create({
        model: BG_MODEL_GETTER(),
        messages: [{
          role: "system",
          content: `Tu es un expert en extraction de sujets. Analyse ces messages et identifie 3-5 sujets principaux qui meritent un approfondissement.

PRIORITE ABSOLUE aux sujets:
- Paris sportifs / pronos / foot / matchs
- Trading / crypto / bourse / analyse technique
- SUGU / Suguval / restaurant / gestion
- Developpement / code / architecture

Pour chaque sujet, fournis:
- topic: Le sujet en 2-5 mots
- category: personal/work/reference/learning/technical/creative
- importance: 1-100 (importance pour l'utilisateur)
- context: Breve description du contexte (1-2 phrases)

Reponds en JSON: { "topics": [...] }`
        }, {
          role: "user",
          content: combinedContent
        }],
        temperature: 0.3,
        response_format: { type: "json_object" }
      });

      let parsed: any = {};
      try { parsed = JSON.parse(response.choices[0].message.content || "{}"); } catch { console.warn(`${LOG_PREFIX} Failed to parse topic extraction response`); }
      const topics: TopicExtraction[] = parsed.topics || [];

      for (const topic of topics) {
        await this.addOrUpdateTopic(userId, topic, recentMessages.map(m => m.threadId));
      }

      console.log(`${LOG_PREFIX} Extracted ${topics.length} topics from recent conversations`);
      
    } catch (error: any) {
      console.error(`${LOG_PREFIX} Error extracting topics:`, error.message);
    }
  }

  private async extractTopicsFromHomework(userId: number): Promise<void> {
    const since = new Date();
    since.setHours(since.getHours() - 48);

    const recentHomeworkLogs = await db.select({
      id: learningLog.id,
      topic: learningLog.topic,
      content: learningLog.content,
      createdAt: learningLog.createdAt
    })
    .from(learningLog)
    .where(and(
      eq(learningLog.userId, userId),
      gte(learningLog.createdAt, since),
      eq(learningLog.sourceType, "homework")
    ))
    .orderBy(desc(learningLog.createdAt))
    .limit(50);

    if (recentHomeworkLogs.length === 0) {
      console.log(`${LOG_PREFIX} No recent homework logs to extract topics from`);
      return;
    }

    const combinedContent = recentHomeworkLogs
      .map(l => `# ${l.topic}\n${l.content}`)
      .join("\n---\n")
      .slice(0, 8000);

    try {
      const response = await getBgAI().chat.completions.create({
        model: BG_MODEL_GETTER(),
        messages: [{
          role: "system",
          content: `Tu es un expert en extraction de sujets a partir de rapports de veille (HOMEWORK).

Analyse ce contenu (presse, foot, economie, SUGU, trading, tech...) et identifie 3-7 sujets principaux qui meritent un apprentissage plus profond.

PRIORITE ABSOLUE aux sujets:
- Paris sportifs (foot europeen, value bets, modeles, equipes...)
- Trading et marches (crypto, forex, actions)
- Business SUGU (restos, gestion, optimisation)
- Dev (architecture, scraping, IA, automatisation)

Pour chaque sujet, fournis:
- topic: Le sujet en 2-5 mots
- category: personal/work/reference/learning/technical/creative
- importance: 1-100 (importance strategique pour l'utilisateur)
- context: Breve description du contexte (1-2 phrases)

Reponds en JSON: { "topics": [...] }`
        }, {
          role: "user",
          content: combinedContent
        }],
        temperature: 0.3,
        response_format: { type: "json_object" }
      });

      let parsed: any = {};
      try { parsed = JSON.parse(response.choices[0].message.content || "{}"); } catch { console.warn(`${LOG_PREFIX} Failed to parse homework topic response`); }
      const topics: TopicExtraction[] = parsed.topics || [];

      for (const topic of topics) {
        await this.addOrUpdateTopic(userId, topic, recentHomeworkLogs.map(l => l.id));
      }

      console.log(`${LOG_PREFIX} Extracted ${topics.length} topics from homework logs`);
      
    } catch (error: any) {
      console.error(`${LOG_PREFIX} Error extracting topics from homework:`, error.message);
    }
  }

  private async extractTopicsFromPredictionLearnings(userId: number): Promise<void> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentPredictions = await db.select()
      .from(sportsPredictionSnapshots)
      .where(and(
        sql`${sportsPredictionSnapshots.predictionPerformance} IS NOT NULL`,
        gte(sportsPredictionSnapshots.updatedAt, sevenDaysAgo)
      ))
      .orderBy(desc(sportsPredictionSnapshots.updatedAt))
      .limit(30);

    if (recentPredictions.length === 0) {
      console.log(`${LOG_PREFIX} No recent predictions to extract patterns from`);
      return;
    }

    const patterns: (PredictionPattern & { predictionId: number })[] = [];
    
    for (const pred of recentPredictions) {
      const perf = pred.predictionPerformance as any;
      const reco = pred.recommendations as any;
      if (!perf) continue;

      const isStructural = this.isStructuralPattern(pred);
      
      patterns.push({
        topic: `${pred.sport} ${pred.league} ${reco?.bestBet || "pattern"}`,
        patternType: isStructural ? "structural" : "situational",
        isWinning: perf.mainBetWon === true,
        confidence: reco?.confidence || 50,
        sport: pred.sport,
        league: pred.league || "",
        context: `${pred.homeTeam} vs ${pred.awayTeam} - ${perf.mainBetWon ? "WON" : "LOST"}`,
        predictionId: pred.id
      });
    }

    const winningPatterns = patterns.filter(p => p.isWinning);
    const losingPatterns = patterns.filter(p => !p.isWinning);

    if (winningPatterns.length >= 3) {
      const structuralWins = winningPatterns.filter(p => p.patternType === "structural");
      for (const pattern of structuralWins.slice(0, 3)) {
        await this.addPredictionTopic(userId, pattern, 4);
      }
      
      const situationalWins = winningPatterns.filter(p => p.patternType === "situational");
      for (const pattern of situationalWins.slice(0, 2)) {
        await this.addPredictionTopic(userId, pattern, 2);
      }
    }

    if (losingPatterns.length >= 3) {
      const structuralLosses = losingPatterns.filter(p => p.patternType === "structural");
      for (const pattern of structuralLosses.slice(0, 2)) {
        await this.addPredictionTopic(userId, { ...pattern, topic: `Anti-pattern: ${pattern.topic}` }, 2);
      }
    }

    console.log(`${LOG_PREFIX} Extracted ${patterns.length} prediction patterns (${winningPatterns.length} wins, ${losingPatterns.length} losses)`);
  }

  private async extractTopicsFromAppData(userId: number): Promise<void> {
    try {
      const { executeQueryAppData } = await import("./tools/utilityTools");
      const [valAudit, mailOverview, valSuppliers] = await Promise.all([
        executeQueryAppData({ section: "suguval_audit" }).then(r => JSON.parse(r)).catch(() => null),
        executeQueryAppData({ section: "sugumaillane_overview" }).then(r => JSON.parse(r)).catch(() => null),
        executeQueryAppData({ section: "suguval_suppliers" }).then(r => JSON.parse(r)).catch(() => null),
      ]);

      const topics: { topic: string; category: string; importance: number; context: string }[] = [];

      if (valAudit) {
        if (valAudit.revenue > 0 && valAudit.purchases > 0) {
          const ratio = valAudit.purchases / valAudit.revenue;
          topics.push({
            topic: `Ratio achats/CA Valentine: ${(ratio * 100).toFixed(1)}%`,
            category: "sugu",
            importance: ratio > 0.35 ? 85 : 60,
            context: `CA=${valAudit.revenue?.toFixed(0)}€ Achats=${valAudit.purchases?.toFixed(0)}€ Frais=${valAudit.expenses?.toFixed(0)}€ Masse_salariale=${valAudit.payroll?.toFixed(0)}€`
          });
        }
        if (valAudit.payroll > 0 && valAudit.revenue > 0) {
          const payrollRatio = valAudit.payroll / valAudit.revenue;
          if (payrollRatio > 0.30) {
            topics.push({
              topic: `Masse salariale Valentine élevée: ${(payrollRatio * 100).toFixed(1)}% du CA`,
              category: "sugu",
              importance: 80,
              context: `Masse_salariale=${valAudit.payroll?.toFixed(0)}€ vs CA=${valAudit.revenue?.toFixed(0)}€`
            });
          }
        }
      }

      if (mailOverview && mailOverview.caisse?.total > 0 && mailOverview.achats?.total > 0) {
        const ratio = mailOverview.achats.total / mailOverview.caisse.total;
        topics.push({
          topic: `Ratio achats/CA Maillane: ${(ratio * 100).toFixed(1)}%`,
          category: "sugu",
          importance: ratio > 0.35 ? 85 : 60,
          context: `CA_caisse=${mailOverview.caisse.total?.toFixed(0)}€ Achats=${mailOverview.achats.total?.toFixed(0)}€ Employés_actifs=${mailOverview.employes?.actifs}`
        });
      }

      if (valAudit && mailOverview?.caisse?.total) {
        topics.push({
          topic: `Comparaison inter-restaurants: Valentine vs Maillane`,
          category: "sugu",
          importance: 70,
          context: `Valentine_CA=${valAudit.revenue?.toFixed(0)}€ Maillane_CA=${mailOverview.caisse.total?.toFixed(0)}€ Valentine_achats=${valAudit.purchases?.toFixed(0)}€ Maillane_achats=${mailOverview.achats?.total?.toFixed(0)}€`
        });
      }

      if (valSuppliers && valSuppliers.count > 10) {
        const categories = [...new Set(valSuppliers.suppliers?.map((s: any) => s.category).filter(Boolean))];
        topics.push({
          topic: `Base fournisseurs Valentine: ${valSuppliers.count} fournisseurs, ${categories.length} catégories`,
          category: "sugu",
          importance: 55,
          context: `Catégories: ${categories.slice(0, 5).join(", ")}`
        });
      }

      for (const t of topics) {
        const hash = this.generateTopicHash(t.topic);
        const existing = await db.select().from(learningProgress)
          .where(and(eq(learningProgress.userId, userId), eq(learningProgress.topicHash, hash)))
          .limit(1);

        if (existing.length === 0) {
          await db.insert(learningProgress).values({
            userId,
            topic: t.topic,
            topicHash: hash,
            domain: "sugu" as LearningDomain,
            currentDepth: 1,
            maxDepth: 3,
            priority: t.importance,
            confidenceScore: 70,
            triggerType: "time_based",
            extractedFrom: "app_data",
            category: t.category,
            lastAccessedAt: new Date(),
          });
        } else {
          await db.update(learningProgress)
            .set({ lastAccessedAt: new Date(), updatedAt: new Date(), priority: Math.max(existing[0].priority, t.importance) })
            .where(eq(learningProgress.id, existing[0].id));
        }
      }

      console.log(`${LOG_PREFIX} Extracted ${topics.length} business topics from app data (Valentine + Maillane)`);
    } catch (err: any) {
      console.log(`${LOG_PREFIX} App data extraction skipped: ${err?.message}`);
    }
  }

  private isStructuralPattern(prediction: any): boolean {
    const reco = prediction.recommendations as any;
    const bestBet = reco?.bestBet || "";
    
    const structuralBets = ["O2.5", "U2.5", "BTTS", "1", "X", "2"];
    if (structuralBets.includes(bestBet)) {
      const confidence = reco?.confidence || 0;
      if (confidence >= 65) return true;
    }
    
    return false;
  }

  private async addPredictionTopic(userId: number, pattern: PredictionPattern & { predictionId?: number }, maxDepth: number): Promise<void> {
    const hash = this.generateTopicHash(pattern.topic);
    const volatility = VOLATILITY_FACTORS["sports"];
    
    const existing = await db.select().from(learningProgress)
      .where(and(
        eq(learningProgress.userId, userId),
        eq(learningProgress.topicHash, hash)
      ));

    if (existing.length > 0) {
      const boost = pattern.isWinning ? 8 : -3;
      const currentPredIds = (existing[0] as any).sourcePredictionIds || [];
      const updatedPredIds = pattern.predictionId 
        ? [...new Set([...currentPredIds, pattern.predictionId])].slice(-20)
        : currentPredIds;
      
      await db.update(learningProgress)
        .set({
          usefulnessScore: sql`LEAST(100, GREATEST(10, ${learningProgress.usefulnessScore} + ${boost}))`,
          frequencyScore: sql`${learningProgress.frequencyScore} + 5`,
          recencyScore: 100,
          lastAccessedAt: new Date(),
          sourcePredictionIds: updatedPredIds,
          updatedAt: new Date()
        })
        .where(eq(learningProgress.id, existing[0].id));
    } else {
      await db.insert(learningProgress).values({
        userId,
        topic: pattern.topic,
        topicHash: hash,
        category: "learning",
        domain: "sports",
        priority: pattern.confidence,
        recencyScore: 100,
        frequencyScore: 20,
        usefulnessScore: pattern.isWinning ? 70 : 40,
        patternType: pattern.patternType,
        volatilityFactor: volatility,
        maxDepth,
        extractedFrom: "prediction_learning",
        confidenceScore: pattern.confidence,
        sourcePredictionIds: pattern.predictionId ? [pattern.predictionId] : [],
        lastAccessedAt: new Date()
      });
      
      console.log(`${LOG_PREFIX} Added prediction topic "${pattern.topic}" (type: ${pattern.patternType}, maxDepth: ${maxDepth})`);
    }
  }

  private generateTopicHash(topic: string): string {
    const normalized = topic.toLowerCase().trim().replace(/\s+/g, " ");
    return crypto.createHash("md5").update(normalized).digest("hex").slice(0, 16);
  }

  private async addOrUpdateTopic(
    userId: number, 
    extraction: TopicExtraction,
    conversationIds: number[]
  ): Promise<void> {
    const hash = this.generateTopicHash(extraction.topic);
    const domain = detectDomain(extraction.topic, extraction.context || "");
    
    const existing = await db.select().from(learningProgress)
      .where(and(
        eq(learningProgress.userId, userId),
        eq(learningProgress.topicHash, hash)
      ));

    const basePriority = extraction.importance;
    const domainWeight = DOMAIN_WEIGHTS[domain] || 1.0;
    const effectivePriority = Math.min(100, Math.round(basePriority * domainWeight));

    if (existing.length > 0) {
      const current = existing[0];
      const updatedConvIds = [...new Set([
        ...(current.sourceConversationIds || []),
        ...conversationIds
      ])].slice(-20);

      await db.update(learningProgress)
        .set({
          frequencyScore: sql`${learningProgress.frequencyScore} + 10`,
          recencyScore: 100,
          priority: Math.min(100, current.priority + 5),
          domain,
          sourceConversationIds: updatedConvIds,
          updatedAt: new Date()
        })
        .where(eq(learningProgress.id, current.id));
        
      console.log(`${LOG_PREFIX} Updated topic "${extraction.topic}" (domain: ${domain}, priority: ${current.priority + 5})`);
    } else {
      await db.insert(learningProgress).values({
        userId,
        topic: extraction.topic,
        topicHash: hash,
        category: extraction.category,
        domain,
        priority: effectivePriority,
        recencyScore: 100,
        frequencyScore: 10,
        usefulnessScore: 50,
        sourceConversationIds: conversationIds.slice(-10),
        extractedFrom: "conversation"
      });
      
      console.log(`${LOG_PREFIX} Added new topic "${extraction.topic}" (domain: ${domain}, priority: ${effectivePriority})`);
    }
  }

  private async getTopicsToProcess(userId: number): Promise<LearningProgress[]> {
    return db.select().from(learningProgress)
      .where(and(
        eq(learningProgress.userId, userId),
        sql`${learningProgress.currentDepth} < ${learningProgress.maxDepth}`,
        or(
          isNull(learningProgress.nextRunAt),
          lte(learningProgress.nextRunAt, new Date())
        ),
        gte(learningProgress.priority, MIN_PRIORITY_THRESHOLD)
      ))
      .orderBy(
        desc(learningProgress.priority),
        desc(learningProgress.usefulnessScore),
        desc(learningProgress.recencyScore),
        desc(learningProgress.frequencyScore)
      )
      .limit(this.MAX_TOPICS_PER_RUN * 2);
  }

  private async processTopicLayers(userId: number, topic: LearningProgress): Promise<LayerResult> {
    const result: LayerResult = {
      success: true,
      factsAdded: 0,
      connectionsAdded: 0,
      insightsAdded: 0,
      knowledgeIds: []
    };

    const currentDepth = topic.currentDepth;
    const domain = (topic as any).domain || "autre";
    console.log(`${LOG_PREFIX} Processing "${topic.topic}" [${domain}] at depth ${currentDepth} (${this.LAYER_NAMES[currentDepth] || "Unknown"})`);

    try {
      switch (currentDepth) {
        case 0: {
          const l1Result = await this.processLayer1Surface(userId, topic);
          result.factsAdded = l1Result.count;
          result.knowledgeIds = l1Result.ids;
          await this.updateLayerStatus(topic.id, 1, "completed", l1Result.ids, "layer1");
          break;
        }
        case 1: {
          const l2Result = await this.processLayer2Details(userId, topic);
          result.factsAdded = l2Result.count;
          result.knowledgeIds = l2Result.ids;
          await this.updateLayerStatus(topic.id, 2, "completed", l2Result.ids, "layer2");
          break;
        }
        case 2: {
          const l3Result = await this.processLayer3Connections(userId, topic);
          result.connectionsAdded = l3Result.count;
          result.knowledgeIds = l3Result.ids;
          await this.updateLayerStatus(topic.id, 3, "completed", l3Result.ids, "layer3");
          break;
        }
        case 3: {
          const l4Result = await this.processLayer4Insights(userId, topic);
          result.insightsAdded = l4Result.count;
          result.knowledgeIds = l4Result.ids;
          await this.updateLayerStatus(topic.id, 4, "completed", l4Result.ids, "layer4");
          break;
        }
      }

      const nextRunAt = new Date();
      nextRunAt.setHours(nextRunAt.getHours() + this.HOURS_BETWEEN_RUNS);

      await db.update(learningProgress)
        .set({
          currentDepth: currentDepth + 1,
          totalFacts: sql`${learningProgress.totalFacts} + ${result.factsAdded}`,
          totalConnections: sql`${learningProgress.totalConnections} + ${result.connectionsAdded}`,
          totalInsights: sql`${learningProgress.totalInsights} + ${result.insightsAdded}`,
          runCount: sql`${learningProgress.runCount} + 1`,
          lastRunAt: new Date(),
          nextRunAt,
          recencyScore: sql`GREATEST(0, ${learningProgress.recencyScore} - 10)`,
          updatedAt: new Date()
        })
        .where(eq(learningProgress.id, topic.id));

    } catch (error: any) {
      result.success = false;
      result.error = error.message;
      throw error;
    }

    return result;
  }

  private async processLayer1Surface(userId: number, topic: LearningProgress): Promise<{ count: number; ids: number[]; facts: L1Fact[] }> {
    console.log(`${LOG_PREFIX} Layer 1 (Surface): Gathering basic facts for "${topic.topic}"`);

    const response = await getBgAI().chat.completions.create({
      model: BG_MODEL_GETTER(),
      messages: [{
        role: "system",
        content: `Tu es un expert en synthese de connaissances. Fournis 3-5 faits fondamentaux sur le sujet donne.

Ces faits seront la BASE (Layer 1) pour un apprentissage en profondeur structure.

Pour chaque fait:
- title: Titre court (3-8 mots)
- content: Explication claire (2-4 phrases)
- tags: 2-3 tags pertinents

Reponds en JSON: { "facts": [...] }`
      }, {
        role: "user",
        content: `Sujet: ${topic.topic}\nCategorie: ${topic.category || "general"}`
      }],
      temperature: 0.4,
      response_format: { type: "json_object" }
    });

    const parsed = JSON.parse(response.choices[0].message.content || "{}");
    const facts = parsed.facts || [];

    const addedFacts: L1Fact[] = [];
    const ids: number[] = [];
    
    for (const fact of facts) {
      try {
        const knowledge = await brainService.addKnowledge(userId, {
          title: fact.title,
          content: fact.content,
          type: "fact",
          category: topic.category || "learning",
          tags: [...(fact.tags || []), "L1", "surface"],
          source: `AutoLearning L1: ${topic.topic}`,
          sourceType: "autonomous_learning",
          importance: 60,
          confidence: 70
        });
        
        addedFacts.push({
          id: knowledge.id,
          title: fact.title,
          content: fact.content,
          tags: fact.tags || []
        });
        ids.push(knowledge.id);
        
        await this.linkKnowledgeToTopic(topic.id, knowledge.id);
      } catch (e) {
        console.error(`${LOG_PREFIX} Error adding L1 fact:`, e);
      }
    }

    console.log(`${LOG_PREFIX} L1 complete: ${ids.length} facts added`);
    return { count: ids.length, ids, facts: addedFacts };
  }

  private async processLayer2Details(userId: number, topic: LearningProgress): Promise<{ count: number; ids: number[]; details: L2Detail[] }> {
    console.log(`${LOG_PREFIX} Layer 2 (Details): Deepening knowledge for "${topic.topic}"`);

    const l1Ids = (topic as any).layer1KnowledgeIds || topic.relatedKnowledgeIds || [];
    const l1Knowledge = l1Ids.length > 0 
      ? await db.select().from(knowledgeBase)
          .where(and(
            eq(knowledgeBase.userId, userId),
            inArray(knowledgeBase.id, l1Ids)
          ))
      : [];

    const l1FactsJson = l1Knowledge.map((k, i) => ({
      index: i + 1,
      id: k.id,
      title: k.title,
      content: k.content
    }));

    const response = await getBgAI().chat.completions.create({
      model: BG_MODEL_GETTER(),
      messages: [{
        role: "system",
        content: `Tu es un expert en approfondissement des connaissances.

Tu recois une liste de faits de base (Layer 1) sur un sujet.
Ton but: produire 2-4 connaissances plus detaillees QUI S'ACCROCHENT EXPLICITEMENT a ces faits.

STRUCTURE POUPEES RUSSES: Chaque detail DOIT referencer un fait L1 parent.

Pour chaque detail:
- title: Titre precis
- content: Explication approfondie (3-5 phrases)
- parentFactIndex: L'index (1-based) du fait L1 dont ce detail decoule
- keyPoints: 2-3 points cles
- tags: 2-3 tags

Reponds en JSON: { "details": [...] }`
      }, {
        role: "user",
        content: `Sujet: ${topic.topic}\n\nFaits Layer 1:\n${JSON.stringify(l1FactsJson, null, 2)}`
      }],
      temperature: 0.4,
      response_format: { type: "json_object" }
    });

    const parsed = JSON.parse(response.choices[0].message.content || "{}");
    const details = parsed.details || [];

    const addedDetails: L2Detail[] = [];
    const ids: number[] = [];
    
    for (const detail of details) {
      try {
        const parentIndex = detail.parentFactIndex;
        const parentFact = l1Knowledge[parentIndex - 1];
        const parentId = parentFact?.id;
        
        const knowledge = await brainService.addKnowledge(userId, {
          title: detail.title,
          content: detail.content,
          summary: (detail.keyPoints || []).join("; "),
          type: "concept",
          category: topic.category || "learning",
          tags: [...(detail.tags || []), "L2", "detail"],
          source: `AutoLearning L2: ${topic.topic}`,
          sourceType: "autonomous_learning",
          importance: 65,
          confidence: 75
        });

        if (parentId) {
          await db.update(knowledgeBase)
            .set({ parentId })
            .where(eq(knowledgeBase.id, knowledge.id));
        }

        addedDetails.push({
          id: knowledge.id,
          title: detail.title,
          content: detail.content,
          parentFactTitle: parentFact?.title || "",
          parentFactId: parentId,
          keyPoints: detail.keyPoints || []
        });
        ids.push(knowledge.id);
        
        await this.linkKnowledgeToTopic(topic.id, knowledge.id);
      } catch (e) {
        console.error(`${LOG_PREFIX} Error adding L2 detail:`, e);
      }
    }

    console.log(`${LOG_PREFIX} L2 complete: ${ids.length} details added (linked to L1 parents)`);
    return { count: ids.length, ids, details: addedDetails };
  }

  private async processLayer3Connections(userId: number, topic: LearningProgress): Promise<{ count: number; ids: number[] }> {
    console.log(`${LOG_PREFIX} Layer 3 (Connections): Finding relationships for "${topic.topic}"`);

    const l1Ids = (topic as any).layer1KnowledgeIds || [];
    const l2Ids = (topic as any).layer2KnowledgeIds || [];
    const allIds = [...l1Ids, ...l2Ids, ...(topic.relatedKnowledgeIds || [])];
    
    const relatedKnowledge = allIds.length > 0
      ? await db.select().from(knowledgeBase)
          .where(and(
            eq(knowledgeBase.userId, userId),
            inArray(knowledgeBase.id, allIds)
          ))
      : [];

    const l1Knowledge = relatedKnowledge.filter(k => k.tags?.includes("L1"));
    const l2Knowledge = relatedKnowledge.filter(k => k.tags?.includes("L2"));

    const otherTopics = await db.select().from(learningProgress)
      .where(and(
        eq(learningProgress.userId, userId),
        sql`${learningProgress.id} != ${topic.id}`,
        gte(learningProgress.currentDepth, 1)
      ))
      .limit(10);

    const l1Context = l1Knowledge.map(k => `[L1] ${k.title}`).join(", ");
    const l2Context = l2Knowledge.map(k => `[L2] ${k.title}`).join(", ");
    const otherContext = otherTopics.map(t => `[Topic] ${t.topic}`).join(", ");

    const response = await getBgAI().chat.completions.create({
      model: BG_MODEL_GETTER(),
      messages: [{
        role: "system",
        content: `Tu es un expert en connexions conceptuelles.

STRUCTURE POUPEES RUSSES: Tu dois creer des connexions qui lient:
- Un concept L2 a un concept L1 (approfondissement)
- Un concept L1/L2 a un autre sujet (transversal)

Identifie 2-4 connexions significatives.

Pour chaque connexion:
- sourceLabel: Nom du concept source
- sourceLayer: "L1" ou "L2"
- targetLabel: Nom du concept cible  
- targetLayer: "L1", "L2" ou "topic" (si c'est un autre sujet)
- relationship: Type de relation (relates_to, is_part_of, depends_on, supports, similar_to, contrasts_with, deepens)
- strength: Force de la connexion (1-100)
- context: Explication de la connexion (1-2 phrases)

Reponds en JSON: { "connections": [...] }`
      }, {
        role: "user",
        content: `Sujet principal: ${topic.topic}\n\nConnaissances L1: ${l1Context || "Aucune"}\nConnaissances L2: ${l2Context || "Aucune"}\nAutres sujets appris: ${otherContext || "Aucun"}`
      }],
      temperature: 0.4,
      response_format: { type: "json_object" }
    });

    const parsed = JSON.parse(response.choices[0].message.content || "{}");
    const connections = parsed.connections || [];

    const ids: number[] = [];
    
    for (const conn of connections) {
      try {
        const [graph] = await db.insert(knowledgeGraph).values({
          userId,
          sourceType: "concept",
          sourceId: topic.id,
          sourceLabel: `[${conn.sourceLayer || "L1"}] ${conn.sourceLabel || topic.topic}`,
          relationship: conn.relationship || "relates_to",
          relationshipStrength: conn.strength || 50,
          targetType: "concept",
          targetId: 0,
          targetLabel: `[${conn.targetLayer || "topic"}] ${conn.targetLabel}`,
          context: conn.context,
          isInferred: true,
          confidence: 70
        }).returning();

        ids.push(graph.id);
        await this.linkGraphToTopic(topic.id, graph.id);
      } catch (e) {
        console.error(`${LOG_PREFIX} Error adding L3 connection:`, e);
      }
    }

    console.log(`${LOG_PREFIX} L3 complete: ${ids.length} connections added`);
    return { count: ids.length, ids };
  }

  private async processLayer4Insights(userId: number, topic: LearningProgress): Promise<{ count: number; ids: number[] }> {
    console.log(`${LOG_PREFIX} Layer 4 (Insights): Generating strategic insights for "${topic.topic}"`);

    const l1Ids = (topic as any).layer1KnowledgeIds || [];
    const l2Ids = (topic as any).layer2KnowledgeIds || [];
    const l3Ids = (topic as any).layer3GraphIds || topic.relatedGraphIds || [];
    const allKnowledgeIds = [...l1Ids, ...l2Ids, ...(topic.relatedKnowledgeIds || [])];
    
    const allKnowledge = allKnowledgeIds.length > 0
      ? await db.select().from(knowledgeBase)
          .where(and(
            eq(knowledgeBase.userId, userId),
            inArray(knowledgeBase.id, allKnowledgeIds)
          ))
      : [];

    const allConnections = l3Ids.length > 0
      ? await db.select().from(knowledgeGraph)
          .where(and(
            eq(knowledgeGraph.userId, userId),
            inArray(knowledgeGraph.id, l3Ids)
          ))
      : [];

    const l1Context = allKnowledge.filter(k => k.tags?.includes("L1")).map(k => `- [L1] ${k.title}: ${k.content}`).join("\n");
    const l2Context = allKnowledge.filter(k => k.tags?.includes("L2")).map(k => `- [L2] ${k.title}: ${k.content}`).join("\n");
    const l3Context = allConnections.map(c => `- ${c.sourceLabel} ${c.relationship} ${c.targetLabel}`).join("\n");

    const domain = (topic as any).domain || "autre";

    const response = await getBgAI().chat.completions.create({
      model: BG_MODEL_GETTER(),
      messages: [{
        role: "system",
        content: `Tu es un expert en synthese strategique pour un utilisateur qui s'interesse a:
- Paris sportifs (value bets, gestion de bankroll)
- Trading (analyse technique, crypto)
- Optimisation business (restaurants SUGU)
- Developpement logiciel

STRUCTURE POUPEES RUSSES: Tu as acces a 3 couches de connaissances:
- L1: Faits de base
- L2: Details approfondis (lies aux L1)
- L3: Connexions entre concepts

Base sur TOUTES ces couches, genere 1-2 insights VRAIMENT utiles.

Pour chaque insight:
- title: Titre de l'insight
- content: L'insight complet (3-5 phrases)
- implications: 2-3 implications pratiques CONCRETES
- recommendedActions: 2-3 actions specifiques que l'utilisateur pourrait prendre
- confidence: Niveau de confiance (1-100)
- basedOn: Liste des layers utilises pour cet insight (ex: ["L1-Fait1", "L2-Detail2", "L3-Connexion1"])

Reponds en JSON: { "insights": [...] }`
      }, {
        role: "user",
        content: `Sujet: ${topic.topic}\nDomaine: ${domain}\n\n=== LAYER 1 (Faits de base) ===\n${l1Context || "Aucun"}\n\n=== LAYER 2 (Details) ===\n${l2Context || "Aucun"}\n\n=== LAYER 3 (Connexions) ===\n${l3Context || "Aucune"}`
      }],
      temperature: 0.5,
      response_format: { type: "json_object" }
    });

    const parsed = JSON.parse(response.choices[0].message.content || "{}");
    const insights = parsed.insights || [];

    const ids: number[] = [];
    
    for (const insight of insights) {
      try {
        const basedOnStr = (insight.basedOn || []).join(", ");
        
        await brainService.logLearning(userId, {
          topic: topic.topic,
          content: `${insight.title}: ${insight.content}\n\nImplications: ${(insight.implications || []).join("; ")}\nActions recommandees: ${(insight.recommendedActions || []).join("; ")}\nBase sur: ${basedOnStr}`,
          learningType: "insight",
          sourceType: "autonomous_learning"
        });

        const importanceBoost = (domain === "sports" || domain === "trading") ? 90 : 80;
        
        const summaryWithBasedOn = `Implications: ${(insight.implications || []).join("; ")}\n\nActions: ${(insight.recommendedActions || []).join("; ")}\n\nBase sur: ${basedOnStr}`;
        
        const knowledge = await brainService.addKnowledge(userId, {
          title: `[Insight] ${insight.title}`,
          content: insight.content,
          summary: summaryWithBasedOn,
          type: "concept",
          category: topic.category || "learning",
          tags: ["insight", "L4", "autonomous-learning", domain],
          source: `AutoLearning L4: ${topic.topic}`,
          sourceType: "autonomous_learning",
          importance: importanceBoost,
          confidence: insight.confidence || 75
        });

        ids.push(knowledge.id);
        await this.linkKnowledgeToTopic(topic.id, knowledge.id);
      } catch (e) {
        console.error(`${LOG_PREFIX} Error adding L4 insight:`, e);
      }
    }

    console.log(`${LOG_PREFIX} L4 complete: ${ids.length} insights added (domain: ${domain})`);
    return { count: ids.length, ids };
  }

  private async updateLayerStatus(
    topicId: number, 
    layer: number, 
    status: string,
    ids: number[],
    layerType: "layer1" | "layer2" | "layer3" | "layer4"
  ): Promise<void> {
    const statusField = `layer${layer}Status` as keyof LearningProgress;
    const idsField = layerType === "layer3" ? "layer3GraphIds" : `${layerType}KnowledgeIds`;
    
    const updateData: any = { 
      [statusField]: status, 
      updatedAt: new Date() 
    };
    
    if (layerType === "layer1") {
      updateData.layer1KnowledgeIds = ids;
    } else if (layerType === "layer2") {
      updateData.layer2KnowledgeIds = ids;
    } else if (layerType === "layer3") {
      updateData.layer3GraphIds = ids;
    } else if (layerType === "layer4") {
      updateData.layer4InsightIds = ids;
    }
    
    await db.update(learningProgress)
      .set(updateData)
      .where(eq(learningProgress.id, topicId));
  }

  private async linkKnowledgeToTopic(topicId: number, knowledgeId: number): Promise<void> {
    const [topic] = await db.select().from(learningProgress)
      .where(eq(learningProgress.id, topicId));
    
    if (topic) {
      const updated = [...new Set([...(topic.relatedKnowledgeIds || []), knowledgeId])];
      await db.update(learningProgress)
        .set({ relatedKnowledgeIds: updated })
        .where(eq(learningProgress.id, topicId));
    }
  }

  private async linkGraphToTopic(topicId: number, graphId: number): Promise<void> {
    const [topic] = await db.select().from(learningProgress)
      .where(eq(learningProgress.id, topicId));
    
    if (topic) {
      const updated = [...new Set([...(topic.relatedGraphIds || []), graphId])];
      await db.update(learningProgress)
        .set({ relatedGraphIds: updated })
        .where(eq(learningProgress.id, topicId));
    }
  }

  private async markTopicError(topicId: number, error: string): Promise<void> {
    const nextRunAt = new Date();
    nextRunAt.setHours(nextRunAt.getHours() + 12);

    await db.update(learningProgress)
      .set({
        lastError: error,
        nextRunAt,
        updatedAt: new Date()
      })
      .where(eq(learningProgress.id, topicId));
  }

  async boostUsefulnessScore(topicId: number, boost: number = 5): Promise<void> {
    await db.update(learningProgress)
      .set({
        usefulnessScore: sql`LEAST(100, ${learningProgress.usefulnessScore} + ${boost})`,
        updatedAt: new Date()
      })
      .where(eq(learningProgress.id, topicId));
    
    console.log(`${LOG_PREFIX} Boosted usefulness score for topic ${topicId} by ${boost}`);
  }

  async onKnowledgeUsed(userId: number, knowledgeIds: number[]): Promise<void> {
    if (knowledgeIds.length === 0) return;
    
    for (const kId of knowledgeIds) {
      await db.update(knowledgeBase)
        .set({ lastAccessedAt: new Date(), updatedAt: new Date() })
        .where(eq(knowledgeBase.id, kId));
    }
    
    const topics = await db.select().from(learningProgress)
      .where(eq(learningProgress.userId, userId));
    
    for (const topic of topics) {
      const allTopicKnowledgeIds = [
        ...((topic as any).layer1KnowledgeIds || []),
        ...((topic as any).layer2KnowledgeIds || []),
        ...((topic as any).layer4InsightIds || []),
        ...(topic.relatedKnowledgeIds || [])
      ];
      
      const usedFromTopic = knowledgeIds.filter(id => allTopicKnowledgeIds.includes(id));
      
      if (usedFromTopic.length > 0) {
        const boost = Math.min(15, usedFromTopic.length * 3);
        await db.update(learningProgress)
          .set({
            usefulnessScore: sql`LEAST(100, ${learningProgress.usefulnessScore} + ${boost})`,
            lastAccessedAt: new Date(),
            recencyScore: 100,
            updatedAt: new Date()
          })
          .where(eq(learningProgress.id, topic.id));
        
        console.log(`${LOG_PREFIX} Boosted usefulness score for topic ${topic.id} by ${boost}`);
      }
    }
  }

  async decreaseUnusedTopicsScore(userId: number, decayAmount: number = 2): Promise<number> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const result = await db.update(learningProgress)
      .set({
        usefulnessScore: sql`GREATEST(10, ${learningProgress.usefulnessScore} - ${decayAmount})`,
        updatedAt: new Date()
      })
      .where(and(
        eq(learningProgress.userId, userId),
        lte(learningProgress.updatedAt, thirtyDaysAgo),
        sql`${learningProgress.usefulnessScore} > 10`
      ))
      .returning();
    
    if (result.length > 0) {
      console.log(`${LOG_PREFIX} Decayed usefulness score for ${result.length} inactive topics`);
    }
    
    return result.length;
  }

  async getStatistics(userId: number): Promise<{
    totalTopics: number;
    completedTopics: number;
    totalFacts: number;
    totalConnections: number;
    totalInsights: number;
    averageDepth: number;
    byDomain: Record<string, number>;
  }> {
    const topics = await db.select().from(learningProgress)
      .where(eq(learningProgress.userId, userId));

    const completed = topics.filter(t => t.currentDepth >= t.maxDepth);
    const totalDepth = topics.reduce((sum, t) => sum + t.currentDepth, 0);

    const byDomain: Record<string, number> = {};
    for (const t of topics) {
      const d = (t as any).domain || "autre";
      byDomain[d] = (byDomain[d] || 0) + 1;
    }

    return {
      totalTopics: topics.length,
      completedTopics: completed.length,
      totalFacts: topics.reduce((sum, t) => sum + t.totalFacts, 0),
      totalConnections: topics.reduce((sum, t) => sum + t.totalConnections, 0),
      totalInsights: topics.reduce((sum, t) => sum + t.totalInsights, 0),
      averageDepth: topics.length > 0 ? totalDepth / topics.length : 0,
      byDomain
    };
  }

  async getTopicsInProgress(userId: number): Promise<LearningProgress[]> {
    return db.select().from(learningProgress)
      .where(and(
        eq(learningProgress.userId, userId),
        sql`${learningProgress.currentDepth} < ${learningProgress.maxDepth}`
      ))
      .orderBy(desc(learningProgress.priority));
  }

  async addManualTopic(userId: number, topic: string, category?: string, priority?: number): Promise<LearningProgress> {
    const hash = this.generateTopicHash(topic);
    const domain = detectDomain(topic, "");
    
    const [existing] = await db.select().from(learningProgress)
      .where(and(
        eq(learningProgress.userId, userId),
        eq(learningProgress.topicHash, hash)
      ));

    if (existing) {
      return existing;
    }

    const basePriority = priority || 70;
    const domainWeight = DOMAIN_WEIGHTS[domain] || 1.0;
    const effectivePriority = Math.min(100, Math.round(basePriority * domainWeight));

    const [newTopic] = await db.insert(learningProgress).values({
      userId,
      topic,
      topicHash: hash,
      category: category || "learning",
      domain,
      priority: effectivePriority,
      recencyScore: 100,
      frequencyScore: 50,
      usefulnessScore: 60,
      extractedFrom: "user_request",
      triggerType: "manual"
    }).returning();

    console.log(`${LOG_PREFIX} Manual topic added: "${topic}" (domain: ${domain}, priority: ${effectivePriority})`);
    return newTopic;
  }

  private async processLayer5CrossDomain(userId: number): Promise<{ count: number; ids: number[] }> {
    const l4Insights = await db.select()
      .from(knowledgeBase)
      .where(and(
        eq(knowledgeBase.userId, userId),
        gte(knowledgeBase.confidence, L5_MIN_CONFIDENCE),
        gte(knowledgeBase.importance, L5_MIN_IMPORTANCE),
        sql`${knowledgeBase.tags} @> ARRAY['L4']::text[]`
      ))
      .orderBy(desc(knowledgeBase.confidence), desc(knowledgeBase.importance))
      .limit(20);

    if (l4Insights.length < 4) {
      console.log(`${LOG_PREFIX} L5: Not enough high-quality L4 insights (${l4Insights.length}/4 minimum)`);
      return { count: 0, ids: [] };
    }

    const domainGroups: Record<string, typeof l4Insights> = {};
    for (const insight of l4Insights) {
      const tags = insight.tags || [];
      for (const domain of ["sports", "trading", "sugu", "dev"] as LearningDomain[]) {
        if (tags.includes(domain)) {
          if (!domainGroups[domain]) domainGroups[domain] = [];
          domainGroups[domain].push(insight);
        }
      }
    }

    const domainsWithInsights = Object.keys(domainGroups).filter(d => domainGroups[d].length >= 2);
    if (domainsWithInsights.length < 2) {
      console.log(`${LOG_PREFIX} L5: Need insights from at least 2 domains for cross-domain analysis`);
      return { count: 0, ids: [] };
    }

    const insightsSummary = l4Insights.slice(0, 10).map(i => 
      `[${(i.tags || []).filter(t => ["sports", "trading", "sugu", "dev"].includes(t)).join("/")}] ${i.title}: ${i.summary || i.content?.slice(0, 200)}`
    ).join("\n\n");

    try {
      const response = await getBgAI().chat.completions.create({
        model: BG_MODEL_GETTER(),
        messages: [{
          role: "system",
          content: `Tu es un expert en transfert de connaissances entre domaines. Analyse ces insights de haut niveau provenant de differents domaines (sports, trading, sugu/business, dev) et identifie des VRAIS transferts de methode/action utilisables.

REGLES STRICTES:
- Ne genere un insight cross-domain QUE s'il y a un VRAI transfert de methode/action.
- Pas de metaphores fumeuses ou de platitudes.
- Chaque insight doit etre ACTIONABLE avec des etapes concretes.
- Maximum 2 insights cross-domain par analyse.

Pour chaque insight valide, fournis:
- title: Titre court (5-10 mots)
- content: Explication du transfert (3-5 phrases)
- domainsInvolved: Les 2 domaines concernes
- actionsTransferables: 2-4 actions concretes transferables
- sourceInsightIds: Les IDs des insights sources

Reponds en JSON: { "crossDomainInsights": [...] } ou { "crossDomainInsights": [] } si aucun transfert valide.`
        }, {
          role: "user",
          content: insightsSummary
        }],
        temperature: 0.3,
        response_format: { type: "json_object" }
      });

      const parsed = JSON.parse(response.choices[0].message.content || "{}");
      const crossInsights: L5CrossDomainInsight[] = parsed.crossDomainInsights || [];

      const ids: number[] = [];
      for (const insight of crossInsights.slice(0, 2)) {
        try {
          const knowledge = await brainService.addKnowledge(userId, {
            title: `[L5 Cross-Domain] ${insight.title}`,
            content: insight.content,
            summary: `Domaines: ${insight.domainsInvolved.join(" ↔ ")}\nActions: ${insight.actionsTransferables.join("; ")}`,
            type: "concept",
            category: "cross_domain",
            tags: ["L5", "cross-domain", ...insight.domainsInvolved],
            source: "AutoLearning L5 Cross-Domain",
            sourceType: "autonomous_learning",
            importance: 95,
            confidence: 85
          });
          ids.push(knowledge.id);
        } catch (e) {
          console.error(`${LOG_PREFIX} Error adding L5 cross-domain insight:`, e);
        }
      }

      console.log(`${LOG_PREFIX} L5 Cross-Domain complete: ${ids.length} insights added`);
      return { count: ids.length, ids };

    } catch (error: any) {
      console.error(`${LOG_PREFIX} L5 Cross-Domain error:`, error.message);
      return { count: 0, ids: [] };
    }
  }

  async generateL5CrossDomainInsights(userId: number): Promise<{ generated: number; ids: number[] }> {
    console.log(`${LOG_PREFIX} Generating L5 cross-domain insights for user ${userId}`);
    const result = await this.processLayer5CrossDomain(userId);
    return { generated: result.count, ids: result.ids };
  }

  async applyConfidenceDecay(userId: number): Promise<{ decayed: number; protected: number }> {
    const now = new Date();
    
    const allTopics = await db.select().from(learningProgress)
      .where(and(
        eq(learningProgress.userId, userId),
        sql`${learningProgress.confidenceScore} > 20`
      ));

    let decayed = 0;
    let protectedCount = 0;

    for (const topic of allTopics) {
      const depth = topic.currentDepth || 1;
      const lastAccessed = topic.lastAccessedAt ? new Date(topic.lastAccessedAt) : null;
      
      const decayThresholdDays = this.getDecayThreshold(depth);
      
      if (decayThresholdDays === -1) {
        protectedCount++;
        continue;
      }

      const thresholdDate = new Date(now);
      thresholdDate.setDate(thresholdDate.getDate() - decayThresholdDays);

      const isStale = !lastAccessed || lastAccessed <= thresholdDate;
      
      if (!isStale) {
        continue;
      }

      const volatility = (topic as any).volatilityFactor || 1.0;
      const depthProtection = Math.max(0.3, 1 - (depth * 0.15));
      const baseDecay = 3;
      const actualDecay = Math.max(1, Math.round(baseDecay * volatility * depthProtection));

      await db.update(learningProgress)
        .set({
          confidenceScore: sql`GREATEST(20, ${learningProgress.confidenceScore} - ${actualDecay})`,
          updatedAt: new Date()
        })
        .where(eq(learningProgress.id, topic.id));
      
      decayed++;
    }

    await this.applyKnowledgeDecay(userId);

    if (decayed > 0 || protectedCount > 0) {
      console.log(`${LOG_PREFIX} Confidence decay applied to ${decayed} stale topics (${protectedCount} protected by depth)`);
    }
    return { decayed, protected: protectedCount };
  }

  private getDecayThreshold(depth: number): number {
    switch (depth) {
      case 1: return 30;
      case 2: return 45;
      case 3: return 60;
      case 4: return 90;
      case 5: return -1;
      default: return depth >= 5 ? -1 : 30;
    }
  }

  private async applyKnowledgeDecay(userId: number): Promise<{ decayed: number; protected: number }> {
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const staleKnowledge = await db.select().from(knowledgeBase)
      .where(and(
        eq(knowledgeBase.userId, userId),
        sql`${knowledgeBase.confidence} > 30`,
        or(
          isNull(knowledgeBase.lastAccessedAt),
          lte(knowledgeBase.lastAccessedAt, sixtyDaysAgo)
        )
      ));

    let decayed = 0;
    let protectedCount = 0;

    for (const knowledge of staleKnowledge) {
      const tags = knowledge.tags || [];
      
      if (tags.includes('L4') || tags.includes('L5') || tags.includes('core') || tags.includes('strategic')) {
        protectedCount++;
        continue;
      }

      const baseDecay = tags.includes('L3') ? 1 : 2;

      await db.update(knowledgeBase)
        .set({
          confidence: sql`GREATEST(30, ${knowledgeBase.confidence} - ${baseDecay})`,
          updatedAt: new Date()
        })
        .where(eq(knowledgeBase.id, knowledge.id));
      
      decayed++;
    }

    if (decayed > 0 || protectedCount > 0) {
      console.log(`${LOG_PREFIX} Knowledge decay: ${decayed} decayed, ${protectedCount} protected (L4/L5/core/strategic)`);
    }

    return { decayed, protected: protectedCount };
  }

  async onPredictionResult(
    userId: number, 
    predictionId: number, 
    won: boolean, 
    modelProb: number, 
    impliedProb: number,
    knowledgeIdsUsed: number[]
  ): Promise<void> {
    const edgeFactor = (modelProb - impliedProb) / 10;
    
    const baseWin = 10;
    const baseLoss = 5;
    
    const winDelta = Math.round(baseWin * Math.max(0.5, edgeFactor));
    const lossDelta = Math.round(baseLoss * Math.max(0.5, Math.abs(edgeFactor)));

    for (const kId of knowledgeIdsUsed) {
      const confidenceChange = won ? 5 : -2;
      const importanceChange = won ? 3 : -1;
      
      await db.update(knowledgeBase)
        .set({
          confidence: sql`LEAST(100, GREATEST(20, ${knowledgeBase.confidence} + ${confidenceChange}))`,
          importance: sql`LEAST(100, GREATEST(30, ${knowledgeBase.importance} + ${importanceChange}))`,
          lastAccessedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(knowledgeBase.id, kId));
    }

    const topics = await db.select().from(learningProgress)
      .where(eq(learningProgress.userId, userId));
    
    for (const topic of topics) {
      const allKnowledgeIds = [
        ...((topic as any).layer1KnowledgeIds || []),
        ...((topic as any).layer2KnowledgeIds || []),
        ...((topic as any).layer4InsightIds || []),
        ...(topic.relatedKnowledgeIds || [])
      ];
      
      const matchingIds = knowledgeIdsUsed.filter(id => allKnowledgeIds.includes(id));
      if (matchingIds.length > 0) {
        const usefulnessChange = won ? winDelta : -(lossDelta / 2);
        const confidenceChange = won ? 3 : -1;
        
        const currentPredIds = (topic as any).sourcePredictionIds || [];
        const updatedPredIds = [...new Set([...currentPredIds, predictionId])].slice(-20);
        
        await db.update(learningProgress)
          .set({
            usefulnessScore: sql`LEAST(100, GREATEST(10, ${learningProgress.usefulnessScore} + ${Math.round(usefulnessChange)}))`,
            confidenceScore: sql`LEAST(100, GREATEST(20, ${learningProgress.confidenceScore} + ${confidenceChange}))`,
            recencyScore: 100,
            lastAccessedAt: new Date(),
            sourcePredictionIds: updatedPredIds,
            updatedAt: new Date()
          })
          .where(eq(learningProgress.id, topic.id));
        
        console.log(`${LOG_PREFIX} Prediction feedback: topic "${topic.topic}" ${won ? "boosted" : "decreased"} by ${Math.round(usefulnessChange)} (edge: ${edgeFactor.toFixed(2)})`);
      }
    }
  }
}

export const autonomousLearningServiceV2 = new AutonomousLearningServiceV2();
