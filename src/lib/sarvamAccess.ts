/**
 * WHO gets the upgraded (paid) Hindi engine, and on WHOSE key.
 *
 * Sarvam bills per minute of audio, so this is the money gate. It lives apart from `sarvam.ts`
 * on purpose: that file is transport and stays free of the database, and this one is the single
 * place that answers "which key". `sarvam.ts` takes the key as a required argument, so there is
 * no path that silently falls back to the founder's key.
 *
 * The server is the authority. A client may learn the answer for display, never for access —
 * every action re-asks before it spends anything.
 */

import connectToDatabase from '@/lib/mongodb';
import { User } from '@/lib/models/User';
import { open } from '@/lib/secretBox';
import { envAllowlisted } from '@/lib/sarvam';

export type SarvamKey = { key: string; source: 'own' | 'env' };

/**
 * Resolution order: the user's OWN key first, then the founder's env key if their address is on
 * the allowlist, then nothing. Own-key-first is deliberate — someone who has paid Sarvam
 * directly should be billed by Sarvam, not quietly spending the founder's balance.
 *
 * Takes a userId rather than an email because the answer must follow the account, and because
 * the caller polling a transcription job is not always the person who recorded it — the job
 * lives on the RECORDER's key and cannot be read with anyone else's.
 */
export async function sarvamKeyFor(userId?: string | null): Promise<SarvamKey | null> {
  if (!userId) return null;
  await connectToDatabase();
  const user = await User.findById(userId).select('email sarvamKey').lean();
  if (!user) return null;

  const own = open(user.sarvamKey?.box);
  if (own) return { key: own, source: 'own' };

  const envKey = process.env.SARVAM_API_KEY;
  if (envKey && envAllowlisted(user.email)) return { key: envKey, source: 'env' };

  return null;
}

/** Which recorder the client should use. Display and branching only. */
export const hinglishEnabled = async (userId?: string | null) => !!(await sarvamKeyFor(userId));
