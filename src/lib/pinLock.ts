/**
 * Lockout for the Private Safe PIN, in one place.
 *
 * The PIN is exactly four digits (setPrivatePin enforces /^\d{4}$/), so the whole keyspace is
 * 10,000. verifyPrivatePin had no attempt counter, no lockout and no delay — a bare bcrypt.compare
 * — which means anyone holding a stolen session could enumerate the safe in minutes. The account
 * password is not a second line of defence here: resetPrivatePin accepts unlimited password
 * guesses too, so the same loop opens both. This gates both.
 *
 * Why a COOLDOWN rather than lib/otp's permanent lock. An OTP lockout is escapable: the user asks
 * for a new code and the counter resets with it. A PIN has no reissue step, so the same design
 * would brick the safe on the fifth typo with no way back in short of an admin. A window that
 * expires keeps brute force uneconomic (5 tries per 15 minutes is ~500 hours for the keyspace)
 * without ever permanently locking a real person out of their own vault.
 *
 * Pure on purpose — no database, no session, no clock of its own — so tests/unit/pinLock.test.ts
 * can prove every branch, and so `now` can be injected rather than slept through.
 */

export const MAX_PIN_ATTEMPTS = 5;
export const PIN_LOCK_MS = 15 * 60 * 1000;

export interface PinState {
  attempts?: number | null;
  lockedUntil?: Date | string | number | null;
}

/**
 * A stored count that is missing, negative, fractional or not a number at all reads as zero rather
 * than throwing. The row is only ever written by afterWrongPin/afterCorrectPin below, but it is a
 * database field and a corrupt one must not decide a security question by accident.
 */
export function attemptsOf(state: PinState | null | undefined): number {
  const n = Number(state?.attempts ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Milliseconds still to wait, or 0 when guesses are allowed.
 *
 * An unparseable `lockedUntil` reads as NOT locked. That direction is deliberate and it is the one
 * place here that fails open: the alternative is that one corrupt date permanently seals a real
 * person's safe with no reset path. The attempt counter still applies, so the cost of being wrong
 * is at most MAX_PIN_ATTEMPTS more guesses before the lock is rewritten correctly.
 */
export function lockRemaining(state: PinState | null | undefined, now: number = Date.now()): number {
  const raw = state?.lockedUntil;
  if (raw === null || raw === undefined || raw === '') return 0;
  const until = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  if (!Number.isFinite(until)) return 0;
  return until > now ? until - now : 0;
}

export const isPinLocked = (state: PinState | null | undefined, now: number = Date.now()): boolean =>
  lockRemaining(state, now) > 0;

/**
 * What to write after a wrong guess.
 *
 * The counter keeps climbing past the threshold rather than resetting, so each further guess made
 * while locked pushes the window out again — an attacker who ignores the lock and keeps posting
 * never gets a free window back. A correct guess is the only thing that clears it.
 */
export function afterWrongPin(
  state: PinState | null | undefined,
  now: number = Date.now(),
): { attempts: number; lockedUntil: Date | null } {
  // A lapsed window starts the count over: five typos last month are not evidence about today.
  const attempts = recentAttempts(state, now) + 1;
  return {
    attempts,
    lockedUntil: attempts >= MAX_PIN_ATTEMPTS ? new Date(now + PIN_LOCK_MS) : null,
  };
}

/**
 * The count that still applies. Once a lock has expired the slate is clean — otherwise the sixth
 * wrong guess ever made, however many months apart, would lock the safe forever after.
 */
function recentAttempts(state: PinState | null | undefined, now: number): number {
  const had = state?.lockedUntil;
  if (had && !isPinLocked(state, now)) return 0;
  return attemptsOf(state);
}

/** What to write after a correct guess: the slate is clean. */
export const afterCorrectPin = (): { attempts: number; lockedUntil: null } =>
  ({ attempts: 0, lockedUntil: null });

/** How many guesses are left before the window closes. Never negative. */
export const pinAttemptsLeft = (state: PinState | null | undefined, now: number = Date.now()): number =>
  Math.max(0, MAX_PIN_ATTEMPTS - (isPinLocked(state, now) ? MAX_PIN_ATTEMPTS : recentAttempts(state, now)));

/**
 * What the user is told. Rounded up to the next minute, because "try again in 0 minutes" reads as
 * broken, and phrased without saying how many guesses have been seen — that is information the
 * person guessing does not need.
 */
export function pinLockedMessage(msRemaining: number): string {
  const mins = Math.max(1, Math.ceil(msRemaining / 60000));
  return `Too many incorrect attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`;
}
