import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import { autonomousLearningServiceV2 } from "../services/autonomousLearningV2";
import { db } from "../db";
import { learningProgress, knowledgeBase } from "@shared/schema";
import { eq, desc, sql, and, gte, lte } from "drizzle-orm";

const router = Router();

router.get("/stats", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non autorisé" });
    }

    const topics = await db.select().from(learningProgress)
      .where(eq(learningProgress.userId, userId));

    const domainStats: Record<string, { count: number; avgConfidence: number; avgUsefulness: number; totalPatterns: number }> = {};
    
    for (const topic of topics) {
      const domain = topic.domain || "autre";
      if (!domainStats[domain]) {
        domainStats[domain] = { count: 0, avgConfidence: 0, avgUsefulness: 0, totalPatterns: 0 };
      }
      domainStats[domain].count++;
      domainStats[domain].avgConfidence += (topic as any).confidenceScore || 50;
      domainStats[domain].avgUsefulness += topic.usefulnessScore || 50;
      if ((topic as any).patternType) domainStats[domain].totalPatterns++;
    }

    for (const domain of Object.keys(domainStats)) {
      if (domainStats[domain].count > 0) {
        domainStats[domain].avgConfidence = Math.round(domainStats[domain].avgConfidence / domainStats[domain].count);
        domainStats[domain].avgUsefulness = Math.round(domainStats[domain].avgUsefulness / domainStats[domain].count);
      }
    }

    const lowConfidenceTopics = topics.filter(t => ((t as any).confidenceScore || 50) < 30).length;
    const highPerformanceTopics = topics.filter(t => (t.usefulnessScore || 50) >= 80).length;
    const structuralPatterns = topics.filter(t => (t as any).patternType === "structural").length;
    const situationalPatterns = topics.filter(t => (t as any).patternType === "situational").length;

    const recentlyDecayed = topics.filter(t => {
      const lastAccess = (t as any).lastAccessedAt;
      if (!lastAccess) return false;
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      return new Date(lastAccess) < thirtyDaysAgo;
    }).length;

    res.json({
      totalTopics: topics.length,
      domainStats,
      patterns: {
        structural: structuralPatterns,
        situational: situationalPatterns
      },
      health: {
        lowConfidence: lowConfidenceTopics,
        highPerformance: highPerformanceTopics,
        recentlyDecayed
      },
      lastUpdate: new Date().toISOString()
    });
  } catch (error) {
    console.error("[LearningRoutes] Stats error:", error);
    res.status(500).json({ error: "Erreur lors de la récupération des stats" });
  }
});

router.get("/domains", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non autorisé" });
    }

    const topics = await db.select().from(learningProgress)
      .where(eq(learningProgress.userId, userId))
      .orderBy(desc(learningProgress.priority));

    const domains: Record<string, any[]> = {
      sports: [],
      trading: [],
      sugu: [],
      dev: [],
      perso: [],
      autre: []
    };

    for (const topic of topics) {
      const domain = topic.domain || "autre";
      if (domains[domain]) {
        domains[domain].push({
          id: topic.id,
          topic: topic.topic,
          priority: topic.priority,
          confidence: (topic as any).confidenceScore || 50,
          usefulness: topic.usefulnessScore || 50,
          patternType: (topic as any).patternType,
          volatility: (topic as any).volatilityFactor || 1.0,
          lastAccessed: (topic as any).lastAccessedAt,
          sourcePredictions: ((topic as any).sourcePredictionIds || []).length
        });
      }
    }

    res.json({
      domains,
      summary: Object.fromEntries(
        Object.entries(domains).map(([k, v]) => [k, v.length])
      )
    });
  } catch (error) {
    console.error("[LearningRoutes] Domains error:", error);
    res.status(500).json({ error: "Erreur lors de la récupération des domaines" });
  }
});

router.post("/trigger", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non autorisé" });
    }

    const { eventType, context, domain } = req.body;

    if (eventType === "manual") {
      const result = await autonomousLearningServiceV2.runLearningCycle(userId, domain);
      return res.json({ 
        success: true, 
        message: "Cycle d'apprentissage manuel terminé",
        result 
      });
    }

    if (["prediction_added", "homework_hot", "pattern_detected"].includes(eventType)) {
      await autonomousLearningServiceV2.triggerEventBasedLearning(userId, eventType, context);
      return res.json({ 
        success: true, 
        message: `Trigger ${eventType} exécuté` 
      });
    }

    res.status(400).json({ error: "Type d'événement invalide" });
  } catch (error) {
    console.error("[LearningRoutes] Trigger error:", error);
    res.status(500).json({ error: "Erreur lors du déclenchement" });
  }
});

