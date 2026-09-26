'use client';

import { useEffect, useState } from 'react';
import { resolveOfflineFileUrl, warmFileCache } from '@/lib/offlineFileCache';

/**
 * Resolves `/api/files/…` to a display URL, warming the local cache while online.
 * Returns a blob URL when offline and the file was opened before on this device.
 */
export function useOfflineFileUrl(
  sourceUrl: string | undefined,
  meta?: { name?: string; mimeType?: string },
) {
  const [displayUrl, setDisplayUrl] = useState(sourceUrl || '');
  const [fromCache, setFromCache] = useState(false);
  const [warming, setWarming] = useState(false);

  useEffect(() => {
    if (!sourceUrl) {
      setDisplayUrl('');
      setFromCache(false);
      return;
    }

    let blobUrl: string | null = null;
    let cancelled = false;

    (async () => {
      setWarming(true);
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        await warmFileCache(sourceUrl, meta);
      }
      const resolved = await resolveOfflineFileUrl(sourceUrl);
      if (cancelled) {
        if (resolved.fromCache) URL.revokeObjectURL(resolved.url);
        return;
      }
      if (resolved.fromCache) blobUrl = resolved.url;
      setDisplayUrl(resolved.url);
      setFromCache(resolved.fromCache);
      setWarming(false);
    })();

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [sourceUrl, meta?.name, meta?.mimeType]);

  return { displayUrl, fromCache, warming };
}
