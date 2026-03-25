/**
 * Anticipation Engine - Phase 4
 * 
 * Background service that:
 * 1. Periodically analyzes user behavior patterns (every 30 min)
 * 2. Generates proactive suggestions when patterns are detected
 * 3. Pushes real-time anticipation events to the client via WebSocket
 * 4. Integrates with BrainHub to provide predictive context for AI responses
 * 
 * This is the "proactive intelligence" layer — Ulysse anticipates
 * what the user needs before they ask.
 */

import { behaviorService } from "./behaviorService";
import { brainHub } from "./sensory/BrainHub";
import { broadcastToUser } from "./realtimeSync";
import { db } from "../db";
import { users, userBehaviorEvents } from "../../shared/schema";
import { eq, sql, gte } from "drizzle-orm";
import { cleanupRegistry } from "./core/cleanupRegistry.js";
import { calendarAnticipationService } from "./calendarAnticipationService";

// ============== CONSTANTS ==============

const ANALYSIS_INTERVAL = 30 * 60 * 1000;   // Analyze every 30 minutes
const CONTEXT_REFRESH_INTERVAL = 5 * 60 * 1000; // Refresh predictive context every 5 min
const STARTUP_DELAY = 60 * 1000;              // Wait 1 min after startup before first analysis
const MIN_EVENTS_FOR_ANALYSIS = 10;           // Need at least 10 events to start analyzing

// ============== TYPES ==============

export interface AnticipationEvent {
    type: "anticipation.suggestion" | "anticipation.context" | "anticipation.routine";
    data: {
        title: string;
        description: string;
        action?: string;
        actionParams?: Record<string, unknown>;
        confidence: number;
        category: string;
        expiresAt?: number;
    };
    timestamp: number;
}

interface PredictiveContext {
    likelyIntent: string | null;
    timeBasedSuggestions: string[];
    recentFeatures: string[];
    activePatterns: string[];
}

// ============== ANTICIPATION ENGINE ==============

class AnticipationEngine {
    private startupTimeout: NodeJS.Timeout | null = null;
    private analysisInterval: NodeJS.Timeout | null = null;
    private contextInterval: NodeJS.Timeout | null = null;
    private isRunning = false;
    private lastAnalysis = new Map<number, number>(); // userId → last analysis timestamp

    constructor() {
        console.log("[AnticipationEngine] Initialized");
    }

    /**
     * Start the background anticipation engine.
     * Called once at server startup.
     */
    start(): void {
        if (this.isRunning) return;
        this.isRunning = true;

        // Delayed start to let the server warm up — track timeout for cleanup
        this.startupTimeout = setTimeout(() => {
            // Guard: don't start intervals if engine was stopped during startup delay
            if (!this.isRunning) return;

            console.log("[AnticipationEngine] Starting background analysis loop");

            // Run initial analysis
            this.runAnalysisCycle().catch(err =>
                console.error("[AnticipationEngine] Initial analysis failed:", err)
            );

            // Schedule periodic analysis (every 30 min)
            this.analysisInterval = setInterval(() => {
                this.runAnalysisCycle().catch(err =>
                    console.error("[AnticipationEngine] Analysis cycle failed:", err)
                );
            }, ANALYSIS_INTERVAL);

            // Schedule predictive context refresh (every 5 min)
            this.contextInterval = setInterval(() => {
                this.refreshPredictiveContexts().catch(err =>
                    console.error("[AnticipationEngine] Context refresh failed:", err)
                );
            }, CONTEXT_REFRESH_INTERVAL);

        }, STARTUP_DELAY);

        cleanupRegistry.registerCallback(() => this.stop(), 'AnticipationEngine');
    }

    /**
     * Stop the engine.
     */
    stop(): void {
        if (this.startupTimeout) { clearTimeout(this.startupTimeout); this.startupTimeout = null; }
        if (this.analysisInterval) clearInterval(this.analysisInterval);
        if (this.contextInterval) clearInterval(this.contextInterval);
        this.isRunning = false;
        console.log("[AnticipationEngine] Stopped");
    }

    // ============== ANALYSIS CYCLE ==============

