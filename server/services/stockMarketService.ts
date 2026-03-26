/**
 * Stock Market Service
 * Multi-provider financial data service with intelligent fallback
 * 
 * Providers (priority order):
 * 1. Finnhub - Real-time quotes, news, fundamentals, recommendations
 * 2. Twelve Data - Global stocks, forex, crypto, technical indicators
 * 3. Alpha Vantage - Free tier, technical indicators (RSI, MACD, etc.)
 * 
 * Features:
 * - Real-time and delayed quotes
 * - Historical data (daily, weekly, monthly)
 * - Technical indicators
 * - Company fundamentals
 * - News and sentiment
 * - Earnings calendar
 */

interface StockQuote {
  symbol: string;
  name?: string;
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  open: number;
  previousClose: number;
  volume: number;
  timestamp: number;
  marketCap?: number;
  pe?: number;
  eps?: number;
  provider: string;
}

interface StockCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CompanyProfile {
  symbol: string;
  name: string;
  description?: string;
  sector?: string;
  industry?: string;
  country?: string;
  currency?: string;
  exchange?: string;
  marketCap?: number;
  sharesOutstanding?: number;
  logo?: string;
  weburl?: string;
  ipo?: string;
}

interface StockNews {
  headline: string;
  summary: string;
  source: string;
  url: string;
  datetime: number;
  sentiment?: 'positive' | 'negative' | 'neutral';
}

interface TechnicalIndicator {
  name: string;
  value: number;
  signal?: 'buy' | 'sell' | 'neutral';
  timestamp: number;
}

interface AnalystRecommendation {
  symbol: string;
  buy: number;
  hold: number;
  sell: number;
  strongBuy: number;
  strongSell: number;
  period: string;
}

interface EarningsEvent {
  symbol: string;
  date: string;
  epsEstimate?: number;
  epsActual?: number;
  revenueEstimate?: number;
  revenueActual?: number;
  hour?: string;
}

interface MarketIndex {
  symbol: string;
  name: string;
  value: number;
  change: number;
  changePercent: number;
}

interface SearchResult {
  symbol: string;
  name: string;
  type: string;
  region?: string;
  currency?: string;
}

const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const TWELVE_DATA_BASE = 'https://api.twelvedata.com';
const ALPHA_VANTAGE_BASE = 'https://www.alphavantage.co/query';

const MAJOR_INDICES = [
  { symbol: '^GSPC', name: 'S&P 500', finnhub: 'SPY' },
  { symbol: '^DJI', name: 'Dow Jones', finnhub: 'DIA' },
  { symbol: '^IXIC', name: 'Nasdaq', finnhub: 'QQQ' },
  { symbol: '^FCHI', name: 'CAC 40', finnhub: 'EWQ' },
  { symbol: '^GDAXI', name: 'DAX', finnhub: 'EWG' },
  { symbol: '^FTSE', name: 'FTSE 100', finnhub: 'EWU' },
];

const CACHE_TTL = {
  quote: 60 * 1000, // 1 minute
  profile: 24 * 60 * 60 * 1000, // 24 hours
  news: 15 * 60 * 1000, // 15 minutes
  historical: 60 * 60 * 1000, // 1 hour
  indicators: 5 * 60 * 1000, // 5 minutes
};

