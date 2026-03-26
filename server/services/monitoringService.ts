import { db } from "../db";
import { 
  monitoredSites, 
  monitoringChecks, 
  monitoringAlerts,
  type MonitoredSite,
  type MonitoringCheck,
  type MonitoringAlert
} from "@shared/schema";
import { eq, and, desc, gte } from "drizzle-orm";

export type CheckStatus = "up" | "down" | "slow" | "error" | "timeout";

export interface CheckResult {
  status: CheckStatus;
  responseTimeMs: number;
  httpStatus?: number;
  errorMessage?: string;
  contentLength?: number;
}

export interface MonitoringSummary {
  site: MonitoredSite;
  recentChecks: MonitoringCheck[];
  uptime24h: number;
  avgResponseTime24h: number;
  lastAlert?: MonitoringAlert;
}

async function performCheck(url: string, timeoutMs: number = 30000, slowThresholdMs: number = 30000): Promise<CheckResult> {
  const startTime = Date.now();
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache"
    };
    
    const response = await fetch(url, {
      headers,
      redirect: "follow",
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    const responseTimeMs = Date.now() - startTime;
    
    const contentLength = parseInt(response.headers.get("content-length") || "0") || 0;
    
    if (!response.ok) {
      return {
        status: response.status >= 500 ? "down" : "error",
        responseTimeMs,
        httpStatus: response.status,
        errorMessage: `HTTP ${response.status}: ${response.statusText}`,
        contentLength
      };
    }
    
    const status: CheckStatus = responseTimeMs > slowThresholdMs ? "slow" : "up";
    
    return {
      status,
      responseTimeMs,
      httpStatus: response.status,
      contentLength
    };
  } catch (error) {
    const responseTimeMs = Date.now() - startTime;
    
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        return {
          status: "timeout",
          responseTimeMs,
          errorMessage: `Timeout après ${timeoutMs}ms`
        };
      }
      
      return {
        status: "down",
        responseTimeMs,
        errorMessage: error.message
      };
    }
    
    return {
      status: "error",
      responseTimeMs,
      errorMessage: String(error)
    };
  }
}

export async function addMonitoredSite(userId: number, data: {
  url: string;
  name: string;
  checkInterval?: number;
  alertThreshold?: number;
}): Promise<MonitoredSite> {
  let url = data.url;
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }
  
  const [site] = await db.insert(monitoredSites).values({
    userId,
    url,
    name: data.name,
    checkInterval: data.checkInterval || 60,
    alertThreshold: data.alertThreshold || 30000,
    isActive: true,
    consecutiveFailures: 0
  }).returning();
  
  console.log(`[Monitoring] Added site: ${site.name} (${site.url})`);
  return site;
}

export async function removeMonitoredSite(userId: number, siteId: number): Promise<boolean> {
  const result = await db.delete(monitoredSites)
    .where(and(eq(monitoredSites.id, siteId), eq(monitoredSites.userId, userId)));
  return true;
}

export async function getMonitoredSites(userId: number): Promise<MonitoredSite[]> {
  return db.select().from(monitoredSites)
    .where(eq(monitoredSites.userId, userId))
    .orderBy(desc(monitoredSites.createdAt));
}

export async function checkSite(site: MonitoredSite): Promise<MonitoringCheck> {
  console.log(`[Monitoring] Checking: ${site.name} (${site.url})`);
  
  const result = await performCheck(site.url, site.alertThreshold + 5000, site.alertThreshold);
  
  const [check] = await db.insert(monitoringChecks).values({
    siteId: site.id,
    userId: site.userId,
    status: result.status,
    responseTimeMs: result.responseTimeMs,
    httpStatus: result.httpStatus,
    errorMessage: result.errorMessage,
    contentLength: result.contentLength
  }).returning();
  
  const isDown = result.status === "down" || result.status === "timeout" || result.status === "error";
  const isSlow = result.status === "slow" || (result.responseTimeMs > site.alertThreshold);
  const wasDown = site.lastStatus === "down" || site.lastStatus === "timeout" || site.lastStatus === "error";
  
  let consecutiveFailures = site.consecutiveFailures;
  if (isDown) {
    consecutiveFailures++;
  } else {
    consecutiveFailures = 0;
  }
  
  await db.update(monitoredSites)
    .set({
      lastCheckAt: new Date(),
      lastStatus: result.status,
      lastResponseTime: result.responseTimeMs,
      consecutiveFailures,
      updatedAt: new Date()
    })
    .where(eq(monitoredSites.id, site.id));
  
  if (isDown && consecutiveFailures >= 2) {
    await createAlert(site, "down", `Le site ${site.name} est inaccessible (${result.errorMessage || result.status})`, result.responseTimeMs);
  } else if (isSlow && !isDown) {
    await createAlert(site, "slow", `Le site ${site.name} est lent (${(result.responseTimeMs / 1000).toFixed(1)}s > ${(site.alertThreshold / 1000).toFixed(0)}s seuil)`, result.responseTimeMs);
  } else if (!isDown && wasDown && site.consecutiveFailures >= 2) {
    await createAlert(site, "recovered", `Le site ${site.name} est de nouveau accessible (${(result.responseTimeMs / 1000).toFixed(1)}s)`, result.responseTimeMs);
  }
  
  console.log(`[Monitoring] ${site.name}: ${result.status} in ${result.responseTimeMs}ms`);
  return check;
}

