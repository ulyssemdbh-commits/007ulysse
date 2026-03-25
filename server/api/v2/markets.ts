/**
 * Markets API V2 - Expert Trader Endpoints
 * 
 * Provides: /api/markets/analyze, /api/markets/daily-brief, /api/markets/scenarios
 */

import { Router, Request, Response } from 'express';
import { tradingAnalysisService, Horizon } from '../../services/tradingAnalysisService';
import { stockMarketService } from '../../services/stockMarketService';
import { tradingAlertsService } from '../../services/tradingAlertsService';

const router = Router();

/**
 * GET /api/markets/analyze
 * Full instrument analysis with technical, fundamentals, and synthesis
 * 
 * Query params:
 * - symbol: Stock symbol (required)
 * - horizon: 'court' | 'moyen' | 'long' (default: 'moyen')
 * - format: 'json' | 'chat' (default: 'json')
 */
router.get('/analyze', async (req: Request, res: Response) => {
  try {
    const { symbol, horizon = 'moyen', format = 'json' } = req.query;
    
    if (!symbol || typeof symbol !== 'string') {
      return res.status(400).json({ 
        error: 'Symbol is required',
        example: '/api/markets/analyze?symbol=AAPL&horizon=moyen'
      });
    }
    
    const validHorizons: Horizon[] = ['court', 'moyen', 'long'];
    const h: Horizon = validHorizons.includes(horizon as Horizon) ? (horizon as Horizon) : 'moyen';
    
    console.log(`[Markets API] Analyzing ${symbol} with horizon=${h}`);
    
    const analysis = await tradingAnalysisService.analyzeInstrument(symbol, h);
    
    if (!analysis) {
      return res.status(404).json({ 
        error: 'Unable to analyze this instrument',
        symbol: symbol.toUpperCase(),
        suggestion: 'Check if the symbol is valid (e.g., AAPL, MSFT, BTC)'
      });
    }
    
    if (format === 'chat') {
      return res.json({
        success: true,
        formatted: tradingAnalysisService.formatAnalysisForChat(analysis),
      });
    }
    
    res.json({
      success: true,
      analysis,
    });
  } catch (error) {
    console.error('[Markets API] Error in /analyze:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: (error as Error).message
    });
  }
});

/**
 * GET /api/markets/scenarios
 * Generate trading scenarios (prudent, neutre, agressif)
 * 
 * Query params:
 * - symbol: Stock symbol (required)
 * - profile: Profile ID (default: 'default')
 * - format: 'json' | 'chat' (default: 'json')
 */
router.get('/scenarios', async (req: Request, res: Response) => {
  try {
    const { symbol, profile = 'default', format = 'json' } = req.query;
    
    if (!symbol || typeof symbol !== 'string') {
      return res.status(400).json({ 
        error: 'Symbol is required',
        example: '/api/markets/scenarios?symbol=AAPL'
      });
    }
    
    console.log(`[Markets API] Generating scenarios for ${symbol}`);
    
    const scenarios = await tradingAnalysisService.generateScenarios(
      symbol, 
      typeof profile === 'string' ? profile : 'default'
    );
    
    if (scenarios.length === 0) {
      return res.status(404).json({ 
        error: 'Unable to generate scenarios for this instrument',
        symbol: symbol.toUpperCase()
      });
    }
    
    if (format === 'chat') {
      return res.json({
        success: true,
        formatted: tradingAnalysisService.formatScenariosForChat(scenarios, symbol),
      });
    }
    
    res.json({
      success: true,
      symbol: symbol.toUpperCase(),
      scenarios,
    });
  } catch (error) {
    console.error('[Markets API] Error in /scenarios:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: (error as Error).message
    });
  }
});

/**
 * GET /api/markets/daily-brief
 * Complete daily market overview
 * 
 * Query params:
 * - format: 'json' | 'chat' (default: 'json')
 */
router.get('/daily-brief', async (req: Request, res: Response) => {
  try {
    const { format = 'json' } = req.query;
    
    console.log('[Markets API] Generating daily brief');
    
    const brief = await tradingAnalysisService.getDailyBrief();
    
    if (format === 'chat') {
      return res.json({
        success: true,
        formatted: tradingAnalysisService.formatBriefForChat(brief),
      });
    }
    
    res.json({
      success: true,
      brief,
    });
  } catch (error) {
    console.error('[Markets API] Error in /daily-brief:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: (error as Error).message
    });
  }
});

/**
 * GET /api/markets/quote
 * Quick quote with natural language processing
 * 
 * Query params:
 * - q: Natural language query OR symbol
 */
