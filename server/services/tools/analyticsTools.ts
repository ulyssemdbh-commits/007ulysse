import OpenAI from "openai";

type ChatCompletionTool = OpenAI.Chat.Completions.ChatCompletionTool;

// ─── Tool definitions ────────────────────────────────────────────────

export const analyticsToolDefs: ChatCompletionTool[] = [
    // === BETS TRACKER TOOL ===
    {
        type: "function",
        function: {
            name: "query_bets_tracker",
            description: "Consulte les statistiques du Bets Tracker: paris réels placés, ROI, win rate, performance par type de pari, par ligue, par bookmaker, par tranche de cotes. Dashboard complet des paris sportifs réels (pas les prédictions, mais les vrais paris).",
            parameters: {
                type: "object",
                properties: {
                    action: { type: "string", enum: ["dashboard", "stats", "pending", "recent", "best_types", "worst_types", "by_league", "by_bookmaker", "by_odds_range"], description: "Type de requête" },
                    days: { type: "number", description: "Période d'analyse en jours (défaut 30)" }
                },
                required: ["action"]
            }
        }
    },
    // === SUGU ANALYTICS TOOL ===
    {
        type: "function",
        function: {
            name: "query_sugu_analytics",
            description: "Analyse avancée des courses Suguval/Sugumaillane: rotation des produits, ruptures de stock, tendances, insights actionnables. Données analytiques issues de /courses/suguval et /courses/sugumaillane.",
            parameters: {
                type: "object",
                properties: {
                    store: { type: "string", enum: ["suguval", "sugumaillane"], description: "Magasin à analyser" },
                    action: { type: "string", enum: ["rotation", "stockouts", "insights", "categories"], description: "Type d'analyse" },
                    days: { type: "number", description: "Période d'analyse en jours (défaut 30)" }
                },
                required: ["store", "action"]
            }
        }
    },
    // === DAILY SUMMARY TOOL ===
    {
        type: "function",
        function: {
            name: "query_daily_summary",
            description: "Génère le résumé quotidien d'Ulysse: conversations du jour, actions effectuées, emails envoyés/reçus, paris, événements calendrier, anomalies détectées. Utile pour briefer Maurice le matin ou faire un récap le soir.",
            parameters: {
                type: "object",
                properties: {
                    date: { type: "string", description: "Date au format YYYY-MM-DD (défaut: aujourd'hui)" }
                }
            }
        }
    },
];

// ─── Handler implementations ─────────────────────────────────────────

export async function executeBetsTrackerQuery(args: { action: string; days?: number }, userId: number): Promise<string> {
    try {
        const { betsTrackerService } = await import("../betsTrackerService");
        const { action, days = 30 } = args;

        switch (action) {
            case "dashboard": {
                const dashboard = await betsTrackerService.getFullDashboard(userId);
                return JSON.stringify({
                    overall: dashboard.overall,
                    bestTypes: dashboard.bestTypes,
                    worstTypes: dashboard.worstTypes,
                    pendingCount: dashboard.pendingBets.length,
                    recentBets: dashboard.recentBets.slice(0, 5).map(b => ({
                        match: `${b.homeTeam} vs ${b.awayTeam}`,
                        bet: b.betType,
                        odds: b.odds,
                        stake: b.stake,
                        status: b.status,
                        profit: b.profit
                    })),
                    topLeagues: dashboard.byLeague.slice(0, 5)
                });
            }
            case "stats":
                return JSON.stringify(await betsTrackerService.getStats(userId, days));
            case "pending": {
                const pending = await betsTrackerService.getPendingBets(userId);
                return JSON.stringify(pending.map(b => ({
                    match: `${b.homeTeam} vs ${b.awayTeam}`,
                    bet: b.betType,
                    odds: b.odds,
                    stake: b.stake,
                    matchDate: b.matchDate
                })));
            }
            case "recent": {
                const recent = await betsTrackerService.getRecentBets(userId, 20);
                return JSON.stringify(recent.map(b => ({
                    match: `${b.homeTeam} vs ${b.awayTeam}`,
                    bet: b.betType,
                    odds: b.odds,
                    stake: b.stake,
                    status: b.status,
                    profit: b.profit
                })));
            }
            case "best_types":
                return JSON.stringify(await betsTrackerService.getBestPerformingBetTypes(userId));
            case "worst_types":
                return JSON.stringify(await betsTrackerService.getWorstPerformingBetTypes(userId));
            case "by_league":
                return JSON.stringify(await betsTrackerService.getStatsByLeague(userId, days));
            case "by_bookmaker":
                return JSON.stringify(await betsTrackerService.getStatsByBookmaker(userId, days));
            case "by_odds_range":
                return JSON.stringify(await betsTrackerService.getStatsByOddsRange(userId, days));
            default:
                return JSON.stringify({ error: `Action inconnue: ${action}` });
        }
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[BetsTracker Tool] Error:", msg);
        return JSON.stringify({ error: msg });
    }
}