    /**
     * Main analysis loop: find active users and analyze their patterns.
     */
    private async runAnalysisCycle(): Promise<void> {
        try {
            // Find users with recent activity (last 24h)
            const oneDayAgo = new Date();
            oneDayAgo.setDate(oneDayAgo.getDate() - 1);

            const activeUsers = await db
                .select({
                    userId: userBehaviorEvents.userId,
                    eventCount: sql<number>`count(*)`,
                })
                .from(userBehaviorEvents)
                .where(gte(userBehaviorEvents.occurredAt, oneDayAgo))
                .groupBy(userBehaviorEvents.userId);

            let totalSuggestions = 0;

            for (const { userId, eventCount } of activeUsers) {
                // Skip users with too few events
                if (Number(eventCount) < MIN_EVENTS_FOR_ANALYSIS) continue;

                // Skip if we analyzed this user recently (within 25 min)
                const lastTime = this.lastAnalysis.get(userId) || 0;
                if (Date.now() - lastTime < ANALYSIS_INTERVAL * 0.8) continue;

                try {
                    const suggestionsCreated = await behaviorService.generateSuggestions(userId);
                    this.lastAnalysis.set(userId, Date.now());

                    if (suggestionsCreated > 0) {
                        totalSuggestions += suggestionsCreated;
                        console.log(`[AnticipationEngine] Generated ${suggestionsCreated} suggestions for user ${userId}`);

                        // Push new suggestions to the user via WebSocket
                        const suggestions = await behaviorService.getPendingSuggestions(userId);
                        for (const suggestion of suggestions.slice(0, 3)) { // Max 3 push notifications per cycle
                            const event: AnticipationEvent = {
                                type: "anticipation.suggestion",
                                data: {
                                    title: suggestion.title,
                                    description: suggestion.description || "",
                                    action: suggestion.action,
                                    actionParams: suggestion.actionParams as Record<string, unknown>,
                                    confidence: suggestion.confidence,
                                    category: suggestion.suggestionType,
                                },
                                timestamp: Date.now(),
                            };

                            broadcastToUser(userId, {
                                type: "anticipation.suggestion",
                                userId,
                                data: event.data,
                                timestamp: event.timestamp,
                            });
                        }
                    }
                } catch (err) {
                    console.warn(`[AnticipationEngine] Analysis failed for user ${userId}:`, err);
                }
            }

            if (totalSuggestions > 0) {
                console.log(`[AnticipationEngine] Cycle complete: ${totalSuggestions} total suggestions for ${activeUsers.length} active users`);
            }
        } catch (err) {
            console.error("[AnticipationEngine] Analysis cycle error:", err);
        }
    }

    // ============== PREDICTIVE CONTEXT ==============

    /**
     * Refresh predictive context for active users and feed into BrainHub.
     * This gives Ulysse's AI responses awareness of user patterns.
     */
    private async refreshPredictiveContexts(): Promise<void> {
        try {
            // Get the currently active user from BrainHub
            const consciousness = brainHub.getConsciousness();
            if (!consciousness.activeUserId) return;

            const userId = consciousness.activeUserId;
            const context = await this.buildPredictiveContext(userId);

            if (context.likelyIntent || context.timeBasedSuggestions.length > 0) {
                // Feed predictive context into BrainHub's working memory
                const contextSummary = this.formatContextForBrain(context);
                if (contextSummary) {
                    brainHub.addThought(contextSummary, 35); // Low importance — just context

                    // Also push to client for UI hints
                    broadcastToUser(userId, {
                        type: "anticipation.context",
                        userId,
                        data: {
                            likelyIntent: context.likelyIntent,
                            suggestions: context.timeBasedSuggestions,
                            recentFeatures: context.recentFeatures,
                        },
                        timestamp: Date.now(),
                    });
                }
            }

            try {
                const calendarAnticipations = await calendarAnticipationService.generateAnticipations(userId);
                const calendarContext = calendarAnticipationService.formatForBrain(calendarAnticipations);
                if (calendarContext) {
                    brainHub.addThought(calendarContext, 45);
                }
                if (calendarAnticipations.length > 0) {
                    broadcastToUser(userId, {
                        type: "anticipation.suggestion",
                        userId,
                        data: {
                            title: "Anticipations Calendrier",
                            description: calendarAnticipationService.formatForBriefing(calendarAnticipations),
                            category: "calendar",
                            confidence: 0.8,
                        },
                        timestamp: Date.now(),
                    });
                }
            } catch (calErr) {
                console.warn("[AnticipationEngine] Calendar anticipation failed:", calErr);
            }

            try {
                const { suguProactiveService } = await import("./suguProactiveService");
                const report = await suguProactiveService.getFullReport("valentine", 30);
                if (report.alertCount > 0) {
                    const summary = suguProactiveService.getBriefingSummary(report);
                    brainHub.addThought(`[SUGU Proactive] ${summary}`, 50);

                    broadcastToUser(userId, {
                        type: "anticipation.suggestion",
                        userId,
                        data: {
                            title: "Alertes SUGU",
                            description: summary,
                            category: "sugu_proactive",
                            confidence: 0.85,
                        },
                        timestamp: Date.now(),
                    });
                }
            } catch (suguErr) {
                console.warn("[AnticipationEngine] SUGU proactive failed:", suguErr);
            }
        } catch (err) {
            // Non-critical — just log and continue
            console.warn("[AnticipationEngine] Context refresh failed:", err);
        }
    }

