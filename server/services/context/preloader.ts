/**
 * Context Preloader Service
 * Pre-load context (calendar, weather, memory) during STT to reduce response latency
 */

import { db } from "../../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { fetchMarseilleData } from "../marseilleWeather";
import { MemoryService } from "../memory";
import { metricsService } from "../metricsService";
import { selfAwarenessService } from "../selfAwarenessService";
import { codeContextService } from "../codeContextService";
import { generateConsciousnessPrompt } from "../../config/ulysseConsciousness";
import { generateStrategiesPrompt } from "../../config/ulysseOptimumStrategies";
import { autoLearningEngine } from "../autoLearningEngine";
import { cumulativeLearningEngine } from "../cumulativeLearningEngine";
import { ulysseKPIService } from "../ulysseKPIService";

const memoryService = new MemoryService();

interface PreloadedContext {
  timeContext: string;
  calendarContext: string;
  memoryContext: string;
  spotifyContext: string;
  geolocationContext: string;
  systemStatusContext: string;
  codeAwarenessContext: string;
  consciousnessContext: string;
  businessContext: string;
  preloadedAt: number;
  expiresAt: number;
}

// Cache of preloaded contexts per user
const contextCache = new Map<number, PreloadedContext>();

// Context validity duration (how long preloaded context is considered fresh)
const CONTEXT_TTL = 300000; // 5 minutes — Ulysse keeps his calendar/context in core memory

// Separate TTL for calendar-specific data (refreshed less often)
const CALENDAR_CACHE_TTL = 300000; // 5 minutes
const calendarCache = new Map<number, { data: string; fetchedAt: number }>();

// Cleanup interval for expired entries
const CLEANUP_INTERVAL = 60000; // 1 minute

// Periodic cleanup to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  const entries = Array.from(contextCache.entries());
  for (const [userId, context] of entries) {
    if (now > context.expiresAt) {
      contextCache.delete(userId);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`[ContextPreloader] Cleanup: removed ${cleaned} expired entries`);
  }
}, CLEANUP_INTERVAL);

/**
 * Start preloading context for a user (call this when STT starts)
 */
export async function startPreloading(userId: number): Promise<void> {
  console.log(`[ContextPreloader] Starting preload for user ${userId}`);
  
  // Don't await - let it run in background
  preloadContext(userId).catch(err => {
    console.error(`[ContextPreloader] Preload failed for user ${userId}:`, err);
  });
}

/**
 * Preload all context for a user
 */
async function preloadContext(userId: number): Promise<void> {
  const startTime = Date.now();
  let success = true;
  
  // Parallel fetch all contexts with individual timing
  const fetchWithTiming = async (name: string, fetcher: () => Promise<string>) => {
    const t0 = Date.now();
    try {
      const result = await fetcher();
      metricsService.recordPreloadLatency(name, Date.now() - t0);
      return result;
    } catch (err) {
      metricsService.recordPreloadLatency(name, Date.now() - t0);
      metricsService.recordPreloadError(name, String(err));
      throw err;
    }
  };

  const [timeResult, calendarResult, memoryResult, spotifyResult, geolocationResult, systemStatusResult, codeAwarenessResult, consciousnessResult, businessResult] = await Promise.allSettled([
    fetchWithTiming("time", fetchTimeContext),
    fetchWithTiming("calendar", () => fetchCalendarContext(userId)),
    fetchWithTiming("memory", () => fetchMemoryContext(userId)),
    fetchWithTiming("spotify", () => fetchSpotifyContext(userId)),
    fetchWithTiming("geolocation", () => fetchGeolocationContext(userId)),
    fetchWithTiming("systemStatus", () => fetchSystemStatusContext(userId)),
    fetchWithTiming("codeAwareness", () => fetchCodeAwarenessContext(userId)),
    fetchWithTiming("consciousness", () => fetchConsciousnessContext(userId)),
    fetchWithTiming("business", () => fetchBusinessContext(userId)),
  ]);
  
  // Check for failures
  const results = [timeResult, calendarResult, memoryResult, spotifyResult, geolocationResult, systemStatusResult, codeAwarenessResult, consciousnessResult, businessResult];
  const failures = results.filter(r => r.status === "rejected").length;
  if (failures > 0) {
    success = false;
  }
  
  const context: PreloadedContext = {
    timeContext: timeResult.status === "fulfilled" ? timeResult.value : "",
    calendarContext: calendarResult.status === "fulfilled" ? calendarResult.value : "",
    memoryContext: memoryResult.status === "fulfilled" ? memoryResult.value : "",
    spotifyContext: spotifyResult.status === "fulfilled" ? spotifyResult.value : "",
    geolocationContext: geolocationResult.status === "fulfilled" ? geolocationResult.value : "",
    systemStatusContext: systemStatusResult.status === "fulfilled" ? systemStatusResult.value : "",
    codeAwarenessContext: codeAwarenessResult.status === "fulfilled" ? codeAwarenessResult.value : "",
    consciousnessContext: consciousnessResult.status === "fulfilled" ? consciousnessResult.value : "",
    businessContext: businessResult.status === "fulfilled" ? businessResult.value : "",
    preloadedAt: startTime,
    expiresAt: Date.now() + CONTEXT_TTL,
  };
  
  contextCache.set(userId, context);
  
  const elapsed = Date.now() - startTime;
  metricsService.recordPreloadTotal(elapsed, success);
  console.log(`[ContextPreloader] Preloaded context for user ${userId} in ${elapsed}ms (${failures} failures)`);
}

