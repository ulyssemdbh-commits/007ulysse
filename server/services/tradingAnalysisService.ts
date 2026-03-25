/**
 * TradingAnalysisService - Expert Trader Layer V2
 * 
 * High-level analysis service that sits on top of StockMarketService
 * Provides: analyzeInstrument, generateScenarios, scanMarket, dailyBrief
 */

import { stockMarketService } from './stockMarketService';
import { globalOptimizerService } from './globalOptimizerService';

// ============ TYPES ============

export type Horizon = 'court' | 'moyen' | 'long';
export type RiskTolerance = 'faible' | 'moyenne' | 'elevee';
export type InvestmentStyle = 'dividendes' | 'croissance' | 'value' | 'momentum';
export type Trend = 'haussier' | 'baissier' | 'neutre' | 'consolidation';
export type Signal = 'achat_fort' | 'achat' | 'neutre' | 'vente' | 'vente_forte';

export interface InvestorProfile {
  id: string;
  name: string;
  horizon: Horizon;
  riskTolerance: RiskTolerance;
  style: InvestmentStyle[];
  universe: {
    usStocks: boolean;
    euStocks: boolean;
    etf: boolean;
    commodities: boolean;
    crypto: boolean;
    forex: boolean;
  };
  constraints: {
    maxPositionPercent: number;
    maxCryptoPercent: number;
    maxLeverage: number;
    minDividendYield?: number;
  };
}

export interface TechnicalSummary {
  trend: Trend;
  trendStrength: number; // 0-100
  rsiLevel: number;
  rsiSignal: 'suracheté' | 'survendu' | 'neutre';
  macdSignal: 'haussier' | 'baissier' | 'neutre';
  sma50vs200: 'golden_cross' | 'death_cross' | 'neutre';
  volumeTrend: 'croissant' | 'decroissant' | 'stable';
}

export interface PriceLevels {
  currentPrice: number;
  support1: number;
  support2: number;
  resistance1: number;
  resistance2: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
}

export interface InstrumentAnalysis {
  symbol: string;
  name: string;
  timestamp: Date;
  horizon: Horizon;
  
  // Current state
  currentPrice: number;
  change24h: number;
  changePercent24h: number;
  
  // Technical analysis
  technical: TechnicalSummary;
  levels: PriceLevels;
  
  // Context
  upcomingEvents: string[];
  recentNews: { title: string; sentiment: 'positive' | 'negative' | 'neutral'; date: string }[];
  analystRating: { buy: number; hold: number; sell: number; consensus: string };
  
  // Synthesis
  signal: Signal;
  confidence: number; // 0-100
  risks: string[];
  opportunities: string[];
  summary: string;
}

export interface TradingScenario {
  type: 'prudent' | 'neutre' | 'agressif';
  entryZone: { min: number; max: number };
  reinforcementZone?: { min: number; max: number };
  stopLoss: number;
  takeProfit: number[];
  positionSizePercent: number;
  riskRewardRatio: number;
  description: string;
}

export interface DailyBrief {
  timestamp: Date;
  marketSentiment: 'risk_on' | 'risk_off' | 'mixed';
  summary: string;
  
  indices: {
    name: string;
    value: number;
    change: number;
    changePercent: number;
    trend: 'up' | 'down' | 'flat';
  }[];
  
  commodities: {
    name: string;
    price: number;
    change: number;
    changePercent: number;
  }[];
  
  crypto: {
    name: string;
    price: number;
    change: number;
    changePercent: number;
  }[];
  
  keyEvents: string[];
  alerts: string[];
}

// ============ DEFAULT PROFILE ============

const DEFAULT_PROFILE: InvestorProfile = {
  id: 'ulysse_default',
  name: 'Ulysse (Profil Équilibré)',
  horizon: 'moyen',
  riskTolerance: 'moyenne',
  style: ['croissance', 'momentum'],
  universe: {
    usStocks: true,
    euStocks: true,
    etf: true,
    commodities: true,
    crypto: true,
    forex: true,
  },
  constraints: {
    maxPositionPercent: 15,
    maxCryptoPercent: 10,
    maxLeverage: 1,
  },
};

// ============ SERVICE ============

class TradingAnalysisService {
  private profiles = new Map<string, InvestorProfile>();
  
  constructor() {
    this.profiles.set('default', DEFAULT_PROFILE);
  }

