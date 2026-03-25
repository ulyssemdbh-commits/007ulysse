/**
 * TradingAlertsService - Smart Alerts System
 * 
 * Manages intelligent trading alerts based on:
 * - Price levels (support/resistance)
 * - Technical indicators (RSI overbought/oversold)
 * - News events
 * - Watchlist monitoring
 */

import { stockMarketService } from './stockMarketService';
import { tradingAnalysisService } from './tradingAnalysisService';
import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import { stockWatchlists, stockAlerts, stockQuoteCache, stockPortfolio } from "@shared/schema";

// ============ TYPES ============

export type AlertType = 'price_above' | 'price_below' | 'rsi_overbought' | 'rsi_oversold' | 
                        'support_break' | 'resistance_break' | 'news_alert' | 'custom';
export type AlertStatus = 'active' | 'triggered' | 'expired' | 'cancelled';
export type AlertPriority = 'low' | 'medium' | 'high' | 'critical';

export interface TradingAlert {
  id: string;
  userId: string;
  symbol: string;
  type: AlertType;
  condition: {
    operator: '>' | '<' | '>=' | '<=' | '==' | 'crosses_above' | 'crosses_below';
    value: number;
    indicator?: 'price' | 'rsi' | 'macd' | 'volume';
  };
  status: AlertStatus;
  priority: AlertPriority;
  message: string;
  createdAt: Date;
  triggeredAt?: Date;
  expiresAt?: Date;
  notificationSent: boolean;
  metadata?: Record<string, any>;
}

export interface AlertNotification {
  alertId: string;
  symbol: string;
  type: AlertType;
  message: string;
  currentValue: number;
  targetValue: number;
  timestamp: Date;
  priority: AlertPriority;
}

// ============ SERVICE ============

class TradingAlertsService {
  private alerts = new Map<string, TradingAlert>();
  private watchlist = new Set<string>();
  private checkInterval: NodeJS.Timeout | null = null;
  private notifications: AlertNotification[] = [];
  private lastPrices = new Map<string, number>();
  
  constructor() {
    // Start checking alerts every 5 minutes
    this.startMonitoring();
  }

  // ============ ALERT MANAGEMENT ============
  
  createAlert(params: {
    userId: string;
    symbol: string;
    type: AlertType;
    operator: TradingAlert['condition']['operator'];
    value: number;
    indicator?: TradingAlert['condition']['indicator'];
    priority?: AlertPriority;
    message?: string;
    expiresInDays?: number;
  }): TradingAlert {
    const id = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const defaultMessage = this.generateDefaultMessage(params.symbol, params.type, params.operator, params.value);
    
    const alert: TradingAlert = {
      id,
      userId: params.userId,
      symbol: params.symbol.toUpperCase(),
      type: params.type,
      condition: {
        operator: params.operator,
        value: params.value,
        indicator: params.indicator || 'price',
      },
      status: 'active',
      priority: params.priority || 'medium',
      message: params.message || defaultMessage,
      createdAt: new Date(),
      expiresAt: params.expiresInDays 
        ? new Date(Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000)
        : undefined,
      notificationSent: false,
    };
    
    this.alerts.set(id, alert);
    this.watchlist.add(params.symbol.toUpperCase());
    
    console.log(`[TradingAlerts] Created alert ${id} for ${params.symbol}: ${alert.message}`);
    
    return alert;
  }
  
  private generateDefaultMessage(symbol: string, type: AlertType, operator: string, value: number): string {
    switch (type) {
      case 'price_above':
        return `${symbol} dépasse ${value}`;
      case 'price_below':
        return `${symbol} passe sous ${value}`;
      case 'rsi_overbought':
        return `${symbol} RSI en zone de surachat (>${value})`;
      case 'rsi_oversold':
        return `${symbol} RSI en zone de survente (<${value})`;
      case 'support_break':
        return `${symbol} casse le support à ${value}`;
      case 'resistance_break':
        return `${symbol} casse la résistance à ${value}`;
      default:
        return `Alerte ${symbol}: condition atteinte`;
    }
  }
  
