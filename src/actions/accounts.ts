'use server';

import { cookies } from 'next/headers';
import { decode } from 'next-auth/jwt';
import { getServerSession } from 'next-auth';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/lib/auth';
import connectToDatabase from '@/lib/mongodb';
import { User } from '@/lib/models/User';
import {
  MAX_ACCOUNTS, PARKED_SLOTS, activeCookieName, parkedCookieName, packSlot, unpackSlot,
  freeSlot, dedupeById, withinLockerBudget, secureCookies,
} from '@/lib/accountLocker';

/**
 * The ONLY module that touches locker cookies. See lib/accountLocker.ts for the invariant this
 * whole feature rests on: nothing here ever calls `encode` — it moves opaque bytes and calls
 * `decode` to inspect them.
 */

type SlotState = 'live' | 'expired' | 'deleted';

export interface AccountRow {
  slot: number | null;      // null = the account currently signed in
  id: string;               // '' when the slot would not decode
  email: string;
  name: string;
  active: boolean;
  state: SlotState;
  emailVerified: boolean;
}

const isSecure = () => secureCookies(process.env.NEXTAUTH_URL);

// Attributes identical to NextAuth's own, so the cookie we write back is the cookie it wrote.
const attrs = () => ({ httpOnly: true, sameSite: 'lax' as const, path: '/', secure: isSecure() });

/**
 * NextAuth splits a session cookie over `name.0`, `name.1`… when it outgrows 4096 bytes. A v4 JWE
 * is 350-600 bytes so this never fires here, but reading only the unchunked name would fail
 * silently and totally if it ever did — and a silent failure in the switch is the one outcome
 * worth spending four lines to avoid.
 */
async function readActive(): Promise<string> {
  const jar = await cookies();
  const name = activeCookieName(isSecure());
  const whole = jar.get(name)?.value;
  if (whole) return whole;
  let out = '';
  for (let i = 0; ; i++) {
    const chunk = jar.get(`${name}.${i}`)?.value;
    if (!chunk) break;
    out += chunk;
  }
  return out;
}

async function writeActive(token: string, expires?: Date) {
  const jar = await cookies();
  const name = activeCookieName(isSecure());
  // A stale chunk left beside a whole value is exactly the corruption the `ayn.` namespace
  // exists to avoid; clear the siblings whenever we write the unchunked name.
  for (let i = 0; i < 4; i++) jar.delete(`${name}.${i}`);
  jar.set(name, token, { ...attrs(), ...(expires ? { expires } : {}) });
}

async function clearActive() {
  const jar = await cookies();
  const name = activeCookieName(isSecure());
  jar.delete(name);
  for (let i = 0; i < 4; i++) jar.delete(`${name}.${i}`);
}

/**
 * Every identity change re-locks the safe. Not an exposure — link.ts and category.ts re-check
 * hasSafe(userId) and downgrade — but a Profile toggle reading "Unlocked" over a public list is
 * a lie about the one control users trust most.
 *
 * `theme` and `columns` are deliberately left alone: they are device display preferences, not
 * facts about a person, and re-theming the app on every switch is a bug, not tidiness.
 */
async function clearSafe() {
  const jar = await cookies();
  jar.delete('safeAuth');
  jar.delete('privateSafe');
}

/** `decode` throws on expiry AND on tamper, so every call site needs this. */
async function peek(token: string) {
  try {
    const t = await decode({ token, secret: process.env.NEXTAUTH_SECRET! });
    return t?.id ? t : null;
  } catch {
    return null;
  }
}

async function occupiedSlots() {
  const jar = await cookies();
  const secure = isSecure();
  return PARKED_SLOTS.filter(s => !!jar.get(parkedCookieName(s, secure))?.value);
}

/**
 * listAccounts MUTATES COOKIES — it drops slots whose account was deleted and slots holding a
 * duplicate of the active token. `cookies().delete()` throws during a server render, so this may
 * only ever be called from a client event handler (an effect or a tap), never from a page body.
 */