// ============ SPECIAL SYMBOLS MAPPING (Commodities, Crypto, Forex aliases) ============
// Maps common aliases to their actual trading symbols
const SPECIAL_SYMBOLS: Record<string, { symbol: string; name: string; unit: string; emoji: string }> = {
  // Gold / Or
  'OR': { symbol: 'XAUUSD', name: 'Or (Gold)', unit: 'USD/once', emoji: '🪙' },
  'GOLD': { symbol: 'XAUUSD', name: 'Gold', unit: 'USD/oz', emoji: '🪙' },
  'XAU': { symbol: 'XAUUSD', name: 'Gold', unit: 'USD/oz', emoji: '🪙' },
  'XAUUSD': { symbol: 'XAUUSD', name: 'Gold', unit: 'USD/oz', emoji: '🪙' },
  'GLD': { symbol: 'GLD', name: 'SPDR Gold Trust ETF', unit: 'USD', emoji: '🪙' },
  
  // Silver / Argent
  'ARGENT': { symbol: 'XAGUSD', name: 'Argent (Silver)', unit: 'USD/once', emoji: '🥈' },
  'SILVER': { symbol: 'XAGUSD', name: 'Silver', unit: 'USD/oz', emoji: '🥈' },
  'XAG': { symbol: 'XAGUSD', name: 'Silver', unit: 'USD/oz', emoji: '🥈' },
  'XAGUSD': { symbol: 'XAGUSD', name: 'Silver', unit: 'USD/oz', emoji: '🥈' },
  'SLV': { symbol: 'SLV', name: 'iShares Silver Trust ETF', unit: 'USD', emoji: '🥈' },
  
  // Oil / Pétrole
  'PETROLE': { symbol: 'CL=F', name: 'Pétrole WTI', unit: 'USD/baril', emoji: '🛢️' },
  'OIL': { symbol: 'CL=F', name: 'Crude Oil WTI', unit: 'USD/barrel', emoji: '🛢️' },
  'WTI': { symbol: 'CL=F', name: 'WTI Crude', unit: 'USD/barrel', emoji: '🛢️' },
  'BRENT': { symbol: 'BZ=F', name: 'Brent Crude', unit: 'USD/barrel', emoji: '🛢️' },
  'USO': { symbol: 'USO', name: 'US Oil Fund ETF', unit: 'USD', emoji: '🛢️' },
  
  // Natural Gas / Gaz naturel
  'GAZ': { symbol: 'NG=F', name: 'Gaz Naturel', unit: 'USD/MMBtu', emoji: '🔥' },
  'GAS': { symbol: 'NG=F', name: 'Natural Gas', unit: 'USD/MMBtu', emoji: '🔥' },
  'NATURALGAS': { symbol: 'NG=F', name: 'Natural Gas', unit: 'USD/MMBtu', emoji: '🔥' },
  
  // Copper / Cuivre
  'CUIVRE': { symbol: 'HG=F', name: 'Cuivre', unit: 'USD/livre', emoji: '🔶' },
  'COPPER': { symbol: 'HG=F', name: 'Copper', unit: 'USD/lb', emoji: '🔶' },
  
  // Platinum / Platine
  'PLATINE': { symbol: 'PL=F', name: 'Platine', unit: 'USD/once', emoji: '⚪' },
  'PLATINUM': { symbol: 'PL=F', name: 'Platinum', unit: 'USD/oz', emoji: '⚪' },
  
  // Crypto majors (with proper format)
  'BITCOIN': { symbol: 'BINANCE:BTCUSDT', name: 'Bitcoin', unit: 'USDT', emoji: '₿' },
  'BTC': { symbol: 'BINANCE:BTCUSDT', name: 'Bitcoin', unit: 'USDT', emoji: '₿' },
  'ETHEREUM': { symbol: 'BINANCE:ETHUSDT', name: 'Ethereum', unit: 'USDT', emoji: 'Ξ' },
  'ETH': { symbol: 'BINANCE:ETHUSDT', name: 'Ethereum', unit: 'USDT', emoji: 'Ξ' },
  'SOLANA': { symbol: 'BINANCE:SOLUSDT', name: 'Solana', unit: 'USDT', emoji: '◎' },
  'SOL': { symbol: 'BINANCE:SOLUSDT', name: 'Solana', unit: 'USDT', emoji: '◎' },
  'RIPPLE': { symbol: 'BINANCE:XRPUSDT', name: 'Ripple', unit: 'USDT', emoji: '💧' },
  'XRP': { symbol: 'BINANCE:XRPUSDT', name: 'Ripple', unit: 'USDT', emoji: '💧' },
  'CARDANO': { symbol: 'BINANCE:ADAUSDT', name: 'Cardano', unit: 'USDT', emoji: '🔵' },
  'ADA': { symbol: 'BINANCE:ADAUSDT', name: 'Cardano', unit: 'USDT', emoji: '🔵' },
  'DOGECOIN': { symbol: 'BINANCE:DOGEUSDT', name: 'Dogecoin', unit: 'USDT', emoji: '🐕' },
  'DOGE': { symbol: 'BINANCE:DOGEUSDT', name: 'Dogecoin', unit: 'USDT', emoji: '🐕' },
  'POLKADOT': { symbol: 'BINANCE:DOTUSDT', name: 'Polkadot', unit: 'USDT', emoji: '⚫' },
  'DOT': { symbol: 'BINANCE:DOTUSDT', name: 'Polkadot', unit: 'USDT', emoji: '⚫' },
  'AVALANCHE': { symbol: 'BINANCE:AVAXUSDT', name: 'Avalanche', unit: 'USDT', emoji: '🔺' },
  'AVAX': { symbol: 'BINANCE:AVAXUSDT', name: 'Avalanche', unit: 'USDT', emoji: '🔺' },
  'CHAINLINK': { symbol: 'BINANCE:LINKUSDT', name: 'Chainlink', unit: 'USDT', emoji: '🔗' },
  'LINK': { symbol: 'BINANCE:LINKUSDT', name: 'Chainlink', unit: 'USDT', emoji: '🔗' },
  'LITECOIN': { symbol: 'BINANCE:LTCUSDT', name: 'Litecoin', unit: 'USDT', emoji: 'Ł' },
  'LTC': { symbol: 'BINANCE:LTCUSDT', name: 'Litecoin', unit: 'USDT', emoji: 'Ł' },
  
  // DeFi & Altcoins
  'AAVE': { symbol: 'BINANCE:AAVEUSDT', name: 'Aave', unit: 'USDT', emoji: '👻' },
  'UNISWAP': { symbol: 'BINANCE:UNIUSDT', name: 'Uniswap', unit: 'USDT', emoji: '🦄' },
  'UNI': { symbol: 'BINANCE:UNIUSDT', name: 'Uniswap', unit: 'USDT', emoji: '🦄' },
  'COMPOUND': { symbol: 'BINANCE:COMPUSDT', name: 'Compound', unit: 'USDT', emoji: '🏦' },
  'COMP': { symbol: 'BINANCE:COMPUSDT', name: 'Compound', unit: 'USDT', emoji: '🏦' },
  'MAKER': { symbol: 'BINANCE:MKRUSDT', name: 'Maker', unit: 'USDT', emoji: '🏗️' },
  'MKR': { symbol: 'BINANCE:MKRUSDT', name: 'Maker', unit: 'USDT', emoji: '🏗️' },
  'SUSHI': { symbol: 'BINANCE:SUSHIUSDT', name: 'SushiSwap', unit: 'USDT', emoji: '🍣' },
  'CURVE': { symbol: 'BINANCE:CRVUSDT', name: 'Curve', unit: 'USDT', emoji: '📈' },
  'CRV': { symbol: 'BINANCE:CRVUSDT', name: 'Curve', unit: 'USDT', emoji: '📈' },
  'YEARN': { symbol: 'BINANCE:YFIUSDT', name: 'Yearn Finance', unit: 'USDT', emoji: '💎' },
  'YFI': { symbol: 'BINANCE:YFIUSDT', name: 'Yearn Finance', unit: 'USDT', emoji: '💎' },
  'SYNTHETIX': { symbol: 'BINANCE:SNXUSDT', name: 'Synthetix', unit: 'USDT', emoji: '⚡' },
  'SNX': { symbol: 'BINANCE:SNXUSDT', name: 'Synthetix', unit: 'USDT', emoji: '⚡' },
  '1INCH': { symbol: 'BINANCE:1INCHUSDT', name: '1inch', unit: 'USDT', emoji: '🔁' },
  'LIDO': { symbol: 'BINANCE:LDOUSDT', name: 'Lido DAO', unit: 'USDT', emoji: '🌊' },
  'LDO': { symbol: 'BINANCE:LDOUSDT', name: 'Lido DAO', unit: 'USDT', emoji: '🌊' },
  'MATIC': { symbol: 'BINANCE:MATICUSDT', name: 'Polygon', unit: 'USDT', emoji: '🟣' },
  'POLYGON': { symbol: 'BINANCE:MATICUSDT', name: 'Polygon', unit: 'USDT', emoji: '🟣' },
  'ARBITRUM': { symbol: 'BINANCE:ARBUSDT', name: 'Arbitrum', unit: 'USDT', emoji: '🔵' },
  'ARB': { symbol: 'BINANCE:ARBUSDT', name: 'Arbitrum', unit: 'USDT', emoji: '🔵' },
  'OPTIMISM': { symbol: 'BINANCE:OPUSDT', name: 'Optimism', unit: 'USDT', emoji: '🔴' },
  'OP': { symbol: 'BINANCE:OPUSDT', name: 'Optimism', unit: 'USDT', emoji: '🔴' },
  'NEAR': { symbol: 'BINANCE:NEARUSDT', name: 'NEAR Protocol', unit: 'USDT', emoji: '🌐' },
  'COSMOS': { symbol: 'BINANCE:ATOMUSDT', name: 'Cosmos', unit: 'USDT', emoji: '⚛️' },
  'ATOM': { symbol: 'BINANCE:ATOMUSDT', name: 'Cosmos', unit: 'USDT', emoji: '⚛️' },
  'SHIBA': { symbol: 'BINANCE:SHIBUSDT', name: 'Shiba Inu', unit: 'USDT', emoji: '🐕' },
  'SHIB': { symbol: 'BINANCE:SHIBUSDT', name: 'Shiba Inu', unit: 'USDT', emoji: '🐕' },
  'PEPE': { symbol: 'BINANCE:PEPEUSDT', name: 'Pepe', unit: 'USDT', emoji: '🐸' },
  'FLOKI': { symbol: 'BINANCE:FLOKIUSDT', name: 'Floki', unit: 'USDT', emoji: '🐕' },
  'SUI': { symbol: 'BINANCE:SUIUSDT', name: 'Sui', unit: 'USDT', emoji: '💧' },
  'APT': { symbol: 'BINANCE:APTUSDT', name: 'Aptos', unit: 'USDT', emoji: '🌱' },
  'APTOS': { symbol: 'BINANCE:APTUSDT', name: 'Aptos', unit: 'USDT', emoji: '🌱' },
  'INJECTIVE': { symbol: 'BINANCE:INJUSDT', name: 'Injective', unit: 'USDT', emoji: '💉' },
  'INJ': { symbol: 'BINANCE:INJUSDT', name: 'Injective', unit: 'USDT', emoji: '💉' },
  'RENDER': { symbol: 'BINANCE:RENDERUSDT', name: 'Render', unit: 'USDT', emoji: '🎬' },
  'RNDR': { symbol: 'BINANCE:RENDERUSDT', name: 'Render', unit: 'USDT', emoji: '🎬' },
  'FET': { symbol: 'BINANCE:FETUSDT', name: 'Fetch.ai', unit: 'USDT', emoji: '🤖' },
  'TAO': { symbol: 'BINANCE:TAOUSDT', name: 'Bittensor', unit: 'USDT', emoji: '🧠' },
  'BITTENSOR': { symbol: 'BINANCE:TAOUSDT', name: 'Bittensor', unit: 'USDT', emoji: '🧠' },
  'WIF': { symbol: 'BINANCE:WIFUSDT', name: 'Dogwifhat', unit: 'USDT', emoji: '🎩' },
  'BONK': { symbol: 'BINANCE:BONKUSDT', name: 'Bonk', unit: 'USDT', emoji: '🐶' },
  'JUPITER': { symbol: 'BINANCE:JUPUSDT', name: 'Jupiter', unit: 'USDT', emoji: '♃' },
  'JUP': { symbol: 'BINANCE:JUPUSDT', name: 'Jupiter', unit: 'USDT', emoji: '♃' },
  'SEI': { symbol: 'BINANCE:SEIUSDT', name: 'Sei', unit: 'USDT', emoji: '🌊' },
  'TIA': { symbol: 'BINANCE:TIAUSDT', name: 'Celestia', unit: 'USDT', emoji: '✨' },
  'CELESTIA': { symbol: 'BINANCE:TIAUSDT', name: 'Celestia', unit: 'USDT', emoji: '✨' },
  'STX': { symbol: 'BINANCE:STXUSDT', name: 'Stacks', unit: 'USDT', emoji: '📚' },
  'STACKS': { symbol: 'BINANCE:STXUSDT', name: 'Stacks', unit: 'USDT', emoji: '📚' },
  'IMX': { symbol: 'BINANCE:IMXUSDT', name: 'Immutable X', unit: 'USDT', emoji: '🎮' },
  'IMMUTABLE': { symbol: 'BINANCE:IMXUSDT', name: 'Immutable X', unit: 'USDT', emoji: '🎮' },
  
  // Major company aliases (FR to symbol)
  'APPLE': { symbol: 'AAPL', name: 'Apple Inc.', unit: 'USD', emoji: '🍎' },
  'MICROSOFT': { symbol: 'MSFT', name: 'Microsoft Corp.', unit: 'USD', emoji: '🪟' },
  'GOOGLE': { symbol: 'GOOGL', name: 'Alphabet Inc.', unit: 'USD', emoji: '🔍' },
  'AMAZON': { symbol: 'AMZN', name: 'Amazon.com Inc.', unit: 'USD', emoji: '📦' },
  'TESLA': { symbol: 'TSLA', name: 'Tesla Inc.', unit: 'USD', emoji: '🚗' },
  'META': { symbol: 'META', name: 'Meta Platforms Inc.', unit: 'USD', emoji: '👤' },
  'FACEBOOK': { symbol: 'META', name: 'Meta Platforms Inc.', unit: 'USD', emoji: '👤' },
  'NVIDIA': { symbol: 'NVDA', name: 'NVIDIA Corp.', unit: 'USD', emoji: '🎮' },
  'NETFLIX': { symbol: 'NFLX', name: 'Netflix Inc.', unit: 'USD', emoji: '🎬' },
  'LVMH': { symbol: 'MC.PA', name: 'LVMH', unit: 'EUR', emoji: '👜' },
  'HERMES': { symbol: 'RMS.PA', name: 'Hermès', unit: 'EUR', emoji: '🧣' },
  'TOTAL': { symbol: 'TTE.PA', name: 'TotalEnergies', unit: 'EUR', emoji: '⛽' },
  'TOTALENERGIES': { symbol: 'TTE.PA', name: 'TotalEnergies', unit: 'EUR', emoji: '⛽' },
  'BNP': { symbol: 'BNP.PA', name: 'BNP Paribas', unit: 'EUR', emoji: '🏦' },
  'AIRBUS': { symbol: 'AIR.PA', name: 'Airbus SE', unit: 'EUR', emoji: '✈️' },
  'LOREAL': { symbol: 'OR.PA', name: "L'Oréal", unit: 'EUR', emoji: '💄' },
  'SANOFI': { symbol: 'SAN.PA', name: 'Sanofi', unit: 'EUR', emoji: '💊' },
  'ORANGE': { symbol: 'ORA.PA', name: 'Orange', unit: 'EUR', emoji: '📱' },
  'SOCIETE GENERALE': { symbol: 'GLE.PA', name: 'Société Générale', unit: 'EUR', emoji: '🏦' },
  'CREDIT AGRICOLE': { symbol: 'ACA.PA', name: 'Crédit Agricole', unit: 'EUR', emoji: '🏦' },
  'RENAULT': { symbol: 'RNO.PA', name: 'Renault', unit: 'EUR', emoji: '🚗' },
  'PEUGEOT': { symbol: 'STLAP.PA', name: 'Stellantis', unit: 'EUR', emoji: '🚗' },
  'STELLANTIS': { symbol: 'STLAP.PA', name: 'Stellantis', unit: 'EUR', emoji: '🚗' },
};

