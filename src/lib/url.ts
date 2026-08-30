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
/**
 * One URL, or nothing.
 *
 * `NEXTAUTH_URL` was once set to `https://prod.example/ | http://localhost:3000` — both values in
 * one variable, as a note to self. dotenv keeps the whole line, `new URL()` parses it as an origin
 * plus the path `/ | http://localhost:3000`, and NextAuth uses that path as its OAuth basePath. The
 * result was a redirect_uri Google answered with `Error 400: invalid_request`, and nothing anywhere
 * said why. Anything with whitespace or a second scheme in it is not a base URL; refusing it here
 * costs one warning and saves that afternoon.
 */
export function usableBase(value?: string | null): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/\s/.test(raw)) return null;                       // two values pasted into one variable
  if (raw.lastIndexOf('://') !== raw.indexOf('://')) return null;   // a second URL glued on
  if (!/^https?:\/\/[^/]+/i.test(raw)) return null;
  return raw.replace(/\/+$/, '');
}

/**
 * Where this app actually lives, for links that leave this machine.
 *
 * Hardcoded with an env override, for the same reason `ADMIN_EMAILS` is: it has to be right on a
 * fresh deploy with nothing configured, and the failure is silent and embarrassing — a share sheet
 * or an invite email that reads `http://localhost:3000/download`, which nobody on the receiving end
 * can open. `appUrl()` answers "where am I running"; this answers "where do I tell people to go",
 * and on a developer's laptop those are deliberately not the same.
 */
export const CANONICAL_APP_URL = 'https://allyouneedvault.vercel.app';

/**
 * A link for somebody else — a share sheet, an invite email, a QR code.
 *
 * NEVER localhost, whatever the machine is running. Override with NEXT_PUBLIC_SHARE_URL if the
 * domain changes; the constant is the answer when it is unset.
 */
export function shareUrl(path = ''): string {
  const base = usableBase(process.env.NEXT_PUBLIC_SHARE_URL) || CANONICAL_APP_URL;
  return path ? `${base}${path.startsWith('/') ? path : `/${path}`}` : base;
}

/** Where this instance is running — for OAuth callbacks and anything that must match this origin. */
export function appUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL;
  const configured = usableBase(raw);
  if (configured) return configured;
  if (raw) console.error('[url] NEXT_PUBLIC_APP_URL/NEXTAUTH_URL is not a single URL — ignoring it:', raw);
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
