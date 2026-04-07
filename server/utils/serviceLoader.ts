const cache = new Map<string, any>();

export async function loadService<T = any>(key: string, importFn: () => Promise<T>): Promise<T> {
  const cached = cache.get(key);
  if (cached) return cached;
  const mod = await importFn();
  cache.set(key, mod);
  return mod;
}

export function isLoaded(key: string): boolean {
  return cache.has(key);
}

export function getLoaderStats(): { loaded: number; keys: string[] } {
  return { loaded: cache.size, keys: Array.from(cache.keys()) };
}