class StockMarketService {
  private cache = new Map<string, { data: any; expiry: number }>();
  private finnhubKey: string | null = null;
  private twelveDataKey: string | null = null;
  private alphaVantageKey: string | null = null;
  private requestCounts = { finnhub: 0, twelveData: 0, alphaVantage: 0 };
  private lastReset = Date.now();

  constructor() {
    this.loadApiKeys();
    setInterval(() => this.resetDailyCounters(), 60 * 60 * 1000);
  }

  private loadApiKeys() {
    this.finnhubKey = process.env.FINNHUB_API_KEY || null;
    this.twelveDataKey = process.env.TWELVE_DATA_API_KEY || null;
    this.alphaVantageKey = process.env.ALPHA_VANTAGE_API_KEY || null;

    const available = [];
    if (this.finnhubKey) available.push('Finnhub');
    if (this.twelveDataKey) available.push('Twelve Data');
    if (this.alphaVantageKey) available.push('Alpha Vantage');

    console.log(`[StockMarket] Providers available: ${available.length > 0 ? available.join(', ') : 'NONE - add API keys'}`);
  }

  private resetDailyCounters() {
    const now = Date.now();
    if (now - this.lastReset > 24 * 60 * 60 * 1000) {
      this.requestCounts = { finnhub: 0, twelveData: 0, alphaVantage: 0 };
      this.lastReset = now;
      console.log('[StockMarket] Daily request counters reset');
    }
  }

