import express from "express";

const router = express.Router();

router.get("/crawl/browser", async (req, res) => {
  try {
    const url = req.query.url as string;
    if (!url) {
      return res.status(400).json({ success: false, error: "URL required" });
    }

    const { crawlWithBrowser, getBrowserPoolStats } = await import("../services/browserCrawler");
    
    const waitForSelector = req.query.waitForSelector as string | undefined;
    const timeoutMs = parseInt(req.query.timeout as string) || 20000;
    
    const result = await crawlWithBrowser(url, {
      waitForSelector,
      timeoutMs,
      blockAssets: true,
      extractText: true
    });
    
    res.json({
      ...result,
      poolStats: getBrowserPoolStats()
    });
  } catch (err: any) {
    console.error("Browser crawl error:", err);
    res.status(500).json({ 
      success: false, 
      error: err.message || "Browser crawl failed",
      errorType: "unknown"
    });
  }
});

router.get("/crawl/browser/stats", async (req, res) => {
  try {
    const { getBrowserPoolStats } = await import("../services/browserCrawler");
    res.json(getBrowserPoolStats());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/pronosoft/ldc", async (req, res) => {
  try {
    console.log(`[PRONOSOFT-API] Fetching Champions League odds from Pronosoft...`);
    
    const { fetchDynamicPage } = await import("../services/dynamicPageService");
    
    const url = "https://www.pronosoft.com/fr/parions_sport/liste-parions-sport-plein-ecran.htm";
    
    const result = await fetchDynamicPage({
      url,
      mode: "auto",
      timeout: 45000,
      forceRefresh: true,
      project: "pronosoft-ldc"
    });
    
    if (!result.success) {
      console.log(`[PRONOSOFT-API] ❌ Fetch failed: ${result.error}`);
      return res.status(500).json({ 
        success: false, 
        error: result.error || "Failed to fetch Pronosoft page",
        method: result.method
      });
    }
    
    let matches: any[] = [];
    
    console.log(`[PRONOSOFT-API] Result method: ${result.method}, has data: ${!!result.data}, data type: ${typeof result.data}`);
    
    if (result.data && typeof result.data === 'object') {
      const data = result.data as any;
      console.log(`[PRONOSOFT-API] Data keys: ${Object.keys(data).join(', ')}`);
      console.log(`[PRONOSOFT-API] Debug info: ${JSON.stringify(data.debug || {})}`);
      if (data.matches && Array.isArray(data.matches)) {
        matches = data.matches;
        console.log(`[PRONOSOFT-API] Extracted ${matches.length} matches from data.matches`);
      }
      if (data.rawText) {
        console.log(`[PRONOSOFT-API] rawText available: ${data.rawText.length} chars`);
      }
    }
    
    let normalized = matches.map((m: any) => ({
      teams: m.teams || 'Unknown',
      odd1: typeof m.odd1 === 'number' ? m.odd1 : null,
      oddN: typeof m.oddN === 'number' ? m.oddN : null,
      odd2: typeof m.odd2 === 'number' ? m.odd2 : null
    })).filter((m: any) => m.teams && m.teams !== 'Unknown' && (m.odd1 || m.oddN || m.odd2));
    
    const extractorData = result.data as any;
    const rawTextFromExtractor = extractorData?.rawText || '';
    const textContent = rawTextFromExtractor || result.content || '';
    
    console.log(`[PRONOSOFT-API] DOM extraction found ${normalized.length} matches, content length: ${textContent.length}`);
    
    if (normalized.length === 0 && textContent.length > 100) {
      console.log(`[PRONOSOFT-API] Trying text parsing on ${textContent.length} chars...`);
      
      const content = textContent;
      const seen = new Set<string>();
      
      const lines = content.split('\n');
      console.log(`[PRONOSOFT-API] Processing ${lines.length} lines...`);
      
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();
        
        if (line.length < 5 || line.length > 50) continue;
        
        const teamMatch = line.match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]+)\s*[-–]\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]+)$/);
        
        if (teamMatch && !line.includes('/') && !line.includes('.') && !line.includes('(')) {
          const team1 = teamMatch[1].trim();
          const team2 = teamMatch[2].trim();
          
          if (team1.length < 3 || team2.length < 3) continue;
          
          const nextLine = lines[i + 1] || '';
          
          const oddsMatch = nextLine.match(/(\d{1,3})\t(\d+[,\.]\d+)\t(\d+[,\.]\d+)\t(\d+[,\.]\d+)/);
          
          if (oddsMatch) {
            const odd1 = parseFloat(oddsMatch[2].replace(',', '.'));
            const oddN = parseFloat(oddsMatch[3].replace(',', '.'));
            const odd2 = parseFloat(oddsMatch[4].replace(',', '.'));
            
            if (oddN > 0.5 && odd1 >= 1.01 && odd1 <= 50 && odd2 >= 1.01 && odd2 <= 50) {
              const key = `${team1.toLowerCase()}-${team2.toLowerCase()}`;
              if (!seen.has(key)) {
                seen.add(key);
                normalized.push({
                  teams: `${team1} - ${team2}`,
                  odd1,
                  oddN,
                  odd2
                });
                console.log(`[PRONOSOFT-API] Found match: ${team1} - ${team2} (${odd1}/${oddN}/${odd2})`);
              }
            }
          }
        }
      }
      
      console.log(`[PRONOSOFT-API] Text parsing found ${normalized.length} football matches`);
    }
    
    if (normalized.length === 0) {
      console.log(`[PRONOSOFT-API] Text parsing empty, trying Vision AI fallback...`);
      const { crawlWithScreenshot } = await import("../services/screenshotCrawler");
      const visionResult = await crawlWithScreenshot(url, 
        `IMPORTANT: You MUST respond with ONLY a JSON array, no other text.
Extract ALL football/soccer betting matches visible on this page.
For each match, extract:
- teams: "Team A - Team B" format
- odd1: home win odds (number)
- oddN: draw odds (number) 
- odd2: away win odds (number)

If you see a table with matches and odds columns, extract all rows.
Response format (JSON only, no explanations):
[{"teams":"PSG - Bayern Munich","odd1":2.10,"oddN":3.50,"odd2":3.20}]

If no football matches are visible, return: []`
      );
      
      if (visionResult.success && visionResult.analysis) {
        try {
          const jsonMatch = visionResult.analysis.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (Array.isArray(parsed)) {
              normalized = parsed.filter((m: any) => m.teams);
              console.log(`[PRONOSOFT-API] ✅ Vision AI extracted ${normalized.length} matches`);
            }
          }
        } catch (parseErr) {
          console.log(`[PRONOSOFT-API] Vision JSON parse failed, returning raw analysis`);
        }
        
        if (normalized.length === 0) {
          return res.json({
            success: true,
            count: 0,
            matches: [],
            visionAnalysis: visionResult.analysis,
            source: "pronosoft.com",
            method: "vision_ai",
            loadTimeMs: result.meta?.loadTimeMs
          });
        }
      }
    }
    
    console.log(`[PRONOSOFT-API] ✅ Extracted ${normalized.length} matches from Pronosoft`);
    
    res.json({
      success: true,
      count: normalized.length,
      matches: normalized,
      rawContentPreview: result.content?.substring(0, 1000),
      source: "pronosoft.com",
      method: normalized.length > 0 ? result.method : "vision_fallback",
      loadTimeMs: result.meta?.loadTimeMs,
      debug: result.data && (result.data as any).debug ? (result.data as any).debug : undefined
    });
    
  } catch (err: any) {
    console.error(`[PRONOSOFT-API] Error:`, err);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

router.get("/pronosoft/debug", async (req, res) => {
  try {
    const { fetchDynamicPage } = await import("../services/dynamicPageService");
    const url = "https://www.pronosoft.com/fr/parions_sport/liste-parions-sport-plein-ecran.htm";
    
    const result = await fetchDynamicPage({
      url,
      mode: "text",
      timeout: 45000,
      forceRefresh: true,
      project: "pronosoft-debug"
    });
    
    res.json({
      success: result.success,
      contentLength: result.content?.length || 0,
      contentPreview: result.content?.substring(0, 5000),
      method: result.method
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/parionssport/extract", async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: "URL parameter required" });
    }
    
    console.log(`[PARIONSSPORT-API] Extracting from: ${url}`);
    
    const { fetchDynamicPage } = await import("../services/dynamicPageService");
    
    const result = await fetchDynamicPage({
      url,
      mode: "dom",
      timeout: 60000,
      forceRefresh: true,
      project: "parionssport-extract"
    });
    
    if (!result.success) {
      console.log(`[PARIONSSPORT-API] ❌ Fetch failed: ${result.error}`);
      
      console.log(`[PARIONSSPORT-API] Trying Vision AI fallback...`);
      const { analyzeWebsiteViaScreenshot } = await import("../services/screenshotCrawler");
      const visionResult = await analyzeWebsiteViaScreenshot(url, "Extract all betting matches with teams and odds (1 N 2 format). Return as JSON.");
      
      if (visionResult.success && visionResult.analysis) {
        return res.json({
          success: true,
          content: visionResult.analysis,
          method: "vision_ai",
          screenshotSize: visionResult.screenshotSize
        });
      }
      
      return res.status(500).json({ 
        success: false, 
        error: result.error || "Failed to fetch page"
      });
    }
    
    let matches: any[] = [];
    
    if (result.data && typeof result.data === 'object') {
      const data = result.data as any;
      if (data.matches && Array.isArray(data.matches)) {
        matches = data.matches;
      }
    }
    
    const normalized = matches.map((m: any) => ({
      homeTeam: m.homeTeam || 'Unknown',
      awayTeam: m.awayTeam || 'Unknown',
      odd1: m.odds1 || m.odd1 || null,
      oddN: m.oddsN || m.oddN || null,
      odd2: m.odds2 || m.odd2 || null
    })).filter((m: any) => (m.homeTeam !== 'Unknown' || m.awayTeam !== 'Unknown') && (m.odd1 || m.oddN || m.odd2));
    
    console.log(`[PARIONSSPORT-API] ✅ Extracted ${normalized.length} matches`);
    
    res.json({
      success: true,
      count: normalized.length,
      matches: normalized,
      method: result.method,
      loadTimeMs: result.meta?.loadTimeMs,
      debug: result.data && (result.data as any).debug ? (result.data as any).debug : undefined,
      rawContent: result.content?.substring(0, 2000)
    });
    
  } catch (err: any) {
    console.error(`[PARIONSSPORT-API] Error:`, err);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

export default router;
