import { describe, test, expect, vi, beforeEach } from 'vitest';
import { hashSecret, newSecret } from '@/lib/nativeAuth';
import { SUSPENDED_ERROR } from '@/lib/suspension';

/**
 * redeemNativeCode is the function that decides whether somebody gets a session.
 *
 * It is reached from a CredentialsProvider whose input arrives over a deep link, on a custom URL
 * scheme any installed app may also claim. So every refusal in here is load-bearing, and the order
 * of the checks is part of the design rather than an accident of how it was written. These tests
 * pin the order, not just the outcomes — a version that validates the verifier BEFORE burning the
 * code would pass a naive "wrong verifier is rejected" test while handing an interceptor unlimited
 * attempts.
 *
 * The crypto is deliberately NOT mocked. hashSecret and secretMatches do the real work here; a test
 * that stubs them proves the plumbing and nothing about the security.
 *
 * Both filter assertions below were checked by mutation rather than assumed: removing the
 * single-use conditions, and looking the code up in the clear, each fail exactly one test.
 */

// vi.mock factories are hoisted above the file, so the spies have to be hoisted with them.
const mocks = vi.hoisted(() => ({ findOneAndUpdate: vi.fn(), select: vi.fn() }));

vi.mock('@/lib/mongodb', () => ({ default: vi.fn(async () => undefined) }));
vi.mock('@/lib/models/NativeAuthCode', () => ({
  NativeAuthCode: { findOneAndUpdate: mocks.findOneAndUpdate },
}));
vi.mock('@/lib/models/User', () => ({
  User: { findById: () => ({ select: mocks.select }) },
}));

const { redeemNativeCode } = await import('@/lib/nativeRedeem');

/** The shape of the atomic burn, named so the assertions read as claims about the query. */
interface BurnFilter { codeHash: string; usedAt: null | undefined; expiresAt?: { $gt?: Date } }
interface BurnUpdate { $set: { usedAt?: Date } }

const burnCall = () => mocks.findOneAndUpdate.mock.calls[0] as unknown as [BurnFilter, BurnUpdate];

const ALICE = '507f1f77bcf86cd799439011';
const aliceRow = (verifier: string) => ({ userId: ALICE, challenge: hashSecret(verifier) });
const aliceUser = (extra: Record<string, unknown> = {}) =>
  ({ _id: ALICE, email: 'alice@example.com', name: 'Alice', ...extra });

beforeEach(() => {
  mocks.findOneAndUpdate.mockReset();
  mocks.select.mockReset();
});

describe('the happy path', () => {
  test('a matching code and verifier returns the account', async () => {
    const verifier = newSecret();
    mocks.findOneAndUpdate.mockResolvedValue(aliceRow(verifier));
    mocks.select.mockResolvedValue(aliceUser());

    await expect(redeemNativeCode('the-code', verifier))
      .resolves.toEqual({ id: ALICE, email: 'alice@example.com', name: 'Alice' });
  });

  /**
   * The single-use guarantee lives entirely in this query. `usedAt: null` and the expiry are part
   * of the FILTER, not a read-then-write — so two requests racing the same code cannot both match.
   * Move either condition out of the filter and the race reopens silently.
   */
  test('burns the code atomically: unused and unexpired are part of the filter', async () => {
    const verifier = newSecret();
    mocks.findOneAndUpdate.mockResolvedValue(aliceRow(verifier));
    mocks.select.mockResolvedValue(aliceUser());

    await redeemNativeCode('the-code', verifier);

    const [filter, update] = burnCall();
    expect(filter.usedAt).toBeNull();
    expect(filter.expiresAt?.$gt).toBeInstanceOf(Date);
    expect(update.$set.usedAt).toBeInstanceOf(Date);
  });

  /** The code itself must never be queried in the clear. */
  test('looks the code up by hash, never by its plaintext', async () => {
    const verifier = newSecret();
    mocks.findOneAndUpdate.mockResolvedValue(aliceRow(verifier));
    mocks.select.mockResolvedValue(aliceUser());

    await redeemNativeCode('the-code', verifier);

    const [filter] = burnCall();
    expect(filter.codeHash).toBe(hashSecret('the-code'));
    expect(filter.codeHash).not.toBe('the-code');
  });
});

describe('refusals', () => {
  test('an unknown, spent or expired code is refused', async () => {
    mocks.findOneAndUpdate.mockResolvedValue(null);
    await expect(redeemNativeCode('nope', newSecret())).rejects.toThrow(/already been used or has expired/);
  });

  /**
   * The interception case. The attacking app holds the code but never saw the verifier, so this is
   * the check that makes a hijacked deep link worthless.
   */
  test('a code presented with the wrong verifier is refused', async () => {
    mocks.findOneAndUpdate.mockResolvedValue(aliceRow(newSecret()));
    await expect(redeemNativeCode('the-code', newSecret())).rejects.toThrow(/could not be verified/);
  });

  /**
   * And it is refused AFTER the burn, not before. This is the ordering the comment in the source
   * argues for: a wrong verifier costs the attacker the code rather than buying them another try.
   */
  test('a wrong verifier still burns the code, so it cannot be brute-forced', async () => {
    mocks.findOneAndUpdate.mockResolvedValue(aliceRow(newSecret()));
    await expect(redeemNativeCode('the-code', newSecret())).rejects.toThrow();

    expect(mocks.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [, update] = burnCall();
    expect(update.$set.usedAt).toBeInstanceOf(Date);
  });

  test('missing halves are refused before the database is touched', async () => {
    await expect(redeemNativeCode('', newSecret())).rejects.toThrow(/incomplete/);
    await expect(redeemNativeCode('the-code', '')).rejects.toThrow(/incomplete/);
    expect(mocks.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('the account is re-checked at redemption, not trusted from the code', () => {
  /**
   * The code was minted against a live session a minute or two earlier. A minute is long enough for
   * an admin to suspend somebody, and the whole point of these two checks is that the code does not
   * outlive that decision.
   */
  test('a deleted account is refused', async () => {
    const verifier = newSecret();
    mocks.findOneAndUpdate.mockResolvedValue(aliceRow(verifier));
    mocks.select.mockResolvedValue(aliceUser({ deletedAt: new Date() }));
    await expect(redeemNativeCode('the-code', verifier)).rejects.toThrow(/deleted/);
  });

  test('a suspended account is refused with the shared suspension error', async () => {
    const verifier = newSecret();
    mocks.findOneAndUpdate.mockResolvedValue(aliceRow(verifier));
    mocks.select.mockResolvedValue(aliceUser({ suspendedAt: new Date() }));
    // The exact string matters: the sign-in page turns this one into a link to /suspended rather
    // than showing it as a typo-style error.
    await expect(redeemNativeCode('the-code', verifier)).rejects.toThrow(SUSPENDED_ERROR);
  });

  test('a code pointing at an account that no longer exists is refused', async () => {
    const verifier = newSecret();
    mocks.findOneAndUpdate.mockResolvedValue(aliceRow(verifier));
    mocks.select.mockResolvedValue(null);
    await expect(redeemNativeCode('the-code', verifier)).rejects.toThrow(/no longer available/);
  });

  test('never selects the sealed Drive refresh token', async () => {
    const verifier = newSecret();
    mocks.findOneAndUpdate.mockResolvedValue(aliceRow(verifier));
    mocks.select.mockResolvedValue(aliceUser());
    await redeemNativeCode('the-code', verifier);
    expect(mocks.select).toHaveBeenCalledWith('email name deletedAt suspendedAt');
  });
});
