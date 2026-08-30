/**
 * WHOSE Drive, and the live token to reach it with.
 *
 * The mirror of `sarvamAccess.ts`: `drive.ts` is transport and stays free of the database, and this
 * is the single place that turns a userId into a credential. `drive.ts` takes the token as a
 * required argument, so there is no path that quietly writes into somebody else's Drive.
 *
 * What is stored is the refresh token, sealed by lib/secretBox — a leaked database backup is then a
 * pile of ciphertext rather than standing permission to write into every user's Drive. The access
 * token it buys lives for an hour and is kept in memory only.
 *
 * Takes a userId rather than an email because files belong to the UPLOADER's Drive: a teammate
 * reading a shared document is not the person whose token opens it, and asking with their own id
 * would 404 every file in the group.
 */

import connectToDatabase from '@/lib/mongodb';
import { User } from '@/lib/models/User';
import { open } from '@/lib/secretBox';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * A serverless instance handles a handful of people before it is recycled, so this is a small
 * warm-path saving, not a store. Capped because an instance that lived all day would otherwise
 * hold every token it ever minted in memory; oldest out first, which a Map gives for free.
 */
const cache = new Map<string, { token: string; expMs: number }>();
const MAX_CACHED = 50;
/** Expire a minute early. A token that dies mid-upload costs a retry the user has to notice. */
const MARGIN_MS = 60 * 1000;

/** Also called by the callback, which already holds a fresh token and should not buy a second one. */
export function rememberDriveToken(userId: string, token: string, expiresInSeconds: number) {
  cache.delete(userId);
  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(userId, { token, expMs: Date.now() + (Number(expiresInSeconds) || 3600) * 1000 - MARGIN_MS });
}

/** Disconnecting has to bite immediately, not in an hour when the cached token happens to lapse. */
export const forgetDriveToken = (userId: string) => void cache.delete(userId);

/**
 * null means "this account cannot write to Drive right now" — not connected, revoked, or Google
 * refused. Callers turn that into "connect your Drive to upload", never into a silent fallback:
 * Drive is the only storage there is, so there is nothing to fall back to.
 */
export async function driveAccessToken(userId?: string | null): Promise<string | null> {
  if (!userId) return null;

  const cached = cache.get(userId);
  if (cached && cached.expMs > Date.now()) return cached.token;

  await connectToDatabase();
  const user = await User.findById(userId)
    .select('drive.box drive.revokedAt')
    .lean<{ drive?: { box?: string; revokedAt?: Date | null } } | null>();

  // Revoked first: the sealed box is still there on purpose (it is what the reconnect notice hangs
  // off), and trying it again would just earn another invalid_grant from Google every page load.
  if (user?.drive?.revokedAt) return null;
  const refreshToken = open(user?.drive?.box);
  if (!refreshToken) return null;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('Drive refresh skipped: GOOGLE_CLIENT_ID/SECRET are not set');
    return null;
  }

  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
  } catch (error) {
    console.error('Drive token refresh could not reach Google:', error);
    return null;   // a network blip, not a broken connection — nothing to record
  }

  const data = (await res.json().catch(() => null)) as
    { access_token?: string; expires_in?: number; error?: string } | null;

  if (!res.ok || !data?.access_token) {
    // The user pulled our access from their Google account settings, or changed their password, or
    // the app was left unverified past its test-user window. Whichever it is, the refresh token is
    // dead for good and retrying it every request just spends quota to be told so again. Stamp it,
    // keep the box (so the card can say "reconnect" rather than "never connected"), and stop.
    if (data?.error === 'invalid_grant') {
      await User.updateOne({ _id: userId }, { $set: { 'drive.revokedAt': new Date() } });
      cache.delete(userId);
      return null;
    }
    console.error('Drive token refresh rejected:', res.status, data?.error);
    return null;
  }

  rememberDriveToken(userId, data.access_token, Number(data.expires_in));
  return data.access_token;
}

/** Whether uploads are possible at all for this account. Display and branching only. */
export const driveConnected = async (userId?: string | null) => !!(await driveAccessToken(userId));