  // ============ PROFILE MANAGEMENT ============
  
  getProfile(id: string = 'default'): InvestorProfile {
    return this.profiles.get(id) || DEFAULT_PROFILE;
  }
  
  setProfile(profile: InvestorProfile): void {
    this.profiles.set(profile.id, profile);
  }

  // ============ INSTRUMENT ANALYSIS (cached via globalOptimizerService) ============
  
  async analyzeInstrument(symbol: string, horizon: Horizon = 'moyen'): Promise<InstrumentAnalysis | null> {
    const cacheKey = `analysis:${symbol}:${horizon}`;
    
    return globalOptimizerService.getOrFetch(
      cacheKey,
      "trading_analysis",
      () => this.analyzeInstrumentDirect(symbol, horizon),
      { customTTL: 2 * 60 * 1000 } // 2 min TTL for analysis
    );
  }
  
  private async analyzeInstrumentDirect(symbol: string, horizon: Horizon): Promise<InstrumentAnalysis | null> {
    try {
      // Parallel fetch all data for 2x efficiency
      const [quote, historical, indicators, newsData, recommendations] = await Promise.all([
        stockMarketService.getQuote(symbol),
        stockMarketService.getHistoricalData(symbol, '1M'),
        stockMarketService.getTechnicalIndicators(symbol),
        stockMarketService.getNews(symbol),
        stockMarketService.getRecommendations(symbol)
      ]);
      
      if (!quote) {
        console.log(`[TradingAnalysis] No quote for ${symbol}`);
        return null;
      }
      
      // Calculate technical summary
      const technical = this.calculateTechnicalSummary(quote, indicators, historical);
      
      // Calculate price levels
      const levels = this.calculatePriceLevels(quote.price, historical);
      
      // Analyze news sentiment
      const recentNews = this.analyzeNewsSentiment(newsData);
      
      // Get analyst consensus
      const analystRating = this.getAnalystConsensus(recommendations);
      
      // Generate signal and synthesis
      const { signal, confidence, risks, opportunities, summary } = 
        this.synthesizeAnalysis(symbol, quote, technical, levels, recentNews, analystRating, horizon);

      return {
        symbol: symbol.toUpperCase(),
        name: symbol.toUpperCase(),
        timestamp: new Date(),
        horizon,
        currentPrice: quote.price,
        change24h: quote.change,
        changePercent24h: quote.changePercent,
        technical,
        levels,
        upcomingEvents: [],
        recentNews,
        analystRating,
        signal,
        confidence,
        risks,
        opportunities,
        summary,
      };
    } catch (error) {
      console.error(`[TradingAnalysis] Error analyzing ${symbol}:`, error);
      return null;
    }
  }

  private calculateTechnicalSummary(
    quote: any, 
    indicators: any, 
    historical: any[]
  ): TechnicalSummary {
    // Default values if no indicator data
    let rsiLevel = 50;
    let rsiSignal: 'suracheté' | 'survendu' | 'neutre' = 'neutre';
    let macdSignal: 'haussier' | 'baissier' | 'neutre' = 'neutre';
    let sma50vs200: 'golden_cross' | 'death_cross' | 'neutre' = 'neutre';
    
    if (indicators) {
      // RSI analysis
      rsiLevel = indicators.rsi || 50;
      if (rsiLevel > 70) rsiSignal = 'suracheté';
      else if (rsiLevel < 30) rsiSignal = 'survendu';
      
      // MACD analysis
      if (indicators.macd) {
        macdSignal = indicators.macd > 0 ? 'haussier' : 'baissier';
      }
      
      // SMA crossover
      if (indicators.sma50 && indicators.sma200) {
        if (indicators.sma50 > indicators.sma200) sma50vs200 = 'golden_cross';
        else if (indicators.sma50 < indicators.sma200) sma50vs200 = 'death_cross';
      }
    }
    
    // Calculate trend from price data
    let trend: Trend = 'neutre';
    let trendStrength = 50;
    
    if (historical && historical.length >= 5) {
      const recentPrices = historical.slice(-5);
      const oldestPrice = recentPrices[0]?.close || quote.price;
      const newestPrice = quote.price;
      const priceChange = ((newestPrice - oldestPrice) / oldestPrice) * 100;
      
      if (priceChange > 5) {
        trend = 'haussier';
        trendStrength = Math.min(90, 50 + priceChange * 2);
      } else if (priceChange < -5) {
        trend = 'baissier';
        trendStrength = Math.min(90, 50 + Math.abs(priceChange) * 2);
      } else if (Math.abs(priceChange) < 2) {
        trend = 'consolidation';
        trendStrength = 40;
      }
    }
    
    // Volume trend
    let volumeTrend: 'croissant' | 'decroissant' | 'stable' = 'stable';
    if (historical && historical.length >= 10) {
      const recentVol = historical.slice(-5).reduce((sum, d) => sum + (d.volume || 0), 0) / 5;
      const olderVol = historical.slice(-10, -5).reduce((sum, d) => sum + (d.volume || 0), 0) / 5;
      if (recentVol > olderVol * 1.2) volumeTrend = 'croissant';
      else if (recentVol < olderVol * 0.8) volumeTrend = 'decroissant';
    }
    
    return {
      trend,
      trendStrength,
      rsiLevel,
      rsiSignal,
      macdSignal,
      sma50vs200,
      volumeTrend,
    };
  }

