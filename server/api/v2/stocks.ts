/**
 * Stock Market API Routes
 * Endpoints for quotes, watchlists, portfolio, alerts, and market data
 */

import { Router, Request, Response } from "express";
import { db } from "../../db";
import { stockWatchlists, stockPortfolio, stockAlerts, stockQuoteCache } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { stockMarketService } from "../../services/stockMarketService";
import { emitStocksUpdated } from "../../services/realtimeSync";

const router = Router();

// ============ QUOTES ============

router.get("/quote/:symbol", async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const quote = await stockMarketService.getQuote(symbol);
    if (!quote) {
      return res.status(404).json({ error: "Symbol not found or no data available" });
    }
    res.json(quote);
  } catch (error) {
    console.error("[Stocks API] Quote error:", error);
    res.status(500).json({ error: "Failed to fetch quote" });
  }
});

router.post("/quotes", async (req: Request, res: Response) => {
  try {
    const { symbols } = req.body;
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ error: "symbols array required" });
    }
    const quotes = await stockMarketService.getMultipleQuotes(symbols.slice(0, 20));
    res.json(quotes);
  } catch (error) {
    console.error("[Stocks API] Multiple quotes error:", error);
    res.status(500).json({ error: "Failed to fetch quotes" });
  }
});

// ============ MARKET OVERVIEW ============

router.get("/market", async (_req: Request, res: Response) => {
  try {
    const overview = await stockMarketService.getMarketOverview();
    res.json(overview);
  } catch (error) {
    console.error("[Stocks API] Market overview error:", error);
    res.status(500).json({ error: "Failed to fetch market overview" });
  }
});

// ============ COMPANY PROFILE ============

router.get("/profile/:symbol", async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const profile = await stockMarketService.getCompanyProfile(symbol);
    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }
    res.json(profile);
  } catch (error) {
    console.error("[Stocks API] Profile error:", error);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// ============ HISTORICAL DATA ============

router.get("/history/:symbol", async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const interval = (req.query.interval as string) || "1day";
    const outputSize = parseInt(req.query.size as string) || 100;
    
    const validIntervals = ["1min", "5min", "15min", "1h", "1day", "1week", "1month"];
    if (!validIntervals.includes(interval)) {
      return res.status(400).json({ error: "Invalid interval" });
    }
    
    const data = await stockMarketService.getHistoricalData(
      symbol,
      interval as any,
      Math.min(outputSize, 500)
    );
    res.json(data);
  } catch (error) {
    console.error("[Stocks API] Historical data error:", error);
    res.status(500).json({ error: "Failed to fetch historical data" });
  }
});

// ============ NEWS ============

router.get("/news", async (req: Request, res: Response) => {
  try {
    const symbol = req.query.symbol as string | undefined;
    const limit = parseInt(req.query.limit as string) || 10;
    const news = await stockMarketService.getNews(symbol, Math.min(limit, 50));
    res.json(news);
  } catch (error) {
    console.error("[Stocks API] News error:", error);
    res.status(500).json({ error: "Failed to fetch news" });
  }
});

// ============ TECHNICAL INDICATORS ============

router.get("/indicators/:symbol", async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const indicators = await stockMarketService.getTechnicalIndicators(symbol);
    res.json(indicators);
  } catch (error) {
    console.error("[Stocks API] Indicators error:", error);
    res.status(500).json({ error: "Failed to fetch indicators" });
  }
});

// ============ ANALYST RECOMMENDATIONS ============

router.get("/recommendations/:symbol", async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const recommendations = await stockMarketService.getRecommendations(symbol);
    if (!recommendations) {
      return res.status(404).json({ error: "No recommendations found" });
    }
    res.json(recommendations);
  } catch (error) {
    console.error("[Stocks API] Recommendations error:", error);
    res.status(500).json({ error: "Failed to fetch recommendations" });
  }
});

// ============ EARNINGS CALENDAR ============

