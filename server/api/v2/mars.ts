import { Router, Request, Response } from "express";
import { searchWithMARS, getMARSMetrics, getMarsHistory, getMarsSearchById, MARSSearchResult } from "../../services/marsService";

const router = Router();

export interface MARSResultsForFrontend {
  query: string;
  sources: {
    title: string;
    url: string;
    snippet: string;
    domain: string;
    reliability?: number;
    publishedDate?: string;
  }[];
  facts: {
    content: string;
    type: "statistic" | "date" | "name" | "event" | "claim" | "definition";
    confidence: "verified" | "probable" | "unverified" | "disputed";
    sources: string[];
  }[];
  summary: string;
  overallConfidence: number;
  warnings?: string[];
  searchTime?: number;
}

function transformMARSResults(result: MARSSearchResult): MARSResultsForFrontend {
  const sources = (result.orchestratorResponse?.results || []).map((r) => {
    const reliabilityScore = result.reliabilityScores?.find(
      rs => rs.url === r.url
    );
    
    let domain = "";
    try {
      domain = new URL(r.url).hostname.replace("www.", "");
    } catch {
      domain = r.url.substring(0, 30);
    }
    
    return {
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      domain,
      reliability: reliabilityScore?.total,
      publishedDate: r.date
    };
  });

  const facts = (result.factAggregation?.facts || []).map(f => ({
    content: f.content,
    type: f.type,
    confidence: f.confidence,
    sources: f.sources
  }));

  const warnings: string[] = [];
  if (result.policyDecision?.warnings) {
    warnings.push(...result.policyDecision.warnings);
  }
  if (result.policyDecision?.disclaimers) {
    warnings.push(...result.policyDecision.disclaimers);
  }

  return {
    query: result.query,
    sources,
    facts,
    summary: result.factAggregation?.summary || "",
    overallConfidence: result.factAggregation?.overallConfidence || 0,
    warnings: warnings.length > 0 ? warnings : undefined,
    searchTime: result.totalTime
  };
}

router.post("/search", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { query } = req.body;
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Query is required" });
    }

    console.log(`[MARS API] Search request: "${query}" by user ${userId}`);
    
    const result = await searchWithMARS(userId, query);
    
    if (!result.success) {
      return res.status(500).json({ 
        error: result.error || "Search failed",
        partial: transformMARSResults(result)
      });
    }

    const formatted = transformMARSResults(result);
    
    res.json({
      success: true,
      results: formatted,
      raw: {
        queryType: result.queryType,
        policyDecision: result.policyDecision
      }
    });
  } catch (error) {
    console.error("[MARS API] Error:", error);
    res.status(500).json({ error: "Search failed" });
  }
});

router.get("/metrics", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const daysBack = parseInt(req.query.days as string) || 30;
    const metrics = await getMARSMetrics(userId, daysBack);
    
    res.json(metrics);
  } catch (error) {
    console.error("[MARS API] Metrics error:", error);
    res.status(500).json({ error: "Failed to get metrics" });
  }
});

// Get MARS search history (consultable by Ulysse)
router.get("/history", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const limit = parseInt(req.query.limit as string) || 50;
    const queryFilter = req.query.q as string | undefined;
    const minConfidence = req.query.confidence as string | undefined;
    
    const result = await getMarsHistory(userId, { limit, queryFilter, minConfidence });
    
    res.json({
      success: true,
      history: result.searches.map(s => ({
        id: s.id,
        query: s.query,
        queryType: s.queryType,
        confidenceLevel: s.confidenceLevel,
        sourceCount: s.sourceCount,
        verifiedFactCount: s.verifiedFactCount,
        topSources: s.topSources,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt
      })),
      total: result.total
    });
  } catch (error) {
    console.error("[MARS API] History error:", error);
    res.status(500).json({ error: "Failed to get history" });
  }
});

// Get specific MARS search with full details (for Ulysse to re-read crawled content)
router.get("/history/:id", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const searchId = parseInt(req.params.id);
    if (isNaN(searchId)) {
      return res.status(400).json({ error: "Invalid search ID" });
    }
    
    const search = await getMarsSearchById(userId, searchId);
    
    if (!search) {
      return res.status(404).json({ error: "Search not found" });
    }
    
    res.json({
      success: true,
      search: {
        id: search.id,
        query: search.query,
        queryType: search.queryType,
        confidenceLevel: search.confidenceLevel,
        sourceCount: search.sourceCount,
        verifiedFactCount: search.verifiedFactCount,
        directAnswers: search.directAnswers,
        verifiedFacts: search.verifiedFacts,
        topSources: search.topSources,
        crawledContent: search.crawledContent,
        createdAt: search.createdAt,
        expiresAt: search.expiresAt
      }
    });
  } catch (error) {
    console.error("[MARS API] History detail error:", error);
    res.status(500).json({ error: "Failed to get search details" });
  }
});

export default router;
