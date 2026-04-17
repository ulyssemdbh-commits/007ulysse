import OpenAI from "openai";
type ChatCompletionTool = OpenAI.Chat.Completions.ChatCompletionTool;

// ─── Tool definitions for previously disconnected services ──────────────────

export const integrationToolDefs: ChatCompletionTool[] = [

    // ══════════════════════════════════════════════════════════════════════════
    // NOTION
    // ══════════════════════════════════════════════════════════════════════════
    {
        type: "function",
        function: {
            name: "notion_manage",
            description: "Gère Notion : rechercher des pages, lister les bases de données, lire/créer/modifier des pages. Permet d'organiser les connaissances, notes de projet, docs partagés.",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["search", "list_databases", "query_database", "create_page", "read_page", "append_page"],
                        description: "Action à effectuer"
                    },
                    query: { type: "string", description: "Recherche (pour action 'search')" },
                    databaseId: { type: "string", description: "ID de la base Notion (pour query_database, create_page dans une base)" },
                    pageId: { type: "string", description: "ID de la page (pour read_page, append_page)" },
                    title: { type: "string", description: "Titre de la page (pour create_page)" },
                    content: { type: "string", description: "Contenu texte (pour create_page, append_page)" },
                    parentId: { type: "string", description: "ID page parente optionnelle (pour create_page)" },
                    limit: { type: "number", description: "Nombre max de résultats" }
                },
                required: ["action"]
            }
        }
    },

    // ══════════════════════════════════════════════════════════════════════════
    // GOOGLE DRIVE
    // ══════════════════════════════════════════════════════════════════════════
    {
        type: "function",
        function: {
            name: "drive_manage",
            description: "Gère Google Drive : lister des fichiers, rechercher, créer des dossiers/docs/sheets, supprimer, voir le quota. Permet d'organiser et retrouver tous les documents stockés dans le Drive.",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["list_files", "search", "create_folder", "create_doc", "create_sheet", "trash", "recent", "quota"],
                        description: "Action à effectuer"
                    },
                    query: { type: "string", description: "Recherche (pour 'search')" },
                    folderId: { type: "string", description: "ID du dossier (pour list_files)" },
                    name: { type: "string", description: "Nom du fichier/dossier à créer" },
                    parentId: { type: "string", description: "ID du dossier parent" },
                    fileId: { type: "string", description: "ID du fichier (pour trash)" },
                    limit: { type: "number", description: "Nombre max de résultats" }
                },
                required: ["action"]
            }
        }
    },

    // ══════════════════════════════════════════════════════════════════════════
    // TRADING ALERTS
    // ══════════════════════════════════════════════════════════════════════════
    {
        type: "function",
        function: {
            name: "trading_alerts",
            description: "Gère les alertes de trading : créer des alertes de prix, RSI, support/résistance. Lister, annuler, voir le statut. Peut aussi parser des demandes en langage naturel ('préviens-moi si TSLA passe sous 150').",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["create_price", "create_rsi", "create_sr", "parse_text", "list", "cancel", "status", "notifications", "watchlist_add", "watchlist_remove", "watchlist_list"],
                        description: "Action à effectuer"
                    },
                    symbol: { type: "string", description: "Symbole boursier (AAPL, TSLA, BTC...)" },
                    targetPrice: { type: "number", description: "Prix cible (pour create_price)" },
                    direction: { type: "string", enum: ["above", "below"], description: "Direction de l'alerte prix" },
                    threshold: { type: "number", description: "Seuil RSI (pour create_rsi)" },
                    condition: { type: "string", enum: ["overbought", "oversold"], description: "Condition RSI" },
                    level: { type: "number", description: "Niveau support/résistance" },
                    levelType: { type: "string", enum: ["support", "resistance"], description: "Type de niveau S/R" },
                    text: { type: "string", description: "Texte en langage naturel (pour parse_text)" },
                    alertId: { type: "string", description: "ID de l'alerte (pour cancel)" },
                    limit: { type: "number", description: "Nombre max de résultats" }
                },
                required: ["action"]
            }
        }
    },

    // ══════════════════════════════════════════════════════════════════════════
    // NAVIGATION / ITINERARY
    // ══════════════════════════════════════════════════════════════════════════
    {
        type: "function",
        function: {
            name: "navigation_manage",
            description: "Gère la navigation GPS et les itinéraires : créer un itinéraire, calculer un trajet, sauvegarder/lister les routes. Calcule le temps de trajet, la distance, les étapes.",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["calculate_route", "save_route", "list_routes", "delete_route", "start_navigation"],
                        description: "Action à effectuer"
                    },
                    origin: { type: "string", description: "Adresse ou coordonnées de départ" },
                    destination: { type: "string", description: "Adresse ou coordonnées d'arrivée" },
                    mode: { type: "string", enum: ["driving", "walking", "transit", "bicycling"], description: "Mode de transport" },
                    routeId: { type: "string", description: "ID de la route (pour delete/start)" },
                    name: { type: "string", description: "Nom de la route à sauvegarder" }
                },
                required: ["action"]
            }
        }
    },

    // ══════════════════════════════════════════════════════════════════════════
    // VIDEO ANALYSIS
    // ══════════════════════════════════════════════════════════════════════════
    {
        type: "function",
        function: {
            name: "analyze_video",
            description: "Analyse une vidéo : extraction de frames, transcription audio (Whisper), analyse visuelle (GPT-4 Vision), détection de visages, résumé. Utile pour analyser des vidéos de surveillance, des enregistrements, des contenus.",
            parameters: {
                type: "object",
                properties: {
                    filePath: { type: "string", description: "Chemin vers le fichier vidéo" },
                    maxFrames: { type: "number", description: "Nombre max frames à analyser (défaut: 10)" },
                    transcribeAudio: { type: "boolean", description: "Transcrire l'audio? (défaut: true)" },
                    detectFaces: { type: "boolean", description: "Détecter les visages? (défaut: false)" }
                },
                required: ["filePath"]
            }
        }
    },

    // ══════════════════════════════════════════════════════════════════════════
    // MONITORING (Website Uptime)
    // ══════════════════════════════════════════════════════════════════════════
    {
        type: "function",
        function: {
            name: "monitoring_manage",
            description: "Gère le monitoring de sites web et services : ajouter/supprimer un site à surveiller, voir le statut, les alertes récentes, les temps de réponse. Surveille la disponibilité des sites.",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["add_url", "remove_url", "list", "status", "alerts"],
                        description: "Action à effectuer"
                    },
                    url: { type: "string", description: "URL du site à surveiller" },
                    name: { type: "string", description: "Nom pour identifier le site" },
                    checkInterval: { type: "number", description: "Intervalle de vérification en minutes" },
                    monitorId: { type: "string", description: "ID du moniteur (pour remove)" }
                },
                required: ["action"]
            }
        }
    },
];