  private calculatePriceLevels(currentPrice: number, historical: any[]): PriceLevels {
    // Default levels based on current price
    let high = currentPrice * 1.1;
    let low = currentPrice * 0.9;
    
    if (historical && historical.length >= 20) {
      const prices = historical.map(d => ({ high: d.high, low: d.low, close: d.close }));
      const highs = prices.map(p => p.high).filter(Boolean);
      const lows = prices.map(p => p.low).filter(Boolean);
      
      if (highs.length > 0) high = Math.max(...highs);
      if (lows.length > 0) low = Math.min(...lows);
    }
    
    const range = high - low;
    
    return {
      currentPrice,
      support1: currentPrice - range * 0.1,
      support2: currentPrice - range * 0.2,
      resistance1: currentPrice + range * 0.1,
      resistance2: currentPrice + range * 0.2,
      stopLoss: currentPrice - range * 0.15,
      takeProfit1: currentPrice + range * 0.15,
      takeProfit2: currentPrice + range * 0.3,
    };
  }

  private analyzeNewsSentiment(newsData: any[]): { title: string; sentiment: 'positive' | 'negative' | 'neutral'; date: string }[] {
    if (!newsData || !Array.isArray(newsData)) return [];
    
    return newsData.slice(0, 5).map(news => {
      const title = news.headline || news.title || '';
      const lowerTitle = title.toLowerCase();
      
      let sentiment: 'positive' | 'negative' | 'neutral' = 'neutral';
      
      const positiveWords = ['surge', 'gain', 'rise', 'jump', 'beat', 'record', 'growth', 'profit', 'upgrade'];
      const negativeWords = ['fall', 'drop', 'crash', 'loss', 'miss', 'decline', 'downgrade', 'warning', 'risk'];
      
      if (positiveWords.some(w => lowerTitle.includes(w))) sentiment = 'positive';
      else if (negativeWords.some(w => lowerTitle.includes(w))) sentiment = 'negative';
      
      return {
        title: title.substring(0, 100),
        sentiment,
        date: news.datetime ? new Date(news.datetime * 1000).toISOString().split('T')[0] : 'N/A',
      };
    });
  }

  private getAnalystConsensus(recommendations: any): { buy: number; hold: number; sell: number; consensus: string } {
    const defaultResult = { buy: 0, hold: 0, sell: 0, consensus: 'N/A' };
    
    if (!recommendations || !Array.isArray(recommendations) || recommendations.length === 0) {
      return defaultResult;
    }
    
    const latest = recommendations[0];
    const buy = (latest.strongBuy || 0) + (latest.buy || 0);
    const hold = latest.hold || 0;
    const sell = (latest.sell || 0) + (latest.strongSell || 0);
    const total = buy + hold + sell;
    
    let consensus = 'Hold';
    if (total > 0) {
      const buyPercent = buy / total;
      const sellPercent = sell / total;
      
      if (buyPercent > 0.6) consensus = 'Strong Buy';
      else if (buyPercent > 0.4) consensus = 'Buy';
      else if (sellPercent > 0.4) consensus = 'Sell';
      else if (sellPercent > 0.6) consensus = 'Strong Sell';
    }
    
    return { buy, hold, sell, consensus };
  }

