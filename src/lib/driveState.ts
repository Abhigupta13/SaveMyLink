import { createHmac, timingSafeEqual } from 'crypto';

/**
 * The `state` that rides along with a Google Drive consent redirect, and comes back with it.
 *
 * It has one job: prove the callback belongs to the session that started it. Without that, an
 * attacker can run their own consent, capture the `code`, and hand the victim a link that welds
 * THEIR Drive onto the victim's account — every file the victim uploads then lands in a stranger's
 * storage. So the payload carries the user id, and the callback refuses anything that does not
 * match the session it arrives in.
 *
 * Signed with NEXTAUTH_SECRET, the same derivation lib/secretBox.ts and lib/safeCookie.ts use, so
 * there is one secret to rotate rather than three.
 *
 * Pure and mongoose-free so scripts/self-check.mjs can assert it — the open-redirect guard in
 * particular is four lines and exactly the kind of thing that rots silently.
 */

const V = 'v1';
/** A consent screen someone walks away from should not stay valid all afternoon. */
export const STATE_TTL_MS = 10 * 60 * 1000;
/** Clocks drift between the browser and the function; a minute of slack costs nothing. */
const SKEW_MS = 60 * 1000;

export interface DriveState {
  uid: string;
  nonce: string;
  to: string;
  /**
   * Consent was started from the Android app, in a Chrome Custom Tab.
   *
   * It changes two things in the callback. The Custom Tab has its own cookie jar, so there is no
   * app session to compare `uid` against — the signature over `uid` becomes the proof on its own,
   * which is sound because the only way to mint one is a POST to /api/auth/native/handoff carrying
   * the WebView's own session. And the landing has to be a deep link back into the app rather than
   * a path, or the person is left finished-but-stranded in a browser tab.
   */
  native?: boolean;
}

const key = () => {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is required to sign a Drive connect state');
  return secret;
};

const sign = (payload: string) => createHmac('sha256', key()).update(payload).digest('base64url');

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8');

export function signState(s: DriveState & { exp: number }): string {
  const payload = b64(JSON.stringify(s));
  return `${V}.${payload}.${sign(payload)}`;
}

/**
 * null for anything that is not exactly right — wrong version, tampered payload, bad signature,
 * expired. Never a partial answer, for the same reason secretBox.open never returns one.
 */
export function readState(state: string | null | undefined, now: number = Date.now()): DriveState | null {
  const parts = String(state ?? '').split('.');
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
    const parsed = JSON.parse(unb64(payload)) as DriveState & { exp?: number };
    if (!parsed?.uid || !parsed?.nonce) return null;
    if (typeof parsed.exp !== 'number' || now > parsed.exp + SKEW_MS) return null;
    // `native` is rebuilt as a strict boolean rather than passed through: it decides whether the
    // callback may proceed without a session, so a truthy string arriving in its place should not
    // be able to answer that question.
    return { uid: parsed.uid, nonce: parsed.nonce, to: safeReturnTo(parsed.to), native: parsed.native === true };
  } catch {
    return null;
  }
}

/**
 * Where to land after consent. It arrives as a query parameter, so it is an open redirect waiting
 * to happen: `//evil.com` is a protocol-relative URL that most naive checks wave through, and
 * `/\evil.com` is treated as one by browsers. Only a plain same-site path survives.
 */
export function safeReturnTo(to: string | null | undefined, fallback = '/profile'): string {
  const raw = String(to ?? '');
  if (!raw.startsWith('/')) return fallback;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  return raw.slice(0, 200);
}
