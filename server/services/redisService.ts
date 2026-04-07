/**
 * Redis Cache Service — replaces InMemoryCache with Redis-backed persistence
 * Falls back to in-memory if Redis is unavailable
 */
import Redis from 'ioredis';
import { cleanupRegistry } from './core/cleanupRegistry.js';
import { config } from '../config';
import { logger, safeCatchDebug } from './logger';

const log = logger.redis;

let redis: Redis | null = null;
let redisReady = false;
let lastErrorLogged = 0;
let reconnectTimer: ReturnType<typeof setInterval> | null = null;
const ERROR_LOG_COOLDOWN_MS = 60_000;
const RECONNECT_INTERVAL_MS = 30_000;

const REDIS_URL = config.redis.url;

function startReconnectLoop() {
    if (reconnectTimer) return;
    reconnectTimer = setInterval(async () => {
        if (redisReady || !redis) return;
        try {
            await redis.ping();
            redisReady = true;
            log.info('Reconnected successfully');
            if (reconnectTimer) {
                clearInterval(reconnectTimer);
                reconnectTimer = null;
            }
        } catch (e) {
            safeCatchDebug('redis-reconnect', e);
        }
    }, RECONNECT_INTERVAL_MS);
}

try {
    redis = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
            if (times > 10) return null;
            return Math.min(times * 200, 5000);
        },
        lazyConnect: true,
        enableReadyCheck: true,
        connectTimeout: 5000,
    });

    redis.on('ready', () => {
        redisReady = true;
        log.info('Connected');
        if (reconnectTimer) {
            clearInterval(reconnectTimer);
            reconnectTimer = null;
        }
    });

    redis.on('error', (err) => {
        const now = Date.now();
        if (redisReady || now - lastErrorLogged > ERROR_LOG_COOLDOWN_MS) {
            log.warn('Connection lost, using memory fallback');
            lastErrorLogged = now;
        }
        redisReady = false;
        startReconnectLoop();
    });

    redis.on('close', () => {
        redisReady = false;
        startReconnectLoop();
    });

    redis.connect().catch(() => {
        log.info('Not available — using memory fallback');
        startReconnectLoop();
    });
} catch {
    log.info('Not available — using memory fallback');
}

const memoryFallback = new Map<string, { value: string; expiresAt: number }>();

const stats = { hits: 0, misses: 0, redisHits: 0, memoryHits: 0 };

export async function redisGet<T>(key: string): Promise<T | null> {
    if (redis && redisReady) {
        try {
            const val = await redis.get(key);
            if (val !== null) {
                stats.hits++;
                stats.redisHits++;
                return JSON.parse(val) as T;
            }
            stats.misses++;
            return null;
        } catch {
        }
    }

    const entry = memoryFallback.get(key);
    if (entry && Date.now() < entry.expiresAt) {
        stats.hits++;
        stats.memoryHits++;
        return JSON.parse(entry.value) as T;
    }
    if (entry) memoryFallback.delete(key);
    stats.misses++;
    return null;
}

export async function redisSet<T>(key: string, value: T, ttlSeconds: number = 300): Promise<void> {
    const serialized = JSON.stringify(value);

    if (redis && redisReady) {
        try {
            await redis.setex(key, ttlSeconds, serialized);
            return;
        } catch {
        }
    }

    if (memoryFallback.size > 5000) {
        const now = Date.now();
        for (const [k, v] of memoryFallback) {
            if (now > v.expiresAt) memoryFallback.delete(k);
        }
        if (memoryFallback.size > 5000) {
            const keys = Array.from(memoryFallback.keys());
            for (let i = 0; i < keys.length * 0.2; i++) {
                memoryFallback.delete(keys[i]);
            }
        }
    }

    memoryFallback.set(key, {
        value: serialized,
        expiresAt: Date.now() + ttlSeconds * 1000,
    });
}

export async function redisDel(key: string): Promise<void> {
    if (redis && redisReady) {
        try {
            await redis.del(key);
        } catch { /* ignore */ }
    }
    memoryFallback.delete(key);
}

export async function redisDelPattern(pattern: string): Promise<number> {
    let count = 0;

    if (redis && redisReady) {
        try {
            const keys = await redis.keys(pattern);
            if (keys.length > 0) {
                count = await redis.del(...keys);
            }
        } catch { /* ignore */ }
    }

    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    for (const k of memoryFallback.keys()) {
        if (regex.test(k)) {
            memoryFallback.delete(k);
            count++;
        }
    }

    return count;
}

export async function redisIncr(key: string, ttlSeconds: number = 60): Promise<number> {
    if (redis && redisReady) {
        try {
            const val = await redis.incr(key);
            if (val === 1) {
                await redis.expire(key, ttlSeconds);
            }
            return val;
        } catch { /* ignore */ }
    }

    const entry = memoryFallback.get(key);
    let current = 0;
    if (entry && Date.now() < entry.expiresAt) {
        current = parseInt(entry.value, 10) || 0;
    }
    current++;
    memoryFallback.set(key, {
        value: String(current),
        expiresAt: Date.now() + ttlSeconds * 1000,
    });
    return current;
}

export async function checkRateLimit(
    identifier: string,
    maxRequests: number,
    windowSeconds: number = 60
): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
    const key = `ratelimit:${identifier}`;
    const count = await redisIncr(key, windowSeconds);

    return {
        allowed: count <= maxRequests,
        remaining: Math.max(0, maxRequests - count),
        resetIn: windowSeconds,
    };
}

export async function withRedisCache<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlSeconds: number = 300
): Promise<T> {
    const cached = await redisGet<T>(key);
    if (cached !== null) return cached;

    const result = await fetcher();
    await redisSet(key, result, ttlSeconds);
    return result;
}

export async function storeSession(sessionId: string, data: Record<string, unknown>, ttlSeconds: number = 86400): Promise<void> {
    await redisSet(`session:${sessionId}`, data, ttlSeconds);
}

export async function getSession(sessionId: string): Promise<Record<string, unknown> | null> {
    return redisGet<Record<string, unknown>>(`session:${sessionId}`);
}

export async function destroySession(sessionId: string): Promise<void> {
    await redisDel(`session:${sessionId}`);
}

export function getRedisStats() {
    return {
        connected: redisReady,
        url: REDIS_URL.replace(/\/\/.*@/, '//***@'),
        ...stats,
        memoryFallbackSize: memoryFallback.size,
    };
}

export async function closeRedis(): Promise<void> {
    if (reconnectTimer) {
        clearInterval(reconnectTimer);
        reconnectTimer = null;
    }
    if (redis) {
        try {
            await redis.quit();
            console.log('[Redis] Connection closed');
        } catch { /* ignore */ }
    }
}

cleanupRegistry.registerCallback(closeRedis, 'Redis connection');
