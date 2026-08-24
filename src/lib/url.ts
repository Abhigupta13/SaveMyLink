// Shared URL helpers for capture, dedupe, and thumbnails

/**
 * Where this app lives on the internet — for links that leave this machine: the share text, the
 * download QR, and every link inside an email.
 *
 * Deliberately NOT `NEXTAUTH_URL`. That one has to be http://localhost:3000 in development or
 * sign-in breaks, so it can never also mean "the public address of the app" — and using it for
 * both is why an invite sent from a dev machine arrived with a localhost link the recipient
 * could not open. NEXT_PUBLIC_ is the only prefix Next inlines into the browser bundle, which is
 * what lets one helper serve both the share button and the server-rendered QR.
 */
export function appUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL;
  if (configured) return configured.replace(/\/+$/, '');
  // Last resort in the browser: better a working same-host link than no link at all
  if (typeof window !== 'undefined') return window.location.origin.replace(/\/+$/, '');
  return '';   // callers concatenate onto this, so never the string "undefined"
}

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