  private getCached<T>(key: string): T | null {
    const cached = this.cache.get(key);
    if (cached && Date.now() < cached.expiry) {
      return cached.data as T;
    }
    this.cache.delete(key);
    return null;
  }

  private setCache(key: string, data: any, ttl: number) {
    this.cache.set(key, { data, expiry: Date.now() + ttl });
  }

  private async fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ============ QUOTE METHODS ============

  async getQuote(symbol: string): Promise<StockQuote | null> {
    const upperSymbol = symbol.toUpperCase();
    
    // Check for special symbol mapping (commodities, crypto aliases, company names)
    const specialMapping = SPECIAL_SYMBOLS[upperSymbol];
    const mappedSymbol = specialMapping ? specialMapping.symbol : upperSymbol;
    
    const cacheKey = `quote:${mappedSymbol}`;
    const cached = this.getCached<StockQuote>(cacheKey);
    if (cached) return cached;

    const normalizedSymbol = mappedSymbol.replace('^', '');

    // Try Finnhub first with the mapped/original symbol
    if (this.finnhubKey) {
      try {
        const quote = await this.getFinnhubQuote(normalizedSymbol);
        if (quote) {
          this.setCache(cacheKey, quote, CACHE_TTL.quote);
          return quote;
        }
      } catch (e) {
        console.log(`[StockMarket] Finnhub quote failed for ${symbol}:`, (e as Error).message);
      }
    }

    // AUTO-DETECT CRYPTO: If not mapped and looks like a crypto ticker (2-10 chars, no dots)
    // Try various crypto exchange formats automatically
    if (!specialMapping && /^[A-Z0-9]{2,10}$/.test(upperSymbol) && !upperSymbol.includes('.')) {
      const cryptoFormats = [
        `BINANCE:${upperSymbol}USDT`,
        `BINANCE:${upperSymbol}USD`,
        `COINBASE:${upperSymbol}-USD`,
        `KRAKEN:${upperSymbol}USD`,
      ];
      
      console.log(`[StockMarket] Auto-detecting crypto for ${upperSymbol}, trying exchanges...`);
      
      for (const cryptoSymbol of cryptoFormats) {
        if (this.finnhubKey) {
          try {
            const quote = await this.getFinnhubQuote(cryptoSymbol);
            if (quote && quote.price > 0) {
              console.log(`[StockMarket] Found ${upperSymbol} on ${cryptoSymbol}`);
              // Update the quote to show original symbol for clarity
              quote.symbol = `${upperSymbol} (${cryptoSymbol.split(':')[0]})`;
              this.setCache(cacheKey, quote, CACHE_TTL.quote);
              // Cache the successful format for future lookups
              this.setCache(`crypto-format:${upperSymbol}`, cryptoSymbol, CACHE_TTL.profile);
              return quote;
            }
          } catch (e) {
            // Silent fail, try next format
          }
        }
      }
    }

    // Try Twelve Data
    if (this.twelveDataKey) {
      try {
        const quote = await this.getTwelveDataQuote(normalizedSymbol);
        if (quote) {
          this.setCache(cacheKey, quote, CACHE_TTL.quote);
          return quote;
        }
      } catch (e) {
        console.log(`[StockMarket] Twelve Data quote failed for ${symbol}:`, (e as Error).message);
      }
    }

    // Try Alpha Vantage
    if (this.alphaVantageKey) {
      try {
        const quote = await this.getAlphaVantageQuote(normalizedSymbol);
        if (quote) {
          this.setCache(cacheKey, quote, CACHE_TTL.quote);
          return quote;
        }
      } catch (e) {
        console.log(`[StockMarket] Alpha Vantage quote failed for ${symbol}:`, (e as Error).message);
      }
    }

    console.log(`[StockMarket] All providers failed for ${symbol}`);
    return null;
  }

