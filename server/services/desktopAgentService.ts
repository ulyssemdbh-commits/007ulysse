/**
 * Desktop Agent Service - Phase 5
 * 
 * Server-side endpoint that receives desktop context from the companion agent.
 * The desktop agent (Electron/Tauri app running on user's machine) periodically sends:
 * - Active window title & app name
 * - Screen capture for OCR/vision analysis (optional)
 * - Clipboard content changes
 * - System notifications
 * 
 * This data feeds into BrainHub's consciousness and BehaviorService for pattern detection.
 * 
 * Architecture:
 * [Desktop Agent (Electron)] → POST /api/v2/desktop-agent/context → [This Service]
 *                                                                         ↓
 *                                                          [BrainHub] + [BehaviorService]
 *                                                                         ↓
 *                                                         [AnticipationEngine] → suggestions
 */

import { brainHub } from "./sensory/BrainHub";
import { behaviorService } from "./behaviorService";

// ============== TYPES ==============

export interface DesktopContext {
    activeWindow: {
        title: string;
        appName: string;
        url?: string;            // If browser, the current URL
    };
    clipboard?: {
        text: string;
        changedAt: number;
    };
    screenRegion?: {
        base64: string;           // Base64 encoded screenshot (small region)
        width: number;
        height: number;
    };
    systemInfo?: {
        os: string;
        hostname: string;
        uptime: number;
        batteryLevel?: number;
    };
    timestamp: number;
}

export interface DesktopAgentStatus {
    connected: boolean;
    lastSeen: number | null;
    eventsReceived: number;
    currentApp: string | null;
}

// ============== SERVICE ==============

class DesktopAgentService {
    private lastContext = new Map<number, DesktopContext>(); // userId → latest context
    private eventCounts = new Map<number, number>();          // userId → total events
    private lastAppChange = new Map<number, { app: string; since: number }>();

    /**
     * Process incoming desktop context from the agent.
     */
    async processContext(userId: number, context: DesktopContext): Promise<void> {
        const prevContext = this.lastContext.get(userId);
        this.lastContext.set(userId, context);
        this.eventCounts.set(userId, (this.eventCounts.get(userId) || 0) + 1);

        // Detect app switch
        const currentApp = context.activeWindow.appName;
        const prevApp = prevContext?.activeWindow.appName;

        if (currentApp !== prevApp) {
            const lastApp = this.lastAppChange.get(userId);
            const timeSpent = lastApp ? Date.now() - lastApp.since : 0;

            this.lastAppChange.set(userId, { app: currentApp, since: Date.now() });

            // Record app switch as behavior event
            await behaviorService.recordActivityEvent(userId, {
                type: "activity.feature",
                data: {
                    feature: "desktop_app",
                    action: "switch",
                    metadata: {
                        fromApp: prevApp || "unknown",
                        toApp: currentApp,
                        timeSpentMs: timeSpent,
                        windowTitle: context.activeWindow.title.substring(0, 200),
                        url: context.activeWindow.url,
                    },
                },
                timestamp: context.timestamp,
            }).catch(() => { });

            console.log(`[DesktopAgent] User ${userId} switched: ${prevApp} → ${currentApp}`);
        }

        // Feed BrainHub with desktop awareness
        this.updateBrainHub(userId, context, prevContext);

        // If clipboard changed, record it
        if (context.clipboard && prevContext?.clipboard?.text !== context.clipboard.text) {
            await behaviorService.recordActivityEvent(userId, {
                type: "activity.feature",
                data: {
                    feature: "desktop_clipboard",
                    action: "copy",
                    metadata: {
                        textLength: context.clipboard.text.length,
                        app: currentApp,
                    },
                },
                timestamp: context.timestamp,
            }).catch(() => { });
        }
    }

    /**
     * Update BrainHub with desktop context for AI awareness.
     */
    private updateBrainHub(userId: number, context: DesktopContext, prevContext?: DesktopContext): void {
        brainHub.processActivityEvent(userId, {
            type: "activity.feature",
            data: {
                feature: "desktop_context",
                action: "update",
                metadata: {
                    app: context.activeWindow.appName,
                    title: context.activeWindow.title.substring(0, 100),
                    url: context.activeWindow.url,
                },
            },
            timestamp: context.timestamp,
        });
    }

    /**
     * Get status of the desktop agent for a user.
     */
    getStatus(userId: number): DesktopAgentStatus {
        const lastCtx = this.lastContext.get(userId);
        return {
            connected: lastCtx ? (Date.now() - lastCtx.timestamp < 30_000) : false,
            lastSeen: lastCtx?.timestamp || null,
            eventsReceived: this.eventCounts.get(userId) || 0,
            currentApp: lastCtx?.activeWindow.appName || null,
        };
    }

    /**
     * Get the current desktop context for a user (for AI prompt injection).
     */
    getDesktopContextForAI(userId: number): string | null {
        const ctx = this.lastContext.get(userId);
        if (!ctx || Date.now() - ctx.timestamp > 60_000) return null; // Stale after 1 min

        let prompt = `[CONTEXTE DESKTOP]\n`;
        prompt += `App active: ${ctx.activeWindow.appName}\n`;
        prompt += `Fenêtre: ${ctx.activeWindow.title.substring(0, 150)}\n`;
        if (ctx.activeWindow.url) {
            prompt += `URL: ${ctx.activeWindow.url}\n`;
        }
        return prompt;
    }
}

export const desktopAgentService = new DesktopAgentService();
