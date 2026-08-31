'use client';

import { Suspense, useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';

/**
 * The page a Chrome Custom Tab opens to start Google sign-in for the Android app.
 *
 * This used to be an API route that fetched a CSRF token and POSTed a hand-built form at
 * /api/auth/signin/google. It reached Google fine, and then failed at the callback with
 * OAuthCallback — while the identical journey from the website worked. Reimplementing what
 * next-auth's own client already does was the only thing the app path did differently, so it goes:
 * this calls signIn() exactly as GoogleButton does on the web, and the two paths are now the same
 * code with a different callbackUrl.
 *
 * The callbackUrl carries the PKCE-style challenge through to /api/auth/native/done, which mints
 * the one-time code and bounces back into the app over the deep link. See lib/nativeAuth.
 *
 * Reachable signed-out: `auth` is exempt from the proxy gate in src/proxy.ts.
 */

// sha256 rendered base64url is 43 characters. Validated because it is echoed into a URL.
const CHALLENGE = /^[A-Za-z0-9_-]{32,128}$/;

function Start() {
  const challenge = useSearchParams().get('challenge') ?? '';
  const [failed, setFailed] = useState(!CHALLENGE.test(challenge));

  useEffect(() => {
    if (!CHALLENGE.test(challenge)) return;
    // Not awaited on purpose: signIn navigates this tab to Google and never resolves normally.
    signIn('google', { callbackUrl: `/api/auth/native/done?challenge=${challenge}` })
      .catch(() => setFailed(true));
  }, [challenge]);

  return (
    <div className="page narrow" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: '14px' }}>
      {failed ? (
        <>
          <p style={{ color: 'var(--text-secondary)' }}>
            Could not reach Google sign-in. Close this tab and use your email and password instead.
          </p>
          <a href="/auth/signin" style={{ color: 'var(--accent-text)', fontWeight: 700 }}>Open sign-in</a>
        </>
      ) : (
        <p style={{ color: 'var(--text-secondary)' }}>Taking you to Google…</p>
      )}
    </div>
  );
}

export default function NativeSignInPage() {
  // useSearchParams needs a boundary; without one this page cannot be rendered at all.
  return <Suspense fallback={null}><Start /></Suspense>;
}
