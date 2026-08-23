import { createHmac } from 'crypto';
import { cookies } from 'next/headers';

// HMAC-signed httpOnly cookie proving the private-safe PIN was verified server-side.
const sign = (payload: string) =>
  createHmac('sha256', process.env.NEXTAUTH_SECRET!).update(payload).digest('hex');

const MAX_AGE_SECONDS = 12 * 3600;

export async function grantSafe(userId: string) {
  const exp = Date.now() + MAX_AGE_SECONDS * 1000;
  const payload = `${userId}.${exp}`;
  (await cookies()).set('safeAuth', `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: MAX_AGE_SECONDS,
    path: '/',
  });
}

export async function hasSafe(userId: string) {
  const value = (await cookies()).get('safeAuth')?.value;
  if (!value) return false;
  const [uid, exp, sig] = value.split('.');
  if (!uid || !exp || !sig) return false;
  return uid === userId && Number(exp) > Date.now() && sig === sign(`${uid}.${exp}`); // ponytail: use timingSafeEqual if paranoid
}

/** Locking the safe must destroy the server-side grant, not just the UI flag. */
export async function revokeSafe() {
  (await cookies()).delete('safeAuth');
}
