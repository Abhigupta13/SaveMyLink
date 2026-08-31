'use server';

import connectToDatabase from '@/lib/mongodb';
import { User } from '@/lib/models/User';
import bcrypt from 'bcryptjs';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from 'next/cache';
import { grantSafe, hasSafe, revokeSafe } from '@/lib/safeCookie';
import { lockRemaining, afterWrongPin, afterCorrectPin, pinLockedMessage, PIN_LOCK_MS } from '@/lib/pinLock';

/**
 * Every screen whose list the safe swaps. It started as /links and the home page, which was the
 * whole of it while only links and categories had a padlock; now notes, tasks, meetings, the
 * locker and contacts each swap too, and a cached page showing the other vault is the safe
 * failing in the one direction that matters. Both ends of the toggle clear the same set — a
 * refresh on lock and not on unlock is how the two halves drift apart.
 */
const SAFE_PATHS = ['/', '/links', '/notes', '/tasks', '/mom', '/d-locker', '/contacts'];
const refreshSwappedLists = () => { for (const path of SAFE_PATHS) revalidatePath(path); };

/**
 * The lockout state, named as lib/pinLock wants it. The schema calls these fields pinAttempts and
 * pinLockedUntil because a User row has other counters on it; pinLock is generic and calls them
 * attempts and lockedUntil. Mapping here rather than renaming either side keeps the pure module
 * free of the schema — and passing the raw document instead is a silent failure, not a loud one:
 * every field reads undefined, which is indistinguishable from "no failed attempts, not locked".
 */
const pinState = (u: { pinAttempts?: number | null; pinLockedUntil?: Date | null }) =>
  ({ attempts: u.pinAttempts, lockedUntil: u.pinLockedUntil });

// Lock the safe: revoke the grant so private links can't be reached until the PIN is re-entered
export async function lockPrivateSafe() {
  await revokeSafe();
  refreshSwappedLists();
  return { success: true };
}

// Whether this session still holds a valid server-side private-safe grant
export async function getSafeStatus() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { safe: false };
  return { safe: await hasSafe((session.user as any).id) };
}

export async function getPinStatus() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Not authenticated' };

  await connectToDatabase();
  const user = await User.findById((session.user as any).id);
  
  return { 
    hasPin: !!user?.privatePin,
    success: true 
  };
}

export async function setPrivatePin(pin: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Not authenticated' };

  if (!/^\d{4}$/.test(pin)) {
    return { error: 'PIN must be exactly 4 digits' };
  }

  await connectToDatabase();
  const hashedPin = await bcrypt.hash(pin, 10);
  
  await User.findByIdAndUpdate((session.user as any).id, {
    privatePin: hashedPin
  });

  revalidatePath('/');
  return { success: true };
}

/**
 * Open the safe. Rate-limited, because the PIN is four digits and this used to be a bare
 * bcrypt.compare — 10,000 combinations with no counter, no lockout and no delay, so anyone holding
 * a stolen session could walk the whole keyspace. The rules are in lib/pinLock; this is the wiring.
 *
 * The lock is checked BEFORE the compare, so a locked-out caller cannot use response timing to
 * learn whether the guess would have been right.
 */
export async function verifyPrivatePin(pin: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { success: false, error: 'Not authenticated' };

  await connectToDatabase();
  const user = await User.findById((session.user as any).id);

  if (!user?.privatePin) {
    return { success: false, error: 'No PIN set' };
  }

  const waiting = lockRemaining(pinState(user));
  if (waiting > 0) return { success: false, locked: true, error: pinLockedMessage(waiting) };

  const isValid = await bcrypt.compare(pin, user.privatePin);

  if (isValid) {
    // The slate is cleared only by a correct PIN — that is what makes the counter mean anything.
    const cleared = afterCorrectPin();
    await User.updateOne({ _id: user._id },
      { $set: { pinAttempts: cleared.attempts, pinLockedUntil: cleared.lockedUntil } });
    await grantSafe((session.user as any).id);
    refreshSwappedLists();
    return { success: true };
  }

  const next = afterWrongPin(pinState(user));
  await User.updateOne({ _id: user._id },
    { $set: { pinAttempts: next.attempts, pinLockedUntil: next.lockedUntil } });

  return next.lockedUntil
    ? { success: false, locked: true, error: pinLockedMessage(PIN_LOCK_MS) }
    : { success: false, error: 'Incorrect PIN. Please try again.' };
}

export async function resetPrivatePin(password: string, newPin: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Not authenticated' };

  if (!/^\d{4}$/.test(newPin)) {
    return { error: 'New PIN must be exactly 4 digits' };
  }

  await connectToDatabase();
  const user = await User.findById((session.user as any).id);
  
  if (!user?.password) {
    return { error: 'Account password not found. Please contact support.' };
  }

  /* Rate-limited on the same counter as verifyPrivatePin, and deliberately so. This path takes the
     ACCOUNT PASSWORD, so leaving it open would have made "reset the PIN" a nicer oracle than
     guessing the PIN itself — unlimited password guesses against a signed-in session, and success
     hands over the safe. One shared counter also means an attacker cannot alternate between the
     two endpoints to get twice the allowance. */
  const waiting = lockRemaining(pinState(user));
  if (waiting > 0) return { error: pinLockedMessage(waiting) };

  // Verify account password first
  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    const next = afterWrongPin(pinState(user));
    await User.updateOne({ _id: user._id },
      { $set: { pinAttempts: next.attempts, pinLockedUntil: next.lockedUntil } });
    return { error: next.lockedUntil ? pinLockedMessage(PIN_LOCK_MS) : 'Incorrect account password' };
  }

  // Hash and save new PIN. Proving the account password clears the counter for the same reason a
  // correct PIN does: whoever got here is the account holder, and a fresh PIN deserves a fresh slate.
  const hashedPin = await bcrypt.hash(newPin, 10);
  const cleared = afterCorrectPin();
  await User.findByIdAndUpdate(user._id, {
    privatePin: hashedPin,
    pinAttempts: cleared.attempts,
    pinLockedUntil: cleared.lockedUntil,
  });

  return { success: true };
}