/**
 * Get preloaded context if available and fresh
 */
export function getPreloadedContext(userId: number): PreloadedContext | null {
  const cached = contextCache.get(userId);
  
  if (!cached) {
    console.log(`[ContextPreloader] No cached context for user ${userId}`);
    metricsService.recordCacheMiss();
    return null;
  }
  
  if (Date.now() > cached.expiresAt) {
    console.log(`[ContextPreloader] Cached context expired for user ${userId}`);
    metricsService.recordCacheExpired();
    contextCache.delete(userId);
    return null;
  }
  
  const age = Date.now() - cached.preloadedAt;
  console.log(`[ContextPreloader] Using cached context for user ${userId} (age: ${age}ms)`);
  metricsService.recordCacheHit();
  return cached;
}

/**
 * Clear preloaded context for a user
 */
export function clearPreloadedContext(userId: number): void {
  contextCache.delete(userId);
  calendarCache.delete(userId);
}

/**
 * Get preloaded context as a formatted string for AI prompt injection
 * Domain-aware: only injects calendar/spotify/business when the request domain is relevant
 * Returns empty string if no preloaded context available
 */
export function getPreloadedContextAsPrompt(userId: number, domain?: string): string {
  const context = getPreloadedContext(userId);
  if (!context) return "";

  const CALENDAR_DOMAINS = ["calendar", "general", "email"];
  const MUSIC_DOMAINS = ["music", "general"];
  const BUSINESS_DOMAINS = ["general"];
  const d = domain || "general";

  const parts = [
    context.consciousnessContext,
    context.timeContext,
    CALENDAR_DOMAINS.includes(d) ? context.calendarContext : "",
    context.memoryContext,
    MUSIC_DOMAINS.includes(d) ? context.spotifyContext : "",
    context.geolocationContext,
    context.systemStatusContext,
    context.codeAwarenessContext,
    BUSINESS_DOMAINS.includes(d) ? context.businessContext : "",
  ].filter(Boolean);
  
  if (parts.length === 0) return "";
  
  return parts.join("");
}

// Individual context fetchers

async function fetchTimeContext(): Promise<string> {
  try {
    const data = await fetchMarseilleData();
    return `\n\n### CONTEXTE TEMPOREL ACTUEL (Marseille, France):\n- Heure: ${data.time}\n- Date: ${data.date}\n- Météo: ${data.weather.temperature}, ${data.weather.condition}\n`;
  } catch (err) {
    console.error("[ContextPreloader] Time context failed:", err);
    return "";
  }
}

async function fetchCalendarContext(userId: number): Promise<string> {
  try {
    const cached = calendarCache.get(userId);
    if (cached && (Date.now() - cached.fetchedAt) < CALENDAR_CACHE_TTL) {
      console.log(`[ContextPreloader] Using cached calendar for user ${userId} (age: ${Math.round((Date.now() - cached.fetchedAt) / 1000)}s)`);
      return cached.data;
    }

    const { calendarService } = await import("../googleCalendarService");
    const isConnected = await calendarService.isConnected(userId);
    
    if (!isConnected) return "";
    
    const todayEvents = await calendarService.getTodayEvents(userId);
    let result: string;
    if (todayEvents.length > 0) {
      result = `\n\n### CALENDRIER - ÉVÉNEMENTS DU JOUR:\n${calendarService.formatEventsForAI(todayEvents)}\n`;
    } else {
      result = `\n\n### CALENDRIER: Aucun événement prévu aujourd'hui.\n`;
    }

    calendarCache.set(userId, { data: result, fetchedAt: Date.now() });
    return result;
  } catch (err) {
    console.error("[ContextPreloader] Calendar context failed:", err);
    return "";
  }
}