router.get("/earnings", async (req: Request, res: Response) => {
  try {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const earnings = await stockMarketService.getEarningsCalendar(from, to);
    res.json(earnings);
  } catch (error) {
    console.error("[Stocks API] Earnings error:", error);
    res.status(500).json({ error: "Failed to fetch earnings" });
  }
});

// ============ SEARCH ============

router.get("/search", async (req: Request, res: Response) => {
  try {
    const query = req.query.q as string;
    if (!query || query.length < 1) {
      return res.status(400).json({ error: "Query parameter 'q' required" });
    }
    const results = await stockMarketService.searchSymbol(query);
    res.json(results);
  } catch (error) {
    console.error("[Stocks API] Search error:", error);
    res.status(500).json({ error: "Failed to search" });
  }
});

// ============ FOREX ============

router.get("/forex/:from/:to", async (req: Request, res: Response) => {
  try {
    const { from, to } = req.params;
    const rate = await stockMarketService.getForexRate(from, to);
    if (!rate) {
      return res.status(404).json({ error: "Forex rate not found" });
    }
    res.json(rate);
  } catch (error) {
    console.error("[Stocks API] Forex error:", error);
    res.status(500).json({ error: "Failed to fetch forex rate" });
  }
});

// ============ CRYPTO ============

router.get("/crypto/:symbol", async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const price = await stockMarketService.getCryptoPrice(symbol);
    if (!price) {
      return res.status(404).json({ error: "Crypto price not found" });
    }
    res.json(price);
  } catch (error) {
    console.error("[Stocks API] Crypto error:", error);
    res.status(500).json({ error: "Failed to fetch crypto price" });
  }
});

// ============ SERVICE STATUS ============

router.get("/status", async (_req: Request, res: Response) => {
  try {
    const status = stockMarketService.getStatus();
    res.json(status);
  } catch (error) {
    console.error("[Stocks API] Status error:", error);
    res.status(500).json({ error: "Failed to get status" });
  }
});

// ============ WATCHLISTS (requires auth) ============

router.get("/watchlists", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || 1;
    const watchlists = await db.select().from(stockWatchlists)
      .where(eq(stockWatchlists.userId, userId))
      .orderBy(desc(stockWatchlists.createdAt));
    res.json(watchlists);
  } catch (error) {
    console.error("[Stocks API] Watchlists error:", error);
    res.status(500).json({ error: "Failed to fetch watchlists" });
  }
});

router.post("/watchlists", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || 1;
    const { name, symbols } = req.body;
    
    const [watchlist] = await db.insert(stockWatchlists).values({
      userId,
      name: name || "Ma Watchlist",
      symbols: symbols || []
    }).returning();
    
    res.json(watchlist);
    emitStocksUpdated();
  } catch (error) {
    console.error("[Stocks API] Create watchlist error:", error);
    res.status(500).json({ error: "Failed to create watchlist" });
  }
});

router.put("/watchlists/:id", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || 1;
    const id = parseInt(req.params.id);
    const { name, symbols } = req.body;
    
    const [updated] = await db.update(stockWatchlists)
      .set({ 
        name, 
        symbols, 
        updatedAt: new Date() 
      })
      .where(and(eq(stockWatchlists.id, id), eq(stockWatchlists.userId, userId)))
      .returning();
    
    if (!updated) {
      return res.status(404).json({ error: "Watchlist not found" });
    }
    res.json(updated);
    emitStocksUpdated();
  } catch (error) {
    console.error("[Stocks API] Update watchlist error:", error);
    res.status(500).json({ error: "Failed to update watchlist" });
  }
});

router.delete("/watchlists/:id", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || 1;
    const id = parseInt(req.params.id);
    
    await db.delete(stockWatchlists)
      .where(and(eq(stockWatchlists.id, id), eq(stockWatchlists.userId, userId)));
    
    res.json({ success: true });
    emitStocksUpdated();
  } catch (error) {
    console.error("[Stocks API] Delete watchlist error:", error);
    res.status(500).json({ error: "Failed to delete watchlist" });
  }
});

// ============ PORTFOLIO ============

