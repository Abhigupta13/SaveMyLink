'use client';

/**
 * The browser half of the Custom Tab handoff. See lib/nativeAuth.ts for the protocol and why it is
 * shaped this way; this file is only the part that runs inside the app's WebView.
 *
 * Every Capacitor import is dynamic and behind `isNativePlatform()`, matching taskNotifications.ts
 * and SendIntentListener.tsx — the web build must never pull a native plugin into its bundle.
 */

/** Survives the trip out to Chrome and back. Never leaves this device, never leaves this file. */
const VERIFIER_KEY = 'nativeAuthVerifier';

export async function isNativeApp(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const { Capacitor } = await import('@capacitor/core');
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

const b64url = (bytes: Uint8Array) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function newVerifierAndChallenge(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

/**
 * localStorage rather than sessionStorage: leaving for a Custom Tab can let Android reclaim the
 * activity, and a verifier that did not survive that is a sign-in that fails for no visible reason.
 * It is cleared the moment it is spent.
 */
export function takeVerifier(): string | null {
  try {
    const raw = localStorage.getItem(VERIFIER_KEY);
    localStorage.removeItem(VERIFIER_KEY);
    if (!raw) return null;
    const { verifier, at } = JSON.parse(raw) as { verifier?: string; at?: number };
    // The server enforces the real two-minute window; this only stops a verifier left over from an
    // abandoned attempt last week being offered against a fresh code.
    if (!verifier || !at || Date.now() - at > 10 * 60 * 1000) return null;
    return verifier;
  } catch {
    return null;
  }
}

/**
 * Start Google sign-in in a Chrome Custom Tab.
 *
 * Google blocks OAuth in embedded WebViews (`disallowed_useragent`), which is why signIn('google')
 * inside the app produced a Google error page instead of a sign-in. Everything from here happens in
 * a real browser, and comes back through the deep link NativeAuthListener is waiting on.
 */
export async function startNativeGoogleSignIn(): Promise<boolean> {
  if (!(await isNativeApp())) return false;
  try {
    const { verifier, challenge } = await newVerifierAndChallenge();
    localStorage.setItem(VERIFIER_KEY, JSON.stringify({ verifier, at: Date.now() }));

    const { Browser } = await import('@capacitor/browser');
    // A page that calls next-auth's own signIn(), not a route that reimplements the form POST it
    // does. The reimplementation reached Google but failed at the callback with OAuthCallback,
    // while the same journey from the website worked — so the app now runs the identical client
    // code, differing only in where it is told to come back to.
    await Browser.open({
      url: `${window.location.origin}/auth/native?challenge=${encodeURIComponent(challenge)}`,
      presentationStyle: 'popover',
    });
    return true;
  } catch (err) {
    console.error('[native auth] could not open the sign-in tab:', err);
    // Cleared so a stale verifier cannot be presented against some later code.
    try { localStorage.removeItem(VERIFIER_KEY); } catch { /* storage disabled */ }
    return false;
  }
}

/**
 * Start Google Drive consent in a Custom Tab.
 *
 * A different problem from sign-in with a different answer: the WebView is already signed in, and
 * it is the Custom Tab that has no session. So the WebView mints a short-lived signed statement of
 * who it is (`/api/auth/native/handoff`) and hands that to the consent route. Nothing about the
 * callback's own CSRF protection changes — the nonce cookie and the signed state both live in
 * Chrome for the whole round trip.
 */
export async function startNativeDriveConnect(returnTo: string): Promise<boolean> {
  if (!(await isNativeApp())) return false;
  try {
    const res = await fetch('/api/auth/native/handoff', { method: 'POST', credentials: 'include' });
    if (!res.ok) throw new Error(`handoff mint failed: ${res.status}`);
    const { token } = (await res.json()) as { token?: string };
    if (!token) throw new Error('handoff mint returned no token');

    const { Browser } = await import('@capacitor/browser');
    await Browser.open({
      url: `${window.location.origin}/api/drive/connect?to=${encodeURIComponent(returnTo)}&handoff=${encodeURIComponent(token)}&native=1`,
      presentationStyle: 'popover',
    });
    return true;
  } catch (err) {
    console.error('[native drive] could not open the consent tab:', err);
    return false;
  }
}

export async function closeNativeTab(): Promise<void> {
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.close();
  } catch {
    // Already dismissed, or the tab was never opened. Nothing to recover from.
  }
}
