'use client';

// On-device task reminders via @capacitor/local-notifications.
// Notification IDs are derived from the task _id, so no notification state is
// stored server-side; re-scheduling with the same ID replaces (idempotent).
//
// Slots per task (base = last 6 hex chars of _id * 10, Java-int-safe):
//   +0  due − 24h    +1  due − 1h    +2..+8  daily 9:00 nags while overdue
// ponytail: fixed 7-day nag horizon + tiny id-collision risk; reconcile() on
// each app open extends the horizon and repairs drift.

const SLOTS = 10;
const NAG_DAYS = 7;

interface TaskLike {
  _id: string;
  title: string;
  dueAt?: string | null;
  completed?: boolean;
}

async function plugin() {
  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform()) return null;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  return { ln: LocalNotifications }; // wrapped: awaiting the plugin proxy itself calls .then() natively
}

const baseId = (taskId: string) => parseInt(taskId.slice(-6), 16) * SLOTS;

function slotsFor(task: TaskLike): { id: number; at: Date; title: string; body: string }[] {
  if (!task.dueAt || task.completed) return [];
  const due = new Date(task.dueAt);
  const now = Date.now();
  const base = baseId(task._id);
  const dueText = due.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const out: { id: number; at: Date; title: string; body: string }[] = [];

  const pre: [number, number, string][] = [
    [0, 24 * 3600e3, 'Due tomorrow'],
    [1, 3600e3, 'Due in 1 hour'],
  ];
  for (const [slot, ms, label] of pre) {
    const at = new Date(due.getTime() - ms);
    if (at.getTime() > now) out.push({ id: base + slot, at, title: `${label}: ${task.title}`, body: `Due ${dueText}` });
  }

  // At the deadline itself — without this, a task due soon never notifies until the next 9am nag
  if (due.getTime() > now) {
    out.push({ id: base + 9, at: due, title: `Due now: ${task.title}`, body: dueText });
  }

  // Daily 9:00 nags after the deadline passes
  const nag = new Date(due);
  nag.setHours(9, 0, 0, 0);
  if (nag <= due) nag.setDate(nag.getDate() + 1);
  for (let i = 0; i < NAG_DAYS; i++) {
    const at = new Date(nag);
    at.setDate(at.getDate() + i);
    if (at.getTime() > now) out.push({ id: base + 2 + i, at, title: `Overdue: ${task.title}`, body: `Was due ${dueText}` });
  }
  return out;
}

export async function syncTask(task: TaskLike) {
  const p = await plugin();
  if (!p) return;
  const { ln } = p;
  await cancelTask(task._id);
  const slots = slotsFor(task);
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
export async function reconcile(tasks: TaskLike[]) {
  const p = await plugin();
  if (!p) return;
  const { ln } = p;

  const valid = new Set<number>();
  for (const task of tasks) {
    for (const s of slotsFor(task)) valid.add(s.id);
    await syncTask(task);
  }

  const { notifications } = await ln.getPending();
  const orphans = notifications
    .map(n => n.id)
    .filter(id => id >= SLOTS && !valid.has(id)); // ids < SLOTS reserved (e.g. weekly digest)
  if (orphans.length) {
    await ln.cancel({ notifications: orphans.map(id => ({ id })) });
  }
}

// One-time permission bootstrap (Android 13+ POST_NOTIFICATIONS + exact alarms)
export async function ensurePermissions() {
  const p = await plugin();
  if (!p) return;
  const { ln } = p;
  const perm = await ln.requestPermissions().catch(() => ({ display: 'denied' as const }));
  if (perm.display !== 'granted') return;
  scheduleWeeklyDigest(); // now that permission exists
  try {
    const { exact_alarm } = await ln.checkExactNotificationSetting();
    if (exact_alarm !== 'granted' && !localStorage.getItem('exactAlarmPrompted')) {
      localStorage.setItem('exactAlarmPrompted', '1');
      // Opens system settings; without it alarms fire inexactly (minutes late)
      await ln.changeExactNotificationSetting();
    }
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