async function fetchMemoryContext(userId: number): Promise<string> {
  try {
    // Get user to check if owner
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const isOwner = user?.isOwner ?? false;
    
    return await memoryService.buildContextPromptWithSearches(userId, isOwner);
  } catch (err) {
    console.error("[ContextPreloader] Memory context failed:", err);
    return "";
  }
}

async function fetchSpotifyContext(_userId: number): Promise<string> {
  try {
    const { isSpotifyConnected, getPlaybackState } = await import("./spotifyService");
    
    const isConnected = await isSpotifyConnected();
    if (!isConnected) return "";
    
    const playback = await getPlaybackState();
    if (playback?.isPlaying && playback.trackName) {
      return `\n\n### SPOTIFY - EN COURS:\n- Morceau: ${playback.trackName}\n- Artiste: ${playback.artistName || "Artiste inconnu"}\n- Volume: ${playback.volumePercent || 50}%\n`;
    }
    return "";
  } catch (err) {
    console.error("[ContextPreloader] Spotify context failed:", err);
    return "";
  }
}

async function fetchGeolocationContext(userId: number): Promise<string> {
  try {
    const { geolocationService } = await import("../geolocationService");
    
    const location = await geolocationService.getLastKnownLocation(userId);
    if (!location) return "";
    
    const recordedAt = location.recordedAt || location.createdAt;
    if (!recordedAt) return "";
    
    const ageMinutes = Math.floor((Date.now() - new Date(recordedAt).getTime()) / 60000);
    if (ageMinutes > 60) return ""; // Location too old
    
    const lat = parseFloat(location.latitude);
    const lng = parseFloat(location.longitude);
    const coords = !isNaN(lat) && !isNaN(lng) ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : "Position inconnue";
    
    return `\n\n### GÉOLOCALISATION:\n- Position: ${location.address || coords}\n- Mise à jour: il y a ${ageMinutes} min\n`;
  } catch (err) {
    console.error("[ContextPreloader] Geolocation context failed:", err);
    return "";
  }
}

async function fetchSystemStatusContext(userId: number): Promise<string> {
  try {
    // Only inject for owner users (Ulysse persona)
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user?.isOwner) return "";
    
    // Generate enhanced context injection with ClarityScore from self-awareness service (PALIER 3)
    const contextInjection = await selfAwarenessService.generateEnhancedContextInjection(userId);
    return contextInjection ? `\n\n### SELF-AWARENESS - SYSTEM STATUS:\n${contextInjection}\n` : "";
  } catch (err) {
    console.error("[ContextPreloader] System status context failed:", err);
    return "";
  }
}

async function fetchCodeAwarenessContext(userId: number): Promise<string> {
  try {
    // Only inject for owner users (Ulysse persona)
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user?.isOwner) return "";
    
    // Get basic code structure awareness
    const status = codeContextService.getStatus();
    if (!status.indexed) return "";
    
    return `\n\n### SELF-AWARENESS - CODE BASE:\nJe dispose d'un index de ${status.fileCount} fichiers et ${status.symbolCount} symboles.\nJe peux rechercher dans le code pour répondre aux questions de développement.\n`;
  } catch (err) {
    console.error("[ContextPreloader] Code awareness context failed:", err);
    return "";
  }
}

async function fetchConsciousnessContext(userId: number): Promise<string> {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user?.isOwner) return "";

    const consciousnessPrompt = generateConsciousnessPrompt();
    const strategiesPrompt = generateStrategiesPrompt();
    const learningPrompt = autoLearningEngine.generateLearningPrompt();
    const kpiPrompt = ulysseKPIService.generateKPIPrompt();
    let cumulativePrompt = "";
    try {
      cumulativePrompt = await cumulativeLearningEngine.generateLearningContext("ulysse", { maxInsights: 10, maxErrors: 5, includeTools: true });
    } catch {}

    return `${consciousnessPrompt}\n${strategiesPrompt}\n${learningPrompt}\n${cumulativePrompt}\n${kpiPrompt}`;
  } catch (err) {
    console.error("[ContextPreloader] Consciousness context failed:", err);
    return "";
  }
}