  private synthesizeAnalysis(
    symbol: string,
    quote: any,
    technical: TechnicalSummary,
    levels: PriceLevels,
    news: any[],
    analysts: any,
    horizon: Horizon
  ): { signal: Signal; confidence: number; risks: string[]; opportunities: string[]; summary: string } {
    const risks: string[] = [];
    const opportunities: string[] = [];
    let score = 50; // Base score
    
    // Technical factors
    if (technical.trend === 'haussier') {
      score += 15;
      opportunities.push('Tendance haussière confirmée');
    } else if (technical.trend === 'baissier') {
      score -= 15;
      risks.push('Tendance baissière en cours');
    }
    
    if (technical.rsiSignal === 'suracheté') {
      score -= 10;
      risks.push('RSI en zone de surachat (>70) - risque de correction');
    } else if (technical.rsiSignal === 'survendu') {
      score += 10;
      opportunities.push('RSI en zone de survente (<30) - potentiel rebond');
    }
    
    if (technical.sma50vs200 === 'golden_cross') {
      score += 10;
      opportunities.push('Golden Cross (SMA50 > SMA200) - signal haussier long terme');
    } else if (technical.sma50vs200 === 'death_cross') {
      score -= 10;
      risks.push('Death Cross (SMA50 < SMA200) - signal baissier long terme');
    }
    
    // Analyst factors
    if (analysts.consensus === 'Strong Buy' || analysts.consensus === 'Buy') {
      score += 10;
      opportunities.push(`Consensus analystes: ${analysts.consensus}`);
    } else if (analysts.consensus === 'Sell' || analysts.consensus === 'Strong Sell') {
      score -= 10;
      risks.push(`Consensus analystes: ${analysts.consensus}`);
    }
    
    // News sentiment
    const positiveNews = news.filter(n => n.sentiment === 'positive').length;
    const negativeNews = news.filter(n => n.sentiment === 'negative').length;
    if (positiveNews > negativeNews + 1) {
      score += 5;
      opportunities.push('Actualités majoritairement positives');
    } else if (negativeNews > positiveNews + 1) {
      score -= 5;
      risks.push('Actualités majoritairement négatives');
    }
    
    // Determine signal
    let signal: Signal;
    if (score >= 75) signal = 'achat_fort';
    else if (score >= 60) signal = 'achat';
    else if (score <= 25) signal = 'vente_forte';
    else if (score <= 40) signal = 'vente';
    else signal = 'neutre';
    
    // Confidence based on data availability and alignment
    let confidence = 50;
    if (technical.trendStrength > 60) confidence += 10;
    if (analysts.buy + analysts.hold + analysts.sell > 5) confidence += 10;
    if (news.length > 2) confidence += 5;
    confidence = Math.min(95, confidence);
    
    // Generate summary
    const trendText = technical.trend === 'haussier' ? 'haussière' : 
                      technical.trend === 'baissier' ? 'baissière' : 'neutre';
    const signalText = signal === 'achat_fort' ? 'ACHAT FORT' :
                       signal === 'achat' ? 'ACHAT' :
                       signal === 'vente_forte' ? 'VENTE FORTE' :
                       signal === 'vente' ? 'VENTE' : 'NEUTRE';
    
    const summary = `**${symbol.toUpperCase()}** - Signal: **${signalText}** (confiance: ${confidence}%)\n\n` +
      `📊 Cours actuel: ${quote.price.toFixed(2)} (${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%)\n` +
      `📈 Tendance ${trendText} | RSI: ${technical.rsiLevel.toFixed(0)} (${technical.rsiSignal})\n` +
      `📉 Support: ${levels.support1.toFixed(2)} | Résistance: ${levels.resistance1.toFixed(2)}\n` +
      `👥 Analystes: ${analysts.consensus} (${analysts.buy} buy / ${analysts.hold} hold / ${analysts.sell} sell)\n\n` +
      `✅ **Opportunités:** ${opportunities.length > 0 ? opportunities.join(', ') : 'Aucune identifiée'}\n` +
      `⚠️ **Risques:** ${risks.length > 0 ? risks.join(', ') : 'Aucun identifié'}\n\n` +
      `_Horizon: ${horizon} terme | ⚠️ Ceci n'est pas un conseil financier._`;
    
    return { signal, confidence, risks, opportunities, summary };
  }

  // ============ TRADING SCENARIOS ============
  
