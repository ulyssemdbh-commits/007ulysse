import { db } from "../db";
import { knowledgeBase, learningProgress, knowledgeGraph } from "@shared/schema";
import { eq, and, desc, gte, sql, inArray } from "drizzle-orm";
import { brainService } from "./brainService";
import OpenAI from "openai";

const LOG_PREFIX = "[LearningOptimizer]";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

interface QualityScore {
  overall: number;
  specificity: number;
  actionability: number;
  novelty: number;
  coherence: number;
}

interface PromotionCandidate {
  id: number;
  title: string;
  content: string;
  currentLayer: number;
  qualityScore: QualityScore;
  shouldPromote: boolean;
  reason: string;
}

class LearningOptimizerService {
  private readonly L4_PROMOTION_THRESHOLD = 75;
  private readonly QUALITY_BOOST_THRESHOLD = 60;

  async evaluateKnowledgeQuality(userId: number, knowledgeId: number): Promise<QualityScore> {
    const [knowledge] = await db.select().from(knowledgeBase)
      .where(and(eq(knowledgeBase.userId, userId), eq(knowledgeBase.id, knowledgeId)));

    if (!knowledge) {
      return { overall: 0, specificity: 0, actionability: 0, novelty: 0, coherence: 0 };
    }

    let parsed: any = {};
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{
          role: "system",
          content: `Evalue la qualite de cette connaissance sur 4 criteres (0-100):
- specificity: Precision et detail (pas de generalites)
- actionability: Peut-on agir dessus?
- novelty: Apporte quelque chose de nouveau?
- coherence: Structure logique et claire?

Reponds en JSON: { "specificity": X, "actionability": X, "novelty": X, "coherence": X }`
        }, {
          role: "user",
          content: `Titre: ${knowledge.title}\nContenu: ${knowledge.content}\nTags: ${(knowledge.tags || []).join(", ")}`
        }],
        temperature: 0.2,
        response_format: { type: "json_object" }
      });

      parsed = JSON.parse(response.choices[0].message.content || "{}");
    } catch (error: any) {
      console.error(`${LOG_PREFIX} Error evaluating quality:`, error.message);
      return { overall: 50, specificity: 50, actionability: 50, novelty: 50, coherence: 50 };
    }
    
    const scores = {
      specificity: parsed.specificity || 50,
      actionability: parsed.actionability || 50,
      novelty: parsed.novelty || 50,
      coherence: parsed.coherence || 50,
      overall: 0
    };
    
    scores.overall = Math.round(
      (scores.specificity * 0.25) + 
      (scores.actionability * 0.35) + 
      (scores.novelty * 0.2) + 
      (scores.coherence * 0.2)
    );

    return scores;
  }

  async findPromotionCandidates(userId: number): Promise<PromotionCandidate[]> {
    console.log(`${LOG_PREFIX} Searching for L4 promotion candidates...`);

    const l2l3Knowledge = await db.select().from(knowledgeBase)
      .where(and(
        eq(knowledgeBase.userId, userId),
        gte(knowledgeBase.confidence, 70),
        sql`(${knowledgeBase.tags} @> ARRAY['L2']::text[] OR ${knowledgeBase.tags} @> ARRAY['L3']::text[])`
      ))
      .orderBy(desc(knowledgeBase.confidence))
      .limit(10);

    const candidates: PromotionCandidate[] = [];

    for (const knowledge of l2l3Knowledge) {
      const qualityScore = await this.evaluateKnowledgeQuality(userId, knowledge.id);
      const currentLayer = knowledge.tags?.includes('L3') ? 3 : 2;
      
      const shouldPromote = qualityScore.overall >= this.L4_PROMOTION_THRESHOLD && 
                           qualityScore.actionability >= 70;

      candidates.push({
        id: knowledge.id,
        title: knowledge.title,
        content: knowledge.content || "",
        currentLayer,
        qualityScore,
        shouldPromote,
        reason: shouldPromote 
          ? `Score ${qualityScore.overall}/100, actionability ${qualityScore.actionability}% - promotion recommandee`
          : `Score ${qualityScore.overall}/100 insuffisant (seuil: ${this.L4_PROMOTION_THRESHOLD})`
      });
    }

    const promotable = candidates.filter(c => c.shouldPromote);
    console.log(`${LOG_PREFIX} Found ${promotable.length}/${candidates.length} promotion candidates`);

    return candidates;
  }

  async promoteToL4(userId: number, knowledgeId: number): Promise<{ success: boolean; newId?: number; error?: string }> {
    const [knowledge] = await db.select().from(knowledgeBase)
      .where(and(eq(knowledgeBase.userId, userId), eq(knowledgeBase.id, knowledgeId)));

    if (!knowledge) {
      return { success: false, error: "Knowledge not found" };
    }

    try {
      const domain = this.detectDomainFromTags(knowledge.tags || []);
      
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{
          role: "system",
          content: `Transforme cette connaissance L2/L3 en un INSIGHT L4 de haute qualite.

Un insight L4 doit:
- Etre strategiquement actionable
- Avoir des implications claires
- Proposer 2-3 actions concretes

Reponds en JSON:
{
  "title": "Titre de l'insight",
  "content": "L'insight complet (3-5 phrases)",
  "implications": ["Implication 1", "Implication 2"],
  "actions": ["Action 1", "Action 2", "Action 3"],
  "confidence": 80-95
}`
        }, {
          role: "user",
          content: `Connaissance source:\nTitre: ${knowledge.title}\nContenu: ${knowledge.content}`
        }],
        temperature: 0.4,
        response_format: { type: "json_object" }
      });

      const parsed = JSON.parse(response.choices[0].message.content || "{}");

      const newKnowledge = await brainService.addKnowledge(userId, {
        title: `[L4 Insight] ${parsed.title || knowledge.title}`,
        content: parsed.content || knowledge.content,
        summary: `Implications: ${(parsed.implications || []).join("; ")}\nActions: ${(parsed.actions || []).join("; ")}`,
        type: "concept",
        category: knowledge.category || "insight",
        tags: ["L4", "insight", "promoted", domain],
        source: `Promoted from L2/L3 #${knowledgeId}`,
        sourceType: "autonomous_learning",
        importance: 90,
        confidence: parsed.confidence || 85
      });

      await db.update(knowledgeBase)
        .set({ 
          parentId: newKnowledge.id,
          updatedAt: new Date()
        })
        .where(eq(knowledgeBase.id, knowledgeId));

      console.log(`${LOG_PREFIX} Promoted knowledge #${knowledgeId} to L4 insight #${newKnowledge.id}`);
      return { success: true, newId: newKnowledge.id };

    } catch (error: any) {
      console.error(`${LOG_PREFIX} Promotion error:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async autoPromoteBatch(userId: number): Promise<{ promoted: number; candidates: number }> {
    const candidates = await this.findPromotionCandidates(userId);
    const toPromote = candidates.filter(c => c.shouldPromote);
    
    let promoted = 0;
    for (const candidate of toPromote.slice(0, 3)) {
      const result = await this.promoteToL4(userId, candidate.id);
      if (result.success) promoted++;
    }

    console.log(`${LOG_PREFIX} Auto-promotion complete: ${promoted}/${toPromote.length} promoted`);
    return { promoted, candidates: toPromote.length };
  }

  async enrichL2L3Context(userId: number, topicId: number): Promise<string[]> {
    const [topic] = await db.select().from(learningProgress)
      .where(eq(learningProgress.id, topicId));

    if (!topic) return [];

    const highQualityKnowledge = await db.select().from(knowledgeBase)
      .where(and(
        eq(knowledgeBase.userId, userId),
        gte(knowledgeBase.confidence, 80),
        sql`${knowledgeBase.tags} @> ARRAY['L4']::text[]`
      ))
      .orderBy(desc(knowledgeBase.confidence))
      .limit(5);

    const relatedConnections = await db.select().from(knowledgeGraph)
      .where(and(
        eq(knowledgeGraph.userId, userId),
        gte(knowledgeGraph.confidence, 70)
      ))
      .orderBy(desc(knowledgeGraph.confidence))
      .limit(10);

    const context: string[] = [];

    for (const k of highQualityKnowledge) {
      context.push(`[L4 Insight] ${k.title}: ${k.summary || k.content?.slice(0, 200)}`);
    }

    for (const c of relatedConnections) {
      context.push(`[Connection] ${c.sourceLabel} ${c.relationship} ${c.targetLabel}`);
    }

    return context;
  }

  async accelerateLearningCycle(userId: number, topicId: number): Promise<{ accelerated: boolean; reason: string }> {
    const [topic] = await db.select().from(learningProgress)
      .where(eq(learningProgress.id, topicId));

    if (!topic) {
      return { accelerated: false, reason: "Topic not found" };
    }

    const l1Ids = (topic as any).layer1KnowledgeIds || [];
    const l2Ids = (topic as any).layer2KnowledgeIds || [];

    if (l1Ids.length < 2 || l2Ids.length < 2) {
      return { accelerated: false, reason: "Not enough L1/L2 content to accelerate" };
    }

    const avgQuality = await this.calculateAverageQuality(userId, [...l1Ids, ...l2Ids]);

    if (avgQuality >= this.QUALITY_BOOST_THRESHOLD) {
      await db.update(learningProgress)
        .set({
          priority: sql`LEAST(100, ${learningProgress.priority} + 20)`,
          confidenceScore: sql`LEAST(100, ${learningProgress.confidenceScore} + 10)`,
          updatedAt: new Date()
        })
        .where(eq(learningProgress.id, topicId));

      console.log(`${LOG_PREFIX} Accelerated topic #${topicId} (avg quality: ${avgQuality})`);
      return { accelerated: true, reason: `High quality content (${avgQuality}%) - boosted priority` };
    }

    return { accelerated: false, reason: `Quality ${avgQuality}% below threshold ${this.QUALITY_BOOST_THRESHOLD}%` };
  }

  private async calculateAverageQuality(userId: number, knowledgeIds: number[]): Promise<number> {
    if (knowledgeIds.length === 0) return 0;

    const knowledge = await db.select().from(knowledgeBase)
      .where(and(
        eq(knowledgeBase.userId, userId),
        inArray(knowledgeBase.id, knowledgeIds)
      ));

    if (knowledge.length === 0) return 0;

    const avgConfidence = knowledge.reduce((sum, k) => sum + (k.confidence || 50), 0) / knowledge.length;
    const avgImportance = knowledge.reduce((sum, k) => sum + (k.importance || 50), 0) / knowledge.length;

    return Math.round((avgConfidence + avgImportance) / 2);
  }

  private detectDomainFromTags(tags: string[]): string {
    const domains = ["sports", "trading", "sugu", "dev", "perso"];
    for (const domain of domains) {
      if (tags.includes(domain)) return domain;
    }
    return "autre";
  }

  /**
   * Feedback loop: Update brain knowledge based on prediction results
   * Called when a sports prediction result is recorded (win/loss)
   */
  async onPredictionResult(
    userId: number,
    result: {
      won: boolean;
      betType: string;
      sport: string;
      league: string;
      confidence: number;
      valueScore: number;
      homeTeam: string;
      awayTeam: string;
    }
  ): Promise<{ updated: number; created: number }> {
    const { won, betType, sport, league, confidence, valueScore } = result;
    const LOG = "[LearningOptimizer:Feedback]";
    
    let updated = 0;
    let created = 0;

    try {
      // 1. Find related sports knowledge entries to adjust
      const relatedKnowledge = await db.select().from(knowledgeBase)
        .where(and(
          eq(knowledgeBase.userId, userId),
          sql`${knowledgeBase.tags} @> ARRAY['sports']::text[]`
        ))
        .limit(50);

      // 2. Adjust confidence based on result
      const confidenceAdjustment = won ? 5 : -3;
      const usefulnessAdjustment = won ? (valueScore > 0 ? 8 : 4) : -4;

      // Find entries related to this league/sport/betType
      for (const knowledge of relatedKnowledge) {
        const tags = knowledge.tags || [];
        const content = (knowledge.content || "").toLowerCase();
        const title = (knowledge.title || "").toLowerCase();

        // Check relevance
        const leagueMatch = content.includes(league.toLowerCase()) || title.includes(league.toLowerCase());
        const sportMatch = tags.includes(sport.toLowerCase()) || content.includes(sport.toLowerCase());
        const betTypeMatch = content.includes(betType.toLowerCase());

        if (leagueMatch || (sportMatch && betTypeMatch)) {
          const newConfidence = Math.max(10, Math.min(100, (knowledge.confidence || 50) + confidenceAdjustment));
          const newImportance = Math.max(10, Math.min(100, (knowledge.importance || 50) + usefulnessAdjustment));

          await db.update(knowledgeBase)
            .set({
              confidence: newConfidence,
              importance: newImportance,
              lastAccessedAt: new Date(),
              updatedAt: new Date()
            })
            .where(eq(knowledgeBase.id, knowledge.id));

          updated++;
          console.log(`${LOG} Updated #${knowledge.id}: confidence ${knowledge.confidence}→${newConfidence}, importance ${knowledge.importance}→${newImportance} (${won ? 'WIN' : 'LOSS'})`);
        }
      }

      // 3. If this is a significant pattern (high confidence prediction), create new knowledge
      if (confidence >= 70) {
        const patternType = won ? "structural" : "situational";
        const patternTitle = won
          ? `[Pattern Gagnant] ${betType} sur ${league}`
          : `[Pattern Perdant] ${betType} sur ${league} - à éviter`;

        const patternContent = won
          ? `Pari ${betType} gagnant sur ${result.homeTeam} vs ${result.awayTeam} (${league}). Confiance prédiction: ${confidence}%, Value: ${valueScore}. Ce type de pari montre des résultats positifs sur cette ligue.`
          : `Pari ${betType} perdu sur ${result.homeTeam} vs ${result.awayTeam} (${league}). Confiance prédiction: ${confidence}%, Value: ${valueScore}. Attention aux paris similaires sur cette ligue.`;

        // Check if similar pattern already exists
        const existingPattern = await db.select().from(knowledgeBase)
          .where(and(
            eq(knowledgeBase.userId, userId),
            sql`${knowledgeBase.tags} @> ARRAY['sports', 'pattern', ${patternType}]::text[]`,
            sql`${knowledgeBase.title} ILIKE ${'%' + betType + '%'} AND ${knowledgeBase.title} ILIKE ${'%' + league + '%'}`
          ))
          .limit(1);

        if (existingPattern.length === 0) {
          await brainService.addKnowledge(userId, {
            title: patternTitle,
            content: patternContent,
            type: "pattern",
            category: "sports-betting",
            tags: ["sports", "pattern", patternType, sport.toLowerCase(), league.toLowerCase(), betType.toLowerCase(), won ? "winning" : "losing"],
            source: "prediction-feedback",
            sourceType: "autonomous_learning",
            importance: won ? 75 : 60,
            confidence: won ? 70 : 55
          });
          created++;
          console.log(`${LOG} Created new ${patternType} pattern for ${betType} on ${league}`);
        } else {
          // Reinforce existing pattern
          const pattern = existingPattern[0];
          const boost = won ? 5 : -5;
          await db.update(knowledgeBase)
            .set({
              confidence: Math.max(10, Math.min(100, (pattern.confidence || 50) + boost)),
              importance: Math.max(10, Math.min(100, (pattern.importance || 50) + boost)),
              accessCount: sql`COALESCE(${knowledgeBase.accessCount}, 0) + 1`,
              lastAccessedAt: new Date(),
              updatedAt: new Date()
            })
            .where(eq(knowledgeBase.id, pattern.id));
          updated++;
          console.log(`${LOG} Reinforced pattern #${pattern.id} (${won ? '+' : ''}${boost})`);
        }
      }

      console.log(`${LOG} Prediction feedback complete: ${updated} updated, ${created} created (${won ? 'WIN' : 'LOSS'} ${betType})`);
      return { updated, created };

    } catch (error: any) {
      console.error(`${LOG} Error processing prediction feedback:`, error.message);
      return { updated: 0, created: 0 };
    }
  }

  /**
   * Bulk update knowledge usefulness based on multiple prediction results
   * Called by the daily learning job
   */
  async processPredictionBatch(userId: number, days: number = 7): Promise<{
    wins: number;
    losses: number;
    patternsCreated: number;
    knowledgeUpdated: number;
  }> {
    const LOG = "[LearningOptimizer:Batch]";
    console.log(`${LOG} Processing ${days}-day prediction batch for user ${userId}`);

    const { sportsPredictionSnapshots } = await import("@shared/schema");
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get settled predictions
    const predictions = await db.select()
      .from(sportsPredictionSnapshots)
      .where(and(
        sql`${sportsPredictionSnapshots.actualResult} IS NOT NULL`,
        gte(sportsPredictionSnapshots.updatedAt, startDate)
      ))
      .orderBy(desc(sportsPredictionSnapshots.updatedAt))
      .limit(100);

    let wins = 0;
    let losses = 0;
    let patternsCreated = 0;
    let knowledgeUpdated = 0;

    for (const pred of predictions) {
      const performance = pred.predictionPerformance as any;
      const recommendations = pred.recommendations as any;

      if (!performance || !recommendations) continue;

      const won = performance.mainBetWon === true;
      if (won) wins++;
      else losses++;

      const result = await this.onPredictionResult(userId, {
        won,
        betType: recommendations.bestBet || "unknown",
        sport: pred.sport,
        league: pred.league,
        confidence: recommendations.confidence || 50,
        valueScore: recommendations.valueScore || 0,
        homeTeam: pred.homeTeam,
        awayTeam: pred.awayTeam
      });

      patternsCreated += result.created;
      knowledgeUpdated += result.updated;
    }

    console.log(`${LOG} Batch complete: ${wins} wins, ${losses} losses, ${patternsCreated} patterns, ${knowledgeUpdated} knowledge updates`);
    return { wins, losses, patternsCreated, knowledgeUpdated };
  }
}

export const learningOptimizerService = new LearningOptimizerService();