async function fetchBusinessContext(userId: number): Promise<string> {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user?.isOwner) return "";

    const {
      suguPurchases, suguExpenses, suguBankEntries, suguLoans,
      suguCashRegister, suguEmployees, suguPayroll
    } = await import("@shared/schema");
    const { desc } = await import("drizzle-orm");

    const now = new Date();
    const currentYear = now.getFullYear().toString();
    const currentMonth = `${currentYear}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const yearStart = `${currentYear}-01-01`;
    const monthStart = `${currentMonth}-01`;

    const [purchases, expenses, bankEntries, loans, cashEntries, employees, payrolls] = await Promise.all([
      db.select().from(suguPurchases).orderBy(desc(suguPurchases.invoiceDate)),
      db.select().from(suguExpenses),
      db.select().from(suguBankEntries).orderBy(desc(suguBankEntries.entryDate)),
      db.select().from(suguLoans),
      db.select().from(suguCashRegister).orderBy(desc(suguCashRegister.entryDate)),
      db.select().from(suguEmployees),
      db.select().from(suguPayroll),
    ]);

    const fmt = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}€`;

    // --- Revenue (caisse) ---
    const yearCash = cashEntries.filter((c: any) => c.entryDate >= yearStart);
    const monthCash = cashEntries.filter((c: any) => c.entryDate >= monthStart);
    const totalRevenueYear = yearCash.reduce((s: number, c: any) => s + (c.totalRevenue || 0), 0);
    const totalRevenueMonth = monthCash.reduce((s: number, c: any) => s + (c.totalRevenue || 0), 0);
    const totalCoversYear = yearCash.reduce((s: number, c: any) => s + (c.coversCount || 0), 0);
    const avgTicketYear = totalCoversYear > 0 ? totalRevenueYear / totalCoversYear : 0;
    const last7 = cashEntries.slice(0, 7);
    const last7Revenue = last7.map((c: any) => `${c.entryDate}: ${fmt(c.totalRevenue || 0)}`).join(", ");

    // --- Monthly CA breakdown (last 6 months) ---
    const monthlyCA: Record<string, number> = {};
    for (const c of cashEntries as any[]) {
      if (!c.entryDate) continue;
      const mo = c.entryDate.substring(0, 7);
      monthlyCA[mo] = (monthlyCA[mo] || 0) + (c.totalRevenue || 0);
    }
    const last6Months = Object.entries(monthlyCA)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 6)
      .map(([m, v]) => `${m}: ${fmt(v)}`)
      .join(" | ");

    // --- Achats ---
    const yearPurchases = purchases.filter((p: any) => p.invoiceDate >= yearStart);
    const totalPurchasesYear = yearPurchases.reduce((s: number, p: any) => s + (p.amount || 0), 0);
    const unpaidPurchases = purchases.filter((p: any) => !p.isPaid).reduce((s: number, p: any) => s + (p.amount || 0), 0);
    const topSuppliers: Record<string, number> = {};
    for (const p of yearPurchases as any[]) {
      if (p.supplier) topSuppliers[p.supplier] = (topSuppliers[p.supplier] || 0) + (p.amount || 0);
    }
    const top3Suppliers = Object.entries(topSuppliers)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([s, v]) => `${s}: ${fmt(v)}`).join(", ");
    const recentPurchases = purchases.slice(0, 5).map((p: any) =>
      `${p.invoiceDate} ${p.supplier} ${fmt(p.amount)} ${p.isPaid ? "✓" : "IMPAYÉ"}`
    ).join(" | ");

    // --- Frais Généraux ---
    const totalExpensesYear = expenses.filter((e: any) => e.period >= currentYear.substring(0, 4))
      .reduce((s: number, e: any) => s + (e.amount || 0), 0);
    const unpaidExpenses = expenses.filter((e: any) => !e.isPaid).reduce((s: number, e: any) => s + (e.amount || 0), 0);

    // --- Banque ---
    const sortedBank = [...bankEntries].sort((a: any, b: any) => a.entryDate.localeCompare(b.entryDate) || a.id - b.id);
    let openingBal = 0;
    for (let i = 0; i < sortedBank.length; i++) {
      const e: any = sortedBank[i];
      if (e.balance != null) {
        const partial = sortedBank.slice(0, i + 1).reduce((s: number, x: any) => s + (x.amount || 0), 0);
        openingBal = e.balance - partial;
        break;
      }
    }
    let bankBalance = openingBal;
    for (const e of sortedBank) bankBalance += (e as any).amount || 0;
    const recentBankEntries = bankEntries.slice(0, 5).map((e: any) =>
      `${e.entryDate} ${e.label?.substring(0, 30)} ${e.amount > 0 ? "+" : ""}${fmt(e.amount)}`
    ).join(" | ");

    // --- Emprunts ---
    const capitalRestant = loans.reduce((s: number, l: any) => s + (l.remainingAmount || 0), 0);
    const mensualites = loans.reduce((s: number, l: any) => s + (l.monthlyPayment || 0), 0);
    const loansDetail = loans.map((l: any) =>
      `${l.loanName || l.bankName} cap.restant:${fmt(l.remainingAmount || 0)} mensualité:${fmt(l.monthlyPayment || 0)}`
    ).join(" | ");

    // --- RH ---
    const activeEmps = employees.filter((e: any) => e.isActive);
    const masseSalariale = activeEmps.reduce((s: number, e: any) => s + (e.monthlySalary || 0), 0);
    const empList = activeEmps.map((e: any) => `${e.firstName} ${e.lastName} (${e.contractType})`).join(", ");

    // --- P&L ---
    const totalCostsYear = totalPurchasesYear + totalExpensesYear + (masseSalariale * 12);
    const profitYear = totalRevenueYear - totalCostsYear;
    const marginYear = totalRevenueYear > 0 ? Math.round(profitYear / totalRevenueYear * 1000) / 10 : 0;
    const foodCostRatio = totalRevenueYear > 0 ? Math.round(totalPurchasesYear / totalRevenueYear * 1000) / 10 : 0;

    return `

### DONNÉES BUSINESS — SUGU Valentine (Restaurant Marseille)
**Période:** Année ${currentYear} | Mois en cours: ${currentMonth}

**CHIFFRE D'AFFAIRES:**
- CA année ${currentYear}: ${fmt(totalRevenueYear)} | Mois en cours: ${fmt(totalRevenueMonth)}
- Couverts année: ${totalCoversYear} | Ticket moyen: ${fmt(avgTicketYear)}
- CA 7 derniers jours: ${last7Revenue || "Aucune donnée"}
- CA mensuel (6 derniers mois): ${last6Months || "Aucune donnée"}

**ACHATS FOURNISSEURS:**
- Total achats ${currentYear}: ${fmt(totalPurchasesYear)} | Impayés: ${fmt(unpaidPurchases)}
- Top fournisseurs: ${top3Suppliers || "Aucun"}
- Derniers achats: ${recentPurchases || "Aucun"}

**FRAIS GÉNÉRAUX:**
- Total frais ${currentYear}: ${fmt(totalExpensesYear)} | Impayés: ${fmt(unpaidExpenses)}

**BANQUE:**
- Solde bancaire estimé: ${fmt(bankBalance)}
- Dernières écritures: ${recentBankEntries || "Aucune"}

**EMPRUNTS:**
- Capital restant total: ${fmt(capitalRestant)} | Mensualités totales: ${fmt(mensualites)}
${loansDetail ? `- Détail: ${loansDetail}` : ""}

**RESSOURCES HUMAINES:**
- Employés actifs: ${activeEmps.length} | Masse salariale: ${fmt(masseSalariale)}/mois
${empList ? `- Équipe: ${empList}` : ""}

**P&L ESTIMÉ ${currentYear}:**
- Revenus: ${fmt(totalRevenueYear)} | Coûts estimés: ${fmt(totalCostsYear)} | Résultat: ${fmt(profitYear)}
- Marge opérationnelle: ${marginYear}% | Food cost: ${foodCostRatio}%
`;
  } catch (err) {
    console.error("[ContextPreloader] Business context failed:", err);
    return "";
  }
}

/**
 * Get preloader stats
 */
export function getPreloaderStats() {
  return {
    cachedUsers: contextCache.size,
    userIds: Array.from(contextCache.keys()),
  };
}
