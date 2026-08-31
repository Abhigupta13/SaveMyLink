'use server';

/**
 * Account deletion, with DISCLOSED retention (see /terms). Deleting your account erases your
 * content immediately and everywhere; the User row itself is reduced to name/email/role and kept
 * for 90 days for our records, then purged. An undisclosed-retention version was rejected — it
 * would break the "your data stays yours" promise the whole product rests on.
 *
 * The trust boundary is the session: there is no userId argument, the session IS the identity, and
 * re-auth (password, or the account email for a Google-only login) runs before anything is touched.
 */

import { authOptions } from '@/lib/auth';
import connectToDatabase from '@/lib/mongodb';
import { getServerSession } from 'next-auth';
import bcrypt from 'bcryptjs';
import { User } from '@/lib/models/User';
// The erase itself is NOT exported from this module. Every exported async function in a
// 'use server' file is a callable RPC endpoint, and eraseAccount takes its victim as an argument
// rather than reading a session — so it lives in lib/, reachable only through the gated wrapper
// below and through adminDeleteUser.
import { eraseAccount } from '@/lib/accountErase';


/**
 * How the delete screen should ask the user to re-authenticate: a password account re-enters its
 * password, a Google-only account (no local password) types its email back. Never returns the
 * password itself — only whether one exists.
 */
export async function accountAuthMode() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { hasPassword: false, hasPin: false, email: '' };
  await connectToDatabase();
  const user = await User.findById((session.user as { id: string }).id)
    .select('password privatePin').lean<{ password?: string; privatePin?: string } | null>();
  // Only whether each exists, never the value — the delete screen decides which fields to show.
  return { hasPassword: !!user?.password, hasPin: !!user?.privatePin, email: session.user.email || '' };
}

/**
 * Delete the signed-in user's account.
 *
 * `password` carries the re-auth secret: the account password for a password login, or the account
 * email typed back for a Google-only login. `pin` is the Private Safe PIN, required only when one
 * has been set.
 *
 * **Both, when both exist.** The safe is the one thing in the app the account password alone cannot
 * open, so deleting everything on the password alone would let someone who got hold of an unlocked
 * session destroy the contents of a safe they could never have read. Asking for the PIN makes the
 * destructive path at least as hard as the reading path.
 */
export async function deleteMyAccount({ password, pin }: { password?: string; pin?: string }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Not authenticated' };
  const userId = (session.user as { id: string }).id;

  try {
    await connectToDatabase();
    const user = await User.findById(userId);
    if (!user || user.deletedAt) return { error: 'Account not found' };
    const email = user.email.toLowerCase();

    // Re-auth. Password accounts compare the password like sign-in; a Google-only account (no
    // local password) confirms by typing its own email back. Either mismatch refuses.
    if (user.password) {
      if (!password || !(await bcrypt.compare(password, user.password))) {
        return { error: 'Incorrect password' };
      }
    } else if ((password || '').trim().toLowerCase() !== email) {
      return { error: 'Email does not match' };
    }

    // And the safe's own PIN, when there is one. Checked separately so the message says which of
    // the two was wrong — a single "that didn't work" on a screen with no undo is cruel.
    if (user.privatePin) {
      if (!pin || !(await bcrypt.compare(pin, user.privatePin))) {
        return { error: 'Incorrect Private Safe PIN' };
      }
    }

    await eraseAccount(userId, email, '');
    return { success: true };
  } catch (error) {
    console.error('Failed to delete account:', error);
    return { error: 'Could not delete your account. Nothing was changed if this repeats.' };
  }
}
