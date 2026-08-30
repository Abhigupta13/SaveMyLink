'use client';

import { cancelAllLocal, scheduleWeeklyDigest } from '@/lib/taskNotifications';

/**
 * The one function every identity change calls — switch, add, sign out, sign out of all — so
 * the four paths cannot drift apart. Each of them used to be one forgotten line away from
 * leaving the previous account's reminders on the phone.
 */

/**
 * Per-USER client state. Everything left out of this is a device fact, not a user fact:
 *  - `exactAlarmPrompted` — clearing it re-opens Android's exact-alarm settings dialog on every
 *    single switch, which is the most annoying possible way to fix nothing.
 *  - `jarvisMuted`, `homeView` — how this phone is set up, not who is holding it.
 * `theme` and `columns` are cookies and are left alone server-side for the same reason.
 */
export function clearPerUserClientState() {
  // Tour.tsx resumes from this BEFORE tourStatus() resolves, so a step left by the previous
  // account would replay itself at the new one and then mark the tour done on the wrong user.
  try { localStorage.removeItem('tourStep'); } catch { /* private mode */ }
  // Takes verifyBannerDismissed with it, so an unverified new account is told why its app is
  // empty rather than being left to guess.
  try { sessionStorage.clear(); } catch { /* private mode */ }
}

/**
 * Tear the old identity off this device, then hand the browser a FULL DOCUMENT LOAD.
 *
 * ══ NEVER router.push / router.refresh HERE ═════════════════════════════════════════════════
 * A client navigation keeps the React tree alive. SessionProvider's `__NEXTAUTH` singleton,
 * UserContext and every page's useState survive the identity change; pages gate their fetch on
 * `status` (tasks/page.tsx says so out loud) and `status` never leaves 'authenticated', so they
 * never refetch — account B silently reads account A's data. The Router Cache is keyed by URL,
 * not by user, and every bottom-nav destination is already prefetched as the old account's RSC
 * payload. `location.assign` discards the router cache, the React tree and `__NEXTAUTH` at once.
 *
 * Land on '/', not the current path — which may be a project the new account cannot open.
 * ════════════════════════════════════════════════════════════════════════════════════════════
 */
export async function finishIdentityChange(to: string = '/') {
  // While the page is still alive: once the document is gone, so is the plugin bridge.
  await cancelAllLocal().catch(() => {});
  // cancelAllLocal took the reserved weekly-digest id 1 with it. Idempotent, so it is safe to
  // pair unconditionally, and pairing it here is what stops a call site forgetting.
  await scheduleWeeklyDigest().catch(() => {});
  clearPerUserClientState();
  window.location.assign(to);
}
