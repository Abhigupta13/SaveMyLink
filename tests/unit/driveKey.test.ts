import { describe, test, expect } from 'vitest';
import { keyFor, ownsKey, ownerOfKey, driveIdOfKey, isDriveKey } from '@/lib/driveKey';

/**
 * The storage-key rules behind /api/files — the only door to file bytes.
 *
 * These were an existing coverage GAP, not a new feature: `scripts/self-check.mjs:36` imports all
 * five of these functions and then asserts on none of them. Only `grantableFileIds` is exercised.
 * So the function whose own doc comment names a classic authorisation bug had nothing holding it.
 *
 * A key arrives as a URL path segment the caller controls, and it names both a file AND the Drive
 * account whose token gets opened for it. That makes these string rules an auth boundary.
 */

// Real 24-hex ObjectId shapes. The adversarial cases below only mean anything with ids that could
// actually collide, and hand-written 'u1'/'u10' would not survive ownerOfKey's format check.
const ALICE = '507f1f77bcf86cd799439011';
const BOB = '507f1f77bcf86cd799439012';
const FILE = '1a2B3c4D5e6F7g8H9i0J';

describe('ownsKey', () => {
  test('my own key is mine', () => {
    expect(ownsKey(ALICE, keyFor(ALICE, FILE))).toBe(true);
  });

  test("someone else's key is not", () => {
    expect(ownsKey(ALICE, keyFor(BOB, FILE))).toBe(false);
  });

  /**
   * The rule the whole prefix check rests on, and the one the source comment calls out by name:
   * without the trailing slash, `startsWith('u1')` matches `u10/drive/x` and hands account 1 every
   * file belonging to account 10. Asserted with ids that share a genuine prefix so the test would
   * actually fail if the slash were dropped.
   */
  test('a shorter id does not match a longer one that starts with it', () => {
    const short = '507f1f77bcf86cd79943901';       // 23 chars — a prefix of ALICE
    expect(ALICE.startsWith(short)).toBe(true);     // the collision is real…
    expect(ownsKey(short, keyFor(ALICE, FILE))).toBe(false);  // …and refused anyway
  });

  test('path traversal is refused even inside my own prefix', () => {
    expect(ownsKey(ALICE, `${ALICE}/drive/../../${BOB}/drive/${FILE}`)).toBe(false);
    expect(ownsKey(ALICE, `${ALICE}/../${BOB}`)).toBe(false);
  });

  test('empty inputs are refused rather than matching everything', () => {
    expect(ownsKey('', keyFor(ALICE, FILE))).toBe(false);
    expect(ownsKey(ALICE, '')).toBe(false);
  });
});

describe('ownerOfKey', () => {
  test('reads the account off a key this app stored', () => {
    expect(ownerOfKey(keyFor(ALICE, FILE))).toBe(ALICE);
  });

  /**
   * The refusal that stops a crafted key from naming an account at all. If this returned anything
   * for a non-ObjectId, a caller could put a string of their choosing where a user id belongs.
   */
  test('refuses anything that is not a 24-hex ObjectId', () => {
    expect(ownerOfKey('me/drive/' + FILE)).toBeNull();
    expect(ownerOfKey('../drive/' + FILE)).toBeNull();
    expect(ownerOfKey('507F1F77BCF86CD799439011/drive/' + FILE)).toBeNull(); // uppercase hex
    expect(ownerOfKey(`${ALICE}x/drive/${FILE}`)).toBeNull();
  });

  test('refuses keys that are not the three-part drive shape', () => {
    expect(ownerOfKey(`${ALICE}/s3/${FILE}`)).toBeNull();       // legacy S3 key
    expect(ownerOfKey(`${ALICE}/drive/a/b`)).toBeNull();        // too many parts
    expect(ownerOfKey(ALICE)).toBeNull();
    expect(ownerOfKey(null)).toBeNull();
    expect(ownerOfKey(undefined)).toBeNull();
  });
});

describe('driveIdOfKey', () => {
  test('reads the file id back out', () => {
    expect(driveIdOfKey(keyFor(ALICE, FILE))).toBe(FILE);
  });

  test('refuses ids outside the URL-safe alphabet', () => {
    expect(driveIdOfKey(`${ALICE}/drive/has space`)).toBeNull();
    expect(driveIdOfKey(`${ALICE}/drive/..`)).toBeNull();
    expect(driveIdOfKey(`${ALICE}/drive/short`)).toBeNull();    // under the 6-char floor
  });
});

describe('isDriveKey', () => {
  test('true only when both halves are ours', () => {
    expect(isDriveKey(keyFor(ALICE, FILE))).toBe(true);
    expect(isDriveKey(`bad/drive/${FILE}`)).toBe(false);
    expect(isDriveKey(`${ALICE}/drive/!!`)).toBe(false);
    expect(isDriveKey('')).toBe(false);
  });
});
