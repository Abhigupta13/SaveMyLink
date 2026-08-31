/**
 * The rules behind the notifications feed, kept pure so they can be proven without a database.
 *
 * Everything here decides what a person SEES on a page that summarises other people's messages,
 * which is why the edges matter more than they look: a preview that leaks the whole of a long
 * message, or renders an attachment-only post as an empty line, is the feature failing quietly.
 */

/** How far back the feed looks. A week is "what did I miss", which is the question being asked. */
export const NOTIFICATION_WINDOW_DAYS = 7;

/**
 * The ceiling on one response. A busy group can produce hundreds of messages a week, and this is
 * a glance surface — past a certain length nobody reads further, and the payload is still paid for.
 */
export const MAX_NOTIFICATIONS = 60;

/** Long enough to know whether it concerns you, short enough not to be the message itself. */
export const PREVIEW_CHARS = 90;

/**
 * The one activity verb the feed must NOT read, because the thing it describes is already in the
 * feed from a better source.
 *
 * Sending a chat message writes two rows: the Message itself, and a 'message_posted' Event so the
 * group's activity tab can show it in sequence with everything else. Both are correct where they
 * live. Reading both into one list showed every message twice — once as itself and once as its own
 * trail entry, seconds apart, which is how it looked on the first real render.
 *
 * Named here rather than inlined so the exclusion and the reason travel together; a bare
 * `$ne: 'message_posted'` in a query reads like a filter somebody forgot to explain.
 */
export const MESSAGE_VERB = 'message_posted';

/**
 * One line standing in for a message.
 *
 * Three cases, and the last two are the ones a naive `body.slice(0, 90)` gets wrong:
 *  · Ordinary text — collapsed to one line and truncated on a word boundary where possible, so a
 *    preview does not end mid-syllable.
 *  · Attachment with no words — "sent a file", because slicing an empty body renders a row that
 *    looks like a rendering bug rather than like a photo somebody posted.
 *  · Newlines — a chat message is often several lines, and a feed row is one. Collapsed rather
 *    than truncated at the first break, which would hide the half that mattered.
 */
export function previewOf(body: unknown, attachments = 0): string {
  const flat = String(body ?? '').replace(/\s+/g, ' ').trim();

  if (!flat) {
    if (attachments > 0) return attachments === 1 ? 'sent a file' : `sent ${attachments} files`;
    return '';   // no words and nothing attached: the caller drops the row entirely
  }

  if (flat.length <= PREVIEW_CHARS) return flat;

  const cut = flat.slice(0, PREVIEW_CHARS);
  // Break at the last space if there is one reasonably near the end, so the preview ends on a
  // word. A hard slice is the fallback for text with no spaces at all — a long URL, or Devanagari
  // and CJK, where breaking on spaces would either do nothing or do the wrong thing.
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > PREVIEW_CHARS * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * "just now", "5m", "3h", "2d" — the age of a feed row.
 *
 * Relative rather than a clock, because the question is "how stale is this", and a feed of exact
 * timestamps makes the reader do the subtraction. Past a week it gives up and says the date, since
 * "9d" stops being easier to read than the day itself — and the window is a week anyway, so that
 * branch only fires on a clock skew.
 */
export function agoLabel(at: Date | string, now: number = Date.now()): string {
  const t = new Date(at).getTime();
  if (!Number.isFinite(t)) return '';
  const secs = Math.floor((now - t) / 1000);

  // A row stamped slightly in the future — a phone clock a few seconds fast — reads as new rather
  // than as a negative age.
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days <= 7) return `${days}d`;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
