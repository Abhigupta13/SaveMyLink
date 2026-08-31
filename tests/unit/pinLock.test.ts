import { describe, test, expect } from 'vitest';
import {
  MAX_PIN_ATTEMPTS, PIN_LOCK_MS,
  attemptsOf, lockRemaining, isPinLocked,
  afterWrongPin, afterCorrectPin, pinAttemptsLeft, pinLockedMessage,
} from '@/lib/pinLock';

/**
 * The Private Safe PIN is four digits — 10,000 combinations — and before this module
 * verifyPrivatePin was a bare bcrypt.compare with no counter and no delay. So the property that
 * matters is not "it locks" but "there is no input shape that quietly leaves it unlocked":
 * a corrupt row, a lapsed window, or an attacker who ignores the lock and keeps posting.
 */

const T0 = 1_700_000_000_000;          // a fixed instant; nothing here reads the wall clock
const locked = (until: number, attempts = MAX_PIN_ATTEMPTS) => ({ attempts, lockedUntil: new Date(until) });

describe('attemptsOf', () => {
  test('a missing or absent count is zero, never NaN', () => {
    expect(attemptsOf(undefined)).toBe(0);
    expect(attemptsOf(null)).toBe(0);
    expect(attemptsOf({})).toBe(0);
    expect(attemptsOf({ attempts: null })).toBe(0);
  });

  test('a corrupt count never reads as a negative allowance', () => {
    // The danger is a value that makes MAX - attempts LARGER than MAX, handing out extra guesses.
    expect(attemptsOf({ attempts: -5 })).toBe(0);
    expect(attemptsOf({ attempts: Number.NaN })).toBe(0);
    expect(attemptsOf({ attempts: Number.NEGATIVE_INFINITY })).toBe(0);
    expect(attemptsOf({ attempts: 'nonsense' as unknown as number })).toBe(0);
  });

  test('a real count is kept, and a fractional one floors rather than throwing', () => {
    expect(attemptsOf({ attempts: 3 })).toBe(3);
    expect(attemptsOf({ attempts: 2.9 })).toBe(2);
  });
});

describe('lockRemaining / isPinLocked', () => {
  test('no lock recorded means no wait', () => {
    for (const s of [undefined, null, {}, { lockedUntil: null }, { lockedUntil: '' }]) {
      expect(lockRemaining(s, T0)).toBe(0);
      expect(isPinLocked(s, T0)).toBe(false);
    }
  });

  test('a future lock is counted down, in milliseconds', () => {
    expect(lockRemaining(locked(T0 + 60_000), T0)).toBe(60_000);
    expect(isPinLocked(locked(T0 + 1), T0)).toBe(true);
  });

  test('the boundary instant is open, not locked — the window has elapsed', () => {
    expect(lockRemaining(locked(T0), T0)).toBe(0);
    expect(isPinLocked(locked(T0), T0)).toBe(false);
  });

  test('a past lock is over', () => {
    expect(isPinLocked(locked(T0 - 1), T0)).toBe(false);
  });

  test('a Date, an ISO string and an epoch number are the same instant', () => {
    const at = T0 + 30_000;
    expect(lockRemaining({ lockedUntil: new Date(at) }, T0)).toBe(30_000);
    expect(lockRemaining({ lockedUntil: new Date(at).toISOString() }, T0)).toBe(30_000);
    expect(lockRemaining({ lockedUntil: at }, T0)).toBe(30_000);
  });

  /* This is the one deliberate fail-OPEN in the module. An unparseable date must not permanently
     seal a real person's safe, because there is no reissue path to escape it. The attempt counter
     is what bounds the cost of being wrong here. */
  test('an unparseable lock reads as open rather than sealing the safe forever', () => {
    expect(lockRemaining({ lockedUntil: 'not a date' }, T0)).toBe(0);
    expect(lockRemaining({ lockedUntil: Number.NaN }, T0)).toBe(0);
  });
});

