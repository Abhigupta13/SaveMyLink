/**
 * WHEN a task's reminders fire.
 *
 * Pure on purpose: this file imports NOTHING — no mongoose, no path aliases, not even a node
 * builtin — so scripts/self-check.mjs can hold the maths to account with no database and no
 * framework. Everything about *which* instants get scheduled lives here; lib/taskNotifications
 * only turns these into Capacitor notifications, and who gets notified is decided upstream by
 * getMyOpenTasks. Changing the schedule means changing this file and nothing else.
 *
 * The default schedule is 85% of the way from when the task was written to when it is due — a
 * task created ten days ahead nudges on day 8.5, one due in an hour nudges at ~51 minutes. A
 * fixed "24h before" says nothing on a task due this afternoon and arrives far too late on one
 * you were given a month for; the elapsed fraction scales with how long you actually had.
 *
 * Three things every choice but "none" keeps, because they are the product's promise and not a
 * preference: a ping AT the deadline, and then 9:00 every morning until the box is ticked.
 * The choice only picks the ONE nudge before the deadline.
 */

export type ReminderChoice = 'smart' | 'day' | 'hour' | 'deadline' | 'none';

/**
 * The named choices, in the order they are offered. One list, so /tasks, a group page, a meeting's
 * confirm row and Profile all say exactly the same words.
 *
 * Two phrasings, because there are two places a picker sits: under its own heading in a modal
 * (`label`), and inline in a crowded quick-add row where nothing labels it (`inline`, which
 * carries the word "Remind" itself so the control explains itself with no heading at all).
 */
export const REMINDER_OPTIONS: { value: ReminderChoice; label: string; inline: string }[] = [
  { value: 'smart', label: 'Default — 85% of the way there', inline: 'Remind: 85% of the way' },
  { value: 'day', label: 'A day before', inline: 'Remind: a day before' },
  { value: 'hour', label: 'An hour before', inline: 'Remind: an hour before' },
  { value: 'deadline', label: 'Only at the deadline', inline: 'Remind: at the deadline' },
  { value: 'none', label: 'No reminder at all', inline: 'No reminder' },
];

export const REMINDER_VALUES: ReminderChoice[] = REMINDER_OPTIONS.map(o => o.value);

/** Said once, under every picker: the part of the schedule that is not up for negotiation. */
export const REMINDER_FOOTNOTE =
  'Every choice but “No reminder” also pings at the deadline, then every morning at 9 until it is ticked off.';

/** Absent on the task AND absent on the user reads as this — including on every row written before the setting existed. */
export const DEFAULT_CHOICE: ReminderChoice = 'smart';

export const SMART_FRACTION = 0.85;
export const HOUR_MS = 3600e3;
export const DAY_MS = 24 * HOUR_MS;
export const NAG_HOUR = 9;

/**
 * The id budget. lib/taskNotifications derives ten consecutive notification ids per task from its
 * _id, so the slots handed out here must stay inside [0, SLOTS). Laid out explicitly rather than
 * counted by hand: the pre-deadline nudge, the deadline itself, and the morning chase in between.
 */
export const SLOTS = 10;
export const PRE_SLOT = 0;
export const DUE_SLOT = 9;
export const NAG_SLOT_START = 2;
export const NAG_DAYS = 7;   // fills slots 2..8; slot 1 is free since the second fixed offset went away

/**
 * How far off the deadline still is, said in the largest unit that is still honest. One phrase for
 * every choice: "A day before" and an 85% point nine minutes out both need a title that says how
 * long is left, and hard-coding "Due tomorrow" was only ever right for the fixed 24h offset.
 *
 * Rounded DOWN, never to nearest. 36 hours rounds to "2 days", and a warning that overstates the
 * time you have left is the one kind of error this notification must not make.
 */