  async generateScenarios(symbol: string, profileId: string = 'default'): Promise<TradingScenario[]> {
    const profile = this.getProfile(profileId);
    const analysis = await this.analyzeInstrument(symbol, profile.horizon);
    
    if (!analysis) return [];
    
    const { currentPrice, levels } = analysis;
    const range = levels.resistance1 - levels.support1;
    
    // Scenario prudent
    const prudent: TradingScenario = {
      type: 'prudent',
      entryZone: { min: levels.support1, max: levels.support1 + range * 0.1 },
      stopLoss: levels.support2,
      takeProfit: [levels.resistance1 * 0.95],
      positionSizePercent: Math.min(5, profile.constraints.maxPositionPercent / 3),
      riskRewardRatio: this.calculateRR(levels.support1, levels.support2, levels.resistance1 * 0.95),
      description: `Entrée prudente proche du support à ${levels.support1.toFixed(2)}, objectif conservateur.`,
    };
    
    // Scenario neutre
    const neutre: TradingScenario = {
      type: 'neutre',
      entryZone: { min: currentPrice * 0.98, max: currentPrice * 1.02 },
      reinforcementZone: { min: levels.support1, max: levels.support1 + range * 0.15 },
      stopLoss: levels.stopLoss,
      takeProfit: [levels.takeProfit1, levels.takeProfit2],
      positionSizePercent: Math.min(10, profile.constraints.maxPositionPercent / 2),
      riskRewardRatio: this.calculateRR(currentPrice, levels.stopLoss, levels.takeProfit1),
      description: `Entrée au prix actuel avec renfort possible sur support. Position standard.`,
    };
    
    // Scenario agressif
    const agressif: TradingScenario = {
      type: 'agressif',
      entryZone: { min: currentPrice * 0.99, max: currentPrice * 1.01 },
      stopLoss: levels.stopLoss * 1.02,
      takeProfit: [levels.takeProfit2, levels.resistance2],
      positionSizePercent: profile.constraints.maxPositionPercent,
      riskRewardRatio: this.calculateRR(currentPrice, levels.stopLoss * 1.02, levels.takeProfit2),
      description: `Entrée immédiate avec objectifs ambitieux. Risque élevé, potentiel de gain important.`,
    };
    
    return [prudent, neutre, agressif];
  }
  
  private calculateRR(entry: number, stopLoss: number, takeProfit: number): number {
    const risk = Math.abs(entry - stopLoss);
    const reward = Math.abs(takeProfit - entry);
    return risk > 0 ? parseFloat((reward / risk).toFixed(2)) : 0;
  }

  // ============ DAILY BRIEF ============
  
