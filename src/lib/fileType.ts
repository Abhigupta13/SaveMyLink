/**
 * What `Content-Type` a stored file may be served with — and the most dangerous decision in the
 * file-serving route.
 *
 * `mimeType` on a Document, Note attachment or Message attachment comes from `file.type`, which is
 * **supplied by the browser that uploaded it**. A user can upload a file declaring `text/html`.
 * Served back from the app's own origin at `/api/files/...`, with the session cookie attached, that
 * is stored XSS against every member of the group it was shared into.
 *
 * The route used to hardcode `application/octet-stream`, which was accidentally the safe answer and
 * a real bug for everything else — a PDF downloaded instead of opening, an image never previewed.
 * Fixing it naively is how the vulnerability gets introduced, so the fix is an allowlist: known-safe
 * types render inline, everything else downloads, and the handful of types that execute in a browser
 * are forced to download no matter what the uploader claimed.
 *
 * Pure and import-free: scripts/self-check.mjs runs it under plain node.
 */

/** Types that may be rendered inline in the browser. Anything absent downloads instead. */
const INLINE = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp',
  'application/pdf',
  'text/plain', 'text/csv',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/aac',
]);

/**
 * Types that execute, or can be made to execute, in a browsing context. These are forced to
 * download even when they would otherwise look harmless.
 *
 * SVG is on this list and is the one people are surprised by: it is a document that can carry
 * script, and users genuinely do upload SVGs.
 */
const NEVER_INLINE = new Set([
  'text/html', 'application/xhtml+xml', 'image/svg+xml',
  'text/xml', 'application/xml', 'text/javascript', 'application/javascript',
  'application/x-httpd-php', 'text/x-python', 'application/xslt+xml',
]);

const FALLBACK = 'application/octet-stream';

/** Strip anything below printable ASCII. A CR or LF in a header value is header injection. */
function withoutControls(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) out += ch;
  }
  return out;
}

export interface ServedType {
  type: string;
  disposition: 'inline' | 'attachment';
}

/**
 * Decide what to send. `stored` is what the uploader's browser claimed; `fromDrive` is what Drive
 * reports. Stored wins when it is allowed, because it is the value the rest of the app already
 * renders from and the one `extractText` ran against.
 */
export function safeContentType(stored?: string | null, fromDrive?: string | null): ServedType {
  const clean = (v?: string | null) => withoutControls(String(v ?? '').split(';')[0].trim().toLowerCase());
  const candidates = [clean(stored), clean(fromDrive)].filter(Boolean);

  for (const c of candidates) {
    if (NEVER_INLINE.has(c)) return { type: FALLBACK, disposition: 'attachment' };
  }
  for (const c of candidates) {
    if (INLINE.has(c)) return { type: c, disposition: 'inline' };
  }
  // Known but not on the inline list — an Office document, a zip. Real type, still a download.
  const known = candidates.find(c => /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(c));
  return { type: known || FALLBACK, disposition: 'attachment' };
}

/**
 * A filename safe to put in a `Content-Disposition` header. Quotes and control characters come out;
 * the caller is expected to also send an RFC 5987 `filename*` for anything non-ASCII.
 */
export function safeFilename(name?: string | null): string {
  const clean = withoutControls(String(name ?? ''))
    .replace(/["\\]/g, '')
    .replace(/[\r\n]/g, '')
    .trim()
    .slice(0, 120);
  return clean || 'file';
}
