import connectToDatabase from '@/lib/mongodb';
import Task from '@/lib/models/Task';
import { myProjectIds } from '@/lib/projectAccess';
import { privateFilter } from '@/lib/privacy';

/**
 * How punctual you are: the share of your deadlines you actually met, drawn on the home page under
 * the vault tiles.
 *
 * The rule the whole thing rests on is that **only work with a deadline can be scored**. A task with
 * no dueAt was never promised for a date, so counting it either way is an opinion the user never
 * expressed. Everything below therefore starts from `dueAt` existing.
 *
 * The three buckets are exhaustive over that set, and all three feed the percentage:
 *
 *   · **on time**  — finished, and finished on or before the deadline
 *   · **late**     — finished, but after the deadline
 *   · **still open, past due** — not finished, and the deadline has gone
 *
 * That last bucket counting against the score is the important decision. Leaving it out looks
 * kinder and is the one way to game the number to 100%: never tick anything, and you are never
 * late. Work sitting three days past its date is not punctual whatever the checkbox says, so it
 * counts, and the tile is labelled so the user can see it counting.
 *
 * Everything is bounded to one window (30 days) on BOTH axes — completions by when they happened,
 * misses by when they were due — so a task abandoned in March cannot still be dragging the number
 * down in September. That is also why the tile says "still open, past due" rather than "overdue":
 * it is deliberately NOT the same figure as the overdue count on /tasks, which is unbounded.
 *
 * Private records are withheld outright, the same way lib/digest does it. Home is a glance surface
 * that a shoulder can read, and a percentage that visibly moves when the Private Safe is unlocked
 * would report on the safe's contents without ever printing them.
 */

/** The window the score answers for. Long enough to have data in it, short enough to be about now. */
export const PUNCTUAL_DAYS = 30;

/** Only the fields the scoring rule reads — deliberately narrow so the query can stay a projection. */
export interface PunctualRow {
  completed: boolean;
  dueAt?: Date | string | null;
  completedAt?: Date | string | null;
  /** The fallback for rows ticked before completedAt existed. See `finishedAt` below. */
  updatedAt?: Date | string | null;
}

export interface Punctuality {
  onTime: number;
  late: number;
  /** Past its date and still open. Counts against the rate — see the note above. */
  missed: number;
  /** How many deadlines the score is actually made of. Zero means "no answer yet", not "zero percent". */
  scored: number;
  /** Whole percent, 0–100. Meaningless when `scored` is 0, which is why the caller checks that first. */
  rate: number;
}

export const NO_PUNCTUALITY: Punctuality = { onTime: 0, late: 0, missed: 0, scored: 0, rate: 0 };

const ms = (v: Date | string | null | undefined) => (v ? new Date(v).getTime() : NaN);

/**
 * When a finished task was finished.
 *
 * `completedAt` is the truth and is stamped by toggleTask. Rows ticked before that field existed
 * have nothing, and `updatedAt` is the closest thing they carry — it is exact for a task nobody
 * touched after ticking it, and too late for one that was edited afterwards, which reads as "late"
 * when it may not have been. That is the known cost of having numbers on day one instead of in a
 * month, and it is self-limiting: these rows leave the 30-day window and never come back, so the
 * approximation expires rather than accumulating.
 */
function finishedAt(t: PunctualRow): number {
  const stamped = ms(t.completedAt);
  return Number.isNaN(stamped) ? ms(t.updatedAt) : stamped;
}

/**
 * The rule itself, kept pure and DB-free so tests/unit/punctuality.test.ts can hold it to account
 * without a database — the same reason lib/scope, lib/taskAccess and lib/reminderRule are separate
 * from the actions that call them.
 *
 * `now` is passed in rather than read, so the caller decides the clock once on the server. A
 * function that asks Date.now() mid-render can disagree with itself between two renders of the same
 * page, which is exactly the bug lib/digest's `overdue` comment describes.
 */
export function scorePunctuality(rows: PunctualRow[], now: number, days = PUNCTUAL_DAYS): Punctuality {
  const since = now - days * 24 * 3600e3;
  let onTime = 0, late = 0, missed = 0;

  for (const t of rows) {
    const due = ms(t.dueAt);
    if (Number.isNaN(due)) continue; // no deadline, nothing to be punctual about

    if (t.completed) {
      const done = finishedAt(t);
      if (Number.isNaN(done) || done < since) continue; // finished, but not in this window
      if (done <= due) onTime++; else late++;
    } else if (due < now && due >= since) {
      missed++;
    }
  }

  const scored = onTime + late + missed;
  return { onTime, late, missed, scored, rate: scored ? Math.round((onTime / scored) * 100) : 0 };
}

/**
 * The read. Same scope as getMyOpenTasks in actions/task: my own work, plus anything assigned to me
 * in a group I can actually open. Being assigned something is not on its own enough — a task in a
 * group I am not a member of would otherwise score me on work no screen of mine can reach.
 */
export async function punctualityStats(userId: string, email: string): Promise<Punctuality> {
  await connectToDatabase();
  const now = Date.now();
  const since = new Date(now - PUNCTUAL_DAYS * 24 * 3600e3);

  const reachable = [
    { projectId: null },
    { projectId: { $in: await myProjectIds(userId, email) } },
  ];

  /* Two $or groups, so they go under $and — a second top-level $or key would silently replace the
     first and score the user on the whole collection.

     The window here is a SUPERSET, not the final filter: completed rows are cut on `updatedAt`
     because completedAt may be absent on old ones, and updatedAt is always >= completedAt (the same
     save writes both, and later edits only push it further out). scorePunctuality then does the
     exact cut on the real completion date. Filtering loosely in Mongo and precisely in the pure
     function is what keeps the rule in one testable place. */
  const rows = await Task.find({
    dueAt: { $exists: true, $ne: null },
    $and: [
      { $or: [
        { userId, ...privateFilter(false) },
        { assigneeId: userId, $or: reachable },
        { assigneeIds: userId, $or: reachable },
      ] },
      { $or: [
        { completed: true, updatedAt: { $gte: since } },
        { completed: false, dueAt: { $gte: since } },
      ] },
    ],
  })
    .select('completed dueAt completedAt updatedAt')
    // Capped so one home render is bounded work no matter how much history a heavy user has. Sorted
    // newest-first so the cap drops the oldest deadlines rather than an arbitrary page of them.
    .sort({ dueAt: -1 })
    .limit(500)
    .lean();

  return scorePunctuality(rows as PunctualRow[], now);
}
