'use client';
import { formatInZone } from '@/lib/time';
import { reminderTimes, countdownLabel, SLOTS, type ReminderChoice } from '@/lib/reminderRule';

// On-device task reminders via @capacitor/local-notifications.
// Notification IDs are derived from the task _id, so no notification state is
// stored server-side; re-scheduling with the same ID replaces (idempotent).
//
// WHICH instants get scheduled is not decided here — lib/reminderRule owns that, imports nothing,
// and is asserted by scripts/self-check.mjs. This file only turns its slots into notifications.
// Slots per task (base = last 6 hex chars of _id * 10, Java-int-safe):
//   +0  the chosen pre-deadline nudge    +2..+8  daily 9:00 nags while overdue    +9  the deadline
// ponytail: fixed 7-day nag horizon + tiny id-collision risk; reconcile() on
// each app open extends the horizon and repairs drift.

interface TaskLike {
  _id: string;
  title: string;
  dueAt?: string | null;
  createdAt?: string | null;   // the ORIGINAL one — the 85% point is measured from it, not from an edit
  completed?: boolean;
  reminder?: string | null;
}

async function plugin() {
  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform()) return null;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  return { ln: LocalNotifications }; // wrapped: awaiting the plugin proxy itself calls .then() natively
}

const baseId = (taskId: string) => parseInt(taskId.slice(-6), 16) * SLOTS;

function slotsFor(task: TaskLike, userDefault?: ReminderChoice | null): { id: number; at: Date; title: string; body: string }[] {
  const base = baseId(task._id);
  const due = task.dueAt ? new Date(task.dueAt) : null;
  const dueText = due ? formatInZone(due) : '';   // device zone: this runs on the phone
  return reminderTimes(task, userDefault).map(s => {
    const at = new Date(s.at);
    if (s.kind === 'pre') return { id: base + s.slot, at, title: `${countdownLabel(s.at, due!.getTime())}: ${task.title}`, body: `Due ${dueText}` };
    if (s.kind === 'due') return { id: base + s.slot, at, title: `Due now: ${task.title}`, body: dueText };
    return { id: base + s.slot, at, title: `Overdue: ${task.title}`, body: `Was due ${dueText}` };
  });
}

/**
 * What WOULD be scheduled, without a plugin and without a phone. The browser is not a native
 * platform, so nothing here ever schedules anything there — this is how the schedule is checked
 * on a desktop, and how it is read back off a device that is misbehaving.
 */
export const reminderPreview = (task: TaskLike, userDefault?: ReminderChoice | null) =>
  slotsFor(task, userDefault).map(s => ({ id: s.id, at: s.at.toISOString(), title: s.title }));

export async function syncTask(task: TaskLike, userDefault?: ReminderChoice | null) {
  const p = await plugin();
  if (!p) return;
  const { ln } = p;
  await cancelTask(task._id);
  const slots = slotsFor(task, userDefault);
  if (!slots.length) return;
  await ln.schedule({
    notifications: slots.map(s => ({
      id: s.id,
      title: s.title,
      body: s.body,
      schedule: { at: s.at, allowWhileIdle: true },
    })),
  });
}

export async function cancelTask(taskId: string) {
  const p = await plugin();
  if (!p) return;
  const { ln } = p;
  const base = baseId(taskId);
  await ln.cancel({ notifications: Array.from({ length: SLOTS }, (_, i) => ({ id: base + i })) });
}

// Called on tasks-page mount: schedule reminders for every open task I own or
// am assigned, and cancel pending notifications for tasks gone/completed on
// another device.
export async function reconcile(tasks: TaskLike[], userDefault?: ReminderChoice | null) {
  const p = await plugin();
  if (!p) return;
  const { ln } = p;

  const valid = new Set<number>();
  for (const task of tasks) {
    for (const s of slotsFor(task, userDefault)) valid.add(s.id);
    await syncTask(task, userDefault);
  }

  const { notifications } = await ln.getPending();
  const orphans = notifications
    .map(n => n.id)
    .filter(id => id >= SLOTS && !valid.has(id)); // ids < SLOTS reserved (e.g. weekly digest)
  if (orphans.length) {
    await ln.cancel({ notifications: orphans.map(id => ({ id })) });
  }
}

