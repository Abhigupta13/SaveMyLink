// Shared auth validation — same rules run on the client (instant feedback) and server (trust boundary)
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export const PASSWORD_RULES = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One number', test: (p: string) => /\d/.test(p) },
  { label: 'One special character', test: (p: string) => /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(p) },
];

export const validateName = (v: string) =>
  !v.trim() ? 'Please enter your name' : v.trim().length < 2 ? 'Name is too short' : '';

export const validateEmail = (v: string) =>
  !v.trim() ? 'Please enter your email' : !EMAIL_RE.test(v.trim()) ? 'That doesn’t look like a valid email' : '';

export const validatePassword = (v: string) => {
  if (!v) return 'Please enter a password';
  const failed = PASSWORD_RULES.filter(r => !r.test(v));
  return failed.length ? `Password needs: ${failed.map(f => f.label.toLowerCase()).join(', ')}` : '';
};

const lower = (v: unknown) => String(v ?? '').trim().toLowerCase();

/**
 * The assignee list a write may actually store, out of whatever the client sent. It lives here
 * rather than in taskAccess.ts because it is validation and because this file imports nothing —
 * scripts/self-check.mjs runs it with bare node, which resolves no tsconfig path aliases.
 *
 * Three rules, because this arrives from a browser and lands in the named person's My Tasks,
 * search, weekly digest, phone reminders and — through Jarvis — an LLM prompt that holds write
 * primitives. Handing that reach to an arbitrary address is not an assignment, it is a delivery
 * mechanism for whatever the caller typed into the title.
 *  - It has to look like an address. The same EMAIL_RE signup is held to.
 *  - It has to belong to somebody actually in the group — owner, co-owner, member or viewer, the
 *    exact set the assignee picker offers. Anyone else is dropped in silence, like a chip nobody
 *    ticked; refusing the whole write would turn one stale address into a save that never lands.
 *  - Capped, because an unbounded list is an unbounded $in and an unbounded document, sized by
 *    whoever is calling the action.
 *
 * The primary leads, so `assigneeEmail === assigneeEmails[0]` still holds for every reader.
 */
export const MAX_ASSIGNEES = 20;
export function allowedAssignees(
  primary: string | null | undefined,
  list: (string | null | undefined)[] | null | undefined,
  people: (string | null | undefined)[],
): string[] {
  const roster = new Set(people.map(lower).filter(Boolean));
  return [...new Set([primary, ...(list || [])].map(lower))]
    .filter(e => EMAIL_RE.test(e) && roster.has(e))
    .slice(0, MAX_ASSIGNEES);
}