export async function listAccounts(): Promise<{ rows: AccountRow[]; full: boolean }> {
  const jar = await cookies();
  const secure = isSecure();

  const rows: AccountRow[] = [];

  const activeToken = await readActive();
  const activeDecoded = activeToken ? await peek(activeToken) : null;
  if (activeDecoded) {
    rows.push({
      slot: null, id: String(activeDecoded.id), active: true, state: 'live',
      email: String(activeDecoded.email || ''), name: String(activeDecoded.name || ''),
      emailVerified: true,
    });
  }

  for (const slot of PARKED_SLOTS) {
    const raw = jar.get(parkedCookieName(slot, secure))?.value;
    if (!raw) continue;
    const packed = unpackSlot(raw);
    if (!packed) { jar.delete(parkedCookieName(slot, secure)); continue; }
    const decoded = await peek(packed.token);
    rows.push(decoded
      ? {
        slot, id: String(decoded.id), active: false, state: 'live',
        email: String(decoded.email || packed.email), name: String(decoded.name || ''),
        emailVerified: true,
      }
      // Parked tokens are frozen — NextAuth's 24h rolling refresh only touches the active
      // cookie — so a slot parked past maxAge is simply dead. The packed email is what lets
      // the row still say WHO signed out.
      : { slot, id: '', active: false, state: 'expired', email: packed.email, name: '', emailVerified: true });
  }

  // One indexed query for every account in the jar: is it deleted, and is its address confirmed.
  const ids = rows.filter(r => r.id).map(r => r.id);
  if (ids.length) {
    try {
      await connectToDatabase();
      const users = await User.find({ _id: { $in: ids } })
        .select('deletedAt emailVerified name email')
        .lean<{ _id: unknown; deletedAt?: Date | null; emailVerified?: Date | null; name?: string; email?: string }[]>();
      const byId = new Map(users.map(u => [String(u._id), u]));
      for (const row of rows) {
        const u = row.id ? byId.get(row.id) : undefined;
        if (!u) continue;
        if (u.deletedAt) row.state = 'deleted';
        row.emailVerified = !!u.emailVerified;
        // The DB is the truth for the label; a token minted before a rename says the old name.
        if (u.name) row.name = u.name;
        if (u.email) row.email = u.email;
      }
    } catch {
      // A database that is down must not make the switcher unusable — the rows still name the
      // right accounts, and switchAccount re-checks deletedAt server-side before activating.
    }
  }

  const keep = dedupeById(rows).filter(r => r.state !== 'deleted');
  for (const row of rows) {
    if (row.slot === null || keep.includes(row)) continue;
    jar.delete(parkedCookieName(row.slot, secure));
  }

  return { rows: keep, full: keep.length >= MAX_ACCOUNTS };
}

/**
 * Read a parked slot's label with NO session. Safe, and worth saying so plainly: it can only ever
 * describe a token already sitting in THIS browser's cookie jar, so it tells a caller nothing
 * they could not read by other means. It exists because the sign-in page has no session by
 * definition and must still be able to name who stays signed in.
 */
export async function parkedSummary(slot: number): Promise<{ email: string; name: string; live: boolean } | null> {
  if (!PARKED_SLOTS.includes(slot as typeof PARKED_SLOTS[number])) return null;
  const jar = await cookies();
  const packed = unpackSlot(jar.get(parkedCookieName(slot, isSecure()))?.value);
  if (!packed) return null;
  const decoded = await peek(packed.token);
  return {
    email: String(decoded?.email || packed.email),
    name: String(decoded?.name || ''),
    live: !!decoded,
  };
}

/**
 * Swap identities. A failed switch must leave you exactly where you were, so nothing touches the
 * active cookie until the incoming token has decoded and its account has been re-checked.
 */
export async function switchAccount(slot: number): Promise<
  { success: true; email: string } | { success: false; error: 'expired' | 'deleted' | 'missing'; email: string }
> {
  const jar = await cookies();
  const secure = isSecure();
  if (!PARKED_SLOTS.includes(slot as typeof PARKED_SLOTS[number])) return { success: false, error: 'missing', email: '' };

  const packed = unpackSlot(jar.get(parkedCookieName(slot, secure))?.value);
  if (!packed) return { success: false, error: 'missing', email: '' };

  const incoming = await peek(packed.token);
  if (!incoming) {
    jar.delete(parkedCookieName(slot, secure));
    return { success: false, error: 'expired', email: packed.email };
  }

  // There is a TOCTOU window between listing the locker and tapping a row, and a stateless JWT
  // knows nothing about a deletion that happened inside it.
  try {
    await connectToDatabase();
    const u = await User.findById(String(incoming.id)).select('deletedAt').lean<{ deletedAt?: Date | null } | null>();
    if (u?.deletedAt) {
      jar.delete(parkedCookieName(slot, secure));
      return { success: false, error: 'deleted', email: String(incoming.email || packed.email) };
    }
  } catch {
    // A database blip must not strand someone on the account they are trying to leave; the
    // session callback checks deletedAt on every read anyway, so a deleted account lands
    // signed out rather than signed in.
  }

  const outgoing = await readActive();
  const outgoingDecoded = outgoing ? await peek(outgoing) : null;

  // Park the outgoing token into the slot the incoming one just vacated. A token that would not
  // decode is dropped rather than parked — parking a dead token only produces a dead row.
  if (outgoingDecoded) {
    jar.set(parkedCookieName(slot, secure),
      packSlot(String(outgoingDecoded.email || ''), outgoing), attrs());
  } else {
    jar.delete(parkedCookieName(slot, secure));
  }

  // `expires` from the token's own exp, never a flat 30 days: a live cookie wrapping a dead JWT
  // is an app that is signed in and signed out at the same time.
  await writeActive(packed.token, incoming.exp ? new Date(Number(incoming.exp) * 1000) : undefined);
  await clearSafe();

  revalidatePath('/', 'layout');
  return { success: true, email: String(incoming.email || packed.email) };
}