  private async getFinnhubQuote(symbol: string): Promise<StockQuote | null> {
    const url = `${FINNHUB_BASE}/quote?symbol=${symbol}&token=${this.finnhubKey}`;
    const response = await this.fetchWithTimeout(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    if (!data.c || data.c === 0) return null;

    this.requestCounts.finnhub++;
    return {
      symbol,
      price: data.c,
      change: data.d || 0,
      changePercent: data.dp || 0,
      high: data.h || data.c,
      low: data.l || data.c,
      open: data.o || data.c,
      previousClose: data.pc || data.c,
      volume: 0,
      timestamp: data.t || Date.now(),
      provider: 'Finnhub'
    };
  }

  private async getTwelveDataQuote(symbol: string): Promise<StockQuote | null> {
    const url = `${TWELVE_DATA_BASE}/quote?symbol=${symbol}&apikey=${this.twelveDataKey}`;
    const response = await this.fetchWithTimeout(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    if (data.status === 'error' || !data.close) return null;

    this.requestCounts.twelveData++;
    return {
      symbol: data.symbol || symbol,
      name: data.name,
      price: parseFloat(data.close),
      change: parseFloat(data.change || 0),
      changePercent: parseFloat(data.percent_change || 0),
      high: parseFloat(data.high || data.close),
      low: parseFloat(data.low || data.close),
      open: parseFloat(data.open || data.close),
      previousClose: parseFloat(data.previous_close || data.close),
      volume: parseInt(data.volume || 0),
      timestamp: new Date(data.datetime || Date.now()).getTime(),
      provider: 'Twelve Data'
    };
  }

  private async getAlphaVantageQuote(symbol: string): Promise<StockQuote | null> {
    const url = `${ALPHA_VANTAGE_BASE}?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${this.alphaVantageKey}`;
    const response = await this.fetchWithTimeout(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    const quote = data['Global Quote'];
    if (!quote || !quote['05. price']) return null;

    this.requestCounts.alphaVantage++;
    return {
      symbol: quote['01. symbol'] || symbol,
      price: parseFloat(quote['05. price']),
      change: parseFloat(quote['09. change'] || 0),
      changePercent: parseFloat((quote['10. change percent'] || '0').replace('%', '')),
      high: parseFloat(quote['03. high'] || quote['05. price']),
      low: parseFloat(quote['04. low'] || quote['05. price']),
      open: parseFloat(quote['02. open'] || quote['05. price']),
      previousClose: parseFloat(quote['08. previous close'] || quote['05. price']),
      volume: parseInt(quote['06. volume'] || 0),
      timestamp: Date.now(),
      provider: 'Alpha Vantage'
    };
  }

  // ============ MULTIPLE QUOTES ============

  async getMultipleQuotes(symbols: string[]): Promise<StockQuote[]> {
    const quotes = await Promise.all(
      symbols.map(s => this.getQuote(s))
    );
    return quotes.filter((q): q is StockQuote => q !== null);
  }

  // ============ MARKET OVERVIEW ============

  async getMarketOverview(): Promise<{ indices: MarketIndex[]; topMovers?: any }> {
    const indices: MarketIndex[] = [];

    for (const index of MAJOR_INDICES) {
      const quote = await this.getQuote(index.finnhub);
      if (quote) {
        indices.push({
          symbol: index.symbol,
          name: index.name,
          value: quote.price,
          change: quote.change,
          changePercent: quote.changePercent
        });
      }
    }

    return { indices };
  }

  // ============ COMPANY PROFILE ============

  async getCompanyProfile(symbol: string): Promise<CompanyProfile | null> {
    const cacheKey = `profile:${symbol.toUpperCase()}`;
    const cached = this.getCached<CompanyProfile>(cacheKey);
    if (cached) return cached;

    if (this.finnhubKey) {
      try {
        const url = `${FINNHUB_BASE}/stock/profile2?symbol=${symbol}&token=${this.finnhubKey}`;
        const response = await this.fetchWithTimeout(url);
        if (response.ok) {
          const data = await response.json();
          if (data.name) {
            const profile: CompanyProfile = {
              symbol: data.ticker || symbol,
              name: data.name,
              description: undefined,
              sector: data.finnhubIndustry,
              industry: data.finnhubIndustry,
              country: data.country,
              currency: data.currency,
              exchange: data.exchange,
              marketCap: data.marketCapitalization ? data.marketCapitalization * 1000000 : undefined,
              sharesOutstanding: data.shareOutstanding ? data.shareOutstanding * 1000000 : undefined,
              logo: data.logo,
              weburl: data.weburl,
              ipo: data.ipo
            };
            this.setCache(cacheKey, profile, CACHE_TTL.profile);
            this.requestCounts.finnhub++;
            return profile;
          }
        }
      } catch (e) {
        console.log(`[StockMarket] Profile fetch failed:`, (e as Error).message);
      }
    }

    return null;
  }

  // ============ HISTORICAL DATA ============

  async getHistoricalData(
    symbol: string,
    interval: '1min' | '5min' | '15min' | '1h' | '1day' | '1week' | '1month' = '1day',
    outputSize: number = 100
  ): Promise<StockCandle[]> {
    const cacheKey = `history:${symbol}:${interval}:${outputSize}`;
    const cached = this.getCached<StockCandle[]>(cacheKey);
    if (cached) return cached;

    // Try Twelve Data first (best for historical)
    if (this.twelveDataKey) {
      try {
        const url = `${TWELVE_DATA_BASE}/time_series?symbol=${symbol}&interval=${interval}&outputsize=${outputSize}&apikey=${this.twelveDataKey}`;
        const response = await this.fetchWithTimeout(url);
        if (response.ok) {
          const data = await response.json();
          if (data.values && Array.isArray(data.values)) {
            const candles: StockCandle[] = data.values.map((v: any) => ({
              date: v.datetime,
              open: parseFloat(v.open),
              high: parseFloat(v.high),
              low: parseFloat(v.low),
              close: parseFloat(v.close),
              volume: parseInt(v.volume || 0)
            })).reverse();
            this.setCache(cacheKey, candles, CACHE_TTL.historical);
            this.requestCounts.twelveData++;
            return candles;
          }
        }
      } catch (e) {
        console.log(`[StockMarket] Historical data failed:`, (e as Error).message);
      }
    }

    // Fallback to Alpha Vantage
    if (this.alphaVantageKey && (interval === '1day' || interval === '1week' || interval === '1month')) {
      try {
        const func = interval === '1day' ? 'TIME_SERIES_DAILY' :
                     interval === '1week' ? 'TIME_SERIES_WEEKLY' : 'TIME_SERIES_MONTHLY';
        const url = `${ALPHA_VANTAGE_BASE}?function=${func}&symbol=${symbol}&outputsize=compact&apikey=${this.alphaVantageKey}`;
        const response = await this.fetchWithTimeout(url);
        if (response.ok) {
          const data = await response.json();
          const timeSeriesKey = Object.keys(data).find(k => k.includes('Time Series'));
          if (timeSeriesKey && data[timeSeriesKey]) {
            const timeSeries = data[timeSeriesKey];
            const candles: StockCandle[] = Object.entries(timeSeries)
              .slice(0, outputSize)
              .map(([date, values]: [string, any]) => ({
                date,
                open: parseFloat(values['1. open']),
                high: parseFloat(values['2. high']),
                low: parseFloat(values['3. low']),
                close: parseFloat(values['4. close']),
                volume: parseInt(values['5. volume'] || 0)
              }))
              .reverse();
            this.setCache(cacheKey, candles, CACHE_TTL.historical);
            this.requestCounts.alphaVantage++;
            return candles;
          }
        }
      } catch (e) {
        console.log(`[StockMarket] Alpha Vantage historical failed:`, (e as Error).message);
      }
    }

    return [];
  }

  // ============ NEWS ============

  async getNews(symbol?: string, limit: number = 10): Promise<StockNews[]> {
    const cacheKey = `news:${symbol || 'market'}:${limit}`;
    const cached = this.getCached<StockNews[]>(cacheKey);
    if (cached) return cached;

    if (this.finnhubKey) {
      try {
        const today = new Date();
        const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        const from = weekAgo.toISOString().split('T')[0];
        const to = today.toISOString().split('T')[0];

        let url: string;
        if (symbol) {
          url = `${FINNHUB_BASE}/company-news?symbol=${symbol}&from=${from}&to=${to}&token=${this.finnhubKey}`;
        } else {
          url = `${FINNHUB_BASE}/news?category=general&token=${this.finnhubKey}`;
        }

        const response = await this.fetchWithTimeout(url);
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data)) {
            const news: StockNews[] = data.slice(0, limit).map((n: any) => ({
              headline: n.headline,
              summary: n.summary,
              source: n.source,
              url: n.url,
              datetime: n.datetime * 1000,
              sentiment: undefined
            }));
            this.setCache(cacheKey, news, CACHE_TTL.news);
            this.requestCounts.finnhub++;
            return news;
          }
        }
      } catch (e) {
        console.log(`[StockMarket] News fetch failed:`, (e as Error).message);
      }
    }

    return [];
  }