  getAlert(id: string): TradingAlert | undefined {
    return this.alerts.get(id);
  }
  
  getAlertsByUser(userId: string): TradingAlert[] {
    return Array.from(this.alerts.values())
      .filter(a => a.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  
  getActiveAlerts(): TradingAlert[] {
    return Array.from(this.alerts.values())
      .filter(a => a.status === 'active');
  }
  
  cancelAlert(id: string): boolean {
    const alert = this.alerts.get(id);
    if (alert) {
      alert.status = 'cancelled';
      this.alerts.set(id, alert);
      console.log(`[TradingAlerts] Cancelled alert ${id}`);
      return true;
    }
    return false;
  }
  
  deleteAlert(id: string): boolean {
    return this.alerts.delete(id);
  }

  // ============ QUICK ALERT CREATORS ============
  
  createPriceAlert(userId: string, symbol: string, targetPrice: number, direction: 'above' | 'below'): TradingAlert {
    return this.createAlert({
      userId,
      symbol,
      type: direction === 'above' ? 'price_above' : 'price_below',
      operator: direction === 'above' ? '>=' : '<=',
      value: targetPrice,
      indicator: 'price',
      priority: 'medium',
    });
  }
  
  createRSIAlert(userId: string, symbol: string, threshold: number, condition: 'overbought' | 'oversold'): TradingAlert {
    return this.createAlert({
      userId,
      symbol,
      type: condition === 'overbought' ? 'rsi_overbought' : 'rsi_oversold',
      operator: condition === 'overbought' ? '>=' : '<=',
      value: threshold,
      indicator: 'rsi' as any,
      priority: 'high',
    });
  }
  
  createSupportResistanceAlert(userId: string, symbol: string, level: number, type: 'support' | 'resistance'): TradingAlert {
    return this.createAlert({
      userId,
      symbol,
      type: type === 'support' ? 'support_break' : 'resistance_break',
      operator: type === 'support' ? '<=' : '>=',
      value: level,
      indicator: 'price',
      priority: 'high',
    });
  }

  // ============ MONITORING ============
  
  startMonitoring(): void {
    if (this.checkInterval) return;
    
    // Check alerts every 5 minutes
    this.checkInterval = setInterval(() => {
      this.checkAllAlerts();
    }, 5 * 60 * 1000);
    
    console.log('[TradingAlerts] Monitoring started (5-minute intervals)');
  }
  
  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log('[TradingAlerts] Monitoring stopped');
    }
  }
  