router.get('/quote', async (req: Request, res: Response) => {
  try {
    const { q, symbol } = req.query;
    const query = (q || symbol) as string;
    
    if (!query) {
      return res.status(400).json({ 
        error: 'Query or symbol is required',
        examples: [
          "/api/markets/quote?q=cours de l'or",
          "/api/markets/quote?symbol=AAPL",
          "/api/markets/quote?q=prix bitcoin"
        ]
      });
    }
    
    // If it looks like a natural language query, use processNaturalQuery
    if (query.includes(' ') || query.length > 6) {
      const result = await stockMarketService.processNaturalQuery(query);
      return res.json({
        success: true,
        query,
        formatted: result,
      });
    }
    
    // Otherwise, get direct quote
    const quote = await stockMarketService.getQuote(query);
    
    if (!quote) {
      return res.status(404).json({ 
        error: 'Quote not found',
        symbol: query.toUpperCase()
      });
    }
    
    res.json({
      success: true,
      quote,
    });
  } catch (error) {
    console.error('[Markets API] Error in /quote:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: (error as Error).message
    });
  }
});

/**
 * GET /api/markets/commodities
 * Get all commodity prices (gold, silver, oil, etc.)
 */
router.get('/commodities', async (req: Request, res: Response) => {
  try {
    const commodities = [];
    
    // Gold
    const goldQuote = await stockMarketService.getQuote('GLD');
    if (goldQuote) {
      commodities.push({
        name: 'Or (Gold)',
        symbol: 'GLD',
        price: goldQuote.price,
        change: goldQuote.change,
        changePercent: goldQuote.changePercent,
        unit: 'USD (ETF proxy)',
      });
    }
    
    // Silver
    const silverQuote = await stockMarketService.getQuote('SLV');
    if (silverQuote) {
      commodities.push({
        name: 'Argent (Silver)',
        symbol: 'SLV',
        price: silverQuote.price,
        change: silverQuote.change,
        changePercent: silverQuote.changePercent,
        unit: 'USD (ETF proxy)',
      });
    }
    
    // Oil
    const oilQuote = await stockMarketService.getQuote('USO');
    if (oilQuote) {
      commodities.push({
        name: 'Pétrole (Oil)',
        symbol: 'USO',
        price: oilQuote.price,
        change: oilQuote.change,
        changePercent: oilQuote.changePercent,
        unit: 'USD (ETF proxy)',
      });
    }
    
    res.json({
      success: true,
      commodities,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Markets API] Error in /commodities:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: (error as Error).message
    });
  }
});

/**
 * GET /api/markets/crypto
 * Get major crypto prices
 */
router.get('/crypto', async (req: Request, res: Response) => {
  try {
    const cryptos = [];
    const symbols = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE'];
    
    for (const sym of symbols) {
      const quote = await stockMarketService.getQuote(sym);
      if (quote) {
        cryptos.push({
          name: sym,
          symbol: quote.symbol,
          price: quote.price,
          change: quote.change,
          changePercent: quote.changePercent,
        });
      }
    }
    
    res.json({
      success: true,
      crypto: cryptos,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Markets API] Error in /crypto:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: (error as Error).message
    });
  }
});

/**
 * GET /api/markets/profile
 * Get current investor profile
 */
router.get('/profile', async (req: Request, res: Response) => {
  try {
    const { id = 'default' } = req.query;
    const profile = tradingAnalysisService.getProfile(typeof id === 'string' ? id : 'default');
    
    res.json({
      success: true,
      profile,
    });
  } catch (error) {
    console.error('[Markets API] Error in /profile:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: (error as Error).message
    });
  }
});

/**
 * POST /api/markets/profile
 * Update investor profile
 */
router.post('/profile', async (req: Request, res: Response) => {
  try {
    const profile = req.body;
    
    if (!profile || !profile.id) {
      return res.status(400).json({ 
        error: 'Profile with id is required'
      });
    }
    
    tradingAnalysisService.setProfile(profile);
    
    res.json({
      success: true,
      message: 'Profile updated',
      profile: tradingAnalysisService.getProfile(profile.id),
    });
  } catch (error) {
    console.error('[Markets API] Error in POST /profile:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: (error as Error).message
    });
  }
});

// ============ ALERTS ENDPOINTS ============

/**
 * GET /api/markets/alerts
 * Get all active alerts for user
 */
router.get('/alerts', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || 'default';
    const alerts = tradingAlertsService.getAlertsByUser(userId);
    
    res.json({
      success: true,
      alerts,
      status: tradingAlertsService.getStatus(),
    });
  } catch (error) {
    console.error('[Markets API] Error in /alerts:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: (error as Error).message
    });
  }
});

/**
 * POST /api/markets/alerts
 * Create a new alert
 * 
 * Body:
 * - symbol: Stock symbol (required)
 * - type: Alert type (price_above, price_below, rsi_overbought, rsi_oversold)
 * - value: Target value
 * - message: Custom message (optional)
 */
