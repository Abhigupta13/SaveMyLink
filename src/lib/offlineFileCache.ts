/**
 * Local copies of files the user has opened through `/api/files/…`, so previews still work when
 * Wi‑Fi drops. Session-gated bytes are stored in IndexedDB on the device — not on the server.
 */

const DB_NAME = 'allyouneed-offline-files';
const STORE = 'files';
const DB_VERSION = 1;
/** Stay under typical browser quotas; evict oldest entries when exceeded. */
const MAX_CACHE_BYTES = 150 * 1024 * 1024;

export type CachedFileRecord = {
  key: string;
  name: string;
  mimeType: string;
  size: number;
  cachedAt: number;
  blob: Blob;
};

export type CachedFileMeta = Omit<CachedFileRecord, 'blob'>;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

/** Storage key segment after `/api/files/` (not including that prefix). */
export function fileKeyFromUrl(url: string): string | null {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return null;
  try {
    const path = url.startsWith('http') ? new URL(url).pathname : url.split('?')[0];
    const prefix = '/api/files/';
    if (!path.startsWith(prefix)) return null;
    return decodeURIComponent(path.slice(prefix.length));
  } catch {
    return null;
  }
}

async function totalBytes(db: IDBDatabase): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const rows = (req.result || []) as CachedFileRecord[];
      resolve(rows.reduce((n, r) => n + (r.size || 0), 0));
    };
  });
}

async function evictUntilRoom(db: IDBDatabase, incoming: number): Promise<void> {
  let used = await totalBytes(db);
  if (used + incoming <= MAX_CACHE_BYTES) return;
  const rows = await new Promise<CachedFileRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve((req.result || []) as CachedFileRecord[]);
  });
  rows.sort((a, b) => a.cachedAt - b.cachedAt);
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  for (const row of rows) {
    if (used + incoming <= MAX_CACHE_BYTES) break;
    store.delete(row.key);
    used -= row.size || 0;
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function putCachedFile(
  key: string,
  blob: Blob,
  meta: { name?: string; mimeType?: string },
): Promise<void> {
  if (!key || !blob.size) return;
  const db = await openDb();
  await evictUntilRoom(db, blob.size);
  const record: CachedFileRecord = {
    key,
    name: meta.name || key.split('/').pop() || 'file',
    mimeType: meta.mimeType || blob.type || 'application/octet-stream',
    size: blob.size,
    cachedAt: Date.now(),
    blob,
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedFile(key: string): Promise<CachedFileRecord | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve((req.result as CachedFileRecord) || null);
  });
}

export async function listCachedFiles(): Promise<CachedFileMeta[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const rows = (req.result || []) as CachedFileRecord[];
      resolve(
        rows
          .map(({ key, name, mimeType, size, cachedAt }) => ({ key, name, mimeType, size, cachedAt }))
          .sort((a, b) => b.cachedAt - a.cachedAt),
      );
    };
  });
}

/** Fetch from the app (while online) and persist for later offline preview. */
export async function warmFileCache(
  apiUrl: string,
  meta?: { name?: string; mimeType?: string },
): Promise<boolean> {
  const key = fileKeyFromUrl(apiUrl);
  if (!key || typeof fetch === 'undefined') return false;
  try {
    const res = await fetch(apiUrl, { credentials: 'include' });
    if (!res.ok) return false;
    const blob = await res.blob();
    await putCachedFile(key, blob, {
      name: meta?.name,
      mimeType: meta?.mimeType || res.headers.get('content-type') || undefined,
    });
    return true;
  } catch {
    return false;
  }
}

/** Prefer a blob URL when offline and we have a cached copy. */
export async function resolveOfflineFileUrl(
  apiUrl: string,
): Promise<{ url: string; fromCache: boolean }> {
  const key = fileKeyFromUrl(apiUrl);
  if (!key) return { url: apiUrl, fromCache: false };

  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  if (offline) {
    const hit = await getCachedFile(key);
    if (hit) return { url: URL.createObjectURL(hit.blob), fromCache: true };
  }
  return { url: apiUrl, fromCache: false };
}
