'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { startNativeGoogleSignIn } from '@/lib/nativeBridge';

/**
 * Rendered only when Google credentials are configured (see authProviders()).
 *
 * Inside the Android app this cannot call signIn('google') directly. Google has refused OAuth from
 * embedded WebViews since July 2023, so the WebView got `403: disallowed_useragent` — a Google-branded
 * error page, which reads as "this app is broken" rather than "this browser is not allowed". The
 * native path runs the same flow in a Chrome Custom Tab and hands the session back over a deep link.
 */
export default function GoogleButton({ label }: { label: string }) {
  const [loading, setLoading] = useState(false);

  const start = async () => {
    setLoading(true);
    // Falls through to the web flow when this is not the app, and also when the Custom Tab could
    // not be opened at all — on the web that is the right behaviour, and in the app it produces
    // Google's own error rather than a button that does nothing.
    if (await startNativeGoogleSignIn()) return;
    signIn('google', { callbackUrl: '/' });
  };

  return (
    <>
      <button type="button" className="google-btn" disabled={loading}
        onClick={() => { void start(); }}>
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.1z"/>
          <path fill="#34A853" d="M24 46c6 0 11-2 14.6-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.7-3.9-12.4-9.900H4.2v5.7C7.8 40.9 15.3 46 24 46z"/>
          <path fill="#FBBC05" d="M11.6 27.3c-.5-1.3-.7-2.8-.7-4.3s.3-3 .7-4.3v-5.7H4.2C2.8 15.9 2 19.8 2 23s.8 7.1 2.2 10l7.4-5.7z"/>
          <path fill="#EA4335" d="M24 10.6c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C34.9 4 30 2 24 2 15.3 2 7.8 7.1 4.2 14.3l7.4 5.7C13.3 14.5 18.2 10.6 24 10.6z"/>
        </svg>
        {loading ? 'Redirecting…' : label}
      </button>
      <div className="auth-divider"><span>or</span></div>
    </>
  );
}
