/**
 * Lightweight in-memory TTL cache for API responses.
 * 
 * Usage:
 *   const data = await apiCache.getOrSet('key', () => fetchData(), 30);
 *   apiCache.invalidate('key');           // remove one key
 *   apiCache.invalidatePrefix('anime:');  // remove all keys starting with prefix
 */

type CacheEntry<T = unknown> = {
  data: T;
  expiry: number;
};

class TTLCache {
  private store = new Map<string, CacheEntry>();

  /** Get a cached value, or compute + cache it if missing/expired. */
  async getOrSet<T>(key: string, fetcher: () => Promise<T>, ttlSeconds: number): Promise<T> {
    const existing = this.store.get(key);
    if (existing && Date.now() < existing.expiry) {
      return existing.data as T;
    }

    const data = await fetcher();
    this.store.set(key, { data, expiry: Date.now() + ttlSeconds * 1000 });
    return data;
  }

  /** Remove a single cache entry. */
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /** Remove all entries whose key starts with the given prefix. */
  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  /** Clear the entire cache. */
  clear(): void {
    this.store.clear();
  }
}

// Singleton — survives hot reloads in dev via globalThis
const globalForCache = globalThis as unknown as { __apiCache?: TTLCache };
export const apiCache = globalForCache.__apiCache ?? new TTLCache();
if (process.env.NODE_ENV !== 'production') globalForCache.__apiCache = apiCache;
