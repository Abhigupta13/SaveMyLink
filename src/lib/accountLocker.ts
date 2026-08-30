/**
 * Several accounts signed in at once, held as cookies in this browser's jar.
 *
 * ══ THE INVARIANT EVERYTHING ELSE RESTS ON ══════════════════════════════════════════════════
 * THE APP NEVER CALLS `encode` FROM `next-auth/jwt`. It only moves opaque token bytes between
 * cookies and calls `decode` to look inside them. A path that mints a session token for an
 * arbitrary user id is unconditional account takeover the moment it is reachable with
 * attacker-controlled input — which rules out the tempting "re-mint the parked token with a
 * trimmed payload" refactor. `grep -rn "from 'next-auth/jwt'" src` must only ever show
 * `decode` and `getToken`.
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Parking works because in next-auth@4 `encode`/`decode` derive their key from NEXTAUTH_SECRET
 * with a default empty salt and NO cookie-name binding, so a token minted into the session
 * cookie decrypts identically out of any other cookie. Proven once against the installed
 * version rather than read off the source.
 *
 * Pure on purpose: this file imports NOTHING, so scripts/self-check.mjs can hold the cookie
 * names and the packing to account under node's strip-only type removal, which can resolve
 * neither the `@/` alias nor `next/server`.
 */

/** 1 active + 4 parked. The cap exists because one stolen cookie jar is now several accounts. */
export const MAX_ACCOUNTS = 5;

/** Slots are a fixed enumerated list, never a scan of the jar — an orphan cookie can then never
 *  become a row in the switcher, and add/remove never renames anything. */
export const PARKED_SLOTS = [0, 1, 2, 3] as const;

/** Per-cookie 4096 is never at risk (a v4 JWE runs ~350-600 bytes); the total Cookie header is
 *  the real limit, so the budget is checked across the whole locker before adding an account. */
export const MAX_LOCKER_BYTES = 3500;

/**
 * NextAuth reassembles chunked session cookies with `if (name.startsWith(cookieName))` — a
 * prefix match, not a chunk index. A slot named `next-auth.session-token-parked-0` would be
 * slurped into the active session value and corrupt it on every single request. The parked
 * namespace therefore shares no prefix with NextAuth's, and self-check asserts it.
 */
const PARKED_PREFIX = 'ayn.acct.';
const SECURE = '__Secure-';

/**
 * Browsers reject a `__Secure-` cookie sent over http, so keying this on NODE_ENV would make
 * every write silently fail in development. NextAuth itself decides by URL scheme; match it.
 */
export function secureCookies(nextAuthUrl?: string | null): boolean {
  return typeof nextAuthUrl === 'string' && nextAuthUrl.startsWith('https://');
}

export function parkedCookieName(slot: number, secure: boolean): string {
  return `${secure ? SECURE : ''}${PARKED_PREFIX}${slot}`;
}

/** NextAuth's own cookie. Named here so the switch has exactly one place that knows it. */
export function activeCookieName(secure: boolean): string {
  return `${secure ? SECURE : ''}next-auth.session-token`;
}

// btoa/atob/TextEncoder are the only base64 primitives available to a file that imports nothing
// and may end up in a client bundle; Buffer is neither.
const b64url = (s: string): string => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const unb64url = (s: string): string => {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
};

/**
 * `base64url(email) . <jwe>`. The ~40 bytes buy the thing that matters: a parked token is frozen
 * (NextAuth's rolling refresh only touches the active cookie), so a slot parked 31 days is dead
 * and `decode` will throw on it — but the row can still be labelled "abhishek@… — signed out,
 * tap to sign in again" instead of showing an anonymous dead account.
 */
export function packSlot(email: string, token: string): string {
  return `${b64url(email || '')}.${token}`;
}

/** Split on the FIRST dot only: base64url has none, a JWE has four of its own. */
export function unpackSlot(value?: string | null): { email: string; token: string } | null {
  if (!value) return null;
  const dot = value.indexOf('.');
  if (dot < 0) return null;
  const token = value.slice(dot + 1);
  if (!token) return null;
  return { email: unb64url(value.slice(0, dot)), token };
}

/** The lowest slot nobody is holding, or null when the locker is full. */
export function freeSlot(occupied: readonly number[]): number | null {
  for (const slot of PARKED_SLOTS) if (!occupied.includes(slot)) return slot;
  return null;
}

/** Whether one more parked value of this size still fits inside the Cookie header budget. */
export function withinLockerBudget(existing: readonly string[], incoming: string): boolean {
  const total = existing.reduce((n, v) => n + (v?.length || 0), 0) + incoming.length;
  return total <= MAX_LOCKER_BYTES;
}

export interface LockerRow {
  /** The Mongo _id out of the decoded token, or '' when the slot could not be decoded. */
  id: string;
  active?: boolean;
}

/**
 * Signing in as an account that is already parked is the case that silently corrupts the locker,
 * and it is only detectable on the NEXT request — so this runs at every locker touch.
 *
 * Matched on the decoded id, never the email: `allowDangerousEmailAccountLinking` plus the `jwt`
 * callback's Mongo-id swap mean Google and password sign-in for one address share an `_id`, and
 * the id is the only thing that stays true across both.
 *
 * A row with no id (an expired slot that would not decode) is kept — it names an account we can
 * still label from the packed email, and it can be a duplicate of nothing.
 */
export function dedupeById<T extends LockerRow>(rows: readonly T[]): T[] {
  const winner = new Map<string, T>();
  for (const row of rows) {
    const id = row?.id;
    if (!id) continue;
    const held = winner.get(id);
    // The active token is the newer one, whichever order the rows arrived in.
    if (!held || (!held.active && row.active)) winner.set(id, row);
  }
  return rows.filter(row => !row?.id || winner.get(row.id) === row);
}
