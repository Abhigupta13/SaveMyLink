'use server';

/**
 * The user's own Sarvam key: stored sealed, never handed back.
 *
 * Sarvam bills whoever owns the key, so this is how someone gets the upgraded Hindi engine
 * without the founder paying for their meetings. Three rules the code has to keep:
 *   1. The plaintext key leaves the browser once, on the way in, and never comes back out —
 *      `sarvamKeyStatus` returns four characters, which is enough to recognise it and useless
 *      to anyone who reads it.
 *   2. Only the signed-in account can touch its own key. There is no userId argument here on
 *      purpose: the session IS the identity, so there is nothing to tamper with.
 *   3. It is stored sealed (AES-256-GCM via lib/secretBox), so a leaked database backup is not
 *      a set of live third-party credentials.
 */

import { authOptions } from '@/lib/auth';
import connectToDatabase from '@/lib/mongodb';
import { User } from '@/lib/models/User';
import { seal } from '@/lib/secretBox';
import { getServerSession } from 'next-auth';

// Deliberately loose. Sarvam's dashboard has changed its key format before, and a regex that is
// stricter than reality locks out a paying user with a perfectly good key. This rejects the
// things that are certainly not a key — blank, pasted prose, an entire curl command.
const looksLikeKey = (v: string) => /^[A-Za-z0-9_.:-]{16,200}$/.test(v);

async function me() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  await connectToDatabase();
  return session.user.id;
}

export async function sarvamKeyStatus() {
  try {
    const userId = await me();
    if (!userId) return { success: false as const, error: 'Unauthorized' };
    const user = await User.findById(userId).select('sarvamKey.last4').lean();
    return { success: true as const, has: !!user?.sarvamKey?.last4, last4: user?.sarvamKey?.last4 };
  } catch (error) {
    console.error('Failed to read Sarvam key status:', error);
    return { success: false as const, error: 'Could not check the key' };
  }
}

export async function setSarvamKey(key: string) {
  try {
    const userId = await me();
    if (!userId) return { success: false as const, error: 'Unauthorized' };

    const trimmed = String(key || '').trim();
    if (!trimmed) return { success: false as const, error: 'Paste your Sarvam API key' };
    if (!looksLikeKey(trimmed)) return { success: false as const, error: 'That does not look like a Sarvam API key' };

    const last4 = trimmed.slice(-4);
    await User.updateOne({ _id: userId }, { $set: { sarvamKey: { box: seal(trimmed), last4 } } });
    return { success: true as const, last4 };
  } catch (error) {
    console.error('Failed to save Sarvam key:', error);
    return { success: false as const, error: 'Could not save the key' };
  }
}

export async function clearSarvamKey() {
  try {
    const userId = await me();
    if (!userId) return { success: false as const, error: 'Unauthorized' };
    await User.updateOne({ _id: userId }, { $unset: { sarvamKey: 1 } });
    return { success: true as const };
  } catch (error) {
    console.error('Failed to remove Sarvam key:', error);
    return { success: false as const, error: 'Could not remove the key' };
  }
}
