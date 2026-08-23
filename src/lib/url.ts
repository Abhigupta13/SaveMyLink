// Shared URL helpers for capture, dedupe, and thumbnails

export function extractUrl(text: string): string | null {
  return text.match(/https?:\/\/\S+/)?.[0] ?? null;
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Strip tracking params, hash, trailing slash — for duplicate detection
const TRACKING_PARAMS = /^(utm_|si$|igsh$|fbclid$|gclid$|ref$)/;
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    }
    u.pathname = u.pathname.replace(/\/+$/, '');
    return u.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

// Video id from any YouTube URL shape (watch, youtu.be, shorts, embed)
export function youtubeId(url: string): string | null {
  const host = hostnameOf(url);
  if (!/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) return null;
  try {
    const u = new URL(url);
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/\/(shorts|embed|live)\/([\w-]{5,})/);
    return m ? m[2] : null;
  } catch {
    return null;
  }
}