  // ============ TECHNICAL INDICATORS ============

  async getTechnicalIndicators(symbol: string): Promise<TechnicalIndicator[]> {
    const cacheKey = `indicators:${symbol}`;
    const cached = this.getCached<TechnicalIndicator[]>(cacheKey);
    if (cached) return cached;

    const indicators: TechnicalIndicator[] = [];

    // Get RSI, MACD, SMA from Twelve Data
    if (this.twelveDataKey) {
      try {
        const [rsiRes, macdRes, smaRes] = await Promise.all([
          this.fetchWithTimeout(`${TWELVE_DATA_BASE}/rsi?symbol=${symbol}&interval=1day&time_period=14&apikey=${this.twelveDataKey}`),
          this.fetchWithTimeout(`${TWELVE_DATA_BASE}/macd?symbol=${symbol}&interval=1day&apikey=${this.twelveDataKey}`),
          this.fetchWithTimeout(`${TWELVE_DATA_BASE}/sma?symbol=${symbol}&interval=1day&time_period=50&apikey=${this.twelveDataKey}`)
        ]);

        if (rsiRes.ok) {
          const data = await rsiRes.json();
          if (data.values?.[0]) {
            const rsi = parseFloat(data.values[0].rsi);
            indicators.push({
              name: 'RSI (14)',
              value: rsi,
              signal: rsi > 70 ? 'sell' : rsi < 30 ? 'buy' : 'neutral',
              timestamp: Date.now()
            });
          }
        }

        if (macdRes.ok) {
          const data = await macdRes.json();
          if (data.values?.[0]) {
            const macd = parseFloat(data.values[0].macd);
            const signal = parseFloat(data.values[0].macd_signal);
            indicators.push({
              name: 'MACD',
              value: macd,
              signal: macd > signal ? 'buy' : macd < signal ? 'sell' : 'neutral',
              timestamp: Date.now()
            });
          }
        }

        if (smaRes.ok) {
          const data = await smaRes.json();
          if (data.values?.[0]) {
            indicators.push({
              name: 'SMA (50)',
              value: parseFloat(data.values[0].sma),
              signal: 'neutral',
              timestamp: Date.now()
            });
          }
        }

        this.requestCounts.twelveData += 3;
      } catch (e) {
        console.log(`[StockMarket] Indicators failed:`, (e as Error).message);
      }
    }

    if (indicators.length > 0) {
      this.setCache(cacheKey, indicators, CACHE_TTL.indicators);
    }

    return indicators;
  }

  // ============ ANALYST RECOMMENDATIONS ============

