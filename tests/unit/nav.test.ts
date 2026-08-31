import { describe, test, expect } from 'vitest';
import { ownsItsFrame, NAV, MOBILE_NAV, hintFor } from '@/lib/nav';

/**
 * Which screens the app chrome must keep off.
 *
 * This module is the clearest demonstration of what the new runner buys. `src/lib/nav.ts` imports
 * icons from `lucide-react`, so bare Node cannot load it and `scripts/self-check.mjs` has never
 * been able to touch it — `ownsItsFrame` shipped with no coverage at all. Vitest resolves the
 * import, so the rule can finally be asserted.
 *
 * The rule matters more than it looks. A suspended account keeps a session OBJECT with `user`
 * stripped, so `status` still reads 'authenticated' and every "signed out?" test in the chrome
 * misses it. /suspended is meant to be a dead end; without this check it renders wrapped in a
 * bottom bar offering seven destinations that all now refuse, and the Tour — which resumes from
 * localStorage and NAVIGATES — walks the person into them.
 */
describe('ownsItsFrame', () => {
  test('the screens that carry their own brand', () => {
    expect(ownsItsFrame('/auth/signin')).toBe(true);
    expect(ownsItsFrame('/auth/signup')).toBe(true);
    expect(ownsItsFrame('/auth/forgot-password')).toBe(true);
    expect(ownsItsFrame('/suspended')).toBe(true);
  });

  test('ordinary app screens get the chrome', () => {
    for (const path of ['/', '/links', '/notes', '/tasks', '/projects', '/mom', '/profile', '/admin']) {
      expect(ownsItsFrame(path)).toBe(false);
    }
  });

  /**
   * Prefix matching is deliberate — /auth/* and /suspended/* are whole areas, not single routes —
   * but it must not spill onto a sibling that merely starts with the same letters.
   */
  test('does not spill onto lookalike routes', () => {
    expect(ownsItsFrame('/authors')).toBe(false);
    expect(ownsItsFrame('/suspended-accounts')).toBe(false);
    expect(ownsItsFrame('/admin/auth')).toBe(false);
  });
});

/**
 * NAV is the single source of truth for the rail, the phone bar and the Home grid. These are cheap
 * structural guards: the kind of thing that breaks silently when someone edits one list and not
 * the others.
 */
describe('NAV', () => {
  test('every destination is a rooted path and unique', () => {
    const hrefs = NAV.map(n => n.href);
    expect(hrefs.every(h => h.startsWith('/'))).toBe(true);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  test('every entry carries the copy the empty states read', () => {
    for (const n of NAV) {
      expect(n.title.length).toBeGreaterThan(0);
      expect(n.desc.length).toBeGreaterThan(0);
      expect(n.hint.length).toBeGreaterThan(0);
      expect(hintFor(n.href)).toBe(n.hint);
    }
  });

  /**
   * MOBILE_NAV is a list of hrefs typed loosely enough to drift out of NAV. If one does, the phone
   * bottom bar silently loses that tab — it filters NAV by membership, so a typo renders nothing
   * rather than erroring.
   */
  test('every phone tab is a real NAV destination', () => {
    const hrefs = new Set<string>(NAV.map(n => n.href));
    for (const href of MOBILE_NAV) expect(hrefs.has(href)).toBe(true);
  });

  test('no NAV destination is a screen that refuses the chrome', () => {
    for (const n of NAV) expect(ownsItsFrame(n.href)).toBe(false);
  });
});
