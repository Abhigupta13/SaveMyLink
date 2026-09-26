/** Resolve a feedback screenshot path for `/api/files/…` (segment-safe). */
export function feedbackShotPath(shot?: { key?: string; url?: string } | null): string | null {
  if (!shot) return null;
  if (shot.url?.startsWith('/api/files/')) return shot.url;
  if (shot.url?.startsWith('http')) {
    try {
      const u = new URL(shot.url);
      if (u.pathname.startsWith('/api/files/')) return u.pathname;
    } catch {
      /* ignore */
    }
  }
  if (!shot.key) return null;
  const encoded = shot.key.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  return `/api/files/${encoded}`;
}
