/**
 * Safe Database Query Helpers
 * 
 * Wraps common database query patterns with logging and error handling.
 * Prevents silent failures while still allowing graceful degradation.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Execute a raw SQL query with safe fallback and logging.
 * Returns fallback value on failure instead of silently swallowing errors.
 */
export async function safeQuery<T>(
    query: ReturnType<typeof sql>,
    fallback: T,
    context?: string
): Promise<T> {
    try {
        const result = await db.execute(query);
        return result.rows as T;
    } catch (error) {
        const label = context || 'safeQuery';
        console.warn(`[DB:${label}] Query failed (using fallback):`,
            error instanceof Error ? error.message : String(error)
        );
        return fallback;
    }
}

/**
 * Execute a raw SQL query expecting a single row result.
 * Returns fallback on failure or if no rows returned.
 */
export async function safeQueryOne<T>(
    query: ReturnType<typeof sql>,
    fallback: T,
    context?: string
): Promise<T> {
    try {
        const result = await db.execute(query);
        return (result.rows[0] as T) ?? fallback;
    } catch (error) {
        const label = context || 'safeQueryOne';
        console.warn(`[DB:${label}] Query failed (using fallback):`,
            error instanceof Error ? error.message : String(error)
        );
        return fallback;
    }
}

/**
 * Safely parse JSON with fallback value.
 * Prevents crashes from malformed JSON (common with AI responses, user data, etc).
 */
export function safeJsonParse<T>(input: string | null | undefined, fallback: T, context?: string): T {
    if (!input) return fallback;
    try {
        return JSON.parse(input) as T;
    } catch (error) {
        const label = context || 'safeJsonParse';
        console.warn(`[${label}] JSON parse failed (using fallback):`,
            (error instanceof Error ? error.message : String(error)).slice(0, 200)
        );
        return fallback;
    }
}

/**
 * Execute a database health check
 */
export async function checkDatabaseHealth(): Promise<boolean> {
    try {
        await db.execute(sql`SELECT 1`);
        return true;
    } catch (error) {
        console.error('[DB:healthCheck] Database health check failed:',
            error instanceof Error ? error.message : String(error)
        );
        return false;
    }
}