router.post('/alerts', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || 'default';
    const { symbol, type, value, message, priority, expiresInDays } = req.body;
    
    if (!symbol || !type || value === undefined) {
      return res.status(400).json({ 
        error: 'symbol, type, and value are required',
        example: {
          symbol: 'AAPL',
          type: 'price_below',
          value: 150,
          message: 'AAPL dropped to buy zone',
        }
      });
    }
    
    // Map type to operator
    const operatorMap: Record<string, any> = {
      'price_above': { operator: '>=', indicator: 'price' },
      'price_below': { operator: '<=', indicator: 'price' },
      'rsi_overbought': { operator: '>=', indicator: 'rsi' },
      'rsi_oversold': { operator: '<=', indicator: 'rsi' },
    };
    
    const config = operatorMap[type] || { operator: '>=', indicator: 'price' };
    
    const alert = tradingAlertsService.createAlert({
      userId,
      symbol,
      type,
      operator: config.operator,
      value,
      indicator: config.indicator,
      priority,
      message,
      expiresInDays,
    });
    
    res.json({
      success: true,
      message: 'Alert created',
      alert,
    });
  } catch (error) {
    console.error('[Markets API] Error in POST /alerts:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: (error as Error).message
    });
  }
});

/**
 * POST /api/markets/alerts/parse
 * Create alert from natural language
 * 
 * Body:
 * - text: Natural language alert request
 */
router.post('/alerts/parse', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || 'default';
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({ 
        error: 'text is required',
        examples: [
          "Préviens-moi si Tesla passe sous 150",
          "Alerte si bitcoin dépasse 100000",
          "Notify me when AAPL reaches 200",
        ]
      });
    }
    
    const alert = tradingAlertsService.parseAlertFromText(userId, text);
    
    if (!alert) {
      return res.status(400).json({ 
        error: 'Could not parse alert from text',
        suggestion: "Try formats like: 'Préviens-moi si AAPL passe sous 150'"
      });
    }
    
    res.json({
      success: true,
      message: 'Alert created from natural language',
      alert,
    });
  } catch (error) {
    console.error('[Markets API] Error in POST /alerts/parse:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: (error as Error).message
    });
  }
});

/**
 * DELETE /api/markets/alerts/:id
 * Cancel an alert
 */
router.delete('/alerts/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const success = tradingAlertsService.cancelAlert(id);
    
    if (!success) {
      return res.status(404).json({ 
        error: 'Alert not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Alert cancelled',
    });
  } catch (error) {
    console.error('[Markets API] Error in DELETE /alerts:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: (error as Error).message
    });
  }
});

/**
 * GET /api/markets/alerts/notifications
 * Get recent alert notifications
 */
router.get('/alerts/notifications', async (req: Request, res: Response) => {
  try {
    const { limit = '20' } = req.query;
    const notifications = tradingAlertsService.getRecentNotifications(
      parseInt(limit as string, 10)
    );
    
    res.json({
      success: true,
      notifications,
    });
  } catch (error) {
    console.error('[Markets API] Error in /alerts/notifications:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: (error as Error).message
    });
  }
});

/**
 * POST /api/markets/alerts/check
 * Manually trigger alert check
 */
router.post('/alerts/check', async (req: Request, res: Response) => {
  try {
    console.log('[Markets API] Manual alert check triggered');
    const triggered = await tradingAlertsService.checkAllAlerts();
    
    res.json({
      success: true,
      triggered: triggered.length,
      notifications: triggered,
      status: tradingAlertsService.getStatus(),
    });
  } catch (error) {
    console.error('[Markets API] Error in POST /alerts/check:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: (error as Error).message
    });
  }
});

/**
 * GET /api/markets/watchlist
 * Get watchlist symbols
 */
router.get('/watchlist', async (req: Request, res: Response) => {
  try {
    const watchlist = tradingAlertsService.getWatchlist();
    
    res.json({
      success: true,
      watchlist,
    });
  } catch (error) {
    console.error('[Markets API] Error in /watchlist:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: (error as Error).message
    });
  }
});

/**
 * POST /api/markets/watchlist
 * Add symbol to watchlist
 */
router.post('/watchlist', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.body;
    
    if (!symbol) {
      return res.status(400).json({ 
        error: 'symbol is required'
      });
    }
    
    tradingAlertsService.addToWatchlist(symbol);
    
    res.json({
      success: true,
      message: `${symbol.toUpperCase()} added to watchlist`,
      watchlist: tradingAlertsService.getWatchlist(),
    });
  } catch (error) {
    console.error('[Markets API] Error in POST /watchlist:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: (error as Error).message
    });
  }
});

export default router;
