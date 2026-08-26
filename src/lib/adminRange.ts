/**
 * Turning an /admin date-range choice into the window the queries run against.
 *
 * The dashboard's time-based metrics (new signups, people who created something, suggestions, the
 * trend chart) all need the same [from, to] pair, and the client picks it — a preset pill or two
 * date inputs. A client-supplied window is untrusted input, so it is validated and clamped HERE,
 * once, and every caller in admin.ts uses the result rather than trusting a raw date string.
 *
 * Pure and mongoose-free: it only needs the clock and the timezone, so it stays testable and
 * carries the self-check for the clamping rules (see scripts/self-check.mjs).
 */

/* No imports on purpose: scripts/self-check.mjs runs this file in plain node, where the "@/"
   alias does not resolve — so the timezone default and the midnight calculation are inlined
   rather than borrowed from ./time. Keep it that way and the assertions keep running. */
const DEFAULT_TZ = 'Asia/Kolkata';

const DAY = 86_400_000;
/** Custom ranges are capped so the trend chart can never be asked for thousands of buckets. */
export const MAX_SPAN_DAYS = 366;
/** A day chart above this many bars is unreadable on a 390px screen; switch to month buckets. */
const MAX_DAY_BUCKETS = 92;

export const PRESETS = ['today', '7d', '30d', '90d', 'all'] as const;
export type RangePreset = (typeof PRESETS)[number];
export type CustomRange = { from: string; to: string };
export type RangeInput = RangePreset | CustomRange;

export interface ResolvedRange {
  from: Date;
  to: Date;
  /** Day for short windows, month once a day chart would overflow. */
  buckets: {
    unit: 'day' | 'month';
    /** mongo $dateToString format that produces the same keys as `keys`. */
    format: '%Y-%m-%d' | '%Y-%m';
    /** Dense, ordered bucket keys spanning from…to (most-recent tail if it would be too long). */
    keys: string[];
  };
}

const isPreset = (v: unknown): v is RangePreset =>
  typeof v === 'string' && (PRESETS as readonly string[]).includes(v);

/** "YYYY-MM-DD" for an instant, in the given zone. en-CA renders exactly that shape. */
const dayKey = (ms: number, tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(ms));

/**
 * The instant midnight-in-`tz` began for the calendar day `ms` falls on. Derived by measuring the
 * zone's offset at that moment rather than by parsing a string, so it needs no date library.
 */
const startOfDay = (ms: number, tz: string) => {
  const [y, m, d] = dayKey(ms, tz).split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  // What wall-clock time is `guess` in tz? The difference is the offset to subtract.
  const shown = new Date(new Date(guess).toLocaleString('en-US', { timeZone: tz })).getTime();
  const naive = new Date(new Date(guess).toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  return guess - (shown - naive);
};

function bucketPlan(fromMs: number, toMs: number, tz: string): ResolvedRange['buckets'] {
  const spanDays = (toMs - fromMs) / DAY;

  if (spanDays <= MAX_DAY_BUCKETS) {
    const keys: string[] = [];
    for (let t = startOfDay(fromMs, tz); t <= toMs; t += DAY) keys.push(dayKey(t, tz));
    return { unit: 'day', format: '%Y-%m-%d', keys };
  }

  // Month buckets, walked backwards from the end so an epoch 'from' caps at the most recent
  // MAX_DAY_BUCKETS months instead of generating hundreds of empty bars back to 1970.
  const [ty, tm] = dayKey(toMs, tz).split('-').map(Number);
  const [fy, fm] = dayKey(fromMs, tz).split('-').map(Number);
  const rev: string[] = [];
  let y = ty, m = tm;
  for (let i = 0; i < MAX_DAY_BUCKETS; i++) {
    rev.push(`${y}-${String(m).padStart(2, '0')}`);
    if (y === fy && m === fm) break;
    if (--m === 0) { m = 12; y--; }
  }
  return { unit: 'month', format: '%Y-%m', keys: rev.reverse() };
}

/**
 * A range choice → the concrete window and the chart's bucket plan.
 * `now` is injected so the self-check is deterministic. Anything unrecognised falls back to '7d',
 * the dashboard's default, rather than erroring.
 */
export function resolveRange(range: RangeInput | undefined, now: number, tz: string = DEFAULT_TZ): ResolvedRange {
  let fromMs: number;
  let toMs = now;

  if (isPreset(range) || range === undefined) {
    const preset: RangePreset = isPreset(range) ? range : '7d';
    fromMs =
      preset === 'all' ? 0 :
      preset === 'today' ? startOfDay(now, tz) :
      preset === '90d' ? now - 90 * DAY :
      preset === '30d' ? now - 30 * DAY :
      now - 7 * DAY;
  } else {
    // Custom, from the client: parse, then clamp so from ≤ to ≤ now and the span stays bounded.
    const f = Date.parse(range?.from ?? '');
    const t = Date.parse(range?.to ?? '');
    if (Number.isNaN(f) || Number.isNaN(t)) return resolveRange('7d', now, tz); // unparseable → default
    fromMs = Math.min(f, t);
    toMs = Math.min(Math.max(f, t), now);
    // A custom `to` is a calendar day; include all of it rather than cutting at 00:00.
    toMs = Math.min(startOfDay(toMs, tz) + DAY - 1, now);
    if (toMs - fromMs > MAX_SPAN_DAYS * DAY) fromMs = toMs - MAX_SPAN_DAYS * DAY;
  }

  fromMs = Math.max(0, Math.min(fromMs, toMs));
  return { from: new Date(fromMs), to: new Date(toMs), buckets: bucketPlan(fromMs, toMs, tz) };
}
