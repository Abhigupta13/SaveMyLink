'use client';

import { useOfflineFileUrl } from '@/hooks/useOfflineFileUrl';
import { fileKeyFromUrl } from '@/lib/offlineFileCache';

/** Image attachments served through `/api/files/…` — cached locally after first view. */
export default function CachedAppFileImage({
  url,
  alt = '',
  className,
  loading,
}: {
  url: string;
  alt?: string;
  className?: string;
  loading?: 'lazy' | 'eager';
}) {
  const isAppFile = !!fileKeyFromUrl(url);
  const { displayUrl } = useOfflineFileUrl(isAppFile ? url : undefined, {});
  const src = isAppFile ? (displayUrl || url) : url;
  return <img src={src} alt={alt} className={className} loading={loading} />;
}
