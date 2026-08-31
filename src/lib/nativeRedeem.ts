import connectToDatabase from '@/lib/mongodb';
import { User } from '@/lib/models/User';
import { NativeAuthCode } from '@/lib/models/NativeAuthCode';
import { hashSecret, secretMatches } from '@/lib/nativeAuth';
import { SUSPENDED_ERROR } from '@/lib/suspension';

/**
 * Spend a one-time native sign-in code and answer with the account it belongs to.
 *
 * Kept out of lib/auth.ts so the provider there stays a thin wrapper, and so this can be reasoned
 * about — and tested — as the small security-critical thing it is.
 *
 * A note on why this returns a user instead of a session token. The obvious implementation of the
 * native handoff is to mint a NextAuth JWT directly with `encode` and set the cookie. That is
 * forbidden here, and the reason is written in a box at the top of lib/accountLocker.ts: a path
 * that mints a session for an arbitrary user id is unconditional account takeover the moment
 * anyone makes it reachable with attacker-controlled input. Routing through a CredentialsProvider
 * instead means NextAuth does the minting, on its own terms, exactly as it does for a password —
 * and `grep -rn "from 'next-auth/jwt'" src` keeps showing only `decode` and `getToken`.
 */
export async function redeemNativeCode(code: string, verifier: string) {
  if (!code || !verifier) throw new Error('That sign-in link was incomplete.');

  await connectToDatabase();

  // Burn first, check second. One atomic operation, so two requests racing the same code cannot
  // both win — and burning before the verifier is examined means an app that intercepted the deep
  // link gets no chance to sit and guess at it. The cost is that a hostile app can waste a code
  // and the person signs in again. Losing a code beats leaking a session.
  const row = await NativeAuthCode.findOneAndUpdate(
    { codeHash: hashSecret(code), usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { new: true },
  );

  if (!row) throw new Error('That sign-in link has already been used or has expired.');

  // The half an interceptor cannot have. See lib/nativeAuth.ts for the protocol.
  if (!secretMatches(row.challenge, verifier)) {
    console.warn('[native auth] verifier did not match the challenge — code burned, no session issued');
    throw new Error('That sign-in could not be verified. Please try again.');
  }

  const user = await User.findById(row.userId).select('email name deletedAt suspendedAt');
  if (!user) throw new Error('This account is no longer available.');

  // The code was minted against a live session a minute or two ago, and a minute is long enough
  // for an admin to suspend the account. Re-check rather than trusting the code — the same
  // backstop the session callback in lib/auth.ts applies on every request.
  if (user.deletedAt) throw new Error('This account has been deleted');
  if (user.suspendedAt) throw new Error(SUSPENDED_ERROR);

  return { id: String(user._id), email: user.email, name: user.name };
}