// ─── Handler implementations ─────────────────────────────────────────────────

// ── NOTION ────────────────────────────────────────────────────────────────────
export async function executeNotionManage(args: Record<string, any>): Promise<string> {
    try {
        const notionService: any = await import("../notionService");
        const { action, query, databaseId, pageId, title, content, parentId, limit } = args;

        switch (action) {
            case "search": {
                if (!query) return JSON.stringify({ error: "Paramètre 'query' requis pour la recherche" });
                const results = await notionService.search(query, limit || 10);
                return JSON.stringify({ type: "notion_search", query, count: results.length, results });
            }
            case "list_databases": {
                const dbs = await notionService.listDatabases();
                return JSON.stringify({ type: "notion_databases", count: dbs.length, databases: dbs });
            }
            case "query_database": {
                if (!databaseId) return JSON.stringify({ error: "Paramètre 'databaseId' requis" });
                const pages = await notionService.queryDatabase(databaseId, limit || 20);
                return JSON.stringify({ type: "notion_db_query", databaseId, count: pages.length, pages });
            }
            case "create_page": {
                if (!title) return JSON.stringify({ error: "Paramètre 'title' requis" });
                let result;
                if (databaseId) {
                    result = await notionService.createDatabasePage(databaseId, { Name: { title: [{ text: { content: title } }] } });
                } else {
                    result = await notionService.createPage(title, content || "", parentId);
                }
                return JSON.stringify({ type: "notion_page_created", success: true, page: result });
            }
            case "read_page": {
                if (!pageId) return JSON.stringify({ error: "Paramètre 'pageId' requis" });
                const pageContent = await notionService.getPageContent(pageId);
                return JSON.stringify({ type: "notion_page_content", pageId, content: pageContent });
            }
            case "append_page": {
                if (!pageId || !content) return JSON.stringify({ error: "Paramètres 'pageId' et 'content' requis" });
                await notionService.appendToPage(pageId, content);
                return JSON.stringify({ type: "notion_page_appended", success: true, pageId });
            }
            default:
                return JSON.stringify({ error: `Action Notion inconnue: ${action}` });
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[notion_manage] Error:", msg);
        return JSON.stringify({ error: `Erreur Notion: ${msg}` });
    }
}

// ── GOOGLE DRIVE ──────────────────────────────────────────────────────────────
export async function executeDriveManage(args: Record<string, any>): Promise<string> {
    try {
        const googleDriveService: any = await import("../googleDriveService");
        const { action, query, folderId, name, parentId, fileId, limit } = args;

        switch (action) {
            case "list_files": {
                const files = await googleDriveService.listFiles(folderId, limit || 20);
                return JSON.stringify({ type: "drive_files", count: files.length, files });
            }
            case "search": {
                if (!query) return JSON.stringify({ error: "Paramètre 'query' requis" });
                const files = await googleDriveService.searchFiles(query, limit || 20);
                return JSON.stringify({ type: "drive_search", query, count: files.length, files });
            }
            case "create_folder": {
                if (!name) return JSON.stringify({ error: "Paramètre 'name' requis" });
                const folder = await googleDriveService.createFolder(name, parentId);
                return JSON.stringify({ type: "drive_folder_created", success: true, folder });
            }
            case "create_doc": {
                if (!name) return JSON.stringify({ error: "Paramètre 'name' requis" });
                const doc = await googleDriveService.createGoogleDoc(name, parentId);
                return JSON.stringify({ type: "drive_doc_created", success: true, doc });
            }
            case "create_sheet": {
                if (!name) return JSON.stringify({ error: "Paramètre 'name' requis" });
                const sheet = await googleDriveService.createGoogleSheet(name, parentId);
                return JSON.stringify({ type: "drive_sheet_created", success: true, sheet });
            }
            case "trash": {
                if (!fileId) return JSON.stringify({ error: "Paramètre 'fileId' requis" });
                await googleDriveService.trashFile(fileId);
                return JSON.stringify({ type: "drive_trashed", success: true, fileId });
            }
            case "recent": {
                const files = await googleDriveService.getRecentFiles(limit || 10);
                return JSON.stringify({ type: "drive_recent", count: files.length, files });
            }
            case "quota": {
                const quota = await googleDriveService.getStorageQuota();
                return JSON.stringify({ type: "drive_quota", ...quota });
            }
            default:
                return JSON.stringify({ error: `Action Drive inconnue: ${action}` });
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[drive_manage] Error:", msg);
        return JSON.stringify({ error: `Erreur Google Drive: ${msg}` });
    }
}

// ── TRADING ALERTS ────────────────────────────────────────────────────────────
export async function executeTradingAlerts(args: Record<string, any>, userId: number): Promise<string> {
    try {
        const { tradingAlertsService } = await import("../tradingAlertsService");
        const { action, symbol, targetPrice, direction, threshold, condition, level, levelType, text, alertId, limit } = args;

        switch (action) {
            case "create_price": {
                if (!symbol || targetPrice == null || !direction) return JSON.stringify({ error: "Paramètres 'symbol', 'targetPrice', 'direction' requis" });
                const alert = await tradingAlertsService.createPriceAlert(userId, symbol.toUpperCase(), targetPrice, direction);
                return JSON.stringify({ type: "alert_created", alertType: "price", ...alert });
            }
            case "create_rsi": {
                if (!symbol || threshold == null || !condition) return JSON.stringify({ error: "Paramètres 'symbol', 'threshold', 'condition' requis" });
                const alert = await tradingAlertsService.createRSIAlert(userId, symbol.toUpperCase(), threshold, condition);
                return JSON.stringify({ type: "alert_created", alertType: "rsi", ...alert });
            }
            case "create_sr": {
                if (!symbol || level == null || !levelType) return JSON.stringify({ error: "Paramètres 'symbol', 'level', 'levelType' requis" });
                const alert = await tradingAlertsService.createSupportResistanceAlert(userId, symbol.toUpperCase(), level, levelType);
                return JSON.stringify({ type: "alert_created", alertType: "support_resistance", ...alert });
            }
            case "parse_text": {
                if (!text) return JSON.stringify({ error: "Paramètre 'text' requis" });
                const alert = await tradingAlertsService.parseAlertFromText(userId, text);
                return JSON.stringify({ type: "alert_parsed", ...alert });
            }
            case "list": {
                const alerts = await tradingAlertsService.getAlertsByUser(userId);
                return JSON.stringify({ type: "alerts_list", count: alerts.length, alerts });
            }
            case "cancel": {
                if (!alertId) return JSON.stringify({ error: "Paramètre 'alertId' requis" });
                await tradingAlertsService.cancelAlert(alertId);
                return JSON.stringify({ type: "alert_cancelled", alertId, success: true });
            }
            case "status": {
                const status = await tradingAlertsService.getStatus();
                return JSON.stringify({ type: "alerts_status", ...status });
            }
            case "notifications": {
                const notifs = await tradingAlertsService.getRecentNotifications(limit || 10);
                return JSON.stringify({ type: "alert_notifications", count: notifs.length, notifications: notifs });
            }
            case "watchlist_add": {
                if (!symbol) return JSON.stringify({ error: "Paramètre 'symbol' requis" });
                await tradingAlertsService.addToWatchlist(symbol.toUpperCase());
                return JSON.stringify({ type: "watchlist_added", symbol: symbol.toUpperCase(), success: true });
            }
            case "watchlist_remove": {
                if (!symbol) return JSON.stringify({ error: "Paramètre 'symbol' requis" });
                await tradingAlertsService.removeFromWatchlist(symbol.toUpperCase());
                return JSON.stringify({ type: "watchlist_removed", symbol: symbol.toUpperCase(), success: true });
            }
            case "watchlist_list": {
                const wl = await tradingAlertsService.getWatchlist();
                return JSON.stringify({ type: "watchlist", count: wl.length, symbols: wl });
            }
            default:
                return JSON.stringify({ error: `Action trading alerts inconnue: ${action}` });
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[trading_alerts] Error:", msg);
        return JSON.stringify({ error: `Erreur alertes trading: ${msg}` });
    }
}

// ── NAVIGATION / ITINERARY ────────────────────────────────────────────────────
export async function executeNavigationManage(args: Record<string, any>, userId: number): Promise<string> {
    try {
        const itineraryMod = await import("../itineraryService");
        const itineraryService = itineraryMod.itineraryService || itineraryMod.default;
        if (!itineraryService) return JSON.stringify({ error: "Service itinéraire non disponible" });

        const { action, origin, destination, mode, routeId, name } = args;

        switch (action) {
            case "calculate_route": {
                if (!origin || !destination) return JSON.stringify({ error: "Paramètres 'origin' et 'destination' requis" });
                const route = await itineraryService.calculateRoute(origin, destination, mode || "driving");
                return JSON.stringify({ type: "route_calculated", ...route });
            }
            case "save_route": {
                if (!origin || !destination) return JSON.stringify({ error: "Paramètres 'origin' et 'destination' requis" });
                const saved = await itineraryService.saveRoute(userId, {
                    name: name || `${origin} → ${destination}`,
                    origin, destination, mode: mode || "driving"
                });
                return JSON.stringify({ type: "route_saved", success: true, ...saved });
            }
            case "list_routes": {
                const routes = await itineraryService.getRoutes(userId);
                return JSON.stringify({ type: "routes_list", count: routes.length, routes });
            }
            case "delete_route": {
                if (!routeId) return JSON.stringify({ error: "Paramètre 'routeId' requis" });
                await itineraryService.deleteRoute(routeId);
                return JSON.stringify({ type: "route_deleted", routeId, success: true });
            }
            case "start_navigation": {
                if (!routeId && (!origin || !destination)) return JSON.stringify({ error: "Paramètres 'routeId' ou 'origin'+'destination' requis" });
                const nav = await itineraryService.startNavigation(userId, routeId || null, origin, destination, mode);
                return JSON.stringify({ type: "navigation_started", ...nav });
            }
            default:
                return JSON.stringify({ error: `Action navigation inconnue: ${action}` });
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[navigation_manage] Error:", msg);
        return JSON.stringify({ error: `Erreur navigation: ${msg}` });
    }
}

// ── VIDEO ANALYSIS ────────────────────────────────────────────────────────────
export async function executeVideoAnalysis(args: Record<string, any>): Promise<string> {
    try {
        const videoAnalysisService = await import("../videoAnalysisService");
        const { getOpenAI: getAI } = await import("../../services/core/openaiClient");
        const openai = getAI();

        const { filePath, maxFrames, transcribeAudio, detectFaces } = args;
        if (!filePath) return JSON.stringify({ error: "Paramètre 'filePath' requis" });

        const result = await videoAnalysisService.analyzeVideo(filePath, 0, openai, {
            maxFrames: maxFrames || 10,
            transcribeAudio: transcribeAudio !== false,
            detectFaces: detectFaces || false
        });

        return JSON.stringify({
            type: "video_analysis",
            success: true,
            duration: result.metadata?.duration,
            resolution: result.metadata?.resolution,
            framesAnalyzed: result.frames?.length || 0,
            hasTranscription: !!result.transcription,
            facesDetected: result.faces?.length || 0,
            summary: result.summary,
            keyMoments: result.keyMoments
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[analyze_video] Error:", msg);
        return JSON.stringify({ error: `Erreur analyse vidéo: ${msg}` });
    }
}

// ── MONITORING ────────────────────────────────────────────────────────────────
export async function executeMonitoringManage(args: Record<string, any>): Promise<string> {
    try {
        const monitoringMod = await import("../monitoringService");
        const monitoringService = monitoringMod.monitoringService || monitoringMod.default;
        if (!monitoringService) return JSON.stringify({ error: "Service monitoring non disponible" });

        const { action, url, name, checkInterval, monitorId } = args;

        switch (action) {
            case "add_url": {
                if (!url) return JSON.stringify({ error: "Paramètre 'url' requis" });
                const monitor = await monitoringService.addUrl(url, name || url, checkInterval || 5);
                return JSON.stringify({ type: "monitor_added", success: true, ...monitor });
            }
            case "remove_url": {
                if (!monitorId) return JSON.stringify({ error: "Paramètre 'monitorId' requis" });
                await monitoringService.removeUrl(monitorId);
                return JSON.stringify({ type: "monitor_removed", monitorId, success: true });
            }
            case "list": {
                const monitors = await monitoringService.getMonitors();
                return JSON.stringify({ type: "monitors_list", count: monitors.length, monitors });
            }
            case "status": {
                const status = await monitoringService.getStatus();
                return JSON.stringify({ type: "monitoring_status", ...status });
            }
            case "alerts": {
                const alerts = await monitoringService.getAlerts();
                return JSON.stringify({ type: "monitoring_alerts", count: alerts.length, alerts });
            }
            default:
                return JSON.stringify({ error: `Action monitoring inconnue: ${action}` });
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[monitoring_manage] Error:", msg);
        return JSON.stringify({ error: `Erreur monitoring: ${msg}` });
    }
}
