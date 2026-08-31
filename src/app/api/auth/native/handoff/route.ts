import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { signHandoff } from '@/lib/nativeAuth';

/**
 * Mint a two-minute signed statement of "this is who I am", for the WebView to hand to a Custom Tab
 * that has no session of its own. Used by Drive connect; see lib/nativeAuth.ts.
 *
 * POST rather than GET on purpose. A GET that hands out a bearer-ish token is one `<img src>` on a
 * hostile page away from being issued to somebody else — and the token authorises starting a Drive
 * consent as this user, which is precisely the attack lib/driveState.ts exists to prevent. A POST
 * from another origin cannot be made to carry cookies without CORS the server never grants.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  }

  return NextResponse.json(
    { token: signHandoff(session.user.id) },
    { headers: { 'cache-control': 'no-store' } },
  );
}
