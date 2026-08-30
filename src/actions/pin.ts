'use server';

import connectToDatabase from '@/lib/mongodb';
import { User } from '@/lib/models/User';
import bcrypt from 'bcryptjs';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from 'next/cache';
import { grantSafe, hasSafe, revokeSafe } from '@/lib/safeCookie';

/**
 * Every screen whose list the safe swaps. It started as /links and the home page, which was the
 * whole of it while only links and categories had a padlock; now notes, tasks, meetings, the
 * locker and contacts each swap too, and a cached page showing the other vault is the safe
 * failing in the one direction that matters. Both ends of the toggle clear the same set — a
 * refresh on lock and not on unlock is how the two halves drift apart.
 */
const SAFE_PATHS = ['/', '/links', '/notes', '/tasks', '/mom', '/d-locker', '/contacts'];
const refreshSwappedLists = () => { for (const path of SAFE_PATHS) revalidatePath(path); };

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

export async function verifyPrivatePin(pin: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Not authenticated' };

  await connectToDatabase();
  const user = await User.findById((session.user as any).id);
  
  if (!user?.privatePin) {
    return { error: 'No PIN set' };
  }

  const isValid = await bcrypt.compare(pin, user.privatePin);

  if (isValid) {
    await grantSafe((session.user as any).id);
    refreshSwappedLists();
  }

  return {
    success: isValid
  };
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

  // Verify account password first
  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    return { error: 'Incorrect account password' };
  }

  // Hash and save new PIN
  const hashedPin = await bcrypt.hash(newPin, 10);
  await User.findByIdAndUpdate(user._id, {
    privatePin: hashedPin
  });

  return { success: true };
}
