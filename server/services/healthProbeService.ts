/**
 * HealthProbeService — Centralized, cached health probing for all system components.
 * 
 * Used by selfAwarenessService, diagnosticsService, and capabilityService
 * instead of each duplicating their own health checks.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { ulysseMemory } from "@shared/schema";
import { getOpenAI } from "./core/openaiClient.js";

export type ServiceStatus = "operational" | "degraded" | "down" | "unknown";

export interface ProbeResult {
    status: ServiceStatus;
    latencyMs: number;
    details?: string;
    lastIssue?: string;
    checkedAt: number;
}

interface CachedProbe {
    result: ProbeResult;
    expiresAt: number;
}

const DEFAULT_TTL = 30_000;        // 30s for lightweight checks
const HEAVY_TTL = 60_000;          // 60s for API-calling checks
const LIGHT_TIMEOUT = 5_000;       // 5s timeout for probes
const HEAVY_TIMEOUT = 10_000;      // 10s timeout for heavy probes

class HealthProbeService {
    private cache = new Map<string, CachedProbe>();

    // ─── Core probes ────────────────────────────────────

    async probeDatabase(fresh = false): Promise<ProbeResult> {
        return this.cached("database", fresh, DEFAULT_TTL, async () => {
            const start = Date.now();
            try {
                await db.execute(sql`SELECT 1`);
                return { status: "operational", latencyMs: Date.now() - start, details: "PostgreSQL connecté", checkedAt: Date.now() };
            } catch (error: unknown) {
                return { status: "down", latencyMs: Date.now() - start, lastIssue: String(error), details: "Connexion PostgreSQL échouée", checkedAt: Date.now() };
            }
        });
    }

    async probeOpenAI(fresh = false): Promise<ProbeResult> {
        return this.cached("openai", fresh, HEAVY_TTL, async () => {
            const start = Date.now();
            const hasKey = !!(process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY);
            if (!hasKey) {
                return { status: "down", latencyMs: 0, details: "Clé API OpenAI manquante", checkedAt: Date.now() };
            }
            try {
                const openai = getOpenAI();
                const response = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [{ role: "user", content: "ping" }],
                    max_tokens: 1,
                });
                return { status: "operational", latencyMs: Date.now() - start, details: `Modèle: ${response.model}`, checkedAt: Date.now() };
            } catch (error: unknown) {
                const err = error as any;
                const isRateLimit = err?.status === 429;
                return {
                    status: isRateLimit ? "degraded" : "down",
                    latencyMs: Date.now() - start,
                    lastIssue: err?.message ?? String(error),
                    details: isRateLimit ? "Rate limit atteint" : "API OpenAI inaccessible",
                    checkedAt: Date.now(),
                };
            }
        });
    }

    async probeMemory(fresh = false): Promise<ProbeResult> {
        return this.cached("memory", fresh, DEFAULT_TTL, async () => {
            const start = Date.now();
            try {
                await db.select().from(ulysseMemory).limit(1);
                return { status: "operational", latencyMs: Date.now() - start, details: "Système mémoire opérationnel", checkedAt: Date.now() };
            } catch (error: unknown) {
                return { status: "down", latencyMs: Date.now() - start, lastIssue: String(error), details: "Accès mémoire échoué", checkedAt: Date.now() };
            }
        });
    }

    async probeAgentMail(fresh = false): Promise<ProbeResult> {
        return this.cached("agentmail", fresh, HEAVY_TTL, async () => {
            const start = Date.now();
            if (!process.env.AGENTMAIL_API_KEY) {
                return { status: "degraded", latencyMs: 0, details: "AgentMail non configuré. Set AGENTMAIL_API_KEY.", checkedAt: Date.now() };
            }
            try {
                const { agentMailService } = await import("./agentMailService");
                const connected = await agentMailService.isConnected();
                return {
                    status: connected ? "operational" : "degraded",
                    latencyMs: Date.now() - start,
                    details: connected ? "AgentMail connecté" : "AgentMail non connecté",
                    checkedAt: Date.now(),
                };
            } catch (error: unknown) {
                return { status: "down", latencyMs: Date.now() - start, lastIssue: String(error), details: "AgentMail inaccessible", checkedAt: Date.now() };
            }
        });
    }

    async probeCalendar(fresh = false): Promise<ProbeResult> {
        return this.cached("calendar", fresh, HEAVY_TTL, async () => {
            const start = Date.now();
            const hasCredentials = !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET);
            if (!hasCredentials) {
                return { status: "degraded", latencyMs: 0, details: "Credentials Google non configurés", checkedAt: Date.now() };
            }
            try {
                const { calendarService } = await import("./googleCalendarService");
                const connected = await calendarService.checkConnection?.() ?? await calendarService.isConnected?.() ?? true;
                return { status: connected ? "operational" : "degraded", latencyMs: Date.now() - start, details: "Google Calendar " + (connected ? "configuré" : "non connecté"), checkedAt: Date.now() };
            } catch (error: unknown) {
                return { status: "degraded", latencyMs: Date.now() - start, lastIssue: String(error), details: "Google Calendar check failed", checkedAt: Date.now() };
            }
        });
    }

    async probeTodoist(fresh = false): Promise<ProbeResult> {
        return this.cached("todoist", fresh, HEAVY_TTL, async () => {
            const start = Date.now();
            try {
                const { checkTodoistConnection } = await import("./todoistService");
                const connected = await checkTodoistConnection();
                return { status: connected ? "operational" : "degraded", latencyMs: Date.now() - start, details: connected ? "Todoist connecté" : "Todoist non connecté", checkedAt: Date.now() };
            } catch (error: unknown) {
                return { status: "degraded", latencyMs: Date.now() - start, lastIssue: String(error), checkedAt: Date.now() };
            }
        });
    }

    async probeDrive(fresh = false): Promise<ProbeResult> {
        return this.cached("drive", fresh, HEAVY_TTL, async () => {
            const start = Date.now();
            try {
                const { checkDriveConnection } = await import("./googleDriveService");
                const connected = await checkDriveConnection();
                return { status: connected ? "operational" : "degraded", latencyMs: Date.now() - start, details: connected ? "Drive connecté" : "Drive non connecté", checkedAt: Date.now() };
            } catch (error: unknown) {
                return { status: "degraded", latencyMs: Date.now() - start, lastIssue: String(error), checkedAt: Date.now() };
            }
        });
    }

    async probeNotion(fresh = false): Promise<ProbeResult> {
        return this.cached("notion", fresh, HEAVY_TTL, async () => {
            const start = Date.now();
            try {
                const timeoutPromise = new Promise<never>((_, reject) => 
                    setTimeout(() => reject(new Error("Notion probe timeout")), LIGHT_TIMEOUT)
                );
                const { checkNotionConnection } = await import("./notionService");
                const connected = await Promise.race([checkNotionConnection(), timeoutPromise]);
                return { status: connected ? "operational" : "degraded", latencyMs: Date.now() - start, details: connected ? "Notion connecté" : "Notion non connecté", checkedAt: Date.now() };
            } catch (error: unknown) {
                return { status: "degraded", latencyMs: Date.now() - start, lastIssue: String(error), details: "Notion non connecté", checkedAt: Date.now() };
            }
        });
    }

    async probeSpotify(fresh = false): Promise<ProbeResult> {
        return this.cached("spotify", fresh, DEFAULT_TTL, async () => ({
            status: process.env.SPOTIFY_CLIENT_ID ? "operational" as const : "degraded" as const,
            latencyMs: 0,
            details: process.env.SPOTIFY_CLIENT_ID ? "Spotify configuré" : "Spotify non configuré",
            checkedAt: Date.now(),
        }));
    }

    async probeSports(fresh = false): Promise<ProbeResult> {
        return this.cached("sports", fresh, DEFAULT_TTL, async () => ({
            status: process.env.API_FOOTBALL_KEY ? "operational" as const : "degraded" as const,
            latencyMs: 0,
            details: process.env.API_FOOTBALL_KEY ? "API Football configurée" : "API Football non configurée",
            checkedAt: Date.now(),
        }));
    }

    async probeStocks(fresh = false): Promise<ProbeResult> {
        return this.cached("stocks", fresh, DEFAULT_TTL, async () => ({
            status: (process.env.FINNHUB_API_KEY || process.env.TWELVE_DATA_API_KEY) ? "operational" as const : "degraded" as const,
            latencyMs: 0,
            details: "Services financiers " + ((process.env.FINNHUB_API_KEY || process.env.TWELVE_DATA_API_KEY) ? "configurés" : "non configurés"),
            checkedAt: Date.now(),
        }));
    }

    async probeAPIHealth(fresh = false): Promise<ProbeResult> {
        return this.cached("api", fresh, DEFAULT_TTL, async () => {
            const start = Date.now();
            try {
                const response = await fetch(`http://localhost:5000/api/v2/health`);
                const data = await response.json() as any;
                return {
                    status: response.ok ? "operational" as const : "degraded" as const,
                    latencyMs: Date.now() - start,
                    details: `API v2: ${data.features?.includes("unified-conversations") ? "actif" : "inactif"}`,
                    checkedAt: Date.now(),
                };
            } catch (error: unknown) {
                return { status: "down", latencyMs: Date.now() - start, lastIssue: String(error), details: "Serveur API inaccessible", checkedAt: Date.now() };
            }
        });
    }

    // ─── Aggregated probes ──────────────────────────────

    /** Probe all components in parallel, return a map */
    async probeAll(fresh = false): Promise<Record<string, ProbeResult>> {
        const probes: [string, Promise<ProbeResult>][] = [
            ["database", this.probeDatabase(fresh)],
            ["openai", this.probeOpenAI(fresh)],
            ["memory", this.probeMemory(fresh)],
            ["agentmail", this.probeAgentMail(fresh)],
            ["calendar", this.probeCalendar(fresh)],
            ["todoist", this.probeTodoist(fresh)],
            ["drive", this.probeDrive(fresh)],
            ["notion", this.probeNotion(fresh)],
            ["spotify", this.probeSpotify(fresh)],
            ["sports", this.probeSports(fresh)],
            ["stocks", this.probeStocks(fresh)],
            ["api", this.probeAPIHealth(fresh)],
        ];

        const results = await Promise.allSettled(probes.map(([, p]) => p));
        const map: Record<string, ProbeResult> = {};
        probes.forEach(([name], i) => {
            const r = results[i];
            map[name] = r.status === "fulfilled"
                ? r.value
                : { status: "down", latencyMs: 0, lastIssue: String((r as PromiseRejectedResult).reason), checkedAt: Date.now() };
        });
        return map;
    }

    /** Quick check:  returns { overallStatus, checks[] } for simple consumers like ownerDashboard */
    async quickCheck(): Promise<{ overallStatus: string; checks: Array<{ name: string; status: string; latencyMs: number }> }> {
        const all = await this.probeAll();
        const checks = Object.entries(all).map(([name, r]) => ({
            name,
            status: r.status === "operational" ? "ok" : r.status,
            latencyMs: r.latencyMs,
        }));
        const hasDown = checks.some(c => c.status === "down");
        const hasDegraded = checks.some(c => c.status === "degraded");
        return {
            overallStatus: hasDown ? "critical" : hasDegraded ? "degraded" : "healthy",
            checks,
        };
    }

    /** Probe a single component by name */
    async probe(component: string, fresh = false): Promise<ProbeResult> {
        const probeMap: Record<string, (f: boolean) => Promise<ProbeResult>> = {
            database: (f) => this.probeDatabase(f),
            openai: (f) => this.probeOpenAI(f),
            memory: (f) => this.probeMemory(f),
            agentmail: (f) => this.probeAgentMail(f),
            calendar: (f) => this.probeCalendar(f),
            todoist: (f) => this.probeTodoist(f),
            drive: (f) => this.probeDrive(f),
            notion: (f) => this.probeNotion(f),
            spotify: (f) => this.probeSpotify(f),
            sports: (f) => this.probeSports(f),
            stocks: (f) => this.probeStocks(f),
            api: (f) => this.probeAPIHealth(f),
            gemini: async () => ({
                status: (process.env.AI_INTEGRATIONS_GEMINI_API_KEY || process.env.GEMINI_API_KEY) ? "operational" as const : "down" as const,
                latencyMs: 0,
                checkedAt: Date.now(),
            }),
            websocket: async () => ({ status: "operational" as const, latencyMs: 0, checkedAt: Date.now() }),
            brain: (f) => this.probeDatabase(f), // brain = database health
        };
        const fn = probeMap[component];
        if (!fn) return { status: "unknown", latencyMs: 0, checkedAt: Date.now() };
        return fn(fresh);
    }

    /** Clear all cached probes */
    clearCache(): void {
        this.cache.clear();
    }

    // ─── Private helpers ────────────────────────────────

    private async cached(key: string, fresh: boolean, ttl: number, probeFn: () => Promise<ProbeResult>): Promise<ProbeResult> {
        if (!fresh) {
            const c = this.cache.get(key);
            if (c && c.expiresAt > Date.now()) return c.result;
        }
        try {
            const result = await probeFn();
            this.cache.set(key, { result, expiresAt: Date.now() + ttl });
            return result;
        } catch (error: unknown) {
            return { status: "down", latencyMs: 0, lastIssue: String(error), checkedAt: Date.now() };
        }
    }
}

export const healthProbeService = new HealthProbeService();
