/**
 * What a Jarvis question is *about*, parsed locally before any LLM call.
 *
 * Turns "expenses for today" into a date window + type filter so Mongo and retrieval can
 * fetch and send a slice of the vault instead of scoring hundreds of lines every turn.
 *
 * Pure aside from time.ts (Intl + zonedToUtc). Asserted in scripts/self-check.mjs.
 */

import { zonedToUtc } from './time';
import { typeHints, type CandidateType, MAX_CONTEXT_CHARS, MAX_LINES } from './retrieval';

export interface DateWindow {
  /** Inclusive start (ms UTC). */
  start: number;
  /** Exclusive end (ms UTC). */
  end: number;
}

export interface JarvisQueryIntent {
  types: Set<CandidateType>;
  dateWindow: DateWindow | null;
  /** Typed + dated (or typed list) — caller may skip unrelated collections. */
  narrow: boolean;
  limit: number;
  maxChars: number;
}

const DAY_MS = 86_400_000;

/** YYYY-MM-DD for `instant` in `timeZone`. */
export function ymdInZone(instant: number, timeZone: string): string {
  return new Date(instant).toLocaleDateString('en-CA', { timeZone });
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d + days);
  const dt = new Date(t);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function windowForYmd(ymd: string, timeZone: string): DateWindow {
  const start = zonedToUtc(`${ymd}T00:00`, timeZone)?.getTime() ?? Date.parse(`${ymd}T00:00:00Z`);
  const next = addDaysYmd(ymd, 1);
  const end = zonedToUtc(`${next}T00:00`, timeZone)?.getTime() ?? start + DAY_MS;
  return { start, end };
}

const TODAY = /\b(today|tonight|aaj|aj)\b/i;
const TOMORROW = /\b(tomorrow|kal)\b/i;
const YESTERDAY = /\b(yesterday|parso|kal\s*ko?\s*pehle)\b/i;
const THIS_WEEK = /\b(this week|is hafte|is week)\b/i;
const LAST_7 = /\b(last 7 days|past week|last week|pichle?\s*7?\s*din)\b/i;

/**
 * Relative calendar windows the user might mean. Returns null when no time scope was asked —
 * retrieval then behaves as before (recency + words only).
 */
export function dateWindowFromQuestion(question: string, now: number, timeZone: string): DateWindow | null {
  const q = question.toLowerCase();
  const todayYmd = ymdInZone(now, timeZone);

  if (TODAY.test(q)) return windowForYmd(todayYmd, timeZone);
  if (TOMORROW.test(q)) return windowForYmd(addDaysYmd(todayYmd, 1), timeZone);
  if (YESTERDAY.test(q)) return windowForYmd(addDaysYmd(todayYmd, -1), timeZone);

  if (THIS_WEEK.test(q)) {
    const d = new Date(now);
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(d);
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const w = map[weekday.slice(0, 3)] ?? 0;
    const startYmd = addDaysYmd(todayYmd, -w);
    const endYmd = addDaysYmd(startYmd, 7);
    const start = windowForYmd(startYmd, timeZone).start;
    const end = windowForYmd(endYmd, timeZone).start;
    return { start, end };
  }

  if (LAST_7.test(q)) return { start: now - 7 * DAY_MS, end: now + DAY_MS };

  return null;
}

const LIST_ASK = /\b(list|show|all|total|sum|how much|kitna|kitne)\b/i;

export function parseJarvisQuery(question: string, now: number, timeZone: string): JarvisQueryIntent {
  const types = typeHints(question);
  const dateWindow = dateWindowFromQuestion(question, now, timeZone);
  const listy = LIST_ASK.test(question);
  const narrow = (types.size === 1 && !!dateWindow) || (types.size === 1 && listy);

  let limit = 25;
  let maxChars = 14_000;

  if (types.size === 1 && dateWindow) {
    limit = types.has('expense') ? 18 : types.has('task') ? 22 : 20;
    maxChars = types.has('document') ? 16_000 : 6_500;
  } else if (types.size === 1 && listy) {
    limit = 22;
    maxChars = 10_000;
  } else if (types.size === 0 && !dateWindow) {
    limit = MAX_LINES;
    maxChars = MAX_CONTEXT_CHARS;
  } else if (types.size >= 2 || dateWindow) {
    limit = 28;
    maxChars = 12_000;
  }

  return { types, dateWindow, narrow, limit, maxChars };
}
