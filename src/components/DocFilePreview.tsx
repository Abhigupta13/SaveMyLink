'use client';

import { useOfflineFileUrl } from '@/hooks/useOfflineFileUrl';

type DocLike = {
  name: string;
  url: string;
  mimeType?: string;
  type?: 'file' | 'link';
};

export function kindOfDoc(doc: DocLike): 'image' | 'video' | 'pdf' | 'audio' | 'link' | 'file' {
  if (doc.type === 'link') return 'link';
  const m = (doc.mimeType || '').toLowerCase();
  const ext = (doc.url || '').split('.').pop()?.toLowerCase() || '';
  if (m.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'].includes(ext)) return 'image';
  if (m.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv'].includes(ext)) return 'video';
  if (m.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'ogg'].includes(ext)) return 'audio';
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  return 'file';
}

export function extOfDoc(doc: DocLike) {
  return ((doc.name?.includes('.') ? doc.name : doc.url) || '').split('.').pop()?.slice(0, 4).toUpperCase() || 'FILE';
}

/** In-app preview for locker / project files — caches bytes locally after first open. */
export default function DocFilePreview({
  doc,
  displayUrl: displayUrlProp,
  fromCache: fromCacheProp,
}: {
  doc: DocLike;
  displayUrl?: string;
  fromCache?: boolean;
}) {
  const hook = useOfflineFileUrl(displayUrlProp ? undefined : doc.url, {
    name: doc.name,
    mimeType: doc.mimeType,
  });
  const displayUrl = displayUrlProp ?? hook.displayUrl;
  const fromCache = fromCacheProp ?? hook.fromCache;
  const warming = displayUrlProp ? false : hook.warming;
  const kind = kindOfDoc(doc);
  const url = displayUrl || doc.url;

  if (warming && !fromCache && kind !== 'link') {
    return (
      <div className="preview-fallback">
        <p style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Preparing preview…</p>
      </div>
    );
  }

  return (
    <>
      {fromCache && (
        <p className="offline-file-badge" role="status">
          Opened from this device — no connection needed
        </p>
      )}
      {kind === 'image' && <img src={url} alt={doc.name} />}
      {kind === 'video' && <video src={url} controls autoPlay />}
      {kind === 'audio' && <audio src={url} controls style={{ width: '100%' }} />}
      {kind === 'pdf' && <iframe src={url} title={doc.name} />}
      {(kind === 'file' || kind === 'link') && (
        <div className="preview-fallback">
          <div className={`doc-glyph ${kind}`} style={{ width: '72px', height: '72px', fontSize: '0.9rem' }}>
            <span>{kind === 'link' ? '\u2197' : extOfDoc(doc)}</span>
          </div>
          <p>{kind === 'link' ? 'External link \u2014 open it in a new tab.' : 'No in-app preview for this file type.'}</p>
          <a className="btn-primary" href={url} target="_blank" rel="noreferrer"
            style={{ padding: '11px 24px', borderRadius: '12px', fontWeight: 800, textDecoration: 'none' }}>
            {kind === 'link' ? 'Open link' : 'Open file'}
          </a>
        </div>
      )}
    </>
  );
}