router.post("/decay", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non autorisé" });
    }

    const result = await autonomousLearningServiceV2.applyConfidenceDecay(userId);
    res.json({ 
      success: true, 
      decayed: result.decayed,
      message: `${result.decayed} topics ont subi un decay de confiance` 
    });
  } catch (error) {
    console.error("[LearningRoutes] Decay error:", error);
    res.status(500).json({ error: "Erreur lors du decay" });
  }
});

router.get("/export", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non autorisé" });
    }

    const topics = await db.select().from(learningProgress)
      .where(eq(learningProgress.userId, userId));

    const knowledge = await db.select().from(knowledgeBase)
      .where(eq(knowledgeBase.userId, userId));

    const exportData = {
      version: "3.0",
      exportedAt: new Date().toISOString(),
      userId,
      topics: topics.map(t => ({
        topic: t.topic,
        domain: t.domain,
        category: t.category,
        priority: t.priority,
        recencyScore: t.recencyScore,
        frequencyScore: t.frequencyScore,
        usefulnessScore: t.usefulnessScore,
        confidenceScore: (t as any).confidenceScore,
        patternType: (t as any).patternType,
        volatilityFactor: (t as any).volatilityFactor,
        maxDepth: t.maxDepth,
        extractedFrom: t.extractedFrom,
        triggerType: (t as any).triggerType,
        sourcePredictionIds: (t as any).sourcePredictionIds,
        layer1KnowledgeIds: (t as any).layer1KnowledgeIds,
        layer2KnowledgeIds: (t as any).layer2KnowledgeIds,
        layer4InsightIds: (t as any).layer4InsightIds,
        relatedKnowledgeIds: t.relatedKnowledgeIds
      })),
      knowledge: knowledge.map(k => ({
        key: k.key,
        value: k.value,
        category: k.category,
        source: k.source,
        confidence: k.confidence,
        importance: k.importance,
        verified: (k as any).verified,
        tags: k.tags,
        metadata: k.metadata
      }))
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename=brain-export-${userId}-${Date.now()}.json`);
    res.json(exportData);
  } catch (error) {
    console.error("[LearningRoutes] Export error:", error);
    res.status(500).json({ error: "Erreur lors de l'export" });
  }
});

router.post("/import", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non autorisé" });
    }

    const { data, merge } = req.body;
    
    if (!data || !data.version || !data.topics) {
      return res.status(400).json({ error: "Format d'import invalide" });
    }

    let imported = 0;
    let skipped = 0;

    for (const topic of data.topics) {
      const hash = require("crypto").createHash("md5")
        .update(topic.topic.toLowerCase().trim().replace(/\s+/g, " "))
        .digest("hex").slice(0, 16);

      const existing = await db.select().from(learningProgress)
        .where(and(
          eq(learningProgress.userId, userId),
          eq(learningProgress.topicHash, hash)
        ));

      if (existing.length > 0) {
        if (merge) {
          await db.update(learningProgress)
            .set({
              priority: Math.max(existing[0].priority || 0, topic.priority || 0),
              usefulnessScore: Math.max(existing[0].usefulnessScore || 0, topic.usefulnessScore || 0),
              updatedAt: new Date()
            })
            .where(eq(learningProgress.id, existing[0].id));
          imported++;
        } else {
          skipped++;
        }
      } else {
        await db.insert(learningProgress).values({
          userId,
          topic: topic.topic,
          topicHash: hash,
          domain: topic.domain || "autre",
          category: topic.category || "learning",
          priority: topic.priority || 50,
          recencyScore: 50,
          frequencyScore: topic.frequencyScore || 20,
          usefulnessScore: topic.usefulnessScore || 50,
          confidenceScore: topic.confidenceScore || 50,
          patternType: topic.patternType,
          volatilityFactor: topic.volatilityFactor || 1.0,
          maxDepth: topic.maxDepth || 3,
          extractedFrom: "import",
          triggerType: "manual"
        });
        imported++;
      }
    }

    res.json({
      success: true,
      imported,
      skipped,
      message: `Import terminé: ${imported} topics importés, ${skipped} ignorés`
    });
  } catch (error) {
    console.error("[LearningRoutes] Import error:", error);
    res.status(500).json({ error: "Erreur lors de l'import" });
  }
});

router.get("/alerts", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non autorisé" });
    }

    const topics = await db.select().from(learningProgress)
      .where(eq(learningProgress.userId, userId));

    const alerts: any[] = [];

    const lowConfidence = topics.filter(t => ((t as any).confidenceScore || 50) < 30);
    for (const topic of lowConfidence) {
      alerts.push({
        type: "low_confidence",
        severity: "warning",
        topic: topic.topic,
        domain: topic.domain,
        confidence: (topic as any).confidenceScore,
        message: `Le topic "${topic.topic}" a une confiance très basse (${(topic as any).confidenceScore}%)`
      });
    }

    const l5Insights = topics.filter(t => (t as any).layer4InsightIds?.length >= 2);
    for (const insight of l5Insights.slice(0, 5)) {
      alerts.push({
        type: "cross_domain_insight",
        severity: "info",
        topic: insight.topic,
        domains: (insight as any).layer4InsightIds?.length || 0,
        message: `Insight cross-domain détecté: "${insight.topic}"`
      });
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const staleTopics = topics.filter(t => {
      const lastAccess = (t as any).lastAccessedAt;
      return lastAccess && new Date(lastAccess) < thirtyDaysAgo;
    });

    if (staleTopics.length > 10) {
      alerts.push({
        type: "stale_knowledge",
        severity: "info",
        count: staleTopics.length,
        message: `${staleTopics.length} topics n'ont pas été accédés depuis 30+ jours`
      });
    }

    res.json({
      alerts,
      summary: {
        total: alerts.length,
        warnings: alerts.filter(a => a.severity === "warning").length,
        info: alerts.filter(a => a.severity === "info").length
      }
    });
  } catch (error) {
    console.error("[LearningRoutes] Alerts error:", error);
    res.status(500).json({ error: "Erreur lors de la récupération des alertes" });
  }
});

