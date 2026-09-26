/**
 * In-memory stale-while-revalidate cache for server actions (web + Capacitor).
 * Keeps Vercel invocations down by reusing recent payloads on the client.
 */

export const CLIENT_CACHE = {
  /** Skip network when data is newer than this. */
  freshMs: 90_000,
  /** Drop entries older than this. */
  maxAgeMs: 15 * 60_000,
  maxEntriesPerNamespace: 12,
} as const;

type Entry<T> = { data: T; fetchedAt: number };

const namespaces = new Map<string, Map<string, Entry<unknown>>>();

function bucket(namespace: string): Map<string, Entry<unknown>> {
  let b = namespaces.get(namespace);
  if (!b) {
    b = new Map();
    namespaces.set(namespace, b);
  }
  return b;
}

export function cacheGet<T>(namespace: string, key: string): { data: T; fetchedAt: number } | null {
  const hit = bucket(namespace).get(key) as Entry<T> | undefined;
  if (!hit) return null;
  if (Date.now() - hit.fetchedAt > CLIENT_CACHE.maxAgeMs) {
    bucket(namespace).delete(key);
    return null;
  }
  return hit;
}

export function cacheSet<T>(namespace: string, key: string, data: T): void {
  const b = bucket(namespace);
  if (b.size >= CLIENT_CACHE.maxEntriesPerNamespace && !b.has(key)) {
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [k, v] of b) {
      if (v.fetchedAt < oldestAt) {
        oldestAt = v.fetchedAt;
        oldestKey = k;
      }
    }
    if (oldestKey) b.delete(oldestKey);
  }
  b.set(key, { data, fetchedAt: Date.now() });
}

export function cacheIsFresh(fetchedAt: number, freshMs: number = CLIENT_CACHE.freshMs): boolean {
  return Date.now() - fetchedAt < freshMs;
}

export function cacheInvalidateNamespace(namespace: string): void {
  namespaces.delete(namespace);
}

export function cacheInvalidateAll(): void {
  namespaces.clear();
}
