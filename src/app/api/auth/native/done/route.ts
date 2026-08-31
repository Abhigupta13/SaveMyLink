import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectToDatabase from '@/lib/mongodb';
import { NativeAuthCode } from '@/lib/models/NativeAuthCode';
import { hashSecret, nativeAuthDeepLink, newSecret, NATIVE_CODE_TTL_MS } from '@/lib/nativeAuth';
import { nativeReturnPage } from '@/lib/nativeReturn';

/**
 * Step two: Google has signed the person in, but the session cookie is sitting in Chrome where the
 * app cannot see it. Mint a one-time code bound to the WebView's challenge and bounce back into
 * the app through the deep link.
 *
 * Nothing sensitive rides in the URL — the code is useless without the verifier the WebView kept.
 * See lib/nativeAuth.ts for why that binding is not optional.
 */

const CHALLENGE = /^[A-Za-z0-9_-]{32,128}$/;

/** Told to the person, in the Custom Tab, when the handoff cannot be completed. */
function failure(message: string) {
  return new NextResponse(page(`<p>${message}</p><p><a href="/auth/signin">Open sign-in</a></p>`), {
    status: 400,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function page(body: string) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Returning to the app…</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100dvh; display:flex; flex-direction:column; align-items:center;
         justify-content:center; gap:14px; padding:24px; text-align:center;
         font: 500 15px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         background:#faf9f7; color:#3d3a36; }
  @media (prefers-color-scheme: dark) { body { background:#1c1b19; color:#e8e4de; } }
  a.btn { display:inline-block; background:#c96442; color:#fff; text-decoration:none;
          padding:12px 22px; border-radius:12px; font-weight:700; }
  a { color:#c96442; }
</style>
</head><body>${body}</body></html>`;
}

export async function GET(req: NextRequest) {
  const challenge = req.nextUrl.searchParams.get('challenge') ?? '';
  if (!CHALLENGE.test(challenge)) return failure('This sign-in link is malformed. Start again from the app.');

  // This runs in Chrome, where NextAuth has just set its cookie — so there is a session here even
  // though the WebView still has none. That asymmetry is the entire reason this route exists.
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return failure('Sign-in did not complete. Close this tab and try again from the app.');
  }

  const code = newSecret();
  try {
    await connectToDatabase();
    await NativeAuthCode.create({
      codeHash: hashSecret(code),
      challenge,
      userId: session.user.id,
      expiresAt: new Date(Date.now() + NATIVE_CODE_TTL_MS),
    });
  } catch (err) {
    console.error('[native auth] could not store handoff code:', err);
    return failure('Could not finish signing in. Close this tab and try again.');
  }

  return nativeReturnPage(nativeAuthDeepLink(code), 'Signed in. Returning to the app…');
}
