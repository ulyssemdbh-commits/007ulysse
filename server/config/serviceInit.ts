/**
 * Service Initialization Manager
 * 
 * Manages the startup order of services with dependency resolution.
 * Prevents race conditions where Service A depends on Service B
 * but B hasn't initialized yet.
 * 
 * Also catches and logs unhandled promise rejections globally.
 */

type ServiceInitFn = () => Promise<void>;

interface ServiceConfig {
    name: string;
    init: ServiceInitFn;
    dependsOn?: string[];
    critical?: boolean; // If true, server stops on failure
    timeout?: number;   // Max time in ms
}

interface ServiceResult {
    name: string;
    status: 'ok' | 'failed' | 'skipped' | 'timeout';
    durationMs: number;
    error?: string;
}

export class ServiceInitManager {
    private services: Map<string, ServiceConfig> = new Map();
    private initialized: Set<string> = new Set();
    private results: ServiceResult[] = [];

    register(config: ServiceConfig): void {
        this.services.set(config.name, config);
    }

    /**
     * Initialize all registered services in dependency order
     */
    async initializeAll(): Promise<ServiceResult[]> {
        this.results = [];
        this.initialized.clear();

        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('[ServiceInit] Starting service initialization...');
        console.log('═══════════════════════════════════════════════════════════');

        // Topological sort for dependency order
        const ordered = this.topologicalSort();

        for (const name of ordered) {
            const config = this.services.get(name)!;

            // Check dependencies
            const unmetDeps = (config.dependsOn || []).filter(dep => !this.initialized.has(dep));
            if (unmetDeps.length > 0) {
                const result: ServiceResult = {
                    name,
                    status: 'skipped',
                    durationMs: 0,
                    error: `Unmet dependencies: ${unmetDeps.join(', ')}`
                };
                this.results.push(result);
                console.warn(`  ⏭ ${name}: SKIPPED (dependencies not met: ${unmetDeps.join(', ')})`);
                continue;
            }

            const start = Date.now();
            try {
                const timeout = config.timeout || 30000;
                await Promise.race([
                    config.init(),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
                    )
                ]);

                const duration = Date.now() - start;
                this.initialized.add(name);
                this.results.push({ name, status: 'ok', durationMs: duration });
                console.log(`  ✅ ${name} (${duration}ms)`);

            } catch (error) {
                const duration = Date.now() - start;
                const errMsg = error instanceof Error ? error.message : String(error);
                const isTimeout = errMsg.includes('Timeout');

                const result: ServiceResult = {
                    name,
                    status: isTimeout ? 'timeout' : 'failed',
                    durationMs: duration,
                    error: errMsg
                };
                this.results.push(result);

                if (config.critical) {
                    console.error(`  ❌ ${name}: CRITICAL FAILURE — ${errMsg}`);
                    throw new Error(`Critical service "${name}" failed to initialize: ${errMsg}`);
                } else {
                    console.warn(`  ⚠ ${name}: ${isTimeout ? 'TIMEOUT' : 'FAILED'} — ${errMsg}`);
                }
            }
        }

        this.printSummary();
        return this.results;
    }

    private topologicalSort(): string[] {
        const visited = new Set<string>();
        const sorted: string[] = [];
        const visiting = new Set<string>();

        const visit = (name: string) => {
            if (visited.has(name)) return;
            if (visiting.has(name)) {
                console.warn(`[ServiceInit] Circular dependency detected involving: ${name}`);
                return;
            }
            visiting.add(name);

            const config = this.services.get(name);
            if (config?.dependsOn) {
                for (const dep of config.dependsOn) {
                    if (this.services.has(dep)) {
                        visit(dep);
                    }
                }
            }

            visiting.delete(name);
            visited.add(name);
            sorted.push(name);
        };

        const serviceNames = Array.from(this.services.keys());
        for (const name of serviceNames) {
            visit(name);
        }

        return sorted;
    }

    private printSummary(): void {
        const ok = this.results.filter(r => r.status === 'ok').length;
        const failed = this.results.filter(r => r.status === 'failed').length;
        const skipped = this.results.filter(r => r.status === 'skipped').length;
        const timedOut = this.results.filter(r => r.status === 'timeout').length;
        const totalTime = this.results.reduce((sum, r) => sum + r.durationMs, 0);

        console.log('\n═══════════════════════════════════════════════════════════');
        console.log(`[ServiceInit] Complete: ${ok} ok, ${failed} failed, ${skipped} skipped, ${timedOut} timeout`);
        console.log(`[ServiceInit] Total init time: ${totalTime}ms`);
        console.log('═══════════════════════════════════════════════════════════\n');
    }

    getResults(): ServiceResult[] {
        return [...this.results];
    }

    isInitialized(name: string): boolean {
        return this.initialized.has(name);
    }
}

// ============================================================================
// Global Process Error Handlers
// ============================================================================

/**
 * Install global unhandled rejection and exception handlers.
 * Call once at server startup.
 */
export function installGlobalErrorHandlers(): void {
    // Catch unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
        console.error('[PROCESS] Unhandled Promise Rejection:');
        console.error('  Reason:', reason instanceof Error ? reason.stack : reason);
        // Don't exit — log and continue (unless in production, consider restarting)
    });

    // Catch uncaught exceptions
    process.on('uncaughtException', (error) => {
        const errorMsg = error.message || '';
        const errorStack = error.stack || '';
        const isKnownNonFatal = (
            errorMsg.includes('EIO') && (errorStack.includes('pdf-parse') || errorStack.includes('pdf.js'))
        );

        if (isKnownNonFatal) {
            console.warn('[PROCESS] Non-fatal pdf-parse EIO error — continuing');
            return;
        }

        console.error('[PROCESS] Uncaught Exception:');
        console.error('  Error:', error.stack || error.message);

        if (process.env.NODE_ENV === 'production') {
            console.error('[PROCESS] Shutting down due to uncaught exception...');
            process.exit(1);
        }
    });

    console.log('[Process] Global error handlers installed');
}

export const serviceInitManager = new ServiceInitManager();