/**
 * Every pending notification on this device, cancelled — deliberately with NO filter.
 *
 * Notification ids are derived from the task _id alone and carry no user binding, bodies quote
 * task titles verbatim, and AlarmManager outlives both sign-out and app kill. So after an
 * identity change A's task titles would keep firing on the lock screen while B holds the phone.
 * Namespacing the ids is the wrong fix and was rejected: it prevents collisions, not disclosure.
 *
 * This also kills the reserved weekly-digest id 1, which is why lib/clientIdentityReset always
 * follows it with scheduleWeeklyDigest() — never call this one on its own.
 */
export async function cancelAllLocal() {
  const p = await plugin();
  if (!p) return;
  const { ln } = p;
  try {
    const { notifications } = await ln.getPending();
    if (notifications.length) await ln.cancel({ notifications: notifications.map(n => ({ id: n.id })) });
  } catch { /* non-fatal: a phone that refuses to list is not a reason to block the switch */ }
}

/**
 * A week between asks for exact alarms.
 *
 * The previous version asked exactly once, ever, and wrote the "asked" flag BEFORE opening the
 * settings screen — so backing out of that screen, or never finding the toggle, permanently
 * downgraded every reminder to inexact with no second chance and nothing on screen to say so.
 * On Android 14+ that is the default outcome, because exact alarms are not granted automatically
 * to an app that is not a clock. Reminders are the reason people install this, so "silently late,
 * forever, after one mis-tap" is the wrong failure.
 *
 * Asking again is the fix; asking on every open would be nagging. A week is long enough not to be
 * a nuisance and short enough that a person who meant to do it gets another chance.
 */
const EXACT_ALARM_ASKED_AT = 'exactAlarmAskedAt';
const EXACT_ALARM_ASK_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

/** Private-mode browsers and locked-down webviews throw on access rather than returning null. */
function readStamp(key: string): number {
  try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; }
}
function writeStamp(key: string, value: number) {
  try { localStorage.setItem(key, String(value)); } catch { /* storage disabled; ask again next open */ }
}

// Permission bootstrap (Android 13+ POST_NOTIFICATIONS + exact alarms)
export async function ensurePermissions() {
  const p = await plugin();
  if (!p) return;
  const { ln } = p;
  const perm = await ln.requestPermissions().catch(() => ({ display: 'denied' as const }));
  if (perm.display !== 'granted') return;
  scheduleWeeklyDigest(); // now that permission exists
  try {
    const { exact_alarm } = await ln.checkExactNotificationSetting();
    // Granted is the end of it — the check is the source of truth, so nothing needs remembering
    // once it passes, and a person who grants it later is never asked again.
    if (exact_alarm === 'granted') return;

    const asked = readStamp(EXACT_ALARM_ASKED_AT);
    if (asked && Date.now() - asked < EXACT_ALARM_ASK_EVERY_MS) return;

    writeStamp(EXACT_ALARM_ASKED_AT, Date.now());
    // Opens system settings; without it alarms fire inexactly (minutes late)
    await ln.changeExactNotificationSetting();
  } catch {
    // Older Android — exact alarms need no special access
  }
}

// Weekly digest: Sunday 18:00 local notification (reserved id 1, below task id space).
// Static text — tapping it opens /digest, which renders live data.
export async function scheduleWeeklyDigest() {
  const p = await plugin();
  if (!p) return;
  const { ln } = p;
  try {
    // Don't schedule before the user has granted notifications (first app open)
    const perm = await ln.checkPermissions();
    if (perm.display !== 'granted') return;
    await ln.schedule({
    notifications: [{
      id: 1,
      title: 'Your weekly digest is ready',
      body: 'What you saved this week + tasks due next week.',
      schedule: { on: { weekday: 1, hour: 18, minute: 0 }, allowWhileIdle: true }, // weekday 1 = Sunday
      extra: { route: '/digest' },
      }],
    });
  } catch { /* non-fatal */ }
}

// Route notification taps (digest → /digest; task reminders → /tasks)
export async function registerNotificationTapHandler(navigate: (route: string) => void) {
  const p = await plugin();
  if (!p) return;
  const { ln } = p;
  try {
    await ln.addListener('localNotificationActionPerformed', (action) => {
      navigate(action.notification.extra?.route || '/tasks');
    });
  } catch { /* non-fatal */ }
}
