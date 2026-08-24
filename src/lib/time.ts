/**
 * Turning what a model wrote into the instant the user meant.
 *
 * Jarvis and the MOM extractor both answer with a bare wall clock — "2026-08-26T17:00" — because
 * that is what a person says out loud. A bare wall clock carries no zone, so `new Date(...)` reads
 * it in the *runtime's* zone: on a UTC server "tomorrow 5pm" became 22:30 in India, and every
 * reminder fired against that. The browser already tells us the real zone on both paths; this is
 * where it finally gets used.
 *
 * Pure and dependency-free — Intl already knows every zone's offset, including its DST history.
 */

/** Only reached when the caller has no zone to offer. Everyone using this today is in India. */
export const DEFAULT_TZ = 'Asia/Kolkata';

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** That instant's wall clock in `timeZone`, expressed as if those digits were UTC. */
function wallClockAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant));
  const p: Record<string, string> = {};
  for (const { type, value } of parts) p[type] = value;
  // Some engines render midnight as hour 24 under hour12:false
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
}

/**
 * A wall-clock string plus the zone it was spoken in → the actual instant.
 * A string that already carries a zone (trailing Z or ±hh:mm) is unambiguous and passes straight
 * through — `confirmMomTasks` round-trips real ISO through here and must never be shifted twice.
 * Returns null for anything unparseable, so callers keep their existing "no due date" branch.
 */
export function zonedToUtc(value: unknown, timeZone: string = DEFAULT_TZ): Date | null {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const m = WALL_CLOCK.exec(raw);
  if (!m) {
    const parsed = new Date(raw);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  const [, y, mo, d, h, mi, s] = m;
  const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0));
  if (isNaN(wall)) return null;

  try {
    // Solve instant = wall − offset(instant). One correction settles a DST boundary, where the
    // first guess and the answer sit on opposite sides of a clock change.
    const first = wall - (wallClockAt(wall, timeZone) - wall);
    const second = wall - (wallClockAt(first, timeZone) - first);
    return new Date(second);
  } catch {
    // An unknown zone string from a client we do not control must not lose the date entirely
    return new Date(wall - (wallClockAt(wall, DEFAULT_TZ) - wall));
  }
}

/** Guards against a client sending junk where an IANA zone belongs. */
export function safeZone(timeZone?: string | null): string {
  if (!timeZone) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return timeZone;
  } catch {
    return DEFAULT_TZ;
  }
}

/**
 * Every clock the user reads is 12-hour with am/pm. It lives here rather than in each page because
 * seven copies of the same options object is seven chances for one screen to disagree with another
 * — and a task that says "17:00" next to a reminder that says "5:00 pm" reads like two due dates.
 *
 * `en-GB` gives lowercase "5:00 pm"; leaving the locale to the device gave 24-hour on some phones
 * and 12-hour on others, which is why it looked inconsistent.
 */
const CLOCK: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true };
const DAY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };

const toDate = (value: Date | string | null | undefined) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? null : date;
};

/** Omit timeZone to use the device's own — correct on the client, wrong on the server. */
function render(value: Date | string | null | undefined, opts: Intl.DateTimeFormatOptions, timeZone?: string) {
  const date = toDate(value);
  if (!date) return '';
  try {
    return date.toLocaleString('en-GB', timeZone ? { ...opts, timeZone } : opts);
  } catch {
    return date.toISOString().slice(0, 16);
  }
}

/** "5:00 pm" */
export const formatTime = (value: Date | string | null | undefined, timeZone?: string) =>
  render(value, CLOCK, timeZone);

/** "26 Aug" */
export const formatDay = (value: Date | string | null | undefined, timeZone?: string) =>
  render(value, DAY, timeZone);

/** "26 Aug 2026" — for anywhere the year actually matters, like an exported report. */
export const formatDate = (value: Date | string | null | undefined, timeZone?: string) =>
  render(value, { ...DAY, year: 'numeric' }, timeZone);

/** "26 Aug, 5:00 pm" — the short readable form used in prompts and in the lines Jarvis cites back. */
export const formatInZone = (value: Date | string | null | undefined, timeZone?: string) =>
  render(value, { ...DAY, ...CLOCK }, timeZone);
