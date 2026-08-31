'use client';

import { useEffect } from 'react';
import { signIn } from 'next-auth/react';
import { closeNativeTab, takeVerifier } from '@/lib/nativeBridge';

/**
 * Catches the deep link that ends a Custom Tab flow and brings the result back into the WebView.
 *
 * Two links land here, both declared by the intent filter in AndroidManifest.xml:
 *
 *   com.swaraj.savemylink://auth?code=…   Google sign-in finished in Chrome. Spend the code for a
 *                                         session cookie in this WebView.
 *   com.swaraj.savemylink://drive?to=…    Drive consent finished. Nothing to spend — the refresh
 *                                         token was already stored server-side — so just reload the
 *                                         page that asked, which then shows the connected state.
 *
 * Separate from BackButtonListener deliberately, even though both listen on @capacitor/app: that
 * one is owned elsewhere, and two unrelated concerns sharing a component is how a change to one
 * quietly breaks the other.
 */
export default function NativeAuthListener() {
  useEffect(() => {
    let disposed = false;
    let remove: (() => void) | undefined;

    const attach = async () => {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;
      const { App } = await import('@capacitor/app');

      const handle = await App.addListener('appUrlOpen', ({ url }) => {
        if (!url || disposed) return;

        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          return;   // not a URL we put in front of Android; leave it alone
        }
        if (parsed.protocol !== 'com.swaraj.savemylink:') return;

        // The tab has done its job either way. Close it before navigating so the person is not
        // left looking at a Chrome page while the app changes underneath it.
        void closeNativeTab();

        // URL parses `scheme://auth?x` with "auth" as the host, not the pathname.
        const action = parsed.host || parsed.pathname.replace(/^\/+/, '');

        if (action === 'auth') {
          const code = parsed.searchParams.get('code');
          const verifier = takeVerifier();
          if (!code || !verifier) {
            // Reaching here means the code arrived without the secret half — either a stale link,
            // or another app claiming this scheme and forwarding it on. Refuse quietly; the server
            // would reject it anyway, and there is nothing the person can usefully do about it.
            window.location.assign('/auth/signin?error=' + encodeURIComponent('That sign-in could not be completed. Please try again.'));
            return;
          }
          // Through NextAuth rather than a route of our own, so the session cookie is minted by
          // NextAuth on the same terms as a password sign-in. See lib/nativeRedeem.ts for why
          // that indirection is the point and not an accident.
          void signIn('native-handoff', { code, verifier, callbackUrl: '/' });
          return;
        }

        if (action === 'drive') {
          const to = parsed.searchParams.get('to') || '/profile';
          // Only ever a same-site path. It came back through a URL bar, so it is untrusted input
          // however friendly it looks.
          window.location.assign(to.startsWith('/') && !to.startsWith('//') ? to : '/profile');
        }
      });

      remove = () => { void handle.remove(); };
    };

    attach().catch((err) => console.error('[native auth] could not attach the deep-link listener:', err));

    return () => { disposed = true; remove?.(); };
  }, []);

  return null;
}
