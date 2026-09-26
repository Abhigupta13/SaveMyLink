'use client';

import { useEffect, useState } from 'react';
import { feedbackShotPath } from '@/lib/feedbackShotUrl';

/**
 * Feedback screenshots are served from `/api/files/…` behind the session. A plain <img src> often
 * fails silently when the route responds as a download or Drive returns octet-stream — fetch +
 * blob URL shows errors and displays reliably for admins.
 */
export default function FeedbackScreenshot({
  shot,
  className,
  imgClassName,
  maxHeight = 260,
}: {
  shot?: { key?: string; url?: string; mimeType?: string } | null;
  className?: string;
  imgClassName?: string;
  maxHeight?: number;
}) {
  const path = feedbackShotPath(shot);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!path) {
      setSrc(null);
      setError(null);
      return;
    }
    let blobUrl: string | null = null;
    let cancelled = false;

    (async () => {
      setError(null);
      setSrc(null);
      try {
        const res = await fetch(path, { credentials: 'include' });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(text || `Could not load screenshot (${res.status})`);
        }
        const blob = await res.blob();
        const looksLikeImage =
          blob.type.startsWith('image/') || (shot?.mimeType || '').startsWith('image/');
        if (!looksLikeImage && blob.type && !blob.type.includes('octet-stream')) {
          throw new Error('Screenshot is not an image — open the link to download it.');
        }
        blobUrl = URL.createObjectURL(blob);
        if (!cancelled) setSrc(blobUrl);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load screenshot');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [path, shot?.mimeType]);

  if (!path) return null;

  if (error) {
    return (
      <div className={`feedback-shot-error ${className || ''}`.trim()} role="alert">
        <p>{error}</p>
        <a href={path} target="_blank" rel="noreferrer" className="subtle-link">
          Try opening the file directly →
        </a>
      </div>
    );
  }

  if (!src) {
    return (
      <p className={`feedback-shot-loading ${className || ''}`.trim()} style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>
        Loading screenshot…
      </p>
    );
  }

  return (
    <a href={path} target="_blank" rel="noreferrer" className={className}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Screenshot attached to this report"
        className={imgClassName}
        style={imgClassName ? undefined : { display: 'block', maxWidth: '100%', maxHeight, borderRadius: 12, border: '1px solid var(--border-color)' }}
      />
    </a>
  );
}
