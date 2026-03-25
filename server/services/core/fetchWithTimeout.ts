/**
 * Shared fetch utility with timeout support.
 * Replaces 10+ duplicated AbortController + setTimeout patterns across services.
 *
 * Usage:
 *   import { fetchWithTimeout } from './core/fetchWithTimeout.js';
 *   const res = await fetchWithTimeout('https://api.example.com', { method: 'GET' }, 5000);
 */

/**
 * Fetch with automatic AbortController timeout.
 * @param url   Target URL
 * @param opts  Standard RequestInit options (headers, method, body, etc.)
 * @param timeoutMs  Timeout in milliseconds (default 10_000)
 * @returns The fetch Response
 * @throws AbortError if timeout is exceeded
 */
export async function fetchWithTimeout(
    url: string,
    opts: RequestInit = {},
    timeoutMs = 10_000
): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...opts, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Fetch with timeout that returns null on failure instead of throwing.
 * Useful for optional/fallback requests.
 */
export async function fetchWithTimeoutSafe(
    url: string,
    opts: RequestInit = {},
    timeoutMs = 10_000
): Promise<Response | null> {
    try {
        return await fetchWithTimeout(url, opts, timeoutMs);
    } catch {
        return null;
    }
}
