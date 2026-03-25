interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  cooldownMs: number;
}

interface RateLimitEntry {
  count: number;
  windowStart: number;
  cooldownUntil: number;
  blockedCount: number;
}

interface DomainStats {
  domain: string;
  totalRequests: number;
  successCount: number;
  failCount: number;
  avgResponseTime: number;
  lastRequest: number;
  blockedReason?: string;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxRequests: 10,
  windowMs: 60 * 1000,
  cooldownMs: 5 * 60 * 1000
};

const DOMAIN_CONFIGS: Record<string, RateLimitConfig> = {
  "parionssport.fdj.fr": { maxRequests: 5, windowMs: 60000, cooldownMs: 300000 },
  "winamax.fr": { maxRequests: 5, windowMs: 60000, cooldownMs: 300000 },
  "betclic.fr": { maxRequests: 5, windowMs: 60000, cooldownMs: 300000 },
  "lequipe.fr": { maxRequests: 20, windowMs: 60000, cooldownMs: 60000 },
  "flashscore.fr": { maxRequests: 15, windowMs: 60000, cooldownMs: 120000 },
  "sofascore.com": { maxRequests: 15, windowMs: 60000, cooldownMs: 120000 },
  "api-football.com": { maxRequests: 30, windowMs: 60000, cooldownMs: 60000 }
};

class RateLimiterService {
  private domainLimits: Map<string, RateLimitEntry> = new Map();
  private userLimits: Map<string, RateLimitEntry> = new Map();
  private domainStats: Map<string, DomainStats> = new Map();
  private blockedDomains: Set<string> = new Set();
  
  private getConfig(domain: string): RateLimitConfig {
    for (const [configDomain, config] of Object.entries(DOMAIN_CONFIGS)) {
      if (domain.includes(configDomain)) {
        return config;
      }
    }
    return DEFAULT_CONFIG;
  }
  
  private getDomain(url: string): string {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return url;
    }
  }
  
  private getOrCreateEntry(map: Map<string, RateLimitEntry>, key: string): RateLimitEntry {
    let entry = map.get(key);
    if (!entry) {
      entry = { count: 0, windowStart: Date.now(), cooldownUntil: 0, blockedCount: 0 };
      map.set(key, entry);
    }
    return entry;
  }
  
  checkDomainLimit(url: string): { allowed: boolean; retryAfterMs?: number; reason?: string } {
    const domain = this.getDomain(url);
    const config = this.getConfig(domain);
    const entry = this.getOrCreateEntry(this.domainLimits, domain);
    const now = Date.now();
    
    if (this.blockedDomains.has(domain)) {
      return { allowed: false, reason: "Domain temporarily blocked due to repeated failures" };
    }
    
    if (now < entry.cooldownUntil) {
      return { 
        allowed: false, 
        retryAfterMs: entry.cooldownUntil - now,
        reason: `Cooldown active, retry in ${Math.ceil((entry.cooldownUntil - now) / 1000)}s`
      };
    }
    
    if (now - entry.windowStart > config.windowMs) {
      entry.count = 0;
      entry.windowStart = now;
    }
    
    if (entry.count >= config.maxRequests) {
      entry.cooldownUntil = now + config.cooldownMs;
      return {
        allowed: false,
        retryAfterMs: config.cooldownMs,
        reason: `Rate limit exceeded (${config.maxRequests}/${config.windowMs}ms)`
      };
    }
    
    return { allowed: true };
  }
  
  checkUserLimit(userId: string, hourlyLimit: number = 50): { allowed: boolean; remaining: number } {
    const entry = this.getOrCreateEntry(this.userLimits, userId);
    const now = Date.now();
    const windowMs = 60 * 60 * 1000;
    
    if (now - entry.windowStart > windowMs) {
      entry.count = 0;
      entry.windowStart = now;
    }
    
    if (entry.count >= hourlyLimit) {
      return { allowed: false, remaining: 0 };
    }
    
    return { allowed: true, remaining: hourlyLimit - entry.count };
  }
  
  recordRequest(url: string, userId?: string): void {
    const domain = this.getDomain(url);
    const domainEntry = this.getOrCreateEntry(this.domainLimits, domain);
    domainEntry.count++;
    
    if (userId) {
      const userEntry = this.getOrCreateEntry(this.userLimits, userId);
      userEntry.count++;
    }
    
    let stats = this.domainStats.get(domain);
    if (!stats) {
      stats = { domain, totalRequests: 0, successCount: 0, failCount: 0, avgResponseTime: 0, lastRequest: 0 };
      this.domainStats.set(domain, stats);
    }
    stats.totalRequests++;
    stats.lastRequest = Date.now();
  }
  
  recordSuccess(url: string, responseTimeMs: number): void {
    const domain = this.getDomain(url);
    const stats = this.domainStats.get(domain);
    if (stats) {
      stats.successCount++;
      const totalTime = stats.avgResponseTime * (stats.successCount - 1) + responseTimeMs;
      stats.avgResponseTime = totalTime / stats.successCount;
    }
    
    const entry = this.domainLimits.get(domain);
    if (entry && entry.blockedCount > 0) {
      entry.blockedCount = Math.max(0, entry.blockedCount - 1);
    }
  }
  
  recordFailure(url: string, reason: string): void {
    const domain = this.getDomain(url);
    const stats = this.domainStats.get(domain);
    if (stats) {
      stats.failCount++;
      stats.blockedReason = reason;
    }
    
    const entry = this.getOrCreateEntry(this.domainLimits, domain);
    entry.blockedCount++;
    
    if (entry.blockedCount >= 5) {
      this.blockedDomains.add(domain);
      console.warn(`[RateLimiter] Domain ${domain} blocked due to ${entry.blockedCount} failures`);
      
      setTimeout(() => {
        this.blockedDomains.delete(domain);
        entry.blockedCount = 0;
        console.log(`[RateLimiter] Domain ${domain} unblocked after cooldown`);
      }, 30 * 60 * 1000);
    }
  }
  
  getStats(): {
    domains: DomainStats[];
    blockedDomains: string[];
    totalRequests: number;
    successRate: number;
  } {
    const domains = Array.from(this.domainStats.values());
    const totalRequests = domains.reduce((sum, d) => sum + d.totalRequests, 0);
    const totalSuccess = domains.reduce((sum, d) => sum + d.successCount, 0);
    
    return {
      domains: domains.sort((a, b) => b.lastRequest - a.lastRequest).slice(0, 20),
      blockedDomains: Array.from(this.blockedDomains),
      totalRequests,
      successRate: totalRequests > 0 ? (totalSuccess / totalRequests) * 100 : 100
    };
  }
  
  unblockDomain(domain: string): boolean {
    if (this.blockedDomains.has(domain)) {
      this.blockedDomains.delete(domain);
      const entry = this.domainLimits.get(domain);
      if (entry) {
        entry.blockedCount = 0;
        entry.cooldownUntil = 0;
      }
      return true;
    }
    return false;
  }
  
  clearStats(): void {
    this.domainStats.clear();
    this.domainLimits.clear();
    this.userLimits.clear();
    this.blockedDomains.clear();
    console.log("[RateLimiter] All stats cleared");
  }
}

export const rateLimiterService = new RateLimiterService();
