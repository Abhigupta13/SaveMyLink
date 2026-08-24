/**
 * The 6-digit email code, in one place. Password reset had all of this inline; email
 * verification needs exactly the same rules, and two copies of a security check drift.
 *
 * Pure on purpose — no database, no session — so scripts/self-check.mjs can prove the
 * expiry and lockout behaviour without standing up mongo.
 */
import { createHash, randomInt, timingSafeEqual } from 'crypto';

export const OTP_TTL_MS = 10 * 60 * 1000;
export const MAX_OTP_ATTEMPTS = 5;

export const newOtp = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** Only ever the hash is stored, so a leaked user row does not hand over a live code. */
export const hashOtp = (code: string) => createHash('sha256').update(code).digest('hex');

export const otpExpiry = () => new Date(Date.now() + OTP_TTL_MS);

export const isSixDigits = (code: string) => /^\d{6}$/.test(code || '');

export interface OtpState { token?: string | null; expiry?: Date | null; attempts?: number | null }

/**
 * 'expired' covers "never issued" too — a user with no pending code is told to request one
 * rather than that none exists, which would confirm the account either way.
 */
export type OtpVerdict = 'ok' | 'expired' | 'locked' | 'wrong';

export function checkOtp(state: OtpState, code: string): OtpVerdict {
  if (!state.token || !state.expiry || new Date(state.expiry) < new Date()) return 'expired';
  if ((state.attempts || 0) >= MAX_OTP_ATTEMPTS) return 'locked';
  const a = Buffer.from(state.token, 'utf8');
  const b = Buffer.from(hashOtp(code), 'utf8');
  // Both are fixed-length sha256 hex, so an unequal length means a malformed stored token
  return a.length === b.length && timingSafeEqual(a, b) ? 'ok' : 'wrong';
}

export const attemptsLeftMessage = (attempts: number) => {
  const left = Math.max(0, MAX_OTP_ATTEMPTS - attempts);
  return `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.`;
};
