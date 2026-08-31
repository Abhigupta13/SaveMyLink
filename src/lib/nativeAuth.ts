import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * The handoff that gets a signed-in session out of a Chrome Custom Tab and into the app's WebView.
 *
 * Why any of this exists: Google has refused OAuth from embedded WebViews since July 2023
 * (`disallowed_useragent`), and this app is a WebView. So sign-in has to happen in a real browser.
 * A Custom Tab is that browser — but it shares its cookie jar with Chrome, NOT with our WebView, so
 * finishing OAuth there leaves the app exactly as signed-out as it started. Something has to carry
 * the result back across, and that something is a one-time code delivered by deep link.
 *
 * A bare code is not safe on Android. Custom URL schemes are first-come-first-served: any installed
 * app may also claim `com.swaraj.savemylink://`, and if one does it receives the deep link and the
 * code inside it. Redeeming that code would hand a stranger's app a live session for this account.
 *
 * So the code is bound to a secret the WebView keeps to itself, PKCE-style:
 *
 *   WebView                          Custom Tab (Chrome)                 Server
 *   ───────                          ───────────────────                 ──────
 *   verifier = random                                                    stores challenge
 *   challenge = sha256(verifier) ──▶ /api/auth/native/start ───────────▶  with the code
 *   (verifier stays in sessionStorage)   Google OAuth
 *                                    /api/auth/native/done
 *   deep link with code       ◀────── com.swaraj.savemylink://auth
 *   /complete?code=&verifier= ─────────────────────────────────────────▶  sha256(verifier)
 *                                                                        must equal challenge
 *
 * An app that intercepts the deep link holds a code it cannot spend: it never saw the verifier, and
 * the verifier never leaves the WebView that generated it.
 *
 * Pure and dependency-free on purpose, so the binding can be asserted without a database or a
 * browser — this is the file where a subtle mistake is worth catching in a test rather than on a
 * phone.
 */

/** Two minutes is a deep link crossing the same device, not a person reading a consent screen. */
export const NATIVE_CODE_TTL_MS = 2 * 60 * 1000;

/** The scheme declared in AndroidManifest.xml and android/app/src/main/res/values/strings.xml. */
export const NATIVE_SCHEME = 'com.swaraj.savemylink';

export const nativeAuthDeepLink = (code: string) =>
  `${NATIVE_SCHEME}://auth?code=${encodeURIComponent(code)}`;

export const nativeDriveDeepLink = (to: string) =>
  `${NATIVE_SCHEME}://drive?to=${encodeURIComponent(to)}`;

/** 256 bits, url-safe, for both the code and the verifier. */
export const newSecret = () => randomBytes(32).toString('base64url');

/** Only ever the hash is stored, so a database leak hands over no spendable code. */
export const hashSecret = (value: string) => createHash('sha256').update(value).digest('base64url');

/**
 * Constant-time, and length-checked first because timingSafeEqual throws on a length mismatch
 * rather than returning false — which would turn a malformed input into a 500.
 */
export function secretMatches(stored: string | null | undefined, presented: string | null | undefined): boolean {
  if (!stored || !presented) return false;
  const a = Buffer.from(stored, 'utf8');
  const b = Buffer.from(hashSecret(presented), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The Drive handoff is a different problem with a different answer.
 *
 * Connecting Drive never needed a session moved into the WebView — the WebView is already signed
 * in. It needs the opposite: the Custom Tab, which has no session, has to tell the server which
 * user this consent belongs to. So the WebView mints a short-lived signed statement of its own
 * identity and passes it in the URL.
 *
 * Signed with NEXTAUTH_SECRET, matching lib/driveState.ts, lib/secretBox.ts and lib/safeCookie.ts —
 * one secret to rotate rather than four. Stateless because it authorises only *starting* a consent
 * screen; the existing signed `state` plus the nonce cookie still guard the callback itself.
 */
const V = 'nh1';
export const HANDOFF_TTL_MS = 2 * 60 * 1000;

const key = () => {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is required to sign a native handoff');
  return secret;
};

const sign = (payload: string) => createHmac('sha256', key()).update(payload).digest('base64url');
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8');

export function signHandoff(uid: string, now: number = Date.now()): string {
  const payload = b64(JSON.stringify({ uid, exp: now + HANDOFF_TTL_MS }));
  return `${V}.${payload}.${sign(payload)}`;
}

/** null for anything less than exactly right — wrong version, tampered, expired. Never partial. */
export function readHandoff(token: string | null | undefined, now: number = Date.now()): string | null {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3 || parts[0] !== V) return null;
  const [, payload, sig] = parts;
  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(unb64(payload)) as { uid?: string; exp?: number };
    if (!parsed?.uid || typeof parsed.exp !== 'number' || now > parsed.exp) return null;
    return parsed.uid;
  } catch {
    return null;
  }
}