export async function executeSuguAnalyticsQuery(args: { store: string; action: string; days?: number }): Promise<string> {
    try {
        const { suguAnalyticsService } = await import("../suguAnalyticsService");
        const { store, action, days = 30 } = args;
        const storeType = store as "suguval" | "sugumaillane";

        switch (action) {
            case "rotation": {
                const rotation = await suguAnalyticsService.analyzeRotation(storeType, days);
                return JSON.stringify({
                    store,
                    period: `${days} jours`,
                    topRotation: rotation.slice(0, 10).map(r => ({
                        item: r.itemName,
                        category: r.categoryName,
                        purchases: r.checkCount,
                        trend: r.trend,
                        lastBought: r.lastChecked
                    })),
                    lowRotation: rotation.filter(r => r.checkCount === 0).map(r => ({
                        item: r.itemName,
                        category: r.categoryName,
                        neverBoughtIn: `${days} jours`
                    }))
                });
            }
            case "stockouts": {
                const stockouts = await suguAnalyticsService.analyzeStockouts(storeType, days);
                return JSON.stringify({
                    store,
                    stockouts: stockouts.slice(0, 15).map(s => ({
                        item: s.itemName,
                        category: s.categoryName,
                        frequency: s.stockoutFrequency,
                        avgDuration: s.avgStockoutDuration
                    }))
                });
            }
            case "insights": {
                const insights = await suguAnalyticsService.getActionableInsights();
                return JSON.stringify({ store, insights });
            }
            case "categories": {
                const rotation = await suguAnalyticsService.analyzeRotation(storeType, days);
                const byCategory = new Map<string, { total: number; active: number }>();
                for (const r of rotation) {
                    const cat = byCategory.get(r.categoryName) || { total: 0, active: 0 };
                    cat.total++;
                    if (r.checkCount > 0) cat.active++;
                    byCategory.set(r.categoryName, cat);
                }
                return JSON.stringify({
                    store,
                    categories: Array.from(byCategory.entries()).map(([name, data]) => ({
                        category: name,
                        totalItems: data.total,
                        activeItems: data.active,
                        usageRate: Math.round((data.active / data.total) * 100) + "%"
                    }))
                });
            }
            default:
                return JSON.stringify({ error: `Action inconnue: ${action}` });
        }
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[SuguAnalytics Tool] Error:", msg);
        return JSON.stringify({ error: msg });
    }
}

export async function executeDailySummaryQuery(args: { date?: string }, userId: number): Promise<string> {
    try {
        const targetDate = args.date || new Date().toISOString().split("T")[0];
        const dayStart = new Date(targetDate + "T00:00:00");
        const dayEnd = new Date(targetDate + "T23:59:59");
        const { db } = await import("../../db");
        const { conversations, messages, perfMetrics, ulysseMemory, actualBets } = await import("@shared/schema");
        const { and, eq, gte, lte, sql, count, desc } = await import("drizzle-orm");

        // Conversations count
        const [convCount] = await db.select({ count: count() })
            .from(conversations)
            .where(and(eq(conversations.userId, userId), gte(conversations.updatedAt, dayStart)));

        // Messages count
        const [msgCount] = await db.select({ count: count() })
            .from(messages)
            .where(and(eq(messages.userId, userId), gte(messages.createdAt, dayStart)));

        // Memories created today
        const [memCount] = await db.select({ count: count() })
            .from(ulysseMemory)
            .where(and(eq(ulysseMemory.userId, userId), gte(ulysseMemory.createdAt, dayStart)));

        // Bets placed today
        const todayBets = await db.select()
            .from(actualBets)
            .where(and(eq(actualBets.userId, userId), gte(actualBets.createdAt, dayStart)))
            .orderBy(desc(actualBets.createdAt));

        // Performance metrics
        const [metricsCount] = await db.select({ count: count() })
            .from(perfMetrics)
            .where(gte(perfMetrics.timestamp, dayStart));

        return JSON.stringify({
            date: targetDate,
            summary: {
                conversations: convCount?.count || 0,
                messages: msgCount?.count || 0,
                memoriesCreated: memCount?.count || 0,
                betsPlaced: todayBets.length,
                systemEvents: metricsCount?.count || 0,
            },
            bets: todayBets.map(b => ({
                match: `${b.homeTeam} vs ${b.awayTeam}`,
                type: b.betType,
                odds: b.odds,
                stake: b.stake,
                status: b.status
            }))
        });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[DailySummary Tool] Error:", msg);
        return JSON.stringify({ error: msg });
    }
}
