/**
 * The Private Safe, expressed as a filter. Two rules, and every read path has to agree on both.
 *
 * 1. **Private is personal.** A record carrying a projectId belongs to its group — every member
 *    reads it — so it can never be private. A padlock on something your teammates can still open
 *    is worse than no padlock, because it gets believed. `privacyOnWrite` is what enforces it, at
 *    the point of writing, rather than trusting a checkbox the client sent.
 *
 * 2. **The safe SWAPS your personal vault; it does not add to it.** Locked shows what is not
 *    private, unlocked shows what is. That is exactly what Links and Categories have always done,
 *    and one rule across the whole app beats a second one that applies only to notes.
 *
 * Group records are untouched by either state: unlocking your own safe must never hide the work you
 * share with other people.
 *
 * Jarvis is the deliberate exception and is documented where it happens — an assistant that answers
 * "what are my tasks?" with only the secret ones is broken, so there the safe ADDS. Locked, it has
 * no knowledge of private content at all.
 *
 * Pure and import-free on purpose: scripts/self-check.mjs runs it under plain node, which cannot
 * resolve `@/`. This is the rule most worth having a test on after scope.ts.
 */

export type PrivacyFilter = { isPrivate: true } | { isPrivate: { $ne: true } };

/** The personal half of a read, given whether the safe is currently open. */
export function privateFilter(unlocked: boolean): PrivacyFilter {
  return unlocked ? { isPrivate: true } : { isPrivate: { $ne: true } };
}

/** Only a personal record may be private. Anything filed under a group is the group's. */
export function canBePrivate(projectId?: unknown): boolean {
  return !projectId;
}

/**
 * What actually gets stored. The client sends a checkbox; this decides. Filing a record into a
 * group therefore drops the flag rather than keeping a private marker that means nothing — the
 * caller is expected to tell the user that happened.
 */
export function privacyOnWrite(wanted: unknown, projectId?: unknown): boolean {
  return canBePrivate(projectId) && wanted === true;
}

/**
 * Jarvis's rule, which is the opposite of a list's: unlocked means it may see everything, locked
 * means private content does not exist. Returns the fragment to AND onto a personal query, or null
 * when nothing needs adding.
 */
export function assistantFilter(unlocked: boolean): { isPrivate: { $ne: true } } | null {
  return unlocked ? null : { isPrivate: { $ne: true } };
}
