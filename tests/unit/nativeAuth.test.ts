import { describe, test, expect, beforeAll } from 'vitest';
import {
  hashSecret, newSecret, secretMatches, signHandoff, readHandoff,
  nativeAuthDeepLink, nativeDriveDeepLink, HANDOFF_TTL_MS,
} from '@/lib/nativeAuth';

/**
 * The native sign-in handoff, which exists because Google refuses OAuth from an embedded WebView.
 *
 * Both halves of this file are auth boundaries, and neither is reachable from a browser to poke at:
 * the challenge/verifier binding is what stops an app that hijacks the `com.swaraj.savemylink://`
 * scheme from spending an intercepted code, and the handoff token is what lets a Custom Tab with no
 * session start a Drive consent as a particular user. Getting either subtly wrong looks like
 * nothing at all until it looks like account takeover, so the rules are asserted here rather than
 * discovered on a phone.
 */

const ALICE = '507f1f77bcf86cd799439011';
const BOB = '507f1f77bcf86cd799439012';

beforeAll(() => {
  // signHandoff refuses to sign without one, which is itself asserted below.
  process.env.NEXTAUTH_SECRET ||= 'test-secret-for-native-auth-assertions';
});

describe('the challenge/verifier binding', () => {
  test('the verifier that produced a challenge matches it', () => {
    const verifier = newSecret();
    expect(secretMatches(hashSecret(verifier), verifier)).toBe(true);
  });

  /**
   * The whole point. An app that also claims the custom scheme receives the deep link and the code
   * inside it, but never sees the verifier — it stayed in the WebView's localStorage.
   */
  test('a different verifier does not', () => {
    const challenge = hashSecret(newSecret());
    expect(secretMatches(challenge, newSecret())).toBe(false);
  });

  test('empty and missing values are refused rather than treated as a match', () => {
    const verifier = newSecret();
    expect(secretMatches(hashSecret(verifier), '')).toBe(false);
    expect(secretMatches('', verifier)).toBe(false);
    expect(secretMatches(null, verifier)).toBe(false);
    expect(secretMatches(hashSecret(verifier), undefined)).toBe(false);
  });

  /**
   * secretMatches compares with timingSafeEqual, which THROWS on a length mismatch instead of
   * returning false. Without the length guard a malformed verifier would be a 500 rather than a
   * refusal — and a route that 500s on bad input is a route that tells you when input is close.
   */
  test('a wrong-length stored value is refused, not thrown on', () => {
    const verifier = newSecret();
    expect(() => secretMatches('short', verifier)).not.toThrow();
    expect(secretMatches('short', verifier)).toBe(false);
  });

  test('codes are unpredictable and hashes are stable', () => {
    expect(newSecret()).not.toBe(newSecret());
    const s = newSecret();
    expect(hashSecret(s)).toBe(hashSecret(s));
    // The stored form must not be the spendable form.
    expect(hashSecret(s)).not.toBe(s);
  });
});

describe('the Drive handoff token', () => {
  test('round-trips the user it was minted for', () => {
    expect(readHandoff(signHandoff(ALICE))).toBe(ALICE);
  });

  /**
   * This is the one that matters. The token authorises starting a Drive consent AS this user, and
   * the callback trusts its uid when there is no session — so a forgeable token would let someone
   * weld their own Drive onto a stranger's account, which is exactly what lib/driveState.ts's
   * comment describes.
   */
  test('a tampered payload is refused', () => {
    const token = signHandoff(ALICE);
    const [v, payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ uid: BOB, exp: Date.now() + HANDOFF_TTL_MS }), 'utf8')
      .toString('base64url');
    expect(readHandoff(`${v}.${forged}.${sig}`)).toBeNull();
  });

  test('a tampered signature is refused', () => {
    const [v, payload] = signHandoff(ALICE).split('.');
    expect(readHandoff(`${v}.${payload}.not-the-signature`)).toBeNull();
  });

  test('an expired token is refused', () => {
    const minted = Date.now() - HANDOFF_TTL_MS - 1000;
    expect(readHandoff(signHandoff(ALICE, minted))).toBeNull();
    // ...and was valid at the moment it was made, so the refusal is the clock and not the format.
    expect(readHandoff(signHandoff(ALICE, minted), minted)).toBe(ALICE);
  });

  test('malformed input is null rather than an exception', () => {
    for (const bad of ['', 'x', 'a.b', 'a.b.c.d', null, undefined, 'v1.abc.def']) {
      expect(() => readHandoff(bad)).not.toThrow();
      expect(readHandoff(bad)).toBeNull();
    }
  });

  /** A token from a different version prefix must not be accepted if the format ever changes. */
  test('a wrong version prefix is refused', () => {
    const [, payload, sig] = signHandoff(ALICE).split('.');
    expect(readHandoff(`nh0.${payload}.${sig}`)).toBeNull();
  });
});

describe('deep links', () => {
  test('use the scheme the manifest declares', () => {
    expect(nativeAuthDeepLink('abc')).toBe('com.swaraj.savemylink://auth?code=abc');
    expect(nativeDriveDeepLink('/profile')).toBe('com.swaraj.savemylink://drive?to=%2Fprofile');
  });

  /**
   * The code goes into a URL that Android parses and a page interpolates. A code containing `&`
   * would otherwise arrive truncated, and the sign-in would fail for one person in sixty-four with
   * no pattern anyone could see.
   */
  test('encode their arguments', () => {
    expect(nativeAuthDeepLink('a&b=c')).toBe('com.swaraj.savemylink://auth?code=a%26b%3Dc');
    expect(nativeDriveDeepLink('/x?y=1&z=2')).toContain('%26');
  });
});
