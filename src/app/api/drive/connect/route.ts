import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { randomBytes } from 'crypto';
import { authOptions } from '@/lib/auth';
import { DRIVE_SCOPE, OAUTH_NONCE_COOKIE, driveRedirectUri, originOf} from '@/lib/drive';
import { signState, safeReturnTo, STATE_TTL_MS } from '@/lib/driveState';
import { readHandoff } from '@/lib/nativeAuth';

/**
 * The start of "connect my Drive": mint the CSRF pair, then hand the browser to Google.
 *
 * This is deliberately NOT part of the NextAuth Google provider. Signing in and granting file
 * storage are different consents asked at different moments — a first-time visitor should not be
 * shown a Drive permission prompt to log in, and a password-only user must still be able to connect
 * a Drive that is nothing to do with their app address.
 *
 * Nothing is minted here but a nonce. No token is created, encoded or signed by this app.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);

  // The Android app arrives here inside a Chrome Custom Tab, which has its own cookie jar and so no
  // session at all — the WebView holds that. It proves who it is with a two-minute HMAC signed by
  // NEXTAUTH_SECRET, mintable only by a POST from an already-signed-in WebView. See lib/nativeAuth.ts.
  const native = req.nextUrl.searchParams.get('native') === '1';
  const handoffUid = native ? readHandoff(req.nextUrl.searchParams.get('handoff')) : null;

  // /auth/signin, not /login — there is no /login route in this app. It used to be unreachable:
  // the auth proxy refused this path first and sent people to the real sign-in page. Now that
  // api/drive is exempt from that gate (it has to be, for the Custom Tab), this line is reached,
  // and it would have bounced through sign-in only to land on a 404.
  const uid = session?.user?.id || handoffUid;
  if (!uid) return NextResponse.redirect(new URL('/auth/signin', req.nextUrl));

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    console.error('Drive connect: GOOGLE_CLIENT_ID is not set');
    return NextResponse.redirect(new URL('/profile?drive=denied', req.nextUrl));
  }

  // Where to land afterwards. It arrives as a query parameter, so it goes through the open-redirect
  // guard before it is signed — a signed `//evil.com` would be worse than an unsigned one.
  const to = safeReturnTo(req.nextUrl.searchParams.get('to'));

  const nonce = randomBytes(18).toString('base64url');
  const state = signState({ uid, nonce, to, native, exp: Date.now() + STATE_TTL_MS });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: driveRedirectUri(originOf(req)),
    response_type: 'code',
    scope: DRIVE_SCOPE,
    // The two that decide whether this connection can outlive the hour it was made in.
    access_type: 'offline',
    // Without `prompt=consent` Google skips the screen for anyone who has approved this app before
    // and returns NO refresh token — the exchange succeeds, the connection looks healthy, and every
    // upload after the first hour fails. Reconnecting is exactly the case that hits it.
    prompt: 'consent',
    // Keeps the sign-in scopes the user already granted instead of silently narrowing them
    include_granted_scopes: 'true',
    state,
  });

  const res = NextResponse.redirect(`${AUTH_ENDPOINT}?${params}`);
  // Set on the response rather than through next/headers: this response IS a redirect, and the
  // cookie has to ride on it. The state carries the same nonce signed, so the callback can only be
  // completed by the browser that started it — a code replayed from anywhere else has no cookie.
  res.cookies.set(OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',   // 'strict' would drop the cookie on the way back from Google
    path: '/',
    maxAge: Math.floor(STATE_TTL_MS / 1000),
  });
  return res;
}