  async getDailyBrief(): Promise<DailyBrief> {
    const alerts: string[] = [];
    const keyEvents: string[] = [];
    
    // Get market overview
    const overview = await stockMarketService.getMarketOverview();
    
    // Format indices
    const indices = overview.indices.map(idx => ({
      name: idx.name,
      value: idx.value,
      change: idx.change,
      changePercent: idx.changePercent,
      trend: idx.change > 0.5 ? 'up' as const : idx.change < -0.5 ? 'down' as const : 'flat' as const,
    }));
    
    // Get commodities
    const commodities: DailyBrief['commodities'] = [];
    
    const goldQuote = await stockMarketService.getQuote('GLD');
    if (goldQuote) {
      commodities.push({
        name: 'Or (GLD)',
        price: goldQuote.price,
        change: goldQuote.change,
        changePercent: goldQuote.changePercent,
      });
      if (Math.abs(goldQuote.changePercent) > 2) {
        alerts.push(`Or: mouvement significatif ${goldQuote.changePercent > 0 ? '+' : ''}${goldQuote.changePercent.toFixed(2)}%`);
      }
    }
    
    const oilQuote = await stockMarketService.getQuote('USO');
    if (oilQuote) {
      commodities.push({
        name: 'Pétrole (USO)',
        price: oilQuote.price,
        change: oilQuote.change,
        changePercent: oilQuote.changePercent,
      });
      if (Math.abs(oilQuote.changePercent) > 3) {
        alerts.push(`Pétrole: mouvement significatif ${oilQuote.changePercent > 0 ? '+' : ''}${oilQuote.changePercent.toFixed(2)}%`);
      }
    }
    
    // Get crypto
    const crypto: DailyBrief['crypto'] = [];
    
    const btcQuote = await stockMarketService.getQuote('BTC');
    if (btcQuote) {
      crypto.push({
        name: 'Bitcoin',
        price: btcQuote.price,
        change: btcQuote.change,
        changePercent: btcQuote.changePercent,
      });
      if (Math.abs(btcQuote.changePercent) > 5) {
        alerts.push(`Bitcoin: volatilité élevée ${btcQuote.changePercent > 0 ? '+' : ''}${btcQuote.changePercent.toFixed(2)}%`);
      }
    }
    
    const ethQuote = await stockMarketService.getQuote('ETH');
    if (ethQuote) {
      crypto.push({
        name: 'Ethereum',
        price: ethQuote.price,
        change: ethQuote.change,
        changePercent: ethQuote.changePercent,
      });
    }
    
    // Determine market sentiment
    const upIndices = indices.filter(i => i.trend === 'up').length;
    const downIndices = indices.filter(i => i.trend === 'down').length;
    let marketSentiment: 'risk_on' | 'risk_off' | 'mixed' = 'mixed';
    if (upIndices > downIndices + 1) marketSentiment = 'risk_on';
    else if (downIndices > upIndices + 1) marketSentiment = 'risk_off';
    
    // Generate summary
    const sentimentText = marketSentiment === 'risk_on' ? 'Marchés optimistes (Risk-On)' :
                          marketSentiment === 'risk_off' ? 'Marchés prudents (Risk-Off)' : 'Marchés mitigés';
    
    const indicesSummary = indices.map(i => 
      `${i.trend === 'up' ? '🟢' : i.trend === 'down' ? '🔴' : '⚪'} ${i.name}: ${i.changePercent >= 0 ? '+' : ''}${i.changePercent.toFixed(2)}%`
    ).join(' | ');
    
    const commoditiesSummary = commodities.map(c =>
      `${c.changePercent >= 0 ? '📈' : '📉'} ${c.name}: ${c.changePercent >= 0 ? '+' : ''}${c.changePercent.toFixed(2)}%`
    ).join(' | ');
    
    const cryptoSummary = crypto.map(c =>
      `${c.changePercent >= 0 ? '📈' : '📉'} ${c.name}: ${c.changePercent >= 0 ? '+' : ''}${c.changePercent.toFixed(2)}%`
    ).join(' | ');
    
    const summary = `📊 **Point Marché du jour**\n\n` +
      `**Sentiment:** ${sentimentText}\n\n` +
      `**Indices:** ${indicesSummary}\n\n` +
      `**Matières premières:** ${commoditiesSummary || 'N/A'}\n\n` +
      `**Crypto:** ${cryptoSummary || 'N/A'}\n\n` +
      (alerts.length > 0 ? `⚠️ **Alertes:** ${alerts.join(' | ')}\n\n` : '') +
      `_Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}_`;
    
    return {
      timestamp: new Date(),
      marketSentiment,
      summary,
      indices,
      commodities,
      crypto,
      keyEvents,
      alerts,
    };
  }

  // ============ FORMAT HELPERS FOR ULYSSE ============
  
  formatAnalysisForChat(analysis: InstrumentAnalysis): string {
    return analysis.summary;
  }
  
  formatScenariosForChat(scenarios: TradingScenario[], symbol: string): string {
    if (scenarios.length === 0) return "Impossible de générer des scénarios pour ce titre.";
    
    const lines = scenarios.map(s => {
      const emoji = s.type === 'prudent' ? '🐢' : s.type === 'neutre' ? '⚖️' : '🚀';
      return `${emoji} **Scénario ${s.type}**\n` +
        `   Entrée: ${s.entryZone.min.toFixed(2)} - ${s.entryZone.max.toFixed(2)}\n` +
        `   Stop: ${s.stopLoss.toFixed(2)} | TP: ${s.takeProfit.map(t => t.toFixed(2)).join(' / ')}\n` +
        `   Position: ${s.positionSizePercent}% | R/R: ${s.riskRewardRatio}:1\n` +
        `   _${s.description}_`;
    });
    
    return `📈 **Scénarios de trading pour ${symbol.toUpperCase()}**\n\n${lines.join('\n\n')}\n\n` +
      `_⚠️ Ceci n'est pas un conseil financier. Faites vos propres recherches._`;
  }
  
  formatBriefForChat(brief: DailyBrief): string {
    return brief.summary;
  }
}

export const tradingAnalysisService = new TradingAnalysisService();