describe('afterWrongPin', () => {
  test('counts up and does not lock before the threshold', () => {
    let state: { attempts: number; lockedUntil: Date | null } = { attempts: 0, lockedUntil: null };
    for (let i = 1; i < MAX_PIN_ATTEMPTS; i++) {
      state = afterWrongPin(state, T0);
      expect(state.attempts).toBe(i);
      expect(state.lockedUntil).toBeNull();
    }
    // The threshold guess is the one that closes it.
    state = afterWrongPin(state, T0);
    expect(state.attempts).toBe(MAX_PIN_ATTEMPTS);
    expect(state.lockedUntil).toEqual(new Date(T0 + PIN_LOCK_MS));
    expect(isPinLocked(state, T0)).toBe(true);
  });

  test('a first wrong guess against an empty row starts at one', () => {
    expect(afterWrongPin(undefined, T0).attempts).toBe(1);
    expect(afterWrongPin({}, T0).attempts).toBe(1);
  });

  /* An attacker who ignores the lock and keeps posting must not be able to sit out one window and
     then get a fresh five. Each guess made while locked pushes the window out again. */
  test('guessing while locked extends the lock instead of running it down', () => {
    const state = locked(T0 + 60_000);
    const next = afterWrongPin(state, T0);
    expect(next.attempts).toBe(MAX_PIN_ATTEMPTS + 1);
    expect(next.lockedUntil).toEqual(new Date(T0 + PIN_LOCK_MS));
    expect(lockRemaining(next, T0)).toBe(PIN_LOCK_MS);
  });

  /* ...but an honest user who walked away and came back gets a clean slate, otherwise the sixth
     wrong guess ever made — months apart — would lock the safe permanently from then on. */
  test('a lapsed window resets the count', () => {
    const stale = locked(T0 - 1);
    const next = afterWrongPin(stale, T0);
    expect(next.attempts).toBe(1);
    expect(next.lockedUntil).toBeNull();
  });

  test('a corrupt count cannot buy extra guesses', () => {
    const next = afterWrongPin({ attempts: -100, lockedUntil: null }, T0);
    expect(next.attempts).toBe(1);
  });
});

describe('afterCorrectPin', () => {
  test('the right PIN clears both the count and the lock', () => {
    expect(afterCorrectPin()).toEqual({ attempts: 0, lockedUntil: null });
    expect(isPinLocked(afterCorrectPin(), T0)).toBe(false);
    expect(pinAttemptsLeft(afterCorrectPin(), T0)).toBe(MAX_PIN_ATTEMPTS);
  });
});

describe('pinAttemptsLeft', () => {
  test('counts down with the attempts', () => {
    expect(pinAttemptsLeft({ attempts: 0 }, T0)).toBe(MAX_PIN_ATTEMPTS);
    expect(pinAttemptsLeft({ attempts: 3 }, T0)).toBe(MAX_PIN_ATTEMPTS - 3);
  });

  test('is zero while locked, and never negative', () => {
    expect(pinAttemptsLeft(locked(T0 + 1000), T0)).toBe(0);
    expect(pinAttemptsLeft({ attempts: 999 }, T0)).toBe(0);
  });

  test('a lapsed lock restores the full allowance', () => {
    expect(pinAttemptsLeft(locked(T0 - 1), T0)).toBe(MAX_PIN_ATTEMPTS);
  });
});

describe('pinLockedMessage', () => {
  test('rounds up, so it never says zero minutes', () => {
    expect(pinLockedMessage(1)).toContain('1 minute');
    expect(pinLockedMessage(0)).toContain('1 minute');
    expect(pinLockedMessage(60_000)).toContain('1 minute');
    expect(pinLockedMessage(61_000)).toContain('2 minutes');
    expect(pinLockedMessage(PIN_LOCK_MS)).toContain('15 minutes');
  });

  /* The only number in the message is the wait. A count of guesses seen or remaining tells the
     person guessing how close they are, which is the one thing they cannot otherwise measure.
     (Asserted as "no count OF ATTEMPTS" rather than "no digit 5" — the duration is legitimately
     numeric, and "15 minutes" happens to contain MAX_PIN_ATTEMPTS as a substring.) */
  test('says nothing about how many guesses have been seen or remain', () => {
    const said = pinLockedMessage(PIN_LOCK_MS);
    expect(said).not.toMatch(/\d+\s*(more\s+)?(attempts?|tries|guesses)/i);
    expect(said).not.toMatch(/\b(left|remaining)\b/i);
    // The wait itself is the only number present.
    expect(said.match(/\d+/g)).toEqual(['15']);
  });
});
