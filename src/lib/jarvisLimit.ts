/**
 * How many Jarvis questions one person gets in a day.
 *
 * The wall is real and it is small: Gemini's free tier allows 20 requests per day PER MODEL, the
 * fallback chain in lib/llm turns that into roughly 60, and MOM's extraction spends from the same
 * pot. One enthusiastic user can therefore take the assistant away from everybody else before
 * lunch, and today they would each see "Assistant unavailable" and conclude the app is broken.
 *
 * So: a per-user daily allowance, and — when the shared pot really is empty — a message that says
 * so instead of a generic error. Both numbers move; neither is guessed at in more than one place.
 *
 * Pure and import-free so scripts/self-check.mjs can run it under plain node.
 */

/** Deliberately one number, deliberately low. Raise it the day someone is paying for the keys. */
export const JARVIS_DAILY_LIMIT = 5;

const DEFAULT_TZ = 'Asia/Kolkata';

/**
 * The calendar day in the ASKER's zone, as YYYY-MM-DD. Not the server's: "resets tomorrow" has to
 * mean tomorrow where the person is standing, or an Indian user's allowance rolls over at 5:30am.
 * en-CA formats as YYYY-MM-DD, which sorts and compares as a plain string.
 */
export function dayKey(when: Date | number, timeZone?: string): string {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(when));
  try {
    return fmt(timeZone || DEFAULT_TZ);
  } catch {
    // A zone string from a client we do not control must not cost someone their allowance
    return fmt(DEFAULT_TZ);
  }
}

export interface Allowance {
  count?: number | null;
  /** The day `count` belongs to. A different day means the count is stale and reads as zero. */
  date?: string | null;
}

export interface Spend {
  allowed: boolean;
  /** What to store. Unchanged when the question was refused. */
  count: number;
  /** Questions left after this one. -1 means "not counted" (an admin). */
  remaining: number;
}

/**
 * Decide and count in one place. A stored count from any other day is simply ignored rather than
 * reset on a schedule — no cron, no midnight job, and an account that goes quiet for a month
 * needs no cleanup.
 */
export function spendQuestion(
  saved: Allowance | null | undefined,
  today: string,
  limit: number = JARVIS_DAILY_LIMIT,
  exempt = false,
): Spend {
  const used = saved?.date === today ? Math.max(0, Math.floor(Number(saved.count) || 0)) : 0;
  const allowed = exempt || used < limit;
  return {
    allowed,
    count: used + (allowed ? 1 : 0),
    remaining: exempt ? -1 : Math.max(0, limit - used - (allowed ? 1 : 0)),
  };
}

/** What the user is told when their own allowance is spent. Truthful about why it exists. */
export const capMessage = (limit: number = JARVIS_DAILY_LIMIT) =>
  `You've used today's ${limit} questions. The free AI allowance is shared across everyone using the app; it resets tomorrow.`;

/** What they are told when the SHARED pot is empty — a different fact, and not their fault. */
export const SHARED_OUT_MESSAGE =
  "Today's shared AI allowance is used up — everyone on the app draws from the same free quota, and it resets tomorrow. Nothing is wrong with your account.";