  async checkAllAlerts(): Promise<AlertNotification[]> {
    const activeAlerts = this.getActiveAlerts();
    const triggeredNotifications: AlertNotification[] = [];
    
    // Group alerts by symbol for efficient API calls
    const alertsBySymbol = new Map<string, TradingAlert[]>();
    for (const alert of activeAlerts) {
      const existing = alertsBySymbol.get(alert.symbol) || [];
      existing.push(alert);
      alertsBySymbol.set(alert.symbol, existing);
    }
    
    // Check each symbol
    for (const [symbol, symbolAlerts] of alertsBySymbol) {
      try {
        const quote = await stockMarketService.getQuote(symbol);
        if (!quote) continue;
        
        const currentPrice = quote.price;
        const previousPrice = this.lastPrices.get(symbol);
        this.lastPrices.set(symbol, currentPrice);
        
        // Get technical indicators if needed
        let indicators: any = null;
        const needsIndicators = symbolAlerts.some(a => 
          a.condition.indicator !== 'price'
        );
        if (needsIndicators) {
          indicators = await stockMarketService.getTechnicalIndicators(symbol);
        }
        
        for (const alert of symbolAlerts) {
          // Check expiration
          if (alert.expiresAt && new Date() > alert.expiresAt) {
            alert.status = 'expired';
            this.alerts.set(alert.id, alert);
            continue;
          }
          
          // Get current value based on indicator
          let currentValue = currentPrice;
          if (alert.condition.indicator === 'rsi' && indicators?.rsi) {
            currentValue = indicators.rsi;
          }
          
          // Check condition
          const triggered = this.evaluateCondition(
            currentValue,
            alert.condition.operator,
            alert.condition.value,
            previousPrice
          );
          
          if (triggered) {
            alert.status = 'triggered';
            alert.triggeredAt = new Date();
            this.alerts.set(alert.id, alert);
            
            const notification: AlertNotification = {
              alertId: alert.id,
              symbol: alert.symbol,
              type: alert.type,
              message: alert.message,
              currentValue,
              targetValue: alert.condition.value,
              timestamp: new Date(),
              priority: alert.priority,
            };
            
            triggeredNotifications.push(notification);
            this.notifications.push(notification);
            
            console.log(`[TradingAlerts] TRIGGERED: ${alert.message} (${currentValue})`);
          }
        }
      } catch (error) {
        console.error(`[TradingAlerts] Error checking ${symbol}:`, error);
      }
    }
    
    return triggeredNotifications;
  }
  
  private evaluateCondition(
    current: number,
    operator: TradingAlert['condition']['operator'],
    target: number,
    previous?: number
  ): boolean {
    switch (operator) {
      case '>': return current > target;
      case '<': return current < target;
      case '>=': return current >= target;
      case '<=': return current <= target;
      case '==': return Math.abs(current - target) < 0.01;
      case 'crosses_above':
        return previous !== undefined && previous < target && current >= target;
      case 'crosses_below':
        return previous !== undefined && previous > target && current <= target;
      default:
        return false;
    }
  }

  // ============ NOTIFICATIONS ============
  
  getRecentNotifications(limit: number = 20): AlertNotification[] {
    return this.notifications
      .slice(-limit)
      .reverse();
  }
  
  clearNotifications(): void {
    this.notifications = [];
  }

  // ============ WATCHLIST (DB-persisted) ============
  
  async addToWatchlist(symbol: string): Promise<void> {
    this.watchlist.add(symbol.toUpperCase());
    await this.persistWatchlistToDB();
  }
  
  async removeFromWatchlist(symbol: string): Promise<void> {
    this.watchlist.delete(symbol.toUpperCase());
    await this.persistWatchlistToDB();
  }
  
  getWatchlist(): string[] {
    return Array.from(this.watchlist);
  }

  private async persistWatchlistToDB(): Promise<void> {
    try {
      const symbols = Array.from(this.watchlist);
      const existing = await db.select().from(stockWatchlists).where(and(eq(stockWatchlists.userId, 1), eq(stockWatchlists.isDefault, true)));
      if (existing.length > 0) {
        await db.update(stockWatchlists).set({ symbols, updatedAt: new Date() }).where(eq(stockWatchlists.id, existing[0].id));
      } else {
        await db.insert(stockWatchlists).values({ userId: 1, name: "Ma Watchlist", symbols, isDefault: true });
      }
    } catch (e) {}
  }

  async loadWatchlistFromDB(): Promise<void> {
    try {
      const [wl] = await db.select().from(stockWatchlists).where(and(eq(stockWatchlists.userId, 1), eq(stockWatchlists.isDefault, true)));
      if (wl?.symbols?.length) {
        for (const s of wl.symbols) this.watchlist.add(s);
        console.log(`[TradingAlerts] Loaded ${wl.symbols.length} watchlist symbols from DB`);
      }
    } catch (e) {}
  }

