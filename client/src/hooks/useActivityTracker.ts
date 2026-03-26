/**
 * useActivityTracker - Phase 1: Real-time User Activity Monitoring
 * 
 * Tracks and sends user activity events through WebSocket:
 * - Navigation (route changes with time spent)
 * - Idle state (active → idle → away)
 * - Feature usage (key UI interactions)
 * - Focus/visibility (tab visible/hidden, window focus)
 * 
 * All events are sent via the sendActivityEvent function provided
 * by useRealtimeSync. Events feed into BehaviorService + BrainHub
 * on the server for pattern detection and consciousness updates.
 */

import { useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";

// ============== TYPES ==============

export type ActivityEventType =
    | "activity.navigation"    // Route change
    | "activity.idle"          // Idle state change
    | "activity.feature"       // Feature/UI interaction
    | "activity.focus"         // Tab visibility / window focus
    | "activity.session";      // Session start/end

export type IdleState = "active" | "idle" | "away";

export interface ActivityEvent {
    type: ActivityEventType;
    data: Record<string, unknown>;
    timestamp: number;
}

export interface NavigationData {
    from: string;
    to: string;
    timeSpentMs: number;          // Time spent on previous page
}

export interface IdleData {
    state: IdleState;
    idleSinceMs: number;          // Duration of idle period
    lastInteraction: string;      // Last interaction type (mouse/keyboard/touch)
}

export interface FeatureData {
    feature: string;              // e.g. "voice_message", "file_upload", "search"
    action: string;               // e.g. "start", "complete", "cancel"
    metadata?: Record<string, unknown>;
}

export interface FocusData {
    visible: boolean;
    focused: boolean;
    hiddenDurationMs?: number;    // Time the tab was hidden
}

// ============== CONSTANTS ==============

const IDLE_TIMEOUT_MS = 30_000;       // 30s → idle
const AWAY_TIMEOUT_MS = 5 * 60_000;   // 5min → away
const DEBOUNCE_MS = 500;              // Debounce rapid events
const INTERACTION_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
const MAX_QUEUE_SIZE = 50;            // Max queued events before flush

// Feature tracking selectors — add custom data-track attributes in JSX
// e.g. <button data-track="voice_start">
const TRACK_ATTRIBUTE = "data-track";

// ============== HOOK ==============

interface UseActivityTrackerOptions {
    /** Function to send activity events through WebSocket */
    sendActivityEvent: (event: ActivityEvent) => void;
    /** Whether the WebSocket is authenticated */
    isAuthenticated?: boolean;
    /** Disable tracking (e.g. for dev/test) */
    disabled?: boolean;
}

export function useActivityTracker({
    sendActivityEvent,
    isAuthenticated = false,
    disabled = false,
}: UseActivityTrackerOptions) {
    const [location] = useLocation();

    // Refs for stable state across renders
    const locationRef = useRef(location);
    const locationEnteredAtRef = useRef(Date.now());
    const idleStateRef = useRef<IdleState>("active");
    const lastInteractionRef = useRef<string>("none");
    const lastInteractionTimeRef = useRef(Date.now());
    const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
    const awayTimerRef = useRef<NodeJS.Timeout | null>(null);
    const hiddenAtRef = useRef<number | null>(null);
    const isAuthenticatedRef = useRef(isAuthenticated);
    const sendRef = useRef(sendActivityEvent);
    const eventQueueRef = useRef<ActivityEvent[]>([]);
    const flushTimerRef = useRef<NodeJS.Timeout | null>(null);
    const debounceRef = useRef<NodeJS.Timeout | null>(null);

    // Keep refs in sync
    useEffect(() => {
        isAuthenticatedRef.current = isAuthenticated;
        sendRef.current = sendActivityEvent;
    }, [isAuthenticated, sendActivityEvent]);

    // ---- SEND HELPER (with queue & debounce) ----

    const queueEvent = useCallback((event: ActivityEvent) => {
        if (disabled || !isAuthenticatedRef.current) return;

        eventQueueRef.current.push(event);

        // Flush immediately if queue is full
        if (eventQueueRef.current.length >= MAX_QUEUE_SIZE) {
            flushQueue();
            return;
        }

        // Debounced flush
        if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
        flushTimerRef.current = setTimeout(flushQueue, DEBOUNCE_MS);
    }, [disabled]);

    const flushQueue = useCallback(() => {
        const events = eventQueueRef.current;
        if (events.length === 0) return;

        // Send each event individually (server expects single events)
        for (const event of events) {
            sendRef.current(event);
        }
        eventQueueRef.current = [];
    }, []);

    // ---- 1. NAVIGATION TRACKING ----

    useEffect(() => {
        if (disabled) return;

        const now = Date.now();
        const prevLocation = locationRef.current;
        const timeSpent = now - locationEnteredAtRef.current;

        // Don't send on initial mount (no meaningful navigation)  
        if (prevLocation !== location && prevLocation !== location) {
            queueEvent({
                type: "activity.navigation",
                data: {
                    from: prevLocation,
                    to: location,
                    timeSpentMs: timeSpent,
                } satisfies NavigationData,
                timestamp: now,
            });
        }

        locationRef.current = location;
        locationEnteredAtRef.current = now;
    }, [location, disabled, queueEvent]);

    // ---- 2. IDLE STATE DETECTION ----

    const resetIdleTimers = useCallback(() => {
        if (disabled) return;

        const now = Date.now();

        // If we were idle/away, transition back to active
        if (idleStateRef.current !== "active") {
            const idleSince = now - lastInteractionTimeRef.current;
            queueEvent({
                type: "activity.idle",
                data: {
                    state: "active",
                    idleSinceMs: idleSince,
                    lastInteraction: lastInteractionRef.current,
                } satisfies IdleData,
                timestamp: now,
            });
            idleStateRef.current = "active";
        }

        lastInteractionTimeRef.current = now;

        // Clear existing timers
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        if (awayTimerRef.current) clearTimeout(awayTimerRef.current);

        // Set idle timer (30s)
        idleTimerRef.current = setTimeout(() => {
            idleStateRef.current = "idle";
            queueEvent({
                type: "activity.idle",
                data: {
                    state: "idle",
                    idleSinceMs: IDLE_TIMEOUT_MS,
                    lastInteraction: lastInteractionRef.current,
                } satisfies IdleData,
                timestamp: Date.now(),
            });

            // Set away timer (5min from idle)
            awayTimerRef.current = setTimeout(() => {
                idleStateRef.current = "away";
                queueEvent({
                    type: "activity.idle",
                    data: {
                        state: "away",
                        idleSinceMs: AWAY_TIMEOUT_MS,
                        lastInteraction: lastInteractionRef.current,
                    } satisfies IdleData,
                    timestamp: Date.now(),
                });
            }, AWAY_TIMEOUT_MS - IDLE_TIMEOUT_MS);
        }, IDLE_TIMEOUT_MS);
    }, [disabled, queueEvent]);

    // Interaction event handler (with throttle)
    const handleInteraction = useCallback((e: Event) => {
        // Throttle — only process if enough time has passed
        const now = Date.now();
        if (now - lastInteractionTimeRef.current < 1000 && idleStateRef.current === "active") {
            return; // Already active, throttle the event
        }

        lastInteractionRef.current = e.type;
        resetIdleTimers();
    }, [resetIdleTimers]);

    useEffect(() => {
        if (disabled) return;

        for (const event of INTERACTION_EVENTS) {
            window.addEventListener(event, handleInteraction, { passive: true });
        }

        // Initialize idle timers
        resetIdleTimers();

        return () => {
            for (const event of INTERACTION_EVENTS) {
                window.removeEventListener(event, handleInteraction);
            }
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
            if (awayTimerRef.current) clearTimeout(awayTimerRef.current);
        };
    }, [disabled, handleInteraction, resetIdleTimers]);

    // ---- 3. FEATURE USAGE TRACKING ----

    useEffect(() => {
        if (disabled) return;

        const handleClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            // Walk up the DOM tree to find a data-track attribute
            let el: HTMLElement | null = target;
            let trackValue: string | null = null;
            while (el && !trackValue) {
                trackValue = el.getAttribute(TRACK_ATTRIBUTE);
                el = el.parentElement;
            }

            if (trackValue) {
                // Parse format: "feature:action" or just "feature" (defaults to "click")
                const [feature, action = "click"] = trackValue.split(":");
                queueEvent({
                    type: "activity.feature",
                    data: {
                        feature,
                        action,
                        metadata: {
                            page: locationRef.current,
                        },
                    } satisfies FeatureData,
                    timestamp: Date.now(),
                });
            }
        };

        document.addEventListener("click", handleClick, { passive: true, capture: true });

        return () => {
            document.removeEventListener("click", handleClick, true);
        };
    }, [disabled, queueEvent]);

    // ---- 4. FOCUS / VISIBILITY TRACKING ----

    useEffect(() => {
        if (disabled) return;

        const handleVisibilityChange = () => {
            const now = Date.now();
            const visible = document.visibilityState === "visible";

            if (!visible) {
                hiddenAtRef.current = now;
            }

            const hiddenDuration = hiddenAtRef.current && visible
                ? now - hiddenAtRef.current
                : undefined;

            if (visible) {
                hiddenAtRef.current = null;
            }

            queueEvent({
                type: "activity.focus",
                data: {
                    visible,
                    focused: document.hasFocus(),
                    hiddenDurationMs: hiddenDuration,
                } satisfies FocusData,
                timestamp: now,
            });
        };

        const handleFocusChange = () => {
            // Debounce focus events (they often fire with visibility)
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
                queueEvent({
                    type: "activity.focus",
                    data: {
                        visible: document.visibilityState === "visible",
                        focused: document.hasFocus(),
                    } satisfies FocusData,
                    timestamp: Date.now(),
                });
            }, 200);
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.addEventListener("focus", handleFocusChange);
        window.addEventListener("blur", handleFocusChange);

        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            window.removeEventListener("focus", handleFocusChange);
            window.removeEventListener("blur", handleFocusChange);
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [disabled, queueEvent]);

    // ---- 5. SESSION TRACKING ----

    useEffect(() => {
        if (disabled || !isAuthenticated) return;

        // Send session start
        queueEvent({
            type: "activity.session",
            data: {
                action: "start",
                userAgent: navigator.userAgent,
                screenWidth: window.screen.width,
                screenHeight: window.screen.height,
                language: navigator.language,
                page: location,
            },
            timestamp: Date.now(),
        });

        // Send session end on unmount
        return () => {
            // Synchronous send for unload — use sendBeacon as backup
            const endEvent: ActivityEvent = {
                type: "activity.session",
                data: { action: "end", page: locationRef.current },
                timestamp: Date.now(),
            };
            sendRef.current(endEvent);
        };
    }, [disabled, isAuthenticated]); // Only on auth change or unmount

    // ---- CLEANUP ----

    useEffect(() => {
        return () => {
            // Flush remaining events on unmount
            flushQueue();
            if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
        };
    }, [flushQueue]);

    // ---- PUBLIC API ----

    /** Manually track a feature usage (for imperative tracking) */
    const trackFeature = useCallback((feature: string, action: string = "use", metadata?: Record<string, unknown>) => {
        if (disabled) return;
        queueEvent({
            type: "activity.feature",
            data: {
                feature,
                action,
                metadata: { ...metadata, page: locationRef.current },
            } satisfies FeatureData,
            timestamp: Date.now(),
        });
    }, [disabled, queueEvent]);

    return { trackFeature };
}
