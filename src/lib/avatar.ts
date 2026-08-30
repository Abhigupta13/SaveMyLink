/**
 * The one letter in the circle. Extracted because TopNav, Profile and the account switcher all
 * drew it, and a switcher whose initials disagree with the avatar in the nav is a switcher the
 * user cannot trust about which account they are looking at.
 *
 * Imports nothing, so scripts/self-check.mjs can hold it to account.
 */
export function initialFor(name?: string | null, email?: string | null): string {
  // Whitespace is not a name: `'  '[0]` is a space, which draws an empty circle rather than
  // falling through to the address — the one input the old inline `||` chain got wrong.
  const from = (name || '').trim() || (email || '').trim();
  return (from || 'U')[0].toUpperCase();
}