  async getRecommendations(symbol: string): Promise<AnalystRecommendation | null> {
    if (!this.finnhubKey) return null;

    const cacheKey = `recommendations:${symbol}`;
    const cached = this.getCached<AnalystRecommendation>(cacheKey);
    if (cached) return cached;

    try {
      const url = `${FINNHUB_BASE}/stock/recommendation?symbol=${symbol}&token=${this.finnhubKey}`;
      const response = await this.fetchWithTimeout(url);
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          const latest = data[0];
          const rec: AnalystRecommendation = {
            symbol: latest.symbol || symbol,
            buy: latest.buy || 0,
            hold: latest.hold || 0,
            sell: latest.sell || 0,
            strongBuy: latest.strongBuy || 0,
            strongSell: latest.strongSell || 0,
            period: latest.period
          };
          this.setCache(cacheKey, rec, CACHE_TTL.profile);
          this.requestCounts.finnhub++;
          return rec;
        }
      }
    } catch (e) {
      console.log(`[StockMarket] Recommendations failed:`, (e as Error).message);
    }

    return null;
  }

  // ============ EARNINGS CALENDAR ============

  async getEarningsCalendar(from?: string, to?: string): Promise<EarningsEvent[]> {
    if (!this.finnhubKey) return [];

    const today = new Date();
    const fromDate = from || today.toISOString().split('T')[0];
    const toDate = to || new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const cacheKey = `earnings:${fromDate}:${toDate}`;
    const cached = this.getCached<EarningsEvent[]>(cacheKey);
    if (cached) return cached;

    try {
      const url = `${FINNHUB_BASE}/calendar/earnings?from=${fromDate}&to=${toDate}&token=${this.finnhubKey}`;
      const response = await this.fetchWithTimeout(url);
      if (response.ok) {
        const data = await response.json();
        if (data.earningsCalendar && Array.isArray(data.earningsCalendar)) {
          const events: EarningsEvent[] = data.earningsCalendar.slice(0, 50).map((e: any) => ({
            symbol: e.symbol,
            date: e.date,
            epsEstimate: e.epsEstimate,
            epsActual: e.epsActual,
            revenueEstimate: e.revenueEstimate,
            revenueActual: e.revenueActual,
            hour: e.hour
          }));
          this.setCache(cacheKey, events, CACHE_TTL.news);
          this.requestCounts.finnhub++;
          return events;
        }
      }
    } catch (e) {
      console.log(`[StockMarket] Earnings calendar failed:`, (e as Error).message);
    }

    return [];
  }

  // ============ SEARCH ============

  async searchSymbol(query: string): Promise<SearchResult[]> {
    if (this.finnhubKey) {
      try {
        const url = `${FINNHUB_BASE}/search?q=${encodeURIComponent(query)}&token=${this.finnhubKey}`;
        const response = await this.fetchWithTimeout(url);
        if (response.ok) {
          const data = await response.json();
          if (data.result && Array.isArray(data.result)) {
            this.requestCounts.finnhub++;
            return data.result.slice(0, 10).map((r: any) => ({
              symbol: r.symbol,
              name: r.description,
              type: r.type,
              region: undefined,
              currency: undefined
            }));
          }
        }
      } catch (e) {
        console.log(`[StockMarket] Search failed:`, (e as Error).message);
      }
    }

    // Fallback to Alpha Vantage
    if (this.alphaVantageKey) {
      try {
        const url = `${ALPHA_VANTAGE_BASE}?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(query)}&apikey=${this.alphaVantageKey}`;
        const response = await this.fetchWithTimeout(url);
        if (response.ok) {
          const data = await response.json();
          if (data.bestMatches && Array.isArray(data.bestMatches)) {
            this.requestCounts.alphaVantage++;
            return data.bestMatches.slice(0, 10).map((r: any) => ({
              symbol: r['1. symbol'],
              name: r['2. name'],
              type: r['3. type'],
              region: r['4. region'],
              currency: r['8. currency']
            }));
          }
        }
      } catch (e) {
        console.log(`[StockMarket] Alpha Vantage search failed:`, (e as Error).message);
      }
    }

    return [];
  }

  // ============ FOREX ============

  async getForexRate(from: string, to: string): Promise<{ rate: number; provider: string } | null> {
    if (this.twelveDataKey) {
      try {
        const url = `${TWELVE_DATA_BASE}/exchange_rate?symbol=${from}/${to}&apikey=${this.twelveDataKey}`;
        const response = await this.fetchWithTimeout(url);
        if (response.ok) {
          const data = await response.json();
          if (data.rate) {
            this.requestCounts.twelveData++;
            return { rate: parseFloat(data.rate), provider: 'Twelve Data' };
          }
        }
      } catch (e) {
        console.log(`[StockMarket] Forex rate failed:`, (e as Error).message);
      }
    }

    // Fallback to Alpha Vantage
    if (this.alphaVantageKey) {
      try {
        const url = `${ALPHA_VANTAGE_BASE}?function=CURRENCY_EXCHANGE_RATE&from_currency=${from}&to_currency=${to}&apikey=${this.alphaVantageKey}`;
        const response = await this.fetchWithTimeout(url);
        if (response.ok) {
          const data = await response.json();
          const rateData = data['Realtime Currency Exchange Rate'];
          if (rateData && rateData['5. Exchange Rate']) {
            this.requestCounts.alphaVantage++;
            return { rate: parseFloat(rateData['5. Exchange Rate']), provider: 'Alpha Vantage' };
          }
        }
      } catch (e) {
        console.log(`[StockMarket] Alpha Vantage forex failed:`, (e as Error).message);
      }
    }

    return null;
  }

  // ============ CRYPTO ============

  async getCryptoPrice(symbol: string): Promise<StockQuote | null> {
    const cryptoSymbol = symbol.toUpperCase().replace('/', '');

    if (this.twelveDataKey) {
      try {
        const url = `${TWELVE_DATA_BASE}/price?symbol=${cryptoSymbol}&apikey=${this.twelveDataKey}`;
        const response = await this.fetchWithTimeout(url);
        if (response.ok) {
          const data = await response.json();
          if (data.price) {
            this.requestCounts.twelveData++;
            return {
              symbol: cryptoSymbol,
              price: parseFloat(data.price),
              change: 0,
              changePercent: 0,
              high: parseFloat(data.price),
              low: parseFloat(data.price),
              open: parseFloat(data.price),
              previousClose: parseFloat(data.price),
              volume: 0,
              timestamp: Date.now(),
              provider: 'Twelve Data'
            };
          }
        }
      } catch (e) {
        console.log(`[StockMarket] Crypto price failed:`, (e as Error).message);
      }
    }

    return null;
  }

  // ============ STATUS ============

  getStatus(): { 
    providers: { name: string; available: boolean; requests: number }[];
    cacheSize: number;
  } {
    return {
      providers: [
        { name: 'Finnhub', available: !!this.finnhubKey, requests: this.requestCounts.finnhub },
        { name: 'Twelve Data', available: !!this.twelveDataKey, requests: this.requestCounts.twelveData },
        { name: 'Alpha Vantage', available: !!this.alphaVantageKey, requests: this.requestCounts.alphaVantage }
      ],
      cacheSize: this.cache.size
    };
  }

  // ============ ULYSSE INTEGRATION ============

  /**
   * Helper to format a quote with proper styling based on special symbol info
   */
  private formatQuoteResponse(quote: StockQuote, specialInfo?: { name: string; unit: string; emoji: string }): string {
    const direction = quote.change >= 0 ? '📈' : '📉';
    const sign = quote.change >= 0 ? '+' : '';
    const emoji = specialInfo?.emoji || direction;
    const name = specialInfo?.name || quote.symbol;
    const unit = specialInfo?.unit || (quote.provider === 'Finnhub' ? 'USD' : '');
    
    return `${emoji} **${name}** : ${quote.price.toFixed(2)} ${unit}\n` +
           `Variation: ${sign}${quote.change.toFixed(2)} (${sign}${quote.changePercent.toFixed(2)}%)\n` +
           `H: ${quote.high.toFixed(2)} | L: ${quote.low.toFixed(2)} | Vol: ${quote.volume.toLocaleString()}\n` +
           `_Source: ${quote.provider}_`;
  }

  /**
   * Get gold price with formatted response
   */
  async getGoldPrice(): Promise<string> {
    const quote = await this.getQuote('XAUUSD');
    if (quote) {
      const info = SPECIAL_SYMBOLS['OR'];
      return this.formatQuoteResponse(quote, info);
    }
    // Fallback to GLD ETF
    const gldQuote = await this.getQuote('GLD');
    if (gldQuote) {
      return `🪙 **Or (via ETF GLD)** : ${gldQuote.price.toFixed(2)} USD\n` +
             `Variation: ${gldQuote.change >= 0 ? '+' : ''}${gldQuote.change.toFixed(2)} (${gldQuote.changePercent.toFixed(2)}%)\n` +
             `_Source: ${gldQuote.provider} (ETF proxy)_`;
    }
    return "Impossible de récupérer le cours de l'or actuellement.";
  }

  /**
   * Get silver price with formatted response
   */
  async getSilverPrice(): Promise<string> {
    const quote = await this.getQuote('XAGUSD');
    if (quote) {
      const info = SPECIAL_SYMBOLS['ARGENT'];
      return this.formatQuoteResponse(quote, info);
    }
    const slvQuote = await this.getQuote('SLV');
    if (slvQuote) {
      return `🥈 **Argent (via ETF SLV)** : ${slvQuote.price.toFixed(2)} USD\n` +
             `Variation: ${slvQuote.change >= 0 ? '+' : ''}${slvQuote.change.toFixed(2)} (${slvQuote.changePercent.toFixed(2)}%)\n` +
             `_Source: ${slvQuote.provider} (ETF proxy)_`;
    }
    return "Impossible de récupérer le cours de l'argent actuellement.";
  }

  /**
   * Get oil price with formatted response
   */
  async getOilPrice(): Promise<string> {
    const quote = await this.getQuote('USO');
    if (quote) {
      return `🛢️ **Pétrole (via ETF USO)** : ${quote.price.toFixed(2)} USD\n` +
             `Variation: ${quote.change >= 0 ? '+' : ''}${quote.change.toFixed(2)} (${quote.changePercent.toFixed(2)}%)\n` +
             `_Source: ${quote.provider} (ETF proxy)_`;
    }
    return "Impossible de récupérer le cours du pétrole actuellement.";
  }

  async processNaturalQuery(query: string): Promise<string> {
    const q = query.toLowerCase();

    // ============ COMMODITIES - GOLD / OR ============
    if (q.includes("cours de l'or") || q.includes("cours de l or") || q.includes("prix de l'or") || 
        q.includes("prix de l or") || q.includes("gold price") || q.includes("cours or") ||
        q.includes("cours du gold") || q.includes("combien vaut l'or") || q.includes("combien vaut l or") ||
        q.includes("valeur de l'or") || q.includes("once d'or") || /\b(or|gold|xau)\s*(spot|prix|cours)?/i.test(q)) {
      return await this.getGoldPrice();
    }

    // ============ COMMODITIES - SILVER / ARGENT ============
    if (q.includes("cours de l'argent") || q.includes("cours de l argent") || q.includes("prix de l'argent") ||
        q.includes("prix de l argent") || q.includes("silver price") || q.includes("cours argent") ||
        q.includes("combien vaut l'argent") || q.includes("valeur de l'argent") || /\b(argent|silver|xag)\s*(spot|prix|cours)?/i.test(q)) {
      return await this.getSilverPrice();
    }

    // ============ COMMODITIES - OIL / PETROLE ============
    if (q.includes("cours du pétrole") || q.includes("cours du petrole") || q.includes("prix du pétrole") ||
        q.includes("prix du petrole") || q.includes("oil price") || q.includes("cours petrole") ||
        q.includes("cours pétrole") || q.includes("baril") || q.includes("wti") || q.includes("brent") ||
        /\b(pétrole|petrole|oil)\s*(prix|cours)?/i.test(q)) {
      return await this.getOilPrice();
    }

    // ============ CRYPTO - Specific detection ============
    const cryptoPatterns: Record<string, string> = {
      'bitcoin': 'BTC', 'btc': 'BTC',
      'ethereum': 'ETH', 'eth': 'ETH', 'ether': 'ETH',
      'solana': 'SOL', 'sol': 'SOL',
      'ripple': 'XRP', 'xrp': 'XRP',
      'cardano': 'ADA', 'ada': 'ADA',
      'dogecoin': 'DOGE', 'doge': 'DOGE',
      'polkadot': 'DOT', 'dot': 'DOT',
      'avalanche': 'AVAX', 'avax': 'AVAX',
      'chainlink': 'LINK', 'link': 'LINK',
      'litecoin': 'LTC', 'ltc': 'LTC',
    };
    
    for (const [keyword, symbol] of Object.entries(cryptoPatterns)) {
      if (q.includes(keyword) || new RegExp(`\\b${keyword}\\b`, 'i').test(q)) {
        const quote = await this.getQuote(symbol);
        if (quote) {
          const info = SPECIAL_SYMBOLS[symbol];
          return this.formatQuoteResponse(quote, info);
        }
      }
    }

    // ============ FRENCH COMPANIES - Natural language detection ============
    const frenchCompanyPatterns: Record<string, string> = {
      'lvmh': 'LVMH', 'louis vuitton': 'LVMH',
      'hermès': 'HERMES', 'hermes': 'HERMES',
      'total': 'TOTAL', 'totalenergies': 'TOTALENERGIES',
      'bnp': 'BNP', 'bnp paribas': 'BNP',
      'airbus': 'AIRBUS',
      "l'oréal": 'LOREAL', 'loreal': 'LOREAL', "l'oreal": 'LOREAL',
      'sanofi': 'SANOFI',
      'orange': 'ORANGE',
      'société générale': 'SOCIETE GENERALE', 'socgen': 'SOCIETE GENERALE',
      'crédit agricole': 'CREDIT AGRICOLE', 'credit agricole': 'CREDIT AGRICOLE',
      'renault': 'RENAULT',
      'peugeot': 'PEUGEOT',
      'stellantis': 'STELLANTIS',
    };
    
    for (const [keyword, alias] of Object.entries(frenchCompanyPatterns)) {
      if (q.includes(keyword)) {
        const quote = await this.getQuote(alias);
        if (quote) {
          const info = SPECIAL_SYMBOLS[alias];
          return this.formatQuoteResponse(quote, info);
        }
      }
    }

    // ============ US TECH COMPANIES - Natural language detection ============
    const usTechPatterns: Record<string, string> = {
      'apple': 'APPLE', 'iphone': 'APPLE',
      'microsoft': 'MICROSOFT', 'windows': 'MICROSOFT',
      'google': 'GOOGLE', 'alphabet': 'GOOGLE',
      'amazon': 'AMAZON',
      'tesla': 'TESLA', 'elon musk': 'TESLA',
      'meta': 'META', 'facebook': 'FACEBOOK', 'instagram': 'META',
      'nvidia': 'NVIDIA',
      'netflix': 'NETFLIX',
    };
    
    for (const [keyword, alias] of Object.entries(usTechPatterns)) {
      if (q.includes(keyword)) {
        const quote = await this.getQuote(alias);
        if (quote) {
          const info = SPECIAL_SYMBOLS[alias];
          return this.formatQuoteResponse(quote, info);
        }
      }
    }

    // ============ GENERIC STOCK QUERIES ============
    // Pattern matching for common stock queries
    const symbolMatch = q.match(/(?:cours|prix|cote|cotation|action|stock)\s+(?:de\s+l[' ]?)?(?:de\s+)?(\w+)/i) ||
                       q.match(/combien\s+(?:vaut|coute|coûte)\s+(?:l[' ]?)?(\w+)/i) ||
                       q.match(/(\w+)\s+(?:stock|share|action)/i) ||
                       q.match(/^(\w{1,5})$/);

    if (symbolMatch) {
      const symbol = symbolMatch[1].toUpperCase();
      const quote = await this.getQuote(symbol);
      if (quote) {
        const specialInfo = SPECIAL_SYMBOLS[symbol];
        return this.formatQuoteResponse(quote, specialInfo);
      }
    }

    // ============ FOREX QUERIES ============
    const forexMatch = q.match(/(?:taux|rate|change|cours)\s+(\w{3})\s*(?:\/|en|to|vers)\s*(\w{3})/i) ||
                       q.match(/(\w{3})\s*(?:\/|vs)\s*(\w{3})/i);
    if (forexMatch) {
      const rate = await this.getForexRate(forexMatch[1].toUpperCase(), forexMatch[2].toUpperCase());
      if (rate) {
        return `💱 **${forexMatch[1].toUpperCase()}/${forexMatch[2].toUpperCase()}** : ${rate.rate.toFixed(4)}\n_Source: ${rate.provider}_`;
      }
    }

    // ============ MARKET OVERVIEW ============
    if (q.includes('marché') || q.includes('market') || q.includes('indices') || 
        q.includes('bourse') || q.includes('cac 40') || q.includes('dow') || q.includes('nasdaq') || q.includes('s&p')) {
      const overview = await this.getMarketOverview();
      if (overview.indices.length > 0) {
        const lines = overview.indices.map(i => {
          const dir = i.change >= 0 ? '🟢' : '🔴';
          const sign = i.change >= 0 ? '+' : '';
          return `${dir} ${i.name}: ${i.value.toFixed(2)} (${sign}${i.changePercent.toFixed(2)}%)`;
        });
        return `📊 **Indices majeurs**\n${lines.join('\n')}`;
      }
    }

    return "Je n'ai pas pu interpréter ta requête bourse. Exemples: 'cours de l'or', 'prix bitcoin', 'action Apple', 'taux EUR/USD', 'indices marché'";
  }
}

export const stockMarketService = new StockMarketService();
