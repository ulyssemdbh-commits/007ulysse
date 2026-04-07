/**
 * Central cleanup registry for graceful shutdown.
 * Services register their intervals, timeouts, and cleanup callbacks here.
 * The registry is wired to SIGTERM/SIGINT in server/index.ts.
 *
 * Usage:
 *   import { cleanupRegistry } from './core/cleanupRegistry.js';
 *   const handle = setInterval(() => doWork(), 60_000);
 *   cleanupRegistry.registerInterval(handle, 'CacheService.cleanup');
 *
 *   // or register a custom callback:
 *   cleanupRegistry.registerCallback(() => browser.close(), 'Playwright.browser');
 */

type CleanupEntry = {
    type: "interval" | "timeout" | "callback";
    handle?: ReturnType<typeof setInterval>;
    callback?: () => void | Promise<void>;
    label: string;
};

class CleanupRegistry {
    private entries: CleanupEntry[] = [];

    /** Register a setInterval handle for cleanup on shutdown. */
    registerInterval(
        handle: ReturnType<typeof setInterval>,
        label: string
    ): void {
        this.entries.push({ type: "interval", handle, label });
    }

    /** Register a setTimeout handle for cleanup on shutdown. */
    registerTimeout(
        handle: ReturnType<typeof setTimeout>,
        label: string
    ): void {
        this.entries.push({ type: "timeout", handle, label });
    }

    /** Register an arbitrary async cleanup callback. */
    registerCallback(
        callback: () => void | Promise<void>,
        label: string
    ): void {
        this.entries.push({ type: "callback", callback, label });
    }

    /** Run all cleanup. Called from the shutdown handler. */
    async runAll(): Promise<void> {
        console.log(
            `[CleanupRegistry] Cleaning up ${this.entries.length} registered resources…`
        );
        for (const entry of this.entries) {
            try {
                if (entry.type === "interval" && entry.handle) {
                    clearInterval(entry.handle);
                } else if (entry.type === "timeout" && entry.handle) {
                    clearTimeout(entry.handle);
                } else if (entry.type === "callback" && entry.callback) {
                    await entry.callback();
                }
                console.log(`  ✓ ${entry.label}`);
            } catch (e) {
                console.warn(
                    `  ✗ ${entry.label}:`,
                    e instanceof Error ? e.message : e
                );
            }
        }
        this.entries = [];
    }

    /** How many entries are registered (for diagnostics). */
    get size(): number {
        return this.entries.length;
    }
}

export const cleanupRegistry = new CleanupRegistry();
