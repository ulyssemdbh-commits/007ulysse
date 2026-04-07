/**
 * Response Cache Service
 * Cache instant responses for common queries to reduce latency to <200ms
 */

import { db } from "../db";
import { fetchMarseilleData } from "./marseilleWeather";

interface CacheEntry {
  response: string;
  ttl: number; // milliseconds
  lastUpdated: number;
  generator?: () => Promise<string>;
}

interface CacheConfig {
  patterns: RegExp[];
  response: string | (() => Promise<string>);
  ttl: number;
}

// Cache storage
const responseCache = new Map<string, CacheEntry>();

// Configurable cache patterns
const cacheConfigs: CacheConfig[] = [
  {
    patterns: [
      /^(quelle? )?heure( est[- ]il)?(\?)?$/i,
      /^il est quelle heure(\?)?$/i,
      /^c'?est quelle heure(\?)?$/i,
      /^what time is it(\?)?$/i,
    ],
    response: async () => {
      const data = await fetchMarseilleData();
      return `Il est ${data.time}.`;
    },
    ttl: 30000, // 30 seconds
  },
  {
    patterns: [
      /^(quel(le)?|c'?est quoi) (le )?temps( (fait[- ]il|dehors|aujourd'?hui))?(\?)?$/i,
      /^(quel(le)?|c'?est quoi) (la )?mét[ée]o(\?)?$/i,
      /^(il fait )?quel temps(\?)?$/i,
      /^météo(\?)?$/i,
    ],
    response: async () => {
      const data = await fetchMarseilleData();
      return `${data.weather.temperature}, ${data.weather.condition}. Humidité ${data.weather.humidity}, vent ${data.weather.wind}.`;
    },
    ttl: 300000, // 5 minutes
  },
  {
    patterns: [
      /^(on est |c'?est )?(quel(le)? )?jour( est[- ]on| sommes[- ]nous)?(\?)?$/i,
      /^(quelle est )?la date( d'?aujourd'?hui)?(\?)?$/i,
      /^on est le combien(\?)?$/i,
    ],
    response: async () => {
      const data = await fetchMarseilleData();
      return `On est le ${data.date}.`;
    },
    ttl: 60000, // 1 minute
  },
  {
    patterns: [
      /^(bonjour|salut|coucou|hey|hello|hi)( ulysse| iris)?[!.]*$/i,
    ],
    response: async () => {
      const data = await fetchMarseilleData();
      const hour = parseInt(data.time.split(":")[0]);
      let greeting = "Salut";
      if (hour < 12) greeting = "Bonjour";
      else if (hour < 18) greeting = "Bon après-midi";
      else greeting = "Bonsoir";
      return `${greeting} ! Quoi de neuf ?`;
    },
    ttl: 60000, // 1 minute
  },
  {
    patterns: [
      /^(ça va|comment (ça )?va|tu vas bien)( toi)?[?!]*$/i,
    ],
    response: "Impec, merci ! Et toi, quoi de beau ?",
    ttl: 3600000, // 1 hour (static)
  },
  {
    patterns: [
      /^(merci|thanks|thank you)[!.]*$/i,
    ],
    response: "De rien ! Autre chose ?",
    ttl: 3600000, // 1 hour (static)
  },
  {
    patterns: [
      /^(ok|d'?accord|compris|parfait|super|cool|nice)[!.]*$/i,
    ],
    response: "👍",
    ttl: 3600000, // 1 hour (static)
  },
];

/**
 * Find a matching cache config for the given message
 */
function findMatchingConfig(message: string): CacheConfig | null {
  const normalized = message.trim().toLowerCase();
  
  for (const config of cacheConfigs) {
    for (const pattern of config.patterns) {
      if (pattern.test(normalized)) {
        return config;
      }
    }
  }
  
  return null;
}

/**
 * Get a cache key from a message
 */
function getCacheKey(message: string): string {
  return message.trim().toLowerCase().replace(/[?!.]+$/, "");
}

/**
 * Check if a message can be answered from cache
 */
export function canAnswerFromCache(message: string): boolean {
  return findMatchingConfig(message) !== null;
}

/**
 * Get cached response if available and fresh
 */
export async function getCachedResponse(message: string): Promise<string | null> {
  const config = findMatchingConfig(message);
  if (!config) return null;
  
  const cacheKey = getCacheKey(message);
  const cached = responseCache.get(cacheKey);
  
  // Check if cache is fresh
  if (cached && Date.now() - cached.lastUpdated < cached.ttl) {
    console.log(`[ResponseCache] Cache hit for: "${message.substring(0, 30)}..."`);
    return cached.response;
  }
  
  // Generate new response
  let response: string;
  if (typeof config.response === "function") {
    try {
      response = await config.response();
    } catch (err) {
      console.error("[ResponseCache] Generator failed:", err);
      return null;
    }
  } else {
    response = config.response;
  }
  
  // Store in cache
  responseCache.set(cacheKey, {
    response,
    ttl: config.ttl,
    lastUpdated: Date.now(),
  });
  
  console.log(`[ResponseCache] Cache miss, generated for: "${message.substring(0, 30)}..."`);
  return response;
}

/**
 * Pre-warm the cache with common responses
 */
export async function prewarmCache(): Promise<void> {
  console.log("[ResponseCache] Prewarming cache...");
  
  try {
    const data = await fetchMarseilleData();
    
    // Prewarm time/date/weather
    responseCache.set("heure", {
      response: `Il est ${data.time}.`,
      ttl: 30000,
      lastUpdated: Date.now(),
    });
    
    responseCache.set("météo", {
      response: `${data.weather.temperature}, ${data.weather.condition}. Humidité ${data.weather.humidity}, vent ${data.weather.wind}.`,
      ttl: 300000,
      lastUpdated: Date.now(),
    });
    
    responseCache.set("date", {
      response: `On est le ${data.date}.`,
      ttl: 60000,
      lastUpdated: Date.now(),
    });
    
    console.log("[ResponseCache] Cache prewarmed with 3 entries");
  } catch (err) {
    console.error("[ResponseCache] Prewarm failed:", err);
  }
}

/**
 * Get cache stats
 */
export function getCacheStats() {
  return {
    entries: responseCache.size,
    keys: Array.from(responseCache.keys()),
  };
}

/**
 * Clear the cache
 */
export function clearCache() {
  responseCache.clear();
}
