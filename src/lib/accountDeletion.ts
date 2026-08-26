/**
 * Pure, mongoose-free helpers for account deletion. No imports on purpose: scripts/self-check.mjs
 * runs these under plain node, which cannot resolve `@/` or an extensionless sibling. The two
 * decisions worth asserting without a database live here — who inherits a group, and when a
 * retained record is finally due to go.
 */

/** Disclosed retention window: a deleted account's name/email/role survive this long, then purge. */
export const RETENTION_DAYS = 90;

export interface HandoverCandidate {
  email: string;
  createdAt: Date | string | number;   // anything Date-comparable; the OLDEST account wins
}

export type Handover =
  | { action: 'transfer'; email: string }   // to the oldest co-owner
  | { action: 'promote'; email: string }     // else the oldest plain member
  | { action: 'delete' };                    // else nobody is left — the group goes

/**
 * Who inherits a group whose CREATOR is deleting their account.
 *
 * Oldest co-owner first, then the oldest plain member, else the group is deleted. "Oldest" is by
 * account age, and only REGISTERED users are candidates: the winner becomes the project's
 * `ownerId`, which must be a real user id. An address invited but never signed up is a claim, not
 * a person who can hold a group — a group with no other registered account is therefore deleted.
 *
 * The leaver is expected to be excluded from both lists by the caller.
 */
export function chooseHandover(coOwners: HandoverCandidate[], members: HandoverCandidate[]): Handover {
  const oldest = (list: HandoverCandidate[]) =>
    (list || [])
      .filter(u => u && u.email)
      .slice()
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];

  const owner = oldest(coOwners);
  if (owner) return { action: 'transfer', email: owner.email };
  const member = oldest(members);
  if (member) return { action: 'promote', email: member.email };
  return { action: 'delete' };
}

/**
 * Is a retained record past its 90 days? The purge sweep asks this per row. `now` is injectable so
 * the test does not depend on the wall clock.
 */
export function isPurgeDue(deletedAt: Date | string | number | null | undefined, now: number = Date.now()): boolean {
  if (!deletedAt) return false;
  const t = new Date(deletedAt).getTime();
  if (Number.isNaN(t)) return false;
  return now - t >= RETENTION_DAYS * 24 * 60 * 60 * 1000;
}