router.get("/portfolio", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || 1;
    const positions = await db.select().from(stockPortfolio)
      .where(eq(stockPortfolio.userId, userId))
      .orderBy(stockPortfolio.symbol);
    
    // Enrich with current prices
    const symbols = positions.map(p => p.symbol);
    const quotes = await stockMarketService.getMultipleQuotes(symbols);
    
    const enriched = positions.map(pos => {
      const quote = quotes.find(q => q.symbol === pos.symbol);
      const currentValue = quote ? quote.price * pos.shares : null;
      const costBasis = pos.avgCost * pos.shares;
      const gainLoss = currentValue ? currentValue - costBasis : null;
      const gainLossPercent = gainLoss && costBasis ? (gainLoss / costBasis) * 100 : null;
      
      return {
        ...pos,
        currentPrice: quote?.price || null,
        currentValue,
        costBasis,
        gainLoss,
        gainLossPercent
      };
    });
    
    res.json(enriched);
  } catch (error) {
    console.error("[Stocks API] Portfolio error:", error);
    res.status(500).json({ error: "Failed to fetch portfolio" });
  }
});

router.post("/portfolio", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || 1;
    const { symbol, shares, avgCost, currency, notes } = req.body;
    
    if (!symbol || !shares || !avgCost) {
      return res.status(400).json({ error: "symbol, shares, and avgCost required" });
    }
    
    const [position] = await db.insert(stockPortfolio).values({
      userId,
      symbol: symbol.toUpperCase(),
      shares,
      avgCost,
      currency: currency || "USD",
      notes
    }).returning();
    
    res.json(position);
    emitStocksUpdated();
  } catch (error) {
    console.error("[Stocks API] Add position error:", error);
    res.status(500).json({ error: "Failed to add position" });
  }
});

router.delete("/portfolio/:id", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || 1;
    const id = parseInt(req.params.id);
    
    await db.delete(stockPortfolio)
      .where(and(eq(stockPortfolio.id, id), eq(stockPortfolio.userId, userId)));
    
    res.json({ success: true });
    emitStocksUpdated();
  } catch (error) {
    console.error("[Stocks API] Delete position error:", error);
    res.status(500).json({ error: "Failed to delete position" });
  }
});

// ============ ALERTS ============

router.get("/alerts", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || 1;
    const alerts = await db.select().from(stockAlerts)
      .where(eq(stockAlerts.userId, userId))
      .orderBy(desc(stockAlerts.createdAt));
    res.json(alerts);
  } catch (error) {
    console.error("[Stocks API] Alerts error:", error);
    res.status(500).json({ error: "Failed to fetch alerts" });
  }
});

router.post("/alerts", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || 1;
    const { symbol, alertType, targetValue, notifyMethod } = req.body;
    
    if (!symbol || !alertType || !targetValue) {
      return res.status(400).json({ error: "symbol, alertType, and targetValue required" });
    }
    
    const validTypes = ["price_above", "price_below", "percent_change"];
    if (!validTypes.includes(alertType)) {
      return res.status(400).json({ error: "Invalid alertType" });
    }
    
    const [alert] = await db.insert(stockAlerts).values({
      userId,
      symbol: symbol.toUpperCase(),
      alertType,
      targetValue,
      notifyMethod: notifyMethod || "chat"
    }).returning();
    
    res.json(alert);
    emitStocksUpdated();
  } catch (error) {
    console.error("[Stocks API] Create alert error:", error);
    res.status(500).json({ error: "Failed to create alert" });
  }
});

router.delete("/alerts/:id", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || 1;
    const id = parseInt(req.params.id);
    
    await db.delete(stockAlerts)
      .where(and(eq(stockAlerts.id, id), eq(stockAlerts.userId, userId)));
    
    res.json({ success: true });
    emitStocksUpdated();
  } catch (error) {
    console.error("[Stocks API] Delete alert error:", error);
    res.status(500).json({ error: "Failed to delete alert" });
  }
});

export default router;