/**
 * Park the current account and hand the browser back to a signed-out state so NextAuth can sign
 * somebody new in. Deleting the active cookie is required, not tidiness: NextAuth overwrites it
 * on sign-in anyway, and keeping it would leave two copies of one token — which becomes a
 * duplicate row the moment the same person signs in again.
 */
export async function beginAddAccount(): Promise<
  { success: true; slot: number; email: string } | { success: false; error: string }
> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { success: false, error: 'Sign in first' };

  const jar = await cookies();
  const secure = isSecure();
  const occupied = await occupiedSlots();
  const slot = freeSlot(occupied);
  if (slot === null) return { success: false, error: `You can keep ${MAX_ACCOUNTS} accounts on this device` };

  const active = await readActive();
  if (!active) return { success: false, error: 'Sign in first' };
  const value = packSlot(String(session.user.email || ''), active);

  // Per-cookie 4096 is never the limit; the summed Cookie header on every request is.
  const existing = occupied.map(s => jar.get(parkedCookieName(s, secure))?.value || '');
  if (!withinLockerBudget(existing, value)) {
    return { success: false, error: `You can keep ${MAX_ACCOUNTS} accounts on this device` };
  }

  jar.set(parkedCookieName(slot, secure), value, attrs());
  await clearActive();
  await clearSafe();

  revalidatePath('/', 'layout');
  return { success: true, slot, email: String(session.user.email || '') };
}

/**
 * Recover from an abandoned "add account": the user is signed out with their real account still
 * parked, and this puts it back. It deliberately runs with NO session — it has to, there isn't
 * one — and that is safe because it can only re-activate a token already sitting in this
 * browser's own cookie jar. Nothing here is derived from anything the caller supplies except a
 * slot index, which is checked against the fixed list.
 */
export async function cancelAddAccount(slot: number): Promise<{ success: boolean; email: string }> {
  const jar = await cookies();
  const secure = isSecure();
  if (!PARKED_SLOTS.includes(slot as typeof PARKED_SLOTS[number])) return { success: false, email: '' };

  const packed = unpackSlot(jar.get(parkedCookieName(slot, secure))?.value);
  if (!packed) return { success: false, email: '' };
  const decoded = await peek(packed.token);
  if (!decoded) {
    jar.delete(parkedCookieName(slot, secure));
    return { success: false, email: packed.email };
  }

  await writeActive(packed.token, decoded.exp ? new Date(Number(decoded.exp) * 1000) : undefined);
  jar.delete(parkedCookieName(slot, secure));
  await clearSafe();

  revalidatePath('/', 'layout');
  return { success: true, email: String(decoded.email || packed.email) };
}

/**
 * "Remove from this device", never "Sign out". Under the JWT strategy there is no server-side
 * session to revoke, so the discarded token stays valid until its own `exp` if it were ever
 * captured elsewhere. That is already true of today's sign-out, but the switcher is exactly
 * where a user would reasonably expect otherwise — so the wording has to be accurate.
 */
export async function removeAccount(slot: number): Promise<{ success: boolean }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { success: false };
  if (!PARKED_SLOTS.includes(slot as typeof PARKED_SLOTS[number])) return { success: false };
  (await cookies()).delete(parkedCookieName(slot, isSecure()));
  revalidatePath('/', 'layout');
  return { success: true };
}

/**
 * Leave this account and fall back to the next parked one. Returns the address landed in so the
 * caller can say so out loud — landing silently inside somebody else's account is the worst
 * possible outcome of this feature.
 */
export async function signOutActive(): Promise<{ email: string | null }> {
  const jar = await cookies();
  const secure = isSecure();
  await clearActive();
  await clearSafe();

  for (const slot of PARKED_SLOTS) {
    const packed = unpackSlot(jar.get(parkedCookieName(slot, secure))?.value);
    if (!packed) continue;
    const decoded = await peek(packed.token);
    // A dead slot is dropped and the search continues, rather than landing the user on a
    // "signed out" account they did not choose.
    jar.delete(parkedCookieName(slot, secure));
    if (!decoded) continue;
    await writeActive(packed.token, decoded.exp ? new Date(Number(decoded.exp) * 1000) : undefined);
    revalidatePath('/', 'layout');
    return { email: String(decoded.email || packed.email) };
  }

  revalidatePath('/', 'layout');
  return { email: null };
}

/** The shared-phone escape hatch: nothing of anybody is left in the jar. */
export async function signOutAll(): Promise<{ success: true }> {
  const jar = await cookies();
  const secure = isSecure();
  await clearActive();
  await clearSafe();
  for (const slot of PARKED_SLOTS) jar.delete(parkedCookieName(slot, secure));
  revalidatePath('/', 'layout');
  return { success: true };
}
