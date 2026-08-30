import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { timingSafeEqual } from 'crypto';
import { authOptions } from '@/lib/auth';
import connectToDatabase from '@/lib/mongodb';
import { User } from '@/lib/models/User';
import { seal } from '@/lib/secretBox';
import { readState } from '@/lib/driveState';
import { rememberDriveToken } from '@/lib/driveAuth';
import { OAUTH_NONCE_COOKIE, driveRedirectUri, driveRootName, hasDriveScope, about, ensureFolder, originOf} from '@/lib/drive';

/**
 * Where Google sends the browser back, and the only place a refresh token is ever written.
 *
 * Everything here is one long refusal to trust the query string. The checks run in a fixed order
 * and every one of them is load-bearing:
 *
 *   session → signed state → state.uid IS the session → nonce cookie → error → exchange →
 *   scope actually granted → a refresh token we are allowed to keep
 *
 * The third is the one worth staring at. Without it an attacker runs consent on THEIR OWN Google
 * account, keeps the resulting `code`, and gets the victim to open the callback URL — the victim's
 * session then has the attacker's Drive welded to it, and every file the victim uploads from that
 * moment lands in a stranger's storage, quietly, forever. The signed uid is what makes that
 * impossible: a state minted for one account cannot be redeemed by another.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

type Marker = 'connected' | 'denied' | 'noPermission' | 'noRefresh';

/** Always back to a same-site path (safeReturnTo already guaranteed that), with the outcome on it. */
function land(req: NextRequest, to: string, marker: Marker) {
  // originOf, not req.nextUrl.origin: dev binds to 0.0.0.0, and sending somebody back to
  // http://0.0.0.0:3000/profile is a page the browser cannot open — so a completed consent looked
  // exactly like a failed one. Same reason the redirect_uri itself uses it.
  const url = new URL(to, originOf(req));
  url.searchParams.set('drive', marker);
  const res = NextResponse.redirect(url);
  res.cookies.delete(OAUTH_NONCE_COOKIE);   // single use, whatever the outcome
  return res;
}

const sameNonce = (a: string, b: string) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * The address of the Drive that was just connected, when `about` could not say.
 *
 * Unverified, and it does not need to be: this id_token came straight back from Google's token
 * endpoint over TLS in response to our own client secret. It never passed through the browser, so
 * there is nothing between us and Google to have forged it — which is precisely the case where
 * signature checking adds a dependency and no security.
 */
function idTokenEmail(idToken?: string | null): string {
  try {
    const payload = String(idToken || '').split('.')[1];
    if (!payload) return '';
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { email?: string };
    return String(claims?.email || '').toLowerCase();
  } catch {
    return '';
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.redirect(new URL('/login', req.nextUrl));

  const q = req.nextUrl.searchParams;
  const state = readState(q.get('state'));
  // No usable state means no idea who asked or where to send them — /profile is the honest guess,
  // and nothing has been written.
  if (!state) return land(req, '/profile', 'denied');

  // The whole point of signing the state. See the note at the top of the file.
  if (state.uid !== session.user.id) {
    console.error('Drive callback: state uid does not match the session');
    return land(req, '/profile', 'denied');
  }

  const nonce = req.cookies.get(OAUTH_NONCE_COOKIE)?.value || '';
  if (!nonce || !sameNonce(nonce, state.nonce)) return land(req, state.to, 'denied');

  // The user pressed Cancel, or Google refused. Not an error worth a stack trace.
  if (q.get('error')) return land(req, state.to, 'denied');

  const code = q.get('code');
  if (!code) return land(req, state.to, 'denied');

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('Drive callback: GOOGLE_CLIENT_ID/SECRET are not set');
    return land(req, state.to, 'denied');
  }

  let token: {
    access_token?: string; refresh_token?: string; expires_in?: number;
    scope?: string; id_token?: string; error?: string;
  } | null = null;
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        // Sent again on purpose: Google compares it with the one the code was issued for.
        redirect_uri: driveRedirectUri(originOf(req)),
        grant_type: 'authorization_code',
      }),
    });
    token = await res.json().catch(() => null);
    if (!res.ok || !token?.access_token) {
      console.error('Drive code exchange failed:', res.status, token?.error);
      return land(req, state.to, 'denied');
    }
  } catch (error) {
    console.error('Drive code exchange could not reach Google:', error);
    return land(req, state.to, 'denied');
  }

  // Consent is a set of tick boxes and the file one can be cleared. A token without drive.file
  // authenticates fine and cannot store a single byte, so say so now rather than at the first upload.
  if (!hasDriveScope(token.scope)) return land(req, state.to, 'noPermission');

  const accessToken = token.access_token;
  await connectToDatabase();

  // Which Drive this is, and — while a token is in hand and free — the root folder, so the first
  // upload is not also the first folder round-trip. Both are nice-to-have: a connection with an
  // unknown address still works, and the folder resolves lazily on first use.
  let email = '';
  let rootFolderId: string | undefined;
  try {
    email = (await about(accessToken)).email;
  } catch { /* about is not worth failing a connection over */ }
  if (!email) email = idTokenEmail(token.id_token);
  try {
    rootFolderId = await ensureFolder(accessToken, driveRootName());
  } catch { /* resolved again on first upload */ }

  const shared = {
    email: email || '',
    ...(rootFolderId ? { rootFolderId } : {}),
    connectedAt: new Date(),
    revokedAt: null,
  };

  if (token.refresh_token) {
    await User.updateOne({ _id: session.user.id }, { $set: { drive: { box: seal(token.refresh_token), ...shared } } });
  } else {
    // Google returns a refresh token only on a consent that actually happened. `prompt=consent` is
    // supposed to force one, but a Workspace policy or an already-approved grant can still skip it.
    // Overwriting a working sealed box with nothing would turn a healthy connection into a dead one
    // an hour later, so an existing box survives and only the display fields are refreshed.
    const existing = await User.findById(session.user.id).select('drive.box').lean<{ drive?: { box?: string } } | null>();
    if (!existing?.drive?.box) return land(req, state.to, 'noRefresh');
    await User.updateOne({ _id: session.user.id }, { $set: Object.fromEntries(
      Object.entries(shared).map(([k, v]) => [`drive.${k}`, v]),
    ) });
  }

  // The token just bought is good for the hour; no reason to make the next request buy another.
  rememberDriveToken(session.user.id, accessToken, Number(token.expires_in));
  return land(req, state.to, 'connected');
}