router.get("/metrics", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non autorisé" });
    }

    const topics = await db.select().from(learningProgress)
      .where(eq(learningProgress.userId, userId));

    const winningPatterns = topics.filter(t => 
      (t as any).patternType && t.usefulnessScore && t.usefulnessScore >= 70
    ).length;
    
    const losingPatterns = topics.filter(t => 
      (t as any).patternType && t.usefulnessScore && t.usefulnessScore < 40
    ).length;

    const avgConfidence = topics.length > 0
      ? Math.round(topics.reduce((sum, t) => sum + ((t as any).confidenceScore || 50), 0) / topics.length)
      : 50;

    const avgUsefulness = topics.length > 0
      ? Math.round(topics.reduce((sum, t) => sum + (t.usefulnessScore || 50), 0) / topics.length)
      : 50;

    const trackedPredictions = new Set<number>();
    for (const topic of topics) {
      const predIds = (topic as any).sourcePredictionIds || [];
      predIds.forEach((id: number) => trackedPredictions.add(id));
    }

    res.json({
      learning_topics_total: topics.length,
      learning_patterns_winning: winningPatterns,
      learning_patterns_losing: losingPatterns,
      learning_confidence_avg: avgConfidence,
      learning_usefulness_avg: avgUsefulness,
      learning_predictions_tracked: trackedPredictions.size,
      learning_domains: {
        sports: topics.filter(t => t.domain === "sports").length,
        trading: topics.filter(t => t.domain === "trading").length,
        sugu: topics.filter(t => t.domain === "sugu").length,
        dev: topics.filter(t => t.domain === "dev").length,
        perso: topics.filter(t => t.domain === "perso").length,
        autre: topics.filter(t => t.domain === "autre").length
      }
    });
  } catch (error) {
    console.error("[LearningRoutes] Metrics error:", error);
    res.status(500).json({ error: "Erreur lors de la récupération des métriques" });
  }
});

router.get("/top-patterns", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non autorisé" });
    }

    const domain = req.query.domain as string;
    const limit = parseInt(req.query.limit as string) || 10;

    let query = db.select().from(learningProgress)
      .where(eq(learningProgress.userId, userId));

    const topics = await query
      .orderBy(desc(learningProgress.usefulnessScore))
      .limit(50);

    let filtered = topics.filter(t => (t as any).patternType);
    
    if (domain && domain !== "all") {
      filtered = filtered.filter(t => t.domain === domain);
    }

    const topPatterns = filtered.slice(0, limit).map(t => ({
      id: t.id,
      topic: t.topic,
      domain: t.domain,
      patternType: (t as any).patternType,
      usefulness: t.usefulnessScore,
      confidence: (t as any).confidenceScore,
      trackedPredictions: ((t as any).sourcePredictionIds || []).length
    }));

    res.json({
      patterns: topPatterns,
      total: filtered.length
    });
  } catch (error) {
    console.error("[LearningRoutes] Top patterns error:", error);
    res.status(500).json({ error: "Erreur lors de la récupération des patterns" });
  }
});

export default router;