  async syncAlertsToDB(): Promise<void> {
    try {
      for (const [, alert] of this.alerts) {
        const existing = await db.select().from(stockAlerts).where(eq(stockAlerts.symbol, alert.symbol));
        if (existing.length === 0) {
          await db.insert(stockAlerts).values({
            userId: parseInt(alert.userId) || 1,
            symbol: alert.symbol,
            alertType: alert.type.includes("above") ? "price_above" : alert.type.includes("below") ? "price_below" : "percent_change",
            targetValue: alert.condition.value,
            currentValue: this.lastPrices.get(alert.symbol) || null,
            isTriggered: alert.status === "triggered",
            triggeredAt: alert.triggeredAt || null,
          });
        }
      }
    } catch (e) {}
  }

  async cacheQuote(symbol: string, data: { price: number; change?: number; changePercent?: number; high?: number; low?: number; open?: number; previousClose?: number; volume?: number; name?: string }): Promise<void> {
    try {
      const existing = await db.select().from(stockQuoteCache).where(eq(stockQuoteCache.symbol, symbol));
      if (existing.length > 0) {
        await db.update(stockQuoteCache).set({ ...data, fetchedAt: new Date() }).where(eq(stockQuoteCache.id, existing[0].id));
      } else {
        await db.insert(stockQuoteCache).values({ symbol, ...data, provider: "api" });
      }
    } catch (e) {}
  }

  // ============ NATURAL LANGUAGE PARSING ============
  
  parseAlertFromText(userId: string, text: string): TradingAlert | null {
    const lowerText = text.toLowerCase();
    
    // Pattern: "préviens-moi si TSLA passe sous 150"
    // Pattern: "alerte si bitcoin dépasse 100000"
    // Pattern: "notifie-moi quand AAPL atteint 200"
    
    const patterns = [
      // French patterns
      /(?:préviens|previens|alerte|notifi[e|é]).*?(?:si|quand)\s+(\w+)\s+(?:passe|descend)\s+(?:sous|en dessous de?)\s+([\d.,]+)/i,
      /(?:préviens|previens|alerte|notifi[e|é]).*?(?:si|quand)\s+(\w+)\s+(?:passe|monte|dépasse|depasse)\s+(?:au[- ]?dessus de?|à|a)\s+([\d.,]+)/i,
      /(?:préviens|previens|alerte|notifi[e|é]).*?(?:si|quand)\s+(\w+)\s+(?:atteint|arrive à?|touche)\s+([\d.,]+)/i,
      // English patterns
      /(?:alert|notify|tell)\s+me.*?(?:if|when)\s+(\w+)\s+(?:goes|drops|falls)\s+(?:below|under)\s+([\d.,]+)/i,
      /(?:alert|notify|tell)\s+me.*?(?:if|when)\s+(\w+)\s+(?:goes|rises|breaks)\s+(?:above|over)\s+([\d.,]+)/i,
      /(?:alert|notify|tell)\s+me.*?(?:if|when)\s+(\w+)\s+(?:reaches|hits)\s+([\d.,]+)/i,
    ];
    
    for (const pattern of patterns) {
      const match = lowerText.match(pattern);
      if (match) {
        const symbol = match[1].toUpperCase();
        const value = parseFloat(match[2].replace(',', '.'));
        
        // Determine direction from context
        const isBelow = /sous|below|under|descend|drops|falls/i.test(lowerText);
        
        return this.createPriceAlert(userId, symbol, value, isBelow ? 'below' : 'above');
      }
    }
    
    return null;
  }

  // ============ STATUS ============
  
  getStatus(): {
    activeAlerts: number;
    triggeredToday: number;
    watchlistSize: number;
    isMonitoring: boolean;
  } {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const triggeredToday = Array.from(this.alerts.values())
      .filter(a => a.triggeredAt && a.triggeredAt >= today)
      .length;
    
    return {
      activeAlerts: this.getActiveAlerts().length,
      triggeredToday,
      watchlistSize: this.watchlist.size,
      isMonitoring: this.checkInterval !== null,
    };
  }
}

export const tradingAlertsService = new TradingAlertsService();