async function createAlert(site: MonitoredSite, alertType: string, message: string, responseTimeMs?: number): Promise<MonitoringAlert> {
  const [alert] = await db.insert(monitoringAlerts).values({
    siteId: site.id,
    userId: site.userId,
    alertType,
    message,
    responseTimeMs,
    isRead: false,
    isNotified: false
  }).returning();
  
  console.log(`[Monitoring] Alert: ${alertType} - ${message}`);
  return alert;
}

export async function checkAllSites(): Promise<{ checked: number; alerts: number }> {
  const now = new Date();
  let checked = 0;
  let alerts = 0;
  
  const sites = await db.select().from(monitoredSites)
    .where(eq(monitoredSites.isActive, true));
  
  for (const site of sites) {
    const lastCheck = site.lastCheckAt ? new Date(site.lastCheckAt) : null;
    const intervalMs = site.checkInterval * 60 * 1000;
    
    if (!lastCheck || (now.getTime() - lastCheck.getTime()) >= intervalMs) {
      await checkSite(site);
      checked++;
      
      await new Promise(r => setTimeout(r, 500));
    }
  }
  
  if (checked > 0) {
    console.log(`[Monitoring] Checked ${checked} sites`);
  }
  
  return { checked, alerts };
}

export async function getSiteSummary(userId: number, siteId: number): Promise<MonitoringSummary | null> {
  const [site] = await db.select().from(monitoredSites)
    .where(and(eq(monitoredSites.id, siteId), eq(monitoredSites.userId, userId)));
  
  if (!site) return null;
  
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const recentChecks = await db.select().from(monitoringChecks)
    .where(and(
      eq(monitoringChecks.siteId, siteId),
      gte(monitoringChecks.checkedAt, twentyFourHoursAgo)
    ))
    .orderBy(desc(monitoringChecks.checkedAt))
    .limit(50);
  
  const upChecks = recentChecks.filter(c => c.status === "up" || c.status === "slow");
  const uptime24h = recentChecks.length > 0 ? (upChecks.length / recentChecks.length) * 100 : 100;
  
  const avgResponseTime24h = recentChecks.length > 0
    ? recentChecks.reduce((sum, c) => sum + (c.responseTimeMs || 0), 0) / recentChecks.length
    : 0;
  
  const [lastAlert] = await db.select().from(monitoringAlerts)
    .where(eq(monitoringAlerts.siteId, siteId))
    .orderBy(desc(monitoringAlerts.createdAt))
    .limit(1);
  
  return {
    site,
    recentChecks,
    uptime24h: Math.round(uptime24h * 10) / 10,
    avgResponseTime24h: Math.round(avgResponseTime24h),
    lastAlert
  };
}

export async function getUnreadAlerts(userId: number): Promise<MonitoringAlert[]> {
  return db.select().from(monitoringAlerts)
    .where(and(
      eq(monitoringAlerts.userId, userId),
      eq(monitoringAlerts.isRead, false)
    ))
    .orderBy(desc(monitoringAlerts.createdAt));
}

export async function acknowledgeAlert(userId: number, alertId: number): Promise<boolean> {
  await db.update(monitoringAlerts)
    .set({ isRead: true, acknowledgedAt: new Date() })
    .where(and(eq(monitoringAlerts.id, alertId), eq(monitoringAlerts.userId, userId)));
  return true;
}

export async function getMonitoringStats(userId: number): Promise<{
  totalSites: number;
  sitesUp: number;
  sitesDown: number;
  sitesSlow: number;
  avgResponseTime: number;
  unreadAlerts: number;
}> {
  const sites = await getMonitoredSites(userId);
  const unreadAlerts = await getUnreadAlerts(userId);
  
  const sitesUp = sites.filter(s => s.lastStatus === "up").length;
  const sitesDown = sites.filter(s => ["down", "timeout", "error"].includes(s.lastStatus || "")).length;
  const sitesSlow = sites.filter(s => s.lastStatus === "slow").length;
  
  const totalResponseTime = sites.reduce((sum, s) => sum + (s.lastResponseTime || 0), 0);
  const avgResponseTime = sites.length > 0 ? Math.round(totalResponseTime / sites.length) : 0;
  
  return {
    totalSites: sites.length,
    sitesUp,
    sitesDown,
    sitesSlow,
    avgResponseTime,
    unreadAlerts: unreadAlerts.length
  };
}

export async function forceCheckSite(userId: number, siteId: number): Promise<MonitoringCheck | null> {
  const [site] = await db.select().from(monitoredSites)
    .where(and(eq(monitoredSites.id, siteId), eq(monitoredSites.userId, userId)));
  
  if (!site) return null;
  
  return checkSite(site);
}

export async function updateSiteSettings(userId: number, siteId: number, updates: {
  name?: string;
  checkInterval?: number;
  alertThreshold?: number;
  isActive?: boolean;
}): Promise<MonitoredSite | null> {
  const [site] = await db.update(monitoredSites)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(monitoredSites.id, siteId), eq(monitoredSites.userId, userId)))
    .returning();
  
  return site || null;
}