    /**
     * Build predictive context for a user based on current time and past behavior.
     */
    async buildPredictiveContext(userId: number): Promise<PredictiveContext> {
        const context: PredictiveContext = {
            likelyIntent: null,
            timeBasedSuggestions: [],
            recentFeatures: [],
            activePatterns: [],
        };

        try {
            const now = new Date();
            const currentHour = now.getHours();
            const currentDay = now.getDay();

            // Get last 7 days of events for this time window
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

            const recentEvents = await db.select()
                .from(userBehaviorEvents)
                .where(eq(userBehaviorEvents.userId, userId))
                .orderBy(sql`${userBehaviorEvents.occurredAt} DESC`)
                .limit(100);

            if (recentEvents.length === 0) return context;

            // Find features used at similar times
            const timeMatchingFeatures = new Map<string, number>();
            for (const event of recentEvents) {
                const eventContext = event.context as Record<string, any>;
                const eventHour = eventContext?.hour;
                const eventDay = eventContext?.dayOfWeek;

                // Match events within ±1 hour of current time
                if (eventHour !== undefined && Math.abs(eventHour - currentHour) <= 1) {
                    const feature = event.targetName || event.eventType;
                    timeMatchingFeatures.set(feature, (timeMatchingFeatures.get(feature) || 0) + 1);
                }

                // Bonus for same day of week
                if (eventDay === currentDay && eventHour !== undefined && Math.abs(eventHour - currentHour) <= 2) {
                    const feature = event.targetName || event.eventType;
                    timeMatchingFeatures.set(feature, (timeMatchingFeatures.get(feature) || 0) + 2);
                }
            }

            // Sort by frequency and take top features
            const sortedFeatures = Array.from(timeMatchingFeatures.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5);

            if (sortedFeatures.length > 0) {
                context.likelyIntent = sortedFeatures[0][0];
                context.timeBasedSuggestions = sortedFeatures.map(([feature, count]) =>
                    `${feature} (${count}x at this time)`
                );
            }

            // Get recent features (last hour)
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            const recentFeatureSet = new Set<string>();
            for (const event of recentEvents) {
                if (event.occurredAt && event.occurredAt >= oneHourAgo) {
                    const name = event.targetName || event.eventType;
                    recentFeatureSet.add(name);
                }
            }
            context.recentFeatures = Array.from(recentFeatureSet).slice(0, 10);

            // Get active patterns
            const patterns = await behaviorService.getLearnedPatterns(userId);
            context.activePatterns = patterns
                .filter(p => p.isConfirmed)
                .slice(0, 5)
                .map(p => p.name);

        } catch (err) {
            console.warn("[AnticipationEngine] Build context failed:", err);
        }

        return context;
    }

    /**
     * Format predictive context as a natural language string for BrainHub.
     */
    private formatContextForBrain(context: PredictiveContext): string | null {
        const parts: string[] = [];

        if (context.likelyIntent) {
            parts.push(`L'utilisateur utilise souvent "${context.likelyIntent}" à cette heure`);
        }

        if (context.recentFeatures.length > 0) {
            parts.push(`Activité récente: ${context.recentFeatures.slice(0, 3).join(", ")}`);
        }

        if (context.activePatterns.length > 0) {
            parts.push(`Patterns appris: ${context.activePatterns.slice(0, 2).join(", ")}`);
        }

        if (parts.length === 0) return null;
        return `[Anticipation] ${parts.join(" | ")}`;
    }

    // ============== PUBLIC API ==============

    /**
     * Get current predictive context for a user (for API/dashboard).
     */
    async getContext(userId: number): Promise<PredictiveContext> {
        return this.buildPredictiveContext(userId);
    }

    /**
     * Force an analysis for a specific user (triggered by API).
     */
    async analyzeUser(userId: number): Promise<{ suggestionsCreated: number; context: PredictiveContext }> {
        const suggestionsCreated = await behaviorService.generateSuggestions(userId);
        const context = await this.buildPredictiveContext(userId);

        if (suggestionsCreated > 0) {
            const suggestions = await behaviorService.getPendingSuggestions(userId);
            for (const suggestion of suggestions.slice(0, 3)) {
                broadcastToUser(userId, {
                    type: "anticipation.suggestion",
                    userId,
                    data: {
                        title: suggestion.title,
                        description: suggestion.description || "",
                        action: suggestion.action,
                        confidence: suggestion.confidence,
                        category: suggestion.suggestionType,
                    },
                    timestamp: Date.now(),
                });
            }
        }

        return { suggestionsCreated, context };
    }
}

// ============== SINGLETON EXPORT ==============

export const anticipationEngine = new AnticipationEngine();