export function countdownLabel(at: number, due: number): string {
  const mins = Math.max(1, Math.floor((due - at) / 60000));
  if (mins < 60) return `Due in ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Due in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `Due in ${days} day${days === 1 ? '' : 's'}`;
}

export type ReminderKind = 'pre' | 'due' | 'nag';
export interface ReminderSlot {
  slot: number;
  at: number;      // epoch ms
  kind: ReminderKind;
}

export interface RemindableTask {
  createdAt?: Date | string | number | null;
  dueAt?: Date | string | number | null;
  completed?: boolean;
  reminder?: string | null;
}

const isChoice = (v: unknown): v is ReminderChoice =>
  typeof v === 'string' && (REMINDER_VALUES as string[]).includes(v);

/**
 * The one validator. Choices reach the server from a browser, from Jarvis and from the meeting
 * extractor — all three untrusted — so nothing is stored that is not one of the five names.
 * Anything else becomes undefined, which reads as "use my default", never as "no reminder".
 */
export const asChoice = (v: unknown): ReminderChoice | undefined => (isChoice(v) ? v : undefined);

/**
 * The task's own choice wins; the user's profile default fills in; failing both, the default
 * schedule. Anything unrecognised — a hand-edited row, an LLM inventing a value — falls through
 * to the next fallback rather than silently switching reminders off.
 */
export function reminderChoice(taskChoice?: unknown, userDefault?: unknown): ReminderChoice {
  if (isChoice(taskChoice)) return taskChoice;
  if (isChoice(userDefault)) return userDefault;
  return DEFAULT_CHOICE;
}

const ms = (v?: Date | string | number | null): number | null => {
  if (v === null || v === undefined) return null;
  const t = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
};

/**
 * The single nudge before the deadline, or null for none.
 *
 * `created` is the ORIGINAL creation instant, never "now" — a task whose due date is pushed back
 * a week must still be measured from the day it was written, or every edit would restart the
 * clock and the nudge would drift forever forwards.
 */
function preAt(choice: ReminderChoice, created: number | null, due: number): number | null {
  if (choice === 'deadline' || choice === 'none') return null;
  if (choice === 'day') return due - DAY_MS;
  if (choice === 'hour') return due - HOUR_MS;
  // smart: with no creation stamp there is no elapsed time to take a fraction of, so there is no
  // honest answer — skip the nudge rather than invent one. The deadline and the chase still run.
  if (created === null) return null;
  return Math.round(created + (due - created) * SMART_FRACTION);
}

/**
 * Every instant this task should fire at, from `now` onwards. Empty means schedule nothing.
 *
 * Nothing in the past is ever returned: a deadline that has already gone by, an 85% point already
 * crossed (a task due minutes after it was written), a due date moved forward past its own nudge.
 * A notification scheduled in the past either fires immediately or is dropped, and both are wrong.
 *
 * The morning chase is computed with local Date arithmetic — deliberately, because this runs on
 * the phone and "9am" means 9am where the person holding it is standing.
 */
export function reminderTimes(
  task: RemindableTask,
  userDefault?: unknown,
  now: number = Date.now(),
): ReminderSlot[] {
  const due = ms(task.dueAt);
  if (due === null || task.completed) return [];   // no deadline, nothing to be late for

  const choice = reminderChoice(task.reminder, userDefault);
  if (choice === 'none') return [];

  const out: ReminderSlot[] = [];

  const pre = preAt(choice, ms(task.createdAt), due);
  if (pre !== null && pre > now && pre < due) out.push({ slot: PRE_SLOT, at: pre, kind: 'pre' });

  if (due > now) out.push({ slot: DUE_SLOT, at: due, kind: 'due' });

  const nag = new Date(due);
  nag.setHours(NAG_HOUR, 0, 0, 0);
  if (nag.getTime() <= due) nag.setDate(nag.getDate() + 1);   // the first 9am strictly after it lapsed
  for (let i = 0; i < NAG_DAYS; i++) {
    const at = new Date(nag);
    at.setDate(at.getDate() + i);
    if (at.getTime() > now) out.push({ slot: NAG_SLOT_START + i, at: at.getTime(), kind: 'nag' });
  }

  return out;
}
