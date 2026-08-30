/**
 * The vocabulary of the activity trail, and how each verb reads to a person.
 *
 * Mongoose-free, like scope.ts and taskAccess.ts, so scripts/self-check.mjs can assert the one
 * thing that actually breaks here: a verb an action emits that the renderer has no phrasing for.
 * That failure is invisible until somebody opens the page and sees a raw enum string, and it is
 * exactly the kind of thing that ships when the writer and the reader live in different files.
 */

export const VERBS = [
  'task_created',
  'task_completed',
  'task_reopened',
  'task_signed_off',
  'task_reassigned',
  'member_added',
  'member_removed',
  'role_changed',
  'project_renamed',
  'meeting_recorded',
  'message_posted',
] as const;

export type Verb = (typeof VERBS)[number];

/**
 * Past tense, actor-first: the UI puts a name in front of this. Phrasing lives here rather than
 * in JSX so the assertion below can reach it.
 */
const PHRASES: Record<Verb, (subject: string) => string> = {
  task_created: s => `added ${s}`,
  task_completed: s => `completed ${s}`,
  task_reopened: s => `re-opened ${s}`,
  task_signed_off: s => `signed off ${s}`,
  task_reassigned: s => `reassigned ${s}`,
  member_added: s => `added ${s} to the group`,
  member_removed: s => `removed ${s} from the group`,
  role_changed: s => `changed the role of ${s}`,
  project_renamed: s => `renamed the group to ${s}`,
  meeting_recorded: s => `recorded ${s}`,
  // Reads for all three shapes a message takes: an excerpt ("posted where is the gate key"), a
  // file name when there is no text ("posted site-plan.pdf"), and phrase()'s own empty-subject
  // fallback ("posted something"). "What did I miss" is the highest-value thing the trail answers,
  // and a chat the trail never mentions is a conversation you only find by opening the chat.
  message_posted: s => `posted ${s}`,
};

/**
 * '' for a verb nothing knows how to say, so the renderer can skip the row rather than print an
 * enum at somebody. An event written by a newer deploy and read by an older one is the realistic
 * way that happens.
 */
export function phrase(verb: string, subject?: string | null): string {
  const say = PHRASES[verb as Verb];
  if (!say) return '';
  return say(String(subject ?? '').trim() || 'something');
}

/** The default window. Seven days is a working week — long enough to cover "what did I miss". */
export const DEFAULT_DAYS = 7;

/**
 * The `days` value arrives from a client control, so it is clamped rather than trusted: junk falls
 * back to a week instead of returning the whole history of the group.
 */
export function sinceDays(days?: unknown, now: number = Date.now()): Date {
  const n = Math.floor(Number(days));
  const safe = Number.isFinite(n) && n >= 1 ? Math.min(n, 365) : DEFAULT_DAYS;
  return new Date(now - safe * 86_400_000);
}

/**
 * What a note says about where it came from.
 *
 * Two fields, not one, and that is the point. `momId` survives the meeting being deleted;
 * `momTitle` is filled in only when the meeting still resolves. Populating the reference instead
 * would collapse both cases to null — mongoose turns a dangling ref into null exactly like a
 * field that was never set — and a note that outlived its meeting would silently pretend it had
 * been typed by hand.
 *
 * Pure and mongoose-free so scripts/self-check.mjs can hold the fallback to account, because the
 * broken version of this reads "from undefined" and nobody notices until a user does.
 */
export function fromMeeting(note: { momId?: unknown; momTitle?: string | null }): string {
  if (!note?.momId) return '';
  const title = String(note.momTitle ?? '').trim();
  return title ? `from ${title}` : 'from a deleted meeting';
}
